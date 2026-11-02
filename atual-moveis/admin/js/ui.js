// Componentes e utilitários de interface do painel ("Casa Atual").
// Padrão: monte HTML com o template `html` (escapa tudo automaticamente)
// e trate eventos com delegação (el.addEventListener('click', e => e.target.closest(...))).
//
// Novidades (todas aditivas; as assinaturas antigas continuam valendo):
//   initUI()                         liga selects personalizados, artes e Tetim em #root e janelas (pode chamar 2×)
//   customSelect(select, opções) / enhanceSelect(select) / enhanceSelects(raiz) / multiSelect(container, opções)
//   getTheme() · setTheme('system'|'light'|'dark') · cycleTheme() · THEME_SNIPPET (script inline anti-piscada)
//   art(nome, { size, cls }) · tetimArt() · tetim.claim/release · tip({ id, text, action })
//   empty(t, txt, ação, { art, size }) · loading(txt, { art }) · errorBlock(e, { retry, art }) · skeleton()
//   kpi()/kpiCard() · waitKpi() · deltaPill() · sparkline() · areaChart() · barChart() (com dica e tabela acessível)
//   openModal({ head, role, icon, tone }) · drawer() · confirmDialog({ cancelLabel, tone }) · pushLayer/popLayer
//   toast(msg, tipo, ms, { title, action, secondary }) · segmented() · avatar() · storeMark() · ageChip() · AGE
//   livePill() · pageHeader() · table({ cards, compact, sticky }) · field({ type: 'select', options })
//   dateRange(botão, { from, to, onApply }) · saveBar({ form, onSave, sections, ctx }) · closeModals()
import { uploadImage, removeImage, mediaUrl, ApiError } from './api.js';

/* ---------- HTML seguro ---------- */
export class SafeHtml {
  constructor(str) {
    this.str = str;
  }
  toString() {
    return this.str;
  }
}

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.str;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

// html`<p>${valor}</p>` — valores são escapados; arrays e outros html`` entram como estão.
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s + (i < values.length ? part(values[i]) : '');
  });
  return new SafeHtml(out);
}

// Conteúdo já confiável (ex.: SVG fixo do próprio código). Nunca use com dados do banco.
export const raw = (s) => new SafeHtml(String(s));

export function render(el, content) {
  el.innerHTML = part(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function injectStyle(id, css) {
  if (document.getElementById(`style-${id}`)) return;
  const s = document.createElement('style');
  s.id = `style-${id}`;
  s.textContent = themeCss(css);
  document.head.appendChild(s);
}

// Compatibilidade com o tema escuro: cores fixas antigas do CSS dos módulos viram tokens (spec §4.32).
// Só mexe em fundo/texto/borda conhecidos; prévias de coisas claras (logo, vitrine) e impressão ficam como estão.
const CSS_BG = {
  '#fff': 'var(--surface)', '#ffffff': 'var(--surface)', white: 'var(--surface)',
  '#fafafa': 'var(--surface-2)', '#f8f9fa': 'var(--surface-2)', '#f7f7f7': 'var(--surface-2)', '#f9f9f9': 'var(--surface-2)',
  '#eee': 'var(--surface-3)', '#eeeeee': 'var(--surface-3)', '#efefef': 'var(--surface-3)', '#f0f0f0': 'var(--surface-3)', '#f1f1f1': 'var(--surface-3)',
  '#f2f2f2': 'var(--surface-3)', '#f3f3f3': 'var(--surface-3)', '#f4f4f4': 'var(--surface-3)', '#f5f5f5': 'var(--surface-3)',
  '#fff7f7': 'var(--row-selected)', '#fffafa': 'var(--row-selected)', '#fff6f6': 'var(--bad-bg)', '#f3fbf6': 'var(--ok-bg)', '#fff1c2': 'var(--warn-bg)',
};
const CSS_FG = {
  '#444': 'var(--text)', '#333': 'var(--text)', '#191919': 'var(--ink)', '#141414': 'var(--ink)', '#888': 'var(--muted)', '#8a8a8a': 'var(--muted)', '#9a9a9a': 'var(--muted)',
  '#1a0dab': 'var(--serp-link)', '#4d5156': 'var(--serp-text)', '#202124': 'var(--serp-title)',
  '#0f6b35': 'var(--ok-fg)', '#128c4b': 'var(--ok-fg)', '#334e9c': 'var(--info-fg)', '#1e3a8a': 'var(--info-fg)',
};
const CSS_LINE = {
  '#ecedef': 'var(--line)', '#e6e6e6': 'var(--line)', '#e5e5e5': 'var(--line)', '#ececec': 'var(--line)', '#ddd': 'var(--line-strong)', '#d4d4d4': 'var(--line-strong)',
  '#bdbdbd': 'var(--line-strong)', '#f3d39c': 'var(--warn-line)', '#f0c2c4': 'var(--bad-line)', '#f1c4c6': 'var(--bad-line)',
};
const CSS_COLOR_RE = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b|\bwhite\b|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(0?\.\d+|1)\s*\)/gi;
function themeValue(prop, val) {
  if (prop === 'accent-color') return 'auto';
  const bg = /^background(-color|-image)?$/.test(prop);
  const map = bg ? CSS_BG : prop === 'color' ? CSS_FG : /^(border|outline)/.test(prop) ? CSS_LINE : null;
  if (!map) return val;
  return val.replace(CSS_COLOR_RE, (c, alpha) => {
    if (alpha !== undefined) return bg && Number(alpha) >= 0.85 ? `color-mix(in srgb, var(--surface) ${Math.round(Number(alpha) * 100)}%, transparent)` : c;
    return map[c.toLowerCase()] || c;
  });
}
export function themeCss(css) {
  return String(css).replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) =>
    /logo__tile|preview|print|op-/i.test(sel) ? m : `${sel}{${body.replace(/([a-z-]+)(\s*:\s*)([^;]+)/gi, (d, prop, sep, val) => prop + sep + themeValue(prop.toLowerCase(), val))}}`
  );
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let uid = 0;
const nextId = (p = 'ui') => `${p}-${++uid}`;
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
// texto sem acento e minúsculo (busca "vicosa" acha "Viçosa")
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const plainText = (v) => (v instanceof SafeHtml ? v.str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : String(v ?? ''));

/* ---------- Ícones (traço 1,75, 24x24) ---------- */
const ICONS = {
  dashboard: '<path d="M4 13.5 12 6l8 7.5"/><path d="M6 11.6V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-7.4"/>',
  orders: '<path d="M6 3h12a1 1 0 0 1 1 1v16.5l-2.5-1.5-2.5 1.5-2-1.5-2 1.5-2.5-1.5L5 20.5V4a1 1 0 0 1 1-1z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  products: '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
  showcase: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m7 12 3-3 2.5 2.5L14 10l3 2"/>',
  categories: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><circle cx="16.75" cy="16.75" r="3.25"/>',
  coupons: '<path d="M3 9.5V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 9.5l-5 5M9.5 9.5h.01M14.5 14.5h.01"/>',
  customers: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  reports: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7.5 15 4-4.5 3 2.5 5-6"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5h16a2.67 2.67 0 0 1-5.33 0 2.67 2.67 0 0 1-5.34 0A2.67 2.67 0 0 1 4 9.5z"/><path d="M5 12v8h14v-8M10 20v-4.5h4V20"/>',
  stores: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M9.5 10.5 12 8.3l2.5 2.2v2.5h-5z"/>',
  team: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5"/>',
  network: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
  audit: '<path d="M12 3 5 6v5.5c0 4.3 3 7.8 7 9.5 4-1.7 7-5.2 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  account: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.2-2.2 3.1-3.3 5.5-3.3s4.3 1.1 5.5 3.3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5.4-1.8M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevUpDown: '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>',
  drag: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 18 5-5 3.5 3.5L15 14l5 4.5"/>',
  whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.3 8.6c.2-.4.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.6l-.5.6c.6 1.2 1.6 2.2 2.8 2.8l.6-.5c.2-.1.4-.2.6-.1l1.6.7c.3.1.4.3.4.5v.5c0 .3-.1.6-.5.8-.6.4-1.4.6-2.2.3-2.4-.8-4.3-2.7-5.1-5.1-.3-.8-.1-1.6.3-2.2z"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  mapPin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  box: '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9M7.8 5.2l8.5 4.6"/>',
  truck: '<path d="M2.5 6.5h11v9.5h-11zM13.5 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  houses: '<path d="M2.5 11 7 7l4.5 4v8.5h-9z"/><path d="M11.5 11 17 6l4.5 4.2v9.3h-10"/><path d="M5.5 19.5V15h3v4.5M15.5 19.5V15h3v4.5"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sparkle: '<path d="M11 3.5 12.7 8.3 17.5 10l-4.8 1.7L11 16.5 9.3 11.7 4.5 10l4.8-1.7z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  pix: '<path d="M8.2 5.8 12 2l3.8 3.8M18.2 8.2 22 12l-3.8 3.8M15.8 18.2 12 22l-3.8-3.8M5.8 15.8 2 12l3.8-3.8"/><path d="m8 12 4-4 4 4-4 4z"/>',
  wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3"/><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5"/><path d="M4 7.5h15a1 1 0 0 1 1 1V12h-4a2 2 0 0 0 0 4h4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  phone: '<path d="M5 4h3.5l1.5 4-2 1.5a10 10 0 0 0 6.5 6.5L16 14l4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>',
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  enter: '<path d="M19 5v6.5a2.5 2.5 0 0 1-2.5 2.5H6"/><path d="m9.5 10.5-3.5 3.5 3.5 3.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  cube: '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  message: '<path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 3.5v-3.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M7.5 10h9M7.5 13.5h5"/>',
  note: '<path d="M5 3.5h10l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M15 3.5v4h4M8 12h8M8 16h5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeOff: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.7 6.7a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-1.9 2-1.9H17a4 4 0 0 0 4-4c0-4.2-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  bolt: '<path d="M13 2.5 4.5 13.5h6.5L10 21.5l8.5-11H12z"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.5 11h5M11 8.5v5"/>',
  // móveis (Tipo 3D)
  sofa: '<path d="M5 10.5V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2.5"/><path d="M3.5 11a1.8 1.8 0 0 1 3.5.5V14h10v-2.5a1.8 1.8 0 0 1 3.5-.5V17a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z"/><path d="M5.5 18v2M18.5 18v2"/>',
  armchair: '<path d="M7 11V7.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V11"/><path d="M4.5 11.5a1.8 1.8 0 0 1 3.5.5V14h8v-2a1.8 1.8 0 0 1 3.5-.5V17a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M7 18v2.5M17 18v2.5"/>',
  chair: '<path d="M7.5 3.5h9l-1 8h-7z"/><path d="M6 11.5h12v3H6z"/><path d="M7.5 14.5 6.5 21M16.5 14.5l1 6.5"/>',
  bed: '<path d="M3 19V6M3 14h18v5"/><path d="M3 14v-1.5A2.5 2.5 0 0 1 5.5 10h3A2.5 2.5 0 0 1 11 12.5V14"/><path d="M11 12a2 2 0 0 1 2-2h5.5a2.5 2.5 0 0 1 2.5 2.5V14"/>',
  wardrobe: '<rect x="4.5" y="3" width="15" height="16.5" rx="1.5"/><path d="M12 3v16.5M10 10v2.5M14 10v2.5M6.5 19.5V21M17.5 19.5V21"/>',
  dresser: '<rect x="4" y="4" width="16" height="15" rx="1.5"/><path d="M4 9h16M4 14h16M10.5 6.5h3M10.5 11.5h3M10.5 16.5h3M6 19v2M18 19v2"/>',
  rack: '<rect x="6" y="3" width="12" height="7.5" rx="1"/><path d="M10 13h4"/><path d="M3 13.5h18V19H3z"/><path d="M12 13.5V19M5 19v2M19 19v2"/>',
  fridge: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M6 9.5h12M9 5.5v2M9 12.5v3"/>',
  washer: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><circle cx="12" cy="13.5" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01M14 6h2.5"/><path d="M10 15a2.5 2.5 0 0 0 4 0"/>',
  stove: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M4.5 8.5h15"/><circle cx="8.5" cy="5.8" r=".6" fill="currentColor"/><circle cx="12" cy="5.8" r=".6" fill="currentColor"/><circle cx="15.5" cy="5.8" r=".6" fill="currentColor"/><rect x="7.5" y="11.5" width="9" height="6.5" rx="1"/>',
  table: '<path d="M2.5 9h19M5 9v11M19 9v11M7.5 9v4h9V9"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16.5V20"/>',
  mattress: '<rect x="2.5" y="8.5" width="19" height="8" rx="2"/><path d="M2.5 12.5h19M6 16.5v2M18 16.5v2"/>',
  microwave: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><rect x="5.5" y="8" width="9.5" height="8" rx="1"/><path d="M18 9h.01M18 12h.01M18 15h.01"/>',
  none: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
};

export function icon(name, cls = 'icon') {
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`
  );
}
export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(ICONS, name);

/* ---------- Formatação ---------- */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR');
export const money = (v) => BRL.format(Number(v) || 0);
export const num = (v) => NUM.format(Number(v) || 0);
export const pct = (v, digits = 0) => `${(Number(v) || 0).toFixed(digits).replace('.', ',')}%`;

export function date(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
export function datetime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}
export function relTime(v) {
  if (!v) return '—';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return date(v);
}
export const phone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 13 && d.startsWith('55')) return phone(d.slice(2));
  if (d.length === 12 && d.startsWith('55')) return phone(d.slice(2));
  return v || '—';
};
export const cep = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v || '—';
};
export const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Data local (YYYY-MM-DD) ↔ intervalo para consultas
export const isoDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const dayStart = (ymd) => new Date(`${ymd}T00:00:00-03:00`).toISOString();
export const dayEnd = (ymd) => new Date(new Date(`${ymd}T00:00:00-03:00`).getTime() + 86400000).toISOString();

// "R$ 133,6 mil" (KPIs compactos no celular) e "15 mil" (eixos)
export function compactMoney(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1).replace('.', ',')} mil`;
  return money(n);
}
export function shortNum(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `${String(+(n / 1e6).toFixed(1)).replace('.', ',')} mi`;
  if (Math.abs(n) >= 1e3) return `${String(+(n / 1e3).toFixed(1)).replace('.', ',')} mil`;
  return num(n);
}

/* ---------- Rótulos ---------- */
export const ORDER_STATUS = {
  pending: { label: 'Aguardando confirmação', short: 'Novo', tone: 'warning' },
  confirmed: { label: 'Confirmado', short: 'Confirmado', tone: 'info' },
  preparing: { label: 'Em separação', short: 'Separação', tone: 'plum' },
  out_for_delivery: { label: 'Saiu para entrega', short: 'Em rota', tone: 'accent' },
  delivered: { label: 'Entregue', short: 'Entregue', tone: 'success' },
  canceled: { label: 'Cancelado', short: 'Cancelado', tone: 'danger' },
};
export const PAYMENT_METHOD = {
  pix: 'PIX',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro na entrega',
  crediario: 'Crediário da loja',
  card_link: 'Link de pagamento',
};
// ícone de cada forma de pagamento (para listas e selects ricos)
export const PAYMENT_ICON = { pix: 'pix', card_on_delivery: 'card', cash: 'cash', crediario: 'wallet', card_link: 'link' };
export const PAYMENT_STATUS = {
  pending: { label: 'Pagamento pendente', tone: 'warning' },
  paid: { label: 'Pago', tone: 'success' },
  refunded: { label: 'Estornado', tone: 'dark' },
  failed: { label: 'Não aprovado', tone: 'danger' },
};
export const ROLES = {
  super_admin: { label: 'Super admin da rede', scope: 'network', desc: 'Acesso total, inclusive a outros super admins.' },
  network_admin: { label: 'Administrador da rede', scope: 'network', desc: 'Gerencia todas as lojas, catálogo, equipe e configurações.' },
  store_admin: { label: 'Administrador da loja', scope: 'store', desc: 'Tudo da loja: catálogo, pedidos, equipe, entrega e pagamentos.' },
  store_manager: { label: 'Gerente', scope: 'store', desc: 'Catálogo, vitrine, pedidos, cupons e clientes.' },
  store_editor: { label: 'Editor de catálogo', scope: 'store', desc: 'Produtos, vitrine e banners.' },
  store_operator: { label: 'Atendimento / expedição', scope: 'store', desc: 'Pedidos e clientes.' },
};
export const PRODUCT_STATUS = {
  active: { label: 'Ativo', tone: 'success' },
  draft: { label: 'Rascunho', tone: 'warning' },
  archived: { label: 'Arquivado', tone: 'dark' },
};
// tom do badge → tom semântico curto (ok, warn, info, plum, ora, bad, neu) usado em pontos e ladrilhos
export const TONE = { success: 'ok', warning: 'warn', info: 'info', plum: 'plum', accent: 'ora', danger: 'bad', dark: 'neu', neutral: 'neu', '': 'neu' };

export const badge = (label, tone = '') => html`<span class="badge ${tone ? `badge--${tone}` : ''}">${label}</span>`;
export const statusBadge = (s) => badge(ORDER_STATUS[s]?.label || s, ORDER_STATUS[s]?.tone);
export const paymentBadge = (s) => badge(PAYMENT_STATUS[s]?.label || s, PAYMENT_STATUS[s]?.tone);
export const productStatusBadge = (s) => badge(PRODUCT_STATUS[s]?.label || s, PRODUCT_STATUS[s]?.tone);

/* ---------- Tema (Claro · Escuro · Sistema) ---------- */
const THEME_KEY = 'atual-admin-theme';
// Cole no <head> (antes do CSS) para aplicar o tema escolhido sem piscar.
export const THEME_SNIPPET =
  "try{var t=localStorage.getItem('atual-admin-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";
export const THEMES = { light: 'Claro', dark: 'Escuro', system: 'Sistema' };
export const THEME_NEXT = { light: 'dark', dark: 'system', system: 'light' };
export function getTheme() {
  const t = lsGet(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'system';
}
export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
}
export function resolvedTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function setTheme(t) {
  const theme = t === 'light' || t === 'dark' ? t : 'system';
  lsSet(THEME_KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent('atual:theme', { detail: { theme, resolved: resolvedTheme() } }));
  return theme;
}
export const cycleTheme = () => setTheme(THEME_NEXT[getTheme()]);
applyTheme();
// PCs de loja modestos: sem desfoque no fundo das janelas e no topo (o CSS lê .ui-lowfx)
if ((navigator.hardwareConcurrency || 8) <= 4) document.documentElement.classList.add('ui-lowfx');

/* ---------- Camadas (Esc fecha só a de cima) ---------- */
const layers = [];
export function pushLayer(el, { onEscape } = {}) {
  popLayer(el);
  const layer = { el, onEscape };
  layers.push(layer);
  return layer;
}
export function popLayer(el) {
  const i = layers.findIndex((l) => l.el === el);
  if (i >= 0) layers.splice(i, 1);
}
export const topLayer = () => {
  while (layers.length && !layers[layers.length - 1].el.isConnected) layers.pop();
  return layers[layers.length - 1]?.el || null;
};
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    topLayer();
    const top = layers[layers.length - 1];
    if (!top) return;
    e.preventDefault();
    e.stopPropagation();
    top.onEscape?.(e);
  },
  true
);

let lockCount = 0;
function lockScroll() {
  lockCount += 1;
  document.body.classList.add('is-locked');
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (!lockCount) document.body.classList.remove('is-locked');
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]';
const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden';
const focusable = (root) => $$(FOCUSABLE, root).filter((n) => n.tabIndex >= 0 && !n.closest('[hidden], [inert]') && isVisible(n));
export { focusable };

// callbacks referenciados pelo HTML (botões "Tentar de novo", ações de dica…)
const CALLBACKS = new Map();
function registerCallback(fn) {
  const id = nextId('cb');
  CALLBACKS.set(id, fn);
  if (CALLBACKS.size > 300) CALLBACKS.delete(CALLBACKS.keys().next().value);
  return id;
}

/* ---------- Avisos rápidos (toasts) ---------- */
function toastHost() {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}
const TOAST_ICON = { success: 'check', error: 'alert', warning: 'alert', info: 'info', new: 'bell' };
const toastQueue = [];
const TOAST_MAX = 3;
function pumpToasts() {
  const host = toastHost();
  while (toastQueue.length && host.querySelectorAll('.toast:not(.is-leaving)').length < TOAST_MAX) toastQueue.shift()();
}

// toast(mensagem, tipo, ms, { title, action: { label, onClick }, secondary: { label, onClick }, icon })
// tipos: info · success · error · warning · new (pedido novo) · tetim (rosto do Tetim; use com parcimônia)
// ms <= 0 = fica até fechar. Devolve { el, close }.
export function toast(message, type = 'info', ms = 3800, opts = undefined) {
  const o = opts || {};
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  if (type === 'error') el.setAttribute('role', 'alert');
  const ico =
    type === 'tetim'
      ? html`<span class="toast__ico toast__ico--tetim" aria-hidden="true">${art('tetim-face', { w: 28, h: 28, eager: true })}</span>`
      : html`<span class="toast__ico toast__ico--${type}" aria-hidden="true">${icon(o.icon || TOAST_ICON[type] || 'info', 'icon-sm')}</span>`;
  const timed = ms > 0;
  render(
    el,
    html`${ico}<div class="toast__body">${o.title ? html`<strong class="toast__title">${o.title}</strong>` : ''}<div class="toast__msg">${message}</div>${
      o.action || o.secondary
        ? html`<div class="toast__acts">${o.action ? html`<button type="button" class="toast__act" data-toast-act>${o.action.label}</button>` : ''}${
            o.secondary ? html`<button type="button" class="toast__act toast__act--sec" data-toast-sec>${o.secondary.label}</button>` : ''
          }</div>`
        : ''
    }</div><button type="button" class="toast__x" aria-label="Fechar aviso">${icon('close', 'icon-sm')}</button>${
      timed && o.action ? html`<span class="toast__bar" style="animation-duration:${ms}ms" aria-hidden="true"></span>` : ''
    }`
  );
  let remaining = ms;
  let started = 0;
  let timer = null;
  let hover = false;
  let closed = false;
  const bar = el.querySelector('.toast__bar');
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const done = () => {
      el.remove();
      pumpToasts();
    };
    if (reducedMotion()) done();
    else setTimeout(done, 160);
  };
  const start = () => {
    if (!timed || closed || timer) return;
    started = Date.now();
    timer = setTimeout(close, Math.max(400, remaining));
    if (bar) bar.style.animationPlayState = 'running';
  };
  const pause = () => {
    if (!timed || !timer) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - started;
    if (bar) bar.style.animationPlayState = 'paused';
  };
  el.addEventListener('mouseenter', () => {
    hover = true;
    pause();
  });
  el.addEventListener('mouseleave', () => {
    hover = false;
    if (!el.contains(document.activeElement)) start();
  });
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', (e) => {
    if (!el.contains(e.relatedTarget) && !hover) start();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('.toast__x')) return close();
    if (e.target.closest('[data-toast-act]')) {
      o.action?.onClick?.(e);
      close();
    } else if (e.target.closest('[data-toast-sec]')) {
      o.secondary?.onClick?.(e);
      close();
    }
  });
  const show = () => {
    toastHost().appendChild(el);
    start();
  };
  toastQueue.push(show);
  pumpToasts();
  return { el, close };
}

export const toastError = (e) => toast(e instanceof Error ? e.message : String(e), 'error', 6000);

/* ---------- Modais e gavetas ---------- */
const openModals = new Set();
// Fecha todas as janelas/gavetas abertas (o app chama ao trocar de loja ou de rota).
export function closeModals() {
  [...openModals].reverse().forEach((close) => close());
}
// openModal({ title, body, actions, size: 'sm'|'lg'|'xl'|'wide', variant: 'modal'|'panel', onMount(el, close), onClose,
//             dismissable, head (cabeçalho próprio), role ('dialog'|'alertdialog'), icon, tone ('danger'|'warn'|'info'|'ok'), cls })
// actions: html`` com botões; botões com data-close fecham. Retorna { el, close }.
export function openModal({
  title,
  body,
  actions,
  size = '',
  variant = 'modal',
  onMount,
  onClose,
  dismissable = true,
  head,
  role = 'dialog',
  icon: ico,
  tone = 'info',
  cls = '',
} = {}) {
  const last = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = `overlay ${variant === 'panel' ? 'overlay--panel' : ''}`;
  const box = document.createElement('div');
  box.className =
    variant === 'panel' ? `panel ${size === 'wide' ? 'panel--wide' : ''} ${cls}`.trim() : `modal ${size ? `modal--${size}` : ''} ${cls}`.trim();
  box.setAttribute('role', role);
  box.setAttribute('aria-modal', 'true');
  const tid = nextId('dlg');
  if (title !== undefined && title !== null && title !== '') box.setAttribute('aria-labelledby', tid);
  else box.setAttribute('aria-label', 'Diálogo');
  const closeBtn = html`<button class="btn btn--ghost btn--icon modal__x" type="button" data-close aria-label="Fechar">${icon('close')}</button>`;
  render(
    box,
    html`${
      head
        ? html`<div class="modal__head modal__head--custom">${title ? html`<h2 class="visually-hidden" id="${tid}">${title}</h2>` : ''}<div class="modal__headbody">${head}</div>${closeBtn}</div>`
        : html`<div class="modal__head">${ico ? html`<span class="modal__ico modal__ico--${tone}" aria-hidden="true">${icon(ico)}</span>` : ''}<h2 class="modal__title" id="${tid}">${
            title ?? ''
          }</h2>${closeBtn}</div>`
    }<div class="modal__body">${body}</div>${actions ? html`<div class="modal__foot">${actions}</div>` : ''}`
  );
  document.body.append(overlay, box);
  lockScroll();
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    popLayer(box);
    overlay.remove();
    box.remove();
    unlockScroll();
    document.removeEventListener('keydown', onKey, true);
    if (last && last.isConnected) last.focus?.({ preventScroll: true });
    onClose?.(result);
  };
  openModals.add(close);
  pushLayer(box, { onEscape: () => dismissable && close() });
  const onKey = (e) => {
    if (!box.isConnected || e.key !== 'Tab') return;
    if (topLayer() !== box) return;
    const f = focusable(box);
    if (!f.length) {
      e.preventDefault();
      return;
    }
    const first = f[0];
    const lastF = f[f.length - 1];
    if (!box.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? lastF : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastF.focus();
    } else if (!e.shiftKey && document.activeElement === lastF) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (dismissable) overlay.addEventListener('click', () => close());
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  onMount?.(box, close);
  setTimeout(() => {
    if (closed || box.contains(document.activeElement)) return;
    const first =
      $('[autofocus]', box) || $('[data-initial-focus]', box) || focusable($('.modal__body', box))[0] || focusable(box)[0];
    first?.focus();
  }, 30);
  return { el: box, close };
}

// Gaveta lateral (ex.: pedido). side vai para uma coluna à direita em telas ≥ 1280 px.
// drawer({ title, head, body, side, foot, nav: { index, total, onPrev, onNext }, onMount, onClose, size: 'wide'|'' })
export function drawer({ title = 'Detalhes', head, body = '', side, foot, nav, onMount, onClose, size = 'wide', cls = '' } = {}) {
  const content = (b, s) =>
    s ? html`<div class="drawer__cols"><div class="drawer__main">${b}</div><aside class="drawer__side">${s}</aside></div>` : b;
  const navHtml = nav
    ? html`<div class="drawer__nav"><span class="drawer__pos">${nav.label || `${nav.index} de ${nav.total}`}</span>
        <button class="btn btn--ghost btn--icon btn--sm" type="button" data-drawer-prev aria-label="Anterior" title="Anterior (K)" ${nav.index <= 1 ? 'disabled' : ''}>${icon('chevronUp', 'icon-sm')}</button>
        <button class="btn btn--ghost btn--icon btn--sm" type="button" data-drawer-next aria-label="Próximo" title="Próximo (J)" ${nav.index >= nav.total ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button></div>`
    : '';
  const m = openModal({
    variant: 'panel',
    size,
    title,
    head: head || nav ? html`<div class="drawer__head">${head || html`<h2 class="drawer__title">${title}</h2>`}${navHtml}</div>` : undefined,
    body: content(body, side),
    actions: foot,
    cls: `drawer ${side ? 'drawer--cols' : ''} ${cls}`,
    onClose,
    onMount: (el, close) => {
      if (nav) {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-drawer-prev]')) nav.onPrev?.();
          if (e.target.closest('[data-drawer-next]')) nav.onNext?.();
        });
        el.addEventListener('keydown', (e) => {
          if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
          if ((e.key === 'j' || e.key === 'J' || e.key === 'ArrowRight') && nav.index < nav.total) nav.onNext?.();
          if ((e.key === 'k' || e.key === 'K' || e.key === 'ArrowLeft') && nav.index > 1) nav.onPrev?.();
        });
      }
      onMount?.(el, close);
    },
  });
  const setContent = ({ head: h, body: b, side: s, foot: f } = {}) => {
    if (h !== undefined) {
      const hb = $('.modal__headbody .drawer__head', m.el);
      if (hb) render(hb, html`${h}${navHtml}`);
    }
    if (b !== undefined || s !== undefined) render($('.modal__body', m.el), content(b ?? '', s));
    if (f !== undefined) {
      const ft = $('.modal__foot', m.el);
      if (ft) render(ft, f);
    }
  };
  return { el: m.el, close: m.close, setContent };
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false, cancelLabel, tone, icon: ico } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const t = tone || (danger ? 'danger' : '');
    openModal({
      title,
      size: 'sm',
      role: danger ? 'alertdialog' : 'dialog',
      icon: ico || (t === 'danger' ? 'alert' : t === 'warn' ? 'alert' : undefined),
      tone: t || 'info',
      cls: 'modal--confirm',
      body: html`<p class="modal__text">${message}</p>`,
      actions: html`<button class="btn" type="button" data-close data-initial-focus>${cancelLabel || (danger ? 'Voltar' : 'Cancelar')}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-ok>${confirmLabel}</button>`,
      onMount: (el, close) =>
        $('[data-ok]', el).addEventListener('click', () => {
          ok = true;
          close();
        }),
      onClose: () => resolve(ok),
    });
  });
}

// Pergunta um texto. Resolve com a string ou null se cancelar.
export function promptDialog({ title, label, value = '', placeholder = '', required = false, multiline = false, confirmLabel = 'Salvar', hint = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      size: 'sm',
      body: html`<form class="field" data-form>
        <label for="prompt-input">${label}</label>
        ${multiline
          ? html`<textarea class="textarea" id="prompt-input" placeholder="${placeholder}" ${required ? 'required' : ''} autofocus>${value}</textarea>`
          : html`<input class="input" id="prompt-input" value="${value}" placeholder="${placeholder}" ${required ? 'required' : ''} autofocus>`}
        ${hint ? html`<span class="hint">${hint}</span>` : ''}
      </form>`,
      actions: html`<button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn--primary" type="button" data-ok>${confirmLabel}</button>`,
      onMount: (el, close) => {
        const input = $('#prompt-input', el);
        const submit = () => {
          if (required && !input.value.trim()) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          result = input.value;
          close();
        };
        $('[data-ok]', el).addEventListener('click', submit);
        $('[data-form]', el).addEventListener('submit', (e) => {
          e.preventDefault();
          submit();
        });
      },
      onClose: () => resolve(result),
    });
  });
}

/* ---------- Formulários ---------- */
// Lê um <form>: name="x" → valor; data-type="number|int|bool|json|null-empty|list" converte.
// <select multiple> devolve um array com os valores escolhidos.
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const type = el.dataset.type;
    let v;
    if (el.type === 'checkbox') {
      if (type === 'array') {
        out[el.name] = out[el.name] || [];
        if (el.checked) out[el.name].push(el.value);
        continue;
      }
      v = el.checked;
    } else if (el.type === 'radio') {
      if (!el.checked) continue;
      v = el.value;
    } else if (el.type === 'select-multiple') {
      out[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
      continue;
    } else {
      v = el.value;
    }
    if (type === 'number') v = v === '' ? null : Number(String(v).replace(',', '.'));
    else if (type === 'int') v = v === '' ? null : parseInt(v, 10);
    else if (type === 'json') v = v ? JSON.parse(v) : null;
    else if (type === 'list') v = String(v).split(',').map((s) => s.trim()).filter(Boolean);
    else if (typeof v === 'string' && type !== 'keep') {
      v = v.trim();
      if (v === '' && el.dataset.empty !== 'string') v = null;
    }
    out[el.name] = v;
  }
  return out;
}

// Marca campos inválidos: errors = { campo: 'mensagem' }
export function showErrors(form, errors = {}) {
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $$('.error[data-for]', form).forEach((el) => el.remove());
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const el = form.elements[name];
    if (!el) continue;
    const input = el.length && !el.tagName ? el[0] : el;
    input.setAttribute('aria-invalid', 'true');
    const msg = document.createElement('span');
    msg.className = 'error';
    msg.dataset.for = name;
    msg.id = msg.id || nextId('err');
    msg.textContent = message;
    input.closest('.field')?.appendChild(msg);
    const described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && document.getElementById(x));
    input.setAttribute('aria-describedby', [...described, msg.id].join(' '));
    first = first || input;
  }
  first?.focus();
  return !first;
}

// Botão em estado "salvando" enquanto a promessa roda
export async function withBusy(btn, task, label = 'Salvando…') {
  if (!btn) return task();
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spinner spinner--btn" aria-hidden="true"></span> ${esc(label)}`;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.innerHTML = prev;
  }
}

// field({ label, name, value, type, hint, required, cls, attrs, placeholder, options: [[valor, rótulo]] (type 'select') })
export const field = ({ label, name, value = '', type = 'text', hint = '', required = false, cls = 'col-6', attrs = '', placeholder = '', options = [] }) =>
  html`<div class="field ${cls}">
    <label for="f-${name}">${label}${required ? ' *' : ''}</label>
    ${type === 'select'
      ? html`<select class="select" id="f-${name}" name="${name}" ${required ? 'required' : ''} ${placeholder ? raw(`data-placeholder="${esc(placeholder)}"`) : ''} ${raw(attrs)}>${selectOptions(options, value)}</select>`
      : html`<input class="input" id="f-${name}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${required ? 'required' : ''} ${raw(attrs)}>`}
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;

export const switchField = ({ label, name, checked = false, hint = '' }) =>
  html`<label class="switch">
    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
    <span class="switch__track"></span>
    <span class="switch__txt"><strong>${label}</strong>${hint ? html`<br><span class="muted small">${hint}</span>` : ''}</span>
  </label>`;

export const selectOptions = (options, selected) =>
  options.map(([value, label]) => html`<option value="${value}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${label}</option>`);

/* ---------- Artes do Tetim ---------- */
// Versão das artes: o build troca o valor vazio por um hash (cache).
const ART_V = '';
const TETIM_SIZES = {
  'login-hero': [720, 560],
  'tetim-face': [96, 96],
  'desk-wave': [360, 240],
  tip: [160, 160],
  'empty-orders': [320, 240],
  'empty-box': [320, 240],
  'all-done': [320, 240],
  'no-access': [320, 240],
  celebrate: [320, 240],
};
const SITE_SIZES = { 'banner-entrega': [640, 360], 'banner-pix': [640, 360], 'banner-3d': [640, 360], loading: [160, 160], mascote: [312, 312], 'mascote-acena': [312, 312] };
const ART_PRESET = { xs: 86, sm: 118, md: 168, inline: 148, lg: 232 };
export function artSrc(name) {
  const n = String(name || '');
  const site = n.startsWith('site:');
  const file = (site ? n.slice(5) : n).replace(/[^a-z0-9-]/gi, '');
  return `${site ? '/assets/img/art/' : '/admin/img/tetim/'}${file}.svg${ART_V ? `?v=${ART_V}` : ''}`;
}
function artDims(name, { size, w, h } = {}) {
  const n = String(name || '');
  const [nw, nh] = n.startsWith('site:') ? SITE_SIZES[n.slice(5)] || [320, 240] : TETIM_SIZES[n] || [320, 240];
  const ratio = nh / nw;
  if (w && h) return [w, h];
  if (w) return [w, Math.round(w * ratio)];
  if (h) return [Math.round(h / ratio), h];
  const width = typeof size === 'number' ? size : ART_PRESET[size] || nw;
  return [width, Math.round(width * ratio)];
}
// art('empty-box', { size: 'lg'|'md'|'sm'|número, w, h, cls }) → <img> decorativo.
// 'site:<nome>' usa as artes da loja virtual (/assets/img/art). Com "reduzir movimento", o SVG é embutido
// para respeitar a preferência (a primeira cena fica parada).
export function art(name, opts = {}) {
  const [w, h] = artDims(name, opts);
  const src = artSrc(name);
  const cls = opts.cls || '';
  if (reducedMotion()) {
    scheduleHydrate();
    return html`<span class="art art--inline ${cls}" data-art-src="${src}" style="width:${w}px;height:${h}px" aria-hidden="true"></span>`;
  }
  return html`<img class="art ${cls}" src="${src}" alt="" width="${w}" height="${h}" decoding="async" ${opts.lazy ? raw('loading="lazy"') : ''} draggable="false">`;
}
export const tetimArt = (name, { w, h, size, cls } = {}) => art(name, { w, h, size, cls });

const artCache = new Map();
let hydrateQueued = false;
function scheduleHydrate() {
  if (hydrateQueued) return;
  hydrateQueued = true;
  requestAnimationFrame(() => {
    hydrateQueued = false;
    hydrateArt(document);
  });
}
export function hydrateArt(root = document) {
  const els = root.querySelectorAll ? $$('[data-art-src]:not([data-art-done])', root) : [];
  if (root.matches?.('[data-art-src]:not([data-art-done])')) els.push(root);
  els.forEach((el) => {
    const src = el.getAttribute('data-art-src');
    if (!/^\/(admin\/img\/tetim|assets\/img\/art)\/[a-z0-9-]+\.svg(\?v=[\w]+)?$/i.test(src)) return;
    el.setAttribute('data-art-done', '');
    if (!artCache.has(src)) artCache.set(src, fetch(src).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
    artCache.get(src).then((svg) => {
      if (svg.trim().startsWith('<svg')) el.innerHTML = svg; // arquivo estático do próprio site (confiável)
    });
  });
}

/* ---------- Tetim: um por tela ---------- */
// Quem quer o Tetim marca o elemento com data-tetim-prio="<prioridade>"; numa mesma tela (view, janela ou folha)
// só o de melhor prioridade (menor número) aparece; os outros ganham .is-plain (variante sem arte).
export const tetim = {
  PRIORITY: { CELEBRATE: 1, GREETING: 2, EMPTY: 3, TIP: 4, STRIP: 5 },
  // API programática: devolve true se ninguém com prioridade melhor ocupa a vaga da tela.
  claim(view, { key, priority = 5, onLose } = {}) {
    const scope = view || currentView();
    const reg = slotReg(scope);
    const holder = reg.holder;
    const domBest = bestDomClaim(scope);
    if (domBest !== null && domBest < priority) return false;
    if (!holder || holder.key === key || priority < holder.priority) {
      if (holder && holder.key !== key) holder.onLose?.();
      reg.holder = { key, priority, onLose };
      return true;
    }
    return false;
  },
  release(view, key) {
    const reg = slotReg(view || currentView());
    if (reg.holder?.key === key) reg.holder = null;
    scheduleArbitrate();
  },
};
const slots = new WeakMap();
const currentView = () => document.querySelector('[data-view]') || document.body;
function slotReg(scope) {
  if (!slots.has(scope)) slots.set(scope, { holder: null });
  return slots.get(scope);
}
function bestDomClaim(scope) {
  let best = null;
  $$('[data-tetim-prio]', scope).forEach((el) => {
    const p = Number(el.dataset.tetimPrio);
    if (best === null || p < best) best = p;
  });
  return best;
}
const tetimScope = (el) => el.closest('[data-view], .modal, .panel, .sheet, [data-tetim-scope]') || document.body;
export function arbitrateTetim(root = document) {
  const groups = new Map();
  $$('[data-tetim-prio]', root === document ? document.body : root).forEach((el) => {
    const s = tetimScope(el);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(el);
  });
  groups.forEach((els, scope) => {
    const reg = slots.get(scope);
    const progPrio = reg?.holder ? reg.holder.priority : Infinity;
    let winner = null;
    els.forEach((el) => {
      if (!winner || Number(el.dataset.tetimPrio) < Number(winner.dataset.tetimPrio)) winner = el;
    });
    els.forEach((el) => el.classList.toggle('is-plain', el !== winner || Number(el.dataset.tetimPrio) >= progPrio));
  });
}
let arbitrateQueued = false;
function scheduleArbitrate() {
  if (arbitrateQueued) return;
  arbitrateQueued = true;
  requestAnimationFrame(() => {
    arbitrateQueued = false;
    arbitrateTetim(document);
  });
}

/* ---------- Estados (carregando, vazio, erro) ---------- */
// loading(texto, { art: true }) — padrão: indicador discreto (sem mascote). art: Tetim pequeno, só para esperas longas.
export const loading = (text = 'Carregando…', { art: withArt = false } = {}) =>
  withArt
    ? html`<div class="loading-block loading-block--art" role="status">${art(withArt === true ? 'site:loading' : withArt, { w: 64, h: 64, eager: true })}<span>${text}</span></div>`
    : html`<div class="loading-block" role="status"><span class="spinner" aria-hidden="true"></span>${text}</div>`;

const PLAIN_ICON = { 'all-done': ['checkCircle', 'ok'], 'no-access': ['lock', 'neu'], celebrate: ['sparkle', 'ora'], 'empty-orders': ['orders', 'neu'], 'empty-box': ['box', 'neu'] };
function guessArt(title, text) {
  const t = fold(`${plainText(title)} ${plainText(text)}`);
  if (/encontrad|resultado|busca|filtro|ajuste/.test(t)) return 'site:empty-search';
  if (/permiss|acesso|liberad/.test(t)) return 'no-access';
  if (/tudo em dia|nada pendente|nenhuma pendencia/.test(t)) return 'all-done';
  if (/pedido|cliente|venda/.test(t)) return 'empty-orders';
  return 'empty-box';
}
// empty(título, texto, ação, { art, size: 'lg'|'md'|'sm'|'inline' })
//   art: nome da arte do Tetim ('empty-orders' | 'empty-box' | 'all-done' | 'no-access' | 'celebrate'),
//        'site:empty-search' | 'site:error', false (só ícone) ou omitido (escolhe pelo texto).
export function empty(title, text = '', action = '', opts = {}) {
  const name = opts.art === undefined ? guessArt(title, text) : opts.art;
  const size = opts.size || 'md';
  const [ico, tone] = PLAIN_ICON[name] || [opts.icon || 'box', 'neu'];
  const tile = html`<span class="empty__tile t-${tone}" aria-hidden="true">${icon(ico)}</span>`;
  let visual = tile;
  if (name) {
    const isTetim = !String(name).startsWith('site:');
    const dims = size === 'inline' ? { size: 'inline' } : { size };
    if (isTetim) {
      scheduleArbitrate();
      visual = html`<span class="empty__art" data-tetim-prio="${tetim.PRIORITY.EMPTY}"><span class="empty__img">${art(name, dims)}</span>${tile}</span>`;
    } else visual = html`<span class="empty__art"><span class="empty__img">${art(name, dims)}</span></span>`;
  }
  return html`<div class="empty empty--${size}">${visual}<div class="empty__txt"><strong class="empty__title">${title}</strong>${
    text ? html`<span class="empty__text">${text}</span>` : ''
  }${action ? html`<div class="empty__acts">${action}</div>` : ''}</div></div>`;
}

// errorBlock(e) — aviso de erro (compatível). errorBlock(e, { retry: fn, art: true, title }) — bloco grande com arte e "Tentar de novo".
export function errorBlock(e, opts = {}) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!opts.retry && !opts.art) return html`<div class="alert alert--danger" role="alert">${icon('alert')}<div>${msg}</div></div>`;
  const id = typeof opts.retry === 'function' ? registerCallback(opts.retry) : '';
  const code = e && typeof e === 'object' && e.code ? e.code : '';
  return html`<div class="errblock" role="alert">
    ${art('site:error', { w: 200, h: 150 })}
    <strong class="errblock__title">${opts.title || 'Não foi possível carregar'}</strong>
    <span class="errblock__text">${msg}${code ? html` <span class="errblock__code">Código: ${code}</span>` : ''}</span>
    ${opts.retry ? html`<button class="btn" type="button" data-retry ${id ? raw(`data-cb="${id}"`) : ''}>${icon('refresh', 'icon-sm')} Tentar de novo</button>` : ''}
  </div>`;
}

// skeleton('table'|'kpis'|'cards'|'list'|'form'|'page', { rows, cols }) ou skeleton({ variant, rows, cols })
export function skeleton(kind = 'table', opts = {}) {
  if (typeof kind === 'object' && kind) {
    opts = kind;
    kind = kind.variant || 'table';
  }
  const rows = opts.rows ?? 5;
  const cols = opts.cols ?? 4;
  const sk = (w, h = 12, extra = '') => html`<span class="skeleton ${extra}" style="width:${w};height:${h}px"></span>`;
  let body;
  if (kind === 'kpis' || kind === 'cards') {
    body = html`<div class="sk-cards" style="--cols:${kind === 'kpis' ? 4 : cols}">${Array.from({ length: kind === 'kpis' ? 4 : cols }, () =>
      html`<div class="card sk-card">${sk('46%', 12)}${sk('72%', 24, 'sk-mt')}${sk('100%', 36, 'sk-spark')}</div>`
    )}</div>`;
  } else if (kind === 'form') {
    body = html`<div class="card"><div class="card__body sk-form">${Array.from({ length: rows }, () =>
      html`<div class="sk-field">${sk('28%', 11)}${sk('100%', 40, 'sk-input')}</div>`
    )}</div></div>`;
  } else if (kind === 'list') {
    body = html`<div class="sk-list">${Array.from({ length: rows }, () =>
      html`<div class="sk-row">${sk('44px', 44, 'sk-thumb')}<span class="sk-lines">${sk('42%', 12)}${sk('24%', 10)}</span></div>`
    )}</div>`;
  } else {
    const table = html`<div class="sk-table">${Array.from({ length: rows }, () =>
      html`<div class="sk-row">${sk('18px', 18, 'sk-check')}<span class="sk-lines">${sk('38%', 12)}${sk('22%', 10)}</span>${
        cols > 2 ? sk('120px', 12, 'sk-hide-sm') : ''
      }${cols > 3 ? sk('84px', 24, 'sk-pill') : ''}${sk('72px', 12, 'sk-hide-sm')}</div>`
    )}</div>`;
    body = kind === 'page' ? html`<div class="sk-head">${sk('180px', 26)}${sk('260px', 12, 'sk-mt')}</div><div class="card">${table}</div>` : table;
  }
  return html`<div class="sk" aria-busy="true"><span class="visually-hidden">Carregando…</span>${body}</div>`;
}

// Dica do Tetim: some por 30 dias ao dispensar; nunca mais de uma por tela.
const TIP_KEY = 'atual-admin-tip:';
export const tipsEnabled = () => lsGet('atual-admin-tips-off') !== '1';
export const setTipsEnabled = (on) => lsSet('atual-admin-tips-off', on ? null : '1');
export function tip({ id, text, action, title = 'Dica do Tetim' } = {}) {
  if (!id || !tipsEnabled()) return '';
  const at = Number(lsGet(TIP_KEY + id) || 0);
  if (at && Date.now() - at < 30 * 86400000) return '';
  scheduleArbitrate();
  let act = '';
  if (action?.href) act = html`<a class="btn btn--sm" href="${action.href}">${action.label}${icon('arrowRight', 'icon-sm')}</a>`;
  else if (action?.onClick) act = html`<button class="btn btn--sm" type="button" data-cb="${registerCallback(action.onClick)}">${action.label}</button>`;
  return html`<aside class="tip" data-tip-id="${id}" data-tetim-prio="${tetim.PRIORITY.TIP}" aria-label="${title}">
    <span class="tip__art">${art('tip', { w: 86, h: 86 })}</span>
    <div class="tip__body"><p class="tip__eyebrow">${icon('info', 'icon-xs')} ${title}</p><p class="tip__text">${text}</p>
      <div class="tip__acts">${act}<button class="btn btn--ghost btn--sm" type="button" data-tip-dismiss>Dispensar</button></div></div>
  </aside>`;
}

/* ---------- Números: KPI, variação, idade ---------- */
export function deltaPill(d, { prev = '' } = {}) {
  if (d === null || d === undefined || Number.isNaN(Number(d))) return html`<span class="delta delta--flat">Sem base</span>`;
  const n = Number(d);
  if (Math.abs(n) < 0.5) return html`<span class="delta delta--flat">Estável</span>`;
  const up = n >= 0;
  return html`<span class="delta ${up ? 'delta--up' : 'delta--down'}" ${prev ? raw(`title="Período anterior: ${esc(prev)}"`) : ''}>${icon(up ? 'arrowUp' : 'arrowDown', 'icon-xs')}${pct(Math.abs(n), Math.abs(n) < 100 && Math.round(Math.abs(n) * 10) % 10 ? 1 : 0)}<span class="visually-hidden"> de ${up ? 'alta' : 'queda'}</span></span>`;
}

// kpiCard({ label, value, split (centavos menores), sub, delta, prev, spark: [..], href, info, icon })  · kpi() = alias
export function kpiCard({ label, value, split = false, sub = '', delta, prev = '', spark, href, info = '', icon: ico, cls = '' } = {}) {
  let val = value;
  if (split && typeof value === 'string') {
    const m = value.match(/^(.*?)(,\d{2})$/);
    if (m) val = html`${m[1]}<small>${m[2]}</small>`;
  }
  const inner = html`<div class="kpi__top"><span class="kpi__label">${ico ? html`<span class="kpi__ico">${icon(ico, 'icon-sm')}</span>` : ''}${label}${
    info ? html`<span class="kpi__info" tabindex="0" role="img" aria-label="${info}" data-tooltip="${info}">${icon('info', 'icon-xs')}</span>` : ''
  }</span>${delta !== undefined ? deltaPill(delta, { prev }) : ''}</div>
    <div class="kpi__value">${val}</div>${sub ? html`<div class="kpi__sub">${sub}</div>` : ''}${
      spark && spark.length > 1 ? html`<div class="kpi__spark">${sparkline(spark)}</div>` : ''
    }`;
  const c = `card kpi kpi--card ${spark && spark.length > 1 ? 'kpi--spark' : ''} ${cls}`;
  return href ? html`<a class="${c}" href="${href}">${inner}</a>` : html`<div class="${c}">${inner}</div>`;
}
export const kpi = kpiCard;

// Minutos para "38 min" / "3 h 12 min" / "2 h"
export const AGE = { warn: 30, late: 60 };
export function fmtAge(min) {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} h${r ? ` ${String(r).padStart(2, '0')} min` : ''}`;
}
// ageChip(criadoEm, { prefix: 'há ', now }) — idade de pedido aguardando (neutro < 30 min, âmbar 30–59, vermelho ≥ 60)
export function ageChip(createdAt, { prefix = 'há ', now = Date.now() } = {}) {
  const min = (now - new Date(createdAt).getTime()) / 60000;
  const tone = min >= AGE.late ? 'late' : min >= AGE.warn ? 'warn' : 'ok';
  return html`<span class="age age--${tone}" data-age="${new Date(createdAt).toISOString()}" data-age-prefix="${prefix}">${icon('clock', 'icon-xs')}${prefix}${fmtAge(min)}${
    tone === 'late' ? html`<span class="visually-hidden"> (atrasado)</span>` : ''
  }</span>`;
}
// Atualiza todos os [data-age] (o app chama a cada 60 s)
export function refreshAges(root = document) {
  $$('[data-age]', root).forEach((el) => {
    const tmp = document.createElement('span');
    render(tmp, ageChip(el.dataset.age, { prefix: el.dataset.agePrefix ?? 'há ' }));
    const fresh = tmp.firstElementChild;
    if (fresh && fresh.innerHTML !== el.innerHTML) {
      el.className = fresh.className;
      el.innerHTML = fresh.innerHTML;
    }
  });
}

// waitKpi({ ages: [minutos, mais antigo primeiro], href }) — "Aguardando confirmação"
export function waitKpi({ ages = [], href = '#/orders?status=pending', label = 'Aguardando confirmação' } = {}) {
  const n = ages.length;
  const late = ages.filter((a) => a >= AGE.late).length;
  const warn = ages.filter((a) => a >= AGE.warn && a < AGE.late).length;
  const oldest = n ? Math.max(...ages) : 0;
  const aria = n
    ? `${n} ${n === 1 ? 'pedido aguardando' : 'pedidos aguardando'} confirmação${late ? `, ${late} há mais de 1 hora` : ''}; o mais antigo há ${fmtAge(oldest)}. Abrir pedidos novos.`
    : 'Nenhum pedido aguardando confirmação. Abrir pedidos.';
  return html`<a class="card kpi kpi--card kpi--wait ${n ? '' : 'is-zero'}" href="${href}" aria-label="${aria}">
    <div class="kpi__top"><span class="kpi__label">${label}</span><span class="kpi__go" aria-hidden="true">${icon('arrowRight', 'icon-xs')}</span></div>
    <div class="kpi__value ${n ? 'kpi__value--warn' : ''}">${num(n)}${n ? html` <small>${n === 1 ? 'pedido' : 'pedidos'}</small>` : ''}</div>
    ${n
      ? html`<div class="kpi__oldest">${icon('clock', 'icon-xs')} Mais antigo: <b>${fmtAge(oldest)}</b></div>
        <div class="waitbar" aria-hidden="true">${[...ages]
          .sort((a, b) => b - a)
          .slice(0, 24)
          .map((a) => html`<span class="waitbar__s ${a >= AGE.late ? 'is-late' : a >= AGE.warn ? 'is-warn' : ''}"></span>`)}</div>
        <div class="waitbar__legend" aria-hidden="true">${late ? html`<span><i class="is-late"></i>${late} há mais de 1 hora</span>` : ''}${
          warn ? html`<span><i class="is-warn"></i>${warn} há mais de 30 min</span>` : ''
        }</div>`
      : html`<div class="kpi__sub kpi__sub--ok">${icon('checkCircle', 'icon-xs')} Nada aguardando</div>`}
  </a>`;
}

/* ---------- Ao vivo, marca da loja, avatar, cabeçalho ---------- */
const LIVE = {
  on: ['Ao vivo', 'Recebendo pedidos em tempo real'],
  retry: ['Reconectando…', 'Tentando reconectar; o som pode atrasar'],
  off: ['Sem conexão', 'Sem tempo real; atualize a página'],
};
export function livePill(state = 'on', { compact = false } = {}) {
  const [label, tipText] = LIVE[state] || LIVE.off;
  return compact
    ? html`<span class="live-dot live-dot--${state}" role="status" aria-label="${label}" title="${tipText}"></span>`
    : html`<span class="live-pill live-pill--${state}" role="status" title="${tipText}"><span class="live-pill__dot" aria-hidden="true"></span>${label}</span>`;
}

const BRAND_MARK = { 'Loja Tavares': ['LT', 'tav'], 'Ativa Móveis': ['AV', 'ativa'] };
const CITY_INITIALS = {
  'Ponte Nova': 'PN',
  Teixeiras: 'TX',
  Mariana: 'MA',
  'Ouro Preto': 'OP',
  'Ouro Branco': 'OB',
  Manhuaçu: 'MH',
  Manhumirim: 'MM',
  Caratinga: 'CA',
  Timóteo: 'TM',
  'Coronel Fabriciano': 'CF',
  'Visconde do Rio Branco': 'VR',
  Viçosa: 'VI',
};
function cityInitials(city = '') {
  if (CITY_INITIALS[city]) return CITY_INITIALS[city];
  const words = fold(city)
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((w) => w && !['DE', 'DO', 'DA', 'DOS', 'DAS', 'E'].includes(w));
  if (!words.length) return '··';
  if (words.length > 1) return words[0][0] + words[1][0];
  const w = words[0];
  const cons = w.slice(1).match(/[BCDFGHJKLMNPQRSTVWXZ]/);
  return w[0] + (cons ? cons[0] : w[1] || '');
}
const storeRegistry = new Map();
// app.js pode registrar as lojas para os selects (data-mark="<id da loja>") desenharem a sigla certa.
export function registerStores(stores = []) {
  storeRegistry.clear();
  stores.forEach((s) => s?.id && storeRegistry.set(String(s.id), s));
}
export function storeInitials(store) {
  const brand = store?.brand_name || store?.brand || '';
  if (BRAND_MARK[brand]) return BRAND_MARK[brand];
  return [cityInitials(store?.city || String(store?.name || '').split(' - ').pop()), 'atual'];
}
// storeMark(loja, tamanho) → ladrilho com a sigla (decorativo; sempre junto do nome da loja)
export function storeMark(store, size = 28) {
  const [ini, tone] = storeInitials(store);
  const fs = size <= 20 ? 8.5 : size <= 24 ? 9.5 : size <= 28 ? 10.5 : 11.5;
  return html`<span class="smark smark--${tone}" style="width:${size}px;height:${size}px;font-size:${fs}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${ini}</span>`;
}
const markFrom = (value, tone, size) => {
  const s = storeRegistry.get(String(value));
  if (s) return storeMark(s, size);
  if (value === 'network' || value === 'all') return html`<span class="smark smark--net" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${icon('houses', 'icon-sm')}</span>`;
  const fs = size <= 20 ? 8.5 : size <= 24 ? 9.5 : 10.5;
  return html`<span class="smark smark--${['tav', 'ativa'].includes(tone) ? tone : 'atual'}" style="width:${size}px;height:${size}px;font-size:${fs}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${String(value).slice(0, 3)}</span>`;
};

export function initials(name = '') {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
}
// avatar(nome, { size, self, tone }) — quadrado arredondado com iniciais
export function avatar(name, { size = 34, self = false, tone = '' } = {}) {
  return html`<span class="avatar ${self ? 'avatar--self' : ''} ${tone ? `avatar--${tone}` : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;border-radius:${Math.round(size * 0.32)}px" aria-hidden="true">${initials(name)}</span>`;
}

// pageHeader({ crumbs: [['Produtos', '#/products'], ['Sofás']], title, sub, meta, actions })
export function pageHeader({ crumbs = [], title = '', sub = '', meta = '', actions = '' } = {}) {
  return html`<header class="page-head page-head--inline">
    <div class="page-head__txt">${
      crumbs.length
        ? html`<nav class="crumbs" aria-label="Trilha">${crumbs.map(
            ([label, href], i) =>
              html`${i ? icon('chevronRight', 'icon-xs') : ''}${
                i === crumbs.length - 1 || !href ? html`<span ${i === crumbs.length - 1 ? raw('aria-current="page"') : ''}>${label}</span>` : html`<a href="${href}">${label}</a>`
              }`
          )}</nav>`
        : ''
    }<h1 class="page-title">${title}</h1>${sub ? html`<p class="page-sub">${sub}</p>` : ''}${meta ? html`<div class="page-meta">${meta}</div>` : ''}</div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

// segmented({ name, label, options: [[valor, rótulo, ícone?]], value, size: 'md'|'sm', icons }) — dispara change no input escondido
export function segmented({ name = '', label = '', options = [], value, size = 'md', icons = false, cls = '' } = {}) {
  const cur = value ?? options[0]?.[0];
  return html`<div class="seg ${size === 'sm' ? 'seg--sm' : ''} ${icons ? 'seg--icons' : ''} ${cls}" role="radiogroup" aria-label="${label}" data-seg ${name ? raw(`data-name="${esc(name)}"`) : ''}>${options.map(
    ([v, l, ico]) => {
      const on = String(v) === String(cur);
      return html`<button type="button" class="seg__b ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-value="${v}" ${
        icons ? raw(`title="${esc(plainText(l))}"`) : ''
      }>${ico ? icon(ico, 'icon-sm') : ''}${icons ? html`<span class="visually-hidden">${l}</span>` : l}</button>`;
    }
  )}${name ? html`<input type="hidden" name="${name}" value="${cur ?? ''}">` : ''}</div>`;
}
function setSeg(seg, btn, focus = true) {
  if (!btn || btn.disabled) return;
  $$('.seg__b', seg).forEach((b) => {
    const on = b === btn;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  if (focus) btn.focus();
  const v = btn.dataset.value;
  const changed = seg.dataset.value !== v;
  seg.dataset.value = v;
  const input = $('input[type="hidden"]', seg);
  if (input && input.value !== v) {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (changed) seg.dispatchEvent(new CustomEvent('seg:change', { bubbles: true, detail: { value: v, name: seg.dataset.name || '' } }));
}

/* ---------- Tabela e paginação ---------- */
// columns: [{ key, label, render?(row) → html|string, cls?, sort? }]
// opções novas: cards (vira cartões < 600 px, com o rótulo de cada coluna), compact, sticky (cabeçalho fixo com rolagem), caption
export function table({ columns, rows, rowAttrs = () => '', empty: emptyText = 'Nada por aqui ainda.', sort, cards = false, compact = false, sticky = false, caption = '', cls = '' } = {}) {
  if (!rows.length) return html`<div class="table-wrap">${empty(emptyText)}</div>`;
  return html`<div class="table-wrap ${sticky ? 'table-wrap--sticky' : ''} ${cards ? 'table-wrap--cards' : ''}"><table class="table ${cards ? 'table--cards' : ''} ${compact ? 'table--compact' : ''} ${cls}">${
    caption ? html`<caption class="visually-hidden">${caption}</caption>` : ''
  }
    <thead><tr>${columns.map((c) => {
      const on = sort && c.sort && sort.key === c.sort;
      return html`<th class="${c.cls || ''}" scope="col" ${
        c.sort ? raw(`data-sort="${esc(c.sort)}" tabindex="0" aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"`) : ''
      }>${c.label}${c.sort ? html`<span class="th-sort ${on ? 'is-on' : ''}" aria-hidden="true">${icon(on && sort.dir === 'asc' ? 'arrowUp' : 'arrowDown', 'icon-xs')}</span>` : ''}</th>`;
    })}</tr></thead>
    <tbody>${rows.map(
      (r) =>
        html`<tr ${raw(rowAttrs(r) || '')}>${columns.map(
          (c) => html`<td class="${c.cls || ''}" ${cards ? raw(`data-label="${esc(plainText(c.label))}"`) : ''}>${c.render ? c.render(r) : r[c.key] ?? '—'}</td>`
        )}</tr>`
    )}</tbody>
  </table></div>`;
}

export function pager({ page, pageSize, total }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const nums = [];
  const add = (n) => nums.push(n);
  if (pages <= 7) for (let i = 1; i <= pages; i++) add(i);
  else {
    add(1);
    const a = Math.max(2, page - 1);
    const b = Math.min(pages - 1, page + 1);
    if (a > 2) add('…');
    for (let i = a; i <= b; i++) add(i);
    if (b < pages - 1) add('…');
    add(pages);
  }
  return html`<div class="pager">
    <span class="pager__info">Mostrando <b>${num(from)}–${num(to)}</b> de ${num(total)}</span>
    <nav class="pager__nav" aria-label="Paginação">
      <button class="btn btn--sm btn--icon" type="button" data-page="${page - 1}" aria-label="Página anterior" ${page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 'icon-sm')}</button>
      ${nums.map((n) =>
        n === '…'
          ? html`<span class="pager__gap" aria-hidden="true">…</span>`
          : html`<button class="page-n ${n === page ? 'is-on' : ''}" type="button" data-page="${n}" aria-label="Página ${n}" ${n === page ? raw('aria-current="page"') : ''}>${n}</button>`
      )}
      <button class="btn btn--sm btn--icon" type="button" data-page="${page + 1}" aria-label="Próxima página" ${page >= pages ? 'disabled' : ''}>${icon('chevronRight', 'icon-sm')}</button>
    </nav>
  </div>`;
}

/* ---------- Gráficos (SVG responsivo, dica no mouse/teclado, tabela acessível) ---------- */
let chartSeq = 0;
// curva suave sem ultrapassar os pontos (Catmull-Rom com controle limitado)
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) * t))];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) * t))];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function niceMax(v, steps = 3) {
  const raw0 = Math.max(1, v) / steps;
  const p = 10 ** Math.floor(Math.log10(raw0));
  const n = raw0 / p;
  const step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => n <= k) || 10) * p;
  return step * steps;
}

// sparkline([valores], { w, h }) — linha marinho com preenchimento e ponto final (decorativa)
export function sparkline(values = [], { w = 240, h = 44, pad = 4 } = {}) {
  const vals = values.map((v) => Number(v) || 0);
  if (vals.length < 2) return raw('');
  const id = `sp${++chartSeq}`;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 6) + 1, pad + 3 + (1 - (v - min) / (max - min || 1)) * (h - pad * 2 - 6)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--spark)" stop-opacity=".14"/><stop offset="1" stop-color="var(--spark)" stop-opacity="0"/></linearGradient></defs><path d="${line} L${last[0]},${h} L${pts[0][0]},${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="var(--spark)" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linecap="round"/><circle class="spark__end" cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--surface)" stroke="var(--spark)" stroke-width="1.75" vector-effect="non-scaling-stroke"/></svg>`);
}

function chartShell({ kind, svg, points, ariaLabel, tableHead, tableRows, cls = '' }) {
  return html`<div class="chartx chartx--${kind} ${cls}" data-chart="${JSON.stringify(points)}">
    <div class="chartx__plot" role="img" tabindex="0" aria-label="${ariaLabel}">${raw(svg)}</div>
    <div class="chartx__tip" hidden></div>
    <div class="visually-hidden"><table><caption>${ariaLabel}</caption><thead><tr>${tableHead.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${tableRows.map(
      (r) => html`<tr>${r.map((c, i) => (i ? html`<td>${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`
    )}</tbody></table></div>
    <div class="visually-hidden" aria-live="polite" data-chart-live></div>
  </div>`;
}

// areaChart([{ label, value, orders?, title? }], { prev: [valores], height, format, ariaLabel, curLabel, prevLabel, tick })
// Devolve html (use direto no template). .mount(el) é opcional: a interação já funciona por delegação.
export function areaChart(points = [], { prev = null, height = 290, format = money, ariaLabel = '', curLabel = 'Este período', prevLabel = 'Período anterior', tick = shortNum, compact = false } = {}) {
  const w = 640;
  const h = height;
  const left = 44;
  const right = 16;
  const top = 14;
  const bottom = 30;
  const n = points.length;
  const vals = points.map((p) => Number(p.value) || 0);
  const pv = Array.isArray(prev) ? prev.map((v) => Number(v) || 0) : null;
  const max = niceMax(Math.max(1, ...vals, ...(pv || [0])));
  const iw = w - left - right;
  const ih = h - top - bottom;
  const x = (i) => left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => top + (1 - v / max) * ih;
  const id = `ac${++chartSeq}`;
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const every = Math.ceil(n / (compact ? 6 : 10)) || 1;
  const ticks = [0, max / 3, (2 * max) / 3, max];
  const svg = `<svg class="chart chart--area" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--chart-main)" stop-opacity=".22"/><stop offset=".75" stop-color="var(--chart-main)" stop-opacity=".03"/><stop offset="1" stop-color="var(--chart-main)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((t) => `<line class="grid-line" x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}
    ${n ? `<path d="${line} L${x(n - 1)},${top + ih} L${x(0)},${top + ih} Z" fill="url(#${id})"/>` : ''}
    ${pv ? `<path class="prev" d="${smoothPath(pv.slice(0, Math.max(n, pv.length)).map((v, i) => [x(i), y(v)]))}"/>` : ''}
    <line class="guide" data-chart-guide x1="0" x2="0" y1="${top}" y2="${top + ih}" visibility="hidden"/>
    <path class="main" d="${line}"/>
    ${pts.map((p) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3.25"/>`).join('')}
    <circle class="halo" data-chart-halo r="11" visibility="hidden"/><circle class="hot" data-chart-hot r="5" visibility="hidden"/>
  </svg>`;
  const yLabels = ticks.map((t) => ({ y: (y(t) / h) * 100, t: tick(t) }));
  const xLabels = points.map((p, i) => ({ x: (x(i) / w) * 100, t: compact ? String(p.label).split(' ').pop() : p.label, show: i % every === 0 || i === n - 1 }));
  const data = points.map((p, i) => {
    const v = vals[i];
    const rows = [];
    if (p.orders !== undefined && p.orders !== null) rows.push(['Pedidos', String(p.orders)]);
    if (pv && pv[i] !== undefined) {
      const d = pv[i] ? ((v - pv[i]) / pv[i]) * 100 : null;
      rows.push([`vs. ${p.prevLabel || 'anterior'}`, d === null ? format(pv[i]) : `${d >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(d))}%`, d === null ? '' : d >= 0 ? 'up' : 'down']);
    }
    return { x: (x(i) / w) * 100, y: (y(v) / h) * 100, cx: x(i), cy: y(v), t: p.title || p.label, v: format(v), r: rows };
  });
  const total = vals.reduce((a, b) => a + b, 0);
  const best = vals.length ? vals.indexOf(Math.max(...vals)) : -1;
  const label =
    ariaLabel ||
    (n ? `Gráfico de ${n} pontos: total ${format(total)}${best >= 0 ? `; maior valor em ${points[best].title || points[best].label}, ${format(vals[best])}` : ''}.` : 'Gráfico sem dados.');
  const out = chartShell({
    kind: 'area',
    svg: `${svg}<div class="chartx__y" aria-hidden="true">${yLabels.map((l) => `<span style="top:${l.y}%">${esc(l.t)}</span>`).join('')}</div><div class="chartx__x" aria-hidden="true">${xLabels
      .map((l) => (l.show ? `<span style="left:${l.x}%">${esc(l.t)}</span>` : ''))
      .join('')}</div>`,
    points: data,
    ariaLabel: label,
    tableHead: ['Dia', curLabel, ...(pv ? [prevLabel] : [])],
    tableRows: points.map((p, i) => [p.title || p.label, format(vals[i]), ...(pv ? [format(pv[i] ?? 0)] : [])]),
    cls: compact ? 'chartx--compact' : '',
  });
  out.mount = () => {};
  out.html = out;
  return out;
}

// barChart([{ label, value, title? }], { height, format }) — mesmo SVG de antes (classe .chart), agora com dica e tabela acessível
export function barChart(data, { height = 220, format = money, ariaLabel = '' } = {}) {
  const w = 760;
  const pad = { l: 56, r: 10, t: 10, b: 26 };
  const max = niceMax(Math.max(1, ...data.map((d) => Number(d.value) || 0)), 4);
  const step = (w - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(36, step * 0.7));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const every = Math.ceil(data.length / 12);
  const points = [];
  const svg = `<svg class="chart chart--bar" viewBox="0 0 ${w} ${height}" aria-hidden="true" focusable="false">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(format(t)).replace(/,00$/, '')}</text>`).join('')}
    ${data
      .map((d, i) => {
        const x = pad.l + i * step + (step - bw) / 2;
        const v = Number(d.value) || 0;
        points.push({ x: ((x + bw / 2) / w) * 100, y: (y(v) / height) * 100, t: d.title || d.label, v: format(v), r: [] });
        const label = i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>` : '';
        return `<rect class="bar" data-i="${i}" x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0, height - pad.b - y(v))}" rx="3"></rect>${label}`;
      })
      .join('')}
  </svg>`;
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0);
  return chartShell({
    kind: 'bar',
    svg,
    points,
    ariaLabel: ariaLabel || `Gráfico de barras com ${data.length} itens; total ${format(total)}.`,
    tableHead: ['Item', 'Valor'],
    tableRows: data.map((d) => [d.title || d.label, format(Number(d.value) || 0)]),
  });
}

function chartSet(wrap, i, announce = false) {
  let pts;
  try {
    pts = JSON.parse(wrap.dataset.chart || '[]');
  } catch {
    pts = [];
  }
  const tip = $('.chartx__tip', wrap);
  if (i === null || i === undefined || !pts[i]) {
    tip.hidden = true;
    wrap.removeAttribute('data-active');
    $$('.bar.is-active', wrap).forEach((b) => b.classList.remove('is-active'));
    ['[data-chart-guide]', '[data-chart-halo]', '[data-chart-hot]'].forEach((s) => $(s, wrap)?.setAttribute('visibility', 'hidden'));
    return;
  }
  const p = pts[i];
  wrap.dataset.active = String(i);
  const guide = $('[data-chart-guide]', wrap);
  if (guide) {
    guide.setAttribute('x1', p.cx);
    guide.setAttribute('x2', p.cx);
    guide.setAttribute('visibility', 'visible');
    ['[data-chart-halo]', '[data-chart-hot]'].forEach((s) => {
      const c = $(s, wrap);
      c.setAttribute('cx', p.cx);
      c.setAttribute('cy', p.cy);
      c.setAttribute('visibility', 'visible');
    });
  }
  $$('.bar', wrap).forEach((b) => b.classList.toggle('is-active', Number(b.dataset.i) === i));
  render(
    tip,
    html`<span class="chartx__tt">${p.t}</span><strong class="chartx__tv">${p.v}</strong>${p.r.map(
      ([k, v, tone]) => html`<span class="chartx__tr"><span>${k}</span><b class="${tone ? `is-${tone}` : ''}">${v}</b></span>`
    )}`
  );
  tip.hidden = false;
  const plot = $('.chartx__plot', wrap);
  const pw = plot.clientWidth;
  const ph = plot.clientHeight;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = (p.x / 100) * pw + 14;
  if (left + tw > pw) left = (p.x / 100) * pw - tw - 14;
  let topPx = (p.y / 100) * ph - th - 12;
  if (topPx < 0) topPx = Math.min(ph - th, (p.y / 100) * ph + 14);
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, topPx)}px`;
  if (announce) {
    const live = $('[data-chart-live]', wrap);
    if (live) live.textContent = `${p.t}: ${p.v}${p.r.map(([k, v]) => `, ${k} ${v}`).join('')}`;
  }
}
function chartNearest(wrap, clientX) {
  let pts;
  try {
    pts = JSON.parse(wrap.dataset.chart || '[]');
  } catch {
    return null;
  }
  const r = $('.chartx__plot', wrap).getBoundingClientRect();
  const px = ((clientX - r.left) / r.width) * 100;
  let best = null;
  let bd = Infinity;
  pts.forEach((p, i) => {
    const d = Math.abs(p.x - px);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/* ---------- CSV ---------- */
export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : r[c.key])).join(';'))].join('\n');
}

export function downloadFile(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Lê CSV separado por ; ou , (com aspas). Devolve array de objetos pelo cabeçalho.
export function parseCSV(text) {
  const src = text.replace(/^﻿/, '');
  const sep = (src.split('\n')[0].match(/;/g) || []).length >= (src.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur.replace(/\r$/, ''));
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/* ---------- Upload de imagens ---------- */
// imageUploader(container, { value: [url], scope: {storeId}|{network:true}, max, folder, onChange(urls) })
// Arrastar para reordenar; a primeira foto é a capa.
export function imageUploader(container, { value = [], scope, max = 12, folder = 'products', onChange = () => {}, label = 'Adicionar fotos' } = {}) {
  let urls = [...value];
  let dragFrom = null;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = max > 1;
  input.hidden = true;

  const draw = () => {
    render(
      container,
      html`<div class="uploader ${max > 1 ? '' : 'uploader--single'}">
        ${urls.map(
          (u, i) => html`<div class="uploader__item ${i === 0 && max > 1 ? 'is-cover' : ''}" draggable="true" data-i="${i}">
            <img src="${mediaUrl(u)}" alt="">
            ${i === 0 && max > 1 ? html`<span class="uploader__tag">Capa</span>` : ''}
            <button class="uploader__remove" type="button" data-remove="${i}" aria-label="Remover foto ${i + 1}">${icon('trash', 'icon-sm')}</button>
          </div>`
        )}
        ${urls.length < max ? html`<button class="uploader__add" type="button" data-add>${icon('upload')}<span>${label}</span><span class="uploader__sub">ou arraste aqui</span></button>` : ''}
      </div>`
    );
    container.appendChild(input);
  };

  const add = async (files) => {
    const list = Array.from(files).slice(0, max - urls.length);
    for (const f of list) {
      const placeholder = urls.length;
      urls.push('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
      draw();
      const tile = container.querySelector(`[data-i="${placeholder}"]`);
      tile?.classList.add('is-uploading');
      tile?.insertAdjacentHTML('beforeend', '<span class="uploader__progress" style="width:60%"></span>');
      try {
        urls[placeholder] = await uploadImage(f, scope, { folder });
      } catch (e) {
        urls.splice(placeholder, 1);
        toastError(e instanceof ApiError ? e : new Error('Falha no envio da imagem.'));
      }
      draw();
      onChange([...urls]);
    }
  };

  container.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) input.click();
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const [removed] = urls.splice(Number(rm.dataset.remove), 1);
      draw();
      onChange([...urls]);
      removeImage(removed).catch(() => {});
    }
  });
  input.addEventListener('change', () => {
    add(input.files);
    input.value = '';
  });
  container.addEventListener('dragstart', (e) => {
    const it = e.target.closest('.uploader__item');
    if (!it) return;
    dragFrom = Number(it.dataset.i);
    it.classList.add('is-dragging');
  });
  container.addEventListener('dragend', () => $$('.is-dragging, .is-over', container).forEach((n) => n.classList.remove('is-dragging', 'is-over')));
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    $$('.is-over', container).forEach((n) => n.classList.remove('is-over'));
    (e.target.closest('.uploader__item') || e.target.closest('.uploader__add'))?.classList.add('is-over');
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) return add(e.dataTransfer.files);
    const to = e.target.closest('.uploader__item');
    if (to && dragFrom !== null) {
      const [m] = urls.splice(dragFrom, 1);
      urls.splice(Number(to.dataset.i), 0, m);
      dragFrom = null;
      draw();
      onChange([...urls]);
    }
  });
  draw();
  return {
    get value() {
      return [...urls];
    },
    set(v) {
      urls = [...v];
      draw();
    },
  };
}

/* ---------- Lista reordenável simples ---------- */
// sortable(listEl, { item: '.selector', onSort(orderedIds) }) — itens precisam de data-id
export function sortable(listEl, { item = '[data-id]', onSort } = {}) {
  let dragging = null;
  listEl.addEventListener('dragstart', (e) => {
    dragging = e.target.closest(item);
    if (dragging) dragging.classList.add('is-dragging');
  });
  listEl.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('is-dragging');
    dragging = null;
    onSort?.($$(item, listEl).map((n) => n.dataset.id));
  });
  listEl.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest(item);
    if (!over || over === dragging) return;
    const rect = over.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    over.parentNode.insertBefore(dragging, after ? over.nextSibling : over);
  });
}

/* =====================================================================
   Select personalizado
   O <select> nativo continua no DOM como fonte da verdade (readForm, showErrors e validação seguem
   funcionando). Ao lado dele entra um gatilho role="combobox" (padrão WAI-ARIA "select-only"); a lista
   abre num popover no <body> (ou numa folha inferior no celular).
   Atributos lidos das <option>: data-hint, data-dot (ok|warn|info|plum|ora|bad|neu), data-swatch ("#hex" ou "a|b"),
   data-icon (nome de ícone ou "auto"), data-mark (id da loja ou sigla) + data-mark-tone, data-badge + data-badge-tone,
   data-meta, data-keywords, data-locked (multi: cadeado, não alterna). <optgroup data-count>.
   Atributos do <select>: data-native (não melhora), data-search (true|false|auto), data-placeholder, data-prefix,
   data-sheet-title, data-search-placeholder, data-chips-max, data-width, classe select--sm / select--lg.
   ===================================================================== */
const SELECTS = new WeakMap();
const SHEET_MQ = '(max-width: 600px), (pointer: coarse)';
const SEL_PROTO = HTMLSelectElement.prototype;
const VALUE_D = Object.getOwnPropertyDescriptor(SEL_PROTO, 'value');
const INDEX_D = Object.getOwnPropertyDescriptor(SEL_PROTO, 'selectedIndex');
const OPT_SEL_D = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected');
const patchedOptions = new WeakSet();
const isOptSelected = (o) => OPT_SEL_D.get.call(o);
const setOptSelected = (o, v) => OPT_SEL_D.set.call(o, v);
const printable = (e) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ';
const safeColor = (c) => {
  const v = String(c || '').trim();
  try {
    return v && CSS.supports('color', v) ? v : '';
  } catch {
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : '';
  }
};
function swatchStyle(sw) {
  const [a, b] = String(sw).split('|').map(safeColor);
  if (!a) return '';
  return b ? `background:linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` : `background:${a}`;
}
// highlight('Viçosa', 'vicosa') → texto com <mark> nos trechos encontrados (sem acento e sem caixa)
export function highlight(text, q) {
  const s = String(text ?? '');
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return s;
  let folded = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    for (const ch of fold(s[i])) {
      folded += ch;
      map.push(i);
    }
  }
  const ranges = [];
  words.forEach((w) => {
    const at = folded.indexOf(w);
    if (at >= 0) ranges.push([map[at], map[at + w.length - 1] + 1]);
  });
  if (!ranges.length) return s;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  });
  const out = [];
  let pos = 0;
  merged.forEach(([a, b]) => {
    out.push(s.slice(pos, a), html`<mark>${s.slice(a, b)}</mark>`);
    pos = b;
  });
  out.push(s.slice(pos));
  return out;
}

function dataOpts(sel) {
  const d = sel.dataset;
  const o = {};
  if (d.search) o.search = d.search === 'true' ? true : d.search === 'false' ? false : 'auto';
  if (d.placeholder) o.placeholder = d.placeholder;
  if (d.prefix) o.prefix = d.prefix;
  if (d.sheetTitle) o.sheetTitle = d.sheetTitle;
  if (d.searchPlaceholder) o.searchPlaceholder = d.searchPlaceholder;
  if (d.chipsMax) o.chipsMax = Number(d.chipsMax) || 2;
  if (d.width) o.width = Number(d.width) || null;
  if (d.sheet === 'false') o.sheet = false;
  return o;
}

class CustomSelect {
  constructor(select, opts = {}) {
    this.select = select;
    this.opts = {
      search: 'auto',
      placeholder: 'Escolha…',
      prefix: '',
      sheet: 'auto',
      sheetTitle: null,
      renderOption: null,
      renderValue: null,
      renderChip: null,
      footer: null,
      chipsMax: 2,
      width: null,
      emptyText: (q) => `Nada encontrado para “${q}”`,
      chevron: null, // nome do ícone no fim do gatilho (padrão chevronDown)
      popClass: '', // classe extra no popover/folha (ex.: 'pop--switcher')
      maxHeight: null, // altura máxima do popover em px (padrão 420)
      onOpen: null,
      onClose: null,
      onLockedActivate: null,
      ...dataOpts(select),
      ...opts,
    };
    if (!select.id) select.id = nextId('sel');
    this.id = select.id;
    this.listId = `${this.id}-list`;
    this.isOpen = false;
    this.mode = null;
    this.active = -1;
    this.query = '';
    this.items = [];
    this.visible = [];
    this.ta = '';
    this.handlers = {};
    this.build();
    this.patch();
    this.observe();
    this.refresh();
    SELECTS.set(select, this);
  }

  get multiple() {
    return this.select.multiple;
  }

  /* ----- montagem ----- */
  build() {
    const s = this.select;
    const t = document.createElement('div');
    this.trigger = t;
    t.id = `${this.id}-trigger`;
    t.setAttribute('role', 'combobox');
    t.setAttribute('aria-haspopup', 'listbox');
    t.setAttribute('aria-expanded', 'false');
    t.setAttribute('aria-controls', this.listId);
    t.setAttribute('aria-autocomplete', 'none');
    t.dataset.for = this.id;
    t.dataset.selTrigger = '';
    t.innerHTML = `<span class="visually-hidden" id="${this.id}-name"></span><span class="sel__value" id="${this.id}-value"></span><span class="sel__end" aria-hidden="true"></span>`;
    this.valueEl = t.querySelector('.sel__value');
    this.nameEl = t.firstElementChild;
    this.endEl = t.querySelector('.sel__end');
    s.after(t);
    this.prevNative = { tabindex: s.getAttribute('tabindex'), ariaHidden: s.getAttribute('aria-hidden') };
    s.classList.add('sel__native');
    s.setAttribute('tabindex', '-1');
    s.setAttribute('aria-hidden', 'true');

    // lista (reaproveitada no popover e na folha)
    const list = document.createElement('div');
    list.className = 'pop__list';
    list.id = this.listId;
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    this.list = list;
    const search = document.createElement('div');
    search.className = 'pop__search';
    search.innerHTML = `${icon('search', 'icon-sm').str}<input class="pop__input" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${this.listId}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><span class="pop__count" aria-live="polite"></span>`;
    this.searchRow = search;
    this.searchInput = search.querySelector('input');
    this.countEl = search.querySelector('.pop__count');
    this.foot = document.createElement('div');
    this.foot.className = 'pop__foot';
    this.allRow = document.createElement('div');
    this.allRow.className = 'pop__all';

    // eventos
    const h = this.handlers;
    h.triggerClick = (e) => {
      const rm = e.target.closest('[data-sel-remove]');
      if (rm) {
        e.preventDefault();
        e.stopPropagation();
        this.removeValue(rm.dataset.selRemove);
        return;
      }
      if (t.closest('label')) e.preventDefault();
      if (this.isDisabled()) return;
      if (this.isOpen) this.close({ focus: true });
      else this.open();
    };
    h.triggerKey = (e) => this.onKey(e, false);
    h.nativeFocus = () => {
      if (!t.hidden && t.isConnected && !this.isDisabled()) t.focus();
    };
    h.nativeChange = () => this.schedule();
    h.searchInput = () => {
      this.query = this.searchInput.value;
      this.renderList();
      this.moveTo('first', { scroll: true });
    };
    h.searchKey = (e) => this.onKey(e, true);
    h.listKey = (e) => this.onKey(e, false);
    h.listDown = (e) => {
      if (e.target.closest('.opt, .pop__all')) e.preventDefault(); // não tira o foco do campo/gatilho
    };
    h.listClick = (e) => {
      const opt = e.target.closest('.opt[data-i]');
      if (!opt) return;
      const it = this.items[Number(opt.dataset.i)];
      this.setActive(Number(opt.dataset.i), { scroll: false });
      this.choose(it);
    };
    h.listMove = (e) => {
      this.layerEl?.classList.remove('is-kbd');
      const opt = e.target.closest('.opt[data-i]');
      if (opt && Number(opt.dataset.i) !== this.active && !this.items[Number(opt.dataset.i)]?.disabled) this.setActive(Number(opt.dataset.i), { scroll: false });
    };
    h.extraClick = (e) => {
      if (e.target.closest('[data-sel-clear]')) {
        e.preventDefault();
        this.clearAll();
      } else if (e.target.closest('[data-sel-done]')) {
        e.preventDefault();
        this.close({ focus: true });
      } else if (e.target.closest('[data-sel-all]')) {
        e.preventDefault();
        this.toggleAll();
      } else if (e.target.closest('[data-sel-close]')) {
        e.preventDefault();
        this.close({ focus: true });
      }
    };
    h.reset = () => setTimeout(() => this.refresh(), 0);
    t.addEventListener('click', h.triggerClick);
    t.addEventListener('keydown', h.triggerKey);
    s.addEventListener('focus', h.nativeFocus);
    s.addEventListener('change', h.nativeChange);
    this.searchInput.addEventListener('input', h.searchInput);
    this.searchInput.addEventListener('keydown', h.searchKey);
    list.addEventListener('keydown', h.listKey);
    list.addEventListener('mousedown', h.listDown);
    list.addEventListener('click', h.listClick);
    list.addEventListener('mousemove', h.listMove);
    this.foot.addEventListener('click', h.extraClick);
    this.foot.addEventListener('mousedown', (e) => {
      if (this.mode === 'pop' && e.target.closest('button')) e.preventDefault(); // o foco continua na busca/gatilho
    });
    this.allRow.addEventListener('mousedown', h.listDown);
    this.allRow.addEventListener('click', h.extraClick);
    this.form = s.form;
    this.form?.addEventListener('reset', h.reset);
  }

  // value/selectedIndex/option.selected escritos por código também atualizam o gatilho
  patch() {
    const s = this.select;
    const self = this;
    Object.defineProperty(s, 'value', {
      configurable: true,
      get() {
        return VALUE_D.get.call(this);
      },
      set(v) {
        VALUE_D.set.call(this, v);
        self.schedule();
      },
    });
    Object.defineProperty(s, 'selectedIndex', {
      configurable: true,
      get() {
        return INDEX_D.get.call(this);
      },
      set(v) {
        INDEX_D.set.call(this, v);
        self.schedule();
      },
    });
  }
  patchOption(o) {
    if (patchedOptions.has(o)) return;
    patchedOptions.add(o);
    Object.defineProperty(o, 'selected', {
      configurable: true,
      get() {
        return OPT_SEL_D.get.call(this);
      },
      set(v) {
        OPT_SEL_D.set.call(this, v);
        const sel = this.closest('select');
        if (sel) SELECTS.get(sel)?.schedule();
      },
    });
  }

  observe() {
    this.mo = new MutationObserver((muts) => {
      let attrs = false;
      let model = false;
      for (const m of muts) {
        if (m.type === 'attributes' && m.target === this.select) {
          if (m.attributeName === 'multiple') model = true;
          attrs = true;
        } else model = true;
      }
      if (model) this.schedule();
      else if (attrs) this.syncAttrs();
    });
    this.mo.observe(this.select, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!this.select.isConnected && !this.trigger.isConnected) return;
      this.refresh();
    });
  }

  /* ----- leitura do <select> ----- */
  readModel() {
    const items = [];
    const push = (o, group) => {
      this.patchOption(o);
      if (o.hidden) return;
      const d = o.dataset;
      const label = (o.label || o.textContent || '').replace(/\s+/g, ' ').trim();
      const it = {
        kind: 'opt',
        o,
        value: o.value,
        label,
        hint: d.hint || '',
        dot: d.dot || '',
        swatch: d.swatch || '',
        icon: d.icon || '',
        mark: d.mark || '',
        markTone: d.markTone || '',
        badge: d.badge || '',
        badgeTone: d.badgeTone || '',
        meta: d.meta || '',
        locked: 'locked' in d,
        disabled: o.disabled || !!group?.disabled,
        group,
      };
      it.search = fold(`${label} ${it.hint} ${d.keywords || ''} ${it.meta}`);
      items.push(it);
    };
    for (const c of this.select.children) {
      if (c.tagName === 'OPTGROUP') {
        if (c.hidden) continue;
        items.push({ kind: 'group', label: c.label, count: c.dataset.count || '', el: c });
        for (const o of c.children) if (o.tagName === 'OPTION') push(o, c);
      } else if (c.tagName === 'OPTION') push(c, null);
    }
    const firstOpt = items.find((x) => x.kind === 'opt');
    if (firstOpt && firstOpt.value === '') firstOpt.isEmpty = true;
    this.items = items;
    this.anyVisual = items.some((x) => x.kind === 'opt' && (x.dot || x.swatch || x.icon || x.mark));
  }
  optionItems() {
    return this.items.filter((x) => x.kind === 'opt');
  }
  selectedItems() {
    return this.items.filter((x) => x.kind === 'opt' && isOptSelected(x.o));
  }
  hasSearch() {
    const s = this.opts.search;
    if (s === true || s === false) return s;
    return this.optionItems().length > 7;
  }
  isDisabled() {
    return this.select.disabled || !!this.select.closest('fieldset[disabled]');
  }
  labelText() {
    const lbl = this.select.labels?.[0];
    if (lbl) return plainText(lbl.textContent).replace(/\s*\*\s*$/, '').trim();
    return this.select.getAttribute('aria-label') || this.select.title || '';
  }

  /* ----- sincronização ----- */
  refresh() {
    if (!this.select.isConnected && this.destroyed !== true && !this.trigger.isConnected) return;
    this.readModel();
    this.syncAttrs();
    this.renderValue();
    if (this.isOpen) {
      const keepValue = this.items[this.active]?.value;
      this.renderList();
      const idx = this.items.findIndex((x) => x.kind === 'opt' && x.value === keepValue);
      this.setActive(idx >= 0 && this.visible.includes(idx) ? idx : this.firstEnabled(), { scroll: false });
    }
  }
  syncAttrs() {
    const s = this.select;
    const t = this.trigger;
    const copy = [...s.classList].filter((c) => c !== 'select' && c !== 'sel__native');
    const size = s.classList.contains('select--sm') || s.closest('.toolbar--sm') ? 'sm' : s.classList.contains('select--lg') ? 'lg' : '';
    const disabled = this.isDisabled();
    const busy = s.getAttribute('aria-busy') === 'true' || s.hasAttribute('data-loading');
    t.className = [
      'select',
      'sel__trigger',
      ...copy,
      this.multiple ? 'sel__trigger--multi' : '',
      size ? `sel__trigger--${size}` : '',
      disabled ? 'is-disabled' : '',
      busy ? 'is-busy' : '',
      this.isOpen ? 'is-open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    t.tabIndex = disabled ? -1 : 0;
    t.toggleAttribute('aria-disabled', disabled);
    if (disabled) t.setAttribute('aria-disabled', 'true');
    t.hidden = s.hidden;
    t.style.display = s.style.display === 'none' ? 'none' : '';
    if (s.style.width) t.style.width = s.style.width;
    ['aria-invalid', 'title', 'aria-describedby'].forEach((a) => (s.hasAttribute(a) ? t.setAttribute(a, s.getAttribute(a)) : t.removeAttribute(a)));
    if (s.required) t.setAttribute('aria-required', 'true');
    else t.removeAttribute('aria-required');
    if (busy) t.setAttribute('aria-busy', 'true');
    else t.removeAttribute('aria-busy');
    // nome acessível: <label for> + valor
    const lbl = s.labels?.[0];
    if (lbl) {
      if (!lbl.id) lbl.id = `${this.id}-label`;
      this.nameEl.textContent = '';
      t.setAttribute('aria-labelledby', `${lbl.id} ${this.id}-value`);
    } else {
      this.nameEl.textContent = s.getAttribute('aria-label') || s.title || this.opts.sheetTitle || '';
      t.setAttribute('aria-labelledby', this.nameEl.textContent ? `${this.id}-name ${this.id}-value` : `${this.id}-value`);
    }
    if (this.opts.width) t.style.minWidth = `${this.opts.width}px`;
    render(this.endEl, busy ? html`<span class="spinner spinner--sm"></span>` : disabled ? icon('lock', 'icon-sm sel__chev') : icon(this.opts.chevron || 'chevronDown', 'icon-sm sel__chev'));
  }
  visual(it, size = 'opt') {
    if (!it) return '';
    if (it.swatch) {
      const st = swatchStyle(it.swatch);
      return st ? html`<span class="swatch" style="${st}" aria-hidden="true"></span>` : '';
    }
    if (it.icon === 'auto') return html`<span class="opt__icon opt__icon--auto" aria-hidden="true">${icon('sparkle', 'icon-sm')}</span>`;
    if (it.icon && hasIcon(it.icon)) return size === 'value' ? icon(it.icon, 'icon-sm sel__ico') : html`<span class="opt__icon" aria-hidden="true">${icon(it.icon, 'icon-sm')}</span>`;
    if (it.mark) return markFrom(it.mark, it.markTone, size === 'value' ? 22 : 26);
    if (it.dot) return html`<span class="dot t-${it.dot}" aria-hidden="true"></span>`;
    if (it.isEmpty && this.anyVisual && size !== 'value') return html`<span class="opt__icon opt__icon--empty" aria-hidden="true">${icon('layers', 'icon-sm')}</span>`;
    return '';
  }
  renderValue() {
    const sel = this.selectedItems();
    const prefix = this.opts.prefix ? html`<span class="sel__prefix">${this.opts.prefix}</span>` : '';
    if (this.multiple) {
      const max = this.opts.chipsMax;
      const shown = sel.slice(0, max);
      const more = sel.length - shown.length;
      const names = sel.map((x) => x.label).join(', ');
      render(
        this.valueEl,
        sel.length
          ? html`${prefix}<span class="sel__chips" aria-hidden="true">${shown.map((it) =>
              this.opts.renderChip
                ? this.opts.renderChip(it, { selected: true })
                : html`<span class="chip chip--sel">${this.visual(it, 'value')}<span class="chip__l">${it.label}</span>${
                    it.locked || it.disabled ? '' : html`<span class="chip__x" data-sel-remove="${it.value}" title="Remover ${it.label}">${icon('close', 'icon-xs')}</span>`
                  }</span>`
            )}${more > 0 ? html`<span class="chip chip--more">+${more}</span>` : ''}</span><span class="visually-hidden">${sel.length} ${
              sel.length === 1 ? 'selecionada' : 'selecionadas'
            }: ${names}</span>`
          : html`${prefix}<span class="sel__label is-placeholder">${this.opts.placeholder}</span>`
      );
      return;
    }
    const it = sel[0];
    const custom = it && this.opts.renderValue ? this.opts.renderValue(it) : null;
    if (custom !== null && custom !== undefined) {
      render(this.valueEl, html`${prefix}${custom}`);
      return;
    }
    if (!it || (it.isEmpty && !it.label)) {
      render(this.valueEl, html`${prefix}<span class="sel__label is-placeholder">${this.opts.placeholder}</span>`);
      return;
    }
    render(this.valueEl, html`${prefix}${this.visual(it, 'value')}<span class="sel__label ${it.isEmpty ? 'is-placeholder' : ''}">${it.label}</span>`);
  }

  /* ----- lista ----- */
  renderList() {
    const q = this.query.trim();
    const words = fold(q).split(/\s+/).filter(Boolean);
    const rows = [];
    this.visible = [];
    let group = null;
    let groupRows = [];
    let gi = 0;
    const flush = () => {
      if (group && groupRows.length) {
        const gid = `${this.id}-g${gi++}`;
        rows.push(
          html`<div class="pop__group" role="group" aria-labelledby="${gid}"><div class="pop__group-label" id="${gid}" role="presentation"><span>${group.label}</span>${
            group.count ? html`<span class="pop__group-n">${group.count}</span>` : ''
          }</div>${groupRows}</div>`
        );
      } else if (!group) rows.push(...groupRows);
      groupRows = [];
    };
    this.items.forEach((it, i) => {
      if (it.kind === 'group') {
        flush();
        group = it;
        return;
      }
      if (group && it.group !== group.el) {
        flush();
        group = null;
      }
      if (words.length && !words.every((w) => it.search.includes(w))) return;
      this.visible.push(i);
      groupRows.push(this.optionHtml(it, i, q));
    });
    flush();
    if (!this.visible.length) rows.push(html`<div class="pop__empty" role="presentation">${q ? this.opts.emptyText(q) : 'Nenhuma opção disponível'}</div>`);
    const st = this.list.scrollTop;
    render(this.list, rows);
    this.list.scrollTop = st;
    this.list.setAttribute('aria-multiselectable', this.multiple ? 'true' : 'false');
    const lbl = this.select.labels?.[0];
    if (lbl?.id) this.list.setAttribute('aria-labelledby', lbl.id);
    else this.list.setAttribute('aria-label', this.labelText() || 'Opções');
    if (this.hasSearch()) {
      const n = this.visible.length;
      this.countEl.textContent = q ? `${n} ${n === 1 ? 'resultado' : 'resultados'}` : '';
    }
    if (this.multiple) this.renderAllRow();
  }
  optionHtml(it, i, q) {
    const selected = isOptSelected(it.o);
    const custom = this.opts.renderOption?.(it, { selected, query: q, multiple: this.multiple });
    const lead = this.multiple
      ? it.locked
        ? html`<span class="opt__lock" aria-hidden="true">${icon('lock', 'icon-xs')}</span>`
        : html`<span class="cbx ${selected ? 'is-on' : ''}" aria-hidden="true">${icon('check', 'icon-xs')}</span>`
      : '';
    return html`<div class="opt ${it.hint ? 'opt--2l' : ''} ${selected ? 'is-selected' : ''} ${it.disabled ? 'is-disabled' : ''} ${it.locked ? 'is-locked' : ''}" role="option" id="${this.id}-opt-${i}" data-value="${it.value}" data-i="${i}" aria-selected="${selected ? 'true' : 'false'}" ${it.disabled ? raw('aria-disabled="true"') : ''}>${lead}${
      custom ??
      html`${this.visual(it)}<span class="opt__body"><span class="opt__label">${highlight(it.label, q)}</span>${it.hint ? html`<span class="opt__hint">${highlight(it.hint, q)}</span>` : ''}</span>${
        it.meta ? html`<span class="opt__meta">${it.meta}</span>` : ''
      }${it.badge ? html`<span class="opt__tag opt__tag--${it.badgeTone || 'neu'}">${it.badge}</span>` : ''}${
        it.disabled && !it.locked && this.multiple ? html`<span class="opt__lockic" aria-hidden="true">${icon('lock', 'icon-xs')}</span>` : ''
      }`
    }${this.multiple ? '' : html`<span class="opt__check" aria-hidden="true">${icon('check', 'icon-sm')}</span><span class="opt__radio" aria-hidden="true"></span>`}</div>`;
  }
  renderAllRow() {
    const free = this.optionItems().filter((x) => !x.disabled && !x.locked);
    const on = free.filter((x) => isOptSelected(x.o)).length;
    const total = this.optionItems().length;
    const state = on === 0 ? '' : on === free.length ? 'is-on' : 'is-mixed';
    render(
      this.allRow,
      free.length > 1 && !this.query
        ? html`<button type="button" class="opt opt--all" data-sel-all aria-pressed="${on === free.length ? 'true' : on ? 'mixed' : 'false'}"><span class="cbx ${state}" aria-hidden="true">${icon(
            'check',
            'icon-xs'
          )}</span><span class="opt__body"><span class="opt__label">${this.opts.allLabel || 'Selecionar todas'}</span><span class="opt__hint">${this.selectedItems().length} de ${total} ${
            total === 1 ? 'selecionada' : 'selecionadas'
          }</span></span></button>`
        : ''
    );
  }
  renderFoot() {
    const extra = typeof this.opts.footer === 'function' ? this.opts.footer({ close: () => this.close({ focus: true }) }) : this.opts.footer;
    if (this.multiple) {
      render(
        this.foot,
        html`${extra || ''}<div class="pop__foot-acts"><button type="button" class="btn btn--ghost btn--sm" data-sel-clear>Limpar</button><button type="button" class="btn btn--dark btn--sm" data-sel-done>Concluir</button></div>`
      );
      this.foot.hidden = false;
    } else if (extra) {
      render(this.foot, extra);
      this.foot.hidden = false;
    } else {
      render(this.foot, '');
      this.foot.hidden = true;
    }
  }
  firstEnabled() {
    return this.visible.find((i) => !this.items[i].disabled) ?? -1;
  }
  lastEnabled() {
    return [...this.visible].reverse().find((i) => !this.items[i].disabled) ?? -1;
  }
  setActive(i, { scroll = true } = {}) {
    this.active = i;
    $$('.opt.is-active', this.list).forEach((n) => n.classList.remove('is-active'));
    const el = i >= 0 ? this.list.querySelector(`#${CSS.escape(`${this.id}-opt-${i}`)}`) : null;
    if (el) el.classList.add('is-active');
    const holder = this.activeHolder();
    [this.trigger, this.searchInput, this.list].forEach((n) => {
      if (n !== holder) n.removeAttribute('aria-activedescendant');
    });
    if (el) holder.setAttribute('aria-activedescendant', el.id);
    else holder.removeAttribute('aria-activedescendant');
    if (el && scroll) {
      const lr = this.list.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (er.top < lr.top + 4) this.list.scrollTop -= lr.top + 4 - er.top;
      else if (er.bottom > lr.bottom - 4) this.list.scrollTop += er.bottom - lr.bottom + 4;
    }
  }
  activeHolder() {
    if (this.mode === 'sheet') return document.activeElement === this.searchInput ? this.searchInput : this.list;
    return this.hasSearch() ? this.searchInput : this.trigger;
  }
  move(delta) {
    if (!this.visible.length) return;
    const enabled = this.visible.filter((i) => !this.items[i].disabled);
    if (!enabled.length) return;
    let pos = enabled.indexOf(this.active);
    if (pos < 0) pos = delta > 0 ? -1 : enabled.length;
    const next = Math.max(0, Math.min(enabled.length - 1, pos + delta));
    this.setActive(enabled[next]);
  }
  moveTo(where, { scroll = true } = {}) {
    this.setActive(where === 'last' ? this.lastEnabled() : this.firstEnabled(), { scroll });
  }
  typeahead(ch) {
    clearTimeout(this.taTimer);
    this.ta += fold(ch);
    this.taTimer = setTimeout(() => (this.ta = ''), 500);
    const enabled = this.visible.filter((i) => !this.items[i].disabled);
    if (!enabled.length) return;
    const same = [...this.ta].every((c) => c === this.ta[0]);
    const term = same ? this.ta[0] : this.ta;
    const pos = enabled.indexOf(this.active);
    const startAt = same || this.ta.length === 1 ? pos + 1 : Math.max(0, pos);
    for (let k = 0; k < enabled.length; k++) {
      const i = enabled[(startAt + k + enabled.length) % enabled.length];
      if (fold(this.items[i].label).startsWith(term)) {
        this.setActive(i);
        return;
      }
    }
  }

  /* ----- abrir / fechar ----- */
  open({ activate = 'selected', query = '', kbd = false } = {}) {
    if (this.isOpen || this.isDisabled() || !this.trigger.isConnected) return;
    clearTimeout(this.leaveTimer);
    this.readModel();
    this.isOpen = true;
    let sheet = false;
    try {
      sheet = this.opts.sheet !== false && matchMedia(SHEET_MQ).matches;
    } catch {
      sheet = false;
    }
    this.mode = sheet ? 'sheet' : 'pop';
    this.query = query;
    this.searchInput.value = query;
    const label = this.labelText();
    this.searchInput.placeholder = this.opts.searchPlaceholder || (label ? `Buscar ${label.toLowerCase()}…` : 'Buscar…');
    this.searchInput.setAttribute('aria-label', this.searchInput.placeholder);
    this.renderFoot();
    this.renderList();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.trigger.classList.add('is-open');
    if (this.mode === 'sheet') this.mountSheet(label);
    else this.mountPop();
    this.layerEl.classList.toggle('is-kbd', kbd);
    pushLayer(this.layerEl, { onEscape: () => this.close({ focus: true }) });
    // opção ativa inicial
    const sel = this.selectedItems()[0];
    const selIdx = sel ? this.items.indexOf(sel) : -1;
    let idx = selIdx >= 0 && this.visible.includes(selIdx) && !sel.disabled ? selIdx : -1;
    if (query) idx = this.firstEnabled();
    else if (activate === 'first') idx = this.firstEnabled();
    else if (activate === 'last') idx = this.lastEnabled();
    else if (activate === 'selected-or-last' && idx < 0) idx = this.lastEnabled();
    else if (idx < 0) idx = this.firstEnabled();
    // foco
    if (this.mode === 'sheet') this.list.focus({ preventScroll: true });
    else if (this.hasSearch()) {
      this.searchInput.focus({ preventScroll: true });
      const len = this.searchInput.value.length;
      this.searchInput.setSelectionRange(len, len);
    }
    this.setActive(idx);
    // fora → fecha
    const h = this.handlers;
    h.outside = (e) => {
      if (this.trigger.contains(e.target) || this.layerEl.contains(e.target) || (this.scrim && e.target === this.scrim)) return;
      const backdrop = e.target.closest?.('.overlay, .sheet-scrim');
      this.close({ focus: false });
      if (backdrop && backdrop !== this.scrim) {
        // o clique fecha só a camada de cima (o select), não a janela de baixo
        const stop = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', stop, true), 450);
      }
    };
    h.focusIn = (e) => {
      if (!this.trigger.contains(e.target) && !this.layerEl.contains(e.target)) this.close({ focus: false });
    };
    document.addEventListener('pointerdown', h.outside, true);
    document.addEventListener('focusin', h.focusIn);
    this.opts.onOpen?.(this);
  }

  mountPop() {
    if (!this.pop) {
      this.pop = document.createElement('div');
      this.pop.className = 'pop pop--sel';
      this.pop.dataset.selPop = '';
    }
    const pop = this.pop;
    pop.classList.remove('is-leaving');
    pop.classList.toggle('pop--multi', this.multiple);
    if (this.opts.popClass) pop.classList.add(...String(this.opts.popClass).split(/\s+/).filter(Boolean));
    pop.replaceChildren();
    if (this.hasSearch()) pop.append(this.searchRow);
    if (this.multiple) pop.append(this.allRow);
    pop.append(this.list);
    if (!this.foot.hidden) pop.append(this.foot);
    document.body.append(pop);
    this.layerEl = pop;
    // limites de rolagem (para fechar se o gatilho sumir de vista)
    this.clippers = [];
    for (let p = this.trigger.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflow}${cs.overflowX}${cs.overflowY}`)) this.clippers.push(p);
    }
    this.position();
    const h = this.handlers;
    h.reflow = (e) => {
      if (e && e.type === 'scroll' && e.target !== document && this.pop.contains(e.target)) return;
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        if (this.isOpen && this.mode === 'pop') this.position();
      });
    };
    window.addEventListener('scroll', h.reflow, true);
    window.addEventListener('resize', h.reflow);
    window.visualViewport?.addEventListener('resize', h.reflow);
  }
  position() {
    const pop = this.pop;
    const t = this.trigger;
    const r = t.getBoundingClientRect();
    const hiddenNow = !r.width && !r.height;
    const clipped = this.clippers?.some((c) => {
      const cr = c.getBoundingClientRect();
      return r.bottom < cr.top + 2 || r.top > cr.bottom - 2 || r.right < cr.left || r.left > cr.right;
    });
    if (hiddenNow || clipped || !t.isConnected) {
      this.close({ focus: false });
      return;
    }
    const vw = document.documentElement.clientWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    const margin = 8;
    const gap = 6;
    pop.style.minWidth = `${Math.round(r.width)}px`;
    pop.style.maxWidth = `${Math.min(this.opts.width ? Math.max(this.opts.width, r.width) : 440, vw - margin * 2)}px`;
    if (this.opts.width) pop.style.width = `${Math.max(this.opts.width, r.width)}px`;
    const below = vh - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const chrome = [this.searchRow, this.allRow, this.foot].reduce((a, n) => a + (n.parentNode === pop ? n.offsetHeight : 0), 0);
    const cap = this.opts.maxHeight || 420;
    const natural = Math.min(cap, chrome + this.list.scrollHeight + 14);
    const placeBelow = below >= Math.min(natural, 240) || below >= above;
    const maxH = Math.max(140, Math.min(cap, placeBelow ? below : above));
    pop.style.maxHeight = `${maxH}px`;
    const ph = pop.offsetHeight;
    const pw = pop.offsetWidth;
    let left = r.left;
    if (left + pw > vw - margin) left = r.right - pw;
    left = Math.max(margin, Math.min(left, vw - margin - pw));
    const top = placeBelow ? r.bottom + gap : Math.max(margin, r.top - gap - ph);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.dataset.side = placeBelow ? 'bottom' : 'top';
  }

  mountSheet(label) {
    if (!this.sheet) {
      this.scrim = document.createElement('div');
      this.scrim.className = 'sheet-scrim';
      this.sheet = document.createElement('div');
      this.sheet.className = 'sheet sheet--sel';
      this.sheet.setAttribute('role', 'dialog');
      this.sheet.setAttribute('aria-modal', 'true');
      this.sheet.setAttribute('aria-labelledby', `${this.id}-sheet-t`);
      this.sheetHead = document.createElement('div');
      this.sheetHead.className = 'sheet__top';
      this.sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-sel-close]')) {
          e.preventDefault();
          this.close({ focus: true });
        }
      });
      this.scrim.addEventListener('click', () => this.close({ focus: true }));
      this.sheet.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const f = focusable(this.sheet);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      });
      this.bindSwipe();
    }
    render(
      this.sheetHead,
      html`<span class="sheet__grab" aria-hidden="true"></span><div class="sheet__head"><h2 id="${this.id}-sheet-t">${this.opts.sheetTitle || label || 'Escolha uma opção'}</h2><button class="btn btn--ghost btn--icon" type="button" data-sel-close aria-label="Fechar">${icon(
        'close'
      )}</button></div>`
    );
    if (this.opts.popClass) this.sheet.classList.add(...String(this.opts.popClass).split(/\s+/).filter(Boolean));
    this.sheet.replaceChildren(this.sheetHead);
    if (this.hasSearch()) this.sheet.append(this.searchRow);
    if (this.multiple) this.sheet.append(this.allRow);
    this.sheet.append(this.list);
    this.list.tabIndex = 0;
    if (!this.foot.hidden) this.sheet.append(this.foot);
    this.sheet.style.transform = '';
    this.sheet.classList.remove('is-leaving');
    this.scrim.classList.remove('is-leaving');
    document.body.append(this.scrim, this.sheet);
    this.layerEl = this.sheet;
    lockScroll();
    // botão "voltar" do celular fecha a folha
    try {
      this.histToken = nextId('sheet');
      history.pushState({ ...(history.state || {}), atualSheet: this.histToken }, '');
      this.handlers.pop = () => {
        if (this.isOpen && this.mode === 'sheet') {
          this.histToken = null;
          this.close({ focus: true, fromHistory: true });
        }
      };
      window.addEventListener('popstate', this.handlers.pop);
    } catch {
      this.histToken = null;
    }
  }
  bindSwipe() {
    let y0 = null;
    let dy = 0;
    let t0 = 0;
    const down = (e) => {
      if (!e.target.closest('.sheet__top') || e.target.closest('button')) return;
      y0 = e.clientY;
      dy = 0;
      t0 = Date.now();
      this.sheet.setPointerCapture?.(e.pointerId);
      this.sheet.classList.add('is-dragging');
    };
    const move = (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      this.sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (y0 === null) return;
      y0 = null;
      this.sheet.classList.remove('is-dragging');
      const fast = dy > 30 && Date.now() - t0 < 250;
      if (dy > 90 || fast) this.close({ focus: true });
      else this.sheet.style.transform = '';
    };
    this.sheet.addEventListener('pointerdown', down);
    this.sheet.addEventListener('pointermove', move);
    this.sheet.addEventListener('pointerup', up);
    this.sheet.addEventListener('pointercancel', up);
  }

  close({ focus = false, fromHistory = false } = {}) {
    if (!this.isOpen) return Promise.resolve();
    this.isOpen = false;
    const h = this.handlers;
    popLayer(this.layerEl);
    document.removeEventListener('pointerdown', h.outside, true);
    document.removeEventListener('focusin', h.focusIn);
    window.removeEventListener('scroll', h.reflow, true);
    window.removeEventListener('resize', h.reflow);
    window.visualViewport?.removeEventListener('resize', h.reflow);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.classList.remove('is-open');
    this.trigger.removeAttribute('aria-activedescendant');
    this.searchInput.removeAttribute('aria-activedescendant');
    this.list.removeAttribute('aria-activedescendant');
    const wasSheet = this.mode === 'sheet';
    let done = Promise.resolve();
    if (wasSheet) {
      const sheet = this.sheet;
      const scrim = this.scrim;
      sheet.classList.add('is-leaving');
      scrim.classList.add('is-leaving');
      setTimeout(
        () => {
          if (!this.isOpen || this.mode !== 'sheet') {
            sheet.remove();
            scrim.remove();
          }
        },
        reducedMotion() ? 0 : 200
      );
      unlockScroll();
      this.list.tabIndex = -1;
      window.removeEventListener('popstate', h.pop);
      if (!fromHistory && this.histToken && history.state?.atualSheet === this.histToken) {
        this.histToken = null;
        done = new Promise((resolve) => {
          let fin = false;
          const finish = () => {
            if (fin) return;
            fin = true;
            window.removeEventListener('popstate', finish);
            resolve();
          };
          window.addEventListener('popstate', finish);
          setTimeout(finish, 350);
          history.back();
        });
      }
    } else if (this.pop) {
      const pop = this.pop;
      pop.classList.add('is-leaving');
      this.leaveTimer = setTimeout(() => pop.remove(), reducedMotion() ? 0 : 100);
    }
    this.mode = null;
    this.query = '';
    this.searchInput.value = '';
    this.ta = '';
    if (focus && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
    this.opts.onClose?.(this);
    return done;
  }

  /* ----- escolher ----- */
  emit() {
    this.select.dispatchEvent(new Event('input', { bubbles: true }));
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  choose(it) {
    if (!it || it.kind !== 'opt') return;
    if (it.locked || it.disabled) {
      if (it.locked) this.opts.onLockedActivate?.(it, this);
      return;
    }
    if (this.multiple) {
      setOptSelected(it.o, !isOptSelected(it.o));
      this.afterMultiChange();
      return;
    }
    const changed = !isOptSelected(it.o);
    const commit = () => {
      if (changed) {
        setOptSelected(it.o, true);
        this.renderValue();
        this.emit();
      }
    };
    if (this.mode === 'sheet') {
      this.close({ focus: true }).then(commit);
    } else {
      commit();
      this.close({ focus: true });
    }
  }
  afterMultiChange() {
    this.renderValue();
    const keep = this.active;
    this.renderList();
    this.setActive(keep, { scroll: false });
    this.emit();
    if (this.isOpen && this.mode === 'pop') this.position();
  }
  chooseActive() {
    const it = this.items[this.active];
    if (it) this.choose(it);
  }
  removeValue(value) {
    const it = this.optionItems().find((x) => x.value === value);
    if (!it || it.locked || it.disabled) return;
    setOptSelected(it.o, false);
    this.renderValue();
    if (this.isOpen) this.afterMultiChange();
    else this.emit();
  }
  clearAll() {
    let changed = false;
    this.optionItems().forEach((x) => {
      if (!x.locked && !x.disabled && isOptSelected(x.o)) {
        setOptSelected(x.o, false);
        changed = true;
      }
    });
    if (!this.multiple) {
      const emptyIt = this.optionItems().find((x) => x.isEmpty);
      if (emptyIt) setOptSelected(emptyIt.o, true);
    }
    if (changed) this.afterMultiChange();
  }
  toggleAll() {
    const free = this.optionItems().filter((x) => !x.disabled && !x.locked && (!this.query || this.visible.includes(this.items.indexOf(x))));
    const allOn = free.every((x) => isOptSelected(x.o));
    free.forEach((x) => setOptSelected(x.o, !allOn));
    this.afterMultiChange();
  }

  /* ----- teclado ----- */
  onKey(e, fromSearch) {
    if (e.isComposing) return;
    const k = e.key;
    if (!this.isOpen) {
      if (this.isDisabled() || fromSearch) return;
      if (k === 'ArrowDown' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        this.open({ activate: 'selected', kbd: true });
      } else if (k === 'ArrowUp') {
        e.preventDefault();
        this.open({ activate: 'selected-or-last' });
      } else if (k === 'Home' || k === 'End') {
        e.preventDefault();
        this.open({ activate: k === 'Home' ? 'first' : 'last' });
      } else if (printable(e)) {
        e.preventDefault();
        if (this.hasSearch()) this.open({ query: e.key });
        else {
          this.open();
          this.typeahead(e.key);
        }
      }
      return;
    }
    const typing = fromSearch && this.searchInput.value !== '';
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(k) || (!fromSearch && printable(e))) this.layerEl?.classList.add('is-kbd');
    switch (k) {
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey && !this.multiple) this.chooseActive();
        else this.move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        this.move(10);
        break;
      case 'PageUp':
        e.preventDefault();
        this.move(-10);
        break;
      case 'Home':
      case 'End':
        if (typing) return;
        e.preventDefault();
        this.moveTo(k === 'Home' ? 'first' : 'last');
        break;
      case 'Enter':
        e.preventDefault();
        this.chooseActive();
        break;
      case ' ':
        if (fromSearch && (typing || !this.multiple)) return;
        e.preventDefault();
        this.chooseActive();
        break;
      case 'Tab':
        this.onTab(e);
        break;
      case 'Backspace':
        if (fromSearch && !typing && this.multiple) {
          const last = this.selectedItems().filter((x) => !x.locked && !x.disabled).pop();
          if (last) {
            e.preventDefault();
            this.removeValue(last.value);
          }
        }
        break;
      default:
        if ((k === 'a' || k === 'A') && (e.ctrlKey || e.metaKey) && this.multiple && !typing) {
          e.preventDefault();
          this.toggleAll();
        } else if (!fromSearch && printable(e)) {
          e.preventDefault();
          if (this.hasSearch() && this.mode === 'pop') {
            this.searchInput.focus();
            this.searchInput.value += e.key;
            this.searchInput.dispatchEvent(new Event('input'));
          } else this.typeahead(e.key);
        }
    }
  }
  onTab(e) {
    if (this.mode === 'sheet') return; // a folha prende o foco (tratado no keydown da folha)
    this.close({ focus: false });
    this.trigger.focus({ preventScroll: true });
    const scope = this.trigger.closest('.modal, .panel, .sheet');
    if (!scope) return; // o Tab do navegador continua a partir do gatilho
    const f = focusable(scope);
    const i = f.indexOf(this.trigger);
    if (i < 0) return;
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  }

  /* ----- API pública ----- */
  setValue(v, { silent = false } = {}) {
    const vals = Array.isArray(v) ? v.map(String) : [String(v ?? '')];
    if (this.multiple) this.optionItems().forEach((x) => setOptSelected(x.o, vals.includes(x.value)));
    else VALUE_D.set.call(this.select, vals[0]);
    this.refresh();
    if (!silent) this.emit();
  }
  setOptions(opts = {}) {
    Object.assign(this.opts, opts);
    this.refresh();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close({ focus: false });
    this.mo?.disconnect();
    const s = this.select;
    const h = this.handlers;
    delete s.value;
    delete s.selectedIndex;
    s.removeEventListener('focus', h.nativeFocus);
    s.removeEventListener('change', h.nativeChange);
    this.form?.removeEventListener('reset', h.reset);
    s.classList.remove('sel__native');
    if (this.prevNative.tabindex === null) s.removeAttribute('tabindex');
    else s.setAttribute('tabindex', this.prevNative.tabindex);
    if (this.prevNative.ariaHidden === null) s.removeAttribute('aria-hidden');
    else s.setAttribute('aria-hidden', this.prevNative.ariaHidden);
    this.trigger.remove();
    this.pop?.remove();
    this.sheet?.remove();
    this.scrim?.remove();
    SELECTS.delete(s);
  }
}

// O seletor de loja ([data-store-switch]) não entra no automático: o app.js monta o dele com customSelect(sel, { renderOption, renderValue }).
const shouldEnhance = (s) =>
  s instanceof HTMLSelectElement &&
  !s.closest('[data-native]') &&
  !s.hasAttribute('data-store-switch') &&
  !(s.size > 1 && !s.multiple) &&
  !!s.closest('#root, .modal, .panel, .sheet, .pop, [data-ui]');

// customSelect(select, opções) → { el, select, open(), close(), refresh(), setValue(v, { silent }), setOptions(o), destroy() }
export function customSelect(select, opts) {
  if (!(select instanceof HTMLSelectElement)) return null;
  const cur = SELECTS.get(select);
  if (cur && !cur.destroyed) {
    if (opts && Object.keys(opts).length) cur.setOptions(opts);
    return cur.api;
  }
  const inst = new CustomSelect(select, opts);
  inst.api = {
    el: inst.trigger,
    select,
    open: (o) => inst.open(o),
    close: () => inst.close({ focus: true }),
    refresh: () => inst.refresh(),
    setValue: (v, o) => inst.setValue(v, o),
    setOptions: (o) => inst.setOptions(o),
    destroy: () => inst.destroy(),
    get isOpen() {
      return inst.isOpen;
    },
  };
  return inst.api;
}
export const enhanceSelect = (select, opts) => customSelect(select, opts);
export const getSelect = (select) => SELECTS.get(select)?.api || null;
// melhora todos os selects de uma raiz (exceto [data-native]); devolve as instâncias
export function enhanceSelects(root = document, opts) {
  const list = root instanceof HTMLSelectElement ? [root] : $$('select', root);
  return list.filter((s) => !s.closest('[data-native]') && !(s.size > 1 && !s.multiple)).map((s) => customSelect(s, opts));
}

// multiSelect(container, { name, label, options: [{ value, label, hint, group, mark, badge, badgeTone, locked, disabled, meta, keywords, selected }],
//   value: [], placeholder, chipsMax, allLabel, renderChip, footer, onChange(values, { added, removed }), onLockedActivate(opt) })
export function multiSelect(container, opts = {}) {
  const id = opts.id || nextId('ms');
  const optionHtml = (o, value) =>
    html`<option value="${o.value}" ${value.includes(String(o.value)) || o.selected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''} ${o.locked ? raw('data-locked') : ''} ${
      o.hint ? raw(`data-hint="${esc(o.hint)}"`) : ''
    } ${o.mark ? raw(`data-mark="${esc(o.mark)}"`) : ''} ${o.badge ? raw(`data-badge="${esc(o.badge)}" data-badge-tone="${esc(o.badgeTone || 'neu')}"`) : ''} ${
      o.meta ? raw(`data-meta="${esc(o.meta)}"`) : ''
    } ${o.keywords ? raw(`data-keywords="${esc(o.keywords)}"`) : ''} ${o.dot ? raw(`data-dot="${esc(o.dot)}"`) : ''}>${o.label}</option>`;
  const build = (options, value) => {
    const groups = [];
    const loose = [];
    options.forEach((o) => {
      if (o.group) {
        let g = groups.find((x) => x.label === o.group);
        if (!g) groups.push((g = { label: o.group, items: [] }));
        g.items.push(o);
      } else loose.push(o);
    });
    return html`${loose.map((o) => optionHtml(o, value))}${groups.map((g) => html`<optgroup label="${g.label}">${g.items.map((o) => optionHtml(o, value))}</optgroup>`)}`;
  };
  let options = opts.options || [];
  render(
    container,
    html`${opts.label ? html`<label class="label" for="${id}">${opts.label}</label>` : ''}<select class="select" id="${id}" ${opts.name ? raw(`name="${esc(opts.name)}"`) : ''} multiple>${build(
      options,
      (opts.value || []).map(String)
    )}</select>`
  );
  const select = $('select', container);
  const values = () => Array.from(select.selectedOptions).map((o) => o.value);
  let prev = values();
  const inst = customSelect(select, {
    placeholder: opts.placeholder || 'Nenhuma selecionada',
    chipsMax: opts.chipsMax ?? 2,
    allLabel: opts.allLabel,
    renderChip: opts.renderChip,
    footer: opts.footer,
    search: opts.search ?? 'auto',
    onLockedActivate: opts.onLockedActivate ? (it) => opts.onLockedActivate(options.find((o) => String(o.value) === it.value) || it) : null,
  });
  select.addEventListener('change', () => {
    const now = values();
    const added = now.filter((v) => !prev.includes(v));
    const removed = prev.filter((v) => !now.includes(v));
    prev = now;
    if (added.length || removed.length) opts.onChange?.(now, { added, removed });
  });
  return {
    el: inst.el,
    select,
    get value() {
      return values();
    },
    setValue(v) {
      inst.setValue(v, { silent: true });
      prev = values();
    },
    setOptions(o) {
      options = o;
      const cur = values();
      render(select, build(options, cur));
      prev = values();
    },
    open: () => inst.open(),
    close: () => inst.close(),
    destroy: () => inst.destroy(),
  };
}

/* =====================================================================
   Período: dateRange(botão, { from, to, max, min, presets, onApply })
   Popover com atalhos + dois meses (uma folha com um mês no celular). Datas em 'AAAA-MM-DD' (dia local).
   ===================================================================== */
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DOW_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ymd = (d) => isoDay(d);
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const addMonths = (s, n) => {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
};
const brDay = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const brFull = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const fromBr = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? ymd(d) : null;
};
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000) + 1;
export const RANGE_PRESETS = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  thisMonth: 'Este mês',
  lastMonth: 'Mês passado',
  thisYear: 'Este ano',
};
export function presetRange(key, today = ymd(new Date())) {
  const t = parseYmd(today);
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: today };
    case 'lastMonth':
      return { from: ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: ymd(new Date(t.getFullYear(), t.getMonth(), 0)) };
    case 'thisYear':
      return { from: ymd(new Date(t.getFullYear(), 0, 1)), to: today };
    default:
      return null;
  }
}
// "27/10 – 02/11" (ou "02/11" num dia só)
export const rangeLabel = (from, to) => (from && to ? (from === to ? brFull(from) : `${brDay(from)} – ${brDay(to)}`) : 'Escolher período');

// posiciona um popover fixo junto de um elemento (vira para cima e desliza para caber)
function placePop(pop, anchor, { gap = 6, margin = 8 } = {}) {
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.visualViewport?.height || window.innerHeight;
  pop.style.maxHeight = `${vh - margin * 2}px`;
  const ph = pop.offsetHeight;
  const pw = pop.offsetWidth;
  const below = vh - r.bottom - gap - margin;
  const top = below >= ph || below >= r.top ? r.bottom + gap : Math.max(margin, r.top - gap - ph);
  let left = r.left;
  if (left + pw > vw - margin) left = r.right - pw;
  pop.style.left = `${Math.round(Math.max(margin, Math.min(left, vw - margin - pw)))}px`;
  pop.style.top = `${Math.round(Math.max(margin, Math.min(top, vh - margin - ph)))}px`;
  pop.dataset.side = top >= r.bottom ? 'bottom' : 'top';
}

export function dateRange(button, opts = {}) {
  const o = { presets: ['today', 'yesterday', '7d', '30d', 'thisMonth', 'lastMonth', 'thisYear'], max: ymd(new Date()), min: null, onApply: null, ...opts };
  let from = o.from || null;
  let to = o.to || null;
  let preset = o.preset || null;
  // estado em edição (só vale ao Aplicar)
  let dFrom;
  let dTo;
  let dPreset;
  let anchorMonth;
  let focusDay;
  let hover = null;
  let isOpen = false;
  let mode = 'pop';
  let root;
  let scrim;
  const id = nextId('cal');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  const paintButton = () => {
    const lbl = button.querySelector('[data-range-label]');
    if (lbl) lbl.textContent = rangeLabel(from, to);
    else render(button, html`${icon('calendar', 'icon-sm')}<span data-range-label>${rangeLabel(from, to)}</span>`);
    button.setAttribute('aria-label', from && to ? `Período: ${brFull(from)} a ${brFull(to)}. Trocar período` : 'Escolher período');
  };
  paintButton();
  const disabledDay = (s) => (o.max && s > o.max) || (o.min && s < o.min);
  const monthHtml = (first) => {
    const d0 = parseYmd(first);
    const y = d0.getFullYear();
    const m = d0.getMonth();
    const start = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = ymd(new Date());
    const lo = dFrom && (dTo || hover) ? (dTo || hover) < dFrom ? dTo || hover : dFrom : dFrom;
    const hi = dFrom && (dTo || hover) ? (dTo || hover) < dFrom ? dFrom : dTo || hover : dFrom;
    const cells = [];
    for (let i = 0; i < start; i++) cells.push(html`<span class="cal__d is-out" aria-hidden="true"></span>`);
    for (let day = 1; day <= days; day++) {
      const s = ymd(new Date(y, m, day));
      const dis = disabledDay(s);
      const isFrom = s === lo;
      const isTo = s === hi;
      const inBand = lo && hi && s > lo && s < hi;
      const cls = ['cal__d', isFrom ? 'is-from' : '', isTo ? 'is-to' : '', isFrom && isTo ? 'is-single' : '', inBand ? 'is-in' : '', s === today ? 'is-today' : '', dis ? 'is-future' : ''].filter(Boolean).join(' ');
      const dt = parseYmd(s);
      cells.push(
        html`<button type="button" class="${cls}" data-day="${s}" tabindex="${s === focusDay ? 0 : -1}" aria-pressed="${isFrom || isTo ? 'true' : 'false'}" aria-label="${DOW_LONG[dt.getDay()]}, ${day} de ${MONTHS[m]} de ${y}${
          s === today ? ', hoje' : ''
        }" ${dis ? 'disabled' : ''}>${day}</button>`
      );
    }
    return html`<div class="cal__month"><div class="cal__mt" aria-live="polite">${MONTHS[m][0].toUpperCase() + MONTHS[m].slice(1)} ${y}</div><div class="cal__dow" aria-hidden="true">${DOW.map((x) => html`<span>${x}</span>`)}</div><div class="cal__grid">${cells}</div></div>`;
  };
  const summary = () => {
    if (!dFrom) return 'Escolha o primeiro dia';
    if (!dTo) return `A partir de ${brDay(dFrom)} · escolha o último dia`;
    const n = daysBetween(dFrom, dTo);
    return `${n} ${n === 1 ? 'dia' : 'dias'} · ${brDay(dFrom)} a ${brDay(dTo)}`;
  };
  const paint = () => {
    if (!root) return;
    const months = mode === 'sheet' ? [anchorMonth] : [addMonths(anchorMonth, -1), anchorMonth];
    const presetsHtml =
      mode === 'sheet'
        ? html`<div class="cal__chips">${o.presets.map((k) => html`<button type="button" class="chip ${dPreset === k ? 'is-active' : ''}" data-preset="${k}" aria-pressed="${dPreset === k}">${RANGE_PRESETS[k]}</button>`)}</div>`
        : html`<div class="cal__presets" role="group" aria-label="Atalhos de período">${o.presets.map(
            (k) => html`<button type="button" class="opt ${dPreset === k ? 'is-selected' : ''}" data-preset="${k}" aria-pressed="${dPreset === k}"><span class="opt__body">${RANGE_PRESETS[k]}</span><span class="opt__check" aria-hidden="true">${icon('check', 'icon-sm')}</span></button>`
          )}</div>`;
    const prevDisabled = o.min && ymd(new Date(parseYmd(months[0]).getFullYear(), parseYmd(months[0]).getMonth(), 0)) < o.min;
    const nextDisabled = o.max && addMonths(months[months.length - 1], 1).slice(0, 7) > o.max.slice(0, 7);
    const body = html`${presetsHtml}<div class="cal__main">
        <div class="cal__nav"><button type="button" class="btn btn--ghost btn--icon btn--sm" data-cal-prev aria-label="Mês anterior" ${prevDisabled ? 'disabled' : ''}>${icon('chevronLeft', 'icon-sm')}</button><span class="grow"></span><button type="button" class="btn btn--ghost btn--icon btn--sm" data-cal-next aria-label="Próximo mês" ${
          nextDisabled ? 'disabled' : ''
        }>${icon('chevronRight', 'icon-sm')}</button></div>
        <div class="cal__months" role="group" aria-label="Calendário">${months.map(monthHtml)}</div>
        <div class="cal__inputs"><div class="field"><label for="${id}-from">De</label><input class="input" id="${id}-from" data-cal-from inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" value="${brFull(dFrom)}" autocomplete="off"></div>
          <span class="cal__arrow" aria-hidden="true">${icon('arrowRight', 'icon-sm')}</span>
          <div class="field"><label for="${id}-to">Até</label><input class="input" id="${id}-to" data-cal-to inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" value="${brFull(dTo)}" autocomplete="off"></div></div>
      </div>`;
    const keepFocus = document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.day || document.activeElement.id : null;
    render(
      root,
      mode === 'sheet'
        ? html`<div class="sheet__top"><span class="sheet__grab" aria-hidden="true"></span><div class="sheet__head"><h2 id="${id}-t">Período</h2><button class="btn btn--ghost btn--icon" type="button" data-cal-cancel aria-label="Fechar">${icon('close')}</button></div></div>
            <div class="cal cal--sheet">${body}</div>
            <div class="pop__foot"><span class="cal__sum">${summary()}</span><div class="pop__foot-acts"><button type="button" class="btn btn--primary" data-cal-apply ${dFrom && dTo ? '' : 'disabled'}>Aplicar</button></div></div>`
        : html`<div class="cal">${body}</div><div class="pop__foot"><span class="cal__sum">${summary()}</span><div class="pop__foot-acts"><button type="button" class="btn btn--ghost btn--sm" data-cal-cancel>Cancelar</button><button type="button" class="btn btn--dark btn--sm" data-cal-apply ${dFrom && dTo ? '' : 'disabled'}>Aplicar</button></div></div>`
    );
    if (keepFocus) {
      const el = root.querySelector(`[data-day="${keepFocus}"]`) || document.getElementById(keepFocus);
      el?.focus({ preventScroll: true });
    }
  };
  const pickDay = (s) => {
    if (disabledDay(s)) return;
    dPreset = null;
    if (!dFrom || dTo) {
      dFrom = s;
      dTo = null;
    } else if (s < dFrom) {
      dTo = dFrom;
      dFrom = s;
    } else dTo = s;
    focusDay = s;
    hover = null;
    paint();
  };
  const moveFocus = (s) => {
    if (o.max && s > o.max) s = o.max;
    if (o.min && s < o.min) s = o.min;
    focusDay = s;
    const shown = mode === 'sheet' ? [anchorMonth.slice(0, 7)] : [addMonths(anchorMonth, -1).slice(0, 7), anchorMonth.slice(0, 7)];
    if (!shown.includes(s.slice(0, 7))) anchorMonth = s < shown[0] ? (mode === 'sheet' ? s : addMonths(s, 1)) : s;
    paint();
    root.querySelector(`[data-day="${s}"]`)?.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    const day = e.target.closest?.('[data-day]');
    if (day) {
      const s = day.dataset.day;
      const dt = parseYmd(s);
      const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (map[e.key] !== undefined) {
        e.preventDefault();
        moveFocus(addDays(s, map[e.key]));
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        moveFocus(addMonths(s, e.key === 'PageUp' ? -1 : 1));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        moveFocus(addDays(s, e.key === 'Home' ? -dt.getDay() : 6 - dt.getDay()));
      }
      return;
    }
    if (e.key === 'Enter' && e.target.matches('[data-cal-from], [data-cal-to]')) {
      e.preventDefault();
      e.target.blur();
      if (dFrom && dTo) apply();
    }
    if (e.key === 'Tab' && mode === 'sheet') {
      const f = focusable(root);
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    }
  };
  const onInput = (e) => {
    const inp = e.target.closest('[data-cal-from], [data-cal-to]');
    if (!inp) return;
    const digits = inp.value.replace(/\D/g, '').slice(0, 8);
    const masked = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    if (masked !== inp.value) inp.value = masked;
  };
  const onChange = (e) => {
    const inp = e.target.closest('[data-cal-from], [data-cal-to]');
    if (!inp) return;
    const v = fromBr(inp.value);
    if (!v || disabledDay(v)) {
      inp.setAttribute('aria-invalid', 'true');
      return;
    }
    inp.removeAttribute('aria-invalid');
    dPreset = null;
    if (inp.matches('[data-cal-from]')) dFrom = v;
    else dTo = v;
    if (dFrom && dTo && dTo < dFrom) [dFrom, dTo] = [dTo, dFrom];
    anchorMonth = dTo || dFrom;
    focusDay = v;
    paint();
  };
  const onClick = (e) => {
    const d = e.target.closest('[data-day]');
    if (d) return pickDay(d.dataset.day);
    const pr = e.target.closest('[data-preset]');
    if (pr) {
      const r = presetRange(pr.dataset.preset, o.max || ymd(new Date()));
      dFrom = r.from;
      dTo = r.to;
      dPreset = pr.dataset.preset;
      anchorMonth = dTo;
      focusDay = dTo;
      paint();
      return;
    }
    if (e.target.closest('[data-cal-prev]')) {
      anchorMonth = addMonths(anchorMonth, -1);
      paint();
    } else if (e.target.closest('[data-cal-next]')) {
      anchorMonth = addMonths(anchorMonth, 1);
      paint();
    } else if (e.target.closest('[data-cal-apply]')) apply();
    else if (e.target.closest('[data-cal-cancel]')) close();
  };
  const onOver = (e) => {
    const d = e.target.closest?.('[data-day]');
    const next = d && dFrom && !dTo ? d.dataset.day : null;
    if (next !== hover) {
      hover = next;
      if (dFrom && !dTo) paint();
    }
  };
  const outside = (e) => {
    if (root?.contains(e.target) || button.contains(e.target)) return;
    if (scrim && e.target === scrim) return;
    close();
  };
  const reflow = () => {
    if (isOpen && mode === 'pop') placePop(root, button);
  };
  function open() {
    if (isOpen) return;
    isOpen = true;
    dFrom = from;
    dTo = to;
    dPreset = preset;
    anchorMonth = to || o.max || ymd(new Date());
    focusDay = to || from || o.max || ymd(new Date());
    let sheet = false;
    try {
      sheet = matchMedia(SHEET_MQ).matches;
    } catch {
      sheet = false;
    }
    mode = sheet ? 'sheet' : 'pop';
    root = document.createElement('div');
    root.id = id;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', mode === 'sheet' ? 'true' : 'false');
    if (mode === 'sheet') {
      root.className = 'sheet sheet--cal';
      root.setAttribute('aria-labelledby', `${id}-t`);
      scrim = document.createElement('div');
      scrim.className = 'sheet-scrim';
      scrim.addEventListener('click', () => close());
      document.body.append(scrim);
      lockScroll();
    } else {
      root.className = 'pop pop--cal';
      root.setAttribute('aria-label', 'Escolher período');
    }
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('mouseover', onOver);
    document.body.append(root);
    paint();
    if (mode === 'pop') placePop(root, button);
    pushLayer(root, { onEscape: () => close() });
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    (root.querySelector(`[data-day="${focusDay}"]`) || root.querySelector('[data-day]:not([disabled])'))?.focus({ preventScroll: true });
  }
  function close({ focus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    popLayer(root);
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', reflow);
    window.removeEventListener('scroll', reflow, true);
    button.setAttribute('aria-expanded', 'false');
    const el = root;
    const sc = scrim;
    if (mode === 'sheet') {
      unlockScroll();
      el.classList.add('is-leaving');
      sc?.classList.add('is-leaving');
      setTimeout(() => {
        el.remove();
        sc?.remove();
      }, reducedMotion() ? 0 : 200);
    } else el.remove();
    root = null;
    scrim = null;
    if (focus) button.focus({ preventScroll: true });
  }
  function apply() {
    if (!dFrom || !dTo) return;
    from = dFrom;
    to = dTo;
    preset = dPreset;
    paintButton();
    close();
    o.onApply?.({ from, to, preset });
  }
  const toggle = () => (isOpen ? close() : open());
  button.addEventListener('click', toggle);
  return {
    open,
    close,
    set(f, t, p = null) {
      from = f;
      to = t;
      preset = p;
      paintButton();
    },
    get value() {
      return { from, to, preset };
    },
    destroy() {
      close({ focus: false });
      button.removeEventListener('click', toggle);
    },
  };
}

/* =====================================================================
   Barra de salvar: saveBar({ form, sections, onSave, onDiscard, label, ctx, apply })
   Aparece quando o formulário muda; Ctrl/⌘ S salva; avisa antes de sair com alterações.
   ===================================================================== */
function formSnapshot(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'button' || el.type === 'submit' || el.dataset.saveIgnore !== undefined) continue;
    let v;
    if (el.type === 'checkbox' || el.type === 'radio') v = el.checked;
    else if (el.type === 'select-multiple') v = Array.from(el.selectedOptions).map((x) => x.value).join('\u0001');
    else v = el.value;
    out[`${el.name}#${el.type === 'radio' || el.type === 'checkbox' ? el.value : ''}`] = v;
  }
  return out;
}
export function saveBar({ form, sections, onSave, onDiscard, label = 'Salvar', title = 'Alterações não salvas', ctx, apply, container } = {}) {
  let saved = formSnapshot(form);
  let forced = null;
  let visible = false;
  const el = document.createElement('div');
  el.className = 'savebar';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', title);
  el.hidden = true;
  const changedKeys = () => {
    const now = formSnapshot(form);
    return Object.keys({ ...now, ...saved }).filter((k) => now[k] !== saved[k]);
  };
  const dirty = () => !!(forced?.length || changedKeys().length);
  const text = () => {
    const list = forced || (typeof sections === 'function' ? sections(changedKeys()) : null) || [];
    if (!list.length) {
      const n = changedKeys().length;
      return n ? `${n} ${n === 1 ? 'campo alterado' : 'campos alterados'}` : '';
    }
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}` : list[0];
  };
  const paint = () => {
    render(
      el,
      html`<span class="savebar__dot" aria-hidden="true"></span><div class="savebar__txt"><strong>${title}</strong><span>${text()}</span></div>${
        apply
          ? html`<span class="savebar__sep" aria-hidden="true"></span><label class="savebar__apply"><input type="checkbox" data-save-ignore data-apply ${apply.checked ? 'checked' : ''}> Aplicar nas outras ${apply.count} ${apply.count === 1 ? 'loja' : 'lojas'}</label>`
          : ''
      }<div class="savebar__acts"><button type="button" class="btn btn--ghost" data-discard>Descartar</button><button type="button" class="btn btn--primary" data-save>${icon('check')} ${label} <span class="kbd kbd--on-primary" aria-hidden="true">Ctrl S</span></button></div>`
    );
  };
  // a estrutura é desenhada uma vez; depois só o texto muda (redesenhar trocaria o botão sob o clique)
  const update = () => {
    const d = dirty();
    if (d) {
      const span = el.querySelector('.savebar__txt span');
      if (span) span.textContent = text();
      if (!visible) {
        el.hidden = false;
        visible = true;
        document.documentElement.style.setProperty('--bar-h', `${el.offsetHeight + 12}px`);
      }
    } else if (visible) {
      el.hidden = true;
      visible = false;
      document.documentElement.style.removeProperty('--bar-h');
    }
  };
  const save = async () => {
    if (!dirty()) return;
    const btn = el.querySelector('[data-save]');
    await withBusy(btn, async () => {
      const r = await onSave?.();
      if (r !== false) api.markSaved();
    });
  };
  const discard = () => {
    if (onDiscard) onDiscard();
    else {
      for (const f of form.elements) {
        if (!f.name || f.dataset.saveIgnore !== undefined) continue;
        const k = `${f.name}#${f.type === 'radio' || f.type === 'checkbox' ? f.value : ''}`;
        if (!(k in saved)) continue;
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = saved[k];
        else if (f.type === 'select-multiple') {
          const vals = saved[k].split('\u0001');
          Array.from(f.options).forEach((x) => (x.selected = vals.includes(x.value)));
        } else f.value = saved[k];
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    forced = null;
    update();
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-save]')) save();
    if (e.target.closest('[data-discard]')) discard();
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-apply]')) apply?.onChange?.(e.target.checked);
  });
  const onForm = () => update();
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && form.isConnected) {
      e.preventDefault();
      save();
    }
  };
  const onUnload = (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  form.addEventListener('input', onForm);
  form.addEventListener('change', onForm);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);
  paint();
  (container || form).append(el);
  ctx?.onBeforeLeave?.(async () => (dirty() ? confirmDialog({ title: 'Sair sem salvar?', message: 'As alterações serão perdidas.', confirmLabel: 'Sair sem salvar', danger: true }) : true));
  const api = {
    el,
    show: () => {
      el.hidden = false;
      visible = true;
      const span = el.querySelector('.savebar__txt span');
      if (span) span.textContent = text();
    },
    hide: () => {
      el.hidden = true;
      visible = false;
    },
    markSaved() {
      saved = formSnapshot(form);
      forced = null;
      update();
    },
    setDirty(list) {
      forced = list && list.length ? list : null;
      update();
    },
    get dirty() {
      return dirty();
    },
    destroy() {
      form.removeEventListener('input', onForm);
      form.removeEventListener('change', onForm);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      document.documentElement.style.removeProperty('--bar-h');
      el.remove();
    },
  };
  ctx?.onCleanup?.(() => api.destroy());
  return api;
}

/* ---------- Dica flutuante [data-tooltip] (marinho; creme no escuro) ---------- */
let tipEl = null;
let tipTimer = null;
let tipFor = null;
function showTooltip(el) {
  const text = el.getAttribute('data-tooltip');
  if (!text) return;
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.id = 'ui-tooltip';
  }
  tipEl.textContent = text;
  document.body.append(tipEl);
  tipFor = el;
  const prevDesc = el.getAttribute('aria-describedby') || '';
  if (!prevDesc.split(' ').includes('ui-tooltip') && !el.hasAttribute('aria-label')) el.setAttribute('aria-describedby', `${prevDesc} ui-tooltip`.trim());
  const side = el.dataset.tooltipSide || 'top';
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const vw = document.documentElement.clientWidth;
  let left;
  let top;
  if (side === 'right') {
    left = r.right + 10;
    top = r.top + r.height / 2 - th / 2;
  } else if (side === 'bottom') {
    left = r.left + r.width / 2 - tw / 2;
    top = r.bottom + 8;
  } else {
    left = r.left + r.width / 2 - tw / 2;
    top = r.top - th - 8;
    if (top < 6) top = r.bottom + 8;
  }
  tipEl.dataset.side = side;
  tipEl.style.left = `${Math.max(6, Math.min(left, vw - tw - 6))}px`;
  tipEl.style.top = `${Math.max(6, top)}px`;
}
function hideTooltip() {
  clearTimeout(tipTimer);
  tipTimer = null;
  if (tipFor) {
    const d = (tipFor.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== 'ui-tooltip').join(' ');
    if (d) tipFor.setAttribute('aria-describedby', d);
    else tipFor.removeAttribute('aria-describedby');
  }
  tipFor = null;
  tipEl?.remove();
}
const tooltipEnter = (e) => {
  const el = e.target.closest?.('[data-tooltip]');
  if (!el || el === tipFor) return;
  hideTooltip();
  tipTimer = setTimeout(() => showTooltip(el), 300);
};
const tooltipLeave = (e) => {
  const el = e.target.closest?.('[data-tooltip]');
  if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hideTooltip();
};
document.addEventListener('mouseover', tooltipEnter);
document.addEventListener('mouseout', tooltipLeave);
document.addEventListener('focusin', tooltipEnter);
document.addEventListener('focusout', tooltipLeave);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tipFor) hideTooltip();
});

/* ---------- Delegação global (menus, gráficos, segmentados, dicas, ordenação) ---------- */
// Botão com data-menu="id" abre o elemento #id (.menu) e fecha ao clicar fora.
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-menu]');
  $$('.menu[data-open]').forEach((m) => {
    if (!opener || m.id !== opener.dataset.menu) {
      m.hidden = true;
      m.removeAttribute('data-open');
      document.querySelector(`[data-menu="${CSS.escape(m.id)}"]`)?.setAttribute('aria-expanded', 'false');
    }
  });
  if (opener) {
    const m = document.getElementById(opener.dataset.menu);
    if (m) {
      m.hidden = !m.hidden;
      opener.setAttribute('aria-haspopup', 'menu');
      opener.setAttribute('aria-expanded', String(!m.hidden));
      if (!m.hidden) m.setAttribute('data-open', '');
    }
  }
  // dica do Tetim
  const dismiss = e.target.closest('[data-tip-dismiss]');
  if (dismiss) {
    const box = dismiss.closest('[data-tip-id]');
    if (box) {
      lsSet(TIP_KEY + box.dataset.tipId, String(Date.now()));
      box.remove();
      scheduleArbitrate();
    }
  }
  // callbacks registrados (Tentar de novo, ações)
  const cb = e.target.closest('[data-cb]');
  if (cb && CALLBACKS.has(cb.dataset.cb)) CALLBACKS.get(cb.dataset.cb)(e);
  // segmentado
  const sb = e.target.closest('.seg__b');
  if (sb && sb.closest('[data-seg]')) setSeg(sb.closest('[data-seg]'), sb, false);
});
document.addEventListener('keydown', (e) => {
  // menus: Esc fecha e devolve o foco; setas navegam
  const openMenu = $$('.menu[data-open]').pop();
  if (openMenu && !openMenu.hidden) {
    const items = $$('a[href], button:not([disabled])', openMenu);
    const opener = document.querySelector(`[data-menu="${CSS.escape(openMenu.id)}"]`);
    if (e.key === 'Escape') {
      openMenu.hidden = true;
      openMenu.removeAttribute('data-open');
      opener?.setAttribute('aria-expanded', 'false');
      opener?.focus();
      e.stopPropagation();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n].focus();
      return;
    }
  }
  // segmentado: setas
  const sb = e.target.closest?.('.seg__b');
  if (sb && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
    const seg = sb.closest('[data-seg]');
    if (seg) {
      e.preventDefault();
      const bs = $$('.seg__b:not([disabled])', seg);
      const i = bs.indexOf(sb);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(bs.length - 1, i + 1);
      setSeg(seg, bs[n]);
    }
  }
  // cabeçalho ordenável com teclado
  const th = e.target.closest?.('th[data-sort][tabindex]');
  if (th && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    th.click();
  }
  // gráfico: setas movem o dia ativo
  const plot = e.target.closest?.('.chartx__plot');
  if (plot && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const wrap = plot.closest('.chartx');
    let n = 0;
    try {
      n = JSON.parse(wrap.dataset.chart || '[]').length;
    } catch {
      n = 0;
    }
    if (!n) return;
    const cur = wrap.dataset.active === undefined ? -1 : Number(wrap.dataset.active);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : Math.min(n - 1, cur + 1);
    chartSet(wrap, next, true);
  }
});
document.addEventListener('pointermove', (e) => {
  const plot = e.target.closest?.('.chartx__plot');
  if (!plot) return;
  const wrap = plot.closest('.chartx');
  const i = chartNearest(wrap, e.clientX);
  if (String(i) !== wrap.dataset.active) chartSet(wrap, i);
});
document.addEventListener('pointerout', (e) => {
  const plot = e.target.closest?.('.chartx__plot');
  if (plot && !plot.contains(e.relatedTarget) && document.activeElement !== plot) chartSet(plot.closest('.chartx'), null);
});
document.addEventListener('focusin', (e) => {
  const plot = e.target.closest?.('.chartx__plot');
  if (plot) {
    const wrap = plot.closest('.chartx');
    if (wrap.dataset.active === undefined) {
      let n = 0;
      try {
        n = JSON.parse(wrap.dataset.chart || '[]').length;
      } catch {
        n = 0;
      }
      if (n) chartSet(wrap, n - 1, true);
    }
  }
});
document.addEventListener('focusout', (e) => {
  const plot = e.target.closest?.('.chartx__plot');
  if (plot && !plot.contains(e.relatedTarget)) chartSet(plot.closest('.chartx'), null);
});

/* ---------- initUI: liga tudo em #root e nas janelas ---------- */
let uiStarted = false;
let uiObserver = null;
export function initUI({ root = document.body } = {}) {
  applyTheme();
  enhanceAll(document);
  hydrateArt(document);
  arbitrateTetim(document);
  if (uiStarted) return { observer: uiObserver };
  uiStarted = true;
  uiObserver = new MutationObserver((muts) => {
    let tetimDirty = false;
    for (const m of muts) {
      m.removedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const sels = n.tagName === 'SELECT' ? [n] : n.querySelectorAll ? $$('select', n) : [];
        sels.forEach((s) => {
          const inst = SELECTS.get(s);
          if (inst && !s.isConnected) inst.destroy();
        });
        if (n.matches?.('[data-tetim-prio]') || n.querySelector?.('[data-tetim-prio]')) tetimDirty = true;
      });
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const sels = n.tagName === 'SELECT' ? [n] : $$('select', n);
        sels.forEach((s) => {
          const inst = SELECTS.get(s);
          if (inst) {
            if (inst.trigger.previousElementSibling !== s) s.after(inst.trigger);
          } else if (shouldEnhance(s)) customSelect(s);
        });
        if (n.matches?.('[data-art-src]') || n.querySelector?.('[data-art-src]')) hydrateArt(n);
        if (n.matches?.('[data-tetim-prio]') || n.querySelector?.('[data-tetim-prio]')) tetimDirty = true;
      });
    }
    if (tetimDirty) scheduleArbitrate();
  });
  uiObserver.observe(root, { childList: true, subtree: true });
  return { observer: uiObserver };
}
function enhanceAll(scope) {
  $$('select', scope).forEach((s) => {
    if (!SELECTS.get(s) && shouldEnhance(s)) customSelect(s);
  });
}
