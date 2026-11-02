// Geradores de sala, mesas e armários: mesa de centro, mesa lateral (e aparador), mesa de jantar,
// escrivaninha (e penteadeira), rack (painel, home theater), estante e armário de cozinha.
// Cada função recebe (spec, kit, THREE) e devolve um THREE.Group em metros: chão em y = 0,
// centrado em x/z, frente para +Z, montado na medida exata do spec (w x h x d), sem escalar
// formas redondas. Só usa materiais e formas do kit (texturas compartilhadas).
//
// Estilos lidos de spec.style (model3d.style do produto pode forçar qualquer um):
//   mesas ........ shape 'round'|'oval'|'square', glass, marble, shelf, niche, drawers, rustic, retro,
//                  industrial, legs ('palito'|'tapered'|'turned'|'metal'|'wood_base'|'hidden'),
//                  console (aparador), nesting (conjunto ninho), base ('pedestal'|'drum'|'legs'|'block'|'trestle')
//   escrivaninha . drawers, niche, shelf, corner (em L), vanity + mirror (penteadeira), gamer, legs
//   rack ......... doors, drawers, niche, panel (painel), led, glass, cane, headboard 'slats' (ripado), legs
//   estante ...... shelf (nº de níveis), doors, drawers, glassDoors (cristaleira), corner, ladder, openBack, legs
//   cozinha ...... doors, drawers, glass, marble, sink, cooktop, layout ('compact'|'base'|'wall'|'tall')
//   todos ........ handle ('bar'|'knob'|'cutout'|'leather_strap'|'profile'|'none'), woodLook, grain, twoTone
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { findColorWords } from '../infer.js';

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => ` ${String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
// Cor de madeira padrão de cada tipo (em infer.js): se o spec trouxer outra, o móvel é bicolor
const DEF_WOOD = { coffee_table: '#a0663b', side_table: '#a0663b', dining_table: '#a0663b', desk: '#c8995e', rack: '#c8995e', shelf: '#c8995e', kitchen_cabinet: '#c8995e' };
const BOOK_COLORS = ['#7a2f2a', '#2f4a5c', '#c9b58f', '#3d5a40', '#e5ded2', '#8a6a4a', '#1f1f1f', '#b5703a', '#d8cba0', '#5c6b73', '#a33b2f', '#26364a', '#6d5a7a', '#efe9df'];
const R2 = { r: 0.0025, seg: 2 }; // cantos suaves para placas
const PULL_DEPTH = { bar: 0.028, knob: 0.027, leather_strap: 0.027, cutout: 0.003, profile: 0.012, none: 0 };
// Palavras de metal no nome; e as que só descrevem pés/base/estrutura
const METAL_WORD = / (metal|metalic[oa]s?|aco|ferro|aluminio|tubular|cromad[oa]s?|inox|metalon) /;
const METAL_LEGS = / (pes|pe|base|bases|estrutura|pernas?|armacao)( (de|em))? (metal|metalic[oa]s?|aco( carbono)?|ferro|aluminio|metalon|tubular|cromad[oa]s?)(?= )/g;
const METALLIC_WORD = / (inox|aco inox|aco escovado|escovado|cromad[oa]|cromo|dourad[oa]|ouro|gold|prata|prateado|prateada|bronze|cobre|rose gold|champagne|champanhe) /;
function legsOnlyMetal(label) {
  const rest = label.replace(METAL_LEGS, ' ');
  return rest !== label && !METAL_WORD.test(rest);
}

function ctx(spec, kit, THREE) {
  const st = spec.style || {};
  const C = { main: '#a0663b', accent: '#e9e4da', wood: DEF_WOOD[spec.kind] || '#a0663b', metal: '#1f1f1f', ...(spec.colors || {}) };
  const c = { spec, st, C, kit, THREE, m: kit.mat, W: kit.cm(spec.w), H: kit.cm(spec.h), D: kit.cm(spec.d), label: norm(spec.label) };
  c.r = kit.rng(`${spec.seed || spec.kind}:living`);
  c.has = (re) => re.test(c.label);
  c.words = findColorWords(spec.label || ''); // cores citadas no nome ("Off White e Freijó")
  c.mt = spec.material;
  // metal só nos pés/base ("Rack ... Pés de Metal", "Aparador ... Estrutura Metálica"): o corpo é MDF/madeira
  if ((c.mt === 'metal' || c.mt === 'steel') && legsOnlyMetal(c.label)) c.mt = c.has(/ madeira | macic/) ? 'wood' : 'mdf';
  // segunda cor depois de uma madeira ("Carvalho e Preto"): vai para a estrutura (pés, saia) e as frentes
  const w2 = c.words.slice(1).find((w) => !w.wood && !METALLIC_WORD.test(` ${w.word} `) && w.hex !== String(C.main).toLowerCase());
  c.second = st.woodLook && c.words[0]?.wood && w2 ? w2.hex : null;
  if (c.second) {
    c.secondMat = kit.mat.paint(c.second, { gloss: 0.25 });
    c.secondMetal = kit.mat.metal(c.second, { finish: 'painted' });
  }
  if (spec.kind === 'kitchen_cabinet' && c.has(/ (cuba|pia|tampo|bancada)( de| em)? inox /)) {
    // "cuba inox": o inox é da cuba/tampo, o corpo segue o padrão (MDF branco) se nenhuma outra cor foi citada
    if (c.mt === 'steel') c.mt = 'mdf';
    if (c.words.length && c.words.every((w) => w.word === 'inox') && String(C.main).toLowerCase() === c.words[0].hex) C.main = '#f0ede6';
    c.sinkInox = true;
  }
  c.body = bodyMat(c);
  c.wood = st.woodLook ? c.body : woodMat(c, C.wood, 'oak');
  c.metal = metalMat(c);
  c.pullMat = pullMatOf(c);
  c.pages = kit.mat.paint('#efe8d8', { gloss: 0.05 });
  c.dark = kit.mat.flat('#17130f', { roughness: 0.95 });
  return c;
}

/* ---------- materiais ---------- */
// Madeiras escuras: relevo do veio mais suave (o relevo fino reflete o ambiente e vira pontilhado)
const darkRelief = (kit, color) => (kit.luminance(color) < 0.3 ? 0.4 : undefined);
function woodMat(c, color, grain = 'oak') {
  // demolição: relevo mais contido (o relevo cheio vira um pontilhado de espuma nas bordas)
  const relief = grain === 'rustic' ? Math.min(0.55, darkRelief(c.kit, color) ?? 1) : darkRelief(c.kit, color);
  return c.m.wood(color, { grain, relief });
}
// Madeira de demolição: um pouco menos saturada (envelhecida), como nas fotos reais
const aged = (c, color) => c.kit.mix(color, '#8a7a62', 0.3);
function bodyMat(c) {
  const { st, C, m, kit } = c;
  const mt = c.mt;
  if (st.woodLook) {
    const grain = st.grain || (st.rustic ? 'rustic' : mt === 'wood' ? 'oak' : 'smooth');
    return woodMat(c, grain === 'rustic' ? aged(c, C.main) : C.main, grain);
  }
  if (mt === 'steel') return m.metal(C.main, { finish: 'brushed' });
  if (mt === 'metal') return m.metal(C.main, { finish: 'painted' });
  if (mt === 'lacquer' || st.gloss) return m.paint(C.main, { gloss: 0.85 });
  if (mt === 'plastic') return m.plastic(C.main, { gloss: 0.4 });
  // madeira maciça tingida de preto/escuro: veio discreto
  if (mt === 'wood' && kit.luminance(C.main) < 0.15) return woodMat(c, C.main, 'smooth');
  return m.paint(C.main, { gloss: 0.2 });
}
function metalMat(c) {
  const { m, C, kit } = c;
  if (c.has(/ dourad| ouro | gold | latao /)) return m.metal('#c2a46a', { finish: 'brushed' });
  if (c.has(/ cromad/)) return m.metal('#d6d8da', { finish: 'chrome' });
  if (c.has(/ (base|pes|estrutura) (de |em )?(metal|ferro|aco) branc/)) return m.metal('#ecebe7', { finish: 'painted' });
  // móvel de metal pintado (ex.: "estante de aço cinza"): a estrutura é a cor do produto
  if ((c.spec.material === 'metal' || c.spec.material === 'steel') && !c.st.woodLook && kit.luminance(C.main) < 0.85) return m.metal(C.main, { finish: c.spec.material === 'steel' ? 'brushed' : 'painted' });
  return m.metal(C.metal, { finish: 'painted' });
}
function pullMatOf(c) {
  const { m } = c;
  if (c.has(/ puxadores? (dourad|ouro|latao)|dourad/)) return m.metal('#c2a46a', { finish: 'brushed' });
  if (c.has(/ puxadores? pret/)) return m.metal('#1d1d1d', { finish: 'painted' });
  return m.metal('#c3c5c7', { finish: 'brushed' });
}
const isGlass = (c) => !!(c.st.glass || c.spec.material === 'glass');
const isMarble = (c) => !!(c.st.marble || c.spec.material === 'marble');
// Bicolor: o spec trouxe uma madeira diferente da padrão e o corpo não é amadeirado (ex.: "Off White e Freijó")
function twoTone(c) {
  const { st, C, spec, words } = c;
  if (st.twoTone != null) return !!st.twoTone;
  if (st.woodLook) return false;
  if (String(C.wood).toLowerCase() !== String(DEF_WOOD[spec.kind] || '').toLowerCase()) return true;
  return words.length >= 2 && !words[0].wood && words.slice(1).some((w) => w.wood);
}
// Mármore: cor citada logo depois de "mármore" no nome; senão branco (ou a cor clara do produto)
function marbleColor(c) {
  const { C, st, kit, spec, label } = c;
  const i = label.indexOf(' marmore ');
  if (i >= 0) {
    const words = [];
    for (const w of label.slice(i + 9).split(' ')) {
      if (!w || /^(base|pes|com|e|estrutura|de|em|tampo|e|cm|\d+)$/.test(w) || words.length >= 2) break;
      words.push(w);
    }
    const after = findColorWords(words.join(' '));
    if (after.length) return after[0].hex;
  }
  // (a cor principal só vale para a pedra se não for a cor do metal: "Pés de Metal Dourado")
  const metallicMain = c.words.some((w) => w.hex === String(C.main).toLowerCase() && METALLIC_WORD.test(` ${w.word} `));
  if (spec.material === 'marble' && !st.woodLook && !metallicMain && kit.luminance(C.main) > 0.5) return C.main;
  return kit.luminance(C.accent) > 0.6 ? C.accent : '#efede8';
}
// Base/estrutura de metal (pelo estilo ou pelo nome: "base metal", "pés de ferro", "base dourada", "pés cromados")
const metalBase = (c) => !!(c.st.legs === 'metal' || c.st.industrial || c.has(/ (base|pes|estrutura) (de |em )?(metal|ferro|aco|dourad|cromad|latao|bronze|cobre|inox)/));
// Ripado (frentes, painel ou tambor em ripas)
const isSlatted = (c) => !!(c.st.headboard === 'slats' || c.has(/ ripad/));
function topMat(c) {
  const { m, C, spec } = c;
  if (isGlass(c)) return m.glass({ tint: '#d3e2de', opacity: 0.4 });
  if (isMarble(c)) return m.marble(marbleColor(c));
  if (twoTone(c)) return woodMat(c, C.wood, spec.material === 'wood' ? 'oak' : 'smooth');
  return c.body;
}
// Tom mais escuro do mesmo material (fundo de nichos: simula a sombra interna)
function innerMat(c, mat) {
  const ud = mat?.userData || {};
  const col = c.kit.shade(ud.color || c.C.main, -0.2);
  if (ud.type === 'wood') return c.m.wood(col, { ...(ud.opts || {}) });
  if (ud.type === 'metal') return c.m.metal(col, ud.opts || {});
  return c.m.paint(col, { gloss: 0.1 });
}

/* ---------- geometria ---------- */
// Caixa pelos limites (x0..x1, y0..y1, z0..z1). Placas iguais (prateleiras, divisórias, frentes) reaproveitam
// a mesma geometria dentro do mesmo modelo: a caixa arredondada é a parte mais cara da montagem.
function boxAt(c, x0, x1, y0, y1, z0, z1, mat, opts = R2) {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const d = Math.abs(z1 - z0);
  const r = Math.min(opts.r ?? 0, w / 3, h / 3, d / 3);
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${r.toFixed(4)}|${opts.seg ?? ''}|${opts.grain ?? ''}|${opts.part ?? ''}|${mat?.uuid}`;
  const memo = c.boxMemo || (c.boxMemo = new Map());
  let b = memo.get(key);
  if (b) b = b.clone();
  else {
    b = c.kit.box(w, h, d, mat, { ...opts, r });
    memo.set(key, b);
  }
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return b;
}
// Contorno retangular com raio próprio por canto [inf.esq, inf.dir, sup.dir, sup.esq] (sem pontos repetidos)
function rectShape(THREE, x0, x1, y0, y1, radii = [0, 0, 0, 0]) {
  const lim = Math.min(x1 - x0, y1 - y0) / 2 - 1e-4;
  const [bl, br, tr, tl] = radii.map((r) => clamp(r || 0, 0, lim));
  const s = new THREE.Shape();
  const xm = (x0 + x1) / 2;
  s.moveTo(xm, y0);
  if (br > 1e-4) s.absarc(x1 - br, y0 + br, br, -Math.PI / 2, 0, false);
  else s.lineTo(x1, y0);
  if (tr > 1e-4) s.absarc(x1 - tr, y1 - tr, tr, 0, Math.PI / 2, false);
  else s.lineTo(x1, y1);
  if (tl > 1e-4) s.absarc(x0 + tl, y1 - tl, tl, Math.PI / 2, Math.PI, false);
  else s.lineTo(x0, y1);
  if (bl > 1e-4) s.absarc(x0 + bl, y0 + bl, bl, Math.PI, Math.PI * 1.5, false);
  else s.lineTo(x0, y0);
  s.lineTo(xm, y0);
  return s;
}
const rrect = (THREE, w, h, r = 0) => rectShape(THREE, -w / 2, w / 2, -h / 2, h / 2, [r, r, r, r]);
function ellipseShape(THREE, w, d) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, w / 2, d / 2, 0, Math.PI * 2, false, 0);
  return s;
}
// Tampo/placa deitada: contorno 2D (x, -z), espessura t, base em y = 0, borda arredondada sem mudar a medida
function plate(c, shape, t, mat, { bevel = 0.003, seg = 24, grain = 'x', part } = {}) {
  const { THREE, kit } = c;
  const b = clamp(bevel, 0, t / 2.2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, t - 2 * b),
    bevelEnabled: b > 1e-4,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: b > 0.006 ? 4 : 2,
    curveSegments: seg,
  });
  geo.rotateX(-Math.PI / 2); // extrusão vira altura; y do contorno vira -z
  geo.translate(0, b, 0);
  return kit.mesh(geo, mat, { grain, part });
}
// Prisma: contorno [[x, y], ...] no plano XY extrudado de z0 a z1
function prismZ(c, pts, z0, z1, mat, opts = {}) {
  const { THREE, kit } = c;
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: z1 - z0, bevelEnabled: false });
  geo.translate(0, 0, z0);
  return kit.mesh(geo, mat, opts);
}
// Prisma: contorno [[z, y], ...] no plano ZY extrudado de x0 a x1
function prismX(c, pts, x0, x1, mat, opts = {}) {
  const { THREE, kit } = c;
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), { depth: x1 - x0, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // (a, b, e) -> (-e, b, a)
  geo.translate(x1, 0, 0);
  return kit.mesh(geo, mat, opts);
}
// Concordância côncava (quarto de círculo) no canto (cx, cy), avançando para (sx, sy)
function filletPts(cx, cy, rf, sx, sy, n = 10) {
  const pts = [[cx, cy], [cx + sx * rf, cy]];
  const ox = cx + sx * rf;
  const oy = cy + sy * rf;
  for (let i = 1; i < n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([ox - sx * rf * Math.sin(a), oy - sy * rf * Math.cos(a)]);
  }
  pts.push([cx, cy + sy * rf]);
  return pts;
}
// Anel (aro) de seção retangular por revolução: raio interno ri, externo ro, de y0 a y1
function ring(c, ri, ro, y0, y1, mat, seg = 48) {
  return c.kit.lathe([[ri, y0], [ro, y0], [ro, y1], [ri, y1], [ri, y0]], mat, { seg });
}

// Madeira de demolição: a textura tem emendas de tábua a cada 1/3 do tile (10 cm). Numa face estreita
// (borda de tampo, coluna, sapata) uma emenda no meio parece placa colada; aqui as faces cuja direção V
// é curta (< 9 cm) são deslocadas em V para caber no meio de uma tábua só. As faces largas não mudam.
function calmSeams(geo, tv) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const groups = { x: [], y: [], z: [] };
  const AX = ['x', 'y', 'z'];
  const get = (i, a) => (a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i));
  for (let i = 0; i + 2 < pos.count; i += 3) {
    // eixo do mundo que o V acompanha neste triângulo (V = (eixo + deslocamento) / tv)
    let found = null;
    for (const a of AX) {
      let ok = true;
      let moves = false;
      for (const [p, q] of [[i, i + 1], [i + 1, i + 2]]) {
        const dv = (uv.getY(q) - uv.getY(p)) * tv;
        const da = get(q, a) - get(p, a);
        if (Math.abs(dv - da) > 1e-4) ok = false;
        if (Math.abs(da) > 1e-5) moves = true;
      }
      if (ok && moves) {
        found = a;
        break;
      }
    }
    if (found) groups[found].push(i);
  }
  for (const a of AX) {
    const tris = groups[a];
    if (!tris.length) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let vlo = Infinity;
    let vhi = -Infinity;
    for (const i of tris) {
      for (let k = 0; k < 3; k++) {
        lo = Math.min(lo, get(i + k, a));
        hi = Math.max(hi, get(i + k, a));
        vlo = Math.min(vlo, uv.getY(i + k));
        vhi = Math.max(vhi, uv.getY(i + k));
      }
    }
    if (hi - lo > 0.09) continue;
    const vc = (vlo + vhi) / 2;
    const base = Math.floor(vc);
    const band = Math.floor((vc - base) * 3);
    const shift = base + (band + 0.5) / 3 - vc;
    for (const i of tris) for (let k = 0; k < 3; k++) uv.setY(i + k, uv.getY(i + k) + shift);
  }
  uv.needsUpdate = true;
}

// Junta as malhas de mesmo material e mesma parte numa só (menos chamadas de desenho no celular e
// .glb menor). O vidro fica separado para a ordenação da transparência. kit.recolor continua valendo.
const KEEP_ATTRS = ['position', 'normal', 'uv'];
function consolidate(c, g) {
  const { THREE } = c;
  g.updateMatrixWorld(true);
  const buckets = new Map();
  const solo = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    const mt = o.material;
    // partes: corpo = 'main', estrutura metálica = 'metal', pés/madeira à parte = 'wood' (padrão do material)
    if (mt === c.body) o.userData.part = 'main';
    else if (mt === c.metal) o.userData.part = 'metal';
    else if (mt?.userData?.type === 'marble' || mt?.userData?.type === 'glass') o.userData.part = 'accent';
    if (Array.isArray(mt) || mt.transparent || !KEEP_ATTRS.every((a) => o.geometry.attributes[a])) {
      solo.push(o);
      return;
    }
    const key = `${mt.uuid}|${o.userData.part}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  const out = new THREE.Group();
  out.name = g.name;
  for (const list of buckets.values()) {
    const geos = list.map((o) => {
      // toNonIndexed já devolve cópias novas; só a geometria compartilhada (não indexada) precisa de clone
      const fresh = !!o.geometry.index;
      const src = fresh ? o.geometry.toNonIndexed() : o.geometry;
      const geo = new THREE.BufferGeometry();
      for (const a of KEEP_ATTRS) geo.setAttribute(a, fresh ? src.attributes[a] : src.attributes[a].clone());
      const ud = o.material?.userData;
      if (ud?.type === 'wood' && ud.opts?.grain === 'rustic') calmSeams(geo, ud.tile?.[1] || 0.3);
      geo.applyMatrix4(o.matrixWorld);
      return geo;
    });
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) {
      list.forEach((o) => solo.push(o));
      continue;
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.part = list[0].userData.part;
    out.add(mesh);
  }
  for (const o of solo) {
    const m = o.clone();
    o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    out.add(m);
  }
  return out;
}

/* ---------- pés ---------- */
function legKind(c, fallback = 'tapered') {
  const { st } = c;
  if (st.legType) return st.legType;
  if (st.legs === 'palito' || (st.retro && !st.legs)) return 'palito';
  if (st.legs === 'turned') return 'turned';
  if (st.legs === 'metal' || st.industrial) return c.has(/ hairpin | grampo /) ? 'metal_hairpin' : 'metal_square';
  if (st.legs === 'hidden') return 'none';
  // "pés de madeira": cônicos (no estilo retrô, palito)
  if (st.legs === 'wood') return fallback === 'palito' || fallback === 'turned' ? fallback : 'tapered';
  return fallback;
}
const isMetalLeg = (t) => String(t).startsWith('metal');
// Pés na segunda cor do nome ("Carvalho e Preto"), senão madeira/metal
// (palito e torneado são sempre de madeira)
const legMatOf = (c, type) => (c.second && type !== 'palito' && type !== 'turned' ? (isMetalLeg(type) ? c.secondMetal : c.secondMat) : isMetalLeg(type) ? c.metal : c.wood);
const SPLAY = { palito: 0.13 };
// Quanto o pé avança para fora (em x e em z) além do centro do topo
function legReach(type, h, r, splay = 0) {
  const out = splay ? h * Math.sin(splay) * Math.SQRT1_2 : 0;
  if (type === 'metal_hairpin') {
    const sp = Math.max(0.05, h * 0.18) + 0.015;
    return { x: 0.026, z: sp };
  }
  if (type === 'metal_square') return { x: Math.max(0.012, r) * 0.53, z: Math.max(0.012, r) * 0.53 };
  if (type === 'turned') return { x: r * 1.1, z: r * 1.1 };
  return { x: Math.max(r, out + r * 0.62), z: Math.max(r, out + r * 0.62) };
}
// 4 pés: (hx, hz) = posição do topo de cada pé a partir de (cx, cz)
function legs4(c, g, { hx, hz, h, type, r, mat, splay, cx = 0, cz = 0 }) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const l = c.kit.leg(type, { h, r, material: mat || legMatOf(c, type), dir: [sx, sz], splay: splay ?? 0 });
    if (type === 'metal_hairpin') l.rotation.y = Math.PI / 2; // grampo no sentido da profundidade
    l.position.set(cx + sx * hx, 0, cz + sz * hz);
    g.add(l);
  }
}
// Rodapé recuado (base escura), usado quando o móvel não tem pés
function plinth(c, g, x0, x1, h, zb, zf, inset = 0.03) {
  g.add(boxAt(c, x0 + inset * 0.5, x1 - inset * 0.5, 0, h + 0.002, zb + 0.01, zf - inset, c.dark, { r: 0 }));
}
// Base do móvel (pés ou rodapé) para um corpo de x0..x1 e zb..zf; devolve a altura da base
function baseUnder(c, g, { x0, x1, zb, zf, type, h }) {
  if (type === 'none') {
    plinth(c, g, x0, x1, h, zb, zf);
    return h;
  }
  const r = type === 'palito' ? 0.02 : type === 'metal_square' ? 0.018 : 0.022;
  const splay = SPLAY[type] || 0;
  const reach = legReach(type, h, r, splay);
  const hx = (x1 - x0) / 2 - Math.max(reach.x, 0.035) - 0.012;
  const hz = (zf - zb) / 2 - Math.max(reach.z, 0.03) - 0.01;
  if (hx < 0.02 || hz < 0.005) {
    plinth(c, g, x0, x1, h, zb, zf, Math.min(0.03, (zf - zb) * 0.2));
    return h;
  }
  legs4(c, g, { hx, hz, h: h + 0.002, type, r, splay, cx: (x0 + x1) / 2, cz: (zb + zf) / 2 });
  return h;
}

/* ---------- puxadores e frentes ---------- */
function pullType(c, fallback) {
  if (c.st.handle) return c.st.handle;
  if (c.has(/ cava | cavas | sem puxador| fecho toque | push /)) return 'cutout';
  if (c.has(/ puxadores? de couro | alcas? de couro /)) return 'leather_strap';
  if (c.has(/ puxadores? (bola|botao|redondos?)| knob /)) return 'knob';
  if (c.has(/ perfil /)) return 'profile';
  return fallback;
}
const pullDepth = (type) => PULL_DEPTH[type] ?? 0.028;
// Puxador centrado em (x, y) na face z; vertical = barra em pé; w = largura (perfil)
function addPull(c, g, type, { x, y, z, len = 0.12, vertical = false, w = 0.3, room = 1 }) {
  if (!type || type === 'none') return;
  if (type === 'profile') {
    g.add(boxAt(c, x - w / 2, x + w / 2, y - 0.007, y + 0.007, z, z + 0.012, c.pullMat, { r: 0.002, seg: 2 }));
    return;
  }
  const size = type === 'knob' ? Math.min(0.012, room / 2.3) : 0.012;
  const h = c.kit.handle(type, { material: type === 'cutout' ? undefined : c.pullMat, len, size });
  if (vertical) h.rotation.z = Math.PI / 2;
  h.position.set(x, y, z);
  g.add(h);
}
// Frente de porta/gaveta cobrindo [x0,x1]x[y0,y1] com a face de trás em z.
// style: 'flat' | 'shaker' (quadro e almofada) | 'glass' | 'cane' (palhinha) | 'slats' (ripado) | 'mirror'
function frontPanel(c, g, { x0, x1, y0, y1, z, t = 0.018, mat, style = 'flat', gap = 0.003 }) {
  const { m } = c;
  const w = x1 - x0 - gap;
  const h = y1 - y0 - gap;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const xa = cx - w / 2;
  const xb = cx + w / 2;
  const ya = cy - h / 2;
  const yb = cy + h / 2;
  if (style === 'flat' || w < 0.1 || h < 0.1) {
    g.add(boxAt(c, xa, xb, ya, yb, z, z + t, mat));
    return;
  }
  const fr = Math.min(0.06, w * 0.17, h * 0.17);
  const frame = () => {
    g.add(boxAt(c, xa, xb, yb - fr, yb, z, z + t, mat));
    g.add(boxAt(c, xa, xb, ya, ya + fr, z, z + t, mat));
    g.add(boxAt(c, xa, xa + fr, ya + fr, yb - fr, z, z + t, mat));
    g.add(boxAt(c, xb - fr, xb, ya + fr, yb - fr, z, z + t, mat));
  };
  if (style === 'shaker') {
    frame();
    g.add(boxAt(c, xa + fr - 0.001, xb - fr + 0.001, ya + fr - 0.001, yb - fr + 0.001, z, z + t * 0.55, mat));
  } else if (style === 'glass') {
    frame();
    g.add(boxAt(c, xa + fr - 0.004, xb - fr + 0.004, ya + fr - 0.004, yb - fr + 0.004, z + t * 0.35, z + t * 0.35 + 0.004, m.glass({ tint: '#d9e2e0', opacity: 0.26 }), { r: 0 }));
  } else if (style === 'cane') {
    frame();
    g.add(boxAt(c, xa + fr - 0.004, xb - fr + 0.004, ya + fr - 0.004, yb - fr + 0.004, z + t * 0.25, z + t * 0.25 + 0.005, m.cane('#d4b37e'), { r: 0 }));
    g.add(boxAt(c, xa + fr, xb - fr, ya + fr, yb - fr, z, z + 0.003, c.dark, { r: 0 }));
  } else if (style === 'mirror') {
    g.add(boxAt(c, xa, xb, ya, yb, z, z + t, mat));
    g.add(boxAt(c, xa + 0.03, xb - 0.03, ya + 0.04, yb - 0.04, z + t, z + t + 0.004, m.metal('#e3eaee', { finish: 'chrome' }), { r: 0, part: 'detail' }));
  } else if (style === 'slats') {
    g.add(boxAt(c, xa, xb, ya, yb, z, z + t * 0.5, innerMat(c, mat), { r: 0 }));
    const sw = 0.024;
    const n = Math.max(2, Math.round((w + 0.012) / (sw + 0.012)));
    const step = w / n;
    for (let i = 0; i < n; i++) {
      const x = xa + step * (i + 0.5);
      g.add(boxAt(c, x - Math.min(sw, step * 0.68) / 2, x + Math.min(sw, step * 0.68) / 2, ya, yb, z + t * 0.5, z + t, mat, { r: 0, grain: 'y' }));
    }
  } else {
    g.add(boxAt(c, xa, xb, ya, yb, z, z + t, mat));
  }
}
// Estilo das frentes a partir do spec
function frontStyle(c, fallback = 'flat') {
  const { st } = c;
  if (st.front) return st.front;
  if (st.cane) return 'cane';
  if (st.headboard === 'slats' || c.has(/ ripad/)) return 'slats';
  if (c.has(/ provencal | classic[oa] | colonial /)) return 'shaker';
  return fallback;
}

/* ---------- corpo em placas com módulos ---------- */
// Móvel em módulos (rack, buffet, balcão, armário). Monta laterais, tampo, base, fundo e divisões
// e preenche cada módulo: { w (fração), type: 'doors'|'drawers'|'niche'|'glass'|'rows', n, shelves, rows }
// rows: [{ f (fração da altura), type, n }] de baixo para cima. Frentes sobrepostas (cobrem as bordas).
function caseRow(c, g, o) {
  const t = o.t ?? 0.018;
  const mat = o.mat || c.body;
  // frentes na segunda cor do nome ("Freijó e Off White": corpo freijó, portas off white)
  const fm = o.frontMat || (c.second ? c.secondMat : mat);
  const inner = o.inner || innerMat(c, mat);
  const ft = o.ft ?? 0.018;
  const { x0, x1, y0, y1, zb, zf } = o;
  const pull = o.pull ?? 'bar';
  const style = o.style || 'flat';
  const bt = 0.006; // fundo
  if (o.top !== false) g.add(boxAt(c, x0, x1, y1 - t, y1, zb, zf, o.topMat || mat));
  g.add(boxAt(c, x0, x0 + t, y0, o.top !== false ? y1 - t : y1, zb, zf, mat, { ...R2, grain: 'y' }));
  g.add(boxAt(c, x1 - t, x1, y0, o.top !== false ? y1 - t : y1, zb, zf, mat, { ...R2, grain: 'y' }));
  g.add(boxAt(c, x0 + t, x1 - t, y0, y0 + t, zb, zf, mat));
  const yIn0 = y0 + t;
  const yIn1 = o.top !== false ? y1 - t : y1;
  if (o.back !== false) g.add(boxAt(c, x0 + t, x1 - t, yIn0, yIn1, zb, zb + bt, inner, { r: 0 }));
  // módulos
  const mods = o.mods || [{ w: 1, type: 'doors', n: 1 }];
  const sum = mods.reduce((s, md) => s + (md.w || 1), 0);
  let xa = x0;
  const bounds = mods.map((md) => {
    const w = ((x1 - x0) * (md.w || 1)) / sum;
    const b = [xa, xa + w];
    xa += w;
    return b;
  });
  const fronts = [];
  bounds.forEach(([ma, mb], i) => {
    const md = mods[i];
    if (i > 0) g.add(boxAt(c, ma - t / 2, ma + t / 2, yIn0, yIn1, zb + bt, zf, mat, { ...R2, grain: 'y' }));
    // região interna (entre placas) e região da frente (sobreposta)
    const ia = i === 0 ? ma + t : ma + t / 2;
    const ib = i === mods.length - 1 ? mb - t : mb - t / 2;
    const fa = i === 0 ? ma : ma + 0.0015;
    const fb = i === mods.length - 1 ? mb : mb - 0.0015;
    const rows = md.type === 'rows' ? md.rows : [{ f: 1, ...md }];
    const fsum = rows.reduce((s, r) => s + (r.f || 1), 0);
    let ry = y0;
    rows.forEach((row, k) => {
      const hRow = ((y1 - y0) * (row.f || 1)) / fsum;
      const fy0 = ry;
      const fy1 = ry + hRow;
      ry = fy1;
      const iy0 = k === 0 ? yIn0 : fy0 + t / 2;
      const iy1 = k === rows.length - 1 ? yIn1 : fy1 - t / 2;
      if (k > 0) g.add(boxAt(c, ia, ib, fy0 - t / 2, fy0 + t / 2, zb + bt, zf, mat));
      fronts.push({ type: row.type, n: row.n || 1, fa, fb, fy0: k === 0 ? y0 : fy0 + 0.0015, fy1: k === rows.length - 1 ? y1 : fy1 - 0.0015, ia, ib, iy0, iy1, row });
    });
  });
  const zF = zf;
  for (const f of fronts) {
    const { type, n, fa, fb, fy0, fy1, ia, ib, iy0, iy1, row } = f;
    if (type === 'niche' || type === 'glass' || type === 'open') {
      const shelves = row.shelves ?? (iy1 - iy0 > 0.55 ? Math.max(1, Math.round((iy1 - iy0) / 0.32) - 1) : 0);
      const levels = [iy0];
      for (let s = 1; s <= shelves; s++) {
        const y = iy0 + ((iy1 - iy0) * s) / (shelves + 1);
        g.add(boxAt(c, ia, ib, y - t / 2, y + t / 2, zb + bt, zf - 0.004, row.glassShelves ? c.m.glass({ tint: '#d9e2e0', opacity: 0.3 }) : mat, row.glassShelves ? { r: 0 } : R2));
        levels.push(y + t / 2);
      }
      if (row.led || (o.led && type !== 'glass')) ledStrip(c, g, ia + 0.01, ib - 0.01, iy1 - 0.004, zf - 0.03);
      if (o.fill) {
        levels.forEach((y, s) => {
          const top = s < levels.length - 1 ? levels[s + 1] - t : iy1;
          o.fill({ x0: ia, x1: ib, y, h: top - y, zb: zb + bt, zf: zf - 0.01, kind: type, row });
        });
      }
      if (type === 'glass') {
        const w = (fb - fa) / n;
        for (let k = 0; k < n; k++) {
          frontPanel(c, g, { x0: fa + k * w, x1: fa + (k + 1) * w, y0: fy0, y1: fy1, z: zF, t: ft, mat: fm, style: 'glass' });
          doorPull(c, g, pull, { x0: fa + k * w, x1: fa + (k + 1) * w, y0: fy0, y1: fy1, z: zF + ft, side: n === 1 ? (row.side || 'right') : k % 2 === 0 ? 'right' : 'left', pos: o.pullPos });
        }
      }
      continue;
    }
    if (type === 'drawers') {
      const hh = (fy1 - fy0) / n;
      for (let k = 0; k < n; k++) {
        const a = fy0 + k * hh;
        const b = a + hh;
        frontPanel(c, g, { x0: fa, x1: fb, y0: a, y1: b, z: zF, t: ft, mat: fm, style: row.style || (style === 'slats' || style === 'glass' || style === 'mirror' ? 'flat' : style) });
        drawerPull(c, g, pull, { x0: fa, x1: fb, y0: a, y1: b, z: zF + ft });
      }
      continue;
    }
    // porta basculante (abre para cima): puxador deitado, centrado perto da borda de baixo
    if (type === 'flap') {
      frontPanel(c, g, { x0: fa, x1: fb, y0: fy0, y1: fy1, z: zF, t: ft, mat: fm, style: row.style || style });
      if (pull === 'profile') addPull(c, g, 'profile', { x: (fa + fb) / 2, y: fy0 + 0.01, z: zF + ft - 0.006, w: fb - fa - 0.006 });
      else if (pull && pull !== 'none') addPull(c, g, pull, { x: (fa + fb) / 2, y: fy0 + (pull === 'cutout' ? 0.025 : 0.04), z: zF + ft, len: clamp((fb - fa) * 0.35, 0.08, 0.32) });
      continue;
    }
    // portas
    const w = (fb - fa) / n;
    for (let k = 0; k < n; k++) {
      const a = fa + k * w;
      const b = a + w;
      const side = n === 1 ? row.side || 'right' : k % 2 === 0 ? 'right' : 'left';
      frontPanel(c, g, { x0: a, x1: b, y0: fy0, y1: fy1, z: zF, t: ft, mat: fm, style: row.style || style });
      doorPull(c, g, pull, { x0: a, x1: b, y0: fy0, y1: fy1, z: zF + ft, side, pos: o.pullPos });
    }
  }
  return { zFront: zf + ft, yIn0, yIn1 };
}
// Puxador de porta: side = lado de abrir (onde fica o puxador)
function doorPull(c, g, type, { x0, x1, y0, y1, z, side, pos = 'top' }) {
  if (!type || type === 'none') return;
  const h = y1 - y0;
  const x = side === 'left' ? x0 + 0.035 : x1 - 0.035;
  if (type === 'profile') {
    addPull(c, g, type, { x: (x0 + x1) / 2, y: y1 - 0.01, z: z - 0.006, w: x1 - x0 - 0.006 });
    return;
  }
  if (type === 'cutout') {
    addPull(c, g, 'cutout', { x, y: pos === 'bottom' ? y0 + Math.min(0.1, h * 0.3) : y1 - Math.min(0.1, h * 0.3), z, len: Math.min(0.14, h * 0.4), vertical: true });
    return;
  }
  if (type === 'knob') {
    addPull(c, g, 'knob', { x, y: pos === 'bottom' ? y0 + 0.06 : pos === 'mid' ? (y0 + y1) / 2 : y1 - Math.min(0.08, h * 0.25), z });
    return;
  }
  const len = clamp(h * 0.32, 0.08, 0.3);
  let y = pos === 'bottom' ? y0 + len / 2 + 0.04 : pos === 'mid' ? (y0 + y1) / 2 : y1 - len / 2 - 0.04;
  if (pos === 'hand') y = clamp(1.0, y0 + len / 2 + 0.04, y1 - len / 2 - 0.04);
  addPull(c, g, type, { x, y, z, len, vertical: true });
}
function drawerPull(c, g, type, { x0, x1, y0, y1, z }) {
  if (!type || type === 'none') return;
  const w = x1 - x0;
  const h = y1 - y0;
  if (type === 'profile') {
    addPull(c, g, type, { x: (x0 + x1) / 2, y: y1 - 0.01, z: z - 0.006, w: w - 0.006 });
    return;
  }
  const y = type === 'cutout' ? y1 - Math.min(0.03, h * 0.2) : (y0 + y1) / 2 + (h > 0.24 ? h * 0.22 : 0);
  if (type === 'knob' && w > 0.7) {
    for (const k of [-0.25, 0.25]) addPull(c, g, 'knob', { x: (x0 + x1) / 2 + k * w, y, z });
    return;
  }
  addPull(c, g, type, { x: (x0 + x1) / 2, y, z, len: clamp(w * 0.35, 0.08, 0.32) });
}
// Fita de LED embutida (emissiva)
function ledStrip(c, g, x0, x1, y, z) {
  g.add(boxAt(c, x0, x1, y - 0.004, y, z - 0.006, z, c.m.flat('#fff4dc', { emissive: '#ffe1a6' }), { r: 0, part: 'detail' }));
}

/* ---------- objetos decorativos (livros, vasos, plantas) ---------- */
// Limite de livros por modelo: numa estante enorme (6 x 6 nichos) os livros eram a maior parte do tempo
// de montagem; passando do limite, os nichos seguintes ficam com vasos/plantas ou vazios
const BOOK_CAP = 140;
const booksFull = (c) => (c.books || 0) >= BOOK_CAP;
function book(c, g, { x, y, z, w, h, d, color, rz = 0 }) {
  const { kit, m } = c;
  c.books = (c.books || 0) + 1;
  const b = kit.group('livro');
  b.add(kit.box(w, h, d, m.paint(color, { gloss: 0.15 }), { part: 'detail' }));
  if (w > 0.008) {
    const pg = kit.box(Math.max(0.003, w - 0.003), h + 0.0016, Math.max(0.01, d - 0.008), c.pages, { part: 'detail' });
    pg.position.z = -0.002;
    b.add(pg);
  }
  b.position.set(x, y, z);
  b.rotation.z = rz;
  g.add(b);
}
// Fileira de livros de x0 até no máximo x1 sobre y (z de trás zb); retorna o x final
function bookRow(c, g, { x0, x1, y, hMax, zb, dMax, lean = true, dir = 1 }) {
  const { r } = c;
  if (hMax < 0.1 || dMax < 0.08) return x0;
  let x = dir > 0 ? x0 : x1;
  let n = 0;
  const lim = c.rowCap || 60;
  let prevH = 0;
  while (n < lim) {
    const w = 0.014 + r() * 0.028;
    const h = Math.min(hMax * 0.86, 0.16 + r() * 0.11);
    const d = Math.min(dMax - 0.004, 0.12 + r() * 0.08);
    if ((dir > 0 ? x + w > x1 : x - w < x0) || booksFull(c)) break;
    const cx = dir > 0 ? x + w / 2 : x - w / 2;
    book(c, g, { x: cx, y: y + h / 2, z: zb + 0.004 + d / 2, w, h, d, color: r.pick(BOOK_COLORS) });
    x += dir * (w + 0.0008);
    prevH = h;
    n++;
    if (n > 4 && r() < 0.1) break;
  }
  // o último inclinado, apoiado no anterior
  if (lean && n > 2 && r() < 0.7) {
    const w = 0.02 + r() * 0.015;
    const h = Math.min(hMax - 0.02, prevH * (0.85 + r() * 0.1));
    const d = Math.min(dMax - 0.004, 0.13 + r() * 0.06);
    const th = 0.14 + r() * 0.14;
    const reach = w * Math.cos(th) + h * Math.sin(th);
    if (h * Math.cos(th) + w * Math.sin(th) < hMax - 0.005 && (dir > 0 ? x + reach < x1 : x - reach > x0)) {
      // pivô no canto de baixo do lado de fora
      const px = dir > 0 ? x + h * Math.sin(th) + 0.001 : x - h * Math.sin(th) - 0.001;
      const a = dir > 0 ? th : -th;
      const ox = dir > 0 ? (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th) : -(w / 2) * Math.cos(th) + (h / 2) * Math.sin(th);
      const oy = (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th);
      book(c, g, { x: px + ox, y: y + oy, z: zb + 0.004 + d / 2, w, h, d, color: r.pick(BOOK_COLORS), rz: a });
      x = dir > 0 ? px + w * Math.cos(th) : px - w * Math.cos(th);
    }
  }
  return x;
}
// Pilha de livros deitados
function bookStack(c, g, { x, y, z, wMax, dMax, hMax }) {
  const { r } = c;
  const n = 2 + Math.floor(r() * 3);
  let yy = y;
  for (let i = 0; i < n; i++) {
    const t = 0.018 + r() * 0.02;
    if (yy + t > y + hMax || booksFull(c)) break;
    const w = Math.min(wMax, 0.16 + r() * 0.08);
    const d = Math.min(dMax, 0.12 + r() * 0.07);
    book(c, g, { x: x + (r() - 0.5) * 0.01, y: yy + t / 2, z, w, h: t, d, color: r.pick(BOOK_COLORS) });
    yy += t;
  }
  return yy - y;
}
function vase(c, g, { x, y, z, h, rMax, color }) {
  const R = Math.min(rMax, h * 0.3);
  const prof = [[0.0001, 0], [R * 0.6, 0], [R * 0.92, h * 0.16], [R, h * 0.4], [R * 0.78, h * 0.7], [R * 0.42, h * 0.86], [R * 0.46, h], [R * 0.38, h], [0.0001, h * 0.9]];
  const v = c.kit.lathe(prof, c.m.plastic(color, { gloss: 0.7 }), { seg: 28, part: 'detail' });
  v.position.set(x, y, z);
  g.add(v);
}
function plant(c, g, { x, y, z, h, rMax }) {
  const { kit, m } = c;
  const potH = h * 0.38;
  const pr = Math.min(rMax * 0.75, h * 0.2);
  const pot = kit.lathe([[0.0001, 0], [pr * 0.75, 0], [pr, potH * 0.92], [pr * 1.02, potH], [0.0001, potH]], m.plastic('#d8d2c8', { gloss: 0.3 }), { seg: 24, part: 'detail' });
  pot.position.set(x, y, z);
  g.add(pot);
  const leaf = m.flat('#47613d', { roughness: 0.85 });
  const fr = Math.min(rMax, (h - potH) * 0.42);
  const pts = [[0, 0.62, 0], [-0.45, 0.42, 0.1], [0.45, 0.44, -0.1], [0.1, 0.38, 0.45], [-0.1, 0.4, -0.45]];
  pts.forEach(([ax, ay, az], i) => {
    const s = kit.sphere(fr * (i === 0 ? 0.8 : 0.62), leaf, { seg: 12, part: 'detail' });
    s.position.set(x + ax * fr, y + potH + ay * (h - potH) * 0.95 - fr * 0.1, z + az * fr);
    g.add(s);
  });
}
// Preenche um nicho/compartimento com livros e objetos (determinístico pela semente)
function fillCompartment(c, g, { x0, x1, y, h, zb, zf, density = 1 }) {
  const { r } = c;
  const w = x1 - x0;
  const d = zf - zb;
  if (h < 0.12 || w < 0.14 || d < 0.12) return;
  const p = r();
  if (p > 0.85 * density + 0.05) return; // vazio de vez em quando
  const small = w < 0.5 && h < 0.3;
  if (p < 0.55 * density && h > 0.2 && !small) {
    const left = r() < 0.5;
    const span = w * (0.45 + r() * 0.4);
    const end = bookRow(c, g, left ? { x0: x0 + 0.01, x1: x0 + 0.01 + span, y, hMax: h, zb, dMax: d } : { x0: x1 - 0.01 - span, x1: x1 - 0.01, y, hMax: h, zb, dMax: d, dir: -1 });
    const free = left ? x1 - end : end - x0;
    if (free > 0.14 && r() < 0.75) {
      const cx = left ? (end + x1) / 2 : (x0 + end) / 2;
      if (r() < 0.5) vase(c, g, { x: cx, y, z: zb + d * 0.5, h: Math.min(h * 0.75, 0.24), rMax: Math.min(free * 0.3, d * 0.35), color: r.pick(['#e9e4da', '#2b2b2b', '#b5703a', '#7f8c7a']) });
      else bookStack(c, g, { x: cx, y, z: zb + d * 0.5, wMax: free * 0.8, dMax: d * 0.8, hMax: h * 0.4 });
    }
  } else if (small && h > 0.12) {
    // nicho pequeno: um objeto só, proporcional ao vão
    const cx = x0 + w * (0.4 + r() * 0.2);
    if (r() < 0.5) plant(c, g, { x: cx, y, z: zb + d * 0.5, h: Math.min(h * 0.7, 0.2), rMax: Math.min(w * 0.18, d * 0.3) });
    else vase(c, g, { x: cx, y, z: zb + d * 0.5, h: Math.min(h * 0.65, 0.18), rMax: Math.min(w * 0.14, d * 0.25), color: r.pick(['#e9e4da', '#2b2b2b', '#b5703a', '#7f8c7a']) });
  } else if (h > 0.16) {
    const cx = x0 + w * (0.3 + r() * 0.4);
    if (r() < 0.5) plant(c, g, { x: cx, y, z: zb + d * 0.5, h: Math.min(h * 0.85, 0.32), rMax: Math.min(w * 0.3, d * 0.42) });
    else {
      const sh = bookStack(c, g, { x: cx, y, z: zb + d * 0.5, wMax: w * 0.5, dMax: d * 0.8, hMax: h * 0.35 });
      if (h - sh > 0.12) vase(c, g, { x: cx, y: y + sh, z: zb + d * 0.5, h: Math.min((h - sh) * 0.7, 0.18), rMax: Math.min(w * 0.18, d * 0.3), color: r.pick(['#e9e4da', '#2b2b2b', '#a9b4a5']) });
    }
  }
}

/* ================================================================== */
/* Mesas                                                               */
/* ================================================================== */
// Base cilíndrica/tambor sem formato no nome: tampo redondo (ou oval) sobre tambor
const isDrum = (c) => !c.st.shape && c.has(/ cilindr| tambor /);
const isNesting = (c) => !!(c.st.nesting || c.has(/ ninho | nesting | conjunto (de )?(2|3|duas|tres) mesas | kit (com )?(2|3) mesas | par de mesas | (2|3) mesas de (centro|apoio|canto) /) || (c.has(/ (conjunto|kit|jogo) /) && c.has(/ (2|3|duas|tres) (pecas|mesas) /)));

// Mesa de madeira maciça "em bloco": tampo grosso, prateleira inferior, colunas nos cantos com
// aberturas de cantos curvos e sapatas (ex.: mesa de centro rústica de demolição)
function blockTable(c, g) {
  const { THREE, W, H, D } = c;
  const body = c.body;
  const fh = clamp(H * 0.12, 0.025, 0.06);
  const bodyH = H - fh;
  const tt = clamp(bodyH * 0.23, 0.03, 0.08);
  const bt = clamp(bodyH * 0.17, 0.025, 0.06);
  const yb = fh + bt;
  const yt = H - tt;
  const oh = yt - yb;
  const px = clamp(W * 0.075, 0.045, 0.1);
  const pz = clamp(D * 0.12, 0.045, 0.09);
  const rf = Math.max(0.006, Math.min(oh * 0.36, (W - 2 * px) * 0.2, (D - 2 * pz) * 0.2, 0.07));
  const pr = Math.min(0.025, W * 0.03, D * 0.03);
  // tampo e prateleira inteiros
  const tb = Math.min(0.012, tt * 0.2);
  const bb = Math.min(0.006, bt * 0.14);
  g.add(c.kit.place(plate(c, rrect(THREE, W, D, pr), tt, body, { bevel: tb }), { y: yt }));
  g.add(c.kit.place(plate(c, rrect(THREE, W, D, pr), bt, body, { bevel: bb }), { y: fh }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const xo = (sx * W) / 2;
      const xi = sx * (W / 2 - px);
      const zo = (sz * D) / 2;
      const zi = sz * (D / 2 - pz);
      const x0 = Math.min(xo, xi);
      const x1 = Math.max(xo, xi);
      const z0 = Math.min(zo, zi);
      const z1 = Math.max(zo, zi);
      // coluna com o canto externo arredondado como o tampo (contorno em x, -z)
      const radii = [0, 0, 0, 0];
      radii[sz > 0 ? (sx > 0 ? 1 : 0) : sx > 0 ? 2 : 3] = pr;
      // a coluna entra no arredondado do tampo e da prateleira: a quina externa fica contínua (peça única)
      g.add(c.kit.place(plate(c, rectShape(THREE, x0, x1, -z1, -z0, radii), oh + tb + bb, body, { bevel: 0.0015, grain: 'y', seg: 8 }), { y: yb - bb }));
      // cantos curvos da abertura da frente/fundo (ao longo de z) e das pontas (ao longo de x)
      g.add(prismZ(c, filletPts(xi, yb, rf, -sx, 1), z0, z1, body));
      g.add(prismZ(c, filletPts(xi, yt, rf, -sx, -1), z0, z1, body));
      g.add(prismX(c, filletPts(zi, yb, rf, -sz, 1), x0, x1, body));
      g.add(prismX(c, filletPts(zi, yt, rf, -sz, -1), x0, x1, body));
    }
  }
  // sapatas trapezoidais no sentido da profundidade
  const fw = clamp(W * 0.065, 0.04, 0.09);
  const fl = D - 2 * clamp(D * 0.09, 0.03, 0.07);
  const fx = W / 2 - clamp(W * 0.15, 0.08, 0.2);
  for (const sx of [-1, 1]) {
    const pts = [[-fw * 0.37, 0], [fw * 0.37, 0], [fw / 2, fh + 0.003], [-fw / 2, fh + 0.003]];
    g.add(c.kit.place(prismZ(c, pts, -fl / 2, fl / 2, body, { grain: 'z' }), { x: sx * fx }));
  }
}

// Mesa clássica: tampo, saia, 4 pés (palito, cônico, torneado), prateleira/gavetas/nicho opcionais.
// kind: 'coffee' | 'side' | 'dining' | 'console'
function classicTable(c, g, kind, opt = {}) {
  const { THREE, kit, st, W, H, D } = c;
  const glass = isGlass(c);
  const tm = topMat(c);
  const dining = kind === 'dining';
  const cons = kind === 'console';
  // mesa de jantar rústica (demolição, maciça rústica): tampo grosso e pés quadrados robustos
  const rustic = dining && !!st.rustic && !glass;
  const tt = glass ? clamp(H * 0.02, 0.008, 0.012) : rustic ? clamp(H * 0.075, 0.045, 0.065) : clamp(H * (dining ? 0.045 : cons ? 0.04 : 0.065), 0.02, dining ? 0.045 : 0.038);
  const type = opt.legType || legKind(c, rustic ? 'square' : 'tapered');
  const legH = H - tt;
  // pés escondidos: base maciça recuada
  if (type === 'none') {
    g.add(kit.place(plate(c, rrect(THREE, W, D, 0.01), tt, tm, { bevel: Math.min(0.004, tt * 0.25) }), { y: H - tt }));
    g.add(boxAt(c, -W / 2 + 0.05, W / 2 - 0.05, 0, legH + 0.001, -D / 2 + 0.05, D / 2 - 0.05, c.body));
    return;
  }
  // mesa de jantar grande pede pés mais grossos (220 x 100 não fica em pés de 4 cm)
  const r = opt.r ?? (rustic && type === 'square' ? clamp(Math.min(W, D) * 0.05, 0.035, 0.055) : dining ? clamp(Math.max(H * 0.032, Math.min(W, D) * 0.03) * (type === 'turned' ? 1.15 : 1), 0.018, 0.04) : clamp(Math.min(W, D) * 0.045, 0.013, type === 'palito' ? 0.022 : 0.024));
  const splay = SPLAY[type] || 0;
  const reach = legReach(type, legH, r, splay);
  const ov = dining ? clamp(Math.min(W, D) * 0.05, 0.02, 0.06) : clamp(Math.min(W, D) * 0.04, 0.012, 0.035);
  const inX = Math.max(ov + r, reach.x + 0.004);
  const inZ = Math.max(ov + r, reach.z + 0.004);
  const hx = W / 2 - inX;
  const hz = D / 2 - inZ;
  // tampo
  const cr = glass ? 0.012 : Math.min(0.012, Math.min(W, D) * 0.03);
  g.add(kit.place(plate(c, rrect(THREE, W, D, cr), tt, tm, { bevel: glass ? 0.002 : Math.min(0.005, tt * 0.25) }), { y: H - tt }));
  // saia (no vidro vira o quadro aparente)
  const drawers = cons ? st.drawers ?? (W >= 0.7 ? (W > 1.3 ? 3 : 2) : 1) : st.drawers || 0;
  let ah = dining ? clamp(legH * 0.11, 0.06, 0.09) : clamp(legH * 0.16, 0.035, 0.08);
  if (drawers) ah = clamp(legH * 0.2, 0.09, 0.15);
  if (st.niche && !drawers && !dining) ah = clamp(legH * 0.3, 0.1, 0.18);
  const at = 0.02;
  const ay1 = H - tt;
  const ay0 = ay1 - ah;
  const apronMat = glass ? (type.startsWith('metal') ? c.metal : c.wood) : c.secondMat || c.body;
  const ex = hx + r - 0.006; // face externa da saia
  const ez = hz + r - 0.006;
  const isNiche = st.niche && !drawers && !dining;
  if (!st.noApron && legH > 0.2) {
    // fundo e laterais
    g.add(boxAt(c, -hx, hx, ay0, ay1, -ez, -ez + at, apronMat));
    g.add(boxAt(c, -ex, -ex + at, ay0, ay1, -hz, hz, apronMat, { ...R2, grain: 'z' }));
    g.add(boxAt(c, ex - at, ex, ay0, ay1, -hz, hz, apronMat, { ...R2, grain: 'z' }));
    if (drawers) {
      // frente com gavetas
      const room = D / 2 - ez;
      const pt = pullType(c, room > 0.03 ? 'knob' : 'cutout');
      const n = Math.max(1, Math.min(4, drawers));
      const span = 2 * hx;
      g.add(boxAt(c, -hx, hx, ay0, ay0 + 0.012, -ez, ez - 0.002, apronMat)); // fundo das gavetas
      for (let i = 0; i < n; i++) {
        const a = -hx + (span * i) / n;
        const b = a + span / n;
        frontPanel(c, g, { x0: a, x1: b, y0: ay0, y1: ay1 - 0.002, z: ez - at, t: at, mat: c.body, style: frontStyle(c) === 'cane' ? 'cane' : 'flat' });
        drawerPull(c, g, pt === 'knob' || pt === 'bar' ? (room > 0.03 ? pt : 'cutout') : pt, { x0: a, x1: b, y0: ay0, y1: ay1, z: ez });
      }
    } else if (!isNiche) g.add(boxAt(c, -hx, hx, ay0, ay1, ez - at, ez, apronMat));
    if (isNiche) {
      // nicho aberto na frente: fundo do nicho
      g.add(boxAt(c, -ex, ex, ay0, ay0 + 0.016, -ez, ez, c.body));
    }
  }
  // pés
  legs4(c, g, { hx, hz, h: legH + 0.001, type, r, splay, mat: legMatOf(c, type) });
  // mesa de jantar muito longa (> 2,4 m): par de pés no meio, como as de 10-12 lugares
  if (dining && W > 2.4 && !splay) {
    for (const sz of [-1, 1]) {
      const l = kit.leg(type, { h: legH + 0.001, r, material: legMatOf(c, type), dir: [0, sz], splay: 0 });
      l.position.set(0, 0, sz * hz);
      g.add(l);
    }
  }
  // prateleira inferior
  const shelf = st.shelf || (cons && H > 0.6 && st.shelf !== false);
  if (shelf) {
    const ys = clamp(legH * (dining ? 0.15 : 0.2), 0.06, 0.2);
    const st2 = Math.min(0.022, Math.max(0.016, tt * 0.7));
    const out = splay ? (legH - ys) * Math.sin(splay) * Math.SQRT1_2 : 0;
    const sx = hx + out - r * 0.2;
    const sz = hz + out - r * 0.2;
    const sm = glass && !c.st.woodLook ? c.m.glass({ tint: '#dfe9e6', opacity: 0.32 }) : c.body;
    g.add(boxAt(c, -sx, sx, ys, ys + st2, -sz, sz, sm, glass && !c.st.woodLook ? { r: 0 } : R2));
    if (kind === 'side' || kind === 'coffee' || cons) {
      // um livro ou dois para dar escala (só se couber)
      if (H - ys > 0.3 && sx > 0.15 && !glass) bookStack(c, g, { x: -sx * 0.35, y: ys + st2, z: 0, wMax: sx * 0.9, dMax: sz * 1.4, hMax: Math.min(0.08, legH - ah - ys - 0.05) });
    }
  }
}

// Estrutura de metalon (industrial): tampo de madeira, quadro de tubo quadrado e prateleira opcional
function metalFrameTable(c, g, kind) {
  const { THREE, kit, st, W, H, D } = c;
  const dining = kind === 'dining';
  const tube = dining ? 0.04 : kind === 'side' ? 0.02 : 0.025;
  const topM = frameTop(c);
  const tt = isGlass(c) ? 0.01 : clamp(H * (dining ? 0.04 : 0.06), 0.02, 0.04);
  const ins = dining ? clamp(Math.min(W, D) * 0.06, 0.03, 0.08) : clamp(Math.min(W, D) * 0.04, 0.015, 0.04);
  const fx = W / 2 - ins;
  const fz = D / 2 - ins;
  const yTop = H - tt;
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.006), tt, topM, { bevel: Math.min(0.004, tt * 0.2) }), { y: yTop }));
  const met = c.metal;
  const post = (x, z) => g.add(boxAt(c, x - tube / 2, x + tube / 2, 0, yTop, z - tube / 2, z + tube / 2, met, { r: 0.002, seg: 2 }));
  const railX = (y, z) => g.add(boxAt(c, -fx + tube / 2, fx - tube / 2, y - tube / 2, y + tube / 2, z - tube / 2, z + tube / 2, met, { r: 0.002, seg: 2 }));
  const railZ = (x, y) => g.add(boxAt(c, x - tube / 2, x + tube / 2, y - tube / 2, y + tube / 2, -fz + tube / 2, fz - tube / 2, met, { r: 0.002, seg: 2 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(sx * (fx - tube / 2), sz * (fz - tube / 2));
  const yR = yTop - tube / 2;
  for (const sz of [-1, 1]) railX(yR, sz * (fz - tube / 2));
  for (const sx of [-1, 1]) railZ(sx * (fx - tube / 2), yR);
  if (dining) {
    // pés em U: travessa no chão nas pontas
    for (const sx of [-1, 1]) railZ(sx * (fx - tube / 2), tube / 2);
  } else {
    const ys = clamp(H * 0.2, 0.06, 0.16);
    for (const sz of [-1, 1]) railX(ys, sz * (fz - tube / 2));
    for (const sx of [-1, 1]) railZ(sx * (fx - tube / 2), ys);
    if (st.shelf || kind === 'side') {
      const sm = topM.userData?.type === 'glass' ? c.wood : topM;
      g.add(boxAt(c, -fx + tube, fx - tube, ys + tube / 2, ys + tube / 2 + 0.018, -fz + tube, fz - tube, sm));
      if (H - ys > 0.28 && W > 0.4) bookStack(c, g, { x: -fx * 0.3, y: ys + tube / 2 + 0.018, z: 0, wMax: fx, dMax: fz * 1.3, hMax: 0.07 });
    }
  }
}
const C_WOOD = (c) => (String(c.C.wood).toLowerCase() === '#1f1f1f' ? '#a0663b' : c.C.wood);
// Tampo de móvel com estrutura metálica: madeira quando o corpo é metal ou cor escura (é a cor do metal)
function frameTop(c) {
  if (isGlass(c) || isMarble(c) || c.st.woodLook) return topMat(c);
  if (twoTone(c) || c.mt === 'metal' || c.mt === 'steel' || c.kit.luminance(c.C.main) < 0.2) return woodMat(c, C_WOOD(c), 'oak');
  return c.body;
}

// Mesa redonda/oval: tampo, base central (pedestal/tambor) ou pés
function roundTable(c, g, kind, opt = {}) {
  const { THREE, kit, st, W, H, D } = c;
  const glass = isGlass(c);
  const slats = isSlatted(c);
  // ripada bicolor ("Off White e Freijó"): ripas na madeira, tampo na cor principal
  const tm = slats && twoTone(c) && !glass && !isMarble(c) ? c.body : topMat(c);
  const dining = kind === 'dining';
  const tt = glass ? 0.01 : clamp(H * (dining ? 0.045 : 0.065), 0.02, 0.045);
  const R = Math.min(W, D) / 2;
  const oval = Math.abs(W - D) > 0.02;
  const yTop = H - tt;
  const top = opt.topShape || (oval && st.shape !== 'oval' && Math.min(W, D) / Math.max(W, D) < 0.75 ? stadiumShape(THREE, W, D) : ellipseShape(THREE, W, D));
  g.add(kit.place(plate(c, top, tt, tm, { bevel: glass ? 0.002 : Math.min(0.007, tt * 0.3), seg: 72 }), { y: yTop }));
  let base = st.base || opt.base;
  if (!base) {
    if (st.legs === 'wood_base' || c.has(/ pedestal | base central | tulipa | saarinen | base unica | base cilindrica | base redonda /)) base = slats ? 'drum' : 'pedestal';
    else if (c.has(/ tambor | cilindr/)) base = 'drum';
    // jantar/bistrô com "base" de metal (sem pés citados): coluna central de metal; senão hastes com aro
    else if (metalBase(c) || (glass && !st.legs && !dining)) base = dining && st.legs !== 'metal' && !st.industrial && !c.has(/ pes /) ? 'pedestal' : 'metal';
    // ripada ("Mesa de Centro Redonda Ripada", "Mesa de Jantar Base Ripada"): tambor de ripas
    else if (slats && !st.legs) base = 'drum';
    // pedra (travertino, mármore) sem pés citados: tambor da mesma pedra
    else if (isMarble(c) && !dining && !st.legs) base = 'drum';
    else if (dining && !st.legs) base = 'pedestal';
    else base = 'legs';
  }
  if (base === 'pedestal' && !dining && yTop < 0.55 && !c.has(/ tulipa | saarinen /)) base = 'drum';
  const legH = yTop;
  if (base === 'drum') {
    // tambor: corpo cilíndrico/oval recuado com rodapé escuro (na mesa de jantar, coluna larga central)
    const ins = dining ? R * 0.58 : Math.max(0.02, R * 0.08);
    const dw = oval && !dining ? W - 2 * ins : 2 * (R - ins);
    const dd = oval && !dining ? D - 2 * ins : 2 * (R - ins);
    // em pedra (travertino, mármore) o tambor é da mesma pedra do tampo
    const dm = isMarble(c) && !st.woodLook ? tm : c.body;
    if (slats) slatDrum(c, g, { w: dw, d: dd, y0: 0.03, y1: legH + 0.002, mat: twoTone(c) ? woodMat(c, c.C.wood, 'oak') : c.body });
    else g.add(kit.place(plate(c, ellipseShape(THREE, dw, dd), legH - 0.03 + 0.002, dm, { bevel: 0.003, seg: 64, grain: 'y' }), { y: 0.03 }));
    g.add(kit.place(plate(c, ellipseShape(THREE, dw - 0.04, dd - 0.04), 0.032, c.dark, { bevel: 0, seg: 48 }), { y: 0 }));
    return;
  }
  if (base === 'pedestal') {
    const colR = clamp(R * 0.12, 0.035, 0.08);
    const footR = clamp(R * 0.58, 0.18, 0.36);
    // base na cor do corpo (mesa preta/branca = base preta/branca; amadeirada = madeira)
    const pm = c.has(/ tulipa | saarinen /) || st.legs === 'metal' || metalBase(c) ? c.metal : c.secondMat || c.body;
    const centers = oval ? [-(Math.max(W, D) / 2 - Math.min(W, D) / 2) * 0.55, (Math.max(W, D) / 2 - Math.min(W, D) / 2) * 0.55] : [0];
    if (oval) {
      // base única alongada sob as duas colunas
      const span = Math.abs(centers[1] - centers[0]);
      const bw = W >= D ? span + footR * 1.5 : footR * 1.5;
      const bd = W >= D ? footR * 1.5 : span + footR * 1.5;
      g.add(kit.place(plate(c, stadiumShape(THREE, bw, bd), 0.03, pm, { bevel: 0.006, seg: 32 }), { y: 0 }));
    }
    for (const off of centers) {
      const x = W >= D ? off : 0;
      const z = W >= D ? 0 : off;
      if (oval) {
        const prof = [[0.0001, 0.028], [colR * 1.5, 0.028], [colR * 1.1, 0.06], [colR, 0.1], [colR * 0.92, legH * 0.5], [colR, legH - 0.05], [colR * 2.2, legH - 0.025], [colR * 2.2, legH], [0.0001, legH]];
        g.add(kit.place(kit.lathe(prof, pm, { seg: 36 }), { x, z }));
      } else if (c.has(/ tulipa | saarinen /)) {
        // pé tulipa: base que se abre em curva
        const prof = [[0.0001, 0], [footR, 0], [footR, 0.012], [footR * 0.8, 0.025], [colR * 1.8, legH * 0.12], [colR * 1.05, legH * 0.35], [colR, legH * 0.85], [colR * 1.6, legH - 0.004], [colR * 1.6, legH], [0.0001, legH]];
        g.add(kit.place(kit.lathe(prof, pm, { seg: 48 }), { x, z }));
      } else {
        // coluna torneada + disco de base + flange sob o tampo
        const prof = [[0.0001, 0], [footR, 0], [footR, 0.02], [footR * 0.92, 0.035], [colR * 1.25, 0.05], [colR, 0.09], [colR * 0.92, legH * 0.5], [colR, legH - 0.05], [colR * 2.4, legH - 0.025], [colR * 2.4, legH], [0.0001, legH]];
        g.add(kit.place(kit.lathe(prof, pm, { seg: 40 }), { x, z }));
      }
    }
    return;
  }
  // pés: 3 (mesas pequenas) ou 4, inclinados em direção radial; metal = hastes retas com aro
  const n = st.legCount || (kind === 'side' || R < 0.28 ? 3 : 4);
  const type = base === 'metal' ? 'metal_rod' : legKind(c, 'palito');
  const r = dining ? clamp(H * 0.03, 0.018, 0.028) : clamp(R * 0.07, 0.012, 0.022);
  const splay = type === 'palito' ? 0.14 : 0;
  const out = splay ? legH * Math.sin(splay) : 0;
  const rx = W / 2 - Math.max(out + r * 0.62, r) - Math.max(0.01, R * 0.06);
  const rz = D / 2 - Math.max(out + r * 0.62, r) - Math.max(0.01, R * 0.06);
  const angles = n === 3 ? [Math.PI / 2 + Math.PI / 3 * 0, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3].map((a) => a + Math.PI) : [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  // anel sob o tampo (aro) — no vidro fica aparente
  const ringY1 = yTop;
  const ringH = dining ? 0.06 : 0.035;
  const legPts = angles.map((a) => [Math.cos(a) * rx, Math.sin(a) * rz]);
  if (type === 'metal_rod') {
    const rod = clamp(R * 0.025, 0.007, 0.012);
    for (const [x, z] of legPts) g.add(kit.place(kit.cylinder(rod, rod, legH, c.metal, { seg: 12 }), { x, y: legH / 2, z }));
    if (!oval) {
      const rr = Math.hypot(legPts[0][0], legPts[0][1]);
      g.add(ring(c, rr - rod, rr + rod, ringY1 - 0.02, ringY1, c.metal));
      if (st.shelf) {
        const ys = clamp(legH * 0.22, 0.08, 0.18);
        g.add(ring(c, rr - rod, rr + rod, ys - 0.012, ys + 0.004, c.metal));
        g.add(kit.place(kit.cylinder(rr, rr, 0.016, glass ? c.m.glass({ tint: '#dfe9e6', opacity: 0.32 }) : c.wood, { seg: 48 }), { y: ys + 0.012 }));
      } else {
        g.add(ring(c, rr - rod, rr + rod, 0.08, 0.08 + 2 * rod, c.metal));
      }
    }
    return;
  }
  for (let i = 0; i < legPts.length; i++) {
    const [x, z] = legPts[i];
    const a = angles[i];
    const l = kit.leg(type, { h: legH + 0.001, r, material: legMatOf(c, type), dir: [Math.cos(a), Math.sin(a)], splay });
    l.position.set(x, 0, z);
    g.add(l);
  }
  if (!oval && legH > 0.25) {
    const rr = Math.hypot(legPts[0][0], legPts[0][1]);
    g.add(ring(c, rr - r * 0.2 - 0.02, rr - r * 0.2, ringY1 - ringH, ringY1, glass ? c.wood : c.body));
  }
  if (st.shelf) {
    const ys = clamp(legH * 0.25, 0.08, 0.2);
    const k = splay ? (legH - ys) * Math.sin(splay) : 0;
    const sR = Math.min(rx, rz) + k - r * 0.2;
    g.add(kit.place(kit.cylinder(sR, sR, 0.018, c.body, { seg: 48 }), { y: ys + 0.009 }));
  }
}
// Tambor ripado: núcleo elíptico (tom mais escuro) com ripas verticais distribuídas pelo contorno
// (por comprimento de arco, então o oval fica com o mesmo espaçamento que o redondo)
function slatDrum(c, g, { w, d, y0, y1, mat }) {
  const { kit, THREE } = c;
  const t = 0.016; // espessura da ripa (radial)
  const sw = 0.024; // largura da ripa
  const a = w / 2;
  const b = d / 2;
  const h = y1 - y0;
  g.add(kit.place(plate(c, ellipseShape(THREE, w - 2 * t + 0.004, d - 2 * t + 0.004), h, innerMat(c, mat), { bevel: 0, seg: 48, grain: 'y' }), { y: y0 }));
  const N = 720;
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    const t0 = ((i - 1) / N) * Math.PI * 2;
    const t1 = (i / N) * Math.PI * 2;
    cum.push(cum[i - 1] + Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0))));
  }
  const per = cum[N];
  const n = Math.max(12, Math.round(per / (sw + 0.011)));
  let j = 0;
  for (let i = 0; i < n; i++) {
    const L = (per * (i + 0.5)) / n;
    while (j < N && cum[j + 1] < L) j++;
    const tt = ((j + (L - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])) / N) * Math.PI * 2;
    let nx = Math.cos(tt) / a;
    let nz = Math.sin(tt) / b;
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    const s = kit.box(sw, h, t, mat, { r: 0, grain: 'y' });
    s.rotation.y = Math.atan2(nx, nz);
    s.position.set(a * Math.cos(tt) - (nx * t) / 2, y0 + h / 2, b * Math.sin(tt) - (nz * t) / 2);
    g.add(s);
  }
}
// (sem lineTo antes de cada arco: o absarc já liga a reta; a reta explícita deixava pontos quase
// repetidos, e o chanfro da extrusão virava um espinho de ~1 cm para fora da medida)
function stadiumShape(THREE, w, d) {
  const s = new THREE.Shape();
  if (w >= d) {
    const r = d / 2;
    const a = w / 2 - r;
    s.moveTo(0, -r);
    s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.absarc(-a, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    s.lineTo(0, -r);
  } else {
    const r = w / 2;
    const a = d / 2 - r;
    s.moveTo(r, 0);
    s.absarc(0, a, r, 0, Math.PI, false);
    s.absarc(0, -a, r, Math.PI, Math.PI * 2, false);
    s.lineTo(r, 0);
  }
  return s;
}

// Contorno orgânico (seixo): círculo com ondulações suaves (determinísticas pela semente), normalizado
// para caber exatamente em w x d. Devolve uma função (w, d) => THREE.Shape com o mesmo desenho.
function organicOutline(c) {
  const { THREE, r } = c;
  const N = 120;
  const a2 = 0.05 + r() * 0.05;
  const a3 = 0.05 + r() * 0.04;
  const a4 = 0.015 + r() * 0.02;
  const p2 = r() * Math.PI * 2;
  const p3 = r() * Math.PI * 2;
  const p4 = r() * Math.PI * 2;
  const raw = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = 1 + a2 * Math.cos(2 * a + p2) + a3 * Math.cos(3 * a + p3) + a4 * Math.cos(4 * a + p4);
    raw.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const unit = raw.map(([x, y]) => [(x - (x0 + x1) / 2) / (x1 - x0), (y - (y0 + y1) / 2) / (y1 - y0)]);
  const shape = (w, d) => new THREE.Shape(unit.map(([x, y]) => new THREE.Vector2(x * w, y * d)));
  // ponto do contorno na direção do ângulo a (para posicionar pés), escalado por k
  const at = (a, w, d, k = 1) => {
    const i = Math.round(((((a / (Math.PI * 2)) % 1) + 1) % 1) * N) % N;
    return [unit[i][0] * w * k, -unit[i][1] * d * k];
  };
  return { shape, at };
}
// Mesa orgânica (centro/lateral): tampo grosso de cantos macios sobre base recuada do mesmo desenho,
// ou sobre pés quando o nome pede (palito, metal, torneados)
function organicTable(c, g, kind) {
  const { kit, st, W, H, D } = c;
  const o = organicOutline(c);
  const tm = topMat(c);
  const tt = clamp(H * 0.16, 0.035, 0.075);
  const yTop = H - tt;
  g.add(kit.place(plate(c, o.shape(W, D), tt, tm, { bevel: Math.min(0.018, tt * 0.38) }), { y: yTop }));
  const type = st.legs && st.legs !== 'wood_base' && st.legs !== 'hidden' ? legKind(c, 'tapered') : 'none';
  if (type === 'none') {
    // base: mesmo contorno, recuada, com um friso escuro rente ao chão
    const k = kind === 'side' ? 0.62 : 0.7;
    g.add(kit.place(plate(c, o.shape(W * k, D * k), yTop - 0.012 + 0.003, c.body, { bevel: 0.004, grain: 'y' }), { y: 0.012 }));
    g.add(kit.place(plate(c, o.shape(W * k - 0.03, D * k - 0.03), 0.013, c.dark, { bevel: 0 }), { y: 0 }));
    return;
  }
  const r = clamp(Math.min(W, D) * 0.04, 0.013, 0.022);
  const splay = SPLAY[type] || 0;
  const n = st.legCount || (kind === 'side' ? 3 : 4);
  for (let i = 0; i < n; i++) {
    const a = n === 3 ? Math.PI / 2 + (i * Math.PI * 2) / 3 : Math.PI / 4 + (i * Math.PI) / 2;
    const [x, z] = o.at(a, W, D, 0.62);
    const len = Math.hypot(x, z) || 1;
    const l = kit.leg(type, { h: yTop + 0.001, r, material: legMatOf(c, type), dir: [x / len, z / len], splay });
    l.position.set(x, 0, z);
    g.add(l);
  }
}

// Conjunto ninho: duas mesas (a menor mais baixa, encaixada na frente da maior)
function nesting(c, g, kind) {
  const { kit, st, W, H, D } = c;
  const round = st.shape === 'round' || (kind === 'coffee' && st.shape !== 'square' && !c.has(/ quadrad| retangular /));
  const parts = [];
  if (round) {
    const R1 = Math.min(D / 2, W * 0.33);
    const R2 = R1 * 0.78;
    parts.push({ w: 2 * R1, d: 2 * R1, h: H, x: W / 2 - R1, z: -D / 2 + R1 });
    parts.push({ w: 2 * R2, d: 2 * R2, h: H * 0.78, x: -W / 2 + R2, z: D / 2 - R2 });
  } else {
    const d1 = D * 0.78;
    parts.push({ w: W, d: d1, h: H, x: 0, z: -D / 2 + d1 / 2 });
    parts.push({ w: W * 0.8, d: d1 * 0.92, h: H * 0.82, x: 0, z: D / 2 - (d1 * 0.92) / 2 });
  }
  for (const p of parts) {
    const sub = { ...c, W: p.w, H: p.h, D: p.d, st: { ...st, shelf: false, drawers: 0, niche: false } };
    const gg = kit.group('mesa-ninho');
    // (em pedra sem metal citado, a mesa redonda decide a base: tambor da mesma pedra)
    if (round) roundTable(sub, gg, kind, { base: metalBase(c) || isGlass(c) ? 'metal' : isMarble(c) && !st.legs ? undefined : 'legs' });
    else if (metalBase(c)) metalFrameTable({ ...sub, st: { ...sub.st, shelf: false } }, gg, 'coffee');
    else classicTable(sub, gg, kind === 'side' ? 'side' : 'coffee');
    gg.position.set(p.x, 0, p.z);
    g.add(gg);
  }
}

// Mesa lateral com nicho (caixa em "C"): tampo, prateleira de baixo, lateral e fundo parcial, pés inclinados
function nicheSideTable(c, g) {
  const { THREE, kit, st, W, H, D } = c;
  const body = c.body;
  const t = clamp(Math.min(W, D) * 0.045, 0.015, 0.022);
  const type = legKind(c, 'palito');
  const hidden = type === 'none';
  const lh = hidden ? 0.03 : clamp(H * 0.25, 0.08, 0.2);
  const r = clamp(Math.min(W, D) * 0.05, 0.014, 0.024);
  // pés (inclinados para fora) sob a prateleira de baixo
  if (hidden) plinth(c, g, -W / 2 + 0.02, W / 2 - 0.02, lh, -D / 2 + 0.02, D / 2 - 0.02, 0.02);
  else {
    const splay = type === 'palito' ? 0.2 : SPLAY[type] || 0;
    const reach = legReach(type, lh, r, splay);
    const hx = W / 2 - Math.max(reach.x + 0.01, r + 0.03);
    const hz = D / 2 - Math.max(reach.z + 0.01, r + 0.03);
    legs4(c, g, { hx, hz, h: lh + 0.002, type, r, splay, mat: legMatOf(c, type) });
  }
  const yb = lh;
  // prateleira de baixo e tampo (placas inteiras)
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.003), t, body, { bevel: 0.0015 }), { y: yb }));
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.003), t, body, { bevel: 0.0015 }), { y: H - t }));
  // lateral direita (profundidade toda) e fundo parcial: formam o nicho dos livros
  const y0 = yb + t;
  const y1 = H - t;
  g.add(boxAt(c, W / 2 - t, W / 2, y0 - 0.001, y1 + 0.001, -D / 2, D / 2, body, { r: 0.0015, seg: 2, grain: 'y' }));
  const bw = W * (st.nicheWidth || 0.56);
  g.add(boxAt(c, W / 2 - bw, W / 2 - t, y0 - 0.001, y1 + 0.001, -D / 2, -D / 2 + t, body, { r: 0.0015, seg: 2, grain: 'y' }));
  // livros no nicho, encostados na lateral
  const nh = y1 - y0;
  if (nh > 0.16 && bw > 0.15) bookRow(c, g, { x0: W / 2 - bw + 0.02, x1: W / 2 - t - 0.004, y: y0, hMax: Math.min(nh - 0.02, 0.3), zb: -D / 2 + t, dMax: D - t - 0.02, dir: -1 });
}

// Mesa lateral em "C" de metal (desliza sob o sofá): base no chão, colunas atrás e tampo em balanço
function cFrameSideTable(c, g) {
  const { THREE, kit, W, H, D } = c;
  const tube = 0.018;
  const tm = topMat(c).userData?.type === 'paint' && !twoTone(c) ? woodMat(c, C_WOOD(c), 'oak') : topMat(c);
  const tt = isGlass(c) ? 0.01 : 0.022;
  const yTop = H - tt;
  const round = c.st.shape === 'round';
  g.add(kit.place(plate(c, round ? ellipseShape(THREE, W, D) : rrect(THREE, W, D, 0.02), tt, tm, { bevel: 0.004, seg: 48 }), { y: yTop }));
  const m = c.metal;
  const fx = W / 2 - 0.03;
  const zb = -D / 2 + 0.02;
  const zf = D / 2 - 0.02;
  // base em U no chão e U sob o tampo, ligados por duas colunas atrás
  for (const y of [tube / 2, yTop - tube / 2]) {
    const pts = [[-fx, y, zf], [-fx, y, zb], [fx, y, zb], [fx, y, zf]];
    g.add(kit.tube(pts, tube / 2, m, { seg: 64, radial: 10, smooth: false }));
  }
  for (const sx of [-1, 1]) g.add(boxAt(c, sx * fx - tube / 2, sx * fx + tube / 2, tube / 2, yTop - tube / 2, zb - tube / 2, zb + tube / 2, m, { r: 0 }));
}

/* ---------- exportados: mesas ---------- */
export function coffee_table(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('coffee_table');
  const { st } = c;
  const base = st.base;
  if (isNesting(c)) nesting(c, g, 'coffee');
  else if (st.organic && !st.shape) organicTable(c, g, 'coffee');
  else if (st.shape === 'round' || st.shape === 'oval' || isDrum(c)) roundTable(c, g, 'coffee', isDrum(c) ? { base: 'drum' } : {});
  else if (base === 'block' || (!base && (st.rustic || st.legs === 'wood_base'))) blockTable(c, g);
  else if (base === 'metal' || metalBase(c)) metalFrameTable(c, g, 'coffee');
  else classicTable(c, g, 'coffee');
  return consolidate(c, g);
}

export function side_table(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('side_table');
  const { st } = c;
  if (isNesting(c)) nesting(c, g, 'side');
  else if (st.console) consoleTable(c, g);
  else if (st.niche) nicheSideTable(c, g);
  else if (st.organic && !st.shape) organicTable(c, g, 'side');
  else if (st.shape === 'round' || st.shape === 'oval' || isDrum(c)) roundTable(c, g, 'side', isDrum(c) ? { base: 'drum' } : {});
  else if (c.has(/ em c | formato c /) || st.base === 'c') cFrameSideTable(c, g);
  else if (metalBase(c)) metalFrameTable(c, g, 'side');
  else if (st.rustic || st.legs === 'wood_base') blockTable(c, g);
  else classicTable(c, g, 'side');
  return consolidate(c, g);
}

// Aparador: mesa estreita com gavetas e prateleira; com portas vira um buffet sobre pés
function consoleTable(c, g) {
  const { st, W, H, D } = c;
  if (!st.doors) {
    classicTable(c, g, 'console');
    return;
  }
  const type = legKind(c, st.woodLook ? 'tapered' : 'palito');
  const lh = type === 'none' ? 0.05 : clamp(H * 0.2, 0.1, 0.22);
  const pull = pullType(c, 'bar');
  const pd = pullDepth(pull);
  const zf = D / 2 - 0.018 - pd;
  baseUnder(c, g, { x0: -W / 2, x1: W / 2, zb: -D / 2, zf, type, h: lh });
  const doors = Math.max(1, Math.min(6, st.doors));
  const mods = [];
  if (st.drawers && W > 1.1) {
    mods.push({ w: 1, type: 'doors', n: Math.ceil(doors / 2) }, { w: 0.8, type: 'drawers', n: Math.min(4, st.drawers) }, { w: 1, type: 'doors', n: Math.floor(doors / 2) || 1 });
  } else mods.push({ w: 1, type: 'doors', n: doors });
  // bicolor ("Off White e Freijó"): tampo na madeira, até a frente das portas
  const tw = twoTone(c);
  caseRow(c, g, { x0: -W / 2, x1: W / 2, y0: lh, y1: tw ? H - 0.025 : H, zb: -D / 2, zf, mods, pull, style: frontStyle(c) });
  if (tw) g.add(boxAt(c, -W / 2, W / 2, H - 0.025, H, -D / 2, zf + 0.018, woodMat(c, c.C.wood, 'oak'), { r: 0.003, seg: 2 }));
}

export function dining_table(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('dining_table');
  const { st } = c;
  // as cadeiras ficam de fora: a caixa do modelo é a da mesa
  if (st.organic && !st.shape) roundTable(c, g, 'dining', { topShape: organicOutline(c).shape(c.W, c.D) });
  else if (st.shape === 'round' || st.shape === 'oval') roundTable(c, g, 'dining');
  else if (st.base === 'trestle' || c.has(/ (pes?|base) em x /)) trestleTable(c, g);
  else if (st.base === 'metal' || metalBase(c)) metalFrameTable(c, g, 'dining');
  else if (st.base === 'trestle' || st.legs === 'wood_base' || c.has(/ cavalete | pes? em x | base em x /)) trestleTable(c, g);
  else classicTable(c, g, 'dining');
  return consolidate(c, g);
}

// Mesa com base em painéis (pés laterais maciços) ligados por uma travessa
function trestleTable(c, g) {
  const { THREE, kit, W, H, D } = c;
  const xLeg = c.has(/ em x /);
  // base de metal quando o nome diz ("Base em X Metal Preto"); senão na cor do corpo (ou madeira)
  const metal = c.spec.material === 'metal' || c.spec.material === 'steel' || c.has(/ (metal|metalic[oa]|ferro|aco) /);
  const lm = metal ? c.metal : c.secondMat || c.body;
  const tm = metal ? frameTop(c) : topMat(c);
  const tt = isGlass(c) ? 0.012 : clamp(H * 0.05, 0.03, 0.05);
  const yTop = H - tt;
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.01), tt, tm, { bevel: 0.005 }), { y: yTop }));
  const lt = metal ? 0.03 : clamp(W * 0.035, 0.04, 0.07);
  const ld = D - clamp(D * 0.18, 0.1, 0.2);
  const lx = W / 2 - clamp(W * 0.12, 0.12, 0.3);
  for (const sx of [-1, 1]) {
    if (xLeg) {
      // pé em X: duas barras lado a lado no plano ZY, cortadas na horizontal no chão e sob o tampo
      const bt = metal ? 0.05 : 0.07;
      const bw = bt / Math.sin(Math.atan2(yTop, ld));
      for (const s of [-1, 1]) {
        const pts = s > 0 ? [[-ld / 2, 0], [-ld / 2 + bw, 0], [ld / 2, yTop], [ld / 2 - bw, yTop]] : [[ld / 2 - bw, 0], [ld / 2, 0], [-ld / 2 + bw, yTop], [-ld / 2, yTop]];
        const x0 = sx * lx + (s > 0 ? -lt - 0.0005 : 0.0005);
        g.add(prismX(c, pts, x0, x0 + lt, lm, { grain: 'y' }));
      }
    } else {
      const pts = [[-ld / 2, 0], [ld / 2, 0], [ld / 2, 0.04], [ld * 0.18, 0.08], [ld * 0.14, yTop - 0.06], [ld * 0.42, yTop - 0.02], [ld * 0.42, yTop], [-ld * 0.42, yTop], [-ld * 0.42, yTop - 0.02], [-ld * 0.14, yTop - 0.06], [-ld * 0.18, 0.08], [-ld / 2, 0.04]];
      g.add(prismX(c, pts, sx * lx - lt / 2, sx * lx + lt / 2, lm, { grain: 'y' }));
    }
  }
  // travessa (no X, passa no cruzamento)
  const ty = xLeg ? yTop / 2 - 0.03 : yTop * 0.32;
  g.add(boxAt(c, -lx, lx, ty, ty + (metal ? 0.04 : 0.07), -0.02, 0.02, lm, { r: metal ? 0.002 : 0.004 }));
}

/* ================================================================== */
/* Escrivaninha / penteadeira                                          */
/* ================================================================== */
export function desk(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('desk');
  const { st, W, H, D } = c;
  const vanity = !!st.vanity;
  // "Carvalho e Preto": tampo na madeira, estrutura (laterais, gaveteiro, painéis) na segunda cor
  if (c.second) {
    c.deskTop = c.body;
    c.body = c.secondMat;
  }
  // parte de cima (estante/espelho) quando a peça é alta
  const tall = H > 1.05;
  const deskH = tall ? clamp(Math.min(0.78, H * 0.56), 0.68, 0.8) : H;
  const gamer = c.has(/ gamer /) || st.gamer;
  if (st.wallMount && H < 0.65 && !vanity) wallDesk(c, g);
  else if (st.corner) lDesk(c, g, deskH);
  else if (gamer) gamerDesk(c, g, deskH);
  else if (metalBase(c)) metalDesk(c, g, deskH);
  else if (st.legs === 'palito' || st.retro || (vanity && !st.drawers)) retroDesk(c, g, deskH);
  else panelDesk(c, g, deskH);
  if (tall) {
    if (vanity || st.mirror) vanityMirror(c, g, deskH);
    else hutch(c, g, deskH);
  }
  return consolidate(c, g);
}
function deskTopMat(c) {
  if (c.has(/ gamer /)) return c.m.paint('#1d1d1d', { gloss: 0.3 });
  return c.deskTop || topMat(c);
}
// Escrivaninha de painéis: lateral, gaveteiro (ou gaveta sob o tampo) e painel frontal
function panelDesk(c, g, hTop) {
  const { THREE, kit, st, W, D } = c;
  const t = 0.025;
  const tt = 0.025;
  const tm = deskTopMat(c);
  const pull = pullType(c, 'bar');
  const pd = pullDepth(pull);
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.004), tt, tm, { bevel: 0.003 }), { y: hTop - tt }));
  const yU = hTop - tt;
  const zf = D / 2 - 0.018 - pd; // frente dos corpos (as frentes e puxadores ficam até a borda do tampo)
  const zb = -D / 2 + 0.01;
  g.add(boxAt(c, -W / 2, -W / 2 + t, 0, yU + 0.001, zb, D / 2 - 0.02, c.body, { ...R2, grain: 'y' }));
  const ped = W >= 0.9;
  // mesa para computador: suporte de teclado (bandeja corrediça) e nicho da CPU no lugar das gavetas
  const keyboard = c.has(/ teclado /);
  const cpu = c.has(/ cpu | torre | gabinete do computador /) && !st.drawers;
  if (ped) {
    const pw = clamp(W * 0.32, 0.33, 0.45);
    const nd = clamp(st.drawers || 3, 1, 4);
    const rows = cpu ? [{ f: 1.7, type: 'niche', shelves: 0, cpu: true }, { f: 1, type: 'niche', shelves: 0 }] : st.niche ? [{ f: nd, type: 'drawers', n: nd }, { f: 1.2, type: 'niche' }] : [{ f: 1, type: 'drawers', n: nd }];
    caseRow(c, g, { x0: W / 2 - pw, x1: W / 2, y0: 0, y1: yU, zb, zf, top: false, mods: [{ w: 1, type: 'rows', rows }], pull, style: frontStyle(c), fill: (r) => (r.row?.cpu ? cpuTower(c, g, r) : fillCompartment(c, g, { ...r, density: 0.8 })) });
    // painel frontal (de modéstia) entre a lateral e o gaveteiro
    g.add(boxAt(c, -W / 2 + t, W / 2 - pw, yU - Math.min(0.38, yU * 0.5), yU, -D / 2 + 0.05, -D / 2 + 0.068, c.body));
    if (keyboard) keyboardTray(c, g, { x0: -W / 2 + t, x1: W / 2 - pw, yU, zb: -D / 2 + 0.075 });
  } else {
    g.add(boxAt(c, W / 2 - t, W / 2, 0, yU + 0.001, zb, D / 2 - 0.02, c.body, { ...R2, grain: 'y' }));
    g.add(boxAt(c, -W / 2 + t, W / 2 - t, yU - Math.min(0.38, yU * 0.5), yU, -D / 2 + 0.05, -D / 2 + 0.068, c.body));
    if (keyboard && !st.drawers) keyboardTray(c, g, { x0: -W / 2 + t, x1: W / 2 - t, yU, zb: -D / 2 + 0.075 });
    else if (st.drawers || !st.niche) {
      const dh = 0.11;
      const nd = W > 0.7 ? clamp(st.drawers || 1, 1, 2) : 1;
      const span = W - 2 * t;
      g.add(boxAt(c, -W / 2 + t, W / 2 - t, yU - dh, yU - dh + 0.012, zb, zf, c.body));
      for (let i = 0; i < nd; i++) {
        const a = -W / 2 + t + (span * i) / nd;
        const b = a + span / nd;
        frontPanel(c, g, { x0: a + 0.001, x1: b - 0.001, y0: yU - dh, y1: yU - 0.002, z: zf, mat: c.body, style: frontStyle(c) });
        drawerPull(c, g, pull, { x0: a, x1: b, y0: yU - dh, y1: yU, z: zf + 0.018 });
      }
    }
    if (st.niche) g.add(boxAt(c, -W / 2 + t, W / 2 - t, yU * 0.25, yU * 0.25 + 0.018, zb, zf, c.body));
  }
}
// Bandeja corrediça do teclado sob o tampo (com as corrediças nas pontas e um teclado em cima)
function keyboardTray(c, g, { x0, x1, yU, zb }) {
  const { D } = c;
  const y = yU - 0.085;
  const zf = D / 2 - 0.035;
  const a = x0 + 0.012;
  const b = x1 - 0.012;
  g.add(boxAt(c, a, b, y, y + 0.015, zb, zf, c.body));
  // corrediças presas sob o tampo
  for (const x of [x0 + 0.006, x1 - 0.006]) g.add(boxAt(c, x - 0.006, x + 0.006, y, yU, zb + 0.02, zf - 0.04, c.m.metal('#3a3a3a', { finish: 'painted' }), { r: 0 }));
  const kw = Math.min(0.44, (b - a) * 0.7);
  if (kw > 0.25) {
    const kd = 0.14;
    const kz = (zb + zf) / 2 + 0.02;
    g.add(boxAt(c, -kw / 2 + (a + b) / 2, kw / 2 + (a + b) / 2, y + 0.015, y + 0.03, kz - kd / 2, kz + kd / 2, c.m.plastic('#202022', { gloss: 0.3 }), { r: 0.004, part: 'detail' }));
  }
}
// Gabinete do computador (CPU) no nicho de baixo
function cpuTower(c, g, { x0, x1, y, h, zb, zf }) {
  const w = Math.min(0.2, (x1 - x0) * 0.6);
  const hh = Math.min(0.42, h - 0.03);
  const d = Math.min(0.42, zf - zb - 0.03);
  if (hh < 0.2 || d < 0.2 || w < 0.12) return;
  const cx = (x0 + x1) / 2;
  const z1 = zf - 0.01;
  g.add(boxAt(c, cx - w / 2, cx + w / 2, y, y + hh, z1 - d, z1, c.m.plastic('#1c1d1f', { gloss: 0.35 }), { r: 0.004, part: 'detail' }));
  // botão e entradas na frente
  g.add(boxAt(c, cx - 0.012, cx + 0.012, y + hh - 0.05, y + hh - 0.026, z1, z1 + 0.003, c.m.flat('#9fb8c8', { emissive: '#6aa8d8' }), { r: 0, part: 'detail' }));
  g.add(boxAt(c, cx - w / 2 + 0.02, cx + w / 2 - 0.02, y + 0.04, y + hh * 0.55, z1, z1 + 0.002, c.m.flat('#2a2b2e', { roughness: 0.6 }), { r: 0, part: 'detail' }));
}
// Escrivaninha suspensa (de parede): tampo de trabalho, gaveta embaixo e nichos em cima
// (sem pés; a peça é só o móvel de parede, com a medida do produto)
function wallDesk(c, g) {
  const { THREE, kit, st, W, H, D } = c;
  const tt = 0.025;
  const yT = clamp(H * 0.42, Math.min(0.12, H * 0.3), H - 0.12);
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.004), tt, deskTopMat(c), { bevel: 0.003 }), { y: yT }));
  const pull = pullType(c, 'cutout');
  // gaveta (ou gaveteiro baixo) sob o tampo, à direita; trilho de fixação na parede no resto
  const dw = clamp(W * 0.45, 0.3, 0.6);
  const zf = D / 2 - 0.018 - pullDepth(pull);
  caseRow(c, g, { x0: W / 2 - dw, x1: W / 2, y0: 0, y1: yT, zb: -D / 2, zf, top: false, mods: [{ w: 1, type: 'drawers', n: clamp(st.drawers || 1, 1, 2) }], pull, style: frontStyle(c) });
  g.add(boxAt(c, -W / 2, W / 2 - dw, Math.max(0, yT - 0.08), yT, -D / 2, -D / 2 + 0.018, c.body));
  // nichos em cima, rasos, encostados na parede
  const hd = Math.min(D * 0.5, 0.22);
  const mods = W > 0.75 ? [{ w: 1, type: 'niche', shelves: 0 }, { w: 1.4, type: 'niche', shelves: 0 }, { w: 1, type: 'niche', shelves: 0 }] : [{ w: 1, type: 'niche', shelves: 0 }, { w: 1, type: 'niche', shelves: 0 }];
  caseRow(c, g, { x0: -W / 2, x1: W / 2, y0: yT + tt, y1: H, zb: -D / 2, zf: -D / 2 + hd, mods, fill: (r) => fillCompartment(c, g, { ...r, density: 0.9 }) });
}
// Escrivaninha retrô: tampo, caixa de gavetas sob o tampo e pés palito
function retroDesk(c, g, hTop) {
  const { THREE, kit, st, W, D } = c;
  const tt = 0.022;
  const tm = deskTopMat(c);
  const pull = pullType(c, st.vanity ? 'knob' : 'cutout');
  const pd = pullDepth(pull);
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.006), tt, tm, { bevel: 0.003 }), { y: hTop - tt }));
  const yU = hTop - tt;
  const bh = clamp(hTop * 0.17, 0.1, 0.16);
  const zf = D / 2 - 0.018 - pd;
  const zb = -D / 2 + 0.012;
  const type = legKind(c, 'palito');
  const r = 0.02;
  const splay = SPLAY[type] || 0;
  const reach = legReach(type, yU - bh, r, splay);
  const x0 = -W / 2 + 0.01;
  const x1 = W / 2 - 0.01;
  const nd = clamp(st.drawers || (W > 1.0 ? 2 : 1), 1, 3);
  const mods = nd >= 2 ? [{ w: 1, type: 'drawers', n: 1 }, ...(W > 1.0 ? [{ w: 1.4, type: 'niche', shelves: 0 }] : []), { w: 1, type: 'drawers', n: nd - 1 }] : [{ w: 1, type: 'niche', shelves: 0 }, { w: 1, type: 'drawers', n: 1 }];
  caseRow(c, g, { x0, x1, y0: yU - bh, y1: yU, zb, zf, mods, pull, top: false, style: frontStyle(c) });
  const hx = (x1 - x0) / 2 - Math.max(reach.x, 0.03) - 0.01;
  const hz = (zf - zb) / 2 - Math.max(reach.z, 0.03) - 0.005;
  legs4(c, g, { hx, hz, h: yU - bh + 0.002, type, r, splay, cz: (zf + zb) / 2 });
}
// Escrivaninha com estrutura de metal (pés em quadro ou grampo) e gaveta opcional
function metalDesk(c, g, hTop) {
  const { THREE, kit, st, W, D } = c;
  const tt = 0.025;
  const tm = deskTopMat(c).userData?.type === 'metal' ? woodMat(c, C_WOOD(c), 'oak') : deskTopMat(c);
  g.add(kit.place(plate(c, rrect(THREE, W, D, 0.004), tt, tm, { bevel: 0.003 }), { y: hTop - tt }));
  const yU = hTop - tt;
  const m = c.metal;
  const tube = 0.03;
  if (c.has(/ hairpin | grampo /)) {
    const reach = legReach('metal_hairpin', yU, 0.006);
    legs4(c, g, { hx: W / 2 - Math.max(0.05, reach.x + 0.02), hz: D / 2 - reach.z - 0.01, h: yU + 0.001, type: 'metal_hairpin', r: 0.006, mat: m });
  } else {
    // quadros laterais (dois postes + travessas em cima e no chão)
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.04 - tube / 2);
      for (const sz of [-1, 1]) g.add(boxAt(c, x - tube / 2, x + tube / 2, 0, yU, sz * (D / 2 - 0.04) - tube / 2, sz * (D / 2 - 0.04) + tube / 2, m, { r: 0.002, seg: 2 }));
      g.add(boxAt(c, x - tube / 2, x + tube / 2, 0, tube, -D / 2 + 0.04 - tube / 2, D / 2 - 0.04 + tube / 2, m, { r: 0.002, seg: 2 }));
      g.add(boxAt(c, x - tube / 2, x + tube / 2, yU - tube, yU, -D / 2 + 0.04 - tube / 2, D / 2 - 0.04 + tube / 2, m, { r: 0.002, seg: 2 }));
    }
    g.add(boxAt(c, -W / 2 + 0.04 + tube, W / 2 - 0.04 - tube, yU - tube, yU, -D / 2 + 0.04 - tube / 2, -D / 2 + 0.04 + tube / 2, m, { r: 0.002, seg: 2 }));
  }
  if (st.drawers) {
    const dw = Math.min(0.5, W * 0.4);
    const dh = 0.1;
    const pull = pullType(c, 'cutout');
    const zf = D / 2 - 0.05 - 0.018;
    g.add(boxAt(c, W / 2 - 0.1 - dw, W / 2 - 0.1, yU - dh, yU, -D / 2 + 0.1, zf, c.body));
    frontPanel(c, g, { x0: W / 2 - 0.1 - dw, x1: W / 2 - 0.1, y0: yU - dh, y1: yU - 0.002, z: zf, mat: c.body });
    drawerPull(c, g, pull, { x0: W / 2 - 0.1 - dw, x1: W / 2 - 0.1, y0: yU - dh, y1: yU, z: zf + 0.018 });
  }
}
// Mesa gamer: tampo preto com mousepad, pés de aço em "K" com detalhes coloridos
function gamerDesk(c, g, hTop) {
  const { THREE, kit, W, D } = c;
  const tt = 0.025;
  const accent = /^#c8995e$/i.test(c.C.accent) || c.kit.luminance(c.C.accent) > 0.75 ? '#d42a2a' : c.C.accent;
  const top = rectShape(THREE, -W / 2, W / 2, -D / 2, D / 2, [0.06, 0.06, 0.02, 0.02]);
  g.add(kit.place(plate(c, top, tt, c.m.paint('#1b1b1b', { gloss: 0.3 }), { bevel: 0.004 }), { y: hTop - tt - 0.003 }));
  // mousepad de tecido sobre o tampo
  g.add(kit.place(plate(c, rrect(THREE, W - 0.06, D * 0.62, 0.02), 0.0035, c.m.fabric('#141414', { kind: 'cotton' }), { bevel: 0.001 }), { y: hTop - 0.0035, z: D * 0.12 }));
  const yU = hTop - tt - 0.003;
  const m = c.m.metal('#151515', { finish: 'painted' });
  const red = c.m.paint(accent, { gloss: 0.6 });
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.08);
    // pé em K: haste vertical + duas diagonais e sapata no chão
    g.add(boxAt(c, x - 0.03, x + 0.03, 0, 0.03, -D / 2 + 0.04, D / 2 - 0.04, m, { r: 0.006 }));
    g.add(boxAt(c, x - 0.025, x + 0.025, yU - 0.03, yU, -D / 2 + 0.06, D / 2 - 0.08, m, { r: 0.004 }));
    const pts = [[-0.04, 0.03], [0.04, 0.03], [0.02, yU * 0.5], [D * 0.3, yU - 0.03], [D * 0.3 - 0.07, yU - 0.03], [-0.01, yU * 0.56], [-D * 0.3 + 0.07, yU - 0.03], [-D * 0.3, yU - 0.03], [-0.02, yU * 0.5]];
    g.add(prismX(c, pts, x - 0.02, x + 0.02, m));
    g.add(boxAt(c, x + sx * 0.0205 - 0.002, x + sx * 0.0205 + 0.002, yU * 0.3, yU * 0.62, -0.012, 0.012, red, { r: 0 }));
  }
  g.add(boxAt(c, -W / 2 + 0.1, W / 2 - 0.1, yU - 0.06, yU - 0.03, -D / 2 + 0.08, -D / 2 + 0.11, m, { r: 0.004 }));
  // faixa colorida na borda da frente
  g.add(boxAt(c, -W / 2 + 0.1, W / 2 - 0.1, hTop - tt + 0.004, hTop - 0.004, D / 2 - 0.002, D / 2, red, { r: 0 }));
}
// Escrivaninha em L: tampo principal ao fundo e retorno à esquerda; gaveteiro à direita (se houver
// gavetas); gamer = tampo e estrutura pretos com filete colorido nas bordas de dentro
function lDesk(c, g, hTop) {
  const { THREE, kit, st, W, D } = c;
  const gamer = c.has(/ gamer /) || st.gamer;
  if (gamer) c.body = c.m.paint('#1b1b1b', { gloss: 0.3 });
  const tt = 0.025;
  const tm = deskTopMat(c);
  const d1 = Math.min(D * 0.9, clamp(D * 0.45, 0.45, 0.7));
  const w1 = Math.min(W * 0.9, clamp(W * 0.38, 0.45, 0.7));
  // contorno em L no plano (x, -z): fundo inteiro + retorno à esquerda até a frente
  const s = new THREE.Shape();
  s.moveTo(-W / 2, D / 2);
  s.lineTo(W / 2, D / 2);
  s.lineTo(W / 2, D / 2 - d1);
  s.lineTo(-W / 2 + w1, D / 2 - d1);
  s.lineTo(-W / 2 + w1, -D / 2);
  s.lineTo(-W / 2, -D / 2);
  s.lineTo(-W / 2, D / 2);
  g.add(kit.place(plate(c, s, tt, tm, { bevel: 0.003 }), { y: hTop - tt }));
  const yU = hTop - tt;
  const t = 0.025;
  // painéis: direita (ou gaveteiro) sob o tampo do fundo, frente do retorno, lateral esquerda
  const nd = clamp(st.drawers || 0, 0, 5);
  const pw = clamp(W * 0.28, 0.35, 0.45);
  if (nd && W - w1 > pw + 0.5) {
    const pull = pullType(c, 'bar');
    const zf = -D / 2 + d1 - 0.018 - pullDepth(pull);
    caseRow(c, g, { x0: W / 2 - pw, x1: W / 2, y0: 0, y1: yU + 0.001, zb: -D / 2 + 0.01, zf, top: false, mods: [{ w: 1, type: 'rows', rows: [{ f: 1, type: 'drawers', n: nd }] }], pull, style: frontStyle(c) });
  } else g.add(boxAt(c, W / 2 - t, W / 2, 0, yU + 0.001, -D / 2 + 0.01, -D / 2 + d1 - 0.02, c.body, { ...R2, grain: 'y' }));
  g.add(boxAt(c, -W / 2 + 0.01, -W / 2 + w1 - 0.02, 0, yU + 0.001, D / 2 - t, D / 2, c.body, { ...R2, grain: 'y' }));
  g.add(boxAt(c, -W / 2, -W / 2 + t, 0, yU + 0.001, -D / 2 + 0.01, D / 2 - 0.02, c.body, { ...R2, grain: 'y' }));
  // painéis de fundo
  g.add(boxAt(c, -W / 2 + t, W / 2 - (nd ? pw : t), yU - Math.min(0.35, yU * 0.5), yU, -D / 2 + 0.02, -D / 2 + 0.038, c.body));
  if (gamer) {
    // filete colorido (vermelho por padrão) nas bordas de dentro do L
    const accent = /^#c8995e$/i.test(c.C.accent) || c.kit.luminance(c.C.accent) > 0.75 ? '#d42a2a' : c.C.accent;
    const red = c.m.paint(accent, { gloss: 0.6 });
    const y0 = hTop - tt + 0.005;
    const y1 = hTop - 0.005;
    g.add(boxAt(c, -W / 2 + w1, W / 2 - 0.01, y0, y1, -D / 2 + d1, -D / 2 + d1 + 0.002, red, { r: 0, part: 'accent' }));
    g.add(boxAt(c, -W / 2 + w1, -W / 2 + w1 + 0.002, y0, y1, -D / 2 + d1, D / 2 - 0.01, red, { r: 0, part: 'accent' }));
  }
}
// Estante sobre a escrivaninha (nichos e prateleira com livros)
function hutch(c, g, hTop) {
  const { W, H, D } = c;
  const hd = clamp(D * 0.42, 0.2, 0.3);
  const zb = -D / 2;
  caseRow(c, g, {
    x0: -W / 2 + 0.005, x1: W / 2 - 0.005, y0: hTop - 0.001, y1: H, zb, zf: zb + hd,
    mods: W > 1.0 ? [{ w: 1, type: 'niche' }, { w: 1.6, type: 'rows', rows: [{ f: 1, type: 'open', shelves: 0 }, { f: 1, type: 'doors', n: 2 }] }, { w: 1, type: 'niche' }] : [{ w: 1, type: 'niche' }],
    pull: pullType(c, 'cutout'),
    fill: (r) => fillCompartment(c, g, { ...r, density: 0.9 }),
  });
}
// Espelho da penteadeira
// (camarim: moldura larga com lâmpadas nas laterais e em cima)
function vanityMirror(c, g, hTop) {
  const { kit, W, H, D } = c;
  const camarim = c.has(/ camarim /);
  const mw = camarim ? Math.min(0.95, W * 0.8) : Math.min(0.75, W * 0.6);
  const zb = -D / 2;
  const fr = camarim ? 0.065 : 0.03;
  if (!camarim && c.has(/ espelho (redondo|oval|organico)/)) {
    // espelho redondo (ou oval, quando sobra altura) com moldura, apoiado num pé curto no tampo
    const { THREE } = c;
    const eh = H - hTop - 0.035;
    const ew = c.has(/ espelho oval/) ? Math.min(mw, eh * 0.7) : Math.min(mw, eh);
    const ehh = c.has(/ espelho oval/) ? eh : ew;
    const cy = H - ehh / 2;
    const disc = (w, h, z0, z1, m) => {
      const geo = new THREE.ExtrudeGeometry(ellipseShape(THREE, w, h), { depth: z1 - z0, bevelEnabled: false, curveSegments: 48 });
      geo.translate(0, cy, z0);
      return kit.mesh(geo, m, { grain: 'y' });
    };
    g.add(disc(ew, ehh, zb, zb + 0.025, c.body));
    const mirror = disc(ew - 2 * fr, ehh - 2 * fr, zb + 0.025, zb + 0.029, c.m.metal('#e6ecef', { finish: 'chrome' }));
    mirror.userData.part = 'detail';
    g.add(mirror);
    // pé que liga o espelho ao tampo
    g.add(boxAt(c, -0.04, 0.04, hTop, cy - ehh / 2 + 0.03, zb, zb + 0.022, c.body));
    return;
  }
  g.add(boxAt(c, -mw / 2, mw / 2, hTop, H, zb, zb + 0.025, c.body, { r: 0.006 }));
  g.add(boxAt(c, -mw / 2 + fr, mw / 2 - fr, hTop + fr, H - fr, zb + 0.025, zb + 0.029, c.m.metal('#e6ecef', { finish: 'chrome' }), { r: 0, part: 'detail' }));
  if (!camarim) return;
  const bulb = c.m.flat('#fff6e0', { emissive: '#ffe2a8' });
  const br = 0.02;
  const z = zb + 0.025 + br * 0.55;
  const put = (x, y) => g.add(kit.place(kit.sphere(br, bulb, { seg: 12, part: 'detail' }), { x, y, z }));
  const xs = mw / 2 - fr / 2;
  const nV = Math.max(3, Math.round((H - hTop - fr) / 0.13));
  for (let i = 0; i < nV; i++) {
    const y = hTop + fr + ((H - hTop - 1.5 * fr) * (i + 0.5)) / nV;
    put(-xs, y);
    put(xs, y);
  }
  const nH = Math.max(2, Math.round((mw - 2 * fr) / 0.14));
  for (let i = 0; i < nH; i++) put(-mw / 2 + fr + ((mw - 2 * fr) * (i + 0.5)) / nH, H - fr / 2);
}

/* ================================================================== */
/* Rack, painel e home theater                                         */
/* ================================================================== */
export function rack(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('rack');
  const { st, W, H, D } = c;
  if (st.panel && H > 0.9) panelRack(c, g);
  else if (H > 1.25 && W > 1.3) homeTheater(c, g);
  else rackUnit(c, g, { x0: -W / 2, x1: W / 2, y0: 0, y1: H, zb: -D / 2, zf: D / 2 });
  return consolidate(c, g);
}
// Rack baixo: base (pés/rodapé), corpo em módulos (portas nas pontas, nichos no meio), tampo
function rackUnit(c, g, b, opt = {}) {
  const { st } = c;
  const W = b.x1 - b.x0;
  const H = b.y1 - b.y0;
  // suspenso ("Rack Bancada Suspenso"): sem pés nem rodapé, fundo reto (fica na parede)
  const floating = opt.baseH === 0 || (opt.legs == null && st.wallMount);
  const type = floating ? 'none' : opt.legs ?? legKind(c, st.woodLook ? 'tapered' : 'none');
  const lh = floating ? 0 : type === 'none' ? (opt.baseH ?? clamp(H * 0.08, 0.03, 0.06)) : type === 'palito' ? clamp(H * 0.26, 0.1, 0.2) : isMetalLeg(type) ? clamp(H * 0.22, 0.1, 0.2) : clamp(H * 0.14, 0.06, 0.12);
  const style = frontStyle(c);
  let pull = pullType(c, style === 'slats' || style === 'cane' ? 'none' : 'cutout');
  const ft = Math.min(0.018, (b.zf - b.zb) * 0.12);
  if (b.zf - b.zb - ft - pullDepth(pull) < 0.06) pull = 'cutout';
  const zf = b.zf - ft - pullDepth(pull);
  if (lh > 0) baseUnder(c, g, { x0: b.x0, x1: b.x1, zb: b.zb, zf, type, h: lh });
  const y0 = b.y0 + lh;
  // tampo um pouco mais grosso, até a frente das portas
  const tt = 0.025;
  const yTop = b.y1;
  g.add(boxAt(c, b.x0, b.x1, yTop - tt, yTop, b.zb, zf + ft, topMat(c).userData?.type === 'glass' ? c.body : topMat(c), { r: 0.003, seg: 2 }));
  // layout dos módulos
  const mods = opt.mods || rackModules(c, W, yTop - tt - y0);
  return caseRow(c, g, {
    x0: b.x0, x1: b.x1, y0, y1: yTop - tt, zb: b.zb, zf, top: false, mods, pull, ft, style: st.glass ? 'flat' : style, led: st.led,
    fill: opt.fill === false ? null : (r) => rackFill(c, g, r),
  });
}
function rackModules(c, W, h) {
  const { st } = c;
  const glass = !!st.glass;
  const doorT = glass ? 'glass' : 'doors';
  if (W < 0.95) return [{ w: 1, type: doorT, n: 1, side: 'left' }, { w: 1, type: st.drawers ? 'rows' : 'niche', rows: [{ f: 1, type: 'drawers', n: 1 }, { f: 1.3, type: 'niche' }], shelves: 0 }];
  const nm = clamp(Math.round(W / 0.45), 3, 6);
  const doors = clamp(st.doors ?? (W >= 1.4 ? 2 : 1), 0, nm);
  const mods = Array.from({ length: nm }, () => ({ w: 1, type: 'niche', shelves: h > 0.55 ? 1 : 0 }));
  // portas nas pontas (de fora para dentro)
  const order = [];
  for (let i = 0; i < Math.ceil(nm / 2); i++) order.push(nm - 1 - i, i);
  for (let k = 0; k < doors; k++) {
    const i = order[k];
    if (i == null) break;
    mods[i] = { w: 1, type: doorT, n: 1, side: i < nm / 2 ? 'right' : 'left' };
  }
  // gavetas no meio (embaixo), nicho em cima
  let drawers = st.drawers || 0;
  for (let i = 0; i < nm && drawers > 0; i++) {
    if (mods[i].type !== 'niche') continue;
    mods[i] = { w: 1, type: 'rows', rows: [{ f: 1, type: 'drawers', n: 1 }, { f: h > 0.4 ? 1.2 : 1, type: 'niche' }] };
    drawers--;
  }
  return mods;
}
// Objetos nos nichos do rack (poucos: livros deitados, vaso)
function rackFill(c, g, r) {
  if (r.kind !== 'niche' && r.kind !== 'open') return;
  const { x0, x1, y, h, zb, zf } = r;
  const w = x1 - x0;
  if (h < 0.12 || w < 0.2) return;
  const p = c.r();
  if (p < 0.35) bookStack(c, g, { x: x0 + w * 0.35, y, z: (zb + zf) / 2, wMax: w * 0.6, dMax: (zf - zb) * 0.8, hMax: Math.min(0.07, h * 0.4) });
  else if (p < 0.6 && h > 0.16) vase(c, g, { x: x0 + w * 0.5, y, z: (zb + zf) / 2, h: Math.min(h * 0.75, 0.2), rMax: Math.min(w * 0.2, (zf - zb) * 0.35), color: c.r.pick(['#e9e4da', '#2b2b2b', '#b5703a']) });
}
// Rack com painel (ou painel suspenso): placa alta no fundo, prateleira/nicho no alto, rack na frente
function panelRack(c, g) {
  const { kit, st, W, H, D } = c;
  const pt = 0.025;
  // bicolor ("Off White e Nogueira"): o painel (ripado ou liso) é a parte em madeira
  const pm = twoTone(c) ? woodMat(c, c.C.wood, 'oak') : c.body;
  const zb = -D / 2;
  // painel (do chão ao topo)
  const slats = st.headboard === 'slats' || c.has(/ ripad/);
  g.add(boxAt(c, -W / 2, W / 2, 0, H, zb, zb + (slats ? 0.012 : pt), slats ? innerMat(c, pm) : pm, { r: 0.002, seg: 2, grain: 'y' }));
  if (slats) {
    const sw = 0.03;
    const n = Math.max(6, Math.round(W / 0.045));
    const step = W / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + step * (i + 0.5);
      g.add(boxAt(c, x - sw / 2, x + sw / 2, 0, H, zb + 0.012, zb + pt, pm, { r: 0, grain: 'y' }));
    }
  } else {
    // frisos horizontais (placas emendadas)
    for (const f of [0.52, 0.78]) g.add(boxAt(c, -W / 2 + 0.002, W / 2 - 0.002, H * f - 0.002, H * f + 0.002, zb + pt - 0.001, zb + pt + 0.0005, innerMat(c, pm), { r: 0 }));
  }
  const suspended = D <= 0.3;
  const rd = D - pt;
  if (!suspended) {
    // rack na frente do painel
    const rh = clamp(H * 0.3, 0.4, 0.6);
    rackUnit(c, g, { x0: -W / 2, x1: W / 2, y0: 0, y1: rh, zb: zb + pt, zf: D / 2 });
  } else {
    // rack suspenso preso ao painel
    const sy = clamp(H * 0.22, 0.25, 0.42);
    const sh = clamp(H * 0.16, 0.18, 0.3);
    const sw = W * 0.86;
    rackUnit(c, g, { x0: -sw / 2, x1: sw / 2, y0: sy, y1: sy + sh, zb: zb + pt, zf: D / 2 }, { legs: 'none', baseH: 0, fill: false });
  }
  // prateleira em caixa no alto do painel (meia largura, com LED)
  const bw = W * 0.55;
  const bx = W / 2 - bw / 2 - W * 0.06;
  const by = H - clamp(H * 0.16, 0.18, 0.3);
  const bh = 0.16;
  const bd = Math.min(rd, 0.22);
  const t = 0.018;
  g.add(boxAt(c, bx - bw / 2, bx + bw / 2, by, by + t, zb + pt, zb + pt + bd, pm));
  g.add(boxAt(c, bx - bw / 2, bx + bw / 2, by + bh - t, by + bh, zb + pt, zb + pt + bd, pm));
  g.add(boxAt(c, bx - bw / 2, bx - bw / 2 + t, by + t, by + bh - t, zb + pt, zb + pt + bd, pm));
  g.add(boxAt(c, bx + bw / 2 - t, bx + bw / 2, by + t, by + bh - t, zb + pt, zb + pt + bd, pm));
  if (st.led) ledStrip(c, g, bx - bw / 2 + 0.02, bx + bw / 2 - 0.02, by - 0.0005, zb + pt + bd - 0.02);
  fillCompartment(c, g, { x0: bx - bw / 2 + t, x1: bx + bw / 2 - t, y: by + t, h: bh - 2 * t, zb: zb + pt, zf: zb + pt + bd, density: 1.2 });
  void kit;
}
// Home theater: rack + torres laterais + ponte no alto
function homeTheater(c, g) {
  const { W, H, D } = c;
  const rh = clamp(H * 0.3, 0.42, 0.6);
  rackUnit(c, g, { x0: -W / 2, x1: W / 2, y0: 0, y1: rh, zb: -D / 2, zf: D / 2 });
  const tw = clamp(W * 0.17, 0.3, 0.45);
  const td = Math.min(D, Math.max(0.2, D * 0.72));
  const zb = -D / 2;
  const pull = pullType(c, 'cutout');
  const bridgeH = clamp((H - rh) * 0.22, 0.2, 0.32);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W / 2 : W / 2 - tw;
    caseRow(c, g, {
      x0, x1: x0 + tw, y0: rh, y1: H - bridgeH, zb, zf: zb + td - 0.018, mods: [{ w: 1, type: 'rows', rows: [{ f: 1, type: c.st.glass ? 'glass' : 'doors', n: 1, side: sx < 0 ? 'right' : 'left' }, { f: 1.4, type: 'niche' }] }],
      pull, top: false, fill: (r) => fillCompartment(c, g, { ...r, density: 1 }),
    });
  }
  caseRow(c, g, { x0: -W / 2, x1: W / 2, y0: H - bridgeH, y1: H, zb, zf: zb + td, mods: [{ w: 1, type: 'niche', shelves: 0 }, { w: 2.2, type: 'niche', shelves: 0 }, { w: 1, type: 'niche', shelves: 0 }], led: c.st.led, fill: (r) => fillCompartment(c, g, { ...r, density: 0.8 }) });
  // fundo do vão da TV
  g.add(boxAt(c, -W / 2 + tw, W / 2 - tw, rh, H - bridgeH, zb, zb + 0.012, innerMat(c, c.body), { r: 0 }));
}

/* ================================================================== */
/* Estante                                                             */
/* ================================================================== */
export function shelf(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('shelf');
  const { st, W, H, D } = c;
  if (st.floating || (st.wallMount && H <= 0.12)) floatingShelf(c, g);
  else if (st.ladder || c.has(/ escada /)) ladderShelf(c, g);
  else if (H < 0.6 && W < 0.9) nicheBox(c, g);
  else if (st.corner || c.has(/ cantoneira /)) cornerShelf(c, g);
  else if (isSteelShelving(c)) steelShelf(c, g);
  else if (metalBase(c) || c.spec.material === 'metal' || c.spec.material === 'steel') metalShelf(c, g);
  else bookcase(c, g);
  return consolidate(c, g);
}
// "Estante de Aço 5 Prateleiras - Cinza": toda de chapa (sem madeira, MDF ou pegada industrial no nome)
const isSteelShelving = (c) => (c.spec.material === 'metal' || c.spec.material === 'steel') && !c.st.woodLook && !c.st.industrial && !c.words.some((w) => w.wood) && !c.has(/ madeira | mdf | mdp | tampo | prateleiras? de (madeira|mdf|vidro) /);
// Estante de livros: laterais, rodapé, fundo, colunas, prateleiras; portas/gavetas embaixo; cristaleira
function bookcase(c, g) {
  const { st, W, H, D } = c;
  const t = 0.018;
  // estante suspensa/de parede: sem rodapé nem pés
  const hung = !!st.wallMount;
  const type = hung ? 'none' : legKind(c, 'none');
  const lh = hung ? 0 : type === 'none' ? 0.05 : type === 'palito' ? clamp(H * 0.1, 0.1, 0.2) : clamp(H * 0.08, 0.06, 0.15);
  const glassDoors = !!st.glassDoors;
  const pull = pullType(c, glassDoors ? 'knob' : 'bar');
  const hasFronts = glassDoors || st.doors || st.drawers;
  const zf = D / 2 - (hasFronts ? 0.018 + pullDepth(pull) : 0);
  if (!hung) baseUnder(c, g, { x0: -W / 2, x1: W / 2, zb: -D / 2, zf: hasFronts ? zf : D / 2, type, h: lh });
  // até ~90 cm é um vão só (prateleira inteira); mais largo, colunas de ~42 cm
  let nc = W < 0.9 ? 1 : clamp(Math.round(W / 0.42), 2, 6);
  const books = c.has(/ livr| biblioteca /);
  let levels = Math.max(2, typeof st.shelf === 'number' ? st.shelf : Math.round((H - lh) / 0.36));
  const lowH = st.doors || st.drawers ? clamp((H - lh) * 0.3, 0.4, 0.8) : 0;
  // "8 Nichos": grade colunas x níveis com esse total e vãos o mais perto possível de quadrados
  const nn = Number(st.niche) || 0;
  if (nn >= 2 && !lowH && !glassDoors) {
    let best = null;
    for (let cols = 1; cols <= Math.min(6, nn); cols++) {
      const rws = Math.ceil(nn / cols);
      const cw = W / cols;
      const ch = (H - lh) / rws;
      if (cw < 0.22 || ch < 0.18) continue;
      const score = Math.abs(Math.log(cw / ch)) + (cols * rws !== nn ? 0.6 : 0);
      if (!best || score < best.score) best = { cols, rws, score };
    }
    if (best) {
      nc = best.cols;
      levels = Math.max(1, best.rws);
    }
  }
  const openBack = !!(st.openBack || c.has(/ vazad/));
  const rows = [];
  if (lowH) rows.push({ f: lowH, type: st.doors ? 'doors' : 'drawers', n: st.doors ? 1 : clamp(st.drawers, 1, 3) });
  const upLevels = Math.max(1, levels - (lowH ? 1 : 0));
  // estante com muitos nichos: menos livros por fileira, espalhados por todos (cabe no limite de livros)
  // (cada nicho leva em média ~0,55 fileira + 1,5 livro de pilha/inclinado)
  if (nc * upLevels > 12) c.rowCap = Math.max(3, Math.floor((BOOK_CAP / (nc * upLevels) - 1.5) / 0.55));
  const upH = H - lh - lowH;
  if (glassDoors) rows.push({ f: upH, type: 'glass', n: 1, shelves: upLevels - 1, glassShelves: true });
  else for (let i = 0; i < upLevels; i++) rows.push({ f: upH / upLevels, type: 'open' });
  // portas: distribui entre as colunas (1 porta por coluna quando há muitas)
  const mods = Array.from({ length: nc }, (_, i) => ({ w: 1, type: 'rows', rows: rows.map((r) => ({ ...r, side: i < nc / 2 ? 'right' : 'left' })) }));
  if (glassDoors && nc === 1) mods[0].rows = mods[0].rows.map((r) => (r.type === 'glass' ? { ...r, n: W > 0.6 ? 2 : 1 } : r));
  // número de portas do nome ("2 Portas" numa estante de 3 colunas): portas nas colunas de fora,
  // as do meio ficam com nicho aberto embaixo; com mais portas que colunas, até 2 por coluna
  if (lowH && st.doors && typeof st.doors === 'number' && st.doors !== nc) {
    const per = new Array(nc).fill(0);
    const order = [];
    for (let k = 0; k < Math.ceil(nc / 2); k++) {
      order.push(k);
      if (nc - 1 - k !== k) order.push(nc - 1 - k);
    }
    let left = clamp(st.doors, 1, nc * 2);
    while (left > 0 && per.some((p) => p < 2)) {
      for (const i of order) {
        if (left > 0 && per[i] < 2) {
          per[i]++;
          left--;
        }
      }
    }
    mods.forEach((md, i) => {
      md.rows[0] = per[i] ? { ...md.rows[0], n: per[i] } : { ...md.rows[0], type: 'open', n: 1 };
    });
  }
  caseRow(c, g, {
    x0: -W / 2, x1: W / 2, y0: lh, y1: H, zb: -D / 2, zf: hasFronts ? zf : D / 2, mods, pull, back: !openBack, style: frontStyle(c), pullPos: 'mid',
    // cristaleira "com espelho": fundo espelhado
    inner: glassDoors && st.mirror ? c.m.metal('#e3eaee', { finish: 'chrome' }) : undefined,
    fill: (r) => (r.kind === 'glass' ? dishes(c, g, r) : fillCompartment(c, g, { ...r, density: books ? 1.4 : openBack ? 0.7 : 1 })),
  });
}
// Prateleira flutuante (de parede): uma tábua de cantos suaves, suporte escondido
function floatingShelf(c, g) {
  const { W, H, D } = c;
  g.add(boxAt(c, -W / 2, W / 2, 0, H, -D / 2, D / 2, c.body, { r: Math.min(0.004, H / 4), seg: 2, grain: 'x' }));
}
// Louças na cristaleira: pratos em pé, copos e tigelas
function dishes(c, g, { x0, x1, y, h, zb, zf }) {
  const { kit, m, r } = c;
  const w = x1 - x0;
  if (h < 0.12 || w < 0.15) return;
  const porcelain = m.plastic('#f3f1ec', { gloss: 0.8 });
  const glass = m.glass({ tint: '#e4ecea', opacity: 0.35 });
  const zc = (zb + zf) / 2;
  const p = r();
  if (p < 0.5) {
    // pratos em pé, de frente, encostados no fundo
    const pr = Math.min(h * 0.42, 0.12, w * 0.3);
    const n = clamp(Math.floor((w - 0.02) / (2 * pr + 0.015)), 1, 4);
    const gapX = (w - n * 2 * pr) / (n + 1);
    for (let i = 0; i < n; i++) {
      const pl = kit.lathe([[0.0001, 0], [pr * 0.55, 0], [pr * 0.62, 0.004], [pr, 0.016], [pr * 0.97, 0.019], [pr * 0.6, 0.007], [0.0001, 0.006]], porcelain, { seg: 32, part: 'detail' });
      pl.rotation.x = Math.PI / 2 - 0.16; // de frente, levemente inclinado para trás
      pl.position.set(x0 + gapX + pr + i * (2 * pr + gapX), y + pr * Math.cos(0.16) + 0.002, zb + 0.006 + pr * Math.sin(0.16));
      g.add(pl);
    }
  } else {
    const n = Math.max(2, Math.floor(w / 0.09));
    const gh = Math.min(h * 0.7, 0.14);
    for (let i = 0; i < n; i++) {
      const cup = kit.lathe([[0.0001, 0], [0.026, 0], [0.028, 0.006], [0.032, gh], [0.029, gh], [0.0001, 0.008]], glass, { seg: 20, part: 'detail' });
      cup.position.set(x0 + w * ((i + 0.5) / n), y, zc);
      g.add(cup);
    }
  }
}
// Nicho (caixa aberta) pequeno
function nicheBox(c, g) {
  const { W, H, D } = c;
  caseRow(c, g, { x0: -W / 2, x1: W / 2, y0: 0, y1: H, zb: -D / 2, zf: D / 2, mods: [{ w: 1, type: 'open', shelves: 0 }], fill: (r) => fillCompartment(c, g, { ...r, density: 1.3 }) });
}
// Estante escada (encostada na parede): montantes inclinados e prateleiras cada vez mais rasas
function ladderShelf(c, g) {
  const { st, W, H, D } = c;
  const a = clamp(D * 0.12, 0.03, 0.05); // largura horizontal do montante
  const rw = clamp(W * 0.05, 0.03, 0.045);
  const pts = [[D / 2 - a, 0], [D / 2, 0], [-D / 2 + a, H], [-D / 2, H]];
  for (const sx of [-1, 1]) g.add(prismX(c, pts, sx > 0 ? W / 2 - rw : -W / 2, sx > 0 ? W / 2 : -W / 2 + rw, c.body, { grain: 'y' }));
  const n = Math.max(3, typeof st.shelf === 'number' ? st.shelf : Math.round(H / 0.36));
  const t = 0.018;
  for (let i = 0; i < n; i++) {
    const y = 0.12 + ((H - 0.2) * i) / Math.max(1, n - 1);
    const zFront = D / 2 - ((D - a) * (y + t)) / H; // borda da frente do montante nessa altura
    const zBack = -D / 2 + 0.005;
    if (zFront - zBack < 0.08) continue;
    g.add(boxAt(c, -W / 2 + rw, W / 2 - rw, y, y + t, zBack, zFront, c.body));
    const h = i < n - 1 ? (H - 0.2) / Math.max(1, n - 1) - t - 0.01 : H - y - t;
    fillCompartment(c, g, { x0: -W / 2 + rw + 0.01, x1: W / 2 - rw - 0.01, y: y + t, h: Math.min(h, 0.3), zb: zBack, zf: zFront - 0.01, density: 0.8 });
  }
}
// Cantoneira: prateleiras em quarto de círculo presas a dois painéis no canto (fundo-esquerda)
function cornerShelf(c, g) {
  const { THREE, kit, st, W, H, D } = c;
  const t = 0.018;
  const n = Math.max(3, typeof st.shelf === 'number' ? st.shelf : Math.round(H / 0.32));
  g.add(boxAt(c, -W / 2, W / 2, 0, H, -D / 2, -D / 2 + t, c.body, { ...R2, grain: 'y' }));
  g.add(boxAt(c, -W / 2, -W / 2 + t, 0, H, -D / 2 + t, D / 2, c.body, { ...R2, grain: 'y' }));
  for (let i = 0; i < n; i++) {
    const y = i === 0 ? 0.04 : ((H - t) * i) / (n - 1);
    const s = new THREE.Shape();
    // quarto de elipse com o canto em (-W/2, -D/2) -> no contorno (x, -z) o canto fica em (-W/2, D/2)
    s.moveTo(-W / 2, D / 2);
    s.lineTo(W / 2, D / 2);
    s.absellipse(-W / 2, D / 2, W, D, 0, -Math.PI / 2, true, 0);
    s.lineTo(-W / 2, D / 2);
    g.add(kit.place(plate(c, s, t, c.body, { bevel: 0.002, seg: 32 }), { y }));
    if (i < n - 1) fillCompartment(c, g, { x0: -W / 2 + 0.04, x1: -W / 2 + W * 0.5, y: y + t, h: (H - t) / (n - 1) - t - 0.01, zb: -D / 2 + t, zf: -D / 2 + D * 0.55, density: 0.7 });
  }
}
// Estante de aço (sem madeira no nome): cantoneiras perfuradas, bandejas de chapa com aba, caixas
function steelShelf(c, g) {
  const { st, W, H, D, kit, m, r } = c;
  const sm = c.metal;
  const a = 0.035; // aba da cantoneira
  const ct = 0.002;
  const holes = m.flat('#2a2a2a', { roughness: 0.8 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - a / 2);
      const z = sz * (D / 2 - ct / 2);
      // cantoneira em L: aba na frente/fundo e aba na lateral
      g.add(boxAt(c, x - a / 2, x + a / 2, 0, H, z - ct / 2, z + ct / 2, sm, { r: 0 }));
      g.add(boxAt(c, sx > 0 ? W / 2 - ct : -W / 2, sx > 0 ? W / 2 : -W / 2 + ct, 0, H, sz > 0 ? D / 2 - a : -D / 2, sz > 0 ? D / 2 : -D / 2 + a, sm, { r: 0 }));
      // furos (faixa escura discreta)
      const n = Math.floor(H / 0.05);
      for (let i = 1; i < n; i++) g.add(boxAt(c, x - 0.004, x + 0.004, i * 0.05 - 0.007, i * 0.05 + 0.007, z + sz * ct / 2, z + sz * (ct / 2 - 0.0006), holes, { r: 0, part: 'detail' }));
    }
  }
  const n = Math.max(3, typeof st.shelf === 'number' ? st.shelf : Math.round(H / 0.4) + 1);
  const ys = [];
  for (let i = 0; i < n; i++) ys.push(0.06 + ((H - 0.06 - 0.004) * i) / (n - 1));
  ys.forEach((y, i) => {
    // bandeja: chapa + abas dobradas na frente e no fundo
    g.add(boxAt(c, -W / 2 + ct, W / 2 - ct, y - 0.004, y, -D / 2 + ct, D / 2 - ct, sm, { r: 0 }));
    for (const sz of [-1, 1]) g.add(boxAt(c, -W / 2 + ct, W / 2 - ct, y - 0.032, y, sz > 0 ? D / 2 - ct - 0.0015 : -D / 2 + ct, sz > 0 ? D / 2 - ct : -D / 2 + ct + 0.0015, sm, { r: 0 }));
    if (i < n - 1) storageFill(c, g, { x0: -W / 2 + a + 0.01, x1: W / 2 - a - 0.01, y, h: ys[i + 1] - y - 0.04, zb: -D / 2 + 0.01, zf: D / 2 - 0.01 });
  });
  // X de reforço no fundo (vão de baixo) e nas laterais
  const xBar = (x0, x1, z0, z1, y0, y1, alongX) => {
    const L = Math.hypot(alongX ? x1 - x0 : z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, alongX ? x1 - x0 : z1 - z0);
    for (const s of [-1, 1]) {
      const bar = kit.box(alongX ? L : 0.002, alongX ? 0.014 : 0.014, alongX ? 0.002 : L, sm, { part: 'metal' });
      if (alongX) bar.rotation.z = s * ang;
      else bar.rotation.x = -s * ang;
      bar.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      g.add(bar);
    }
  };
  const yb0 = ys[0] + 0.02;
  const yb1 = ys[1] - 0.04;
  xBar(-W / 2 + a, W / 2 - a, -D / 2 + 0.0035, -D / 2 + 0.0035, yb0, yb1, true);
  for (const sx of [-1, 1]) xBar(sx * (W / 2 - 0.0035), sx * (W / 2 - 0.0035), -D / 2 + a, D / 2 - a, yb0, yb1, false);
  void r;
}
// Caixas organizadoras / de papelão numa prateleira de aço
function storageFill(c, g, { x0, x1, y, h, zb, zf }) {
  const { r, m } = c;
  if (h < 0.12) return;
  let x = x0 + r() * 0.05;
  let k = 0;
  while (x < x1 - 0.2 && k < 4) {
    const w = Math.min(x1 - x, 0.22 + r() * 0.16);
    const bh = Math.min(h - 0.01, 0.14 + r() * 0.12);
    const d = Math.min(zf - zb - 0.02, 0.22 + r() * 0.1);
    if (r() < 0.78) {
      const col = r.pick(['#b8916a', '#c4a27a', '#a9845d', '#e9e4da', '#3c4a5a']);
      g.add(boxAt(c, x, x + w, y, y + bh, zb + 0.01, zb + 0.01 + d, m.paint(col, { gloss: 0.1 }), { r: 0.002, seg: 1, part: 'detail' }));
    }
    x += w + 0.02 + r() * 0.06;
    k++;
  }
}
// Estante industrial: montantes de metal, prateleiras de madeira e travas em X nas laterais
function metalShelf(c, g) {
  const { st, W, H, D } = c;
  const tube = 0.022;
  const m = c.metal;
  const sm = c.spec.material === 'metal' || c.spec.material === 'steel' ? woodMat(c, C_WOOD(c), 'oak') : c.st.woodLook ? c.body : c.wood;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(boxAt(c, sx * (W / 2 - tube / 2) - tube / 2, sx * (W / 2 - tube / 2) + tube / 2, 0, H, sz * (D / 2 - tube / 2) - tube / 2, sz * (D / 2 - tube / 2) + tube / 2, m, { r: 0.002, seg: 2 }));
  }
  const n = Math.max(3, typeof st.shelf === 'number' ? st.shelf : Math.round(H / 0.4) + 1);
  const t = 0.025;
  const ys = [];
  for (let i = 0; i < n; i++) ys.push(i === 0 ? 0.08 : 0.08 + ((H - t - 0.08) * i) / (n - 1));
  ys.forEach((y, i) => {
    g.add(boxAt(c, -W / 2 + 0.001, W / 2 - 0.001, y, y + t, -D / 2 + 0.001, D / 2 - 0.001, sm, { r: 0.003, seg: 2 }));
    // travessas sob a prateleira
    for (const sz of [-1, 1]) g.add(boxAt(c, -W / 2 + tube, W / 2 - tube, y - 0.02, y, sz * (D / 2 - tube / 2) - 0.008, sz * (D / 2 - tube / 2) + 0.008, m, { r: 0 }));
    if (i < n - 1) fillCompartment(c, g, { x0: -W / 2 + tube + 0.01, x1: W / 2 - tube - 0.01, y: y + t, h: ys[i + 1] - y - t - 0.02, zb: -D / 2 + 0.02, zf: D / 2 - 0.02, density: 0.9 });
  });
  // X nas laterais (barras finas)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < n - 1; i++) {
      const y0 = ys[i] + t;
      const y1 = ys[i + 1] - 0.02;
      const L = Math.hypot(D - tube * 2, y1 - y0);
      const ang = Math.atan2(y1 - y0, D - tube * 2);
      for (const s of [-1, 1]) {
        const bar = c.kit.box(0.004, 0.012, L, m, { part: 'metal' });
        bar.rotation.x = s * ang;
        bar.position.set(sx * (W / 2 - tube / 2), (y0 + y1) / 2, 0);
        g.add(bar);
      }
    }
  }
}

/* ================================================================== */
/* Armário de cozinha                                                  */
/* ================================================================== */
export function kitchen_cabinet(spec, kit, THREE) {
  const c = ctx(spec, kit, THREE);
  const g = kit.group('kitchen_cabinet');
  const { st, W, H } = c;
  // conjunto ("Cozinha Completa 5 Peças com Balcão e Paneleiro") vence as palavras das peças
  const kitchenSet = H >= 1.15 && W >= 1.0 && c.has(/ cozinhas? (compact|complet|modulad|planejad|american)[oa]s?| \d+ pecas | kit cozinha /);
  const layout = st.layout || (kitchenSet ? 'compact' : c.has(/ aereo | aereos /) ? 'wall' : c.has(/ paneleir/) || (H > 1.6 && W < 0.95) ? 'tall' : H < 1.15 ? 'base' : 'compact');
  if (layout === 'wall') wallCabinet(c, g, { x0: -c.W / 2, x1: c.W / 2, y0: 0, y1: H, zb: -c.D / 2, zf: c.D / 2 });
  else if (layout === 'tall') tallCabinet(c, g, { x0: -c.W / 2, x1: c.W / 2, y1: H, zb: -c.D / 2, zf: c.D / 2 });
  else if (layout === 'base') baseCabinet(c, g, { x0: -c.W / 2, x1: c.W / 2, y1: H, zb: -c.D / 2, zf: c.D / 2, sink: st.sink ?? c.has(/ pia | cuba /), cooktop: st.cooktop ?? c.has(/ cooktop /), counts: true });
  else compactKitchen(c, g);
  return consolidate(c, g);
}
const kPull = (c) => pullType(c, 'bar');
function counterMat(c, sink = false) {
  const { m, C, st } = c;
  if (isMarble(c)) return m.marble(marbleColor(c));
  if (c.sinkInox || st.inox || c.has(/ tampo (de )?inox /)) return m.metal('#cfd2d4', { finish: 'brushed' });
  if (st.woodLook) return c.body;
  // balcão de pia sem tampo citado: mármore sintético claro (o padrão desses gabinetes)
  if (sink && !c.has(/ tampo (de |em )?(madeira|mdf|mdp) /)) return m.marble('#ecebe6');
  return woodMat(c, C_WOOD(c), 'smooth');
}
// Balcão (base com tampo): gaveteiro + portas; cuba e cooktop opcionais
// Módulos do balcão a partir das portas/gavetas citadas no nome ("2 Portas 1 Gaveta": gaveta em cima,
// portas embaixo; "1 Porta 3 Gavetas": gaveteiro + porta). Devolve null quando o nome não cita nenhuma.
function counterModules(c, sink) {
  const { st } = c;
  const exDoors = c.has(/ (\d+|uma|duas|tres|quatro) portas? /) ? clamp(Number(st.doors) || 0, 0, 8) : null;
  const exDrawers = c.has(/ (\d+|uma|duas|tres|quatro) gavetas? /) ? clamp(Number(st.drawers) || 0, 0, 6) : null;
  if (exDoors == null && exDrawers == null) return null;
  const nd = exDrawers ?? 0;
  const W = c.W;
  const nD = exDoors ?? Math.max(1, Math.round(W / 0.42) - (nd >= 3 ? 1 : 0));
  // portas em grupos de até 2 (cada grupo é um módulo)
  const groups = [];
  for (let k = nD; k > 0; k -= 2) groups.push(Math.min(2, k));
  if (nd >= 3 || (nd && !nD)) {
    const mods = groups.map((n) => ({ w: n, type: 'doors', n }));
    const col = { w: 1, type: 'drawers', n: Math.max(1, Math.min(4, nd)) };
    if (sink) mods.push(col);
    else mods.unshift(col);
    return mods;
  }
  // 1 ou 2 gavetas: uma faixa de gaveta em cima de cada módulo de portas
  const cols = Math.max(nd, groups.length, 1);
  while (groups.length < cols) {
    const i = groups.findIndex((n) => n === 2);
    if (i < 0) break;
    groups.splice(i, 1, 1, 1);
  }
  return groups.map((n, i) => (i < nd ? { w: n, type: 'rows', rows: [{ f: 2.6, type: 'doors', n, side: i % 2 ? 'left' : 'right' }, { f: 1, type: 'drawers', n: 1 }] } : { w: n, type: 'doors', n, side: i % 2 ? 'left' : 'right' }));
}
function baseCabinet(c, g, { x0, x1, y1, zb, zf, sink, cooktop, faucetRoom = 0, counts = false }) {
  const { THREE, kit, st } = c;
  const W = x1 - x0;
  const pull = kPull(c);
  const ct = 0.03;
  const zFr = zf - 0.018 - pullDepth(pull);
  const plH = 0.08;
  plinth(c, g, x0, x1, plH, zb, zFr, 0.05);
  // módulos: gaveteiro + portas
  const nMod = Math.max(1, Math.round(W / 0.42));
  const mods = [];
  for (let i = 0; i < nMod; i++) mods.push({ w: 1, type: 'doors', n: 1, side: i % 2 ? 'left' : 'right' });
  if (nMod >= 2) {
    const di = sink ? nMod - 1 : 0;
    mods[di] = { w: 1, type: 'drawers', n: clamp(st.drawers || 3, 1, 4) };
    // portas em pares
    for (let i = 0; i + 1 < mods.length; i++) {
      if (mods[i].type === 'doors' && mods[i + 1].type === 'doors' && mods[i].n === 1 && mods[i + 1].n === 1) {
        mods.splice(i, 2, { w: 2, type: 'doors', n: 2 });
      }
    }
  } else if (st.drawers) mods[0] = { w: 1, type: 'rows', rows: [{ f: 2.6, type: 'doors', n: 1 }, { f: 1, type: 'drawers', n: 1 }] };
  const named = counts ? counterModules(c, sink) : null;
  if (named) mods.splice(0, mods.length, ...named);
  caseRow(c, g, { x0, x1, y0: plH, y1: y1 - ct, zb, zf: zFr, mods, pull, style: frontStyle(c), pullPos: 'top' });
  // tampo (com furo da cuba) e cuba/cooktop
  const cm = counterMat(c, sink);
  const sw = Math.min(0.56, W * 0.42);
  const sd = Math.min(0.38, (zf - zb) * 0.66);
  const scx = sink ? x0 + W * (mods.length > 1 ? 0.32 : 0.5) : 0;
  const scz = (zb + zf) / 2 + 0.01;
  const shape = rectShape(THREE, x0, x1, -zf, -zb, [0.003, 0.003, 0.003, 0.003]);
  if (sink) {
    const hole = rectShape(THREE, scx - sw / 2, scx + sw / 2, -scz - sd / 2, -scz + sd / 2, [0.03, 0.03, 0.03, 0.03]);
    shape.holes.push(hole);
  }
  g.add(kit.place(plate(c, shape, ct, cm, { bevel: 0.003, seg: 8 }), { y: y1 - ct }));
  if (sink) sinkBasin(c, g, { cx: scx, cz: scz, w: sw, d: sd, yTop: y1, faucet: faucetRoom > 0.25 });
  if (cooktop) {
    const cw = Math.min(0.6, W * 0.4);
    const cx = sink ? x1 - cw / 2 - 0.08 : 0;
    cooktopAt(c, g, { cx, cz: scz, w: cw, d: Math.min(0.5, (zf - zb) - 0.08), y: y1 });
  }
}
function sinkBasin(c, g, { cx, cz, w, d, yTop, faucet }) {
  const { kit, m } = c;
  const steel = m.metal('#d2d5d7', { finish: 'brushed' });
  const depth = 0.16;
  const wt = 0.004;
  // paredes e fundo da cuba
  g.add(boxAt(c, cx - w / 2, cx + w / 2, yTop - depth, yTop - depth + wt, cz - d / 2, cz + d / 2, steel, { r: 0 }));
  g.add(boxAt(c, cx - w / 2, cx - w / 2 + wt, yTop - depth, yTop - 0.002, cz - d / 2, cz + d / 2, steel, { r: 0 }));
  g.add(boxAt(c, cx + w / 2 - wt, cx + w / 2, yTop - depth, yTop - 0.002, cz - d / 2, cz + d / 2, steel, { r: 0 }));
  g.add(boxAt(c, cx - w / 2, cx + w / 2, yTop - depth, yTop - 0.002, cz - d / 2, cz - d / 2 + wt, steel, { r: 0 }));
  g.add(boxAt(c, cx - w / 2, cx + w / 2, yTop - depth, yTop - 0.002, cz + d / 2 - wt, cz + d / 2, steel, { r: 0 }));
  g.add(kit.place(kit.cylinder(0.022, 0.022, 0.003, m.flat('#3a3a3a', { metalness: 0.6, roughness: 0.4 }), { seg: 20 }), { x: cx, y: yTop - depth + wt + 0.0015, z: cz }));
  // borda da cuba sobre o tampo
  const rim = 0.012;
  g.add(boxAt(c, cx - w / 2 - rim, cx + w / 2 + rim, yTop, yTop + 0.002, cz - d / 2 - rim, cz - d / 2, steel, { r: 0 }));
  g.add(boxAt(c, cx - w / 2 - rim, cx + w / 2 + rim, yTop, yTop + 0.002, cz + d / 2, cz + d / 2 + rim, steel, { r: 0 }));
  g.add(boxAt(c, cx - w / 2 - rim, cx - w / 2, yTop, yTop + 0.002, cz - d / 2, cz + d / 2, steel, { r: 0 }));
  g.add(boxAt(c, cx + w / 2, cx + w / 2 + rim, yTop, yTop + 0.002, cz - d / 2, cz + d / 2, steel, { r: 0 }));
  if (faucet) {
    const chrome = m.metal('#dfe2e4', { finish: 'chrome' });
    const fz = cz - d / 2 - 0.045;
    g.add(kit.place(kit.cylinder(0.022, 0.025, 0.04, chrome, { seg: 20 }), { x: cx, y: yTop + 0.02, z: fz }));
    g.add(kit.tube([[cx, yTop + 0.03, fz], [cx, yTop + 0.22, fz], [cx, yTop + 0.27, fz + 0.06], [cx, yTop + 0.22, fz + 0.15], [cx, yTop + 0.17, fz + 0.16]], 0.011, chrome, { seg: 40, radial: 12 }));
  }
}
function cooktopAt(c, g, { cx, cz, w, d, y }) {
  const { kit, m } = c;
  g.add(boxAt(c, cx - w / 2, cx + w / 2, y - 0.004, y + 0.002, cz - d / 2, cz + d / 2, m.screen(), { r: 0.002, seg: 2 }));
  const ring2 = m.flat('#5a5a5a', { roughness: 0.5 });
  for (const [ax, az, rr] of [[-0.25, -0.22, 0.07], [0.25, -0.22, 0.055], [-0.25, 0.22, 0.055], [0.25, 0.22, 0.07]]) {
    const geo = new c.THREE.TorusGeometry(rr * Math.min(1, w / 0.6), 0.0025, 6, 40);
    geo.rotateX(Math.PI / 2);
    g.add(kit.place(kit.mesh(geo, ring2, { part: 'detail' }), { x: cx + ax * w, y: y + 0.0022, z: cz + az * d }));
  }
}
// Armário aéreo: portas (de vidro no meio, se houver), puxador embaixo; basculante = portas deitadas
function wallCabinet(c, g, { x0, x1, y0, y1, zb, zf }) {
  const { st } = c;
  const W = x1 - x0;
  const pull = kPull(c);
  const zFr = zf - 0.018 - pullDepth(pull);
  const doors = clamp(st.doors || Math.max(1, Math.round(W / 0.4)), 1, 8);
  const mods = [];
  if (c.has(/ basculante /)) {
    mods.push({ w: 1, type: 'rows', rows: [{ f: 1, type: 'flap', n: 1 }, { f: 1, type: 'flap', n: 1 }] });
  } else {
    const per = doors >= 4 ? 2 : 1;
    const nm = Math.max(1, Math.round(doors / per));
    for (let i = 0; i < nm; i++) {
      // vidro: a porta do meio (ou a última, quando são duas)
      const glassHere = st.glass && (nm === 1 || (nm % 2 === 1 ? i === Math.floor(nm / 2) : i === nm - 1));
      mods.push({ w: per, type: glassHere ? 'glass' : 'doors', n: per, glassShelves: true, side: i < nm / 2 ? 'right' : 'left' });
    }
  }
  caseRow(c, g, { x0, x1, y0, y1, zb, zf: zFr, mods, pull, style: frontStyle(c), pullPos: 'bottom', fill: (r) => (r.kind === 'glass' ? dishes(c, g, r) : null) });
}
// Paneleiro / torre: portas em cima e embaixo, nicho do micro-ondas/forno no meio
function tallCabinet(c, g, { x0, x1, y1, zb, zf, y0 = 0 }) {
  const { st } = c;
  const H = y1 - y0;
  const pull = kPull(c);
  const zFr = zf - 0.018 - pullDepth(pull);
  plinth(c, g, x0, x1, 0.08, zb, zFr, 0.05);
  const W = x1 - x0;
  const n = W > 0.65 ? 2 : 1;
  const rows = [{ f: 0.72, type: st.drawers ? 'drawers' : 'doors', n: st.drawers ? clamp(st.drawers, 2, 4) : n }, { f: 0.36, type: 'niche', shelves: 0 }, { f: 0.08, type: 'drawers', n: 1 }, { f: H - 0.08 - 1.24 > 0.3 ? H - 1.32 : 0.4, type: 'doors', n }];
  caseRow(c, g, { x0, x1, y0: y0 + 0.08, y1, zb, zf: zFr, mods: [{ w: 1, type: 'rows', rows }], pull, style: frontStyle(c), pullPos: 'mid', fill: (r) => (r.row?.type === 'niche' ? microwave(c, g, r) : null) });
}
// Micro-ondas embutido no nicho (silhueta simples)
function microwave(c, g, { x0, x1, y, h, zb, zf }) {
  const w = Math.min(x1 - x0 - 0.02, 0.5);
  const hh = Math.min(h - 0.02, 0.3);
  const d = Math.min(zf - zb - 0.02, 0.38);
  if (w < 0.3 || hh < 0.2 || d < 0.25) return;
  const cx = (x0 + x1) / 2;
  const z1 = zf - 0.005;
  g.add(boxAt(c, cx - w / 2, cx + w / 2, y, y + hh, z1 - d, z1, c.m.metal('#2a2b2d', { finish: 'painted' }), { r: 0.006 }));
  g.add(boxAt(c, cx - w / 2 + 0.02, cx + w * 0.18, y + 0.03, y + hh - 0.03, z1, z1 + 0.003, c.m.screen(), { r: 0 }));
  g.add(boxAt(c, cx + w * 0.24, cx + w / 2 - 0.025, y + hh * 0.62, y + hh - 0.04, z1, z1 + 0.003, c.m.screen({ on: false }), { r: 0 }));
}
// Cozinha compacta: balcão + aéreos + paneleiro (quando há largura)
function compactKitchen(c, g) {
  const { st, W, H, D } = c;
  const zb = -D / 2;
  const zf = D / 2;
  const tallW = W >= 1.4 ? clamp(W * 0.32, 0.55, 0.7) : 0;
  const baseH = Math.min(0.88, H * 0.46);
  const wallH = clamp(H * 0.34, 0.45, 0.72);
  const wd = Math.min(0.35, D * 0.68);
  const xR = W / 2 - tallW;
  if (tallW) tallCabinet(c, g, { x0: xR, x1: W / 2, y1: H, zb, zf });
  baseCabinet(c, g, { x0: -W / 2, x1: xR, y1: baseH, zb, zf, sink: st.sink ?? c.has(/ pia | cuba /), cooktop: st.cooktop ?? c.has(/ cooktop /), faucetRoom: H - wallH - baseH });
  wallCabinet(c, g, { x0: -W / 2, x1: xR, y0: H - wallH, y1: H, zb, zf: zb + wd });
}
