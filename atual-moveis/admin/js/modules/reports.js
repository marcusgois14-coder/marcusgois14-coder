// Relatórios de vendas: período + agrupamento (dia, loja, categoria, produto, pagamento, status),
// tabela com totais, gráfico de faturamento, exportação CSV e impressão.
import { rpc } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  showErrors,
  injectStyle,
  debounce,
  money,
  num,
  barChart,
  statusBadge,
  loading,
  empty,
  errorBlock,
  dayStart,
  dayEnd,
  datetime,
  toCSV,
  downloadFile,
  ORDER_STATUS,
  PAYMENT_METHOD,
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
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const monthStart = (ymd) => `${ymd.slice(0, 8)}01`;
const MAX_DAYS = 1100;
// Em celulares o gráfico fica mais alto e com texto maior (o SVG escala pela largura).
const isPhone = () => window.matchMedia('(max-width: 560px)').matches;

const axisMoney = (v) => {
  const n = Number(v) || 0;
  const fix = (x) => x.toFixed(x >= 10 ? 0 : 1).replace(/\.0$/, '').replace('.', ',');
  if (n >= 1e6) return `${fix(n / 1e6)} mi`;
  if (n >= 1e3) return `${fix(n / 1e3)} mil`;
  return String(Math.round(n));
};
// CSV para planilhas em pt-BR: vírgula decimal, sem separador de milhar.
const csvMoney = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
const csvInt = (v) => String(Math.round(Number(v) || 0));

const QUICK = [
  { id: 'today', label: 'Hoje', range: (t) => [t, t] },
  { id: '7d', label: '7 dias', range: (t) => [addDays(t, -6), t] },
  { id: '30d', label: '30 dias', range: (t) => [addDays(t, -29), t] },
  { id: 'month', label: 'Este mês', range: (t) => [monthStart(t), t] },
  {
    id: 'last-month',
    label: 'Mês passado',
    range: (t) => {
      const end = addDays(monthStart(t), -1);
      return [monthStart(end), end];
    },
  },
  { id: 'year', label: 'Este ano', range: (t) => [`${t.slice(0, 4)}-01-01`, t] },
];

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
  { id: 'day', file: 'por-dia', label: 'Por dia', head: 'Dia', cols: ORDER_COLS, sort: { key: 'label', dir: 'asc' } },
  { id: 'store', file: 'por-loja', label: 'Por loja', head: 'Loja', cols: ORDER_COLS, network: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'category', file: 'por-categoria', label: 'Por categoria', head: 'Categoria', cols: ITEM_COLS, items: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'product', file: 'por-produto', label: 'Por produto', head: 'Produto', cols: ITEM_COLS, items: true, sku: true, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'payment', file: 'por-pagamento', label: 'Por forma de pagamento', head: 'Forma de pagamento', cols: ORDER_COLS, sort: { key: 'revenue', dir: 'desc' } },
  { id: 'status', file: 'por-status', label: 'Por status', head: 'Status', cols: ORDER_COLS, sort: { key: 'label', dir: 'asc' } },
];

function labelText(group, r) {
  if (group.id === 'day') return brDate(r.label);
  if (group.id === 'payment') return paymentLabel(r.label);
  if (group.id === 'status') return statusLabel(r.label);
  return r.label || '—';
}

function labelCell(group, r) {
  if (group.id === 'day') return html`<span class="nowrap">${brDate(r.label)}</span> <span class="faint small">${weekday(r.label)}</span>`;
  if (group.id === 'status') return statusBadge(r.label);
  return html`<span class="rep__label">${labelText(group, r)}</span>`;
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

/* ---------- Estilos do módulo ---------- */
const CSS = `
.rep { display: flex; flex-direction: column; gap: 18px; }
.rep__filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 16px 18px; }
.rep__dates { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.rep__dates .field { width: 160px; }
.rep__quick { flex: 1; min-width: 0; }
.rep__quick .chips { justify-content: flex-end; }
.rep .tabs { margin-bottom: 0; }
.rep__results { display: flex; flex-direction: column; gap: 18px; }
.rep__results[aria-busy="true"] { opacity: .55; pointer-events: none; transition: opacity .2s; }
.rep__kpis { display: grid; gap: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.rep__kpis .kpi__value { white-space: nowrap; }
.rep__chart { overflow-x: auto; }
.rep__bars { display: grid; grid-template-columns: minmax(120px, 34%) minmax(0, 1fr) auto; align-items: center; gap: 10px 14px; }
.rep__bars li { display: contents; }
.rep__bar-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink); }
.rep__bar { height: 14px; border-radius: 0 4px 4px 0; background: #f1f1f1; overflow: hidden; }
.rep__bar span { display: block; height: 100%; min-width: 2px; border-radius: 0 4px 4px 0; background: var(--accent); }
.rep__bar-value { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; font-weight: 600; color: var(--ink); }
.rep .card > .table-wrap { border: 0; border-radius: 0 0 var(--radius) var(--radius); }
.rep .table td.num, .rep .table th.num { text-align: right; }
.rep .table tfoot td { border-top: 2px solid var(--line-strong); border-bottom: 0; background: var(--surface-2); font-weight: 700; color: var(--ink); }
.rep__label { display: inline-block; min-width: 160px; }
.rep__sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
.rep__sort:hover { color: var(--ink); }
.rep__sort-ind { min-width: 9px; font-size: 9px; }
th.num .rep__sort { flex-direction: row-reverse; }
.rep__note { padding: 10px 18px 14px; }
.rep__print-head { display: none; }
.rep-act__label { display: inline; }
@media (max-width: 1100px) {
  .rep__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rep__quick .chips { justify-content: flex-start; }
}
@media (max-width: 860px) {
  .rep .table th:first-child, .rep .table td:first-child { position: sticky; left: 0; z-index: 1; box-shadow: 1px 0 0 var(--line); }
  .rep .table td:first-child { background: #fff; }
  .rep .table th:first-child { z-index: 2; }
  .rep .table tfoot td:first-child { background: var(--surface-2); }
  .rep__label { min-width: 130px; }
}
@media (max-width: 560px) {
  .rep { gap: 14px; }
  .rep .table th, .rep .table td { padding: 10px; }
  .rep__filters { padding: 14px; }
  .rep__dates { width: 100%; }
  .rep__dates .field { width: auto; flex: 1 1 130px; }
  .rep__quick { flex-basis: 100%; }
  .rep__kpis { gap: 12px; }
  .rep__kpis .kpi { padding: 13px 14px; }
  .rep__kpis .kpi__label { font-size: 11px; letter-spacing: .2px; }
  .rep__kpis .kpi__value { font-size: 19px; }
  .rep__chart, .rep__chart .chart { overflow: visible; }
  .rep__chart .chart text { font-size: 22px; }
  .rep__chart .chart text[text-anchor="middle"] { transform: translateY(10px); }
  .rep__chart { padding-bottom: 6px; }
  .rep__bars { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; }
  .rep__bar-label { grid-column: 1 / -1; margin-top: 6px; }
  .rep .card__head { flex-wrap: wrap; row-gap: 2px; }
  .rep-act { width: 30px; padding: 0; }
  .rep-act__label { display: none; }
}
@media print {
  .rep__print-head { display: block; margin-bottom: 4px; }
  .rep__print-head h2 { font-size: 18px; font-weight: 700; color: #000; }
  .rep .table-wrap, .rep__chart { overflow: visible; }
  .rep .card { break-inside: avoid; }
  .rep .table th { position: static; }
  .rep__bar, .rep__bar span, .rep .chart .bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rep__sort-ind { display: none; }
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
    let data = null; // { group, from, to, rows }

    const groups = GROUPS.filter((g) => !g.network || !ctx.storeId);
    const t = today();
    const qy = ctx.query || {};
    let from = isYmd(qy.from) ? qy.from : state.from || monthStart(t);
    let to = isYmd(qy.to) ? qy.to : state.to || t;
    if (to > t) to = t;
    if (from > to) [from, to] = [monthStart(t), t];
    let groupId = groups.some((g) => g.id === qy.group) ? qy.group : groups.some((g) => g.id === state.group) ? state.group : 'day';
    const group = () => groups.find((g) => g.id === groupId) || groups[0];
    const sortOf = (g) => state.sort[g.id] || g.sort;

    render(
      view,
      html`<div class="rep">
        <div class="card no-print">
          <form class="rep__filters" data-filters novalidate>
            <div class="rep__dates">
              <div class="field"><label for="rep-from">De</label><input class="input" type="date" id="rep-from" name="from" value="${from}" max="${t}" required></div>
              <div class="field"><label for="rep-to">Até</label><input class="input" type="date" id="rep-to" name="to" value="${to}" max="${t}" required></div>
            </div>
            <div class="rep__quick"><div class="chips" role="group" aria-label="Períodos rápidos" data-quick></div></div>
          </form>
        </div>
        <div class="tabs no-print" role="tablist" aria-label="Agrupar por" data-tabs></div>
        <div class="rep__print-head" data-print-head></div>
        <div class="rep__results" id="rep-results" role="tabpanel" data-results>${loading('Gerando relatório…')}</div>
        <p class="visually-hidden" role="status" aria-live="polite" data-status></p>
      </div>`
    );
    const form = $('[data-filters]', view);
    const results = $('[data-results]', view);

    ctx.setActions(html`
      <button class="btn btn--sm rep-act" type="button" data-export aria-label="Exportar CSV" title="Exportar CSV" disabled>${icon('download', 'icon-sm')}<span class="rep-act__label">Exportar CSV</span></button>
      <button class="btn btn--sm rep-act" type="button" data-print aria-label="Imprimir" title="Imprimir" disabled>${icon('print', 'icon-sm')}<span class="rep-act__label">Imprimir</span></button>`);
    const exportBtn = $('[data-actions] [data-export]');
    const printBtn = $('[data-actions] [data-print]');
    const setActionsEnabled = (on) => {
      if (exportBtn) exportBtn.disabled = !on;
      if (printBtn) printBtn.disabled = !on;
    };

    const scopeName = () => (ctx.store ? ctx.store.name : 'Toda a rede');

    function syncRoute() {
      if (disposed) return;
      const params = new URLSearchParams({ from, to, group: groupId });
      history.replaceState(null, '', `#/reports?${params}`);
      state.from = from;
      state.to = to;
      state.group = groupId;
    }

    function drawQuick() {
      const tt = today();
      render(
        $('[data-quick]', view),
        QUICK.map((qr) => {
          const [a, b] = qr.range(tt);
          const on = a === from && b === to;
          return html`<button type="button" class="chip ${on ? 'is-active' : ''}" data-quick-id="${qr.id}" aria-pressed="${on ? 'true' : 'false'}">${qr.label}</button>`;
        })
      );
    }

    function drawTabs() {
      render(
        $('[data-tabs]', view),
        groups.map(
          (g) => html`<button type="button" class="tab ${g.id === groupId ? 'is-active' : ''}" role="tab" aria-controls="rep-results" aria-selected="${g.id === groupId ? 'true' : 'false'}" tabindex="${g.id === groupId ? '0' : '-1'}" data-group="${g.id}">${g.label}</button>`
        )
      );
    }

    function drawPrintHead() {
      render(
        $('[data-print-head]', view),
        html`<h2>Relatório de vendas · ${group().label.toLowerCase()}</h2>
        <p class="small">${scopeName()} · ${from === to ? brDate(from) : `${brDate(from)} a ${brDate(to)}`} · gerado em ${datetime(new Date())}</p>`
      );
    }

    /* ----- Resultado ----- */
    function kpis(g, rows) {
      const tt = totals(g, rows);
      if (g.items) {
        return html`<div class="rep__kpis">
          <div class="card kpi"><div class="kpi__label">Faturamento em itens</div><div class="kpi__value">${money(tt.revenue)}</div><div class="kpi__hint">Sem frete e descontos do pedido</div></div>
          <div class="card kpi"><div class="kpi__label">Unidades vendidas</div><div class="kpi__value">${num(tt.qty)}</div><div class="kpi__hint">Pedidos não cancelados</div></div>
          <div class="card kpi"><div class="kpi__label">${g.id === 'product' ? 'Produtos vendidos' : 'Categorias'}</div><div class="kpi__value">${num(rows.length)}</div><div class="kpi__hint">Com ao menos uma venda</div></div>
          <div class="card kpi"><div class="kpi__label">Preço médio</div><div class="kpi__value">${money(tt.qty ? tt.revenue / tt.qty : 0)}</div><div class="kpi__hint">Por unidade vendida</div></div>
        </div>`;
      }
      const canceled = (tt.orders || 0) - (tt.orders_ok || 0);
      return html`<div class="rep__kpis">
        <div class="card kpi"><div class="kpi__label">Faturamento</div><div class="kpi__value">${money(tt.revenue)}</div><div class="kpi__hint">Pedidos não cancelados</div></div>
        <div class="card kpi"><div class="kpi__label">Pedidos válidos</div><div class="kpi__value">${num(tt.orders_ok)}</div><div class="kpi__hint">${num(tt.orders)} no total · ${num(canceled)} ${canceled === 1 ? 'cancelado' : 'cancelados'}</div></div>
        <div class="card kpi"><div class="kpi__label">Ticket médio</div><div class="kpi__value">${money(tt.avg_ticket)}</div><div class="kpi__hint">Por pedido válido</div></div>
        <div class="card kpi"><div class="kpi__label">Descontos</div><div class="kpi__value">${money(tt.discounts)}</div><div class="kpi__hint">Cupons e PIX · fretes ${money(tt.delivery_fees)}</div></div>
      </div>`;
    }

    function chart(g, rows) {
      if (g.id === 'day') {
        const byDay = new Map(rows.map((r) => [r.label, Number(r.revenue) || 0]));
        const ordersByDay = new Map(rows.map((r) => [r.label, Number(r.orders_ok) || 0]));
        const span = daysBetween(from, to);
        const days = [];
        for (let i = 0; i <= span; i++) days.push(addDays(from, i));
        const series = days.map((d) => ({
          label: brShort(d),
          value: byDay.get(d) || 0,
          title: `${brDate(d)}: ${money(byDay.get(d) || 0)} · ${num(ordersByDay.get(d) || 0)} ${ordersByDay.get(d) === 1 ? 'pedido válido' : 'pedidos válidos'}`,
        }));
        const best = series.reduce((b, s) => (s.value > (b?.value || 0) ? s : b), null);
        return html`<section class="card" aria-labelledby="rep-chart-title">
          <div class="card__head"><h2 class="h2" id="rep-chart-title">Faturamento por dia <span class="muted small">(R$)</span></h2>
          <span class="muted small">${num(days.length)} ${days.length === 1 ? 'dia' : 'dias'}</span></div>
          <div class="card__body"><div class="rep__chart">${barChart(series, { height: isPhone() ? 420 : 240, format: axisMoney })}</div>
          <p class="visually-hidden">Faturamento por dia entre ${brDate(from)} e ${brDate(to)}${best ? `; melhor dia ${best.label}, com ${money(best.value)}` : ''}.</p></div>
        </section>`;
      }
      const top = [...rows].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0)).slice(0, 20);
      const max = Math.max(1, ...top.map((r) => Number(r.revenue) || 0));
      return html`<section class="card" aria-labelledby="rep-chart-title">
        <div class="card__head"><h2 class="h2" id="rep-chart-title">Faturamento ${g.label.toLowerCase()}</h2>
        <span class="muted small">${rows.length > 20 ? 'Top 20 de ' + num(rows.length) : `${num(rows.length)} ${rows.length === 1 ? 'item' : 'itens'}`}</span></div>
        <div class="card__body">
          <ol class="rep__bars">
            ${top.map((r) => {
              const v = Number(r.revenue) || 0;
              const text = labelText(g, r);
              return html`<li>
                <span class="rep__bar-label" title="${text}">${text}</span>
                <span class="rep__bar" aria-hidden="true"><span style="width:${((v / max) * 100).toFixed(1)}%"></span></span>
                <span class="rep__bar-value">${money(v)}</span>
              </li>`;
            })}
          </ol>
        </div>
      </section>`;
    }

    function tableCard(g, rows) {
      const sort = sortOf(g);
      const sorted = sortRows(g, rows, sort);
      const tt = totals(g, rows);
      const head = (key, label, cls = '') => {
        const on = sort.key === key;
        const ariaSort = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        return html`<th class="${cls}" scope="col" aria-sort="${ariaSort}"><button type="button" class="rep__sort" data-sort="${key}">${label}<span class="rep__sort-ind" aria-hidden="true">${on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`;
      };
      return html`<section class="card" aria-labelledby="rep-table-title">
        <div class="card__head"><h2 class="h2" id="rep-table-title">Detalhamento</h2>
        <span class="muted small">${num(rows.length)} ${rows.length === 1 ? 'linha' : 'linhas'}<span class="no-print"> · clique no título da coluna para ordenar</span></span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            ${head('label', g.head)}
            ${g.sku ? head('sku', 'SKU') : ''}
            ${g.cols.map((c) => head(c.key, c.label, 'num'))}
          </tr></thead>
          <tbody>${sorted.map(
            (r) => html`<tr>
              <td>${labelCell(g, r)}</td>
              ${g.sku ? html`<td class="mono nowrap">${r.sku || '—'}</td>` : ''}
              ${g.cols.map((c) => html`<td class="num">${fmt(c.type, r[c.key])}</td>`)}
            </tr>`
          )}</tbody>
          <tfoot><tr>
            <td>Total</td>
            ${g.sku ? html`<td></td>` : ''}
            ${g.cols.map((c) => html`<td class="num">${c.sum || c.total ? fmt(c.type, tt[c.key]) : '—'}</td>`)}
          </tr></tfoot>
        </table></div>
        ${g.items
          ? html`<p class="rep__note muted small">Faturamento soma o valor dos itens de pedidos não cancelados (sem frete e sem descontos do pedido). Um pedido com itens de vários ${g.id === 'product' ? 'produtos' : 'categorias'} conta em cada linha, por isso a coluna Pedidos não tem total.</p>`
          : groupId === 'status'
            ? html`<p class="rep__note muted small">Pedidos cancelados entram na contagem de pedidos, mas não no faturamento.</p>`
            : ''}
      </section>`;
    }

    function drawResults() {
      if (!data) return;
      const g = groups.find((x) => x.id === data.group) || group();
      if (!data.rows.length) {
        render(
          results,
          html`<div class="card">${empty('Nenhuma venda no período', `Não há pedidos entre ${brDate(data.from)} e ${brDate(data.to)} para ${scopeName().toLowerCase() === 'toda a rede' ? 'a rede' : scopeName()}. Ajuste as datas acima.`)}</div>`
        );
        return;
      }
      render(results, html`${kpis(g, data.rows)}${chart(g, data.rows)}${tableCard(g, data.rows)}`);
    }

    async function load() {
      const my = ++token;
      const g = group();
      syncRoute();
      drawPrintHead();
      setActionsEnabled(false);
      if (shown) results.setAttribute('aria-busy', 'true');
      else render(results, loading('Gerando relatório…'));
      try {
        const rows = await rpc('sales_report', { p_store: ctx.storeId, p_from: dayStart(from), p_to: dayEnd(to), p_group: g.id });
        if (disposed || my !== token) return;
        data = { group: g.id, from, to, rows: Array.isArray(rows) ? rows : [] };
        drawResults();
        const status = $('[data-status]', view);
        if (status) status.textContent = data.rows.length ? `Relatório ${g.label.toLowerCase()} atualizado: ${data.rows.length} ${data.rows.length === 1 ? 'linha' : 'linhas'}.` : 'Nenhuma venda no período.';
        shown = true;
        setActionsEnabled(data.rows.length > 0);
      } catch (e) {
        if (disposed || my !== token) return;
        data = null;
        shown = false;
        render(results, html`${errorBlock(e)}<div><button class="btn" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div>`);
      } finally {
        if (my === token && !disposed) results.removeAttribute('aria-busy');
      }
    }

    function validate() {
      const f = form.from.value;
      const tv = form.to.value;
      const errors = {};
      if (!isYmd(f)) errors.from = 'Informe a data inicial';
      if (!isYmd(tv)) errors.to = 'Informe a data final';
      if (!errors.from && !errors.to) {
        if (f < '2020-01-01') errors.from = 'Data muito antiga';
        else if (f > tv) errors.to = 'Deve ser igual ou posterior à data inicial';
        else if (daysBetween(f, tv) + 1 > MAX_DAYS) errors.to = 'Escolha um período de até 3 anos';
      }
      // não rouba o foco enquanto a pessoa ainda está digitando a data
      const active = document.activeElement;
      showErrors(form, errors);
      if (active && form.contains(active)) active.focus();
      return Object.keys(errors).length ? null : { f, tv };
    }

    const onDates = debounce(() => {
      const ok = validate();
      if (!ok || (ok.f === from && ok.tv === to)) return;
      from = ok.f;
      to = ok.tv;
      drawQuick();
      load();
    }, 450);
    form.addEventListener('change', (e) => {
      if (e.target.matches('input[type="date"]')) onDates();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onDates();
    });

    form.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-quick-id]');
      if (!chip) return;
      const qr = QUICK.find((x) => x.id === chip.dataset.quickId);
      if (!qr) return;
      [from, to] = qr.range(today());
      form.from.value = from;
      form.to.value = to;
      showErrors(form, {});
      drawQuick();
      load();
    });

    const tabsEl = $('[data-tabs]', view);
    tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-group]');
      if (!tab || tab.dataset.group === groupId) return;
      groupId = tab.dataset.group;
      drawTabs();
      load();
    });
    // setas trocam de aba (padrão de tablist)
    tabsEl.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs = $$('[data-group]', tabsEl);
      const i = tabs.findIndex((x) => x.dataset.group === groupId);
      let n = i;
      if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = tabs.length - 1;
      e.preventDefault();
      groupId = tabs[n].dataset.group;
      drawTabs();
      $(`[data-group="${groupId}"]`, tabsEl)?.focus();
      load();
    });

    results.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return load();
      const th = e.target.closest('[data-sort]');
      if (!th || !data) return;
      const g = groups.find((x) => x.id === data.group);
      const key = th.dataset.sort;
      const cur = sortOf(g);
      const textKey = key === 'label' || key === 'sku';
      state.sort[g.id] = cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: textKey ? 'asc' : 'desc' };
      drawResults();
      $(`[data-sort="${key}"]`, results)?.focus();
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
    });

    drawQuick();
    drawTabs();
    await load();
  },
};
