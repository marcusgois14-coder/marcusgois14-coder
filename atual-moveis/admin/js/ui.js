// Componentes e utilitários de interface do painel.
// Padrão: monte HTML com o template `html` (escapa tudo automaticamente)
// e trate eventos com delegação (el.addEventListener('click', e => e.target.closest(...))).
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
  s.textContent = css;
  document.head.appendChild(s);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- Ícones (traço, 24x24) ---------- */
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 11h8V3h-8z"/>',
  orders: '<path d="M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/><path d="M4 6h16M9 11h6M9 15h6"/>',
  products: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  showcase: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  categories: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  coupons: '<path d="M3 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M9 9h.01M15 15h.01M15 9l-6 6"/>',
  customers: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.6"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  store: '<path d="M3 9 5 4h14l2 5M3 9h18v11H3zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-5h6v5"/>',
  stores: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  team: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  network: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  audit: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  whatsapp: '<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-1.8-1.3-2.3-2.3l1-1-1-2z"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 5v4h4M4 13a8 8 0 0 0 14.9 4M20 19v-4h-4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M12 3 2 20h20zM12 9v5M12 17h.01"/>',
};

export function icon(name, cls = 'icon') {
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
  );
}

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

/* ---------- Rótulos ---------- */
export const ORDER_STATUS = {
  pending: { label: 'Aguardando confirmação', short: 'Novo', tone: 'warning' },
  confirmed: { label: 'Confirmado', short: 'Confirmado', tone: 'info' },
  preparing: { label: 'Em separação', short: 'Separação', tone: 'info' },
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

export const badge = (label, tone = '') => html`<span class="badge ${tone ? `badge--${tone}` : ''}">${label}</span>`;
export const statusBadge = (s) => badge(ORDER_STATUS[s]?.label || s, ORDER_STATUS[s]?.tone);
export const paymentBadge = (s) => badge(PAYMENT_STATUS[s]?.label || s, PAYMENT_STATUS[s]?.tone);
export const productStatusBadge = (s) => badge(PRODUCT_STATUS[s]?.label || s, PRODUCT_STATUS[s]?.tone);

/* ---------- Avisos rápidos ---------- */
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

export function toast(message, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastHost().appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const toastError = (e) => toast(e instanceof Error ? e.message : String(e), 'error', 6000);

/* ---------- Modais ---------- */
let openCount = 0;
const focusable = (root) =>
  $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter(
    (n) => n.offsetParent !== null
  );

// openModal({ title, body, actions, size: 'sm'|'lg'|'xl', variant: 'modal'|'panel', onMount(el, close), onClose })
// actions: html`` com botões; botões com data-close fecham. Retorna { el, close }.
export function openModal({ title, body, actions, size = '', variant = 'modal', onMount, onClose, dismissable = true } = {}) {
  const last = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const box = document.createElement('div');
  box.className = variant === 'panel' ? `panel ${size === 'wide' ? 'panel--wide' : ''}` : `modal ${size ? `modal--${size}` : ''}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', typeof title === 'string' ? title : 'Diálogo');
  render(
    box,
    html`<div class="modal__head">
        <h2 class="modal__title">${title}</h2>
        <button class="btn btn--ghost btn--icon" type="button" data-close aria-label="Fechar">${icon('close')}</button>
      </div>
      <div class="modal__body">${body}</div>
      ${actions ? html`<div class="modal__foot">${actions}</div>` : ''}`
  );
  document.body.append(overlay, box);
  openCount += 1;
  document.body.classList.add('is-locked');

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    overlay.remove();
    box.remove();
    openCount -= 1;
    if (!openCount) document.body.classList.remove('is-locked');
    document.removeEventListener('keydown', onKey, true);
    last?.focus?.({ preventScroll: true });
    onClose?.(result);
  };
  const onKey = (e) => {
    if (!box.isConnected) return;
    const topmost = $$('.modal, .panel').pop() === box;
    if (!topmost) return;
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') {
      const f = focusable(box);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (dismissable) overlay.addEventListener('click', () => close());
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  onMount?.(box, close);
  setTimeout(() => {
    const first = $('[autofocus]', box) || focusable($('.modal__body', box))[0] || focusable(box)[0];
    first?.focus();
  }, 30);
  return { el: box, close };
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title,
      size: 'sm',
      body: html`<p>${message}</p>`,
      actions: html`<button class="btn" type="button" data-close>Cancelar</button>
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
    msg.textContent = message;
    input.closest('.field')?.appendChild(msg);
    first = first || input;
  }
  first?.focus();
  return !first;
}

// Botão em estado "salvando" enquanto a promessa roda
export async function withBusy(btn, task) {
  if (!btn) return task();
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Salvando…';
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = label;
  }
}

export const field = ({ label, name, value = '', type = 'text', hint = '', required = false, cls = 'col-6', attrs = '', placeholder = '' }) =>
  html`<div class="field ${cls}">
    <label for="f-${name}">${label}${required ? ' *' : ''}</label>
    <input class="input" id="f-${name}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${required ? 'required' : ''} ${raw(attrs)}>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;

export const switchField = ({ label, name, checked = false, hint = '' }) =>
  html`<label class="switch">
    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
    <span class="switch__track"></span>
    <span><strong>${label}</strong>${hint ? html`<br><span class="muted small">${hint}</span>` : ''}</span>
  </label>`;

export const selectOptions = (options, selected) =>
  options.map(([value, label]) => html`<option value="${value}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${label}</option>`);

/* ---------- Estados ---------- */
export const loading = (text = 'Carregando…') => html`<div class="loading-block"><span class="spinner"></span>${text}</div>`;
export const empty = (title, text = '', action = '') =>
  html`<div class="empty">${icon('box')}<strong>${title}</strong>${text ? html`<span>${text}</span>` : ''}${action}</div>`;
export const errorBlock = (e) => html`<div class="alert alert--danger">${icon('alert')}<div>${e instanceof Error ? e.message : String(e)}</div></div>`;

/* ---------- Tabela e paginação ---------- */
// columns: [{ key, label, render?(row) → html|string, cls?, sort? }]
export function table({ columns, rows, rowAttrs = () => '', empty: emptyText = 'Nada por aqui ainda.', sort } = {}) {
  if (!rows.length) return html`<div class="table-wrap">${empty(emptyText)}</div>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>${columns.map(
      (c) =>
        html`<th class="${c.cls || ''}" ${c.sort ? raw(`data-sort="${esc(c.sort)}"`) : ''}>${c.label}${
          sort && c.sort && sort.key === c.sort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
        }</th>`
    )}</tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr ${raw(rowAttrs(r) || '')}>${columns.map((c) => html`<td class="${c.cls || ''}">${c.render ? c.render(r) : r[c.key] ?? '—'}</td>`)}</tr>`
    )}</tbody>
  </table></div>`;
}

export function pager({ page, pageSize, total }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return html`<div class="pager">
    <span>${num(from)}–${num(to)} de ${num(total)}</span>
    <div class="row" style="--gap:6px">
      <button class="btn btn--sm" type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 'icon-sm')} Anterior</button>
      <span>Página ${page} de ${pages}</span>
      <button class="btn btn--sm" type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Próxima ${icon('chevronRight', 'icon-sm')}</button>
    </div>
  </div>`;
}

/* ---------- Gráfico de barras (SVG) ---------- */
// data: [{ label, value, title? }]
export function barChart(data, { height = 220, format = money } = {}) {
  const w = 760;
  const pad = { l: 56, r: 10, t: 10, b: 26 };
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const step = (w - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(36, step * 0.7));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const every = Math.ceil(data.length / 12);
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${height}" role="img" aria-label="Gráfico">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${esc(format(t)).replace(/,00$/, '')}</text>`).join('')}
    ${data
      .map((d, i) => {
        const x = pad.l + i * step + (step - bw) / 2;
        const v = Number(d.value) || 0;
        const label = i % every === 0 ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>` : '';
        return `<rect class="bar" x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0, height - pad.b - y(v))}" rx="3"><title>${esc(d.title || `${d.label}: ${format(v)}`)}</title></rect>${label}`;
      })
      .join('')}
  </svg>`);
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
      html`<div class="uploader">
        ${urls.map(
          (u, i) => html`<div class="uploader__item" draggable="true" data-i="${i}">
            <img src="${mediaUrl(u)}" alt="">
            ${i === 0 && max > 1 ? html`<span class="uploader__tag">Capa</span>` : ''}
            <button class="uploader__remove" type="button" data-remove="${i}" aria-label="Remover foto">${icon('trash', 'icon-sm')}</button>
          </div>`
        )}
        ${urls.length < max ? html`<button class="uploader__add" type="button" data-add>${icon('upload')}<span>${label}</span><span class="faint">ou arraste aqui</span></button>` : ''}
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
  return { get value() { return [...urls]; }, set(v) { urls = [...v]; draw(); } };
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

/* ---------- Menus suspensos ---------- */
// Botão com data-menu="id" abre o elemento #id (.menu) e fecha ao clicar fora.
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-menu]');
  $$('.menu[data-open]').forEach((m) => {
    if (!opener || m.id !== opener.dataset.menu) {
      m.hidden = true;
      m.removeAttribute('data-open');
    }
  });
  if (opener) {
    const m = document.getElementById(opener.dataset.menu);
    if (m) {
      m.hidden = !m.hidden;
      if (!m.hidden) m.setAttribute('data-open', '');
    }
  }
});
