(() => {
  'use strict';

  const D = window.ATUAL;
  const S = D.store;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const byId = Object.fromEntries(D.products.map((p) => [p.id, p]));
  const mqMobile = window.matchMedia('(max-width: 749px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Utilitários ---------- */
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const cardTotal = (pix) => pix / (1 - S.pixDiscount);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const img = (name, { cls = '', eager = false, sizes = '' } = {}) => `<picture>
      <source type="image/webp" srcset="assets/img/${name}.webp">
      <img class="${cls}" src="assets/img/${name}.jpg" alt="" ${sizes ? `sizes="${sizes}"` : ''} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
    </picture>`;

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* armazenamento indisponível (aba anônima, bloqueio): segue sem persistir */
      }
    },
  };

  const wa = (text) => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(text)}`;
  const WA_TEXT = {
    help: 'Olá! Vim pelo site da Atual e gostaria de ajuda.',
    track: 'Olá! Gostaria de acompanhar o meu pedido.',
  };
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Atual Móveis e Eletro, ${S.address}`)}`;
  const productUrl = (p) => wa(`Olá! Tenho interesse no produto: ${p.name} (${brl(p.price)} no PIX). Pode me passar mais informações?`);

  let toastTimer;
  function toast(msg) {
    const el = $('[data-toast]');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  // Arrastar trilhos horizontais com o mouse (no toque o scroll nativo resolve).
  function dragScroll(el) {
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
        // reencaixa no card mais próximo depois de soltar
        const step = el.firstElementChild ? el.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || 0) : 0;
        if (step) el.scrollTo({ left: Math.round(el.scrollLeft / step) * step, behavior: 'smooth' });
      }
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

  // Pontos de paginação de um trilho horizontal.
  function pagerDots(track, dotsEl) {
    const pages = () => Math.max(1, Math.ceil((track.scrollWidth - 4) / Math.max(1, track.clientWidth)));
    const render = () => {
      const n = pages();
      dotsEl.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" aria-label="Ir para a página ${i + 1}" data-page="${i}"></button>`).join('') : '';
      update();
    };
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      const n = pages();
      const page = max <= 0 ? 0 : Math.round((track.scrollLeft / max) * (n - 1));
      $$('button', dotsEl).forEach((b, i) => {
        b.classList.toggle('is-active', i === page);
        b.setAttribute('aria-current', i === page ? 'true' : 'false');
      });
    };
    dotsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      const max = track.scrollWidth - track.clientWidth;
      track.scrollTo({ left: (max * +b.dataset.page) / Math.max(1, pages() - 1), behavior: 'smooth' });
    });
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    window.addEventListener('resize', render);
    render();
    return { render, update };
  }

  /* ---------- Barra de anúncio ---------- */
  function initAnnouncement() {
    const bar = $('[data-announcement]');
    bar.innerHTML = D.announcements
      .map((a, i) => `<p class="announcement__msg${i ? '' : ' is-active'}"><span>${esc(a.text)}</span><a class="announcement__cta" href="${a.href}">${esc(a.cta)}</a></p>`)
      .join('');
    const msgs = $$('.announcement__msg', bar);
    if (msgs.length < 2) return;
    let i = 0;
    setInterval(() => {
      if (reduceMotion.matches) return;
      msgs[i].classList.remove('is-active');
      i = (i + 1) % msgs.length;
      msgs[i].classList.add('is-active');
    }, 5000);
  }

  /* ---------- Cabeçalho ---------- */
  const header = $('[data-header]');
  const panels = new Set();

  function setPanel(name, open) {
    if (open) panels.add(name);
    else panels.delete(name);
    header.classList.toggle('has-panel', panels.size > 0);
  }

  function initHeader() {
    let ticking = false;
    const onScroll = () => {
      ticking = false;
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 0);
      header.classList.toggle('is-compact', y > 60);
    };
    onScroll();
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    }, { passive: true });

    // Navegação em linha + mega menu (≥ 1600px)
    const nav = $('[data-inline-nav]');
    nav.innerHTML = D.menu
      .filter((m) => m.href !== 'maps')
      .map((m) => {
        if (!m.children) {
          return `<div class="nav-item"><a class="nav-item__link${m.highlight ? ' is-hot' : ''}" href="${m.href}">${esc(m.label)}</a></div>`;
        }
        return `<div class="nav-item" data-mega>
          <a class="nav-item__link" href="#" aria-haspopup="true">${esc(m.label)} ${icon('i-caret')}</a>
          <div class="mega">
            ${m.children
              .map((g) => `<div class="mega__col"><a class="mega__title" href="#">${esc(g.label)}</a>${g.links.map((l) => `<a href="#">${esc(l)}</a>`).join('')}</div>`)
              .join('')}
          </div>
        </div>`;
      })
      .join('');
    $$('[data-mega]', nav).forEach((item) => {
      item.addEventListener('mouseenter', () => setPanel('mega', true));
      item.addEventListener('mouseleave', () => setPanel('mega', false));
      item.addEventListener('focusin', () => setPanel('mega', true));
      item.addEventListener('focusout', (e) => {
        if (!item.contains(e.relatedTarget)) setPanel('mega', false);
      });
      $('.nav-item__link', item).addEventListener('click', (e) => e.preventDefault());
    });

    // Conta (entrar / cadastrar)
    const acc = $('[data-account]');
    const accBtn = $('[data-account-toggle]', acc);
    const accMenu = $('.account__menu', acc);
    const setAcc = (open) => {
      accMenu.hidden = !open;
      accBtn.setAttribute('aria-expanded', String(open));
    };
    accBtn.addEventListener('click', () => setAcc(accMenu.hidden));
    document.addEventListener('click', (e) => {
      if (!acc.contains(e.target)) setAcc(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !accMenu.hidden) {
        setAcc(false);
        accBtn.focus();
      }
    });
  }

  /* ---------- Trava de rolagem + foco ---------- */
  let lockCount = 0;
  const lockScroll = (on) => {
    lockCount = Math.max(0, lockCount + (on ? 1 : -1));
    document.body.classList.toggle('is-locked', lockCount > 0);
  };

  const focusables = (root) =>
    $$('a[href], button:not([disabled]), input:not([type="hidden"]), summary, [tabindex]:not([tabindex="-1"])', root).filter(
      (el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length
    );

  function trapTab(e, root) {
    const f = focusables(root);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---------- Menu lateral ---------- */
  const menu = { el: null, overlay: null, btn: null, open: false, lastFocus: null };

  function menuMarkup() {
    const groupLinks = (g) => `<ul class="msub__links">${g.links.map((l) => `<li><a href="#">${esc(l)}</a></li>`).join('')}<li><a href="#">Ver tudo</a></li></ul>`;
    const items = D.menu.map((m, i) => {
      if (!m.children) {
        const href = m.href === 'maps' ? mapsUrl : m.href;
        const ext = m.href === 'maps' ? ' target="_blank" rel="noopener"' : '';
        return `<li><a class="mpill${m.highlight ? ' is-hot' : ''}" href="${href}"${ext} data-menu-link>${esc(m.label)}</a></li>`;
      }
      const subId = `msub-${i}`;
      const inner =
        m.children.length === 1
          ? groupLinks(m.children[0])
          : m.children
              .map((g, j) => {
                const gid = `${subId}-${j}`;
                return `<div class="msub__group">
                  <button class="msub__toggle" type="button" aria-expanded="false" aria-controls="${gid}">${esc(g.label)} <span class="plus" aria-hidden="true"></span></button>
                  <div id="${gid}" hidden>${groupLinks(g)}</div>
                </div>`;
              })
              .join('');
      return `<li>
        <button class="mpill" type="button" aria-expanded="false" aria-controls="${subId}">${esc(m.label)} <span class="plus" aria-hidden="true"></span></button>
        <div class="msub" id="${subId}" hidden>${inner}</div>
      </li>`;
    });
    items.push(`<li><a class="mpill mpill--cta" href="${wa(WA_TEXT.track)}" target="_blank" rel="noopener">Rastrear pedido</a></li>`);
    return items.join('');
  }

  function toggleMenu(force) {
    const open = force ?? !menu.open;
    if (open === menu.open) return;
    if (open) closeDrawer(false);
    menu.open = open;
    if (open) {
      menu.lastFocus = document.activeElement;
      document.documentElement.style.setProperty('--menu-top', `${Math.max(0, header.getBoundingClientRect().bottom)}px`);
      menu.overlay.hidden = false;
      requestAnimationFrame(() => menu.overlay.classList.add('is-visible'));
    } else {
      menu.overlay.classList.remove('is-visible');
      setTimeout(() => {
        if (!menu.open) menu.overlay.hidden = true;
      }, 160);
    }
    menu.el.classList.toggle('is-open', open);
    menu.el.setAttribute('aria-hidden', String(!open));
    menu.btn.setAttribute('aria-expanded', String(open));
    menu.btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    setPanel('menu', open);
    lockScroll(open);
    if (open) setTimeout(() => focusables(menu.el)[0]?.focus(), 60);
    else if (menu.lastFocus && document.activeElement && menu.el.contains(document.activeElement)) menu.btn.focus();
  }

  function initMenu() {
    menu.el = $('[data-menu-drawer]');
    menu.overlay = $('[data-menu-overlay]');
    menu.btn = $('[data-menu-toggle]');
    $('[data-menu-list]').innerHTML = menuMarkup();
    menu.btn.addEventListener('click', () => toggleMenu());
    menu.overlay.addEventListener('click', () => toggleMenu(false));
    menu.el.addEventListener('click', (e) => {
      const t = e.target.closest('[aria-controls]');
      if (t && menu.el.contains(t)) {
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        const open = t.getAttribute('aria-expanded') !== 'true';
        t.setAttribute('aria-expanded', String(open));
        t.classList.toggle('is-open', open);
        panel.hidden = !open;
        return;
      }
      if (e.target.closest('[data-menu-link]') || e.target.closest('.msub__links a')) toggleMenu(false);
    });
    menu.el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') trapTab(e, menu.el);
    });
    window.addEventListener('resize', () => {
      if (menu.open) document.documentElement.style.setProperty('--menu-top', `${Math.max(0, header.getBoundingClientRect().bottom)}px`);
    });
  }

  /* ---------- Gavetas da direita ---------- */
  const drawer = { el: null, lastFocus: null };
  const onOpen = {};
  const overlay = $('[data-overlay]');

  function openDrawer(id) {
    const el = document.getElementById(id);
    if (!el || drawer.el === el) return;
    toggleMenu(false);
    const prevFocus = drawer.el ? drawer.lastFocus : document.activeElement;
    if (drawer.el) closeDrawer(false);
    drawer.el = el;
    drawer.lastFocus = prevFocus;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    lockScroll(true);
    $$(`[aria-controls="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
    onOpen[id]?.();
    if (id === 'search-drawer') setTimeout(() => $('[data-search-input]').focus(), 60);
    else setTimeout(() => focusables(el)[0]?.focus(), 60);
  }

  function closeDrawer(restore = true) {
    const el = drawer.el;
    if (!el) return;
    drawer.el = null;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    $$(`[aria-controls="${el.id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    lockScroll(false);
    if (restore) {
      overlay.classList.remove('is-visible');
      setTimeout(() => {
        if (!drawer.el) overlay.hidden = true;
      }, 250);
      drawer.lastFocus?.focus?.();
    }
  }

  function initDrawers() {
    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-open-drawer]');
      if (opener) {
        e.preventDefault();
        openDrawer(opener.dataset.openDrawer);
        return;
      }
      const search = e.target.closest('[data-open-search]');
      if (search) {
        e.preventDefault();
        openDrawer('search-drawer');
        return;
      }
      if (e.target.closest('[data-close]') || e.target === overlay) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (drawer.el) closeDrawer();
        else if (menu.open) {
          toggleMenu(false);
          menu.btn.focus();
        }
      }
      if (e.key === 'Tab' && drawer.el) trapTab(e, drawer.el);
    });
  }

  /* ---------- Slideshow ---------- */
  function pinMarkup(p) {
    return `<a class="pin" href="${productUrl(p)}" target="_blank" rel="noopener" data-product="${p.id}">
      <span class="pin__thumb">${img(p.image)}</span>
      <span class="pin__info">
        <span class="pin__name">${esc(p.name)}</span>
        <span class="pin__price">${brl(p.price)} <small>no PIX</small></span>
      </span>
      ${icon('i-arrow', 'pin__arrow')}
    </a>`;
  }

  function initHero() {
    const root = $('[data-hero]');
    const wrap = $('[data-hero-slides]');
    const dots = $('[data-hero-dots]');
    wrap.innerHTML = D.hero
      .map((s, i) => {
        const pins = (s.products || []).map((id) => byId[id]).filter(Boolean);
        return `<div class="hero__slide${i ? '' : ' is-active'}" role="group" aria-roledescription="slide" aria-label="${i + 1} de ${D.hero.length}: ${esc(s.title)}"${i ? ' aria-hidden="true"' : ''}>
          <picture>
            <source media="(max-width: 749px)" type="image/webp" srcset="assets/img/${s.image}-m.webp">
            <source media="(max-width: 749px)" srcset="assets/img/${s.image}-m.jpg">
            <source type="image/webp" srcset="assets/img/${s.image}-wide.webp">
            <img class="hero__img" src="assets/img/${s.image}-wide.jpg" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
          </picture>
          <a class="hero__link" href="${s.href}" aria-label="${esc(`${s.title} — ${s.text}`)}"${i ? ' tabindex="-1"' : ''}></a>
          <div class="hero__copy" aria-hidden="true">
            <p class="hero__kicker">${esc(s.kicker)}</p>
            <p class="hero__title">${esc(s.title)}</p>
            <p class="hero__text">${esc(s.text)}</p>
          </div>
          ${
            pins.length
              ? `<div class="pins">
                  <div class="pins__head"><span class="pins__label">No ambiente</span><div class="pins__dots" data-pin-dots></div></div>
                  <div class="pins__list" data-pin-list>${pins.map(pinMarkup).join('')}</div>
                </div>`
              : ''
          }
        </div>`;
      })
      .join('');
    dots.innerHTML = D.hero.map((_, i) => `<button type="button" class="hero__dot${i ? '' : ' is-active'}" aria-label="Ir para o slide ${i + 1}"${i ? '' : ' aria-current="true"'}></button>`).join('');

    const slides = $$('.hero__slide', wrap);
    const dotBtns = $$('.hero__dot', dots);
    let current = 0;
    let timer = null;
    let hovering = false;

    const setInteractive = (slide, on) => {
      if (on) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', 'true');
      $$('a', slide).forEach((a) => (on ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
    };
    slides.forEach((s, i) => setInteractive(s, i === 0));

    const go = (n) => {
      const next = (n + slides.length) % slides.length;
      if (next === current) return;
      slides[current].classList.remove('is-active');
      setInteractive(slides[current], false);
      dotBtns[current].classList.remove('is-active');
      dotBtns[current].removeAttribute('aria-current');
      current = next;
      slides[current].classList.add('is-active');
      setInteractive(slides[current], true);
      dotBtns[current].classList.add('is-active');
      dotBtns[current].setAttribute('aria-current', 'true');
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const play = () => {
      stop();
      if (reduceMotion.matches || hovering || document.hidden) return;
      timer = setInterval(() => go(current + 1), 6000);
    };

    $('[data-hero-prev]').addEventListener('click', () => { go(current - 1); play(); });
    $('[data-hero-next]').addEventListener('click', () => { go(current + 1); play(); });
    dotBtns.forEach((b, i) => b.addEventListener('click', () => { go(i); play(); }));
    root.addEventListener('mouseenter', () => { hovering = true; stop(); });
    root.addEventListener('mouseleave', () => { hovering = false; play(); });
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) play(); });
    document.addEventListener('visibilitychange', play);

    // Deslizar no toque (fora da lista de produtos)
    let sx = null;
    let sy = null;
    root.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-pin-list]')) return stop();
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      stop();
    }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (sx !== null) {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(current + (dx < 0 ? 1 : -1));
      }
      sx = null;
      play();
    });

    $$('[data-pin-list]', wrap).forEach((list) => {
      dragScroll(list);
      const d = $('[data-pin-dots]', list.parentElement);
      if (d && list.children.length > 1) pagerDots(list, d);
    });
    play();
  }

  /* ---------- Categorias ---------- */
  function initCategories() {
    const track = $('[data-cats]');
    track.innerHTML = D.categories
      .map((c) => `<a class="cat" href="${c.href}"><span class="cat__tile">${img(c.image, { sizes: '140px' })}</span><span class="cat__name">${esc(c.name)}</span></a>`)
      .join('');
    dragScroll(track);
    pagerDots(track, $('[data-cats-dots]'));
  }

  /* ---------- Cards de produto ---------- */
  const BADGE = { novo: 'Lançamento', frete: 'Frete grátis' };

  function card(p, forceBadge) {
    const badge = forceBadge || p.badge;
    const wished = wishlist.includes(p.id);
    return `<article class="card" data-id="${p.id}">
      <div class="card__media">
        ${img(p.image, { cls: 'card__img1', sizes: '(max-width: 749px) 45vw, 264px' })}
        ${p.image2 ? img(p.image2, { cls: 'card__img2', sizes: '(max-width: 749px) 45vw, 264px' }) : ''}
      </div>
      <div class="card__ui">
        <div class="card__badges">
          ${badge && BADGE[badge] ? `<span class="badge">${BADGE[badge]}</span>` : ''}
          <div class="card__flags">
            <button class="glass card__wish${wished ? ' is-active' : ''}" type="button" aria-pressed="${wished}" aria-label="Favoritar ${esc(p.name)}" data-wish="${p.id}">
              ${icon('i-heart', 'i-empty')}${icon('i-heart-fill', 'i-full')}
            </button>
            ${p.fastDelivery ? `<span class="glass card__truck" title="Pronta entrega">${icon('i-truck')}<span class="visually-hidden">Pronta entrega</span></span>` : ''}
            ${p.promo ? `<span class="card__seal" title="Super oferta">${icon('i-seal')}<span class="visually-hidden">Super oferta</span></span>` : ''}
          </div>
        </div>
        <button class="card__add" type="button" aria-label="Adicionar ${esc(p.name)} ao carrinho" data-add="${p.id}">${icon('i-cart-plus')}</button>
      </div>
      <div class="card__info">
        <h3 class="card__title"><a class="card__link" href="${productUrl(p)}" target="_blank" rel="noopener" data-product="${p.id}">${esc(p.name)}</a></h3>
        <p class="card__price">
          ${p.compareAt ? `<s class="card__compare"><span class="visually-hidden">De </span>${brl(p.compareAt)}</s>` : ''}
          <span class="card__sale${p.promo ? ' is-promo' : ''}"><span class="visually-hidden">Por </span>${brl(p.price)}</span>
        </p>
        ${
          p.swatches && p.swatches.length
            ? `<div class="swatches" role="group" aria-label="Cores disponíveis">${p.swatches
                .map(
                  (s, i) =>
                    `<button class="swatch" type="button" style="--swatch:${esc(s.color)}" aria-pressed="${i === 0}" aria-label="Cor ${i + 1} de ${p.swatches.length}" data-swatch="${i}"><span></span></button>`
                )
                .join('')}</div>`
            : ''
        }
      </div>
    </article>`;
  }

  function initShelves() {
    $$('[data-products]').forEach((track) => {
      const ids = D.sections[track.dataset.products] || [];
      track.innerHTML = ids.map((id) => byId[id]).filter(Boolean).map((p) => card(p, track.dataset.badgeAll)).join('');
    });

    $$('[data-slider]').forEach((root) => {
      const track = $('[data-track]', root);
      const prev = $('[data-prev]', root);
      const next = $('[data-next]', root);
      const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
      const update = () => {
        const max = track.scrollWidth - track.clientWidth;
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= max - 2;
      };
      prev.addEventListener('click', () => track.scrollBy({ left: -(track.clientWidth + gap()), behavior: 'smooth' }));
      next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth + gap(), behavior: 'smooth' }));
      track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
      window.addEventListener('resize', update);
      dragScroll(track);
      pagerDots(track, $('[data-dots]', root));
      update();
    });

    document.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-swatch]');
      if (!sw) return;
      const cardEl = sw.closest('.card');
      const p = byId[cardEl.dataset.id];
      const s = p.swatches[+sw.dataset.swatch];
      $$('[data-swatch]', cardEl).forEach((b) => b.setAttribute('aria-pressed', String(b === sw)));
      if (s.image) {
        const pic = $('.card__img1', cardEl).parentElement;
        $('source', pic).srcset = `assets/img/${s.image}.webp`;
        $('img', pic).src = `assets/img/${s.image}.jpg`;
      }
    });
  }

  /* ---------- Faixa rolante ---------- */
  function initMarquee() {
    const track = $('[data-marquee]');
    const group = (hidden) => `<ul class="marquee__group"${hidden ? ' aria-hidden="true"' : ''}>${D.marquee.map((t) => `<li class="marquee__item">${esc(t)}</li>`).join('')}</ul>`;
    let anim = null;
    const build = () => {
      track.innerHTML = group(false);
      const w = track.firstElementChild.getBoundingClientRect().width || 1;
      // Repete o grupo até cobrir duas telas, para o loop não deixar buraco em monitores largos.
      const copies = Math.max(2, Math.ceil((window.innerWidth * 2) / w) + 1);
      track.innerHTML = group(false) + Array.from({ length: copies - 1 }, () => group(true)).join('');
      anim?.cancel();
      anim = null;
      if (reduceMotion.matches) return;
      anim = track.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-w}px,0,0)` }], {
        duration: (w / 27) * 1000,
        iterations: Infinity,
      });
    };
    track.style.animation = 'none';
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(build);
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(build, 200);
    });
  }

  /* ---------- Mosaicos ---------- */
  function initMosaics() {
    const tile = (t, sub) => `<a class="tile" href="${t.href}">
      ${img(t.image, { sizes: '(max-width: 749px) 100vw, 50vw' })}
      <span class="tile__overlay"><span class="tile__title">${esc(t.title)}</span>${sub && t.text ? `<span class="tile__sub">${esc(t.text)}</span>` : ''}</span>
    </a>`;
    $('[data-editorial]').innerHTML = D.editorial.map((t) => tile(t, true)).join('');
    $('[data-rooms]').innerHTML = D.rooms.map((t) => tile(t, false)).join('');
  }

  /* ---------- Favoritos ---------- */
  let wishlist = storage.get('atual:wishlist', []).filter((id) => byId[id]);

  function renderWishlist() {
    $$('[data-wish]').forEach((b) => {
      if (!b.classList.contains('card__wish')) return;
      const on = wishlist.includes(b.dataset.wish);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const count = $('[data-wishlist-count]');
    count.textContent = wishlist.length;
    count.hidden = !wishlist.length;
    $('[data-wishlist]').innerHTML = `
      <div class="cart__head">
        <h2 class="cart__title">Favoritos</h2>
        <span class="cart__count">${wishlist.length ? plural(wishlist.length, 'item', 'itens') : ''}</span>
        <button class="drawer__close" type="button" aria-label="Fechar favoritos" data-close>${icon('i-close')}</button>
      </div>
      <div class="cart__body">
        ${
          wishlist.length
            ? wishlist
                .map((id) => byId[id])
                .map(
                  (p) => `<div class="line">
                    <a class="line__img" href="${productUrl(p)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${img(p.image)}</a>
                    <div>
                      <div class="line__top">
                        <p class="line__name">${esc(p.name)}</p>
                        <button class="line__remove" type="button" aria-label="Remover ${esc(p.name)} dos favoritos" data-wish="${p.id}">${icon('i-trash')}</button>
                      </div>
                      <div class="line__bottom">
                        <button class="upsell__btn" type="button" data-add="${p.id}">Levar</button>
                        <span class="line__price">${brl(p.price)} <small>no PIX</small></span>
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
        }
      </div>`;
  }

  function toggleWish(id) {
    const on = wishlist.includes(id);
    wishlist = on ? wishlist.filter((x) => x !== id) : [...wishlist, id];
    storage.set('atual:wishlist', wishlist);
    renderWishlist();
    toast(on ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
  }

  /* ---------- Carrinho ---------- */
  let cart = storage.get('atual:cart', []).filter((l) => byId[l.id] && l.qty > 0);

  const totals = () => {
    const pix = cart.reduce((s, l) => s + byId[l.id].price * l.qty, 0);
    return { pix, card: cardTotal(pix), count: cart.reduce((s, l) => s + l.qty, 0) };
  };

  function checkoutMessage() {
    const t = totals();
    const lines = cart.map((l) => `• ${l.qty}x ${byId[l.id].name} — ${brl(byId[l.id].price * l.qty)}`);
    return `Olá! Quero finalizar meu pedido pelo site da Atual:\n${lines.join('\n')}\n\nTotal no PIX: ${brl(t.pix)}\nou ${brl(t.card)} em até ${S.installments}x de ${brl(t.card / S.installments)} sem juros`;
  }

  function renderCart() {
    cart = cart.filter((l) => byId[l.id] && l.qty > 0);
    storage.set('atual:cart', cart);
    const t = totals();
    const bubble = $('[data-cart-count]');
    bubble.textContent = t.count;
    bubble.hidden = !t.count;

    const head = `<div class="cart__head">
        <h2 class="cart__title">Seu Carrinho</h2>
        <span class="cart__count">${t.count ? plural(t.count, 'item', 'itens') : ''}</span>
        <button class="drawer__close" type="button" aria-label="Fechar carrinho" data-close>${icon('i-close')}</button>
      </div>`;

    if (!cart.length) {
      $('[data-cart]').innerHTML = `${head}<div class="cart__body"><div class="cart-empty">
          <span class="cart-empty__icon">${icon('i-cart')}</span>
          <p class="cart-empty__title">O carrinho está vazio</p>
          <button class="btn-checkout" type="button" data-close>CONTINUAR COMPRANDO ${icon('i-arrow')}</button>
        </div></div>`;
      return;
    }

    const missing = Math.max(0, S.freeShippingMin - t.pix);
    const pct = Math.min(100, (t.pix / S.freeShippingMin) * 100);
    const ship = `<div class="ship">
        ${missing > 0 ? `Faltam <strong>${brl(missing)}</strong> para ganhar frete grátis em Ponte Nova e região*` : '<strong>Você ganhou frete grátis</strong> em Ponte Nova e região!*'}
        <div class="ship__bar" role="progressbar" aria-label="Progresso para o frete grátis" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>
      </div>`;

    const lines = cart
      .map((l) => {
        const p = byId[l.id];
        return `<div class="line">
          <a class="line__img" href="${productUrl(p)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${img(p.image)}</a>
          <div>
            <div class="line__top">
              <p class="line__name">${esc(p.name)}</p>
              <button class="line__remove" type="button" aria-label="Remover ${esc(p.name)}" data-remove="${p.id}">${icon('i-trash')}</button>
            </div>
            <div class="line__bottom">
              <div class="qty" role="group" aria-label="Quantidade de ${esc(p.name)}">
                <button type="button" aria-label="Diminuir quantidade" data-qty="${p.id}" data-delta="-1">${icon('i-minus')}</button>
                <span aria-live="polite">${l.qty}</span>
                <button type="button" aria-label="Aumentar quantidade" data-qty="${p.id}" data-delta="1">${icon('i-plus')}</button>
              </div>
              <span class="line__price">${brl(p.price * l.qty)} <small>no PIX</small></span>
            </div>
          </div>
        </div>`;
      })
      .join('');

    const inCart = new Set(cart.map((l) => l.id));
    const recs = D.sections.queridinhos.filter((id) => !inCart.has(id)).slice(0, 3).map((id) => byId[id]);
    const upsell = recs.length
      ? `<div class="upsell">
          <p class="upsell__title">Complete seu ambiente!</p>
          <div class="upsell__list">${recs
            .map(
              (p) => `<div class="upsell__item">
                <span class="upsell__img">${img(p.image)}</span>
                <div><p class="upsell__name">${esc(p.name)}</p><p class="upsell__price">${brl(p.price)} <small>no PIX</small></p></div>
                <button class="upsell__btn" type="button" data-add="${p.id}" aria-label="Levar ${esc(p.name)}">Levar</button>
              </div>`
            )
            .join('')}</div>
        </div>`
      : '';

    $('[data-cart]').innerHTML = `${head}
      <div class="cart__body">${ship}${lines}${upsell}</div>
      <div class="cart__foot">
        <div class="cart__row"><span>Subtotal</span><span>${brl(t.pix)}</span></div>
        <div class="cart__row"><span>Entrega</span><span>A combinar</span></div>
        <div class="cart__total"><span>Total no PIX</span><strong>${brl(t.pix)}</strong></div>
        <p class="cart__installments">ou <strong>${brl(t.card)}</strong> em até <strong>${S.installments}x de ${brl(t.card / S.installments)}</strong> sem juros</p>
        <a class="btn-checkout" href="${wa(checkoutMessage())}" target="_blank" rel="noopener">${icon('i-whatsapp')} Finalizar pelo WhatsApp</a>
        <button class="cart__continue" type="button" data-close>Continuar comprando</button>
      </div>`;
  }

  function addToCart(id) {
    const l = cart.find((x) => x.id === id);
    if (l) l.qty += 1;
    else cart.push({ id, qty: 1 });
    renderCart();
    openDrawer('cart-drawer');
  }

  function initCommerce() {
    document.addEventListener('click', (e) => {
      const wish = e.target.closest('[data-wish]');
      if (wish) {
        e.preventDefault();
        toggleWish(wish.dataset.wish);
        return;
      }
      const add = e.target.closest('[data-add]');
      if (add) {
        e.preventDefault();
        addToCart(add.dataset.add);
        return;
      }
      const qty = e.target.closest('[data-qty]');
      if (qty) {
        const l = cart.find((x) => x.id === qty.dataset.qty);
        if (l) l.qty += +qty.dataset.delta;
        renderCart();
        const again = $(`[data-qty="${qty.dataset.qty}"][data-delta="${qty.dataset.delta}"]`);
        (again || $('[data-cart] .drawer__close'))?.focus();
        return;
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        cart = cart.filter((x) => x.id !== rm.dataset.remove);
        renderCart();
        $('[data-cart] .drawer__close')?.focus();
        return;
      }
      const prod = e.target.closest('[data-product]');
      if (prod) rememberViewed(prod.dataset.product);
    });
    renderWishlist();
    renderCart();
  }

  /* ---------- Busca ---------- */
  let viewed = storage.get('atual:viewed', []).filter((id) => byId[id]);

  function rememberViewed(id) {
    viewed = [id, ...viewed.filter((x) => x !== id)].slice(0, 6);
    storage.set('atual:viewed', viewed);
  }

  // Termos que levam a grupos de categorias.
  const SYNONYMS = {
    'sala de estar': ['Sofás', 'Poltronas', 'Mesas de Centro', 'Mesas Laterais', 'Smart TVs'],
    sala: ['Sofás', 'Poltronas', 'Mesas de Centro', 'Mesas Laterais', 'Cadeiras'],
    quarto: ['Camas', 'Colchões', 'Criados-mudos', 'Cômodas'],
    cozinha: ['Geladeiras', 'Fogões', 'Eletroportáteis'],
    eletro: ['Geladeiras', 'Fogões', 'Lavadoras', 'Smart TVs', 'Eletroportáteis'],
    tv: ['Smart TVs'],
    sofa: ['Sofás'],
    colchao: ['Colchões'],
    cama: ['Camas', 'Colchões'],
    mesa: ['Mesas de Centro', 'Mesas Laterais', 'Cadeiras'],
    geladeira: ['Geladeiras'],
    refrigerador: ['Geladeiras'],
    fogao: ['Fogões'],
    lavadora: ['Lavadoras'],
    'maquina de lavar': ['Lavadoras'],
    cafeteira: ['Eletroportáteis'],
  };

  const vocab = Array.from(new Set(D.products.flatMap((p) => [p.category, ...norm(p.name).split(/[^a-z0-9]+/)]).filter((w) => w && w.length > 3)));

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

  function searchProducts(q) {
    const nq = norm(q);
    if (nq === 'mais vendidos') return D.sections.queridinhos.map((id) => byId[id]);
    const singular = nq.replace(/(oes|aes)$/, 'ao').replace(/s$/, '');
    const cats = new Set();
    Object.entries(SYNONYMS).forEach(([k, v]) => {
      if (nq === k || singular === k || (nq.length >= 3 && k.startsWith(nq))) v.forEach((c) => cats.add(c));
    });
    const terms = nq.split(/\s+/).filter(Boolean);
    return D.products.filter((p) => {
      const hay = norm(`${p.name} ${p.category}`);
      return cats.has(p.category) || terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')));
    });
  }

  function highlight(text, q) {
    const n = norm(text);
    const i = n.indexOf(norm(q));
    if (i < 0) return esc(text);
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  }

  function initSearch() {
    const input = $('[data-search-input]');
    const body = $('[data-search-body]');
    const clear = $('[data-search-clear]');
    const all = $('[data-search-all]');
    const form = $('[data-search-form]');
    let showAll = false;
    let debounce;
    let active = -1;

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

    const resultItem = (p, i) => `<a class="sresult" id="sr-${i}" role="option" aria-selected="false" href="${productUrl(p)}" target="_blank" rel="noopener" data-product="${p.id}">
        <span class="sresult__img">${img(p.image)}</span>
        <span>
          <span class="sresult__cat">${esc(p.category)}</span>
          <span class="sresult__name">${esc(p.name)}</span>
          <span class="sresult__price">${p.compareAt ? `<s>${brl(p.compareAt)}</s> — ` : ''}<strong>${brl(p.price)}</strong> <small>no PIX</small></span>
        </span>
      </a>`;

    const defaults = () => {
      const recent = viewed.map((id) => byId[id]).filter(Boolean);
      body.innerHTML = `
        <div class="search__section">
          <p class="search__label">Categorias</p>
          <div class="chips">${D.searchCategories.map((c) => `<button class="chip" type="button" data-query="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        </div>
        <div class="search__section">
          <p class="search__label">Buscas populares</p>
          <ul class="qlist" role="listbox" aria-label="Buscas populares">${D.popularSearches
            .map((q, i) => `<li><a href="#" id="sq-${i}" role="option" aria-selected="false" data-query="${esc(q)}">${icon('i-search')}${esc(q)}</a></li>`)
            .join('')}</ul>
        </div>
        ${
          recent.length
            ? `<div class="search__section"><p class="search__label">Vistos por último</p><div class="sresults" role="listbox" aria-label="Vistos por último">${recent
                .map((p, i) => resultItem(p, `v${i}`))
                .join('')}</div></div>`
            : ''
        }`;
      all.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    };

    const run = () => {
      const q = input.value.trim();
      clear.hidden = !q;
      if (q.length < 2) return defaults();
      const hits = searchProducts(q);
      const nq = norm(q);
      const sugg = Array.from(
        new Set([...D.categories.map((c) => c.name), ...D.popularSearches, ...D.products.map((p) => p.category)].filter((s) => norm(s).includes(nq)))
      ).slice(0, 4);
      let didYouMean = '';
      if (!hits.length && nq.length >= 3) {
        const best = vocab.map((w) => [w, levenshtein(nq, norm(w))]).sort((a, b) => a[1] - b[1])[0];
        if (best && best[1] <= 2) didYouMean = best[0];
      }
      const shown = showAll ? hits : hits.slice(0, 6);
      body.innerHTML = `
        ${didYouMean ? `<p class="did-you-mean">Você quis dizer: <button type="button" data-query="${esc(didYouMean)}">${esc(didYouMean)}</button>?</p>` : ''}
        ${
          sugg.length
            ? `<div class="search__section"><p class="search__label">Sugestões</p><ul class="qlist" role="listbox" aria-label="Sugestões">${sugg
                .map((s, i) => `<li><a href="#" id="ss-${i}" role="option" aria-selected="false" data-query="${esc(s)}">${icon('i-search')}<span>${highlight(s, q)}</span></a></li>`)
                .join('')}</ul></div>`
            : ''
        }
        ${
          hits.length
            ? `<div class="search__section"><p class="search__label">Produtos</p><div class="sresults" role="listbox" aria-label="Produtos">${shown.map(resultItem).join('')}</div></div>`
            : `<div class="search__empty"><strong>Nenhum resultado para “${esc(q)}”</strong><p>Tente outras palavras ou fale com um vendedor no WhatsApp.</p></div>`
        }`;
      all.hidden = !(hits.length > shown.length);
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    };

    input.addEventListener('input', () => {
      showAll = false;
      clearTimeout(debounce);
      debounce = setTimeout(run, 50);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        options()[active].click();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      run();
    });
    clear.addEventListener('click', () => {
      input.value = '';
      run();
      input.focus();
    });
    all.addEventListener('click', (e) => {
      e.preventDefault();
      showAll = true;
      run();
    });
    body.addEventListener('click', (e) => {
      const q = e.target.closest('[data-query]');
      if (!q) return;
      e.preventDefault();
      input.value = q.dataset.query;
      showAll = false;
      run();
      input.focus();
    });
    defaults();

    // Atalhos: ?busca=termo ou ?open-search=1 abrem a busca
    const params = new URLSearchParams(location.search);
    if (params.has('busca') || params.get('open-search') === '1') {
      input.value = params.get('busca') || '';
      openDrawer('search-drawer');
      run();
    }
    onOpen['search-drawer'] = () => (input.value.trim() ? run() : defaults());
  }

  /* ---------- Rodapé ---------- */
  function initFooter() {
    $$('[data-whatsapp]').forEach((a) => (a.href = wa(WA_TEXT[a.dataset.whatsapp] || WA_TEXT.help)));
    $$('[data-maps]').forEach((a) => (a.href = mapsUrl));

    const social = [
      S.instagram && `<li><a href="${S.instagram}" target="_blank" rel="noopener" aria-label="Instagram">${icon('i-instagram')}</a></li>`,
      S.facebook && `<li><a href="${S.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${icon('i-facebook')}</a></li>`,
      S.whatsapp && `<li><a href="${wa(WA_TEXT.help)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('i-whatsapp')}</a></li>`,
    ]
      .filter(Boolean)
      .join('');
    $$('[data-socials]').forEach((ul) => (ul.innerHTML = social));

    const tel = S.phone.replace(/\D/g, '');
    $('[data-contact]').innerHTML = [
      S.whatsapp && `<p><a href="${wa(WA_TEXT.help)}" target="_blank" rel="noopener">WhatsApp: ${esc(S.phone)}</a></p>`,
      S.phone && `<p><a href="tel:+55${tel}">Telefone: ${esc(S.phone)}</a></p>`,
      S.email && `<p><a href="mailto:${esc(S.email)}">E-mail: ${esc(S.email)}</a></p>`,
      S.hours && `<p>${esc(S.hours)}</p>`,
      `<p><a href="${mapsUrl}" target="_blank" rel="noopener">${esc(S.address)}</a></p>`,
    ]
      .filter(Boolean)
      .join('');

    $('[data-legal]').innerHTML = `<div>
        <p>© ${new Date().getFullYear()} ${esc(S.name.toUpperCase())}. Todos os direitos reservados.</p>
        <p>${esc(S.legalName)}${S.cnpj ? `. CNPJ: ${esc(S.cnpj)}` : ''}<br>${esc(S.address)}</p>
      </div>
      <p>*Consulte condições de entrega e frete grátis com a loja.</p>`;

    // No celular as colunas viram acordeão (Atendimento aberto); no desktop ficam sempre abertas.
    const cols = $$('[data-footer-col]');
    const sync = () => cols.forEach((d) => (d.open = !mqMobile.matches || d.hasAttribute('data-open-mobile')));
    sync();
    mqMobile.addEventListener('change', sync);
    cols.forEach((d) =>
      $('summary', d).addEventListener('click', (e) => {
        if (!mqMobile.matches) e.preventDefault();
      })
    );

    const form = $('[data-newsletter]');
    const msg = $('[data-newsletter-msg]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      msg.className = `newsletter__msg ${ok ? 'is-ok' : 'is-error'}`;
      msg.textContent = ok ? 'Pronto! Você vai receber nossas novidades e ofertas.' : 'Digite um e-mail válido.';
      if (ok) form.reset();
    });
  }

  /* ---------- Cookies ---------- */
  function initCookie() {
    const el = $('[data-cookie]');
    if (storage.get('atual:cookies', null)) return;
    setTimeout(() => (el.hidden = false), 1200);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cookie-choice]');
      if (!b) return;
      storage.set('atual:cookies', b.dataset.cookieChoice);
      el.hidden = true;
    });
  }

  initAnnouncement();
  initHeader();
  initMenu();
  initDrawers();
  initHero();
  initCategories();
  initShelves();
  initMarquee();
  initMosaics();
  initCommerce();
  initSearch();
  initFooter();
  initCookie();
})();
