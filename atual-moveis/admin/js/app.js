// Núcleo do painel: login, contexto (usuário, lojas, permissões), menu, rotas e avisos em tempo real.
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
//   ctx.onCleanup(fn) · ctx.refreshBadges() · ctx.on('new-order', fn)
import { sb, rpc, friendlyError } from './api.js';
import { html, render, $, $$, icon, toast, toastError, ROLES, money, esc } from './ui.js';

const PERMS = {
  view: ['store_admin', 'store_manager', 'store_editor', 'store_operator'],
  catalog: ['store_admin', 'store_manager', 'store_editor'],
  orders: ['store_admin', 'store_manager', 'store_operator'],
  customers: ['store_admin', 'store_manager', 'store_operator'],
  coupons: ['store_admin', 'store_manager'],
  settings: ['store_admin'],
  staff: ['store_admin'],
};

const NAV = [
  { group: 'Operação' },
  { id: 'dashboard', label: 'Painel', icon: 'dashboard', perm: 'view' },
  { id: 'orders', label: 'Pedidos', icon: 'orders', perm: 'orders', badge: true },
  { id: 'customers', label: 'Clientes', icon: 'customers', perm: 'customers' },
  { id: 'reports', label: 'Relatórios', icon: 'reports', perm: 'orders' },
  { group: 'Catálogo' },
  { id: 'products', label: 'Produtos', icon: 'products', perm: 'catalog' },
  { id: 'showcase', label: 'Vitrine e banners', icon: 'showcase', perm: 'catalog' },
  { id: 'coupons', label: 'Cupons', icon: 'coupons', perm: 'coupons' },
  { id: 'categories', label: 'Categorias', icon: 'categories', network: true },
  { group: 'Loja' },
  { id: 'store', label: 'Dados, entrega e pagamento', icon: 'store', perm: 'settings', needsStore: true },
  { id: 'team', label: 'Equipe', icon: 'team', perm: 'staff' },
  { group: 'Rede', network: true },
  { id: 'stores', label: 'Lojas', icon: 'stores', network: true },
  { id: 'network', label: 'Configurações da rede', icon: 'network', network: true },
  { id: 'audit', label: 'Auditoria', icon: 'audit', perm: 'settings' },
  { group: 'Conta' },
  { id: 'account', label: 'Minha conta', icon: 'account', perm: null },
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
};
let cleanups = [];
let listeners = {};
let currentModule = null;
let renderToken = 0;

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
ctx.onCleanup = (fn) => cleanups.push(fn);
ctx.on = (event, fn) => {
  (listeners[event] = listeners[event] || []).push(fn);
  cleanups.push(() => (listeners[event] = (listeners[event] || []).filter((f) => f !== fn)));
};
const emit = (event, data) => (listeners[event] || []).forEach((fn) => fn(data));

ctx.navigate = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
// Troca a loja selecionada (null = toda a rede) e, opcionalmente, vai para outra rota.
ctx.setStore = (id, hash) => {
  if (hash) history.replaceState(null, '', hash);
  setStore(id);
};

ctx.setTitle = (title, sub = '') => {
  const el = $('[data-title]');
  if (el) render(el, html`${title}${sub ? html` <span class="topbar__crumb">· ${sub}</span>` : ''}`);
  document.title = `${title} · Painel Atual Móveis`;
};
ctx.setActions = (content) => {
  const el = $('[data-actions]');
  if (el) render(el, content || '');
};

ctx.pickStore = (view, message = 'Escolha uma loja para continuar.') => {
  render(
    view,
    html`<div class="card"><div class="card__body stack">
      <div class="h2">Escolha a loja</div>
      <p class="muted">${message}</p>
      <div class="grid grid-3">${ctx.stores.map(
        (s) => html`<button class="btn" type="button" data-pick-store="${s.id}" style="justify-content:flex-start;height:auto;padding:12px">
          ${icon('store')}<span style="text-align:left"><strong>${s.name}</strong><br><span class="muted small">${s.city}</span></span>
        </button>`
      )}</div>
    </div></div>`
  );
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-store]');
    if (b) setStore(b.dataset.pickStore);
  });
};

/* ---------- Pedidos novos em tempo real ---------- */
let channel = null;
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
    o.start();
    o.stop(ac.currentTime + 0.5);
  } catch {
    /* som indisponível */
  }
}

function subscribeOrders() {
  if (channel) sb.removeChannel(channel);
  if (!ctx.can('orders') && !ctx.isGlobal && !ctx.stores.some((s) => ctx.can('orders', s.id))) return;
  channel = sb
    .channel('pedidos-novos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
      const o = payload.new;
      if (ctx.storeId && o.store_id !== ctx.storeId) return;
      beep();
      toast(`Novo pedido ${o.code} · ${ctx.storeName(o.store_id)} · ${money(o.total)}`, 'success', 8000);
      ctx.refreshBadges();
      emit('new-order', o);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
      emit('order-updated', payload.new);
      ctx.refreshBadges();
    })
    .subscribe();
}

ctx.refreshBadges = async () => {
  const el = $('[data-badge="orders"]');
  if (!el) return;
  let qy = sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
  const { count } = await qy;
  el.textContent = count || '';
  el.hidden = !count;
};

/* ---------- Loja selecionada ---------- */
const STORE_KEY = 'atual-admin-store';
function setStore(id) {
  ctx.storeId = id || null;
  ctx.store = ctx.stores.find((s) => s.id === id) || null;
  try {
    localStorage.setItem(STORE_KEY, ctx.storeId || 'network');
  } catch {
    /* sem armazenamento */
  }
  drawShell();
  subscribeOrders();
  route();
}

/* ---------- Telas de acesso ---------- */
function authScreen(mode = 'login', message = '') {
  const titles = { login: 'Entrar no painel', forgot: 'Recuperar senha', reset: 'Criar nova senha' };
  render(
    root,
    html`<div class="auth"><form class="auth__card stack" data-auth novalidate>
      <img class="auth__logo" src="/assets/brand/atual-logo-horizontal.svg" alt="Atual Móveis">
      <div><div class="auth__title">${titles[mode]}</div>
      <p class="auth__sub">${mode === 'login' ? 'Rede Atual Móveis · lojas e administração' : mode === 'forgot' ? 'Enviaremos um link para o seu e-mail.' : 'Escolha uma senha com pelo menos 8 caracteres.'}</p></div>
      ${message ? html`<div class="alert ${message.startsWith('✓') ? 'alert--success' : 'alert--danger'}">${message.replace(/^✓ /, '')}</div>` : ''}
      ${mode !== 'reset'
        ? html`<div class="field"><label for="a-email">E-mail</label><input class="input" id="a-email" name="email" type="email" autocomplete="username" required autofocus></div>`
        : ''}
      ${mode !== 'forgot'
        ? html`<div class="field"><label for="a-pass">${mode === 'reset' ? 'Nova senha' : 'Senha'}</label><input class="input" id="a-pass" name="password" type="password" autocomplete="${mode === 'reset' ? 'new-password' : 'current-password'}" required minlength="8"></div>`
        : ''}
      <button class="btn btn--primary" type="submit" style="height:42px">${mode === 'login' ? 'Entrar' : mode === 'forgot' ? 'Enviar link' : 'Salvar nova senha'}</button>
      ${mode === 'login'
        ? html`<button class="btn btn--ghost" type="button" data-mode="forgot">Esqueci minha senha</button>`
        : mode === 'forgot'
          ? html`<button class="btn btn--ghost" type="button" data-mode="login">Voltar ao login</button>`
          : ''}
    </form></div>`
  );
  const form = $('[data-auth]');
  form.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) authScreen(m.dataset.mode);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    const email = form.email?.value.trim();
    const password = form.password?.value;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : friendlyError(error));
        await boot();
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/#/reset` });
        if (error) throw error;
        authScreen('login', '✓ Se o e-mail estiver cadastrado, você receberá o link em instantes.');
      } else {
        if ((password || '').length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        history.replaceState(null, '', '#/dashboard');
        toast('Senha alterada.', 'success');
        await boot();
      }
    } catch (err) {
      authScreen(mode, friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });
}

function noAccessScreen() {
  render(
    root,
    html`<div class="auth"><div class="auth__card stack">
      <img class="auth__logo" src="/assets/brand/atual-logo-horizontal.svg" alt="Atual Móveis">
      <div class="auth__title">Sem acesso ao painel</div>
      <p class="auth__sub">Sua conta (${ctx.user?.email}) ainda não está ligada a nenhuma loja. Peça a um administrador para liberar seu acesso.</p>
      <button class="btn" type="button" data-logout>Sair</button>
    </div></div>`
  );
  $('[data-logout]').addEventListener('click', logout);
}

async function logout() {
  if (channel) sb.removeChannel(channel);
  await sb.auth.signOut();
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

function drawShell() {
  const initials = (ctx.user.full_name || ctx.user.email).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const roleLabel = ctx.isSuper ? 'Super admin' : ctx.isGlobal ? 'Admin da rede' : ROLES[ctx.roleIn(ctx.storeId)]?.label || 'Equipe';
  render(
    root,
    html`<div class="app">
      <aside class="sidebar" data-sidebar>
        <div class="sidebar__brand">
          <img src="/assets/brand/atual-logo-horizontal-white.svg" alt="Atual Móveis">
        </div>
        <div class="store-switch">
          <label class="visually-hidden" for="store-switch">Loja</label>
          <select id="store-switch" data-store-switch>
            ${ctx.isGlobal ? html`<option value="" ${!ctx.storeId ? 'selected' : ''}>Toda a rede (${ctx.stores.length} lojas)</option>` : ''}
            ${ctx.stores.map((s) => html`<option value="${s.id}" ${s.id === ctx.storeId ? 'selected' : ''}>${s.name}</option>`)}
          </select>
        </div>
        <nav class="nav" aria-label="Menu do painel">
          ${visibleNav().map((n) =>
            n.group
              ? html`<div class="nav__group">${n.group}</div>`
              : html`<a href="#/${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span>${n.badge ? html`<span class="nav__count" data-badge="orders" hidden></span>` : ''}</a>`
          )}
        </nav>
        <div class="sidebar__foot">
          <a href="${ctx.store ? `/loja/${ctx.store.slug}` : '/'}" target="_blank" rel="noopener">Ver loja virtual ↗</a>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn btn--ghost btn--icon topbar__menu" type="button" data-toggle-sidebar aria-label="Abrir menu">${icon('menu')}</button>
          <h1 class="topbar__title" data-title></h1>
          <div class="topbar__actions" data-actions></div>
          <div class="user-menu">
            <button class="user-menu__btn" type="button" data-menu="user-menu" aria-label="Menu do usuário">
              <span class="avatar">${initials}</span>
              <span class="user-menu__name small"><strong>${ctx.user.full_name || ctx.user.email}</strong><br><span class="muted">${roleLabel}</span></span>
            </button>
            <div class="menu" id="user-menu" hidden>
              <a href="#/account">${icon('account')} Minha conta</a>
              <hr>
              <button type="button" class="is-danger" data-logout>${icon('logout')} Sair</button>
            </div>
          </div>
        </header>
        <main class="content" data-view tabindex="-1"></main>
      </div>
    </div>`
  );
  $('[data-store-switch]').addEventListener('change', (e) => setStore(e.target.value));
  $('[data-logout]').addEventListener('click', logout);
  $('[data-toggle-sidebar]').addEventListener('click', () => $('[data-sidebar]').classList.toggle('is-open'));
  $('[data-sidebar]').addEventListener('click', (e) => {
    if (e.target.closest('a[data-nav]')) $('[data-sidebar]').classList.remove('is-open');
  });
  ctx.refreshBadges();
}

/* ---------- Rotas ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { id: parts[0] || 'dashboard', args: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function route() {
  if (!ctx.user) return;
  const { id, args, query } = parseHash();
  if (id === 'reset') return authScreen('reset');
  const item = NAV.find((n) => n.id === id);
  const allowed = item && visibleNav().some((n) => n.id === id);
  if (!allowed) {
    if (id !== 'dashboard') toast('Esta área não está disponível para a loja/conta selecionada.', 'warning');
    if (location.hash !== '#/dashboard') {
      location.hash = '#/dashboard';
      return;
    }
  }
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignora */
    }
  });
  cleanups = [];
  ctx.args = args;
  ctx.query = query;
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === id));
  const view = $('[data-view]');
  if (!view) return;
  const fresh = view.cloneNode(false); // remove ouvintes do módulo anterior
  view.replaceWith(fresh);
  ctx.setActions('');
  ctx.setTitle(item?.label || 'Painel');
  render(fresh, html`<div class="loading-block"><span class="spinner"></span>Carregando…</div>`);
  const token = ++renderToken;
  try {
    const mod = (await import(`./modules/${id}.js`)).default;
    if (token !== renderToken) return;
    currentModule = mod;
    if (mod.title) ctx.setTitle(mod.title, ctx.store ? ctx.store.name : ctx.isGlobal ? 'Toda a rede' : '');
    if (item?.needsStore && !ctx.storeId) {
      ctx.pickStore(fresh, 'Esta área configura uma loja específica.');
      return;
    }
    render(fresh, '');
    const cleanup = await mod.render(fresh, ctx);
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    render(
      fresh,
      html`<div class="alert alert--danger">${icon('alert')}<div><strong>Não foi possível abrir esta área.</strong><br>${
        /Failed to fetch dynamically imported module|Importing a module script failed/.test(e.message) ? 'Módulo ainda não disponível.' : friendlyError(e)
      }</div></div>`
    );
  }
}

/* ---------- Início ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return authScreen('login');
  try {
    const access = await rpc('my_access');
    if (!access) return authScreen('login');
    ctx.access = access;
    ctx.user = { id: access.user_id, email: access.email, full_name: access.full_name };
    ctx.isGlobal = !!access.is_global;
    ctx.isSuper = !!access.is_super;
    if (!access.roles.length) return noAccessScreen();
    if (ctx.isGlobal) {
      const { data: stores, error } = await sb.from('stores').select('*').order('sort_order').order('name');
      if (error) throw error;
      ctx.stores = stores;
    } else {
      const ids = access.roles.map((r) => r.store_id).filter(Boolean);
      const { data: stores, error } = await sb.from('stores').select('*').in('id', ids).order('sort_order').order('name');
      if (error) throw error;
      ctx.stores = stores;
    }
    let saved = null;
    try {
      saved = localStorage.getItem(STORE_KEY);
    } catch {
      /* sem armazenamento */
    }
    const savedStore = ctx.stores.find((s) => s.id === saved);
    if (savedStore) ctx.storeId = savedStore.id;
    else if (saved === 'network' && ctx.isGlobal) ctx.storeId = null;
    else ctx.storeId = ctx.isGlobal ? null : ctx.stores[0]?.id || null;
    ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
    drawShell();
    subscribeOrders();
    route();
  } catch (e) {
    console.error(e);
    authScreen('login', friendlyError(e));
  }
}

// Atualiza a lista de lojas (ex.: depois de criar/editar uma loja) e redesenha o menu.
ctx.reloadStores = async () => {
  const { data } = ctx.isGlobal
    ? await sb.from('stores').select('*').order('sort_order').order('name')
    : await sb.from('stores').select('*').in('id', ctx.access.roles.map((r) => r.store_id).filter(Boolean)).order('sort_order');
  ctx.stores = data || ctx.stores;
  ctx.store = ctx.stores.find((s) => s.id === ctx.storeId) || null;
  const sel = $('[data-store-switch]');
  if (sel) {
    render(
      sel,
      html`${ctx.isGlobal ? html`<option value="" ${!ctx.storeId ? 'selected' : ''}>Toda a rede (${ctx.stores.length} lojas)</option>` : ''}
      ${ctx.stores.map((s) => html`<option value="${s.id}" ${s.id === ctx.storeId ? 'selected' : ''}>${s.name}</option>`)}`
    );
  }
};

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') authScreen('reset');
  if (event === 'SIGNED_OUT') {
    ctx.user = null;
    authScreen('login');
  }
});
window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

if (location.hash.startsWith('#/reset') || /type=recovery/.test(location.hash)) {
  // o Supabase processa o token da URL e dispara PASSWORD_RECOVERY
  sb.auth.getSession().then(({ data }) => (data.session ? authScreen('reset') : authScreen('login', 'Link de recuperação inválido ou expirado.')));
} else {
  boot();
}

// exporta para depuração no console
window.__atual = { ctx, sb, toastError, esc };
