(() => {
  'use strict';

  const D = window.ATUAL;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const productById = Object.fromEntries(D.products.map((p) => [p.id, p]));
  const mqMobile = window.matchMedia('(max-width: 989px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pixPrice = (p) => p.price * (1 - D.store.pixDiscount);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

  const picture = (name, alt, { sizes = '100vw', eager = false, cls = '' } = {}) => `
    <picture>
      <source type="image/webp" srcset="assets/img/${name}.webp">
      <img class="${cls}" src="assets/img/${name}.jpg" alt="${esc(alt)}" sizes="${sizes}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
    </picture>`;

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* armazenamento indisponível (aba anônima): segue sem persistir */
      }
    },
  };

  const whatsappUrl = (text = 'Olá! Vim pelo site da Atual Móveis e gostaria de atendimento.') =>
    `https://wa.me/${D.store.whatsapp}?text=${encodeURIComponent(text)}`;

  let toastTimer;
  function toast(msg) {
    const el = $('[data-toast]');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  /* ---------- Barra de anúncio ---------- */
  function initAnnouncement() {
    const track = $('[data-announcement]');
    track.innerHTML = D.announcements
      .map(
        (a, i) => `<p class="announcement__msg${i === 0 ? ' is-active' : ''}" ${i ? 'aria-hidden="true"' : ''}>
          <span>${esc(a.text)}</span>
          <a class="announcement__cta" href="${a.href}">${esc(a.cta)}</a>
        </p>`
      )
      .join('');
    const msgs = $$('.announcement__msg', track);
    if (msgs.length < 2 || reduceMotion) return;
    let i = 0;
    setInterval(() => {
      msgs[i].classList.remove('is-active');
      msgs[i].setAttribute('aria-hidden', 'true');
      i = (i + 1) % msgs.length;
      msgs[i].classList.add('is-active');
      msgs[i].removeAttribute('aria-hidden');
    }, 5000);
  }

  /* ---------- Cabeçalho ---------- */
  function initHeader() {
    const header = $('[data-header]');
    const onScroll = () => header.classList.toggle('is-solid', window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    header.addEventListener('focusin', () => header.classList.add('is-focus'));
    header.addEventListener('focusout', () => header.classList.remove('is-focus'));
  }

  /* ---------- Slideshow ---------- */
  function initHero() {
    const wrap = $('[data-hero]');
    const dots = $('[data-hero-dots]');
    wrap.innerHTML = D.hero
      .map((s, i) => {
        const p = productById[s.product];
        return `<div class="hero__slide${i === 0 ? ' is-active' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} de ${D.hero.length}" ${i ? 'aria-hidden="true"' : ''}>
          ${picture(s.image, '', { eager: i === 0, cls: 'hero__img' })}
          <div class="hero__content page-width">
            <p class="hero__kicker">${esc(s.kicker)}</p>
            <h2 class="hero__title">${esc(s.title)}</h2>
            <p class="hero__text">${esc(s.text)}</p>
          </div>
          ${
            p
              ? `<div class="hero__shop">
                  <span class="hero__shop-tag">No ambiente</span>
                  <a class="hero__card" href="#" data-product-link="${p.id}">
                    ${picture(p.image, '', { sizes: '64px' })}
                    <span class="hero__card-info">
                      <span class="hero__card-name">${esc(p.name)}</span>
                      <span class="hero__card-price">${brl(pixPrice(p))} <small>no PIX</small></span>
                    </span>
                    ${icon('i-arrow', 'icon icon--sm')}
                  </a>
                </div>`
              : ''
          }
        </div>`;
      })
      .join('');
    dots.innerHTML = D.hero
      .map((_, i) => `<button type="button" class="hero__dot${i === 0 ? ' is-active' : ''}" aria-label="Ir para o slide ${i + 1}"></button>`)
      .join('');

    const slides = $$('.hero__slide', wrap);
    const dotBtns = $$('.hero__dot', dots);
    let current = 0;
    let timer;

    const go = (n) => {
      slides[current].classList.remove('is-active');
      slides[current].setAttribute('aria-hidden', 'true');
      dotBtns[current].classList.remove('is-active');
      current = (n + slides.length) % slides.length;
      slides[current].classList.add('is-active');
      slides[current].removeAttribute('aria-hidden');
      dotBtns[current].classList.add('is-active');
    };
    const play = () => {
      if (reduceMotion) return;
      clearInterval(timer);
      timer = setInterval(() => go(current + 1), 6000);
    };
    const stop = () => clearInterval(timer);

    $('[data-hero-prev]').addEventListener('click', () => { go(current - 1); play(); });
    $('[data-hero-next]').addEventListener('click', () => { go(current + 1); play(); });
    dotBtns.forEach((b, i) => b.addEventListener('click', () => { go(i); play(); }));

    const hero = wrap.closest('.hero');
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', play);
    hero.addEventListener('focusin', stop);
    hero.addEventListener('focusout', play);

    let startX = null;
    hero.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; stop(); }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1));
      startX = null;
      play();
    });
    play();
  }

  /* ---------- Categorias ---------- */
  function initCategories() {
    const track = $('[data-categories]');
    track.innerHTML = D.categories
      .map(
        (c) => `<a class="category" href="${c.href}">
          <span class="category__media">${picture(c.image, '', { sizes: '140px' })}</span>
          <span class="category__name">${esc(c.name)}</span>
        </a>`
      )
      .join('');
    dragScroll(track);
  }

  // Arrastar com o mouse em trilhos horizontais (no toque o scroll nativo já resolve).
  function dragScroll(el) {
    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) {
        moved = true;
        el.classList.add('is-dragging');
      }
      el.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', () => {
      down = false;
      el.classList.remove('is-dragging');
    });
    el.addEventListener('click', (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, true);
    el.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /* ---------- Cards de produto ---------- */
  const badgeLabel = { novo: 'Lançamento', frete: 'Frete grátis', oferta: 'Oferta' };

  function productCard(p) {
    const off = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
    return `<article class="card" data-id="${p.id}">
      <div class="card__media">
        <a href="#" class="card__img-link" data-product-link="${p.id}" tabindex="-1" aria-hidden="true">
          ${picture(p.image, '', { sizes: '(max-width: 749px) 45vw, 264px' })}
        </a>
        ${p.badge ? `<span class="badge badge--${p.badge}">${badgeLabel[p.badge]}</span>` : ''}
        <div class="card__actions">
          <button class="card__icon" type="button" aria-label="Favoritar ${esc(p.name)}" aria-pressed="false" data-wish="${p.id}">
            ${icon('i-heart', 'icon icon--sm icon-heart-empty')}${icon('i-heart-fill', 'icon icon--sm icon-heart-full')}
          </button>
          ${p.freeShipping ? `<span class="card__icon card__icon--static" title="Frete grátis">${icon('i-truck', 'icon icon--sm')}</span>` : ''}
        </div>
        <button class="card__add" type="button" aria-label="Adicionar ${esc(p.name)} ao carrinho" data-add="${p.id}">${icon('i-cart-plus', 'icon icon--sm')}</button>
      </div>
      <div class="card__info">
        <h3 class="card__title"><a href="#" data-product-link="${p.id}">${esc(p.name)}</a></h3>
        <p class="card__price">
          ${p.compareAt ? `<s class="card__compare"><span class="visually-hidden">De </span>${brl(p.compareAt)}</s>` : ''}
          <span class="card__sale ${off >= 30 ? 'is-hot' : ''}"><span class="visually-hidden">Por </span>${brl(p.price)}</span>
        </p>
        <p class="card__pix">${brl(pixPrice(p))} no PIX <span>ou ${D.store.installments}x de ${brl(p.price / D.store.installments)}</span></p>
        ${
          p.swatches && p.swatches.length
            ? `<div class="swatches" role="radiogroup" aria-label="Cores">
                ${p.swatches
                  .map(
                    (c, i) => `<button type="button" role="radio" class="swatch${i === 0 ? ' is-selected' : ''}" style="--swatch:${c}" aria-checked="${i === 0}" aria-label="Cor ${i + 1}"></button>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>
    </article>`;
  }

  function initProducts() {
    $$('[data-products]').forEach((track) => {
      const ids = D.sections[track.dataset.products] || [];
      track.innerHTML = ids.map((id) => productById[id]).filter(Boolean).map(productCard).join('');
    });

    document.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) {
        const group = sw.parentElement;
        $$('.swatch', group).forEach((b) => {
          b.classList.toggle('is-selected', b === sw);
          b.setAttribute('aria-checked', String(b === sw));
        });
        return;
      }
      const link = e.target.closest('[data-product-link]');
      if (link) {
        e.preventDefault();
        const p = productById[link.dataset.productLink];
        toast(`Página de produto em breve: ${p.name}`);
      }
    });
  }

  /* ---------- Carrosséis ---------- */
  function initCarousels() {
    $$('[data-carousel]').forEach((root) => {
      const track = $('[data-carousel-track]', root);
      const prev = $('[data-carousel-prev]', root);
      const next = $('[data-carousel-next]', root);
      const dots = $('[data-carousel-dots]', root);
      dragScroll(track);

      const step = () => {
        const card = track.firstElementChild;
        if (!card) return track.clientWidth;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        const perView = Math.max(1, Math.round((track.clientWidth + gap) / (card.offsetWidth + gap)));
        return perView * (card.offsetWidth + gap);
      };
      const pages = () => Math.max(1, Math.ceil((track.scrollWidth - 2) / step()));

      const renderDots = () => {
        const n = pages();
        dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" aria-label="Página ${i + 1}" data-page="${i}"></button>`).join('') : '';
        update();
      };
      const update = () => {
        const max = track.scrollWidth - track.clientWidth;
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= max - 2;
        root.classList.toggle('is-scrollable', max > 2);
        const page = Math.round(track.scrollLeft / step());
        $$('button', dots).forEach((b, i) => b.classList.toggle('is-active', i === Math.min(page, pages() - 1)));
      };

      prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
      next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
      dots.addEventListener('click', (e) => {
        const b = e.target.closest('[data-page]');
        if (b) track.scrollTo({ left: +b.dataset.page * step(), behavior: 'smooth' });
      });
      track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
      window.addEventListener('resize', renderDots);
      renderDots();
    });
  }

  /* ---------- Marquee ---------- */
  function initMarquee() {
    const track = $('[data-marquee]');
    const group = `<ul class="marquee__group">${D.marquee.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    track.innerHTML = group + group.replace('<ul class="marquee__group">', '<ul class="marquee__group" aria-hidden="true">');
  }

  /* ---------- Editorial e ambientes ---------- */
  function initEditorial() {
    $('[data-editorial]').innerHTML = D.editorial
      .map(
        (e) => `<a class="editorial__item" href="${e.href}">
          ${picture(e.image, '', { sizes: '(max-width: 749px) 100vw, 50vw' })}
          <span class="editorial__text">
            <span class="editorial__title">${esc(e.title)}</span>
            <span class="editorial__sub">${esc(e.text)}</span>
          </span>
        </a>`
      )
      .join('');
    $('[data-rooms]').innerHTML = D.rooms
      .map(
        (r) => `<a class="room" href="${r.href}">
          ${picture(r.image, '', { sizes: '(max-width: 749px) 100vw, 25vw' })}
          <span class="room__title">${esc(r.title)}</span>
        </a>`
      )
      .join('');
  }

  /* ---------- Gavetas (menu, carrinho, favoritos) ---------- */
  let openDrawerEl = null;
  let lastFocus = null;

  function openDrawer(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (openDrawerEl) closeDrawer(false);
    lastFocus = document.activeElement;
    openDrawerEl = el;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    const overlay = $('[data-overlay]');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    document.body.classList.add('no-scroll');
    $$(`[aria-controls="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
    setTimeout(() => ($('button, a, input', el) || el).focus(), 50);
  }

  function closeDrawer(restoreFocus = true) {
    if (!openDrawerEl) return;
    const el = openDrawerEl;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    $$(`[aria-controls="${el.id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    const overlay = $('[data-overlay]');
    overlay.classList.remove('is-visible');
    setTimeout(() => { if (!openDrawerEl) overlay.hidden = true; }, 300);
    document.body.classList.remove('no-scroll');
    openDrawerEl = null;
    if (restoreFocus && lastFocus) lastFocus.focus();
  }

  function initDrawers() {
    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-open-drawer]');
      if (opener) {
        e.preventDefault();
        openDrawer(opener.dataset.openDrawer);
        return;
      }
      if (e.target.closest('[data-close-drawer]') || e.target.matches('[data-overlay]')) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
        closeSearch();
      }
      if (e.key === 'Tab' && openDrawerEl) {
        const f = $$('a[href], button:not([disabled]), input, summary, [tabindex="0"]', openDrawerEl).filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    $('[data-menu]').innerHTML = `<ul class="menu__list">${D.menu
      .map((m) =>
        m.children
          ? `<li><details class="menu__group"><summary>${esc(m.label)} ${icon('i-chev-d', 'icon icon--sm')}</summary>
              <ul class="menu__sub"><li><a href="#">Ver tudo em ${esc(m.label)}</a></li>${m.children.map((c) => `<li><a href="#">${esc(c)}</a></li>`).join('')}</ul></details></li>`
          : `<li><a class="menu__link${m.highlight ? ' is-hot' : ''}" href="${m.href}" data-close-drawer>${esc(m.label)}</a></li>`
      )
      .join('')}</ul>`;
  }

  /* ---------- Favoritos ---------- */
  let wishlist = store.get('atual:wishlist', []);

  function renderWishlist() {
    $$('[data-wish]').forEach((b) => {
      const on = wishlist.includes(b.dataset.wish);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const bubble = $('[data-wishlist-count]');
    bubble.textContent = wishlist.length;
    bubble.hidden = !wishlist.length;
    const list = $('[data-wishlist-items]');
    list.innerHTML = wishlist.length
      ? wishlist
          .map((id) => productById[id])
          .filter(Boolean)
          .map(
            (p) => `<div class="line">
              <span class="line__img">${picture(p.image, '', { sizes: '72px' })}</span>
              <div class="line__info">
                <p class="line__name">${esc(p.name)}</p>
                <p class="line__price">${brl(p.price)}</p>
                <div class="line__row">
                  <button class="link-btn" type="button" data-add="${p.id}">Adicionar ao carrinho</button>
                  <button class="link-btn link-btn--muted" type="button" data-wish="${p.id}">Remover</button>
                </div>
              </div>
            </div>`
          )
          .join('')
      : `<div class="empty">${icon('i-heart', 'icon empty__icon')}<p>Você ainda não favoritou nenhum produto.</p></div>`;
  }

  function toggleWish(id) {
    const on = wishlist.includes(id);
    wishlist = on ? wishlist.filter((x) => x !== id) : [...wishlist, id];
    store.set('atual:wishlist', wishlist);
    renderWishlist();
    toast(on ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
  }

  /* ---------- Carrinho ---------- */
  let cart = store.get('atual:cart', []);

  function cartTotals() {
    const subtotal = cart.reduce((s, l) => s + productById[l.id].price * l.qty, 0);
    return { subtotal, pix: subtotal * (1 - D.store.pixDiscount), count: cart.reduce((s, l) => s + l.qty, 0) };
  }

  function renderCart() {
    cart = cart.filter((l) => productById[l.id] && l.qty > 0);
    store.set('atual:cart', cart);
    const t = cartTotals();
    const bubble = $('[data-cart-count]');
    bubble.textContent = t.count;
    bubble.hidden = !t.count;
    $('[data-cart-items]').innerHTML = cart.length
      ? cart
          .map((l) => {
            const p = productById[l.id];
            return `<div class="line">
              <span class="line__img">${picture(p.image, '', { sizes: '72px' })}</span>
              <div class="line__info">
                <p class="line__name">${esc(p.name)}</p>
                <p class="line__price">${brl(p.price * l.qty)}</p>
                <div class="line__row">
                  <div class="qty" aria-label="Quantidade">
                    <button type="button" aria-label="Diminuir" data-qty="${p.id}" data-delta="-1">${icon('i-minus', 'icon icon--xs')}</button>
                    <span>${l.qty}</span>
                    <button type="button" aria-label="Aumentar" data-qty="${p.id}" data-delta="1">${icon('i-plus', 'icon icon--xs')}</button>
                  </div>
                  <button class="link-btn link-btn--muted" type="button" data-remove="${p.id}">Remover</button>
                </div>
              </div>
            </div>`;
          })
          .join('')
      : `<div class="empty">${icon('i-cart', 'icon empty__icon')}<p>Seu carrinho está vazio.</p><a class="btn btn--pill btn--primary" href="#queridinhos" data-close-drawer>Ver produtos</a></div>`;
    $('[data-cart-foot]').innerHTML = cart.length
      ? `<div class="cart-foot__row"><span>Subtotal</span><strong>${brl(t.subtotal)}</strong></div>
         <div class="cart-foot__row cart-foot__row--pix"><span>No PIX (${Math.round(D.store.pixDiscount * 100)}% OFF)</span><strong>${brl(t.pix)}</strong></div>
         <p class="cart-foot__note">ou em até ${D.store.installments}x de ${brl(t.subtotal / D.store.installments)} sem juros</p>
         <a class="btn btn--block btn--primary" href="${whatsappUrl(cartMessage())}" target="_blank" rel="noopener">${icon('i-whatsapp', 'icon icon--sm')} Finalizar pelo WhatsApp</a>`
      : '';
  }

  function cartMessage() {
    const lines = cart.map((l) => `• ${l.qty}x ${productById[l.id].name} — ${brl(productById[l.id].price * l.qty)}`);
    return `Olá! Quero finalizar este pedido no site da Atual Móveis:\n${lines.join('\n')}\nTotal: ${brl(cartTotals().subtotal)}`;
  }

  function addToCart(id) {
    const line = cart.find((l) => l.id === id);
    if (line) line.qty += 1;
    else cart.push({ id, qty: 1 });
    renderCart();
    openDrawer('cart-drawer');
  }

  function initCommerce() {
    document.addEventListener('click', (e) => {
      const wish = e.target.closest('[data-wish]');
      if (wish) return toggleWish(wish.dataset.wish);
      const add = e.target.closest('[data-add]');
      if (add) return addToCart(add.dataset.add);
      const qty = e.target.closest('[data-qty]');
      if (qty) {
        const l = cart.find((x) => x.id === qty.dataset.qty);
        if (l) l.qty += +qty.dataset.delta;
        return renderCart();
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        cart = cart.filter((x) => x.id !== rm.dataset.remove);
        renderCart();
      }
    });
    renderWishlist();
    renderCart();
  }

  /* ---------- Busca ---------- */
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function closeSearch() {
    const box = $('[data-search-results]');
    if (box) box.hidden = true;
  }

  function initSearch() {
    const input = $('[data-search-input]');
    const box = $('[data-search-results]');
    const form = $('[data-search-form]');
    const run = () => {
      const q = norm(input.value.trim());
      if (q.length < 2) return closeSearch();
      const hits = D.products.filter((p) => norm(p.name).includes(q)).slice(0, 6);
      const cats = D.categories.filter((c) => norm(c.name).includes(q)).slice(0, 4);
      box.innerHTML = `<div class="page-width search-results__inner">
        ${cats.length ? `<div class="search-results__cats">${cats.map((c) => `<a href="${c.href}">${esc(c.name)}</a>`).join('')}</div>` : ''}
        ${
          hits.length
            ? `<ul class="search-results__list">${hits
                .map((p) => `<li><a href="#" data-product-link="${p.id}">${picture(p.image, '', { sizes: '56px' })}<span>${esc(p.name)}<strong>${brl(p.price)}</strong></span></a></li>`)
                .join('')}</ul>`
            : `<p class="search-results__empty">Nenhum produto encontrado para “${esc(input.value.trim())}”.</p>`
        }
      </div>`;
      box.hidden = false;
    };
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-search-form]') && !e.target.closest('[data-search-results]')) closeSearch();
    });
  }

  /* ---------- Rodapé, cookies, newsletter ---------- */
  function initFooter() {
    const s = D.store;
    $$('[data-whatsapp-link]').forEach((a) => (a.href = whatsappUrl()));
    const items = [
      s.whatsapp && `<li><a href="${whatsappUrl()}" target="_blank" rel="noopener">WhatsApp: ${esc(s.phone)}</a></li>`,
      s.phone && `<li><a href="tel:+55${s.phone.replace(/\D/g, '')}">Telefone: ${esc(s.phone)}</a></li>`,
      s.email && `<li><a href="mailto:${esc(s.email)}">E-mail: ${esc(s.email)}</a></li>`,
      s.hours && `<li>${esc(s.hours)}</li>`,
      `<li><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}" target="_blank" rel="noopener">${esc(s.address)}</a></li>`,
    ].filter(Boolean);
    $('[data-contact-list]').innerHTML = items.join('');
    $('[data-legal]').innerHTML = `<p>© ${new Date().getFullYear()} ${esc(s.name.toUpperCase())}. Todos os direitos reservados.</p>
      <p>${esc(s.legalName)}${s.cnpj ? ` · CNPJ: ${esc(s.cnpj)}` : ''}<br>${esc(s.address)}</p>`;

    // Colunas do rodapé viram acordeão no celular.
    const syncCols = () => $$('[data-footer-col]').forEach((d) => (d.open = !mqMobile.matches));
    syncCols();
    mqMobile.addEventListener('change', syncCols);

    $('[data-newsletter]').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = $('[data-newsletter-msg]');
      msg.textContent = 'Pronto! Você vai receber nossas novidades e ofertas.';
      e.target.reset();
    });
  }

  function initCookie() {
    const el = $('[data-cookie]');
    if (store.get('atual:cookies', null)) return;
    el.hidden = false;
    const done = (v) => {
      store.set('atual:cookies', v);
      el.hidden = true;
    };
    $('[data-cookie-accept]').addEventListener('click', () => done('accepted'));
    $('[data-cookie-decline]').addEventListener('click', () => done('declined'));
  }

  initAnnouncement();
  initHeader();
  initHero();
  initCategories();
  initProducts();
  initCarousels();
  initMarquee();
  initEditorial();
  initDrawers();
  initCommerce();
  initSearch();
  initFooter();
  initCookie();
})();
