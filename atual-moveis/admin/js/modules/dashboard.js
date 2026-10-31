// Painel: indicadores do período (vendas, pedidos, clientes) e do catálogo,
// da loja selecionada ou da rede inteira (ctx.storeId nulo, só admins da rede).
import { rpc } from '../api.js';
import {
  html,
  render,
  $,
  icon,
  toastError,
  showErrors,
  injectStyle,
  debounce,
  money,
  num,
  pct,
  barChart,
  statusBadge,
  table,
  loading,
  empty,
  errorBlock,
  dayStart,
  dayEnd,
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

// Eixo do gráfico: valores curtos ("12 mil") — o título do cartão indica que é em R$.
const axisMoney = (v) => {
  const n = Number(v) || 0;
  const fix = (x) => x.toFixed(x >= 10 ? 0 : 1).replace(/\.0$/, '').replace('.', ',');
  if (n >= 1e6) return `${fix(n / 1e6)} mi`;
  if (n >= 1e3) return `${fix(n / 1e3)} mil`;
  return String(Math.round(n));
};
// Em celulares o gráfico fica mais alto e com texto maior (o SVG escala pela largura).
const isPhone = () => window.matchMedia('(max-width: 560px)').matches;
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;

const PERIODS = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
  { id: 'custom', label: 'Personalizado' },
];
const MAX_DAYS = 731;

// Mantém o período escolhido enquanto a pessoa navega pelo painel (inclusive ao trocar de loja).
const state = { period: '7d', from: null, to: null };

function currentRange() {
  const t = today();
  switch (state.period) {
    case 'today':
      return { from: t, to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case 'month':
      return { from: `${t.slice(0, 8)}01`, to: t };
    case 'custom':
      return { from: state.from || addDays(t, -6), to: state.to || t };
    default:
      return { from: addDays(t, -6), to: t };
  }
}

function rangeLabel({ from, to }) {
  if (from === to) return from === today() ? `Hoje, ${brDate(from)}` : brDate(from);
  return `${brDate(from)} a ${brDate(to)}`;
}

// Janela anterior de mesmo tamanho. Se o período termina hoje, compara até o mesmo horário
// (ex.: hoje até agora × ontem até a mesma hora), para não comparar dia parcial com dia cheio.
function previousWindow({ from, to }) {
  const span = (daysBetween(from, to) + 1) * 86400000;
  const start = Date.parse(dayStart(from));
  const end = Math.min(Date.parse(dayEnd(to)), Date.now());
  return { p_from: new Date(start - span).toISOString(), p_to: new Date(end - span).toISOString() };
}

function delta(cur, prev) {
  if (prev === undefined || prev === null) return '';
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return ''; // sem base de comparação: o cartão mostra a descrição padrão
  const d = ((c - p) / p) * 100;
  if (Math.abs(d) < 0.5) return html`<span class="muted">Estável vs. período anterior</span>`;
  const up = d > 0;
  return html`<span class="dash__delta ${up ? 'dash__delta--up' : 'dash__delta--down'}"><span aria-hidden="true">${up ? '↑' : '↓'}</span><span class="visually-hidden">${up ? 'Alta de' : 'Queda de'}</span> ${Math.abs(d) < 10 ? pct(Math.abs(d), 1) : `${num(Math.round(Math.abs(d)))}%`}</span>
    <span class="muted">vs. período anterior</span>`;
}

const kpi = ({ label, value, hint = '', tone = '' }) =>
  html`<div class="card kpi dash__kpi ${tone ? `dash__kpi--${tone}` : ''}">
    <div class="kpi__label">${label}</div>
    <div class="kpi__value">${value}</div>
    ${hint ? html`<div class="kpi__hint">${hint}</div>` : ''}
  </div>`;

/* ---------- Blocos ---------- */
function salesBlock(d, prev, ctx) {
  const orders = Number(d.orders) || 0;
  const ok = Number(d.orders_ok) || 0;
  const canceled = orders - ok;
  const pending = Number(d.pending_now) || 0;
  const series = Array.isArray(d.series) ? d.series : [];
  const byStatus = d.by_status || {};
  const byPayment = Object.entries(d.by_payment || {}).sort((a, b) => b[1] - a[1]);
  const payTotal = byPayment.reduce((s, [, n]) => s + Number(n), 0);
  const top = Array.isArray(d.top_products) ? d.top_products : [];
  const hasRevenue = series.some((s) => Number(s.revenue) > 0);
  const best = series.reduce((b, s) => (Number(s.revenue) > Number(b?.revenue || 0) ? s : b), null);
  const statusKeys = [...Object.keys(ORDER_STATUS), ...Object.keys(byStatus).filter((s) => !ORDER_STATUS[s])];

  return html`
    <div class="dash__kpis">
      ${kpi({ label: 'Faturamento', value: money(d.revenue), hint: delta(d.revenue, prev?.revenue) || 'Pedidos não cancelados' })}
      ${kpi({
        label: 'Pedidos',
        value: html`${num(ok)}<span class="dash__of" title="Válidos / total no período"> / ${num(orders)}</span>`,
        hint: delta(ok, prev?.orders_ok) || (canceled ? `Válidos / total · ${plural(canceled, 'cancelado', 'cancelados')}` : 'Válidos / total'),
      })}
      ${kpi({ label: 'Ticket médio', value: money(d.avg_ticket), hint: delta(d.avg_ticket, prev?.avg_ticket) || 'Por pedido válido' })}
      ${kpi({ label: 'Itens vendidos', value: num(d.items_sold), hint: delta(d.items_sold, prev?.items_sold) || 'Unidades em pedidos válidos' })}
      ${kpi({
        label: 'Aguardando confirmação',
        value: num(pending),
        tone: pending ? 'warning' : '',
        hint: html`<span class="muted">Agora</span> · <a href="#/orders?status=pending">Ver pedidos</a>`,
      })}
      ${kpi({ label: 'Novos clientes', value: num(d.new_customers), hint: delta(d.new_customers, prev?.new_customers) || 'Primeira compra no período' })}
    </div>

    <div class="split">
      <section class="card" aria-labelledby="dash-chart-title">
        <div class="card__head">
          <h2 class="h2" id="dash-chart-title">Faturamento por dia <span class="muted small">(R$)</span></h2>
          <span class="muted small">${plural(ok, 'pedido válido', 'pedidos válidos')}</span>
        </div>
        <div class="card__body">
          ${hasRevenue
            ? html`<div class="dash__chart">${barChart(
                series.map((s) => ({
                  label: brShort(s.day),
                  value: Number(s.revenue) || 0,
                  title: `${brDate(s.day)}: ${money(s.revenue)} · ${plural(s.orders, 'pedido', 'pedidos')}`,
                })),
                { height: isPhone() ? 420 : 240, format: axisMoney }
              )}</div>
              ${series.length === 1 ? html`<p class="muted small mt-2">Para ver a evolução dia a dia, escolha um período maior.</p>` : ''}
              <p class="visually-hidden">Faturamento de ${money(d.revenue)} em ${plural(series.length, 'dia', 'dias')}${
                best ? `; melhor dia ${brDate(best.day)}, com ${money(best.revenue)}` : ''
              }.</p>`
            : empty('Sem vendas no período', 'Os pedidos válidos aparecem aqui, dia a dia.')}
        </div>
      </section>

      <section class="card" aria-labelledby="dash-status-title">
        <div class="card__head">
          <h2 class="h2" id="dash-status-title">Pedidos por status</h2>
          <span class="muted small">${plural(orders, 'pedido', 'pedidos')}</span>
        </div>
        <ul class="dash__statuses">
          ${statusKeys.map((s) => {
            const n = Number(byStatus[s]) || 0;
            return html`<li><a class="dash__status ${n ? '' : 'is-zero'}" href="#/orders?status=${encodeURIComponent(s)}">
              ${statusBadge(s)}<span class="dash__status-n">${num(n)}</span>${icon('chevronRight', 'icon-sm')}
            </a></li>`;
          })}
        </ul>
      </section>
    </div>

    <div class="split">
      <section class="card" aria-labelledby="dash-top-title">
        <div class="card__head">
          <h2 class="h2" id="dash-top-title">Mais vendidos</h2>
          <span class="muted small">Top 10 por quantidade</span>
        </div>
        ${table({
          columns: [
            { key: 'rank', label: '#', cls: 'dash__rank', render: (r) => r.rank },
            { key: 'name', label: 'Produto', render: (r) => html`<span class="dash__name">${r.name}</span>` },
            { key: 'qty', label: 'Qtd.', cls: 'num', render: (r) => num(r.qty) },
            { key: 'revenue', label: 'Faturamento', cls: 'num', render: (r) => money(r.revenue) },
          ],
          rows: top.map((r, i) => ({ ...r, rank: i + 1 })),
          empty: 'Nenhum produto vendido no período.',
        })}
      </section>

      <section class="card" aria-labelledby="dash-pay-title">
        <div class="card__head">
          <h2 class="h2" id="dash-pay-title">Formas de pagamento</h2>
          <span class="muted small">Pedidos válidos</span>
        </div>
        <div class="card__body">
          ${byPayment.length
            ? html`<ul class="dash__pays">${byPayment.map(([k, n]) => {
                const share = payTotal ? (Number(n) / payTotal) * 100 : 0;
                return html`<li>
                  <div class="dash__pay-row"><span>${PAYMENT_METHOD[k] || k}</span>
                  <span class="muted small nowrap"><strong class="dash__pay-n">${num(n)}</strong> · ${pct(share)}</span></div>
                  <div class="meter" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></div>
                </li>`;
              })}</ul>`
            : html`<p class="muted">Nenhum pedido válido no período.</p>`}
        </div>
      </section>
    </div>

    ${ctx.storeId ? '' : storesBlock(d)}`;
}

function storesBlock(d) {
  const rows = Array.isArray(d.by_store) ? d.by_store : [];
  const total = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  return html`<section class="card" aria-labelledby="dash-stores-title">
    <div class="card__head">
      <h2 class="h2" id="dash-stores-title">Desempenho por loja</h2>
      <span class="muted small">Clique em uma loja para abrir o painel dela</span>
    </div>
    ${table({
      columns: [
        {
          key: 'name',
          label: 'Loja',
          render: (r) =>
            html`<button type="button" class="dash__store-link" data-store-id="${r.id}">${r.name}</button>${
              Number(r.pending) ? html`<span class="dash__sub dash__sub--warning small">${plural(r.pending, 'aguardando', 'aguardando')}</span>` : ''
            }`,
        },
        { key: 'orders', label: 'Pedidos', cls: 'num', render: (r) => num(r.orders) },
        { key: 'revenue', label: 'Faturamento', cls: 'num', render: (r) => money(r.revenue) },
        {
          key: 'share',
          label: 'Participação',
          cls: 'dash__share-col',
          render: (r) => {
            const share = total ? ((Number(r.revenue) || 0) / total) * 100 : 0;
            return html`<div class="dash__share"><div class="meter" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></div><span class="small muted">${pct(share)}</span></div>`;
          },
        },
        {
          key: 'pending',
          label: 'Aguardando',
          cls: 'num dash__pending-col',
          render: (r) => (Number(r.pending) ? html`<span class="badge badge--warning">${num(r.pending)}</span>` : html`<span class="faint">0</span>`),
        },
      ],
      rows,
      rowAttrs: (r) => `class="is-clickable" data-store-row="${String(r.id).replace(/[^0-9a-f-]/gi, '')}"`,
      empty: 'Nenhuma loja cadastrada.',
    })}
  </section>`;
}

function catalogBlock(d, ctx) {
  const c = d.catalog || {};
  const list = Array.isArray(d.low_stock_list) ? d.low_stock_list : [];
  const canCatalog = ctx.can('catalog');
  const stat = (label, value, tone, href) => {
    const inner = html`<span class="dash__stat-label">${label}</span><span class="dash__stat-value">${num(value)}</span>`;
    const cls = `dash__stat ${tone && Number(value) ? `dash__stat--${tone}` : ''}`;
    return canCatalog ? html`<a class="${cls}" href="${href}">${inner}</a>` : html`<div class="${cls}">${inner}</div>`;
  };
  return html`<section class="card" aria-labelledby="dash-catalog-title">
    <div class="card__head">
      <h2 class="h2" id="dash-catalog-title">Catálogo</h2>
      ${canCatalog ? html`<a class="small" href="#/products">Ver produtos</a>` : ''}
    </div>
    <div class="card__body stack">
      <div class="dash__stats">
        ${stat('Ativos', c.active, 'success', '#/products?status=active')}
        ${stat('Rascunhos', c.draft, '', '#/products?status=draft')}
        ${stat('Arquivados', c.archived, '', '#/products?status=archived')}
        ${stat('Sem estoque', c.out_of_stock, 'danger', '#/products?stock=out')}
        ${stat('Estoque baixo', c.low_stock, 'warning', '#/products?stock=low')}
      </div>
      <div>
        <div class="row row--between mb-2">
          <h3 class="h3">Produtos para repor</h3>
          <span class="muted small">Ativos com estoque baixo ou zerado${list.length >= 15 ? ' · 15 primeiros' : ''}</span>
        </div>
        ${table({
          columns: [
            {
              key: 'name',
              label: 'Produto',
              render: (r) =>
                html`${canCatalog ? html`<a href="#/products/${encodeURIComponent(r.id)}">${r.name}</a>` : r.name}${
                  ctx.storeId ? '' : html`<span class="dash__sub muted small">${r.store_name}</span>`
                }`,
            },
            ...(ctx.storeId ? [] : [{ key: 'store_name', label: 'Loja', cls: 'dash__store-col', render: (r) => html`<span class="nowrap">${r.store_name}</span>` }]),
            {
              key: 'stock_qty',
              label: 'Estoque',
              cls: 'num',
              render: (r) =>
                Number(r.stock_qty) <= 0
                  ? html`<span class="badge badge--danger">Sem estoque</span>`
                  : html`<span class="badge badge--warning">${plural(r.stock_qty, 'unidade', 'unidades')}</span>`,
            },
          ],
          rows: list,
          empty: 'Nenhum produto com estoque baixo.',
        })}
      </div>
    </div>
  </section>`;
}

/* ---------- Estilos do módulo ---------- */
const CSS = `
.dash { display: flex; flex-direction: column; gap: 20px; }
.dash .split { gap: 20px; }
.dash__toolbar { margin: 0; align-items: flex-end; }
.dash__range { margin-left: auto; align-self: center; }
.dash__custom { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.dash__custom .field { width: 160px; }
.dash__body[aria-busy="true"] { opacity: .55; pointer-events: none; transition: opacity .2s; }
.dash__body { display: flex; flex-direction: column; gap: 20px; }
.dash__kpis { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dash__kpi .kpi__value { white-space: nowrap; }
.dash__kpi--warning { border-color: #f3d39c; background: linear-gradient(0deg, var(--warning-soft), #fff 70%); }
.dash__kpi--warning .kpi__value { color: var(--warning); }
.dash__of { font-size: 16px; font-weight: 600; color: var(--muted); }
.dash__delta { font-weight: 700; white-space: nowrap; }
.dash__delta--up { color: var(--success); }
.dash__delta--down { color: var(--danger); }
.dash__chart { overflow-x: auto; }
.dash__statuses { padding: 6px 10px 10px; }
.dash__status { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: var(--radius-sm); color: var(--ink); }
.dash__status:hover { background: var(--surface-2); text-decoration: none; }
.dash__status .badge { margin-right: auto; }
.dash__status-n { font-weight: 700; font-variant-numeric: tabular-nums; }
.dash__status .icon-sm { color: var(--faint); }
.dash__status.is-zero .dash__status-n { color: var(--faint); font-weight: 600; }
.dash__pays { display: flex; flex-direction: column; gap: 14px; }
.dash__pay-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.dash__pay-n { color: var(--ink); }
.dash .card > .table-wrap { border: 0; border-radius: 0 0 var(--radius) var(--radius); }
.dash .card__body .table-wrap { border-radius: var(--radius-sm); }
.dash__rank { width: 36px; color: var(--muted); font-variant-numeric: tabular-nums; }
.dash__name { display: block; min-width: 180px; }
.dash__store-link { padding: 0; border: 0; background: none; color: var(--ink); font-weight: 600; text-align: left; cursor: pointer; }
.dash__store-link:hover { color: var(--accent); text-decoration: underline; }
.dash__share-col { width: 26%; min-width: 150px; }
.dash__share { display: flex; align-items: center; gap: 10px; }
.dash__share .meter { flex: 1; min-width: 60px; }
.dash__share span.small { width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.dash__stats { display: grid; gap: 12px; grid-template-columns: repeat(5, minmax(0, 1fr)); }
.dash__stat { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: inherit; }
a.dash__stat:hover { border-color: var(--line-strong); background: #fff; text-decoration: none; }
.dash__stat-label { font-size: 12.5px; font-weight: 600; color: var(--muted); }
.dash__stat-value { font-size: 22px; font-weight: 700; line-height: 1.2; color: var(--ink); font-variant-numeric: tabular-nums; }
.dash__stat--success .dash__stat-value { color: var(--success); }
.dash__stat--warning .dash__stat-value { color: var(--warning); }
.dash__stat--danger .dash__stat-value { color: var(--danger); }
.dash__sub { display: none; }
.dash-refresh.is-spinning svg { animation: spin .7s linear infinite; }
@media (max-width: 1100px) {
  .dash__stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .dash__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .dash__range { margin-left: 0; width: 100%; }
}
@media (max-width: 560px) {
  .dash, .dash__body { gap: 16px; }
  .dash__kpi { padding: 13px 14px; }
  .dash__kpi .kpi__label { font-size: 11px; letter-spacing: .2px; }
  .dash__kpi .kpi__value { font-size: 19px; }
  .dash__of { font-size: 14px; }
  .dash__kpi .kpi__hint { font-size: 12px; }
  .dash__chart, .dash__chart .chart { overflow: visible; }
  .dash__chart .chart text { font-size: 22px; }
  .dash__chart .chart text[text-anchor="middle"] { transform: translateY(10px); }
  .dash__chart { padding-bottom: 6px; }
  .dash .table th, .dash .table td { padding: 10px; }
  .dash__name { min-width: 0; }
  .dash__rank { width: 28px; }
  .dash__share-col, .dash__store-col, .dash__pending-col { display: none; }
  .dash__sub--warning { color: var(--warning); font-weight: 600; }
  .dash__stat:last-child:nth-child(odd) { grid-column: span 2; }
  .dash__sub { display: block; margin-top: 2px; }
  .dash__store-link { min-width: 120px; }
  .dash__custom { width: 100%; }
  .dash__custom .field { width: auto; flex: 1 1 130px; }
  .dash__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash .card__head { flex-wrap: wrap; row-gap: 2px; }
  .dash-refresh { width: 30px; padding: 0; }
  .dash-refresh__label { display: none; }
}
`;

/* ---------- Módulo ---------- */
export default {
  title: 'Painel',
  async render(view, ctx) {
    injectStyle('dashboard', CSS);
    // Mesma regra do banco: na visão da rede (só admins globais) ou com permissão de pedidos.
    const canSales = !ctx.storeId || ctx.can('orders');
    let disposed = false;
    let token = 0;
    let shown = false;

    render(
      view,
      html`<div class="dash">
        ${canSales ? html`<div data-filters></div>` : ''}
        <div class="dash__body" data-body>${loading('Carregando indicadores…')}</div>
      </div>`
    );
    const filtersEl = $('[data-filters]', view);
    const body = $('[data-body]', view);

    ctx.setActions(
      html`<button class="btn btn--sm dash-refresh" type="button" data-dash-refresh aria-label="Atualizar indicadores" title="Atualizar">${icon('refresh', 'icon-sm')}<span class="dash-refresh__label">Atualizar</span></button>`
    );
    const refreshBtn = $('[data-dash-refresh]');
    refreshBtn?.addEventListener('click', () => load());

    function drawFilters() {
      if (!filtersEl) return;
      const r = currentRange();
      const max = today();
      render(
        filtersEl,
        html`<div class="toolbar dash__toolbar">
          <div class="chips" role="group" aria-label="Período">
            ${PERIODS.map(
              (p) => html`<button type="button" class="chip ${state.period === p.id ? 'is-active' : ''}" data-period="${p.id}" aria-pressed="${state.period === p.id ? 'true' : 'false'}">${p.label}</button>`
            )}
          </div>
          ${state.period === 'custom'
            ? html`<form class="dash__custom" data-custom novalidate>
                <div class="field"><label for="dash-from">De</label><input class="input" type="date" id="dash-from" name="from" value="${r.from}" max="${max}" required></div>
                <div class="field"><label for="dash-to">Até</label><input class="input" type="date" id="dash-to" name="to" value="${r.to}" max="${max}" required></div>
                <button class="btn btn--primary" type="submit">Aplicar</button>
              </form>`
            : html`<span class="muted small dash__range">${rangeLabel(r)}</span>`}
        </div>`
      );
    }

    async function load() {
      const my = ++token;
      const r = currentRange();
      if (shown) body.setAttribute('aria-busy', 'true');
      else render(body, loading('Carregando indicadores…'));
      refreshBtn?.classList.add('is-spinning');
      try {
        const [cur, prev] = await Promise.all([
          rpc('dashboard', { p_store: ctx.storeId, p_from: dayStart(r.from), p_to: dayEnd(r.to) }),
          // comparação é um extra: se falhar, o painel segue sem ela
          canSales ? rpc('dashboard', { p_store: ctx.storeId, ...previousWindow(r) }).catch(() => null) : null,
        ]);
        if (disposed || my !== token) return;
        if (!cur) throw new Error('Não foi possível carregar os indicadores.');
        render(
          body,
          html`${cur.can_see_sales
            ? salesBlock(cur, prev?.can_see_sales ? prev : null, ctx)
            : html`<div class="alert alert--info">${icon('products')}<div><strong>Visão do catálogo.</strong> Seu perfil acompanha os produtos desta loja; os indicadores de vendas ficam com administradores, gerentes e atendimento.</div></div>`}
          ${catalogBlock(cur, ctx)}`
        );
        shown = true;
      } catch (e) {
        if (disposed || my !== token) return;
        if (shown) toastError(e);
        else
          render(
            body,
            html`${errorBlock(e)}<div><button class="btn" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div>`
          );
      } finally {
        if (my === token && !disposed) {
          body.removeAttribute('aria-busy');
          refreshBtn?.classList.remove('is-spinning');
        }
      }
    }

    filtersEl?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-period]');
      if (!chip) return;
      const id = chip.dataset.period;
      if (id === state.period) return;
      if (id === 'custom') {
        const r = currentRange();
        state.from = state.from || r.from;
        state.to = state.to || r.to;
        state.period = 'custom';
        drawFilters();
        $('#dash-from', filtersEl)?.focus();
        load();
        return;
      }
      state.period = id;
      drawFilters();
      load();
    });

    filtersEl?.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target.closest('[data-custom]');
      if (!form) return;
      const from = form.from.value;
      const to = form.to.value;
      const errors = {};
      if (!isYmd(from)) errors.from = 'Informe a data inicial';
      if (!isYmd(to)) errors.to = 'Informe a data final';
      if (!errors.from && !errors.to) {
        if (from > to) errors.to = 'Deve ser igual ou posterior à data inicial';
        else if (daysBetween(from, to) + 1 > MAX_DAYS) errors.to = 'Escolha um período de até 2 anos';
        else if (from < '2020-01-01') errors.from = 'Data muito antiga';
      }
      if (!showErrors(form, errors)) return;
      state.from = from;
      state.to = to;
      load();
    });

    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return load();
      const btn = e.target.closest('[data-store-id]');
      const row = e.target.closest('[data-store-row]');
      const id = btn?.dataset.storeId || row?.dataset.storeRow;
      if (id && ctx.stores.some((s) => s.id === id)) ctx.setStore(id, '#/dashboard');
    });

    // Novos pedidos e mudanças de status atualizam os números sem recarregar a tela.
    const auto = debounce(() => {
      if (!disposed) load();
    }, 1200);
    ctx.on('new-order', auto);
    ctx.on('order-updated', auto);
    ctx.onCleanup(() => {
      disposed = true;
    });

    drawFilters();
    await load();
  },
};
