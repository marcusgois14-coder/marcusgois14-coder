// Kit 3D compartilhado: cores, materiais com texturas procedurais (geradas no navegador, sem baixar
// imagens), geometrias prontas e utilitários. Todos os geradores de modelos usam só este kit.
// Convenções: metros, Y para cima, chão em y = 0, frente para +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorHex } from './infer.js';

export { THREE };

/* ================================================================== */
/* Unidades, cores e aleatoriedade                                     */
/* ================================================================== */
export const cm = (v) => (Number(v) || 0) / 100;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Cor THREE (espaço linear) a partir de '#hex', 'rgb()', gradiente CSS (1ª parada) ou palavra em português.
export function colorOf(value, fallback = '#9a9a9a') {
  if (value && value.isColor) return value.clone();
  if (typeof value === 'number') return new THREE.Color(value);
  return new THREE.Color(colorHex(value, colorHex(fallback, '#9a9a9a')));
}
export const hexOf = (value, fallback) => `#${colorOf(value, fallback).getHexString()}`;
// Clareia (k > 0) ou escurece (k < 0) uma cor, retornando '#hex'.
export function shade(value, k) {
  const c = colorOf(value);
  if (k >= 0) c.lerp(new THREE.Color(1, 1, 1), k);
  else c.multiplyScalar(1 + k);
  return `#${c.getHexString()}`;
}
export const mix = (a, b, t) => `#${colorOf(a).lerp(colorOf(b), t).getHexString()}`;
// Luminância aproximada (0 = preto, 1 = branco) de uma cor em sRGB
export function luminance(value) {
  const c = colorOf(value);
  const s = c.clone().convertLinearToSRGB();
  return 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b;
}

function hashStr(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
// Gerador pseudoaleatório determinístico (mesmo produto -> mesmo modelo).
export function rng(seed = 'atual') {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}
// Semente usada para deslocar os veios/tramas de cada peça (reiniciada a cada modelo)
let uvRand = rng('uv');
export const resetSeed = (seed) => (uvRand = rng(`uv:${seed}`));

/* ================================================================== */
/* Ruído periódico (texturas sem emenda)                               */
/* ================================================================== */
function ihash(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i, p) => ((i % p) + p) % p;
// Ruído de valor periódico: período px, py em unidades da grade
function vnoise(x, y, px, py, s) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  const ax = wrap(x0, px);
  const bx = wrap(x0 + 1, px);
  const ay = wrap(y0, py);
  const by = wrap(y0 + 1, py);
  const a = ihash(ax, ay, s);
  const b = ihash(bx, ay, s);
  const c = ihash(ax, by, s);
  const d = ihash(bx, by, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, px, py, oct, s) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, px * f, py * f, s + i * 31);
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / n;
}
// Campo de baixa frequência avaliado numa grade reduzida e lido com interpolação bilinear
// periódica: sample(u, v) com u, v em [0, 1). Economiza muito tempo nas texturas.
function coarse(gw, gh, fn) {
  const G = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) G[j * gw + i] = fn(i / gw, j / gh);
  return (u, v) => {
    const x = u * gw;
    const y = v * gh;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = wrap(x0, gw);
    const b = wrap(x0 + 1, gw);
    const c = wrap(y0, gh) * gw;
    const d = wrap(y0 + 1, gh) * gw;
    const top = G[c + a] + (G[c + b] - G[c + a]) * fx;
    const bot = G[d + a] + (G[d + b] - G[d + a]) * fx;
    return top + (bot - top) * fy;
  };
}
// Worley (células) periódico: retorna [F1, F2] em unidades de célula (pontos pré-calculados)
const WORLEY = new Map();
function worley(x, y, g, s) {
  const key = `${g}:${s}`;
  let pts = WORLEY.get(key);
  if (!pts) {
    pts = new Float32Array(g * g * 2);
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        pts[(j * g + i) * 2] = 0.15 + 0.7 * ihash(i, j, s);
        pts[(j * g + i) * 2 + 1] = 0.15 + 0.7 * ihash(i, j, s + 7);
      }
    }
    WORLEY.set(key, pts);
  }
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 81;
  let f2 = 81;
  for (let j = -1; j <= 1; j++) {
    const gy = cy + j;
    const row = (gy < 0 ? gy + g : gy >= g ? gy - g : gy) * g;
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const k = (row + (gx < 0 ? gx + g : gx >= g ? gx - g : gx)) * 2;
      const dx = gx + pts[k] - x;
      const dy = gy + pts[k + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  WF1 = Math.sqrt(f1);
  WF2 = Math.sqrt(f2);
}
let WF1 = 0;
let WF2 = 0;

/* ================================================================== */
/* Canvas → textura                                                    */
/* ================================================================== */
const hasDOM = typeof document !== 'undefined';
function makeCanvas(w, h) {
  if (hasDOM) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}
// Cria um canvas preenchendo pixel a pixel: fn(i, j) -> [r, g, b] em 0..1 (ou número cinza)
function pixels(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let k = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = fn(i, j);
      if (typeof v === 'number') {
        const g = clamp(v, 0, 1) * 255;
        d[k] = g;
        d[k + 1] = g;
        d[k + 2] = g;
      } else {
        d[k] = clamp(v[0], 0, 1) * 255;
        d[k + 1] = clamp(v[1], 0, 1) * 255;
        d[k + 2] = clamp(v[2], 0, 1) * 255;
      }
      d[k + 3] = 255;
      k += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// Mapa de altura (Float32Array w*h) -> canvas de normal map (com emenda periódica)
function normalCanvas(H, w, h, strength) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0, k = 0; j < h; j++) {
    const up = (j === 0 ? h - 1 : j - 1) * w;
    const dn = (j === h - 1 ? 0 : j + 1) * w;
    const row = j * w;
    for (let i = 0; i < w; i++, k += 4) {
      const l = H[row + (i === 0 ? w - 1 : i - 1)];
      const r = H[row + (i === w - 1 ? 0 : i + 1)];
      const nx = (l - r) * strength;
      const ny = (H[dn + i] - H[up + i]) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      d[k] = (nx * inv * 0.5 + 0.5) * 255;
      d[k + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[k + 2] = (inv * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function heightField(w, h, fn) {
  const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = fn(i, j);
  return H;
}
function toTexture(canvas, srgb, repeatable = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeatable) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
const mean = (H) => {
  let s = 0;
  for (let i = 0; i < H.length; i++) s += H[i];
  return s / H.length;
};

/* ================================================================== */
/* Texturas procedurais (geradas uma vez e guardadas)                  */
/* Cada conjunto: { map, normal, rough, tile:[u,v] metros, mean }      */
/* ================================================================== */
const TEX = new Map();
const texSet = (key, build) => {
  if (!TEX.has(key)) TEX.set(key, build());
  return TEX.get(key);
};
// Constrói um conjunto a partir de funções de altura/cor/rugosidade
function buildSet({ w, h, tile, height, color, rough, strength = 2, seed = 1 }) {
  const H = heightField(w, h, (i, j) => height(i, j, seed));
  const C = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) C[j * w + i] = color(i, j, H[j * w + i]);
  const set = {
    map: toTexture(pixels(w, h, (i, j) => C[j * w + i]), true),
    normal: toTexture(normalCanvas(H, w, h, strength), false),
    rough: rough ? toTexture(pixels(w, h, (i, j) => rough(i, j, H[j * w + i])), false) : null,
    tile,
    mean: Math.max(0.55, mean(C)),
  };
  return set;
}

// Trama de tecido plano (linho/algodão): threads fios por tile, slub = irregularidade
function weaveSet(key, { size = 512, tile, threads, slub, seed }) {
  return texSet(key, () => {
    const T = size / threads;
    const prof = (t, k) => Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.6) * k;
    const tone = new Float32Array(size * size);
    const SL = 6; // trechos de "slub" (engrossamentos) ao longo de cada fio
    const low = coarse(64, 64, (u, v) => fbm(u * 4, v * 4, 4, 4, 3, seed + 5) - 0.5);
    const height = (i, j) => {
      const ci = Math.floor(i / T);
      const cj = Math.floor(j / T);
      const u = i / T - ci;
      const v = j / T - cj;
      const warpTop = ((ci + cj) & 1) === 0;
      // irregularidade varia ao longo do fio (não forma xadrez)
      const sw = vnoise(ci % threads, (j / size) * SL, threads, SL, seed);
      const sf = vnoise(cj % threads, (i / size) * SL, threads, SL, seed + 3);
      const kw = 1 - slub * Math.max(0, sw - 0.35);
      const kf = 1 - slub * Math.max(0, sf - 0.35);
      const warp = prof(u, kw) * (warpTop ? 1 : 0.45) * (0.8 + 0.2 * Math.sin(Math.PI * v));
      const weft = prof(v, kf) * (warpTop ? 0.45 : 1) * (0.8 + 0.2 * Math.sin(Math.PI * u));
      tone[j * size + i] = (warp > weft ? sw - 0.5 : sf - 0.5) * slub * 0.22 + low(i / size, j / size) * 0.06;
      return Math.max(warp, weft);
    };
    return buildSet({
      w: size,
      h: size,
      tile,
      seed,
      strength: 2.2,
      height,
      color: (i, j, hgt) => 0.76 + 0.22 * hgt + tone[j * size + i],
      rough: (i, j, hgt) => 0.9 + 0.08 * (1 - hgt),
    });
  });
}

const TEXTURES = {
  linen: () => weaveSet('linen', { tile: [0.07, 0.07], threads: 36, slub: 0.5, seed: 11 }),
  cotton: () => weaveSet('cotton', { tile: [0.05, 0.05], threads: 40, slub: 0.12, seed: 12 }),
  velvet: () =>
    texSet('velvet', () =>
      buildSet({
        w: 512,
        h: 512,
        tile: [0.45, 0.45],
        seed: 21,
        strength: 0.9,
        height: (i, j, s) => fbm((i / 512) * 96, (j / 512) * 96, 96, 96, 2, s),
        color: (() => {
          const crush = coarse(96, 96, (u, v) => fbm(u * 5, v * 5, 5, 5, 4, 23));
          return (i, j, hgt) => 0.86 + (crush(i / 512, j / 512) - 0.5) * 0.16 + (hgt - 0.5) * 0.05;
        })(),
        rough: (i, j, hgt) => 0.82 + 0.1 * hgt,
      })
    ),
  suede: () =>
    texSet('suede', () =>
      buildSet({
        w: 512,
        h: 512,
        tile: [0.35, 0.35],
        seed: 31,
        strength: 0.8,
        height: (i, j, s) => fbm((i / 512) * 128, (j / 512) * 128, 128, 128, 2, s),
        color: (() => {
          const brush = coarse(64, 256, (u, v) => fbm(u * 3, v * 18, 3, 18, 3, 33));
          const cloud = coarse(96, 96, (u, v) => fbm(u * 6, v * 6, 6, 6, 4, 34));
          return (i, j, hgt) => 0.84 + (brush(i / 512, j / 512) - 0.5) * 0.12 + (cloud(i / 512, j / 512) - 0.5) * 0.1 + (hgt - 0.5) * 0.04;
        })(),
        rough: () => 0.95,
      })
    ),
  leather: () =>
    texSet('leather', () => {
      const G = 56;
      return buildSet({
        w: 512,
        h: 512,
        tile: [0.22, 0.22],
        seed: 41,
        strength: 3.2,
        height: (i, j, s) => {
          const x = (i / 512) * G;
          const y = (j / 512) * G;
          worley(x, y, G, s);
          const crease = smoothstep(0.0, 0.32, WF2 - WF1);
          return crease * 0.85 + fbm((i / 512) * 128, (j / 512) * 128, 128, 128, 2, s + 3) * 0.15;
        },
        color: (() => {
          const mottle = coarse(64, 64, (u, v) => fbm(u * 4, v * 4, 4, 4, 4, 43));
          return (i, j, hgt) => 0.84 + 0.1 * hgt + (mottle(i / 512, j / 512) - 0.5) * 0.12;
        })(),
        // couro com brilho acetinado (antes 0.42..0.64 parecia lona/juta)
        rough: (i, j, hgt) => 0.34 + 0.16 * (1 - hgt),
      });
    }),
  boucle: () =>
    texSet('boucle', () => {
      const S = 512;
      const H = new Float32Array(S * S);
      const r = rng(51);
      // base irregular
      const base = coarse(128, 128, (u, v) => fbm(u * 32, v * 32, 32, 32, 3, 52));
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) H[j * S + i] = 0.25 * base(i / S, j / S);
      // laços (anéis) espalhados, com emenda periódica
      const loops = 2300;
      for (let n = 0; n < loops; n++) {
        const cx = r() * S;
        const cy = r() * S;
        const R = 3.2 + r() * 4.2;
        const wR = 1.3 + r() * 0.8;
        const ext = Math.ceil(R + wR * 2.5);
        const amp = 0.6 + r() * 0.4;
        for (let dy = -ext; dy <= ext; dy++) {
          for (let dx = -ext; dx <= ext; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            const q = (dist - R) / wR;
            if (q > 2.2 || q < -2.2) continue;
            const v = amp * Math.exp(-q * q);
            if (v < 0.02) continue;
            const ii = wrap(Math.round(cx + dx), S);
            const jj = wrap(Math.round(cy + dy), S);
            const k = jj * S + ii;
            if (v > H[k]) H[k] = v;
          }
        }
      }
      const C = new Float32Array(S * S);
      // contraste suave: o bouclé claro não vira "granito" cinza (o relevo fica por conta do normal map)
      for (let k = 0; k < C.length; k++) C[k] = 0.8 + 0.2 * H[k];
      return {
        map: toTexture(pixels(S, S, (i, j) => C[j * S + i]), true),
        normal: toTexture(normalCanvas(H, S, S, 3.5), false),
        rough: null,
        tile: [0.11, 0.11],
        mean: mean(C),
      };
    }),
  mattress: () =>
    texSet('mattress', () => {
      const S = 512;
      const P = 0.1; // losango de 10 cm
      const tile = 0.3;
      const per = tile / P; // 3 losangos por tile
      return buildSet({
        w: S,
        h: S,
        tile: [tile, tile],
        seed: 61,
        strength: 4,
        height: (i, j) => {
          const u = (i / S) * per;
          const v = (j / S) * per;
          const a = u + v;
          const b = u - v;
          const d1 = Math.abs(a - Math.round(a));
          const d2 = Math.abs(b - Math.round(b));
          const dl = Math.min(d1, d2);
          let h = Math.sqrt(clamp(dl / 0.32, 0, 1));
          // pontos de costura
          const along = d1 < d2 ? b : a;
          if (dl < 0.025 && (along * 40) % 1 < 0.55) h -= 0.12;
          // botões nos cruzamentos
          const near = Math.hypot(d1, d2);
          if (near < 0.06) h -= 0.25 * (1 - near / 0.06);
          return h;
        },
        color: (() => {
          const jacF = coarse(160, 160, (u, v) => fbm(u * 12, v * 12, 12, 12, 4, 63));
          return (i, j, hgt) => {
          const jac = jacF(i / S, j / S);
          const motif = smoothstep(0.52, 0.56, jac) - smoothstep(0.6, 0.64, jac);
          return 0.86 + 0.12 * clamp(hgt, 0, 1) - motif * 0.035;
          };
        })(),
        rough: () => 0.92,
      });
    }),
  mattressBorder: () =>
    texSet('mattressBorder', () =>
      buildSet({
        w: 256,
        h: 256,
        tile: [0.06, 0.06],
        seed: 65,
        strength: 2.5,
        height: (i, j) => 0.5 + 0.5 * Math.sin((j / 256) * Math.PI * 2 * 12) * (0.85 + 0.15 * Math.sin((i / 256) * Math.PI * 2 * 24)),
        color: (i, j, hgt) => 0.88 + 0.1 * hgt,
        rough: () => 0.9,
      })
    ),
  // Faixa lateral de colchão com pespontos ondulados (linhas trapezoidais) sobre sarja diagonal
  mattressWave: () =>
    texSet('mattressWave', () => {
      const S = 512;
      const rows = 6; // linhas de pesponto por tile
      const per = 2; // ondas por tile
      const trap = (t) => {
        const f = t - Math.floor(t);
        if (f < 0.3) return -1;
        if (f < 0.5) return -1 + ((f - 0.3) / 0.2) * 2;
        if (f < 0.8) return 1;
        return 1 - ((f - 0.8) / 0.2) * 2;
      };
      const D = new Float32Array(S * S);
      const T = new Float32Array(S * S);
      for (let j = 0; j < S; j++) {
        const v = (j / S) * rows;
        const r = Math.floor(v);
        const fy = v - r - 0.5;
        for (let i = 0; i < S; i++) {
          const off = trap((i / S) * per + r * 0.5) * 0.2;
          const d = (Math.abs(fy - off) * S) / rows;
          const dash = ((i / S) * per * 26) % 1 < 0.72 ? 1 : 0;
          D[j * S + i] = d;
          T[j * S + i] = dash * Math.exp((-d * d) / 1.4);
        }
      }
      return buildSet({
        w: S,
        h: S,
        tile: [0.36, 0.24],
        seed: 67,
        strength: 2.4,
        height: (i, j) => {
          const d = D[j * S + i];
          const twill = 0.5 + 0.5 * Math.sin(((i + j) / S) * Math.PI * 2 * 90);
          return 0.75 + 0.08 * twill - 0.3 * Math.exp((-d * d) / 3) + 0.06 * T[j * S + i];
        },
        color: (i, j, hgt) => 0.8 + 0.08 * (hgt - 0.75) + 0.32 * T[j * S + i],
        rough: () => 0.86,
      });
    }),
  marble: () =>
    texSet('marble', () => {
      const S = 512;
      return buildSet({
        w: S,
        h: S,
        tile: [0.8, 0.8],
        seed: 71,
        strength: 0.3,
        height: () => 0.5,
        color: (() => {
          const T1 = coarse(128, 128, (u, v) => fbm(u * 3, v * 3, 3, 3, 5, 72));
          const T2 = coarse(160, 160, (u, v) => fbm(u * 6, v * 6, 6, 6, 4, 74));
          const CL = coarse(64, 64, (u, v) => fbm(u * 4, v * 4, 4, 4, 3, 75));
          return (i, j) => {
          const u = i / S;
          const v = j / S;
          const t = T1(u, v);
          const t2 = T2(u, v);
          const vein = 1 - smoothstep(0.0, 0.05, Math.abs(Math.sin((u * 2 + v + t * 2.6) * Math.PI * 2)));
          const fine = 1 - smoothstep(0.0, 0.025, Math.abs(Math.sin((u - v * 2 + t2 * 3.4) * Math.PI * 3)));
          const cloud = CL(u, v);
          return 0.95 - vein * 0.32 - fine * 0.14 - (cloud - 0.5) * 0.06;
          };
        })(),
        rough: () => 0.12,
      });
    }),
  brushed: () =>
    texSet('brushed', () =>
      buildSet({
        w: 512,
        h: 512,
        tile: [0.25, 0.25],
        seed: 81,
        strength: 0.6,
        height: (i, j, s) => fbm((i / 512) * 2, (j / 512) * 256, 2, 256, 3, s),
        color: (i, j, hgt) => 0.9 + 0.1 * hgt,
        rough: (i, j, hgt) => 0.26 + 0.14 * hgt,
      })
    ),
  peel: () =>
    texSet('peel', () =>
      buildSet({
        w: 256,
        h: 256,
        tile: [0.12, 0.12],
        seed: 85,
        strength: 0.5,
        height: (i, j, s) => fbm((i / 256) * 48, (j / 256) * 48, 48, 48, 2, s),
        color: () => 1,
        rough: (i, j, hgt) => 0.42 + 0.1 * hgt,
      })
    ),
};

// Madeira: veios ao longo de U (1,2 m) por V (0,3 m). grain: 'oak' | 'rustic' | 'smooth'
function woodSet(grain) {
  return texSet(`wood:${grain}`, () => {
    const W = 1024;
    const Hh = 256;
    const cfg = {
      oak: { rings: 22, warp: 2.2, contrast: 0.2, fine: 0.06, fiber: 0.05, pores: 0.08, rays: true, relief: 0.12, seed: 91 },
      rustic: { rings: 12, warp: 3, contrast: 0.3, fine: 0.06, fiber: 0.07, pores: 0.12, rays: false, relief: 0.35, seed: 93, planks: 3, knots: 4 },
      smooth: { rings: 18, warp: 1.8, contrast: 0.08, fine: 0.03, fiber: 0.025, pores: 0.02, rays: false, relief: 0.05, seed: 95 },
    }[grain] || { rings: 22, warp: 2.2, contrast: 0.2, fine: 0.06, fiber: 0.05, pores: 0.08, relief: 0.12, seed: 91 };
    const r = rng(cfg.seed);
    const knots = Array.from({ length: cfg.knots || 0 }, () => ({ u: r(), v: r(), rad: 0.012 + r() * 0.02 }));
    const plankTone = Array.from({ length: cfg.planks || 1 }, () => (r() - 0.5) * 0.18);
    const s0 = cfg.seed;
    // campos de baixa/média frequência em grades reduzidas
    const WARP = coarse(128, 32, (u, v) => (fbm(u * 3, v * 2, 3, 2, 3, s0) - 0.5) * cfg.warp + (fbm(u * 14, v * 4, 14, 4, 2, s0 + 1) - 0.5) * 0.35);
    const TONE = coarse(64, 64, (u, v) => (fbm(u * 2, v * 6, 2, 6, 3, s0 + 13) - 0.5) * 0.08);
    const SAW = cfg.planks ? coarse(256, 64, (u, v) => fbm(u * 4, v * 4, 4, 4, 2, s0)) : null;
    const CRK = cfg.planks ? coarse(256, 64, (u, v) => (vnoise(u * 8, v * 40, 8, 40, s0 + 17) > 0.83 ? 1 : 0) * (Math.abs(fbm(u * 30, v * 3, 30, 3, 2, s0 + 19) - 0.5) < 0.02 ? 1 : 0)) : null;
    const field = (i, j) => {
      const u = i / W;
      const v = j / Hh;
      const s = cfg.seed;
      // espaçamento irregular dos anéis (mapeamento monotônico) + ondulação suave
      let ring = cfg.rings * (v + (0.6 * Math.sin(Math.PI * 2 * 3 * v + 1.3)) / (Math.PI * 2 * 3)) + WARP(u, v);
      let knot = 0;
      for (const k of knots) {
        let du = Math.abs(u - k.u);
        du = Math.min(du, 1 - du) * 4; // U é 4x mais longo em metros
        let dv = Math.abs(v - k.v);
        dv = Math.min(dv, 1 - dv);
        const dd = Math.sqrt(du * du + dv * dv) / k.rad;
        if (dd < 3) {
          ring += 1.4 * Math.exp(-dd * dd * 0.6) * Math.sign(v - k.v || 1);
          knot = Math.max(knot, Math.exp(-dd * dd * 1.5));
        }
      }
      const fr = ring - Math.floor(ring);
      // lenho tardio: faixa fina e escura com transição suave do lado de dentro
      const late = smoothstep(0.62, 0.93, fr) * (1 - smoothstep(0.93, 1.0, fr));
      const ring3 = ring * 3.1;
      const fineR = ring3 - Math.floor(ring3);
      const fine = smoothstep(0.8, 0.95, fineR) * (1 - smoothstep(0.95, 1.0, fineR));
      // fibras retas e finas ao longo do veio
      const fiber = vnoise(u * 24, v * 260, 24, 260, s + 5);
      const pore = vnoise(u * 640, v * 110, 640, 110, s + 9);
      let val = 1 - cfg.contrast * late - cfg.fine * fine - cfg.fiber * (fiber - 0.5) * 2 - (pore > 0.8 ? cfg.pores * (pore - 0.8) * 5 : 0);
      if (cfg.rays) {
        const ray = vnoise(u * 60, v * 220, 60, 220, s + 11);
        if (ray > 0.86) val += 0.05 * (ray - 0.86) * 7;
      }
      val += TONE(u, v);
      let seam = 0;
      if (cfg.planks) {
        const pv = v * cfg.planks;
        const pi = Math.floor(pv) % cfg.planks;
        val += plankTone[pi];
        const e = Math.min(pv - Math.floor(pv), 1 - (pv - Math.floor(pv)));
        seam = e < 0.012 ? 1 : 0;
        // rachaduras e marcas de serra (demolição)
        if (CRK(u, v) > 0.5) seam = Math.max(seam, 0.7);
        val -= 0.04 * Math.max(0, Math.sin(u * Math.PI * 2 * 70 + SAW(u, v) * 6));
      }
      val -= knot * 0.35;
      const k = j * W + i;
      C[k] = clamp(val - seam * 0.45, 0.15, 1);
      H[k] = 1 - (late * 0.5 + fine * 0.2 + fiber * 0.15) * cfg.relief - seam - (pore > 0.82 ? 0.25 : 0) - knot * 0.3;
    };
    const C = new Float32Array(W * Hh);
    const H = new Float32Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) field(i, j);
    const baseR = { oak: 0.5, rustic: 0.72, smooth: 0.34 }[grain] || 0.5;
    return {
      map: toTexture(pixels(W, Hh, (i, j) => C[j * W + i]), true),
      normal: toTexture(normalCanvas(H, W, Hh, grain === 'rustic' ? 2.2 : 1.4), false),
      rough: toTexture(pixels(W, Hh, (i, j) => baseR + 0.18 * (1 - H[j * W + i])), false),
      tile: [1.2, 0.3],
      mean: mean(C),
    };
  });
}

// Palhinha (tela sextavada vienense): 4 x 4 células de 12 mm por tile
function caneSet() {
  return texSet('cane', () => {
    const S = 512;
    const n = 4;
    const cell = S / n;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#141414';
    g.fillRect(0, 0, S, S);
    const strand = (x1, y1, x2, y2, wdt) => {
      g.lineCap = 'butt';
      g.strokeStyle = '#8c8c8c';
      g.lineWidth = wdt;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.strokeStyle = '#e6e6e6';
      g.lineWidth = wdt * 0.62;
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = wdt * 0.22;
      g.stroke();
    };
    const sw = cell * 0.13;
    const gap = cell * 0.075;
    for (let k = -1; k <= n + 1; k++) {
      const p = k * cell;
      strand(-S, p - gap, 2 * S, p - gap, sw);
      strand(-S, p + gap, 2 * S, p + gap, sw);
    }
    for (let k = -1; k <= n + 1; k++) {
      const p = k * cell;
      strand(p - gap, -S, p - gap, 2 * S, sw);
      strand(p + gap, -S, p + gap, 2 * S, sw);
    }
    for (let k = -2 * n; k <= 2 * n; k++) {
      const o = k * cell;
      strand(o - S, -S, o + 2 * S, 2 * S, sw * 1.05);
      strand(o + 2 * S, -S, o - S, 2 * S, sw * 1.05);
    }
    // fibras finas
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    const H = new Float32Array(S * S);
    for (let k = 0, p = 0; k < d.length; k += 4, p++) {
      const i = p % S;
      const j = (p / S) | 0;
      const fib = 0.92 + 0.08 * vnoise(i * 0.9, j * 0.9, S * 0.9, S * 0.9, 101);
      const v = (d[k] / 255) * fib;
      H[p] = v;
      d[k] = d[k + 1] = d[k + 2] = Math.min(255, v * 255);
    }
    g.putImageData(img, 0, 0);
    const alpha = pixels(S, S, (i, j) => (H[j * S + i] > 0.2 ? 1 : 0));
    return {
      map: toTexture(c, true),
      normal: toTexture(normalCanvas(H, S, S, 3), false),
      rough: null,
      alpha: toTexture(alpha, false),
      tile: [0.048, 0.048],
      mean: 0.82,
    };
  });
}

// Tela ligada: papel de parede suave (TV de vitrine)
function screenTexture() {
  return texSet('screen:on', () => {
    const c = makeCanvas(512, 288);
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 512, 288);
    bg.addColorStop(0, '#0d1b3d');
    bg.addColorStop(0.55, '#3a1f5c');
    bg.addColorStop(1, '#b0456a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 288);
    const blob = (x, y, r, col) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 512, 288);
    };
    blob(380, 80, 220, 'rgba(255,170,90,0.55)');
    blob(120, 230, 200, 'rgba(60,140,255,0.45)');
    blob(260, 150, 120, 'rgba(255,255,255,0.12)');
    return { map: toTexture(c, true, false), tile: [1, 1], mean: 1 };
  });
}

/* ================================================================== */
/* Materiais (cache por tipo + cor + opções)                           */
/* ================================================================== */
const MAT = new Map();
const keyOf = (type, color, opts) => `${type}|${color}|${JSON.stringify(opts || {})}`;
// Cor compensada pela média da textura (o resultado médio fica igual à cor pedida)
// keepHue: limita o ganho pelo canal mais forte, para cores claras (off white, bege) não perderem o tom ao saturar em 1
function tint(color, set, cap = 1.25, keepHue = false) {
  const c = colorOf(color);
  if (!set) return c;
  let k = Math.min(cap, 1 / (set.mean || 1));
  if (keepHue) k = Math.max(1, Math.min(k, 1 / Math.max(c.r, c.g, c.b, 1e-3)));
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return c;
}
function cached(type, color, opts, build) {
  const hex = color == null ? '' : hexOf(color);
  const key = keyOf(type, hex, opts);
  if (!MAT.has(key)) {
    const m = build(hex);
    m.userData = { ...(m.userData || {}), type, color: hex, opts: opts || {}, ...m.userData };
    if (!m.userData.tile) m.userData.tile = [1, 1];
    if (!m.userData.uv) m.userData.uv = 'world';
    m.name = `${type}:${hex}${opts && Object.keys(opts).length ? `:${Object.values(opts).join(',')}` : ''}`;
    MAT.set(key, m);
  }
  return MAT.get(key);
}
const withTex = (params, set, { normalScale = 1, rough = true } = {}) => {
  if (!set) return params;
  params.map = set.map;
  if (set.normal) {
    params.normalMap = set.normal;
    params.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  if (rough && set.rough) params.roughnessMap = set.rough;
  return params;
};

export const mat = {
  // Tecidos: kind 'velvet' | 'linen' | 'leather' | 'boucle' | 'cotton' | 'suede'
  fabric(color = '#9a9a9a', { kind = 'cotton' } = {}) {
    return cached('fabric', color, { kind }, (hex) => {
      let m;
      if (kind === 'velvet') {
        const s = TEXTURES.velvet();
        const base = tint(hex, s, 1.04);
        m = new THREE.MeshPhysicalMaterial(
          withTex({ color: base, roughness: 0.9, sheen: 1, sheenRoughness: 0.5, sheenColor: colorOf(shade(hex, 0.22)) }, s, { normalScale: 0.25 })
        );
        m.userData = { tile: s.tile, part: 'main' };
      } else if (kind === 'leather') {
        const s = TEXTURES.leather();
        m = new THREE.MeshPhysicalMaterial(withTex({ color: tint(hex, s, 1.25, true), roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.4 }, s, { normalScale: 0.2 }));
        m.userData = { tile: s.tile, part: 'main' };
      } else if (kind === 'suede') {
        const s = TEXTURES.suede();
        m = new THREE.MeshPhysicalMaterial(withTex({ color: tint(hex, s), roughness: 0.95, sheen: 0.6, sheenRoughness: 0.6, sheenColor: colorOf(shade(hex, 0.25)) }, s, { normalScale: 0.25 }));
        m.userData = { tile: s.tile, part: 'main' };
      } else if (kind === 'boucle') {
        const s = TEXTURES.boucle();
        m = new THREE.MeshStandardMaterial(withTex({ color: tint(hex, s, 1.3, true), roughness: 1 }, s, { normalScale: 0.9 }));
        m.userData = { tile: s.tile, part: 'main' };
      } else {
        const s = kind === 'linen' ? TEXTURES.linen() : TEXTURES.cotton();
        m = new THREE.MeshStandardMaterial(withTex({ color: tint(hex, s), roughness: 1 }, s, { normalScale: kind === 'linen' ? 0.8 : 0.5 }));
        m.userData = { tile: s.tile, part: 'main' };
      }
      return m;
    });
  },
  // Madeira: grain 'oak' (carvalho), 'rustic' (demolição), 'smooth' (laqueada/MDF amadeirado).
  // relief (opcional) multiplica o relevo do veio — útil em madeiras escuras, onde o relevo fino brilha demais.
  wood(color = '#a87a4c', { grain = 'oak', relief } = {}) {
    const opts = relief == null ? { grain } : { grain, relief };
    return cached('wood', color, opts, (hex) => {
      const s = woodSet(grain);
      const m = new THREE.MeshStandardMaterial(withTex({ color: tint(hex, s, 1.08), roughness: 1, metalness: 0 }, s, { normalScale: (grain === 'rustic' ? 0.7 : 0.35) * (relief ?? 1) }));
      m.userData = { tile: s.tile, part: 'wood' };
      return m;
    });
  },
  // Metal: finish 'painted' (pintado), 'brushed' (escovado/inox), 'chrome' (cromado)
  metal(color = '#c3c5c7', { finish = 'brushed' } = {}) {
    return cached('metal', color, { finish }, (hex) => {
      let m;
      if (finish === 'chrome') {
        m = new THREE.MeshStandardMaterial({ color: colorOf(hex), metalness: 1, roughness: 0.08 });
      } else if (finish === 'painted') {
        const s = TEXTURES.peel();
        m = new THREE.MeshStandardMaterial(withTex({ color: colorOf(hex), metalness: 0.25, roughness: 1 }, s, { normalScale: 0.15 }));
        m.userData = { tile: s.tile };
      } else {
        const s = TEXTURES.brushed();
        m = new THREE.MeshStandardMaterial(withTex({ color: tint(hex, s), metalness: 1, roughness: 1 }, s, { normalScale: 0.12 }));
        m.userData = { tile: s.tile };
      }
      m.userData = { ...m.userData, part: 'metal' };
      return m;
    });
  },
  // Plástico liso; gloss 0 (fosco) a 1 (brilhante)
  plastic(color = '#f2f2f2', { gloss = 0.5 } = {}) {
    return cached('plastic', color, { gloss }, (hex) => {
      const m = new THREE.MeshPhysicalMaterial({ color: colorOf(hex), roughness: lerp(0.75, 0.12, gloss), metalness: 0, clearcoat: gloss > 0.6 ? 0.6 : 0, clearcoatRoughness: 0.2 });
      m.userData = { part: 'main' };
      return m;
    });
  },
  // Pintura/laca (MDF branco, laca brilho); gloss 0..1
  paint(color = '#f4f4f2', { gloss = 0.25 } = {}) {
    return cached('paint', color, { gloss }, (hex) => {
      const s = TEXTURES.peel();
      const m = new THREE.MeshPhysicalMaterial(
        withTex({ color: colorOf(hex), roughness: 1, metalness: 0, clearcoat: gloss > 0.5 ? 0.8 : 0, clearcoatRoughness: 0.15 }, s, { normalScale: 0.06, rough: false })
      );
      m.roughness = lerp(0.72, 0.18, gloss);
      m.userData = { tile: s.tile, part: 'main' };
      return m;
    });
  },
  glass({ tint: tc = '#dfe8e8', opacity = 0.28 } = {}) {
    return cached('glass', tc, { opacity }, (hex) => {
      const m = new THREE.MeshPhysicalMaterial({
        color: colorOf(hex),
        metalness: 0,
        roughness: 0.04,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        specularIntensity: 1,
        envMapIntensity: 1.4,
      });
      m.userData = { part: 'detail' };
      return m;
    });
  },
  // Tela de TV/monitor: desligada (preto reflexivo) ou ligada (papel de parede)
  screen({ on = false } = {}) {
    return cached('screen', null, { on }, () => {
      const m = on
        ? new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0, emissive: 0xffffff, emissiveMap: screenTexture().map, emissiveIntensity: 0.9 })
        : new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
      m.userData = { part: 'detail', uv: 'fit' };
      return m;
    });
  },
  // Palhinha; see = true deixa os furos vazados (alphaTest)
  cane(color = '#d8b77a', { see = false } = {}) {
    return cached('cane', color, { see }, (hex) => {
      const s = caneSet();
      const p = withTex({ color: tint(hex, s), roughness: 0.7, metalness: 0 }, s, { normalScale: 0.6 });
      if (see) {
        p.alphaMap = s.alpha;
        p.alphaTest = 0.5;
        p.side = THREE.DoubleSide;
      }
      const m = new THREE.MeshStandardMaterial(p);
      m.userData = { tile: s.tile, part: 'accent' };
      return m;
    });
  },
  // Tecido de colchão: kind 'quilted' (tampo matelassê), 'border' (faixa lateral) ou 'wave' (faixa com pesponto ondulado)
  mattress(color = '#f4f3ef', { kind = 'quilted' } = {}) {
    return cached('mattress', color, { kind }, (hex) => {
      const s = kind === 'border' ? TEXTURES.mattressBorder() : kind === 'wave' ? TEXTURES.mattressWave() : TEXTURES.mattress();
      const m = new THREE.MeshStandardMaterial(withTex({ color: tint(hex, s, 1.15), roughness: 1 }, s, { normalScale: kind === 'border' ? 0.5 : kind === 'wave' ? 0.6 : 1 }));
      m.userData = { tile: s.tile, part: 'main' };
      return m;
    });
  },
  marble(color = '#f2f0ec') {
    return cached('marble', color, {}, (hex) => {
      const s = TEXTURES.marble();
      const m = new THREE.MeshPhysicalMaterial(withTex({ color: tint(hex, s, 1.1), roughness: 1, clearcoat: 0.5, clearcoatRoughness: 0.1 }, s, { normalScale: 0.1 }));
      m.userData = { tile: s.tile, part: 'accent' };
      return m;
    });
  },
  rubber(color = '#1a1a1a') {
    return cached('rubber', color, {}, (hex) => {
      const m = new THREE.MeshStandardMaterial({ color: colorOf(hex), roughness: 0.95, metalness: 0 });
      m.userData = { part: 'detail' };
      return m;
    });
  },
  // Cor lisa sem textura (detalhes pequenos: botões, frestas, LEDs)
  flat(color = '#222222', { roughness = 0.6, metalness = 0, emissive = null } = {}) {
    return cached('flat', color, { roughness, metalness, emissive }, (hex) => {
      const m = new THREE.MeshStandardMaterial({ color: colorOf(hex), roughness, metalness });
      if (emissive) {
        m.emissive = colorOf(emissive);
        m.emissiveIntensity = 1;
      }
      m.userData = { part: 'detail' };
      return m;
    });
  },
  // Estofado a partir do spec.material ('velvet', 'linen', 'leather', 'boucle', 'suede', 'cotton', 'fabric')
  upholstery(color, material) {
    const kind = { velvet: 'velvet', linen: 'linen', leather: 'leather', boucle: 'boucle', suede: 'suede', cotton: 'cotton' }[material] || 'cotton';
    return mat.fabric(color, { kind });
  },
  // Superfície de móvel a partir do spec: woodLook -> madeira; mdf/laca -> pintura; metal/inox/vidro/mármore...
  surface(color, material, { woodLook = false, grain } = {}) {
    if (material === 'glass') return mat.glass({ tint: color });
    if (material === 'marble') return mat.marble(color);
    if (material === 'steel') return mat.metal(color, { finish: 'brushed' });
    if (material === 'metal') return mat.metal(color, { finish: 'painted' });
    if (material === 'plastic') return mat.plastic(color, { gloss: 0.4 });
    if (material === 'lacquer') return mat.paint(color, { gloss: 0.85 });
    if (material === 'cane') return mat.cane(color);
    if (woodLook || material === 'wood') return mat.wood(color, { grain: grain || (material === 'wood' ? 'oak' : 'smooth') });
    if (['velvet', 'linen', 'leather', 'boucle', 'suede', 'cotton', 'fabric'].includes(material)) return mat.upholstery(color, material);
    return mat.paint(color, { gloss: 0.2 });
  },
  // Cópia com repetição de textura ajustada (para geometria com UV 0..1 de tamanho w x h em metros)
  scaled(material, widthM, heightM) {
    const t = material.userData?.tile || [1, 1];
    const key = `${material.uuid}|${widthM.toFixed(3)}|${heightM.toFixed(3)}`;
    if (MAT.has(key)) return MAT.get(key);
    const m = material.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap']) {
      if (m[k]) {
        m[k] = m[k].clone();
        m[k].repeat.set(widthM / t[0], heightM / t[1]);
        m[k].needsUpdate = true;
      }
    }
    m.userData = { ...material.userData, uv: 'fit' };
    MAT.set(key, m);
    return m;
  },
};

/* ================================================================== */
/* UV em escala de mundo                                               */
/* ================================================================== */
// As UVs são gravadas em "tiles": metros / tamanho do tile da textura do material.
// Assim um sofá grande e uma cadeira pequena mostram a mesma trama.
const AX = ['x', 'y', 'z'];
function tileOf(material) {
  const m = Array.isArray(material) ? material[0] : material;
  return m?.userData?.tile || [1, 1];
}
const uvMode = (material) => (Array.isArray(material) ? material[0] : material)?.userData?.uv || 'world';

// Projeção tipo caixa por triângulo (sem borrões nas quinas). grain: eixo do veio ('x'|'y'|'z')
function projectUV(geo, material, grain = 'x') {
  if (uvMode(material) === 'fit') return geo;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const [tu, tv] = tileOf(material);
  const ou = uvRand() * 5;
  const ov = uvRand() * 5;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    const ax = Math.abs(nrm.x);
    const ay = Math.abs(nrm.y);
    const az = Math.abs(nrm.z);
    let uA;
    let vA;
    if (ay >= ax && ay >= az) {
      uA = grain === 'z' ? 'z' : 'x';
      vA = uA === 'x' ? 'z' : 'x';
    } else if (az >= ax) {
      uA = grain === 'y' ? 'y' : 'x';
      vA = uA === 'x' ? 'y' : 'x';
    } else {
      uA = grain === 'y' ? 'y' : 'z';
      vA = uA === 'z' ? 'y' : 'z';
    }
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      uv[(i + k) * 2] = (p[uA] + ou) / tu;
      uv[(i + k) * 2 + 1] = (p[vA] + ov) / tv;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Converte UVs nativas (0..1) para tiles dado o tamanho real (metros) da direção U e V.
function scaleUV(geo, material, uLen, vLen, swap = false) {
  if (uvMode(material) === 'fit') return geo;
  const [tu, tv] = tileOf(material);
  const uv = geo.attributes.uv;
  const ou = uvRand() * 5;
  const ov = uvRand() * 5;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * uLen;
    const v = uv.getY(i) * vLen;
    if (swap) uv.setXY(i, (v + ou) / tu, (u + ov) / tv);
    else uv.setXY(i, (u + ou) / tu, (v + ov) / tv);
  }
  uv.needsUpdate = true;
  return geo;
}

/* ================================================================== */
/* Malhas                                                              */
/* ================================================================== */
export function tag(obj, part) {
  obj.traverse((o) => {
    if (o.isMesh) o.userData.part = part;
  });
  return obj;
}
function finishMesh(geo, material, part) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  const mm = Array.isArray(material) ? material[0] : material;
  m.userData.part = part || mm?.userData?.part || 'main';
  return m;
}
// Malha a partir de qualquer geometria; as UVs viram projeção em escala de mundo (a menos que keepUV).
export function mesh(geometry, material, { part, keepUV = false, grain } = {}) {
  let geo = geometry;
  if (!keepUV) {
    if (!grain) {
      geo.computeBoundingBox();
      const s = geo.boundingBox.getSize(new THREE.Vector3());
      grain = s.y > s.x && s.y > s.z ? 'y' : s.z > s.x ? 'z' : 'x';
    }
    geo = projectUV(geo, material, grain);
  }
  return finishMesh(geo, material, part);
}

// Caixa (r > 0 = cantos arredondados). Centrada na origem.
export function box(w, h, d, material, { r = 0, seg = 3, grain, part } = {}) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  const gr = grain || (h > w && h > d ? 'y' : d > w ? 'z' : 'x');
  return finishMesh(projectUV(geo, material, gr), material, part);
}

// Grade de caixa com coordenadas por eixo (para caixas macias com faces subdivididas)
function gridAxis(half, r, cs, fs) {
  const b = half - r;
  const out = [];
  for (let i = 0; i <= cs; i++) out.push(-half + (r * i) / cs);
  for (let i = 1; i < fs; i++) out.push(-b + (2 * b * i) / fs);
  for (let i = 0; i <= cs; i++) out.push(b + (r * i) / cs);
  return out;
}
function boxGrid(xs, ys, zs) {
  const pos = [];
  const idx = [];
  const face = (A, B, C, sa, sb, fixed, fixedAxis, aAxis, bAxis, flip) => {
    const base = pos.length / 3;
    for (let j = 0; j < B.length; j++) {
      for (let i = 0; i < A.length; i++) {
        const p = [0, 0, 0];
        p[aAxis] = A[i] * sa;
        p[bAxis] = B[j] * sb;
        p[fixedAxis] = fixed;
        pos.push(p[0], p[1], p[2]);
      }
    }
    const nA = A.length;
    for (let j = 0; j < B.length - 1; j++) {
      for (let i = 0; i < nA - 1; i++) {
        const a = base + j * nA + i;
        const b = a + 1;
        const c = a + nA;
        const d = c + 1;
        if (flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  };
  const X = xs[xs.length - 1];
  const Y = ys[ys.length - 1];
  const Z = zs[zs.length - 1];
  face(xs, ys, null, 1, 1, Z, 2, 0, 1, false); // frente +Z
  face(xs, ys, null, -1, 1, -Z, 2, 0, 1, false); // trás -Z
  face(zs, ys, null, -1, 1, X, 0, 2, 1, false); // +X
  face(zs, ys, null, 1, 1, -X, 0, 2, 1, false); // -X
  face(xs, zs, null, 1, -1, Y, 1, 0, 2, false); // topo +Y
  face(xs, zs, null, 1, 1, -Y, 1, 0, 2, false); // base -Y
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
// Geometria de caixa macia (arredondada + estufada), exatamente w x h x d.
export function softBoxGeometry(w, h, d, { r = 0.03, puff = 0.12, side = 0.25, step = 0.05, cs = 3 } = {}) {
  const pY = Math.max(0, puff);
  const pS = Math.max(0, puff * side);
  const ax = w / 2 / (1 + pS);
  const ay = h / 2 / (1 + pY);
  const az = d / 2 / (1 + pS);
  const rr = Math.max(0.002, Math.min(r, ax * 0.95, ay * 0.95, az * 0.95));
  const fs = (half) => clamp(Math.round((2 * (half - rr)) / step), 2, 20);
  const xs = gridAxis(ax, rr, cs, fs(ax));
  const ys = gridAxis(ay, rr, cs, fs(ay));
  const zs = gridAxis(az, rr, cs, fs(az));
  let g = boxGrid(xs, ys, zs);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const q = new THREE.Vector3();
  const bx = ax - rr;
  const by = ay - rr;
  const bz = az - rr;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.set(clamp(v.x, -bx, bx), clamp(v.y, -by, by), clamp(v.z, -bz, bz));
    const dir = v.clone().sub(q);
    if (dir.lengthSq() > 1e-12) v.copy(q).add(dir.normalize().multiplyScalar(rr));
    // estufamento: topo/base no centro e um pouco nas laterais
    const nx = clamp(v.x / ax, -1, 1);
    const ny = clamp(v.y / ay, -1, 1);
    const nz = clamp(v.z / az, -1, 1);
    const top = (1 - nx * nx) * (1 - nz * nz) * ny * ny;
    v.y += Math.sign(v.y) * ay * pY * top;
    const sx = (1 - ny * ny) * (1 - nz * nz) * nx * nx;
    const sz = (1 - ny * ny) * (1 - nx * nx) * nz * nz;
    v.x += Math.sign(v.x) * ax * pS * sx;
    v.z += Math.sign(v.z) * az * pS * sz;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}
// Almofada macia (assento, encosto, braço). puff = quanto estufa (0..0.4). Centrada na origem.
export function cushion(w, h, d, material, { puff = 0.14, r, side = 0.25, part, grain } = {}) {
  const rad = r ?? Math.min(h, w, d) * 0.32;
  const geo = softBoxGeometry(w, h, d, { r: rad, puff, side, step: Math.max(0.035, Math.min(w, d) / 14) });
  return finishMesh(projectUV(geo, material, grain || (w >= d ? 'x' : 'z')), material, part);
}

// Cilindro (eixo Y), centrado. Veio da madeira ao longo da altura.
export function cylinder(rTop, rBottom, h, material, { seg = 24, open = false, part, alongHeight = true } = {}) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
  if (uvMode(material) !== 'fit') {
    const circ = Math.PI * (rTop + rBottom);
    const uv = geo.attributes.uv;
    const [tu, tv] = tileOf(material);
    const ou = uvRand() * 5;
    const ov = uvRand() * 5;
    const sideCount = (seg + 1) * 2;
    const p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      if (i < sideCount) {
        const a = uv.getX(i) * circ;
        const b = uv.getY(i) * h;
        if (alongHeight) uv.setXY(i, (b + ou) / tu, (a + ov) / tv);
        else uv.setXY(i, (a + ou) / tu, (b + ov) / tv);
      } else {
        uv.setXY(i, (p.getX(i) + ou) / tu, (p.getZ(i) + ov) / tv);
      }
    }
  }
  return finishMesh(geo, material, part);
}
export function sphere(r, material, { seg = 24, part, scaleY = 1 } = {}) {
  const geo = new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1));
  if (scaleY !== 1) geo.scale(1, scaleY, 1);
  scaleUV(geo, material, 2 * Math.PI * r, Math.PI * r);
  return finishMesh(geo, material, part);
}
// Sólido de revolução: points [[raio, y], ...] de baixo para cima (metros).
export function lathe(points, material, { seg = 32, part } = {}) {
  const pts = points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const geo = new THREE.LatheGeometry(pts, seg);
  // raio médio ponderado pelo comprimento de cada trecho do perfil (as pontas com r≈0 das tampas
  // não puxam a média para baixo, o que esticava a trama em rolos e almofadas cilíndricas)
  let len = 0;
  let rw = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = pts[i].distanceTo(pts[i - 1]);
    len += l;
    rw += ((pts[i].x + pts[i - 1].x) / 2) * l;
  }
  const rAvg = len > 0 ? rw / len : pts[0]?.x || 0;
  // o LatheGeometry distribui v por índice do ponto; aqui v passa a ser o comprimento de arco do perfil
  if (len > 0 && pts.length > 2) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const uvA = geo.attributes.uv;
    for (let i = 0; i < uvA.count; i++) {
      const j = Math.round(uvA.getY(i) * (pts.length - 1));
      uvA.setY(i, cum[Math.min(pts.length - 1, Math.max(0, j))] / len);
    }
  }
  scaleUV(geo, material, 2 * Math.PI * rAvg, len, true);
  return finishMesh(geo, material, part);
}
// Tubo ao longo de pontos [[x,y,z],...] ou de uma THREE.Curve
export function tube(path, radius, material, { seg = 48, radial = 12, closed = false, part, smooth = true } = {}) {
  const curve = path.isCurve
    ? path
    : smooth
      ? new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.2)
      : polyCurve(path);
  const geo = new THREE.TubeGeometry(curve, seg, radius, radial, closed);
  scaleUV(geo, material, curve.getLength(), 2 * Math.PI * radius);
  return finishMesh(geo, material, part);
}
// Caminho poligonal com cantos arredondados (raio rc) — bom para estruturas tubulares
export function polyCurve(points, rc = 0.03) {
  const P = points.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath();
  let cur = P[0].clone();
  for (let i = 1; i < P.length; i++) {
    const a = P[i];
    if (i < P.length - 1) {
      const din = a.clone().sub(P[i - 1]).normalize();
      const dout = P[i + 1].clone().sub(a).normalize();
      const lin = Math.min(rc, a.distanceTo(P[i - 1]) / 2, a.distanceTo(P[i + 1]) / 2);
      const p1 = a.clone().addScaledVector(din, -lin);
      const p2 = a.clone().addScaledVector(dout, lin);
      if (p1.distanceTo(cur) > 1e-6) path.add(new THREE.LineCurve3(cur.clone(), p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, a.clone(), p2));
      cur = p2;
    } else if (a.distanceTo(cur) > 1e-6) path.add(new THREE.LineCurve3(cur.clone(), a.clone()));
  }
  return path;
}
// Retângulo arredondado (THREE.Shape) centrado na origem
export function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}
// Extrusão de um contorno 2D (XY) ao longo de +Z, centrada em Z. bevel em metros.
export function extrude(shape, depth, material, { bevel = 0, curveSegments = 16, part, bevelSegments = 3 } = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -(depth - 2 * bevel) / 2);
  // as UVs do ExtrudeGeometry já estão em metros
  if (uvMode(material) !== 'fit') {
    const [tu, tv] = tileOf(material);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tu, uv.getY(i) / tv);
  }
  return finishMesh(geo, material, part);
}

// Painel capitonê (chesterfield): frente (+Z) com losangos e botões. Exatamente w x h x d, centrado.
export function tufted(w, h, d, material, { rows = 3, cols, depth, button = 0.009, part, buttonMaterial } = {}) {
  const g = new THREE.Group();
  g.name = 'tufted';
  const relief = depth ?? Math.min(d * 0.45, 0.035);
  const nCols = cols ?? Math.max(2, Math.round(w / 0.16));
  const margin = Math.min(w, h) * 0.08;
  const dx = (w - 2 * margin) / nCols;
  const dy = (h - 2 * margin) / Math.max(1, rows);
  const btns = [];
  for (let r = 0; r <= rows; r++) {
    const odd = r % 2 === 1;
    for (let c = 0; c <= nCols; c++) {
      const x = -w / 2 + margin + c * dx + (odd ? dx / 2 : 0);
      if (odd && c === nCols) continue;
      btns.push([x, -h / 2 + margin + r * dy]);
    }
  }
  const body = box(w, h, d - relief, material, { r: Math.min(0.012, (d - relief) / 3), part });
  body.position.z = -relief / 2;
  g.add(body);
  const segX = clamp(Math.round(w / 0.014), 24, 160);
  const segY = clamp(Math.round(h / 0.014), 16, 120);
  const geo = new THREE.PlaneGeometry(w - 0.002, h - 0.002, segX, segY);
  const pos = geo.attributes.position;
  const R = Math.hypot(dx / 2, dy) * 0.62;
  const band = Math.min(margin * 0.9, 0.03);
  const segDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(px - ax - vx * t, py - ay - vy * t);
  };
  // vincos em diagonal entre botões vizinhos (pré-calculados)
  const segs = [];
  for (let i = 0; i < btns.length; i++) {
    for (let k = i + 1; k < btns.length; k++) {
      const [ax, ay] = btns[i];
      const [bx, by] = btns[k];
      if (Math.abs(ay - by) < 1e-6 || Math.abs(ay - by) > dy * 1.01 || Math.abs(ax - bx) > dx * 0.51) continue;
      segs.push([ax, ay, bx, by]);
    }
  }
  const hAt = (x, y) => {
    let db = 9;
    let dl = 9;
    for (const [bx, by] of btns) {
      if (Math.abs(x - bx) > db || Math.abs(y - by) > db) continue;
      const dd = Math.hypot(x - bx, y - by);
      if (dd < db) db = dd;
    }
    for (const [ax, ay, bx, by] of segs) {
      if (Math.abs(y - (ay + by) / 2) > dy) continue;
      dl = Math.min(dl, segDist(x, y, ax, ay, bx, by));
    }
    const puffy = Math.pow(smoothstep(0, R, db), 0.7);
    const crease = 0.55 + 0.45 * smoothstep(0, dx * 0.16, dl);
    const edge = smoothstep(0, band, Math.min(w / 2 - Math.abs(x), h / 2 - Math.abs(y)));
    return Math.min(puffy, crease) * edge;
  };
  for (let i = 0; i < pos.count; i++) pos.setZ(i, relief * hAt(pos.getX(i), pos.getY(i)));
  geo.computeVertexNormals();
  scaleUV(geo, material, w, h);
  const front = finishMesh(geo, material, part);
  front.position.z = d / 2 - relief;
  g.add(front);
  const bm = buttonMaterial || material;
  for (const [bx, by] of btns) {
    if (Math.abs(bx) > w / 2 - margin * 0.5 || Math.abs(by) > h / 2 - margin * 0.5) continue;
    const b = sphere(button, bm, { seg: 10, part: part || 'detail', scaleY: 1 });
    b.scale.z = 0.6;
    b.position.set(bx, by, d / 2 - relief + relief * hAt(bx, by) + button * 0.2);
    g.add(b);
  }
  return g;
}

// Pés: ocupam y de 0 a h; topo em (0, h, 0). splay = inclinação (rad) para a direção dir [sx, sz].
// tipos: 'palito' | 'tapered' | 'square' | 'turned' | 'metal_hairpin' | 'metal_square' | 'bun' | 'sled'
export function leg(type = 'palito', { h = 0.15, r = 0.018, material, splay, dir = [0, 0], len = 0.45, part } = {}) {
  const metalT = type.startsWith('metal') || type === 'sled';
  const m = material || (metalT ? mat.metal('#1f1f1f', { finish: 'painted' }) : mat.wood('#a87a4c'));
  const g = new THREE.Group();
  g.name = `leg:${type}`;
  const pivot = new THREE.Group();
  pivot.position.y = h;
  g.add(pivot);
  const sp = splay ?? (type === 'palito' ? 0.14 : 0);
  const dl = Math.hypot(dir[0], dir[1]);
  const tilt = dl > 0 && sp > 0 ? sp : 0;
  let piece;
  switch (type) {
    case 'tapered':
    case 'palito': {
      const rb = type === 'palito' ? r * 0.55 : r * 0.62;
      const L = (h - rb * Math.sin(tilt)) / Math.cos(tilt);
      if (type === 'palito') piece = cylinder(r, rb, L, m, { seg: 18, part });
      else {
        const geo = new THREE.CylinderGeometry(r * Math.SQRT2, rb * Math.SQRT2, L, 4, 1).toNonIndexed();
        geo.rotateY(Math.PI / 4);
        geo.computeVertexNormals();
        piece = mesh(geo, m, { part, grain: 'y' });
      }
      piece.position.y = -L / 2;
      break;
    }
    case 'square':
      piece = box(r * 2, h, r * 2, m, { r: Math.min(0.002, r / 4), part, grain: 'y' });
      piece.position.y = -h / 2;
      break;
    case 'turned': {
      const R = r;
      const prof = [
        [R * 0.62, 0], [R * 0.7, 0.04], [R * 0.6, 0.1], [R * 0.58, 0.3], [R * 0.95, 0.4], [R * 1.05, 0.46],
        [R * 0.95, 0.52], [R * 0.66, 0.6], [R * 0.7, 0.68], [R * 1.0, 0.74], [R * 1.0, 0.86], [R * 1.1, 0.9], [R * 1.1, 1.0], [0.0001, 1.0],
      ].map(([rr, y]) => [rr, y * h - h]);
      piece = lathe([[0.0001, -h], ...prof], m, { seg: 20, part });
      break;
    }
    case 'bun': {
      const R = Math.max(r, h * 0.6);
      const prof = [[0.0001, 0], [R * 0.7, 0], [R * 0.95, h * 0.2], [R, h * 0.45], [R * 0.9, h * 0.75], [R * 0.6, h * 0.95], [R * 0.55, h], [0.0001, h]].map(([rr, y]) => [rr, y - h]);
      piece = lathe(prof, m, { seg: 24, part });
      break;
    }
    case 'metal_square': {
      const s = Math.max(0.012, r);
      piece = box(s, h - 0.004, s, m, { part });
      piece.position.y = -(h - 0.004) / 2 - 0.004 / 2 + 0.002;
      const foot = box(s * 1.05, 0.004, s * 1.05, mat.rubber(), { part: 'detail' });
      foot.position.y = -h + 0.002;
      pivot.add(foot);
      break;
    }
    case 'metal_hairpin': {
      const rod = Math.min(r, 0.006);
      const spread = Math.max(0.05, h * 0.18);
      const path = [
        [-spread, -0.0, 0], [-spread * 0.55, -h * 0.5, 0], [-0.012, -h + 0.03, 0], [0, -h + rod, 0], [0.012, -h + 0.03, 0], [spread * 0.55, -h * 0.5, 0], [spread, 0, 0],
      ];
      piece = new THREE.Group();
      piece.add(tube(path, rod, m, { seg: 40, radial: 8, part }));
      const plate = box(spread * 2 + 0.03, 0.004, 0.05, m, { part });
      plate.position.y = -0.002;
      piece.add(plate);
      break;
    }
    case 'sled': {
      const rod = Math.max(0.006, Math.min(r, 0.012));
      const z = len / 2;
      const pts = [[0, -0.0, -z], [0, -h + rod, -z], [0, -h + rod, z], [0, 0, z]];
      piece = tube(polyCurve(pts, Math.min(0.04, h / 3)), rod, m, { seg: 64, radial: 10, part });
      break;
    }
    default:
      piece = cylinder(r, r, h, m, { part });
      piece.position.y = -h / 2;
  }
  pivot.add(piece);
  if (tilt) {
    const axis = new THREE.Vector3(0, -1, 0).cross(new THREE.Vector3(dir[0] / dl, 0, dir[1] / dl)).normalize();
    pivot.quaternion.setFromAxisAngle(axis, tilt);
  }
  return g;
}

// Puxadores: origem na superfície de fixação, saliente para +Z.
// tipos: 'bar' | 'knob' | 'cutout' | 'leather_strap'
export function handle(type = 'bar', { material, len = 0.12, size = 0.012, part = 'detail' } = {}) {
  const g = new THREE.Group();
  g.name = `handle:${type}`;
  if (type === 'knob') {
    const m = material || mat.metal('#b8a16a', { finish: 'brushed' });
    const k = lathe([[0.0001, 0], [size * 0.45, 0], [size * 0.4, size * 0.9], [size * 0.95, size * 1.4], [size, size * 1.8], [size * 0.7, size * 2.15], [0.0001, size * 2.2]], m, { seg: 20, part });
    k.rotation.x = Math.PI / 2;
    g.add(k);
  } else if (type === 'cutout') {
    const m = material || mat.flat('#1a1612', { roughness: 0.9 });
    const slot = box(len, size * 1.4, 0.004, m, { r: Math.min(size * 0.6, 0.0019), part });
    slot.position.z = 0.0005;
    g.add(slot);
  } else if (type === 'leather_strap') {
    const m = material || mat.fabric('#6b3f24', { kind: 'leather' });
    const L = len * 0.6;
    const strap = tube([[0, L / 2, 0.002], [0, L * 0.25, 0.018], [0, -L * 0.15, 0.022], [0, -L / 2, 0.004]], 0.0035, m, { seg: 20, radial: 8, part });
    strap.scale.x = 4;
    g.add(strap);
    for (const y of [L / 2 - 0.004]) {
      const rivet = cylinder(0.004, 0.004, 0.004, mat.metal('#b8a16a'), { seg: 12, part });
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(0, y, 0.006);
      g.add(rivet);
    }
  } else {
    const m = material || mat.metal('#c3c5c7', { finish: 'brushed' });
    const rod = size * 0.42;
    const stand = 0.022;
    const bar = cylinder(rod, rod, len, m, { seg: 14, part });
    bar.rotation.z = Math.PI / 2;
    bar.position.z = stand;
    g.add(bar);
    for (const x of [-len / 2 + rod * 2, len / 2 - rod * 2]) {
      const s = cylinder(rod * 0.85, rod * 0.85, stand, m, { seg: 10, part });
      s.rotation.x = Math.PI / 2;
      s.position.set(x, 0, stand / 2);
      g.add(s);
    }
  }
  return g;
}

/* ================================================================== */
/* Montagem                                                            */
/* ================================================================== */
// Posiciona/gira/escala e devolve o próprio objeto (encadeável).
export function place(obj, { x, y, z, rx, ry, rz, s } = {}) {
  if (x !== undefined) obj.position.x = x;
  if (y !== undefined) obj.position.y = y;
  if (z !== undefined) obj.position.z = z;
  if (rx !== undefined) obj.rotation.x = rx;
  if (ry !== undefined) obj.rotation.y = ry;
  if (rz !== undefined) obj.rotation.z = rz;
  if (s !== undefined) (typeof s === 'number' ? obj.scale.setScalar(s) : obj.scale.set(...s));
  return obj;
}
export function group(name = 'model', ...children) {
  const g = new THREE.Group();
  g.name = name;
  children.flat().forEach((c) => c && g.add(c));
  return g;
}
// Contagem de triângulos de um objeto
export function triangles(obj) {
  let t = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      t += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(t);
}
// Medida real (bounding box exata) do objeto
export function measure(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  return b;
}
// Sombras em todas as malhas, medida em cm e triângulos.
export function finalize(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      if (!o.userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      if (!o.userData.part) o.userData.part = 'main';
    }
  });
  const b = measure(group);
  const s = b.getSize(new THREE.Vector3());
  const r1 = (v) => Math.round(v * 1000) / 10;
  return { group, size: { w: r1(s.x), h: r1(s.y), d: r1(s.z) }, triangles: triangles(group), box: b };
}

// Troca as cores por parte sem reconstruir: recolor(grupo, { main: '#hex', wood: '#hex' })
export function recolor(obj, colors = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const c = colors[o.userData.part];
    const m = o.material;
    if (!c || !m?.userData?.type || !mat[m.userData.type]) return;
    const t = m.userData.type;
    if (t === 'glass') o.material = mat.glass({ ...m.userData.opts, tint: c });
    else if (t === 'screen') return;
    else o.material = mat[t](c, m.userData.opts);
  });
  return obj;
}

export const PARTS = ['main', 'accent', 'wood', 'metal', 'detail'];

// Cópia compacta para exportar (GLB/AR): geometrias indexadas (vértices iguais unidos).
// Os modelos gerados ficam sem índice por causa da projeção de UV por triângulo; isto reduz bem o arquivo.
export function compact(obj) {
  const copy = obj.clone(true);
  const done = new Map();
  copy.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (!done.has(g)) done.set(g, g.index ? g : mergeVertices(g, 1e-5));
    o.geometry = done.get(g);
  });
  return copy;
}

// Gera em segundo plano (tempo ocioso) as texturas mais comuns, para o primeiro 3D abrir mais rápido.
export function warmup(list = ['cotton', 'linen', 'velvet', 'leather', 'oak', 'smooth', 'mattress', 'brushed', 'peel']) {
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 30);
  const queue = [...list];
  const step = () => {
    const k = queue.shift();
    if (!k) return;
    try {
      if (k === 'oak' || k === 'rustic' || k === 'smooth') woodSet(k);
      else if (k === 'cane') caneSet();
      else TEXTURES[k]?.();
    } catch {
      /* ignora */
    }
    if (queue.length) idle(step);
  };
  idle(step);
}
