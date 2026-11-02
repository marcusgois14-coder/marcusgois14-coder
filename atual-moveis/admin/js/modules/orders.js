// Pedidos: lista (abas de status, busca, loja, forma e status do pagamento, período, densidade, ordenação,
// paginação, seleção em lote, CSV, romaneio do dia, tempo real) e detalhe — gaveta larga sobre a lista
// (≥ 768 px) ou página inteira (#/orders/<id>, e sempre no celular): andamento, PIX, itens, cliente, entrega,
// histórico com notas, status, cancelamento, pagamento, agendamento e impressão do romaneio.
//
// Rotas: #/orders  ·  #/orders/<id>
// Parâmetros aceitos na lista (para links de outros módulos):
//   ?status=pending|confirmed|preparing|out_for_delivery|delivered|canceled
//   ?q=<nº do pedido, nome, telefone ou e-mail>  ?phone=<telefone>  ?customer=<uuid do cliente>
//   ?from=AAAA-MM-DD  ?to=AAAA-MM-DD  ?pay=pending|paid|refunded|failed  ?method=pix|card_on_delivery|cash|crediario|card_link
//   ?store=<uuid>[,<uuid>…] (visão da rede)  ?sort=old|new  ?page=N
import { sb, q, rpc, mediaUrl, ApiError, storefrontUrl } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, money, num, datetime, date, phone as fmtPhone, cep as fmtCep, isoDay, dayStart,
  dayEnd, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_ICON, PAYMENT_STATUS, statusBadge, badge, openModal, confirmDialog, promptDialog,
  showErrors, withBusy, empty, errorBlock, pager, skeleton, toCSV, downloadFile, injectStyle, debounce, drawer, storeMark, ageChip,
  AGE, segmented, dateRange, rangeLabel, presetRange, RANGE_PRESETS, pushLayer, popLayer,
} from '../ui.js';

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 2000;
const PRINT_LIMIT = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const SP = 'America/Sao_Paulo';
const DENSITY_KEY = 'atual-admin-density:orders';
const SEEN_KEY = 'atual-admin-seen-orders';

const LIST_COLS =
  'id,code,number,created_at,updated_at,customer_name,customer_phone,total,status,payment_method,payment_status,installments,store_id,city,state,district,distance_km,scheduled_date,order_items(quantity)';
const EXPORT_COLS =
  'code,created_at,store_id,status,customer_name,customer_phone,customer_email,cep,street,address_number,complement,district,city,state,distance_km,payment_method,installments,payment_status,subtotal,coupon_code,discount_coupon,discount_pix,delivery_fee,total,scheduled_date,source';

// [status, rótulo da aba, tom do ponto]
const TABS = [
  ['', 'Todos', ''],
  ['pending', 'Novos', 'warn'],
  ['confirmed', 'Confirmados', 'info'],
  ['preparing', 'Em separação', 'plum'],
  ['out_for_delivery', 'Em rota', 'ora'],
  ['delivered', 'Entregues', 'ok'],
  ['canceled', 'Cancelados', 'bad'],
];
const FLOW = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const CLOSED = ['delivered', 'canceled'];
const SHORT = { pending: 'Novo', confirmed: 'Confirmado', preparing: 'Em separação', out_for_delivery: 'Em rota', delivered: 'Entregue', canceled: 'Cancelado' };
const TONE_OF = { pending: 'warn', confirmed: 'info', preparing: 'plum', out_for_delivery: 'ora', delivered: 'ok', canceled: 'bad' };
const STEPS = ['Recebido', 'Confirmação', 'Em separação', 'Em rota', 'Entregue'];
const STEP_NOTE = {
  pending: 'aguardando a loja confirmar',
  confirmed: 'confirmado, aguardando a separação',
  preparing: 'itens em separação',
  out_for_delivery: 'a caminho do cliente',
  delivered: 'pedido entregue',
};
const NEXT = {
  pending: { status: 'confirmed', label: 'Confirmar pedido', short: 'Confirmar', icon: 'check' },
  confirmed: { status: 'preparing', label: 'Iniciar separação', short: 'Iniciar separação', icon: 'box' },
  preparing: { status: 'out_for_delivery', label: 'Saiu para entrega', short: 'Saiu para entrega', icon: 'truck' },
  out_for_delivery: { status: 'delivered', label: 'Marcar como entregue', short: 'Entregue', icon: 'checkCircle' },
};
// opções do "Mudar status": [rótulo, consequência]
const MOVE = {
  pending: ['Novo', 'Volta para “Aguardando confirmação”'],
  confirmed: ['Confirmado', 'Pedido aceito pela loja'],
  preparing: ['Em separação', 'Itens sendo separados no estoque'],
  out_for_delivery: ['Saiu para entrega', 'Cliente vê “a caminho” no acompanhamento'],
  delivered: ['Entregue', 'Fecha o pedido'],
};
const DONE_WORD = { pending: 'voltou para Novo', confirmed: 'confirmado', preparing: 'em separação', out_for_delivery: 'saiu para entrega', delivered: 'entregue', canceled: 'cancelado' };
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
const PAY_ICON_S = { pending: 'clock', paid: 'checkCircle', refunded: 'undo', failed: 'xCircle' };
const PAY_TONE = { pending: 'warn', paid: 'ok', refunded: 'neu', failed: 'bad' };
const PAY_ACTIONS = [
  ['paid', 'Marcar como pago', 'checkCircle'],
  ['pending', 'Marcar como pendente', 'clock'],
  ['refunded', 'Marcar como estornado', 'undo'],
  ['failed', 'Marcar como não aprovado', 'xCircle'],
];
const WA_LINES = {
  pending: 'Recebemos o seu pedido e vamos confirmar os detalhes da entrega com você.',
  confirmed: 'Seu pedido foi confirmado e logo entra em separação.',
  preparing: 'Seu pedido está em separação e em breve sai para entrega.',
  out_for_delivery: 'Seu pedido saiu para entrega e deve chegar em breve.',
  delivered: 'Esperamos que esteja tudo certo com a sua compra.',
  canceled: 'Gostaríamos de falar com você sobre o cancelamento do seu pedido.',
};
const CANCEL_REASONS = ['Cliente desistiu da compra', 'Sem estoque', 'Fora da área de entrega', 'Pagamento não aprovado', 'Pedido duplicado', 'Outro motivo'];
const EMPTY_WORD = { confirmed: 'confirmado', preparing: 'em separação', out_for_delivery: 'em rota', delivered: 'entregue', canceled: 'cancelado' };
const PERIOD_PHRASE = { today: ' hoje', yesterday: ' ontem', '7d': ' nos últimos 7 dias', '30d': ' nos últimos 30 dias', thisMonth: ' neste mês', lastMonth: ' no mês passado', thisYear: ' neste ano' };
const PRESET_SHORT = { today: 'Hoje', yesterday: 'Ontem', '7d': '7 dias', '30d': '30 dias', thisMonth: 'Este mês', lastMonth: 'Mês passado', thisYear: 'Este ano' };

// Lembra a última lista (com filtros) para o "voltar" do detalhe
let lastListHash = '#/orders';
let lastListStore;

/* ---------- Utilitários ---------- */
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const km = (v) => (v === null || v === undefined ? '' : `${String(Number(v).toFixed(1)).replace('.', ',')} km`);
const csvNum = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const dateBR = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '');
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
// rola até o início do cartão, descontando o topo fixo
function scrollToTop(el) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 64) - 12;
  if (top < window.scrollY) window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
const spDay = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: SP });
const hhmm = (v) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' });
const minsSince = (v) => (Date.now() - new Date(v).getTime()) / 60000;
const itemQty = (list) => (list || []).reduce((a, i) => a + (Number(i.quantity) || 0), 0);
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const brDay = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '');
const brFull = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');
const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
const statusPill = (s) => badge(SHORT[s] || s, ORDER_STATUS[s]?.tone);

// "Hoje, 09:14" · "Ontem, 17:40" · "31/10, 16:25" · "31/10/2025, 16:25"
function whenShort(v) {
  if (!v) return '—';
  const d = spDay(v);
  const today = spDay(Date.now());
  if (d === today) return `Hoje, ${hhmm(v)}`;
  if (d === spDay(Date.now() - 86400000)) return `Ontem, ${hhmm(v)}`;
  return `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) !== today.slice(0, 4) ? `/${d.slice(0, 4)}` : ''}, ${hhmm(v)}`;
}
// "qui, 05/11"
function dayLabel(ymd) {
  if (!ymd) return '';
  const dt = new Date(`${ymd}T12:00:00-03:00`);
  return `${dt.toLocaleDateString('pt-BR', { timeZone: SP, weekday: 'short' }).replace('.', '')}, ${brDay(ymd)}`;
}

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
};
// Pedidos já abertos neste aparelho ("novo, ainda não aberto")
let seenCache = null;
function seenSet() {
  if (!seenCache) {
    try {
      seenCache = new Set(JSON.parse(lsGet(SEEN_KEY) || '[]'));
    } catch {
      seenCache = new Set();
    }
  }
  return seenCache;
}
function markSeen(id) {
  const s = seenSet();
  if (s.has(id)) return;
  s.add(id);
  const arr = [...s].slice(-400);
  seenCache = new Set(arr);
  lsSet(SEEN_KEY, JSON.stringify(arr));
}
const isFresh = (o, fresh) => fresh.has(o.id) || (o.status === 'pending' && !seenSet().has(o.id) && minsSince(o.created_at) < 2 * 1440);

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
const storeOf = (ctx, id) => ctx.stores.find((s) => s.id === id) || null;
const shortName = (ctx, id) => ctx.storeShort?.(id) || ctx.storeName(id);
function storeAddress(s) {
  if (!s) return '';
  const line1 = [s.street, s.number].filter(Boolean).join(', ');
  return [line1, s.district, s.city && `${s.city}/${s.state || 'MG'}`, s.cep && `CEP ${fmtCep(s.cep)}`].filter(Boolean).join(' · ');
}
const trackUrl = (o) => `${location.origin}/pedido/${o.tracking_token}`;
function waUrl(ctx, o) {
  const d = digitsOf(o.customer_phone);
  if (d.length < 10) return '';
  const store = storeOf(ctx, o.store_id);
  const msg = `Olá, ${firstName(o.customer_name)}! Aqui é da ${store?.name || ctx.storeName(o.store_id)}. Sobre o seu pedido ${o.code}: ${WA_LINES[o.status] || ''}\nAcompanhe por aqui: ${trackUrl(o)}\nQualquer dúvida, é só responder esta mensagem.`;
  return `https://wa.me/55${d}?text=${encodeURIComponent(msg)}`;
}
// Abre o WhatsApp depois de uma ação; se o navegador bloquear a nova aba, oferece o link num aviso.
function openWhatsApp(ctx, o) {
  const url = waUrl(ctx, o);
  if (!url) return;
  const w = window.open(url, '_blank', 'noopener');
  if (!w) toast('Toque para abrir a conversa com a mensagem pronta.', 'info', 8000, { title: 'Avisar pelo WhatsApp', action: { label: 'Abrir WhatsApp', onClick: () => window.open(url, '_blank', 'noopener') } });
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

// Botão em estado "ocupado" com outro texto (ex.: "Gerando…")
async function busy(btn, label, task) {
  if (!btn) return task();
  return withBusy(btn, task, label);
}

/* ---------- Pagamento e status (peças pequenas) ---------- */
const payStatus = (s, { long = false } = {}) =>
  html`<span class="pay__s t-${PAY_TONE[s] || 'neu'}">${icon(PAY_ICON_S[s] || 'info', 'icon-xs')}${long ? PAYMENT_STATUS[s]?.label || s : PAY_SHORT[s] || s}</span>`;
const payMethod = (o) =>
  html`<span class="pay__m">${icon(PAYMENT_ICON[o.payment_method] || 'wallet', 'icon-sm')}<span class="ellipsis">${PAYMENT_METHOD[o.payment_method] || o.payment_method}${
    Number(o.installments) > 1 ? ` · ${o.installments}x` : ''
  }</span></span>`;
const payCell = (o) => html`<div class="pay">${payMethod(o)}${payStatus(o.payment_status)}</div>`;

/* ---------- Popover ancorado (menus, "Mudar status") ---------- */
function openPop(anchor, { content, label, cls = '', role = 'dialog', onMount, onClose } = {}) {
  anchor._ordPop?.close({ focus: false });
  const pop = document.createElement('div');
  pop.className = `pop ord-pop ${cls}`;
  pop.setAttribute('role', role);
  if (label) pop.setAttribute('aria-label', label);
  render(pop, content);
  document.body.appendChild(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    pop.style.maxHeight = `${vh - 16}px`;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    let top = below >= ph + 6 || below >= above ? r.bottom + 6 : r.top - 6 - ph;
    top = Math.max(8, Math.min(top, vh - 8 - ph));
    let left = r.left;
    if (left + pw > vw - 8) left = r.right - pw;
    left = Math.max(8, Math.min(left, vw - 8 - pw));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.dataset.side = top < r.top ? 'top' : 'bottom';
  };
  place();
  anchor.setAttribute('aria-expanded', 'true');
  let closed = false;
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) api.close({ focus: false });
  };
  const onScroll = (e) => {
    if (!pop.contains(e.target)) place();
  };
  const api = {
    el: pop,
    place,
    close({ focus = true } = {}) {
      if (closed) return;
      closed = true;
      popLayer(pop);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      anchor.setAttribute('aria-expanded', 'false');
      if (anchor._ordPop === api) anchor._ordPop = null;
      pop.remove();
      if (focus && anchor.isConnected) anchor.focus({ preventScroll: true });
      onClose?.();
    },
  };
  anchor._ordPop = api;
  pushLayer(pop, { onEscape: () => api.close() });
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', onScroll, true);
  pop.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== anchor) api.close({ focus: false });
  });
  // setas e Home/End entre as opções
  pop.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.target.matches('input, textarea')) return;
    const list = $$('button.opt:not([disabled])', pop);
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    list[next].focus();
  });
  onMount?.(pop, api);
  return api;
}
const togglePop = (anchor, open) => (anchor._ordPop ? anchor._ordPop.close() : open());

// Menu simples: itens [{ label, icon, hint, danger, disabled, onClick }] ou 'sep'
function popMenu(anchor, { label, title, items }) {
  return openPop(anchor, {
    label,
    role: 'menu',
    cls: 'ord-menu',
    content: html`${title ? html`<div class="pop__group-label">${title}</div>` : ''}${items.map((it, i) =>
      it === 'sep'
        ? html`<div class="pop__sep" role="separator"></div>`
        : html`<button type="button" class="opt ${it.hint ? 'opt--2l' : ''} ${it.danger ? 'ord-opt--danger' : ''}" role="menuitem" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
            ${icon(it.icon || 'chevronRight', 'icon-sm')}<span class="opt__body"><span class="opt__label">${it.label}</span>${it.hint ? html`<span class="opt__hint">${it.hint}</span>` : ''}</span>
          </button>`
    )}`,
    onMount(pop, api) {
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b || b.disabled) return;
        api.close();
        items[Number(b.dataset.i)].onClick?.();
      });
      setTimeout(() => $('button.opt:not([disabled])', pop)?.focus(), 0);
    },
  });
}

/* ---------- Ações de status (detalhe, lote, cartões) ---------- */
const canReopen = (ctx, o) => ctx.can('settings', o.store_id);
const undoAllowed = (ctx, o, prev, next) => next !== 'canceled' && prev !== 'canceled' && (next !== 'delivered' || canReopen(ctx, o));

// Muda o status de um pedido; mostra o aviso com "Desfazer" quando dá para voltar.
async function moveOrder(ctx, o, status, { message = null, visible = true, onDone, btn } = {}) {
  const prev = o.status;
  const task = () => rpc('update_order_status', { p_order: o.id, p_status: status, p_message: message || null, p_visible: visible });
  try {
    if (btn) await withBusy(btn, task, 'Salvando…');
    else await task();
  } catch (e) {
    toastError(e);
    return false;
  }
  const word = status === 'pending' && CLOSED.includes(prev) ? 'reaberto' : DONE_WORD[status];
  const extra = status !== 'canceled' && visible ? `${firstName(o.customer_name)} já vê a nova etapa no link do pedido.` : '';
  const undo = undoAllowed(ctx, o, prev, status)
    ? {
        label: 'Desfazer',
        onClick: async () => {
          try {
            await rpc('update_order_status', {
              p_order: o.id,
              p_status: prev,
              p_message: prev === 'pending' && status === 'confirmed' ? 'Confirmação desfeita' : 'Alteração desfeita',
              p_visible: false,
            });
            toast(`Pedido ${o.code} voltou para “${SHORT[prev]}”.`, 'info');
          } catch (e) {
            toastError(e);
          }
          onDone?.();
        },
      }
    : undefined;
  const title = `Pedido ${o.code} ${word}`;
  toast(extra || title, 'success', undo ? 6000 : 3800, extra ? { title, action: undo } : { action: undo });
  onDone?.();
  return true;
}

// Vários pedidos em sequência, com progresso e resumo.
async function runBulk(ctx, orders, status, { visible = true, message = null, onDone } = {}) {
  const list = orders.filter((o) => o.status !== status);
  const label = status === 'canceled' ? 'Cancelado' : MOVE[status][0];
  if (!list.length) {
    toast(`${orders.length === 1 ? 'O pedido já está' : 'Os pedidos já estão'} em “${label}”.`, 'info');
    return;
  }
  const n = list.length;
  const prog = toast(`Movendo 1 de ${n}…`, 'info', 0, { title: `Mudando ${plural(n, 'pedido', 'pedidos')}` });
  const setMsg = (t) => {
    const m = prog?.el?.querySelector('.toast__msg');
    if (m) m.textContent = t;
  };
  const ok = [];
  const fail = [];
  for (let i = 0; i < n; i++) {
    const o = list[i];
    setMsg(`Movendo ${i + 1} de ${n}…`);
    try {
      await rpc('update_order_status', { p_order: o.id, p_status: status, p_message: message || null, p_visible: visible });
      ok.push({ o, prev: o.status });
    } catch (e) {
      fail.push({ o, e });
    }
  }
  prog?.close();
  const moved = status === 'canceled' ? plural(ok.length, 'pedido cancelado', 'pedidos cancelados') : `${plural(ok.length, 'pedido movido', 'pedidos movidos')} para ${label}`;
  if (ok.length) {
    const undoable = ok.filter(({ o, prev }) => undoAllowed(ctx, o, prev, status));
    const undo =
      undoable.length === ok.length
        ? {
            label: 'Desfazer',
            onClick: async () => {
              let bad = 0;
              for (const { o, prev } of undoable) {
                try {
                  await rpc('update_order_status', { p_order: o.id, p_status: prev, p_message: 'Alteração desfeita', p_visible: false });
                } catch {
                  bad += 1;
                }
              }
              if (bad) toast(`${plural(bad, 'pedido não pôde', 'pedidos não puderam')} voltar ao status anterior.`, 'warning', 6000);
              else toast('Alteração desfeita.', 'info');
              onDone?.();
            },
          }
        : undefined;
    if (!fail.length) {
      if (visible && status !== 'canceled') toast('Cada cliente vê a nova etapa no link do pedido.', 'success', undo ? 6000 : 4000, { title: moved, action: undo });
      else toast(moved, 'success', undo ? 6000 : 4000, { action: undo });
    }
  }
  if (fail.length) {
    const first = fail[0].e instanceof Error ? fail[0].e.message : String(fail[0].e);
    toast(`${fail.length === 1 ? `${fail[0].o.code} não pôde ser movido` : `${fail.length} não puderam ser movidos`}: ${first}`, 'error', 9000, {
      title: ok.length ? moved : 'Nenhum pedido foi movido',
    });
  }
  onDone?.();
}

// Diálogo de cancelamento (motivo obrigatório). Para um ou vários pedidos.
function cancelDialog(ctx, orders, { items, onDone } = {}) {
  const single = orders.length === 1 ? orders[0] : null;
  const phoneOk = single && digitsOf(single.customer_phone).length >= 10;
  const qty = items ? itemQty(items) : 0;
  const copy = single
    ? `${qty ? `${qty === 1 ? 'O item volta' : `Os ${num(qty)} itens voltam`} ao estoque de ${shortName(ctx, single.store_id)}` : 'Os itens voltam ao estoque'} e ${firstName(single.customer_name)} vê o cancelamento no link do pedido.${
        single.payment_status === 'paid' ? ' O pagamento passa para estornado.' : ''
      } Dá para reabrir depois.`
    : 'Os itens voltam ao estoque e cada cliente vê o cancelamento no link do pedido. Dá para reabrir depois.';
  openModal({
    title: single ? `Cancelar o pedido ${single.code}?` : `Cancelar ${num(orders.length)} pedidos?`,
    role: 'alertdialog',
    icon: 'alert',
    tone: 'danger',
    cls: 'ord-cancel',
    body: html`<p class="ord-cancel__copy">${copy}</p>
      <form class="ord-cancel__form" data-cancel-form novalidate>
        <div class="field">
          <label for="oc-reason">Motivo</label>
          <select class="select" id="oc-reason" name="reason" required data-placeholder="Escolha o motivo">
            <option value="">Escolha o motivo</option>
            ${CANCEL_REASONS.map((r) => html`<option value="${r}">${r}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="label" for="oc-details"><span>Detalhes</span><span class="opt-tag">opcional</span></label>
          <textarea class="textarea" id="oc-details" name="details" rows="2" maxlength="400" placeholder="Ex.: cliente vai comprar na loja física"></textarea>
        </div>
        ${phoneOk
          ? html`<label class="switch"><input type="checkbox" name="wa" checked><span class="switch__track"></span>
              <span class="switch__txt"><strong>Avisar pelo WhatsApp</strong><span class="ord-block">Abre o WhatsApp com a mensagem pronta para ${fmtPhone(single.customer_phone)}</span></span></label>`
          : ''}
      </form>`,
    actions: html`<button class="btn" type="button" data-close data-initial-focus>Voltar</button>
      <button class="btn btn--danger" type="button" data-ok>${icon('xCircle', 'icon-sm')} ${single ? 'Cancelar pedido' : 'Cancelar pedidos'}</button>`,
    onMount(el, close) {
      const form = $('[data-cancel-form]', el);
      const submit = async () => {
        const reason = form.reason.value;
        const details = form.details.value.trim();
        const errors = {};
        if (!reason) errors.reason = 'Escolha o motivo do cancelamento.';
        else if (reason === 'Outro motivo' && !details) errors.details = 'Conte o motivo em poucas palavras.';
        if (!showErrors(form, errors)) return;
        const message = (reason === 'Outro motivo' ? details : details ? `${reason}: ${details}` : reason).slice(0, 500);
        const wa = !!form.wa?.checked;
        if (single) {
          const done = await moveOrder(ctx, single, 'canceled', { message, visible: true, btn: $('[data-ok]', el), onDone });
          if (!done) return;
          close();
          if (wa) openWhatsApp(ctx, { ...single, status: 'canceled' });
        } else {
          close();
          await runBulk(ctx, orders, 'canceled', { message, visible: true, onDone });
        }
      };
      $('[data-ok]', el).addEventListener('click', submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit();
      });
    },
  });
}

// Opções de status para um pedido (ou vários)
function moveTargets(orders) {
  const single = orders.length === 1 ? orders[0] : null;
  return single ? FLOW.filter((s) => s !== single.status) : FLOW.slice(1);
}
function moveLabel(s, cur) {
  if (s === 'pending' && CLOSED.includes(cur)) return ['Reabrir como novo', cur === 'canceled' ? 'Os itens voltam a sair do estoque' : 'Volta para “Aguardando confirmação”'];
  return MOVE[s];
}

// "Mudar status" no computador: popover com 1–4, cancelamento e "mostrar no acompanhamento"
function statusPop(anchor, ctx, orders, { items, onDone } = {}) {
  const single = orders.length === 1 ? orders[0] : null;
  const cur = single?.status;
  const locked = orders.some((o) => CLOSED.includes(o.status) && !canReopen(ctx, o)) && !!single;
  const targets = moveTargets(orders);
  const title = single ? `Mover ${single.code} para` : `Mover ${plural(orders.length, 'pedido', 'pedidos')} para`;
  return openPop(anchor, {
    label: title,
    cls: 'ord-statuspop',
    content: html`<div class="pop__group-label">${title}</div>
      ${locked ? html`<p class="ord-pop__note">${icon('lock', 'icon-xs')} Somente o administrador da loja reabre pedidos entregues ou cancelados.</p>` : ''}
      ${targets.map((s, i) => {
        const [l, h] = moveLabel(s, cur);
        return html`<button type="button" class="opt opt--2l" data-to="${s}" aria-keyshortcuts="${i + 1}" ${locked ? 'disabled' : ''}>
          <span class="dot t-${TONE_OF[s]}" aria-hidden="true"></span><span class="opt__body"><span class="opt__label">${l}</span><span class="opt__hint">${h}</span></span><span class="kbd kbd--sm" aria-hidden="true">${i + 1}</span>
        </button>`;
      })}
      ${cur !== 'canceled'
        ? html`<div class="pop__sep" role="separator"></div>
          <button type="button" class="opt opt--2l ord-opt--danger" data-to="canceled" ${locked ? 'disabled' : ''}>
            <span class="opt__icon ord-opt__ico--bad" aria-hidden="true">${icon('xCircle', 'icon-sm')}</span><span class="opt__body"><span class="opt__label">${single ? 'Cancelar pedido…' : 'Cancelar pedidos…'}</span><span class="opt__hint">Pede o motivo antes</span></span>
          </button>`
        : ''}
      <div class="pop__foot ord-pop__foot">
        <label class="switch"><input type="checkbox" data-visible checked><span class="switch__track"></span>
          <span class="switch__txt"><strong>${single ? 'Mostrar no acompanhamento do cliente' : 'Mostrar no acompanhamento dos clientes'}</strong><span class="ord-block">${single ? 'O cliente vê a nova etapa no link do pedido' : 'Cada cliente vê a nova etapa no link do pedido'}</span></span></label>
        ${single ? html`<input class="input ord-pop__msg" data-msg maxlength="500" placeholder="Mensagem no histórico (opcional)" aria-label="Mensagem no histórico (opcional)">` : ''}
      </div>`,
    onMount(pop, api) {
      const choose = async (s) => {
        const visible = $('[data-visible]', pop).checked;
        const message = $('[data-msg]', pop)?.value.trim() || null;
        api.close();
        if (s === 'canceled') return cancelDialog(ctx, orders, { items, onDone });
        if (single) {
          if (s === 'delivered' && !canReopen(ctx, single)) {
            const ok = await confirmDialog({
              title: `Marcar ${single.code} como entregue?`,
              message: 'Depois disso, só o administrador da loja pode reabrir este pedido.',
              confirmLabel: 'Marcar como entregue',
            });
            if (!ok) return;
          }
          return moveOrder(ctx, single, s, { message, visible, onDone });
        }
        return runBulk(ctx, orders, s, { visible, onDone });
      };
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-to]');
        if (b && !b.disabled) choose(b.dataset.to);
      });
      pop.addEventListener('keydown', (e) => {
        if (e.target.matches('input:not([type="checkbox"]), textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
        const n = Number(e.key);
        if (n >= 1 && n <= targets.length && !locked) {
          e.preventDefault();
          choose(targets[n - 1]);
        }
      });
      const msg = $('[data-msg]', pop);
      if (msg) {
        const upd = () => {
          const a = document.activeElement?.closest?.('[data-to]');
          msg.placeholder = a && DEFAULT_MSG[a.dataset.to] ? `Sem texto: “${DEFAULT_MSG[a.dataset.to]}”` : 'Mensagem no histórico (opcional)';
        };
        pop.addEventListener('focusin', upd);
        msg.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') e.preventDefault();
        });
      }
      setTimeout(() => $('button.opt:not([disabled])', pop)?.focus(), 0);
    },
  });
}

// "Mudar status" no celular: folha com opções em rádio, aviso pelo WhatsApp e ação fixa
function statusSheet(ctx, o, { items, onDone } = {}) {
  const locked = CLOSED.includes(o.status) && !canReopen(ctx, o);
  const targets = moveTargets([o]);
  const def = NEXT[o.status]?.status || targets[0];
  const phoneOk = digitsOf(o.customer_phone).length >= 10;
  openModal({
    title: 'Mudar status',
    size: 'sm',
    cls: 'ord-sheet',
    body: html`<p class="ord-sheet__sub"><span class="code">${o.code}</span> · ${o.customer_name}</p>
      ${locked ? html`<div class="alert alert--warning">${icon('lock')}<div>Somente o administrador da loja reabre pedidos entregues ou cancelados.</div></div>` : ''}
      <div class="ord-radios" role="radiogroup" aria-label="Novo status">
        ${targets.map((s) => {
          const [l, h] = moveLabel(s, o.status);
          return html`<label class="ord-radio"><span class="dot t-${TONE_OF[s]}" aria-hidden="true"></span>
            <span class="ord-radio__t"><strong>${l}</strong><span>${h}</span></span>
            <input type="radio" name="to" value="${s}" ${s === def ? 'checked' : ''} ${locked ? 'disabled' : ''}></label>`;
        })}
        ${o.status !== 'canceled'
          ? html`<button type="button" class="ord-radio ord-radio--danger" data-cancel-row ${locked ? 'disabled' : ''}><span class="dot t-bad" aria-hidden="true"></span>
              <span class="ord-radio__t"><strong>Cancelar pedido…</strong><span>Pede o motivo antes</span></span>${icon('chevronRight', 'icon-sm')}</button>`
          : ''}
      </div>
      ${phoneOk
        ? html`<label class="switch ord-sheet__wa"><input type="checkbox" data-wa checked><span class="switch__track"></span>
            <span class="switch__txt"><strong>Avisar pelo WhatsApp</strong><span class="ord-block">Abre a conversa com a mensagem pronta</span></span></label>`
        : ''}`,
    actions: html`<button class="btn btn--primary btn--lg ord-sheet__go" type="button" data-sheet-go ${locked ? 'disabled' : ''}>Mover para ${moveLabel(def, o.status)[0]}</button>`,
    onMount(el, close) {
      const go = $('[data-sheet-go]', el);
      el.addEventListener('change', (e) => {
        if (e.target.name === 'to') go.textContent = `Mover para ${moveLabel(e.target.value, o.status)[0]}`;
      });
      $('[data-cancel-row]', el)?.addEventListener('click', () => {
        close();
        cancelDialog(ctx, [o], { items, onDone });
      });
      go.addEventListener('click', async () => {
        const s = $('input[name="to"]:checked', el)?.value;
        if (!s) return;
        if (s === 'delivered' && !canReopen(ctx, o)) {
          const ok = await confirmDialog({ title: `Marcar ${o.code} como entregue?`, message: 'Depois disso, só o administrador da loja pode reabrir este pedido.', confirmLabel: 'Marcar como entregue' });
          if (!ok) return;
        }
        const wa = !!$('[data-wa]', el)?.checked;
        const done = await moveOrder(ctx, o, s, { visible: true, btn: go, onDone });
        if (!done) return;
        close();
        if (wa) openWhatsApp(ctx, { ...o, status: s });
      });
    },
  });
}

/* ---------- Romaneio (impressão) ---------- */
function printSheet(o, items, store, ctx) {
  const qty = itemQty(items);
  return html`<section class="op-sheet">
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
        <div class="op-small">Impresso em ${datetime(new Date())}</div>
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
  </section>`;
}
// Imprime um ou mais romaneios (uma página por pedido)
function printOrders(ctx, list) {
  $$('.ord-print').forEach((n) => n.remove());
  const root = document.createElement('div');
  root.className = 'ord-print';
  root.setAttribute('aria-hidden', 'true');
  render(root, list.map(({ order, items }) => printSheet(order, items, storeOf(ctx, order.store_id), ctx)));
  document.body.appendChild(root);
  document.body.classList.add('ord-printing');
  const done = () => {
    document.body.classList.remove('ord-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
async function fetchForPrint(ids) {
  const [orders, items] = await Promise.all([
    q(sb.from('orders').select('*').in('id', ids).order('created_at', { ascending: true })),
    q(sb.from('order_items').select('*').in('order_id', ids)),
  ]);
  return (orders || []).map((order) => ({ order, items: (items || []).filter((i) => i.order_id === order.id) }));
}

/* ---------- CSV ---------- */
function exportCsv(ctx, data, slug) {
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
  downloadFile(`pedidos-${slug}-${isoDay(new Date())}.csv`, csv);
}

/* ---------- Filtros da lista ---------- */
function readFilters(ctx) {
  const qy = ctx.query || {};
  const stores = String(qy.store || '')
    .split(',')
    .filter((id) => !ctx.storeId && ctx.stores.some((s) => s.id === id));
  const status = ORDER_STATUS[qy.status] ? qy.status : '';
  return {
    status,
    q: String(qy.q || qy.phone || '').slice(0, 80),
    from: YMD_RE.test(qy.from || '') ? qy.from : '',
    to: YMD_RE.test(qy.to || '') ? qy.to : '',
    pay: PAYMENT_STATUS[qy.pay || qy.payment] ? qy.pay || qy.payment : '',
    method: PAYMENT_METHOD[qy.method] ? qy.method : '',
    stores,
    customer: UUID_RE.test(qy.customer || '') ? qy.customer : '',
    sort: qy.sort === 'old' || qy.sort === 'new' ? qy.sort : '',
    page: Math.max(1, parseInt(qy.page, 10) || 1),
  };
}
// Mais antigos primeiro em "Novos" (o mais urgente no topo); mais recentes nas outras abas
const sortOf = (f) => f.sort || (f.status === 'pending' ? 'old' : 'new');

// Busca: nº/código (dígitos), telefone (dígitos), nome do cliente (texto) e e-mail
function searchFilter(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const digits = digitsOf(t);
  const compact = t.replace(/\s+/g, '');
  const isCode = /^#?(at)?\d+$/i.test(compact);
  const words = t.replace(/[,()"\\*%#]/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
  else if (f.stores.length === 1) qy = qy.eq('store_id', f.stores[0]);
  else if (f.stores.length > 1) qy = qy.in('store_id', f.stores);
  if (withStatus && f.status) qy = qy.eq('status', f.status);
  if (f.pay) qy = qy.eq('payment_status', f.pay);
  if (f.method) qy = qy.eq('payment_method', f.method);
  if (f.customer) qy = qy.eq('customer_id', f.customer);
  if (f.from) qy = qy.gte('created_at', dayStart(f.from));
  if (f.to) qy = qy.lt('created_at', dayEnd(f.to));
  const or = searchFilter(f.q);
  if (or) qy = qy.or(or);
  return qy;
}
const hasFilters = (f) => !!(f.q || f.from || f.to || f.pay || f.method || f.stores.length || f.customer);
const extraFilterCount = (f) => [f.pay, f.method, f.stores.length].filter(Boolean).length;
function detectPreset(from, to) {
  if (!from || !to) return null;
  return Object.keys(RANGE_PRESETS).find((k) => {
    const r = presetRange(k);
    return r && r.from === from && r.to === to;
  }) || null;
}

/* =========================================================
   LISTA
   ========================================================= */
async function renderList(view, ctx) {
  const f = readFilters(ctx);
  if (lastListStore !== undefined && lastListStore !== ctx.storeId) f.page = 1;
  lastListStore = ctx.storeId;
  const network = !ctx.storeId;
  const canBulk = network ? ctx.isGlobal : ctx.can('orders');
  const fresh = new Set();
  const selected = new Set();
  let counts = {};
  let rows = [];
  let total = 0;
  let token = 0;
  let timer = null;
  let firstLoad = true;
  let density = lsGet(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  let detail = null; // gaveta aberta

  const scopeLabel = () => {
    if (!network) {
      const st = ctx.store;
      return st ? (st.city && !st.name.includes(st.city) ? `${st.name} · ${st.city}` : st.name) : '';
    }
    if (!f.stores.length) return `Toda a rede · ${plural(ctx.stores.length, 'loja', 'lojas')}`;
    return f.stores.length === 1 ? ctx.storeName(f.stores[0]) : `${num(f.stores.length)} lojas selecionadas`;
  };
  const periodLabel = () => (f.from && f.to ? (f.from === f.to ? brFull(f.from) : `${brDay(f.from)} a ${brFull(f.to)}`) : '');
  const setHead = () => ctx.setTitle('Pedidos', [scopeLabel(), periodLabel()].filter(Boolean).join(' · '));
  setHead();

  const canOrdersAny = network ? ctx.isGlobal : ctx.can('orders');
  ctx.setActions(
    html`${canOrdersAny
      ? html`<button class="btn" type="button" data-print-day title="Imprime os romaneios das entregas de hoje: pedidos agendados para hoje e pedidos em rota">
          ${icon('printer')}<span>Romaneio do dia</span></button>`
      : ''}
      <button class="btn" type="button" data-export title="Exportar os pedidos do filtro atual (até ${num(EXPORT_LIMIT)})">
        ${icon('download')}<span>Exportar CSV</span>
      </button>`
  );

  const tabsHtml = () =>
    TABS.map(([s, label, tone]) => {
      const on = f.status === s;
      const n = counts[s];
      return html`<button class="tab" type="button" role="tab" id="ord-tab-${s || 'all'}" aria-selected="${on ? 'true' : 'false'}" aria-controls="ord-panel" tabindex="${on ? '0' : '-1'}" data-status="${s}">
        ${tone ? html`<span class="dot dot--sm t-${tone}" aria-hidden="true"></span>` : ''}${label}<span class="tab__n ${s === 'pending' && n ? 'tab__n--warn' : ''}">${n === undefined ? '…' : num(n)}</span>
      </button>`;
    });

  render(
    view,
    html`<div class="ord">
      <section class="card ord-card">
        <div class="tabs ord-tabs" role="tablist" aria-label="Status do pedido" data-tabs>${tabsHtml()}</div>
        <form class="toolbar ord-tb" data-filters role="search" novalidate>
          <div class="search ord-tb__search">
            ${icon('search', 'icon-sm')}
            <label class="visually-hidden" for="of-q">Buscar pedidos</label>
            <input class="input" id="of-q" name="q" type="search" value="${f.q}" placeholder="Código, nome ou telefone" autocomplete="off" enterkeyhint="search">
            <span class="kbd kbd--sm ord-tb__kbd" aria-hidden="true">/</span>
          </div>
          <button class="btn ord-tb__toggle" type="button" data-more-toggle aria-expanded="false" aria-controls="ord-more">${icon('sliders', 'icon-sm')} Filtros <span class="count-pill" data-more-n hidden></span></button>
          <button class="btn ord-tb__date" type="button" data-range>${icon('calendar', 'icon-sm')}<span data-range-label></span></button>
          <div class="ord-tb__more" id="ord-more" data-ord-filters>
            ${network
              ? html`<div class="ord-tb__f ord-tb__f--stores">
                  <label class="visually-hidden" for="of-store">Lojas</label>
                  <select class="select" id="of-store" name="store" multiple data-prefix="Lojas" data-placeholder="Todas" data-chips-max="1" data-sheet-title="Lojas" data-search-placeholder="Buscar loja ou cidade…">
                    ${ctx.stores.map((s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name} · ${s.city}" data-keywords="${s.name}" ${f.stores.includes(s.id) ? 'selected' : ''}>${shortName(ctx, s.id)}</option>`)}
                  </select>
                </div>`
              : ''}
            <div class="ord-tb__f">
              <label class="visually-hidden" for="of-method">Forma de pagamento</label>
              <select class="select" id="of-method" name="method" data-prefix="Forma" data-sheet-title="Forma de pagamento">
                <option value="">Todas</option>
                ${Object.entries(PAYMENT_METHOD).map(([k, v]) => html`<option value="${k}" data-icon="${PAYMENT_ICON[k] || 'wallet'}" ${f.method === k ? 'selected' : ''}>${v}</option>`)}
              </select>
            </div>
            <div class="ord-tb__f">
              <label class="visually-hidden" for="of-pay">Status do pagamento</label>
              <select class="select" id="of-pay" name="pay" data-prefix="Pagamento" data-sheet-title="Status do pagamento">
                <option value="">Todos</option>
                ${Object.keys(PAYMENT_STATUS).map((k) => html`<option value="${k}" data-dot="${PAY_TONE[k]}" ${f.pay === k ? 'selected' : ''}>${PAY_SHORT[k]}</option>`)}
              </select>
            </div>
          </div>
          <button class="btn btn--ghost btn--sm ord-tb__clear" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
          <span class="toolbar__spacer"></span>
          <button class="btn btn--ghost btn--sm ord-tb__sort" type="button" data-sort-toggle></button>
          <div class="ord-tb__density">${segmented({
            name: 'density',
            label: 'Densidade da tabela',
            options: [
              ['compact', 'Compacta', 'menu'],
              ['comfortable', 'Confortável', 'grid'],
            ],
            value: density,
            size: 'sm',
            icons: true,
          })}</div>
        </form>
        <div data-customer-filter></div>
        <div class="ord-results" id="ord-panel" role="tabpanel" aria-labelledby="ord-tab-${f.status || 'all'}" data-results>${skeleton('table', { rows: 8, cols: 5 })}</div>
      </section>
      <div data-bulk></div>
      <p class="visually-hidden" aria-live="polite" data-summary></p>
    </div>`
  );

  const results = $('[data-results]', view);
  const form = $('[data-filters]', view);
  const summaryEl = $('[data-summary]', view);

  // período
  const rangeBtn = $('[data-range]', form);
  const paintRange = () => {
    const p = detectPreset(f.from, f.to);
    const lbl = $('[data-range-label]', rangeBtn);
    lbl.textContent = f.from && f.to ? PRESET_SHORT[p] || rangeLabel(f.from, f.to) : 'Período';
    rangeBtn.classList.toggle('is-set', !!(f.from && f.to));
  };
  const range = dateRange(rangeBtn, {
    from: f.from || null,
    to: f.to || null,
    preset: detectPreset(f.from, f.to),
    onApply: ({ from, to }) => {
      f.from = from || '';
      f.to = to || '';
      f.page = 1;
      paintRange();
      load();
    },
  });
  paintRange();

  const drawTabs = () => {
    const box = $('[data-tabs]', view);
    const hadFocus = box.contains(document.activeElement);
    render(box, tabsHtml());
    if (hadFocus) $('[aria-selected="true"]', box)?.focus({ preventScroll: true });
    results.setAttribute('aria-labelledby', `ord-tab-${f.status || 'all'}`);
  };

  const drawExtras = () => {
    $('[data-clear]', view).hidden = !hasFilters(f);
    const n = extraFilterCount(f);
    const pill = $('[data-more-n]', view);
    pill.hidden = !n;
    pill.textContent = n ? String(n) : '';
    const sortBtn = $('[data-sort-toggle]', view);
    render(sortBtn, html`${icon(sortOf(f) === 'old' ? 'arrowUp' : 'arrowDown', 'icon-sm')} ${sortOf(f) === 'old' ? 'Mais antigos' : 'Mais recentes'}`);
    sortBtn.setAttribute('aria-label', `Ordem: ${sortOf(f) === 'old' ? 'mais antigos primeiro' : 'mais recentes primeiro'}. Trocar ordem`);
    render(
      $('[data-customer-filter]', view),
      f.customer
        ? html`<div class="alert alert--info ord-custfilter">${icon('customers')}<div class="grow">${rows[0] ? html`Pedidos de <strong>${rows[0].customer_name}</strong>` : 'Pedidos de um cliente'}</div>
            <button class="btn btn--sm" type="button" data-clear-customer>Ver todos</button></div>`
        : ''
    );
    setHead();
  };

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (f.status) p.set('status', f.status);
    if (f.q) p.set('q', f.q);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.pay) p.set('pay', f.pay);
    if (f.method) p.set('method', f.method);
    if (f.stores.length) p.set('store', f.stores.join(','));
    if (f.customer) p.set('customer', f.customer);
    if (f.sort) p.set('sort', f.sort);
    if (f.page > 1) p.set('page', String(f.page));
    const qs = p.toString().replace(/%2C/g, ',');
    const hash = `#/orders${qs ? `?${qs}` : ''}`;
    lastListHash = hash;
    if (!detail && location.hash !== hash) history.replaceState(null, '', hash);
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
    const asc = sortOf(f) === 'old';
    const qy = applyFilters(sb.from('orders').select(LIST_COLS, { count: 'exact' }), f, ctx)
      .order('created_at', { ascending: asc })
      .order('number', { ascending: asc })
      .range(from, from + PAGE_SIZE - 1);
    const { data, count, error } = await qy;
    if (error) {
      if (error.code === 'PGRST103' && f.page > 1) return { outOfRange: true };
      throw new ApiError(error);
    }
    return { rows: data || [], total: count || 0 };
  };

  /* ----- desenho ----- */
  const showStore = network;
  const rowWhen = (r) => (r.status === 'pending' ? ageChip(r.created_at) : html`<span title="${datetime(r.created_at)}">${whenShort(r.created_at)}</span>`);
  const newMark = (r) => (isFresh(r, fresh) ? html`<span class="new-dot" aria-hidden="true"></span><span class="visually-hidden">, novo, ainda não aberto</span>` : '');
  const rowHtml = (r) => {
    const sel = selected.has(r.id);
    const qty = itemQty(r.order_items);
    return html`<tr class="is-clickable ${sel ? 'is-selected' : ''} ${isFresh(r, fresh) ? 'is-new' : ''}" data-id="${r.id}">
      ${canBulk ? html`<td class="check-col"><input type="checkbox" data-check value="${r.id}" aria-label="Selecionar pedido ${r.code}" ${sel ? 'checked' : ''}></td>` : ''}
      <td class="ord-c-code"><a class="code ord-code" href="#/orders/${r.id}" data-open="${r.id}">${r.code}</a>${newMark(r)}<span class="sub">${rowWhen(r)}</span></td>
      <td class="ord-c-cust"><span class="cell-strong ellipsis ord-name" title="${fmtPhone(r.customer_phone)}">${r.customer_name}</span><span class="sub ellipsis">${[r.city, r.state].filter(Boolean).join(', ')}</span></td>
      ${showStore ? html`<td class="ord-c-store"><span class="ord-store">${storeMark(storeOf(ctx, r.store_id) || {}, 24)}<span class="ellipsis">${shortName(ctx, r.store_id)}</span></span></td>` : ''}
      <td class="num ord-c-total"><span class="cell-strong">${money(r.total)}</span><span class="sub">${qty ? plural(qty, 'item', 'itens') : '—'}</span></td>
      <td class="ord-c-pay">${payCell(r)}</td>
      <td class="ord-c-status">${statusPill(r.status)}</td>
      <td class="ord-c-go"><span class="ord-go" aria-hidden="true">${icon('chevronRight', 'icon-sm')}</span></td>
    </tr>`;
  };
  const cardHtml = (r) => {
    const canConfirm = r.status === 'pending' && ctx.can('orders', r.store_id);
    return html`<article class="card m-card ord-mc ${isFresh(r, fresh) ? 'is-new' : ''}" data-id="${r.id}">
      <div class="ord-mc__top"><a class="code ord-code" href="#/orders/${r.id}" data-open="${r.id}">${r.code}</a>${newMark(r)}<span class="grow"></span>${statusPill(r.status)}</div>
      <div class="ord-mc__name">${r.customer_name}</div>
      <div class="ord-mc__meta">${showStore ? html`${storeMark(storeOf(ctx, r.store_id) || {}, 20)}<span class="ellipsis">${shortName(ctx, r.store_id)}</span><span aria-hidden="true">·</span>` : html`<span class="ellipsis">${r.city}</span><span aria-hidden="true">·</span>`}${rowWhen(r)}</div>
      <div class="ord-mc__pay">${payMethod(r)}${payStatus(r.payment_status)}<strong class="ord-mc__total">${money(r.total)}</strong></div>
      ${canConfirm
        ? html`<div class="ord-mc__acts"><a class="btn btn--touch" href="#/orders/${r.id}" data-open="${r.id}">Ver pedido</a>
            <button class="btn btn--dark btn--touch" type="button" data-confirm="${r.id}">${icon('check', 'icon-sm')} Confirmar</button></div>`
        : ''}
    </article>`;
  };

  const emptyState = () => {
    const filtered = hasFilters(f);
    if (filtered) {
      const where = network ? (f.stores.length === 1 ? ` em ${shortName(ctx, f.stores[0])}` : '') : ` em ${shortName(ctx, ctx.storeId)}`;
      const pre = detectPreset(f.from, f.to);
      const period = f.from && f.to ? (pre ? PERIOD_PHRASE[pre] : ` entre ${brDay(f.from)} e ${brDay(f.to)}`) : '';
      const what = f.q ? `com “${f.q}”` : 'com estes filtros';
      const wide = f.from && f.to && !['30d', 'thisYear'].includes(pre);
      return empty(
        'Nenhum pedido encontrado',
        `Nada ${what}${where}${period}. ${f.q ? 'Confira o código ou amplie o período.' : 'Ajuste os filtros ou amplie o período.'}`,
        html`<button class="btn" type="button" data-clear>${icon('close', 'icon-sm')} Limpar filtros</button>${
          wide ? html`<button class="btn btn--dark" type="button" data-preset="30d">${icon('calendar', 'icon-sm')} Últimos 30 dias</button>` : ''
        }`,
        { art: 'site:empty-search', size: 'md' }
      );
    }
    if (f.status === 'pending') {
      return empty(
        'Tudo em dia! Nenhum pedido aguardando',
        network ? 'Nenhuma loja da rede tem pedido esperando confirmação agora. Os novos chegam aqui com um aviso sonoro.' : 'Todos os pedidos novos já foram confirmados. Os próximos chegam aqui com um aviso sonoro.',
        counts.confirmed ? html`<button class="btn" type="button" data-status="confirmed">Ver confirmados</button>` : '',
        { art: 'all-done', size: 'md' }
      );
    }
    if (f.status) {
      return empty(`Nenhum pedido ${EMPTY_WORD[f.status]}`, 'Quando houver, eles aparecem aqui.', html`<button class="btn" type="button" data-status="">Ver todos os pedidos</button>`, {
        art: false,
        icon: 'orders',
        size: 'sm',
      });
    }
    const link = network ? '/' : storefrontUrl(ctx.store?.slug || '');
    const city = network ? 'qualquer loja da rede' : `${ctx.store?.city || shortName(ctx, ctx.storeId)}`;
    return empty(
      'Ainda sem pedidos por aqui',
      `Quando alguém comprar na loja virtual de ${city}, o pedido aparece aqui com um aviso sonoro.`,
      html`<button class="btn" type="button" data-copy-store="${link}">${icon('link', 'icon-sm')} Copiar link da loja</button>
        <a class="btn btn--dark" href="${link}" target="_blank" rel="noopener">${icon('external', 'icon-sm')} Ver loja virtual</a>`,
      { art: 'empty-orders', size: 'lg' }
    );
  };

  const drawRows = () => {
    if (!rows.length) {
      render(results, html`<div class="ord-empty">${emptyState()}</div>`);
      return;
    }
    const allSel = canBulk && rows.every((r) => selected.has(r.id));
    const someSel = canBulk && rows.some((r) => selected.has(r.id));
    const sort = sortOf(f);
    render(
      results,
      html`<div class="table-wrap ord-tw"><table class="table ord-table ${density === 'compact' ? 'table--compact' : ''}">
        <caption class="visually-hidden">Pedidos${f.status ? ` · ${TABS.find((t) => t[0] === f.status)[1]}` : ''}</caption>
        <thead><tr>
          ${canBulk ? html`<th class="check-col" scope="col"><input type="checkbox" data-check-all aria-label="Selecionar todos os pedidos desta página" ${allSel ? 'checked' : ''}></th>` : ''}
          <th scope="col" aria-sort="${sort === 'old' ? 'ascending' : 'descending'}"><button class="ord-th-sort" type="button" data-sort title="Trocar a ordem">Pedido ${icon(sort === 'old' ? 'arrowUp' : 'arrowDown', 'icon-xs')}</button></th>
          <th scope="col">Cliente</th>
          ${showStore ? html`<th scope="col">Loja</th>` : ''}
          <th scope="col" class="num">Total</th>
          <th scope="col">Pagamento</th>
          <th scope="col">Status</th>
          <th scope="col" class="ord-c-go"><span class="visually-hidden">Abrir</span></th>
        </tr></thead>
        <tbody>${rows.map(rowHtml)}</tbody>
      </table></div>
      <div class="ord-cards">${rows.map(cardHtml)}</div>
      ${pager({ page: f.page, pageSize: PAGE_SIZE, total })}`
    );
    const all = $('[data-check-all]', results);
    if (all) all.indeterminate = someSel && !allSel;
    const info = $('.pager__info', results);
    if (info) info.append(total === 1 ? ' pedido' : ' pedidos');
  };

  /* ----- seleção e lote ----- */
  const bulkBox = $('[data-bulk]', view);
  const selectedRows = () => rows.filter((r) => selected.has(r.id));
  const drawBulk = () => {
    const n = selected.size;
    if (!n) {
      render(bulkBox, '');
      document.documentElement.style.removeProperty('--bar-h');
      return;
    }
    render(
      bulkBox,
      html`<div class="bulkbar ord-bulk" role="region" aria-label="Ações em lote">
        <span class="bulkbar__n" aria-hidden="true">${num(n)}</span><span>${n === 1 ? 'pedido selecionado' : 'pedidos selecionados'}</span><span class="visually-hidden">: ${plural(n, 'pedido selecionado', 'pedidos selecionados')}</span>
        <span class="bulkbar__sep" aria-hidden="true"></span>
        <button class="bulkbar__b" type="button" data-bulk-status aria-haspopup="dialog" aria-expanded="false">${icon('sync', 'icon-sm')} Mudar status ${icon('chevronDown', 'icon-xs')}</button>
        <button class="bulkbar__b" type="button" data-bulk-print>${icon('printer', 'icon-sm')} Imprimir romaneio</button>
        <button class="bulkbar__b" type="button" data-bulk-export>${icon('download', 'icon-sm')} Exportar</button>
        <button class="bulkbar__x" type="button" data-bulk-clear aria-label="Limpar seleção (Esc)" title="Limpar seleção (Esc)">${icon('close', 'icon-sm')}</button>
      </div>`
    );
    document.documentElement.style.setProperty('--bar-h', '64px');
  };
  const syncChecks = () => {
    $$('tr[data-id]', results).forEach((tr) => {
      const on = selected.has(tr.dataset.id);
      tr.classList.toggle('is-selected', on);
      const cb = $('[data-check]', tr);
      if (cb) cb.checked = on;
    });
    const all = $('[data-check-all]', results);
    if (all) {
      const allSel = rows.length && rows.every((r) => selected.has(r.id));
      all.checked = !!allSel;
      all.indeterminate = !allSel && rows.some((r) => selected.has(r.id));
    }
    drawBulk();
  };
  const clearSelection = () => {
    selected.clear();
    syncChecks();
  };

  async function load({ quiet = false } = {}) {
    const my = ++token;
    syncUrl();
    drawExtras();
    if (!firstLoad) results.classList.add('is-busy');
    results.setAttribute('aria-busy', 'true');
    const countsP = Promise.allSettled(TABS.map(([s]) => countFor(s)));
    try {
      const page = await fetchPage();
      if (my !== token) return;
      if (page.outOfRange) {
        f.page = 1;
        load();
        return;
      }
      rows = page.rows;
      total = page.total;
      // a seleção só vale para pedidos ainda na tela
      [...selected].forEach((id) => rows.some((r) => r.id === id) || selected.delete(id));
      drawRows();
      drawBulk();
      drawExtras();
      if (!firstLoad && !quiet) summaryEl.textContent = total ? `${plural(total, 'pedido encontrado', 'pedidos encontrados')}.` : 'Nenhum pedido encontrado.';
    } catch (e) {
      if (my !== token) return;
      render(results, html`<div class="ord-empty">${errorBlock(e, { retry: () => load(), title: 'Não foi possível carregar os pedidos' })}</div>`);
    } finally {
      if (my === token) {
        results.classList.remove('is-busy');
        results.removeAttribute('aria-busy');
        firstLoad = false;
      }
    }
    const settled = await countsP;
    if (my !== token) return;
    counts = {};
    TABS.forEach(([s], i) => {
      if (settled[i].status === 'fulfilled') counts[s] = settled[i].value;
    });
    drawTabs();
    if (!rows.length && f.status === 'pending' && !hasFilters(f)) drawRows(); // "Ver confirmados" depende da contagem
  }

  const reloadSoon = (ms = 450) => {
    clearTimeout(timer);
    timer = setTimeout(() => load({ quiet: true }), ms);
  };

  /* ----- gaveta do pedido ----- */
  function openOrder(id, e) {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      window.open(`#/orders/${id}`, '_blank');
      return;
    }
    if (isMobile()) {
      ctx.navigate(`#/orders/${id}`);
      return;
    }
    markSeen(id);
    $$(`[data-id="${window.CSS.escape(id)}"]`, results).forEach((el) => {
      el.classList.remove('is-new');
      $$('.new-dot, .new-dot + .visually-hidden', el).forEach((n) => n.remove());
    });
    if (detail) detail.go(id);
    else {
      detail = orderDrawer(ctx, id, {
        list: () => rows.map((r) => r.id),
        listHash: () => lastListHash,
        onChanged: () => reloadSoon(150),
        onClose: () => {
          detail = null;
        },
      });
    }
  }

  // Tempo real: pedido novo → recarrega e destaca a linha; alteração → recarrega (e a gaveta aberta)
  ctx.on('new-order', (o) => {
    if (f.stores.length && !f.stores.includes(o.store_id)) return;
    fresh.add(o.id);
    reloadSoon();
  });
  ctx.on('order-updated', (o) => {
    if (ctx.storeId && o.store_id !== ctx.storeId) return;
    detail?.remoteUpdate(o);
    reloadSoon();
  });

  /* ----- eventos ----- */
  view.addEventListener('click', async (e) => {
    const t = e.target;
    const tab = t.closest('[data-status]');
    if (tab) {
      f.status = tab.dataset.status;
      f.page = 1;
      selected.clear();
      drawTabs();
      load();
      return;
    }
    const pg = t.closest('[data-page]');
    if (pg && !pg.disabled) {
      f.page = Math.max(1, Number(pg.dataset.page) || 1);
      selected.clear();
      await load();
      scrollToTop($('.ord-card', view));
      return;
    }
    if (t.closest('[data-clear]')) {
      Object.assign(f, { q: '', from: '', to: '', pay: '', method: '', stores: [], customer: '', page: 1 });
      form.q.value = '';
      ['method', 'pay'].forEach((n) => (form[n].value = ''));
      if (form.store) Array.from(form.store.options).forEach((o) => (o.selected = false));
      range.set(null, null);
      paintRange();
      load();
      return;
    }
    const pre = t.closest('[data-preset]');
    if (pre && results.contains(pre)) {
      const r = presetRange(pre.dataset.preset);
      f.from = r.from;
      f.to = r.to;
      f.page = 1;
      range.set(r.from, r.to, pre.dataset.preset);
      paintRange();
      load();
      return;
    }
    if (t.closest('[data-clear-customer]')) {
      f.customer = '';
      f.page = 1;
      load();
      return;
    }
    if (t.closest('[data-sort], [data-sort-toggle]')) {
      f.sort = sortOf(f) === 'old' ? 'new' : 'old';
      f.page = 1;
      load();
      return;
    }
    if (t.closest('[data-more-toggle]')) {
      const btn = t.closest('[data-more-toggle]');
      const box = $('[data-ord-filters]', view);
      const open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      return;
    }
    const cs = t.closest('[data-copy-store]');
    if (cs) {
      const url = new URL(cs.dataset.copyStore, location.origin).href;
      if (await copyText(url)) toast('Link da loja copiado.', 'success');
      else promptDialog({ title: 'Link da loja', label: 'Copie o link abaixo', value: url, confirmLabel: 'Fechar' });
      return;
    }
    const conf = t.closest('[data-confirm]');
    if (conf) {
      const r = rows.find((x) => x.id === conf.dataset.confirm);
      if (r) await moveOrder(ctx, r, 'confirmed', { visible: true, btn: conf, onDone: () => reloadSoon(100) });
      return;
    }
    if (t.closest('[data-bulk-clear]')) {
      clearSelection();
      return;
    }
    const bs = t.closest('[data-bulk-status]');
    if (bs) {
      togglePop(bs, () => statusPop(bs, ctx, selectedRows(), { onDone: () => (clearSelection(), reloadSoon(100)) }));
      return;
    }
    const bp = t.closest('[data-bulk-print]');
    if (bp) {
      const ids = [...selected].slice(0, PRINT_LIMIT);
      try {
        await busy(bp, 'Preparando…', async () => printOrders(ctx, await fetchForPrint(ids)));
        if (selected.size > PRINT_LIMIT) toast(`Impressos os primeiros ${PRINT_LIMIT} romaneios. Selecione menos pedidos para o restante.`, 'warning', 7000);
      } catch (err) {
        toastError(err);
      }
      return;
    }
    const be = t.closest('[data-bulk-export]');
    if (be) {
      try {
        await busy(be, 'Gerando…', async () => {
          const data = await q(sb.from('orders').select(EXPORT_COLS).in('id', [...selected]).order('created_at', { ascending: false }));
          exportCsv(ctx, data || [], ctx.store?.slug || 'selecao');
          toast(`${plural((data || []).length, 'pedido exportado', 'pedidos exportados')}.`, 'success');
        });
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (t.closest('[data-check], [data-check-all], .check-col')) return;
    const open = t.closest('[data-open]');
    if (open) {
      e.preventDefault();
      openOrder(open.dataset.open, e);
      return;
    }
    const tr = t.closest('tr[data-id], .ord-mc[data-id]');
    if (tr && !t.closest('a, button, input, label') && !window.getSelection()?.toString()) openOrder(tr.dataset.id, e);
  });

  view.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-check]')) {
      if (el.checked) selected.add(el.value);
      else selected.delete(el.value);
      syncChecks();
      return;
    }
    if (el.matches('[data-check-all]')) {
      rows.forEach((r) => (el.checked ? selected.add(r.id) : selected.delete(r.id)));
      syncChecks();
    }
  });

  // abas: setas, Home/End
  $('[data-tabs]', view).addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('[role="tab"]', e.currentTarget);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[n].focus();
    tabs[n].click();
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
  const onStores = debounce(() => {
    f.stores = Array.from(form.store.selectedOptions).map((o) => o.value);
    f.page = 1;
    load();
  }, 300);
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.name || el.name === 'q') return;
    if (el.name === 'density') {
      density = el.value === 'comfortable' ? 'comfortable' : 'compact';
      lsSet(DENSITY_KEY, density);
      $('.ord-table', results)?.classList.toggle('table--compact', density === 'compact');
      return;
    }
    if (el.name === 'store') {
      onStores();
      return;
    }
    if (el.name === 'method' || el.name === 'pay') {
      f[el.name] = el.value;
      f.page = 1;
      load();
    }
  });

  // atalhos: "/" busca · Esc limpa a seleção
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !view.isConnected) return;
    const editing = e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]');
    if (document.querySelector('.modal, .panel, .ord-pop, .pop, .cmdk')) return;
    if (e.key === '/' && !editing) {
      e.preventDefault();
      form.q.focus();
      form.q.select();
    } else if (e.key === 'Escape' && selected.size && !editing) {
      clearSelection();
    }
  };
  document.addEventListener('keydown', onKey);

  // Exportação CSV do filtro atual
  $('[data-actions] [data-export]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await busy(btn, 'Gerando…', async () => {
        const asc = sortOf(f) === 'old';
        const qy = applyFilters(sb.from('orders').select(EXPORT_COLS, { count: 'exact' }), f, ctx)
          .order('created_at', { ascending: asc })
          .order('number', { ascending: asc })
          .range(0, EXPORT_LIMIT - 1);
        const { data, count, error } = await qy;
        if (error) throw new ApiError(error);
        if (!data?.length) {
          toast('Nenhum pedido para exportar com estes filtros.', 'warning');
          return;
        }
        const slug = ctx.store?.slug || (f.stores.length === 1 ? storeOf(ctx, f.stores[0])?.slug : 'rede') || 'rede';
        exportCsv(ctx, data, slug);
        if (count > data.length) toast(`Exportados os ${num(data.length)} pedidos mais recentes de ${num(count)}. Reduza o período para exportar o restante.`, 'warning', 7000);
        else toast(`${plural(data.length, 'pedido exportado', 'pedidos exportados')}.`, 'success');
      });
    } catch (err) {
      toastError(err);
    }
  });

  // Romaneio do dia: entregas agendadas para hoje e pedidos em rota
  $('[data-actions] [data-print-day]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await busy(btn, 'Preparando…', async () => {
        const today = spDay(Date.now());
        let qy = sb
          .from('orders')
          .select('id')
          .in('status', ['confirmed', 'preparing', 'out_for_delivery'])
          .or(`scheduled_date.eq.${today},status.eq.out_for_delivery`)
          .order('created_at', { ascending: true })
          .limit(PRINT_LIMIT);
        if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
        else if (f.stores.length) qy = qy.in('store_id', f.stores);
        const ids = (await q(qy) || []).map((r) => r.id);
        if (!ids.length) {
          toast('Agende a data de entrega no pedido ou selecione pedidos na lista para imprimir.', 'info', 7000, { title: 'Nenhuma entrega para hoje' });
          return;
        }
        printOrders(ctx, await fetchForPrint(ids));
      });
    } catch (err) {
      toastError(err);
    }
  });

  ctx.onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.removeProperty('--bar-h');
    range.destroy?.();
    detail?.close({ restore: false });
  });

  await load();
}

/* =========================================================
   DETALHE (peças compartilhadas pela gaveta e pela página)
   ========================================================= */
async function fetchOrder(id) {
  const [order, items, events] = await Promise.all([
    q(sb.from('orders').select('*').eq('id', id).maybeSingle()),
    q(sb.from('order_items').select('*').eq('order_id', id)),
    q(sb.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).order('id', { ascending: false })),
  ]);
  return { order, items: items || [], events: events || [] };
}
const custCountLabel = (n) => (!n ? '' : n <= 1 ? '1º pedido' : `${num(n)} pedidos`);
// Quantos pedidos este cliente tem (para "1º pedido" / "3 pedidos")
async function customerOrders(o) {
  try {
    let qy = sb.from('orders').select('id', { count: 'exact', head: true });
    qy = o.customer_id ? qy.eq('customer_id', o.customer_id) : qy.eq('customer_phone', o.customer_phone);
    const { count, error } = await qy;
    return error ? null : count;
  } catch {
    return null;
  }
}

function stepper(o, events) {
  if (o.status === 'canceled') return '';
  const idx = FLOW.indexOf(o.status);
  const when = (s) => (s === 'pending' ? o.created_at : events.find((e) => e.type === 'status' && e.status === s)?.created_at);
  const cur = o.status === 'delivered' ? -1 : idx + 1;
  const age = o.status === 'pending' ? minsSince(o.created_at) : 0;
  const late = age >= AGE.late;
  const stamp = (v) => (v ? (spDay(v) === spDay(Date.now()) ? hhmm(v) : brDay(spDay(v))) : '');
  const stepNo = o.status === 'delivered' ? 5 : Math.min(5, idx + 2);
  return html`<div class="ord-progress">
    <ol class="stepper ord-steps" aria-label="Andamento do pedido">${FLOW.map((s, i) => {
      const done = i <= idx;
      const isCur = i === cur;
      const t = done ? stamp(when(s)) : isCur && o.status === 'pending' ? `há ${fmtAgeShort(age)}` : '';
      return html`<li class="stepper__s ${done ? 'is-done' : ''} ${isCur ? 'is-current' : ''} ${isCur && late ? 'is-late' : ''}" ${isCur ? html`aria-current="step"` : ''}>
        <span class="stepper__dot">${done ? icon('check', 'icon-xs') : i + 1}</span><span class="stepper__l">${STEPS[i]}</span><span class="stepper__t">${t}${isCur && late ? html`<span class="visually-hidden"> (atrasado)</span>` : ''}</span>
      </li>`;
    })}</ol>
    <div class="ord-mprog" aria-hidden="true">
      <div class="ord-mprog__bar">${FLOW.map((s, i) => html`<span class="${i <= idx ? 'is-done' : ''} ${i === cur ? (late ? 'is-late' : 'is-cur') : ''}"></span>`)}</div>
      <p>Etapa ${stepNo} de 5 · ${STEP_NOTE[o.status]}</p>
    </div>
  </div>`;
}
// "1 h 14" (sem "min") para caber sob a bolinha
function fmtAgeShort(min) {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

function eventInfo(e) {
  if (e.type === 'created') return { title: 'Pedido feito pelo site', ico: 'orders', tone: '' };
  if (e.type === 'status') {
    const map = { pending: 'clock', confirmed: 'check', preparing: 'box', out_for_delivery: 'truck', delivered: 'checkCircle', canceled: 'xCircle' };
    return { title: ORDER_STATUS[e.status]?.label || 'Status alterado', ico: map[e.status] || 'sync', tone: TONE_OF[e.status] || 'warn' };
  }
  if (e.type === 'payment') return { title: 'Pagamento', ico: 'wallet', tone: 'ok' };
  if (e.type === 'note') return { title: 'Nota', ico: 'note', tone: 'note' };
  return { title: 'Alteração', ico: 'edit', tone: '' };
}

function headHtml(ctx, o, items, nav) {
  const store = storeOf(ctx, o.store_id);
  const qty = itemQty(items);
  return html`<div class="ord-dh">
    <div class="ord-dh__top">
      <span class="ord-dh__store">${store ? storeMark(store, 20) : ''}<span class="ellipsis">${ctx.storeName(o.store_id)} · ${o.source === 'demo' ? 'demonstração' : 'pelo site'}</span></span>
      ${nav
        ? html`<span class="ord-dh__nav">
            ${nav.total > 1 ? html`<span class="drawer__pos">Pedido ${num(nav.index + 1)} de ${num(nav.total)}</span>
              <button class="btn btn--ghost btn--sm btn--icon" type="button" data-nav="-1" aria-label="Pedido anterior (K)" title="Pedido anterior · K" ${nav.index <= 0 ? 'disabled' : ''}>${icon('chevronLeft', 'icon-sm')}</button>
              <button class="btn btn--ghost btn--sm btn--icon" type="button" data-nav="1" aria-label="Próximo pedido (J)" title="Próximo pedido · J" ${nav.index >= nav.total - 1 ? 'disabled' : ''}>${icon('chevronRight', 'icon-sm')}</button>` : ''}
            <a class="btn btn--ghost btn--sm btn--icon" href="#/orders/${o.id}" data-full aria-label="Abrir em página inteira" title="Abrir em página inteira">${icon('maximize', 'icon-sm')}</a>
          </span>`
        : ''}
    </div>
    <div class="ord-dh__title">
      <h2 class="drawer__code code" tabindex="-1">${o.code}</h2>
      ${statusBadge(o.status)}
      ${payStatus(o.payment_status, { long: true })}
      ${o.status === 'pending' ? ageChip(o.created_at, { prefix: 'aguardando há ' }) : ''}
      ${o.source === 'demo' ? badge('Demonstração', 'plain') : ''}
    </div>
    <p class="ord-dh__meta">${whenShort(o.created_at)} · ${plural(qty, 'item', 'itens')} · <b class="mono-num">${money(o.total)}</b> · ${PAYMENT_METHOD[o.payment_method] || o.payment_method}</p>
  </div>`;
}

function bodyHtml(ctx, s, { mode }) {
  const { order: o, items, events } = s;
  const store = storeOf(ctx, o.store_id);
  const p = { orders: ctx.can('orders', o.store_id), reopen: canReopen(ctx, o) };
  const qty = itemQty(items);
  const d = digitsOf(o.customer_phone);
  const wa = waUrl(ctx, o);
  const others = o.customer_id ? `#/orders?customer=${o.customer_id}` : `#/orders?q=${d}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  const route = store?.lat && store?.lng ? `https://www.google.com/maps/dir/?api=1&origin=${store.lat},${store.lng}&destination=${o.lat},${o.lng}` : '';
  const radius = Number(store?.delivery_radius_km) || 0;
  const inRadius = !radius || Number(o.distance_km) <= radius;
  const pixPending = o.payment_method === 'pix' && o.payment_status === 'pending' && o.status !== 'canceled';
  const pctPix = Number(o.subtotal) > 0 && Number(o.discount_pix) > 0 ? Math.round((Number(o.discount_pix) / Number(o.subtotal)) * 100) : 0;
  return html`
    ${ctx.storeId && ctx.storeId !== o.store_id
      ? html`<div class="alert alert--info">${icon('store')}<div class="grow">Este pedido é da loja <strong>${ctx.storeName(o.store_id)}</strong>.</div>
          <button class="btn btn--sm" type="button" data-switch-store="${o.store_id}">Trocar para esta loja</button></div>`
      : ''}
    ${o.status === 'canceled'
      ? html`<div class="alert alert--danger ord-canceled">${icon('xCircle')}<div class="grow"><strong>Pedido cancelado${o.canceled_at ? ` em ${datetime(o.canceled_at)}` : ''}.</strong>${o.cancel_reason ? html`<span class="ord-block">Motivo: ${o.cancel_reason}</span>` : ''}</div>
          ${p.reopen ? html`<button class="btn btn--sm" type="button" data-to="pending">${icon('undo', 'icon-sm')} Reabrir pedido</button>` : ''}</div>`
      : stepper(o, events)}
    ${pixPending
      ? html`<div class="callout callout--pix" role="note">${icon('pix', 'icon-sm')}<div class="grow"><strong>PIX ainda não identificado</strong>Valor esperado <b class="mono-num">${money(o.total)}</b>${
          store?.pix_key ? ` na chave ${store.pix_key_type ? `${store.pix_key_type === 'aleatoria' ? 'aleatória' : store.pix_key_type.toUpperCase()} ` : ''}${store.pix_holder ? `de ${store.pix_holder}` : `da ${store.brand_name || 'loja'}`}` : ''
        }. Confira o extrato antes de confirmar.
          <div class="callout__acts"><button class="btn btn--sm" type="button" data-copy-value="${Number(o.total).toFixed(2).replace('.', ',')}">${icon('copy', 'icon-sm')} Copiar valor</button>
            ${p.orders ? html`<button class="btn btn--sm btn--ghost" type="button" data-pay="paid">${icon('checkCircle', 'icon-sm')} Marcar como pago</button>` : ''}</div></div></div>`
      : ''}
    ${o.customer_notes ? html`<div class="callout" role="note">${icon('message', 'icon-sm')}<div class="grow"><strong>Observação do cliente</strong><span class="ord-pre">${o.customer_notes}</span></div></div>` : ''}
    <section class="dsec ord-items" aria-labelledby="ord-items-t-${mode}">
      <div class="dsec__head"><h3 id="ord-items-t-${mode}">Itens <span class="muted">(${num(qty)})</span></h3><span class="muted small">${PAYMENT_METHOD[o.payment_method] || o.payment_method}${pctPix ? ` · ${pctPix}% de desconto` : ` · ${installmentsText(o)}`}</span></div>
      ${items.length
        ? items.map(
            (i) => html`<div class="ord-item">
              ${i.image_url ? html`<img class="thumb" src="${mediaUrl(i.image_url)}" alt="" loading="lazy" width="44" height="44">` : html`<span class="thumb thumb--none ord-thumb-empty">${icon('image', 'icon-sm')}</span>`}
              <div class="ord-item__txt"><span class="cell-strong">${i.name}</span>
                <span class="sub">${i.variant_name ? `${i.variant_name} · ` : ''}${i.sku ? html`SKU <span class="mono">${i.sku}</span>` : ''}${i.product_id ? '' : html`<span class="ord-removed"> · produto removido do catálogo</span>`}</span></div>
              <span class="muted small mono-num ord-item__qty">${num(i.quantity)} × ${money(i.unit_price)}</span>
              <span class="cell-strong mono-num ord-item__tot">${money(i.total)}</span>
            </div>`
          )
        : html`<p class="muted small">Sem itens registrados.</p>`}
      <dl class="ord-totals">
        <div><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd></div>
        ${Number(o.discount_coupon) > 0 || o.coupon_code
          ? html`<div><dt>Cupom ${o.coupon_code ? html`<span class="ord-coupon">${o.coupon_code}</span>` : ''}</dt><dd>− ${money(o.discount_coupon)}</dd></div>`
          : ''}
        ${Number(o.discount_pix) > 0 ? html`<div><dt>Desconto PIX${pctPix ? ` (${pctPix}%)` : ''}</dt><dd>− ${money(o.discount_pix)}</dd></div>` : ''}
        <div><dt>Frete</dt><dd class="${Number(o.delivery_fee) > 0 ? '' : 'ord-ok'}">${Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'Grátis'}${o.distance_km !== null && o.distance_km !== undefined ? ` · ${km(o.distance_km)}` : ''}</dd></div>
        <div class="ord-totals__sum"><dt>Total</dt><dd>${money(o.total)}</dd></div>
      </dl>
      <div class="ord-paybar">
        ${payMethod(o)}<span class="muted small ord-paybar__inst">${installmentsText(o)}</span>
        <span class="grow"></span>${payStatus(o.payment_status)}
        ${p.orders ? html`<button class="btn btn--ghost btn--sm" type="button" data-pay-menu aria-haspopup="menu" aria-expanded="false">Alterar ${icon('chevronDown', 'icon-xs')}</button>` : ''}
      </div>
    </section>
    <div class="ord-cols">
      <section class="dsec ord-cust" aria-labelledby="ord-cust-t-${mode}">
        <div class="dsec__head"><h3 id="ord-cust-t-${mode}">Cliente</h3><span class="badge badge--plain t-neu" data-cust-count ${s.custCount ? '' : 'hidden'}>${custCountLabel(s.custCount)}</span></div>
        <p class="ord-cust__name">${o.customer_name}</p>
        <p class="ord-line">${icon('phone', 'icon-sm')}${d ? html`<a href="tel:+55${d}">${fmtPhone(o.customer_phone)}</a>` : '—'}</p>
        <p class="ord-line">${icon('mail', 'icon-sm')}${o.customer_email ? html`<a href="mailto:${o.customer_email}" class="ellipsis">${o.customer_email}</a>` : html`<span class="muted">E-mail não informado</span>`}</p>
        <p class="ord-line">${icon('key', 'icon-sm')}${o.customer_cpf ? html`<span>CPF <span class="mono">${maskCpf(o.customer_cpf)}</span></span>` : html`<span class="muted">CPF não informado</span>`}</p>
        <div class="ord-btns">
          ${wa ? html`<a class="btn btn--sm ord-wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 'icon-sm')} WhatsApp</a>` : ''}
          <button class="btn btn--sm btn--icon" type="button" data-copy="${trackUrl(o)}" aria-label="Copiar link de acompanhamento" data-tooltip="Copiar link de acompanhamento">${icon('link', 'icon-sm')}</button>
        </div>
        <p class="ord-links"><a href="${others}">Outros pedidos</a>${o.customer_id && ctx.can('customers', o.store_id) ? html`<span aria-hidden="true">·</span><a href="#/customers/${o.customer_id}">Ver cliente</a>` : ''}</p>
      </section>
      <section class="dsec ord-deliv" aria-labelledby="ord-deliv-t-${mode}">
        <div class="dsec__head"><h3 id="ord-deliv-t-${mode}">Entrega</h3>${
          o.scheduled_date ? html`<span class="badge badge--plain t-info">${icon('calendar', 'icon-xs')} ${dayLabel(o.scheduled_date)}</span>` : html`<span class="badge badge--plain t-neu">A combinar</span>`
        }</div>
        <p class="ord-line">${icon('mapPin', 'icon-sm')}<span>${o.street}, ${o.address_number}${o.complement ? ` · ${o.complement}` : ''}<br>${o.district ? `${o.district} · ` : ''}${o.city}/${o.state}<br>CEP ${fmtCep(o.cep)}</span></p>
        ${o.reference ? html`<p class="ord-line">${icon('info', 'icon-sm')}<span>Ref.: ${o.reference}</span></p>` : ''}
        <p class="ord-line">${icon('truck', 'icon-sm')}<span>${km(o.distance_km)} da loja${radius ? html` · ${inRadius ? 'dentro do raio' : html`<b class="ord-warn">fora do raio de ${num(radius)} km</b>`}` : ''}</span></p>
        ${o.internal_notes ? html`<div class="tl__note ord-inote"><strong>Observações internas</strong><span class="ord-pre">${o.internal_notes}</span></div>` : ''}
        <div class="ord-btns">
          ${p.orders ? html`<button class="btn btn--sm" type="button" data-delivery aria-label="${o.scheduled_date || o.internal_notes ? 'Editar entrega' : 'Agendar entrega'}">${icon('calendar', 'icon-sm')} ${o.scheduled_date || o.internal_notes ? 'Editar' : 'Agendar'}</button>` : ''}
          <a class="btn btn--sm btn--icon" href="${maps}" target="_blank" rel="noopener" aria-label="Ver no mapa (abre em nova aba)" data-tooltip="Ver no mapa">${icon('map', 'icon-sm')}</a>
          ${route ? html`<a class="btn btn--sm btn--icon" href="${route}" target="_blank" rel="noopener" aria-label="Rota a partir da loja (abre em nova aba)" data-tooltip="Rota a partir da loja">${icon('truck', 'icon-sm')}</a>` : ''}
        </div>
      </section>
    </div>`;
}

function sideHtml(ctx, s, { mode }) {
  const { order: o, events } = s;
  const p = ctx.can('orders', o.store_id);
  return html`<section class="ord-hist" aria-labelledby="ord-hist-t-${mode}">
    <div class="dsec__head"><h3 id="ord-hist-t-${mode}">Histórico</h3><span class="muted small">${plural(events.length, 'registro', 'registros')}</span></div>
    ${events.length
      ? html`<ol class="ord-tl">${events.map((e) => {
          const info = eventInfo(e);
          const msg = e.type !== 'created' && e.message && e.message !== info.title && e.message !== DEFAULT_MSG[e.status] ? e.message : '';
          const who = e.actor_name || (e.type === 'created' ? o.customer_name : 'sistema');
          const vis = e.visible_to_customer ? html`visível ao cliente` : html`<b class="tl__vis">Interna</b>`;
          return html`<li class="ord-tl__i">
            <span class="ord-tl__ico ${info.tone ? `ord-tl__ico--${info.tone}` : ''}" aria-hidden="true">${icon(info.ico, 'icon-xs')}</span>
            <div class="ord-tl__txt">
              ${e.type === 'note' ? html`<span class="ord-pre">${e.message}</span>` : html`<span>${info.title}${e.type === 'payment' && e.message ? html`: ${e.message.replace(/^Pagamento /, '').toLowerCase()}` : ''}</span>${msg && e.type !== 'payment' ? html`<span class="tl__note ord-pre">${msg}</span>` : ''}`}
              <span class="ord-tl__meta" title="${datetime(e.created_at)}">${whenShort(e.created_at)} · ${who} · ${vis}</span>
            </div>
          </li>`;
        })}</ol>`
      : html`<p class="muted small">Nenhum registro ainda.</p>`}
    ${p
      ? html`<form class="ord-composer" data-note-form novalidate>
          <div class="field ord-composer__field">
            <label class="visually-hidden" for="on-msg-${mode}">Nova nota</label>
            <textarea class="ord-composer__box" id="on-msg-${mode}" name="message" rows="3" maxlength="2000" placeholder="Escreva uma nota sobre o pedido…" data-keep></textarea>
          </div>
          <div class="ord-composer__bar">
            <label class="switch"><input type="checkbox" id="on-vis-${mode}" name="visible" data-keep><span class="switch__track"></span><span class="switch__txt"><strong>Visível para o cliente</strong></span></label>
            <button class="btn btn--sm btn--dark" type="submit" title="Ctrl + Enter">Adicionar</button>
          </div>
        </form>
        <p class="ord-composer__hint">Desligado, só a equipe vê.<span class="kbd kbd--sm">Ctrl</span><span class="kbd kbd--sm">Enter</span><span class="ord-kbd-txt">adiciona.</span></p>`
      : ''}
  </section>`;
}

function footHtml(ctx, o) {
  const p = { orders: ctx.can('orders', o.store_id), reopen: canReopen(ctx, o) };
  const next = NEXT[o.status];
  const locked = CLOSED.includes(o.status) && !p.reopen;
  return html`${p.orders && o.status !== 'canceled'
      ? html`<button class="btn btn--danger-ghost ord-foot__cancel" type="button" data-cancel ${locked ? html`disabled title="Somente o administrador da loja cancela pedidos entregues"` : ''}>${icon('xCircle', 'icon-sm')} Cancelar pedido</button>`
      : ''}
    <span class="grow"></span>
    <button class="btn ord-foot__print" type="button" data-print title="Imprimir romaneio · P" aria-label="Imprimir romaneio">${icon('printer', 'icon-sm')}<span class="ord-foot__t">Imprimir</span></button>
    ${p.orders ? html`<button class="btn" type="button" data-status-menu aria-haspopup="dialog" aria-expanded="false" title="Mudar status · S">${icon('sync', 'icon-sm')} Mudar status ${icon('chevronDown', 'icon-xs')}</button>` : ''}
    ${p.orders && next ? html`<button class="btn btn--primary" type="button" data-to="${next.status}" data-primary title="${next.label} · E">${icon(next.icon, 'icon-sm')} ${next.label}</button>` : ''}
`;
}

// Barra fixa do celular: ⋯ · WhatsApp · ação principal
function mobileBarHtml(ctx, o) {
  const p = ctx.can('orders', o.store_id);
  const next = NEXT[o.status];
  const wa = waUrl(ctx, o);
  return html`<div class="ord-mbar" role="region" aria-label="Ações do pedido">
    <button class="btn btn--touch btn--icon ord-mbar__more" type="button" data-ord-more aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">${icon('dots')}</button>
    ${wa ? html`<a class="btn btn--touch ord-wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 'icon-sm')} WhatsApp</a>` : ''}
    ${p && next
      ? html`<button class="btn btn--primary btn--touch ord-mbar__go" type="button" data-to="${next.status}" data-primary>${icon(next.icon, 'icon-sm')} ${next.short}</button>`
      : p
        ? html`<button class="btn btn--touch ord-mbar__go" type="button" data-status-menu aria-haspopup="dialog">${icon('sync', 'icon-sm')} Mudar status</button>`
        : ''}
  </div>`;
}

// Diálogo "Entrega": data agendada (calendário + digitação dd/mm/aaaa) e observações internas
function deliveryDialog(ctx, o, { onSaved }) {
  const min = spDay(o.created_at);
  const today = spDay(Date.now());
  let sel = o.scheduled_date || '';
  let month = (sel || (today > min ? today : min)).slice(0, 7);
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const calHtml = () => {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < start; i++) cells.push(html`<span class="cal__d is-out" aria-hidden="true"></span>`);
    for (let d = 1; d <= days; d++) {
      const s = ymd(y, m, d);
      const dis = s < min;
      const on = s === sel;
      cells.push(
        html`<button type="button" class="cal__d ${on ? 'is-from is-to is-single' : ''} ${s === today ? 'is-today' : ''}" data-day="${s}" aria-pressed="${on ? 'true' : 'false'}" tabindex="${on || (!sel && s === today) ? '0' : '-1'}" aria-label="${d} de ${MONTHS[m - 1]} de ${y}${s === today ? ', hoje' : ''}" ${dis ? 'disabled' : ''}>${d}</button>`
      );
    }
    const prevDisabled = `${month}-01` <= min.slice(0, 7) + '-01';
    return html`<div class="cal__nav"><button type="button" class="btn btn--ghost btn--icon btn--sm" data-mo="-1" aria-label="Mês anterior" ${prevDisabled ? 'disabled' : ''}>${icon('chevronLeft', 'icon-sm')}</button><span class="grow"></span><button type="button" class="btn btn--ghost btn--icon btn--sm" data-mo="1" aria-label="Próximo mês">${icon('chevronRight', 'icon-sm')}</button></div>
      <div class="cal__mt" aria-live="polite">${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)} ${y}</div>
      <div class="cal__dow" aria-hidden="true">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => html`<span>${x}</span>`)}</div>
      <div class="cal__grid" role="group" aria-label="Escolher a data de entrega">${cells}</div>`;
  };
  openModal({
    title: `Entrega do pedido ${o.code}`,
    size: 'sm',
    cls: 'ord-deliv-dlg',
    body: html`<form class="stack" data-delivery-form novalidate style="--gap:16px">
      <div class="field">
        <label for="od-date">Data de entrega agendada</label>
        <div class="ord-date">
          <input class="input mono-num" id="od-date" name="scheduled_date" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" maxlength="10" value="${brFull(sel)}">
          <span class="chips ord-date__chips">
            <button class="chip" type="button" data-quick="${today >= min ? today : min}">Hoje</button>
            <button class="chip" type="button" data-quick="${spDay(Date.now() + 86400000)}">Amanhã</button>
            <button class="chip" type="button" data-quick="">A combinar</button>
          </span>
        </div>
        <div class="ord-cal" data-cal>${calHtml()}</div>
        <span class="hint">O cliente vê esta data no acompanhamento do pedido.</span>
      </div>
      <div class="field">
        <label class="label" for="od-notes"><span>Observações internas</span><span class="opt-tag">só a equipe vê</span></label>
        <textarea class="textarea" id="od-notes" name="internal_notes" rows="3" maxlength="2000" placeholder="Ex.: montar no local, subir 2 andares">${o.internal_notes || ''}</textarea>
      </div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Voltar</button><button class="btn btn--primary" type="button" data-ok>Salvar entrega</button>`,
    onMount(el, close) {
      const form = $('[data-delivery-form]', el);
      const input = form.scheduled_date;
      const cal = $('[data-cal]', el);
      const paint = (focusDay) => {
        render(cal, calHtml());
        if (focusDay) $(`[data-day="${focusDay}"]`, cal)?.focus();
      };
      const pick = (s, { focus } = {}) => {
        sel = s;
        input.value = brFull(s);
        if (s) month = s.slice(0, 7);
        paint(focus ? s : null);
      };
      cal.addEventListener('click', (e) => {
        const mo = e.target.closest('[data-mo]');
        if (mo && !mo.disabled) {
          const [y, m] = month.split('-').map(Number);
          const dt = new Date(y, m - 1 + Number(mo.dataset.mo), 1);
          month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          paint();
          return;
        }
        const d = e.target.closest('[data-day]');
        if (d && !d.disabled) pick(d.dataset.day, { focus: true });
      });
      cal.addEventListener('keydown', (e) => {
        const d = e.target.closest('[data-day]');
        if (!d) return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (!step) return;
        e.preventDefault();
        const dt = new Date(`${d.dataset.day}T12:00:00`);
        dt.setDate(dt.getDate() + step);
        const s = ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
        if (s < min) return;
        month = s.slice(0, 7);
        paint();
        const b = $(`[data-day="${s}"]`, cal);
        if (b) {
          $$('[data-day]', cal).forEach((x) => (x.tabIndex = -1));
          b.tabIndex = 0;
          b.focus();
        }
      });
      el.addEventListener('click', (e) => {
        const qk = e.target.closest('[data-quick]');
        if (qk) pick(qk.dataset.quick);
      });
      // máscara dd/mm/aaaa
      input.addEventListener('input', () => {
        const dgt = digitsOf(input.value).slice(0, 8);
        input.value = [dgt.slice(0, 2), dgt.slice(2, 4), dgt.slice(4)].filter(Boolean).join('/');
        if (dgt.length === 8) {
          const s = `${dgt.slice(4)}-${dgt.slice(2, 4)}-${dgt.slice(0, 2)}`;
          if (!Number.isNaN(new Date(`${s}T12:00:00`).getTime()) && YMD_RE.test(s)) {
            sel = s;
            month = s.slice(0, 7);
            paint();
          }
        } else if (!dgt.length) {
          sel = '';
          paint();
        }
      });
      const submit = async () => {
        const raw = input.value.trim();
        const dgt = digitsOf(raw);
        let ymdv = '';
        const errors = {};
        if (raw) {
          ymdv = dgt.length === 8 ? `${dgt.slice(4)}-${dgt.slice(2, 4)}-${dgt.slice(0, 2)}` : '';
          const dt = ymdv ? new Date(`${ymdv}T12:00:00`) : null;
          if (!ymdv || Number.isNaN(dt.getTime()) || isoDay(dt) !== ymdv) errors.scheduled_date = 'Data inválida. Use dd/mm/aaaa.';
          else if (ymdv < min) errors.scheduled_date = 'A entrega não pode ser antes do dia do pedido.';
        }
        const notes = form.internal_notes.value.trim();
        if (notes.length > 2000) errors.internal_notes = 'Use até 2.000 caracteres.';
        if (!showErrors(form, errors)) return;
        try {
          await withBusy($('[data-ok]', el), async () => {
            const rows = await q(sb.from('orders').update({ scheduled_date: ymdv || null, internal_notes: notes || null }).eq('id', o.id).select('id'));
            if (!rows?.length) throw new Error('Você não tem permissão para alterar este pedido.');
          });
        } catch (err) {
          toastError(err);
          return;
        }
        close();
        toast(ymdv ? `Entrega agendada para ${dayLabel(ymdv)}.` : 'Dados de entrega salvos.', 'success');
        onSaved?.();
      };
      $('[data-ok]', el).addEventListener('click', submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit();
      });
    },
  });
}

/* ---------- Controlador do detalhe (gaveta ou página) ---------- */
function orderController(ctx, { id, mode, host, list, listHash, onChanged, onHead }) {
  let state = null;
  let ownUntil = 0;
  let acting = 0;
  let timer = null;
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
  const c = {
    get id() {
      return id;
    },
    get state() {
      return state;
    },
    setId(v) {
      id = v;
      state = null;
    },
    async load() {
      state = await fetchOrder(id);
      return state;
    },
    async reload({ announce = false } = {}) {
      try {
        const next = await fetchOrder(id);
        if (!next.order) return c.draw();
        const changed = state?.order && (state.order.status !== next.order.status || state.order.payment_status !== next.order.payment_status);
        if (state?.order?.id === next.order.id) next.custCount = state.custCount;
        state = next;
        c.draw();
        if (announce && changed && Date.now() > ownUntil) toast(`Pedido ${next.order.code} atualizado: ${ORDER_STATUS[next.order.status]?.label}.`, 'info');
      } catch (e) {
        toastError(e);
      }
    },
    draw: () => {},
    after: () => onChanged?.(),
    remoteUpdate(row) {
      if (!state?.order || row.id !== id || sameTime(row.updated_at, state.order.updated_at)) return;
      clearTimeout(timer);
      const check = () => {
        if (sameTime(row.updated_at, state.order.updated_at)) return;
        if (acting) {
          timer = setTimeout(check, 500);
          return;
        }
        c.reload({ announce: true });
      };
      timer = setTimeout(check, 300);
    },
    dispose() {
      clearTimeout(timer);
    },
    // preserva o que a pessoa estava digitando entre redesenhos
    keep(root) {
      const kept = {};
      $$('[data-keep]', root).forEach((el) => {
        const dirty = el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue;
        if (dirty) kept[el.id] = el.type === 'checkbox' ? el.checked : el.value;
      });
      const focusId = root.contains(document.activeElement) ? document.activeElement.id : '';
      return () => {
        for (const [k, v] of Object.entries(kept)) {
          const el = document.getElementById(k);
          if (!el) continue;
          if (el.type === 'checkbox') el.checked = v;
          else el.value = v;
        }
        if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
      };
    },
  };

  const done = () => act(async () => {
    await c.reload();
    c.after();
  });

  async function onPayment(status, btn) {
    const o = state.order;
    if (status === 'refunded') {
      const ok = await confirmDialog({
        title: 'Marcar como estornado?',
        message: `Confirme que o valor de ${money(o.total)} do pedido ${o.code} foi devolvido ao cliente.`,
        confirmLabel: 'Marcar como estornado',
        danger: true,
      });
      if (!ok) return;
    }
    await act(async () => {
      try {
        await withBusy(btn, () => rpc('set_order_payment', { p_order: o.id, p_payment_status: status }), 'Salvando…');
      } catch (e) {
        toastError(e);
        return;
      }
      toast(`Pagamento do pedido ${o.code}: ${PAY_SHORT[status].toLowerCase()}.`, 'success');
      await c.reload();
      c.after();
    });
  }

  async function primary(status, btn) {
    const o = state.order;
    if (status === 'delivered') {
      const ok = await confirmDialog({
        title: `Marcar ${o.code} como entregue?`,
        message: canReopen(ctx, o) ? 'O pedido sai da fila de entregas. Dá para reabrir depois.' : 'Depois disso, só o administrador da loja pode reabrir este pedido.',
        confirmLabel: 'Marcar como entregue',
      });
      if (!ok) return;
    }
    if (CLOSED.includes(o.status) && !canReopen(ctx, o)) {
      toastError(new Error('Somente o administrador da loja reabre pedidos entregues ou cancelados.'));
      return;
    }
    await act(() => moveOrder(ctx, o, status, { visible: true, btn, onDone: done }));
  }

  const openStatus = (anchor) => {
    const o = state.order;
    if (isMobile()) statusSheet(ctx, o, { items: state.items, onDone: done });
    else togglePop(anchor, () => statusPop(anchor, ctx, [o], { items: state.items, onDone: done }));
  };
  const doPrint = () => printOrders(ctx, [{ order: state.order, items: state.items }]);

  c.handleClick = async (e) => {
    if (!state?.order) return;
    const t = e.target;
    const o = state.order;
    const to = t.closest('[data-to]');
    if (to && !to.disabled) {
      if (to.dataset.to === 'pending' && CLOSED.includes(o.status)) {
        if (!canReopen(ctx, o)) return toastError(new Error('Somente o administrador da loja reabre pedidos entregues ou cancelados.'));
        const ok = await confirmDialog({
          title: `Reabrir o pedido ${o.code}?`,
          message: o.status === 'canceled' ? 'Ele volta para “Aguardando confirmação” e os itens voltam a sair do estoque.' : 'Ele volta para “Aguardando confirmação”.',
          confirmLabel: 'Reabrir pedido',
        });
        if (!ok) return;
        return act(() => moveOrder(ctx, o, 'pending', { visible: true, btn: to, onDone: done }));
      }
      return primary(to.dataset.to, to);
    }
    const sm = t.closest('[data-status-menu]');
    if (sm) return openStatus(sm);
    if (t.closest('[data-cancel]')) return cancelDialog(ctx, [o], { items: state.items, onDone: done });
    const pay = t.closest('[data-pay]');
    if (pay) return onPayment(pay.dataset.pay, pay);
    const pm = t.closest('[data-pay-menu]');
    if (pm) {
      return togglePop(pm, () =>
        popMenu(pm, {
          label: 'Alterar pagamento',
          title: 'Pagamento',
          items: PAY_ACTIONS.filter(([s]) => s !== o.payment_status).map(([s, label, ic]) => ({ label, icon: ic, onClick: () => onPayment(s, pm) })),
        })
      );
    }
    if (t.closest('[data-print]')) return doPrint();
    if (t.closest('[data-delivery]')) return deliveryDialog(ctx, o, { onSaved: done });
    const cv = t.closest('[data-copy-value]');
    if (cv) {
      if (await copyText(cv.dataset.copyValue)) toast('Valor copiado.', 'success');
      else promptDialog({ title: 'Valor do pedido', label: 'Copie o valor abaixo', value: cv.dataset.copyValue, confirmLabel: 'Fechar' });
      return;
    }
    const copy = t.closest('[data-copy]');
    if (copy) {
      if (await copyText(copy.dataset.copy)) toast('Link de acompanhamento copiado.', 'success');
      else promptDialog({ title: 'Link de acompanhamento', label: 'Copie o link abaixo', value: copy.dataset.copy, confirmLabel: 'Fechar' });
      return;
    }
    const sw = t.closest('[data-switch-store]');
    if (sw) return ctx.setStore(sw.dataset.switchStore, `#/orders/${o.id}`);
    const more = t.closest('[data-ord-more]');
    if (more) {
      const p = ctx.can('orders', o.store_id);
      const locked = CLOSED.includes(o.status) && !canReopen(ctx, o);
      return togglePop(more, () =>
        popMenu(more, {
          label: 'Mais ações',
          items: [
            ...(p ? [{ label: 'Mudar status', icon: 'sync', onClick: () => openStatus(more) }] : []),
            { label: 'Imprimir romaneio', icon: 'printer', onClick: doPrint },
            ...(p ? [{ label: o.scheduled_date ? 'Editar entrega' : 'Agendar entrega', icon: 'calendar', onClick: () => deliveryDialog(ctx, o, { onSaved: done }) }] : []),
            { label: 'Copiar link de acompanhamento', icon: 'link', onClick: async () => ((await copyText(trackUrl(o))) ? toast('Link de acompanhamento copiado.', 'success') : null) },
            ...(p && o.status !== 'canceled' ? ['sep', { label: 'Cancelar pedido…', icon: 'xCircle', danger: true, disabled: locked, onClick: () => cancelDialog(ctx, [o], { items: state.items, onDone: done }) }] : []),
          ],
        })
      );
    }
  };

  c.handleSubmit = async (e) => {
    const form = e.target;
    if (!form.matches('[data-note-form]')) return;
    e.preventDefault();
    const message = form.message.value.trim();
    if (!showErrors(form, message ? {} : { message: 'Escreva a nota.' })) return;
    const visible = form.visible.checked;
    await act(async () => {
      try {
        await withBusy(form.querySelector('[type="submit"]'), () => rpc('add_order_note', { p_order: id, p_message: message, p_visible: visible }), 'Salvando…');
      } catch (err) {
        toastError(err);
        return;
      }
      form.reset();
      toast(visible ? 'Nota adicionada (visível para o cliente).' : 'Nota interna adicionada.', 'success');
      await c.reload();
    });
  };

  let gAt = 0;
  c.handleKey = (e) => {
    if (!state?.order || e.altKey || e.metaKey || e.defaultPrevented) return;
    if (e.ctrlKey && e.key === 'Enter' && e.target.matches('textarea[name="message"]')) {
      e.preventDefault();
      e.target.form?.requestSubmit();
      return;
    }
    if (e.ctrlKey || e.target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
    const k = e.key.toLowerCase();
    // "G + letra" é atalho de navegação do painel: não confundir com P/S/E
    if (k === 'g') {
      gAt = Date.now();
      return;
    }
    if (Date.now() - gAt < 1300) return;
    if (k === 'p') {
      e.preventDefault();
      doPrint();
    } else if (k === 's') {
      const b = $('[data-status-menu]', host());
      if (b) {
        e.preventDefault();
        openStatus(b);
      }
    } else if (k === 'e') {
      const b = $('[data-primary]', host());
      if (b && !b.disabled) {
        e.preventDefault();
        b.click();
      }
    }
  };

  c.fillCustomerCount = async () => {
    const o = state?.order;
    if (!o) return;
    const n = await customerOrders(o);
    if (n === null || state?.order?.id !== o.id) return;
    state.custCount = n;
    const el = $('[data-cust-count]', host());
    if (!el) return;
    el.textContent = custCountLabel(n);
    el.hidden = false;
  };

  return c;
}

/* ---------- Gaveta ---------- */
function orderDrawer(ctx, id, { list, listHash, onChanged, onClose }) {
  let keepHash = false;
  let drawerHash = `#/orders/${id}`;
  const navOf = () => {
    const ids = list();
    const index = ids.indexOf(ctl.id);
    return index >= 0 ? { index, total: ids.length } : null;
  };
  let d;
  const ctl = orderController(ctx, { id, mode: 'drawer', host: () => d.el, list, listHash, onChanged });
  ctl.draw = () => {
    const s = ctl.state;
    if (!s?.order) {
      d.setContent({
        head: html`<div class="ord-dh"><h2 class="drawer__code">Pedido não encontrado</h2></div>`,
        body: html`<div class="ord-dmain">${empty('Pedido não encontrado', 'Ele pode ter sido excluído ou pertence a uma loja à qual você não tem acesso.', '', { art: 'site:empty-search', size: 'sm' })}</div>`,
        side: '',
        foot: html`<span class="grow"></span><button class="btn" type="button" data-close>Fechar</button>`,
      });
      return;
    }
    const restore = ctl.keep(d.el);
    const nav = navOf();
    d.setContent({ head: headHtml(ctx, s.order, s.items, nav || { index: 0, total: 1 }), body: bodyHtml(ctx, s, { mode: 'drawer' }), side: sideHtml(ctx, s, { mode: 'drawer' }), foot: footHtml(ctx, s.order) });
    const h = $('.modal__head h2.visually-hidden', d.el);
    if (h) h.textContent = `Pedido ${s.order.code}`;
    restore();
  };

  d = drawer({
    title: 'Pedido',
    head: html`<div class="ord-dh"><div class="ord-dh__top"><span class="skeleton" style="width:200px;height:12px"></span></div><div class="ord-dh__title"><span class="skeleton" style="width:150px;height:26px"></span></div></div>`,
    body: html`<div class="ord-dskel">${skeleton('list', { rows: 4 })}</div>`,
    side: html`${skeleton('list', { rows: 3 })}`,
    foot: html`<span class="grow"></span>`,
    cls: 'ord-drawer',
    onClose: () => {
      ctl.dispose();
      document.removeEventListener('keydown', onDocKey, true);
      if (!keepHash && location.hash === drawerHash) history.replaceState(null, '', listHash());
      onClose?.();
    },
    onMount: (el) => {
      el.addEventListener('click', async (e) => {
        const nb = e.target.closest('[data-nav]');
        if (nb && !nb.disabled) return step(Number(nb.dataset.nav));
        const full = e.target.closest('[data-full]');
        if (full) {
          e.preventDefault();
          keepHash = true;
          const target = `#/orders/${ctl.id}`;
          d.close();
          ctx.navigate(target);
          return;
        }
        // links para outras telas fecham a gaveta sem reescrever o endereço de destino
        const a = e.target.closest('a[href^="#/"], [data-switch-store]');
        if (a) keepHash = true;
        ctl.handleClick(e);
      });
      el.addEventListener('submit', (e) => ctl.handleSubmit(e));
      el.addEventListener('keydown', (e) => ctl.handleKey(e));
    },
  });

  // J/K e setas trocam de pedido (fora de campos)
  const onDocKey = (e) => {
    if (!d.el.isConnected || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
    if (document.querySelector('.modal, .pop, .sheet, .cmdk')) return;
    const k = e.key;
    if (k === 'j' || k === 'J' || k === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (k === 'k' || k === 'K' || k === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  };
  document.addEventListener('keydown', onDocKey, true);

  async function show(newId) {
    ctl.setId(newId);
    markSeen(newId);
    drawerHash = `#/orders/${newId}`;
    if (location.hash !== drawerHash) history.replaceState(null, '', drawerHash);
    try {
      await ctl.load();
    } catch (e) {
      if (!d.el.isConnected) return;
      d.setContent({
        head: html`<div class="ord-dh"><h2 class="drawer__code">Pedido</h2></div>`,
        body: html`<div class="ord-dmain">${errorBlock(e, { retry: () => show(newId), title: 'Não foi possível abrir o pedido' })}</div>`,
        side: '',
        foot: html`<span class="grow"></span><button class="btn" type="button" data-close>Fechar</button>`,
      });
      return;
    }
    if (!d.el.isConnected || ctl.id !== newId) return;
    ctl.draw();
    ctl.fillCustomerCount();
    $('.modal__body', d.el)?.scrollTo(0, 0);
    // o conteúdo foi trocado: o foco vai para o código do pedido (leitor de tela anuncia o novo pedido)
    if (!d.el.contains(document.activeElement) || document.activeElement === d.el) $('.drawer__code', d.el)?.focus({ preventScroll: true });
  }
  function step(dir) {
    const ids = list();
    const i = ids.indexOf(ctl.id);
    const next = ids[i + dir];
    if (i < 0 || !next) return;
    show(next);
  }
  show(id);

  return {
    go: (newId) => show(newId),
    remoteUpdate: (row) => ctl.remoteUpdate(row),
    close: ({ restore = true } = {}) => {
      keepHash = !restore;
      d.close();
    },
  };
}

/* ---------- Página inteira ---------- */
async function renderDetail(view, ctx, id) {
  const back = lastListHash;
  const notFound = () => {
    ctx.setTitle('Pedido não encontrado', '', { back, crumbs: [['Pedidos', back], ['Não encontrado']] });
    render(
      view,
      html`<div class="card">${empty('Pedido não encontrado', 'Ele pode ter sido excluído ou pertence a uma loja à qual você não tem acesso.', html`<a class="btn" href="${back}">${icon('chevronLeft', 'icon-sm')} Voltar para os pedidos</a>`, {
        art: 'site:empty-search',
      })}</div>`
    );
  };
  if (!UUID_RE.test(id)) return notFound();
  markSeen(id);
  ctx.setTitle('Pedido', '', { back, crumbs: [['Pedidos', back], ['Pedido']] });
  render(view, html`<div class="ord-page" aria-busy="true"><div class="ord-page__main">${skeleton('list', { rows: 4 })}</div><aside class="ord-page__side card">${skeleton('list', { rows: 3 })}</aside></div>`);

  const ctl = orderController(ctx, { id, mode: 'page', host: () => view, onChanged: null });
  try {
    await ctl.load();
  } catch (e) {
    render(view, html`${errorBlock(e, { retry: () => ctx.navigate(`#/orders/${id}`), title: 'Não foi possível abrir o pedido' })}`);
    return;
  }
  if (!ctl.state.order) return notFound();

  ctl.draw = () => {
    const s = ctl.state;
    if (!s?.order) return notFound();
    const o = s.order;
    const restore = ctl.keep(view);
    const qty = itemQty(s.items);
    ctx.setTitle(
      o.code,
      html`<span class="ord-sub">${statusBadge(o.status)}${payStatus(o.payment_status, { long: true })}${o.status === 'pending' ? ageChip(o.created_at, { prefix: 'aguardando há ' }) : ''}${
        o.source === 'demo' ? badge('Demonstração', 'plain') : ''
      }<span class="ord-sub__meta">${whenShort(o.created_at)} · ${ctx.storeName(o.store_id)} · ${plural(qty, 'item', 'itens')} · <b>${money(o.total)}</b></span></span>`,
      { back, crumbs: [['Pedidos', back], [o.code]] }
    );
    ctx.setActions(html`<div class="ord-pacts">${footHtml(ctx, o)}</div>`);
    render(
      view,
      html`<div class="ord-page">
        <div class="ord-page__main">${bodyHtml(ctx, s, { mode: 'page' })}</div>
        <aside class="ord-page__side card">${sideHtml(ctx, s, { mode: 'page' })}</aside>
        ${mobileBarHtml(ctx, o)}
      </div>`
    );
    restore();
  };
  ctl.draw();
  ctl.fillCustomerCount();
  if (isMobile()) document.documentElement.style.setProperty('--bar-h', '68px');

  const actions = $('[data-actions]');
  const onActions = (e) => ctl.handleClick(e);
  actions?.addEventListener('click', onActions);
  view.addEventListener('click', (e) => ctl.handleClick(e));
  view.addEventListener('submit', (e) => ctl.handleSubmit(e));
  const onKey = (e) => {
    if (document.querySelector('.modal, .panel, .pop, .cmdk')) return;
    ctl.handleKey(e);
  };
  document.addEventListener('keydown', onKey);
  ctx.on('order-updated', (row) => ctl.remoteUpdate(row));
  ctx.onCleanup(() => {
    ctl.dispose();
    actions?.removeEventListener('click', onActions);
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.removeProperty('--bar-h');
  });
}

/* =========================================================
   Estilos do módulo (só o que é específico de pedidos)
   ========================================================= */
const CSS = `
/* cabeçalho da página: a trilha substitui o "Voltar" no computador */
.page-head__back:has(+ .crumbs:not([hidden])) { display: none; }
@media (max-width: 767px) { .page-head__back:has(+ .crumbs:not([hidden])) + .crumbs { display: none; } }

/* ---------- Lista ---------- */
.ord-card { overflow: visible; }
.ord-tabs { padding: 0 12px; }
.ord-tb { align-items: center; }
.ord-tb__search { flex: 1 1 240px; max-width: 340px; min-width: 200px; }
.ord-tb__search .input { padding-right: 36px; }
.ord-tb__search .input::-webkit-search-cancel-button { display: none; }
.ord-tb__more { display: contents; }
.ord-tb__f { display: flex; min-width: 0; }
.ord-tb__f .sel__trigger { min-width: 168px; }
.ord-tb__f--stores .sel__trigger { min-width: 200px; max-width: 300px; }
.ord-tb__toggle { display: none; }
.ord-tb__date { gap: 8px; font-weight: 600; }
.ord-tb__date.is-set { border-color: var(--ink); }
.ord-tb__sort { display: none; }
.ord-tb__density { flex: none; }
.ord-results { transition: opacity var(--dur-2); min-height: 120px; }
.ord-results.is-busy { opacity: .55; pointer-events: none; }
.ord-custfilter { align-items: center; margin: 12px 16px; }
.ord-th-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.ord-th-sort:hover { color: var(--ink); }
.ord-table .ord-c-code { white-space: nowrap; }
.ord-code { color: var(--ink); text-decoration: none; font-size: 13.5px; }
.ord-code:hover { color: var(--accent-ink); text-decoration: underline; }
.ord-table .sub .age { font-size: 12.5px; }
.ord-name { display: block; max-width: 240px; }
.ord-table .ord-c-cust .sub { max-width: 240px; }
.ord-store { display: inline-flex; align-items: center; gap: 8px; max-width: 170px; font-size: 13px; color: var(--text); }
.ord-store .ellipsis { min-width: 0; }
.ord-table .pay__m { max-width: 200px; }
.ord-c-go { width: 44px; text-align: right; }
.ord-go { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; color: var(--muted); transition: background-color var(--dur-1), color var(--dur-1); }
.ord-table tr:hover .ord-go { background: var(--surface-3); color: var(--ink); }
.ord-cards { display: none; }
.ord-empty { padding: 12px 0 4px; }
.ord-empty .errblock { margin: 24px auto; }

/* barra de lote acima do rodapé */
.ord-bulk { z-index: var(--z-bar); }
.ord-statuspop { width: 352px; }
.ord-statuspop .opt { gap: 12px; }
.ord-statuspop .kbd { margin-left: auto; flex: none; }
.ord-pop button.opt { cursor: pointer; }
.ord-pop button.opt:hover:not(:disabled), .ord-pop button.opt:focus-visible { background: var(--opt-active); }
.ord-pop button.opt:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.ord-pop button.opt:disabled { color: var(--faint); cursor: not-allowed; }
.ord-pop button.opt > .icon-sm { color: var(--muted); flex: none; }
.ord-opt--danger, .ord-opt--danger .opt__label { color: var(--bad-fg); }
.ord-opt__ico--bad { background: var(--bad-bg); color: var(--bad-fg); width: 26px; height: 26px; }
.ord-pop__note { display: flex; gap: 6px; align-items: flex-start; margin: 0 4px 6px; padding: 8px 10px; border-radius: 10px; background: var(--warn-bg); color: var(--warn-fg); font-size: 12.5px; line-height: 1.35; }
.ord-pop__foot { flex-direction: column; align-items: stretch; gap: 10px; padding: 12px; }
.ord-pop__foot .switch__txt strong { font-size: 13px; }
.ord-pop__msg { height: 36px; font-size: 13px; }
.ord-menu { min-width: 236px; }
.ord-block { display: block; }

/* ---------- Detalhe: gaveta ---------- */
.ord-drawer .modal__head { padding: 16px 18px 14px 24px; }
.ord-dh { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ord-dh__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; }
.ord-dh__store { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--muted); }
.ord-dh__nav { display: inline-flex; align-items: center; gap: 2px; flex: none; color: var(--muted); font-size: 12.5px; }
.ord-dh__title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.ord-dh__title .drawer__code { margin-right: 2px; border-radius: 6px; }
.ord-dh__title .drawer__code:focus { outline: none; }
.ord-dh__title .drawer__code:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.ord-dh__meta { font-size: 13px; color: var(--muted); }
.ord-dh__meta b { color: var(--ink); font-weight: 700; }
.ord-drawer .drawer__main { gap: 14px; }
.ord-drawer .drawer__side { gap: 0; }
.ord-dskel { padding: 24px; }
.ord-dmain { padding: 24px; }
.ord-drawer .modal__foot { justify-content: flex-start; }
.ord-drawer .modal__foot > .grow { flex: 1; }

/* blocos compartilhados (gaveta e página) */
.ord-progress { padding: 4px 0 2px; }
.ord-mprog { display: none; }
.ord-items .ord-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
.ord-items .ord-item + .ord-item { border-top: 1px dashed var(--line-strong); }
.ord-item__txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ord-item__txt .cell-strong { font-weight: 600; color: var(--ink); font-size: 13.5px; }
.ord-item__qty { white-space: nowrap; }
.ord-item__tot { white-space: nowrap; font-weight: 600; color: var(--ink); min-width: 92px; text-align: right; }
.ord-thumb-empty { display: grid; place-items: center; color: var(--faint); }
.ord-removed { color: var(--warn-fg); }
.ord-totals { margin: 6px 0 0; padding-top: 10px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
.ord-totals > div { display: flex; justify-content: space-between; gap: 12px; }
.ord-totals dt { color: var(--muted); }
.ord-totals dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ord-totals .ord-ok { color: var(--ok-fg); font-weight: 600; }
.ord-totals__sum { padding-top: 6px; }
.ord-totals__sum dt { color: var(--ink) !important; font-weight: 700; }
.ord-totals__sum dd { font: 800 18px/1 var(--font-display); letter-spacing: -0.01em; }
.ord-coupon { display: inline-block; margin-left: 4px; padding: 0 6px; border: 1px dashed var(--line-strong); border-radius: 5px; font-size: 11.5px; font-weight: 700; color: var(--ink); }
.ord-paybar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); }
.ord-paybar .pay__m { font-size: 13px; }
.ord-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.ord-cust__name { font-weight: 600; color: var(--ink); font-size: 14px; margin-bottom: 4px; overflow-wrap: anywhere; }
.ord-line { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--text); margin-top: 6px; line-height: 1.4; min-width: 0; overflow-wrap: anywhere; }
.ord-line > .icon-sm { color: var(--muted); margin-top: 1px; flex: none; }
.ord-line a { color: var(--text); }
.ord-line a:hover { color: var(--accent-ink); }
.ord-warn { color: var(--warn-fg); font-weight: 600; }
.ord-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.ord-deliv .ord-btns { gap: 4px; }
.ord-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 10px; font-size: 13px; color: var(--faint); }
.ord-links a { font-weight: 600; }
.ord-wa .icon-sm { color: #1f9d55; }
.ord-inote { margin-top: 10px; }
.ord-inote strong { display: block; font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 2px; }
.ord-pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.ord-canceled { align-items: center; }
.callout .grow { min-width: 0; }

/* histórico + nota */
.ord-hist { display: flex; flex-direction: column; min-height: 100%; }
.ord-tl { list-style: none; margin: 0 0 4px; padding: 0; position: relative; flex: 1; }
.ord-tl__i { position: relative; display: flex; gap: 12px; padding: 0 0 16px; }
.ord-tl__i:not(:last-child)::before { content: ''; position: absolute; left: 13px; top: 30px; bottom: 2px; width: 2px; border-radius: 2px; background: var(--line); }
.ord-tl__ico { position: relative; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--surface); color: var(--muted); box-shadow: inset 0 0 0 1.5px var(--line-strong); }
.ord-tl__ico--warn { background: var(--warn-bg); color: var(--warn-fg); box-shadow: inset 0 0 0 1.5px var(--warn-line); }
.ord-tl__ico--info { background: var(--info-bg); color: var(--info-fg); box-shadow: inset 0 0 0 1.5px var(--info-line); }
.ord-tl__ico--plum { background: var(--plum-bg); color: var(--plum-fg); box-shadow: inset 0 0 0 1.5px var(--plum-line); }
.ord-tl__ico--ora, .ord-tl__ico--note { background: var(--highlight-soft); color: var(--highlight-ink); box-shadow: inset 0 0 0 1.5px var(--ora-line); }
.ord-tl__ico--ok { background: var(--ok-bg); color: var(--ok-fg); box-shadow: inset 0 0 0 1.5px var(--ok-line); }
.ord-tl__ico--bad { background: var(--bad-bg); color: var(--bad-fg); box-shadow: inset 0 0 0 1.5px var(--bad-line); }
.ord-tl__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-top: 4px; font-size: 13.5px; color: var(--ink); line-height: 1.4; }
.ord-tl__txt .tl__note { margin-top: 4px; }
.ord-tl__meta { font-size: 12.5px; color: var(--muted); }
.tl__vis { font-weight: 600; color: var(--highlight-ink); }
.ord-composer { margin-top: 12px; }
.ord-composer__field { gap: 0; border: 1px solid var(--field-line); border-radius: 13px; background: var(--field); overflow: hidden; box-shadow: inset 0 1px 2px rgba(59, 39, 25, .05); }
.ord-composer__field:focus-within { border-color: var(--focus); box-shadow: 0 0 0 3px var(--focus-ring); }
.ord-composer__box { display: block; width: 100%; min-height: 72px; padding: 10px 12px; border: 0; background: transparent; color: var(--ink); font: 400 13.5px/1.45 var(--font-ui); resize: vertical; outline: none; }
.ord-composer__box::placeholder { color: var(--muted); }
.ord-composer__box[aria-invalid="true"] { box-shadow: inset 3px 0 0 var(--accent-ink); }
.ord-composer .error { padding: 0 12px 8px; }
.ord-composer__box:focus-visible { outline: none; }
.ord-composer__bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.ord-composer__bar .btn { margin-left: auto; }
.ord-composer__bar .switch { align-items: center; gap: 8px; }
.ord-composer__bar .switch__txt strong { font-size: 12.5px; }
.ord-composer__bar .switch__track { margin-top: 0; }
.ord-composer__hint { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 8px; font-size: 12px; color: var(--muted); }

/* ---------- Detalhe: página inteira ---------- */
.ord-sub { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-top: 4px; }
.ord-sub__meta { font-size: 13px; color: var(--muted); }
.ord-sub__meta b { color: var(--ink); }
.ord-pacts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
@media (min-width: 1100px) {
  .page-head:has(.ord-pacts) { flex-wrap: nowrap; align-items: flex-start; }
  .page-head:has(.ord-pacts) .page-head__txt { flex: 1 1 auto; }
  .page-head:has(.ord-pacts) .page-actions { flex: none; margin-top: 22px; }
}
.ord-pacts > .grow { display: none; }
.ord-page { display: grid; grid-template-columns: minmax(0, 1fr) 356px; gap: 18px; align-items: start; }
.ord-page__main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ord-page__main .dsec, .ord-page .ord-progress { background: var(--surface); box-shadow: var(--sh-card); border-color: var(--line); padding: 16px 20px; }
.ord-page .ord-progress { border: 1px solid var(--line); border-radius: var(--r-lg); padding: 18px 16px 14px; }
.ord-page__side { padding: 18px 20px; position: sticky; top: calc(var(--topbar-h) + 16px); max-height: calc(100vh - var(--topbar-h) - 32px); overflow: auto; }
.ord-mbar { display: none; }

/* ---------- Diálogos e folhas ---------- */
.ord-cancel .modal__body { padding-top: 6px; }
.ord-cancel__copy { margin: 0 0 18px 56px; font-size: 14px; line-height: 1.5; color: var(--text); }
.ord-cancel__form { display: flex; flex-direction: column; gap: 14px; }
.ord-cancel__form .switch__txt .ord-block { font-size: 12.5px; color: var(--muted); }
.ord-sheet__sub { margin: -4px 0 12px; font-size: 13px; color: var(--muted); }
.ord-radios { display: flex; flex-direction: column; gap: 4px; }
.ord-radio { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 12px; border: 1px solid transparent; border-radius: 14px; background: none; text-align: left; font: inherit; color: var(--ink); cursor: pointer; width: 100%; }
.ord-radio:hover { background: var(--surface-2); }
.ord-radio:has(input:checked) { background: var(--surface-3); border-color: var(--line-strong); }
.ord-radio input { margin-left: auto; flex: none; }
.ord-radio__t { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ord-radio__t strong { font-size: 14.5px; font-weight: 600; }
.ord-radio__t span { font-size: 12.5px; color: var(--muted); }
.ord-radio--danger strong { color: var(--bad-fg); }
.ord-radio--danger > .icon-sm { margin-left: auto; color: var(--muted); }
.ord-radio:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.ord-sheet__wa { margin-top: 14px; padding: 12px; border-top: 1px solid var(--line); width: 100%; }
.ord-sheet .modal__foot .btn { width: 100%; }
.ord-date { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ord-date .input { width: 132px; flex: none; }
.ord-date__chips { flex-wrap: nowrap; }
.ord-date__chips .chip { height: 32px; padding: 0 11px; }
.ord-cal { margin-top: 10px; padding: 10px 10px 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
.ord-cal .cal__nav { margin-bottom: -32px; }
.ord-cal .cal__d { height: 36px; line-height: 36px; }
.ord-cal .cal__d:disabled { color: var(--faint); cursor: not-allowed; }

/* ---------- Responsivo ---------- */
@media (max-width: 1279px) {
  .ord-page { grid-template-columns: minmax(0, 1fr) 320px; }
  .ord-drawer .ord-foot__print { width: 38px; padding: 0; justify-content: center; }
  .ord-drawer .ord-foot__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
@media (max-width: 1100px) {
  .ord-page { grid-template-columns: minmax(0, 1fr); }
  .ord-page__side { position: static; max-height: none; }
  .ord-table .ord-c-pay .pay__m .ellipsis { max-width: 120px; }
}
@media (max-width: 1023px) {
  .ord-table .ord-c-store { display: none; }
  .ord-table thead th:nth-child(4):not(.num) { display: none; }
}
@media (max-width: 860px) {
  .ord-cols { grid-template-columns: minmax(0, 1fr); }
}
/* celular: abas viram chips, filtros recolhem, tabela vira cartões, ações fixas embaixo */
@media (max-width: 767px) {
  .ord-card { background: transparent; border: 0; box-shadow: none; }
  .ord-card > .ord-tabs { gap: 6px; margin: 0 -16px 2px; padding: 2px 16px 10px; border-bottom: 0; scroll-snap-type: x proximity; scroll-padding: 0 16px; }
  .ord-tabs .tab { flex: none; height: 34px; padding: 0 12px; border-radius: 999px; background: var(--raised); box-shadow: inset 0 0 0 1px var(--line-strong); font-size: 13.5px; scroll-snap-align: start; }
  .ord-tabs .tab::after { display: none; }
  .ord-tabs .tab[aria-selected="true"] { background: var(--ink); color: var(--surface); box-shadow: none; }
  .ord-tabs .tab[aria-selected="true"] .tab__n { background: color-mix(in srgb, var(--surface) 22%, transparent); color: inherit; }
  .ord-tabs .tab .dot--sm { display: none; }
  .card > .ord-tb { padding: 0 0 12px; border-bottom: 0; gap: 8px; }
  .ord-tb__search { flex: 1 1 100%; max-width: none; order: -2; }
  .ord-tb__kbd { display: none; }
  .ord-tb__toggle { display: inline-flex; }
  .ord-tb__date { min-width: 0; }
  .ord-tb__more { display: none; }
  .ord-tb__more.is-open { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; width: 100%; order: 5; }
  .ord-tb__more.is-open .ord-tb__f .sel__trigger, .ord-tb__more.is-open .ord-tb__f .select { width: 100%; max-width: none; min-width: 0; }
  .ord-tb__clear { order: 6; }
  .ord-tb__sort { display: inline-flex; margin-left: auto; color: var(--muted); font-weight: 500; }
  .ord-tb .toolbar__spacer, .ord-tb__density { display: none; }
  .ord-custfilter { margin: 0 0 12px; }
  .ord-tw { display: none; }
  .ord-cards { display: flex; flex-direction: column; gap: 10px; }
  .ord-card .pager { padding: 14px 0 0; border-top: 0; }
  .ord-mc { gap: 6px; cursor: pointer; }
  .ord-mc__top { display: flex; align-items: center; gap: 4px; min-height: 26px; }
  .ord-mc__top .ord-code { font-size: 15px; }
  .ord-mc__name { font-size: 15px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .ord-mc__meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; color: var(--muted); }
  .ord-mc__meta .ellipsis { min-width: 0; }
  .ord-mc__meta .age, .ord-mc__meta > span:last-child { flex: none; }
  .ord-mc__pay { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; padding-top: 10px; border-top: 1px dashed var(--line-strong); }
  .ord-mc__pay .pay__m { font-size: 13px; min-width: 0; }
  .ord-mc__total { margin-left: auto; font: 800 16px/1.2 var(--font-display); color: var(--ink); font-variant-numeric: tabular-nums; }
  .ord-mc__acts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.9fr); gap: 8px; margin-top: 8px; }
  .ord-hide-sm { display: none; }
  .ord-empty { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-card); }
  /* detalhe */
  .ord-sub { gap: 6px 8px; }
  .ord-sub__meta { width: 100%; }
  [data-actions]:has(.ord-pacts) { display: none; }
  .ord-page { gap: 12px; padding-bottom: 76px; }
  .ord-page__main { gap: 12px; }
  .ord-page__main .dsec, .ord-page .ord-progress { padding: 14px 16px; }
  .ord-page__side { padding: 14px 16px; }
  .ord-steps { display: none; }
  .ord-mprog { display: block; }
  .ord-mprog__bar { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
  .ord-mprog__bar span { height: 6px; border-radius: 999px; background: var(--surface-3); }
  .ord-mprog__bar span.is-done { background: var(--ok-dot); }
  .ord-mprog__bar span.is-cur { background: var(--warn-dot); }
  .ord-mprog__bar span.is-late { background: var(--bad-dot); }
  .ord-mprog p { margin-top: 8px; font-size: 13px; color: var(--muted); }
  .ord-items .ord-item { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; grid-template-areas: "th tx tx" "th qt to"; gap: 4px 12px; align-items: center; }
  .ord-item > .thumb { grid-area: th; align-self: start; }
  .ord-item__txt { grid-area: tx; }
  .ord-item__qty { grid-area: qt; }
  .ord-item__tot { grid-area: to; min-width: 0; }
  .ord-composer__hint .kbd, .ord-composer__hint .ord-kbd-txt { display: none; }
  [data-actions] .btn:has([data-print-day]), [data-actions] [data-print-day], [data-actions] [data-export] { height: 34px; padding: 0 11px; font-size: 13px; }
  .ord-mbar { position: fixed; left: 0; right: 0; bottom: calc(var(--tabbar-space, 0px) + env(safe-area-inset-bottom)); z-index: var(--z-bar); display: flex; gap: 8px; padding: 10px 16px; background: color-mix(in srgb, var(--surface) 96%, transparent); border-top: 1px solid var(--line); box-shadow: 0 -10px 24px -16px rgba(59, 39, 25, .3); }
  .ord-mbar .btn { height: 48px; }
  .ord-mbar__more { width: 48px; flex: none; }
  .ord-mbar .ord-wa { flex: 1 1 0; }
  .ord-mbar__go { flex: 1.6 1 0; }
  .ord-cancel__copy { margin-left: 0; }
  .ord-date .input { width: 100%; }
}

/* ---------- Impressão (romaneio: um pedido por página) ---------- */
.ord-print { display: none; }
@media print {
  body.ord-printing > *:not(.ord-print) { display: none !important; }
  body.ord-printing .ord-print { display: block; color: #000; font-size: 11.5px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .op-sheet + .op-sheet { break-before: page; }
  .ord-print p { margin: 0 0 2px; }
  .ord-print h3 { margin: 0 0 4px; font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: #444; }
  .ord-print .op-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 2px solid #000; }
  .ord-print .op-brand, .ord-print .op-title { font-size: 17px; font-weight: 700; }
  .ord-print .op-right { text-align: right; }
  .ord-print .op-small { font-size: 10.5px; color: #333; }
  .ord-print .op-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .ord-print .op-box { padding: 7px 9px; border: 1px solid #888; border-radius: 4px; break-inside: avoid; overflow-wrap: anywhere; }
  .ord-print .op-table { width: 100%; margin-bottom: 10px; border-collapse: collapse; }
  .ord-print .op-table th, .ord-print .op-table td { padding: 5px 7px; border: 1px solid #888; text-align: left; vertical-align: top; }
  .ord-print .op-table th { background: #eee; font-size: 9.5px; letter-spacing: .4px; text-transform: uppercase; }
  .ord-print .op-table .num { text-align: right; white-space: nowrap; }
  .ord-print .op-table tr { break-inside: avoid; }
  .ord-print .op-c { width: 40px; text-align: center !important; }
  .ord-print .op-check { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #000; border-radius: 2px; }
  .ord-print .op-totals { width: 260px; margin: 0 0 12px auto; }
  .ord-print .op-totals > div { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
  .ord-print .op-total { margin-top: 3px; padding-top: 4px !important; border-top: 1.5px solid #000; font-size: 13px; font-weight: 700; }
  .ord-print .op-notes { padding: 7px 9px; margin-bottom: 8px; border: 1px solid #888; border-radius: 4px; white-space: pre-wrap; break-inside: avoid; }
  .ord-print .op-sign { display: grid; grid-template-columns: 2fr 1fr; gap: 30px 24px; margin-top: 34px; break-inside: avoid; }
  .ord-print .op-sign div { padding-top: 4px; border-top: 1px solid #000; font-size: 10px; }
  .ord-print .op-foot { margin-top: 18px; font-size: 9.5px; color: #444; text-align: center; }
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
