// Geradores de quarto: cama, beliche, berço, colchão, criado-mudo, cômoda e guarda-roupa.
// Cada função recebe (spec, kit, THREE) e devolve um THREE.Group em metros, com o chão em
// y = 0, centrado em x/z e a frente virada para +Z. Tudo é montado na medida exata do spec
// (w x h x d), sem escalar formas redondas. Só usa materiais e formas do kit.
//
// Estilos lidos de spec.style (todos opcionais; model3d.style do produto pode forçar qualquer um):
//   cama .......... headboard 'panel'|'slats'|'upholstered'|'none', tufted, box, legs, nordic, trundle,
//                   headboardOnly, mattressSize, bedding ('#hex' do edredom)
//   beliche ....... triple (treliche), woodLook
//   berço ......... drawers, wheels
//   colchão ....... pillowTop, springs, pillow (travesseiro)
//   caixas ........ drawers, doors, niche, cane, mirror, glass, sliding, legs, retro, organic, rustic,
//                   sideboard, wheels, marble, handle ('bar'|'dowel'|'tab'|'knob'|'cutout'|'leather_strap'|'none'),
//                   front ('overlay'|'frame'|'rounded')

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */
const UPH = new Set(['velvet', 'linen', 'leather', 'boucle', 'suede', 'cotton', 'fabric']);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function ctx(spec, kit) {
  const st = spec.style || {};
  const C = { main: '#c8995e', accent: '#f3f1ec', wood: '#c8995e', metal: '#b8a16a', ...(spec.colors || {}) };
  return { spec, st, C, kit, m: kit.mat, W: kit.cm(spec.w), H: kit.cm(spec.h), D: kit.cm(spec.d) };
}

// Material do corpo: madeira (cor amadeirada), laca/pintura (MDF), metal ou plástico
function bodyMat(c, grain) {
  const { st, C, m, spec } = c;
  const mt = spec.material;
  if (st.woodLook) return m.wood(C.main, { grain: st.grain || grain || (st.rustic ? 'rustic' : mt === 'wood' ? 'oak' : 'smooth'), relief: darkRelief(c.kit, C.main) });
  if (mt === 'steel') return m.metal(C.main, { finish: 'brushed' });
  if (mt === 'metal') return m.metal(C.main, { finish: 'painted' });
  if (mt === 'lacquer') return m.paint(C.main, { gloss: 0.85 });
  if (mt === 'plastic') return m.plastic(C.main, { gloss: 0.4 });
  return m.paint(C.main, { gloss: 0.2 });
}
// Madeiras escuras: relevo do veio mais suave (o relevo fino reflete o ambiente e vira pontilhado)
const darkRelief = (kit, color) => (kit.luminance(color) < 0.3 ? 0.35 : undefined);
// Madeira dos pés/puxadores: a do corpo quando o móvel é amadeirado; senão a cor "wood"
const woodOf = (c) => (c.st.woodLook ? bodyMat(c) : c.m.wood(c.C.wood, { grain: 'oak' }));
const shadowMat = (m) => m.flat('#15110e', { roughness: 0.95 });

// Contorno retangular com raio próprio em cada canto [sup.esq, sup.dir, inf.dir, inf.esq]
function cornerShape(THREE, w, h, radii = [0, 0, 0, 0], PathClass) {
  const [tl, tr, br, bl] = radii.map((r) => clamp(r || 0, 0, Math.min(w, h) / 2 - 1e-4));
  const s = new (PathClass || THREE.Shape)();
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  // começa no meio da base e deixa cada arco se ligar sozinho ao ponto anterior: assim não surgem
  // pontos quase repetidos (que fazem o chanfro da extrusão "espetar" para fora da medida)
  s.moveTo((x0 + x1) / 2, y0);
  if (br > 0) s.absarc(x1 - br, y0 + br, br, -Math.PI / 2, 0, false);
  else s.lineTo(x1, y0);
  if (tr > 0) s.absarc(x1 - tr, y1 - tr, tr, 0, Math.PI / 2, false);
  else s.lineTo(x1, y1);
  if (tl > 0) s.absarc(x0 + tl, y1 - tl, tl, Math.PI / 2, Math.PI, false);
  else s.lineTo(x0, y1);
  if (bl > 0) s.absarc(x0 + bl, y0 + bl, bl, Math.PI, Math.PI * 1.5, false);
  else s.lineTo(x0, y0);
  s.lineTo((x0 + x1) / 2, y0);
  return s;
}
// Placa extrudada (frente em z = 0, fundo em z = -t), com chanfro arredondado que não muda a medida
function slab(kit, THREE, shape, t, mat, { bevel = 0.002, grain, part, curveSegments = 8 } = {}) {
  const b = Math.min(bevel, t / 4);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, t - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments,
  });
  geo.translate(0, 0, -(t - b));
  return kit.mesh(geo, mat, { grain, part });
}
// Caixa posicionada pelos limites (x0..x1, y0..y1, z0..z1)
// (chanfros pequenos usam menos segmentos: mesma aparência, montagem mais rápida)
function boxAt(kit, x0, x1, y0, y1, z0, z1, mat, opts = {}) {
  const r = opts.r || 0;
  const seg = opts.seg ?? (r <= 0.0025 ? 1 : r <= 0.006 ? 2 : 3);
  const b = kit.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat, { ...opts, seg });
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return b;
}
// Pés nos 4 cantos de um retângulo (meias medidas hx, hz) centrado em (0, cz)
function legs4(kit, g, type, { hx, hz, cz = 0, h, r, mat, splay, dirZ = 1, part }) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const L = kit.leg(type, { h, r, material: mat, splay, dir: [sx, sz * dirZ], part });
      g.add(kit.place(L, { x: sx * hx, z: cz + sz * hz }));
    }
  }
}
// Rodízio (placa, garfo e roda) com altura h
function caster(kit, m, h) {
  const g = kit.group('rodizio');
  const rw = h * 0.36;
  const wheel = kit.cylinder(rw, rw, rw * 0.75, m.rubber('#202020'), { seg: 18 });
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, rw, 0);
  const fork = kit.box(rw * 1.05, h - rw, rw * 1.2, m.metal('#c9cbcd', { finish: 'chrome' }), { r: 0.002 });
  fork.position.set(0, rw + (h - rw) / 2, -rw * 0.25);
  g.add(wheel, fork);
  return g;
}
// Tubo fechado ao longo de um retângulo arredondado (vivo/debrum de colchão), no plano y
function loopTube(kit, THREE, w, d, y, rc, radius, mat, part = 'detail') {
  const pts = [];
  const hx = w / 2 - rc;
  const hz = d / 2 - rc;
  // cantos em arco + pontos intermediários nos trechos retos (a spline não "embarriga")
  const corner = (cx, cz, a0) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * rc, y, cz + Math.sin(a) * rc));
    }
  };
  const edge = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.12));
    for (let i = 1; i < n; i++) pts.push(new THREE.Vector3(ax + ((bx - ax) * i) / n, y, az + ((bz - az) * i) / n));
  };
  corner(hx, hz, 0);
  edge(hx, hz + rc, -hx, hz + rc);
  corner(-hx, hz, Math.PI / 2);
  edge(-hx - rc, hz, -hx - rc, -hz);
  corner(-hx, -hz, Math.PI);
  edge(-hx, -hz - rc, hx, -hz - rc);
  corner(hx, -hz, Math.PI * 1.5);
  edge(hx + rc, -hz, hx + rc, hz);
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.isCurve = true; // kit.tube reconhece curvas por esta marca
  const per = 2 * (w + d);
  return kit.tube(curve, radius, mat, { seg: clamp(Math.round(per / 0.025), 60, 320), radial: 6, closed: true, part });
}
// Mede um objeto (Box3) depois de posicionado
const bounds = (kit, o) => kit.measure(o);

/* ================================================================== */
/* Superfície "caída" (edredom, pillow top): topo plano que dobra nas   */
/* bordas com raio rc e cai na vertical. Lados com hang = 0 ficam soltos */
/* ================================================================== */
function drape(kit, THREE, mat, o) {
  const { x0, x1, z0, z1, top, rc = 0.04, step = 0.03, relief = null, wave = 0, waveLen = 0.22, thick = 0, inner = true, dog = 0, part = 'detail', seed = 1 } = o;
  const hang = { l: 0, r: 0, f: 0, b: 0, ...(o.hang || {}) };
  const arc = (Math.PI / 2) * rc;
  const Lof = (h) => (h <= 0 ? 0 : h >= rc ? arc + (h - rc) : rc * Math.acos(1 - h / rc));
  const Ll = Lof(hang.l);
  const Lr = Lof(hang.r);
  const Lf = Lof(hang.f);
  const Lb = Lof(hang.b);
  const fx0 = x0 + (hang.l > 0 ? rc : 0);
  const fx1 = x1 - (hang.r > 0 ? rc : 0);
  const fz0 = z0 + (hang.b > 0 ? rc : 0);
  const fz1 = z1 - (hang.f > 0 ? rc : 0);
  const bend = (e) => {
    if (e <= arc) {
      const th = e / rc;
      return [rc * Math.sin(th), rc * (1 - Math.cos(th))];
    }
    return [rc, rc + (e - arc)];
  };
  const ph = (seed % 97) * 0.37;
  // posição sem relevo para (a, b) desdobrados; devolve também a direção "para fora" e quanto caiu
  const map = (a, b, out) => {
    let ex = 0;
    let sx = 0;
    let Lx = 1;
    if (a < fx0 && hang.l > 0) {
      ex = fx0 - a;
      sx = -1;
      Lx = Ll;
    } else if (a > fx1 && hang.r > 0) {
      ex = a - fx1;
      sx = 1;
      Lx = Lr;
    }
    let ez = 0;
    let sz = 0;
    let Lz = 1;
    if (b < fz0 && hang.b > 0) {
      ez = fz0 - b;
      sz = -1;
      Lz = Lb;
    } else if (b > fz1 && hang.f > 0) {
      ez = b - fz1;
      sz = 1;
      Lz = Lf;
    }
    let x = a;
    let y = top;
    let z = b;
    let dx = 0;
    let dz = 0;
    let down = 0;
    if (ex > 0 && ez > 0) {
      const nx = ex / Lx;
      const nz = ez / Lz;
      const rho = Math.max(nx, nz);
      const phi = Math.atan2(nz, nx);
      const L = Lx * Math.cos(phi) ** 2 + Lz * Math.sin(phi) ** 2;
      const e = rho * L * (1 + dog * Math.sin(2 * phi));
      const [ou, dn] = bend(e);
      dx = sx * Math.cos(phi);
      dz = sz * Math.sin(phi);
      x = (sx < 0 ? fx0 : fx1) + ou * dx;
      z = (sz < 0 ? fz0 : fz1) + ou * dz;
      y = top - dn;
      down = dn;
    } else if (ex > 0) {
      const [ou, dn] = bend(ex);
      dx = sx;
      x = (sx < 0 ? fx0 : fx1) + ou * sx;
      y = top - dn;
      down = dn;
    } else if (ez > 0) {
      const [ou, dn] = bend(ez);
      dz = sz;
      z = (sz < 0 ? fz0 : fz1) + ou * sz;
      y = top - dn;
      down = dn;
    }
    // ondas suaves na parte que cai (tecido não fica reto)
    if (wave > 0 && down > rc) {
      const k = smooth(rc, rc + 0.12, down);
      const s = (dz !== 0 && Math.abs(dz) > Math.abs(dx) ? a : b) + (dx !== 0 && dz !== 0 ? 0.5 : 0);
      const wv = wave * k * (Math.sin((s / waveLen) * Math.PI * 2 + ph) * 0.7 + Math.sin((s / (waveLen * 0.43)) * Math.PI * 2 + ph * 2.1) * 0.3);
      x += dx * wv;
      z += dz * wv;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = ex === 0 && ez === 0 ? 1 : 0;
    return out;
  };
  const a0 = fx0 - Ll;
  const a1 = fx1 + Lr;
  const b0 = fz0 - Lb;
  const b1 = fz1 + Lf;
  const NA = Math.max(4, Math.ceil((a1 - a0) / step));
  const NB = Math.max(4, Math.ceil((b1 - b0) / step));
  const nv = (NA + 1) * (NB + 1);
  const P = new Float32Array(nv * 3);
  const Pin = thick > 0 ? new Float32Array(nv * 3) : null;
  const UV = new Float32Array(nv * 2);
  const [tu, tv] = mat.userData?.tile || [1, 1];
  const p = [0, 0, 0, 0];
  const pa = [0, 0, 0, 0];
  const pb = [0, 0, 0, 0];
  const pc = [0, 0, 0, 0];
  const pd = [0, 0, 0, 0];
  const n = new THREE.Vector3();
  const ta = new THREE.Vector3();
  const tb = new THREE.Vector3();
  const eps = step * 0.35;
  for (let j = 0; j <= NB; j++) {
    const b = b0 + ((b1 - b0) * j) / NB;
    for (let i = 0; i <= NA; i++) {
      const a = a0 + ((a1 - a0) * i) / NA;
      const k = j * (NA + 1) + i;
      map(a, b, p);
      map(a + eps, b, pa);
      map(a - eps, b, pb);
      map(a, b + eps, pc);
      map(a, b - eps, pd);
      ta.set(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      tb.set(pc[0] - pd[0], pc[1] - pd[1], pc[2] - pd[2]);
      n.crossVectors(tb, ta).normalize();
      let rel = 0;
      if (relief && p[3]) {
        const edge = Math.min(a - fx0, fx1 - a, b - fz0, fz1 - b);
        rel = relief(a, b) * smooth(0, 0.06, edge);
      } else if (relief && o.reliefEdges) rel = relief(a, b) * 0.5;
      P[k * 3] = p[0] + n.x * rel;
      P[k * 3 + 1] = p[1] + n.y * rel;
      P[k * 3 + 2] = p[2] + n.z * rel;
      if (Pin) {
        Pin[k * 3] = p[0] - n.x * thick;
        Pin[k * 3 + 1] = p[1] - n.y * thick;
        Pin[k * 3 + 2] = p[2] - n.z * thick;
      }
      UV[k * 2] = a / tu;
      UV[k * 2 + 1] = b / tv;
    }
  }
  const idx = [];
  const idxIn = [];
  for (let j = 0; j < NB; j++) {
    for (let i = 0; i < NA; i++) {
      const v00 = j * (NA + 1) + i;
      const v10 = v00 + 1;
      const v01 = v00 + NA + 1;
      const v11 = v01 + 1;
      idx.push(v00, v01, v10, v10, v01, v11);
      idxIn.push(v00, v10, v01, v10, v11, v01);
    }
  }
  const mk = (pos, index) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(UV.slice(), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return kit.mesh(geo, mat, { keepUV: true, part });
  };
  const g = kit.group('drape');
  g.add(mk(P, idx));
  if (Pin) {
    // face de dentro (opcional: num edredom ela fica virada para o colchão e nunca aparece)
    if (inner) g.add(mk(Pin, idxIn));
    // bordas (une a face de fora e a de dentro), dupla face e normais por face
    const rim = [];
    const ruv = [];
    const ring = [];
    for (let i = 0; i <= NA; i++) ring.push(i);
    for (let j = 1; j <= NB; j++) ring.push(j * (NA + 1) + NA);
    for (let i = NA - 1; i >= 0; i--) ring.push(NB * (NA + 1) + i);
    for (let j = NB - 1; j >= 1; j--) ring.push(j * (NA + 1));
    ring.push(0);
    const q = (arr, k) => [arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]];
    for (let s = 0; s < ring.length - 1; s++) {
      const A = q(P, ring[s]);
      const B = q(P, ring[s + 1]);
      const Ai = q(Pin, ring[s]);
      const Bi = q(Pin, ring[s + 1]);
      for (const tri of [[A, Ai, B], [B, Ai, Bi], [A, B, Ai], [B, Bi, Ai]]) {
        for (const v of tri) {
          rim.push(v[0], v[1], v[2]);
          ruv.push((v[0] + v[2]) / tu, v[1] / tv);
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
    rg.computeVertexNormals();
    g.add(kit.mesh(rg, mat, { keepUV: true, part }));
  }
  return g;
}

// Travesseiro: duas faces estufadas que se encontram numa costura fina (deitado: w em x, t em y, l em z)
function pillowMesh(kit, THREE, mat, w, t, l, { pinch = 0.07, n = 22, mm = 16, part = 'detail' } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const [tu, tv] = mat.userData?.tile || [1, 1];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= mm; j++) {
      const v = -Math.cos((Math.PI * j) / mm);
      for (let i = 0; i <= n; i++) {
        const u = -Math.cos((Math.PI * i) / n);
        const x = u * (w / 2) * (1 - pinch * (1 - v * v));
        const z = v * (l / 2) * (1 - pinch * (1 - u * u));
        const f = Math.sqrt(Math.max(0, 1 - u ** 4)) * Math.sqrt(Math.max(0, 1 - v ** 4));
        const y = side * (t / 2) * Math.pow(f, 0.8) * (1 - 0.03 * (1 + Math.sin(u * 3.1 + v * 2.3)));
        pos.push(x, y, z);
        uv.push(x / tu, z / tv);
      }
    }
    for (let j = 0; j < mm; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return kit.mesh(geo, mat, { keepUV: true, part });
}
// Travesseiro inclinado (α em rad: 0 = deitado, ~1.2 = em pé encostado) com base em y0 e costas em zBack
function leaningPillow(kit, THREE, mat, { w, t, l, alpha, y0, zBack, x = 0, yaw = 0 }) {
  const p = pillowMesh(kit, THREE, mat, w, t, l);
  const holder = kit.group('travesseiro', p);
  p.rotation.x = alpha;
  holder.rotation.y = yaw;
  holder.updateMatrixWorld(true);
  const bb = bounds(kit, holder);
  holder.position.set(x, y0 - bb.min.y, zBack - bb.min.z);
  return holder;
}

/* ================================================================== */
/* Colchão                                                             */
/* ================================================================== */
// Colchão completo (base em y = 0, centrado). Opções: pillowTop, relevo matelassê real, alças, respiros
function mattressModel(kit, THREE, c, { W, H, D, pillowTop = true, top = '#f4f3ef', border = '#33353a', quilt = true, handles = true, step = 0.024 }) {
  const { m } = c;
  const g = kit.group('colchao');
  const pip = kit.luminance ? (kit.luminance(border) < 0.35 ? '#141416' : kit.shade(border, -0.45)) : '#141416';
  const pipingMat = m.fabric(pip, { kind: 'leather' });
  const borderMat = m.mattress(border, { kind: 'wave' });
  const topMat = quilt ? m.fabric(top, { kind: 'cotton' }) : m.mattress(top, { kind: 'quilted' });
  const hp = handles ? clamp(W * 0.006, 0.004, 0.009) : 0; // saliência das alças
  const pr = clamp(H * 0.022, 0.0035, 0.0065); // raio do vivo
  const Wc = W - 2 * Math.max(hp, pr * 1.35);
  const Dc = D - 2 * pr * 1.35;
  const topH = pillowTop ? clamp(H * 0.27, 0.035, 0.1) : clamp(H * 0.14, 0.02, 0.05);
  const relief = quilt ? clamp(H * 0.07, 0.008, 0.02) : 0;
  const hb = H - topH; // corpo (faixa lateral)
  // corpo com faixa lateral
  g.add(kit.place(kit.cushion(Wc, hb, Dc, borderMat, { puff: 0.012, r: clamp(hb * 0.12, 0.006, 0.025), side: 0.6, part: 'accent' }), { y: hb / 2 }));
  // tampo (pillow top): borda arredondada e matelassê em losangos
  const rc = clamp((topH - relief) * (pillowTop ? 0.6 : 0.85), 0.01, 0.045);
  const cell = clamp(Math.min(W, D) * 0.13, 0.08, 0.19);
  const qrel = (a, b) => {
    const u = (a + b) / cell;
    const v = (a - b) / cell;
    const du = Math.abs(u - Math.round(u));
    const dv = Math.abs(v - Math.round(v));
    let h = Math.pow(Math.min(1, Math.min(du, dv) / 0.5), 0.38);
    const dc = Math.hypot(du, dv);
    if (dc < 0.14) h *= 0.25 + 0.75 * (dc / 0.14);
    return relief * h;
  };
  const cap = drape(kit, THREE, topMat, {
    x0: -Wc / 2 + 0.001,
    x1: Wc / 2 - 0.001,
    z0: -Dc / 2 + 0.001,
    z1: Dc / 2 - 0.001,
    top: H - relief,
    rc,
    hang: { l: topH - relief, r: topH - relief, f: topH - relief, b: topH - relief }, // termina no vivo
    step: quilt ? step : Math.max(step, 0.06),
    relief: quilt ? qrel : null,
    part: 'main',
  });
  g.add(cap);
  // vivos (debrum) na junção do tampo e embaixo
  g.add(loopTube(kit, THREE, Wc + pr * 0.6, Dc + pr * 0.6, hb, clamp(rc, 0.015, 0.04), pr, pipingMat));
  g.add(loopTube(kit, THREE, Wc - 0.002, Dc - 0.002, pr * 1.1, 0.02, pr * 0.9, pipingMat));
  if (handles && H > 0.12 && D > 0.9) {
    // alças de tecido nas laterais compridas e respiros metálicos
    const strapMat = m.fabric(kit.shade(border, kit.luminance(border) < 0.35 ? 0.12 : -0.15), { kind: 'cotton' });
    const ringMat = m.metal('#c9c9c9', { finish: 'chrome' });
    const yH = hb * 0.55;
    for (const sx of [-1, 1]) {
      for (const zz of [-0.24, 0.24]) {
        const sl = clamp(D * 0.08, 0.1, 0.16);
        g.add(kit.place(kit.box(hp * 1.6, clamp(hb * 0.16, 0.022, 0.034), sl, strapMat, { r: hp * 0.7, part: 'detail' }), { x: sx * (Wc / 2 + hp * 0.2), y: yH, z: zz * D }));
        for (const dz of [-sl / 2, sl / 2]) g.add(kit.place(kit.box(hp * 1.2, clamp(hb * 0.2, 0.026, 0.04), 0.012, strapMat, { r: 0.002, part: 'detail' }), { x: sx * (Wc / 2 + hp * 0.05), y: yH, z: zz * D + dz }));
      }
      for (const zz of [-0.4, 0, 0.4]) {
        const v = kit.cylinder(0.011, 0.011, 0.004, ringMat, { seg: 16, part: 'detail' });
        v.rotation.z = Math.PI / 2;
        g.add(kit.place(v, { x: sx * (Wc / 2 + 0.0015), y: hb * 0.42, z: zz * D }));
      }
    }
    // etiqueta no pé
    g.add(kit.place(kit.box(clamp(W * 0.1, 0.08, 0.14), clamp(hb * 0.2, 0.025, 0.045), 0.003, m.fabric('#efe9dc', { kind: 'cotton' }), { r: 0.001, part: 'detail' }), { y: hb * 0.52, z: Dc / 2 + 0.001 }));
  }
  return g;
}
// Colchão já com lençol de elástico (para camas com roupa de cama)
function sheetMattress(kit, c, w, h, d, color) {
  return kit.cushion(w, h, d, c.m.fabric(color, { kind: 'linen' }), { puff: 0.05, r: clamp(h * 0.25, 0.015, 0.05), side: 0.4, part: 'detail' });
}

export function mattress(spec, kit, THREE) {
  const c = ctx(spec, kit);
  const { st, C, W, H, D, m } = c;
  // travesseiro
  if (st.pillow) {
    const g = kit.group('travesseiro');
    // deitado no maior lado em z
    const p = pillowMesh(kit, THREE, m.fabric(C.main, { kind: 'cotton' }), W, H, D, { part: 'main' });
    p.position.y = H / 2;
    g.add(p);
    return g;
  }
  const g = kit.group('colchao');
  if (H < 0.1) {
    // colchonete fino
    g.add(kit.place(kit.cushion(W, H, D, m.fabric(C.main, { kind: 'cotton' }), { puff: 0.1, r: H * 0.35, part: 'main' }), { y: H / 2 }));
    return g;
  }
  // cor escura/forte no nome ("Colchão ... Azul") costuma ser da faixa lateral; o tampo fica claro
  const strong = kit.luminance(C.main) < 0.5;
  const top = strong ? '#dfe2e4' : C.main;
  const border = strong ? C.main : C.accent;
  g.add(mattressModel(kit, THREE, c, { W, H, D, pillowTop: !!st.pillowTop, top, border, step: clamp(Math.sqrt(W * D) / 90, 0.012, 0.022) }));
  return g;
}

/* ================================================================== */
/* Roupa de cama                                                       */
/* ================================================================== */
const BEDDING = { sheet: '#e3d8c5', duvet: '#aeb2c4', pillowBack: '#dccfb8', pillowFront: '#f3f0e8' };

// Lençol + edredom com dobra + travesseiros sobre um colchão (topo mTop) entre x ±mw/2 e z mz0..mz1.
// sideOut / footOut: até onde o edredom pode cair por fora (x e z máximos)
function makeBed(kit, THREE, c, g, { mw, md, mz0, mTop, mh, sideOut, footOut, hangSide, hangFoot, maxY, pillows = 2, duvet = true, quilt = true }) {
  const { m, st } = c;
  const mz1 = mz0 + md;
  g.add(kit.place(sheetMattress(kit, c, mw, mh, md, BEDDING.sheet), { y: mTop - mh / 2, z: mz0 + md / 2 }));
  const duvetColor = st.bedding ? kit.hexOf(st.bedding) : BEDDING.duvet;
  const dMat = m.fabric(duvetColor, { kind: 'cotton' });
  // travesseiros: dois atrás (em pé, encostados) e dois na frente (mais deitados)
  const room = maxY - mTop - 0.01;
  const nP = mw > 1.05 ? 2 : 1;
  const pw = nP === 2 ? Math.min(0.72, (mw - 0.08) / 2) : Math.min(0.66, mw - 0.14);
  const pBack = m.fabric(BEDDING.pillowBack, { kind: 'linen' });
  const pFront = m.fabric(BEDDING.pillowFront, { kind: 'cotton' });
  let pillowEnd = mz0 + 0.1;
  if (room > 0.08 && pillows) {
    const tB = clamp(room * 0.4, 0.09, 0.17);
    const lB = 0.5;
    // inclinação que cabe na altura disponível
    let aB = 1.15;
    while (aB > 0.15 && lB * Math.sin(aB) + tB * Math.cos(aB) > room * 0.98) aB -= 0.05;
    const tF = tB * 0.85;
    const lF = 0.44;
    let aF = Math.min(0.62, aB * 0.6);
    while (aF > 0.08 && lF * Math.sin(aF) + tF * Math.cos(aF) > room * 0.85) aF -= 0.05;
    const xs = nP === 2 ? [-(pw / 2 + 0.012), pw / 2 + 0.012] : [0];
    xs.forEach((x, i) => {
      const yaw = (i === 0 ? 1 : -1) * 0.03 * (nP - 1);
      const back = leaningPillow(kit, THREE, pBack, { w: pw, t: tB, l: lB, alpha: aB, y0: mTop - 0.012, zBack: mz0 + 0.01, x, yaw });
      g.add(back);
      const bb = bounds(kit, back);
      const front = leaningPillow(kit, THREE, pFront, { w: pw * 0.92, t: tF, l: lF, alpha: aF, y0: mTop - 0.01, zBack: bb.max.z - Math.min(0.16, (bb.max.z - bb.min.z) * 0.55), x: x * 0.98, yaw: -yaw });
      g.add(front);
      pillowEnd = Math.max(pillowEnd, bounds(kit, front).max.z);
    });
  }
  if (!duvet) return pillowEnd;
  // edredom: cobre do meio para o pé, cai pelos lados e pelo pé; dobra virada na cabeceira
  const dz0 = Math.min(mz1 - 0.5, Math.max(pillowEnd - 0.04, mz0 + md * 0.3));
  const th = 0.022;
  const topY = mTop + 0.006 + th;
  const rc = 0.045;
  const qCell = 0.16;
  // gomos quadrados do edredom matelassê
  const qrel = quilt
    ? (a, b) => {
        const fu = a / qCell - Math.floor(a / qCell);
        const fv = b / qCell - Math.floor(b / qCell);
        return 0.016 * Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), 0.3);
      }
    : null;
  // resolução pela área do edredom (camas king não estouram o orçamento de triângulos)
  const areaU = (2 * sideOut + 2 * hangSide) * (footOut - dz0 + hangFoot);
  const dStep = Math.max(0.022, Math.sqrt(areaU / 6500));
  g.add(
    drape(kit, THREE, dMat, {
      x0: -sideOut,
      x1: sideOut,
      z0: dz0,
      z1: footOut,
      top: topY,
      rc,
      hang: { l: hangSide, r: hangSide, f: hangFoot, b: 0 },
      step: dStep,
      relief: qrel,
      reliefEdges: true,
      wave: 0.008,
      dog: 0.12,
      thick: th,
      inner: false,
      seed: 7,
    })
  );
  // dobra (barra virada) sobre o edredom
  const fold = Math.min(0.3, (footOut - dz0) * 0.22);
  g.add(
    drape(kit, THREE, dMat, {
      x0: -sideOut,
      x1: sideOut,
      z0: dz0 - 0.005,
      z1: dz0 + fold,
      top: topY + th * 0.9 + 0.004,
      rc: rc + 0.01,
      hang: { l: hangSide * 0.75, r: hangSide * 0.75, f: th * 1.2, b: 0 },
      step: dStep * 1.15,
      relief: qrel,
      reliefEdges: true,
      thick: th * 0.8,
      inner: false,
      seed: 11,
    })
  );
  return pillowEnd;
}

/* ================================================================== */
/* Cama                                                                */
/* ================================================================== */
// Cabeceira entre x ±W/2, z de zb (trás) a zb + T, até a altura H. y0 = base do painel estofado
function headboard(kit, THREE, c, g, { W, H, T, zb, type, body, uph, y0, s, mTop, tufted }) {
  const zf = zb + T;
  if (type === 'slats') {
    // ripado: ripas verticais sobre um painel de fundo mais escuro, montantes nas pontas
    const back = c.m.paint(kit.shade(c.C.main, -0.45), { gloss: 0.1 });
    const ys = Math.max(0, mTop - 0.12);
    g.add(boxAt(kit, -W / 2 + s, W / 2 - s, ys, H - 0.002, zb, zb + T * 0.35, back, { part: 'detail' }));
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (W / 2 - s), sx * (W / 2), 0, H, zb, zf, body, { r: 0.004, part: 'main', grain: 'y' }));
    const sw = 0.045;
    const gap = 0.017;
    const span = W - 2 * s - 0.01;
    const n = Math.max(3, Math.floor((span + gap) / (sw + gap)));
    const real = (span - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + real / 2 + i * (real + gap);
      g.add(boxAt(kit, x - real / 2, x + real / 2, ys, H - 0.004, zb + T * 0.35, zf - 0.004, body, { r: 0.003, part: 'main', grain: 'y' }));
    }
  } else if (type === 'upholstered') {
    // estofada (lisa com vivo, ou capitonê)
    const ph = H - y0;
    if (tufted) {
      // capitonê só na parte que aparece acima do colchão (economiza triângulos); embaixo, painel liso
      const yt = clamp(mTop - 0.01, y0, H - 0.25);
      const th = H - yt;
      const tOpts = { rows: Math.max(2, Math.round(th / 0.2)), depth: Math.min(0.035, T * 0.45), part: 'main' };
      if (W > 1.75) {
        // cabeceira larga (king): dois painéis espelhados que dividem a mesma geometria (metade do custo)
        const half = kit.tufted(W / 2, th, T, uph, { ...tOpts, cols: Math.max(3, Math.round(W / 2 / 0.2)) });
        g.add(kit.place(half, { x: -W / 4, y: yt + th / 2, z: zb + T / 2 }));
        g.add(kit.place(half.clone(true), { x: W / 4, y: yt + th / 2, z: zb + T / 2, s: [-1, 1, 1] }));
      } else {
        const tp = kit.tufted(W, th, T, uph, { ...tOpts, cols: Math.max(3, Math.round(W / 0.2)) });
        g.add(kit.place(tp, { y: yt + th / 2, z: zb + T / 2 }));
      }
      if (yt - y0 > 0.01) g.add(boxAt(kit, -W / 2, W / 2, y0, yt + 0.002, zb, zb + T - Math.min(0.035, T * 0.45), uph, { r: 0.01, part: 'main' }));
    } else {
      const panel = kit.cushion(W, T, ph, uph, { puff: 0.09, r: Math.min(0.03, T * 0.4), side: 0.15, part: 'main' });
      panel.rotation.x = Math.PI / 2;
      g.add(kit.place(panel, { y: y0 + ph / 2, z: zb + T / 2 }));
    }
    if (y0 > 0.005) {
      // pés da cabeceira
      const feetMat = c.m.wood(c.C.wood, { grain: 'oak' });
      for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (W / 2 - 0.08), sx * (W / 2 - 0.035), 0, y0 + 0.01, zb + T * 0.2, zf - T * 0.2, feetMat, { r: 0.004, part: 'wood' }));
    }
  } else {
    // painel de madeira emoldurado (montantes até o chão, travessa no topo, painel rebaixado)
    const rail = clamp(H * 0.055, 0.035, 0.07);
    const low = clamp(mTop - 0.08, 0.15, H - rail - 0.1);
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (W / 2 - s), sx * (W / 2), 0, H, zb, zf, body, { r: 0.004, part: 'main', grain: 'y' }));
    g.add(boxAt(kit, -W / 2 + s - 0.002, W / 2 - s + 0.002, H - rail, H, zb + 0.002, zf - 0.002, body, { r: 0.004, part: 'main' }));
    g.add(boxAt(kit, -W / 2 + s - 0.002, W / 2 - s + 0.002, low - rail, low, zb + 0.002, zf - 0.002, body, { r: 0.003, part: 'main' }));
    // painel entra 4 mm na moldura (sem arestas coincidentes, que geram linhas tracejadas de sombra)
    g.add(boxAt(kit, -W / 2 + s - 0.004, W / 2 - s + 0.004, low - 0.004, H - rail + 0.004, zb + T * 0.3, zb + T * 0.3 + Math.min(0.02, T * 0.45), body, { part: 'main', grain: 'x' }));
  }
}

function bedFrame(spec, kit, THREE, c, W, H, D) {
  const { st, C, m } = c;
  const g = kit.group('cama');
  const mt = spec.material;
  const upholsteredHead = st.headboard === 'upholstered';
  const uphKind = UPH.has(mt) ? mt : 'linen';
  const uph = m.upholstery(st.woodLook && upholsteredHead && !UPH.has(mt) ? '#b9b2a6' : C.main, uphKind);
  const body = bodyMat(c, st.rustic ? 'rustic' : 'oak');
  const upFrame = upholsteredHead || (UPH.has(mt) && !st.woodLook);
  const frameMat = upFrame ? uph : body;
  let head = st.headboard || (upFrame ? 'upholstered' : 'panel');
  if (st.tufted && head === 'panel') head = 'upholstered'; // capitonê é sempre estofado
  // sem cabeceira só quando a altura não comporta uma
  const legsT = st.legs === 'palito' ? 'palito' : st.legs === 'metal' ? 'metal' : st.legs === 'hidden' || st.legs === 'wood_base' ? 'plinth' : st.legs === 'turned' ? 'turned' : st.nordic && !upFrame ? 'sled' : upFrame ? 'feet' : 'posts';
  if (head === 'none' && H > 0.75) head = upFrame ? 'upholstered' : 'panel';
  const hasHead = head !== 'none' && H > 0.6;
  // alturas
  const pillowRise = 0.14;
  const beddingRise = 0.075; // edredom + dobra + relevo
  const mTop = hasHead ? clamp(H * 0.47, 0.3, 0.56) : Math.max(0.12, H - (H > 0.45 ? pillowRise : beddingRise));
  const maxY = hasHead ? H - 0.005 : H;
  const mh = clamp(mTop * 0.48, 0.12, 0.24);
  const railTop = upFrame ? mTop - 0.07 : mTop - Math.min(0.1, mh * 0.45);
  const legH = legsT === 'palito' ? clamp(railTop * 0.42, 0.1, 0.2) : legsT === 'metal' ? clamp(railTop * 0.35, 0.08, 0.18) : legsT === 'feet' ? clamp(railTop * 0.18, 0.04, 0.1) : legsT === 'plinth' ? clamp(railTop * 0.25, 0.04, 0.1) : 0;
  const railH = upFrame ? railTop - legH : legsT === 'plinth' || legsT === 'palito' || legsT === 'metal' ? Math.max(0.08, railTop - legH) : clamp(railTop * 0.48, 0.1, 0.2);
  const railBot = railTop - railH;
  // dimensões em planta
  const hbT = !hasHead ? 0 : head === 'upholstered' ? clamp(D * 0.045, 0.07, 0.11) : clamp(D * 0.026, 0.04, 0.06);
  const inset = 0.026; // grades recuadas para o edredom cair por fora
  const rt = upFrame ? clamp(W * 0.045, 0.05, 0.08) : clamp(W * 0.024, 0.028, 0.045);
  const Wf = W - 2 * inset;
  const zHead = -D / 2 + hbT;
  const zFootOut = D / 2 - inset;
  const s = legsT === 'turned' ? 0.065 : clamp(W * 0.032, 0.04, 0.06);
  // grades laterais e do pé
  if (upFrame) {
    // laterais estofadas (caixas bem arredondadas; o edredom cobre a parte de cima)
    const ur = Math.min(0.02, rt * 0.35);
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (Wf / 2 - rt), sx * (Wf / 2), railBot, railTop, zHead, zFootOut - 0.002, uph, { r: ur, part: 'main', grain: 'z' }));
    g.add(boxAt(kit, -Wf / 2 + rt - 0.004, Wf / 2 - rt + 0.004, railBot, railTop, zFootOut - rt, zFootOut, uph, { r: ur, part: 'main' }));
  } else {
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (Wf / 2 - rt), sx * (Wf / 2), railBot, railTop, zHead, zFootOut - rt + 0.001, frameMat, { r: 0.003, part: 'main', grain: 'z' }));
    g.add(boxAt(kit, -Wf / 2, Wf / 2, railBot, railTop, zFootOut - rt, zFootOut, frameMat, { r: 0.004, part: 'main' }));
  }
  // estrado (não aparece muito, mas segura o colchão)
  g.add(boxAt(kit, -Wf / 2 + rt, Wf / 2 - rt, railTop - mh * 0.55 - 0.02, railTop - mh * 0.55, zHead, zFootOut - rt, m.wood('#d6b88f', { grain: 'smooth' }), { part: 'detail' }));
  // pés / base
  const wood = woodOf(c);
  const footZ = zFootOut - s / 2;
  const headZ = zHead + s / 2;
  if (legsT === 'sled') {
    // nórdica: quadros fechados (montante, travessa no chão) no pé e na cabeceira
    const bar = clamp(railBot * 0.22, 0.03, 0.045);
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (Wf / 2 - s), sx * (Wf / 2), 0, railBot + 0.01, zFootOut - s, zFootOut, body, { r: 0.003, part: 'main', grain: 'y' }));
    g.add(boxAt(kit, -Wf / 2, Wf / 2, 0, bar, zFootOut - s * 0.9, zFootOut, body, { r: 0.003, part: 'main' }));
    if (hasHead && head !== 'upholstered') g.add(boxAt(kit, -W / 2 + 0.01, W / 2 - 0.01, 0, bar, zHead - hbT * 0.9, zHead - 0.002, body, { r: 0.003, part: 'main' }));
    else for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (Wf / 2 - s), sx * (Wf / 2), 0, railBot + 0.01, zHead, zHead + s, body, { r: 0.003, part: 'main', grain: 'y' }));
  } else if (legsT === 'posts' || legsT === 'turned') {
    for (const sx of [-1, 1]) {
      for (const z of hasHead && head !== 'upholstered' ? [footZ] : [footZ, headZ]) {
        if (legsT === 'turned') {
          const L = kit.leg('turned', { h: railTop + 0.04, r: s / 2, material: body, part: 'main' });
          g.add(kit.place(L, { x: sx * (Wf / 2 - s / 2 + 0.004), z }));
        } else g.add(boxAt(kit, sx * (Wf / 2 - s), sx * (Wf / 2), 0, railTop, z - s / 2, z + s / 2, body, { r: 0.004, part: 'main', grain: 'y' }));
      }
    }
  } else if (legsT === 'plinth') {
    g.add(boxAt(kit, -Wf / 2 + 0.06, Wf / 2 - 0.06, 0, railBot + 0.005, zHead + 0.06, zFootOut - 0.06, shadowMat(m), { part: 'detail' }));
  } else {
    // pés soltos sob a estrutura (palito, metal ou pés curtos de estofado)
    const type = legsT === 'palito' ? 'palito' : legsT === 'metal' ? 'metal_square' : 'tapered';
    const lm = legsT === 'metal' ? m.metal(C.metal || '#1f1f1f', { finish: 'painted' }) : wood;
    const hx = Wf / 2 - (legsT === 'palito' ? 0.09 : 0.05);
    const z0 = zHead + 0.08;
    const z1 = zFootOut - (legsT === 'palito' ? 0.09 : 0.05);
    for (const sx of [-1, 1]) {
      for (const [z, sz] of [[z0, -1], [z1, 1]]) {
        const L = kit.leg(type, { h: railBot + 0.004, r: legsT === 'palito' ? 0.022 : 0.02, material: lm, dir: [sx, sz * 0.6], splay: legsT === 'palito' ? 0.22 : 0, part: legsT === 'metal' ? 'metal' : 'wood' });
        g.add(kit.place(L, { x: sx * hx, z }));
      }
      if (Wf > 1.3) g.add(kit.place(kit.leg(type, { h: railBot + 0.004, r: 0.02, material: lm, part: 'wood' }), { x: 0, z: (z0 + z1) / 2 }));
    }
  }
  // cabeceira
  if (hasHead) headboard(kit, THREE, c, g, { W, H, T: hbT, zb: -D / 2, type: head, body, uph, y0: upFrame ? legH : 0, s, mTop, tufted: st.tufted });
  // bicama: gaveta-cama embaixo, puxadores no lado +X
  if (st.trundle && railBot > 0.12) {
    const tm = upFrame ? uph : body;
    g.add(boxAt(kit, -Wf / 2 + 0.01, Wf / 2 - 0.004, 0.025, railBot - 0.01, zHead + 0.02, zFootOut - 0.02, tm, { r: 0.003, part: 'main', grain: 'z' }));
    for (const z of [zHead + (zFootOut - zHead) * 0.3, zHead + (zFootOut - zHead) * 0.7]) {
      const p = kit.handle('bar', { material: m.metal(C.metal, { finish: 'brushed' }), len: 0.12 });
      p.rotation.y = Math.PI / 2;
      g.add(kit.place(p, { x: Wf / 2 - 0.004, y: (railBot + 0.025) / 2, z }));
    }
  }
  // colchão com lençol, edredom e travesseiros
  const mw = Wf - 2 * rt - 0.008;
  const mz0 = zHead + 0.006;
  const md = zFootOut - rt - 0.006 - mz0;
  makeBed(kit, THREE, c, g, {
    mw,
    md,
    mz0,
    mTop,
    mh,
    sideOut: W / 2 - 0.018, // folga para as ondas e o relevo do tecido
    footOut: D / 2 - 0.018,
    hangSide: Math.max(0.06, mTop + 0.03 - (railTop - Math.min(0.05, railH * 0.3))),
    hangFoot: Math.max(0.05, mTop + 0.03 - railTop + 0.01),
    maxY,
  });
  return g;
}

// Cama box (base estofada + colchão aparente) com cabeceira quando a altura comporta
function boxBed(spec, kit, THREE, c, W, H, D) {
  const { st, C, m } = c;
  const g = kit.group('cama-box');
  const mt = spec.material;
  const boxColor = st.woodLook || !C.main ? '#3a3b3f' : C.main;
  const boxMat = UPH.has(mt) ? m.upholstery(boxColor, mt) : m.fabric(boxColor, { kind: 'suede' });
  const want = st.headboard && st.headboard !== 'none';
  const fullSet = 0.36 + 0.28;
  const hasHead = want ? H > 0.62 : H > fullSet + 0.22;
  const hbT = hasHead ? clamp(D * 0.04, 0.06, 0.1) : 0;
  const baseOnly = !!st.baseOnly; // "Base box": só a base, sem colchão
  const pillowsUp = !hasHead && H > 0.5 && !baseOnly;
  const stack = hasHead ? Math.min(baseOnly ? 0.42 : fullSet, H * 0.62) : H - (pillowsUp ? 0.12 : 0);
  const mh = baseOnly ? 0 : clamp(stack * 0.44, 0.12, 0.32);
  const feet = clamp(stack * 0.05, 0.015, 0.045);
  const bh = stack - mh - feet;
  const sideIn = hasHead ? 0.015 : 0;
  const bw = W - 2 * sideIn;
  const zb = -D / 2 + hbT;
  const bd = D / 2 - zb;
  const zc = (zb + D / 2) / 2;
  // pés
  const footMat = m.plastic('#1b1b1b', { gloss: 0.3 });
  for (const sx of [-1, 1]) {
    for (const sz of bw > 1.3 ? [-1, 0, 1] : [-1, 1]) {
      const f = kit.cylinder(0.022, 0.018, feet, footMat, { seg: 14, part: 'detail' });
      g.add(kit.place(f, { x: sx * (bw / 2 - 0.08), y: feet / 2, z: zc + sz * (bd / 2 - 0.1) }));
    }
  }
  // base box (estofada) com faixa escura embaixo e vivo em cima
  g.add(kit.place(kit.cushion(bw, bh, bd, boxMat, { puff: 0.01, r: clamp(bh * 0.06, 0.008, 0.02), side: 0.5, part: 'main' }), { y: feet + bh / 2, z: zc }));
  g.add(kit.place(kit.box(bw - 0.03, 0.012, bd - 0.03, shadowMat(m), { part: 'detail' }), { y: feet + 0.004, z: zc }));
  g.add(kit.place(loopTube(kit, THREE, bw - 0.01, bd - 0.01, feet + bh - 0.004, 0.02, 0.0045, m.fabric(kit.shade(boxColor, -0.4), { kind: 'leather' })), { z: zc }));
  // colchão (pillow top) sobre o box
  if (!baseOnly) {
    const mat = mattressModel(kit, THREE, c, { W: bw - 0.004, H: mh, D: bd - 0.004, pillowTop: true, top: '#e2e5e6', border: boxColor, handles: false, step: 0.03 });
    g.add(kit.place(mat, { y: feet + bh, z: zc }));
  }
  const mTop = feet + bh + mh;
  // travesseiros
  const nP = bw > 1.05 ? 2 : 1;
  const pw = nP === 2 ? Math.min(0.68, (bw - 0.1) / 2) : Math.min(0.62, bw - 0.14);
  const pMat = m.fabric('#f7f6f2', { kind: 'cotton' });
  const room = H - mTop - 0.006;
  if (room > 0.06 && !baseOnly) {
    const t = clamp(room * 0.8, 0.08, 0.15);
    const alpha = hasHead ? Math.min(0.9, Math.asin(clamp((room * 0.9 - t * 0.6) / 0.48, 0, 1))) : 0.05;
    for (const x of nP === 2 ? [-(pw / 2 + 0.015), pw / 2 + 0.015] : [0]) {
      g.add(leaningPillow(kit, THREE, pMat, { w: pw, t: Math.min(t, room), l: 0.48, alpha: Math.max(0.05, alpha), y0: mTop - 0.012, zBack: zb + 0.02, x }));
    }
  }
  if (hasHead) {
    const type = st.headboard === 'slats' || st.headboard === 'panel' ? st.headboard : 'upholstered';
    const hm = UPH.has(mt) ? m.upholstery(boxColor, mt) : m.fabric(boxColor, { kind: 'suede' });
    headboard(kit, THREE, c, g, { W, H, T: hbT, zb: -D / 2, type, body: bodyMat(c), uph: hm, y0: 0, s: 0.05, mTop, tufted: st.tufted });
  }
  return g;
}

// Só a cabeceira (produto "Cabeceira estofada")
function headboardOnly(spec, kit, THREE, c, W, H, D) {
  const { st, C, m } = c;
  const g = kit.group('cabeceira');
  const mt = spec.material;
  const type = st.headboard && st.headboard !== 'none' ? st.headboard : UPH.has(mt) || !st.woodLook ? 'upholstered' : 'panel';
  const uph = m.upholstery(st.woodLook ? '#b9b2a6' : C.main, UPH.has(mt) ? mt : 'linen');
  headboard(kit, THREE, c, g, { W, H, T: D, zb: -D / 2, type, body: bodyMat(c), uph, y0: Math.min(0.25, H * 0.25), s: 0.045, mTop: H * 0.35, tufted: st.tufted });
  return g;
}

// Monta deitado no eixo Z; se as medidas vierem trocadas (largura > comprimento) gira 90°
function longAxis(kit, W, D, build) {
  if (W <= D * 1.08) return build(W, D);
  const inner = build(D, W);
  inner.rotation.y = Math.PI / 2;
  return kit.group('cama-girada', inner);
}

export function bed(spec, kit, THREE) {
  const c = ctx(spec, kit);
  const { st, W, H, D } = c;
  if (st.headboardOnly) return headboardOnly(spec, kit, THREE, c, W, H, D);
  return longAxis(kit, W, D, (w, d) => (st.box ? boxBed(spec, kit, THREE, c, w, H, d) : bedFrame(spec, kit, THREE, c, w, H, d)));
}

/* ================================================================== */
/* Beliche                                                             */
/* ================================================================== */
function bunkBuild(spec, kit, THREE, c, W, H, D) {
  const { st, m } = c;
  const g = kit.group('beliche');
  const body = st.woodLook ? bodyMat(c, 'oak') : bodyMat(c);
  const s = clamp(W * 0.06, 0.045, 0.07);
  const railH = 0.14;
  const rt = 0.028;
  const ins = 0.006;
  // montantes
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(boxAt(kit, sx * (W / 2 - s), sx * (W / 2), 0, H, sz * (D / 2 - s), sz * (D / 2), body, { r: 0.006, part: 'main', grain: 'y' }));
  const triple = !!st.triple;
  const lowRail = triple ? 0.3 : 0.14;
  const upRail = Math.max(lowRail + 0.7, H - 0.42);
  const mh = 0.13;
  const blanket = c.m.fabric(st.bedding ? kit.hexOf(st.bedding) : '#9fb3c8', { kind: 'cotton' });
  const pillowM = c.m.fabric('#f7f6f2', { kind: 'cotton' });
  const deck = (yTop, guard) => {
    const y0 = yTop - railH;
    // grades (laterais compridas e cabeceiras)
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (W / 2 - ins - rt), sx * (W / 2 - ins), y0, yTop, -D / 2 + s, D / 2 - s, body, { r: 0.003, part: 'main', grain: 'z' }));
    for (const sz of [-1, 1]) g.add(boxAt(kit, -W / 2 + s, W / 2 - s, y0, yTop, sz * (D / 2 - ins - rt), sz * (D / 2 - ins), body, { r: 0.003, part: 'main' }));
    // colchão com lençol, travesseiro e manta dobrada
    const mw = W - 2 * (ins + rt) - 0.01;
    const md = D - 2 * (ins + rt) - 0.01;
    const mBot = yTop - mh * 0.55;
    g.add(boxAt(kit, -mw / 2, mw / 2, mBot - 0.018, mBot, -md / 2, md / 2, m.wood('#d6b88f', { grain: 'smooth' }), { part: 'detail' }));
    g.add(kit.place(sheetMattress(kit, c, mw, mh, md, '#f1eee8'), { y: mBot + mh / 2 }));
    const mTop = mBot + mh;
    const room = guard ? Math.min(0.13, H - 0.01 - mTop) : 0.12;
    g.add(leaningPillow(kit, THREE, pillowM, { w: Math.min(0.6, mw - 0.12), t: Math.max(0.05, Math.min(0.11, room)), l: 0.42, alpha: 0.12, y0: mTop - 0.01, zBack: -md / 2 + 0.03 }));
    g.add(kit.place(kit.box(mw - 0.02, 0.035, md * 0.32, blanket, { r: 0.012, seg: 3, part: 'detail' }), { y: mTop + 0.014, z: md / 2 - md * 0.18 }));
    return mTop;
  };
  // ends com painel cheio entre montantes
  const endPanel = (y0, y1) => {
    for (const sz of [-1, 1]) g.add(boxAt(kit, -W / 2 + s, W / 2 - s, y0, y1, sz * (D / 2 - s * 0.5) - 0.009, sz * (D / 2 - s * 0.5) + 0.009, body, { r: 0.003, part: 'main' }));
  };
  deck(lowRail + railH, false);
  endPanel(lowRail + railH, lowRail + railH + 0.22);
  const upTop = upRail;
  deck(upTop, true);
  endPanel(upTop, H - 0.035);
  // guarda-corpo do andar de cima (lado da parede inteiro; lado da escada com abertura)
  const ladW = Math.min(0.42, D * 0.24);
  const ladZ1 = D / 2 - s - 0.02;
  const ladZ0 = ladZ1 - ladW;
  for (const y of [H - 0.075, upTop + (H - 0.075 - upTop) * 0.45]) {
    g.add(boxAt(kit, -W / 2 + ins, -W / 2 + ins + rt, y - 0.035, y + 0.035, -D / 2 + s, D / 2 - s, body, { r: 0.003, part: 'main', grain: 'z' }));
    g.add(boxAt(kit, W / 2 - ins - rt, W / 2 - ins, y - 0.035, y + 0.035, -D / 2 + s, ladZ0 - 0.02, body, { r: 0.003, part: 'main', grain: 'z' }));
  }
  g.add(boxAt(kit, W / 2 - ins - rt, W / 2 - ins, upTop, H - 0.04, ladZ0 - 0.06, ladZ0 - 0.02, body, { r: 0.003, part: 'main', grain: 'y' }));
  // escada vertical no lado +X (perto do pé)
  const lx0 = W / 2 - 0.036;
  for (const z of [ladZ0, ladZ1]) g.add(boxAt(kit, lx0, W / 2, 0, upTop + 0.32, z - 0.022, z + 0.022, body, { r: 0.004, part: 'main', grain: 'y' }));
  for (let y = 0.3; y < upTop + 0.05; y += 0.27) {
    const rung = kit.cylinder(0.014, 0.014, ladW - 0.04, body, { seg: 14, part: 'main' });
    rung.rotation.x = Math.PI / 2;
    g.add(kit.place(rung, { x: W / 2 - 0.02, y, z: (ladZ0 + ladZ1) / 2 }));
  }
  // treliche: cama auxiliar embaixo (gaveta-cama)
  if (triple) {
    const tw = W - 2 * s - 0.02;
    g.add(boxAt(kit, -tw / 2, tw / 2, 0.03, lowRail - 0.02, -D / 2 + s + 0.02, D / 2 - s - 0.02, body, { r: 0.003, part: 'main', grain: 'z' }));
    for (const sz of [-1, 1]) {
      const p = kit.handle('bar', { material: m.metal(c.C.metal, { finish: 'brushed' }), len: 0.12 });
      p.rotation.y = Math.PI / 2;
      g.add(kit.place(p, { x: tw / 2, y: (lowRail + 0.01) / 2, z: sz * D * 0.25 }));
    }
  }
  return g;
}
export function bunk_bed(spec, kit, THREE) {
  const c = ctx(spec, kit);
  return longAxis(kit, c.W, c.D, (w, d) => bunkBuild(spec, kit, THREE, c, w, c.H, d));
}

/* ================================================================== */
/* Berço                                                               */
/* ================================================================== */
// Monta com o lado comprido em X (frente +Z); gira se vier ao contrário
function cribBuild(spec, kit, THREE, c, L, H, Wd) {
  const { st, m } = c;
  const g = kit.group('berco');
  const body = bodyMat(c, 'smooth');
  const s = clamp(L * 0.035, 0.035, 0.05);
  const wheels = !!st.wheels;
  const cast = wheels ? 0.07 : 0;
  const drawer = (st.drawers || 0) > 0;
  const baseY = cast + (drawer ? 0.2 : 0.18); // grade de baixo
  const botRailH = 0.06;
  const deckY = baseY + botRailH; // estrado
  const topRail = 0.045;
  const yPost0 = cast;
  // montantes
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(boxAt(kit, sx * (L / 2 - s), sx * (L / 2), yPost0, H, sz * (Wd / 2 - s), sz * (Wd / 2), body, { r: 0.008, part: 'main', grain: 'y' }));
  if (wheels) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(kit.place(caster(kit, m, cast), { x: sx * (L / 2 - s / 2), z: sz * (Wd / 2 - s / 2) }));
  const rt = 0.03;
  // laterais compridas: travessas e grades (balaústres redondos com vão < 6,5 cm)
  for (const sz of [-1, 1]) {
    const zc = sz * (Wd / 2 - rt / 2 - 0.004);
    g.add(boxAt(kit, -L / 2 + s, L / 2 - s, baseY, baseY + botRailH, zc - rt / 2, zc + rt / 2, body, { r: 0.004, part: 'main' }));
    g.add(boxAt(kit, -L / 2 + s, L / 2 - s, H - topRail, H - 0.002, zc - rt / 2 - 0.004, zc + rt / 2 + 0.004, body, { r: 0.008, part: 'main' }));
    const span = L - 2 * s;
    const n = Math.max(6, Math.ceil(span / 0.085));
    const bh = H - topRail - (baseY + botRailH);
    for (let i = 1; i < n; i++) {
      const bar = kit.cylinder(0.011, 0.011, bh + 0.01, body, { seg: 12, part: 'main' });
      g.add(kit.place(bar, { x: -span / 2 + (span * i) / n, y: baseY + botRailH + bh / 2, z: zc }));
    }
  }
  // cabeceiras (lados curtos): painel cheio com topo arredondado
  const endH = H - 0.02 - baseY;
  for (const sx of [-1, 1]) {
    const shape = cornerShape(THREE, Wd - 2 * s, endH, [0.06, 0.06, 0, 0]);
    const pnl = slab(kit, THREE, shape, 0.018, body, { bevel: 0.003, grain: 'y', part: 'main' });
    pnl.rotation.y = Math.PI / 2;
    g.add(kit.place(pnl, { x: sx * (L / 2 - s / 2) + 0.009, y: baseY + endH / 2 }));
  }
  // gaveta embaixo
  if (drawer) {
    const dy0 = cast + 0.03;
    const zf = Wd / 2 - 0.03;
    g.add(boxAt(kit, -L / 2 + s + 0.004, L / 2 - s - 0.004, dy0, baseY - 0.006, -Wd / 2 + 0.03, zf, body, { r: 0.003, part: 'main' }));
    const p = makePull(kit, c, 'bar', { len: 0.14, mat: m.metal(c.C.metal, { finish: 'brushed' }) });
    g.add(kit.place(p, { y: (dy0 + baseY) / 2, z: zf }));
  }
  // estrado, colchão com lençol, travesseirinho e manta
  const mw = L - 2 * s - 0.01;
  const md = Wd - 2 * (rt + 0.004) - 0.01;
  g.add(boxAt(kit, -mw / 2, mw / 2, deckY - 0.015, deckY, -md / 2, md / 2, m.wood('#d6b88f', { grain: 'smooth' }), { part: 'detail' }));
  const mh = 0.11;
  g.add(kit.place(sheetMattress(kit, c, mw, mh, md, '#f3efe8'), { y: deckY + mh / 2 }));
  const mTop = deckY + mh;
  const pw = Math.min(0.4, md * 0.6);
  const pil = leaningPillow(kit, THREE, m.fabric('#f7f6f2', { kind: 'cotton' }), { w: pw, t: 0.07, l: 0.28, alpha: 0.05, y0: mTop - 0.006, zBack: -0.14 });
  pil.rotation.y = Math.PI / 2;
  pil.position.x = -mw / 2 + 0.2;
  pil.position.z = 0;
  g.add(pil);
  g.add(kit.place(kit.cushion(mw * 0.42, 0.03, md - 0.02, m.fabric(st.bedding ? kit.hexOf(st.bedding) : '#e9d7c9', { kind: 'cotton' }), { puff: 0.3, r: 0.012, part: 'detail' }), { x: mw * 0.25, y: mTop + 0.012 }));
  return g;
}
export function crib(spec, kit, THREE) {
  const c = ctx(spec, kit);
  const { W, H, D } = c;
  if (D <= W * 1.05) return cribBuild(spec, kit, THREE, c, W, H, D);
  const inner = cribBuild(spec, kit, THREE, c, D, H, W);
  inner.rotation.y = Math.PI / 2;
  return kit.group('berco-girado', inner);
}

/* ================================================================== */
/* Móveis de caixa: criado-mudo, cômoda e guarda-roupa                 */
/* ================================================================== */
// Puxador: origem na superfície da frente, saliente para +Z
function makePull(kit, c, type, { len = 0.1, vertical = false, mat } = {}) {
  const g = kit.group(`puxador:${type}`);
  if (type === 'none') return null;
  if (type === 'dowel') {
    // cavilha de madeira apoiada em dois pinos
    const r = 0.0085;
    const L = Math.max(0.05, len);
    const bar = kit.lathe([[0.0001, -L / 2], [r * 0.75, -L / 2], [r, -L / 2 + r * 0.45], [r, L / 2 - r * 0.45], [r * 0.75, L / 2], [0.0001, L / 2]], mat, { seg: 16, part: 'wood' });
    bar.rotation.z = Math.PI / 2;
    bar.position.z = 0.0145;
    g.add(bar);
    for (const x of [-L * 0.3, L * 0.3]) {
      const pin = kit.cylinder(0.0042, 0.0042, 0.008, mat, { seg: 10, part: 'wood' });
      pin.rotation.x = Math.PI / 2;
      pin.position.set(x, 0, 0.004);
      g.add(pin);
    }
  } else if (type === 'tab') {
    // aba de madeira (puxador cava) na borda de cima da gaveta
    const t = kit.box(len, 0.012, 0.013, mat, { r: 0.004, part: 'wood' });
    t.position.set(0, 0, 0.0065);
    g.add(t);
  } else if (type === 'knob') {
    g.add(kit.handle('knob', { material: mat, size: 0.011, part: 'metal' }));
  } else if (type === 'cutout') {
    g.add(kit.handle('cutout', { len, size: 0.012 }));
  } else if (type === 'leather_strap') {
    g.add(kit.handle('leather_strap', { len: Math.max(0.1, len) }));
  } else {
    g.add(kit.handle('bar', { material: mat, len, size: 0.012, part: 'metal' }));
  }
  if (vertical) g.rotation.z = Math.PI / 2;
  return g;
}

// Distribui gavetas, portas e nichos numa região (medidas relativas: x 0..Wr, y 0..Hr de baixo para cima)
function planFronts(kind, st, Wr, Hr) {
  const cells = [];
  const add = (x0, x1, y0, y1, type, extra = {}) => cells.push({ x0, x1, y0, y1, type, ...extra });
  const stack = (x0, x1, y0, y1, n, type = 'drawer') => {
    const h = (y1 - y0) / n;
    for (let i = 0; i < n; i++) add(x0, x1, y0 + i * h, y0 + (i + 1) * h, type);
  };
  let nd = Math.max(0, Math.round(Number(st.drawers) || 0));
  let ndoor = Math.max(0, Math.round(Number(st.doors) || 0));
  const niche = !!st.niche;
  if (kind === 'nightstand') {
    if (ndoor) nd = Math.min(nd, 1);
    nd = clamp(nd || (ndoor || niche ? 1 : 2), 0, 5);
    // uma gaveta só: gaveta em cima e nicho embaixo (o desenho mais comum)
    const openBelow = niche || (nd === 1 && !ndoor && Hr > 0.3);
    const dh = ndoor || openBelow ? Math.min(Hr / (nd + 1.4), 0.15) : Hr / Math.max(1, nd);
    const top = Hr;
    const dBot = top - dh * nd;
    if (nd) stack(0, Wr, dBot, top, nd);
    if (ndoor || openBelow) {
      if (ndoor >= 2 && Wr > 0.45) {
        add(0, Wr / 2, 0, dBot, 'door', { hinge: 'left' });
        add(Wr / 2, Wr, 0, dBot, 'door', { hinge: 'right' });
      } else if (ndoor) add(0, Wr, 0, dBot, 'door', { hinge: 'left' });
      else add(0, Wr, 0, dBot, 'niche');
    }
    return cells;
  }
  if (kind === 'dresser') {
    if (st.shoeCabinet) {
      // sapateira: portas de abrir lado a lado, ou basculantes empilhadas
      if (ndoor >= 2 && Wr > 0.5) {
        const w = Wr / ndoor;
        for (let i = 0; i < ndoor; i++) add(i * w, (i + 1) * w, 0, Hr, 'door', { hinge: i % 2 === 0 ? 'left' : 'right' });
      } else stack(0, Wr, 0, Hr, Math.max(2, ndoor || Math.round(Hr / 0.3)), 'flap');
      return cells;
    }
    if (st.sideboard && ndoor) {
      // buffet com portas informadas: uma fileira de gavetas em cima, portas embaixo
      const rowH = nd ? Math.min(0.16, Hr * 0.24) : 0;
      const nTop = Math.min(nd, 4);
      for (let i = 0; i < nTop; i++) add((Wr * i) / nTop, (Wr * (i + 1)) / nTop, Hr - rowH, Hr, 'drawer');
      const n = clamp(ndoor, 1, 6);
      for (let i = 0; i < n; i++) add((Wr * i) / n, (Wr * (i + 1)) / n, 0, Hr - rowH, 'door', { hinge: n === 1 ? 'left' : i < n / 2 ? 'left' : 'right' });
      return cells;
    }
    if (st.sideboard) {
      // buffet: portas nas pontas, gavetas (ou portas) no meio
      const n = Math.max(2, Math.round(Wr / 0.45));
      const w = Wr / n;
      for (let i = 0; i < n; i++) {
        const x0 = i * w;
        const middle = i > 0 && i < n - 1;
        if (middle && nd) stack(x0, x0 + w, 0, Hr, Math.min(3, Math.max(2, Math.ceil(nd / Math.max(1, n - 2)))));
        else if (middle && niche) add(x0, x0 + w, 0, Hr, 'niche');
        else add(x0, x0 + w, 0, Hr, 'door', { hinge: i < n / 2 ? 'left' : 'right' });
      }
      return cells;
    }
    nd = nd || Math.max(2, Math.min(6, Math.round(Hr / 0.19)));
    if (ndoor) {
      if (ndoor === 1 || Wr < 0.9) {
        const dw = Wr * 0.42;
        add(0, dw, 0, Hr, 'door', { hinge: 'left' });
        stack(dw, Wr, 0, Hr, nd);
      } else {
        const dw = Wr * 0.3;
        add(0, dw, 0, Hr, 'door', { hinge: 'left' });
        stack(dw, Wr - dw, 0, Hr, nd);
        add(Wr - dw, Wr, 0, Hr, 'door', { hinge: 'right' });
      }
      return cells;
    }
    if (niche && nd <= 4) {
      const nh = Hr * 0.3;
      stack(0, Wr, nh, Hr, nd);
      add(0, Wr, 0, nh, 'niche');
      return cells;
    }
    if (nd >= 6 && Wr >= 0.9 && Wr > Hr * 1.1) {
      const half = Math.ceil(nd / 2);
      stack(0, Wr / 2, 0, Hr, half);
      stack(Wr / 2, Wr, 0, Hr, nd - half || half);
      return cells;
    }
    stack(0, Wr, 0, Hr, nd);
    return cells;
  }
  // guarda-roupa (portas de abrir)
  ndoor = clamp(ndoor || Math.round(Wr / 0.45), 1, 8);
  nd = clamp(nd, 0, 4);
  const cw = Wr / ndoor;
  const dh = Math.min(0.18, (Hr * 0.36) / Math.max(1, nd));
  const drawerTop = nd * dh;
  let mid = [];
  if (nd) {
    if (ndoor >= 3) mid = ndoor % 2 === 0 ? [ndoor / 2 - 1, ndoor / 2] : [Math.floor(ndoor / 2)];
    else mid = Array.from({ length: ndoor }, (_, i) => i);
    const x0 = mid[0] * cw;
    const x1 = (mid[mid.length - 1] + 1) * cw;
    if (ndoor <= 2 && Wr > 1.0 && nd >= 2) {
      const rows = Math.ceil(nd / 2);
      const rh = Math.min(0.2, (Hr * 0.36) / rows);
      for (let r = 0; r < rows; r++) {
        add(x0, (x0 + x1) / 2, r * rh, (r + 1) * rh, 'drawer');
        add((x0 + x1) / 2, x1, r * rh, (r + 1) * rh, 'drawer');
      }
      mid.top = rows * rh;
    } else {
      stack(x0, x1, 0, drawerTop, nd);
      mid.top = drawerTop;
    }
  }
  for (let i = 0; i < ndoor; i++) {
    const alone = ndoor % 2 === 1 && i === ndoor - 1;
    const hinge = ndoor === 1 ? 'left' : alone ? 'right' : i % 2 === 0 ? 'left' : 'right';
    const y0 = mid.includes(i) ? mid.top : 0;
    let mirror = false;
    if (st.mirror) {
      if (ndoor === 1) mirror = true;
      else if (ndoor === 2) mirror = i === 1;
      else if (ndoor % 2 === 0) mirror = i === ndoor / 2 - 1 || i === ndoor / 2;
      else mirror = i === Math.floor(ndoor / 2);
    }
    add(i * cw, (i + 1) * cw, y0, Hr, mirror ? 'mirror' : st.glass ? 'glass' : 'door', { hinge });
  }
  return cells;
}

// Frente de gaveta/porta (frente em z = 0). Com palhinha: moldura + tela; espelho; vidro.
function frontPanel(kit, THREE, c, w, h, t, mat, { cane, mirror, glass, grain, radii, topBorder = 1 } = {}) {
  const { m, C } = c;
  const g = kit.group('frente');
  const rounded = radii && radii.some((r) => r > 0.001);
  if (cane || glass) {
    const b = clamp(Math.min(w, h) * 0.11, 0.012, 0.045);
    const bt = b * topBorder;
    // palhinha tingida pelo tom do móvel (escura num móvel tabaco, clara num natural)
    const tintK = c.st.woodLook ? clamp(1 - kit.luminance(C.main) * 1.4, 0.15, 0.8) : 0.06;
    const inner = cane ? m.cane(kit.mix(C.accent || '#d9b98a', C.main, tintK)) : m.glass({ tint: '#d6e0de', opacity: 0.32 });
    if (rounded) {
      const shape = cornerShape(THREE, w, h, radii);
      const hw = w - 2 * b;
      const hh = h - b - bt;
      const oy = (b - bt) / 2;
      const hole = new THREE.Path();
      hole.moveTo(-hw / 2, oy - hh / 2);
      hole.lineTo(hw / 2, oy - hh / 2);
      hole.lineTo(hw / 2, oy + hh / 2);
      hole.lineTo(-hw / 2, oy + hh / 2);
      hole.lineTo(-hw / 2, oy - hh / 2);
      shape.holes.push(hole);
      g.add(slab(kit, THREE, shape, t, mat, { grain, part: 'main' }));
    } else {
      g.add(boxAt(kit, -w / 2, w / 2, h / 2 - bt, h / 2, -t, 0, mat, { r: 0.0015, part: 'main', grain: 'x' }));
      g.add(boxAt(kit, -w / 2, w / 2, -h / 2, -h / 2 + b, -t, 0, mat, { r: 0.0015, part: 'main', grain: 'x' }));
      g.add(boxAt(kit, -w / 2, -w / 2 + b, -h / 2 + b - 0.0005, h / 2 - bt + 0.0005, -t, 0, mat, { r: 0.0015, part: 'main', grain: 'y' }));
      g.add(boxAt(kit, w / 2 - b, w / 2, -h / 2 + b - 0.0005, h / 2 - bt + 0.0005, -t, 0, mat, { r: 0.0015, part: 'main', grain: 'y' }));
    }
    const iy = (b - bt) / 2;
    g.add(boxAt(kit, -w / 2 + b - 0.001, w / 2 - b + 0.001, iy - (h - b - bt) / 2 - 0.001, iy + (h - b - bt) / 2 + 0.001, -t * 0.75, -t * 0.4, inner, { part: cane ? 'accent' : 'detail' }));
    if (glass) g.add(boxAt(kit, -w / 2 + b, w / 2 - b, iy - (h - b - bt) / 2, iy + (h - b - bt) / 2, -t - 0.03, -t - 0.026, shadowMat(m), { part: 'detail' }));
    else g.add(boxAt(kit, -w / 2 + b, w / 2 - b, iy - (h - b - bt) / 2, iy + (h - b - bt) / 2, -t, -t * 0.8, shadowMat(m), { part: 'detail' }));
    return g;
  }
  if (rounded) g.add(slab(kit, THREE, cornerShape(THREE, w, h, radii), t, mat, { grain, part: 'main' }));
  else g.add(boxAt(kit, -w / 2, w / 2, -h / 2, h / 2, -t, 0, mat, { r: 0.0018, part: 'main', grain }));
  if (mirror) {
    const mx = clamp(w * 0.08, 0.02, 0.05);
    const my = clamp(h * 0.04, 0.03, 0.07);
    g.add(boxAt(kit, -w / 2 + mx, w / 2 - mx, -h / 2 + my, h / 2 - my, 0, 0.004, m.metal('#e9eff1', { finish: 'chrome' }), { r: 0.002, part: 'detail' }));
  }
  return g;
}

function caseFurniture(spec, kit, THREE, kind) {
  const c = ctx(spec, kit);
  const { st, C, m, W, H, D } = c;
  const g = kit.group(kind);
  const wardrobe = kind === 'wardrobe';
  // folheado: veio discreto nos claros; nos escuros o 'oak' (mais fosco) evita brilhos pontilhados
  const body = bodyMat(c, st.rustic ? 'rustic' : kit.luminance(C.main) < 0.3 ? 'oak' : 'smooth');
  // duas cores ("Freijó e Off White", "Branco e Freijó"): frentes na segunda cor
  const DEF_ACC = { nightstand: '#d9b98a', dresser: '#d9b98a', wardrobe: '#c8995e' };
  const acc = String(spec.colors?.accent || '').toLowerCase();
  const wd = String(spec.colors?.wood || '').toLowerCase();
  let frontMat = body;
  if (st.twoTone !== false && !st.cane) {
    if (acc && acc !== DEF_ACC[kind]) frontMat = m.paint(acc, { gloss: 0.2 });
    else if (!st.woodLook && wd && wd !== '#c8995e') frontMat = m.wood(wd, { grain: 'smooth' });
  }
  // jeito de construir: arredondado (retrô, pés palito), quadro com frentes embutidas (palhinha, rústico) ou sobreposto
  const look = st.front || (!wardrobe && (st.legs === 'palito' || st.retro || st.organic) ? 'rounded' : !wardrobe && (st.cane || st.rustic) ? 'frame' : 'overlay');
  const legType =
    st.wallMount && !wardrobe ? 'none'
    : st.legs === 'palito' || (st.retro && !st.legs) ? 'palito'
    : st.legs === 'metal' ? 'metal_square'
    : st.legs === 'turned' ? 'turned'
    : st.legs === 'hidden' || st.legs === 'wood_base' ? 'plinth'
    : st.wheels ? 'wheels'
    : look === 'frame' ? 'stile'
    : wardrobe ? 'plinth'
    : st.woodLook || st.legs === 'wood' ? 'square'
    : 'plinth';
  const legH = {
    palito: clamp(H * 0.17, 0.09, wardrobe ? 0.18 : 0.2),
    metal_square: clamp(H * 0.15, 0.08, 0.18),
    turned: clamp(H * 0.14, 0.08, 0.16),
    square: clamp(H * 0.09, 0.05, 0.1),
    stile: clamp(H * 0.13, 0.06, 0.12),
    plinth: clamp(H * 0.05, 0.035, 0.08),
    wheels: clamp(H * 0.1, 0.045, 0.07),
    none: 0,
  }[legType];
  const handleType = st.handle || (look === 'rounded' ? 'dowel' : st.cane ? 'tab' : st.retro && !wardrobe ? 'knob' : 'bar');
  const pullMat = handleType === 'dowel' ? woodOf(c) : handleType === 'tab' ? (st.woodLook ? m.wood(kit.shade(C.main, -0.2), { grain: 'oak', relief: 0.35 }) : body) : m.metal(C.metal || '#b8a16a', { finish: 'brushed' });
  // saliência do puxador (para caber na profundidade)
  const sample = makePull(kit, c, handleType, { len: 0.1, mat: pullMat });
  const hp = wardrobe && st.sliding ? 0.008 : sample ? Math.max(0, bounds(kit, sample).max.z) : 0;
  const ft = 0.018; // espessura das frentes
  const gap = 0.003;
  const legMat = legType === 'metal_square' ? m.metal(C.metal && kit.luminance(C.metal) < 0.4 ? C.metal : '#1f1f1f', { finish: 'painted' }) : st.woodLook ? body : m.wood(C.wood, { grain: 'oak' });
  const legPart = legType === 'metal_square' ? 'metal' : st.woodLook ? 'main' : 'wood';

  let region; // { x0, x1, y0, y1, zFace }
  let rails = null; // quadro: travessas entre as células
  let cornerR = 0;

  if (look === 'rounded') {
    // casco com cantos arredondados, frentes embutidas
    const marbleTop = st.marble || spec.material === 'marble';
    const mT = marbleTop ? 0.02 : 0;
    const bodyH = H - legH - mT;
    const R = clamp(Math.min(bodyH, W) * 0.09, 0.02, 0.07);
    if (marbleTop) {
      // tampo de mármore com os mesmos cantos arredondados, um pouco saliente na frente
      const top = slab(kit, THREE, cornerShape(THREE, W, D, [R, R, R, R]), mT, m.marble('#efede8'), { bevel: 0.003, part: 'accent', curveSegments: 10 });
      top.rotation.x = -Math.PI / 2; // espessura (z local de -mT a 0) vira y de H - mT a H
      g.add(kit.place(top, { y: H }));
    }
    const t = clamp(W * 0.022, 0.018, 0.03);
    const zFace = D / 2 - hp;
    const shellD = zFace + 0.0015 + D / 2;
    const shape = cornerShape(THREE, W, bodyH, [R, R, R, R]);
    const Rin = Math.max(0.004, R - t);
    shape.holes.push(cornerShape(THREE, W - 2 * t, bodyH - 2 * t, [Rin, Rin, Rin, Rin], THREE.Path));
    const shell = slab(kit, THREE, shape, shellD, body, { bevel: 0.003, grain: 'x', part: 'main', curveSegments: 10 });
    g.add(kit.place(shell, { y: legH + bodyH / 2, z: zFace + 0.0015 }));
    g.add(boxAt(kit, -W / 2 + t - 0.002, W / 2 - t + 0.002, legH + t - 0.002, legH + bodyH - t + 0.002, -D / 2 + 0.002, -D / 2 + 0.012, body, { part: 'main' }));
    region = { x0: -W / 2 + t, x1: W / 2 - t, y0: legH + t, y1: legH + bodyH - t, zFace };
    cornerR = Math.max(0, Rin - gap);
  } else if (look === 'frame') {
    // quadro de montantes (que viram pés), tampo com beiral e frentes embutidas
    const ov = 0.006;
    const tt = clamp(H * 0.04, 0.018, 0.03);
    const Wc = W - 2 * ov;
    const s = clamp(Math.min(W, H) * 0.045, 0.02, 0.045);
    const zFF = D / 2 - Math.max(ov, hp - 0.003);
    const zBack = -D / 2;
    const topFront = zFF + ov;
    g.add(boxAt(kit, -W / 2, W / 2, H - tt, H, zBack, topFront, body, { r: 0.003, part: 'main' }));
    const yTop = H - tt;
    for (const sx of [-1, 1]) {
      for (const [za, zb] of [[zFF - s, zFF], [zBack, zBack + s]]) {
        if (legType === 'stile') g.add(boxAt(kit, sx * (Wc / 2 - s), sx * (Wc / 2), 0, yTop, za, zb, body, { r: 0.002, part: 'main', grain: 'y' }));
        else g.add(boxAt(kit, sx * (Wc / 2 - s), sx * (Wc / 2), legH, yTop, za, zb, body, { r: 0.002, part: 'main', grain: 'y' }));
      }
      // painel lateral recuado e travessa de baixo
      g.add(boxAt(kit, sx * (Wc / 2 - 0.016), sx * (Wc / 2 - 0.004), legH, yTop, zBack + s - 0.001, zFF - s + 0.001, body, { part: 'main', grain: 'y' }));
      g.add(boxAt(kit, sx * (Wc / 2 - s * 0.8), sx * (Wc / 2 - 0.002), legH, legH + s, zBack + s - 0.001, zFF - s + 0.001, body, { r: 0.002, part: 'main', grain: 'z' }));
    }
    g.add(boxAt(kit, -Wc / 2 + s, Wc / 2 - s, legH, yTop, zBack + 0.002, zBack + 0.012, body, { part: 'main' }));
    const railB = clamp(s * 1.05, 0.02, 0.045);
    const railT = clamp(s * 0.8, 0.016, 0.035);
    g.add(boxAt(kit, -Wc / 2 + s - 0.001, Wc / 2 - s + 0.001, legH, legH + railB, zFF - s * 0.9, zFF, body, { r: 0.0015, part: 'main' }));
    g.add(boxAt(kit, -Wc / 2 + s - 0.001, Wc / 2 - s + 0.001, yTop - railT, yTop, zFF - s * 0.9, zFF, body, { r: 0.0015, part: 'main' }));
    region = { x0: -Wc / 2 + s, x1: Wc / 2 - s, y0: legH + railB, y1: yTop - railT, zFace: zFF - 0.003 };
    rails = { t: clamp(s * 0.75, 0.014, 0.028), z0: zFF - s * 0.9, z1: zFF };
  } else {
    // sobreposto: caixa com laterais, tampo (com beiral em cômodas/criados) e frentes por cima
    const topOv = wardrobe ? 0 : 0.008;
    const tt = wardrobe ? 0 : clamp(H * 0.035, 0.018, 0.03);
    const zFace = D / 2 - Math.max(hp, topOv);
    const zC = zFace - ft - 0.002;
    const Wc = W - 2 * topOv;
    const ts = 0.018;
    const yTopC = H - tt;
    const y0C = legH;
    if (tt > 0) {
      const topMat = st.marble || spec.material === 'marble' ? m.marble('#efede8') : body;
      g.add(boxAt(kit, -W / 2, W / 2, H - tt, H, -D / 2, zFace + topOv, topMat, { r: 0.004, part: topMat === body ? 'main' : 'accent' }));
    }
    for (const sx of [-1, 1]) g.add(boxAt(kit, sx * (Wc / 2 - ts), sx * (Wc / 2), y0C, yTopC, -D / 2, zC, body, { r: 0.0015, part: 'main', grain: 'y' }));
    g.add(boxAt(kit, -Wc / 2 + ts, Wc / 2 - ts, yTopC - ts, yTopC, -D / 2, zC, body, { part: 'main' }));
    g.add(boxAt(kit, -Wc / 2 + ts, Wc / 2 - ts, y0C, y0C + ts, -D / 2, zC, body, { part: 'main' }));
    g.add(boxAt(kit, -Wc / 2 + ts, Wc / 2 - ts, y0C + ts, yTopC - ts, -D / 2 + 0.002, -D / 2 + 0.01, body, { part: 'main' }));
    region = { x0: -Wc / 2 + 0.0015, x1: Wc / 2 - 0.0015, y0: y0C + (legType === 'plinth' ? 0.0015 : 0.0015), y1: yTopC - (wardrobe ? 0.0015 : 0.0015), zFace, zC, ts };
  }

  // pés / rodapé
  const bw = look === 'frame' ? W - 0.012 : W - (look === 'overlay' && !wardrobe ? 0.016 : 0);
  if (legType === 'palito') {
    legs4(kit, g, 'palito', { hx: bw / 2 - clamp(W * 0.075, 0.04, 0.1), hz: D / 2 - clamp(D * 0.17, 0.05, 0.09), cz: -hp / 2, h: legH + 0.004, r: clamp(W * 0.02, 0.016, 0.026), mat: legMat, splay: 0.36, dirZ: 0.45, part: legPart });
  } else if (legType === 'metal_square' || legType === 'turned' || legType === 'square') {
    legs4(kit, g, legType, { hx: bw / 2 - 0.035, hz: D / 2 - hp - 0.04, cz: -hp / 2, h: legH + 0.004, r: legType === 'turned' ? 0.022 : 0.017, mat: legMat, part: legPart });
  } else if (legType === 'wheels') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(kit.place(caster(kit, m, legH + 0.003), { x: sx * (bw / 2 - 0.04), z: -hp / 2 + sz * (D / 2 - hp - 0.05) }));
  } else if (legType === 'plinth') {
    const zF = (region.zC ?? region.zFace) - 0.025;
    g.add(boxAt(kit, -bw / 2 + 0.02, bw / 2 - 0.02, 0, legH + 0.002, -D / 2 + 0.02, zF, st.legs === 'wood_base' ? m.wood(C.wood, { grain: 'oak' }) : body, { part: 'main' }));
    g.add(boxAt(kit, -bw / 2 + 0.03, bw / 2 - 0.03, 0, 0.004, -D / 2 + 0.03, zF - 0.006, shadowMat(m), { part: 'detail' }));
  }

  // portas de correr (guarda-roupa)
  if (wardrobe && st.sliding) {
    slidingDoors(kit, THREE, c, g, region, { body, ft });
    return g;
  }

  // frentes
  const Wr = region.x1 - region.x0;
  const Hr = region.y1 - region.y0;
  const cells = planFronts(kind, st, Wr, Hr);
  const shadow = shadowMat(m);
  const fx = (v) => region.x0 + v;
  const fy = (v) => region.y0 + v;
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const isFrame = look === 'frame';
  const grainFront = look === 'rounded' ? 'y' : 'x';
  for (const cell of cells) {
    let x0 = fx(cell.x0);
    let x1 = fx(cell.x1);
    let y0 = fy(cell.y0);
    let y1 = fy(cell.y1);
    // travessas do quadro entre células
    if (isFrame) {
      const half = rails.t / 2;
      if (!near(cell.y1, Hr)) {
        y1 -= half;
        g.add(boxAt(kit, x0, x1, y1, y1 + rails.t, rails.z0, rails.z1, body, { r: 0.0015, part: 'main' }));
      }
      if (!near(cell.y0, 0)) y0 += half;
      if (!near(cell.x1, Wr)) {
        x1 -= half;
        g.add(boxAt(kit, x1, x1 + rails.t, y0 - (near(cell.y0, 0) ? 0 : half), y1 + (near(cell.y1, Hr) ? 0 : half), rails.z0, rails.z1, body, { r: 0.0015, part: 'main', grain: 'y' }));
      }
      if (!near(cell.x0, 0)) x0 += half;
    }
    const g2 = isFrame ? 0.0025 : gap;
    const w = x1 - x0 - (isFrame ? 2 * g2 : g2);
    const h = y1 - y0 - (isFrame ? 2 * g2 : g2);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (cell.type === 'niche') {
      // nicho aberto: fundo, base e laterais à vista
      const zb = -D / 2 + 0.012;
      const zf = region.zFace - (isFrame ? 0.002 : ft);
      g.add(boxAt(kit, x0, x1, y0, y0 + 0.016, zb, zf, body, { part: 'main' }));
      g.add(boxAt(kit, x0, x1, y1 - 0.016, y1, zb, zf, body, { part: 'main' }));
      g.add(boxAt(kit, x0, x1, y0, y1, zb, zb + 0.004, m.paint(kit.shade(C.main, -0.12), { gloss: 0.1 }), { part: 'main' }));
      if (!isFrame) {
        for (const xx of [x0, x1 - 0.016]) g.add(boxAt(kit, xx, xx + 0.016, y0, y1, zb, zf, body, { part: 'main', grain: 'y' }));
      }
      continue;
    }
    // placa escura atrás da frente (frestas escuras)
    if (region.zC != null) g.add(boxAt(kit, x0 + 0.001, x1 - 0.001, y0 + 0.001, y1 - 0.001, region.zC + 0.0004, region.zC + 0.0014, shadow, { part: 'detail' }));
    else g.add(boxAt(kit, x0 + 0.001, x1 - 0.001, y0 + 0.001, y1 - 0.001, region.zFace - ft - 0.006, region.zFace - ft - 0.002, shadow, { part: 'detail' }));
    // cantos arredondados nas frentes que encostam nos cantos do casco
    let radii = null;
    if (cornerR > 0) {
      const L = near(cell.x0, 0);
      const R = near(cell.x1, Wr);
      const B = near(cell.y0, 0);
      const T = near(cell.y1, Hr);
      radii = [L && T ? cornerR : 0, R && T ? cornerR : 0, R && B ? cornerR : 0, L && B ? cornerR : 0];
    }
    const isDrawer = cell.type === 'drawer' || cell.type === 'flap';
    const tabTop = handleType === 'tab' && isDrawer ? 1.9 : 1;
    const panel = frontPanel(kit, THREE, c, w, h, ft, frontMat, { cane: !!st.cane && cell.type !== 'mirror', mirror: cell.type === 'mirror', glass: cell.type === 'glass', grain: grainFront, radii, topBorder: tabTop });
    g.add(kit.place(panel, { x: cx, y: cy, z: region.zFace }));
    // puxadores
    const zP = region.zFace;
    if (isDrawer) {
      if (handleType === 'tab' || handleType === 'cutout') {
        const p = makePull(kit, c, handleType, { len: clamp(w * 0.42, 0.08, 0.36), mat: pullMat });
        if (p) g.add(kit.place(p, { x: cx, y: cy + h / 2 - (handleType === 'tab' ? 0.012 : 0.018), z: zP }));
      } else {
        const two = w > (handleType === 'dowel' ? 0.6 : 0.75);
        const len = handleType === 'dowel' ? clamp(w * 0.075, 0.06, 0.1) : clamp(w * 0.28, 0.08, 0.16);
        const py = h > 0.3 ? cy + h * 0.3 : cy;
        for (const x of two ? [cx - w * 0.26, cx + w * 0.26] : [cx]) {
          const p = makePull(kit, c, handleType, { len, mat: pullMat });
          if (p) g.add(kit.place(p, { x, y: py, z: zP }));
        }
      }
    } else {
      // portas: puxador vertical perto do lado que abre
      const edge = cell.hinge === 'left' ? 1 : -1;
      const tall = h > 0.9;
      const len = handleType === 'knob' ? 0.02 : tall ? clamp(h * 0.2, 0.2, 0.45) : clamp(h * 0.3, 0.08, 0.18);
      const vertical = handleType !== 'knob' && handleType !== 'tab';
      const p = makePull(kit, c, handleType === 'tab' ? 'bar' : handleType, { len, vertical, mat: handleType === 'tab' ? m.metal(C.metal, { finish: 'brushed' }) : pullMat });
      const yy = tall ? Math.min(y1 - len / 2 - 0.05, Math.max(cy, 1.05)) : cy + h * 0.25;
      if (p) g.add(kit.place(p, { x: cx + edge * (w / 2 - 0.035), y: yy, z: zP }));
    }
  }
  return g;
}

// Portas de correr: 2-4 painéis em trilhos alternados, perfil vertical como puxador
function slidingDoors(kit, THREE, c, g, region, { body, ft }) {
  const { st, m } = c;
  const Wr = region.x1 - region.x0;
  const n = clamp(Math.round(Number(st.doors) || (Wr > 2.2 ? 3 : 2)), 2, 4);
  const ov = 0.04;
  const pw = (Wr + (n - 1) * ov) / n;
  const alu = m.metal('#b9bcbf', { finish: 'brushed' });
  const y0 = region.y0 + 0.012;
  const y1 = region.y1 - 0.03;
  // trilhos em cima e embaixo
  g.add(boxAt(kit, region.x0, region.x1, region.y1 - 0.03, region.y1, region.zFace - 0.05, region.zFace, alu, { part: 'metal' }));
  g.add(boxAt(kit, region.x0, region.x1, region.y0, region.y0 + 0.012, region.zFace - 0.05, region.zFace, alu, { part: 'metal' }));
  for (let i = 0; i < n; i++) {
    const front = i % 2 === 1 || n === 2 ? i === n - 1 || i % 2 === 1 : false;
    const zf = front ? region.zFace - 0.002 : region.zFace - ft - 0.008;
    const x0 = region.x0 + i * (pw - ov);
    const mirror = st.mirror && (n === 3 ? i === 1 : n === 2 ? i === 1 : i === 1 || i === 2);
    const panel = frontPanel(kit, THREE, c, pw, y1 - y0, ft, body, { mirror, glass: st.glass && !mirror, grain: 'y' });
    g.add(kit.place(panel, { x: x0 + pw / 2, y: (y0 + y1) / 2, z: zf }));
    // perfil-puxador na borda
    const ex = i === 0 ? x0 + pw - 0.012 : x0 + 0.012;
    g.add(boxAt(kit, ex - 0.012, ex + 0.012, y0, y1, zf - 0.002, zf + 0.006, alu, { r: 0.002, part: 'metal' }));
  }
}

export function nightstand(spec, kit, THREE) {
  return caseFurniture(spec, kit, THREE, 'nightstand');
}
export function dresser(spec, kit, THREE) {
  return caseFurniture(spec, kit, THREE, 'dresser');
}
export function wardrobe(spec, kit, THREE) {
  return caseFurniture(spec, kit, THREE, 'wardrobe');
}
