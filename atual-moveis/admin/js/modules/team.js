// Equipe: quem acessa o painel, com qual papel e em qual loja.
// Toda escrita passa pela edge function admin-users (service role), que aplica as regras:
//   super admin → qualquer papel · admin da rede → tudo, menos super admins
//   admin da loja → apenas papéis de loja nas lojas que administra.
// A interface espelha essas regras (canManage) e mostra os erros do servidor de forma amigável.
import { fn } from '../api.js';
import {
  html,
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
  selectOptions,
  loading,
  empty,
  errorBlock,
  injectStyle,
  debounce,
  relTime,
  datetime,
  num,
  openModal,
  confirmDialog,
  badge,
  table,
  ROLES,
} from '../ui.js';

const CSS = `
.team { display: flex; flex-direction: column; gap: 14px; }
.team .toolbar { margin-bottom: 0; }
.team .search { max-width: 360px; }
.team__filter { width: auto; min-width: 170px; }
.team__count { margin-left: auto; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.team__person { display: flex; align-items: center; gap: 10px; min-width: 220px; }
.team__person .avatar { flex: none; background: #2a2a2a; }
.team__person.is-off .avatar { background: #b5b5b5; }
.team__name { display: block; padding: 0; border: 0; background: none; color: var(--ink); font-weight: 700; text-align: left; cursor: pointer; }
.team__name:hover:not(:disabled) { color: var(--accent); text-decoration: underline; }
.team__name:disabled { cursor: default; }
.team__you { margin-left: 6px; }
.team__email { display: block; overflow-wrap: anywhere; }
.team .table td { white-space: nowrap; }
.team .table td.team__actions-col { width: 52px; text-align: right; }
.team .empty .btn svg { width: 15px; height: 15px; color: currentColor; }
.team__store { display: inline-flex; align-items: center; gap: 6px; }
.team__note { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: var(--muted); }
.team__note .icon { width: 16px; height: 16px; margin-top: 1px; }
.team-menu { position: fixed; right: auto; top: 0; left: 0; z-index: 90; width: 236px; }
.team-menu button:disabled { opacity: 0.45; cursor: not-allowed; }
.team-menu button:disabled:hover { background: none; }
.team-menu__why { margin: 4px 4px 2px; padding: 8px 8px 4px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); line-height: 1.4; }
.team-roles { display: grid; gap: 8px; }
.team-roles__group { margin: 6px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
.team-role { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
.team-role:hover { border-color: #b9b9b9; }
.team-role input { width: 16px; height: 16px; margin: 2px 0 0; flex: none; accent-color: var(--accent); }
.team-role span { display: flex; flex-direction: column; gap: 1px; }
.team-role strong { color: var(--ink); }
.team-role:has(input:checked) { border-color: var(--accent); background: #fffafa; box-shadow: 0 0 0 1px var(--accent) inset; }
.team-role:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.team-roles[aria-invalid='true'] .team-role { border-color: var(--danger); }
.team-form fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.team-form legend { padding: 0; margin-bottom: 6px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
.team-form__scope { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; }
.team-pass { display: flex; }
.team-pass .input { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.team-pass .btn { margin-left: -1px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.team-cred .input { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; letter-spacing: 0.3px; }
.team-cred__who { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
@media (max-width: 860px) {
  .team .search { max-width: none; flex: 1 1 100%; }
  .team__filter { flex: 1 1 160px; }
  .team__count { margin-left: 0; flex-basis: 100%; }
}
@media (max-width: 560px) {
  .team-hide-sm { display: none; }
  .team .table-wrap { border: 0; background: transparent; overflow: visible; }
  .team .table thead { display: none; }
  .team .table, .team .table tbody { display: block; }
  .team .table tr { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
  .team .table tbody tr:last-child td { border-bottom: 0; }
  .team .table td { display: block; padding: 0; border: 0; white-space: normal; }
  .team .table td.team__person-col { order: 0; flex: 1 1 calc(100% - 48px); min-width: 0; }
  .team .table td.team__actions-col { order: 1; flex: 0 0 auto; width: auto; }
  .team .table td.team__meta-col { order: 2; font-size: 12.5px; }
  .team .table td[data-label]::before { content: attr(data-label) ': '; color: var(--muted); }
  .team__person { min-width: 0; }
}
`;

const STORE_ROLES = ['store_admin', 'store_manager', 'store_editor', 'store_operator'];
const NETWORK_ROLES = ['super_admin', 'network_admin'];
const ROLE_ORDER = [...NETWORK_ROLES, ...STORE_ROLES];
const ROLE_TONE = { super_admin: 'dark', network_admin: 'accent', store_admin: 'info', store_manager: 'success', store_editor: '', store_operator: '' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const initials = (r) =>
  (r.full_name || r.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const roleLabel = (role) => ROLES[role]?.label || role;
const roleBadge = (role) => badge(roleLabel(role), ROLE_TONE[role] || '');
const personName = (r) => r.full_name || r.email || 'Sem nome';

// Mensagens do Supabase Auth que podem vazar pela edge function → português
function teamError(e) {
  const msg = e instanceof Error ? e.message : String(e || '');
  if (/already (been )?registered|already exists/i.test(msg)) return new Error('Este e-mail já tem uma conta. Tente de novo em instantes ou fale com o suporte.');
  if (/password/i.test(msg) && /should|weak|least|characters/i.test(msg)) return new Error('Senha fraca: use pelo menos 8 caracteres, misturando letras e números.');
  if (/invalid email|unable to validate email/i.test(msg)) return new Error('E-mail inválido.');
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

export default {
  title: 'Equipe',
  async render(view, ctx) {
    injectStyle('team', CSS);
    if (!ctx.can('staff')) {
      render(view, errorBlock('Você não tem permissão para gerenciar a equipe desta loja.'));
      return;
    }

    const networkView = !ctx.storeId; // só administradores da rede chegam aqui sem loja
    const state = { search: '', role: '', store: '', status: '' };
    let rows = [];
    let menu = null; // { el, btn }
    let highlight = null;
    let loadToken = 0;
    const busy = new Set(); // acessos com uma ação em andamento

    /* ---------- Regras (espelho da edge function) ---------- */
    const canManage = (role, storeId) => {
      if (ctx.isSuper) return true;
      if (ctx.isGlobal) return role !== 'super_admin';
      return STORE_ROLES.includes(role) && !!storeId && ctx.roleIn(storeId) === 'store_admin';
    };
    const grantable = () => [...STORE_ROLES, ...(ctx.isGlobal ? ['network_admin'] : []), ...(ctx.isSuper ? ['super_admin'] : [])].filter((r) => ROLES[r]);
    const storeLabel = (id) => (id ? ctx.storeName(id) : 'Toda a rede');
    const activeSupers = () => rows.filter((r) => r.role === 'super_admin' && r.active).length;
    const isLastSuper = (r) => r.role === 'super_admin' && r.active && activeSupers() <= 1;
    const storeIndex = (id) => {
      const i = ctx.stores.findIndex((s) => s.id === id);
      return i < 0 ? 999 : i;
    };

    /* ---------- Ações no topo ---------- */
    ctx.setActions(
      html`<button class="btn btn--primary btn--sm" type="button" data-team-add aria-label="Adicionar pessoa">${icon('plus', 'icon-sm')}<span class="team-hide-sm">Adicionar pessoa</span></button>`
    );
    $('[data-team-add]')?.addEventListener('click', () => addPerson());

    render(
      view,
      html`<div class="team">
        <div class="toolbar" role="search">
          <div class="search">${icon('search')}<label class="visually-hidden" for="team-search">Buscar por nome ou e-mail</label>
            <input class="input" id="team-search" type="search" placeholder="Buscar por nome ou e-mail" autocomplete="off" data-search></div>
          <label class="visually-hidden" for="team-role">Filtrar por papel</label>
          <select class="select team__filter" id="team-role" data-filter="role">
            <option value="">Todos os papéis</option>
            ${ROLE_ORDER.filter((r) => networkView || STORE_ROLES.includes(r)).map((r) => html`<option value="${r}">${roleLabel(r)}</option>`)}
          </select>
          ${networkView
            ? html`<label class="visually-hidden" for="team-store">Filtrar por loja</label>
              <select class="select team__filter" id="team-store" data-filter="store">
                <option value="">Todas as lojas</option>
                <option value="network">Somente papéis da rede</option>
                ${ctx.stores.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
              </select>`
            : ''}
          <label class="visually-hidden" for="team-status">Filtrar por situação</label>
          <select class="select team__filter" id="team-status" data-filter="status">
            <option value="">Ativos e desativados</option>
            <option value="active">Somente ativos</option>
            <option value="inactive">Somente desativados</option>
          </select>
          <span class="team__count" data-count aria-live="polite"></span>
        </div>
        ${!networkView && ctx.isGlobal
          ? html`<p class="team__note">${icon('network')}<span>Administradores da rede também acessam esta loja e não aparecem nesta lista. Veja todos em <strong>Toda a rede</strong>.</span></p>`
          : ''}
        <div data-list>${loading('Carregando equipe…')}</div>
      </div>`
    );
    const listEl = $('[data-list]', view);

    /* ---------- Dados ---------- */
    const sortRows = () =>
      rows.sort((a, b) => {
        const sa = a.store_id ? 1 : 0;
        const sb = b.store_id ? 1 : 0;
        if (sa !== sb) return sa - sb;
        if (a.store_id !== b.store_id) return storeIndex(a.store_id) - storeIndex(b.store_id);
        const ra = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (ra) return ra;
        return norm(personName(a)).localeCompare(norm(personName(b)));
      });

    // Recarrega do servidor. Em segundo plano (background) a lista atual continua na tela.
    async function load({ background = false } = {}) {
      const my = ++loadToken;
      try {
        const res = await fn('admin-users', { action: 'list', store_id: ctx.storeId || undefined });
        if (my !== loadToken || !view.isConnected) return;
        rows = (res?.rows || []).slice();
        sortRows();
        draw();
      } catch (e) {
        if (my !== loadToken || !view.isConnected) return;
        if (background) return toastError(teamError(e));
        render(
          listEl,
          html`<div class="stack" style="--gap:10px">${errorBlock(teamError(e))}<div><button class="btn btn--sm" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div></div>`
        );
        $('[data-count]', view).textContent = '';
      }
    }

    function filtered() {
      const term = norm(state.search.trim());
      return rows.filter((r) => {
        if (term && !norm(`${r.full_name || ''} ${r.email || ''}`).includes(term)) return false;
        if (state.role && r.role !== state.role) return false;
        if (state.store === 'network' && r.store_id) return false;
        if (state.store && state.store !== 'network' && r.store_id !== state.store) return false;
        if (state.status === 'active' && !r.active) return false;
        if (state.status === 'inactive' && r.active) return false;
        return true;
      });
    }

    function draw() {
      closeMenu();
      const list = filtered();
      const people = new Set(rows.map((r) => r.user_id)).size;
      $('[data-count]', view).textContent = rows.length
        ? list.length === rows.length
          ? `${num(people)} ${people === 1 ? 'pessoa' : 'pessoas'} · ${num(rows.length)} ${rows.length === 1 ? 'acesso' : 'acessos'}`
          : `${num(list.length)} de ${num(rows.length)} acessos`
        : '';
      if (!rows.length) {
        render(
          listEl,
          html`<div class="card">${empty(
            networkView ? 'Ninguém na equipe ainda' : 'Ninguém na equipe desta loja ainda',
            'Adicione as pessoas que vão cuidar do catálogo, dos pedidos e do atendimento.',
            html`<button class="btn btn--primary" type="button" data-empty-add>${icon('plus', 'icon-sm')} Adicionar pessoa</button>`
          )}</div>`
        );
        return;
      }
      if (!list.length) {
        render(listEl, html`<div class="card">${empty('Nenhum acesso encontrado', 'Ajuste a busca ou os filtros.')}</div>`);
        return;
      }
      const columns = [
        {
          label: 'Pessoa',
          cls: 'team__person-col',
          render: (r) => {
            const manageable = canManage(r.role, r.store_id) && !isLastSuper(r) && !busy.has(r.id);
            return html`<div class="team__person ${r.active ? '' : 'is-off'}">
              <span class="avatar" aria-hidden="true">${initials(r)}</span>
              <span class="grow">
                <button class="team__name" type="button" data-edit="${r.id}" ${manageable ? '' : 'disabled'}>${personName(r)}${
                  r.user_id === ctx.user.id ? html`<span class="badge badge--plain team__you">Você</span>` : ''
                }</button>
                <span class="team__email muted small">${r.email || '—'}</span>
              </span>
            </div>`;
          },
        },
        { label: 'Papel', cls: 'team__meta-col', render: (r) => roleBadge(r.role) },
        ...(networkView
          ? [{ label: 'Loja', cls: 'team__meta-col', render: (r) => (r.store_id ? ctx.storeName(r.store_id) : html`<span class="team__store">${icon('network', 'icon-sm')}Toda a rede</span>`) }]
          : []),
        { label: 'Situação', cls: 'team__meta-col', render: (r) => (r.active ? badge('Ativo', 'success') : badge('Desativado')) },
        {
          label: 'Último acesso',
          cls: 'team__meta-col',
          render: (r) =>
            r.last_sign_in_at ? html`<span title="${datetime(r.last_sign_in_at)}">${relTime(r.last_sign_in_at)}</span>` : html`<span class="faint">Nunca entrou</span>`,
        },
        {
          label: html`<span class="visually-hidden">Ações</span>`,
          cls: 'team__actions-col',
          render: (r) =>
            busy.has(r.id)
              ? html`<span class="btn btn--ghost btn--sm btn--icon" role="status" aria-label="Salvando alteração"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span></span>`
              : html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-row-menu="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Ações para ${personName(r)} (${storeLabel(r.store_id)})" title="Ações">${icon('dots')}</button>`,
        },
      ];
      render(listEl, table({ columns, rows: list, rowAttrs: (r) => `data-id="${esc(r.id)}"${r.id === highlight ? ' class="is-selected"' : ''}` }));
      // rótulos para a versão em cartões (celular)
      const labels = columns.map((c) => (typeof c.label === 'string' ? c.label : ''));
      $$('tbody tr', listEl).forEach((tr) =>
        $$('td', tr).forEach((td, i) => {
          if (labels[i] && td.classList.contains('team__meta-col') && labels[i] !== 'Papel' && labels[i] !== 'Situação') td.dataset.label = labels[i];
        })
      );
    }

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
            ? { id: 'toggle', label: 'Desativar acesso', icon: 'close', disabled: !manage || lastSuper }
            : { id: 'toggle', label: 'Reativar acesso', icon: 'check', disabled: !manage },
          self ? { id: 'account', label: 'Trocar minha senha', icon: 'key' } : { id: 'reset', label: 'Redefinir senha', icon: 'key', disabled: !canReset },
          { sep: true },
          { id: 'remove', label: 'Remover acesso', icon: 'trash', danger: true, disabled: !manage || lastSuper },
        ],
      };
    }

    function closeMenu(returnFocus = false) {
      if (!menu) return;
      menu.el.remove();
      menu.btn.setAttribute('aria-expanded', 'false');
      if (returnFocus && menu.btn.isConnected) menu.btn.focus();
      menu = null;
    }

    function openMenu(btn) {
      const r = rows.find((x) => x.id === btn.dataset.rowMenu);
      if (!r || busy.has(r.id)) return;
      if (menu?.btn === btn) return closeMenu(true);
      closeMenu();
      const { items, why } = actionsFor(r);
      const el = document.createElement('div');
      el.className = 'menu team-menu';
      el.setAttribute('role', 'menu');
      el.setAttribute('aria-label', `Ações para ${personName(r)}`);
      render(
        el,
        html`${items.map((a) =>
          a.sep
            ? html`<hr>`
            : html`<button type="button" role="menuitem" data-act="${a.id}" class="${a.danger ? 'is-danger' : ''}" ${a.disabled ? 'disabled' : ''}>${icon(a.icon, 'icon-sm')} ${a.label}</button>`
        )}${why ? html`<p class="team-menu__why">${why}</p>` : ''}`
      );
      document.body.appendChild(el);
      menu = { el, btn, row: r };
      btn.setAttribute('aria-expanded', 'true');
      const rect = btn.getBoundingClientRect();
      const mw = el.offsetWidth;
      const mh = el.offsetHeight;
      let left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.right - mw));
      let top = rect.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      $('button:not([disabled])', el)?.focus();
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const row = menu.row;
        closeMenu();
        runAction(b.dataset.act, row);
      });
      el.addEventListener('keydown', (e) => {
        const items = $$('button:not([disabled])', el);
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items[(i + 1) % items.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i - 1 + items.length) % items.length]?.focus();
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
    const onScroll = () => closeMenu();
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    ctx.onCleanup(() => {
      closeMenu();
      document.removeEventListener('click', onDocClick, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    });

    /* ---------- Eventos da lista ---------- */
    view.addEventListener('click', (e) => {
      const m = e.target.closest('[data-row-menu]');
      if (m) return openMenu(m);
      const ed = e.target.closest('[data-edit]');
      if (ed && !ed.disabled) {
        const r = rows.find((x) => x.id === ed.dataset.edit);
        if (r && !busy.has(r.id)) changeRole(r);
        return;
      }
      if (e.target.closest('[data-empty-add]')) return addPerson();
      if (e.target.closest('[data-retry]')) {
        render(listEl, loading('Carregando equipe…'));
        load();
      }
    });
    const onSearch = debounce(() => draw(), 180);
    $('[data-search]', view).addEventListener('input', (e) => {
      state.search = e.target.value;
      onSearch();
    });
    $$('[data-filter]', view).forEach((sel) =>
      sel.addEventListener('change', () => {
        state[sel.dataset.filter] = sel.value;
        draw();
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
    }

    /* ---------- Formulário de papel (reutilizado em "adicionar" e "alterar") ---------- */
    function roleChoices(roles, selected) {
      const store = roles.filter((r) => STORE_ROLES.includes(r));
      const net = roles.filter((r) => NETWORK_ROLES.includes(r));
      const item = (r) => html`<label class="team-role">
        <input type="radio" name="role" value="${r}" ${r === selected ? 'checked' : ''}>
        <span><strong>${roleLabel(r)}</strong><span class="muted small">${ROLES[r]?.desc || ''}</span></span>
      </label>`;
      return html`${store.length && net.length ? html`<p class="team-roles__group">Na loja</p>` : ''}${store.map(item)}
        ${net.length ? html`<p class="team-roles__group">Em toda a rede</p>${net.map(item)}` : ''}`;
    }

    /* ---------- Adicionar pessoa ---------- */
    function addPerson() {
      const roles = grantable();
      openModal({
        title: 'Adicionar pessoa',
        size: 'lg',
        body: html`<form class="form-grid team-form" id="team-add-form" data-add-form novalidate>
          <div class="field col-6">
            <label for="team-f-name">Nome completo *</label>
            <input class="input" id="team-f-name" name="full_name" required autocomplete="off" maxlength="120" autofocus>
          </div>
          <div class="field col-6">
            <label for="team-f-email">E-mail *</label>
            <input class="input" id="team-f-email" name="email" type="email" required autocomplete="off" inputmode="email" placeholder="nome@exemplo.com">
            <span class="hint">É o login da pessoa no painel.</span>
          </div>
          <div class="field col-12">
            <fieldset>
              <legend>Papel *</legend>
              <div class="team-roles" data-roles>${roleChoices(roles, '')}</div>
            </fieldset>
          </div>
          <div class="field col-12" data-scope>
            ${networkView
              ? html`<label for="team-f-store">Loja *</label>
                <select class="select" id="team-f-store" name="store_id" required>
                  <option value="">Selecione a loja</option>
                  ${selectOptions(ctx.stores.map((s) => [s.id, `${s.name}${s.active ? '' : ' (inativa)'}`]), '')}
                </select>
                <span class="hint">Papéis de loja valem só para a loja escolhida.</span>`
              : html`<span class="label">Loja</span><div class="team-form__scope">${icon('store', 'icon-sm')} <strong>${ctx.store?.name}</strong></div>`}
          </div>
          <div class="field col-12" data-scope-network hidden>
            <span class="label">Abrangência</span>
            <div class="team-form__scope">${icon('network', 'icon-sm')} <strong>Toda a rede</strong> · acesso a todas as ${num(ctx.stores.length)} lojas</div>
          </div>
          <div class="field col-12">
            <label for="team-f-pass">Senha inicial <span class="muted">(opcional)</span></label>
            <div class="team-pass">
              <input class="input" id="team-f-pass" name="password" type="password" autocomplete="new-password" minlength="8" spellcheck="false">
              <button class="btn" type="button" data-toggle-pass aria-label="Mostrar senha" aria-pressed="false">${icon('eye', 'icon-sm')}</button>
            </div>
            <span class="hint">Deixe em branco para gerar uma senha segura automaticamente. Mínimo de 8 caracteres.</span>
          </div>
          <p class="col-12 team__note">${icon('alert')}<span>Se o e-mail já tiver conta no painel, a pessoa ganha este acesso e continua entrando com a senha que já usa.</span></p>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="submit" form="team-add-form" data-save>Adicionar</button>`,
        onMount(el, close) {
          const form = $('[data-add-form]', el);
          const syncScope = () => {
            const role = form.querySelector('input[name="role"]:checked')?.value;
            const isNet = NETWORK_ROLES.includes(role);
            $('[data-scope]', el).hidden = isNet;
            $('[data-scope-network]', el).hidden = !isNet;
            const sel = form.elements.store_id;
            if (sel) sel.disabled = isNet;
          };
          // limpa o erro do campo assim que a pessoa corrige
          const clearError = (e) => {
            const name = e.target.name;
            if (!name) return;
            e.target.removeAttribute('aria-invalid');
            $$(`.error[data-for="${name}"]`, form).forEach((n) => n.remove());
            if (name === 'role') {
              $('[data-roles]', el).removeAttribute('aria-invalid');
              $$('input[name="role"]', form).forEach((i) => i.removeAttribute('aria-invalid'));
            }
          };
          form.addEventListener('input', clearError);
          form.addEventListener('change', (e) => {
            clearError(e);
            if (e.target.name === 'role') syncScope();
          });
          $('[data-toggle-pass]', el).addEventListener('click', (e) => {
            const b = e.currentTarget;
            const input = form.elements.password;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            b.setAttribute('aria-pressed', String(show));
            b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
          });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = readForm(form);
            const role = data.role;
            const isNet = NETWORK_ROLES.includes(role);
            const storeId = isNet ? null : networkView ? data.store_id : ctx.storeId;
            const email = (data.email || '').toLowerCase();
            const errors = {};
            if (!data.full_name || data.full_name.length < 2) errors.full_name = 'Informe o nome da pessoa';
            if (!email) errors.email = 'Informe o e-mail';
            else if (!EMAIL_RE.test(email)) errors.email = 'E-mail inválido';
            if (!role) errors.role = 'Escolha o papel';
            else if (!roles.includes(role)) errors.role = 'Você não pode conceder este papel';
            if (role && !isNet && !storeId) errors.store_id = 'Escolha a loja';
            if (data.password && data.password.length < 8) errors.password = 'Use pelo menos 8 caracteres';
            const rolesBox = $('[data-roles]', el);
            rolesBox.removeAttribute('aria-invalid');
            if (!showErrors(form, errors)) {
              if (errors.role) rolesBox.setAttribute('aria-invalid', 'true');
              return;
            }
            const dup = rows.find((r) => (r.email || '').toLowerCase() === email && (r.store_id || null) === storeId);
            if (dup) {
              const ok = await confirmDialog({
                title: 'Pessoa já tem este acesso',
                message: `${personName(dup)} já é ${roleLabel(dup.role)} em ${storeLabel(storeId)}${dup.active ? '' : ' (desativado)'}. Atualizar para ${roleLabel(role)} e deixar o acesso ativo?`,
                confirmLabel: 'Atualizar acesso',
              });
              if (!ok) return;
            }
            try {
              const res = await withBusy($('[data-save]', el), () =>
                fn('admin-users', { action: 'create', email, full_name: data.full_name, role, store_id: storeId || undefined, password: data.password || undefined })
              );
              close();
              highlight = res?.staff_id || null;
              const known = rows.find((r) => r.id === res?.staff_id) || dup;
              if (known) Object.assign(known, { role, active: true, full_name: data.full_name || known.full_name });
              else if (res?.staff_id)
                rows.push({ id: res.staff_id, user_id: res.user_id, email, full_name: data.full_name, role, store_id: storeId, active: true, last_sign_in_at: null });
              sortRows();
              draw();
              load({ background: true });
              if (res?.existing_user) {
                openModal({
                  title: dup ? 'Acesso atualizado' : 'Acesso adicionado',
                  size: 'sm',
                  body: html`<div class="stack" style="--gap:12px">
                    <div class="alert alert--success">${icon('check')}<div><strong>${email}</strong> já tinha conta no painel.</div></div>
                    <p>O acesso como <strong>${roleLabel(role)}</strong> em <strong>${storeLabel(storeId)}</strong> foi liberado. A pessoa continua entrando com a senha que já usa — nenhuma senha nova foi criada.</p>
                    ${data.password ? html`<p class="muted small">A senha informada não foi aplicada. Se precisar, use “Redefinir senha” no menu da pessoa.</p>` : ''}
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
                highlight = null;
                $$('tr.is-selected', listEl).forEach((tr) => tr.classList.remove('is-selected'));
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
      openModal({
        title,
        dismissable: false,
        body: html`<div class="stack team-cred" style="--gap:14px">
          <p>${intro}</p>
          <div class="alert alert--warning">${icon('alert')}<div><strong>Copie a senha agora.</strong> Por segurança, ela não será exibida novamente.</div></div>
          <div class="field">
            <label for="team-cred-email">E-mail de acesso</label>
            <input class="input" id="team-cred-email" value="${email}" readonly>
          </div>
          <div class="field">
            <label for="team-cred-pass">Senha</label>
            <div class="team-pass">
              <input class="input" id="team-cred-pass" value="${password || ''}" readonly spellcheck="false" data-pass>
              <button class="btn" type="button" data-copy-pass>${icon('copy', 'icon-sm')} Copiar</button>
            </div>
          </div>
          <p class="muted small">Peça para a pessoa entrar em <strong>${panel}</strong> e trocar a senha em <strong>Minha conta</strong> no primeiro acesso.</p>
        </div>`,
        actions: html`<button class="btn" type="button" data-copy-all>${icon('copy', 'icon-sm')} Copiar dados de acesso</button>
          <button class="btn btn--primary" type="button" data-close>Concluído</button>`,
        onMount(el) {
          const input = $('[data-pass]', el);
          input.addEventListener('focus', () => input.select());
          $('[data-copy-pass]', el).addEventListener('click', async () => {
            toast((await copyText(password, input)) ? 'Senha copiada.' : 'Não foi possível copiar. Selecione e copie manualmente.', 'success');
          });
          $('[data-copy-all]', el).addEventListener('click', async () => {
            const text = `Acesso ao painel Atual Móveis\nEndereço: ${panel}\nE-mail: ${email}\nSenha: ${password}\nTroque a senha em "Minha conta" no primeiro acesso.`;
            toast((await copyText(text, input)) ? 'Dados de acesso copiados.' : 'Não foi possível copiar. Selecione e copie manualmente.', 'success');
          });
        },
      });
    }

    /* ---------- Alterar papel ---------- */
    function changeRole(r) {
      if (!canManage(r.role, r.store_id)) return toastError('Você não pode alterar este acesso.');
      const scopeRoles = (r.store_id ? STORE_ROLES : NETWORK_ROLES).filter((x) => canManage(x, r.store_id));
      openModal({
        title: 'Alterar papel',
        body: html`<form class="stack team-form" style="--gap:14px" id="team-role-form" data-role-form novalidate>
          <div class="team-form__scope"><strong>${personName(r)}</strong> · <span class="muted">${r.email || ''}</span><br>
            <span class="small">${r.store_id ? icon('store', 'icon-sm') : icon('network', 'icon-sm')} ${storeLabel(r.store_id)}</span></div>
          <div class="field">
            <fieldset><legend>Papel</legend><div class="team-roles">${roleChoices(scopeRoles, r.role)}</div></fieldset>
          </div>
          ${isLastSuper(r) ? html`<div class="alert alert--warning">${icon('alert')}<div>Esta é a única pessoa super admin ativa: a rede precisa de pelo menos uma.</div></div>` : ''}
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="submit" form="team-role-form" data-save>Salvar papel</button>`,
        onMount(el, close) {
          const form = $('[data-role-form]', el);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const role = form.querySelector('input[name="role"]:checked')?.value;
            if (!role) return showErrors(form, { role: 'Escolha o papel' });
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
              applyChange(r, { patch: { role }, message: `${personName(r)} agora é ${roleLabel(role)}.` });
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
          title: 'Desativar acesso',
          message: self
            ? `Você vai desativar o seu próprio acesso a ${storeLabel(r.store_id)} e perder essa área do painel imediatamente.`
            : `${personName(r)} deixa de acessar ${storeLabel(r.store_id)} até ser reativado. A conta e o histórico continuam guardados.`,
          confirmLabel: 'Desativar',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        await rowTask(r, () => fn('admin-users', { action: 'update', staff_id: r.id, active: next }));
        applyChange(r, { patch: { active: next }, message: next ? `Acesso de ${personName(r)} reativado.` : `Acesso de ${personName(r)} desativado.` });
      } catch (err) {
        toastError(teamError(err));
      }
    }

    /* ---------- Redefinir senha ---------- */
    async function resetPassword(r) {
      const ok = await confirmDialog({
        title: 'Redefinir senha',
        message: `Gerar uma nova senha para ${personName(r)}? A senha atual deixa de funcionar na hora e vale para todos os acessos desta pessoa.`,
        confirmLabel: 'Gerar nova senha',
      });
      if (!ok) return;
      try {
        const res = await rowTask(r, () => fn('admin-users', { action: 'reset_password', user_id: r.user_id }));
        if (!res?.password) throw new Error('A senha foi redefinida, mas não foi possível exibi-la. Tente de novo.');
        showCredentials({
          title: 'Nova senha gerada',
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
        title: 'Remover acesso',
        message: self
          ? `Remover o seu próprio acesso a ${storeLabel(r.store_id)}? Você perderá essa área do painel imediatamente.`
          : `Remover o acesso de ${personName(r)} (${roleLabel(r.role)}) a ${storeLabel(r.store_id)}? A conta continua existindo e pode receber acesso de novo depois.`,
        confirmLabel: 'Remover acesso',
        danger: true,
      });
      if (!ok) return;
      try {
        await rowTask(r, () => fn('admin-users', { action: 'remove', staff_id: r.id }));
        applyChange(r, { remove: true, message: `Acesso de ${personName(r)} removido.` });
      } catch (err) {
        toastError(teamError(err));
      }
    }

    await load();
  },
};
