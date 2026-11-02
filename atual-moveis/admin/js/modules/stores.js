// Lojas da rede (somente administradores da rede): indicadores, lista com abas de situação, busca, marca e
// ordenação, ativação direto na linha, mapa com o raio de entrega de cada loja, criação de lojas (com cópia
// de catálogo), edição rápida, ordem das lojas na loja virtual e exclusão.
import { sb, q, rpc, storefrontUrl } from '../api.js';
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
  skeleton,
  empty,
  errorBlock,
  injectStyle,
  debounce,
  money,
  num,
  slugify,
  fold,
  openModal,
  confirmDialog,
  badge,
  table,
  kpiCard,
  waitKpi,
  storeMark,
  art,
} from '../ui.js';
import { ufOptions, UFS, SLUG_RE, digits, km, maskCep, storeError, hasLeaflet, baseMap, markPin, radiusStyle, MG_CENTER, MAP_CSS, GEO_PRECISION, geocodeAddress } from './store.js';

const CSS = `
.stn { display: flex; flex-direction: column; gap: 18px; }
.stn .kpi__value small { font-size: 17px; font-weight: 700; color: var(--muted); }
.stn-card { overflow: hidden; }
.stn-card > .tabs { margin: 0; padding: 0 12px; }
.stn-tb { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.stn-tb .search { max-width: 360px; }
.stn-tb__sum { font-size: 13px; color: var(--muted); white-space: nowrap; }
.stn-tb__sum strong { color: var(--ink); font-weight: 600; }
.stn-card .table-wrap { border: 0; border-radius: 0; box-shadow: none; }
.stn .table th:first-child, .stn .table td:first-child { padding-left: 18px; }
.stn .table th:last-child, .stn .table td:last-child { padding-right: 14px; }
.stn .table td { white-space: nowrap; }
.stn-store { display: flex; align-items: center; gap: 12px; min-width: 230px; white-space: normal; }
.stn-store__txt { min-width: 0; }
.stn-name { display: block; padding: 0; border: 0; background: none; font: 600 14px/1.25 var(--font-ui); color: var(--ink); text-align: left; cursor: pointer; }
.stn-name:hover { color: var(--accent-ink); text-decoration: underline; text-underline-offset: 2px; }
.stn .sub { display: block; margin-top: 2px; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.stn-sit { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.stn-sit .stn-noloc { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--warn-fg); }
.stn-num strong, .stn-money { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.stn-rev { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 5px; }
.stn-rev .meter { width: 92px; height: 4px; }
.stn-wait { height: 26px; padding: 0 10px; border-radius: 999px; border: 0; background: var(--warn-bg); box-shadow: inset 0 0 0 1px var(--warn-line); color: var(--warn-fg); font: 600 12.5px/1 var(--font-ui); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.stn-wait:hover { box-shadow: inset 0 0 0 1px var(--warn-dot); }
.stn-wait .icon-xs { width: 12px; height: 12px; }
.stn-zero { color: var(--faint); }
.stn-team { display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-variant-numeric: tabular-nums; }
.stn-team .icon-sm { color: var(--muted); }
.stn-switch { align-items: center; }
.stn-switch .switch__track { margin-top: 0; }
.stn-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.stn-menu { position: fixed; right: auto; top: 0; left: 0; z-index: var(--z-popover); min-width: 228px; }
.stn-mapcard .card__head { padding-bottom: 14px; }
.stn-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--muted); }
.stn-legend span { display: inline-flex; align-items: center; gap: 6px; }
.stn-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 4px; }
.stn-legend .is-on { background: var(--raised); box-shadow: 0 0 0 2px var(--accent); }
.stn-legend .is-off { background: var(--surface-3); box-shadow: 0 0 0 2px var(--faint); }
.stn-legend .is-ring { border-radius: 50%; border: 1.5px solid var(--chart-main); background: color-mix(in srgb, var(--chart-main) 12%, transparent); }
.stn-map { height: 460px; border: 0; border-top: 1px solid var(--line); border-radius: 0 0 var(--r-lg) var(--r-lg); }
.stn-nomap { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); background: var(--warn-bg); font-size: 13px; color: var(--text); border-radius: 0 0 var(--r-lg) var(--r-lg); }
.stn-nomap > .icon-sm { color: var(--warn-fg); }
.stn-nomap .chip { height: 28px; }
.stn-map.has-foot { border-radius: 0; }
.stn-pop { display: flex; flex-direction: column; gap: 8px; min-width: 210px; }
.stn-pop__who { display: flex; gap: 10px; align-items: center; }
.stn-pop__who strong { display: block; font: 700 14.5px/1.2 var(--font-display); color: var(--ink); }
.stn-pop__who span { font-size: 12px; color: var(--muted); }
.stn-pop__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stn-pop__stats b { display: block; font: 700 14px/1.2 var(--font-display); color: var(--ink); font-variant-numeric: tabular-nums; }
.stn-pop__stats span { font-size: 11.5px; color: var(--muted); }
.stn-pop__acts { display: flex; gap: 6px; }
/* Janela "Nova loja" / "Editar loja" */
.stn-form .fieldset > legend { float: left; width: 100%; padding: 0; }
.stn-form .fieldset > legend ~ * { clear: left; }
.stn-form .fieldset + .fieldset { margin-top: 20px; padding-top: 20px; }
.stn-form .fieldset__title { display: flex; align-items: center; gap: 8px; }
.stn-form .fieldset__title .icon-sm { color: var(--muted); }
.stn-form .fieldset > p.muted { margin: -4px 0 12px; font-size: 13px; }
.stn-prev { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 18px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
.stn-prev strong { display: block; font: 700 16px/1.2 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
.stn-prev span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.stn-prev .tag { margin-left: auto; flex: none; }
.stn-sw { display: flex; align-items: flex-end; }
.stn-inl { display: inline-flex; align-items: center; gap: 6px; }
.stn-sw .switch { padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); width: 100%; }
.stn-geo { display: flex; align-items: flex-end; }
.stn-geo .btn { width: 100%; }
.stn-note { font-size: 12.5px; color: var(--muted); }
.stn-note:empty { display: none; }
.stn-note--ok { color: var(--ok-fg); }
.stn-note--warn { color: var(--warn-fg); }
.stn-done { display: flex; gap: 16px; align-items: center; }
.stn-done .art { flex: none; }
.stn-done strong { display: block; font: 800 19px/1.2 var(--font-display); color: var(--ink); margin-bottom: 4px; }
.stn-done p { font-size: 13.5px; color: var(--text); }
.stn-copy { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
.stn-copy__head { display: flex; gap: 10px; align-items: flex-start; }
.stn-copy__head > .icon { color: var(--muted); margin-top: 2px; }
.stn-copy__head strong { display: block; font: 700 15.5px/1.25 var(--font-display); color: var(--ink); }
.stn-copy__head p { font-size: 13px; color: var(--muted); }
.stn-copy__row { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 10px; align-items: end; }
.stn-copy__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; }
.stn-copy__foot .btn--dark { margin-left: auto; }
.stn-copy__prog { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text); }
.stn-copy__prog:empty { display: none; }
.stn-copy__prog .meter { height: 6px; }
/* Reordenar */
.stn-order { display: flex; flex-direction: column; gap: 6px; max-height: min(56vh, 560px); overflow: auto; padding: 2px; }
.stn-order li { display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--raised); }
.stn-order li.is-dragging { opacity: 0.5; border-style: dashed; }
.stn-order li.is-moved { box-shadow: inset 3px 0 0 var(--highlight); }
.stn-order__grip { display: grid; place-items: center; width: 26px; height: 32px; color: var(--faint); cursor: grab; flex: none; }
.stn-order__n { width: 22px; flex: none; font: 700 12.5px/1 var(--font-ui); color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.stn-order__txt { min-width: 0; flex: 1; }
.stn-order__txt strong { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stn-order__txt span { font-size: 12px; color: var(--muted); }
.stn-order__btns { display: flex; gap: 2px; flex: none; }
.stn-del { display: flex; flex-direction: column; gap: 12px; }
.stn-del ul { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; }
.stn-del li { display: flex; gap: 8px; align-items: center; }
.stn-del li .icon-sm { color: var(--muted); }
.stn-del code { font-family: var(--font-mono); font-size: 12.5px; padding: 1px 6px; border-radius: 6px; background: var(--surface-3); color: var(--ink); }
@media (max-width: 1279px) {
  .stn .col-team, .stn .col-ent { display: none; }
}
@media (max-width: 1023px) {
  .stn .col-prod { display: none; }
  .stn-store { min-width: 180px; }
  .stn-actions [data-edit] { display: none; }
}
@media (max-width: 767px) {
  .stn { gap: 14px; }
  .stn-map { height: 340px; }
  .stn-tb { padding: 12px; }
  .stn-tb .search { max-width: none; }
  .stn-card > .tabs { padding: 0 6px; }
  .stn-copy__row { grid-template-columns: minmax(0, 1fr); }
  .stn-copy__foot .btn--dark { width: 100%; margin-left: 0; }
  .stn-done { flex-direction: column; text-align: center; }
  .stn-order__n { display: none; }
}
/* Celular: cartões */
.stn-mlist { display: flex; flex-direction: column; }
.stn-mcard { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.stn-mcard:last-child { border-bottom: 0; }
.stn-mcard.is-selected { background: var(--row-selected); }
.stn-mcard__top { display: flex; align-items: center; gap: 12px; }
.stn-mcard__top .stn-store__txt { flex: 1; min-width: 0; }
.stn-mcard__top .stn-name { font-size: 15px; }
.stn-mcard__top .sub { white-space: normal; }
.stn-mcard__top .btn--icon { margin-right: -8px; }
.stn-mcard__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.stn-sit--row { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px; }
.stn-mcard__stats { display: grid; grid-template-columns: 1.4fr 1fr 0.8fr; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
.stn-mcard__stats dt { font-size: 11.5px; color: var(--muted); }
.stn-mcard__stats dd { margin: 2px 0 0; font: 700 14px/1.2 var(--font-display); color: var(--ink); font-variant-numeric: tabular-nums; }
.stn-mcard__stats dd span:not(.meter):not(.meter span) { font: 500 12px var(--font-ui); color: var(--muted); }
.stn-mcard__stats .meter { display: block; height: 4px; margin-top: 6px; }
@media (max-width: 767px) {
  .stn-tb .sel__ico { display: none; }
  .stn-tb .sel__trigger { flex: 1 1 auto; }
}
`;

const FILTERS = [
  { id: 'all', label: 'Todas', test: () => true },
  { id: 'active', label: 'Ativas', dot: 'ok', test: (s) => s.active },
  { id: 'inactive', label: 'Inativas', dot: 'neu', test: (s) => !s.active },
  { id: 'paused', label: 'Pedidos pausados', dot: 'warn', test: (s) => s.active && !s.accepts_orders },
  { id: 'nolocation', label: 'Sem localização', dot: 'warn', test: (s) => !s.has_location },
];
const SORTS = [
  { id: 'order', label: 'Padrão', hint: 'Ordem das lojas na loja virtual', icon: 'grip', dir: 'asc', get: (s) => Number(s.sort_order) || 0 },
  { id: 'name', label: 'Nome', hint: 'De A a Z', icon: 'list', dir: 'asc', get: (s) => fold(s.name) },
  { id: 'revenue', label: 'Vendas', hint: 'Últimos 30 dias, maior primeiro', icon: 'cash', dir: 'desc', get: (s) => Number(s.revenue_30d) || 0 },
  { id: 'pending', label: 'Aguardando', hint: 'Mais pedidos aguardando primeiro', icon: 'clock', dir: 'desc', get: (s) => Number(s.orders_pending) || 0 },
  { id: 'products', label: 'Produtos', hint: 'Mais produtos ativos primeiro', icon: 'products', dir: 'desc', get: (s) => Number(s.products_active) || 0 },
  { id: 'staff', label: 'Equipe', hint: 'Mais pessoas com acesso primeiro', icon: 'team', dir: 'desc', get: (s) => Number(s.staff) || 0 },
];
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const SORT_KEY = 'atual-admin-stores-sort';
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
// Sigla da marca para o filtro (as lojas usam a sigla da cidade; a marca usa as iniciais)
function brandMark(brand) {
  if (/tavares/i.test(brand)) return ['LT', 'tav'];
  if (/^ativa/i.test(brand)) return ['AV', 'ativa'];
  const w = fold(brand).toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return [(w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || ''), 'atual'];
}

export default {
  title: 'Lojas',
  async render(view, ctx) {
    injectStyle('store-map', MAP_CSS);
    injectStyle('stores', CSS);
    if (!ctx.isGlobal) {
      render(
        view,
        empty('Esta área é da administração da rede', 'A lista de lojas, a criação e a ativação de lojas ficam com a administração da rede.', html`<a class="btn" href="#/dashboard">${icon('dashboard', 'icon-sm')} Voltar ao Painel</a>`, {
          art: 'no-access',
          size: 'lg',
        })
      );
      return;
    }

    let savedSort = null;
    try {
      savedSort = JSON.parse(lsGet(SORT_KEY) || 'null');
    } catch {
      savedSort = null;
    }
    const state = {
      search: ctx.query?.q || '',
      filter: FILTERS.some((f) => f.id === ctx.query?.status) ? ctx.query.status : 'all',
      brand: '',
      sort: SORTS.some((s) => s.id === savedSort?.key) ? { key: savedSort.key, dir: savedSort.dir === 'desc' ? 'desc' : 'asc' } : { key: 'order', dir: 'asc' },
    };
    let rows = [];
    let ages = null;
    let maxRadius = 30;
    let net = {};
    let netMap = null;
    let layer = null;
    const markers = new Map();
    let disposed = false;
    let firstFit = true;
    let mqMobile;
    try {
      mqMobile = matchMedia('(max-width: 767px)');
    } catch {
      mqMobile = { matches: false };
    }
    let loaded = false;

    ctx.setActions(
      html`<button class="btn" type="button" data-reorder>${icon('grip', 'icon-sm')}<span>Reordenar</span></button>
        <button class="btn btn--primary" type="button" data-new-store>${icon('plus', 'icon-sm')}<span>Nova loja</span></button>`
    );
    $('[data-new-store]')?.addEventListener('click', () => storeForm());
    $('[data-reorder]')?.addEventListener('click', () => reorder());

    render(
      view,
      html`<div class="stn">
        <section class="kpis" data-kpis aria-label="Resumo da rede">${skeleton('kpis')}</section>
        <section class="card stn-card" aria-label="Lojas da rede">
          <div class="tabs" role="tablist" aria-label="Situação da loja" data-tabs></div>
          <div class="toolbar stn-tb" role="search">
            <div class="search">
              ${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="stn-search">Buscar loja</label>
              <input class="input" id="stn-search" type="search" value="${state.search}" placeholder="Loja, cidade ou endereço" data-stn-search autocomplete="off" enterkeyhint="search">
              <span class="kbd kbd--sm" aria-hidden="true">/</span>
            </div>
            <label class="visually-hidden" for="stn-brand">Marca</label>
            <select class="select" id="stn-brand" data-brand data-prefix="Marca" data-sheet-title="Marca" data-search="false"><option value="">Todas</option></select>
            <label class="visually-hidden" for="stn-sort">Ordenar por</label>
            <select class="select" id="stn-sort" data-sort-select data-prefix="Ordenar" data-sheet-title="Ordenar por" data-search="false">${SORTS.map(
              (s) => html`<option value="${s.id}" data-icon="${s.icon}" data-hint="${s.hint}" ${s.id === state.sort.key ? 'selected' : ''}>${s.label}</option>`
            )}</select>
            <button class="btn btn--ghost btn--sm" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
            <span class="toolbar__spacer"></span>
            <span class="stn-tb__sum" data-stn-count aria-live="polite"></span>
          </div>
          <div id="stn-panel" role="tabpanel" data-table>${skeleton('table', { rows: 8, cols: 5 })}</div>
        </section>
        <section class="card stn-mapcard" aria-labelledby="stn-map-title">
          <div class="card__head">
            <div><h2 class="card__title" id="stn-map-title">${icon('map', 'icon-sm')} Mapa da rede</h2><p class="card__sub">Cada círculo é a área de entrega da loja. Clique num pino para abrir a loja.</p></div>
            <div class="stn-legend" aria-hidden="true"><span><i class="is-on"></i>Ativa</span><span><i class="is-off"></i>Inativa</span><span><i class="is-ring"></i>Raio de entrega</span></div>
          </div>
          <div class="map stn-map" data-map role="region" aria-label="Mapa com as lojas da rede e o raio de entrega de cada uma"></div>
          <div class="stn-nomap" data-nomap hidden></div>
        </section>
      </div>`
    );

    // Menu de ações das linhas: fica no <body> com posição fixa para não ser cortado pela rolagem da tabela.
    const menu = document.createElement('div');
    menu.className = 'menu stn-menu';
    menu.id = 'stn-row-menu';
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
      const w = menu.offsetWidth || 230;
      const h = menu.offsetHeight || 260;
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
        const opener = menuBtn;
        hideMenu();
        opener?.focus();
        return;
      }
      // "/" leva para a busca da lista
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable], [role="combobox"]') && !document.querySelector('.modal, .panel, .cmdk')) {
        e.preventDefault();
        $('[data-stn-search]', view)?.focus();
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
        netMap?.stop();
        netMap?.remove();
      } catch {
        /* já removido */
      }
    });

    /* ---------- Dados ---------- */
    async function load() {
      try {
        const [overview, geo, settings, pend] = await Promise.all([
          rpc('stores_overview'),
          q(sb.from('stores').select('id, lat, lng, sort_order, cep, street, number, district')),
          sb
            .from('network_settings')
            .select('default_radius_km, default_pix_discount, default_installments')
            .maybeSingle()
            .then((r) => r.data)
            .catch(() => null),
          sb
            .from('orders')
            .select('created_at')
            .eq('status', 'pending')
            .then((r) => (r.error ? null : r.data))
            .catch(() => null),
        ]);
        if (disposed) return;
        net = settings || {};
        maxRadius = Number(net.default_radius_km) || 30;
        const byId = new Map((geo || []).map((g) => [g.id, g]));
        rows = (overview || []).map((s) => ({ ...s, ...(byId.get(s.id) || {}) }));
        ages = pend ? pend.map((o) => (Date.now() - new Date(o.created_at).getTime()) / 60000).sort((a, b) => b - a) : null;
        loaded = true;
        ctx.setTitle('Lojas', `${plural(rows.length, 'loja', 'lojas')} na rede · situação, entrega e vendas dos últimos 30 dias`);
        drawKpis();
        drawBrands();
        drawTabs();
        drawTable();
        drawMap();
      } catch (e) {
        if (disposed) return;
        render($('[data-table]', view), errorBlock(storeError(e), { retry: () => load() }));
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
      const n = rows.length;
      const active = rows.filter((s) => s.active).length;
      const accepting = rows.filter((s) => s.active && s.accepts_orders).length;
      const paused = active - accepting;
      const pending = rows.reduce((a, s) => a + Number(s.orders_pending || 0), 0);
      const revenue = rows.reduce((a, s) => a + Number(s.revenue_30d || 0), 0);
      const noLoc = rows.filter((s) => !s.has_location).length;
      const top = [...rows].sort((a, b) => Number(b.revenue_30d || 0) - Number(a.revenue_30d || 0))[0];
      const withPending = rows.filter((s) => Number(s.orders_pending) > 0).length;
      render(
        $('[data-kpis]', view),
        html`${kpiCard({
          label: 'Lojas na rede',
          icon: 'stores',
          value: num(n),
          sub: `${plural(active, 'ativa', 'ativas')}${n - active ? ` · ${plural(n - active, 'inativa', 'inativas')}` : ''}${noLoc ? ` · ${plural(noLoc, 'sem localização', 'sem localização')}` : ''}`,
        })}
        ${kpiCard({
          label: 'Recebendo pedidos',
          icon: 'checkCircle',
          value: html`${num(accepting)}<small> de ${num(active)}</small>`,
          sub: paused ? `${plural(paused, 'loja com pedidos pausados', 'lojas com pedidos pausados')}` : 'Todas as lojas ativas recebem pedidos',
          info: 'Lojas ativas com “Aceitar pedidos pelo site” ligado.',
        })}
        ${ages
          ? waitKpi({ ages, href: '#/orders?status=pending' })
          : kpiCard({ label: 'Aguardando confirmação', icon: 'clock', value: num(pending), sub: pending ? `Em ${plural(withPending, 'loja', 'lojas')}` : 'Nada aguardando', href: '#/orders?status=pending' })}
        ${kpiCard({
          label: 'Vendas em 30 dias',
          icon: 'cash',
          value: money(revenue),
          split: true,
          sub: top && Number(top.revenue_30d) > 0 ? `Maior: ${ctx.storeShort?.(top) || top.name} (${money(top.revenue_30d)})` : 'Pedidos não cancelados',
          info: 'Soma dos pedidos não cancelados dos últimos 30 dias, em todas as lojas.',
          href: '#/reports',
        })}`
      );
    }

    function drawBrands() {
      const sel = $('[data-brand]', view);
      const counts = new Map();
      rows.forEach((s) => counts.set(s.brand_name, (counts.get(s.brand_name) || 0) + 1));
      if (state.brand && !counts.has(state.brand)) state.brand = '';
      render(
        sel,
        html`<option value="" data-icon="layers" data-hint="${plural(rows.length, 'loja', 'lojas')}" ${state.brand ? '' : 'selected'}>Todas</option>${[...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([b, n]) => {
            const [ini, tone] = brandMark(b);
            return html`<option value="${b}" data-mark="${ini}" data-mark-tone="${tone}" data-hint="${plural(n, 'loja', 'lojas')}" ${b === state.brand ? 'selected' : ''}>${b}</option>`;
          })}`
      );
    }

    function drawTabs() {
      render(
        $('[data-tabs]', view),
        FILTERS.map((f) => {
          const n = rows.filter(f.test).length;
          if (f.id !== 'all' && f.id !== state.filter && !n) return '';
          const on = state.filter === f.id;
          return html`<button class="tab ${on ? 'is-active' : ''}" type="button" role="tab" aria-selected="${on ? 'true' : 'false'}" aria-controls="stn-panel" tabindex="${on ? 0 : -1}" data-filter="${f.id}">${
            f.dot ? html`<span class="dot dot--sm" style="--d:var(--${f.dot}-dot)" aria-hidden="true"></span>` : ''
          }${f.label}<span class="tab__n ${f.dot === 'warn' && n ? 'tab__n--warn' : ''}">${num(n)}</span></button>`;
        })
      );
    }

    function visibleRows() {
      const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
      const term = fold(state.search.trim());
      const sorter = SORTS.find((s) => s.id === state.sort.key) || SORTS[0];
      const dir = state.sort.dir === 'desc' ? -1 : 1;
      return rows
        .filter(
          (s) =>
            f.test(s) &&
            (!state.brand || s.brand_name === state.brand) &&
            (!term || fold(`${s.name} ${s.city} ${s.state} ${s.slug} ${s.brand_name} ${s.street || ''} ${s.district || ''} ${s.cep || ''}`).includes(term))
        )
        .sort((a, b) => {
          const x = sorter.get(a);
          const y = sorter.get(b);
          const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
          return c * dir || fold(a.name).localeCompare(fold(b.name));
        });
    }

    const situation = (s) =>
      !s.active ? badge('Inativa', 'dark') : s.accepts_orders ? badge('Recebendo pedidos', 'success') : badge('Pedidos pausados', 'warning');

    function drawTable() {
      const list = visibleRows();
      const filtered = state.search.trim() || state.brand || state.filter !== 'all';
      $('[data-clear]', view).hidden = !filtered;
      render(
        $('[data-stn-count]', view),
        list.length === rows.length ? html`<strong>${num(rows.length)}</strong> ${rows.length === 1 ? 'loja' : 'lojas'}` : html`<strong>${num(list.length)}</strong> de ${num(rows.length)} lojas`
      );
      if (!rows.length) {
        render(
          $('[data-table]', view),
          empty('Nenhuma loja cadastrada', 'Crie a primeira loja da rede. Depois dá para copiar o catálogo de outra loja.', html`<button class="btn btn--primary" type="button" data-new-store-inline>${icon('plus', 'icon-sm')} Nova loja</button>`, {
            art: 'empty-box',
            size: 'lg',
          })
        );
        return;
      }
      if (!list.length) {
        render(
          $('[data-table]', view),
          empty(
            'Nenhuma loja encontrada',
            state.search.trim() ? `Nada com “${state.search.trim()}” nas lojas da rede. Confira o nome ou a cidade.` : 'Nenhuma loja nesta combinação de filtros.',
            html`<button class="btn" type="button" data-clear-inline>${icon('close', 'icon-sm')} Limpar filtros</button>`,
            { art: 'site:empty-search' }
          )
        );
        return;
      }
      const maxRev = Math.max(1, ...rows.map((s) => Number(s.revenue_30d) || 0));
      if (mqMobile.matches) {
        render($('[data-table]', view), mobileList(list, maxRev));
        return;
      }
      const col = (key, label, extra = {}) => ({ key, label, ...extra });
      render(
        $('[data-table]', view),
        table({
          rows: list,
          caption: 'Lojas da rede',
          sort: { key: state.sort.key, dir: state.sort.dir },
          rowAttrs: (s) => (s.id === ctx.storeId ? 'class="is-selected"' : ''),
          columns: [
            col('name', 'Loja', {
              sort: 'name',
              render: (s) => html`<div class="stn-store">${storeMark(s, 36)}<div class="stn-store__txt"><button class="stn-name" type="button" data-config="${s.id}" data-tooltip="Abrir os dados da loja">${s.name}</button><span class="sub">${s.brand_name} · ${s.city}/${s.state}</span></div></div>`,
            }),
            col('active', 'Situação', {
              render: (s) => html`<div class="stn-sit">${situation(s)}${!s.has_location ? html`<span class="stn-noloc">${icon('mapPin', 'icon-xs')} Sem localização</span>` : ''}</div>`,
            }),
            col('products', 'Produtos', {
              sort: 'products',
              cls: 'num col-prod',
              render: (s) => html`<span class="stn-num" title="${num(s.products_active)} ativos de ${num(s.products_total)} no catálogo"><strong>${num(s.products_active)}</strong><span class="sub">de ${num(s.products_total)}</span></span>`,
            }),
            col('orders_pending', 'Aguardando', {
              sort: 'pending',
              cls: 'num',
              render: (s) =>
                Number(s.orders_pending) > 0
                  ? html`<button class="stn-wait" type="button" data-pending="${s.id}" aria-label="${plural(s.orders_pending, 'pedido aguardando', 'pedidos aguardando')} em ${s.name}: abrir">${icon('clock', 'icon-xs')}${plural(s.orders_pending, 'novo', 'novos')}</button>`
                  : html`<span class="stn-zero">—</span>`,
            }),
            col('revenue_30d', 'Vendas 30 dias', {
              sort: 'revenue',
              cls: 'num',
              render: (s) => html`<span class="stn-rev"><strong class="stn-money">${money(s.revenue_30d)}</strong><span class="meter" aria-hidden="true"><span style="width:${Math.round(((Number(s.revenue_30d) || 0) / maxRev) * 100)}%"></span></span></span>`,
            }),
            col('staff', 'Equipe', {
              sort: 'staff',
              cls: 'num col-team',
              render: (s) => html`<span class="stn-team" title="${plural(s.staff, 'pessoa', 'pessoas')} com acesso">${icon('team', 'icon-sm')}${num(s.staff)}</span>`,
            }),
            col('delivery', 'Entrega', {
              cls: 'col-ent',
              render: (s) => html`<span class="stn-num"><strong>${km(s.delivery_radius_km)} km</strong><span class="sub">${Number(s.delivery_radius_km) > maxRadius ? 'acima do limite' : 'de raio'}</span></span>`,
            }),
            col('switch', 'Ativa', { render: activeSwitch }),
            col('actions', html`<span class="visually-hidden">Ações</span>`, {
              cls: 'right col-actions',
              render: (s) => html`<div class="stn-actions">
                <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit="${s.id}" aria-label="Editar ${s.name}" data-tooltip="Editar loja">${icon('edit', 'icon-sm')}</button>
                <button class="btn btn--ghost btn--sm btn--icon" type="button" data-row-menu="${s.id}" data-menu="stn-row-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações: ${s.name}" data-tooltip="Mais ações">${icon('dots')}</button>
              </div>`,
            }),
          ],
        })
      );
    }

    // Celular: cartões compactos (nome, situação, ativa e três números) no lugar da tabela.
    const activeSwitch = (s) => html`<label class="switch stn-switch" data-tooltip="${s.active ? 'Tirar da loja virtual' : 'Publicar na loja virtual'}">
      <input type="checkbox" data-toggle-active="${s.id}" ${s.active ? 'checked' : ''}>
      <span class="switch__track"></span><span class="visually-hidden">${s.name} ativa na loja virtual</span>
    </label>`;
    function mobileList(list, maxRev) {
      return html`<ul class="stn-mlist" aria-label="Lojas da rede">${list.map(
        (s) => html`<li class="stn-mcard ${s.id === ctx.storeId ? 'is-selected' : ''}">
          <div class="stn-mcard__top">${storeMark(s, 40)}<div class="stn-store__txt"><button class="stn-name" type="button" data-config="${s.id}">${s.name}</button><span class="sub">${s.brand_name} · ${s.city}/${s.state}</span></div>
            <button class="btn btn--ghost btn--icon" type="button" data-row-menu="${s.id}" data-menu="stn-row-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações: ${s.name}">${icon('dots')}</button></div>
          <div class="stn-mcard__row"><div class="stn-sit stn-sit--row">${situation(s)}${
            Number(s.orders_pending) > 0
              ? html`<button class="stn-wait" type="button" data-pending="${s.id}" aria-label="${plural(s.orders_pending, 'pedido aguardando', 'pedidos aguardando')} em ${s.name}: abrir">${icon('clock', 'icon-xs')}${plural(s.orders_pending, 'novo', 'novos')}</button>`
              : ''
          }${!s.has_location ? html`<span class="stn-noloc">${icon('mapPin', 'icon-xs')} Sem localização</span>` : ''}</div>${activeSwitch(s)}</div>
          <dl class="stn-mcard__stats">
            <div><dt>Vendas 30 dias</dt><dd>${money(s.revenue_30d)}<span class="meter" aria-hidden="true"><span style="width:${Math.round(((Number(s.revenue_30d) || 0) / maxRev) * 100)}%"></span></span></dd></div>
            <div><dt>Produtos</dt><dd>${num(s.products_active)} <span>de ${num(s.products_total)}</span></dd></div>
            <div><dt>Raio</dt><dd>${km(s.delivery_radius_km)} km</dd></div>
          </dl>
        </li>`
      )}</ul>`;
    }

    /* ---------- Mapa ---------- */
    function popupFor(s) {
      const el = document.createElement('div');
      el.className = 'stn-pop';
      render(
        el,
        html`<div class="stn-pop__who">${storeMark(s, 32)}<div><strong>${s.name}</strong><span>${s.city}/${s.state} · raio de ${km(s.delivery_radius_km)} km</span></div></div>
          <div class="row" style="--gap:6px">${situation(s)}</div>
          <div class="stn-pop__stats"><div><b>${money(s.revenue_30d)}</b><span>vendas em 30 dias</span></div><div><b>${num(s.orders_pending)}</b><span>aguardando</span></div></div>
          <div class="stn-pop__acts">
            <button class="btn btn--sm btn--dark" type="button" data-open>${icon('dashboard', 'icon-sm')} Abrir loja</button>
            <button class="btn btn--sm" type="button" data-cfg>Dados</button>
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
      el.classList.toggle('has-foot', !!noLoc.length);
      render(
        nomap,
        noLoc.length
          ? html`${icon('mapPin', 'icon-sm')}<span>${noLoc.length === 1 ? 'Fora do mapa (sem localização):' : `${noLoc.length} lojas fora do mapa (sem localização):`}</span>${noLoc.map(
              (s) => html`<button class="chip" type="button" data-locate="${s.id}">${storeMark(s, 18)}${ctx.storeShort?.(s) || s.name}</button>`
            )}`
          : ''
      );
      if (!hasLeaflet()) {
        el.classList.remove('map');
        render(el, empty('Mapa indisponível', 'Não foi possível carregar o mapa agora.', '', { art: false, icon: 'map' }));
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
          const m = L.marker(ll, { icon: markPin(s, { active: s.active }), title: s.name, alt: s.name, riseOnHover: true, zIndexOffset: s.active ? 100 : 0 }).addTo(layer);
          m.bindPopup(popupFor(s), { minWidth: 220, maxWidth: 280 });
          markers.set(s.id, m);
          pts.push(ll);
        });
      if (firstFit && pts.length) {
        firstFit = false;
        setTimeout(() => {
          if (disposed || !netMap) return;
          netMap.invalidateSize();
          netMap.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 11, animate: false });
        }, 60);
      }
    }

    function focusOnMap(id) {
      const s = rows.find((x) => x.id === id);
      const m = markers.get(id);
      if (!s || !m || !netMap) return toast('Esta loja ainda não tem localização no mapa.', 'warning');
      $('[data-map]', view).scrollIntoView({ block: 'center', behavior: 'smooth' });
      netMap.setView(m.getLatLng(), 10, { animate: false });
      setTimeout(() => !disposed && m.openPopup(), 300);
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
        html`<div class="menu__label">${s.name}</div>
          <button type="button" role="menuitem" data-act="open">${icon('dashboard')} Abrir painel da loja</button>
          <button type="button" role="menuitem" data-act="config">${icon('store')} Dados, entrega e pagamento</button>
          <button type="button" role="menuitem" data-act="edit">${icon('edit')} Editar loja</button>
          <button type="button" role="menuitem" data-act="map">${icon('map')} Ver no mapa</button>
          <a role="menuitem" href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener" data-act="site">${icon('external')} Ver loja virtual</a>
          <hr>
          <button type="button" role="menuitem" data-act="toggle">${icon(s.active ? 'eyeOff' : 'eye')} ${s.active ? 'Desativar loja' : 'Ativar loja'}</button>
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
      else if (a.dataset.act === 'config') ctx.setStore(id, '#/store');
      else if (a.dataset.act === 'edit') storeForm(rows.find((x) => x.id === id));
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
      if (!s) return false;
      const turnOn = !s.active;
      const warn = [];
      if (turnOn && !s.has_location) warn.push('ainda não tem localização (não aparece na busca por CEP)');
      if (turnOn && !Number(s.products_active)) warn.push('ainda não tem produtos ativos');
      const ok = await confirmDialog({
        title: turnOn ? `Ativar ${ctx.storeShort?.(s) || s.name}?` : `Desativar ${ctx.storeShort?.(s) || s.name}?`,
        message: turnOn
          ? `${s.name} passa a aparecer na loja virtual.${warn.length ? ` Atenção: a loja ${warn.join(' e ')}.` : ''}`
          : `${s.name} deixa de aparecer na loja virtual e na busca por CEP. A equipe continua acessando o painel e os pedidos ficam guardados. Dá para reativar depois.`,
        confirmLabel: turnOn ? 'Ativar loja' : 'Desativar loja',
        danger: !turnOn,
        tone: turnOn && warn.length ? 'warn' : undefined,
      });
      if (!ok) return false;
      try {
        await q(sb.from('stores').update({ active: turnOn }).eq('id', id).select('id').single());
        toast(turnOn ? `${ctx.storeShort?.(s) || s.name} ativada` : `${ctx.storeShort?.(s) || s.name} desativada`, 'success', 3200, {
          title: turnOn ? 'Loja ativada' : 'Loja desativada',
        });
        await reloadAll();
        return true;
      } catch (e) {
        toastError(storeError(e));
        return false;
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
      const short = ctx.storeShort?.(s) || s.name;
      if (orders > 0) {
        openModal({
          title: `Não dá para excluir ${short}`,
          size: 'sm',
          icon: 'lock',
          tone: 'warn',
          cls: 'modal--confirm',
          body: html`<div class="stack" style="--gap:10px">
            <p class="modal__text"><strong>${s.name}</strong> tem ${plural(orders, 'pedido', 'pedidos')} no histórico. Para manter os registros de vendas e dos clientes, lojas com pedidos não são excluídas.</p>
            <p class="modal__text muted">${s.active ? 'Desative a loja para tirá-la da loja virtual. Dá para reativar quando quiser.' : 'A loja já está inativa e não aparece na loja virtual.'}</p>
          </div>`,
          actions: html`<button class="btn" type="button" data-close data-initial-focus>Fechar</button>${s.active ? html`<button class="btn btn--dark" type="button" data-deactivate>${icon('eyeOff', 'icon-sm')} Desativar loja</button>` : ''}`,
          onMount: (el, close) =>
            $('[data-deactivate]', el)?.addEventListener('click', () => {
              close();
              toggleActive(id);
            }),
        });
        return;
      }
      openModal({
        title: `Excluir ${short}?`,
        size: 'sm',
        role: 'alertdialog',
        icon: 'trash',
        tone: 'danger',
        cls: 'modal--confirm',
        body: html`<form class="stn-del" data-del-form novalidate>
          <p class="modal__text">Esta ação não pode ser desfeita. Saem junto com <strong>${s.name}</strong>:</p>
          <ul>
            <li>${icon('products', 'icon-sm')} ${plural(s.products_total, 'produto', 'produtos')}, com fotos e variações</li>
            <li>${icon('showcase', 'icon-sm')} a vitrine, os banners e os cupons da loja</li>
            <li>${icon('team', 'icon-sm')} ${plural(s.staff, 'acesso', 'acessos')} da equipe</li>
          </ul>
          <div class="field">
            <label for="stn-del-confirm">Digite <code>${s.slug}</code> para confirmar</label>
            <input class="input" id="stn-del-confirm" autocomplete="off" autocapitalize="off" spellcheck="false" data-del-input>
          </div>
        </form>`,
        actions: html`<button class="btn" type="button" data-close data-initial-focus>Voltar</button><button class="btn btn--danger" type="button" data-del-ok disabled>${icon('trash', 'icon-sm')} Excluir loja</button>`,
        onMount: (el, close) => {
          const input = $('[data-del-input]', el);
          const btn = $('[data-del-ok]', el);
          input.addEventListener('input', () => (btn.disabled = input.value.trim() !== s.slug));
          const go = async () => {
            if (input.value.trim() !== s.slug) return;
            try {
              await withBusy(
                btn,
                async () => {
                  const del = await q(sb.from('stores').delete().eq('id', id).select('id'));
                  if (!del?.length) throw new Error('A loja não foi excluída: verifique suas permissões.');
                },
                'Excluindo…'
              );
              close();
              toast(`${s.name} foi excluída.`, 'success', 3600, { title: 'Loja excluída' });
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

    /* ---------- Ordem na loja virtual ---------- */
    function reorder() {
      if (!rows.length) return;
      let order = [...rows].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || fold(a.name).localeCompare(fold(b.name)));
      const original = order.map((s) => s.id);
      const itemHtml = (s, i) => html`<li draggable="true" data-id="${s.id}" class="${original[i] !== s.id ? 'is-moved' : ''}">
        <span class="stn-order__grip" aria-hidden="true">${icon('grip', 'icon-sm')}</span>
        <span class="stn-order__n">${i + 1}</span>
        ${storeMark(s, 30)}
        <span class="stn-order__txt"><strong>${s.name}</strong><span>${s.brand_name} · ${s.city}/${s.state}${s.active ? '' : ' · inativa'}</span></span>
        <span class="stn-order__btns">
          <button class="btn btn--ghost btn--sm btn--icon" type="button" data-up="${s.id}" aria-label="Subir ${s.name}" data-tooltip="Subir" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 'icon-sm')}</button>
          <button class="btn btn--ghost btn--sm btn--icon" type="button" data-down="${s.id}" aria-label="Descer ${s.name}" data-tooltip="Descer" ${i === order.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>
        </span>
      </li>`;
      openModal({
        title: 'Ordem das lojas',
        icon: 'grip',
        tone: 'info',
        body: html`<div class="stack" style="--gap:12px">
          <p class="modal__text">A ordem vale para a escolha de loja na loja virtual e para o seletor de lojas do painel. Arraste ou use as setas.</p>
          <ol class="stn-order" data-order aria-label="Lojas em ordem"></ol>
          <div class="visually-hidden" aria-live="polite" data-order-live></div>
        </div>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-order-save disabled>${icon('check', 'icon-sm')} Salvar ordem</button>`,
        onMount: (el, close) => {
          const list = $('[data-order]', el);
          const save = $('[data-order-save]', el);
          const paint = (id, dir) => {
            render(list, order.map(itemHtml));
            save.disabled = order.every((s, i) => s.id === original[i]);
            if (!id) return;
            const b = $(`[data-${dir}="${id}"]`, list);
            if (b && !b.disabled) b.focus();
            else $(`[data-${dir === 'up' ? 'down' : 'up'}="${id}"]`, list)?.focus();
          };
          paint();
          let dragging = null;
          list.addEventListener('dragstart', (e) => {
            dragging = e.target.closest('li');
            dragging?.classList.add('is-dragging');
          });
          list.addEventListener('dragover', (e) => {
            if (!dragging) return;
            e.preventDefault();
            const over = e.target.closest('li');
            if (!over || over === dragging) return;
            const r = over.getBoundingClientRect();
            over.parentNode.insertBefore(dragging, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
          });
          list.addEventListener('dragend', () => {
            dragging?.classList.remove('is-dragging');
            dragging = null;
            const ids = $$('li', list).map((li) => li.dataset.id);
            order = ids.map((i) => rows.find((s) => s.id === i));
            paint();
          });
          list.addEventListener('click', (e) => {
            const up = e.target.closest('[data-up]');
            const down = e.target.closest('[data-down]');
            const id = up?.dataset.up || down?.dataset.down;
            if (!id) return;
            const i = order.findIndex((s) => s.id === id);
            const j = up ? i - 1 : i + 1;
            if (j < 0 || j >= order.length) return;
            [order[i], order[j]] = [order[j], order[i]];
            paint(id, up ? 'up' : 'down');
            $('[data-order-live]', el).textContent = `${order[j].name} agora é a ${j + 1}ª loja.`;
          });
          save.addEventListener('click', async () => {
            const changes = order.map((s, i) => [s, i + 1]).filter(([s, n]) => Number(s.sort_order) !== n);
            try {
              await withBusy(
                save,
                async () => {
                  for (const [s, n] of changes) await q(sb.from('stores').update({ sort_order: n }).eq('id', s.id).select('id').single());
                },
                'Salvando…'
              );
              close();
              toast(`${plural(changes.length, 'loja mudou', 'lojas mudaram')} de posição.`, 'success', 3200, { title: 'Ordem das lojas salva' });
              if (state.sort.key !== 'order') setSort('order', 'asc');
              await reloadAll();
            } catch (e) {
              toastError(storeError(e));
              await reloadAll();
            }
          });
        },
      });
    }

    /* ---------- Nova loja / editar loja ---------- */
    function defaultTiers(radius) {
      const r = Math.round(Number(radius) * 100) / 100;
      return r <= 10 ? [{ up_to_km: r, fee: 0 }] : [{ up_to_km: 10, fee: 0 }, { up_to_km: r, fee: 49.9 }];
    }

    const takenSlugs = (exceptId) => new Set(ctx.stores.filter((s) => s.id !== exceptId).map((s) => s.slug).concat(rows.filter((s) => s.id !== exceptId).map((s) => s.slug)));
    function suggestSlug(name, city) {
      const taken = takenSlugs();
      const cands = [slugify(city), slugify(name)].filter(Boolean);
      for (const c of cands) if (!taken.has(c)) return c;
      const base = cands[0] || 'loja';
      for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
      return base;
    }

    // storeForm() = nova loja; storeForm(loja) = edição rápida (nome, marca, endereço na web, cidade, raio, status)
    function storeForm(edit = null) {
      const isEdit = !!edit;
      const counts = new Map();
      ctx.stores.concat(rows).forEach((s) => s.brand_name && counts.set(s.brand_name, 0));
      rows.forEach((s) => counts.set(s.brand_name, (counts.get(s.brand_name) || 0) + 1));
      const brandNow = edit?.brand_name || (counts.has('Atual Móveis') ? 'Atual Móveis' : [...counts.keys()][0] || '');
      if (brandNow && !counts.has(brandNow)) counts.set(brandNow, 0);
      let slugTouched = isEdit;
      let cityTouched = isEdit;
      let geo = null; // { lat, lng, precision, cep, street, district, number }
      let cepFailed = null; // CEP que a busca não encontrou (não tenta de novo)
      let created = null;
      const radius0 = isEdit ? Number(edit.delivery_radius_km) : maxRadius;

      const modal = openModal({
        title: isEdit ? `Editar ${ctx.storeShort?.(edit) || edit.name}` : 'Nova loja',
        size: 'lg',
        icon: isEdit ? 'edit' : 'stores',
        tone: 'info',
        body: html`<form class="stn-form" data-new-form novalidate>
          <div class="stn-prev" data-prev aria-hidden="true"></div>
          <fieldset class="fieldset">
            <legend class="fieldset__title">${icon('store', 'icon-sm')} Identificação</legend>
            <div class="form-grid">
              <div class="field col-12">
                <label for="stn-name">Nome da loja *</label>
                <input class="input" id="stn-name" name="name" required maxlength="120" placeholder="Atual Móveis - Ubá" value="${edit?.name || ''}" ${isEdit ? '' : 'autofocus'}>
                ${isEdit ? '' : html`<span class="hint">Use “Marca - Cidade”: a cidade e o endereço na loja virtual são sugeridos.</span>`}
              </div>
              <div class="field col-6">
                <label for="stn-brand">Marca *</label>
                <select class="select" id="stn-brand" name="brand_name" required data-sheet-title="Marca" data-search="false">${[...counts.entries()]
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                  .map(([b, n]) => {
                    const [ini, tone] = brandMark(b);
                    return html`<option value="${b}" data-mark="${ini}" data-mark-tone="${tone}" data-hint="${plural(n, 'loja', 'lojas')}" ${b === brandNow ? 'selected' : ''}>${b}</option>`;
                  })}<option value="__new" data-icon="plus" data-hint="Digite o nome da nova marca">Outra marca…</option></select>
              </div>
              <div class="field col-6" data-brand-new hidden>
                <label for="stn-brand-new">Nome da nova marca *</label>
                <input class="input" id="stn-brand-new" name="brand_new" maxlength="60" placeholder="Ex.: Atual Casa">
              </div>
              <div class="field col-6">
                <label for="stn-slug">Endereço na loja virtual *</label>
                <div class="input-group"><span class="input-group__addon">/loja/</span><input class="input" id="stn-slug" name="slug" required maxlength="60" autocapitalize="off" spellcheck="false" value="${edit?.slug || ''}" aria-describedby="stn-slug-hint"></div>
                <span class="hint" id="stn-slug-hint">${isEdit ? 'Mudar o endereço quebra links já divulgados.' : 'Gerado pela cidade; letras minúsculas, números e hífens.'}</span>
              </div>
              <div class="field col-8">
                <label for="stn-city">Cidade *</label>
                <input class="input" id="stn-city" name="city" required maxlength="80" autocomplete="address-level2" value="${edit?.city || ''}">
              </div>
              <div class="field col-4">
                <label for="stn-state">UF *</label>
                <select class="select" id="stn-state" name="state" required data-sheet-title="Estado" data-search-placeholder="Buscar estado…">${ufOptions(edit?.state || 'MG')}</select>
              </div>
            </div>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset__title">${icon('truck', 'icon-sm')} Entrega e loja virtual</legend>
            <div class="form-grid">
              <div class="field col-6">
                <label for="stn-radius">Raio de entrega *</label>
                <div class="input-group"><input class="input" id="stn-radius" name="delivery_radius_km" type="number" min="1" max="${isEdit ? 500 : maxRadius}" step="0.5" value="${radius0}" data-type="number" inputmode="decimal" aria-describedby="stn-radius-hint"><span class="input-group__addon">km</span></div>
                <span class="hint" id="stn-radius-hint">Limite da rede: ${km(maxRadius)} km${isEdit ? '. Acima disso, a equipe da loja não consegue salvar os dados da loja.' : '.'}</span>
              </div>
              <div class="col-6 stn-sw">
                <label class="switch">
                  <input type="checkbox" name="active" ${edit?.active ? 'checked' : ''}>
                  <span class="switch__track"></span>
                  <span class="switch__txt"><strong>Publicar na loja virtual</strong><br><span class="muted small">${isEdit ? 'Desligado, a loja some da loja virtual.' : 'Deixe desligado até completar catálogo e dados.'}</span></span>
                </label>
              </div>
              ${isEdit
                ? html`<div class="col-6 stn-sw">
                    <label class="switch">
                      <input type="checkbox" name="accepts_orders" ${edit.accepts_orders ? 'checked' : ''}>
                      <span class="switch__track"></span>
                      <span class="switch__txt"><strong>Aceitar pedidos pelo site</strong><br><span class="muted small">Desligado, a vitrine fica no ar sem finalizar pedidos.</span></span>
                    </label>
                  </div>`
                : ''}
            </div>
          </fieldset>
          ${isEdit
            ? html`<p class="small muted mt-3 stn-inl">${icon('info', 'icon-xs')}<span>Endereço, mapa, frete, PIX e horários ficam em <a href="#/store" data-go-config>Dados da loja</a>.</span></p>`
            : html`<fieldset class="fieldset">
                <legend class="fieldset__title">${icon('mapPin', 'icon-sm')} Localização <span class="opt-tag">opcional</span></legend>
                <p class="muted">Com o CEP buscamos o endereço e o ponto no mapa. Sem CEP, usamos o centro da cidade e você ajusta depois.</p>
                <div class="form-grid">
                  <div class="field col-4">
                    <label for="stn-cep">CEP</label>
                    <input class="input" id="stn-cep" name="cep" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="postal-code">
                  </div>
                  <div class="field col-4">
                    <label for="stn-number">Número</label>
                    <input class="input" id="stn-number" name="number" maxlength="20">
                  </div>
                  <div class="field col-4 stn-geo"><button class="btn" type="button" data-geo>${icon('search', 'icon-sm')} Buscar CEP</button></div>
                  <div class="col-12 stn-note" data-geo-note aria-live="polite"></div>
                </div>
              </fieldset>`}
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-create>${icon(isEdit ? 'check' : 'plus', 'icon-sm')} ${isEdit ? 'Salvar loja' : 'Criar loja'}</button>`,
        onMount: (el) => {
          const form = $('[data-new-form]', el);
          const setNote = (text, tone = '') => {
            const n = $('[data-geo-note]', el);
            if (!n) return;
            n.className = `col-12 stn-note ${tone ? `stn-note--${tone}` : ''}`;
            n.textContent = text;
          };
          const paintPrev = () => {
            const f = form.elements;
            const brand = f.brand_name.value === '__new' ? f.brand_new.value.trim() || 'Nova marca' : f.brand_name.value;
            const name = f.name.value.trim() || (isEdit ? edit.name : 'Nome da loja');
            $('[data-brand-new]', el).hidden = f.brand_name.value !== '__new';
            render(
              $('[data-prev]', el),
              html`${storeMark({ brand_name: brand, city: f.city.value.trim() || name.split(' - ').pop() }, 40)}<div style="min-width:0"><strong>${name}</strong><span>${brand} · ${f.city.value.trim() || 'Cidade'}/${f.state.value} · /loja/${f.slug.value || '…'}</span></div>${
                isEdit ? '' : html`<span class="tag">${f.active.checked ? 'Publicada' : 'Inativa'}</span>`
              }`
            );
          };
          if (!isEdit) form.slug.value = '';
          paintPrev();
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
          form.addEventListener('input', paintPrev);
          form.addEventListener('change', paintPrev);
          form.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.name === 'cep') {
              e.preventDefault();
              $('[data-geo]', el)?.click();
            }
          });
          $('[data-go-config]', el)?.addEventListener('click', (e) => {
            e.preventDefault();
            modal.close();
            ctx.setStore(edit.id, '#/store');
          });
          $('[data-geo]', el)?.addEventListener('click', async (e) => {
            const c = digits(form.cep.value);
            if (c.length !== 8) return showErrors(form, { cep: 'CEP incompleto. Use 8 números.' });
            showErrors(form, {});
            try {
              const r = await withBusy(e.currentTarget, () => geocodeAddress({ cep: c, number: form.number.value.trim() }, { fallback: false }), 'Buscando…');
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
              paintPrev();
            } catch (err) {
              geo = null;
              cepFailed = c;
              setNote(`${String(err.message || 'Não encontramos este CEP').replace(/\.?$/, '.')} Ao criar, usaremos o centro da cidade.`, 'warn');
            }
          });
          $('[data-create]', el).addEventListener('click', (e) => (isEdit ? saveEdit(form, e.currentTarget) : create(form, e.currentTarget)));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            $('[data-create]', el).click();
          });
        },
        onClose: () => {
          if (created) reloadAll();
        },
      });

      function validate(d, errors) {
        if (!d.name || d.name.length < 3) errors.name = 'Informe o nome da loja (mínimo de 3 letras).';
        const brand = d.brand_name === '__new' ? d.brand_new : d.brand_name;
        if (!brand) errors[d.brand_name === '__new' ? 'brand_new' : 'brand_name'] = 'Informe a marca.';
        if (!d.slug) errors.slug = 'Informe o endereço da loja virtual.';
        else if (!SLUG_RE.test(d.slug)) errors.slug = 'Use só letras minúsculas, números e hífens (ex.: uba).';
        else if (takenSlugs(edit?.id).has(d.slug)) errors.slug = 'Já existe uma loja com este endereço.';
        if (!d.city) errors.city = 'Informe a cidade.';
        if (!UFS.includes(d.state || '')) errors.state = 'Escolha a UF.';
        if (!(d.delivery_radius_km > 0)) errors.delivery_radius_km = 'Informe o raio em km.';
        else if (!isEdit && d.delivery_radius_km > maxRadius) errors.delivery_radius_km = `O limite da rede é ${km(maxRadius)} km.`;
        else if (d.delivery_radius_km > 500) errors.delivery_radius_km = 'O raio máximo é de 500 km.';
        return brand;
      }

      async function saveEdit(form, btn) {
        const d = readForm(form);
        const errors = {};
        const brand = validate(d, errors);
        if (!showErrors(form, errors)) return;
        const asks = [];
        if (d.slug !== edit.slug)
          asks.push({ title: 'Alterar o endereço da loja virtual?', message: `O link passa de /loja/${edit.slug} para /loja/${d.slug}. Links antigos divulgados deixam de funcionar.`, confirmLabel: 'Alterar endereço' });
        if (d.delivery_radius_km > maxRadius && d.delivery_radius_km !== Number(edit.delivery_radius_km))
          asks.push({ title: 'Raio acima do limite da rede?', message: `O limite é ${km(maxRadius)} km. Com ${km(d.delivery_radius_km)} km, a equipe da loja não consegue salvar os dados da loja até o raio voltar ao limite.`, confirmLabel: 'Salvar mesmo assim' });
        if (edit.active && !d.active)
          asks.push({ title: `Desativar ${ctx.storeShort?.(edit) || edit.name}?`, message: 'A loja deixa de aparecer na loja virtual e na busca por CEP. Dá para reativar depois.', confirmLabel: 'Desativar loja', danger: true });
        for (const a of asks) if (!(await confirmDialog(a))) return;
        const patch = {
          name: d.name,
          brand_name: brand,
          slug: d.slug,
          city: d.city,
          state: d.state,
          delivery_radius_km: d.delivery_radius_km,
          active: !!d.active,
          accepts_orders: !!d.accepts_orders,
        };
        // a última faixa de frete acompanha o raio quando ele muda (a loja revisa os valores em Dados da loja)
        if (d.delivery_radius_km !== Number(edit.delivery_radius_km)) {
          try {
            const cur = await q(sb.from('stores').select('delivery_fee_tiers').eq('id', edit.id).single());
            const tiers = [...(cur.delivery_fee_tiers || [])].map((t) => ({ up_to_km: Number(t.up_to_km), fee: Number(t.fee) })).sort((a, b) => a.up_to_km - b.up_to_km);
            const r = d.delivery_radius_km;
            if (!tiers.length) patch.delivery_fee_tiers = [{ up_to_km: r, fee: 0 }];
            else if (tiers.at(-1).up_to_km < r) patch.delivery_fee_tiers = [...tiers.slice(0, -1), { ...tiers.at(-1), up_to_km: r }];
            else {
              const fee = tiers.find((t) => t.up_to_km >= r).fee;
              patch.delivery_fee_tiers = [...tiers.filter((t) => t.up_to_km < r), { up_to_km: r, fee }];
            }
          } catch {
            /* mantém as faixas */
          }
        }
        try {
          await withBusy(btn, () => q(sb.from('stores').update(patch).eq('id', edit.id).select('id').single()));
        } catch (e) {
          toastError(storeError(e));
          return;
        }
        modal.close();
        toast(`${d.name} atualizada.`, 'success', 3200, { title: 'Loja salva' });
        await reloadAll();
      }

      async function create(form, btn) {
        if (created) return;
        const d = readForm(form);
        const errors = {};
        const brand = validate(d, errors);
        const c = digits(d.cep);
        if (d.cep && c.length !== 8) errors.cep = 'CEP incompleto. Use 8 números.';
        if (!showErrors(form, errors)) return;

        await withBusy(
          btn,
          async () => {
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
              brand_name: brand,
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
          },
          'Criando…'
        );
      }

      // Passo 2: loja criada → oferece copiar o catálogo de outra loja.
      function stepTwo(s, loc) {
        const el = modal.el;
        const sources = rows.filter((x) => x.id !== s.id && Number(x.products_total) > 0).sort((a, b) => Number(b.products_total) - Number(a.products_total));
        const title = $('.modal__title', el);
        if (title) title.textContent = 'Loja criada';
        const ico = $('.modal__ico', el);
        if (ico) {
          ico.className = 'modal__ico modal__ico--ok';
          render(ico, icon('checkCircle'));
        }
        render(
          $('.modal__body', el),
          html`<div class="stack" style="--gap:16px">
            <div class="stn-done" data-tetim-scope>
              ${art('celebrate', { w: 148, h: 111 })}
              <div><strong>${s.name} está na rede!</strong><p>${
                s.active ? 'Ela já aparece na loja virtual.' : 'Ela foi criada como inativa e só aparece na loja virtual depois de ativada.'
              } Agora é só montar o catálogo e conferir entrega e pagamento.</p></div>
            </div>
            ${loc
              ? loc.precision === 'city'
                ? html`<div class="alert alert--warning">${icon('alert')}<div>Usamos o centro de ${s.city} como localização. Ajuste o ponto exato em Dados da loja › Endereço e mapa.</div></div>`
                : ''
              : html`<div class="alert alert--warning">${icon('alert')}<div>Não encontramos a localização. Marque o ponto em Dados da loja › Endereço e mapa.</div></div>`}
            <section class="stn-copy" aria-labelledby="stn-copy-title">
              <div class="stn-copy__head">${icon('copy')}<div><strong id="stn-copy-title">Copiar catálogo de outra loja</strong>
                <p>As cópias ficam ligadas aos produtos de origem: dá para sincronizar informações e fotos depois. Preço e estoque ficam só na nova loja.</p></div></div>
              ${sources.length
                ? html`<div class="stn-copy__row">
                    <div class="field">
                      <label for="stn-src">Loja de origem</label>
                      <select class="select" id="stn-src" data-sheet-title="Loja de origem" data-search-placeholder="Buscar loja ou cidade…">${sources.map(
                        (x, i) => html`<option value="${x.id}" data-mark="${x.id}" data-hint="${x.brand_name} · ${x.city}/${x.state}" data-meta="${num(x.products_total)}" ${i === 0 ? 'selected' : ''}>${ctx.storeShort?.(x) || x.name}</option>`
                      )}</select>
                    </div>
                    <div class="field">
                      <label for="stn-as">Criar como</label>
                      <select class="select" id="stn-as" data-search="false" data-sheet-title="Criar os produtos como">
                        <option value="draft" data-dot="warn" data-hint="Revise preços antes de publicar" selected>Rascunho</option>
                        <option value="active" data-dot="ok" data-hint="Aparecem na loja virtual">Ativo</option>
                      </select>
                    </div>
                  </div>
                  <div class="stn-copy__foot">
                    <label class="switch"><input type="checkbox" data-keep-stock><span class="switch__track"></span><span class="switch__txt"><strong>Copiar o estoque atual</strong><br><span class="muted small">Desligado, os produtos entram com estoque zero.</span></span></label>
                    <button class="btn btn--dark" type="button" data-copy>${icon('copy', 'icon-sm')} Copiar produtos</button>
                  </div>
                  <div class="stn-copy__prog" data-copy-status aria-live="polite"></div>`
                : html`<p class="small muted">Nenhuma outra loja tem produtos para copiar.</p>`}
            </section>
          </div>`
        );
        render(
          $('.modal__foot', el),
          html`<button class="btn" type="button" data-close>Concluir</button>
            <button class="btn btn--primary" type="button" data-go-config>${icon('store', 'icon-sm')} Configurar a loja</button>`
        );
        $('[data-go-config]', el).addEventListener('click', () => {
          modal.close();
          ctx.setStore(s.id, '#/store');
        });
        $('[data-copy]', el)?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const src = $('#stn-src', el).value;
          const as = $('#stn-as', el).value === 'active' ? 'active' : 'draft';
          const keep = $('[data-keep-stock]', el).checked;
          const srcRow = rows.find((x) => x.id === src);
          const status = $('[data-copy-status]', el);
          const ok = await confirmDialog({
            title: 'Copiar o catálogo?',
            message: `Copiar ${plural(srcRow?.products_total || 0, 'produto', 'produtos')} de ${srcRow?.name || 'outra loja'} para ${s.name} como ${as === 'active' ? 'ativos' : 'rascunho'}${keep ? ', com o estoque atual' : ', sem estoque'}?`,
            confirmLabel: 'Copiar produtos',
          });
          if (!ok) return;
          const progress = (done, total) =>
            render(status, html`<span>Copiando ${num(done)} de ${num(total)}…</span><span class="meter meter--solid" aria-hidden="true"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></span>`);
          try {
            const result = { created: 0, skipped: 0 };
            await withBusy(
              btn,
              async () => {
                const ids = [];
                for (let from = 0; ; from += 1000) {
                  const page = await q(sb.from('products').select('id').eq('store_id', src).order('created_at').range(from, from + 999));
                  ids.push(...page.map((p) => p.id));
                  if (page.length < 1000) break;
                }
                if (!ids.length) throw new Error('A loja de origem não tem produtos.');
                const CHUNK = 50;
                progress(0, ids.length);
                for (let i = 0; i < ids.length; i += CHUNK) {
                  const r = await rpc('duplicate_products', { p_ids: ids.slice(i, i + CHUNK), p_targets: [s.id], p_status: as, p_keep_stock: keep });
                  result.created += Number(r?.created || 0);
                  result.skipped += Number(r?.skipped || 0);
                  progress(Math.min(i + CHUNK, ids.length), ids.length);
                }
              },
              'Copiando…'
            );
            render(status, html`<span class="stn-note--ok stn-inl">${icon('checkCircle', 'icon-xs')} ${plural(result.created, 'produto copiado', 'produtos copiados')} como ${as === 'active' ? 'ativos' : 'rascunho'}.</span>`);
            btn.disabled = true;
            $('#stn-src', el).disabled = true;
            $('#stn-as', el).disabled = true;
            toast(`${plural(result.created, 'produto copiado', 'produtos copiados')} para ${s.name}.`, 'success', 4200, { title: 'Catálogo copiado' });
            load();
          } catch (err) {
            render(status, html`<span class="stn-note--warn stn-inl">${icon('alert', 'icon-xs')} A cópia não terminou. Os produtos já copiados ficaram na nova loja.</span>`);
            toastError(storeError(err));
            load();
          }
        });
      }
    }

    /* ---------- Ordenação e filtros ---------- */
    function setSort(key, dir) {
      const def = SORTS.find((s) => s.id === key) || SORTS[0];
      state.sort = { key: def.id, dir: dir || def.dir };
      lsSet(SORT_KEY, JSON.stringify(state.sort));
      const sel = $('[data-sort-select]', view);
      if (sel && sel.value !== def.id) sel.value = def.id;
      drawTable();
    }
    function clearFilters() {
      state.search = '';
      state.brand = '';
      state.filter = 'all';
      $('[data-stn-search]', view).value = '';
      $('[data-brand]', view).value = '';
      drawTabs();
      drawTable();
    }

    /* ---------- Eventos ---------- */
    const onSearch = debounce(() => drawTable(), 150);
    view.addEventListener('input', (e) => {
      if (e.target.matches('[data-stn-search]')) {
        state.search = e.target.value;
        onSearch();
      }
    });
    view.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-brand]')) {
        state.brand = t.value;
        drawTable();
      } else if (t.matches('[data-sort-select]')) {
        if (t.value !== state.sort.key) setSort(t.value);
      } else if (t.matches('[data-toggle-active]')) {
        const id = t.dataset.toggleActive;
        const want = t.checked;
        t.checked = !want; // só muda de verdade depois da confirmação
        const done = await toggleActive(id);
        if (!done && t.isConnected) t.checked = !want;
      }
    });
    view.addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) {
        state.filter = f.dataset.filter;
        drawTabs();
        drawTable();
        $(`[data-filter="${state.filter}"]`, view)?.focus();
        return;
      }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        const def = SORTS.find((s) => s.id === key);
        setSort(key, state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : def?.dir);
        $(`th[data-sort="${key}"]`, view)?.focus();
        return;
      }
      if (e.target.closest('[data-clear], [data-clear-inline]')) return clearFilters();
      const cfg = e.target.closest('[data-config]');
      if (cfg) return ctx.setStore(cfg.dataset.config, '#/store');
      const pend = e.target.closest('[data-pending]');
      if (pend) return ctx.setStore(pend.dataset.pending, '#/orders?status=pending');
      const ed = e.target.closest('[data-edit]');
      if (ed) return storeForm(rows.find((x) => x.id === ed.dataset.edit));
      const rm = e.target.closest('[data-row-menu]');
      if (rm) return openRowMenu(rm);
      const loc = e.target.closest('[data-locate]');
      if (loc) return ctx.setStore(loc.dataset.locate, '#/store/endereco');
      if (e.target.closest('[data-new-store-inline]')) storeForm();
    });
    view.addEventListener('keydown', (e) => {
      const tab = e.target.closest('[data-filter]');
      if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const tabs = $$('[data-filter]', view);
      const i = tabs.indexOf(tab);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[n].click();
    });

    // Tabela no computador, cartões no celular
    const onMq = () => loaded && drawTable();
    mqMobile.addEventListener?.('change', onMq);
    ctx.onCleanup(() => mqMobile.removeEventListener?.('change', onMq));

    // Novos pedidos mudam os contadores "aguardando".
    const refresh = debounce(() => !disposed && loaded && load(), 1500);
    ctx.on('new-order', refresh);
    ctx.on('order-updated', refresh);

    await load();
  },
};
