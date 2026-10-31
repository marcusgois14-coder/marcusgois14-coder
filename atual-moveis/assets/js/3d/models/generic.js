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
function decor(spec, kit) {
  const c = ctx(spec, kit);
  const { st, W, H, D, m } = c;
  const g = kit.group(`generic-${st.decor || st.family}`);
  const main = c.C.main;
  if (st.textile) {
    if (H < 0.2 && W < 0.75 && D < 0.75) g.add(kit.place(kit.cushion(W, H, D, m.upholstery(main, spec.material), { puff: 0.38, r: H * 0.45 }), { y: H / 2 }));
    else {
      const n = 3;
      for (let i = 0; i < n; i++) g.add(kit.place(kit.cushion(W - i * 0.01, H / n, D - i * 0.01, m.fabric(i === 1 ? kit.shade(main, -0.08) : main, { kind: 'cotton' }), { puff: 0.15, r: H / n * 0.45 }), { y: (H / n) * (i + 0.5) }));
    }
    return g;
  }
  switch (st.decor) {
    case 'rug': {
      const f = m.fabric(main, { kind: 'linen' });
      g.add(kit.place(kit.box(W, H, D, m.fabric(kit.shade(main, -0.25), { kind: 'linen' }), { r: Math.min(H / 2, 0.004) }), { y: H / 2 }));
      g.add(kit.place(kit.box(W - 0.12, H * 0.1 + 0.0004, D - 0.12, f), { y: H + 0.0002 - (H * 0.1 + 0.0004) / 2 + 0.0001 }));
      break;
    }
    case 'lamp': {
      const R = Math.min(W, D) / 2;
      const baseR = R * 0.55;
      const shadeH = Math.min(H * 0.32, R * 1.2);
      const stemH = H - shadeH * 0.55 - 0.03;
      g.add(kit.place(kit.cylinder(baseR * 0.95, baseR, 0.03, c.metal, { seg: 32 }), { y: 0.015 }));
      g.add(kit.place(kit.cylinder(0.008, 0.008, stemH, c.metal, { seg: 12 }), { y: 0.03 + stemH / 2 }));
      // cúpula de parede fina: lado de fora de baixo para cima, depois o de dentro
      const sh = kit.lathe([[R, H - shadeH], [R * 0.62, H], [R * 0.6, H], [R * 0.98, H - shadeH]], m.fabric('#f1ebe0', { kind: 'linen' }), { seg: 40 });
      g.add(sh);
      const bulb = kit.sphere(0.03, m.flat('#fff6e0', { emissive: '#ffe9b8' }), { seg: 16 });
      g.add(kit.place(bulb, { y: H - shadeH * 0.55 }));
      break;
    }
    case 'mirror':
    case 'frame': {
      const fw = Math.min(0.05, Math.min(W, H) * 0.08);
      const fm = st.woodLook ? c.wood : m.metal(main, { finish: 'painted' });
      g.add(kit.place(kit.box(W, H, D, fm, { r: Math.min(0.006, D / 3) }), { y: H / 2 }));
      const inner = st.decor === 'mirror' ? m.metal('#e4ebee', { finish: 'chrome' }) : m.fabric('#efe9df', { kind: 'cotton' });
      g.add(kit.place(kit.box(W - 2 * fw, H - 2 * fw, 0.004, inner, { part: 'detail' }), { y: H / 2, z: D / 2 - 0.0015 }));
      if (st.decor === 'frame') {
        const cols = ['#c9692b', '#1f5a4a', '#d8cba0'];
        cols.forEach((col, i) => g.add(kit.place(kit.box((W - 2 * fw) * 0.3, (H - 2 * fw) * (0.25 + i * 0.12), 0.002, m.paint(col), { part: 'detail' }), { x: (i - 1) * (W - 2 * fw) * 0.22, y: H / 2 - i * 0.03, z: D / 2 + 0.0008 })));
      }
      break;
    }
    case 'vase': {
      const R = Math.min(W, D) / 2;
      const prof = [[0.0001, 0], [R * 0.55, 0], [R * 0.85, H * 0.15], [R, H * 0.42], [R * 0.82, H * 0.7], [R * 0.42, H * 0.86], [R * 0.4, H * 0.95], [R * 0.5, H], [R * 0.44, H], [0.0001, H * 0.9]];
      g.add(kit.lathe(prof, m.plastic(main, { gloss: 0.8 }), { seg: 40 }));
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
