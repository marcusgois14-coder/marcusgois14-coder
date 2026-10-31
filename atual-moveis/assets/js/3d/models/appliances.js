// Geradores de eletro: TV, geladeira, lavadora, fogão, eletroportáteis, micro-ondas e ar-condicionado.
// Cada função recebe (spec, kit, THREE) e devolve um THREE.Group em metros, com o chão em y = 0,
// centrado em x/z e a frente virada para +Z. Tudo é montado na medida exata do spec (w x h x d).
// Usa só materiais e formas do kit; as poucas texturas próprias (imagem da tela, visores, serigrafias)
// são desenhadas uma vez em canvas e reaproveitadas.
//
// Estilos lidos de spec.style (todos opcionais; model3d.style do produto pode forçar qualquer um):
//   tv ............ screenIn, monitor, stand ('feet'|'pedestal'|'easel'|'wall'), wallMount, curved
//   geladeira ..... duplex, inverse, sideBySide, frenchDoor, frostFree, inox, retro/rounded, minibar,
//                   wine (adega), freezer ('chest' = horizontal | 'vertical'), smart, open ('left'|'right')
//   lavadora ...... frontLoad, topLoad, dryer, tanquinho, inox
//   fogão ......... burners, oven, cooktop, electric, induction, glass (mesa de vidro), inox, drawer
//   eletroportátil  appliance: coffee_maker | blender | air_fryer | kettle | toaster | mixer | fan |
//                   microwave | food_processor | juicer | rice_cooker | pressure_cooker | popcorn |
//                   sandwich_maker | water_purifier | heater | speaker | iron | vacuum | hair_dryer |
//                   hair_straightener | phone | tablet | laptop | console | generic; retro, inox, ceiling
//   micro-ondas ... electricOven (forno elétrico), builtIn, inox
//   ar-condicionado portable (portátil/climatizador); senão split de parede

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI;

function ctx(spec, kit, THREE) {
  const st = spec.style || {};
  const C = { main: '#f2f2f2', accent: '#1d1d1d', wood: '#a87a4c', metal: '#c3c5c7', ...(spec.colors || {}) };
  return { spec, st, C, kit, THREE, m: kit.mat, W: kit.cm(spec.w), H: kit.cm(spec.h), D: kit.cm(spec.d), place: kit.place };
}

// Cor "inox": cinza claro sem saturação
function steelColor(kit, hex) {
  const hsl = kit.colorOf(hex).getHSL({ h: 0, s: 0, l: 0 });
  const L = kit.luminance(hex);
  return hsl.s < 0.14 && L > 0.42 && L < 0.94;
}
const isDark = (kit, hex) => kit.luminance(hex) < 0.22;

// Acabamento do corpo: inox escovado, plástico ou esmalte (pintura brilhante)
function bodyFinish(c, { gloss = 0.75 } = {}) {
  const { spec, st, C, m, kit } = c;
  const steelish = spec.material === 'steel' || st.inox;
  if (steelish && steelColor(kit, C.main)) return { mat: m.metal(C.main, { finish: 'brushed' }), steel: true };
  if (spec.material === 'plastic') return { mat: m.plastic(C.main, { gloss: Math.min(gloss, 0.6) }), steel: false };
  return { mat: m.paint(C.main, { gloss }), steel: false };
}
const chromeOf = (c) => c.m.metal('#e4e6e8', { finish: 'chrome' });
const brushedOf = (c, hex = '#c6c8ca') => c.m.metal(hex, { finish: 'brushed' });
const blackGloss = (c) => c.m.plastic('#111213', { gloss: 0.75 });
const blackMatte = (c) => c.m.plastic('#18191a', { gloss: 0.25 });
const shadowOf = (c) => c.m.flat('#0e0f10', { roughness: 0.9 });
const rubberOf = (c) => c.m.rubber('#1b1b1b');

// Contorno retangular (frente) com raio próprio por canto [sup.esq, sup.dir, inf.dir, inf.esq]
function rrShape(THREE, w, h, radii = [0, 0, 0, 0]) {
  const lim = Math.min(w, h) / 2 - 1e-4;
  const [tl, tr, br, bl] = radii.map((r) => clamp(r || 0, 0, lim));
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const s = new THREE.Shape();
  // cada arco se liga sozinho ao ponto anterior (sem pontos repetidos, que estragam o chanfro)
  s.moveTo(0, y0);
  if (br > 1e-4) s.absarc(x1 - br, y0 + br, br, -PI / 2, 0, false);
  else s.lineTo(x1, y0);
  if (tr > 1e-4) s.absarc(x1 - tr, y1 - tr, tr, 0, PI / 2, false);
  else s.lineTo(x1, y1);
  if (tl > 1e-4) s.absarc(x0 + tl, y1 - tl, tl, PI / 2, PI, false);
  else s.lineTo(x0, y1);
  if (bl > 1e-4) s.absarc(x0 + bl, y0 + bl, bl, PI, 1.5 * PI, false);
  else s.lineTo(x0, y0);
  return s;
}
// Placa extrudada (vista de frente com cantos arredondados, bordas chanfradas). Exatamente w x h x d, centrada.
function slab(c, w, h, d, material, { radii = [0, 0, 0, 0], r, bevel = 0.003, part, seg = 8 } = {}) {
  const rad = r != null ? [r, r, r, r] : radii;
  const b = Math.max(0, Math.min(bevel, d / 2 - 2e-4, w / 4, h / 4));
  const shape = rrShape(c.THREE, w - 2 * b, h - 2 * b, rad.map((x) => Math.max(0, x - b)));
  return c.kit.extrude(shape, d, material, { bevel: b, part, curveSegments: seg, bevelSegments: b > 0.006 ? 4 : 2 });
}

// Sólido por seções superelípticas empilhadas (de baixo para cima).
// rings: [[y, a, b, dz?, dx?, n?], ...] com a/b = meia largura (x) e meia profundidade (z), em metros.
// n: 2 = elipse, 4 = quadrado arredondado, 8 = quase reto.
function loft(c, rings, material, { n = 4, seg = 48, capTop = true, capBottom = true, part } = {}) {
  const THREE = c.THREE;
  const M = Math.max(8, seg - (seg % 4));
  const P = [];
  const I = [];
  const pushRing = ([y, a, b, dz = 0, dx = 0, nn = n]) => {
    const e = 2 / nn;
    for (let i = 0; i < M; i++) {
      const t = (i / M) * PI * 2;
      const ct = Math.cos(t);
      const sn = Math.sin(t);
      P.push(dx + Math.sign(ct) * Math.pow(Math.abs(ct), e) * a, y, dz + Math.sign(sn) * Math.pow(Math.abs(sn), e) * b);
    }
  };
  rings.forEach(pushRing);
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < M; i++) {
      const a = j * M + i;
      const b = j * M + ((i + 1) % M);
      const cc = (j + 1) * M + i;
      const d = (j + 1) * M + ((i + 1) % M);
      I.push(a, cc, b, b, cc, d);
    }
  }
  const cap = (ringIdx, top) => {
    const base = P.length / 3;
    pushRing(rings[ringIdx]);
    const [y, , , dz = 0, dx = 0] = rings[ringIdx];
    P.push(dx, y, dz);
    const ctr = base + M;
    for (let i = 0; i < M; i++) {
      const a = base + i;
      const b = base + ((i + 1) % M);
      if (top) I.push(ctr, b, a);
      else I.push(ctr, a, b);
    }
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rings.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return c.kit.mesh(geo, material, { part });
}
// z da borda de uma superelipse (meia largura a, meia profundidade b) na posição x
const superZ = (x, a, b, n = 4) => b * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / a), n)), 1 / n);

// Peça de revolução deitada (eixo para +Z): pts [[raio, z], ...] de trás para a frente
function disc(c, pts, material, { seg = 40, part } = {}) {
  const me = c.kit.lathe(pts, material, { seg, part });
  me.rotation.x = PI / 2;
  return me;
}

// Malha plana com UV 0..1 (imagens, visores, serigrafias); não faz sombra
function decal(c, w, h, material, { part = 'detail' } = {}) {
  const me = c.kit.mesh(new c.THREE.PlaneGeometry(w, h), material, { keepUV: true, part });
  me.castShadow = false;
  me.userData.noShadow = true;
  return me;
}

/* ---------- texturas desenhadas em canvas (criadas uma vez) ---------- */
const CANVAS_MATS = new Map();
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return cv;
  }
  return new OffscreenCanvas(w, h);
}
function canvasMat(c, key, w, h, draw, { emissive = 0, transparent = false, roughness = 0.5, metalness = 0, color } = {}) {
  if (CANVAS_MATS.has(key)) return CANVAS_MATS.get(key);
  const THREE = c.THREE;
  const cv = makeCanvas(w, h);
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const p = { map: tex, roughness, metalness };
  if (color) p.color = new THREE.Color(color);
  if (emissive) {
    p.emissive = new THREE.Color(0xffffff);
    p.emissiveMap = tex;
    p.emissiveIntensity = emissive;
  }
  if (transparent) {
    p.transparent = true;
    p.depthWrite = false;
  }
  const mt = new THREE.MeshStandardMaterial(p);
  mt.name = `eletro:${key}`;
  mt.userData = { part: 'detail', uv: 'fit', tile: [1, 1] };
  CANVAS_MATS.set(key, mt);
  return mt;
}

// Imagem da TV ligada: paisagem ao entardecer (montanhas, lago e pinheiros)
function drawPicture(g, w, h) {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.66);
  sky.addColorStop(0, '#13305e');
  sky.addColorStop(0.42, '#3f6aa6');
  sky.addColorStop(0.78, '#e39a66');
  sky.addColorStop(1, '#f7cf8f');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const glow = (x, y, r, stops) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, col]) => rg.addColorStop(o, col));
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  };
  const sx = w * 0.64;
  const sy = h * 0.6;
  glow(sx, sy, h * 0.75, [[0, 'rgba(255,240,200,1)'], [0.05, 'rgba(255,224,160,0.95)'], [0.18, 'rgba(255,180,110,0.45)'], [1, 'rgba(255,150,90,0)']]);
  // nuvens finas
  g.globalAlpha = 0.35;
  for (const [x, y, rw, rh] of [[0.2, 0.18, 0.22, 0.025], [0.42, 0.26, 0.3, 0.02], [0.78, 0.15, 0.2, 0.022], [0.62, 0.34, 0.25, 0.015]]) {
    const cg = g.createLinearGradient(0, h * (y - rh), 0, h * (y + rh));
    cg.addColorStop(0, 'rgba(255,214,190,0)');
    cg.addColorStop(0.5, 'rgba(255,205,180,1)');
    cg.addColorStop(1, 'rgba(255,214,190,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(w * x, h * y, w * rw, h * rh, 0, 0, PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const ridge = (base, amp, f, s) => (x) => base - amp * (0.55 * Math.sin(x * f + s) + 0.3 * Math.sin(x * f * 2.3 + s * 1.7) + 0.15 * Math.sin(x * f * 5.1 + s * 0.3) + 0.06 * Math.sin(x * f * 13 + s));
  const layer = (fn, top, bottom) => {
    const lg = g.createLinearGradient(0, h * 0.35, 0, h * 0.68);
    lg.addColorStop(0, top);
    lg.addColorStop(1, bottom);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 3) g.lineTo(x, fn(x / w));
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = lg;
    g.fill();
  };
  layer(ridge(h * 0.5, h * 0.13, 6.5, 1.3), '#9a95bf', '#c6a4a8');
  layer(ridge(h * 0.57, h * 0.09, 10.5, 4.1), '#5f6896', '#7b789c');
  layer(ridge(h * 0.63, h * 0.05, 17, 2.2), '#2d3a5e', '#3b4568');
  // lago com reflexo
  const ly = h * 0.665;
  const lake = g.createLinearGradient(0, ly, 0, h);
  lake.addColorStop(0, '#e8ad7d');
  lake.addColorStop(0.25, '#8e8fb2');
  lake.addColorStop(1, '#1b2846');
  g.fillStyle = lake;
  g.fillRect(0, ly, w, h - ly);
  const refl = g.createLinearGradient(0, ly, 0, h);
  refl.addColorStop(0, 'rgba(255,220,170,0.75)');
  refl.addColorStop(1, 'rgba(255,200,150,0)');
  g.fillStyle = refl;
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const y = ly + (h - ly) * t ** 1.3;
    const ww = w * (0.02 + 0.09 * (1 - t)) * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.7)));
    g.fillRect(sx - ww / 2 + w * 0.01 * Math.sin(i * 1.3), y, ww, Math.max(1, h * 0.0035));
  }
  // margem com pinheiros em primeiro plano (canto inferior esquerdo)
  const bank = (x) => h * (0.8 + 0.2 * (x / (w * 0.3)) ** 1.6);
  const bg = g.createLinearGradient(0, h * 0.75, 0, h);
  bg.addColorStop(0, '#1c2b2a');
  bg.addColorStop(1, '#0d1514');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w * 0.3; x += 2) g.lineTo(x, bank(x));
  g.lineTo(w * 0.3, h);
  g.closePath();
  g.fill();
  g.fillStyle = '#132120';
  for (let i = 0; i < 11; i++) {
    const tx = w * (0.012 + i * 0.022 + 0.006 * Math.sin(i * 5.3));
    const th = h * (0.07 + 0.06 * Math.abs(Math.sin(i * 1.9))) * (1 - i / 16);
    const base = bank(tx) + h * 0.008;
    g.beginPath();
    g.moveTo(tx, base - th);
    for (let k = 1; k <= 4; k++) {
      const yy = base - th + (th * k) / 4;
      const ww = (th * 0.2 * k) / 4 + th * 0.03;
      g.lineTo(tx + ww, yy);
      g.lineTo(tx + ww * 0.45, yy);
    }
    for (let k = 4; k >= 1; k--) {
      const yy = base - th + (th * k) / 4;
      const ww = (th * 0.2 * k) / 4 + th * 0.03;
      g.lineTo(tx - ww * 0.45, yy);
      g.lineTo(tx - ww, yy);
    }
    g.closePath();
    g.fill();
  }
  // leve vinheta
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
}
const pictureMat = (c, portrait = false) =>
  portrait
    ? canvasMat(c, 'tela-retrato', 576, 1024, drawPicture, { emissive: 0.85, roughness: 0.22, color: '#3a3a3a' })
    : canvasMat(c, 'tela', 1024, 576, drawPicture, { emissive: 0.85, roughness: 0.22, color: '#3a3a3a' });

// Visor digital (texto aceso sobre fundo preto)
function displayMat(c, text, color = '#5fd1ff', { w = 256, h = 96 } = {}) {
  return canvasMat(
    c,
    `visor:${text}:${color}:${w}x${h}`,
    w,
    h,
    (g) => {
      g.fillStyle = '#050607';
      g.fillRect(0, 0, w, h);
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = h * 0.08;
      g.font = `bold ${Math.round(h * 0.62)}px "DejaVu Sans Mono", "Courier New", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h * 0.54);
    },
    { emissive: 1, roughness: 0.25 }
  );
}
// Serigrafia: linhas finas de "texto" (painel da lavadora), transparente
function printMat(c, key, w, h, draw, color = 'rgba(70,74,80,0.9)') {
  return canvasMat(
    c,
    `serigrafia:${key}:${color}`,
    w,
    h,
    (g) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      g.strokeStyle = color;
      draw(g, w, h);
    },
    { transparent: true, roughness: 0.6 }
  );
}

// Puxador de barra: origem na superfície de fixação, saliente até exatamente "depth" em +Z.
function barHandle(c, len, depth, { material, horizontal = false, rod } = {}) {
  const { kit, THREE } = c;
  const g = kit.group('puxador');
  const rr = rod ?? clamp(depth * 0.26, 0.0045, 0.011);
  const mt = material || chromeOf(c);
  const bar = kit.mesh(new THREE.CapsuleGeometry(rr, Math.max(0.001, len - 2 * rr), 4, 14), mt, { part: 'metal' });
  bar.position.z = depth - rr;
  g.add(bar);
  const ph = depth - rr;
  for (const s of [-1, 1]) {
    const p = kit.cylinder(rr * 0.78, rr * 0.92, ph, mt, { seg: 12, part: 'metal' });
    p.rotation.x = PI / 2;
    p.position.set(0, s * (len / 2 - rr * 2.4), ph / 2);
    g.add(p);
  }
  if (horizontal) g.rotation.z = PI / 2;
  return g;
}
// Puxador retrô cromado (barra achatada com apoios curvos), horizontal; saliente até "depth"
function retroHandle(c, len, depth) {
  const { kit } = c;
  const g = kit.group('puxador-retro');
  const ch = chromeOf(c);
  const t = Math.min(0.016, depth * 0.4);
  const hh = 0.028;
  g.add(c.place(kit.box(len, hh, t, ch, { r: t * 0.45, seg: 3, part: 'metal' }), { z: depth - t / 2 }));
  // apoios: pequenas peças arredondadas inclinadas nas pontas
  for (const s of [-1, 1]) {
    const post = kit.box(0.03, hh * 0.85, depth - t * 0.6, ch, { r: 0.006, seg: 3, part: 'metal' });
    g.add(c.place(post, { x: s * (len / 2 - 0.02), z: (depth - t * 0.6) / 2, ry: s * 0.18 }));
  }
  // frisos escuros na face (detalhe do puxador)
  g.add(c.place(kit.box(len * 0.55, 0.0025, 0.001, c.m.flat('#7d8084', { roughness: 0.3, metalness: 1 })), { y: hh * 0.18, z: depth + 0.0003 }));
  return g;
}

// Botão giratório (knob) virado para +Z: base na superfície, saliente "depth"
function knob(c, r, depth, { material, ring = true, pointer = true } = {}) {
  const { kit } = c;
  const g = kit.group('botao');
  const mt = material || blackMatte(c);
  g.add(disc(c, [[0.0001, 0], [r, 0], [r, depth * 0.85], [r * 0.92, depth], [0.0001, depth]], mt, { seg: 28, part: 'detail' }));
  if (ring) g.add(disc(c, [[0.0001, 0], [r * 1.18, 0], [r * 1.18, depth * 0.18], [r * 1.05, depth * 0.24], [0.0001, depth * 0.24]], chromeOf(c), { seg: 28, part: 'metal' }));
  if (pointer) g.add(c.place(kit.box(r * 0.22, r * 1.3, depth * 0.3, c.m.flat('#d9dadb', { roughness: 0.4 })), { y: r * 0.2, z: depth * 0.9 }));
  return g;
}
// Pezinhos cilíndricos (4) dentro da área w x d, altura h
function feet4(c, g, w, d, h, { r = 0.012, inset = 0.03, z = 0, material } = {}) {
  const mt = material || rubberOf(c);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(c.place(c.kit.cylinder(r, r * 1.05, h, mt, { seg: 14, part: 'detail' }), { x: sx * (w / 2 - inset), y: h / 2, z: z + sz * (d / 2 - inset) }));
  }
}

/* ================================================================== */
/* TV                                                                  */
/* ================================================================== */
function tvModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, C, W, H, D, m, place } = c;
  const g = kit.group('tv');
  const monitor = !!st.monitor;
  let stand = st.stand || (st.wallMount && !monitor ? 'wall' : monitor || W < 0.7 ? 'pedestal' : 'feet');
  // moldura fina; tela 16:9
  const bz = clamp(W * 0.005, 0.004, 0.01);
  const bzB = bz * (monitor ? 2.2 : 1.7);
  const screenW = W - 2 * bz;
  let panelH = (screenW * 9) / 16 + bz + bzB;
  let standH = H - panelH;
  if (stand === 'wall') {
    panelH = H;
    standH = 0;
  } else if (standH < 0.012) {
    standH = clamp(H * 0.08, 0.008, 0.015);
    panelH = H - standH;
  }
  if (stand !== 'wall' && standH > 0.35) stand = 'easel';
  else if (stand === 'feet' && standH > 0.14) stand = 'pedestal';
  const screenH = panelH - bz - bzB;
  // espessuras: painel ultrafino + caixa de eletrônica atrás (metade de baixo)
  const tF = clamp(W * 0.005, 0.004, 0.008);
  let tB = clamp(D * 0.4, 0.012, monitor ? 0.045 : 0.05);
  if (stand === 'wall') tB = Math.max(0.004, D - tF);
  tB = Math.min(tB, Math.max(0.003, D - tF));
  const T = tF + tB;
  const zF = T / 2; // frente da tela
  const y0 = standH;
  const frame = m.plastic(C.main || '#141414', { gloss: 0.35 });
  const back = m.plastic(kit.shade(C.main || '#141414', 0.06), { gloss: 0.15 });
  const edge = m.metal(isDark(kit, C.main) ? '#3a3b3d' : kit.shade(C.main, -0.1), { finish: 'brushed' });
  // painel (moldura) e borda metálica fina
  g.add(place(kit.box(W, panelH, tF, frame, { r: Math.min(0.003, tF / 2.2), part: 'main' }), { y: y0 + panelH / 2, z: zF - tF / 2 }));
  g.add(place(kit.box(W - 0.002, panelH - 0.002, tF * 0.5, edge, { r: 0.001, part: 'metal' }), { y: y0 + panelH / 2, z: zF - tF * 0.7 }));
  // tela com imagem
  const scr = decal(c, screenW, screenH, pictureMat(c));
  g.add(place(scr, { y: y0 + bzB + screenH / 2, z: zF + 0.0006 }));
  // logotipo discreto e LED na moldura de baixo
  g.add(place(kit.box(Math.min(0.05, W * 0.05), bzB * 0.28, 0.0008, m.metal('#bfc2c5', { finish: 'brushed' })), { y: y0 + bzB * 0.5, z: zF + 0.0004 }));
  g.add(place(kit.box(0.003, 0.0018, 0.0008, m.flat('#ff3b30', { emissive: '#ff2a1f' })), { x: W * 0.42, y: y0 + bzB * 0.4, z: zF + 0.0004 }));
  // caixa traseira (eletrônica) com cantos arredondados e saídas de ar
  const bw = W * (monitor ? 0.5 : 0.76);
  const bh = panelH * (stand === 'wall' ? 0.7 : 0.62);
  const zb = zF - tF - tB / 2;
  if (tB > 0.004) {
    g.add(place(kit.box(bw, bh, tB, back, { r: Math.min(0.012, tB / 2.2), part: 'main' }), { y: y0 + bh / 2 + (stand === 'wall' ? panelH * 0.15 : 0), z: zb }));
    for (let i = 0; i < 6; i++) g.add(place(kit.box(bw * 0.5, 0.004, 0.001, shadowOf(c)), { y: y0 + bh * (0.62 + i * 0.05), z: zb - tB / 2 - 0.0004 }));
  }
  const zBackMin = zF - T;
  const zBackMax = zF - tF; // faixa da caixa traseira (onde os pés se prendem)
  const footMat = m.metal(C.metal || '#2a2a2a', { finish: 'brushed' });

  if (stand === 'feet') {
    // pés em lâmina (perfil em arco), nas pontas, presos na caixa traseira
    const fbev = 0.0015;
    const L = D / 2 - fbev;
    const ins = Math.min(0.04, bh * 0.4);
    const za = Math.max(zBackMin + 0.001, zb - Math.min(0.012, tB / 2));
    const zbm = Math.min(zBackMax - 0.001, zb + Math.min(0.012, tB / 2));
    const hh = standH - fbev;
    const y0f = fbev;
    const s = new THREE.Shape();
    s.moveTo(-L, y0f);
    s.lineTo(L, y0f);
    s.lineTo(L, y0f + Math.min(0.005, hh * 0.4));
    s.quadraticCurveTo(zbm + (L - zbm) * 0.25, hh * 0.9, zbm, hh);
    s.lineTo(zbm, hh + ins);
    s.lineTo(za, hh + ins);
    s.lineTo(za, hh);
    s.quadraticCurveTo(za - (L + za) * 0.25, hh * 0.9, -L, y0f + Math.min(0.005, hh * 0.4));
    const fw = clamp(W * 0.012, 0.008, 0.016);
    for (const sx of [-1, 1]) {
      const f = kit.extrude(s, fw, footMat, { bevel: fbev, curveSegments: 10, part: 'metal' });
      f.rotation.y = -PI / 2;
      f.position.set(sx * Math.min(bw / 2 - fw, W * 0.36), 0, 0);
      g.add(f);
    }
  } else if (stand === 'pedestal') {
    // base retangular e pescoço central
    const baseW = Math.min(W * (monitor ? 0.42 : 0.34), 0.5);
    const baseT = Math.min(0.014, standH * 0.4);
    g.add(place(slab(c, baseW, D, baseT, footMat, { r: Math.min(0.03, D * 0.25), bevel: baseT * 0.35, part: 'metal' }), { y: baseT / 2, rx: -PI / 2 }));
    const nh = standH + Math.min(bh * 0.5, 0.12) - baseT;
    const nw = Math.min(0.07, W * 0.08);
    const nd = Math.max(0.006, Math.min(0.022, tB * 0.8));
    g.add(place(kit.box(nw, nh, nd, footMat, { r: Math.min(0.004, nd / 2.2), part: 'metal' }), { y: baseT + nh / 2, z: Math.max(-D / 2 + nd / 2, zb - tB / 2 - nd / 2 + 0.002) }));
  } else if (stand === 'easel') {
    // cavalete com 4 pés de madeira (como na foto de ambiente)
    const wood = m.wood(C.wood || '#a0663b', { grain: 'smooth' });
    const top = standH + panelH * 0.25;
    const legs = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const bottom = new THREE.Vector3(sx * (W / 2 - 0.02), 0.006, sz * (D / 2 - 0.018));
        const tp = new THREE.Vector3(sx * (W / 2 - 0.04), top, sz * 0.012 + zb * 0.5);
        legs.push([bottom, tp]);
      }
    }
    for (const [a, b] of legs) {
      const len = a.distanceTo(b);
      const leg = kit.cylinder(0.013, 0.017, len, wood, { seg: 14, part: 'wood' });
      leg.position.copy(a).add(b).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(leg);
    }
    g.add(place(kit.box(W - 0.09, 0.03, 0.018, wood, { r: 0.004, part: 'wood' }), { y: standH - 0.02, z: zb }));
  } else {
    // parede: suporte fino atrás
    g.add(place(kit.box(Math.min(0.3, W * 0.3), Math.min(0.2, panelH * 0.3), Math.max(0.002, Math.min(0.01, D - T)), footMat), { y: panelH * 0.55, z: zBackMin - Math.max(0.002, Math.min(0.01, D - T)) / 2 }));
  }
  return g;
}

/* ================================================================== */
/* Geladeira / freezer / frigobar / adega                              */
/* ================================================================== */
function fridgeModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st } = c;
  if (st.freezer === 'chest') return chestFreezer(c);
  if (st.wine) return wineCooler(c);
  return uprightFridge(c);
}

function uprightFridge(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('geladeira');
  const small = !!st.minibar || H < 1.05;
  const retro = !!(st.retro || st.rounded);
  const fin = bodyFinish(c, { gloss: retro ? 0.85 : 0.6 });
  const body = fin.mat;
  const chrome = chromeOf(c);
  const handleMat = fin.steel ? brushedOf(c, kit.shade(C.main, 0.08)) : retro ? chrome : isDark(kit, C.main) ? brushedOf(c, '#9a9da0') : brushedOf(c, '#c9cbcd');
  const plinth = clamp(H * (retro ? 0.02 : 0.026), 0.02, 0.05);
  const handleP = retro ? 0.042 : small ? 0.022 : 0.036;
  const doorT = clamp(D * 0.075, 0.032, 0.058);
  const bodyD = D - doorT - handleP;
  const zBack = -D / 2;
  const zBodyF = zBack + bodyD;
  const zDoorF = zBodyF + doorT;
  const rTop = retro ? clamp(W * 0.14, 0.035, 0.1) : 0.008;
  const rBot = retro ? 0.03 : 0.008;
  const rMid = retro ? 0.022 : 0.006;
  // corpo
  const bodyH = H - plinth;
  if (retro) g.add(place(slab(c, W, bodyH, bodyD, body, { radii: [rTop, rTop, rBot, rBot], bevel: 0.022, seg: 12, part: 'main' }), { y: plinth + bodyH / 2, z: zBack + bodyD / 2 }));
  else g.add(place(kit.box(W, bodyH, bodyD, body, { r: 0.008, part: 'main' }), { y: plinth + bodyH / 2, z: zBack + bodyD / 2 }));
  // rodapé com grade escura e pés
  g.add(place(kit.box(W - 0.05, plinth, bodyD - 0.06, shadowOf(c)), { y: plinth / 2, z: zBack + (bodyD - 0.06) / 2 + 0.01 }));
  const grill = kit.box(W - (retro ? 0.12 : 0.06), plinth * 0.7, 0.008, m.plastic('#1c1d1f', { gloss: 0.2 }), { r: 0.002 });
  g.add(place(grill, { y: plinth * 0.5, z: zBodyF - 0.02 }));
  for (let i = 0; i < 3; i++) g.add(place(kit.box(W - (retro ? 0.14 : 0.08), 0.002, 0.002, m.flat('#050505')), { y: plinth * (0.3 + i * 0.2), z: zBodyF - 0.0155 }));
  for (const sx of [-1, 1]) {
    const foot = kit.cylinder(0.012, 0.014, plinth, retro ? chrome : rubberOf(c), { seg: 16, part: retro ? 'metal' : 'detail' });
    g.add(place(foot, { x: sx * (W / 2 - 0.045), y: plinth / 2, z: zBodyF - 0.03 }));
  }

  // portas
  const y0 = plinth + 0.012;
  const y1 = H - 0.004;
  const gap = 0.005;
  const open = st.open === 'right' ? 'right' : 'left'; // lado do puxador (dobradiça do outro lado)
  const sideX = (x0, x1, side) => (side === 'left' ? x0 : x1);
  const doors = [];
  if (st.sideBySide) {
    const xs = -W / 2 + W * 0.46;
    doors.push({ x0: -W / 2, x1: xs, y0, y1, role: 'freezer', side: 'right', vertical: true, disp: true });
    doors.push({ x0: xs, x1: W / 2, y0, y1, role: 'fridge', side: 'left', vertical: true });
  } else if (st.frenchDoor) {
    const ys = y0 + (y1 - y0) * 0.3;
    doors.push({ x0: -W / 2, x1: 0, y0: ys, y1, role: 'fridge', side: 'right', vertical: true, disp: true });
    doors.push({ x0: 0, x1: W / 2, y0: ys, y1, role: 'fridge', side: 'left', vertical: true });
    doors.push({ x0: -W / 2, x1: W / 2, y0, y1: ys, role: 'drawer' });
  } else if (!small && (st.duplex || st.inverse) && st.doors !== 1) {
    if (st.inverse) {
      const ys = y0 + (y1 - y0) * 0.32;
      doors.push({ x0: -W / 2, x1: W / 2, y0: ys, y1, role: 'fridge', side: open, near: 'bottom', disp: true, logo: true });
      doors.push({ x0: -W / 2, x1: W / 2, y0, y1: ys, role: retro ? 'freezer' : 'drawer', side: open, near: 'top' });
    } else {
      const ys = y1 - (y1 - y0) * (retro ? 0.3 : 0.29);
      doors.push({ x0: -W / 2, x1: W / 2, y0: ys, y1, role: 'freezer', side: open, near: 'bottom', logo: true });
      doors.push({ x0: -W / 2, x1: W / 2, y0, y1: ys, role: 'fridge', side: open, near: 'top', disp: true });
    }
  } else {
    doors.push({ x0: -W / 2, x1: W / 2, y0, y1, role: 'fridge', side: open, near: 'mid', logo: true, disp: true });
  }
  const topY = Math.max(...doors.map((d) => d.y1));
  const botY = Math.min(...doors.map((d) => d.y0));
  const zDoor = (zBodyF + 0.004 + zDoorF) / 2;
  const doorSlabT = doorT - 0.004;
  doors.forEach((d) => {
    const w = d.x1 - d.x0 - gap;
    const h = d.y1 - d.y0 - gap;
    const cx = (d.x0 + d.x1) / 2;
    const cy = (d.y0 + d.y1) / 2;
    const atTop = d.y1 >= topY - 1e-6;
    const atBot = d.y0 <= botY + 1e-6;
    const L = d.x0 <= -W / 2 + 1e-6;
    const R = d.x1 >= W / 2 - 1e-6;
    const radii = [atTop && L ? rTop : rMid, atTop && R ? rTop : rMid, atBot && R ? rBot : rMid, atBot && L ? rBot : rMid];
    g.add(place(slab(c, w, h, doorSlabT, body, { radii, bevel: retro ? 0.017 : 0.004, seg: 12, part: 'main' }), { x: cx, y: cy, z: zDoor }));
    // borracha de vedação (aparece nas frestas)
    g.add(place(slab(c, w - 0.02, h - 0.02, 0.006, m.rubber('#2a2b2c'), { radii: radii.map((r) => Math.max(0, r - 0.01)), bevel: 0 }), { x: cx, y: cy, z: zBodyF + 0.003 }));
    // puxadores
    if (d.role === 'drawer') {
      const len = Math.min(W * 0.62, 0.55);
      g.add(place(barHandle(c, len, handleP, { material: handleMat, horizontal: true }), { x: cx, y: d.y1 - 0.06, z: zDoorF }));
    } else if (retro && !d.vertical) {
      const len = clamp(W * 0.37, 0.12, 0.26);
      const edge = sideX(d.x0, d.x1, d.side);
      const hx = d.side === 'left' ? edge + 0.05 + len / 2 : edge - 0.05 - len / 2;
      const hy = d.near === 'bottom' ? d.y0 + 0.075 : d.near === 'top' ? d.y1 - 0.09 : d.y0 + h * 0.6;
      g.add(place(retroHandle(c, len, handleP), { x: hx, y: hy, z: zDoorF }));
    } else {
      const len = d.vertical ? clamp(h * 0.5, 0.2, 0.75) : clamp(h * (d.role === 'freezer' ? 0.45 : 0.35), 0.12, small ? 0.22 : 0.42);
      const hx = d.side === 'left' ? d.x0 + 0.038 : d.x1 - 0.038;
      let hy;
      if (d.vertical) hy = d.y0 + h * 0.58;
      else if (d.near === 'bottom') hy = d.y0 + len / 2 + 0.06;
      else if (d.near === 'top') hy = d.y1 - len / 2 - 0.06;
      else hy = d.y0 + h * 0.62;
      g.add(place(barHandle(c, len, handleP, { material: handleMat }), { x: hx, y: hy, z: zDoorF }));
    }
    // plaqueta de marca (retrô: cromada) e visor digital
    if (d.logo) {
      const lw = Math.min(0.2, W * 0.36);
      if (retro) {
        // plaqueta cromada estilo anos 50
        const ly = d.y1 - Math.min(0.1, h * 0.28);
        g.add(place(slab(c, lw * 0.8, 0.02, 0.005, chrome, { r: 0.0099, bevel: 0.0015, part: 'metal' }), { x: cx, y: ly, z: zDoorF + 0.001 }));
        g.add(place(kit.box(lw * 0.62, 0.006, 0.001, m.flat('#6f7378', { roughness: 0.35, metalness: 1 })), { x: cx, y: ly, z: zDoorF + 0.0037 }));
      } else {
        g.add(place(kit.box(lw * 0.6, 0.008, 0.0015, m.metal('#b9bcbf', { finish: 'brushed' })), { x: cx, y: d.y1 - 0.05, z: zDoorF + 0.0002 }));
      }
    }
    if (d.disp && !retro && !small && (st.frostFree || st.smart || st.sideBySide || st.frenchDoor || st.inverse)) {
      const dw = Math.min(0.09, w * 0.3);
      const dx = d.side === 'left' ? cx + w * 0.18 : cx - w * 0.18;
      const dy = Math.min(d.y1 - 0.14, 1.45);
      g.add(place(kit.box(dw + 0.01, dw * 0.6 + 0.01, 0.003, blackGloss(c), { r: 0.004 }), { x: dx, y: dy, z: zDoorF + 0.0005 }));
      g.add(place(decal(c, dw, dw * 0.55, displayMat(c, '-18°', '#7fd8ff')), { x: dx, y: dy, z: zDoorF + 0.0022 }));
    }
    // dispenser de água (side by side / french door)
    if (d.disp && (st.sideBySide || st.frenchDoor) && w > 0.25) {
      const dw = Math.min(0.2, w * 0.55);
      const dh = Math.min(0.28, h * 0.25);
      const dy = Math.min(d.y0 + h * 0.55, 1.15);
      g.add(place(kit.box(dw, dh, 0.006, m.plastic('#1e1f21', { gloss: 0.4 }), { r: 0.01 }), { x: cx, y: dy, z: zDoorF + 0.001 }));
      g.add(place(kit.box(dw * 0.8, dh * 0.62, 0.003, shadowOf(c), { r: 0.006 }), { x: cx, y: dy - dh * 0.06, z: zDoorF + 0.004 }));
      g.add(place(kit.box(dw * 0.3, dh * 0.3, 0.012, m.plastic('#2c2d2f', { gloss: 0.3 }), { r: 0.004 }), { x: cx, y: dy + dh * 0.05, z: zDoorF + 0.008 }));
    }
  });
  // dobradiças (lado oposto ao puxador)
  const hingeX = open === 'left' ? W / 2 - 0.035 : -W / 2 + 0.035;
  if (!st.sideBySide && !st.frenchDoor && retro) {
    g.add(place(kit.box(0.05, 0.012, 0.03, chrome, { r: 0.004, part: 'metal' }), { x: hingeX, y: topY - 0.012, z: zBodyF + 0.002 }));
  }
  return g;
}

// Freezer horizontal: tampa por cima, puxador embutido, painel de controle e grade lateral
function chestFreezer(c) {
  const { kit, m, C, W, H, D, place } = c;
  const g = kit.group('freezer-horizontal');
  const fin = bodyFinish(c, { gloss: 0.6 });
  const feet = 0.02;
  const lidT = clamp(H * 0.09, 0.06, 0.09);
  const bodyH = H - feet - lidT;
  g.add(place(kit.box(W, bodyH, D, fin.mat, { r: 0.012, part: 'main' }), { y: feet + bodyH / 2 }));
  // tampa com leve sobreposição e friso
  g.add(place(kit.box(W, lidT - 0.004, D, fin.mat, { r: 0.016, part: 'main' }), { y: H - (lidT - 0.004) / 2 }));
  g.add(place(kit.box(W - 0.01, 0.006, D - 0.01, m.rubber('#2a2b2c')), { y: feet + bodyH + 0.003 }));
  // puxador embutido na frente da tampa
  g.add(place(kit.box(Math.min(0.3, W * 0.3), 0.022, 0.012, m.plastic(kit.shade(C.main, -0.18), { gloss: 0.3 }), { r: 0.005 }), { y: H - lidT * 0.55, z: D / 2 - 0.006 }));
  g.add(place(kit.box(Math.min(0.26, W * 0.26), 0.008, 0.001, shadowOf(c)), { y: H - lidT * 0.62, z: D / 2 + 0.0002 }));
  // painel (termostato) e grade do compressor
  g.add(place(kit.box(0.12, 0.05, 0.004, blackGloss(c), { r: 0.006 }), { x: W / 2 - 0.12, y: feet + bodyH - 0.06, z: D / 2 - 0.0005 }));
  g.add(place(kit.box(0.006, 0.006, 0.002, m.flat('#39d353', { emissive: '#2bd14a' })), { x: W / 2 - 0.15, y: feet + bodyH - 0.06, z: D / 2 + 0.0012 }));
  g.add(place(knob(c, 0.012, 0.003, { ring: false, pointer: false }), { x: W / 2 - 0.095, y: feet + bodyH - 0.06, z: D / 2 + 0.0015 }));
  const gw = Math.min(0.22, W * 0.22);
  g.add(place(kit.box(gw, 0.12, 0.004, m.plastic('#2a2b2d', { gloss: 0.2 }), { r: 0.004 }), { x: W / 2 - gw / 2 - 0.04, y: feet + 0.1, z: D / 2 - 0.0012 }));
  for (let i = 0; i < 6; i++) g.add(place(kit.box(gw - 0.02, 0.004, 0.002, m.flat('#0a0a0a')), { x: W / 2 - gw / 2 - 0.04, y: feet + 0.06 + i * 0.016, z: D / 2 + 0.0004 }));
  feet4(c, g, W, D, feet, { r: 0.016, inset: 0.05 });
  return g;
}

// Adega / cervejeira: porta de vidro escura com garrafas deitadas em prateleiras de madeira
function wineCooler(c) {
  const { kit, m, C, W, H, D, place } = c;
  const g = kit.group('adega');
  const fin = bodyFinish(c, { gloss: 0.5 });
  const body = isDark(kit, C.main) || C.main === '#f2f2f2' ? m.plastic('#151617', { gloss: 0.4 }) : fin.mat;
  const handleP = 0.03;
  const doorT = 0.03;
  const plinth = 0.05;
  const bodyD = D - handleP - doorT;
  const zF = -D / 2 + bodyD;
  g.add(place(kit.box(W, H - plinth, bodyD, body, { r: 0.006, part: 'main' }), { y: plinth + (H - plinth) / 2, z: -D / 2 + bodyD / 2 }));
  g.add(place(kit.box(W - 0.02, plinth, bodyD - 0.02, shadowOf(c)), { y: plinth / 2, z: -D / 2 + bodyD / 2 }));
  g.add(place(kit.box(W - 0.04, plinth * 0.6, 0.006, m.plastic('#202123', { gloss: 0.2 })), { y: plinth / 2, z: zF - 0.004 }));
  // interior visível
  const iw = W - 0.07;
  const ih = H - plinth - 0.12;
  const iy0 = plinth + 0.06;
  g.add(place(kit.box(iw, ih, 0.004, m.flat('#1d1a18', { roughness: 0.9 })), { y: iy0 + ih / 2, z: zF + 0.002 }));
  const shelves = Math.max(2, Math.floor(ih / 0.1));
  const wood = m.wood(C.wood || '#a87a4c', { grain: 'smooth' });
  const glassBottle = m.glass({ tint: '#1d3b22', opacity: 0.85 });
  const per = Math.max(1, Math.floor(iw / 0.085));
  for (let s = 0; s < shelves; s++) {
    const y = iy0 + (ih * (s + 0.5)) / shelves;
    g.add(place(kit.box(iw, 0.012, 0.02, wood, { part: 'wood' }), { y: y - 0.04, z: zF + 0.012 }));
    for (let b = 0; b < per; b++) {
      const bx = -iw / 2 + (iw * (b + 0.5)) / per;
      g.add(place(kit.cylinder(0.034, 0.034, 0.012, glassBottle, { seg: 16 }), { x: bx, y: y - 0.034 + 0.034, z: zF + 0.01, rx: PI / 2 }));
      g.add(place(kit.cylinder(0.012, 0.012, 0.004, m.flat(b % 2 ? '#c9b37a' : '#7b1e2a', { roughness: 0.5 })), { x: bx, y, z: zF + 0.018, rx: PI / 2 }));
    }
  }
  // porta: moldura e vidro fumê
  const zDoor = zF + doorT / 2 + 0.002;
  const frameW = 0.035;
  const dh = H - plinth - 0.01;
  const dy = plinth + 0.005 + dh / 2;
  for (const [w, h, x, y] of [[W, frameW, 0, dy + dh / 2 - frameW / 2], [W, frameW * 1.6, 0, dy - dh / 2 + frameW * 0.8], [frameW, dh, -W / 2 + frameW / 2, dy], [frameW, dh, W / 2 - frameW / 2, dy]]) {
    g.add(place(kit.box(w, h, doorT - 0.004, body, { r: 0.003, part: 'main' }), { x, y, z: zDoor }));
  }
  g.add(place(kit.box(W - 2 * frameW, dh - frameW * 2.6, 0.006, m.glass({ tint: '#30363a', opacity: 0.45 })), { y: dy + frameW * 0.3, z: zDoor + 0.006 }));
  const hl = Math.min(0.5, dh * 0.5);
  g.add(place(barHandle(c, hl, handleP, { material: brushedOf(c) }), { x: -W / 2 + frameW / 2, y: dy, z: zF + doorT }));
  // visor
  g.add(place(decal(c, 0.06, 0.02, displayMat(c, '12°', '#7fd8ff')), { y: dy - dh / 2 + frameW * 0.8, z: zDoor + (doorT - 0.004) / 2 + 0.0006 }));
  return g;
}

/* ================================================================== */
/* Lavadora / lava e seca / tanquinho                                  */
/* ================================================================== */
function washerModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st } = c;
  if (st.frontLoad && !st.topLoad) return frontLoader(c);
  return topLoader(c);
}

function frontLoader(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('lavadora-frontal');
  const fin = bodyFinish(c, { gloss: 0.45 });
  const body = fin.mat;
  const steel = fin.steel;
  const dark = isDark(kit, C.main);
  const trim = steel || dark ? m.plastic('#2b2d30', { gloss: 0.6 }) : m.plastic(C.main, { gloss: 0.55 });
  const feetH = 0.012;
  const topT = 0.016;
  const doorP = clamp(D * 0.075, 0.035, 0.05);
  const bodyD = D - doorP;
  const zB = -D / 2;
  const zF = zB + bodyD;
  const bodyH = H - feetH - topT;
  g.add(place(kit.box(W, bodyH, bodyD, body, { r: 0.01, part: 'main' }), { y: feetH + bodyH / 2, z: zB + bodyD / 2 }));
  // tampo (com friso escuro abaixo)
  g.add(place(kit.box(W, topT, bodyD + 0.004, body, { r: 0.006, part: 'main' }), { y: H - topT / 2, z: zB + (bodyD + 0.004) / 2 }));
  g.add(place(kit.box(W - 0.004, 0.002, 0.001, m.flat('#9a9ea3')), { y: H - topT - 0.001, z: zF + 0.0006 }));
  // painel de controle
  const ph = clamp(bodyH * 0.15, 0.08, 0.13);
  const py = H - topT - ph / 2 - 0.004;
  const panelMat = steel ? m.metal(kit.shade(C.main, 0.05), { finish: 'brushed' }) : m.plastic(dark ? '#1c1d1f' : C.main, { gloss: 0.5 });
  g.add(place(slab(c, W - 0.012, ph, 0.006, panelMat, { r: 0.012, bevel: 0.002, part: 'main' }), { y: py, z: zF + 0.003 }));
  g.add(place(kit.box(W - 0.012, 0.002, 0.002, m.flat('#8f9398')), { y: py - ph / 2 - 0.003, z: zF + 0.001 }));
  const pz = zF + 0.006;
  // gaveta de sabão (esquerda) com pega
  const dw = W * 0.31;
  const dxm = -W / 2 + 0.012 + dw / 2;
  g.add(place(slab(c, dw, ph - 0.012, 0.008, panelMat, { r: 0.008, bevel: 0.002, part: 'main' }), { x: dxm, y: py, z: pz + 0.004 }));
  g.add(place(kit.box(dw - 0.006, 0.0025, 0.002, m.flat('#7c8085')), { x: dxm, y: py - ph / 2 + 0.006, z: pz + 0.004 }));
  g.add(place(kit.box(dw * 0.5, 0.008, 0.004, shadowOf(c), { r: 0.003 }), { x: dxm, y: py - ph / 2 + 0.016, z: pz + 0.0075 }));
  const prInk = dark || steel ? 'rgba(225,228,232,0.85)' : 'rgba(70,74,80,0.85)';
  g.add(place(decal(c, dw - 0.02, (ph - 0.02) * 0.62, printMat(c, 'programas', 512, 160, drawPrograms, prInk)), { x: dxm, y: py + 0.006, z: pz + 0.0083 }));
  // botão de programas com anel de marcas
  const kr = Math.min(0.022, ph * 0.22);
  const kx = dxm + dw / 2 + 0.05;
  g.add(place(decal(c, kr * 4, kr * 4, printMat(c, 'dial', 256, 256, drawDial, prInk)), { x: kx, y: py, z: pz + 0.0005 }));
  g.add(place(knob(c, kr, 0.022, { material: steel || dark ? m.metal('#c9cbcd', { finish: 'brushed' }) : m.plastic(C.main, { gloss: 0.6 }), ring: true, pointer: true }), { x: kx, y: py, z: pz }));
  // visor e botões
  const vx = kx + 0.075;
  const vw = Math.min(0.09, W * 0.15);
  g.add(place(kit.box(vw + 0.008, ph * 0.42, 0.003, blackGloss(c), { r: 0.004 }), { x: vx + vw * 0.15, y: py, z: pz + 0.0015 }));
  g.add(place(decal(c, vw * 0.7, ph * 0.26, displayMat(c, '1:25', '#ff5a3c')), { x: vx + vw * 0.08, y: py, z: pz + 0.0032 }));
  for (let i = 0; i < 4; i++) {
    g.add(place(kit.cylinder(0.006, 0.006, 0.004, panelMat, { seg: 14, part: 'main' }), { x: vx - vw * 0.25 + i * (vw * 0.33), y: py + ph * 0.34, z: pz + 0.002, rx: PI / 2 }));
  }
  g.add(place(kit.cylinder(0.009, 0.009, 0.006, m.plastic(dark || steel ? '#3a3c40' : '#e9eaec', { gloss: 0.7 }), { seg: 18 }), { x: W / 2 - 0.035, y: py + 0.004, z: pz + 0.003, rx: PI / 2 }));
  g.add(place(kit.box(0.004, 0.004, 0.001, m.flat('#2fd36b', { emissive: '#27c95f' })), { x: W / 2 - 0.035, y: py - ph * 0.3, z: pz + 0.0006 }));
  // porta redonda
  const freeH = bodyH - ph;
  const Ro = Math.min(W * 0.37, freeH * 0.42);
  const yc = feetH + freeH * 0.5;
  const Ri = Ro * 0.74;
  const ringMat = steel ? m.plastic('#3c3f43', { gloss: 0.65 }) : trim;
  // aro externo (plástico) com relevo
  g.add(place(disc(c, [[Ro * 0.97, 0], [Ro, doorP * 0.3], [Ro * 0.985, doorP * 0.75], [Ro * 0.93, doorP * 0.97], [Ro * 0.86, doorP], [Ro * 0.8, doorP * 0.94], [Ro * 0.775, doorP * 0.8]], ringMat, { seg: 64, part: steel ? 'detail' : 'main' }), { y: yc, z: zF }));
  // aro interno cromado/cinza
  g.add(place(disc(c, [[Ro * 0.78, doorP * 0.8], [Ri * 1.02, doorP * 0.76], [Ri, doorP * 0.6], [Ri * 0.98, doorP * 0.5]], steel ? chromeOf(c) : m.metal('#b9bdc2', { finish: 'brushed' }), { seg: 64, part: 'metal' }), { y: yc, z: zF }));
  // tambor ao fundo (inox perfurado) e fole de borracha
  g.add(place(disc(c, [[0.0001, 0.002], [Ri * 0.98, 0.002], [Ri * 0.98, 0.004], [0.0001, 0.004]], m.metal('#5d6166', { finish: 'brushed' }), { seg: 48 }), { y: yc, z: zF }));
  g.add(place(decal(c, Ri * 1.9, Ri * 1.9, drumPrint(c)), { y: yc, z: zF + 0.0045 }));
  g.add(place(disc(c, [[Ri * 0.96, doorP * 0.5], [Ri * 0.99, doorP * 0.45], [Ri * 0.98, 0.003]], m.rubber('#3b3d40'), { seg: 48 }), { y: yc, z: zF }));
  // vidro abaulado
  g.add(place(disc(c, [[Ri * 0.99, doorP * 0.55], [Ri * 0.8, doorP * 0.66], [Ri * 0.45, doorP * 0.72], [0.0001, doorP * 0.735]], m.glass({ tint: '#5a6a75', opacity: 0.32 }), { seg: 48 }), { y: yc, z: zF }));
  // pega da porta (lado direito do aro)
  g.add(place(kit.box(0.014, Ro * 0.4, 0.008, ringMat, { r: 0.004 }), { x: Ro * 0.9, y: yc, z: zF + doorP * 0.62, rz: 0 }));
  g.add(place(kit.box(0.006, Ro * 0.3, 0.003, shadowOf(c), { r: 0.0012 }), { x: Ro * 0.9, y: yc, z: zF + doorP * 0.62 + 0.0035 }));
  // selo redondo (eficiência) e tampa do filtro
  g.add(place(disc(c, [[0.0001, 0], [0.018, 0], [0.018, 0.002], [0.0001, 0.002]], m.flat('#e8f2e6', { roughness: 0.5 }), { seg: 24 }), { x: W * 0.34, y: yc + Ro * 0.75, z: zF }));
  g.add(place(decal(c, 0.032, 0.032, printMat(c, 'selo', 64, 64, (gg) => {
    gg.lineWidth = 4;
    for (const [r, col] of [[26, '#7bbf5a'], [18, '#3aa0a0'], [10, '#7bbf5a']]) {
      gg.strokeStyle = col;
      gg.beginPath();
      gg.arc(32, 32, r, 0, PI * 2);
      gg.stroke();
    }
  }, '#000')), { x: W * 0.34, y: yc + Ro * 0.75, z: zF + 0.0025 }));
  const kick = feetH + 0.085;
  g.add(place(kit.box(W - 0.02, 0.002, 0.001, m.flat('#a3a7ac')), { y: kick, z: zF + 0.0006 }));
  g.add(place(kit.box(0.09, 0.06, 0.003, body, { r: 0.004, part: 'main' }), { x: W / 2 - 0.07, y: feetH + 0.045, z: zF + 0.0012 }));
  g.add(place(kit.box(0.03, 0.006, 0.002, shadowOf(c), { r: 0.002 }), { x: W / 2 - 0.07, y: feetH + 0.068, z: zF + 0.0025 }));
  feet4(c, g, W, bodyD, feetH, { r: 0.016, inset: 0.05, z: zB + bodyD / 2 });
  void st;
  return g;
}
// Serigrafia do painel: colunas de linhas curtas (texto pequeno) e anel de marcas do botão
function drawPrograms(g) {
  const w = 512;
  for (let k = 0; k < 3; k++) {
    const x0 = 16 + k * (w / 3);
    g.globalAlpha = 1;
    g.fillRect(x0, 12, 58, 10);
    g.globalAlpha = 0.75;
    for (let i = 0; i < 6; i++) {
      const y = 36 + i * 20;
      g.fillRect(x0, y, 9, 9);
      g.fillRect(x0 + 15, y + 1, 48 + ((i * 37 + k * 23) % 62), 7);
    }
  }
  g.globalAlpha = 1;
}
function drawDial(g, w) {
  const R = w * 0.4;
  for (let i = 0; i < 16; i++) {
    const a = -PI * 0.8 + (i / 15) * PI * 1.6 - PI / 2;
    g.beginPath();
    g.arc(w / 2 + Math.cos(a) * R, w / 2 + Math.sin(a) * R, i % 5 === 0 ? 9 : 5.5, 0, PI * 2);
    g.fill();
  }
}
// Tambor: furinhos em anéis sobre inox escuro
function drumPrint(c) {
  return canvasMat(
    c,
    'tambor',
    256,
    256,
    (g, w) => {
      g.clearRect(0, 0, w, w);
      const rg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      rg.addColorStop(0, 'rgba(70,74,80,1)');
      rg.addColorStop(0.75, 'rgba(40,43,47,1)');
      rg.addColorStop(0.98, 'rgba(18,19,21,1)');
      rg.addColorStop(1, 'rgba(30,32,35,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(w / 2, w / 2, w / 2, 0, PI * 2);
      g.fill();
      g.fillStyle = 'rgba(10,11,12,0.9)';
      for (let r = 14; r < w * 0.47; r += 13) {
        const n = Math.floor((2 * PI * r) / 13);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * PI * 2 + r;
          g.beginPath();
          g.arc(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, 2.2, 0, PI * 2);
          g.fill();
        }
      }
      // roupas no fundo do tambor: dobras irregulares em tons de jeans
      const blob = (x, y, rx, ry, rot, col) => {
        g.save();
        g.translate(w * x, w * y);
        g.rotate(rot);
        const rg2 = g.createRadialGradient(-rx * w * 0.3, -ry * w * 0.4, 0, 0, 0, rx * w);
        rg2.addColorStop(0, col[0]);
        rg2.addColorStop(1, col[1]);
        g.fillStyle = rg2;
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * PI * 2;
          const k = 1 + 0.18 * Math.sin(a * 3 + x * 9) + 0.1 * Math.sin(a * 5 + y * 7);
          g.lineTo(Math.cos(a) * rx * w * k, Math.sin(a) * ry * w * k);
        }
        g.fill();
        g.restore();
      };
      g.save();
      g.beginPath();
      g.arc(w / 2, w / 2, w * 0.47, 0, PI * 2);
      g.clip();
      blob(0.36, 0.8, 0.2, 0.12, 0.3, ['#4a6688', '#1e2c40']);
      blob(0.62, 0.82, 0.22, 0.11, -0.2, ['#5b7698', '#26364d']);
      blob(0.5, 0.72, 0.14, 0.08, 0.6, ['#7d93ae', '#34465e']);
      blob(0.28, 0.66, 0.08, 0.06, 0.2, ['#9aa7b5', '#4b5866']);
      g.restore();
    },
    { transparent: true, roughness: 0.5, metalness: 0.2 }
  );
}

function topLoader(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('lavadora-superior');
  const fin = bodyFinish(c, { gloss: 0.45 });
  const body = fin.mat;
  const tanq = !!st.tanquinho;
  const dark = isDark(kit, C.main) || fin.steel;
  const feetH = 0.015;
  const consoleH = tanq ? 0.05 : clamp(H * 0.13, 0.07, 0.13);
  const topY = H - consoleH;
  const bodyH = topY - feetH;
  const r = tanq ? Math.min(0.06, W * 0.1) : 0.012;
  g.add(place(kit.box(W, bodyH, D, body, { r, seg: 4, part: 'main' }), { y: feetH + bodyH / 2 }));
  // rodapé
  g.add(place(kit.box(W - 0.03, 0.05, 0.004, m.plastic(dark ? '#2b2d30' : kit.shade(C.main, -0.08), { gloss: 0.3 }), { r: 0.004 }), { y: feetH + 0.03, z: D / 2 - 0.0016 }));
  g.add(place(kit.box(0.08, 0.012, 0.002, m.metal('#c4c7ca', { finish: 'brushed' }), { r: 0.002 }), { y: topY - 0.06, z: D / 2 - 0.0008 }));
  g.add(place(kit.box(W - 0.03, 0.002, 0.001, m.flat(dark ? '#111' : '#c9ccd0')), { y: topY - 0.025, z: D / 2 - 0.0002 }));
  // tampa (moldura + vidro) e cesto visível
  const cD = tanq ? 0.08 : Math.min(0.13, D * 0.22);
  const lidD = D - cD - 0.03;
  const lidW = W - 0.05;
  const lz = D / 2 - 0.015 - lidD / 2;
  const tubR = Math.min(lidW, lidD) * 0.4;
  g.add(place(kit.cylinder(tubR, tubR, 0.004, m.metal('#5f6368', { finish: 'brushed' }), { seg: 40 }), { y: topY + 0.002, z: lz }));
  g.add(place(kit.cylinder(tubR * 0.25, tubR * 0.32, 0.012, m.plastic('#e9eaec', { gloss: 0.5 }), { seg: 24 }), { y: topY + 0.006, z: lz }));
  const lidMat = tanq ? m.glass({ tint: C.accent && !isDark(kit, C.accent) ? C.accent : '#9fd0e8', opacity: 0.55 }) : m.glass({ tint: '#3a434a', opacity: 0.5 });
  const fw = 0.03;
  const fy = topY + 0.009;
  for (const [w, d, x, z] of [[lidW, fw, 0, lz + lidD / 2 - fw / 2], [lidW, fw * 1.4, 0, lz - lidD / 2 + fw * 0.7], [fw, lidD, -lidW / 2 + fw / 2, lz], [fw, lidD, lidW / 2 - fw / 2, lz]]) {
    g.add(place(kit.box(w, 0.018, d, tanq ? lidMat : body, { r: 0.004, part: 'main' }), { x, y: fy, z }));
  }
  g.add(place(kit.box(lidW - 2 * fw, 0.004, lidD - fw * 2.4, lidMat), { y: topY + 0.014, z: lz - fw * 0.2 }));
  g.add(place(kit.box(0.1, 0.006, 0.012, shadowOf(c), { r: 0.002 }), { y: topY + 0.016, z: lz + lidD / 2 - 0.01 }));
  if (tanq) {
    // tanquinho: faixa traseira com botão de tempo
    const cz = -D / 2 + cD / 2;
    g.add(place(kit.box(W - 0.04, consoleH, cD, body, { r: 0.02, part: 'main' }), { y: topY + consoleH / 2 - 0.001, z: cz }));
    g.add(place(knob(c, 0.02, 0.018, { material: m.plastic('#f4f4f4', { gloss: 0.6 }) }), { x: W * 0.22, y: topY + consoleH * 0.5, z: cz + cD / 2 - 0.004 }));
  } else {
    // console traseiro com botões e visor
    const cz = -D / 2 + cD / 2;
    g.add(place(kit.box(W, consoleH, cD, body, { r: 0.012, part: 'main' }), { y: topY + consoleH / 2 - 0.001, z: cz }));
    const facePanel = m.plastic(dark ? '#1e1f21' : kit.shade(C.main, -0.04), { gloss: 0.5 });
    g.add(place(kit.box(W - 0.04, consoleH * 0.72, 0.004, facePanel, { r: 0.008 }), { y: topY + consoleH * 0.5, z: cz + cD / 2 + 0.001 }));
    const kr = Math.min(0.024, consoleH * 0.25);
    for (const kx of [-W * 0.32, W * 0.32]) g.add(place(knob(c, kr, 0.02, { material: m.plastic(dark ? '#d0d2d4' : '#f4f4f4', { gloss: 0.6 }) }), { x: kx, y: topY + consoleH * 0.5, z: cz + cD / 2 + 0.002 }));
    g.add(place(decal(c, 0.07, 0.025, displayMat(c, '0:42', '#5fd1ff')), { y: topY + consoleH * 0.55, z: cz + cD / 2 + 0.0035 }));
    for (let i = 0; i < 5; i++) g.add(place(kit.cylinder(0.005, 0.005, 0.004, m.plastic('#c9cbcd', { gloss: 0.5 }), { seg: 12 }), { x: -0.06 + i * 0.03, y: topY + consoleH * 0.25, z: cz + cD / 2 + 0.003, rx: PI / 2 }));
  }
  feet4(c, g, W, D, feetH, { r: 0.016, inset: 0.05 });
  return g;
}

/* ================================================================== */
/* Fogão e cooktop                                                     */
/* ================================================================== */
// Interior do forno visto pelo vidro: grades e brilho quente ao fundo
function ovenInterior(c) {
  return canvasMat(
    c,
    'forno',
    256,
    128,
    (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2b2420');
      bg.addColorStop(1, '#100d0c');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      const rg = g.createRadialGradient(w * 0.5, h * 0.25, 0, w * 0.5, h * 0.25, w * 0.5);
      rg.addColorStop(0, 'rgba(255,170,90,0.35)');
      rg.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(160,160,165,0.55)';
      g.lineWidth = 2;
      for (const y of [h * 0.42, h * 0.72]) {
        g.beginPath();
        g.moveTo(w * 0.06, y);
        g.lineTo(w * 0.94, y);
        g.stroke();
        for (let x = w * 0.08; x < w * 0.94; x += w * 0.06) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + w * 0.02, y + h * 0.06);
          g.stroke();
        }
      }
    },
    { emissive: 0.25, roughness: 0.6 }
  );
}
// Anéis das zonas na mesa de vidro (indução / vitrocerâmica), desenhados na proporção w x d
function zonesPrint(c, n, w, d) {
  const asp = Math.round((d / w) * 10) / 10;
  const cw = 512;
  const ch = Math.max(64, Math.round(cw * asp));
  return printMat(c, `zonas${n}:${asp}`, cw, ch, (g) => {
    g.lineWidth = 6;
    for (const [x, z, r] of zoneLayout(n, 1, asp)) {
      const px = (x + 0.5) * cw;
      const py = (z / asp + 0.5) * ch;
      const pr = r * cw;
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(px, py, pr, 0, PI * 2);
      g.stroke();
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(px, py, pr * 0.6, 0, PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }, 'rgba(190,195,200,0.75)');
}
// Posições (x, z, raio) das bocas numa área w x d centrada (frações quando w = d = 1)
function zoneLayout(n, w, d) {
  const out = [];
  if (n <= 1) out.push([0, 0, Math.min(w, d) * 0.3]);
  else if (n === 2) out.push([-w * 0.25, 0, Math.min(w * 0.2, d * 0.3)], [w * 0.25, 0, Math.min(w * 0.17, d * 0.26)]);
  else if (n === 3) out.push([-w * 0.27, -d * 0.22, Math.min(w, d) * 0.17], [w * 0.27, -d * 0.22, Math.min(w, d) * 0.15], [0, d * 0.24, Math.min(w, d) * 0.19]);
  else if (n === 5) {
    const r = Math.min(w * 0.12, d * 0.17);
    out.push([-w * 0.32, -d * 0.24, r], [w * 0.32, -d * 0.24, r * 0.9], [-w * 0.32, d * 0.24, r * 0.9], [w * 0.32, d * 0.24, r], [0, 0, r * 1.25]);
  } else if (n >= 6) {
    const r = Math.min(w * 0.1, d * 0.17);
    for (let i = 0; i < 6; i++) out.push([-w * 0.33 + (i % 3) * w * 0.33, (i < 3 ? -1 : 1) * d * 0.24, r * (i % 2 ? 0.85 : 1)]);
  } else {
    const r = Math.min(w * 0.16, d * 0.18);
    out.push([-w * 0.25, -d * 0.24, r * 0.9], [w * 0.25, -d * 0.24, r], [-w * 0.25, d * 0.24, r], [w * 0.25, d * 0.24, r * 0.82]);
  }
  return out;
}
// Resistência elétrica em espiral sobre bacia cromada
function coilBurner(c, r) {
  const { kit } = c;
  const g = kit.group('resistencia');
  g.add(c.kit.lathe([[0.0001, 0], [r * 0.95, 0], [r * 1.12, 0.006], [r * 1.12, 0.007], [r * 1.0, 0.003], [0.0001, 0.002]], chromeOf(c), { seg: 36, part: 'metal' }));
  const pts = [];
  const turns = 3.2;
  const N = Math.round(turns * 26);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * turns * PI * 2;
    const rr = lerp(r * 0.22, r * 0.9, t);
    pts.push([Math.cos(a) * rr, 0.011, Math.sin(a) * rr]);
  }
  pts.push([r * 1.05, 0.009, pts[pts.length - 1][2]]);
  const coilMat = c.m.metal('#2a2b2d', { finish: 'brushed' });
  g.add(kit.tube(pts, Math.max(0.0032, r * 0.045), coilMat, { seg: N * 2, radial: 6, part: 'detail' }));
  for (const a of [0.3, 0.3 + PI * 0.66, 0.3 + PI * 1.33]) {
    g.add(c.place(kit.box(r * 1.7, 0.003, 0.004, coilMat), { y: 0.008, ry: a }));
  }
  return g;
}
// Queimador a gás (base, espalhador e tampa esmaltada)
function gasBurner(c, r) {
  const { kit, m } = c;
  const g = kit.group('queimador');
  g.add(c.place(kit.cylinder(r * 0.7, r * 0.76, 0.01, m.metal('#2b2c2e', { finish: 'brushed' }), { seg: 28 }), { y: 0.005 }));
  g.add(c.place(kit.cylinder(r * 0.6, r * 0.62, 0.007, m.metal('#8b8e92', { finish: 'brushed' }), { seg: 28 }), { y: 0.0135 }));
  g.add(c.kit.lathe([[0.0001, 0.017], [r * 0.5, 0.017], [r * 0.5, 0.021], [r * 0.38, 0.024], [0.0001, 0.025]], m.paint('#111111', { gloss: 0.8 }), { seg: 28, part: 'detail' }));
  return g;
}
// Trempe de ferro fundido sobre uma boca (quadrado com dedos)
function grate(c, size, h) {
  const { kit, m } = c;
  const g = kit.group('trempe');
  const iron = m.paint('#151515', { gloss: 0.35 });
  const t = 0.008;
  for (const s of [-1, 1]) {
    g.add(c.place(kit.box(size, t, t, iron, { r: 0.002, seg: 1 }), { y: h - t / 2, z: (s * (size - t)) / 2 }));
    g.add(c.place(kit.box(t, t, size, iron, { r: 0.002, seg: 1 }), { x: (s * (size - t)) / 2, y: h - t / 2 }));
  }
  for (const [x, z, ry] of [[0, size * 0.3, 0], [0, -size * 0.3, 0], [size * 0.3, 0, PI / 2], [-size * 0.3, 0, PI / 2]]) {
    g.add(c.place(kit.box(t, t, size * 0.3, iron, { r: 0.002, seg: 1 }), { x, y: h - t / 2, z, ry }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(c.place(kit.box(t, h, t, iron), { x: (sx * (size - t)) / 2, y: h / 2, z: (sz * (size - t)) / 2 }));
  return g;
}
// Mesa do fogão: bocas na área (w x d) com topo em y = 0; retorna altura máxima acima da mesa
function cooktopSurface(c, g, w, d, { x = 0, z = 0, y = 0, n = 4, type = 'gas' } = {}) {
  const { kit } = c;
  const zones = zoneLayout(n, w, d);
  if (type === 'glass') {
    g.add(c.place(decal(c, w, d, zonesPrint(c, n, w, d)), { x, y: y + 0.0006, z, rx: -PI / 2 }));
    return 0;
  }
  if (type === 'electric') {
    zones.forEach(([zx, zz, r]) => g.add(c.place(coilBurner(c, r), { x: x + zx, y, z: z + zz })));
    return 0.015;
  }
  const gh = 0.03;
  zones.forEach(([zx, zz, r]) => {
    g.add(c.place(gasBurner(c, r * 0.75), { x: x + zx, y, z: z + zz }));
    const gs = Math.min(r * 2.3, w / 2, d / 2);
    g.add(c.place(grate(c, gs, gh), { x: x + zx, y, z: z + zz }));
  });
  void kit;
  return gh;
}

function stoveModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st } = c;
  if (st.cooktop) return cooktop(c);
  return range(c);
}

function range(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('fogao');
  const fin = bodyFinish(c, { gloss: 0.7 });
  const steel = fin.steel;
  const dark = isDark(kit, C.main);
  const front = fin.mat;
  const sides = steel ? m.paint('#1c1c1d', { gloss: 0.5 }) : fin.mat;
  const trimBlack = m.paint('#121314', { gloss: 0.75 });
  const n = clamp(Math.round(st.burners || 4), 1, 6);
  // mesa: indução/vitrocerâmica (vidro liso), resistência elétrica ou gás (com ou sem mesa de vidro)
  const type = st.induction || (st.electric && st.glass) ? 'glass' : st.electric ? 'electric' : 'gas';
  const glassTop = type === 'glass' || !!st.glass;
  const handleP = 0.045;
  const doorT = 0.03;
  const zF = D / 2 - handleP; // frente da porta
  const zBodyF = zF - doorT;
  const bodyD = zBodyF + D / 2;
  // altura útil: com painel traseiro (elétrico/vidro) ou trempe aparente (gás)
  const bgH = type === 'gas' ? 0 : clamp(H * 0.14, 0.08, 0.15);
  const topExtra = type === 'gas' ? 0.03 : type === 'electric' ? 0.015 : 0;
  const yTop = type === 'gas' ? H - topExtra : H - bgH;
  const baseH = 0.03;
  const topT = 0.022;
  const band = clamp(yTop * 0.09, 0.055, 0.085);
  const hasDrawer = st.drawer !== false && yTop > 0.65;
  const drawerH = hasDrawer ? yTop * 0.16 : 0;
  const yDrawerTop = baseH + drawerH;
  const yBandBot = yTop - topT - band;
  // corpo (laterais e fundo) e rodapé preto
  g.add(place(kit.box(W, yTop - topT - baseH, bodyD, sides, { r: 0.004, part: steel ? 'detail' : 'main' }), { y: baseH + (yTop - topT - baseH) / 2, z: -D / 2 + bodyD / 2 }));
  g.add(place(kit.box(W - 0.03, baseH, bodyD - 0.04, trimBlack), { y: baseH / 2, z: -D / 2 + bodyD / 2 - 0.01 }));
  feet4(c, g, W - 0.02, bodyD - 0.04, 0.012, { r: 0.012, inset: 0.03, z: -D / 2 + bodyD / 2 });
  // mesa
  const topMat = glassTop ? m.plastic('#0c0c0d', { gloss: 0.95 }) : steel ? m.metal(C.main, { finish: 'brushed' }) : fin.mat;
  const topD = zF + 0.004 + D / 2;
  g.add(place(kit.box(W, topT, topD, topMat, { r: 0.005, part: 'main' }), { y: yTop - topT / 2, z: -D / 2 + topD / 2 }));
  if (steel && !glassTop) g.add(place(kit.box(W - 0.05, 0.001, topD - 0.06 - (bgH ? 0.07 : 0.02), m.metal(kit.shade(C.main, -0.06), { finish: 'brushed' })), { y: yTop + 0.0004, z: -D / 2 + (bgH ? 0.07 : 0.02) + (topD - 0.06 - (bgH ? 0.07 : 0.02)) / 2 + 0.01 }));
  // painel traseiro com relógio
  const bgD = bgH ? 0.075 : 0;
  if (bgH) {
    g.add(place(kit.box(W, bgH, bgD, trimBlack, { r: 0.008 }), { y: yTop + bgH / 2, z: -D / 2 + bgD / 2 }));
    g.add(place(slab(c, W - 0.05, bgH - 0.022, 0.006, steel ? m.metal(C.main, { finish: 'brushed' }) : fin.mat, { r: 0.008, bevel: 0.002, part: 'main' }), { y: yTop + bgH / 2 + 0.002, z: -D / 2 + bgD + 0.003 }));
    g.add(place(kit.box(0.11, 0.032, 0.003, blackGloss(c), { r: 0.004 }), { y: yTop + bgH * 0.58, z: -D / 2 + bgD + 0.0065 }));
    g.add(place(decal(c, 0.08, 0.022, displayMat(c, '12:00', '#4fe3a1')), { y: yTop + bgH * 0.58, z: -D / 2 + bgD + 0.0082 }));
  }
  // bocas
  const areaZ0 = -D / 2 + bgD + 0.02;
  const areaZ1 = zF - 0.03;
  cooktopSurface(c, g, W - 0.08, areaZ1 - areaZ0, { z: (areaZ0 + areaZ1) / 2, y: yTop, n, type });
  // faixa dos botões: moldura preta com inserto (inox ou cor do corpo)
  const bandY = yBandBot + band / 2;
  g.add(place(kit.box(W, band, 0.034, steel ? trimBlack : front, { r: 0.006, part: steel ? 'detail' : 'main' }), { y: bandY, z: zF - 0.017 }));
  if (steel || dark) g.add(place(slab(c, W - 0.06, band * 0.62, 0.004, steel ? m.metal(C.main, { finish: 'brushed' }) : m.plastic('#2a2b2d', { gloss: 0.5 }), { r: band * 0.25, bevel: 0.0015, part: 'main' }), { y: bandY, z: zF + 0.002 }));
  const nk = n + (st.oven !== false ? 1 : 0);
  const kr = Math.min(0.02, band * 0.3);
  const knobMat = steel || dark ? m.plastic('#1a1b1c', { gloss: 0.5 }) : m.plastic('#f2f2f2', { gloss: 0.6 });
  const kz = zF + (steel || dark ? 0.004 : 0);
  const kxs = [];
  if (st.oven !== false) kxs.push(-W / 2 + W * 0.1);
  for (let i = 0; i < n; i++) kxs.push(-W * 0.22 + (i * W * 0.44) / Math.max(1, n - 1) + (n === 1 ? W * 0.22 : 0));
  kxs.slice(0, nk).forEach((x) => g.add(place(knob(c, kr, 0.032, { material: knobMat, ring: steel || dark }), { x, y: bandY, z: kz })));
  g.add(place(kit.box(0.006, 0.006, 0.002, m.flat('#ff4b2b', { emissive: '#ff3a1a' })), { x: W / 2 - W * 0.09, y: bandY, z: kz + 0.0005 }));
  // porta do forno com vidro e puxador
  const doorY0 = yDrawerTop + 0.006;
  const doorY1 = yBandBot - 0.004;
  const doorH = doorY1 - doorY0;
  const dcy = (doorY0 + doorY1) / 2;
  g.add(place(slab(c, W - 0.008, doorH, doorT - 0.002, front, { r: 0.006, bevel: 0.0025, part: 'main' }), { y: dcy, z: zF - doorT / 2 }));
  const ww = W * 0.76;
  const wh = doorH * 0.58;
  const wy = dcy - doorH * 0.05;
  g.add(place(kit.box(ww + 0.03, wh + 0.03, 0.003, trimBlack, { r: 0.006 }), { y: wy, z: zF + 0.0005 }));
  g.add(place(decal(c, ww, wh, ovenInterior(c)), { y: wy, z: zF + 0.0021 }));
  g.add(place(kit.box(ww, wh, 0.002, m.glass({ tint: '#2a2a2a', opacity: 0.3 })), { y: wy, z: zF + 0.0035 }));
  g.add(place(barHandle(c, W * 0.82, handleP, { material: steel ? chromeOf(c) : brushedOf(c), horizontal: true }), { y: doorY1 - 0.04, z: zF }));
  // gaveta
  if (hasDrawer) {
    const dh = drawerH - 0.01;
    g.add(place(slab(c, W - 0.008, dh, 0.028, front, { r: 0.006, bevel: 0.0025, part: 'main' }), { y: baseH + 0.004 + dh / 2, z: zF - 0.017 }));
    g.add(place(slab(c, Math.min(0.2, W * 0.26), 0.032, 0.012, trimBlack, { radii: [0.004, 0.004, 0.016, 0.016], bevel: 0.002 }), { y: baseH + 0.004 + dh - 0.03, z: zF - 0.003 + 0.004 }));
  }
  return g;
}

function cooktop(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('cooktop');
  const n = clamp(Math.round(st.burners || 4), 1, 6);
  const type = st.induction || st.electric || st.glass ? 'glass' : 'gas';
  const fin = bodyFinish(c, { gloss: 0.7 });
  const glassT = 0.006;
  const extra = type === 'gas' ? Math.min(0.03, H * 0.5) : 0;
  const yTop = H - extra;
  // caixa embutida (menor) e mesa
  const boxH = Math.max(0.004, yTop - glassT);
  g.add(place(kit.box(W - 0.06, boxH, D - 0.06, shadowOf(c)), { y: boxH / 2 }));
  const topMat = type === 'glass' || st.glass ? m.plastic('#0b0b0c', { gloss: 0.95 }) : fin.steel || st.inox ? m.metal(C.main, { finish: 'brushed' }) : m.plastic('#0b0b0c', { gloss: 0.95 });
  g.add(place(kit.box(W, glassT, D, topMat, { r: 0.002, part: 'main' }), { y: yTop - glassT / 2 }));
  if (type === 'glass') {
    cooktopSurface(c, g, W - 0.06, D - 0.12, { z: -0.03, y: yTop, n, type });
    g.add(place(decal(c, Math.min(0.24, W * 0.4), 0.03, displayMat(c, '- 5 +', '#ff5a3c', { w: 256, h: 48 })), { y: yTop + 0.0006, z: D / 2 - 0.035, rx: -PI / 2 }));
  } else {
    cooktopSurface(c, g, W - 0.06, D - 0.1, { z: -0.02, y: yTop, n, type: 'gas' });
    void extra;
  }
  return g;
}

/* ================================================================== */
/* Micro-ondas e forno elétrico                                        */
/* ================================================================== */
function meshWindow(c) {
  return canvasMat(
    c,
    'tela-microondas',
    256,
    160,
    (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#2a2f33');
      bg.addColorStop(1, '#0b0d0f');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let y = 2; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 4; x < w; x += 4) g.fillRect(x, y, 2, 2);
    },
    { roughness: 0.3 }
  );
}

function microwaveModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, m, C, W, H, D, place } = c;
  const g = kit.group(st.electricOven ? 'forno-eletrico' : 'micro-ondas');
  const fin = bodyFinish(c, { gloss: 0.55 });
  const dark = isDark(kit, C.main);
  const oven = !!st.electricOven;
  const feetH = oven ? 0.02 : 0.01;
  const handleP = oven ? 0.032 : 0.014;
  const doorT = 0.012;
  const bodyD = D - handleP - doorT;
  const zB = -D / 2;
  const zF = zB + bodyD;
  const bodyH = H - feetH;
  g.add(place(kit.box(W, bodyH, bodyD, fin.mat, { r: 0.01, part: 'main' }), { y: feetH + bodyH / 2, z: zB + bodyD / 2 }));
  feet4(c, g, W, bodyD, feetH, { r: oven ? 0.014 : 0.01, inset: 0.04, z: zB + bodyD / 2 });
  // porta (vidro escuro) e painel lateral
  const pw = Math.min(oven ? 0.12 : 0.13, W * 0.27);
  const dw = W - pw - 0.012;
  const dh = bodyH - 0.016;
  const dcx = -W / 2 + 0.006 + dw / 2;
  const dcy = feetH + bodyH / 2;
  const zd = zF + doorT / 2;
  const doorMat = dark || fin.steel || oven ? m.plastic('#0d0e0f', { gloss: 0.9 }) : m.plastic(C.main, { gloss: 0.7 });
  g.add(place(slab(c, dw, dh, doorT, doorMat, { r: 0.008, bevel: 0.002, part: dark || fin.steel || oven ? 'detail' : 'main' }), { x: dcx, y: dcy, z: zd }));
  const ww = dw * (oven ? 0.82 : 0.72);
  const wh = dh * (oven ? 0.62 : 0.68);
  const wx = oven ? dcx : dcx - dw * 0.08;
  const wy = oven ? dcy - dh * 0.05 : dcy;
  g.add(place(kit.box(ww + 0.012, wh + 0.012, 0.002, m.plastic('#050506', { gloss: 0.9 }), { r: 0.005 }), { x: wx, y: wy, z: zF + doorT + 0.0006 }));
  g.add(place(decal(c, ww, wh, oven ? ovenInterior(c) : meshWindow(c)), { x: wx, y: wy, z: zF + doorT + 0.0019 }));
  g.add(place(kit.box(ww, wh, 0.0015, m.glass({ tint: '#30363a', opacity: 0.25 })), { x: wx, y: wy, z: zF + doorT + 0.0028 }));
  // painel de controle
  const px = W / 2 - 0.006 - pw / 2;
  const panelMat = fin.steel ? m.metal(C.main, { finish: 'brushed' }) : dark || oven ? m.plastic('#1a1b1d', { gloss: 0.6 }) : m.plastic(kit.shade(C.main, -0.03), { gloss: 0.6 });
  g.add(place(slab(c, pw, dh, doorT, panelMat, { r: 0.006, bevel: 0.002, part: 'main' }), { x: px, y: dcy, z: zd }));
  const pz = zF + doorT;
  if (oven) {
    // botões giratórios e luz
    for (let i = 0; i < 3; i++) g.add(place(knob(c, Math.min(0.02, pw * 0.2), 0.022, { material: m.plastic('#2a2b2d', { gloss: 0.5 }), ring: true }), { x: px, y: dcy + dh * 0.28 - i * dh * 0.26, z: pz }));
    g.add(place(kit.box(0.006, 0.006, 0.002, m.flat('#ff8c1a', { emissive: '#ff7a00' })), { x: px, y: dcy - dh * 0.42, z: pz + 0.0005 }));
    g.add(place(barHandle(c, dw * 0.8, handleP, { material: brushedOf(c), horizontal: true }), { x: dcx, y: dcy + dh / 2 - 0.035, z: pz }));
  } else {
    // visor, teclado e botão de abrir
    const vw = pw * 0.76;
    g.add(place(kit.box(vw + 0.006, 0.03, 0.002, m.plastic('#050506', { gloss: 0.9 }), { r: 0.003 }), { x: px, y: dcy + dh * 0.36, z: pz + 0.0008 }));
    g.add(place(decal(c, vw * 0.85, 0.022, displayMat(c, '12:00', '#4fe3a1')), { x: px, y: dcy + dh * 0.36, z: pz + 0.0021 }));
    const keyMat = dark || fin.steel ? m.plastic('#2c2d30', { gloss: 0.5 }) : m.plastic('#e4e5e7', { gloss: 0.5 });
    const kw = vw / 3 - 0.004;
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 3; k++) g.add(place(kit.box(kw, 0.014, 0.003, keyMat, { r: 0.0035 }), { x: px - vw / 3 + k * (vw / 3), y: dcy + dh * 0.18 - r * 0.022, z: pz + 0.0014 }));
    }
    g.add(place(knob(c, Math.min(0.016, pw * 0.15), 0.014, { material: keyMat, ring: false }), { x: px, y: dcy - dh * 0.2, z: pz }));
    g.add(place(kit.box(vw, 0.022, 0.004, keyMat, { r: 0.005 }), { x: px, y: dcy - dh * 0.38, z: pz + 0.002 }));
    // pega vertical na borda da porta
    g.add(place(barHandle(c, dh * 0.7, handleP, { material: dark || fin.steel ? brushedOf(c) : m.plastic(kit.shade(C.main, -0.05), { gloss: 0.6 }), rod: 0.006 }), { x: dcx + dw / 2 - 0.018, y: dcy, z: pz }));
  }
  // saídas de ar na lateral direita
  for (let i = 0; i < 8; i++) g.add(place(kit.box(0.001, 0.004, Math.min(0.12, bodyD * 0.35), m.flat('#111')), { x: W / 2 - 0.0002, y: feetH + bodyH * 0.65 + i * 0.009, z: zB + bodyD * 0.3 }));
  return g;
}

/* ================================================================== */
/* Ar-condicionado                                                     */
/* ================================================================== */
function air_conditionerModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, m, C, W, H, D, place } = c;
  if (st.portable || H > Math.max(W, D) * 1.2) return portableAC(c);
  const g = kit.group('split');
  const body = m.plastic(C.main, { gloss: 0.45 });
  const b = Math.min(0.008, W * 0.02);
  // perfil lateral (z, y) já descontado do chanfro: costas retas, frente curva, saída de ar embaixo
  const z0 = -D / 2 + b;
  const z1 = D / 2 - b;
  const yb = b;
  const yt = H - b;
  const dd = z1 - z0;
  const hh = yt - yb;
  const s = new THREE.Shape();
  s.moveTo(z0, yb + 0.02);
  s.lineTo(z0, yt - 0.02);
  s.quadraticCurveTo(z0, yt, z0 + 0.02, yt);
  s.lineTo(z1 - dd * 0.32, yt);
  s.bezierCurveTo(z1 - dd * 0.06, yt, z1, yt - hh * 0.12, z1, yb + hh * 0.6);
  s.bezierCurveTo(z1, yb + hh * 0.36, z1 - dd * 0.04, yb + hh * 0.2, z1 - dd * 0.12, yb + hh * 0.1);
  s.quadraticCurveTo(z1 - dd * 0.2, yb, z1 - dd * 0.32, yb);
  s.lineTo(z0 + 0.02, yb);
  s.quadraticCurveTo(z0, yb, z0, yb + 0.02);
  const shell = kit.extrude(s, W, body, { bevel: b, curveSegments: 14, part: 'main' });
  shell.rotation.y = -PI / 2;
  g.add(shell);
  // z da frente numa altura y (amostrando o contorno)
  const pts = s.getPoints(24);
  const frontZ = (y) => {
    let best = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if ((p.y - y) * (q.y - y) <= 0 && p.y !== q.y) {
        const t = (y - p.y) / (q.y - p.y);
        best = Math.max(best, p.x + (q.x - p.x) * t);
      }
    }
    return best + b;
  };
  // saída de ar (fenda escura) com aleta
  const slotY = yb + hh * 0.1;
  const slotZ = z1 - dd * 0.22;
  g.add(place(kit.box(W - 0.06, 0.03, dd * 0.24, shadowOf(c)), { y: slotY, z: slotZ - 0.004 }));
  g.add(place(kit.box(W - 0.07, 0.004, dd * 0.28, body, { r: 0.0015, part: 'main' }), { y: slotY - 0.012, z: slotZ + 0.006, rx: 0.42 }));
  for (let i = 0; i < 9; i++) g.add(place(kit.box(0.002, 0.024, dd * 0.18, m.plastic('#e8e8e8', { gloss: 0.3 })), { x: -W / 2 + 0.06 + (i * (W - 0.12)) / 8, y: slotY + 0.002, z: slotZ - 0.01 }));
  // friso do painel frontal e visor
  const fy = yb + hh * 0.78;
  g.add(place(kit.box(W - 0.02, 0.0025, 0.004, m.flat('#c8cacc', { roughness: 0.5 })), { y: fy, z: frontZ(fy) - 0.0012 }));
  const vy = yb + hh * 0.42;
  const vz = frontZ(vy);
  g.add(place(kit.box(0.06, 0.022, 0.003, m.plastic('#0b0c0d', { gloss: 0.9 }), { r: 0.006 }), { x: W / 2 - 0.12, y: vy, z: vz - 0.0005 }));
  g.add(place(decal(c, 0.045, 0.016, displayMat(c, '23°', '#6fd3ff', { w: 128, h: 48 })), { x: W / 2 - 0.12, y: vy, z: vz + 0.0012 }));
  // grade de entrada no topo
  for (let i = 0; i < 5; i++) g.add(place(kit.box(W - 0.08, 0.0008, 0.006, m.flat('#9a9da1')), { y: H - 0.0003, z: -D / 2 + 0.03 + i * 0.014 }));
  return g;
}
// Ar portátil / climatizador: torre com grade frontal, painel no topo e rodízios
function portableAC(c) {
  const { kit, m, C, W, H, D, place } = c;
  const g = kit.group('ar-portatil');
  const body = m.plastic(C.main, { gloss: 0.45 });
  const wheel = 0.03;
  const bodyH = H - wheel;
  g.add(place(kit.box(W, bodyH, D, body, { r: Math.min(0.04, W * 0.1), seg: 4, part: 'main' }), { y: wheel + bodyH / 2 }));
  const gw = W - 0.06;
  const gh = bodyH * 0.22;
  g.add(place(kit.box(gw, gh, 0.004, m.plastic('#2a2c2f', { gloss: 0.3 }), { r: 0.01 }), { y: H - gh / 2 - 0.05, z: D / 2 + 0.0005 }));
  for (let i = 0; i < 6; i++) g.add(place(kit.box(gw - 0.01, 0.006, 0.012, body, { r: 0.002 }), { y: H - 0.05 - gh * (0.12 + i * 0.15), z: D / 2 - 0.003, rx: -0.4 }));
  // tanque de água / filtro (frente baixa)
  g.add(place(kit.box(gw * 0.7, bodyH * 0.25, 0.004, m.glass({ tint: '#7fb6d6', opacity: 0.5 }), { r: 0.01 }), { y: wheel + bodyH * 0.22, z: D / 2 + 0.0006 }));
  g.add(place(decal(c, 0.06, 0.02, displayMat(c, '22°', '#6fd3ff', { w: 128, h: 48 })), { y: H - 0.0005, z: 0, rx: -PI / 2 }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(place(kit.cylinder(wheel / 2, wheel / 2, 0.016, rubberOf(c), { seg: 16 }), { x: sx * (W / 2 - 0.04), y: wheel / 2, z: sz * (D / 2 - 0.04), rz: PI / 2 }));
  }
  return g;
}

/* ================================================================== */
/* Eletroportáteis                                                     */
/* ================================================================== */
function small_applianceModel(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const a = c.st.appliance;
  const fn = SMALL[a] || smallGeneric;
  return fn(c);
}

// Material do corpo dos portáteis: inox, plástico brilhante (retrô) ou fosco
function smallBody(c) {
  const { spec, st, C, m, kit } = c;
  if ((spec.material === 'steel' || st.inox) && steelColor(kit, C.main)) return m.metal(C.main, { finish: 'brushed' });
  if (st.retro) return m.paint(C.main, { gloss: 0.9 });
  return m.plastic(C.main, { gloss: 0.55 });
}
const trimOf = (c) => (c.st.retro ? chromeOf(c) : isDark(c.kit, c.C.main) ? c.m.metal('#a9acb0', { finish: 'brushed' }) : c.m.plastic('#2a2b2d', { gloss: 0.4 }));

// Cafeteira elétrica (gotejamento) com jarra de vidro e placa aquecedora
function coffeeMaker(c) {
  const { kit, m, st, W, H, D, place } = c;
  const g = kit.group('cafeteira');
  const retro = !!st.retro;
  const body = smallBody(c);
  const trim = trimOf(c);
  const n = retro ? 2.7 : 5;
  const baseH = Math.min(0.026, H * 0.08);
  // base (saia) cromada e pés
  g.add(loft(c, [[0, W / 2, D / 2], [baseH * 0.7, W / 2 * 0.995, D / 2 * 0.995], [baseH, W / 2 * 0.97, D / 2 * 0.97]], retro ? trim : body, { n, seg: 48, part: retro ? 'metal' : 'main' }));
  // corpo contínuo: torre atrás (costas e laterais retas) que avança para a frente na cabeça
  const tD = D * 0.56;
  const tz = -D / 2 + tD / 2;
  const yHead0 = H * 0.6;
  const yHead1 = H * 0.885;
  const aW = (W / 2) * 0.985;
  const ring = (y, front) => {
    const bb = (front + D / 2) / 2;
    return [y, aW, bb, -D / 2 + bb];
  };
  const rings = [ring(baseH - 0.002, -D / 2 + tD), ring(yHead0 - 0.01, -D / 2 + tD)];
  const hU = Math.min(0.035, (yHead1 - yHead0) * 0.4);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    rings.push(ring(yHead0 + hU * (1 - Math.cos((t * PI) / 2)), lerp(-D / 2 + tD, (D / 2) * 0.985, Math.sin((t * PI) / 2))));
  }
  rings.push(ring(yHead1, (D / 2) * 0.985));
  g.add(loft(c, rings, body, { n, seg: 72, part: 'main' }));
  // friso cromado
  const ringH = 0.004;
  g.add(loft(c, [[yHead1, W / 2 * 0.99, D / 2 * 0.99], [yHead1 + ringH, W / 2 * 0.99, D / 2 * 0.99]], trim, { n, seg: 72, part: 'metal' }));
  const dome = [];
  const yd0 = yHead1 + ringH;
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const ang = (t * PI) / 2;
    const k = Math.cos(ang) * 0.985 + 0.0001;
    dome.push([yd0 + (H - yd0) * Math.sin(ang), (W / 2) * Math.max(0.02, k), (D / 2) * Math.max(0.02, k), 0, 0, lerp(n, 2.2, t)]);
  }
  g.add(loft(c, dome, body, { n, seg: 72, capBottom: false, part: 'main' }));
  // jarra de vidro com café e placa aquecedora
  const rc = Math.min(W * 0.33, D * 0.2);
  const zc = D / 2 - rc - D * 0.045;
  const y0 = baseH;
  g.add(place(kit.cylinder(rc * 1.08, rc * 1.08, 0.006, m.plastic('#151515', { gloss: 0.4 }), { seg: 32 }), { y: y0 + 0.003, z: zc }));
  const cy0 = y0 + 0.006;
  const ch = yHead0 - 0.012 - cy0;
  const prof = [[rc * 0.86, 0], [rc * 0.98, ch * 0.06], [rc, ch * 0.42], [rc * 0.93, ch * 0.66], [rc * 0.82, ch * 0.78], [rc * 0.84, ch * 0.86]].map(([r, y]) => [r, y + cy0]);
  g.add(place(kit.lathe([[0.0001, cy0], ...prof], m.glass({ tint: '#dfe7ea', opacity: 0.22 }), { seg: 40 }), { z: zc }));
  g.add(place(kit.lathe([[0.0001, cy0 + 0.004], [rc * 0.9, cy0 + 0.004], [rc * 0.95, cy0 + ch * 0.06], [rc * 0.95, cy0 + ch * 0.36], [0.0001, cy0 + ch * 0.36]], m.plastic('#2a170c', { gloss: 0.25 }), { seg: 32 }), { z: zc }));
  g.add(place(kit.lathe([[rc * 0.84, cy0 + ch * 0.82], [rc * 0.87, cy0 + ch * 0.86], [rc * 0.87, cy0 + ch], [rc * 0.6, cy0 + ch], [0.0001, cy0 + ch]], m.plastic('#151515', { gloss: 0.6 }), { seg: 32, part: 'detail' }), { z: zc }));
  // alça da jarra (à esquerda)
  const hx0 = -rc * 0.86;
  g.add(place(kit.tube([[hx0, cy0 + ch * 0.92, 0], [hx0 - rc * 0.55, cy0 + ch * 0.9, 0], [hx0 - rc * 0.68, cy0 + ch * 0.6, 0], [hx0 - rc * 0.6, cy0 + ch * 0.3, 0], [hx0 - rc * 0.1, cy0 + ch * 0.24, 0]], Math.min(0.009, rc * 0.15), m.plastic('#151515', { gloss: 0.6 }), { seg: 40, radial: 10, part: 'detail' }), { z: zc }));
  g.add(place(kit.tube([[hx0 - rc * 0.62, cy0 + ch * 0.82, 0], [hx0 - rc * 0.7, cy0 + ch * 0.6, 0], [hx0 - rc * 0.62, cy0 + ch * 0.38, 0]], Math.min(0.0045, rc * 0.08), chromeOf(c), { seg: 24, radial: 8, part: 'metal' }), { z: zc + Math.min(0.006, rc * 0.1) }));
  // saída do filtro sob a cabeça
  g.add(place(kit.cylinder(rc * 0.5, rc * 0.5, 0.004, m.plastic('#111', { gloss: 0.3 }), { seg: 24 }), { y: yHead0 - 0.001, z: zc }));
  // botões e visor de água
  const by = yHead0 + (yHead1 - yHead0) * 0.32;
  const bxs = [-W * 0.3, -W * 0.18, -W * 0.06];
  bxs.forEach((bx, i) => {
    const bz = superZ(bx, (W / 2) * 0.985, (D / 2) * 0.985, n);
    const bm = i === 0 ? m.plastic('#d9dbdd', { gloss: 0.8 }) : m.plastic('#f2f2f2', { gloss: 0.8 });
    g.add(place(kit.cylinder(0.0065, 0.0065, 0.006, chromeOf(c), { seg: 18, part: 'metal' }), { x: bx, y: by, z: bz - 0.001, rx: PI / 2 }));
    g.add(place(kit.cylinder(0.005, 0.005, 0.004, bm, { seg: 18 }), { x: bx, y: by, z: bz + 0.002, rx: PI / 2 }));
  });
  g.add(place(kit.box(0.003, 0.0016, 0.001, m.flat('#3ad1ff', { emissive: '#3ad1ff' })), { x: bxs[2], y: by + 0.0112, z: superZ(bxs[2], W / 2, D / 2, n) }));
  // visor de água: faixa vertical com moldura cromada na frente direita da cabeça
  const wx = W * 0.3;
  const wa = aW;
  const wb = (D / 2) * 0.985;
  const t = Math.min(0.999, wx / wa);
  const dzdx = -(wb / wa) * Math.pow(t, n - 1) * Math.pow(Math.max(1e-4, 1 - Math.pow(t, n)), 1 / n - 1);
  const wry = Math.atan2(-dzdx, 1);
  const wz = superZ(wx, wa, wb, n);
  const wh = (yHead1 - yHead0) * 0.62;
  const wy = (yHead0 + yHead1) / 2 + 0.008;
  g.add(place(kit.box(0.014, wh, 0.004, trim, { r: 0.0019, part: 'metal' }), { x: wx, y: wy, z: wz - 0.0005, ry: wry }));
  g.add(place(kit.box(0.008, wh - 0.008, 0.002, m.plastic('#0e1012', { gloss: 0.9 })), { x: wx + Math.sin(wry) * 0.0016, y: wy, z: wz + Math.cos(wry) * 0.0016, ry: wry }));
  void tz;
  return g;
}

// Liquidificador (e processador/espremedor, com copo mais largo/baixo)
function blender(c, { wide = false, short = false } = {}) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('liquidificador');
  const body = smallBody(c);
  const baseH = H * (short ? 0.34 : 0.27);
  // base encostada atrás; o botão completa a profundidade na frente
  const bb = (D / 2) * 0.95;
  const bz = -D / 2 + bb;
  g.add(loft(c, [[0, W / 2 * 0.96, bb * 0.96, bz], [0.006, W / 2, bb, bz], [baseH * 0.7, W / 2 * 0.94, bb * 0.94, bz], [baseH, W / 2 * 0.8, bb * 0.8, bz]], body, { n: 4, seg: 48, part: 'main' }));
  // controles
  const fz = bz + superZ(0, W / 2 * 0.95, bb * 0.95) - 0.002;
  g.add(place(kit.box(W * 0.7, baseH * 0.38, 0.004, m.plastic('#1a1b1c', { gloss: 0.7 }), { r: 0.008 }), { y: baseH * 0.48, z: fz }));
  g.add(place(knob(c, Math.min(0.016, W * 0.08), Math.max(0.006, D / 2 - fz - 0.002), { material: chromeOf(c), ring: false }), { y: baseH * 0.48, z: fz + 0.002 }));
  for (const sx of [-1, 1]) g.add(place(kit.cylinder(0.006, 0.006, 0.004, m.plastic('#e8e8e8', { gloss: 0.6 }), { seg: 14 }), { x: sx * W * 0.22, y: baseH * 0.48, z: fz + 0.003, rx: PI / 2 }));
  // copo
  const lidH = Math.min(0.03, H * 0.08);
  const jy0 = baseH;
  const jy1 = H - lidH;
  const dx = -W * 0.07;
  const aBot = W * (wide ? 0.34 : 0.22);
  const aTop = Math.min(W * (wide ? 0.38 : 0.34), W / 2 - 0.004 + dx);
  const bTop = Math.min(bb * 0.86, aTop);
  g.add(loft(c, [[jy0, aBot * 1.15, aBot * 1.15, 0, dx], [jy0 + 0.02, aBot * 1.15, aBot * 1.15, 0, dx]], m.plastic('#1d1e20', { gloss: 0.4 }), { n: 3, seg: 40, part: 'detail' }));
  g.add(loft(c, [[jy0 + 0.02, aBot, Math.min(aBot, bTop), 0, dx], [jy1, aTop, bTop, 0, dx]], m.glass({ tint: '#d8e4e8', opacity: 0.25 }), { n: wide ? 2.4 : 3, seg: 40, capTop: false }));
  g.add(loft(c, [[jy1, aTop * 1.03, bTop * 1.03, 0, dx], [H - 0.004, aTop * 0.98, bTop * 0.98, 0, dx], [H, aTop * 0.9, bTop * 0.9, 0, dx]], m.plastic('#151617', { gloss: 0.5 }), { n: wide ? 2.4 : 3, seg: 40, part: 'detail' }));
  // lâminas
  for (const a of [0, PI / 2]) g.add(place(kit.box(aBot * 1.3, 0.002, 0.008, brushedOf(c)), { x: dx, y: jy0 + 0.03, ry: a + 0.4 }));
  // alça
  const hx = dx + aTop * 0.92;
  if (!wide) g.add(kit.tube([[hx, jy1 - 0.02, 0], [W / 2 - 0.013, jy1 - 0.04, 0], [W / 2 - 0.013, lerp(jy0, jy1, 0.35), 0], [dx + lerp(aBot, aTop, 0.3), lerp(jy0, jy1, 0.28), 0]], 0.012, m.plastic('#151617', { gloss: 0.5 }), { seg: 40, radial: 10, part: 'detail' }));
  else g.add(place(kit.cylinder(0.02, 0.02, Math.min(0.08, H - jy1 + 0.04), m.plastic('#151617', { gloss: 0.5 }), { seg: 20 }), { x: dx + aTop * 0.4, y: H - Math.min(0.08, H - jy1 + 0.04) / 2, z: -bTop * 0.3 }));
  void st;
  void C;
  return g;
}

// Air fryer: corpo arredondado, gaveta com alça e painel digital
function airFryer(c) {
  const { kit, m, C, W, H, D, place } = c;
  const g = kit.group('air-fryer');
  const body = smallBody(c);
  const handleP = Math.min(0.05, D * 0.15);
  const bd = (D - handleP) / 2;
  const dz = -handleP / 2;
  const n = 4.5;
  const rings = [[0, W / 2 * 0.95, bd * 0.95, dz], [0.008, W / 2, bd, dz], [H * 0.82, W / 2 * 0.97, bd * 0.97, dz]];
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const k = 0.97 * Math.cos((t * PI) / 2 * 0.85) ;
    rings.push([H * 0.82 + (H - H * 0.82) * Math.sin((t * PI) / 2), W / 2 * Math.max(0.6, k), bd * Math.max(0.6, k), dz]);
  }
  g.add(loft(c, rings, body, { n, seg: 56, part: 'main' }));
  // gaveta (frente) e alça
  const fz = dz + superZ(W * 0.34, W / 2, bd, n);
  const gh = H * 0.5;
  const gy = 0.012 + gh / 2;
  const dark = isDark(kit, C.main);
  g.add(place(slab(c, W * 0.7, gh, 0.012, dark ? m.plastic('#232426', { gloss: 0.6 }) : body, { r: 0.03, bevel: 0.004, part: 'main' }), { y: gy, z: fz }));
  const hw = Math.min(0.11, W * 0.38);
  const hz0 = fz + 0.006;
  g.add(place(kit.box(hw, 0.05, D / 2 - hz0, m.plastic('#141516', { gloss: 0.35 }), { r: 0.012, part: 'detail' }), { y: gy + gh * 0.12, z: hz0 + (D / 2 - hz0) / 2 }));
  g.add(place(kit.box(hw * 0.5, 0.012, 0.004, chromeOf(c), { r: 0.003, part: 'metal' }), { y: gy + gh * 0.12 + 0.016, z: D / 2 - 0.004 }));
  // painel digital (frente superior) e saídas de ar atrás
  const py = H * 0.74;
  const pz = dz + superZ(0, W / 2 * 0.97, bd * 0.97, n);
  g.add(place(kit.box(W * 0.46, H * 0.15, 0.004, m.plastic('#0b0c0d', { gloss: 0.9 }), { r: 0.012 }), { y: py, z: pz - 0.001 }));
  g.add(place(decal(c, W * 0.2, H * 0.06, displayMat(c, '200°', '#ff6a3c', { w: 192, h: 72 })), { y: py + H * 0.02, z: pz + 0.0012 }));
  for (let i = 0; i < 5; i++) g.add(place(kit.cylinder(0.004, 0.004, 0.001, m.flat('#9aa0a6', { emissive: '#3a3f44' }), { seg: 10 }), { x: -W * 0.16 + i * W * 0.08, y: py - H * 0.04, z: pz + 0.0012, rx: PI / 2 }));
  for (let i = 0; i < 6; i++) g.add(place(kit.box(W * 0.5, 0.004, 0.002, m.flat('#0a0a0a')), { y: H * 0.7 + i * 0.012, z: dz - superZ(0, W / 2 * 0.97, bd * 0.97, n) - 0.0005 }));
  return g;
}

// Chaleira elétrica: base, corpo, tampa, bico (+X) e alça (−X)
function kettle(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group('chaleira');
  const body = smallBody(c);
  const rb = D / 2;
  const handleExt = Math.min(0.04, (W - 2 * rb) * 0.6);
  const x0 = -W / 2 + handleExt + rb;
  const spoutX = W / 2;
  const baseH = Math.min(0.018, H * 0.07);
  g.add(place(kit.cylinder(rb * 0.98, rb, baseH, m.plastic('#161718', { gloss: 0.5 }), { seg: 40, part: 'detail' }), { x: x0, y: baseH / 2 }));
  const yTop = H * 0.84;
  const prof = st.retro
    ? [[rb * 0.8, baseH], [rb * 0.97, baseH + H * 0.06], [rb, H * 0.32], [rb * 0.9, H * 0.62], [rb * 0.74, yTop]]
    : [[rb * 0.9, baseH], [rb * 0.96, baseH + 0.01], [rb * 0.94, H * 0.5], [rb * 0.82, yTop]];
  g.add(place(kit.lathe([[0.0001, baseH], ...prof, [prof[prof.length - 1][0] * 0.96, yTop + 0.004]], body, { seg: 48, part: 'main' }), { x: x0 }));
  const rl = prof[prof.length - 1][0] * 0.96;
  g.add(place(kit.lathe([[rl, yTop + 0.003], [rl * 0.98, yTop + 0.012], [rl * 0.7, (yTop + H) / 2 + 0.006], [rl * 0.25, H - 0.012], [0.0001, H - 0.012]], m.plastic(isDark(kit, C.main) ? '#1a1b1c' : C.main, { gloss: 0.6 }), { seg: 40, part: 'detail' }), { x: x0 }));
  g.add(place(kit.cylinder(rl * 0.2, rl * 0.26, 0.012, trimOf(c), { seg: 20 }), { x: x0, y: H - 0.006 }));
  // bico
  const sl = Math.max(0.02, spoutX - (x0 + rb * 0.82));
  const sp = kit.cylinder(0.009, 0.02, sl * 1.25, body, { seg: 20, part: 'main' });
  sp.rotation.z = -PI / 3.2;
  sp.position.set(x0 + rb * 0.8 + sl * 0.45, yTop - 0.016, 0);
  g.add(sp);
  // alça
  g.add(kit.tube([[x0 - rb * 0.7, yTop - 0.004, 0], [-W / 2 + 0.012, yTop - 0.01, 0], [-W / 2 + 0.012, H * 0.42, 0], [x0 - rb * 0.92, H * 0.28, 0]], 0.012, m.plastic(isDark(kit, C.main) ? '#141516' : C.main, { gloss: 0.6 }), { seg: 40, radial: 12, part: 'detail' }));
  // visor de água
  g.add(place(kit.box(0.012, H * 0.4, 0.004, m.glass({ tint: '#2c3439', opacity: 0.7 }), { r: 0.002 }), { x: x0 - rb * 0.2, y: H * 0.45, z: rb * 0.95 }));
  return g;
}

// Torradeira: corpo arredondado, 2 fendas, alavanca e botões
function toaster(c) {
  const { kit, m, st, W, H, D, place } = c;
  const g = kit.group('torradeira');
  const body = smallBody(c);
  const leverP = 0.016;
  const bd = (D - leverP) / 2;
  const dz = -leverP / 2;
  const n = st.retro ? 3 : 4.5;
  const feet = 0.008;
  const rings = [[feet, W / 2 * 0.97, bd * 0.97, dz], [feet + 0.008, W / 2, bd, dz], [H - 0.02, W / 2, bd, dz], [H - 0.006, W / 2 * 0.97, bd * 0.93, dz], [H, W / 2 * 0.9, bd * 0.84, dz]];
  g.add(loft(c, rings, body, { n, seg: 56, part: 'main' }));
  g.add(loft(c, [[0, W / 2 * 0.95, bd * 0.95, dz], [feet, W / 2 * 0.95, bd * 0.95, dz]], trimOf(c), { n, seg: 56, part: 'metal' }));
  for (const sz of [-1, 1]) {
    g.add(place(kit.box(W * 0.62, 0.003, 0.03, m.flat('#0a0a0a', { roughness: 0.9 })), { y: H - 0.0005, z: dz + sz * bd * 0.36 }));
    g.add(place(kit.box(W * 0.66, 0.002, 0.036, trimOf(c), { r: 0.0009 }), { y: H - 0.0018, z: dz + sz * bd * 0.36 }));
  }
  // alavanca e botões na frente (lado direito)
  const fz = dz + bd;
  const lx = W * 0.32;
  g.add(place(kit.box(0.008, H * 0.5, 0.002, m.flat('#111')), { x: lx, y: H * 0.52, z: fz - 0.0004 }));
  g.add(place(kit.box(0.03, 0.012, leverP, m.plastic('#1a1b1c', { gloss: 0.5 }), { r: 0.004 }), { x: lx, y: H * 0.7, z: fz + leverP / 2 - 0.001 }));
  g.add(place(knob(c, 0.009, 0.01, { material: trimOf(c), ring: false }), { x: lx, y: H * 0.3, z: superZ(lx, W / 2, bd, n) + dz - 0.001 }));
  g.add(place(kit.box(0.04, 0.006, 0.006, m.plastic('#2a2b2d', { gloss: 0.3 })), { x: -W * 0.2, y: feet + 0.006, z: fz }));
  return g;
}

// Batedeira planetária: base, coluna, cabeça horizontal (perfil para a frente) e tigela de inox
function mixer(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('batedeira');
  const body = smallBody(c);
  const baseH = Math.min(0.045, H * 0.13);
  g.add(loft(c, [[0, W / 2 * 0.98, D / 2 * 0.98], [0.005, W / 2, D / 2], [baseH, W / 2 * 0.95, D / 2 * 0.92]], body, { n: 4, seg: 48, part: 'main' }));
  // coluna
  const cx = -W / 2 + W * 0.17;
  g.add(loft(c, [[baseH - 0.002, W * 0.13, D * 0.36, 0, cx], [H * 0.55, W * 0.105, D * 0.3, 0, cx], [H * 0.72, W * 0.1, D * 0.28, 0, cx]], body, { n: 3, seg: 40, capBottom: false, part: 'main' }));
  // cabeça (loft deitado ao longo de x)
  const hh = H * 0.17;
  const hd = D * 0.36;
  const L = W;
  const rings = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const prof = Math.pow(Math.sin(PI * clamp(0.03 + t * 0.94, 0.02, 0.98)), 0.28) * (1 - 0.18 * t);
    rings.push([-L / 2 + L * t, hh * Math.max(0.15, prof), hd * Math.max(0.15, prof * 0.95)]);
  }
  const head = loft(c, rings, body, { n: 3.2, seg: 44, part: 'main' });
  head.rotation.z = -PI / 2;
  const headY = H - Math.max(...rings.map((r) => r[1]));
  head.position.set(0, headY, 0);
  g.add(head);
  // tigela
  const bx = W * 0.14;
  const br = Math.min(D * 0.46, W * 0.24);
  const by0 = baseH;
  const bh = headY - hh * 0.8 - by0 - 0.01;
  g.add(place(kit.lathe([[0.0001, by0], [br * 0.5, by0], [br * 0.85, by0 + bh * 0.3], [br, by0 + bh * 0.85], [br * 1.04, by0 + bh], [br * 0.98, by0 + bh], [br * 0.93, by0 + bh * 0.85], [0.0001, by0 + bh * 0.85]], m.metal('#d4d6d8', { finish: 'brushed' }), { seg: 48, part: 'metal' }), { x: bx }));
  // batedor
  const beatTop = headY - hh * 0.6;
  g.add(place(kit.cylinder(0.006, 0.006, beatTop - (by0 + bh * 0.5), m.metal('#c9cbcd', { finish: 'brushed' }), { seg: 10 }), { x: bx, y: (beatTop + by0 + bh * 0.5) / 2 }));
  g.add(place(kit.tube([[-br * 0.45, by0 + bh * 0.85, 0], [-br * 0.5, by0 + bh * 0.35, 0], [0, by0 + bh * 0.2, 0], [br * 0.5, by0 + bh * 0.35, 0], [br * 0.45, by0 + bh * 0.85, 0]], 0.004, m.metal('#c9cbcd', { finish: 'brushed' }), { seg: 30, radial: 6, part: 'metal' }), { x: bx }));
  // detalhes: tampa frontal cromada, alavanca de velocidade e friso
  g.add(place(kit.cylinder(hh * 0.35, hh * 0.4, 0.008, chromeOf(c), { seg: 24, part: 'metal' }), { x: L / 2 - 0.006, y: headY, rz: PI / 2 }));
  g.add(place(kit.box(0.03, 0.008, 0.012, chromeOf(c), { r: 0.003, part: 'metal' }), { x: cx, y: headY - hh * 0.2, z: hd * 0.85 }));
  return g;
}

// Número de pás pelo nome ("6 pás") ou pelo estilo
const bladesOf = (c, def) => c.st.blades || Number((/(\d)\s*p[áa]s\b/i.exec(c.spec.label || '') || [])[1]) || def;
// Ventilador (mesa, coluna, parede ou teto)
function fan(c) {
  const { kit, m, st, C, W, H, D, place } = c;
  if (st.ceiling) return ceilingFan(c);
  const g = kit.group('ventilador');
  const body = smallBody(c);
  const R = st.wallMount ? Math.min(W / 2, (H - 0.03) / 2) : Math.min(W / 2, (H - 0.08) / 2.2);
  const cy = H - R;
  const zc = st.wallMount ? D / 2 - 0.014 : Math.min(D / 2 - 0.035, R * 0.35);
  // base redonda e coluna
  const baseR = D / 2;
  const baseA = Math.min(W / 2, baseR * 1.1);
  const wall = !!st.wallMount;
  const poleTop = cy - R * 0.2;
  if (wall) {
    // suporte de parede: placa atrás e braço até o motor
    g.add(place(kit.box(0.08, Math.min(0.16, cy), 0.012, body, { r: 0.004, part: 'main' }), { y: Math.min(0.16, cy) / 2, z: -D / 2 + 0.006 }));
    g.add(place(kit.box(0.03, 0.03, D / 2 + zc - 0.1, body, { r: 0.006, part: 'main' }), { y: 0.06, z: (-D / 2 + zc - 0.1) / 2 + 0.006 }));
    g.add(place(kit.cylinder(0.014, 0.016, poleTop - 0.06, body, { seg: 16, part: 'main' }), { y: 0.06 + (poleTop - 0.06) / 2, z: zc - 0.1 }));
  } else {
    g.add(loft(c, [[0, baseA * 0.98, baseR * 0.98], [0.01, baseA, baseR], [0.035, baseA * 0.8, baseR * 0.8], [0.045, baseA * 0.3, baseR * 0.3]], body, { n: 2.2, seg: 48, part: 'main' }));
    g.add(place(kit.cylinder(0.014, 0.016, poleTop - 0.045, st.retro ? chromeOf(c) : body, { seg: 16, part: 'main' }), { y: 0.045 + (poleTop - 0.045) / 2 }));
  }
  // motor atrás da grade
  const mz = zc - 0.05;
  g.add(place(disc(c, [[0.0001, -0.07], [R * 0.2, -0.07], [R * 0.28, -0.05], [R * 0.3, -0.01], [R * 0.24, 0.02], [0.0001, 0.02]], body, { seg: 32, part: 'main' }), { y: cy, z: mz }));
  g.add(place(kit.box(0.04, cy - poleTop + 0.02, 0.04, body, { r: 0.01, part: 'main' }), { y: (cy + poleTop) / 2 - 0.01, z: mz - 0.03 }));
  // botões na base
  if (!wall) for (let i = 0; i < 4; i++) g.add(place(kit.box(0.016, 0.008, 0.012, m.plastic(i === 0 ? '#c9332b' : '#e8e8e8', { gloss: 0.5 }), { r: 0.002 }), { x: -0.03 + i * 0.02, y: 0.04, z: baseR * 0.55, rx: -0.5 }));
  // grade (anéis + raios)
  const wire = st.retro ? chromeOf(c) : m.plastic(isDark(kit, C.main) ? '#2a2b2d' : '#f2f2f2', { gloss: 0.5 });
  const THREE = c.THREE;
  const fr = 0.012;
  const ringAt = (r, z, t) => g.add(place(kit.mesh(new THREE.TorusGeometry(r, t, 6, 64), wire, { part: 'detail' }), { y: cy, z }));
  ringAt(R - fr, zc - 0.03, fr);
  for (const [k, dz] of [[0.32, 0.03], [0.6, 0.022], [0.85, 0.012]]) ringAt(R * k, zc - 0.03 + dz, 0.0016);
  for (const [k, dz] of [[0.55, -0.03], [0.85, -0.018]]) ringAt(R * k, zc - 0.03 + dz, 0.0016);
  const spokes = 24;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * PI * 2;
    for (const back of [false, true]) {
      if (back && i % 2) continue;
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const r = lerp(R * 0.12, R - fr, k / 4);
        const dz = (back ? -0.035 : 0.035) * Math.cos(((k / 4) * PI) / 2);
        pts.push([Math.cos(a) * r, cy + Math.sin(a) * r, zc - 0.03 + dz]);
      }
      g.add(kit.tube(pts, 0.0013, wire, { seg: 8, radial: 4, part: 'detail' }));
    }
  }
  g.add(place(disc(c, [[0.0001, 0], [R * 0.13, 0], [R * 0.12, 0.008], [0.0001, 0.01]], st.retro ? chromeOf(c) : m.plastic(C.accent || '#c3c5c7', { gloss: 0.6 }), { seg: 28 }), { y: cy, z: zc + 0.004 }));
  // pás
  const blades = bladesOf(c, 6);
  const bladeMat = m.glass({ tint: isDark(kit, C.main) ? '#3a3d40' : '#bcd6e6', opacity: 0.7 });
  const bs = new THREE.Shape();
  const bl = R * 0.8;
  bs.moveTo(0, -0.012);
  bs.bezierCurveTo(bl * 0.4, -bl * 0.28, bl * 0.95, -bl * 0.22, bl, 0);
  bs.bezierCurveTo(bl * 0.95, bl * 0.2, bl * 0.4, bl * 0.18, 0, 0.012);
  for (let i = 0; i < blades; i++) {
    const bm = kit.extrude(bs, 0.002, bladeMat, { curveSegments: 10 });
    const piv = new THREE.Group();
    bm.rotation.x = 0.35;
    piv.add(bm);
    piv.rotation.z = (i / blades) * PI * 2;
    piv.position.set(0, cy, zc - 0.03);
    g.add(piv);
  }
  g.add(place(kit.cylinder(R * 0.1, R * 0.1, 0.03, m.plastic('#202122', { gloss: 0.4 }), { seg: 20 }), { y: cy, z: zc - 0.035, rx: PI / 2 }));
  return g;
}
function ceilingFan(c) {
  const { kit, m, C, W, H, place, THREE } = c;
  const g = kit.group('ventilador-teto');
  const body = smallBody(c);
  const hubH = Math.min(0.12, H * 0.3);
  g.add(kit.lathe([[0.0001, 0], [0.06, 0], [0.09, 0.03], [0.09, hubH * 0.8], [0.05, hubH], [0.0001, hubH]], body, { seg: 40, part: 'main' }));
  g.add(place(kit.cylinder(0.012, 0.012, H - hubH - 0.05, body, { seg: 12, part: 'main' }), { y: hubH + (H - hubH - 0.05) / 2 }));
  g.add(place(kit.lathe([[0.0001, 0], [0.04, 0], [0.07, 0.04], [0.07, 0.05], [0.0001, 0.05]], body, { seg: 32, part: 'main' }), { y: H - 0.05 }));
  const blades = bladesOf(c, 4);
  const wood = c.st.woodLook ? m.wood(C.wood, { grain: 'smooth' }) : m.wood('#8a5a36', { grain: 'smooth' });
  for (let i = 0; i < blades; i++) {
    const piv = new THREE.Group();
    const bl = W / 2 - 0.08;
    const blade = kit.box(bl, 0.006, 0.12, wood, { r: 0.002, part: 'wood' });
    blade.position.x = 0.08 + bl / 2;
    blade.rotation.x = 0.12;
    piv.add(blade);
    piv.add(c.place(kit.box(0.08, 0.008, 0.03, m.metal('#2a2b2d', { finish: 'brushed' })), { x: 0.07 }));
    piv.rotation.y = (i / blades) * PI * 2;
    piv.position.y = hubH * 0.55;
    g.add(piv);
  }
  return g;
}

// Panela elétrica / de pressão / pipoqueira: corpo redondo e tampa
function pot(c, kind) {
  const { kit, m, st, C, W, H, D, place } = c;
  const g = kit.group(kind);
  const body = smallBody(c);
  const R = Math.min(W, D) / 2;
  const handleExt = kind === 'pressure_cooker' ? 0 : Math.min(0.025, (W - 2 * R) / 2);
  const r = R - handleExt;
  const bodyH = H * (kind === 'popcorn' ? 0.42 : 0.68);
  g.add(kit.lathe([[0.0001, 0], [r * 0.9, 0], [r, 0.02], [r, bodyH * 0.9], [r * 0.97, bodyH], [0.0001, bodyH]], body, { seg: 48, part: 'main' }));
  if (kind === 'popcorn') {
    g.add(kit.lathe([[r * 0.85, bodyH], [r * 0.9, bodyH + (H - bodyH) * 0.5], [r * 0.55, H - 0.015], [r * 0.3, H - 0.006], [0.0001, H]], m.glass({ tint: '#f3e6c4', opacity: 0.35 }), { seg: 40 }));
  } else {
    const lidMat = kind === 'rice_cooker' ? m.plastic(st.retro ? C.main : kit.shade(C.main, -0.03), { gloss: 0.6 }) : m.metal('#cfd2d4', { finish: 'brushed' });
    g.add(kit.lathe([[r * 0.98, bodyH], [r, bodyH + 0.006], [r * 0.85, bodyH + (H - bodyH) * 0.6], [r * 0.4, H - 0.02], [0.0001, H - 0.02]], lidMat, { seg: 48, part: 'detail' }));
    g.add(place(kit.cylinder(0.018, 0.022, 0.02, m.plastic('#151617', { gloss: 0.5 }), { seg: 20 }), { y: H - 0.01 }));
  }
  if (handleExt > 0.005) for (const sx of [-1, 1]) g.add(place(kit.box(handleExt + 0.01, 0.02, 0.06, m.plastic('#151617', { gloss: 0.4 }), { r: 0.006 }), { x: sx * (r + handleExt / 2 - 0.005), y: bodyH * 0.82 }));
  if (kind === 'pressure_cooker') g.add(place(kit.box(0.1, 0.022, 0.03, m.plastic('#151617', { gloss: 0.4 }), { r: 0.008 }), { y: H - 0.04, z: 0 }));
  g.add(place(kit.box(r * 0.6, bodyH * 0.22, 0.004, m.plastic('#0d0e0f', { gloss: 0.8 }), { r: 0.006 }), { y: bodyH * 0.45, z: r - 0.001 }));
  g.add(place(decal(c, r * 0.4, bodyH * 0.1, displayMat(c, 'ON', '#ff6a3c', { w: 128, h: 48 })), { y: bodyH * 0.45, z: r + 0.0012 }));
  return g;
}

// Sanduicheira / grill: concha inferior e superior com alça
function sandwichMaker(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('sanduicheira');
  const body = smallBody(c);
  const hp = Math.min(0.03, D * 0.15);
  const bd = (D - hp) / 2;
  const dz = -hp / 2;
  g.add(loft(c, [[0, W / 2 * 0.94, bd * 0.94, dz], [0.006, W / 2, bd, dz], [H * 0.45, W / 2, bd, dz]], body, { n: 3.5, seg: 48, part: 'main' }));
  g.add(loft(c, [[H * 0.45, W / 2 * 0.99, bd * 0.99, dz], [H * 0.47, W / 2 * 0.99, bd * 0.99, dz]], m.plastic('#111', { gloss: 0.3 }), { n: 3.5, seg: 48 }));
  g.add(loft(c, [[H * 0.47, W / 2, bd, dz], [H * 0.85, W / 2 * 0.95, bd * 0.95, dz], [H, W / 2 * 0.78, bd * 0.78, dz]], body, { n: 3.5, seg: 48, part: 'main' }));
  g.add(place(kit.box(W * 0.4, H * 0.18, hp + 0.01, m.plastic('#151617', { gloss: 0.4 }), { r: 0.008 }), { y: H * 0.55, z: dz + bd + hp / 2 - 0.005 }));
  for (const [x, col] of [[-0.02, '#ff3b30'], [0.02, '#34c759']]) g.add(place(kit.box(0.006, 0.006, 0.002, m.flat(col, { emissive: col })), { x, y: H * 0.98, z: dz + bd * 0.4, rx: -PI / 2 }));
  return g;
}

// Purificador / bebedouro: torre com torneira e bandeja
function waterPurifier(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('purificador');
  const body = smallBody(c);
  const tp = 0.04;
  const bd = D - tp;
  const zb = -D / 2 + bd / 2;
  g.add(place(kit.box(W, H, bd, body, { r: Math.min(0.03, W * 0.12), seg: 4, part: 'main' }), { y: H / 2, z: zb }));
  const zf = -D / 2 + bd;
  g.add(place(kit.box(W * 0.7, H * 0.14, 0.012, m.plastic('#1a1b1c', { gloss: 0.6 }), { r: 0.01 }), { y: H * 0.62, z: zf + 0.006 }));
  g.add(place(kit.cylinder(0.008, 0.01, tp, chromeOf(c), { seg: 16, part: 'metal' }), { y: H * 0.55, z: zf + tp / 2, rx: PI / 2 }));
  g.add(place(kit.box(W * 0.6, 0.02, tp + 0.01, m.plastic('#2a2b2d', { gloss: 0.4 }), { r: 0.006 }), { y: 0.03, z: zf + (tp + 0.01) / 2 - 0.01 }));
  g.add(place(decal(c, W * 0.3, 0.02, displayMat(c, '10°', '#5fd1ff', { w: 128, h: 48 })), { y: H * 0.64, z: zf + 0.0125 }));
  return g;
}

// Aquecedor a óleo (aletas) com controles
function heater(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('aquecedor');
  const body = smallBody(c);
  const wheel = 0.03;
  const ctrl = Math.min(0.08, W * 0.2);
  const fins = Math.max(4, Math.floor((W - ctrl) / 0.045));
  const fw = (W - ctrl) / fins;
  for (let i = 0; i < fins; i++) {
    g.add(place(slab(c, D * 0.92, H - wheel - 0.01, fw * 0.75, body, { r: Math.min(0.06, D * 0.4), bevel: Math.min(0.006, fw * 0.3), part: 'main' }), { x: -W / 2 + ctrl + fw * (i + 0.5), y: wheel + 0.01 + (H - wheel - 0.01) / 2, ry: PI / 2 }));
  }
  g.add(place(kit.box(ctrl, H * 0.3, D * 0.5, body, { r: 0.01, part: 'main' }), { x: -W / 2 + ctrl / 2, y: H * 0.75 }));
  g.add(place(knob(c, 0.012, 0.012), { x: -W / 2 + ctrl / 2, y: H * 0.78, z: D * 0.25 }));
  for (const sx of [-1, 1]) {
    g.add(place(kit.box(0.03, 0.01, D, m.plastic('#1b1c1d', { gloss: 0.3 })), { x: sx * W * 0.3, y: wheel }));
    for (const sz of [-1, 1]) g.add(place(kit.cylinder(wheel / 2, wheel / 2, 0.012, rubberOf(c), { seg: 14 }), { x: sx * W * 0.3, y: wheel / 2, z: sz * (D / 2 - wheel / 2), rz: PI / 2 }));
  }
  return g;
}

// Caixa de som / soundbar: corpo arredondado com tela de tecido
function speaker(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('caixa-de-som');
  const body = smallBody(c);
  g.add(place(kit.box(W, H, D - 0.004, body, { r: Math.min(H, D) * 0.25, seg: 4, part: 'main' }), { y: H / 2, z: -0.002 }));
  const rr = Math.min(H, D) * 0.25;
  g.add(place(slab(c, W - rr * 1.2, H - rr * 1.2, 0.008, m.fabric('#2a2b2d', { kind: 'cotton' }), { r: rr * 0.6, bevel: 0.002, part: 'detail' }), { y: H / 2, z: D / 2 - 0.004 }));
  for (let i = 0; i < 3; i++) g.add(place(kit.cylinder(0.006, 0.006, 0.003, m.plastic('#1a1b1c', { gloss: 0.5 }), { seg: 12 }), { x: -0.02 + i * 0.02, y: H - 0.001, z: -D * 0.1 }));
  return g;
}

// Ferro de passar: base em ponta, corpo e alça
function iron(c) {
  const { kit, m, W, H, D, place, THREE } = c;
  const g = kit.group('ferro');
  const body = smallBody(c);
  const s = new THREE.Shape();
  const iw = W / 2 - 0.002;
  const id = D / 2 - 0.002;
  s.moveTo(-iw, -id);
  s.lineTo(iw, -id);
  s.quadraticCurveTo(iw, id * 0.2, 0, id);
  s.quadraticCurveTo(-iw, id * 0.2, -iw, -id);
  const sole = kit.extrude(s, 0.012, m.metal('#cfd2d4', { finish: 'brushed' }), { bevel: 0.002, part: 'metal' });
  sole.rotation.x = -PI / 2;
  sole.position.y = 0.006;
  g.add(sole);
  const top = kit.extrude(s, H * 0.4, body, { bevel: 0.01, part: 'main' });
  top.rotation.x = -PI / 2;
  top.scale.set(0.92, 0.92, 1);
  top.position.y = 0.012 + H * 0.2;
  g.add(top);
  g.add(kit.tube([[0, H * 0.5, -D * 0.38], [0, H - 0.015, -D * 0.25], [0, H - 0.015, D * 0.15], [0, H * 0.55, D * 0.3]], 0.014, body, { seg: 40, radial: 12, part: 'main' }));
  return g;
}

// Aspirador vertical: bocal no chão, tubo, corpo e cabo
function vacuum(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('aspirador');
  const body = smallBody(c);
  if (H < 0.2) {
    g.add(kit.lathe([[0.0001, 0], [W / 2 * 0.96, 0], [W / 2, H * 0.3], [W / 2 * 0.97, H * 0.85], [W / 2 * 0.8, H], [0.0001, H]], body, { seg: 48, part: 'main' }));
    g.add(place(kit.cylinder(W * 0.08, W * 0.08, 0.004, m.plastic('#111', { gloss: 0.8 }), { seg: 24 }), { y: H, z: W * 0.15 }));
    return g;
  }
  g.add(place(kit.box(W, 0.05, Math.min(D, 0.1), body, { r: 0.015, part: 'main' }), { y: 0.025, z: D / 2 - Math.min(D, 0.1) / 2 }));
  g.add(place(kit.cylinder(0.016, 0.016, H * 0.55, m.metal('#c9cbcd', { finish: 'brushed' }), { seg: 14 }), { y: 0.05 + H * 0.275 }));
  g.add(place(kit.cylinder(0.05, 0.055, H * 0.25, m.glass({ tint: '#c9d6dd', opacity: 0.45 }), { seg: 28 }), { y: H * 0.68, z: -0.01 }));
  g.add(place(kit.box(0.08, H * 0.12, 0.1, body, { r: 0.02, part: 'main' }), { y: H * 0.85 }));
  g.add(kit.tube([[0, H * 0.9, 0.0], [0, H - 0.015, -0.03], [0, H - 0.02, -D / 2]], 0.013, m.plastic('#1a1b1c', { gloss: 0.4 }), { seg: 20, radial: 10 }));
  return g;
}

// Secador de cabelo: cano horizontal (saída para +X) e cabo
function hairDryer(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('secador');
  const body = smallBody(c);
  const r = D / 2;
  const cy = H - r;
  const barrel = kit.lathe([[0.0001, 0], [r * 0.9, 0], [r, W * 0.15], [r * 0.85, W * 0.7], [r * 0.6, W], [0.0001, W]], body, { seg: 40, part: 'main' });
  barrel.rotation.z = -PI / 2;
  barrel.position.set(-W / 2, cy, 0);
  g.add(barrel);
  g.add(place(kit.box(0.04, cy, D * 0.7, body, { r: 0.012, part: 'main' }), { x: -W * 0.12, y: cy / 2, rz: 0.15 }));
  return g;
}

// Prancha de cabelo: duas hastes em pé
function straightener(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('prancha');
  const body = smallBody(c);
  for (const sx of [-1, 1]) g.add(place(kit.box(W / 2 - 0.002, H, D, body, { r: Math.min(W, D) * 0.2, part: 'main' }), { x: (sx * W) / 4, y: H / 2 }));
  g.add(place(kit.box(W * 0.9, H * 0.35, 0.002, m.metal('#cfd2d4', { finish: 'brushed' })), { y: H * 0.78, z: D / 2 }));
  return g;
}

// Celular / tablet em pé (tela com imagem)
function slate(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('tela-portatil');
  const body = smallBody(c);
  const r = Math.min(W, H) * 0.12;
  g.add(place(slab(c, W, H, D, body, { r, bevel: Math.min(D / 2.5, 0.002), part: 'main' }), { y: H / 2 }));
  const bz = Math.min(W, H) * 0.045;
  g.add(place(slab(c, W - 2 * bz, H - 2 * bz, 0.0006, m.screen({ on: false }), { r: r * 0.8, bevel: 0 }), { y: H / 2, z: D / 2 + 0.0002 }));
  const sw = W - 2 * bz - r * 0.6;
  const sh = H - 2 * bz - r * 0.6;
  g.add(place(decal(c, sw, sh, pictureMat(c, H > W)), { y: H / 2, z: D / 2 + 0.0008 }));
  return g;
}

// Notebook fechado / videogame: placa com friso e luzes
function slabDevice(c, kind) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group(kind);
  const body = smallBody(c);
  g.add(place(kit.box(W, H, D, body, { r: Math.min(H / 2.5, 0.01), part: 'main' }), { y: H / 2 }));
  if (kind === 'laptop') {
    g.add(place(kit.box(W - 0.004, 0.0012, 0.0008, m.flat('#111')), { y: H * 0.45, z: D / 2 + 0.0003 }));
    g.add(place(kit.box(0.03, 0.0008, 0.03, m.metal('#d0d3d6', { finish: 'chrome' })), { y: H + 0.0002 }));
  } else {
    g.add(place(kit.box(W - 0.02, 0.003, 0.002, m.flat('#4fa3ff', { emissive: '#3b8cff' })), { y: H * 0.5, z: D / 2 + 0.0006 }));
    g.add(place(kit.box(0.01, 0.004, 0.002, m.plastic('#e8e8e8', { gloss: 0.6 })), { x: -W * 0.35, y: H * 0.5, z: D / 2 + 0.0008 }));
  }
  return g;
}

// Eletroportátil desconhecido: corpo arredondado com painel e botão
function smallGeneric(c) {
  const { kit, m, W, H, D, place } = c;
  const g = kit.group('eletroportatil');
  const body = smallBody(c);
  const feet = Math.min(0.01, H * 0.05);
  g.add(loft(c, [[feet, W / 2 * 0.96, D / 2 * 0.96], [feet + 0.008, W / 2, D / 2], [H * 0.9, W / 2 * 0.98, D / 2 * 0.98], [H, W / 2 * 0.86, D / 2 * 0.86]], body, { n: 4, seg: 48, part: 'main' }));
  g.add(loft(c, [[0, W / 2 * 0.92, D / 2 * 0.92], [feet, W / 2 * 0.92, D / 2 * 0.92]], trimOf(c), { n: 4, seg: 48, part: 'metal' }));
  const fz = superZ(0, W / 2 * 0.98, D / 2 * 0.98);
  g.add(place(kit.box(W * 0.55, Math.min(0.04, H * 0.16), 0.004, m.plastic('#0d0e0f', { gloss: 0.85 }), { r: 0.006 }), { y: H * 0.7, z: fz - 0.001 }));
  g.add(place(knob(c, Math.min(0.014, W * 0.08), 0.012, { material: trimOf(c), ring: false }), { y: H * 0.38, z: fz - 0.001 }));
  return g;
}

const SMALL = {
  coffee_maker: coffeeMaker,
  blender: (c) => blender(c),
  food_processor: (c) => blender(c, { wide: true }),
  juicer: (c) => blender(c, { wide: true, short: true }),
  air_fryer: airFryer,
  kettle,
  toaster,
  mixer,
  fan,
  microwave: (c) => microwaveModel(c.spec, c.kit, c.THREE),
  rice_cooker: (c) => pot(c, 'rice_cooker'),
  pressure_cooker: (c) => pot(c, 'pressure_cooker'),
  popcorn: (c) => pot(c, 'popcorn'),
  sandwich_maker: sandwichMaker,
  water_purifier: waterPurifier,
  heater,
  speaker,
  iron,
  vacuum,
  hair_dryer: hairDryer,
  hair_straightener: straightener,
  phone: slate,
  tablet: slate,
  laptop: (c) => slabDevice(c, 'laptop'),
  console: (c) => slabDevice(c, 'console'),
};

/* ================================================================== */
/* Exportações                                                         */
/* ================================================================== */
// Normais unitárias (quinas vivas dos perfis de revolução geram normais curtas; o exportador GLB reclama)
function unitNormals(g) {
  g.traverse((o) => {
    const n = o.isMesh && o.geometry?.attributes?.normal;
    if (!n) return;
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      if (l > 1e-6 && Math.abs(l - 1) > 1e-4) n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, n.getZ(i) / l);
    }
  });
  return g;
}
export const tv = (spec, kit, THREE) => unitNormals(tvModel(spec, kit, THREE));
export const fridge = (spec, kit, THREE) => unitNormals(fridgeModel(spec, kit, THREE));
export const washer = (spec, kit, THREE) => unitNormals(washerModel(spec, kit, THREE));
export const stove = (spec, kit, THREE) => unitNormals(stoveModel(spec, kit, THREE));
export const microwave = (spec, kit, THREE) => unitNormals(microwaveModel(spec, kit, THREE));
export const air_conditioner = (spec, kit, THREE) => unitNormals(air_conditionerModel(spec, kit, THREE));
export const small_appliance = (spec, kit, THREE) => unitNormals(small_applianceModel(spec, kit, THREE));
