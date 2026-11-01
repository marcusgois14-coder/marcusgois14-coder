// Ilustrações da marca (Tetim, a casinha da Atual) e a seção "Por que comprar na loja" da página inicial.
// As artes são SVGs decorativos em assets/img/art/ (animação por CSS dentro do próprio SVG, que já respeita
// o "reduzir movimento" do aparelho). Todo texto fica no HTML.
//   artImg(nome, opções)        <img> decorativo de uma arte
//   stateArt(nome, opções)      arte de estado (carrinho vazio, erro…) com proporção reservada (.state-art)
//   loaderHTML(texto, opções)   Tetim pulando + texto (espera visível)
//   mascotGreetingHTML()        boas-vindas do Tetim no seletor de loja (primeira visita)
//   perksHTML()                 seção de vantagens da loja (entrega, PIX/parcelas, 3D)
import { esc, icon, km } from './lib.js';
import { S, hasPix, pixPct } from './state.js';
import * as catalog from './catalog.js';

export const MASCOT_NAME = 'Tetim';
const BASE = '/assets/img/art/';
// Versão das artes: o build do Cloudflare troca o valor vazio por um hash, para o cache de 7 dias nunca prender arte antiga.
const ART_V = '';
const artSrc = (name) => `${BASE}${esc(name)}.svg${ART_V ? `?v=${ART_V}` : ''}`;

// Tamanho natural de cada arte (viewBox): width/height no <img> reservam o espaço antes de carregar.
const SIZES = {
  'banner-entrega': [640, 360],
  'banner-pix': [640, 360],
  'banner-3d': [640, 360],
  'empty-cart': [320, 240],
  'empty-wish': [320, 240],
  'empty-search': [320, 240],
  'order-success': [320, 240],
  'out-of-range': [320, 240],
  'store-closed': [320, 240],
  error: [320, 240],
  loading: [160, 160],
  mascote: [312, 312],
  'mascote-acena': [312, 312],
};

// lazy: só para o que fica abaixo da dobra. Gavetas e janelas usam carregamento normal com prioridade baixa,
// para a arte já estar pronta quando a gaveta abrir (lazy dentro de gaveta fechada só baixa ao abrir).
export function artImg(name, { cls = '', lazy = false, low = true } = {}) {
  const [w, h] = SIZES[name] || [320, 240];
  return `<img class="${esc(cls)}" src="${artSrc(name)}" alt="" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''}${
    low && !lazy ? ' fetchpriority="low"' : ''
  } decoding="async" draggable="false">`;
}

// size: 'md' (até 240 px), 'sm' (até 150 px), 'xs' (até 112 px)
export function stateArt(name, { size = 'md', cls = '', lazy = false } = {}) {
  const sz = size === 'md' ? '' : ` state-art--${size}`;
  return artImg(name, { cls: `state-art${sz}${cls ? ` ${cls}` : ''}`, lazy });
}

// live: role="status" próprio. O pequeno (sm) sempre entra numa área que já é role="status" (entrega no produto,
// CEP/GPS do checkout): uma região viva dentro da outra faz o leitor de tela anunciar o texto duas vezes.
export function loaderHTML(text = 'Carregando…', { size = 'md', cls = '', live = size !== 'sm' } = {}) {
  return `<div class="art-loader art-loader--${size}${cls ? ` ${cls}` : ''}"${live ? ' role="status"' : ''}>${artImg('loading', { cls: 'art-loader__img', low: false })}<span class="art-loader__text">${esc(
    text
  )}</span></div>`;
}

export function mascotGreetingHTML() {
  return `<div class="mascot-hello">
    ${artImg('mascote-acena', { cls: 'mascot-hello__img', low: false })}
    <p class="mascot-hello__bubble">Oi! Eu sou o <strong>${MASCOT_NAME}</strong>. Me diz seu CEP que eu acho a loja mais perto de você.</p>
  </div>`;
}

/* ---------- Vantagens da loja (página inicial) ---------- */
const storeUrl = (qs = '') => `/loja/${encodeURIComponent(S.store.slug)}${qs}`;
const ALL_PRODUCTS = () => storeUrl('?todos=1');
const pct = (n) => `${String(Number(n)).replace('.', ',')}%`;
const fn = (name) => (typeof catalog[name] === 'function' ? catalog[name] : null);
// Nome da loja em HTML: "Móveis - Teixeiras" fica junto (o hífen nunca começa nem termina linha)
function storeNameHTML() {
  const parts = String(S.store.name || '').split(' - ');
  return parts
    .map((part, i) => {
      let h = esc(part);
      if (i > 0) h = h.replace(/^(\S+)/, '$1</span>'); // fecha o par aberto no pedaço anterior
      if (i < parts.length - 1) h = h.replace(/(\S+)$/, '<span class="art-nb">$1');
      return h;
    })
    .join(' - ');
}

// "Monte seu ambiente" existe quando a página tem a seção [data-room] e o catálogo sabe montar a rota (?ambiente=1).
function roomLink() {
  const roomUrl = fn('roomUrl');
  if (!roomUrl || !document.querySelector('[data-room]')) return null;
  const friendly = fn('roomFriendly');
  if (friendly && !S.products.some((p) => friendly(p))) return null;
  return roomUrl();
}

function perkCard({ key, art, title, text = '', textHTML = '', note = '', href, cta }) {
  const id = `perk-${key}-title`;
  return `<li class="perk perk--${key}">
    <div class="perk__art">${artImg(art, { cls: 'perk__img', lazy: true })}</div>
    <div class="perk__body">
      <h3 class="perk__title" id="${id}">${esc(title)}</h3>
      <p class="perk__text">${textHTML || esc(text)}</p>
      ${note ? `<p class="perk__note">${icon('i-check')}<span>${esc(note)}</span></p>` : ''}
      <a class="perk__link" href="${esc(href)}" data-route aria-describedby="${id}">${esc(cta)} ${icon('i-arrow')}</a>
    </div>
  </li>`;
}

function deliveryCard() {
  const st = S.store;
  const radius = Number(st.delivery_radius_km) || Number(S.net.default_radius_km) || 0;
  const lead = String(st.delivery_lead_time || '').trim();
  return perkCard({
    key: 'entrega',
    art: 'banner-entrega',
    title: 'Entrega própria da loja',
    textHTML: radius ? `Levamos até você, em até ${esc(km(radius))} da ${storeNameHTML()}.` : `A equipe da ${storeNameHTML()} leva até a sua casa.`,
    // só quando é uma frase curta e humana (ex.: "Entrega em até 5 dias úteis após a confirmação")
    note: lead && lead.length <= 64 ? lead.replace(/\.$/, '') : '',
    href: ALL_PRODUCTS(),
    cta: 'Ver produtos',
  });
}

function paymentCard() {
  const st = S.store;
  const methods = st.payment_methods || [];
  if (hasPix() && pixPct() > 0) {
    const offers = S.colls.find((c) => c.key === 'ofertas' && c.product_ids.some((id) => S.byId[id]));
    return perkCard({
      key: 'pix',
      art: 'banner-pix',
      title: `${pct(pixPct())} de desconto no PIX`,
      // é assim que o checkout funciona: o pedido é feito no site e a chave PIX da loja aparece ao finalizar
      text: 'O preço em destaque já vem com desconto. Você faz o pedido aqui e paga com a chave PIX da loja.',
      href: offers ? storeUrl('?colecao=ofertas') : ALL_PRODUCTS(),
      cta: offers ? 'Ver ofertas' : 'Ver produtos',
    });
  }
  const max = Number(st.max_installments || 1);
  const card = methods.includes('card_on_delivery') || methods.includes('card_link');
  if (max > 1 && card) {
    const min = Number(st.min_installment_value || 0);
    const how = methods.includes('card_on_delivery') ? 'na maquininha, na hora da entrega' : 'por um link seguro que a loja envia';
    return perkCard({
      key: 'parcelas',
      art: 'banner-pix',
      title: `Parcele em até ${max}x sem juros`,
      text: `No cartão de crédito, ${how}.${min > 0 ? ` Parcela mínima de ${min.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : ''}`,
      href: ALL_PRODUCTS(),
      cta: 'Ver produtos',
    });
  }
  return '';
}

function viewer3dCard() {
  // sem nenhum produto com 3D, a promessa não vale para esta loja
  const has3D = fn('has3D');
  if (has3D && !S.products.some((p) => has3D(p))) return '';
  const room = roomLink();
  return perkCard({
    key: '3d',
    art: 'banner-3d',
    title: 'Veja os móveis em 3D',
    text: 'Gire, aproxime e veja no seu ambiente pelo celular.',
    href: room || ALL_PRODUCTS(),
    cta: room ? 'Experimentar o 3D' : 'Ver produtos',
  });
}

export function perksHTML() {
  if (!S.store) return '';
  let cards = [];
  try {
    cards = [deliveryCard(), paymentCard(), viewer3dCard()].filter(Boolean);
  } catch (err) {
    console.error(err);
    return '';
  }
  if (!cards.length) return '';
  return `<section class="perks perks--${cards.length}" aria-labelledby="perks-title">
    <div class="perks__inner">
      <div class="perks__head" data-reveal>
        <h2 class="perks__title" id="perks-title">Por que comprar na ${storeNameHTML()}</h2>
      </div>
      <ul class="perks__list" role="list" data-reveal-stagger="90">${cards.join('')}</ul>
    </div>
  </section>`;
}

// Teclado no celular/tablet (fileira que desliza): o cartão que recebe foco entra inteiro na tela. Sem isto o
// navegador mostra só o link (no pé do cartão) e o encaixe da rolagem puxa de volta para o cartão anterior.
document.addEventListener('focusin', (e) => {
  const card = e.target.closest?.('.perks__list > .perk');
  const list = card?.parentElement;
  if (!list || !e.target.matches(':focus-visible') || list.scrollWidth <= list.clientWidth) return;
  const lr = list.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  if (cr.left < lr.left || cr.right > lr.right) card.scrollIntoView({ block: 'nearest', inline: 'start' });
});
