// Dados, entrega e pagamento da loja selecionada.
// Cada aba é um formulário independente: salva só os próprios campos.
// Regras do banco que a tela respeita:
//   - slug, marca, ordem e ativação só mudam pela administração da rede (gatilho stores_guard);
//   - a equipe da loja não passa o raio de entrega do limite da rede (network_settings.default_radius_km);
//   - na vitrine, preço no PIX = preço × (1 − pix_discount_pct/100) e as parcelas respeitam a parcela mínima.
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
  selectOptions,
  loading,
  errorBlock,
  injectStyle,
  money,
  phone as fmtPhone,
  cep as fmtCep,
  confirmDialog,
  badge,
  PAYMENT_METHOD,
} from '../ui.js';

/* =========================================================
   Utilitários compartilhados (também usados por stores.js)
   ========================================================= */
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
export const digits = (v) => String(v ?? '').replace(/\D/g, '');
export const km = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Máscara de CEP enquanto digita: 00000-000
export const maskCep = (v) => {
  const d = digits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

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
    return new Error('Somente a administração da rede pode alterar o endereço da loja virtual (slug), a marca, a ordem ou a ativação da loja.');
  }
  const r = msg.match(/raio de entrega n[ãa]o pode passar de ([\d.,]+) km/i);
  if (r) return new Error(`O raio de entrega não pode passar do limite da rede (${km(r[1])} km). Escolha um valor menor ou fale com a administração da rede.`);
  for (const [name, text] of Object.entries(CHECKS)) if (msg.includes(name)) return new Error(text);
  if (rawErr.code === '23505' && /slug/i.test(msg)) return new Error('Já existe uma loja com este endereço na loja virtual (slug). Escolha outro.');
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

export const radiusStyle = (active = true) => ({
  color: active ? '#e01b26' : '#8a8a8a',
  weight: 1.5,
  opacity: 0.7,
  fillColor: active ? '#e01b26' : '#8a8a8a',
  fillOpacity: active ? 0.07 : 0.05,
  dashArray: active ? null : '5 5',
});

const UF_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

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
  ['cpf', 'CPF'],
  ['cnpj', 'CNPJ'],
  ['email', 'E-mail'],
  ['telefone', 'Celular'],
  ['aleatoria', 'Chave aleatória'],
];
const PIX_PLACEHOLDER = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  email: 'financeiro@loja.com.br',
  telefone: '(31) 99999-9999',
  aleatoria: '123e4567-e89b-12d3-a456-426614174000',
  '': 'Escolha o tipo da chave',
};

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

const numOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/* =========================================================
   Estilos do módulo
   ========================================================= */
const CSS = `
.stcfg { display: flex; flex-direction: column; gap: 16px; }
.stcfg .tabs { margin-bottom: 0; }
.stcfg .tab { display: inline-flex; align-items: center; gap: 6px; }
.stcfg .muted a, .stcfg .hint a { text-decoration: underline; text-underline-offset: 2px; }
.stcfg__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--orange); flex: none; }
.stcfg__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; padding: 14px 18px; }
.stcfg__who { display: flex; align-items: center; gap: 12px; min-width: 0; }
.stcfg__who .h2 { overflow-wrap: anywhere; }
.stcfg__icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); flex: none; }
.stcfg__icon .icon { width: 22px; height: 22px; }
.stcfg__badges { --gap: 6px; }
.stcfg__todo { align-items: center; flex-wrap: wrap; }
.stcfg__todo .btn { height: 26px; padding: 0 9px; font-size: 12px; }
.stcfg__panel > form, .stcfg__panel > .split > form { min-width: 0; }
.stcfg .card__head { flex-wrap: wrap; }
.stcfg .fieldset > legend { float: left; width: 100%; padding: 0; }
.stcfg .fieldset > legend ~ * { clear: left; }
.stcfg .card__head p { margin-top: 2px; }
.stcfg .card__foot { flex-wrap: wrap; }
.stcfg__unsaved { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; color: var(--warning); font-weight: 600; }
.stcfg__ro { display: flex; align-items: center; min-height: 38px; padding: 8px 11px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); overflow-wrap: anywhere; }
.stcfg__inline { display: flex; gap: 8px; }
.stcfg__inline .input { flex: 1; min-width: 0; }
.stcfg__map { height: 380px; }
.stcfg__map--sm { height: 230px; }
.stcfg__map-empty { display: grid; place-items: center; height: 230px; padding: 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); text-align: center; }
.stcfg__geo { display: flex; align-items: flex-end; }
.stcfg__note { font-size: 12.5px; color: var(--muted); }
.stcfg__note--ok { color: var(--success); }
.stcfg__note--warn { color: var(--warning); }
.stcfg .leaflet-container { font-family: var(--font); }
.atual-pin { background: none; border: 0; }
.atual-pin svg { filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35)); }
.stcfg-tiers { display: flex; flex-direction: column; gap: 8px; }
.stcfg-tiers__head, .stcfg-tier { display: grid; grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1fr) 38px; gap: 10px; align-items: start; }
.stcfg-tiers__head { font-size: 11.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
.stcfg-tier__range { padding-top: 9px; font-weight: 600; font-size: 13px; color: var(--ink); white-space: nowrap; }
.stcfg-tiers__error { font-size: 12px; color: var(--danger); }
.stcfg-sum { display: flex; flex-direction: column; gap: 6px; }
.stcfg-sum li { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); }
.stcfg-sum li:last-child { border-bottom: 0; }
.stcfg-sum strong { white-space: nowrap; }
.stcfg-pm { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.stcfg-pm .check { padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: #fff; }
.stcfg-pm .check:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.stcfg-pm .check:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.stcfg-sim { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.stcfg-sim__pix { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; }
.stcfg-sim__pix strong { font-size: 24px; line-height: 1.1; color: var(--ink); }
.stcfg-switch-row { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); }
.stcfg-switch-row .switch input:disabled + .switch__track { opacity: 0.55; }
.stcfg-switch-row .switch:has(input:disabled) { cursor: not-allowed; }
@media (max-width: 860px) {
  .stcfg__summary { padding: 12px 14px; }
  .stcfg__map { height: 300px; }
}
@media (max-width: 560px) {
  .stcfg-tiers__head { display: none; }
  .stcfg-tier { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
  .stcfg-tier__range { grid-column: 1 / -1; padding-top: 0; }
  .stcfg-tier [data-pre] { display: none; }
  .stcfg-tier [data-pre] + .input { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .stcfg .card__foot .btn { flex: 1; }
  .stcfg__unsaved { width: 100%; }
  .stcfg-hide-sm { display: none; }
}
`;

const TABS = [
  { id: 'dados', label: 'Dados da loja' },
  { id: 'endereco', label: 'Endereço e mapa' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'pagamento', label: 'Pagamento' },
  { id: 'funcionamento', label: 'Funcionamento' },
];
const TITLE = 'Dados, entrega e pagamento';
const METHODS = ['pix', 'card_on_delivery', 'cash', 'crediario', 'card_link'];
const METHOD_HINT = {
  pix: 'Mostra o preço com desconto no PIX',
  card_on_delivery: 'Maquininha na entrega',
  cash: 'Pagamento em espécie na entrega',
  crediario: 'Carnê / crediário próprio da loja',
  card_link: 'Link de pagamento enviado pela loja',
};

/* ---------- Campo de formulário com id próprio do módulo ---------- */
function fld({ label, name, value = '', type = 'text', cls = 'col-6', hint = '', required = false, attrs = '', addon = '', addonEnd = '', disabled = false, placeholder = '', textarea = false }) {
  const id = `st-${name}`;
  const described = hint ? raw(`aria-describedby="${id}-hint"`) : '';
  const input = textarea
    ? html`<textarea class="textarea" id="${id}" name="${name}" placeholder="${placeholder}" ${disabled ? 'disabled' : ''} ${described} ${raw(attrs)}>${value ?? ''}</textarea>`
    : html`<input class="input" id="${id}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''} ${described} ${raw(attrs)}>`;
  return html`<div class="field ${cls}">
    <label for="${id}">${label}${required ? ' *' : ''}</label>
    ${addon || addonEnd
      ? html`<div class="input-group">${addon ? html`<span class="input-group__addon">${addon}</span>` : ''}${input}${addonEnd ? html`<span class="input-group__addon">${addonEnd}</span>` : ''}</div>`
      : input}
    ${hint ? html`<span class="hint" id="${id}-hint">${hint}</span>` : ''}
  </div>`;
}

const footer = () => html`<span class="stcfg__unsaved small" data-unsaved hidden>${icon('alert', 'icon-sm')} Alterações não salvas</span>
  <button class="btn" type="button" data-discard disabled>Descartar</button>
  <button class="btn btn--primary" type="submit">${icon('check', 'icon-sm')} Salvar</button>`;

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
    injectStyle('store', CSS);
    if (!ctx.storeId) return ctx.pickStore(view, 'Esta área configura uma loja específica.');
    if (!ctx.can('settings')) {
      render(view, errorBlock('Você não tem permissão para alterar os dados desta loja. Fale com o administrador da loja.'));
      return;
    }
    render(view, loading('Carregando dados da loja…'));

    let store;
    let maxRadius = 30;
    try {
      const [s, net] = await Promise.all([
        q(sb.from('stores').select('*').eq('id', ctx.storeId).single()),
        sb
          .from('network_settings')
          .select('default_radius_km')
          .maybeSingle()
          .then((r) => r.data)
          .catch(() => null),
      ]);
      store = s;
      maxRadius = Number(net?.default_radius_km) || 30;
    } catch (e) {
      render(view, errorBlock(storeError(e)));
      return;
    }
    if (!view.isConnected) return;

    const isGlobal = ctx.isGlobal;
    let tab = TABS.some((t) => t.id === ctx.args[0]) ? ctx.args[0] : 'dados';
    const dirty = new Set();
    const maps = {};
    let tiers = [...(store.delivery_fee_tiers || [])]
      .map((t) => ({ up_to_km: Number(t.up_to_km), fee: Number(t.fee) }))
      .sort((a, b) => a.up_to_km - b.up_to_km);

    ctx.setActions(
      html`<a class="btn btn--sm" href="${storefrontUrl(store.slug)}" target="_blank" rel="noopener" data-store-link aria-label="Ver loja virtual" title="Ver loja virtual">${icon('external', 'icon-sm')}<span class="stcfg-hide-sm">Ver loja virtual</span></a>`
    );

    render(
      view,
      html`<div class="stcfg">
        <div class="card stcfg__summary" data-summary></div>
        <div class="tabs" role="tablist" aria-label="Configurações da loja">
          ${TABS.map(
            (t) => html`<button class="tab ${t.id === tab ? 'is-active' : ''}" type="button" role="tab" id="st-tab-${t.id}" aria-controls="st-panel-${t.id}" aria-selected="${t.id === tab ? 'true' : 'false'}" tabindex="${t.id === tab ? '0' : '-1'}" data-tab="${t.id}">${t.label}<span class="stcfg__dot" data-dot="${t.id}" hidden><span class="visually-hidden">(alterações não salvas)</span></span></button>`
          )}
        </div>
        ${TABS.map(
          (t) => html`<section class="stcfg__panel" role="tabpanel" id="st-panel-${t.id}" aria-labelledby="st-tab-${t.id}" data-panel="${t.id}" ${t.id === tab ? '' : 'hidden'}></section>`
        )}
      </div>`
    );

    const panel = (id) => $(`[data-panel="${id}"]`, view);
    const formOf = (id) => $(`form[data-form="${id}"]`, view);

    /* ---------- Resumo e pendências ---------- */
    function todo() {
      const list = [];
      if (!store.whatsapp) list.push(['dados', 'WhatsApp']);
      if (!store.street || !store.number) list.push(['endereco', 'endereço']);
      if (store.lat == null || store.lng == null) list.push(['endereco', 'localização no mapa']);
      if ((store.payment_methods || []).includes('pix') && !store.pix_key) list.push(['pagamento', 'chave PIX']);
      return list;
    }
    function drawSummary() {
      const pend = todo();
      render(
        $('[data-summary]', view),
        html`<div class="stcfg__who">
            <span class="stcfg__icon">${icon('store')}</span>
            <div class="grow">
              <div class="h2">${store.name}</div>
              <div class="muted small">${store.city}/${store.state} · ${store.brand_name} · <a href="${storefrontUrl(store.slug)}" target="_blank" rel="noopener">/loja/${store.slug}</a></div>
            </div>
          </div>
          <div class="row stcfg__badges">
            ${store.active ? badge('Ativa na loja virtual', 'success') : badge('Inativa', 'dark')}
            ${store.accepts_orders ? badge('Recebendo pedidos', 'success') : badge('Pedidos pausados', 'warning')}
            ${store.lat != null && store.lng != null ? badge(`Entrega em ${km(store.delivery_radius_km)} km`, 'info') : badge('Sem localização', 'warning')}
          </div>
          ${pend.length
            ? html`<div class="row stcfg__todo small" style="width:100%">
                <span class="muted">${icon('alert', 'icon-sm')}</span><span class="muted">Complete o cadastro:</span>
                ${pend.map(([t, label]) => html`<button class="btn btn--sm" type="button" data-goto="${t}">${label}</button>`)}
              </div>`
            : ''}`
      );
    }

    /* ---------- Estado "alterado" por aba ---------- */
    function setDirty(id, on) {
      if (on) dirty.add(id);
      else dirty.delete(id);
      const dot = $(`[data-dot="${id}"]`, view);
      if (dot) dot.hidden = !on;
      const form = formOf(id);
      if (!form) return;
      const u = $('[data-unsaved]', form);
      if (u) u.hidden = !on;
      const d = $('[data-discard]', form);
      if (d) d.disabled = !on;
    }
    const onBeforeUnload = (e) => {
      if (!dirty.size) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    ctx.onCleanup(() => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      Object.keys(maps).forEach(destroyMap);
    });

    /* ---------- Abas ---------- */
    function activate(id, focus = false) {
      tab = id;
      $$('[data-tab]', view).forEach((b) => {
        const on = b.dataset.tab === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
        if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      $$('[data-panel]', view).forEach((p) => (p.hidden = p.dataset.panel !== id));
      try {
        history.replaceState(null, '', `#/store/${id}`);
      } catch {
        /* sem histórico */
      }
      if (id === 'endereco') ensureAddrMap();
      if (id === 'entrega') ensureDeliveryMap();
    }

    /* ---------- Mapas ---------- */
    function destroyMap(key) {
      try {
        maps[key]?.map.remove();
      } catch {
        /* já removido */
      }
      delete maps[key];
    }
    function currentRadius() {
      const v = Number(formOf('entrega')?.delivery_radius_km?.value);
      return v > 0 ? v : Number(store.delivery_radius_km) || maxRadius;
    }
    function currentPoint() {
      const f = formOf('endereco');
      const lat = numOrNull(f?.lat?.value);
      const lng = numOrNull(f?.lng?.value);
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
      return store.lat != null && store.lng != null ? [store.lat, store.lng] : null;
    }

    function ensureAddrMap() {
      const el = $('[data-addr-map]', view);
      if (!el || maps.addr || panel('endereco').hidden) return;
      el.className = 'map stcfg__map';
      el.textContent = '';
      if (!hasLeaflet()) {
        render(el, html`<div class="stcfg__map-empty">Mapa indisponível no momento. Informe a latitude e a longitude manualmente.</div>`);
        el.classList.remove('map');
        return;
      }
      const map = baseMap(el, { zoomSnap: 0.5 });
      maps.addr = { map, marker: null, circle: null };
      const pt = currentPoint();
      if (pt) {
        map.fitBounds(window.L.latLng(pt).toBounds(currentRadius() * 2000), { padding: [10, 10] });
        setAddrPoint(pt[0], pt[1], { fromMap: false, pan: false });
      } else {
        map.setView(MG_CENTER, 7);
      }
      map.on('click', (e) => setAddrPoint(e.latlng.lat, e.latlng.lng, { fromMap: true }));
      setTimeout(() => map.invalidateSize(), 60);
    }

    function setAddrPoint(lat, lng, { fromMap = false, pan = true, zoom = null } = {}) {
      const L = window.L;
      const m = maps.addr;
      const f = formOf('endereco');
      if (fromMap && f) {
        f.lat.value = lat.toFixed(6);
        f.lng.value = lng.toFixed(6);
        setDirty('endereco', true);
        setGeoNote('Posição ajustada no mapa. Salve para aplicar.', 'ok');
      }
      if (!m) return;
      const ll = [lat, lng];
      if (!m.marker) {
        m.marker = L.marker(ll, { draggable: true, icon: pinIcon(), title: 'Localização da loja (arraste para ajustar)', alt: 'Localização da loja', autoPan: true }).addTo(m.map);
        m.marker.on('drag', () => m.circle?.setLatLng(m.marker.getLatLng()));
        m.marker.on('dragend', () => {
          const p = m.marker.getLatLng();
          setAddrPoint(p.lat, p.lng, { fromMap: true, pan: false });
        });
      } else m.marker.setLatLng(ll);
      if (!m.circle) m.circle = L.circle(ll, { radius: currentRadius() * 1000, ...radiusStyle(true), interactive: false }).addTo(m.map);
      else m.circle.setLatLng(ll);
      if (zoom) m.map.setView(ll, zoom);
      else if (pan) m.map.panTo(ll);
    }

    function ensureDeliveryMap() {
      const el = $('[data-delivery-map]', view);
      if (!el || maps.delivery || panel('entrega').hidden) return;
      el.className = 'map stcfg__map--sm';
      el.textContent = '';
      const pt = currentPoint();
      if (!pt) {
        render(el, html`<div class="stcfg__map-empty"><div>Sem localização definida.<br><button class="btn btn--sm mt-2" type="button" data-goto="endereco">Definir no mapa</button></div></div>`);
        el.classList.remove('map', 'stcfg__map--sm');
        return;
      }
      if (!hasLeaflet()) {
        render(el, html`<div class="stcfg__map-empty">Mapa indisponível no momento.</div>`);
        el.classList.remove('map', 'stcfg__map--sm');
        return;
      }
      const L = window.L;
      const map = baseMap(el, { zoomControl: true, zoomSnap: 0.25 });
      const fit = () => map.fitBounds(L.latLng(pt).toBounds(currentRadius() * 2000), { padding: [12, 12] });
      fit();
      const marker = L.marker(pt, { icon: pinIcon(), interactive: false, keyboard: false }).addTo(map);
      const circle = L.circle(pt, { radius: currentRadius() * 1000, ...radiusStyle(true), interactive: false }).addTo(map);
      maps.delivery = { map, marker, circle, fit };
      setTimeout(() => {
        if (maps.delivery?.map !== map) return;
        map.invalidateSize();
        fit();
      }, 60);
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
       Aba: Dados da loja
       ===================================================== */
    function drawDados() {
      const s = store;
      render(
        panel('dados'),
        html`<form class="card" data-form="dados" novalidate>
          <div class="card__head"><div><div class="h2">Dados da loja</div><p class="muted small">Como a loja aparece para os clientes na loja virtual.</p></div></div>
          <div class="card__body">
            <div class="form-grid">
              ${fld({ label: 'Nome da loja', name: 'name', value: s.name, required: true, cls: 'col-8', attrs: 'maxlength="120" autocomplete="organization"' })}
              ${isGlobal
                ? fld({ label: 'Marca', name: 'brand_name', value: s.brand_name, required: true, cls: 'col-4', attrs: 'maxlength="60"', hint: 'Nome da marca exibido no topo da loja virtual.' })
                : html`<div class="field col-4"><span class="label" id="st-brand-label">Marca</span><div class="stcfg__ro" aria-labelledby="st-brand-label">${s.brand_name}</div><span class="hint">Somente a administração da rede altera.</span></div>`}
              ${isGlobal
                ? fld({
                    label: 'Endereço na loja virtual (slug)',
                    name: 'slug',
                    value: s.slug,
                    required: true,
                    cls: 'col-12',
                    addon: '/loja/',
                    attrs: 'maxlength="60" autocapitalize="off" spellcheck="false" data-slug',
                    hint: html`Letras minúsculas, números e hífens. Link atual: <a href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener">${location.host}/loja/${s.slug} ↗</a>`,
                  })
                : html`<div class="field col-12"><span class="label" id="st-slug-label">Endereço na loja virtual</span>
                    <div class="stcfg__ro" aria-labelledby="st-slug-label"><a href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener">${location.host}/loja/${s.slug} ↗</a></div>
                    <span class="hint">Somente a administração da rede altera o endereço.</span></div>`}
              ${fld({ label: 'Telefone', name: 'phone', value: s.phone, cls: 'col-4', type: 'tel', placeholder: '(31) 3817-0000', attrs: 'autocomplete="tel" inputmode="tel"' })}
              ${fld({
                label: 'WhatsApp',
                name: 'whatsapp',
                value: fmtWhatsapp(s.whatsapp),
                cls: 'col-4',
                type: 'tel',
                placeholder: '+55 (31) 99999-9999',
                attrs: 'inputmode="tel" data-wa',
                hint: s.whatsapp ? `Link: wa.me/${s.whatsapp}` : 'Com DDD. O código do país (55) é incluído automaticamente.',
              })}
              ${fld({ label: 'E-mail da loja', name: 'email', value: s.email, cls: 'col-4', type: 'email', placeholder: 'contato@loja.com.br', attrs: 'autocomplete="email"' })}
              ${fld({ label: 'E-mail para avisos de pedido', name: 'notify_email', value: s.notify_email, cls: 'col-6', type: 'email', placeholder: 'pedidos@loja.com.br', hint: 'Recebe um aviso a cada novo pedido feito no site.' })}
              ${fld({
                label: 'Horário de funcionamento',
                name: 'hours',
                value: s.hours,
                cls: 'col-6',
                textarea: true,
                placeholder: 'Seg. a sex.: 8h às 18h\nSábado: 8h às 12h',
                attrs: 'rows="3" maxlength="400"',
              })}
              ${fld({ label: 'Instagram', name: 'instagram', value: s.instagram, cls: 'col-6', placeholder: '@sualoja ou https://instagram.com/sualoja', attrs: 'autocapitalize="off" spellcheck="false"' })}
              ${fld({ label: 'Facebook', name: 'facebook', value: s.facebook, cls: 'col-6', placeholder: 'https://facebook.com/sualoja', attrs: 'autocapitalize="off" spellcheck="false"' })}
            </div>
          </div>
          <div class="card__foot">${footer()}</div>
        </form>`
      );
      setDirty('dados', false);
    }

    async function saveDados(form) {
      const d = readForm(form);
      const errors = {};
      if (!d.name || d.name.length < 3) errors.name = 'Informe o nome da loja (mínimo de 3 letras).';
      if (isGlobal) {
        if (!d.brand_name) errors.brand_name = 'Informe a marca.';
        if (!d.slug) errors.slug = 'Informe o endereço da loja virtual.';
        else if (!SLUG_RE.test(d.slug)) errors.slug = 'Use só letras minúsculas, números e hífens (ex.: ponte-nova).';
        else if (ctx.stores.some((x) => x.id !== store.id && x.slug === d.slug)) errors.slug = 'Já existe outra loja com este endereço.';
      }
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
      if (!showErrors(form, errors)) return;

      const patch = {
        name: d.name,
        phone: d.phone ? fmtPhone(phoneDigits) : null,
        whatsapp: wa || null,
        email: d.email ? d.email.toLowerCase() : null,
        notify_email: d.notify_email ? d.notify_email.toLowerCase() : null,
        hours: d.hours,
        instagram,
        facebook,
      };
      if (isGlobal) {
        patch.brand_name = d.brand_name;
        patch.slug = d.slug;
        if (d.slug !== store.slug) {
          const ok = await confirmDialog({
            title: 'Alterar o endereço da loja virtual?',
            message: `O link passará de /loja/${store.slug} para /loja/${d.slug}. Links antigos divulgados (WhatsApp, Instagram, QR codes) deixarão de funcionar.`,
            confirmLabel: 'Alterar endereço',
          });
          if (!ok) return;
        }
      }
      const before = { name: store.name, slug: store.slug, brand_name: store.brand_name };
      const saved = await save(form, patch);
      if (!saved) return;
      drawDados();
      if (saved.name !== before.name || saved.slug !== before.slug || saved.brand_name !== before.brand_name) await syncShell();
    }

    /* =====================================================
       Aba: Endereço e mapa
       ===================================================== */
    function drawEndereco() {
      destroyMap('addr');
      const s = store;
      render(
        panel('endereco'),
        html`<form class="card" data-form="endereco" novalidate>
          <div class="card__head"><div><div class="h2">Endereço e mapa</div><p class="muted small">O raio de entrega é medido a partir do ponto marcado no mapa.</p></div></div>
          <div class="card__body">
            <fieldset class="fieldset">
              <legend class="fieldset__title">Endereço</legend>
              <div class="form-grid">
                <div class="field col-4">
                  <label for="st-cep">CEP</label>
                  <div class="stcfg__inline">
                    <input class="input" id="st-cep" name="cep" value="${s.cep ? fmtCep(s.cep) : ''}" placeholder="00000-000" inputmode="numeric" autocomplete="postal-code" maxlength="9" data-cep>
                    <button class="btn" type="button" data-cep-search>${icon('search', 'icon-sm')} Buscar</button>
                  </div>
                </div>
                ${fld({ label: 'Número', name: 'number', value: s.number, cls: 'col-2', attrs: 'maxlength="20"' })}
                ${fld({ label: 'Complemento', name: 'complement', value: s.complement, cls: 'col-6', placeholder: 'Loja 2, sala…', attrs: 'maxlength="80"' })}
                ${fld({ label: 'Rua / avenida', name: 'street', value: s.street, cls: 'col-8', attrs: 'maxlength="120" autocomplete="address-line1"' })}
                ${fld({ label: 'Bairro', name: 'district', value: s.district, cls: 'col-4', attrs: 'maxlength="80"' })}
                ${fld({ label: 'Cidade', name: 'city', value: s.city, required: true, cls: 'col-8', attrs: 'maxlength="80" autocomplete="address-level2"' })}
                <div class="field col-4">
                  <label for="st-state">UF *</label>
                  <select class="select" id="st-state" name="state" required>${selectOptions(UFS.map((u) => [u, u]), s.state)}</select>
                </div>
              </div>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset__title">Localização no mapa</legend>
              <p class="muted small mb-2">Arraste o marcador até a porta da loja ou clique no mapa. O círculo mostra o raio de entrega.</p>
              <div class="map stcfg__map" data-addr-map role="region" aria-label="Mapa: arraste o marcador para definir a localização da loja"></div>
              <div class="form-grid mt-3">
                ${fld({ label: 'Latitude', name: 'lat', value: s.lat ?? '', cls: 'col-4', type: 'number', attrs: 'step="any" min="-90" max="90" inputmode="decimal" data-type="number" data-coord', placeholder: '-20.414922' })}
                ${fld({ label: 'Longitude', name: 'lng', value: s.lng ?? '', cls: 'col-4', type: 'number', attrs: 'step="any" min="-180" max="180" inputmode="decimal" data-type="number" data-coord', placeholder: '-42.899446' })}
                <div class="field col-4 stcfg__geo"><button class="btn" type="button" data-geo-address style="width:100%">${icon('map', 'icon-sm')} Localizar pelo endereço</button></div>
                <div class="col-12 stcfg__note" data-geo-note aria-live="polite">${s.lat == null || s.lng == null ? 'A loja ainda não tem localização: use “Buscar” no CEP ou clique no mapa.' : ''}</div>
              </div>
            </fieldset>
          </div>
          <div class="card__foot">${footer()}</div>
        </form>`
      );
      setDirty('endereco', false);
      if (tab === 'endereco') ensureAddrMap();
    }

    function setGeoNote(text, tone = '') {
      const el = $('[data-geo-note]', view);
      if (!el) return;
      el.className = `col-12 stcfg__note ${tone ? `stcfg__note--${tone}` : ''}`;
      el.textContent = text;
    }

    async function geocode(btn, body, { fillAddress }) {
      const form = formOf('endereco');
      try {
        // busca pelo CEP é estrita; "Localizar pelo endereço" aceita o OpenStreetMap como reserva
        const r = await withBusy(btn, () => geocodeAddress(body, { fallback: !fillAddress }));
        if (!r || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng))) throw new Error('Não conseguimos localizar este endereço.');
        if (fillAddress && r.address) {
          const a = r.address;
          if (a.street) form.street.value = a.street;
          if (a.district) form.district.value = a.district;
          if (a.city) form.city.value = a.city;
          if (a.state && UFS.includes(String(a.state).toUpperCase())) form.state.value = String(a.state).toUpperCase();
        }
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        form.lat.value = lat.toFixed(6);
        form.lng.value = lng.toFixed(6);
        setDirty('endereco', true);
        setAddrPoint(lat, lng, { zoom: r.precision === 'city' ? 13 : 16 });
        setGeoNote(`${GEO_PRECISION[r.precision] || 'Localização encontrada.'} Salve para aplicar.`, r.precision === 'city' || r.precision === 'cep' ? 'warn' : 'ok');
        if (fillAddress && !form.number.value) form.number.focus();
      } catch (e) {
        toastError(e);
        setGeoNote(e.message || 'Não conseguimos localizar este endereço.', 'warn');
      }
    }

    function searchCep() {
      const form = formOf('endereco');
      const c = digits(form.cep.value);
      if (c.length !== 8) {
        showErrors(form, { cep: 'Informe os 8 dígitos do CEP.' });
        return;
      }
      showErrors(form, {});
      geocode($('[data-cep-search]', form), { cep: c, number: form.number.value.trim() }, { fillAddress: true });
    }

    function locateByAddress() {
      const form = formOf('endereco');
      const d = readForm(form);
      if (!d.city) {
        showErrors(form, { city: 'Informe a cidade.' });
        return;
      }
      showErrors(form, {});
      const c = digits(d.cep);
      geocode(
        $('[data-geo-address]', form),
        { cep: c.length === 8 ? c : undefined, street: d.street || '', number: d.number || '', district: d.district || '', city: d.city, state: d.state },
        { fillAddress: false }
      );
    }

    async function saveEndereco(form) {
      const d = readForm(form);
      const errors = {};
      const c = digits(d.cep);
      if (d.cep && c.length !== 8) errors.cep = 'CEP inválido: informe os 8 dígitos.';
      if (!d.city) errors.city = 'Informe a cidade.';
      if (!UFS.includes(d.state || '')) errors.state = 'Escolha a UF.';
      const hasLat = d.lat !== null && d.lat !== undefined;
      const hasLng = d.lng !== null && d.lng !== undefined;
      if (hasLat !== hasLng) errors[hasLat ? 'lng' : 'lat'] = 'Informe latitude e longitude juntas.';
      if (hasLat && !(d.lat >= -34 && d.lat <= 6)) errors.lat = 'Latitude fora do Brasil (entre -34 e 6). Confira se não trocou com a longitude.';
      if (hasLng && !(d.lng >= -74 && d.lng <= -34)) errors.lng = 'Longitude fora do Brasil (entre -74 e -34).';
      if (!showErrors(form, errors)) return;
      if (!hasLat && store.lat != null) {
        const ok = await confirmDialog({
          title: 'Remover a localização?',
          message: 'Sem localização a loja não consegue calcular o raio de entrega e não aparece para clientes que buscam pelo CEP.',
          confirmLabel: 'Remover localização',
          danger: true,
        });
        if (!ok) return;
      }
      const patch = {
        cep: c || null,
        street: d.street,
        number: d.number,
        complement: d.complement,
        district: d.district,
        city: d.city,
        state: d.state,
        lat: hasLat ? d.lat : null,
        lng: hasLng ? d.lng : null,
      };
      const before = { city: store.city, state: store.state };
      const saved = await save(form, patch);
      if (!saved) return;
      drawEndereco();
      destroyMap('delivery');
      drawEntregaPreview();
      if (saved.city !== before.city || saved.state !== before.state) await syncShell();
      if (saved.lat == null) toast('Loja sem localização: o raio de entrega não será calculado.', 'warning', 6000);
    }

    /* =====================================================
       Aba: Entrega
       ===================================================== */
    function tierRows() {
      return tiers.map((t, i) => {
        const prev = i > 0 ? Number(tiers[i - 1].up_to_km) : 0;
        return html`<li class="stcfg-tier" data-tier="${i}">
          <span class="stcfg-tier__range" data-tier-range>${tierRangeLabel(prev, Number(t.up_to_km))}</span>
          <div class="field">
            <label class="visually-hidden" for="st-tier-km-${i}">Faixa ${i + 1}: distância máxima em km</label>
            <div class="input-group"><span class="input-group__addon" data-pre>até</span><input class="input" id="st-tier-km-${i}" name="tier_km_${i}" type="number" min="0.1" step="0.1" inputmode="decimal" value="${t.up_to_km ?? ''}" data-tier-km><span class="input-group__addon">km</span></div>
          </div>
          <div class="field">
            <label class="visually-hidden" for="st-tier-fee-${i}">Faixa ${i + 1}: valor do frete em reais</label>
            <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="st-tier-fee-${i}" name="tier_fee_${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${Number.isFinite(Number(t.fee)) && t.fee !== null ? Number(t.fee).toFixed(2) : ''}" data-tier-fee></div>
          </div>
          <button class="btn btn--ghost btn--icon" type="button" data-tier-remove="${i}" aria-label="Remover faixa ${i + 1}" title="Remover faixa" ${tiers.length <= 1 ? 'disabled' : ''}>${icon('trash')}</button>
        </li>`;
      });
    }

    function drawEntrega() {
      destroyMap('delivery');
      const s = store;
      tiers = [...(s.delivery_fee_tiers || [])].map((t) => ({ up_to_km: Number(t.up_to_km), fee: Number(t.fee) })).sort((a, b) => a.up_to_km - b.up_to_km);
      if (!tiers.length) tiers = [{ up_to_km: Number(s.delivery_radius_km) || maxRadius, fee: 0 }];
      const radiusMax = isGlobal ? 500 : maxRadius;
      render(
        panel('entrega'),
        html`<div class="split">
          <form class="card" data-form="entrega" novalidate>
            <div class="card__head"><div><div class="h2">Entrega</div><p class="muted small">Até onde a loja entrega e quanto cobra de frete.</p></div></div>
            <div class="card__body">
              <fieldset class="fieldset">
                <legend class="fieldset__title">Área de entrega</legend>
                <div class="form-grid">
                  ${fld({
                    label: 'Raio de entrega',
                    name: 'delivery_radius_km',
                    value: Number(s.delivery_radius_km),
                    type: 'number',
                    required: true,
                    cls: 'col-6',
                    addonEnd: 'km',
                    attrs: `min="1" max="${radiusMax}" step="0.5" inputmode="decimal" data-type="number" data-radius`,
                    hint: isGlobal
                      ? `Limite da rede para as lojas: ${km(maxRadius)} km. Como administrador da rede você pode definir até 500 km.`
                      : `Máximo permitido pela rede: ${km(maxRadius)} km.`,
                  })}
                  ${fld({ label: 'Prazo de entrega', name: 'delivery_lead_time', value: s.delivery_lead_time, cls: 'col-6', placeholder: 'Entrega em até 5 dias úteis', attrs: 'maxlength="160"', hint: 'Aparece no carrinho e no acompanhamento do pedido.' })}
                </div>
              </fieldset>
              <fieldset class="fieldset">
                <legend class="fieldset__title">Faixas de frete</legend>
                <p class="muted small mb-3">O cliente paga o frete da primeira faixa que alcança a distância até a casa dele. A última faixa precisa chegar ao raio de entrega. Use R$ 0 para frete grátis.</p>
                <div class="stcfg-tiers__head" aria-hidden="true"><span>Distância</span><span>Até</span><span>Frete</span><span></span></div>
                <ul class="stcfg-tiers mt-2" data-tiers>${tierRows()}</ul>
                <div class="stcfg-tiers__error mt-2" data-tiers-error role="alert"></div>
                <button class="btn btn--sm mt-2" type="button" data-tier-add>${icon('plus', 'icon-sm')} Adicionar faixa</button>
              </fieldset>
              <fieldset class="fieldset">
                <legend class="fieldset__title">Valores</legend>
                <div class="form-grid">
                  ${fld({ label: 'Frete grátis a partir de', name: 'free_shipping_min', value: s.free_shipping_min != null ? Number(s.free_shipping_min).toFixed(2) : '', type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Opcional. Deixe vazio para não oferecer.' })}
                  ${fld({ label: 'Pedido mínimo', name: 'min_order_value', value: (Number(s.min_order_value) || 0).toFixed(2), type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Use 0 para não exigir valor mínimo.' })}
                </div>
              </fieldset>
            </div>
            <div class="card__foot">${footer()}</div>
          </form>
          <aside class="card" aria-label="Prévia da área de entrega">
            <div class="card__head"><div class="h3">Prévia</div><span class="muted small" data-radius-label></span></div>
            <div class="card__body stack" style="--gap:14px">
              <div class="map stcfg__map--sm" data-delivery-map role="region" aria-label="Mapa com o raio de entrega da loja"></div>
              <ul class="stcfg-sum small" data-delivery-sum></ul>
            </div>
          </aside>
        </div>`
      );
      setDirty('entrega', false);
      drawEntregaPreview();
      if (tab === 'entrega') ensureDeliveryMap();
    }

    function readTierInputs() {
      return $$('[data-tier]', panel('entrega')).map((row) => ({
        up_to_km: numOrNull($('[data-tier-km]', row).value),
        fee: numOrNull($('[data-tier-fee]', row).value),
      }));
    }

    function drawEntregaPreview() {
      const form = formOf('entrega');
      const sumEl = $('[data-delivery-sum]', view);
      if (!form || !sumEl) return;
      const radius = currentRadius();
      const list = readTierInputs()
        .filter((t) => t.up_to_km > 0)
        .sort((a, b) => a.up_to_km - b.up_to_km);
      // rótulos de faixa em cada linha (seguem a ordem digitada)
      $$('[data-tier]', form).forEach((row, i, rows) => {
        const cur = numOrNull($('[data-tier-km]', row).value);
        const prev = i > 0 ? numOrNull($('[data-tier-km]', rows[i - 1]).value) || 0 : 0;
        $('[data-tier-range]', row).textContent = tierRangeLabel(prev, cur);
      });
      const freeMin = numOrNull(form.free_shipping_min.value);
      const minOrder = numOrNull(form.min_order_value.value);
      const lead = form.delivery_lead_time.value.trim();
      const items = [];
      let prev = 0;
      for (const t of list) {
        if (prev >= radius) break;
        const upto = Math.min(t.up_to_km, radius);
        items.push(html`<li><span>${prev > 0 ? `${km(prev)} a ${km(upto)} km` : `Até ${km(upto)} km`}</span><strong>${t.fee > 0 ? money(t.fee) : 'Grátis'}</strong></li>`);
        prev = t.up_to_km;
      }
      if (list.length && prev < radius) items.push(html`<li class="stcfg__note--warn"><span>${km(prev)} a ${km(radius)} km</span><strong>sem faixa</strong></li>`);
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

    function validateTiers(form, radius, errors) {
      const rows = readTierInputs();
      const errEl = $('[data-tiers-error]', form);
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

    async function saveEntrega(form) {
      const d = readForm(form);
      const errors = {};
      const radius = d.delivery_radius_km;
      if (!(radius > 0)) errors.delivery_radius_km = 'Informe o raio de entrega em km.';
      else if (!isGlobal && radius > maxRadius) errors.delivery_radius_km = `O máximo permitido pela rede é ${km(maxRadius)} km.`;
      else if (radius > 500) errors.delivery_radius_km = 'O raio máximo é de 500 km.';
      if (d.free_shipping_min !== null && !(d.free_shipping_min >= 0)) errors.free_shipping_min = 'Valor inválido.';
      if (d.min_order_value !== null && !(d.min_order_value >= 0)) errors.min_order_value = 'Valor inválido.';
      // a cobertura das faixas só é conferida com um raio válido
      const t = validateTiers(form, errors.delivery_radius_km ? 0 : radius, errors);
      const okFields = showErrors(form, errors);
      if (!okFields || !t.ok) {
        if (okFields && !t.ok) $('[data-tiers-error]', form)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (isGlobal && radius > maxRadius) {
        const ok = await confirmDialog({
          title: 'Raio acima do limite da rede',
          message: `O limite da rede é ${km(maxRadius)} km e você definiu ${km(radius)} km. A equipe da loja não conseguirá salvar outras alterações de entrega sem reduzir o raio. Continuar?`,
          confirmLabel: 'Salvar mesmo assim',
        });
        if (!ok) return;
      }
      const patch = {
        delivery_radius_km: radius,
        delivery_fee_tiers: t.sorted.map((x) => ({ up_to_km: round2(x.up_to_km), fee: round2(x.fee) })),
        free_shipping_min: d.free_shipping_min,
        min_order_value: d.min_order_value ?? 0,
        delivery_lead_time: d.delivery_lead_time,
      };
      const saved = await save(form, patch);
      if (!saved) return;
      drawEntrega();
      updateRadius();
    }

    /* =====================================================
       Aba: Pagamento
       ===================================================== */
    function drawPagamento() {
      const s = store;
      const methods = s.payment_methods || [];
      const pixOn = methods.includes('pix');
      render(
        panel('pagamento'),
        html`<div class="split">
          <form class="card" data-form="pagamento" novalidate>
            <div class="card__head"><div><div class="h2">Pagamento</div><p class="muted small">Formas aceitas, chave PIX e parcelamento.</p></div></div>
            <div class="card__body">
              <fieldset class="fieldset">
                <legend class="fieldset__title">Formas aceitas</legend>
                <div class="field" role="group" aria-label="Formas de pagamento aceitas">
                  <div class="stcfg-pm">
                    ${METHODS.map(
                      (m) => html`<label class="check"><input type="checkbox" name="payment_methods" value="${m}" data-type="array" ${methods.includes(m) ? 'checked' : ''}>
                        <span><strong>${PAYMENT_METHOD[m]}</strong><br><span class="muted small">${METHOD_HINT[m]}</span></span></label>`
                    )}
                  </div>
                </div>
              </fieldset>
              <fieldset class="fieldset">
                <legend class="fieldset__title">PIX</legend>
                <div class="alert alert--warning mb-3" data-pix-off ${pixOn ? 'hidden' : ''}>${icon('alert')}<div>PIX desativado: os clientes não verão o preço com desconto no PIX.</div></div>
                <div class="form-grid">
                  <div class="field col-4">
                    <label for="st-pix_key_type">Tipo da chave<span data-pix-req ${pixOn ? '' : 'hidden'}> *</span></label>
                    <select class="select" id="st-pix_key_type" name="pix_key_type"><option value="">Selecione…</option>${selectOptions(PIX_TYPES, s.pix_key_type)}</select>
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
                <legend class="fieldset__title">Parcelamento no cartão</legend>
                <div class="form-grid">
                  <div class="field col-6">
                    <label for="st-max_installments">Parcelas sem juros (máximo)</label>
                    <select class="select" id="st-max_installments" name="max_installments" data-type="int">${selectOptions(
                      Array.from({ length: 24 }, (_, i) => [i + 1, i === 0 ? '1x (à vista)' : `${i + 1}x`]),
                      s.max_installments
                    )}</select>
                  </div>
                  ${fld({ label: 'Parcela mínima', name: 'min_installment_value', value: (Number(s.min_installment_value) || 0).toFixed(2), type: 'number', cls: 'col-6', addon: 'R$', attrs: 'min="0" step="0.01" inputmode="decimal" data-type="number"', hint: 'Menos parcelas em produtos baratos.' })}
                </div>
              </fieldset>
            </div>
            <div class="card__foot">${footer()}</div>
          </form>
          <aside class="card" aria-label="Exemplo de preço na loja virtual">
            <div class="card__head"><div class="h3">Exemplo na loja virtual</div></div>
            <div class="card__body stack" style="--gap:12px">
              <div class="field">
                <label for="st-sim-price">Preço do produto (cartão)</label>
                <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="st-sim-price" type="number" min="0" step="0.01" value="1000" inputmode="decimal" data-sim-price></div>
              </div>
              <div class="stcfg-sim" data-sim aria-live="polite"></div>
            </div>
          </aside>
        </div>`
      );
      setDirty('pagamento', false);
      drawPaymentPreview();
    }

    function drawPaymentPreview() {
      const form = formOf('pagamento');
      const el = $('[data-sim]', view);
      if (!form || !el) return;
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
      $('[data-pix-off]', form).hidden = pixOn;
      $$('[data-pix-req]', form).forEach((x) => (x.hidden = !pixOn));
      render(
        el,
        html`${pixOn
            ? html`<div class="stcfg-sim__pix"><strong>${money(pix)}</strong><span class="muted">no PIX</span>${pct > 0 ? badge(`${String(pct).replace('.', ',')}% off`, 'success') : ''}</div>
              <div class="muted mt-1">ou ${money(price)} ${n > 1 ? html`em até <strong>${n}x de ${money(parcel)}</strong> sem juros` : 'à vista no cartão'}</div>`
            : html`<div class="stcfg-sim__pix"><strong>${money(price)}</strong></div>
              <div class="muted mt-1">${n > 1 ? html`em até <strong>${n}x de ${money(parcel)}</strong> sem juros` : 'à vista no cartão'}</div>`}
          ${methods.length
            ? html`<div class="small muted mt-2">Aceita: ${methods.map((m) => PAYMENT_METHOD[m]).join(' · ')}</div>`
            : html`<div class="small stcfg__note--warn mt-2">Escolha pelo menos uma forma de pagamento.</div>`}`
      );
    }

    async function savePagamento(form) {
      const d = readForm(form);
      const errors = {};
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
        if (!d.pix_key) errors.pix_key = 'Informe a chave PIX (obrigatória com PIX ativo).';
        if (!d.pix_holder) errors.pix_holder = 'Informe o titular da conta.';
      }
      if (d.pix_discount_pct === null || !(d.pix_discount_pct >= 0 && d.pix_discount_pct <= 50)) errors.pix_discount_pct = 'Use um valor entre 0 e 50.';
      if (!(d.max_installments >= 1 && d.max_installments <= 24)) errors.max_installments = 'Escolha de 1 a 24 parcelas.';
      if (d.min_installment_value === null || !(d.min_installment_value >= 0)) errors.min_installment_value = 'Valor inválido.';
      if (!showErrors(form, errors)) return;
      const patch = {
        payment_methods: METHODS.filter((m) => methods.includes(m)),
        pix_key_type: pixKey ? d.pix_key_type : null,
        pix_key: pixKey,
        pix_holder: d.pix_holder,
        pix_discount_pct: d.pix_discount_pct,
        max_installments: d.max_installments,
        min_installment_value: d.min_installment_value,
      };
      const saved = await save(form, patch);
      if (!saved) return;
      drawPagamento();
    }

    /* =====================================================
       Aba: Funcionamento
       ===================================================== */
    function drawFuncionamento() {
      const s = store;
      render(
        panel('funcionamento'),
        html`<form class="card" data-form="funcionamento" novalidate>
          <div class="card__head"><div><div class="h2">Funcionamento</div><p class="muted small">Pause os pedidos pelo site quando a loja não puder atender.</p></div></div>
          <div class="card__body stack">
            <div class="stcfg-switch-row stack" style="--gap:12px">
              <label class="switch">
                <input type="checkbox" name="accepts_orders" ${s.accepts_orders ? 'checked' : ''} data-accepts>
                <span class="switch__track"></span>
                <span><strong>Aceitar pedidos pelo site</strong><br><span class="muted small">Desligado, a vitrine continua no ar, mas o carrinho não finaliza pedidos.</span></span>
              </label>
              ${fld({
                label: 'Mensagem quando os pedidos estiverem pausados',
                name: 'closed_message',
                value: s.closed_message,
                cls: '',
                textarea: true,
                placeholder: 'Ex.: Estamos em inventário até segunda-feira. Fale com a gente pelo WhatsApp.',
                attrs: 'rows="3" maxlength="300"',
                hint: 'Opcional. Sem mensagem, a loja virtual mostra “Esta loja não está recebendo pedidos pelo site agora.”',
              })}
            </div>
            <div class="stcfg-switch-row">
              <label class="switch">
                <input type="checkbox" name="active" ${s.active ? 'checked' : ''} ${isGlobal ? '' : 'disabled'} aria-describedby="st-active-hint">
                <span class="switch__track"></span>
                <span><strong>Loja ativa na loja virtual</strong><br><span class="muted small" id="st-active-hint">${
                  isGlobal
                    ? 'Inativa, a loja some da loja virtual e da busca por CEP. A equipe continua acessando o painel.'
                    : `Status atual: ${s.active ? 'ativa' : 'inativa'}. Somente a administração da rede altera.`
                }</span></span>
              </label>
            </div>
          </div>
          <div class="card__foot">${footer()}</div>
        </form>`
      );
      setDirty('funcionamento', false);
    }

    async function saveFuncionamento(form) {
      const d = readForm(form);
      if (d.closed_message && d.closed_message.length > 300) {
        showErrors(form, { closed_message: 'Use no máximo 300 caracteres.' });
        return;
      }
      showErrors(form, {});
      const patch = { accepts_orders: !!d.accepts_orders, closed_message: d.closed_message };
      if (isGlobal) {
        patch.active = !!d.active;
        if (store.active && !patch.active) {
          const ok = await confirmDialog({
            title: 'Desativar a loja?',
            message: `${store.name} deixará de aparecer na loja virtual e na busca por CEP. Pedidos em andamento continuam no painel.`,
            confirmLabel: 'Desativar loja',
            danger: true,
          });
          if (!ok) return;
        }
      }
      const before = store.active;
      const saved = await save(form, patch);
      if (!saved) return;
      drawFuncionamento();
      if (saved.active !== before) await syncShell();
    }

    /* ---------- Gravação ---------- */
    async function save(form, patch) {
      try {
        const saved = await withBusy($('[type="submit"]', form), () => q(sb.from('stores').update(patch).eq('id', store.id).select('*').single()));
        Object.assign(store, saved);
        const cached = ctx.stores.find((x) => x.id === store.id);
        if (cached && cached !== store) Object.assign(cached, saved);
        setDirty(form.dataset.form, false);
        drawSummary();
        toast('Alterações salvas.', 'success');
        return saved;
      } catch (e) {
        toastError(storeError(e));
        return null;
      }
    }

    // Nome, cidade, slug e status aparecem no seletor de lojas e no topo.
    async function syncShell() {
      try {
        await ctx.reloadStores();
      } catch {
        /* a lista volta na próxima navegação */
      }
      ctx.setTitle(TITLE, store.name);
      const href = storefrontUrl(store.slug);
      $$('[data-store-link]').forEach((a) => a.setAttribute('href', href));
      const foot = $('.sidebar__foot a');
      if (foot && ctx.storeId === store.id) foot.setAttribute('href', href);
    }

    /* ---------- Eventos ---------- */
    const SAVE = { dados: saveDados, endereco: saveEndereco, entrega: saveEntrega, pagamento: savePagamento, funcionamento: saveFuncionamento };
    const DRAW = { dados: drawDados, endereco: drawEndereco, entrega: drawEntrega, pagamento: drawPagamento, funcionamento: drawFuncionamento };

    view.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();
      SAVE[form.dataset.form]?.(form);
    });

    view.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) return activate(t.dataset.tab);
      const g = e.target.closest('[data-goto]');
      if (g) {
        activate(g.dataset.goto);
        panel(g.dataset.goto)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      const discard = e.target.closest('[data-discard]');
      if (discard) {
        const id = discard.closest('form[data-form]').dataset.form;
        DRAW[id]();
        if (id === 'endereco') {
          destroyMap('delivery');
          if (tab === 'entrega') ensureDeliveryMap();
        }
        if (id === 'entrega') updateRadius();
        toast('Alterações descartadas.');
        return;
      }
      if (e.target.closest('[data-cep-search]')) return searchCep();
      if (e.target.closest('[data-geo-address]')) return locateByAddress();
      if (e.target.closest('[data-tier-add]')) {
        const cur = readTierInputs();
        tiers = cur.map((x) => ({ up_to_km: x.up_to_km, fee: x.fee }));
        if (tiers.length >= 10) return toast('Use no máximo 10 faixas de frete.', 'warning');
        const last = tiers[tiers.length - 1];
        const radius = currentRadius();
        const nextKm = last ? Math.min(500, (Number(last.up_to_km) || 0) < radius ? radius : (Number(last.up_to_km) || 0) + 10) : radius;
        tiers.push({ up_to_km: nextKm, fee: last ? Number(last.fee) || 0 : 0 });
        render($('[data-tiers]', view), tierRows());
        setDirty('entrega', true);
        drawEntregaPreview();
        $(`#st-tier-km-${tiers.length - 1}`, view)?.focus();
        return;
      }
      const rm = e.target.closest('[data-tier-remove]');
      if (rm) {
        const cur = readTierInputs();
        if (cur.length <= 1) return;
        cur.splice(Number(rm.dataset.tierRemove), 1);
        tiers = cur;
        render($('[data-tiers]', view), tierRows());
        $('[data-tiers-error]', view).textContent = '';
        setDirty('entrega', true);
        drawEntregaPreview();
      }
    });

    view.addEventListener('keydown', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        const i = TABS.findIndex((x) => x.id === t.dataset.tab);
        const n =
          e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        activate(TABS[n].id, true);
        return;
      }
      if (e.key === 'Enter' && e.target.matches('[data-cep]')) {
        e.preventDefault();
        searchCep();
      }
    });

    const onEdit = (e) => {
      const form = e.target.closest('form[data-form]');
      if (form) setDirty(form.dataset.form, true);
      if (form && e.target.name && e.target.getAttribute('aria-invalid')) {
        // o erro some assim que o campo é corrigido
        e.target.removeAttribute('aria-invalid');
        $$(`.error[data-for="${e.target.name}"]`, form).forEach((x) => x.remove());
      }
      if (e.target.matches('[data-cep]') && e.type === 'input') e.target.value = maskCep(e.target.value);
      if (e.target.matches('[data-wa]') && e.type === 'input') {
        const h = $('#st-whatsapp-hint', view);
        const wa = normalizeWhatsapp(e.target.value);
        if (h) h.textContent = !e.target.value ? 'Com DDD. O código do país (55) é incluído automaticamente.' : whatsappOk(wa) ? `Link: wa.me/${wa}` : 'Informe DDD + número.';
      }
      if (e.target.matches('[data-slug]') && e.type === 'input') {
        e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '-');
      }
      if (e.target.matches('[data-coord]')) {
        const f = formOf('endereco');
        const lat = numOrNull(f.lat.value);
        const lng = numOrNull(f.lng.value);
        if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) setAddrPoint(lat, lng, { pan: true });
      }
      if (e.target.matches('[data-radius]')) updateRadius();
      if (form?.dataset.form === 'entrega') drawEntregaPreview();
      if (form?.dataset.form === 'pagamento' || e.target.matches('[data-sim-price]')) {
        if (e.target.name === 'pix_key_type') e.target.form.pix_key.placeholder = PIX_PLACEHOLDER[e.target.value || ''];
        drawPaymentPreview();
      }
    };
    view.addEventListener('input', onEdit);
    view.addEventListener('change', onEdit);
    view.addEventListener(
      'blur',
      (e) => {
        if (e.target.matches?.('[data-wa]')) {
          const wa = normalizeWhatsapp(e.target.value);
          if (whatsappOk(wa)) e.target.value = fmtWhatsapp(wa);
        }
      },
      true
    );

    /* ---------- Primeira pintura ---------- */
    drawSummary();
    drawDados();
    drawEndereco();
    drawEntrega();
    drawPagamento();
    drawFuncionamento();
    activate(tab);
  },
};
