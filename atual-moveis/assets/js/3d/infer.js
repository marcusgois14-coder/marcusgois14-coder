// Inferência do modelo 3D a partir dos dados do produto (lógica pura, sem THREE).
// Todo produto cadastrado em qualquer loja ganha um "spec" automaticamente:
//   { kind, w, h, d (cm), colors:{main,accent,wood,metal}, material, style:{...}, seed, label }
// Precedência do tipo: product.model3d.kind > category.model_kind > regras da categoria
//   > palavras do nome/tags/especificações > dicas da categoria-mãe > 'generic'.
// Detalhe: quando a categoria aponta um tipo e o nome do produto cita outro tipo da MESMA
// família (ex.: categoria "Mesas de Centro" e produto "Mesa Lateral"), vale o do produto.

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
export const KINDS = [
  { id: 'sofa', label: 'Sofá' },
  { id: 'armchair', label: 'Poltrona' },
  { id: 'chair', label: 'Cadeira' },
  { id: 'stool', label: 'Banqueta' },
  { id: 'pouf', label: 'Puff' },
  { id: 'bed', label: 'Cama' },
  { id: 'bunk_bed', label: 'Beliche' },
  { id: 'crib', label: 'Berço' },
  { id: 'mattress', label: 'Colchão' },
  { id: 'nightstand', label: 'Criado-mudo' },
  { id: 'dresser', label: 'Cômoda' },
  { id: 'wardrobe', label: 'Guarda-roupa' },
  { id: 'coffee_table', label: 'Mesa de centro' },
  { id: 'side_table', label: 'Mesa lateral' },
  { id: 'dining_table', label: 'Mesa de jantar' },
  { id: 'desk', label: 'Escrivaninha' },
  { id: 'rack', label: 'Rack' },
  { id: 'shelf', label: 'Estante' },
  { id: 'kitchen_cabinet', label: 'Armário de cozinha' },
  { id: 'tv', label: 'TV' },
  { id: 'fridge', label: 'Geladeira' },
  { id: 'washer', label: 'Lavadora' },
  { id: 'stove', label: 'Fogão' },
  { id: 'microwave', label: 'Micro-ondas' },
  { id: 'air_conditioner', label: 'Ar-condicionado' },
  { id: 'small_appliance', label: 'Eletroportátil' },
  { id: 'generic', label: 'Modelo genérico' },
  { id: 'none', label: 'Sem 3D' },
];
export const KIND_IDS = KINDS.map((k) => k.id);
export const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label || 'Modelo genérico';

// Família de cada tipo (usada para refinar pela palavra do produto e para o arquétipo genérico)
export const FAMILY = {
  sofa: 'seating', armchair: 'seating', chair: 'seating', stool: 'seating', pouf: 'seating',
  bed: 'bed', bunk_bed: 'bed', crib: 'bed', mattress: 'bed',
  coffee_table: 'table', side_table: 'table', dining_table: 'table', desk: 'table',
  nightstand: 'storage', dresser: 'storage', wardrobe: 'storage', rack: 'storage', shelf: 'storage', kitchen_cabinet: 'storage',
  tv: 'appliance', fridge: 'appliance', washer: 'appliance', stove: 'appliance', microwave: 'appliance',
  air_conditioner: 'appliance', small_appliance: 'appliance',
  generic: 'generic', none: 'none',
};
// Arquétipo visual (style.family) usado pelo gerador genérico
const ARCHETYPE = {
  sofa: 'seating', armchair: 'seating', chair: 'seating', stool: 'seating', pouf: 'soft',
  bed: 'bed', bunk_bed: 'bed', crib: 'bed', mattress: 'soft',
  coffee_table: 'table', side_table: 'table', dining_table: 'table', desk: 'table',
  nightstand: 'storage', dresser: 'storage', wardrobe: 'storage', rack: 'storage', shelf: 'storage', kitchen_cabinet: 'storage',
  tv: 'screen', fridge: 'appliance', washer: 'appliance', stove: 'appliance', microwave: 'appliance',
  air_conditioner: 'appliance', small_appliance: 'appliance', generic: 'furniture',
};

/* ------------------------------------------------------------------ */
/* Medidas e cores padrão por tipo (cm)                                */
/* ------------------------------------------------------------------ */
const WOOD = '#a87a4c';
const DEFAULTS = {
  sofa: { w: 200, h: 85, d: 90, material: 'fabric', colors: { main: '#8f8e8a', accent: '#d9d4cc', wood: '#6b4a32', metal: '#1f1f1f' } },
  armchair: { w: 75, h: 80, d: 78, material: 'fabric', colors: { main: '#b8a48a', accent: '#e8e2d6', wood: '#8a5a36', metal: '#1f1f1f' } },
  chair: { w: 48, h: 88, d: 54, material: 'fabric', colors: { main: '#9e9e9e', accent: '#e8e2d6', wood: '#8a5a36', metal: '#1f1f1f' } },
  stool: { w: 40, h: 70, d: 40, material: 'wood', colors: { main: '#3a3a3a', accent: '#d9d4cc', wood: WOOD, metal: '#1f1f1f' } },
  pouf: { w: 45, h: 42, d: 45, material: 'fabric', colors: { main: '#c9b8a0', accent: '#e8e2d6', wood: WOOD, metal: '#1f1f1f' } },
  bed: { w: 150, h: 100, d: 205, material: 'wood', colors: { main: '#c8995e', accent: '#f3f1ec', wood: '#c8995e', metal: '#2b2b2b' } },
  bunk_bed: { w: 100, h: 160, d: 200, material: 'wood', colors: { main: '#f2f0ea', accent: '#f3f1ec', wood: '#c8995e', metal: '#2b2b2b' } },
  crib: { w: 132, h: 95, d: 72, material: 'wood', colors: { main: '#f2f0ea', accent: '#f3f1ec', wood: '#c8995e', metal: '#2b2b2b' } },
  mattress: { w: 138, h: 28, d: 188, material: 'fabric', colors: { main: '#dfe2e4', accent: '#2f3136', wood: WOOD, metal: '#2b2b2b' } },
  nightstand: { w: 50, h: 55, d: 40, material: 'mdf', colors: { main: '#c8a67a', accent: '#d9b98a', wood: '#c8995e', metal: '#b8a16a' } },
  dresser: { w: 120, h: 85, d: 45, material: 'mdf', colors: { main: '#d9bf94', accent: '#d9b98a', wood: '#c8995e', metal: '#b8a16a' } },
  wardrobe: { w: 180, h: 220, d: 55, material: 'mdf', colors: { main: '#e9e4da', accent: '#c8995e', wood: '#c8995e', metal: '#9a9a9a' } },
  coffee_table: { w: 100, h: 40, d: 60, material: 'wood', colors: { main: '#a0663b', accent: '#e9e4da', wood: '#a0663b', metal: '#1f1f1f' } },
  side_table: { w: 45, h: 55, d: 45, material: 'wood', colors: { main: '#a0663b', accent: '#e9e4da', wood: '#a0663b', metal: '#1f1f1f' } },
  dining_table: { w: 160, h: 77, d: 90, material: 'wood', colors: { main: '#a0663b', accent: '#e9e4da', wood: '#a0663b', metal: '#1f1f1f' } },
  desk: { w: 120, h: 75, d: 60, material: 'mdf', colors: { main: '#e9e4da', accent: '#c8995e', wood: '#c8995e', metal: '#1f1f1f' } },
  rack: { w: 180, h: 55, d: 40, material: 'mdf', colors: { main: '#c8a67a', accent: '#f0ede6', wood: '#c8995e', metal: '#1f1f1f' } },
  shelf: { w: 90, h: 180, d: 35, material: 'mdf', colors: { main: '#c8a67a', accent: '#f0ede6', wood: '#c8995e', metal: '#1f1f1f' } },
  kitchen_cabinet: { w: 160, h: 200, d: 50, material: 'mdf', colors: { main: '#f0ede6', accent: '#c8995e', wood: '#c8995e', metal: '#9a9a9a' } },
  tv: { w: 123, h: 76, d: 25, material: 'plastic', colors: { main: '#141414', accent: '#1f1f1f', wood: WOOD, metal: '#2a2a2a' } },
  fridge: { w: 60, h: 170, d: 70, material: 'metal', colors: { main: '#f2f2f2', accent: '#1d1d1d', wood: WOOD, metal: '#c3c5c7' } },
  washer: { w: 60, h: 100, d: 65, material: 'metal', colors: { main: '#f4f4f4', accent: '#2a2a2a', wood: WOOD, metal: '#c3c5c7' } },
  stove: { w: 50, h: 85, d: 60, material: 'steel', colors: { main: '#c3c5c7', accent: '#141414', wood: WOOD, metal: '#c3c5c7' } },
  microwave: { w: 50, h: 30, d: 38, material: 'metal', colors: { main: '#f2f2f2', accent: '#141414', wood: WOOD, metal: '#c3c5c7' } },
  air_conditioner: { w: 82, h: 28, d: 20, material: 'plastic', colors: { main: '#f5f5f5', accent: '#d9d9d9', wood: WOOD, metal: '#c3c5c7' } },
  small_appliance: { w: 25, h: 30, d: 25, material: 'plastic', colors: { main: '#1d1d1d', accent: '#c3c5c7', wood: WOOD, metal: '#c3c5c7' } },
  generic: { w: 60, h: 60, d: 60, material: 'mdf', colors: { main: '#cfc8bb', accent: '#e8e4dc', wood: '#b08a5a', metal: '#2b2b2b' } },
};
// Tipos cujo corpo costuma ser madeira/MDF com aparência de madeira
const WOODY = new Set(['bed', 'bunk_bed', 'crib', 'nightstand', 'dresser', 'wardrobe', 'coffee_table', 'side_table', 'dining_table', 'desk', 'rack', 'shelf', 'kitchen_cabinet', 'stool', 'generic']);
// ...e os que, sem cor informada, ficam com cara de madeira por padrão
const DEFAULT_WOODLOOK = new Set(['bed', 'nightstand', 'dresser', 'coffee_table', 'side_table', 'dining_table', 'rack', 'shelf', 'stool']);
const UPHOLSTERED = new Set(['sofa', 'armchair', 'chair', 'pouf']);

// Medidas padrão por tipo de eletroportátil, decoração e variações (cm)
const APPLIANCE_DIMS = {
  coffee_maker: { w: 20, h: 32, d: 25 }, blender: { w: 20, h: 40, d: 20 }, air_fryer: { w: 30, h: 32, d: 35 },
  kettle: { w: 22, h: 25, d: 16 }, toaster: { w: 30, h: 20, d: 17 }, mixer: { w: 35, h: 35, d: 22 },
  fan: { w: 42, h: 120, d: 40 }, iron: { w: 12, h: 15, d: 28 }, vacuum: { w: 30, h: 110, d: 25 },
  sandwich_maker: { w: 25, h: 10, d: 25 }, food_processor: { w: 25, h: 40, d: 25 }, rice_cooker: { w: 28, h: 25, d: 28 },
  pressure_cooker: { w: 30, h: 32, d: 30 }, juicer: { w: 20, h: 30, d: 20 }, water_purifier: { w: 25, h: 45, d: 30 },
  heater: { w: 40, h: 55, d: 20 }, speaker: { w: 30, h: 20, d: 18 }, hair_dryer: { w: 25, h: 22, d: 9 },
  hair_straightener: { w: 4, h: 30, d: 4 }, popcorn: { w: 25, h: 30, d: 25 }, phone: { w: 7.5, h: 16, d: 0.9 },
  laptop: { w: 36, h: 2.2, d: 25 }, tablet: { w: 25, h: 17, d: 0.8 }, console: { w: 30, h: 6, d: 25 },
  // coifa de parede (campânula + chaminé); depurador é uma caixa fina; coifa de ilha é maior
  range_hood: { w: 60, h: 75, d: 50 },
};
const DECOR_DIMS = {
  rug: { w: 200, h: 1.5, d: 250 }, lamp: { w: 40, h: 160, d: 40 }, mirror: { w: 60, h: 160, d: 4 },
  frame: { w: 60, h: 80, d: 3 }, vase: { w: 22, h: 35, d: 22 }, bracket: { w: 40, h: 30, d: 10 },
  curtain: { w: 200, h: 230, d: 12 }, ladder: { w: 45, h: 170, d: 38 },
};
// Subtipos de decoração com medidas próprias (abajur, pendente, espelho redondo, escada doméstica...)
function decorDims(st) {
  if (st.decor === 'lamp') {
    return { table: { w: 30, h: 50, d: 30 }, pendant: { w: 35, h: 70, d: 35 }, wall: { w: 18, h: 30, d: 22 }, arc: { w: 110, h: 190, d: 40 } }[st.lampType] || DECOR_DIMS.lamp;
  }
  if (st.decor === 'mirror') return st.shape === 'round' ? { w: 60, h: 60, d: 3 } : st.shape === 'oval' ? { w: 50, h: 75, d: 3 } : st.floorMirror ? { w: 60, h: 170, d: 4 } : DECOR_DIMS.mirror;
  if (st.decor === 'ladder' && st.ladderType === 'step') return { w: 48, h: 150, d: 70 };
  return DECOR_DIMS[st.decor];
}
function dimsDefault(kind, st) {
  const def = { ...(DEFAULTS[kind] || DEFAULTS.generic) };
  let o = null;
  if (kind === 'small_appliance') o = APPLIANCE_DIMS[st.appliance];
  // almofada decorativa fica em pé (45 x 45, 14 de espessura); peça dobrada é uma pilha baixa
  else if (kind === 'generic') o = st.textile ? (st.textileKind === 'folded' ? { w: 45, h: 18, d: 35 } : st.textileKind === 'cushion' ? { w: 45, h: 45, d: 14 } : { w: 45, h: 12, d: 45 }) : decorDims(st);
  if (kind === 'small_appliance' && st.appliance === 'range_hood') o = st.hood === 'flat' ? { w: 60, h: 14, d: 48 } : st.hood === 'island' ? { w: 90, h: 80, d: 60 } : APPLIANCE_DIMS.range_hood;
  // lava-louças: de bancada (até 6 serviços), compacta de 45 cm (até 10) ou de 60 cm
  if (kind === 'washer' && st.dishwasher) {
    const n = st.places || 8;
    o = n <= 6 || st.countertop ? { w: 55, h: 45, d: 50 } : n <= 10 ? { w: 45, h: 85, d: 60 } : { w: 60, h: 85, d: 60 };
  }
  else if (kind === 'fridge') o = st.freezer === 'chest' ? { w: 110, h: 90, d: 70 } : st.minibar ? { w: 48, h: 85, d: 50 } : st.wine ? { w: 35, h: 80, d: 50 } : null;
  else if (kind === 'fan') o = null;
  if (kind === 'small_appliance' && st.appliance === 'fan' && st.ceiling) o = { w: 105, h: 45, d: 105 };
  // ventilador de mesa / parede é bem mais baixo que o de coluna (padrão)
  if (kind === 'small_appliance' && st.appliance === 'fan' && !st.ceiling && / de (mesa|parede) /.test(st._name || '')) o = / de mesa /.test(st._name) ? { w: 35, h: 50, d: 26 } : { w: 45, h: 55, d: 32 };
  if (kind === 'small_appliance' && st.appliance === 'vacuum' && /robo/.test(st._name || '')) o = { w: 33, h: 9, d: 33 };
  if (kind === 'stove' && st.cooktop) o = { w: 60, h: 6, d: 52 };
  if (kind === 'washer' && st.frontLoad && !st.dishwasher) o = { w: 60, h: 85, d: 60 };
  if (kind === 'air_conditioner' && st.portable) o = { w: 45, h: 75, d: 38 };
  if (kind === 'chair' && st.office) o = { w: 62, h: 115, d: 62 };
  // assentos: banqueta baixa/alta, poltrona reclinável, bergère, de balanço e sofá retrátil
  if (kind === 'stool' && !st.bench && / baix[oa]s? /.test(st._name || '')) o = { w: 38, h: 45, d: 38 };
  if (kind === 'stool' && !st.bench && / (alt[oa]s?|bar|balcao) /.test(st._name || '')) o = { w: 40, h: 75, d: 40 };
  // banqueta com encosto: a altura de referência é a do assento; o encosto soma ~27 cm
  if (kind === 'stool' && !st.bench && / encosto /.test(st._name || '')) o = { ...(o || def), h: ((o || def).h || 70) + 27 };
  // puff pera / bean bag é bem maior que o puff comum
  if (kind === 'pouf' && / (pera|bean ?bags?|saco|gota) /.test(st._name || '')) o = / infantil /.test(st._name || '') ? { w: 55, h: 70, d: 55 } : { w: 70, h: 90, d: 70 };
  if (kind === 'armchair' && st.reclinable) o = { w: 88, h: 102, d: 92 };
  if (kind === 'armchair' && st.wing) o = { w: 78, h: 105, d: 82 };
  if (kind === 'armchair' && / balanco /.test(st._name || '')) o = { w: 66, h: 100, d: 90 };
  if (kind === 'sofa' && (st.reclinable || st.retractable)) o = { h: 98, d: 105 };
  if (kind === 'stool' && st.bench) o = { w: 110, h: 45, d: 38 };
  if (kind === 'pouf' && st.bench) o = { w: 110, h: 45, d: 42 };
  if (kind === 'mattress' && st.pillow) o = { w: 50, h: 15, d: 70 };
  if (kind === 'bed' && st.headboardOnly) o = { w: 160, h: 120, d: 10 };
  if (kind === 'tv' && st.monitor) o = { w: 54, h: 42, d: 18 };
  // sala/cozinha: subtipos com medidas bem diferentes do padrão do tipo
  const nm = st._name || '';
  // eletro: medidas que mudam com o subtipo, a capacidade (litros/BTUs) e o número de bocas
  if (kind === 'fridge' && st.freezer === 'vertical') {
    const L = st.capacityL || 200;
    o = { w: L > 260 ? 60 : 55, h: Math.round(Math.min(185, Math.max(85, 80 + L * 0.33))), d: L > 260 ? 70 : 63 };
  } else if (kind === 'fridge' && !o && st.sideBySide) o = { w: 91, h: 178, d: 72 };
  else if (kind === 'fridge' && !o && st.frenchDoor) o = { w: 83, h: 186, d: 75 };
  else if (kind === 'fridge' && !o && st.capacityL > 130) {
    const L = st.capacityL;
    o = { w: L >= 430 ? 70 : L >= 340 ? 63 : 60, h: Math.round(Math.min(190, Math.max(120, 105 + L * 0.19))), d: L >= 430 ? 73 : 70 };
  }
  if (kind === 'stove' && !st.cooktop && st.burners >= 5) o = st.burners >= 6 ? { w: 90, h: 90, d: 66 } : { w: 76, h: 90, d: 65 };
  if (kind === 'stove' && st.cooktop) o = st.burners >= 5 ? { w: 75, h: 6, d: 52 } : st.burners && st.burners <= 2 ? { w: 30, h: 6, d: 52 } : { w: 60, h: 6, d: 52 };
  // fogareiro / fogão de mesa: caixa baixa de bancada com as bocas em cima
  if (kind === 'stove' && st.portable) o = (st.burners || 1) <= 1 ? { w: 30, h: 11, d: 32 } : st.burners <= 2 ? { w: 55, h: 11, d: 33 } : { w: 62, h: 11, d: 50 };
  if (kind === 'air_conditioner' && st.window) o = (st.btu || 7500) > 9000 ? { w: 56, h: 37, d: 63 } : { w: 47, h: 34, d: 52 };
  else if (kind === 'air_conditioner' && st.cooler) o = (st.capacityL || 0) >= 40 ? { w: 45, h: 115, d: 37 } : (st.capacityL || 0) >= 10 ? { w: 38, h: 85, d: 30 } : { w: 28, h: 65, d: 25 };
  else if (kind === 'air_conditioner' && !st.portable && st.btu) {
    const b = st.btu;
    o = b >= 30000 ? { w: 120, h: 34, d: 26 } : b >= 22000 ? { w: 110, h: 33, d: 24 } : b >= 16000 ? { w: 100, h: 31, d: 22 } : b >= 11000 ? { w: 85, h: 29, d: 20 } : { w: 80, h: 28, d: 20 };
  }
  if (kind === 'small_appliance' && st.espresso) o = st.capsule ? { w: 17, h: 29, d: 30 } : { w: 24, h: 31, d: 30 };
  if (kind === 'small_appliance' && st.moka) o = { w: 17, h: 21, d: 11 };
  if (kind === 'small_appliance' && st.stick) o = { w: 7, h: 38, d: 7 };
  if (kind === 'small_appliance' && st.bottle) o = / (mesa|bancada) /.test(nm) ? { w: 31, h: 85, d: 33 } : { w: 31, h: 130, d: 33 };
  if (kind === 'side_table' && st.console) o = { w: 120, h: 80, d: 35 };
  if (kind === 'desk' && st.vanity) o = { w: 100, h: 140, d: 42 };
  if (kind === 'rack' && st.panel) o = { w: 180, h: 160, d: 35 };
  else if (kind === 'rack' && / (home theaters?|estantes? home|estantes? para tv) /.test(nm)) o = { w: 220, h: 180, d: 45 };
  if (kind === 'desk' && st.corner && !st.vanity) o = { w: 150, h: 75, d: 120 };
  if (kind === 'shelf' && st.floating) o = { w: 60, h: 4, d: 22 };
  if (kind === 'shelf' && / nichos? /.test(nm) && !/ estantes? /.test(nm)) o = { w: 40, h: 30, d: 25 };
  // conjunto de cozinha ("Cozinha Completa 5 Peças com Balcão e Aéreo"): balcão + aéreos + paneleiro,
  // vence as palavras das peças (senão "Aéreo" no nome deixava a cozinha inteira com 60 cm de altura)
  if (kind === 'kitchen_cabinet' && / (cozinhas? (compact|complet|modulad|planejad|american)[oa]s?|kit cozinha) /.test(nm)) o = { w: 200, h: 200, d: 50 };
  else if (kind === 'kitchen_cabinet' && / aereos? /.test(nm)) o = { w: 120, h: 60, d: 32 };
  else if (kind === 'kitchen_cabinet' && / paneleiros? /.test(nm)) o = { w: 70, h: 200, d: 52 };
  else if (kind === 'kitchen_cabinet' && / (balcao|balcoes|gabinetes?) /.test(nm)) o = { w: 120, h: 86, d: 50 };
  if (st.shape === 'round' && (kind === 'coffee_table' || kind === 'dining_table')) o = kind === 'coffee_table' ? { w: 80, h: 40, d: 80 } : { w: 110, h: 77, d: 110 };
  // quarto: medidas que mudam muito conforme o subtipo
  const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nd = Number(st.drawers) || 0;
  const ndoor = Number(st.doors) || 0;
  if (kind === 'bed' && st.box && !st.headboardOnly) o = { w: 138, d: 188, h: st.baseOnly ? 40 : st.headboard && st.headboard !== 'none' ? 120 : 66 };
  if (kind === 'bed' && st.house) o = { w: 100, h: 170, d: 205 };
  else if (kind === 'bed' && st.montessori) o = { w: 100, h: 42, d: 205 };
  if (kind === 'bed' && st.sideTables && !st.box) o = { ...(o || {}), w: 260 };
  if (kind === 'bunk_bed' && st.triple) o = { h: 175 };
  if (kind === 'crib' && st.portable) o = { w: 100, h: 76, d: 72 };
  if (kind === 'nightstand' && st.shape === 'round') o = { w: 45, h: 55, d: 45 };
  if (kind === 'dresser' && / (chiffoniers?|chifoniers?) /.test(nm)) o = { w: 70, h: lim(30 + 18 * (nd || 5), 100, 150), d: 42 };
  else if (kind === 'dresser' && / gaveteiros? /.test(nm)) o = st.wheels || / escritorio /.test(nm) ? { w: 40, h: lim(15 + 16 * (nd || 3), 45, 80), d: 47 } : { w: 50, h: lim(20 + 18 * (nd || 5), 60, 130), d: 42 };
  else if (kind === 'dresser' && st.shoeCabinet) o = { w: 70, h: 105, d: 35 };
  else if (kind === 'dresser' && st.sideboard) o = { w: 160, h: 85, d: 42 };
  else if (kind === 'dresser' && st.changer) o = { w: 100, h: 96, d: 50 };
  // guarda-roupa: a largura acompanha o número de portas (8 portas não cabem em 1,80 m)
  if (kind === 'wardrobe' && ndoor && !st.open) o = { w: st.sliding ? lim(ndoor * 88, 120, 300) : lim(30 + 32 * ndoor, 60, 300) };
  // armário multiuso (área de serviço/cozinha): alto e raso
  if (kind === 'wardrobe' && / multiuso /.test(nm)) o = { w: ndoor >= 3 ? 110 : 75, h: 185, d: 40 };
  return o ? { ...def, ...o } : def;
}

// Colchões (largura x comprimento, cm)
export const MATTRESS_SIZES = {
  berco: { w: 60, d: 130, label: 'berço' },
  solteiro: { w: 88, d: 188, label: 'solteiro' },
  solteirao: { w: 96, d: 203, label: 'solteirão' },
  viuva: { w: 128, d: 188, label: 'viúva' },
  casal: { w: 138, d: 188, label: 'casal' },
  queen: { w: 158, d: 198, label: 'queen' },
  king: { w: 193, d: 203, label: 'king' },
};

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */
// Minúsculas, sem acentos, só letras/números separados por um espaço, com espaço nas pontas.
export function normText(s) {
  const t = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${t} `;
}
export const slugify = (s) => normText(s).trim().replace(/ /g, '-');

// Compila padrões (fonte regex sobre texto normalizado) com fronteira de palavra sem lookbehind.
const compile = (src) => new RegExp(`(^| )(${src})(?= )`, 'g');
function findAll(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    out.push({ start, end: start + m[2].length, len: m[2].length, text: m[2] });
    re.lastIndex = start + 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cores                                                               */
/* ------------------------------------------------------------------ */
// Palavras de cor em pt-BR (normalizadas). Madeiras marcadas com wood:true.
const COLOR_TABLE = [
  // "OFF" sozinho é a abreviação usual de off white nos cadastros ("FREIJO/OFF")
  ['off white|offwhite|off|gelo|marfim', '#efe9df'],
  ['branco|branca|branco neve|branco fosco|branco brilho', '#f4f4f2'],
  ['preto|preta|preto fosco|black|onix', '#1d1d1d'],
  ['cinza claro|cinza clara|prata claro', '#c4c4c4'],
  ['cinza escuro|cinza escura|chumbo', '#4a4a4a'],
  ['cinza|cinzento|platinum|platina', '#8c8c8c'],
  ['grafite', '#5c5f61'],
  ['prata|prateado|prateada', '#c0c0c0'],
  ['inox|aco inox|aco escovado|escovado', '#c3c5c7'],
  ['cromado|cromada|cromo', '#d8d8d8'],
  ['dourado|dourada|ouro|gold', '#c9a24a'],
  ['champagne|champanhe', '#d8c3a0'],
  ['bronze', '#8c6239'],
  ['cobre|rose gold', '#b06a3b'],
  ['verde agua|verde menta|menta', '#4cbfa6'],
  ['verde musgo|verde oliva|oliva|musgo', '#5b6236'],
  ['verde militar', '#4b5320'],
  ['verde escuro|verde floresta|verde esmeralda|esmeralda', '#1f4a3a'],
  ['verde claro|verde salvia|salvia', '#9db59a'],
  ['verde', '#1f5a4a'],
  ['azul claro|azul bebe|azul celeste|celeste', '#a9d6d4'],
  ['azul marinho|marinho|azul navy|navy', '#1f2a44'],
  ['azul petroleo|petroleo', '#1d4e5a'],
  ['azul royal|azul bic', '#2546a8'],
  ['azul jeans|jeans', '#4a6488'],
  ['azul', '#2f5d8a'],
  ['turquesa|tiffany', '#2fb3b0'],
  ['caramelo', '#b5703a'],
  ['cafe|cappuccino|capuccino', '#3b2a20'],
  ['chocolate', '#4a2c1d'],
  ['marrom', '#5c3b28'],
  ['conhaque|whisky|whiskey|havana', '#8a4b2a'],
  ['ferrugem|telha|cobre envelhecido', '#a14a24'],
  ['terracota|terra cota', '#c9692b'],
  ['travertino|travertino romano', '#d9c9ae'],
  ['bege|beige|camel', '#d8cba0'],
  ['areia|sand', '#e6dccb'],
  ['creme|baunilha|perola', '#f1e6cc'],
  ['fendi|taupe|cinza fendi', '#b8a898'],
  ['nude|rosa nude|blush', '#dcc1a6'],
  ['vinho|bordo|bordeaux|marsala', '#5e1a24'],
  ['vermelho|vermelha|red', '#b3262c'],
  ['rosa antigo|rose|rosa seco', '#c48b8f'],
  ['rosa|pink', '#e3a7b4'],
  ['lilas|lavanda', '#b7a4c9'],
  ['roxo|roxa|violeta|uva', '#5d3a7a'],
  ['amarelo|amarela', '#e8b923'],
  ['mostarda|ocre', '#c99a2e'],
  ['laranja', '#e07b29'],
  ['coral|salmao', '#ef7b62'],
  // madeiras e acabamentos amadeirados
  ['natural|nature|madeira natural|pinus', '#c8995e', true],
  ['nogueira|noce|walnut', '#7a4a2b', true],
  ['carvalho|carvalho natural|oak|carvalho americano', '#d9bf94', true],
  ['freijo', '#a0663b', true],
  ['demolicao|rustico|rustica', '#7a4a2b', true],
  ['tabaco', '#4a2f22', true],
  ['castanho|castanha|wengue|wenge|tabaco escuro', '#5c3b28', true],
  ['imbuia|ipe', '#5a3a26', true],
  ['cinamomo|canela|cumaru|jatoba', '#9b5e33', true],
  ['mel|amendoa|avela|amendola', '#b8803e', true],
  ['teca|teka|jequitiba|tauari|cedro', '#9a6a3c', true],
  ['mogno|cerejeira|cerejeira escura', '#6a2e1f', true],
  ['nature off|rovere|naturale', '#cfae84', true],
];
const COLOR_RULES = COLOR_TABLE.flatMap(([words, hex, wood]) =>
  words.split('|').map((w) => ({ re: compile(w.replace(/ /g, ' ')), hex, wood: !!wood, word: w }))
);
export const COLOR_WORDS = Object.fromEntries(COLOR_RULES.map((r) => [r.word, r.hex]));
export const WOOD_WORDS = COLOR_RULES.filter((r) => r.wood).map((r) => r.word);

const CSS_NAMES = {
  white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', silver: '#c0c0c0', red: '#ff0000',
  green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', brown: '#a52a2a', beige: '#f5f5dc',
  pink: '#ffc0cb', purple: '#800080', navy: '#000080', teal: '#008080', ivory: '#fffff0', gold: '#ffd700',
};

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`;
}
// Converte um token de cor CSS ('#abc', '#aabbcc', 'rgb()', 'hsl()', nome CSS) em '#rrggbb'.
function cssToken(tok) {
  const t = String(tok).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length >= 6) return `#${h.slice(0, 6)}`;
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(t);
  if (m) return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(t);
  if (m) return hslToHex(+m[1], +m[2], +m[3]);
  if (CSS_NAMES[t]) return CSS_NAMES[t];
  return null;
}
const TOKEN_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

// Palavras de cor encontradas num texto: [{hex, wood, word, start}] em ordem de aparição.
export function findColorWords(text) {
  const t = normText(text);
  const hits = [];
  for (const r of COLOR_RULES) for (const m of findAll(t, r.re)) hits.push({ ...m, hex: r.hex, wood: r.wood, word: r.word });
  hits.sort((a, b) => a.start - b.start || b.len - a.len);
  const out = [];
  let end = -1;
  for (const h of hits) {
    if (h.start < end) continue;
    out.push(h);
    end = h.end;
  }
  return out;
}

// Todas as cores (paradas) de um valor: gradiente -> várias; '#hex' -> uma; palavras -> as encontradas.
export function colorStops(value) {
  if (value == null || value === '') return [];
  const s = String(value);
  const toks = s.match(TOKEN_RE);
  if (toks?.length) return toks.map(cssToken).filter(Boolean);
  const css = cssToken(s);
  if (css) return [css];
  return findColorWords(s).map((h) => h.hex);
}

// Cor única em '#rrggbb' (primeira parada de gradientes; palavras em português; nomes CSS).
export function colorHex(value, fallback = '#9a9a9a') {
  return colorStops(value)[0] || fallback;
}
export const isWoodColorName = (text) => findColorWords(text).some((h) => h.wood);

/* ------------------------------------------------------------------ */
/* Regras de tipo (categoria e nome)                                   */
/* ------------------------------------------------------------------ */
// [tipo, padrões, estilo extra, fraca?] — "fraca" = categoria ampla (ambiente), o nome do produto manda.
const RULE_TABLE = [
  ['none', ['garantia( estendida)?', 'seguro', 'servicos?( de montagem)?', 'montagem', 'frete', 'vale presente', 'cartao presente', 'gift card']],
  // quarto
  ['bunk_bed', ['beliches?']],
  ['bunk_bed', ['treliches?'], { triple: true }],
  ['crib', ['bercos?', 'mini bercos?', 'bercos? portateis', 'berco portatil']],
  ['mattress', ['colchao', 'colchoes', 'colchonetes?']],
  ['mattress', ['travesseiros?'], { pillow: true }],
  ['bed', ['bases? box'], { box: true, baseOnly: true }],
  ['bed', ['camas? box', 'box bau', 'base box', 'box conjugados?', 'conjuntos? box', 'cama box bau'], { box: true }],
  ['bed', ['bicamas?'], { trundle: true }],
  ['bed', ['cabeceiras?( estofadas?| de cama| para cama)?'], { headboardOnly: true }],
  ['bed', ['camas?', 'camas? de casal', 'camas? casal', 'camas? solteiro', 'mini camas?', 'camas? montessorianas?', 'camas? infantis?']],
  ['nightstand', ['criados? mudos?', 'criados?', 'mesas? de cabeceira', 'mesinhas? de cabeceira']],
  ['dresser', ['sapateiras?'], { shoeCabinet: true }],
  ['dresser', ['comodas?', 'gaveteiros?', 'chiffoniers?', 'chifoniers?', 'sapateiras?']],
  ['dresser', ['buffets?', 'bufes?', 'bufets?'], { sideboard: true }],
  ['wardrobe', ['guarda roupas?', 'guardaroupas?', 'roupeiros?', 'closets?', 'armarios? de quarto', 'armarios? multiuso', 'armarios? de solteiro', 'armarios? casal']],
  // sala
  ['sofa', ['sofas?', 'estofados?', 'futons?', 'conjuntos? de sofas?']],
  ['sofa', ['sofas? camas?'], { sofaBed: true }],
  ['sofa', ['namoradeiras?'], { seats: 2 }],
  ['sofa', ['chaises?( longue)?', 'chaiselongue', 'divas?'], { chaise: true }],
  ['armchair', ['poltronas?', 'cadeiras? de balanco', 'cadeiras? de amamentacao']],
  ['armchair', ['cadeiras? do papai', 'poltronas? do papai'], { reclinable: true }],
  ['chair', ['cadeiras?', 'cadeiras? de jantar', 'cadeiras? de cozinha']],
  ['chair', ['cadeiras? (de )?escritorio', 'cadeiras? gamer', 'cadeiras? (de )?(presidente|diretor|secretaria)', 'cadeiras? giratorias?'], { office: true, swivel: true }],
  ['stool', ['banquetas?', 'mochos?', 'bancos? altos?']],
  ['stool', ['bancos?', 'bancos? bau', 'bancos? de jardim', 'bancos? de madeira'], { bench: true }],
  ['pouf', ['puffs?', 'pufs?', 'pufes?', 'poufs?', 'otomanas?']],
  ['pouf', ['recamiers?', 'puffs? bau', 'calcadeiras?'], { bench: true }],
  ['coffee_table', ['mesas? de centro', 'mesas? centro', 'mesinhas? de centro', 'mesas? de centros?']],
  ['side_table', ['mesas? laterais', 'mesas? lateral', 'mesas? de apoio', 'mesas? de canto', 'mesinhas?', 'mesinhas? de apoio', 'mesinhas? laterais']],
  ['side_table', ['aparadores?'], { console: true }],
  ['dining_table', ['mesas?', 'mesas? de jantar', 'mesas? para jantar', 'conjuntos? de jantar', 'conjuntos? de mesas?', 'salas? de jantar', 'mesas? de cozinha', 'mesas? dobraveis', 'mesas? dobravel', 'mesas? redondas?', 'mesas? de madeira']],
  ['desk', ['escrivaninhas?', 'mesas? (de|para) (escritorio|computador|estudos?|notebook)', 'mesas? gamer', 'mesas? home office', 'home office', 'bancadas? de estudos?', 'bancadas?( para notebook)?']],
  ['desk', ['escritorios?', 'office'], {}, true],
  ['desk', ['penteadeiras?'], { vanity: true, mirror: true }],
  ['rack', ['racks?', 'home theaters?', 'home theater', 'estantes? home(?! office)( theater)?', 'estantes? para tv']],
  ['rack', ['paineis?( para tv| de tv)?', 'painel( para tv| de tv)?'], { panel: true }],
  ['shelf', ['estantes?', 'prateleiras?', 'nichos?', 'livreiros?', 'cantoneiras?', 'expositores?', 'bibliotecas?', 'estantes? de livros', 'estantes? para livros']],
  ['shelf', ['cristaleiras?'], { glassDoors: true }],
  ['kitchen_cabinet', ['cozinhas? compactas?', 'cozinhas? moduladas?', 'cozinhas? completas?', 'cozinhas? planejadas?', 'armarios? de cozinha', 'armarios? aereos?', 'armario', 'armarios', 'paneleiros?', 'balcoes', 'balcao( de cozinha| de pia| para cooktop)?', 'gabinetes?( de pia| de banheiro| para banheiro)?', 'kit cozinha', 'fruteiras?']],
  ['kitchen_cabinet', ['cozinhas?', 'area de servico', 'lavanderias?', 'banheiros?'], {}, true],
  // eletro
  ['tv', ['tvs?', 'smart tvs?', 'televisores?', 'televisao', 'televisoes', 'tv led', 'tv smart']],
  ['tv', ['monitor(es)?', 'monitor gamer'], { monitor: true }],
  ['fridge', ['geladeiras?', 'refrigeradores?', 'freezers?', 'geladeiras? e freezers?']],
  ['fridge', ['freezers? verticais', 'freezer vertical'], { freezer: 'vertical' }],
  ['fridge', ['freezers? horizontais', 'freezer horizontal'], { freezer: 'chest' }],
  ['fridge', ['frigobares?', 'frigobar', 'minibar', 'mini geladeiras?'], { minibar: true }],
  ['fridge', ['adegas?', 'cervejeiras?'], { wine: true }],
  ['washer', ['lavadoras?', 'lavadoras? de roupas?', 'maquinas? de lavar( roupas?)?', 'lava roupas']],
  ['washer', ['lava e seca', 'lava seca', 'lavadoras? e secadoras?'], { frontLoad: true, dryer: true }],
  ['washer', ['secadoras?( de roupas?)?'], { frontLoad: true, dryer: true }],
  ['washer', ['tanquinhos?', 'centrifugas?( de roupas?)?'], { topLoad: true, tanquinho: true }],
  // lava-louças: mesmo gerador da lavadora, mas com porta basculante e painel no alto
  ['washer', ['lava loucas?', 'lavaloucas?', 'lavadoras? de loucas?', 'maquinas? de lavar loucas?'], { dishwasher: true }],
  ['stove', ['fogao', 'fogoes']],
  ['stove', ['fogareiros?', 'fog(ao|oes) de mesa', 'fog(ao|oes) portat(il|eis)', 'fog(ao|oes) de bancada'], { cooktop: true, portable: true }],
  ['stove', ['cooktops?', 'cook tops?'], { cooktop: true }],
  ['microwave', ['micro ondas', 'microondas', 'micro onda', 'fornos? (de )?micro ondas?', 'fornos? (de )?microondas']],
  ['microwave', ['fornos? eletricos?', 'fornos? de embutir', 'fornos? de bancada', 'fornos?'], { electricOven: true }],
  ['air_conditioner', ['ar condicionados?', 'ares condicionados', 'condicionadores? de ar', 'split', 'splits', 'ar split', 'climatizacao']],
  ['air_conditioner', ['ar condicionados? (de )?janela', 'ar de janela'], { window: true }],
  ['air_conditioner', ['ar portatil', 'ar condicionado portatil'], { portable: true }],
  ['air_conditioner', ['climatizadores?( de ar| evaporativos?)?'], { portable: true, cooler: true }],
  ['small_appliance', ['eletroportateis', 'eletroportatil', 'portateis', 'eletros? portateis', 'utilidades domesticas', 'cozinha eletrica']],
  // decoração, têxteis e outros (gerador genérico com arquétipo)
  ['generic', ['tapetes?', 'passadeiras?'], { family: 'decor', decor: 'rug' }],
  ['generic', ['luminarias?', 'abajures?', 'abajur', 'lustres?', 'pendentes?', 'arandelas?', 'iluminacao'], { family: 'decor', decor: 'lamp' }],
  ['generic', ['espelhos?'], { family: 'decor', decor: 'mirror' }],
  ['generic', ['quadros?', 'telas? decorativas?'], { family: 'decor', decor: 'frame' }],
  ['generic', ['vasos?', 'decoracao', 'decorativos?', 'enfeites?', 'esculturas?', 'objetos? decorativos?'], { family: 'decor', decor: 'vase' }],
  ['generic', ['suportes?( para tv| de tv)?'], { family: 'decor', decor: 'bracket' }],
  // cortina/persiana: painel pendurado num varão (largura x altura), não uma pilha de tecido
  ['generic', ['cortinas?', 'cortinados?', 'persianas?', 'varoes? de cortina'], { family: 'decor', decor: 'curtain' }],
  ['generic', ['escadas?( decorativas?| domesticas?| de aluminio| de madeira| multiuso)?', 'escadinhas?'], { family: 'decor', decor: 'ladder' }],
  ['generic', ['almofadas?', 'futons? de assento'], { family: 'soft', textile: true, textileKind: 'cushion' }],
  ['generic', ['jogos? de cama', 'jogos? de lencol', 'lencois', 'lencol', 'edredons?', 'edredom', 'cobertores?', 'mantas?', 'toalhas?', 'cama mesa e banho', 'cama mesa banho', 'colchas?', 'cobre leitos?', 'jogos? de toalhas?', 'roupas? de cama', 'duvets?', 'protetor(es)? de colchao'], { family: 'soft', textile: true, textileKind: 'folded' }],
  // ambientes amplos (fracos)
  ['sofa', ['salas?', 'salas? de estar', 'sala de tv', 'living'], {}, true],
  ['bed', ['quartos?', 'dormitorios?'], {}, true],
  ['crib', ['infantil', 'infantis', 'bebes?', 'quarto de bebe', 'kids'], {}, true],
  ['generic', ['moveis', 'movel'], { family: 'furniture' }, true],
  ['generic', ['eletro', 'eletros', 'eletrodomesticos?', 'eletronicos?', 'linha branca', 'eletrodomestico'], { family: 'appliance' }, true],
  ['generic', ['jardim', 'varandas?', 'areas? externas?', 'lazer', 'area externa'], { family: 'furniture' }, true],
  ['generic', ['ofertas?', 'promocao', 'promocoes', 'lancamentos?', 'novidades', 'outlet', 'destaques?', 'mais vendidos'], {}, true],
];

// Eletroportáteis: palavra -> style.appliance
const APPLIANCE_TABLE = [
  ['coffee_maker', ['cafeteiras?( eletricas?| expresso| italiana)?', 'maquinas? de cafe', 'cafeteira de capsula']],
  ['blender', ['liquidificador(es)?', 'mixer(es)? de mao', 'mixer(es)?']],
  ['air_fryer', ['air fryer', 'airfryer', 'fritadeiras?( eletricas?| sem oleo)?']],
  ['kettle', ['chaleiras?( eletricas?)?']],
  ['toaster', ['torradeiras?']],
  ['mixer', ['batedeiras?( planetarias?)?']],
  ['fan', ['ventilador(es)?( de mesa| de coluna| de teto| de parede)?', 'circulador(es)?( de ar)?']],
  ['iron', ['ferros? (de passar|a vapor)', 'ferros? de passar roupas?', 'vaporizador(es)?']],
  ['vacuum', ['aspirador(es)?( de po| vertical| robo)?', 'robos? aspirador(es)?']],
  ['sandwich_maker', ['sanduicheiras?', 'grill(s)?', 'grills? eletricos?', 'chapas? eletricas?']],
  ['food_processor', ['processador(es)?( de alimentos)?', 'multiprocessador(es)?']],
  ['rice_cooker', ['panelas? eletricas?( de arroz)?', 'panelas? de arroz']],
  ['pressure_cooker', ['panelas? de pressao eletricas?', 'panela de pressao']],
  ['juicer', ['espremedor(es)?( de frutas)?', 'centrifugas? de alimentos', 'extratores? de sucos?']],
  ['water_purifier', ['purificador(es)?( de agua)?', 'bebedouros?', 'filtros? de agua']],
  ['heater', ['aquecedor(es)?( eletricos?)?']],
  ['speaker', ['caixas? de som', 'soundbars?', 'micro systems?', 'radios?', 'caixas? bluetooth']],
  ['hair_dryer', ['secador(es)?( de cabelo)?']],
  ['hair_straightener', ['chapinhas?', 'pranchas?( de cabelo)?', 'escovas? secadoras?']],
  ['popcorn', ['pipoqueiras?']],
  ['range_hood', ['coifas?', 'depurador(es)?( de ar)?', 'exaustor(es)?( de cozinha| de ar)?']],
  ['phone', ['celulares?', 'smartphones?', 'telefones?']],
  ['laptop', ['notebooks?', 'laptops?', 'computador(es)?']],
  ['tablet', ['tablets?']],
  ['console', ['video ?games?', 'consoles?', 'playstation', 'xbox', 'nintendo']],
];

const RULES = [];
RULE_TABLE.forEach(([kind, pats, style, weak], i) =>
  pats.forEach((p) => RULES.push({ kind, re: compile(p), style: style || null, weak: !!weak, order: i }))
);
APPLIANCE_TABLE.forEach(([appliance, pats]) =>
  pats.forEach((p) => RULES.push({ kind: 'small_appliance', re: compile(p), style: { appliance }, weak: false, order: 999 }))
);
const APPLIANCE_RULES = APPLIANCE_TABLE.flatMap(([appliance, pats]) => pats.map((p) => ({ appliance, re: compile(p) })));

function allMatches(text) {
  const hits = [];
  for (const r of RULES) for (const m of findAll(text, r.re)) hits.push({ ...m, rule: r });
  // mais cedo primeiro; no empate, o mais longo; depois a ordem da tabela
  hits.sort((a, b) => a.start - b.start || b.len - a.len || a.rule.order - b.rule.order);
  return hits;
}
// "8 serviços" (lava-louças) ou "12 serviços" é capacidade, não um serviço sem 3D
const countedNone = (text, h) => h.rule.kind === 'none' && /\d $/.test(text.slice(0, h.start));
// Primeira ocorrência (o substantivo principal costuma vir primeiro no nome)
function firstMatch(text) {
  return allMatches(text).find((h) => !countedNone(text, h)) || null;
}
// Varredura gulosa sem sobreposição ("Mesas e Cadeiras" -> mesa, cadeira)
function scanMatches(text) {
  const out = [];
  let end = -1;
  for (const h of allMatches(text)) {
    if (h.start < end) continue;
    out.push(h);
    end = h.end;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Contexto                                                            */
/* ------------------------------------------------------------------ */
const asCat = (c) => {
  if (!c) return null;
  if (typeof c === 'string') return { name: c, slug: slugify(c), model_kind: null };
  return c;
};
const specList = (p) => (Array.isArray(p?.specs) ? p.specs.filter((s) => s && (s.label || s.value)) : []);
const specText = (p) => specList(p).map((s) => `${s.label || ''} ${s.value || ''}`).join(' . ');
const tagText = (p) => (Array.isArray(p?.tags) ? p.tags.join(' . ') : String(p?.tags || ''));
const validKind = (k) => typeof k === 'string' && KIND_IDS.includes(k);

function pickVariant(product, variant) {
  const vs = Array.isArray(product?.variants) ? product.variants.filter(Boolean) : [];
  if (variant && typeof variant === 'object') return variant;
  if (variant != null && variant !== '') {
    const v = vs.find((x) => x.id === variant || x.name === variant) || vs[Number(variant)];
    if (v) return v;
  }
  return vs.find((x) => x.in_stock !== false) || vs[0] || null;
}

/* ------------------------------------------------------------------ */
/* Tipo                                                                */
/* ------------------------------------------------------------------ */
// Retorna { kind, source, style } — source explica de onde veio (útil na Galeria 3D).
export function inferKind(product, ctx = {}) {
  const p = product || {};
  const cat = asCat(ctx.category);
  const parent = asCat(ctx.parentCategory);
  const forced = p.model3d && typeof p.model3d === 'object' ? p.model3d.kind : null;
  if (validKind(forced)) return { kind: forced, source: 'produto (model3d.kind)', style: {} };

  const nameHit = firstMatch(normText(p.name));
  const tagHit = nameHit ? null : firstMatch(normText(tagText(p)));
  const specHit = nameHit || tagHit ? null : firstMatch(normText(specText(p)));
  const prod = nameHit || tagHit || specHit;
  const prodSrc = nameHit ? 'nome do produto' : tagHit ? 'tags' : 'especificações';
  const style = {};
  const withStyle = (hit) => Object.assign(style, hit?.rule.style || {});

  // 'none' pelo nome (serviços, garantia) sempre vale; decoração/têxtil pelo nome também
  if (nameHit?.rule.kind === 'none') return { kind: 'none', source: 'nome do produto', style };
  if (nameHit?.rule.kind === 'generic' && ['decor', 'soft'].includes(nameHit.rule.style?.family)) {
    withStyle(nameHit);
    return { kind: 'generic', source: 'nome do produto', style };
  }

  const explicit = cat && validKind(cat.model_kind) && !['generic'].includes(cat.model_kind) ? cat.model_kind : null;
  let cands = [];
  let weak = false;
  let catStyle = {};
  if (explicit) {
    cands = [explicit];
  } else if (cat) {
    const hits = scanMatches(normText(`${cat.name || ''}`));
    const slugHits = hits.length ? [] : scanMatches(normText(String(cat.slug || '').replace(/-/g, ' ')));
    const list = hits.length ? hits : slugHits;
    const strong = list.filter((h) => !h.rule.weak);
    const use = strong.length ? strong : list;
    weak = !strong.length && list.length > 0;
    cands = use.map((h) => h.rule.kind);
    if (use[0]) catStyle = use[0].rule.style || {};
  }

  if (cands.length && !weak) {
    const fams = new Set(cands.map((k) => FAMILY[k]));
    if (prod && prod.rule.kind !== 'none' && (cands.includes(prod.rule.kind) || fams.has(FAMILY[prod.rule.kind]))) {
      withStyle(prod);
      return { kind: prod.rule.kind, source: `categoria + ${prodSrc}`, style };
    }
    Object.assign(style, catStyle);
    // a palavra do produto ainda pode trazer estilo útil se for do mesmo tipo
    return { kind: cands[0], source: explicit ? 'categoria (model_kind)' : 'categoria', style };
  }
  if (prod && prod.rule.kind !== 'none') {
    withStyle(prod);
    return { kind: prod.rule.kind, source: prodSrc, style };
  }
  if (cands.length) {
    Object.assign(style, catStyle);
    return { kind: cands[0], source: 'categoria (ampla)', style };
  }
  if (parent) {
    const pk = validKind(parent.model_kind) && parent.model_kind !== 'generic' ? parent.model_kind : null;
    if (pk) return { kind: pk, source: 'categoria-mãe (model_kind)', style };
    const ph = scanMatches(normText(`${parent.name || ''} ${String(parent.slug || '').replace(/-/g, ' ')}`))[0];
    if (ph && ph.rule.kind !== 'none') {
      Object.assign(style, ph.rule.style || {});
      return { kind: ph.rule.kind, source: 'categoria-mãe', style };
    }
  }
  return { kind: 'generic', source: 'padrão', style };
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */
const UPHOLSTERY_TABLE = [
  ['suede', 'suede( amassado)?|camurca|nobuck|veludo cotele'],
  ['velvet', 'veludo|velvet|chenille|chenile'],
  ['boucle', 'boucle|bucle|teddy|pelucia'],
  ['leather', 'couro( sintetico| ecologico| legitimo| natural)?|corino|courino|courvin|material sintetico|sintetico|pu'],
  ['linen', 'linho|linen|linhao'],
  ['cotton', 'algodao|sarja|jacquard|tricoline|oxford'],
  ['fabric', 'tecido|estofad[oa]s?|estofamento'],
];
const BODY_TABLE = [
  ['marble', 'marmore|marmorizad[oa]|granito|pedra sinterizada|sinterizad[oa]|quartzo|travertino'],
  ['glass', 'vidro|tampo de vidro|cristal|acrilico'],
  ['steel', 'inox|aco inox|aco escovado|aco inoxidavel'],
  ['wood', 'madeira( macica| de demolicao| de eucalipto| de pinus| natural)?|macic[oa]|demolicao|eucalipto|pinus|tauari|jequitiba|teca|carvalho macico|freijo macico'],
  ['mdf', 'mdf|mdp|bp|aglomerado|madeira industrializada|melamina|melaminico'],
  ['lacquer', 'laca|laqueado|laqueada|alto brilho'],
  ['metal', 'metal|metalic[oa]|aco( carbono)?|ferro|aluminio|tubular|estrutura metalica|cromad[oa]'],
  ['plastic', 'plastico|polipropileno|abs|resina|pvc'],
  ['cane', 'palhinha|rattan|vime|junco|fibra sintetica|corda nautica'],
];
const compileTable = (t) => t.map(([id, src]) => ({ id, re: compile(src) }));
const UPHOLSTERY = compileTable(UPHOLSTERY_TABLE);
const UPHOLSTERY_SPECIFIC = UPHOLSTERY.filter((r) => r.id !== 'fabric');
const BODY = compileTable(BODY_TABLE);
function firstOf(table, text) {
  let best = null;
  for (const r of table) {
    const m = findAll(text, r.re)[0];
    if (m && (!best || m.start < best.start || (m.start === best.start && m.len > best.len))) best = { ...m, id: r.id };
  }
  return best?.id || null;
}
function inferMaterial(kind, p, variant) {
  const specMat = specList(p)
    .filter((s) => /revestimento|tecido|material|acabamento|estrutura|tampo|corpo|base|assento/i.test(normText(s.label)))
    .map((s) => s.value)
    .join(' . ');
  const appliance = FAMILY[kind] === 'appliance';
  const sources = (appliance ? [variant?.name, p.name, specMat] : [variant?.name, p.name, specMat, p.short_description, p.description]).map(normText);
  if (UPHOLSTERED.has(kind) || kind === 'generic' || kind === 'stool') {
    for (const t of sources) {
      // tecido específico (veludo, linho, suede...) vale mais que o genérico "estofado/tecido" no mesmo texto
      const u = firstOf(UPHOLSTERY_SPECIFIC, t) || firstOf(UPHOLSTERY, t);
      if (u) return u;
    }
    // cadeira sem tecido no nome: o corpo decide (polipropileno, madeira, metal...)
    if (kind === 'chair') {
      for (const t of sources.slice(1)) {
        const b = firstOf(BODY.filter((r) => r.id !== 'cane'), t);
        if (b) return b;
      }
    }
    if (UPHOLSTERED.has(kind)) return DEFAULTS[kind].material;
  }
  // camas: tecido no nome ou na variante (cabeceira estofada, veludo, linho, corino...) define o material
  if (kind === 'bed') {
    for (const t of sources.slice(0, 2)) {
      // "Cabeceira Estofada ... Veludo": o tecido citado vale mais que o genérico "estofada"
      const u = firstOf(UPHOLSTERY_SPECIFIC, t) || firstOf(UPHOLSTERY, t);
      if (u) return u;
    }
  }
  for (const t of sources.slice(1)) {
    const b = firstOf(BODY.filter((r) => r.id !== 'cane'), t);
    if (b) return b;
  }
  // a cor do variante "Inox" vale como material em eletros
  if (FAMILY[kind] === 'appliance' && /inox|aco/.test(normText(variant?.name))) return 'steel';
  for (const t of sources.slice(1)) if (firstOf(BODY.filter((r) => r.id === 'cane'), t)) return kind === 'generic' ? 'cane' : DEFAULTS[kind]?.material || 'mdf';
  return DEFAULTS[kind]?.material || 'mdf';
}

/* ------------------------------------------------------------------ */
/* Estilo                                                              */
/* ------------------------------------------------------------------ */
const NUM_WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const toNum = (s) => (s == null ? null : NUM_WORDS[s] ?? (Number.isFinite(Number(s)) ? Number(s) : null));
const NUMW = '(\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)';
const countOf = (t, nounRe) => {
  const m = new RegExp(` ${NUMW} (?:${nounRe}) `).exec(t);
  return m ? toNum(m[1]) : null;
};
const has = (t, src) => compile(src).test(t);
const specValue = (p, labelRe) => {
  const s = specList(p).find((x) => labelRe.test(normText(x.label)));
  return s ? String(s.value ?? '') : null;
};

function parseStyle(kind, p, variant, rawText) {
  const t = normText(rawText);
  const st = {};
  // números ("3 lugares", "4 bocas"...) no texto e nas especificações
  const seats = countOf(t, 'lugares|lugar') ?? toNum(normText(specValue(p, / lugares? /)).trim().split(' ')[0]);
  if (seats) st.seats = seats;
  const drawers = countOf(t, 'gavetas|gaveta') ?? toNum(normText(specValue(p, / gavetas? /)).trim().split(' ')[0]);
  if (drawers) st.drawers = drawers;
  else if (has(t, 'gavetas?') && kind !== 'stove') st.drawers = 1;
  const doors = countOf(t, 'portas|porta') ?? toNum(normText(specValue(p, / portas? /)).trim().split(' ')[0]);
  if (doors) st.doors = doors;
  const burners = countOf(t, 'bocas|boca|queimadores|queimador') ?? toNum(normText(specValue(p, / bocas? | queimadores? /)).trim().split(' ')[0]);
  if (burners) st.burners = burners;
  const chairs = countOf(t, 'cadeiras|cadeira|lugares');
  if (chairs && FAMILY[kind] === 'table') st.chairs = chairs;
  const shelves = countOf(t, 'prateleiras|prateleira');
  if (shelves) st.shelf = shelves;
  else if (has(t, 'prateleiras?')) st.shelf = true;
  const niches = countOf(t, 'nichos|nicho');
  if (niches) st.niche = niches;
  else if (has(t, 'nichos?')) st.niche = true;

  // polegadas (no texto original, antes de normalizar), litros e kg
  const raw = String(rawText || '');
  const inch = /(\d{2,3})(?:[.,]\d)?\s*(?:"|''|”|″|polegadas|pol\b)/i.exec(raw);
  if (inch) st.screenIn = Number(inch[1]);
  const liters = /(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litros?)\b/i.exec(raw);
  if (liters) st.capacityL = Number(liters[1].replace(',', '.'));
  const kg = /(\d+(?:[.,]\d+)?)\s*kg\b/i.exec(String(p.name || '') + ' ' + specText(p));
  if (kg && FAMILY[kind] === 'appliance') st.capacityKg = Number(kg[1].replace(',', '.'));

  // estofados
  if (has(t, 'chesterfield|capitone|capitonne|botone|botonado|capitonado')) st.tufted = true;
  if (has(t, 'retro|vintage|anos 50|anos 60')) st.retro = true;
  if (has(t, 'organic[oa]s?|curv[oa]s?|formas curvas|arredondad[oa]s?|sinuos[oa]')) st.organic = true;
  if (has(t, 'almofadas soltas|confort|almofadas? de encosto soltas?|com almofadas')) st.looseCushions = true;
  if (has(t, 'chaise|chaises|chaiselongue|diva')) st.chaise = true;
  if (has(t, 'de canto|em l|sofa de canto|canto')) st.corner = true;
  if (has(t, 'retratil|retrateis')) st.retractable = true;
  if (has(t, 'reclinavel|reclinaveis|reclinar|do papai')) st.reclinable = true;
  if (has(t, 'sem bracos?')) st.arms = false;
  else if (has(t, 'com bracos?|bracos rolados|braco')) st.arms = true;
  if (has(t, 'bracos? rolados?')) st.rolledArms = true;
  if (has(t, 'orelhas?|bergere|wingback')) st.wing = true;
  if (has(t, 'giratori[oa]s?|giratoria')) st.swivel = true;
  if (has(t, 'rodizios?|rodinhas?')) st.wheels = true;
  // pés
  const pes = normText(`${specValue(p, / pes | base | estrutura /) || ''}`);
  if (has(t, 'pes palito|palito|palitos')) st.legs = 'palito';
  else if (has(t, 'torneados?|torneadas?')) st.legs = 'turned';
  else if (has(t, 'hairpin|grampo')) st.legs = 'metal';
  else if (has(t, 'base de madeira|base em madeira|base madeira') || /^ madeira/.test(normText(specValue(p, / base /) || ''))) st.legs = 'wood_base';
  else if (has(t, 'estrutura metalica|pes de metal|pes metalicos?|pes em metal|pes de ferro|pes cromados?|metalon|industrial|pes em aco|base metalica|aco carbono')) st.legs = 'metal';
  else if (has(t, 'sem pes|pes embutidos|base embutida|rente ao chao')) st.legs = 'hidden';
  else if (has(t, 'pes de madeira|pes em madeira|pes madeira') || /madeira/.test(pes)) st.legs = 'wood';
  // quarto
  if (has(t, 'ripad[oa]s?|ripas|ripado')) st.headboard = 'slats';
  else if (has(t, 'cabeceira estofada|cabeceira capitone|cabeceira em tecido|cabeceira de tecido|estofad[oa]') && FAMILY[kind] === 'bed') st.headboard = 'upholstered';
  else if (has(t, 'sem cabeceira|base box')) st.headboard = 'none';
  if (has(t, 'box')) st.box = true;
  if (has(t, 'pillow top|pillowtop|euro pillow|europillow|pillow in|one face|duplo pillow')) st.pillowTop = true;
  if (has(t, 'molas ensacadas|molas pocket|pocket')) st.springs = 'pocket';
  else if (has(t, 'molas bonnel|molas|bonnel')) st.springs = 'bonnel';
  else if (has(t, 'espuma|d23|d28|d33|d45|d40|ortopedico|latex|viscoelastico')) st.springs = 'foam';
  // tamanho: o mais específico vence ("Cama Box Casal King" é king, não casal)
  const size = [' super king ', ' king ', ' queen ', ' solteirao ', ' viuva ', ' solteiro ', ' casal ', ' berco '].find((w) => t.includes(w));
  if (size) st.mattressSize = size.trim().replace('super king', 'king');
  // quarto: provençal, trocador, montessoriana/casinha, criados acoplados, berço portátil ou com cômoda,
  // closet aberto e móvel espelhado (todo revestido de espelho)
  if (has(t, 'provencal|provencais|provence')) st.provencal = true;
  if (has(t, 'trocador|com trocador') && kind === 'dresser') st.changer = true;
  if (kind === 'wardrobe' && has(t, 'maleiros?|com maleiro')) st.maleiro = true;
  if (kind === 'dresser' && has(t, 'basculantes?')) st.flaps = true;
  if (has(t, 'montessorian[oa]s?|montessori') && FAMILY[kind] === 'bed') st.montessori = true;
  if (has(t, 'casinha|formato de casa|estilo casinha') && FAMILY[kind] === 'bed') st.house = true;
  if (kind === 'bed' && has(t, 'mesas? laterais|criados? mudos? acoplados?|criados? acoplados?|com criados?( mudos?)?|mesas? de cabeceira acopladas?|com mesas? de cabeceira')) st.sideTables = true;
  if (kind === 'crib' && has(t, 'portatil|portateis|cercadinho|chiqueirinho|playard|play yard')) st.portable = true;
  if (kind === 'crib' && has(t, 'comodas?|comoda acoplada')) st.chest = true;
  if (kind === 'wardrobe' && has(t, 'closet aberto|aberto|aberta|sem portas?|cabideiro|arara')) st.open = true;
  if ((kind === 'nightstand' || kind === 'dresser') && has(t, 'espelhad[oa]s?')) st.mirrored = true;
  // armários
  if (has(t, 'portas? de correr|de correr|deslizantes?')) st.sliding = true;
  if (has(t, 'espelh(o|os|ad[oa]s?)|com espelho')) st.mirror = true;
  if (has(t, 'palhinha|rattan|vime|tela sextavada|cane')) st.cane = true;
  if (has(t, 'vidro|tampo de vidro|portas? de vidro|cristal')) st.glass = true;
  if (has(t, 'marmore|marmorizad[oa]|pedra sinterizada|sinterizad[oa]|granito|travertino')) st.marble = true;
  if (has(t, 'redond[oa]s?|circular(es)?')) st.shape = 'round';
  else if (has(t, 'ova(l|is)')) st.shape = 'oval';
  else if (has(t, 'quadrad[oa]s?')) st.shape = 'square';
  if (has(t, 'suspens[oa]s?|de parede|parede|flutuante')) st.wallMount = true;
  if (FAMILY[kind] === 'table' && has(t, 'tripes?')) {
    st.legCount = 3;
    if (!st.shape) st.shape = 'round';
  }
  if (kind === 'shelf' && has(t, 'prateleiras?') && !has(t, 'estantes?|livreiros?|nichos?|niveis|andares') && (st.wallMount || has(t, 'flutuantes?'))) st.floating = true;
  if (has(t, 'led|com led|iluminacao')) st.led = true;
  if (has(t, 'industrial')) st.industrial = true;
  if (has(t, 'rustic[oa]s?|demolicao')) st.rustic = true;
  if (has(t, 'nordic[oa]s?|escandinav[oa]|minimalista')) st.nordic = true;
  // eletro
  if (has(t, 'forno|com forno')) st.oven = true;
  if (has(t, 'abertura frontal|frontal|front load|lava e seca|lava seca')) st.frontLoad = true;
  else if (has(t, 'abertura superior|top load|tanquinho|tampa de vidro')) st.topLoad = true;
  if (has(t, 'duplex|2 portas|duas portas')) st.duplex = true;
  if (has(t, 'inverse|invertida|freezer inferior|bottom freezer')) st.inverse = true;
  if (has(t, 'side by side|sidebyside')) st.sideBySide = true;
  if (has(t, 'french door|frenchdoor|4 portas|quatro portas')) st.frenchDoor = true;
  if (has(t, 'frost free|frostfree|no frost')) st.frostFree = true;
  if (has(t, 'smart|wi fi|wifi')) st.smart = true;
  if (has(t, 'eletric[oa]s?') && FAMILY[kind] === 'appliance') st.electric = true;
  if (has(t, 'inducao')) st.induction = true;
  if (has(t, 'inox')) st.inox = true;
  if (has(t, 'embutir|de embutir')) st.builtIn = true;
  if (st.retro) st.rounded = true;
  // eletroportátil (só para eletroportáteis e genéricos)
  if (kind === 'small_appliance' || kind === 'generic') {
    for (const r of APPLIANCE_RULES) {
      if (findAll(normText(p.name), r.re).length) {
        st.appliance = r.appliance;
        break;
      }
    }
  }
  if (!st.appliance && kind === 'small_appliance') {
    for (const r of APPLIANCE_RULES) {
      if (findAll(t, r.re).length) {
        st.appliance = r.appliance;
        break;
      }
    }
  }
  if (has(t, 'ventilador de teto')) st.ceiling = true;
  // eletro: subtipos que mudam a forma do modelo
  const nmE = normText(p.name);
  if (kind === 'fridge' && !st.freezer && /^ freezers? /.test(nmE)) st.freezer = has(nmE, 'horizontal|horizontais|tampas?') ? 'chest' : 'vertical';
  if (kind === 'air_conditioner' && has(t, 'janela')) st.window = true;
  const btu = /(\d{1,2})[.,]?(\d{3})\s*btus?\b/i.exec(raw);
  if (btu && kind === 'air_conditioner') st.btu = Number(btu[1] + btu[2]);
  if (st.appliance === 'coffee_maker' && has(t, 'expresso|espresso|capsulas?|nespresso|dolce gusto|tres coracoes|\\d+ bar|bares')) st.espresso = true;
  if (st.appliance === 'coffee_maker' && has(t, 'capsulas?|nespresso|dolce gusto|tres coracoes')) st.capsule = true;
  if (st.appliance === 'coffee_maker' && !st.espresso && has(nmE, 'italianas?|moka')) st.moka = true;
  if (kind === 'tv' && has(t, 'pedestal|base central|suporte central|pe central')) st.stand = 'pedestal';
  else if (kind === 'tv' && has(t, 'cavaletes?|tripe')) st.stand = 'easel';
  if (st.appliance === 'blender' && has(nmE, 'mixer(es)?|de mao')) st.stick = true;
  if (st.appliance === 'water_purifier' && has(t, 'garrafao|garrafoes|bebedouros? de coluna|bebedouros? de pe|bebedouros? de mesa')) st.bottle = true;
  // ventilador: número de pás ("3 Pás") — no de teto muda a profundidade real (ver ceilingFanLayout)
  if (st.appliance === 'fan') {
    const nb = countOf(t, 'pas|helices|helice');
    if (nb) st.blades = nb;
  }
  // coifa de parede (campânula + chaminé), de ilha ou depurador (caixa fina sob o armário)
  if (st.appliance === 'range_hood') st.hood = has(nmE, 'depurador(es)?') ? 'flat' : has(nmE, 'ilha') ? 'island' : 'wall';
  // lava-louças: capacidade em serviços e modelo de bancada
  if (kind === 'washer' && has(t, 'lava loucas?|lavaloucas?|lavadoras? de loucas?|maquinas? de lavar loucas?')) {
    const n = countOf(t, 'servicos|servico|lugares');
    if (n) st.places = n;
    if (has(t, 'de bancada|bancada|compacta|portatil')) st.countertop = true;
  }

  // abreviações comuns no cadastro ("GUARDA ROUPA 4 PTS 2 GAV")
  if (!countOf(t, 'portas|porta')) {
    const n = countOf(t, 'pts|ptas|prts');
    if (n) st.doors = n;
  }
  if (!countOf(t, 'gavetas|gaveta')) {
    const n = countOf(t, 'gav|gavs|gvs');
    if (n) st.drawers = n;
  }
  // "Rack com Painel": rack baixo + painel alto (o mesmo modelo do painel para TV)
  if (kind === 'rack' && has(nmE, 'com painel|e painel|painel')) st.panel = true;

  // decoração: subtipos que mudam a forma e as medidas padrão
  if (kind === 'generic') {
    if (has(nmE, 'luminarias?|abajur(es)?|lustres?|pendentes?|arandelas?|plafons?|plafoniers?|spots?')) {
      if (has(nmE, 'pendentes?|lustres?|de teto|plafons?|plafoniers?')) st.lampType = 'pendant';
      else if (has(nmE, 'arandelas?|de parede')) st.lampType = 'wall';
      else if (has(nmE, 'arco|arcos')) st.lampType = 'arc';
      else if (has(nmE, 'abajur(es)?|de mesa|de cabeceira|de escrivaninha|de leitura|de bancada')) st.lampType = 'table';
      else st.lampType = 'floor';
    }
    if (has(nmE, 'espelhos?') && has(nmE, 'de chao|corpo inteiro|de pe|de piso|chao')) st.floorMirror = true;
    if (has(nmE, 'escadas?|escadinhas?')) {
      st.ladderType = !has(nmE, 'decorativ[oa]s?') && has(nmE, 'aluminio|domesticas?|multiuso|de abrir|banqueta|escadinhas?|aco') ? 'step' : 'lean';
      const n = countOf(nmE, 'degraus|degrau');
      if (n) st.steps = n;
    }
    if (has(nmE, 'persianas?')) st.blinds = true;
    if (has(nmE, 'voil|voal|xale|tule')) st.sheer = true;
  }
  return st;
}

/* ------------------------------------------------------------------ */
/* Medidas                                                             */
/* ------------------------------------------------------------------ */
const pos = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toCm = (v, unit) => {
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (unit === 'mm') return n / 10;
  if (unit === 'm' || (!unit && n < 4 && /[.,]/.test(String(v)))) return n * 100;
  return n;
};
const FLAT = new Set(['mattress', 'bed', 'bunk_bed', 'coffee_table', 'side_table', 'dining_table', 'desk']);
// Lê medidas do texto ("138x188x30 cm", "160 x 90", "210 cm", "1,20 m")
function dimsFromText(kind, text, flat = FLAT.has(kind), dh = DEFAULTS[kind]?.h || 60, st = {}) {
  const s = String(text || '').toLowerCase();
  const decor = kind === 'generic' ? st.decor : null;
  // a unidade precisa terminar a palavra ("188 molas" não é 188 metros)
  const N = '(\\d+(?:[.,]\\d+)?)\\s*(?:(cm|mm|m)\\b)?';
  let m = new RegExp(`${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N}`).exec(s);
  if (m) {
    const u = m[6] || m[4] || m[2];
    const v = [toCm(m[1], m[2] || u), toCm(m[3], m[4] || u), toCm(m[5], m[6] || u)];
    if (v.every(Boolean)) {
      // empate: vale a convenção brasileira L x A x P
      let idx = 1;
      v.forEach((x, i) => {
        if (Math.abs(x - dh) < Math.abs(v[idx] - dh)) idx = i;
      });
      if (idx === 1) return { w: v[0], h: v[1], d: v[2] };
      if (idx === 2) return { w: v[0], d: v[1], h: v[2] };
      return { h: v[0], w: v[1], d: v[2] };
    }
  }
  m = new RegExp(`${N}\\s*[x×]\\s*${N}`).exec(s);
  if (m) {
    const u = m[4] || m[2];
    const a = toCm(m[1], m[2] || u);
    const b = toCm(m[3], m[4] || u);
    if (a && b && flat) return { w: a, d: b, fromMattress: kind === 'bed' || kind === 'bunk_bed' };
    // sofá de canto / com chaise: "280x220" é largura x profundidade (sofá não tem 1,2 m de altura)
    if (a && b && kind === 'sofa' && b >= 120) return { w: a, d: b };
    // espelho de chão / corpo inteiro: a medida maior é a altura ("160x60" ou "60x160")
    if (a && b && decor === 'mirror' && st.floorMirror) return { w: Math.min(a, b), h: Math.max(a, b) };
    if (a && b) return { w: a, h: b };
  }
  m = /(\d+(?:[.,]\d+)?)\s*(cm|m)\b/.exec(s);
  if (m && kind !== 'tv') {
    const v = toCm(m[1], m[2]);
    if (v) {
      if (kind === 'mattress' && v <= 45) return { h: v };
      // decoração: o que a medida única quer dizer muda com o objeto
      if (decor === 'vase' || decor === 'ladder') return { h: v };
      if (decor === 'lamp') return st.lampType === 'pendant' || v < dh * 0.6 ? { w: v, d: v } : { h: v };
      if (decor === 'mirror') return st.shape === 'round' ? { w: v, h: v } : st.floorMirror && v > 100 ? { h: v } : { w: v };
      if (decor === 'rug' && st.shape === 'round') return { w: v, d: v };
      // "Banqueta 75 cm" é a altura; com encosto, os 75 cm são do assento e o encosto soma ~27 cm
      // (banco comprido / baú: a medida única é o comprimento)
      if (kind === 'stool' && v <= 100 && !st.bench) return { h: / encosto /.test(` ${normText(s)} `) && v <= 85 ? v + 27 : v };
      // armário multiuso: a medida única do nome é a altura ("Multiuso 2 Portas 180 cm")
      if (kind === 'wardrobe' && / multiuso /.test(` ${normText(s)} `) && v >= 120) return { h: v };
      return { w: v };
    }
  }
  return {};
}
function dimsFromSpecs(kind, p, flat, dh, st = {}) {
  const out = {};
  for (const s of specList(p)) {
    const l = normText(s.label);
    const val = String(s.value ?? '');
    const one = /(\d+(?:[.,]\d+)?)\s*(?:(cm|mm|m)\b)?/i.exec(val);
    const v = one ? toCm(one[1], one[2]?.toLowerCase()) : null;
    if (/ largura /.test(l) && v) out.w = v;
    else if (/ altura /.test(l) && v) out.h = v;
    else if (/ profundidade /.test(l) && v) out.d = v;
    else if (/ comprimento /.test(l) && v) out.d = v;
    else if (/ (dimens|medida|tamanho)/.test(l) && /x/i.test(val)) {
      const r = dimsFromText(kind, val, flat, dh, st);
      if (/colchao/.test(l) && (kind === 'bed' || kind === 'bunk_bed')) r.fromMattress = true;
      for (const k of ['w', 'h', 'd', 'fromMattress']) if (r[k] != null && out[k] == null) out[k] = r[k];
    }
  }
  return out;
}

function inferDims(kind, p, style) {
  const def = dimsDefault(kind, { ...style, _name: normText(p.name) });
  const flat = (FLAT.has(kind) && !style.headboardOnly) || (kind === 'generic' && (style.decor === 'rug' || (style.textile && style.textileKind !== 'cushion'))) || (kind === 'shelf' && style.floating);
  const out = { w: pos(p.width_cm), h: pos(p.height_cm), d: pos(p.depth_cm) };
  // conserta unidades digitadas erradas (mm ou metros): acima de 6 m, fica com a leitura
  // (÷10 ou ÷100) mais próxima da medida típica do tipo ("4500" num criado-mudo é 45 cm, não 450)
  for (const k of ['w', 'h', 'd']) {
    let v = out[k];
    if (v == null) continue;
    if (v > 600) {
      const opts = [v / 10, v / 100, v / 1000].filter((x) => x >= 0.5 && x <= 600);
      if (opts.length) v = opts.reduce((a, b) => (Math.abs(Math.log(b / def[k])) < Math.abs(Math.log(a / def[k])) ? b : a));
    }
    if (v < 4 && v * 100 <= 600 && def[k] > 20) v *= 100;
    out[k] = v;
  }
  const fill = (src) => {
    let add = { ...src };
    // medida do colchão vira medida da cama (+ estrutura); a cama box tem a medida do próprio colchão
    // (com mesas laterais acopladas, soma ~50 cm de cada lado)
    if (src.fromMattress && add.w && add.d && !style.box) add = { ...add, w: add.w + 12 + (style.sideTables ? 100 : 0), d: add.d + 17 };
    for (const k of ['w', 'h', 'd']) if (out[k] == null && pos(add[k])) out[k] = add[k];
  };
  fill(dimsFromSpecs(kind, p, flat, def.h, style));
  // têxtil dobrado (edredom, toalha, manta): as medidas do nome são do tecido aberto; o 3D mostra a peça dobrada
  if (!(kind === 'generic' && style.textileKind === 'folded')) fill(dimsFromText(kind, p.name, flat, def.h, style));
  // pistas do estilo
  if (kind === 'mattress' || kind === 'bed' || kind === 'crib') {
    const ms = MATTRESS_SIZES[style.mattressSize] || (kind === 'crib' ? MATTRESS_SIZES.berco : null);
    if (ms) {
      if (kind === 'mattress') fill({ w: ms.w, d: ms.d, h: style.pillowTop ? 30 : 25 });
      else if (kind === 'bed') fill(style.headboardOnly ? { w: ms.w + 12 } : style.box ? { w: ms.w, d: ms.d + (style.headboard && style.headboard !== 'none' ? 8 : 0) } : { w: ms.w + 12 + (style.sideTables ? 100 : 0), d: ms.d + 17 });
      else if (!style.portable) fill({ w: ms.d + 8 + (style.chest ? 50 : 0), d: ms.w + 10 });
    }
  }
  if (kind === 'tv' && style.screenIn) {
    const diag = style.screenIn * 2.54;
    const pw = diag * 0.8716 + 1.5;
    const ph = diag * 0.4903 + 1.5;
    // no cavalete a TV fica bem acima do chão (pés de ~80 cm); no pedestal central a base é mais rasa
    if (style.stand === 'easel') fill({ w: pw + 4, h: ph + 80, d: 55 });
    else if (style.stand === 'pedestal') fill({ w: pw, h: ph * 1.12, d: Math.max(22, pw * 0.18) });
    fill({ w: pw, h: ph * 1.12, d: Math.max(18, pw * 0.2) });
  }
  // sofá de canto (em L) e com chaise são mais profundos; o de canto divide os lugares nos dois lados
  if (kind === 'sofa' && style.corner) fill({ w: style.seats ? Math.max(200, Math.ceil(style.seats / 2) * 65 + 110) : 250, d: 200 });
  if (kind === 'sofa' && style.chaise && !style.corner) fill({ d: 160 });
  if (kind === 'sofa' && style.seats) fill({ w: style.seats * 60 + 40 });
  // puff/banqueta redondo (ou bola): uma medida só vale como diâmetro
  if ((kind === 'pouf' || kind === 'stool') && !style.bench && (style.shape === 'round' || / (bola|esfera) /.test(` ${normText(p.name)} `))) {
    if (out.w != null && out.d == null) out.d = out.w;
    else if (out.d != null && out.w == null) out.w = out.d;
  }
  // mesa redonda: uma medida só vale como diâmetro; com cadeiras, o diâmetro vem do número de lugares
  // (mesa de apoio/centro cilíndrica ou tambor sem formato citado também é redonda)
  const drum = !style.shape && (kind === 'side_table' || kind === 'coffee_table') && / (cilindric[oa]s?|tambor) /.test(normText(p.name));
  if (FAMILY[kind] === 'table' && (style.shape === 'round' || drum)) {
    if (out.w != null && out.d == null) out.d = out.w;
    else if (out.d != null && out.w == null) out.w = out.d;
    if (kind === 'dining_table' && style.chairs) {
      const dd = style.chairs <= 4 ? 100 : style.chairs <= 6 ? 120 : 140;
      fill({ w: dd, d: dd });
    }
  }
  if (kind === 'dining_table' && style.chairs) fill(style.chairs <= 4 ? { w: 120, d: 80 } : style.chairs <= 6 ? { w: 160, d: 90 } : { w: 200, d: 100 });
  // decoração redonda (vaso, luminária, tapete redondo, espelho redondo): uma medida só vale para as duas
  if (kind === 'generic') {
    const roundWD = style.decor === 'vase' || (style.decor === 'lamp' && style.lampType !== 'arc' && style.lampType !== 'wall') || (style.decor === 'rug' && style.shape === 'round');
    if (roundWD && out.w != null && out.d == null) out.d = out.w;
    else if (roundWD && out.d != null && out.w == null) out.w = out.d;
    if (style.decor === 'mirror' && style.shape === 'round') {
      if (out.w != null && out.h == null) out.h = out.w;
      else if (out.h != null && out.w == null) out.w = out.h;
    }
  }
  for (const k of ['w', 'h', 'd']) if (out[k] == null) out[k] = def[k];

  // sanidade por tipo
  if (kind === 'mattress') {
    const v = [out.w, out.h, out.d].sort((a, b) => a - b);
    out.h = v[0];
    out.w = v[1];
    out.d = v[2];
  }
  if (kind === 'tv' && out.d > out.h) [out.d, out.h] = [out.h, out.d];
  for (const k of ['w', 'h', 'd']) {
    const lo = Math.max(0.5, def[k] * 0.05);
    const hi = Math.min(600, Math.max(def[k] * 5, 40));
    out[k] = Math.round(Math.min(hi, Math.max(lo, out[k])) * 10) / 10;
  }
  // ventilador de teto com 3, 5 ou 6 pás: a largura é o diâmetro em X e a profundidade sai da geometria
  if (kind === 'small_appliance' && style.appliance === 'fan' && style.ceiling) {
    const n = style.blades || 4;
    if (n % 4) out.d = Math.round(ceilingFanLayout(n, out.w / 100).d * 1000) / 10;
  }
  return out;
}

// Ventilador de teto: as pás só "fecham" um quadrado com 4 ou 8 pás. Com outro número, a pá mais
// aberta define a largura (X) e a profundidade (Z) é o que sobra. O gerador usa a mesma conta.
//   n pás, largura wM (m) -> { tip: raio da ponta da pá (m), phase (rad), d: profundidade (m), zc: centro em Z (m) }
export const FAN_BLADE_W = 0.12; // largura da pá (m)
export function ceilingFanLayout(n, wM) {
  const k = Math.max(2, Math.min(8, Math.round(Number(n)) || 4));
  const phase = k % 2 ? Math.PI / 2 : 0;
  const ext = (tip) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < k; i++) {
      const a = phase + (i / k) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      for (const s of [-1, 1]) {
        const x = ux * tip - uz * s * FAN_BLADE_W / 2;
        const z = uz * tip + ux * s * FAN_BLADE_W / 2;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
    return { xr: x1 - x0, z0, z1 };
  };
  // a largura em X cresce em linha reta com o raio: resolve com dois pontos
  const a = ext(0.4);
  const b = ext(0.8);
  const tip = Math.max(0.15, 0.4 + ((wM - a.xr) * 0.4) / (b.xr - a.xr));
  const e = ext(tip);
  return { tip, phase, d: e.z1 - e.z0, zc: (e.z0 + e.z1) / 2 };
}

/* ------------------------------------------------------------------ */
/* Spec                                                                */
/* ------------------------------------------------------------------ */
// Padrões de estilo por tipo (sempre presentes para facilitar os geradores)
function styleDefaults(kind, dims, st, material, woodLook) {
  const s = { family: ARCHETYPE[kind] || 'furniture' };
  switch (kind) {
    case 'sofa': {
      const arm = 18;
      s.seats = Math.max(1, Math.min(6, Math.round((dims.w - 2 * arm) / 60)));
      s.legs = 'wood';
      s.arms = true;
      break;
    }
    case 'armchair':
      s.legs = 'wood';
      s.arms = true;
      break;
    case 'chair':
      s.legs = 'wood';
      s.arms = false;
      break;
    case 'stool':
      s.legs = 'wood';
      break;
    case 'bed':
      // cama de ferro/aço/tubular: cabeceira e peseira de tubos
      s.headboard = st.box ? 'none' : material === 'wood' || woodLook ? 'panel' : material === 'metal' || material === 'steel' ? 'metal' : 'upholstered';
      s.legs = st.box ? 'hidden' : material === 'metal' || material === 'steel' ? 'metal' : 'wood';
      break;
    case 'mattress':
      s.pillowTop = false;
      break;
    case 'nightstand':
      s.drawers = 2;
      break;
    case 'dresser':
      s.drawers = Math.max(2, Math.min(6, Math.round((dims.h - 15) / 20)));
      break;
    case 'wardrobe':
      s.doors = Math.max(2, Math.min(8, Math.round(dims.w / 45)));
      s.drawers = 2;
      break;
    case 'rack':
      s.doors = dims.w >= 140 ? 2 : 1;
      s.niche = true;
      break;
    case 'shelf':
      s.shelf = Math.max(2, Math.round(dims.h / 38));
      break;
    case 'kitchen_cabinet':
      s.doors = Math.max(2, Math.round(dims.w / 40));
      break;
    case 'tv':
      s.screenIn = Math.round(Math.hypot(dims.w - 1.5, (dims.w - 1.5) * 0.5625) / 2.54);
      s.smart = true;
      break;
    case 'fridge':
      s.duplex = dims.h >= 140 && !st.freezer && !st.minibar && !st.wine;
      s.frostFree = false;
      break;
    case 'washer':
      s.frontLoad = false;
      s.topLoad = true;
      break;
    case 'stove':
      s.burners = dims.w >= 70 ? 5 : 4;
      s.oven = true;
      break;
    case 'small_appliance':
      s.appliance = 'generic';
      break;
    default:
      break;
  }
  if (woodLook) s.woodLook = true;
  return s;
}

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// Spec completo para gerar o 3D. Retorna null quando o tipo é 'none' (sem 3D).
export function inferSpec(product, ctx = {}) {
  const p = product || {};
  const variant = pickVariant(p, ctx.variant);
  const { kind, style: ruleStyle } = inferKind(p, ctx);
  if (kind === 'none') return null;

  const over = isObj(p.model3d) ? p.model3d : {};
  const material = typeof over.material === 'string' && over.material ? over.material : inferMaterial(kind, p, variant);
  const rawText = [p.name, p.short_description, specText(p), tagText(p)].filter(Boolean).join(' . ');
  const parsed = parseStyle(kind, p, variant, rawText);
  // os ajustes de estilo do model3d já valem para as medidas ("shape: round" numa mesa de 60 cm -> 60 x 60)
  const pre = { ...ruleStyle, ...parsed, ...(isObj(over.style) ? over.style : {}) };
  const dims = inferDims(kind, p, pre);

  // cores
  const def = DEFAULTS[kind] || DEFAULTS.generic;
  const colors = { ...def.colors };
  const vName = variant?.name || '';
  const stops = colorStops(variant?.color);
  const vWords = findColorWords(vName);
  const parts = String(p.name || '').split(/\s[-–—]\s/);
  const nWords = findColorWords(parts.length > 1 ? parts.slice(1).join(' ') : parts[0]);
  const words = vWords.length ? vWords : variant ? [] : nWords;
  const mainHex = stops[0] || words[0]?.hex || null;
  const mainIsWood = vWords.length ? vWords[0].wood : !variant && !!nWords[0]?.wood;
  if (mainHex) colors.main = mainHex;
  // segunda cor (gradiente "Bege e Nogueira" ou duas palavras)
  const second = stops[1] || words[1]?.hex || null;
  const secondIsWood = words[1]?.wood || (stops[1] && words.length > 1 && words[words.length - 1].wood);
  if (second) {
    if (secondIsWood) colors.wood = second;
    else colors.accent = second;
  }
  // aparência de madeira: pela palavra da cor; sem palavra, pelo material; sem cor, pelo padrão do tipo
  const mainWord = vWords.length ? vWords[0] : !variant ? nWords[0] : null;
  let woodLook = false;
  if (WOODY.has(kind)) {
    if (mainWord) woodLook = !!mainWord.wood;
    else if (mainHex) woodLook = material === 'wood';
    else woodLook = DEFAULT_WOODLOOK.has(kind);
  }
  if (woodLook && WOODY.has(kind) && mainHex) colors.wood = colors.main;
  if (kind === 'bed' && mainHex) colors.wood = mainIsWood ? colors.main : colors.wood;

  const base = styleDefaults(kind, dims, pre, material, woodLook);
  let style = { ...base, ...pre };
  if (kind === 'tv' && !parsed.screenIn) style.screenIn = base.screenIn;
  // abertura frontal x superior não podem coexistir
  if (pre.frontLoad && !pre.topLoad) style.topLoad = false;
  if (pre.topLoad && !pre.frontLoad) style.frontLoad = false;

  // bicolor pela variante/nome ("Off White e Freijó", gradiente): corpo na cor e madeira na segunda,
  // mesmo quando a madeira citada é igual à madeira padrão do tipo
  if (second && secondIsWood && !woodLook && WOODY.has(kind) && style.twoTone == null) style.twoTone = true;

  // ajustes manuais do produto (model3d) chave a chave
  if (isObj(over.style)) style = { ...style, ...over.style };
  if (isObj(over.colors)) for (const k of Object.keys(over.colors)) colors[k] = colorHex(over.colors[k], colors[k]);
  // cor principal trocada no model3d (sem woodLook explícito): amadeirado só se for nome de madeira
  if (isObj(over.colors) && over.colors.main != null && !(isObj(over.style) && 'woodLook' in over.style)) style.woodLook = WOODY.has(kind) && isWoodColorName(String(over.colors.main));
  for (const k of Object.keys(colors)) colors[k] = colorHex(colors[k], def.colors[k] || '#9a9a9a');

  return {
    kind,
    w: dims.w,
    h: dims.h,
    d: dims.d,
    colors,
    material,
    style,
    seed: String(p.sku || p.id || p.slug || p.name || kind),
    label: String(p.name || kindLabel(kind)),
  };
}

/* ------------------------------------------------------------------ */
/* Texto curto                                                         */
/* ------------------------------------------------------------------ */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString('pt-BR');
const APPLIANCE_LABEL = {
  coffee_maker: 'Cafeteira', blender: 'Liquidificador', air_fryer: 'Air fryer', kettle: 'Chaleira elétrica', toaster: 'Torradeira',
  mixer: 'Batedeira', fan: 'Ventilador', iron: 'Ferro de passar', vacuum: 'Aspirador', sandwich_maker: 'Sanduicheira',
  food_processor: 'Processador', rice_cooker: 'Panela elétrica', pressure_cooker: 'Panela de pressão', juicer: 'Espremedor',
  water_purifier: 'Purificador de água', heater: 'Aquecedor', speaker: 'Caixa de som', hair_dryer: 'Secador de cabelo',
  hair_straightener: 'Prancha de cabelo', popcorn: 'Pipoqueira', phone: 'Celular', laptop: 'Notebook', tablet: 'Tablet', console: 'Videogame',
  range_hood: 'Coifa',
};
const DECOR_LABEL = { rug: 'Tapete', lamp: 'Luminária', mirror: 'Espelho', frame: 'Quadro', vase: 'Objeto decorativo', bracket: 'Suporte', curtain: 'Cortina', ladder: 'Escada' };
const LAMP_LABEL = { table: 'Abajur', pendant: 'Pendente', wall: 'Arandela', arc: 'Luminária de arco', floor: 'Luminária de chão' };

export function specTitle(spec) {
  if (!spec) return 'Sem 3D';
  const s = spec.style || {};
  const size = MATTRESS_SIZES[s.mattressSize]?.label;
  switch (spec.kind) {
    case 'sofa':
      if (s.corner) return 'Sofá de canto';
      return `Sofá ${plural(s.seats || 3, 'lugar', 'lugares')}${s.chaise ? ' com chaise' : ''}`;
    case 'mattress':
      return s.pillow ? 'Travesseiro' : `Colchão${size ? ` ${size}` : ''}`;
    case 'crib':
      return s.portable ? 'Berço portátil' : s.chest ? 'Berço com cômoda' : 'Berço';
    case 'bed':
      return `${s.headboardOnly ? 'Cabeceira' : s.box ? 'Cama box' : s.house ? 'Cama casinha' : s.montessori ? 'Cama montessoriana' : 'Cama'}${size ? ` ${size}` : ''}`;
    case 'tv':
      return `${s.monitor ? 'Monitor' : 'TV'}${s.screenIn ? ` ${s.screenIn}"` : ''}`;
    case 'fridge':
      if (s.freezer) return 'Freezer';
      if (s.minibar) return 'Frigobar';
      if (s.wine) return 'Adega';
      return s.duplex ? 'Geladeira duplex' : 'Geladeira';
    case 'stove':
      return `${s.cooktop ? 'Cooktop' : 'Fogão'}${s.burners ? ` ${plural(s.burners, 'boca', 'bocas')}` : ''}`;
    case 'washer':
      if (s.dishwasher) return `Lava-louças${s.places ? ` ${plural(s.places, 'serviço', 'serviços')}` : ''}`;
      if (s.tanquinho) return 'Tanquinho';
      return s.dryer ? 'Lava e seca' : 'Lavadora';
    case 'dresser':
      // buffet com portas no nome: conta as portas (as gavetas do padrão não aparecem no nome)
      if (s.sideboard && s.doors) return `Buffet ${plural(s.doors, 'porta', 'portas')}`;
      return `${s.sideboard ? 'Buffet' : s.shoeCabinet ? 'Sapateira' : 'Cômoda'}${s.drawers && !s.shoeCabinet ? ` ${plural(s.drawers, 'gaveta', 'gavetas')}` : ''}${s.changer ? ' com trocador' : ''}`;
    case 'nightstand':
      return `Criado-mudo${s.drawers ? ` ${plural(s.drawers, 'gaveta', 'gavetas')}` : ''}`;
    case 'wardrobe':
      return s.open ? 'Closet aberto' : `Guarda-roupa${s.doors ? ` ${plural(s.doors, 'porta', 'portas')}` : ''}`;
    case 'small_appliance':
      if (s.appliance === 'range_hood') return s.hood === 'flat' ? 'Depurador de ar' : s.hood === 'island' ? 'Coifa de ilha' : 'Coifa';
      if (s.appliance === 'fan' && s.ceiling) return 'Ventilador de teto';
      return APPLIANCE_LABEL[s.appliance] || 'Eletroportátil';
    case 'microwave':
      return s.electricOven ? 'Forno elétrico' : 'Micro-ondas';
    case 'rack':
      return s.panel ? 'Painel para TV' : 'Rack';
    case 'chair':
      return s.office ? 'Cadeira de escritório' : 'Cadeira';
    case 'stool':
      return s.bench ? 'Banco' : 'Banqueta';
    case 'side_table':
      return s.console ? 'Aparador' : 'Mesa lateral';
    case 'dining_table':
      return `Mesa de jantar${s.chairs ? ` com ${plural(s.chairs, 'cadeira', 'cadeiras')}` : ''}`;
    case 'generic':
      if (s.decor === 'lamp') return LAMP_LABEL[s.lampType] || 'Luminária';
      if (s.decor === 'mirror') return s.shape === 'round' ? 'Espelho redondo' : s.floorMirror ? 'Espelho de chão' : 'Espelho';
      if (s.decor === 'curtain') return s.blinds ? 'Persiana' : 'Cortina';
      if (s.textile) return s.textileKind === 'cushion' ? 'Almofada' : s.textileKind === 'folded' ? 'Têxtil dobrado' : 'Têxtil';
      return DECOR_LABEL[s.decor] || 'Modelo genérico';
    default:
      return kindLabel(spec.kind);
  }
}

// "Sofá 3 lugares · 210 × 84 × 92 cm"
export function describeSpec(spec) {
  if (!spec) return 'Sem 3D';
  return `${specTitle(spec)} · ${fmt(spec.w)} × ${fmt(spec.h)} × ${fmt(spec.d)} cm`;
}
