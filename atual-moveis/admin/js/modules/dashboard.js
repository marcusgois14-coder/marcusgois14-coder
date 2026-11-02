// Painel: saudação do Tetim, indicadores do período com comparação, faturamento por dia, o que precisa de
// atenção agora, ranking das lojas (rede), mais vendidos, estoque baixo, status, pagamentos e catálogo —
// da loja selecionada ou da rede inteira (ctx.storeId nulo, só admins da rede).
import { sb, q, rpc, mediaUrl } from '../api.js';
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
  withBusy,
  money,
  num,
  pct,
  compactMoney,
  dayStart,
  dayEnd,
  empty,
  errorBlock,
  art,
  tip,
  kpiCard,
  waitKpi,
  deltaPill,
  ageChip,
  areaChart,
  segmented,
  storeMark,
  dateRange,
  toCSV,
  downloadFile,
  focusable,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_ICON,
  TONE,
} from '../ui.js';

/* ---------- Datas no fuso de São Paulo ---------- */
const TZ = 'America/Sao_Paulo';
const YMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const LONG = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const today = () => YMD.format(new Date());
const ymdOf = (ts) => YMD.format(new Date(ts));
const hourOf = (ts) => Number(HOUR.format(new Date(ts))) % 24;
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const brDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const brShort = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const utcDay = (ymd) => new Date(`${ymd}T12:00:00Z`);
const wdShort = (ymd) => utcDay(ymd).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
const wdLong = (ymd) => cap(utcDay(ymd).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }).split('-')[0]);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const minutesSince = (ts) => Math.max(0, (Date.now() - new Date(ts).getTime()) / 60000);
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
const cumul = (arr) => {
  let acc = 0;
  return arr.map((v) => (acc += v));
};
// CSV para planilhas em pt-BR: vírgula decimal, sem separador de milhar.
const csvMoney = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* armazenamento indisponível: segue sem lembrar */
    }
  },
};
const isPhone = () => window.matchMedia('(max-width: 600px)').matches;

const PERIODS = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
];
// presets do calendário (ui.dateRange) que equivalem a um botão do período
const PRESET_TO_PERIOD = { today: 'today', '7d': '7d', '30d': '30d', thisMonth: 'month' };
const PERIOD_TO_PRESET = { today: 'today', '7d': '7d', '30d': '30d', month: 'thisMonth' };
const MAX_DAYS = 731;
const GREET_KEY = 'atual-admin-greet';
const STRIP_KEY = 'atual-admin-greet-strip';
const MILE_KEY = 'atual-admin-milestones';

// Mantém o período (e os filtros dos cartões) enquanto a pessoa navega pelo painel, inclusive ao trocar de loja.
const state = { period: '7d', from: null, to: null, attn: 'all', rank: 'revenue' };
// a saudação grande aparece no primeiro acesso do dia; nesta sessão ela continua (troca de loja, voltar ao painel)
let sessionGreet = '';
// o que a pessoa dispensou nesta sessão (vale mesmo quando o navegador não deixa gravar no armazenamento)
let stripOffDay = '';
const milesOff = new Set();
const stripDismissed = () => stripOffDay === today() || ls.get(STRIP_KEY) === today();

// Redesenhar um bloco não pode jogar o foco do teclado para o <body> (tempo real, minuto a minuto, confirmar):
// guarda quem tinha o foco e devolve ao equivalente (mesmo atributo, mesma posição no cartão ou o título do cartão).
// (CSS deste arquivo é o texto do estilo do módulo; o CSS.escape do navegador fica em window.CSS)
const cssEsc = (v) => window.CSS.escape(String(v));
const FOCUS_ATTRS = ['data-confirm', 'data-store-row', 'data-period', 'data-period-custom', 'data-value', 'data-dk-more', 'data-strip-close', 'data-mile-close', 'href'];
function captureFocus(root) {
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return null;
  const sec = a.closest('[aria-labelledby]');
  const sel = FOCUS_ATTRS.filter((n) => a.hasAttribute(n))
    .map((n) => `[${n}="${cssEsc(a.getAttribute(n))}"]`)
    .join('');
  return { el: a, sec: sec && root.contains(sec) ? sec.getAttribute('aria-labelledby') : null, sel: sel ? `${a.tagName.toLowerCase()}${sel}` : null, idx: focusable(sec || root).indexOf(a) };
}
function restoreFocus(root, key) {
  if (!key) return;
  if (key.el.isConnected && !key.el.disabled) {
    if (document.activeElement !== key.el && (document.activeElement === document.body || !document.activeElement)) key.el.focus({ preventScroll: true });
    return;
  }
  const cur = document.activeElement;
  if (cur && cur !== document.body && cur.isConnected) return; // a pessoa já foi para outro lugar
  const scope = (key.sec && root.querySelector(`[aria-labelledby="${cssEsc(key.sec)}"]`)) || root;
  let el = key.sel ? scope.querySelector(key.sel) : null;
  if (!el && key.idx >= 0) {
    const list = focusable(scope);
    el = list[Math.min(key.idx, list.length - 1)] || null;
  }
  if (!el && key.sec) {
    el = document.getElementById(key.sec);
    el?.setAttribute('tabindex', '-1');
  }
  el?.focus({ preventScroll: true });
}
function keepFocus(root, fn) {
  const key = captureFocus(root);
  fn();
  restoreFocus(root, key);
}

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
  return from.slice(0, 4) === to.slice(0, 4) ? `${brShort(from)} a ${brDate(to)}` : `${brDate(from)} a ${brDate(to)}`;
}

function periodWords(r) {
  const n = daysBetween(r.from, r.to) + 1;
  switch (state.period) {
    case 'today':
      return { short: 'hoje', long: 'hoje até agora', prev: 'Ontem', cmp: 'com ontem até o mesmo horário' };
    case '7d':
      return { short: '7 dias', long: 'nos últimos 7 dias', prev: '7 dias anteriores', cmp: 'com os 7 dias anteriores' };
    case '30d':
      return { short: '30 dias', long: 'nos últimos 30 dias', prev: '30 dias anteriores', cmp: 'com os 30 dias anteriores' };
    case 'month':
      return { short: 'este mês', long: 'neste mês', prev: 'Período anterior', cmp: `com os ${n} dias anteriores` };
    default:
      if (n === 1) return { short: brShort(r.from), long: `em ${brDate(r.from)}`, prev: 'Dia anterior', cmp: 'com o dia anterior' };
      return { short: `${brShort(r.from)} a ${brShort(r.to)}`, long: `de ${brShort(r.from)} a ${brShort(r.to)}`, prev: `${n} dias anteriores`, cmp: `com os ${n} dias anteriores` };
  }
}

// Janela anterior de mesmo tamanho. Se o período termina hoje, compara até o mesmo horário
// (ex.: hoje até agora × ontem até a mesma hora), para não comparar dia parcial com dia cheio.
function previousWindow({ from, to }) {
  const span = (daysBetween(from, to) + 1) * 86400000;
  const start = Date.parse(dayStart(from));
  const end = Math.min(Date.parse(dayEnd(to)), Date.now());
  return { p_from: new Date(start - span).toISOString(), p_to: new Date(end - span).toISOString() };
}

// variação em %: undefined = sem comparação carregada (sem pílula); null = sem base ("Sem base")
function dpct(cur, prev) {
  if (prev === undefined || prev === null) return undefined;
  const p = Number(prev) || 0;
  if (!p) return null;
  return (((Number(cur) || 0) - p) / p) * 100;
}

const firstName = (ctx) => {
  const n = String(ctx.user?.full_name || '').trim().split(/\s+/)[0];
  if (n) return n;
  const e = String(ctx.user?.email || '').split('@')[0].split(/[._-]/)[0];
  return e ? cap(e) : '';
};
const shortPerson = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).join(' ');
const greetWord = () => {
  const h = hourOf(Date.now());
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
};

// "R$ 133.580,58" com centavos menores; no celular vira "R$ 133,6 mil"
function moneyValue(v) {
  const full = money(v);
  const m = full.match(/^(.*?)(,\d{2})$/);
  return html`<span class="dk-full">${m ? html`${m[1]}<small>${m[2]}</small>` : full}</span><span class="dk-compact">${compactMoney(v)}</span>`;
}

const thumb = (src, ico = 'image') =>
  html`<span class="dk-thumb" aria-hidden="true">${src ? html`<img src="${mediaUrl(src)}" alt="">` : icon(ico, 'icon-sm')}</span>`;

/* ---------- Dados extras (pedidos de hoje/ontem, pendências, fotos) ---------- */
function scoped(qb, ctx) {
  return ctx.storeId ? qb.eq('store_id', ctx.storeId) : qb;
}

// pedidos válidos de dois dias (dia anterior + dia) para a curva por hora e a comemoração
async function loadTwoDays(ctx, day) {
  const rows = await q(
    scoped(
      sb
        .from('orders')
        .select('created_at,total,store_id')
        .neq('status', 'canceled')
        .gte('created_at', dayStart(addDays(day, -1)))
        .lt('created_at', dayEnd(day))
        .order('created_at', { ascending: true })
        .limit(2000),
      ctx
    )
  );
  const prevDay = addDays(day, -1);
  const cur = Array(24).fill(0);
  const curN = Array(24).fill(0);
  const pv = Array(24).fill(0);
  const pvN = Array(24).fill(0);
  (rows || []).forEach((o) => {
    const k = ymdOf(o.created_at);
    const h = hourOf(o.created_at);
    const v = Number(o.total) || 0;
    if (k === day) {
      cur[h] += v;
      curN[h] += 1;
    } else if (k === prevDay) {
      pv[h] += v;
      pvN[h] += 1;
    }
  });
  return {
    day,
    prevDay,
    H: day === today() ? hourOf(Date.now()) : 23,
    cur: cumul(cur),
    curN: cumul(curN),
    prev: cumul(pv),
    prevN: cumul(pvN),
    rev: sum(cur),
    n: sum(curN),
    prevRev: sum(pv),
    prevCount: sum(pvN),
  };
}

// o que pede ação agora: pedidos novos, pagamento antecipado pendente, entregas agendadas para hoje
async function loadAttention(ctx) {
  const t = today();
  return q(
    scoped(
      sb
        .from('orders')
        .select('id,code,store_id,customer_name,total,created_at,status,payment_method,payment_status,scheduled_date')
        .or(
          `status.eq.pending,and(status.in.(confirmed,preparing),payment_status.in.(pending,failed),payment_method.in.(pix,card_link)),and(scheduled_date.eq.${t},status.in.(confirmed,preparing,out_for_delivery))`
        )
        .order('created_at', { ascending: true })
        .limit(200),
      ctx
    )
  );
}

// filas do dia (aparecem quando não há nada pendente)
async function loadQueues(ctx) {
  const rows = await q(
    scoped(
      sb
        .from('orders')
        .select('status,delivered_at')
        .or(`status.in.(preparing,out_for_delivery),delivered_at.gte.${dayStart(today())}`)
        .limit(1000),
      ctx
    )
  );
  const out = { preparing: 0, out_for_delivery: 0, delivered: 0 };
  (rows || []).forEach((o) => {
    if (o.status === 'preparing') out.preparing += 1;
    else if (o.status === 'out_for_delivery') out.out_for_delivery += 1;
    else if (o.status === 'delivered') out.delivered += 1;
  });
  return out;
}

// fotos e SKU para as listas (só visual: se falhar, as listas seguem com ícones)
async function loadExtras(ctx, d) {
  const ids = (d.low_stock_list || []).map((p) => p.id).filter(Boolean);
  const names = [...new Set((d.top_products || []).map((p) => p.name).filter(Boolean))];
  const [low, top] = await Promise.all([
    ids.length ? q(sb.from('products').select('id,image_url,sku').in('id', ids)).catch(() => []) : [],
    names.length ? q(scoped(sb.from('products').select('name,image_url'), ctx).in('name', names).limit(300)).catch(() => []) : [],
  ]);
  return {
    low: new Map((low || []).map((p) => [p.id, p])),
    top: new Map((top || []).filter((p) => p.image_url).map((p) => [p.name, p])),
  };
}

/* ---------- Saudação, comemoração e dica (uma arte do Tetim por tela) ---------- */
function greetMode(ctx) {
  const t = today();
  const key = `${t}:${ctx.user?.id || ''}`;
  if (sessionGreet === key) return 'full';
  if (ls.get(GREET_KEY) !== key) {
    ls.set(GREET_KEY, key);
    sessionGreet = key;
    return 'full';
  }
  return stripDismissed() ? 'none' : 'strip';
}

function milestones() {
  try {
    const v = JSON.parse(ls.get(MILE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// comemoração: hoje já vendeu mais que ontem inteiro (uma por dia e por visão; some ao dispensar)
function celebrateData(ctx, pulse) {
  if (!pulse || !pulse.prevRev || pulse.rev <= pulse.prevRev || pulse.n < 1) return null;
  const key = `beat:${pulse.day}:${ctx.storeId || 'rede'}`;
  const list = milestones();
  if (milesOff.has(key) || list.includes(`${key}:x`)) return null;
  if (!list.includes(key)) ls.set(MILE_KEY, JSON.stringify([...list.slice(-40), key]));
  return { key, ...pulse };
}

function greetSentence(ctx, g) {
  const where = ctx.store ? ctx.storeShort(ctx.store) : null;
  const paused = ctx.store && ctx.store.accepts_orders === false ? ' Os pedidos pela loja virtual estão pausados.' : '';
  if (!g.canSales) {
    const c = g.catalog;
    const alerts = (Number(c.out_of_stock) || 0) + (Number(c.low_stock) || 0);
    return {
      long: html`${where || 'A rede'} tem <b>${plural(c.active, 'produto ativo', 'produtos ativos')}</b> na loja virtual. ${
        alerts ? html`<b>${plural(alerts, 'produto pede', 'produtos pedem')}</b> reposição de estoque.` : 'O estoque está em dia.'
      }`,
      short: html`<b>${plural(c.active, 'produto ativo', 'produtos ativos')}</b>. ${alerts ? html`<b>${num(alerts)}</b> para repor.` : 'Estoque em dia.'}`,
    };
  }
  const sold = g.pulse && g.pulse.n > 0;
  const salesLong = sold
    ? html`${where || 'A rede'} já vendeu <b>${money(g.pulse.rev)}</b> hoje em ${plural(g.pulse.n, 'pedido', 'pedidos')}.`
    : g.pulse
      ? html`Ainda sem vendas hoje${where ? ` em ${where}` : ' na rede'}.`
      : '';
  const salesShort = sold ? html`Hoje: <b>${money(g.pulse.rev)}</b> em ${plural(g.pulse.n, 'pedido', 'pedidos')}.` : g.pulse ? 'Hoje ainda sem vendas.' : '';
  let pendLong;
  let pendShort;
  if (g.nPend) {
    pendLong = html`<b>${g.nPend === 1 ? '1 pedido aguarda confirmação' : `${num(g.nPend)} aguardam confirmação`}</b>${
      g.oldest ? html`, o mais antigo ${ageChip(g.oldest)}` : ''
    }.`;
    pendShort = html`<b>${g.nPend === 1 ? '1 aguarda' : `${num(g.nPend)} aguardam`}</b> confirmação.`;
  } else {
    pendLong = sold ? 'Tudo em dia por aqui.' : 'Tudo em dia por aqui. Os avisos de novos pedidos chegam com som.';
    pendShort = 'Tudo em dia.';
  }
  return { long: html`${salesLong} ${pendLong}${paused}`, short: html`${salesShort} ${pendShort}` };
}

function greetActions(g, { compact = false } = {}) {
  const sm = compact ? 'btn--sm' : '';
  if (!g.canSales) {
    const alerts = (Number(g.catalog.out_of_stock) || 0) + (Number(g.catalog.low_stock) || 0);
    if (!g.canCatalog) return '';
    return html`${
      alerts
        ? html`<a class="btn btn--primary ${sm}" href="#/products?stock=low">${icon('box', 'icon-sm')}Repor estoque <span class="greet__n">${num(alerts)}</span></a>`
        : html`<a class="btn btn--primary ${sm}" href="#/products/new">${icon('plus', 'icon-sm')}Cadastrar produto</a>`
    }${compact ? '' : html`<a class="btn" href="#/showcase">${icon('showcase', 'icon-sm')}Vitrine e banners</a>`}`;
  }
  const day = today();
  const report = `#/reports?from=${day}&to=${day}&group=day`;
  if (g.nPend) {
    return html`<a class="btn btn--primary ${sm}" href="#/orders?status=pending">${icon('orders', 'icon-sm')}${compact ? 'Revisar' : 'Revisar pedidos novos'} <span class="greet__n">${num(g.nPend)}</span></a>${
      compact ? '' : html`<a class="btn" href="${report}">${icon('reports', 'icon-sm')}Relatório do dia</a>`
    }`;
  }
  return html`<a class="btn btn--primary ${sm}" href="${report}">${icon('reports', 'icon-sm')}Relatório do dia</a>${
    compact ? '' : html`<a class="btn" href="#/orders">${icon('orders', 'icon-sm')}Ver pedidos</a>`
  }`;
}

function greetingBlock(ctx, g) {
  const hello = greetWord();
  const name = firstName(ctx);
  const scope = ctx.store ? ctx.storeShort(ctx.store) : 'Toda a rede';
  const s = greetSentence(ctx, g);
  // com comemoração no dia, a saudação vira a faixa compacta (a arte do Tetim fica com a comemoração)
  if (g.mode === 'full' && !g.celebrating) {
    return html`<section class="greet dk-greet" data-tetim-prio="2" aria-labelledby="dk-greet-t">
      <div class="greet__txt">
        <p class="greet__eyebrow"><span class="dk-long">${cap(LONG.format(new Date()))} · ${scope}</span><span class="dk-short">${cap(LONG.format(new Date())).replace(/-feira/, '')}</span></p>
        <h1 class="greet__title" id="dk-greet-t">${hello}${name ? `, ${name}` : ''}!</h1>
        <p class="greet__sum"><span class="dk-long">${s.long}</span><span class="dk-short">${s.short}</span></p>
        <div class="greet__acts"><span class="dk-long-acts">${greetActions(g)}</span><span class="dk-short-acts">${greetActions(g, { compact: true })}</span></div>
      </div>
      <div class="greet__art" aria-hidden="true">
        <div class="greet__window"><i></i><i></i><i></i><i></i></div>
        <span class="greet__desk">${art('desk-wave', { w: 330, h: 220 })}</span>
      </div>
    </section>`;
  }
  const h1 = html`<h1 class="visually-hidden">Painel${ctx.store ? ` · ${scope}` : ' · Toda a rede'}</h1>`;
  // faixa recolhida até amanhã (inclusive a faixa que substitui a saudação nos dias de comemoração)
  if (g.mode === 'none' || stripDismissed()) return h1;
  let line;
  if (g.canSales && g.nPend) line = html`${plural(g.nPend, 'pedido aguarda', 'pedidos aguardam')} confirmação${g.oldest ? html` · o mais antigo ${ageChip(g.oldest)}` : ''}.`;
  else line = s.short;
  return html`${h1}<section class="gstrip dk-strip" data-tetim-prio="5" aria-label="Resumo do dia">
    <span class="gstrip__face" aria-hidden="true">${art('tetim-face', { w: 40, h: 40 })}</span>
    <span class="gstrip__ico" aria-hidden="true">${icon('sun', 'icon-sm')}</span>
    <p class="gstrip__txt"><b>${hello}${g.mode === 'full' ? '' : ' de novo'}${name ? `, ${name}` : ''}${g.mode === 'full' ? '!' : '.'}</b> ${line}</p>
    <span class="dk-strip__acts">${greetActions(g, { compact: true })}</span>
    <button class="btn btn--ghost btn--icon btn--sm" type="button" data-strip-close aria-label="Recolher saudação até amanhã" title="Recolher até amanhã">${icon('x', 'icon-sm')}</button>
  </section>`;
}

function celebrateBlock(ctx, c) {
  if (!c) return '';
  const who = ctx.store ? ctx.storeShort(ctx.store) : 'a rede';
  const report = `#/reports?from=${c.day}&to=${c.day}&group=${ctx.storeId ? 'payment' : 'store'}`;
  return html`<section class="mile" data-tetim-prio="1" data-mile="${c.key}" aria-labelledby="dk-mile-t">
    <span class="mile__art" aria-hidden="true">${art('celebrate', { w: 148, h: 111 })}</span>
    <span class="mile__ico" aria-hidden="true">${icon('sparkle')}</span>
    <div class="mile__txt">
      <p class="mile__eyebrow">${icon('sparkle', 'icon-xs')} Hoje já passou ontem</p>
      <h2 class="mile__title" id="dk-mile-t">${money(c.rev)} vendidos hoje</h2>
      <p class="mile__text">Ontem ${who} fechou com ${money(c.prevRev)}. Hoje já são ${plural(c.n, 'pedido', 'pedidos')}, e o dia não acabou. Parabéns, equipe!</p>
      <a class="link mile__link" href="${report}">Ver relatório do dia ${icon('arrowRight', 'icon-xs')}</a>
    </div>
    <button class="btn btn--ghost btn--icon btn--sm mile__x" type="button" data-mile-close aria-label="Dispensar comemoração">${icon('x', 'icon-sm')}</button>
  </section>`;
}

// dica do Tetim: a primeira que vale para os dados desta tela (e não foi dispensada)
function tipBlock(ctx, d) {
  const c = d.catalog || {};
  const where = ctx.store ? ctx.storeShort(ctx.store) : null;
  const sid = ctx.storeId || 'rede';
  const out = [];
  if (ctx.store && ctx.can('settings') && !ctx.store.pix_key) {
    const off = Number(ctx.store.pix_discount_pct) || 0;
    out.push({
      id: `pix-${sid}`,
      text: `${where} ainda não tem chave PIX. Com ela, o cliente paga na hora${off ? ` com ${pct(off)} de desconto` : ''} e o pedido sai mais rápido.`,
      action: { label: 'Cadastrar chave PIX', href: '#/store' },
    });
  }
  if (!ctx.storeId && ctx.isGlobal) {
    const noPix = ctx.stores.filter((s) => s.active !== false && !s.pix_key).length;
    if (noPix) out.push({ id: 'pix-rede', text: `${plural(noPix, 'loja ainda não tem', 'lojas ainda não têm')} chave PIX. Com ela, o cliente paga na hora e o pedido sai mais rápido.`, action: { label: 'Ver lojas', href: '#/stores' } });
  }
  if (ctx.can('catalog')) {
    const drafts = Number(c.draft) || 0;
    if (drafts) out.push({ id: `drafts-${sid}`, text: `${plural(drafts, 'produto', 'produtos')}${where ? ` de ${where}` : ' da rede'} ${drafts === 1 ? 'está' : 'estão'} em rascunho. Ativos, eles aparecem na loja virtual.`, action: { label: 'Revisar rascunhos', href: '#/products?status=draft' } });
    const zero = Number(c.out_of_stock) || 0;
    if (zero) out.push({ id: `out-${sid}`, text: `${plural(zero, 'produto ativo está esgotado', 'produtos ativos estão esgotados')}${where ? ` em ${where}` : ' na rede'}. Com o estoque em dia, a loja virtual só vende o que você entrega.`, action: { label: 'Ver esgotados', href: '#/products?stock=out' } });
  }
  for (const t of out) {
    const block = tip(t);
    if (block) return block;
  }
  return '';
}

/* ---------- Indicadores ---------- */
function kpiBlock(ctx, d, prev, view) {
  const r = view.range;
  const series = Array.isArray(d.series) ? d.series : [];
  const hourly = view.hourly;
  const single = r.from === r.to;
  let sRev = series.map((s) => Number(s.revenue) || 0);
  let sOrd = series.map((s) => Number(s.orders) || 0);
  if (single && hourly) {
    sRev = hourly.cur.slice(0, hourly.H + 1);
    sOrd = hourly.curN.slice(0, hourly.H + 1);
  }
  let last = 0;
  const sTicket = sRev.map((v, i) => {
    if (single && hourly) return sOrd[i] ? v / sOrd[i] : last;
    if (sOrd[i]) last = v / sOrd[i];
    return last;
  });
  const words = periodWords(r);
  const reportHref = (group) => `#/reports?from=${r.from}&to=${r.to}&group=${group}`;
  const orders = Number(d.orders) || 0;
  const ok = Number(d.orders_ok) || 0;
  const prevTitle = (label, v) => (prev ? `${label} em ${words.prev.toLowerCase()}: ${v}` : '');
  const wait = view.attn
    ? waitKpi({
        ages: view.attn.pending.map((o) => minutesSince(o.created_at)),
        href: '#/orders?status=pending',
        label: html`<span class="dk-full">Aguardando confirmação</span><span class="dk-compact">Aguardando</span>`,
      })
    : kpiCard({ label: 'Aguardando confirmação', value: num(d.pending_now), sub: 'Agora', href: '#/orders?status=pending', cls: 'kpi--wait-lite' });
  return html`<div class="kpis dk-kpis">
    ${kpiCard({
      label: 'Faturamento',
      value: moneyValue(d.revenue),
      sub: 'Pedidos não cancelados',
      delta: dpct(d.revenue, prev?.revenue),
      prev: prev ? money(prev.revenue) : '',
      spark: sRev,
      href: reportHref('day'),
      info: 'Soma dos pedidos não cancelados no período.',
      cls: 'dk-k1',
    })}
    ${kpiCard({
      label: 'Pedidos',
      value: html`${num(ok)} <small>/ ${num(orders)}</small>`,
      sub: html`Válidos · <span title="${prevTitle('Clientes novos', num(prev?.new_customers))}">${plural(d.new_customers, 'cliente novo', 'clientes novos')}</span>`,
      delta: dpct(ok, prev?.orders_ok),
      prev: prev ? plural(prev.orders_ok, 'pedido', 'pedidos') : '',
      spark: sOrd,
      href: reportHref('status'),
      info: `Pedidos não cancelados / todos os pedidos do período${orders - ok ? ` (${plural(orders - ok, 'cancelado', 'cancelados')})` : ''}.`,
      cls: 'dk-k2',
    })}
    ${kpiCard({
      label: 'Ticket médio',
      value: moneyValue(d.avg_ticket),
      sub: html`Por pedido válido · <span title="${prevTitle('Itens vendidos', num(prev?.items_sold))}">${plural(d.items_sold, 'item', 'itens')}</span>`,
      delta: dpct(d.avg_ticket, prev?.avg_ticket),
      prev: prev ? money(prev.avg_ticket) : '',
      spark: sTicket,
      href: reportHref('product'),
      info: 'Faturamento dividido pelos pedidos válidos. Itens = unidades vendidas.',
      cls: 'dk-k3',
    })}
    ${wait}
  </div>`;
}

/* ---------- Gráfico ---------- */
function chartModel(d, prev, view) {
  const r = view.range;
  const words = periodWords(r);
  if (r.from === r.to) {
    const h = view.hourly;
    if (!h) return null;
    const isToday = r.from === today();
    const pts = [];
    for (let i = 0; i <= h.H; i++) {
      pts.push({ label: `${i}h`, value: h.cur[i], orders: h.curN[i], title: `${isToday ? 'Hoje' : brShort(r.from)} até ${String(i).padStart(2, '0')}h59`, prevLabel: isToday ? 'ontem' : brShort(h.prevDay) });
    }
    return {
      hourly: true,
      title: 'Faturamento ao longo do dia',
      sub: html`${money(h.rev)} ${isToday ? 'hoje até agora' : `em ${brDate(r.from)}`} · acumulado por hora`,
      points: pts,
      prev: h.prev.slice(0, h.H + 1),
      curLabel: isToday ? 'Hoje' : brShort(r.from),
      prevLabel: isToday ? 'Ontem' : brShort(h.prevDay),
      any: h.rev > 0 || h.prevRev > 0,
      stats: [
        ['Pedidos válidos', num(h.n)],
        ['Ticket médio', money(h.n ? h.rev / h.n : 0)],
        [`${isToday ? 'Ontem' : brShort(h.prevDay)} até ${String(h.H).padStart(2, '0')}h59`, money(h.prev[h.H] || 0)],
      ],
      aria: `Faturamento acumulado por hora ${isToday ? 'hoje' : `em ${brDate(r.from)}`}: ${money(h.rev)} em ${plural(h.n, 'pedido', 'pedidos')}; ${
        isToday ? 'ontem' : 'no dia anterior'
      } até o mesmo horário, ${money(h.prev[h.H] || 0)}.`,
    };
  }
  let series = (Array.isArray(d.series) ? d.series : []).map((s) => ({ key: s.day, revenue: Number(s.revenue) || 0, orders: Number(s.orders) || 0 }));
  let ps = prev && Array.isArray(prev.series) ? prev.series.map((s) => ({ key: s.day, revenue: Number(s.revenue) || 0, orders: Number(s.orders) || 0 })) : null;
  const monthly = series.length > 92;
  const byMonth = (list) => {
    const m = new Map();
    list.forEach((s) => {
      const k = s.key.slice(0, 7);
      const cur = m.get(k) || { key: k, revenue: 0, orders: 0 };
      cur.revenue += s.revenue;
      cur.orders += s.orders;
      m.set(k, cur);
    });
    return [...m.values()];
  };
  if (monthly) {
    series = byMonth(series);
    ps = ps ? byMonth(ps) : null;
  }
  const n = series.length;
  const mLabel = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
  // no celular o eixo mostra só o mês ("out"); o ano aparece quando o período cruza a virada do ano
  const oneYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  const axisMonth = (k) => (isPhone() && oneYear ? MONTHS[Number(k.slice(5, 7)) - 1] : mLabel(k));
  const points = series.map((s, i) => ({
    label: monthly ? axisMonth(s.key) : n <= 10 ? `${wdShort(s.key)} ${s.key.slice(8, 10)}` : brShort(s.key),
    value: s.revenue,
    orders: s.orders,
    title: monthly ? `${cap(MONTHS_LONG[Number(s.key.slice(5, 7)) - 1])} de ${s.key.slice(0, 4)}` : `${wdLong(s.key)}, ${brShort(s.key)}`,
    prevLabel: ps?.[i] ? (monthly ? mLabel(ps[i].key) : `${wdShort(ps[i].key)} ${brShort(ps[i].key)}`) : 'anterior',
  }));
  const total = sum(series.map((s) => s.revenue));
  let best = null;
  series.forEach((s, i) => {
    if (s.revenue > 0 && (!best || s.revenue > best.s.revenue)) best = { s, i };
  });
  const unit = monthly ? 'mês' : 'dia';
  const todayRow = !monthly && r.to === today() ? series[n - 1] : null;
  return {
    hourly: false,
    title: monthly ? 'Faturamento por mês' : 'Faturamento por dia',
    sub: html`${money(total)} ${words.long}`,
    points,
    prev: ps ? ps.map((s) => s.revenue) : null,
    curLabel: 'Este período',
    prevLabel: words.prev,
    any: total > 0 || (ps ? ps.some((s) => s.revenue > 0) : false),
    stats: [
      [best ? `Melhor ${unit} · ${monthly ? mLabel(best.s.key) : `${wdShort(best.s.key)} ${brShort(best.s.key)}`}` : `Melhor ${unit}`, best ? money(best.s.revenue) : '—'],
      [`Média por ${unit}`, money(n ? total / n : 0)],
      todayRow ? ['Hoje até agora', money(todayRow.revenue)] : ['Pedidos válidos', num(sum(series.map((s) => s.orders)))],
    ],
    aria: `Faturamento ${monthly ? 'mensal' : 'diário'} de ${brShort(r.from)} a ${brShort(r.to)}: total ${money(total)}${
      best ? `; melhor ${unit} ${points[best.i].title}, com ${money(best.s.revenue)}` : ''
    }.`,
  };
}

function chartCard(d, prev, view) {
  const m = chartModel(d, prev, view);
  const stacked = window.matchMedia('(max-width: 1279px)').matches;
  const h = view.chartH || (isPhone() ? 400 : stacked && view.bodyW ? Math.round(Math.min(480, Math.max(200, (300 * 640) / Math.max(320, view.bodyW - 40)))) : 290);
  const head = (title, sub, legend = '') =>
    html`<div class="card__head"><div><h2 class="card__title" id="dk-chart-t">${title}</h2>${sub ? html`<p class="card__sub">${sub}</p>` : ''}</div>${legend}</div>`;
  if (!m) {
    return html`<section class="card dk-chart" aria-labelledby="dk-chart-t">${head('Faturamento por dia', '')}
      <div class="card__body">${empty('Escolha um período maior', 'Para ver a evolução dia a dia, escolha 7 dias, 30 dias ou um período personalizado.', '', { art: false, icon: 'reports', size: 'sm' })}</div></section>`;
  }
  if (!m.any) {
    return html`<section class="card dk-chart" aria-labelledby="dk-chart-t">${head(m.title, m.sub)}
      <div class="card__body">${empty('Sem vendas no período', 'Os pedidos válidos aparecem aqui, com a comparação com o período anterior.', '', { art: false, icon: 'reports', size: 'sm' })}</div></section>`;
  }
  const legend = html`<div class="legend" aria-hidden="true"><span><i></i>${m.curLabel}</span>${m.prev ? html`<span><i class="prev"></i>${m.prevLabel}</span>` : ''}</div>`;
  return html`<section class="card dk-chart" aria-labelledby="dk-chart-t">
    ${head(m.title, m.sub, legend)}
    <div class="card__body dk-chart__body">
      ${areaChart(m.points, { prev: m.prev, height: h, ariaLabel: m.aria, curLabel: m.curLabel, prevLabel: m.prevLabel, compact: isPhone() })}
      <dl class="chart-stats dk-stats">${m.stats.map(([k, v]) => html`<div><dt>${k}</dt><dd class="num">${v}</dd></div>`)}</dl>
    </div>
  </section>`;
}

/* ---------- Precisa de atenção ---------- */
function attentionItems(ctx, d, attn) {
  const t = today();
  const items = [];
  (attn?.rows || []).forEach((o) => {
    const prepaid = o.payment_method === 'pix' || o.payment_method === 'card_link';
    const who = ctx.storeId ? shortPerson(o.customer_name) : ctx.storeShort(o.store_id) || shortPerson(o.customer_name);
    const href = `#/orders/${encodeURIComponent(o.id)}`;
    const base = { o, href, code: o.code, who, storeId: o.store_id };
    if (o.status === 'pending') {
      const age = minutesSince(o.created_at);
      if (o.payment_status === 'failed') items.push({ ...base, k: 'failed', tone: 'bad', icon: 'alert', age, sub: `Pagamento não aprovado · ${money(o.total)}`, act: { label: 'Ver', href } });
      else if (prepaid && o.payment_status === 'pending')
        items.push({ ...base, k: 'pix', tone: 'ora', icon: o.payment_method === 'pix' ? 'pix' : 'link', age, sub: `${o.payment_method === 'pix' ? 'PIX não identificado' : 'Link ainda não pago'} · ${money(o.total)}`, act: { label: 'Verificar', href } });
      else
        items.push({ ...base, k: 'new', tone: 'warn', icon: 'clock', age, sub: `Novo · ${money(o.total)}`, act: ctx.can('orders', o.store_id) ? { label: 'Confirmar', confirm: true } : { label: 'Ver', href } });
    } else if (o.scheduled_date === t && ['confirmed', 'preparing', 'out_for_delivery'].includes(o.status)) {
      items.push({ ...base, k: 'sched', tone: 'info', icon: 'truck', sub: `Entrega agendada para hoje · ${ORDER_STATUS[o.status]?.short || o.status}`, act: { label: 'Ver', href } });
    } else if (prepaid && (o.payment_status === 'pending' || o.payment_status === 'failed')) {
      items.push({
        ...base,
        k: 'pay',
        tone: o.payment_status === 'failed' ? 'bad' : 'ora',
        icon: 'wallet',
        sub: `${o.payment_status === 'failed' ? 'Pagamento não aprovado' : 'Aguardando pagamento'} · ${PAYMENT_METHOD[o.payment_method] || o.payment_method} · ${money(o.total)}`,
        act: { label: 'Ver', href },
      });
    }
  });
  const rank = { new: 0, pix: 0, failed: 0, sched: 1, pay: 2, stock: 3 };
  items.sort((a, b) => rank[a.k] - rank[b.k] || (b.age || 0) - (a.age || 0));
  (d.low_stock_list || [])
    .filter((p) => Number(p.stock_qty) <= 0)
    .slice(0, 2)
    .forEach((p) =>
      items.push({
        k: 'stock',
        tone: 'bad',
        icon: 'box',
        title: p.name,
        href: ctx.can('catalog', p.store_id) ? `#/products/${encodeURIComponent(p.id)}` : '',
        sub: `Esgotado${ctx.storeId ? '' : ` · ${ctx.storeShort(p.store_id)}`}`,
        act: ctx.can('catalog', p.store_id) ? { label: 'Repor', href: `#/products/${encodeURIComponent(p.id)}` } : null,
        storeId: p.store_id,
      })
    );
  return items;
}

const ATTN_LIMIT = 6;
function attentionList(ctx, items) {
  const pend = items.filter((i) => i.age !== undefined);
  const late = pend.filter((i) => i.age >= 60);
  const list = state.attn === 'late' ? late : state.attn === 'pending' ? pend : items;
  if (!list.length) {
    return html`<p class="dk-attn__none muted">${icon('checkCircle', 'icon-sm')}${state.attn === 'late' ? 'Nenhum pedido atrasado (aguardando há mais de 1 hora).' : 'Nenhum pedido aguardando confirmação.'}</p>`;
  }
  const shown = list.slice(0, ATTN_LIMIT);
  return html`<ul class="attn__list dk-attn__list">${shown.map(
    (i) => html`<li class="attn__item" data-k="${i.k}">
      <span class="attn__ico t-${i.tone}" aria-hidden="true">${icon(i.icon, 'icon-sm')}</span>
      <div class="grow dk-attn__main">
        ${i.href
          ? html`<a class="attn__title dk-attn__t" href="${i.href}">${i.code ? html`<span class="code">${i.code}</span> · ${i.who}` : i.title}</a>`
          : html`<span class="attn__title dk-attn__t">${i.code ? html`<span class="code">${i.code}</span> · ${i.who}` : i.title}</span>`}
        <div class="attn__sub">${i.age !== undefined ? html`${ageChip(i.o.created_at, { prefix: '' })}<span class="attn__dotsep" aria-hidden="true">·</span>` : ''}<span class="ellipsis">${i.sub}</span>${
          i.k === 'new' ? html`<span class="visually-hidden">, novo, ainda não confirmado</span>` : ''
        }</div>
      </div>
      ${i.act
        ? i.act.confirm
          ? html`<button class="btn btn--sm btn--dark dk-attn__btn" type="button" data-confirm="${i.o.id}" data-code="${i.code}" aria-label="Confirmar pedido ${i.code}">Confirmar</button>`
          : html`<a class="btn btn--sm dk-attn__btn" href="${i.act.href}" aria-label="${i.act.label}: ${i.code || i.title}">${i.act.label}</a>`
        : ''}
    </li>`
  )}</ul>${list.length > shown.length ? html`<a class="dk-attn__more" href="#/orders?status=pending">E mais ${plural(list.length - shown.length, 'pendência', 'pendências')} ${icon('arrowRight', 'icon-xs')}</a>` : ''}`;
}

function attentionCard(ctx, d, view) {
  const items = view.items;
  const pend = items.filter((i) => i.age !== undefined);
  const late = pend.filter((i) => i.age >= 60);
  if (!['all', 'pending', 'late'].includes(state.attn) || !pend.length) state.attn = 'all';
  let foot = '';
  if (!ctx.storeId) {
    const busy = new Set([
      ...items.map((i) => i.storeId),
      ...(d.low_stock_list || []).filter((p) => Number(p.stock_qty) <= 0).map((p) => p.store_id),
    ]);
    const calm = ctx.stores.filter((s) => s.active !== false && s.accepts_orders !== false && !busy.has(s.id)).length;
    if (calm && items.length) foot = html`<div class="attn__foot">${icon('checkCircle', 'icon-sm')}${calm === 1 ? 'Na outra loja está tudo em dia.' : `Nas outras ${num(calm)} lojas está tudo em dia.`}</div>`;
  }
  const head = html`<div class="card__head"><h2 class="card__title" id="dk-attn-t">Precisa de atenção ${items.length ? html`<span class="count-pill">${num(items.length)}</span>` : ''}</h2>
    <a class="link" href="#/orders?status=pending">Ver tudo</a></div>`;
  const qd = view.queues;
  const queues = qd
    ? html`<div class="queues dk-queues"><p class="queues__t">${items.length ? 'Andamento de hoje' : `Enquanto isso, ${ctx.store ? `em ${ctx.storeShort(ctx.store)}` : 'na rede'}`}</p><div class="queues__row">
        <a class="queue" href="#/orders?status=preparing"><b>${num(qd.preparing)}</b><span>Em separação</span></a>
        <a class="queue" href="#/orders?status=out_for_delivery"><b>${num(qd.out_for_delivery)}</b><span>Saiu para entrega</span></a>
        <a class="queue" href="#/orders?status=delivered"><b>${num(qd.delivered)}</b><span>Entregues hoje</span></a></div></div>`
    : '';
  if (!items.length) {
    return html`<section class="card attn dk-attn" aria-labelledby="dk-attn-t">${head}
      ${empty('Tudo em dia por aqui!', 'Nenhum pedido esperando confirmação e nenhum produto esgotado.', '', { art: 'all-done', size: 'inline' })}
      ${queues}
    </section>`;
  }
  return html`<section class="card attn dk-attn" aria-labelledby="dk-attn-t">${head}
    ${pend.length
      ? html`<div class="attn__filter">${segmented({
          name: 'attn',
          label: 'Filtrar pendências',
          size: 'sm',
          value: state.attn,
          options: [
            ['all', html`Todos <b>${num(items.length)}</b>`],
            ['pending', html`Aguardando <b>${num(pend.length)}</b>`],
            ['late', html`Atrasados <b>${num(late.length)}</b>`],
          ],
        })}</div>`
      : ''}
    <div class="dk-attn__body" data-attn-list>${attentionList(ctx, items)}</div>
    ${foot}${items.length <= 3 ? queues : ''}
  </section>`;
}

/* ---------- Ranking das lojas (rede) ---------- */
function rankingRows(ctx, d, prev) {
  const prevBy = new Map((prev?.by_store || []).map((r) => [r.id, r]));
  return (d.by_store || []).map((r) => {
    const s = ctx.stores.find((x) => x.id === r.id) || { id: r.id, name: r.name, slug: r.slug };
    const p = prevBy.get(r.id);
    return {
      s,
      id: r.id,
      revenue: Number(r.revenue) || 0,
      orders: Number(r.orders) || 0,
      pending: Number(r.pending) || ctx.pendingByStore?.get?.(r.id) || 0,
      prevRevenue: p ? Number(p.revenue) || 0 : undefined,
      prevOrders: p ? Number(p.orders) || 0 : undefined,
      paused: s.accepts_orders === false,
      inactive: s.active === false,
    };
  });
}

function rankingList(ctx, rows) {
  const byOrders = state.rank === 'orders';
  const val = (r) => (byOrders ? r.orders : r.revenue);
  const sorted = [...rows].sort((a, b) => {
    const za = val(a) > 0 && !a.paused && !a.inactive ? 0 : 1;
    const zb = val(b) > 0 && !b.paused && !b.inactive ? 0 : 1;
    return za - zb || val(b) - val(a) || String(a.s.name).localeCompare(String(b.s.name), 'pt-BR');
  });
  const max = Math.max(1, ...sorted.map(val));
  return html`<ol class="rank__list dk-rank__list">${sorted.map((r, i) => {
    const v = val(r);
    const short = ctx.storeShort(r.s) || r.s.name;
    const pend = r.pending ? html` · <b class="rank__new">${plural(r.pending, 'novo', 'novos')}</b>` : '';
    let sub;
    if (r.inactive) sub = html`<span class="rank__paused">Inativa</span>`;
    else if (r.paused) sub = html`<span class="rank__paused">Pedidos pausados</span>${pend}`;
    else if (!v) sub = html`Sem vendas no período${pend}`;
    else sub = byOrders ? html`${money(r.revenue)}${pend}` : html`${plural(r.orders, 'pedido', 'pedidos')}${pend}`;
    const d = byOrders ? dpct(r.orders, r.prevOrders) : dpct(r.revenue, r.prevRevenue);
    const label = `${r.s.name}: ${v ? (byOrders ? plural(r.orders, 'pedido', 'pedidos') : money(r.revenue)) : 'sem vendas no período'}${
      r.pending ? `, ${plural(r.pending, 'pedido novo', 'pedidos novos')}` : ''
    }. Abrir o painel da loja.`;
    return html`<li><a class="rank__row ${v ? '' : 'is-zero'}" href="#/dashboard" data-store-row="${r.id}" aria-label="${label}">
      <span class="rank__pos ${i < 3 && v ? 'rank__pos--top' : ''}">${i + 1}</span>
      ${storeMark(r.s, 26)}
      <span class="rank__name"><strong>${short}</strong><span class="ellipsis">${sub}</span></span>
      <span class="rank__bar"><span class="meter"><span style="width:${v ? Math.max(2, (v / max) * 100).toFixed(1) : 0}%"></span></span></span>
      <span class="rank__end"><span class="rank__val">${v ? (byOrders ? num(r.orders) : money(r.revenue)) : '—'}</span><span class="rank__d">${
        v && d !== undefined ? deltaPill(d, { prev: byOrders ? plural(r.prevOrders, 'pedido', 'pedidos') : money(r.prevRevenue) }) : ''
      }</span></span>
    </a></li>`;
  })}</ol>`;
}

function rankingCard(ctx, d, prev, view) {
  const rows = rankingRows(ctx, d, prev);
  view.rankRows = rows;
  return html`<section class="card rank dk-rank" aria-labelledby="dk-rank-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-rank-t">Ranking das lojas</h2><p class="card__sub">${plural(rows.length, 'loja', 'lojas')} · ${periodWords(view.range).short} · clique para abrir a loja</p></div>
      ${segmented({ name: 'rank', label: 'Ordenar ranking por', size: 'sm', value: state.rank, options: [['revenue', 'Faturamento'], ['orders', 'Pedidos']] })}</div>
    <div data-rank-list>${rows.length ? rankingList(ctx, rows) : empty('Nenhuma loja cadastrada', '', '', { art: false, icon: 'stores', size: 'sm' })}</div>
  </section>`;
}

/* ---------- Mais vendidos e estoque baixo ---------- */
function topCard(ctx, d, view) {
  const top = Array.isArray(d.top_products) ? d.top_products : [];
  const r = view.range;
  const imgs = view.extras?.top || new Map();
  const rows = top.map((t, i) => html`<li class="top5__row ${i >= 5 ? 'dk-more' : ''}">
    <span class="dk-rankn" aria-hidden="true">${i + 1}</span>${thumb(imgs.get(t.name)?.image_url, 'products')}
    <div class="grow"><div class="strong ellipsis" title="${t.name}">${t.name}</div><div class="sub">${plural(t.qty, 'unidade', 'unidades')}</div></div>
    <span class="num strong nowrap">${money(t.revenue)}</span>
  </li>`);
  return html`<section class="card top5 dk-top" aria-labelledby="dk-top-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-top-t">Mais vendidos</h2><p class="card__sub">Por quantidade · ${periodWords(r).short}</p></div>
      <a class="link" href="#/reports?from=${r.from}&to=${r.to}&group=product">Relatório</a></div>
    ${top.length
      ? html`<ol class="top5__list dk-list" data-list>${rows}</ol>${
          top.length > 5 ? html`<button class="btn btn--ghost btn--sm dk-toggle" type="button" data-dk-more aria-expanded="false">Mostrar os ${num(top.length)}</button>` : ''
        }`
      : empty('Nenhum produto vendido', 'Os mais vendidos do período aparecem aqui.', '', { art: false, icon: 'products', size: 'sm' })}
  </section>`;
}

const LOW_SHOW = 4;
function lowCard(ctx, d, view) {
  const list = Array.isArray(d.low_stock_list) ? d.low_stock_list : [];
  const c = d.catalog || {};
  const total = (Number(c.out_of_stock) || 0) + (Number(c.low_stock) || 0);
  const canCat = ctx.can('catalog');
  const extra = view.extras?.low || new Map();
  return html`<section class="card low dk-low" aria-labelledby="dk-low-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-low-t">Estoque baixo ${total ? html`<span class="count-pill count-pill--warn">${num(total)}</span>` : ''}</h2><p class="card__sub">Ativos abaixo do alerta de cada produto</p></div>
      ${canCat ? html`<a class="link" href="#/products?stock=low">Ver produtos</a>` : ''}</div>
    ${list.length
      ? html`<ul class="low__list dk-list" data-list>${list.map((p, i) => {
          const x = extra.get(p.id);
          const zero = Number(p.stock_qty) <= 0;
          const subTxt = [ctx.storeId ? '' : ctx.storeShort(p.store_id) || p.store_name, x?.sku ? `SKU ${x.sku}` : ''].filter(Boolean).join(' · ');
          const name = ctx.can('catalog', p.store_id) ? html`<a class="dk-low__a" href="#/products/${encodeURIComponent(p.id)}">${p.name}</a>` : p.name;
          return html`<li class="low__row ${i >= LOW_SHOW ? 'dk-more' : ''}">${thumb(x?.image_url, 'box')}
            <div class="grow"><div class="strong ellipsis">${name}</div>${subTxt ? html`<div class="sub ellipsis">${subTxt}</div>` : ''}</div>
            ${zero ? html`<span class="badge t-bad">Esgotado</span>` : html`<span class="badge t-warn">${num(p.stock_qty)} un.</span>`}
          </li>`;
        })}</ul>${list.length > LOW_SHOW ? html`<button class="btn btn--ghost btn--sm dk-toggle" type="button" data-dk-more aria-expanded="false">Mostrar mais ${num(list.length - LOW_SHOW)}</button>` : ''}`
      : empty('Estoque em dia', 'Nenhum produto ativo abaixo do alerta de estoque.', '', { art: false, icon: 'checkCircle', size: 'sm' })}
  </section>`;
}

/* ---------- Status, pagamentos e catálogo ---------- */
function statusCard(ctx, d) {
  const byStatus = d.by_status || {};
  const keys = [...Object.keys(ORDER_STATUS), ...Object.keys(byStatus).filter((s) => !ORDER_STATUS[s])];
  const total = Number(d.orders) || 0;
  const tone = (s) => TONE[ORDER_STATUS[s]?.tone || ''] || 'neu';
  return html`<section class="card dk-status" aria-labelledby="dk-status-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-status-t">Pedidos por status</h2><p class="card__sub">${plural(total, 'pedido', 'pedidos')} no período</p></div></div>
    <div class="card__body">
      ${total ? html`<div class="dk-stack" aria-hidden="true">${keys.filter((s) => Number(byStatus[s]) > 0).map((s) => html`<span class="t-${tone(s)}" style="flex:${Number(byStatus[s])}"></span>`)}</div>` : ''}
      <ul class="dk-rows">${keys.map((s) => {
        const n = Number(byStatus[s]) || 0;
        return html`<li><a class="dk-srow ${n ? '' : 'is-zero'}" href="#/orders?status=${encodeURIComponent(s)}">
          <span class="dot t-${tone(s)}" aria-hidden="true"></span><span class="grow">${ORDER_STATUS[s]?.label || s}</span>
          <b class="num">${num(n)}</b><span class="dk-share num">${total ? pct((n / total) * 100) : '—'}</span>${icon('chevronRight', 'icon-sm')}
        </a></li>`;
      })}</ul>
    </div>
  </section>`;
}

function paymentCard(d) {
  const byPayment = Object.entries(d.by_payment || {}).sort((a, b) => b[1] - a[1]);
  const total = byPayment.reduce((s, [, n]) => s + Number(n), 0);
  return html`<section class="card dk-pay" aria-labelledby="dk-pay-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-pay-t">Formas de pagamento</h2><p class="card__sub">${plural(total, 'pedido válido', 'pedidos válidos')}</p></div></div>
    <div class="card__body">${
      byPayment.length
        ? html`<ul class="dk-rows dk-pays">${byPayment.map(([k, n]) => {
            const share = total ? (Number(n) / total) * 100 : 0;
            return html`<li class="dk-prow">
              <span class="dk-ptile" aria-hidden="true">${icon(PAYMENT_ICON[k] || 'wallet', 'icon-sm')}</span>
              <div class="grow"><div class="dk-prow__top"><span class="strong">${PAYMENT_METHOD[k] || k}</span><span class="muted small nowrap"><b class="num dk-pay-n">${num(n)}</b> · ${pct(share)}</span></div>
              <div class="meter" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></div></div>
            </li>`;
          })}</ul>`
        : empty('Sem pagamentos no período', 'Os pedidos válidos aparecem aqui por forma de pagamento.', '', { art: false, icon: 'wallet', size: 'sm' })
    }</div>
  </section>`;
}

function catalogCard(ctx, d, { title = 'Catálogo' } = {}) {
  const c = d.catalog || {};
  const canCatalog = ctx.can('catalog');
  const row = (label, value, tone, href, ico) => {
    const n = Number(value) || 0;
    const inner = html`<span class="dk-ci t-${tone}" aria-hidden="true">${icon(ico, 'icon-xs')}</span><span class="grow">${label}</span><b class="num">${num(n)}</b>${canCatalog ? icon('chevronRight', 'icon-sm') : ''}`;
    return html`<li>${canCatalog ? html`<a class="dk-srow ${n ? '' : 'is-zero'}" href="${href}">${inner}</a>` : html`<div class="dk-srow ${n ? '' : 'is-zero'}">${inner}</div>`}</li>`;
  };
  return html`<section class="card dk-cat" aria-labelledby="dk-cat-t">
    <div class="card__head"><div><h2 class="card__title" id="dk-cat-t">${title}</h2><p class="card__sub">${plural((Number(c.active) || 0) + (Number(c.draft) || 0) + (Number(c.archived) || 0), 'produto', 'produtos')} ${ctx.store ? `em ${ctx.storeShort(ctx.store)}` : 'em todas as lojas'}</p></div>
      ${canCatalog ? html`<a class="link" href="#/products">Ver produtos</a>` : ''}</div>
    <div class="card__body"><ul class="dk-rows">
      ${row('Ativos na loja virtual', c.active, 'ok', '#/products?status=active', 'checkCircle')}
      ${row('Rascunhos', c.draft, 'warn', '#/products?status=draft', 'edit')}
      ${row('Arquivados', c.archived, 'neu', '#/products?status=archived', 'archive')}
      ${row('Sem estoque', c.out_of_stock, 'bad', '#/products?stock=out', 'xCircle')}
      ${row('Estoque baixo', c.low_stock, 'ora', '#/products?stock=low', 'alert')}
    </ul></div>
  </section>`;
}

/* ---------- Visão do catálogo (perfil sem vendas, ex.: editor) ---------- */
function catalogOnlyBody(ctx, d, view) {
  const c = d.catalog || {};
  const canCat = ctx.can('catalog');
  const k = (label, value, href, sub, cls, ico) => kpiCard({ label, value: num(value), sub, href: canCat ? href : undefined, cls: `${cls} dk-ck`, icon: ico });
  return html`<div class="kpis dk-kpis">
      ${k('Produtos ativos', c.active, '#/products?status=active', 'Aparecem na loja virtual', 'dk-k1 dk-ck--ok', 'checkCircle')}
      ${k('Rascunhos', c.draft, '#/products?status=draft', 'Ainda não publicados', 'dk-k2 dk-ck--warn', 'edit')}
      ${k('Sem estoque', c.out_of_stock, '#/products?stock=out', 'Ativos com estoque zerado', 'dk-k3 dk-ck--bad', 'xCircle')}
      ${k('Estoque baixo', c.low_stock, '#/products?stock=low', 'Abaixo do alerta de cada produto', 'dk-k4 dk-ck--ora', 'alert')}
    </div>
    <div class="dk-row dk-row--rank">
      ${lowCard(ctx, d, view)}
      <div class="dk-col">
        <section class="card dk-shortcuts" aria-labelledby="dk-short-t">
          <div class="card__head"><div><h2 class="card__title" id="dk-short-t">Atalhos do catálogo</h2><p class="card__sub">O que você mais usa no dia a dia</p></div></div>
          <div class="card__body"><ul class="dk-rows">
            ${canCat ? html`<li><a class="dk-srow" href="#/products/new"><span class="dk-ptile" aria-hidden="true">${icon('plus', 'icon-sm')}</span><span class="grow">Cadastrar produto</span>${icon('chevronRight', 'icon-sm')}</a></li>` : ''}
            ${canCat ? html`<li><a class="dk-srow" href="#/products?status=draft"><span class="dk-ptile" aria-hidden="true">${icon('edit', 'icon-sm')}</span><span class="grow">Produtos em rascunho</span><b class="num">${num(c.draft)}</b>${icon('chevronRight', 'icon-sm')}</a></li>` : ''}
            ${canCat ? html`<li><a class="dk-srow" href="#/showcase"><span class="dk-ptile" aria-hidden="true">${icon('showcase', 'icon-sm')}</span><span class="grow">Vitrine e banners</span>${icon('chevronRight', 'icon-sm')}</a></li>` : ''}
          </ul>
          <div class="alert alert--info dk-note">${icon('info')}<div><strong>Visão do catálogo.</strong> Seu perfil acompanha os produtos desta loja; os indicadores de vendas ficam com administradores, gerentes e atendimento.</div></div>
          </div>
        </section>
      </div>
    </div>`;
}

/* ---------- Esqueleto (mesma geometria da tela) ---------- */
const sk = (w, h = 12, extra = '') => html`<span class="skeleton ${extra}" style="width:${w};height:${h}px"></span>`;
function skeletonBody(canSales) {
  const card = (rows, h = 280) =>
    html`<div class="card dk-skcard" style="min-height:${h}px"><div class="card__head">${sk('40%', 16)}</div><div class="card__body dk-sklines">${Array.from({ length: rows }, () => html`<div class="dk-skrow">${sk('34px', 34, 'sk-thumb')}<span class="sk-lines">${sk('58%', 12)}${sk('34%', 10)}</span></div>`)}</div></div>`;
  return html`<div class="dk-body__sk" aria-busy="true"><span class="visually-hidden">Carregando indicadores…</span>
    <div class="kpis dk-kpis">${Array.from({ length: 4 }, () => html`<div class="card kpi dk-skkpi">${sk('46%', 12)}${sk('72%', 26, 'sk-mt')}${sk('52%', 10, 'sk-mt')}${sk('100%', 36, 'sk-spark')}</div>`)}</div>
    ${canSales ? html`<div class="dk-row dk-row--main">${card(0, 360)}${card(5, 360)}</div>` : html`<div class="dk-row dk-row--rank">${card(5)}${card(3)}</div>`}
  </div>`;
}

/* ---------- Estilos do módulo (o resto vem do admin.css) ---------- */
const CSS = `
.dk { display: flex; flex-direction: column; gap: 18px; }
.dk-top-slot { display: flex; flex-direction: column; gap: 14px; }
.dk-top-slot:empty { display: none; }
.dk-body { display: flex; flex-direction: column; gap: 16px; transition: opacity var(--dur-2) var(--ease-out); }
.dk-body[aria-busy="true"] { opacity: .55; pointer-events: none; }
.dk-row { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); align-items: stretch; }
.dk-row--rank { grid-template-columns: minmax(0, 1.42fr) minmax(0, 1fr); align-items: start; }
.dk-row--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }
.dk-row--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
.dk-low .card__head, .dk-top .card__head, .dk-cat .card__head, .dk-attn .card__head { flex-wrap: nowrap; align-items: flex-start; }
.dk .card__head > div { min-width: 0; }
.dk .card__head .link { flex: none; padding-top: 2px; }
.dk-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* saudação */
.dk-greet .greet__sum .age { font-weight: 600; }
.dk-short, .dk-short-acts { display: none; }
.dk-long-acts { display: contents; }
.dk-strip .gstrip__txt .age { white-space: nowrap; }
.dk-strip__acts { display: contents; }

/* comemoração (celebrate.svg) */
.mile { position: relative; display: flex; align-items: center; gap: 18px; padding: 12px 56px 12px 16px; border-radius: 20px; overflow: hidden;
  background: radial-gradient(60% 140% at 0% 50%, color-mix(in srgb, var(--highlight) 16%, transparent), transparent 70%), var(--surface);
  border: 1px solid var(--ora-line); box-shadow: var(--sh-card); }
.mile__art { flex: none; width: 148px; height: 111px; display: grid; place-items: center; }
.mile__art .art { width: 100%; height: 100%; }
.mile__ico { display: none; width: 44px; height: 44px; border-radius: 14px; place-items: center; flex: none; background: var(--ora-bg); color: var(--ora-fg); box-shadow: inset 0 0 0 1px var(--ora-line); }
.mile.is-plain .mile__art { display: none; }
.mile.is-plain .mile__ico { display: grid; }
.mile__txt { min-width: 0; }
.mile__eyebrow { display: inline-flex; align-items: center; gap: 6px; font: 700 11px/1 var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--highlight-ink); }
.mile__title { margin-top: 7px; font: 800 22px/1.15 var(--font-display); letter-spacing: -.015em; color: var(--ink); }
.mile__text { margin-top: 4px; font-size: 14px; line-height: 1.45; color: var(--text); max-width: 640px; }
.mile__link { margin-top: 8px; }
.mile__x { position: absolute; top: 10px; right: 10px; }

/* barra do resumo */
.dk-sumbar .sumbar__t { margin: 0 0 3px; }
.dk-ctrl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dk-period .seg__b[aria-pressed="true"] { background: var(--raised); color: var(--ink); box-shadow: var(--sh-btn), 0 0 0 1px var(--line); }
.dk-period .seg__b .icon-sm { margin-left: -2px; }
.dk-period-m { display: none; }
.dk-refresh.is-spinning svg { animation: spin .7s linear infinite; }

/* indicadores */
.dk-compact { display: none; }
.dk-kpis .kpi__sub span[title] { text-decoration: none; }

/* gráfico */
.dk-chart { display: flex; flex-direction: column; }
.dk-chart__body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding-top: 10px; }
.dk-chart .legend { align-self: flex-start; padding-top: 2px; }

/* atenção */
.attn__filter { padding: 12px 20px 2px; }
.attn__filter .seg { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.attn__filter .seg__b b { font-weight: 700; color: var(--muted); margin-left: 3px; }
.attn__filter .seg__b.is-on b { color: var(--ink); }
.attn__dotsep { color: var(--faint); }
.dk-attn { display: flex; flex-direction: column; }
.dk-attn__body { flex: 1; }
.dk-queues { margin-top: auto; }
.dk-attn__main { min-width: 0; }
.dk-attn__t { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink); text-decoration: none; }
a.dk-attn__t:hover { text-decoration: underline; }
.dk-attn__btn { flex: none; min-width: 84px; justify-content: center; position: relative; z-index: 1; }
/* a linha inteira abre o pedido/produto (alvo maior); o botão de ação fica por cima */
.dk-attn .attn__item, .dk-low .low__row { position: relative; }
.dk-attn__t[href]::after, .dk-low__a::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
.dk-attn__t[href]:focus-visible, .dk-low__a:focus-visible { outline: none; }
.dk-attn__t[href]:focus-visible::after, .dk-low__a:focus-visible::after { outline: 2px solid var(--focus); outline-offset: -2px; }
.dk-attn .attn__item:has(.dk-attn__t[href]:hover), .dk-low .low__row:has(.dk-low__a:hover) { background: var(--surface-2); }
.attn__item { transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.attn__item.is-done { opacity: .45; }
.dk-attn__more { display: inline-flex; align-items: center; gap: 5px; margin: 0 20px 6px 64px; font-size: 13px; font-weight: 600; color: var(--accent-ink); }
.dk-attn__none { display: flex; align-items: center; gap: 8px; padding: 16px 20px 18px; font-size: 13.5px; }
.dk-attn__none .icon-sm { color: var(--ok-fg); }
.dk-attn .empty--inline { padding-top: 14px; }

/* ranking */
.dk-rank .card__head { align-items: flex-start; }
.dk-rank .rank__row { grid-template-columns: 22px 26px minmax(0, 1fr) 76px 106px 74px; }
.rank__bar { display: block; }
.rank__bar .meter { display: block; }
.rank__paused { color: var(--muted); }
.rank__end { display: contents; }
.rank__d .delta { height: 20px; font-size: 11.5px; }

/* listas com foto */
.dk-thumb { width: 40px; height: 40px; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 10px; background: var(--surface-3); border: 1px solid var(--line); color: var(--muted); }
.dk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.top5__row, .low__row { border-radius: 12px; }
.dk-rankn { width: 14px; flex: none; text-align: center; font: 700 12px/1 var(--font-ui); color: var(--muted); font-variant-numeric: tabular-nums; }
.dk-list:not(.is-open) .dk-more { display: none; }
.dk-toggle { margin: 0 20px 14px; }
.dk-low__a { color: var(--ink); }
.dk-low__a:hover { color: var(--accent-ink); }
.low__row .badge { flex: none; }

/* status, pagamentos, catálogo */
.dk-stack { display: flex; gap: 3px; height: 10px; margin-bottom: 10px; }
.dk-stack span { min-width: 6px; border-radius: 999px; background: var(--d); }
.dk-rows { list-style: none; margin: 0; padding: 0; }
.dk-srow { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 8px; margin: 0 -8px; border-radius: 10px; color: var(--text); text-decoration: none; font-size: 13.5px; }
.dk-srow:hover { background: var(--surface-2); text-decoration: none; color: var(--ink); }
.dk-srow b { color: var(--ink); font-weight: 700; }
.dk-srow .icon-sm:last-child { color: var(--faint); }
.dk-srow.is-zero { color: var(--muted); }
.dk-srow.is-zero b { color: var(--muted); font-weight: 600; }
.dk-share { width: 40px; text-align: right; font-size: 12.5px; color: var(--muted); }
.dk-pays { display: flex; flex-direction: column; gap: 14px; }
.dk-prow { display: flex; align-items: center; gap: 12px; }
.dk-prow__top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 7px; font-size: 13.5px; }
.dk-pay-n { color: var(--ink); }
.dk-ptile { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 11px; background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
.dk-ci { width: 26px; height: 26px; flex: none; border-radius: 8px; display: grid; place-items: center; background: var(--b-bg); color: var(--b-fg); box-shadow: inset 0 0 0 1px var(--b-line); }
.dk-srow.is-zero .dk-ci { opacity: .7; }
.dk-note { margin-top: 14px; }
.dk-ck .kpi__ico { background: var(--b-bg); color: var(--b-fg); box-shadow: inset 0 0 0 1px var(--b-line); }
.dk-ck--ok { --b-bg: var(--ok-bg); --b-fg: var(--ok-fg); --b-line: var(--ok-line); }
.dk-ck--warn { --b-bg: var(--warn-bg); --b-fg: var(--warn-fg); --b-line: var(--warn-line); }
.dk-ck--bad { --b-bg: var(--bad-bg); --b-fg: var(--bad-fg); --b-line: var(--bad-line); }
.dk-ck--ora { --b-bg: var(--ora-bg); --b-fg: var(--ora-fg); --b-line: var(--ora-line); }

/* esqueleto */
.dk-skkpi { gap: 0; min-height: 150px; }
.dk-skkpi .sk-spark { margin-top: auto; }
.dk-sklines { display: flex; flex-direction: column; gap: 16px; }
.dk-skrow { display: flex; align-items: center; gap: 12px; }
.dk-skrow .sk-lines { display: flex; flex-direction: column; gap: 7px; flex: 1; }
.dk-skgreet { height: 188px; border-radius: 22px; }

@media (max-width: 1279px) {
  .dk-row--main { grid-template-columns: minmax(0, 1fr); }
  .dk-row--rank { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
}
@media (max-width: 1023px) {
  .dk-greet .greet__txt { max-width: calc(100% - 220px); }
  .dk-row--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dk-row--3 > .dk-cat { grid-column: 1 / -1; }
  .dk-row--rank { grid-template-columns: minmax(0, 1fr); }
  .dk-row--rank > .dk-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
}
@media (max-width: 767px) {
  .dk { gap: 14px; }
  .dk-body { gap: 14px; }
  .dk-greet .greet__txt { max-width: 60%; }
  .dk-row--3, .dk-row--2, .dk-row--rank > .dk-col { grid-template-columns: minmax(0, 1fr); display: grid; }
  .dk-row--3 > .dk-cat { grid-column: auto; }
  .dk-row > .dk-attn { order: -1; }
  .dk-long, .dk-long-acts { display: none; }
  .dk-short { display: inline; }
  .dk-short-acts { display: contents; }
  .greet__acts .btn--primary { height: 40px; font-size: 13.5px; padding: 0 14px; }
  /* alvos de toque de 40 px no celular */
  .dk-strip .btn--sm { height: 40px; }
  .dk-strip > .btn--icon, .mile__x { width: 40px; height: 40px; }
  .dk .seg--sm .seg__b { height: 40px; }
  .dk-toggle { height: 40px; }
  .dk .card__head .link, .dk-attn__more, .mile__link { display: inline-flex; align-items: center; min-height: 40px; }
  .dk .card__head .link { margin: -10px -8px; padding: 0 8px; }
  .dk-attn__more { margin-top: -6px; margin-bottom: 0; }
  /* o valor do pedido não pode sumir na reticência: a linha de baixo quebra */
  .dk-attn .attn__sub { flex-wrap: wrap; row-gap: 1px; }
  .dk-attn .attn__sub .ellipsis { white-space: normal; overflow: visible; }
  .dk-strip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; column-gap: 12px; row-gap: 10px; padding: 12px; }
  .dk-strip .gstrip__txt { grid-column: 2; font-size: 13.5px; align-self: center; }
  .dk-strip > .btn--ghost { grid-column: 3; grid-row: 1; margin: -4px -4px 0 0; }
  .dk-strip__acts { display: flex; grid-column: 2 / 4; }
  .dk-sumbar { align-items: stretch; }
  .dk-sumbar > div:first-child { width: 100%; }
  .dk-ctrl { width: 100%; flex-wrap: nowrap; }
  .dk-period { display: none; }
  .dk-period-m { display: flex; flex: 1; min-width: 0; }
  .dk-period-m .sel, .dk-period-m .sel__trigger, .dk-period-m .select { width: 100%; max-width: none; }
  .dk-ctrl .btn--icon { flex: none; width: 40px; height: 40px; }
  .mile { flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 16px 16px; }
  .mile__art { width: 104px; height: 78px; margin: -2px 0 0 -6px; }
  .mile__title { font-size: 19px; }
  .dk-chart .card__head { flex-direction: column; align-items: flex-start; gap: 6px; }
  .dk-chart .chartx__y span:first-child { display: none; }
  .dk-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
  .dk-stats > div { padding: 0 8px; border-left: 1px solid var(--line); }
  .dk-stats > div:first-child { padding-left: 0; border-left: 0; }
  .dk-stats dt { font-size: 11.5px; line-height: 1.3; }
  .dk-stats dd { font-size: 13.5px; }
  .dk-queues .queue { padding: 9px 10px; }
  .dk-queues .queue span { font-size: 11.5px; line-height: 1.25; }
  .dk-attn__btn { height: 44px; min-width: 96px; border-radius: 12px; font-size: 14px; }
  .attn__item { padding: 10px 8px; }
  .dk-attn__more { margin-left: 52px; }
  .dk-rank .rank__row { grid-template-columns: 20px 26px minmax(0, 1fr) auto; height: auto; min-height: 52px; padding: 6px 8px; }
  .dk-rank .rank__bar { display: none; }
  .rank__end { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .dk-rank .card__head > .seg { width: 100%; display: grid; grid-template-columns: 1fr 1fr; }
  .rank__list, .low__list, .top5__list { padding: 0 6px 6px; }
}
@media (max-width: 600px) {
  .dk-full { display: none; }
  .dk-compact { display: inline; }
  .dk-kpis .dk-k1 { order: -2; }
  .dk-kpis .kpi--wait, .dk-kpis .kpi--wait-lite { order: -1; }
  .dk-kpis .kpi__sub { display: none; }
  .dk-kpis .kpi--wait .waitbar__legend { display: none; }
  .dk-kpis .kpi__label .kpi__info { display: none; }
  .dk-kpis .kpi__oldest { font-size: 0; gap: 4px; }
  .dk-kpis .kpi__oldest b { font-size: 12.5px; }
  .dk-kpis .kpi__oldest .icon-xs { width: 12px; height: 12px; }
  .dk-kpis .kpi__top { flex-wrap: wrap; row-gap: 4px; }
}
@media print {
  .dk-ctrl, .dk-strip, .mile__x, .dk-toggle, .tip { display: none !important; }
  .dk-list .dk-more { display: flex !important; }
}
`;

/* ---------- Módulo ---------- */
export default {
  title: 'Painel',
  async render(view, ctx) {
    injectStyle('dashboard', CSS);
    // O painel desenha o próprio título (saudação); o cabeçalho do shell fica escondido.
    ctx.setTitle('Painel', '', { visible: false });
    // Mesma regra do banco: na visão da rede (só admins globais) ou com permissão de pedidos.
    const canSales = !ctx.storeId || ctx.can('orders');
    let disposed = false;
    let token = 0;
    let shown = false;
    let topSig = '';
    let last = null; // { cur, prev, view }
    let rangeD = null;
    let rangeM = null;

    const scopeTitle = ctx.store ? `Resumo de ${ctx.storeShort(ctx.store)}` : 'Resumo da rede';
    render(
      view,
      html`<div class="dk">
        <div class="dk-top-slot" data-top><div class="skeleton dk-skgreet" aria-hidden="true"></div></div>
        ${canSales
          ? html`<section class="sumbar dk-sumbar" aria-labelledby="dk-sum-t">
              <div><h2 class="sumbar__t" id="dk-sum-t">${scopeTitle}</h2><p class="muted small" data-range-text></p></div>
              <div class="dk-ctrl">
                <div class="seg dk-period" role="group" aria-label="Período" data-period-group></div>
                <div class="dk-period-m">
                  <select class="select" id="dk-period" aria-label="Período" data-prefix="Período" data-sheet-title="Período" data-search="false"></select>
                  <button class="btn btn--icon" type="button" data-range-m aria-label="Escolher período"><span class="visually-hidden" data-range-label></span>${icon('calendar', 'icon-sm')}</button>
                </div>
                <button class="btn btn--icon dk-refresh" type="button" data-refresh aria-label="Atualizar indicadores" title="Atualizar">${icon('refresh', 'icon-sm')}</button>
                <button class="btn btn--icon" type="button" data-export aria-label="Exportar resumo em CSV" title="Exportar resumo (CSV)" disabled>${icon('download', 'icon-sm')}</button>
              </div>
            </section>`
          : html`<section class="sumbar dk-sumbar" aria-labelledby="dk-sum-t"><div><h2 class="sumbar__t" id="dk-sum-t">${ctx.store ? `Catálogo de ${ctx.storeShort(ctx.store)}` : 'Catálogo'}</h2><p class="muted small">Produtos, estoque e vitrine</p></div>
              <div class="dk-ctrl"><button class="btn btn--icon dk-refresh" type="button" data-refresh aria-label="Atualizar indicadores" title="Atualizar">${icon('refresh', 'icon-sm')}</button></div></section>`}
        <div class="dk-body" data-body>${skeletonBody(canSales)}</div>
        <p class="visually-hidden" role="status" aria-live="polite" data-status></p>
      </div>`
    );
    const topEl = $('[data-top]', view);
    const body = $('[data-body]', view);
    const refreshBtn = $('[data-refresh]', view);
    const exportBtn = $('[data-export]', view);

    /* ----- Período ----- */
    function drawPeriod() {
      if (!canSales) return;
      const r = currentRange();
      const words = periodWords(r);
      const rt = $('[data-range-text]', view);
      if (rt) rt.textContent = `${rangeLabel(r)} · comparado ${words.cmp}`;
      const group = $('[data-period-group]', view);
      if (group) {
        // os botões são desenhados uma vez e só mudam de estado (redesenhar tiraria o foco de quem usa o teclado)
        if (!rangeD) {
          render(
            group,
            html`${PERIODS.map((p) => html`<button type="button" class="seg__b" data-period="${p.id}" aria-pressed="false">${p.label}</button>`)}
            <button type="button" class="seg__b" data-period-custom aria-pressed="false">${icon('calendar', 'icon-sm')}<span data-range-label></span></button>`
          );
          rangeD = dateRange($('[data-period-custom]', group), { from: r.from, to: r.to, preset: PERIOD_TO_PRESET[state.period] || null, min: '2020-01-01', max: today(), onApply: applyRange });
        } else rangeD.set(r.from, r.to, PERIOD_TO_PRESET[state.period] || null);
        $$('.seg__b', group).forEach((b) => {
          const on = b.hasAttribute('data-period-custom') ? state.period === 'custom' : b.dataset.period === state.period;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        const btn = $('[data-period-custom]', group);
        if (state.period !== 'custom') {
          $('[data-range-label]', btn).textContent = 'Personalizado';
          btn.setAttribute('aria-label', 'Período personalizado: escolher datas');
        }
      }
      const sel = $('#dk-period', view);
      if (sel) {
        render(
          sel,
          html`${PERIODS.map((p) => {
            const pr = p.id === state.period ? r : rangeFor(p.id);
            return html`<option value="${p.id}" data-hint="${rangeLabel(pr)}" ${state.period === p.id ? 'selected' : ''}>${p.label}</option>`;
          })}<option value="custom" data-hint="${state.period === 'custom' ? rangeLabel(r) : 'Escolher as datas'}" ${state.period === 'custom' ? 'selected' : ''}>Personalizado</option>`
        );
        sel.value = state.period;
      }
      const mBtn = $('[data-range-m]', view);
      if (mBtn) {
        if (!rangeM) rangeM = dateRange(mBtn, { from: r.from, to: r.to, preset: PERIOD_TO_PRESET[state.period] || null, min: '2020-01-01', max: today(), onApply: applyRange });
        else rangeM.set(r.from, r.to, PERIOD_TO_PRESET[state.period] || null);
      }
    }
    function rangeFor(id) {
      const keep = state.period;
      state.period = id;
      const r = currentRange();
      state.period = keep;
      return r;
    }
    function applyRange({ from, to, preset }) {
      if (daysBetween(from, to) + 1 > MAX_DAYS) {
        toast('Escolha um período de até 2 anos.', 'warning');
        drawPeriod();
        return;
      }
      const p = PRESET_TO_PERIOD[preset];
      if (p) state.period = p;
      else {
        state.period = 'custom';
        state.from = from;
        state.to = to;
      }
      drawPeriod();
      load();
    }
    function setPeriod(id) {
      if (id === state.period && id !== 'custom') return;
      state.period = id;
      drawPeriod();
      load();
    }

    /* ----- Carregar ----- */
    async function load() {
      const my = ++token;
      const r = currentRange();
      if (shown) body.setAttribute('aria-busy', 'true');
      else if (!$('.dk-body__sk', body)) {
        // "Tentar de novo" depois de um erro: volta o esqueleto enquanto carrega
        render(body, skeletonBody(canSales));
        if (!topEl.children.length) render(topEl, html`<div class="skeleton dk-skgreet" aria-hidden="true"></div>`);
      }
      refreshBtn?.classList.add('is-spinning');
      if (exportBtn) exportBtn.disabled = true;
      try {
        const single = r.from === r.to;
        const t = today();
        const [cur, prev, attnRows, pulse, queues, dayData] = await Promise.all([
          rpc('dashboard', { p_store: ctx.storeId, p_from: dayStart(r.from), p_to: dayEnd(r.to) }),
          // os extras são opcionais: se falharem, o painel segue sem eles
          canSales ? rpc('dashboard', { p_store: ctx.storeId, ...previousWindow(r) }).catch(() => null) : null,
          canSales ? loadAttention(ctx).catch(() => null) : null,
          canSales ? loadTwoDays(ctx, t).catch(() => null) : null,
          canSales ? loadQueues(ctx).catch(() => null) : null,
          canSales && single && r.from !== t ? loadTwoDays(ctx, r.from).catch(() => null) : null,
        ]);
        if (disposed || my !== token) return;
        if (!cur) throw new Error('Não foi possível carregar os indicadores.');
        const extras = await loadExtras(ctx, cur).catch(() => null);
        if (disposed || my !== token) return;
        const sales = !!cur.can_see_sales;
        const attn = attnRows ? { rows: attnRows, pending: attnRows.filter((o) => o.status === 'pending') } : null;
        const vm = { range: r, attn, pulse, queues, extras, hourly: single ? (r.from === t ? pulse : dayData) : null };
        vm.items = sales ? attentionItems(ctx, cur, attn) : [];
        last = { cur, prev: sales && prev?.can_see_sales ? prev : null, vm };
        drawTop(cur, vm, sales);
        drawBody();
        shown = true;
        if (exportBtn) exportBtn.disabled = !sales;
        const st = $('[data-status]', view);
        if (st) st.textContent = sales ? `Indicadores atualizados: ${money(cur.revenue)} em ${plural(cur.orders_ok, 'pedido válido', 'pedidos válidos')}.` : 'Indicadores do catálogo atualizados.';
      } catch (e) {
        if (disposed || my !== token) return;
        if (shown) toastError(e);
        else {
          render(topEl, '');
          render(body, html`<div class="card">${errorBlock(e, { retry: () => load(), title: 'Não foi possível carregar o painel' })}</div>`);
        }
      } finally {
        if (my === token && !disposed) {
          body.removeAttribute('aria-busy');
          refreshBtn?.classList.remove('is-spinning');
          // uma atualização que falhou mantém os números anteriores na tela (e o CSV deles)
          if (exportBtn) exportBtn.disabled = !last?.cur?.can_see_sales;
        }
      }
    }

    function drawTop(cur, vm, sales) {
      const pend = vm.attn ? vm.attn.pending : null;
      const g = {
        mode: greetMode(ctx),
        canSales: sales,
        canCatalog: ctx.can('catalog'),
        catalog: cur.catalog || {},
        pulse: vm.pulse,
        nPend: pend ? pend.length : Number(cur.pending_now) || 0,
        oldest: pend && pend.length ? pend[0].created_at : null,
      };
      const cel = sales ? celebrateData(ctx, vm.pulse) : null;
      g.celebrating = !!cel;
      const tipHtml = tipBlock(ctx, cur);
      const sig = JSON.stringify([g.mode, greetWord(), g.nPend, g.oldest, vm.pulse?.rev, vm.pulse?.n, g.catalog, cel?.key, cel?.rev, String(tipHtml), ctx.storeId]);
      if (sig === topSig) return;
      topSig = sig;
      keepFocus(topEl, () => render(topEl, html`${greetingBlock(ctx, g)}${celebrateBlock(ctx, cel)}${tipHtml}`));
    }

    function drawBody() {
      if (!last) return;
      const { cur, prev, vm } = last;
      vm.bodyW = body.clientWidth;
      const key = captureFocus(body);
      if (!cur.can_see_sales) {
        render(body, catalogOnlyBody(ctx, cur, vm));
        restoreFocus(body, key);
        return;
      }
      render(
        body,
        html`${kpiBlock(ctx, cur, prev, vm)}
        <div class="dk-row dk-row--main">${chartCard(cur, prev, vm)}${attentionCard(ctx, cur, vm)}</div>
        ${ctx.storeId
          ? html`<div class="dk-row dk-row--rank">${topCard(ctx, cur, vm)}<div class="dk-col">${lowCard(ctx, cur, vm)}${paymentCard(cur)}</div></div>
            <div class="dk-row dk-row--2">${statusCard(ctx, cur)}${catalogCard(ctx, cur)}</div>`
          : html`<div class="dk-row dk-row--rank">${rankingCard(ctx, cur, prev, vm)}<div class="dk-col">${topCard(ctx, cur, vm)}${lowCard(ctx, cur, vm)}</div></div>
            <div class="dk-row dk-row--3">${statusCard(ctx, cur)}${paymentCard(cur)}${catalogCard(ctx, cur)}</div>`}`
      );
      fitChart();
      restoreFocus(body, key);
    }

    // O gráfico acompanha a altura do cartão "Precisa de atenção" ao lado (sem buraco embaixo do gráfico).
    function fitChart(reset = false) {
      if (!last || !last.cur.can_see_sales) return;
      const row = $('.dk-row--main', body);
      const chart = row && $('.dk-chart', row);
      const attn = row && $('.dk-attn', row);
      const plot = chart && $('.chartx__plot', chart);
      if (!chart || !attn) return;
      if (reset && last.vm.chartH) {
        last.vm.chartH = null;
        swapChart();
        return fitChart();
      }
      if (!plot || Math.abs(chart.offsetTop - attn.offsetTop) > 2 || !plot.clientWidth) return;
      row.style.alignItems = 'start';
      const delta = attn.offsetHeight - chart.offsetHeight;
      row.style.alignItems = '';
      if (Math.abs(delta) < 6) return;
      const base = last.vm.chartH || 290;
      const next = Math.round(Math.min(560, Math.max(220, base + (delta * 640) / plot.clientWidth)));
      if (Math.abs(next - base) < 4) return;
      last.vm.chartH = next;
      swapChart();
    }
    function swapChart() {
      const old = $('.dk-chart', body);
      if (!old) return;
      const tmp = document.createElement('div');
      render(tmp, chartCard(last.cur, last.prev, last.vm));
      keepFocus(body, () => old.replaceWith(tmp.firstElementChild));
    }
    const onResize = debounce(() => {
      if (!disposed) fitChart(true);
    }, 250);
    window.addEventListener('resize', onResize);

    /* ----- Ações ----- */
    async function confirmOrder(btn) {
      const id = btn.dataset.confirm;
      const code = btn.dataset.code;
      // o botão some da lista depois de confirmar: o foco vai para a próxima pendência (ou o título do cartão)
      const focusKey = captureFocus(body);
      try {
        await withBusy(btn, () => rpc('update_order_status', { p_order: id, p_status: 'confirmed', p_visible: true }), 'Confirmando…');
      } catch (e) {
        toastError(e);
        restoreFocus(body, focusKey);
        return;
      }
      btn.closest('.attn__item')?.classList.add('is-done');
      btn.disabled = true;
      ctx.announce?.(`Pedido ${code} confirmado.`);
      toast(`Pedido ${code} confirmado`, 'success', 6000, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            try {
              await rpc('update_order_status', { p_order: id, p_status: 'pending', p_message: 'Confirmação desfeita', p_visible: false });
              toast(`Pedido ${code} voltou para Aguardando confirmação`, 'info');
              ctx.refreshBadges();
              if (!disposed) load();
            } catch (e) {
              toastError(e);
            }
          },
        },
      });
      ctx.refreshBadges();
      await load();
      if (!disposed) restoreFocus(body, focusKey);
    }

    function exportCsv() {
      if (!last?.cur?.can_see_sales) return toast('Não há dados para exportar.', 'warning');
      try {
        const { cur, vm } = last;
        const rows = (cur.series || []).map((s) => ({ ...s }));
        const csv = toCSV(rows, [
          { label: 'Dia', value: (s) => brDate(s.day) },
          { label: 'Pedidos válidos', value: (s) => String(Number(s.orders) || 0) },
          { label: 'Faturamento', value: (s) => csvMoney(s.revenue) },
          { label: 'Ticket médio', value: (s) => csvMoney(Number(s.orders) ? Number(s.revenue) / Number(s.orders) : 0) },
        ]);
        const slug = ctx.store?.slug || 'rede';
        downloadFile(`painel-${slug}-${vm.range.from}-a-${vm.range.to}.csv`, csv);
        toast('Resumo exportado.', 'success');
      } catch (e) {
        toastError(e);
      }
    }

    view.addEventListener('click', (e) => {
      const per = e.target.closest('[data-period]');
      if (per) return setPeriod(per.dataset.period);
      if (e.target.closest('[data-refresh]')) return load();
      if (e.target.closest('[data-export]')) return exportCsv();
      const conf = e.target.closest('[data-confirm]');
      if (conf) return confirmOrder(conf);
      const more = e.target.closest('[data-dk-more]');
      if (more) {
        const list = $('[data-list]', more.closest('.card'));
        const open = !list.classList.contains('is-open');
        list.classList.toggle('is-open', open);
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'Mostrar menos' : more.closest('.dk-top') ? `Mostrar os ${$$('li', list).length}` : `Mostrar mais ${$$('.dk-more', list).length}`;
        return;
      }
      const row = e.target.closest('[data-store-row]');
      if (row) {
        e.preventDefault();
        const id = row.dataset.storeRow;
        if (ctx.stores.some((s) => s.id === id)) ctx.setStore(id, '#/dashboard');
        return;
      }
      if (e.target.closest('[data-strip-close]')) {
        stripOffDay = today();
        ls.set(STRIP_KEY, stripOffDay);
        const strip = e.target.closest('.gstrip');
        strip?.remove();
        topSig = '';
        $('[data-refresh]', view)?.focus();
        return;
      }
      const mile = e.target.closest('[data-mile-close]');
      if (mile) {
        const box = mile.closest('[data-mile]');
        milesOff.add(box.dataset.mile);
        const list = milestones();
        ls.set(MILE_KEY, JSON.stringify([...list.slice(-40), `${box.dataset.mile}:x`]));
        box.remove();
        topSig = '';
        $('[data-refresh]', view)?.focus();
      }
    });
    // segmentados (filtro da atenção, ordem do ranking)
    view.addEventListener('seg:change', (e) => {
      if (!last) return;
      if (e.detail.name === 'attn') {
        state.attn = e.detail.value;
        const el = $('[data-attn-list]', view);
        if (el) render(el, attentionList(ctx, last.vm.items));
        fitChart(true);
      } else if (e.detail.name === 'rank') {
        state.rank = e.detail.value;
        const el = $('[data-rank-list]', view);
        if (el && last.vm.rankRows) render(el, rankingList(ctx, last.vm.rankRows));
      }
    });
    // período no celular (select personalizado → folha)
    view.addEventListener('change', (e) => {
      if (e.target.id !== 'dk-period') return;
      const v = e.target.value;
      if (v === 'custom') {
        e.target.value = state.period;
        rangeM?.open();
        return;
      }
      setPeriod(v);
    });

    // Novos pedidos e mudanças de status atualizam os números sem recarregar a tela.
    const auto = debounce(() => {
      if (!disposed) load();
    }, 1200);
    ctx.on('new-order', auto);
    ctx.on('order-updated', auto);
    // a idade dos pedidos aguardando (barra do cartão "Aguardando") anda a cada minuto
    const tick = setInterval(() => {
      if (disposed || document.hidden || !last || !last.cur.can_see_sales) return;
      const k = $('.dk-kpis', view);
      if (k && !body.hasAttribute('aria-busy')) {
        const tmp = document.createElement('div');
        render(tmp, kpiBlock(ctx, last.cur, last.prev, last.vm));
        keepFocus(body, () => k.replaceWith(tmp.firstElementChild));
      }
    }, 60000);
    ctx.onCleanup(() => {
      disposed = true;
      clearInterval(tick);
      window.removeEventListener('resize', onResize);
      rangeD?.destroy();
      rangeM?.destroy();
    });

    drawPeriod();
    await load();
  },
};
