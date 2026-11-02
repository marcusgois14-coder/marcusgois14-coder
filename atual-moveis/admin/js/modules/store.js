// Dados da loja selecionada, numa página só com seções: dados, endereço e mapa, entrega, pagamento,
// horários e aparência. As abas do topo levam a cada seção; a barra "Alterações não salvas" (saveBar)
// grava só as seções alteradas, validando cada uma (as outras ficam como estão no banco).
// Regras do banco que a tela respeita:
//   - slug, marca, ordem e ativação só mudam pela administração da rede (gatilho stores_guard);
//   - a equipe da loja não passa o raio de entrega do limite da rede (network_settings.default_radius_km);
//     o gatilho confere o raio em QUALQUER alteração feita pela equipe, então um raio acima do limite
//     (definido pela rede) bloqueia todas as gravações da loja até ser reduzido;
//   - na vitrine, preço no PIX = preço × (1 − pix_discount_pct/100) e as parcelas respeitam a parcela mínima;
//   - stores.marquee (frases da faixa rolante) substitui as frases da rede quando tem ao menos uma frase.
// Também exporta utilitários usados pelo módulo "Lojas" (stores.js): erros, mapa, UFs e validações.
import { sb, q, fn, storefrontUrl } from '../api.js';
import {
  html,
  raw,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  readForm,
  showErrors,
  withBusy,
  skeleton,
  empty,
  errorBlock,
  injectStyle,
  money,
  num,
  phone as fmtPhone,
  cep as fmtCep,
  confirmDialog,
  badge,
  storeMark,
  saveBar,
  tip,
  art,
  PAYMENT_METHOD,
  PAYMENT_ICON,
} from '../ui.js';

/* =========================================================
   Utilitários compartilhados (também usados por stores.js)
   ========================================================= */
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
export const UF_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
// <option>s de UF para o select personalizado (busca pelo nome do estado: "minas" acha MG)
export const ufOptions = (selected) =>
  UFS.map((u) => html`<option value="${u}" data-hint="${UF_NAMES[u]}" data-keywords="${UF_NAMES[u]}" ${u === selected ? 'selected' : ''}>${u}</option>`);
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
export const digits = (v) => String(v ?? '').replace(/\D/g, '');
export const km = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;

// Máscara de CEP enquanto digita: 00000-000
export const maskCep = (v) => {
  const d = digits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

// Distância em linha reta (km) entre dois pontos [lat, lng] — a mesma conta da loja virtual.
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Mensagens amigáveis para as travas e restrições da tabela stores.
const CHECKS = {
  stores_whatsapp_check: 'WhatsApp inválido: use 55 + DDD + número (12 ou 13 dígitos).',
  stores_cep_check: 'CEP inválido: informe os 8 dígitos.',
  stores_slug_check: 'Endereço da loja virtual inválido: use letras minúsculas, números e hífens.',
  stores_state_check: 'UF inválida: use a sigla do estado com 2 letras.',
  stores_lat_check: 'Latitude inválida (deve ficar entre -90 e 90).',
  stores_lng_check: 'Longitude inválida (deve ficar entre -180 e 180).',
  stores_delivery_radius_km_check: 'O raio de entrega deve ser maior que 0 e de no máximo 500 km.',
  stores_pix_key_type_check: 'Tipo de chave PIX inválido.',
  stores_payment_methods_check: 'Forma de pagamento inválida.',
  stores_pix_discount_pct_check: 'O desconto no PIX deve ficar entre 0% e 50%.',
  stores_max_installments_check: 'O número máximo de parcelas deve ficar entre 1 e 24.',
  stores_min_installment_value_check: 'A parcela mínima não pode ser negativa.',
  stores_free_shipping_min_check: 'O valor para frete grátis não pode ser negativo.',
  stores_min_order_value_check: 'O pedido mínimo não pode ser negativo.',
};

export function storeError(err) {
  const rawErr = err?.raw || err || {};
  const msg = `${rawErr.message || ''} ${rawErr.details || ''} ${err?.message || ''}`;
  if (/Somente a administra[çc][ãa]o da rede/i.test(msg)) {
    return new Error('Somente a administração da rede pode alterar o endereço da loja virtual, a marca, a ordem ou a ativação da loja.');
  }
  const r = msg.match(/raio de entrega n[ãa]o pode passar de ([\d.,]+) km/i);
  if (r) return new Error(`O raio de entrega não pode passar do limite da rede (${km(r[1])} km). Reduza o raio em Entrega para salvar.`);
  for (const [name, text] of Object.entries(CHECKS)) if (msg.includes(name)) return new Error(text);
  if (rawErr.code === '23505' && /slug/i.test(msg)) return new Error('Já existe uma loja com este endereço na loja virtual. Escolha outro.');
  if (rawErr.code === '23503') return new Error('Esta loja tem pedidos ligados a ela e não pode ser excluída. Desative a loja em vez de excluir.');
  if (rawErr.code === 'PGRST116') return new Error('Não foi possível salvar: a loja não foi encontrada ou você não tem permissão para alterá-la.');
  return err instanceof Error ? err : new Error(String(err?.message || err || 'Erro inesperado.'));
}

/* ---------- Mapa (Leaflet, window.L) ---------- */
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
export const MG_CENTER = [-20.2, -42.9];
export const hasLeaflet = () => typeof window.L?.map === 'function';

export function baseMap(el, options = {}) {
  const L = window.L;
  const map = L.map(el, { scrollWheelZoom: false, ...options });
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  return map;
}

// Marcador em forma de pino com a cor da marca (não depende das imagens do Leaflet).
export function pinIcon(color = '#e01b26') {
  return window.L.divIcon({
    className: 'atual-pin',
    html: `<svg viewBox="0 0 24 34" width="28" height="40" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.8 0 20.6 12 34 12 34s12-13.4 12-22.2C24 5.3 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="11.8" r="4.6" fill="#fff"/></svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  });
}

// Pino com a sigla da loja (PN, TX, AV…), nas cores da marca e do tema.
export function markPin(store, { active = true } = {}) {
  const box = document.createElement('span');
  render(box, storeMark(store, 30));
  return window.L.divIcon({
    className: `stx-pin ${active ? '' : 'is-off'}`,
    html: `<span class="stx-pin__in">${box.innerHTML}</span><span class="stx-pin__tail"></span>`,
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -40],
  });
}

// Círculo do raio: cores vêm do CSS (.stx-radius), que acompanha o tema.
export const radiusStyle = (active = true) => ({
  className: `stx-radius ${active ? '' : 'is-off'}`,
  color: active ? '#e01b26' : '#8a8a8a',
  weight: 1.5,
  opacity: 0.75,
  fillColor: active ? '#e01b26' : '#8a8a8a',
  fillOpacity: active ? 0.08 : 0.05,
  dashArray: active ? null : '5 5',
});

// CSS do mapa compartilhado pelos dois módulos (pinos, raio, balões).
export const MAP_CSS = `
.atual-pin { background: none; border: 0; }
.atual-pin svg { filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35)); }
.stx-pin { background: none; border: 0; }
.stx-pin__in { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--raised); box-shadow: 0 0 0 2px var(--accent), 0 6px 14px -4px rgba(30, 20, 10, 0.45); }
.stx-pin__in .smark { border-radius: 9px !important; }
.stx-pin__tail { position: absolute; left: 50%; bottom: 0; width: 10px; height: 10px; margin-left: -5px; background: var(--accent); clip-path: polygon(0 0, 100% 0, 50% 100%); }
.stx-pin.is-off .stx-pin__in { box-shadow: 0 0 0 2px var(--faint), 0 6px 14px -4px rgba(30, 20, 10, 0.35); filter: grayscale(0.85); opacity: 0.9; }
.stx-pin.is-off .stx-pin__tail { background: var(--faint); }
.stx-pin:focus-visible { outline: none; }
.stx-pin:focus-visible .stx-pin__in { outline: 2px solid var(--focus); outline-offset: 3px; }
path.stx-radius { stroke: var(--chart-main); fill: var(--chart-main); }
path.stx-radius.is-off { stroke: var(--faint); fill: var(--faint); }
path.stx-radius.is-sim { stroke: var(--highlight); fill: var(--highlight); }
.stx-dot { width: 14px !important; height: 14px !important; margin: -7px 0 0 -7px !important; border-radius: 50%; background: var(--highlight); box-shadow: 0 0 0 3px var(--raised), 0 2px 6px rgba(0, 0, 0, 0.35); }
.map .leaflet-container, .leaflet-container { font-family: var(--font-ui); }
.map .leaflet-popup-content-wrapper { border-radius: 14px; background: var(--raised); color: var(--text); box-shadow: var(--sh-pop); }
.map .leaflet-popup-tip { background: var(--raised); box-shadow: none; }
.map .leaflet-popup-content { margin: 14px 16px; font-size: 13px; line-height: 1.45; }
.map .leaflet-popup-close-button { color: var(--muted) !important; }
.map .leaflet-control-attribution { background: color-mix(in srgb, var(--raised) 86%, transparent); color: var(--muted); }
.map .leaflet-control-attribution a { color: var(--accent-ink); }
`;

// Último recurso quando a função "geocode" não localiza (ex.: OpenStreetMap indisponível para o servidor):
// consulta o OpenStreetMap direto do navegador. Uso baixo: só em ações explícitas do painel.
async function osmLookup({ street = '', number = '', city = '', state = '' }) {
  if (!city) return null;
  const st = UF_NAMES[state] || state || '';
  const tries = [];
  if (street) tries.push({ params: { street: number ? `${number} ${street}` : street, city, state: st }, precision: number ? 'address' : 'street' });
  tries.push({ params: { city, state: st }, precision: 'city' });
  for (const t of tries) {
    try {
      const qs = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', ...t.params });
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const d = await r.json();
      const lat = Number(d?.[0]?.lat);
      const lng = Number(d?.[0]?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, precision: t.precision, source: 'osm', address: null };
    } catch {
      /* tenta a próxima forma */
    }
  }
  return null;
}

// Coordenadas de um endereço: função "geocode" (CEP/endereço) e, se falhar e houver cidade, o OpenStreetMap.
export async function geocodeAddress(body, { fallback = true } = {}) {
  let firstError = null;
  try {
    const r = await fn('geocode', body);
    if (Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lng))) return { ...r, lat: Number(r.lat), lng: Number(r.lng) };
  } catch (e) {
    firstError = e;
  }
  if (fallback && body.city) {
    const r = await osmLookup(body);
    if (r) return r;
  }
  throw firstError || new Error('Não conseguimos localizar este endereço.');
}

export const GEO_PRECISION = {
  address: 'Localização pelo endereço com número.',
  street: 'Localização aproximada pela rua: confira o marcador.',
  cep: 'Localização aproximada pelo CEP: confira o marcador.',
  city: 'Localização aproximada pelo centro da cidade: arraste o marcador até a loja.',
};

/* ---------- Validações ---------- */
export function normalizeWhatsapp(v) {
  let d = digits(v);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
export const whatsappOk = (d) => /^55\d{10,11}$/.test(d);
export const fmtWhatsapp = (d) => (whatsappOk(d) ? `+55 ${fmtPhone(d.slice(2))}` : d || '');

function cpfOk(v) {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
function cnpjOk(v) {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, x, i) => acc + x * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

const PIX_TYPES = [
  ['cpf', 'CPF', 'account', '000.000.000-00'],
  ['cnpj', 'CNPJ', 'store', '00.000.000/0000-00'],
  ['email', 'E-mail', 'mail', 'financeiro@loja.com.br'],
  ['telefone', 'Celular', 'phone', '(31) 99999-9999'],
  ['aleatoria', 'Chave aleatória', 'key', '123e4567-e89b-12d3-a456-426614174000'],
];
const PIX_PLACEHOLDER = Object.fromEntries([...PIX_TYPES.map((t) => [t[0], t[3]]), ['', 'Escolha o tipo da chave']]);

function normalizePix(type, key) {
  const k = String(key || '').trim();
  switch (type) {
    case 'cpf':
      return cpfOk(k) ? { value: digits(k) } : { error: 'CPF inválido.' };
    case 'cnpj':
      return cnpjOk(k) ? { value: digits(k) } : { error: 'CNPJ inválido.' };
    case 'email':
      return EMAIL_RE.test(k) ? { value: k.toLowerCase() } : { error: 'E-mail inválido.' };
    case 'telefone': {
      let d = digits(k);
      if (d.length === 10 || d.length === 11) d = `55${d}`;
      return /^55\d{10,11}$/.test(d) ? { value: `+${d}` } : { error: 'Informe DDD + número (ex.: 31 99999-9999).' };
    }
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)
        ? { value: k.toLowerCase() }
        : { error: 'Chave aleatória inválida (formato 8-4-4-4-12).' };
    default:
      return { error: 'Escolha o tipo da chave.' };
  }
}

const urlOk = (s) => {
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.');
  } catch {
    return false;
  }
};
// "@loja", "loja" ou "instagram.com/loja" → URL completa
function socialUrl(v, base) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(www\.|m\.)?(instagram|facebook|fb)\.com\//i.test(s)) return `https://${s}`;
  const handle = s.replace(/^@/, '').replace(/\/+$/, '');
  if (/^[\w.-]+$/.test(handle)) return `${base}${handle}/`;
  return s;
}
// "https://www.instagram.com/loja/" → "@loja" (só para a prévia)
const socialHandle = (u) => {
  const m = String(u || '').match(/(?:instagram|facebook|fb)\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : String(u || '').replace(/^https?:\/\//, '');
};

const numOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/* =========================================================
   Estilos do módulo (só o que é desta tela; o resto vem do admin.css)
   ========================================================= */
const CSS = `
.stc { display: flex; flex-direction: column; gap: 18px; }
.stc > div:empty { display: none; }
.stc a:not(.btn) { text-underline-offset: 2px; }
.stc-hero { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px 18px; align-items: center; padding: 18px 20px; }
.stc-hero__mark .smark { box-shadow: inset 0 0 0 1px var(--mark-atual-line), var(--sh-1); }
.stc-hero__name { font: 800 21px/1.15 var(--font-display); letter-spacing: -0.01em; color: var(--ink); overflow-wrap: anywhere; }
.stc-hero__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; font-size: 13px; color: var(--muted); }
.stc-hero__meta a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent-ink); font-weight: 500; }
.stc-hero__meta .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
.stc-hero__badges { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.stc-hero__todo { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; padding-top: 14px; border-top: 1px dashed var(--line-strong); }
.stc-prog { display: flex; align-items: center; gap: 10px; min-width: 210px; font-size: 13px; color: var(--text); }
.stc-prog strong { color: var(--ink); font-weight: 600; white-space: nowrap; }
.stc-prog .meter { width: 110px; flex: none; }
.stc-prog--ok { color: var(--ok-fg); font-weight: 600; }
.stc-prog--ok .icon-sm { color: var(--ok-dot); }
.stc-todo { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.stc-todo .chip { height: 28px; gap: 6px; }
.stc-todo .chip .icon-xs { color: var(--highlight-ink); }
.stc-block { display: flex; gap: 12px; align-items: flex-start; }
.stc-block > .icon { color: var(--warn-fg); margin-top: 2px; flex: none; }
.stc-block strong { display: block; margin-bottom: 2px; }
.stc-tabs { margin-bottom: -4px; }
:root.ui-lowfx .stc-tabs { background: var(--surface); }
@media (prefers-reduced-transparency: reduce) { .stc-tabs { background: var(--surface); } }
.stc-tabs .ptab .icon-sm { width: 15px; height: 15px; }
.stc-sec { scroll-margin-top: calc(var(--topbar-h) + 72px); }
.stc-sec__grid { display: grid; grid-template-columns: minmax(0, 1fr) 356px; gap: 18px; align-items: start; }
.stc-sec__grid--wide { grid-template-columns: minmax(0, 1fr); }
.stc-side { display: flex; flex-direction: column; gap: 14px; position: sticky; top: calc(var(--topbar-h) + 70px); min-width: 0; }
.stc-card__head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 4px; }
.stc-card__ico { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 12px; background: var(--surface-3); color: var(--ink); }
.stc-card__ico .icon { width: 19px; height: 19px; }
.stc-card__title { display: flex; align-items: center; gap: 8px; font: 800 19px/1.2 var(--font-display); letter-spacing: -0.01em; color: var(--ink); }
.stc-card__head p { margin-top: 2px; font-size: 13px; color: var(--muted); }
.stc-card__head .ptab__dot { margin-left: 2px; }
.stc-card__body { padding: 18px 20px 22px; }
.stc-card .fieldset > legend { float: left; width: 100%; padding: 0; }
.stc-card .fieldset > legend ~ * { clear: left; }
.stc-card .stack > .fieldset { margin-top: 0; padding-top: 22px; border-top: 1px solid var(--line); }
.stc-card .stack > .fieldset:first-child { padding-top: 0; border-top: 0; }
.stc-card .fieldset__title { display: flex; align-items: center; gap: 8px; }
.stc-card .fieldset__title .icon-sm { color: var(--muted); }
.stc-card .fieldset > p.muted { margin: -4px 0 12px; font-size: 13px; }
.stc-ro { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-3); color: var(--text); overflow-wrap: anywhere; font-size: 14px; }
.stc-ro > .icon-sm { color: var(--muted); flex: none; }
.stc-ro .btn { margin-left: auto; }
.stc-ro--link a { font-family: var(--font-mono); font-size: 13px; }
.stc-note { font-size: 12.5px; color: var(--muted); }
.stc-note--ok { color: var(--ok-fg); }
.stc-note--warn { color: var(--warn-fg); }
.stc-note:empty { display: none; }
.stc-pcard { overflow: hidden; }
.stc-pcard__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 0; }
.stc-pcard__head .overline { display: inline-flex; align-items: center; gap: 6px; }
.stc-pcard__body { padding: 12px 16px 16px; }
/* Dados → prévia de contato */
.stc-contact { display: flex; flex-direction: column; gap: 10px; }
.stc-contact__who { display: flex; gap: 10px; align-items: center; }
.stc-contact__who strong { display: block; font: 700 15.5px/1.2 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
.stc-contact__who span { font-size: 12.5px; color: var(--muted); }
.stc-contact__list { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--text); }
.stc-contact__list li { display: flex; gap: 8px; align-items: flex-start; min-width: 0; }
.stc-contact__list li > .icon-sm { flex: none; margin-top: 1px; color: var(--muted); }
.stc-contact__list li > span { min-width: 0; overflow-wrap: anywhere; white-space: pre-line; }
.stc-contact__list .is-missing { color: var(--muted); font-style: italic; }
.stc-wa { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; border-radius: 11px; background: #1a7f45; color: #fff; font-weight: 600; font-size: 13.5px; }
.stc-wa.is-off { background: var(--surface-3); color: var(--muted); font-weight: 500; }
/* Endereço */
.stc-addr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 20px; align-items: start; }
.stc-addr__map { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.stc-map { position: relative; z-index: 0; isolation: isolate; }
.stc-map .map { height: 360px; }
.stc-map__hint { position: absolute; right: 10px; top: 10px; z-index: 2; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 20px); padding: 6px 10px; border-radius: 999px; background: color-mix(in srgb, var(--raised) 92%, transparent); box-shadow: var(--sh-pop); font-size: 12px; font-weight: 500; color: var(--text); pointer-events: none; }
.stc-map__hint .icon-xs { color: var(--accent-ink); }
.stc-map-empty { display: grid; place-items: center; gap: 8px; height: 220px; padding: 16px; border: 1px dashed var(--line-strong); border-radius: var(--r-lg); background: var(--surface-2); color: var(--muted); text-align: center; font-size: 13px; }
.stc-coords { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stc-coords .input { font-family: var(--font-mono); font-size: 13px; }
.stc-geo { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
/* Entrega → raio e limite da rede */
.stc-radius { display: flex; flex-direction: column; gap: 10px; }
.stc-radius__row { display: flex; align-items: center; gap: 16px; }
.stc-radius__row .input-group { width: 150px; flex: none; }
.stc-radius__row .input { font: 700 16px/1 var(--font-display); font-variant-numeric: tabular-nums; }
.stc-range { position: relative; flex: 1; min-width: 0; padding: 14px 0 20px; }
.stc-range input[type='range'] { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer; }
.stc-range input[type='range']::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: linear-gradient(90deg, var(--select) 0 var(--fill, 50%), var(--surface-3) var(--fill, 50%) 100%); }
.stc-range input[type='range']::-moz-range-track { height: 6px; border-radius: 999px; background: linear-gradient(90deg, var(--select) 0 var(--fill, 50%), var(--surface-3) var(--fill, 50%) 100%); }
.stc-range input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -7px; border-radius: 50%; background: var(--raised); border: 2px solid var(--select); box-shadow: var(--sh-btn); }
.stc-range input[type='range']::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--raised); border: 2px solid var(--select); box-shadow: var(--sh-btn); }
.stc-range input[type='range']:focus-visible { outline: none; }
.stc-range input[type='range']:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--focus); outline-offset: 2px; }
.stc-range input[type='range']:focus-visible::-moz-range-thumb { outline: 2px solid var(--focus); outline-offset: 2px; }
.stc-range.is-over input[type='range']::-webkit-slider-runnable-track { background: linear-gradient(90deg, var(--select) 0 var(--cap, 50%), var(--warn-dot) var(--cap, 50%) var(--fill, 50%), var(--surface-3) var(--fill, 50%) 100%); }
.stc-range.is-over input[type='range']::-moz-range-track { background: linear-gradient(90deg, var(--select) 0 var(--cap, 50%), var(--warn-dot) var(--cap, 50%) var(--fill, 50%), var(--surface-3) var(--fill, 50%) 100%); }
.stc-range__ends { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; pointer-events: none; }
.stc-range__cap { position: absolute; top: 2px; bottom: 16px; left: var(--cap, 100%); width: 0; pointer-events: none; }
.stc-range__cap::before { content: ''; position: absolute; top: 12px; bottom: 6px; left: -1px; border-left: 2px dashed var(--highlight); }
.stc-range__cap span { position: absolute; top: -6px; left: 0; transform: translateX(-50%); padding: 1px 6px; border-radius: 999px; background: var(--highlight-soft); color: var(--highlight-ink); font: 700 10.5px/1.5 var(--font-ui); white-space: nowrap; }
.stc-range__cap.is-end span { transform: translateX(-100%); }
.stc-cap { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; line-height: 1.45; color: var(--text); }
.stc-cap > .stc-cap__ico { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border-radius: 10px; background: var(--select); color: var(--on-select); }
.stc-cap strong { display: block; color: var(--ink); font-weight: 600; }
.stc-cap.is-over { background: var(--warn-bg); border-color: var(--warn-line); }
.stc-cap.is-over > .stc-cap__ico { background: var(--warn-dot); color: #2a1300; }
.stc-cap a { font-weight: 600; }
/* Faixas de frete */
.stc-tiers { display: flex; flex-direction: column; gap: 8px; }
.stc-tiers__head, .stc-tier { display: grid; grid-template-columns: 128px minmax(0, 1fr) minmax(0, 1fr) 36px; gap: 10px; align-items: start; }
.stc-tiers__head { padding: 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
.stc-tier { padding: 6px; margin: 0 -6px; border-radius: 12px; }
.stc-tier:hover { background: var(--surface-2); }
.stc-tier__range { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-weight: 600; font-size: 13px; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
.stc-tier__range i { width: 10px; height: 10px; border-radius: 3px; background: var(--c, var(--select)); flex: none; }
.stc-tier .btn--icon { margin-top: 4px; }
.stc-tiers__error { font-size: 12.5px; font-weight: 500; color: var(--accent-ink); }
.stc-tiers__error:empty { display: none; }
.stc-tiers__error::before { content: '!'; display: inline-grid; place-items: center; width: 15px; height: 15px; margin-right: 6px; border-radius: 50%; background: var(--accent-ink); color: #fff; font-size: 10.5px; font-weight: 800; vertical-align: 1px; }
/* Prévia da entrega */
.stc-dmap .map { height: 220px; border-radius: 12px; }
.stc-ladder { display: flex; flex-direction: column; gap: 6px; }
.stc-ladder__bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--surface-3); }
.stc-ladder__bar span { display: block; height: 100%; background: var(--c); }
.stc-ladder__bar span + span { box-shadow: inset 2px 0 0 var(--surface); }
.stc-ladder__axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.stc-sum { display: flex; flex-direction: column; }
.stc-sum li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.stc-sum li:last-child { border-bottom: 0; padding-bottom: 0; }
.stc-sum li > span { display: inline-flex; align-items: center; gap: 8px; color: var(--text); }
.stc-sum li > span i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex: none; }
.stc-sum strong { color: var(--ink); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
.stc-sum .is-warn, .stc-sum .is-warn strong { color: var(--warn-fg); }
.stc-sim { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; margin-top: 2px; border-top: 1px dashed var(--line-strong); }
.stc-sim__row { display: flex; gap: 8px; }
.stc-sim__row .input { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
.stc-simres { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 12px; font-size: 13px; line-height: 1.45; }
.stc-simres strong { display: block; font: 700 15px/1.25 var(--font-display); color: var(--ink); }
.stc-simres--ok { background: var(--ok-bg); box-shadow: inset 0 0 0 1px var(--ok-line); color: var(--text); }
.stc-simres--ok .stc-simres__ico { background: var(--ok-dot); color: #fff; }
.stc-simres--out { flex-direction: column; text-align: center; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); color: var(--text); }
.stc-simres--out.is-plain .art, .stc-simres--out.is-plain .art--inline { display: none; }
.stc-simres--err { background: var(--bad-bg); box-shadow: inset 0 0 0 1px var(--bad-line); color: var(--bad-fg); }
.stc-simres__ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; flex: none; }
.stc-simres .art { max-width: 160px; height: auto; }
/* Pagamento */
.stc-pm { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 10px; }
.stc-pm__card { position: relative; display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--raised); box-shadow: var(--sh-btn); cursor: pointer; transition: border-color var(--dur-1), box-shadow var(--dur-1), background-color var(--dur-1); }
.stc-pm__card:hover { border-color: var(--ink); }
.stc-pm__card input { position: absolute; top: 12px; right: 12px; }
.stc-pm__ico { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--surface-3); color: var(--muted); }
.stc-pm__txt { min-width: 0; padding-right: 24px; }
.stc-pm__txt strong { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink); }
.stc-pm__txt span { font-size: 12px; color: var(--muted); line-height: 1.35; }
.stc-pm__card:has(input:checked) { border-color: var(--select); box-shadow: inset 0 0 0 1px var(--select), var(--sh-btn); background: var(--row-selected); }
.stc-pm__card:has(input:checked) .stc-pm__ico { background: var(--select); color: var(--on-select); }
.stc-pm__card:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.stc-price { display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
.stc-price__pix { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
.stc-price__pix strong { font: 800 28px/1.05 var(--font-display); letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.stc-price__pix span { font-size: 13px; color: var(--muted); }
.stc-price__alt { font-size: 13px; color: var(--text); }
.stc-price__alt b { font-weight: 600; color: var(--ink); }
.stc-methods { display: flex; flex-wrap: wrap; gap: 6px; }
.stc-methods .tag .icon-xs { color: var(--muted); }
/* Horários e pedidos */
.stc-switch-row { padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
.stc-switch-row + .stc-switch-row { margin-top: 12px; }
.stc-switch-row .field { margin-top: 14px; }
.stc-status { display: flex; flex-direction: column; gap: 12px; }
.stc-status__now { display: flex; gap: 12px; align-items: center; }
.stc-status__ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; flex: none; }
.stc-status__ico.t-ok { background: var(--ok-bg); color: var(--ok-fg); }
.stc-status__ico.t-warn { background: var(--warn-bg); color: var(--warn-fg); }
.stc-status__ico.t-neu { background: var(--neu-bg); color: var(--neu-fg); }
.stc-status__now strong { display: block; font: 700 15.5px/1.25 var(--font-display); color: var(--ink); }
.stc-status__now span { font-size: 12.5px; color: var(--muted); }
.stc-closed { padding: 12px 14px; border-radius: 12px; background: var(--warn-bg); box-shadow: inset 0 0 0 1px var(--warn-line); font-size: 13px; color: var(--text); }
.stc-closed strong { display: block; color: var(--warn-fg); font-weight: 600; margin-bottom: 2px; }
.stc-hours { white-space: pre-line; font-size: 13px; color: var(--text); }
/* Aparência */
.stc-marq { display: flex; flex-direction: column; gap: 8px; }
.stc-marq__row { display: flex; gap: 8px; align-items: flex-start; }
.stc-marq__row .field { flex: 1; min-width: 0; }
.stc-marq__n { display: grid; place-items: center; width: 26px; height: 40px; flex: none; font: 700 12px/1 var(--font-ui); color: var(--muted); font-variant-numeric: tabular-nums; }
.stc-marq__row .btn--icon { margin-top: 4px; }
.stc-sf { overflow: hidden; border-radius: 14px; border: 1px solid var(--line); background: var(--raised); }
.stc-sf__top { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.stc-sf__brand { font: 800 16px/1.1 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
.stc-sf__store { font-size: 12px; color: var(--muted); }
.stc-sf__url { margin-left: auto; font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stc-sf__strip { display: flex; gap: 14px; overflow: hidden; padding: 9px 14px; background: var(--navy); color: #f9f1e6; font-size: 12px; font-weight: 600; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 82%, transparent); mask-image: linear-gradient(90deg, #000 82%, transparent); }
.stc-sf__strip span::before { content: '✦'; margin-right: 14px; color: #f7a463; }
.stc-sf__strip span:first-child::before { content: none; }
.stc-sf__foot { padding: 8px 14px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); background: var(--surface-2); }
.stc-slug-ok { color: var(--ok-fg); }
.stc-slug-bad { color: var(--accent-ink); }
.stc-inl { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 1279px) {
  .stc-sec__grid { grid-template-columns: minmax(0, 1fr) 320px; }
  .stc-addr { grid-template-columns: minmax(0, 1fr); }
  .stc-map .map { height: 320px; }
}
@media (max-width: 1100px) {
  .stc-sec__grid { grid-template-columns: minmax(0, 1fr); }
  .stc-side { position: static; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
}
@media (max-width: 767px) {
  .stc { gap: 14px; }
  .stc-hero { grid-template-columns: auto minmax(0, 1fr); padding: 14px 16px; gap: 12px; }
  .stc-hero__badges { grid-column: 1 / -1; justify-content: flex-start; }
  .stc-hero__name { font-size: 18px; }
  .stc-prog { min-width: 0; width: 100%; }
  .stc-prog .meter { flex: 1; width: auto; }
  .stc-tabs { top: calc(var(--appbar-h, 52px) + env(safe-area-inset-top) + 6px); margin-left: -4px; margin-right: -4px; }
  .stc-sec { scroll-margin-top: calc(var(--appbar-h, 52px) + 64px); }
  .stc-side { display: flex; }
  .stc-card__head { padding: 14px 16px 2px; }
  .stc-card__body { padding: 14px 16px 18px; }
  .stc-card__title { font-size: 17px; }
  .stc-map .map { height: 280px; }
  .stc-radius__row { flex-direction: column; align-items: stretch; gap: 4px; }
  .stc-radius__row .input-group { width: 100%; }
  .stc-tiers__head { display: none; }
  .stc-tier { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px; margin: 0; padding: 10px; border: 1px solid var(--line); background: var(--surface-2); }
  .stc-tier__range { grid-column: 1 / -1; min-height: 0; }
  .stc-tier [data-pre] { display: none; }
  .stc-tier [data-pre] + .input { border-radius: var(--r-md) 0 0 var(--r-md); }
  .stc-map__hint { max-width: calc(100% - 70px); white-space: normal; border-radius: 12px; }
  .stc-pm { grid-template-columns: minmax(0, 1fr); }
}
`;

const SECTIONS = [
  { id: 'dados', label: 'Dados', title: 'Dados da loja', icon: 'store', sub: 'Nome e contatos que aparecem na loja virtual.' },
  { id: 'endereco', label: 'Endereço', title: 'Endereço e mapa', icon: 'mapPin', sub: 'O raio de entrega é medido a partir do ponto marcado no mapa.' },
  { id: 'entrega', label: 'Entrega', title: 'Entrega e frete', icon: 'truck', sub: 'Até onde a loja entrega e quanto cobra de frete.' },
  { id: 'pagamento', label: 'Pagamento', title: 'Pagamento', icon: 'wallet', sub: 'Formas aceitas, chave PIX e parcelamento.' },
  { id: 'funcionamento', label: 'Horários', title: 'Horários e pedidos', icon: 'clock', sub: 'Quando a loja atende e se recebe pedidos pelo site.' },
  { id: 'aparencia', label: 'Aparência', title: 'Aparência', icon: 'palette', sub: 'Marca, endereço na loja virtual e faixa de avisos da página inicial.' },
];
const TITLE = 'Dados da loja';
const METHODS = ['pix', 'card_on_delivery', 'cash', 'crediario', 'card_link'];
const METHOD_HINT = {
  pix: 'Mostra o preço com desconto no PIX',
  card_on_delivery: 'Maquininha na entrega',
  cash: 'Pagamento em espécie na entrega',
  crediario: 'Carnê ou crediário próprio da loja',
  card_link: 'Link de pagamento enviado pela loja',
};
const TIER_COLORS = ['var(--select)', 'var(--highlight)', 'var(--chart-main)', 'var(--cat-4)', 'var(--plum-dot)', 'var(--info-dot)', 'var(--ok-dot)', 'var(--warn-dot)', 'var(--chart-prev)', 'var(--bad-dot)'];
const MARQUEE_MAX = 12;
const MARQUEE_LEN = 70;
const WA_HINT = 'Com DDD. O código do país (55) entra automaticamente.';

/* ---------- Campo de formulário com id próprio do módulo ---------- */
function fld({ label, name, value = '', type = 'text', cls = 'col-6', hint = '', required = false, attrs = '', addon = '', addonEnd = '', disabled = false, placeholder = '', textarea = false, opt = false }) {
  const id = `st-${name}`;
  const described = hint ? raw(`aria-describedby="${id}-hint"`) : '';
  const input = textarea
    ? html`<textarea class="textarea" id="${id}" name="${name}" placeholder="${placeholder}" ${disabled ? 'disabled' : ''} ${described} ${raw(attrs)}>${value ?? ''}</textarea>`
    : html`<input class="input" id="${id}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''} ${described} ${raw(attrs)}>`;
  return html`<div class="field ${cls}">
    <label for="${id}">${label}${required ? ' *' : ''}${opt ? html` <span class="opt-tag">opcional</span>` : ''}</label>
    ${addon || addonEnd
      ? html`<div class="input-group">${addon ? html`<span class="input-group__addon">${addon}</span>` : ''}${input}${addonEnd ? html`<span class="input-group__addon">${addonEnd}</span>` : ''}</div>`
      : input}
    ${hint ? html`<span class="hint" id="${id}-hint">${hint}</span>` : ''}
  </div>`;
}

const tierRangeLabel = (prev, cur) => {
  if (!Number.isFinite(cur) || cur <= 0) return '—';
  return prev > 0 ? `${km(prev)} a ${km(cur)} km` : `Até ${km(cur)} km`;
};

/* =========================================================
   Módulo
   ========================================================= */
export default {
  title: TITLE,
  async render(view, ctx) {
    injectStyle('store-map', MAP_CSS);
    injectStyle('store', CSS);
    if (!ctx.storeId) return ctx.pickStore(view, 'Esta área configura uma loja específica.');
    const short = ctx.storeShort?.(ctx.store) || ctx.store?.name || '';
    if (!ctx.can('settings')) {
      render(
        view,
        empty('Esta área é do administrador da loja', `Os dados de ${short} são alterados pelo administrador da loja. Fale com ele se precisar mudar algo.`, html`<a class="btn" href="#/dashboard">${icon('dashboard', 'icon-sm')} Voltar ao Painel</a>`, {
          art: 'no-access',
          size: 'lg',
        })
      );
      return;
    }
    const isGlobal = ctx.isGlobal;
    ctx.setTitle(TITLE, `Dados, entrega e pagamento de ${short}`, isGlobal ? { crumbs: [['Lojas', '#/stores'], [short]] } : {});
    render(view, html`<div class="stc">${skeleton('form', { rows: 2 })}${skeleton('form', { rows: 5 })}</div>`);

    let store;
    let net = {};
    try {
      const [s, n] = await Promise.all([
        q(sb.from('stores').select('*').eq('id', ctx.storeId).single()),
        sb
          .from('network_settings')
          .select('default_radius_km, marquee')
          .maybeSingle()
          .then((r) => r.data)
          .catch(() => null),
      ]);
      store = s;
      net = n || {};
    } catch (e) {
      if (!view.isConnected) return;
      render(view, errorBlock(storeError(e), { retry: () => ctx.navigate(location.hash) }));
      return;
    }
    if (!view.isConnected) return;
    const maxRadius = Number(net.default_radius_km) || 30;
    const netMarquee = Array.isArray(net.marquee) ? net.marquee.map(String).filter(Boolean) : [];
    const maps = {};
    let tiers = [];
    let marquee = [];
    let bar = null;
    const saved = {}; // seção → valores salvos (para saber o que mudou)
    const savedField = new Map(); // nome do campo → valor salvo (marca o campo alterado)
    let simPoint = null;

    const href = () => storefrontUrl(store.slug);
    const drawActions = () =>
      ctx.setActions(
        html`<a class="btn" href="${href()}" target="_blank" rel="noopener" data-store-link>${icon('external', 'icon-sm')}<span>Ver loja virtual</span></a>`
      );
    drawActions();

    render(
      view,
      html`<div class="stc">
        <section class="card stc-hero" data-hero aria-label="Resumo da loja"></section>
        <div data-alerts></div>
        <div data-tip></div>
        <nav class="ptabs stc-tabs" aria-label="Seções dos dados da loja" data-ptabs>${SECTIONS.map(
          (s) => html`<a class="ptab" href="#/store/${s.id}" data-ptab="${s.id}">${icon(s.icon, 'icon-sm')}${s.label}<span class="ptab__dot" data-dot hidden aria-hidden="true"></span><span class="visually-hidden" data-dot-sr hidden> (alterado)</span></a>`
        )}</nav>
        <form class="stc-form stack" style="--gap:18px" data-form novalidate>
          ${SECTIONS.map(
            (s) => html`<section class="stc-sec" id="stc-${s.id}" data-sec="${s.id}" aria-labelledby="stc-${s.id}-t"></section>`
          )}
        </form>
      </div>`
    );
    const form = $('form[data-form]', view);
    const secEl = (id) => $(`[data-sec="${id}"]`, view);

    // Cabeçalho de cada seção (cartão principal); o corpo e a coluna da direita vêm de cada desenho.
    const secShell = (s, body, side, { wide = false } = {}) => html`<div class="stc-sec__grid ${wide || !side ? 'stc-sec__grid--wide' : ''}">
      <div class="card stc-card">
        <header class="stc-card__head">
          <span class="stc-card__ico" aria-hidden="true">${icon(s.icon)}</span>
          <div class="grow"><h2 class="stc-card__title" id="stc-${s.id}-t">${s.title}<span class="ptab__dot" data-sec-dot hidden aria-hidden="true"></span></h2><p>${s.sub}</p></div>
        </header>
        <div class="stc-card__body">${body}</div>
      </div>
      ${side ? html`<aside class="stc-side" aria-label="Prévia: ${s.title}">${side}</aside>` : ''}
    </div>`;

    /* ---------- Resumo e pendências ---------- */
    function checklist() {
      const s = store;
      const items = [
        { ok: !!s.whatsapp, label: 'WhatsApp', sec: 'dados', field: 'whatsapp' },
        { ok: !!(s.street && s.number), label: 'Endereço', sec: 'endereco', field: 'street' },
        { ok: s.lat != null && s.lng != null, label: 'Localização no mapa', sec: 'endereco', field: 'lat' },
        { ok: !(s.payment_methods || []).includes('pix') || !!s.pix_key, label: 'Chave PIX', sec: 'pagamento', field: 'pix_key' },
        { ok: !!s.notify_email, label: 'E-mail de avisos', sec: 'dados', field: 'notify_email' },
        { ok: !!String(s.hours || '').trim(), label: 'Horário', sec: 'funcionamento', field: 'hours' },
      ];
      return items;
    }
    function drawHero() {
      const s = store;
      const list = checklist();
      const done = list.filter((x) => x.ok).length;
      const pend = list.filter((x) => !x.ok);
      render(
        $('[data-hero]', view),
        html`<span class="stc-hero__mark">${storeMark(s, 52)}</span>
          <div class="grow" style="min-width:0">
            <div class="stc-hero__name">${s.name}</div>
            <div class="stc-hero__meta">
              <span>${s.city}/${s.state}</span><span class="sep" aria-hidden="true"></span><span>${s.brand_name}</span><span class="sep" aria-hidden="true"></span>
              <a href="${href()}" target="_blank" rel="noopener" data-store-link>/loja/${s.slug}${icon('external', 'icon-xs')}<span class="visually-hidden"> (abre em nova aba)</span></a>
            </div>
          </div>
          <div class="stc-hero__badges">
            ${s.active ? badge('Ativa na loja virtual', 'success') : badge('Inativa', 'dark')}
            ${s.accepts_orders ? badge('Recebendo pedidos', 'success') : badge('Pedidos pausados', 'warning')}
            ${s.lat != null && s.lng != null ? badge(`Entrega em ${km(s.delivery_radius_km)} km`, 'info') : badge('Sem localização', 'warning')}
          </div>
          <div class="stc-hero__todo">
            ${pend.length
              ? html`<div class="stc-prog"><strong>Cadastro ${done} de ${list.length}</strong><span class="meter meter--solid" role="img" aria-label="${done} de ${list.length} itens completos"><span style="width:${Math.round((done / list.length) * 100)}%"></span></span></div>
                  <div class="stc-todo"><span>Falta:</span>${pend.map(
                    (x) => html`<button class="chip" type="button" data-goto="${x.sec}" data-goto-field="${x.field}">${icon('plus', 'icon-xs')}${x.label}</button>`
                  )}</div>`
              : html`<div class="stc-prog stc-prog--ok">${icon('checkCircle', 'icon-sm')} Cadastro completo: contatos, endereço, mapa, PIX e horário em dia.</div>`}
          </div>`
      );
    }

    // Raio acima do limite (só a rede consegue isso): a equipe da loja não salva nada até reduzir.
    function drawAlerts() {
      const over = Number(store.delivery_radius_km) > maxRadius;
      render(
        $('[data-alerts]', view),
        over
          ? html`<div class="alert alert--warning stc-block" role="status">${icon('alert')}<div><strong>O raio de entrega (${km(store.delivery_radius_km)} km) passa do limite da rede (${km(maxRadius)} km).</strong>${
              isGlobal
                ? 'A equipe da loja não consegue salvar nenhuma alteração nesta tela enquanto o raio estiver acima do limite.'
                : html`Enquanto o raio estiver acima do limite, nenhuma alteração desta tela é salva. Reduza o raio em <a href="#/store/entrega" data-goto="entrega" data-goto-field="delivery_radius_km">Entrega</a> para até ${km(maxRadius)} km.`
            }</div></div>`
          : ''
      );
    }

    // Uma dica do Tetim por tela, só quando o dado falta (e some por 30 dias ao dispensar).
    function drawTip() {
      const box = $('[data-tip]', view);
      const s = store;
      let t = null;
      const goto = (sec, field) => () => goSection(sec, field);
      if ((s.payment_methods || []).includes('pix') && !s.pix_key)
        t = { id: `store-pix-${s.id}`, text: `${short} ainda não tem chave PIX. Com ela, o cliente paga com ${String(Number(s.pix_discount_pct) || 0).replace('.', ',')}% de desconto e a loja recebe na hora.`, action: { label: 'Cadastrar chave PIX', onClick: goto('pagamento', 'pix_key_type') } };
      else if (s.lat == null || s.lng == null)
        t = { id: `store-loc-${s.id}`, text: `${short} ainda não tem localização no mapa. Com ela, a loja aparece para quem busca pelo CEP e o frete é calculado sozinho.`, action: { label: 'Marcar no mapa', onClick: goto('endereco', 'cep') } };
      else if (!s.whatsapp)
        t = { id: `store-wa-${s.id}`, text: `${short} ainda não tem WhatsApp. Com ele, o cliente tira dúvidas e fecha a compra numa conversa.`, action: { label: 'Cadastrar WhatsApp', onClick: goto('dados', 'whatsapp') } };
      render(box, t ? tip(t) : '');
    }

    /* =====================================================
       Seção: Dados da loja
       ===================================================== */
    function drawDados() {
      const s = store;
      const sec = SECTIONS[0];
      render(
        secEl('dados'),
        secShell(
          sec,
          html`<div class="form-grid">
            ${fld({ label: 'Nome da loja', name: 'name', value: s.name, required: true, cls: 'col-12', attrs: 'maxlength="120" autocomplete="organization"', hint: 'Aparece no topo da loja virtual, nos pedidos e no seletor de lojas.' })}
            ${fld({ label: 'Telefone', name: 'phone', value: s.phone, cls: 'col-6', type: 'tel', placeholder: '(31) 3817-0000', attrs: 'autocomplete="tel" inputmode="tel"', opt: true })}
            ${fld({
              label: 'WhatsApp',
              name: 'whatsapp',
              value: fmtWhatsapp(s.whatsapp),
              cls: 'col-6',
              type: 'tel',
              placeholder: '+55 (31) 99999-9999',
              attrs: 'inputmode="tel" data-wa',
              hint: s.whatsapp ? `Link: wa.me/${s.whatsapp}` : WA_HINT,
            })}
            ${fld({ label: 'E-mail da loja', name: 'email', value: s.email, cls: 'col-6', type: 'email', placeholder: 'contato@loja.com.br', attrs: 'autocomplete="email"', opt: true })}
            ${fld({ label: 'E-mail para avisos de pedido', name: 'notify_email', value: s.notify_email, cls: 'col-6', type: 'email', placeholder: 'pedidos@loja.com.br', hint: 'Recebe um aviso a cada novo pedido feito no site.' })}
            ${fld({ label: 'Instagram', name: 'instagram', value: s.instagram, cls: 'col-6', placeholder: '@sualoja ou link do perfil', attrs: 'autocapitalize="off" spellcheck="false"', opt: true })}
            ${fld({ label: 'Facebook', name: 'facebook', value: s.facebook, cls: 'col-6', placeholder: 'https://facebook.com/sualoja', attrs: 'autocapitalize="off" spellcheck="false"', opt: true })}
          </div>`,
          html`<div class="card stc-pcard"><div class="stc-pcard__head"><span class="overline">${icon('eye', 'icon-xs')} Na loja virtual</span></div><div class="stc-pcard__body" data-contact-preview></div></div>`
        )
      );
      drawContactPreview();
    }

    function drawContactPreview() {
      const el = $('[data-contact-preview]', view);
      if (!el) return;
      const f = form.elements;
      const name = f.name?.value.trim() || store.name;
      const ph = f.phone?.value.trim();
      const wa = normalizeWhatsapp(f.whatsapp?.value || '');
      const mail = f.email?.value.trim();
      const ig = f.instagram?.value.trim();
      const fb = f.facebook?.value.trim();
      const hours = f.hours?.value.trim() ?? store.hours;
      const addr = [f.street?.value.trim(), f.number?.value.trim()].filter(Boolean).join(', ');
      const city = `${f.city?.value.trim() || store.city}/${f.state?.value || store.state}`;
      render(
        el,
        html`<div class="stc-contact">
          <div class="stc-contact__who">${storeMark(store, 40)}<div><strong>${name}</strong><span>${addr ? `${addr} · ` : ''}${city}</span></div></div>
          <span class="stc-wa ${whatsappOk(wa) ? '' : 'is-off'}">${icon('whatsapp', 'icon-sm')} ${whatsappOk(wa) ? 'Falar no WhatsApp' : 'WhatsApp não informado'}</span>
          <ul class="stc-contact__list">
            <li>${icon('phone', 'icon-sm')}<span class="${ph ? '' : 'is-missing'}">${ph || 'Telefone não informado'}</span></li>
            <li>${icon('mail', 'icon-sm')}<span class="${mail ? '' : 'is-missing'}">${mail || 'E-mail não informado'}</span></li>
            ${ig ? html`<li>${icon('link', 'icon-sm')}<span>Instagram ${socialHandle(socialUrl(ig, 'https://www.instagram.com/'))}</span></li>` : ''}
            ${fb ? html`<li>${icon('link', 'icon-sm')}<span>Facebook ${socialHandle(socialUrl(fb, 'https://www.facebook.com/'))}</span></li>` : ''}
            <li>${icon('clock', 'icon-sm')}<span class="${hours ? '' : 'is-missing'}">${hours || 'Horário não informado'}</span></li>
          </ul>
        </div>`
      );
    }

    function buildDados(d, errors) {
      if (!d.name || d.name.length < 3) errors.name = 'Informe o nome da loja (mínimo de 3 letras).';
      const phoneDigits = digits(d.phone);
      if (d.phone && (phoneDigits.length < 10 || phoneDigits.length > 13)) errors.phone = 'Telefone inválido: inclua o DDD.';
      const wa = normalizeWhatsapp(d.whatsapp);
      if (d.whatsapp && !whatsappOk(wa)) errors.whatsapp = 'WhatsApp inválido: DDD + número (ex.: 31 99999-9999).';
      if (d.email && !EMAIL_RE.test(d.email)) errors.email = 'E-mail inválido.';
      if (d.notify_email && !EMAIL_RE.test(d.notify_email)) errors.notify_email = 'E-mail inválido.';
      const instagram = socialUrl(d.instagram, 'https://www.instagram.com/');
      const facebook = socialUrl(d.facebook, 'https://www.facebook.com/');
      if (instagram && !urlOk(instagram)) errors.instagram = 'Informe o @ ou o link do perfil.';
      if (facebook && !urlOk(facebook)) errors.facebook = 'Informe o link da página.';
      return {
        patch: {
          name: d.name,
          phone: d.phone ? fmtPhone(phoneDigits) : null,
          whatsapp: wa || null,
          email: d.email ? d.email.toLowerCase() : null,
          notify_email: d.notify_email ? d.notify_email.toLowerCase() : null,
          instagram,
          facebook,
        },
      };
    }

    /* =====================================================
       Seção: Endereço e mapa
       ===================================================== */
    function drawEndereco() {
      destroyMap('addr');
      const s = store;
      const sec = SECTIONS[1];
      render(
        secEl('endereco'),
        secShell(
          sec,
          html`<div class="stc-addr">
            <div class="form-grid">
              <div class="field col-6">
                <label for="st-cep">CEP</label>
                <div class="input-group">
                  <input class="input" id="st-cep" name="cep" value="${s.cep ? fmtCep(s.cep) : ''}" placeholder="00000-000" inputmode="numeric" autocomplete="postal-code" maxlength="9" data-cep aria-describedby="st-cep-hint">
                  <button class="btn" type="button" data-cep-search>${icon('search', 'icon-sm')} Buscar</button>
                </div>
                <span class="hint" id="st-cep-hint">Preenche a rua e marca o ponto no mapa.</span>
              </div>
              ${fld({ label: 'Número', name: 'number', value: s.number, cls: 'col-6', attrs: 'maxlength="20"' })}
              ${fld({ label: 'Rua ou avenida', name: 'street', value: s.street, cls: 'col-12', attrs: 'maxlength="120" autocomplete="address-line1"' })}
              ${fld({ label: 'Complemento', name: 'complement', value: s.complement, cls: 'col-6', placeholder: 'Loja 2, sala…', attrs: 'maxlength="80"', opt: true })}
              ${fld({ label: 'Bairro', name: 'district', value: s.district, cls: 'col-6', attrs: 'maxlength="80"' })}
              ${fld({ label: 'Cidade', name: 'city', value: s.city, required: true, cls: 'col-8', attrs: 'maxlength="80" autocomplete="address-level2"' })}
              <div class="field col-4">
                <label for="st-state">UF *</label>
                <select class="select" id="st-state" name="state" required data-sheet-title="Estado" data-search-placeholder="Buscar estado…">${ufOptions(s.state)}</select>
              </div>
              <div class="col-12 stc-geo">
                <button class="btn" type="button" data-geo-address>${icon('mapPin', 'icon-sm')} Localizar pelo endereço</button>
                <div class="stc-note" data-geo-note aria-live="polite">${s.lat == null || s.lng == null ? 'A loja ainda não tem localização: busque pelo CEP ou clique no mapa.' : ''}</div>
              </div>
            </div>
            <div class="stc-addr__map">
              <div class="stc-map">
                <div class="map" data-addr-map role="region" aria-label="Mapa: arraste o marcador ou clique para definir a localização da loja"></div>
                <span class="stc-map__hint" aria-hidden="true">${icon('mapPin', 'icon-xs')} Arraste o marcador até a porta da loja</span>
              </div>
              <div class="stc-coords">
                ${fld({ label: 'Latitude', name: 'lat', value: s.lat ?? '', cls: '', type: 'number', attrs: 'step="any" min="-90" max="90" inputmode="decimal" data-type="number" data-coord', placeholder: '-20.414922' })}
                ${fld({ label: 'Longitude', name: 'lng', value: s.lng ?? '', cls: '', type: 'number', attrs: 'step="any" min="-180" max="180" inputmode="decimal" data-type="number" data-coord', placeholder: '-42.899446' })}
              </div>
            </div>
          </div>`,
          null,
          { wide: true }
        )
      );
      ensureAddrMap();
    }

    function setGeoNote(text, tone = '') {
      const el = $('[data-geo-note]', view);
      if (!el) return;
      el.className = `stc-note ${tone ? `stc-note--${tone}` : ''}`;
      el.textContent = text;
    }

    async function geocode(btn, body, { fillAddress }) {
      try {
        // busca pelo CEP é estrita; "Localizar pelo endereço" aceita o OpenStreetMap como reserva
        const r = await withBusy(btn, () => geocodeAddress(body, { fallback: !fillAddress }), 'Buscando…');
        if (!r || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng))) throw new Error('Não conseguimos localizar este endereço.');
        const f = form.elements;
        if (fillAddress && r.address) {
          const a = r.address;
          if (a.street) f.street.value = a.street;
          if (a.district) f.district.value = a.district;
          if (a.city) f.city.value = a.city;
          if (a.state && UFS.includes(String(a.state).toUpperCase())) f.state.value = String(a.state).toUpperCase();
        }
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        f.lat.value = lat.toFixed(6);
        f.lng.value = lng.toFixed(6);
        setAddrPoint(lat, lng, { zoom: r.precision === 'city' ? 13 : 16 });
        setGeoNote(`${GEO_PRECISION[r.precision] || 'Localização encontrada.'} Salve para aplicar.`, r.precision === 'city' || r.precision === 'cep' ? 'warn' : 'ok');
        changed();
        if (fillAddress && !f.number.value) f.number.focus();
      } catch (e) {
        toastError(e);
        setGeoNote(e.message || 'Não conseguimos localizar este endereço.', 'warn');
      }
    }

    function searchCep() {
      const c = digits(form.elements.cep.value);
      if (c.length !== 8) return fieldError('cep', 'CEP incompleto. Use 8 números.');
      clearError('cep');
      geocode($('[data-cep-search]', view), { cep: c, number: form.elements.number.value.trim() }, { fillAddress: true });
    }

    function locateByAddress() {
      const f = form.elements;
      const city = f.city.value.trim();
      if (!city) return fieldError('city', 'Informe a cidade.');
      clearError('city');
      const c = digits(f.cep.value);
      geocode(
        $('[data-geo-address]', view),
        { cep: c.length === 8 ? c : undefined, street: f.street.value.trim(), number: f.number.value.trim(), district: f.district.value.trim(), city, state: f.state.value },
        { fillAddress: false }
      );
    }

    function buildEndereco(d, errors, confirms) {
      const c = digits(d.cep);
      if (d.cep && c.length !== 8) errors.cep = 'CEP incompleto. Use 8 números.';
      if (!d.city) errors.city = 'Informe a cidade.';
      if (!UFS.includes(d.state || '')) errors.state = 'Escolha a UF.';
      const hasLat = d.lat !== null && d.lat !== undefined;
      const hasLng = d.lng !== null && d.lng !== undefined;
      if (hasLat !== hasLng) errors[hasLat ? 'lng' : 'lat'] = 'Informe latitude e longitude juntas.';
      if (hasLat && !(d.lat >= -34 && d.lat <= 6)) errors.lat = 'Latitude fora do Brasil (entre -34 e 6). Confira se não trocou com a longitude.';
      if (hasLng && !(d.lng >= -74 && d.lng <= -34)) errors.lng = 'Longitude fora do Brasil (entre -74 e -34).';
      if (!hasLat && store.lat != null)
        confirms.push({
          title: 'Remover a localização?',
          message: 'Sem localização a loja não calcula o raio de entrega e não aparece para clientes que buscam pelo CEP.',
          confirmLabel: 'Remover localização',
          danger: true,
        });
      return {
        patch: {
          cep: c || null,
          street: d.street,
          number: d.number,
          complement: d.complement,
          district: d.district,
          city: d.city,
          state: d.state,
          lat: hasLat ? d.lat : null,
          lng: hasLng ? d.lng : null,
        },
      };
    }

    /* ---------- Mapas ---------- */
    function destroyMap(key) {
      try {
        maps[key]?.map.stop();
        maps[key]?.map.off();
        maps[key]?.map.remove();
      } catch {
        /* já removido */
      }
      delete maps[key];
    }
    function currentRadius() {
      const v = Number(form.elements.delivery_radius_km?.value);
      return v > 0 ? v : Number(store.delivery_radius_km) || maxRadius;
    }
    function currentPoint() {
      const f = form.elements;
      const lat = numOrNull(f.lat?.value);
      const lng = numOrNull(f.lng?.value);
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
      return store.lat != null && store.lng != null ? [store.lat, store.lng] : null;
    }
    const mapUnavailable = (el, text) => {
      el.classList.remove('map');
      el.classList.add('stc-map-empty');
      render(el, html`<div>${icon('map')}<div>${text}</div></div>`);
    };

    function ensureAddrMap() {
      const el = $('[data-addr-map]', view);
      if (!el || maps.addr) return;
      if (!hasLeaflet()) return mapUnavailable(el, 'Mapa indisponível no momento. Informe a latitude e a longitude abaixo.');
      const map = baseMap(el, { zoomSnap: 0.5 });
      maps.addr = { map, marker: null, circle: null };
      const pt = currentPoint();
      if (pt) {
        map.fitBounds(window.L.latLng(pt).toBounds(currentRadius() * 2000), { padding: [10, 10] });
        setAddrPoint(pt[0], pt[1], { pan: false });
      } else {
        map.setView(MG_CENTER, 7);
      }
      map.on('click', (e) => setAddrPoint(e.latlng.lat, e.latlng.lng, { fromMap: true }));
      setTimeout(() => maps.addr?.map === map && map.invalidateSize(), 80);
    }

    function setAddrPoint(lat, lng, { fromMap = false, pan = true, zoom = null } = {}) {
      const L = window.L;
      const m = maps.addr;
      if (fromMap) {
        form.elements.lat.value = lat.toFixed(6);
        form.elements.lng.value = lng.toFixed(6);
        setGeoNote('Posição ajustada no mapa. Salve para aplicar.', 'ok');
        changed();
      }
      if (m) {
        const ll = [lat, lng];
        if (!m.marker) {
          m.marker = L.marker(ll, { draggable: true, icon: markPin(store), title: 'Localização da loja (arraste para ajustar)', alt: 'Localização da loja', autoPan: true }).addTo(m.map);
          m.marker.on('drag', () => m.circle?.setLatLng(m.marker.getLatLng()));
          m.marker.on('dragend', () => {
            const p = m.marker.getLatLng();
            setAddrPoint(p.lat, p.lng, { fromMap: true, pan: false });
          });
        } else m.marker.setLatLng(ll);
        if (!m.circle) m.circle = L.circle(ll, { radius: currentRadius() * 1000, ...radiusStyle(true), interactive: false }).addTo(m.map);
        else m.circle.setLatLng(ll);
        if (zoom) m.map.setView(ll, zoom, { animate: false });
        else if (pan) m.map.panTo(ll, { animate: false });
      }
      moveDeliveryPoint();
    }

    function ensureDeliveryMap() {
      const el = $('[data-delivery-map]', view);
      if (!el || maps.delivery) return;
      const pt = currentPoint();
      if (!pt) {
        el.classList.remove('map');
        el.classList.add('stc-map-empty');
        render(el, html`<div>${icon('mapPin')}<div>Sem localização definida.</div><button class="btn btn--sm" type="button" data-goto="endereco" data-goto-field="cep">Marcar no mapa</button></div>`);
        return;
      }
      if (!hasLeaflet()) return mapUnavailable(el, 'Mapa indisponível no momento.');
      const L = window.L;
      const map = baseMap(el, { zoomControl: true, zoomSnap: 0.25, attributionControl: true });
      const fit = () => {
        const p = currentPoint() || pt;
        map.fitBounds(L.latLng(p).toBounds(currentRadius() * 2000), { padding: [10, 10], animate: false });
      };
      fit();
      const marker = L.marker(pt, { icon: markPin(store), interactive: false, keyboard: false }).addTo(map);
      const circle = L.circle(pt, { radius: currentRadius() * 1000, ...radiusStyle(true), interactive: false }).addTo(map);
      maps.delivery = { map, marker, circle, fit, sim: null };
      setTimeout(() => {
        if (maps.delivery?.map !== map) return;
        map.invalidateSize();
        fit();
      }, 80);
    }
    function moveDeliveryPoint() {
      const m = maps.delivery;
      const pt = currentPoint();
      if (!m) {
        if (pt && $('[data-delivery-map].stc-map-empty', view)) {
          const el = $('[data-delivery-map]', view);
          el.className = 'map';
          el.textContent = '';
          ensureDeliveryMap();
        }
        return;
      }
      if (!pt) return;
      m.marker.setLatLng(pt);
      m.circle.setLatLng(pt);
      m.fit();
    }

    function updateRadius() {
      const r = currentRadius() * 1000;
      maps.addr?.circle?.setRadius(r);
      if (maps.delivery) {
        maps.delivery.circle.setRadius(r);
        maps.delivery.fit();
      }
    }

    /* =====================================================
       Seção: Entrega
       ===================================================== */
    function tierRows() {
      return tiers.map((t, i) => {
        const prev = i > 0 ? Number(tiers[i - 1].up_to_km) : 0;
        return html`<li class="stc-tier" data-tier="${i}">
          <span class="stc-tier__range"><i style="--c:${TIER_COLORS[i % TIER_COLORS.length]}" aria-hidden="true"></i><span data-tier-range>${tierRangeLabel(prev, Number(t.up_to_km))}</span></span>
          <div class="field">
            <label class="visually-hidden" for="st-tier-km-${i}">Faixa ${i + 1}: distância máxima em km</label>
            <div class="input-group"><span class="input-group__addon" data-pre>até</span><input class="input" id="st-tier-km-${i}" name="tier_km_${i}" type="number" min="0.1" step="0.1" inputmode="decimal" value="${t.up_to_km ?? ''}" data-tier-km><span class="input-group__addon">km</span></div>
          </div>
          <div class="field">
            <label class="visually-hidden" for="st-tier-fee-${i}">Faixa ${i + 1}: valor do frete em reais</label>
            <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="st-tier-fee-${i}" name="tier_fee_${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${Number.isFinite(Number(t.fee)) && t.fee !== null ? Number(t.fee).toFixed(2) : ''}" data-tier-fee></div>
          </div>
          <button class="btn btn--ghost btn--icon" type="button" data-tier-remove="${i}" aria-label="Remover faixa ${i + 1}" data-tooltip="Remover faixa" ${tiers.length <= 1 ? 'disabled' : ''}>${icon('trash', 'icon-sm')}</button>
        </li>`;
      });
    }

    function drawEntrega() {
      destroyMap('delivery');
      const s = store;
      const sec = SECTIONS[2];
      tiers = [...(s.delivery_fee_tiers || [])].map((t) => ({ up_to_km: Number(t.up_to_km), fee: Number(t.fee) })).sort((a, b) => a.up_to_km - b.up_to_km);
      if (!tiers.length) tiers = [{ up_to_km: Number(s.delivery_radius_km) || maxRadius, fee: 0 }];
      const radius = Number(s.delivery_radius_km) || maxRadius;
      render(
        secEl('entrega'),
        secShell(
          sec,
          html`<div class="stack" style="--gap:22px">
            <div class="field stc-radius">
              <label for="st-delivery_radius_km">Raio de entrega *</label>
              <div class="stc-radius__row">
                <div class="input-group">
                  <input class="input" id="st-delivery_radius_km" name="delivery_radius_km" type="number" value="${Number(s.delivery_radius_km)}" required min="1" max="${isGlobal ? 500 : maxRadius}" step="0.5" inputmode="decimal" data-type="number" data-radius aria-describedby="st-radius-cap">
                  <span class="input-group__addon">km</span>
                </div>
                <div class="stc-range" data-range>
                  <input type="range" min="1" max="${rangeMax(radius)}" step="0.5" value="${radius}" data-radius-range aria-label="Raio de entrega em km" aria-describedby="st-radius-cap">
                  <span class="stc-range__cap" data-range-cap aria-hidden="true"><span>Limite da rede · ${km(maxRadius)} km</span></span>
                  <span class="stc-range__ends" aria-hidden="true"><span>1 km</span><span data-range-max>${km(rangeMax(radius))} km</span></span>
                </div>
              </div>
              <div class="stc-cap" id="st-radius-cap" data-cap></div>
            </div>
            ${fld({ label: 'Prazo de entrega', name: 'delivery_lead_time', value: s.delivery_lead_time, cls: '', placeholder: 'Entrega em até 5 dias úteis', attrs: 'maxlength="160"', hint: 'Aparece no carrinho e no acompanhamento do pedido.' })}
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('ruler', 'icon-sm')} Faixas de frete</legend>
              <p class="muted">O cliente paga o frete da primeira faixa que alcança a casa dele. A última faixa precisa chegar ao raio. Use R$ 0,00 para frete grátis.</p>
              <div class="stc-tiers__head" aria-hidden="true"><span>Distância</span><span>Até</span><span>Frete</span><span></span></div>
              <ul class="stc-tiers mt-2" data-tiers>${tierRows()}</ul>
              <div class="stc-tiers__error mt-2" data-tiers-error role="alert"></div>
              <button class="btn btn--sm mt-3" type="button" data-tier-add>${icon('plus', 'icon-sm')} Adicionar faixa</button>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('cash', 'icon-sm')} Valores do pedido</legend>
              <div class="form-grid">
                ${fld({ label: 'Frete grátis a partir de', name: 'free_shipping_min', value: s.free_shipping_min != null ? Number(s.free_shipping_min).toFixed(2) : '', type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Deixe vazio para não oferecer.', opt: true })}
                ${fld({ label: 'Pedido mínimo', name: 'min_order_value', value: (Number(s.min_order_value) || 0).toFixed(2), type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Use 0 para não exigir valor mínimo.' })}
              </div>
            </fieldset>
          </div>`,
          html`<div class="card stc-pcard" aria-label="Prévia da área de entrega">
            <div class="stc-pcard__head"><span class="overline">${icon('eye', 'icon-xs')} Área de entrega</span><span class="badge badge--info" data-radius-label></span></div>
            <div class="stc-pcard__body stack" style="--gap:14px">
              <div class="stc-dmap"><div class="map" data-delivery-map role="region" aria-label="Mapa com o raio de entrega da loja"></div></div>
              <div class="stc-ladder" data-ladder></div>
              <ul class="stc-sum" data-delivery-sum></ul>
              <div class="stc-sim">
                <label class="label" for="st-sim-cep">Simular um CEP</label>
                <div class="stc-sim__row">
                  <input class="input" id="st-sim-cep" placeholder="00000-000" inputmode="numeric" maxlength="9" autocomplete="off" data-sim-cep>
                  <button class="btn btn--dark" type="button" data-sim-go>Simular</button>
                </div>
                <div data-sim-result aria-live="polite"></div>
              </div>
            </div>
          </div>`
        )
      );
      drawEntregaPreview();
      ensureDeliveryMap();
    }

    // Trilho do controle deslizante: lojas vão até o limite; a rede vai além (com aviso).
    const rangeMax = (r) => (isGlobal ? Math.max(Math.ceil((maxRadius * 2) / 10) * 10, Math.ceil(Number(r) || 0)) : maxRadius);

    function syncRange() {
      const box = $('[data-range]', view);
      const input = $('[data-radius-range]', view);
      if (!box || !input) return;
      const r = currentRadius();
      const max = Math.max(Number(input.max), isGlobal ? rangeMax(r) : maxRadius);
      if (Number(input.max) !== max) {
        input.max = String(max);
        $('[data-range-max]', view).textContent = `${km(max)} km`;
      }
      if (Number(input.value) !== r && document.activeElement !== input) input.value = String(Math.min(r, max));
      const pct = (v) => `${Math.max(0, Math.min(100, ((v - 1) / (max - 1)) * 100))}%`;
      box.style.setProperty('--fill', pct(Math.min(r, max)));
      box.style.setProperty('--cap', pct(maxRadius));
      box.classList.toggle('is-over', r > maxRadius);
      $('[data-range-cap]', view)?.classList.toggle('is-end', maxRadius >= max);
      const over = r > maxRadius;
      const cap = $('[data-cap]', view);
      cap.classList.toggle('is-over', over);
      render(
        cap,
        html`<span class="stc-cap__ico" aria-hidden="true">${icon(over ? 'alert' : 'houses', 'icon-sm')}</span>
          <div>${
            over
              ? html`<strong>${km(r)} km passa do limite da rede (${km(maxRadius)} km).</strong>${
                  isGlobal
                    ? 'Como administrador da rede você pode salvar, mas a equipe da loja não consegue salvar nenhuma alteração desta tela enquanto o raio estiver acima do limite.'
                    : `A rede permite entregar até ${km(maxRadius)} km. Reduza o raio para salvar.`
                }`
              : html`<strong>Limite da rede: ${km(maxRadius)} km</strong>${
                  isGlobal
                    ? html`Vale para todas as lojas. A equipe de cada loja escolhe um raio até esse limite. <a href="#/network">Mudar o limite</a>`
                    : 'Todas as lojas da rede entregam até esse limite. Para ir mais longe, fale com a administração da rede.'
                }`
          }</div>`
      );
    }

    function readTierInputs() {
      return $$('[data-tier]', view).map((row) => ({
        up_to_km: numOrNull($('[data-tier-km]', row).value),
        fee: numOrNull($('[data-tier-fee]', row).value),
      }));
    }

    function drawEntregaPreview() {
      const f = form.elements;
      const sumEl = $('[data-delivery-sum]', view);
      if (!sumEl) return;
      syncRange();
      const radius = currentRadius();
      const list = readTierInputs()
        .map((t, i) => ({ ...t, c: TIER_COLORS[i % TIER_COLORS.length] }))
        .filter((t) => t.up_to_km > 0)
        .sort((a, b) => a.up_to_km - b.up_to_km);
      // rótulos de faixa em cada linha (seguem a ordem digitada)
      $$('[data-tier]', view).forEach((row, i, rows) => {
        const cur = numOrNull($('[data-tier-km]', row).value);
        const prev = i > 0 ? numOrNull($('[data-tier-km]', rows[i - 1]).value) || 0 : 0;
        $('[data-tier-range]', row).textContent = tierRangeLabel(prev, cur);
      });
      const freeMin = numOrNull(f.free_shipping_min.value);
      const minOrder = numOrNull(f.min_order_value.value);
      const lead = f.delivery_lead_time.value.trim();
      const items = [];
      const segs = [];
      let prev = 0;
      for (const t of list) {
        if (prev >= radius) break;
        const upto = Math.min(t.up_to_km, radius);
        items.push(html`<li><span><i style="--c:${t.c}" aria-hidden="true"></i>${prev > 0 ? `${km(prev)} a ${km(upto)} km` : `Até ${km(upto)} km`}</span><strong>${t.fee > 0 ? money(t.fee) : 'Grátis'}</strong></li>`);
        segs.push(html`<span style="--c:${t.c};width:${((upto - prev) / radius) * 100}%"></span>`);
        prev = t.up_to_km;
      }
      if (list.length && prev < radius) {
        items.push(html`<li class="is-warn"><span>${icon('alert', 'icon-xs')} ${km(prev)} a ${km(radius)} km</span><strong>sem faixa</strong></li>`);
      }
      render(
        $('[data-ladder]', view),
        html`<div class="stc-ladder__bar" role="img" aria-label="Faixas de frete de 0 a ${km(radius)} km">${segs}</div><div class="stc-ladder__axis" aria-hidden="true"><span>0 km</span><span>${km(radius)} km</span></div>`
      );
      render(
        sumEl,
        html`${items}
          <li><span>Frete grátis</span><strong>${freeMin !== null ? `acima de ${money(freeMin)}` : 'não oferecido'}</strong></li>
          <li><span>Pedido mínimo</span><strong>${minOrder > 0 ? money(minOrder) : 'sem mínimo'}</strong></li>
          ${lead ? html`<li><span>Prazo</span><strong style="white-space:normal;text-align:right">${lead}</strong></li>` : ''}`
      );
      const lbl = $('[data-radius-label]', view);
      if (lbl) lbl.textContent = `Raio de ${km(radius)} km`;
    }

    // Simulador: CEP → ponto (função geocode) → distância até a loja → faixa de frete (ou fora do raio).
    async function simulate() {
      const input = $('[data-sim-cep]', view);
      const out = $('[data-sim-result]', view);
      const c = digits(input.value);
      const fail = (text) => render(out, html`<div class="stc-simres stc-simres--err" role="alert">${icon('alert', 'icon-sm')}<span>${text}</span></div>`);
      if (c.length !== 8) return fail('CEP incompleto. Use 8 números.');
      const pt = currentPoint();
      if (!pt) return fail('Marque a loja no mapa (Endereço) para simular.');
      let r;
      try {
        r = await withBusy($('[data-sim-go]', view), () => geocodeAddress({ cep: c }, { fallback: false }), 'Simulando…');
      } catch (e) {
        return fail(/n[ãa]o encontrad/i.test(e?.message || '') ? 'CEP não encontrado. Confira os números.' : e?.message || 'Não foi possível simular agora.');
      }
      if (!view.isConnected) return;
      const dest = [Number(r.lat), Number(r.lng)];
      const dist = distanceKm(pt, dest);
      const radius = currentRadius();
      const where = r.address?.city ? `${r.address.city}/${r.address.state || ''}`.replace(/\/$/, '') : fmtCep(c);
      const sorted = readTierInputs().filter((t) => t.up_to_km > 0).sort((a, b) => a.up_to_km - b.up_to_km);
      const tierHit = sorted.find((t) => dist <= t.up_to_km);
      simPoint = dest;
      if (maps.delivery) {
        const L = window.L;
        maps.delivery.sim?.remove();
        maps.delivery.sim = L.marker(dest, { icon: L.divIcon({ className: 'stx-dot', iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(maps.delivery.map);
        maps.delivery.map.fitBounds(L.latLngBounds([pt, dest]).extend(L.latLng(pt).toBounds(radius * 2000)), { padding: [14, 14], animate: false });
      }
      if (dist > radius) {
        render(
          out,
          html`<div class="stc-simres stc-simres--out" data-tetim-prio="3">
            ${art('site:out-of-range', { w: 160, h: 120 })}
            <div><strong>Fora do raio de ${km(radius)} km</strong>${where} fica a ${km(dist.toFixed(1))} km da loja. Na loja virtual, esse cliente vê o aviso de fora da área de entrega.</div>
          </div>`
        );
        return;
      }
      const fee = tierHit ? Number(tierHit.fee) || 0 : null;
      const freeMin = numOrNull(form.elements.free_shipping_min.value);
      render(
        out,
        html`<div class="stc-simres stc-simres--ok">
          <span class="stc-simres__ico" aria-hidden="true">${icon('truck', 'icon-sm')}</span>
          <div><strong>${fee === null ? 'Sem faixa para esta distância' : fee > 0 ? `Frete de ${money(fee)}` : 'Frete grátis'}</strong>${where} · ${km(dist.toFixed(1))} km da loja${
            fee > 0 && freeMin !== null ? html`<br>Grátis em compras acima de ${money(freeMin)}.` : ''
          }</div>
        </div>`
      );
    }

    function validateTiers(radius, errors) {
      const rows = readTierInputs();
      const errEl = $('[data-tiers-error]', view);
      let general = '';
      if (!rows.length) general = 'Adicione pelo menos uma faixa de frete.';
      rows.forEach((t, i) => {
        if (!(t.up_to_km > 0)) errors[`tier_km_${i}`] = 'Distância inválida.';
        else if (t.up_to_km > 500) errors[`tier_km_${i}`] = 'Máximo de 500 km.';
        if (t.fee === null || t.fee < 0) errors[`tier_fee_${i}`] = 'Valor inválido.';
      });
      const kms = rows.map((t) => t.up_to_km).filter((v) => v > 0);
      if (!general && new Set(kms).size !== kms.length) general = 'Há duas faixas com a mesma distância.';
      const sorted = rows.filter((t) => t.up_to_km > 0 && t.fee !== null && t.fee >= 0).sort((a, b) => a.up_to_km - b.up_to_km);
      if (!general && sorted.length === rows.length && radius > 0) {
        const last = sorted[sorted.length - 1];
        if (last.up_to_km < radius) general = `A última faixa precisa chegar ao raio de entrega (${km(radius)} km). Hoje ela vai até ${km(last.up_to_km)} km.`;
        const unused = sorted.filter((t, i) => i > 0 && sorted[i - 1].up_to_km >= radius);
        if (!general && unused.length) general = `A faixa até ${km(unused[0].up_to_km)} km começa depois do raio de entrega (${km(radius)} km) e nunca seria usada. Remova-a.`;
      }
      if (errEl) errEl.textContent = general;
      return { ok: !general, sorted };
    }

    function buildEntrega(d, errors, confirms) {
      const radius = d.delivery_radius_km;
      if (!(radius > 0)) errors.delivery_radius_km = 'Informe o raio de entrega em km.';
      else if (!isGlobal && radius > maxRadius) errors.delivery_radius_km = `O máximo permitido pela rede é ${km(maxRadius)} km.`;
      else if (radius > 500) errors.delivery_radius_km = 'O raio máximo é de 500 km.';
      if (d.free_shipping_min !== null && !(d.free_shipping_min >= 0)) errors.free_shipping_min = 'Valor inválido.';
      if (d.min_order_value !== null && !(d.min_order_value >= 0)) errors.min_order_value = 'Valor inválido.';
      // a cobertura das faixas só é conferida com um raio válido
      const t = validateTiers(errors.delivery_radius_km ? 0 : radius, errors);
      if (isGlobal && radius > maxRadius && radius !== Number(store.delivery_radius_km))
        confirms.push({
          title: 'Raio acima do limite da rede?',
          message: `O limite da rede é ${km(maxRadius)} km e você definiu ${km(radius)} km. Enquanto o raio passar do limite, a equipe da loja não consegue salvar nenhuma alteração nesta tela.`,
          confirmLabel: 'Salvar mesmo assim',
        });
      return {
        tiersOk: t.ok,
        patch: {
          delivery_radius_km: radius,
          delivery_fee_tiers: t.sorted.map((x) => ({ up_to_km: round2(x.up_to_km), fee: round2(x.fee) })),
          free_shipping_min: d.free_shipping_min,
          min_order_value: d.min_order_value ?? 0,
          delivery_lead_time: d.delivery_lead_time,
        },
      };
    }

    /* =====================================================
       Seção: Pagamento
       ===================================================== */
    function drawPagamento() {
      const s = store;
      const sec = SECTIONS[3];
      const methods = s.payment_methods || [];
      const pixOn = methods.includes('pix');
      render(
        secEl('pagamento'),
        secShell(
          sec,
          html`<div class="stack" style="--gap:22px">
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('check', 'icon-sm')} Formas aceitas</legend>
              <div class="field" role="group" aria-label="Formas de pagamento aceitas">
                <div class="stc-pm">
                  ${METHODS.map(
                    (m) => html`<label class="stc-pm__card">
                      <span class="stc-pm__ico" aria-hidden="true">${icon(PAYMENT_ICON[m] || 'wallet', 'icon-sm')}</span>
                      <span class="stc-pm__txt"><strong>${PAYMENT_METHOD[m]}</strong><span>${METHOD_HINT[m]}</span></span>
                      <input type="checkbox" name="payment_methods" value="${m}" data-type="array" ${methods.includes(m) ? 'checked' : ''}>
                    </label>`
                  )}
                </div>
              </div>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('pix', 'icon-sm')} PIX</legend>
              <div class="callout callout--pix mb-3" data-pix-off ${pixOn ? 'hidden' : ''}>${icon('alert')}<div><strong>PIX desligado</strong>Os clientes não verão o preço com desconto no PIX. Marque PIX em “Formas aceitas” para oferecer.</div></div>
              <div class="form-grid">
                <div class="field col-4">
                  <label for="st-pix_key_type">Tipo da chave<span data-pix-req ${pixOn ? '' : 'hidden'}> *</span></label>
                  <select class="select" id="st-pix_key_type" name="pix_key_type" data-placeholder="Escolha o tipo" data-sheet-title="Tipo da chave PIX">
                    <option value="" data-icon="none">Escolha o tipo</option>
                    ${PIX_TYPES.map(([v, l, ic, ph]) => html`<option value="${v}" data-icon="${ic}" data-hint="${ph}" ${s.pix_key_type === v ? 'selected' : ''}>${l}</option>`)}
                  </select>
                </div>
                <div class="field col-8">
                  <label for="st-pix_key">Chave PIX<span data-pix-req ${pixOn ? '' : 'hidden'}> *</span></label>
                  <input class="input" id="st-pix_key" name="pix_key" value="${s.pix_key || ''}" placeholder="${PIX_PLACEHOLDER[s.pix_key_type || '']}" autocapitalize="off" spellcheck="false" maxlength="120">
                </div>
                <div class="field col-8">
                  <label for="st-pix_holder">Titular da conta<span data-pix-req ${pixOn ? '' : 'hidden'}> *</span></label>
                  <input class="input" id="st-pix_holder" name="pix_holder" value="${s.pix_holder || ''}" placeholder="Razão social ou nome do titular" maxlength="120" aria-describedby="st-pix_holder-hint">
                  <span class="hint" id="st-pix_holder-hint">Mostrado ao cliente para conferir antes de pagar.</span>
                </div>
                ${fld({ label: 'Desconto no PIX', name: 'pix_discount_pct', value: Number(s.pix_discount_pct), type: 'number', cls: 'col-4', addonEnd: '%', attrs: 'min="0" max="50" step="0.5" inputmode="decimal" data-type="number"', hint: 'De 0% a 50% sobre o preço.' })}
              </div>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('card', 'icon-sm')} Parcelamento no cartão</legend>
              <div class="form-grid">
                <div class="field col-6">
                  <label for="st-max_installments">Parcelas sem juros (máximo)</label>
                  <select class="select" id="st-max_installments" name="max_installments" data-type="int" data-search="false" data-sheet-title="Parcelas sem juros">${Array.from(
                    { length: 24 },
                    (_, i) => html`<option value="${i + 1}" ${i + 1 === Number(s.max_installments) ? 'selected' : ''} ${i === 0 ? raw('data-hint="Só à vista no cartão"') : ''}>${i === 0 ? '1x (à vista)' : `${i + 1}x sem juros`}</option>`
                  )}</select>
                </div>
                ${fld({ label: 'Parcela mínima', name: 'min_installment_value', value: (Number(s.min_installment_value) || 0).toFixed(2), type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Produtos baratos mostram menos parcelas.' })}
              </div>
            </fieldset>
          </div>`,
          html`<div class="card stc-pcard" aria-label="Exemplo de preço na loja virtual">
            <div class="stc-pcard__head"><span class="overline">${icon('eye', 'icon-xs')} Exemplo na loja virtual</span></div>
            <div class="stc-pcard__body stack" style="--gap:12px">
              <div class="field">
                <label for="st-sim-price">Preço do produto no cartão</label>
                <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="st-sim-price" type="number" min="0" step="0.01" value="1000" inputmode="decimal" data-sim-price></div>
              </div>
              <div data-sim aria-live="polite"></div>
            </div>
          </div>`
        )
      );
      drawPaymentPreview();
    }

    function drawPaymentPreview() {
      const el = $('[data-sim]', view);
      if (!el) return;
      const d = readForm(form);
      const price = Math.max(0, Number($('[data-sim-price]', view)?.value) || 0);
      const methods = d.payment_methods || [];
      const pixOn = methods.includes('pix');
      const pct = Math.min(50, Math.max(0, Number(d.pix_discount_pct) || 0));
      const pix = round2(price - round2((price * pct) / 100));
      const max = Number(d.max_installments) || 1;
      const min = Number(d.min_installment_value) || 0;
      let n = max;
      while (n > 1 && price / n < min) n -= 1;
      const parcel = round2(price / n);
      $('[data-pix-off]', view).hidden = pixOn;
      $$('[data-pix-req]', view).forEach((x) => (x.hidden = !pixOn));
      const cardLine = n > 1 ? html`em até <b>${n}x de ${money(parcel)}</b> sem juros` : 'à vista no cartão';
      render(
        el,
        html`<div class="stc-price">
            ${pixOn
              ? html`<div class="stc-price__pix"><strong>${money(pix)}</strong><span>no PIX</span>${pct > 0 ? badge(`${String(pct).replace('.', ',')}% off`, 'success') : ''}</div>
                <div class="stc-price__alt">ou ${money(price)} ${cardLine}</div>`
              : html`<div class="stc-price__pix"><strong>${money(price)}</strong></div><div class="stc-price__alt">${cardLine}</div>`}
          </div>
          ${methods.length
            ? html`<div class="stack mt-3" style="--gap:6px"><span class="small muted">A loja aceita</span><div class="stc-methods">${METHODS.filter((m) => methods.includes(m)).map(
                (m) => html`<span class="tag">${icon(PAYMENT_ICON[m] || 'wallet', 'icon-xs')}${PAYMENT_METHOD[m]}</span>`
              )}</div></div>`
            : html`<div class="small stc-note--warn stc-inl mt-3">${icon('alert', 'icon-xs')} Escolha pelo menos uma forma de pagamento.</div>`}`
      );
    }

    function buildPagamento(d, errors) {
      const methods = d.payment_methods || [];
      const pixOn = methods.includes('pix');
      if (!methods.length) errors.payment_methods = 'Escolha pelo menos uma forma de pagamento.';
      let pixKey = null;
      if (d.pix_key) {
        if (!d.pix_key_type) errors.pix_key_type = 'Escolha o tipo da chave.';
        else {
          const r = normalizePix(d.pix_key_type, d.pix_key);
          if (r.error) errors.pix_key = r.error;
          else pixKey = r.value;
        }
      }
      if (pixOn) {
        if (!d.pix_key_type) errors.pix_key_type = 'Escolha o tipo da chave.';
        if (!d.pix_key) errors.pix_key = 'Informe a chave PIX (obrigatória com PIX ligado).';
        if (!d.pix_holder) errors.pix_holder = 'Informe o titular da conta.';
      }
      if (d.pix_discount_pct === null || !(d.pix_discount_pct >= 0 && d.pix_discount_pct <= 50)) errors.pix_discount_pct = 'Use um valor entre 0 e 50.';
      if (!(d.max_installments >= 1 && d.max_installments <= 24)) errors.max_installments = 'Escolha de 1 a 24 parcelas.';
      if (d.min_installment_value === null || !(d.min_installment_value >= 0)) errors.min_installment_value = 'Valor inválido.';
      return {
        patch: {
          payment_methods: METHODS.filter((m) => methods.includes(m)),
          pix_key_type: pixKey ? d.pix_key_type : null,
          pix_key: pixKey,
          pix_holder: d.pix_holder,
          pix_discount_pct: d.pix_discount_pct,
          max_installments: d.max_installments,
          min_installment_value: d.min_installment_value,
        },
      };
    }

    /* =====================================================
       Seção: Horários e pedidos
       ===================================================== */
    function drawFuncionamento() {
      const s = store;
      const sec = SECTIONS[4];
      render(
        secEl('funcionamento'),
        secShell(
          sec,
          html`<div class="stack" style="--gap:18px">
            ${fld({
              label: 'Horário de funcionamento',
              name: 'hours',
              value: s.hours,
              cls: '',
              textarea: true,
              placeholder: 'Seg. a sex.: 8h às 18h\nSábado: 8h às 12h',
              attrs: 'rows="3" maxlength="400"',
              hint: 'Aparece na página da loja. Uma linha para cada período.',
            })}
            <div>
              <div class="stc-switch-row">
                <label class="switch">
                  <input type="checkbox" name="accepts_orders" ${s.accepts_orders ? 'checked' : ''} data-accepts>
                  <span class="switch__track"></span>
                  <span class="switch__txt"><strong>Aceitar pedidos pelo site</strong><br><span class="muted small">Desligado, a vitrine continua no ar, mas o carrinho não finaliza pedidos.</span></span>
                </label>
                ${fld({
                  label: 'Mensagem enquanto os pedidos estiverem pausados',
                  name: 'closed_message',
                  value: s.closed_message,
                  cls: '',
                  textarea: true,
                  placeholder: 'Ex.: Estamos em inventário até segunda-feira. Fale com a gente pelo WhatsApp.',
                  attrs: 'rows="3" maxlength="300"',
                  hint: 'Sem mensagem, a loja virtual mostra “Esta loja não está recebendo pedidos pelo site agora.”',
                  opt: true,
                })}
              </div>
              <div class="stc-switch-row">
                <label class="switch">
                  <input type="checkbox" name="active" ${s.active ? 'checked' : ''} ${isGlobal ? '' : 'disabled'} aria-describedby="st-active-hint">
                  <span class="switch__track"></span>
                  <span class="switch__txt"><strong>Loja ativa na loja virtual</strong><br><span class="muted small" id="st-active-hint">${
                    isGlobal
                      ? 'Inativa, a loja some da loja virtual e da busca por CEP. A equipe continua acessando o painel.'
                      : `Hoje: ${s.active ? 'ativa' : 'inativa'}. Somente a administração da rede altera.`
                  }</span></span>
                </label>
              </div>
            </div>
          </div>`,
          html`<div class="card stc-pcard" aria-label="Situação na loja virtual"><div class="stc-pcard__head"><span class="overline">${icon('eye', 'icon-xs')} Na loja virtual agora</span></div><div class="stc-pcard__body" data-status-preview></div></div>`
        )
      );
      drawStatusPreview();
    }

    function drawStatusPreview() {
      const el = $('[data-status-preview]', view);
      if (!el) return;
      const f = form.elements;
      const active = f.active ? f.active.checked : store.active;
      const accepts = f.accepts_orders?.checked;
      const msg = f.closed_message?.value.trim();
      const hours = f.hours?.value.trim();
      const [ico, tone, title, sub] = !active
        ? ['eyeOff', 'neu', 'Fora da loja virtual', 'A loja não aparece para os clientes nem na busca por CEP.']
        : accepts
          ? ['checkCircle', 'ok', 'Recebendo pedidos', 'Clientes dentro do raio compram pelo site.']
          : ['pause', 'warn', 'Pedidos pausados', 'A vitrine continua no ar, mas o carrinho não finaliza.'];
      render(
        el,
        html`<div class="stc-status">
          <div class="stc-status__now"><span class="stc-status__ico t-${tone}" aria-hidden="true">${icon(ico)}</span><div><strong>${title}</strong><span>${sub}</span></div></div>
          ${active && !accepts ? html`<div class="stc-closed"><strong>O cliente vê:</strong>${msg || 'Esta loja não está recebendo pedidos pelo site agora.'}</div>` : ''}
          ${hours ? html`<div><span class="small muted">Horário</span><div class="stc-hours">${hours}</div></div>` : ''}
        </div>`
      );
    }

    function buildFuncionamento(d, errors, confirms) {
      if (d.closed_message && d.closed_message.length > 300) errors.closed_message = 'Use no máximo 300 caracteres.';
      const patch = { hours: d.hours, accepts_orders: !!d.accepts_orders, closed_message: d.closed_message };
      if (isGlobal) {
        patch.active = !!d.active;
        if (store.active && !patch.active)
          confirms.push({
            title: 'Desativar a loja?',
            message: `${store.name} deixa de aparecer na loja virtual e na busca por CEP. Pedidos em andamento continuam no painel. Dá para reativar depois.`,
            confirmLabel: 'Desativar loja',
            danger: true,
          });
      }
      return { patch };
    }

    /* =====================================================
       Seção: Aparência (marca, endereço na loja virtual, faixa rolante)
       ===================================================== */
    function brandOptions(current) {
      const counts = new Map();
      ctx.stores.forEach((x) => x.brand_name && counts.set(x.brand_name, (counts.get(x.brand_name) || 0) + 1));
      if (current && !counts.has(current)) counts.set(current, 1);
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([b, n]) => html`<option value="${b}" data-icon="store" data-hint="${plural(n, 'loja', 'lojas')}" ${b === current ? 'selected' : ''}>${b}</option>`);
    }
    function marqueeRows() {
      return marquee.map(
        (t, i) => html`<li class="stc-marq__row" data-marq="${i}">
          <span class="stc-marq__n" aria-hidden="true">${i + 1}</span>
          <div class="field">
            <label class="visually-hidden" for="st-marquee-${i}">Frase ${i + 1} da faixa rolante</label>
            <input class="input" id="st-marquee-${i}" name="marquee_${i}" value="${t}" maxlength="${MARQUEE_LEN}" placeholder="Ex.: Montagem grátis em ${short}" data-marq-input>
          </div>
          <button class="btn btn--ghost btn--icon" type="button" data-marq-remove="${i}" aria-label="Remover frase ${i + 1}" data-tooltip="Remover frase">${icon('trash', 'icon-sm')}</button>
        </li>`
      );
    }
    function drawAparencia() {
      const s = store;
      const sec = SECTIONS[5];
      marquee = Array.isArray(s.marquee) ? s.marquee.map(String) : [];
      const link = `${location.host}/loja/${s.slug}`;
      render(
        secEl('aparencia'),
        secShell(
          sec,
          html`<div class="stack" style="--gap:22px">
            <div class="form-grid">
              ${isGlobal
                ? html`<div class="field col-6">
                    <label for="st-brand_name">Marca *</label>
                    <select class="select" id="st-brand_name" name="brand_name" required data-sheet-title="Marca" aria-describedby="st-brand-hint">${brandOptions(s.brand_name)}<option value="__new" data-icon="plus" data-hint="Digite o nome da nova marca">Outra marca…</option></select>
                    <span class="hint" id="st-brand-hint">Nome exibido no topo da loja virtual.</span>
                  </div>
                  <div class="field col-6" data-brand-new hidden>
                    <label for="st-brand_new">Nome da nova marca *</label>
                    <input class="input" id="st-brand_new" name="brand_new" maxlength="60" placeholder="Ex.: Atual Casa">
                  </div>`
                : html`<div class="field col-6"><span class="label" id="st-brand-label">Marca</span><div class="stc-ro" aria-labelledby="st-brand-label">${icon('lock', 'icon-sm')}${s.brand_name}</div><span class="hint">Somente a administração da rede altera a marca.</span></div>`}
              ${isGlobal
                ? fld({
                    label: 'Endereço na loja virtual',
                    name: 'slug',
                    value: s.slug,
                    required: true,
                    cls: 'col-12',
                    addon: '/loja/',
                    attrs: 'maxlength="60" autocapitalize="off" spellcheck="false" data-slug',
                    hint: html`Hoje: <a href="${href()}" target="_blank" rel="noopener">${link}</a>. Letras minúsculas, números e hífens; mudar o endereço quebra links já divulgados.`,
                  })
                : html`<div class="field col-12"><span class="label" id="st-slug-label">Endereço na loja virtual</span>
                    <div class="stc-ro stc-ro--link" aria-labelledby="st-slug-label">${icon('link', 'icon-sm')}<a href="${href()}" target="_blank" rel="noopener">${link}</a>
                      <button class="btn btn--sm btn--ghost" type="button" data-copy-link>${icon('copy', 'icon-sm')} Copiar link</button></div>
                    <span class="hint">Somente a administração da rede altera o endereço.</span></div>`}
            </div>
            <fieldset class="fieldset">
              <legend class="fieldset__title">${icon('sparkle', 'icon-sm')} Faixa rolante da página inicial</legend>
              <p class="muted">Frases curtas que passam no topo da vitrine de ${short}, como “Montagem grátis” ou “Entrega em 48 h”. Sem frases, a loja usa as da rede.</p>
              <ul class="stc-marq" data-marq-list>${marqueeRows()}</ul>
              <div class="row mt-2" style="--gap:10px">
                <button class="btn btn--sm" type="button" data-marq-add>${icon('plus', 'icon-sm')} Adicionar frase</button>
                <span class="small muted" data-marq-count></span>
              </div>
            </fieldset>
          </div>`,
          html`<div class="card stc-pcard" aria-label="Prévia da aparência"><div class="stc-pcard__head"><span class="overline">${icon('eye', 'icon-xs')} Topo da loja virtual</span></div><div class="stc-pcard__body" data-look-preview></div></div>`
        )
      );
      drawLookPreview();
    }

    function readMarquee() {
      return $$('[data-marq-input]', view).map((x) => x.value.trim().replace(/\s+/g, ' '));
    }
    function drawLookPreview() {
      const el = $('[data-look-preview]', view);
      if (!el) return;
      const f = form.elements;
      const brand = isGlobal ? (f.brand_name?.value === '__new' ? f.brand_new?.value.trim() || 'Nova marca' : f.brand_name?.value) : store.brand_name;
      const slug = isGlobal ? f.slug?.value.trim() || store.slug : store.slug;
      const own = readMarquee().filter(Boolean);
      const list = own.length ? own : netMarquee;
      const count = $('[data-marq-count]', view);
      if (count) count.textContent = `${readMarquee().length} de ${MARQUEE_MAX} frases · até ${MARQUEE_LEN} letras cada`;
      const nb = $('[data-brand-new]', view);
      if (nb) nb.hidden = f.brand_name?.value !== '__new';
      render(
        el,
        html`<div class="stc-sf">
            <div class="stc-sf__top">${storeMark({ ...store, brand_name: brand }, 34)}<div style="min-width:0"><div class="stc-sf__brand">${brand}</div><div class="stc-sf__store">Loja de ${f.city?.value.trim() || store.city}</div></div><span class="stc-sf__url">/loja/${slug}</span></div>
            <div class="stc-sf__strip" aria-label="Faixa rolante">${list.length ? list.map((t) => html`<span>${t}</span>`) : html`<span>Faixa oculta: nenhuma frase</span>`}</div>
            <div class="stc-sf__foot">${own.length ? `${plural(own.length, 'frase própria', 'frases próprias')} de ${short}` : netMarquee.length ? `Usando as ${plural(netMarquee.length, 'frase', 'frases')} da rede` : 'A rede também não tem frases: a faixa não aparece'}</div>
          </div>`
      );
    }

    function buildAparencia(d, errors, confirms) {
      const patch = {};
      if (isGlobal) {
        const brand = d.brand_name === '__new' ? d.brand_new : d.brand_name;
        if (!brand) errors[d.brand_name === '__new' ? 'brand_new' : 'brand_name'] = 'Informe a marca.';
        if (!d.slug) errors.slug = 'Informe o endereço da loja virtual.';
        else if (!SLUG_RE.test(d.slug)) errors.slug = 'Use só letras minúsculas, números e hífens (ex.: ponte-nova).';
        else if (ctx.stores.some((x) => x.id !== store.id && x.slug === d.slug)) errors.slug = 'Já existe outra loja com este endereço.';
        patch.brand_name = brand;
        patch.slug = d.slug;
        if (d.slug && d.slug !== store.slug && !errors.slug)
          confirms.push({
            title: 'Alterar o endereço da loja virtual?',
            message: `O link passa de /loja/${store.slug} para /loja/${d.slug}. Links antigos divulgados (WhatsApp, Instagram, QR codes) deixam de funcionar.`,
            confirmLabel: 'Alterar endereço',
          });
      }
      const list = readMarquee();
      list.forEach((t, i) => {
        if (!t) errors[`marquee_${i}`] = 'Frase vazia: escreva ou remova.';
        else if (t.length > MARQUEE_LEN) errors[`marquee_${i}`] = `Use até ${MARQUEE_LEN} letras.`;
      });
      patch.marquee = list.filter(Boolean).length ? list.filter(Boolean) : null;
      return { patch };
    }

    /* =====================================================
       Alterações, gravação e barra
       ===================================================== */
    const fieldKey = (el) => `${el.name}#${el.type === 'checkbox' || el.type === 'radio' ? el.value : ''}`;
    const fieldVal = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
    const secFields = (id) => $$('[name]', secEl(id)).filter((el) => el.form === form && !el.disabled);
    const secSnap = (id) => JSON.stringify(secFields(id).map((el) => [fieldKey(el), fieldVal(el)]));
    function markClean(id) {
      saved[id] = secSnap(id);
      secFields(id).forEach((el) => savedField.set(fieldKey(el), fieldVal(el)));
    }
    const dirtySecs = () => SECTIONS.filter((s) => secEl(s.id) && secSnap(s.id) !== saved[s.id]);
    function paintDirty() {
      const list = dirtySecs().map((s) => s.id);
      $$('[data-ptab]', view).forEach((a) => {
        const on = list.includes(a.dataset.ptab);
        $('[data-dot]', a).hidden = !on;
        $('[data-dot-sr]', a).hidden = !on;
      });
      SECTIONS.forEach((s) => {
        const dot = $('[data-sec-dot]', secEl(s.id));
        if (dot) dot.hidden = !list.includes(s.id);
      });
      $$('[name]', form).forEach((el) => {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') return;
        const k = fieldKey(el);
        const on = !savedField.has(k) || savedField.get(k) !== fieldVal(el);
        const target = el.tagName === 'SELECT' && el.nextElementSibling?.classList.contains('sel__trigger') ? el.nextElementSibling : el;
        target.classList.toggle('is-dirty', on);
      });
    }
    // Mudança feita por código (mapa, CEP, faixas): avisa a barra e repinta os pontos.
    const changed = () => form.dispatchEvent(new Event('change', { bubbles: true }));
    const inputOf = (name) => {
      const el = form.elements[name];
      return el && el.length && !el.tagName ? el[0] : el;
    };
    const clearError = (name) => {
      inputOf(name)?.removeAttribute?.('aria-invalid');
      $$(`.error[data-for="${name}"]`, form).forEach((x) => x.remove());
    };
    // Erro num campo só, sem apagar os outros (busca de CEP, localizar pelo endereço)
    function fieldError(name, message) {
      clearError(name);
      const input = inputOf(name);
      if (!input) return;
      input.setAttribute('aria-invalid', 'true');
      const msg = document.createElement('span');
      msg.className = 'error';
      msg.dataset.for = name;
      msg.id = `st-err-${name}`;
      msg.textContent = message;
      input.closest('.field')?.appendChild(msg);
      const desc = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== msg.id && document.getElementById(x));
      input.setAttribute('aria-describedby', [...desc, msg.id].join(' '));
      input.focus();
    }

    const DRAW = { dados: drawDados, endereco: drawEndereco, entrega: drawEntrega, pagamento: drawPagamento, funcionamento: drawFuncionamento, aparencia: drawAparencia };
    const BUILD = { dados: buildDados, endereco: buildEndereco, entrega: buildEntrega, pagamento: buildPagamento, funcionamento: buildFuncionamento, aparencia: buildAparencia };

    function redraw(ids) {
      ids.forEach((id) => DRAW[id]());
      // o mapa da entrega acompanha o ponto do endereço
      if (ids.includes('endereco') && !ids.includes('entrega')) {
        destroyMap('delivery');
        const el = $('[data-delivery-map]', view);
        if (el) {
          el.className = 'map';
          el.textContent = '';
        }
        ensureDeliveryMap();
      }
      if (ids.includes('entrega')) updateRadius();
      drawContactPreview();
      drawStatusPreview();
      drawLookPreview();
      ids.forEach(markClean);
      paintDirty();
    }

    async function saveAll() {
      const secs = dirtySecs().map((s) => s.id);
      if (!secs.length) return true;
      const d = readForm(form);
      const errors = {};
      const confirms = [];
      const patch = {};
      let tiersOk = true;
      for (const id of secs) {
        const r = BUILD[id](d, errors, confirms);
        if (r.tiersOk === false) tiersOk = false;
        Object.assign(patch, r.patch);
      }
      if (!secs.includes('entrega')) {
        const e = $('[data-tiers-error]', view);
        if (e) e.textContent = '';
      }
      const fieldsOk = showErrors(form, errors);
      if (!fieldsOk || !tiersOk) {
        if (fieldsOk && !tiersOk) $('[data-tiers-error]', view)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const n = Object.keys(errors).length;
        toast(n ? `Confira ${n > 1 ? 'os campos marcados' : 'o campo marcado'} antes de salvar.` : 'Confira as faixas de frete antes de salvar.', 'warning', 4200);
        return false;
      }
      for (const c of confirms) if (!(await confirmDialog(c))) return false;
      const before = { name: store.name, slug: store.slug, brand_name: store.brand_name, city: store.city, state: store.state, active: store.active };
      let row;
      try {
        row = await q(sb.from('stores').update(patch).eq('id', store.id).select('*').single());
      } catch (e) {
        const err = storeError(e);
        toast(err.message, 'error', 9000, {
          title: 'Não foi possível salvar',
          action: { label: 'Tentar de novo', onClick: () => bar?.el.querySelector('[data-save]')?.click() },
        });
        return false;
      }
      if (!view.isConnected) return true;
      Object.assign(store, row);
      const cached = ctx.stores.find((x) => x.id === store.id);
      if (cached && cached !== store) Object.assign(cached, row);
      redraw(secs);
      showErrors(form, {});
      drawHero();
      drawAlerts();
      drawTip();
      drawActions();
      const names = SECTIONS.filter((s) => secs.includes(s.id)).map((s) => s.label);
      toast(names.length > 1 ? `Seções atualizadas: ${names.slice(0, -1).join(', ')} e ${names.at(-1)}.` : `Seção atualizada: ${names[0]}.`, 'success', 3200, { title: 'Dados da loja salvos' });
      if (row.lat == null && secs.includes('endereco')) toast('Loja sem localização: o raio de entrega não é calculado.', 'warning', 6000);
      if (['name', 'slug', 'brand_name', 'city', 'state', 'active'].some((k) => row[k] !== before[k])) await syncShell();
      return true;
    }

    function discardAll() {
      const secs = dirtySecs().map((s) => s.id);
      showErrors(form, {});
      const e = $('[data-tiers-error]', view);
      if (e) e.textContent = '';
      redraw(secs);
      setGeoNote(store.lat == null || store.lng == null ? 'A loja ainda não tem localização: busque pelo CEP ou clique no mapa.' : '');
      toast('Alterações descartadas', 'info', 2400);
    }

    // Nome, cidade, slug e status aparecem no seletor de lojas, no topo e nos links.
    async function syncShell() {
      try {
        await ctx.reloadStores();
      } catch {
        /* a lista volta na próxima navegação */
      }
      const s2 = ctx.storeShort?.(store) || store.city;
      ctx.setTitle(TITLE, `Dados, entrega e pagamento de ${s2}`, isGlobal ? { crumbs: [['Lojas', '#/stores'], [s2]] } : {});
      $$('[data-store-link]').forEach((a) => a.setAttribute('href', href()));
      const foot = $('.sidebar__foot a');
      if (foot && ctx.storeId === store.id) foot.setAttribute('href', href());
    }

    /* ---------- Navegação pelas seções ---------- */
    const tabsNav = $('[data-ptabs]', view);
    const reduced = () => {
      try {
        return matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    };
    let lockTab = 0;
    const setActiveTab = (id) =>
      $$('[data-ptab]', tabsNav).forEach((a) => (a.dataset.ptab === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    function goSection(id, fieldName) {
      const el = secEl(id);
      if (!el) return;
      const off = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue(innerWidth < 768 ? '--appbar-h' : '--topbar-h')) || 64) + tabsNav.getBoundingClientRect().height + 28;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: reduced() ? 'auto' : 'smooth' });
      setActiveTab(id);
      lockTab = Date.now();
      setTimeout(() => {
        const f = fieldName ? form.elements[fieldName] : null;
        const target = (f && (f.length && !f.tagName ? f[0] : f)) || el.querySelector('input:not([type=hidden]):not(:disabled), textarea, [role="combobox"], button:not(:disabled)');
        target?.focus({ preventScroll: true });
      }, reduced() ? 0 : 450);
    }
    tabsNav.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ptab]');
      if (!a) return;
      e.preventDefault();
      goSection(a.dataset.ptab);
    });
    tabsNav.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      const links = $$('[data-ptab]', tabsNav);
      const i = links.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length;
      links[n].focus();
    });
    let spy = null;
    if ('IntersectionObserver' in window) {
      const vis = new Map();
      spy = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => vis.set(en.target.dataset.sec, en.isIntersecting));
          if (Date.now() - lockTab < 900) return;
          const first = SECTIONS.find((s) => vis.get(s.id));
          if (first) setActiveTab(first.id);
        },
        { rootMargin: '-150px 0px -55% 0px' }
      );
      SECTIONS.forEach((s) => spy.observe(secEl(s.id)));
    }
    ctx.onCleanup(() => {
      spy?.disconnect();
      Object.keys(maps).forEach(destroyMap);
    });

    /* ---------- Eventos ---------- */
    view.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) {
        e.preventDefault();
        goSection(g.dataset.goto, g.dataset.gotoField);
        return;
      }
      if (e.target.closest('[data-cep-search]')) return searchCep();
      if (e.target.closest('[data-geo-address]')) return locateByAddress();
      if (e.target.closest('[data-sim-go]')) return simulate();
      if (e.target.closest('[data-copy-link]')) {
        const url = `${location.origin}${href()}`;
        navigator.clipboard?.writeText(url).then(
          () => toast('Link da loja copiado', 'success', 2200),
          () => toast(url, 'info', 6000, { title: 'Copie o link' })
        );
        return;
      }
      if (e.target.closest('[data-tier-add]')) {
        const cur = readTierInputs();
        tiers = cur.map((x) => ({ up_to_km: x.up_to_km, fee: x.fee }));
        if (tiers.length >= 10) return toast('Use no máximo 10 faixas de frete.', 'warning');
        const last = tiers[tiers.length - 1];
        const radius = currentRadius();
        const nextKm = last ? Math.min(500, (Number(last.up_to_km) || 0) < radius ? radius : (Number(last.up_to_km) || 0) + 10) : radius;
        tiers.push({ up_to_km: nextKm, fee: last ? Number(last.fee) || 0 : 0 });
        render($('[data-tiers]', view), tierRows());
        drawEntregaPreview();
        changed();
        $(`#st-tier-km-${tiers.length - 1}`, view)?.focus();
        return;
      }
      const rm = e.target.closest('[data-tier-remove]');
      if (rm) {
        const cur = readTierInputs();
        if (cur.length <= 1) return;
        const i = Number(rm.dataset.tierRemove);
        cur.splice(i, 1);
        tiers = cur;
        render($('[data-tiers]', view), tierRows());
        $('[data-tiers-error]', view).textContent = '';
        drawEntregaPreview();
        changed();
        ($(`#st-tier-km-${Math.min(i, tiers.length - 1)}`, view) || $('[data-tier-add]', view))?.focus();
        return;
      }
      if (e.target.closest('[data-marq-add]')) {
        marquee = readMarquee();
        if (marquee.length >= MARQUEE_MAX) return toast(`Use no máximo ${MARQUEE_MAX} frases.`, 'warning');
        marquee.push('');
        render($('[data-marq-list]', view), marqueeRows());
        drawLookPreview();
        changed();
        $(`#st-marquee-${marquee.length - 1}`, view)?.focus();
        return;
      }
      const mr = e.target.closest('[data-marq-remove]');
      if (mr) {
        marquee = readMarquee();
        const i = Number(mr.dataset.marqRemove);
        marquee.splice(i, 1);
        render($('[data-marq-list]', view), marqueeRows());
        drawLookPreview();
        changed();
        ($(`#st-marquee-${Math.min(i, marquee.length - 1)}`, view) || $('[data-marq-add]', view))?.focus();
      }
    });

    view.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.matches('[data-cep]')) {
        e.preventDefault();
        searchCep();
      } else if (e.target.matches('[data-sim-cep]')) {
        e.preventDefault();
        simulate();
      }
    });

    const onEdit = (e) => {
      const t = e.target;
      if (t === form) return paintDirty();
      if (t.name && t.getAttribute?.('aria-invalid')) clearError(t.name); // o erro some assim que o campo é corrigido
      if (e.type === 'input') {
        if (t.matches('[data-cep], [data-sim-cep]')) t.value = maskCep(t.value);
        if (t.matches('[data-slug]')) t.value = t.value.toLowerCase().replace(/\s+/g, '-');
        if (t.matches('[data-wa]')) {
          const h = $('#st-whatsapp-hint', view);
          const wa = normalizeWhatsapp(t.value);
          if (h) h.textContent = !t.value ? WA_HINT : whatsappOk(wa) ? `Link: wa.me/${wa}` : 'Informe DDD + número.';
        }
      }
      if (t.matches('[data-coord]')) {
        const f = form.elements;
        const lat = numOrNull(f.lat.value);
        const lng = numOrNull(f.lng.value);
        if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) setAddrPoint(lat, lng, { pan: true });
      }
      if (t.matches('[data-radius-range]')) {
        form.elements.delivery_radius_km.value = t.value;
        updateRadius();
        drawEntregaPreview();
        changed();
        return;
      }
      if (t.matches('[data-radius]')) updateRadius();
      const sec = t.closest('[data-sec]')?.dataset.sec;
      if (sec === 'entrega') drawEntregaPreview();
      if (sec === 'pagamento') {
        if (t.name === 'pix_key_type') form.elements.pix_key.placeholder = PIX_PLACEHOLDER[t.value || ''];
        drawPaymentPreview();
      }
      if (sec === 'dados' || sec === 'endereco' || sec === 'funcionamento') drawContactPreview();
      if (sec === 'funcionamento') drawStatusPreview();
      if (sec === 'aparencia' || t.name === 'city') drawLookPreview();
      if (t.name) paintDirty();
    };
    view.addEventListener('input', onEdit);
    view.addEventListener('change', onEdit);
    view.addEventListener(
      'blur',
      (e) => {
        if (e.target.matches?.('[data-wa]')) {
          const wa = normalizeWhatsapp(e.target.value);
          if (whatsappOk(wa) && e.target.value !== fmtWhatsapp(wa)) {
            e.target.value = fmtWhatsapp(wa);
            changed();
          }
        }
      },
      true
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      bar?.el.querySelector('[data-save]')?.click();
    });

    /* ---------- Primeira pintura ---------- */
    drawHero();
    drawAlerts();
    drawTip();
    SECTIONS.forEach((s) => DRAW[s.id]());
    drawContactPreview();
    SECTIONS.forEach((s) => markClean(s.id));
    bar = saveBar({
      form,
      ctx,
      label: 'Salvar',
      sections: () => dirtySecs().map((s) => s.label),
      onSave: async () => ((await saveAll()) ? undefined : false),
      onDiscard: discardAll,
    });
    paintDirty();
    setActiveTab(SECTIONS[0].id);
    // links antigos (#/store/entrega, #/store/pagamento…) abrem já na seção
    const startId = SECTIONS.some((s) => s.id === ctx.args[0]) ? ctx.args[0] : null;
    if (startId && startId !== 'dados') requestAnimationFrame(() => goSection(startId));
  },
};
