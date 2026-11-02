// "Monte seu ambiente": planejador 3D com os produtos da loja (casa de bonecas com paredes recortadas).
//   openRoom({ host, store, products, categories, addProductId, onAddToCart, onClose }) -> instância
//   closeRoom() fecha o ambiente aberto (se houver).
// Instância: { close(), add(productId, variantId?) -> Promise<uid|null>, items(), setView('3d'|'plan'), el }
// - Um único WebGLRenderer, renderização sob demanda e descarte completo no close().
// - O 3D de cada produto vem do gerador automático (inferSpec + buildModel) ou do .glb da equipe.
// - O layout fica salvo por loja em localStorage (atual:room:<storeId>).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as kit from './kit.js';
import { inferSpec, kindLabel } from './infer.js';
import { buildModel, loadModelUrl } from './models/index.js';
import { esc, brl, picture, norm } from '../lib.js';
import { displayPrice, hasPix, installments } from '../state.js';

/* ================================================================== */
/* Constantes                                                          */
/* ================================================================== */
const T = 0.12; // espessura das paredes (m)
const CAP = 0.012; // faixa escura no topo da parede (corte)
const STUB_H = 0.09; // altura da parede recortada (lado da câmera)
const BASE_H = 0.08; // rodapé
const GRID = 0.05; // encaixe na grade (5 cm)
const SNAP = 0.1; // distância para encostar na parede
const MAX_ITEMS = 40;
const DOOR_W = 0.82;
const DOOR_H = 2.1;
const SUPPORT_MAX_H = 1.3; // móveis até esta altura recebem TV/eletroportátil em cima
const HALF_PI = Math.PI / 2;
const LIMITS = { w: [1.5, 12], d: [1.5, 12], h: [2.2, 4] };
const DEFAULT_ROOM = { w: 4, d: 3.5, h: 2.6 };

const PRESETS = {
  sala: {
    label: 'Sala de estar',
    floor: 'wood',
    floorColor: '#b5875b',
    wall: '#eeeae3',
    sill: 0.95,
    kinds: ['sofa', 'armchair', 'coffee_table', 'side_table', 'rack', 'tv', 'shelf', 'pouf'],
  },
  quarto: {
    label: 'Quarto',
    floor: 'wood',
    floorColor: '#a97d55',
    wall: '#e7e9e4',
    sill: 0.95,
    kinds: ['bed', 'mattress', 'nightstand', 'dresser', 'wardrobe', 'crib', 'bunk_bed', 'desk', 'armchair', 'tv'],
  },
  cozinha: {
    label: 'Cozinha',
    floor: 'tile',
    floorColor: '#dedbd5',
    wall: '#f2f1ee',
    sill: 1.1,
    kinds: ['fridge', 'stove', 'washer', 'microwave', 'kitchen_cabinet', 'small_appliance', 'dining_table', 'chair', 'stool'],
  },
  jantar: {
    label: 'Sala de jantar',
    floor: 'wood',
    floorColor: '#9d6f49',
    wall: '#ece3d6',
    sill: 0.95,
    kinds: ['dining_table', 'chair', 'stool', 'shelf', 'rack', 'dresser', 'side_table', 'armchair'],
  },
};

// Filtros do catálogo (por tipo de modelo 3D)
const GROUPS = [
  { id: 'estofados', label: 'Sofás e poltronas', kinds: ['sofa', 'armchair', 'pouf'] },
  { id: 'mesas', label: 'Mesas e cadeiras', kinds: ['coffee_table', 'side_table', 'dining_table', 'desk', 'chair', 'stool'] },
  { id: 'quarto', label: 'Quarto', kinds: ['bed', 'bunk_bed', 'crib', 'mattress', 'nightstand', 'dresser', 'wardrobe'] },
  { id: 'armarios', label: 'Racks e armários', kinds: ['rack', 'shelf', 'kitchen_cabinet'] },
  { id: 'eletro', label: 'Eletro', kinds: ['tv', 'fridge', 'washer', 'stove', 'microwave', 'small_appliance'] },
  { id: 'outros', label: 'Outros', kinds: ['generic'] },
];
const groupOf = (spec) => GROUPS.find((g) => g.kinds.includes(spec.kind))?.id || 'outros';

// Papel de cada tipo no ambiente
const TOP_KINDS = new Set(['tv', 'small_appliance', 'microwave']); // preferem ficar sobre um móvel
const CENTER_KINDS = new Set(['coffee_table', 'dining_table', 'side_table', 'pouf', 'chair', 'stool']);
const SURFACE_KINDS = new Set(['rack', 'dresser', 'nightstand', 'side_table', 'coffee_table', 'dining_table', 'desk', 'kitchen_cabinet', 'shelf']);

function eligible(spec) {
  if (!spec || spec.kind === 'none' || spec.kind === 'air_conditioner') return false;
  const s = spec.style || {};
  if (spec.kind === 'generic' && (s.textile || ['mirror', 'frame', 'bracket'].includes(s.decor))) return false;
  return true;
}
function roleOf(spec) {
  const s = spec.style || {};
  if (spec.kind === 'generic' && s.decor === 'rug') return 'rug';
  if (TOP_KINDS.has(spec.kind) || (spec.kind === 'generic' && (s.decor === 'lamp' || s.decor === 'vase'))) return 'top';
  if (CENTER_KINDS.has(spec.kind) || (spec.kind === 'generic' && s.family === 'table')) return 'center';
  return 'wall';
}
const isSurface = (it) =>
  it.role !== 'top' &&
  it.role !== 'rug' &&
  it.size.h <= SUPPORT_MAX_H &&
  (SURFACE_KINDS.has(it.spec.kind) || (it.spec.kind === 'generic' && ['table', 'storage', 'furniture'].includes(it.spec.style?.family)));

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const dec = (v, min = 1, max = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
const parseDec = (s) => Number(String(s).trim().replace(/\s|m$/gi, '').replace(',', '.'));
const cmOf = (m) => Math.round(m * 100);
const r4 = (v) => Math.round(v * 10000) / 10000 || 0;
const newUid = () => Math.random().toString(36).slice(2, 10);
const lowerFirst = (s) => (/^[A-ZÀ-Ý]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
function normAngle(a) {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  const q = Math.round(r / (Math.PI / 12)) * (Math.PI / 12); // tira resíduos de ponto flutuante
  return Math.abs(r - q) < 1e-6 ? q : r;
}
// Meias medidas da caixa alinhada aos eixos de um retângulo girado
function extents(rot, w, d) {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return [c * (w / 2) + s * (d / 2), s * (w / 2) + c * (d / 2)];
}
// Retângulo orientado no piso (x, z)
function obb(x, z, rot, w, d) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x, z, hw: w / 2, hd: d / 2, ux: [c, -s], uz: [s, c] };
}
// Teste de separação (SAT) entre dois retângulos; pad > 0 exige folga, pad < 0 tolera encostar
function sat(a, b, pad = 0) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ax, az] of [a.ux, a.uz, b.ux, b.uz]) {
    const ra = a.hw * Math.abs(a.ux[0] * ax + a.ux[1] * az) + a.hd * Math.abs(a.uz[0] * ax + a.uz[1] * az);
    const rb = b.hw * Math.abs(b.ux[0] * ax + b.ux[1] * az) + b.hd * Math.abs(b.uz[0] * ax + b.uz[1] * az);
    if (Math.abs(dx * ax + dz * az) >= ra + rb + pad) return false;
  }
  return true;
}
// Ponto local (lx, lz) de um item -> mundo
function toWorld(it, lx, lz) {
  const c = Math.cos(it.rot);
  const s = Math.sin(it.rot);
  return [it.x + lx * c + lz * s, it.z - lx * s + lz * c];
}
function pointIn(it, x, z) {
  const dx = x - it.x;
  const dz = z - it.z;
  const c = Math.cos(it.rot);
  const s = Math.sin(it.rot);
  return Math.abs(dx * c - dz * s) <= it.size.w / 2 + 1e-3 && Math.abs(dx * s + dz * c) <= it.size.d / 2 + 1e-3;
}
// 0, +step, -step, 2*step... até lim (inclui as pontas)
function sweep(lim, step) {
  const out = [0];
  for (let t = step; t < lim - 1e-6; t += step) out.push(t, -t);
  if (lim > 1e-6) out.push(lim, -lim);
  return out;
}
// O navegador abre WebGL 2 (three.js r170)? Testado uma vez por página.
let gl2Ok = null;
function hasWebGL2() {
  if (gl2Ok !== null) return gl2Ok;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    gl2Ok = !!gl;
  } catch {
    gl2Ok = false;
  }
  return gl2Ok;
}
const readJSON = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível (aba anônima) */
  }
};
function sanitizeRoom(r) {
  const out = { ...DEFAULT_ROOM };
  if (r && typeof r === 'object') for (const k of ['w', 'd', 'h']) if (Number.isFinite(Number(r[k]))) out[k] = clamp(Number(r[k]), ...LIMITS[k]);
  return out;
}

/* ================================================================== */
/* Texturas do piso (geradas uma vez por página)                       */
/* ================================================================== */
const CANVAS = {};
const linMean = (canvas) => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, 64, 32);
  const d = g.getImageData(0, 0, 64, 32).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += Math.pow((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, 2.2);
  return s / (d.length / 4);
};
// Assoalho de tábuas: 2,4 m x 1,2 m por repetição, tábuas de 15 cm x 1,2 m com emendas desencontradas.
// Usa a textura de veio de carvalho do kit (mesma escala: 1 px ≈ 1,2 mm).
function plankCanvas() {
  if (CANVAS.wood) return CANVAS.wood;
  const src = kit.mat.wood('#ffffff', { grain: 'oak' }).map.image;
  const W = 2048;
  const H = 1024;
  const rows = 8;
  const rh = H / rows;
  const bl = W / 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = kit.rng('piso-tabuas');
  const sw = src.width;
  const sh = src.height;
  const board = (x, y, b) => {
    g.save();
    g.beginPath();
    g.rect(x, y, bl, rh);
    g.clip();
    if (b.flip) {
      g.translate(x + bl, y);
      g.scale(-1, 1);
      g.drawImage(src, 0, b.sv, sw, sh / 2, 0, 0, bl, rh);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else g.drawImage(src, 0, b.sv, sw, sh / 2, x, y, bl, rh);
    g.fillStyle = b.tone < 0 ? `rgba(46,28,12,${-b.tone})` : `rgba(255,248,236,${b.tone})`;
    g.fillRect(x, y, bl, rh);
    g.restore();
  };
  const pick = () => ({ sv: Math.floor(r() * (sh / 2)), flip: r() < 0.5, tone: r.range(-0.12, 0.09) });
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    const s = Math.round(r.range(0.12, 0.88) * bl);
    const A = pick();
    const B = pick();
    board(s, y, A);
    board(s - bl, y, B);
    board(s + bl, y, B);
    // juntas: longitudinal (topo da fileira) e de topo (fim das tábuas)
    g.fillStyle = 'rgba(28,16,6,0.6)';
    g.fillRect(0, y, W, 2);
    for (const x of [s - bl, s, s + bl]) if (x > 0 && x < W) g.fillRect(x - 1, y, 2, rh);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(0, y + 2, W, 1);
  }
  CANVAS.wood = { canvas: c, mean: linMean(c), tile: [2.4, 1.2] };
  return CANVAS.wood;
}
// Porcelanato 60 x 60 cm com rejunte: 1,2 m x 1,2 m por repetição
function tileCanvas() {
  if (CANVAS.tile) return CANVAS.tile;
  const S = 1024;
  const n = 2;
  const ts = S / n;
  const gw = 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  const r = kit.rng('piso-porcelanato');
  const tone = Array.from({ length: n * n }, () => r.range(-0.025, 0.025));
  // manchas suaves (baixa frequência) para não ficar chapado
  const blobs = Array.from({ length: 18 }, () => ({ x: r() * S, y: r() * S, rad: r.range(60, 220), a: r.range(-0.03, 0.03) }));
  for (let j = 0, k = 0; j < S; j++) {
    for (let i = 0; i < S; i++, k += 4) {
      const gi = i % ts;
      const gj = j % ts;
      let v;
      if (gi < gw || gi >= ts - gw || gj < gw || gj >= ts - gw) v = 0.66;
      else {
        v = 0.93 + tone[Math.floor(j / ts) * n + Math.floor(i / ts)];
        const h = ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) % 1000;
        v += (h / 1000 - 0.5) * 0.025;
        for (const b of blobs) {
          let dx = Math.abs(i - b.x);
          let dy = Math.abs(j - b.y);
          dx = Math.min(dx, S - dx);
          dy = Math.min(dy, S - dy);
          const q = (dx * dx + dy * dy) / (b.rad * b.rad);
          if (q < 1) v += b.a * (1 - q);
        }
        if (gi === gw || gj === gw) v += 0.03; // bisel claro
      }
      const vv = Math.round(clamp(v, 0, 1) * 255);
      d[k] = d[k + 1] = d[k + 2] = vv;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  CANVAS.tile = { canvas: c, mean: linMean(c), tile: [1.2, 1.2] };
  return CANVAS.tile;
}
function skyCanvas() {
  if (CANVAS.sky) return CANVAS.sky;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#a9cbe8');
  gr.addColorStop(0.62, '#e4eff8');
  gr.addColorStop(0.63, '#cfdcc6');
  gr.addColorStop(1, '#b9cbb0');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 128);
  CANVAS.sky = c;
  return c;
}

/* ================================================================== */
/* Ícones (SVG inline, independentes do sprite da página)              */
/* ================================================================== */
const svgI = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
const ST = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const I = {
  close: svgI(`<path d="M6 6l12 12M18 6 6 18" ${ST}/>`),
  rotL: svgI(`<path d="M4.8 13.5A7.5 7.5 0 1 0 6.6 6.9" ${ST}/><path d="M4.5 3.8v4.4h4.4" ${ST}/>`),
  rotR: svgI(`<path d="M19.2 13.5A7.5 7.5 0 1 1 17.4 6.9" ${ST}/><path d="M19.5 3.8v4.4h-4.4" ${ST}/>`),
  rotate: svgI(`<path d="M19 12a7 7 0 1 1-2.05-4.95" ${ST}/><path d="M19.2 4.2v4h-4" ${ST}/>`),
  dup: svgI(`<rect x="8.5" y="8.5" width="11" height="11" rx="2" ${ST}/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" ${ST}/>`),
  trash: svgI(`<path d="M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.8 12.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.6M10 10.5v6M14 10.5v6" ${ST}/>`),
  cube: svgI(`<path d="M12 3.2 4.2 7.6v8.8L12 20.8l7.8-4.4V7.6z M4.2 7.6 12 12l7.8-4.4 M12 12v8.8" ${ST}/>`),
  plan: svgI(`<path d="M4 4h16v16H4z M4 13h6.5v7 M14 4v6.5h6" ${ST}/>`),
  ruler: svgI(`<path d="M3.6 15.6 15.6 3.6l4.8 4.8-12 12z M7.2 12l1.9 1.9 M10 9.2l1.9 1.9 M12.8 6.4l1.9 1.9" ${ST}/>`),
  search: svgI(`<circle cx="10.5" cy="10.5" r="6.3" ${ST}/><path d="m15.4 15.4 4.6 4.6" ${ST}/>`),
  cart: svgI(`<path d="M2.5 3.5h2.4l2.5 11.1a1.4 1.4 0 0 0 1.4 1.1h8.9a1.4 1.4 0 0 0 1.4-1.1l1.7-7.4H5.9" ${ST}/><circle cx="9.4" cy="19.6" r="1.3" fill="currentColor"/><circle cx="17.1" cy="19.6" r="1.3" fill="currentColor"/><path d="M13 8.3v4.6M10.7 10.6h4.6" ${ST}/>`),
  plus: svgI(`<path d="M12 5v14M5 12h14" ${ST}/>`),
  minus: svgI(`<path d="M5 12h14" ${ST}/>`),
  warn: svgI(`<path d="M12 3.8 2.8 19.8h18.4z" ${ST}/><path d="M12 10v4.6" ${ST}/><circle cx="12" cy="17.2" r="1" fill="currentColor"/>`),
};

/* ================================================================== */
/* API pública                                                         */
/* ================================================================== */
let current = null;

export function openRoom(options = {}) {
  if (current) current.close();
  current = createRoom(options);
  return current;
}

export function closeRoom() {
  if (current) current.close();
}

/* ================================================================== */
/* Ambiente                                                            */
/* ================================================================== */
function createRoom({ host, store = null, products = [], categories = [], addProductId = null, onAddToCart = null, onClose = null } = {}) {
  host = host || document.querySelector('[data-room]');
  if (!host) throw new Error('openRoom: elemento host não encontrado');
  let alive = true;
  const storeId = String(store?.id || store?.slug || 'loja');
  const KEY = `atual:room:${storeId}`;
  const catById = Object.fromEntries((categories || []).map((c) => [c.id, c]));
  const ctxFor = (p, variant) => {
    const category = catById[p.category_id] || null;
    const parentCategory = category?.parent_id ? catById[category.parent_id] || null : null;
    return { category, parentCategory, variant };
  };
  const kindName = (spec, p) => {
    if (spec.kind !== 'generic') return kindLabel(spec.kind);
    return catById[p?.category_id]?.name || String(p?.name || 'Produto').split(/\s+/).slice(0, 2).join(' ');
  };
  const photoOf = (p, v) => v?.image_url || p?.images?.[0]?.url || p?.image_url || '';
  const variantOf = (p, vid) => (vid ? (p.variants || []).find((v) => v.id === vid) || null : null);
  const defaultVariant = (p) => {
    const vs = (p.variants || []).filter(Boolean);
    return vs.find((v) => v.in_stock !== false) || vs[0] || null;
  };
  const unitPrice = (it) => num(variantOf(it.p, it.variant)?.price ?? it.p.price, 0);

  // Catálogo: produtos da loja que fazem sentido no piso (spec padrão de cada um)
  const entries = [];
  for (const p of products || []) {
    let spec = null;
    try {
      spec = inferSpec(p, ctxFor(p));
    } catch {
      spec = null;
    }
    if (!eligible(spec)) continue;
    const kn = kindName(spec, p);
    entries.push({ p, spec, kn, group: groupOf(spec), search: norm([p.name, p.brand, p.sku, catById[p.category_id]?.name, kn].filter(Boolean).join(' ')) });
  }
  const entryById = Object.fromEntries(entries.map((e) => [e.p.id, e]));

  const saved = readJSON(KEY);
  const st = {
    preset: PRESETS[saved?.preset] ? saved.preset : 'sala',
    room: sanitizeRoom(saved?.room),
    view: '3d',
    tab: 'shop',
    filter: 'all',
    q: '',
  };
  const items = [];
  let sel = null;
  let pairs = [];

  /* ---------- Marcação ---------- */
  const coarse = matchMedia('(pointer: coarse)').matches;
  const presetOptions = Object.entries(PRESETS)
    .map(([id, p]) => `<option value="${id}"${id === st.preset ? ' selected' : ''}>${esc(p.label)}</option>`)
    .join('');
  const dimField = (k, label) => `
      <div class="rm-dimf">
        <label class="rm-dimf__label" for="rm-dim-${k}">${label}</label>
        <div class="rm-stepper">
          <button type="button" class="rm-stepper__btn" data-rm-step="${k}" data-delta="-0.1" aria-label="Diminuir ${label.toLowerCase()}">${I.minus}</button>
          <input class="rm-stepper__input" id="rm-dim-${k}" data-rm-dim="${k}" inputmode="decimal" autocomplete="off" spellcheck="false">
          <span class="rm-stepper__unit" aria-hidden="true">m</span>
          <button type="button" class="rm-stepper__btn" data-rm-step="${k}" data-delta="0.1" aria-label="Aumentar ${label.toLowerCase()}">${I.plus}</button>
        </div>
      </div>`;
  host.classList.add('room3d');
  host.innerHTML = `
  <div class="rm" data-rm>
    <div class="rm-top">
      <div class="rm-head">
        <div class="rm-head__text">
          <h1 class="rm-title" id="room3d-title" tabindex="-1">Monte seu ambiente</h1>
          <p class="rm-sub">${store?.name ? `Com os produtos da ${esc(store.name)}` : 'Com os produtos da loja'}</p>
        </div>
        <button class="rm-iconbtn rm-close" type="button" data-rm-close aria-label="Fechar o ambiente">${I.close}</button>
      </div>
      <div class="rm-tools">
        <label class="rm-select">
          <span class="visually-hidden">Tipo de ambiente</span>
          <select data-rm-preset>${presetOptions}</select>
        </label>
        <div class="rm-sizewrap">
          <button class="rm-pill" type="button" data-rm-size-btn aria-expanded="false" aria-controls="rm-size-pop">${I.ruler}<span data-rm-size-label></span></button>
          <div class="rm-pop" id="rm-size-pop" data-rm-size role="group" aria-label="Medidas do ambiente" hidden>
            <p class="rm-pop__title">Medidas do ambiente</p>
            ${dimField('w', 'Largura')}
            ${dimField('d', 'Profundidade')}
            ${dimField('h', 'Pé-direito')}
            <p class="rm-pop__area" data-rm-area></p>
          </div>
        </div>
        <div class="rm-seg" role="group" aria-label="Visualização">
          <button type="button" data-rm-view="3d" aria-pressed="true">${I.cube}<span>3D</span></button>
          <button type="button" data-rm-view="plan" aria-pressed="false">${I.plan}<span>Planta</span></button>
        </div>
      </div>
    </div>

    <aside class="rm-cat" aria-label="Produtos para o ambiente">
      <div class="rm-tabs" role="tablist" aria-label="Lista">
        <button type="button" role="tab" id="rm-tab-shop" aria-controls="rm-pane-shop" aria-selected="true" data-rm-tab="shop">Produtos</button>
        <button type="button" role="tab" id="rm-tab-placed" aria-controls="rm-pane-placed" aria-selected="false" tabindex="-1" data-rm-tab="placed">No ambiente <span class="rm-tabs__count" data-rm-count>0</span></button>
      </div>
      <div class="rm-pane" id="rm-pane-shop" role="tabpanel" aria-labelledby="rm-tab-shop">
        <div class="rm-search">
          ${I.search}
          <input type="search" data-rm-q placeholder="Buscar produto" aria-label="Buscar produto" autocomplete="off">
        </div>
        <div class="rm-chips" data-rm-chips role="group" aria-label="Filtrar por tipo"></div>
        <ul class="rm-list" data-rm-list></ul>
      </div>
      <div class="rm-pane" id="rm-pane-placed" role="tabpanel" aria-labelledby="rm-tab-placed" hidden>
        <ul class="rm-placed" data-rm-placed></ul>
        <button type="button" class="rm-btn rm-btn--ghost rm-clear" data-rm-clear hidden>${I.trash}<span>Limpar ambiente</span></button>
      </div>
    </aside>

    <div class="rm-stage" data-rm-stage tabindex="0" role="group" aria-roledescription="ambiente 3D" aria-label="Ambiente" aria-describedby="rm-keys">
      <canvas class="rm-canvas" data-rm-canvas aria-hidden="true"></canvas>
      <svg class="rm-svg" data-rm-svg aria-hidden="true"></svg>
      <button type="button" class="rm-rot" data-rm-rot hidden aria-label="Girar o item (arraste para girar livremente)" title="Arraste para girar">${I.rotate}</button>
      <div class="rm-flash">
        <div class="rm-alert" data-rm-alert role="status" aria-live="polite" hidden></div>
        <div class="rm-note" data-rm-note role="status" aria-live="polite" hidden></div>
      </div>
      <div class="rm-empty" data-rm-empty hidden>
        <div class="rm-empty__card">
          <span class="rm-empty__icon">${I.cube}</span>
          <h2 class="rm-empty__title">Seu ambiente está vazio</h2>
          <p class="rm-empty__text">${coarse ? 'Toque em um produto da lista para colocá-lo aqui.' : 'Clique em um produto da lista para colocá-lo aqui.'} Depois arraste para mover e use os botões para girar.</p>
        </div>
      </div>
      <div class="rm-sel" data-rm-sel hidden></div>
      <p class="rm-hint" data-rm-hint></p>
      <p class="visually-hidden" id="rm-keys">Com um item selecionado: setas movem 5 cm, R gira, D duplica e Delete remove.</p>
      <div class="rm-loading" data-rm-loading><span class="rm-spinner" aria-hidden="true"></span>Montando o ambiente…</div>
    </div>

    <div class="rm-foot">
      <div class="rm-total">
        <span class="rm-total__label" data-rm-total-label>Nenhum item</span>
        <strong class="rm-total__value" data-rm-total>${brl(0)}</strong>
        <span class="rm-total__alt" data-rm-total-alt></span>
      </div>
      <button type="button" class="rm-btn rm-btn--primary rm-buy" data-rm-buy disabled>${I.cart}<span data-rm-buy-label>Adicionar tudo ao carrinho</span></button>
    </div>
  </div>`;

  const q$ = (s) => host.querySelector(s);
  const root = q$('[data-rm]');
  const stageEl = q$('[data-rm-stage]');
  const canvas = q$('[data-rm-canvas]');
  const svg = q$('[data-rm-svg]');
  const rotBtn = q$('[data-rm-rot]');
  const alertEl = q$('[data-rm-alert]');
  const noteEl = q$('[data-rm-note]');
  const emptyEl = q$('[data-rm-empty]');
  const selEl = q$('[data-rm-sel]');
  const hintEl = q$('[data-rm-hint]');
  const loadingEl = q$('[data-rm-loading]');
  const listEl = q$('[data-rm-list]');
  const chipsEl = q$('[data-rm-chips]');
  const placedEl = q$('[data-rm-placed]');
  const sizePop = q$('[data-rm-size]');
  const sizeBtn = q$('[data-rm-size-btn]');
  const buyBtn = q$('[data-rm-buy]');
  const clearBtn = q$('[data-rm-clear]');

  // Altura da seção: tela inteira menos o cabeçalho fixo do site
  function syncOffset() {
    const hd = document.querySelector('[data-header]');
    const pos = hd ? getComputedStyle(hd).position : '';
    const off = hd && (pos === 'sticky' || pos === 'fixed') ? Math.round(hd.getBoundingClientRect().height) : 0;
    host.style.setProperty('--room-offset', `${off}px`);
  }
  syncOffset();

  /* ================================================================ */
  /* Cena                                                              */
  /* ================================================================ */
  let renderer = null;
  let scene = null;
  let cam3 = null;
  let camP = null;
  let controls = null;
  let sun = null;
  let envRT = null;
  let roomG = null;
  let itemsG = null;
  let walls = [];
  let zones = { door: obb(0, 0, 0, 0, 0), win: obb(0, 0, 0, 0, 0), sill: 1 };
  let cw = 1;
  let ch = 1;
  let ready = false;
  let failed = false;
  const M = {}; // materiais do ambiente (descartados no close)
  const tex = {}; // texturas do ambiente
  let unitBox = null;
  let resolveReady;
  const readyP = new Promise((r) => (resolveReady = r));

  const cam = () => (st.view === 'plan' ? camP : cam3);

  // Sem WebGL: cartão com o aviso e o caminho de volta; a lista de produtos fica desativada
  function failNoGL() {
    failed = true;
    root.classList.add('is-failed');
    loadingEl.classList.add('is-error');
    loadingEl.setAttribute('role', 'alert');
    loadingEl.innerHTML = `<div class="rm-fail">
        <span class="rm-fail__icon">${I.warn}</span>
        <h2 class="rm-fail__title">Não foi possível abrir o 3D</h2>
        <p class="rm-fail__text">Este navegador não conseguiu mostrar o ambiente em 3D. Tente atualizar a página ou abrir em outro navegador.</p>
        <button type="button" class="rm-btn rm-btn--ghost" data-rm-close>Voltar</button>
      </div>`;
    emptyEl.hidden = true;
    renderList();
    resolveReady();
  }

  function initScene() {
    if (!alive) return;
    // testa antes de criar o renderer: assim o three.js não enche o console de erros
    if (!hasWebGL2()) return failNoGL();
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.warn('[ambiente] WebGL indisponível', err);
      return failNoGL();
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // a sombra só muda quando o ambiente muda (não ao girar a câmera)

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9e6e1');
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.62;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc2, 0.4));
    sun = new THREE.DirectionalLight(0xfff4e6, 1.55);
    sun.castShadow = true;
    // seção ainda escondida (0 x 0): usa o tamanho da janela para escolher a resolução da sombra
    const small = Math.min(stageEl.clientWidth || innerWidth, stageEl.clientHeight || innerHeight) < 600;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xeef3ff, 0.32);
    fill.position.set(-6, 4, 2);
    scene.add(fill);

    // materiais próprios
    M.slab = new THREE.MeshStandardMaterial({ color: 0xcfc8bf, roughness: 0.95 });
    M.gridMinor = new THREE.LineBasicMaterial({ color: 0x2b2116, transparent: true, opacity: 0.07, depthWrite: false });
    M.gridMajor = new THREE.LineBasicMaterial({ color: 0x2b2116, transparent: true, opacity: 0.15, depthWrite: false });
    M.arc = new THREE.LineDashedMaterial({ color: 0x3b3530, dashSize: 0.06, gapSize: 0.045, transparent: true, opacity: 0.4, depthWrite: false });
    M.ph = new THREE.MeshStandardMaterial({ color: 0xbdb7ae, roughness: 0.8, transparent: true, opacity: 0.55 });
    M.edgeSel = new THREE.LineBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.5, depthWrite: false });
    M.edgeBad = new THREE.LineBasicMaterial({ color: 0xe01b26, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    const frameMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
    M.frameSel = frameMat(0x1d1d1f, 0.9);
    M.frameBad = frameMat(0xe01b26, 0.95);
    M.frameSoft = frameMat(0xd38a12, 0.95);
    M.framePlan = frameMat(0x57504a, 0.55);
    tex.sky = new THREE.CanvasTexture(skyCanvas());
    tex.sky.colorSpace = THREE.SRGBColorSpace;
    M.sky = new THREE.MeshBasicMaterial({ map: tex.sky });
    M.floor = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0);

    cam3 = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    camP = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    itemsG = new THREE.Group();
    itemsG.name = 'itens';
    scene.add(itemsG);

    measureStage();
    buildRoom();
    // eventos de ponteiro antes dos controles (para desligar a órbita ao arrastar um item)
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', onLost);
    controls = new OrbitControls(cam3, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    controls.zoomSpeed = 0.9;
    // toque: um dedo move o item (não gira), dois dedos giram e aproximam
    controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.addEventListener('change', onControls);
    controls.addEventListener('start', onControlsStart);
    fit3D();
    fitPlan();

    ready = true;
    restore();
    loadingEl.hidden = true;
    resolveReady();
    if (addProductId) {
      const existing = items.find((x) => x.pid === addProductId);
      if (existing) {
        select(existing);
        note('Este produto já está no seu ambiente.');
      } else if (entryById[addProductId]) add(addProductId);
      else note('Este produto não tem 3D para o ambiente.');
    }
    changed();
    invalidate();
    try {
      kit.warmup(['linen', 'velvet', 'leather', 'smooth', 'brushed', 'peel', 'cotton', 'mattress']);
    } catch {
      /* opcional */
    }
  }

  function measureStage() {
    const r = stageEl.getBoundingClientRect();
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    if (!renderer) return;
    renderer.setSize(cw, ch, false);
    cam3.aspect = cw / ch;
    cam3.updateProjectionMatrix();
  }

  /* ---------- Piso, paredes, porta e janela ---------- */
  function floorMaterial(W, D) {
    const pr = PRESETS[st.preset];
    const type = pr.floor;
    if (!tex[type]) {
      const src = type === 'tile' ? tileCanvas() : plankCanvas();
      const t = new THREE.CanvasTexture(src.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      t.userData = { mean: src.mean, tile: src.tile };
      tex[type] = t;
    }
    const t = tex[type];
    t.repeat.set(W / t.userData.tile[0], D / t.userData.tile[1]);
    const c = kit.colorOf(pr.floorColor);
    const k = Math.min(1.6, 1 / (t.userData.mean || 1));
    c.setRGB(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k));
    M.floor.map = t;
    M.floor.color.copy(c);
    M.floor.roughness = type === 'tile' ? 0.32 : 0.52;
    M.floor.needsUpdate = true;
    return M.floor;
  }

  // Retângulos sólidos de uma parede descontando as aberturas (coordenadas locais: x ao longo, y para cima)
  function segments(len, h, openings) {
    const out = [];
    let cur = 0;
    for (const o of [...openings].sort((a, b) => a.a - b.a)) {
      if (o.a > cur + 1e-4) out.push([cur, o.a, 0, h]);
      if (o.y0 > 1e-4) out.push([o.a, o.b, 0, Math.min(o.y0, h)]);
      if (o.y1 < h - 1e-4) out.push([o.a, o.b, o.y1, h]);
      cur = Math.max(cur, o.b);
    }
    if (cur < len - 1e-4) out.push([cur, len, 0, h]);
    return out.filter(([x0, x1, y0, y1]) => x1 - x0 > 1e-4 && y1 - y0 > 1e-4);
  }
  function subtract([a, b], cuts) {
    let parts = [[a, b]];
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [p0, p1] of parts) {
        if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
        else {
          if (c0 > p0) next.push([p0, c0]);
          if (c1 < p1) next.push([c1, p1]);
        }
      }
      parts = next;
    }
    return parts.filter(([p0, p1]) => p1 - p0 > 1e-3);
  }
  // Caixa em coordenadas locais (limites), sem projetar sombra
  function slab(group, x0, x1, y0, y1, z0, z1, material, { shadow = false } = {}) {
    const m = kit.box(x1 - x0, y1 - y0, z1 - z0, material);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  function buildRoom() {
    if (roomG) {
      disposeTree(roomG);
      scene.remove(roomG);
    }
    roomG = new THREE.Group();
    roomG.name = 'ambiente';
    const { w: W, d: D, h: H } = st.room;
    const pr = PRESETS[st.preset];
    const wallMat = kit.mat.paint(pr.wall, { gloss: 0.06 });
    const trimMat = kit.mat.paint('#f7f6f2', { gloss: 0.35 });
    const capMat = kit.mat.flat('#4f4a45', { roughness: 0.9 });

    // base (laje) e piso
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * T + 0.04, 0.1, D + 2 * T + 0.04), M.slab);
    base.position.y = -0.0505;
    base.receiveShadow = true;
    roomG.add(base);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMaterial(W, D));
    floor.rotation.x = -HALF_PI;
    floor.receiveShadow = true;
    floor.name = 'piso';
    roomG.add(floor);
    roomG.add(gridLines(W, D));

    // aberturas: janela na parede do fundo, porta na parede esquerda (perto da frente)
    const ww = clamp(W * 0.32, 0.8, 1.6);
    const wcx = clamp(W * 0.14, -W / 2 + ww / 2 + 0.3, W / 2 - ww / 2 - 0.3);
    const sill = Math.min(pr.sill, H - 1.2);
    const wtop = Math.min(2.15, H - 0.3);
    const zc = D / 2 - 0.15 - DOOR_W / 2;
    zones = {
      door: obb(-W / 2 + DOOR_W / 2, zc, 0, DOOR_W, DOOR_W),
      win: obb(wcx, -D / 2 + 0.08, 0, ww, 0.16),
      sill,
    };
    const win = { a: wcx + W / 2 + T - ww / 2, b: wcx + W / 2 + T + ww / 2, y0: sill, y1: wtop };
    const doorL = D / 2 - zc;
    const door = { a: doorL - DOOR_W / 2, b: doorL + DOOR_W / 2, y0: 0, y1: DOOR_H };
    const defs = [
      { id: 'back', len: W + 2 * T, pos: [-W / 2 - T, -D / 2], rot: 0, inner: [T, T + W], openings: [win], n: [0, 1], p: [0, -D / 2] },
      { id: 'front', len: W + 2 * T, pos: [W / 2 + T, D / 2], rot: Math.PI, inner: [T, T + W], openings: [], n: [0, -1], p: [0, D / 2] },
      { id: 'left', len: D, pos: [-W / 2, D / 2], rot: HALF_PI, inner: [0, D], openings: [door], n: [1, 0], p: [-W / 2, 0] },
      { id: 'right', len: D, pos: [W / 2, -D / 2], rot: -HALF_PI, inner: [0, D], openings: [], n: [-1, 0], p: [W / 2, 0] },
    ];
    walls = defs.map((def) => {
      const g = new THREE.Group();
      g.name = `parede:${def.id}`;
      g.position.set(def.pos[0], 0, def.pos[1]);
      g.rotation.y = def.rot;
      const full = new THREE.Group();
      const stub = new THREE.Group();
      for (const [x0, x1, y0, y1] of segments(def.len, H - CAP, def.openings)) slab(full, x0, x1, y0, y1, -T, 0, wallMat);
      slab(full, 0, def.len, H - CAP, H, -T, 0, capMat);
      const doors = def.openings.filter((o) => o.y0 < 1e-4);
      for (const [x0, x1] of subtract([0, def.len], doors.map((o) => [o.a, o.b]))) {
        slab(stub, x0, x1, 0, STUB_H - CAP, -T, 0, wallMat);
        slab(stub, x0, x1, STUB_H - CAP, STUB_H, -T, 0, capMat);
      }
      // rodapé (interrompido na porta)
      for (const [a, b] of subtract(def.inner, doors.map((o) => [o.a - 0.07, o.b + 0.07]))) slab(full, a, b, 0, BASE_H, 0, 0.012, trimMat);
      if (def.id === 'back') addWindow(full, win);
      if (def.id === 'left') addDoor(full, door, trimMat);
      stub.visible = false;
      g.add(full, stub);
      roomG.add(g);
      return { id: def.id, g, full, stub, n: def.n, p: def.p, cut: false };
    });
    roomG.add(doorArc(-W / 2, zc + DOOR_W / 2));

    // sol: alto, vindo da frente/direita (sombras curtas para o fundo/esquerda)
    const R = Math.max(W, D) / 2 + 0.9;
    sun.position.set(R * 0.8, R * 2.6 + 2.2, R * 1.25);
    sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -R * 1.25;
    sc.right = sc.top = R * 1.25;
    sc.near = 0.3;
    sc.far = R * 9 + 8;
    sc.updateProjectionMatrix();
    scene.add(roomG);
    shadowsDirty();
  }

  function addWindow(group, o) {
    const frame = kit.mat.paint('#f5f5f2', { gloss: 0.45 });
    const ft = 0.05;
    const z0 = -T / 2 - 0.03;
    const z1 = -T / 2 + 0.03;
    slab(group, o.a, o.a + ft, o.y0, o.y1, z0, z1, frame);
    slab(group, o.b - ft, o.b, o.y0, o.y1, z0, z1, frame);
    slab(group, o.a + ft, o.b - ft, o.y1 - ft, o.y1, z0, z1, frame);
    slab(group, o.a + ft, o.b - ft, o.y0, o.y0 + ft, z0, z1, frame);
    const mid = (o.a + o.b) / 2;
    if (o.b - o.a > 0.9) slab(group, mid - 0.02, mid + 0.02, o.y0 + ft, o.y1 - ft, z0, z1, frame);
    const glass = slab(group, o.a + ft, o.b - ft, o.y0 + ft, o.y1 - ft, -T / 2 - 0.003, -T / 2 + 0.003, kit.mat.glass({ tint: '#dbe7ea', opacity: 0.18 }));
    glass.receiveShadow = false;
    // peitoril de mármore por dentro e por fora
    slab(group, o.a - 0.05, o.b + 0.05, o.y0 - 0.025, o.y0, -T - 0.02, 0.035, kit.mat.marble('#ece8e1'));
    // vista lá fora (céu e jardim): painel logo atrás da parede, menor que ela para não aparecer por cima
    const H = st.room.h;
    const y0 = Math.max(0.05, o.y0 - 0.6);
    const y1 = Math.min(H - 0.15, o.y1 + 0.3);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(o.b - o.a + 0.8, y1 - y0), M.sky);
    sky.position.set(mid, (y0 + y1) / 2, -T - 0.05);
    group.add(sky);
  }

  function addDoor(group, o, trimMat) {
    const cas = 0.07;
    // guarnição (lado de dentro) e forro do vão
    slab(group, o.a - cas, o.a, 0, o.y1 + cas, 0, 0.015, trimMat);
    slab(group, o.b, o.b + cas, 0, o.y1 + cas, 0, 0.015, trimMat);
    slab(group, o.a - cas, o.b + cas, o.y1, o.y1 + cas, 0, 0.015, trimMat);
    slab(group, o.a, o.a + 0.015, 0, o.y1, -T, 0, trimMat);
    slab(group, o.b - 0.015, o.b, 0, o.y1, -T, 0, trimMat);
    slab(group, o.a, o.b, o.y1 - 0.015, o.y1, -T, 0, trimMat);
    // folha de madeira fechada e maçaneta
    const leafZ = -T / 2;
    slab(group, o.a + 0.018, o.b - 0.018, 0.008, o.y1 - 0.018, leafZ - 0.0175, leafZ + 0.0175, kit.mat.wood('#b48a5f', { grain: 'smooth' }), { shadow: false });
    const metal = kit.mat.metal('#c4c6c8', { finish: 'brushed' });
    const hx = o.b - 0.075;
    for (const side of [1, -1]) {
      const zf = leafZ + side * 0.0175;
      const rose = kit.cylinder(0.026, 0.026, 0.01, metal, { seg: 24 });
      rose.rotation.x = HALF_PI;
      rose.position.set(hx, 1.02, zf + side * 0.005);
      const neck = kit.cylinder(0.008, 0.008, 0.045, metal, { seg: 12 });
      neck.rotation.x = HALF_PI;
      neck.position.set(hx, 1.02, zf + side * 0.0225);
      const lever = kit.box(0.12, 0.017, 0.017, metal, { r: 0.006 });
      lever.position.set(hx - 0.05, 1.02, zf + side * 0.045);
      group.add(rose, neck, lever);
    }
  }

  function doorArc(hx, hz) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * HALF_PI;
      pts.push(new THREE.Vector3(hx + Math.sin(a) * DOOR_W, 0.002, hz - Math.cos(a) * DOOR_W));
    }
    pts.push(new THREE.Vector3(hx, 0.002, hz));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, M.arc);
    line.computeLineDistances();
    line.renderOrder = 2;
    line.name = 'arco-da-porta';
    return line;
  }

  function gridLines(W, D) {
    const minor = [];
    const major = [];
    const y = 0.0015;
    for (let k = 1; k * 0.5 < W - 1e-6; k++) {
      const x = -W / 2 + k * 0.5;
      (k % 2 ? minor : major).push(x, y, -D / 2, x, y, D / 2);
    }
    for (let k = 1; k * 0.5 < D - 1e-6; k++) {
      const z = -D / 2 + k * 0.5;
      (k % 2 ? minor : major).push(-W / 2, y, z, W / 2, y, z);
    }
    const g = new THREE.Group();
    g.name = 'grade';
    for (const [arr, mat] of [
      [minor, M.gridMinor],
      [major, M.gridMajor],
    ]) {
      if (!arr.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(geo, mat);
      l.renderOrder = 1;
      g.add(l);
    }
    return g;
  }

  // Descarta só geometrias criadas aqui (modelos do cache e materiais do kit são compartilhados)
  function disposeTree(obj) {
    obj.traverse((o) => {
      if ((o.isMesh || o.isLine) && o.geometry && o.geometry !== unitBox) o.geometry.dispose();
    });
  }

  /* ---------- Câmeras ---------- */
  function defaultDir() {
    const az = THREE.MathUtils.degToRad(32);
    const el = THREE.MathUtils.degToRad(38);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  let fitDist = 6;
  function fit3D(dirIn) {
    const { w: W, d: D, h: H } = st.room;
    const dir = (dirIn || defaultDir()).clone().normalize();
    const c = new THREE.Vector3(0, H * 0.26, 0);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(cam3.fov) / 2) / 1.05;
    const th = tv * cam3.aspect;
    let dist = 0;
    // inclui a régua do piso, que fica do lado de fora das paredes
    const mx = W / 2 + T + 0.3;
    const mz = D / 2 + T + 0.3;
    for (const x of [-mx, mx]) {
      for (const z of [-mz, mz]) {
        // paredes do lado da câmera ficam recortadas: conta só a altura baixa
        const top = x * dir.x + z * dir.z > 0 ? STUB_H : H;
        for (const y of [0, top]) {
          const p = new THREE.Vector3(x, y, z).sub(c);
          const depth = p.dot(dir);
          dist = Math.max(dist, depth + Math.abs(p.dot(right)) / th, depth + Math.abs(p.dot(up)) / tv);
        }
      }
    }
    fitDist = dist;
    cam3.position.copy(c).addScaledVector(dir, dist);
    cam3.lookAt(c);
    controls.target.copy(c);
    controls.minDistance = 1;
    controls.maxDistance = Math.max(6, dist * 2.2);
    cam3.near = 0.05;
    cam3.far = dist * 6 + 20;
    cam3.updateProjectionMatrix();
    controls.update();
  }
  // Planta: enquadra o ambiente (com espaço para as cotas) na área livre entre o aviso e o cartão do item
  function fitPlan() {
    const { w: W, d: D } = st.room;
    const hw = W / 2 + T + 0.45;
    const hd = D / 2 + T + 0.45;
    const topI = 54; // espaço para o aviso de colisão no topo não cobrir a cota da largura
    const botI = !selEl.hidden ? Math.min(ch * 0.4, selEl.offsetHeight + 16) : !hintEl.hidden ? 36 : 10;
    const avail = Math.max(80, ch - topI - botI);
    const k = Math.min(cw / (2 * hw), avail / (2 * hd)); // pixels por metro
    const top = (topI + avail / 2) / k;
    camP.left = -cw / (2 * k);
    camP.right = cw / (2 * k);
    camP.top = top;
    camP.bottom = top - ch / k;
    camP.position.set(0, 25, 0);
    camP.up.set(0, 0, -1);
    camP.lookAt(0, 0, 0);
    camP.near = 0.1;
    camP.far = 60;
    camP.updateProjectionMatrix();
  }
  // até a pessoa girar/aproximar, a câmera se reenquadra quando o palco muda de tamanho
  let userMoved = false;
  function onControlsStart() {
    userMoved = true;
  }
  function onControls() {
    // mantém o alvo dentro do ambiente ao arrastar com o botão direito
    const t = controls.target;
    const { w: W, d: D, h: H } = st.room;
    t.x = clamp(t.x, -W / 2, W / 2);
    t.z = clamp(t.z, -D / 2, D / 2);
    t.y = clamp(t.y, 0, H * 0.8);
    invalidate();
  }

  /* ---------- Renderização sob demanda ---------- */
  let raf = 0;
  let frames = 0;
  let lastMs = 0;
  const shadowsDirty = () => {
    if (renderer) renderer.shadowMap.needsUpdate = true;
  };
  function invalidate() {
    if (!raf && alive && ready) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!alive || !renderer) return;
    frames++;
    if (st.view === '3d') controls.update();
    updateCut();
    const t0 = performance.now();
    renderer.render(scene, cam());
    lastMs = Math.round((performance.now() - t0) * 10) / 10;
    drawOverlay();
  }
  function updateCut() {
    const c = cam3.position;
    for (const w of walls) {
      const cut = st.view === '3d' && (c.x - w.p[0]) * w.n[0] + (c.z - w.p[1]) * w.n[1] < 0;
      w.cut = cut;
      w.full.visible = !cut;
      w.stub.visible = cut;
    }
  }

  /* ================================================================ */
  /* Itens                                                             */
  /* ================================================================ */
  const obbOf = (it) => obb(it.x, it.z, it.rot, it.size.w, it.size.d);
  const extOf = (it) => extents(it.rot, it.size.w, it.size.d);
  const vOverlap = (a, b) => a.y < b.y + b.size.h - 0.005 && b.y < a.y + a.size.h - 0.005;

  function createItem(pid, { variant = null, x = 0, z = 0, rot = 0 } = {}) {
    const e = entryById[pid];
    if (!e) return null;
    const p = e.p;
    const v = variantOf(p, variant) || defaultVariant(p);
    const spec = inferSpec(p, ctxFor(p, v || undefined)) || e.spec;
    const it = {
      uid: newUid(),
      pid,
      p,
      e,
      variant: v?.id || null,
      spec,
      role: roleOf(spec),
      x: num(x),
      z: num(z),
      rot: normAngle(num(rot)),
      y: 0,
      on: null,
      size: { w: spec.w / 100, h: spec.h / 100, d: spec.d / 100 },
      obj: new THREE.Group(),
      body: new THREE.Group(),
      frame: null,
      edges: null,
      hard: [],
      soft: [],
      ver: 0,
      loaded: false,
    };
    it.obj.name = `item:${p.sku || pid}`;
    it.obj.userData.uid = it.uid;
    it.obj.add(it.body);
    const ph = new THREE.Mesh(unitBox, M.ph);
    ph.scale.set(it.size.w, it.size.h, it.size.d);
    ph.castShadow = true;
    it.body.add(ph);
    refreshHelpers(it);
    itemsG.add(it.obj);
    items.push(it);
    apply(it);
    loadModel(it);
    return it;
  }

  const urlCache = new Map();
  async function loadModel(it) {
    const ver = ++it.ver;
    const spec = it.spec;
    let res = null;
    const url = it.p.model_url;
    if (url && /^https:\/\//i.test(url)) {
      const key = `${url}|${spec.w}|${spec.h}|${spec.d}`;
      try {
        if (!urlCache.has(key)) urlCache.set(key, loadModelUrl(url, spec));
        const r = await urlCache.get(key);
        res = { ...r, group: r.group.clone(true) };
      } catch (err) {
        urlCache.delete(key);
        console.warn('[ambiente] .glb indisponível, usando o 3D automático', err);
      }
    }
    if (!res) {
      try {
        res = await buildModel(spec);
      } catch (err) {
        console.warn('[ambiente] não foi possível gerar o 3D', err);
        return;
      }
    }
    if (!alive || it.ver !== ver || !items.includes(it)) return;
    it.body.clear();
    it.body.add(res.group);
    shadowsDirty();
    it.size = { w: Math.max(0.02, res.size.w / 100), h: Math.max(0.01, res.size.h / 100), d: Math.max(0.02, res.size.d / 100) };
    it.loaded = true;
    refreshHelpers(it);
    settleAll();
    updateIssues();
    if (sel === it) renderSel();
    invalidate();
  }

  // Contorno no piso e caixa de arestas (seleção / colisão)
  function refreshHelpers(it) {
    for (const h of [it.frame, it.edges]) {
      if (h) {
        it.obj.remove(h);
        h.geometry.dispose();
      }
    }
    const { w, h, d } = it.size;
    const lw = 0.022;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - lw, -d / 2 - lw);
    shape.lineTo(w / 2 + lw, -d / 2 - lw);
    shape.lineTo(w / 2 + lw, d / 2 + lw);
    shape.lineTo(-w / 2 - lw, d / 2 + lw);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2, -d / 2);
    hole.lineTo(-w / 2, d / 2);
    hole.lineTo(w / 2, d / 2);
    hole.lineTo(w / 2, -d / 2);
    hole.closePath();
    shape.holes.push(hole);
    const fg = new THREE.ShapeGeometry(shape);
    fg.rotateX(-HALF_PI); // plano XY -> piso, face para cima
    it.frame = new THREE.Mesh(fg, M.framePlan);
    it.frame.position.y = 0.004;
    it.frame.renderOrder = 3;
    it.frame.visible = false;
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.02, h + 0.01, d + 0.02));
    eg.translate(0, (h + 0.01) / 2, 0);
    it.edges = new THREE.LineSegments(eg, M.edgeSel);
    it.edges.renderOrder = 4;
    it.edges.visible = false;
    it.obj.add(it.frame, it.edges);
    paintHelpers(it);
  }
  function paintHelpers(it) {
    if (!it.frame) return;
    const hard = it.hard.length > 0;
    const soft = it.soft.length > 0;
    const selected = it === sel;
    const plan = st.view === 'plan';
    it.edges.visible = hard || (selected && !plan);
    it.edges.material = hard ? M.edgeBad : M.edgeSel;
    it.frame.visible = hard || selected || plan || soft;
    it.frame.material = hard ? M.frameBad : selected ? M.frameSel : soft ? M.frameSoft : M.framePlan;
  }

  function apply(it) {
    it.obj.position.set(it.x, it.y, it.z);
    it.obj.rotation.y = it.rot;
    shadowsDirty();
  }

  // TV/eletroportátil sobem no móvel que estiver embaixo do centro
  function supportAt(it, x, z) {
    let best = null;
    for (const s of items) {
      if (s === it || !isSurface(s) || !pointIn(s, x, z)) continue;
      if (!best || s.size.h > best.size.h) best = s;
    }
    return best;
  }
  function settle(it) {
    if (it.role !== 'top') {
      it.y = 0;
      it.on = null;
      return;
    }
    const s = supportAt(it, it.x, it.z);
    it.on = s ? s.uid : null;
    it.y = s ? s.y + s.size.h : 0;
  }
  function settleAll() {
    for (const it of items) {
      if (it.role === 'top') {
        settle(it);
        apply(it);
      }
    }
  }
  const kidsOf = (it) => items.filter((o) => o.on === it.uid);

  // Encaixe: grade de 5 cm, encosta nas paredes e não sai do ambiente
  function constrain(it, x, z, snap) {
    const { w: W, d: D } = st.room;
    const [ex, ez] = extOf(it);
    let nx = x;
    let nz = z;
    if (snap) {
      nx = Math.round(nx / GRID) * GRID;
      nz = Math.round(nz / GRID) * GRID;
      const onTop = it.role === 'top' && supportAt(it, nx, nz);
      if (!onTop) {
        if (Math.abs(nx - ex + W / 2) < SNAP) nx = -W / 2 + ex;
        if (Math.abs(nx + ex - W / 2) < SNAP) nx = W / 2 - ex;
        if (Math.abs(nz - ez + D / 2) < SNAP) nz = -D / 2 + ez;
        if (Math.abs(nz + ez - D / 2) < SNAP) nz = D / 2 - ez;
      }
    }
    nx = ex * 2 > W ? 0 : clamp(nx, -W / 2 + ex, W / 2 - ex);
    nz = ez * 2 > D ? 0 : clamp(nz, -D / 2 + ez, D / 2 - ez);
    return [r4(nx), r4(nz)];
  }

  function moveTo(it, x, z, { snap = true, commit = true } = {}) {
    const kids = kidsOf(it);
    const [nx, nz] = constrain(it, x, z, snap);
    const dx = nx - it.x;
    const dz = nz - it.z;
    it.x = nx;
    it.z = nz;
    settle(it);
    apply(it);
    for (const k of kids) {
      [k.x, k.z] = constrain(k, k.x + dx, k.z + dz, false);
      settle(k);
      apply(k);
    }
    updateIssues();
    invalidate();
    if (commit) save();
  }

  function rotateTo(it, rot, { commit = true } = {}) {
    const r = normAngle(rot);
    const delta = r - it.rot;
    if (Math.abs(delta) < 1e-9) return;
    const kids = kidsOf(it);
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    for (const k of kids) {
      const ox = k.x - it.x;
      const oz = k.z - it.z;
      k.x = it.x + ox * c + oz * s;
      k.z = it.z - ox * s + oz * c;
      k.rot = normAngle(k.rot + delta);
    }
    it.rot = r;
    for (const k of kids) {
      k.x = r4(k.x);
      k.z = r4(k.z);
    }
    const [nx, nz] = constrain(it, it.x, it.z, false);
    for (const k of kids) {
      k.x += nx - it.x;
      k.z += nz - it.z;
    }
    it.x = nx;
    it.z = nz;
    settle(it);
    apply(it);
    for (const k of kids) {
      settle(k);
      apply(k);
    }
    updateIssues();
    invalidate();
    if (commit) {
      save();
      if (sel === it) renderSel();
    }
  }
  // Gira até o próximo múltiplo de 90° (dir = +1 anti-horário, -1 horário, visto de cima)
  function rotateStep(it, dir) {
    const q = it.rot / HALF_PI;
    const next = dir > 0 ? Math.floor(q + 1e-6) + 1 : Math.ceil(q - 1e-6) - 1;
    rotateTo(it, next * HALF_PI);
  }

  /* ---------- Onde colocar um item novo ---------- */
  function freeAt(it, x, z, rot, { pad = 0.04, y = 0, ignore = null } = {}) {
    const { w: W, d: D } = st.room;
    const [ex, ez] = extents(rot, it.size.w, it.size.d);
    const tol = 1e-3;
    if (x - ex < -W / 2 - tol || x + ex > W / 2 + tol || z - ez < -D / 2 - tol || z + ez > D / 2 + tol) return false;
    const box = obb(x, z, rot, it.size.w, it.size.d);
    const probe = { y, size: it.size };
    for (const o of items) {
      if (o === it || o === ignore || o.role === 'rug' || it.role === 'rug') continue;
      if (vOverlap(probe, o) && sat(box, obbOf(o), pad)) return false;
    }
    if (it.role !== 'rug' && y < 0.05 && sat(box, zones.door, 0.02)) return false;
    if (y + it.size.h > zones.sill + 0.02 && sat(box, zones.win, 0)) return false;
    return true;
  }
  function spotWall(it) {
    const { w: W, d: D } = st.room;
    const hw = it.size.w / 2;
    const hd = it.size.d / 2;
    const list = [
      { rot: 0, len: W, at: (t) => [t, -D / 2 + hd] },
      { rot: HALF_PI, len: D, at: (t) => [-W / 2 + hd, -t] },
      { rot: -HALF_PI, len: D, at: (t) => [W / 2 - hd, t] },
      { rot: Math.PI, len: W, at: (t) => [-t, D / 2 - hd] },
    ];
    for (const wl of list) {
      const lim = wl.len / 2 - hw;
      if (lim < -1e-3) continue;
      for (const t of sweep(Math.max(0, lim), 0.05)) {
        const [x, z] = wl.at(t);
        if (freeAt(it, x, z, wl.rot)) return { x, z, rot: wl.rot };
      }
    }
    return null;
  }
  function spotCenter(it) {
    const { w: W, d: D } = st.room;
    const max = Math.max(W, D) / 2;
    for (let r = 0; r <= max + 1e-6; r += 0.1) {
      const pts = [];
      if (r < 1e-6) pts.push([0, 0]);
      else {
        for (let t = -r; t <= r + 1e-6; t += 0.1) pts.push([t, -r], [t, r], [-r, t], [r, t]);
        pts.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
      }
      for (const [x, z] of pts) if (freeAt(it, x, z, 0, { pad: 0.12 })) return { x, z, rot: 0 };
    }
    return null;
  }
  // Cadeiras em volta da mesa de jantar (ou na frente da escrivaninha)
  function spotAround(it) {
    for (const t of items) {
      const k = t.spec.kind;
      if (k !== 'dining_table' && k !== 'desk') continue;
      const tw = t.size.w;
      const td = t.size.d;
      const cw2 = it.size.w;
      const cd = it.size.d;
      const gap = 0.04;
      const slots = [];
      const n = Math.max(1, Math.floor((tw + 0.04) / (cw2 + 0.14)));
      const xs = Array.from({ length: n }, (_, i) => -tw / 2 + (tw / n) * (i + 0.5));
      for (const x of xs) slots.push([x, td / 2 + cd / 2 + gap, Math.PI]);
      if (k === 'dining_table') {
        for (const x of xs) slots.push([x, -td / 2 - cd / 2 - gap, 0]);
        if (td >= cw2 + 0.1) slots.push([-tw / 2 - cd / 2 - gap, 0, HALF_PI], [tw / 2 + cd / 2 + gap, 0, -HALF_PI]);
      }
      for (const [lx, lz, lr] of slots) {
        const [x, z] = toWorld(t, lx, lz);
        const rot = normAngle(t.rot + lr);
        if (freeAt(it, x, z, rot, { pad: 0.02 })) return { x, z, rot };
      }
    }
    return null;
  }
  // Criado-mudo ao lado da cabeceira
  function spotBesideBed(it) {
    for (const b of items) {
      if (b.spec.kind !== 'bed' && b.spec.kind !== 'bunk_bed') continue;
      for (const sx of [1, -1]) {
        const [x, z] = toWorld(b, sx * (b.size.w / 2 + it.size.w / 2 + 0.03), -b.size.d / 2 + it.size.d / 2);
        if (freeAt(it, x, z, b.rot, { pad: 0.02 })) return { x, z, rot: b.rot };
      }
    }
    return null;
  }
  function spotOnSupport(it) {
    const pref =
      it.spec.kind === 'tv'
        ? ['rack', 'dresser', 'side_table', 'nightstand', 'kitchen_cabinet', 'coffee_table', 'desk', 'generic']
        : ['kitchen_cabinet', 'dining_table', 'side_table', 'desk', 'nightstand', 'dresser', 'rack', 'coffee_table', 'generic'];
    const rank = (s) => {
      const i = pref.indexOf(s.spec.kind);
      return i < 0 ? 99 : i;
    };
    // a TV pode passar um pouco das laterais do móvel (a base dela é mais estreita que a tela)
    const sups = items.filter((s) => s !== it && isSurface(s) && it.size.w <= s.size.w * 1.12 + 0.08).sort((a, b) => rank(a) - rank(b));
    for (const s of sups) {
      const lim = Math.max(0, (s.size.w - it.size.w) / 2);
      for (const t of sweep(lim, 0.05)) {
        const [x, z] = toWorld(s, t, 0);
        if (freeAt(it, x, z, s.rot, { pad: 0.01, y: s.y + s.size.h, ignore: s })) return { x, z, rot: s.rot };
      }
    }
    return null;
  }
  function findSpot(it) {
    const k = it.spec.kind;
    let s = null;
    if (it.role === 'top' && it.size.h < 0.9) s = spotOnSupport(it);
    if (!s && (k === 'chair' || k === 'stool')) s = spotAround(it);
    if (!s && k === 'nightstand') s = spotBesideBed(it);
    if (!s && it.role === 'rug') s = { x: 0, z: 0, rot: 0 };
    if (!s) s = it.role === 'center' || (it.role === 'top' && k !== 'tv') ? spotCenter(it) || spotWall(it) : spotWall(it) || spotCenter(it);
    if (!s) {
      s = { x: 0, z: 0, rot: 0 };
      note('Não sobrou espaço livre. Arraste os itens para reorganizar.');
    }
    it.x = s.x;
    it.z = s.z;
    it.rot = normAngle(s.rot);
    [it.x, it.z] = constrain(it, it.x, it.z, false);
    settle(it);
    apply(it);
  }

  /* ---------- Ações ---------- */
  function add(pid, variantId = null) {
    if (!ready || failed) return null;
    if (!entryById[pid]) {
      note('Este produto não tem 3D para o ambiente.');
      return null;
    }
    if (items.length >= MAX_ITEMS) {
      note(`O ambiente aceita até ${MAX_ITEMS} itens.`);
      return null;
    }
    const it = createItem(pid, { variant: variantId });
    findSpot(it);
    select(it);
    changed();
    return it;
  }
  function duplicate(src) {
    if (items.length >= MAX_ITEMS) {
      note(`O ambiente aceita até ${MAX_ITEMS} itens.`);
      return;
    }
    const it = createItem(src.pid, { variant: src.variant, rot: src.rot });
    if (!it) return;
    it.size = { ...src.size };
    refreshHelpers(it);
    let spot = null;
    if (src.role !== 'top') {
      const gx = src.size.w + 0.06;
      const gz = src.size.d + 0.06;
      for (const [lx, lz] of [
        [gx, 0],
        [-gx, 0],
        [0, gz],
        [0, -gz],
      ]) {
        const [x, z] = toWorld(src, lx, lz);
        if (freeAt(it, x, z, src.rot, { pad: 0.02 })) {
          spot = { x, z };
          break;
        }
      }
    }
    if (spot) {
      it.x = spot.x;
      it.z = spot.z;
      it.rot = src.rot;
      settle(it);
      apply(it);
    } else findSpot(it);
    select(it);
    changed();
  }
  function remove(it) {
    const i = items.indexOf(it);
    if (i < 0) return;
    items.splice(i, 1);
    it.ver++;
    itemsG.remove(it.obj);
    shadowsDirty();
    for (const h of [it.frame, it.edges]) h?.geometry.dispose();
    for (const k of items) {
      if (k.on === it.uid) {
        settle(k);
        apply(k);
      }
    }
    if (sel === it) select(null);
    changed();
  }
  function clearAll() {
    for (const it of [...items]) {
      it.ver++;
      itemsG.remove(it.obj);
      for (const h of [it.frame, it.edges]) h?.geometry.dispose();
    }
    items.length = 0;
    shadowsDirty();
    select(null);
    changed();
  }
  function setVariant(it, vid) {
    if (it.variant === vid) return;
    const v = variantOf(it.p, vid);
    if (!v) return;
    it.variant = v.id;
    it.spec = inferSpec(it.p, ctxFor(it.p, v)) || it.spec;
    loadModel(it);
    renderSel();
    renderPlaced();
    renderTotals();
    save();
  }

  // Depois de qualquer mudança na lista de itens
  function changed() {
    updateIssues();
    renderList();
    renderPlaced();
    renderTotals();
    emptyEl.hidden = items.length > 0 || failed;
    save();
    invalidate();
  }

  /* ---------- Colisões e avisos ---------- */
  const nameOf = (it) => kindName(it.spec, it.p);
  function updateIssues() {
    const { w: W, d: D, h: H } = st.room;
    pairs = [];
    for (const it of items) {
      it.hard = [];
      it.soft = [];
    }
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.role === 'rug') continue;
      const oa = obbOf(a);
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.role === 'rug' || a.on === b.uid || b.on === a.uid || !vOverlap(a, b)) continue;
        if (sat(oa, obbOf(b), -0.01)) {
          a.hard.push('overlap');
          b.hard.push('overlap');
          pairs.push([a, b]);
        }
      }
    }
    for (const it of items) {
      const [ex, ez] = extOf(it);
      const tol = 0.005;
      if (it.x - ex < -W / 2 - tol || it.x + ex > W / 2 + tol || it.z - ez < -D / 2 - tol || it.z + ez > D / 2 + tol) it.hard.push('outside');
      if (it.y + it.size.h > H + 0.005) it.hard.push('tall');
      const o = obbOf(it);
      if (it.role !== 'rug' && it.y < 0.05 && sat(o, zones.door, -0.01)) it.soft.push('door');
      if (it.y + it.size.h > zones.sill + 0.02 && sat(o, zones.win, -0.005)) it.soft.push('window');
    }
    for (const it of items) paintHelpers(it);
    renderAlert();
    renderPlacedFlags();
  }
  function renderAlert() {
    let msg = '';
    let kind = 'bad';
    const find = (flag, list = 'hard') => items.find((it) => it[list].includes(flag));
    if (pairs.length) {
      const [a, b] = pairs[0];
      msg = `${nameOf(a)} e ${lowerFirst(nameOf(b))} estão se sobrepondo`;
      if (pairs.length > 1) msg += ` (e mais ${pairs.length - 1})`;
    } else if (find('outside')) {
      const it = find('outside');
      const [ex, ez] = extOf(it);
      msg = ex * 2 > st.room.w + 0.005 || ez * 2 > st.room.d + 0.005 ? `${nameOf(it)} não cabe neste ambiente` : `${nameOf(it)} está fora do ambiente`;
    } else if (find('tall')) {
      msg = `${nameOf(find('tall'))} é mais alto que o pé-direito`;
    } else if (find('door', 'soft')) {
      msg = `${nameOf(find('door', 'soft'))} está na frente da porta`;
      kind = 'soft';
    } else if (find('window', 'soft')) {
      msg = `${nameOf(find('window', 'soft'))} tampa a janela`;
      kind = 'soft';
    }
    if (!msg) {
      alertEl.hidden = true;
      alertEl.textContent = '';
      return;
    }
    const html = `${I.warn}<span>${esc(msg)}</span>`;
    if (alertEl.innerHTML !== html) alertEl.innerHTML = html;
    alertEl.className = `rm-alert rm-alert--${kind}`;
    alertEl.hidden = false;
  }
  let noteT = 0;
  function note(msg) {
    noteEl.textContent = msg;
    noteEl.hidden = false;
    clearTimeout(noteT);
    noteT = setTimeout(() => (noteEl.hidden = true), 2800);
  }

  /* ================================================================ */
  /* Interface                                                         */
  /* ================================================================ */
  const dimsTxt = (w, d) => `${Math.round(w)} × ${Math.round(d)} cm`;
  const priceTxt = (v) => `${brl(displayPrice(v))}${hasPix() ? ' <small>no PIX</small>' : ''}`;

  function renderChips() {
    const counts = {};
    for (const e of entries) counts[e.group] = (counts[e.group] || 0) + 1;
    const chips = [{ id: 'all', label: 'Todos' }, ...GROUPS.filter((g) => counts[g.id])];
    if (!chips.some((c) => c.id === st.filter)) st.filter = 'all';
    chipsEl.innerHTML = chips
      .map((c) => `<button type="button" class="rm-chip" data-rm-chip="${c.id}" aria-pressed="${c.id === st.filter}">${esc(c.label)}</button>`)
      .join('');
  }
  function renderList() {
    const terms = norm(st.q).split(/\s+/).filter(Boolean);
    const pr = PRESETS[st.preset];
    const rank = (e) => {
      const i = pr.kinds.indexOf(e.spec.kind);
      return i < 0 ? 50 : i;
    };
    const list = entries
      .filter((e) => (st.filter === 'all' || e.group === st.filter) && terms.every((t) => e.search.includes(t)))
      .sort((a, b) => rank(a) - rank(b) || String(a.p.name).localeCompare(String(b.p.name), 'pt-BR'));
    const count = {};
    for (const it of items) count[it.pid] = (count[it.pid] || 0) + 1;
    listEl.innerHTML = list.length
      ? list
          .map((e) => {
            const n = count[e.p.id] || 0;
            return `<li class="rm-list__item"><button type="button" class="rm-prod" data-rm-add="${esc(e.p.id)}"${failed ? ' disabled' : ''}>
            <span class="rm-prod__img">${picture(photoOf(e.p), { alt: '' })}</span>
            <span class="rm-prod__info">
              <span class="rm-prod__name"><span class="visually-hidden">Colocar no ambiente: </span>${esc(e.p.name)}</span>
              <span class="rm-prod__meta">${esc(e.kn)} · ${dimsTxt(e.spec.w, e.spec.d)}</span>
              <span class="rm-prod__price">${priceTxt(e.p.price)}</span>
            </span>
            <span class="rm-prod__plus" aria-hidden="true">${I.plus}</span>
            ${n ? `<span class="rm-prod__count">${n}<span class="visually-hidden"> no ambiente</span></span>` : ''}
          </button></li>`;
          })
          .join('')
      : `<li class="rm-list__empty">${entries.length ? 'Nenhum produto encontrado.' : 'Esta loja ainda não tem produtos para montar o ambiente.'}</li>`;
  }
  function renderPlaced() {
    q$('[data-rm-count]').textContent = String(items.length);
    clearBtn.hidden = !items.length;
    placedEl.innerHTML = items.length
      ? items
          .map((it) => {
            const v = variantOf(it.p, it.variant);
            return `<li class="rm-placed__item${it === sel ? ' is-sel' : ''}" data-uid="${it.uid}">
            <button type="button" class="rm-placed__main" data-rm-select="${it.uid}" aria-pressed="${it === sel}">
              <span class="rm-placed__img">${picture(photoOf(it.p, v), { alt: '' })}</span>
              <span class="rm-placed__info">
                <span class="rm-placed__name">${esc(it.p.name)}</span>
                <span class="rm-placed__meta">${v ? `${esc(v.name)} · ` : ''}${priceTxt(unitPrice(it))}</span>
              </span>
              <span class="rm-placed__flag" data-flag hidden>${I.warn}<span class="visually-hidden">com aviso</span></span>
            </button>
            <button type="button" class="rm-iconbtn" data-rm-remove="${it.uid}" aria-label="Remover ${esc(it.p.name)}">${I.trash}</button>
          </li>`;
          })
          .join('')
      : '<li class="rm-list__empty">Nenhum item no ambiente ainda.</li>';
    renderPlacedFlags();
  }
  function renderPlacedFlags() {
    for (const it of items) {
      const li = placedEl.querySelector(`[data-uid="${it.uid}"]`);
      const f = li?.querySelector('[data-flag]');
      if (f) {
        f.hidden = !(it.hard.length || it.soft.length);
        f.classList.toggle('is-soft', !it.hard.length);
      }
    }
  }
  function renderTotals() {
    const full = items.reduce((s, it) => s + unitPrice(it), 0);
    const pix = items.reduce((s, it) => s + displayPrice(unitPrice(it)), 0);
    q$('[data-rm-total-label]').textContent = items.length ? `${items.length} ${items.length === 1 ? 'item' : 'itens'}${hasPix() ? ' · total no PIX' : ' · total'}` : 'Nenhum item';
    q$('[data-rm-total]').textContent = brl(pix);
    let alt = '';
    if (items.length) {
      const inst = installments(full);
      if (hasPix() && Math.abs(full - pix) > 0.004) alt = inst.n > 1 ? `ou ${brl(full)} em até ${inst.n}x de ${brl(inst.value)}` : `ou ${brl(full)} em outras formas`;
      else if (inst.n > 1) alt = `em até ${inst.n}x de ${brl(inst.value)}`;
    }
    q$('[data-rm-total-alt]').textContent = alt;
    buyBtn.disabled = !items.length;
  }

  function renderSel() {
    const focused = selEl.contains(document.activeElement) ? document.activeElement : null;
    const wasHidden = selEl.hidden;
    if (!sel) {
      selEl.hidden = true;
      selEl.innerHTML = '';
      rotBtn.hidden = true;
      hintEl.hidden = false;
      if (focused) stageEl.focus({ preventScroll: true });
      if (!wasHidden && st.view === 'plan') fitPlan();
      return;
    }
    const it = sel;
    const v = variantOf(it.p, it.variant);
    const vs = (it.p.variants || []).filter(Boolean);
    const sw = vs.length > 1
      ? `<div class="rm-swatches" role="group" aria-label="Cor">${vs
          .map(
            (x) =>
              `<button type="button" class="rm-swatch" data-rm-variant="${esc(x.id)}" aria-pressed="${x.id === it.variant}" aria-label="${esc(x.name)}${x.in_stock === false ? ' (esgotado)' : ''}" title="${esc(x.name)}"${x.in_stock === false ? ' data-out' : ''}><span style="--swatch:${esc(x.color || '#ccc')}"></span></button>`
          )
          .join('')}</div>`
      : v
        ? `<span class="rm-sel__variant">${esc(v.name)}</span>`
        : '<span></span>';
    selEl.innerHTML = `
      <div class="rm-sel__row">
        <span class="rm-sel__img">${picture(photoOf(it.p, v), { alt: '' })}</span>
        <div class="rm-sel__info">
          <strong class="rm-sel__name">${esc(it.p.name)}</strong>
          <span class="rm-sel__meta"><span title="largura × profundidade × altura">${cmOf(it.size.w)} × ${cmOf(it.size.d)} × ${cmOf(it.size.h)} cm</span> · ${priceTxt(unitPrice(it))}</span>
        </div>
        <button type="button" class="rm-iconbtn rm-sel__close" data-rm-act="desel" aria-label="Fechar seleção">${I.close}</button>
      </div>
      <div class="rm-sel__row rm-sel__row--tools">
        ${sw}
        <div class="rm-sel__acts">
          <button type="button" class="rm-act" data-rm-act="rot-l" aria-label="Girar 90° para a esquerda" title="Girar para a esquerda">${I.rotL}</button>
          <button type="button" class="rm-act" data-rm-act="rot-r" aria-label="Girar 90° para a direita" title="Girar para a direita (R)">${I.rotR}</button>
          <button type="button" class="rm-act" data-rm-act="dup" aria-label="Duplicar" title="Duplicar (D)">${I.dup}<span>Duplicar</span></button>
          <button type="button" class="rm-act rm-act--danger" data-rm-act="del" aria-label="Remover" title="Remover (Delete)">${I.trash}<span>Remover</span></button>
        </div>
      </div>`;
    selEl.hidden = false;
    hintEl.hidden = true;
    if (focused) {
      const d = focused.dataset;
      const q = d.rmAct ? `[data-rm-act="${d.rmAct}"]` : d.rmVariant ? `[data-rm-variant="${CSS.escape(d.rmVariant)}"]` : null;
      (q && selEl.querySelector(q))?.focus({ preventScroll: true });
    }
    if (wasHidden && st.view === 'plan') fitPlan();
  }

  function select(it) {
    sel = it || null;
    for (const x of items) paintHelpers(x);
    renderSel();
    for (const li of placedEl.querySelectorAll('[data-uid]')) {
      const on = li.dataset.uid === sel?.uid;
      li.classList.toggle('is-sel', on);
      li.querySelector('[data-rm-select]')?.setAttribute('aria-pressed', String(on));
    }
    invalidate();
  }

  function setHint() {
    hintEl.textContent =
      st.view === 'plan'
        ? 'Planta vista de cima · arraste um item para mover'
        : coarse
          ? 'Um dedo move o item · dois dedos giram e aproximam'
          : 'Arraste um item para mover · arraste o fundo para girar a vista · role para aproximar';
  }
  function setView(v) {
    st.view = v === 'plan' ? 'plan' : '3d';
    const plan = st.view === 'plan';
    if (controls) controls.enabled = !plan;
    if (ready) {
      fitPlan();
      M.gridMinor.opacity = plan ? 0.16 : 0.07;
      M.gridMajor.opacity = plan ? 0.32 : 0.15;
      M.arc.opacity = plan ? 0.75 : 0.4;
      for (const it of items) paintHelpers(it);
    }
    for (const b of root.querySelectorAll('[data-rm-view]')) b.setAttribute('aria-pressed', String(b.dataset.rmView === st.view));
    root.classList.toggle('is-plan', plan);
    setHint();
    invalidate();
  }

  function syncSizeUI() {
    const r = st.room;
    q$('[data-rm-size-label]').textContent = `${dec(r.w, 1, 2)} × ${dec(r.d, 1, 2)} m`;
    for (const k of ['w', 'd', 'h']) {
      const inp = q$(`[data-rm-dim="${k}"]`);
      if (document.activeElement !== inp) inp.value = dec(r[k], 1, 2);
      inp.removeAttribute('aria-invalid');
    }
    q$('[data-rm-area]').textContent = `Área: ${dec(r.w * r.d, 1, 1)} m² · pé-direito ${dec(r.h, 1, 2)} m`;
  }
  function setRoom(patch) {
    const r = { ...st.room, ...patch };
    for (const k of ['w', 'd', 'h']) r[k] = Math.round(clamp(Number.isFinite(r[k]) ? r[k] : st.room[k], ...LIMITS[k]) * 100) / 100;
    if (r.w === st.room.w && r.d === st.room.d && r.h === st.room.h) {
      syncSizeUI();
      return;
    }
    st.room = r;
    syncSizeUI();
    if (!ready || failed) return save();
    const dir = cam3.position.clone().sub(controls.target).normalize();
    buildRoom();
    for (const it of items) if (it.role !== 'top') [it.x, it.z] = constrain(it, it.x, it.z, false);
    for (const it of items) if (it.role === 'top') [it.x, it.z] = constrain(it, it.x, it.z, false);
    for (const it of items) apply(it);
    settleAll();
    fit3D(dir);
    fitPlan();
    changed();
  }
  function setPreset(id) {
    if (!PRESETS[id] || id === st.preset) return;
    st.preset = id;
    if (ready && !failed) buildRoom();
    updateIssues();
    renderList();
    save();
    invalidate();
  }
  function setTab(tab) {
    st.tab = tab === 'placed' ? 'placed' : 'shop';
    for (const b of root.querySelectorAll('[data-rm-tab]')) {
      const on = b.dataset.rmTab === st.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    q$('#rm-pane-shop').hidden = st.tab !== 'shop';
    q$('#rm-pane-placed').hidden = st.tab !== 'placed';
  }
  function toggleSize(open) {
    const on = open ?? sizePop.hidden;
    sizePop.hidden = !on;
    sizeBtn.setAttribute('aria-expanded', String(on));
    if (on) syncSizeUI();
  }

  let buyT = 0;
  function buyAll() {
    if (!items.length) return;
    const lines = new Map();
    for (const it of items) {
      const k = `${it.pid}|${it.variant || ''}`;
      const l = lines.get(k) || { id: it.pid, variant: it.variant || null, qty: 0 };
      l.qty += 1;
      lines.set(k, l);
    }
    const arr = [...lines.values()];
    arr.forEach((l, i) => {
      try {
        onAddToCart?.({ ...l, last: i === arr.length - 1 });
      } catch (err) {
        console.warn('[ambiente] onAddToCart falhou', err);
      }
    });
    const label = q$('[data-rm-buy-label]');
    buyBtn.classList.add('is-done');
    label.textContent = 'Itens no carrinho';
    clearTimeout(buyT);
    buyT = setTimeout(() => {
      if (!alive) return;
      buyBtn.classList.remove('is-done');
      label.textContent = 'Adicionar tudo ao carrinho';
    }, 2400);
  }

  let clearT = 0;
  function askClear() {
    if (clearBtn.classList.contains('is-confirm')) {
      clearBtn.classList.remove('is-confirm');
      clearBtn.querySelector('span').textContent = 'Limpar ambiente';
      clearAll();
      return;
    }
    clearBtn.classList.add('is-confirm');
    clearBtn.querySelector('span').textContent = coarse ? 'Toque de novo para limpar' : 'Clique de novo para limpar';
    clearTimeout(clearT);
    clearT = setTimeout(() => {
      if (!alive) return;
      clearBtn.classList.remove('is-confirm');
      clearBtn.querySelector('span').textContent = 'Limpar ambiente';
    }, 3000);
  }

  /* ---------- Cliques e campos ---------- */
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.rmAdd) {
      const hadFocus = document.activeElement === t;
      add(d.rmAdd);
      if (hadFocus) listEl.querySelector(`[data-rm-add="${CSS.escape(d.rmAdd)}"]`)?.focus({ preventScroll: true });
    } else if (d.rmAct && sel) {
      if (d.rmAct === 'desel') select(null);
      else if (d.rmAct === 'rot-l') rotateStep(sel, 1);
      else if (d.rmAct === 'rot-r') rotateStep(sel, -1);
      else if (d.rmAct === 'dup') duplicate(sel);
      else if (d.rmAct === 'del') remove(sel);
    } else if (d.rmVariant && sel) setVariant(sel, d.rmVariant);
    else if (d.rmView) setView(d.rmView);
    else if (d.rmTab) setTab(d.rmTab);
    else if (d.rmChip) {
      st.filter = d.rmChip;
      for (const c of chipsEl.querySelectorAll('[data-rm-chip]')) c.setAttribute('aria-pressed', String(c.dataset.rmChip === st.filter));
      renderList();
    } else if (d.rmSelect) {
      const it = items.find((x) => x.uid === d.rmSelect);
      if (it) select(sel === it ? null : it);
    } else if (d.rmRemove) {
      const it = items.find((x) => x.uid === d.rmRemove);
      if (it) remove(it);
      requestAnimationFrame(() => (placedEl.querySelector('[data-rm-remove]') || q$('#rm-tab-placed'))?.focus({ preventScroll: true }));
    } else if (d.rmStep) {
      const k = d.rmStep;
      setRoom({ [k]: Math.round((st.room[k] + Number(d.delta)) * 100) / 100 });
    } else if ('rmSizeBtn' in d) toggleSize();
    else if ('rmBuy' in d) buyAll();
    else if ('rmClear' in d) askClear();
    else if ('rmClose' in d) {
      close();
      onClose?.();
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-rm-preset]')) setPreset(t.value);
    else if (t.matches('[data-rm-dim]')) {
      const v = parseDec(t.value);
      if (!Number.isFinite(v) || v <= 0) {
        t.setAttribute('aria-invalid', 'true');
        return;
      }
      setRoom({ [t.dataset.rmDim]: v });
      t.value = dec(st.room[t.dataset.rmDim], 1, 2);
    }
  }
  function onInput(e) {
    if (e.target.matches('[data-rm-q]')) {
      st.q = e.target.value;
      renderList();
    }
  }
  function onDocDown(e) {
    if (!sizePop.hidden && !e.target.closest?.('.rm-sizewrap')) toggleSize(false);
  }

  /* ---------- Teclado ---------- */
  function viewAxes() {
    if (st.view === 'plan') return [[0, -1], [1, 0]];
    const f = new THREE.Vector3();
    cam3.getWorldDirection(f);
    const fw = Math.abs(f.x) > Math.abs(f.z) ? [Math.sign(f.x), 0] : [0, Math.sign(f.z) || -1];
    return [fw, [-fw[1], fw[0]]];
  }
  function onKey(e) {
    const t = e.target;
    if (!(t instanceof Element) || (t !== document.body && !root.contains(t)) || host.hidden) return;
    if (t.closest('input, select, textarea, [contenteditable]')) {
      if (e.key === 'Escape' && !sizePop.hidden && t.closest('.rm-pop')) {
        toggleSize(false);
        sizeBtn.focus();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (!sizePop.hidden) {
        toggleSize(false);
        sizeBtn.focus();
        e.preventDefault();
      } else if (sel) {
        select(null);
        e.preventDefault();
      }
      return;
    }
    if (t.closest('[role="tablist"]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = st.tab === 'shop' ? 'placed' : 'shop';
      setTab(next);
      q$(`#rm-tab-${next}`).focus();
      e.preventDefault();
      return;
    }
    if (!sel || e.altKey || e.ctrlKey || e.metaKey) return;
    // na lista de produtos as setas rolam a lista e Delete não apaga o item selecionado (R e D continuam)
    const inList = !!t.closest('.rm-cat');
    const arrows = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (inList && (arrows[e.key] || e.key === 'Delete' || e.key === 'Backspace')) return;
    if (arrows[e.key]) {
      const [rx, fy] = arrows[e.key];
      const [f, r] = viewAxes();
      const step = e.shiftKey ? 0.25 : 0.05;
      moveTo(sel, sel.x + (rx * r[0] + fy * f[0]) * step, sel.z + (rx * r[1] + fy * f[1]) * step, { snap: false });
      e.preventDefault();
    } else if (e.key === 'r' || e.key === 'R') {
      rotateStep(sel, e.shiftKey ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      remove(sel);
      stageEl.focus({ preventScroll: true });
      e.preventDefault();
    } else if (e.key === 'd' || e.key === 'D') {
      duplicate(sel);
      e.preventDefault();
    }
  }

  /* ---------- Ponteiro: selecionar, arrastar e girar ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _inv = new THREE.Matrix4();
  const _box = new THREE.Box3();
  const _lr = new THREE.Ray();
  const _v = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ptrs = new Set();
  let drag = null;
  let tap = null;
  let rdrag = null;
  let rotMoved = false;
  let hoverRaf = 0;
  let hoverEv = null;

  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam());
  }
  function boxHit(it) {
    it.obj.updateMatrixWorld();
    _inv.copy(it.obj.matrixWorld).invert();
    _lr.copy(ray.ray).applyMatrix4(_inv);
    _box.min.set(-it.size.w / 2, 0, -it.size.d / 2);
    _box.max.set(it.size.w / 2, Math.max(it.size.h, 0.02), it.size.d / 2);
    const p = _lr.intersectBox(_box, _v);
    return p ? p.applyMatrix4(it.obj.matrixWorld).distanceTo(ray.ray.origin) : null;
  }
  // Item sob o ponteiro: caixa primeiro (rápido), depois a malha para desempatar
  function pick(e, precise = true) {
    setRay(e);
    const cands = [];
    for (const it of items) {
      const d = boxHit(it);
      if (d != null) cands.push({ it, d });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    if (!precise) return cands[0];
    let best = null;
    for (const c of cands) {
      if (best && c.d > best.d) break;
      const hits = ray.intersectObject(c.it.body, true);
      if (hits.length && (!best || hits[0].distance < best.d)) best = { it: c.it, d: hits[0].distance, point: hits[0].point.clone() };
    }
    const hit = best || { it: cands[0].it, d: cands[0].d, point: ray.ray.at(cands[0].d, new THREE.Vector3()) };
    // item selecionado "preso" dentro de outro: ele tem prioridade para poder ser arrastado para fora
    if (sel && hit.it !== sel && pairs.some(([a, b]) => (a === sel && b === hit.it) || (a === hit.it && b === sel))) {
      const c = cands.find((x) => x.it === sel);
      if (c) return { it: sel, d: c.d, point: ray.ray.at(c.d, new THREE.Vector3()) };
    }
    return hit;
  }
  function floorPoint(e, y = 0) {
    setRay(e);
    plane.set(_v.set(0, 1, 0), -y);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  function onDown(e) {
    if (!ready || failed) return;
    if (e.isPrimary) ptrs.clear();
    ptrs.add(e.pointerId);
    if (ptrs.size > 1) {
      // segundo dedo: a órbita/zoom assume
      if (drag) endDrag();
      tap = null;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const hit = pick(e);
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, hit: !!hit };
    if (!hit) return;
    const it = hit.it;
    if (sel !== it) select(it);
    if (controls && e.pointerType === 'mouse') controls.enabled = false;
    const y = st.view === 'plan' ? it.y : clamp(hit.point.y, it.y, it.y + it.size.h);
    const p = floorPoint(e, y);
    drag = { it, id: e.pointerId, y, off: p ? [it.x - p.x, it.z - p.z] : [0, 0], sx: e.clientX, sy: e.clientY, moved: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ponteiro já liberado */
    }
    stageEl.focus({ preventScroll: true });
    e.preventDefault();
  }
  function onMove(e) {
    if (drag && e.pointerId === drag.id) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        canvas.style.cursor = 'grabbing';
      }
      const p = floorPoint(e, drag.y);
      if (p) moveTo(drag.it, p.x + drag.off[0], p.z + drag.off[1], { commit: false });
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) {
      hoverEv = e;
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (!alive || !hoverEv || drag) return;
          canvas.style.cursor = pick(hoverEv, false) ? 'grab' : '';
        });
      }
    }
  }
  function endDrag() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    canvas.style.cursor = '';
    if (moved) {
      save();
      if (sel) renderSel();
    }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (drag && e.pointerId === drag.id) endDrag();
    if (tap && tap.id === e.pointerId) {
      if (!tap.hit && e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6) select(null);
      tap = null;
    }
    if (!ptrs.size && controls) controls.enabled = st.view === '3d';
  }
  function onLost(e) {
    if (drag && e.pointerId === drag.id) endDrag();
  }

  // Alça de giro (arrastar = giro livre de 15 em 15°; tocar = 90°)
  function onRotDown(e) {
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      rotBtn.setPointerCapture(e.pointerId);
    } catch {
      /* ignora */
    }
    const p = floorPoint(e, sel.y);
    rotMoved = false;
    rdrag = { it: sel, id: e.pointerId, a0: p ? Math.atan2(p.x - sel.x, p.z - sel.z) : 0, r0: sel.rot, sx: e.clientX, sy: e.clientY };
  }
  function onRotMove(e) {
    if (!rdrag || e.pointerId !== rdrag.id) return;
    if (!rotMoved && Math.hypot(e.clientX - rdrag.sx, e.clientY - rdrag.sy) < 4) return;
    rotMoved = true;
    rotBtn.classList.add('is-dragging');
    const p = floorPoint(e, rdrag.it.y);
    if (!p) return;
    let a = rdrag.r0 + Math.atan2(p.x - rdrag.it.x, p.z - rdrag.it.z) - rdrag.a0;
    const deg = THREE.MathUtils.radToDeg(a);
    const q90 = Math.round(deg / 90) * 90;
    a = THREE.MathUtils.degToRad(Math.abs(deg - q90) < 6 ? q90 : Math.round(deg / 15) * 15);
    rotateTo(rdrag.it, a, { commit: false });
  }
  function onRotUp(e) {
    if (!rdrag || e.pointerId !== rdrag.id) return;
    const it = rdrag.it;
    rdrag = null;
    rotBtn.classList.remove('is-dragging');
    if (rotMoved) {
      save();
      if (sel === it) renderSel();
    }
  }
  function onRotClick(e) {
    e.preventDefault();
    if (rotMoved) {
      rotMoved = false;
      return;
    }
    if (sel) rotateStep(sel, -1);
  }

  /* ---------- Sobreposição: rótulos, cotas e alça ---------- */
  const _p = new THREE.Vector3();
  function toScreen(x, y, z) {
    _p.set(x, y, z).project(cam());
    return { x: ((_p.x + 1) / 2) * cw, y: ((1 - _p.y) / 2) * ch, ok: _p.z > -1 && _p.z < 1 };
  }
  const f1 = (v) => v.toFixed(1);
  const text = (p, s, cls = '', rot = 0) =>
    `<text class="${cls}" x="${f1(p.x)}" y="${f1(p.y)}"${rot ? ` transform="rotate(${f1(rot)} ${f1(p.x)} ${f1(p.y)})"` : ''}>${esc(s)}</text>`;
  function dimLine(a, b, label, cls = '') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    if (L < 14) return ''; // cota de poucos pixels (folga mínima até a parede) virava um "H" solto na planta
    const nx = (-dy / L) * 5;
    const ny = (dx / L) * 5;
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return `<g class="rm-dim ${cls}"><line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}"/><line x1="${f1(a.x - nx)}" y1="${f1(a.y - ny)}" x2="${f1(a.x + nx)}" y2="${f1(a.y + ny)}"/><line x1="${f1(b.x - nx)}" y1="${f1(b.y - ny)}" x2="${f1(b.x + nx)}" y2="${f1(b.y + ny)}"/>${L > 34 ? text(mid, label, 'rm-dim__label', ang) : ''}</g>`;
  }
  function drawOverlay() {
    const { w: W, d: D } = st.room;
    let s = '';
    const step = Math.max(W, D) > 7 ? 2 : 1;
    if (st.view === 'plan') {
      const top = -D / 2 - T - 0.3;
      const left = -W / 2 - T - 0.3;
      s += dimLine(toScreen(-W / 2, 0, top), toScreen(W / 2, 0, top), `${dec(W, 2, 2)} m`, 'rm-dim--room');
      s += dimLine(toScreen(left, 0, -D / 2), toScreen(left, 0, D / 2), `${dec(D, 2, 2)} m`, 'rm-dim--room');
      for (let k = step; k < W - 0.2; k += step) s += text(toScreen(-W / 2 + k, 0, D / 2 + T + 0.16), `${k} m`, 'rm-tick');
      for (let k = step; k < D - 0.2; k += step) s += text(toScreen(W / 2 + T + 0.2, 0, -D / 2 + k), `${k} m`, 'rm-tick');
      for (const it of items) {
        const c = toScreen(it.x, it.y + it.size.h, it.z);
        const dy = it.on ? 13 : 0;
        if (it === sel) {
          s += text({ x: c.x, y: c.y - 7 + dy }, nameOf(it), 'rm-plabel rm-plabel--sel');
          s += text({ x: c.x, y: c.y + 7 + dy }, `${cmOf(it.size.w)} × ${cmOf(it.size.d)} cm`, 'rm-plabel rm-plabel--dims');
        } else s += text({ x: c.x, y: c.y + dy }, nameOf(it), 'rm-plabel');
      }
      if (sel) {
        const it = sel;
        const [ex, ez] = extOf(it);
        const gl = it.x - ex + W / 2;
        const gr = W / 2 - (it.x + ex);
        const gb = it.z - ez + D / 2;
        const gf = D / 2 - (it.z + ez);
        if (Math.min(gl, gr) > 0.015) {
          s +=
            gl <= gr
              ? dimLine(toScreen(-W / 2, 0, it.z), toScreen(it.x - ex, 0, it.z), `${cmOf(gl)} cm`, 'rm-dim--gap')
              : dimLine(toScreen(it.x + ex, 0, it.z), toScreen(W / 2, 0, it.z), `${cmOf(gr)} cm`, 'rm-dim--gap');
        }
        if (Math.min(gb, gf) > 0.015) {
          s +=
            gb <= gf
              ? dimLine(toScreen(it.x, 0, -D / 2), toScreen(it.x, 0, it.z - ez), `${cmOf(gb)} cm`, 'rm-dim--gap')
              : dimLine(toScreen(it.x, 0, it.z + ez), toScreen(it.x, 0, D / 2), `${cmOf(gf)} cm`, 'rm-dim--gap');
        }
      }
    } else {
      const wc = Object.fromEntries(walls.map((w) => [w.id, w.cut]));
      const zEdge = wc.back && !wc.front ? -D / 2 - T - 0.2 : D / 2 + T + 0.2;
      const xEdge = wc.left && !wc.right ? -W / 2 - T - 0.24 : W / 2 + T + 0.24;
      // régua no piso a partir do canto do fundo à esquerda
      for (let k = 0; k <= W + 1e-6; k += step) {
        const p = toScreen(-W / 2 + k, 0, zEdge);
        if (p.ok) s += text(p, k ? `${k} m` : '0', 'rm-tick');
      }
      for (let k = step; k <= D + 1e-6; k += step) {
        const p = toScreen(xEdge, 0, -D / 2 + k);
        if (p.ok) s += text(p, `${k} m`, 'rm-tick');
      }
    }
    svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    svg.innerHTML = s;
    // alça de giro: na frente do item, no nível da base
    if (sel && !drag) {
      const [hx, hz] = toWorld(sel, 0, sel.size.d / 2 + 0.3);
      const p = toScreen(hx, sel.y + 0.01, hz);
      const inside = p.ok && p.x > 14 && p.x < cw - 14 && p.y > 14 && p.y < ch - 14;
      rotBtn.hidden = !inside;
      if (inside) rotBtn.style.transform = `translate(${f1(p.x)}px, ${f1(p.y)}px) translate(-50%, -50%)`;
    } else if (!rdrag) rotBtn.hidden = true;
  }

  /* ---------- Persistência ---------- */
  let saveT = 0;
  const snapshot = () => ({
    v: 1,
    preset: st.preset,
    room: st.room,
    items: items.map((it) => ({ pid: it.pid, variant: it.variant, x: r4(it.x), z: r4(it.z), rot: r4(it.rot) })),
  });
  function save(now = false) {
    clearTimeout(saveT);
    if (now) writeJSON(KEY, snapshot());
    else saveT = setTimeout(() => alive && writeJSON(KEY, snapshot()), 250);
  }
  function restore() {
    const list = Array.isArray(saved?.items) ? saved.items.slice(0, MAX_ITEMS) : [];
    for (const s of list) {
      if (!s || !entryById[s.pid]) continue;
      createItem(s.pid, { variant: s.variant || null, x: num(s.x), z: num(s.z), rot: num(s.rot) });
    }
    const { w: W, d: D } = st.room;
    for (const it of items) {
      if (Math.abs(it.x) > W / 2 || Math.abs(it.z) > D / 2) [it.x, it.z] = constrain(it, it.x, it.z, false);
      apply(it);
    }
    settleAll();
  }

  /* ---------- Ciclo de vida ---------- */
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        if (!alive) return;
        measureStage();
        if (ready && !failed) {
          if (!userMoved) fit3D(cam3.position.clone().sub(controls.target));
          fitPlan();
          invalidate();
        }
      })
    : null;
  ro?.observe(stageEl);
  const onWinResize = () => syncOffset();
  window.addEventListener('resize', onWinResize);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDocDown, true);
  rotBtn.addEventListener('pointerdown', onRotDown);
  rotBtn.addEventListener('pointermove', onRotMove);
  rotBtn.addEventListener('pointerup', onRotUp);
  rotBtn.addEventListener('pointercancel', onRotUp);
  rotBtn.addEventListener('click', onRotClick);

  renderChips();
  renderList();
  renderPlaced();
  renderTotals();
  syncSizeUI();
  setView('3d');
  emptyEl.hidden = true;
  // a cena começa no próximo quadro (a página já aparece montada)
  const startRaf = requestAnimationFrame(() => {
    initScene();
    if (!items.length && !failed) emptyEl.hidden = false;
  });

  function close() {
    if (!alive) return;
    save(true);
    alive = false;
    cancelAnimationFrame(startRaf);
    cancelAnimationFrame(raf);
    cancelAnimationFrame(hoverRaf);
    clearTimeout(saveT);
    clearTimeout(noteT);
    clearTimeout(buyT);
    clearTimeout(clearT);
    ro?.disconnect();
    window.removeEventListener('resize', onWinResize);
    document.removeEventListener('pointerdown', onDocDown, true);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', onLost);
    controls?.removeEventListener('change', onControls);
    controls?.removeEventListener('start', onControlsStart);
    controls?.dispose();
    for (const it of items) {
      it.ver++;
      for (const h of [it.frame, it.edges]) h?.geometry.dispose();
    }
    items.length = 0;
    if (roomG) disposeTree(roomG);
    unitBox?.dispose();
    for (const m of Object.values(M)) m.dispose?.();
    for (const t of Object.values(tex)) t.dispose?.();
    envRT?.dispose();
    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    scene = renderer = null;
    host.innerHTML = '';
    host.style.removeProperty('--room-offset');
    if (current === api) current = null;
  }

  const api = {
    close,
    // Adiciona um produto (devolve o id do item no ambiente ou null)
    add: (productId, variantId = null) => readyP.then(() => add(productId, variantId)?.uid ?? null),
    items: () =>
      items.map((it) => ({
        uid: it.uid,
        id: it.pid,
        variant: it.variant,
        kind: it.spec.kind,
        x: it.x,
        z: it.z,
        y: it.y,
        rot: it.rot,
        size: { w: cmOf(it.size.w), h: cmOf(it.size.h), d: cmOf(it.size.d) },
        on: it.on,
        loaded: it.loaded,
        issues: [...it.hard, ...it.soft],
      })),
    setView,
    get el() {
      return root;
    },
    // apoio a testes automatizados
    _debug: {
      ready: () => readyP,
      screenOf(uid, { top = false } = {}) {
        const it = items.find((x) => x.uid === uid);
        if (!it || !ready) return null;
        const p = toScreen(it.x, it.y + (top ? it.size.h : it.size.h / 2), it.z);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      floorToScreen(x, z, y = 0) {
        const p = toScreen(x, y, z);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      state: () => ({
        room: { ...st.room },
        preset: st.preset,
        view: st.view,
        selected: sel?.uid || null,
        walls: walls.map((w) => ({ id: w.id, cut: w.cut })),
        pairs: pairs.length,
        frames,
        lastMs,
        camDist: cam3 && controls ? Math.round(cam3.position.distanceTo(controls.target) * 1000) / 1000 : null,
        camAz: cam3 && controls ? Math.round(THREE.MathUtils.radToDeg(Math.atan2(cam3.position.x - controls.target.x, cam3.position.z - controls.target.z))) : null,
      }),
      orbit(azDeg, elDeg) {
        if (!ready || st.view !== '3d') return;
        const az = THREE.MathUtils.degToRad(azDeg);
        const el = THREE.MathUtils.degToRad(elDeg);
        fit3D(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)));
        invalidate();
      },
    },
  };
  return api;
}
