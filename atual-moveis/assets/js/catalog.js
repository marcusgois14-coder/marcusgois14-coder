// Vitrine: página inicial, listagens, busca, menus e página do produto (catálogo da loja escolhida).
import { $, $$, esc, norm, icon, brl, km, plural, picture, bannerPicture, hydrate, mediaSrc, toast, bizMessage, waLink, mapsLink, digits, fmtCep, storage } from './lib.js';
import {
  S, emit, pixPrice, hasPix, displayPrice, installments, pixPct, categoryName, deliveryStatus, feeFor, setLocation, storeWhatsapp, storeAddress,
} from './state.js';
import { openSheet, closeSheet, onOpen, setPanel, toggleMenu } from './layers.js';
import { resolveCep, updateStoreUI } from './picker.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mqMobile = matchMedia('(max-width: 749px)');

/* ---------- URLs ---------- */
export const storePath = () => `/loja/${S.store.slug}`;
export const productUrl = (p) => `${storePath()}?produto=${encodeURIComponent(p.slug)}`;
export const listUrl = (params) => `${storePath()}?${new URLSearchParams(params)}`;

/* ---------- Arrastar trilhos com o mouse ---------- */
export function dragScroll(el) {
  let startX = 0;
  let startLeft = 0;
  let down = false;
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true;
    moved = false;
    startX = e.clientX;
    startLeft = el.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 5) {
      moved = true;
      el.classList.add('is-dragging');
    }
    if (moved) el.scrollLeft = startLeft - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    if (moved) {
      el.classList.remove('is-dragging');
      const first = el.firstElementChild;
      const step = first ? first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || 0) : 0;
      if (step) el.scrollTo({ left: Math.round(el.scrollLeft / step) * step, behavior: 'smooth' });
    }
  });
  el.addEventListener(
    'click',
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    },
    true
  );
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

// Pontos de paginação (por página ou por item)
export function pagerDots(track, dotsEl, { perItem = false, label = 'Página' } = {}) {
  const pages = () => (perItem ? track.children.length : Math.max(1, Math.ceil((track.scrollWidth - 4) / Math.max(1, track.clientWidth))));
  const target = (i) => {
    const max = track.scrollWidth - track.clientWidth;
    if (perItem) {
      const item = track.children[i];
      return Math.min(item ? item.offsetLeft - track.offsetLeft : 0, max);
    }
    return (max * i) / Math.max(1, pages() - 1);
  };
  const render = () => {
    const n = pages();
    dotsEl.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" aria-label="${esc(label)}: ${perItem ? 'item' : 'página'} ${i + 1}" data-page="${i}"></button>`).join('') : '';
    update();
  };
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    const n = pages();
    let page;
    if (perItem) {
      if (track.scrollLeft >= max - 1) page = n - 1;
      else {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(target(i) - track.scrollLeft);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        page = best;
      }
    } else page = max <= 0 ? 0 : Math.round((track.scrollLeft / max) * (n - 1));
    $$('button', dotsEl).forEach((b, i) => {
      b.classList.toggle('is-active', i === page);
      b.setAttribute('aria-current', i === page ? 'true' : 'false');
    });
  };
  dotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) track.scrollTo({ left: target(+b.dataset.page), behavior: 'smooth' });
  });
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', render);
  render();
}

/* ---------- Card de produto ---------- */
const BADGE = { novo: 'Lançamento', frete: 'Frete grátis' };

function swatchList(p, selectedId) {
  if (!p.variants?.length) return '';
  return `<div class="swatches" role="group" aria-label="Cores disponíveis">${p.variants
    .map(
      (v, i) =>
        `<button class="swatch" type="button" style="--swatch:${esc(v.color || '#ddd')}" aria-pressed="${selectedId ? v.id === selectedId : i === 0}" aria-label="Cor: ${esc(v.name)}" title="${esc(v.name)}${v.in_stock ? '' : ' (esgotada)'}" data-swatch="${esc(v.id)}"><span></span></button>`
    )
    .join('')}</div>`;
}

export function cardHTML(p, { badgeAll } = {}) {
  const badge = badgeAll || (p.is_new ? 'novo' : p.free_shipping ? 'frete' : null);
  const wished = S.wish.includes(p.id);
  const price = displayPrice(p.price);
  const compare = p.compare_at_price && p.compare_at_price > price ? p.compare_at_price : null;
  const soldout = !p.in_stock;
  const img2 = p.image2_url || p.images?.[1]?.url;
  return `<article class="card${soldout ? ' is-soldout' : ''}" data-id="${esc(p.id)}">
    <div class="card__media">
      ${picture(p.image_url || p.images?.[0]?.url, { cls: 'card__img1', sizes: '(max-width: 749px) 45vw, 264px' })}
      ${img2 ? picture(img2, { cls: 'card__img2' }) : ''}
    </div>
    <div class="card__ui">
      <div class="card__badges">
        ${soldout ? '<span class="badge badge--soldout">Esgotado</span>' : badge && BADGE[badge] ? `<span class="badge">${BADGE[badge]}</span>` : ''}
        <div class="card__flags">
          <button class="glass card__wish${wished ? ' is-active' : ''}" type="button" aria-pressed="${wished}" aria-label="Favoritar ${esc(p.name)}" data-wish="${esc(p.id)}">
            ${icon('i-heart', 'i-empty')}${icon('i-heart-fill', 'i-full')}
          </button>
          ${p.fast_delivery ? `<span class="glass card__truck" title="Pronta entrega">${icon('i-truck')}<span class="visually-hidden">Pronta entrega</span></span>` : ''}
          ${p.is_promo ? `<span class="card__seal" title="Super oferta">${icon('i-seal')}<span class="visually-hidden">Super oferta</span></span>` : ''}
        </div>
      </div>
      ${soldout ? '' : `<button class="card__add" type="button" aria-label="Adicionar ${esc(p.name)} ao carrinho" data-add="${esc(p.id)}">${icon('i-cart-plus')}</button>`}
    </div>
    <div class="card__info">
      <h3 class="card__title"><a class="card__link" href="${esc(productUrl(p))}" data-product="${esc(p.slug)}">${esc(p.name)}</a></h3>
      <p class="card__price">
        ${compare ? `<s class="card__compare"><span class="visually-hidden">De </span>${brl(compare)}</s>` : ''}
        <span class="card__sale${p.is_promo ? ' is-promo' : ''}"><span class="visually-hidden">Por </span>${brl(price)}${hasPix() ? '<span class="visually-hidden"> no PIX</span>' : ''}</span>
      </p>
      ${p.low_stock && !soldout ? '<p class="card__low">Últimas unidades</p>' : ''}
      ${swatchList(p)}
    </div>
  </article>`;
}

// Troca a foto do card ao clicar numa cor
function onSwatchClick(sw) {
  const card = sw.closest('.card');
  const pdp = sw.closest('[data-pdp]');
  if (pdp) return; // a página do produto trata sozinha
  const p = S.byId[card?.dataset.id];
  if (!p) return;
  const v = p.variants.find((x) => x.id === sw.dataset.swatch);
  $$('[data-swatch]', card).forEach((b) => b.setAttribute('aria-pressed', String(b === sw)));
  card.dataset.variant = v?.id || '';
  if (v?.image_url) {
    const pic = $('.card__img1', card)?.closest('picture');
    if (pic) pic.outerHTML = picture(v.image_url, { cls: 'card__img1' });
  }
}

/* ---------- Prateleiras (carrosséis) ---------- */
export function initSlider(root) {
  const track = $('[data-track]', root);
  const prev = $('[data-prev]', root);
  const next = $('[data-next]', root);
  const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft >= max - 2;
    if (atEnd && document.activeElement === next) prev.focus({ preventScroll: true });
    if (atStart && document.activeElement === prev) next.focus({ preventScroll: true });
    prev.disabled = atStart;
    next.disabled = atEnd;
  };
  prev.addEventListener('click', () => track.scrollBy({ left: -(track.clientWidth + gap()), behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth + gap(), behavior: 'smooth' }));
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  dragScroll(track);
  pagerDots(track, $('[data-dots]', root), { label: root.dataset.label || 'Produtos' });
  update();
}

function shelfHTML(c, products) {
  const six = c.layout === 'six';
  return `<section class="shelf${six ? ' shelf--six' : ''}" id="${esc(c.key)}" aria-labelledby="t-${esc(c.key)}">
    <div class="shelf__inner">
      <div class="shelf__head">
        <div>
          <h2 class="shelf__title" id="t-${esc(c.key)}">${esc(c.title)}</h2>
          ${c.subtitle ? `<p class="shelf__sub">${esc(c.subtitle)}</p>` : ''}
        </div>
        <a class="btn-pill" href="${esc(listUrl({ colecao: c.key }))}" data-route>Ver tudo</a>
      </div>
      <div class="slider" data-slider data-label="${esc(c.title)}">
        <button class="slider__arrow slider__arrow--prev" type="button" aria-label="Produtos anteriores" data-prev>${icon('i-chev-l')}</button>
        <div class="slider__track" data-track data-drag>${products.map((p) => cardHTML(p, { badgeAll: c.badge_all })).join('')}</div>
        <button class="slider__arrow slider__arrow--next" type="button" aria-label="Próximos produtos" data-next>${icon('i-chev-r')}</button>
        <div class="dots slider__dots" data-dots></div>
      </div>
    </div>
  </section>`;
}

/* ---------- Banner principal ---------- */
let heroCleanup = null;

function pinHTML(p) {
  return `<a class="pin" href="${esc(productUrl(p))}" data-product="${esc(p.slug)}">
    <span class="pin__thumb">${picture(p.image_url, { lazyData: true })}</span>
    <span class="pin__info"><span class="pin__name">${esc(p.name)}</span><span class="pin__price">${brl(displayPrice(p.price))} ${hasPix() ? '<small>no PIX</small>' : ''}</span></span>
    ${icon('i-arrow', 'pin__arrow')}
  </a>`;
}

function renderHero() {
  heroCleanup?.();
  const root = $('[data-hero]');
  const wrap = $('[data-hero-slides]');
  const dots = $('[data-hero-dots]');
  const slides = (S.sf.banners || []).filter((b) => b.kind === 'hero');
  root.hidden = !slides.length;
  if (!slides.length) return;
  wrap.innerHTML = slides
    .map((s, i) => {
      const pins = (s.pins || []).map((id) => S.byId[id]).filter(Boolean);
      return `<div class="hero__slide${i ? '' : ' is-active'}" role="group" aria-roledescription="slide" aria-label="${i + 1} de ${slides.length}: ${esc(s.title)}"${i ? ' aria-hidden="true"' : ''}>
        ${bannerPicture(s.image_url, s.image_mobile_url, { cls: 'hero__img', eager: i === 0, lazyData: i > 0 })}
        <a class="hero__link" href="${esc(s.link_url || '#')}" data-route aria-label="${esc(`${s.title}${s.text ? ` — ${s.text}` : ''}`)}"${i ? ' tabindex="-1"' : ''}></a>
        <div class="hero__copy" aria-hidden="true">
          ${s.kicker ? `<p class="hero__kicker">${esc(s.kicker)}</p>` : ''}
          <p class="hero__title">${esc(s.title)}</p>
          ${s.text ? `<p class="hero__text">${esc(s.text)}</p>` : ''}
        </div>
        ${pins.length ? `<div class="pins"><div class="pins__head"><span class="pins__label">No ambiente</span><div class="pins__dots" data-pin-dots></div></div><div class="pins__list" data-pin-list>${pins.map(pinHTML).join('')}</div></div>` : ''}
      </div>`;
    })
    .join('');
  dots.innerHTML = slides.map((_, i) => `<button type="button" class="hero__dot${i ? '' : ' is-active'}" aria-label="Ir para o slide ${i + 1}"${i ? '' : ' aria-current="true"'}></button>`).join('');
  hydrate(wrap.children[0]);
  const els = $$('.hero__slide', wrap);
  const dotBtns = $$('.hero__dot', dots);
  const pauseBtn = $('[data-hero-pause]');
  let current = 0;
  let timer = null;
  let hovering = false;
  let userPaused = false;
  const setInteractive = (el, on) => {
    if (on) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
    $$('a', el).forEach((a) => (on ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
  };
  els.forEach((el, i) => setInteractive(el, i === 0));
  const go = (n) => {
    const nxt = (n + els.length) % els.length;
    if (nxt === current) return;
    hydrate(els[nxt]);
    els[current].classList.remove('is-active');
    setInteractive(els[current], false);
    dotBtns[current].classList.remove('is-active');
    dotBtns[current].removeAttribute('aria-current');
    current = nxt;
    els[current].classList.add('is-active');
    setInteractive(els[current], true);
    dotBtns[current].classList.add('is-active');
    dotBtns[current].setAttribute('aria-current', 'true');
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const play = () => {
    stop();
    if (reduceMotion.matches || hovering || document.hidden || userPaused || els.length < 2) return;
    timer = setInterval(() => go(current + 1), 6000);
  };
  const onClick = (e) => {
    if (e.target.closest('[data-hero-prev]')) {
      go(current - 1);
      play();
    } else if (e.target.closest('[data-hero-next]')) {
      go(current + 1);
      play();
    } else if (e.target.closest('.hero__dot')) {
      go(dotBtns.indexOf(e.target.closest('.hero__dot')));
      play();
    } else if (e.target.closest('[data-hero-pause]')) {
      userPaused = !userPaused;
      pauseBtn.setAttribute('aria-pressed', String(userPaused));
      pauseBtn.setAttribute('aria-label', userPaused ? 'Retomar slideshow' : 'Pausar slideshow');
      pauseBtn.innerHTML = icon(userPaused ? 'i-play' : 'i-pause');
      play();
    }
  };
  const enter = () => {
    hovering = true;
    stop();
  };
  const leave = () => {
    hovering = false;
    play();
  };
  const focusOut = (e) => {
    if (!root.contains(e.relatedTarget)) play();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('mouseenter', enter);
  root.addEventListener('mouseleave', leave);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', focusOut);
  document.addEventListener('visibilitychange', play);
  // deslizar no toque e arrastar com o mouse
  let sx = null;
  let sy = null;
  let mx = null;
  let dragged = false;
  const ts = (e) => {
    if (e.target.closest('[data-pin-list]')) return stop();
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    stop();
  };
  const te = (e) => {
    if (sx !== null) {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(current + (dx < 0 ? 1 : -1));
    }
    sx = null;
    play();
  };
  const pd = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('[data-pin-list], button')) return;
    mx = e.clientX;
    dragged = false;
  };
  const pu = (e) => {
    if (mx === null) return;
    const dx = e.clientX - mx;
    mx = null;
    if (Math.abs(dx) > 40) {
      dragged = true;
      go(current + (dx < 0 ? 1 : -1));
      play();
    }
  };
  const clickCapture = (e) => {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      dragged = false;
    }
  };
  root.addEventListener('touchstart', ts, { passive: true });
  root.addEventListener('touchend', te);
  root.addEventListener('pointerdown', pd);
  window.addEventListener('pointerup', pu);
  root.addEventListener('click', clickCapture, true);
  root.addEventListener('dragstart', (e) => e.preventDefault());
  $$('[data-pin-list]', wrap).forEach((list) => {
    dragScroll(list);
    const d = $('[data-pin-dots]', list.parentElement);
    if (d && list.children.length > 1) pagerDots(list, d, { label: 'Produtos do ambiente' });
  });
  // pré-carrega o próximo slide quando a página termina de carregar
  const idle = () => els[1] && hydrate(els[1]);
  if (document.readyState === 'complete') setTimeout(idle, 1500);
  else window.addEventListener('load', () => setTimeout(idle, 800), { once: true });
  play();
  heroCleanup = () => {
    stop();
    root.removeEventListener('click', onClick);
    root.removeEventListener('mouseenter', enter);
    root.removeEventListener('mouseleave', leave);
    root.removeEventListener('focusin', stop);
    root.removeEventListener('focusout', focusOut);
    document.removeEventListener('visibilitychange', play);
    root.removeEventListener('touchstart', ts);
    root.removeEventListener('touchend', te);
    root.removeEventListener('pointerdown', pd);
    window.removeEventListener('pointerup', pu);
    root.removeEventListener('click', clickCapture, true);
  };
}

/* ---------- Faixa rolante ---------- */
let marqueeAnim = null;
function marqueeHTML(items) {
  return `<section class="marquee" aria-label="Vantagens">
    <div class="marquee__track" data-marquee-track></div>
    <button class="marquee__toggle" type="button" aria-pressed="false" aria-label="Pausar faixa" data-marquee-toggle>${icon('i-pause')}</button>
  </section>`;
}

function startMarquee(items) {
  const track = $('[data-marquee-track]');
  if (!track) return;
  const group = (hidden) => `<ul class="marquee__group"${hidden ? ' aria-hidden="true"' : ''}>${items.map((t) => `<li class="marquee__item">${esc(t)}</li>`).join('')}</ul>`;
  const build = () => {
    track.innerHTML = group(false);
    const w = track.firstElementChild.getBoundingClientRect().width || 1;
    const copies = Math.max(2, Math.ceil((window.innerWidth * 2) / w) + 1);
    track.innerHTML = group(false) + Array.from({ length: copies - 1 }, () => group(true)).join('');
    marqueeAnim?.cancel();
    marqueeAnim = null;
    if (reduceMotion.matches) return;
    marqueeAnim = track.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-w}px,0,0)` }], { duration: (w / 27) * 1000, iterations: Infinity });
  };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(build);
  const btn = $('[data-marquee-toggle]');
  const sec = btn.closest('.marquee');
  let paused = false;
  const sync = () => {
    if (!marqueeAnim) return;
    if (paused || sec.matches(':hover') || sec.contains(document.activeElement)) marqueeAnim.pause();
    else marqueeAnim.play();
  };
  btn.addEventListener('click', () => {
    paused = !paused;
    btn.setAttribute('aria-pressed', String(paused));
    btn.setAttribute('aria-label', paused ? 'Retomar faixa' : 'Pausar faixa');
    btn.innerHTML = icon(paused ? 'i-play' : 'i-pause');
    sync();
  });
  sec.addEventListener('mouseenter', sync);
  sec.addEventListener('mouseleave', sync);
  sec.addEventListener('focusin', sync);
  sec.addEventListener('focusout', () => setTimeout(sync));
}

const tileHTML = (t, withSub) => `<a class="tile" href="${esc(t.link_url || '#')}" data-route>
  ${bannerPicture(t.image_url, t.image_mobile_url)}
  <span class="tile__overlay"><span class="tile__title">${esc(t.title)}</span>${withSub && t.text ? `<span class="tile__sub">${esc(t.text)}</span>` : ''}</span>
</a>`;

/* ---------- Página inicial ---------- */
export function renderHome() {
  renderHero();
  // Faixa de categorias: só as que a loja tem
  const cats = S.cats.filter((c) => c.show_in_strip && c.product_count > 0);
  const track = $('[data-cats]');
  track.innerHTML = cats
    .map(
      (c) => `<a class="cat" href="${esc(listUrl({ categoria: c.slug }))}" data-route><span class="cat__tile">${picture(c.image_url, { sizes: '140px' })}</span><span class="cat__name">${esc(c.name)}</span></a>`
    )
    .join('');
  track.closest('.cats').hidden = !cats.length;
  if (!track.dataset.ready) {
    dragScroll(track);
    pagerDots(track, $('[data-cats-dots]'), { perItem: true, label: 'Categorias' });
    track.dataset.ready = '1';
  } else window.dispatchEvent(new Event('resize'));

  const shelves = S.colls
    .filter((c) => c.show_on_home)
    .map((c) => ({ c, products: c.product_ids.map((id) => S.byId[id]).filter(Boolean) }))
    .filter((x) => x.products.length);
  const mosaics = (S.sf.banners || []).filter((b) => b.kind === 'mosaic');
  const rooms = (S.sf.banners || []).filter((b) => b.kind === 'room');
  const marquee = (Array.isArray(S.store.marquee) && S.store.marquee.length ? S.store.marquee : S.net.marquee) || [];

  const parts = [];
  shelves.forEach((s, i) => {
    parts.push(shelfHTML(s.c, s.products));
    if (i === 0 && marquee.length) parts.push(marqueeHTML(marquee));
    if (i === 1 && mosaics.length) parts.push(`<section class="mosaic mosaic--2" aria-label="Inspirações">${mosaics.map((t) => tileHTML(t, true)).join('')}</section>`);
    if (i === 2 && rooms.length) parts.push(`<section class="mosaic mosaic--4" aria-label="Compre por ambiente">${rooms.map((t) => tileHTML(t, false)).join('')}</section>`);
  });
  if (shelves.length < 1 && marquee.length) parts.push(marqueeHTML(marquee));
  if (shelves.length < 2 && mosaics.length) parts.push(`<section class="mosaic mosaic--2" aria-label="Inspirações">${mosaics.map((t) => tileHTML(t, true)).join('')}</section>`);
  if (shelves.length < 3 && rooms.length) parts.push(`<section class="mosaic mosaic--4" aria-label="Compre por ambiente">${rooms.map((t) => tileHTML(t, false)).join('')}</section>`);
  if (!shelves.length && S.products.length) {
    parts.unshift(shelfHTML({ key: 'produtos', title: 'Produtos da loja', layout: 'five' }, S.products.slice(0, 12)));
  }
  if (!S.products.length) {
    parts.unshift(`<section class="listing"><div class="listing__empty"><strong>Esta loja ainda está montando o catálogo online.</strong>Fale com a ${esc(S.store.name)} pelo WhatsApp ou escolha outra loja.</div></section>`);
  }
  const host = $('[data-home-sections]');
  host.innerHTML = parts.join('');
  $$('[data-slider]', host).forEach(initSlider);
  if (marquee.length) startMarquee(marquee);
}

/* ---------- Busca ---------- */
const SYNONYMS = {
  sala: ['sofas', 'poltronas', 'racks-e-paineis', 'mesas-de-centro'],
  'sala de estar': ['sofas', 'poltronas', 'racks-e-paineis', 'mesas-de-centro'],
  'sala de jantar': ['mesas-e-cadeiras'],
  quarto: ['camas', 'colchoes', 'comodas', 'guarda-roupas'],
  cozinha: ['cozinhas', 'geladeiras', 'fogoes', 'eletroportateis'],
  eletro: ['geladeiras', 'fogoes', 'lavadoras', 'tvs', 'eletroportateis'],
  eletrodomesticos: ['geladeiras', 'fogoes', 'lavadoras'],
  tv: ['tvs'],
  televisao: ['tvs'],
  geladeira: ['geladeiras'],
  refrigerador: ['geladeiras'],
  'maquina de lavar': ['lavadoras'],
  lavadora: ['lavadoras'],
  cafeteira: ['eletroportateis'],
  'mais vendidos': ['*'],
};

export function searchProducts(q) {
  const nq = norm(q);
  if (!nq) return [];
  if (nq === 'mais vendidos') return [...S.products].sort((a, b) => b.sold_count - a.sold_count);
  const singular = nq.replace(/(oes|aes)$/, 'ao').replace(/s$/, '');
  const cats = new Set();
  Object.entries(SYNONYMS).forEach(([k, v]) => {
    if (nq === k || singular === k || (nq.length >= 4 && k.startsWith(nq))) v.forEach((c) => cats.add(c));
  });
  const terms = nq.split(/\s+/).filter(Boolean);
  const score = (p) => {
    const cat = S.catById[p.category_id];
    const parent = cat?.parent_id ? S.catById[cat.parent_id] : null;
    const hay = norm(`${p.name} ${cat?.name || ''} ${parent?.name || ''} ${p.brand || ''} ${p.sku || ''} ${(p.tags || []).join(' ')}`);
    if (cat && cats.has(cat.slug)) return 2;
    if (terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')))) return norm(p.name).includes(nq) ? 3 : 1;
    return 0;
  };
  return S.products.map((p) => [p, score(p)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || b[0].sold_count - a[0].sold_count).map(([p]) => p);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function highlight(text, q) {
  const i = norm(text).indexOf(norm(q));
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

const VIEWED_KEY = () => `atual:viewed:${S.store?.id}`;
export function rememberViewed(id) {
  const list = [id, ...storage.get(VIEWED_KEY(), []).filter((x) => x !== id)].slice(0, 6);
  storage.set(VIEWED_KEY(), list);
}

export function initSearch() {
  const input = $('[data-search-input]');
  const body = $('[data-search-body]');
  const clear = $('[data-search-clear]');
  const all = $('[data-search-all]');
  const status = $('[data-search-status]');
  let debounce;
  let active = -1;
  let lastQuery = '';
  const options = () => $$('[role="option"]', body);
  const setActive = (i) => {
    const opts = options();
    opts.forEach((o) => o.setAttribute('aria-selected', 'false'));
    active = opts.length ? (i + opts.length) % opts.length : -1;
    if (active >= 0) {
      opts[active].setAttribute('aria-selected', 'true');
      opts[active].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', opts[active].id);
    } else input.removeAttribute('aria-activedescendant');
  };
  const afterRender = () => {
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const lists = $$('[role="listbox"]', body);
    input.setAttribute('aria-controls', lists.map((l) => l.id).join(' ') || 'search-body');
    input.setAttribute('aria-expanded', String(lists.length > 0));
  };
  const resultItem = (p, i) => `<a class="sresult" id="sr-${i}" role="option" aria-selected="false" href="${esc(productUrl(p))}" data-product="${esc(p.slug)}">
      <span class="sresult__img">${picture(p.image_url)}</span>
      <span>
        <span class="sresult__cat">${esc(categoryName(p.category_id))}</span>
        <span class="sresult__name">${esc(p.name)}</span>
        <span class="sresult__price">${p.compare_at_price ? `<s>${brl(p.compare_at_price)}</s> — ` : ''}<strong>${brl(displayPrice(p.price))}</strong> ${hasPix() ? '<small>no PIX</small>' : ''}</span>
      </span>
    </a>`;
  const defaults = () => {
    const recent = storage.get(VIEWED_KEY(), []).map((id) => S.byId[id]).filter(Boolean);
    const chips = S.cats.filter((c) => !c.parent_id || c.product_count > 0).filter((c) => c.product_count > 0 || S.cats.some((x) => x.parent_id === c.id && x.product_count > 0)).slice(0, 8);
    const popular = (S.net.popular_searches || []).filter((q) => searchProducts(q).length);
    body.innerHTML = `
      ${chips.length ? `<div class="search__section"><p class="search__label">Categorias</p><div class="chips">${chips.map((c) => `<a class="chip" href="${esc(listUrl({ categoria: c.slug }))}" data-route>${esc(c.name)}</a>`).join('')}</div></div>` : ''}
      ${popular.length ? `<div class="search__section"><p class="search__label">Buscas populares</p><ul class="qlist" role="listbox" id="lb-popular" aria-label="Buscas populares">${popular.map((q, i) => `<li role="none"><a href="#" id="sq-${i}" role="option" aria-selected="false" data-query="${esc(q)}">${icon('i-search')}${esc(q)}</a></li>`).join('')}</ul></div>` : ''}
      ${recent.length ? `<div class="search__section"><p class="search__label">Vistos por último</p><div class="sresults" role="listbox" id="lb-recent" aria-label="Vistos por último">${recent.map((p, i) => resultItem(p, `v${i}`)).join('')}</div></div>` : ''}`;
    all.hidden = true;
    clear.hidden = !input.value.trim();
    status.textContent = '';
    afterRender();
  };
  const run = () => {
    const q = input.value.trim();
    clear.hidden = !q;
    if (q.length < 2) return defaults();
    lastQuery = q;
    const hits = searchProducts(q);
    const nq = norm(q);
    const sugg = Array.from(new Set([...S.cats.filter((c) => c.product_count > 0).map((c) => c.name), ...(S.net.popular_searches || [])].filter((s) => norm(s).includes(nq)))).slice(0, 4);
    let didYouMean = '';
    if (!hits.length && nq.length >= 3) {
      const vocab = new Map();
      S.products.forEach((p) => [categoryName(p.category_id), ...p.name.split(/[^\p{L}\d]+/u)].forEach((w) => w && w.length > 3 && vocab.set(norm(w), w.toLowerCase())));
      const best = [...vocab].map(([k, w]) => [w, levenshtein(nq, k)]).sort((a, b) => a[1] - b[1])[0];
      if (best && best[1] <= 2) didYouMean = best[0];
    }
    const shown = hits.slice(0, 6);
    body.innerHTML = `
      ${didYouMean ? `<p class="did-you-mean">Você quis dizer: <button type="button" data-query="${esc(didYouMean)}">${esc(didYouMean)}</button>?</p>` : ''}
      ${sugg.length ? `<div class="search__section"><p class="search__label">Sugestões</p><ul class="qlist" role="listbox" id="lb-sugg" aria-label="Sugestões">${sugg.map((s, i) => `<li role="none"><a href="#" id="ss-${i}" role="option" aria-selected="false" data-query="${esc(s)}">${icon('i-search')}<span>${highlight(s, q)}</span></a></li>`).join('')}</ul></div>` : ''}
      ${
        hits.length
          ? `<div class="search__section"><p class="search__label">Produtos</p><div class="sresults" role="listbox" id="lb-prod" aria-label="Produtos">${shown.map(resultItem).join('')}</div></div>`
          : `<div class="search__empty"><strong>Nenhum resultado para “${esc(q)}”</strong><p>Tente outras palavras ou fale com a loja pelo WhatsApp.</p></div>`
      }`;
    all.hidden = !hits.length;
    all.href = listUrl({ busca: q });
    status.textContent = hits.length ? `${plural(hits.length, 'produto encontrado', 'produtos encontrados')}` : 'Nenhum resultado';
    afterRender();
  };
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 60);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) options()[active].click();
      else if (input.value.trim().length >= 2) emit('navigate', listUrl({ busca: input.value.trim() }));
    }
  });
  $('[data-search-form]').addEventListener('submit', (e) => e.preventDefault());
  clear.addEventListener('click', () => {
    input.value = '';
    run();
    input.focus();
  });
  body.addEventListener('click', (e) => {
    const q = e.target.closest('[data-query]');
    if (!q) return;
    e.preventDefault();
    input.value = q.dataset.query;
    run();
    input.focus();
  });
  onOpen('search-drawer', () => (input.value.trim() ? run() : defaults()));
}

/* ---------- Menus ---------- */
export function renderMenus() {
  const parents = S.cats.filter((c) => !c.parent_id);
  const childrenOf = (id) => S.cats.filter((c) => c.parent_id === id && c.product_count > 0);
  const groups = parents
    .map((p) => ({ p, kids: childrenOf(p.id) }))
    .filter((g) => g.kids.length || g.p.product_count > 0);
  const collMenu = S.colls.filter((c) => c.product_ids.length);
  const items = [];
  groups.forEach((g, i) => {
    if (!g.kids.length) {
      items.push(`<li><a class="mpill" href="${esc(listUrl({ categoria: g.p.slug }))}" data-route data-menu-link>${esc(g.p.name)}</a></li>`);
      return;
    }
    items.push(`<li>
      <button class="mpill" type="button" aria-expanded="false" aria-controls="msub-${i}">${esc(g.p.name)} <span class="plus" aria-hidden="true"></span></button>
      <div class="msub" id="msub-${i}" hidden><ul class="msub__links">
        <li><a href="${esc(listUrl({ categoria: g.p.slug }))}" data-route data-menu-link>Ver tudo em ${esc(g.p.name)}</a></li>
        ${g.kids.map((k) => `<li><a href="${esc(listUrl({ categoria: k.slug }))}" data-route data-menu-link>${esc(k.name)}</a></li>`).join('')}
      </ul></div>
    </li>`);
  });
  collMenu.forEach((c) =>
    items.push(`<li><a class="mpill${c.key === 'ofertas' ? ' is-hot' : ''}" href="${esc(listUrl({ colecao: c.key }))}" data-route data-menu-link>${esc(c.title)}</a></li>`)
  );
  items.push(`<li><button class="mpill" type="button" data-open-picker>Trocar de loja <span class="small">${esc(S.store.city)}</span></button></li>`);
  items.push(`<li><a class="mpill" href="${esc(mapsLink(`${S.store.name}, ${storeAddress()}`))}" target="_blank" rel="noopener">Como chegar na loja</a></li>`);
  items.push(`<li><button class="mpill mpill--cta" type="button" data-open-track>Rastrear pedido</button></li>`);
  $('[data-menu-list]').innerHTML = items.join('');

  // Navegação em linha + mega menu (telas ≥ 1600px)
  const nav = $('[data-inline-nav]');
  nav.innerHTML = [
    ...groups.map((g) =>
      g.kids.length
        ? `<div class="nav-item" data-mega><a class="nav-item__link" href="${esc(listUrl({ categoria: g.p.slug }))}" data-route aria-haspopup="true" aria-expanded="false">${esc(g.p.name)} ${icon('i-caret')}</a>
            <div class="mega"><div class="mega__col"><a class="mega__title" href="${esc(listUrl({ categoria: g.p.slug }))}" data-route>${esc(g.p.name)}</a>${g.kids
              .map((k) => `<a href="${esc(listUrl({ categoria: k.slug }))}" data-route>${esc(k.name)}</a>`)
              .join('')}</div></div></div>`
        : `<div class="nav-item"><a class="nav-item__link" href="${esc(listUrl({ categoria: g.p.slug }))}" data-route>${esc(g.p.name)}</a></div>`
    ),
    ...collMenu.slice(0, 2).map((c) => `<div class="nav-item"><a class="nav-item__link${c.key === 'ofertas' ? ' is-hot' : ''}" href="${esc(listUrl({ colecao: c.key }))}" data-route>${esc(c.title)}</a></div>`),
  ].join('');
  $$('[data-mega]', nav).forEach((item) => {
    const link = $('.nav-item__link', item);
    const open = (on) => {
      if (on) item.classList.remove('is-dismissed');
      link.setAttribute('aria-expanded', String(on));
      setPanel('mega', on);
    };
    item.addEventListener('mouseenter', () => open(true));
    item.addEventListener('mouseleave', () => open(false));
    item.addEventListener('focusin', () => open(true));
    item.addEventListener('focusout', (e) => {
      if (!item.contains(e.relatedTarget)) open(false);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        item.classList.add('is-dismissed');
        open(false);
        link.focus({ preventScroll: true });
      }
    });
  });
}

export function initMenuDrawer() {
  const el = $('[data-menu-drawer]');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[aria-controls]');
    if (t && el.contains(t)) {
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      const open = t.getAttribute('aria-expanded') !== 'true';
      t.setAttribute('aria-expanded', String(open));
      t.classList.toggle('is-open', open);
      panel.hidden = !open;
      return;
    }
    if (e.target.closest('[data-menu-link]') || e.target.closest('[data-open-picker]') || e.target.closest('[data-open-track]')) toggleMenu(false);
  });
}

/* ---------- Listagem ---------- */
const SORTS = {
  relevancia: 'Mais relevantes',
  vendidos: 'Mais vendidos',
  menor: 'Menor preço',
  maior: 'Maior preço',
  novidades: 'Lançamentos',
  desconto: 'Maior desconto',
};
const SEALS = { frete: 'Frete grátis', pronta: 'Pronta entrega', promo: 'Em promoção', novo: 'Lançamento' };

function descendants(cat) {
  return [cat.id, ...S.cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)];
}

export function listingBase(params) {
  if (params.get('colecao')) {
    const c = S.colls.find((x) => x.key === params.get('colecao'));
    return { title: c?.title || 'Coleção', crumb: c?.title, products: (c?.product_ids || []).map((id) => S.byId[id]).filter(Boolean), badgeAll: c?.badge_all, ordered: true };
  }
  if (params.get('categoria')) {
    const cat = S.catBySlug[params.get('categoria')];
    if (!cat) return { title: 'Categoria', products: [] };
    const ids = new Set(descendants(cat));
    const parent = cat.parent_id ? S.catById[cat.parent_id] : null;
    return { title: cat.name, crumb: cat.name, parent, products: S.products.filter((p) => ids.has(p.category_id)), description: cat.description };
  }
  if (params.get('busca')) {
    return { title: `Resultados para “${params.get('busca')}”`, crumb: 'Busca', products: searchProducts(params.get('busca')), ordered: true };
  }
  return { title: 'Todos os produtos', crumb: 'Produtos', products: [...S.products] };
}

export function renderListing(params) {
  const host = $('[data-listing]');
  const base = listingBase(params);
  const sort = SORTS[params.get('ordem')] ? params.get('ordem') : 'relevancia';
  const min = Number(params.get('min')) || null;
  const max = Number(params.get('max')) || null;
  const seals = (params.get('selos') || '').split(',').filter((s) => SEALS[s]);
  const inStock = params.get('estoque') === '1';
  const catFilter = (params.get('cat') || '').split(',').filter(Boolean);
  const shown = Number(params.get('n')) || 24;

  const facetCats = {};
  base.products.forEach((p) => {
    const c = S.catById[p.category_id];
    if (c) facetCats[c.slug] = { name: c.name, count: (facetCats[c.slug]?.count || 0) + 1 };
  });
  let list = base.products.filter((p) => {
    const price = displayPrice(p.price);
    if (min !== null && price < min) return false;
    if (max !== null && price > max) return false;
    if (inStock && !p.in_stock) return false;
    if (seals.includes('frete') && !p.free_shipping) return false;
    if (seals.includes('pronta') && !p.fast_delivery) return false;
    if (seals.includes('promo') && !p.is_promo) return false;
    if (seals.includes('novo') && !p.is_new) return false;
    if (catFilter.length && !catFilter.includes(S.catById[p.category_id]?.slug)) return false;
    return true;
  });
  const disc = (p) => (p.compare_at_price ? 1 - p.price / p.compare_at_price : 0);
  const sorters = {
    relevancia: base.ordered ? null : (a, b) => Number(b.in_stock) - Number(a.in_stock) || b.sold_count - a.sold_count,
    vendidos: (a, b) => b.sold_count - a.sold_count,
    menor: (a, b) => a.price - b.price,
    maior: (a, b) => b.price - a.price,
    novidades: (a, b) => Number(b.is_new) - Number(a.is_new) || new Date(b.created_at) - new Date(a.created_at),
    desconto: (a, b) => disc(b) - disc(a),
  };
  if (sorters[sort]) list = [...list].sort(sorters[sort]);

  const keep = (extra) => {
    const p = new URLSearchParams(params);
    p.delete('n');
    Object.entries(extra).forEach(([k, v]) => (v === null || v === '' ? p.delete(k) : p.set(k, v)));
    return `${storePath()}?${p}`;
  };
  const chips = [
    ...seals.map((s) => ({ label: SEALS[s], href: keep({ selos: seals.filter((x) => x !== s).join(',') }) })),
    ...catFilter.map((c) => ({ label: facetCats[c]?.name || c, href: keep({ cat: catFilter.filter((x) => x !== c).join(',') }) })),
    ...(min !== null || max !== null ? [{ label: `${min !== null ? brl(min) : 'R$ 0'} – ${max !== null ? brl(max) : 'sem limite'}`, href: keep({ min: null, max: null }) }] : []),
    ...(inStock ? [{ label: 'Em estoque', href: keep({ estoque: null }) }] : []),
  ];
  host.innerHTML = `
    <nav class="crumbs" aria-label="Você está em"><a href="${esc(storePath())}" data-route>Início</a><span aria-hidden="true">/</span>${
      base.parent ? `<a href="${esc(listUrl({ categoria: base.parent.slug }))}" data-route>${esc(base.parent.name)}</a><span aria-hidden="true">/</span>` : ''
    }<span aria-current="page">${esc(base.crumb || base.title)}</span></nav>
    <div class="listing__head">
      <div><h1 class="listing__title" id="listing-title" tabindex="-1">${esc(base.title)}</h1>
      <p class="listing__count">${plural(list.length, 'produto', 'produtos')} na ${esc(S.store.name)}</p></div>
      <div class="listing__tools">
        <button class="btn btn--outline btn--sm listing__filterbtn" type="button" data-open-filters>${icon('i-filter')} Filtrar</button>
        <label class="visually-hidden" for="ls-sort">Ordenar por</label>
        <select class="f-select" id="ls-sort" data-sort>${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
    </div>
    ${chips.length ? `<div class="active-filters">${chips.map((c) => `<button type="button" data-goto="${esc(c.href)}">${esc(c.label)} ${icon('i-close')}</button>`).join('')}<button type="button" data-goto="${esc(keep({ selos: null, cat: null, min: null, max: null, estoque: null }))}"><strong>Limpar filtros</strong></button></div>` : ''}
    <div class="listing__layout">
      <aside class="filters" data-filters aria-label="Filtros">
        <div class="row-between" style="display:flex;justify-content:space-between;align-items:center"><strong class="h3" style="font-size:16px">Filtros</strong><button class="sheet__close listing__filterbtn" type="button" aria-label="Fechar filtros" data-close-filters>${icon('i-close')}</button></div>
        ${
          Object.keys(facetCats).length > 1
            ? `<div class="filters__group"><h3>Categoria</h3><div class="filters__list">${Object.entries(facetCats)
                .map(([slug, c]) => `<label class="fcheck"><input type="checkbox" data-fcat="${esc(slug)}" ${catFilter.includes(slug) ? 'checked' : ''}><span>${esc(c.name)}</span><small>${c.count}</small></label>`)
                .join('')}</div></div>`
            : ''
        }
        <div class="filters__group"><h3>Preço</h3>
          <form class="filters__price" data-price>
            <label class="visually-hidden" for="pmin">Preço mínimo</label><input class="f-input" id="pmin" name="min" inputmode="numeric" placeholder="Mín." value="${min ?? ''}">
            <label class="visually-hidden" for="pmax">Preço máximo</label><input class="f-input" id="pmax" name="max" inputmode="numeric" placeholder="Máx." value="${max ?? ''}">
            <button class="btn btn--outline btn--sm" type="submit" style="grid-column:span 2">Aplicar</button>
          </form>
        </div>
        <div class="filters__group"><h3>Ofertas e entrega</h3><div class="filters__list">${Object.entries(SEALS)
          .map(([k, v]) => `<label class="fcheck"><input type="checkbox" data-fseal="${k}" ${seals.includes(k) ? 'checked' : ''}><span>${v}</span></label>`)
          .join('')}
          <label class="fcheck"><input type="checkbox" data-fstock ${inStock ? 'checked' : ''}><span>Somente em estoque</span></label></div></div>
      </aside>
      <div>
        ${
          list.length
            ? `<div class="grid-products">${list.slice(0, shown).map((p) => cardHTML(p, { badgeAll: base.badgeAll })).join('')}</div>
               ${list.length > shown ? `<div class="listing__more"><button class="btn btn--outline" type="button" data-goto="${esc(keep({ n: shown + 24 }))}" data-keep-scroll>Carregar mais (${list.length - shown})</button></div>` : ''}`
            : `<div class="listing__empty"><strong>Nenhum produto encontrado</strong>${chips.length ? 'Tente remover alguns filtros.' : `Esta loja não tem produtos nesta seção agora. <a class="link" href="${esc(waLink(storeWhatsapp(), `Olá! Procuro ${base.title} na ${S.store.name}.`))}" target="_blank" rel="noopener">Pergunte pelo WhatsApp</a>.`}</div>`
        }
      </div>
    </div>`;

  host.onchange = (e) => {
    if (e.target.matches('[data-sort]')) emit('navigate', keep({ ordem: e.target.value === 'relevancia' ? null : e.target.value }));
    else if (e.target.matches('[data-fseal]')) {
      const set = new Set(seals);
      if (e.target.checked) set.add(e.target.dataset.fseal);
      else set.delete(e.target.dataset.fseal);
      emit('navigate', keep({ selos: [...set].join(',') }));
    } else if (e.target.matches('[data-fcat]')) {
      const set = new Set(catFilter);
      if (e.target.checked) set.add(e.target.dataset.fcat);
      else set.delete(e.target.dataset.fcat);
      emit('navigate', keep({ cat: [...set].join(',') }));
    } else if (e.target.matches('[data-fstock]')) emit('navigate', keep({ estoque: e.target.checked ? '1' : null }));
  };
  host.onsubmit = (e) => {
    if (!e.target.matches('[data-price]')) return;
    e.preventDefault();
    const f = e.target;
    emit('navigate', keep({ min: digits(f.min.value) || null, max: digits(f.max.value) || null }));
  };
  host.onclick = (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      emit('navigate', { url: g.dataset.goto, keepScroll: g.hasAttribute('data-keep-scroll') });
      return;
    }
    if (e.target.closest('[data-open-filters]')) $('[data-filters]', host).classList.add('is-open');
    if (e.target.closest('[data-close-filters]')) $('[data-filters]', host).classList.remove('is-open');
  };
  document.title = `${base.title} · ${S.store.name}`;
}

/* ---------- Página do produto ---------- */
let pdpState = null;

function deliveryBlock(p) {
  const ds = deliveryStatus();
  let result = '';
  if (ds.known) {
    if (ds.within) {
      const fee = feeFor(ds.distance, displayPrice(p.price), p.free_shipping);
      result = `<div class="notice notice--ok">${icon('i-check')}<div>Entregamos no seu endereço (${km(ds.distance)} da loja).<br><strong>${fee === 0 ? 'Frete grátis' : `Frete ${brl(fee)}`}</strong>${
        S.store.free_shipping_min && fee > 0 ? ` · grátis acima de ${brl(S.store.free_shipping_min)}` : ''
      }${S.store.delivery_lead_time ? `<br>${esc(S.store.delivery_lead_time)}` : ''}</div></div>`;
    } else {
      result = `<div class="notice notice--warn">${icon('i-pin')}<div>Seu endereço fica a ${km(ds.distance)} da loja, fora do raio de ${km(ds.radius)}. <button class="link" type="button" data-open-picker>Ver lojas que atendem você</button></div></div>`;
    }
  }
  return `<div class="pdp__delivery">
    <h3>${icon('i-truck')} Entrega${S.loc?.cep ? ` para ${esc(fmtCep(S.loc.cep))}` : ''}</h3>
    <form class="f-row" data-pdp-cep novalidate>
      <label class="visually-hidden" for="pdp-cep">CEP</label>
      <input class="f-input" id="pdp-cep" name="cep" inputmode="numeric" placeholder="Digite seu CEP" maxlength="9" value="${esc(fmtCep(S.loc?.cep || ''))}">
      <button class="btn btn--outline btn--sm" type="submit">Calcular</button>
    </form>
    <div class="pdp__delivery-result" role="status">${result}</div>
  </div>`;
}

function renderPdp() {
  const { p, variant, imgIndex, qty } = pdpState;
  const el = $('#product-sheet');
  const images = [...(p.images?.length ? p.images.map((i) => i.url) : [p.image_url].filter(Boolean))];
  if (variant?.image_url && !images.includes(variant.image_url)) images.unshift(variant.image_url);
  const idx = Math.min(imgIndex, Math.max(0, images.length - 1));
  const unitPrice = variant ? Number(variant.price) : Number(p.price);
  const price = displayPrice(unitPrice);
  const compare = p.compare_at_price && p.compare_at_price > price ? p.compare_at_price : null;
  const inst = installments(unitPrice);
  const inStock = variant ? variant.in_stock : p.in_stock;
  const cat = S.catById[p.category_id];
  const specs = [
    ...(p.specs || []),
    ...[
      ['Largura', p.width_cm && `${p.width_cm} cm`],
      ['Altura', p.height_cm && `${p.height_cm} cm`],
      ['Profundidade', p.depth_cm && `${p.depth_cm} cm`],
      ['Peso', p.weight_kg && `${String(p.weight_kg).replace('.', ',')} kg`],
      ['Garantia', p.warranty],
      ['Marca', p.brand],
    ]
      .filter(([, v]) => v)
      .map(([label, value]) => ({ label, value })),
  ];
  const related = S.products.filter((x) => x.id !== p.id && x.category_id === p.category_id).slice(0, 4);
  const badges = [p.is_new && 'Lançamento', p.free_shipping && 'Frete grátis', p.fast_delivery && 'Pronta entrega', p.is_promo && 'Super oferta'].filter(Boolean);
  el.innerHTML = `
    <div class="sheet__head">
      <h2 class="sheet__title visually-hidden">${esc(p.name)}</h2>
      <span class="small muted">${esc(S.store.name)}</span>
      <button class="sheet__close" type="button" aria-label="Fechar produto" data-sheet-close>${icon('i-close')}</button>
    </div>
    <div class="sheet__body" data-pdp>
      <div class="pdp">
        <div class="pdp__gallery">
          <div class="pdp__main">${picture(images[idx], { eager: true, alt: p.name })}
            ${badges.length ? `<div class="pdp__badges">${badges.map((b) => `<span class="badge">${b}</span>`).join('')}</div>` : ''}
            ${images.length > 1 ? `<button class="pdp__nav pdp__nav--prev" type="button" aria-label="Foto anterior" data-img="${(idx - 1 + images.length) % images.length}">${icon('i-chev-l')}</button><button class="pdp__nav pdp__nav--next" type="button" aria-label="Próxima foto" data-img="${(idx + 1) % images.length}">${icon('i-chev-r')}</button>` : ''}
          </div>
          ${images.length > 1 ? `<div class="pdp__thumbs">${images.map((u, i) => `<button class="pdp__thumb" type="button" aria-label="Foto ${i + 1}" aria-current="${i === idx}" data-img="${i}">${picture(u)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="pdp__info">
          ${cat ? `<a class="pdp__cat" href="${esc(listUrl({ categoria: cat.slug }))}" data-route>${esc(cat.name)}</a>` : ''}
          <h2 class="pdp__name">${esc(p.name)}</h2>
          ${p.sku ? `<span class="pdp__sku">Cód. ${esc(variant?.sku || p.sku)}</span>` : ''}
          <div class="pdp__prices">
            ${compare ? `<div class="pdp__compare">De ${brl(compare)}</div>` : ''}
            <div class="pdp__price${p.is_promo ? ' is-promo' : ''}">${brl(price)} ${hasPix() ? '<small>no PIX</small>' : ''}</div>
            <div class="pdp__alt">${hasPix() ? `ou ${brl(unitPrice)} ` : ''}${inst.n > 1 ? `em até <strong>${inst.n}x de ${brl(inst.value)}</strong> sem juros` : 'à vista'}</div>
            ${compare ? `<span class="pdp__save">Economize ${brl(compare - price)}</span>` : hasPix() && pixPct() > 0 ? `<span class="pdp__save">${String(pixPct()).replace('.', ',')}% de desconto no PIX</span>` : ''}
          </div>
          ${
            p.variants?.length
              ? `<div class="pdp__variants"><span class="f-label">Cor</span>${swatchList(p, variant?.id)}<p class="pdp__variant-name">${esc(variant?.name || '')}${variant && !variant.in_stock ? ' — esgotada' : ''}</p></div>`
              : ''
          }
          ${p.low_stock && inStock ? '<p class="card__low">Últimas unidades em estoque</p>' : ''}
          ${
            inStock
              ? `<div class="pdp__buy">
                  <div class="qty qty--lg" role="group" aria-label="Quantidade">
                    <button type="button" aria-label="Diminuir quantidade" data-pdp-qty="-1">${icon('i-minus')}</button><span>${qty}</span><button type="button" aria-label="Aumentar quantidade" data-pdp-qty="1">${icon('i-plus')}</button>
                  </div>
                  <button class="btn btn--primary" type="button" data-pdp-add>${icon('i-cart')} Adicionar</button>
                </div>
                <button class="btn btn--dark btn--block" type="button" data-pdp-buy>Comprar agora</button>`
              : `<div class="notice notice--warn">${icon('i-store')}<div>Produto esgotado nesta loja.</div></div>
                 <a class="btn btn--whats btn--block" href="${esc(waLink(storeWhatsapp(), `Olá! O produto ${p.name} está esgotado no site. Vai chegar mais?`))}" target="_blank" rel="noopener">${icon('i-whatsapp')} Avise-me pelo WhatsApp</a>`
          }
          ${deliveryBlock(p)}
          <button class="pdp__share" type="button" data-share>${icon('i-share')} Compartilhar</button>
          ${p.description || p.short_description ? `<div class="pdp__section"><h3>Descrição</h3><p class="pdp__desc">${esc(p.description || p.short_description)}</p></div>` : ''}
          ${specs.length ? `<div class="pdp__section"><h3>Características</h3><table class="specs"><tbody>${specs.map((s) => `<tr><th scope="row">${esc(s.label)}</th><td>${esc(s.value)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
      </div>
      ${related.length ? `<div class="pdp__related"><h3>Você também pode gostar</h3><div class="grid-products">${related.map((x) => cardHTML(x)).join('')}</div></div>` : ''}
    </div>`;
}

export function openProduct(slug, { push = true } = {}) {
  const p = S.bySlug[slug] || S.byId[slug];
  if (!p) {
    toast('Produto não disponível nesta loja.');
    return false;
  }
  const firstAvailable = p.variants?.find((v) => v.in_stock) || p.variants?.[0] || null;
  pdpState = { p, variant: firstAvailable, imgIndex: 0, qty: 1, prevUrl: location.pathname + location.search };
  renderPdp();
  rememberViewed(p.id);
  if (push) history.pushState({ produto: p.slug }, '', productUrl(p));
  document.title = `${p.name} · ${S.store.name}`;
  openSheet('product-sheet', {
    onClose: () => {
      if (new URLSearchParams(location.search).get('produto')) {
        const url = new URL(location.href);
        url.searchParams.delete('produto');
        history.pushState({}, '', url.pathname + url.search);
        emit('title');
      }
    },
  });
  return true;
}

export function initProductSheet() {
  const el = $('#product-sheet');
  el.addEventListener('click', async (e) => {
    if (!pdpState) return;
    const img = e.target.closest('[data-img]');
    if (img) {
      pdpState.imgIndex = Number(img.dataset.img);
      renderPdp();
      $(`[data-img="${pdpState.imgIndex}"].pdp__thumb`, el)?.focus({ preventScroll: true });
      return;
    }
    const sw = e.target.closest('[data-swatch]');
    if (sw && sw.closest('[data-pdp]') && !sw.closest('.card')) {
      pdpState.variant = pdpState.p.variants.find((v) => v.id === sw.dataset.swatch) || null;
      pdpState.imgIndex = 0;
      renderPdp();
      $(`[data-swatch="${sw.dataset.swatch}"]`, el)?.focus({ preventScroll: true });
      return;
    }
    const q = e.target.closest('[data-pdp-qty]');
    if (q) {
      pdpState.qty = Math.max(1, Math.min(20, pdpState.qty + Number(q.dataset.pdpQty)));
      renderPdp();
      $(`[data-pdp-qty="${q.dataset.pdpQty}"]`, el)?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-pdp-add]') || e.target.closest('[data-pdp-buy]')) {
      const buy = !!e.target.closest('[data-pdp-buy]');
      emit('cart-add', { id: pdpState.p.id, variant: pdpState.variant?.id || null, qty: pdpState.qty, open: !buy, checkout: buy });
      return;
    }
    if (e.target.closest('[data-share]')) {
      const url = location.origin + productUrl(pdpState.p);
      try {
        if (navigator.share) await navigator.share({ title: pdpState.p.name, url });
        else {
          await navigator.clipboard.writeText(url);
          toast('Link copiado.');
        }
      } catch {
        /* cancelado */
      }
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.name === 'cep') {
      const d = digits(e.target.value).slice(0, 8);
      e.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    }
  });
  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-pdp-cep]')) return;
    e.preventDefault();
    const out = $('.pdp__delivery-result', el);
    const cep = digits(e.target.cep.value);
    if (cep.length !== 8) {
      out.innerHTML = '<p class="f-error">Informe um CEP com 8 números.</p>';
      return;
    }
    out.innerHTML = '<span class="spinner"></span>';
    try {
      setLocation(await resolveCep(cep));
      updateStoreUI();
      renderPdp();
      if (!matchMedia('(pointer: coarse)').matches) $('#pdp-cep', el)?.focus({ preventScroll: true });
    } catch (err) {
      out.innerHTML = `<p class="f-error">${esc(bizMessage(err))}</p>`;
    }
  });
}

/* ---------- Cliques globais do catálogo ---------- */
export function initCatalogClicks() {
  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-swatch]');
    if (sw && sw.closest('.card')) {
      e.preventDefault();
      onSwatchClick(sw);
      return;
    }
    const prod = e.target.closest('[data-product]');
    if (prod && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      if (openProduct(prod.dataset.product)) return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      const card = add.closest('.card');
      const p = S.byId[add.dataset.add];
      if (p?.variants?.length && !card?.dataset.variant) {
        // sem cor escolhida no card: usa a primeira disponível
        const v = p.variants.find((x) => x.in_stock) || p.variants[0];
        emit('cart-add', { id: p.id, variant: v?.id || null, qty: 1, open: true, focusBack: add });
      } else emit('cart-add', { id: add.dataset.add, variant: card?.dataset.variant || null, qty: 1, open: true, focusBack: add });
    }
  });
}

export function refreshWishButtons() {
  $$('.card__wish[data-wish]').forEach((b) => {
    const on = S.wish.includes(b.dataset.wish);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export { mediaSrc, closeSheet, mqMobile };
