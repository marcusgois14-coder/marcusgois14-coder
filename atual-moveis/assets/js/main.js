// Loja virtual da rede Atual Móveis: escolhe a loja, carrega o catálogo dela e cuida das rotas.
import { $, $$, esc, icon, rpc, toast, storage, waLink, mapsLink, bizMessage, fmtPhone } from './lib.js';
import { S, on, emit, setStorefront, storesForLocation, storeWhatsapp, storeAddress } from './state.js';
import { initLayers, closeDrawer, closeSheet, sheet } from './layers.js';
import { initPicker, openPicker, updateStoreUI } from './picker.js';
import {
  renderHome,
  renderListing,
  renderMenus,
  initSearch,
  initMenuDrawer,
  initProductSheet,
  initCatalogClicks,
  openProduct,
  storePath,
  mqMobile,
} from './catalog.js';
import { initCart, loadCart, renderCart, openTrack } from './cart.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const header = $('[data-header]');
let homeFor = null; // id da loja cuja página inicial já está montada
let trackOpenedFor = null;

/* ---------- Tema (cores e logos da rede) ---------- */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function applyTheme() {
  const root = document.documentElement.style;
  const rgb = hexToRgb(S.net.primary_color);
  if (rgb) {
    root.setProperty('--accent', S.net.primary_color);
    root.setProperty('--accent-rgb', rgb.join(', '));
    root.setProperty('--accent-hover', `rgb(${rgb.map((c) => Math.round(c * 0.88)).join(', ')})`);
    root.setProperty('--promo', `rgb(${rgb.map((c) => Math.round(c * 0.88)).join(', ')})`);
    $('meta[name="theme-color"]')?.setAttribute('content', S.net.primary_color);
  }
  if (S.net.logo_url) $$('[data-logo-color]').forEach((i) => (i.src = S.net.logo_url));
  if (S.net.logo_white_url) $$('[data-logo-white]').forEach((i) => (i.src = S.net.logo_white_url));
  const brand = S.store.brand_name || S.net.name || 'Atual Móveis';
  $('[data-home-link]').setAttribute('aria-label', `${brand} — página inicial da loja ${S.store.city}`);
}

/* ---------- Barra de anúncio ---------- */
let annTimer = null;
function renderAnnouncement() {
  const bar = $('[data-announcement]');
  const list = S.sf.announcements || [];
  clearInterval(annTimer);
  bar.hidden = !list.length;
  bar.innerHTML = list
    .map(
      (a, i) =>
        `<p class="announcement__msg${i ? '' : ' is-active'}"${i ? ' aria-hidden="true"' : ''}><span>${esc(a.text)}</span>${
          a.cta_label && a.cta_url ? `<a class="announcement__cta" href="${esc(a.cta_url)}" data-route${i ? ' tabindex="-1"' : ''}>${esc(a.cta_label)}</a>` : ''
        }</p>`
    )
    .join('');
  const msgs = $$('.announcement__msg', bar);
  if (msgs.length < 2) return;
  let i = 0;
  annTimer = setInterval(() => {
    if (reduceMotion.matches || bar.matches(':hover') || bar.contains(document.activeElement)) return;
    msgs[i].classList.remove('is-active');
    msgs[i].setAttribute('aria-hidden', 'true');
    $('a', msgs[i])?.setAttribute('tabindex', '-1');
    i = (i + 1) % msgs.length;
    msgs[i].classList.add('is-active');
    msgs[i].removeAttribute('aria-hidden');
    $('a', msgs[i])?.removeAttribute('tabindex');
  }, 5000);
}

/* ---------- Rodapé ---------- */
const BENEFIT_ICON = { shield: 'i-b-shield', truck: 'i-truck', card: 'i-b-card', chat: 'i-b-chat' };
const CARD_SVGS = [
  '<svg viewBox="0 0 38 24" role="img" aria-label="Visa"><rect width="38" height="24" rx="3" fill="#1434CB"/><path fill="#fff" d="M15.6 16.4h-2.3l1.4-8.8H17zm-4.1-8.8-2.2 6-.3-1.3-.8-4s-.1-.7-1-.7H3.7v.2s1 .2 2.3.9l1.9 7.7h2.4l3.6-8.8zm18 8.8h2l-1.8-8.8h-1.8c-.8 0-1 .6-1 .6l-3.3 8.2h2.3l.5-1.3h2.8zm-2.4-3.1 1.2-3.3.6 3.3zM23.8 9.8l.3-1.9s-1-.4-2-.4c-1.1 0-3.7.5-3.7 2.8 0 2.2 3 2.2 3 3.3s-2.7.9-3.6.2l-.3 2s1 .5 2.5.5c1.5 0 3.8-.8 3.8-2.9 0-2.2-3.1-2.4-3.1-3.3 0-1 2.2-.9 3.1-.3z"/></svg>',
  '<svg viewBox="0 0 38 24" role="img" aria-label="Mastercard"><rect width="38" height="24" rx="3" fill="#252525"/><circle cx="15" cy="12" r="7" fill="#EB001B"/><circle cx="23" cy="12" r="7" fill="#F79E1B"/><path fill="#FF5F00" d="M19 6.3a7 7 0 0 1 0 11.4 7 7 0 0 1 0-11.4z"/></svg>',
  '<svg viewBox="0 0 38 24" role="img" aria-label="Elo"><rect width="38" height="24" rx="3" fill="#000"/><circle cx="10.5" cy="12" r="3.6" fill="none" stroke="#FFCB05" stroke-width="1.6" stroke-dasharray="7.5 15"/><circle cx="10.5" cy="12" r="3.6" fill="none" stroke="#00A4E0" stroke-width="1.6" stroke-dasharray="7.5 15" stroke-dashoffset="7.5"/><circle cx="10.5" cy="12" r="3.6" fill="none" stroke="#EF4123" stroke-width="1.6" stroke-dasharray="7.5 15" stroke-dashoffset="15"/><text x="24" y="15.6" fill="#fff" font-family="Arial,sans-serif" font-size="10" font-weight="700" text-anchor="middle">elo</text></svg>',
  '<svg viewBox="0 0 38 24" role="img" aria-label="Hipercard"><rect width="38" height="24" rx="3" fill="#B3131B"/><text x="19" y="15" fill="#fff" font-family="Arial,sans-serif" font-size="7" font-style="italic" font-weight="700" text-anchor="middle">Hipercard</text></svg>',
  '<svg viewBox="0 0 38 24" role="img" aria-label="American Express"><rect width="38" height="24" rx="3" fill="#2E77BC"/><text x="19" y="15" fill="#fff" font-family="Arial,sans-serif" font-size="7.5" font-weight="700" text-anchor="middle">AMEX</text></svg>',
];
const PIX_SVG =
  '<svg viewBox="0 0 38 24" role="img" aria-label="PIX"><rect x=".5" y=".5" width="37" height="23" rx="2.5" fill="#fff" stroke="#D9D9D9"/><path fill="#32BCAD" d="M11 6.2l5.8 5.8-5.8 5.8L5.2 12z"/><path fill="#fff" d="M11 9.6l2.4 2.4-2.4 2.4L8.6 12z"/><text x="25.5" y="15.4" fill="#32BCAD" font-family="Arial,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">pix</text></svg>';
const CREDIARIO_SVG =
  '<svg viewBox="0 0 38 24" role="img" aria-label="Crediário da loja"><rect width="38" height="24" rx="3" fill="#F4802B"/><text x="19" y="14.6" fill="#191919" font-family="Arial,sans-serif" font-size="6.2" font-weight="700" text-anchor="middle" textLength="32" lengthAdjust="spacingAndGlyphs">crediário</text></svg>';
const CASH_SVG =
  '<svg viewBox="0 0 38 24" role="img" aria-label="Dinheiro"><rect x=".5" y=".5" width="37" height="23" rx="2.5" fill="#E8F5E9" stroke="#B7DDB9"/><text x="19" y="14.8" fill="#1B5E20" font-family="Arial,sans-serif" font-size="6.6" font-weight="700" text-anchor="middle">dinheiro</text></svg>';

function renderFooter() {
  const st = S.store;
  const net = S.net;
  const wa = storeWhatsapp();
  const waHelp = waLink(wa, `Olá! Vim pelo site da ${st.name} e preciso de ajuda.`);
  const maps = mapsLink(`${st.name}, ${storeAddress()}`);

  $('[data-benefits]').innerHTML = (net.benefits || [])
    .map(
      (b) => `<li class="benefit">${icon(BENEFIT_ICON[b.icon] || 'i-b-shield', `benefit__icon${b.icon === 'truck' ? ' benefit__icon--truck' : ''}`)}
        <div><h3 class="benefit__title">${esc(b.title)}</h3><p class="benefit__text">${esc(b.text)}</p></div></li>`
    )
    .join('');
  if (net.slogan) $('[data-slogan]').innerHTML = esc(net.slogan).replace(/\n/g, '<br>');

  const insta = st.instagram || net.instagram;
  const fb = st.facebook || net.facebook;
  const social = [
    insta && `<li><a href="${esc(insta)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('i-instagram')}</a></li>`,
    fb && `<li><a href="${esc(fb)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('i-facebook')}</a></li>`,
    wa && `<li><a href="${esc(waHelp)}" target="_blank" rel="noopener" aria-label="WhatsApp da loja">${icon('i-whatsapp')}</a></li>`,
  ]
    .filter(Boolean)
    .join('');
  $$('[data-socials]').forEach((ul) => (ul.innerHTML = social));

  const phone = st.phone || st.whatsapp;
  $('[data-contact]').innerHTML = [
    `<p><strong>${esc(st.name)}</strong></p>`,
    wa && `<p><a href="${esc(waHelp)}" target="_blank" rel="noopener">WhatsApp: ${esc(fmtPhone(wa.replace(/^55/, '')))}</a></p>`,
    phone && `<p><a href="tel:+${esc(phone.replace(/\D/g, '').replace(/^(?!55)/, '55'))}">Telefone: ${esc(fmtPhone(phone.replace(/\D/g, '').replace(/^55/, '')))}</a></p>`,
    st.email && `<p><a href="mailto:${esc(st.email)}">E-mail: ${esc(st.email)}</a></p>`,
    st.hours && `<p>${esc(st.hours)}</p>`,
    `<p><a href="${esc(maps)}" target="_blank" rel="noopener">${esc(storeAddress())}</a></p>`,
  ]
    .filter(Boolean)
    .join('');

  $$('[data-store-maps]').forEach((a) => (a.href = maps));
  $$('[data-store-wa]').forEach((a) => {
    a.href = waLink(wa, `Olá! Vim pelo site da ${st.name}.`);
    a.hidden = !wa;
  });

  const methods = st.payment_methods || [];
  $('[data-payments]').innerHTML = [
    ...(methods.includes('card_on_delivery') || methods.includes('card_link') ? CARD_SVGS : []),
    methods.includes('pix') && PIX_SVG,
    methods.includes('crediario') && CREDIARIO_SVG,
    methods.includes('cash') && CASH_SVG,
  ]
    .filter(Boolean)
    .map((s) => `<li>${s}</li>`)
    .join('');

  $('[data-legal]').innerHTML = `<div>
      <p>© ${new Date().getFullYear()} ${esc((net.name || 'Atual Móveis').toUpperCase())}. Todos os direitos reservados.</p>
      <p>${esc(st.name)} · ${esc(storeAddress())}</p>
    </div>
    ${net.footer_legal ? `<p>${esc(net.footer_legal)}</p>` : ''}`;

  const cities = S.stores.map((s) => `<a href="/loja/${esc(s.slug)}" data-store-link="${esc(s.slug)}">${esc(s.name)}</a>`).join(', ');
  $('[data-about-title]').textContent = `${net.name || 'Atual Móveis'}: móveis, colchões e eletro em Minas Gerais`;
  $('[data-about]').innerHTML = `<p>A rede ${esc(net.name || 'Atual Móveis')} tem ${S.stores.length} lojas em Minas Gerais. Cada loja tem o seu próprio catálogo e estoque, e entrega em até ${esc(
    net.default_radius_km || 30
  )} km do endereço da loja, com equipe própria de entrega e montagem.</p>
    <p>Você está comprando na <strong>${esc(st.name)}</strong>, em ${esc(st.city)} - ${esc(st.state)}. Os preços em destaque são para pagamento no PIX${
      Number(st.pix_discount_pct) > 0 ? ` (${String(st.pix_discount_pct).replace('.', ',')}% de desconto)` : ''
    }; no cartão, parcele em até ${esc(st.max_installments)}x sem juros.</p>
    <p>Nossas lojas: ${cities}.</p>`;
}

function initFooter() {
  const cols = $$('[data-footer-col]');
  const sync = () => cols.forEach((d) => (d.open = !mqMobile.matches || d.hasAttribute('data-open-mobile')));
  sync();
  mqMobile.addEventListener('change', sync);
  cols.forEach((d) =>
    $('summary', d).addEventListener('click', (e) => {
      if (!mqMobile.matches) e.preventDefault();
    })
  );
  // Sem disparo de e-mail no site: o cadastro de novidades é feito pelo WhatsApp da loja.
  const form = $('[data-newsletter]');
  const msg = $('[data-newsletter-msg]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    msg.className = `newsletter__msg ${ok ? 'is-ok' : 'is-error'}`;
    if (!ok) {
      msg.textContent = 'Digite um e-mail válido.';
      form.email.focus();
      return;
    }
    const wa = storeWhatsapp();
    if (!wa) {
      msg.textContent = 'Siga a loja no Instagram para receber as novidades.';
      return;
    }
    window.open(waLink(wa, `Olá! Quero receber as novidades e ofertas da ${S.store.name}. Meu e-mail: ${email}`), '_blank', 'noopener');
    msg.textContent = 'Abrimos o WhatsApp da loja para confirmar seu cadastro.';
    form.reset();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-store-link]');
    if (a && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      storage.set('atual:picked', true);
      emit('store-select', a.dataset.storeLink);
    }
  });
}

/* ---------- Cookies ---------- */
function initCookie() {
  const el = $('[data-cookie]');
  if (storage.get('atual:cookies', null)) return;
  setTimeout(() => (el.hidden = false), 5000);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cookie-choice]');
    if (!b) return;
    storage.set('atual:cookies', b.dataset.cookieChoice);
    el.hidden = true;
  });
}

/* ---------- Cabeçalho ---------- */
function initHeader() {
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 0);
    header.classList.toggle('is-compact', y > 60);
  };
  onScroll();
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
}

/* ---------- Rotas ---------- */
// /loja/<slug>               página inicial da loja
// /loja/<slug>?categoria=…    listagem (também ?colecao=, ?busca=, ?todos=1)
// /loja/<slug>?produto=…      produto aberto sobre a página
// /pedido/<token>             acompanhamento do pedido
function isListing(params) {
  return params.has('categoria') || params.has('colecao') || params.has('busca') || params.has('todos');
}

function setTitle() {
  const params = new URLSearchParams(location.search);
  if (params.get('produto') && sheet.el?.id === 'product-sheet') return;
  if (isListing(params)) return; // renderListing define o título
  const st = S.store;
  document.title = `${st.name} | Móveis, colchões e eletro em ${st.city}`;
  $('meta[name="description"]')?.setAttribute(
    'content',
    `${st.name}: sofás, colchões, camas, cozinhas e eletro com entrega em até ${Math.round(st.delivery_radius_km)} km de ${st.city}. ${S.net.seo_description || ''}`.trim()
  );
}

function route({ keepScroll = false, fromPop = false } = {}) {
  const params = new URLSearchParams(location.search);
  const listing = isListing(params);
  const home = $('[data-home]');
  const list = $('[data-listing]');
  home.hidden = listing;
  list.hidden = !listing;
  document.body.classList.toggle('is-subpage', listing);
  header.classList.toggle('is-solid', listing);
  if (listing) {
    renderListing(params);
    if (!keepScroll) {
      window.scrollTo(0, 0);
      $('#listing-title')?.focus({ preventScroll: true });
    }
  } else {
    if (homeFor !== S.store.id) {
      renderHome();
      homeFor = S.store.id;
    }
    setTitle();
    if (!keepScroll && !fromPop && !location.hash) window.scrollTo(0, 0);
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }));
    }
  }

  const prod = params.get('produto');
  if (prod) {
    if (!(sheet.el?.id === 'product-sheet' && $('#product-sheet .pdp__name')?.textContent === S.bySlug[prod]?.name)) openProduct(prod, { push: false });
  } else if (sheet.el?.id === 'product-sheet') closeSheet(true, true);

  const m = /^\/pedido\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (m && trackOpenedFor !== m[1]) {
    trackOpenedFor = m[1];
    openTrack({ token: m[1] });
  } else if (!m) trackOpenedFor = null;
}

export function navigate(url, { keepScroll = false, replace = false } = {}) {
  const u = new URL(url, location.origin + storePath());
  // links relativos (?categoria=…) ficam dentro da loja atual
  if (u.pathname === '/' || u.pathname === '') u.pathname = storePath();
  const dest = u.pathname + u.search + u.hash;
  if (dest === location.pathname + location.search + location.hash && !replace) {
    route({ keepScroll });
    return;
  }
  if (replace) history.replaceState({}, '', dest);
  else history.pushState({}, '', dest);
  closeDrawer(false);
  route({ keepScroll });
}

function initRouter() {
  on('navigate', (d) => (typeof d === 'string' ? navigate(d) : navigate(d.url, { keepScroll: d.keepScroll })));
  on('title', setTitle);
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const home = e.target.closest('[data-home-link]');
    if (home) {
      e.preventDefault();
      navigate(storePath());
      return;
    }
    const a = e.target.closest('a[data-route]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || /^(https?:|mailto:|tel:)/.test(href)) return;
    e.preventDefault();
    if (href.startsWith('#')) {
      navigate(`${storePath()}${href}`);
      return;
    }
    navigate(href);
  });
  window.addEventListener('popstate', () => {
    const m = /^\/loja\/([^/?#]+)/.exec(location.pathname);
    if (m && m[1] !== S.store.slug && S.stores.some((s) => s.slug === m[1])) {
      loadStore(m[1], { push: false });
      return;
    }
    route({ fromPop: true });
  });
}

/* ---------- Carregamento da loja ---------- */
let loading = null;
async function loadStore(slug, { push = true, silent = false } = {}) {
  const prevId = S.store?.id;
  const job = (loading = rpc('get_storefront', { p_slug: slug }));
  let sf;
  try {
    sf = await job;
  } catch (err) {
    if (loading !== job) return;
    if (!S.store) throw err;
    toast(bizMessage(err));
    return;
  }
  if (loading !== job) return; // outra loja foi escolhida no meio do caminho
  if (!sf) {
    if (!S.store) throw new Error('STORE_NOT_FOUND');
    toast('Esta loja não está disponível no momento.');
    return;
  }
  const changed = prevId !== sf.store.id;
  setStorefront(sf);
  if (changed || !silent) {
    homeFor = null;
    applyTheme();
    renderAnnouncement();
    renderMenus();
    renderFooter();
    loadCart();
  } else {
    homeFor = null;
    renderCart();
  }
  updateStoreUI();
  if (changed && prevId) {
    if (sheet.el && sheet.el.id !== 'track-sheet') closeSheet(false, true);
    closeDrawer(false);
    const params = new URLSearchParams(location.search);
    ['produto'].forEach((k) => params.delete(k));
    const dest = `/loja/${sf.store.slug}${isListing(params) ? `?${params}` : ''}`;
    if (push) history.pushState({}, '', dest);
    else history.replaceState({}, '', dest);
    route();
    toast(`Agora você está comprando na ${sf.store.name}`);
  } else if (silent) route({ keepScroll: true });
}

function pickInitialStore() {
  const path = /^\/loja\/([^/?#]+)/.exec(location.pathname);
  const qs = new URLSearchParams(location.search).get('loja');
  const saved = storage.get('atual:store', null);
  const has = (s) => s && S.stores.some((x) => x.slug === s);
  if (has(path?.[1])) return { slug: path[1], explicit: true };
  if (has(qs)) return { slug: qs, explicit: true };
  if (has(saved)) return { slug: saved, explicit: false };
  if (S.loc) {
    const near = storesForLocation().find((s) => s.distance <= Number(s.delivery_radius_km));
    if (near) return { slug: near.slug, explicit: false };
  }
  return { slug: S.stores[0].slug, explicit: false, guessed: true };
}

function showBootError(err) {
  const box = $('[data-boot-error]');
  box.hidden = false;
  box.innerHTML = `<div><strong>Não foi possível carregar a loja.</strong><p>${esc(bizMessage(err))}</p><button class="btn btn--primary" type="button" data-retry>Tentar de novo</button></div>`;
  $('[data-retry]', box).addEventListener('click', () => location.reload());
}

async function boot() {
  initLayers();
  initHeader();
  initPicker();
  initSearch();
  initMenuDrawer();
  initProductSheet();
  initCatalogClicks();
  initCart();
  initFooter();
  initRouter();
  initCookie();

  on('store-select', (slug) => {
    if (slug === S.store?.slug) {
      updateStoreUI();
      renderCart();
      toast(`Você está comprando na ${S.store.name}`);
      return;
    }
    loadStore(slug);
  });
  on('location', () => {
    updateStoreUI();
    renderCart();
  });
  on('reload-storefront', () => loadStore(S.store.slug, { silent: true }));

  try {
    S.stores = (await rpc('list_stores')) || [];
    if (!S.stores.length) throw new Error('STORE_NOT_FOUND');
    const pick = pickInitialStore();
    await loadStore(pick.slug, { push: false });
    // URL canônica da loja (mantém filtros e produto)
    if (!location.pathname.startsWith('/loja/') && !location.pathname.startsWith('/pedido/')) {
      const params = new URLSearchParams(location.search);
      params.delete('loja');
      history.replaceState({}, '', `/loja/${S.store.slug}${params.toString() ? `?${params}` : ''}${location.hash}`);
    }
    route({ fromPop: true });
    document.documentElement.classList.add('is-ready');
    // Primeira visita: pergunta o endereço para mostrar a loja que entrega
    if (!pick.explicit && !storage.get('atual:picked', false) && !location.pathname.startsWith('/pedido/')) {
      setTimeout(() => {
        if (!sheet.el) openPicker();
      }, 600);
    }
  } catch (err) {
    console.error(err);
    showBootError(err);
  }
}

boot();
