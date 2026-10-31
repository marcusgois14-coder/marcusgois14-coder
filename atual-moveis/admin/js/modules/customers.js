// Clientes: lista com estatísticas (rpc customers_list), busca, paginação, exportação CSV
// e painel lateral com contato, totais e pedidos do cliente nas lojas que a pessoa acompanha.
//
// Rotas: #/customers  ·  #/customers/<id> (abre o painel do cliente)  ·  ?q=<busca>&page=N
import { sb, q, rpc } from '../api.js';
import {
  html, render, $, icon, toast, toastError, money, num, date, datetime, relTime, phone as fmtPhone, badge, statusBadge,
  PAYMENT_METHOD, PAYMENT_STATUS, openModal, loading, empty, errorBlock, pager, toCSV, downloadFile, injectStyle, debounce, isoDay,
} from '../ui.js';

const PAGE_SIZE = 30;
const EXPORT_LIMIT = 500; // máximo aceito pelo customers_list
const PANEL_ORDERS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- Utilitários ---------- */
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
// Busca "de telefone": só dígitos e pontuação de telefone
const isPhoneQuery = (s) => /\d/.test(s) && /^[\d\s()+.-]+$/.test(s);
const waLink = (p) => {
  const d = digitsOf(p);
  return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}` : '';
};
const csvNum = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
const csvDate = (v) =>
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).replace(',', '') : '';
const PAY_SHORT = { pending: 'Pendente', paid: 'Pago', refunded: 'Estornado', failed: 'Não aprovado' };

function maskCpf(v) {
  const d = digitsOf(v);
  if (!d) return '';
  if (d.length !== 11) return `${'•'.repeat(Math.max(0, d.length - 3))}${d.slice(-3)}`;
  return `•••.•••.•${d.slice(7, 9)}-${d.slice(9)}`;
}
const fullCpf = (v) => {
  const d = digitsOf(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v || '';
};

function storesCell(list) {
  const names = (list || []).filter(Boolean);
  if (!names.length) return html`<span class="faint">—</span>`;
  return html`<span class="cu-stores"><span class="ellipsis">${names[0]}</span>${
    names.length > 1 ? html`<span class="badge badge--plain cu-more">+${names.length - 1}</span>` : ''
  }</span>`;
}

/* ---------- Dados ---------- */
// O customers_list do banco compara o telefone com os dígitos da busca; numa busca só com letras
// essa comparação vira "contém vazio" e devolve todos os clientes. Por isso, buscas por nome/e-mail
// pedem até 500 clientes ao banco e filtram aqui (resultado correto também depois de corrigido no banco).
function createSource(ctx) {
  let cache = { key: null, rows: [], capped: false };

  const clientFilter = async (term) => {
    const key = `${ctx.storeId || 'rede'}|${term}`;
    if (cache.key !== key) {
      const res = await rpc('customers_list', { p_store: ctx.storeId, p_search: term, p_limit: EXPORT_LIMIT, p_offset: 0 });
      const needle = fold(term);
      cache = {
        key,
        rows: (res?.rows || []).filter((r) => fold(r.name).includes(needle) || fold(r.email).includes(needle)),
        capped: (res?.total || 0) > EXPORT_LIMIT,
      };
    }
    return cache;
  };

  return {
    async page(search, page) {
      const term = search.trim();
      if (term && !isPhoneQuery(term)) {
        const c = await clientFilter(term);
        return { rows: c.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: c.rows.length, capped: c.capped };
      }
      const res = await rpc('customers_list', {
        p_store: ctx.storeId,
        p_search: term || null,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      });
      return { rows: res?.rows || [], total: res?.total || 0, capped: false };
    },
    async all(search) {
      const term = search.trim();
      if (term && !isPhoneQuery(term)) {
        const c = await clientFilter(term);
        return { rows: c.rows, total: c.rows.length, capped: c.capped };
      }
      const res = await rpc('customers_list', { p_store: ctx.storeId, p_search: term || null, p_limit: EXPORT_LIMIT, p_offset: 0 });
      return { rows: res?.rows || [], total: res?.total || 0, capped: (res?.total || 0) > EXPORT_LIMIT };
    },
    reset() {
      cache = { key: null, rows: [], capped: false };
    },
  };
}

/* =========================================================
   PAINEL DO CLIENTE
   ========================================================= */
function openCustomerPanel(ctx, id, { onClose } = {}) {
  const network = !ctx.storeId;
  const panel = openModal({
    title: 'Cliente',
    variant: 'panel',
    body: loading('Carregando cliente…'),
    onClose,
  });
  const el = panel.el;
  const body = $('.modal__body', el);
  el.classList.add('cu-panel');

  // Links para pedidos fecham o painel antes de trocar de tela
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (a) panel.close('navigate');
    const reveal = e.target.closest('[data-reveal-cpf]');
    if (reveal) {
      const out = $('[data-cpf]', el);
      const shown = reveal.getAttribute('aria-pressed') === 'true';
      out.textContent = shown ? out.dataset.masked : out.dataset.full;
      reveal.setAttribute('aria-pressed', shown ? 'false' : 'true');
      reveal.textContent = shown ? 'Mostrar' : 'Ocultar';
    }
  });

  (async () => {
    try {
      let oq = sb
        .from('orders')
        .select('id, code, created_at, store_id, status, payment_status, payment_method, installments, total', { count: 'exact' })
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(PANEL_ORDERS);
      if (ctx.storeId) oq = oq.eq('store_id', ctx.storeId);
      const [cust, ordersRes] = await Promise.all([
        q(sb.from('customers').select('id, name, phone, email, cpf, created_at, last_order_at').eq('id', id).maybeSingle()),
        q(oq),
      ]);
      if (!el.isConnected) return;
      const orders = ordersRes?.data || [];
      const totalOrders = ordersRes?.count ?? orders.length;
      if (!cust || (!orders.length && !network)) {
        render(
          body,
          html`${empty(
            'Cliente não encontrado',
            ctx.storeId ? 'Este cliente não tem pedidos nesta loja ou você não tem acesso a ele.' : 'Ele pode ter sido removido ou você não tem acesso a ele.'
          )}`
        );
        return;
      }
      el.setAttribute('aria-label', `Cliente ${cust.name}`);

      const valid = orders.filter((o) => o.status !== 'canceled');
      const spent = valid.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const canceled = orders.length - valid.length;
      const avg = valid.length ? spent / valid.length : 0;
      const first = orders.length ? orders[orders.length - 1].created_at : null;
      const last = orders[0]?.created_at || cust.last_order_at;
      const storeIds = [...new Set(orders.map((o) => o.store_id))];
      const wa = waLink(cust.phone);
      const truncated = totalOrders > orders.length;

      render(
        body,
        html`<div class="stack cu-detail">
          <section class="card">
            <div class="card__body stack" style="--gap:14px">
              <div class="row row--between row--top">
                <div class="grow">
                  <div class="cu-detail__name">${cust.name}</div>
                  <div class="muted small">Cliente desde ${date(cust.created_at)}${ctx.storeId ? ` · ${ctx.storeName(ctx.storeId)}` : ''}</div>
                </div>
              </div>
              <dl class="cu-kv">
                <div><dt>Telefone</dt><dd><span class="nowrap">${fmtPhone(cust.phone)}</span>
                  <span class="cu-btns">
                    ${wa ? html`<a class="btn btn--sm cu-wa" href="${wa}" target="_blank" rel="noopener" aria-label="Conversar no WhatsApp (abre em nova aba)">${icon('whatsapp', 'icon-sm')} WhatsApp</a>` : ''}
                    <a class="btn btn--sm" href="tel:+55${digitsOf(cust.phone)}" aria-label="Ligar para ${fmtPhone(cust.phone)}">Ligar</a>
                  </span></dd></div>
                <div><dt>E-mail</dt><dd>${cust.email ? html`<a href="mailto:${cust.email}">${cust.email}</a>` : html`<span class="faint">Não informado</span>`}</dd></div>
                <div><dt>CPF</dt><dd>${cust.cpf
                  ? html`<span class="mono" data-cpf data-masked="${maskCpf(cust.cpf)}" data-full="${fullCpf(cust.cpf)}">${maskCpf(cust.cpf)}</span>
                      <button class="btn btn--ghost btn--sm" type="button" data-reveal-cpf aria-pressed="false" aria-label="Mostrar ou ocultar o CPF">Mostrar</button>`
                  : html`<span class="faint">Não informado</span>`}</dd></div>
                ${network ? html`<div><dt>Lojas</dt><dd>${storeIds.map((sid) => ctx.storeName(sid)).join(', ') || '—'}</dd></div>` : ''}
              </dl>
            </div>
          </section>

          <section class="grid cu-kpis" aria-label="Resumo do cliente">
            <div class="card kpi"><div class="kpi__label">Pedidos</div><div class="kpi__value">${num(totalOrders)}</div>
              <div class="kpi__hint">${canceled ? `${num(canceled)} cancelado${canceled > 1 ? 's' : ''}` : 'Nenhum cancelado'}</div></div>
            <div class="card kpi"><div class="kpi__label">Total gasto</div><div class="kpi__value">${money(spent)}</div>
              <div class="kpi__hint">Exclui cancelados</div></div>
            <div class="card kpi"><div class="kpi__label">Ticket médio</div><div class="kpi__value">${money(avg)}</div>
              <div class="kpi__hint">${first ? `Primeiro em ${date(first)}` : '—'}</div></div>
            <div class="card kpi"><div class="kpi__label">Último pedido</div><div class="kpi__value cu-kpi-sm" title="${datetime(last)}">${relTime(last)}</div>
              <div class="kpi__hint">${datetime(last)}</div></div>
          </section>

          <section class="card">
            <div class="card__head">
              <div class="h2">Pedidos${ctx.storeId ? ' nesta loja' : ''}</div>
              ${orders.length ? html`<a class="btn btn--sm" href="#/orders?customer=${cust.id}">Abrir na lista de pedidos ${icon('chevronRight', 'icon-sm')}</a>` : ''}
            </div>
            ${orders.length
              ? html`<div class="table-wrap cu-orders"><table class="table">
                  <thead><tr>
                    <th scope="col">Pedido</th>
                    ${network ? html`<th scope="col">Loja</th>` : ''}
                    <th scope="col">Status</th>
                    <th scope="col">Pagamento</th>
                    <th scope="col" class="num">Total</th>
                  </tr></thead>
                  <tbody>${orders.map(
                    (o) => html`<tr>
                      <td class="cu-o-code"><a class="cu-code" href="#/orders/${o.id}">${o.code}</a><div class="muted small nowrap">${datetime(o.created_at)}</div></td>
                      ${network ? html`<td class="small cu-o-store">${ctx.storeName(o.store_id)}</td>` : ''}
                      <td class="cu-o-status">${statusBadge(o.status)}</td>
                      <td class="cu-o-pay"><div class="small nowrap">${PAYMENT_METHOD[o.payment_method] || o.payment_method}${Number(o.installments) > 1 ? ` · ${o.installments}x` : ''}</div>
                        ${badge(PAY_SHORT[o.payment_status] || o.payment_status, PAYMENT_STATUS[o.payment_status]?.tone)}</td>
                      <td class="num cu-o-total"><strong class="${o.status === 'canceled' ? 'cu-strike' : ''}">${money(o.total)}</strong></td>
                    </tr>`
                  )}</tbody>
                </table></div>
                ${truncated ? html`<p class="muted small cu-note">Mostrando os ${num(orders.length)} pedidos mais recentes de ${num(totalOrders)}.</p>` : ''}`
              : html`<div class="card__body">${empty('Nenhum pedido', 'Este cliente não tem pedidos nas lojas que você acompanha.')}</div>`}
          </section>
        </div>`
      );
    } catch (e) {
      if (el.isConnected) render(body, errorBlock(e));
    }
  })();

  return panel;
}

/* =========================================================
   LISTA
   ========================================================= */
export default {
  title: 'Clientes',
  async render(view, ctx) {
    injectStyle('customers', CSS);
    const network = !ctx.storeId;
    const source = createSource(ctx);
    const st = {
      q: String(ctx.query.q || ''),
      page: Math.max(1, parseInt(ctx.query.page, 10) || 1),
      rows: [],
      total: 0,
    };
    let token = 0;
    let firstLoad = true;
    let openPanel = null;
    let reloadTimer = null;

    ctx.setActions(
      html`<button class="btn" type="button" data-cu-export aria-label="Exportar clientes em CSV" title="Exporta a lista atual (até ${num(EXPORT_LIMIT)} clientes)">
        ${icon('download')}<span class="cu-hide-sm">Exportar CSV</span>
      </button>`
    );

    render(
      view,
      html`<div class="cu">
        <form class="toolbar cu-toolbar" data-search-form role="search" novalidate>
          <div class="search">
            ${icon('search')}
            <label class="visually-hidden" for="cu-q">Buscar clientes</label>
            <input class="input" id="cu-q" name="q" type="search" value="${st.q}" placeholder="Nome, telefone ou e-mail" autocomplete="off" enterkeyhint="search">
          </div>
          <span class="muted small" data-summary></span>
        </form>
        <div class="cu-results" data-results aria-live="polite">${loading('Carregando clientes…')}</div>
      </div>`
    );
    const results = $('[data-results]', view);
    const input = $('#cu-q', view);

    const listHash = () => {
      const p = new URLSearchParams();
      if (st.q.trim()) p.set('q', st.q.trim());
      if (st.page > 1) p.set('page', String(st.page));
      const qs = p.toString();
      return `#/customers${qs ? `?${qs}` : ''}`;
    };
    const syncUrl = () => {
      if (openPanel) return;
      const h = listHash();
      if (location.hash !== h) history.replaceState(null, '', h);
    };

    const drawRows = ({ rows, total, capped }) => {
      st.rows = rows;
      st.total = total;
      const searching = !!st.q.trim();
      render(
        $('[data-summary]', view),
        total
          ? `${num(total)} ${total === 1 ? 'cliente' : 'clientes'}${searching ? (total === 1 ? ' encontrado' : ' encontrados') : ''}${capped ? ' (entre os 500 mais recentes)' : ''}`
          : ''
      );
      if (!rows.length) {
        render(
          results,
          html`<div class="table-wrap">${empty(
            searching ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda',
            searching ? 'Tente outro nome, telefone ou e-mail.' : 'Os clientes aparecem aqui depois do primeiro pedido na loja virtual.',
            searching ? html`<button class="btn btn--sm" type="button" data-clear>Limpar busca</button>` : ''
          )}</div>`
        );
        return;
      }
      render(
        results,
        html`<div class="table-wrap"><table class="table cu-table">
          <thead><tr>
            <th scope="col">Cliente</th>
            <th scope="col">Telefone</th>
            <th scope="col">E-mail</th>
            <th scope="col" class="num">Pedidos</th>
            <th scope="col" class="num">Total gasto</th>
            <th scope="col">Último pedido</th>
            ${network ? html`<th scope="col">Lojas</th>` : ''}
          </tr></thead>
          <tbody>${rows.map((r) => {
            const wa = waLink(r.phone);
            return html`<tr class="is-clickable" data-id="${r.id}">
              <td class="cu-c-name"><button class="cu-name" type="button" data-open="${r.id}">${r.name}</button>
                <div class="muted small nowrap">Desde ${date(r.created_at)}</div></td>
              <td class="nowrap cu-c-phone"><span class="cu-phone">${fmtPhone(r.phone)}
                ${wa ? html`<a class="btn btn--ghost btn--sm btn--icon cu-wa-icon" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp de ${r.name} (abre em nova aba)" title="Conversar no WhatsApp">${icon('whatsapp', 'icon-sm')}</a>` : ''}</span></td>
              <td class="cu-c-email">${r.email ? html`<span class="ellipsis" title="${r.email}">${r.email}</span>` : html`<span class="faint">—</span>`}</td>
              <td class="num cu-c-orders">${num(r.orders)}<span class="cu-sm-only"> ${Number(r.orders) === 1 ? 'pedido' : 'pedidos'}</span></td>
              <td class="num cu-c-spent"><strong>${money(r.spent)}</strong></td>
              <td class="nowrap cu-c-last" title="${datetime(r.last_order_at)}"><span class="cu-sm-only muted">Último </span>${relTime(r.last_order_at)}</td>
              ${network ? html`<td class="small cu-c-stores" title="${(r.stores || []).join(', ')}">${storesCell(r.stores)}</td>` : ''}
            </tr>`;
          })}</tbody>
        </table></div>
        ${total > PAGE_SIZE ? pager({ page: st.page, pageSize: PAGE_SIZE, total }) : ''}`
      );
    };

    async function load() {
      const my = ++token;
      syncUrl();
      if (!firstLoad) results.classList.add('is-busy');
      try {
        const res = await source.page(st.q, st.page);
        if (my !== token) return;
        const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (st.page > pages) {
          st.page = pages;
          load();
          return;
        }
        drawRows(res);
      } catch (e) {
        if (my !== token) return;
        render($('[data-summary]', view), '');
        render(results, html`${errorBlock(e)}<div class="mt-3"><button class="btn" type="button" data-retry>${icon('refresh')} Tentar de novo</button></div>`);
      } finally {
        if (my === token) {
          results.classList.remove('is-busy');
          firstLoad = false;
        }
      }
    }

    const showCustomer = (id) => {
      if (openPanel) openPanel.close();
      const back = listHash();
      history.replaceState(null, '', `#/customers/${id}${back.includes('?') ? back.slice(back.indexOf('?')) : ''}`);
      const panel = openCustomerPanel(ctx, id, {
        onClose: (reason) => {
          if (openPanel === panel) openPanel = null;
          // ao seguir um link (#/orders/...), não reescreve o endereço de destino
          if (reason !== 'navigate' && location.hash.startsWith('#/customers')) history.replaceState(null, '', back);
        },
      });
      openPanel = panel;
    };

    /* ---------- Eventos ---------- */
    const search = debounce(() => {
      const next = input.value;
      if (next.trim() === st.q.trim()) return;
      st.q = next;
      st.page = 1;
      load();
    }, 350);
    input.addEventListener('input', search);
    $('[data-search-form]', view).addEventListener('submit', (e) => {
      e.preventDefault();
      st.q = input.value;
      st.page = 1;
      load();
    });

    view.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-page]');
      if (pg && !pg.disabled) {
        st.page = Math.max(1, Number(pg.dataset.page) || 1);
        load();
        $('.cu-toolbar', view)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if (e.target.closest('[data-retry]')) {
        render(results, loading('Carregando clientes…'));
        load();
        return;
      }
      if (e.target.closest('[data-clear]')) {
        input.value = '';
        st.q = '';
        st.page = 1;
        load();
        input.focus();
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) {
        showCustomer(open.dataset.open);
        return;
      }
      if (e.target.closest('a, button')) return; // WhatsApp e afins
      const tr = e.target.closest('tr[data-id]');
      if (tr && !window.getSelection()?.toString()) showCustomer(tr.dataset.id);
    });

    $('[data-actions] [data-cu-export]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const old = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span><span class="cu-hide-sm">Exportando…</span>';
      try {
        const { rows, capped } = await source.all(st.q);
        if (!rows.length) {
          toast('Nenhum cliente para exportar.', 'warning');
          return;
        }
        const columns = [
          { label: 'Nome', key: 'name' },
          { label: 'Telefone', value: (r) => fmtPhone(r.phone) },
          { label: 'E-mail', value: (r) => r.email || '' },
          { label: 'Pedidos', value: (r) => r.orders },
          { label: 'Total gasto (R$)', value: (r) => csvNum(r.spent) },
          { label: 'Último pedido', value: (r) => csvDate(r.last_order_at) },
          { label: 'Cliente desde', value: (r) => csvDate(r.created_at) },
          ...(network ? [{ label: 'Lojas', value: (r) => (r.stores || []).join(', ') }] : []),
        ];
        const scope = ctx.store ? ctx.store.slug : 'rede';
        downloadFile(`clientes-${scope}-${isoDay(new Date())}.csv`, toCSV(rows, columns));
        toast(
          capped ? `Exportados os ${num(rows.length)} clientes mais recentes (limite de ${num(EXPORT_LIMIT)}).` : `${num(rows.length)} ${rows.length === 1 ? 'cliente exportado' : 'clientes exportados'}.`,
          capped ? 'warning' : 'success'
        );
      } catch (err) {
        toastError(err);
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.innerHTML = old;
        }
      }
    });

    // Pedido novo pode trazer cliente novo: atualiza a lista (sem mexer no painel aberto)
    ctx.on('new-order', () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        source.reset();
        load();
      }, 800);
    });
    ctx.onCleanup(() => {
      clearTimeout(reloadTimer);
      if (openPanel) openPanel.close('navigate');
    });

    await load();
    const deep = ctx.args[0];
    if (deep && UUID_RE.test(deep)) showCustomer(deep);
  },
};

const CSS = `
.cu-toolbar .search { max-width: 460px; }
.cu-results.is-busy { opacity: .55; pointer-events: none; transition: opacity .15s; }
.cu-table td { vertical-align: middle; }
.cu-name { display: block; max-width: 260px; padding: 0; border: 0; background: none; color: var(--ink); font-weight: 700; text-align: left; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cu-name:hover { color: var(--accent); text-decoration: underline; }
.cu-c-name { min-width: 180px; }
.cu-phone { display: inline-flex; align-items: center; gap: 2px; }
.cu-wa-icon { color: #128c4b; }
.cu-wa-icon:hover { background: var(--success-soft); }
.cu-c-email .ellipsis { display: block; max-width: 240px; }
.cu-c-stores { min-width: 150px; max-width: 230px; }
.cu-stores { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cu-stores .ellipsis { min-width: 0; }
.cu-more { flex: none; height: 20px; padding: 0 7px; }
.cu-hide-sm { display: inline; }
.cu-sm-only { display: none; }

.cu-panel .modal__body { background: var(--bg); }
.cu-detail__name { font-size: 20px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; line-height: 1.25; }
.cu-kv { display: grid; gap: 10px; margin: 0; }
.cu-kv > div { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.cu-kv dt { font-size: 12.5px; color: var(--muted); }
.cu-kv dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; overflow-wrap: anywhere; }
.cu-btns { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.cu-wa { border-color: #b8e0c6; color: #0f6b35; }
.cu-wa:hover { background: var(--success-soft); border-color: var(--success); }
.cu-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); --gap: 12px; }
.cu-kpis .kpi { padding: 14px; }
.cu-kpis .kpi__value { font-size: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cu-kpis .kpi__hint { font-size: 12px; }
.cu-orders { border: 0; border-radius: 0 0 var(--radius) var(--radius); }
.cu-code { font-weight: 700; }
.cu-strike { text-decoration: line-through; color: var(--muted); }
.cu-note { padding: 10px 18px; border-top: 1px solid var(--line); }

@media (max-width: 860px) {
  .cu-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .cu-hide-sm { display: none; }
  .cu-sm-only { display: inline; }
  .cu-toolbar .search { flex-basis: 100%; max-width: none; }
  .cu-panel .modal__body { padding: 14px; }
  .cu-kpis .kpi__value { font-size: 18px; }
  /* tabelas viram lista de cartões */
  .cu-table thead, .cu-orders thead { display: none; }
  .cu-table, .cu-table tbody, .cu-orders table, .cu-orders tbody { display: block; }
  .cu-table tr, .cu-orders tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .cu-table tbody tr:last-child, .cu-orders tbody tr:last-child { border-bottom: 0; }
  .cu-table td, .cu-orders td { display: block; padding: 0; border: 0; min-width: 0; }
  .cu-table tr { grid-template-areas: "name spent" "phone orders" "email last" "stores stores"; }
  .cu-c-name { grid-area: name; min-width: 0; }
  .cu-name { max-width: 100%; }
  .cu-c-spent { grid-area: spent; }
  .cu-c-phone { grid-area: phone; }
  .cu-c-orders { grid-area: orders; color: var(--muted); }
  .cu-c-email { grid-area: email; color: var(--muted); }
  .cu-c-email .ellipsis { max-width: 100%; }
  .cu-c-email .faint { display: none; }
  .cu-c-last { grid-area: last; text-align: right; }
  .cu-c-stores { grid-area: stores; max-width: none; }
  .cu-orders tr { grid-template-areas: "code total" "status pay" "store store"; gap: 6px 12px; }
  .cu-o-code { grid-area: code; }
  .cu-o-total { grid-area: total; }
  .cu-o-status { grid-area: status; align-self: center; }
  .cu-o-pay { grid-area: pay; text-align: right; }
  .cu-o-store { grid-area: store; color: var(--muted); }
}
`;
