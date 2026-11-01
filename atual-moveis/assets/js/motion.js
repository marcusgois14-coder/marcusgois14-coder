// Camada de movimento da vitrine (par de assets/css/motion.css).
// Feedback de toque, produto "voando" até o carrinho, coração com explosão, contadores que saltam,
// revelação ao rolar, gavetas/janelas com mola, etapas do checkout, confete no pedido feito,
// Ken Burns no banner, aviso com ✓, linha do tempo do rastreio e troca de página.
//
// Tudo funciona por delegação de eventos e observadores: os outros módulos não dependem daqui.
// O único gancho é o evento 'cart-added' que o cart.js dispara (aqui ele pode pedir alguns ms
// para o voo terminar antes de a gaveta abrir). Com movimento reduzido, sem IntersectionObserver
// ou sem Web Animations, html.motion-ok não é posto: nada fica escondido e nada atrasa.
//
// API para outros módulos:
//   initMotion()                  liga tudo (main.js chama uma vez no boot)
//   confetti(el?, opções?)        confete nas cores da marca saindo de el (Promise, ~1,3 s)
//   flyToCart(el, alvo?)          voo de uma imagem até o ícone do carrinho (ou outro alvo)
//   sparkle(el)                   explosão de partículas no centro de el (a do coração)
//   refreshReveal(raiz?)          reavalia [data-reveal] numa raiz (o MutationObserver já faz isso)
//   motionOn()                    true quando as animações estão ligadas
// Revelação opcional por atributo (qualquer elemento, em qualquer lugar):
//   data-reveal ou data-reveal="up|fade|zoom|left|right"   aparece ao entrar na tela
//   data-reveal-delay="120"                                atraso extra em ms
//   data-reveal-stagger (num contêiner)                    filhos diretos aparecem em sequência
import { S } from './state.js';

const html = document.documentElement;
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqMobile = matchMedia('(max-width: 749px)');
const HAS_IO = 'IntersectionObserver' in window;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const supports = (p, v) => !!(window.CSS && CSS.supports && CSS.supports(p, v));
const HAS_INDIVIDUAL = supports('scale', '1') && supports('translate', '1px') && supports('rotate', '1deg');

export const motionOn = () => HAS_IO && HAS_WAAPI && HAS_INDIVIDUAL && !mqReduce.matches;

/* ---------- Curvas ---------- */
const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
const EASE_SOFT = 'cubic-bezier(.2, .7, .2, 1)';
const EASE_IN = 'cubic-bezier(.4, 0, 1, 1)';
const LINEAR_OK = supports('animation-timing-function', 'linear(0, 1)');
// Mola amortecida com velocidade inicial, amostrada para linear(): sai rápido, passa um pouco e assenta.
function springCurve(a, w, v0, n = 36) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(i === n ? 1 : +(1 - Math.exp(-a * t) * (Math.cos(w * t) + ((a - v0) / w) * Math.sin(w * t))).toFixed(3));
  }
  return `linear(${pts.join(', ')})`;
}
const SPRING = LINEAR_OK ? springCurve(6, 10, 8) : 'cubic-bezier(.34, 1.56, .64, 1)';
const SPRING_SOFT = LINEAR_OK ? springCurve(7, 9, 10) : 'cubic-bezier(.34, 1.3, .64, 1)';

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const raf = (fn) => requestAnimationFrame(fn);

function play(el, frames, opts) {
  if (!el || !HAS_WAAPI) return null;
  try {
    return el.animate(frames, opts);
  } catch {
    try {
      return el.animate(frames, { ...opts, easing: 'ease-out' });
    } catch {
      return null;
    }
  }
}
const after = (anim, fn) => (anim ? anim.finished.then(fn, fn) : fn());

const isShown = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
};

// Entrada curta (opacity + translate) que não deixa nada escondido no fim: fill 'backwards' só vale durante o atraso.
// Só o quadro inicial (offset 0): o final é o valor natural do elemento (ex.: textos com opacity .7), sem ler
// getComputedStyle, que forçava um recálculo de estilo por elemento nas sequências.
function enter(el, { x = 0, y = 14, s = null, delay = 0, duration = 440, easing = EASE_OUT } = {}) {
  if (!el) return null;
  const from = { offset: 0, opacity: 0, translate: `${x}px ${y}px` };
  if (s != null) from.scale = String(s);
  return play(el, [from], { duration, delay, easing, fill: 'backwards' });
}

/* =========================================================
   1. Toque: aperta e volta com mola; onda nos botões cheios
   ========================================================= */
const PRESS_SEL =
  'button, .btn, .btn-pill, .cat, .chip, .mpill, .pin, .store-opt, .pay-opt, .tile, .card__link, .whats-float, .sresult, .qlist a, .crumbs a, .announcement__cta, .socials a, [role="button"]';
const PRESS_SKIP = '.hero__link, input, select, textarea, [data-drag].is-dragging *';
const RIPPLE_SEL = '.btn--primary, .btn--dark, .btn--whats, .btn-checkout, .btn-pill, .upsell__btn, .mpill--cta, .header__track, .cookie__btn';
let press = null;

function pressTargets(el) {
  if (el.matches('.card__link')) {
    const card = el.closest('.card');
    return card ? [$('.card__media', card), $('.card__ui', card)].filter(Boolean) : [];
  }
  return [el];
}

function pressScale(el) {
  const r = el.getBoundingClientRect();
  // ícones e pílulas ~0,955; cards e blocos grandes quase nada (0,985 a 0,99)
  return 1 - Math.min(0.045, 5 / Math.max(r.width, r.height, 1));
}

function startPress(p) {
  if (p.started) return;
  p.started = true;
  const s = pressScale(p.targets[0]);
  p.scale = s;
  p.anims = p.targets.map((t) => play(t, [{ scale: '1' }, { scale: String(s) }], { duration: 110, easing: 'cubic-bezier(.3, 0, .5, 1)', fill: 'forwards' }));
  if (p.el.matches(RIPPLE_SEL)) ripple(p.el, p.x, p.y);
}

function releasePress(p, quick) {
  clearTimeout(p.timer);
  if (!p.started) {
    // toque rápido: aperta e solta num gesto só
    const s = pressScale(p.targets[0]);
    p.targets.forEach((t) => play(t, [{ scale: '1' }, { scale: String(s), offset: 0.3 }, { scale: '1' }], { duration: 380, easing: 'ease-out' }));
    if (quick && p.el.matches(RIPPLE_SEL)) ripple(p.el, p.x, p.y);
    return;
  }
  p.targets.forEach((t, i) => {
    const from = getComputedStyle(t).scale;
    const back = play(t, [{ scale: from === 'none' ? String(p.scale) : from }, { scale: '1' }], { duration: 520, easing: SPRING });
    after(back, () => {
      p.anims[i]?.cancel();
      back?.cancel();
    });
  });
}

function ripple(el, x, y) {
  if (getComputedStyle(el).position === 'static') return; // sem posição não dá para conter a onda sem mexer no layout
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const px = x ?? r.left + r.width / 2;
  const py = y ?? r.top + r.height / 2;
  const d = Math.hypot(Math.max(px - r.left, r.right - px), Math.max(py - r.top, r.bottom - py)) * 2;
  const host = document.createElement('span');
  host.className = 'm-ripple';
  host.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.style.cssText = `width:${d}px;height:${d}px;left:${px - r.left - d / 2}px;top:${py - r.top - d / 2}px`;
  host.append(dot);
  el.append(host);
  const a = play(dot, [{ transform: 'scale(0)', opacity: 0.26 }, { transform: 'scale(1)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2, .6, .35, 1)' });
  after(a, () => host.remove());
}

function setupPress() {
  if (!HAS_INDIVIDUAL) return;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!motionOn() || e.button > 0 || !e.isPrimary) return;
      const el = e.target.closest?.(PRESS_SEL);
      if (!el || el.matches(PRESS_SKIP) || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (getComputedStyle(el).display === 'inline') return; // transform não vale em caixa inline
      const targets = pressTargets(el);
      if (!targets.length) return;
      if (press) releasePress(press);
      press = { el, targets, x: e.clientX, y: e.clientY, id: e.pointerId, started: false, anims: [] };
      // no toque espera um instante: se for o começo de uma rolagem, não aperta nada
      if (e.pointerType === 'mouse') startPress(press);
      else {
        const p = press;
        p.timer = setTimeout(() => startPress(p), 70);
      }
    },
    { capture: true, passive: true }
  );
  const end = (e, ok) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (!ok && !p.started) {
      clearTimeout(p.timer);
      return;
    }
    releasePress(p, ok);
  };
  document.addEventListener('pointerup', (e) => end(e, true), { capture: true, passive: true });
  document.addEventListener('pointercancel', (e) => end(e, false), { capture: true, passive: true });
  document.addEventListener(
    'pointermove',
    (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) end(e, false);
    },
    { capture: true, passive: true }
  );
  // teclado (Enter/Espaço) também dá o retorno visual
  document.addEventListener(
    'click',
    (e) => {
      if (e.detail !== 0 || !motionOn()) return;
      const el = e.target.closest?.('button, .btn, .btn-pill');
      if (!el || el.matches(PRESS_SKIP)) return;
      releasePress({ el, targets: pressTargets(el), started: false }, true);
    },
    true
  );
}

/* =========================================================
   2. Produto voando até o carrinho
   ========================================================= */
const flight = { active: 0, badgePending: false, badgeHold: null, badgeAppear: false, lineKey: null };
let lastTrigger = { el: null, t: 0 };

function sourceImage(trigger) {
  if (!trigger?.isConnected) return null;
  const scope = trigger.closest('.card, .upsell__item, .line, [data-pdp]');
  if (!scope) return null;
  const img = scope.matches('[data-pdp]') ? $('.pdp__main img', scope) : scope.matches('.card') ? $('.card__img1', scope) || $('img', scope) : $('img', scope);
  return img && img.getBoundingClientRect().width > 0 ? img : null;
}

function cartIcon() {
  return $$('[data-open-drawer="cart-drawer"]').find(isShown) || null;
}

const quad = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;

function ghostOf(img, cls = '') {
  const g = document.createElement('div');
  g.className = `m-fly ${cls}`.trim();
  g.setAttribute('aria-hidden', 'true');
  const im = document.createElement('img');
  im.alt = '';
  im.decoding = 'sync';
  im.src = img.currentSrc || img.src;
  g.append(im);
  return g;
}

// Voo em arco de uma miniatura da foto (mesma proporção da foto, então o produto aparece inteiro):
// sai do centro da parte visível da foto, acelera e entra no ícone ainda visível, que reage no pouso.
export function flyToCart(sourceEl, target = cartIcon(), { onLand } = {}) {
  const img = sourceEl?.tagName === 'IMG' ? sourceEl : sourceImage(sourceEl) || $('img', sourceEl || document.body);
  if (!motionOn() || !img || !target) {
    onLand?.();
    return Promise.resolve(false);
  }
  const from = img.getBoundingClientRect();
  const to = ($('svg', target) || target).getBoundingClientRect();
  const ar = clamp(from.width / Math.max(1, from.height), 0.62, 1.4);
  const base = mqMobile.matches ? 62 : 76; // lado maior da miniatura
  const gw = Math.round(ar >= 1 ? base : base * ar);
  const gh = Math.round(ar >= 1 ? base / ar : base);
  const visTop = clamp(from.top, 0, innerHeight);
  const visBottom = clamp(from.bottom, 0, innerHeight);
  const p0 = { x: from.left + from.width / 2, y: (visTop + visBottom) / 2 };
  const p2 = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const dx = p2.x - p0.x;
  const dy = p2.y - p0.y;
  const dist = Math.hypot(dx, dy) || 1;
  // "Swoosh" (curva cúbica): sai em direção ao carrinho e termina SUBINDO por baixo do ícone. Assim a miniatura
  // nunca desliza na horizontal pelo cabeçalho nem passa por cima do coração/busca ao lado, e nunca vai acima do ícone.
  const c1 = { x: p0.x + dx * 0.45, y: p0.y + dy * 0.15 };
  const c2 = { x: p2.x - dx * 0.04, y: p2.y + clamp(Math.abs(dy) * 0.45, 60, 240) };
  const end = clamp(Math.max(to.width, to.height) / Math.max(gw, gh), 0.22, 0.4); // termina do tamanho do ícone
  const tilt = dx >= 0 ? -1 : 1;
  // some só nos últimos ~30-45 px, já do tamanho do ícone e em cima dele
  const fade = clamp(60 / dist, 0.05, 0.1);
  const frames = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    // começa devagar (a miniatura "salta" da foto) e chega ao ícone ainda com ~70% da velocidade média: sem rastejar no fim
    const p = 0.65 * (3 * u * u - 2 * u * u * u) + 0.35 * u * u;
    const x = cubic(p0.x, c1.x, c2.x, p2.x, p) - p0.x;
    const y = cubic(p0.y, c1.y, c2.y, p2.y, p) - p0.y;
    let s;
    if (u < 0.14) s = 0.55 + 0.51 * (1 - (1 - u / 0.14) ** 3);
    else if (u < 0.24) s = 1.06 - 0.06 * ((u - 0.14) / 0.1);
    else s = 1 - (1 - end) * ((u - 0.24) / 0.76) ** 1.25;
    const o = u < 0.05 ? u / 0.05 : u > 1 - fade ? Math.max(0, (1 - u) / fade) : 1;
    const rot = 7 * tilt * Math.sin(Math.PI * u);
    frames.push({ offset: u, transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`, opacity: +o.toFixed(3) });
  }
  const g = ghostOf(img);
  g.style.cssText = `left:${(p0.x - gw / 2).toFixed(1)}px;top:${(p0.y - gh / 2).toFixed(1)}px;width:${gw}px;height:${gh}px`;
  document.body.append(g);
  const duration = Math.round(clamp(380 + dist * 0.12, 440, 560));
  flight.active++;
  const a = play(g, frames, { duration, easing: 'linear', fill: 'both' });
  // o ícone reage quando a miniatura chega nele (ela some nos últimos quadros, já em cima do ícone)
  const landAt = Math.round(duration * (1 - fade * 0.6));
  const promise = new Promise((resolve) => {
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      flight.active = Math.max(0, flight.active - 1);
      landOnIcon(target);
      onLand?.();
      resolve(true);
    };
    setTimeout(land, landAt);
    after(a, () => {
      land();
      g.remove();
    });
  });
  promise.landAt = landAt;
  return promise;
}

function landOnIcon(btn) {
  const svg = $('svg', btn);
  play(
    svg,
    [
      { rotate: '0deg', translate: '0px 0px', scale: '1' },
      { rotate: '-13deg', translate: '0px 3px', scale: '1.14', offset: 0.22 },
      { rotate: '9deg', translate: '0px -2px', scale: '1', offset: 0.48 },
      { rotate: '-4deg', translate: '0px 0px', offset: 0.72 },
      { rotate: '0deg', translate: '0px 0px', scale: '1' },
    ],
    { duration: 640, easing: 'ease-out' }
  );
  const r = (svg || btn).getBoundingClientRect();
  const ring = document.createElement('span');
  ring.className = 'm-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.style.left = `${r.left + r.width / 2}px`;
  ring.style.top = `${r.top + r.height / 2}px`;
  document.body.append(ring);
  after(play(ring, [{ transform: 'scale(.35)', opacity: 0.55 }, { transform: 'scale(1.35)', opacity: 0 }], { duration: 560, easing: EASE_OUT }), () => ring.remove());
  const badge = $('[data-cart-count]', btn);
  flight.badgeHold?.cancel();
  if (badge && !badge.hidden) popBadge(badge, flight.badgeAppear, true);
  flight.badgeHold = null;
  flight.badgeAppear = false;
  flight.badgePending = false;
}

// Dentro de gaveta/janela (produto, favoritos, "Complete seu ambiente"): a gaveta do carrinho abre na hora
// e a foto voa até a linha do item, já na posição final da gaveta.
function flyToDrawerLine(img, d, trigger) {
  const from = img.getBoundingClientRect();
  const visH = Math.min(from.bottom, innerHeight) - Math.max(from.top, 0);
  let side = Math.min(from.width, from.height);
  let start = { left: from.left + (from.width - side) / 2, top: Math.max(from.top, Math.min(from.top + (from.height - side) / 2, innerHeight - side)) };
  let pop = false;
  // foto já rolada para fora da tela (no celular o botão fica abaixo da foto): sai do botão tocado,
  // em vez de entrar pela borda de cima com a linha do carrinho vazia esperando
  if (visH < from.height * 0.4 && trigger?.isConnected) {
    const b = trigger.getBoundingClientRect();
    side = 64;
    start = { left: clamp(b.left + b.width / 2 - side / 2, 8, innerWidth - side - 8), top: clamp(b.top + b.height / 2 - side / 2, 8, innerHeight - side - 8) };
    pop = true;
  }
  const src = img.currentSrc || img.src;
  flight.lineKey = lineKeyFor(d.id, d.variant);
  raf(() => {
    const drawer = document.getElementById('cart-drawer');
    if (!drawer?.classList.contains('is-open')) {
      flight.lineKey = null;
      return;
    }
    const idx = S.cart.findIndex((l) => l.id === d.id && (l.variant || null) === (d.variant || null));
    const line = $$('.line', drawer)[idx];
    const thumb = line && $('.line__img', line);
    const dr = drawer.getBoundingClientRect();
    const shift = dr.left - (innerWidth - dr.width);
    let t = thumb?.getBoundingClientRect();
    if (!t || t.top > innerHeight - 40 || t.bottom < 40) {
      flight.lineKey = null;
      return;
    }
    t = { left: t.left - shift, top: t.top, width: t.width };
    const g = ghostOf({ src, currentSrc: src }, 'm-fly--line');
    g.style.cssText = `left:${start.left}px;top:${start.top}px;width:${side}px;height:${side}px;transform-origin:0 0`;
    document.body.append(g);
    const thumbImg = $('img', thumb) || thumb;
    thumbImg.style.opacity = '0';
    const sc = t.width / side;
    const dx = t.left - start.left;
    const dy = t.top - start.top;
    const lift = clamp(Math.abs(dx) * 0.18, 30, 120);
    const frames = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const x = quad(0, dx * 0.5, dx, k);
      const y = quad(0, Math.min(0, dy) - lift, dy, k);
      let s = 1 + (sc - 1) * (1 - (1 - k) ** 2.2);
      if (pop && k < 0.2) s *= 0.6 + 0.4 * (1 - (1 - k / 0.2) ** 3); // nasce pequena no botão e cresce
      const f = { offset: k, transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(4)})` };
      if (pop) f.opacity = k < 0.12 ? +(k / 0.12).toFixed(3) : 1;
      frames.push(f);
    }
    flight.active++;
    const a = play(g, frames, { duration: pop ? 540 : 620, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    after(a, () => {
      flight.active = Math.max(0, flight.active - 1);
      flight.lineKey = null;
      const fresh = $$('.line', drawer)[idx];
      const fImg = (fresh && $('.line__img img', fresh)) || thumbImg;
      thumbImg.style.opacity = '';
      fImg.style.opacity = '';
      play(fImg, [{ scale: '.9' }, { scale: '1' }], { duration: 480, easing: SPRING });
      after(play(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear' }), () => g.remove());
      const count = $('.cart__count', drawer);
      if (count) play(count, [{ scale: '1.25' }, { scale: '1' }], { duration: 480, easing: SPRING });
    });
  });
}

function setupFlight() {
  // guarda qual botão de comprar foi tocado (a página do produto não manda a origem no evento)
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target.closest?.('[data-add], [data-pdp-add], [data-pdp-buy]');
      if (t) lastTrigger = { el: t, t: performance.now() };
    },
    true
  );
  document.addEventListener('cart-added', (e) => {
    const d = e.detail || {};
    if (!motionOn() || d.checkout) return;
    const trigger = d.source?.isConnected ? d.source : lastTrigger.el && performance.now() - lastTrigger.t < 1500 ? lastTrigger.el : null;
    const img = sourceImage(trigger);
    if (!img) return;
    if (trigger.closest('.sheet, .drawer')) {
      if (d.open !== false) flyToDrawerLine(img, d, trigger);
      return;
    }
    const icon = cartIcon();
    if (!icon) return;
    flight.badgePending = true;
    const f = flyToCart(img, icon);
    // a gaveta abre logo depois do pouso, com tempo de ver o ícone e o contador reagirem antes de ela cobrir o ícone
    // (o cart.js espera esse tempo; sem este módulo, ou com movimento reduzido, ele abre na hora)
    if (d.open !== false) d.delay = Math.max(d.delay || 0, (f.landAt || 440) + 70);
  });
}

/* =========================================================
   3. Favoritos: pop + explosão; tirar dos favoritos encolhe de leve
   ========================================================= */
export function sparkle(el, { colors = ['#ea1e2a', '#f4802b', '#ea1e2a', '#ff6a4d'] } = {}) {
  if (!motionOn() || !el) return;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'm-burst';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  const ring = document.createElement('i');
  ring.className = 'm-burst__ring';
  ring.style.borderColor = colors[0];
  layer.append(ring);
  const parts = [];
  const N = 8;
  for (let i = 0; i < N * 2; i++) {
    const outer = i < N;
    const ang = ((i % N) / N) * Math.PI * 2 + (outer ? 0 : Math.PI / N) - Math.PI / 2;
    const dist = (outer ? 27 : 17) + Math.random() * 5;
    const size = outer ? 6 : 4;
    const dot = document.createElement('i');
    dot.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:${colors[i % colors.length]}`;
    layer.append(dot);
    parts.push({ dot, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, outer });
  }
  document.body.append(layer);
  play(ring, [{ transform: 'scale(.2)', opacity: 0.9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 520, easing: EASE_OUT });
  parts.forEach((p) =>
    play(
      p.dot,
      [
        { transform: `translate(${p.x * 0.32}px, ${p.y * 0.32}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${p.x * 0.55}px, ${p.y * 0.55}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${p.x}px, ${p.y}px) scale(0)`, opacity: 0.4 },
      ],
      { duration: p.outer ? 640 : 520, delay: p.outer ? 40 : 90, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'backwards' }
    )
  );
  setTimeout(() => layer.remove(), 900);
}

function setupWish() {
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest?.('.card__wish[data-wish]');
      if (!btn || !motionOn()) return;
      const was = btn.classList.contains('is-active');
      // o cart.js troca o estado no mesmo clique; anima no quadro seguinte, já com o estado novo
      raf(() => {
        if (!btn.isConnected) return;
        const now = btn.classList.contains('is-active');
        if (now === was) return;
        if (now) {
          const full = $('.i-full', btn);
          play(full, [{ scale: '.25' }, { scale: '1' }], { duration: 640, easing: SPRING });
          // explosão na cor do coração (a cor de destaque de cada loja) com o laranja da marca
          // (lê o token, não a cor calculada: o botão ainda está no meio da transição de cor)
          const c = getComputedStyle(btn).getPropertyValue('--accent').trim();
          sparkle(btn, c ? { colors: [c, '#f4802b', c, '#ffb27a'] } : undefined);
        } else {
          play($('.i-empty', btn), [{ scale: '.7', opacity: 0.4 }, { scale: '1', opacity: 1 }], { duration: 420, easing: SPRING_SOFT });
        }
      });
    },
    true
  );
}

/* =========================================================
   4. Contadores do cabeçalho
   ========================================================= */
function popBadge(b, appear, up = true) {
  if (!motionOn() || !b) return;
  if (appear) play(b, [{ scale: '0' }, { scale: '1' }], { duration: 560, easing: SPRING });
  else play(b, [{ scale: up ? '1.55' : '.7' }, { scale: '1' }], { duration: 560, easing: SPRING });
}

function beat(svg) {
  play(svg, [{ scale: '1' }, { scale: '1.22', offset: 0.3 }, { scale: '.94', offset: 0.6 }, { scale: '1' }], { duration: 560, easing: 'ease-out' });
}

function watchBadge(sel, kind) {
  const b = $(sel);
  if (!b) return;
  const read = () => (b.hidden ? 0 : Number(b.textContent) || 0);
  let last = read();
  new MutationObserver(() => {
    const n = read();
    if (n === last) return;
    const prev = last;
    last = n;
    // na carga da página o número aparece sem festa
    if (!html.classList.contains('is-ready') || !motionOn() || !n) return;
    if (kind === 'cart' && flight.active && n > prev) {
      // o pouso do voo faz o pop; se o contador está surgindo agora, fica escondido até lá
      flight.badgePending = true;
      if (prev === 0) {
        flight.badgeAppear = true;
        flight.badgeHold = play(b, [{ scale: '0' }, { scale: '0' }], { duration: 1200 }); // expira sozinho
      }
      return;
    }
    popBadge(b, prev === 0, n > prev);
    if (kind === 'wish' && n > prev) beat($('svg', b.closest('button') || b));
  }).observe(b, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- Linhas do carrinho e dos favoritos: entram, saem e se reorganizam (FLIP) ---------- */
function lineKeyFor(id, variant) {
  const p = S.byId?.[id];
  const v = variant && p?.variants?.find((x) => x.id === variant);
  return `${p?.slug || id}|${v ? `Cor: ${v.name}` : ''}`;
}
const lineKey = (line) => `${$('[data-product]', line)?.dataset.product || ''}|${($('.line__name small', line)?.textContent || '').trim()}`;

// gaveta -> função que fotografa as linhas (chamada quando a gaveta abre)
const lineSnaps = new Map();

function watchLines(host) {
  if (!host) return;
  const st = { snap: null, scrolled: false, ship: null };
  const isOpen = () => !!host.closest('.drawer')?.classList.contains('is-open');
  host.addEventListener('scroll', (e) => e.target.matches?.('.cart__body') && (st.scrolled = e.target.scrollTop > 4), { capture: true, passive: true });
  const read = () => {
    const hr = host.getBoundingClientRect();
    const map = new Map();
    $$('.line', host).forEach((l) => {
      const r = l.getBoundingClientRect();
      map.set(lineKey(l), { el: l, top: r.top - hr.top, left: r.left - hr.left, width: r.width, qty: $('.qty span', l)?.textContent || '' });
    });
    const up = $('.upsell', host);
    if (up) map.set('@upsell', { el: up, top: up.getBoundingClientRect().top - hr.top, qty: '', block: true });
    return map;
  };
  const shipOf = () => {
    const ship = $('.ship__bar span', host);
    return ship ? parseFloat(ship.style.width) || 0 : null;
  };
  const snapshot = (now) => {
    st.snap = new Map([...now].map(([k, v]) => [k, { ...v, clone: v.block ? null : v.el.cloneNode(true), el: null }]));
    st.scrolled = false;
    st.ship = shipOf();
  };
  lineSnaps.set(host, () => motionOn() && snapshot(read()));
  new MutationObserver(() => {
    // Gaveta fechada: não mede nem clona nada (no boot o carrinho é renderizado com a página ainda montando,
    // e medir aqui forçaria um layout inteiro). A foto de referência é tirada quando a gaveta abre.
    if (!motionOn() || !isOpen()) {
      st.snap = null;
      return;
    }
    const now = read();
    const ship = $('.ship__bar span', host);
    const shipPct = shipOf();
    const prev = st.snap;
    // posições relativas à gaveta (não dependem de onde ela está no meio da animação de abrir)
    if (prev && !st.scrolled) {
      const hr = host.getBoundingClientRect();
      prev.forEach((p, key) => {
        if (!now.has(key) && p.clone && !p.block) exitGhost(p, hr);
      });
      now.forEach((n, key) => {
        const p = prev.get(key);
        if (!p) {
          if (key !== flight.lineKey && !n.block) enter(n.el, { x: 26, y: 0, duration: 480 });
          return;
        }
        const dy = p.top - n.top;
        if (Math.abs(dy) > 1 && Math.abs(dy) < 500) play(n.el, [{ translate: `0px ${dy}px` }, { translate: '0px 0px' }], { duration: 420, easing: EASE_OUT });
        if (p.qty !== n.qty) {
          const dir = Number(n.qty) > Number(p.qty) ? 1 : -1;
          play($('.qty span', n.el), [{ translate: `0px ${dir * 9}px`, opacity: 0 }, { translate: '0px 0px', opacity: 1 }], { duration: 260, easing: EASE_OUT });
          play($('.line__price', n.el), [{ opacity: 0.35 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
        }
      });
      const empty = $('.cart-empty', host);
      if (empty && prev.size) enter(empty, { y: 16, s: 0.96, delay: 120, duration: 520 });
      if (ship && st.ship != null && shipPct > 0 && shipPct !== st.ship) {
        play(ship, [{ scale: `${clamp(st.ship / shipPct, 0, 4)} 1` }, { scale: '1 1' }], { duration: 700, easing: EASE_OUT });
      }
    }
    snapshot(now);
  }).observe(host, { childList: true });
}

function exitGhost(p, hr) {
  const g = p.clone;
  g.classList.add('m-ghost-line');
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  Object.assign(g.style, { position: 'fixed', left: `${hr.left + p.left}px`, top: `${hr.top + p.top}px`, width: `${p.width}px`, margin: '0', zIndex: '415', pointerEvents: 'none' });
  document.body.append(g);
  after(play(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(36px) scale(.97)' }], { duration: 260, easing: EASE_IN, fill: 'forwards' }), () => g.remove());
}

/* =========================================================
   5. Revelação ao rolar
   ========================================================= */
const AUTO =
  '.shelf__head, .marquee, .mosaic > .tile, .grid-products > .card, .listing__empty, .listing__more, .benefit, .footer__top > *, .footer__trust, .footer__legal, .footer__about';
const GROUP = '.slider__track, .cats__track, [data-reveal-stagger]';
const REVEAL_CLASSES = ['m-reveal', 'is-in', 'm-r-fade', 'm-r-zoom', 'm-r-left', 'm-r-right'];
const seen = new WeakSet();
const groups = new WeakSet();
let io = null;
let revealReady = false;

const inScope = (el) => !!el.closest('main, footer');
function variantFor(el) {
  const v = el.getAttribute('data-reveal');
  if (v && /^(fade|zoom|left|right)$/.test(v)) return `m-r-${v}`;
  if (el.matches('.tile')) return 'm-r-zoom';
  if (el.matches('.marquee')) return 'm-r-fade';
  return '';
}
const unrendered = (r) => !r.width && !r.height;
// vh/vw lidos uma vez por passada: no Chrome, ler innerHeight/innerWidth depois de mexer em classes força estilo+layout
function needsHiding(r, vh, vw) {
  return r.top >= vh - 2 || r.left >= vw || r.right <= 0;
}
function hide(el) {
  el.classList.add('m-reveal');
  const v = variantFor(el);
  if (v) el.classList.add(v);
}

// Elemento ainda não renderizado (seção escondida): fica visível e é reavaliado quando a seção aparece.
// Primeiro mede tudo (um layout só), depois esconde: medir e escrever intercalado forçava um layout por elemento.
function prepareAll(groupEls, els) {
  if (!groupEls.length && !els.length) return;
  const gr = groupEls.map((g) => g.getBoundingClientRect());
  const er = els.map((el) => el.getBoundingClientRect());
  const vh = innerHeight;
  const vw = innerWidth;
  groupEls.forEach((g, i) => {
    if (unrendered(gr[i])) return;
    seen.add(g);
    const kids = Array.from(g.children);
    kids.forEach((k) => seen.add(k));
    if (!needsHiding(gr[i], vh, vw)) return;
    kids.forEach(hide);
    groups.add(g);
    io.observe(g);
  });
  els.forEach((el, i) => {
    if (seen.has(el) || unrendered(er[i])) return; // (filho de um grupo acima: já tratado)
    seen.add(el);
    if (!needsHiding(er[i], vh, vw)) return;
    hide(el);
    io.observe(el);
  });
  checkEndSoon();
}

function collect(root, gs, es) {
  const pick = (sel) => [...(root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  pick(GROUP).forEach((g) => !seen.has(g) && !gs.includes(g) && (g.hasAttribute('data-reveal-stagger') || inScope(g)) && gs.push(g));
  pick(`${AUTO}, [data-reveal]`).forEach((el) => !seen.has(el) && !es.includes(el) && (el.hasAttribute('data-reveal') || inScope(el)) && es.push(el));
}

function scan(...roots) {
  if (!revealReady || !motionOn()) return;
  const gs = [];
  const es = [];
  roots.forEach((root) => root && root.nodeType === 1 && collect(root, gs, es));
  prepareAll(gs, es);
}
export const refreshReveal = (root = document.body) => scan(root);

// Rede de segurança: no fim da página o último bloco (ex.: "Sobre" do rodapé no computador) pode nunca passar
// da linha de disparo (6% acima da borda de baixo). Quando a rolagem para no fim, revela o que está na tela.
// Roda uma vez quando a rolagem termina (não a cada quadro), e só lê o layout se ainda houver algo escondido.
let endTimer = 0;
function checkEndSoon() {
  clearTimeout(endTimer);
  endTimer = setTimeout(checkEnd, 140);
}
function checkEnd() {
  if (!revealReady || !motionOn() || !document.querySelector('.m-reveal:not(.is-in)')) return;
  const vh = innerHeight;
  if (vh + scrollY < document.documentElement.scrollHeight - 8) return;
  const pending = $$('.m-reveal:not(.is-in)');
  const tracks = $$('.slider__track, .cats__track, [data-reveal-stagger]').filter((g) => groups.has(g) && g.querySelector(':scope > .m-reveal:not(.is-in)'));
  const rs = pending.map((el) => el.getBoundingClientRect());
  const vw = innerWidth;
  // grupo (trilho) que ficou no fim: mede os filhos agora, revela depois
  const ms = tracks.filter((g) => { const r = g.getBoundingClientRect(); return r.top < vh && r.bottom > 0; }).map(measureGroup);
  let i = 0;
  pending.forEach((el, k) => {
    if (groups.has(el.parentElement) || !(rs[k].top < vh && rs[k].bottom > 0)) return;
    io.unobserve(el);
    revealEl(el, Math.min(i++, 6) * 70);
  });
  ms.forEach((m) => {
    io.unobserve(m.g);
    applyGroup(m, vw);
  });
}

function revealEl(el, delay = 0) {
  if (!el.classList.contains('m-reveal')) return;
  const extra = Number(el.getAttribute('data-reveal-delay')) || 0;
  const total = delay + extra;
  if (total) el.style.setProperty('--m-delay', `${total}ms`);
  el.classList.add('is-in');
  setTimeout(() => {
    el.classList.remove(...REVEAL_CLASSES);
    el.style.removeProperty('--m-delay');
  }, total + 1050);
}

// Grupo em duas fases: mede os filhos de todos os grupos, depois mexe nas classes (sem layout forçado a cada filho).
function measureGroup(g) {
  const kids = Array.from(g.children).filter((k) => k.classList.contains('m-reveal'));
  return { g, kids, rs: kids.map((k) => k.getBoundingClientRect()) };
}
function applyGroup({ g, kids, rs }, vw) {
  const step = Number(g.getAttribute('data-reveal-stagger')) || 70;
  let i = 0;
  kids.forEach((k, n) => {
    if (rs[n].right > 0 && rs[n].left < vw) revealEl(k, Math.min(i++, 8) * step);
    else k.classList.remove(...REVEAL_CLASSES); // fora da tela na horizontal: já fica pronto para quando rolar
  });
}

function onIntersect(entries) {
  const vis = entries.filter((e) => e.isIntersecting);
  vis.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
  if (!vis.length) return;
  const vw = vis[0].rootBounds?.width || innerWidth; // largura da tela sem forçar layout
  const measured = vis.filter((e) => groups.has(e.target)).map((e) => measureGroup(e.target));
  let i = 0;
  vis.forEach((e) => {
    io.unobserve(e.target);
    if (!groups.has(e.target)) revealEl(e.target, Math.min(i++, 8) * 70);
  });
  measured.forEach((m) => applyGroup(m, vw));
}

function revealAll() {
  $$('.m-reveal').forEach((el) => {
    el.classList.remove(...REVEAL_CLASSES);
    el.style.removeProperty('--m-delay');
  });
}

function setupReveal() {
  io = new IntersectionObserver(onIntersect, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
  const start = () => {
    if (revealReady) return;
    revealReady = true;
    scan(document.body);
  };
  // espera a página montar (html.is-ready): antes disso o rodapé fica colado no topo e seria medido errado
  if (html.classList.contains('is-ready')) start();
  else {
    const mo = new MutationObserver(() => {
      if (html.classList.contains('is-ready')) {
        mo.disconnect();
        start();
      }
    });
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  }
  new MutationObserver((recs) => {
    if (!revealReady || !motionOn()) return;
    const roots = [];
    for (const r of recs) {
      if (r.target.nodeType === 1 && r.target.matches?.(GROUP) && seen.has(r.target)) {
        // trilho que trocou os filhos (ex.: categorias): reavalia o grupo inteiro
        seen.delete(r.target);
        groups.delete(r.target);
        io.unobserve(r.target);
        roots.push(r.target);
        continue;
      }
      r.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && !String(n.className).startsWith('m-')) roots.push(n);
      });
    }
    // uma varredura só por lote de mudanças (medições juntas, depois as escritas)
    if (roots.length) scan(...roots);
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('beforeprint', revealAll);
  // teclado: o que recebe foco aparece na hora (o anel de foco nunca fica num elemento ainda transparente)
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target.closest?.('.m-reveal');
      if (!el) return;
      io.unobserve(el);
      el.classList.remove(...REVEAL_CLASSES);
      el.style.removeProperty('--m-delay');
    },
    true
  );
  window.addEventListener('scroll', checkEndSoon, { passive: true });
  window.addEventListener('resize', checkEndSoon, { passive: true });
}

/* =========================================================
   6. Gavetas, janelas e menu: conteúdo entra em sequência
   ========================================================= */
const EXPAND = '.pdp, .pdp__info, .checkout, .checkout > div, [data-co-step], [data-co-step] > form, .track-result, .success, .picker__actions';
function flatten(root, depth = 0) {
  const out = [];
  Array.from(root.children).forEach((el) => {
    if (depth < 3 && el.matches(EXPAND) && el.children.length > 1) out.push(...flatten(el, depth + 1));
    else out.push(el);
  });
  return out;
}

// Mede tudo antes de animar: medir depois de cada animate() forçava um recálculo de estilo por item ao abrir a camada.
function staggerList(items, { x = 0, y = 14, delay = 70, step = 34, max = 10, duration = 460, skip = null, rects = null } = {}) {
  const list = items.slice(0, 30).filter((el) => !(skip && skip(el)) && !el.matches('script, template, [hidden], .visually-hidden'));
  const rs = list.map((el) => rects?.get(el) || el.getBoundingClientRect());
  let i = 0;
  list.forEach((el, k) => {
    if (i >= max || !rs[k].width || !rs[k].height) return;
    enter(el, { x, y, delay: delay + i * step, duration });
    i++;
  });
}

function staggerSheet(body) {
  const top = body.getBoundingClientRect().top;
  const vh = innerHeight;
  const all = flatten(body);
  const rects = new Map(all.map((el) => [el, el.getBoundingClientRect()]));
  staggerList(
    all.filter((el) => rects.get(el).top - top < vh),
    { y: 16, step: 32, max: 11, rects }
  );
}

function onLayerOpen(el) {
  if (!motionOn()) return;
  // gaveta do carrinho/favoritos: foto de referência das linhas para as próximas mudanças (FLIP)
  lineSnaps.forEach((snap, host) => el.contains(host) && snap());
  if (el.matches('.sheet--3d')) return;
  if (el.matches('.sheet')) {
    const body = $('.sheet__body', el);
    if (body) staggerSheet(body);
    return;
  }
  if (el.matches('#cart-drawer, #wishlist-drawer')) {
    staggerList($$('.cart__body > *, .cart__foot', el), {
      x: 24,
      y: 0,
      delay: 90,
      step: 45,
      skip: (n) => !!flight.lineKey && n.matches('.line') && lineKey(n) === flight.lineKey,
    });
    return;
  }
  if (el.matches('#search-drawer')) {
    staggerList($$('.search__body > *', el), { x: 0, y: 12, delay: 110, step: 50 });
    return;
  }
  if (el.matches('.menu-drawer')) staggerList($$('.menu-drawer__list > li', el), { x: -18, y: 0, delay: 50, step: 26, max: 14, duration: 420 });
}

function setupLayers() {
  const layers = $$('.sheet, .drawer, .menu-drawer');
  const mo = new MutationObserver((recs) => {
    const opened = [];
    const closed = [];
    recs.forEach((r) => {
      const was = (r.oldValue || '').split(/\s+/).includes('is-open');
      const is = r.target.classList.contains('is-open');
      if (is && !was) opened.push(r.target);
      if (!is && was) closed.push(r.target);
    });
    // Troca de camada (produto -> carrinho, carrinho -> checkout...): a que sai some no lugar, rápido,
    // em vez de deslizar para um lado enquanto a nova entra por outro (no celular a janela descia por cima da gaveta).
    // Roda antes do próximo cálculo de estilo, então a transição já nasce com a regra .m-handoff.
    const handoff = opened.length > 0 && motionOn();
    if (handoff && closed.length) {
      // as duas sobreposições escuras trocam no mesmo quadro (sem o fundo clarear ou escurecer no meio da troca);
      // tira a regra depois que o layers.js já aplicou o is-visible (ele usa um requestAnimationFrame)
      const ovs = $$('[data-overlay], [data-sheet-overlay]');
      ovs.forEach((o) => o.classList.add('m-instant'));
      raf(() => raf(() => ovs.forEach((o) => o.classList.remove('m-instant'))));
    }
    closed.forEach((el) => {
      if (handoff && el.matches('.sheet:not(.sheet--3d), .drawer') && !el.classList.contains('is-open')) {
        el.classList.add('m-handoff');
        clearTimeout(el.__mHandoff);
        el.__mHandoff = setTimeout(() => el.classList.remove('m-handoff'), 320);
      }
      onLayerClose(el);
    });
    opened.forEach((el) => {
      el.classList.remove('m-handoff');
      onLayerOpen(el);
    });
  });
  layers.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
}

function onLayerClose(el) {
  if (el.id === 'checkout-sheet') co.step = 0;
  if (el.id === 'track-sheet') trackResult = null;
}

/* =========================================================
   7. Checkout: etapas deslizam na direção certa; confete no sucesso
   ========================================================= */
const co = { step: 0, success: false };

function onCheckoutRender() {
  const el = document.getElementById('checkout-sheet');
  const open = el.classList.contains('is-open');
  const success = $('.success', el);
  if (success) {
    if (!co.success && open && motionOn()) successSequence(success);
    co.success = true;
    co.step = 0;
    return;
  }
  co.success = false;
  const lis = $$('.steps li', el);
  const step = lis.findIndex((li) => li.classList.contains('is-active')) + 1;
  if (open && co.step && step && step !== co.step && motionOn()) {
    const dir = step > co.step ? 1 : -1;
    $('.steps', el)?.classList.add(dir > 0 ? 'm-step-fwd' : 'm-step-back');
    if (dir > 0 && lis[step - 2]) lis[step - 2].classList.add('m-just-done');
    const body = $('[data-co-step]', el);
    play(body, [{ opacity: 0, translate: `${dir * 40}px 0px` }, { opacity: 1, translate: '0px 0px' }], { duration: 440, easing: EASE_OUT });
  }
  co.step = step;
}

function successSequence(root) {
  const icon = $('.success__icon', root);
  if (icon) {
    play(icon, [{ scale: '.3', opacity: 0 }, { scale: '1', opacity: 1 }], { duration: 720, easing: SPRING, fill: 'backwards' });
    icon.classList.add('m-draw');
  }
  staggerList(
    Array.from(root.children).filter((k) => k !== icon),
    { y: 16, delay: 180, step: 60, max: 8, duration: 520 }
  );
  setTimeout(() => confetti(icon || root), 200);
}

/* ---------- Confete (canvas, some sozinho) ---------- */
const CONFETTI_COLORS = ['#ea1e2a', '#f4802b', '#ea1e2a', '#ffc24b', '#c8161f', '#f4802b', '#ff9466'];
export function confetti(origin, { count, duration = 1300, spread = 1 } = {}) {
  if (!motionOn()) return Promise.resolve(false);
  const r = origin?.getBoundingClientRect ? origin.getBoundingClientRect() : null;
  const ox = r && r.width ? r.left + r.width / 2 : innerWidth / 2;
  const oy = r && r.width ? r.top + r.height / 2 : innerHeight * 0.35;
  const W = innerWidth;
  const H = innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cvs = document.createElement('canvas');
  cvs.className = 'm-confetti';
  cvs.setAttribute('aria-hidden', 'true');
  cvs.width = Math.round(W * dpr);
  cvs.height = Math.round(H * dpr);
  const ctx = cvs.getContext('2d');
  if (!ctx) return Promise.resolve(false);
  ctx.scale(dpr, dpr);
  document.body.append(cvs);
  const small = W < 750;
  const n = count ?? (small ? 80 : 130);
  const parts = Array.from({ length: n }, (_, i) => {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25 * spread;
    const v = (0.55 + Math.random() * 0.95) * (small ? 1.1 : 1.5);
    return {
      x: ox,
      y: oy,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v - 0.12,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.024,
      tilt: Math.random() * Math.PI * 2,
      vt: 0.006 + Math.random() * 0.014,
      w: 6 + Math.random() * 6,
      h: 3.5 + Math.random() * 4.5,
      c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      shape: i % 6 === 0 ? 'tri' : i % 4 === 0 ? 'dot' : 'rect',
      sway: Math.random() * Math.PI * 2,
    };
  });
  const G = 0.0013;
  const DRAG = 0.0031;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const frame = (now) => {
      const dt = Math.min(34, now - last);
      last = now;
      const el = now - t0;
      ctx.clearRect(0, 0, W, H);
      const fade = el > duration - 380 ? Math.max(0, (duration - el) / 380) : 1;
      ctx.globalAlpha = fade;
      parts.forEach((p) => {
        const k = 1 - DRAG * dt;
        p.vx *= k;
        p.vy = p.vy * k + G * dt;
        p.sway += 0.006 * dt;
        p.x += (p.vx + Math.sin(p.sway) * 0.03) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tilt += p.vt * dt;
        if (p.y > H + 20) return;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.tilt));
        ctx.fillStyle = p.c;
        if (p.shape === 'dot') {
          ctx.beginPath();
          ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'tri') {
          // triângulo: o mesmo desenho do canto laranja do "A" da marca
          ctx.beginPath();
          ctx.moveTo(-p.w / 2, p.w / 2.6);
          ctx.lineTo(p.w / 2, p.w / 2.6);
          ctx.lineTo(p.w / 2, -p.w / 2);
          ctx.closePath();
          ctx.fill();
        } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (el < duration) raf(frame);
      else {
        cvs.remove();
        resolve(true);
      }
    };
    raf(frame);
  });
}

/* ---------- Rastreio: linha do tempo enche em sequência ---------- */
let trackResult = null;
function onTrackRender() {
  const el = document.getElementById('track-sheet');
  const result = $('.track-result', el);
  if (result && result !== trackResult && el.classList.contains('is-open') && motionOn()) {
    const steps = $('.track-steps', result);
    if (steps) {
      $$('li.is-done', steps).forEach((li, i) => li.style.setProperty('--m-i', i));
      steps.classList.add('m-track-anim');
    }
    staggerList(Array.from(result.children), { y: 14, delay: 40, step: 45, max: 8 });
  }
  trackResult = result;
}

/* ---------- Página do produto: troca de foto e quantidade ---------- */
let pdpPrev = null;
function onPdpRender() {
  const el = document.getElementById('product-sheet');
  const img = $('.pdp__main img', el);
  const qtyEl = $('.pdp__buy .qty span', el);
  const cur = { name: $('.pdp__name', el)?.textContent || '', src: img?.getAttribute('src') || '', qty: qtyEl?.textContent || '' };
  if (pdpPrev && pdpPrev.name === cur.name && el.classList.contains('is-open') && motionOn()) {
    if (img && cur.src !== pdpPrev.src) play(img, [{ opacity: 0.25, scale: '1.035' }, { opacity: 1, scale: '1' }], { duration: 460, easing: EASE_OUT });
    if (qtyEl && cur.qty !== pdpPrev.qty) {
      const dir = Number(cur.qty) > Number(pdpPrev.qty) ? 1 : -1;
      play(qtyEl, [{ translate: `0px ${dir * 10}px`, opacity: 0 }, { translate: '0px 0px', opacity: 1 }], { duration: 260, easing: EASE_OUT });
    }
  }
  pdpPrev = cur;
}

/* =========================================================
   8. Banner: Ken Burns e texto subindo a cada slide
   ========================================================= */
const KB = [
  [{ transform: 'scale(1)' }, { transform: 'scale(1.08) translate3d(-1%, -.8%, 0)' }],
  [{ transform: 'scale(1.085) translate3d(1%, 0, 0)' }, { transform: 'scale(1.01)' }],
  [{ transform: 'scale(1.03) translate3d(0, .6%, 0)' }, { transform: 'scale(1.1) translate3d(.8%, -.6%, 0)' }],
];
const kbAnims = new WeakMap();

function heroActivate(slide, intro = true) {
  if (!motionOn() || !slide) return;
  const wrap = slide.parentElement;
  const img = $('.hero__img', slide);
  const i = Array.from(wrap.children).indexOf(slide);
  if (img) {
    kbAnims.get(img)?.cancel();
    kbAnims.set(img, play(img, KB[i % KB.length], { duration: 9000, easing: 'cubic-bezier(.3, .1, .6, 1)', fill: 'forwards' }));
  }
  if (!intro) return;
  // (sem getComputedStyle: animar um item escondido não custa nada, e a leitura forçava estilo no boot)
  $$('.hero__kicker, .hero__title, .hero__text', slide).forEach((e, k) => enter(e, { y: 26, delay: 160 + k * 110, duration: 900 }));
  const pins = $('.pins', slide);
  if (pins) enter(pins, { x: 28, y: 0, delay: 360, duration: 800 });
}

function heroDeactivate(slide) {
  const img = $('.hero__img', slide);
  const a = img && kbAnims.get(img);
  if (!a) return;
  // segue o movimento enquanto o slide some (sem "pulo"), e só então para
  setTimeout(() => {
    if (!slide.classList.contains('is-active')) {
      a.cancel();
      kbAnims.delete(img);
    }
  }, 900);
}

function setupHero() {
  const wrap = $('[data-hero-slides]');
  if (!wrap) return;
  new MutationObserver((recs) => {
    let rendered = false;
    recs.forEach((r) => {
      if (r.type === 'childList' && r.target === wrap) rendered = true;
      else if (r.type === 'attributes' && r.target.classList?.contains('hero__slide')) {
        const was = (r.oldValue || '').split(/\s+/).includes('is-active');
        const is = r.target.classList.contains('is-active');
        if (is && !was) heroActivate(r.target);
        else if (!is && was) heroDeactivate(r.target);
      }
    });
    if (rendered) heroActivate($('.hero__slide.is-active', wrap));
  }).observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  heroActivate($('.hero__slide.is-active', wrap), false);
}

/* =========================================================
   9. Aviso (toast): ✓ nas mensagens de sucesso e mola a cada mensagem nova
   ========================================================= */
const TOAST_BAD = /\bn[ãa]o\b|esgotad|indispon|vazio|erro|falh|inv[áa]lid|selecione|permita|sem conex/i;
const TOAST_OK = /adicionad|copiad|removid|agora voc[êe] est[áa]|voc[êe] est[áa] comprando|salv|atualizad|enviad|confirmad|pronto/i;

function setupToast() {
  const t = $('[data-toast]');
  if (!t) return;
  new MutationObserver(() => {
    const txt = t.textContent.trim();
    const ok = !!txt && TOAST_OK.test(txt) && !TOAST_BAD.test(txt);
    const wasVisible = t.classList.contains('is-visible');
    if (ok) {
      if (wasVisible && motionOn()) {
        t.removeAttribute('data-m-tone');
        void t.offsetWidth; // reinicia a animação do ✓
      }
      t.setAttribute('data-m-tone', 'ok');
    } else t.removeAttribute('data-m-tone');
    if (wasVisible && motionOn()) play(t, [{ scale: '.94' }, { scale: '1' }], { duration: 480, easing: SPRING });
  }).observe(t, { childList: true, characterData: true, subtree: true });
}

/* =========================================================
   10. Troca de página (início, listagem, ambiente 3D)
   ========================================================= */
function setupRoutes() {
  const els = ['[data-home]', '[data-listing]', '[data-room]'].map((s) => $(s)).filter(Boolean);
  const mo = new MutationObserver((recs) => {
    if (!motionOn()) return;
    const done = new Set();
    recs.forEach((r) => {
      const el = r.target;
      if (done.has(el) || el.hidden) return;
      const shown = r.type === 'attributes' && r.oldValue !== null;
      const rerender = r.type === 'childList' && r.addedNodes.length && window.scrollY < 4;
      if (!shown && !rerender) return;
      done.add(el);
      if (shown) scan(el);
      if (el.matches('[data-home]')) play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
      else play(el, [{ opacity: 0, translate: '0px 12px' }, { opacity: 1, translate: '0px 0px' }], { duration: shown ? 420 : 300, easing: EASE_OUT });
    });
  });
  els.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, childList: el.matches('[data-listing]') }));
}

/* ---------- Cor do card: a foto nova entra suave ---------- */
function setupCardSwap() {
  new MutationObserver((recs) => {
    if (!motionOn()) return;
    recs.forEach((r) => {
      if (!r.target.classList?.contains('card__media')) return;
      r.addedNodes.forEach((n) => {
        if (n.nodeName === 'PICTURE') play($('img', n), [{ opacity: 0.3, scale: '1.04' }, { opacity: 1, scale: '1' }], { duration: 420, easing: EASE_OUT });
      });
    });
  }).observe($('main') || document.body, { childList: true, subtree: true });
}

/* =========================================================
   Início
   ========================================================= */
let started = false;
const watchRender = (el, fn) => el && new MutationObserver(fn).observe(el, { childList: true });

export function initMotion() {
  if (started) return;
  started = true;
  const sync = () => html.classList.toggle('motion-ok', motionOn());
  try {
    sync();
    mqReduce.addEventListener?.('change', () => {
      sync();
      if (!motionOn()) revealAll();
    });
    // estados (contadores, ✓ do aviso) valem sempre; o resto checa motionOn() a cada uso
    setupToast();
    watchBadge('[data-cart-count]', 'cart');
    watchBadge('[data-wishlist-count]', 'wish');
    if (!HAS_WAAPI) return;
    setupPress();
    setupFlight();
    setupWish();
    watchLines($('[data-cart]'));
    watchLines($('[data-wishlist]'));
    setupLayers();
    watchRender(document.getElementById('checkout-sheet'), onCheckoutRender);
    watchRender(document.getElementById('track-sheet'), onTrackRender);
    watchRender(document.getElementById('product-sheet'), onPdpRender);
    setupHero();
    setupRoutes();
    setupCardSwap();
    if (HAS_IO) setupReveal();
  } catch (err) {
    // movimento é enfeite: se algo falhar, a loja segue normal e nada fica escondido
    console.error('[motion]', err);
    html.classList.remove('motion-ok');
    revealAll();
  }
}
