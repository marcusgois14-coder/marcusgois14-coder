// Cupons de desconto: lista por loja (com os cupons da rede, somente leitura para a equipe da loja)
// ou da rede inteira (administradores da rede), resumo de uso, criação/edição com prévia, duplicar,
// ativar/desativar, exclusão e teste (validate_coupon, o mesmo que a loja virtual usa).
//
// Regras (espelham public.coupon_eval no banco):
//   percentual → subtotal × valor/100 (limitado ao desconto máximo) · valor fixo → até o subtotal
//   frete grátis → zera o frete · pedido mínimo sobre o subtotal · o desconto PIX da loja vem depois do cupom.
//   Cupom da loja tem prioridade sobre um cupom da rede com o mesmo código.
//
// Também exporta o campo "Período" (data dd/mm/aaaa + hora, horário de Brasília, com calendário),
// usado aqui e em showcase.js (banners e avisos).
import { sb, q, rpc } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, money, num, pct, datetime, relTime, badge, openModal, confirmDialog,
  showErrors, withBusy, empty, errorBlock, skeleton, injectStyle, debounce, fold, highlight, storeMark,
  kpiCard, pager, tip, pushLayer, popLayer,
} from '../ui.js';

const TYPES = { percent: 'Percentual', fixed: 'Valor fixo', free_shipping: 'Frete grátis' };
const TYPE_ICON = { percent: 'percent', fixed: 'cash', free_shipping: 'truck' };
const TYPE_HINT = { percent: 'Porcentagem sobre os produtos', fixed: 'Valor em reais sobre os produtos', free_shipping: 'Zera o frete da entrega' };
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const EXAMPLE_SUBTOTAL = 1000;
const PAGE_SIZE = 25;
const DAY = 86400000;
const TABS = [
  ['', 'Todos', ''],
  ['live', 'Vigentes', 'ok'],
  ['scheduled', 'Agendados', 'info'],
  ['expired', 'Expirados', 'neu'],
  ['off', 'Inativos', 'neu'],
];
const TAB_EMPTY = { live: 'vigente', scheduled: 'agendado', expired: 'expirado', off: 'inativo' };

/* ---------- Utilitários ---------- */
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtNum = (v) => nf.format(Number(v) || 0);
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
// Valor para um campo de texto (sem separador de milhar): 300 · 299,90
const inputNum = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
};
// "1.000,50" · "1000.5" · "R$ 50" → número; '' → null; inválido → NaN
function parseNum(v) {
  let s = String(v ?? '').replace(/\s|R\$|%/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function parseIntOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

function phaseOf(c, now = Date.now()) {
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return 'expired';
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return 'scheduled';
  return 'live';
}
const soldOut = (c) => c.usage_limit !== null && c.usage_limit !== undefined && c.used_count >= c.usage_limit;

// Vigentes/Agendados contam só cupons ativos; Expirados, todos os vencidos; Inativos, os desligados
function matchesChip(c, chip) {
  if (!chip) return true;
  if (chip === 'off') return !c.active;
  if (chip === 'expired') return phaseOf(c) === 'expired';
  return c.active && phaseOf(c) === chip;
}
function statusOf(c) {
  const phase = phaseOf(c);
  if (phase === 'expired') return { label: 'Expirado', tone: 'dark' };
  if (!c.active) return { label: 'Inativo', tone: '' };
  if (phase === 'scheduled') return { label: 'Agendado', tone: 'info' };
  if (soldOut(c)) return { label: 'Esgotado', tone: 'warning' };
  return { label: 'Vigente', tone: 'success' };
}

// Mesmo cálculo do banco (coupon_eval)
function discountFor(c, subtotal) {
  if (subtotal < (Number(c.min_order) || 0)) return { ok: false, discount: 0 };
  let d = 0;
  const value = Number(c.value) || 0;
  if (c.type === 'percent') d = Math.round(subtotal * value) / 100;
  else if (c.type === 'fixed') d = Math.min(value, subtotal);
  let capped = false;
  if (c.max_discount !== null && c.max_discount !== undefined && d > Number(c.max_discount)) {
    d = Number(c.max_discount);
    capped = true;
  }
  return { ok: true, discount: d, capped };
}

function randomCode(len = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const normalizeCode = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');

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

/* =========================================================
   PERÍODO — data (dd/mm/aaaa) + hora (hh:mm) no horário de Brasília, com calendário.
   scheduleField(opts) desenha; bindSchedule(root, opts) liga e devolve { read, validate, summary, refresh }.
   Campos: starts_at / starts_at_time / ends_at / ends_at_time (o texto da data fica em starts_at/ends_at,
   então showErrors(form, { starts_at: '…' }) marca o campo certo).
   ========================================================= */
const TZ = 'America/Sao_Paulo';
const SP_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DOW_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
// ISO → { ymd: 'AAAA-MM-DD', hm: 'HH:mm' } em Brasília
function spParts(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(SP_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
// datetime-local (AAAA-MM-DDTHH:mm) ↔ ISO, sempre no horário de Brasília (sem horário de verão desde 2019)
export function toLocalInput(iso) {
  if (!iso) return '';
  const p = spParts(iso);
  return p ? `${p.ymd}T${p.hm}` : '';
}
export function fromLocalInput(v) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return undefined;
  const d = new Date(`${v.slice(0, 16)}:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
const ymdToBr = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
function brToYmd(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || Number(m[3]) < 2000 || Number(m[3]) > 2100) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
const ymdDate = (s) => new Date(`${s}T12:00:00Z`);
const ymdOf = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => ymdOf(new Date(ymdDate(s).getTime() + n * DAY));
const addMonths = (s, n) => {
  const d = ymdDate(s);
  return ymdOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12)));
};
const monthEnd = (s) => {
  const d = ymdDate(s);
  return ymdOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
};
const todaySP = () => spParts(new Date()).ymd;
function maskDate(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
function maskTime(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}
function normTime(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (/^\d{1,2}$/.test(d)) return `${d.padStart(2, '0')}:00`;
  if (/^\d{3,4}$/.test(d)) {
    const p = d.padStart(4, '0');
    return `${p.slice(0, 2)}:${p.slice(2)}`;
  }
  return s;
}
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
// "hoje às 18:00" · "amanhã às 00:00" · "05/11 às 08:00" · "05/11/27 às 08:00"
export function whenText(iso) {
  const p = spParts(iso);
  if (!p) return '';
  const today = todaySP();
  const day =
    p.ymd === today ? 'hoje' : p.ymd === addDays(today, 1) ? 'amanhã' : p.ymd === addDays(today, -1) ? 'ontem' : p.ymd.slice(0, 4) === today.slice(0, 4) ? `em ${p.ymd.slice(8, 10)}/${p.ymd.slice(5, 7)}` : `em ${p.ymd.slice(8, 10)}/${p.ymd.slice(5, 7)}/${p.ymd.slice(2, 4)}`;
  return `${day} às ${p.hm}`;
}
const whenBare = (iso) => whenText(iso).replace(/^em /, '');
// "faltam 12 dias" · "termina amanhã" · "faltam 5 horas" (dias de calendário em Brasília)
function leftText(iso, verbTomorrow = 'termina amanhã') {
  const p = spParts(iso);
  const days = Math.round((ymdDate(p.ymd) - ymdDate(todaySP())) / DAY);
  if (days >= 2) return `faltam ${days} dias`;
  if (days === 1) return verbTomorrow;
  const h = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3600000));
  return h === 1 ? 'falta menos de 1 hora' : `faltam ${h} horas`;
}
function spanText(ms) {
  const h = Math.round(ms / 3600000);
  if (h < 48) return h <= 1 ? 'menos de 2 horas' : `${h} horas`;
  const d = Math.round(ms / DAY);
  return `${d} dias`;
}

const SCHED_COPY = {
  coupon: {
    none: 'Vale assim que você salvar, sem data para acabar.',
    sched: (s, e) => `Agendado: começa a valer ${whenText(s)}${e ? ` e termina ${whenText(e)} · ${spanText(Date.parse(e) - Date.parse(s))}` : ', sem data para acabar'}.`,
    ended: (e) => `Já terminou ${whenText(e)}. Escolha um novo fim para voltar a valer.`,
    live: (e) => (e ? `Valendo agora, até ${whenBare(e)} (${leftText(e)}).` : 'Valendo agora, sem data para acabar.'),
    off: 'Desligado: o cupom não é aceito até você ligar de novo.',
  },
  banner: {
    none: 'Entra no ar ao salvar e fica sem data para sair.',
    sched: (s, e) => `Agendado: entra no ar ${whenText(s)}${e ? ` e sai ${whenText(e)} · ${spanText(Date.parse(e) - Date.parse(s))}` : ', sem data para sair'}.`,
    ended: (e) => `Saiu do ar ${whenText(e)}. Escolha um novo fim para voltar ao ar.`,
    live: (e) => (e ? `No ar agora, até ${whenBare(e)} (${leftText(e, 'sai amanhã')}).` : 'No ar agora, sem data para sair.'),
    off: 'Desligado: não aparece na loja até você ligar de novo.',
  },
};

export function scheduleField({ id = 'sch', starts = null, ends = null, legend = 'Quando vale', startLabel = 'Começa', endLabel = 'Termina', startHint = 'Em branco: vale ao salvar.', endHint = 'Em branco: sem data para acabar.', cls = 'col-12' } = {}) {
  const part = (key, label, value, hint, chips) => {
    const p = value ? spParts(value) : null;
    return html`<div class="field sch__f" data-sch-part="${key}">
      <label for="${id}-${key}">${label}</label>
      <div class="sch__inputs">
        <div class="sch__date">
          <input class="input" id="${id}-${key}" name="${key}_at" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" autocomplete="off" value="${p ? ymdToBr(p.ymd) : ''}" data-sch-date="${key}" aria-describedby="${id}-${key}-hint">
          <button class="sch__x" type="button" data-sch-clear="${key}" aria-label="Limpar ${label.toLowerCase()}" ${p ? '' : 'hidden'}>${icon('close', 'icon-xs')}</button>
          <button class="sch__cal" type="button" data-sch-cal="${key}" aria-label="${label}: escolher no calendário" aria-haspopup="dialog" aria-expanded="false">${icon('calendar', 'icon-sm')}</button>
        </div>
        <input class="input sch__time" name="${key}_at_time" inputmode="numeric" placeholder="${key === 'starts' ? '00:00' : '23:59'}" maxlength="5" autocomplete="off" value="${p ? p.hm : ''}" data-sch-time="${key}" aria-label="${label}: horário (hh:mm)">
      </div>
      <div class="sch__chips" role="group" aria-label="Atalhos para ${label.toLowerCase()}">${chips.map(([k, l]) => html`<button class="sch__chip" type="button" data-sch-quick="${key}:${k}">${l}</button>`)}</div>
      <span class="hint" id="${id}-${key}-hint">${hint}</span>
    </div>`;
  };
  return html`<fieldset class="sch ${cls}" data-sch="${id}">
    <legend class="sch__legend">${icon('calendar', 'icon-sm')}${legend}<span class="sch__tz">Horário de Brasília</span></legend>
    <div class="sch__grid">
      ${part('starts', startLabel, starts, startHint, [['now', 'Agora'], ['tomorrow', 'Amanhã']])}
      <span class="sch__arrow" aria-hidden="true">${icon('arrowRight', 'icon-sm')}</span>
      ${part('ends', endLabel, ends, endHint, [['7d', '7 dias'], ['30d', '30 dias'], ['month', 'Fim do mês']])}
    </div>
    <p class="sch__sum" data-sch-sum aria-live="polite"></p>
  </fieldset>`;
}

let dayPicker = null;
function closeDayPicker(focus = false) {
  if (!dayPicker) return;
  const d = dayPicker;
  dayPicker = null;
  d.cleanup();
  if (focus) d.btn.focus({ preventScroll: true });
}
// Calendário de um dia (popover no <body>, acima de janelas; Esc fecha só ele)
function openDayPicker(btn, anchor, { value, onPick }) {
  closeDayPicker();
  const today = todaySP();
  let focusDay = value || today;
  let month = `${focusDay.slice(0, 7)}-01`;
  const pop = document.createElement('div');
  pop.className = 'pop pop--day';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Escolher data');
  const paint = (focus = true) => {
    const d0 = ymdDate(month);
    const y = d0.getUTCFullYear();
    const m = d0.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < start; i++) cells.push(html`<span class="cal__d is-out" aria-hidden="true"></span>`);
    for (let day = 1; day <= days; day++) {
      const s = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const on = s === value;
      const cls = ['cal__d', on ? 'is-from is-to is-single' : '', s === today ? 'is-today' : ''].filter(Boolean).join(' ');
      cells.push(
        html`<button type="button" class="${cls}" data-day="${s}" tabindex="${s === focusDay ? 0 : -1}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${DOW_LONG[ymdDate(s).getUTCDay()]}, ${day} de ${MONTHS[m]} de ${y}${s === today ? ', hoje' : ''}">${day}</button>`
      );
    }
    render(
      pop,
      html`<div class="dayp">
        <div class="dayp__head">
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-dp-prev aria-label="Mês anterior">${icon('chevronLeft', 'icon-sm')}</button>
          <span class="cal__mt" aria-live="polite">${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}</span>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-dp-next aria-label="Próximo mês">${icon('chevronRight', 'icon-sm')}</button>
        </div>
        <div class="cal__dow" aria-hidden="true">${DOW.map((x) => html`<span>${x}</span>`)}</div>
        <div class="cal__grid" role="group" aria-label="Dias">${cells}</div>
      </div>
      <div class="pop__foot"><button type="button" class="btn btn--ghost btn--sm" data-dp-today>Hoje</button>${
        value ? html`<button type="button" class="btn btn--ghost btn--sm" data-dp-clear>Limpar</button>` : ''
      }<span class="dayp__k">Setas mudam o dia · Enter escolhe</span></div>`
    );
    if (focus) $(`[data-day="${focusDay}"]`, pop)?.focus({ preventScroll: true });
  };
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const below = vh - r.bottom - 14;
    const top = below >= ph || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - ph);
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, vw - pw - 8)))}px`;
    pop.style.top = `${Math.round(Math.max(8, Math.min(top, vh - ph - 8)))}px`;
    pop.dataset.side = top >= r.bottom ? 'bottom' : 'top';
  };
  const go = (s) => {
    focusDay = s;
    if (s.slice(0, 7) !== month.slice(0, 7)) month = `${s.slice(0, 7)}-01`;
    paint();
  };
  const pick = (s) => {
    onPick(s);
    closeDayPicker(true);
  };
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.day) return pick(b.dataset.day);
    if (b.hasAttribute('data-dp-prev')) return go(addMonths(month, -1));
    if (b.hasAttribute('data-dp-next')) return go(addMonths(month, 1));
    if (b.hasAttribute('data-dp-today')) return pick(today);
    if (b.hasAttribute('data-dp-clear')) return pick(null);
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      closeDayPicker(false);
      btn.focus({ preventScroll: true });
      return;
    }
    const day = e.target.closest('[data-day]');
    if (!day) return;
    const s = day.dataset.day;
    const dow = ymdDate(s).getUTCDay();
    const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -dow, End: 6 - dow };
    if (e.key in map) {
      e.preventDefault();
      go(addDays(s, map[e.key]));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const t = addMonths(s, e.key === 'PageUp' ? -1 : 1);
      go(`${t.slice(0, 8)}${String(Math.min(Number(s.slice(8)), Number(monthEnd(t).slice(8)))).padStart(2, '0')}`);
    }
  });
  const onDown = (e) => {
    if (!pop.contains(e.target) && !btn.contains(e.target)) closeDayPicker(false);
  };
  const onScroll = () => place();
  document.body.append(pop);
  paint(false);
  place();
  paint();
  btn.setAttribute('aria-expanded', 'true');
  pushLayer(pop, { onEscape: () => closeDayPicker(true) });
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onScroll);
  window.addEventListener('scroll', onScroll, true);
  dayPicker = {
    btn,
    cleanup: () => {
      popLayer(pop);
      pop.remove();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    },
  };
}

// Liga o campo "Período". mode: 'coupon' | 'banner'. isActive() opcional (switch "Ativo" do formulário).
export function bindSchedule(root, { mode = 'coupon', isActive = null, onChange = null } = {}) {
  const box = $('[data-sch]', root);
  if (!box) return null;
  const form = box.closest('form') || root;
  const el = (key, kind) => $(`[data-sch-${kind}="${key}"]`, box);
  const emit = () => {
    refresh();
    onChange?.();
    // avisa o formulário (prévia, barra de salvar…)
    form.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const setPart = (key, ymd, hm) => {
    el(key, 'date').value = ymd ? ymdToBr(ymd) : '';
    el(key, 'time').value = ymd ? hm : '';
    [el(key, 'date'), el(key, 'time')].forEach((n) => {
      n.removeAttribute('aria-invalid');
      $$(`.error[data-for="${n.name}"]`, box).forEach((x) => x.remove());
    });
    emit();
  };
  const readPart = (key) => {
    const dRaw = el(key, 'date').value.trim();
    const tRaw = normTime(el(key, 'time').value);
    if (!dRaw && !tRaw) return { iso: null };
    if (!dRaw) return { iso: undefined, err: [`${key}_at`, 'Escolha a data.'] };
    const ymd = brToYmd(dRaw);
    if (!ymd) return { iso: undefined, err: [`${key}_at`, 'Data inválida. Use dd/mm/aaaa.'] };
    const hm = tRaw || (key === 'starts' ? '00:00' : '23:59');
    if (!validTime(hm)) return { iso: undefined, err: [`${key}_at_time`, 'Horário inválido. Use hh:mm, de 00:00 a 23:59.'] };
    return { iso: new Date(`${ymd}T${hm}:00-03:00`).toISOString() };
  };
  const read = () => {
    const s = readPart('starts');
    const e = readPart('ends');
    const errors = {};
    if (s.err) errors[s.err[0]] = s.err[1];
    if (e.err) errors[e.err[0]] = e.err[1];
    if (s.iso && e.iso && Date.parse(e.iso) <= Date.parse(s.iso)) errors.ends_at = 'O fim precisa ser depois do início.';
    return { starts_at: s.iso ?? null, ends_at: e.iso ?? null, errors, ok: !Object.keys(errors).length };
  };
  const summary = () => {
    const r = read();
    const C = SCHED_COPY[mode];
    if (!r.ok) return { tone: 'bad', text: Object.values(r.errors)[0] };
    const now = Date.now();
    let out;
    if (r.ends_at && Date.parse(r.ends_at) < now) out = { tone: 'warn', text: C.ended(r.ends_at) };
    else if (r.starts_at && Date.parse(r.starts_at) > now) out = { tone: 'info', text: C.sched(r.starts_at, r.ends_at) };
    else if (!r.starts_at && !r.ends_at) out = { tone: 'ok', text: C.none };
    else out = { tone: 'ok', text: C.live(r.ends_at) };
    if (isActive && !isActive()) out = { tone: 'neu', text: C.off };
    return out;
  };
  const refresh = () => {
    const s = summary();
    const sum = $('[data-sch-sum]', box);
    sum.className = `sch__sum t-${s.tone}`;
    render(sum, html`<span class="dot" aria-hidden="true"></span><span>${s.text}</span>`);
    ['starts', 'ends'].forEach((k) => (el(k, 'clear').hidden = !el(k, 'date').value));
  };
  box.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-sch-date]')) {
      const m = maskDate(t.value);
      if (m !== t.value) t.value = m;
    } else if (t.matches('[data-sch-time]')) {
      const m = maskTime(t.value);
      if (m !== t.value) t.value = m;
    }
    refresh();
  });
  box.addEventListener(
    'blur',
    (e) => {
      const t = e.target;
      if (t.matches?.('[data-sch-time]') && t.value) {
        t.value = normTime(t.value);
        refresh();
      }
    },
    true
  );
  box.addEventListener('click', (e) => {
    const cal = e.target.closest('[data-sch-cal]');
    if (cal) {
      const key = cal.dataset.schCal;
      if (dayPicker?.btn === cal) return closeDayPicker(true);
      const cur = brToYmd(el(key, 'date').value);
      openDayPicker(cal, cal.closest('.sch__inputs'), {
        value: cur,
        onPick: (ymd) => {
          if (!ymd) return setPart(key, null);
          const t = normTime(el(key, 'time').value);
          setPart(key, ymd, validTime(t) ? t : key === 'starts' ? '00:00' : '23:59');
        },
      });
      return;
    }
    const clr = e.target.closest('[data-sch-clear]');
    if (clr) {
      setPart(clr.dataset.schClear, null);
      el(clr.dataset.schClear, 'date').focus();
      return;
    }
    const qk = e.target.closest('[data-sch-quick]');
    if (qk) {
      const [key, k] = qk.dataset.schQuick.split(':');
      const now = spParts(new Date());
      const base = brToYmd(el('starts', 'date').value);
      const from = base && base > now.ymd ? base : now.ymd;
      if (k === 'now') setPart(key, now.ymd, now.hm);
      else if (k === 'tomorrow') setPart(key, addDays(now.ymd, 1), '00:00');
      else if (k === '7d') setPart(key, addDays(from, 7), '23:59');
      else if (k === '30d') setPart(key, addDays(from, 30), '23:59');
      else if (k === 'month') setPart(key, monthEnd(from), '23:59');
    }
  });
  refresh();
  return {
    read,
    summary,
    refresh,
    // junta os erros do período em `errors` e devolve { starts_at, ends_at }
    validate(errors) {
      const r = read();
      Object.assign(errors, r.errors);
      return { starts_at: r.starts_at, ends_at: r.ends_at };
    },
  };
}

/* ---------- Células e textos ---------- */
const scopeName = (ctx, c) => (c.store_id ? ctx.storeShort?.(c.store_id) || ctx.storeName(c.store_id) : 'Toda a rede');
const netMark = (size = 24) =>
  html`<span class="smark smark--net" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${icon('houses', 'icon-xs')}</span>`;

function discountMain(c) {
  if (c.type === 'free_shipping') return 'Frete grátis';
  return c.type === 'percent' ? `${fmtNum(c.value)}%` : money(c.value);
}
function discountSub(c) {
  const bits = [];
  if (c.type === 'percent' && c.max_discount !== null && c.max_discount !== undefined) bits.push(`até ${money(c.max_discount)}`);
  if (Number(c.min_order) > 0) bits.push(`mín. ${money(c.min_order)}`);
  if (!bits.length) bits.push(c.type === 'free_shipping' ? 'Zera o frete' : c.type === 'percent' ? 'Sobre os produtos' : 'Desconto fixo');
  return bits.join(' · ');
}
// Data curta: "30/10 08:00" (ano só se for outro); omite 00:00 no início e 23:59 no fim
function shortWhen(iso, edge) {
  const p = spParts(iso);
  if (!p) return '';
  const [y, m, d] = p.ymd.split('-');
  const dm = y === todaySP().slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
  if ((edge === 'start' && p.hm === '00:00') || (edge === 'end' && p.hm === '23:59')) return dm;
  return `${dm} ${p.hm}`;
}
function validityText(c) {
  if (c.starts_at && c.ends_at) return `${shortWhen(c.starts_at, 'start')} – ${shortWhen(c.ends_at, 'end')}`;
  if (c.starts_at) return `A partir de ${shortWhen(c.starts_at, 'start')}`;
  if (c.ends_at) return `Até ${shortWhen(c.ends_at, 'end')}`;
  return 'Sem prazo';
}
function validityTitle(c) {
  if (!c.starts_at && !c.ends_at) return 'Sem data de início ou fim';
  return [c.starts_at && `Início: ${datetime(c.starts_at)}`, c.ends_at && `Fim: ${datetime(c.ends_at)}`].filter(Boolean).join(' · ');
}
// "termina em 3 dias" / "começa amanhã" quando falta pouco
function soonText(c, now = Date.now()) {
  const phase = phaseOf(c, now);
  if (!c.active) return '';
  if (phase === 'live' && c.ends_at) {
    const ms = Date.parse(c.ends_at) - now;
    if (ms < 7 * DAY) return ms < DAY ? 'termina hoje' : `termina em ${Math.ceil(ms / DAY)} ${Math.ceil(ms / DAY) === 1 ? 'dia' : 'dias'}`;
  }
  if (phase === 'scheduled') {
    const ms = Date.parse(c.starts_at) - now;
    if (ms < 7 * DAY) return ms < DAY ? 'começa em breve' : `começa em ${Math.ceil(ms / DAY)} ${Math.ceil(ms / DAY) === 1 ? 'dia' : 'dias'}`;
  }
  return '';
}

function usesBlock(c, stat, { compact = false } = {}) {
  const limit = c.usage_limit === null || c.usage_limit === undefined ? null : Number(c.usage_limit);
  const used = Number(c.used_count) || 0;
  const share = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return html`<div class="cp-uses">
    <span class="cp-uses__n"><b>${num(used)}</b><span class="muted"> / ${limit === null ? '∞' : num(limit)}</span>${limit !== null && soldOut(c) ? html` <span class="cp-uses__full">esgotado</span>` : ''}</span>
    ${limit !== null ? html`<span class="meter meter--solid cp-meter ${share >= 100 ? 'is-full' : share >= 80 ? 'is-high' : ''}" aria-hidden="true"><span style="width:${share}%"></span></span>` : ''}
    ${compact
      ? ''
      : html`<span class="sub">${stat?.discount ? html`${money(stat.discount)} em desconto` : c.per_phone_limit !== null && c.per_phone_limit !== undefined ? `${num(c.per_phone_limit)} por cliente` : used ? '' : 'Ainda não usado'}</span>`}
  </div>`;
}

/* =========================================================
   FORMULÁRIO (criar / editar / duplicar) com prévia do cupom
   ========================================================= */
function valueGroup(type, value) {
  return type === 'percent'
    ? html`<input class="input" id="cp-value" name="value" inputmode="decimal" autocomplete="off" value="${value}" placeholder="Ex.: 10"><span class="input-group__addon">%</span>`
    : html`<span class="input-group__addon">R$</span><input class="input" id="cp-value" name="value" inputmode="decimal" autocomplete="off" value="${value}" placeholder="Ex.: 50,00">`;
}

function openCouponForm(ctx, { coupon = null, copyOf = null, rows = [], stats = null, defaultStore = null, onSaved }) {
  const editing = !!coupon;
  const src = coupon || copyOf;
  const taken = new Set(rows.map((r) => r.code));
  const copyCode = (code) => {
    let n = 2;
    let next = `${code}${n}`.slice(0, 30);
    while (taken.has(next)) next = `${code}${++n}`.slice(0, 30);
    return next;
  };
  const c = src
    ? { ...src, code: copyOf ? copyCode(copyOf.code) : src.code, used_count: copyOf ? 0 : src.used_count }
    : {
        store_id: defaultStore,
        code: '',
        description: '',
        type: 'percent',
        value: '',
        min_order: 0,
        max_discount: null,
        usage_limit: null,
        per_phone_limit: null,
        starts_at: null,
        ends_at: null,
        active: true,
        used_count: 0,
      };
  // Equipe da loja só cria/edita cupons da própria loja
  const fixedStore = ctx.isGlobal ? null : coupon ? coupon.store_id : ctx.storeId;
  if (!ctx.isGlobal && copyOf) c.store_id = ctx.storeId;
  const stat = editing ? stats?.get(coupon.id) : null;

  const scopeField = ctx.isGlobal
    ? html`<div class="field col-12">
        <label for="cp-store">Onde vale *</label>
        <select class="select" id="cp-store" name="store_id" data-sheet-title="Onde o cupom vale" data-search-placeholder="Buscar loja ou cidade…">
          <option value="" data-mark="network" data-hint="Vale em todas as lojas da rede" ${!c.store_id ? 'selected' : ''}>Toda a rede</option>
          <optgroup label="Lojas" data-count="${ctx.stores.length}">${ctx.stores.map(
            (s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name || 'Atual Móveis'} · ${s.city || ''}" data-keywords="${s.name}" ${c.store_id === s.id ? 'selected' : ''}>${ctx.storeShort?.(s) || s.name}</option>`
          )}</optgroup>
        </select>
        <span class="hint">Um cupom da loja tem prioridade sobre um cupom da rede com o mesmo código.</span>
      </div>`
    : html`<div class="field col-12"><span class="label">Onde vale</span>
        <div class="cp-fixed">${storeMark(ctx.stores.find((s) => s.id === (fixedStore || c.store_id)) || {}, 24)}<span>${ctx.storeShort?.(fixedStore || c.store_id) || ctx.storeName(fixedStore || c.store_id)}</span>${icon('lock', 'icon-xs')}</div>
        <span class="hint">Cupons da sua equipe valem só nesta loja.</span></div>`;

  const body = html`<div class="cp-ed">
    <form class="cp-ed__form" id="cp-form" novalidate>
      <fieldset class="cp-sec">
        <legend class="cp-sec__t">Cupom</legend><div class="form-grid">
        ${scopeField}
        <div class="field col-6">
          <label for="cp-code">Código *</label>
          <div class="input-group">
            <input class="input mono cp-code-input" id="cp-code" name="code" value="${c.code}" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ex.: NATAL10" required ${editing ? '' : 'autofocus'}>
            <button class="btn cp-gen" type="button" data-gen title="Cria um código aleatório que ainda não existe">${icon('sparkle', 'icon-sm')} Gerar</button>
          </div>
          <span class="hint">3 a 30 caracteres: letras sem acento, números, - ou _.</span>
        </div>
        <div class="field col-6">
          <label for="cp-type">Tipo de desconto *</label>
          <select class="select" id="cp-type" name="type" data-sheet-title="Tipo de desconto">${Object.entries(TYPES).map(
            ([k, l]) => html`<option value="${k}" data-icon="${TYPE_ICON[k]}" data-hint="${TYPE_HINT[k]}" ${c.type === k ? 'selected' : ''}>${l}</option>`
          )}</select>
        </div>
        <div class="field col-12">
          <label for="cp-desc">Descrição <span class="opt-tag" data-desc-count></span></label>
          <input class="input" id="cp-desc" name="description" value="${c.description || ''}" maxlength="140" placeholder="Ex.: 10% em toda a loja na semana do cliente">
          <span class="hint">Aparece para o cliente quando ele aplica o cupom.</span>
        </div>
      </div></fieldset>
      <fieldset class="cp-sec">
        <legend class="cp-sec__t">Desconto</legend><div class="form-grid">
        <div class="field col-4" data-value-field ${c.type === 'free_shipping' ? 'hidden' : ''}>
          <label for="cp-value">Valor *</label>
          <div class="input-group" data-value-group>${valueGroup(c.type, inputNum(c.value))}</div>
        </div>
        <div class="field col-4">
          <label for="cp-min">Pedido mínimo</label>
          <div class="input-group"><span class="input-group__addon">R$</span>
            <input class="input" id="cp-min" name="min_order" inputmode="decimal" autocomplete="off" value="${Number(c.min_order) ? inputNum(c.min_order) : ''}" placeholder="0,00"></div>
          <span class="hint">Sobre o valor dos produtos.</span>
        </div>
        <div class="field col-4" data-max-field ${c.type === 'percent' ? '' : 'hidden'}>
          <label for="cp-max">Desconto máximo</label>
          <div class="input-group"><span class="input-group__addon">R$</span>
            <input class="input" id="cp-max" name="max_discount" inputmode="decimal" autocomplete="off" value="${inputNum(c.max_discount)}" placeholder="Sem limite"></div>
        </div>
      </div></fieldset>
      <fieldset class="cp-sec">
        <legend class="cp-sec__t">Limites de uso</legend><div class="form-grid">
        <div class="field col-6">
          <label for="cp-limit">Limite total de usos</label>
          <input class="input" id="cp-limit" name="usage_limit" type="number" min="1" step="1" inputmode="numeric" value="${c.usage_limit ?? ''}" placeholder="Ilimitado">
          <span class="hint">${editing && c.used_count ? `Já usado ${num(c.used_count)} ${c.used_count === 1 ? 'vez' : 'vezes'}. ` : ''}Em branco = ilimitado.</span>
        </div>
        <div class="field col-6">
          <label for="cp-phone-limit">Limite por cliente</label>
          <input class="input" id="cp-phone-limit" name="per_phone_limit" type="number" min="1" step="1" inputmode="numeric" value="${c.per_phone_limit ?? ''}" placeholder="Ilimitado">
          <span class="hint">Usos por telefone (pedidos cancelados não contam).</span>
        </div>
      </div></fieldset>
      <div class="cp-sec form-grid">
        ${scheduleField({ id: 'cp-sch', starts: c.starts_at, ends: c.ends_at, legend: 'Quando vale' })}
        <div class="col-12 cp-active">
          <label class="switch">
            <input type="checkbox" name="active" ${c.active ? 'checked' : ''}>
            <span class="switch__track"></span>
            <span class="switch__txt"><strong>Cupom ativo</strong><br><span class="muted small">Desligado, o cupom não é aceito na loja virtual.</span></span>
          </label>
        </div>
      </div>
    </form>
    <aside class="cp-ed__side" aria-label="Prévia do cupom">
      <p class="cp-ed__ov">Prévia</p>
      <div class="cp-ticket" data-ticket></div>
      <div class="cp-example" data-example aria-live="polite"></div>
      ${editing
        ? html`<div class="cp-stat">
            <p class="cp-ed__ov">Uso deste cupom</p>
            <dl class="cp-stat__grid">
              <div><dt>Usos</dt><dd>${num(coupon.used_count)}${coupon.usage_limit ? html`<small> de ${num(coupon.usage_limit)}</small>` : ''}</dd></div>
              <div><dt>Desconto dado</dt><dd>${money(stat?.discount || 0)}</dd></div>
              <div><dt>Vendas com ele</dt><dd>${money(stat?.sales || 0)}</dd></div>
              <div><dt>Último uso</dt><dd>${stat?.last ? relTime(stat.last) : '—'}</dd></div>
            </dl>
          </div>`
        : ''}
    </aside>
  </div>`;

  openModal({
    title: editing ? `Editar cupom ${c.code}` : copyOf ? `Duplicar cupom ${copyOf.code}` : 'Novo cupom',
    size: 'lg',
    cls: 'cp-modal',
    body,
    actions: html`${editing ? html`<button class="btn btn--ghost cp-foot-test" type="button" data-test-this>${icon('check', 'icon-sm')} Testar</button>` : ''}
      <button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="submit" form="cp-form" data-save>${editing ? 'Salvar alterações' : 'Criar cupom'}</button>`,
    onMount(el, close) {
      const form = $('#cp-form', el);
      const get = (name) => form.elements.namedItem(name);
      const sched = bindSchedule(form, { mode: 'coupon', isActive: () => get('active').checked });

      const read = () => {
        const type = get('type').value;
        return {
          store_id: ctx.isGlobal ? get('store_id').value || null : fixedStore || c.store_id,
          code: normalizeCode(get('code').value),
          description: get('description').value.trim() || null,
          type,
          value: type === 'free_shipping' ? 0 : parseNum(get('value')?.value),
          min_order: parseNum(get('min_order').value),
          max_discount: type === 'percent' ? parseNum(get('max_discount').value) : null,
          usage_limit: parseIntOrNull(get('usage_limit').value),
          per_phone_limit: parseIntOrNull(get('per_phone_limit').value),
          active: get('active').checked,
        };
      };

      const drawPreview = () => {
        const v = read();
        const s = sched.read();
        const scopeStore = ctx.stores.find((x) => x.id === v.store_id) || null;
        const valueOk = v.type === 'free_shipping' || (v.value > 0 && !(v.type === 'percent' && v.value > 100));
        const big = v.type === 'free_shipping' ? 'Frete grátis' : !valueOk ? '—' : v.type === 'percent' ? `${fmtNum(v.value)}% OFF` : `${money(v.value)} OFF`;
        const rules = [];
        if (Number.isFinite(v.min_order) && v.min_order > 0) rules.push(`Pedido mínimo de ${money(v.min_order)}`);
        if (v.type === 'percent' && Number.isFinite(v.max_discount) && v.max_discount > 0) rules.push(`Até ${money(v.max_discount)} de desconto`);
        if (Number.isInteger(v.per_phone_limit) && v.per_phone_limit > 0) rules.push(`${plural(v.per_phone_limit, 'uso', 'usos')} por cliente`);
        if (Number.isInteger(v.usage_limit) && v.usage_limit > 0) rules.push(`Limitado a ${plural(v.usage_limit, 'uso', 'usos')}`);
        if (s.ok && s.starts_at && Date.parse(s.starts_at) > Date.now()) rules.push(`Começa ${whenText(s.starts_at)}`);
        if (s.ok && s.ends_at) rules.push(`Vale até ${shortWhen(s.ends_at, 'end')}${spParts(s.ends_at).hm !== '23:59' ? '' : ' às 23:59'}`);
        if (!rules.length) rules.push('Sem pedido mínimo nem prazo');
        render(
          $('[data-ticket]', el),
          html`<div class="cp-ticket__top">
              <span class="cp-ticket__where">${v.store_id ? storeMark(scopeStore || {}, 20) : netMark(20)}${v.store_id ? (scopeStore ? ctx.storeShort?.(scopeStore) || scopeStore.name : 'Loja') : 'Todas as lojas da rede'}</span>
              <strong class="cp-ticket__big ${v.type === 'free_shipping' ? 'is-ship' : ''}">${v.type === 'free_shipping' ? html`${icon('truck')}${big}` : big}</strong>
              <span class="cp-ticket__desc">${v.description || 'Sem descrição para o cliente'}</span>
            </div>
            <div class="cp-ticket__cut" aria-hidden="true"></div>
            <div class="cp-ticket__bottom">
              <span class="cp-ticket__code">${v.code || 'CÓDIGO'}</span>
              <ul class="cp-ticket__rules">${rules.map((r) => html`<li>${icon('check', 'icon-xs')}${r}</li>`)}</ul>
              ${!v.active ? html`<span class="badge">Desligado</span>` : ''}
            </div>`
        );
        // exemplo com o mesmo cálculo do banco
        const min = Number.isFinite(v.min_order) ? v.min_order || 0 : 0;
        const base = Math.max(EXAMPLE_SUBTOTAL, min);
        let ex;
        if (v.type === 'free_shipping') {
          ex = html`<div class="cp-ex__row"><span>Produtos</span><b>${money(base)}</b></div><div class="cp-ex__row is-off"><span>Frete</span><b>grátis</b></div>`;
        } else if (!valueOk) {
          ex = html`<p class="muted small">Informe o valor do desconto para ver um exemplo.</p>`;
        } else {
          const d = discountFor({ ...v, min_order: min }, base);
          const pix = Number(scopeStore?.pix_discount_pct) || 0;
          // igual ao place_order: desconto PIX = round((subtotal − cupom) × pct/100, 2)
          const pixOff = Math.round((base - d.discount) * pix) / 100;
          const total = Math.round((base - d.discount - pixOff) * 100) / 100;
          ex = html`<div class="cp-ex__row"><span>Produtos</span><b>${money(base)}</b></div>
            <div class="cp-ex__row is-off"><span>Cupom${d.capped ? ' (no máximo)' : ''}</span><b>−${money(d.discount)}</b></div>
            ${pix > 0 ? html`<div class="cp-ex__row is-off"><span>PIX −${pct(pix, Number.isInteger(pix) ? 0 : 1)} (depois do cupom)</span><b>−${money(pixOff)}</b></div>` : ''}
            <div class="cp-ex__row is-total"><span>Cliente paga</span><b>${money(pix > 0 ? total : base - d.discount)} <small>+ frete</small></b></div>`;
        }
        render(
          $('[data-example]', el),
          html`<p class="cp-ed__ov">Exemplo${base > EXAMPLE_SUBTOTAL ? ' no pedido mínimo' : ''}</p>${ex}`
        );
        const dc = $('[data-desc-count]', el);
        if (dc) dc.textContent = `${get('description').value.length} / 140`;
      };

      const onType = () => {
        const type = get('type').value;
        const valueField = $('[data-value-field]', el);
        const current = get('value')?.value ?? '';
        valueField.hidden = type === 'free_shipping';
        if (type !== 'free_shipping') render($('[data-value-group]', el), valueGroup(type, current));
        $('[data-max-field]', el).hidden = type !== 'percent';
        drawPreview();
      };

      get('type').addEventListener('change', onType);
      get('code').addEventListener('input', (e) => {
        const input = e.target;
        const pos = input.selectionStart;
        const next = normalizeCode(input.value);
        if (next !== input.value) {
          const removed = input.value.length - next.length;
          input.value = next;
          try {
            input.setSelectionRange(Math.max(0, pos - removed), Math.max(0, pos - removed));
          } catch {
            /* campo sem seleção */
          }
        }
      });
      $('[data-gen]', el).addEventListener('click', () => {
        let code = randomCode();
        while (taken.has(code)) code = randomCode();
        get('code').value = code;
        get('code').removeAttribute('aria-invalid');
        $$('.error[data-for="code"]', form).forEach((n) => n.remove());
        get('code').focus();
        drawPreview();
      });
      $('[data-test-this]', el)?.addEventListener('click', () => openTester(ctx, { code: coupon.code, storeId: coupon.store_id || ctx.storeId || null }));
      // tira a marca de erro de um campo assim que ele é editado
      const clear = (e) => {
        const n = e.target.name;
        if (!n || e.target.closest('[data-sch]')) return;
        e.target.removeAttribute('aria-invalid');
        $$(`.error[data-for="${n}"]`, form).forEach((x) => x.remove());
      };
      form.addEventListener('input', (e) => {
        clear(e);
        drawPreview();
        if (e.target.name === 'active') sched.refresh();
      });
      form.addEventListener('change', (e) => {
        clear(e);
        drawPreview();
        if (e.target.name === 'active') sched.refresh();
      });
      drawPreview();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = read();
        const errors = {};
        if (!v.code) errors.code = 'Informe o código.';
        else if (!CODE_RE.test(v.code)) errors.code = v.code.length < 3 ? 'Código muito curto: use de 3 a 30 caracteres.' : 'Código inválido: use letras sem acento, números, - ou _.';
        else {
          const dup = rows.find((r) => r.code === v.code && (r.store_id || null) === (v.store_id || null) && r.id !== coupon?.id);
          if (dup) errors.code = v.store_id ? 'Já existe um cupom com este código nesta loja.' : 'Já existe um cupom da rede com este código.';
        }
        if (!TYPES[v.type]) errors.type = 'Escolha o tipo.';
        if (v.type !== 'free_shipping') {
          if (v.value === null) errors.value = 'Informe o valor.';
          else if (!(v.value > 0)) errors.value = 'Valor inválido.';
          else if (v.type === 'percent' && v.value > 100) errors.value = 'No máximo 100%.';
          else if (v.value > 9999999) errors.value = 'Valor muito alto.';
        }
        if (Number.isNaN(v.min_order) || (v.min_order !== null && v.min_order < 0)) errors.min_order = 'Valor inválido.';
        if (v.type === 'percent' && v.max_discount !== null && (Number.isNaN(v.max_discount) || v.max_discount <= 0)) errors.max_discount = 'Valor inválido.';
        if (Number.isNaN(v.usage_limit) || (v.usage_limit !== null && v.usage_limit < 1)) errors.usage_limit = 'Use um número inteiro a partir de 1.';
        else if (editing && v.usage_limit !== null && v.usage_limit < (coupon.used_count || 0)) errors.usage_limit = `O cupom já foi usado ${num(coupon.used_count)} vezes.`;
        if (Number.isNaN(v.per_phone_limit) || (v.per_phone_limit !== null && v.per_phone_limit < 1)) errors.per_phone_limit = 'Use um número inteiro a partir de 1.';
        const { starts_at: starts, ends_at: ends } = sched.validate(errors);
        if (!errors.ends_at && ends && !editing && new Date(ends).getTime() < Date.now()) errors.ends_at = 'Esta data já passou.';
        if (!showErrors(form, errors)) return;

        const payload = {
          store_id: v.store_id,
          code: v.code,
          description: v.description,
          type: v.type,
          value: v.type === 'free_shipping' ? 0 : v.value,
          min_order: v.min_order || 0,
          max_discount: v.type === 'percent' ? v.max_discount : null,
          usage_limit: v.usage_limit,
          per_phone_limit: v.per_phone_limit,
          starts_at: starts,
          ends_at: ends,
          active: v.active,
        };
        try {
          const saved = await withBusy($('[data-save]', el), async () => {
            const qy = editing ? sb.from('coupons').update(payload).eq('id', coupon.id).select() : sb.from('coupons').insert(payload).select();
            const data = await q(qy);
            if (!data?.length) throw new Error('Você não tem permissão para salvar este cupom.');
            return data[0];
          });
          toast(editing ? `Cupom ${saved.code} salvo` : `Cupom ${saved.code} criado`, 'success');
          close();
          onSaved?.(saved);
        } catch (err) {
          if (/código/.test(err.message)) showErrors(form, { code: err.message });
          toastError(err);
        }
      });
    },
  });
}

/* =========================================================
   TESTE (validate_coupon — o mesmo que a loja virtual usa)
   ========================================================= */
function openTester(ctx, { code = '', storeId = null } = {}) {
  const fixed = ctx.storeId;
  const sel = storeId || fixed || '';
  openModal({
    title: 'Testar cupom',
    cls: 'cp-test-modal',
    body: html`<form class="form-grid" id="cp-test" novalidate>
      <p class="col-12 muted cp-test__lede">Confere o cupom com as mesmas regras da loja virtual, sem criar pedido.</p>
      ${fixed
        ? html`<div class="field col-12"><span class="label">Loja</span><div class="cp-fixed">${storeMark(ctx.store || {}, 24)}<span>${ctx.storeShort?.(fixed) || ctx.storeName(fixed)}</span></div></div>`
        : html`<div class="field col-12"><label for="cpt-store">Loja *</label>
            <select class="select" id="cpt-store" name="store" data-placeholder="Escolha a loja" data-sheet-title="Loja do teste" data-search-placeholder="Buscar loja ou cidade…">
              <option value="">Escolha a loja</option>
              ${ctx.stores.map((s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name || ''} · ${s.city || ''}" data-keywords="${s.name}" ${sel === s.id ? 'selected' : ''}>${ctx.storeShort?.(s) || s.name}</option>`)}
            </select></div>`}
      <div class="field col-6"><label for="cpt-code">Código *</label>
        <input class="input mono cp-code-input" id="cpt-code" name="code" value="${code}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NATAL10" ${code ? '' : 'autofocus'}></div>
      <div class="field col-6"><label for="cpt-sub">Valor dos produtos *</label>
        <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="cpt-sub" name="subtotal" inputmode="decimal" value="1000" ${code ? 'autofocus' : ''}></div></div>
      <div class="field col-12"><label for="cpt-phone">Telefone do cliente <span class="opt-tag">opcional</span></label>
        <input class="input" id="cpt-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="(31) 99999-0000">
        <span class="hint">Com o telefone, o teste também confere o limite por cliente.</span></div>
      <div class="col-12" data-test-result aria-live="polite"></div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Fechar</button>
      <button class="btn btn--primary" type="submit" form="cp-test" data-run>Testar cupom</button>`,
    onMount(el) {
      const form = $('#cp-test', el);
      const get = (n) => form.elements.namedItem(n);
      get('code').addEventListener('input', (e) => {
        e.target.value = normalizeCode(e.target.value);
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const store = fixed || get('store').value;
        const codeV = normalizeCode(get('code').value);
        const subtotal = parseNum(get('subtotal').value);
        const phoneV = get('phone').value.replace(/\D/g, '') || null;
        const errors = {};
        if (!fixed && !store) errors.store = 'Escolha a loja.';
        if (!codeV) errors.code = 'Informe o código.';
        if (subtotal === null || !(subtotal >= 0)) errors.subtotal = 'Valor inválido.';
        if (phoneV && (phoneV.length < 10 || phoneV.length > 13)) errors.phone = 'Telefone inválido.';
        if (!showErrors(form, errors)) return;
        const out = $('[data-test-result]', el);
        try {
          const res = await withBusy($('[data-run]', el), () => rpc('validate_coupon', { p_store: store, p_code: codeV, p_subtotal: subtotal, p_phone: phoneV }), 'Testando…');
          if (res?.valid) {
            const disc = Number(res.discount) || 0;
            render(
              out,
              html`<div class="cp-result is-ok" role="status">
                <div class="cp-result__head">${icon('checkCircle')}<div><strong>Cupom aceito</strong><span>${res.type === 'free_shipping' ? 'Frete grátis na entrega' : `Desconto de ${money(disc)}`}${res.description ? ` · ${res.description}` : ''}</span></div></div>
                <div class="cp-ex__row"><span>Produtos</span><b>${money(subtotal)}</b></div>
                ${res.type === 'free_shipping' ? html`<div class="cp-ex__row is-off"><span>Frete</span><b>grátis</b></div>` : html`<div class="cp-ex__row is-off"><span>Cupom ${codeV}</span><b>−${money(disc)}</b></div>`}
                <div class="cp-ex__row is-total"><span>Antes do frete e do PIX</span><b>${money(Math.max(0, subtotal - disc))}</b></div>
              </div>`
            );
          } else {
            render(
              out,
              html`<div class="cp-result is-bad" role="status">
                <div class="cp-result__head">${icon('xCircle')}<div><strong>Cupom recusado</strong><span>${res?.message || 'Cupom inválido.'}${
                  /não encontrado/i.test(res?.message || '') ? ' Cupons inativos também aparecem assim.' : ''
                }</span></div></div>
              </div>`
            );
          }
        } catch (err) {
          render(out, errorBlock(err));
        }
      });
    },
  });
}

/* =========================================================
   EXCLUSÃO
   ========================================================= */
// Cupom já usado: sugere desativar. Resolve 'deactivate' | 'delete' | null.
function askDeleteUsed(c) {
  return new Promise((resolve) => {
    let choice = null;
    openModal({
      title: `Excluir o cupom ${c.code}?`,
      size: 'sm',
      role: 'alertdialog',
      icon: 'alert',
      tone: 'warn',
      cls: 'modal--confirm cp-dialog',
      body: html`<p class="modal__text">O cupom já foi usado em ${plural(c.used_count, 'pedido', 'pedidos')}. Recomendamos <strong>desativar</strong>: ele deixa de ser aceito e o histórico continua completo. Ao excluir, os pedidos mantêm só o código.</p>`,
      actions: html`<button class="btn" type="button" data-close data-initial-focus>Voltar</button>
        <button class="btn btn--danger" type="button" data-choice="delete">Excluir mesmo assim</button>
        ${c.active ? html`<button class="btn btn--dark" type="button" data-choice="deactivate">Desativar cupom</button>` : ''}`,
      onMount: (el, close) => {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-choice]');
          if (!b) return;
          choice = b.dataset.choice;
          close();
        });
      },
      onClose: () => resolve(choice),
    });
  });
}

/* =========================================================
   LISTA
   ========================================================= */
export default {
  title: 'Cupons',
  async render(view, ctx) {
    injectStyle('coupons', CSS);
    injectSchedule();
    const network = !ctx.storeId;
    const st = { rows: [], chip: TABS.some(([k]) => k && k === ctx.query?.status) ? ctx.query.status : '', search: ctx.query?.q || '', scope: '', type: '', page: 1, loaded: false };
    let stats = new Map(); // coupon_id → { uses, discount, sales, last }
    let statRows = null; // pedidos com cupom (para o resumo)
    const canEdit = (c) => (c.store_id ? ctx.can('coupons', c.store_id) : ctx.isGlobal);
    const canCreate = ctx.isGlobal || ctx.can('coupons');
    const byId = (id) => st.rows.find((r) => r.id === id);
    const where = network ? 'Toda a rede' : ctx.storeShort?.(ctx.store) || ctx.store?.name || '';

    ctx.setActions(
      html`<button class="btn" type="button" data-test title="Confere um código com as regras da loja virtual">${icon('check')}<span>Testar cupom</span></button>
        ${canCreate ? html`<button class="btn btn--primary" type="button" data-cp-new aria-label="Novo cupom">${icon('plus')}<span>Novo cupom</span></button>` : ''}`
    );

    render(
      view,
      html`<div class="cp">
        <section class="kpis cp-kpis" data-kpis aria-label="Resumo dos cupons nos últimos 30 dias">${skeleton('kpis')}</section>
        <div data-tip></div>
        <section class="card cp-card">
          <div class="tabs cp-tabs" role="tablist" aria-label="Situação do cupom" data-tabs></div>
          <form class="toolbar cp-tb" data-filters role="search" novalidate>
            <div class="search cp-tb__search">
              ${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="cp-q">Buscar cupons</label>
              <input class="input" id="cp-q" type="search" value="${st.search}" placeholder="Código ou descrição" autocomplete="off" enterkeyhint="search">
              <span class="kbd kbd--sm cp-tb__kbd" aria-hidden="true">/</span>
            </div>
            ${network
              ? html`<div class="cp-tb__f">
                  <label class="visually-hidden" for="cp-scope">Onde vale</label>
                  <select class="select" id="cp-scope" data-scope data-prefix="Loja" data-sheet-title="Onde o cupom vale" data-search-placeholder="Buscar loja ou cidade…">
                    <option value="" data-icon="layers" data-hint="Cupons da rede e de cada loja">Todas</option>
                    <option value="network" data-mark="network" data-hint="Valem em todas as lojas">Só da rede</option>
                    <optgroup label="Lojas" data-count="${ctx.stores.length}">${ctx.stores.map(
                      (s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name || ''} · ${s.city || ''}" data-keywords="${s.name}">${ctx.storeShort?.(s) || s.name}</option>`
                    )}</optgroup>
                  </select>
                </div>`
              : ''}
            <div class="cp-tb__f">
              <label class="visually-hidden" for="cp-type-f">Tipo de desconto</label>
              <select class="select" id="cp-type-f" data-type-filter data-prefix="Tipo" data-sheet-title="Tipo de desconto">
                <option value="">Todos</option>
                ${Object.entries(TYPES).map(([k, l]) => html`<option value="${k}" data-icon="${TYPE_ICON[k]}">${l}</option>`)}
              </select>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
            <span class="toolbar__spacer"></span>
            <span class="cp-tb__sum" data-summary aria-live="polite"></span>
          </form>
          <div class="cp-results" id="cp-panel" role="tabpanel" data-results>${skeleton('table', { rows: 6, cols: 5 })}</div>
        </section>
      </div>`
    );
    const results = $('[data-results]', view);
    const searchInput = $('#cp-q', view);

    const visible = (withChip = true) => {
      const needle = fold(st.search.trim());
      return st.rows.filter((c) => {
        if (network && st.scope) {
          if (st.scope === 'network' ? c.store_id : c.store_id !== st.scope) return false;
        }
        if (st.type && c.type !== st.type) return false;
        if (needle && !fold(c.code).includes(needle) && !fold(c.description).includes(needle)) return false;
        return !withChip || matchesChip(c, st.chip);
      });
    };
    const filtered = () => !!(st.search.trim() || st.scope || st.type);

    const drawTabs = () => {
      const box = $('[data-tabs]', view);
      const hadFocus = box.contains(document.activeElement);
      const base = visible(false);
      render(
        box,
        TABS.map(([k, label, tone]) => {
          const on = st.chip === k;
          const n = st.loaded ? base.filter((c) => matchesChip(c, k)).length : undefined;
          return html`<button class="tab" type="button" role="tab" id="cp-tab-${k || 'all'}" aria-selected="${on ? 'true' : 'false'}" aria-controls="cp-panel" tabindex="${on ? '0' : '-1'}" data-chip="${k}">
            ${tone ? html`<span class="dot dot--sm t-${tone}" aria-hidden="true"></span>` : ''}${label}<span class="tab__n">${n === undefined ? '…' : num(n)}</span>
          </button>`;
        })
      );
      if (hadFocus) $('[aria-selected="true"]', box)?.focus({ preventScroll: true });
      results.setAttribute('aria-labelledby', `cp-tab-${st.chip || 'all'}`);
    };

    /* ---------- Resumo (pedidos com cupom) ---------- */
    const drawKpis = () => {
      const box = $('[data-kpis]', view);
      const scoped = st.rows.filter((c) => !network || !st.scope || (st.scope === 'network' ? !c.store_id : c.store_id === st.scope));
      const live = scoped.filter((c) => matchesChip(c, 'live')).length;
      const sched = scoped.filter((c) => matchesChip(c, 'scheduled')).length;
      const liveCard = kpiCard({
        label: 'Cupons valendo',
        icon: 'coupons',
        value: num(live),
        sub: `de ${plural(scoped.length, 'cadastrado', 'cadastrados')}${sched ? ` · ${plural(sched, 'agendado', 'agendados')}` : ''}`,
        info: 'Cupons ativos dentro do prazo, aceitos agora na loja virtual.',
      });
      if (!statRows) {
        render(box, html`${liveCard}${kpiCard({ label: 'Pedidos com cupom', icon: 'orders', value: '—', sub: 'Sem acesso aos pedidos' })}${kpiCard({ label: 'Desconto concedido', icon: 'percent', value: '—' })}${kpiCard({ label: 'Vendas com cupom', icon: 'cash', value: '—' })}`);
        return;
      }
      const now = Date.now();
      const inScope = statRows.filter((o) => {
        if (!network || !st.scope) return true;
        if (st.scope === 'network') return !st.rows.find((c) => c.id === o.coupon_id)?.store_id;
        return o.store_id === st.scope;
      });
      const win = (from, to) => inScope.filter((o) => {
        const t = Date.parse(o.created_at);
        return t >= now - from * DAY && t < now - to * DAY;
      });
      const cur = win(30, 0);
      const prev = win(60, 30);
      const sum = (list, k) => list.reduce((a, o) => a + (Number(o[k]) || 0), 0);
      const delta = (a, b) => (b ? ((a - b) / b) * 100 : undefined);
      const spark = Array.from({ length: 15 }, (_, i) => cur.filter((o) => {
        const t = Date.parse(o.created_at);
        return t >= now - (30 - i * 2) * DAY && t < now - (28 - i * 2) * DAY;
      }).length);
      const disc = sum(cur, 'discount_coupon');
      const sales = sum(cur, 'total');
      render(
        box,
        html`${liveCard}
          ${kpiCard({ label: 'Pedidos com cupom', icon: 'orders', value: num(cur.length), sub: 'Últimos 30 dias, sem cancelados', delta: delta(cur.length, prev.length), prev: `${num(prev.length)} pedidos`, spark: cur.length ? spark : null })}
          ${kpiCard({ label: 'Desconto concedido', icon: 'percent', value: money(disc), split: true, sub: cur.length ? `Média de ${money(disc / cur.length)} por pedido` : 'Nenhum cupom usado no período', delta: delta(disc, sum(prev, 'discount_coupon')), prev: money(sum(prev, 'discount_coupon')) })}
          ${kpiCard({ label: 'Vendas com cupom', icon: 'cash', value: money(sales), split: true, sub: cur.length ? `Ticket médio de ${money(sales / cur.length)}` : 'Últimos 30 dias', delta: delta(sales, sum(prev, 'total')), prev: money(sum(prev, 'total')) })}`
      );
    };

    const drawTip = () => {
      const box = $('[data-tip]', view);
      const soon = st.rows.filter((c) => canEdit(c) && c.active && phaseOf(c) === 'live' && c.ends_at && Date.parse(c.ends_at) - Date.now() < 7 * DAY);
      if (!soon.length || !st.rows.length) return render(box, '');
      render(
        box,
        tip({
          id: `coupons-ending-${soon.map((c) => c.id.slice(0, 4)).join('')}`,
          text: soon.length === 1
            ? `O cupom ${soon[0].code} termina ${whenText(soon[0].ends_at)}. Se a campanha continuar, estenda o prazo para não perder vendas.`
            : `${soon.length} cupons terminam nos próximos 7 dias. Se as campanhas continuarem, estenda o prazo para não perder vendas.`,
          action: soon.length === 1 ? { label: `Editar ${soon[0].code}`, onClick: () => openEdit(soon[0]) } : { label: 'Ver vigentes', onClick: () => setChip('live') },
        })
      );
    };

    /* ---------- Linhas ---------- */
    const codeChip = (c, hl) => html`<span class="cp-code"><span class="cp-code__text mono">${hl(c.code)}</span>
      <button class="btn btn--ghost btn--sm btn--icon cp-code__copy" type="button" data-copy="${c.code}" aria-label="Copiar código ${c.code}" data-tooltip="Copiar código">${icon('copy', 'icon-sm')}</button></span>`;
    const statusCell = (c) => {
      const s = statusOf(c);
      const soon = soonText(c);
      return html`${badge(s.label, s.tone)}<span class="sub cp-valid" title="${validityTitle(c)}">${validityText(c)}${soon ? html` · <span class="cp-soon">${soon}</span>` : ''}</span>`;
    };
    const actionsCell = (c, editable) =>
      editable
        ? html`<div class="cp-actions">
            ${canCreate ? html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-dup="${c.id}" aria-label="Duplicar cupom ${c.code}" data-tooltip="Duplicar">${icon('layers', 'icon-sm')}</button>` : ''}
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit="${c.id}" aria-label="Editar cupom ${c.code}" data-tooltip="Editar">${icon('edit', 'icon-sm')}</button>
            <button class="btn btn--ghost btn--sm btn--icon cp-del" type="button" data-del="${c.id}" aria-label="Excluir cupom ${c.code}" data-tooltip="Excluir">${icon('trash', 'icon-sm')}</button>
          </div>`
        : html`<span class="cp-ro" title="Cupons da rede são gerenciados pela administração da rede">${icon('lock', 'icon-xs')} Gerenciado pela rede</span>`;
    const activeSwitch = (c, editable, visibleLabel = false) => html`<label class="switch cp-switch" title="${editable ? (c.active ? 'Desativar' : 'Ativar') : 'Gerenciado pela rede'}">
      <input type="checkbox" data-toggle="${c.id}" ${c.active ? 'checked' : ''} ${editable ? '' : 'disabled'}>
      <span class="switch__track"></span>
      ${visibleLabel ? html`<span class="switch__txt small">Ativo</span>` : html`<span class="visually-hidden">Cupom ${c.code} ativo</span>`}
    </label>`;
    const scopeCell = (c) =>
      c.store_id
        ? html`<span class="cp-store">${storeMark(ctx.stores.find((s) => s.id === c.store_id) || {}, 24)}<span class="ellipsis">${scopeName(ctx, c)}</span></span>`
        : html`<span class="cp-store">${netMark(24)}<span>Toda a rede</span></span>`;

    const draw = () => {
      // primeira vez (nenhum cupom): só o convite para criar, sem abas, filtros nem resumo zerado
      const firstRun = st.loaded && !st.rows.length;
      $('[data-tabs]', view).hidden = firstRun;
      $('[data-filters]', view).hidden = firstRun;
      $('[data-kpis]', view).hidden = firstRun;
      drawTabs();
      const all = visible();
      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (st.page > pages) st.page = pages;
      const list = all.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
      const isFiltered = filtered();
      $('[data-clear]', view).hidden = !isFiltered;
      render($('[data-summary]', view), st.loaded && total ? html`<b>${num(total)}</b> ${total === 1 ? 'cupom' : 'cupons'}` : '');
      ctx.setTitle('Cupons', st.rows.length ? `${where} · ${plural(st.rows.filter((c) => matchesChip(c, 'live')).length, 'cupom valendo', 'cupons valendo')} de ${num(st.rows.length)}` : 'Descontos para fechar a venda');
      if (!total) {
        let block;
        if (!st.rows.length) {
          block = empty(
            'Nenhum cupom ainda',
            `Cupons ajudam a fechar a venda no WhatsApp. Crie um com valor, porcentagem ou frete grátis${network ? ' para a rede ou para uma loja' : ` para ${where}`}.`,
            canCreate ? html`<button class="btn btn--primary" type="button" data-cp-new>${icon('plus', 'icon-sm')} Novo cupom</button>` : '',
            { art: 'empty-box', size: 'lg' }
          );
        } else if (isFiltered) {
          const term = st.search.trim();
          block = empty(
            'Nenhum cupom encontrado',
            term ? `Nada com “${term}”${st.chip ? ` entre os ${TABS.find(([k]) => k === st.chip)[1].toLowerCase()}` : ''}. Confira o código ou limpe os filtros.` : 'Nenhum cupom combina com os filtros escolhidos.',
            html`<button class="btn" type="button" data-clear>${icon('close', 'icon-sm')} Limpar filtros</button>`,
            { art: 'site:empty-search' }
          );
        } else {
          block = empty(
            `Nenhum cupom ${TAB_EMPTY[st.chip]}`,
            st.chip === 'live' ? 'Nenhum cupom está valendo agora. Ative um cupom ou crie uma campanha nova.' : st.chip === 'scheduled' ? 'Agende um cupom escolhendo a data de início no formulário.' : st.chip === 'off' ? 'Todos os cupons estão ligados.' : 'Nenhum cupom passou do prazo.',
            html`<button class="btn" type="button" data-chip="">Ver todos</button>${canCreate && st.chip !== 'expired' && st.chip !== 'off' ? html`<button class="btn btn--dark" type="button" data-cp-new>${icon('plus', 'icon-sm')} Novo cupom</button>` : ''}`,
            { art: false, icon: 'coupons', size: 'sm' }
          );
        }
        render(results, html`<div class="cp-empty">${block}</div>`);
        return;
      }
      const hasReadonly = list.some((c) => !canEdit(c));
      const term = st.search.trim();
      const hl = (text) => (term ? highlight(text, term) : text);
      render(
        results,
        html`<div class="table-wrap cp-tw"><table class="table cp-table">
          <caption class="visually-hidden">Cupons</caption>
          <thead><tr>
            <th scope="col">Cupom</th>
            ${network ? html`<th scope="col">Onde vale</th>` : ''}
            <th scope="col">Desconto</th>
            <th scope="col">Usos</th>
            <th scope="col">Situação</th>
            <th scope="col" class="cp-c-active">Ativo</th>
            <th scope="col" class="cp-c-actions"><span class="visually-hidden">Ações</span></th>
          </tr></thead>
          <tbody>${list.map((c) => {
            const editable = canEdit(c);
            const isNet = !c.store_id;
            // na loja, um cupom próprio com o mesmo código tem prioridade sobre o da rede (coupon_eval)
            const overridden = !network && isNet && st.rows.some((r) => r.store_id && r.code === c.code);
            return html`<tr class="${editable ? 'is-clickable' : ''} ${c.active ? '' : 'cp-off'}" data-id="${c.id}">
              <td class="cp-c-code">
                <div class="cp-cell-code">${codeChip(c, hl)}${!network && isNet ? html`<span class="tag cp-net">${icon('houses', 'icon-xs')} Rede</span>` : ''}</div>
                <span class="sub cp-desc" title="${c.description || ''}">${c.description ? hl(c.description) : html`<span class="faint">Sem descrição</span>`}</span>
                ${overridden ? html`<span class="sub cp-override">${icon('info', 'icon-xs')} Nesta loja vale o cupom da loja</span>` : ''}
              </td>
              ${network ? html`<td class="cp-c-store">${scopeCell(c)}</td>` : ''}
              <td class="cp-c-disc"><span class="cp-disc ${c.type === 'free_shipping' ? 'is-ship' : ''}">${c.type === 'free_shipping' ? icon('truck', 'icon-sm') : ''}${discountMain(c)}</span><span class="sub">${discountSub(c)}</span></td>
              <td class="cp-c-uses">${usesBlock(c, stats.get(c.id))}</td>
              <td class="cp-c-valid">${statusCell(c)}</td>
              <td class="cp-c-active">${activeSwitch(c, editable)}</td>
              <td class="cp-c-actions">${actionsCell(c, editable)}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <ul class="cp-cards" aria-label="Cupons">${list.map((c) => {
          const editable = canEdit(c);
          const s = statusOf(c);
          const soon = soonText(c);
          return html`<li class="card m-card cp-mc ${c.active ? '' : 'cp-off'}" data-id="${c.id}">
            <div class="cp-mc__top">${codeChip(c, hl)}${badge(s.label, s.tone)}</div>
            ${c.description ? html`<p class="cp-mc__desc">${hl(c.description)}</p>` : ''}
            <div class="cp-mc__grid">
              <div><span class="cp-mc__l">Desconto</span><span class="cp-disc ${c.type === 'free_shipping' ? 'is-ship' : ''}">${discountMain(c)}</span><span class="sub">${discountSub(c)}</span></div>
              <div><span class="cp-mc__l">Usos</span>${usesBlock(c, stats.get(c.id), { compact: true })}</div>
            </div>
            <p class="cp-mc__meta">${network ? html`${scopeCell(c)}<span aria-hidden="true">·</span>` : !c.store_id ? html`<span class="tag cp-net">${icon('houses', 'icon-xs')} Rede</span>` : ''}<span title="${validityTitle(c)}">${icon('calendar', 'icon-xs')} ${validityText(c)}${soon ? html` · <span class="cp-soon">${soon}</span>` : ''}</span></p>
            <div class="cp-mc__foot">${activeSwitch(c, editable, true)}<span class="grow"></span>${actionsCell(c, editable)}</div>
          </li>`;
        })}</ul>
        ${total > PAGE_SIZE ? pager({ page: st.page, pageSize: PAGE_SIZE, total }) : ''}
        ${hasReadonly ? html`<p class="cp-note">${icon('info', 'icon-xs')} Cupons marcados com “Rede” valem em todas as lojas e são gerenciados pela administração da rede.</p>` : ''}`
      );
      const info = $('.pager__info', results);
      if (info) info.append(total === 1 ? ' cupom' : ' cupons');
    };

    const loadStats = async () => {
      try {
        let qy = sb.from('orders').select('coupon_id, store_id, discount_coupon, total, status, created_at').not('coupon_id', 'is', null).neq('status', 'canceled').order('created_at', { ascending: false }).limit(5000);
        if (!network) qy = qy.eq('store_id', ctx.storeId);
        const rows = await q(qy);
        statRows = rows;
        stats = new Map();
        rows.forEach((o) => {
          const s = stats.get(o.coupon_id) || { uses: 0, discount: 0, sales: 0, last: null };
          s.uses += 1;
          s.discount += Number(o.discount_coupon) || 0;
          s.sales += Number(o.total) || 0;
          if (!s.last || o.created_at > s.last) s.last = o.created_at;
          stats.set(o.coupon_id, s);
        });
      } catch {
        statRows = null; // sem permissão de pedidos: o resumo mostra só os cupons
      }
    };

    const load = async () => {
      try {
        let qy = sb.from('coupons').select('*').order('created_at', { ascending: false });
        if (!network) qy = qy.or(`store_id.eq.${ctx.storeId},store_id.is.null`);
        const [rows] = await Promise.all([q(qy), loadStats()]);
        // na loja: cupons da loja primeiro, depois os da rede
        st.rows = network ? rows : [...rows.filter((r) => r.store_id), ...rows.filter((r) => !r.store_id)];
        st.loaded = true;
        draw();
        drawKpis();
        drawTip();
      } catch (e) {
        render($('[data-kpis]', view), '');
        render(results, html`<div class="cp-empty">${errorBlock(e, { retry: () => {
          render(results, skeleton('table', { rows: 6, cols: 5 }));
          load();
        }, title: 'Não foi possível carregar os cupons' })}</div>`);
      }
    };

    const defaultStore = () => (network ? (st.scope && st.scope !== 'network' ? st.scope : null) : ctx.storeId);
    const openNew = () => openCouponForm(ctx, { rows: st.rows, defaultStore: defaultStore(), onSaved: load });
    const openEdit = (c) => openCouponForm(ctx, { coupon: c, rows: st.rows, stats, onSaved: load });
    const openDup = (c) => openCouponForm(ctx, { copyOf: c, rows: st.rows, onSaved: load });
    const setChip = (k) => {
      st.chip = k;
      st.page = 1;
      draw();
    };

    const remove = async (c, btn) => {
      let action = 'delete';
      if (c.used_count > 0) {
        action = await askDeleteUsed(c);
        if (!action) return;
      } else {
        const ok = await confirmDialog({
          title: `Excluir o cupom ${c.code}?`,
          message: 'O cupom some da loja virtual e da lista. Esta ação não pode ser desfeita.',
          confirmLabel: 'Excluir cupom',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        if (action === 'deactivate') {
          const data = await q(sb.from('coupons').update({ active: false }).eq('id', c.id).select('id'));
          if (!data?.length) throw new Error('Você não tem permissão para alterar este cupom.');
          toast(`Cupom ${c.code} desativado`, 'success');
        } else {
          if (btn) btn.disabled = true;
          const data = await q(sb.from('coupons').delete().eq('id', c.id).select('id'));
          if (!data?.length) throw new Error('Você não tem permissão para excluir este cupom.');
          toast(`Cupom ${c.code} excluído`, 'success');
        }
        await load();
      } catch (err) {
        if (btn?.isConnected) btn.disabled = false;
        toastError(err);
      }
    };

    /* ---------- Eventos ---------- */
    // os botões do cabeçalho são novos a cada tela (o [data-actions] do shell continua o mesmo)
    $('[data-actions] [data-cp-new]')?.addEventListener('click', () => openNew());
    $('[data-actions] [data-test]')?.addEventListener('click', () => openTester(ctx, { storeId: network && st.scope && st.scope !== 'network' ? st.scope : null }));

    searchInput.addEventListener(
      'input',
      debounce(() => {
        st.search = searchInput.value;
        st.page = 1;
        draw();
      }, 200)
    );
    $('[data-filters]', view).addEventListener('submit', (e) => e.preventDefault());
    $('[data-scope]', view)?.addEventListener('change', (e) => {
      st.scope = e.target.value;
      st.page = 1;
      draw();
      drawKpis();
    });
    $('[data-type-filter]', view).addEventListener('change', (e) => {
      st.type = e.target.value;
      st.page = 1;
      draw();
    });
    // "/" foca a busca
    const onSlash = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]') || document.querySelector('.modal, .panel')) return;
      e.preventDefault();
      searchInput.focus();
    };
    document.addEventListener('keydown', onSlash);
    ctx.onCleanup(() => document.removeEventListener('keydown', onSlash));

    $('[data-tabs]', view).addEventListener('keydown', (e) => {
      const keys = TABS.map(([k]) => k);
      const i = keys.indexOf(st.chip);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % keys.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + keys.length) % keys.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = keys.length - 1;
      if (j === null) return;
      e.preventDefault();
      setChip(keys[j]);
      $('[data-tabs] [aria-selected="true"]', view)?.focus();
    });

    view.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) return setChip(chip.dataset.chip);
      const pg = e.target.closest('[data-page]');
      if (pg && !pg.disabled) {
        st.page = Number(pg.dataset.page) || 1;
        draw();
        $('.cp-card', view)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        return;
      }
      if (e.target.closest('[data-clear]')) {
        st.chip = '';
        st.search = '';
        st.scope = '';
        st.type = '';
        st.page = 1;
        searchInput.value = '';
        const sc = $('[data-scope]', view);
        if (sc) sc.value = '';
        $('[data-type-filter]', view).value = '';
        draw();
        drawKpis();
        searchInput.focus();
        return;
      }
      if (e.target.closest('[data-cp-new]')) return openNew();
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const ok = await copyText(copy.dataset.copy);
        toast(ok ? `Código ${copy.dataset.copy} copiado` : 'Não foi possível copiar', ok ? 'success' : 'error', 2200);
        return;
      }
      const dup = e.target.closest('[data-dup]');
      if (dup) {
        const c = byId(dup.dataset.dup);
        if (c) openDup(c);
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const c = byId(ed.dataset.edit);
        if (c) openEdit(c);
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const c = byId(del.dataset.del);
        if (c) remove(c, del);
        return;
      }
      // clique na linha/cartão (fora de botões e do interruptor) abre a edição
      if (e.target.closest('button, a, input, label, select, [role="combobox"]')) return;
      const tr = e.target.closest('tr[data-id], .cp-mc[data-id]');
      if (tr) {
        const c = byId(tr.dataset.id);
        if (c && canEdit(c)) openEdit(c);
      }
    });

    view.addEventListener('change', async (e) => {
      const sw = e.target.closest('[data-toggle]');
      if (!sw) return;
      const c = byId(sw.dataset.toggle);
      if (!c) return;
      const next = sw.checked;
      sw.disabled = true;
      try {
        const data = await q(sb.from('coupons').update({ active: next }).eq('id', c.id).select('id, active'));
        if (!data?.length) throw new Error('Você não tem permissão para alterar este cupom.');
        c.active = next;
        toast(next ? `Cupom ${c.code} ativado` : `Cupom ${c.code} desativado`, 'success', 2500);
        const focusId = sw.dataset.toggle;
        const inCard = !!sw.closest('.cp-mc');
        draw();
        drawKpis();
        $(`${inCard ? '.cp-mc' : 'tr'} [data-toggle="${focusId}"]`, view)?.focus({ preventScroll: true });
      } catch (err) {
        sw.checked = !next;
        sw.disabled = false;
        toastError(err);
      }
    });

    drawTabs();
    await load();
    return () => closeDayPicker();
  },
};

const CSS = `
/* ---------- Lista ---------- */
.cp { display: flex; flex-direction: column; gap: 16px; }
.cp-kpis:empty { display: none; }
.cp [data-tip]:empty { display: none; }
.cp-card { overflow: hidden; }
.cp-card .tabs { margin: 0; padding: 0 12px; }
.cp-tb { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.cp-tb__search { max-width: 340px; }
.cp-tb__search .input { padding-right: 36px; }
.cp-tb__f .sel__trigger, .cp-tb__f .select { min-width: 150px; }
.cp-tb__sum { font-size: 13px; color: var(--muted); white-space: nowrap; }
.cp-tb__sum b { color: var(--ink); font-weight: 600; }
.cp-results.is-busy { opacity: .6; }
.cp-tw { border: 0; border-radius: 0; box-shadow: none; }
.cp-table th { white-space: nowrap; }
.cp-table td { vertical-align: middle; padding-top: 12px; padding-bottom: 12px; }
.cp-table th:first-child, .cp-table td:first-child { padding-left: 20px; }
.cp-table th:last-child, .cp-table td:last-child { padding-right: 16px; }
.cp-c-code { min-width: 220px; max-width: 340px; }
.cp-cell-code { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cp-code { display: inline-flex; align-items: center; gap: 2px; }
.cp-code__text { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: 1.5px dashed var(--ora-line); border-radius: 8px; background: var(--highlight-soft); color: var(--ink); font-weight: 700; font-size: 13px; letter-spacing: .06em; white-space: nowrap; }
.cp-code__text mark { background: color-mix(in srgb, var(--orange) 30%, transparent); color: inherit; border-radius: 3px; }
.cp-code__copy { color: var(--muted); }
.cp-desc { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-desc mark { background: color-mix(in srgb, var(--orange) 26%, transparent); color: inherit; border-radius: 3px; }
.cp-net { height: 22px; font-size: 11.5px; color: var(--muted); }
.cp-net .icon-xs { width: 12px; height: 12px; }
.cp-override { display: inline-flex; align-items: center; gap: 4px; color: var(--info-fg); }
.cp-store { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 190px; font-size: 13.5px; color: var(--ink); }
.cp-store .smark--net { display: inline-grid; place-items: center; }
.cp-disc { display: inline-flex; align-items: center; gap: 6px; font: 800 17px/1.15 var(--font-display); color: var(--ink); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cp-disc.is-ship { font-size: 15px; }
.cp-disc .icon-sm { color: var(--highlight-ink); }
.cp-uses { display: flex; flex-direction: column; gap: 5px; min-width: 110px; }
.cp-uses__n { font-size: 13.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cp-uses__n b { color: var(--ink); font-weight: 700; }
.cp-uses__full { color: var(--warn-fg); font-weight: 600; font-size: 12px; }
.cp-uses .sub { margin-top: 0; }
.cp-meter { width: 100%; max-width: 120px; height: 5px; }
.cp-meter > span { background: var(--spark); }
.cp-meter.is-high > span { background: var(--warn-dot); }
.cp-meter.is-full > span { background: var(--bad-dot); }
.cp-valid { white-space: nowrap; }
.cp-soon { color: var(--warn-fg); font-weight: 600; }
.cp-c-active { width: 64px; }
.cp-c-actions { width: 1%; white-space: nowrap; text-align: right; }
.cp-actions { display: inline-flex; justify-content: flex-end; gap: 2px; }
.cp-del { color: var(--bad-fg); }
.cp-ro { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.cp-off .cp-code__text, .cp-off .cp-desc, .cp-off .cp-store, .cp-off .cp-disc, .cp-off .cp-uses, .cp-off .cp-c-disc .sub { opacity: .55; }
.cp-switch .switch__track { margin-top: 0; }
.cp-switch { align-items: center; }
.cp-note { display: flex; align-items: center; gap: 6px; margin: 0; padding: 12px 20px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
.cp-card .pager { margin: 0; padding: 12px 20px; border-top: 1px solid var(--line); }
.cp-empty { padding: 8px 0; }
.cp-cards { display: none; }
.cp-hide-sm { display: inline; }

/* ---------- Formulário ---------- */
@media (min-width: 768px) { .cp-modal.modal--lg { width: min(940px, calc(100vw - 32px)); } }
.cp-ed { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 24px; align-items: start; }
.cp-ed__form { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.cp-sec { margin: 0; padding: 0; border: 0; min-width: 0; }
.cp-sec + .cp-sec { padding-top: 20px; border-top: 1px solid var(--line); }
.cp-sec__t { float: left; width: 100%; margin: 0 0 12px; padding: 0; font: 700 15px/1.3 var(--font-display); color: var(--ink); }
.cp-sec__t + * { clear: both; }
.cp-ed__side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 14px; }
.cp-ed__ov { margin: 0 0 6px; font: 600 11px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.cp-fixed { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 12px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-3); color: var(--ink); font-weight: 600; }
.cp-fixed > .icon-xs { margin-left: auto; color: var(--muted); }
.cp-code-input { text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.cp-ed .input-group .input { min-width: 0; }
.cp-gen { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; box-shadow: none; }
.cp-active { padding-top: 4px; }
/* bilhete */
.cp-ticket { position: relative; border-radius: 16px; background: linear-gradient(160deg, var(--highlight-soft), var(--surface) 70%); border: 1px solid var(--ora-line); box-shadow: var(--sh-card); color: var(--ink); overflow: hidden; }
.cp-ticket__top { display: flex; flex-direction: column; gap: 6px; padding: 16px 18px 14px; }
.cp-ticket__where { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--muted); }
.cp-ticket__where .smark--net { display: inline-grid; place-items: center; }
.cp-ticket__big { display: flex; align-items: center; gap: 8px; font: 800 30px/1.05 var(--font-display); letter-spacing: -0.02em; color: var(--accent-ink); overflow-wrap: anywhere; }
.cp-ticket__big.is-ship { font-size: 25px; }
.cp-ticket__desc { font-size: 13px; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
.cp-ticket__cut { position: relative; height: 0; margin: 0 14px; border-top: 2px dashed var(--ora-line); }
.cp-ticket__cut::before, .cp-ticket__cut::after { content: ''; position: absolute; top: -11px; width: 20px; height: 20px; border-radius: 50%; background: var(--raised); border: 1px solid var(--ora-line); }
.cp-ticket__cut::before { left: -25px; }
.cp-ticket__cut::after { right: -25px; }
.cp-ticket__bottom { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px 18px 16px; }
.cp-ticket__code { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 8px; background: var(--raised); border: 1.5px dashed var(--line-strong); font: 700 14px/1 var(--font-mono); letter-spacing: .08em; color: var(--ink); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cp-ticket__rules { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--text); }
.cp-ticket__rules li { display: flex; align-items: flex-start; gap: 6px; }
.cp-ticket__rules .icon-xs { width: 13px; height: 13px; margin-top: 2px; color: var(--ok-fg); stroke-width: 2.6; flex: none; }
.cp-example, .cp-stat { padding: 12px 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
.cp-ex__row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 13px; color: var(--text); font-variant-numeric: tabular-nums; }
.cp-ex__row b { font-weight: 600; color: var(--ink); white-space: nowrap; }
.cp-ex__row.is-off b { color: var(--ok-fg); }
.cp-ex__row.is-total { margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--line-strong); font-weight: 600; color: var(--ink); }
.cp-ex__row.is-total b { font: 800 16px/1.2 var(--font-display); }
.cp-ex__row small { font: 500 12px var(--font-ui); color: var(--muted); }
.cp-stat__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin: 0; }
.cp-stat__grid dt { font-size: 11.5px; color: var(--muted); }
.cp-stat__grid dd { margin: 2px 0 0; font: 800 15px/1.2 var(--font-display); color: var(--ink); font-variant-numeric: tabular-nums; }
.cp-stat__grid dd small { font: 500 12px var(--font-ui); color: var(--muted); }
.cp-dialog .modal__foot { flex-wrap: wrap; }
/* teste */
.cp-test__lede { margin: -4px 0 0; font-size: 13.5px; }
.cp-result { padding: 14px 16px; border-radius: 14px; border: 1px solid; }
.cp-result.is-ok { background: var(--ok-bg); border-color: var(--ok-line); }
.cp-result.is-bad { background: var(--warn-bg); border-color: var(--warn-line); }
.cp-result__head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
.cp-result__head > .icon { flex: none; margin-top: 1px; }
.cp-result.is-ok .cp-result__head > .icon { color: var(--ok-fg); }
.cp-result.is-bad .cp-result__head > .icon { color: var(--warn-fg); }
.cp-result__head strong { display: block; color: var(--ink); font-weight: 700; }
.cp-result__head span { font-size: 13px; color: var(--text); }
.cp-result.is-bad .cp-result__head { margin-bottom: 0; }

@media (max-width: 1100px) {
  .cp-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .cp-ed { grid-template-columns: minmax(0, 1fr); }
  .cp-ed__side { position: static; padding-top: 20px; border-top: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
  .cp-ed__side > .cp-ed__ov { grid-column: 1 / -1; margin-bottom: -8px; }
  .cp-stat { grid-column: 1 / -1; }
  .cp-stat__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .cp-tw { display: none; }
  .cp-cards { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 12px; list-style: none; }
  .cp-mc { padding: 13px 14px; cursor: pointer; }
  .cp-mc__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .cp-mc__desc { margin: 8px 0 0; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .cp-mc__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--line-strong); }
  .cp-mc__l { display: block; margin-bottom: 3px; font: 600 11px/1 var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .cp-mc__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
  .cp-mc__meta > span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .cp-mc__foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .cp-mc__foot .btn--icon { width: 40px; height: 40px; }
  .cp-tb { padding: 12px; }
  .cp-tb__search { flex-basis: 100%; max-width: none; }
  .cp-tb__kbd { display: none; }
  .cp-tb__f { flex: 1 1 140px; min-width: 0; }
  .cp-tb__f .sel__trigger, .cp-tb__f .select { width: 100%; min-width: 0; max-width: none; }
  .cp-tb .toolbar__spacer { display: none; }
  .cp-note { padding: 12px 16px; }
}
@media (max-width: 640px) {
  .cp-hide-sm { display: none; }
  .cp-kpis { gap: 10px; }
  .cp-kpis .kpi { padding: 13px 14px; }
  .cp-kpis .kpi__value { font-size: 21px; }
  .cp-kpis .kpi__value small { font-size: 14px; }
  .cp-kpis .kpi__ico { display: none; }
  .cp-kpis .kpi__spark { margin: auto -14px 0; }
  .cp-ed__side { grid-template-columns: minmax(0, 1fr); }
  .cp-stat__grid { grid-template-columns: 1fr 1fr; }
  .cp-dialog .modal__foot .btn { flex: 1 1 auto; }
}
`;

// Estilos do campo "Período" (injetados também pela vitrine)
export const SCHEDULE_CSS = `
.sch { margin: 0; padding: 0; border: 0; min-width: 0; }
.sch__legend { display: flex; align-items: center; gap: 7px; width: 100%; margin: 0 0 10px; padding: 0; font: 700 15px/1.3 var(--font-display); color: var(--ink); }
.sch__legend > .icon-sm { color: var(--muted); }
.sch__tz { margin-left: auto; font: 500 12px var(--font-ui); color: var(--muted); }
.sch__grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 0 12px; align-items: start; }
.sch__arrow { padding-top: 37px; color: var(--muted); }
.sch__inputs { display: flex; gap: 8px; }
.sch__date { position: relative; flex: 1; min-width: 0; }
.sch__date .input { padding-right: 66px; font-variant-numeric: tabular-nums; }
.sch__time { width: 84px; flex: none; text-align: center; font-variant-numeric: tabular-nums; }
.sch__cal, .sch__x { position: absolute; top: 50%; transform: translateY(-50%); display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 8px; }
.sch__cal { right: 4px; width: 32px; height: 32px; }
.sch__cal:hover, .sch__cal[aria-expanded="true"] { background: var(--surface-3); color: var(--ink); }
.sch__x { right: 38px; width: 24px; height: 24px; }
.sch__x:hover { background: var(--surface-3); color: var(--ink); }
.sch__x[hidden] { display: none; }
.sch__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.sch__chip { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--raised); color: var(--text); font: 600 12px/1 var(--font-ui); cursor: pointer; }
.sch__chip:hover { border-color: var(--ink); color: var(--ink); }
.sch__sum { display: flex; align-items: flex-start; gap: 9px; margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: var(--b-bg, var(--surface-2)); border: 1px solid var(--b-line, var(--line)); color: var(--text); font-size: 13px; line-height: 1.4; }
.sch__sum .dot { margin-top: 5px; }
.sch__sum.t-bad { color: var(--bad-fg); font-weight: 500; }
.sch__sum.t-bad { --b-bg: var(--bad-bg); --b-line: var(--bad-line); --d: var(--bad-dot); }
.sch__sum.t-neu { --b-bg: var(--surface-2); --b-line: var(--line); }
.pop--day { width: 300px; padding: 10px 10px 0; }
.dayp__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.dayp__head .cal__mt { margin: 0; }
.pop--day .cal__d { height: 36px; line-height: 36px; }
.pop--day .pop__foot { margin: 8px -10px 0; gap: 4px; justify-content: flex-start; }
.dayp__k { margin-left: auto; font-size: 11.5px; color: var(--muted); }
@media (max-width: 640px), (pointer: coarse) { .dayp__k { display: none; } }

@media (max-width: 640px) {
  .sch__grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .sch__arrow { display: none; }
  .sch__time { width: 92px; }
}
`;
export const injectSchedule = () => injectStyle('schedule', SCHEDULE_CSS);
