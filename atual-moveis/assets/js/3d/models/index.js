// Monta o modelo 3D de um spec: escolhe o gerador do tipo, confere as medidas e guarda em cache.
//   buildModel(spec)            -> Promise<{ group, size:{w,h,d} cm, triangles, ms, warnings, kind }>
//   loadModelUrl(url, spec?)    -> Promise<{ group, size, triangles, ms, warnings }> (.glb enviado pela equipe)
//   productModel(product, ctx)  -> Promise<{ ...resultado, spec, source:'url'|'procedural' } | null>
import * as THREE from 'three';
import * as kit from '../kit.js';
import { inferSpec } from '../infer.js';

// Tipo -> arquivo do grupo
export const GROUP_OF = {
  sofa: 'seating', armchair: 'seating', chair: 'seating', stool: 'seating', pouf: 'seating',
  bed: 'bedroom', bunk_bed: 'bedroom', crib: 'bedroom', mattress: 'bedroom', nightstand: 'bedroom', dresser: 'bedroom', wardrobe: 'bedroom',
  coffee_table: 'living', side_table: 'living', dining_table: 'living', desk: 'living', rack: 'living', shelf: 'living', kitchen_cabinet: 'living',
  tv: 'appliances', fridge: 'appliances', washer: 'appliances', stove: 'appliances', small_appliance: 'appliances', microwave: 'appliances', air_conditioner: 'appliances',
  generic: 'generic',
};
const LOADERS = {
  seating: () => import('./seating.js'),
  bedroom: () => import('./bedroom.js'),
  living: () => import('./living.js'),
  appliances: () => import('./appliances.js'),
  generic: () => import('./generic.js'),
};
const mods = new Map();
function loadGroup(name) {
  if (!mods.has(name)) mods.set(name, LOADERS[name]().catch((e) => {
    mods.delete(name);
    throw e;
  }));
  return mods.get(name);
}

const warnedKinds = new Set();
const warnOnce = (key, ...args) => {
  if (warnedKinds.has(key)) return;
  warnedKinds.add(key);
  console.warn(...args);
};

// Cache por JSON do spec (devolve clones: geometrias e materiais são compartilhados — não descarte)
const CACHE = new Map();
const CACHE_MAX = 80;
export function clearModelCache() {
  CACHE.clear();
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const TOL = (v) => Math.max(v * 0.03, 0.5); // 3% ou 5 mm

// Confere a caixa: chão em 0, centrado em x/z e medidas dentro de 3%. Corrige posição se preciso.
function verify(group, spec, warnings) {
  const box = kit.measure(group);
  const min = box.min;
  const max = box.max;
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  if (Math.abs(min.y) > 0.002 || Math.abs(cx) > 0.01 || Math.abs(cz) > 0.01) {
    warnings.push(`posição corrigida (base ${(min.y * 100).toFixed(1)} cm, centro ${(cx * 100).toFixed(1)}/${(cz * 100).toFixed(1)} cm)`);
    const wrapper = new THREE.Group();
    while (group.children.length) wrapper.add(group.children[0]);
    wrapper.position.set(-cx, -min.y, -cz);
    group.add(wrapper);
  }
  const fin = kit.finalize(group);
  if (spec) {
    for (const k of ['w', 'h', 'd']) {
      const want = Number(spec[k]);
      if (Math.abs(fin.size[k] - want) > TOL(want)) warnings.push(`${k} = ${fin.size[k]} cm (esperado ${want} cm)`);
    }
  }
  return fin;
}

function runGenerator(fn, spec) {
  kit.resetSeed(spec.seed || spec.kind);
  const g = fn(spec, kit, THREE);
  if (!g || !g.isObject3D) throw new Error('gerador não retornou um THREE.Object3D');
  return g;
}

async function generatorFor(kind) {
  const groupName = GROUP_OF[kind] || 'generic';
  const mod = await loadGroup(groupName);
  const fn = mod[kind] || mod.default?.[kind];
  return typeof fn === 'function' ? fn : null;
}

// Constrói o grupo (síncrono depois que os módulos foram carregados)
async function build(spec) {
  const warnings = [];
  const t0 = now();
  let kind = spec.kind;
  let group;
  let fn = await generatorFor(kind);
  if (!fn) {
    if (kind !== 'generic') warnOnce(`missing:${kind}`, `[3d] sem gerador para "${kind}", usando o genérico`);
    fn = (await loadGroup('generic')).generic;
    if (kind !== 'generic') warnings.push(`tipo "${kind}" sem gerador: genérico`);
  }
  try {
    group = runGenerator(fn, spec);
  } catch (err) {
    warnOnce(`error:${kind}`, `[3d] erro no gerador "${kind}", usando o genérico:`, err);
    warnings.push(`erro no gerador (${err?.message || err}); genérico usado`);
    const gen = (await loadGroup('generic')).generic;
    group = runGenerator(gen, spec);
    kind = 'generic';
  }
  const wrap = new THREE.Group();
  wrap.name = `model:${spec.kind}`;
  wrap.add(group);
  const fin = verify(wrap, spec, warnings);
  wrap.userData.spec = spec;
  const ms = Math.round((now() - t0) * 10) / 10;
  if (warnings.some((w) => /esperado/.test(w))) console.warn(`[3d] medidas fora do spec (${spec.kind} ${spec.seed}):`, warnings.join('; '));
  return { group: wrap, size: fin.size, triangles: fin.triangles, ms, warnings, kind };
}

export async function buildModel(spec) {
  if (!spec || !spec.kind) throw new Error('spec inválido');
  const key = JSON.stringify(spec);
  let entry = CACHE.get(key);
  if (!entry) {
    entry = build(spec);
    CACHE.set(key, entry);
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    entry.catch(() => CACHE.delete(key));
  }
  const r = await entry;
  const group = r.group.clone(true);
  group.userData.spec = spec;
  return { ...r, group, warnings: [...r.warnings] };
}

/* ---------- .glb enviado pela equipe ---------- */
let gltfLoader = null;
export async function loadModelUrl(url, spec = null) {
  const t0 = now();
  if (!gltfLoader) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    gltfLoader = new GLTFLoader();
  }
  const gltf = await gltfLoader.loadAsync(url);
  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new Error('arquivo sem cena');
  const warnings = [];
  const inner = new THREE.Group();
  inner.add(root);
  let box = kit.measure(inner);
  let size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('modelo vazio');
  // gira 90° se largura e profundidade estiverem trocadas em relação ao spec
  if (spec && Math.abs(size.x - kit.cm(spec.d)) + Math.abs(size.z - kit.cm(spec.w)) < Math.abs(size.x - kit.cm(spec.w)) + Math.abs(size.z - kit.cm(spec.d)) - 0.02) {
    root.rotation.y += Math.PI / 2;
    warnings.push('modelo girado 90°');
    box = kit.measure(inner);
    size = box.getSize(new THREE.Vector3());
  }
  // escala uniforme: pelo spec (mediana das razões) ou por unidade provável (cm/mm)
  let s = 1;
  if (spec) {
    const ratios = [kit.cm(spec.w) / size.x, kit.cm(spec.h) / size.y, kit.cm(spec.d) / size.z].sort((a, b) => a - b);
    s = ratios[1];
  } else {
    const big = Math.max(size.x, size.y, size.z);
    if (big > 200) s = 0.001;
    else if (big > 20) s = 0.01;
    else if (big < 0.02) s = 100;
  }
  if (Math.abs(s - 1) > 0.001) {
    root.scale.multiplyScalar(s);
    warnings.push(`escala ${s.toFixed(3)}`);
  }
  box = kit.measure(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group();
  wrap.name = 'model:url';
  wrap.add(inner);
  const fin = kit.finalize(wrap);
  wrap.userData.spec = spec;
  wrap.userData.url = url;
  return { group: wrap, size: fin.size, triangles: fin.triangles, ms: Math.round((now() - t0) * 10) / 10, warnings, kind: spec?.kind || 'url' };
}

// Atalho para a vitrine: usa o .glb do produto quando existe; senão gera pelo spec.
export async function productModel(product, ctx = {}) {
  const spec = inferSpec(product, ctx);
  if (!spec) return null;
  const url = product?.model_url;
  if (url && /^https?:\/\//i.test(url)) {
    try {
      return { ...(await loadModelUrl(url, spec)), spec, source: 'url' };
    } catch (err) {
      console.warn('[3d] falha ao carregar o .glb, gerando automaticamente:', err);
    }
  }
  return { ...(await buildModel(spec)), spec, source: 'procedural' };
}

// Pré-carrega o gerador de um tipo (opcional, para ganhar tempo)
export const preloadKind = (kind) => loadGroup(GROUP_OF[kind] || 'generic').catch(() => null);
