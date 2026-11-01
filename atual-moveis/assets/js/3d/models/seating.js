// Geradores de assentos: sofá, poltrona, cadeira, banqueta e puff.
// Cada função: (spec, kit, THREE) => THREE.Group — metros, chão em y = 0, frente para +Z,
// centrado em x/z e construído na medida exata do spec (w x h x d), sem escala não uniforme.
// Estilos lidos de spec.style (infer.js): seats, tufted, retro, organic, looseCushions, chaise,
// corner, retractable, reclinable, arms, rolledArms, legs, industrial, swivel, bench, shape,
// office, cane. Algumas pistas extras vêm do nome (spec.label): orelha/bergère, balanço,
// alta/bar, encosto, gamer, eames, baú, direita.

import { findColorWords } from '../infer.js';

const UPH = new Set(['velvet', 'linen', 'leather', 'boucle', 'suede', 'cotton', 'fabric']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// perfil de borda arredondada (quarto de círculo): 0 na borda, 1 a partir de u >= 1
const roundProf = (u) => (u >= 1 ? 1 : u <= 0 ? 0 : Math.sqrt(1 - (1 - u) * (1 - u)));

/* ================================================================== */
/* Contexto comum                                                      */
/* ================================================================== */
function ctx(spec, kit, THREE) {
  const st = spec.style || {};
  const C = spec.colors || {};
  const m = kit.mat;
  const material = spec.material || 'fabric';
  const main = C.main || '#9a9a9a';
  const woodHex = C.wood || '#8a5a36';
  return {
    kit,
    THREE,
    m,
    st,
    C,
    spec,
    label: norm(spec.label),
    material,
    W: kit.cm(spec.w),
    H: kit.cm(spec.h),
    D: kit.cm(spec.d),
    main,
    woodHex,
    upholstered: UPH.has(material),
    fab: m.upholstery(main, UPH.has(material) ? material : 'cotton'),
    wood: m.wood(woodHex, { grain: st.rustic ? 'rustic' : 'oak' }),
    dark: m.metal(C.metal || '#1f1f1f', { finish: 'painted' }),
  };
}

// Acabamento da estrutura de madeira: tom de madeira -> madeira; outra cor no nome -> pintada; sem cor -> madeira padrão
function frameMat(c) {
  if (c.st.woodLook) return c.m.wood(c.C.wood || c.woodHex, { grain: c.st.rustic ? 'rustic' : 'oak' });
  const words = findColorWords(c.spec.label || '');
  if (words.length && !words[0].wood) return c.m.paint(c.main, { gloss: 0.3 });
  if (words.length && words[0].wood) return c.m.wood(c.main, { grain: c.st.rustic ? 'rustic' : 'oak' });
  return c.wood;
}

/* ================================================================== */
/* Primitivas locais                                                   */
/* ================================================================== */
// Move um objeto (ainda sem pai) para encostar a caixa dele nos limites pedidos
function snap(c, obj, o) {
  const b = c.kit.measure(obj);
  if (o.minY != null) obj.position.y += o.minY - b.min.y;
  if (o.maxY != null) obj.position.y += o.maxY - b.max.y;
  if (o.minX != null) obj.position.x += o.minX - b.min.x;
  if (o.maxX != null) obj.position.x += o.maxX - b.max.x;
  if (o.minZ != null) obj.position.z += o.minZ - b.min.z;
  if (o.maxZ != null) obj.position.z += o.maxZ - b.max.z;
  return obj;
}

// Cilindro (ou prisma quadrado) entre dois pontos; r0 no ponto p0 e r1 no p1
function rod(c, p0, p1, r0, r1, material, { seg = 14, part, square = false } = {}) {
  const { THREE, kit } = c;
  const A = new THREE.Vector3(...p0);
  const B = new THREE.Vector3(...p1);
  const dir = B.clone().sub(A);
  const L = dir.length() || 1e-4;
  dir.divideScalar(L);
  const k = square ? Math.SQRT2 : 1;
  const mesh = kit.cylinder(r1 * k, r0 * k, L, material, { seg: square ? 4 : seg, part });
  if (square) {
    let geo = mesh.geometry;
    geo.rotateY(Math.PI / 4);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    mesh.geometry = geo;
  }
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  return mesh;
}

// Pé do topo até o chão; o pé é levantado o suficiente para a borda não furar o piso
function legRod(c, top, foot, rTop, rFoot, material, { square = false, ferrule = null, seg = 14, part = 'wood' } = {}) {
  const tilt = Math.atan2(Math.hypot(top[0] - foot[0], top[2] - foot[2]), top[1] - foot[1]);
  const lift = rFoot * (square ? Math.SQRT2 : 1) * 1.05 * Math.sin(tilt) + 0.0004;
  const f = [foot[0], foot[1] + lift, foot[2]];
  const g = c.kit.group('leg');
  g.add(rod(c, f, top, rFoot, rTop, material, { seg, part, square }));
  if (ferrule) {
    const d = [top[0] - f[0], top[1] - f[1], top[2] - f[2]];
    const t = (ferrule.len || 0.022) / Math.hypot(...d);
    const p1 = [f[0] + d[0] * t, f[1] + d[1] * t, f[2] + d[2] * t];
    g.add(rod(c, f, p1, rFoot * 1.05, (rFoot + (rTop - rFoot) * t) * 1.05, ferrule.material, { seg, part: 'detail', square }));
  }
  return g;
}

// Botão de capitonê (esfera achatada no eixo da face)
function button(c, material, r = 0.008, axis = 'y') {
  const b = c.kit.sphere(r, material, { seg: 8, part: 'detail' });
  b.scale[axis] = 0.5;
  return b;
}

// Contorno 2D com cantos arredondados (curva quadrática); pts [[x, y], ...], raio por canto
function roundedPoly(c, pts, radii) {
  const s = new c.THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const a = pts[i];
    const q = pts[(i + 1) % n];
    const r = Array.isArray(radii) ? radii[i] : radii;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const l2 = Math.hypot(q[0] - a[0], q[1] - a[1]);
    const rr = Math.max(0, Math.min(r, l1 * 0.5, l2 * 0.5));
    const p1 = [a[0] + ((p[0] - a[0]) / l1) * rr, a[1] + ((p[1] - a[1]) / l1) * rr];
    const p2 = [a[0] + ((q[0] - a[0]) / l2) * rr, a[1] + ((q[1] - a[1]) / l2) * rr];
    if (i === 0) s.moveTo(p1[0], p1[1]);
    else s.lineTo(p1[0], p1[1]);
    s.quadraticCurveTo(a[0], a[1], p2[0], p2[1]);
  }
  s.closePath();
  return s;
}

// Placa horizontal a partir de um contorno em planta [[x, z], ...] (centrada em y = 0).
// bevel arredonda as bordas (o contorno já deve vir encolhido pelo bevel).
function planSlab(c, ptsXZ, radii, thickness, material, { bevel = 0.004, part } = {}) {
  const shape = roundedPoly(
    c,
    ptsXZ.map(([x, z]) => [x, -z]),
    radii
  );
  const mesh = c.kit.extrude(shape, thickness, material, { bevel, curveSegments: 12, part, bevelSegments: bevel > 0.01 ? 5 : 3 });
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// Loft: anéis de seção retangular arredondada ao longo de estações.
// estação: { o, a, b (THREE.Vector3; a e b unitários), a0, a1, b0, b1, r, u, R?, bulge? }
// bulge (m) estufa as faces laterais (±a) no meio da altura, como estofado cheio.
// R (opcional) dobra a seção ao longo de 'a' em arco com centro em o + b*R.
// segA subdivide as faces longas ao longo de 'a' (necessário quando a seção é dobrada com R).
// vFrom: onde o 'v' da textura começa em cada anel. 'start' (canto inicial), 'bottom' (centro da face b0,
// crescendo pelos dois lados) ou 'top' (centro da face b1, a face vista). Ancorar onde a seção não muda
// evita que a trama "escorra" quando a altura/largura do anel varia ao longo do loft.
function loft(c, stations, material, { cs = 5, part, segA = 0, vFrom = 'start' } = {}) {
  const { THREE, kit } = c;
  const n = stations.length;
  const M = 4 * (cs + 1) + 2 * segA + 1;
  const P = new Float32Array(n * M * 3);
  const UV = new Float32Array(n * M * 2);
  const ud = material.userData || {};
  const [tu, tv] = ud.uv === 'fit' ? [1, 1] : ud.tile || [1, 1];
  const ring = [];
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const r = Math.max(0, Math.min(s.r, (s.a1 - s.a0) / 2, (s.b1 - s.b0) / 2));
    ring.length = 0;
    const cc = [
      [s.a1 - r, s.b0 + r, -Math.PI / 2],
      [s.a1 - r, s.b1 - r, 0],
      [s.a0 + r, s.b1 - r, Math.PI / 2],
      [s.a0 + r, s.b0 + r, Math.PI],
    ];
    cc.forEach(([ca, cb, a0], k) => {
      for (let j = 0; j <= cs; j++) {
        const t = a0 + (j / cs) * (Math.PI / 2);
        ring.push(ca + r * Math.cos(t), cb + r * Math.sin(t));
      }
      // pontos intermediários nas faces longas (topo em b1 depois do canto 1; base em b0 depois do canto 3)
      if (segA && (k === 1 || k === 3)) {
        const [from, to, pb] = k === 1 ? [s.a1 - r, s.a0 + r, s.b1] : [s.a0 + r, s.a1 - r, s.b0];
        for (let j = 1; j <= segA; j++) ring.push(lerp(from, to, j / (segA + 1)), pb);
      }
    });
    ring.push(ring[0], ring[1]);
    // perímetro e posição (em v) do centro da face de cima/de baixo
    let per = 0;
    for (let j = 1; j < M; j++) per += Math.hypot(ring[2 * j] - ring[2 * j - 2], ring[2 * j + 1] - ring[2 * j - 1]);
    const arc = cs * 2 * r * Math.sin(Math.PI / (4 * cs));
    const ac = (s.a0 + s.a1) / 2;
    const vRef = vFrom === 'bottom' ? per - (s.a1 - r - ac) : vFrom === 'top' ? 2 * arc + (s.b1 - s.b0 - 2 * r) + (s.a1 - r - ac) : 0;
    let v = 0;
    for (let j = 0; j < M; j++) {
      const pa = ring[2 * j];
      const pb = ring[2 * j + 1];
      if (j) v += Math.hypot(pa - ring[2 * j - 2], pb - ring[2 * j - 1]);
      let vv = v;
      if (vFrom !== 'start') {
        const dv = (((v - vRef) % per) + per) % per;
        // 'bottom': espelha (sobe igual pelos dois lados; a emenda fica na crista de cima, arredondada)
        // 'top': contínuo a partir do centro da frente (sem espelho, que inverteria o relevo); emenda atrás
        vv = vFrom === 'bottom' ? Math.min(dv, per - dv) : dv > per / 2 ? dv - per : dv;
      }
      let ka = pa;
      let kb = pb;
      if (s.bulge) ka += Math.sign(pa) * s.bulge * Math.sin((Math.PI * (pb - s.b0)) / (s.b1 - s.b0 || 1));
      if (s.R) {
        const ang = pa / s.R;
        const rho = s.R - pb;
        ka = rho * Math.sin(ang);
        kb = s.R - rho * Math.cos(ang);
      }
      const q = (i * M + j) * 3;
      P[q] = s.o.x + s.a.x * ka + s.b.x * kb;
      P[q + 1] = s.o.y + s.a.y * ka + s.b.y * kb;
      P[q + 2] = s.o.z + s.a.z * ka + s.b.z * kb;
      const w = (i * M + j) * 2;
      UV[w] = s.u / tu;
      UV[w + 1] = vv / tv;
    }
  }
  // orientação dos triângulos (normais para fora)
  let T = null;
  for (let i = 1; i < n && !T; i++) {
    const d = stations[i].o.clone().sub(stations[0].o);
    if (d.lengthSq() > 1e-12) T = d;
  }
  const ab = stations[0].a.clone().cross(stations[0].b);
  const flip = T ? T.dot(ab) < 0 : false;
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j;
      const b = a + 1;
      const cI = a + M;
      const d = cI + 1;
      if (!flip) idx.push(a, b, d, a, d, cI);
      else idx.push(a, d, b, a, cI, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // costura do anel: média das normais do primeiro e do último ponto
  const N = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const a = i * M;
    const b = a + M - 1;
    const x = N.getX(a) + N.getX(b);
    const y = N.getY(a) + N.getY(b);
    const z = N.getZ(a) + N.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l);
    N.setXYZ(b, x / l, y / l, z / l);
  }
  return kit.mesh(geo, material, { keepUV: true, part });
}

// Caminho em planta [[x, z], ...] com cantos em arco de círculo (raio rc). at(s) -> {x, z, tx, tz}
function planPath(c, pts, rc) {
  const V = pts.map(([x, z]) => ({ x, z }));
  const out = [V[0]];
  for (let i = 1; i < V.length - 1; i++) {
    const p = V[i - 1];
    const a = V[i];
    const q = V[i + 1];
    let d1x = a.x - p.x;
    let d1z = a.z - p.z;
    const l1 = Math.hypot(d1x, d1z);
    d1x /= l1;
    d1z /= l1;
    let d2x = q.x - a.x;
    let d2z = q.z - a.z;
    const l2 = Math.hypot(d2x, d2z);
    d2x /= l2;
    d2z /= l2;
    const phi = Math.acos(clamp(d1x * d2x + d1z * d2z, -1, 1));
    const want = Array.isArray(rc) ? rc[i] : rc;
    if (phi < 1e-3 || want <= 0) {
      out.push(a);
      continue;
    }
    let t = want * Math.tan(phi / 2);
    const tMax = Math.min(l1, l2) * 0.499;
    let r = want;
    if (t > tMax) {
      t = tMax;
      r = t / Math.tan(phi / 2);
    }
    const sgn = d1x * d2z - d1z * d2x > 0 ? 1 : -1;
    const nx = -d1z * sgn;
    const nz = d1x * sgn;
    const p1x = a.x - d1x * t;
    const p1z = a.z - d1z * t;
    const cx = p1x + nx * r;
    const cz = p1z + nz * r;
    const a1 = Math.atan2(p1z - cz, p1x - cx);
    const K = Math.max(6, Math.ceil((phi * r) / 0.008));
    for (let k = 0; k <= K; k++) {
      const ang = a1 + (sgn * phi * k) / K;
      out.push({ x: cx + r * Math.cos(ang), z: cz + r * Math.sin(ang) });
    }
  }
  out.push(V[V.length - 1]);
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z));
  const L = cum[cum.length - 1];
  const pt = (s) => {
    const ss = clamp(s, 0, L);
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= ss) lo = mid;
      else hi = mid;
    }
    const t = (ss - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return { x: lerp(out[lo].x, out[hi].x, t), z: lerp(out[lo].z, out[hi].z, t) };
  };
  const at = (s) => {
    const p = pt(s);
    const a = pt(s - 0.004);
    const b = pt(s + 0.004);
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: p.x, z: p.z, tx: tx / l, tz: tz / l };
  };
  return { L, at };
}

// Casca estofada contínua ao longo de um caminho em planta (encosto + braços).
// T(s) espessura, y0(s)/y1(s) base e topo, lean(s) inclinação para fora (rad).
// As pontas recebem tampas arredondadas em planta (capDrop arredonda também o topo da ponta).
function shell(c, path, o, material) {
  const { THREE } = c;
  const { s0 = 0, s1 = path.L, step = 0.016, T, y0, y1, lean = () => 0, capStart = true, capEnd = true, capDrop = 0.6, bulge = 0 } = o;
  const Y = new THREE.Vector3(0, 1, 0);
  const st = [];
  const station = (s, off = 0, k = 1, arc = off) => {
    const p = path.at(s);
    const tan = new THREE.Vector3(p.tx, 0, p.tz);
    const N = new THREE.Vector3(p.tz, 0, -p.tx); // para fora (Y x T)
    const ln = lean(s);
    const b = Y.clone().multiplyScalar(Math.cos(ln)).addScaledVector(N, Math.sin(ln));
    const base = y0(s);
    const th = (T(s) / 2) * k;
    const drop = (T(s) / 2) * (1 - k) * capDrop;
    const top = y1(s) - drop;
    return {
      o: new THREE.Vector3(p.x, base, p.z).addScaledVector(tan, off),
      a: N,
      b,
      a0: -th,
      a1: th,
      b0: 0,
      b1: Math.max(0.002, (top - base) / Math.cos(ln)),
      r: th,
      u: s + arc,
      bulge: bulge * k,
    };
  };
  const n = Math.max(2, Math.ceil((s1 - s0) / step));
  const K = 7;
  if (capStart) {
    for (let k = K; k >= 1; k--) {
      const t = (k / K) * (Math.PI / 2);
      st.push(station(s0, (-T(s0) / 2) * Math.sin(t), Math.cos(t), (-T(s0) / 2) * t));
    }
  }
  for (let i = 0; i <= n; i++) st.push(station(s0 + ((s1 - s0) * i) / n));
  if (capEnd) {
    for (let k = 1; k <= K; k++) {
      const t = (k / K) * (Math.PI / 2);
      st.push(station(s1, (T(s1) / 2) * Math.sin(t), Math.cos(t), (T(s1) / 2) * t));
    }
  }
  return loft(c, st, material, { cs: 5, vFrom: 'bottom' });
}

// kit.tube reconhece curvas pela flag isCurve (o three.js r170 não define): marcamos aqui
function pcurve(c, pts, rc) {
  const cv = c.kit.polyCurve(pts, rc);
  cv.isCurve = true;
  return cv;
}

// Vivo (cordão) em laço retangular arredondado no plano XY, centrado na origem
function pipingLoop(c, w, h, rr, material, rad = 0.0042) {
  const { kit } = c;
  const pts = [
    [0, -h / 2, 0],
    [w / 2, -h / 2, 0],
    [w / 2, h / 2, 0],
    [-w / 2, h / 2, 0],
    [-w / 2, -h / 2, 0],
    [0, -h / 2, 0],
  ];
  return kit.tube(pcurve(c, pts, rr), rad, material, { seg: 72, radial: 6 });
}

// Anel (toro) horizontal: vivo de puff, aro de apoio de banqueta
function ring(c, R, r, material, { part, seg = 64 } = {}) {
  const geo = new c.THREE.TorusGeometry(R, r, 8, seg);
  geo.rotateX(Math.PI / 2);
  return c.kit.mesh(geo, material, { part });
}


/* ---------- versões rápidas de kit.cushion e kit.tufted ---------- */
// Mesma forma do kit.softBoxGeometry (caixa arredondada e estufada, exatamente w x h x d), mas os
// vértices da superfície da grade são indexados uma única vez (sem mergeVertices) e sem alocações.
function softBoxGeo(c, w, h, d, { r = 0.03, puff = 0.12, side = 0.25, step = 0.05, cs = 3 } = {}) {
  const pY = Math.max(0, puff);
  const pS = Math.max(0, puff * side);
  const ax = w / 2 / (1 + pS);
  const ay = h / 2 / (1 + pY);
  const az = d / 2 / (1 + pS);
  const rr = Math.max(0.002, Math.min(r, ax * 0.95, ay * 0.95, az * 0.95));
  const axis = (half) => {
    const fs = clamp(Math.round((2 * (half - rr)) / step), 2, 20);
    const b = half - rr;
    const out = [];
    for (let i = 0; i <= cs; i++) out.push(-half + (rr * i) / cs);
    for (let i = 1; i < fs; i++) out.push(-b + (2 * b * i) / fs);
    for (let i = 0; i <= cs; i++) out.push(b + (rr * i) / cs);
    return out;
  };
  const xs = axis(ax);
  const ys = axis(ay);
  const zs = axis(az);
  const nx = xs.length;
  const ny = ys.length;
  const nz = zs.length;
  const look = new Int32Array(nx * ny * nz).fill(-1);
  const P = [];
  const bx = ax - rr;
  const by = ay - rr;
  const bz = az - rr;
  const vid = (i, j, k) => {
    const key = (i * ny + j) * nz + k;
    let id = look[key];
    if (id >= 0) return id;
    let x = xs[i];
    let y = ys[j];
    let z = zs[k];
    const qx = clamp(x, -bx, bx);
    const qy = clamp(y, -by, by);
    const qz = clamp(z, -bz, bz);
    let ex = x - qx;
    let ey = y - qy;
    let ez = z - qz;
    const l = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (l > 1e-9) {
      x = qx + (ex / l) * rr;
      y = qy + (ey / l) * rr;
      z = qz + (ez / l) * rr;
    }
    const ux = clamp(x / ax, -1, 1);
    const uy = clamp(y / ay, -1, 1);
    const uz = clamp(z / az, -1, 1);
    const top = (1 - ux * ux) * (1 - uz * uz) * uy * uy;
    const sx = (1 - uy * uy) * (1 - uz * uz) * ux * ux;
    const sz = (1 - uy * uy) * (1 - ux * ux) * uz * uz;
    y += Math.sign(y) * ay * pY * top;
    x += Math.sign(x) * ax * pS * sx;
    z += Math.sign(z) * az * pS * sz;
    id = P.length / 3;
    P.push(x, y, z);
    look[key] = id;
    return id;
  };
  const idx = [];
  // face: eixo fixo (0 x, 1 y, 2 z) no índice fixo; A e B percorrem os outros dois eixos
  const face = (fixAx, fixI, aAx, bAx, flip) => {
    const nA = [nx, ny, nz][aAx];
    const nB = [nx, ny, nz][bAx];
    const ijk = [0, 0, 0];
    ijk[fixAx] = fixI;
    const at = (a, b) => {
      ijk[aAx] = a;
      ijk[bAx] = b;
      return vid(ijk[0], ijk[1], ijk[2]);
    };
    for (let b = 0; b < nB - 1; b++) {
      for (let a = 0; a < nA - 1; a++) {
        const p00 = at(a, b);
        const p10 = at(a + 1, b);
        const p01 = at(a, b + 1);
        const p11 = at(a + 1, b + 1);
        if (flip) idx.push(p00, p01, p10, p10, p01, p11);
        else idx.push(p00, p10, p01, p10, p11, p01);
      }
    }
  };
  face(2, nz - 1, 0, 1, false); // frente +Z
  face(2, 0, 0, 1, true); // trás -Z
  face(0, nx - 1, 2, 1, true); // +X
  face(0, 0, 2, 1, false); // -X
  face(1, ny - 1, 0, 2, true); // topo +Y
  face(1, 0, 0, 2, false); // base -Y
  const geo = new c.THREE.BufferGeometry();
  geo.setAttribute('position', new c.THREE.Float32BufferAttribute(P, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
// Almofada macia (equivalente ao kit.cushion, mais rápida)
function soft(c, w, h, d, material, { puff = 0.14, r, side = 0.25, part, grain, step } = {}) {
  const rad = r ?? Math.min(h, w, d) * 0.32;
  // ~12 divisões no lado menor (mín. 4 cm) bastam para o estufado; sofás grandes ficam no orçamento de tempo
  const geo = softBoxGeo(c, w, h, d, { r: rad, puff, side, step: step ?? Math.max(0.04, Math.min(w, d) / 12) });
  return c.kit.mesh(geo, material, { part, grain: grain || (w >= d ? 'x' : 'z') });
}

// Painel capitonê (mesma ideia do kit.tufted): a altura de cada vértice só consulta os botões
// e vincos vizinhos na grade de losangos, em vez de todos.
function tuftedFast(c, w, h, d, material, { rows = 3, cols, depth, button = 0.009, part, buttonMaterial, res = 0.016 } = {}) {
  const { kit, THREE } = c;
  const g = kit.group('tufted');
  const relief = depth ?? Math.min(d * 0.45, 0.035);
  const nCols = cols ?? Math.max(2, Math.round(w / 0.16));
  const margin = Math.min(w, h) * 0.08;
  const dx = (w - 2 * margin) / nCols;
  const dy = (h - 2 * margin) / Math.max(1, rows);
  const X0 = -w / 2 + margin;
  const Y0 = -h / 2 + margin;
  const ok = (r, k) => r >= 0 && r <= rows && k >= 0 && k <= nCols && !(r % 2 === 1 && k === nCols);
  const bxOf = (r, k) => X0 + k * dx + (r % 2 ? dx / 2 : 0);
  const R = Math.hypot(dx / 2, dy) * 0.62;
  const band = Math.min(margin * 0.9, 0.03);
  const body = kit.box(w, h, d - relief, material, { r: Math.min(0.012, (d - relief) / 3), part, seg: 2 });
  body.position.z = -relief / 2;
  g.add(body);
  const segD = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(px - ax - vx * t, py - ay - vy * t);
  };
  const hAt = (x, y) => {
    const r0 = Math.floor((y - Y0) / dy);
    let db = 9;
    let dl = 9;
    for (let r = Math.max(0, r0); r <= Math.min(rows, r0 + 1); r++) {
      const k0 = Math.round((x - X0 - (r % 2 ? dx / 2 : 0)) / dx);
      for (let k = k0 - 1; k <= k0 + 1; k++) if (ok(r, k)) db = Math.min(db, Math.hypot(x - bxOf(r, k), y - (Y0 + r * dy)));
    }
    if (r0 >= 0 && r0 < rows) {
      const ya = Y0 + r0 * dy;
      const k0 = Math.round((x - X0 - (r0 % 2 ? dx / 2 : 0)) / dx);
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        if (!ok(r0, k)) continue;
        const ax = bxOf(r0, k);
        for (const k2 of r0 % 2 ? [k, k + 1] : [k - 1, k]) if (ok(r0 + 1, k2)) dl = Math.min(dl, segD(x, y, ax, ya, bxOf(r0 + 1, k2), ya + dy));
      }
    }
    const puffy = Math.pow(sstep(0, R, db), 0.7);
    const crease = 0.55 + 0.45 * sstep(0, dx * 0.16, dl);
    const edge = sstep(0, band, Math.min(w / 2 - Math.abs(x), h / 2 - Math.abs(y)));
    return Math.min(puffy, crease) * edge;
  };
  // painéis largos ficam um pouco menos densos (orçamento de triângulos)
  const rr = Math.max(res, w / 110, h / 80);
  const segX = clamp(Math.round(w / rr), 24, 140);
  const segY = clamp(Math.round(h / rr), 16, 100);
  const geo = new THREE.PlaneGeometry(w - 0.002, h - 0.002, segX, segY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, relief * hAt(pos.getX(i), pos.getY(i)));
  geo.computeVertexNormals();
  // UVs em escala de mundo (tiles do material)
  const ud = material.userData || {};
  if (ud.uv !== 'fit') {
    const [tu, tv] = ud.tile || [1, 1];
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tu, (uv.getY(i) * h) / tv);
  }
  const front = kit.mesh(geo, material, { keepUV: true, part });
  front.position.z = d / 2 - relief;
  g.add(front);
  const bm = buttonMaterial || material;
  for (let r = 0; r <= rows; r++) {
    for (let k = 0; k <= nCols; k++) {
      if (!ok(r, k)) continue;
      const x = bxOf(r, k);
      const y = Y0 + r * dy;
      if (Math.abs(x) > w / 2 - margin * 0.5 || Math.abs(y) > h / 2 - margin * 0.5) continue;
      const b = kit.sphere(button, bm, { seg: 8, part: part || 'detail' });
      b.scale.z = 0.6;
      b.position.set(x, y, d / 2 - relief + relief * hAt(x, y) + button * 0.2);
      b.userData.btn = true;
      g.add(b);
    }
  }
  return g;
}

// Curva um painel (tuftedFast, frente +Z, centrado) para acompanhar o contorno interno de uma casca:
// reto até |x| = xf e, depois, arco de raio Rb dobrando para a frente (cantos do encosto).
// Geometrias são clonadas (as dos botões são compartilhadas: só a posição deles muda).
function bendPanel(c, panel, { xf, Rb, d }) {
  const frame = (x) => {
    const ax = Math.abs(x);
    const sg = Math.sign(x) || 1;
    if (ax <= xf) return { px: x, pz: 0, phi: 0, sg };
    const phi = (ax - xf) / Rb;
    return { px: sg * (xf + Rb * Math.sin(phi)), pz: Rb * (1 - Math.cos(phi)), phi, sg };
  };
  // ponto local (x, z medido a partir da face de trás) -> ponto curvado
  const map = (x, z) => {
    const f = frame(x);
    return [f.px - f.sg * Math.sin(f.phi) * z, f.pz + Math.cos(f.phi) * z, f];
  };
  for (const ch of panel.children) {
    if (!ch.isMesh) continue;
    if (ch.userData.btn) {
      const [x, z, f] = map(ch.position.x, ch.position.z + d / 2);
      ch.position.x = x;
      ch.position.z = z - d / 2;
      ch.rotation.y = f.sg * -f.phi;
      continue;
    }
    // a placa de trás (caixa arredondada) não tem vértices no meio da largura: troca por caixa subdividida
    if (ch.geometry.type === 'BoxGeometry') {
      ch.geometry.computeBoundingBox();
      const bb = ch.geometry.boundingBox;
      const sz = bb.getSize(new c.THREE.Vector3());
      const ct = bb.getCenter(new c.THREE.Vector3());
      const box = new c.THREE.BoxGeometry(sz.x, sz.y, sz.z, Math.max(8, Math.ceil(sz.x / 0.012)), 1, 1).translate(ct.x, ct.y, ct.z);
      ch.geometry = c.kit.mesh(box, ch.material, { grain: 'x' }).geometry;
    }
    ch.updateMatrix();
    const geo = ch.geometry.clone();
    geo.applyMatrix4(ch.matrix);
    ch.position.set(0, 0, 0);
    ch.rotation.set(0, 0, 0);
    ch.scale.set(1, 1, 1);
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const [x, z, f] = map(P.getX(i), P.getZ(i) + d / 2);
      P.setXYZ(i, x, P.getY(i), z - d / 2);
      if (N && f.phi) {
        const cs = Math.cos(f.phi);
        const sn = Math.sin(f.phi) * f.sg;
        const nx = N.getX(i);
        const nz = N.getZ(i);
        N.setXYZ(i, nx * cs - nz * sn, N.getY(i), nx * sn + nz * cs);
      }
    }
    P.needsUpdate = true;
    if (N) N.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    ch.geometry = geo;
  }
  return panel;
}

/* ================================================================== */
/* SOFÁ                                                                */
/* ================================================================== */
function sofaStyle(st) {
  if (st.tufted) return 'chesterfield';
  if (st.organic) return 'organic';
  if (st.reclinable || st.retractable) return 'recliner';
  if (st.retro) return 'retro';
  if (st.looseCushions) return 'confort';
  return 'modern';
}

// Pés de sofá/poltrona estofada: { type, h, r, mat, splay }
function legSpec(c, style, H) {
  const { st, m } = c;
  const legs = st.legs;
  if (style === 'chesterfield') return { type: 'bun', h: clamp(H * 0.065, 0.035, 0.06), r: 0.032, mat: c.wood };
  if (legs === 'hidden') return { type: 'plinth', h: 0.018, mat: m.flat('#1d1a17', { roughness: 0.85 }) };
  if (legs === 'wood_base') return { type: 'woodbase', h: clamp(H * 0.08, 0.05, 0.08), mat: c.wood };
  if (legs === 'metal') return { type: 'metal', h: clamp(H * 0.15, 0.1, 0.16), r: 0.011, mat: c.dark };
  // confort: sapatas metálicas (como na foto); se o variante escolheu uma madeira (ex.: "Bege e Nogueira"), sapatas de madeira
  // (#6b4a32 e #8a5a36 são as madeiras padrão do infer para sofá/poltrona)
  if (style === 'confort') {
    const picked = !['#6b4a32', '#8a5a36'].includes(String(c.C.wood || '').toLowerCase());
    return { type: 'block', h: 0.035, mat: picked ? c.wood : m.metal('#b8bbbe', { finish: 'brushed' }) };
  }
  if (style === 'recliner') return { type: 'block', h: 0.03, mat: m.plastic('#1c1c1c', { gloss: 0.2 }) };
  if (legs === 'palito' || style === 'retro') return { type: 'palito', h: clamp(H * 0.165, 0.1, 0.17), r: 0.021, mat: c.wood, splay: 0.12 };
  if (legs === 'turned') return { type: 'turned', h: clamp(H * 0.14, 0.08, 0.15), r: 0.026, mat: c.wood };
  return { type: 'tapered', h: clamp(H * 0.12, 0.07, 0.13), r: 0.022, mat: c.wood };
}

// Coloca os pés nos cantos de um retângulo L x Dd (centrado na origem)
function addLegs(c, g, L, Dd, ls) {
  const { kit, m } = c;
  const h = ls.h;
  if (ls.type === 'plinth' || ls.type === 'woodbase') {
    const ins = ls.type === 'plinth' ? 0.05 : 0.025;
    g.add(kit.place(kit.box(L - 2 * ins, h, Dd - 2 * ins, ls.mat, { r: ls.type === 'woodbase' ? 0.006 : 0.002 }), { y: h / 2 }));
    return;
  }
  const spread = ls.type === 'palito' ? h * Math.tan(ls.splay || 0) : 0;
  const ins = ls.inset ?? (ls.type === 'bun' ? 0.06 : ls.type === 'block' ? 0.07 : Math.max(0.05, spread + ls.r + 0.03));
  const xs = L / 2 - ins;
  const zs = Dd / 2 - (ls.insetZ ?? ins);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * xs;
    const z = sz * zs;
    if (ls.type === 'palito') {
      const k = spread / Math.SQRT2;
      g.add(legRod(c, [x, h + 0.01, z], [x + sx * k, 0, z + sz * k], ls.r, ls.r * 0.55, ls.mat));
    } else if (ls.type === 'tapered') {
      g.add(legRod(c, [x, h + 0.01, z], [x, 0, z], ls.r, ls.r * 0.6, ls.mat, { square: true }));
    } else if (ls.type === 'block') {
      g.add(kit.place(kit.box(0.08, h, 0.05, ls.mat, { r: 0.004 }), { x, y: h / 2, z }));
    } else if (ls.type === 'metal') {
      g.add(kit.place(kit.leg('metal_square', { h, r: 0.022, material: ls.mat }), { x, z }));
    } else {
      g.add(kit.place(kit.leg(ls.type, { h, r: ls.r, material: ls.mat }), { x, z }));
    }
  }
  // sofás longos ganham um apoio central escondido atrás
  if (L > 1.9 && ls.type !== 'block') g.add(kit.place(kit.box(0.04, h, 0.04, m.flat('#1d1a17')), { y: h / 2, z: -zs }));
}

// Braço de sofá/poltrona (lado -1 esquerdo, +1 direito)
function armPiece(c, o, side) {
  const { kit, THREE, m, fab } = c;
  const { L, Dd, armW: aw } = o;
  const legH = o.ls.h;
  const g = kit.group('arm');
  const xC = side * (L / 2 - aw / 2);
  const ah = o.armTop - legH;
  if (o.armStyle === 'pillow') {
    // braço confort: corpo que alarga para cima + almofada de apoio grossa por cima
    const padH = clamp(ah * 0.27, 0.1, 0.16);
    const bodyH = ah - padH + 0.04;
    const bev = 0.014;
    const inP = 0.02;
    const outP = clamp(aw * 0.12, 0.02, 0.04);
    const xi = -aw / 2 + inP + bev;
    const xo = aw / 2 - outP - bev;
    const xoB = xo - aw * 0.28;
    const pts = [
      [xi, bev],
      [xoB, bev],
      [xo, bodyH * 0.72],
      [xo, bodyH - bev],
      [xi, bodyH - bev],
    ].map(([x, y]) => [x * side, y]);
    const s = new THREE.Shape();
    s.moveTo(...pts[0]);
    s.lineTo(...pts[1]);
    s.quadraticCurveTo(lerp(xoB, xo, 0.75) * side, bodyH * 0.45, ...pts[2]);
    s.lineTo(...pts[3]);
    s.lineTo(...pts[4]);
    s.closePath();
    const depth = Dd - 0.03;
    const body = kit.extrude(s, depth, fab, { bevel: bev, curveSegments: 16 });
    g.add(kit.place(body, { x: xC, y: legH, z: -0.015 }));
    g.add(kit.place(soft(c, aw, padH, Dd, fab, { puff: 0.2, r: padH * 0.47, side: 0.4 }), { x: xC, y: legH + ah - padH / 2 }));
    // costura decorativa curva na frente do braço
    const seamMat = m.fabric(kit.shade(c.main, -0.22), { kind: 'cotton' });
    const P0 = [xi + aw * 0.14, bodyH - padH * 0.25 - 0.02];
    const P1 = [xi + aw * 0.18, bodyH * 0.22];
    const P2 = [xoB - 0.004, 0.025];
    const seam = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const x = (1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0];
      const y = (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1];
      seam.push([xC + x * side, legH + y, Dd / 2 - 0.03 + 0.0015]);
    }
    g.add(kit.tube(seam, 0.0016, seamMat, { seg: 24, radial: 4, part: 'detail' }));
    return g;
  }
  if (o.armStyle === 'pad') {
    // braço de retrátil/reclinável: bloco macio com almofada de apoio
    const padH = clamp(ah * 0.3, 0.1, 0.16);
    g.add(kit.place(soft(c, aw, ah - padH + 0.03, Dd, fab, { puff: 0.04, r: Math.min(0.04, aw * 0.2), side: 0.4 }), { x: xC, y: legH + (ah - padH + 0.03) / 2 }));
    g.add(kit.place(soft(c, aw + 0.004, padH, Dd, fab, { puff: 0.26, r: padH * 0.46, side: 0.3 }), { x: xC - side * 0.002, y: legH + ah - padH / 2 }));
    return g;
  }
  // 'track': braço reto e fino (retrô / moderno)
  const r = Math.min(o.armR ?? 0.03, aw * 0.3);
  g.add(kit.place(soft(c, aw, ah, Dd, fab, { puff: 0.02, r, side: 0.25 }), { x: xC, y: legH + ah / 2 }));
  if (o.piping) {
    const e = r * 0.3;
    for (const z of [Dd / 2 - e, -Dd / 2 + e]) g.add(kit.place(pipingLoop(c, aw - 2 * e, ah - 2 * e, r * 0.7, fab), { x: xC, y: legH + ah / 2, z }));
  }
  return g;
}

// Trecho reto de sofá (base, encosto, braços, almofadas) em coordenadas locais:
// x em [-L/2, L/2], z em [-Dd/2, Dd/2] (frente +Z), y em [0, H].
function sofaRun(c, o) {
  const { kit, fab } = c;
  const g = kit.group('sofa-run');
  const { L, Dd, H, ls } = o;
  const legH = ls.h;
  const aL = o.armL ? o.armW : 0;
  const aR = o.armR ? o.armW : 0;
  const zB = -Dd / 2;
  const zF = Dd / 2;
  const bT = o.backT;
  const deckTop = o.seatTop - o.cushT;
  const sideL = o.endBackL ? bT : 0;
  const sideR = o.endBackR ? bT : 0;
  const x0 = -L / 2 + Math.max(aL, sideL);
  const x1 = L / 2 - Math.max(aR, sideR);
  const Li = x1 - x0;
  const ov = 0.015;

  // braço confort alarga para cima: as sapatas vão sob a base do braço, não para fora dela
  let feet = ls;
  if (o.armStyle === 'pillow' && ls.type === 'block' && o.armW > 0 && (o.armL || o.armR)) {
    const aw = o.armW;
    feet = { ...ls, inset: clamp(aw * 0.12, 0.02, 0.04) + 0.014 + aw * 0.28 + 0.045, insetZ: 0.07 };
  }
  addLegs(c, g, L, Dd, feet);

  // estrado estofado (sob as almofadas)
  const baseH = deckTop - legH;
  const bx0 = o.armL ? x0 - ov : -L / 2;
  const bx1 = o.armR ? x1 + ov : L / 2;
  const baseFront = zF - (o.baseRecess || 0);
  g.add(kit.place(soft(c, bx1 - bx0, baseH, baseFront - zB, fab, { puff: 0.02, r: Math.min(0.025, baseH * 0.3), side: 0.4 }), { x: (bx0 + bx1) / 2, y: legH + baseH / 2, z: (zB + baseFront) / 2 }));

  // encosto fixo (estrutura atrás das almofadas)
  const backH = o.backTop - deckTop + 0.02;
  const kx0 = o.armL ? x0 - ov : -L / 2;
  const kx1 = o.armR ? x1 + ov : L / 2;
  const tight = o.backStyle === 'tight';
  g.add(kit.place(soft(c, kx1 - kx0, backH, bT, fab, { puff: tight ? 0.07 : 0.03, r: Math.min(0.05, bT * 0.32), side: 0.5 }), { x: (kx0 + kx1) / 2, y: deckTop - 0.02 + backH / 2, z: zB + bT / 2 }));
  for (const [on, sx] of [[o.endBackL, -1], [o.endBackR, 1]]) {
    if (!on) continue;
    g.add(kit.place(soft(c, bT, backH, Dd, fab, { puff: 0.03, r: Math.min(0.05, bT * 0.32), side: 0.5 }), { x: sx * (L / 2 - bT / 2), y: deckTop - 0.02 + backH / 2 }));
  }

  // braços
  if (o.armL) g.add(armPiece(c, o, -1));
  if (o.armR) g.add(armPiece(c, o, 1));

  // almofadas do assento
  const seatFront = zF - (o.seatInset ?? 0.004);
  const seatBack = zB + bT - 0.012;
  const seatD = seatFront - seatBack;
  const n = o.bench ? 1 : Math.max(1, o.nSeat);
  const gap = 0.006;
  const cw = (Li - gap * (n + 1)) / n;
  const seatR = Math.min(0.04, o.cushT * 0.34);
  for (let i = 0; i < n; i++) {
    const cx = x0 + gap + cw / 2 + i * (cw + gap);
    if (o.modules) {
      // módulo retrátil: frente estofada até o chão (gaveta) sob cada assento
      const mh = deckTop - legH - 0.012 + 0.01;
      g.add(kit.place(soft(c, cw, mh, 0.16, fab, { puff: 0.03, r: 0.02, side: 0.4, step: 0.06 }), { x: cx, y: legH + 0.012 + mh / 2, z: zF - 0.08 }));
    }
    g.add(kit.place(soft(c, cw, o.cushT, seatD, fab, { puff: o.seatPuff ?? 0.14, r: seatR, side: 0.3 }), { x: cx, y: deckTop + o.cushT / 2, z: (seatFront + seatBack) / 2 }));
  }
  // capitonê do assento inteiriço (retrô)
  if (o.bench && o.seatButtons) {
    const cols = Math.max(3, Math.round(Li / 0.2));
    const dx = (Li - 0.1) / cols;
    for (let i = 0; i <= cols; i++) {
      for (const [row, zt] of [[0, 0.3], [1, 0.62]]) {
        if (row === 1 && i === cols) continue;
        const x = x0 + 0.05 + i * dx + (row ? dx / 2 : 0);
        g.add(kit.place(button(c, fab, 0.007), { x, y: o.seatTop - 0.004, z: seatFront - seatD * zt }));
      }
    }
  }

  // almofadas do encosto
  const nb = Math.max(1, o.nBack || n);
  const bct = o.backCushT;
  const bh = H - (o.seatTop - 0.015);
  const bw = (Li - gap * (nb + 1)) / nb;
  if (o.backStyle === 'pillows' || o.backStyle === 'tiered') {
    for (let i = 0; i < nb; i++) {
      const cx = x0 + gap + bw / 2 + i * (bw + gap);
      if (o.backStyle === 'tiered') {
        // encosto em gomos (reclinável): três rolos empilhados, o de cima é o apoio de cabeça
        const parts = [0.4, 0.38, 0.36];
        let yb = o.seatTop - 0.015;
        parts.forEach((f, k) => {
          const hh = bh * f;
          const cu = soft(c, bw, hh, bct, fab, { puff: 0.24, r: hh * 0.42, side: 0.3, step: 0.055 });
          cu.rotation.x = -o.tilt;
          cu.position.set(cx, yb + hh / 2, 0);
          snap(c, cu, { minZ: zB + bT - 0.04 - k * 0.006 });
          if (k === parts.length - 1) snap(c, cu, { maxY: H });
          g.add(cu);
          yb += hh - 0.055;
        });
      } else {
        const cu = soft(c, bw, bh, bct, fab, { puff: o.backPuff ?? 0.16, r: Math.min(o.style === 'confort' ? 0.05 : 0.06, bct * 0.42), side: 0.35 });
        cu.rotation.x = -o.tilt;
        cu.position.x = cx;
        snap(c, cu, { maxY: H, minZ: zB + bT - 0.03 });
        g.add(cu);
      }
    }
    // almofada de canto apoiada no encosto lateral
    for (const [on, sx] of [[o.endBackL, -1], [o.endBackR, 1]]) {
      if (!on) continue;
      const span = Dd - bT - 0.02;
      const inner = soft(c, span * 0.9, bh, bct, fab, { puff: o.backPuff ?? 0.16, r: Math.min(0.06, bct * 0.42), side: 0.35 });
      inner.rotation.x = -o.tilt;
      const wrap = kit.group('corner-cushion', inner);
      wrap.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
      wrap.position.z = (zB + bT + zF) / 2 + 0.01;
      if (sx < 0) snap(c, wrap, { maxY: H, minX: -L / 2 + bT - 0.03 });
      else snap(c, wrap, { maxY: H, maxX: L / 2 - bT + 0.03 });
      g.add(wrap);
    }
  }

  // rolinhos (bolsters) junto aos braços — típico do sofá retrô
  if (o.bolsters) {
    const rb = clamp(o.cushT * 0.48, 0.055, 0.08);
    const lb = clamp(Li * 0.17, 0.24, 0.36);
    const prof = [[0.0001, -lb / 2], [rb * 0.82, -lb / 2], [rb * 0.97, -lb / 2 + rb * 0.18], [rb, -lb / 2 + rb * 0.4], [rb, lb / 2 - rb * 0.4], [rb * 0.97, lb / 2 - rb * 0.18], [rb * 0.82, lb / 2], [0.0001, lb / 2]];
    for (const sx of [-1, 1]) {
      if ((sx < 0 && !o.armL) || (sx > 0 && !o.armR)) continue;
      const b = kit.lathe(prof, fab, { seg: 28 });
      b.rotation.z = Math.PI / 2;
      b.position.set(sx < 0 ? x0 + lb / 2 + 0.008 : x1 - lb / 2 - 0.008, o.seatTop + rb - 0.012, zB + bT + bct * 0.85 + rb);
      g.add(b);
    }
  }
  return g;
}

// Parâmetros do trecho por estilo
function runParams(c, style, W, D, H) {
  const ls = legSpec(c, style, H);
  const p = { H, ls, style, tilt: 0.12, backStyle: 'pillows', armStyle: 'track' };
  const legH = ls.h;
  if (style === 'retro') {
    if (ls.type === 'palito') ls.inset = clamp(W * 0.075, 0.07, 0.17);
    Object.assign(p, {
      seatTop: clamp(H * 0.55, 0.38, 0.47),
      armW: clamp(W * 0.062, 0.1, 0.15),
      armR: 0.025,
      piping: true,
      backT: clamp(D * 0.19, 0.13, 0.2),
      backPuff: 0.13,
      seatPuff: 0.08,
      bench: true,
      seatButtons: true,
      bolsters: true,
      tilt: 0.1,
    });
    p.armTop = clamp(H * 0.76, p.seatTop + 0.12, H - 0.06);
  } else if (style === 'confort') {
    Object.assign(p, {
      seatTop: clamp(H * 0.58, 0.4, 0.5),
      armStyle: 'pillow',
      armW: clamp(W * 0.17, 0.18, 0.33),
      backT: clamp(D * 0.2, 0.15, 0.22),
      backPuff: 0.15,
      seatPuff: 0.14,
      seatInset: 0.035,
      tilt: 0.15,
    });
    p.armTop = clamp(H * 0.78, p.seatTop + 0.12, H - 0.08);
  } else if (style === 'recliner') {
    Object.assign(p, {
      seatTop: clamp(H * 0.47, 0.4, 0.48),
      armStyle: 'pad',
      armW: clamp(W * 0.11, 0.17, 0.27),
      backT: clamp(D * 0.18, 0.15, 0.22),
      backStyle: 'tiered',
      seatPuff: 0.2,
      modules: true,
      baseRecess: 0.15,
      tilt: 0.1,
    });
    p.armTop = clamp(p.seatTop + 0.19, p.seatTop + 0.12, H - 0.12);
  } else {
    Object.assign(p, {
      seatTop: clamp(H * 0.53, 0.38, 0.47),
      armW: clamp(W * 0.075, 0.11, 0.2),
      armR: 0.035,
      backT: clamp(D * 0.2, 0.14, 0.22),
      backPuff: 0.16,
      seatPuff: 0.14,
    });
    p.armTop = clamp(p.seatTop + 0.2, p.seatTop + 0.12, H - 0.08);
  }
  if (c.st.arms === false) p.armW = 0;
  p.cushT = clamp((p.seatTop - legH) * (style === 'confort' ? 0.3 : 0.48), 0.1, 0.19);
  p.backTop = style === 'recliner' ? H - clamp(H * 0.16, 0.1, 0.17) : style === 'confort' ? H - 0.1 : H - 0.04;
  p.backCushT = clamp(D * (style === 'confort' ? 0.24 : 0.2), 0.13, 0.25);
  return p;
}

function seatsFor(c, len) {
  const want = c.st.seats || Math.round(len / 0.62);
  return clamp(Math.round(want), 1, Math.max(1, Math.floor(len / 0.42)));
}

function runSofa(c, style) {
  const { kit, W, H, D, st } = c;
  const g = kit.group(`sofa-${style}`);
  const p = runParams(c, style, W, D, H);
  const arms = st.arms !== false && p.armW > 0;
  const backCount = (n) => (style === 'retro' ? (n <= 3 ? Math.min(2, n) : n - 1) : n);
  const right = /direit/.test(c.label);

  if (st.corner && D > 1.2 && W > 1.4) {
    // sofá de canto em L: trecho do fundo (largura toda) + retorno lateral até a frente
    const side = right ? 1 : -1;
    const Dm = clamp(Math.min(D, W) * 0.45, 0.8, 1.0);
    const nA = seatsFor(c, W - p.armW - p.backT) || 2;
    const runA = sofaRun(c, { ...p, L: W, Dd: Dm, armL: arms && side > 0, armR: arms && side < 0, endBackL: side < 0, endBackR: side > 0, nSeat: Math.max(1, Math.round((W - p.armW - p.backT) / 0.62)), nBack: Math.max(1, Math.round((W - p.armW - p.backT) / 0.62)), bench: false, bolsters: false });
    runA.position.z = -D / 2 + Dm / 2;
    g.add(runA);
    const LB = D - Dm;
    const nB = Math.max(1, Math.round((LB - p.armW) / 0.62));
    const runB = sofaRun(c, { ...p, L: LB, Dd: Dm, armL: arms && side < 0, armR: arms && side > 0, nSeat: nB, nBack: nB, bench: false, bolsters: false });
    runB.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    runB.position.set(side * (W / 2 - Dm / 2), 0, -D / 2 + Dm + LB / 2);
    g.add(runB);
    void nA;
    return g;
  }
  if (st.chaise && D > 1.05 && W > 1.2) {
    // sofá com chaise: corpo principal + módulo longo no lado da chaise
    const side = right ? 1 : -1;
    const mainD = D >= 1.3 ? clamp(D * 0.58, 0.82, 1.0) : D * 0.72;
    const nTot = seatsFor(c, W - 2 * p.armW);
    const chW = clamp((W - 2 * p.armW) / Math.max(2, nTot) + p.armW, 0.62, W * 0.45);
    const nMain = Math.max(1, nTot - 1);
    const runM = sofaRun(c, { ...p, L: W - chW, Dd: mainD, armL: arms && side > 0, armR: arms && side < 0, nSeat: nMain, nBack: backCount(nMain), bolsters: false, bench: style === 'retro' && nMain <= 3 });
    runM.position.set(-side * (chW / 2), 0, -D / 2 + mainD / 2);
    g.add(runM);
    const runC = sofaRun(c, { ...p, L: chW, Dd: D, armL: arms && side < 0, armR: arms && side > 0, nSeat: 1, nBack: 1, bolsters: false, bench: true, seatButtons: false });
    runC.position.set(side * (W / 2 - chW / 2), 0, 0);
    g.add(runC);
    return g;
  }
  const n = seatsFor(c, W - 2 * (arms ? p.armW : 0));
  const bench = style === 'retro' ? n <= 3 : false;
  g.add(sofaRun(c, { ...p, L: W, Dd: D, armL: arms, armR: arms, nSeat: n, nBack: backCount(n), bench, bolsters: style === 'retro' && arms }));
  return g;
}

/* ---------- Chesterfield ---------- */
// UVs das paredes laterais de um extrude pelo comprimento de arco do contorno. O gerador padrão do three
// projeta cada trecho em x ou em y e estica a trama nas curvas (o rolo do braço ficava "listrado").
function contourUV(mesh, pts, material) {
  const ud = material.userData || {};
  if (ud.uv === 'fit') return mesh;
  const [tu, tv] = ud.tile || [1, 1];
  const geo = mesh.geometry;
  const P = geo.attributes.position;
  const N = geo.attributes.normal;
  const UV = geo.attributes.uv;
  if (!N || !UV) return mesh;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const param = (x, y) => {
    let best = Infinity;
    let u = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const L2 = vx * vx + vy * vy || 1e-12;
      const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / L2, 0, 1);
      const d = Math.hypot(x - a.x - vx * t, y - a.y - vy * t);
      if (d < best) {
        best = d;
        u = cum[i - 1] + t * Math.sqrt(L2);
      }
    }
    return u;
  };
  for (let i = 0; i < P.count; i++) {
    if (Math.abs(N.getZ(i)) > 0.7) continue; // tampas da frente e de trás mantêm a projeção plana
    UV.setXY(i, param(P.getX(i), P.getY(i)) / tu, P.getZ(i) / tv);
  }
  UV.needsUpdate = true;
  return mesh;
}

// Braço rolado: perfil em "P" (vista frontal) extrudado na profundidade, com tachas na frente
function rolledArm(c, { aw, ah, depth, ov, side, nails = true }) {
  const { kit, THREE, m, fab } = c;
  const g = kit.group('rolled-arm');
  const bev = 0.012;
  const rs = (aw + ov) / 2 - bev;
  const xi = -aw / 2 + bev;
  const xo = aw / 2 - bev;
  const cx = xi + rs;
  const cy = ah - bev - rs;
  const thc = -Math.acos(clamp((xo - cx) / rs, -1, 1));
  const s = new THREE.Shape();
  const X = (x) => x * side;
  s.moveTo(X(xi), bev);
  s.lineTo(X(xo), bev);
  s.lineTo(X(xo), cy + rs * Math.sin(thc));
  const steps = 28;
  for (let k = 1; k <= steps; k++) {
    const a = thc + ((Math.PI - thc) * k) / steps;
    s.lineTo(X(cx + rs * Math.cos(a)), cy + rs * Math.sin(a));
  }
  s.lineTo(X(xi), bev);
  g.add(contourUV(kit.extrude(s, depth, fab, { bevel: bev, curveSegments: 4 }), s.getPoints(1), fab));
  if (nails) {
    // tachas acompanhando a borda externa e o rolo
    const brass = m.metal('#8c7448', { finish: 'brushed' });
    const z = depth / 2 + 0.0015;
    const e = 0.017;
    const pts = [];
    const yTop = cy + (rs - e) * Math.sin(thc);
    for (let y = 0.03; y < yTop; y += 0.024) pts.push([xo - e + bev, y]);
    const arcL = (rs - e) * (Math.PI - thc);
    const na = Math.floor(arcL / 0.024);
    for (let k = 0; k <= na; k++) {
      const a = thc + ((Math.PI * 0.92 - thc) * k) / na;
      pts.push([cx + (rs - e) * Math.cos(a), cy + (rs - e) * Math.sin(a)]);
    }
    for (const [x, y] of pts) {
      const n = kit.sphere(0.0048, brass, { seg: 6, part: 'detail' });
      n.scale.z = 0.6;
      n.position.set(X(x), y, z);
      g.add(n);
    }
  }
  return { group: g, cy, rs };
}

function chesterfield(c, nSeatHint) {
  const { kit, m, fab, W, H, D } = c;
  const g = kit.group('sofa-chesterfield');
  const footH = clamp(H * 0.065, 0.035, 0.06);
  const seatTop = clamp(H * 0.58, 0.38, 0.47);
  const cushT = clamp(H * 0.15, 0.09, 0.13);
  const deckTop = seatTop - cushT;
  const ov = clamp(W * 0.02, 0.022, 0.04);
  const aw = clamp(W * 0.1, 0.12, 0.19);
  const armOut = aw + ov;
  const armTop = H - 0.012;
  const backT = clamp(D * 0.22, 0.15, 0.22);
  const x0 = -W / 2 + armOut;
  const x1 = W / 2 - armOut;
  const Li = x1 - x0;
  const zB = -D / 2;
  const zF = D / 2;
  const btnMat = fab;

  // pés boleados sob os cantos dos braços
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(kit.place(kit.leg('bun', { h: footH, r: 0.034, material: c.wood }), { x: sx * (W / 2 - ov - aw * 0.42), z: sz * (D / 2 - 0.065) }));

  // braços rolados + painel capitonê interno
  let armInfo = null;
  for (const side of [-1, 1]) {
    const a = rolledArm(c, { aw, ah: armTop - footH, depth: D, ov, side });
    armInfo = a;
    g.add(kit.place(a.group, { x: side * (W / 2 - ov - aw / 2), y: footH }));
    const panelH = footH + a.cy - deckTop + 0.01;
    const pd = D - backT - 0.03;
    const panel = tuftedFast(c, pd, panelH, 0.03, fab, { rows: 2, cols: Math.max(2, Math.round(pd / 0.17)), buttonMaterial: btnMat });
    panel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    panel.position.set(side * (W / 2 - armOut - 0.004), deckTop + panelH / 2 - 0.01, zB + backT + pd / 2 - 0.005);
    g.add(panel);
  }

  // base: bloco interno + frente em gomos com botões + faixa lisa embaixo
  const bandH = 0.032;
  g.add(kit.place(soft(c, Li + 0.03, deckTop - footH, D - 0.05, fab, { puff: 0.01, r: 0.01 }), { y: footH + (deckTop - footH) / 2, z: -0.025 }));
  g.add(kit.place(kit.box(Li + 0.01, bandH, 0.05, fab, { r: 0.012, seg: 2 }), { y: footH + bandH / 2, z: zF - 0.027 }));
  // frente da base em capitonê (losangos com botões), como na foto — não em gomos verticais
  const padH = deckTop - footH - bandH + 0.006;
  const rail = tuftedFast(c, Li, padH, 0.05, fab, { rows: 2, cols: Math.max(3, Math.round(Li / 0.15)), buttonMaterial: btnMat, depth: 0.024 });
  rail.position.set(0, footH + bandH + padH / 2 - 0.003, zF - 0.025);
  g.add(rail);

  // assento capitonê inteiriço (o número de lugares define as colunas de botões)
  const seatD = D - backT - 0.012;
  const seatCols = Math.max(3, Math.round(Li / 0.19)) + (nSeatHint > 2 ? 1 : 0);
  const seat = tuftedFast(c, Li - 0.02, seatD, cushT, fab, { rows: 2, cols: seatCols, buttonMaterial: btnMat });
  seat.rotation.x = -Math.PI / 2;
  seat.position.set(0, deckTop + cushT / 2, zF - 0.03 - seatD / 2);
  g.add(seat);
  const nr = cushT * 0.52;
  const nl = Li - 0.012;
  const nose = kit.lathe([[0.0001, -nl / 2], [nr * 0.8, -nl / 2], [nr, -nl / 2 + nr * 0.3], [nr, nl / 2 - nr * 0.3], [nr * 0.8, nl / 2], [0.0001, nl / 2]], fab, { seg: 24 });
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0, deckTop + cushT / 2 - 0.002, zF - nr - 0.002);
  g.add(nose);

  // encosto capitonê + rolo no topo (mesma altura dos braços)
  const rollR = backT * 0.36;
  const backH = H - rollR * 0.7 - deckTop + 0.02;
  const back = tuftedFast(c, Li + 0.004, backH, backT, fab, { rows: 3, cols: Math.max(3, Math.round(Li / 0.15)), buttonMaterial: btnMat, depth: 0.04 });
  back.position.set(0, deckTop - 0.02 + backH / 2, zB + backT / 2);
  g.add(back);
  const rl = Li + 0.004;
  const prof = [[0.0001, -rl / 2], [rollR * 0.7, -rl / 2], [rollR * 0.95, -rl / 2 + rollR * 0.25], [rollR, -rl / 2 + rollR * 0.5], [rollR, rl / 2 - rollR * 0.5], [rollR * 0.95, rl / 2 - rollR * 0.25], [rollR * 0.7, rl / 2], [0.0001, rl / 2]];
  const roll = kit.lathe(prof, fab, { seg: 28 });
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, H - rollR, zB + rollR + 0.004);
  g.add(roll);
  void armInfo;
  void m;
  return g;
}

/* ---------- Orgânico (casca curva sobre base de madeira) ---------- */
// Assento em casca: casca contínua encosto+braços (com ajuste fino até bater W x D), assento e base.
function shellSeat(c, o) {
  const { kit, THREE, fab, W, H, D } = c;
  const g = kit.group('shell-seat');
  const { y0, seatTop, cushT, Tb, Ta, leanB, leanA, rc, flare = 0, height, notch = null, tip = 0.9 } = o;
  const thick = (zn) => lerp(Tb, Ta, sstep(0, 0.35, zn)) * lerp(1, tip, sstep(0.55, 1, zn));
  const leanOf = (zn) => lerp(leanB, leanA, sstep(0, 0.35, zn));
  let xa = W / 2 - Ta / 2 - flare - (height(0.6) - y0) * Math.tan(leanA);
  let zb = -D / 2 + Tb / 2 + (H - y0) * Math.tan(leanB);
  const zf = D / 2 - (Ta * tip) / 2;
  let pieces = [];
  let box = null;
  for (let it = 0; it < 4; it++) {
    const path = planPath(c, [[-(xa + flare), zf], [-xa, zb], [xa, zb], [xa + flare, zf]], rc);
    const zn = (s) => clamp((path.at(s).z - zb) / (zf - zb), 0, 1);
    const prm = { T: (s) => thick(zn(s)), y0: () => y0, y1: (s) => height(zn(s)), lean: (s) => leanOf(zn(s)), capDrop: o.capDrop ?? 0.6, bulge: o.bulge || 0 };
    pieces = [];
    if (notch) {
      // fenda no encosto: duas cascas com pontas arredondadas que descem em "V"
      const sN = path.L / 2 + notch.x;
      const gap = Tb / 2 + 0.003;
      const e1 = sN - gap;
      const e2 = sN + gap;
      const dip = (s, sEnd) => roundProf(Math.abs(s - sEnd) / notch.R);
      pieces.push(shell(c, path, { ...prm, s0: 0, s1: e1, y1: (s) => notch.y + (height(zn(s)) - notch.y) * dip(s, e1) }, fab));
      pieces.push(shell(c, path, { ...prm, s0: e2, s1: path.L, y1: (s) => notch.y + (height(zn(s)) - notch.y) * dip(s, e2) }, fab));
    } else pieces.push(shell(c, path, prm, fab));
    box = new THREE.Box3();
    for (const p of pieces) box.union(kit.measure(p));
    const ex = box.max.x - box.min.x - W;
    const ez = box.max.z - box.min.z - D;
    if (Math.abs(ex) < 0.0015 && Math.abs(ez) < 0.0015) break;
    xa -= ex / 2;
    zb += ez;
  }
  const dz = D / 2 - box.max.z;
  for (const p of pieces) {
    p.position.z += dz;
    g.add(p);
  }
  const zbv = zb + dz;
  // assento (almofada inteiriça) e base estofada dentro da casca
  const deckTop = seatTop - cushT;
  const inX = (y) => xa - Ta / 2 + (y - y0) * Math.tan(leanA);
  const backIn = (y) => zbv + Tb / 2 - (y - y0) * Math.tan(leanB);
  const front = D / 2 - (o.frontInset ?? 0.02);
  const bev = Math.min(cushT * 0.42, 0.05);
  const wb = inX(deckTop) + 0.012 - bev;
  const wf = wb + flare;
  const zbk = backIn(deckTop) - 0.02 + bev;
  const zfr = front - bev;
  const rb = Math.max(0.03, rc - Tb / 2 - 0.02);
  const cushion = planSlab(c, [[-wf, zfr], [wf, zfr], [wb, zbk], [-wb, zbk]], [0.05, 0.05, rb, rb], cushT, fab, { bevel: bev });
  cushion.position.y = deckTop + cushT / 2;
  g.add(cushion);
  const baseH = deckTop - y0 + 0.01;
  const wb2 = inX(y0) + 0.01;
  const bf = front - (o.baseRecess ?? 0.012);
  const base = planSlab(c, [[-(wb2 + flare), bf], [wb2 + flare, bf], [wb2, zbv], [-wb2, zbv]], [0.04, 0.04, rb, rb], baseH, fab, { bevel: 0.01 });
  base.position.y = y0 + baseH / 2 - 0.005;
  g.add(base);
  return { group: g, xa, zb: zbv, zf, flare, deckTop };
}

function organicSofa(c) {
  const { kit, THREE, W, H, D } = c;
  const g = kit.group('sofa-organic');
  const legH = clamp(H * 0.24, 0.1, 0.2);
  const plinthT = clamp(H * 0.045, 0.025, 0.04);
  const y0 = legH + plinthT;
  const seatTop = Math.max(y0 + 0.14, clamp(H * 0.56, 0.38, 0.47));
  const cushT = clamp((seatTop - y0) * 0.7, 0.08, 0.15);
  const Tb = clamp(D * 0.15, 0.1, 0.15);
  const Ta = Tb * 0.88;
  const tipY = seatTop + 0.03;
  const height = (zn) => tipY + (H - tipY) * (1 - Math.pow(zn, 1.7));
  const seats = seatsFor(c, W - 2 * Ta);
  let notch = null;
  if (seats >= 2 && W > 1.2) {
    const nx = seats % 2 === 1 ? -W / 2 + W / seats + 0.02 : 0;
    // o fundo da fenda fica abaixo da borda arredondada da almofada (senão a ponta da casca aparece sobre o assento)
    notch = { x: nx, R: clamp(W * 0.05, 0.08, 0.13), y: seatTop - cushT * 0.6 };
  }
  const res = shellSeat(c, { y0, seatTop, cushT, Tb, Ta, leanB: 0.1, leanA: 0.14, rc: clamp(D * 0.24, 0.16, 0.26), flare: 0.0, height, notch, tip: 0.75, capDrop: 0.9, frontInset: 0.03, bulge: 0.008, baseRecess: 0.035 });
  g.add(res.group);
  // base de madeira (plinto) acompanhando o contorno, um pouco recuada
  const pw = W / 2 - Ta * 0.5 - 0.05;
  const pz0 = res.zb - Tb / 2 + 0.06;
  const pz1 = D / 2 - 0.07;
  const plinth = planSlab(c, [[-pw, pz1], [pw, pz1], [pw, pz0], [-pw, pz0]], [0.06, 0.06, 0.16, 0.16], plinthT, c.wood, { bevel: 0.004 });
  plinth.position.y = legH + plinthT / 2;
  g.add(plinth);
  // pés inclinados (abertos para os lados), seção quadrada afunilada
  const lx = W * 0.32;
  const sp = Math.tan(0.5) * legH;
  for (const sx of [-1, 1]) {
    for (const z of [pz1 - 0.12, pz0 + 0.12]) {
      const sz = z > 0 ? 1 : -1;
      g.add(legRod(c, [sx * lx, legH + 0.008, z], [sx * (lx + sp), 0, z + sz * legH * 0.2], 0.03, 0.014, c.wood, { square: true }));
    }
  }
  void THREE;
  return g;
}

/* ---------- Sofá-cama click-clack / futon ---------- */
// Sem braços: base estofada, assento e encosto em gomos (costuras verticais) e pés metálicos curtos
function clickClack(c) {
  const { kit, m, fab, W, H, D, label } = c;
  const g = kit.group('sofa-clickclack');
  const legMat = /madeira/.test(label) ? c.wood : m.metal('#cfd2d4', { finish: 'chrome' });
  const legH = clamp(H * 0.12, 0.08, 0.12);
  const seatTop = clamp(H * 0.5, 0.38, 0.46);
  const seatT = clamp(H * 0.19, 0.12, 0.17);
  const baseTop = seatTop - seatT;
  const tilt = 0.3;
  const bT = seatT * 0.9;
  const yb = baseTop + 0.01;
  const bh = (H - yb - bT * Math.sin(tilt)) / Math.cos(tilt);
  const backFront = -D / 2 + bh * Math.sin(tilt) + bT * Math.cos(tilt);
  const seatBack = backFront - bT * 0.55;
  const sd = D / 2 - seatBack;
  // pés nos cantos da base
  const bd = sd + 0.02;
  for (const sx of [-1, 1]) {
    for (const z of [D / 2 - 0.06, D / 2 - bd + 0.06]) g.add(legRod(c, [sx * (W / 2 - 0.07), legH + 0.01, z], [sx * (W / 2 - 0.07), 0, z], 0.014, 0.012, legMat, { part: 'metal' }));
  }
  // base estofada sob o assento
  g.add(kit.place(soft(c, W - 0.03, baseTop - legH, bd, fab, { puff: 0.02, r: 0.015, side: 0.3 }), { y: legH + (baseTop - legH) / 2, z: D / 2 - bd / 2 - 0.005 }));
  // assento e encosto em gomos
  const nG = Math.max(3, Math.round(W / 0.3));
  const gw = W / nG;
  for (let i = 0; i < nG; i++) {
    const x = -W / 2 + gw * (i + 0.5);
    // gomos com cantos pequenos: leem como uma placa só com costuras, não como almofadas soltas
    g.add(kit.place(soft(c, gw - 0.002, seatT, sd, fab, { puff: 0.08, r: Math.min(0.022, seatT * 0.18), side: 0.15 }), { x, y: baseTop + seatT / 2, z: D / 2 - sd / 2 }));
    const back = soft(c, gw - 0.002, bh, bT, fab, { puff: 0.08, r: Math.min(0.022, bT * 0.18), side: 0.15 });
    back.rotation.x = -tilt;
    back.position.x = x;
    snap(c, back, { maxY: H, minZ: -D / 2 });
    g.add(back);
  }
  return g;
}

export function sofa(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  if (c.st.sofaBed && /click|clack|futon/.test(c.label)) return clickClack(c);
  const style = sofaStyle(c.st);
  if (style === 'organic') return organicSofa(c);
  if (style === 'chesterfield') return chesterfield(c, c.st.seats || 2);
  return runSofa(c, style);
}

/* ================================================================== */
/* POLTRONA                                                            */
/* ================================================================== */
// Poltrona decorativa em casca (bouclé com pés palito), bergère de orelhas ou de balanço
function loungeArmchair(c, { wing = false, rocker = false, swivel = false } = {}) {
  const { kit, m, W, H, D, st } = c;
  const g = kit.group(wing ? 'armchair-wing' : 'armchair-lounge');
  const noArms = st.arms === false && !wing;
  const legH = rocker ? clamp(H * 0.2, 0.12, 0.2) : swivel ? clamp(H * 0.2, 0.1, 0.17) : wing ? clamp(H * 0.13, 0.08, 0.15) : clamp(H * 0.3, 0.12, 0.26);
  const seatTop = clamp(H * (wing ? 0.45 : 0.55), 0.38, 0.47);
  const cushT = clamp(H * 0.13, 0.08, 0.14);
  const armTop = noArms ? seatTop + 0.05 : clamp(seatTop + (wing || rocker ? 0.18 : 0.155), seatTop + 0.1, H - 0.1);
  const Tb = clamp(D * 0.15, 0.08, 0.12);
  const Ta = noArms ? 0.06 : clamp(W * 0.19, 0.1, 0.15);
  const wingTop = H - clamp(H * 0.1, 0.06, 0.12);
  const height = wing
    ? (zn) => lerp(armTop, lerp(H, wingTop, sstep(0, 0.25, zn)), 1 - sstep(0.34, 0.52, zn))
    : (zn) => armTop + (H - armTop) * (1 - sstep(0.08, 0.34, zn));
  const res = shellSeat(c, {
    y0: legH,
    seatTop,
    cushT,
    armTop,
    Tb,
    Ta,
    leanB: wing ? 0.1 : 0.12,
    leanA: wing ? 0.03 : 0.06,
    rc: Math.min(W, D) * (wing ? 0.2 : 0.24),
    flare: wing ? 0.025 : clamp(W * 0.07, 0.02, 0.06),
    height,
    tip: 0.92,
    capDrop: 0.9,
    frontInset: 0.012,
    baseRecess: 0.03,
    bulge: 0.01,
  });
  g.add(res.group);
  // capitonê (bergère): painel com losangos e botões curvado no contorno interno do encosto
  if (st.tufted) {
    const leanB = wing ? 0.1 : 0.12;
    const rcIn = Math.min(W, D) * (wing ? 0.2 : 0.24) - Tb / 2;
    const xf = Math.max(0.04, res.xa - Math.min(W, D) * (wing ? 0.2 : 0.24));
    const pd = 0.045;
    const pw = 2 * (xf + rcIn * 1.15);
    const yBot = res.deckTop;
    const yTopP = H - Tb * 1.05;
    const ph = (yTopP - yBot) / Math.cos(leanB);
    const panel = tuftedFast(c, pw, ph, pd, c.fab, { rows: 4, cols: Math.max(3, Math.round(pw / 0.12)), depth: 0.034, button: 0.0095, buttonMaterial: c.m.upholstery(kit.shade(c.main, -0.3), UPH.has(c.material) ? c.material : 'cotton') });
    bendPanel(c, panel, { xf, Rb: rcIn, d: pd });
    const piv = kit.group('tufted-back', panel);
    // a placa de trás do painel fica embutida na casca: só a face capitonê aparece
    panel.position.set(0, ph / 2, pd / 2 - (pd - 0.034) - 0.002);
    piv.rotation.x = -leanB;
    piv.position.set(0, yBot, res.zb + Tb / 2 - (yBot - legH) * Math.tan(leanB));
    g.add(piv);
  }
  const zBack = res.zb + 0.06;
  const zFront = D / 2 - 0.11;
  if (swivel) {
    // base giratória: disco metálico + coluna + prato sob o assento
    const metal = /cromad|inox/.test(c.label) ? m.metal('#d4d6d8', { finish: 'chrome' }) : c.dark;
    const Rb = clamp(Math.min(W, D) * 0.34, 0.2, 0.3);
    g.add(kit.lathe([[0.0001, 0], [Rb - 0.006, 0], [Rb, 0.006], [Rb * 0.9, 0.018], [0.06, 0.03], [0.04, 0.036], [0.0001, 0.036]], metal, { seg: 48, part: 'metal' }));
    g.add(kit.place(kit.cylinder(0.032, 0.036, legH - 0.03, metal, { seg: 20, part: 'metal' }), { y: 0.03 + (legH - 0.03) / 2 }));
    g.add(kit.place(kit.cylinder(0.12, 0.12, 0.012, metal, { seg: 28, part: 'metal' }), { y: legH - 0.004 }));
    return g;
  }
  if (rocker) {
    // base de balanço: duas lâminas curvas de madeira ligadas por pés curtos
    const wood = c.wood;
    const xr = res.xa - 0.04;
    const R = 1.1;
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const z = lerp(-D / 2 + 0.03, D / 2 - 0.03, k / 16);
        pts.push([sx * xr, 0.016 + (R - Math.sqrt(R * R - z * z)), z]);
      }
      g.add(kit.tube(pts, 0.016, wood, { seg: 32, radial: 10, part: 'wood' }));
      for (const z of [zBack, zFront]) {
        const yb = 0.016 + (R - Math.sqrt(R * R - z * z));
        g.add(rod(c, [sx * xr, yb, z], [sx * xr, legH + 0.01, z], 0.016, 0.018, wood, { part: 'wood' }));
      }
    }
    return g;
  }
  const ferr = { material: m.flat('#1b1b1b', { roughness: 0.45, metalness: 0.4 }), len: 0.02 };
  for (const sx of [-1, 1]) {
    for (const [z, sz] of [[zBack, -1], [zFront, 1]]) {
      const x = sx * (z > 0 ? res.xa + res.flare - 0.05 : res.xa - 0.045);
      if (wing) {
        const back = sz < 0;
        g.add(legRod(c, [x, legH + 0.01, z], [x + sx * 0.008, 0, z + (back ? -0.02 : 0.004)], 0.022, 0.014, c.wood, { square: true }));
      } else {
        const sp = legH * Math.tan(0.24);
        g.add(legRod(c, [x, legH + 0.01, z], [x + sx * sp * 0.75, 0, z + sz * sp * 0.66], 0.017, 0.01, c.wood, { ferrule: ferr }));
      }
    }
  }
  return g;
}

// Poltrona industrial: estrutura de tubo metálico preto, assento e encosto estofados, apoio de braço em madeira
function industrialArmchair(c) {
  const { kit, m, fab, W, H, D, C } = c;
  const g = kit.group('armchair-industrial');
  const tr = clamp(W * 0.016, 0.009, 0.0125);
  const metal = c.dark;
  const ys = clamp(H * 0.42, 0.26, 0.36);
  const cushT = clamp(H * 0.17, 0.09, 0.15);
  const armTop = clamp(H * 0.77, ys + cushT + 0.1, H - 0.05);
  const xs = W / 2 - tr;
  const zf = D / 2 - tr - 0.002;
  const zFoot = -D / 2 + tr + 0.003;
  const zSB = -D / 2 + clamp(D * 0.2, 0.1, 0.18);
  const yTop = H - 0.03;
  const zTop = -D / 2 + tr + 0.002;
  const rubber = m.rubber('#151515');
  // encosto estofado inclinado acompanhando os montantes
  const ang = Math.atan2(zSB - zTop, yTop - ys);
  const bT = clamp(D * 0.15, 0.08, 0.12);
  const y0 = ys + tr + cushT - 0.01;
  const bh = (H - 0.004 - y0) / Math.cos(ang) - bT * Math.sin(ang) * 0.5;
  const back = soft(c, W - 2 * (tr + 0.012), bh, bT, fab, { puff: 0.14, r: 0.03, side: 0.3 });
  back.rotation.x = -ang;
  const t = 0.5;
  back.position.set(0, lerp(y0, H, t), lerp(zSB, zTop, (lerp(y0, H, t) - ys) / (yTop - ys)) + tr + bT / 2 * Math.cos(ang));
  snap(c, back, { maxY: H });
  g.add(back);
  // frente da almofada do encosto numa altura y (para o braço não entrar nela)
  const backFrontZ = (y) => back.position.z + (bT / 2 - (y - back.position.y) * Math.sin(ang)) / Math.cos(ang);
  // quadro do assento
  g.add(kit.tube(pcurve(c, [[0, ys, zf], [xs, ys, zf], [xs, ys, zSB], [-xs, ys, zSB], [-xs, ys, zf], [0, ys, zf]], 0.035), tr, metal, { seg: 96, radial: 10, part: 'metal' }));
  for (const sx of [-1, 1]) {
    const x = sx * xs;
    // perna da frente reta
    g.add(rod(c, [x, 0.006, zf], [x, ys, zf], tr, tr, metal, { part: 'metal' }));
    g.add(kit.place(kit.cylinder(tr * 1.05, tr * 1.05, 0.006, rubber, { seg: 12 }), { x, y: 0.003, z: zf }));
    // perna de trás + montante do encosto (tubo dobrado em "<")
    g.add(kit.tube(pcurve(c, [[x, 0.006, zFoot], [x, ys, zSB], [x, yTop, zTop]], 0.05), tr, metal, { seg: 48, radial: 10, part: 'metal' }));
    g.add(kit.place(kit.cylinder(tr * 1.05, tr * 1.05, 0.006, rubber, { seg: 12 }), { x, y: 0.003, z: zFoot }));
    // travessa lateral baixa
    const yr = ys - 0.075;
    const zr = lerp(zFoot, zSB, (yr - 0.006) / (ys - 0.006));
    g.add(rod(c, [x, yr, zf], [x, yr, zr], tr * 0.9, tr * 0.9, metal, { part: 'metal' }));
    // apoio de braço: haste vertical + régua de madeira
    const zPost = lerp(zSB, zf, 0.55);
    const padT = 0.022;
    g.add(rod(c, [x, ys, zPost], [x, armTop - padT, zPost], tr * 0.9, tr * 0.9, metal, { part: 'metal' }));
    const tU = (armTop - padT / 2 - ys) / (yTop - ys);
    const zU = lerp(zSB, zTop, tU);
    const z1 = zPost + 0.09;
    const z0 = Math.min(z1 - 0.12, Math.max(zU + 0.01, backFrontZ(armTop) + 0.006));
    const armWood = m.wood(kit.shade(c.woodHex, -0.32), { grain: 'smooth' });
    g.add(kit.place(kit.box(0.056, padT, z1 - z0, armWood, { r: 0.009, grain: 'z' }), { x: sx * (W / 2 - 0.028), y: armTop - padT / 2, z: (z0 + z1) / 2 }));
    // braçadeira metálica do montante até a ponta de trás do apoio (passa ao lado da almofada)
    if (z0 > zU + 0.02) {
      const yb = armTop - padT - tr * 0.8;
      g.add(rod(c, [x, yb, lerp(zSB, zTop, (yb - ys) / (yTop - ys))], [x, yb, z0 + 0.03], tr * 0.8, tr * 0.8, metal, { part: 'metal' }));
    }
  }
  // travessa superior do encosto
  g.add(rod(c, [-xs, yTop - 0.02, zTop + 0.004], [xs, yTop - 0.02, zTop + 0.004], tr * 0.9, tr * 0.9, metal, { part: 'metal' }));
  // assento
  const sw = W - 2 * (2 * tr + 0.006);
  const sd = zf + tr - zSB + 0.005;
  g.add(kit.place(soft(c, sw, cushT, sd, fab, { puff: 0.05, r: 0.022, side: 0.3 }), { y: ys + tr + cushT / 2 - 0.002, z: zf + tr - sd / 2 }));
  void C;
  return g;
}

// Poltrona baseada nos trechos de sofá (club, chesterfield, reclinável)
function runArmchair(c, style) {
  const { kit, W, H, D, st } = c;
  if (style === 'chesterfield') return chesterfield(c, 1);
  const p = runParams(c, style, W, D, H);
  const arms = st.arms !== false;
  p.armW = arms ? clamp(W * (style === 'recliner' ? 0.2 : style === 'confort' ? 0.22 : 0.15), 0.09, style === 'recliner' ? 0.24 : 0.2) : 0;
  const g = kit.group(`armchair-${style}`);
  g.add(sofaRun(c, { ...p, L: W, Dd: D, armL: arms, armR: arms, nSeat: 1, nBack: 1, bench: true, seatButtons: false, bolsters: false }));
  return g;
}

export function armchair(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, label } = c;
  const wing = st.wing || /orelha|bergere|wingback/.test(label);
  if (st.reclinable || st.retractable) return runArmchair(c, 'recliner');
  // bergère / orelha capitonê é poltrona de orelhas com encosto capitonê, não um chesterfield
  if (wing) return loungeArmchair(c, { wing: true });
  if (st.tufted && /chesterfield/.test(label)) return runArmchair(c, 'chesterfield');
  if (st.industrial || st.legs === 'metal') return industrialArmchair(c);
  if (/balanco/.test(label)) return loungeArmchair(c, { rocker: true });
  // capitonê baixo (braços na altura do encosto) vira chesterfield; alto usa a casca com encosto capitonê
  if (st.tufted && !st.swivel && c.H <= 0.92) return runArmchair(c, 'chesterfield');
  if (st.looseCushions) return runArmchair(c, 'confort');
  return loungeArmchair(c, { swivel: !!st.swivel });
}

/* ================================================================== */
/* CADEIRA                                                             */
/* ================================================================== */
// Cadeira de jantar estofada com encosto envolvente (formato violão) sobre aro e pés de madeira
function wrapChair(c, { arms = false } = {}) {
  const { kit, THREE, fab, W, H, D } = c;
  const g = kit.group('chair-wrap');
  const seatTop = clamp(H * 0.52, 0.42, 0.5);
  const cushT = clamp(H * 0.066, 0.045, 0.07);
  const apronT = clamp(H * 0.055, 0.035, 0.055);
  const apronTop = seatTop - cushT;
  const apronBot = apronTop - apronT;
  const T = clamp(W * 0.115, 0.04, 0.062);
  const Ws = W;
  const R0 = Ws / 2 - T / 2;
  const yb = apronTop + 0.002;
  // alturas: ponta dos "braços" que abraçam o assento, cintura e topo
  const yA = seatTop + (arms ? clamp(H * 0.13, 0.1, 0.14) : clamp(H * 0.065, 0.05, 0.07));
  const yT = H;
  // silhueta "violão": cintura a ~1/3 do encosto e alargamento suave até ~80% (sem degrau de "ombro")
  const yW = arms ? seatTop + clamp(H * 0.36, 0.26, 0.36) : Math.max(yA + 0.08, seatTop + (yT - seatTop) * 0.36);
  const yM = Math.max(yW + 0.1, seatTop + (yT - seatTop) * (arms ? 0.88 : 0.82));
  // controle pela largura vista de frente (X) e pelo ângulo de abraço (phi): R = X / sin(phi), meia-largura desenrolada = R * phi
  const X0 = Ws / 2 - T / 2;
  const Xw = Ws * (arms ? 0.45 : 0.37);
  const Xt = Ws * 0.47;
  const phi0 = (Math.PI / 2) * 0.96;
  const phiW = arms ? 0.85 : 0.6;
  const phiT = 0.48;
  const Rc = Ws * 0.32;
  const tiltMax = 0.15;
  const frame = (y) => {
    let X;
    let phi;
    if (y <= yA) {
      X = X0;
      phi = phi0;
    } else if (y <= yW) {
      const t = (y - yA) / (yW - yA);
      phi = lerp(phi0, phiW, sstep(0, 1, t));
      X = lerp(X0, Xw, sstep(0.1, 1, t));
    } else {
      const t = sstep(yW, yM, y);
      phi = lerp(phiW, phiT, t);
      X = lerp(Xw, Xt, t);
    }
    const R = X / Math.sin(phi);
    let hw = R * phi;
    if (y > yT - Rc) {
      const dy = y - (yT - Rc);
      hw = hw - Rc + Math.sqrt(Math.max(0, Rc * Rc - dy * dy));
    }
    return { R, hw: Math.max(0.002, hw) };
  };
  const tiltOf = (y) => tiltMax * sstep(yA, yW + 0.12, y);
  const thOf = (y) => (T / 2) * roundProf((y - yb) / 0.006) * roundProf((yT - y) / (T / 2));
  const n = 90;
  const stations = [];
  let z = 0;
  let yPrev = yb;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = yb + (yT - yb) * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
    const tl = tiltOf(y);
    z -= Math.tan(tl) * (y - yPrev);
    yPrev = y;
    const th = Math.max(0.0001, thOf(y));
    const { R, hw } = frame(y);
    stations.push({
      o: new THREE.Vector3(0, y, z),
      a: new THREE.Vector3(1, 0, 0),
      b: new THREE.Vector3(0, Math.sin(tl), Math.cos(tl)),
      a0: -hw,
      a1: hw,
      b0: -th,
      b1: th,
      r: th,
      u: y,
      R,
    });
  }
  const back = loft(c, stations, fab, { cs: 4, segA: 28, vFrom: 'top' });
  const bb = kit.measure(back);
  const zc = -D / 2 - bb.min.z; // posição da linha de centro da casca na base
  back.position.z = zc;
  g.add(back);
  // assento estofado (cantos de trás acompanham a curva da casca)
  const bev = Math.min(0.022, cushT * 0.4);
  const sw = Ws / 2 - 0.005 - bev;
  const zbk = zc + T / 2 - 0.004 + bev;
  const zfr = D / 2 - 0.016 - bev;
  const rbk = Math.max(0.03, R0 - T / 2 - bev);
  const seat = planSlab(c, [[-sw, zfr], [sw, zfr], [sw, zbk], [-sw, zbk]], [0.05, 0.05, rbk, rbk], cushT, fab, { bevel: bev });
  seat.position.y = apronTop + cushT / 2;
  g.add(seat);
  // aro de madeira sob o assento, contornando a casca por fora
  const ab = 0.003;
  const aw = Ws / 2 - ab;
  const azb = zc - T / 2 + ab;
  const azf = D / 2 - ab;
  const apron = planSlab(c, [[-aw, azf], [aw, azf], [aw, azb], [-aw, azb]], [0.045, 0.045, aw * 0.98, aw * 0.98], apronT, c.wood, { bevel: ab, part: 'wood' });
  apron.position.y = apronBot + apronT / 2;
  g.add(apron);
  // pés de madeira maciça afunilados (os de trás abrem para trás)
  const ltop = 0.021;
  const lfoot = 0.014;
  for (const sx of [-1, 1]) {
    g.add(legRod(c, [sx * (Ws / 2 - 0.032), apronBot + 0.012, D / 2 - 0.034], [sx * (Ws / 2 - 0.026), 0, D / 2 - 0.022], ltop, lfoot, c.wood, { square: true }));
    const bx = R0 * 0.66;
    g.add(legRod(c, [sx * bx, apronBot + 0.012, zc + R0 * 0.34], [sx * (bx + 0.014), 0, -D / 2 + 0.018], ltop, lfoot, c.wood, { square: true }));
  }
  return g;
}

// Cadeira de madeira: pés quadrados, assento de tábua (ou palhinha), encosto com ripas
function woodChair(c, { metal = false } = {}) {
  const { kit, m, W, H, D, st, C } = c;
  const g = kit.group('chair-wood');
  const metalFrame = metal;
  const frame = metalFrame ? c.dark : c.material === 'mdf' || c.material === 'lacquer' ? m.paint(C.main, { gloss: 0.3 }) : frameMat(c);
  const seatMat = st.cane ? m.cane(C.accent && C.accent !== '#e8e2d6' ? C.accent : '#d9b98a') : metalFrame ? c.wood : frame;
  const lt = metalFrame ? clamp(W * 0.045, 0.016, 0.022) : clamp(W * 0.07, 0.028, 0.04);
  const seatTop = clamp(H * 0.5, 0.42, 0.48);
  const seatT = 0.024;
  const zF = D / 2 - lt / 2;
  const zBf = -D / 2 + lt / 2;
  const zBs = zBf + clamp(D * 0.08, 0.02, 0.05);
  const xs = W / 2 - lt / 2;
  const sq = !metalFrame;
  const apronH = 0.06;
  // pés da frente
  for (const sx of [-1, 1]) {
    g.add(legRod(c, [sx * xs, seatTop - seatT, zF], [sx * xs, 0, zF], lt / 2, lt / 2 * 0.85, frame, { square: sq }));
    // pé de trás que vira montante do encosto (inclinado para trás em cima)
    g.add(legRod(c, [sx * xs, seatTop - seatT, zBs], [sx * xs, 0, zBf], lt / 2, lt / 2 * 0.85, frame, { square: sq }));
    g.add(rod(c, [sx * xs, seatTop - seatT - 0.01, zBs], [sx * xs, H - 0.004, zBf + 0.004], lt / 2, lt / 2 * 0.9, frame, { square: sq }));
    // travessa lateral baixa
    g.add(rod(c, [sx * xs, 0.16, zF], [sx * xs, 0.16, lerp(zBf, zBs, 0.16 / (seatTop - seatT))], lt * 0.3, lt * 0.3, frame, { square: sq }));
  }
  const zAt = (y) => lerp(zBs, zBf + 0.004, (y - (seatTop - seatT)) / (H - (seatTop - seatT)));
  // saia sob o assento
  g.add(kit.place(kit.box(W - lt * 1.2, apronH, 0.018, frame, { r: 0.002 }), { y: seatTop - seatT - apronH / 2, z: zF - 0.004 }));
  for (const sx of [-1, 1]) g.add(kit.place(kit.box(0.018, apronH, zF - zBs - lt, frame, { r: 0.002, grain: 'z' }), { x: sx * (xs - 0.004), y: seatTop - seatT - apronH / 2, z: (zF + zBs) / 2 }));
  // assento
  if (st.cane) {
    g.add(kit.place(kit.box(W, seatT, zF - zBs + lt, frame, { r: 0.004 }), { y: seatTop - seatT / 2 - 0.004, z: (zF + zBs) / 2 }));
    g.add(kit.place(kit.box(W - 0.08, 0.006, zF - zBs - 0.06, seatMat), { y: seatTop - 0.001, z: (zF + zBs) / 2 }));
  } else {
    g.add(kit.place(kit.box(W, seatT, zF - zBs + lt, seatMat, { r: 0.005, grain: 'x' }), { y: seatTop - seatT / 2, z: (zF + zBs) / 2 + 0.002 }));
    if (/estofad/.test(c.label)) g.add(kit.place(soft(c, W - 0.03, 0.045, zF - zBs - 0.02, c.fab, { puff: 0.1, r: 0.015 }), { y: seatTop + 0.02, z: (zF + zBs) / 2 + 0.005 }));
  }
  // encosto: régua superior + ripas (ou tela de palhinha)
  const ang = Math.atan2(zBs - zBf, H - seatTop);
  const yTopRail = H - 0.05;
  const yLow = seatTop + clamp((H - seatTop) * 0.28, 0.1, 0.16);
  const rail = (y, hh) => {
    const b = kit.box(W - lt * 1.4, hh, 0.02, frame, { r: 0.004 });
    b.rotation.x = -ang;
    b.position.set(0, y, zAt(y) + 0.002);
    return b;
  };
  g.add(rail(yTopRail, 0.075));
  g.add(rail(yLow, 0.035));
  const span = yTopRail - 0.0375 - (yLow + 0.0175);
  const yMid = (yTopRail - 0.0375 + yLow + 0.0175) / 2;
  if (st.cane) {
    const p = kit.box(W - lt * 2 - 0.02, span, 0.006, m.cane('#d9b98a', { see: true }));
    p.rotation.x = -ang;
    p.position.set(0, yMid, zAt(yMid) + 0.002);
    g.add(p);
  } else {
    const ns = W > 0.5 ? 4 : 3;
    for (let i = 0; i < ns; i++) {
      const x = lerp(-(W - lt * 2) / 2, (W - lt * 2) / 2, (i + 1) / (ns + 1));
      const s = kit.box(metalFrame ? 0.012 : 0.032, span + 0.01, 0.014, frame, { r: 0.003, grain: 'y' });
      s.rotation.x = -ang;
      s.position.set(x, yMid, zAt(yMid) + 0.002);
      g.add(s);
    }
  }
  return g;
}

// Cadeira de escritório / gamer: base estrela com rodízios, coluna a gás, assento, encosto e braços
function officeChair(c) {
  const { kit, THREE, m, fab, W, H, D, C, label } = c;
  const g = kit.group('chair-office');
  const gamer = /gamer/.test(label);
  const black = m.plastic('#1c1c1c', { gloss: 0.35 });
  const chrome = m.metal('#cfd2d4', { finish: 'chrome' });
  const Rb = Math.min(W, D) / 2 - 0.025;
  const baseY = 0.075;
  // estrela de 5 pontas + rodízios
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * Rb;
    const z = Math.sin(a) * Rb;
    const arm = kit.box(Rb, 0.03, 0.045, black, { r: 0.008 });
    arm.rotation.y = -a;
    arm.position.set(x / 2, baseY, z / 2);
    g.add(arm);
    const wheel = kit.cylinder(0.024, 0.024, 0.022, black, { seg: 16 });
    wheel.rotation.z = Math.PI / 2;
    wheel.rotation.y = -a;
    wheel.position.set(x, 0.024, z);
    g.add(wheel);
    g.add(rod(c, [x, 0.04, z], [x, baseY, z], 0.006, 0.006, chrome, { part: 'metal' }));
  }
  g.add(kit.place(kit.cylinder(0.05, 0.06, 0.05, black, { seg: 24 }), { y: baseY }));
  const seatTop = clamp(H * 0.44, 0.42, 0.52);
  const seatT = 0.085;
  const seatY = seatTop - seatT;
  g.add(kit.place(kit.cylinder(0.026, 0.026, seatY - baseY, chrome, { seg: 18, part: 'metal' }), { y: (seatY + baseY) / 2 }));
  g.add(kit.place(kit.cylinder(0.034, 0.034, 0.13, black, { seg: 18 }), { y: baseY + 0.09 }));
  g.add(kit.place(kit.box(0.2, 0.03, 0.2, black, { r: 0.008 }), { y: seatY - 0.012 }));
  // assento
  const sw = Math.min(W - 0.12, 0.52);
  const sd = Math.min(D * 0.78, 0.5);
  g.add(kit.place(soft(c, sw, seatT, sd, fab, { puff: 0.14, r: 0.03 }), { y: seatY + seatT / 2, z: 0.02 }));
  // encosto curvo
  const y0 = seatTop + 0.04;
  const backTh = 0.065;
  const tilt = 0.13;
  const hwB = (gamer ? 0.26 : 0.24) * Math.min(1, sw / 0.5);
  const stations = [];
  const n = 48;
  const z0 = -sd / 2 + 0.02;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (H - y0) * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
    const u = (y - y0) / (H - y0);
    let w = gamer ? hwB * (0.92 + 0.14 * sstep(0.45, 0.62, u) - 0.22 * sstep(0.7, 0.8, u) + 0.06 * sstep(0.82, 0.95, u)) : hwB * (0.9 + 0.1 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
    const Rc = 0.06;
    if (y > H - Rc) w = w - Rc + Math.sqrt(Math.max(0, Rc * Rc - (y - (H - Rc)) ** 2));
    const th = (backTh / 2) * roundProf((y - y0) / 0.02) * roundProf((H - y) / (backTh / 2));
    stations.push({ o: new THREE.Vector3(0, y, z0 - Math.tan(tilt) * (y - y0)), a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)), a0: -Math.max(0.003, w), a1: Math.max(0.003, w), b0: -Math.max(0.0001, th), b1: Math.max(0.0001, th), r: Math.max(0.0001, th), u: y, R: gamer ? 0.45 : 0.6 });
  }
  const back = loft(c, stations, fab, { cs: 4, segA: 14, vFrom: 'top' });
  const bb = kit.measure(back);
  back.position.z += -D / 2 - bb.min.z;
  g.add(back);
  // haste que liga o encosto ao assento
  const zb = z0 + back.position.z;
  g.add(rod(c, [0, seatY, -0.02], [0, seatY, zb - 0.01], 0.012, 0.012, black));
  g.add(rod(c, [0, seatY, zb - 0.01], [0, y0 + 0.12, zb - 0.012 - Math.tan(tilt) * 0.12], 0.012, 0.012, black));
  // listras de cor (gamer)
  if (gamer && C.accent) {
    const acc = m.fabric(C.accent, { kind: 'leather' });
    for (const sx of [-1, 1]) {
      const s = kit.box(0.04, (H - y0) * 0.55, 0.012, acc, { r: 0.005 });
      s.rotation.x = -tilt;
      const yy = y0 + (H - y0) * 0.42;
      const xx = hwB * 0.62;
      const Rg = 0.45;
      s.position.set(sx * xx, yy, zb - Math.tan(tilt) * (yy - y0) + backTh / 2 + 0.009 + (Rg - Math.sqrt(Rg * Rg - xx * xx)));
      s.rotation.y = -sx * Math.asin(xx / Rg);
      g.add(s);
    }
  }
  // braços em "T"
  if (!/sem braco/.test(label)) {
    for (const sx of [-1, 1]) {
      const x = sx * (sw / 2 + 0.025);
      g.add(rod(c, [x, seatY + 0.01, -0.02], [x, seatTop + 0.17, -0.02], 0.012, 0.012, black));
      g.add(kit.place(soft(c, 0.07, 0.03, 0.24, black, { puff: 0.1, r: 0.012 }), { x, y: seatTop + 0.185, z: 0 }));
    }
  }
  return g;
}

// Cadeira de concha (estilo Eames): concha moldada sobre pés palito com travas de arame
function shellChair(c) {
  const { kit, THREE, m, W, H, D, C } = c;
  const g = kit.group('chair-shell');
  const plastic = c.material === 'plastic' || /plastic|polipropileno|eames|charles/.test(c.label) || !/estofad/.test(c.label);
  const shellMat = plastic ? m.plastic(C.main, { gloss: 0.35 }) : c.fab;
  const seatTop = clamp(H * 0.52, 0.42, 0.47);
  const th = 0.008;
  // perfil lateral (z, y): lábio da frente -> fundo do assento -> curva -> topo do encosto
  const prof = [
    [D / 2 - 0.004, seatTop - 0.022],
    [D / 2 - 0.045, seatTop],
    [-D / 2 + D * 0.42, seatTop - 0.02],
    [-D / 2 + D * 0.2, seatTop - 0.022],
    [-D / 2 + 0.06, seatTop + 0.04],
    [-D / 2 + 0.03, seatTop + 0.16],
    [-D / 2 + 0.004, H - 0.004],
  ];
  // constrói a concha com fator de largura kw e escala de profundidade kz (ajustados até bater W x D)
  const build = (kw, kz) => {
    const curve = new THREE.CatmullRomCurve3(prof.map(([z, y]) => new THREE.Vector3(0, y, z * kz)), false, 'centripetal');
    const len = curve.getLength();
    const n = 70;
    const st = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const a = new THREE.Vector3(1, 0, 0);
      const b = a.clone().cross(tan).normalize(); // lado de dentro (em cima / na frente)
      const sArc = u * len;
      let w = (W / 2) * kw * (u < 0.5 ? lerp(1, 0.84, sstep(0.25, 0.5, u)) : lerp(0.84, 1, sstep(0.5, 0.92, u)));
      const Rc = 0.07;
      const dEnd = Math.min(sArc, len - sArc);
      if (dEnd < Rc) w = w - Rc + Math.sqrt(Math.max(0, Rc * Rc - (Rc - dEnd) * (Rc - dEnd)));
      const tt = th * roundProf(dEnd / th);
      const R = u < 0.3 ? lerp(0.7, 0.4, sstep(0.05, 0.3, u)) : lerp(0.4, 0.45, sstep(0.5, 1, u));
      st.push({ o: p, a, b, a0: -Math.max(0.003, w), a1: Math.max(0.003, w), b0: -Math.max(0.0001, tt), b1: Math.max(0.0001, tt), r: Math.max(0.0001, tt), u: sArc, R });
    }
    return loft(c, st, shellMat, { cs: 3, segA: 16, vFrom: 'top' });
  };
  let kw = 1;
  let kz = 1;
  let sh = null;
  for (let it = 0; it < 3; it++) {
    sh = build(kw, kz);
    const bb = kit.measure(sh);
    const ew = W / (bb.max.x - bb.min.x);
    const ed = D / (bb.max.z - bb.min.z);
    if (Math.abs(ew - 1) < 0.004 && Math.abs(ed - 1) < 0.004) break;
    kw *= ew;
    kz *= ed;
  }
  const bz = kit.measure(sh);
  sh.position.z += -(bz.min.z + bz.max.z) / 2;
  g.add(sh);
  // pés palito + travas de arame preto (base "Eiffel" simplificada)
  const mount = seatTop - 0.05;
  const wire = m.metal('#1f1f1f', { finish: 'painted' });
  const legs = [];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const tp = [sx * 0.11, mount, sz * 0.1];
      const ft = [sx * (W / 2 - 0.03), 0, sz * (D / 2 - 0.05)];
      legs.push([tp, ft]);
      g.add(legRod(c, tp, ft, 0.0155, 0.011, c.wood, { ferrule: { material: wire, len: 0.018 } }));
    }
  }
  const at = ([p, q], t) => [lerp(q[0], p[0], t), lerp(q[1], p[1], t), lerp(q[2], p[2], t)];
  const h = 0.42;
  g.add(rod(c, at(legs[0], h), at(legs[3], h), 0.0028, 0.0028, wire, { part: 'metal' }));
  g.add(rod(c, at(legs[1], h), at(legs[2], h), 0.0028, 0.0028, wire, { part: 'metal' }));
  g.add(rod(c, at(legs[0], h), at(legs[2], h), 0.0028, 0.0028, wire, { part: 'metal' }));
  g.add(rod(c, at(legs[1], h), at(legs[3], h), 0.0028, 0.0028, wire, { part: 'metal' }));
  g.add(kit.place(kit.box(0.25, 0.012, 0.23, wire, { r: 0.004 }), { y: mount + 0.004 }));
  for (const [tp] of legs) g.add(rod(c, tp, [tp[0], seatTop - 0.035, tp[2]], 0.006, 0.006, wire, { part: 'metal' }));
  return g;
}

export function chair(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, label, material } = c;
  if (st.office) return officeChair(c);
  if (/eames|charles|concha|plastic|polipropileno/.test(label) || material === 'plastic') return shellChair(c);
  // cadeira sem estofado: o material padrão das cadeiras é 'fabric', então o nome decide
  const soft = /estofad|linho|veludo|tecido|couro|suede|boucle|corino|sintetico/.test(label) || (material !== 'fabric' && c.upholstered);
  const metal = material === 'metal' || st.industrial || (/ferro|metal|aco|tolix/.test(label) && !soft);
  const woody = material === 'wood' || material === 'mdf' || /madeira|ripad|tauari|eucalipto|pinus/.test(label);
  if (st.cane || ((woody || metal) && !soft)) return woodChair(c, { metal });
  return wrapChair(c, { arms: st.arms === true });
}

/* ================================================================== */
/* BANQUETA                                                            */
/* ================================================================== */
// Assento redondo (disco com borda arredondada) ou estofado
function roundSeat(c, R, t, material, { soft = false } = {}) {
  const e = soft ? Math.min(t * 0.45, 0.03) : Math.min(t * 0.35, 0.008);
  const pts = [[0.0001, 0], [R - e, 0], [R - e * 0.3, e * 0.3], [R, e], [R, t - e], [R - e * 0.3, t - e * 0.3], [R - e, t]];
  if (soft) pts.push([R * 0.5, t + 0.006], [0.0001, t + 0.008]);
  else pts.push([0.0001, t]);
  return c.kit.lathe(pts, material, { seg: 40 });
}

function leggedStool(c, { bar }) {
  const { kit, m, fab, W, H, D, st, C, label } = c;
  const g = kit.group(bar ? 'stool-bar' : 'stool-low');
  const metal = c.material === 'metal' || st.industrial || st.legs === 'metal';
  const legMat = metal ? c.dark : c.upholstered || /estofad/.test(label) ? c.wood : frameMat(c);
  const round = st.shape !== 'square' && Math.abs(W - D) < 0.03;
  const hasBack = /encosto/.test(label);
  // encosto ~27 cm acima do assento (o infer soma isso à altura do assento citada no nome)
  const seatTop = hasBack ? H - clamp(H - 0.35, 0.15, 0.27) : H;
  const padded = c.upholstered || /estofad/.test(label);
  const seatT = padded ? 0.07 : 0.035;
  const seatMat = padded ? fab : metal ? c.wood : legMat;
  const R = Math.min(W, D) / 2;
  const legTopY = seatTop - seatT;
  // assento
  if (round) {
    const s = roundSeat(c, R, seatT, seatMat, { soft: padded });
    s.position.y = legTopY;
    g.add(s);
    if (padded) g.add(kit.place(kit.cylinder(R * 0.88, R * 0.88, 0.02, c.dark, { seg: 32 }), { y: legTopY - 0.008 }));
  } else {
    g.add(kit.place(padded ? soft(c, W, seatT, D, fab, { puff: 0.12, r: 0.02 }) : kit.box(W, seatT, D, seatMat, { r: 0.008 }), { y: legTopY + seatT / 2 }));
  }
  // pés abertos
  const rTop = metal ? 0.011 : bar ? 0.019 : 0.018;
  const rFoot = metal ? 0.011 : 0.014;
  const inTop = (round ? R * 0.55 : Math.min(W, D) / 2 - 0.05);
  const feet = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const kTop = round ? inTop : inTop * Math.SQRT2;
    const kFoot = round ? R - 0.012 : (Math.min(W, D) / 2 - 0.02) * Math.SQRT2;
    const top = [cx * kTop, legTopY + 0.006, cz * kTop];
    const foot = [cx * kFoot, 0, cz * kFoot];
    feet.push([top, foot]);
    g.add(legRod(c, top, foot, rTop, rFoot, legMat, { square: !metal && !round, part: metal ? 'metal' : 'wood' }));
    if (metal) g.add(kit.place(kit.cylinder(0.013, 0.013, 0.006, m.rubber(), { seg: 10 }), { x: foot[0], y: 0.003, z: foot[2] }));
  }
  // apoio para os pés: aro (metal) ou travessas (madeira)
  const at = (t) => feet.map(([tp, ft]) => [lerp(ft[0], tp[0], t), lerp(ft[1], tp[1], t), lerp(ft[2], tp[2], t)]);
  if (bar || H > 0.45) {
    const tR = bar ? 0.3 / Math.max(0.6, legTopY) : 0.35;
    const p = at(clamp(tR, 0.2, 0.45));
    if (metal) {
      const rr = Math.hypot(p[0][0], p[0][2]);
      g.add(kit.place(ring(c, rr, 0.008, c.dark, { part: 'metal' }), { y: p[0][1] }));
    } else {
      for (let k = 0; k < 4; k++) g.add(rod(c, p[k], p[(k + 1) % 4], 0.009, 0.009, legMat, { part: 'wood' }));
      if (bar) {
        const p2 = at(0.72);
        for (let k = 0; k < 4; k += 2) g.add(rod(c, p2[k], p2[(k + 1) % 4], 0.008, 0.008, legMat, { part: 'wood' }));
      }
    }
  }
  // encosto baixo
  if (hasBack) {
    const zb = -(round ? R : D / 2) + 0.03;
    for (const sx of [-1, 1]) g.add(rod(c, [sx * R * 0.5, seatTop - 0.01, zb + 0.02], [sx * R * 0.55, H - 0.04, zb], 0.01, 0.01, metal ? c.dark : legMat));
    const bw = R * 1.4;
    const bandMat = padded ? fab : legMat;
    g.add(kit.place(padded ? soft(c, bw, 0.1, 0.035, fab, { puff: 0.15, r: 0.012 }) : kit.box(bw, 0.08, 0.02, bandMat, { r: 0.006 }), { y: H - (padded ? 0.05 : 0.04), z: zb }));
  }
  return g;
}

// Banqueta giratória a gás: base cromada, coluna, aro de apoio e assento estofado
function swivelStool(c) {
  const { kit, m, fab, W, H, D, label } = c;
  const g = kit.group('stool-swivel');
  const chrome = m.metal('#d4d6d8', { finish: 'chrome' });
  const R = Math.min(W, D) / 2;
  const hasBack = /encosto/.test(label);
  const seatTop = hasBack ? H - clamp(H - 0.35, 0.15, 0.27) : H;
  const seatT = 0.075;
  g.add(kit.lathe([[0.0001, 0], [R * 0.9, 0], [R * 0.92, 0.006], [R * 0.5, 0.03], [0.04, 0.04], [0.0001, 0.04]], chrome, { seg: 40, part: 'metal' }));
  const col0 = 0.04;
  const col1 = seatTop - seatT - 0.03;
  g.add(kit.place(kit.cylinder(0.024, 0.024, col1 - col0, chrome, { seg: 18, part: 'metal' }), { y: (col0 + col1) / 2 }));
  g.add(kit.place(kit.cylinder(0.032, 0.032, 0.12, m.plastic('#1c1c1c', { gloss: 0.3 }), { seg: 18 }), { y: col1 - 0.06 }));
  g.add(kit.place(kit.box(0.16, 0.025, 0.16, m.plastic('#1c1c1c', { gloss: 0.3 }), { r: 0.006 }), { y: col1 + 0.012 }));
  if (seatTop > 0.55) {
    const yr = seatTop * 0.42;
    const rr = R * 0.78;
    g.add(kit.place(ring(c, rr, 0.008, chrome, { part: 'metal' }), { y: yr }));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      g.add(rod(c, [Math.cos(a) * 0.024, yr, Math.sin(a) * 0.024], [Math.cos(a) * rr, yr, Math.sin(a) * rr], 0.006, 0.006, chrome, { part: 'metal' }));
    }
  }
  const s = roundSeat(c, R, seatT, fab, { soft: true });
  s.position.y = seatTop - seatT - 0.008;
  g.add(s);
  if (hasBack) {
    const zb = -R + 0.04;
    g.add(rod(c, [0, seatTop - seatT, zb + 0.04], [0, H - 0.1, zb - 0.01], 0.012, 0.012, chrome, { part: 'metal' }));
    g.add(kit.place(soft(c, R * 1.5, 0.15, 0.05, fab, { puff: 0.15, r: 0.02 }), { y: H - 0.075, z: -R + 0.025 }));
  }
  return g;
}

// Banco comprido (madeira ou estofado)
function bench(c) {
  const { kit, m, fab, W, H, D, st, C } = c;
  const g = kit.group('bench');
  const soft = c.upholstered && c.material !== 'fabric';
  const top = soft ? fab : frameMat(c);
  const legMat = st.legs === 'metal' || c.material === 'metal' ? c.dark : m.wood(c.woodHex, { grain: 'oak' });
  const t = soft ? clamp(H * 0.25, 0.08, 0.14) : clamp(H * 0.08, 0.03, 0.05);
  if (soft) g.add(kit.place(soft(c, W, t, D, fab, { puff: 0.12, r: 0.025 }), { y: H - t / 2 }));
  else g.add(kit.place(kit.box(W, t, D, top, { r: 0.006, grain: 'x' }), { y: H - t / 2 }));
  const metal = legMat === c.dark;
  const lt = metal ? 0.012 : 0.022;
  const xs = W / 2 - 0.08;
  const zs = D / 2 - 0.05;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(legRod(c, [sx * xs, H - t + 0.004, sz * (zs - 0.02)], [sx * (xs + 0.03), 0, sz * zs], lt, lt * 0.8, legMat, { square: !metal }));
    g.add(rod(c, [sx * (xs + 0.012), 0.14, -(zs - 0.01)], [sx * (xs + 0.012), 0.14, zs - 0.01], lt * 0.5, lt * 0.5, legMat, { square: !metal }));
  }
  g.add(rod(c, [-(xs + 0.012), 0.14, 0], [xs + 0.012, 0.14, 0], lt * 0.5, lt * 0.5, legMat, { square: !metal }));
  return g;
}

export function stool(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { st, label, H } = c;
  if (st.bench) return bench(c);
  if (st.swivel || /giratori|regulave|a gas|a gás/.test(label)) return swivelStool(c);
  return leggedStool(c, { bar: H >= 0.6 || /alta|bar|balcao/.test(label) });
}

/* ---------- formas de puff ---------- */
// Reamostra um perfil [[r, y], ...] com passo máximo 'step' (para relevos ao longo da altura)
function resample(prof, step) {
  const out = [prof[0]];
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1];
    const [r1, y1] = prof[i];
    const n = Math.max(1, Math.ceil(Math.hypot(r1 - r0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([lerp(r0, r1, k / n), lerp(y0, y1, k / n)]);
  }
  return out;
}

// Normais da costura do LatheGeometry (primeira e última coluna) ficam iguais
function latheSeam(geo) {
  const N = geo.attributes.normal;
  const segs = geo.parameters?.segments;
  if (!N || !segs) return;
  const np = N.count / (segs + 1);
  for (let j = 0; j < np; j++) {
    const a = j;
    const b = segs * np + j;
    const x = N.getX(a) + N.getX(b);
    const y = N.getY(a) + N.getY(b);
    const z = N.getZ(a) + N.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l);
    N.setXYZ(b, x / l, y / l, z / l);
  }
  N.needsUpdate = true;
}

// Relevo de tricô grosso: colunas de trança na vertical + carreiras na horizontal
function knitify(c, geo, R, amp) {
  const P = geo.attributes.position;
  const cols = Math.max(10, Math.round((2 * Math.PI * R) / 0.055));
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const y = P.getY(i);
    const z = P.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const th = Math.atan2(z, x);
    const col = 0.5 + 0.5 * Math.cos(cols * th);
    // fase contínua (sem saltos): a costura do torno não abre fresta
    const row = 0.5 + 0.5 * Math.cos((2 * Math.PI * y) / 0.032 + Math.sin(cols * th) * 1.2);
    const k = (r + amp * Math.min(1, r / (R * 0.6)) * (0.55 * col + 0.45 * row * col)) / r;
    P.setX(i, x * k);
    P.setZ(i, z * k);
  }
  P.needsUpdate = true;
  geo.computeVertexNormals();
  latheSeam(geo);
}

// Tampo capitonê redondo: botão no centro + anel de botões, vincos e gomos estufados.
// Altura 0 na borda (raio Rd) e domeT no alto dos gomos.
function tuftedDisc(c, Rd, domeT, material, { relief = 0.03, btn = 0.01 } = {}) {
  const { kit, THREE } = c;
  const g = kit.group('tufted-top');
  const nRing = Rd > 0.3 ? 8 : 6;
  const rB = Rd * 0.52;
  const btns = [[0, 0]];
  const segs = [];
  for (let k = 0; k < nRing; k++) {
    const a = (k / nRing) * Math.PI * 2 + Math.PI / nRing;
    const b = [Math.cos(a) * rB, Math.sin(a) * rB];
    btns.push(b);
    segs.push([[0, 0], b], [b, [Math.cos(a) * Rd * 1.05, Math.sin(a) * Rd * 1.05]]);
  }
  const segD = (px, pz, a, b) => {
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t);
  };
  const Rp = rB * 0.6;
  const hAt = (x, z) => {
    let db = 9;
    for (const [bx, bz] of btns) db = Math.min(db, Math.hypot(x - bx, z - bz));
    let dl = 9;
    for (const [a, b] of segs) dl = Math.min(dl, segD(x, z, a, b));
    const dip = Math.max(1 - Math.pow(sstep(0, Rp, db), 0.7), (1 - sstep(0, 0.016, dl)) * 0.45);
    const edge = sstep(0, 0.04, Rd - Math.hypot(x, z));
    return edge * (domeT - relief * dip);
  };
  // grade polar
  const nr = 22;
  const ns = 72;
  const P = [0, hAt(0, 0), 0];
  for (let i = 1; i <= nr; i++) {
    const r = (Rd * i) / nr;
    for (let j = 0; j < ns; j++) {
      const a = (j / ns) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      P.push(x, i === nr ? 0 : hAt(x, z), z);
    }
  }
  const idx = [];
  const vi = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * ns + (j % ns));
  for (let j = 0; j < ns; j++) idx.push(0, vi(1, j + 1), vi(1, j));
  for (let i = 1; i < nr; i++) {
    for (let j = 0; j < ns; j++) {
      const a = vi(i, j);
      const b = vi(i, j + 1);
      const cI = vi(i + 1, j);
      const d = vi(i + 1, j + 1);
      idx.push(a, b, d, a, d, cI);
    }
  }
  const ud = material.userData || {};
  const [tu, tv] = ud.uv === 'fit' ? [1, 1] : ud.tile || [1, 1];
  const UV = [];
  for (let k = 0; k < P.length; k += 3) UV.push(P[k] / tu, P[k + 2] / tv);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  g.add(kit.mesh(geo, material, { keepUV: true }));
  for (const [bx, bz] of btns) {
    const b = button(c, material, bx === 0 && bz === 0 ? btn * 1.2 : btn);
    b.position.set(bx, hAt(bx, bz) + 0.003, bz);
    g.add(b);
  }
  return g;
}

// Puff pera (bean bag): gota de base larga com o amassado do assento na frente
function beanBag(c, g) {
  const { kit, THREE, W, H, D, fab } = c;
  const R = Math.max(W, D) / 2;
  const key = [[0.0001, 0], [0.8, 0], [0.96, 0.03], [1, 0.13], [0.97, 0.3], [0.86, 0.48], [0.7, 0.65], [0.52, 0.8], [0.34, 0.92], [0.17, 0.985], [0.0001, 1]];
  const curve = new THREE.SplineCurve(key.map(([r, y]) => new THREE.Vector2(r, y)));
  const prof = curve.getSpacedPoints(36).map((p, i, arr) => [i === 0 || i === arr.length - 1 ? 0.0001 : Math.max(0.0001, Math.min(1, p.x)) * R, clamp(p.y, 0, 1) * H]);
  prof[0][1] = 0;
  prof[prof.length - 1][1] = H;
  const body = kit.lathe(prof, fab, { seg: 64 });
  const geo = body.geometry;
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i);
    let z = P.getZ(i);
    const u = P.getY(i) / H;
    const r = Math.hypot(x, z);
    if (r > 1e-4) {
      const front = Math.max(0, z / r);
      const dent = 0.16 * R * Math.exp(-(((u - 0.6) / 0.15) ** 2)) * Math.pow(front, 1.6);
      const k = Math.max(0.2, 1 - dent / r);
      x *= k;
      z *= k;
    }
    P.setX(i, (x * W) / (2 * R));
    P.setZ(i, (z * D) / (2 * R));
  }
  P.needsUpdate = true;
  geo.computeVertexNormals();
  latheSeam(geo);
  g.add(body);
  return g;
}

/* ================================================================== */
/* PUFF                                                                */
/* ================================================================== */
export function pouf(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const { m, fab, W, H, D, st, label } = c;
  const g = kit.group('pouf');
  const legs = st.legs === 'palito' || st.legs === 'wood' || st.legs === 'metal';
  const legH = legs ? clamp(H * 0.25, 0.06, 0.14) : 0;
  const bodyH = H - legH;
  const pipe = c.material === 'boucle' ? null : fab;
  if (st.bench || W > D * 1.6) {
    // recamier / puff baú: banco estofado comprido
    const bau = /bau/.test(label);
    const lh = bau ? 0.02 : clamp(H * 0.25, 0.08, 0.14);
    const bh = H - lh;
    if (bau) g.add(kit.place(kit.box(W - 0.04, lh, D - 0.04, m.flat('#1d1a17')), { y: lh / 2 }));
    else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(legRod(c, [sx * (W / 2 - 0.06), lh + 0.01, sz * (D / 2 - 0.06)], [sx * (W / 2 - 0.045), 0, sz * (D / 2 - 0.045)], 0.018, 0.011, c.wood));
    }
    if (bau) {
      g.add(kit.place(soft(c, W, bh * 0.68, D, fab, { puff: 0.02, r: 0.015 }), { y: lh + bh * 0.34 }));
      g.add(kit.place(soft(c, W, bh * 0.34, D, fab, { puff: 0.14, r: 0.03 }), { y: H - bh * 0.17 }));
    } else {
      g.add(kit.place(soft(c, W, bh, D, fab, { puff: 0.1, r: Math.min(0.035, bh * 0.3) }), { y: lh + bh / 2 }));
      if (st.tufted) {
        const tf = tuftedFast(c, W - 0.02, D - 0.02, 0.04, fab, { rows: 2 });
        tf.rotation.x = -Math.PI / 2;
        tf.position.y = H - 0.02;
        g.add(tf);
      }
    }
    return g;
  }
  // puff pera (bean bag), puff bola e puff de tricô/crochê têm formas próprias
  if (/pera|bean ?bag|saco|gota/.test(label)) return beanBag(c, g);
  const ball = /bola|esfera/.test(label);
  const knit = /trico|tricot|croche|trancad/.test(label);
  const round = ball || st.shape === 'round' || (st.shape !== 'square' && Math.abs(W - D) < 0.03 && !/quadrad/.test(label));
  if (round) {
    const R = Math.min(W, D) / 2;
    const amp = knit ? 0.007 : 0; // relevo do tricô (o perfil encolhe para a caixa continuar exata)
    const R0 = R - amp;
    let body;
    if (ball) {
      // bola: superelipse (achata um pouco embaixo e em cima)
      const prof = [];
      for (let k = 0; k <= 28; k++) {
        const t = -Math.PI / 2 + (Math.PI * k) / 28;
        const ct = Math.cos(t);
        const sn = Math.sin(t);
        prof.push([Math.max(0.0001, R0 * Math.pow(Math.abs(ct), 2 / 2.4)), bodyH / 2 + (bodyH / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / 2.4)]);
      }
      prof[0][1] = 0;
      prof[28][1] = bodyH;
      body = kit.lathe(knit ? resample(prof, 0.007) : prof, fab, { seg: knit ? 112 : 56 });
    } else {
      const e = Math.min(bodyH * 0.22, 0.06, R0 * 0.4);
      const eb = e * 0.45; // base menos arredondada: o puff assenta no chão
      const domeT = st.tufted ? 0.014 : 0;
      const dome = st.tufted ? 0 : 0.01;
      const top = bodyH - domeT;
      const prof = [[0.0001, 0], [R0 - eb, 0], [R0 - eb * 0.3, eb * 0.28], [R0, eb], [R0, top - e - dome], [R0 - e * 0.3, top - e * 0.28 - dome], [R0 - e, top - dome]];
      if (!st.tufted) prof.push([R0 * 0.5, top - dome * 0.2], [0.0001, top]);
      body = kit.lathe(knit ? resample(prof, 0.007) : prof, fab, { seg: knit ? 112 : 48 });
      if (pipe && !knit) for (const [y, rr] of [[legH + top - e * 0.28 - dome, R0 - e * 0.3], [legH + eb * 0.28, R0 - eb * 0.3]]) g.add(kit.place(ring(c, rr, 0.004, pipe), { y }));
      if (st.tufted) g.add(kit.place(tuftedDisc(c, R0 - e, domeT, fab), { y: legH + top }));
    }
    if (knit) knitify(c, body.geometry, R0, amp);
    body.position.y = legH;
    g.add(body);
    // medidas diferentes num puff redondo (digitadas pela equipe): vira oval para bater a caixa
    if (Math.abs(W - D) > 0.005) for (const ch of g.children) ch.scale.set((ch.scale.x * W) / (2 * R), ch.scale.y, (ch.scale.z * D) / (2 * R));
  } else {
    const r = Math.min(0.04, bodyH * 0.22);
    const pf = st.tufted ? 0.04 : 0.1;
    g.add(kit.place(soft(c, W, bodyH, D, fab, { puff: pf, r, side: 0.3 }), { y: legH + bodyH / 2 }));
    const k = 1 / (1 + pf * 0.3);
    if (pipe) for (const y of [legH + bodyH / 2 + (bodyH / 2 / (1 + pf) - r * 0.3), legH + bodyH / 2 - (bodyH / 2 / (1 + pf) - r * 0.3)]) {
      const loop = pipingLoop(c, W * k - r * 0.6, D * k - r * 0.6, r * 0.8, pipe);
      loop.rotation.x = Math.PI / 2;
      loop.position.y = y;
      g.add(loop);
    }
    if (st.tufted) {
      const tf = tuftedFast(c, W - 0.03, D - 0.03, 0.03, fab, { rows: 2 });
      tf.rotation.x = -Math.PI / 2;
      tf.position.y = H - 0.015;
      g.add(tf);
    }
  }
  if (legs) {
    const ins = Math.min(W, D) * 0.28;
    const lm = st.legs === 'metal' ? c.dark : c.wood;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const kk = round ? 1 : Math.SQRT2;
      g.add(legRod(c, [cx * ins * kk, legH + 0.01, cz * ins * kk], [cx * (ins + legH * 0.15) * kk, 0, cz * (ins + legH * 0.15) * kk], 0.015, 0.01, lm));
    }
  }
  return g;
}
