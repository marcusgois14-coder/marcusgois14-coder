// Clientes: lista com estatísticas (rpc customers_list), busca, paginação, exportação CSV
// e gaveta do cliente com contato, totais e pedidos nas lojas que a pessoa acompanha.
//
// Rotas: #/customers  ·  #/customers/<id> (abre a gaveta do cliente)  ·  ?q=<busca>&page=N
import { sb, q, rpc, storefrontUrl } from '../api.js';
import {
  html, render, $, icon, toast, toastError, money, num, date, datetime, relTime, phone as fmtPhone, badge,
  PAYMENT_METHOD, PAYMENT_ICON, empty, errorBlock, pager, skeleton, toCSV, downloadFile, injectStyle, debounce,
  isoDay, drawer, avatar, storeMark, highlight, withBusy,
} from '../ui.js';

const PAGE_SIZE = 30;
const EXPORT_LIMIT = 500; // máximo aceito pelo customers_list
const PANEL_ORDERS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SP = 'America/Sao_Paulo';

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
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: SP, dateStyle: 'short', timeStyle: 'short' }).replace(',', '') : '';
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const PAY_SHORT = { pending: 'Pendente', paid: 'Pago', refunded: 'Estornado', failed: 'Não aprovado' };
const PAY_ICON_S = { pending: 'clock', paid: 'checkCircle', refunded: 'undo', failed: 'xCircle' };
const PAY_TONE = { pending: 'warn', paid: 'ok', refunded: 'neu', failed: 'bad' };
const SHORT = { pending: 'Novo', confirmed: 'Confirmado', preparing: 'Em separação', out_for_delivery: 'Em rota', delivered: 'Entregue', canceled: 'Cancelado' };
const spDay = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: SP });
const hhmm = (v) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' });
// "Hoje, 09:14" · "Ontem, 17:40" · "31/10, 16:25" · "31/10/2025"
function whenShort(v) {
  if (!v) return '—';
  const d = spDay(v);
  const today = spDay(Date.now());
  if (d === today) return `Hoje, ${hhmm(v)}`;
  if (d === spDay(Date.now() - 86400000)) return `Ontem, ${hhmm(v)}`;
  return d.slice(0, 4) === today.slice(0, 4) ? `${d.slice(8, 10)}/${d.slice(5, 7)}, ${hhmm(v)}` : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}
// Dica do "último pedido": data e hora quando o valor é relativo ("há 2 d"); só a hora quando já é a data
const lastHint = (v) => {
  if (!v) return '—';
  if (/^(há|agora)/.test(relTime(v))) return datetime(v);
  return `às ${hhmm(v)}`;
};

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
const payStatus = (s) => html`<span class="pay__s t-${PAY_TONE[s] || 'neu'}">${icon(PAY_ICON_S[s] || 'info', 'icon-xs')}${PAY_SHORT[s] || s}</span>`;

// Lojas do cliente: sigla + nome curto da primeira, "+N" nas demais
function storesCell(ctx, list) {
  const names = (list || []).filter(Boolean);
  if (!names.length) return html`<span class="faint">—</span>`;
  const stores = names.map((n) => ctx.stores.find((s) => s.name === n) || { name: n, city: n.split(' - ').pop() });
  return html`<span class="cu-stores" title="${names.join(', ')}">
    <span class="cu-marks" aria-hidden="true">${storeMark(stores[0], 22)}</span>
    <span class="ellipsis">${ctx.storeShort?.(stores[0]) || names[0]}</span>${names.length > 1 ? html`<span class="cu-more">+${names.length - 1}</span>` : ''}
  </span>`;
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
   GAVETA DO CLIENTE
   ========================================================= */
function openCustomerPanel(ctx, id, { onClose, seed } = {}) {
  const network = !ctx.storeId;
  const headFor = (c) => {
    const wa = c?.phone ? waLink(c.phone) : '';
    const d = digitsOf(c?.phone);
    return html`<div class="cu-dh">
      <div class="cu-dh__id">
        ${c ? avatar(c.name, { size: 46 }) : html`<span class="skeleton" style="width:46px;height:46px;border-radius:14px"></span>`}
        <div class="cu-dh__txt">
          ${c ? html`<h2 class="cu-dh__name">${c.name}</h2>` : html`<span class="skeleton" style="width:180px;height:20px"></span>`}
          <p class="cu-dh__sub">${c?.created_at ? html`Cliente desde ${date(c.created_at)}${ctx.storeId ? ` · ${ctx.storeName(ctx.storeId)}` : ''}` : html`<span class="skeleton" style="width:140px;height:11px"></span>`}</p>
        </div>
      </div>
      ${c
        ? html`<div class="cu-dh__acts">
            ${wa ? html`<a class="btn btn--sm cu-wa" href="${wa}" target="_blank" rel="noopener" aria-label="Conversar no WhatsApp (abre em nova aba)">${icon('whatsapp', 'icon-sm')} WhatsApp</a>` : ''}
            ${d ? html`<a class="btn btn--sm" href="tel:+55${d}" aria-label="Ligar para ${fmtPhone(c.phone)}">${icon('phone', 'icon-sm')} Ligar</a>` : ''}
            ${c.email ? html`<a class="btn btn--sm" href="mailto:${c.email}" aria-label="Escrever para ${c.email}">${icon('mail', 'icon-sm')} E-mail</a>` : ''}
          </div>`
        : ''}
    </div>`;
  };
  const panel = drawer({
    title: seed?.name ? `Cliente ${seed.name}` : 'Cliente',
    head: headFor(seed ? { ...seed } : null),
    body: html`<div class="cu-detail" aria-busy="true">${skeleton('kpis')}<div class="card cu-sk">${skeleton('list', { rows: 4 })}</div></div>`,
    size: '',
    cls: 'cu-panel',
    onClose,
    onMount(el) {
      el.addEventListener('click', (e) => {
        const reveal = e.target.closest('[data-reveal-cpf]');
        if (reveal) {
          const out = $('[data-cpf]', el);
          const shown = reveal.getAttribute('aria-pressed') === 'true';
          out.textContent = shown ? out.dataset.masked : out.dataset.full;
          reveal.setAttribute('aria-pressed', shown ? 'false' : 'true');
          reveal.textContent = shown ? 'Mostrar' : 'Ocultar';
        }
      });
    },
  });
  const el = panel.el;

  const loadPanel = async () => {
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
      // q() devolve { data, count } com contagem e só o array quando a contagem não vem
      const orders = (Array.isArray(ordersRes) ? ordersRes : ordersRes?.data) || [];
      const totalOrders = Math.max(Array.isArray(ordersRes) ? 0 : Number(ordersRes?.count) || 0, orders.length);
      if (!cust || (!orders.length && !network)) {
        panel.setContent({
          head: html`<div class="cu-dh"><h2 class="cu-dh__name">Cliente não encontrado</h2></div>`,
          body: empty(
            'Cliente não encontrado',
            ctx.storeId ? 'Este cliente não tem pedidos nesta loja ou você não tem acesso a ele.' : 'Ele pode ter sido removido ou você não tem acesso a ele.',
            '',
            { art: 'site:empty-search', size: 'sm' }
          ),
        });
        return;
      }
      el.setAttribute('aria-label', `Cliente ${cust.name}`);
      const hidden = $('.modal__head h2.visually-hidden', el);
      if (hidden) hidden.textContent = `Cliente ${cust.name}`;

      const valid = orders.filter((o) => o.status !== 'canceled');
      const spent = valid.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const canceled = orders.length - valid.length;
      const avg = valid.length ? spent / valid.length : 0;
      const first = orders.length ? orders[orders.length - 1].created_at : null;
      const last = orders[0]?.created_at || cust.last_order_at;
      const storeIds = [...new Set(orders.map((o) => o.store_id))];
      const truncated = totalOrders > orders.length;
      const kpi = (label, value, hint, cls = '') =>
        html`<div class="card kpi cu-kpi ${cls}"><div class="kpi__label">${label}</div><div class="kpi__value">${value}</div><div class="kpi__sub">${hint}</div></div>`;

      panel.setContent({
        head: headFor(cust),
        body: html`<div class="cu-detail">
          <section class="cu-kpis" aria-label="Resumo do cliente">
            ${kpi('Pedidos', num(totalOrders), canceled ? plural(canceled, 'cancelado', 'cancelados') : 'Nenhum cancelado')}
            ${kpi('Total gasto', money(spent), 'Sem os cancelados')}
            ${kpi('Ticket médio', money(avg), first ? `1º pedido em ${date(first)}` : '—')}
            ${kpi('Último pedido', html`<span title="${datetime(last)}">${relTime(last)}</span>`, lastHint(last), 'cu-kpi--last')}
          </section>

          <section class="dsec cu-contact" aria-labelledby="cu-contact-t">
            <div class="dsec__head"><h3 id="cu-contact-t">Contato</h3></div>
            <dl class="cu-kv">
              <div><dt>Telefone</dt><dd><span class="mono-num">${fmtPhone(cust.phone)}</span></dd></div>
              <div><dt>E-mail</dt><dd>${cust.email ? html`<a href="mailto:${cust.email}">${cust.email}</a>` : html`<span class="muted">Não informado</span>`}</dd></div>
              <div><dt>CPF</dt><dd>${cust.cpf
                ? html`<span class="mono" data-cpf data-masked="${maskCpf(cust.cpf)}" data-full="${fullCpf(cust.cpf)}">${maskCpf(cust.cpf)}</span>
                    <button class="btn btn--ghost btn--sm" type="button" data-reveal-cpf aria-pressed="false" aria-label="Mostrar ou ocultar o CPF">Mostrar</button>`
                : html`<span class="muted">Não informado</span>`}</dd></div>
              ${network
                ? html`<div><dt>Lojas</dt><dd class="cu-kv__stores">${storeIds.length
                    ? storeIds.map((sid) => {
                        const s = ctx.stores.find((x) => x.id === sid);
                        return html`<span class="cu-chip">${s ? storeMark(s, 18) : ''}${ctx.storeShort?.(sid) || ctx.storeName(sid)}</span>`;
                      })
                    : '—'}</dd></div>`
                : ''}
            </dl>
          </section>

          <section class="dsec cu-orders" aria-labelledby="cu-orders-t">
            <div class="dsec__head"><h3 id="cu-orders-t">Pedidos${ctx.storeId ? ' nesta loja' : ''} <span class="muted">(${num(totalOrders)})</span></h3>
              ${orders.length ? html`<a class="cu-link" href="#/orders?customer=${cust.id}">Ver na lista de pedidos ${icon('arrowRight', 'icon-xs')}</a>` : ''}</div>
            ${orders.length
              ? html`<ul class="cu-olist">${orders.map((o) => {
                  const s = ctx.stores.find((x) => x.id === o.store_id);
                  return html`<li><a class="cu-orow" href="#/orders/${o.id}">
                    <span class="cu-orow__code"><span class="code">${o.code}</span><span class="sub">${whenShort(o.created_at)}</span></span>
                    ${network ? html`<span class="cu-orow__store">${s ? storeMark(s, 20) : ''}<span class="ellipsis">${ctx.storeShort?.(o.store_id) || ctx.storeName(o.store_id)}</span></span>` : ''}
                    <span class="cu-orow__pay" title="${PAYMENT_METHOD[o.payment_method] || o.payment_method}${Number(o.installments) > 1 ? ` · ${o.installments}x` : ''}"><span class="cu-orow__m">${icon(PAYMENT_ICON[o.payment_method] || 'wallet', 'icon-sm')}<span class="visually-hidden">${PAYMENT_METHOD[o.payment_method] || o.payment_method}${Number(o.installments) > 1 ? ` em ${o.installments}x` : ''}, </span></span>${payStatus(o.payment_status)}</span>
                    <span class="cu-orow__status">${badge(SHORT[o.status] || o.status, statusTone(o.status))}</span>
                    <span class="cu-orow__total"><strong class="${o.status === 'canceled' ? 'cu-strike' : ''}">${money(o.total)}</strong>${o.status === 'canceled' ? html`<span class="visually-hidden"> (cancelado, fora do total)</span>` : ''}</span>
                    <span class="cu-orow__go" aria-hidden="true">${icon('chevronRight', 'icon-sm')}</span>
                  </a></li>`;
                })}</ul>
                ${truncated ? html`<p class="muted small cu-note">Mostrando os ${num(orders.length)} pedidos mais recentes de ${num(totalOrders)}.</p>` : ''}`
              : empty('Nenhum pedido', 'Este cliente não tem pedidos nas lojas que você acompanha.', '', { art: false, icon: 'orders', size: 'sm' })}
          </section>
        </div>`,
      });
    } catch (e) {
      if (el.isConnected) panel.setContent({ body: html`<div class="cu-detail">${errorBlock(e, { retry: () => loadPanel(), title: 'Não foi possível abrir o cliente' })}</div>` });
    }
  };
  loadPanel();

  return panel;
}
const statusTone = (s) => ({ pending: 'warning', confirmed: 'info', preparing: 'plum', out_for_delivery: 'accent', delivered: 'success', canceled: 'danger' })[s] || '';

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

    const scope = () => (network ? 'Toda a rede' : ctx.store ? (ctx.store.city && !ctx.store.name.includes(ctx.store.city) ? `${ctx.store.name} · ${ctx.store.city}` : ctx.store.name) : '');
    const setHead = (total) => ctx.setTitle('Clientes', total === undefined ? 'Quem comprou, com histórico e contato' : `${scope()} · ${plural(total, 'cliente', 'clientes')}`);
    setHead();

    ctx.setActions(
      html`<button class="btn" type="button" data-cu-export title="Exporta a lista atual (até ${num(EXPORT_LIMIT)} clientes)">
        ${icon('download')}<span>Exportar CSV</span>
      </button>`
    );

    render(
      view,
      html`<div class="cu">
        <section class="card cu-card">
          <form class="toolbar cu-toolbar" data-search-form role="search" novalidate>
            <div class="search cu-search">
              ${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="cu-q">Buscar clientes</label>
              <input class="input" id="cu-q" name="q" type="search" value="${st.q}" placeholder="Nome, telefone ou e-mail" autocomplete="off" enterkeyhint="search">
              <span class="kbd kbd--sm cu-kbd" aria-hidden="true">/</span>
            </div>
            <span class="toolbar__spacer"></span>
            <span class="cu-summary" data-summary aria-live="polite"></span>
          </form>
          <div class="cu-results" data-results>${skeleton('list', { rows: 8 })}</div>
        </section>
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

    const emptyState = (searching) =>
      searching
        ? empty(
            'Nenhum cliente encontrado',
            `Nada com “${st.q.trim()}”${network ? '' : ` em ${ctx.storeShort?.(ctx.store) || ctx.storeName(ctx.storeId)}`}. Tente outro nome, telefone ou e-mail.`,
            html`<button class="btn" type="button" data-clear>${icon('close', 'icon-sm')} Limpar busca</button>`,
            { art: 'site:empty-search' }
          )
        : empty(
            'Ainda sem clientes',
            'Cada compra pela loja virtual cria o cliente aqui, com histórico e WhatsApp.',
            html`<a class="btn btn--dark" href="${network ? '/' : storefrontUrl(ctx.store?.slug || '')}" target="_blank" rel="noopener">${icon('external', 'icon-sm')} Ver loja virtual</a>`,
            { art: 'empty-orders', size: 'lg' }
          );

    const drawRows = ({ rows, total, capped }) => {
      st.rows = rows;
      st.total = total;
      const term = st.q.trim();
      const searching = !!term;
      render(
        $('[data-summary]', view),
        total
          ? html`<b>${num(total)}</b> ${total === 1 ? 'cliente' : 'clientes'}${searching ? (total === 1 ? ' encontrado' : ' encontrados') : ''}${capped ? html` <span class="cu-capped">(entre os 500 mais recentes)</span>` : ''}`
          : ''
      );
      if (!searching) setHead(total || undefined);
      if (!rows.length) {
        render(results, html`<div class="cu-empty">${emptyState(searching)}</div>`);
        return;
      }
      const hl = (text) => (searching && !isPhoneQuery(term) ? highlight(text, term) : text);
      render(
        results,
        html`<div class="table-wrap cu-tw"><table class="table cu-table">
          <caption class="visually-hidden">Clientes</caption>
          <thead><tr>
            <th scope="col">Cliente</th>
            <th scope="col">Contato</th>
            <th scope="col" class="num">Pedidos</th>
            <th scope="col" class="num">Total gasto</th>
            <th scope="col">Último pedido</th>
            ${network ? html`<th scope="col">Lojas</th>` : ''}
            <th scope="col" class="cu-c-go"><span class="visually-hidden">Abrir</span></th>
          </tr></thead>
          <tbody>${rows.map((r) => {
            const wa = waLink(r.phone);
            const n = Number(r.orders) || 0;
            const valid = Number(r.spent) || 0;
            return html`<tr class="is-clickable" data-id="${r.id}">
              <td class="cu-c-name"><span class="cu-person">${avatar(r.name, { size: 34 })}<span class="cu-person__txt">
                <button class="cu-name" type="button" data-open="${r.id}">${hl(r.name)}</button>
                <span class="sub">Desde ${date(r.created_at)}</span></span></span></td>
              <td class="cu-c-contact"><span class="cu-phone"><span class="mono-num">${fmtPhone(r.phone)}</span>
                ${wa ? html`<a class="btn btn--ghost btn--sm btn--icon cu-wa-icon" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp de ${r.name} (abre em nova aba)" data-tooltip="Conversar no WhatsApp">${icon('whatsapp', 'icon-sm')}</a>` : ''}</span>
                <span class="sub ellipsis cu-email" title="${r.email || ''}">${r.email ? hl(r.email) : 'Sem e-mail'}</span></td>
              <td class="num cu-c-orders"><span class="cell-strong">${num(n)}</span></td>
              <td class="num cu-c-spent"><span class="cell-strong">${money(valid)}</span>${n > 1 ? html`<span class="sub">ticket ${money(valid / n)}</span>` : ''}</td>
              <td class="cu-c-last" title="${datetime(r.last_order_at)}"><span>${relTime(r.last_order_at)}</span><span class="sub">${whenShort(r.last_order_at)}</span></td>
              ${network ? html`<td class="cu-c-stores">${storesCell(ctx, r.stores)}</td>` : ''}
              <td class="cu-c-go"><span class="cu-go" aria-hidden="true">${icon('chevronRight', 'icon-sm')}</span></td>
            </tr>`;
          })}</tbody>
        </table></div>
        <ul class="cu-cards">${rows.map((r) => {
          const wa = waLink(r.phone);
          return html`<li class="card m-card cu-mc" data-id="${r.id}">
            <div class="cu-mc__top">${avatar(r.name, { size: 40 })}<div class="cu-mc__id"><button class="cu-name" type="button" data-open="${r.id}">${hl(r.name)}</button><span class="sub mono-num">${fmtPhone(r.phone)}</span></div>
              ${wa ? html`<a class="btn btn--icon cu-wa-icon cu-mc__wa" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp de ${r.name} (abre em nova aba)">${icon('whatsapp')}</a>` : ''}</div>
            <div class="cu-mc__stats"><span><b>${num(r.orders)}</b> ${Number(r.orders) === 1 ? 'pedido' : 'pedidos'}</span><span><b>${money(r.spent)}</b></span><span>${relTime(r.last_order_at)}</span></div>
            ${network && (r.stores || []).length ? html`<div class="cu-mc__stores">${storesCell(ctx, r.stores)}</div>` : ''}
          </li>`;
        })}</ul>
        ${total > PAGE_SIZE ? pager({ page: st.page, pageSize: PAGE_SIZE, total }) : ''}`
      );
      const info = $('.pager__info', results);
      if (info) info.append(total === 1 ? ' cliente' : ' clientes');
    };

    async function load() {
      const my = ++token;
      syncUrl();
      if (!firstLoad) results.classList.add('is-busy');
      results.setAttribute('aria-busy', 'true');
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
        render(results, html`<div class="cu-empty">${errorBlock(e, { retry: () => load(), title: 'Não foi possível carregar os clientes' })}</div>`);
      } finally {
        if (my === token) {
          results.classList.remove('is-busy');
          results.removeAttribute('aria-busy');
          firstLoad = false;
        }
      }
    }

    const showCustomer = (id) => {
      if (openPanel) openPanel.close();
      const back = listHash();
      history.replaceState(null, '', `#/customers/${id}${back.includes('?') ? back.slice(back.indexOf('?')) : ''}`);
      const seed = st.rows.find((r) => r.id === id);
      const panel = openCustomerPanel(ctx, id, {
        seed,
        onClose: () => {
          if (openPanel === panel) openPanel = null;
          // ao seguir um link (#/orders/...), não reescreve o endereço de destino
          if (location.hash.startsWith(`#/customers/${id}`)) history.replaceState(null, '', back);
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
        const card = $('.cu-card', view);
        const top = card ? card.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 64) - 12 : 0;
        if (card && top < window.scrollY) window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
      const row = e.target.closest('tr[data-id], .cu-mc[data-id]');
      if (row && !window.getSelection()?.toString()) showCustomer(row.dataset.id);
    });

    // "/" foca a busca
    const onKey = (e) => {
      if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !view.isConnected) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]') || document.querySelector('.modal, .panel, .pop, .cmdk')) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKey);

    $('[data-actions] [data-cu-export]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await withBusy(btn, async () => {
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
          const slug = ctx.store ? ctx.store.slug : 'rede';
          downloadFile(`clientes-${slug}-${isoDay(new Date())}.csv`, toCSV(rows, columns));
          toast(
            capped ? `Exportados os ${num(rows.length)} clientes mais recentes (limite de ${num(EXPORT_LIMIT)}).` : `${plural(rows.length, 'cliente exportado', 'clientes exportados')}.`,
            capped ? 'warning' : 'success'
          );
        }, 'Exportando…');
      } catch (err) {
        toastError(err);
      }
    });

    // Pedido novo pode trazer cliente novo: atualiza a lista (sem mexer na gaveta aberta)
    ctx.on('new-order', () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        source.reset();
        load();
      }, 800);
    });
    ctx.onCleanup(() => {
      clearTimeout(reloadTimer);
      document.removeEventListener('keydown', onKey);
      if (openPanel) openPanel.close('navigate');
    });

    await load();
    const deep = ctx.args[0];
    if (deep && UUID_RE.test(deep)) showCustomer(deep);
  },
};

const CSS = `
.cu-card { overflow: visible; }
.cu-search { flex: 1 1 280px; max-width: 420px; }
.cu-search .input { padding-right: 36px; }
.cu-search .input::-webkit-search-cancel-button { display: none; }
.cu-summary { font-size: 13px; color: var(--muted); white-space: nowrap; }
.cu-summary b { color: var(--ink); font-weight: 600; }
.cu-capped { color: var(--muted); }
.cu-results { transition: opacity var(--dur-2); min-height: 120px; }
.cu-results.is-busy { opacity: .55; pointer-events: none; }
.cu-empty { padding: 12px 0 4px; }
.cu-person { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cu-person__txt { display: flex; flex-direction: column; min-width: 0; }
.cu-name { display: block; max-width: 240px; padding: 0; border: 0; background: none; color: var(--ink); font: 600 13.5px/1.3 var(--font-ui); text-align: left; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cu-name:hover { color: var(--accent-ink); text-decoration: underline; }
.cu-c-name { min-width: 220px; }
.cu-phone { display: inline-flex; align-items: center; gap: 2px; font-size: 13.5px; color: var(--ink); }
.cu-wa-icon .icon-sm, .cu-wa-icon .icon { color: #1f9d55; }
.cu-phone .cu-wa-icon { width: 28px; height: 28px; min-height: 0; margin: -4px 0; }
.cu-table mark, .cu-cards mark { background: color-mix(in srgb, var(--orange) 26%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.cu-wa-icon:hover { background: var(--ok-bg); }
.cu-email { max-width: 240px; }
.cu-c-last { white-space: nowrap; }
.cu-c-last > span:first-child { font-weight: 500; color: var(--ink); }
.cu-c-stores { min-width: 150px; max-width: 230px; }
.cu-stores { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.cu-stores .ellipsis { min-width: 0; }
.cu-marks { display: inline-flex; flex: none; }
.cu-more { flex: none; padding: 1px 7px; border-radius: 999px; background: var(--surface-3); color: var(--muted); font-size: 11.5px; font-weight: 600; }
.cu-c-go { width: 44px; text-align: right; }
.cu-go { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; color: var(--muted); }
.cu-table tr:hover .cu-go { background: var(--surface-3); color: var(--ink); }
.cu-cards { display: none; list-style: none; margin: 0; padding: 0; }

/* gaveta do cliente */
.cu-panel .modal__head { padding: 18px 18px 16px 24px; }
.cu-dh { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cu-dh__id { display: flex; align-items: center; gap: 14px; min-width: 0; }
.cu-dh__txt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cu-dh__name { font: 800 22px/1.15 var(--font-display); color: var(--ink); letter-spacing: -0.01em; overflow-wrap: anywhere; }
.cu-dh__sub { font-size: 13px; color: var(--muted); }
.cu-dh__acts { display: flex; flex-wrap: wrap; gap: 6px; }
.cu-wa .icon-sm { color: #1f9d55; }
.cu-detail { display: flex; flex-direction: column; gap: 14px; }
.cu-sk { margin-top: 14px; }
.cu-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cu-kpi { padding: 12px 14px; }
.cu-kpi .kpi__label { font-size: 12.5px; }
.cu-kpi .kpi__value { margin-top: 6px; font-size: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cu-kpi .kpi__sub { margin-top: 2px; font-size: 12px; }
.cu-kv { display: grid; gap: 10px; margin: 0; }
.cu-kv > div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.cu-kv dt { font-size: 12.5px; color: var(--muted); }
.cu-kv dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; overflow-wrap: anywhere; font-size: 13.5px; color: var(--ink); }
.cu-kv__stores { gap: 6px !important; }
.cu-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px 0 4px; border-radius: 999px; background: var(--surface-3); font-size: 12.5px; font-weight: 600; color: var(--text); }
.cu-link { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; }
.cu-olist { list-style: none; margin: 0 -8px; padding: 0; }
.cu-olist li + li { border-top: 1px solid var(--line); }
.cu-orow { display: grid; grid-template-columns: minmax(96px, 1fr) minmax(0, 1fr) auto minmax(86px, auto) 22px; align-items: center; gap: 10px; padding: 10px 8px; border-radius: 10px; color: inherit; text-decoration: none; }
.cu-panel .cu-orow:has(.cu-orow__store) { grid-template-columns: minmax(96px, .9fr) minmax(0, 1.1fr) minmax(0, 1fr) auto minmax(86px, auto) 22px; }
.cu-orow:hover { background: var(--surface-2); text-decoration: none; }
.cu-orow__code { display: flex; flex-direction: column; min-width: 0; }
.cu-orow__code .code { font-size: 13.5px; }
.cu-orow__store { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; color: var(--text); }
.cu-orow__pay { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cu-orow__m { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--surface-3); color: var(--muted); flex: none; }
.cu-orow__m .icon-sm { width: 14px; height: 14px; }
.cu-orow__total { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cu-orow__total strong { color: var(--ink); font-weight: 600; }
.cu-orow__go { color: var(--muted); display: grid; place-items: center; }
.cu-strike { text-decoration: line-through; color: var(--muted) !important; }
.cu-note { padding: 10px 0 0; border-top: 1px solid var(--line); margin-top: 6px; }

@media (max-width: 1100px) {
  .cu-table .cu-c-stores, .cu-table thead th:nth-child(6) { display: none; }
}
@media (max-width: 900px) {
  .cu-email { max-width: 180px; }
}
@media (max-width: 767px) {
  .cu-card { background: transparent; border: 0; box-shadow: none; }
  .card > .cu-toolbar { padding: 0 0 12px; border-bottom: 0; }
  .cu-search { flex: 1 1 100%; max-width: none; }
  .cu-kbd { display: none; }
  .cu-summary { width: 100%; }
  .cu-toolbar .toolbar__spacer { display: none; }
  .cu-tw { display: none; }
  .cu-cards { display: flex; flex-direction: column; gap: 10px; }
  .cu-mc { gap: 10px; cursor: pointer; }
  .cu-mc__top { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .cu-mc__id { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .cu-mc__id .cu-name { max-width: 100%; font-size: 15px; }
  .cu-mc__wa { width: 44px; height: 44px; flex: none; }
  .cu-mc__stats { display: flex; flex-wrap: wrap; gap: 4px 14px; padding-top: 10px; border-top: 1px dashed var(--line-strong); font-size: 13px; color: var(--muted); }
  .cu-mc__stats b { color: var(--ink); font-weight: 600; }
  .cu-mc__stats > span:last-child { margin-left: auto; }
  .cu-card .pager { padding: 14px 0 0; border-top: 0; }
  .cu-empty { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-card); }
  .cu-panel .modal__head { padding: 14px 12px 14px 16px; }
  .cu-dh__name { font-size: 20px; }
  .cu-dh__acts .btn { height: 40px; flex: 1 1 auto; }
  .cu-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cu-orow, .cu-panel .cu-orow:has(.cu-orow__store) { grid-template-columns: minmax(0, 1fr) auto 18px; grid-template-areas: "code total go" "pay status go" "store store go"; gap: 6px 10px; }
  .cu-orow__code { grid-area: code; }
  .cu-orow__total { grid-area: total; }
  .cu-orow__pay { grid-area: pay; }
  .cu-orow__status { grid-area: status; justify-self: end; }
  .cu-orow__store { grid-area: store; }
  .cu-orow__go { grid-area: go; }
}
`;
