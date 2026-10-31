// Carrinho (um por loja), favoritos, finalização do pedido e acompanhamento.
// Preços, estoque, raio e frete são recalculados pelo banco no place_order: aqui é só a prévia.
import { $, $$, esc, icon, brl, km, plural, picture, digits, fmtCep, fmtPhone, fmtDateTime, cpfValid, haversine, rpc, bizMessage, toast, storage, waLink } from './lib.js';
import { S, on, emit, pixPct, hasPix, displayPrice, installments, deliveryStatus, setLocation, storeWhatsapp, storeAddress } from './state.js';
import { openDrawer, openSheet, closeSheet } from './layers.js';
import { resolveCep, resolveGps, updateStoreUI } from './picker.js';
import { productUrl, refreshWishButtons } from './catalog.js';

const MAX_QTY = 20;
const clampQty = (n) => Math.max(1, Math.min(MAX_QTY, Math.round(Number(n) || 1)));
const cartKey = () => `atual:cart:${S.store.id}`;
const wishKey = () => `atual:wish:${S.store.id}`;

/* ---------- Estado ---------- */
export function loadCart() {
  const raw = storage.get(cartKey(), []);
  S.cart = (Array.isArray(raw) ? raw : [])
    .filter((l) => S.byId[l.id] && (!l.variant || S.byId[l.id].variants.some((v) => v.id === l.variant)))
    .map((l) => ({ id: l.id, variant: l.variant || null, qty: clampQty(l.qty) }));
  const w = storage.get(wishKey(), []);
  S.wish = (Array.isArray(w) ? w : []).filter((id) => S.byId[id]);
  co.coupon = null;
  co.couponCode = '';
  co.quote = null;
  renderCart();
  renderWishlist();
}

const saveCart = () => storage.set(cartKey(), S.cart);

function lineInfo(l) {
  const p = S.byId[l.id];
  const v = l.variant ? p.variants.find((x) => x.id === l.variant) : null;
  const unit = Number(v ? v.price : p.price);
  return { p, v, unit, total: unit * l.qty, img: v?.image_url || p.image_url };
}

export const cartCount = () => S.cart.reduce((s, l) => s + l.qty, 0);
export const cartSubtotal = () => Math.round(S.cart.reduce((s, l) => s + lineInfo(l).total, 0) * 100) / 100;
const allFreeShipping = () => S.cart.length > 0 && S.cart.every((l) => S.byId[l.id]?.free_shipping);

function announce(msg) {
  const st = $('[data-cart-status]');
  if (st) {
    st.textContent = '';
    setTimeout(() => (st.textContent = msg), 30);
  }
}

export function addToCart({ id, variant = null, qty = 1, open = true, checkout = false }) {
  const p = S.byId[id];
  if (!p) return toast('Produto não disponível nesta loja.');
  const v = variant ? p.variants.find((x) => x.id === variant) : null;
  if (!(v ? v.in_stock : p.in_stock)) return toast(v ? `A cor ${v.name} está esgotada.` : 'Produto esgotado nesta loja.');
  const line = S.cart.find((l) => l.id === id && (l.variant || null) === (variant || null));
  if (line) line.qty = clampQty(line.qty + qty);
  else S.cart.push({ id, variant: variant || null, qty: clampQty(qty) });
  saveCart();
  renderCart();
  announce(`${p.name}${v ? ` (${v.name})` : ''} adicionado ao carrinho. ${plural(cartCount(), 'item', 'itens')} no carrinho.`);
  if (checkout) openCheckout();
  else if (open) openDrawer('cart-drawer');
  else toast('Adicionado ao carrinho');
}

function setQty(idx, qty) {
  const l = S.cart[idx];
  if (!l) return;
  if (qty <= 0) {
    const { p } = lineInfo(l);
    S.cart.splice(idx, 1);
    announce(`${p.name} removido do carrinho.`);
  } else l.qty = clampQty(qty);
  saveCart();
  renderCart();
}

export function toggleWish(id) {
  const p = S.byId[id];
  if (!p) return;
  const had = S.wish.includes(id);
  S.wish = had ? S.wish.filter((x) => x !== id) : [...S.wish, id];
  storage.set(wishKey(), S.wish);
  renderWishlist();
  refreshWishButtons();
  toast(had ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
}

/* ---------- Gaveta do carrinho ---------- */
function setBubble(sel, n, label) {
  const b = $(sel);
  if (!b) return;
  b.textContent = n;
  b.hidden = !n;
  const btn = b.closest('button');
  if (btn) btn.setAttribute('aria-label', n ? `${label} (${plural(n, 'item', 'itens')})` : label);
}

function shipBar(sub) {
  const min = S.store.free_shipping_min;
  if (min == null || Number(min) <= 0) return '';
  if (allFreeShipping()) return '<div class="ship"><strong>Frete grátis</strong> para os produtos do seu carrinho, dentro do raio de entrega da loja.</div>';
  const missing = Math.max(0, Number(min) - sub);
  const pct = Math.min(100, (sub / Number(min)) * 100);
  return `<div class="ship">
    ${missing > 0 ? `Faltam <strong>${brl(missing)}</strong> para ganhar frete grátis*` : '<strong>Você ganhou frete grátis!</strong>*'}
    <div class="ship__bar" role="progressbar" aria-label="Progresso para o frete grátis" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>
  </div>`;
}

function lineHTML(l, i) {
  const { p, v, total, img } = lineInfo(l);
  const label = `${p.name}${v ? ` — ${v.name}` : ''}`;
  return `<div class="line">
    <a class="line__img" href="${esc(productUrl(p))}" data-product="${esc(p.slug)}" tabindex="-1" aria-hidden="true">${picture(img)}</a>
    <div>
      <div class="line__top">
        <p class="line__name"><a href="${esc(productUrl(p))}" data-product="${esc(p.slug)}">${esc(p.name)}</a>${v ? `<br><small class="muted">Cor: ${esc(v.name)}</small>` : ''}</p>
        <button class="line__remove" type="button" aria-label="Remover ${esc(label)}" data-line-remove="${i}">${icon('i-trash')}</button>
      </div>
      <div class="line__bottom">
        <div class="qty" role="group" aria-label="Quantidade de ${esc(label)}">
          <button type="button" aria-label="Diminuir quantidade" data-line-qty="${i}" data-delta="-1">${icon('i-minus')}</button>
          <span>${l.qty}</span>
          <button type="button" aria-label="Aumentar quantidade" data-line-qty="${i}" data-delta="1" ${l.qty >= MAX_QTY ? 'disabled' : ''}>${icon('i-plus')}</button>
        </div>
        <span class="line__price">${brl(displayPrice(total))}${hasPix() ? ' <small>no PIX</small>' : ''}</span>
      </div>
    </div>
  </div>`;
}

function closedNotice() {
  return `<div class="notice notice--warn">${icon('i-store')}<div>${esc(S.store.closed_message || 'Esta loja não está recebendo pedidos pelo site agora.')} <a class="link" href="${esc(
    waLink(storeWhatsapp(), `Olá! Quero fazer um pedido na ${S.store.name}.`)
  )}" target="_blank" rel="noopener">Fale pelo WhatsApp</a>.</div></div>`;
}

export function renderCart() {
  const count = cartCount();
  setBubble('[data-cart-count]', count, 'Carrinho');
  const el = $('[data-cart]');
  if (!el || !S.store) return;
  const head = `<div class="cart__head">
      <h2 class="cart__title">Seu carrinho</h2>
      <span class="cart__count">${count ? plural(count, 'item', 'itens') : ''}</span>
      <button class="drawer__close" type="button" aria-label="Fechar carrinho" data-close>${icon('i-close')}</button>
    </div>`;
  if (!S.cart.length) {
    el.innerHTML = `${head}<div class="cart__body"><div class="cart-empty">
        <span class="cart-empty__icon">${icon('i-cart')}</span>
        <p class="cart-empty__title">O carrinho está vazio</p>
        <button class="btn-checkout" type="button" data-close>CONTINUAR COMPRANDO ${icon('i-arrow')}</button>
      </div></div>`;
    return;
  }
  const sub = cartSubtotal();
  const pix = displayPrice(sub);
  const inst = installments(sub);
  const ds = deliveryStatus();
  const inCart = new Set(S.cart.map((l) => l.id));
  const pool = S.colls.find((c) => c.key === 'queridinhos')?.product_ids || [];
  const recs = [...pool, ...S.products.map((p) => p.id)]
    .filter((id, i, a) => a.indexOf(id) === i && !inCart.has(id) && S.byId[id]?.in_stock)
    .slice(0, 3)
    .map((id) => S.byId[id]);
  const minOrder = Number(S.store.min_order_value || 0);
  el.innerHTML = `${head}
    <div class="cart__body">
      <p class="small muted" style="margin:0 0 10px">Pedido na <strong>${esc(S.store.name)}</strong> · entrega em até ${km(S.store.delivery_radius_km)} da loja</p>
      ${shipBar(sub)}
      ${S.cart.map(lineHTML).join('')}
      ${
        recs.length
          ? `<div class="upsell"><p class="upsell__title">Complete seu ambiente!</p><div class="upsell__list">${recs
              .map(
                (p) => `<div class="upsell__item">
                  <span class="upsell__img">${picture(p.image_url)}</span>
                  <div><p class="upsell__name">${esc(p.name)}</p><p class="upsell__price">${brl(displayPrice(p.price))}${hasPix() ? ' <small>no PIX</small>' : ''}</p></div>
                  <button class="upsell__btn" type="button" data-add="${esc(p.id)}" aria-label="Levar ${esc(p.name)}">Levar</button>
                </div>`
              )
              .join('')}</div></div>`
          : ''
      }
    </div>
    <div class="cart__foot">
      <div class="cart__row"><span>Subtotal</span><span>${brl(sub)}</span></div>
      <div class="cart__row"><span>Entrega</span><span>${ds.known && ds.within ? 'Calculada no próximo passo' : 'Informe o CEP no próximo passo'}</span></div>
      <div class="cart__total"><span>${hasPix() ? 'Total no PIX' : 'Total'}</span><strong>${brl(pix)}</strong></div>
      <p class="cart__installments">${hasPix() ? `ou <strong>${brl(sub)}</strong> ` : ''}${inst.n > 1 ? `em até <strong>${inst.n}x de ${brl(inst.value)}</strong> sem juros` : ''}</p>
      ${ds.known && !ds.within ? `<p class="notice notice--warn" style="margin-bottom:10px">${icon('i-pin')}<span>Seu endereço salvo fica fora do raio desta loja. <button class="link" type="button" data-open-picker>Trocar de loja</button></span></p>` : ''}
      ${minOrder > 0 && sub < minOrder ? `<p class="notice notice--warn" style="margin-bottom:10px">Pedido mínimo de ${brl(minOrder)} nesta loja.</p>` : ''}
      ${
        S.store.accepts_orders
          ? `<button class="btn-checkout" type="button" data-checkout ${minOrder > 0 && sub < minOrder ? 'disabled aria-disabled="true"' : ''}>${icon('i-lock')} FINALIZAR PEDIDO</button>`
          : closedNotice()
      }
      <button class="cart__continue" type="button" data-close>Continuar comprando</button>
    </div>`;
}

export function renderWishlist() {
  const n = S.wish.length;
  setBubble('[data-wishlist-count]', n, 'Favoritos');
  const el = $('[data-wishlist]');
  if (!el || !S.store) return;
  el.innerHTML = `
    <div class="cart__head">
      <h2 class="cart__title">Favoritos</h2>
      <span class="cart__count">${n ? plural(n, 'item', 'itens') : ''}</span>
      <button class="drawer__close" type="button" aria-label="Fechar favoritos" data-close>${icon('i-close')}</button>
    </div>
    <div class="cart__body">${
      n
        ? S.wish
            .map((id) => S.byId[id])
            .map(
              (p) => `<div class="line">
                <a class="line__img" href="${esc(productUrl(p))}" data-product="${esc(p.slug)}" tabindex="-1" aria-hidden="true">${picture(p.image_url)}</a>
                <div>
                  <div class="line__top">
                    <p class="line__name"><a href="${esc(productUrl(p))}" data-product="${esc(p.slug)}">${esc(p.name)}</a></p>
                    <button class="line__remove" type="button" aria-label="Remover ${esc(p.name)} dos favoritos" data-wish="${esc(p.id)}">${icon('i-trash')}</button>
                  </div>
                  <div class="line__bottom">
                    ${p.in_stock ? `<button class="upsell__btn" type="button" data-add="${esc(p.id)}" aria-label="Levar ${esc(p.name)}">Levar</button>` : '<span class="badge badge--soldout">Esgotado</span>'}
                    <span class="line__price">${brl(displayPrice(p.price))}${hasPix() ? ' <small>no PIX</small>' : ''}</span>
                  </div>
                </div>
              </div>`
            )
            .join('')
        : `<div class="cart-empty">
            <span class="cart-empty__icon">${icon('i-heart')}</span>
            <p class="cart-empty__title">Sua lista de favoritos está vazia</p>
            <button class="btn-checkout" type="button" data-close>Continuar comprando ${icon('i-arrow')}</button>
          </div>`
    }</div>`;
}

/* ---------- Finalização do pedido ---------- */
const PAY = {
  pix: { title: 'PIX', desc: () => `${pixPct() > 0 ? `${String(pixPct()).replace('.', ',')}% de desconto. ` : ''}A chave PIX da loja aparece ao finalizar o pedido.` },
  card_on_delivery: { title: 'Cartão na entrega', desc: () => 'Crédito ou débito na maquininha, na hora da entrega.' },
  card_link: { title: 'Link de pagamento', desc: () => 'A loja envia pelo WhatsApp um link seguro para pagar com cartão.' },
  cash: { title: 'Dinheiro na entrega', desc: () => 'Pague ao receber. Informe se precisa de troco.' },
  crediario: { title: 'Crediário da loja', desc: () => 'A loja entra em contato para a análise do cadastro.' },
};
const PAY_LABEL = (m) => PAY[m]?.title || m;
const STATUS = {
  pending: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Em separação',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  canceled: 'Cancelado',
};
const PAY_STATUS = { pending: 'Pagamento pendente', paid: 'Pago', refunded: 'Estornado', failed: 'Não aprovado' };

const blankAddr = () => ({ cep: '', street: '', number: '', complement: '', district: '', city: '', state: '', reference: '', lat: null, lng: null, precision: '' });
const co = {
  step: 1,
  addr: blankAddr(),
  geoKey: '',
  gpsLocked: false, // coordenadas vieram do GPS do aparelho (mais precisas que o CEP)
  quote: null,
  customer: { name: '', phone: '', email: '', cpf: '' },
  method: null,
  installments: 1,
  change: '',
  notes: '',
  coupon: null,
  couponCode: '',
  busy: false,
  status: '',
  result: null,
};

const addrKey = (a) => `${digits(a.cep)}|${String(a.number).trim().toLowerCase()}|${String(a.street).trim().toLowerCase()}`;

function totals() {
  const sub = cartSubtotal();
  const disc = co.coupon?.valid ? Number(co.coupon.discount || 0) : 0;
  const pix = co.method === 'pix' ? Math.round((sub - disc) * pixPct()) / 100 : 0;
  let fee = co.quote?.within_radius ? Number(co.quote.fee || 0) : null;
  if (co.coupon?.valid && co.coupon.type === 'free_shipping') fee = 0;
  const total = Math.max(0, sub - disc - pix + (fee || 0));
  return { sub, disc, pix, fee, total };
}

function summaryHTML() {
  const t = totals();
  const inst = installments(t.sub - t.disc);
  return `<h3>Resumo do pedido</h3>
    <div class="summary__items">${S.cart
      .map((l) => {
        const { p, v, total, img } = lineInfo(l);
        return `<div class="summary__item"><span class="summary__thumb">${picture(img)}<span class="summary__qty">${l.qty}</span></span><span>${esc(p.name)}${v ? `<br><small class="muted">${esc(v.name)}</small>` : ''}</span><span>${brl(total)}</span></div>`;
      })
      .join('')}</div>
    ${
      co.step === 3
        ? `<form class="coupon" data-coupon novalidate>
            <label class="visually-hidden" for="co-coupon">Cupom de desconto</label>
            <input class="f-input" id="co-coupon" name="code" placeholder="Cupom de desconto" value="${esc(co.couponCode)}" autocomplete="off" ${co.coupon?.valid ? 'readonly' : ''}>
            ${co.coupon?.valid ? '<button class="btn btn--outline btn--sm" type="button" data-coupon-remove>Remover</button>' : '<button class="btn btn--outline btn--sm" type="submit">Aplicar</button>'}
          </form>
          ${co.coupon && !co.coupon.valid ? `<p class="f-error" role="alert">${esc(co.coupon.message || 'Cupom inválido')}</p>` : ''}`
        : ''
    }
    <div class="summary__rows">
      <div><span>Subtotal</span><span>${brl(t.sub)}</span></div>
      ${t.disc > 0 ? `<div class="is-discount"><span>Cupom ${esc(co.coupon.code || '')}</span><span>− ${brl(t.disc)}</span></div>` : ''}
      ${t.pix > 0 ? `<div class="is-discount"><span>Desconto PIX (${String(pixPct()).replace('.', ',')}%)</span><span>− ${brl(t.pix)}</span></div>` : ''}
      <div><span>Entrega${co.quote?.within_radius ? ` (${km(co.quote.distance_km)})` : ''}</span><span>${t.fee === null ? 'Informe o endereço' : t.fee === 0 ? 'Grátis' : brl(t.fee)}</span></div>
      <div class="summary__total"><span>Total</span><span>${brl(t.total)}</span></div>
      ${co.method === 'card_on_delivery' || co.method === 'card_link' ? `<div class="small muted"><span>em ${co.installments}x de ${brl(t.total / co.installments)} sem juros</span></div>` : ''}
      ${!co.method && hasPix() && inst.n > 1 ? `<div class="small muted"><span>No cartão em até ${inst.n}x sem juros</span></div>` : ''}
    </div>
    <p class="summary__store">${icon('i-store', 'inline-ico')} Vendido e entregue por <strong>${esc(S.store.name)}</strong><br>${esc(storeAddress())}${S.store.delivery_lead_time ? `<br>${esc(S.store.delivery_lead_time)}` : ''}</p>`;
}

function field(id, label, value, { cls = 's6', type = 'text', attrs = '', hint = '' } = {}) {
  return `<div class="f-field ${cls}"><label class="f-label" for="${id}">${label}</label><input class="f-input" id="${id}" type="${type}" value="${esc(value ?? '')}" ${attrs}>${hint ? `<span class="f-hint">${hint}</span>` : ''}<span class="f-error" data-err-for="${id}" hidden></span></div>`;
}

function deliveryNotice() {
  const q = co.quote;
  if (!q) return '';
  if (!q.within_radius) {
    return `<div class="notice notice--error" role="alert">${icon('i-pin')}<div>Este endereço fica a <strong>${km(q.distance_km)}</strong> da ${esc(S.store.name)}, fora do raio de entrega de ${km(q.radius_km)}.<br><button class="link" type="button" data-open-picker>Ver a loja que atende este endereço</button></div></div>`;
  }
  return `<div class="notice notice--ok">${icon('i-check')}<div>Entregamos neste endereço · ${km(q.distance_km)} da loja · <strong>${Number(q.fee) === 0 ? 'frete grátis' : `frete ${brl(q.fee)}`}</strong>${
    co.addr.precision === 'city' ? '<br><small>Localizamos só a cidade deste CEP; a distância é aproximada e a loja confirma na entrega.</small>' : ''
  }</div></div>`;
}

function stepHTML() {
  const a = co.addr;
  const c = co.customer;
  if (co.step === 1) {
    return `<form data-co-form="1" novalidate>
      <h3>Endereço de entrega</h3>
      <div class="co-geo"><button class="btn btn--outline btn--sm" type="button" data-co-gps>${icon('i-locate')} Usar minha localização</button><span class="small muted">A loja entrega em até ${km(S.store.delivery_radius_km)}.</span></div>
      <div class="f-grid">
        ${field('co-cep', 'CEP', fmtCep(a.cep), { cls: 's2 m3', attrs: 'inputmode="numeric" autocomplete="postal-code" maxlength="9" required data-cep' })}
        ${field('co-number', 'Número', a.number, { cls: 's2 m3', attrs: 'autocomplete="address-line2" required' })}
        ${field('co-complement', 'Complemento', a.complement, { cls: 's2', attrs: 'placeholder="Apto, bloco, casa…"' })}
        ${field('co-street', 'Rua / avenida', a.street, { cls: 's4', attrs: 'autocomplete="address-line1" required' })}
        ${field('co-district', 'Bairro', a.district, { cls: 's2' })}
        ${field('co-city', 'Cidade', a.city, { cls: 's4 m3', attrs: 'autocomplete="address-level2" required' })}
        ${field('co-state', 'UF', a.state, { cls: 's2 m3', attrs: 'autocomplete="address-level1" maxlength="2" required style="text-transform:uppercase"' })}
        ${field('co-reference', 'Ponto de referência', a.reference, { attrs: 'placeholder="Opcional"' })}
      </div>
      <div data-co-delivery role="status" style="margin-top:14px">${deliveryNotice()}</div>
      <div data-co-status role="alert">${co.status}</div>
      <div class="co-actions">
        <button class="btn btn--outline" type="button" data-sheet-close>Voltar à loja</button>
        <button class="btn btn--primary" type="submit" ${co.busy ? 'disabled' : ''}>${co.busy ? '<span class="spinner"></span> Verificando…' : 'Continuar'}</button>
      </div>
    </form>`;
  }
  if (co.step === 2) {
    return `<form data-co-form="2" novalidate>
      <h3>Seus dados</h3>
      <div class="f-grid">
        ${field('co-name', 'Nome completo', c.name, { attrs: 'autocomplete="name" required minlength="3" maxlength="120"' })}
        ${field('co-phone', 'WhatsApp / celular', fmtPhone(c.phone), { cls: 's3', type: 'tel', attrs: 'autocomplete="tel-national" inputmode="tel" required data-phone', hint: 'A loja confirma o pedido por aqui.' })}
        ${field('co-email', 'E-mail', c.email, { cls: 's3', type: 'email', attrs: 'autocomplete="email" placeholder="Opcional"' })}
        ${field('co-cpf', 'CPF', c.cpf, { cls: 's3', attrs: 'inputmode="numeric" maxlength="14" placeholder="Opcional" data-cpf', hint: 'Para nota fiscal e crediário.' })}
        <div class="f-field"><label class="f-label" for="co-notes">Observações para a loja</label><textarea class="f-textarea" id="co-notes" rows="3" maxlength="800" placeholder="Melhor horário para entrega, montagem, etc.">${esc(co.notes)}</textarea></div>
      </div>
      <div data-co-status role="alert">${co.status}</div>
      <div class="co-actions">
        <button class="btn btn--outline" type="button" data-co-back>Voltar</button>
        <button class="btn btn--primary" type="submit">Continuar</button>
      </div>
    </form>`;
  }
  const methods = (S.store.payment_methods || []).filter((m) => PAY[m]);
  const t = totals();
  const inst = installments(t.sub - t.disc);
  return `<form data-co-form="3" novalidate>
    <h3>Pagamento</h3>
    <p class="small muted" style="margin:-6px 0 14px">Você não paga nada agora: a loja confirma o pedido pelo WhatsApp e o pagamento é feito ${methods.includes('pix') ? 'por PIX ou ' : ''}na entrega.</p>
    <fieldset class="pay-opts"><legend class="visually-hidden">Forma de pagamento</legend>
      ${methods
        .map(
          (m) => `<label class="pay-opt">
            <input type="radio" name="method" value="${m}" ${co.method === m ? 'checked' : ''}>
            <span class="pay-opt__body">
              <span class="pay-opt__title"><span>${PAY[m].title}</span>${m === 'pix' && pixPct() > 0 ? `<span>${brl(Math.max(0, t.sub - t.disc - Math.round((t.sub - t.disc) * pixPct()) / 100 + (t.fee || 0)))}</span>` : ''}</span>
              <span class="pay-opt__desc">${esc(PAY[m].desc())}</span>
              ${
                co.method === m && (m === 'card_on_delivery' || m === 'card_link') && inst.n > 1
                  ? `<span class="pay-opt__extra"><label class="f-label" for="co-inst">Parcelas</label><select class="f-select" id="co-inst" data-inst>${Array.from({ length: inst.n }, (_, i) => i + 1)
                      .map((n) => `<option value="${n}" ${n === co.installments ? 'selected' : ''}>${n}x de ${brl(t.total / n)} sem juros</option>`)
                      .join('')}</select></span>`
                  : ''
              }
              ${co.method === m && m === 'cash' ? `<span class="pay-opt__extra"><label class="f-label" for="co-change">Troco para quanto?</label><input class="f-input" id="co-change" inputmode="decimal" placeholder="Deixe em branco se não precisar" value="${esc(co.change)}" data-change></span>` : ''}
            </span>
          </label>`
        )
        .join('')}
    </fieldset>
    <div data-co-status role="alert">${co.status}</div>
    <p class="small muted" style="margin-top:12px">Entrega em: ${esc(`${co.addr.street}, ${co.addr.number}${co.addr.complement ? ` — ${co.addr.complement}` : ''} · ${co.addr.city} - ${co.addr.state}`)} · <button class="link" type="button" data-co-goto="1">alterar</button></p>
    <div class="co-actions">
      <button class="btn btn--outline" type="button" data-co-back>Voltar</button>
      <button class="btn btn--primary" type="submit" ${co.busy ? 'disabled' : ''}>${co.busy ? '<span class="spinner"></span> Enviando…' : `${icon('i-lock')} Confirmar pedido`}</button>
    </div>
  </form>`;
}

function successHTML() {
  const r = co.result;
  const st = { ...(r.store || {}) };
  st.whatsapp = st.whatsapp || S.net.support_whatsapp || '';
  const isPix = r.payment_method === 'pix';
  const trackUrl = `${location.origin}/pedido/${r.tracking_token}`;
  const msg = `Olá, ${st.name}! Acabei de fazer o pedido ${r.code} pelo site.\nTotal: ${brl(r.total)} (${PAY_LABEL(r.payment_method)}${r.installments > 1 ? ` em ${r.installments}x` : ''}).\nAcompanhar: ${trackUrl}`;
  return `<div class="success">
    <span class="success__icon">${icon('i-check')}</span>
    <h3>Pedido recebido!</h3>
    <span class="success__code">${esc(r.code)}</span>
    <p class="muted">A ${esc(st.name)} vai confirmar o pedido e combinar a entrega pelo WhatsApp${st.lead_time ? `. ${esc(st.lead_time)}` : ''}.</p>
    <div class="success__box">
      <div class="summary__rows" style="border:0;padding:0">
        <div><span>Subtotal</span><span>${brl(r.subtotal)}</span></div>
        ${Number(r.discount_coupon) > 0 ? `<div class="is-discount"><span>Cupom</span><span>− ${brl(r.discount_coupon)}</span></div>` : ''}
        ${Number(r.discount_pix) > 0 ? `<div class="is-discount"><span>Desconto PIX</span><span>− ${brl(r.discount_pix)}</span></div>` : ''}
        <div><span>Entrega (${km(r.distance_km)})</span><span>${Number(r.delivery_fee) === 0 ? 'Grátis' : brl(r.delivery_fee)}</span></div>
        <div class="summary__total"><span>Total · ${esc(PAY_LABEL(r.payment_method))}${r.installments > 1 ? ` em ${r.installments}x` : ''}</span><span>${brl(r.total)}</span></div>
      </div>
      ${
        isPix
          ? st.pix_key
            ? `<p style="margin-top:14px"><strong>Pague com PIX</strong>${st.pix_holder ? ` · favorecido: ${esc(st.pix_holder)}` : ''}</p>
               <div class="pix-key"><span data-pix-key>${esc(st.pix_key)}</span><button class="btn btn--outline btn--sm" type="button" data-copy-pix>${icon('i-copy')} Copiar</button></div>
               <p class="small muted" style="margin-top:8px">Envie o comprovante pelo WhatsApp da loja informando o código ${esc(r.code)}.</p>`
            : '<p style="margin-top:14px">A loja envia a chave PIX pelo WhatsApp ao confirmar o pedido.</p>'
          : ''
      }
    </div>
    <div class="success__actions">
      ${st.whatsapp ? `<a class="btn btn--whats btn--block" href="${esc(waLink(st.whatsapp, msg))}" target="_blank" rel="noopener">${icon('i-whatsapp')} Enviar pedido no WhatsApp da loja</a>` : ''}
      <a class="btn btn--outline btn--block" href="/pedido/${esc(r.tracking_token)}" data-track-token="${esc(r.tracking_token)}">Acompanhar pedido</a>
      <button class="btn btn--dark btn--block" type="button" data-sheet-close>Continuar comprando</button>
    </div>
    <p class="small muted" style="margin-top:12px">Guarde o link de acompanhamento: <a class="link" href="/pedido/${esc(r.tracking_token)}" data-track-token="${esc(r.tracking_token)}">${esc(trackUrl)}</a></p>
  </div>`;
}

function renderCheckout() {
  const el = $('#checkout-sheet');
  if (co.result) {
    el.innerHTML = `<div class="sheet__head"><h2 class="sheet__title">Pedido ${esc(co.result.code)}</h2><button class="sheet__close" type="button" aria-label="Fechar" data-sheet-close>${icon('i-close')}</button></div>
      <div class="sheet__body">${successHTML()}</div>`;
    return;
  }
  const steps = ['Entrega', 'Seus dados', 'Pagamento'];
  el.innerHTML = `<div class="sheet__head"><h2 class="sheet__title">Finalizar pedido</h2><button class="sheet__close" type="button" aria-label="Fechar" data-sheet-close>${icon('i-close')}</button></div>
    <div class="sheet__body">
      <div class="checkout">
        <div>
          <ol class="steps" aria-label="Etapas">${steps
            .map((s, i) => `<li class="${i + 1 === co.step ? 'is-active' : i + 1 < co.step ? 'is-done' : ''}" ${i + 1 === co.step ? 'aria-current="step"' : ''}><span>${i + 1 < co.step ? '✓' : i + 1}</span>${s}</li>`)
            .join('')}</ol>
          <div class="co-step" data-co-step>${stepHTML()}</div>
        </div>
        <aside class="summary" data-co-summary aria-label="Resumo do pedido">${summaryHTML()}</aside>
      </div>
    </div>`;
}

const renderSummary = () => {
  const s = $('[data-co-summary]');
  if (s) s.innerHTML = summaryHTML();
};

function goStep(n, focus = true) {
  co.step = n;
  co.status = '';
  renderCheckout();
  const body = $('#checkout-sheet .sheet__body');
  if (body) body.scrollTop = 0;
  if (focus) requestAnimationFrame(() => $('#checkout-sheet [data-co-step] input, #checkout-sheet [data-co-step] select')?.focus({ preventScroll: true }));
}

export function openCheckout() {
  if (!S.cart.length) return toast('Seu carrinho está vazio.');
  if (!S.store.accepts_orders) {
    openDrawer('cart-drawer');
    return;
  }
  // "Comprar agora" saindo da página do produto: tira o ?produto da URL
  const url = new URL(location.href);
  if (url.searchParams.has('produto')) {
    url.searchParams.delete('produto');
    history.replaceState(history.state, '', url.pathname + url.search);
  }
  co.result = null;
  co.status = '';
  co.busy = false;
  co.customer = { ...co.customer, ...storage.get('atual:customer', {}) };
  if (S.loc && !co.addr.cep && co.addr.lat == null) {
    const l = S.loc;
    co.addr = { ...blankAddr(), cep: l.cep || '', street: l.street || '', number: l.number || '', district: l.district || '', city: l.city || '', state: l.state || '', lat: l.lat, lng: l.lng, precision: l.precision || '' };
    co.gpsLocked = l.precision === 'gps';
    co.geoKey = addrKey(co.addr);
  }
  if (!co.method) co.method = (S.store.payment_methods || []).includes('pix') ? 'pix' : (S.store.payment_methods || [])[0] || null;
  co.step = 1;
  renderCheckout();
  if (co.addr.lat != null) refreshQuote().then(() => {
    const box = $('[data-co-delivery]');
    if (box) box.innerHTML = deliveryNotice();
    renderSummary();
  });
  openSheet('checkout-sheet', {
    onClose: () => {
      if (co.result) {
        co.result = null;
        co.step = 1;
      }
    },
  });
}

async function refreshQuote() {
  if (co.addr.lat == null) {
    co.quote = null;
    return null;
  }
  try {
    co.quote = await rpc('quote_delivery', { p_store: S.store.id, p_lat: co.addr.lat, p_lng: co.addr.lng, p_subtotal: cartSubtotal(), p_all_free: allFreeShipping() });
  } catch {
    co.quote = null;
  }
  return co.quote;
}

function readStep1(form) {
  const v = (id) => $(`#${id}`, form).value.trim();
  Object.assign(co.addr, {
    cep: digits(v('co-cep')),
    number: v('co-number'),
    complement: v('co-complement'),
    street: v('co-street'),
    district: v('co-district'),
    city: v('co-city'),
    state: v('co-state').toUpperCase(),
    reference: v('co-reference'),
  });
}

function showFieldErrors(form, errors) {
  $$('[data-err-for]', form).forEach((e) => {
    e.hidden = true;
    e.textContent = '';
  });
  $$('.f-input[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  let first = null;
  Object.entries(errors).forEach(([id, msg]) => {
    const input = $(`#${id}`, form);
    const err = $(`[data-err-for="${id}"]`, form);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (err) input.setAttribute('aria-describedby', `err-${id}`);
      first = first || input;
    }
    if (err) {
      err.id = `err-${id}`;
      err.textContent = msg;
      err.hidden = false;
    }
  });
  first?.focus();
  return !first;
}

async function lookupCep(form) {
  const cep = digits($('#co-cep', form).value);
  if (cep.length !== 8) return;
  const box = $('[data-co-delivery]', form);
  box.innerHTML = '<span class="spinner"></span> <span class="small muted">Buscando endereço…</span>';
  try {
    const r = await resolveCep(cep, $('#co-number', form).value.trim());
    const set = (id, val) => {
      const i = $(`#${id}`, form);
      if (i && val && (!i.value.trim() || i.dataset.auto === '1')) {
        i.value = val;
        i.dataset.auto = '1';
      }
    };
    set('co-street', r.street);
    set('co-district', r.district);
    set('co-city', r.city);
    set('co-state', r.state);
    readStep1(form);
    // GPS continua valendo se o CEP digitado é do mesmo lugar (até 5 km)
    if (!(co.gpsLocked && co.addr.lat != null && haversine(r.lat, r.lng, co.addr.lat, co.addr.lng) <= 5)) {
      Object.assign(co.addr, { lat: r.lat, lng: r.lng, precision: r.precision });
      co.gpsLocked = false;
    }
    co.geoKey = addrKey(co.addr);
    await refreshQuote();
    box.innerHTML = deliveryNotice();
    renderSummary();
    if (!r.street) $('#co-street', form)?.focus();
    else if (!$('#co-number', form).value.trim()) $('#co-number', form)?.focus();
  } catch (err) {
    box.innerHTML = `<p class="f-error">${esc(bizMessage(err))}</p>`;
  }
}

async function submitStep1(form) {
  readStep1(form);
  const a = co.addr;
  const errors = {};
  if (a.cep.length !== 8) errors['co-cep'] = 'Informe um CEP com 8 números.';
  if (!a.number) errors['co-number'] = 'Informe o número (ou "s/n").';
  if (!a.street) errors['co-street'] = 'Informe a rua.';
  if (!a.city) errors['co-city'] = 'Informe a cidade.';
  if (!/^[A-Z]{2}$/.test(a.state)) errors['co-state'] = 'UF com 2 letras.';
  if (!showFieldErrors(form, errors)) return;
  co.busy = true;
  co.status = '';
  const btn = $('[type="submit"]', form);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verificando…';
  try {
    if (!(co.gpsLocked && a.lat != null) && (co.geoKey !== addrKey(a) || a.lat == null)) {
      const lookup = resolveCep(a.cep, a.number, { street: a.street, city: a.city, state: a.state, district: a.district });
      // Já há coordenadas do CEP: o refinamento pela rua tem até 5 s; depois segue com o que tem.
      const precise = a.lat != null ? await Promise.race([lookup.catch(() => null), new Promise((r) => setTimeout(() => r(null), 5000))]) : await lookup;
      if (precise) Object.assign(a, { lat: precise.lat, lng: precise.lng, precision: precise.precision });
      co.geoKey = addrKey(a);
    }
    await refreshQuote();
    if (!co.quote) throw Object.assign(new Error('INVALID_LOCATION'), { code: 'INVALID_LOCATION' });
    setLocation({ ...a });
    updateStoreUI();
    renderCart();
    co.busy = false;
    if (!co.quote.within_radius) {
      $('[data-co-delivery]', form).innerHTML = deliveryNotice();
      renderSummary();
      btn.disabled = false;
      btn.textContent = 'Continuar';
      $('[data-co-delivery] button', form)?.focus();
      return;
    }
    goStep(2);
  } catch (err) {
    co.busy = false;
    btn.disabled = false;
    btn.textContent = 'Continuar';
    $('[data-co-status]', form).innerHTML = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
  }
}

function submitStep2(form) {
  const name = $('#co-name', form).value.trim().replace(/\s+/g, ' ');
  const phone = digits($('#co-phone', form).value);
  const email = $('#co-email', form).value.trim();
  const cpf = digits($('#co-cpf', form).value);
  co.notes = $('#co-notes', form).value.trim();
  const errors = {};
  if (name.length < 3 || !name.includes(' ')) errors['co-name'] = 'Informe nome e sobrenome.';
  if (phone.length < 10 || phone.length > 11) errors['co-phone'] = 'Telefone com DDD (10 ou 11 números).';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors['co-email'] = 'E-mail inválido.';
  if (cpf && !cpfValid(cpf)) errors['co-cpf'] = 'CPF inválido.';
  if (!showFieldErrors(form, errors)) return;
  co.customer = { name, phone, email, cpf };
  storage.set('atual:customer', { name, phone, email });
  goStep(3);
}

async function submitStep3(form) {
  if (!co.method) {
    $('[data-co-status]', form).innerHTML = '<p class="notice notice--error">Escolha a forma de pagamento.</p>';
    $('input[name="method"]', form)?.focus();
    return;
  }
  co.busy = true;
  co.status = '';
  const btn = $('[type="submit"]', form);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando…';
  const notes = [co.notes, co.method === 'cash' && co.change ? `Troco para ${co.change}` : '', co.addr.precision === 'gps' ? 'Localização enviada pelo GPS do celular.' : ''].filter(Boolean).join('\n');
  const payload = {
    store_id: S.store.id,
    customer: co.customer,
    address: {
      cep: co.addr.cep,
      street: co.addr.street,
      number: co.addr.number,
      complement: co.addr.complement,
      district: co.addr.district,
      city: co.addr.city,
      state: co.addr.state,
      reference: co.addr.reference,
      lat: co.addr.lat,
      lng: co.addr.lng,
    },
    items: S.cart.map((l) => ({ product_id: l.id, variant_id: l.variant, qty: l.qty })),
    payment_method: co.method,
    installments: co.method === 'card_on_delivery' || co.method === 'card_link' ? co.installments : 1,
    coupon_code: co.coupon?.valid ? co.coupon.code : null,
    notes,
  };
  try {
    const r = await rpc('place_order', { p: payload });
    co.result = r;
    co.busy = false;
    const recent = storage.get('atual:orders', []);
    storage.set('atual:orders', [{ code: r.code, token: r.tracking_token, store: S.store.name, total: r.total, at: Date.now() }, ...(Array.isArray(recent) ? recent : [])].slice(0, 8));
    S.cart = [];
    saveCart();
    renderCart();
    co.coupon = null;
    co.couponCode = '';
    co.notes = '';
    co.change = '';
    renderCheckout();
    $('#checkout-sheet .sheet__body').scrollTop = 0;
    requestAnimationFrame(() => $('#checkout-sheet .success__actions a, #checkout-sheet .success__actions button')?.focus({ preventScroll: true }));
    emit('order-placed', r);
  } catch (err) {
    co.busy = false;
    btn.disabled = false;
    btn.innerHTML = `${icon('i-lock')} Confirmar pedido`;
    const code = err?.code;
    if (code === 'OUT_OF_RANGE' || code === 'INVALID_LOCATION' || code === 'INVALID_ADDRESS' || code === 'INVALID_CEP') {
      co.step = 1;
      co.status = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
      renderCheckout();
      return;
    }
    if (code === 'INVALID_NAME' || code === 'INVALID_PHONE' || code === 'INVALID_EMAIL' || code === 'INVALID_CPF') {
      co.step = 2;
      co.status = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
      renderCheckout();
      return;
    }
    if (code === 'COUPON_INVALID') {
      co.coupon = { valid: false, message: err.detail || 'Cupom inválido' };
      renderSummary();
    }
    $('[data-co-status]', form).innerHTML = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
    if (code === 'PRODUCT_UNAVAILABLE' || code === 'OUT_OF_STOCK') emit('reload-storefront');
  }
}

async function applyCoupon(code) {
  co.couponCode = code.trim().toUpperCase();
  if (!co.couponCode) return;
  try {
    co.coupon = await rpc('validate_coupon', { p_store: S.store.id, p_code: co.couponCode, p_subtotal: cartSubtotal(), p_phone: co.customer.phone || null });
  } catch (err) {
    co.coupon = { valid: false, message: bizMessage(err) };
  }
  renderCheckout();
  $('#co-coupon')?.focus({ preventScroll: true });
}

function initCheckout() {
  const el = $('#checkout-sheet');
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('[data-coupon]')) return applyCoupon(f.code.value);
    const step = f.dataset.coForm;
    if (step === '1') submitStep1(f);
    else if (step === '2') submitStep2(f);
    else if (step === '3') submitStep3(f);
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-cep]')) {
      const d = digits(t.value).slice(0, 8);
      t.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
      if (d.length === 8 && d !== co.addr.cep) {
        co.addr.cep = d;
        if (!co.gpsLocked) {
          co.addr.lat = null;
          co.quote = null;
        }
        lookupCep(t.form);
      }
    } else if (t.matches('[data-phone]')) {
      const d = digits(t.value).slice(0, 11);
      t.value = d.length > 2 ? fmtPhone(d) : d;
    } else if (t.matches('[data-cpf]')) {
      const d = digits(t.value).slice(0, 11);
      t.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else if (t.matches('[data-change]')) co.change = t.value;
    else if (t.closest('[data-co-form="1"]') && t.id !== 'co-cep') t.dataset.auto = '0';
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'method') {
      co.method = t.value;
      const maxInst = installments(totals().sub - totals().disc).n;
      co.installments = co.installments > 1 ? Math.min(co.installments, maxInst) : maxInst;
      const prev = t.value;
      $('[data-co-step]', el).innerHTML = stepHTML();
      renderSummary();
      $(`input[name="method"][value="${prev}"]`, el)?.focus({ preventScroll: true });
    } else if (t.matches('[data-inst]')) {
      co.installments = Number(t.value) || 1;
      renderSummary();
    }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-co-back]')) return goStep(co.step - 1);
    const goto = e.target.closest('[data-co-goto]');
    if (goto) return goStep(Number(goto.dataset.coGoto));
    if (e.target.closest('[data-coupon-remove]')) {
      co.coupon = null;
      co.couponCode = '';
      renderCheckout();
      $('#co-coupon')?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-co-gps]')) {
      const form = e.target.closest('form');
      const box = $('[data-co-delivery]', form);
      box.innerHTML = '<span class="spinner"></span> <span class="small muted">Obtendo localização…</span>';
      try {
        const g = await resolveGps();
        readStep1(form);
        Object.assign(co.addr, { lat: g.lat, lng: g.lng, precision: 'gps' });
        co.gpsLocked = true;
        co.geoKey = addrKey(co.addr);
        await refreshQuote();
        box.innerHTML = `${deliveryNotice()}<p class="small muted" style="margin-top:6px">Usamos o GPS para calcular a distância. Preencha CEP, rua e número para o entregador.</p>`;
        renderSummary();
      } catch (err) {
        box.innerHTML = `<p class="f-error">${esc(bizMessage(err))}</p>`;
      }
      return;
    }
    if (e.target.closest('[data-copy-pix]')) {
      const key = $('[data-pix-key]', el)?.textContent || '';
      try {
        await navigator.clipboard.writeText(key);
        toast('Chave PIX copiada.');
      } catch {
        const r = document.createRange();
        r.selectNodeContents($('[data-pix-key]', el));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        toast('Selecione e copie a chave.');
      }
      return;
    }
    const tk = e.target.closest('[data-track-token]');
    if (tk) {
      e.preventDefault();
      openTrack({ token: tk.dataset.trackToken });
    }
  });
}

/* ---------- Acompanhar pedido ---------- */
const TRACK_FLOW = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
let trackState = { order: null, error: '', busy: false };

function trackResultHTML(o) {
  const st = { ...(o.store || {}) };
  st.whatsapp = st.whatsapp || S.net.support_whatsapp || '';
  const idx = TRACK_FLOW.indexOf(o.status);
  const canceled = o.status === 'canceled';
  const addr = o.address || {};
  return `<div class="track-result">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
      <div><strong style="font-size:20px">Pedido ${esc(o.code)}</strong><br><span class="small muted">Feito em ${esc(fmtDateTime(o.created_at))} na ${esc(st.name || '')}</span></div>
      <span class="badge${canceled ? ' badge--soldout' : ''}">${esc(STATUS[o.status] || o.status)}</span>
    </div>
    ${
      canceled
        ? '<p class="notice notice--error" style="margin-top:14px">Este pedido foi cancelado. Em caso de dúvida, fale com a loja.</p>'
        : `<ol class="track-steps" aria-label="Andamento do pedido">${TRACK_FLOW.map((s, i) => `<li class="${i <= idx ? 'is-done' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${STATUS[s]}</li>`).join('')}</ol>`
    }
    ${o.scheduled_date ? `<p class="notice notice--ok">${icon('i-truck')}<span>Entrega agendada para <strong>${esc(new Date(`${o.scheduled_date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }))}</strong></span></p>` : ''}
    <div class="summary" style="position:static;margin-top:14px">
      <div class="summary__items">${(o.items || [])
        .map((i) => `<div class="summary__item"><span class="summary__thumb">${picture(i.image_url)}<span class="summary__qty">${i.quantity}</span></span><span>${esc(i.name)}${i.variant_name ? `<br><small class="muted">${esc(i.variant_name)}</small>` : ''}</span><span>${brl(i.total)}</span></div>`)
        .join('')}</div>
      <div class="summary__rows">
        <div><span>Subtotal</span><span>${brl(o.subtotal)}</span></div>
        ${Number(o.discount_coupon) > 0 ? `<div class="is-discount"><span>Cupom ${esc(o.coupon_code || '')}</span><span>− ${brl(o.discount_coupon)}</span></div>` : ''}
        ${Number(o.discount_pix) > 0 ? `<div class="is-discount"><span>Desconto PIX</span><span>− ${brl(o.discount_pix)}</span></div>` : ''}
        <div><span>Entrega</span><span>${Number(o.delivery_fee) === 0 ? 'Grátis' : brl(o.delivery_fee)}</span></div>
        <div class="summary__total"><span>Total</span><span>${brl(o.total)}</span></div>
        <div class="small muted"><span>${esc(PAY_LABEL(o.payment_method))}${o.installments > 1 ? ` em ${o.installments}x` : ''} · ${esc(PAY_STATUS[o.payment_status] || o.payment_status || '')}</span></div>
      </div>
      <p class="summary__store">Entrega em ${esc([`${addr.street || ''}, ${addr.number || ''}`, addr.complement, addr.district, `${addr.city || ''} - ${addr.state || ''}`].filter(Boolean).join(' · '))}</p>
    </div>
    ${
      o.payment_method === 'pix' && o.payment_status !== 'paid' && st.pix_key && !canceled
        ? `<div class="success__box"><strong>Chave PIX da loja</strong>${st.pix_holder ? ` · ${esc(st.pix_holder)}` : ''}<div class="pix-key"><span data-pix-key>${esc(st.pix_key)}</span><button class="btn btn--outline btn--sm" type="button" data-copy-pix>${icon('i-copy')} Copiar</button></div></div>`
        : ''
    }
    ${
      (o.events || []).length
        ? `<h3 style="margin:18px 0 8px;font-size:16px">Histórico</h3><ul class="track-events">${o.events
            .slice()
            .reverse()
            .map((ev) => `<li><time>${esc(fmtDateTime(ev.created_at))}</time><span>${esc(ev.message || STATUS[ev.status] || '')}</span></li>`)
            .join('')}</ul>`
        : ''
    }
    ${st.whatsapp ? `<a class="btn btn--whats btn--block" style="margin-top:16px" href="${esc(waLink(st.whatsapp, `Olá! Quero falar sobre o pedido ${o.code}.`))}" target="_blank" rel="noopener">${icon('i-whatsapp')} Falar com a loja</a>` : ''}
  </div>`;
}

function renderTrack() {
  const el = $('#track-sheet');
  const recent = storage.get('atual:orders', []);
  const o = trackState.order;
  el.innerHTML = `<div class="sheet__head"><h2 class="sheet__title">Acompanhar pedido</h2><button class="sheet__close" type="button" aria-label="Fechar" data-sheet-close>${icon('i-close')}</button></div>
    <div class="sheet__body">
      ${
        o
          ? `${trackResultHTML(o)}<button class="link" type="button" style="margin-top:14px" data-track-other>Consultar outro pedido</button>`
          : `<form data-track-form novalidate>
              <p class="picker__intro">Informe o código do pedido (ex.: AT1024) e o telefone usado na compra.</p>
              <div class="f-grid">
                <div class="f-field s3"><label class="f-label" for="tr-code">Código do pedido</label><input class="f-input" id="tr-code" name="code" placeholder="AT1024" autocomplete="off" required style="text-transform:uppercase"></div>
                <div class="f-field s3"><label class="f-label" for="tr-phone">Telefone</label><input class="f-input" id="tr-phone" name="phone" type="tel" inputmode="tel" placeholder="(31) 99999-9999" value="${esc(fmtPhone(storage.get('atual:customer', {}).phone || ''))}" required></div>
              </div>
              <div role="alert" style="margin-top:12px">${trackState.error}</div>
              <button class="btn btn--primary btn--block" style="margin-top:14px" type="submit" ${trackState.busy ? 'disabled' : ''}>${trackState.busy ? '<span class="spinner"></span> Buscando…' : 'Consultar'}</button>
            </form>
            ${
              Array.isArray(recent) && recent.length
                ? `<h3 class="picker__section">Seus pedidos neste aparelho</h3><div class="store-list">${recent
                    .map((r) => `<button class="store-opt" type="button" data-track-token="${esc(r.token)}">${icon('i-cart')}<span class="store-opt__info"><strong>${esc(r.code)}</strong>${esc(r.store)} · ${esc(new Date(r.at).toLocaleDateString('pt-BR'))}</span><span class="store-opt__tag">${brl(r.total)}</span></button>`)
                    .join('')}</div>`
                : ''
            }`
      }
    </div>`;
}

export async function openTrack({ token = null } = {}) {
  trackState = { order: null, error: '', busy: !!token };
  renderTrack();
  openSheet('track-sheet', {
    onClose: () => {
      if (location.pathname.startsWith('/pedido/')) history.pushState({}, '', S.store ? `/loja/${S.store.slug}` : '/');
    },
  });
  if (token) await loadTrack(() => rpc('track_order_by_token', { p_token: token }), token);
}

async function loadTrack(fetcher, token) {
  trackState.busy = true;
  renderTrack();
  try {
    const o = await fetcher();
    if (!o) trackState.error = '<p class="notice notice--error">Pedido não encontrado. Confira o código e o telefone.</p>';
    else {
      trackState.order = o;
      trackState.error = '';
      if (token && !location.pathname.startsWith('/pedido/')) history.pushState({ pedido: token }, '', `/pedido/${token}`);
    }
  } catch (err) {
    trackState.error = `<p class="notice notice--error">${esc(err?.code === 'NETWORK' ? bizMessage(err) : 'Pedido não encontrado. Confira o código e o telefone.')}</p>`;
  }
  trackState.busy = false;
  renderTrack();
  requestAnimationFrame(() => $('#track-sheet .sheet__body').scrollTo(0, 0));
}

function initTrack() {
  const el = $('#track-sheet');
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-track]')) {
      e.preventDefault();
      openTrack();
    }
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const code = f.code.value.trim().toUpperCase();
    const phone = digits(f.phone.value);
    if (!digits(code) || phone.length < 10) {
      trackState.error = '<p class="notice notice--error">Informe o código do pedido e o telefone com DDD.</p>';
      renderTrack();
      $('#tr-code', el)?.focus();
      return;
    }
    loadTrack(() => rpc('track_order', { p_code: code, p_phone: phone }));
  });
  el.addEventListener('click', async (e) => {
    const tk = e.target.closest('[data-track-token]');
    if (tk) return loadTrack(() => rpc('track_order_by_token', { p_token: tk.dataset.trackToken }), tk.dataset.trackToken);
    if (e.target.closest('[data-track-other]')) {
      trackState = { order: null, error: '', busy: false };
      renderTrack();
      $('#tr-code', el)?.focus();
      return;
    }
    if (e.target.closest('[data-copy-pix]')) {
      try {
        await navigator.clipboard.writeText($('[data-pix-key]', el)?.textContent || '');
        toast('Chave PIX copiada.');
      } catch {
        toast('Selecione e copie a chave.');
      }
    }
  });
}

/* ---------- Eventos ---------- */
export function initCart() {
  on('cart-add', (d) => addToCart(d));
  document.addEventListener('click', (e) => {
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      e.preventDefault();
      toggleWish(wish.dataset.wish);
      return;
    }
    const q = e.target.closest('[data-line-qty]');
    if (q) {
      const i = Number(q.dataset.lineQty);
      const delta = Number(q.dataset.delta);
      setQty(i, (S.cart[i]?.qty || 0) + delta);
      requestAnimationFrame(() => $(`[data-line-qty="${i}"][data-delta="${delta}"]`)?.focus({ preventScroll: true }) || $('[data-cart] .drawer__close')?.focus({ preventScroll: true }));
      return;
    }
    const rm = e.target.closest('[data-line-remove]');
    if (rm) {
      setQty(Number(rm.dataset.lineRemove), 0);
      requestAnimationFrame(() => ($('[data-cart] .line__remove') || $('[data-cart] .drawer__close'))?.focus({ preventScroll: true }));
      return;
    }
    if (e.target.closest('[data-checkout]')) {
      e.preventDefault();
      openCheckout();
    }
  });
  initCheckout();
  initTrack();
}
