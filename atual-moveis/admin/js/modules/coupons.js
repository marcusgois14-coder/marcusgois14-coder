// Cupons de desconto: lista por loja (com os cupons da rede, somente leitura para a equipe da loja)
// ou da rede inteira (administradores da rede), criação/edição, ativar/desativar, exclusão e teste.
//
// Regras (espelham public.coupon_eval no banco):
//   percentual → subtotal × valor/100 (limitado ao desconto máximo) · valor fixo → até o subtotal
//   frete grátis → zera o frete · pedido mínimo sobre o subtotal · o desconto PIX da loja vem depois do cupom.
//   Cupom da loja tem prioridade sobre um cupom da rede com o mesmo código.
import { sb, q, rpc } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, money, num, pct, datetime, badge, openModal, confirmDialog, showErrors,
  withBusy, switchField, selectOptions, loading, empty, errorBlock, injectStyle, debounce,
} from '../ui.js';

const TYPES = { percent: 'Percentual', fixed: 'Valor fixo', free_shipping: 'Frete grátis' };
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const EXAMPLE_SUBTOTAL = 1000;
const TZ = 'America/Sao_Paulo';
const PHASES = {
  live: { label: 'Vigente', tone: 'success' },
  scheduled: { label: 'Agendado', tone: 'info' },
  expired: { label: 'Expirado', tone: 'dark' },
};
const CHIPS = [
  ['', 'Todos'],
  ['live', 'Vigentes'],
  ['scheduled', 'Agendados'],
  ['expired', 'Expirados'],
  ['off', 'Inativos'],
];

/* ---------- Utilitários ---------- */
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtNum = (v) => nf.format(Number(v) || 0);
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

// datetime-local ↔ ISO, sempre no horário de Brasília (sem horário de verão desde 2019)
const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function toLocalInput(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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

// Data curta para a tabela: "30/10 08:00" (ano só se for outro); omite 00:00 no início e 23:59 no fim
const thisYear = () => toLocalInput(new Date().toISOString()).slice(0, 4);
function shortWhen(iso, edge) {
  const v = toLocalInput(iso); // AAAA-MM-DDTHH:mm (Brasília)
  const [y, m, d] = v.slice(0, 10).split('-');
  const hm = v.slice(11, 16);
  const dm = y === thisYear() ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
  if ((edge === 'start' && hm === '00:00') || (edge === 'end' && hm === '23:59')) return dm;
  return `${dm} ${hm}`;
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

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

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

/* ---------- Células da tabela ---------- */
function discountCell(c) {
  if (c.type === 'free_shipping') return html`<strong>Frete grátis</strong><div class="muted small">Zera o frete</div>`;
  const main = c.type === 'percent' ? `${fmtNum(c.value)}%` : money(c.value);
  return html`<strong class="nowrap">${main}</strong><div class="muted small nowrap">${TYPES[c.type]}</div>${
    c.type === 'percent' && c.max_discount !== null ? html`<div class="muted small nowrap">até ${money(c.max_discount)}</div>` : ''
  }`;
}

function usesCell(c) {
  const limit = c.usage_limit === null ? '∞' : num(c.usage_limit);
  return html`<div class="nowrap"><strong>${num(c.used_count)}</strong> <span class="muted">/ ${limit}</span></div>
    ${c.per_phone_limit !== null ? html`<div class="muted small nowrap">${num(c.per_phone_limit)} por cliente</div>` : ''}
    ${soldOut(c) ? badge('Esgotado', 'warning') : ''}`;
}

function validityCell(c) {
  const phase = phaseOf(c);
  const b = !c.active && phase !== 'expired' ? badge('Inativo') : badge(PHASES[phase].label, PHASES[phase].tone);
  return html`<div class="small cp-validity" title="${validityTitle(c)}">${validityText(c)}</div>${b}`;
}

/* =========================================================
   FORMULÁRIO (criar / editar)
   ========================================================= */
function valueGroup(type, value) {
  return type === 'percent'
    ? html`<input class="input" id="cp-value" name="value" inputmode="decimal" autocomplete="off" value="${value}" placeholder="10"><span class="input-group__addon">%</span>`
    : html`<span class="input-group__addon">R$</span><input class="input" id="cp-value" name="value" inputmode="decimal" autocomplete="off" value="${value}" placeholder="50,00">`;
}

function openCouponForm(ctx, { coupon = null, rows = [], defaultStore = null, onSaved }) {
  const editing = !!coupon;
  const c = coupon || {
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

  const scopeField = ctx.isGlobal
    ? html`<div class="field col-12">
        <label for="cp-store">Abrangência *</label>
        <select class="select" id="cp-store" name="store_id">${selectOptions(
          [['', 'Toda a rede (vale em todas as lojas)'], ...ctx.stores.map((s) => [s.id, s.name])],
          c.store_id || ''
        )}</select>
        <span class="hint">Um cupom da loja tem prioridade sobre um cupom da rede com o mesmo código.</span>
      </div>`
    : html`<div class="field col-12"><span class="label">Abrangência</span>
        <div class="cp-fixed">${icon('store', 'icon-sm')}<span>${ctx.storeName(fixedStore)}</span></div></div>`;

  const body = html`<form class="form-grid cp-form" id="cp-form" novalidate>
    ${scopeField}
    <div class="field col-6">
      <label for="cp-code">Código *</label>
      <div class="input-group">
        <input class="input mono cp-code-input" id="cp-code" name="code" value="${c.code}" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="EX.: NATAL10" required ${editing ? '' : 'autofocus'}>
        <button class="btn cp-gen" type="button" data-gen>Gerar</button>
      </div>
      <span class="hint">3 a 30 caracteres: letras sem acento, números, - ou _.</span>
    </div>
    <div class="field col-6">
      <label for="cp-type">Tipo *</label>
      <select class="select" id="cp-type" name="type">${selectOptions(Object.entries(TYPES), c.type)}</select>
    </div>
    <div class="field col-4" data-value-field ${c.type === 'free_shipping' ? 'hidden' : ''}>
      <label for="cp-value">Valor do desconto *</label>
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
    <div class="col-12 cp-example" data-example aria-live="polite"></div>
    <div class="field col-12">
      <label for="cp-desc">Descrição</label>
      <input class="input" id="cp-desc" name="description" value="${c.description || ''}" maxlength="140" placeholder="Ex.: 10% em toda a loja na semana do cliente">
      <span class="hint">Aparece para o cliente quando ele aplica o cupom.</span>
    </div>
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
    <div class="field col-6">
      <label for="cp-start">Início</label>
      <input class="input" id="cp-start" name="starts_at" type="datetime-local" value="${toLocalInput(c.starts_at)}">
      <span class="hint">Horário de Brasília. Em branco = já vale.</span>
    </div>
    <div class="field col-6">
      <label for="cp-end">Fim</label>
      <input class="input" id="cp-end" name="ends_at" type="datetime-local" value="${toLocalInput(c.ends_at)}">
      <span class="hint">Em branco = sem data para acabar.</span>
    </div>
    <div class="col-12">${switchField({ label: 'Cupom ativo', name: 'active', checked: c.active, hint: 'Desligado, o cupom não é aceito na loja virtual.' })}</div>
  </form>`;

  openModal({
    title: editing ? `Editar cupom ${c.code}` : 'Novo cupom',
    size: 'lg',
    body,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="submit" form="cp-form" data-save>${editing ? 'Salvar alterações' : 'Criar cupom'}</button>`,
    onMount(el, close) {
      const form = $('#cp-form', el);
      const get = (name) => form.elements.namedItem(name);

      const read = () => {
        const type = get('type').value;
        return {
          store_id: ctx.isGlobal ? get('store_id').value || null : fixedStore,
          code: normalizeCode(get('code').value),
          description: get('description').value.trim() || null,
          type,
          value: type === 'free_shipping' ? 0 : parseNum(get('value')?.value),
          min_order: parseNum(get('min_order').value),
          max_discount: type === 'percent' ? parseNum(get('max_discount').value) : null,
          usage_limit: parseIntOrNull(get('usage_limit').value),
          per_phone_limit: parseIntOrNull(get('per_phone_limit').value),
          starts_raw: get('starts_at').value,
          ends_raw: get('ends_at').value,
          active: get('active').checked,
        };
      };

      const drawExample = () => {
        const v = read();
        const scopeStore = ctx.stores.find((s) => s.id === v.store_id) || null;
        const min = Number.isFinite(v.min_order) ? v.min_order || 0 : 0;
        const base = Math.max(EXAMPLE_SUBTOTAL, min);
        const baseLabel = base > EXAMPLE_SUBTOTAL ? html`<strong>${money(base)}</strong> (o pedido mínimo)` : html`<strong>${money(base)}</strong>`;
        let line;
        let pixLine = '';
        if (v.type === 'free_shipping') {
          line = html`Em um pedido de ${baseLabel} o frete sairia <strong>grátis</strong>.`;
        } else if (!(v.value > 0) || (v.type === 'percent' && v.value > 100)) {
          line = html`Informe o valor do desconto para ver um exemplo.`;
        } else {
          const d = discountFor({ ...v, min_order: min }, base);
          line = html`Em um pedido de ${baseLabel} o desconto seria <strong>${money(d.discount)}</strong>${d.capped ? ' (limitado ao desconto máximo)' : ''}.`;
          const pix = Number(scopeStore?.pix_discount_pct) || 0;
          if (pix > 0) {
            const total = Math.round((base - d.discount) * (1 - pix / 100) * 100) / 100;
            pixLine = html`<div class="small cp-example__pix">No PIX (−${pct(pix, Number.isInteger(pix) ? 0 : 1)} na ${scopeStore.name}, aplicado depois do cupom), o cliente pagaria ${money(total)} + frete.</div>`;
          }
        }
        render($('[data-example]', el), html`${icon('coupons')}<div>${line}${pixLine}</div>`);
      };

      const onType = () => {
        const type = get('type').value;
        const valueField = $('[data-value-field]', el);
        const current = get('value')?.value ?? '';
        valueField.hidden = type === 'free_shipping';
        if (type !== 'free_shipping') render($('[data-value-group]', el), valueGroup(type, current));
        $('[data-max-field]', el).hidden = type !== 'percent';
        drawExample();
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
        const taken = new Set(rows.map((r) => r.code));
        let code = randomCode();
        while (taken.has(code)) code = randomCode();
        get('code').value = code;
        get('code').removeAttribute('aria-invalid');
        get('code').focus();
      });
      form.addEventListener('input', drawExample);
      form.addEventListener('change', drawExample);
      drawExample();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = read();
        const errors = {};
        if (!v.code) errors.code = 'Informe o código';
        else if (!CODE_RE.test(v.code)) errors.code = v.code.length < 3 ? 'Código muito curto' : 'Código inválido';
        else {
          const dup = rows.find((r) => r.code === v.code && (r.store_id || null) === (v.store_id || null) && r.id !== coupon?.id);
          if (dup) errors.code = v.store_id ? 'Já existe um cupom com este código nesta loja' : 'Já existe um cupom da rede com este código';
        }
        if (!TYPES[v.type]) errors.type = 'Escolha o tipo';
        if (v.type !== 'free_shipping') {
          if (v.value === null) errors.value = 'Informe o valor';
          else if (!(v.value > 0)) errors.value = 'Valor inválido';
          else if (v.type === 'percent' && v.value > 100) errors.value = 'No máximo 100%';
          else if (v.value > 9999999) errors.value = 'Valor muito alto';
        }
        if (Number.isNaN(v.min_order) || (v.min_order !== null && v.min_order < 0)) errors.min_order = 'Valor inválido';
        if (v.type === 'percent' && v.max_discount !== null && (Number.isNaN(v.max_discount) || v.max_discount <= 0)) errors.max_discount = 'Valor inválido';
        if (Number.isNaN(v.usage_limit) || (v.usage_limit !== null && v.usage_limit < 1)) errors.usage_limit = 'Use um número inteiro a partir de 1';
        else if (editing && v.usage_limit !== null && v.usage_limit < (coupon.used_count || 0))
          errors.usage_limit = `O cupom já foi usado ${num(coupon.used_count)} vezes`;
        if (Number.isNaN(v.per_phone_limit) || (v.per_phone_limit !== null && v.per_phone_limit < 1)) errors.per_phone_limit = 'Use um número inteiro a partir de 1';
        const starts = fromLocalInput(v.starts_raw);
        const ends = fromLocalInput(v.ends_raw);
        if (starts === undefined) errors.starts_at = 'Data inválida';
        if (ends === undefined) errors.ends_at = 'Data inválida';
        if (starts && ends && new Date(ends) <= new Date(starts)) errors.ends_at = 'O fim precisa ser depois do início';
        else if (ends && !editing && new Date(ends).getTime() < Date.now()) errors.ends_at = 'Esta data já passou';
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
            const qy = editing
              ? sb.from('coupons').update(payload).eq('id', coupon.id).select()
              : sb.from('coupons').insert(payload).select();
            const data = await q(qy);
            if (!data?.length) throw new Error('Você não tem permissão para salvar este cupom.');
            return data[0];
          });
          toast(editing ? `Cupom ${saved.code} salvo.` : `Cupom ${saved.code} criado.`, 'success');
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
    body: html`<form class="form-grid" id="cp-test" novalidate>
      ${fixed
        ? html`<div class="field col-12"><span class="label">Loja</span><div class="cp-fixed">${icon('store', 'icon-sm')}<span>${ctx.storeName(fixed)}</span></div></div>`
        : html`<div class="field col-12"><label for="cpt-store">Loja *</label>
            <select class="select" id="cpt-store" name="store">${selectOptions([['', 'Escolha a loja'], ...ctx.stores.map((s) => [s.id, s.name])], sel)}</select></div>`}
      <div class="field col-6"><label for="cpt-code">Código *</label>
        <input class="input mono" id="cpt-code" name="code" value="${code}" autocomplete="off" autocapitalize="characters" spellcheck="false" ${code ? '' : 'autofocus'}></div>
      <div class="field col-6"><label for="cpt-sub">Valor dos produtos *</label>
        <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="cpt-sub" name="subtotal" inputmode="decimal" value="1000" ${code ? 'autofocus' : ''}></div></div>
      <div class="field col-12"><label for="cpt-phone">Telefone do cliente</label>
        <input class="input" id="cpt-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="Opcional — confere o limite por cliente"></div>
      <div class="col-12" data-test-result aria-live="polite"></div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Fechar</button>
      <button class="btn btn--primary" type="submit" form="cp-test" data-run>Testar</button>`,
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
        if (!fixed && !store) errors.store = 'Escolha a loja';
        if (!codeV) errors.code = 'Informe o código';
        if (subtotal === null || !(subtotal >= 0)) errors.subtotal = 'Valor inválido';
        if (phoneV && (phoneV.length < 10 || phoneV.length > 13)) errors.phone = 'Telefone inválido';
        if (!showErrors(form, errors)) return;
        const out = $('[data-test-result]', el);
        try {
          const res = await withBusy($('[data-run]', el), () =>
            rpc('validate_coupon', { p_store: store, p_code: codeV, p_subtotal: subtotal, p_phone: phoneV })
          );
          if (res?.valid) {
            const what = res.type === 'free_shipping' ? 'Frete grátis' : `Desconto de ${money(res.discount)}`;
            render(
              out,
              html`<div class="alert alert--success">${icon('check')}<div><strong>Cupom aceito · ${what}</strong>
                <div class="small">Produtos: ${money(subtotal)} → ${money(Math.max(0, subtotal - (Number(res.discount) || 0)))} antes do frete e do desconto PIX.${res.description ? ` ${res.description}` : ''}</div></div></div>`
            );
          } else {
            render(
              out,
              html`<div class="alert alert--warning">${icon('alert')}<div><strong>Cupom recusado</strong><div class="small">${res?.message || 'Cupom inválido.'}${
                /não encontrado/i.test(res?.message || '') ? ' Cupons inativos também aparecem assim.' : ''
              }</div></div></div>`
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
      title: 'Excluir cupom usado?',
      size: 'sm',
      body: html`<p>O cupom <strong class="mono">${c.code}</strong> já foi usado em ${num(c.used_count)} ${c.used_count === 1 ? 'pedido' : 'pedidos'}.</p>
        <p class="mt-2 muted">Recomendamos <strong>desativar</strong>: ele deixa de ser aceito e o histórico continua completo. Ao excluir, os pedidos mantêm só o código.</p>`,
      actions: html`<button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn--danger" type="button" data-choice="delete">Excluir mesmo assim</button>
        ${c.active ? html`<button class="btn btn--primary" type="button" data-choice="deactivate">Desativar</button>` : ''}`,
      onMount: (el, close) => {
        el.classList.add('cp-dialog');
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
    const network = !ctx.storeId;
    const st = { rows: [], chip: '', search: '', scope: '' };
    const canEdit = (c) => (c.store_id ? ctx.can('coupons', c.store_id) : ctx.isGlobal);
    const canCreate = ctx.isGlobal || ctx.can('coupons');
    const byId = (id) => st.rows.find((r) => r.id === id);

    ctx.setActions(
      canCreate
        ? html`<button class="btn btn--primary" type="button" data-cp-new aria-label="Novo cupom">${icon('plus')}<span class="cp-hide-sm">Novo cupom</span></button>`
        : ''
    );

    render(
      view,
      html`<div class="cp">
        <div class="toolbar cp-toolbar">
          <div class="search">
            ${icon('search')}
            <label class="visually-hidden" for="cp-q">Buscar cupons</label>
            <input class="input" id="cp-q" type="search" placeholder="Código ou descrição" autocomplete="off" enterkeyhint="search">
          </div>
          ${network
            ? html`<div class="cp-scope">
                <label class="visually-hidden" for="cp-scope">Abrangência</label>
                <select class="select" id="cp-scope" data-scope>${selectOptions(
                  [['', 'Rede e todas as lojas'], ['network', 'Só cupons da rede'], ...ctx.stores.map((s) => [s.id, s.name])],
                  ''
                )}</select>
              </div>`
            : ''}
          <button class="btn cp-test-btn" type="button" data-test>${icon('check')} Testar cupom</button>
        </div>
        <div class="chips cp-chips" data-chips role="group" aria-label="Filtrar por situação"></div>
        <div data-results aria-live="polite">${loading('Carregando cupons…')}</div>
      </div>`
    );
    const results = $('[data-results]', view);

    const visible = (withChip = true) => {
      const needle = fold(st.search.trim());
      return st.rows.filter((c) => {
        if (network && st.scope) {
          if (st.scope === 'network' ? c.store_id : c.store_id !== st.scope) return false;
        }
        if (needle && !fold(c.code).includes(needle) && !fold(c.description).includes(needle)) return false;
        return !withChip || matchesChip(c, st.chip);
      });
    };

    const drawChips = () => {
      const base = visible(false);
      render(
        $('[data-chips]', view),
        CHIPS.map(([k, label]) => {
          const count = base.filter((c) => matchesChip(c, k)).length;
          return html`<button class="chip ${st.chip === k ? 'is-active' : ''}" type="button" data-chip="${k}" aria-pressed="${st.chip === k ? 'true' : 'false'}">${label}<span class="chip__count">${num(count)}</span></button>`;
        })
      );
    };

    const row = (c) => {
      const editable = canEdit(c);
      const isNet = !c.store_id;
      return html`<tr class="${editable ? 'is-clickable' : ''} ${c.active ? '' : 'cp-off'}" data-id="${c.id}">
        <td class="cp-c-code">
          <div class="cp-code">
            <span class="cp-code__text mono">${c.code}</span>
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-copy="${c.code}" aria-label="Copiar código ${c.code}" title="Copiar código">${icon('copy', 'icon-sm')}</button>
          </div>
          ${!network && isNet ? html`<div class="mt-1">${badge('Rede', 'accent')}</div>` : ''}
        </td>
        <td class="cp-c-desc"><div class="cp-desc" title="${c.description || ''}">${c.description || html`<span class="faint">—</span>`}</div></td>
        ${network ? html`<td class="cp-c-store">${isNet ? badge('Rede', 'accent') : html`<span class="small">${ctx.storeName(c.store_id)}</span>`}</td>` : ''}
        <td class="cp-c-disc">${discountCell(c)}</td>
        <td class="num cp-c-min">${Number(c.min_order) > 0 ? money(c.min_order) : html`<span class="faint">—</span>`}</td>
        <td class="cp-c-uses">${usesCell(c)}</td>
        <td class="cp-c-valid">${validityCell(c)}</td>
        <td class="cp-c-active">
          <label class="switch cp-switch" title="${editable ? (c.active ? 'Desativar' : 'Ativar') : 'Gerenciado pela rede'}">
            <input type="checkbox" data-toggle="${c.id}" ${c.active ? 'checked' : ''} ${editable ? '' : 'disabled'}>
            <span class="switch__track"></span>
            <span class="visually-hidden">Cupom ${c.code} ativo</span>
          </label>
        </td>
        <td class="cp-c-actions">${editable
          ? html`<div class="cp-actions">
              <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit="${c.id}" aria-label="Editar cupom ${c.code}" title="Editar">${icon('edit', 'icon-sm')}</button>
              <button class="btn btn--ghost btn--sm btn--icon cp-del" type="button" data-del="${c.id}" aria-label="Excluir cupom ${c.code}" title="Excluir">${icon('trash', 'icon-sm')}</button>
            </div>`
          : html`<span class="muted small nowrap">Só leitura</span>`}</td>
      </tr>`;
    };

    const draw = () => {
      drawChips();
      const list = visible();
      const filtered = !!(st.search.trim() || st.chip || st.scope);
      if (!list.length) {
        render(
          results,
          html`<div class="table-wrap">${empty(
            filtered ? 'Nenhum cupom encontrado' : 'Nenhum cupom ainda',
            filtered ? 'Ajuste a busca ou os filtros.' : 'Crie cupons de desconto, valor fixo ou frete grátis para campanhas da loja.',
            filtered
              ? html`<button class="btn btn--sm" type="button" data-clear>Limpar filtros</button>`
              : canCreate
                ? html`<button class="btn btn--primary btn--sm" type="button" data-cp-new>${icon('plus', 'icon-sm')} Criar cupom</button>`
                : ''
          )}</div>`
        );
        return;
      }
      const hasReadonly = list.some((c) => !canEdit(c));
      render(
        results,
        html`<div class="table-wrap"><table class="table cp-table">
          <thead><tr>
            <th scope="col">Código</th>
            <th scope="col">Descrição</th>
            ${network ? html`<th scope="col">Loja</th>` : ''}
            <th scope="col">Desconto</th>
            <th scope="col" class="num" title="Pedido mínimo">Mínimo</th>
            <th scope="col">Usos</th>
            <th scope="col">Validade</th>
            <th scope="col">Ativo</th>
            <th scope="col"><span class="visually-hidden">Ações</span></th>
          </tr></thead>
          <tbody>${list.map(row)}</tbody>
        </table></div>
        <p class="muted small mt-2">${num(list.length)} ${list.length === 1 ? 'cupom' : 'cupons'}${
          hasReadonly ? ' · Cupons marcados com “Rede” valem em todas as lojas e são gerenciados pela administração da rede.' : ''
        }</p>`
      );
    };

    const load = async () => {
      try {
        let qy = sb.from('coupons').select('*').order('created_at', { ascending: false });
        if (!network) qy = qy.or(`store_id.eq.${ctx.storeId},store_id.is.null`);
        const rows = await q(qy);
        // na loja: cupons da loja primeiro, depois os da rede
        st.rows = network ? rows : [...rows.filter((r) => r.store_id), ...rows.filter((r) => !r.store_id)];
        draw();
      } catch (e) {
        render(results, html`${errorBlock(e)}<div class="mt-3"><button class="btn" type="button" data-retry>${icon('refresh')} Tentar de novo</button></div>`);
      }
    };

    const defaultStore = () => (network ? (st.scope && st.scope !== 'network' ? st.scope : null) : ctx.storeId);
    const openNew = () => openCouponForm(ctx, { rows: st.rows, defaultStore: defaultStore(), onSaved: load });
    const openEdit = (c) => openCouponForm(ctx, { coupon: c, rows: st.rows, onSaved: load });

    const remove = async (c, btn) => {
      let action = 'delete';
      if (c.used_count > 0) {
        action = await askDeleteUsed(c);
        if (!action) return;
      } else {
        const ok = await confirmDialog({
          title: 'Excluir cupom',
          message: `Excluir o cupom ${c.code}? Esta ação não pode ser desfeita.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        if (action === 'deactivate') {
          const data = await q(sb.from('coupons').update({ active: false }).eq('id', c.id).select('id'));
          if (!data?.length) throw new Error('Você não tem permissão para alterar este cupom.');
          toast(`Cupom ${c.code} desativado.`, 'success');
        } else {
          if (btn) btn.disabled = true;
          const data = await q(sb.from('coupons').delete().eq('id', c.id).select('id'));
          if (!data?.length) throw new Error('Você não tem permissão para excluir este cupom.');
          toast(`Cupom ${c.code} excluído.`, 'success');
        }
        await load();
      } catch (err) {
        if (btn?.isConnected) btn.disabled = false;
        toastError(err);
      }
    };

    /* ---------- Eventos ---------- */
    const actionsEl = $('[data-actions]');
    actionsEl?.querySelector('[data-cp-new]')?.addEventListener('click', openNew);

    const searchInput = $('#cp-q', view);
    searchInput.addEventListener(
      'input',
      debounce(() => {
        st.search = searchInput.value;
        draw();
      }, 200)
    );
    $('[data-scope]', view)?.addEventListener('change', (e) => {
      st.scope = e.target.value;
      draw();
    });

    view.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        st.chip = chip.dataset.chip;
        draw();
        return;
      }
      if (e.target.closest('[data-retry]')) {
        render(results, loading('Carregando cupons…'));
        load();
        return;
      }
      if (e.target.closest('[data-clear]')) {
        st.chip = '';
        st.search = '';
        st.scope = '';
        searchInput.value = '';
        const sc = $('[data-scope]', view);
        if (sc) sc.value = '';
        draw();
        return;
      }
      if (e.target.closest('[data-cp-new]')) return openNew();
      if (e.target.closest('[data-test]')) return openTester(ctx, { storeId: network && st.scope && st.scope !== 'network' ? st.scope : null });
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const ok = await copyText(copy.dataset.copy);
        toast(ok ? `Código ${copy.dataset.copy} copiado.` : 'Não foi possível copiar.', ok ? 'success' : 'error', 2200);
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
      // clique na linha (fora de botões e do interruptor) abre a edição
      if (e.target.closest('button, a, input, label, select')) return;
      const tr = e.target.closest('tr[data-id]');
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
        sw.closest('tr')?.classList.toggle('cp-off', !next);
        sw.closest('label')?.setAttribute('title', next ? 'Desativar' : 'Ativar');
        toast(next ? `Cupom ${c.code} ativado.` : `Cupom ${c.code} desativado.`, 'success', 2500);
        drawChips();
      } catch (err) {
        sw.checked = !next;
        toastError(err);
      } finally {
        sw.disabled = false;
      }
    });

    await load();
  },
};

const CSS = `
.cp-toolbar .search { max-width: 380px; }
.cp-scope .select { min-width: 220px; }
.cp-test-btn { margin-left: auto; }
.cp-chips { margin-bottom: 14px; }
.cp-table th, .cp-table td { padding: 10px; vertical-align: middle; }
.cp-table th:first-child, .cp-table td:first-child { padding-left: 14px; }
.cp-table th:last-child, .cp-table td:last-child { padding-right: 12px; }
.cp-code { display: flex; align-items: center; gap: 2px; }
.cp-code__text { display: inline-block; padding: 2px 8px; border: 1px dashed var(--line-strong); border-radius: 5px; background: var(--surface-2); color: var(--ink); font-weight: 700; letter-spacing: .4px; white-space: nowrap; }
.cp-desc { min-width: 140px; max-width: 240px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cp-c-store { min-width: 110px; max-width: 150px; }
.cp-validity { min-width: 110px; max-width: 170px; margin-bottom: 3px; line-height: 1.35; }
.cp-switch .switch__track { width: 34px; height: 20px; }
.cp-switch .switch__track::after { width: 14px; height: 14px; }
.cp-switch input:disabled + .switch__track { opacity: .5; cursor: not-allowed; }
.cp-actions { display: flex; justify-content: flex-end; gap: 2px; }
.cp-del { color: var(--danger); }
.cp-off .cp-code__text, .cp-off .cp-c-desc, .cp-off .cp-c-store, .cp-off .cp-c-disc, .cp-off .cp-c-min, .cp-off .cp-c-uses, .cp-off .cp-c-valid { opacity: .55; }
.cp-fixed { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 11px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); font-weight: 600; }
.cp-form .cp-code-input { text-transform: uppercase; letter-spacing: .4px; }
.cp-form .input-group .input { min-width: 0; }
.cp-form .input-group .btn { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin-left: -1px; }
.cp-example { display: flex; gap: 10px; padding: 12px 14px; border: 1px solid #c4d3f7; border-radius: var(--radius-sm); background: var(--info-soft); color: #1e3a8a; }
.cp-example .icon { margin-top: 1px; }
.cp-example__pix { margin-top: 2px; color: #334e9c; }
.cp-dialog .modal__foot { flex-wrap: wrap; }
.cp-hide-sm { display: inline; }
@media (max-width: 640px) {
  .cp-hide-sm { display: none; }
  .cp-toolbar .search { flex-basis: 100%; max-width: none; }
  .cp-scope { flex: 1; }
  .cp-scope .select { min-width: 0; }
  .cp-test-btn { margin-left: 0; }
  .cp-dialog .modal__foot .btn { flex: 1 1 auto; }
  /* tabela vira lista de cartões */
  .cp-table thead { display: none; }
  .cp-table, .cp-table tbody { display: block; }
  .cp-table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "code active" "desc desc" "disc min" "valid uses" "store actions"; gap: 10px 12px; padding: 14px; border-bottom: 1px solid var(--line); }
  .cp-table tbody tr:last-child { border-bottom: 0; }
  .cp-table th, .cp-table td, .cp-table td:first-child, .cp-table td:last-child { display: block; padding: 0; border: 0; min-width: 0; }
  .cp-c-code { grid-area: code; align-self: center; }
  .cp-c-active { grid-area: active; justify-self: end; align-self: center; }
  .cp-c-desc { grid-area: desc; }
  .cp-desc { min-width: 0; max-width: none; }
  .cp-c-disc { grid-area: disc; }
  .cp-c-min { grid-area: min; }
  .cp-c-valid { grid-area: valid; }
  .cp-validity { max-width: none; }
  .cp-c-uses { grid-area: uses; text-align: right; }
  .cp-c-store { grid-area: store; align-self: center; max-width: none; }
  .cp-c-actions { grid-area: actions; justify-self: end; align-self: center; }
  .cp-c-min::before, .cp-c-uses::before { display: block; font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--muted); }
  .cp-c-min::before { content: 'Mínimo'; }
  .cp-c-uses::before { content: 'Usos'; }
}
`;
