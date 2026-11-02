// Relatórios de vendas: período (calendário e atalhos) + agrupamento (dia, loja, categoria, produto, pagamento,
// status), indicadores com comparação ao período anterior, gráfico, tabela ordenável com totais, CSV e impressão.
import { rpc } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  injectStyle,
  debounce,
  money,
  num,
  pct,
  dayStart,
  dayEnd,
  datetime,
  fold,
  empty,
  errorBlock,
  kpiCard,
  areaChart,
  statusBadge,
  storeMark,
  dateRange,
  presetRange,
  toCSV,
  downloadFile,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_ICON,
  TONE,
} from '../ui.js';

/* ---------- Datas no fuso de São Paulo ---------- */
const TZ = 'America/Sao_Paulo';
const YMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => YMD.format(new Date());
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const brDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const brShort = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
const weekdayLong = (ymd) => cap(new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }).split('-')[0]);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_DAYS = 1100;
const MIN_DAY = '2020-01-01';
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const isPhone = () => window.matchMedia('(max-width: 600px)').matches;
// CSV para planilhas em pt-BR: vírgula decimal, sem separador de milhar.
const csvMoney = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
const csvInt = (v) => String(Math.round(Number(v) || 0));

// atalhos de período (mesmos nomes dos presets do calendário do ui.js)
const QUICK = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'thisMonth', label: 'Este mês' },
  { id: 'lastMonth', label: 'Mês passado' },
  { id: 'thisYear', label: 'Este ano' },
];
// presetRange do ui.js usa a data local; o painel usa São Paulo
const quickRange = (id) => presetRange(id, today());

const STATUS_ORDER = Object.keys(ORDER_STATUS);
const paymentLabel = (k) => PAYMENT_METHOD[k] || k || '—';
const statusLabel = (k) => ORDER_STATUS[k]?.label || k || '—';

// Colunas por tipo de agrupamento. sum: soma no total; total(t): cálculo próprio; sem nenhum dos dois: "—".
const ORDER_COLS = [
  { key: 'orders', label: 'Pedidos', type: 'int', sum: true },
  { key: 'orders_ok', label: 'Pedidos válidos', type: 'int', sum: true },
  { key: 'revenue', label: 'Faturamento', type: 'money', sum: true },
  { key: 'discounts', label: 'Descontos', type: 'money', sum: true },
  { key: 'delivery_fees', label: 'Fretes', type: 'money', sum: true },
  { key: 'avg_ticket', label: 'Ticket médio', type: 'money', total: (t) => (t.orders_ok ? Math.round((t.revenue * 100) / t.orders_ok) / 100 : 0) },
];
const ITEM_COLS = [
  { key: 'qty', label: 'Qtd.', type: 'int', sum: true },
  { key: 'revenue', label: 'Faturamento', type: 'money', sum: true },
  { key: 'orders', label: 'Pedidos', type: 'int' },
];

const GROUPS = [
  { id: 'day', file: 'por-dia', label: 'Por dia', head: 'Dia', icon: 'calendar', hint: 'Faturamento, pedidos e ticket de cada dia', cols: ORDER_COLS, sort: { key: 'label', dir: 'asc' } },
  { id: 'store', file: 'por-loja', label: 'Por loja', head: 'Loja', icon: 'stores', hint: 'Compare as lojas da rede', cols: ORDER_COLS, network: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'category', file: 'por-categoria', label: 'Por categoria', head: 'Categoria', icon: 'categories', hint: 'Itens vendidos em cada categoria', cols: ITEM_COLS, items: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'product', file: 'por-produto', label: 'Por produto', head: 'Produto', icon: 'products', hint: 'Quantidade e faturamento de cada produto', cols: ITEM_COLS, items: true, sku: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'payment', file: 'por-pagamento', label: 'Por forma de pagamento', head: 'Forma de pagamento', icon: 'wallet', hint: 'PIX, cartão, dinheiro e crediário', cols: ORDER_COLS, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'status', file: 'por-status', label: 'Por status', head: 'Status', icon: 'orders', hint: 'Do pedido novo ao entregue (e cancelados)', cols: ORDER_COLS, sort: { key: 'label', dir: 'asc' } },
];

function labelText(group, r) {
  if (group.id === 'day') return brDate(r.label);
  if (group.id === 'payment') return paymentLabel(r.label);
  if (group.id === 'status') return statusLabel(r.label);
  return r.label || '—';
}

function sortValue(group, r, key) {
  if (key === 'label') {
    if (group.id === 'status') {
      const i = STATUS_ORDER.indexOf(r.label);
      return i < 0 ? 99 : i;
    }
    if (group.id === 'day') return r.label;
    return labelText(group, r).toLocaleLowerCase('pt-BR');
  }
  if (key === 'sku') return String(r.sku || '').toLowerCase();
  return Number(r[key]) || 0;
}

function sortRows(group, rows, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(group, a, sort.key);
    const vb = sortValue(group, b, sort.key);
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'pt-BR') * dir;
    return (va - vb) * dir;
  });
}

function totals(group, rows) {
  const t = {};
  // dinheiro somado em centavos inteiros: o total não varia com a ordem das linhas
  const cents = (v) => Math.round((Number(v) || 0) * 100);
  group.cols.forEach((c) => {
    if (!c.sum) return;
    t[c.key] = c.type === 'money' ? rows.reduce((s, r) => s + cents(r[c.key]), 0) / 100 : rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
  });
  group.cols.forEach((c) => {
    if (c.total) t[c.key] = c.total(t);
  });
  return t;
}

const fmt = (type, v) => (v === null || v === undefined ? '—' : type === 'money' ? money(v) : num(v));
// variação em %: undefined = sem comparação (sem pílula); null = sem base
function dpct(cur, prev) {
  if (prev === undefined || prev === null) return undefined;
  const p = Number(prev) || 0;
  if (!p) return null;
  return (((Number(cur) || 0) - p) / p) * 100;
}

// Janela anterior de mesmo tamanho; se o período termina hoje, compara até o mesmo horário.
function previousWindow(from, to) {
  const span = (daysBetween(from, to) + 1) * 86400000;
  const start = Date.parse(dayStart(from));
  const end = Math.min(Date.parse(dayEnd(to)), Date.now());
  return { p_from: new Date(start - span).toISOString(), p_to: new Date(end - span).toISOString(), first: addDays(from, -(daysBetween(from, to) + 1)) };
}

/* ---------- Estilos do módulo (o resto vem do admin.css) ---------- */
const CSS = `
.rep { display: flex; flex-direction: column; gap: 16px; }
.rep-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 14px 16px; }
.rep-range { width: auto; min-width: 230px; max-width: 300px; }
.rep-range .sel__label { font-weight: 600; }
.rep-quick .seg__b[aria-pressed="true"] { background: var(--raised); color: var(--ink); box-shadow: var(--sh-btn), 0 0 0 1px var(--line); }
.rep-group { margin-left: auto; min-width: 260px; }
.rep-group .sel__trigger, .rep-group .select { width: 100%; max-width: none; }
.rep-scope { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 var(--r-lg) var(--r-lg); font-size: 12.5px; color: var(--muted); }
.rep-scope strong { color: var(--ink); font-weight: 600; }
.rep-scope .smark { margin-right: 2px; }
.rep-results { display: flex; flex-direction: column; gap: 16px; transition: opacity var(--dur-2) var(--ease-out); }
.rep-results[aria-busy="true"] { opacity: .55; pointer-events: none; }
.rep-chart__body { padding-top: 10px; }
.rep-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rep-bar { display: grid; grid-template-columns: 30px minmax(0, 1.1fr) minmax(80px, 1fr) 118px 52px; align-items: center; gap: 12px; min-height: 46px; padding: 6px 0; }
.rep-bar + .rep-bar { box-shadow: inset 0 1px 0 var(--line); }
.rep-bar__v { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); font: 700 12px/1 var(--font-ui); font-variant-numeric: tabular-nums; }
.rep-bar__v.is-dot { background: transparent; box-shadow: none; }
.rep-bar__name { min-width: 0; }
.rep-bar__name strong { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rep-bar__name span { display: block; font-size: 12px; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rep-bar .meter { height: 8px; }
.rep-bar__val { text-align: right; font-weight: 600; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 13.5px; }
.rep-bar__pct { text-align: right; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.rep-more { margin-top: 6px; }
.rep-table .card__head { align-items: flex-end; }
.rep-search { width: 240px; }
.rep-table .table th.num, .rep-table .table td.num { text-align: right; }
.rep-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; cursor: pointer; border-radius: 6px; }
.rep-sort:hover { color: var(--ink); }
.rep-sort .icon-xs { opacity: 0; transition: opacity var(--dur-1); }
.rep-sort:hover .icon-xs, th[aria-sort="ascending"] .rep-sort .icon-xs, th[aria-sort="descending"] .rep-sort .icon-xs { opacity: 1; }
th[aria-sort="ascending"], th[aria-sort="descending"] { color: var(--ink); }
th.num .rep-sort { flex-direction: row-reverse; }
.rep-table .table tfoot td { height: 46px; border-top: 1px solid var(--line-strong); border-bottom: 0; background: var(--surface-2); font-weight: 700; color: var(--ink); }
.rep-table .table tfoot tr td:first-child { border-bottom-left-radius: var(--r-lg); }
.rep-table .table tfoot tr td:last-child { border-bottom-right-radius: var(--r-lg); }
.rep-label { display: inline-flex; align-items: center; gap: 9px; min-width: 0; max-width: 420px; }
.rep-label > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rep-label .rep-ptile { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
.rep-day { font-weight: 600; color: var(--ink); }
.rep-wd { margin-left: 6px; color: var(--muted); font-size: 12.5px; }
.rep-msort { display: none; }
.rep-note { display: flex; gap: 8px; align-items: flex-start; padding: 12px 20px 16px; font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--line); }
.rep-note .icon-sm { flex: none; margin-top: 1px; }
.rep-nomatch { padding: 18px 20px; color: var(--muted); font-size: 13.5px; }
.rep__print-head { display: none; }
.rep-sk-chart { min-height: 360px; }
.rep-sk-chart .card__body { display: flex; flex-direction: column; gap: 14px; }
@media (max-width: 1100px) {
  .rep-group { margin-left: 0; flex: 1 1 260px; }
}
@media (max-width: 860px) {
  .rep-table .table:not(.table--cards) th:first-child, .rep-table .table:not(.table--cards) td:first-child { position: sticky; left: 0; z-index: 1; background: var(--surface); box-shadow: 1px 0 0 var(--line); }
  .rep-table .table:not(.table--cards) th:first-child { z-index: 2; background: var(--surface-2); }
  .rep-table .table:not(.table--cards) tfoot td:first-child { background: var(--surface-2); }
}
@media (max-width: 767px) {
  .rep-filters { padding: 12px; }
  .rep-quick { display: none; }
  .rep-scope { row-gap: 2px; }
  .rep-scope__sep { display: none; }
  .rep-scope__cmp { flex-basis: 100%; padding-left: 28px; }
  .rep-range, .rep-group { flex: 1 1 100%; max-width: none; min-width: 0; width: 100%; }
  .rep-bar { grid-template-columns: 28px minmax(0, 1fr) auto; grid-template-rows: auto auto; row-gap: 6px; column-gap: 10px; padding: 8px 0; }
  .rep-bar__v { grid-row: 1 / 3; width: 28px; height: 28px; }
  .rep-bar__name { grid-column: 2; }
  .rep-bar__val { grid-column: 3; grid-row: 1; }
  .rep-bar .meter { grid-column: 2; grid-row: 2; }
  .rep-bar__pct { grid-column: 3; grid-row: 2; }
  .rep-table .card__head { align-items: stretch; flex-direction: column; }
  .rep-search { width: 100%; }
  .rep-label { max-width: 100%; }
}
@media (max-width: 600px) {
  .rep-kpis .kpi__sub { font-size: 12px; }
  .rep-kpis .kpi__top { flex-wrap: wrap; row-gap: 5px; }
  .rep-kpis .kpi__label .kpi__info { display: none; }
  .rep-chart .card__head { flex-direction: column; align-items: flex-start; gap: 6px; }
  .rep-chart .chartx__y span:first-child { display: none; }
  .rep .chart-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
  .rep .chart-stats > div { padding: 0 8px; border-left: 1px solid var(--line); }
  .rep .chart-stats > div:first-child { padding-left: 0; border-left: 0; }
  .rep .chart-stats dt { font-size: 11.5px; line-height: 1.3; }
  .rep .chart-stats dd { font-size: 13.5px; }
  .rep-msort { display: block; width: 100%; }
  .rep-sorthint { display: none; }
  /* cabeçalho escondido no modo cartões: quem navega pelo teclado e cai nos botões de ordenar passa a vê-los */
  .rep-table .table--cards thead:focus-within { position: static; width: auto; height: auto; overflow: visible; clip: auto; clip-path: none; display: block; padding: 8px 16px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
  .rep-table .table--cards thead:focus-within tr { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .rep-table .table--cards thead:focus-within th { display: block; height: auto; padding: 6px 0; border: 0; background: none; }
  .rep-msort .sel__trigger, .rep-msort .select { width: 100%; max-width: none; }
  .rep-table .table--cards tfoot { display: block; }
  .rep-table .table--cards tfoot tr { display: block; padding: 12px 16px; background: var(--surface-2); border-top: 1px solid var(--line-strong); border-radius: 0 0 var(--r-lg) var(--r-lg); }
  .rep-table .table--cards tfoot td { display: flex; justify-content: space-between; gap: 12px; height: auto; padding: 3px 0 !important; border: 0; background: none; }
  .rep-table .table--cards tfoot td::before { content: attr(data-label); color: var(--muted); font-weight: 500; font-size: 12.5px; }
  .rep-table .table--cards tfoot td:first-child { font-family: var(--font-display); font-size: 15px; padding-bottom: 6px !important; }
  .rep-table .table--cards tfoot td:first-child::before, .rep-table .table--cards tfoot td.is-empty { display: none; }
  .rep-table .table--cards td.is-empty { display: none; }
}
@media print {
  .rep__print-head { display: block; margin-bottom: 4px; }
  .rep__print-head h2 { font-size: 18px; font-weight: 700; color: #000; }
  .rep .table-wrap, .rep .chartx { overflow: visible; }
  .rep .card { break-inside: avoid; }
  .rep .table th { position: static; }
  .rep .meter span, .rep .chart .bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rep-sort .icon-xs, .rep-search, .rep-more { display: none !important; }
}
`;

/* ---------- Estado (persiste durante a sessão; a rota guarda o filtro para recarregar/compartilhar) ---------- */
const state = { from: null, to: null, group: 'day', sort: {} };

export default {
  title: 'Relatórios',
  async render(view, ctx) {
    injectStyle('reports', CSS);
    let disposed = false;
    let token = 0;
    let shown = false;
    let data = null; // { group, from, to, rows, prev }
    let filterQ = '';
    let barsOpen = false;
    let picker = null;

    const groups = GROUPS.filter((g) => !g.network || !ctx.storeId);
    const t = today();
    const qy = ctx.query || {};
    // padrão: últimos 30 dias (o "Este mês" logo no começo do mês mostraria só 1 ou 2 dias)
    let from = isYmd(qy.from) ? qy.from : state.from || addDays(t, -29);
    let to = isYmd(qy.to) ? qy.to : state.to || t;
    if (to > t) to = t;
    if (from < MIN_DAY) from = MIN_DAY;
    if (from > to || daysBetween(from, to) + 1 > MAX_DAYS) [from, to] = [addDays(t, -29), t];
    let groupId = groups.some((g) => g.id === qy.group) ? qy.group : groups.some((g) => g.id === state.group) ? state.group : 'day';
    const group = () => groups.find((g) => g.id === groupId) || groups[0];
    const sortOf = (g) => state.sort[g.id] || g.sort;
    const scopeName = () => (ctx.store ? ctx.storeShort(ctx.store) : 'Toda a rede');
    const quickOf = () => QUICK.find((x) => {
      const r = quickRange(x.id);
      return r && r.from === from && r.to === to;
    });

    render(
      view,
      html`<div class="rep">
        <section class="card no-print" aria-label="Filtros do relatório">
          <div class="rep-filters">
            <button class="input sel__trigger rep-range" type="button" data-range>${icon('calendar', 'icon-sm sel__ico')}<span class="sel__value"><span class="sel__prefix">Período</span><span class="sel__label" data-range-label></span></span><span class="sel__end">${icon('chevronDown', 'icon-sm')}</span></button>
            <div class="seg rep-quick" role="group" aria-label="Períodos rápidos" data-quick></div>
            <div class="rep-group">
              <label class="visually-hidden" for="rep-group">Agrupar por</label>
              <select class="select" id="rep-group" data-prefix="Agrupar" data-sheet-title="Agrupar por" data-search="false">
                ${groups.map((g) => html`<option value="${g.id}" data-icon="${g.icon}" data-hint="${g.hint}" ${g.id === groupId ? 'selected' : ''}>${g.label}</option>`)}
              </select>
            </div>
          </div>
          <div class="rep-scope" data-scope></div>
        </section>
        <div class="rep__print-head" data-print-head></div>
        <div class="rep-results" id="rep-results" data-results>${skeletonResults()}</div>
        <p class="visually-hidden" role="status" aria-live="polite" data-status></p>
      </div>`
    );
    const results = $('[data-results]', view);
    const rangeBtn = $('[data-range]', view);
    const groupSel = $('#rep-group', view);

    ctx.setActions(html`
      <button class="btn rep-act" type="button" data-export title="Exportar a tabela em CSV (abre no Excel)" disabled>${icon('download', 'icon-sm')}<span>Exportar CSV</span></button>
      <button class="btn rep-act" type="button" data-print title="Imprimir ou salvar em PDF" disabled>${icon('print', 'icon-sm')}<span>Imprimir</span></button>`);
    const exportBtn = $('[data-actions] [data-export]');
    const printBtn = $('[data-actions] [data-print]');
    const setActionsEnabled = (on) => {
      if (exportBtn) exportBtn.disabled = !on;
      if (printBtn) printBtn.disabled = !on;
    };

    function skeletonResults() {
      const sk = (w, h = 12, extra = '') => html`<span class="skeleton ${extra}" style="width:${w};height:${h}px"></span>`;
      return html`<div aria-busy="true"><span class="visually-hidden">Gerando relatório…</span>
        <div class="kpis rep-kpis">${Array.from({ length: 4 }, () => html`<div class="card kpi">${sk('50%', 12)}${sk('70%', 26, 'sk-mt')}${sk('56%', 10, 'sk-mt')}</div>`)}</div>
        <div class="card rep-sk-chart mt-3"><div class="card__head">${sk('30%', 16)}</div><div class="card__body">${sk('100%', 240)}</div></div>
      </div>`;
    }

    function syncRoute() {
      if (disposed) return;
      const params = new URLSearchParams({ from, to, group: groupId });
      history.replaceState(null, '', `#/reports?${params}`);
      state.from = from;
      state.to = to;
      state.group = groupId;
    }

    function drawControls() {
      const q = quickOf();
      const quickEl = $('[data-quick]', view);
      // desenhados uma vez; depois só mudam de estado (redesenhar tiraria o foco de quem usa o teclado)
      if (!quickEl.children.length) render(quickEl, QUICK.map((x) => html`<button type="button" class="seg__b" data-quick-id="${x.id}" aria-pressed="false">${x.label}</button>`));
      $$('[data-quick-id]', quickEl).forEach((b) => {
        const on = q?.id === b.dataset.quickId;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      if (!picker) picker = dateRange(rangeBtn, { from, to, preset: q?.id || null, min: MIN_DAY, max: today(), onApply: onRange });
      else picker.set(from, to, q?.id || null);
      const n = daysBetween(from, to) + 1;
      const cmp = n === 1 ? 'com o dia anterior' : `com os ${n} dias anteriores`;
      render(
        $('[data-scope]', view),
        html`${ctx.store ? storeMark(ctx.store, 20) : html`<span class="smark smark--net" style="width:20px;height:20px;border-radius:6px" aria-hidden="true">${icon('houses', 'icon-xs')}</span>`}<strong>${scopeName()}</strong>
          <span class="rep-scope__sep" aria-hidden="true">·</span><span>${from === to ? brDate(from) : `${brDate(from)} a ${brDate(to)}`} (${plural(n, 'dia', 'dias')})</span>
          <span class="rep-scope__sep" aria-hidden="true">·</span><span class="rep-scope__cmp">comparado ${cmp}</span>`
      );
    }

    function drawPrintHead() {
      render(
        $('[data-print-head]', view),
        html`<h2>Relatório de vendas · ${group().label.toLowerCase()}</h2>
        <p class="small">${ctx.store ? ctx.store.name : 'Toda a rede'} · ${from === to ? brDate(from) : `${brDate(from)} a ${brDate(to)}`} · gerado em ${datetime(new Date())}</p>`
      );
    }

    /* ----- Resultado ----- */
    function kpis(g, rows, prevRows) {
      const tt = totals(g, rows);
      const pt = prevRows ? totals(g, prevRows) : null;
      const prev = (k, f = money) => (pt ? f(pt[k] ?? 0) : '');
      if (g.items) {
        const avg = tt.qty ? tt.revenue / tt.qty : 0;
        const pavg = pt && pt.qty ? pt.revenue / pt.qty : pt ? 0 : undefined;
        return html`<div class="kpis rep-kpis">
          ${kpiCard({ label: 'Faturamento (itens)', value: money(tt.revenue), split: true, sub: 'Sem frete e descontos do pedido', delta: dpct(tt.revenue, pt?.revenue), prev: prev('revenue'), info: 'Soma do valor dos itens em pedidos não cancelados.' })}
          ${kpiCard({ label: 'Unidades vendidas', value: num(tt.qty), sub: 'Pedidos não cancelados', delta: dpct(tt.qty, pt?.qty), prev: prev('qty', (v) => plural(v, 'unidade', 'unidades')) })}
          ${kpiCard({ label: g.id === 'product' ? 'Produtos vendidos' : 'Categorias', value: num(rows.length), sub: 'Com ao menos uma venda', delta: pt ? dpct(rows.length, prevRows.length) : undefined, prev: pt ? num(prevRows.length) : '' })}
          ${kpiCard({ label: 'Preço médio', value: money(avg), split: true, sub: 'Por unidade vendida', delta: pavg === undefined ? undefined : dpct(avg, pavg), prev: pavg === undefined ? '' : money(pavg) })}
        </div>`;
      }
      const canceled = (tt.orders || 0) - (tt.orders_ok || 0);
      return html`<div class="kpis rep-kpis">
        ${kpiCard({ label: 'Faturamento', value: money(tt.revenue), split: true, sub: 'Pedidos não cancelados', delta: dpct(tt.revenue, pt?.revenue), prev: prev('revenue'), info: 'Soma dos pedidos não cancelados no período (com frete e descontos).' })}
        ${kpiCard({ label: 'Pedidos válidos', value: html`${num(tt.orders_ok)} <small>/ ${num(tt.orders)}</small>`, sub: canceled ? `${plural(canceled, 'cancelado', 'cancelados')} no período` : 'Nenhum cancelado', delta: dpct(tt.orders_ok, pt?.orders_ok), prev: prev('orders_ok', (v) => plural(v, 'pedido', 'pedidos')) })}
        ${kpiCard({ label: 'Ticket médio', value: money(tt.avg_ticket), split: true, sub: 'Por pedido válido', delta: dpct(tt.avg_ticket, pt?.avg_ticket), prev: prev('avg_ticket') })}
        ${kpiCard({ label: 'Descontos', value: money(tt.discounts), split: true, sub: `Cupons e PIX · fretes ${money(tt.delivery_fees)}`, delta: dpct(tt.discounts, pt?.discounts), prev: prev('discounts'), info: 'Descontos de cupom e de pagamento no PIX. Fretes = taxas de entrega cobradas.' })}
      </div>`;
    }

    // o SVG escala pela largura: a altura do viewBox sai da largura disponível (≈ 300 px no computador, 230 no celular)
    function chartHeight() {
      const w = Math.max(300, (results.clientWidth || 900) - 40);
      return Math.round(Math.min(560, Math.max(200, ((isPhone() ? 230 : 300) * 640) / w)));
    }
    function dayChart(rows, prevRows, prevFirst) {
      const byDay = new Map(rows.map((r) => [r.label, r]));
      const pByDay = new Map((prevRows || []).map((r) => [r.label, r]));
      const span = daysBetween(from, to);
      let pts = [];
      for (let i = 0; i <= span; i++) {
        const d = addDays(from, i);
        const pd = addDays(prevFirst, i);
        pts.push({ key: d, pkey: pd, revenue: Number(byDay.get(d)?.revenue) || 0, orders: Number(byDay.get(d)?.orders_ok) || 0, prev: Number(pByDay.get(pd)?.revenue) || 0 });
      }
      const monthly = pts.length > 92;
      if (monthly) {
        const m = new Map();
        pts.forEach((p) => {
          const k = p.key.slice(0, 7);
          const c = m.get(k) || { key: k, pkey: p.pkey.slice(0, 7), revenue: 0, orders: 0, prev: 0 };
          c.revenue += p.revenue;
          c.orders += p.orders;
          c.prev += p.prev;
          m.set(k, c);
        });
        pts = [...m.values()];
      }
      const n = pts.length;
      const mLabel = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
      // no celular o eixo mostra só o mês ("out"); o ano aparece quando o período cruza a virada do ano
      const axisMonth = (k) => (isPhone() && from.slice(0, 4) === to.slice(0, 4) ? MONTHS[Number(k.slice(5, 7)) - 1] : mLabel(k));
      const points = pts.map((p) => ({
        label: monthly ? axisMonth(p.key) : n <= 10 ? `${weekday(p.key)} ${p.key.slice(8, 10)}` : isPhone() ? p.key.slice(8, 10) : brShort(p.key),
        value: p.revenue,
        orders: p.orders,
        title: monthly ? `${cap(MONTHS_LONG[Number(p.key.slice(5, 7)) - 1])} de ${p.key.slice(0, 4)}` : `${weekdayLong(p.key)}, ${brShort(p.key)}`,
        prevLabel: monthly ? mLabel(p.pkey) : `${weekday(p.pkey)} ${brShort(p.pkey)}`,
      }));
      const total = pts.reduce((s, p) => s + p.revenue, 0);
      let best = null;
      pts.forEach((p, i) => {
        if (p.revenue > 0 && (!best || p.revenue > best.p.revenue)) best = { p, i };
      });
      const withSales = pts.filter((p) => p.revenue > 0).length;
      const unit = monthly ? 'mês' : 'dia';
      const prevLabel = n === 1 ? 'Dia anterior' : monthly ? 'Período anterior' : `${num(daysBetween(from, to) + 1)} dias anteriores`;
      const aria = `Faturamento ${monthly ? 'mensal' : 'diário'} de ${brDate(from)} a ${brDate(to)}: total ${money(total)}${best ? `; melhor ${unit} ${points[best.i].title}, com ${money(best.p.revenue)}` : ''}.`;
      return html`<section class="card rep-chart" aria-labelledby="rep-chart-t">
        <div class="card__head"><div><h2 class="card__title" id="rep-chart-t">Faturamento por ${unit}</h2><p class="card__sub">${money(total)} em ${plural(n, unit === 'mês' ? 'mês' : 'dia', unit === 'mês' ? 'meses' : 'dias')}</p></div>
          ${n > 1 ? html`<div class="legend" aria-hidden="true"><span><i></i>Este período</span>${prevRows ? html`<span><i class="prev"></i>${prevLabel}</span>` : ''}</div>` : ''}</div>
        <div class="card__body rep-chart__body">
          ${n === 1
            ? html`<p class="muted small">Um dia só no período. Para ver a evolução, escolha 7 dias ou mais.</p>`
            : areaChart(points, { prev: prevRows ? pts.map((p) => p.prev) : null, height: chartHeight(), ariaLabel: aria, curLabel: 'Este período', prevLabel, compact: isPhone() })}
          <dl class="chart-stats">
            <div><dt>${best ? `Melhor ${unit} · ${monthly ? mLabel(best.p.key) : n <= 10 ? points[best.i].label : brShort(best.p.key)}` : `Melhor ${unit}`}</dt><dd class="num">${best ? money(best.p.revenue) : '—'}</dd></div>
            <div><dt>Média por ${unit}</dt><dd class="num">${money(n ? total / n : 0)}</dd></div>
            <div><dt>${monthly ? 'Meses com venda' : 'Dias com venda'}</dt><dd class="num">${num(withSales)} de ${num(n)}</dd></div>
          </dl>
        </div>
      </section>`;
    }

    function barVisual(g, r, i) {
      if (g.id === 'store') {
        const s = ctx.stores.find((x) => x.name === r.label);
        return s ? html`<span class="rep-bar__v is-dot">${storeMark(s, 28)}</span>` : html`<span class="rep-bar__v">${i + 1}</span>`;
      }
      if (g.id === 'payment') return html`<span class="rep-bar__v" aria-hidden="true">${icon(PAYMENT_ICON[r.label] || 'wallet', 'icon-sm')}</span>`;
      if (g.id === 'status') return html`<span class="rep-bar__v is-dot" aria-hidden="true"><span class="dot t-${TONE[ORDER_STATUS[r.label]?.tone || ''] || 'neu'}"></span></span>`;
      return html`<span class="rep-bar__v" aria-hidden="true">${i + 1}</span>`;
    }
    function barName(g, r) {
      if (g.id === 'store') {
        const s = ctx.stores.find((x) => x.name === r.label);
        return { name: s ? ctx.storeShort(s) : r.label, sub: plural(r.orders_ok, 'pedido válido', 'pedidos válidos') };
      }
      if (g.items) return { name: r.label || '—', sub: `${g.sku && r.sku ? `${r.sku} · ` : ''}${plural(r.qty, 'unidade', 'unidades')}` };
      if (g.id === 'status') return { name: statusLabel(r.label), sub: plural(r.orders, 'pedido', 'pedidos') };
      return { name: labelText(g, r), sub: plural(r.orders_ok, 'pedido válido', 'pedidos válidos') };
    }

    function barsChart(g, rows) {
      // status: o faturamento de cancelados é zero; a barra usa a contagem de pedidos
      const metric = g.id === 'status' ? 'orders' : 'revenue';
      const sorted = g.id === 'status' ? sortRows(g, rows, { key: 'label', dir: 'asc' }) : [...rows].sort((a, b) => (Number(b[metric]) || 0) - (Number(a[metric]) || 0));
      const LIMIT = g.id === 'store' ? 20 : 12;
      const shownRows = barsOpen ? sorted : sorted.slice(0, LIMIT);
      const total = sorted.reduce((s, r) => s + (Number(r[metric]) || 0), 0);
      const max = Math.max(1, ...sorted.map((r) => Number(r[metric]) || 0));
      const title = g.id === 'status' ? 'Pedidos por status' : `Faturamento ${g.label.toLowerCase()}`;
      const noun = { store: ['loja', 'lojas'], category: ['categoria', 'categorias'], product: ['produto', 'produtos'], payment: ['forma', 'formas'], status: ['status', 'status'] }[g.id] || ['linha', 'linhas'];
      return html`<section class="card rep-chart" aria-labelledby="rep-chart-t">
        <div class="card__head"><div><h2 class="card__title" id="rep-chart-t">${title}</h2>
          <p class="card__sub">${g.id === 'status' ? plural(total, 'pedido', 'pedidos') : money(total)} · ${sorted.length > LIMIT && !barsOpen ? `${LIMIT} maiores de ${plural(sorted.length, ...noun)}` : plural(sorted.length, ...noun)}</p></div></div>
        <div class="card__body">
          <ol class="rep-bars" aria-label="${title}">${shownRows.map((r, i) => {
            const v = Number(r[metric]) || 0;
            const nm = barName(g, r);
            const share = total ? (v / total) * 100 : 0;
            return html`<li class="rep-bar">
              ${barVisual(g, r, i)}
              <span class="rep-bar__name"><strong title="${nm.name}">${nm.name}</strong><span>${nm.sub}</span></span>
              <span class="meter ${g.id === 'status' ? 'meter--solid' : ''}" aria-hidden="true"><span style="width:${v ? Math.max(1.5, (v / max) * 100).toFixed(1) : 0}%"></span></span>
              <span class="rep-bar__val">${metric === 'orders' ? num(v) : money(v)}</span>
              <span class="rep-bar__pct">${pct(share, share && share < 10 ? 1 : 0)}</span>
            </li>`;
          })}</ol>
          ${sorted.length > LIMIT ? html`<button class="btn btn--ghost btn--sm rep-more" type="button" data-bars-toggle aria-expanded="${barsOpen}">${barsOpen ? `Mostrar só as ${LIMIT} maiores` : `Mostrar todas as ${num(sorted.length)}`}</button>` : ''}
        </div>
      </section>`;
    }

    function labelCell(g, r) {
      if (g.id === 'day') return html`<span class="nowrap"><span class="rep-day">${brDate(r.label)}</span><span class="rep-wd">${weekday(r.label)}</span></span>`;
      if (g.id === 'status') return statusBadge(r.label);
      if (g.id === 'payment') return html`<span class="rep-label"><span class="rep-ptile" aria-hidden="true">${icon(PAYMENT_ICON[r.label] || 'wallet', 'icon-xs')}</span><span>${paymentLabel(r.label)}</span></span>`;
      if (g.id === 'store') {
        const s = ctx.stores.find((x) => x.name === r.label);
        return html`<span class="rep-label">${s ? storeMark(s, 24) : ''}<span title="${r.label}">${s ? ctx.storeShort(s) : r.label}</span></span>`;
      }
      return html`<span class="rep-label"><span title="${labelText(g, r)}">${labelText(g, r)}</span></span>`;
    }

    function tableBody(g, rows) {
      const sort = sortOf(g);
      const q = fold(filterQ.trim());
      const filtered = q ? rows.filter((r) => fold(`${labelText(g, r)} ${r.sku || ''}`).includes(q)) : rows;
      const sorted = sortRows(g, filtered, sort);
      const tt = totals(g, filtered);
      const head = (key, label, cls = '') => {
        const on = sort.key === key;
        const ariaSort = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        return html`<th class="${cls}" scope="col" aria-sort="${ariaSort}"><button type="button" class="rep-sort" data-sort="${key}">${label}${icon(on && sort.dir === 'asc' ? 'arrowUp' : 'arrowDown', 'icon-xs')}</button></th>`;
      };
      if (!sorted.length) return html`<p class="rep-nomatch">Nenhuma linha com “${filterQ}”. Confira a grafia ou limpe o filtro.</p>`;
      return html`<div class="table-wrap table-wrap--cards"><table class="table table--cards table--compact">
        <caption class="visually-hidden">Detalhamento ${g.label.toLowerCase()}, ${from === to ? brDate(from) : `${brDate(from)} a ${brDate(to)}`}</caption>
        <thead><tr>
          ${head('label', g.head)}
          ${g.sku ? head('sku', 'SKU') : ''}
          ${g.cols.map((c) => head(c.key, c.label, 'num'))}
        </tr></thead>
        <tbody>${sorted.map(
          (r) => html`<tr>
            <td data-label="${g.head}">${labelCell(g, r)}</td>
            ${g.sku ? html`<td class="mono nowrap ${r.sku ? '' : 'is-empty'}" data-label="SKU">${r.sku || '—'}</td>` : ''}
            ${g.cols.map((c) => html`<td class="num" data-label="${c.label}">${fmt(c.type, r[c.key])}</td>`)}
          </tr>`
        )}</tbody>
        <tfoot><tr>
          <td>${q ? 'Total filtrado' : 'Total'}</td>
          ${g.sku ? html`<td class="is-empty"></td>` : ''}
          ${g.cols.map((c) => html`<td class="num ${c.sum || c.total ? '' : 'is-empty'}" data-label="${c.label}">${c.sum || c.total ? fmt(c.type, tt[c.key]) : '—'}</td>`)}
        </tr></tfoot>
      </table></div>`;
    }

    // no celular a tabela vira cartões e o cabeçalho some: a ordem é escolhida num select
    function sortOptions(g) {
      const sort = sortOf(g);
      const opts = g.id === 'day'
        ? [['label|asc', 'Dia · mais antigo primeiro'], ['label|desc', 'Dia · mais recente primeiro']]
        : [['label|asc', `${g.head} · A a Z`]];
      if (g.sku) opts.push(['sku|asc', 'SKU · A a Z']);
      g.cols.forEach((c) => opts.push([`${c.key}|desc`, `${c.label} · maior primeiro`]));
      const cur = `${sort.key}|${sort.dir}`;
      if (!opts.some(([v]) => v === cur)) opts.push([cur, `${cur.startsWith('label') ? g.head : g.cols.find((c) => c.key === sort.key)?.label || sort.key} · ${sort.dir === 'asc' ? 'menor primeiro' : 'maior primeiro'}`]);
      return html`<div class="rep-msort"><label class="visually-hidden" for="rep-msort">Ordenar por</label>
        <select class="select" id="rep-msort" data-prefix="Ordenar" data-sheet-title="Ordenar por" data-search="false">${opts.map(([v, l]) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`)}</select></div>`;
    }

    function tableCard(g, rows) {
      const searchable = rows.length > 8 && g.id !== 'day' && g.id !== 'status';
      return html`<section class="card rep-table" aria-labelledby="rep-table-t">
        <div class="card__head"><div><h2 class="card__title" id="rep-table-t">Detalhamento</h2><p class="card__sub">${plural(rows.length, 'linha', 'linhas')}<span class="no-print rep-sorthint"> · clique no título da coluna para ordenar</span></p></div>
          ${searchable
            ? html`<label class="search rep-search no-print">${icon('search', 'icon-sm')}<span class="visually-hidden">Filtrar linhas</span><input class="input" type="search" placeholder="Filtrar ${g.id === 'product' ? 'produtos' : g.id === 'store' ? 'lojas' : 'linhas'}…" value="${filterQ}" data-filter autocomplete="off"></label>`
            : ''}${sortOptions(g)}</div>
        <div data-table-body>${tableBody(g, rows)}</div>
        ${g.items
          ? html`<p class="rep-note">${icon('info', 'icon-sm')}<span>Faturamento soma o valor dos itens de pedidos não cancelados (sem frete e sem descontos do pedido). Um pedido com itens de vários ${g.id === 'product' ? 'produtos' : 'categorias'} conta em cada linha, por isso a coluna Pedidos não tem total.</span></p>`
          : g.id === 'status'
            ? html`<p class="rep-note">${icon('info', 'icon-sm')}<span>Pedidos cancelados entram na contagem de pedidos, mas não no faturamento.</span></p>`
            : ''}
      </section>`;
    }

    function drawResults() {
      if (!data) return;
      const g = groups.find((x) => x.id === data.group) || group();
      if (!data.rows.length) {
        const scope = ctx.store ? `em ${ctx.storeShort(ctx.store)}` : 'na rede';
        const wider = [
          ['30d', 'Últimos 30 dias'],
          ['thisYear', 'Este ano'],
        ].filter(([id]) => {
          const r = quickRange(id);
          return r && !(r.from >= data.from && r.to <= data.to);
        });
        const acts = wider.length
          ? wider.map(([id, label], i) => html`<button class="btn ${i === wider.length - 1 ? 'btn--dark' : ''}" type="button" data-quick-id="${id}">${label}</button>`)
          : html`<button class="btn btn--dark" type="button" data-open-range>${icon('calendar', 'icon-sm')}Escolher outro período</button>`;
        render(
          results,
          html`<div class="card">${empty(
            'Nenhuma venda no período',
            `Não há pedidos ${data.from === data.to ? `em ${brDate(data.from)}` : `entre ${brDate(data.from)} e ${brDate(data.to)}`} ${scope}. ${
              wider.length ? 'Amplie o período para ver os números.' : 'Escolha outro período para ver os números.'
            }`,
            acts,
            { art: 'site:empty-search', size: 'lg' }
          )}</div>`
        );
        return;
      }
      render(results, html`${kpis(g, data.rows, data.prev)}${g.id === 'day' ? dayChart(data.rows, data.prev, data.prevFirst) : barsChart(g, data.rows)}${tableCard(g, data.rows)}`);
    }

    async function load() {
      const my = ++token;
      const g = group();
      syncRoute();
      drawControls();
      drawPrintHead();
      setActionsEnabled(false);
      if (shown) results.setAttribute('aria-busy', 'true');
      else render(results, skeletonResults());
      try {
        const pw = previousWindow(from, to);
        const [rows, prevRows] = await Promise.all([
          rpc('sales_report', { p_store: ctx.storeId, p_from: dayStart(from), p_to: dayEnd(to), p_group: g.id }),
          // a comparação é um extra: se falhar, o relatório segue sem ela
          rpc('sales_report', { p_store: ctx.storeId, p_from: pw.p_from, p_to: pw.p_to, p_group: g.id }).catch(() => null),
        ]);
        if (disposed || my !== token) return;
        filterQ = '';
        barsOpen = false;
        data = { group: g.id, from, to, rows: Array.isArray(rows) ? rows : [], prev: Array.isArray(prevRows) ? prevRows : null, prevFirst: pw.first };
        drawResults();
        const status = $('[data-status]', view);
        if (status) status.textContent = data.rows.length ? `Relatório ${g.label.toLowerCase()} atualizado: ${plural(data.rows.length, 'linha', 'linhas')}.` : 'Nenhuma venda no período.';
        shown = true;
        setActionsEnabled(data.rows.length > 0);
      } catch (e) {
        if (disposed || my !== token) return;
        data = null;
        shown = false;
        render(results, html`<div class="card">${errorBlock(e, { retry: () => load(), title: 'Não foi possível gerar o relatório' })}</div>`);
      } finally {
        if (my === token && !disposed) results.removeAttribute('aria-busy');
      }
    }

    function setRange(f, tv) {
      if (!isYmd(f) || !isYmd(tv)) return false;
      if (f > tv) [f, tv] = [tv, f];
      if (f < MIN_DAY) {
        toast('Escolha datas a partir de 2020.', 'warning');
        return false;
      }
      if (tv > today()) tv = today();
      if (daysBetween(f, tv) + 1 > MAX_DAYS) {
        toast('Escolha um período de até 3 anos.', 'warning');
        return false;
      }
      if (f === from && tv === to) return false;
      from = f;
      to = tv;
      return true;
    }

    function onRange({ from: f, to: tv }) {
      if (setRange(f, tv)) load();
      else drawControls();
    }

    view.addEventListener('click', (e) => {
      const quick = e.target.closest('[data-quick-id]');
      if (quick) {
        const r = quickRange(quick.dataset.quickId);
        if (r && setRange(r.from, r.to)) load();
        return;
      }
      if (e.target.closest('[data-open-range]')) {
        picker?.open();
        return;
      }
      if (e.target.closest('[data-bars-toggle]') && data) {
        barsOpen = !barsOpen;
        drawResults();
        $('[data-bars-toggle]', results)?.focus();
        return;
      }
      const th = e.target.closest('[data-sort]');
      if (th && data) {
        const g = groups.find((x) => x.id === data.group);
        const key = th.dataset.sort;
        const cur = sortOf(g);
        const textKey = key === 'label' || key === 'sku';
        state.sort[g.id] = cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: textKey ? 'asc' : 'desc' };
        render($('[data-table-body]', results), tableBody(g, data.rows));
        const ms = $('.rep-msort', results);
        if (ms) ms.outerHTML = String(sortOptions(g));
        $(`[data-sort="${key}"]`, results)?.focus();
      }
    });

    results.addEventListener('change', (e) => {
      if (e.target.id !== 'rep-msort' || !data) return;
      const [key, dir] = e.target.value.split('|');
      const g = groups.find((x) => x.id === data.group);
      state.sort[g.id] = { key, dir };
      render($('[data-table-body]', results), tableBody(g, data.rows));
    });

    groupSel.addEventListener('change', () => {
      if (groupSel.value === groupId || !groups.some((g) => g.id === groupSel.value)) return;
      groupId = groupSel.value;
      load();
    });

    const onFilter = debounce((value) => {
      if (!data || disposed) return;
      filterQ = value;
      const g = groups.find((x) => x.id === data.group);
      render($('[data-table-body]', results), tableBody(g, data.rows));
    }, 160);
    results.addEventListener('input', (e) => {
      if (e.target.matches('[data-filter]')) onFilter(e.target.value);
    });

    exportBtn?.addEventListener('click', () => {
      if (!data?.rows.length) return toast('Não há dados para exportar.', 'warning');
      try {
        const g = groups.find((x) => x.id === data.group);
        const rows = sortRows(g, data.rows, sortOf(g));
        const tt = totals(g, data.rows);
        const columns = [
          { label: g.head, value: (r) => (r.__total ? 'Total' : labelText(g, r)) },
          ...(g.sku ? [{ label: 'SKU', value: (r) => (r.__total ? '' : r.sku || '') }] : []),
          ...g.cols.map((c) => ({
            label: c.label,
            value: (r) => {
              const v = r[c.key];
              if (v === null || v === undefined) return '';
              return c.type === 'money' ? csvMoney(v) : csvInt(v);
            },
          })),
        ];
        const totalRow = { __total: true };
        g.cols.forEach((c) => {
          totalRow[c.key] = c.sum || c.total ? tt[c.key] : null;
        });
        const csv = toCSV([...rows, totalRow], columns);
        const slug = ctx.store?.slug || 'rede';
        downloadFile(`vendas-${g.file}-${slug}-${data.from}-a-${data.to}.csv`, csv);
        toast('Relatório exportado.', 'success');
      } catch (err) {
        toastError(err);
      }
    });

    printBtn?.addEventListener('click', () => {
      drawPrintHead();
      window.print();
    });

    ctx.onCleanup(() => {
      disposed = true;
      picker?.destroy();
    });

    await load();
  },
};
