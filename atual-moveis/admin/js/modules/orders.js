// Pedidos: lista (status, busca, período, pagamento, loja, paginação, CSV, tempo real)
// e detalhe (ações de status e pagamento, observações, entrega agendada, impressão do romaneio).
//
// Rotas: #/orders  ·  #/orders/<id>
// Parâmetros aceitos na lista (para links de outros módulos):
//   ?status=pending|confirmed|preparing|out_for_delivery|delivered|canceled
//   ?q=<nº do pedido, nome ou telefone>  ?phone=<telefone>  ?customer=<uuid do cliente>
//   ?from=AAAA-MM-DD  ?to=AAAA-MM-DD  ?pay=pending|paid|refunded|failed  ?store=<uuid> (visão da rede)  ?page=N
import { sb, q, rpc, mediaUrl, ApiError } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, money, num, datetime, date, relTime, phone as fmtPhone, cep as fmtCep,
  isoDay, dayStart, dayEnd, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, statusBadge, paymentBadge, badge,
  openModal, confirmDialog, promptDialog, readForm, showErrors, withBusy, loading, empty, errorBlock, pager,
  toCSV, downloadFile, injectStyle, debounce, selectOptions,
} from '../ui.js';

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const LIST_COLS =
  'id,code,number,created_at,customer_name,customer_phone,total,status,payment_method,payment_status,installments,store_id,city,district,distance_km';
const EXPORT_COLS =
  'code,created_at,store_id,status,customer_name,customer_phone,customer_email,cep,street,address_number,complement,district,city,state,distance_km,payment_method,installments,payment_status,subtotal,coupon_code,discount_coupon,discount_pix,delivery_fee,total,scheduled_date,source';

const CHIPS = [
  ['', 'Todos'],
  ['pending', 'Novos'],
  ['confirmed', 'Confirmados'],
  ['preparing', 'Em separação'],
  ['out_for_delivery', 'Em rota'],
  ['delivered', 'Entregues'],
  ['canceled', 'Cancelados'],
];
const STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'canceled'];
const FLOW = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const FLOW_LABEL = { pending: 'Recebido', confirmed: 'Confirmado', preparing: 'Em separação', out_for_delivery: 'Em rota', delivered: 'Entregue' };
const NEXT = {
  pending: { status: 'confirmed', label: 'Confirmar pedido', icon: 'check' },
  confirmed: { status: 'preparing', label: 'Iniciar separação', icon: 'box' },
  preparing: { status: 'out_for_delivery', label: 'Saiu para entrega', icon: 'truck' },
  out_for_delivery: { status: 'delivered', label: 'Marcar como entregue', icon: 'check' },
};
// Mensagens padrão gravadas pelo banco quando não há texto
const DEFAULT_MSG = {
  pending: 'Pedido reaberto',
  confirmed: 'Pedido confirmado pela loja',
  preparing: 'Pedido em separação',
  out_for_delivery: 'Pedido saiu para entrega',
  delivered: 'Pedido entregue',
  canceled: 'Pedido cancelado',
};
const PAY_SHORT = { pending: 'Pendente', paid: 'Pago', refunded: 'Estornado', failed: 'Não aprovado' };
const PAY_ACTIONS = [
  ['paid', 'Marcar como pago', 'check'],
  ['pending', 'Marcar como pendente', 'refresh'],
  ['refunded', 'Marcar como estornado', 'refresh'],
];
const WA_LINES = {
  pending: 'Recebemos o seu pedido e vamos confirmar os detalhes da entrega com você.',
  confirmed: 'Seu pedido foi confirmado e logo entra em separação.',
  preparing: 'Seu pedido está em separação e em breve sai para entrega.',
  out_for_delivery: 'Seu pedido saiu para entrega e deve chegar em breve.',
  delivered: 'Esperamos que esteja tudo certo com a sua compra.',
  canceled: 'Gostaríamos de falar com você sobre o cancelamento do seu pedido.',
};

// Lembra a última lista (com filtros) para o link "voltar" do detalhe
let lastListHash = '#/orders';
let lastListStore;

/* ---------- Utilitários ---------- */
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const km = (v) => (v === null || v === undefined ? '' : `${String(Number(v).toFixed(1)).replace('.', ',')} km`);
const csvNum = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const shortDT = (v) =>
  v
    ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
// Lista: "há 2 h · 10:41" nas últimas 24 h; depois, data e hora
const listWhen = (v) => {
  const t = new Date(v);
  if (Date.now() - t.getTime() > 86400000) return datetime(v);
  const hhmm = t.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${relTime(v)} · ${hhmm}`;
};
const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
const shortBadge = (s) => badge(ORDER_STATUS[s]?.short || s, ORDER_STATUS[s]?.tone);
const payShortBadge = (s) => badge(PAY_SHORT[s] || s, PAYMENT_STATUS[s]?.tone);
const dateBR = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '');

function maskCpf(v) {
  const d = digitsOf(v);
  if (!d) return '';
  if (d.length !== 11) return `${'*'.repeat(Math.max(0, d.length - 3))}${d.slice(-3)}`;
  return `***.***.**${d[8]}-${d.slice(9)}`;
}

function installmentsText(o) {
  const n = Number(o.installments) || 1;
  if (n > 1) return `em ${n}x de ${money(Number(o.total) / n)}`;
  if (o.payment_method === 'crediario') return 'condições combinadas com a loja';
  return 'à vista';
}

function storeOf(ctx, id) {
  return ctx.stores.find((s) => s.id === id) || null;
}

function storeAddress(s) {
  if (!s) return '';
  const line1 = [s.street, s.number].filter(Boolean).join(', ');
  return [line1, s.district, s.city && `${s.city}/${s.state || 'MG'}`, s.cep && `CEP ${fmtCep(s.cep)}`].filter(Boolean).join(' · ');
}

// Igual ao withBusy, mas com outro texto (ex.: "Gerando…")
async function busy(btn, label, task) {
  if (!btn) return task();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> ${label}`;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = old;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/* ---------- Filtros da lista ---------- */
function readFilters(ctx) {
  const qy = ctx.query || {};
  return {
    status: ORDER_STATUS[qy.status] ? qy.status : '',
    q: String(qy.q || qy.phone || '').slice(0, 80),
    from: YMD_RE.test(qy.from || '') ? qy.from : '',
    to: YMD_RE.test(qy.to || '') ? qy.to : '',
    pay: PAYMENT_STATUS[qy.pay || qy.payment] ? qy.pay || qy.payment : '',
    store: !ctx.storeId && ctx.stores.some((s) => s.id === qy.store) ? qy.store : '',
    customer: UUID_RE.test(qy.customer || '') ? qy.customer : '',
    page: Math.max(1, parseInt(qy.page, 10) || 1),
  };
}

// Busca: nº/código (dígitos), telefone (dígitos), nome do cliente (texto) e e-mail
function searchFilter(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const digits = digitsOf(t);
  const compact = t.replace(/\s+/g, '');
  const isCode = /^(at)?\d+$/i.test(compact);
  const words = t.replace(/[,()"\\*%]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [];
  if (digits) {
    parts.push(`code.ilike.*${digits}*`);
    if (digits.length >= 4) parts.push(`customer_phone.ilike.*${digits}*`);
  }
  if (!isCode && words) {
    parts.push(`customer_name.ilike."*${words}*"`);
    if (words.includes('@')) parts.push(`customer_email.ilike."*${words}*"`);
  }
  return parts.join(',');
}

function applyFilters(qy, f, ctx, { withStatus = true } = {}) {
  const storeId = ctx.storeId || f.store;
  if (storeId) qy = qy.eq('store_id', storeId);
  if (withStatus && f.status) qy = qy.eq('status', f.status);
  if (f.pay) qy = qy.eq('payment_status', f.pay);
  if (f.customer) qy = qy.eq('customer_id', f.customer);
  if (f.from) qy = qy.gte('created_at', dayStart(f.from));
  if (f.to) qy = qy.lt('created_at', dayEnd(f.to));
  const or = searchFilter(f.q);
  if (or) qy = qy.or(or);
  return qy;
}

const hasFilters = (f) => !!(f.q || f.from || f.to || f.pay || f.store || f.customer);

/* =========================================================
   LISTA
   ========================================================= */
async function renderList(view, ctx) {
  const f = readFilters(ctx);
  if (lastListStore !== undefined && lastListStore !== ctx.storeId) f.page = 1;
  lastListStore = ctx.storeId;
  const network = !ctx.storeId;
  const fresh = new Set();
  let counts = {};
  let token = 0;
  let timer = null;
  let firstLoad = true;
  let lastRows = [];

  ctx.setActions(
    html`<button class="btn" type="button" data-export aria-label="Exportar pedidos em CSV" title="Exportar os pedidos do filtro atual (até ${num(EXPORT_LIMIT)})">
      ${icon('download')}<span class="orders-hide-sm">Exportar CSV</span>
    </button>`
  );

  render(
    view,
    html`<div class="orders-list">
      <div class="chips orders-chips" data-chips role="group" aria-label="Filtrar por status"></div>
      <form class="orders-filters" data-filters role="search" novalidate>
        <div class="search orders-filters__search">
          ${icon('search')}
          <label class="visually-hidden" for="of-q">Buscar pedidos</label>
          <input class="input" id="of-q" name="q" type="search" value="${f.q}" placeholder="Nº do pedido, nome ou telefone" autocomplete="off" enterkeyhint="search">
        </div>
        <div class="orders-filters__period">
          <div class="orders-filters__field"><label for="of-from">De</label><input class="input" id="of-from" name="from" type="date" value="${f.from}"></div>
          <div class="orders-filters__field"><label for="of-to">até</label><input class="input" id="of-to" name="to" type="date" value="${f.to}"></div>
        </div>
        <div class="orders-filters__field">
          <label class="visually-hidden" for="of-pay">Status do pagamento</label>
          <select class="select" id="of-pay" name="pay">${selectOptions([['', 'Pagamento: todos'], ...Object.entries(PAYMENT_STATUS).map(([k, v]) => [k, v.label])], f.pay)}</select>
        </div>
        ${network
          ? html`<div class="orders-filters__field orders-filters__store">
              <label class="visually-hidden" for="of-store">Loja</label>
              <select class="select" id="of-store" name="store">${selectOptions([['', 'Todas as lojas'], ...ctx.stores.map((s) => [s.id, s.name])], f.store)}</select>
            </div>`
          : ''}
        <button class="btn btn--ghost btn--sm" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
      </form>
      <div data-customer-filter></div>
      <div class="orders-results" data-results aria-live="polite">${loading('Carregando pedidos…')}</div>
    </div>`
  );

  const results = $('[data-results]', view);
  const form = $('[data-filters]', view);

  const drawChips = () =>
    render(
      $('[data-chips]', view),
      CHIPS.map(
        ([s, label]) => html`<button class="chip ${f.status === s ? 'is-active' : ''}" type="button" data-status="${s}" aria-pressed="${f.status === s ? 'true' : 'false'}">
          ${label}<span class="chip__count">${counts[s] === undefined ? '…' : num(counts[s])}</span>
        </button>`
      )
    );

  const drawExtras = () => {
    $('[data-clear]', view).hidden = !hasFilters(f);
    render(
      $('[data-customer-filter]', view),
      f.customer
        ? html`<div class="alert alert--info orders-custfilter">${icon('customers')}<div class="grow">Mostrando os pedidos de um cliente${lastRows[0] ? html`: <strong>${lastRows[0].customer_name}</strong>` : ''}.</div>
            <button class="btn btn--sm" type="button" data-clear-customer>Ver todos</button></div>`
        : ''
    );
  };

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (f.status) p.set('status', f.status);
    if (f.q) p.set('q', f.q);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.pay) p.set('pay', f.pay);
    if (f.store) p.set('store', f.store);
    if (f.customer) p.set('customer', f.customer);
    if (f.page > 1) p.set('page', String(f.page));
    const qs = p.toString();
    const hash = `#/orders${qs ? `?${qs}` : ''}`;
    lastListHash = hash;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  };

  const countFor = async (status) => {
    let qy = applyFilters(sb.from('orders').select('id', { count: 'exact', head: true }), f, ctx, { withStatus: false });
    if (status) qy = qy.eq('status', status);
    const { count, error } = await qy;
    if (error) throw new ApiError(error);
    return count || 0;
  };

  const fetchPage = async () => {
    const from = (f.page - 1) * PAGE_SIZE;
    const qy = applyFilters(sb.from('orders').select(LIST_COLS, { count: 'exact' }), f, ctx)
      .order('created_at', { ascending: false })
      .order('number', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    const { data, count, error } = await qy;
    if (error) {
      if (error.code === 'PGRST103' && f.page > 1) return { outOfRange: true };
      throw new ApiError(error);
    }
    return { rows: data || [], total: count || 0 };
  };

  const drawRows = (rows, total) => {
    lastRows = rows;
    if (!rows.length) {
      const filtered = hasFilters(f) || f.status;
      render(
        results,
        html`<div class="table-wrap">${empty(
          filtered ? 'Nenhum pedido encontrado' : 'Nenhum pedido ainda',
          filtered ? 'Ajuste a busca, o período ou os filtros.' : 'Os pedidos feitos na loja virtual aparecem aqui na hora.',
          hasFilters(f) ? html`<button class="btn btn--sm" type="button" data-clear>Limpar filtros</button>` : ''
        )}</div>`
      );
      return;
    }
    render(
      results,
      html`<div class="table-wrap"><table class="table orders-table">
        <thead><tr>
          <th scope="col">Pedido</th>
          <th scope="col">Cliente</th>
          ${network ? html`<th scope="col">Loja</th>` : ''}
          <th scope="col">Status</th>
          <th scope="col">Pagamento</th>
          <th scope="col">Entrega</th>
          <th scope="col" class="num">Total</th>
        </tr></thead>
        <tbody>${rows.map(
          (r) => html`<tr class="is-clickable ${fresh.has(r.id) ? 'is-new' : ''}" data-id="${r.id}">
            <td class="c-order"><a class="orders-code" href="#/orders/${r.id}">${r.code}</a>
              <div class="muted small nowrap" title="${datetime(r.created_at)}">${listWhen(r.created_at)}</div></td>
            <td class="c-cust"><div class="orders-name ellipsis" title="${r.customer_name}">${r.customer_name}</div><div class="muted small nowrap">${fmtPhone(r.customer_phone)}</div></td>
            ${network ? html`<td class="small orders-store c-store">${ctx.storeName(r.store_id)}</td>` : ''}
            <td class="c-status">${shortBadge(r.status)}</td>
            <td class="c-pay"><div class="small nowrap">${PAYMENT_METHOD[r.payment_method] || r.payment_method}${Number(r.installments) > 1 ? ` · ${r.installments}x` : ''}</div>${payShortBadge(r.payment_status)}</td>
            <td class="c-place"><div class="small orders-place">${[r.district, r.city].filter(Boolean).join(' · ') || '—'}</div><div class="muted small">${km(r.distance_km)}</div></td>
            <td class="num c-total"><strong>${money(r.total)}</strong></td>
          </tr>`
        )}</tbody>
      </table></div>
      ${pager({ page: f.page, pageSize: PAGE_SIZE, total })}`
    );
  };

  async function load() {
    const my = ++token;
    syncUrl();
    drawExtras();
    if (!firstLoad) results.classList.add('is-busy');
    const countsP = Promise.allSettled(CHIPS.map(([s]) => countFor(s)));
    try {
      const page = await fetchPage();
      if (my !== token) return;
      if (page.outOfRange) {
        f.page = 1;
        load();
        return;
      }
      drawRows(page.rows, page.total);
      drawExtras();
    } catch (e) {
      if (my !== token) return;
      render(results, html`${errorBlock(e)}<div class="mt-3"><button class="btn" type="button" data-retry>${icon('refresh')} Tentar de novo</button></div>`);
    } finally {
      if (my === token) {
        results.classList.remove('is-busy');
        firstLoad = false;
      }
    }
    const settled = await countsP;
    if (my !== token) return;
    counts = {};
    CHIPS.forEach(([s], i) => {
      if (settled[i].status === 'fulfilled') counts[s] = settled[i].value;
    });
    drawChips();
  }

  const reloadSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 450);
  };
  ctx.onCleanup(() => clearTimeout(timer));

  // Tempo real: pedido novo → recarrega e destaca a linha; alteração → recarrega
  ctx.on('new-order', (o) => {
    if (f.store && o.store_id !== f.store) return;
    fresh.add(o.id);
    setTimeout(() => fresh.delete(o.id), 8000);
    reloadSoon();
  });
  ctx.on('order-updated', (o) => {
    if (ctx.storeId && o.store_id !== ctx.storeId) return;
    reloadSoon();
  });

  /* ---------- Eventos ---------- */
  view.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (chip) {
      f.status = chip.dataset.status;
      f.page = 1;
      drawChips();
      load();
      return;
    }
    const pg = e.target.closest('[data-page]');
    if (pg) {
      f.page = Math.max(1, Number(pg.dataset.page) || 1);
      load().then(() => view.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      return;
    }
    if (e.target.closest('[data-clear]')) {
      Object.assign(f, { q: '', from: '', to: '', pay: '', store: '', customer: '', page: 1 });
      form.reset();
      $$('input, select', form).forEach((el) => (el.value = ''));
      load();
      return;
    }
    if (e.target.closest('[data-clear-customer]')) {
      f.customer = '';
      f.page = 1;
      load();
      return;
    }
    if (e.target.closest('[data-retry]')) {
      load();
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('a, button')) {
      if (e.ctrlKey || e.metaKey) window.open(`#/orders/${tr.dataset.id}`, '_blank');
      else ctx.navigate(`#/orders/${tr.dataset.id}`);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    f.q = form.q.value.trim();
    f.page = 1;
    load();
  });
  const onSearch = debounce(() => {
    const v = form.q.value.trim();
    if (v === f.q) return;
    f.q = v;
    f.page = 1;
    load();
  }, 350);
  form.q.addEventListener('input', onSearch);
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.name || el.name === 'q') return;
    if ((el.name === 'from' || el.name === 'to') && el.value && !YMD_RE.test(el.value)) return;
    f[el.name] = el.value;
    if (f.from && f.to && f.from > f.to) {
      // período invertido: troca as datas
      [f.from, f.to] = [f.to, f.from];
      form.from.value = f.from;
      form.to.value = f.to;
    }
    f.page = 1;
    load();
  });

  // Exportação CSV do filtro atual
  $('[data-actions] [data-export]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await busy(btn, 'Gerando…', async () => {
        const qy = applyFilters(sb.from('orders').select(EXPORT_COLS, { count: 'exact' }), f, ctx)
          .order('created_at', { ascending: false })
          .order('number', { ascending: false })
          .range(0, EXPORT_LIMIT - 1);
        const { data, count, error } = await qy;
        if (error) throw new ApiError(error);
        if (!data?.length) {
          toast('Nenhum pedido para exportar com estes filtros.', 'warning');
          return;
        }
        const csv = toCSV(data, [
          { label: 'Pedido', key: 'code' },
          { label: 'Data', value: (r) => datetime(r.created_at) },
          { label: 'Loja', value: (r) => ctx.storeName(r.store_id) },
          { label: 'Status', value: (r) => ORDER_STATUS[r.status]?.label || r.status },
          { label: 'Cliente', key: 'customer_name' },
          { label: 'Telefone', value: (r) => fmtPhone(r.customer_phone) },
          { label: 'E-mail', key: 'customer_email' },
          { label: 'CEP', value: (r) => fmtCep(r.cep) },
          { label: 'Endereço', value: (r) => [r.street, r.address_number, r.complement].filter(Boolean).join(', ') },
          { label: 'Bairro', key: 'district' },
          { label: 'Cidade', key: 'city' },
          { label: 'UF', key: 'state' },
          { label: 'Distância (km)', value: (r) => csvNum(r.distance_km) },
          { label: 'Forma de pagamento', value: (r) => PAYMENT_METHOD[r.payment_method] || r.payment_method },
          { label: 'Parcelas', key: 'installments' },
          { label: 'Pagamento', value: (r) => PAY_SHORT[r.payment_status] || r.payment_status },
          { label: 'Subtotal', value: (r) => csvNum(r.subtotal) },
          { label: 'Cupom', key: 'coupon_code' },
          { label: 'Desconto cupom', value: (r) => csvNum(r.discount_coupon) },
          { label: 'Desconto PIX', value: (r) => csvNum(r.discount_pix) },
          { label: 'Frete', value: (r) => csvNum(r.delivery_fee) },
          { label: 'Total', value: (r) => csvNum(r.total) },
          { label: 'Entrega agendada', value: (r) => dateBR(r.scheduled_date) },
          { label: 'Origem', value: (r) => (r.source === 'demo' ? 'Demonstração' : r.source === 'site' ? 'Site' : r.source) },
        ]);
        const slug = ctx.store?.slug || (f.store ? storeOf(ctx, f.store)?.slug : 'rede') || 'rede';
        downloadFile(`pedidos-${slug}-${isoDay(new Date())}.csv`, csv);
        if (count > data.length) toast(`Exportados os ${num(data.length)} pedidos mais recentes de ${num(count)}. Reduza o período para exportar o restante.`, 'warning', 7000);
        else toast(`${num(data.length)} pedido${data.length === 1 ? '' : 's'} exportado${data.length === 1 ? '' : 's'}.`, 'success');
      });
    } catch (err) {
      toastError(err);
    }
  });

  drawChips();
  await load();
}

/* =========================================================
   DETALHE
   ========================================================= */
async function fetchOrder(id) {
  const [order, items, events] = await Promise.all([
    q(sb.from('orders').select('*').eq('id', id).maybeSingle()),
    q(sb.from('order_items').select('*').eq('order_id', id)),
    q(sb.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).order('id', { ascending: false })),
  ]);
  return { order, items: items || [], events: events || [] };
}

function backLink() {
  return html`<a class="orders-back no-print" href="${lastListHash}">${icon('chevronLeft', 'icon-sm')} Pedidos</a>`;
}

function notFound(view, ctx) {
  ctx.setTitle('Pedido não encontrado');
  render(
    view,
    html`${backLink()}<div class="card">${empty('Pedido não encontrado', 'Ele pode ter sido excluído ou pertence a uma loja à qual você não tem acesso.', html`<a class="btn btn--sm" href="${lastListHash}">Voltar para os pedidos</a>`)}</div>`
  );
}

function stepper(o, events) {
  if (o.status === 'canceled') return '';
  const idx = FLOW.indexOf(o.status);
  const when = (s) => (s === 'pending' ? o.created_at : events.find((e) => e.type === 'status' && e.status === s)?.created_at);
  return html`<ol class="orders-steps" aria-label="Andamento do pedido">${FLOW.map((s, i) => {
    const done = i < idx || (i === idx && s === 'delivered');
    const t = i <= idx ? when(s) : null;
    return html`<li class="orders-steps__item ${done ? 'is-done' : ''} ${i === idx && !done ? 'is-current' : ''} ${i <= idx ? 'is-reached' : ''}" ${i === idx ? 'aria-current="step"' : ''}>
      <span class="orders-steps__dot">${done ? icon('check', 'icon-sm') : ''}</span>
      <span class="orders-steps__label">${FLOW_LABEL[s]}</span>
      <span class="orders-steps__time">${t ? shortDT(t) : ''}</span>
    </li>`;
  })}</ol>`;
}

function headCard(o, ctx, items, events, perms) {
  const next = NEXT[o.status];
  const locked = ['delivered', 'canceled'].includes(o.status) && !perms.reopen;
  const qty = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  const showStore = !ctx.storeId || ctx.storeId !== o.store_id;
  return html`<section class="card orders-head">
    <div class="card__body orders-head__body">
      <div class="orders-head__info">
        <div class="row" style="--gap:8px">
          <h2 class="orders-head__code">${o.code}</h2>
          ${statusBadge(o.status)} ${paymentBadge(o.payment_status)}
          ${o.source === 'demo' ? badge('Demonstração', 'plain') : ''}
        </div>
        <p class="muted small mt-1">
          Feito em ${datetime(o.created_at)} (${relTime(o.created_at)})
          ${showStore ? html` · <strong class="orders-head__store">${ctx.storeName(o.store_id)}</strong>` : ''}
          · ${num(qty)} ${qty === 1 ? 'item' : 'itens'} · ${money(o.total)}
        </p>
      </div>
      ${perms.orders
        ? html`<div class="orders-head__actions">
            ${next ? html`<button class="btn btn--primary" type="button" data-next="${next.status}">${icon(next.icon)} ${next.label}</button>` : ''}
            <div class="orders-dd">
              <button class="btn" type="button" data-menu="orders-status-menu" aria-haspopup="true" aria-controls="orders-status-menu">Alterar status ${icon('chevronDown', 'icon-sm')}</button>
              <div class="menu orders-menu" id="orders-status-menu" hidden>
                ${locked ? html`<p class="orders-menu__note">${icon('alert', 'icon-sm')} Somente o administrador da loja reabre pedidos entregues ou cancelados.</p>` : ''}
                ${STATUSES.filter((s) => s !== o.status).map(
                  (s) => html`<button type="button" data-set-status="${s}" class="${s === 'canceled' ? 'is-danger' : ''}" ${locked ? 'disabled' : ''}>
                    <span class="orders-menu__dot orders-tone--${ORDER_STATUS[s].tone}"></span>${s === 'pending' && ['delivered', 'canceled'].includes(o.status) ? 'Reabrir como novo' : ORDER_STATUS[s].label}
                  </button>`
                )}
              </div>
            </div>
            ${o.status !== 'canceled'
              ? html`<button class="btn btn--danger" type="button" data-cancel ${locked ? 'disabled title="Somente o administrador da loja cancela pedidos entregues"' : ''}>${icon('close', 'icon-sm')} Cancelar pedido</button>`
              : ''}
            <button class="btn" type="button" data-print>${icon('print')} Imprimir</button>
          </div>`
        : html`<div class="orders-head__actions"><button class="btn" type="button" data-print>${icon('print')} Imprimir</button></div>`}
    </div>
    ${stepper(o, events)}
  </section>`;
}

function itemsCard(o, items) {
  const qty = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  return html`<section class="card orders-c-items">
    <div class="card__head"><h3 class="h2">Itens <span class="muted">(${num(qty)})</span></h3></div>
    ${items.length
      ? html`<div class="table-wrap orders-items"><table class="table">
          <thead><tr><th scope="col">Produto</th><th scope="col">Variação</th><th scope="col" class="num">Qtd</th><th scope="col" class="num">Unitário</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody>${items.map(
            (i) => html`<tr>
              <td class="c-prod"><div class="orders-prod">
                ${i.image_url ? html`<img class="thumb" src="${mediaUrl(i.image_url)}" alt="" loading="lazy" width="48" height="48">` : html`<span class="thumb orders-thumb-empty">${icon('image')}</span>`}
                <div class="orders-prod__name"><strong>${i.name}</strong>${i.sku ? html`<div class="muted small">SKU ${i.sku}</div>` : ''}${i.product_id ? '' : html`<div class="faint small">Produto removido do catálogo</div>`}
                  <div class="orders-item-meta small">${i.variant_name ? `${i.variant_name} · ` : ''}${num(i.quantity)} × ${money(i.unit_price)}</div></div>
              </div></td>
              <td class="small c-var">${i.variant_name || '—'}</td>
              <td class="num c-qty">${num(i.quantity)}</td>
              <td class="num c-unit">${money(i.unit_price)}</td>
              <td class="num c-total"><strong>${money(i.total)}</strong></td>
            </tr>`
          )}</tbody>
        </table></div>`
      : html`<div class="card__body muted">Sem itens registrados.</div>`}
    <div class="card__body orders-sum">
      <dl class="orders-totals">
        <div><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd></div>
        ${Number(o.discount_coupon) > 0 || o.coupon_code
          ? html`<div class="is-discount"><dt>Cupom ${o.coupon_code ? html`<span class="orders-coupon">${o.coupon_code}</span>` : ''}</dt><dd>− ${money(o.discount_coupon)}</dd></div>`
          : ''}
        ${Number(o.discount_pix) > 0 ? html`<div class="is-discount"><dt>Desconto PIX</dt><dd>− ${money(o.discount_pix)}</dd></div>` : ''}
        <div><dt>Frete</dt><dd>${Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'Grátis'}</dd></div>
        <div class="is-total"><dt>Total</dt><dd>${money(o.total)}</dd></div>
      </dl>
      <p class="orders-paywith small"><span class="muted">Forma de pagamento:</span> <strong>${PAYMENT_METHOD[o.payment_method] || o.payment_method}</strong> · ${installmentsText(o)}</p>
    </div>
  </section>`;
}

function eventTitle(e) {
  if (e.type === 'created') return 'Pedido recebido';
  if (e.type === 'status') return ORDER_STATUS[e.status]?.label || 'Status alterado';
  if (e.type === 'payment') return 'Pagamento';
  if (e.type === 'note') return 'Observação';
  return 'Alteração';
}

function historyCard(o, events, perms) {
  return html`<section class="card orders-c-history">
    <div class="card__head"><h3 class="h2">Histórico</h3><span class="muted small">${num(events.length)} ${events.length === 1 ? 'registro' : 'registros'}</span></div>
    <div class="card__body">
      ${perms.orders
        ? html`<form class="orders-note" data-note-form novalidate>
            <div class="field">
              <label for="on-msg">Nova observação</label>
              <textarea class="textarea" id="on-msg" name="message" rows="2" maxlength="2000" placeholder="Ex.: cliente pediu entrega depois das 14h" data-keep></textarea>
            </div>
            <div class="row row--between mt-2">
              <label class="check small"><input type="checkbox" id="on-visible" name="visible" data-keep> Visível para o cliente</label>
              <button class="btn" type="submit">${icon('plus', 'icon-sm')} Adicionar observação</button>
            </div>
          </form>`
        : ''}
      ${events.length
        ? html`<ol class="timeline orders-timeline">${events.map((e) => {
            const cls = e.type === 'payment' ? 'is-payment' : e.type === 'status' || e.type === 'created' ? 'is-status' : 'is-note';
            const title = eventTitle(e);
            return html`<li class="timeline__item ${cls} ${e.status === 'canceled' ? 'is-cancel' : ''}">
              <div class="orders-tl-head">
                <strong>${title}</strong>
                ${!e.visible_to_customer ? badge('Interna', 'plain') : e.type === 'note' ? badge('Visível ao cliente', 'info') : ''}
              </div>
              ${e.message && e.message !== title ? html`<p class="orders-tl-msg">${e.message}</p>` : ''}
              <div class="muted small">${e.actor_name || (e.type === 'created' ? 'Cliente (site)' : 'Sistema')} · ${datetime(e.created_at)}</div>
            </li>`;
          })}</ol>`
        : html`<p class="muted mt-3">Nenhum registro ainda.</p>`}
    </div>
  </section>`;
}

function customerCard(o, ctx, store) {
  const d = digitsOf(o.customer_phone);
  const first = String(o.customer_name || '').trim().split(/\s+/)[0] || '';
  const track = `${location.origin}/pedido/${o.tracking_token}`;
  const msg = `Olá, ${first}! Aqui é da ${store?.name || ctx.storeName(o.store_id)}. Sobre o seu pedido ${o.code}: ${WA_LINES[o.status] || ''}\nAcompanhe por aqui: ${track}\nQualquer dúvida, é só responder esta mensagem.`;
  const wa = d.length >= 10 ? `https://wa.me/55${d}?text=${encodeURIComponent(msg)}` : '';
  const others = o.customer_id ? `#/orders?customer=${o.customer_id}` : `#/orders?q=${d}`;
  return html`<section class="card orders-c-customer">
    <div class="card__head"><h3 class="h2">Cliente</h3></div>
    <div class="card__body stack" style="--gap:12px">
      <div class="orders-cust">${o.customer_name}</div>
      <dl class="orders-kv">
        <div><dt>Telefone</dt><dd>${d ? html`<a href="tel:+55${d}">${fmtPhone(o.customer_phone)}</a>` : '—'}</dd></div>
        <div><dt>E-mail</dt><dd>${o.customer_email ? html`<a href="mailto:${o.customer_email}">${o.customer_email}</a>` : html`<span class="faint">Não informado</span>`}</dd></div>
        <div><dt>CPF</dt><dd>${o.customer_cpf ? html`<span class="mono">${maskCpf(o.customer_cpf)}</span>` : html`<span class="faint">Não informado</span>`}</dd></div>
      </dl>
      <div class="orders-btns">
        ${wa ? html`<a class="btn btn--sm orders-wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 'icon-sm')} WhatsApp</a>` : ''}
        <button class="btn btn--sm" type="button" data-copy="${track}">${icon('copy', 'icon-sm')} Link de acompanhamento</button>
        <a class="btn btn--sm" href="${others}">${icon('orders', 'icon-sm')} Outros pedidos</a>
      </div>
    </div>
  </section>`;
}

function deliveryCard(o, store, perms) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  const route = store?.lat && store?.lng ? `https://www.google.com/maps/dir/?api=1&origin=${store.lat},${store.lng}&destination=${o.lat},${o.lng}` : '';
  return html`<section class="card orders-c-delivery">
    <div class="card__head"><h3 class="h2">Entrega</h3><span class="badge badge--plain">${km(o.distance_km)} da loja</span></div>
    <div class="card__body stack" style="--gap:14px">
      <address class="orders-address">
        ${o.street}, ${o.address_number}${o.complement ? ` — ${o.complement}` : ''}<br>
        ${o.district ? html`${o.district} · ` : ''}${o.city}/${o.state}<br>
        <span class="muted">CEP ${fmtCep(o.cep)}</span>
      </address>
      ${o.reference ? html`<div><div class="label">Ponto de referência</div><p class="orders-pre">${o.reference}</p></div>` : ''}
      <div class="orders-btns">
        <a class="btn btn--sm" href="${maps}" target="_blank" rel="noopener">${icon('map', 'icon-sm')} Ver no mapa</a>
        ${route ? html`<a class="btn btn--sm" href="${route}" target="_blank" rel="noopener">${icon('truck', 'icon-sm')} Rota a partir da loja</a>` : ''}
      </div>
      <form class="stack orders-delivery" style="--gap:12px" data-delivery-form novalidate>
        <div class="field">
          <label for="od-date">Data de entrega agendada</label>
          <input class="input" type="date" id="od-date" name="scheduled_date" value="${o.scheduled_date || ''}" data-keep ${perms.orders ? '' : 'disabled'}>
          <span class="hint">O cliente vê esta data no acompanhamento do pedido.</span>
        </div>
        <div class="field">
          <label for="od-notes">Observações internas</label>
          <textarea class="textarea" id="od-notes" name="internal_notes" rows="3" maxlength="2000" placeholder="Ex.: montar no local, subir 2 andares" data-keep ${perms.orders ? '' : 'disabled'}>${o.internal_notes || ''}</textarea>
          <span class="hint">Só a equipe vê.</span>
        </div>
        ${perms.orders ? html`<div><button class="btn btn--primary btn--sm" type="submit">Salvar entrega</button></div>` : ''}
      </form>
    </div>
  </section>`;
}

function paymentCard(o, perms) {
  return html`<section class="card orders-c-payment">
    <div class="card__head"><h3 class="h2">Pagamento</h3>${paymentBadge(o.payment_status)}</div>
    <div class="card__body stack" style="--gap:12px">
      <div><strong>${PAYMENT_METHOD[o.payment_method] || o.payment_method}</strong><div class="muted small">${money(o.total)} ${installmentsText(o)}</div></div>
      ${perms.orders
        ? html`<div class="orders-btns">${PAY_ACTIONS.filter(([s]) => s !== o.payment_status).map(
            ([s, label, ic]) => html`<button class="btn btn--sm ${s === 'paid' ? 'btn--primary' : ''}" type="button" data-pay="${s}">${icon(ic, 'icon-sm')} ${label}</button>`
          )}</div>`
        : ''}
    </div>
  </section>`;
}

function printSheet(o, items, store, ctx) {
  const qty = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  return html`<div class="orders-print">
    <header class="op-head">
      <div>
        <div class="op-brand">${store?.brand_name || 'Atual Móveis'}</div>
        <div><strong>${store?.name || ctx.storeName(o.store_id)}</strong></div>
        ${store ? html`<div class="op-small">${storeAddress(store)}</div>` : ''}
        ${store?.phone || store?.whatsapp ? html`<div class="op-small">${[store.phone, store.whatsapp && `WhatsApp ${fmtPhone(store.whatsapp)}`].filter(Boolean).join(' · ')}</div>` : ''}
      </div>
      <div class="op-right">
        <div class="op-title">Pedido ${o.code}</div>
        <div>Romaneio de entrega</div>
        <div class="op-small">Feito em ${datetime(o.created_at)}</div>
        <div class="op-small">Impresso em <span data-printed-at>${datetime(new Date())}</span></div>
      </div>
    </header>
    <section class="op-grid">
      <div class="op-box">
        <h3>Cliente</h3>
        <p><strong>${o.customer_name}</strong></p>
        <p>Tel.: ${fmtPhone(o.customer_phone)}</p>
        ${o.customer_email ? html`<p>${o.customer_email}</p>` : ''}
        ${o.customer_cpf ? html`<p>CPF: ${maskCpf(o.customer_cpf)}</p>` : ''}
      </div>
      <div class="op-box">
        <h3>Endereço de entrega</h3>
        <p>${o.street}, ${o.address_number}${o.complement ? ` — ${o.complement}` : ''}</p>
        <p>${o.district ? `${o.district} · ` : ''}${o.city}/${o.state} · CEP ${fmtCep(o.cep)}</p>
        ${o.reference ? html`<p>Ref.: ${o.reference}</p>` : ''}
        <p>Distância da loja: ${km(o.distance_km)}</p>
      </div>
      <div class="op-box">
        <h3>Entrega e pagamento</h3>
        <p>Status: ${ORDER_STATUS[o.status]?.label || o.status}</p>
        <p>Entrega agendada: <strong>${o.scheduled_date ? date(`${o.scheduled_date}T12:00:00-03:00`) : 'a combinar'}</strong></p>
        <p>${PAYMENT_METHOD[o.payment_method] || o.payment_method} · ${installmentsText(o)}</p>
        <p>Pagamento: ${PAY_SHORT[o.payment_status] || o.payment_status}</p>
      </div>
    </section>
    <table class="op-table">
      <thead><tr><th class="op-c">Conf.</th><th class="num">Qtd</th><th>Produto</th><th>Variação</th><th class="num">Unitário</th><th class="num">Total</th></tr></thead>
      <tbody>${items.map(
        (i) => html`<tr><td class="op-c"><span class="op-check"></span></td><td class="num">${num(i.quantity)}</td><td>${i.name}${i.sku ? html`<br><span class="op-small">SKU ${i.sku}</span>` : ''}</td><td>${i.variant_name || '—'}</td><td class="num">${money(i.unit_price)}</td><td class="num">${money(i.total)}</td></tr>`
      )}</tbody>
      <tfoot><tr><td></td><td class="num"><strong>${num(qty)}</strong></td><td colspan="4">${qty === 1 ? 'volume' : 'volumes'}</td></tr></tfoot>
    </table>
    <div class="op-totals">
      <div><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
      ${Number(o.discount_coupon) > 0 ? html`<div><span>Cupom ${o.coupon_code || ''}</span><span>− ${money(o.discount_coupon)}</span></div>` : ''}
      ${Number(o.discount_pix) > 0 ? html`<div><span>Desconto PIX</span><span>− ${money(o.discount_pix)}</span></div>` : ''}
      <div><span>Frete</span><span>${Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'Grátis'}</span></div>
      <div class="op-total"><span>Total</span><span>${money(o.total)}</span></div>
    </div>
    ${o.customer_notes ? html`<div class="op-notes"><h3>Observação do cliente</h3>${o.customer_notes}</div>` : ''}
    ${o.internal_notes ? html`<div class="op-notes"><h3>Observações internas</h3>${o.internal_notes}</div>` : ''}
    <div class="op-sign">
      <div>Recebido por (nome legível)</div>
      <div>Documento</div>
      <div>Assinatura</div>
      <div>Data: ____/____/________</div>
    </div>
    <p class="op-foot">Confira os produtos no ato da entrega. Declaro que recebi os itens acima em perfeito estado.</p>
  </div>`;
}

async function renderDetail(view, ctx, id) {
  if (!UUID_RE.test(id)) return notFound(view, ctx);
  let state = null;
  let timer = null;
  let ownUntil = 0; // ignora o aviso de "atualizado" logo após ações desta tela
  let acting = 0; // ações desta tela em andamento (o tempo real espera para não redesenhar no meio)
  const act = async (task) => {
    acting += 1;
    ownUntil = Date.now() + 5000;
    try {
      return await task();
    } finally {
      acting -= 1;
      ownUntil = Date.now() + 5000;
    }
  };

  render(view, html`${backLink()}${loading('Carregando pedido…')}`);
  try {
    state = await fetchOrder(id);
  } catch (e) {
    render(view, html`${backLink()}${errorBlock(e)}<div class="mt-3"><button class="btn" type="button" data-reload-page>${icon('refresh')} Tentar de novo</button></div>`);
    view.addEventListener('click', (ev) => ev.target.closest('[data-reload-page]') && ctx.navigate(`#/orders/${id}`));
    return;
  }
  if (!state.order) return notFound(view, ctx);

  const perms = () => ({
    orders: ctx.can('orders', state.order.store_id),
    reopen: ctx.can('settings', state.order.store_id),
  });

  function draw() {
    const { order: o, items, events } = state;
    const store = storeOf(ctx, o.store_id);
    const p = perms();
    // preserva o que a pessoa estava digitando
    const kept = {};
    $$('[data-keep]', view).forEach((el) => {
      const dirty = el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue;
      if (dirty) kept[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const focusId = view.contains(document.activeElement) ? document.activeElement.id : '';
    ctx.setTitle(`Pedido ${o.code}`, ctx.storeName(o.store_id));
    render(
      view,
      html`<div class="orders-detail">
        <div class="orders-screen">
          ${backLink()}
          ${ctx.storeId && ctx.storeId !== o.store_id
            ? html`<div class="alert alert--info mb-3">${icon('store')}<div class="grow">Este pedido é da loja <strong>${ctx.storeName(o.store_id)}</strong>.</div>
                <button class="btn btn--sm" type="button" data-switch-store="${o.store_id}">Trocar para esta loja</button></div>`
            : ''}
          ${headCard(o, ctx, items, events, p)}
          ${o.status === 'canceled'
            ? html`<div class="alert alert--danger mt-3">${icon('alert')}<div class="grow"><strong>Pedido cancelado${o.canceled_at ? ` em ${datetime(o.canceled_at)}` : ''}.</strong>${o.cancel_reason ? html`<br>Motivo: ${o.cancel_reason}` : ''}</div>
                ${p.reopen ? html`<button class="btn btn--sm" type="button" data-set-status="pending">Reabrir pedido</button>` : ''}</div>`
            : ''}
          ${o.customer_notes
            ? html`<div class="alert alert--warning mt-3 orders-custnote">${icon('bell')}<div><strong>Observação do cliente</strong><p class="orders-pre">${o.customer_notes}</p></div></div>`
            : ''}
          <div class="split mt-3 orders-split">
            <div class="stack">
              ${itemsCard(o, items)}
              ${historyCard(o, events, p)}
            </div>
            <div class="stack">
              ${customerCard(o, ctx, store)}
              ${deliveryCard(o, store, p)}
              ${paymentCard(o, p)}
            </div>
          </div>
        </div>
        ${printSheet(o, items, store, ctx)}
      </div>`
    );
    for (const [k, v] of Object.entries(kept)) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  async function reload({ announce = false } = {}) {
    try {
      const next = await fetchOrder(id);
      if (!next.order) return notFound(view, ctx);
      const changed = state.order.status !== next.order.status || state.order.payment_status !== next.order.payment_status;
      state = next;
      draw();
      if (announce && changed && Date.now() > ownUntil) toast(`Pedido ${next.order.code} atualizado: ${ORDER_STATUS[next.order.status]?.label}.`, 'info');
    } catch (e) {
      toastError(e);
    }
  }

  const run = (btn, task, okMessage) =>
    act(async () => {
      try {
        await withBusy(btn, task);
      } catch (e) {
        toastError(e);
        return false;
      }
      if (okMessage) toast(okMessage, 'success');
      await reload();
      return true;
    });

  const setStatus = (status, { message = null, visible = true, btn } = {}) =>
    run(
      btn,
      () => rpc('update_order_status', { p_order: id, p_status: status, p_message: message || null, p_visible: visible }),
      `Pedido ${state.order.code}: ${ORDER_STATUS[status].label.toLowerCase()}.`
    );

  async function cancelFlow(btn) {
    const o = state.order;
    const reason = await promptDialog({
      title: `Cancelar pedido ${o.code}`,
      label: 'Motivo do cancelamento *',
      required: true,
      multiline: true,
      placeholder: 'Ex.: cliente desistiu da compra',
      confirmLabel: 'Confirmar cancelamento',
      hint: `O cliente vê o motivo no acompanhamento. Os itens voltam ao estoque${o.payment_status === 'paid' ? ' e o pagamento passa para estornado' : ''}.`,
    });
    if (reason === null) return;
    await setStatus('canceled', { message: reason.trim().slice(0, 500), visible: true, btn });
  }

  function statusDialog(status) {
    const o = state.order;
    const reopening = ['delivered', 'canceled'].includes(o.status);
    openModal({
      title: reopening && status === 'pending' ? `Reabrir pedido ${o.code}` : `Alterar status do pedido ${o.code}`,
      size: 'sm',
      body: html`<form class="stack" data-status-form novalidate>
        <div class="row" style="--gap:8px">${statusBadge(o.status)} ${icon('chevronRight', 'icon-sm')} ${statusBadge(status)}</div>
        ${o.status === 'canceled' ? html`<div class="alert alert--warning small">${icon('alert')}<div>Ao reabrir, os itens voltam a ser descontados do estoque.</div></div>` : ''}
        <div class="field">
          <label for="st-msg">Mensagem (opcional)</label>
          <textarea class="textarea" id="st-msg" name="message" rows="3" maxlength="500" placeholder="${DEFAULT_MSG[status]}"></textarea>
          <span class="hint">Sem texto, registramos “${DEFAULT_MSG[status]}”.</span>
        </div>
        <label class="check"><input type="checkbox" name="visible" checked> Mostrar esta atualização para o cliente</label>
      </form>`,
      actions: html`<button class="btn" type="button" data-close>Voltar</button>
        <button class="btn btn--primary" type="button" data-ok>Alterar status</button>`,
      onMount(el, close) {
        const submit = async () => {
          const f = $('[data-status-form]', el);
          const ok = await setStatus(status, { message: f.message.value.trim(), visible: f.visible.checked, btn: $('[data-ok]', el) });
          if (ok) close();
        };
        $('[data-ok]', el).addEventListener('click', submit);
        $('[data-status-form]', el).addEventListener('submit', (e) => {
          e.preventDefault();
          submit();
        });
      },
    });
  }

  async function onStatusChoice(status, btn) {
    const o = state.order;
    if (status === o.status) return;
    if (['delivered', 'canceled'].includes(o.status) && !perms().reopen) {
      toastError(new Error('Somente o administrador da loja reabre pedidos entregues ou cancelados.'));
      return;
    }
    if (status === 'canceled') return cancelFlow(btn);
    statusDialog(status);
  }

  async function onPayment(status, btn) {
    const o = state.order;
    if (status === 'refunded') {
      const ok = await confirmDialog({
        title: 'Marcar como estornado',
        message: `Confirme que o valor de ${money(o.total)} do pedido ${o.code} foi devolvido ao cliente.`,
        confirmLabel: 'Marcar como estornado',
        danger: true,
      });
      if (!ok) return;
    }
    await run(btn, () => rpc('set_order_payment', { p_order: id, p_payment_status: status }), `Pagamento: ${PAY_SHORT[status].toLowerCase()}.`);
  }

  /* ---------- Eventos ---------- */
  view.addEventListener('click', async (e) => {
    const t = e.target;
    const nextBtn = t.closest('[data-next]');
    if (nextBtn) {
      const status = nextBtn.dataset.next;
      if (status === 'delivered') {
        const ok = await confirmDialog({
          title: 'Marcar como entregue',
          message: `Confirmar a entrega do pedido ${state.order.code}? Depois disso, só o administrador da loja pode reabri-lo.`,
          confirmLabel: 'Marcar como entregue',
        });
        if (!ok) return;
      }
      await setStatus(status, { btn: nextBtn });
      return;
    }
    const st = t.closest('[data-set-status]');
    if (st) return onStatusChoice(st.dataset.setStatus, st);
    const cancel = t.closest('[data-cancel]');
    if (cancel) return cancelFlow(cancel);
    const pay = t.closest('[data-pay]');
    if (pay) return onPayment(pay.dataset.pay, pay);
    if (t.closest('[data-print]')) {
      const stamp = $('[data-printed-at]', view);
      if (stamp) stamp.textContent = datetime(new Date());
      window.print();
      return;
    }
    const copy = t.closest('[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy);
      if (ok) toast('Link de acompanhamento copiado.', 'success');
      else promptDialog({ title: 'Link de acompanhamento', label: 'Copie o link abaixo', value: copy.dataset.copy, confirmLabel: 'Fechar' });
      return;
    }
    const sw = t.closest('[data-switch-store]');
    if (sw) ctx.setStore(sw.dataset.switchStore, `#/orders/${id}`);
  });

  view.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.matches('[data-note-form]')) {
      e.preventDefault();
      const message = form.message.value.trim();
      if (!showErrors(form, message ? {} : { message: 'Escreva a observação.' })) return;
      const visible = form.visible.checked;
      await act(async () => {
        try {
          await withBusy(form.querySelector('[type="submit"]'), () => rpc('add_order_note', { p_order: id, p_message: message, p_visible: visible }));
        } catch (err) {
          toastError(err);
          return;
        }
        $('[data-note-form]', view)?.reset();
        toast(visible ? 'Observação adicionada (visível para o cliente).' : 'Observação interna adicionada.', 'success');
        await reload();
      });
      return;
    }
    if (form.matches('[data-delivery-form]')) {
      e.preventDefault();
      const data = readForm(form);
      const errors = {};
      if (data.scheduled_date && !YMD_RE.test(data.scheduled_date)) errors.scheduled_date = 'Data inválida.';
      else if (data.scheduled_date && data.scheduled_date < isoDay(state.order.created_at)) errors.scheduled_date = 'A entrega não pode ser antes do dia do pedido.';
      if (data.internal_notes && data.internal_notes.length > 2000) errors.internal_notes = 'Use até 2.000 caracteres.';
      if (!showErrors(form, errors)) return;
      await act(async () => {
        try {
          await withBusy(form.querySelector('[type="submit"]'), async () => {
            const rows = await q(
              sb.from('orders').update({ scheduled_date: data.scheduled_date || null, internal_notes: data.internal_notes || null }).eq('id', id).select('id')
            );
            if (!rows?.length) throw new Error('Você não tem permissão para alterar este pedido.');
          });
        } catch (err) {
          toastError(err);
          return;
        }
        // marca o formulário como salvo antes de redesenhar
        $$('[data-keep]', $('[data-delivery-form]', view) || form).forEach((el) => (el.defaultValue = el.value));
        toast('Dados de entrega salvos.', 'success');
        await reload();
      });
    }
  });

  // Tempo real: o mesmo pedido mudou em outro lugar → redesenha
  ctx.on('order-updated', (row) => {
    if (row.id !== id || sameTime(row.updated_at, state.order.updated_at)) return;
    clearTimeout(timer);
    const check = () => {
      if (sameTime(row.updated_at, state.order.updated_at)) return; // a própria tela já recarregou
      if (acting) {
        timer = setTimeout(check, 500); // espera a ação terminar
        return;
      }
      reload({ announce: true });
    };
    timer = setTimeout(check, 300);
  });
  ctx.onCleanup(() => clearTimeout(timer));

  draw();
}

/* =========================================================
   Estilos do módulo
   ========================================================= */
const CSS = `
.orders-chips { margin-bottom: 12px; }
.orders-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 14px; }
.orders-filters .search { flex: 1 1 240px; max-width: 340px; min-width: 200px; }
.orders-filters__period { display: flex; align-items: center; gap: 8px; }
.orders-filters__field { display: flex; align-items: center; gap: 6px; min-width: 0; }
.orders-filters__field > label { font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.orders-filters__field .input[type="date"] { width: 146px; }
.orders-filters__field .select { width: auto; min-width: 150px; }
.orders-filters__store .select { width: 230px; }
.orders-results { transition: opacity .15s; }
.orders-results.is-busy { opacity: .55; pointer-events: none; }
.orders-custfilter { align-items: center; margin-bottom: 12px; }
.orders-table td { vertical-align: top; }
.orders-code { font-weight: 700; color: var(--ink); white-space: nowrap; }
.orders-name { max-width: 220px; font-weight: 600; color: var(--ink); }
.orders-store { min-width: 150px; max-width: 200px; }
.orders-place { min-width: 120px; }
.orders-table td .badge + .badge { margin-left: 4px; }
.orders-table td > div + .badge { margin-top: 3px; }
.orders-table tr.is-new td { animation: orders-flash 6s ease-out; }
@keyframes orders-flash { 0%, 35% { background: #fff1c2; } 100% { background: transparent; } }

.orders-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 12px; font-weight: 600; color: var(--muted); }
.orders-back:hover { color: var(--ink); text-decoration: none; }
.orders-head__body { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px 20px; }
.orders-head__code { font-size: 24px; font-weight: 700; line-height: 1.15; color: var(--ink); letter-spacing: .2px; }
.orders-head__store { color: var(--ink); font-weight: 600; }
.orders-head__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.orders-dd { position: relative; }
.orders-menu { min-width: 240px; }
.orders-menu button:disabled { opacity: .45; cursor: not-allowed; background: none; }
.orders-menu__note { display: flex; gap: 6px; padding: 8px 10px; margin-bottom: 4px; border-radius: 6px; background: var(--warning-soft); color: #6b4000; font-size: 12.5px; }
.orders-menu__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--line-strong); }
.orders-tone--warning { background: var(--warning); }
.orders-tone--info { background: var(--info); }
.orders-tone--accent { background: var(--accent); }
.orders-tone--success { background: var(--success); }
.orders-tone--danger { background: var(--danger); }

.orders-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 14px 10px 16px; border-top: 1px solid var(--line); }
.orders-steps__item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; font-size: 12px; }
.orders-steps__item::before { content: ''; position: absolute; top: 11px; left: calc(-50% + 14px); right: calc(50% + 14px); height: 2px; background: var(--line); }
.orders-steps__item:first-child::before { display: none; }
.orders-steps__item.is-reached::before { background: var(--success); }
.orders-steps__dot { position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 2px solid var(--line-strong); border-radius: 50%; background: #fff; color: #fff; }
.orders-steps__item.is-done .orders-steps__dot { border-color: var(--success); background: var(--success); }
.orders-steps__item.is-current .orders-steps__dot { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .12); }
.orders-steps__item.is-current .orders-steps__dot::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.orders-steps__label { font-weight: 600; color: var(--faint); line-height: 1.25; }
.orders-steps__item.is-reached .orders-steps__label { color: var(--ink); }
.orders-steps__time { min-height: 15px; font-size: 11px; color: var(--muted); }

.orders-custnote p { margin-top: 2px; }
.orders-pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.orders-detail .card > .table-wrap { border: 0; border-radius: 0; border-bottom: 1px solid var(--line); }
.orders-prod { display: flex; align-items: center; gap: 10px; min-width: 220px; }
.orders-prod .thumb { width: 48px; height: 48px; }
.orders-prod__name { min-width: 0; }
.orders-thumb-empty { display: inline-flex; align-items: center; justify-content: center; color: var(--faint); }
.orders-sum { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.orders-totals { display: grid; gap: 6px; width: min(100%, 340px); margin: 0; }
.orders-totals > div { display: flex; justify-content: space-between; gap: 12px; }
.orders-totals dt { color: var(--muted); }
.orders-totals dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.orders-totals .is-discount dd { color: var(--success); }
.orders-totals .is-total { margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 16px; }
.orders-totals .is-total dt, .orders-totals .is-total dd { color: var(--ink); font-weight: 700; }
.orders-coupon { display: inline-block; margin-left: 4px; padding: 0 6px; border: 1px dashed var(--line-strong); border-radius: 4px; font-size: 11.5px; font-weight: 700; color: var(--ink); }
.orders-paywith { text-align: right; }

.orders-cust { font-size: 16px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
.orders-kv { display: grid; gap: 8px; margin: 0; }
.orders-kv > div { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.orders-kv dt { font-size: 12.5px; color: var(--muted); }
.orders-kv dd { margin: 0; overflow-wrap: anywhere; }
.orders-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.orders-wa { border-color: #b8e0c6; color: #0f6b35; }
.orders-wa:hover { background: var(--success-soft); border-color: var(--success); }
.orders-address { font-style: normal; line-height: 1.55; overflow-wrap: anywhere; }

.orders-note { padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--line); }
.orders-note .textarea { min-height: 64px; }
.orders-timeline { margin-top: 4px; }
.orders-timeline .timeline__item.is-note::before { background: var(--orange); box-shadow: 0 0 0 1px var(--orange); }
.orders-timeline .timeline__item.is-cancel::before { background: var(--danger); box-shadow: 0 0 0 1px var(--danger); }
.orders-tl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.orders-tl-msg { margin: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; }

.orders-item-meta { display: none; color: var(--muted); }
.orders-print { display: none; }

@media (max-width: 1100px) {
  .orders-filters .search { flex-basis: 100%; max-width: none; }
  /* uma coluna: cliente e entrega logo depois dos itens */
  .orders-split { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
  .orders-split > .stack { display: contents; }
  .orders-c-items { order: 1; }
  .orders-c-customer { order: 2; }
  .orders-c-delivery { order: 3; }
  .orders-c-payment { order: 4; }
  .orders-c-history { order: 5; }
}
@media (max-width: 860px) {
  .orders-chips { flex-wrap: nowrap; overflow-x: auto; margin: 0 -14px 12px; padding: 0 14px 4px; scrollbar-width: none; }
  .orders-chips::-webkit-scrollbar { display: none; }
  .orders-chips .chip { flex: none; }
  .orders-filters { gap: 10px; }
  .orders-filters .search { min-width: 0; }
  .orders-filters__period { flex: 1 1 100%; }
  .orders-filters__period .orders-filters__field { flex: 1 1 0; }
  .orders-filters__field .input[type="date"] { width: 100%; min-width: 0; }
  .orders-filters__field { flex: 1 1 160px; }
  .orders-filters__field .select { width: 100%; min-width: 0; max-width: none; }
}
/* Lista em cartões no celular (sem rolagem lateral) */
@media (max-width: 640px) {
  .orders-table thead { display: none; }
  .orders-table, .orders-table tbody { display: block; }
  .orders-table tbody tr { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "order order total" "cust cust cust" "status pay pay" "place place place" "store store store"; gap: 5px 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .orders-table tbody tr:last-child { border-bottom: 0; }
  .orders-table td { display: block; padding: 0; border: 0; }
  .orders-table .c-order { grid-area: order; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .orders-table .c-total { grid-area: total; }
  .orders-table .c-cust { grid-area: cust; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .orders-table .c-cust .orders-name { max-width: 100%; }
  .orders-table .c-status { grid-area: status; }
  .orders-table .c-pay { grid-area: pay; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
  .orders-table .c-pay > div + .badge { margin-top: 0; }
  .orders-table .c-place { grid-area: place; display: flex; flex-wrap: wrap; gap: 0 6px; }
  .orders-table .c-place .orders-place { min-width: 0; }
  .orders-table .c-store { grid-area: store; min-width: 0; max-width: none; color: var(--muted); }
  .orders-items thead { display: none; }
  .orders-items table, .orders-items tbody { display: block; }
  .orders-items tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .orders-items tbody tr:last-child { border-bottom: 0; }
  .orders-items td { display: block; padding: 0; border: 0; }
  .orders-items .c-var, .orders-items .c-qty, .orders-items .c-unit { display: none; }
  .orders-items .orders-prod { min-width: 0; align-items: flex-start; }
  .orders-item-meta { display: block; margin-top: 2px; }
}
@media (max-width: 560px) {
  .orders-hide-sm { display: none; }
  .orders-head__code { font-size: 21px; }
  .orders-head__actions { width: 100%; }
  .orders-head__actions > .btn, .orders-head__actions > .orders-dd { flex: 1 1 calc(50% - 4px); }
  .orders-head__actions > .btn--primary { flex-basis: 100%; }
  .orders-head__actions .orders-dd > .btn { width: 100%; }
  .orders-dd .menu { position: fixed; left: 12px; right: 12px; top: auto; bottom: 12px; z-index: 130; min-width: 0; box-shadow: var(--shadow-lg); }
  .orders-steps { padding: 12px 4px 14px; }
  .orders-steps__item { font-size: 11px; }
  .orders-steps__time { font-size: 10px; }
  .orders-paywith { text-align: left; align-self: stretch; }
  .orders-sum { align-items: stretch; }
  .orders-totals { width: 100%; }
}

/* ---------- Impressão (romaneio) ---------- */
@media print {
  .orders-detail .orders-screen { display: none !important; }
  .orders-print { display: block; color: #000; font-size: 11.5px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .orders-print p { margin: 0 0 2px; }
  .orders-print h3 { margin: 0 0 4px; font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: #444; }
  .orders-print .op-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 2px solid #000; }
  .orders-print .op-brand { font-size: 17px; font-weight: 700; }
  .orders-print .op-title { font-size: 17px; font-weight: 700; }
  .orders-print .op-right { text-align: right; }
  .orders-print .op-small { font-size: 10.5px; color: #333; }
  .orders-print .op-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .orders-print .op-box { padding: 7px 9px; border: 1px solid #888; border-radius: 4px; break-inside: avoid; overflow-wrap: anywhere; }
  .orders-print .op-table { width: 100%; margin-bottom: 10px; border-collapse: collapse; }
  .orders-print .op-table th, .orders-print .op-table td { padding: 5px 7px; border: 1px solid #888; text-align: left; vertical-align: top; }
  .orders-print .op-table th { background: #eee; font-size: 9.5px; letter-spacing: .4px; text-transform: uppercase; }
  .orders-print .op-table .num { text-align: right; white-space: nowrap; }
  .orders-print .op-table tr { break-inside: avoid; }
  .orders-print .op-c { width: 40px; text-align: center !important; }
  .orders-print .op-check { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #000; border-radius: 2px; }
  .orders-print .op-totals { width: 260px; margin: 0 0 12px auto; }
  .orders-print .op-totals > div { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
  .orders-print .op-total { margin-top: 3px; padding-top: 4px !important; border-top: 1.5px solid #000; font-size: 13px; font-weight: 700; }
  .orders-print .op-notes { padding: 7px 9px; margin-bottom: 8px; border: 1px solid #888; border-radius: 4px; white-space: pre-wrap; break-inside: avoid; }
  .orders-print .op-sign { display: grid; grid-template-columns: 2fr 1fr; gap: 30px 24px; margin-top: 34px; break-inside: avoid; }
  .orders-print .op-sign div { padding-top: 4px; border-top: 1px solid #000; font-size: 10px; }
  .orders-print .op-foot { margin-top: 18px; font-size: 9.5px; color: #444; text-align: center; }
}
`;

export default {
  title: 'Pedidos',
  async render(view, ctx) {
    injectStyle('orders', CSS);
    const id = ctx.args[0];
    if (id) return renderDetail(view, ctx, id);
    return renderList(view, ctx);
  },
};
