// Camadas sobre a página: menu lateral, gavetas da direita (busca, carrinho, favoritos) e janelas (sheets).
import { $, $$, focusables, trapTab } from './lib.js';

const header = () => $('[data-header]');
const panels = new Set();
export function setPanel(name, open) {
  if (open) panels.add(name);
  else panels.delete(name);
  header()?.classList.toggle('has-panel', panels.size > 0);
}

let lockCount = 0;
export function lockScroll(on) {
  lockCount = Math.max(0, lockCount + (on ? 1 : -1));
  document.body.classList.toggle('is-locked', lockCount > 0);
}

const onOpenHooks = {};
export const onOpen = (id, fn) => (onOpenHooks[id] = fn);

/* ---------- Menu lateral (abre sob o cabeçalho) ---------- */
export const menu = { open: false, locked: false };

export function toggleMenu(force) {
  const el = $('[data-menu-drawer]');
  const overlay = $('[data-menu-overlay]');
  const btn = $('[data-menu-toggle]');
  const open = force ?? !menu.open;
  if (open === menu.open) return;
  if (open) closeDrawer(false);
  menu.open = open;
  if (open) {
    document.documentElement.style.setProperty('--menu-top', `${Math.max(0, header().getBoundingClientRect().bottom)}px`);
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    menu.locked = !matchMedia('(min-width: 990px)').matches;
    if (menu.locked) lockScroll(true);
  } else {
    overlay.classList.remove('is-visible');
    setTimeout(() => {
      if (!menu.open) overlay.hidden = true;
    }, 160);
    if (menu.locked) lockScroll(false);
    menu.locked = false;
  }
  el.classList.toggle('is-open', open);
  el.setAttribute('aria-hidden', String(!open));
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  setPanel('menu', open);
  if (open) setTimeout(() => focusables(el)[0]?.focus({ preventScroll: true }), 60);
  else if (el.contains(document.activeElement)) btn.focus({ preventScroll: true });
}

/* ---------- Gavetas da direita ---------- */
export const drawer = { el: null, lastFocus: null };

export function openDrawer(id) {
  const el = document.getElementById(id);
  if (!el || drawer.el === el) return;
  toggleMenu(false);
  closeSheet(false);
  const prevFocus = drawer.el ? drawer.lastFocus : document.activeElement;
  if (drawer.el) closeDrawer(false);
  const overlay = $('[data-overlay]');
  drawer.el = el;
  drawer.lastFocus = prevFocus;
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  lockScroll(true);
  $$(`[aria-controls="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
  onOpenHooks[id]?.();
  focusInside(el, id === 'search-drawer' ? '[data-search-input]' : null);
}

export function closeDrawer(restore = true) {
  const el = drawer.el;
  if (!el) return;
  drawer.el = null;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  $$(`[aria-controls="${el.id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
  lockScroll(false);
  if (restore) {
    const overlay = $('[data-overlay]');
    overlay.classList.remove('is-visible');
    setTimeout(() => {
      if (!drawer.el) overlay.hidden = true;
    }, 250);
    drawer.lastFocus?.focus?.({ preventScroll: true });
  }
}

/* ---------- Janelas (produto, lojas, checkout, rastreio) ---------- */
export const sheet = { el: null, lastFocus: null, onClose: null };

export function openSheet(id, { onClose } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  toggleMenu(false);
  if (drawer.el) closeDrawer(false);
  const prevFocus = sheet.el ? sheet.lastFocus : document.activeElement;
  if (sheet.el && sheet.el !== el) closeSheet(false, true);
  const overlay = $('[data-sheet-overlay]');
  // a sobreposição das gavetas some quando uma janela abre
  const dOverlay = $('[data-overlay]');
  dOverlay.classList.remove('is-visible');
  dOverlay.hidden = true;
  if (sheet.el !== el) lockScroll(true);
  sheet.el = el;
  sheet.lastFocus = prevFocus;
  sheet.onClose = onClose || null;
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  focusInside(el);
}

export function closeSheet(restore = true, silent = false) {
  const el = sheet.el;
  if (!el) return;
  sheet.el = null;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  lockScroll(false);
  const overlay = $('[data-sheet-overlay]');
  overlay.classList.remove('is-visible');
  setTimeout(() => {
    if (!sheet.el) overlay.hidden = true;
  }, 220);
  const cb = sheet.onClose;
  sheet.onClose = null;
  if (!silent) cb?.();
  if (restore) sheet.lastFocus?.focus?.({ preventScroll: true });
}

// Foca o primeiro campo quando a animação deixa o elemento visível (inclusive com movimento reduzido).
// Em telas de toque não coloca o cursor num campo de texto ao abrir (abriria o teclado e daria zoom no iPhone):
// o foco vai para o botão de fechar, e a pessoa toca no campo quando quiser digitar.
const isTouch = () => matchMedia('(pointer: coarse)').matches;
function focusInside(el, selector) {
  let tries = 0;
  const go = () => {
    let target = (selector && $(selector, el)) || $('[autofocus]', el) || focusables(el)[0];
    if (!selector && isTouch() && target?.matches('input, textarea, select')) {
      target = $('[data-sheet-close], [data-close], .sheet__close, .drawer__close', el) || target;
    }
    if (target && (target.offsetWidth || target.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden') {
      target.focus({ preventScroll: true });
    } else if (tries++ < 30) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

export function initLayers() {
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-drawer]');
    if (opener) {
      e.preventDefault();
      openDrawer(opener.dataset.openDrawer);
      return;
    }
    if (e.target.closest('[data-open-search]')) {
      e.preventDefault();
      openDrawer('search-drawer');
      return;
    }
    if (e.target.closest('[data-close]') || e.target.matches('[data-overlay]')) closeDrawer();
    if (e.target.closest('[data-sheet-close]') || e.target.matches('[data-sheet-overlay]')) closeSheet();
    if (e.target.matches('[data-menu-overlay]')) toggleMenu(false);
  });
  $('[data-menu-toggle]').addEventListener('click', () => toggleMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sheet.el) {
        e.preventDefault();
        closeSheet();
      } else if (drawer.el) {
        e.preventDefault();
        closeDrawer();
      } else if (menu.open) {
        toggleMenu(false);
        $('[data-menu-toggle]').focus({ preventScroll: true });
      }
    }
    if (e.key === 'Tab') {
      if (sheet.el) trapTab(e, sheet.el);
      else if (drawer.el) trapTab(e, drawer.el);
      else if (menu.open) trapTab(e, $('[data-menu-drawer]'), [$('[data-menu-toggle]')]);
    }
  });
  const reposition = () => {
    if (menu.open) document.documentElement.style.setProperty('--menu-top', `${Math.max(0, header().getBoundingClientRect().bottom)}px`);
  };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });
}
