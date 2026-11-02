// Núcleo do painel: login, contexto (usuário, lojas, permissões), menu, topo, rotas, busca (Ctrl K)
// e avisos em tempo real. Desenho "Casa Atual" (spec final do painel).
//
// CONTRATO DOS MÓDULOS (admin/js/modules/<id>.js):
//   export default {
//     title: 'Pedidos',
//     async render(view, ctx) { ... }   // desenha dentro de `view`; pode devolver uma função de limpeza
//   }
// ctx:
//   ctx.user {id,email,full_name} · ctx.isGlobal · ctx.isSuper · ctx.stores [{id,name,slug,city,...}]
//   ctx.storeId (uuid ou null = toda a rede) · ctx.store (objeto ou null) · ctx.storeName(id)
//   ctx.can(perm, storeId = ctx.storeId)  perm: view|catalog|orders|customers|coupons|settings|staff
//   ctx.roleIn(storeId) · ctx.args (segmentos após o módulo) · ctx.query (parâmetros ?a=b da rota)
//   ctx.setTitle(titulo, subtitulo?) · ctx.setActions(html``) · ctx.navigate('#/orders/123')
//   ctx.setStore(storeId|null, '#/rota'?) · ctx.reloadStores()
//   ctx.pickStore(view, mensagem) → desenha seletor de loja quando o módulo exige uma loja
//   ctx.onCleanup(fn) · ctx.refreshBadges() · ctx.on('new-order', fn) · ctx.on('order-updated', fn)
//
// ADIÇÕES (todas opcionais; o que já existia continua igual):
//   ctx.setTitle(titulo, sub, { visible, crumbs, back })
//       visible: false esconde o cabeçalho da página (o módulo desenha o seu, ex.: pageHeader() do ui.js)
//       crumbs: [['Produtos', '#/products'], ['Sofás']] → trilha acima do título
//       back: '#/orders' → link "voltar" acima do título; no celular vira a barra [←] título
//   ctx.setActions(html``) → botões à direita do cabeçalho da página (o mesmo [data-actions] de antes)
//   ctx.onBeforeLeave(async () => boolean) → antes de trocar de rota/loja; false cancela (ex.: saveBar do ui.js)
//   ctx.liveState → 'on' | 'retry' | 'off' | null (tempo real; só leitura)
//   ctx.storeShort(loja) → nome curto ("Ponte Nova", "Tavares - Ponte Nova", "Viçosa")
//   ctx.openPalette({ query }) → abre a busca (Ctrl K)
//   ctx.announce(texto) → leitor de tela (região "polite")
//   ctx.pendingByStore → Map(store_id → pedidos aguardando), atualizado em refreshBadges()
// Comportamento do shell que os módulos podem assumir:
//   · a cada rota o cabeçalho volta a aparecer com o título/descrição do NAV e as ações ficam vazias;
//   · trocar de rota ou de loja fecha janelas/gavetas abertas (closeModals), o seletor, a busca e os menus;
//   · uma rota de módulo existente mas não liberada vai para #/sem-acesso?area=<id>; rota desconhecida mostra 404;
//   · o <select id="store-switch" data-store-switch> continua no DOM (fonte da verdade do seletor de loja);
//     escrever nele e disparar "change" troca a loja (ex.: products.js intercepta para pedir confirmação).
// Atalhos: Ctrl/⌘ K busca · L troca de loja · G + letra vai para a área · N novo produto · [ recolhe o menu.
import { sb, rpc, friendlyError, mediaUrl, storefrontUrl } from './api.js';
import {
  html,
  raw,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  money,
  esc,
  phone,
  relTime,
  fold,
  debounce,
  withBusy,
  initUI,
  customSelect,
  registerStores,
  storeMark,
  avatar,
  livePill,
  skeleton,
  empty,
  errorBlock,
  art,
  closeModals,
  openModal,
  pushLayer,
  popLayer,
  topLayer,
  focusable,
  getTheme,
  setTheme,
  resolvedTheme,
  THEMES,
  refreshAges,
  ageChip,
  statusBadge,
  productStatusBadge,
  segmented,
  highlight,
  PAYMENT_METHOD,
  ROLES,
} from './ui.js';

const PERMS = {
  view: ['store_admin', 'store_manager', 'store_editor', 'store_operator'],
  catalog: ['store_admin', 'store_manager', 'store_editor'],
  orders: ['store_admin', 'store_manager', 'store_operator'],
  customers: ['store_admin', 'store_manager', 'store_operator'],
  coupons: ['store_admin', 'store_manager'],
  settings: ['store_admin'],
  staff: ['store_admin'],
};

// key = letra do atalho "G + letra" · short = rótulo curto (celular) · desc = subtítulo padrão da página
const NAV = [
  { group: 'Operação' },
  { id: 'dashboard', label: 'Painel', icon: 'dashboard', perm: 'view', key: 'd', desc: 'Vendas, pedidos e lojas num relance' },
  { id: 'orders', label: 'Pedidos', icon: 'orders', perm: 'orders', badge: true, key: 'p', desc: 'Confirme, separe e entregue os pedidos' },
  { id: 'customers', label: 'Clientes', icon: 'customers', perm: 'customers', key: 'c', desc: 'Quem comprou, com histórico e contato' },
  { id: 'reports', label: 'Relatórios', icon: 'reports', perm: 'orders', key: 'r', desc: 'Vendas por período, loja e produto' },
  { group: 'Catálogo' },
  { id: 'products', label: 'Produtos', icon: 'products', perm: 'catalog', key: 'o', desc: 'Catálogo, preços e estoque de cada loja' },
  { id: 'showcase', label: 'Vitrine e banners', short: 'Vitrine', icon: 'showcase', perm: 'catalog', key: 'v', desc: 'Prateleiras e banners da página inicial da loja virtual' },
  { id: 'coupons', label: 'Cupons', icon: 'coupons', perm: 'coupons', key: 'u', desc: 'Descontos para fechar a venda' },
  { id: 'categories', label: 'Categorias', icon: 'categories', network: true, key: 't', desc: 'Categorias valem para a rede toda' },
  { group: 'Loja' },
  { id: 'store', label: 'Dados da loja', icon: 'store', perm: 'settings', needsStore: true, key: 's', desc: 'Dados, entrega e pagamento da loja' },
  { id: 'team', label: 'Equipe', icon: 'team', perm: 'staff', key: 'e', desc: 'Quem acessa o painel e o que cada um pode fazer' },
  { group: 'Rede', network: true },
  { id: 'stores', label: 'Lojas', icon: 'stores', network: true, key: 'l', desc: 'As lojas da rede, raio de entrega e status' },
  { id: 'network', label: 'Configurações da rede', short: 'Rede', icon: 'network', network: true, key: 'n', desc: 'Marca, cores e regras que valem para todas as lojas' },
  { id: 'audit', label: 'Auditoria', icon: 'audit', perm: 'settings', key: 'a', desc: 'Quem mudou o quê, e quando' },
  { group: 'Conta' },
  { id: 'account', label: 'Minha conta', icon: 'account', perm: null, key: 'm', desc: 'Seus dados, senha e preferências' },
];

const root = document.getElementById('root');
const ctx = {
  user: null,
  access: null,
  isGlobal: false,
  isSuper: false,
  stores: [],
  storeId: null,
  store: null,
  args: [],
  query: {},
  pendingByStore: new Map(),
};
let cleanups = [];
let listeners = {};
let leaveGuards = [];
let currentId = null;
let currentHash = '';
let renderToken = 0;
let shellReady = false;
let switcher = null;

/* ---------- Armazenamento local (sempre protegido) ---------- */
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
const ssSet = (k, v) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
const mq = (q) => {
  try {
    return matchMedia(q);
  } catch {
    return { matches: false, addEventListener() {} };
  }
};
const isEditable = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="textbox"]');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/* ---------- Permissões ---------- */
ctx.roleIn = (storeId) => ctx.access?.roles.find((r) => r.store_id === storeId)?.role || null;
ctx.can = (perm, storeId = ctx.storeId) => {
  if (ctx.isGlobal) return true;
  if (!perm) return true;
  if (!storeId) return false;
  const role = ctx.roleIn(storeId);
  return !!role && (PERMS[perm] || []).includes(role);
};
ctx.storeName = (id) => ctx.stores.find((s) => s.id === id)?.name || '—';
// Nome curto da loja: "Atual Móveis - Mariana" → "Mariana"; "Loja Tavares - Ponte Nova" → "Tavares - Ponte Nova"
const storeShort = (s) => {
  if (!s) return '';
  const parts = String(s.name || '').split(' - ');
  if (parts.length > 1) {
    const rest = parts.slice(1).join(' - ');
    return /tavares/i.test(s.brand_name || parts[0]) ? `Tavares - ${rest}` : rest;
  }
  return s.city || s.name || '';
};
ctx.storeShort = (s) => storeShort(typeof s === 'string' ? ctx.stores.find((x) => x.id === s) : s);
const contextLabel = () => (ctx.store ? storeShort(ctx.store) : 'Toda a rede');
const roleLabel = () => {
  if (ctx.isSuper) return 'Super admin';
  if (ctx.isGlobal) return 'Admin da rede';
  return ROLES[ctx.roleIn(ctx.storeId)]?.label || 'Equipe';
};
const userName = () => ctx.user?.full_name || ctx.user?.email || '';
const canReceiveOrders = () => ctx.isGlobal || ctx.stores.some((s) => ctx.can('orders', s.id));
const storefrontHref = () => (ctx.store ? storefrontUrl(ctx.store.slug) : '/');

ctx.onCleanup = (fn) => cleanups.push(fn);
ctx.on = (event, fn) => {
  (listeners[event] = listeners[event] || []).push(fn);
  cleanups.push(() => (listeners[event] = (listeners[event] || []).filter((f) => f !== fn)));
};
const emit = (event, data) =>
  (listeners[event] || []).forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  });
ctx.onBeforeLeave = (fn) => {
  if (typeof fn !== 'function') return;
  leaveGuards.push(fn);
  cleanups.push(() => (leaveGuards = leaveGuards.filter((f) => f !== fn)));
};
async function canLeave() {
  for (const fn of [...leaveGuards]) {
    try {
      if ((await fn()) === false) return false;
    } catch (e) {
      console.error(e);
    }
  }
  return true;
}

ctx.navigate = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
// Troca a loja selecionada (null = toda a rede) e, opcionalmente, vai para outra rota.
ctx.setStore = (id, hash) => {
  if (hash) history.replaceState(null, '', hash);
  setStore(id);
};

/* ---------- Cabeçalho da página ---------- */
function resetHead() {
  const head = $('[data-page-head]');
  if (!head) return;
  head.hidden = false;
  const crumbs = $('[data-crumbs]', head);
  render(crumbs, '');
  crumbs.hidden = true;
  const back = $('[data-back]', head);
  back.hidden = true;
  $('.topbar')?.classList.remove('is-pushed');
}
ctx.setTitle = (title, sub = '', opts = {}) => {
  const head = $('[data-page-head]');
  const el = $('[data-title]');
  if (el) render(el, title ?? '');
  const subEl = $('[data-sub]');
  if (subEl) {
    render(subEl, sub || '');
    subEl.hidden = !sub;
  }
  const text = (el?.textContent || String(title ?? '')).trim();
  const top = $('[data-top-title]');
  if (top) top.textContent = text;
  if (head && opts && typeof opts === 'object') {
    if (opts.visible !== undefined) head.hidden = opts.visible === false;
    if (Array.isArray(opts.crumbs)) {
      const c = $('[data-crumbs]', head);
      render(
        c,
        opts.crumbs.map(([label, href], i) =>
          html`${i ? icon('chevronRight', 'icon-xs') : ''}${
            i === opts.crumbs.length - 1 || !href ? html`<span ${i === opts.crumbs.length - 1 ? raw('aria-current="page"') : ''}>${label}</span>` : html`<a href="${href}">${label}</a>`
          }`
        )
      );
      c.hidden = !opts.crumbs.length;
    }
    if (opts.back) {
      const b = $('[data-back]', head);
      b.href = opts.back;
      b.hidden = false;
      const tb = $('[data-top-back]');
      if (tb) tb.href = opts.back;
      $('.topbar')?.classList.add('is-pushed');
    }
  }
  document.title = `${text || 'Painel'} · Painel Atual Móveis`;
};
ctx.setActions = (content) => {
  const el = $('[data-actions]');
  if (el) render(el, content || '');
};

ctx.pickStore = (view, message = 'Escolha uma loja para continuar.') => {
  render(
    view,
    html`<div class="card"><div class="card__body">
      <h2 class="h2">Escolha a loja</h2>
      <p class="muted" style="margin-top:4px">${message}</p>
      <div class="pick-store">${ctx.stores.map(
        (s) => html`<button class="btn pick-store__b" type="button" data-pick-store="${s.id}">
          ${storeMark(s, 36)}<span><strong>${storeShort(s)}</strong><span>${s.brand_name} · ${s.city}/${s.state || 'MG'}</span></span>
        </button>`
      )}</div>
    </div></div>`
  );
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-store]');
    if (b) setStore(b.dataset.pickStore);
  });
};

/* ---------- Leitor de tela ---------- */
ctx.announce = (text) => {
  const el = document.getElementById('live-announcer');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 60);
};

/* ---------- Som de pedidos novos ---------- */
const SOUND_KEY = 'atual-admin-sound';
const soundOn = () => lsGet(SOUND_KEY) !== '0';
let audio = null;
function audioCtx() {
  if (!audio) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    } catch {
      audio = null;
    }
  }
  return audio;
}
// o navegador só libera som depois de um gesto: o contexto é criado/retomado no primeiro toque ou tecla
const unlockAudio = () => {
  const a = audioCtx();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
};
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
document.addEventListener('keydown', unlockAudio, { once: true, capture: true });
function beep() {
  if (!soundOn()) return;
  const ac = audio;
  if (!ac || ac.state !== 'running') return;
  try {
    const t = ac.currentTime;
    [
      [880, 0, 0.32],
      [1318.5, 0.14, 0.55],
    ].forEach(([freq, at, len]) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.start(t + at);
      o.stop(t + at + len + 0.02);
    });
  } catch {
    /* som indisponível */
  }
}
function setSound(on) {
  lsSet(SOUND_KEY, on ? '1' : '0');
  if (on) {
    unlockAudio();
    setTimeout(beep, 60);
  }
  syncSoundUI();
  toast(on ? 'Som de pedidos ligado neste aparelho' : 'Som de pedidos desligado neste aparelho', 'info', 2200);
}
function syncSoundUI() {
  const on = soundOn();
  $$('[data-sound-toggle]').forEach((b) => b.setAttribute('aria-checked', String(on)));
  const card = $('[data-sound-card]');
  if (card) render(card, soundCard());
}
const soundCard = () => {
  const on = soundOn();
  return html`<span class="side__sound-ico" aria-hidden="true">${icon(on ? 'volume' : 'volumeOff', 'icon-sm')}</span>
    <div class="grow"><strong id="snd-label">Som de pedidos</strong><span>${on ? 'Ligado aqui' : 'Desligado aqui'}</span></div>
    <button class="side__sw" type="button" role="switch" aria-checked="${on}" aria-labelledby="snd-label" data-sound-toggle title="Toca um aviso quando chega pedido novo"></button>`;
};

/* ---------- Tempo real (pedidos) ---------- */
let channel = null;
let chanSeq = 0;
let liveState = null; // null = conectando ou sem permissão de pedidos
let liveTimer = null;
Object.defineProperty(ctx, 'liveState', { get: () => liveState, enumerable: true });
function setLive(state) {
  liveState = state;
  renderLive();
}
function renderLive() {
  const el = $('[data-live]');
  if (!el) return;
  if (!liveState || !canReceiveOrders()) render(el, '');
  else render(el, html`${livePill(liveState)}${livePill(liveState, { compact: true })}`);
}
function onOrderInsert(payload) {
  const o = payload.new || {};
  ctx.refreshBadges({ pop: true });
  if (ctx.storeId && o.store_id !== ctx.storeId) return;
  const store = ctx.stores.find((s) => s.id === o.store_id);
  beep();
  toast([store?.name, money(o.total), PAYMENT_METHOD[o.payment_method]].filter(Boolean).join(' · '), 'tetim', 8000, {
    title: `Novo pedido ${o.code || ''}`.trim(),
    action: { label: 'Abrir pedido', onClick: () => ctx.navigate(`#/orders/${o.id}`) },
  });
  ctx.announce(`Novo pedido ${o.code || ''} de ${store ? storeShort(store) : firstName(o.customer_name)} chegou.`);
  emit('new-order', o);
}
function subscribeOrders() {
  if (channel) {
    const old = channel;
    channel = null;
    chanSeq += 1;
    sb.removeChannel(old);
  }
  clearTimeout(liveTimer);
  if (!canReceiveOrders()) {
    setLive(null);
    return;
  }
  const seq = ++chanSeq;
  liveTimer = setTimeout(() => {
    if (seq === chanSeq && liveState !== 'on') setLive('retry');
  }, 10000);
  channel = sb
    .channel('pedidos-novos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, onOrderInsert)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
      emit('order-updated', payload.new);
      ctx.refreshBadges();
    })
    .subscribe((status) => {
      if (seq !== chanSeq) return;
      if (status === 'SUBSCRIBED') setLive(navigator.onLine === false ? 'off' : 'on');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLive('retry');
      else if (status === 'CLOSED') setLive('off');
    });
}
window.addEventListener('offline', () => liveState && setLive('off'));
window.addEventListener('online', () => {
  if (!ctx.user || !liveState || liveState === 'on') return;
  setLive('retry');
  setTimeout(() => {
    if (ctx.user && liveState !== 'on') subscribeOrders();
  }, 4000);
});

/* ---------- Contadores (menu, abas, sininho, seletor de loja) ---------- */
let badgeSeq = 0;
let lastPending = null;
ctx.refreshBadges = async ({ pop = false } = {}) => {
  if (!ctx.user || !shellReady || !canReceiveOrders()) return;
  const seq = ++badgeSeq;
  let total = 0;
  try {
    if (ctx.stores.length > 1) {
      // uma consulta só: pedidos aguardando de todas as lojas visíveis, somados aqui
      const { data, error } = await sb.from('orders').select('store_id').eq('status', 'pending').limit(5000);
      if (error) throw error;
      if (seq !== badgeSeq) return;
      ctx.pendingByStore = new Map();
      (data || []).forEach((r) => ctx.pendingByStore.set(r.store_id, (ctx.pendingByStore.get(r.store_id) || 0) + 1));
      total = ctx.storeId ? ctx.pendingByStore.get(ctx.storeId) || 0 : (data || []).length;
      syncSwitcherBadges();
    } else {
      let qy = sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
      const { count, error } = await qy;
      if (error) throw error;
      if (seq !== badgeSeq) return;
      total = count || 0;
      if (ctx.storeId) ctx.pendingByStore = new Map([[ctx.storeId, total]]);
    }
  } catch {
    return;
  }
  const grew = pop && lastPending !== null && total > lastPending;
  lastPending = total;
  paintBadges({ grew });
};
function paintBadges({ grew = false } = {}) {
  const n = lastPending || 0;
  $$('[data-badge="orders"]').forEach((el) => {
    render(el, n ? html`${n}<span class="visually-hidden"> ${n === 1 ? 'novo' : 'novos'}</span>` : '');
    el.hidden = !n;
    if (grew && n) {
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
    }
  });
  const dot = $('[data-bell-dot]');
  if (dot) dot.hidden = !n;
  const bell = $('[data-notify]');
  if (bell) bell.setAttribute('aria-label', n ? `Avisos: ${plural(n, 'pedido aguardando', 'pedidos aguardando')} confirmação` : 'Avisos: nenhum pedido aguardando');
  syncRailLabels();
}
function syncSwitcherBadges() {
  const sel = $('[data-store-switch]');
  if (!sel) return;
  let total = 0;
  ctx.pendingByStore.forEach((v) => (total += v));
  for (const o of sel.options) {
    if (o.value === '') {
      setBadge(o, total ? plural(total, 'novo', 'novos') : '', 'new');
      continue;
    }
    const s = ctx.stores.find((x) => x.id === o.value);
    if (!s || s.active === false || s.accepts_orders === false) continue;
    const n = ctx.pendingByStore.get(s.id) || 0;
    setBadge(o, n ? plural(n, 'novo', 'novos') : '', 'new');
  }
}
function setBadge(o, label, tone) {
  if ((o.dataset.badge || '') === label && (o.dataset.badgeTone || '') === (label ? tone : '')) return;
  if (label) {
    o.dataset.badge = label;
    o.dataset.badgeTone = tone;
  } else {
    delete o.dataset.badge;
    delete o.dataset.badgeTone;
  }
}

/* ---------- Tema ---------- */
// O botão do topo alterna claro ⇄ escuro (cada clique muda a aparência); "Sistema" fica no menu da conta,
// na folha "Mais" e em Minha conta (controle de 3 opções).
const flipTheme = () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
const themeSeg = (id) =>
  html`<div data-shell-theme>${segmented({
    name: 'theme',
    label: 'Tema',
    options: [
      ['light', 'Claro'],
      ['dark', 'Escuro'],
      ['system', 'Sistema'],
    ],
    value: getTheme(),
    size: 'sm',
    cls: id ? `seg--${id}` : '',
  })}</div>`;
function syncThemeUI() {
  const cur = getTheme();
  const dark = resolvedTheme() === 'dark';
  $$('[data-theme-cycle]').forEach((b) => {
    render(b, icon(dark ? 'sun' : 'moon'));
    b.setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema escuro');
    b.setAttribute('aria-pressed', String(dark));
    b.dataset.tooltip = dark ? 'Tema claro' : 'Tema escuro';
  });
  $$('[data-shell-theme] .seg__b').forEach((b) => {
    const on = b.dataset.value === cur;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}
window.addEventListener('atual:theme', syncThemeUI);
mq('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeUI);
document.addEventListener('seg:change', (e) => {
  if (e.target.closest?.('[data-shell-theme]') && e.detail?.name === 'theme') setTheme(e.detail.value);
});

/* ---------- Menu lateral: trilho de ícones e gaveta ---------- */
const NAVPREF_KEY = 'atual-admin-nav';
const mqRail = mq('(min-width: 1024px) and (max-width: 1279px)');
const mqDesk = mq('(min-width: 1280px)');
const mqDrawer = mq('(max-width: 1023px)');
const isRail = () => {
  const pref = lsGet(NAVPREF_KEY);
  return (mqRail.matches && pref !== 'full') || (mqDesk.matches && pref === 'rail');
};
function applyRail() {
  const app = $('.app');
  if (!app) return;
  const rail = isRail();
  app.classList.toggle('app--rail', rail);
  const t = $('[data-rail-toggle]');
  if (t) {
    const label = rail ? 'Expandir menu' : 'Recolher menu';
    t.setAttribute('aria-label', label);
    t.setAttribute('aria-expanded', String(!rail));
    t.dataset.tooltip = `${label} ( [ )`;
    render(t, icon(rail ? 'chevRight' : 'chevLeft', 'icon-sm'));
  }
  if (!mqDrawer.matches) closeDrawer({ focus: false });
  syncRailLabels();
}
function toggleRail() {
  if (mqDrawer.matches) return;
  lsSet(NAVPREF_KEY, isRail() ? 'full' : 'rail');
  applyRail();
}
function syncRailLabels() {
  const rail = $('.app')?.classList.contains('app--rail');
  $$('.nav a[data-nav]').forEach((a) => {
    const label = a.querySelector('.nav__label')?.textContent || '';
    const n = a.dataset.nav === 'orders' ? lastPending || 0 : 0;
    if (rail) {
      a.dataset.tooltip = n ? `${label} · ${plural(n, 'novo', 'novos')}` : label;
      a.dataset.tooltipSide = 'right';
      a.setAttribute('aria-label', n ? `${label}, ${plural(n, 'novo', 'novos')}` : label);
    } else {
      delete a.dataset.tooltip;
      a.removeAttribute('aria-label');
    }
  });
}
mqRail.addEventListener?.('change', applyRail);
mqDesk.addEventListener?.('change', applyRail);

let drawerReturn = null;
function openDrawer() {
  const side = $('[data-sidebar]');
  if (!side || side.classList.contains('is-open')) return;
  drawerReturn = document.activeElement;
  side.classList.add('is-open');
  $('[data-side-scrim]').hidden = false;
  $('[data-toggle-sidebar]')?.setAttribute('aria-expanded', 'true');
  pushLayer(side, { onEscape: () => closeDrawer() });
  setTimeout(() => ($('.nav a.is-active', side) || focusable(side)[0])?.focus(), 30);
}
function closeDrawer({ focus = true } = {}) {
  const side = $('[data-sidebar]');
  if (!side || !side.classList.contains('is-open')) return;
  side.classList.remove('is-open');
  const scrim = $('[data-side-scrim]');
  if (scrim) scrim.hidden = true;
  $('[data-toggle-sidebar]')?.setAttribute('aria-expanded', 'false');
  popLayer(side);
  if (focus && drawerReturn?.isConnected) drawerReturn.focus({ preventScroll: true });
  drawerReturn = null;
}

/* ---------- Seletor de loja (topo) ---------- */
function storeOptions() {
  const n = ctx.stores.length;
  const badge = (s) => {
    if (s.active === false) return ['Inativa', 'neu'];
    if (s.accepts_orders === false) return ['Pedidos pausados', 'neu'];
    const p = ctx.pendingByStore.get(s.id) || 0;
    return p ? [plural(p, 'novo', 'novos'), 'new'] : ['', ''];
  };
  let total = 0;
  ctx.pendingByStore.forEach((v) => (total += v));
  return html`${
    ctx.isGlobal
      ? html`<option value="" data-mark="network" data-hint="${plural(n, 'loja', 'lojas')} · visão consolidada" data-keywords="rede todas lojas consolidado" ${
          total ? raw(`data-badge="${esc(plural(total, 'novo', 'novos'))}" data-badge-tone="new"`) : ''
        } ${!ctx.storeId ? 'selected' : ''}>Toda a rede</option>`
      : ''
  }<optgroup label="Lojas" data-count="${n}">${ctx.stores.map((s) => {
    const [b, tone] = badge(s);
    return html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name} · ${s.city}/${s.state || 'MG'}" data-keywords="${s.name} ${s.slug} ${s.city}" ${
      b ? raw(`data-badge="${esc(b)}" data-badge-tone="${tone}"`) : ''
    } ${s.id === ctx.storeId ? 'selected' : ''}>${storeShort(s)}</option>`;
  })}</optgroup>`;
}
const switcherValue = (it) => {
  const s = ctx.stores.find((x) => x.id === it?.value);
  if (!s)
    return html`<span class="switcher__mark" aria-hidden="true">${icon('houses', 'icon-sm')}</span><span class="switcher__txt"><strong>Toda a rede</strong><span>${plural(
      ctx.stores.length,
      'loja',
      'lojas'
    )}</span></span>`;
  return html`${storeMark(s, 32)}<span class="switcher__txt"><strong>${storeShort(s)}</strong><span>${s.brand_name}</span></span>`;
};
const switcherOption = (it, { query = '' } = {}) => {
  const s = ctx.stores.find((x) => x.id === it.value);
  const tag = it.badge
    ? html`<span class="opt__tag opt__tag--${it.badgeTone || 'neu'}">${it.badge === 'Pedidos pausados' ? html`${icon('pause', 'icon-xs')} ` : ''}${it.badge}</span>`
    : '';
  return html`<span class="sw-opt">${s ? storeMark(s, 30) : html`<span class="sw-net" aria-hidden="true">${icon('houses', 'icon-sm')}</span>`}<span class="opt__body"><span class="opt__label">${highlight(
    it.label,
    query
  )}</span><span class="opt__hint">${highlight(it.hint, query)}</span></span>${tag}</span>`;
};
const switcherFooter = () =>
  html`<div class="sw-foot"><span class="pop__keys"><span><span class="kbd">L</span> abre</span><span><span class="kbd">Enter</span> trocar</span></span>${
    ctx.isGlobal ? html`<button type="button" class="sw-foot__go" data-go="#/stores">${icon('stores', 'icon-sm')} Gerenciar lojas</button>` : ''
  }</div>`;
function buildSwitcher() {
  const slot = $('[data-switcher-slot]');
  if (!slot) return;
  switcher?.destroy?.();
  switcher = null;
  const multi = ctx.stores.length > 1 || ctx.isGlobal;
  render(
    slot,
    html`<label class="visually-hidden" for="store-switch">Loja</label><select id="store-switch" class="switcher" data-store-switch>${storeOptions()}</select>${
      multi
        ? ''
        : html`<div class="switcher is-static" role="group" aria-label="Loja: ${ctx.store?.name || ''}">${switcherValue({ value: ctx.storeId })}</div>`
    }`
  );
  const sel = $('#store-switch', slot);
  if (multi) {
    switcher = customSelect(sel, {
      search: true,
      sheetTitle: 'Escolher loja',
      searchPlaceholder: 'Buscar loja ou cidade…',
      chevron: 'chevUpDown',
      popClass: 'pop--switcher',
      maxHeight: 560,
      emptyText: (q) => `Nenhuma loja encontrada para “${q}”`,
      renderValue: switcherValue,
      renderOption: switcherOption,
      footer: switcherFooter,
    });
    switcher.el.setAttribute('aria-keyshortcuts', 'L');
  } else {
    sel.classList.add('sel__native');
    sel.dataset.single = '';
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
  }
  sel.addEventListener('change', onSwitch);
}
async function onSwitch(e) {
  const sel = e.currentTarget;
  const wanted = sel.value || null;
  if (wanted === (ctx.storeId || null)) return;
  if (!(await canLeave())) {
    sel.value = ctx.storeId || '';
    return;
  }
  setStore(wanted);
}

/* ---------- Loja selecionada ---------- */
const STORE_KEY = 'atual-admin-store';
function setStore(id, { announce = true } = {}) {
  const prev = ctx.storeId;
  ctx.storeId = id || null;
  ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
  if (!ctx.store) ctx.storeId = ctx.isGlobal ? null : ctx.stores[0]?.id || null;
  ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
  lsSet(STORE_KEY, ctx.storeId || 'network');
  lastPending = null;
  if (!shellReady) return;
  closeTransient();
  const sel = $('[data-store-switch]');
  if (sel && sel.value !== (ctx.storeId || '')) sel.value = ctx.storeId || '';
  updateShell();
  // a rota atual pode não existir na nova loja (ex.: Cupons para um operador) → Painel
  const { id: mod } = parseHash();
  let moved = '';
  if (NAV.some((n) => n.id === mod && !n.group) && !isAllowed(mod)) {
    moved = NAV.find((n) => n.id === mod).label;
    history.replaceState(null, '', '#/dashboard');
  }
  route({ skipGuard: true });
  ctx.refreshBadges();
  if (announce && prev !== ctx.storeId) {
    toast(moved ? `Agora em ${contextLabel()} · ${moved} não está liberado aqui, abrimos o Painel` : `Agora em ${contextLabel()}`, 'info', moved ? 4200 : 2500);
  }
}

/* ---------- Telas de acesso ---------- */
const AUTH_COPY = {
  login: { title: 'Entrar no painel', sub: 'Use o e-mail cadastrado pela sua loja.', bubble: 'Oi! Que bom ver você de novo.', submit: 'Entrar', busy: 'Entrando…' },
  forgot: { title: 'Recuperar senha', sub: 'Enviaremos um link para o seu e-mail.', bubble: 'Acontece! Vamos recuperar sua senha.', submit: 'Enviar link', busy: 'Enviando…' },
  reset: { title: 'Criar nova senha', sub: 'Escolha uma senha com pelo menos 8 caracteres.', bubble: 'Agora é só criar uma senha nova.', submit: 'Salvar nova senha', busy: 'Salvando…' },
};
// erros do login/senha em português (o Supabase responde em inglês)
function authError(err) {
  const code = err?.code || err?.error_code || '';
  const msg = String(err?.message || err || '');
  if (code === 'invalid_credentials' || /invalid login|invalid credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (code === 'same_password' || /different from the old|same.?password/i.test(msg)) return 'A nova senha precisa ser diferente da atual.';
  if (code === 'weak_password' || /weak|at least \d+ characters|password should/i.test(msg)) return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Confirme o seu e-mail pelo link que enviamos antes de entrar.';
  if (code === 'user_banned' || /banned/i.test(msg)) return 'Este acesso está bloqueado. Fale com o administrador da rede.';
  if (/rate limit|too many|429/i.test(`${code} ${msg} ${err?.status || ''}`)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  if (/session|jwt|expired/i.test(msg) && !/fetch/i.test(msg)) return 'O link expirou. Peça um novo em “Esqueci minha senha”.';
  return friendlyError(err);
}
const authAlert = (message) => {
  const ok = String(message).startsWith('✓');
  return html`<div class="alert ${ok ? 'alert--success' : 'alert--danger'}" role="${ok ? 'status' : 'alert'}">${icon(ok ? 'checkCircle' : 'alert')}<div>${String(message).replace(/^✓ /, '')}</div></div>`;
};
function leaveShell() {
  shellReady = false;
  closeTransient();
  runCleanups();
  switcher?.destroy?.();
  switcher = null;
}
function authScreen(mode = 'login', message = '', { email = '' } = {}) {
  leaveShell();
  const c = AUTH_COPY[mode] || AUTH_COPY.login;
  document.title = `${c.title} · Painel Atual Móveis`;
  render(
    root,
    html`<div class="auth">
      <section class="auth__porch" aria-hidden="true">
        <img class="auth__porch-logo" src="/assets/brand/atual-logo-horizontal.svg" alt="" width="160" height="34">
        <div class="auth__copy">
          <p class="auth__eyebrow">Painel da rede</p>
          <p class="auth__headline">Sua casa, sempre <span>atual</span>.</p>
          <p class="auth__lede">Pedidos, catálogo e entregas de todas as lojas Atual em um só lugar.</p>
        </div>
        <figure class="auth__art">${art('login-hero', { w: 720, h: 560 })}<figcaption class="auth__bubble">${c.bubble}</figcaption></figure>
      </section>
      <section class="auth__form">
        <form class="auth__card stack" data-auth novalidate aria-labelledby="auth-t">
          <img class="auth__mlogo" src="/assets/brand/atual-logo-horizontal.svg" alt="Atual Móveis e Eletro" width="160" height="34">
          <div class="auth__hello" aria-hidden="true">${art('tetim-face', { w: 64, h: 64 })}<span class="auth__hello-b">${c.bubble}</span></div>
          <div class="auth__head">
            <p class="auth__kicker">${icon('lock', 'icon-sm')} Acesso da equipe</p>
            <h1 class="auth__title" id="auth-t">${c.title}</h1>
            <p class="auth__sub">${c.sub}</p>
          </div>
          ${
            mode !== 'reset'
              ? html`<div class="field"><label for="a-email">E-mail</label>
              <div class="auth-field">${icon('mail', 'icon-sm')}<input class="input" id="a-email" name="email" type="email" autocomplete="username" inputmode="email" required autofocus placeholder="voce@atualmoveis.com.br" value="${email}"></div></div>`
              : ''
          }
          ${
            mode !== 'forgot'
              ? html`<div class="field"><div class="auth__labelrow"><label for="a-pass">${mode === 'reset' ? 'Nova senha' : 'Senha'}</label>${
                  mode === 'login' ? html`<button type="button" class="auth__link" data-mode="forgot">Esqueci minha senha</button>` : ''
                }</div>
              <div class="auth-field">${icon('lock', 'icon-sm')}<input class="input input--pass" id="a-pass" name="password" type="password" autocomplete="${
                  mode === 'reset' ? 'new-password' : 'current-password'
                }" required minlength="8" ${mode === 'reset' ? raw('autofocus aria-describedby="a-pass-hint"') : ''}><button type="button" class="auth__eye" data-eye aria-controls="a-pass" aria-pressed="false" aria-label="Mostrar senha">${icon(
                  'eye',
                  'icon-sm'
                )}</button></div>
              <p class="auth__caps" data-caps role="status" hidden>${icon('info', 'icon-xs')} Caps Lock está ativado.</p>
              ${mode === 'reset' ? html`<p class="hint" id="a-pass-hint">Use letras e números. Evite datas e o nome da loja.</p>` : ''}</div>`
              : ''
          }
          ${mode === 'login' ? html`<label class="check auth__remember"><input type="checkbox" name="remember" checked> Manter conectado neste computador</label>` : ''}
          <div data-auth-msg>${message ? authAlert(message) : ''}</div>
          <button class="btn btn--primary btn--lg" type="submit">${c.submit}${icon('arrowRight')}</button>
          ${
            mode === 'forgot'
              ? html`<button class="btn btn--ghost auth__back" type="button" data-mode="login">${icon('chevLeft', 'icon-sm')} Voltar ao login</button>`
              : mode === 'login'
                ? html`<p class="auth__help">Problemas para entrar? Fale com o administrador da sua loja.</p>`
                : ''
          }
        </form>
        <p class="auth__foot">© ${new Date().getFullYear()} Atual Móveis e Eletro · Ponte Nova, MG</p>
      </section>
    </div>`
  );
  const form = $('[data-auth]');
  const msg = $('[data-auth-msg]', form);
  // autofocus só vale uma vez por página: foca à mão (no celular não, para o teclado não cobrir a tela)
  if (!mq('(pointer: coarse)').matches) setTimeout(() => (form.email || form.password)?.focus({ preventScroll: true }), 0);
  const showMsg = (text) => render(msg, text ? authAlert(text) : '');
  form.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return authScreen(m.dataset.mode, '', { email: form.email?.value || email });
    const eye = e.target.closest('[data-eye]');
    if (eye) {
      const input = form.password;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      render(eye, icon(show ? 'eyeOff' : 'eye', 'icon-sm'));
      input.focus();
    }
  });
  const caps = $('[data-caps]', form);
  const onCaps = (e) => {
    if (caps && typeof e.getModifierState === 'function') caps.hidden = !e.getModifierState('CapsLock');
  };
  form.password?.addEventListener('keydown', onCaps);
  form.password?.addEventListener('keyup', onCaps);
  form.password?.addEventListener('blur', () => caps && (caps.hidden = true));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    const mail = form.email?.value.trim();
    const password = form.password?.value || '';
    showMsg('');
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    const invalid = (input, text) => {
      input.setAttribute('aria-invalid', 'true');
      showMsg(text);
      input.focus();
    };
    if (mode !== 'reset' && !mail) return invalid(form.email, 'Informe o seu e-mail.');
    if (mode !== 'reset' && !form.email.checkValidity()) return invalid(form.email, 'Confira o e-mail: falta algo como “@loja.com.br”.');
    if (mode === 'login' && !password) return invalid(form.password, 'Informe a sua senha.');
    if (mode === 'reset' && password.length < 8) return invalid(form.password, 'A senha precisa ter pelo menos 8 caracteres.');
    try {
      await withBusy(
        btn,
        async () => {
          if (mode === 'login') {
            const { error } = await sb.auth.signInWithPassword({ email: mail, password });
            if (error) throw new Error(authError(error));
            // "Manter conectado": desligado = a sessão some quando o navegador fecha (ver index.html)
            if (form.remember && !form.remember.checked) lsSet('atual-admin-ephemeral', '1');
            else lsSet('atual-admin-ephemeral', null);
            ssSet('atual-admin-alive', '1');
            await boot();
          } else if (mode === 'forgot') {
            const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: `${location.origin}/admin/#/reset` });
            if (error) throw new Error(authError(error));
            authScreen('login', '✓ Se o e-mail estiver cadastrado, você receberá o link em instantes.', { email: mail });
          } else {
            const { error } = await sb.auth.updateUser({ password });
            if (error) throw new Error(authError(error));
            history.replaceState(null, '', '#/dashboard');
            toast('Senha alterada.', 'success');
            await boot();
          }
        },
        c.busy
      );
    } catch (err) {
      if (!form.isConnected) return authScreen(mode, friendlyError(err), { email: mail });
      showMsg(friendlyError(err));
      (form.password || form.email)?.focus();
    }
  });
}

function noAccessScreen() {
  leaveShell();
  document.title = 'Sem acesso · Painel Atual Móveis';
  render(
    root,
    html`<div class="auth auth--solo"><section class="auth__form"><div class="auth__card stack">
      <img class="auth__mlogo" src="/assets/brand/atual-logo-horizontal.svg" alt="Atual Móveis e Eletro" width="160" height="34">
      ${art('no-access', { w: 280 })}
      <p class="auth__kicker">${icon('lock', 'icon-sm')} Sem acesso ao painel</p>
      <h1 class="auth__title">Sua conta ainda não está ligada a nenhuma loja</h1>
      <p class="auth__sub">Peça a um administrador para liberar seu acesso. Você entrou como <strong>${ctx.user?.email || ''}</strong>.</p>
      <button class="btn btn--lg" type="button" data-logout>${icon('logout')} Sair</button>
    </div></section></div>`
  );
}

let loggingOut = false;
async function logout() {
  if (loggingOut) return;
  loggingOut = true;
  if (channel) {
    chanSeq += 1;
    sb.removeChannel(channel);
    channel = null;
  }
  leaveShell();
  ctx.user = null;
  try {
    await sb.auth.signOut();
  } catch {
    /* sem rede: a sessão local some mesmo assim */
  }
  loggingOut = false;
  authScreen('login');
}

/* ---------- Estrutura ---------- */
function visibleNav() {
  const items = NAV.filter((n) => {
    if (n.group) return !n.network || ctx.isGlobal;
    if (n.network) return ctx.isGlobal;
    if (n.perm === null) return true;
    if (ctx.storeId) return ctx.can(n.perm);
    // visão "toda a rede" (só administradores da rede) ou usuário de loja sem loja escolhida
    return ctx.isGlobal;
  });
  // remove grupos sem itens
  return items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
}
const isAllowed = (id) => visibleNav().some((n) => n.id === id);
// abas do celular: Painel · Pedidos · Produtos · Clientes (ou a próxima área liberada) · Mais
function tabIds() {
  const ids = visibleNav()
    .filter((n) => !n.group && n.id !== 'account')
    .map((n) => n.id);
  const pref = ['dashboard', 'orders', 'products', 'customers'];
  return [...pref.filter((id) => ids.includes(id)), ...ids.filter((id) => !pref.includes(id))].slice(0, 4);
}

function drawShell() {
  render(
    root,
    html`<button class="skip-link" type="button" data-skip>Pular para o conteúdo</button>
    <div class="app" data-shell>
      <aside class="sidebar" id="sidebar" data-sidebar aria-label="Menu do painel">
        <div class="sidebar__brand">
          <a class="sidebar__home" href="#/dashboard" aria-label="Atual Móveis e Eletro: ir para o Painel">
            <img class="sidebar__logo" src="/assets/brand/atual-logo-horizontal-white.svg" alt="" width="126" height="27">
            <img class="sidebar__mark" src="/assets/brand/atual-mark-white.svg" alt="" width="30" height="30">
          </a>
          <button class="side__btn side__toggle" type="button" data-rail-toggle data-tooltip-side="right" aria-controls="sidebar"></button>
          <button class="side__btn side__close" type="button" data-drawer-close aria-label="Fechar menu">${icon('close', 'icon-sm')}</button>
        </div>
        <nav class="nav" aria-label="Áreas do painel" data-nav-list></nav>
        <div class="sidebar__spacer"></div>
        <div class="side__sound" data-sound-card></div>
        <button class="side__user" type="button" data-menu="user-menu" data-user-btn aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu"></button>
      </aside>
      <div class="side-scrim" data-side-scrim hidden></div>
      <div class="menu menu--user" id="user-menu" data-user-menu hidden></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn topbar__menu" type="button" data-toggle-sidebar aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
          <a class="icon-btn topbar__back" href="#/dashboard" data-top-back aria-label="Voltar">${icon('chevLeft')}</a>
          <div class="switcher-slot" data-switcher-slot></div>
          <span class="topbar__title" data-top-title aria-hidden="true"></span>
          <button class="cmdk-trigger" type="button" data-palette aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">${icon('search', 'icon-sm')}<span class="cmdk-trigger__t"><span class="cmdk-trigger__long">Buscar pedidos, produtos, clientes…</span><span class="cmdk-trigger__short">Buscar…</span></span><span class="kbds" aria-hidden="true"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>
          <div class="top__actions">
            <span class="top__live" data-live></span>
            <button class="icon-btn only-m" type="button" data-palette aria-label="Buscar">${icon('search')}</button>
            <a class="icon-btn only-d" data-storefront href="/" target="_blank" rel="noopener" aria-label="Ver loja virtual (abre em nova aba)" data-tooltip="Ver loja virtual" data-tooltip-side="bottom">${icon('external')}</a>
            <button class="icon-btn only-d" type="button" data-theme-cycle data-tooltip-side="bottom"></button>
            <div class="top__notify" data-notify-wrap>
              <button class="icon-btn" type="button" data-menu="notify-menu" data-notify aria-haspopup="menu" aria-expanded="false" aria-controls="notify-menu" aria-label="Avisos">${icon('bell')}<span class="icon-btn__dot" data-bell-dot hidden></span></button>
              <div class="menu menu--notify" id="notify-menu" hidden></div>
            </div>
          </div>
        </header>
        <header class="page-head" data-page-head>
          <div class="page-head__txt">
            <a class="page-head__back" href="#/dashboard" data-back hidden>${icon('chevLeft', 'icon-sm')}Voltar</a>
            <nav class="crumbs" data-crumbs aria-label="Trilha" hidden></nav>
            <h1 class="page-title" data-title></h1>
            <p class="page-sub" data-sub hidden></p>
          </div>
          <div class="page-actions" data-actions></div>
        </header>
        <main class="content" id="conteudo" data-view tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="Navegação principal" data-tabbar></nav>
    </div>
    <div id="live-announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>`
  );
}

// Redesenha o que depende de loja/papel (menu, abas, conta, seletor). Não toca na área do módulo.
function updateShell({ rebuildSwitcher = false } = {}) {
  if (!$('[data-shell]')) return;
  const items = visibleNav().filter((n) => n.id !== 'account' && n.group !== 'Conta');
  const navItems = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  render(
    $('[data-nav-list]'),
    navItems.map((n, i) =>
      n.group
        ? html`${i ? html`<div class="nav__sep" role="separator"></div>` : ''}<div class="nav__group" role="presentation">${n.group}</div>`
        : html`<a href="#/${n.id}" data-nav="${n.id}" class="${n.id === currentId ? 'is-active' : ''}" ${n.id === currentId ? raw('aria-current="page"') : ''}>${icon(n.icon)}<span class="nav__label">${n.label}</span>${
            n.badge ? html`<span class="nav__count" data-badge="orders" hidden></span>` : ''
          }</a>`
    )
  );
  const tabs = tabIds();
  const byId = (id) => NAV.find((n) => n.id === id);
  render(
    $('[data-tabbar]'),
    html`${tabs.map((id) => {
      const n = byId(id);
      const on = id === currentId;
      return html`<a class="tabbar__item ${on ? 'is-active' : ''}" href="#/${id}" data-tab="${id}" ${on ? raw('aria-current="page"') : ''}><span class="tabbar__i">${icon(n.icon)}${
        n.badge ? html`<span class="tabbar__n" data-badge="orders" hidden></span>` : ''
      }</span><span>${n.short || n.label}</span></a>`;
    })}<button class="tabbar__item ${currentId && !tabs.includes(currentId) ? 'is-active' : ''}" type="button" data-more aria-haspopup="dialog" aria-expanded="false"><span class="tabbar__i">${icon(
      'grid'
    )}</span><span>Mais</span></button>`
  );
  render($('[data-sound-card]'), soundCard());
  $('[data-sound-card]').hidden = !canReceiveOrders();
  const name = userName();
  const ub = $('[data-user-btn]');
  render(ub, html`${avatar(name, { self: true, size: 34 })}<div class="grow"><strong>${name}</strong><span>${roleLabel()}</span></div>${icon('chevUpDown', 'icon-sm')}`);
  ub.setAttribute('aria-label', `Conta: ${name}, ${roleLabel()}`);
  render(
    $('[data-user-menu]'),
    html`<div class="menu__head">${avatar(name, { self: true, size: 36 })}<div><strong>${name}</strong><span>${ctx.user?.email || ''}</span></div></div>
      <hr>
      <a href="#/account" data-nav="account">${icon('account')} Minha conta</a>
      <div class="menu__row">${icon('moon')}<span>Tema</span>${themeSeg('menu')}</div>
      ${canReceiveOrders() ? html`<div class="menu__row menu__row--sound">${icon('volume')}<span id="um-snd">Som de pedidos</span><button class="side__sw side__sw--light" type="button" role="switch" aria-checked="${soundOn()}" aria-labelledby="um-snd" data-sound-toggle></button></div>` : ''}
      <a href="${storefrontHref()}" target="_blank" rel="noopener" data-storefront-link>${icon('external')} Ver loja virtual</a>
      <hr>
      <button type="button" class="is-danger" data-logout>${icon('logout')} Sair</button>`
  );
  const sf = $('[data-storefront]');
  if (sf) sf.href = storefrontHref();
  const notify = $('[data-notify-wrap]');
  if (notify) notify.hidden = !canReceiveOrders();
  if (rebuildSwitcher || !switcher || !$('[data-store-switch]')) buildSwitcher();
  else switcher.refresh();
  syncThemeUI();
  renderLive();
  applyRail();
  paintBadges();
}

function setActiveNav(id) {
  currentId = id;
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === id;
    a.classList.toggle('is-active', on);
    if (on && a.closest('.nav')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tabs = tabIds();
  $$('[data-tab]').forEach((a) => {
    const on = a.dataset.tab === id;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('[data-more]')?.classList.toggle('is-active', !!id && !tabs.includes(id));
}

// "Mais" (celular): áreas que não couberam nas abas + tema, som, loja virtual e sair
function openMore() {
  const tabs = tabIds();
  const items = visibleNav().filter((n) => !n.group && !tabs.includes(n.id));
  const btn = $('[data-more]');
  btn?.setAttribute('aria-expanded', 'true');
  const name = userName();
  openModal({
    title: 'Mais opções',
    cls: 'modal--more',
    head: html`<div class="m-more__head">${avatar(name, { self: true, size: 38 })}<div><h2>${name}</h2><p>${roleLabel()} · ${contextLabel()}</p></div></div>`,
    body: html`<nav class="m-grid" aria-label="Outras áreas">${items.map(
      (n) => html`<a class="m-grid__i ${n.id === currentId ? 'is-active' : ''}" href="#/${n.id}" ${n.id === currentId ? raw('aria-current="page"') : ''}>${icon(n.icon)}<span>${n.short || n.label}</span></a>`
    )}</nav>
      <div class="m-more__rows">
        <div class="m-more__row">${icon('moon', 'icon-sm')}<span class="grow">Tema</span>${themeSeg('more')}</div>
        ${
          canReceiveOrders()
            ? html`<div class="m-more__row">${icon('volume', 'icon-sm')}<span class="grow" id="more-snd">Som de novos pedidos</span><button class="side__sw side__sw--light" type="button" role="switch" aria-checked="${soundOn()}" aria-labelledby="more-snd" data-sound-toggle></button></div>`
            : ''
        }
        <a class="m-more__row" href="${storefrontHref()}" target="_blank" rel="noopener">${icon('external', 'icon-sm')}<span class="grow">Ver loja virtual</span>${icon('chevRight', 'icon-sm')}</a>
        <button class="m-more__row m-more__row--danger" type="button" data-logout>${icon('logout', 'icon-sm')}<span class="grow">Sair</span></button>
      </div>`,
    onClose: () => btn?.setAttribute('aria-expanded', 'false'),
  });
}

// Sininho: pedidos aguardando confirmação (os mais antigos primeiro)
async function loadNotify() {
  const menu = $('#notify-menu');
  if (!menu) return;
  render(menu, html`<div class="menu__label"><span>Aguardando confirmação</span></div><div style="padding:4px 6px">${skeleton('list', { rows: 3 })}</div>`);
  let qy = sb.from('orders').select('id,code,customer_name,total,store_id,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(6);
  if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
  const { data, error } = await qy;
  if (!menu.isConnected) return;
  if (error) {
    render(menu, html`<div class="notif-empty">${icon('alert')}<span>${friendlyError(error)}</span></div>`);
    return;
  }
  const rows = data || [];
  const total = lastPending ?? rows.length;
  render(
    menu,
    rows.length
      ? html`<div class="menu__label"><span>Aguardando confirmação</span><span>${total}</span></div>
        ${rows.map((o) => {
          const s = ctx.stores.find((x) => x.id === o.store_id);
          return html`<a class="notif" href="#/orders/${o.id}"><span class="notif__ico" aria-hidden="true">${icon('clock', 'icon-sm')}</span><span class="notif__body"><span class="notif__t"><span class="code">${o.code}</span><span>${money(
            o.total
          )}</span></span><span class="notif__s">${ageChip(o.created_at)}<span>· ${s ? storeShort(s) : ''} · ${firstName(o.customer_name)}</span></span></span></a>`;
        })}
        <div class="menu__foot"><a href="#/orders?status=pending">Ver todos os pedidos novos</a></div>`
      : html`<div class="notif-empty">${icon('checkCircle')}<strong>Tudo em dia</strong><span>Nenhum pedido aguardando confirmação${ctx.store ? ` em ${storeShort(ctx.store)}` : ''}.</span></div>`
  );
}

/* ---------- Busca e comandos (Ctrl K) ---------- */
const RECENT_KEY = 'atual-admin-recent';
const readRecent = () => {
  try {
    const v = JSON.parse(lsGet(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
function pushRecent(item) {
  const list = readRecent().filter((r) => !(r.k === item.k && r.id === item.id));
  list.unshift({ ...item, at: Date.now() });
  lsSet(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
}
// texto seguro para filtros do PostgREST (vírgulas, parênteses e curingas quebram o or=())
const cleanTerm = (s) => String(s || '').replace(/[%*,()"'\\:;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
// Busca sem acento: o banco compara com ILIKE (sensível a acento). Cada vogal/c de palavras sem acento vira "_"
// (curinga de 1 letra: "sofa" acha "Sofá") e o resultado é conferido aqui sem acento (tira falsos positivos).
const searchWords = (q) => cleanTerm(q).split(' ').filter(Boolean).slice(0, 4);
const loose = (w) => (w.length < 3 || /[^\x00-\x7f]/.test(w) ? w : w.replace(/[aeiouc]/gi, '_'));
// cols: colunas de texto; exact: colunas comparadas sem curinga (sku, código). Devolve uma expressão para .or()
function wordsExpr(cols, words, exact = []) {
  const one = (w) => {
    const parts = cols.map((c) => `${c}.ilike.*${exact.includes(c) ? w : loose(w)}*`);
    return parts.length > 1 ? `or(${parts.join(',')})` : parts[0];
  };
  return words.length > 1 ? `and(${words.map(one).join(',')})` : one(words[0]);
}
const hasWords = (text, words) => {
  const t = fold(text);
  return words.every((w) => t.includes(fold(w)));
};
// "#1252", "1252", "AT001252" → "AT001252"
function orderCode(q) {
  const t = String(q || '').trim();
  let m = t.match(/^#?\s*(\d{1,6})$/);
  if (m) return `AT${m[1].padStart(6, '0')}`;
  m = t.match(/^at\s*(\d{1,6})$/i);
  return m ? `AT${m[1].padStart(6, '0')}` : null;
}
const productLink = (p) => {
  const s = ctx.stores.find((x) => x.id === p.store_id);
  return s && p.slug ? `${storefrontUrl(s.slug)}?produto=${encodeURIComponent(p.slug)}` : storefrontHref();
};

let palette = null;
function openPalette({ query = '' } = {}) {
  if (palette) {
    palette.focus(query);
    return palette;
  }
  if (!shellReady || document.querySelector('.modal, .panel')) return null;
  closeDrawer({ focus: false });
  $$('.menu[data-open]').forEach((m) => {
    m.hidden = true;
    m.removeAttribute('data-open');
  });
  const returnTo = document.activeElement;
  const canP = ctx.can('catalog');
  const canO = ctx.can('orders');
  const canC = ctx.can('customers');
  const scope = contextLabel();
  const scrim = document.createElement('div');
  scrim.className = 'cmdk-scrim';
  const box = document.createElement('div');
  box.className = 'cmdk';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Buscar e executar comandos');
  render(
    box,
    html`<div class="cmdk__input">${icon('search')}
        <input type="search" id="cmdk-input" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Buscar pedidos, produtos, clientes ou ações…" aria-label="Buscar no painel" aria-describedby="cmdk-hint">
        <span class="cmdk__scope">em ${scope}</span><span class="kbd" aria-hidden="true">Esc</span>
        <button class="icon-btn cmdk__close" type="button" data-cmdk-close aria-label="Fechar busca">${icon('close')}</button>
      </div>
      <div class="cmdk__tabs" role="tablist" aria-label="Filtrar resultados" data-cmdk-tabs></div>
      <div class="cmdk__split">
        <div class="cmdk__body" id="cmdk-list" role="listbox" aria-label="Resultados"></div>
        <aside class="cmdk__preview" aria-label="Prévia" data-cmdk-preview></aside>
      </div>
      <div class="cmdk__foot" id="cmdk-hint"><span class="pop__keys"><span><span class="kbd">↑</span><span class="kbd">↓</span> navegar</span><span><span class="kbd">Enter</span> abrir</span>${
        canP ? html`<span><span class="kbd">Ctrl</span><span class="kbd">Enter</span> ver na loja</span>` : ''
      }</span>${canO ? html`<span>Digite <b>#1252</b> para abrir um pedido</span>` : ''}</div>
      <span class="visually-hidden" role="status" aria-live="polite" data-cmdk-status></span>`
  );
  document.body.append(scrim, box);
  document.body.classList.add('is-locked');
  const input = $('#cmdk-input', box);
  const list = $('#cmdk-list', box);
  const tabsEl = $('[data-cmdk-tabs]', box);
  const preview = $('[data-cmdk-preview]', box);
  const status = $('[data-cmdk-status]', box);
  const TABS = [
    ['all', 'Tudo'],
    ...(canP ? [['products', 'Produtos']] : []),
    ...(canO ? [['orders', 'Pedidos']] : []),
    ...(canC ? [['customers', 'Clientes']] : []),
    ['actions', 'Ações'],
  ];
  const st = { q: '', filter: 'all', res: {}, loading: {}, items: [], active: -1, ctrl: null, copies: new Map(), closed: false };

  const actions = () => {
    const a = [];
    if (canP) a.push({ id: 'new-product', label: 'Cadastrar novo produto', icon: 'plus', keys: ['N'], run: () => ctx.navigate('#/products/new') });
    if (canO)
      a.push({
        id: 'pending',
        label: 'Ver pedidos novos',
        hint: lastPending ? `${plural(lastPending, 'pedido aguardando', 'pedidos aguardando')} confirmação` : 'Pedidos aguardando confirmação',
        icon: 'orders',
        run: () => ctx.navigate('#/orders?status=pending'),
      });
    if (switcher) a.push({ id: 'switch', label: 'Trocar de loja', hint: `Agora em ${scope}`, icon: 'houses', keys: ['L'], run: () => setTimeout(() => switcher?.open({ kbd: true }), 30) });
    a.push({ id: 'storefront', label: 'Abrir loja virtual', hint: ctx.store ? `Loja de ${storeShort(ctx.store)}, em nova aba` : 'Página inicial da rede, em nova aba', icon: 'external', run: () => window.open(storefrontHref(), '_blank', 'noopener') });
    const toDark = resolvedTheme() !== 'dark';
    a.push({ id: 'theme', label: toDark ? 'Usar tema escuro' : 'Usar tema claro', hint: `Tema atual: ${THEMES[getTheme()].toLowerCase()}`, icon: toDark ? 'moon' : 'sun', run: () => flipTheme() });
    if (canReceiveOrders()) a.push({ id: 'sound', label: soundOn() ? 'Desligar som de pedidos' : 'Ligar som de pedidos', icon: soundOn() ? 'volumeOff' : 'volume', run: () => setSound(!soundOn()) });
    a.push({ id: 'logout', label: 'Sair do painel', icon: 'logout', run: () => logout() });
    return a.map((x) => ({ ...x, kind: 'action' }));
  };
  const navs = () =>
    visibleNav()
      .filter((n) => !n.group)
      .map((n) => ({ kind: 'nav', id: n.id, label: n.label, hint: n.desc, icon: n.icon, keys: n.key ? ['G', n.key.toUpperCase()] : null, run: () => ctx.navigate(`#/${n.id}`) }));
  const matches = (x, q) => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const hay = fold(`${x.label} ${x.hint || ''} ${x.id || ''}`);
    return words.every((w) => hay.includes(w));
  };

  // ----- buscas no banco (com cancelamento) -----
  async function searchOrders(q, signal) {
    const t = cleanTerm(q);
    const words = searchWords(q);
    const digits = q.replace(/\D/g, '');
    const code = orderCode(q);
    const cols = 'id,code,customer_name,customer_phone,total,status,store_id,created_at,payment_method,payment_status';
    const scoped = (b) => (ctx.storeId ? b.eq('store_id', ctx.storeId) : b);
    const reqs = [];
    if (t) {
      const ors = [wordsExpr(['customer_name'], words), `code.ilike.*${t.replace(/\s+/g, '')}*`];
      if (digits.length >= 4) ors.push(`customer_phone.like.*${digits}*`);
      reqs.push(scoped(sb.from('orders').select(`${cols},order_items(name,image_url,quantity)`, { count: 'exact' })).or(ors.join(',')).order('created_at', { ascending: false }).limit(8).abortSignal(signal));
    } else reqs.push(Promise.resolve({ data: [], count: 0 }));
    reqs.push(code ? scoped(sb.from('orders').select(`${cols},order_items(name,image_url,quantity)`)).eq('code', code).limit(1).abortSignal(signal) : Promise.resolve({ data: [] }));
    reqs.push(
      t.length >= 3 && !/^\d+$/.test(t)
        ? scoped(sb.from('orders').select(`${cols},order_items!inner(name,image_url,quantity)`))
            .or(wordsExpr(['name'], words), { referencedTable: 'order_items' })
            .order('created_at', { ascending: false })
            .limit(8)
            .abortSignal(signal)
        : Promise.resolve({ data: [] })
    );
    const [byText, byCode, byItem] = await Promise.all(reqs);
    for (const r of [byText, byCode, byItem]) if (r.error) throw r.error;
    byText.data = (byText.data || []).filter((o) => hasWords(`${o.customer_name} ${o.code} ${o.customer_phone}`, words) || (digits.length >= 4 && String(o.customer_phone).includes(digits)));
    byItem.data = (byItem.data || []).filter((o) => (o.order_items || []).some((it) => hasWords(it.name, words)));
    const seen = new Set();
    const out = [];
    const add = (rows, via) =>
      (rows || []).forEach((o) => {
        if (seen.has(o.id)) return;
        seen.add(o.id);
        out.push({ ...o, via });
      });
    add(byCode.data, 'code');
    add(byText.data, 'text');
    add(byItem.data, 'item');
    return { rows: out.slice(0, 5), total: Math.max(byText.count || 0, out.length), exact: (byCode.data || [])[0] || null };
  }
  async function searchProducts(q, signal) {
    const words = searchWords(q);
    if (!words.length) return { rows: [], total: 0 };
    let b = sb
      .from('products')
      .select('id,name,slug,sku,price,stock_qty,track_stock,status,store_id,group_id,image_url,model3d,model_url,categories(name)', { count: 'exact' })
      .or(wordsExpr(['name', 'sku'], words, ['sku']));
    if (ctx.storeId) b = b.eq('store_id', ctx.storeId);
    const { data: raw0, error, count } = await b.order('name').limit(ctx.storeId ? 12 : 60).abortSignal(signal);
    if (error) throw error;
    const data = (raw0 || []).filter((p) => hasWords(`${p.name} ${p.sku || ''}`, words));
    if (ctx.storeId) return { rows: data.slice(0, 5).map((p) => ({ ...p, copies: [p] })), total: data.length < (raw0 || []).length ? data.length : Math.max(count || 0, data.length) };
    // Toda a rede: uma linha por produto (cópias do mesmo grupo juntas)
    const groups = new Map();
    (data || []).forEach((p) => {
      const g = groups.get(p.group_id) || { ...p, copies: [] };
      g.copies.push(p);
      if (g.status !== 'active' && p.status === 'active') Object.assign(g, { ...p, copies: g.copies });
      groups.set(p.group_id, g);
    });
    const rows = [...groups.values()];
    return { rows: rows.slice(0, 5), total: rows.length, capped: (count || 0) > (raw0 || []).length };
  }
  async function searchCustomers(q, signal) {
    const words = searchWords(q);
    const digits = q.replace(/\D/g, '');
    if (!words.length) return { rows: [], total: 0 };
    let b = sb.from('customers').select('id,name,phone,orders!inner(id,store_id)');
    if (ctx.storeId) b = b.eq('orders.store_id', ctx.storeId);
    const ors = [wordsExpr(['name'], words)];
    if (digits.length >= 4) ors.push(`phone.like.*${digits}*`);
    const { data, error } = await b.or(ors.join(',')).order('name').limit(8).abortSignal(signal);
    if (error) throw error;
    const rows = (data || []).filter((c) => hasWords(c.name, words) || (digits.length >= 4 && String(c.phone).includes(digits)));
    return { rows: rows.slice(0, 5), total: rows.length };
  }

  const runSearch = debounce(async () => {
    const q = st.q;
    st.ctrl?.abort();
    const ctrl = new AbortController();
    st.ctrl = ctrl;
    const jobs = [];
    const job = (key, fn) =>
      jobs.push(
        fn(q, ctrl.signal)
          .then((r) => {
            if (ctrl.signal.aborted || st.q !== q) return;
            st.res[key] = r;
          })
          .catch((e) => {
            if (ctrl.signal.aborted || e?.name === 'AbortError' || /abort/i.test(e?.message || '')) return;
            st.res[key] = { rows: [], total: 0, error: friendlyError(e) };
          })
          .finally(() => {
            if (st.q !== q || ctrl.signal.aborted) return;
            st.loading[key] = false;
            draw();
          })
      );
    if (canP) job('products', searchProducts);
    if (canO) job('orders', searchOrders);
    if (canC) job('customers', searchCustomers);
    await Promise.allSettled(jobs);
    if (st.q === q && !ctrl.signal.aborted) {
      const n = st.items.filter((x) => x.kind !== 'more').length;
      status.textContent = n ? `${plural(n, 'resultado', 'resultados')}` : `Nada encontrado para “${q}”`;
    }
  }, 180);

  // ----- desenho -----
  const searchable = (q) => q.length >= 2 || /^#\d/.test(q) || /^\d{3,}$/.test(q);
  function sections() {
    const q = st.q;
    const out = [];
    if (!q) {
      const rec = readRecent().filter((r) => !ctx.storeId || !r.store_id || r.store_id === ctx.storeId);
      if (rec.length && st.filter === 'all')
        out.push({
          key: 'recent',
          title: 'Recentes',
          items: rec.map((r) => ({ kind: 'recent', id: r.id, label: r.label, hint: r.hint, icon: r.k === 'order' ? 'orders' : r.k === 'customer' ? 'customers' : 'products', run: () => ctx.navigate(r.href) })),
        });
      if (st.filter === 'all' || st.filter === 'actions') {
        out.push({ key: 'actions', title: 'Ações rápidas', items: actions() });
        out.push({ key: 'nav', title: 'Ir para', items: navs() });
      }
      return out;
    }
    const want = (k) => st.filter === 'all' || st.filter === k;
    if (searchable(q)) {
      const R = st.res;
      const code = orderCode(q);
      if (canO && want('orders') && code && R.orders?.exact) {
        const o = R.orders.exact;
        out.push({ key: 'exact', title: 'Pedido', items: [orderItem(o, q, true)] });
      }
      if (canP && want('products'))
        out.push({
          key: 'products',
          title: 'Produtos',
          aside: ctx.storeId ? `em ${storeShort(ctx.store)}` : `em ${plural(ctx.stores.length, 'loja', 'lojas')}`,
          loading: st.loading.products,
          error: R.products?.error,
          items: (R.products?.rows || []).map((p) => productItem(p, q)),
          more: R.products && (R.products.total > 5 || R.products.capped) ? { label: 'Ver todos em Produtos', href: `#/products?q=${encodeURIComponent(cleanTerm(q))}` } : null,
        });
      if (canO && want('orders'))
        out.push({
          key: 'orders',
          title: 'Pedidos',
          loading: st.loading.orders,
          error: R.orders?.error,
          items: (R.orders?.rows || []).filter((o) => !(code && R.orders?.exact && o.id === R.orders.exact.id)).map((o) => orderItem(o, q)),
          more: R.orders && R.orders.total > 5 ? { label: `Ver todos os ${R.orders.total} pedidos`, href: `#/orders?q=${encodeURIComponent(cleanTerm(q))}` } : null,
        });
      if (canC && want('customers'))
        out.push({
          key: 'customers',
          title: 'Clientes',
          loading: st.loading.customers,
          error: R.customers?.error,
          items: (R.customers?.rows || []).map((c) => customerItem(c, q)),
          more: R.customers && R.customers.rows?.length >= 5 ? { label: 'Ver todos em Clientes', href: `#/customers?q=${encodeURIComponent(cleanTerm(q))}` } : null,
        });
    }
    if (want('actions')) {
      out.push({ key: 'actions', title: 'Ações', items: actions().filter((x) => matches(x, q)) });
      out.push({ key: 'nav', title: 'Ir para', items: navs().filter((x) => matches(x, q)) });
    }
    return out;
  }
  function productItem(p, q) {
    const n = p.copies?.length || 1;
    const s = ctx.stores.find((x) => x.id === p.store_id);
    const prices = (p.copies || [p]).map((c) => Number(c.price) || 0);
    const min = Math.min(...prices);
    const out = (p.copies || [p]).every((c) => c.track_stock !== false && (c.stock_qty || 0) <= 0);
    const hint = html`${p.sku ? html`<span class="mono">${p.sku}</span> · ` : ''}${
      n > 1 ? html`${n} lojas · a partir de ${money(min)}` : html`${!ctx.storeId && s ? html`${storeShort(s)} · ` : ''}${out ? 'sem estoque' : money(p.price)}`
    }`;
    return {
      kind: 'product',
      id: p.id,
      data: p,
      html: html`${
        p.image_url ? html`<img class="thumb" src="${mediaUrl(p.image_url)}" alt="" loading="lazy">` : html`<span class="thumb thumb--none" aria-hidden="true">${icon('image', 'icon-sm')}</span>`
      }<span class="opt__body"><span class="opt__label">${highlight(p.name, q)}</span><span class="opt__hint">${hint}</span></span>${p.status !== 'active' ? productStatusBadge(p.status) : ''}`,
      text: p.name,
      run: () => {
        pushRecent({ k: 'product', id: p.id, label: p.name, hint: `${p.sku ? `${p.sku} · ` : ''}${s ? storeShort(s) : ''}`, href: `#/products/${p.id}`, store_id: p.store_id });
        ctx.navigate(`#/products/${p.id}`);
      },
      alt: () => window.open(productLink(p), '_blank', 'noopener'),
    };
  }
  function orderItem(o, q, exact = false) {
    const s = ctx.stores.find((x) => x.id === o.store_id);
    const item = (o.order_items || [])[0];
    const hint = html`${o.via === 'item' && item ? html`${highlight(item.name, q)} · ` : ''}${!ctx.storeId && s ? html`${storeShort(s)} · ` : ''}${money(o.total)} · ${relTime(o.created_at)}`;
    return {
      kind: 'order',
      id: o.id,
      data: o,
      html: html`<span class="opt__icon" aria-hidden="true">${icon('orders', 'icon-sm')}</span><span class="opt__body"><span class="opt__label"><span class="code">${exact ? o.code : highlight(o.code, q)}</span> · ${highlight(
        o.customer_name,
        q
      )}</span><span class="opt__hint">${hint}</span></span>${statusBadge(o.status)}`,
      text: `${o.code} ${o.customer_name}`,
      run: () => {
        pushRecent({ k: 'order', id: o.id, label: `${o.code} · ${o.customer_name}`, hint: `${s ? storeShort(s) : ''} · ${money(o.total)}`, href: `#/orders/${o.id}`, store_id: o.store_id });
        ctx.navigate(`#/orders/${o.id}`);
      },
    };
  }
  function customerItem(c, q) {
    const n = (c.orders || []).length;
    return {
      kind: 'customer',
      id: c.id,
      data: c,
      html: html`${avatar(c.name, { size: 36 })}<span class="opt__body"><span class="opt__label">${highlight(c.name, q)}</span><span class="opt__hint">${phone(c.phone)} · ${plural(n, 'pedido', 'pedidos')}</span></span>`,
      text: c.name,
      run: () => {
        pushRecent({ k: 'customer', id: c.id, label: c.name, hint: phone(c.phone), href: `#/customers/${c.id}`, store_id: null });
        ctx.navigate(`#/customers/${c.id}`);
      },
    };
  }
  const rowHtml = (x, i) => {
    const on = i === st.active;
    const keys = x.keys ? html`<span class="cmdk__keys" aria-hidden="true">${x.keys.map((k) => html`<span class="kbd">${k}</span>`)}</span>` : '';
    const body =
      x.html ||
      html`<span class="opt__icon" aria-hidden="true">${icon(x.icon || 'arrowRight', 'icon-sm')}</span><span class="opt__body"><span class="opt__label">${highlight(x.label, st.q)}</span>${
        x.hint ? html`<span class="opt__hint">${x.hint}</span>` : ''
      }</span>${keys}`;
    return html`<div class="cmdk__item ${x.kind === 'more' ? 'cmdk__more' : ''} ${on ? 'is-active' : ''}" role="option" id="cmdk-o-${i}" data-i="${i}" aria-selected="${on}">${body}<span class="cmdk__go" aria-hidden="true">Abrir ${icon(
      'enter',
      'icon-xs'
    )}</span></div>`;
  };
  function draw() {
    if (st.closed) return;
    const secs = sections();
    st.items = [];
    const counts = { products: 0, orders: 0, customers: 0, actions: 0 };
    const parts = [];
    let anyLoading = false;
    secs.forEach((sec) => {
      const rows = [];
      sec.items.forEach((x) => {
        rows.push(rowHtml(x, st.items.length));
        st.items.push(x);
      });
      if (sec.more) {
        const m = { kind: 'more', label: sec.more.label, icon: 'arrowRight', run: () => ctx.navigate(sec.more.href) };
        rows.push(rowHtml(m, st.items.length));
        st.items.push(m);
      }
      if (sec.key === 'products') counts.products = sec.items.length;
      if (sec.key === 'orders' || sec.key === 'exact') counts.orders += sec.items.length;
      if (sec.key === 'customers') counts.customers = sec.items.length;
      if (sec.key === 'actions' || sec.key === 'nav') counts.actions += sec.items.length;
      if (sec.loading) anyLoading = true;
      if (!rows.length && !sec.loading && !sec.error) return;
      const gid = `cmdk-g-${sec.key}`;
      parts.push(
        html`<div role="group" aria-labelledby="${gid}"><div class="cmdk__group" id="${gid}"><span>${sec.title}</span>${
          sec.loading ? html`<span class="spinner" aria-hidden="true"></span>` : sec.aside ? html`<span>${sec.aside}</span>` : ''
        }</div>${
          sec.loading && !rows.length
            ? html`<div class="cmdk__loading" aria-hidden="true"><span class="skeleton" style="width:36px;height:36px"></span><span class="sk-lines" style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="skeleton" style="width:46%;height:11px"></span><span class="skeleton" style="width:28%;height:9px"></span></span></div>`
            : ''
        }${sec.error ? html`<div class="cmdk__loading muted small">${icon('alert', 'icon-sm')} ${sec.error}</div>` : ''}${rows}</div>`
      );
    });
    if (!parts.length) {
      const fl = (TABS.find(([k]) => k === st.filter) || [])[1] || '';
      parts.push(
        !st.q
          ? html`<div class="cmdk__empty">${icon('search')}<span>Digite para buscar em ${fl.toLowerCase()}.</span></div>`
          : !searchable(st.q)
          ? html`<div class="cmdk__empty">${icon('search')}<span>Digite pelo menos 2 letras para buscar.</span></div>`
            : html`<div class="cmdk__empty"><strong>Nada encontrado para “${st.q}”</strong><span>Confira a grafia${canO ? ' ou busque pelo número do pedido (ex.: #1252)' : ''}.</span></div>`
      );
    }
    if (st.active >= st.items.length || st.active < 0) st.active = st.items.length ? 0 : -1;
    // marca o ativo de novo (o índice pode ter mudado)
    render(list, parts);
    $$('.cmdk__item', list).forEach((el) => {
      const on = Number(el.dataset.i) === st.active;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', String(on));
    });
    if (st.active >= 0) input.setAttribute('aria-activedescendant', `cmdk-o-${st.active}`);
    else input.removeAttribute('aria-activedescendant');
    const total = counts.products + counts.orders + counts.customers + counts.actions;
    render(
      tabsEl,
      html`${TABS.map(([k, label]) => {
        const n = k === 'all' ? total : counts[k];
        const on = st.filter === k;
        return html`<button type="button" class="cmdk__tab ${on ? 'is-on' : ''}" role="tab" aria-selected="${on}" tabindex="-1" data-filter="${k}">${label}${st.q ? html` <span>${n}</span>` : ''}</button>`;
      })}<span class="pop__keys cmdk__tabhint"><span><span class="kbd">Tab</span> trocar filtro</span></span>`
    );
    box.classList.toggle('is-loading', anyLoading);
    paintPreview();
  }
  function setActive(i, { scroll = true } = {}) {
    if (!st.items.length) return;
    st.active = Math.max(0, Math.min(st.items.length - 1, i));
    $$('.cmdk__item', list).forEach((el) => {
      const on = Number(el.dataset.i) === st.active;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', String(on));
      if (on && scroll) el.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `cmdk-o-${st.active}`);
    paintPreview();
  }
  // prévia (≥ 1280 px): produto com preço/estoque por loja, ou resumo do pedido
  const loadCopies = async (gid) => {
    if (st.copies.has(gid)) return;
    st.copies.set(gid, null);
    const { data, error } = await sb.from('products').select('id,store_id,price,stock_qty,track_stock,status').eq('group_id', gid);
    st.copies.set(gid, error ? [] : data || []);
    if (!st.closed && st.items[st.active]?.data?.group_id === gid) paintPreview();
  };
  function paintPreview() {
    const x = st.items[st.active];
    const wide = mq('(min-width: 1280px)').matches;
    if (!x || !wide || (x.kind !== 'product' && x.kind !== 'order')) {
      box.classList.remove('cmdk--preview');
      render(preview, '');
      return;
    }
    box.classList.add('cmdk--preview');
    if (x.kind === 'product') {
      const p = x.data;
      const copies = st.copies.get(p.group_id);
      if (copies === undefined) loadCopies(p.group_id);
      const has3d = !(p.model3d && p.model3d.kind === 'none');
      const sorted = (copies || []).slice().sort((a, b) => ctx.stores.findIndex((s) => s.id === a.store_id) - ctx.stores.findIndex((s) => s.id === b.store_id));
      render(
        preview,
        html`<div class="cmdk__photo">${p.image_url ? html`<img src="${mediaUrl(p.image_url)}" alt="">` : html`<div class="cmdk__photo-none">${icon('image')}</div>`}${productStatusBadge(p.status)}${
          has3d ? html`<span class="cmdk__3d">${icon('cube', 'icon-xs')}3D</span>` : ''
        }</div>
          <h3 class="cmdk__pt">${p.name}</h3>
          <p class="cmdk__pmeta">${p.sku ? html`<span class="mono">${p.sku}</span>` : 'Sem SKU'}${p.categories?.name ? ` · ${p.categories.name}` : ''}</p>
          <div class="cmdk__copies"><table class="mini"><caption class="visually-hidden">Preço e estoque por loja</caption><thead><tr><th scope="col">Loja</th><th scope="col" class="num">Preço</th><th scope="col" class="num">Estoque</th></tr></thead><tbody>${
            copies === null || copies === undefined
              ? html`<tr><td colspan="3"><span class="skeleton" style="display:block;width:100%;height:12px"></span></td></tr>`
              : sorted.map((c) => {
                  const s = ctx.stores.find((y) => y.id === c.store_id);
                  const zero = c.track_stock !== false && (c.stock_qty || 0) <= 0;
                  return html`<tr><td>${s ? storeShort(s) : '—'}${c.status !== 'active' ? html` <span class="muted">· ${c.status === 'draft' ? 'rascunho' : 'arquivado'}</span>` : ''}</td><td class="num">${money(
                    c.price
                  )}</td><td class="num ${zero ? 'mini__out' : ''}">${c.track_stock === false ? '—' : c.stock_qty}</td></tr>`;
                })
          }</tbody></table></div>
          <div class="cmdk__acts"><button class="btn btn--sm" type="button" data-cmdk-run>${icon('edit', 'icon-sm')} Editar <span class="kbd kbd--sm" aria-hidden="true">↵</span></button><a class="btn btn--sm" href="${productLink(
            p
          )}" target="_blank" rel="noopener">${icon('external', 'icon-sm')} Ver na loja</a></div>`
      );
    } else {
      const o = x.data;
      const s = ctx.stores.find((y) => y.id === o.store_id);
      render(
        preview,
        html`<p class="cmdk__ocode">${o.code}</p>
          <div class="cmdk__ostat">${statusBadge(o.status)}${o.status === 'pending' ? ageChip(o.created_at) : html`<span class="muted small">${relTime(o.created_at)}</span>`}</div>
          <dl class="cmdk__dl"><dt>Cliente</dt><dd>${o.customer_name}</dd><dt>Loja</dt><dd>${s ? storeShort(s) : '—'}</dd><dt>Pagamento</dt><dd>${PAYMENT_METHOD[o.payment_method] || o.payment_method || '—'}</dd><dt>Total</dt><dd><strong>${money(
            o.total
          )}</strong></dd></dl>
          ${
            (o.order_items || []).length
              ? html`<ul class="cmdk__items">${o.order_items.slice(0, 3).map(
                  (it) =>
                    html`<li>${it.image_url ? html`<img class="thumb" src="${mediaUrl(it.image_url)}" alt="">` : html`<span class="thumb" aria-hidden="true"></span>`}<span>${it.name}</span><span class="muted">${it.quantity}×</span></li>`
                )}</ul>`
              : ''
          }
          <div class="cmdk__acts"><button class="btn btn--sm" type="button" data-cmdk-run style="grid-column:1/-1">${icon('orders', 'icon-sm')} Abrir pedido <span class="kbd kbd--sm" aria-hidden="true">↵</span></button></div>`
      );
    }
  }
  function runItem(x, alt = false) {
    if (!x) return;
    if (alt && x.alt) {
      x.alt();
      return;
    }
    close({ restore: false });
    x.run?.();
  }
  function setQuery(q) {
    st.q = q.trim();
    st.active = 0;
    st.res = {};
    st.ctrl?.abort();
    if (st.q && searchable(st.q)) {
      if (canP) st.loading.products = true;
      if (canO) st.loading.orders = true;
      if (canC) st.loading.customers = true;
      runSearch();
    } else st.loading = {};
    draw();
  }
  function close({ restore = true } = {}) {
    if (st.closed) return;
    st.closed = true;
    st.ctrl?.abort();
    popLayer(box);
    box.remove();
    scrim.remove();
    if (!document.querySelector('.modal, .panel')) document.body.classList.remove('is-locked');
    window.removeEventListener('resize', onResize);
    palette = null;
    if (restore && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  }
  const onResize = debounce(paintPreview, 120);
  window.addEventListener('resize', onResize);
  pushLayer(box, { onEscape: () => close() });
  scrim.addEventListener('click', () => close());
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(st.active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(st.active - 1);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setActive(st.active + 5);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setActive(st.active - 5);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // "#1252" + Enter abre o pedido direto, mesmo antes da busca terminar
      const code = orderCode(st.q);
      if (code && canO && !st.res.orders?.exact && st.loading.orders) {
        const q = st.q;
        let qy = sb.from('orders').select('id').eq('code', code);
        if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
        qy.maybeSingle().then(({ data }) => {
          if (data && st.q === q) runItem({ run: () => ctx.navigate(`#/orders/${data.id}`) });
        });
        return;
      }
      runItem(st.items[st.active], e.ctrlKey || e.metaKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const i = TABS.findIndex(([k]) => k === st.filter);
      st.filter = TABS[(i + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length][0];
      st.active = 0;
      draw();
      status.textContent = `Filtro: ${TABS.find(([k]) => k === st.filter)[1]}`;
    }
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && e.target !== input) {
      e.preventDefault();
      input.focus();
    }
  });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.cmdk__item');
    if (el && Number(el.dataset.i) !== st.active) setActive(Number(el.dataset.i), { scroll: false });
  });
  list.addEventListener('mousedown', (e) => e.target.closest('.cmdk__item') && e.preventDefault());
  list.addEventListener('click', (e) => {
    const el = e.target.closest('.cmdk__item');
    if (el) runItem(st.items[Number(el.dataset.i)], e.ctrlKey || e.metaKey);
  });
  tabsEl.addEventListener('mousedown', (e) => e.preventDefault());
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    st.filter = b.dataset.filter;
    st.active = 0;
    draw();
    input.focus();
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-cmdk-close]')) close();
    if (e.target.closest('[data-cmdk-run]')) runItem(st.items[st.active]);
  });
  input.value = query;
  setQuery(query);
  setTimeout(() => input.focus(), 0);
  palette = {
    close,
    focus: (q) => {
      if (q) {
        input.value = q;
        setQuery(q);
      }
      input.focus();
    },
  };
  return palette;
}
ctx.openPalette = (opts) => openPalette(opts);

/* ---------- Rotas ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  return { id: parts[0] || 'dashboard', args: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs)) };
}
function runCleanups() {
  const list = cleanups;
  cleanups = [];
  leaveGuards = [];
  list.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignora */
    }
  });
}
// fecha o que é passageiro: janelas, gaveta, seletor, busca, menus
function closeTransient() {
  closeModals();
  closeDrawer({ focus: false });
  if (switcher?.isOpen) switcher.close();
  palette?.close({ restore: false });
  $$('.menu[data-open]').forEach((m) => {
    m.hidden = true;
    m.removeAttribute('data-open');
    document.querySelector(`[data-menu="${CSS.escape(m.id)}"]`)?.setAttribute('aria-expanded', 'false');
  });
}
function freshView() {
  const view = $('[data-view]');
  if (!view) return null;
  const fresh = view.cloneNode(false); // remove ouvintes do módulo anterior
  view.replaceWith(fresh);
  return fresh;
}
function routeSkeleton(id) {
  if (id === 'dashboard') return html`<div class="route-sk">${skeleton('kpis')}<div class="card" style="margin-top:16px">${skeleton('table', { rows: 4 })}</div></div>`;
  if (['store', 'network', 'account'].includes(id)) return html`<div class="route-sk">${skeleton('form', { rows: 6 })}</div>`;
  return html`<div class="route-sk"><div class="card">${skeleton('table', { rows: 6 })}</div></div>`;
}
function playEnter(view) {
  view.classList.remove('view-in');
  void view.offsetWidth;
  view.classList.add('view-in');
  view.addEventListener('animationend', () => view.classList.remove('view-in'), { once: true });
}
// área existente, mas não liberada para o papel atual
const WHO = {
  catalog: 'Esta área é da equipe de catálogo',
  orders: 'Esta área é do atendimento da loja',
  customers: 'Esta área é do atendimento da loja',
  coupons: 'Esta área é da gerência da loja',
  settings: 'Esta área é do administrador da loja',
  staff: 'Esta área é do administrador da loja',
};
function renderNoAccess(view, areaId) {
  const item = NAV.find((n) => n.id === areaId && !n.group);
  const area = item?.label || 'Esta área';
  const title = item?.network ? 'Esta área é da administração da rede' : WHO[item?.perm] || 'Esta área não está liberada para você';
  const role = ROLES[ctx.roleIn(ctx.storeId)]?.label;
  const text = item?.network
    ? `${area} é cuidada pela equipe da rede. Se precisar mudar algo, fale com a administração.`
    : ctx.store
      ? `Seu acesso em ${storeShort(ctx.store)} é de ${role ? role.toLowerCase() : 'equipe'}. Peça ao administrador da loja para liberar ${area.toLowerCase()}, se precisar.`
      : 'Escolha uma loja no seletor do topo ou peça ao administrador para liberar o acesso.';
  const mail = ctx.store?.email;
  ctx.setTitle('Sem acesso', '', { visible: false });
  render(
    view,
    html`<h1 class="visually-hidden">Sem acesso</h1>${empty(
      title,
      text,
      html`${
        mail && !item?.network
          ? html`<a class="btn btn--dark" href="mailto:${mail}?subject=${encodeURIComponent(`Acesso ao painel: ${area}`)}">${icon('mail', 'icon-sm')} Pedir acesso</a>`
          : ''
      }<a class="btn" href="#/dashboard">${icon('dashboard', 'icon-sm')} Voltar ao Painel</a>`,
      { art: 'no-access', size: 'lg' }
    )}`
  );
}
function renderNotFound(view, id) {
  ctx.setTitle('Página não encontrada', '', { visible: false });
  render(
    view,
    html`<h1 class="visually-hidden">Página não encontrada</h1>${empty(
      'Página não encontrada',
      `O endereço “#/${id}” não existe no painel. Confira o link ou volte ao início.`,
      html`<a class="btn btn--dark" href="#/dashboard">${icon('dashboard', 'icon-sm')} Ir para o Painel</a>`,
      { art: 'site:out-of-range', size: 'lg' }
    )}`
  );
}

const importRetry = {};
async function route({ skipGuard = false } = {}) {
  if (!ctx.user) return;
  let { id, args, query } = parseHash();
  if (id === 'reset') return authScreen('reset');
  if (!shellReady) return;
  const target = location.hash;
  // alterações não salvas (ctx.onBeforeLeave): pergunta antes de sair da tela
  if (!skipGuard && leaveGuards.length && currentHash && target !== currentHash) {
    history.replaceState(null, '', currentHash);
    if (!(await canLeave())) return;
    history.replaceState(null, '', target);
    ({ id, args, query } = parseHash());
  }
  const item = NAV.find((n) => n.id === id && !n.group);
  const allowed = !!item && isAllowed(id);
  const moduleChanged = id !== currentId;
  closeTransient();
  runCleanups();
  ctx.args = args;
  ctx.query = query;
  // depois de navegar pelo menu/abas/busca, o foco vai para o conteúdo (na primeira tela não: o Tab começa no "Pular para o conteúdo")
  const fromNav = !!currentHash && (!document.activeElement || document.activeElement === document.body || !!document.activeElement.closest?.('[data-sidebar], .tabbar, .menu, .cmdk'));
  const view = freshView();
  if (!view) return;
  resetHead();
  ctx.setActions('');
  if (moduleChanged || target !== currentHash) window.scrollTo(0, 0);
  const token = ++renderToken;
  if (!item || !allowed) {
    if (item && !allowed) history.replaceState(null, '', `#/sem-acesso?area=${encodeURIComponent(id)}`);
    currentHash = location.hash;
    setActiveNav(null);
    if (id === 'sem-acesso' || (item && !allowed)) renderNoAccess(view, item ? id : query.area);
    else renderNotFound(view, id);
    playEnter(view);
    return;
  }
  currentHash = location.hash;
  setActiveNav(id);
  ctx.setTitle(item.label, item.desc);
  render(view, routeSkeleton(id));
  try {
    // depois de uma falha, o navegador guarda o import() que falhou: "Tentar de novo" usa outro endereço
    const mod = (await import(importRetry[id] ? `./modules/${id}.js?tentativa=${importRetry[id]}` : `./modules/${id}.js`)).default;
    if (token !== renderToken) return;
    if (mod.title) ctx.setTitle(mod.title, item.desc);
    if (item.needsStore && !ctx.storeId) {
      ctx.pickStore(view, 'Esta área configura uma loja específica.');
      playEnter(view);
      return;
    }
    render(view, '');
    playEnter(view);
    const cleanup = await mod.render(view, ctx);
    if (typeof cleanup === 'function') {
      if (token === renderToken) cleanups.push(cleanup);
      else {
        try {
          cleanup();
        } catch {
          /* ignora */
        }
      }
    }
    if (token === renderToken && fromNav && !view.contains(document.activeElement) && !document.querySelector('.modal, .panel')) view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    const missing = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(e?.message || '');
    render(
      view,
      errorBlock(missing ? new Error('Confira sua conexão e tente de novo. Se continuar, recarregue a página.') : e instanceof Error ? e : new Error(friendlyError(e)), {
        retry: () => {
          if (missing) importRetry[id] = (importRetry[id] || 0) + 1;
          route({ skipGuard: true });
        },
        title: 'Não foi possível abrir esta área',
      })
    );
  }
}

/* ---------- Atalhos de teclado ---------- */
let gAt = 0;
document.addEventListener('keydown', (e) => {
  if (!ctx.user || !shellReady || e.isComposing) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) {
    e.preventDefault();
    if (palette) palette.close();
    else openPalette();
    return;
  }
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isEditable(e.target) || topLayer() || document.querySelector('.modal, .panel, .menu[data-open]')) {
    gAt = 0;
    return;
  }
  if (gAt && Date.now() - gAt < 1200) {
    gAt = 0;
    const n = NAV.find((x) => !x.group && x.key === k.toLowerCase() && isAllowed(x.id));
    if (n) {
      e.preventDefault();
      ctx.navigate(`#/${n.id}`);
    }
    return;
  }
  if (k === 'g' || k === 'G') {
    gAt = Date.now();
    return;
  }
  if ((k === 'l' || k === 'L') && switcher) {
    e.preventDefault();
    switcher.open({ kbd: true });
  } else if (k === '[') {
    e.preventDefault();
    toggleRail();
  } else if ((k === 'n' || k === 'N') && ctx.can('catalog') && isAllowed('products')) {
    e.preventDefault();
    ctx.navigate('#/products/new');
  }
});

/* ---------- Cliques do shell (delegação) ---------- */
document.addEventListener('click', (e) => {
  if (!shellReady) return;
  const t = e.target;
  if (t.closest('[data-palette]')) {
    e.preventDefault();
    openPalette();
    return;
  }
  if (t.closest('[data-skip]')) {
    $('[data-view]')?.focus();
    return;
  }
  if (t.closest('[data-toggle-sidebar]')) {
    if ($('[data-sidebar]')?.classList.contains('is-open')) closeDrawer();
    else openDrawer();
    return;
  }
  if (t.closest('[data-drawer-close]') || t.closest('[data-side-scrim]')) {
    closeDrawer();
    return;
  }
  if (t.closest('[data-rail-toggle]')) {
    toggleRail();
    return;
  }
  if (t.closest('[data-more]')) {
    openMore();
    return;
  }
  if (t.closest('[data-sound-toggle]')) {
    setSound(!soundOn());
    return;
  }
  const go = t.closest('[data-go]');
  if (go) {
    e.preventDefault();
    if (switcher?.isOpen) switcher.close();
    ctx.navigate(go.dataset.go);
    return;
  }
  if (t.closest('[data-theme-cycle]')) {
    flipTheme();
    return;
  }
  const userBtn = t.closest('[data-user-btn]');
  if (userBtn) {
    // posiciona o menu da conta (fica fora do menu lateral para não ser cortado no trilho)
    const menu = $('[data-user-menu]');
    const r = userBtn.getBoundingClientRect();
    const rail = $('.app')?.classList.contains('app--rail') && !mqDrawer.matches;
    menu.style.left = `${Math.round(rail ? r.right + 10 : Math.max(8, r.left))}px`;
    menu.style.bottom = `${Math.round(rail ? Math.max(8, innerHeight - r.bottom) : innerHeight - r.top + 8)}px`;
    return;
  }
  // o ui.js já abriu/fechou o menu neste mesmo clique: carrega só ao abrir
  if (t.closest('[data-notify]') && $('#notify-menu') && !$('#notify-menu').hidden) loadNotify();
});
document.addEventListener('click', (e) => {
  // sair (fora do shell também: tela "sem acesso")
  if (e.target.closest('[data-logout]')) {
    e.preventDefault();
    logout();
  }
});
// a gaveta (768–1023) prende o foco enquanto aberta
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const side = $('[data-sidebar].is-open');
  if (!side || topLayer() !== side) return;
  const f = focusable(side);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && (i <= 0 || i === -1)) {
    e.preventDefault();
    f[f.length - 1].focus();
  } else if (!e.shiftKey && (i === f.length - 1 || i === -1)) {
    e.preventDefault();
    f[0].focus();
  }
});
mqDrawer.addEventListener?.('change', () => closeDrawer({ focus: false }));

// idade dos pedidos aguardando ("há 38 min") a cada minuto
setInterval(() => {
  if (!document.hidden && shellReady) refreshAges();
}, 60000);

/* ---------- Início ---------- */
async function loadStores() {
  const base = sb.from('stores').select('*').order('sort_order').order('name');
  const { data, error } = ctx.isGlobal ? await base : await base.in('id', ctx.access.roles.map((r) => r.store_id).filter(Boolean));
  if (error) throw error;
  return data || [];
}
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return authScreen('login');
  ssSet('atual-admin-alive', '1');
  try {
    const access = await rpc('my_access');
    if (!access) return authScreen('login');
    ctx.access = access;
    ctx.user = { id: access.user_id, email: access.email, full_name: access.full_name };
    ctx.isGlobal = !!access.is_global;
    ctx.isSuper = !!access.is_super;
    if (!access.roles.length) return noAccessScreen();
    ctx.stores = await loadStores();
    registerStores(ctx.stores);
    const saved = lsGet(STORE_KEY);
    const savedStore = ctx.stores.find((s) => s.id === saved);
    if (savedStore) ctx.storeId = savedStore.id;
    else if (saved === 'network' && ctx.isGlobal) ctx.storeId = null;
    else ctx.storeId = ctx.isGlobal ? null : ctx.stores[0]?.id || null;
    ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
    ctx.pendingByStore = new Map();
    lastPending = null;
    currentId = null;
    currentHash = '';
    drawShell();
    shellReady = true;
    updateShell({ rebuildSwitcher: true });
    subscribeOrders();
    route({ skipGuard: true });
    ctx.refreshBadges();
  } catch (e) {
    console.error(e);
    authScreen('login', friendlyError(e));
  }
}

// Atualiza a lista de lojas (ex.: depois de criar/editar uma loja) e redesenha o menu.
ctx.reloadStores = async () => {
  try {
    ctx.stores = (await loadStores()) || ctx.stores;
  } catch {
    return;
  }
  registerStores(ctx.stores);
  ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
  const sel = $('[data-store-switch]');
  if (sel && switcher) render(sel, storeOptions());
  updateShell({ rebuildSwitcher: !switcher });
};

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') authScreen('reset');
  if (event === 'SIGNED_OUT' && ctx.user && !loggingOut) {
    ctx.user = null;
    authScreen('login', 'Sua sessão terminou. Entre novamente.');
  }
});
window.addEventListener('hashchange', () => route());
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

initUI();
if (location.hash.startsWith('#/reset') || /type=recovery/.test(location.hash)) {
  // o Supabase processa o token da URL e dispara PASSWORD_RECOVERY
  sb.auth.getSession().then(({ data }) => (data.session ? authScreen('reset') : authScreen('login', 'Link de recuperação inválido ou expirado.')));
} else {
  boot();
}

// exporta para depuração no console
window.__atual = { ctx, sb, toastError, esc, openPalette };
