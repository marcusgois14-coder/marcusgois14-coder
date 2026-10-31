// Lojas da rede (somente administradores da rede): visão geral, mapa com o raio
// de entrega de cada loja, criação de lojas (com cópia de catálogo) e
// ativação/desativação/exclusão.
import { sb, q, rpc, fn, storefrontUrl } from '../api.js';
import {
  html,
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
  empty,
  errorBlock,
  injectStyle,
  debounce,
  money,
  num,
  slugify,
  openModal,
  confirmDialog,
  badge,
  table,
} from '../ui.js';
import { UFS, SLUG_RE, digits, km, maskCep, storeError, hasLeaflet, baseMap, pinIcon, radiusStyle, MG_CENTER, GEO_PRECISION, geocodeAddress } from './store.js';

const CSS = `
.stnet { display: flex; flex-direction: column; gap: 16px; }
.stnet__kpis .kpi__value { font-variant-numeric: tabular-nums; }
.stnet__map { height: 440px; border: 0; border-radius: 0 0 var(--radius) var(--radius); }
.stnet .card__head { flex-wrap: wrap; row-gap: 6px; }
.stnet__legend { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); }
.stnet__legend i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 50%; vertical-align: -1px; }
.stnet__legend .is-on { background: var(--accent); }
.stnet__legend .is-off { background: #8a8a8a; }
.stnet__legend .is-ring { border: 1.5px solid var(--accent); background: rgba(224, 27, 38, 0.1); }
.stnet__nomap { padding: 10px 18px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--warning); }
.stnet .leaflet-container { font-family: var(--font); }
.stnet-pop { display: flex; flex-direction: column; gap: 6px; min-width: 190px; font-family: var(--font); font-size: 13px; }
.stnet-pop strong { font-size: 14px; color: var(--ink); }
.stnet-pop .row { --gap: 6px; }
.stnet .search { max-width: 360px; }
.stnet__store { display: flex; flex-direction: column; min-width: 180px; }
.stnet__name { padding: 0; border: 0; background: none; color: var(--ink); font-weight: 700; text-align: left; cursor: pointer; }
.stnet__name:hover { color: var(--accent); text-decoration: underline; }
.stnet__actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.stnet .table th, .stnet .table td { padding: 10px 10px; }
.stnet .table th:first-child, .stnet .table td:first-child { padding-left: 14px; }
.stnet .table td { white-space: nowrap; }
.stnet__status { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.stnet-new .fieldset > legend { float: left; width: 100%; padding: 0; }
.stnet-new .fieldset > legend ~ * { clear: left; }
.stnet .table td.stnet__wrap { white-space: normal; }
.stnet-menu { position: fixed; right: auto; top: 0; left: 0; z-index: 90; }
.stnet-new .fieldset__title { margin-bottom: 4px; }
.stnet-new__geo { display: flex; align-items: flex-end; }
.stnet-new__geo .btn { width: 100%; }
.stnet-new__note { font-size: 12.5px; color: var(--muted); }
.stnet-new__note--ok { color: var(--success); }
.stnet-new__note--warn { color: var(--warning); }
.stnet-copy { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.stnet-copy__row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.stnet-copy__row .field { flex: 1 1 240px; }
@media (max-width: 860px) {
  .stnet__map { height: 320px; }
}
@media (max-width: 560px) {
  .stnet .search { max-width: none; min-width: 0; flex-basis: 100%; }
  .stnet__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); --gap: 10px; }
  .stnet__kpis .kpi { padding: 12px 14px; }
  .stnet__kpis .kpi__label { font-size: 11px; }
  .stnet__kpis .kpi__value { font-size: 19px; overflow-wrap: anywhere; }
  .stnet-hide-sm { display: none; }
  .stnet__map { height: 280px; }
  .stnet-copy__row .btn { width: 100%; }
}
`;

const FILTERS = [
  { id: 'all', label: 'Todas', test: () => true },
  { id: 'active', label: 'Ativas', test: (s) => s.active },
  { id: 'inactive', label: 'Inativas', test: (s) => !s.active },
  { id: 'paused', label: 'Pedidos pausados', test: (s) => !s.accepts_orders },
  { id: 'nolocation', label: 'Sem localização', test: (s) => !s.has_location },
];
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;

export default {
  title: 'Lojas',
  async render(view, ctx) {
    injectStyle('stores', CSS);
    if (!ctx.isGlobal) {
      render(view, errorBlock('Somente a administração da rede acessa a lista de lojas.'));
      return;
    }

    const state = { search: '', filter: 'all' };
    let rows = [];
    let maxRadius = 30;
    let net = {};
    let netMap = null;
    let layer = null;
    const markers = new Map();
    let disposed = false;
    let firstFit = true;

    ctx.setActions(
      html`<button class="btn btn--primary btn--sm" type="button" data-new-store aria-label="Nova loja">${icon('plus', 'icon-sm')}<span class="stnet-hide-sm">Nova loja</span></button>`
    );
    $('[data-new-store]')?.addEventListener('click', () => newStore());

    render(
      view,
      html`<div class="stnet">
        <div class="grid grid-4 stnet__kpis" data-kpis></div>
        <section class="card" aria-labelledby="stnet-map-title">
          <div class="card__head">
            <div class="h2" id="stnet-map-title">Mapa da rede</div>
            <div class="stnet__legend"><span><i class="is-on"></i>Ativa</span><span><i class="is-off"></i>Inativa</span><span><i class="is-ring"></i>Raio de entrega</span></div>
          </div>
          <div class="map stnet__map" data-map role="region" aria-label="Mapa com as lojas da rede e o raio de entrega de cada uma"></div>
          <div class="stnet__nomap" data-nomap hidden></div>
        </section>
        <section class="card" aria-labelledby="stnet-list-title">
          <div class="card__head"><div class="h2" id="stnet-list-title">Todas as lojas</div><span class="muted small" data-count></span></div>
          <div class="card__body">
            <div class="toolbar">
              <div class="search">${icon('search')}<label class="visually-hidden" for="stnet-search">Buscar loja</label><input class="input" id="stnet-search" type="search" placeholder="Buscar por nome, cidade ou endereço" data-search autocomplete="off"></div>
              <div class="chips" role="group" aria-label="Filtrar lojas" data-chips></div>
            </div>
            <div data-table>${loading('Carregando lojas…')}</div>
          </div>
        </section>
      </div>`
    );

    // Menu de ações das linhas: fica no <body> com posição fixa para não ser cortado pela rolagem da tabela.
    const menu = document.createElement('div');
    menu.className = 'menu stnet-menu';
    menu.id = 'stnet-row-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    let menuRow = null;
    let menuBtn = null;
    const hideMenu = () => {
      menu.hidden = true;
      menu.removeAttribute('data-open');
      menuBtn?.setAttribute('aria-expanded', 'false');
      menuRow = null;
      menuBtn = null;
    };
    // posiciona o menu junto ao botão, sem sair da tela; devolve false se o botão saiu da tela
    function placeMenu(btn) {
      const r = btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
      const wasHidden = menu.hidden;
      menu.hidden = false;
      const w = menu.offsetWidth || 220;
      const h = menu.offsetHeight || 220;
      menu.hidden = wasHidden;
      let left = Math.min(r.right - w, window.innerWidth - w - 8);
      left = Math.max(8, left);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      return true;
    }
    // rolagem: o menu acompanha o botão (fecha só se o botão sair da tela)
    const onScroll = () => {
      if (menu.hidden || !menuBtn) return;
      if (!menuBtn.isConnected || !placeMenu(menuBtn)) hideMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        const opener = $(`[data-row-menu="${menuRow}"]`, view);
        hideMenu();
        opener?.focus();
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => {
      disposed = true;
      menu.remove();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey);
      try {
        netMap?.remove();
      } catch {
        /* já removido */
      }
    });

    /* ---------- Dados ---------- */
    async function load() {
      try {
        const [overview, geo, settings] = await Promise.all([
          rpc('stores_overview'),
          q(sb.from('stores').select('id, lat, lng, sort_order, cep, street, number')),
          sb
            .from('network_settings')
            .select('default_radius_km, default_pix_discount, default_installments')
            .maybeSingle()
            .then((r) => r.data)
            .catch(() => null),
        ]);
        if (disposed) return;
        net = settings || {};
        maxRadius = Number(net.default_radius_km) || 30;
        const byId = new Map((geo || []).map((g) => [g.id, g]));
        rows = (overview || []).map((s) => ({ ...s, ...(byId.get(s.id) || {}) }));
        drawKpis();
        drawChips();
        drawTable();
        drawMap();
      } catch (e) {
        if (disposed) return;
        render($('[data-table]', view), errorBlock(storeError(e)));
        render($('[data-kpis]', view), '');
      }
    }
    const reloadAll = async () => {
      try {
        await ctx.reloadStores();
      } catch {
        /* seletor atualiza na próxima navegação */
      }
      await load();
    };

    function drawKpis() {
      const active = rows.filter((s) => s.active).length;
      const accepting = rows.filter((s) => s.active && s.accepts_orders).length;
      const pending = rows.reduce((a, s) => a + Number(s.orders_pending || 0), 0);
      const revenue = rows.reduce((a, s) => a + Number(s.revenue_30d || 0), 0);
      const noLoc = rows.filter((s) => !s.has_location).length;
      render(
        $('[data-kpis]', view),
        html`<div class="card kpi"><div class="kpi__label">Lojas</div><div class="kpi__value">${num(rows.length)}</div><div class="kpi__hint">${plural(active, 'ativa', 'ativas')}${rows.length - active ? ` · ${plural(rows.length - active, 'inativa', 'inativas')}` : ''}</div></div>
          <div class="card kpi"><div class="kpi__label">Recebendo pedidos</div><div class="kpi__value">${num(accepting)}</div><div class="kpi__hint">${accepting === active ? 'Todas as lojas ativas' : `${plural(active - accepting, 'ativa pausada', 'ativas pausadas')}`}${noLoc ? ` · ${plural(noLoc, 'sem localização', 'sem localização')}` : ''}</div></div>
          <div class="card kpi"><div class="kpi__label">Pedidos aguardando</div><div class="kpi__value">${num(pending)}</div><div class="kpi__hint">Aguardando confirmação</div></div>
          <div class="card kpi"><div class="kpi__label">Faturamento 30 dias</div><div class="kpi__value">${money(revenue)}</div><div class="kpi__hint">Pedidos não cancelados</div></div>`
      );
    }

    function drawChips() {
      render(
        $('[data-chips]', view),
        FILTERS.map((f) => {
          const n = rows.filter(f.test).length;
          if (f.id !== 'all' && f.id !== state.filter && !n) return '';
          return html`<button class="chip ${state.filter === f.id ? 'is-active' : ''}" type="button" data-filter="${f.id}" aria-pressed="${state.filter === f.id ? 'true' : 'false'}">${f.label}<span class="chip__count">${n}</span></button>`;
        })
      );
    }

    function visibleRows() {
      const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
      const term = norm(state.search.trim());
      return rows.filter((s) => f.test(s) && (!term || norm(`${s.name} ${s.city} ${s.state} ${s.slug} ${s.brand_name}`).includes(term)));
    }

    function drawTable() {
      const list = visibleRows();
      $('[data-count]', view).textContent = list.length === rows.length ? plural(rows.length, 'loja', 'lojas') : `${num(list.length)} de ${num(rows.length)}`;
      if (!rows.length) {
        render($('[data-table]', view), empty('Nenhuma loja cadastrada', 'Crie a primeira loja da rede.', html`<button class="btn btn--primary mt-2" type="button" data-new-store-inline>${icon('plus', 'icon-sm')} Nova loja</button>`));
        return;
      }
      if (!list.length) {
        render($('[data-table]', view), html`<div class="table-wrap">${empty('Nenhuma loja encontrada', 'Ajuste a busca ou o filtro.')}</div>`);
        return;
      }
      render(
        $('[data-table]', view),
        table({
          rows: list,
          rowAttrs: (s) => (s.id === ctx.storeId ? 'class="is-selected"' : ''),
          columns: [
            {
              key: 'name',
              label: 'Loja',
              cls: 'stnet__wrap',
              render: (s) => html`<div class="stnet__store"><button class="stnet__name" type="button" data-config="${s.id}" title="Configurar loja">${s.name}</button><span class="muted small">${s.brand_name} · /loja/${s.slug}</span></div>`,
            },
            { key: 'city', label: 'Cidade', render: (s) => `${s.city}/${s.state}` },
            {
              key: 'active',
              label: 'Status',
              render: (s) => html`<div class="stnet__status">${s.active ? badge('Ativa', 'success') : badge('Inativa', 'dark')}${s.accepts_orders ? badge('Aceitando pedidos', 'info') : badge('Pedidos pausados', 'warning')}</div>`,
            },
            {
              key: 'products',
              label: 'Produtos',
              cls: 'num',
              render: (s) => html`<span title="${num(s.products_active)} ativos de ${num(s.products_total)}">${num(s.products_active)} <span class="muted">/ ${num(s.products_total)}</span></span>`,
            },
            {
              key: 'orders_pending',
              label: 'Aguardando',
              cls: 'num',
              render: (s) => (Number(s.orders_pending) > 0 ? badge(num(s.orders_pending), 'warning') : html`<span class="muted">0</span>`),
            },
            { key: 'revenue_30d', label: 'Vendas 30 dias', cls: 'num', render: (s) => money(s.revenue_30d) },
            { key: 'staff', label: 'Equipe', cls: 'num', render: (s) => num(s.staff) },
            {
              key: 'has_location',
              label: 'Localização',
              render: (s) =>
                s.has_location
                  ? html`<span title="Raio de entrega de ${km(s.delivery_radius_km)} km">${badge('OK', 'success')} <span class="muted small">${km(s.delivery_radius_km)} km</span></span>`
                  : badge('Pendente', 'warning'),
            },
            {
              key: 'actions',
              label: html`<span class="visually-hidden">Ações</span>`,
              cls: 'right',
              render: (s) => html`<div class="stnet__actions">
                <button class="btn btn--sm btn--icon" type="button" data-config="${s.id}" aria-label="Configurar ${s.name}" title="Configurar loja">${icon('edit', 'icon-sm')}</button>
                <button class="btn btn--sm btn--icon" type="button" data-row-menu="${s.id}" data-menu="stnet-row-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações: ${s.name}" title="Mais ações">${icon('dots')}</button>
              </div>`,
            },
          ],
        })
      );
    }

    /* ---------- Mapa ---------- */
    function popupFor(s) {
      const el = document.createElement('div');
      el.className = 'stnet-pop';
      render(
        el,
        html`<strong>${s.name}</strong>
          <span class="muted small">${s.city}/${s.state} · raio de ${km(s.delivery_radius_km)} km</span>
          <div class="row">${s.active ? badge('Ativa', 'success') : badge('Inativa', 'dark')}${s.accepts_orders ? '' : badge('Pedidos pausados', 'warning')}</div>
          <div class="row mt-1">
            <button class="btn btn--sm btn--primary" type="button" data-open>${icon('dashboard', 'icon-sm')} Abrir loja</button>
            <button class="btn btn--sm" type="button" data-cfg>Configurar</button>
          </div>`
      );
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-open]')) ctx.setStore(s.id, '#/dashboard');
        else if (e.target.closest('[data-cfg]')) ctx.setStore(s.id, '#/store');
      });
      return el;
    }

    function drawMap() {
      const el = $('[data-map]', view);
      const noLoc = rows.filter((s) => s.lat == null || s.lng == null);
      const nomap = $('[data-nomap]', view);
      nomap.hidden = !noLoc.length;
      nomap.textContent = noLoc.length ? `Sem localização (fora do mapa): ${noLoc.map((s) => s.name).join(', ')}.` : '';
      if (!hasLeaflet()) {
        el.classList.remove('map');
        render(el, html`<div class="empty">${icon('map')}<strong>Mapa indisponível</strong><span>Não foi possível carregar o mapa agora.</span></div>`);
        return;
      }
      const L = window.L;
      if (!netMap) {
        netMap = baseMap(el, { zoomSnap: 0.5 });
        netMap.setView(MG_CENTER, 7);
        layer = L.layerGroup().addTo(netMap);
      }
      layer.clearLayers();
      markers.clear();
      const pts = [];
      // inativas primeiro, para as ativas ficarem por cima
      [...rows]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => Number(a.active) - Number(b.active))
        .forEach((s) => {
          const ll = [s.lat, s.lng];
          L.circle(ll, { radius: Number(s.delivery_radius_km || 0) * 1000, ...radiusStyle(s.active), interactive: false }).addTo(layer);
          const m = L.marker(ll, { icon: pinIcon(s.active ? '#e01b26' : '#7a7a7a'), title: s.name, alt: s.name, riseOnHover: true }).addTo(layer);
          m.bindPopup(popupFor(s), { minWidth: 200 });
          markers.set(s.id, m);
          pts.push(ll);
        });
      if (firstFit && pts.length) {
        firstFit = false;
        setTimeout(() => {
          if (disposed) return;
          netMap.invalidateSize();
          netMap.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 11 });
        }, 50);
      }
    }

    function focusOnMap(id) {
      const s = rows.find((x) => x.id === id);
      const m = markers.get(id);
      if (!s || !m || !netMap) return toast('Esta loja ainda não tem localização no mapa.', 'warning');
      $('[data-map]', view).scrollIntoView({ block: 'center', behavior: 'smooth' });
      netMap.setView(m.getLatLng(), 10);
      setTimeout(() => m.openPopup(), 250);
    }

    /* ---------- Menu de ações ---------- */
    // O alternador global de ui.js ([data-menu]) abre/fecha o menu no mesmo clique, depois deste código.
    function openRowMenu(btn) {
      const id = btn.dataset.rowMenu;
      const s = rows.find((x) => x.id === id);
      if (!s) return;
      if (!menu.hidden && menuRow === id) {
        // mesmo botão: o alternador global fecha
        menuRow = null;
        menuBtn = null;
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      if (!menu.hidden) {
        // menu aberto em outra linha: fecha antes para o alternador reabrir já no lugar certo
        menu.hidden = true;
        menu.removeAttribute('data-open');
      }
      menuRow = id;
      $$('[data-row-menu]', view).forEach((b) => b.setAttribute('aria-expanded', 'false'));
      render(
        menu,
        html`<button type="button" role="menuitem" data-act="open">${icon('dashboard')} Abrir painel da loja</button>
          <button type="button" role="menuitem" data-act="map">${icon('map')} Ver no mapa</button>
          <a role="menuitem" href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener" data-act="site">${icon('external')} Ver loja virtual</a>
          <hr>
          <button type="button" role="menuitem" data-act="toggle">${icon(s.active ? 'close' : 'check')} ${s.active ? 'Desativar loja' : 'Ativar loja'}</button>
          <button type="button" role="menuitem" class="is-danger" data-act="delete">${icon('trash')} Excluir loja</button>`
      );
      // fica oculto aqui: o alternador global (ui.js) abre no mesmo clique
      menu.hidden = true;
      menuBtn = btn;
      placeMenu(btn);
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => {
        if (!menu.hidden) $('button, a', menu)?.focus();
        else btn.setAttribute('aria-expanded', 'false');
      }, 0);
    }

    menu.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const id = menuRow;
      hideMenu();
      $$('[data-row-menu]', view).forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (!id) return;
      if (a.dataset.act === 'open') ctx.setStore(id, '#/dashboard');
      else if (a.dataset.act === 'map') focusOnMap(id);
      else if (a.dataset.act === 'toggle') toggleActive(id);
      else if (a.dataset.act === 'delete') removeStore(id);
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = $$('button, a', menu);
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });

    /* ---------- Ações ---------- */
    async function toggleActive(id) {
      const s = rows.find((x) => x.id === id);
      if (!s) return;
      const turnOn = !s.active;
      const warn = [];
      if (turnOn && !s.has_location) warn.push('ela ainda não tem localização (não aparece na busca por CEP)');
      if (turnOn && !Number(s.products_active)) warn.push('ela ainda não tem produtos ativos');
      const ok = await confirmDialog({
        title: turnOn ? 'Ativar a loja?' : 'Desativar a loja?',
        message: turnOn
          ? `${s.name} passará a aparecer na loja virtual.${warn.length ? ` Atenção: ${warn.join(' e ')}.` : ''}`
          : `${s.name} deixará de aparecer na loja virtual e na busca por CEP. A equipe continua acessando o painel e os pedidos ficam guardados.`,
        confirmLabel: turnOn ? 'Ativar loja' : 'Desativar loja',
        danger: !turnOn,
      });
      if (!ok) return;
      try {
        await q(sb.from('stores').update({ active: turnOn }).eq('id', id).select('id').single());
        toast(turnOn ? 'Loja ativada.' : 'Loja desativada.', 'success');
        await reloadAll();
      } catch (e) {
        toastError(storeError(e));
      }
    }

    async function removeStore(id) {
      const s = rows.find((x) => x.id === id);
      if (!s) return;
      let orders = 0;
      try {
        const r = await q(sb.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', id));
        orders = Number(r?.count || 0);
      } catch (e) {
        return toastError(storeError(e));
      }
      if (orders > 0) {
        openModal({
          title: 'Não é possível excluir',
          size: 'sm',
          body: html`<div class="stack" style="--gap:10px">
            <p><strong>${s.name}</strong> tem ${plural(orders, 'pedido', 'pedidos')} no histórico. Para manter os registros de vendas e dos clientes, lojas com pedidos não podem ser excluídas.</p>
            <p class="muted">${s.active ? 'Desative a loja para tirá-la da loja virtual. Você pode reativá-la quando quiser.' : 'A loja já está inativa e não aparece na loja virtual.'}</p>
          </div>`,
          actions: html`<button class="btn" type="button" data-close>Fechar</button>${s.active ? html`<button class="btn btn--danger" type="button" data-deactivate>Desativar loja</button>` : ''}`,
          onMount: (el, close) =>
            $('[data-deactivate]', el)?.addEventListener('click', () => {
              close();
              toggleActive(id);
            }),
        });
        return;
      }
      openModal({
        title: 'Excluir loja',
        size: 'sm',
        body: html`<form class="stack" style="--gap:12px" data-del-form novalidate>
          <div class="alert alert--danger">${icon('alert')}<div>Esta ação não pode ser desfeita.</div></div>
          <p>Serão apagados junto com <strong>${s.name}</strong>: ${plural(s.products_total, 'produto', 'produtos')} (com fotos e variações), a vitrine, os banners, os cupons e ${plural(s.staff, 'acesso', 'acessos')} da equipe.</p>
          <div class="field">
            <label for="stnet-del-confirm">Digite <strong>${s.slug}</strong> para confirmar</label>
            <input class="input" id="stnet-del-confirm" autocomplete="off" autocapitalize="off" spellcheck="false" data-del-input>
          </div>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn--danger" type="button" data-del-ok disabled>${icon('trash', 'icon-sm')} Excluir loja</button>`,
        onMount: (el, close) => {
          const input = $('[data-del-input]', el);
          const btn = $('[data-del-ok]', el);
          input.addEventListener('input', () => (btn.disabled = input.value.trim() !== s.slug));
          const go = async () => {
            if (input.value.trim() !== s.slug) return;
            try {
              await withBusy(btn, async () => {
                const del = await q(sb.from('stores').delete().eq('id', id).select('id'));
                if (!del?.length) throw new Error('A loja não foi excluída: verifique suas permissões.');
              });
              close();
              toast(`${s.name} foi excluída.`, 'success');
              if (ctx.storeId === id) {
                ctx.setStore(null, '#/stores');
                return;
              }
              await reloadAll();
            } catch (e) {
              toastError(storeError(e));
            }
          };
          btn.addEventListener('click', go);
          $('[data-del-form]', el).addEventListener('submit', (e) => {
            e.preventDefault();
            go();
          });
        },
      });
    }

    /* ---------- Nova loja ---------- */
    function defaultTiers(radius) {
      const r = Math.round(Number(radius) * 100) / 100;
      return r <= 10 ? [{ up_to_km: r, fee: 0 }] : [{ up_to_km: 10, fee: 0 }, { up_to_km: r, fee: 49.9 }];
    }

    function suggestSlug(name, city) {
      const taken = new Set(ctx.stores.map((s) => s.slug).concat(rows.map((s) => s.slug)));
      const cands = [slugify(city), slugify(name)].filter(Boolean);
      for (const c of cands) if (!taken.has(c)) return c;
      const base = cands[0] || 'loja';
      for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
      return base;
    }

    function newStore() {
      const brands = [...new Set(ctx.stores.map((s) => s.brand_name).filter(Boolean))].sort();
      let slugTouched = false;
      let cityTouched = false;
      let geo = null; // { lat, lng, precision, cep, street, district, number }
      let cepFailed = null; // CEP que a busca não encontrou (não tenta de novo)
      let created = null;

      const modal = openModal({
        title: 'Nova loja',
        size: 'lg',
        body: html`<form class="stnet-new stack" data-new-form novalidate>
          <div class="form-grid">
            <div class="field col-12">
              <label for="stn-name">Nome da loja *</label>
              <input class="input" id="stn-name" name="name" required maxlength="120" placeholder="Atual Móveis - Ubá" autofocus>
            </div>
            <div class="field col-6">
              <label for="stn-brand">Marca *</label>
              <input class="input" id="stn-brand" name="brand_name" required maxlength="60" value="Atual Móveis" list="stn-brands" aria-describedby="stn-brand-hint">
              <datalist id="stn-brands">${brands.map((b) => html`<option value="${b}"></option>`)}</datalist>
              <span class="hint" id="stn-brand-hint">Aparece no topo da loja virtual.</span>
            </div>
            <div class="field col-6">
              <label for="stn-slug">Endereço na loja virtual *</label>
              <div class="input-group"><span class="input-group__addon">/loja/</span><input class="input" id="stn-slug" name="slug" required maxlength="60" autocapitalize="off" spellcheck="false" aria-describedby="stn-slug-hint"></div>
              <span class="hint" id="stn-slug-hint">Gerado pela cidade; letras minúsculas, números e hífens.</span>
            </div>
            <div class="field col-8">
              <label for="stn-city">Cidade *</label>
              <input class="input" id="stn-city" name="city" required maxlength="80" autocomplete="address-level2">
            </div>
            <div class="field col-4">
              <label for="stn-state">UF *</label>
              <select class="select" id="stn-state" name="state" required>${selectOptions(UFS.map((u) => [u, u]), 'MG')}</select>
            </div>
            <div class="field col-6">
              <label for="stn-radius">Raio de entrega *</label>
              <div class="input-group"><input class="input" id="stn-radius" name="delivery_radius_km" type="number" min="1" max="${maxRadius}" step="0.5" value="${maxRadius}" data-type="number" inputmode="decimal" aria-describedby="stn-radius-hint"><span class="input-group__addon">km</span></div>
              <span class="hint" id="stn-radius-hint">Máximo da rede: ${km(maxRadius)} km.</span>
            </div>
            <div class="field col-6" style="justify-content:flex-end">
              <label class="switch">
                <input type="checkbox" name="active">
                <span class="switch__track"></span>
                <span><strong>Publicar na loja virtual</strong><br><span class="muted small">Deixe desligado até completar catálogo e dados.</span></span>
              </label>
            </div>
          </div>
          <fieldset class="fieldset">
            <legend class="fieldset__title">Localização (opcional)</legend>
            <p class="muted small mb-3">Com o CEP buscamos o endereço e o ponto no mapa. Sem CEP, usamos o centro da cidade e você ajusta depois.</p>
            <div class="form-grid">
              <div class="field col-4">
                <label for="stn-cep">CEP</label>
                <input class="input" id="stn-cep" name="cep" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="postal-code">
              </div>
              <div class="field col-4">
                <label for="stn-number">Número</label>
                <input class="input" id="stn-number" name="number" maxlength="20">
              </div>
              <div class="field col-4 stnet-new__geo"><button class="btn" type="button" data-geo>${icon('search', 'icon-sm')} Buscar CEP</button></div>
              <div class="col-12 stnet-new__note" data-geo-note aria-live="polite"></div>
            </div>
          </fieldset>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-create>${icon('plus', 'icon-sm')} Criar loja</button>`,
        onMount: (el) => {
          const form = $('[data-new-form]', el);
          const setNote = (text, tone = '') => {
            const n = $('[data-geo-note]', el);
            n.className = `col-12 stnet-new__note ${tone ? `stnet-new__note--${tone}` : ''}`;
            n.textContent = text;
          };
          form.addEventListener('input', (e) => {
            const t = e.target;
            if (t.name && t.getAttribute('aria-invalid')) {
              t.removeAttribute('aria-invalid');
              $$(`.error[data-for="${t.name}"]`, form).forEach((x) => x.remove());
            }
            if (t.name === 'slug') {
              slugTouched = true;
              t.value = t.value.toLowerCase().replace(/\s+/g, '-');
            }
            if (t.name === 'city') cityTouched = true;
            if (t.name === 'name' && !cityTouched) {
              const m = t.value.match(/\s[-–]\s*([^-–]+)$/);
              form.city.value = m ? m[1].trim() : form.city.value;
            }
            if ((t.name === 'name' || t.name === 'city') && !slugTouched) form.slug.value = suggestSlug(form.elements.name.value, form.city.value);
            if (t.name === 'cep') {
              t.value = maskCep(t.value);
              geo = null;
            }
            if (t.name === 'city' || t.name === 'state') geo = geo?.precision === 'city' ? null : geo;
          });
          form.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.name === 'cep') {
              e.preventDefault();
              $('[data-geo]', el).click();
            }
          });
          $('[data-geo]', el).addEventListener('click', async (e) => {
            const c = digits(form.cep.value);
            if (c.length !== 8) return showErrors(form, { cep: 'Informe os 8 dígitos do CEP.' });
            showErrors(form, {});
            try {
              const r = await withBusy(e.currentTarget, () => fn('geocode', { cep: c, number: form.number.value.trim() }));
              const a = r.address || {};
              if (a.city) {
                form.city.value = a.city;
                cityTouched = true;
              }
              if (a.state && UFS.includes(String(a.state).toUpperCase())) form.state.value = String(a.state).toUpperCase();
              if (!slugTouched) form.slug.value = suggestSlug(form.elements.name.value, form.city.value);
              geo = { lat: Number(r.lat), lng: Number(r.lng), precision: r.precision, cep: c, street: a.street || null, district: a.district || null, number: form.number.value.trim() || null };
              const where = [a.street, form.number.value.trim(), a.district, a.city && `${a.city}/${a.state}`].filter(Boolean).join(', ');
              setNote(`${where || 'Endereço encontrado'} · ${GEO_PRECISION[r.precision] || ''}`, r.precision === 'city' ? 'warn' : 'ok');
            } catch (err) {
              geo = null;
              cepFailed = c;
              setNote(`${String(err.message || 'Não encontramos este CEP').replace(/\.?$/, '.')} Ao criar, usaremos o centro da cidade.`, 'warn');
            }
          });
          $('[data-create]', el).addEventListener('click', (e) => create(form, e.currentTarget, setNote));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            create(form, $('[data-create]', el), setNote);
          });
        },
        onClose: () => {
          if (created) reloadAll();
        },
      });

      async function create(form, btn, setNote) {
        if (created) return;
        const d = readForm(form);
        const errors = {};
        if (!d.name || d.name.length < 3) errors.name = 'Informe o nome da loja (mínimo de 3 letras).';
        if (!d.brand_name) errors.brand_name = 'Informe a marca.';
        const taken = new Set(ctx.stores.map((s) => s.slug).concat(rows.map((s) => s.slug)));
        if (!d.slug) errors.slug = 'Informe o endereço da loja virtual.';
        else if (!SLUG_RE.test(d.slug)) errors.slug = 'Use só letras minúsculas, números e hífens (ex.: uba).';
        else if (taken.has(d.slug)) errors.slug = 'Já existe uma loja com este endereço.';
        if (!d.city) errors.city = 'Informe a cidade.';
        if (!UFS.includes(d.state || '')) errors.state = 'Escolha a UF.';
        if (!(d.delivery_radius_km > 0)) errors.delivery_radius_km = 'Informe o raio em km.';
        else if (d.delivery_radius_km > maxRadius) errors.delivery_radius_km = `O máximo da rede é ${km(maxRadius)} km.`;
        const c = digits(d.cep);
        if (d.cep && c.length !== 8) errors.cep = 'CEP inválido: informe os 8 dígitos.';
        if (!showErrors(form, errors)) return;

        await withBusy(btn, async () => {
          // localização: CEP (se informado) e, em último caso, o centro da cidade
          let loc = geo;
          if (!loc) {
            const tries = [];
            if (c.length === 8 && c !== cepFailed) tries.push({ cep: c, number: d.number || '' });
            tries.push({ city: d.city, state: d.state });
            for (const body of tries) {
              try {
                const r = await geocodeAddress(body, { fallback: !body.cep });
                if (Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lng))) {
                  const a = body.cep ? r.address || {} : {};
                  loc = { lat: Number(r.lat), lng: Number(r.lng), precision: r.precision, cep: body.cep || null, street: a.street || null, district: a.district || null };
                  break;
                }
              } catch {
                /* tenta a próxima forma */
              }
            }
          }
          const maxSort = Math.max(0, ...rows.map((s) => Number(s.sort_order) || 0), ...ctx.stores.map((s) => Number(s.sort_order) || 0));
          const row = {
            name: d.name,
            brand_name: d.brand_name,
            slug: d.slug,
            city: d.city,
            state: d.state,
            delivery_radius_km: d.delivery_radius_km,
            delivery_fee_tiers: defaultTiers(d.delivery_radius_km),
            active: !!d.active,
            sort_order: maxSort + 1,
            cep: loc?.cep || (c.length === 8 ? c : null),
            street: loc?.street || null,
            district: loc?.district || null,
            number: d.number || null,
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null,
          };
          if (net.default_pix_discount != null) row.pix_discount_pct = Number(net.default_pix_discount);
          if (net.default_installments != null) row.max_installments = Number(net.default_installments);
          try {
            created = await q(sb.from('stores').insert(row).select('*').single());
          } catch (e) {
            toastError(storeError(e));
            return;
          }
          try {
            await ctx.reloadStores();
          } catch {
            /* atualiza depois */
          }
          load();
          stepTwo(created, loc);
        });
      }

      // Passo 2: loja criada → oferece copiar o catálogo de outra loja.
      function stepTwo(s, loc) {
        const el = modal.el;
        const sources = rows.filter((x) => x.id !== s.id && Number(x.products_total) > 0);
        $('.modal__title', el).textContent = 'Loja criada';
        el.setAttribute('aria-label', 'Loja criada');
        render(
          $('.modal__body', el),
          html`<div class="stack">
            <div class="alert alert--success">${icon('check')}<div><strong>${s.name}</strong> foi criada${s.active ? ' e já aparece na loja virtual' : ' como inativa: ela só aparece na loja virtual depois de ativada'}.</div></div>
            ${loc
              ? loc.precision === 'city'
                ? html`<div class="alert alert--warning">${icon('alert')}<div>Usamos o centro de ${s.city} como localização. Ajuste o ponto exato em Configurar → Endereço e mapa.</div></div>`
                : ''
              : html`<div class="alert alert--warning">${icon('alert')}<div>Não encontramos a localização. Defina o ponto no mapa em Configurar → Endereço e mapa.</div></div>`}
            <section class="stnet-copy stack" style="--gap:10px" aria-labelledby="stn-copy-title">
              <div><div class="h3" id="stn-copy-title">Copiar catálogo de outra loja</div>
              <p class="muted small">Os produtos entram como rascunho e sem estoque, com fotos e variações, para você revisar preços antes de publicar.</p></div>
              ${sources.length
                ? html`<div class="stnet-copy__row">
                    <div class="field">
                      <label for="stn-src">Loja de origem</label>
                      <select class="select" id="stn-src">${selectOptions(
                        sources.map((x) => [x.id, `${x.name} (${plural(x.products_total, 'produto', 'produtos')})`]),
                        sources[0].id
                      )}</select>
                    </div>
                    <button class="btn btn--primary" type="button" data-copy>${icon('copy', 'icon-sm')} Copiar produtos</button>
                  </div>
                  <div class="small muted" data-copy-status aria-live="polite"></div>`
                : html`<p class="muted small">Nenhuma outra loja tem produtos para copiar.</p>`}
            </section>
          </div>`
        );
        render(
          $('.modal__foot', el),
          html`<button class="btn" type="button" data-close>Concluir</button>
            <button class="btn btn--primary" type="button" data-go-config>${icon('edit', 'icon-sm')} Configurar a loja</button>`
        );
        $('[data-go-config]', el).addEventListener('click', () => {
          modal.close();
          ctx.setStore(s.id, '#/store');
        });
        $('[data-copy]', el)?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const src = $('#stn-src', el).value;
          const srcRow = rows.find((x) => x.id === src);
          const status = $('[data-copy-status]', el);
          const ok = await confirmDialog({
            title: 'Copiar catálogo?',
            message: `Copiar ${plural(srcRow?.products_total || 0, 'produto', 'produtos')} de ${srcRow?.name || 'outra loja'} para ${s.name} como rascunho?`,
            confirmLabel: 'Copiar produtos',
          });
          if (!ok) return;
          try {
            let result = { created: 0, skipped: 0 };
            await withBusy(btn, async () => {
              const ids = [];
              for (let from = 0; ; from += 1000) {
                const page = await q(sb.from('products').select('id').eq('store_id', src).order('created_at').range(from, from + 999));
                ids.push(...page.map((p) => p.id));
                if (page.length < 1000) break;
              }
              if (!ids.length) throw new Error('A loja de origem não tem produtos.');
              const CHUNK = 50;
              for (let i = 0; i < ids.length; i += CHUNK) {
                status.textContent = `Copiando ${num(Math.min(i + CHUNK, ids.length))} de ${num(ids.length)}…`;
                const r = await rpc('duplicate_products', { p_ids: ids.slice(i, i + CHUNK), p_targets: [s.id], p_status: 'draft' });
                result.created += Number(r?.created || 0);
                result.skipped += Number(r?.skipped || 0);
              }
            });
            status.className = 'small stnet-new__note--ok';
            status.textContent = `${plural(result.created, 'produto copiado', 'produtos copiados')} como rascunho.`;
            btn.disabled = true;
            $('#stn-src', el).disabled = true;
            toast(`${plural(result.created, 'produto copiado', 'produtos copiados')} para ${s.name}.`, 'success');
            load();
          } catch (err) {
            status.className = 'small stnet-new__note--warn';
            status.textContent = 'A cópia não terminou. Os produtos já copiados ficaram como rascunho na nova loja.';
            toastError(storeError(err));
            load();
          }
        });
      }
    }

    /* ---------- Eventos ---------- */
    const onSearch = debounce(() => drawTable(), 150);
    view.addEventListener('input', (e) => {
      if (e.target.matches('[data-search]')) {
        state.search = e.target.value;
        onSearch();
      }
    });
    view.addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) {
        state.filter = f.dataset.filter;
        drawChips();
        drawTable();
        return;
      }
      const cfg = e.target.closest('[data-config]');
      if (cfg) return ctx.setStore(cfg.dataset.config, '#/store');
      const rm = e.target.closest('[data-row-menu]');
      if (rm) return openRowMenu(rm);
      if (e.target.closest('[data-new-store-inline]')) newStore();
    });

    // Novos pedidos mudam os contadores "aguardando".
    const refresh = debounce(() => !disposed && load(), 1500);
    ctx.on('new-order', refresh);
    ctx.on('order-updated', refresh);

    await load();
  },
};
