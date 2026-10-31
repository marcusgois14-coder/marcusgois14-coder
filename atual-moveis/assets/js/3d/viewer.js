// Visualizador 3D do produto (vitrine e painel).
//
//   open3D({ product, category, parentCategory, variantId, onVariant, onAddToCart, onClose })
//     Preenche e abre a janela #viewer3d-sheet (Esc, foco preso e sobreposição ficam com layers.js).
//     Devolve { setVariant(id), close(), ready, info() }.
//   mount3D(container, { product, category, parentCategory, variantId, interactive = true, autoRotate = true,
//                        toolbar = false, dims = false, view = 'three-quarter' })
//     Canvas embutível. Devolve { setVariant(id), setProduct(product, ctx), setView(view), showDims(on), dispose(), ready, info() }.
//   preload3D()  baixa three.js, o estúdio e os geradores antes (ex.: ao passar o mouse em "Ver em 3D").
//   hasWebGL()   o navegador consegue abrir o 3D (WebGL 2)?
//
// Este arquivo é leve: three.js, o estúdio e os geradores só carregam quando o 3D abre (com indicador de carregamento).
// Sem category, a categoria vem do catálogo carregado (state.js) pelo category_id do produto.
import { openSheet, closeSheet } from '../layers.js';
import { esc } from '../lib.js';

/* ---------- Textos ---------- */
const T = {
  loading: 'Carregando 3D…',
  noGL: 'Seu navegador não conseguiu abrir o 3D. Veja as fotos do produto.',
  noLib: 'Não foi possível carregar o 3D agora. Confira sua conexão e tente de novo.',
  no3D: 'Este produto ainda não tem visualização 3D. Veja as fotos do produto.',
  buildFail: 'Não foi possível montar o 3D deste produto agora. Veja as fotos do produto.',
  note: 'Modelo 3D ilustrativo gerado a partir das medidas do produto. Cores e detalhes podem variar.',
  hintTouch: 'Arraste para girar · Pinça para zoom · Toque duas vezes para centralizar',
  hintMouse: 'Arraste para girar · Role para zoom · Clique duas vezes para centralizar',
  ar: 'Ver no seu ambiente',
  arBusy: 'Preparando…',
  arOpen: 'Abrir no seu ambiente',
  arNo: 'Este aparelho não abre o 3D no seu ambiente.',
  arFail: 'Não foi possível abrir no seu ambiente agora.',
  arDesk: 'Abra no celular para ver no seu ambiente',
  add: 'Adicionar ao carrinho',
  added: 'Adicionado',
  soldout: 'Esgotado',
};
const VIEW_BUTTONS = [
  ['three-quarter', '3/4', 'Vista 3/4'],
  ['front', 'Frente', 'Vista de frente'],
  ['side', 'Lado', 'Vista de lado'],
  ['top', 'Cima', 'Vista de cima'],
];
// Ângulos (graus): az = giro a partir da frente (+Z) para a direita; el = elevação (máx. 84 com órbita)
const ANGLES = {
  'three-quarter': { az: 35, el: 18 },
  front: { az: 0, el: 6 },
  side: { az: 90, el: 6 },
  top: { az: 0, el: 84 },
  back: { az: 180, el: 12 },
};
const DIM_KEYS = [
  ['w', 'Largura'],
  ['h', 'Altura'],
  ['d', 'Profundidade'],
];

/* ---------- Ícones (embutidos: o painel não tem o sprite da vitrine) ---------- */
const svg = (body) => `<svg class="v3d__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  ruler: svg('<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.6 12.4 1.8 1.8m1.2-4.8 1.8 1.8m1.2-4.8 1.8 1.8"/>'),
  cube: svg('<path d="M12 2.8 20 7.3v9.4l-8 4.5-8-4.5V7.3z"/><path d="m4 7.3 8 4.5 8-4.5M12 11.8v9.4"/>'),
  cart: svg('<path d="M2.5 3.5h2.2l2.4 10.9a1.8 1.8 0 0 0 1.8 1.4h8a1.8 1.8 0 0 0 1.7-1.3L20.8 7H5.5"/><circle cx="9.6" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>'),
  phone: svg('<rect x="7" y="2.8" width="10" height="18.4" rx="2.2"/><path d="M11 17.8h2"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.6v5.4m0 3.3v.2"/>'),
};

/* ---------- Carregamento sob demanda ---------- */
let libsP = null;
function loadLibs() {
  if (!libsP) {
    libsP = Promise.all([import('three'), import('./stage.js'), import('./models/index.js'), import('./infer.js'), import('./kit.js')]).then(
      ([THREE, stage, models, infer, kit]) => ({ THREE, createStage: stage.createStage, models, infer, kit })
    );
    libsP.catch(() => (libsP = null));
  }
  return libsP;
}
export const preload3D = () => loadLibs().then(
  () => true,
  () => false
);

// three.js r170 precisa de WebGL 2
let glOk = null;
export function hasWebGL() {
  if (glOk !== null) return glOk;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    glOk = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    glOk = false;
  }
  return glOk;
}

/* ---------- Utilidades ---------- */
const mq = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
const isTouch = () => mq('(pointer: coarse)');
const now = () => performance.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtCm = (v) => `${(Math.round(Number(v) * 10) / 10).toLocaleString('pt-BR')} cm`;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
let uidSeq = 0;

// Cor do botão de variação: só valores CSS conhecidos (#hex, rgb(), gradiente)
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|(linear|radial)-gradient\([#\w\s.,%()-]+\))$/i;
const swatchColor = (v) => (v?.color && SAFE_COLOR.test(String(v.color).trim()) ? String(v.color).trim() : '');

// Pré-checagem barata de RA (a mesma lógica do model-viewer), sem baixar o model-viewer.
async function arCandidate(hasUrl) {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) {
    if (window.webkit?.messageHandlers) return /CriOS\/|EdgiOS\/|FxiOS\/|GSA\/|DuckDuckGo\//.test(ua) ? 'quick-look' : null;
    const a = document.createElement('a');
    return a.relList?.supports?.('ar') ? 'quick-look' : null;
  }
  try {
    if (navigator.xr && window.XRSession?.prototype?.requestHitTestSource && (await navigator.xr.isSessionSupported('immersive-ar'))) return 'webxr';
  } catch {
    /* sem WebXR */
  }
  // Scene Viewer (app do Google) precisa baixar o arquivo por https: só com .glb publicado
  if (hasUrl && /android/i.test(ua) && !/firefox|OculusBrowser/i.test(ua)) return 'scene-viewer';
  return null;
}

const waitEvent = (el, ok, bad, ms) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => done(reject, new Error('tempo esgotado')), ms);
    const onOk = () => done(resolve);
    const onBad = (e) => done(reject, e?.detail || new Error(bad));
    function done(fn, v) {
      clearTimeout(t);
      el.removeEventListener(ok, onOk);
      el.removeEventListener(bad, onBad);
      fn(v);
    }
    el.addEventListener(ok, onOk);
    el.addEventListener(bad, onBad);
  });
async function waitFor(test, ms) {
  const t0 = now();
  while (now() - t0 < ms) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return !!test();
}

/* ---------- Marcação ---------- */
function variantButtons(variants) {
  return variants
    .map((v) => {
      const out = v.in_stock === false;
      const color = swatchColor(v);
      const label = `Cor ${v.name || ''}${out ? ' (esgotada)' : ''}`;
      return color
        ? `<button class="v3d__swatch${out ? ' is-out' : ''}" type="button" data-v3d-variant="${esc(v.id)}" aria-pressed="false" aria-label="${esc(label)}" title="${esc(v.name)}${out ? ' (esgotada)' : ''}"><span style="--sw:${esc(color)}"></span></button>`
        : `<button class="v3d__chipbtn${out ? ' is-out' : ''}" type="button" data-v3d-variant="${esc(v.id)}" aria-pressed="false" aria-label="${esc(label)}">${esc(v.name)}</button>`;
    })
    .join('');
}

function viewButtons() {
  return VIEW_BUTTONS.map(([id, text, label]) => `<button type="button" data-v3d-view="${id}" aria-pressed="false" aria-label="${label}">${text}</button>`).join('');
}

function dimsMarkup() {
  return `<svg class="v3d__dims" aria-hidden="true" focusable="false" hidden>${DIM_KEYS.map(
    ([k]) => `<g data-dim="${k}"><path class="v3d__dim-ext" d=""/><path class="v3d__dim-line" d=""/></g>`
  ).join('')}</svg>
  <div class="v3d__dim-labels" aria-hidden="true" hidden>${DIM_KEYS.map(([k, label]) => `<span class="v3d__dim" data-dim-label="${k}"><small>${label}</small><b></b></span>`).join('')}</div>`;
}

function sheetMarkup({ name, uid, variants, canAdd }) {
  return `<div class="v3d v3d--sheet is-loading" data-v3d>
    <div class="v3d__top">
      <div class="v3d__heading"><span class="v3d__chip">3D</span><h2 class="v3d__name" id="${uid}-title">${esc(name)}</h2></div>
      <button class="v3d__close" type="button" data-sheet-close data-v3d-close aria-label="Fechar 3D">${ICON.close}</button>
    </div>
    <div class="v3d__stage" data-v3d-stage>
      <canvas class="v3d__canvas" tabindex="0" role="application" aria-roledescription="modelo 3D interativo" aria-label="Modelo 3D de ${esc(name)}"></canvas>
      ${dimsMarkup()}
    </div>
    <div class="v3d__state" data-v3d-state role="status"><span class="v3d__spinner" aria-hidden="true"></span><p>${T.loading}</p></div>
    <p class="v3d__toast" data-v3d-toast role="status" hidden></p>
    <div class="v3d__bottom">
      <p class="v3d__hint" data-v3d-hint hidden>${isTouch() ? T.hintTouch : T.hintMouse}</p>
      <div class="v3d__bar" data-v3d-bar>
        ${
          variants.length > 1
            ? `<div class="v3d__colors"><div class="v3d__swatches" role="group" aria-label="Cores">${variantButtons(variants)}</div><span class="v3d__color-name" data-v3d-color-name></span></div>`
            : ''
        }
        <div class="v3d__tools">
          <button class="v3d__btn" type="button" data-v3d-dims aria-pressed="false">${ICON.ruler}<span>Medidas</span></button>
          <div class="v3d__seg" role="group" aria-label="Vista"><span class="v3d__seg-k" aria-hidden="true">Vista</span>${viewButtons()}</div>
          <button class="v3d__btn v3d__btn--ar" type="button" data-v3d-ar hidden>${ICON.cube}<span>${T.ar}</span></button>
          <span class="v3d__ar-hint" data-v3d-ar-hint hidden>${ICON.phone}${T.arDesk}</span>
        </div>
        ${canAdd ? `<button class="v3d__cta" type="button" data-v3d-add>${ICON.cart}<span>${T.add}</span></button>` : ''}
      </div>
      <p class="v3d__note" data-v3d-note hidden>${T.note}</p>
    </div>
    <p class="v3d__sr" aria-live="polite" data-v3d-live></p>
  </div>`;
}

function embedMarkup({ name, interactive, toolbar }) {
  return `<div class="v3d v3d--embed is-loading" data-v3d>
    <div class="v3d__stage" data-v3d-stage>
      <canvas class="v3d__canvas${interactive ? '' : ' is-static'}" ${interactive ? 'tabindex="0" role="application" aria-roledescription="modelo 3D interativo"' : 'role="img"'} aria-label="Modelo 3D de ${esc(name)}"></canvas>
      ${dimsMarkup()}
    </div>
    <div class="v3d__state" data-v3d-state role="status"><span class="v3d__spinner" aria-hidden="true"></span><p>${T.loading}</p></div>
    ${
      toolbar
        ? `<div class="v3d__mini"><button class="v3d__btn v3d__btn--sm" type="button" data-v3d-dims aria-pressed="false">${ICON.ruler}<span>Medidas</span></button><div class="v3d__seg v3d__seg--sm" role="group" aria-label="Vista">${viewButtons()}</div></div>`
        : ''
    }
    <p class="v3d__note v3d__note--embed" data-v3d-note hidden>${T.note}</p>
    <p class="v3d__sr" aria-live="polite" data-v3d-live></p>
  </div>`;
}

/* ---------- Núcleo: um visualizador (janela ou embutido) ---------- */
function createViewer(host, o) {
  const mode = o.mode;
  const sheetMode = mode === 'sheet';
  const interactive = sheetMode || o.interactive !== false;
  const uid = `v3d${++uidSeq}`;
  let product = o.product || {};
  let category = o.category;
  let parentCategory = o.parentCategory;
  let variants = Array.isArray(product.variants) ? product.variants.filter((v) => v && v.id) : [];
  let variantId = pickVariantId(o.variantId);

  // marcação
  let root;
  if (sheetMode) {
    host.innerHTML = sheetMarkup({ name: product.name || 'Produto', uid, variants, canAdd: typeof o.onAddToCart === 'function' });
    root = host.firstElementChild;
    host.setAttribute('aria-label', `${product.name || 'Produto'} em 3D`);
  } else {
    host.insertAdjacentHTML('beforeend', embedMarkup({ name: product.name || 'Produto', interactive, toolbar: !!o.toolbar }));
    root = host.lastElementChild;
  }
  const q = (s) => root.querySelector(s);
  const stageEl = q('[data-v3d-stage]');
  const canvas = q('canvas');
  const stateEl = q('[data-v3d-state]');
  const barEl = q('[data-v3d-bar]');
  const topEl = q('.v3d__top');
  const svgEl = q('.v3d__dims');
  const labelsEl = q('.v3d__dim-labels');
  const liveEl = q('[data-v3d-live]');
  const noteEl = q('[data-v3d-note]');
  const hintEl = q('[data-v3d-hint]');
  const toastEl = q('[data-v3d-toast]');
  const arBtn = q('[data-v3d-ar]');
  const arHint = q('[data-v3d-ar-hint]');
  const addBtn = q('[data-v3d-add]');

  // estado
  let L = null;
  let stage = null;
  let camera = null;
  let controls = null;
  let spec = null;
  let source = 'procedural';
  let result = null;
  let disposed = false;
  let raf = 0;
  let dirty = true;
  let lastT = 0;
  let tween = null;
  let size = { w: 1, h: 1 };
  let insets = { top: 0, bottom: 0, left: 0, right: 0 };
  let homeDist = 1;
  let userMoved = false;
  let activeView = o.view && ANGLES[o.view] ? o.view : 'three-quarter';
  let dimsOn = !!o.dims;
  let dimOff = 0.05;
  let buildToken = 0;
  let rotateUntil = 0;
  let memory = null;
  let gl = null; // contexto WebGL (para conferir se foi liberado)
  let lastTap = null;
  let downTap = null;
  let hintTimer = 0;
  let toastTimer = 0;
  let addTimer = 0;
  let visible = true;
  const shown = new Set(); // grupos que já passaram pela cena (para liberar a GPU no fim)
  const cleanups = [];
  const listen = (el, ev, fn, opt) => {
    el.addEventListener(ev, fn, opt);
    cleanups.push(() => el.removeEventListener(ev, fn, opt));
  };
  // RA
  const ar = { mode: null, mv: null, url: '', key: '', busy: false, ready: false };

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  function pickVariantId(id) {
    if (!variants.length) return null;
    if (id && variants.some((v) => v.id === id)) return id;
    return (variants.find((v) => v.in_stock !== false) || variants[0]).id;
  }
  const currentVariant = () => variants.find((v) => v.id === variantId) || null;

  /* ----- estados visuais ----- */
  function setState(kind, msg) {
    root.classList.toggle('is-loading', kind === 'loading');
    root.classList.toggle('is-error', kind === 'error');
    root.classList.toggle('is-ready', kind === 'ready');
    if (kind === 'ready') {
      stateEl.hidden = true;
      stateEl.innerHTML = '';
      return;
    }
    stateEl.hidden = false;
    stateEl.innerHTML =
      kind === 'loading'
        ? `<span class="v3d__spinner" aria-hidden="true"></span><p>${T.loading}</p>`
        : `${ICON.alert}<p>${esc(msg)}</p>${sheetMode ? '<button class="v3d__btn v3d__btn--solid" type="button" data-sheet-close data-v3d-close>Fechar</button>' : ''}`;
    if (kind === 'error' && sheetMode) requestAnimationFrame(() => q('.v3d__state [data-v3d-close]')?.focus({ preventScroll: true }));
  }
  function fail(msg) {
    if (disposed) return;
    setState('error', msg);
    stopLoop();
    resolveReady({ error: msg });
  }
  const live = (msg) => {
    if (!liveEl) return;
    liveEl.textContent = '';
    setTimeout(() => {
      if (!disposed) liveEl.textContent = msg;
    }, 40);
  };
  function flash(msg) {
    if (!toastEl) return live(msg);
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 3800);
  }

  /* ----- variações e carrinho ----- */
  function syncVariantUI() {
    const v = currentVariant();
    root.querySelectorAll('[data-v3d-variant]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v3dVariant === variantId)));
    const nameEl = q('[data-v3d-color-name]');
    if (nameEl) nameEl.textContent = v ? `${v.name}${v.in_stock === false ? ' · esgotada' : ''}` : '';
    if (addBtn) {
      const inStock = v ? v.in_stock !== false : product.in_stock !== false;
      addBtn.disabled = !inStock;
      addBtn.classList.remove('is-done');
      clearTimeout(addTimer);
      addBtn.innerHTML = inStock ? `${ICON.cart}<span>${T.add}</span>` : `<span>${T.soldout}</span>`;
    }
  }

  function specFor(variant) {
    return L.infer.inferSpec(product, { category, parentCategory, variant: variant || undefined });
  }

  async function setVariant(id, { fromUser = false } = {}) {
    const v = variants.find((x) => x.id === id);
    if (!v || disposed) return;
    const changed = id !== variantId;
    variantId = id;
    syncVariantUI();
    if (fromUser && changed) {
      live(`Cor: ${v.name}`);
      try {
        o.onVariant?.(id, v);
      } catch (err) {
        console.warn('[3d] onVariant:', err);
      }
    }
    if (!L || !stage || source !== 'procedural' || !changed) return;
    const token = ++buildToken;
    const s = specFor(v);
    if (!s) return;
    try {
      const res = await L.models.buildModel(s);
      if (token !== buildToken || disposed) return;
      spec = s;
      result = res;
      showModel(res, { keepCamera: true });
      ar.ready = false;
    } catch (err) {
      console.warn('[3d] troca de cor:', err);
    }
  }

  // Gera as outras cores em tempo ocioso: a troca fica instantânea
  function prebuildVariants() {
    if (source !== 'procedural' || variants.length < 2) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 120));
    const queue = variants.filter((v) => v.id !== variantId);
    const step = () => {
      if (disposed) return;
      const v = queue.shift();
      if (!v) return;
      const s = specFor(v);
      (s ? L.models.buildModel(s) : Promise.resolve())
        .catch(() => null)
        .then(() => idle(step));
    };
    idle(step);
  }

  /* ----- carregamento ----- */
  async function resolveCategory() {
    if (category !== undefined || !product.category_id) return;
    try {
      const { S } = await import('../state.js');
      category = S.catById?.[product.category_id] || null;
      if (parentCategory === undefined) parentCategory = category?.parent_id ? S.catById[category.parent_id] || null : null;
    } catch {
      category = null;
    }
  }

  async function start() {
    setState('loading');
    if (!hasWebGL()) return fail(T.noGL);
    try {
      L = await loadLibs();
    } catch (err) {
      console.warn('[3d] falha ao carregar o 3D:', err);
      return fail(T.noLib);
    }
    if (disposed) return;
    await resolveCategory();
    if (disposed) return;
    try {
      const r = stageEl.getBoundingClientRect();
      size = { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
      stage = L.createStage({ canvas, width: size.w, height: size.h, transparent: true });
    } catch (err) {
      console.warn('[3d] WebGL indisponível:', err);
      return fail(T.noGL);
    }
    camera = stage.camera;
    camera.up.set(0, 1, 0);
    gl = stage.renderer.getContext();
    setupControls();
    setupEvents();
    layout();
    await loadModel();
  }

  async function loadModel() {
    const token = ++buildToken;
    let s;
    try {
      s = specFor(currentVariant());
    } catch (err) {
      console.warn('[3d] inferSpec:', err);
      s = null;
    }
    if (!s) return fail(T.no3D);
    let res = null;
    let src = 'procedural';
    const url = typeof product.model_url === 'string' ? product.model_url.trim() : '';
    if (/^https?:\/\//i.test(url)) {
      try {
        res = await L.models.loadModelUrl(url, s);
        src = 'url';
      } catch (err) {
        console.warn('[3d] .glb indisponível, usando o modelo gerado:', err);
      }
    }
    try {
      if (!res) res = await L.models.buildModel(s);
    } catch (err) {
      console.warn('[3d] falha ao montar o modelo:', err);
      if (token === buildToken) fail(T.buildFail);
      return;
    }
    if (disposed || token !== buildToken) return;
    spec = s;
    source = src;
    result = res;
    showModel(res, { keepCamera: false });
    setState('ready');
    // aviso honesto só para modelo gerado (no embutido, só com a barra de ferramentas)
    if (noteEl) noteEl.hidden = source !== 'procedural' || (!sheetMode && !o.toolbar);
    updateAria();
    startAutoRotate();
    showHint();
    if (dimsOn) setDims(true, { silent: true });
    checkAR();
    prebuildVariants();
    resolveReady(report());
  }

  function report() {
    return {
      kind: spec?.kind,
      source,
      spec,
      size: result?.size,
      triangles: result?.triangles,
      ms: result?.ms,
      warnings: result?.warnings || [],
      variantId,
    };
  }

  function showModel(res, { keepCamera }) {
    stage.setModel(res.group);
    shown.add(res.group);
    const s = stage.bbox.getSize(new L.THREE.Vector3());
    dimOff = clamp(Math.max(s.x, s.y, s.z) * 0.07, 0.035, 0.14);
    updateDimValues();
    if (!keepCamera) {
      const pose = fitPose(ANGLES[activeView]);
      homeDist = fitPose(ANGLES['three-quarter']).dist;
      applyPose(pose);
      setPressedView(activeView);
    } else {
      // mesmas medidas na troca de cor: só reaponta o alvo para o centro novo
      controls.target.copy(stage.bbox.getCenter(new L.THREE.Vector3()));
      controls.update();
    }
    setLimits();
    invalidate();
  }

  function updateAria() {
    if (!spec) return;
    const d = dimValues();
    canvas.setAttribute(
      'aria-label',
      `Modelo 3D de ${product.name || 'produto'}: ${fmtCm(d.w)} de largura, ${fmtCm(d.h)} de altura e ${fmtCm(d.d)} de profundidade.${
        interactive ? ' Use as setas para girar, + e − para zoom e 0 para centralizar.' : ''
      }`
    );
  }

  /* ----- câmera ----- */
  function setupControls() {
    controls = stage.controls(canvas);
    controls.enabled = interactive;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.8;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // nunca abaixo do chão
    controls.autoRotateSpeed = 1.4;
    controls.addEventListener('change', invalidate);
    controls.addEventListener('start', onInteract);
  }
  function setLimits() {
    controls.minDistance = homeDist * 0.32;
    controls.maxDistance = homeDist * 2.6;
  }

  // Distância e alvo para enquadrar a caixa no ângulo pedido, dentro da área livre (sem as barras)
  function fitPose(angle, { box = stage.bbox, pad = sheetMode ? (size.w < 600 ? 1.16 : 1.1) : 1.06 } = {}) {
    const { THREE } = L;
    const az = THREE.MathUtils.degToRad(angle.az);
    const el = THREE.MathUtils.degToRad(Math.min(angle.el, 84));
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const c = box.getCenter(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const hf = clamp((size.h - insets.top - insets.bottom) / size.h, 0.25, 1);
    const wf = clamp((size.w - insets.left - insets.right) / size.w, 0.25, 1);
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tv = (t * hf) / pad;
    const th = (t * (size.w / size.h) * wf) / pad;
    let dist = 0;
    const p = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).sub(c);
          const depth = p.dot(dir);
          dist = Math.max(dist, depth + Math.abs(p.dot(right)) / th, depth + Math.abs(p.dot(up)) / tv);
        }
    return { position: c.clone().addScaledVector(dir, dist), target: c, dist };
  }
  function applyPose(pose) {
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    camera.lookAt(pose.target);
    controls.update();
    invalidate();
  }
  // Ângulo atual da câmera (para reenquadrar sem girar)
  function currentAngle() {
    const off = camera.position.clone().sub(controls.target);
    const r = off.length() || 1;
    return { az: L.THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z)), el: L.THREE.MathUtils.radToDeg(Math.asin(clamp(off.y / r, -1, 1))) };
  }
  function animateTo(pose, ms = 650) {
    const { THREE } = L;
    if (reducedMotion() || ms <= 0) {
      tween = null;
      applyPose(pose);
      return;
    }
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const to = new THREE.Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    let dTheta = to.theta - from.theta;
    dTheta = ((((dTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    tween = { t0: now(), ms, from, to, dTheta, fromT: controls.target.clone(), toT: pose.target.clone() };
    invalidate();
  }
  function stepTween(t) {
    const { THREE } = L;
    const k = clamp((t - tween.t0) / tween.ms, 0, 1);
    const e = easeInOut(k);
    const { from, to } = tween;
    const s = new THREE.Spherical(from.radius + (to.radius - from.radius) * e, from.phi + (to.phi - from.phi) * e, from.theta + tween.dTheta * e);
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    if (k >= 1) tween = null;
  }
  function setView(view, { animate = true } = {}) {
    if (!stage || !ANGLES[view]) return;
    activeView = view;
    stopAutoRotate();
    const box = dimsOn ? dimsBox() : stage.bbox;
    animateTo(fitPose(ANGLES[view], { box, pad: dimsOn ? 1.18 : undefined }), animate ? 650 : 0);
    setPressedView(view);
    userMoved = false;
  }
  function resetView() {
    setView('three-quarter');
    live('Vista centralizada');
  }
  function setPressedView(view) {
    root.querySelectorAll('[data-v3d-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v3dView === view)));
  }
  function orbitBy(dTheta, dPhi, kZoom = 1) {
    if (!controls) return;
    const { THREE } = L;
    tween = null;
    const off = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    s.theta += dTheta;
    s.phi = clamp(s.phi + dPhi, controls.minPolarAngle, controls.maxPolarAngle);
    s.radius = clamp(s.radius * kZoom, controls.minDistance, controls.maxDistance);
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    invalidate();
  }

  /* ----- giro automático ----- */
  function startAutoRotate() {
    if (!controls || o.autoRotate === false || reducedMotion()) return;
    controls.autoRotate = true;
    rotateUntil = now() + 60000; // para depois de 1 minuto (bateria)
    invalidate();
  }
  function stopAutoRotate() {
    if (controls) controls.autoRotate = false;
  }
  function onInteract() {
    stopAutoRotate();
    tween = null;
    userMoved = true;
    setPressedView('');
    hideHint();
  }

  /* ----- laço de desenho sob demanda ----- */
  function invalidate() {
    dirty = true;
    if (!raf && !disposed && stage && visible && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function tick(t) {
    raf = 0;
    if (disposed || !stage) return;
    const dt = lastT ? clamp((t - lastT) / 1000, 0, 0.1) : 1 / 60;
    lastT = t;
    let moving = false;
    if (tween) {
      stepTween(t);
      moving = true;
    }
    if (controls.autoRotate && now() > rotateUntil) controls.autoRotate = false;
    if (controls.update(dt)) moving = true;
    if (dirty || moving) {
      stage.render();
      if (dimsOn) drawDims();
      dirty = false;
    }
    if (!raf && (moving || tween || controls.autoRotate)) raf = requestAnimationFrame(tick);
    else if (!raf) lastT = 0;
  }

  /* ----- tamanho e área livre ----- */
  function measureInsets() {
    if (!sheetMode) return { top: 0, bottom: 0, left: 0, right: 0 };
    const r = stageEl.getBoundingClientRect();
    const top = topEl ? Math.max(0, topEl.getBoundingClientRect().bottom - r.top) + 4 : 0;
    const b = barEl && barEl.getClientRects().length ? barEl.getBoundingClientRect() : null;
    const bottom = b ? Math.max(0, r.bottom - b.top) + 4 : 0;
    return { top, bottom: Math.min(bottom, r.height * 0.6), left: 0, right: 0 };
  }
  function layout() {
    if (!stage || disposed) return;
    const r = stageEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w < 2 || h < 2) return;
    const changed = w !== size.w || h !== size.h;
    size = { w, h };
    if (changed) {
      stage.resize(w, h);
      labelsEl?.querySelectorAll('.v3d__dim').forEach((l) => (l._w = 0)); // a fonte muda com a largura
    }
    const prev = insets;
    insets = measureInsets();
    // desloca o centro da imagem para o meio da área livre
    camera.setViewOffset(w, h, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, w, h);
    if (svgEl) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const moved = changed || prev.top !== insets.top || prev.bottom !== insets.bottom;
    if (moved && result && !userMoved && !tween) {
      const box = dimsOn ? dimsBox() : stage.bbox;
      // mantém o ângulo atual (inclusive durante o giro automático) e só ajusta a distância
      applyPose(fitPose(currentAngle(), { box, pad: dimsOn ? 1.18 : undefined }));
      homeDist = fitPose(ANGLES['three-quarter']).dist;
      setLimits();
    }
    invalidate();
  }

  /* ----- medidas ----- */
  function dimValues() {
    if (source === 'url' && result?.size && !spec) return result.size;
    return spec ? { w: spec.w, h: spec.h, d: spec.d } : result?.size || { w: 0, h: 0, d: 0 };
  }
  function updateDimValues() {
    if (!labelsEl) return;
    const d = dimValues();
    for (const [k] of DIM_KEYS) {
      const el = labelsEl.querySelector(`[data-dim-label="${k}"]`);
      if (!el) continue;
      el.querySelector('b').textContent = fmtCm(d[k]);
      el._w = 0; // mede de novo
    }
  }
  function dimsBox() {
    const extra = dimOff + 0.035;
    return stage.bbox.clone().expandByVector(new L.THREE.Vector3(extra, 0, extra));
  }
  function setDims(on, { silent = false } = {}) {
    dimsOn = !!on;
    root.querySelectorAll('[data-v3d-dims]').forEach((b) => b.setAttribute('aria-pressed', String(dimsOn)));
    // <svg> não tem a propriedade .hidden: usa o atributo
    svgEl?.toggleAttribute('hidden', !dimsOn);
    labelsEl?.toggleAttribute('hidden', !dimsOn);
    root.classList.toggle('has-dims', dimsOn);
    if (!stage || !result) return;
    if (dimsOn) {
      stopAutoRotate();
      // afasta um pouco a câmera se as cotas não couberem
      const need = fitPose(currentAngle(), { box: dimsBox(), pad: 1.18 });
      const dist = camera.position.distanceTo(controls.target);
      if (need.dist > dist * 1.01) animateTo({ position: need.position, target: need.target }, silent ? 0 : 500);
      if (!silent) {
        const d = dimValues();
        live(`Medidas: largura ${fmtCm(d.w)}, altura ${fmtCm(d.h)}, profundidade ${fmtCm(d.d)}.`);
      }
    } else if (!silent) live('Medidas ocultas');
    invalidate();
  }
  function drawDims() {
    if (!svgEl || !labelsEl) return;
    const { THREE } = L;
    const b = stage.bbox;
    const c = b.getCenter(new THREE.Vector3());
    const sx = camera.position.x >= c.x ? 1 : -1;
    const sz = camera.position.z >= c.z ? 1 : -1;
    const off = dimOff;
    const zF = sz > 0 ? b.max.z : b.min.z;
    const xN = sx > 0 ? b.max.x : b.min.x;
    const xF = sx > 0 ? b.min.x : b.max.x;
    const y0 = b.min.y + 0.002;
    const lines = {
      // largura: na borda de baixo do lado que a câmera vê
      w: { a: [b.min.x, y0, zF + sz * off], b: [b.max.x, y0, zF + sz * off], ea: [b.min.x, y0, zF], eb: [b.max.x, y0, zF] },
      // profundidade: na borda de baixo da lateral próxima
      d: { a: [xN + sx * off, y0, b.min.z], b: [xN + sx * off, y0, b.max.z], ea: [xN, y0, b.min.z], eb: [xN, y0, b.max.z] },
      // altura: na quina da frente do lado oposto
      h: { a: [xF - sx * off, b.min.y, zF], b: [xF - sx * off, b.max.y, zF], ea: [xF, b.min.y, zF], eb: [xF, b.max.y, zF] },
    };
    const v = new THREE.Vector3();
    const P = (pt) => {
      v.set(pt[0], pt[1], pt[2]).project(camera);
      return [((v.x + 1) / 2) * size.w, ((1 - v.y) / 2) * size.h, v.z];
    };
    const f = (n) => n.toFixed(1);
    const place = [];
    for (const [k] of DIM_KEYS) {
      const g = svgEl.querySelector(`[data-dim="${k}"]`);
      const label = labelsEl.querySelector(`[data-dim-label="${k}"]`);
      const L3 = lines[k];
      const A = P(L3.a);
      const B = P(L3.b);
      const EA = P(L3.ea);
      const EB = P(L3.eb);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const ok = len > 34 && A[2] < 1 && B[2] < 1;
      g.style.display = ok ? '' : 'none';
      label.style.display = ok ? '' : 'none';
      if (!ok) continue;
      const ux = (B[0] - A[0]) / len;
      const uy = (B[1] - A[1]) / len;
      const nx = -uy * 5;
      const ny = ux * 5;
      g.querySelector('.v3d__dim-ext').setAttribute('d', `M${f(EA[0])} ${f(EA[1])}L${f(A[0])} ${f(A[1])}M${f(EB[0])} ${f(EB[1])}L${f(B[0])} ${f(B[1])}`);
      g.querySelector('.v3d__dim-line').setAttribute(
        'd',
        `M${f(A[0])} ${f(A[1])}L${f(B[0])} ${f(B[1])}M${f(A[0] - nx)} ${f(A[1] - ny)}L${f(A[0] + nx)} ${f(A[1] + ny)}M${f(B[0] - nx)} ${f(B[1] - ny)}L${f(B[0] + nx)} ${f(B[1] + ny)}`
      );
      place.push([label, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
    }
    // etiquetas no meio da cota, sem sair da área livre (medidas guardadas até o texto mudar)
    for (const [label, x, y] of place) {
      if (!label._w) {
        label._w = label.offsetWidth;
        label._h = label.offsetHeight;
      }
      const hw = label._w / 2 + 6;
      const hh = label._h / 2 + 4;
      const cx = clamp(x, hw, Math.max(hw, size.w - hw));
      const cy = clamp(y, insets.top + hh, Math.max(insets.top + hh, size.h - insets.bottom - hh));
      label.style.transform = `translate(${f(cx - label._w / 2)}px, ${f(cy - label._h / 2)}px)`;
    }
  }

  /* ----- dica de uso ----- */
  function showHint() {
    if (!hintEl || !interactive) return;
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 6000);
  }
  function hideHint() {
    if (hintEl) hintEl.hidden = true;
  }

  /* ----- realidade aumentada ("Ver no seu ambiente") ----- */
  async function checkAR() {
    if (!arBtn) return;
    const hasUrl = source === 'url';
    ar.mode = await arCandidate(hasUrl);
    if (disposed) return;
    arBtn.hidden = !ar.mode;
    // no computador: dica para abrir no celular
    if (arHint) arHint.hidden = !!ar.mode || isTouch();
    layout();
  }
  async function exportGLB() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const obj = L.kit.compact(result.group);
    const buf = await new GLTFExporter().parseAsync(obj, { binary: true, onlyVisible: true, maxTextureSize: 256 });
    return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  }
  function setArLabel(text, busy = false) {
    if (!arBtn) return;
    arBtn.innerHTML = `${busy ? '<span class="v3d__spinner v3d__spinner--sm" aria-hidden="true"></span>' : ICON.cube}<span>${text}</span>`;
    arBtn.setAttribute('aria-busy', String(busy));
  }
  async function prepareAR() {
    await import('../../vendor/model-viewer/model-viewer.min.js');
    const key = source === 'url' ? product.model_url : JSON.stringify(spec);
    if (!ar.mv || ar.key !== key) {
      if (ar.url) URL.revokeObjectURL(ar.url);
      ar.url = '';
      const src = source === 'url' ? product.model_url : (ar.url = await exportGLB());
      if (disposed) return false;
      if (!ar.mv) {
        ar.mv = document.createElement('model-viewer');
        ar.mv.className = 'v3d__mv';
        ar.mv.setAttribute('aria-hidden', 'true');
        ar.mv.setAttribute('tabindex', '-1');
        ar.mv.setAttribute('ar', '');
        ar.mv.setAttribute('ar-scale', 'fixed'); // tamanho real, sem esticar
        ar.mv.setAttribute('ar-placement', 'floor');
        ar.mv.setAttribute('loading', 'eager');
        ar.mv.setAttribute('reveal', 'auto');
        ar.mv.setAttribute('alt', product.name || 'Produto');
        root.appendChild(ar.mv);
      }
      // Scene Viewer só abre arquivo publicado (https); o modelo gerado vai por WebXR ou Quick Look
      ar.mv.setAttribute('ar-modes', source === 'url' ? 'webxr scene-viewer quick-look' : 'webxr quick-look');
      const loaded = waitEvent(ar.mv, 'load', 'error', 20000);
      ar.mv.setAttribute('src', src);
      await loaded;
      ar.key = key;
    }
    return waitFor(() => ar.mv?.canActivateAR, 1500);
  }
  async function onAR() {
    if (ar.busy || !result) return;
    if (ar.ready && ar.mv?.canActivateAR) {
      ar.mv.activateAR();
      setArLabel(T.ar);
      return;
    }
    ar.busy = true;
    setArLabel(T.arBusy, true);
    const t0 = now();
    try {
      const ok = await prepareAR();
      if (disposed) return;
      if (!ok) {
        arBtn.hidden = true;
        flash(T.arNo);
        layout();
        return;
      }
      ar.ready = true;
      // o navegador só deixa abrir a RA logo depois do toque; se demorou, pede um segundo toque
      if (now() - t0 < 2500) {
        ar.mv.activateAR();
        setArLabel(T.ar);
      } else setArLabel(T.arOpen);
    } catch (err) {
      console.warn('[3d] RA:', err);
      if (!disposed) {
        setArLabel(T.ar);
        flash(T.arFail);
      }
    } finally {
      ar.busy = false;
      if (!disposed && arBtn?.getAttribute('aria-busy') === 'true') setArLabel(T.ar);
    }
  }

  /* ----- eventos ----- */
  function setupEvents() {
    listen(root, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t || !root.contains(t)) return;
      if (t.dataset.v3dVariant) setVariant(t.dataset.v3dVariant, { fromUser: true });
      else if (t.dataset.v3dView) setView(t.dataset.v3dView);
      else if ('v3dDims' in t.dataset) setDims(!dimsOn);
      else if ('v3dAr' in t.dataset) onAR();
      else if ('v3dAdd' in t.dataset) onAdd();
      else if ('v3dClose' in t.dataset && sheetMode) closeSheet();
    });
    if (interactive) {
      listen(canvas, 'keydown', onKey);
      // toque duplo / clique duplo: volta à vista inicial
      listen(canvas, 'pointerdown', (e) => {
        downTap = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId };
      });
      listen(canvas, 'pointerup', (e) => {
        const d = downTap;
        downTap = null;
        if (!d || d.id !== e.pointerId || now() - d.t > 320 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) {
          lastTap = null;
          return;
        }
        if (lastTap && now() - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          lastTap = null;
          resetView();
        } else lastTap = { x: e.clientX, y: e.clientY, t: now() };
      });
    }
    listen(canvas, 'webglcontextlost', onContextLost);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) stopLoop();
      else {
        lastT = 0;
        invalidate();
      }
    });
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => layout());
      ro.observe(stageEl);
      if (barEl) ro.observe(barEl);
      if (topEl) ro.observe(topEl);
      cleanups.push(() => ro.disconnect());
    } else listen(window, 'resize', layout);
    // embutido: pausa quando sai da tela
    if (!sheetMode && typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(([en]) => {
        visible = !!en?.isIntersecting;
        if (visible) invalidate();
        else stopLoop();
      });
      io.observe(root);
      cleanups.push(() => io.disconnect());
    }
  }
  function onKey(e) {
    if (!result) return;
    const step = e.shiftKey ? 0.4 : 0.17;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        orbitBy(step, 0);
        break;
      case 'ArrowRight':
        orbitBy(-step, 0);
        break;
      case 'ArrowUp':
        orbitBy(0, -step * 0.6);
        break;
      case 'ArrowDown':
        orbitBy(0, step * 0.6);
        break;
      case '+':
      case '=':
      case 'PageUp':
        orbitBy(0, 0, 0.85);
        break;
      case '-':
      case '_':
      case 'PageDown':
        orbitBy(0, 0, 1 / 0.85);
        break;
      case '0':
      case 'Home':
        resetView();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (e.key !== '0' && e.key !== 'Home') onInteract();
    }
  }
  function onContextLost(e) {
    e.preventDefault();
    fail(T.noGL);
  }
  function onAdd() {
    if (!addBtn || addBtn.disabled) return;
    try {
      o.onAddToCart?.(variantId || null);
    } catch (err) {
      console.warn('[3d] onAddToCart:', err);
    }
    if (disposed) return;
    addBtn.classList.add('is-done');
    addBtn.innerHTML = `${ICON.check}<span>${T.added}</span>`;
    clearTimeout(addTimer);
    addTimer = setTimeout(() => !disposed && syncVariantUI(), 1800);
  }

  /* ----- troca de produto (embutido, ex.: editor do painel) ----- */
  async function setProduct(p, ctx = {}) {
    if (disposed) return ready;
    product = p || {};
    variants = Array.isArray(product.variants) ? product.variants.filter((v) => v && v.id) : [];
    if ('category' in ctx) category = ctx.category;
    if ('parentCategory' in ctx) parentCategory = ctx.parentCategory;
    variantId = pickVariantId(ctx.variantId ?? variantId);
    if (!stage) return ready;
    await loadModel();
    return report();
  }

  /* ----- descarte ----- */
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    clearTimeout(hintTimer);
    clearTimeout(toastTimer);
    clearTimeout(addTimer);
    cleanups.splice(0).forEach((fn) => fn());
    if (ar.mv) ar.mv.remove();
    if (ar.url) URL.revokeObjectURL(ar.url);
    ar.mv = null;
    if (stage) {
      const { renderer, scene } = stage;
      controls?.removeEventListener('change', invalidate);
      controls?.removeEventListener('start', onInteract);
      // libera na GPU tudo o que passou pela cena (os objetos em cache continuam válidos e voltam a subir se usados de novo)
      const geos = new Set();
      const mats = new Set();
      const texs = new Set();
      const collect = (obj) =>
        obj.traverse((m) => {
          if (m.geometry) geos.add(m.geometry);
          const list = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
          for (const mat of list) {
            mats.add(mat);
            for (const key of Object.keys(mat)) if (mat[key]?.isTexture) texs.add(mat[key]);
          }
        });
      collect(scene);
      shown.forEach(collect);
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      scene.traverse((m) => m.isLight && m.dispose?.()); // mapas de sombra
      stage.setModel(null);
      try {
        stage.dispose();
      } catch (err) {
        console.warn('[3d] dispose:', err);
      }
      memory = { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
      try {
        renderer.forceContextLoss();
      } catch {
        /* contexto já perdido */
      }
      stage = null;
      controls = null;
    }
    shown.clear();
    resolveReady({ error: 'fechado' });
    if (!sheetMode) root.remove();
  }

  function info() {
    const r = stage?.renderer;
    return {
      disposed,
      source,
      kind: spec?.kind || null,
      variantId,
      dims: dimsOn,
      autoRotate: !!controls?.autoRotate,
      rendering: !!raf,
      size: { ...size },
      insets: { ...insets },
      memory: r ? { ...r.info.memory, programs: r.info.programs?.length ?? 0 } : memory,
      contextLost: gl ? gl.isContextLost() : null,
    };
  }

  syncVariantUI();
  if (dimsOn) setDims(true, { silent: true });

  return {
    root,
    start,
    ready,
    dispose,
    info,
    setVariant: (id) => setVariant(id),
    setProduct,
    setView: (v) => setView(v),
    showDims: (on = true) => setDims(on),
    get report() {
      return report();
    },
    // usado pelos testes
    debug: { prepareAR, drawDims: () => drawDims() },
  };
}

/* ---------- Janela da vitrine ---------- */
let current = null;
let clearTimer = 0;

export function open3D({ product, category, parentCategory, variantId, onVariant, onAddToCart, onClose } = {}) {
  const el = document.getElementById('viewer3d-sheet');
  if (!el) throw new Error('#viewer3d-sheet não encontrado');
  if (!product) throw new Error('open3D: produto ausente');
  clearTimeout(clearTimer);
  if (current) {
    const old = current;
    current = null;
    old.dispose();
  }
  el.classList.add('sheet--3d');
  const v = createViewer(el, { mode: 'sheet', product, category, parentCategory, variantId, onVariant, onAddToCart });
  current = v;
  openSheet('viewer3d-sheet', {
    onClose: () => {
      v.dispose();
      if (current === v) {
        current = null;
        // limpa a marcação depois da animação de saída
        clearTimer = setTimeout(() => {
          if (!current && el.firstElementChild === v.root) el.innerHTML = '';
        }, 300);
      }
      try {
        onClose?.();
      } catch (err) {
        console.warn('[3d] onClose:', err);
      }
    },
  });
  v.start();
  return {
    ready: v.ready,
    setVariant: v.setVariant,
    info: v.info,
    close: () => {
      if (current === v && el.classList.contains('is-open')) closeSheet();
    },
    debug: v.debug,
  };
}

/* ---------- Canvas embutível ---------- */
export function mount3D(container, { product, category, parentCategory, variantId, interactive = true, autoRotate = true, toolbar = false, dims = false, view } = {}) {
  if (!container) throw new Error('mount3D: container ausente');
  const v = createViewer(container, { mode: 'embed', product: product || {}, category, parentCategory, variantId, interactive, autoRotate, toolbar, dims, view });
  v.start();
  return {
    ready: v.ready,
    setVariant: v.setVariant,
    setProduct: v.setProduct,
    setView: v.setView,
    showDims: v.showDims,
    info: v.info,
    dispose: v.dispose,
  };
}
