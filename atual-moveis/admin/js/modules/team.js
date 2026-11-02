// Equipe: quem acessa o painel, com qual papel e em qual loja.
// Toda escrita passa pela edge function admin-users (service role), que aplica as regras:
//   super admin → qualquer papel · admin da rede → tudo, menos super admins
//   admin da loja → apenas papéis de loja nas lojas que administra.
// A interface espelha essas regras (canManage) e mostra os erros do servidor de forma amigável.
// Desenho "Casa Atual": abas de situação, filtros com selects personalizados, lista agrupada por loja
// (na visão da rede), cartões no celular, convite com prévia das permissões e senha exibida uma única vez.
import { fn } from '../api.js';
import {
  html,
  raw,
  render,
  $,
  $$,
  esc,
  icon,
  toast,
  toastError,
  readForm,
  showErrors,
  withBusy,
  empty,
  errorBlock,
  skeleton,
  injectStyle,
  debounce,
  relTime,
  datetime,
  date,
  num,
  fold,
  highlight,
  openModal,
  confirmDialog,
  badge,
  avatar,
  storeMark,
  tip,
  pushLayer,
  popLayer,
  ROLES,
} from '../ui.js';

const STORE_ROLES = ['store_admin', 'store_manager', 'store_editor', 'store_operator'];
const NETWORK_ROLES = ['super_admin', 'network_admin'];
const ROLE_ORDER = [...NETWORK_ROLES, ...STORE_ROLES];
// tom do selo / ponto / avatar de cada papel
const ROLE_TONE = { super_admin: 'dark', network_admin: 'accent', store_admin: 'info', store_manager: 'success', store_editor: 'plum', store_operator: '' };
const ROLE_DOT = { super_admin: 'neu', network_admin: 'ora', store_admin: 'info', store_manager: 'ok', store_editor: 'plum', store_operator: 'neu' };
const ROLE_AVATAR = { super_admin: 'navy', network_admin: 'ora', store_admin: 'info', store_manager: 'ok', store_editor: 'plum', store_operator: '' };
const ROLE_ICON = { super_admin: 'key', network_admin: 'network', store_admin: 'store', store_manager: 'sliders', store_editor: 'products', store_operator: 'orders' };
// Permissões por papel (espelho de app.js / has_perm no banco)
const PERMS = {
  view: ['store_admin', 'store_manager', 'store_editor', 'store_operator'],
  catalog: ['store_admin', 'store_manager', 'store_editor'],
  orders: ['store_admin', 'store_manager', 'store_operator'],
  customers: ['store_admin', 'store_manager', 'store_operator'],
  coupons: ['store_admin', 'store_manager'],
  settings: ['store_admin'],
  staff: ['store_admin'],
};
const AREAS = [
  ['dashboard', 'Painel e vendas', 'view'],
  ['orders', 'Pedidos', 'orders'],
  ['customers', 'Clientes', 'customers'],
  ['reports', 'Relatórios', 'orders'],
  ['products', 'Produtos e vitrine', 'catalog'],
  ['coupons', 'Cupons', 'coupons'],
  ['store', 'Dados da loja', 'settings'],
  ['team', 'Equipe da loja', 'staff'],
  ['audit', 'Auditoria', 'settings'],
];
const roleCan = (role, perm) => NETWORK_ROLES.includes(role) || (PERMS[perm] || []).includes(role);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TABS = [
  ['', 'Todos', ''],
  ['active', 'Ativos', 'ok'],
  ['inactive', 'Desativados', 'neu'],
  ['never', 'Nunca entraram', 'warn'],
];

const roleLabel = (role) => ROLES[role]?.label || role;
const roleBadge = (role) =>
  role === 'super_admin' ? html`<span class="badge tm-super">${roleLabel(role)}</span>` : badge(roleLabel(role), ROLE_TONE[role] || '');
const personName = (r) => r.full_name || r.email || 'Sem nome';
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

// Mensagens do Supabase Auth que podem vazar pela edge function → português
function teamError(e) {
  const msg = e instanceof Error ? e.message : String(e || '');
  if (/already (been )?registered|already exists/i.test(msg)) return new Error('Este e-mail já tem uma conta. Tente de novo em instantes ou fale com o suporte.');
  if (/password/i.test(msg) && /should|weak|least|characters/i.test(msg)) return new Error('Senha fraca: use pelo menos 8 caracteres, misturando letras e números.');
  if (/invalid email|unable to validate email/i.test(msg)) return new Error('E-mail inválido.');
  if (/Failed to send a request|Failed to fetch|NetworkError/i.test(msg)) return new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
  if (/non-2xx|FunctionsHttpError|status code/i.test(msg)) return new Error('O servidor da equipe não respondeu como esperado. Tente de novo em instantes.');
  return e instanceof Error ? e : new Error(msg || 'Erro inesperado.');
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!input) return false;
    input.focus();
    input.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

// Lista do que o papel libera (prévia no convite/alteração e no quadro "Papéis e permissões")
function permRows(role, nStores) {
  if (NETWORK_ROLES.includes(role)) {
    const rows = [
      { ico: 'houses', label: `Tudo das ${num(nStores)} lojas`, on: true },
      { ico: 'team', label: 'Equipe de todas as lojas', on: true },
      { ico: 'categories', label: 'Categorias', on: true },
      { ico: 'network', label: 'Configurações da rede', on: true },
    ];
    rows.push({ ico: 'key', label: 'Outros super admins', on: role === 'super_admin' });
    return rows;
  }
  return AREAS.map(([ico, label, perm]) => ({ ico, label, on: roleCan(role, perm) }));
}
function permList(role, { compact = false, nStores = 13 } = {}) {
  if (!role) return html`<p class="tm-perm__none">Escolha um papel para ver o que a pessoa poderá fazer.</p>`;
  const rows = permRows(role, nStores);
  return html`<ul class="tm-perm ${compact ? 'tm-perm--chips' : ''}">${rows.map(
    (r) => html`<li class="${r.on ? 'is-on' : 'is-off'}">${icon(r.ico, 'icon-sm')}<span class="tm-perm__l">${r.label}</span>${
      r.on
        ? html`<span class="tm-perm__st" aria-hidden="true">${icon('check', 'icon-xs')}</span>`
        : html`<span class="tm-perm__st" aria-hidden="true">${icon('lock', 'icon-xs')}</span><span class="visually-hidden">(sem acesso)</span>`
    }</li>`
  )}</ul>`;
}

export default {
  title: 'Equipe',
  async render(view, ctx) {
    injectStyle('team', CSS);
    if (!ctx.can('staff')) {
      render(
        view,
        html`<div class="card">${empty(
          'Esta área é do administrador da loja',
          'Você não tem permissão para gerenciar a equipe desta loja.',
          html`<a class="btn" href="#/dashboard">Voltar ao Painel</a>`,
          { art: 'no-access' }
        )}</div>`
      );
      return;
    }

    const networkView = !ctx.storeId; // só administradores da rede chegam aqui sem loja
    const q0 = ctx.query || {};
    const state = {
      search: q0.q || '',
      role: ROLE_ORDER.includes(q0.role) ? q0.role : '',
      store: '',
      status: TABS.some(([k]) => k && k === q0.status) ? q0.status : '',
    };
    let rows = [];
    let loaded = false;
    let menu = null; // { el, btn, row }
    let pendingDraw = false; // dados novos chegaram com o menu aberto: redesenha ao fechar
    let highlightId = null;
    let loadToken = 0;
    const busy = new Set(); // acessos com uma ação em andamento
    const where = ctx.store ? ctx.storeShort?.(ctx.store) || ctx.store.name : 'Toda a rede';

    /* ---------- Regras (espelho da edge function) ---------- */
    const canManage = (role, storeId) => {
      if (ctx.isSuper) return true;
      if (ctx.isGlobal) return role !== 'super_admin';
      return STORE_ROLES.includes(role) && !!storeId && ctx.roleIn(storeId) === 'store_admin';
    };
    const grantable = () => [...STORE_ROLES, ...(ctx.isGlobal ? ['network_admin'] : []), ...(ctx.isSuper ? ['super_admin'] : [])].filter((r) => ROLES[r]);
    const storeOf = (id) => ctx.stores.find((s) => s.id === id) || null;
    const shortName = (id) => {
      const s = storeOf(id);
      return s ? ctx.storeShort?.(s) || s.name : 'Loja';
    };
    const storeLabel = (id) => (id ? ctx.storeName(id) : 'Toda a rede');
    const activeSupers = () => rows.filter((r) => r.role === 'super_admin' && r.active).length;
    const isLastSuper = (r) => r.role === 'super_admin' && r.active && activeSupers() <= 1;
    const storeIndex = (id) => {
      const i = ctx.stores.findIndex((s) => s.id === id);
      return i < 0 ? 999 : i;
    };
    const isNever = (r) => !r.last_sign_in_at;
    const netMark = (size = 24) =>
      html`<span class="smark smark--net" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${icon('houses', 'icon-xs')}</span>`;

    /* ---------- Ações no topo ---------- */
    ctx.setActions(
      html`<button class="btn" type="button" data-team-roles>${icon('key')}<span class="tm-lg">Papéis e permissões</span><span class="tm-sm">Permissões</span></button>
        <button class="btn btn--primary" type="button" data-team-add>${icon('plus')}<span>Adicionar pessoa</span></button>`
    );
    $('[data-team-add]')?.addEventListener('click', () => addPerson());
    $('[data-team-roles]')?.addEventListener('click', () => showRoles());

    const roleOptions = ROLE_ORDER.filter((r) => networkView || STORE_ROLES.includes(r));
    render(
      view,
      html`<div class="tm">
        <div data-tip></div>
        <section class="card tm-card" aria-label="Pessoas com acesso ao painel">
          <div class="tabs tm-tabs" role="tablist" aria-label="Situação do acesso" data-tabs hidden></div>
          <form class="toolbar tm-tb" role="search" data-filters novalidate>
            <div class="search tm-tb__search">
              ${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="tm-search">Buscar por nome ou e-mail</label>
              <input class="input" id="tm-search" type="search" placeholder="Buscar por nome ou e-mail" autocomplete="off" enterkeyhint="search" value="${state.search}" data-search>
            </div>
            <div class="tm-tb__f">
              <label class="visually-hidden" for="tm-role">Papel</label>
              <select class="select" id="tm-role" data-filter="role" data-prefix="Papel" data-sheet-title="Papel">
                <option value="" data-hint="Todos os papéis">Todos</option>
                ${roleOptions.map((r) => html`<option value="${r}" data-dot="${ROLE_DOT[r]}" data-hint="${ROLES[r]?.desc || ''}" ${state.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`)}
              </select>
            </div>
            ${networkView
              ? html`<div class="tm-tb__f">
                  <label class="visually-hidden" for="tm-store">Loja</label>
                  <select class="select" id="tm-store" data-filter="store" data-prefix="Loja" data-sheet-title="Loja" data-search-placeholder="Buscar loja ou cidade…">
                    <option value="" data-icon="layers" data-hint="Rede e todas as lojas">Todas</option>
                    <option value="network" data-mark="network" data-hint="Super admins e administradores da rede">Só papéis da rede</option>
                    <optgroup label="Lojas" data-count="${ctx.stores.length}">${ctx.stores.map(
                      (s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${[s.brand_name, s.city].filter(Boolean).join(' · ')}" data-keywords="${s.name}">${ctx.storeShort?.(s) || s.name}</option>`
                    )}</optgroup>
                  </select>
                </div>`
              : ''}
            <button class="btn btn--ghost btn--sm" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
            <span class="toolbar__spacer"></span>
            <span class="tm-tb__sum" data-sum aria-live="polite"></span>
          </form>
          <div class="tm-results" id="tm-panel" role="tabpanel" data-list>${skeleton('list', { rows: 6 })}</div>
          ${!networkView && ctx.isGlobal
            ? html`<p class="tm-note">${icon('info', 'icon-sm')}<span>Administradores da rede também acessam ${where} e não aparecem nesta lista.</span>
                <button class="btn btn--ghost btn--sm" type="button" data-net-team>Ver equipe da rede ${icon('arrowRight', 'icon-sm')}</button></p>`
            : ''}
        </section>
      </div>`
    );
    const listEl = $('[data-list]', view);
    const tabsEl = $('[data-tabs]', view);
    const searchInput = $('[data-search]', view);

    /* ---------- Dados ---------- */
    const sortRows = () =>
      rows.sort((a, b) => {
        const sa = a.store_id ? 1 : 0;
        const sb = b.store_id ? 1 : 0;
        if (sa !== sb) return sa - sb;
        if (a.store_id !== b.store_id) return storeIndex(a.store_id) - storeIndex(b.store_id);
        const ra = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (ra) return ra;
        return fold(personName(a)).localeCompare(fold(personName(b)));
      });

    // Recarrega do servidor. Em segundo plano (background) a lista atual continua na tela.
    async function load({ background = false } = {}) {
      const my = ++loadToken;
      try {
        const res = await fn('admin-users', { action: 'list', store_id: ctx.storeId || undefined });
        if (my !== loadToken || !view.isConnected) return;
        rows = (res?.rows || []).slice();
        loaded = true;
        sortRows();
        // não fecha um menu que a pessoa acabou de abrir só porque a lista foi atualizada
        if (background && menu) pendingDraw = true;
        else draw();
        drawTip();
      } catch (e) {
        if (my !== loadToken || !view.isConnected) return;
        if (background) return toastError(teamError(e));
        tabsEl.hidden = true;
        render(
          listEl,
          errorBlock(teamError(e), {
            title: 'Não foi possível carregar a equipe',
            retry: () => {
              render(listEl, skeleton('list', { rows: 6 }));
              load();
            },
          })
        );
        $('[data-sum]', view).textContent = '';
      }
    }

    // filtros sem a aba de situação (as contagens das abas usam esta base)
    function base() {
      const term = fold(state.search.trim());
      return rows.filter((r) => {
        if (term && !fold(`${r.full_name || ''} ${r.email || ''}`).includes(term)) return false;
        if (state.role && r.role !== state.role) return false;
        if (state.store === 'network' && r.store_id) return false;
        if (state.store && state.store !== 'network' && r.store_id !== state.store) return false;
        return true;
      });
    }
    const matchTab = (r, tab) => !tab || (tab === 'active' ? r.active : tab === 'inactive' ? !r.active : isNever(r));
    const filtered = () => base().filter((r) => matchTab(r, state.status));
    const hasFilters = () => !!(state.search.trim() || state.role || state.store || state.status);

    function drawTabs() {
      const b = base();
      const hadFocus = tabsEl.contains(document.activeElement);
      tabsEl.hidden = !rows.length;
      render(
        tabsEl,
        TABS.map(([k, label, dot]) => {
          const n = b.filter((r) => matchTab(r, k)).length;
          const on = state.status === k;
          return html`<button class="tab" type="button" role="tab" id="tm-tab-${k || 'all'}" aria-selected="${on}" aria-controls="tm-panel" tabindex="${on ? 0 : -1}" data-tab="${k}">${
            dot ? html`<span class="dot dot--sm t-${dot}" aria-hidden="true"></span>` : ''
          }${label}<span class="tab__n ${k === 'never' && n ? 'tab__n--warn' : ''}">${num(n)}</span></button>`;
        })
      );
      if (hadFocus) $('[aria-selected="true"]', tabsEl)?.focus({ preventScroll: true });
      listEl.setAttribute('aria-labelledby', `tm-tab-${state.status || 'all'}`);
    }

    function drawTip() {
      const box = $('[data-tip]', view);
      if (!box) return;
      const never = rows.filter((r) => r.active && isNever(r) && r.user_id !== ctx.user.id);
      const people = new Set(never.map((r) => r.user_id)).size;
      render(
        box,
        people
          ? tip({
              id: `team-never-${ctx.storeId || 'rede'}`,
              text: `${plural(people, 'pessoa', 'pessoas')} da equipe ${people === 1 ? 'ainda não entrou' : 'ainda não entraram'} no painel. Gere uma senha nova e envie os dados de acesso para começar a usar.`,
              action: { label: people === 1 ? 'Ver quem nunca entrou' : `Ver as ${people}`, onClick: () => setTab('never') },
            })
          : ''
      );
    }

    const personCell = (r, term) => {
      const manageable = canManage(r.role, r.store_id) && !isLastSuper(r) && !busy.has(r.id);
      const self = r.user_id === ctx.user.id;
      const name = highlight(personName(r), term);
      return html`<div class="tm-person">
        ${avatar(personName(r), { size: 36, self, tone: self ? '' : ROLE_AVATAR[r.role] || '' })}
        <span class="tm-person__txt">
          <span class="tm-person__l1">${
            manageable
              ? html`<button class="tm-name" type="button" data-edit="${r.id}" title="Alterar papel">${name}</button>`
              : html`<span class="tm-name tm-name--ro">${name}</span>`
          }${self ? html`<span class="tag tm-you">Você</span>` : ''}</span>
          <span class="tm-email">${r.email ? highlight(r.email, term) : '—'}</span>
        </span>
      </div>`;
    };
    const lastCell = (r) =>
      r.last_sign_in_at
        ? html`<span class="tm-last" title="${datetime(r.last_sign_in_at)}">${relTime(r.last_sign_in_at)}</span>`
        : html`<span class="tm-last tm-last--never">${icon('clock', 'icon-xs')} Nunca entrou</span>`;
    const actCell = (r) =>
      busy.has(r.id)
        ? html`<span class="btn btn--ghost btn--sm btn--icon" role="status" aria-label="Salvando alteração"><span class="spinner spinner--sm" aria-hidden="true"></span></span>`
        : html`<button class="btn btn--ghost btn--sm btn--icon tm-dots" type="button" data-row-menu="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Ações para ${personName(r)} (${storeLabel(r.store_id)})">${icon('dots')}</button>`;

    function rowHtml(r, term) {
      return html`<tr class="tm-row ${r.active ? '' : 'is-off'} ${r.id === highlightId ? 'is-selected tm-flash' : ''}" data-id="${r.id}">
        <td class="tm-c-person">${personCell(r, term)}</td>
        <td class="tm-c-role">${roleBadge(r.role)}</td>
        <td class="tm-c-status">${r.active ? badge('Ativo', 'success') : badge('Desativado')}</td>
        <td class="tm-c-last"><span class="tm-mlabel">Último acesso</span>${lastCell(r)}</td>
        <td class="tm-c-since"><span class="tm-mlabel">Desde</span>${r.created_at ? html`<span title="${datetime(r.created_at)}">${date(r.created_at)}</span>` : '—'}</td>
        <td class="tm-c-act">${actCell(r)}</td>
      </tr>`;
    }

    function groupsOf(list) {
      if (!networkView) return [{ key: 'store', rows: list }];
      const out = [];
      list.forEach((r) => {
        const key = r.store_id || 'network';
        let g = out.find((x) => x.key === key);
        if (!g) out.push((g = { key, rows: [] }));
        g.rows.push(r);
      });
      return out;
    }
    const groupHead = (g) => {
      const people = new Set(g.rows.map((r) => r.user_id)).size;
      const s = g.key === 'network' ? null : storeOf(g.key);
      return html`<tr class="tm-ghead"><th colspan="6" scope="rowgroup"><span class="tm-ghead__in">${
        g.key === 'network' ? netMark(24) : s ? storeMark(s, 24) : netMark(24)
      }<span class="tm-ghead__name">${g.key === 'network' ? 'Toda a rede' : shortName(g.key)}</span>${
        g.key === 'network'
          ? html`<span class="tm-ghead__hint">Acesso a todas as ${num(ctx.stores.length)} lojas</span>`
          : s
            ? html`<span class="tm-ghead__hint">${[s.brand_name, s.city].filter(Boolean).join(' · ')}</span>`
            : ''
      }<span class="tm-ghead__n">${plural(people, 'pessoa', 'pessoas')}</span>${
        s && !s.active ? html`<span class="badge">Inativa</span>` : ''
      }</span></th></tr>`;
    };

    function draw() {
      closeMenu();
      const list = filtered();
      const people = new Set(rows.map((r) => r.user_id)).size;
      const countEl = $('[data-sum]', view);
      render(
        countEl,
        rows.length
          ? list.length === rows.length
            ? html`<b>${plural(people, 'pessoa', 'pessoas')}</b> · ${plural(rows.length, 'acesso', 'acessos')}`
            : html`<b>${num(list.length)}</b> de ${plural(rows.length, 'acesso', 'acessos')}`
          : ''
      );
      $('[data-clear]', view).hidden = !hasFilters();
      drawTabs();
      if (!rows.length) {
        render(
          listEl,
          empty(
            networkView ? 'Ninguém na equipe ainda' : `Ninguém na equipe de ${where} ainda`,
            'Adicione quem vai cuidar do catálogo, dos pedidos e do atendimento. Cada pessoa entra com o próprio e-mail.',
            html`<button class="btn btn--primary" type="button" data-empty-add>${icon('plus', 'icon-sm')} Adicionar pessoa</button>`,
            { art: 'empty-box' }
          )
        );
        return;
      }
      if (!list.length) {
        const term = state.search.trim();
        const tabTxt = { active: ' ativo', inactive: ' desativado', never: ' que nunca entrou' }[state.status] || '';
        render(
          listEl,
          empty(
            'Nenhum acesso encontrado',
            term ? `Ninguém${tabTxt} com “${term}” no nome ou no e-mail. Confira a grafia ou limpe os filtros.` : `Nenhum acesso${tabTxt} com estes filtros.`,
            html`<button class="btn" type="button" data-clear-all>${icon('close', 'icon-sm')} Limpar filtros</button>`,
            { art: 'site:empty-search' }
          )
        );
        return;
      }
      const term = state.search.trim();
      render(
        listEl,
        html`<div class="table-wrap tm-tw"><table class="table tm-table">
          <caption class="visually-hidden">Pessoas com acesso ${networkView ? 'à rede, agrupadas por loja' : `a ${where}`}</caption>
          <thead><tr>
            <th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col">Situação</th><th scope="col">Último acesso</th>
            <th scope="col" class="tm-c-since">Desde</th><th scope="col" class="tm-c-act"><span class="visually-hidden">Ações</span></th>
          </tr></thead>
          ${groupsOf(list).map((g) => html`<tbody class="tm-group">${networkView ? groupHead(g) : ''}${g.rows.map((r) => rowHtml(r, term))}</tbody>`)}
        </table></div>`
      );
    }

    /* ---------- Abas ---------- */
    function setTab(k) {
      state.status = k;
      draw();
      listEl.scrollIntoView?.({ block: 'nearest' });
    }
    tabsEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) setTab(t.dataset.tab);
    });
    tabsEl.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const tabs = $$('[data-tab]', tabsEl);
      const i = tabs.indexOf(document.activeElement);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[n].dataset.tab);
      $('[aria-selected="true"]', tabsEl)?.focus();
    });

    /* ---------- Menu de ações por linha ---------- */
    function actionsFor(r) {
      const self = r.user_id === ctx.user.id;
      const manage = canManage(r.role, r.store_id);
      const lastSuper = isLastSuper(r);
      const why = !manage
        ? r.role === 'super_admin'
          ? 'Somente um super admin pode alterar outro super admin.'
          : NETWORK_ROLES.includes(r.role)
            ? 'Somente a administração da rede altera papéis da rede.'
            : 'Você não administra a equipe desta loja.'
        : lastSuper
          ? 'A rede precisa de pelo menos um super admin ativo.'
          : '';
      const sameUser = rows.filter((x) => x.user_id === r.user_id);
      const canReset = !self && sameUser.every((m) => canManage(m.role, m.store_id));
      return {
        why,
        items: [
          { id: 'role', label: 'Alterar papel', icon: 'edit', disabled: !manage || lastSuper },
          r.active
            ? { id: 'toggle', label: 'Desativar acesso', icon: 'pause', disabled: !manage || lastSuper }
            : { id: 'toggle', label: 'Reativar acesso', icon: 'refresh', disabled: !manage },
          self ? { id: 'account', label: 'Trocar minha senha', icon: 'key' } : { id: 'reset', label: 'Gerar senha nova', icon: 'key', disabled: !canReset },
          ...(r.email ? [{ id: 'copy', label: 'Copiar e-mail', icon: 'copy' }] : []),
          { sep: true },
          { id: 'remove', label: 'Remover acesso', icon: 'trash', danger: true, disabled: !manage || lastSuper },
        ],
      };
    }

    function closeMenu(returnFocus = false) {
      if (!menu) return;
      const { el, btn } = menu;
      menu = null;
      popLayer(el);
      el.remove();
      btn.setAttribute('aria-expanded', 'false');
      if (pendingDraw) {
        pendingDraw = false;
        draw();
        if (returnFocus) $(`[data-row-menu="${window.CSS.escape(btn.dataset.rowMenu)}"]`, view)?.focus();
        return;
      }
      if (returnFocus && btn.isConnected) btn.focus();
    }

    // posiciona o menu junto ao botão (abre para cima se faltar espaço embaixo)
    function placeMenu() {
      if (!menu) return;
      const { el, btn } = menu;
      const rect = btn.getBoundingClientRect();
      const topLimit = $('.topbar')?.getBoundingClientRect().bottom || 0; // botão escondido sob a barra fixa
      if (!btn.isConnected || rect.bottom < topLimit || rect.top > window.innerHeight) return closeMenu();
      const mw = el.offsetWidth;
      const mh = el.offsetHeight;
      const left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.right - mw));
      let top = rect.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }

    function openMenu(btn) {
      const r = rows.find((x) => x.id === btn.dataset.rowMenu);
      if (!r || busy.has(r.id)) return;
      if (menu?.btn === btn) return closeMenu(true);
      closeMenu();
      const { items, why } = actionsFor(r);
      const el = document.createElement('div');
      el.className = 'menu tm-menu';
      el.setAttribute('role', 'menu');
      el.setAttribute('aria-label', `Ações para ${personName(r)}`);
      render(
        el,
        html`<div class="tm-menu__head">${avatar(personName(r), { size: 28, self: r.user_id === ctx.user.id, tone: ROLE_AVATAR[r.role] || '' })}<div><strong>${personName(r)}</strong><span>${roleLabel(r.role)} · ${
          r.store_id ? shortName(r.store_id) : 'Toda a rede'
        }</span></div></div><hr>${items.map((a) =>
          a.sep
            ? html`<hr>`
            : html`<button type="button" role="menuitem" data-act="${a.id}" class="${a.danger ? 'is-danger' : ''}" ${a.disabled ? 'disabled' : ''}>${icon(a.icon, 'icon-sm')} ${a.label}</button>`
        )}${why ? html`<p class="tm-menu__why">${icon('lock', 'icon-xs')}<span>${why}</span></p>` : ''}`
      );
      document.body.appendChild(el);
      menu = { el, btn, row: r };
      pushLayer(el, { onEscape: () => closeMenu(true) });
      btn.setAttribute('aria-expanded', 'true');
      placeMenu();
      $('button:not([disabled])', el)?.focus({ preventScroll: true });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const row = menu.row;
        closeMenu(b.dataset.act === 'copy');
        runAction(b.dataset.act, row);
      });
      el.addEventListener('keydown', (e) => {
        const list = $$('button:not([disabled])', el);
        const i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          list[(i + 1) % list.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          list[(i - 1 + list.length) % list.length]?.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeMenu(true);
        } else if (e.key === 'Tab') {
          closeMenu();
        }
      });
    }

    const onDocClick = (e) => {
      if (!menu) return;
      if (menu.el.contains(e.target) || menu.btn.contains(e.target)) return;
      closeMenu();
    };
    // rolar a página acompanha o menu (fechar na rolagem atrapalhava no celular)
    const onScroll = () => placeMenu();
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    ctx.onCleanup(() => {
      closeMenu();
      document.removeEventListener('click', onDocClick, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    });

    /* ---------- Eventos da lista e dos filtros ---------- */
    function clearFilters() {
      Object.assign(state, { search: '', role: '', store: '', status: '' });
      searchInput.value = '';
      $$('[data-filter]', view).forEach((s) => (s.value = ''));
      draw();
    }
    view.addEventListener('click', (e) => {
      const m = e.target.closest('[data-row-menu]');
      if (m) return openMenu(m);
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const r = rows.find((x) => x.id === ed.dataset.edit);
        if (r && !busy.has(r.id)) changeRole(r);
        return;
      }
      if (e.target.closest('[data-empty-add]')) return addPerson();
      if (e.target.closest('[data-clear], [data-clear-all]')) {
        clearFilters();
        searchInput.focus();
        return;
      }
      if (e.target.closest('[data-net-team]')) ctx.setStore(null, '#/team');
    });
    const onSearch = debounce(() => draw(), 160);
    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      onSearch();
    });
    $('[data-filters]', view).addEventListener('submit', (e) => e.preventDefault());
    $$('[data-filter]', view).forEach((sel) =>
      sel.addEventListener('change', () => {
        state[sel.dataset.filter] = sel.value;
        if (loaded) draw();
      })
    );

    // Aplica na tela o resultado de uma ação que deu certo e confirma com o servidor em segundo plano.
    function applyChange(r, { patch, remove, message }) {
      if (remove) rows = rows.filter((x) => x.id !== r.id);
      else if (patch) {
        const cur = rows.find((x) => x.id === r.id);
        if (cur) Object.assign(cur, patch);
        sortRows();
      }
      draw();
      drawTip();
      toast(message, 'success');
      if (r.user_id === ctx.user.id) {
        toast('Seu próprio acesso mudou. Recarregando o painel…', 'info');
        setTimeout(() => location.reload(), 1400);
        return;
      }
      load({ background: true });
    }

    // Executa uma ação da edge function travando a linha enquanto roda.
    async function rowTask(r, task) {
      busy.add(r.id);
      draw();
      try {
        return await task();
      } finally {
        busy.delete(r.id);
        if (view.isConnected) draw();
      }
    }

    function runAction(act, r) {
      if (act === 'role') return changeRole(r);
      if (act === 'toggle') return toggleActive(r);
      if (act === 'reset') return resetPassword(r);
      if (act === 'account') return ctx.navigate('#/account');
      if (act === 'remove') return removeAccess(r);
      if (act === 'copy')
        return copyText(r.email).then((ok) => toast(ok ? `E-mail de ${personName(r)} copiado` : 'Não foi possível copiar. Selecione e copie manualmente.', ok ? 'success' : 'warning', 2400));
    }

    /* ---------- Papel: select personalizado + prévia das permissões ---------- */
    function roleSelect(id, roles, selected) {
      const store = roles.filter((r) => STORE_ROLES.includes(r));
      const net = roles.filter((r) => NETWORK_ROLES.includes(r));
      const opt = (r) => html`<option value="${r}" data-dot="${ROLE_DOT[r]}" data-hint="${ROLES[r]?.desc || ''}" ${r === selected ? 'selected' : ''}>${roleLabel(r)}</option>`;
      return html`<select class="select" id="${id}" name="role" required data-placeholder="Escolha o papel" data-sheet-title="Papel" data-search="false">
        <option value="" hidden disabled ${selected ? '' : 'selected'}>Escolha o papel</option>
        ${store.length && net.length ? html`<optgroup label="Na loja">${store.map(opt)}</optgroup><optgroup label="Em toda a rede">${net.map(opt)}</optgroup>` : [...store, ...net].map(opt)}
      </select>`;
    }
    const permBox = (role, scope, compact = false) =>
      html`<div class="tm-permbox__head"><span class="overline">O que pode fazer</span>${
        role ? html`<strong class="tm-permbox__t">${roleLabel(role)}</strong>` : ''
      }${role && scope ? html`<span class="tm-permbox__scope">${scope}</span>` : ''}</div>${permList(role, { compact, nStores: ctx.stores.length })}`;

    /* ---------- Quadro "Papéis e permissões" ---------- */
    function showRoles() {
      const roleCard = (r) => {
        const n = rows.filter((x) => x.role === r && x.active).length;
        return html`<section class="tm-role" aria-labelledby="tm-role-${r}">
          <div class="tm-role__head"><span class="avatar tm-role__ico ${ROLE_AVATAR[r] ? `avatar--${ROLE_AVATAR[r]}` : ''}" aria-hidden="true">${icon(ROLE_ICON[r] || 'team', 'icon-sm')}</span>
            <div><h3 id="tm-role-${r}">${roleLabel(r)}</h3><p>${ROLES[r]?.desc || ''}</p></div>
            ${n ? html`<span class="tm-role__n">${plural(n, 'ativo', 'ativos')}</span>` : ''}</div>
          ${permList(r, { compact: true, nStores: ctx.stores.length })}
        </section>`;
      };
      const showNet = networkView || ctx.isGlobal;
      openModal({
        title: 'Papéis e permissões',
        size: 'lg',
        cls: 'tm-modal',
        body: html`<p class="tm-roles__lede">Cada pessoa recebe um papel em cada loja onde trabalha. ${showNet ? `Papéis da rede valem para as ${num(ctx.stores.length)} lojas.` : ''}</p>
          <h3 class="tm-roles__g">Na loja</h3>
          <div class="tm-roles">${STORE_ROLES.map(roleCard)}</div>
          ${showNet ? html`<h3 class="tm-roles__g">Em toda a rede</h3><div class="tm-roles">${NETWORK_ROLES.map(roleCard)}</div>` : ''}`,
        actions: html`<button class="btn btn--primary" type="button" data-close>Entendi</button>`,
      });
    }

    /* ---------- Adicionar pessoa ---------- */
    function addPerson() {
      const roles = grantable();
      const scopeStore = (id) => {
        const s = storeOf(id);
        return s ? html`${storeMark(s, 20)} ${ctx.storeShort?.(s) || s.name}` : '';
      };
      openModal({
        title: 'Adicionar pessoa',
        size: 'lg',
        cls: 'tm-modal',
        body: html`<form class="tm-add" id="tm-add-form" data-add-form novalidate>
          <div class="tm-add__main">
            <fieldset class="tm-sec">
              <legend class="tm-sec__t">Quem é</legend>
              <div class="form-grid">
                <div class="field col-6">
                  <label for="tm-f-name">Nome completo *</label>
                  <input class="input" id="tm-f-name" name="full_name" required autocomplete="off" maxlength="120" placeholder="Ex.: Ana Paula Ribeiro" autofocus>
                </div>
                <div class="field col-6">
                  <label for="tm-f-email">E-mail *</label>
                  <input class="input" id="tm-f-email" name="email" type="email" required autocomplete="off" inputmode="email" placeholder="nome@exemplo.com" spellcheck="false">
                  <span class="hint">É o login da pessoa no painel.</span>
                </div>
              </div>
            </fieldset>
            <fieldset class="tm-sec">
              <legend class="tm-sec__t">Acesso</legend>
              <div class="form-grid">
                <div class="field col-6">
                  <label for="tm-f-role">Papel *</label>
                  ${roleSelect('tm-f-role', roles, '')}
                </div>
                <div class="field col-6" data-scope>
                  ${networkView
                    ? html`<label for="tm-f-store">Loja *</label>
                      <select class="select" id="tm-f-store" name="store_id" required data-placeholder="Escolha a loja" data-sheet-title="Loja" data-search-placeholder="Buscar loja ou cidade…">
                        <option value="" hidden disabled selected>Escolha a loja</option>
                        ${ctx.stores.map(
                          (s) =>
                            html`<option value="${s.id}" data-mark="${s.id}" data-hint="${[s.brand_name, s.city].filter(Boolean).join(' · ')}" data-keywords="${s.name}" ${
                              s.active ? '' : raw('data-badge="Inativa" data-badge-tone="neu"')
                            }>${ctx.storeShort?.(s) || s.name}</option>`
                        )}
                      </select>
                      <span class="hint">Papéis de loja valem só para a loja escolhida.</span>`
                    : html`<span class="label">Loja</span>
                      <div class="tm-fixed">${scopeStore(ctx.storeId)}${icon('lock', 'icon-xs')}</div>
                      <span class="hint">O acesso vale só para esta loja.</span>`}
                </div>
                <div class="field col-6" data-scope-network hidden>
                  <span class="label">Abrangência</span>
                  <div class="tm-fixed">${netMark(20)} Toda a rede${icon('lock', 'icon-xs')}</div>
                  <span class="hint">Acesso a todas as ${num(ctx.stores.length)} lojas.</span>
                </div>
              </div>
            </fieldset>
            <fieldset class="tm-sec">
              <legend class="tm-sec__t">Senha inicial <span class="opt-tag">opcional</span></legend>
              <div class="field">
                <label class="visually-hidden" for="tm-f-pass">Senha inicial</label>
                <div class="tm-pass">
                  <input class="input" id="tm-f-pass" name="password" type="password" autocomplete="new-password" minlength="8" spellcheck="false" placeholder="Deixe em branco para gerar uma senha segura">
                  <button class="btn btn--ghost btn--icon btn--sm tm-pass__eye" type="button" data-toggle-pass aria-label="Mostrar senha" aria-pressed="false">${icon('eye', 'icon-sm')}</button>
                </div>
                <span class="hint">Mínimo de 8 caracteres. A senha aparece uma única vez, logo depois de adicionar.</span>
              </div>
            </fieldset>
            <p class="tm-callout">${icon('info', 'icon-sm')}<span>Se o e-mail já tiver conta no painel, a pessoa ganha este acesso e continua entrando com a senha que já usa.</span></p>
          </div>
          <aside class="tm-permbox" data-perm aria-live="polite">${permBox('', '')}</aside>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="submit" form="tm-add-form" data-save>${icon('plus', 'icon-sm')} Adicionar pessoa</button>`,
        onMount(el, close) {
          const form = $('[data-add-form]', el);
          const syncScope = () => {
            const role = form.elements.role.value;
            const isNet = NETWORK_ROLES.includes(role);
            $('[data-scope]', el).hidden = isNet;
            $('[data-scope-network]', el).hidden = !isNet;
            const sel = form.elements.store_id;
            if (sel) sel.disabled = isNet;
            const storeId = isNet ? null : networkView ? sel?.value : ctx.storeId;
            const scope = isNet ? html`${netMark(18)} Toda a rede` : storeId ? scopeStore(storeId) : '';
            render($('[data-perm]', el), permBox(role, role ? scope : ''));
          };
          // limpa o erro do campo assim que a pessoa corrige
          const clearError = (e) => {
            const name = e.target.name;
            if (!name) return;
            e.target.removeAttribute('aria-invalid');
            $$(`.error[data-for="${name}"]`, form).forEach((n) => n.remove());
          };
          form.addEventListener('input', clearError);
          form.addEventListener('change', (e) => {
            clearError(e);
            if (e.target.name === 'role' || e.target.name === 'store_id') syncScope();
          });
          $('[data-toggle-pass]', el).addEventListener('click', (e) => {
            const b = e.currentTarget;
            const input = form.elements.password;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            b.setAttribute('aria-pressed', String(show));
            b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
            render(b, icon(show ? 'eyeOff' : 'eye', 'icon-sm'));
          });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = readForm(form);
            const role = data.role;
            const isNet = NETWORK_ROLES.includes(role);
            const storeId = isNet ? null : networkView ? data.store_id : ctx.storeId;
            const email = (data.email || '').toLowerCase();
            const errors = {};
            if (!data.full_name || data.full_name.length < 2) errors.full_name = 'Informe o nome da pessoa.';
            if (!email) errors.email = 'Informe o e-mail.';
            else if (!EMAIL_RE.test(email)) errors.email = 'E-mail inválido. Confira se tem @ e o domínio.';
            if (!role) errors.role = 'Escolha o papel.';
            else if (!roles.includes(role)) errors.role = 'Você não pode conceder este papel.';
            if (role && !isNet && !storeId) errors.store_id = 'Escolha a loja.';
            if (data.password && data.password.length < 8) errors.password = 'Use pelo menos 8 caracteres.';
            if (!showErrors(form, errors)) return;
            const dup = rows.find((r) => (r.email || '').toLowerCase() === email && (r.store_id || null) === storeId);
            if (dup) {
              const ok = await confirmDialog({
                title: 'Esta pessoa já tem acesso aqui',
                message: `${personName(dup)} já é ${roleLabel(dup.role)} em ${storeLabel(storeId)}${dup.active ? '' : ' (desativado)'}. Atualizar para ${roleLabel(role)} e deixar o acesso ativo?`,
                confirmLabel: 'Atualizar acesso',
              });
              if (!ok) return;
            }
            try {
              const res = await withBusy(
                $('[data-save]', el),
                () => fn('admin-users', { action: 'create', email, full_name: data.full_name, role, store_id: storeId || undefined, password: data.password || undefined }),
                'Adicionando…'
              );
              close();
              highlightId = res?.staff_id || null;
              const known = rows.find((r) => r.id === res?.staff_id) || dup;
              if (known) Object.assign(known, { role, active: true, full_name: data.full_name || known.full_name });
              else if (res?.staff_id && (networkView || storeId === ctx.storeId))
                rows.push({ id: res.staff_id, user_id: res.user_id, email, full_name: data.full_name, role, store_id: storeId, active: true, last_sign_in_at: null, created_at: new Date().toISOString() });
              if (hasFilters()) clearFilters();
              sortRows();
              draw();
              drawTip();
              load({ background: true });
              if (res?.existing_user) {
                openModal({
                  title: dup ? 'Acesso atualizado' : 'Acesso adicionado',
                  size: 'sm',
                  icon: 'checkCircle',
                  tone: 'ok',
                  body: html`<div class="stack" style="--gap:12px">
                    <p class="modal__text"><strong>${email}</strong> já tinha conta no painel. O acesso como <strong>${roleLabel(role)}</strong> em <strong>${storeLabel(storeId)}</strong> foi liberado.</p>
                    <p class="modal__text">A pessoa continua entrando com a senha que já usa. Nenhuma senha nova foi criada.</p>
                    ${data.password ? html`<p class="muted small">A senha informada não foi aplicada. Se precisar, use “Gerar senha nova” no menu da pessoa.</p>` : ''}
                  </div>`,
                  actions: html`<button class="btn btn--primary" type="button" data-close>Entendi</button>`,
                });
              } else {
                showCredentials({
                  title: 'Pessoa adicionada',
                  intro: html`Conta criada para <strong>${data.full_name}</strong> como <strong>${roleLabel(role)}</strong> em <strong>${storeLabel(storeId)}</strong>.`,
                  email,
                  password: res?.password || data.password,
                });
              }
              setTimeout(() => {
                highlightId = null;
                $$('tr.is-selected', listEl).forEach((tr) => tr.classList.remove('is-selected', 'tm-flash'));
              }, 4000);
            } catch (err) {
              toastError(teamError(err));
            }
          });
        },
      });
    }

    /* ---------- Senha exibida uma única vez ---------- */
    function showCredentials({ title, intro, email, password }) {
      const panel = `${location.origin}/admin/`;
      let copied = false;
      openModal({
        title,
        icon: 'key',
        tone: 'ok',
        dismissable: false,
        cls: 'tm-cred-modal',
        body: html`<div class="tm-cred">
          <p class="modal__text">${intro}</p>
          <dl class="tm-cred__card">
            <div class="tm-cred__row"><dt>Endereço</dt><dd class="tm-cred__v">${panel.replace(/^https?:\/\//, '')}</dd></div>
            <div class="tm-cred__row"><dt>E-mail</dt><dd class="tm-cred__v">${email}</dd>
              <button class="btn btn--ghost btn--icon btn--sm" type="button" data-copy-email aria-label="Copiar e-mail">${icon('copy', 'icon-sm')}</button></div>
            <div class="tm-cred__row tm-cred__row--pass"><dt><label for="tm-cred-pass">Senha</label></dt>
              <dd><input class="tm-cred__pass" id="tm-cred-pass" value="${password || ''}" readonly spellcheck="false" autocomplete="off" data-pass></dd>
              <button class="btn btn--dark btn--sm" type="button" data-copy-pass autofocus>${icon('copy', 'icon-sm')} Copiar</button></div>
          </dl>
          <div class="callout callout--pix">${icon('alert')}<div><strong>Copie a senha agora.</strong>Por segurança, ela não aparece de novo. Peça para a pessoa trocar a senha em <b>Minha conta</b> no primeiro acesso.</div></div>
        </div>`,
        actions: html`<button class="btn" type="button" data-copy-all>${icon('copy', 'icon-sm')} Copiar dados de acesso</button>
          <button class="btn btn--primary" type="button" data-done>Concluído</button>`,
        onMount(el, close) {
          const input = $('[data-pass]', el);
          input.addEventListener('focus', () => input.select());
          const copiedMsg = (ok, what, fem) => {
            if (ok) copied = copied || what !== 'E-mail';
            toast(ok ? `${what} copiad${fem ? 'a' : 'o'}${what === 'Dados de acesso' ? 's' : ''}` : 'Não foi possível copiar. Selecione e copie manualmente.', ok ? 'success' : 'warning', 2400);
          };
          $('[data-copy-pass]', el).addEventListener('click', async () => copiedMsg(await copyText(password, input), 'Senha', true));
          $('[data-copy-email]', el).addEventListener('click', async () => copiedMsg(await copyText(email), 'E-mail', false));
          $('[data-copy-all]', el).addEventListener('click', async () => {
            const text = `Acesso ao painel Atual Móveis\nEndereço: ${panel}\nE-mail: ${email}\nSenha: ${password}\nTroque a senha em "Minha conta" no primeiro acesso.`;
            copiedMsg(await copyText(text, input), 'Dados de acesso', false);
          });
          // fechar sem copiar pede confirmação (a senha não volta a aparecer)
          const done = async () => {
            if (!copied) {
              const ok = await confirmDialog({
                title: 'Fechar sem copiar a senha?',
                message: 'Ela não será exibida de novo. Se precisar, use “Gerar senha nova” no menu da pessoa.',
                confirmLabel: 'Fechar mesmo assim',
                cancelLabel: 'Voltar',
              });
              if (!ok) return;
            }
            close();
          };
          $('[data-done]', el).addEventListener('click', done);
          $('.modal__x', el)?.addEventListener('click', (e) => {
            e.stopPropagation();
            done();
          });
        },
      });
    }

    /* ---------- Alterar papel ---------- */
    function changeRole(r) {
      if (!canManage(r.role, r.store_id)) return toastError('Você não pode alterar este acesso.');
      const scopeRoles = (r.store_id ? STORE_ROLES : NETWORK_ROLES).filter((x) => canManage(x, r.store_id));
      const scope = r.store_id ? html`${storeMark(storeOf(r.store_id) || { name: shortName(r.store_id) }, 18)} ${shortName(r.store_id)}` : html`${netMark(18)} Toda a rede`;
      openModal({
        title: 'Alterar papel',
        cls: 'tm-modal',
        body: html`<form class="tm-add tm-add--stack" id="tm-role-form" data-role-form novalidate>
          <div class="tm-add__main">
            <div class="tm-who">${avatar(personName(r), { size: 44, self: r.user_id === ctx.user.id, tone: ROLE_AVATAR[r.role] || '' })}
              <div><strong>${personName(r)}</strong><span>${r.email || ''}</span><span class="tm-who__scope">${scope}<span aria-hidden="true">·</span><span class="visually-hidden">, papel atual:</span>${roleBadge(r.role)}</span></div></div>
            <div class="field">
              <label for="tm-r-role">Novo papel</label>
              ${roleSelect('tm-r-role', scopeRoles, r.role)}
              <span class="hint">${r.store_id ? 'Papéis de loja valem só para esta loja.' : 'Papéis da rede valem para todas as lojas.'}</span>
            </div>
            ${isLastSuper(r) ? html`<div class="alert alert--warning">${icon('alert')}<div>Esta é a única pessoa super admin ativa: a rede precisa de pelo menos uma.</div></div>` : ''}
          </div>
          <aside class="tm-permbox" data-perm aria-live="polite">${permBox(r.role, scope, true)}</aside>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="submit" form="tm-role-form" data-save>${icon('check', 'icon-sm')} Salvar papel</button>`,
        onMount(el, close) {
          const form = $('[data-role-form]', el);
          form.addEventListener('change', (e) => {
            if (e.target.name === 'role') render($('[data-perm]', el), permBox(e.target.value, scope, true));
          });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const role = form.elements.role.value;
            if (!role) return showErrors(form, { role: 'Escolha o papel.' });
            const current = rows.find((x) => x.id === r.id) || r;
            if (role === current.role) return close();
            if (r.user_id === ctx.user.id) {
              const ok = await confirmDialog({
                title: 'Alterar o seu próprio papel?',
                message: `Você passará a ser ${roleLabel(role)} e pode perder acesso a algumas áreas imediatamente.`,
                confirmLabel: 'Alterar mesmo assim',
                danger: true,
              });
              if (!ok) return;
            }
            try {
              await withBusy($('[data-save]', el), () => fn('admin-users', { action: 'update', staff_id: r.id, role }));
              close();
              applyChange(r, { patch: { role }, message: `${personName(r)} agora é ${roleLabel(role)}` });
            } catch (err) {
              toastError(teamError(err));
            }
          });
        },
      });
    }

    /* ---------- Ativar / desativar ---------- */
    async function toggleActive(r) {
      const next = !r.active;
      if (!next) {
        const self = r.user_id === ctx.user.id;
        const ok = await confirmDialog({
          title: self ? 'Desativar o seu próprio acesso?' : `Desativar o acesso de ${personName(r)}?`,
          message: self
            ? `Você perde o acesso a ${storeLabel(r.store_id)} imediatamente.`
            : `${personName(r)} deixa de entrar em ${storeLabel(r.store_id)} até ser reativado. A conta e o histórico continuam guardados.`,
          confirmLabel: 'Desativar acesso',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        await rowTask(r, () => fn('admin-users', { action: 'update', staff_id: r.id, active: next }));
        applyChange(r, { patch: { active: next }, message: next ? `Acesso de ${personName(r)} reativado` : `Acesso de ${personName(r)} desativado` });
      } catch (err) {
        toastError(teamError(err));
      }
    }

    /* ---------- Redefinir senha ---------- */
    async function resetPassword(r) {
      const ok = await confirmDialog({
        title: `Gerar uma senha nova para ${personName(r)}?`,
        message: 'A senha atual deixa de funcionar na hora e a nova vale para todos os acessos desta pessoa. Ela aparece uma única vez.',
        confirmLabel: 'Gerar senha nova',
        tone: 'warn',
        icon: 'key',
      });
      if (!ok) return;
      try {
        const res = await rowTask(r, () => fn('admin-users', { action: 'reset_password', user_id: r.user_id }));
        if (!res?.password) throw new Error('A senha foi redefinida, mas não foi possível exibi-la. Tente de novo.');
        showCredentials({
          title: 'Senha nova gerada',
          intro: html`A senha de <strong>${personName(r)}</strong> foi redefinida.`,
          email: r.email,
          password: res.password,
        });
      } catch (err) {
        toastError(teamError(err));
      }
    }

    /* ---------- Remover acesso ---------- */
    async function removeAccess(r) {
      const self = r.user_id === ctx.user.id;
      const ok = await confirmDialog({
        title: self ? 'Remover o seu próprio acesso?' : `Remover o acesso de ${personName(r)}?`,
        message: self
          ? `Você perde o acesso a ${storeLabel(r.store_id)} imediatamente.`
          : `${personName(r)} (${roleLabel(r.role)}) deixa de acessar ${storeLabel(r.store_id)}. A conta continua existindo e pode receber acesso de novo depois.`,
        confirmLabel: 'Remover acesso',
        danger: true,
      });
      if (!ok) return;
      try {
        await rowTask(r, () => fn('admin-users', { action: 'remove', staff_id: r.id }));
        applyChange(r, { remove: true, message: `Acesso de ${personName(r)} removido` });
      } catch (err) {
        toastError(teamError(err));
      }
    }

    await load();
  },
};

const CSS = `
.tm { display: flex; flex-direction: column; gap: 16px; }
.tm [data-tip]:empty { display: none; }
.tm-card { overflow: visible; }
.tm-card > .tabs { margin: 0; padding: 0 12px; }
.tm-tb { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.tm-tb__search { max-width: 360px; }
.tm-tb__search .input::-webkit-search-cancel-button { display: none; }
.tm-tb__f .sel__trigger, .tm-tb__f .select { min-width: 160px; }
.tm-tb__sum { font-size: 13px; color: var(--muted); white-space: nowrap; }
.tm-tb__sum b { color: var(--ink); font-weight: 600; }
.tm-results { min-height: 120px; }
.tm-results mark { background: color-mix(in srgb, var(--orange) 28%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.tm-tw { border: 0; border-radius: 0 0 var(--r-lg) var(--r-lg); box-shadow: none; }
.tm-table th:first-child, .tm-table td:first-child { padding-left: 20px; }
.tm-table th:last-child, .tm-table td:last-child { padding-right: 14px; }
.tm-table td { vertical-align: middle; }
.tm-c-act { width: 52px; text-align: right; }
.tm-c-role, .tm-c-status, .tm-c-last, .tm-c-since { white-space: nowrap; }
.tm-c-since { color: var(--muted); font-size: 13px; }
.tm-mlabel, .tm-sm { display: none; }
.tm-person { display: flex; align-items: center; gap: 12px; min-width: 240px; }
.tm-person__txt { display: flex; flex-direction: column; min-width: 0; }
.tm-person__l1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tm-name { display: block; max-width: 280px; padding: 0; border: 0; background: none; color: var(--ink); font: 600 14px/1.3 var(--font-ui); text-align: left; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; border-radius: 4px; }
.tm-name:hover { color: var(--accent-ink); text-decoration: underline; }
.tm-name--ro { cursor: default; }
.tm-name--ro:hover { color: var(--ink); text-decoration: none; }
.tm-you { height: 20px; padding: 0 7px; font-size: 11.5px; }
.tm-email { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; line-height: 1.35; }
.tm-last { font-size: 13.5px; color: var(--ink); }
.tm-last--never { display: inline-flex; align-items: center; gap: 5px; color: var(--warn-fg); font-weight: 500; font-size: 13px; }
.tm-row.is-off .tm-name, .tm-row.is-off .tm-last { color: var(--muted); }
.tm-row.is-off .avatar { opacity: .5; filter: grayscale(.6); }
.tm-row:hover { background: var(--surface-2); }
.tm-flash td { animation: tm-flash 2.4s var(--ease-out) both; }
@keyframes tm-flash { 0%, 30% { background: var(--highlight-soft); } 100% { background: var(--row-selected); } }
.tm-dots { color: var(--muted); }
.tm-dots[aria-expanded='true'] { background: var(--surface-3); color: var(--ink); }
.badge.tm-super { background: var(--select); color: var(--on-select); box-shadow: none; }
.badge.tm-super::before { background: var(--highlight); }
/* cabeçalho de grupo (loja) */
.tm-ghead th { height: auto; padding: 16px 20px 8px !important; background: var(--surface); border-bottom: 1px solid var(--line); text-align: left; position: static; }
.tm-group + .tm-group .tm-ghead th { border-top: 1px solid var(--line); padding-top: 20px !important; }
.tm-ghead__in { display: flex; align-items: center; gap: 10px; min-width: 0; font-weight: 400; }
.tm-ghead__name { font: 700 14.5px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.005em; white-space: nowrap; }
.tm-ghead__hint { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tm-ghead__n { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.tm-ghead .smark--net { display: inline-grid; place-items: center; }
.tm-note { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 var(--r-lg) var(--r-lg); font-size: 13px; color: var(--muted); }
.tm-note > .icon-sm { color: var(--info-fg); flex: none; }
.tm-note span { flex: 1 1 260px; }
/* menu da linha */
.tm-menu { position: fixed; right: auto; top: 0; left: 0; z-index: var(--z-popover); width: 260px; }
.tm-menu__head { display: flex; align-items: center; gap: 10px; padding: 6px 8px 4px; }
.tm-menu__head div { display: flex; flex-direction: column; min-width: 0; }
.tm-menu__head strong { font-size: 13.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-menu__head span { font-size: 12px; color: var(--muted); line-height: 1.35; }
.tm-menu button:disabled { opacity: .45; cursor: not-allowed; }
.tm-menu button:disabled:hover { background: none; }
.tm-menu__why { display: flex; gap: 7px; align-items: flex-start; margin: 6px 2px 2px; padding: 9px 10px; border-radius: var(--r-sm); background: var(--surface-2); font-size: 12px; color: var(--muted); line-height: 1.4; }
.tm-menu__why .icon-xs { flex: none; margin-top: 2px; }
/* formulário */
@media (min-width: 768px) { .tm-modal.modal--lg { width: min(880px, calc(100vw - 32px)); } }
.tm-add { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 22px; align-items: start; }
.tm-add__main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.tm-sec { margin: 0; padding: 0; border: 0; min-width: 0; }
.tm-sec + .tm-sec { padding-top: 18px; border-top: 1px solid var(--line); }
.tm-sec__t { float: left; width: 100%; display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 0; font: 700 15px/1.3 var(--font-display); color: var(--ink); }
.tm-sec__t + * { clear: both; }
.tm-fixed { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 12px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-3); color: var(--ink); font-weight: 600; font-size: 14px; }
.tm-fixed > .icon-xs { margin-left: auto; color: var(--muted); }
.tm-fixed .smark--net { display: inline-grid; place-items: center; }
.tm-pass { position: relative; }
.tm-pass .input { padding-right: 48px; }
.tm-pass__eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); }
.tm-callout { display: flex; gap: 9px; align-items: flex-start; margin: 0; padding: 11px 13px; border-radius: 12px; background: var(--info-bg); border: 1px solid var(--info-line); color: var(--text); font-size: 13px; line-height: 1.45; }
.tm-callout > .icon-sm { color: var(--info-fg); flex: none; margin-top: 2px; }
.tm-permbox { position: sticky; top: 0; padding: 14px 14px 10px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); }
.tm-permbox__head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; padding: 0 6px; }
.tm-permbox__t { font: 700 15px/1.25 var(--font-display); color: var(--ink); }
.tm-permbox__scope { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; color: var(--muted); }
.tm-add--stack { grid-template-columns: minmax(0, 1fr); gap: 16px; }
.tm-add--stack .tm-permbox { position: static; }
.tm-add--stack .tm-permbox__head { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.tm-add--stack .tm-permbox__head .overline { flex-basis: 100%; }
.tm-permbox__scope .smark--net, .tm-who__scope .smark--net { display: inline-grid; place-items: center; }
.tm-perm { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.tm-perm li { display: flex; align-items: center; gap: 9px; min-height: 30px; padding: 0 6px; border-radius: 8px; font-size: 13px; color: var(--ink); }
.tm-perm li > .icon-sm { color: var(--muted); flex: none; }
.tm-perm__l { flex: 1; min-width: 0; }
.tm-perm__st { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; flex: none; }
.tm-perm li.is-on .tm-perm__st { background: var(--ok-bg); color: var(--ok-fg); }
.tm-perm li.is-on .tm-perm__st .icon-xs { stroke-width: 2.8; }
.tm-perm li.is-off { color: var(--muted); }
.tm-perm li.is-off .tm-perm__st { color: var(--faint); }
.tm-perm__none { margin: 0; padding: 18px 6px; font-size: 13px; color: var(--muted); line-height: 1.45; }
.tm-perm--chips { flex-direction: row; flex-wrap: wrap; gap: 6px; }
.tm-perm--chips li { min-height: 28px; padding: 0 10px 0 8px; border-radius: 999px; font-size: 12.5px; font-weight: 600; gap: 6px; }
.tm-perm--chips li > .icon-sm { width: 14px; height: 14px; }
.tm-perm--chips li.is-on { background: var(--ok-bg); color: var(--ok-fg); box-shadow: inset 0 0 0 1px var(--ok-line); }
.tm-perm--chips li.is-on > .icon-sm { color: var(--ok-fg); }
.tm-perm--chips li.is-off { background: transparent; box-shadow: none; border: 1px dashed var(--line-strong); }
.tm-perm--chips .tm-perm__st { display: none; }
.tm-perm--chips .tm-perm__l { flex: none; }
.tm-perm--chips li.is-off > .icon-sm { color: var(--faint); }
.tm-who { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); }
.tm-who > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tm-who strong { font: 700 16px/1.25 var(--font-display); color: var(--ink); }
.tm-who > div > span { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.tm-who__scope { display: inline-flex !important; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 4px; color: var(--text) !important; font-weight: 500; }
/* quadro de papéis */
.tm-roles__lede { margin: 0 0 6px; font-size: 13.5px; color: var(--muted); }
.tm-roles__g { margin: 14px 0 8px; font: 600 11px/1.2 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.tm-roles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tm-role { padding: 14px 16px; border-radius: 16px; border: 1px solid var(--line); background: var(--surface); }
.tm-role__head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.tm-role__head > div { flex: 1; min-width: 0; }
.tm-role__head h3 { margin: 0; font: 700 15px/1.25 var(--font-display); color: var(--ink); }
.tm-role__head p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.tm-role__n { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.tm-role__ico { width: 34px; height: 34px; }
.tm-role .tm-perm--chips li { min-height: 26px; font-size: 12px; }
/* senha uma única vez */
.tm-cred { display: flex; flex-direction: column; gap: 14px; }
.tm-cred__card { display: flex; flex-direction: column; margin: 0; border-radius: 14px; border: 1px solid var(--line); background: var(--surface-2); overflow: hidden; }
.tm-cred__row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 46px; padding: 6px 8px 6px 14px; }
.tm-cred__row + .tm-cred__row { border-top: 1px solid var(--line); }
.tm-cred__row dt { font-size: 12px; font-weight: 600; color: var(--muted); }
.tm-cred__row dd { margin: 0; min-width: 0; }
.tm-cred__v { font-size: 13.5px; color: var(--ink); overflow-wrap: anywhere; }
.tm-cred__row--pass { background: var(--raised); }
.tm-cred__pass { width: 100%; min-width: 0; padding: 4px 0; border: 0; background: transparent; color: var(--ink); font: 700 16px/1.2 var(--font-mono); letter-spacing: .04em; font-variant-numeric: slashed-zero; text-overflow: ellipsis; }
.tm-cred__pass:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.tm-cred .callout strong { display: block; margin-bottom: 2px; }
.tm-cred-modal .modal__foot { flex-wrap: wrap; }

@media (max-width: 1100px) {
  .tm-c-since { display: none; }
}
@media (max-width: 860px) {
  .tm-add { grid-template-columns: minmax(0, 1fr); }
  .tm-roles { grid-template-columns: minmax(0, 1fr); }
  .tm-permbox { position: static; }
  .tm-perm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 8px; }
}
@media (max-width: 767px) {
  .page-actions:has([data-team-add]) { flex-wrap: nowrap; }
  .page-actions:has([data-team-add]) .btn { flex: 1 1 0; min-width: 0; height: 44px; }
  .tm-lg { display: none; }
  .tm-sm { display: inline !important; }
  .tm-tb { padding: 12px; }
  .tm-tb__search { flex-basis: 100%; max-width: none; }
  .tm-tb__f { flex: 1 1 140px; min-width: 0; }
  .tm-tb__f .sel__trigger, .tm-tb__f .select { width: 100%; min-width: 0; max-width: none; }
  .tm-tb .toolbar__spacer { display: none; }
  .tm-tb__sum { flex-basis: 100%; }
  .tm-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); }
  .tm-table, .tm-table tbody { display: block; width: 100%; }
  .tm-table tr.tm-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "p a" "r r" "m m"; gap: 8px 8px; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--line); }
  .tm-table tr.tm-row:hover { background: none; }
  .tm-table td { display: block; height: auto; padding: 0 !important; border: 0; white-space: normal; }
  .tm-c-person { grid-area: p; min-width: 0; }
  .tm-c-act { grid-area: a; width: auto; }
  .tm-c-act .btn--icon { width: 40px; height: 40px; }
  .tm-c-role { grid-area: r; display: flex !important; flex-wrap: wrap; gap: 6px; padding-left: 48px !important; }
  .tm-table td.tm-c-status, .tm-table td.tm-c-since { display: none !important; }
  .tm-row.is-off .tm-c-role::after { content: 'Desativado'; display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 999px; background: var(--neu-bg); color: var(--neu-fg); font-size: 12px; font-weight: 600; }
  .tm-c-last { grid-area: m; display: flex !important; align-items: center; gap: 6px; padding-left: 48px !important; font-size: 12.5px; }
  .tm-c-last .tm-last { font-size: 12.5px; }
  .tm-mlabel { display: inline; color: var(--muted); font-size: 12.5px; }
  .tm-mlabel::after { content: ':'; }
  .tm-c-last .tm-last--never { margin-left: -2px; }
  .tm-c-last:has(.tm-last--never) .tm-mlabel, .tm-sm { display: none; }
  .tm-person { min-width: 0; }
  .tm-name { max-width: 100%; }
  .tm-table tr.tm-ghead { display: block; }
  .tm-table tr.tm-ghead th { display: block; padding: 14px 16px 8px !important; }
  .tm-ghead__hint { display: none; }
  .tm-note { padding: 12px 16px; }
  .tm-cred__row { grid-template-columns: 62px minmax(0, 1fr) auto; }
  .tm-cred-modal .modal__foot .btn { flex: 1 1 auto; }
}
@media (max-width: 600px) {
  .tm-perm { grid-template-columns: minmax(0, 1fr); }
  .tm-modal .modal__foot .btn { flex: 1 1 auto; }
}
`;
