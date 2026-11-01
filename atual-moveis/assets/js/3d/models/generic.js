// Gerador genérico: arquétipos simples, mas com cara de produto, para qualquer tipo.
// É usado para tipos desconhecidos, categorias novas e como rede de segurança quando um
// gerador específico falha. Sempre respeita w x h x d do spec (cm) e as convenções do kit.
//   (spec, kit, THREE) => THREE.Group

/* ---------- utilitários ---------- */
function ctx(spec, kit) {
  const st = spec.style || {};
  const C = spec.colors || {};
  const W = kit.cm(spec.w);
  const H = kit.cm(spec.h);
  const D = kit.cm(spec.d);
  const m = kit.mat;
  const body = m.surface(C.main, spec.material, { woodLook: !!st.woodLook, grain: st.rustic ? 'rustic' : undefined });
  const wood = m.wood(C.wood || '#a87a4c', { grain: st.rustic ? 'rustic' : 'oak' });
  const metal = m.metal(C.metal || '#c3c5c7', { finish: 'brushed' });
  const dark = m.metal(C.metal || '#1f1f1f', { finish: 'painted' });
  return { st, C, W, H, D, m, body, wood, metal, dark, r: kit.rng(spec.seed || spec.kind) };
}
// 4 pés nos cantos (inset a partir das bordas)
function legs4(kit, g, { W, D, h, inset = 0.04, type = 'square', r = 0.018, material, splay }) {
  const x = W / 2 - inset;
  const z = D / 2 - inset;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(kit.place(kit.leg(type, { h, r, material, dir: [sx, sz], splay }), { x: sx * x, z: sz * z }));
  }
}
const legType = (st) => (st.legs === 'palito' || st.retro ? 'palito' : st.legs === 'metal' ? 'metal_square' : st.legs === 'turned' ? 'turned' : 'tapered');

/* ---------- móveis de caixa (cômoda, criado, guarda-roupa, rack, armário) ---------- */
function cabinet(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m, body } = c;
  const g = kit.group('generic-cabinet');
  const tall = H > W * 1.25 || spec.kind === 'wardrobe';
  const plinth = st.legs === 'hidden' || spec.kind === 'kitchen_cabinet' || spec.kind === 'wardrobe' || H < 0.3 || (tall && st.legs !== 'palito');
  const legH = plinth ? Math.min(0.08, H * 0.05) : Math.min(0.2, Math.max(0.06, H * 0.16));
  const topT = Math.min(0.03, Math.max(0.016, H * 0.025));
  const hd = 0.028; // espaço para puxadores
  const frontT = 0.018;
  const bodyD = D - 0.006 - hd - frontT;
  const zBack = -D / 2 + 0.006;
  const zFront = zBack + bodyD;
  const bw = W - 0.012;
  const bodyH = H - legH - topT;
  // tampo, corpo e base
  g.add(kit.place(kit.box(W, topT, D, body, { r: 0.004 }), { y: H - topT / 2 }));
  g.add(kit.place(kit.box(bw, bodyH, bodyD, body, { r: 0.002 }), { y: legH + bodyH / 2, z: zBack + bodyD / 2 }));
  if (plinth) {
    g.add(kit.place(kit.box(bw - 0.03, legH, bodyD - 0.03, m.flat('#2a2622', { roughness: 0.8 })), { y: legH / 2, z: zBack + bodyD / 2 - 0.01 }));
  } else {
    const lt = legType(st);
    const lm = lt.startsWith('metal') ? c.dark : c.wood;
    legs4(kit, g, { W: bw, D: bodyD, h: legH, inset: 0.05, type: lt, r: 0.02, material: lm });
    g.children.slice(-4).forEach((l) => (l.position.z += zBack + bodyD / 2));
  }
  // frentes
  const fx0 = -bw / 2 + 0.016;
  const fx1 = bw / 2 - 0.016;
  const fy0 = legH + 0.016;
  const fy1 = H - topT - 0.006;
  const gap = 0.004;
  const fz = zFront + frontT / 2;
  const handleMat = st.woodLook ? c.wood : c.metal;
  const front = (x0, x1, y0, y1, kind) => {
    const fw = x1 - x0 - gap;
    const fh = y1 - y0 - gap;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (st.cane && kind === 'drawer') {
      const fr = Math.min(0.03, fh * 0.18);
      g.add(kit.place(kit.box(fw, fh, frontT * 0.6, body, { r: 0.002 }), { x: cx, y: cy, z: fz - frontT * 0.2 }));
      g.add(kit.place(kit.box(fw - 2 * fr, fh - 2 * fr, frontT * 0.5, m.cane(c.C.accent || '#d9b98a')), { x: cx, y: cy, z: fz + frontT * 0.15 }));
      for (const [w, h, x, y] of [[fw, fr, cx, cy + fh / 2 - fr / 2], [fw, fr, cx, cy - fh / 2 + fr / 2], [fr, fh, cx - fw / 2 + fr / 2, cy], [fr, fh, cx + fw / 2 - fr / 2, cy]]) {
        g.add(kit.place(kit.box(w, h, frontT, body), { x, y, z: fz }));
      }
    } else if (st.mirror && kind === 'door-mirror') {
      g.add(kit.place(kit.box(fw, fh, frontT, body, { r: 0.002 }), { x: cx, y: cy, z: fz }));
      g.add(kit.place(kit.box(fw - 0.05, fh - 0.08, 0.004, m.metal('#dfe6ea', { finish: 'chrome' }), { part: 'detail' }), { x: cx, y: cy, z: fz + frontT / 2 + 0.002 }));
    } else {
      g.add(kit.place(kit.box(fw, fh, frontT, body, { r: 0.002 }), { x: cx, y: cy, z: fz }));
    }
    const z = zFront + frontT;
    if (kind === 'drawer') {
      const n = fw > 0.7 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const hx = n === 1 ? cx : cx + (i === 0 ? -fw / 4 : fw / 4);
        g.add(kit.place(kit.handle(st.cane ? 'bar' : 'bar', { len: Math.min(0.14, fw * 0.3), material: handleMat }), { x: hx, y: cy + (fh > 0.25 ? fh * 0.3 : 0), z }));
      }
    } else if (kind !== 'open') {
      const hx = kind === 'door-left' ? x1 - gap - 0.03 : x0 + gap + 0.03;
      const hl = Math.min(0.3, fh * 0.35);
      const hdl = kit.handle('bar', { len: hl, material: handleMat });
      hdl.rotation.z = Math.PI / 2;
      g.add(kit.place(hdl, { x: hx, y: tall ? Math.min(cy, legH + 1.05) : cy + fh * 0.15, z }));
    }
  };
  const doorsRow = (y0, y1, n, mirrorMid) => {
    const w = (fx1 - fx0) / n;
    for (let i = 0; i < n; i++) {
      const kind = mirrorMid && i === Math.floor(n / 2) ? 'door-mirror' : i % 2 === 0 ? 'door-left' : 'door-right';
      front(fx0 + i * w, fx0 + (i + 1) * w, y0, y1, n === 1 ? 'door-right' : kind);
    }
  };
  const drawersCol = (x0, x1, y0, y1, n) => {
    const h = (y1 - y0) / n;
    for (let i = 0; i < n; i++) front(x0, x1, y0 + i * h, y0 + (i + 1) * h, 'drawer');
  };
  const niche = (x0, x1, y0, y1) => {
    // nicho aberto: fundo escuro recuado
    g.add(kit.place(kit.box(x1 - x0 - gap, y1 - y0 - gap, 0.004, m.flat('#1d1a17', { roughness: 0.9 })), { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: zFront - 0.25 * bodyD }));
  };

  if (tall) {
    const nd = Math.min(3, st.drawers || 0);
    const drawerH = nd ? Math.min(0.2 * nd, (fy1 - fy0) * 0.28) : 0;
    const doors = Math.max(1, Math.min(8, st.doors || (W > 0.7 ? 2 : 1)));
    if (nd) {
      const cols = W > 1.2 ? 2 : 1;
      const cw = (fx1 - fx0) / cols;
      for (let k = 0; k < cols; k++) drawersCol(fx0 + k * cw, fx0 + (k + 1) * cw, fy0, fy0 + drawerH, nd);
    }
    if (spec.kind === 'kitchen_cabinet' && H > 1.4) {
      const mid = fy0 + (fy1 - fy0) * 0.45;
      doorsRow(fy0 + drawerH, mid, doors > 3 ? Math.ceil(doors / 2) : doors, false);
      niche(fx0, fx1, mid, mid + (fy1 - fy0) * 0.18);
      doorsRow(mid + (fy1 - fy0) * 0.18, fy1, doors > 3 ? Math.floor(doors / 2) : doors, false);
    } else doorsRow(fy0 + drawerH, fy1, doors, !!st.mirror);
  } else if ((W > (fy1 - fy0) * 1.7 && !(st.drawers && (spec.kind === 'dresser' || spec.kind === 'nightstand'))) || spec.kind === 'rack') {
    // aparador / rack: portas nas pontas, nicho ou gavetas no meio
    const n = Math.max(2, Math.round(W / 0.45));
    const w = (fx1 - fx0) / n;
    for (let i = 0; i < n; i++) {
      const x0 = fx0 + i * w;
      const x1 = x0 + w;
      const middle = i > 0 && i < n - 1;
      if (middle && (st.niche || spec.kind === 'rack')) niche(x0, x1, fy0, fy1);
      else if (middle) drawersCol(x0, x1, fy0, fy1, 2);
      else front(x0, x1, fy0, fy1, i === 0 ? 'door-right' : 'door-left');
    }
  } else {
    const n = Math.max(1, Math.min(6, st.drawers || Math.round((fy1 - fy0) / 0.2)));
    drawersCol(fx0, fx1, fy0, fy1, n);
  }
  return g;
}

/* ---------- estante aberta ---------- */
function shelf(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m, body, r } = c;
  const g = kit.group('generic-shelf');
  const t = 0.018;
  const base = 0.05;
  g.add(kit.place(kit.box(t, H, D, body), { x: -W / 2 + t / 2, y: H / 2 }));
  g.add(kit.place(kit.box(t, H, D, body), { x: W / 2 - t / 2, y: H / 2 }));
  g.add(kit.place(kit.box(W - 2 * t, t, D, body), { y: H - t / 2 }));
  g.add(kit.place(kit.box(W - 2 * t, base, D - 0.02, body), { y: base / 2, z: -0.01 }));
  g.add(kit.place(kit.box(W - 2 * t, H - base - t, 0.006, m.paint(kit.shade(c.C.main, -0.12))), { y: base + (H - base - t) / 2, z: -D / 2 + 0.003 }));
  const n = typeof st.shelf === 'number' ? st.shelf : Math.max(2, Math.round(H / 0.36));
  const span = (H - base - t) / (n + 1);
  const bookCols = ['#7a2f2a', '#2f4a5c', '#c9b58f', '#3d5a40', '#e5ded2', '#8a6a4a', '#1f1f1f'];
  for (let i = 0; i <= n; i++) {
    const y = base + i * span;
    if (i > 0) g.add(kit.place(kit.box(W - 2 * t, t, D - 0.01, body), { y: y + t / 2, z: 0.005 - 0.005 }));
    // alguns livros/caixas para dar escala
    if (span > 0.16 && W > 0.3) {
      let x = -W / 2 + t + 0.02 + r() * 0.1;
      const limit = W / 2 - t - 0.04;
      while (x < limit - 0.05 && r() < 0.88) {
        const bw = 0.02 + r() * 0.025;
        const bh = Math.min(span * 0.82, 0.16 + r() * 0.1);
        const bd = Math.min(D * 0.8, 0.16 + r() * 0.06);
        g.add(kit.place(kit.box(bw, bh, bd, m.paint(r.pick(bookCols), { gloss: 0.1 }), { part: 'detail' }), { x: x + bw / 2, y: y + t + bh / 2, z: -D / 2 + 0.01 + bd / 2 }));
        x += bw + 0.002;
        if (r() < 0.12) x += 0.1 + r() * 0.15;
      }
    }
  }
  return g;
}

/* ---------- mesas ---------- */
function table(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m, body } = c;
  const g = kit.group('generic-table');
  const tt = Math.min(0.045, Math.max(0.022, H * 0.05));
  const topMat = st.glass || spec.material === 'glass' ? m.glass() : st.marble || spec.material === 'marble' ? m.marble(c.C.accent) : body;
  const legMat = st.legs === 'metal' || spec.material === 'metal' || st.industrial ? c.dark : c.wood;
  const round = st.shape === 'round' || st.shape === 'oval';
  if (round) {
    if (Math.abs(W - D) < 0.01) g.add(kit.place(kit.cylinder(W / 2, W / 2, tt, topMat, { seg: 48 }), { y: H - tt / 2 }));
    else {
      const s = new kit.THREE.Shape();
      s.absellipse(0, 0, W / 2, D / 2, 0, Math.PI * 2);
      g.add(kit.place(kit.extrude(s, tt, topMat, { bevel: 0.003, curveSegments: 48 }), { y: H - tt / 2, rx: -Math.PI / 2 }));
    }
    const colR = Math.min(0.06, Math.min(W, D) * 0.08);
    const baseR = Math.min(W, D) * 0.28;
    g.add(kit.place(kit.cylinder(colR, colR * 1.2, H - tt - 0.03, legMat), { y: 0.03 + (H - tt - 0.03) / 2 }));
    g.add(kit.place(kit.cylinder(baseR * 0.92, baseR, 0.03, legMat, { seg: 40 }), { y: 0.015 }));
    return g;
  }
  g.add(kit.place(kit.box(W, tt, D, topMat, { r: 0.006 }), { y: H - tt / 2 }));
  const legH = H - tt;
  const inset = Math.min(0.06, Math.min(W, D) * 0.12);
  const lt = legMat === c.dark ? 'metal_square' : st.legs === 'palito' || st.retro ? 'palito' : 'tapered';
  legs4(kit, g, { W, D, h: legH, inset, type: lt, r: Math.min(0.025, Math.max(0.014, H * 0.03)), material: legMat });
  // saia / estrutura sob o tampo
  if (H > 0.5 && !st.glass) {
    const sk = 0.06;
    g.add(kit.place(kit.box(W - 2 * inset - 0.02, sk, 0.018, body), { y: H - tt - sk / 2, z: D / 2 - inset }));
    g.add(kit.place(kit.box(W - 2 * inset - 0.02, sk, 0.018, body), { y: H - tt - sk / 2, z: -D / 2 + inset }));
  }
  if (st.shelf) g.add(kit.place(kit.box(W - 2 * inset - 0.01, 0.018, D - 2 * inset - 0.01, body, { r: 0.002 }), { y: Math.max(0.06, H * 0.22) }));
  if (st.niche && H > 0.35) {
    const nh = Math.min(0.2, H * 0.35);
    const nw = W - 2 * inset - 0.04;
    const nd = D - 2 * inset - 0.04;
    const y0 = H - tt - nh;
    g.add(kit.place(kit.box(nw, 0.015, nd, body), { y: y0 }));
    g.add(kit.place(kit.box(0.015, nh, nd, body), { x: -nw / 2, y: y0 + nh / 2 }));
    g.add(kit.place(kit.box(0.015, nh, nd, body), { x: nw / 2, y: y0 + nh / 2 }));
    g.add(kit.place(kit.box(nw, nh, 0.01, body), { y: y0 + nh / 2, z: -nd / 2 }));
  }
  if (spec.kind === 'desk' && W > 0.8) {
    const dw = Math.min(0.42, W * 0.32);
    const dh = Math.min(0.5, (H - tt) * 0.62);
    const x = W / 2 - inset - dw / 2 - 0.02;
    g.add(kit.place(kit.box(dw, dh, D - 2 * inset, body, { r: 0.002 }), { x, y: H - tt - dh / 2 }));
    const n = Math.max(1, Math.min(3, st.drawers || 2));
    for (let i = 0; i < n; i++) {
      const fh = dh / n;
      const y = H - tt - fh * (i + 0.5);
      g.add(kit.place(kit.box(dw - 0.006, fh - 0.004, 0.014, body, { r: 0.002 }), { x, y, z: D / 2 - inset + 0.007 }));
      g.add(kit.place(kit.handle('bar', { len: Math.min(0.12, dw * 0.4), material: c.metal }), { x, y, z: D / 2 - inset + 0.014 }));
    }
  }
  return g;
}

/* ---------- assentos ---------- */
function chair(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  const g = kit.group('generic-chair');
  const fab = m.upholstery(c.C.main, spec.material);
  const legMat = st.legs === 'metal' || st.office ? c.dark : c.wood;
  if (spec.kind === 'stool') {
    const seatT = Math.min(0.08, H * 0.12);
    const round = !st.bench && Math.abs(W - D) < 0.05;
    if (round) g.add(kit.place(kit.cushion(W, seatT, D, fab, { puff: 0.15, r: Math.min(W, D) * 0.45 }), { y: H - seatT / 2 }));
    else g.add(kit.place(kit.cushion(W, seatT, D, fab, { puff: 0.1, r: 0.02 }), { y: H - seatT / 2 }));
    const lh = H - seatT;
    legs4(kit, g, { W, D, h: lh, inset: Math.min(0.06, W * 0.15), type: legMat === c.dark ? 'metal_square' : 'palito', r: 0.016, material: legMat, splay: 0.06 });
    if (lh > 0.5) {
      const ring = Math.min(W, D) / 2 - 0.05;
      const tr = kit.tube([[-ring, 0, -ring], [ring, 0, -ring], [ring, 0, ring], [-ring, 0, ring]], 0.008, legMat, { closed: true });
      g.add(kit.place(tr, { y: lh * 0.32 }));
    }
    return g;
  }
  if (st.office) {
    const baseH = Math.min(0.1, H * 0.09);
    const seatY = Math.min(0.5, H * 0.45);
    const R = Math.min(W, D) / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = kit.box(R - 0.03, 0.03, 0.04, c.dark);
      arm.position.set(Math.cos(a) * (R - 0.03) / 2, baseH - 0.015, Math.sin(a) * (R - 0.03) / 2);
      arm.rotation.y = -a;
      g.add(arm);
      g.add(kit.place(kit.sphere(0.025, m.rubber(), { seg: 12 }), { x: Math.cos(a) * (R - 0.03), y: 0.025, z: Math.sin(a) * (R - 0.03) }));
    }
    g.add(kit.place(kit.cylinder(0.025, 0.03, seatY - baseH - 0.06, c.metal), { y: baseH + (seatY - baseH - 0.06) / 2 }));
    g.add(kit.place(kit.cushion(W * 0.86, 0.09, D * 0.82, fab, { puff: 0.15 }), { y: seatY - 0.045, z: 0.02 }));
    g.add(kit.place(kit.cushion(W * 0.8, H - seatY - 0.08, 0.08, fab, { puff: 0.1 }), { y: seatY + 0.04 + (H - seatY - 0.08) / 2 + 0.04 - 0.04, z: -D / 2 + 0.06, rx: -0.08 }));
    return g;
  }
  // cadeira de jantar
  const seatY = Math.min(0.47, H * 0.5);
  const seatT = 0.07;
  const lh = seatY - seatT;
  legs4(kit, g, { W, D, h: lh, inset: 0.035, type: legMat === c.dark ? 'metal_square' : 'tapered', r: 0.018, material: legMat });
  g.add(kit.place(kit.cushion(W, seatT, D - 0.02, fab, { puff: 0.12, r: 0.02 }), { y: seatY - seatT / 2, z: 0.01 }));
  const backH = H - seatY;
  const back = kit.cushion(W - 0.02, backH, 0.06, fab, { puff: 0.1, r: 0.02 });
  g.add(kit.place(back, { y: seatY + backH / 2, z: -D / 2 + 0.03 }));
  return g;
}

function sofa(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  const g = kit.group('generic-sofa');
  const fab = m.upholstery(c.C.main, spec.material);
  const hidden = st.legs === 'hidden' || st.legs === 'wood_base';
  const legH = hidden ? 0.03 : st.legs === 'palito' || st.retro ? Math.min(0.17, H * 0.2) : Math.min(0.12, H * 0.14);
  const seatTop = Math.min(0.46, Math.max(0.3, H * 0.52));
  const arms = st.arms !== false;
  const armW = arms ? Math.min(0.2, Math.max(0.1, W * 0.09)) : 0;
  const armH = Math.min(H - 0.02, seatTop + Math.min(0.22, (H - seatTop) * 0.55));
  const backT = Math.min(0.22, D * 0.22);
  const cushT = Math.min(0.15, (seatTop - legH) * 0.45);
  const baseH = seatTop - legH - cushT;
  const innerW = W - 2 * armW;
  // base / pés
  if (hidden) {
    const bm = st.legs === 'wood_base' ? c.wood : m.flat('#1f1c19', { roughness: 0.8 });
    g.add(kit.place(kit.box(W - 0.04, legH, D - 0.04, bm, { r: 0.004 }), { y: legH / 2 }));
  } else {
    const lt = st.legs === 'metal' ? 'metal_square' : 'palito';
    legs4(kit, g, { W, D, h: legH, inset: 0.06, type: lt, r: 0.02, material: lt === 'palito' ? c.wood : c.dark, splay: lt === 'palito' ? 0.12 : 0 });
  }
  g.add(kit.place(kit.cushion(W, baseH, D, fab, { puff: 0.03, r: 0.02 }), { y: legH + baseH / 2 }));
  // encosto
  const backH = H - legH - baseH;
  if (st.tufted) g.add(kit.place(kit.tufted(innerW + 0.001, backH, backT, fab, { rows: 2 }), { y: legH + baseH + backH / 2, z: -D / 2 + backT / 2 }));
  else g.add(kit.place(kit.cushion(W - 2 * armW * 0.5, backH, backT, fab, { puff: 0.06, r: 0.04 }), { y: legH + baseH + backH / 2, z: -D / 2 + backT / 2 }));
  // braços
  if (arms) {
    for (const sx of [-1, 1]) {
      // capitonê: painel com a frente virada para fora (largura = profundidade do sofá)
      const a = st.tufted ? kit.tufted(D, armH - legH, armW, fab, { rows: 2 }) : kit.cushion(armW, armH - legH, D, fab, { puff: 0.06, r: Math.min(0.06, armW * 0.4) });
      if (st.tufted) a.rotation.y = (sx * Math.PI) / 2;
      g.add(kit.place(a, { x: sx * (W / 2 - armW / 2), y: legH + (armH - legH) / 2 }));
    }
  }
  // almofadas do assento e do encosto
  const seats = Math.max(1, spec.kind === 'armchair' ? 1 : Math.min(6, st.seats || Math.round(innerW / 0.6)));
  const sw = innerW / seats;
  const seatD = D - backT - 0.01;
  for (let i = 0; i < seats; i++) {
    const x = -innerW / 2 + sw * (i + 0.5);
    g.add(kit.place(kit.cushion(sw - 0.006, cushT, seatD, fab, { puff: 0.16 }), { x, y: legH + baseH + cushT / 2, z: D / 2 - seatD / 2 }));
    if (st.looseCushions || !st.tufted) {
      const bh = Math.min(backH - cushT - 0.02, 0.42);
      const bt = Math.min(0.16, seatD * 0.3);
      if (bh > 0.12) g.add(kit.place(kit.cushion(sw - 0.01, bh, bt, fab, { puff: 0.2 }), { x, y: legH + baseH + cushT + bh / 2, z: -D / 2 + backT + bt / 2 - 0.02, rx: -0.12 }));
    }
  }
  return g;
}

function pouf(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  const g = kit.group('generic-pouf');
  const fab = m.upholstery(c.C.main, spec.material);
  if (st.bench) {
    const lh = Math.min(0.12, H * 0.3);
    legs4(kit, g, { W, D, h: lh, inset: 0.05, type: 'palito', r: 0.018, material: c.wood, splay: 0.1 });
    g.add(kit.place(kit.cushion(W, H - lh, D, fab, { puff: 0.12, r: 0.03 }), { y: lh + (H - lh) / 2 }));
    return g;
  }
  if (Math.abs(W - D) < 0.02) {
    const R = W / 2;
    const s = 0.06 * Math.min(1, H / 0.4);
    const prof = [[0.0001, 0], [R - s, 0], [R - s * 0.25, s * 0.35], [R, s], [R, H - s], [R - s * 0.25, H - s * 0.35], [R - s, H], [0.0001, H]];
    g.add(kit.lathe(prof, fab, { seg: 40 }));
    return g;
  }
  g.add(kit.place(kit.cushion(W, H, D, fab, { puff: 0.12, r: Math.min(W, D, H) * 0.3 }), { y: H / 2 }));
  return g;
}

/* ---------- camas e colchões ---------- */
function mattressBlock(kit, W, H, D, colors, st) {
  const g = kit.group('mattress');
  const top = Math.min(H * (st.pillowTop ? 0.3 : 0.18), st.pillowTop ? 0.09 : 0.05);
  const border = kit.mat.mattress(colors.accent || '#d8d4cc', { kind: 'border' });
  const quilt = kit.mat.mattress(colors.main || '#f4f3ef', { kind: 'quilted' });
  g.add(kit.place(kit.cushion(W, H - top + 0.01, D, border, { puff: 0.02, r: 0.025, side: 0.6 }), { y: (H - top + 0.01) / 2 }));
  const ins = st.pillowTop ? 0.012 : 0;
  g.add(kit.place(kit.cushion(W - ins * 2, top, D - ins * 2, quilt, { puff: 0.18, r: Math.min(0.03, top * 0.45) }), { y: H - top / 2 }));
  return g;
}
function mattress(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D } = c;
  if (st.pillow) {
    const g = kit.group('generic-pillow');
    g.add(kit.place(kit.cushion(W, H, D, kit.mat.fabric(c.C.main, { kind: 'cotton' }), { puff: 0.4, r: H * 0.45 }), { y: H / 2 }));
    return g;
  }
  const g = kit.group('generic-mattress');
  g.add(mattressBlock(kit, W, H, D, c.C, st));
  return g;
}
function bed(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m, body } = c;
  const g = kit.group('generic-bed');
  const frameMat = st.headboard === 'upholstered' || st.box ? m.upholstery(c.C.main, ['velvet', 'linen', 'leather', 'boucle', 'suede', 'cotton'].includes(spec.material) ? spec.material : 'linen') : body;
  const bedding = c.C.accent || '#f3f1ec';
  if (spec.kind === 'bunk_bed' || spec.kind === 'crib') return bunkOrCrib(spec, kit, c);
  const head = st.headboard || 'panel';
  const headT = head === 'none' ? 0 : Math.min(0.08, D * 0.04);
  const legH = st.legs === 'hidden' || st.box ? 0.03 : 0.12;
  const railH = st.box ? Math.min(0.32, H * 0.5) : Math.min(0.2, H * 0.25);
  const matH = Math.min(0.26, Math.max(0.12, (head === 'none' ? H : H * 0.55) - legH - railH));
  const frameD = D - headT;
  const zc = -D / 2 + headT + frameD / 2;
  if (st.box) g.add(kit.place(kit.box(W - 0.06, legH, frameD - 0.06, m.flat('#1f1c19')), { y: legH / 2, z: zc }));
  else legs4(kit, g, { W, D: frameD, h: legH, inset: 0.05, type: st.legs === 'palito' ? 'palito' : 'square', r: 0.025, material: c.wood });
  if (!st.box) g.children.slice(-4).forEach((l) => (l.position.z += zc));
  g.add(kit.place(kit.box(W, railH, frameD, frameMat, { r: st.box ? 0.02 : 0.006 }), { y: legH + railH / 2, z: zc }));
  // colchão, edredom e travesseiros
  const mw = W - (st.box ? 0.01 : 0.08);
  const md = frameD - (st.box ? 0.01 : 0.06);
  const my = legH + railH;
  const mh = Math.min(matH, H - my);
  g.add(kit.place(mattressBlock(kit, mw, mh, md, { main: '#f4f3ef', accent: '#e4e0d8' }, { pillowTop: true }), { y: my, z: zc }));
  const duvetH = 0.03;
  if (H - my - mh > duvetH) {
    g.add(kit.place(kit.cushion(mw + 0.02, duvetH, md * 0.62, m.fabric(bedding, { kind: 'cotton' }), { puff: 0.3, r: 0.012 }), { y: my + mh + duvetH / 2 - 0.004, z: zc + md * 0.19 + 0.01 }));
    const pw = Math.min(0.62, (mw - 0.06) / 2);
    const ph = Math.min(0.12, H - my - mh - 0.005);
    if (ph > 0.05) {
      for (const sx of mw > 1.1 ? [-1, 1] : [0]) {
        g.add(kit.place(kit.cushion(mw > 1.1 ? pw : mw * 0.7, ph, 0.38, m.fabric(bedding, { kind: 'cotton' }), { puff: 0.35, r: ph * 0.45 }), { x: sx * (pw / 2 + 0.015), y: my + mh + ph / 2 - 0.01, z: -D / 2 + headT + 0.24, rx: -0.12 }));
      }
    }
  }
  // cabeceira
  if (head !== 'none') {
    const hz = -D / 2 + headT / 2;
    if (head === 'slats') {
      const n = Math.max(6, Math.round(W / 0.07));
      const sw = W / n;
      for (let i = 0; i < n; i++) g.add(kit.place(kit.box(sw * 0.72, H - 0.02, headT, c.wood, { r: 0.003 }), { x: -W / 2 + sw * (i + 0.5), y: (H - 0.02) / 2, z: hz }));
      g.add(kit.place(kit.box(W, 0.03, headT, c.wood, { r: 0.004 }), { y: H - 0.015, z: hz }));
    } else if (head === 'upholstered') {
      g.add(kit.place(st.tufted ? kit.tufted(W, H - legH, headT, frameMat, { rows: 3 }) : kit.cushion(W, H - legH, headT, frameMat, { puff: 0.08, r: 0.03 }), { y: legH + (H - legH) / 2, z: hz }));
    } else {
      g.add(kit.place(kit.box(W, H, headT, body, { r: 0.006 }), { y: H / 2, z: hz }));
    }
  }
  return g;
}
function bunkOrCrib(spec, kit, c) {
  const { st, W, H, D, m, body } = c;
  const g = kit.group(spec.kind === 'crib' ? 'generic-crib' : 'generic-bunk');
  const post = 0.05;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(kit.place(kit.box(post, H, post, body, { r: 0.004 }), { x: sx * (W / 2 - post / 2), y: H / 2, z: sz * (D / 2 - post / 2) }));
  }
  const level = (y, rail) => {
    g.add(kit.place(kit.box(W - 2 * post, 0.1, 0.03, body), { y: y, z: D / 2 - 0.015 }));
    g.add(kit.place(kit.box(W - 2 * post, 0.1, 0.03, body), { y: y, z: -D / 2 + 0.015 }));
    g.add(kit.place(kit.box(0.03, 0.1, D - 2 * post, body), { x: W / 2 - 0.015, y }));
    g.add(kit.place(kit.box(0.03, 0.1, D - 2 * post, body), { x: -W / 2 + 0.015, y }));
    const mh = 0.12;
    g.add(kit.place(mattressBlock(kit, W - 0.08, mh, D - 0.08, { main: '#f4f3ef', accent: '#e4e0d8' }, {}), { y: y + 0.02 }));
    if (rail) {
      const n = Math.max(6, Math.round(W / 0.09));
      const top = Math.min(H - 0.03, y + rail);
      for (let i = 1; i < n; i++) {
        const x = -W / 2 + post + ((W - 2 * post) * i) / n;
        g.add(kit.place(kit.cylinder(0.009, 0.009, top - y - 0.05, body, { seg: 10 }), { x, y: y + 0.05 + (top - y - 0.05) / 2, z: D / 2 - 0.015 }));
        g.add(kit.place(kit.cylinder(0.009, 0.009, top - y - 0.05, body, { seg: 10 }), { x, y: y + 0.05 + (top - y - 0.05) / 2, z: -D / 2 + 0.015 }));
      }
      g.add(kit.place(kit.box(W - 2 * post, 0.04, 0.04, body, { r: 0.004 }), { y: top, z: D / 2 - 0.02 }));
      g.add(kit.place(kit.box(W - 2 * post, 0.04, 0.04, body, { r: 0.004 }), { y: top, z: -D / 2 + 0.02 }));
    }
  };
  if (spec.kind === 'crib') {
    level(Math.min(0.4, H * 0.42), H * 0.55);
  } else {
    level(0.2, 0);
    level(Math.max(0.9, H - 0.55), 0.35);
    // escada na frente
    const lx = W / 2 - post - 0.2;
    const ly = Math.max(0.9, H - 0.55);
    for (const dx of [-0.17, 0.17]) g.add(kit.place(kit.box(0.04, ly + 0.1, 0.03, body), { x: lx + dx * 0.5, y: (ly + 0.1) / 2, z: D / 2 - 0.015 }));
    for (let y = 0.3; y < ly; y += 0.25) g.add(kit.place(kit.box(0.17, 0.03, 0.03, body), { x: lx, y, z: D / 2 - 0.015 }));
    void m;
  }
  return g;
}

/* ---------- eletrodomésticos ---------- */
function applianceBodyMat(kit, spec) {
  const C = spec.colors || {};
  const st = spec.style || {};
  if (spec.material === 'steel' || st.inox) return kit.mat.metal(C.main, { finish: 'brushed' });
  if (spec.material === 'plastic') return kit.mat.plastic(C.main, { gloss: 0.55 });
  return kit.mat.paint(C.main, { gloss: 0.75 });
}
function appliance(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  const g = kit.group(`generic-${spec.kind}`);
  const bm = applianceBodyMat(kit, spec);
  const chrome = m.metal('#d9dadb', { finish: 'chrome' });
  const glassDark = m.screen();
  const rad = st.rounded || st.retro ? Math.min(0.05, Math.min(W, D) * 0.12) : Math.min(0.012, Math.min(W, H, D) * 0.06);
  const feet = spec.kind === 'small_appliance' || spec.kind === 'air_conditioner' || spec.kind === 'microwave' ? Math.min(0.01, H * 0.04) : 0.02;
  const bodyH = H - feet;
  // espaço na frente para puxadores/botões (cada detalhe abaixo cabe nessa folga)
  const frontGap = { fridge: 0.027, washer: 0.03, stove: 0.027, microwave: 0.006, air_conditioner: 0.008 }[spec.kind] ?? 0.012;
  const bodyD = D - frontGap;
  const zf = -D / 2 + bodyD; // face frontal do corpo
  g.add(kit.place(kit.box(W, bodyH, bodyD, bm, { r: rad, seg: 4 }), { y: feet + bodyH / 2, z: -D / 2 + bodyD / 2 }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(kit.place(kit.cylinder(Math.min(0.02, W * 0.06), Math.min(0.02, W * 0.06), feet, m.rubber(), { seg: 12 }), { x: sx * (W / 2 - 0.05 * Math.min(1, W * 2)), y: feet / 2, z: sz * (bodyD / 2 - 0.04 * Math.min(1, D * 2)) - D / 2 + bodyD / 2 }));
  }
  const line = (y) => g.add(kit.place(kit.box(W - 2 * rad - 0.004, 0.004, 0.004, m.flat('#202020')), { y, z: zf + 0.001 }));
  const vbar = (x, y, len) => {
    const h = kit.handle('bar', { len, material: chrome });
    h.rotation.z = Math.PI / 2;
    g.add(kit.place(h, { x, y, z: zf }));
  };
  if (spec.kind === 'fridge' && st.freezer !== 'chest') {
    const split = st.duplex ? (st.inverse ? feet + bodyH * 0.32 : feet + bodyH * 0.7) : null;
    if (split) line(split);
    const hl = Math.min(0.35, bodyH * 0.18);
    if (split) {
      vbar(W / 2 - 0.06, st.inverse ? split + hl / 2 + 0.04 : split - hl / 2 - 0.05, hl);
      vbar(W / 2 - 0.06, st.inverse ? split - Math.min(0.12, hl / 2) - 0.03 : split + Math.min(0.12, hl / 2) + 0.03, Math.min(0.2, hl * 0.6));
    } else vbar(W / 2 - 0.06, feet + bodyH * 0.62, hl);
  } else if (spec.kind === 'fridge') {
    line(H - 0.06);
    const h = kit.handle('bar', { len: Math.min(0.3, W * 0.3), material: chrome });
    g.add(kit.place(h, { y: H - 0.1, z: zf }));
  } else if (spec.kind === 'washer') {
    const panel = Math.min(0.12, bodyH * 0.14);
    line(H - panel);
    g.add(kit.place(kit.box(W * 0.3, panel * 0.5, 0.006, glassDark), { x: -W * 0.1, y: H - panel / 2, z: zf + 0.003 }));
    g.add(kit.place(kit.cylinder(0.025, 0.025, 0.02, chrome, { seg: 20 }), { x: W * 0.3, y: H - panel / 2, z: zf + 0.01, rx: Math.PI / 2 }));
    if (st.frontLoad) {
      const R = Math.min(W, bodyH - panel) * 0.36;
      const cy = feet + (bodyH - panel) * 0.5;
      const ring = new kit.THREE.TorusGeometry(R, 0.015, 14, 48);
      g.add(kit.place(kit.mesh(ring, chrome), { y: cy, z: zf + 0.015 }));
      g.add(kit.place(kit.cylinder(R - 0.01, R - 0.01, 0.01, m.glass({ tint: '#2a3238', opacity: 0.75 }), { seg: 40 }), { y: cy, z: zf + 0.008, rx: Math.PI / 2 }));
    } else {
      g.add(kit.place(kit.box(W - 0.06, 0.006, bodyD - panel - 0.04, m.glass({ tint: '#30383d', opacity: 0.6 })), { y: H - 0.003, z: zf - (bodyD - panel - 0.04) / 2 - 0.02 }));
    }
  } else if (spec.kind === 'stove') {
    if (!st.cooktop) {
      const ovenTop = feet + bodyH * 0.78;
      line(ovenTop);
      line(feet + bodyH * 0.2);
      g.add(kit.place(kit.box(W * 0.62, bodyH * 0.3, 0.008, glassDark), { y: feet + bodyH * 0.5, z: zf + 0.004 }));
      g.add(kit.place(kit.handle('bar', { len: W * 0.7, material: chrome }), { y: ovenTop - 0.05, z: zf }));
      const n = Math.max(4, st.burners || 4) + 1;
      for (let i = 0; i < n; i++) g.add(kit.place(kit.cylinder(0.018, 0.018, 0.022, m.flat('#1a1a1a'), { seg: 16 }), { x: -W / 2 + (W * (i + 0.5)) / n, y: ovenTop + (H - ovenTop) * 0.45, z: zf + 0.011, rx: Math.PI / 2 }));
    }
    // mesa com queimadores
    const nb = Math.max(1, st.burners || 4);
    const cols = nb <= 2 ? nb : nb <= 4 ? 2 : 3;
    const rows = Math.ceil(nb / cols);
    let k = 0;
    for (let rI = 0; rI < rows; rI++) {
      for (let cI = 0; cI < cols && k < nb; cI++, k++) {
        const x = -W / 2 + (W * (cI + 0.5)) / cols;
        const z = -D / 2 + 0.04 + ((bodyD - 0.08) * (rI + 0.5)) / rows;
        const br = Math.min(0.05, Math.min(W / cols, bodyD / rows) * 0.28);
        g.add(kit.place(kit.cylinder(br, br * 1.1, 0.012, m.flat('#151515', { roughness: 0.4, metalness: 0.5 }), { seg: 28 }), { x, y: H - 0.006, z }));
      }
    }
  } else if (spec.kind === 'microwave') {
    const dw = W * 0.68;
    g.add(kit.place(kit.box(dw - 0.06, bodyH * 0.62, 0.006, glassDark), { x: -W / 2 + dw / 2 + 0.01, y: feet + bodyH / 2, z: zf + 0.003 }));
    g.add(kit.place(kit.box(W - dw - 0.04, bodyH * 0.18, 0.006, m.screen({ on: false })), { x: W / 2 - (W - dw) / 2, y: feet + bodyH * 0.75, z: zf + 0.003 }));
    for (let i = 0; i < 6; i++) g.add(kit.place(kit.cylinder(0.008, 0.008, 0.006, m.flat('#3a3a3a'), { seg: 10 }), { x: W / 2 - (W - dw) / 2 + (i % 2 ? 0.02 : -0.02), y: feet + bodyH * (0.55 - Math.floor(i / 2) * 0.12), z: zf + 0.003, rx: Math.PI / 2 }));
  } else if (spec.kind === 'air_conditioner') {
    g.add(kit.place(kit.box(W - 0.06, Math.min(0.03, H * 0.12), 0.01, m.flat('#2b2b2b')), { y: feet + bodyH * 0.14, z: zf + 0.003 }));
    g.add(kit.place(kit.box(0.02, 0.008, 0.004, m.flat('#36c2ff', { emissive: '#36c2ff' })), { x: W / 2 - 0.08, y: feet + bodyH * 0.35, z: zf + 0.002 }));
  } else {
    // eletroportátil genérico: faixa escura e botão
    g.add(kit.place(kit.box(W * 0.6, Math.min(0.04, bodyH * 0.18), 0.006, glassDark), { y: feet + bodyH * 0.72, z: zf + 0.003 }));
    g.add(kit.place(kit.cylinder(Math.min(0.015, W * 0.08), Math.min(0.015, W * 0.08), 0.012, chrome, { seg: 16 }), { y: feet + bodyH * 0.35, z: zf + 0.006, rx: Math.PI / 2 }));
  }
  return g;
}

/* ---------- TV ---------- */
function tv(spec, kit) {
  const c = ctx(spec, kit);
  const { W, H, D, m } = c;
  const g = kit.group('generic-tv');
  const footH = Math.min(0.06, H * 0.08);
  const panelD = Math.min(0.06, D * 0.6);
  const panelH = H - footH;
  const frame = m.plastic(c.C.main || '#141414', { gloss: 0.3 });
  const t1 = Math.max(0.012, panelD * 0.35);
  const zFront = panelD / 2 - 0.002;
  // moldura fina na frente, "corcunda" atrás e a tela ligada
  g.add(kit.place(kit.box(W, panelH, t1, frame, { r: 0.003 }), { y: footH + panelH / 2, z: zFront - t1 / 2 }));
  g.add(kit.place(kit.box(W * 0.8, panelH * 0.8, panelD - t1, frame, { r: 0.01 }), { y: footH + panelH * 0.45, z: -panelD / 2 + (panelD - t1) / 2 }));
  g.add(kit.place(kit.box(W - 0.012, panelH - 0.012, 0.002, m.screen({ on: true })), { y: footH + panelH / 2, z: zFront + 0.001 }));
  for (const sx of [-1, 1]) {
    const foot = kit.box(0.05, footH + 0.04, Math.max(0.04, D), m.metal(c.C.metal || '#2a2a2a', { finish: 'painted' }), { r: 0.006 });
    g.add(kit.place(foot, { x: sx * W * 0.38, y: (footH + 0.04) / 2, z: 0 }));
  }
  return g;
}

/* ---------- decoração e têxteis ---------- */
// Texto normalizado com espaço nas pontas (para testar palavras do nome do produto)
const normLabel = (s) => ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const FABRICS = ['linen', 'cotton', 'velvet', 'fabric', 'boucle', 'suede', 'leather'];
// Tábua/haste entre dois pontos do plano YZ (x fixo): caixa de seção w (X) x t
function strut(kit, p0, p1, w, t, material, part) {
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const b = kit.box(w, Math.hypot(dy, dz), t, material, { r: Math.min(w, t) * 0.25, part });
  b.position.set(p0[0], (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
  b.rotation.x = Math.atan2(dz, dy);
  return b;
}
// Casca fina de revolução: perfil externo de baixo para cima e o interno de volta (vê-se por dentro)
function shell(points, t) {
  const y0 = Math.min(...points.map((p) => p[1]));
  const inner = points.map(([r, y]) => [Math.max(0.0001, r - t), Math.max(y0, y - t * 0.6)]).reverse();
  return [...points, ...inner];
}
// Contorno 2D centrado com caixa exata W x H: elipse (redondo/oval) ou orgânico (deterministico pela semente)
function outline(THREE, W, H, kind, r) {
  const s = new THREE.Shape();
  if (kind !== 'organic') {
    s.absellipse(0, 0, W / 2, H / 2, 0, Math.PI * 2, false, 0);
    return s;
  }
  const a1 = 0.06 + r() * 0.05;
  const a2 = 0.04 + r() * 0.04;
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const k = 1 + a1 * Math.sin(2 * t + p1) + a2 * Math.sin(3 * t + p2);
    pts.push([Math.cos(t) * k, Math.sin(t) * k]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  pts.forEach(([x, y], i) => {
    const X = ((x - x0) / (x1 - x0) - 0.5) * W;
    const Y = ((y - y0) / (y1 - y0) - 0.5) * H;
    if (i) s.lineTo(X, Y);
    else s.moveTo(X, Y);
  });
  s.closePath();
  return s;
}

// Espelho / quadro: moldura e superfície recuada (espelho cromado ou tela com manchas de cor)
function framed(spec, kit, c) {
  const { st, W, H, D, m, r } = c;
  const THREE = kit.THREE;
  const g = kit.group(`generic-${st.decor}`);
  const isMirror = st.decor === 'mirror';
  const lab = normLabel(spec.label);
  const frameMat = st.woodLook || / madeira /.test(lab) ? c.wood : m.metal(c.C.main, { finish: / (dourad|ouro|latao|bronze|cobre) /.test(lab) ? 'brushed' : 'painted' });
  const surface = isMirror ? m.metal('#e4ebee', { finish: 'chrome' }) : m.fabric('#efe9df', { kind: 'cotton' });
  const shaped = st.shape === 'round' || st.shape === 'oval' || st.organic;
  // espelho de chão com profundidade para encostar: o painel inclina contra a parede
  const lean = isMirror && st.floorMirror && !shaped && D >= 0.15;
  const t = lean ? 0.03 : D;
  // inclinação que cabe exatamente em H x D (topo encostado atrás, base na frente): painel de comprimento PH
  const ang = lean ? Math.atan2(D - t, H) : 0;
  const PH = lean ? (H - t * Math.sin(ang)) / Math.cos(ang) : H;
  const fw = Math.min(0.05, Math.max(0.012, Math.min(W, PH) * (isMirror ? 0.05 : 0.07)));
  // superfície recuada 30% da espessura (não passa da frente nem do fundo da moldura)
  const inner = (w, h) => kit.place(kit.box(w, h, t * 0.7, surface, { part: 'detail' }), { y: 0, z: -t * 0.15 });
  const panel = kit.group('painel');
  if (shaped) {
    // moldura em anel (furo do tamanho do espelho) e espelho recuado
    const kind = st.organic ? 'organic' : 'ellipse';
    const rs = kit.rng(`${spec.seed}:contorno`);
    const outer = outline(THREE, W, PH, kind, rs);
    const hole = outline(THREE, Math.max(0.02, W - 2 * fw), Math.max(0.02, PH - 2 * fw), kind, kit.rng(`${spec.seed}:contorno`));
    const ring = new THREE.Shape(outer.getPoints(64));
    ring.holes.push(new THREE.Path(hole.getPoints(64)));
    panel.add(kit.extrude(ring, t, frameMat, { curveSegments: 48, part: 'main' }));
    panel.add(kit.place(kit.extrude(new THREE.Shape(hole.getPoints(64)), t * 0.7, surface, { curveSegments: 48, part: 'detail' }), { z: -t * 0.15 }));
  } else {
    const rb = Math.min(0.004, fw * 0.3);
    panel.add(kit.place(kit.box(W, fw, t, frameMat, { r: rb, part: 'main' }), { y: PH / 2 - fw / 2 }));
    panel.add(kit.place(kit.box(W, fw, t, frameMat, { r: rb, part: 'main' }), { y: -PH / 2 + fw / 2 }));
    panel.add(kit.place(kit.box(fw, PH - 2 * fw + 0.002, t, frameMat, { r: rb, part: 'main' }), { x: -W / 2 + fw / 2 }));
    panel.add(kit.place(kit.box(fw, PH - 2 * fw + 0.002, t, frameMat, { r: rb, part: 'main' }), { x: W / 2 - fw / 2 }));
    panel.add(inner(W - 2 * fw + 0.002, PH - 2 * fw + 0.002));
    if (!isMirror) {
      // quadro: manchas de cor abstratas na tela (dentro da moldura, sem passar da frente)
      const cols = ['#c9692b', '#1f5a4a', '#d8cba0', '#2f4a5c', '#b5703a'];
      const iw = W - 2 * fw;
      const ih = PH - 2 * fw;
      for (let i = 0; i < 4; i++) {
        const bw = iw * (0.2 + r() * 0.3);
        const bh = ih * (0.15 + r() * 0.35);
        const x = (r() - 0.5) * (iw - bw);
        const y = (r() - 0.5) * (ih - bh);
        panel.add(kit.place(kit.box(bw, bh, 0.0015, m.paint(cols[(i + Math.floor(r() * 5)) % 5]), { part: 'detail' }), { x, y, z: t * 0.2 - 0.001 + i * 0.0002 }));
      }
    }
  }
  if (lean) {
    panel.rotation.x = -ang;
    panel.position.set(0, H / 2, 0);
    g.add(panel);
    // pezinho de apoio: do chão (atrás) até as costas do painel
    const yS = H * 0.45;
    const zS = (H / 2 - yS) * Math.tan(ang) - t / 2 / Math.cos(ang) - 0.004;
    g.add(strut(kit, [0, 0.01, -D / 2 + 0.012], [0, yS, zS], 0.03, 0.02, frameMat, 'detail'));
  } else {
    panel.position.y = H / 2;
    g.add(panel);
  }
  return g;
}

// Luminárias: de chão, abajur, pendente, arandela e de arco
function lamp(spec, kit, c) {
  const { st, W, H, D, m } = c;
  const g = kit.group(`generic-lamp-${st.lampType || 'floor'}`);
  const lab = normLabel(spec.label);
  const main = c.C.main;
  // a cor do produto vai na cúpula quando ela é de tecido ("Cúpula de Linho Bege"); senão vai na estrutura
  const shadeIsMain = / cupula /.test(lab) || FABRICS.includes(spec.material);
  const frameHex = shadeIsMain ? (/ (dourad|ouro|latao) /.test(lab) ? '#c9a24a' : '#2b2b2b') : main;
  const frame = m.metal(frameHex, { finish: kit.luminance(frameHex) > 0.35 ? 'brushed' : 'painted' });
  const shadeFab = m.fabric(shadeIsMain ? main : '#f1ebe0', { kind: 'linen' });
  const dome = shadeIsMain ? shadeFab : m.metal(main, { finish: 'painted' });
  const glass = / (cristal|vidro) /.test(lab);
  const glow = m.flat('#fff6e0', { emissive: '#ffe9b8' });
  const type = st.lampType || 'floor';
  if (type === 'pendant') {
    // canopla no teto, fio e cúpula (domo industrial, de vidro ou tambor de tecido); a borda da cúpula em y = 0
    const R = Math.min(W, D) / 2;
    const sh = Math.min(H * 0.6, R * (shadeIsMain ? 1.1 : 0.95));
    const prof = shadeIsMain
      ? [[R, 0], [R, sh * 0.02], [R * 0.98, sh], [R * 0.95, sh]]
      : [[R, 0], [R * 0.96, sh * 0.06], [R * 0.72, sh * 0.42], [R * 0.36, sh * 0.78], [Math.min(0.03, R * 0.3), sh * 0.92], [Math.min(0.025, R * 0.25), sh]];
    const shadeMat = glass ? m.glass({ tint: '#f4f1ea', opacity: 0.45 }) : dome;
    g.add(kit.lathe(shell(prof, Math.min(0.004, R * 0.05)), shadeMat, { seg: 40, part: 'main' }));
    if (shadeIsMain) g.add(kit.place(kit.cylinder(0.02, 0.02, 0.02, frame, { seg: 16, part: 'metal' }), { y: sh * 0.8 }));
    g.add(kit.place(kit.sphere(Math.min(0.035, R * 0.35), glow, { seg: 16 }), { y: sh * 0.35 }));
    const capR = Math.min(0.06, R * 0.7);
    g.add(kit.place(kit.cylinder(capR * 0.9, capR, 0.02, frame, { seg: 24, part: 'metal' }), { y: H - 0.01 }));
    const cord = H - 0.02 - sh;
    if (cord > 0.005) g.add(kit.place(kit.cylinder(0.003, 0.003, cord, m.flat('#1a1a1a'), { seg: 8, part: 'detail' }), { y: sh + cord / 2 }));
    return g;
  }
  if (type === 'arc') {
    // base pesada numa ponta, arco que sobe e passa por cima, cúpula pendurada na outra ponta
    const baseR = D / 2;
    const R = Math.min(D / 2, Math.max(0.1, H * 0.11));
    const xb = -W / 2 + baseR;
    const xs = W / 2 - R;
    const tr = 0.012;
    g.add(kit.place(kit.lathe([[0.0001, 0], [baseR, 0], [baseR, 0.03], [baseR * 0.85, 0.05], [0.03, 0.06], [0.0001, 0.06]], m.marble('#e9e6e0'), { seg: 40, part: 'detail' }), { x: xb }));
    const y1 = H * 0.5;
    const top = H - tr;
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push([xb, 0.06 + ((y1 - 0.06) * i) / 6, 0]);
    for (let i = 1; i <= 24; i++) {
      const a = Math.PI - (i / 24) * Math.PI;
      pts.push([(xb + xs) / 2 + Math.cos(a) * (xs - xb) / 2, y1 + Math.sin(a) * (top - y1), 0]);
    }
    const sh = Math.min(R * 1.0, y1 * 0.5);
    pts.push([xs, y1 - 0.03, 0]);
    g.add(kit.tube(pts, tr, frame, { seg: 96, radial: 10, part: 'metal' }));
    const prof = [[R, 0], [R * 0.95, sh * 0.08], [R * 0.7, sh * 0.5], [R * 0.3, sh * 0.85], [0.02, sh]];
    const shade = kit.lathe(shell(prof, 0.003), shadeIsMain ? shadeFab : frame, { seg: 40, part: 'main' });
    g.add(kit.place(shade, { x: xs, y: y1 - 0.03 - sh }));
    g.add(kit.place(kit.sphere(0.03, glow, { seg: 14 }), { x: xs, y: y1 - 0.03 - sh * 0.6 }));
    return g;
  }
  if (type === 'wall') {
    // arandela: espelho de fixação na parede (atrás), braço e cúpula na frente
    const R = Math.min(W / 2, (D - 0.03) / 2);
    const sh = Math.min(H * 0.45, R * 1.4);
    const plateH = Math.min(H * 0.55, 0.16);
    g.add(kit.place(kit.box(Math.min(W * 0.6, 0.1), plateH, 0.015, frame, { r: 0.004, part: 'metal' }), { y: plateH / 2, z: -D / 2 + 0.0075 }));
    const zc = D / 2 - R;
    g.add(kit.tube([[0, plateH * 0.6, -D / 2 + 0.015], [0, plateH * 0.7, (zc - D / 2) / 2], [0, H - sh * 0.6, zc]], 0.008, frame, { seg: 24, radial: 8, part: 'metal' }));
    const prof = [[R * 0.75, H - sh], [R * 0.8, H - sh + 0.002], [R, H - 0.002], [R * 0.98, H]];
    g.add(kit.place(kit.lathe(shell(prof, 0.003), shadeIsMain || !glass ? shadeFab : m.glass({ tint: '#f4f1ea', opacity: 0.5 }), { seg: 36, part: 'main' }), { z: zc }));
    g.add(kit.place(kit.sphere(Math.min(0.025, R * 0.4), glow, { seg: 12 }), { y: H - sh * 0.55, z: zc }));
    return g;
  }
  const R = Math.min(W, D) / 2;
  if (type === 'table') {
    // abajur: corpo torneado (cerâmica ou metal) e cúpula tronco-cônica
    const sh = Math.min(H * 0.45, R * 1.25);
    const bodyH = H - sh * 0.75;
    const rb = R * 0.5;
    const bodyMat = shadeIsMain ? m.paint(/ (dourad|ouro) /.test(lab) ? '#c9a24a' : '#efe9df', { gloss: 0.85 }) : frame;
    g.add(kit.lathe([[0.0001, 0], [rb * 0.7, 0], [rb * 0.75, 0.01], [rb, bodyH * 0.35], [rb * 0.92, bodyH * 0.6], [rb * 0.45, bodyH * 0.82], [rb * 0.3, bodyH * 0.9], [0.012, bodyH * 0.92], [0.012, bodyH], [0.0001, bodyH]], bodyMat, { seg: 36, part: 'main' }));
    g.add(kit.lathe(shell([[R, H - sh], [R * 0.72, H]], 0.003), shadeFab, { seg: 40, part: 'accent' }));
    g.add(kit.place(kit.sphere(0.025, glow, { seg: 12 }), { y: H - sh * 0.5 }));
    return g;
  }
  // de chão: base, haste e cúpula de tecido
  const baseR = R * 0.55;
  const shadeH = Math.min(H * 0.32, R * 1.2);
  const stemH = H - shadeH * 0.55 - 0.03;
  g.add(kit.place(kit.cylinder(baseR * 0.95, baseR, 0.03, frame, { seg: 32, part: 'metal' }), { y: 0.015 }));
  g.add(kit.place(kit.cylinder(0.008, 0.008, stemH, frame, { seg: 12, part: 'metal' }), { y: 0.03 + stemH / 2 }));
  g.add(kit.lathe(shell([[R, H - shadeH], [R * 0.62, H]], 0.003), shadeFab, { seg: 40, part: 'accent' }));
  g.add(kit.place(kit.sphere(0.03, glow, { seg: 16 }), { y: H - shadeH * 0.55 }));
  return g;
}

// Cortina (duas folhas franzidas num varão) ou persiana (rolô)
function curtain(spec, kit, c) {
  const { st, W, H, D, m } = c;
  const THREE = kit.THREE;
  const g = kit.group(st.blinds ? 'generic-blinds' : 'generic-curtain');
  const fab = m.fabric(c.C.main, { kind: FABRICS.includes(spec.material) && spec.material !== 'fabric' ? spec.material : 'linen' });
  const rodMat = m.metal(c.C.metal || '#2b2b2b', { finish: 'painted' });
  if (st.blinds) {
    // persiana rolô: bandô no alto, tela lisa e barra de peso embaixo
    const head = Math.min(0.08, H * 0.06);
    g.add(kit.place(kit.box(W, head, D, m.paint('#f2f2f0', { gloss: 0.4 }), { r: Math.min(0.02, head * 0.4), part: 'accent' }), { y: H - head / 2 }));
    g.add(kit.place(kit.box(W - 0.02, H - head - 0.03, 0.004, fab, { part: 'main' }), { y: (H - head - 0.03) / 2 + 0.03, z: D / 2 - 0.01 }));
    g.add(kit.place(kit.box(W - 0.02, 0.03, 0.012, rodMat, { r: 0.004, part: 'metal' }), { y: 0.015, z: D / 2 - 0.01 }));
    return g;
  }
  // varão com ponteiras (largura total) e suportes até a parede
  const fr = Math.min(0.035, D * 0.3, H * 0.03);
  const rodR = Math.min(0.012, fr * 0.5);
  const rodY = H - fr;
  const rod = kit.cylinder(rodR, rodR, W - 2 * fr, rodMat, { seg: 16, part: 'metal' });
  rod.rotation.z = Math.PI / 2;
  g.add(kit.place(rod, { y: rodY }));
  for (const sx of [-1, 1]) {
    g.add(kit.place(kit.sphere(fr, rodMat, { seg: 16, part: 'metal' }), { x: sx * (W / 2 - fr), y: rodY }));
    g.add(kit.place(kit.box(0.015, 0.015, D / 2, rodMat, { part: 'metal' }), { x: sx * (W / 2 - fr * 3), y: rodY, z: -D / 4 }));
  }
  // folhas franzidas: faixa ondulada extrudada para cima, do chão até logo abaixo do varão
  const amp = Math.max(0.005, D / 2 - 0.0005);
  const lam = Math.max(0.08, amp * 2.6);
  const thick = 0.004;
  const fh = rodY - rodR - 0.01;
  const leaf = (x0, x1) => {
    const n = Math.max(8, Math.round(((x1 - x0) / lam) * 10));
    const top = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      top.push([x, Math.sin(((x - x0) / lam) * Math.PI * 2) * (amp - thick / 2)]);
    }
    const s = new THREE.Shape();
    top.forEach(([x, z], i) => (i ? s.lineTo(x, -z - thick / 2) : s.moveTo(x, -z - thick / 2)));
    for (let i = top.length - 1; i >= 0; i--) s.lineTo(top[i][0], -top[i][1] + thick / 2);
    s.closePath();
    const me = kit.extrude(s, fh, fab, { curveSegments: 1, part: 'main' });
    me.rotation.x = -Math.PI / 2;
    me.position.y = fh / 2;
    return me;
  };
  const gap = Math.min(0.04, W * 0.02);
  const span = W - 4 * fr;
  g.add(leaf(-span / 2, -gap / 2));
  g.add(leaf(gap / 2, span / 2));
  // argolas no varão
  const ringMat = rodMat;
  const nr = Math.max(4, Math.round(span / 0.12));
  for (let i = 0; i <= nr; i++) {
    const x = -span / 2 + (span * i) / nr;
    if (Math.abs(x) < gap) continue;
    const t = new THREE.TorusGeometry(rodR * 1.8, 0.003, 6, 14);
    g.add(kit.place(kit.mesh(t, ringMat, { part: 'metal', keepUV: true }), { x, y: rodY, ry: Math.PI / 2 }));
  }
  return g;
}

// Escada: decorativa (encostada na parede) ou doméstica de abrir (alumínio)
function ladder(spec, kit, c) {
  const { st, W, H, D, m } = c;
  const g = kit.group('generic-ladder');
  if (st.ladderType === 'step') {
    const al = m.metal(st.woodLook ? c.C.main : '#c9cdd1', { finish: 'brushed' });
    const rub = m.rubber('#1b1b1b');
    const rw = 0.03;
    const rt = 0.022;
    const topT = 0.03;
    const zTop = -D / 2 + D * 0.38;
    const yTop = H - topT;
    const n = Math.max(2, Math.min(8, st.steps || 4));
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - rw / 2);
      g.add(strut(kit, [x, 0, D / 2 - rt / 2], [x, yTop, zTop + 0.04], rw, rt, al, 'main'));
      g.add(strut(kit, [sx * (W / 2 - rw / 2 - 0.02), 0, -D / 2 + rt / 2], [sx * (W / 2 - rw / 2 - 0.02), yTop - 0.02, zTop - 0.03], rw * 0.8, rt, al, 'main'));
      g.add(kit.place(kit.box(rw + 0.004, 0.02, 0.04, rub, { r: 0.004 }), { x, y: 0.01, z: D / 2 - 0.02 }));
    }
    // degraus (largos, ao longo dos montantes da frente) e plataforma no topo
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const y = yTop * f;
      const z = D / 2 - rt / 2 + (zTop + 0.04 - (D / 2 - rt / 2)) * f;
      g.add(kit.place(kit.box(W - 2 * rw, 0.02, 0.09, al, { r: 0.003, part: 'main' }), { y, z: z - 0.03 }));
    }
    g.add(kit.place(kit.box(W - 0.01, topT, 0.24, m.plastic('#2a2b2d', { gloss: 0.3 }), { r: 0.006, part: 'accent' }), { y: H - topT / 2, z: zTop }));
    return g;
  }
  // escada decorativa encostada: dois montantes inclinados e travessas
  const wood = st.woodLook || spec.material === 'wood' ? m.wood(st.woodLook ? c.C.main : c.C.wood || '#b08a5a', { grain: st.rustic ? 'rustic' : 'oak' }) : c.body;
  const rw = Math.min(0.05, W * 0.1);
  const rt = Math.min(0.03, D * 0.2);
  const ang = Math.atan2(D - rt, H);
  const L = (H - rt * Math.sin(ang)) / Math.cos(ang);
  // eixo dos montantes: centrado na caixa (a seção rt fecha a altura e a profundidade exatas)
  const y0 = (rt * Math.sin(ang)) / 2;
  const p0z = (L * Math.sin(ang)) / 2;
  const p1 = [0, y0 + L * Math.cos(ang), p0z - L * Math.sin(ang)];
  for (const sx of [-1, 1]) g.add(strut(kit, [sx * (W / 2 - rw / 2), y0, p0z], [sx * (W / 2 - rw / 2), p1[1], p1[2]], rw, rt, wood, 'main'));
  const n = Math.max(3, Math.min(10, st.steps || Math.round(H / 0.32)));
  for (let i = 1; i <= n; i++) {
    const f = (i - 0.35) / n;
    const y = y0 + (p1[1] - y0) * f;
    const z = p0z + (p1[2] - p0z) * f;
    const rung = kit.cylinder(0.014, 0.014, W - 2 * rw + 0.004, wood, { seg: 14, part: 'main', alongHeight: true });
    rung.rotation.z = Math.PI / 2;
    g.add(kit.place(rung, { y, z }));
  }
  return g;
}

// Têxteis: almofada em pé, peça dobrada (edredom, manta, toalha) ou pilha genérica
function textile(spec, kit, c) {
  const { st, W, H, D, m } = c;
  const g = kit.group(`generic-${st.textileKind || 'textile'}`);
  const main = c.C.main;
  const fab = m.upholstery(main, FABRICS.includes(spec.material) ? spec.material : 'cotton');
  if (st.textileKind === 'cushion' || (!st.textileKind && H < 0.2 && W < 0.75 && D < 0.75)) {
    // almofada decorativa em pé (espessura em Z) ou deitada quando é mais baixa que larga
    if (H > D) {
      const cu = kit.cushion(W, D, H, fab, { puff: 0.42, r: Math.min(W, H) * 0.12 });
      cu.rotation.x = Math.PI / 2;
      g.add(kit.place(cu, { y: H / 2 }));
    } else g.add(kit.place(kit.cushion(W, H, D, fab, { puff: 0.38, r: H * 0.45 }), { y: H / 2 }));
    return g;
  }
  // dobrado: camadas com a dobra arredondada na frente e leve variação de tom
  const n = Math.max(2, Math.min(5, Math.round(H / 0.05)));
  const lh = H / n;
  for (let i = 0; i < n; i++) {
    const tone = i % 2 ? kit.shade(main, -0.07) : main;
    const off = (i % 2 ? 1 : -1) * Math.min(0.006, W * 0.02);
    const layer = kit.cushion(W - 0.012, lh, D - 0.006, m.fabric(tone, { kind: 'cotton' }), { puff: 0.1, r: lh * 0.48 });
    g.add(kit.place(layer, { x: off, y: lh * (i + 0.5), z: (i % 2 ? -1 : 1) * 0.003 }));
  }
  return g;
}

function decor(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  if (st.textile) return textile(spec, kit, c);
  if (st.decor === 'lamp') return lamp(spec, kit, c);
  if (st.decor === 'mirror' || st.decor === 'frame') return framed(spec, kit, c);
  if (st.decor === 'curtain') return curtain(spec, kit, c);
  if (st.decor === 'ladder') return ladder(spec, kit, c);
  const g = kit.group(`generic-${st.decor || st.family}`);
  const main = c.C.main;
  const lab = normLabel(spec.label);
  switch (st.decor) {
    case 'rug': {
      // pelo alto (shaggy/felpudo) usa a trama bouclé; redondo vira disco
      const kind = / (shaggy|felpudo|peludo|pelo alto) /.test(lab) ? 'boucle' : 'linen';
      const f = m.fabric(main, { kind });
      const edge = m.fabric(kit.shade(main, -0.25), { kind });
      if (st.shape === 'round' && Math.abs(W - D) < 0.02) {
        g.add(kit.place(kit.cylinder(W / 2, W / 2, H, edge, { seg: 64 }), { y: H / 2 }));
        g.add(kit.place(kit.cylinder(W / 2 - 0.05, W / 2 - 0.05, H * 0.1 + 0.0004, f, { seg: 64 }), { y: H - (H * 0.1 + 0.0004) / 2 + 0.0002 }));
        break;
      }
      g.add(kit.place(kit.box(W, H, D, edge, { r: Math.min(H / 2, 0.004) }), { y: H / 2 }));
      g.add(kit.place(kit.box(W - 0.12, H * 0.1 + 0.0004, D - 0.12, f), { y: H + 0.0002 - (H * 0.1 + 0.0004) / 2 + 0.0001 }));
      break;
    }
    case 'vase': {
      // cerâmica brilhante; redondo quando largura ≈ profundidade, senão vaso retangular de cantos macios
      const mt = m.paint(main, { gloss: 0.85 });
      if (Math.abs(W - D) <= Math.max(W, D) * 0.03) {
        const R = Math.max(W, D) / 2;
        const prof = [[0.0001, 0], [R * 0.55, 0], [R * 0.85, H * 0.15], [R, H * 0.42], [R * 0.82, H * 0.7], [R * 0.42, H * 0.86], [R * 0.4, H * 0.95], [R * 0.5, H], [R * 0.44, H], [0.0001, H * 0.9]];
        g.add(kit.lathe(prof, mt, { seg: 40, part: 'main' }));
      } else {
        g.add(kit.place(kit.box(W, H, D, mt, { r: Math.min(W, D) * 0.2, seg: 4, part: 'main' }), { y: H / 2 }));
        g.add(kit.place(kit.box(W * 0.7, 0.004, D * 0.6, m.flat('#1d1a17', { roughness: 0.9 }), { r: 0.001, part: 'detail' }), { y: H - 0.0015 }));
      }
      break;
    }
    default: {
      // suporte / objeto: placa e braço
      g.add(kit.place(kit.box(W * 0.4, H, Math.min(0.02, D), c.dark), { y: H / 2, z: -D / 2 + Math.min(0.02, D) / 2 }));
      g.add(kit.place(kit.box(W, 0.03, 0.03, c.dark), { y: H * 0.6, z: 0 }));
      g.add(kit.place(kit.box(0.03, 0.03, D, c.dark), { y: H * 0.6 }));
    }
  }
  return g;
}

/* ---------- objeto genérico (categoria desconhecida) ---------- */
function object(spec, kit) {
  const c = ctx(spec, kit);
  const { W, H, D, m } = c;
  // muito fino na profundidade: painel emoldurado; muito baixo: placa; pequeno: peça arredondada sobre base
  if (D < 0.06 && H > 0.2) return decor({ ...spec, style: { ...c.st, decor: 'frame' } }, kit);
  if (H < 0.05) {
    const g = kit.group('generic-slab');
    g.add(kit.place(kit.box(W, H, D, c.body, { r: Math.min(H / 2.2, 0.01) }), { y: H / 2 }));
    return g;
  }
  if (Math.max(W, H, D) < 0.45) {
    const g = kit.group('generic-small');
    const bh = Math.min(0.02, H * 0.1);
    g.add(kit.place(kit.box(W, bh, D, m.metal(c.C.metal, { finish: 'painted' }), { r: bh * 0.4 }), { y: bh / 2 }));
    g.add(kit.place(kit.box(W * 0.94, H - bh, D * 0.94, m.plastic(c.C.main, { gloss: 0.6 }), { r: Math.min(W, D, H) * 0.18, seg: 4 }), { y: bh + (H - bh) / 2 }));
    return g;
  }
  return cabinet(spec, kit);
}

/* ---------- despacho por arquétipo ---------- */
const BY_KIND = {
  sofa, armchair: sofa, chair, stool: chair, pouf,
  bed, bunk_bed: bed, crib: bed, mattress,
  coffee_table: table, side_table: table, dining_table: table, desk: table,
  nightstand: cabinet, dresser: cabinet, wardrobe: cabinet, rack: cabinet, kitchen_cabinet: cabinet, shelf,
  tv, fridge: appliance, washer: appliance, stove: appliance, microwave: appliance, air_conditioner: appliance, small_appliance: appliance,
};
const BY_FAMILY = { seating: sofa, soft: pouf, bed, table, storage: cabinet, appliance, screen: tv, decor, furniture: object };

export function generic(spec, kit, THREE) {
  void THREE;
  const st = spec.style || {};
  let fn = BY_KIND[spec.kind];
  if (!fn || spec.kind === 'generic') fn = st.textile || st.decor ? decor : BY_FAMILY[st.family] || object;
  return fn(spec, kit);
}
export default generic;
