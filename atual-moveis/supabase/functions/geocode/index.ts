// CEP/endereço → coordenadas, para verificar o raio de entrega de cada loja.
// 1) BrasilAPI (CEP v2) devolve o endereço e, às vezes, as coordenadas;
// 2) sem coordenadas, consulta o OpenStreetMap (Nominatim) com o endereço completo;
// 3) em último caso usa o centro da cidade (precision = "city").
// Resultados ficam em cache na tabela geocode_cache.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UA = 'AtualMoveis/1.0 (vitrine da rede Atual Moveis; calculo de raio de entrega)';
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
const clean = (s: unknown, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// null = sem resposta útil; undefined = serviço fora do ar (falha de rede, tempo esgotado ou bloqueio)
async function fetchJson(url: string, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (r.status === 403 || r.status === 429 || r.status >= 500) return undefined;
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

// OpenStreetMap: tentativa curta; se o serviço não responder, as demais buscas desta chamada são puladas.
let osmDown = false;
async function nominatim(params: Record<string, string>) {
  if (osmDown) return null;
  const qs = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', addressdetails: '0', ...params });
  const d = await fetchJson(`https://nominatim.openstreetmap.org/search?${qs}`, 3000);
  if (d === undefined) {
    osmDown = true;
    return null;
  }
  if (Array.isArray(d) && d[0]) return { lat: Number(d[0].lat), lng: Number(d[0].lon), display_name: d[0].display_name as string };
  return null;
}

async function cached(key: string) {
  const { data } = await db.from('geocode_cache').select('lat,lng,display_name').eq('query', key).maybeSingle();
  return data;
}

async function store(key: string, v: { lat: number; lng: number; display_name?: string }) {
  await db.from('geocode_cache').upsert({ query: key, lat: v.lat, lng: v.lng, display_name: v.display_name ?? null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  osmDown = false;
  try {
    const body = await req.json().catch(() => ({}));
    const cep = onlyDigits(body.cep);
    let street = clean(body.street);
    let number = clean(body.number, 20);
    let district = clean(body.district);
    let city = clean(body.city);
    let state = clean(body.state, 2).toUpperCase();

    if (cep && cep.length !== 8) return json({ error: 'CEP inválido' }, 400);
    if (!cep && !city) return json({ error: 'Informe o CEP ou a cidade' }, 400);

    // Endereço pelo CEP
    let cepCoords: { lat: number; lng: number } | null = null;
    if (cep) {
      const key = `cep:${cep}`;
      let info = await cached(key + ':addr').then((r) => (r?.display_name ? JSON.parse(r.display_name) : null));
      if (!info) {
        const b = await fetchJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
        if (b && b.cep) {
          const c = b.location?.coordinates;
          info = {
            street: b.street ?? '',
            district: b.neighborhood ?? '',
            city: b.city ?? '',
            state: b.state ?? '',
            lat: c?.latitude ? Number(c.latitude) : null,
            lng: c?.longitude ? Number(c.longitude) : null,
          };
        } else {
          const v = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`);
          if (v && !v.erro) info = { street: v.logradouro ?? '', district: v.bairro ?? '', city: v.localidade ?? '', state: v.uf ?? '', lat: null, lng: null };
        }
        if (!info) return json({ error: 'CEP não encontrado' }, 404);
        await db.from('geocode_cache').upsert({ query: key + ':addr', lat: info.lat, lng: info.lng, display_name: JSON.stringify(info) });
      }
      street = street || info.street;
      district = district || info.district;
      city = city || info.city;
      state = state || info.state;
      if (Number.isFinite(info.lat) && Number.isFinite(info.lng) && info.lat && info.lng) cepCoords = { lat: info.lat, lng: info.lng };
    }

    const address = { cep, street, number, district, city, state };

    // Coordenadas mais precisas: endereço com número (sem número, as coordenadas do CEP já bastam)
    if (street && city && (number || !cepCoords)) {
      const key = `addr:${[street, number, city, state].join('|').toLowerCase()}`;
      const hit = await cached(key);
      if (hit?.lat) return json({ ...hit, precision: number ? 'address' : 'street', source: 'cache', address });
      const stateName = UF[state] ?? state;
      const r =
        (await nominatim({ street: number ? `${number} ${street}` : street, city, state: stateName, country: 'Brasil' })) ??
        (await nominatim({ q: [street, number, city, stateName, 'Brasil'].filter(Boolean).join(', ') }));
      if (r) {
        await store(key, r);
        return json({ ...r, precision: number ? 'address' : 'street', source: 'osm', address });
      }
    }

    if (cepCoords) return json({ ...cepCoords, precision: 'cep', source: 'brasilapi', address });

    // Último recurso: centro da cidade
    if (city) {
      const key = `city:${[city, state].join('|').toLowerCase()}`;
      const hit = await cached(key);
      if (hit?.lat) return json({ ...hit, precision: 'city', source: 'cache', address });
      const r =
        (await nominatim({ city, state: UF[state] ?? state, country: 'Brasil' })) ??
        (await nominatim({ q: [city, UF[state] ?? state, 'Brasil'].filter(Boolean).join(', ') }));
      if (r) {
        await store(key, r);
        return json({ ...r, precision: 'city', source: 'osm', address });
      }
    }
    return json({ error: 'Não conseguimos localizar este endereço', address }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, 500);
  }
});
