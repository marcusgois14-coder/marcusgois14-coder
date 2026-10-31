// Utilitários compartilhados da loja virtual: formatação, armazenamento, imagens e acesso ao Supabase.
const CFG = window.ATUAL_CONFIG;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v) => BRL.format(Number(v) || 0);
export const km = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const fmtPhone = (v) => {
  let d = digits(v);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
};
export const fmtCep = (v) => {
  const d = digits(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v || '';
};
export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';

export function cpfValid(cpf) {
  const d = digits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

// Distância em linha reta (km), igual à usada no banco.
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 100) / 100;
}

/* ---------- Armazenamento local (tolerante a aba anônima) ---------- */
export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* armazenamento indisponível */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* armazenamento indisponível */
    }
  },
};

/* ---------- Imagens ---------- */
// Nomes curtos ("prod-01") são fotos do site em /assets/img (JPG + WebP); URLs completas vêm do Supabase Storage.
export const isLocal = (v) => !!v && !/^(https?:)?\/\//.test(v) && !v.startsWith('/') && !v.startsWith('data:');
export const mediaSrc = (v) => (!v ? '' : isLocal(v) ? `/assets/img/${v}.jpg` : v);

export function picture(value, { cls = '', alt = '', eager = false, sizes = '', lazyData = false } = {}) {
  if (!value) return `<span class="img-missing ${cls}" aria-hidden="true"></span>`;
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  const srcAttr = lazyData ? 'data-src' : 'src';
  const srcsetAttr = lazyData ? 'data-srcset' : 'srcset';
  if (isLocal(value)) {
    return `<picture><source type="image/webp" ${srcsetAttr}="/assets/img/${esc(value)}.webp"><img class="${cls}" ${srcAttr}="/assets/img/${esc(value)}.jpg" alt="${esc(alt)}" ${load} decoding="async"${sizes ? ` sizes="${esc(sizes)}"` : ''}></picture>`;
  }
  return `<picture><img class="${cls}" ${srcAttr}="${esc(value)}" alt="${esc(alt)}" ${load} decoding="async"></picture>`;
}

// Imagem de banner com arte para celular (até 749px) e desktop.
export function bannerPicture(desktop, mobile, { cls = '', eager = false, lazyData = false } = {}) {
  const srcAttr = lazyData ? 'data-src' : 'src';
  const ss = lazyData ? 'data-srcset' : 'srcset';
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  const sources = [];
  if (mobile) {
    if (isLocal(mobile)) {
      sources.push(`<source media="(max-width: 749px)" type="image/webp" ${ss}="/assets/img/${esc(mobile)}.webp">`);
      sources.push(`<source media="(max-width: 749px)" ${ss}="/assets/img/${esc(mobile)}.jpg">`);
    } else {
      sources.push(`<source media="(max-width: 749px)" ${ss}="${esc(mobile)}">`);
    }
  }
  if (isLocal(desktop)) sources.push(`<source type="image/webp" ${ss}="/assets/img/${esc(desktop)}.webp">`);
  return `<picture>${sources.join('')}<img class="${cls}" ${srcAttr}="${esc(mediaSrc(desktop))}" alt="" ${load} decoding="async"></picture>`;
}

// Troca data-src/data-srcset por src/srcset (slides que ainda não apareceram).
export function hydrate(root) {
  $$('[data-srcset],[data-src]', root).forEach((el) => {
    if (el.dataset.srcset) {
      el.srcset = el.dataset.srcset;
      delete el.dataset.srcset;
    }
    if (el.dataset.src) {
      el.src = el.dataset.src;
      delete el.dataset.src;
    }
  });
}

/* ---------- Supabase (REST, sem SDK) ---------- */
const headers = () => ({
  apikey: CFG.supabaseKey,
  Authorization: `Bearer ${CFG.supabaseKey}`,
  'Content-Type': 'application/json',
});

export class BizError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || '';
  }
}

export async function rpc(name, params = {}) {
  let res;
  try {
    res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(params) });
  } catch {
    throw new BizError('NETWORK');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new BizError(data?.message || 'ERROR', data?.details || data?.hint || '');
  return data;
}

export async function geocode(body) {
  try {
    const res = await fetch(`${CFG.supabaseUrl}/functions/v1/geocode`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new BizError(data?.error || 'GEOCODE_FAILED');
    return data;
  } catch (e) {
    if (e instanceof BizError) throw e;
    throw new BizError('NETWORK');
  }
}

// Plano B no navegador do cliente quando o servidor não acha coordenadas.
export async function geocodeInBrowser({ street, number, city, state }) {
  const q = [street && `${street}${number ? `, ${number}` : ''}`, city, state, 'Brasil'].filter(Boolean).join(', ');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    const d = await res.json();
    if (Array.isArray(d) && d[0]) return { lat: Number(d[0].lat), lng: Number(d[0].lon), precision: street ? 'street' : 'city' };
  } catch {
    /* sem resultado */
  }
  return null;
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new BizError('NO_GEO'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: 'gps', accuracy: p.coords.accuracy }),
      (err) => reject(new BizError(err.code === 1 ? 'GEO_DENIED' : 'GEO_FAILED')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
    );
  });
}

// Mensagens de erro de negócio para o cliente
export function bizMessage(err) {
  const code = err?.code || err?.message;
  const [a, b] = String(err?.detail || '').split('|');
  const map = {
    NETWORK: 'Sem conexão. Verifique sua internet e tente de novo.',
    STORE_NOT_FOUND: 'Esta loja não está disponível no momento.',
    STORE_CLOSED: a || 'A loja não está recebendo pedidos pelo site agora.',
    STORE_NO_LOCATION: 'A loja ainda não configurou a área de entrega. Fale com a loja pelo WhatsApp.',
    INVALID_NAME: 'Informe seu nome completo.',
    INVALID_PHONE: 'Informe um telefone com DDD.',
    INVALID_EMAIL: 'O e-mail informado não é válido.',
    INVALID_CPF: 'O CPF informado não é válido.',
    INVALID_CEP: 'Informe um CEP válido.',
    INVALID_ADDRESS: 'Complete o endereço de entrega.',
    INVALID_LOCATION: 'Não conseguimos localizar o endereço. Confira o CEP ou use sua localização.',
    OUT_OF_RANGE: `Este endereço fica a ${a ? km(a) : 'mais'} da loja, fora do raio de entrega${b ? ` de ${km(b)}` : ''}.`,
    RATE_LIMIT: 'Muitos pedidos em sequência. Aguarde alguns minutos e tente de novo.',
    EMPTY_CART: 'Seu carrinho está vazio.',
    TOO_MANY_ITEMS: 'Seu carrinho tem itens demais para um pedido só.',
    PRODUCT_UNAVAILABLE: 'Um produto do carrinho não está mais disponível nesta loja.',
    OUT_OF_STOCK: `Estoque insuficiente${a ? ` de “${a}”` : ''}${b !== undefined && b !== '' ? ` (disponível: ${b})` : ''}.`,
    MIN_ORDER: `O pedido mínimo desta loja é ${brl(a)}.`,
    INVALID_PAYMENT: 'Escolha uma forma de pagamento aceita pela loja.',
    COUPON_INVALID: a || 'Cupom inválido.',
    GEO_DENIED: 'Permita o acesso à localização no navegador ou informe o CEP.',
    GEO_FAILED: 'Não conseguimos obter sua localização. Informe o CEP.',
    NO_GEO: 'Seu navegador não informa a localização. Informe o CEP.',
    'CEP não encontrado': 'CEP não encontrado. Confira os números.',
    'CEP inválido': 'Informe um CEP com 8 números.',
  };
  return map[code] || 'Não foi possível concluir agora. Tente novamente.';
}

/* ---------- Aviso rápido ---------- */
let toastTimer;
export function toast(msg) {
  const el = $('[data-toast]');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

/* ---------- Foco ---------- */
export const focusables = (root) =>
  $$('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])', root).filter(
    (el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length
  );

export function trapTab(e, root, extra = []) {
  const f = [...extra, ...focusables(root)];
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (!f.includes(document.activeElement)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export const waLink = (number, text) => `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}`;
export const mapsLink = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
