// Galeria 3D (admin/3d.html): miniatura 3D de todos os produtos da loja, visualização interativa,
// simulador de "produto novo" e modo de automação por parâmetros de URL:
//   ?store=<slug>&sku=<SKU>&view=front|three-quarter|side|top|back&size=<px>[&variant=<nome|id|índice>][&compare=1][&procedural=1]
//   ?spec=<JSON do spec>            renderiza um spec cru
//   ?product=<JSON>&category=<nome>[&parent=<nome>]   roda o inferSpec num produto sintético
// Quando pronto: window.__ready = true e window.__report = { kind, spec, size, triangles, ms, warnings }.
import { rpc, mediaSrc, esc } from '/assets/js/lib.js';
import { inferSpec, inferKind, describeSpec, colorHex, kindLabel, slugify } from '/assets/js/3d/infer.js';
import { buildModel, loadModelUrl } from '/assets/js/3d/models/index.js';
import { createStage, VIEWS, VIEW_LABELS } from '/assets/js/3d/stage.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frameTick = () => new Promise((r) => requestAnimationFrame(() => r()));
window.__ready = false;

const STORES = [
  'atual', 'tavares-ponte-nova', 'teixeiras', 'visconde-do-rio-branco', 'mariana', 'ouro-preto', 'ouro-branco',
  'manhuacu', 'manhumirim', 'caratinga', 'timoteo', 'coronel-fabriciano', 'vicosa',
];
const FUTURE_CATS = ['Guarda-roupas', 'Racks e Painéis', 'Estantes', 'Mesas de Jantar', 'Escrivaninhas', 'Micro-ondas', 'Ar-condicionado', 'Banquetas', 'Beliches', 'Berços', 'Armários de Cozinha', 'Puffs', 'Decoração', 'Iluminação', 'Tapetes'];
const MATERIAL_PT = {
  velvet: 'veludo', linen: 'linho', leather: 'couro', boucle: 'bouclé', suede: 'suede', cotton: 'algodão', fabric: 'tecido', wood: 'madeira',
  mdf: 'MDF', lacquer: 'laca', steel: 'inox', metal: 'metal', glass: 'vidro', plastic: 'plástico', marble: 'mármore', cane: 'palhinha',
};
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString('pt-BR');
const dims = (o) => (o ? `${fmt(o.w)} × ${fmt(o.h)} × ${fmt(o.d)} cm` : '—');

// Um único renderizador para a página inteira
const canvas = document.createElement('canvas');
const stage = createStage({ canvas, width: 480, height: 480, preserveDrawingBuffer: true });

// Lojas ativas (com cache) e resolução de slug antigo pela cidade ("ponte-nova" -> loja de Ponte Nova)
let storesPromise = null;
const listStores = () =>
  (storesPromise ||= rpc('list_stores')
    .then((rows) => (Array.isArray(rows) && rows.length ? rows : STORES.map((slug) => ({ slug, city: slug }))))
    .catch(() => STORES.map((slug) => ({ slug, city: slug }))));
async function resolveSlug(slug) {
  const list = await listStores();
  if (!slug) return list[0]?.slug || 'atual';
  if (list.some((s) => s.slug === slug)) return slug;
  const byCity = list.filter((s) => s.city && slugify(s.city) === slug);
  return (byCity.find((s) => /^atual/i.test(s.name || '')) || byCity[0] || {}).slug || slug;
}
async function fetchStorefront(slug) {
  let sf = await rpc('get_storefront', { p_slug: slug });
  if (!sf) {
    const alt = await resolveSlug(slug);
    if (alt !== slug) {
      sf = await rpc('get_storefront', { p_slug: alt });
      slug = alt;
    }
  }
  return { sf, slug };
}

function ctxFor(sf, product, variant) {
  const cats = Object.fromEntries((sf?.categories || []).map((c) => [c.id, c]));
  const category = cats[product.category_id] || null;
  const parentCategory = category?.parent_id ? cats[category.parent_id] || null : null;
  return { category, parentCategory, variant };
}
const photoOf = (p) => (p?.images?.[0]?.url ? mediaSrc(p.images[0].url) : p?.image_url ? mediaSrc(p.image_url) : '');

async function modelFor(product, spec, { procedural = false } = {}) {
  if (product?.model_url && !procedural) {
    try {
      return { ...(await loadModelUrl(product.model_url, spec)), source: 'url' };
    } catch (err) {
      console.warn('[3d] .glb indisponível, gerando automaticamente', err);
    }
  }
  return { ...(await buildModel(spec)), source: 'procedural' };
}

/* ================================================================== */
/* Modo automação                                                      */
/* ================================================================== */
async function runSolo() {
  document.body.classList.add('solo');
  const wrap = $('[data-solo]');
  const size = Number(params.get('size')) || 0;
  const view = VIEWS[params.get('view')] ? params.get('view') : 'three-quarter';
  const compare = params.get('compare') === '1';
  try {
    let spec;
    let product = null;
    let ctx = {};
    if (params.has('spec')) {
      spec = JSON.parse(params.get('spec'));
    } else if (params.has('product')) {
      product = JSON.parse(params.get('product'));
      ctx = { category: params.get('category') || null, parentCategory: params.get('parent') || null, variant: params.get('variant') ?? undefined };
      spec = inferSpec(product, ctx);
    } else {
      const { sf, slug } = await fetchStorefront(params.get('store') || (await resolveSlug('')));
      if (!sf) throw new Error(`Loja ${slug} não encontrada ou indisponível agora`);
      const sku = String(params.get('sku')).toLowerCase();
      product = (sf.products || []).find((p) => String(p.sku).toLowerCase() === sku || p.slug === sku || p.id === sku);
      if (!product) throw new Error(`SKU ${params.get('sku')} não encontrado na loja ${slug}`);
      ctx = ctxFor(sf, product, params.get('variant') ?? undefined);
      spec = inferSpec(product, ctx);
    }
    if (!spec) {
      wrap.innerHTML = '<p class="solo-err">Este produto está marcado como sem 3D.</p>';
      window.__report = { kind: 'none', spec: null, size: null, triangles: 0, ms: 0, warnings: [] };
      window.__ready = true;
      return;
    }
    const res = await modelFor(product, spec, { procedural: params.get('procedural') === '1' });
    const W = size || innerWidth / (compare ? 2 : 1);
    const H = size || innerHeight;
    stage.renderer.setPixelRatio(size ? 1 : Math.min(2, devicePixelRatio || 1));
    stage.resize(W, H);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    wrap.append(canvas);
    if (compare) {
      const img = new Image();
      img.alt = 'Foto de referência';
      img.style.width = `${W}px`;
      img.style.height = `${H}px`;
      const src = photoOf(product);
      if (src) {
        await new Promise((r) => {
          img.onload = img.onerror = r;
          img.src = src;
        });
      }
      wrap.append(img);
    }
    stage.setModel(res.group).frame(view).render();
    document.title = `3D · ${spec.label}`;
    window.__report = { kind: spec.kind, spec, size: res.size, triangles: res.triangles, ms: res.ms, warnings: res.warnings, title: describeSpec(spec), source: res.source };
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<p class="solo-err">${esc(err?.message || String(err))}</p>`;
    window.__report = { error: String(err?.message || err), warnings: [] };
  }
  await frameTick();
  window.__ready = true;
}

/* ================================================================== */
/* Galeria                                                             */
/* ================================================================== */
const G = { sf: null, slug: '', items: [], angle: 'three-quarter', run: 0, viewerOpen: false, current: null };

async function loadStores() {
  const sel = $('[data-store]');
  const list = await listStores();
  const want = await resolveSlug(params.get('store') || '');
  const label = (s) => {
    const name = s.name || s.slug;
    return s.city && !name.toLowerCase().includes(String(s.city).toLowerCase()) ? `${name} - ${s.city}` : name;
  };
  sel.innerHTML = list.map((s) => `<option value="${esc(s.slug)}"${s.slug === want ? ' selected' : ''}>${esc(label(s))}</option>`).join('');
  if (!list.some((s) => s.slug === want)) sel.value = list[0]?.slug || 'atual';
  return sel.value;
}

function cardHTML(it, i) {
  const p = it.product;
  return `<button class="card" type="button" data-i="${i}" data-search="${esc(`${p.name} ${p.sku} ${it.spec ? describeSpec(it.spec) : ''}`.toLowerCase())}">
    <span class="card__img" data-img><span class="spin" aria-hidden="true"></span>${p.model_url ? '<span class="badge badge--glb">.glb</span>' : ''}</span>
    <span class="card__body">
      <span class="card__name">${esc(p.name)}</span>
      <span class="card__kind" data-kind>${it.spec ? esc(describeSpec(it.spec)) : 'Sem 3D'}</span>
      <span class="card__meta" data-meta>${esc(p.sku || '')}</span>
    </span>
  </button>`;
}

async function loadStore(slug) {
  const run = ++G.run;
  G.slug = slug;
  const status = $('[data-status]');
  const grid = $('[data-grid]');
  status.textContent = 'Carregando catálogo…';
  grid.innerHTML = '';
  window.__ready = false;
  let sf;
  try {
    ({ sf } = await fetchStorefront(slug));
  } catch (err) {
    status.textContent = 'Não foi possível carregar o catálogo.';
    grid.innerHTML = `<p class="empty">${esc(err?.message || 'Erro')}</p>`;
    window.__ready = true;
    return;
  }
  if (run !== G.run) return;
  if (!sf) {
    status.textContent = 'Loja indisponível no momento.';
    grid.innerHTML = '<p class="empty">Não encontramos o catálogo desta loja agora. Tente de novo em instantes.</p>';
    window.__gallery = [];
    window.__ready = true;
    return;
  }
  G.sf = sf;
  const products = [...(sf.products || [])].sort((a, b) => String(a.sku || a.name).localeCompare(String(b.sku || b.name)));
  G.items = products.map((product) => {
    const ctx = ctxFor(sf, product);
    const spec = inferSpec(product, ctx);
    return { product, ctx, spec, why: inferKind(product, ctx).source, res: null, thumb: '' };
  });
  const names = [...new Set([...(sf.categories || []).map((c) => c.name), ...FUTURE_CATS])];
  $('[data-cat-list]').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  grid.innerHTML = G.items.length ? G.items.map(cardHTML).join('') : '<p class="empty">Esta loja ainda não tem produtos.</p>';
  applyFilter();
  await renderThumbs(run);
}

async function renderThumbs(run) {
  const status = $('[data-status]');
  const t0 = performance.now();
  let done = 0;
  for (let i = 0; i < G.items.length; i++) {
    if (run !== G.run) return;
    const it = G.items[i];
    const card = $(`[data-i="${i}"]`);
    if (!card) continue;
    const img = $('[data-img]', card);
    const meta = $('[data-meta]', card);
    try {
      if (!it.spec) {
        img.innerHTML = '<span class="none">Sem 3D</span>';
      } else {
        if (!it.res) it.res = await modelFor(it.product, it.spec);
        while (G.viewerOpen) await wait(150);
        if (run !== G.run) return;
        stage.setModel(it.res.group);
        it.thumb = stage.snapshot({ width: 480, height: 480, view: G.angle });
        const warn = it.res.warnings.some((w) => /esperado|erro|sem gerador/.test(w));
        img.innerHTML = `<img alt="Modelo 3D de ${esc(it.product.name)}" src="${it.thumb}">${it.res.source === 'url' ? '<span class="badge badge--glb">.glb</span>' : ''}<span class="badge">${esc(kindLabel(it.spec.kind))}</span>`;
        meta.innerHTML = `<span class="dot${warn ? ' dot--warn' : ''}" aria-hidden="true"></span>${esc(dims(it.res.size))} · ${it.res.triangles.toLocaleString('pt-BR')} tri · ${fmt(it.res.ms)} ms`;
        meta.title = warn ? it.res.warnings.join('\n') : 'Medidas conferem com o cadastro';
      }
    } catch (err) {
      console.error('[3d] miniatura', it.product.sku, err);
      img.innerHTML = '<span class="none">Erro ao gerar</span>';
      it.error = String(err?.message || err);
    }
    done++;
    status.innerHTML = `<strong>${done}</strong> de ${G.items.length} modelos`;
    if (i % 2 === 1) await frameTick();
  }
  const secs = ((performance.now() - t0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const with3d = G.items.filter((x) => x.res).length;
  status.innerHTML = `<strong>${G.items.length}</strong> produtos · <strong>${with3d}</strong> com 3D`;
  $('[data-summary]').textContent = `Gerados em ${secs} s · clique para ver em 3D`;
  window.__gallery = G.items.map((x) => ({
    sku: x.product.sku,
    name: x.product.name,
    kind: x.spec?.kind || 'none',
    title: x.spec ? describeSpec(x.spec) : 'Sem 3D',
    why: x.why,
    spec: x.spec,
    size: x.res?.size || null,
    triangles: x.res?.triangles || 0,
    ms: x.res?.ms || 0,
    warnings: x.res?.warnings || (x.error ? [x.error] : []),
    source: x.res?.source || null,
  }));
  window.__ready = true;
}

function applyFilter() {
  const q = $('[data-q]').value.trim().toLowerCase();
  document.querySelectorAll('.card').forEach((c) => (c.hidden = !!q && !c.dataset.search.includes(q)));
}

/* ================================================================== */
/* Visualização interativa                                             */
/* ================================================================== */
const V = { loop: 0, lastFocus: null, view: 'three-quarter' };
function viewerSize() {
  const host = $('[data-v-stage]');
  stage.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  stage.resize(host.clientWidth, host.clientHeight);
}
function setViewButtons() {
  $('[data-v-views]').innerHTML = Object.keys(VIEWS)
    .map((v) => `<button type="button" data-view="${v}" aria-pressed="${v === V.view}">${VIEW_LABELS[v]}</button>`)
    .join('');
}
async function openViewer(item) {
  G.current = item;
  G.viewerOpen = true;
  V.lastFocus = document.activeElement;
  const el = $('[data-viewer]');
  $('.viewer__hint').textContent = matchMedia('(pointer: coarse)').matches ? 'Arraste para girar · pinça para aproximar' : 'Arraste para girar · role para aproximar';
  el.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  const host = $('[data-v-stage]');
  if (canvas.parentNode !== host) host.prepend(canvas);
  canvas.style.width = '';
  canvas.style.height = '';
  viewerSize();
  const controls = stage.controls(canvas);
  V.view = 'three-quarter';
  setViewButtons();
  await showItem(item);
  $('[data-v-close]').focus({ preventScroll: true });
  cancelAnimationFrame(V.loop);
  const tick = () => {
    if (!G.viewerOpen) return;
    controls.update();
    stage.render();
    V.loop = requestAnimationFrame(tick);
  };
  tick();
}
async function showItem(item, { keepCamera = false } = {}) {
  const p = item.product;
  if (!item.res) item.res = await modelFor(p, item.spec);
  stage.setModel(item.res.group);
  stage.updateControlLimits();
  if (!keepCamera) stage.frame(V.view, { margin: 1.15 });
  $('[data-v-title]').textContent = p.name;
  const cat = item.ctx?.category;
  const catName = typeof cat === 'string' ? cat : cat?.name || '—';
  const reg = p.width_cm || p.height_cm || p.depth_cm ? dims({ w: p.width_cm || 0, h: p.height_cm || 0, d: p.depth_cm || 0 }) : 'não informado';
  $('[data-v-kv]').innerHTML = [
    ['Modelo', describeSpec(item.spec)],
    ['Tipo definido por', item.why || inferKind(p, item.ctx).source],
    ['Categoria', catName],
    ['Material', MATERIAL_PT[item.spec.material] || item.spec.material],
    ['Cadastro', reg],
    ['Medido no 3D', dims(item.res.size)],
    ['Triângulos', item.res.triangles.toLocaleString('pt-BR')],
    ['Gerado em', `${fmt(item.res.ms)} ms`],
    ['Origem', item.res.source === 'url' ? 'arquivo .glb enviado' : 'gerado automaticamente'],
  ]
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join('');
  // fotos de referência
  const imgs = (p.images?.length ? p.images.map((x) => x.url) : p.image_url ? [p.image_url] : []).filter(Boolean);
  const photo = $('[data-v-photo]');
  const thumbs = $('[data-v-thumbs]');
  const showPhoto = (i) => {
    photo.innerHTML = imgs.length ? `<img alt="Foto de referência" src="${esc(mediaSrc(imgs[i]))}">` : '<span class="none">Sem foto (produto simulado)</span>';
    thumbs.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  };
  thumbs.innerHTML = imgs.length > 1 ? imgs.map((u, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img alt="" src="${esc(mediaSrc(u))}"></button>`).join('') : '';
  thumbs.onclick = (e) => {
    const b = e.target.closest('[data-photo]');
    if (b) showPhoto(Number(b.dataset.photo));
  };
  showPhoto(0);
  // cores (variantes)
  const sw = $('[data-v-swatches]');
  const vars = (p.variants || []).filter((v) => v && (v.color || v.name));
  sw.hidden = vars.length < 2;
  const cur = item.ctx?.variant;
  sw.innerHTML = vars
    .map((v, i) => {
      const pressed = cur ? cur === v.id : i === 0;
      const bg = v.color ? (String(v.color).includes('gradient') ? v.color : colorHex(v.color)) : colorHex(v.name);
      return `<button class="sw" type="button" data-variant="${esc(v.id || i)}" aria-pressed="${pressed}" aria-label="${esc(v.name || `Cor ${i + 1}`)}" title="${esc(v.name || '')}" style="background:${esc(bg)}"></button>`;
    })
    .join('');
  const warns = $('[data-v-warns]');
  warns.hidden = !item.res.warnings.length;
  warns.innerHTML = item.res.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  $('[data-v-spec]').textContent = JSON.stringify(item.spec, null, 2);
  const link = $('[data-v-link]');
  link.href = item.synthetic
    ? `/admin/3d.html?spec=${encodeURIComponent(JSON.stringify(item.spec))}&view=three-quarter&size=800`
    : `/admin/3d.html?store=${encodeURIComponent(G.slug)}&sku=${encodeURIComponent(p.sku)}&view=three-quarter&size=800${item.ctx?.variant ? `&variant=${encodeURIComponent(item.ctx.variant)}` : ''}`;
}
function closeViewer() {
  if (!G.viewerOpen) return;
  G.viewerOpen = false;
  cancelAnimationFrame(V.loop);
  $('[data-viewer]').classList.remove('is-open');
  document.body.style.overflow = '';
  V.lastFocus?.focus?.({ preventScroll: true });
}
async function exportGLB() {
  const it = G.current;
  if (!it?.res) return;
  const btn = $('[data-v-glb]');
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const buf = await new GLTFExporter().parseAsync(it.res.group, { binary: true, onlyVisible: true });
    const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${it.product.sku || 'modelo'}.glb`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    console.error(err);
    alert('Não foi possível exportar o modelo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Baixar .glb';
  }
}

/* ================================================================== */
/* Simulador de produto novo                                           */
/* ================================================================== */
const SIM = { timer: 0, run: 0, item: null };
function simProduct() {
  const f = $('[data-sim]');
  const val = (n) => f.elements[n].value.trim();
  const num = (n) => {
    const v = Number(String(val(n)).replace(',', '.'));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const color = val('color');
  const name = val('name') || 'Produto novo';
  const product = {
    id: 'simulado',
    sku: `SIM-${name.length}-${name.slice(0, 12).replace(/\W+/g, '').toUpperCase()}`,
    name,
    width_cm: num('w'),
    height_cm: num('h'),
    depth_cm: num('d'),
    specs: [],
    tags: [],
    images: [],
    variants: color ? [{ id: 'cor', name: color, color: /^#|rgb|gradient/i.test(color) ? color : null, in_stock: true }] : [],
  };
  const catText = val('category');
  const known = (G.sf?.categories || []).find((c) => c.name.toLowerCase() === catText.toLowerCase());
  const cats = Object.fromEntries((G.sf?.categories || []).map((c) => [c.id, c]));
  const ctx = known ? { category: known, parentCategory: known.parent_id ? cats[known.parent_id] : null } : { category: catText || null };
  return { product, ctx };
}
async function updateSim() {
  const run = ++SIM.run;
  const { product, ctx } = simProduct();
  const spec = inferSpec(product, ctx);
  const img = $('[data-sim-img]');
  const desc = $('[data-sim-desc]');
  const why = $('[data-sim-why]');
  if (!spec) {
    img.innerHTML = '<span class="sim__why">Sem 3D (serviço ou item marcado como sem modelo)</span>';
    desc.textContent = 'Sem 3D';
    why.textContent = '';
    SIM.item = null;
    return;
  }
  try {
    const res = await buildModel(spec);
    if (run !== SIM.run) return;
    SIM.item = { product, ctx, spec, res: { ...res, source: 'procedural' }, why: inferKind(product, ctx).source, synthetic: true };
    desc.textContent = describeSpec(spec);
    why.textContent = `Tipo definido por: ${SIM.item.why} · ${MATERIAL_PT[spec.material] || spec.material} · ${fmt(res.ms)} ms`;
    if (G.viewerOpen && G.current?.synthetic) {
      G.current = SIM.item;
      await showItem(SIM.item, { keepCamera: false });
    } else {
      stage.setModel(res.group);
      const url = stage.snapshot({ width: 600, height: 450, view: 'three-quarter', margin: 1.12 });
      img.innerHTML = `<img alt="Modelo 3D simulado" src="${url}">`;
      // o próximo setModel das miniaturas troca o modelo; nada a restaurar
    }
  } catch (err) {
    console.error(err);
    img.innerHTML = '<span class="sim__why">Não foi possível gerar o modelo.</span>';
  }
}
function scheduleSim() {
  clearTimeout(SIM.timer);
  SIM.timer = setTimeout(updateSim, 220);
}

/* ================================================================== */
/* Inicialização                                                       */
/* ================================================================== */
async function runGallery() {
  const slug = await loadStores();
  $('[data-store]').addEventListener('change', (e) => {
    const s = e.target.value;
    const u = new URL(location.href);
    u.searchParams.set('store', s);
    history.replaceState(null, '', u);
    loadStore(s);
  });
  $('[data-q]').addEventListener('input', applyFilter);
  $('[data-angle]').addEventListener('change', (e) => {
    G.angle = e.target.value;
    renderThumbs(++G.run);
  });
  $('[data-grid]').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const it = G.items[Number(card.dataset.i)];
    if (it?.spec) openViewer(it);
  });
  // visualização
  $('[data-v-close]').addEventListener('click', closeViewer);
  $('[data-viewer]').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
  });
  $('[data-v-views]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    V.view = b.dataset.view;
    setViewButtons();
    stage.frame(V.view, { margin: 1.15 });
  });
  $('[data-v-swatches]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-variant]');
    const it = G.current;
    if (!b || !it) return;
    const vid = b.dataset.variant;
    const ctx = { ...it.ctx, variant: vid };
    const spec = inferSpec(it.product, ctx);
    const res = await modelFor(it.product, spec);
    G.current = { ...it, ctx, spec, res };
    await showItem(G.current, { keepCamera: true });
  });
  $('[data-v-glb]').addEventListener('click', exportGLB);
  addEventListener('resize', () => G.viewerOpen && viewerSize());
  // simulador
  const form = $('[data-sim]');
  form.addEventListener('input', (e) => {
    if (e.target.matches('[data-picker]')) form.elements.color.value = e.target.value;
    scheduleSim();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ex]');
    if (!chip) return;
    const ex = JSON.parse(chip.dataset.ex);
    form.elements.name.value = ex.name;
    form.elements.category.value = ex.category;
    form.elements.w.value = ex.w;
    form.elements.h.value = ex.h;
    form.elements.d.value = ex.d;
    form.elements.color.value = ex.color;
    $('[data-picker]').value = colorHex(ex.color, '#cccccc');
    updateSim();
  });
  $('[data-sim-open]').addEventListener('click', () => SIM.item && openViewer(SIM.item));

  await loadStore(slug);
  await updateSim();
}

if (params.has('sku') || params.has('spec') || params.has('product')) runSolo();
else runGallery();
