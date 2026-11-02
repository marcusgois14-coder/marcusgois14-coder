// Produtos: lista (abas de status, busca, filtros, ordenação, paginação no servidor, ações em lote, CSV) e editor.
//
// Rotas:
//   #/products         lista · ?q= ?cat=<uuid>|none ?status=active|draft|archived ?stock=out|low ?missing=dimensions|photo
//                      ?sort=recent|name|price_asc|price_desc|stock|sold ?store=<uuid>[,<uuid>…] (visão da rede) ?page=N
//   #/products/new     novo produto. Numa loja: nasce nela (e pode ganhar cópias em outras). Em "Toda a rede": as lojas são
//                      escolhidas no próprio cadastro (?store=<uuid> já marca uma).
//   #/products/<id>    editor
//
// Mesmo produto em várias lojas (migração 0008): cada loja tem a sua cópia (preço, estoque, status e endereço próprios)
// e as cópias compartilham products.group_id. O editor mostra as cópias, cria cópias novas com duplicate_products
// (sempre DEPOIS de salvar, a partir da linha recém-gravada) e aplica edições nas outras lojas com sync_product_group.
// "Duplicar" no cabeçalho cria outro produto na MESMA loja, sem group_id (o banco gera um grupo novo).
//
// Prévia 3D: mount3D() de /assets/js/3d/viewer.js, carregado com import() só quando o cartão aparece na tela.
// Regras: preço = cheio/cartão; a loja mostra o PIX = preço × (1 − pix_discount_pct/100).
// Fotos: ui.imageUploader (pasta stores/<loja>/products). A remoção de arquivos no storage só acontece
// depois de salvar e quando nenhuma outra linha (cópias em outras lojas, variações) usa a mesma URL.
import { sb, q, rpc, mediaUrl, uploadImage, removeImage, storefrontUrl, friendlyError } from '../api.js';
import {
  html, raw, render, $, $$, icon, toast, toastError, money, num, datetime, relTime, slugify, isoDay, PRODUCT_STATUS,
  productStatusBadge, badge, openModal, confirmDialog, showErrors, withBusy, switchField, loading, empty, errorBlock, table,
  pager, toCSV, downloadFile, parseCSV, imageUploader, injectStyle, debounce, skeleton, tip, pageHeader, storeMark,
  multiSelect, customSelect, segmented, fold,
} from '../ui.js';

const PAGE_SIZE = 30;
const EXPORT_LIMIT = 5000;
const LOW_SCAN_LIMIT = 3000;
const LOW_IDS_LIMIT = 400;
const MAX_PHOTOS = 12;
const MAX_GLB = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_MONEY = 9999999999;

const LIST_COLS =
  'id,store_id,group_id,category_id,name,sku,slug,price,compare_at_price,stock_qty,track_stock,low_stock_threshold,status,is_new,free_shipping,fast_delivery,is_promo,image_url,sold_count,created_at';
const SCAN_COLS = 'id,status,stock_qty,low_stock_threshold,track_stock,width_cm,height_cm,depth_cm,image_url';
const EXPORT_COLS = 'store_id,sku,name,category_id,price,compare_at_price,stock_qty,status,description,brand,warranty,image_url';

const SORTS = {
  recent: { label: 'Mais recentes', col: 'created_at', asc: false },
  name: { label: 'Nome (A–Z)', col: 'name', asc: true },
  price_asc: { label: 'Menor preço', col: 'price', asc: true },
  price_desc: { label: 'Maior preço', col: 'price', asc: false },
  stock: { label: 'Menor estoque', col: 'stock_qty', asc: true },
  sold: { label: 'Mais vendidos', col: 'sold_count', asc: false },
};
const STATUS_KEYS = ['active', 'draft', 'archived'];
const STATUS_DOT = { active: 'ok', draft: 'warn', archived: 'neu' };
const STATUS_WORD = { active: 'ativo', draft: 'rascunho', archived: 'arquivado' };
const STATUS_FROM_WORD = { ativo: 'active', active: 'active', rascunho: 'draft', draft: 'draft', arquivado: 'archived', archived: 'archived' };
const STATUS_CARD = {
  active: ['Ativo', 'Visível e à venda na loja virtual'],
  draft: ['Rascunho', 'Só aqui no painel, enquanto você prepara'],
  archived: ['Arquivado', 'Fora da loja e das buscas'],
};
const TABS = [
  ['', 'Todos', ''],
  ['active', 'Ativos', 'ok'],
  ['draft', 'Rascunhos', 'warn'],
  ['archived', 'Arquivados', 'neu'],
];
const BULK_DONE = { active: ['produto ativado', 'produtos ativados'], draft: ['produto movido para rascunho', 'produtos movidos para rascunho'], archived: ['produto arquivado', 'produtos arquivados'] };

const SEALS = [
  { key: 'is_new', label: 'Lançamento', hint: 'Selo “Novo” no card e destaque em novidades.', icon: 'sparkle', tone: 'info' },
  { key: 'free_shipping', label: 'Frete grátis', hint: 'Entrega sem custo dentro do raio da loja.', icon: 'truck', tone: 'ok' },
  { key: 'fast_delivery', label: 'Pronta entrega', hint: 'Disponível para entrega imediata.', icon: 'bolt', tone: 'warn' },
  { key: 'is_promo', label: 'Promoção', hint: 'Selo de oferta e preço em destaque.', icon: 'tag', tone: 'ora' },
];

// Sincronizar com as outras lojas (sync_product_group): partes, na ordem da tela
const SYNC_PARTS = [
  ['info', 'Informações e 3D'],
  ['images', 'Fotos'],
  ['variants', 'Variações'],
  ['price', 'Preço'],
  ['stock', 'Estoque'],
  ['status', 'Status'],
];
const SYNC_DEFAULT = ['info', 'images', 'variants'];
const SYNC_KEY = 'atual-admin-sync-parts';

// Ícone de cada tipo de modelo 3D (KINDS de /assets/js/3d/infer.js)
const KIND_ICON = {
  sofa: 'sofa', armchair: 'armchair', chair: 'chair', stool: 'chair', pouf: 'armchair', bed: 'bed', bunk_bed: 'bed', crib: 'bed',
  mattress: 'mattress', nightstand: 'dresser', dresser: 'dresser', wardrobe: 'wardrobe', coffee_table: 'table', side_table: 'table',
  dining_table: 'table', desk: 'table', rack: 'rack', shelf: 'rack', kitchen_cabinet: 'wardrobe', tv: 'tv', fridge: 'fridge',
  washer: 'washer', stove: 'stove', microwave: 'microwave', air_conditioner: 'monitor', small_appliance: 'bolt', generic: 'cube', none: 'none',
};

// Paleta das variações (data-swatch). Valores iguais aos que o 3D entende (infer.js).
const PALETTE = [
  ['Neutros', [['Branco', '#f4f4f2'], ['Off white', '#efe9df'], ['Creme', '#f1e6cc'], ['Areia', '#e6dccb'], ['Bege', '#d8cba0'], ['Cinza claro', '#c4c4c4'], ['Cinza', '#8c8c8c'], ['Grafite', '#5c5f61'], ['Preto', '#1d1d1d']]],
  ['Cores', [['Caramelo', '#b5703a'], ['Terracota', '#c9692b'], ['Marrom', '#5c3b28'], ['Café', '#3b2a20'], ['Vinho', '#5e1a24'], ['Vermelho', '#b3262c'], ['Rosa', '#e3a7b4'], ['Mostarda', '#c99a2e'], ['Verde', '#1f5a4a'], ['Verde-musgo', '#5b6236'], ['Azul', '#2f5d8a'], ['Azul-marinho', '#1f2a44']]],
  ['Madeiras e metais', [['Natural', '#c8995e'], ['Carvalho', '#d9bf94'], ['Freijó', '#a0663b'], ['Nogueira', '#7a4a2b'], ['Inox', '#c3c5c7'], ['Dourado', '#c9a24a']]],
];
const PALETTE_FLAT = PALETTE.flatMap(([, list]) => list);

// Lembra a última lista (com filtros) para os links "voltar"
let lastListHash = '#/products';
let lastListStore;
// Depois de salvar, o editor é redesenhado com os dados do banco; guarda a rolagem e o resumo do que foi feito
let keepScroll = null;
let flash = null;
let catCache = null;

/* ---------- Utilitários ---------- */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const storeOf = (ctx, id) => ctx.stores.find((s) => s.id === id) || null;
const shortOf = (ctx, s) => {
  const st = typeof s === 'string' ? storeOf(ctx, s) : s;
  if (!st) return typeof s === 'string' ? ctx.storeName(s) : '';
  return ctx.storeShort ? ctx.storeShort(st) : st.name;
};
const joinNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}` : list[0] || '');
const storeHasPix = (store) => (store?.payment_methods || ['pix']).includes('pix');
// Mesmo cálculo da loja virtual (assets/js/state.js)
const pixPrice = (price, store) => round2(price - round2((price * Number(store?.pix_discount_pct || 0)) / 100));
function installments(total, store) {
  const max = Number(store?.max_installments || 1);
  const min = Number(store?.min_installment_value || 0);
  let n = max;
  while (n > 1 && total / n < min) n -= 1;
  return { n, value: round2(total / n) };
}
// Arredonda para o final ,90 mais próximo (2749,89 → 2749,90 · 100,20 → 99,90)
const roundTo90 = (v) => (v < 1 ? round2(v) : round2(Math.max(0.9, Math.round(v - 0.9) + 0.9)));
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// Aceita "2.499,90", "2499,90", "2499.90" e "R$ 2.499"
function parseNumber(value) {
  let t = String(value ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function parseIntField(value) {
  const n = parseNumber(value);
  if (n === null || Number.isNaN(n)) return n;
  return Number.isInteger(n) ? n : NaN;
}
const moneyInput = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const numInput = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
const csvNum = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const bad = (n) => n !== null && (Number.isNaN(n) || n < 0);
const hexOf = (c) => {
  const v = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split('').map((x) => x + x).join('')}`.toLowerCase();
  return '#cccccc';
};
const productUrl = (store, slug) => `${storefrontUrl(store?.slug || '')}?produto=${encodeURIComponent(slug || '')}`;
// Busca sem diferenciar acentos: "sofa" encontra "Sofá" (regex ~* no nome; SKU por ilike)
const ACCENTS = {
  a: '[aáàâãäÁÀÂÃÄ]', e: '[eéèêëÉÈÊË]', i: '[iíìîïÍÌÎÏ]', o: '[oóòôõöÓÒÔÕÖ]', u: '[uúùûüÚÙÛÜ]', c: '[cçÇ]', n: '[nñÑ]',
};
function searchFilter(text) {
  const words = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\-"' ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  const rx = words.map((w) => w.split('').map((ch) => ACCENTS[ch] || ch).join('')).join('.*');
  return `name.imatch.${rx},sku.ilike.*${words.join('*')}*`;
}
const DIMS_MISSING = 'width_cm.is.null,height_cm.is.null,depth_cm.is.null';

function stockState(p) {
  if (!p.track_stock) return 'untracked';
  if (p.stock_qty <= 0) return 'out';
  if (p.stock_qty <= p.low_stock_threshold) return 'low';
  return 'ok';
}
const noDims = (p) => p.width_cm === null || p.height_cm === null || p.depth_cm === null;

async function pool(items, size, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

const chunks = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

// Remove do storage as fotos que nenhuma linha (produto, cópia ou variação) usa mais.
// Na dúvida (erro na consulta), mantém o arquivo.
async function safeRemoveImages(urls) {
  const list = [...new Set(urls)].filter((u) => typeof u === 'string' && u.includes('/storage/v1/object/public/media/'));
  for (const url of list) {
    try {
      const [a, b] = await Promise.all([
        sb.from('product_images').select('id', { count: 'exact', head: true }).eq('url', url),
        sb.from('product_variants').select('id', { count: 'exact', head: true }).eq('image_url', url),
      ]);
      if (a.error || b.error) continue;
      if ((a.count || 0) + (b.count || 0) === 0) await removeImage(url);
    } catch {
      /* mantém o arquivo */
    }
  }
}
// Modelo .glb: as cópias em outras lojas podem usar o mesmo arquivo
async function safeRemoveModels(urls) {
  const list = [...new Set(urls)].filter((u) => typeof u === 'string' && u.includes('/storage/v1/object/public/media/'));
  for (const url of list) {
    try {
      const r = await sb.from('products').select('id', { count: 'exact', head: true }).eq('model_url', url);
      if (!r.error && !(r.count || 0)) await removeImage(url);
    } catch {
      /* mantém o arquivo */
    }
  }
}

/* ---------- 3D (carregado sob demanda) ---------- */
let inferP = null;
const loadInfer = () => {
  inferP = inferP || import('/assets/js/3d/infer.js').catch((e) => {
    inferP = null;
    throw e;
  });
  return inferP;
};
let viewerP = null;
const loadViewer = () => {
  viewerP = viewerP || import('/assets/js/3d/viewer.js').catch((e) => {
    viewerP = null;
    throw e;
  });
  return viewerP;
};
function ensureViewerCss() {
  if (document.getElementById('v3d-css')) return;
  const l = document.createElement('link');
  l.id = 'v3d-css';
  l.rel = 'stylesheet';
  l.href = '/assets/css/viewer3d.css';
  document.head.append(l);
}

/* ---------- Categorias ---------- */
function buildCats(list) {
  const byId = Object.fromEntries(list.map((c) => [c.id, c]));
  const children = {};
  for (const c of list) if (c.parent_id && byId[c.parent_id]) (children[c.parent_id] = children[c.parent_id] || []).push(c);
  const roots = list.filter((c) => !c.parent_id || !byId[c.parent_id]);
  const descendants = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [id, ...(children[id] || []).flatMap((c) => descendants(c.id, seen))];
  };
  const path = (id) => {
    const names = [];
    const seen = new Set();
    let c = byId[id];
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      names.unshift(c.name);
      c = byId[c.parent_id];
    }
    return names;
  };
  const isLeaf = (id) => !(children[id] && children[id].length);
  return { list, byId, children, roots, descendants, path, label: (id) => path(id).join(' › '), isLeaf };
}

// Categorias com a contagem de produtos da loja escolhida (na rede: todas as cópias)
async function loadCategories(ctx) {
  const key = ctx?.storeId || 'net';
  if (catCache && catCache.key === key && Date.now() - catCache.at < 60000) return catCache.cats;
  let qb = sb.from('categories').select('id,parent_id,name,slug,sort_order,active,model_kind,products(count)').order('sort_order').order('name');
  if (ctx?.storeId) qb = qb.eq('products.store_id', ctx.storeId);
  const list = (await q(qb)).map(({ products, ...c }) => ({ ...c, count: Array.isArray(products) ? products[0]?.count ?? 0 : 0 }));
  catCache = { at: Date.now(), key, cats: buildCats(list) };
  return catCache.cats;
}

const countHint = (n) => (n ? plural(n, 'produto', 'produtos') : 'nenhum produto');

// Filtro da lista: categorias-mãe também filtram as filhas
function categoryFilterOptions(cats, selected) {
  const out = [
    html`<option value="">Todas</option>`,
    html`<option value="none" data-icon="xCircle" data-hint="Produtos ainda sem categoria" ${selected === 'none' ? 'selected' : ''}>Sem categoria</option>`,
  ];
  for (const r of cats.roots) {
    const inactive = r.active ? '' : ' (inativa)';
    if (cats.isLeaf(r.id)) {
      out.push(html`<option value="${r.id}" data-meta="${r.count || ''}" ${r.id === selected ? 'selected' : ''}>${r.name}${inactive}</option>`);
      continue;
    }
    const kids = cats.descendants(r.id).slice(1);
    const total = kids.reduce((s, id) => s + (cats.byId[id].count || 0), r.count || 0);
    out.push(html`<optgroup label="${r.name}" data-count="${total || ''}">
      <option value="${r.id}" data-hint="${r.name} e subcategorias" data-meta="${total || ''}" ${r.id === selected ? 'selected' : ''}>Tudo em ${r.name}</option>
      ${kids.map((id) => {
        const c = cats.byId[id];
        return html`<option value="${id}" data-hint="${cats.label(id)}" data-meta="${c.count || ''}" ${id === selected ? 'selected' : ''}>${c.name}${c.active ? '' : ' (inativa)'}</option>`;
      })}
    </optgroup>`);
  }
  return out;
}

// Editor: só categorias finais, agrupadas pela categoria-mãe
function categoryLeafOptions(cats, selected) {
  const out = [html`<option value="">Sem categoria</option>`];
  const opt = (c, label) =>
    html`<option value="${c.id}" data-hint="${cats.label(c.id)} · ${countHint(c.count)}" ${c.id === selected ? 'selected' : ''}>${label}${c.active ? '' : ' (inativa)'}</option>`;
  for (const r of cats.roots) {
    if (cats.isLeaf(r.id)) {
      out.push(opt(r, r.name));
      continue;
    }
    const all = cats.descendants(r.id).slice(1);
    const ids = all.filter((id) => cats.isLeaf(id) || id === selected);
    if (selected === r.id) ids.unshift(r.id);
    out.push(html`<optgroup label="${r.name}" data-count="${ids.length}">${ids.map((id) => opt(cats.byId[id], id === r.id ? `${r.name} (geral)` : cats.byId[id].name))}</optgroup>`);
  }
  return out;
}

/* =========================================================
   LISTA
   ========================================================= */
function readListFilters(ctx) {
  const qy = ctx.query || {};
  const stores = String(qy.store || '')
    .split(',')
    .filter((id) => ctx.stores.some((s) => s.id === id));
  return {
    q: (qy.q || '').slice(0, 80),
    cat: qy.cat === 'none' || UUID_RE.test(qy.cat || '') ? qy.cat : '',
    status: STATUS_KEYS.includes(qy.status) ? qy.status : '',
    stock: ['out', 'low'].includes(qy.stock) ? qy.stock : '',
    missing: ['dimensions', 'photo'].includes(qy.missing) ? qy.missing : '',
    sort: SORTS[qy.sort] ? qy.sort : 'recent',
    stores: !ctx.storeId ? stores : [],
    page: Math.max(1, parseInt(qy.page, 10) || 1),
  };
}

function listHash(f) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.stores.length) p.set('store', f.stores.join(','));
  if (f.cat) p.set('cat', f.cat);
  if (f.status) p.set('status', f.status);
  if (f.stock) p.set('stock', f.stock);
  if (f.missing) p.set('missing', f.missing);
  if (f.sort !== 'recent') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', f.page);
  const s = p.toString();
  return `#/products${s ? `?${s}` : ''}`;
}

const hasFilters = (f) => !!(f.q || f.cat || f.stock || f.missing || f.stores.length);
const moreCount = (f) => [f.cat, f.stock || f.missing, f.stores.length].filter(Boolean).length;

// parts: quais filtros aplicar (a contagem das abas usa a mesma busca sem status/estoque/cadastro)
function applyFilters(qb, ctx, f, cats, { status = true, stock = true, missing = true } = {}) {
  const ids = ctx.storeId ? [ctx.storeId] : f.stores;
  if (ids.length === 1) qb = qb.eq('store_id', ids[0]);
  else if (ids.length > 1) qb = qb.in('store_id', ids);
  const search = searchFilter(f.q);
  const dims = missing && f.missing === 'dimensions';
  if (search && dims) qb = qb.or(`and(or(${search}),or(${DIMS_MISSING}))`);
  else if (search) qb = qb.or(search);
  else if (dims) qb = qb.or(DIMS_MISSING);
  if (missing && f.missing === 'photo') qb = qb.is('image_url', null);
  if (f.cat === 'none') qb = qb.is('category_id', null);
  else if (f.cat && cats.byId[f.cat]) qb = qb.in('category_id', cats.descendants(f.cat));
  if (status && f.status) qb = qb.eq('status', f.status);
  if (stock && f.stock === 'out') qb = qb.eq('track_stock', true).lte('stock_qty', 0);
  else if (stock && f.stock === 'low') qb = qb.eq('track_stock', true).gt('stock_qty', 0);
  return qb;
}

// "Estoque baixo" compara duas colunas (estoque ≤ alerta), o que a API não filtra:
// busca os candidatos leves e filtra aqui antes da consulta paginada.
async function lowStockIds(ctx, f, cats) {
  const cand = await q(applyFilters(sb.from('products').select('id,stock_qty,low_stock_threshold'), ctx, f, cats).limit(LOW_SCAN_LIMIT));
  const ids = cand.filter((p) => p.stock_qty <= p.low_stock_threshold).map((p) => p.id);
  return { ids: ids.slice(0, LOW_IDS_LIMIT), capped: ids.length > LOW_IDS_LIMIT };
}

// Contagens das abas e dos filtros (uma consulta leve com a busca, a loja e a categoria)
async function scanCounts(ctx, f, cats) {
  const rows = await q(applyFilters(sb.from('products').select(SCAN_COLS), ctx, f, cats, { status: false, stock: false, missing: false }).limit(LOW_SCAN_LIMIT));
  const st = (r) => stockState(r);
  const okStock = (r) => !f.stock || st(r) === f.stock;
  const okMissing = (r) => !f.missing || (f.missing === 'dimensions' ? noDims(r) : !r.image_url);
  const okStatus = (r) => !f.status || r.status === f.status;
  const tabs = { '': 0, active: 0, draft: 0, archived: 0 };
  const opts = { out: 0, low: 0, dimensions: 0, photo: 0 };
  let lowIds = [];
  for (const r of rows) {
    if (okStock(r) && okMissing(r)) {
      tabs[''] += 1;
      tabs[r.status] = (tabs[r.status] || 0) + 1;
    }
    if (okStatus(r) && okMissing(r)) {
      if (st(r) === 'out') opts.out += 1;
      if (st(r) === 'low') opts.low += 1;
    }
    if (okStatus(r) && okStock(r)) {
      if (noDims(r)) opts.dimensions += 1;
      if (!r.image_url) opts.photo += 1;
    }
    if (st(r) === 'low' && okStatus(r) && okMissing(r)) lowIds.push(r.id);
  }
  const capped = lowIds.length > LOW_IDS_LIMIT;
  lowIds = lowIds.slice(0, LOW_IDS_LIMIT);
  return { tabs, opts, lowIds, capped, withoutDims: rows.filter(noDims).length, total: rows.length };
}

async function fetchPage(ctx, f, cats, lowIds) {
  if (f.stock === 'low' && !lowIds.length) return { rows: [], total: 0 };
  let qb = applyFilters(sb.from('products').select(LIST_COLS, { count: 'exact' }), ctx, f, cats);
  if (f.stock === 'low') qb = qb.in('id', lowIds);
  const s = SORTS[f.sort];
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count } = await q(qb.order(s.col, { ascending: s.asc }).order('id').range(from, from + PAGE_SIZE - 1));
  return { rows: data || [], total: count || 0 };
}

// Em quantas lojas (visíveis) cada produto da página existe
async function groupCounts(rows) {
  const groups = [...new Set(rows.map((r) => r.group_id).filter(Boolean))];
  const out = new Map();
  if (!groups.length) return out;
  try {
    const all = await q(sb.from('products').select('group_id,store_id').in('group_id', groups).limit(5000));
    for (const r of all) out.set(r.group_id, (out.get(r.group_id) || 0) + 1);
  } catch {
    /* sem a contagem, a lista segue */
  }
  return out;
}

const thumb = (url, cls = 'thumb') =>
  url
    ? html`<img class="${cls}" src="${mediaUrl(url)}" alt="" loading="lazy">`
    : html`<span class="${cls} pl-thumb--empty" aria-hidden="true">${icon('image', 'icon-sm')}</span>`;

function sealsCell(p) {
  const on = SEALS.filter((s) => p[s.key]);
  if (!on.length) return '';
  return html`<span class="pl-seals">${on.map(
    (s) => html`<span class="pl-seal t-${s.tone}" role="img" aria-label="${s.label}" data-tooltip="${s.label}">${icon(s.icon, 'icon-xs')}</span>`
  )}</span>`;
}

function stockCell(p) {
  const s = stockState(p);
  if (s === 'untracked') return html`<span class="muted small">Não controla</span>`;
  return html`<span class="pl-stock ${s === 'out' ? 'is-out' : s === 'low' ? 'is-low' : ''}"><strong>${num(p.stock_qty)}</strong>${
    s === 'out' ? badge('Esgotado', 'danger') : s === 'low' ? badge('Baixo', 'warning') : html`<span class="pl-stock__u">un.</span>`
  }</span>`;
}

const SORT_OF = { name: { key: 'name', dir: 'asc' }, price_asc: { key: 'price', dir: 'asc' }, price_desc: { key: 'price', dir: 'desc' }, stock: { key: 'stock', dir: 'asc' } };

async function renderList(view, ctx) {
  const network = !ctx.storeId;
  const f = readListFilters(ctx);
  if (lastListStore !== undefined && lastListStore !== ctx.storeId) {
    f.page = 1;
    f.stores = [];
  }
  lastListStore = ctx.storeId;
  lastListHash = listHash(f);
  const here = network ? 'Toda a rede' : shortOf(ctx, ctx.store);
  const canCatalog = network ? ctx.isGlobal : ctx.can('catalog');
  const fromOthers = !network && canCatalog && ctx.stores.some((s) => s.id !== ctx.storeId);

  ctx.setTitle('Produtos', network ? `Toda a rede · o catálogo de cada uma das ${ctx.stores.length} lojas` : `Catálogo, preços e estoque de ${here}`);
  ctx.setActions(html`<div class="products-dd">
      <button class="btn" type="button" data-menu="products-csv-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="products-csv-menu" aria-label="Importar e exportar planilha">
        ${icon('download', 'icon-sm')}<span class="products-hide-sm" aria-hidden="true">Importar e exportar</span>${icon('chevronDown', 'icon-xs')}
      </button>
      <div class="menu" id="products-csv-menu" role="menu" hidden>
        <p class="menu__label">Planilha CSV</p>
        <button type="button" role="menuitem" data-export>${icon('download')} Exportar o filtro atual</button>
        <button type="button" role="menuitem" data-import ${network ? 'disabled' : ''}>${icon('upload')} ${network ? 'Importar (escolha uma loja)' : 'Importar planilha'}</button>
        <button type="button" role="menuitem" data-template>${icon('note')} Baixar modelo</button>
        ${fromOthers ? html`<hr><button type="button" role="menuitem" data-copy-from>${icon('copy')} Copiar de outra loja…</button>` : ''}
      </div>
    </div>
    ${canCatalog ? html`<button class="btn btn--primary" type="button" data-new aria-keyshortcuts="N">${icon('plus')}<span>Novo produto</span></button>` : ''}`);
  const actions = $('[data-actions]');
  $('[data-new]', actions)?.addEventListener('click', () => ctx.navigate('#/products/new'));

  render(
    view,
    html`<div class="products-list">
      <div data-tip></div>
      <section class="card pl-card">
        <div class="tabs pl-tabs" role="tablist" aria-label="Status do produto" data-tabs></div>
        <form class="toolbar pl-tb" data-filters role="search" novalidate>
          <div class="search pl-tb__search">
            ${icon('search', 'icon-sm')}
            <label class="visually-hidden" for="pl-q">Buscar produtos</label>
            <input class="input" id="pl-q" name="q" type="search" value="${f.q}" placeholder="Buscar nome ou SKU" autocomplete="off" enterkeyhint="search" aria-keyshortcuts="/">
            <span class="kbd kbd--sm pl-tb__kbd" aria-hidden="true">/</span>
          </div>
          <button class="btn pl-tb__toggle" type="button" data-more-toggle aria-expanded="false" aria-controls="pl-more">${icon('sliders', 'icon-sm')} Filtros <span class="count-pill" data-more-n hidden></span></button>
          <div class="pl-tb__more" id="pl-more">
            ${network
              ? html`<div class="pl-tb__f pl-tb__f--stores">
                  <label class="visually-hidden" for="pl-store">Lojas</label>
                  <select class="select" id="pl-store" name="store" multiple data-prefix="Lojas" data-placeholder="Todas" data-chips-max="1" data-sheet-title="Lojas" data-search-placeholder="Buscar loja ou cidade…">
                    ${ctx.stores.map((s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name || ''} · ${s.city || ''}" data-keywords="${s.name}" ${f.stores.includes(s.id) ? 'selected' : ''}>${shortOf(ctx, s)}</option>`)}
                  </select>
                </div>`
              : ''}
            <div class="pl-tb__f">
              <label class="visually-hidden" for="pl-cat">Categoria</label>
              <select class="select" id="pl-cat" name="cat" data-prefix="Categoria" data-placeholder="Todas" data-sheet-title="Categoria" data-search-placeholder="Buscar categoria…" data-search="true"></select>
            </div>
            <div class="pl-tb__f">
              <label class="visually-hidden" for="pl-situ">Situação do estoque e do cadastro</label>
              <select class="select" id="pl-situ" name="situ" data-prefix="Situação" data-sheet-title="Situação" data-search="false"></select>
            </div>
          </div>
          <button class="btn btn--ghost btn--sm pl-tb__clear" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
          <span class="toolbar__spacer"></span>
          <div class="pl-tb__f pl-tb__sort">
            <label class="visually-hidden" for="pl-sort">Ordenar por</label>
            <select class="select" id="pl-sort" name="sort" data-prefix="Ordenar" data-sheet-title="Ordenar por" data-search="false">
              ${Object.entries(SORTS).map(([k, s]) => html`<option value="${k}" ${f.sort === k ? 'selected' : ''}>${s.label}</option>`)}
            </select>
          </div>
        </form>
        <div class="pl-results" id="pl-panel" role="tabpanel" data-results>${skeleton('table', { rows: 8, cols: 5 })}</div>
      </section>
      <div data-bulk></div>
      <p class="visually-hidden" aria-live="polite" data-summary></p>
    </div>`
  );

  const form = $('[data-filters]', view);
  const bulkEl = $('[data-bulk]', view);
  const results = $('[data-results]', view);
  const tabsEl = $('[data-tabs]', view);
  const summaryEl = $('[data-summary]', view);
  const catSel = $('#pl-cat', form);
  const situSel = $('#pl-situ', form);

  let cats;
  try {
    cats = await loadCategories(ctx);
  } catch (e) {
    render(results, errorBlock(e, { retry: () => ctx.navigate(lastListHash) }));
    return;
  }
  if (!results.isConnected) return;

  const selected = new Set();
  let rows = [];
  let total = 0;
  let counts = null;
  let groups = new Map();
  let token = 0;

  const situValue = () => f.stock || (f.missing ? `m:${f.missing}` : '');
  const drawSitu = () => {
    const c = counts?.opts || {};
    const m = (n) => (counts ? String(num(n)) : '');
    render(
      situSel,
      html`<option value="">Tudo</option>
      <optgroup label="Estoque">
        <option value="out" data-dot="bad" data-meta="${m(c.out)}" data-hint="Controla estoque e chegou a zero">Esgotados</option>
        <option value="low" data-dot="warn" data-meta="${m(c.low)}" data-hint="No alerta de estoque baixo ou abaixo">Estoque baixo</option>
      </optgroup>
      <optgroup label="Cadastro">
        <option value="m:dimensions" data-icon="ruler" data-meta="${m(c.dimensions)}" data-hint="Sem medidas não há 3D automático">Sem medidas</option>
        <option value="m:photo" data-icon="image" data-meta="${m(c.photo)}" data-hint="Produtos com foto vendem bem mais">Sem foto</option>
      </optgroup>`
    );
    situSel.value = situValue();
  };
  render(catSel, categoryFilterOptions(cats, f.cat));
  drawSitu();

  const drawTabs = () => {
    const hadFocus = tabsEl.contains(document.activeElement);
    render(
      tabsEl,
      TABS.map(([s, label, tone]) => {
        const on = f.status === s;
        const n = counts?.tabs[s];
        return html`<button class="tab" type="button" role="tab" id="pl-tab-${s || 'all'}" aria-selected="${on ? 'true' : 'false'}" aria-controls="pl-panel" tabindex="${on ? '0' : '-1'}" data-status="${s}">
          ${tone ? html`<span class="dot dot--sm t-${tone}" aria-hidden="true"></span>` : ''}${label}<span class="tab__n">${n === undefined ? '…' : num(n)}</span>
        </button>`;
      })
    );
    results.setAttribute('aria-labelledby', `pl-tab-${f.status || 'all'}`);
    if (hadFocus) $('[aria-selected="true"]', tabsEl)?.focus({ preventScroll: true });
  };

  const syncUrl = () => {
    lastListHash = listHash(f);
    history.replaceState(null, '', lastListHash);
    $('[data-clear]', form).hidden = !hasFilters(f);
    const n = moreCount(f);
    const pill = $('[data-more-n]', form);
    pill.hidden = !n;
    pill.textContent = n ? String(n) : '';
  };

  const drawTip = () => {
    const box = $('[data-tip]', view);
    if (!box) return;
    const n = counts?.withoutDims || 0;
    render(
      box,
      n && !f.missing && canCatalog
        ? tip({
            id: `products-dims-${ctx.storeId || 'net'}`,
            text: `${plural(n, 'produto', 'produtos')} ${network ? 'da rede' : `de ${here}`} ${n === 1 ? 'está' : 'estão'} sem medidas. Produtos com medidas no cadastro ganham 3D automático na loja.`,
            action: { label: `Ver ${n === 1 ? 'o produto' : `os ${num(n)}`}`, onClick: () => setSitu('m:dimensions') },
          })
        : ''
    );
  };

  function drawBulk() {
    const n = selected.size;
    if (!n) render(bulkEl, '');
    else {
      render(
        bulkEl,
        html`<div class="bulkbar pl-bulk" role="region" aria-label="Ações em lote">
          <span class="bulkbar__n" aria-hidden="true">${num(n)}</span><span class="pl-bulk__t">${n === 1 ? 'produto selecionado' : 'produtos selecionados'}</span><span class="visually-hidden">: ${plural(n, 'produto selecionado', 'produtos selecionados')}</span>
          <span class="bulkbar__sep" aria-hidden="true"></span>
          <button class="bulkbar__b" type="button" data-bulk-act="active">${icon('checkCircle', 'icon-sm')} Ativar</button>
          <button class="bulkbar__b" type="button" data-bulk-act="draft">${icon('edit', 'icon-sm')} Rascunho</button>
          <button class="bulkbar__b" type="button" data-bulk-act="archived">${icon('archive', 'icon-sm')} Arquivar</button>
          <button class="bulkbar__b" type="button" data-bulk-act="price">${icon('percent', 'icon-sm')} Ajustar preço</button>
          <button class="bulkbar__b" type="button" data-bulk-act="duplicate">${icon('layers', 'icon-sm')} Copiar para lojas</button>
          <button class="bulkbar__b pl-bulk__danger" type="button" data-bulk-act="delete">${icon('trash', 'icon-sm')} Excluir</button>
          <button class="bulkbar__x" type="button" data-bulk-clear aria-label="Limpar seleção (Esc)" title="Limpar seleção (Esc)">${icon('close', 'icon-sm')}</button>
        </div>`
      );
    }
    const all = $('[data-check-all]', results);
    if (all) {
      const onPage = rows.filter((r) => selected.has(r.id)).length;
      all.checked = rows.length > 0 && onPage === rows.length;
      all.indeterminate = onPage > 0 && onPage < rows.length;
    }
    $$('tr[data-row]', results).forEach((tr) => tr.classList.toggle('is-selected', selected.has(tr.dataset.row)));
  }

  function drawResults(capped) {
    const prodCell = (p) => {
      const n = groups.get(p.group_id) || 1;
      const st = storeOf(ctx, p.store_id);
      return html`<div class="pl-prod">${thumb(p.image_url)}<div class="pl-prod__txt">
        <a class="pl-name" href="#/products/${p.id}">${p.name}</a>
        <span class="pl-sub"><span class="mono">${p.sku || 'sem SKU'}</span>${
          network
            ? html`<span class="pl-m-store">· ${shortOf(ctx, st)}</span>${n > 1 ? html`<span class="tag pl-tag" data-tooltip="Este produto existe em ${n} lojas da rede">${icon('layers', 'icon-xs')}${n} lojas</span>` : ''}`
            : n > 1
              ? html`<span class="pl-in">· em ${n} lojas</span>`
              : ''
        }</span>
      </div></div>`;
    };
    const columns = [
      {
        label: html`<input type="checkbox" data-check-all aria-label="Selecionar todos os produtos desta página">`,
        cls: 'check-col',
        render: (p) => html`<input type="checkbox" data-check="${p.id}" aria-label="Selecionar ${p.name}" ${selected.has(p.id) ? 'checked' : ''}>`,
      },
      { label: 'Produto', cls: 'pl-c-prod', sort: 'name', render: prodCell },
      {
        label: 'Categoria',
        cls: 'pl-c-cat',
        render: (p) => {
          if (!p.category_id || !cats.byId[p.category_id]) return html`<span class="faint small">Sem categoria</span>`;
          const parts = cats.path(p.category_id);
          return html`<span class="pl-cat">${parts.length > 1 ? html`<span class="pl-cat__p">${parts.slice(0, -1).join(' › ')}</span>` : ''}<span class="pl-cat__l">${parts[parts.length - 1]}</span></span>`;
        },
      },
      network && {
        label: 'Loja',
        cls: 'pl-c-store',
        render: (p) => {
          const st = storeOf(ctx, p.store_id);
          return html`<span class="pl-store">${st ? storeMark(st, 22) : ''}<span>${shortOf(ctx, st || p.store_id)}</span></span>`;
        },
      },
      {
        label: 'Preço',
        cls: 'num pl-c-price',
        sort: 'price',
        render: (p) => {
          const store = storeOf(ctx, p.store_id);
          return html`<span class="pl-price"><strong>${money(p.price)}</strong>${
            storeHasPix(store) && Number(store?.pix_discount_pct) > 0 ? html`<span class="pl-pix">${money(pixPrice(p.price, store))} no PIX</span>` : ''
          }</span>`;
        },
      },
      {
        label: 'Preço “de”',
        cls: 'num pl-c-cmp',
        render: (p) => (p.compare_at_price ? html`<s class="muted">${money(p.compare_at_price)}</s>` : html`<span class="faint">—</span>`),
      },
      { label: 'Estoque', cls: 'num pl-c-stock', sort: 'stock', render: stockCell },
      { label: 'Status', cls: 'pl-c-status', render: (p) => productStatusBadge(p.status) },
      { label: html`<span class="visually-hidden">Selos</span>`, cls: 'pl-c-seals', render: sealsCell },
    ].filter(Boolean);

    const filtered = hasFilters(f) || f.status;
    let body;
    if (rows.length) {
      body = html`${table({
        columns,
        rows,
        sort: SORT_OF[f.sort] || null,
        caption: `Produtos de ${here}`,
        cls: `pl-table ${network ? 'pl-table--net' : ''}`,
        rowAttrs: (p) => `data-row="${p.id}" class="is-clickable${selected.has(p.id) ? ' is-selected' : ''}"`,
      })}
      ${capped ? html`<p class="pl-note small muted">${icon('info', 'icon-xs')} Mostrando os ${LOW_IDS_LIMIT} primeiros com estoque baixo.</p>` : ''}
      ${pager({ page: f.page, pageSize: PAGE_SIZE, total })}`;
    } else if (filtered) {
      const what = f.q ? `com “${f.q}”` : 'com estes filtros';
      body = empty(
        'Nenhum produto encontrado',
        `Nada ${what} ${network ? (f.stores.length ? 'nas lojas escolhidas' : 'na rede') : `em ${here}`}${f.status ? ` entre os ${TABS.find((t) => t[0] === f.status)[1].toLowerCase()}` : ''}. Confira o nome ou limpe os filtros.`,
        html`<button class="btn" type="button" data-reset-empty>${icon('close', 'icon-sm')} Limpar filtros</button>`,
        { art: 'site:empty-search', size: 'md' }
      );
    } else {
      body = empty(
        'Nenhum produto cadastrado',
        network
          ? 'Cadastre o primeiro produto escolhendo em quais lojas ele entra. Preço e estoque ficam separados por loja.'
          : `Comece do zero ou copie produtos de outra loja da rede. Preço e estoque ficam só em ${here}.`,
        canCatalog
          ? html`${fromOthers ? html`<button class="btn" type="button" data-copy-from>${icon('copy', 'icon-sm')} Copiar de outra loja</button>` : ''}
            <button class="btn btn--primary" type="button" data-new-empty>${icon('plus', 'icon-sm')} Novo produto</button>`
          : '',
        { art: 'empty-box', size: 'lg' }
      );
    }
    render(results, body);
    summaryEl.textContent = rows.length ? `${plural(total, 'produto', 'produtos')} encontrados.` : 'Nenhum produto encontrado.';
    drawBulk();
  }

  async function load() {
    const my = ++token;
    selected.clear();
    drawBulk();
    results.setAttribute('aria-busy', 'true');
    if (!rows.length) render(results, skeleton('table', { rows: 8, cols: 5 }));
    else results.classList.add('is-refreshing');
    try {
      counts = await scanCounts(ctx, f, cats);
      if (my !== token) return;
      drawTabs();
      drawSitu();
      drawTip();
      const res = await fetchPage(ctx, f, cats, counts.lowIds);
      if (my !== token) return;
      if (!res.rows.length && res.total && f.page > 1) {
        f.page = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        syncUrl();
        return load();
      }
      groups = await groupCounts(res.rows);
      if (my !== token) return;
      rows = res.rows;
      total = res.total;
      drawResults(counts.capped && f.stock === 'low');
    } catch (e) {
      if (my !== token) return;
      if (e.raw?.code === 'PGRST103' && f.page > 1) {
        f.page = 1;
        syncUrl();
        return load();
      }
      rows = [];
      render(results, errorBlock(e, { retry: () => load() }));
    } finally {
      if (my === token) {
        results.removeAttribute('aria-busy');
        results.classList.remove('is-refreshing');
      }
    }
  }

  const reload = () => {
    f.page = 1;
    syncUrl();
    load();
  };
  function setSitu(v) {
    f.stock = ['out', 'low'].includes(v) ? v : '';
    f.missing = String(v).startsWith('m:') ? v.slice(2) : '';
    situSel.value = situValue();
    reload();
  }
  const onSearch = debounce(() => {
    f.q = form.q.value.trim().slice(0, 80);
    reload();
  }, 320);
  const onStores = debounce(() => {
    f.stores = Array.from($('#pl-store', form)?.selectedOptions || []).map((o) => o.value);
    reload();
  }, 250);
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') onSearch();
  });
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (!name || name === 'q') return;
    if (name === 'store') return onStores();
    if (name === 'situ') return setSitu(value);
    f[name] = value;
    reload();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    f.q = form.q.value.trim().slice(0, 80);
    reload();
  });
  const resetFilters = () => {
    Object.assign(f, { q: '', cat: '', stock: '', missing: '', stores: [] });
    form.q.value = '';
    catSel.value = '';
    situSel.value = '';
    const ss = $('#pl-store', form);
    if (ss) Array.from(ss.options).forEach((o) => (o.selected = false));
    reload();
  };
  $('[data-clear]', form).addEventListener('click', resetFilters);
  $('[data-more-toggle]', form).addEventListener('click', (e) => {
    const open = !form.classList.contains('is-more');
    form.classList.toggle('is-more', open);
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-status]');
    if (!t || t.dataset.status === f.status) return;
    f.status = t.dataset.status;
    drawTabs();
    reload();
  });
  tabsEl.addEventListener('keydown', (e) => {
    const tabs = $$('[role="tab"]', tabsEl);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n === null) return;
    e.preventDefault();
    tabs[n].focus();
    tabs[n].click();
  });

  view.addEventListener('change', (e) => {
    const all = e.target.closest('[data-check-all]');
    if (all) {
      rows.forEach((r) => (all.checked ? selected.add(r.id) : selected.delete(r.id)));
      $$('[data-check]', results).forEach((c) => (c.checked = all.checked));
      drawBulk();
      return;
    }
    const one = e.target.closest('[data-check]');
    if (one) {
      if (one.checked) selected.add(one.dataset.check);
      else selected.delete(one.dataset.check);
      drawBulk();
    }
  });

  const copyFrom = () => openCopyFrom(ctx, () => load());
  actions && $('[data-copy-from]', actions)?.addEventListener('click', copyFrom);
  $('[data-export]', actions)?.addEventListener('click', () => exportCSV(ctx, f, cats));
  $('[data-template]', actions)?.addEventListener('click', downloadTemplate);
  $('[data-import]', actions)?.addEventListener('click', () => {
    if (!ctx.storeId) return toast('Escolha uma loja no seletor para importar.', 'warning');
    openImport(ctx, cats, () => load());
  });

  view.addEventListener('click', async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      f.page = Number(pg.dataset.page);
      syncUrl();
      load();
      view.scrollIntoView({ block: 'start' });
      return;
    }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      const next = { name: f.sort === 'name' ? 'recent' : 'name', price: f.sort === 'price_asc' ? 'price_desc' : f.sort === 'price_desc' ? 'recent' : 'price_asc', stock: f.sort === 'stock' ? 'recent' : 'stock' }[k];
      if (next) {
        f.sort = next;
        $('#pl-sort', form).value = next;
        reload();
      }
      return;
    }
    if (e.target.closest('[data-reset-empty]')) return resetFilters();
    if (e.target.closest('[data-new-empty]')) return ctx.navigate('#/products/new');
    if (e.target.closest('[data-copy-from]')) return copyFrom();
    if (e.target.closest('[data-bulk-clear]')) return clearSel();
    const act = e.target.closest('[data-bulk-act]');
    if (act) return bulkAction(act.dataset.bulkAct, act);
    const tr = e.target.closest('tr[data-row]');
    if (tr && !e.target.closest('a, button, input, label, select')) ctx.navigate(`#/products/${tr.dataset.row}`);
  });
  function clearSel() {
    selected.clear();
    $$('[data-check]', results).forEach((c) => (c.checked = false));
    drawBulk();
  }
  // "/" busca · Esc limpa a seleção · N novo produto (o shell já cuida do N)
  const onKey = (e) => {
    if (document.querySelector('.modal, .panel, .cmdk, .sheet')) return;
    const editing = e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]');
    if (e.key === '/' && !editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      form.q.focus();
      form.q.select();
    } else if (e.key === 'Escape' && selected.size && !editing) {
      clearSel();
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

  async function bulkAction(kind, btn) {
    const ids = [...selected];
    const items = rows.filter((r) => selected.has(r.id));
    if (!ids.length) return;
    if (STATUS_KEYS.includes(kind)) {
      try {
        const done = await withBusy(btn, () => q(sb.from('products').update({ status: kind, updated_by: ctx.user.id }).in('id', ids).select('id')), '…');
        toast(`${plural(done.length, ...BULK_DONE[kind])}`, 'success');
        load();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (kind === 'delete') {
      const ok = await confirmDialog({
        title: `Excluir ${plural(ids.length, 'produto', 'produtos')}?`,
        message: `Fotos, variações e vínculos com coleções também saem. Pedidos já feitos mantêm nome e preço, e as cópias em outras lojas continuam. Não dá para desfazer.`,
        confirmLabel: `Excluir ${plural(ids.length, 'produto', 'produtos')}`,
        danger: true,
      });
      if (!ok) return;
      try {
        await withBusy(btn, async () => {
          const [imgs, vars] = await Promise.all([
            q(sb.from('product_images').select('url').in('product_id', ids)),
            q(sb.from('product_variants').select('image_url').in('product_id', ids).not('image_url', 'is', null)),
          ]);
          const done = await q(sb.from('products').delete().in('id', ids).select('id'));
          toast(`${plural(done.length, 'produto excluído', 'produtos excluídos')}.`, 'success');
          if (done.length < ids.length) toast(`${ids.length - done.length} não puderam ser excluídos (sem permissão).`, 'warning');
          safeRemoveImages([...imgs.map((i) => i.url), ...vars.map((v) => v.image_url)]);
        }, '…');
        load();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (kind === 'price') return openPriceAdjust(ctx, items, () => load());
    if (kind === 'duplicate') return openDuplicate(ctx, { products: items, onDone: (r) => r.created && load() });
  }

  syncUrl();
  drawTabs();
  load();
}

/* ---------- Ajuste de preço em lote ---------- */
function openPriceAdjust(ctx, items, onDone) {
  openModal({
    title: `Ajustar o preço de ${plural(items.length, 'produto', 'produtos')}`,
    icon: 'percent',
    tone: 'info',
    body: html`<form class="products-modal stack" data-pa novalidate>
      <div class="field">
        <label for="pa-pct">Percentual de ajuste</label>
        <div class="input-group pa-pct"><input class="input" id="pa-pct" name="pct" inputmode="decimal" placeholder="Ex.: 10 ou -15" autocomplete="off" autofocus><span class="input-group__addon">%</span></div>
        <span class="hint">Positivo aumenta, negativo reduz (−10 = 10% mais barato).</span>
      </div>
      <div class="pa-opts">
        <label class="check"><input type="checkbox" name="round" checked> Arredondar para final ,90 (ex.: R$ 2.749,90)</label>
        <label class="check"><input type="checkbox" name="compare"> Aplicar também ao preço “de” (riscado)</label>
      </div>
      <div data-pa-preview></div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-pa-apply>Aplicar novo preço</button>`,
    onMount(el, close) {
      const form = $('[data-pa]', el);
      const prev = $('[data-pa-preview]', el);
      const calc = (v, pct, round) => {
        if (v === null || v === undefined) return null;
        const x = Number(v) * (1 + pct / 100);
        return round ? roundTo90(x) : round2(x);
      };
      const read = () => ({ pct: parseNumber(form.pct.value), round: form.round.checked, compare: form.compare.checked });
      const draw = () => {
        const { pct, round, compare } = read();
        if (pct === null || Number.isNaN(pct)) {
          render(prev, html`<p class="pa-empty muted small">${icon('info', 'icon-xs')} Digite o percentual para ver a prévia dos novos preços.</p>`);
          return;
        }
        const show = items.slice(0, 6);
        render(
          prev,
          html`<div class="table-wrap pa-table"><table class="table table--compact">
            <thead><tr><th>Produto</th><th class="num">Hoje</th><th class="num">Novo</th></tr></thead>
            <tbody>${show.map((p) => {
              const np = calc(p.price, pct, round);
              const nc = compare ? calc(p.compare_at_price, pct, round) : p.compare_at_price;
              return html`<tr><td><span class="pa-name">${p.name}</span>${
                compare && p.compare_at_price ? html`<span class="muted small">“de” ${money(p.compare_at_price)} → ${money(nc)}</span>` : ''
              }</td><td class="num muted">${money(p.price)}</td><td class="num"><strong>${money(np)}</strong></td></tr>`;
            })}</tbody></table></div>
          ${items.length > show.length ? html`<p class="muted small mt-2">e mais ${plural(items.length - show.length, 'produto', 'produtos')}.</p>` : ''}`
        );
      };
      form.addEventListener('input', draw);
      form.addEventListener('change', draw);
      form.addEventListener('submit', (e) => e.preventDefault());
      draw();
      $('[data-pa-apply]', el).addEventListener('click', async (e) => {
        const { pct, round, compare } = read();
        if (pct === null || Number.isNaN(pct)) return showErrors(form, { pct: 'Informe um percentual, ex.: 10 ou -15.' });
        if (pct <= -100) return showErrors(form, { pct: 'Não é possível reduzir 100% ou mais.' });
        if (pct > 1000) return showErrors(form, { pct: 'Percentual alto demais (máximo 1000%).' });
        showErrors(form, {});
        let ok = 0;
        const failed = [];
        await withBusy(e.currentTarget, () =>
          pool(items, 4, async (p) => {
            const row = { price: calc(p.price, pct, round), updated_by: ctx.user.id };
            if (compare && p.compare_at_price !== null) row.compare_at_price = calc(p.compare_at_price, pct, round);
            try {
              await q(sb.from('products').update(row).eq('id', p.id).select('id').single());
              ok += 1;
            } catch (err) {
              failed.push(`${p.name}: ${err.message}`);
            }
          })
        );
        if (ok) toast(`Preço ajustado em ${plural(ok, 'produto', 'produtos')}.`, 'success');
        if (failed.length) toastError(new Error(`Falha em ${failed.length}: ${failed.slice(0, 2).join(' · ')}`));
        close();
        onDone();
      });
    },
  });
}

/* ---------- Duplicar na mesma loja (outro produto, outro grupo) ---------- */
// Cópia dentro da mesma loja (a função duplicate_products só copia para outras lojas e mantém o grupo)
async function duplicateInStore(productId, userId) {
  const p = await q(sb.from('products').select('*').eq('id', productId).single());
  const [imgs, vars] = await Promise.all([
    q(sb.from('product_images').select('url,alt,sort_order').eq('product_id', productId).order('sort_order')),
    q(sb.from('product_variants').select('name,color,image_url,sku,price_override,stock_qty,active,sort_order').eq('product_id', productId).order('sort_order')),
  ]);
  const base = `${p.slug}-copia`.slice(0, 110).replace(/-+$/, '');
  const taken = new Set((await q(sb.from('products').select('slug').eq('store_id', p.store_id).like('slug', `${base}%`))).map((r) => r.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  // group_id fica de fora: a cópia na mesma loja é outro produto (cada loja tem uma cópia por grupo)
  const { id, group_id, created_at, updated_at, sold_count, image_url, image2_url, created_by, updated_by, ...rest } = p;
  const copy = await q(
    sb
      .from('products')
      .insert({
        ...rest,
        name: `${p.name} (cópia)`.slice(0, 200),
        slug,
        sku: p.sku ? `${p.sku}-COPIA` : null, // SKU único na loja (a importação CSV usa o SKU)
        status: 'draft',
        stock_qty: 0,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single()
  );
  if (imgs.length) await q(sb.from('product_images').insert(imgs.map((i) => ({ ...i, product_id: copy.id, store_id: p.store_id }))));
  if (vars.length)
    await q(
      sb.from('product_variants').insert(vars.map((v) => ({ ...v, stock_qty: v.stock_qty === null ? null : 0, product_id: copy.id, store_id: p.store_id })))
    );
  return copy.id;
}

/* ---------- Copiar produtos para outras lojas (lote) ---------- */
// duplicate_products: cópias ligadas ao original (mesmo grupo); lojas que já têm o produto são puladas.
function openDuplicate(ctx, { products, onDone = () => {} }) {
  const single = products.length === 1;
  const groups = [...new Set(products.map((p) => p.group_id).filter(Boolean))];
  const n = products.length;
  let presence = null;
  openModal({
    title: single ? `Copiar “${products[0].name}” para outras lojas` : `Copiar ${plural(n, 'produto', 'produtos')} para outras lojas`,
    size: 'lg',
    body: html`<div class="products-modal stack" data-dup>
      <p class="muted">As cópias ficam ligadas ao original: depois, no cadastro, dá para aplicar uma edição em todas as lojas de uma vez. Cada loja mantém o próprio preço, estoque e endereço.</p>
      <div class="pm-head"><span class="label" id="dup-l">Lojas de destino</span><span class="muted small" data-dup-count></span>
        <span class="grow"></span><button class="btn btn--ghost btn--sm" type="button" data-dup-all>Selecionar todas</button><button class="btn btn--ghost btn--sm" type="button" data-dup-none>Limpar</button></div>
      <div class="pm-stores" role="group" aria-labelledby="dup-l" data-dup-list>${loading('Conferindo em quais lojas já existe…')}</div>
      <div class="pm-opts">
        <div class="field"><label for="dup-status">Criar como</label>
          <select class="select" id="dup-status" data-search="false"><option value="draft" data-dot="warn" data-hint="Só no painel até alguém revisar" selected>Rascunho</option><option value="active" data-dot="ok" data-hint="Já aparece na loja virtual">Ativo</option></select></div>
        <div class="pm-opts__sw">${switchField({ label: 'Copiar o estoque atual', name: 'dup_keep', hint: 'Desligado, as cópias entram com estoque zerado.' })}</div>
      </div>
      <div data-dup-result></div>
    </div>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-dup-ok disabled>${icon('layers', 'icon-sm')} <span data-dup-label>Copiar para as lojas</span></button>`,
    async onMount(el, close) {
      const list = $('[data-dup-list]', el);
      const okBtn = $('[data-dup-ok]', el);
      const paint = () => {
        const boxes = $$('[data-dup-target]', el);
        const on = boxes.filter((b) => b.checked);
        $('[data-dup-count]', el).textContent = on.length ? `${plural(on.length, 'loja escolhida', 'lojas escolhidas')}` : '';
        okBtn.disabled = !on.length;
        $('[data-dup-label]', el).textContent = on.length ? `Copiar para ${plural(on.length, 'loja', 'lojas')}` : 'Copiar para as lojas';
      };
      try {
        const rowsG = groups.length ? await q(sb.from('products').select('group_id,store_id').in('group_id', groups).limit(5000)) : [];
        presence = new Map();
        for (const r of rowsG) {
          if (!presence.has(r.store_id)) presence.set(r.store_id, new Set());
          presence.get(r.store_id).add(r.group_id);
        }
      } catch {
        presence = new Map();
      }
      if (!el.isConnected) return;
      const have = (sid) => products.filter((p) => p.store_id === sid || presence.get(sid)?.has(p.group_id)).length;
      render(
        list,
        ctx.stores.map((s) => {
          const h = have(s.id);
          const can = ctx.can('catalog', s.id);
          const full = h >= n;
          const hint = !can
            ? 'Sem permissão de catálogo'
            : full
              ? single
                ? 'Já tem este produto'
                : 'Já tem todos os escolhidos'
              : h
                ? `Já tem ${h} de ${n} · leva os outros ${n - h}`
                : `${s.brand_name || ''} · ${s.city || ''}`;
          return html`<label class="pm-store ${full || !can ? 'is-locked' : ''}">
            <input type="checkbox" value="${s.id}" data-dup-target ${full || !can ? 'disabled' : ''} ${full ? 'checked' : ''}>
            ${storeMark(s, 28)}<span class="pm-store__txt"><strong>${shortOf(ctx, s)}</strong><span class="muted small">${hint}</span></span>
            ${full ? html`<span class="opt__tag opt__tag--ok">Já cadastrado</span>` : !can ? icon('lock', 'icon-xs faint') : ''}
          </label>`;
        })
      );
      paint();
      el.addEventListener('change', (e) => e.target.matches('[data-dup-target]') && paint());
      $('[data-dup-all]', el).addEventListener('click', () => {
        $$('[data-dup-target]:not(:disabled)', el).forEach((b) => (b.checked = true));
        paint();
      });
      $('[data-dup-none]', el).addEventListener('click', () => {
        $$('[data-dup-target]:not(:disabled)', el).forEach((b) => (b.checked = false));
        paint();
      });
      okBtn.addEventListener('click', async (e) => {
        const targets = $$('[data-dup-target]:checked:not(:disabled)', el).map((b) => b.value);
        if (!targets.length) return toast('Marque pelo menos uma loja de destino.', 'warning');
        const status = $('#dup-status', el).value || 'draft';
        const keep = !!$('input[name="dup_keep"]', el)?.checked;
        let res;
        try {
          res = await withBusy(e.currentTarget, () => rpc('duplicate_products', { p_ids: products.map((p) => p.id), p_targets: targets, p_status: status, p_keep_stock: keep }), 'Copiando…');
        } catch (err) {
          render($('[data-dup-result]', el), html`<div class="alert alert--danger" role="alert">${icon('alert')}<div><strong>Nada foi copiado.</strong> ${err.message}</div></div>`);
          return;
        }
        const created = res?.created || 0;
        const skipped = res?.skipped || 0;
        const storesDone = [...new Set((res?.items || []).map((i) => i.store_id))].map((sid) => shortOf(ctx, sid));
        toast(`${plural(created, 'cópia criada', 'cópias criadas')}${storesDone.length ? ` em ${joinNames(storesDone.slice(0, 3))}${storesDone.length > 3 ? ' e outras' : ''}` : ''}`, 'success');
        render(
          $('[data-dup-result]', el),
          html`<div class="alert alert--success" role="status">${icon('checkCircle')}<div>
            <strong>${plural(created, 'cópia criada', 'cópias criadas')} como ${STATUS_WORD[status]}${keep ? ', com o estoque atual' : ', com estoque zerado'}.</strong>
            ${storesDone.length ? html`<br>Em ${joinNames(storesDone)}.` : ''}
            ${skipped ? html`<br>${plural(skipped, 'cópia pulada', 'cópias puladas')}: a loja já tinha o produto.` : ''}
          </div></div>`
        );
        $$('[data-dup-target], #dup-status, input[name="dup_keep"]', el).forEach((b) => (b.disabled = true));
        $$('[data-dup-all], [data-dup-none]', el).forEach((b) => (b.hidden = true));
        render($('.modal__foot', el), html`<button class="btn btn--primary" type="button" data-close>Concluir</button>`);
        onDone({ created, skipped });
      });
    },
  });
}

/* ---------- Copiar de outra loja (para a loja escolhida) ---------- */
function openCopyFrom(ctx, onDone) {
  const target = ctx.storeId;
  const sources = ctx.stores.filter((s) => s.id !== target);
  if (!target || !sources.length) return;
  let items = [];
  const picked = new Set();
  let term = '';
  openModal({
    title: `Copiar produtos para ${shortOf(ctx, target)}`,
    size: 'lg',
    body: html`<div class="products-modal stack" data-cf>
      <p class="muted">Escolha a loja de origem e os produtos. As cópias ficam ligadas ao original e chegam com o preço de lá: revise antes de ativar.</p>
      <div class="cf-row">
        <div class="field cf-src"><label for="cf-src">Copiar de</label>
          <select class="select" id="cf-src" data-search-placeholder="Buscar loja ou cidade…">
            <option value="">Escolha a loja…</option>
            ${sources.map((s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${s.brand_name || ''} · ${s.city || ''}" data-keywords="${s.name}">${shortOf(ctx, s)}</option>`)}
          </select></div>
        <div class="field cf-q"><label for="cf-q">Buscar</label><div class="search">${icon('search', 'icon-sm')}<input class="input" id="cf-q" type="search" placeholder="Nome ou SKU" autocomplete="off" disabled></div></div>
      </div>
      <div class="cf-list" data-cf-list><p class="muted small cf-hint">${icon('info', 'icon-xs')} Escolha a loja de origem para ver os produtos que ainda não estão em ${shortOf(ctx, target)}.</p></div>
      <div class="pm-opts">
        <div class="field"><label for="cf-status">Criar como</label>
          <select class="select" id="cf-status" data-search="false"><option value="draft" data-dot="warn" selected>Rascunho</option><option value="active" data-dot="ok">Ativo</option></select></div>
        <div class="pm-opts__sw">${switchField({ label: 'Copiar o estoque da origem', name: 'cf_keep', hint: 'Desligado, entram com estoque zerado.' })}</div>
      </div>
    </div>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-cf-ok disabled>${icon('copy', 'icon-sm')} <span data-cf-label>Copiar produtos</span></button>`,
    onMount(el, close) {
      const listEl = $('[data-cf-list]', el);
      const okBtn = $('[data-cf-ok]', el);
      const qIn = $('#cf-q', el);
      const paintBtn = () => {
        okBtn.disabled = !picked.size;
        $('[data-cf-label]', el).textContent = picked.size ? `Copiar ${plural(picked.size, 'produto', 'produtos')}` : 'Copiar produtos';
      };
      const draw = () => {
        const words = fold(term).split(/\s+/).filter(Boolean);
        const shown = items.filter((p) => words.every((w) => fold(`${p.name} ${p.sku || ''}`).includes(w)));
        render(
          listEl,
          items.length
            ? html`<div class="cf-head"><label class="check"><input type="checkbox" data-cf-all ${shown.length && shown.every((p) => picked.has(p.id)) ? 'checked' : ''}> Selecionar ${shown.length === items.length ? 'todos' : 'os mostrados'} (${num(shown.length)})</label></div>
              <div class="cf-items">${shown.map(
                (p) => html`<label class="cf-item"><input type="checkbox" value="${p.id}" data-cf-item ${picked.has(p.id) ? 'checked' : ''}>${thumb(p.image_url)}
                  <span class="cf-item__txt"><strong>${p.name}</strong><span class="muted small"><span class="mono">${p.sku || 'sem SKU'}</span> · ${money(p.price)} · ${PRODUCT_STATUS[p.status]?.label || p.status}</span></span></label>`
              )}${shown.length ? '' : html`<p class="muted small cf-hint">Nada com “${term}”.</p>`}</div>`
            : html`<p class="muted small cf-hint">${icon('checkCircle', 'icon-xs')} ${shortOf(ctx, target)} já tem todos os produtos desta loja.</p>`
        );
        paintBtn();
      };
      $('#cf-src', el).addEventListener('change', async (e) => {
        const src = e.target.value;
        picked.clear();
        items = [];
        paintBtn();
        if (!src) return;
        render(listEl, loading('Carregando produtos…'));
        try {
          const [list, mine] = await Promise.all([
            q(sb.from('products').select('id,group_id,name,sku,price,status,image_url').eq('store_id', src).order('name').limit(2000)),
            q(sb.from('products').select('group_id').eq('store_id', target).limit(5000)),
          ]);
          const have = new Set(mine.map((r) => r.group_id));
          items = list.filter((p) => !have.has(p.group_id));
          qIn.disabled = false;
          draw();
        } catch (err) {
          render(listEl, errorBlock(err));
        }
      });
      qIn.addEventListener('input', () => {
        term = qIn.value.trim();
        draw();
      });
      listEl.addEventListener('change', (e) => {
        if (e.target.matches('[data-cf-all]')) {
          const words = fold(term).split(/\s+/).filter(Boolean);
          items.filter((p) => words.every((w) => fold(`${p.name} ${p.sku || ''}`).includes(w))).forEach((p) => (e.target.checked ? picked.add(p.id) : picked.delete(p.id)));
          draw();
        } else if (e.target.matches('[data-cf-item]')) {
          if (e.target.checked) picked.add(e.target.value);
          else picked.delete(e.target.value);
          paintBtn();
        }
      });
      okBtn.addEventListener('click', async (e) => {
        if (!picked.size) return;
        const status = $('#cf-status', el).value || 'draft';
        const keep = !!$('input[name="cf_keep"]', el)?.checked;
        try {
          const res = await withBusy(e.currentTarget, () => rpc('duplicate_products', { p_ids: [...picked], p_targets: [target], p_status: status, p_keep_stock: keep }), 'Copiando…');
          toast(`${plural(res?.created || 0, 'produto copiado', 'produtos copiados')} para ${shortOf(ctx, target)} como ${STATUS_WORD[status]}.`, 'success');
          close();
          onDone();
        } catch (err) {
          toastError(err);
        }
      });
    },
  });
}

/* ---------- CSV: exportar ---------- */
async function exportCSV(ctx, f, cats) {
  const network = !ctx.storeId;
  toast('Gerando a planilha…');
  try {
    let ids = null;
    if (f.stock === 'low') {
      ({ ids } = await lowStockIds(ctx, f, cats));
      if (!ids.length) return toast('Nenhum produto no filtro atual.', 'warning');
    }
    const all = [];
    const s = SORTS[f.sort];
    for (let from = 0; from < EXPORT_LIMIT; from += 1000) {
      let qb = applyFilters(sb.from('products').select(EXPORT_COLS), ctx, f, cats);
      if (ids) qb = qb.in('id', ids);
      const chunk = await q(qb.order(s.col, { ascending: s.asc }).order('id').range(from, Math.min(from + 999, EXPORT_LIMIT - 1)));
      all.push(...chunk);
      if (chunk.length < 1000) break;
    }
    if (!all.length) return toast('Nenhum produto no filtro atual.', 'warning');
    const columns = [
      network && { label: 'loja', value: (r) => ctx.storeName(r.store_id) },
      { label: 'sku', key: 'sku' },
      { label: 'nome', key: 'name' },
      { label: 'categoria', value: (r) => cats.byId[r.category_id]?.name || '' },
      { label: 'preco', value: (r) => csvNum(r.price) },
      { label: 'preco_de', value: (r) => csvNum(r.compare_at_price) },
      { label: 'estoque', key: 'stock_qty' },
      { label: 'status', value: (r) => STATUS_WORD[r.status] || r.status },
      { label: 'descricao', key: 'description' },
      { label: 'marca', key: 'brand' },
      { label: 'garantia', key: 'warranty' },
      { label: 'imagem', key: 'image_url' },
    ].filter(Boolean);
    downloadFile(`produtos-${ctx.store?.slug || 'rede'}-${isoDay(new Date())}.csv`, toCSV(all, columns));
    toast(`${plural(all.length, 'produto exportado', 'produtos exportados')}${all.length >= EXPORT_LIMIT ? ` (limite de ${num(EXPORT_LIMIT)})` : ''}.`, 'success');
  } catch (e) {
    toastError(e);
  }
}

const IMPORT_COLUMNS = ['sku', 'nome', 'categoria', 'preco', 'preco_de', 'estoque', 'status', 'descricao', 'marca', 'garantia', 'imagem'];

function downloadTemplate() {
  const rows = [
    { sku: 'AT-EX-001', nome: 'Sofá 3 Lugares Exemplo 210 cm', categoria: 'Sofás', preco: '2499,90', preco_de: '3299,90', estoque: '5', status: 'rascunho', descricao: 'Descrição completa do produto.', marca: 'Marca Exemplo', garantia: '12 meses', imagem: '' },
    { sku: 'AT-EX-002', nome: 'Mesa de Centro Exemplo 110 cm', categoria: 'Mesas de Centro', preco: '799,90', preco_de: '', estoque: '3', status: 'ativo', descricao: '', marca: '', garantia: '6 meses', imagem: '' },
  ];
  downloadFile('modelo-importacao-produtos.csv', toCSV(rows, IMPORT_COLUMNS.map((k) => ({ label: k, key: k }))));
}

/* ---------- CSV: importar (somente com uma loja escolhida) ---------- */
const HEADER_ALIASES = {
  sku: 'sku', codigo: 'sku', cod: 'sku',
  nome: 'nome', name: 'nome', produto: 'nome',
  categoria: 'categoria', category: 'categoria',
  preco: 'preco', price: 'preco', preco_por: 'preco',
  preco_de: 'preco_de', compare_at_price: 'preco_de', preco_riscado: 'preco_de', de: 'preco_de',
  estoque: 'estoque', stock: 'estoque', quantidade: 'estoque', qtd: 'estoque',
  status: 'status', situacao: 'status',
  descricao: 'descricao', description: 'descricao',
  marca: 'marca', brand: 'marca',
  garantia: 'garantia', warranty: 'garantia',
  imagem: 'imagem', image: 'imagem', image_url: 'imagem', foto: 'imagem',
  loja: 'loja',
};
const normKey = (h) => slugify(h).replace(/-/g, '_');
const FIELD_LABEL = {
  name: 'nome', category_id: 'categoria', price: 'preço', compare_at_price: 'preço "de"', stock_qty: 'estoque', status: 'status',
  description: 'descrição', brand: 'marca', warranty: 'garantia',
};

async function readText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel no Windows
  }
}

async function fetchAll(make, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const part = await q(make().range(from, from + size - 1));
    out.push(...part);
    if (part.length < size) return out;
  }
}

async function buildPlan(rawRows, storeId, cats) {
  const rows = rawRows.map((r, i) => {
    const src = {};
    for (const [k, v] of Object.entries(r)) {
      const key = HEADER_ALIASES[normKey(k)];
      if (key && !(key in src)) src[key] = String(v ?? '').trim();
    }
    return { line: i + 2, src };
  });
  if (!rows.length) return { fatal: 'O arquivo não tem linhas de produtos.' };
  if (!Object.keys(rawRows[0]).some((k) => HEADER_ALIASES[normKey(k)] === 'sku')) {
    return { fatal: 'O arquivo precisa ter a coluna "sku". Baixe o modelo para ver o formato.' };
  }
  if (rows.length > 2000) return { fatal: 'Importe no máximo 2.000 linhas por vez.' };

  const skus = [...new Set(rows.map((r) => r.src.sku).filter(Boolean))];
  const existing = new Map();
  for (const part of chunks(skus, 80)) {
    const found = await q(
      sb.from('products').select('id,sku,name,slug,category_id,price,compare_at_price,stock_qty,status,description,brand,warranty,image_url').eq('store_id', storeId).in('sku', part)
    );
    for (const p of found) existing.set(p.sku, [...(existing.get(p.sku) || []), p]);
  }
  const slugs = new Set((await fetchAll(() => sb.from('products').select('slug').eq('store_id', storeId).order('slug'))).map((p) => p.slug));

  const catIndex = new Map();
  for (const c of cats.list) {
    catIndex.set(slugify(c.slug), c);
    if (!catIndex.has(slugify(c.name))) catIndex.set(slugify(c.name), c);
  }
  const findCat = (txt) => catIndex.get(slugify(txt)) || catIndex.get(slugify(String(txt).split(/›|>|\//).pop()));

  const seen = new Map();
  for (const r of rows) {
    const s = r.src;
    const errors = [];
    r.sku = s.sku || '';
    r.name = s.nome || '';
    r.errors = errors;
    if (!r.sku) errors.push('Informe o SKU.');
    else if (seen.has(r.sku)) errors.push(`SKU repetido no arquivo (linha ${seen.get(r.sku)}).`);
    else seen.set(r.sku, r.line);
    const matches = existing.get(r.sku) || [];
    if (matches.length > 1) errors.push(`Há ${matches.length} produtos com este SKU na loja; ajuste no painel.`);
    const current = matches.length === 1 ? matches[0] : null;
    const isNew = !current;
    const data = {};

    if (s.nome) {
      if (s.nome.length < 2 || s.nome.length > 200) errors.push('Nome deve ter de 2 a 200 caracteres.');
      else data.name = s.nome;
    } else if (isNew) errors.push('Informe o nome para criar o produto.');

    if (s.preco) {
      const v = parseNumber(s.preco);
      if (v === null || Number.isNaN(v) || v < 0 || v > MAX_MONEY) errors.push(`Preço inválido: "${s.preco}".`);
      else data.price = round2(v);
    } else if (isNew) errors.push('Informe o preço para criar o produto.');

    if (s.preco_de) {
      const v = parseNumber(s.preco_de);
      if (v === null || Number.isNaN(v) || v < 0 || v > MAX_MONEY) errors.push(`Preço "de" inválido: "${s.preco_de}".`);
      else data.compare_at_price = round2(v);
    }
    if (s.estoque) {
      const v = parseIntField(s.estoque);
      if (v === null || Number.isNaN(v)) errors.push(`Estoque deve ser um número inteiro: "${s.estoque}".`);
      else data.stock_qty = v;
    }
    if (s.status) {
      const v = STATUS_FROM_WORD[slugify(s.status)];
      if (!v) errors.push(`Status inválido: "${s.status}" (use ativo, rascunho ou arquivado).`);
      else data.status = v;
    }
    if (s.categoria) {
      const c = findCat(s.categoria);
      if (!c) errors.push(`Categoria não encontrada: "${s.categoria}".`);
      else data.category_id = c.id;
    }
    if (s.descricao) data.description = s.descricao;
    if (s.marca) data.brand = s.marca.slice(0, 120);
    if (s.garantia) data.warranty = s.garantia.slice(0, 120);
    r.image = null;
    if (s.imagem) {
      if (/^https?:\/\/\S+$/i.test(s.imagem) || /^\/\S+$/.test(s.imagem) || /^[a-z0-9][a-z0-9-]*$/i.test(s.imagem)) r.image = s.imagem;
      else errors.push('Imagem deve ser um link (https://…).');
    }

    if (errors.length) {
      r.action = 'error';
      continue;
    }
    if (isNew) {
      let base = slugify(data.name).slice(0, 110).replace(/-+$/, '') || 'produto';
      let slug = base;
      for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
      slugs.add(slug);
      r.action = 'create';
      r.payload = { status: 'draft', stock_qty: 0, ...data, sku: r.sku, slug };
      r.changes = [];
    } else {
      r.existingId = current.id;
      r.name = r.name || current.name;
      r.payload = {};
      for (const [k, v] of Object.entries(data)) {
        const cur = current[k];
        const same = ['price', 'compare_at_price'].includes(k) ? cur !== null && Number(cur) === Number(v) : cur === v;
        if (!same) r.payload[k] = v;
      }
      if (r.image && r.image === current.image_url) r.image = null;
      r.changes = Object.keys(r.payload).map((k) => FIELD_LABEL[k] || k);
      if (r.image) r.changes.push('foto de capa');
      r.action = r.changes.length ? 'update' : 'same';
    }
  }
  const count = (a) => rows.filter((r) => r.action === a).length;
  return { rows, n: { create: count('create'), update: count('update'), same: count('same'), error: count('error') } };
}

async function setCover(productId, storeId, url, alt) {
  const imgs = await q(sb.from('product_images').select('id,url,sort_order').eq('product_id', productId).order('sort_order').order('created_at'));
  const min = imgs.length ? Math.min(...imgs.map((i) => i.sort_order)) : 0;
  const found = imgs.find((i) => i.url === url);
  if (found) {
    if (imgs[0].id !== found.id) await q(sb.from('product_images').update({ sort_order: min - 1 }).eq('id', found.id));
  } else {
    await q(sb.from('product_images').insert({ product_id: productId, store_id: storeId, url, alt, sort_order: imgs.length ? min - 1 : 0 }));
  }
}

async function runPlan(plan, storeId, userId, onProgress) {
  const res = { created: 0, updated: 0, failed: [] };
  const todo = plan.rows.filter((r) => r.action === 'create' || r.action === 'update');
  let done = 0;
  await pool(todo, 4, async (r) => {
    try {
      if (r.action === 'create') {
        const p = await q(sb.from('products').insert({ ...r.payload, store_id: storeId, created_by: userId, updated_by: userId }).select('id').single());
        if (r.image) await q(sb.from('product_images').insert({ product_id: p.id, store_id: storeId, url: r.image, alt: r.payload.name, sort_order: 0 }));
        res.created += 1;
      } else {
        if (Object.keys(r.payload).length) await q(sb.from('products').update({ ...r.payload, updated_by: userId }).eq('id', r.existingId).select('id').single());
        if (r.image) await setCover(r.existingId, storeId, r.image, r.name);
        res.updated += 1;
      }
    } catch (e) {
      res.failed.push({ line: r.line, sku: r.sku, message: e.message });
    }
    done += 1;
    onProgress(done, todo.length);
  });
  return res;
}

function openImport(ctx, cats, onDone) {
  const store = ctx.store;
  let plan = null;
  let fileName = '';
  let finished = false;
  openModal({
    title: `Importar planilha em ${shortOf(ctx, store)}`,
    size: 'lg',
    body: html`<div class="products-modal" data-pi></div>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-pi-run disabled>Importar</button>`,
    onClose: () => {
      if (finished) onDone();
    },
    onMount(el) {
      const body = $('[data-pi]', el);
      const runBtn = () => $('[data-pi-run]', el);

      const drawPick = (message = '') => {
        plan = null;
        render(
          body,
          html`<div class="stack">
            <p>Cadastre ou atualize produtos de <strong>${store.name}</strong> com uma planilha. Cada linha é identificada pelo <strong>SKU</strong>: se já existir na loja, o produto é atualizado; se não, é criado como rascunho.</p>
            <label class="pi-drop" for="pi-file">
              <span class="pi-drop__ico" aria-hidden="true">${icon('upload')}</span>
              <span><strong>Escolher arquivo CSV</strong><span class="muted small">Separado por ponto e vírgula, como o Excel em português · até 5 MB</span></span>
              <input class="visually-hidden" id="pi-file" type="file" accept=".csv,text/csv,text/plain" data-pi-file>
            </label>
            ${message ? html`<div class="alert alert--danger" role="alert">${icon('alert')}<div>${message}</div></div>` : ''}
            <details class="pi-help">
              <summary>Como montar a planilha</summary>
              <div class="pi-cols" aria-label="Colunas do arquivo">${IMPORT_COLUMNS.map((c) => html`<code>${c}</code>`)}</div>
              <ul class="pi-rules small muted">
                <li>Preços no formato 2499,90. Células vazias mantêm o valor atual do produto.</li>
                <li><strong>status</strong>: ativo, rascunho ou arquivado · <strong>categoria</strong>: nome ou endereço (ex.: Sofás).</li>
                <li><strong>imagem</strong> (opcional): link da foto de capa. As outras fotos do produto continuam.</li>
              </ul>
              <button class="btn btn--sm" type="button" data-pi-template>${icon('download', 'icon-sm')} Baixar modelo</button>
            </details>
          </div>`
        );
        runBtn().disabled = true;
        runBtn().textContent = 'Importar';
      };

      const drawPreview = () => {
        const { n } = plan;
        const valid = n.create + n.update;
        const actionBadge = (r) =>
          r.action === 'create'
            ? badge('Criar', 'success')
            : r.action === 'update'
              ? badge('Atualizar', 'info')
              : r.action === 'same'
                ? badge('Sem mudanças')
                : badge('Erro', 'danger');
        const shown = plan.rows.slice(0, 300);
        render(
          body,
          html`<div class="stack" style="--gap:12px">
            <div class="row pi-sum" style="--gap:6px">
              ${badge(plural(n.create, 'novo', 'novos'), 'success')}
              ${badge(plural(n.update, 'atualização', 'atualizações'), 'info')}
              ${n.same ? badge(plural(n.same, 'sem mudanças', 'sem mudanças')) : ''}
              ${n.error ? badge(plural(n.error, 'com erro', 'com erro'), 'danger') : ''}
            </div>
            <p class="small muted">${fileName} · ${plural(plan.rows.length, 'linha', 'linhas')}. ${n.error ? 'Linhas com erro não serão importadas.' : ''}</p>
            <div class="table-wrap pi-table"><table class="table table--compact">
              <thead><tr><th>Linha</th><th>Ação</th><th>SKU</th><th>Nome</th><th class="num">Preço</th><th class="num">Estoque</th><th>Detalhes</th></tr></thead>
              <tbody>${shown.map(
                (r) => html`<tr>
                  <td class="muted">${r.line}</td>
                  <td>${actionBadge(r)}</td>
                  <td class="mono small">${r.sku || '—'}</td>
                  <td><span class="pi-name">${r.name || '—'}</span></td>
                  <td class="num">${r.payload?.price !== undefined ? money(r.payload.price) : '—'}</td>
                  <td class="num">${r.payload?.stock_qty !== undefined ? num(r.payload.stock_qty) : '—'}</td>
                  <td class="small">${
                    r.action === 'error'
                      ? html`<span class="pi-error">${r.errors.join(' ')}</span>`
                      : r.action === 'create'
                        ? html`<span class="muted">Endereço: ${r.payload.slug}${r.image ? ' · com foto' : ''}</span>`
                        : r.action === 'update'
                          ? html`<span class="muted">Muda: ${r.changes.join(', ')}</span>`
                          : html`<span class="faint">Igual ao cadastro</span>`
                  }</td>
                </tr>`
              )}</tbody>
            </table></div>
            ${plan.rows.length > shown.length ? html`<p class="small muted">Mostrando ${shown.length} de ${plan.rows.length} linhas.</p>` : ''}
            <div><button class="btn btn--ghost btn--sm" type="button" data-pi-again>${icon('refresh', 'icon-sm')} Escolher outro arquivo</button></div>
          </div>`
        );
        runBtn().disabled = !valid;
        runBtn().textContent = valid ? `Importar ${plural(valid, 'produto', 'produtos')}` : 'Nada para importar';
      };

      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-pi-template]')) downloadTemplate();
        if (e.target.closest('[data-pi-again]')) drawPick();
      });
      body.addEventListener('change', async (e) => {
        const input = e.target.closest('[data-pi-file]');
        if (!input || !input.files[0]) return;
        const file = input.files[0];
        fileName = file.name;
        if (file.size > 5 * 1024 * 1024) return drawPick('Arquivo grande demais (máximo 5 MB).');
        render(body, loading('Lendo e conferindo o arquivo…'));
        try {
          const rawRows = parseCSV(await readText(file));
          const result = await buildPlan(rawRows, store.id, cats);
          if (result.fatal) return drawPick(result.fatal);
          plan = result;
          drawPreview();
        } catch (err) {
          drawPick(err.message || 'Não foi possível ler o arquivo.');
        }
      });

      $('[data-pi-run]', el).addEventListener('click', async () => {
        if (!plan) return;
        const total = plan.n.create + plan.n.update;
        const foot = $('.modal__foot', el);
        foot.hidden = true;
        const progress = (done, all) =>
          render(
            body,
            html`<div class="stack" aria-live="polite"><p><strong>Importando ${done} de ${all}…</strong> Não feche esta janela.</p>
            <div class="meter meter--progress"><span style="width:${Math.round((done / Math.max(1, all)) * 100)}%"></span></div></div>`
          );
        progress(0, total);
        const res = await runPlan(plan, store.id, ctx.user.id, progress);
        finished = true;
        render(
          body,
          html`<div class="stack">
            <div class="alert ${res.failed.length ? 'alert--warning' : 'alert--success'}">${icon(res.failed.length ? 'alert' : 'checkCircle')}<div>
              <strong>Importação concluída.</strong><br>
              ${plural(res.created, 'produto criado', 'produtos criados')} · ${plural(res.updated, 'produto atualizado', 'produtos atualizados')}${
                plan.n.error ? ` · ${plural(plan.n.error, 'linha ignorada', 'linhas ignoradas')} por erro` : ''
              }${res.failed.length ? ` · ${plural(res.failed.length, 'falha', 'falhas')}` : ''}.
              ${res.created ? html`<br><span class="small">Revise fotos e detalhes dos produtos novos antes de ativá-los.</span>` : ''}
            </div></div>
            ${res.failed.length
              ? html`<div class="table-wrap pi-table"><table class="table table--compact"><thead><tr><th>Linha</th><th>SKU</th><th>Erro</th></tr></thead>
                <tbody>${res.failed.map((f) => html`<tr><td>${f.line}</td><td class="mono small">${f.sku}</td><td class="pi-error small">${f.message}</td></tr>`)}</tbody></table></div>`
              : ''}
          </div>`
        );
        render(foot, html`<button class="btn btn--primary" type="button" data-close>Concluir</button>`);
        foot.hidden = false;
        toast(`Importação: ${res.created} criados, ${res.updated} atualizados.`, res.failed.length ? 'warning' : 'success');
      });

      drawPick();
    },
  });
}

/* =========================================================
   EDITOR
   ========================================================= */
function defaults(storeId) {
  return {
    store_id: storeId, name: '', slug: '', sku: '', brand: '', category_id: null, short_description: '', description: '',
    price: null, compare_at_price: null, cost_price: null, track_stock: true, stock_qty: 0, low_stock_threshold: 2, status: 'draft',
    is_new: false, free_shipping: false, fast_delivery: false, is_promo: false, width_cm: null, height_cm: null, depth_cm: null,
    weight_kg: null, warranty: '', seo_title: '', seo_description: '', specs: [], tags: [], model3d: {}, model_url: null,
  };
}

const moneyField = (label, name, value, { cls = 'col-4', hint = '', required = false, opt = false } = {}) =>
  html`<div class="field ${cls}">
    <label for="pe-${name}">${label}${opt ? html` <span class="opt-tag">opcional</span>` : ''}</label>
    <div class="input-group"><span class="input-group__addon">R$</span><input class="input pe-num" id="pe-${name}" name="${name}" value="${moneyInput(value)}" inputmode="decimal" autocomplete="off" placeholder="0,00" ${required ? 'required' : ''}></div>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;

const counter = (name, max) => html`<span class="opt-tag pe-count" data-counter="${name}" data-max="${max}" aria-live="polite"></span>`;

// Opções de cor da variação (paleta + cor própria do cadastro, se houver)
function colorOptions(value) {
  const v = String(value || '').trim();
  const inPalette = PALETTE_FLAT.some(([, hex]) => hex === v.toLowerCase());
  return html`<option value="" ${!v ? 'selected' : ''}>Sem cor</option>
    ${v && !inPalette ? html`<option value="${v}" data-swatch="${v}" data-hint="${v}" selected>Cor própria</option>` : ''}
    ${PALETTE.map(
      ([g, list]) => html`<optgroup label="${g}">${list.map(
        ([label, hex]) => html`<option value="${hex}" data-swatch="${hex}" data-meta="${hex}" ${hex === v.toLowerCase() ? 'selected' : ''}>${label}</option>`
      )}</optgroup>`
    )}
    <option value="__pick" data-icon="palette" data-hint="Escolha qualquer cor no seletor">Outra cor…</option>`;
}

function renderOtherStore(view, ctx, product) {
  const canSwitch = ctx.stores.some((s) => s.id === product.store_id);
  ctx.setTitle(product.name, shortOf(ctx, product.store_id), { back: lastListHash });
  render(
    view,
    html`<div class="card">${empty(
      `Este produto é de ${shortOf(ctx, product.store_id)}`,
      `Você está em ${shortOf(ctx, ctx.store)}. Cada loja tem a própria cópia do produto, com preço e estoque próprios.`,
      html`<a class="btn" href="#/products">${icon('chevronLeft', 'icon-sm')} Produtos de ${shortOf(ctx, ctx.store)}</a>
        ${canSwitch ? html`<button class="btn btn--dark" type="button" data-switch>${icon('store', 'icon-sm')} Abrir em ${shortOf(ctx, product.store_id)}</button>` : ''}`,
      { art: 'site:empty-search', size: 'md' }
    )}</div>`
  );
  $('[data-switch]', view)?.addEventListener('click', () => ctx.setStore(product.store_id, `#/products/${product.id}`));
}

async function renderEditor(view, ctx, id) {
  const isNew = !id;
  const notFound = () => {
    ctx.setTitle('Produto não encontrado', '', { back: lastListHash });
    render(
      view,
      html`<div class="card">${empty(
        'Produto não encontrado',
        'Ele pode ter sido excluído ou pertencer a uma loja à qual você não tem acesso.',
        html`<a class="btn" href="${lastListHash}">${icon('chevronLeft', 'icon-sm')} Voltar para produtos</a>`,
        { art: 'site:empty-search' }
      )}</div>`
    );
  };
  if (!isNew && !UUID_RE.test(id)) return notFound();
  render(view, html`<div class="pe-loading">${skeleton('page', { rows: 4 })}</div>`);

  const allowed = ctx.stores.filter((s) => ctx.can('catalog', s.id));
  const networkNew = isNew && !ctx.storeId;
  let product = null;
  let storeId;
  let copies = [];
  let cats;
  let infer;
  let images;
  let variants;
  let collections = [];
  let links;
  try {
    if (!isNew) {
      product = await q(sb.from('products').select('*').eq('id', id).maybeSingle());
      if (!product) return notFound();
      storeId = product.store_id;
      if (ctx.storeId && ctx.storeId !== storeId) return renderOtherStore(view, ctx, product);
    } else if (networkNew) {
      if (!allowed.length) {
        ctx.setTitle('Novo produto', 'Toda a rede');
        render(view, html`<div class="card">${empty('Sem permissão de catálogo', 'Você não pode cadastrar produtos em nenhuma loja.', '', { art: 'no-access' })}</div>`);
        return;
      }
      storeId = allowed.some((s) => s.id === ctx.query.store) ? ctx.query.store : null;
    } else {
      storeId = ctx.storeId;
    }
    [cats, infer, images, variants, links, copies] = await Promise.all([
      loadCategories(ctx),
      loadInfer().catch(() => null),
      isNew ? [] : q(sb.from('product_images').select('id,url,sort_order').eq('product_id', id).order('sort_order').order('created_at')),
      isNew ? [] : q(sb.from('product_variants').select('*').eq('product_id', id).order('sort_order').order('created_at')),
      isNew ? [] : q(sb.from('collection_items').select('collection_id').eq('product_id', id)),
      isNew || !product.group_id ? [] : q(sb.from('products').select('id,store_id,status,price,stock_qty,track_stock,updated_at').eq('group_id', product.group_id)).catch(() => []),
    ]);
    if (storeId) collections = await q(sb.from('collections').select('id,key,title,active,sort_order').eq('store_id', storeId).order('sort_order').order('title'));
  } catch (e) {
    ctx.setTitle(isNew ? 'Novo produto' : 'Produto', '', { back: lastListHash });
    render(view, errorBlock(e, { retry: () => ctx.navigate(location.hash) }));
    return;
  }
  if (!view.isConnected) return;

  let store = storeOf(ctx, storeId) || (storeId ? { id: storeId, name: ctx.storeName(storeId) } : null);
  const canEdit = networkNew ? allowed.length > 0 : ctx.can('catalog', storeId);
  const p = product ? { ...product } : defaults(storeId);
  let pid = product?.id || null;
  const storeOrder = (sid) => ctx.stores.findIndex((s) => s.id === sid);
  copies.sort((a, b) => (a.id === pid ? -1 : b.id === pid ? 1 : storeOrder(a.store_id) - storeOrder(b.store_id)));
  const existingStores = new Set(copies.map((c) => c.store_id));
  if (!isNew) existingStores.add(storeId);
  const editableOthers = () => copies.filter((c) => c.id !== pid && ctx.can('catalog', c.store_id));
  const showLojas = canEdit && (ctx.isGlobal || allowed.length >= 2);
  const showCopies = !isNew && copies.length > 1;
  const kinds = infer?.KINDS || [];
  const kindLabel = (k) => (infer ? infer.kindLabel(k) : k);

  // estado
  let seq = 0;
  const nextKey = () => `k${(seq += 1)}`;
  const st = {
    variants: variants.map((v) => ({
      key: nextKey(), id: v.id, name: v.name || '', color: v.color || '', image_url: v.image_url || '', sku: v.sku || '',
      price: moneyInput(v.price_override), stock: v.stock_qty === null ? '' : String(v.stock_qty), active: v.active,
    })),
    specs: (Array.isArray(p.specs) ? p.specs : []).map((s) => ({ key: nextKey(), label: String(s?.label ?? ''), value: String(s?.value ?? '') })),
    collections: new Set(links.map((l) => l.collection_id)),
    // lojas: novas escolhidas (existentes ficam travadas)
    picked: new Set(networkNew ? (storeId ? [storeId] : []) : []),
    createAs: 'draft',
    keepStock: false,
    modelUrl: p.model_url || null,
    kind: (p.model3d && typeof p.model3d === 'object' && p.model3d.kind) || '',
    applyOn: false,
    syncParts: (() => {
      try {
        const v = JSON.parse(lsGet(SYNC_KEY) || 'null');
        if (Array.isArray(v) && v.every((x) => SYNC_PARTS.some(([k]) => k === x))) return new Set(v);
      } catch {
        /* padrão */
      }
      return new Set(SYNC_DEFAULT);
    })(),
    syncTargets: new Set(),
  };
  st.syncTargets = new Set(editableOthers().map((c) => c.store_id));
  const orig = {
    images: images.map((i) => i.url),
    variants: Object.fromEntries(variants.map((v) => [v.id, v])),
    variantImages: variants.map((v) => v.image_url).filter(Boolean),
    collections: new Set(st.collections),
    modelUrl: p.model_url || null,
  };
  const sessionUploads = new Set();
  const sessionModels = new Set();
  let slugTouched = !isNew && !!p.slug;
  let leaving = false;
  let saving = false;
  let savedParts = null;
  let savedFields = {};
  let activeVariant = null;
  const here = () => (store ? shortOf(ctx, store) : 'a loja escolhida');
  const viewHref = () => productUrl(store, $('[name="slug"]', view)?.value.trim() || p.slug);
  const catOf = (cid) => (cid && cats.byId[cid]) || null;

  const SECTIONS = [
    ['info', 'Informações', 'pe-sec-info'],
    ['photos', 'Fotos', 'pe-sec-photos'],
    ['price', 'Preço e estoque', 'pe-sec-price'],
    ['variants', 'Variações', 'pe-sec-variants'],
    ['dims', 'Medidas', 'pe-sec-dims'],
    ['model', 'Modelo 3D', 'pe-sec-3d'],
    showLojas && ['lojas', 'Lojas', 'pe-sec-lojas'],
    ['seo', 'SEO', 'pe-sec-seo'],
  ].filter(Boolean);
  const EXTRA_LABEL = { status: 'Status', seals: 'Selos', collections: 'Coleções' };

  /* ----- Cabeçalho ----- */
  const crumbsFor = (cid) => {
    const list = [['Produtos', lastListHash]];
    if (isNew) return [...list, ['Novo produto']];
    const path = cid && cats.byId[cid] ? cats.path(cid) : [];
    if (path.length > 1) list.push([path[path.length - 2], `#/products?cat=${cats.byId[cid].parent_id}`]);
    if (path.length) list.push([path[path.length - 1], `#/products?cat=${cid}`]);
    return list;
  };
  const inStoresTag = () => {
    const n = existingStores.size;
    if (isNew) return '';
    if (ctx.isGlobal) return html`<span class="tag" data-tooltip="Cópias deste produto na rede">${icon('layers', 'icon-xs')}Em ${n} de ${ctx.stores.length} lojas</span>`;
    return n > 1 ? html`<span class="tag">${icon('layers', 'icon-xs')}Em ${n} lojas</span>` : '';
  };
  const headMeta = () =>
    html`<span data-head-status>${productStatusBadge(p.status)}</span>${inStoresTag()}${
      store ? html`<span class="pe-meta__store">${storeMark(store, 20)}${here()}</span>` : html`<span class="muted small">Toda a rede · escolha as lojas</span>`
    }<span class="muted small pe-meta__sku" data-head-sku>${p.sku ? html`SKU <span class="mono">${p.sku}</span>` : ''}</span>${
      !isNew ? html`<span class="muted small">Atualizado ${relTime(p.updated_at)}</span>` : ''
    }`;
  const headActions = () =>
    html`${!isNew ? html`<a class="btn" href="${productUrl(store, p.slug)}" target="_blank" rel="noopener" data-view-store aria-label="Ver na loja (abre em nova aba)">${icon('external', 'icon-sm')}<span class="pe-hide-sm" aria-hidden="true">Ver na loja</span></a>` : ''}
    ${!isNew && canEdit ? html`<button class="btn" type="button" data-duplicate data-tooltip="Cria um produto novo nesta loja" aria-label="Duplicar nesta loja">${icon('copy', 'icon-sm')}<span class="pe-hide-sm" aria-hidden="true">Duplicar</span></button>` : ''}
    <div class="products-dd">
      <button class="btn btn--icon" type="button" data-menu="pe-more-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">${icon('more')}</button>
      <div class="menu" id="pe-more-menu" role="menu" hidden>
        <a role="menuitem" href="/admin/3d.html" target="_blank" rel="noopener">${icon('cube')} Laboratório 3D</a>
        ${!isNew ? html`<a role="menuitem" href="${productUrl(store, p.slug)}" target="_blank" rel="noopener">${icon('external')} Ver na loja virtual</a>` : ''}
        ${!isNew && canEdit ? html`<hr><button type="button" role="menuitem" class="is-danger" data-delete>${icon('trash')} Excluir produto</button>` : ''}
      </div>
    </div>`;

  ctx.setTitle(isNew ? 'Novo produto' : 'Editar produto', store ? here() : 'Toda a rede', { visible: false, back: lastListHash });
  if (!isNew) document.title = `${p.name} · Painel Atual Móveis`;

  /* ----- Cartões ----- */
  const statusCard = html`<section class="card pe-card pe-o-status" aria-labelledby="pe-h-status">
    <div class="card__head"><h2 class="card__title" id="pe-h-status">Status</h2></div>
    <div class="card__body">
      <div class="pe-status" role="radiogroup" aria-labelledby="pe-h-status">${STATUS_KEYS.map(
        (k) => html`<label class="pe-rcard"><input type="radio" name="status" value="${k}" ${p.status === k ? 'checked' : ''}>
          <span class="pe-rcard__txt"><strong>${STATUS_CARD[k][0]}</strong><span>${STATUS_CARD[k][1]}</span></span><span class="dot t-${STATUS_DOT[k]}" aria-hidden="true"></span></label>`
      )}</div>
      <p class="pe-note" data-status-note hidden></p>
    </div>
  </section>`;

  const lojasCard = showLojas
    ? html`<section class="card pe-card pe-o-lojas ${isNew ? 'pe-lojas--new' : ''}" id="pe-sec-lojas" aria-labelledby="pe-h-lojas">
        <div class="card__head"><div><h2 class="card__title" id="pe-h-lojas">${icon('houses', 'icon-sm')}Lojas</h2><p class="card__sub">${
          isNew ? 'Escolha onde o produto entra. Cada loja tem preço e estoque próprios.' : 'Cada loja tem preço, estoque e endereço próprios'
        }</p></div></div>
        <div class="card__body">
          <div class="field pe-lojas" data-lojas></div>
          <p class="pe-lojas__sum" id="pe-lojas-sum" data-lojas-sum aria-live="polite"></p>
          <div class="pe-lojas__opts" data-lojas-opts hidden>
            <div class="field"><label for="pe-create-as">Criar as cópias como</label>
              <select class="select" id="pe-create-as" data-skip data-search="false"><option value="draft" data-dot="warn" data-hint="Só no painel até alguém revisar" selected>Rascunho</option><option value="active" data-dot="ok" data-hint="Já aparece na loja virtual">Ativo</option></select></div>
            <label class="switch"><input type="checkbox" data-skip data-keep-stock><span class="switch__track"></span><span class="switch__txt"><strong>Copiar o estoque atual</strong><br><span class="muted small">Desligado, as cópias entram com estoque zerado.</span></span></label>
          </div>
        </div>
      </section>`
    : '';

  const p3dCard = html`<section class="card pe-card pe-o-3d pe-3d" id="pe-sec-3d" aria-labelledby="pe-h-3d">
    <div class="card__head"><h2 class="card__title" id="pe-h-3d">${icon('cube', 'icon-sm')}Prévia 3D</h2>
      <div class="pe-3d__acts">
        <a class="btn btn--ghost btn--sm btn--icon" href="/admin/3d.html" target="_blank" rel="noopener" aria-label="Abrir o laboratório 3D (nova aba)" data-tooltip="Laboratório 3D">${icon('external', 'icon-sm')}</a>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-3d-full aria-label="Ver a prévia em tela cheia" data-tooltip="Tela cheia">${icon('maximize', 'icon-sm')}</button>
      </div>
    </div>
    <div class="card__body">
      <div class="pe-stagewrap" data-stagewrap>
        <div class="stage pe-stage" data-stage>
          <div class="pe-stage__host" data-stage-host></div>
          <span class="stage__pill" data-stage-pill>${icon('sparkle', 'icon-xs')}<span>Gerado pela categoria</span></span>
          <div class="pe-stage__msg" data-stage-msg hidden></div>
        </div>
        <div class="pe-stage__bar">
          <span class="pe-stage__hint">${icon('rotate', 'icon-xs')} Arraste para girar</span>
          ${segmented({ label: 'Vista da prévia 3D', options: [['front', 'Frente'], ['three-quarter', '3/4'], ['side', 'Lado'], ['top', 'Topo']], value: 'three-quarter', size: 'sm', cls: 'pe-stage__views' })}
        </div>
      </div>
      <div class="field pe-kind">
        <label for="pe-kind">Tipo de modelo 3D</label>
        <select class="select" id="pe-kind" name="model_kind" data-search="true" data-search-placeholder="Buscar entre ${kinds.length - 1} tipos…" data-sheet-title="Tipo de modelo 3D"></select>
        <span class="hint" data-kind-hint></span>
      </div>
      <div class="field pe-swatches" data-swatches hidden><span class="label" id="pe-cp-l">Cor na prévia</span><div class="pe-swatches__row" role="radiogroup" aria-labelledby="pe-cp-l" data-swatch-row></div></div>
      <div class="pe-glb" data-glb></div>
    </div>
  </section>`;

  const copiesCard = showCopies
    ? html`<section class="card pe-card pe-o-copies pe-copies" id="pe-sec-copies" aria-labelledby="pe-h-copies" data-copies></section>`
    : '';

  render(
    view,
    html`<form class="products-editor ${canEdit ? '' : 'is-readonly'}" data-form novalidate>
      ${pageHeader({ crumbs: crumbsFor(p.category_id), title: isNew ? 'Novo produto' : p.name, meta: headMeta(), actions: headActions() })}
      <div data-flash></div>
      ${!canEdit ? html`<div class="alert alert--warning mb-3">${icon('lock')}<div><strong>Só leitura.</strong> Você pode ver este produto, mas não tem permissão para editar o catálogo de ${here()}.</div></div>` : ''}
      <nav class="ptabs pe-tabs" aria-label="Seções do produto" data-ptabs>${SECTIONS.map(
        ([k, label, anchor], i) => html`<a class="ptab" href="#${anchor}" data-ptab="${k}" data-anchor="${anchor}" aria-keyshortcuts="Alt+${i + 1}">${label}<span class="ptab__dot" data-dot hidden aria-hidden="true"></span><span class="visually-hidden" data-dot-sr hidden> (alterado)</span></a>`
      )}<span class="ptabs__keys"><span class="kbd kbd--sm">Alt</span><span class="kbd kbd--sm">1–${SECTIONS.length}</span> ir para seção</span></nav>

      <fieldset class="pe-fields" ${canEdit ? '' : 'disabled'}>
        <legend class="visually-hidden">Dados do produto</legend>
        <div class="pe-grid">
          <div class="pe-main">
            <section class="card pe-card pe-o-info" id="pe-sec-info" aria-labelledby="pe-h-info">
              <div class="card__head"><h2 class="card__title" id="pe-h-info">Informações</h2></div>
              <div class="card__body form-grid">
                <div class="field col-12">
                  <label for="pe-name">Nome do produto</label>
                  <input class="input" id="pe-name" name="name" value="${p.name}" maxlength="200" required autocomplete="off" placeholder="Ex.: Sofá 3 Lugares Retrô 210 cm - Veludo Verde">
                </div>
                <div class="field col-12">
                  <label for="pe-slug">Endereço na loja</label>
                  <div class="input-group"><span class="input-group__addon">?produto=</span><input class="input mono" id="pe-slug" name="slug" value="${p.slug}" maxlength="120" required autocomplete="off" spellcheck="false" autocapitalize="off"></div>
                  <span class="hint pe-slughint" data-slug-hint></span>
                </div>
                <div class="field col-3"><label for="pe-sku">SKU</label><input class="input mono" id="pe-sku" name="sku" value="${p.sku}" maxlength="60" autocomplete="off" spellcheck="false" placeholder="AT-SOF-210"></div>
                <div class="field col-4"><label for="pe-brand">Marca <span class="opt-tag">opcional</span></label><input class="input" id="pe-brand" name="brand" value="${p.brand}" maxlength="120" autocomplete="off"></div>
                <div class="field col-5"><label for="pe-category">Categoria</label>
                  <select class="select" id="pe-category" name="category_id" data-search="true" data-search-placeholder="Buscar categoria…" data-sheet-title="Categoria">${categoryLeafOptions(cats, p.category_id)}</select></div>
                <div class="field col-12">
                  <label for="pe-short">Descrição curta ${counter('short_description', 200)}</label>
                  <textarea class="textarea pe-short" id="pe-short" name="short_description" rows="2" maxlength="400" placeholder="Uma frase que aparece perto do preço">${p.short_description}</textarea>
                </div>
                <div class="field col-12">
                  <label for="pe-desc">Descrição completa</label>
                  <textarea class="textarea" id="pe-desc" name="description" rows="6" placeholder="Materiais, medidas, cuidados. Separe os parágrafos com uma quebra de linha.">${p.description}</textarea>
                </div>
              </div>
            </section>

            <section class="card pe-card pe-o-photos" id="pe-sec-photos" aria-labelledby="pe-h-photos">
              <div class="card__head"><h2 class="card__title" id="pe-h-photos">Fotos</h2><span class="muted small" data-photo-count></span></div>
              <div class="card__body"><div data-photos></div></div>
            </section>

            <section class="card pe-card pe-o-price" id="pe-sec-price" aria-labelledby="pe-h-price">
              <div class="card__head"><h2 class="card__title" id="pe-h-price">Preço e estoque</h2><span class="muted small" data-price-scope></span></div>
              <div class="card__body form-grid">
                ${moneyField('Preço', 'price', p.price, { required: true })}
                ${moneyField('Preço “de”', 'compare_at_price', p.compare_at_price, { opt: true })}
                ${moneyField('Custo interno', 'cost_price', p.cost_price, { opt: true })}
                <div class="col-12 pe-pricebox" data-price-preview aria-live="polite"></div>
                <div class="col-12 pe-stockrow">${switchField({ label: 'Controlar estoque', name: 'track_stock', checked: p.track_stock, hint: 'Ao zerar, aparece como esgotado na loja. Desligado, nunca esgota.' })}</div>
                <div class="field col-3"><label for="pe-stock">Quantidade</label><input class="input pe-num" id="pe-stock" name="stock_qty" type="number" step="1" inputmode="numeric" value="${p.stock_qty}"></div>
                <div class="field col-3"><label for="pe-low">Alerta abaixo de</label><input class="input pe-num" id="pe-low" name="low_stock_threshold" type="number" min="0" step="1" inputmode="numeric" value="${p.low_stock_threshold}"></div>
                <div class="col-6 pe-stockhint" data-stock-badge></div>
              </div>
            </section>

            <section class="card pe-card pe-o-variants" id="pe-sec-variants" aria-labelledby="pe-h-var">
              <div class="card__head">
                <div><h2 class="card__title" id="pe-h-var">Variações</h2><p class="card__sub">Cores, tecidos ou acabamentos. Preço e estoque em branco usam os do produto.</p></div>
                <button class="btn btn--sm" type="button" data-var-add>${icon('plus', 'icon-sm')} Adicionar</button>
              </div>
              <div class="card__body" data-variants></div>
            </section>

            <section class="card pe-card pe-o-dims" id="pe-sec-dims" aria-labelledby="pe-h-dims">
              <div class="card__head"><div><h2 class="card__title" id="pe-h-dims">Medidas</h2><p class="card__sub">Usadas na entrega e na prévia 3D</p></div></div>
              <div class="card__body form-grid">
                <div class="field col-8"><span class="label" id="pe-dims-l">Largura × altura × profundidade</span>
                  <div class="pe-dims" role="group" aria-labelledby="pe-dims-l">
                    <label class="visually-hidden" for="pe-width_cm">Largura em centímetros</label><input class="input pe-num" id="pe-width_cm" name="width_cm" value="${numInput(p.width_cm)}" inputmode="decimal" autocomplete="off" placeholder="L">
                    <span aria-hidden="true">×</span>
                    <label class="visually-hidden" for="pe-height_cm">Altura em centímetros</label><input class="input pe-num" id="pe-height_cm" name="height_cm" value="${numInput(p.height_cm)}" inputmode="decimal" autocomplete="off" placeholder="A">
                    <span aria-hidden="true">×</span>
                    <label class="visually-hidden" for="pe-depth_cm">Profundidade em centímetros</label><input class="input pe-num" id="pe-depth_cm" name="depth_cm" value="${numInput(p.depth_cm)}" inputmode="decimal" autocomplete="off" placeholder="P">
                    <span class="muted" aria-hidden="true">cm</span>
                  </div></div>
                <div class="field col-4"><label for="pe-weight_kg">Peso <span class="opt-tag">opcional</span></label>
                  <div class="input-group"><input class="input pe-num" id="pe-weight_kg" name="weight_kg" value="${numInput(p.weight_kg)}" inputmode="decimal" autocomplete="off"><span class="input-group__addon">kg</span></div></div>
                <div class="field col-6"><label for="pe-warranty">Garantia <span class="opt-tag">opcional</span></label><input class="input" id="pe-warranty" name="warranty" value="${p.warranty}" maxlength="120" placeholder="Ex.: 12 meses"></div>
                <div class="col-12" data-dims-tip></div>
              </div>
            </section>

            <section class="card pe-card pe-o-specs" aria-labelledby="pe-h-specs">
              <div class="card__head">
                <div><h2 class="card__title" id="pe-h-specs">Especificações</h2><p class="card__sub">Tabela de características na página do produto</p></div>
                <button class="btn btn--sm" type="button" data-spec-add>${icon('plus', 'icon-sm')} Adicionar</button>
              </div>
              <div class="card__body" data-specs></div>
            </section>

            <section class="card pe-card pe-o-seo" id="pe-sec-seo" aria-labelledby="pe-h-seo">
              <div class="card__head"><div><h2 class="card__title" id="pe-h-seo">SEO</h2><p class="card__sub">Como o produto aparece no Google. Em branco, usa o nome e a descrição curta.</p></div></div>
              <div class="card__body form-grid">
                <div class="field col-12">
                  <label for="pe-seo-title">Título da página ${counter('seo_title', 60)}</label>
                  <input class="input" id="pe-seo-title" name="seo_title" value="${p.seo_title}" maxlength="120" autocomplete="off">
                </div>
                <div class="field col-12">
                  <label for="pe-seo-desc">Descrição ${counter('seo_description', 160)}</label>
                  <textarea class="textarea" id="pe-seo-desc" name="seo_description" rows="3" maxlength="320">${p.seo_description}</textarea>
                </div>
                <div class="col-12"><div class="label mb-2">Prévia no Google</div><div class="pe-serp" data-serp aria-hidden="true"></div></div>
              </div>
            </section>
          </div>

          <aside class="pe-side">
            ${isNew ? lojasCard : ''}
            ${statusCard}
            ${p3dCard}
            ${!isNew ? lojasCard : ''}
            ${copiesCard}
            <section class="card pe-card pe-o-seals" aria-labelledby="pe-h-seals">
              <div class="card__head"><h2 class="card__title" id="pe-h-seals">Selos</h2></div>
              <div class="card__body pe-seals">${SEALS.map((s) => switchField({ label: s.label, name: s.key, checked: p[s.key], hint: s.hint }))}</div>
            </section>
            <section class="card pe-card pe-o-cols" aria-labelledby="pe-h-cols">
              <div class="card__head"><h2 class="card__title" id="pe-h-cols">Coleções da vitrine</h2></div>
              <div class="card__body" data-cols></div>
            </section>
            ${!isNew
              ? html`<section class="card pe-card pe-o-hist" aria-labelledby="pe-h-hist">
                  <div class="card__head"><h2 class="card__title" id="pe-h-hist">Histórico</h2></div>
                  <div class="card__body"><dl class="pe-facts">
                    <div><dt>Vendidos</dt><dd>${num(p.sold_count)}</dd></div>
                    <div><dt>Criado em</dt><dd>${datetime(p.created_at)}</dd></div>
                    <div><dt>Última alteração</dt><dd>${relTime(p.updated_at)}</dd></div>
                  </dl></div>
                </section>`
              : ''}
          </aside>
        </div>
      </fieldset>

      ${canEdit
        ? html`<div class="savebar pe-savebar" role="region" aria-label="Salvar produto" data-savebar hidden>
            <span class="savebar__dot" aria-hidden="true"></span>
            <div class="savebar__txt"><strong data-sb-title>Alterações não salvas</strong><span data-sb-sub></span></div>
            <span class="pe-sb-m" data-sb-m aria-hidden="true"></span>
            ${showCopies && editableOthers().length
              ? html`<span class="savebar__sep pe-sb-x" aria-hidden="true"></span>
                <label class="savebar__apply pe-sb-x"><input type="checkbox" data-apply-bar data-skip> Aplicar nas outras ${plural(editableOthers().length, 'loja', 'lojas')}</label>
                <button type="button" class="savebar__parts pe-sb-x" data-parts-btn aria-controls="pe-sec-copies"></button>`
              : ''}
            <div class="savebar__acts">
              <button type="button" class="btn btn--ghost" data-discard>Descartar</button>
              <button type="button" class="btn btn--ghost pe-sb-x" data-save-back>Salvar e voltar</button>
              <button type="submit" class="btn btn--primary" data-save>${icon('check', 'icon-sm')} <span data-save-label>${isNew ? 'Criar produto' : 'Salvar produto'}</span> <span class="kbd kbd--on-primary" aria-hidden="true">Ctrl S</span></button>
            </div>
          </div>`
        : ''}
    </form>`
  );

  const form = $('[data-form]', view);
  const E = form.elements;
  const varEl = $('[data-variants]', form);
  const specEl = $('[data-specs]', form);
  const bar = $('[data-savebar]', form);

  /* ----- Aviso do último salvamento (cópias criadas, falhas) ----- */
  function drawFlash() {
    const box = $('[data-flash]', form);
    const fl = flash && flash.pid === pid ? flash : null;
    if (!fl) return render(box, '');
    const retry = fl.retry ? html`<button class="btn btn--sm" type="button" data-flash-retry>${icon('refresh', 'icon-sm')} Tentar de novo</button>` : '';
    render(
      box,
      html`<div class="alert ${fl.tone === 'ok' ? 'alert--success' : fl.tone === 'warn' ? 'alert--warning' : 'alert--danger'} pe-flash" role="${fl.tone === 'ok' ? 'status' : 'alert'}">
        ${icon(fl.tone === 'ok' ? 'checkCircle' : 'alert')}
        <div class="grow"><strong>${fl.title}</strong>${fl.lines.map((l) => html`<br>${l}`)}${retry ? html`<div class="pe-flash__acts">${retry}</div>` : ''}</div>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-flash-close aria-label="Fechar aviso">${icon('close', 'icon-sm')}</button>
      </div>`
    );
  }
  form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-flash-close]')) {
      flash = null;
      drawFlash();
    } else if (e.target.closest('[data-flash-retry]') && flash?.retry) {
      const btn = e.target.closest('[data-flash-retry]');
      const fn = flash.retry;
      await withBusy(btn, fn, 'Tentando…');
    }
  });

  /* ----- Fotos ----- */
  const onPhotos = (urls) => {
    urls.forEach((u) => {
      if (/^https?:/.test(u) && !orig.images.includes(u)) sessionUploads.add(u);
    });
    drawPhotoCount(urls);
    markDirty();
    refresh3D();
  };
  // A remoção do ui.imageUploader apaga o arquivo na hora; aqui ela só tira da lista
  // (o arquivo sai do storage ao salvar, se nada mais o usar).
  let photosEl = $('[data-photos]', form);
  const onRemoveCapture = (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm || !photosEl.contains(rm)) return;
    e.stopPropagation();
    e.preventDefault();
    const urls = uploader.value;
    urls.splice(Number(rm.dataset.remove), 1);
    uploader.set(urls);
    onPhotos(urls);
  };
  // (re)monta o envio de fotos num elemento novo (cada imageUploader liga os próprios eventos no contêiner)
  function mountUploader(urls) {
    const fresh = document.createElement('div');
    fresh.dataset.photos = '';
    photosEl.replaceWith(fresh);
    photosEl = fresh;
    photosEl.addEventListener('click', onRemoveCapture, true);
    if (canEdit && storeId) return imageUploader(photosEl, { value: urls, scope: { storeId }, folder: 'products', max: MAX_PHOTOS, onChange: onPhotos, label: 'Adicionar' });
    if (canEdit) {
      render(photosEl, html`<div class="pe-nophoto">${icon('image')}<span><strong>Escolha a loja primeiro</strong><span class="muted small">As fotos ficam guardadas na pasta da loja onde o produto nasce.</span></span></div>`);
      let list = [...urls];
      return {
        get value() {
          return [...list];
        },
        set(v) {
          list = [...v];
        },
      };
    }
    render(photosEl, urls.length ? html`<div class="uploader">${urls.map((u, i) => html`<div class="uploader__item ${i ? '' : 'is-cover'}"><img src="${mediaUrl(u)}" alt=""></div>`)}</div>` : html`<p class="muted small">Sem fotos.</p>`);
    return { value: [...urls], set() {} };
  }
  let uploader = mountUploader(orig.images);
  const drawPhotoCount = (urls = uploader.value) => {
    $('[data-photo-count]', form).textContent = urls.length ? `${urls.length} de ${MAX_PHOTOS} · arraste para reordenar · a 1ª é a capa` : `Até ${MAX_PHOTOS} fotos · JPG, PNG ou WebP`;
  };

  /* ----- Variações ----- */
  function syncFromDom() {
    $$('.pe-var', varEl).forEach((row) => {
      const v = st.variants.find((x) => x.key === row.dataset.var);
      if (!v) return;
      $$('[data-v]', row).forEach((inp) => {
        if (inp.dataset.v === 'color' && inp.value === '__pick') return;
        v[inp.dataset.v] = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
    });
    $$('.pe-spec[data-spec]', specEl).forEach((row) => {
      const s = st.specs.find((x) => x.key === row.dataset.spec);
      if (!s) return;
      $$('[data-s]', row).forEach((inp) => (s[inp.dataset.s] = inp.value));
    });
  }

  const moveBtns = (kind, key, i, n, name) => html`
    <button class="btn btn--ghost btn--sm btn--icon" type="button" data-${raw(kind)}-up="${key}" aria-label="Mover ${name} para cima" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 'icon-sm')}</button>
    <button class="btn btn--ghost btn--sm btn--icon" type="button" data-${raw(kind)}-down="${key}" aria-label="Mover ${name} para baixo" ${i === n - 1 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>`;

  function drawVariants() {
    const n = st.variants.length;
    render(
      varEl,
      n
        ? st.variants.map((v, i) => {
            const k = v.key;
            const label = v.name || `variação ${i + 1}`;
            return html`<div class="pe-var ${v.active ? '' : 'is-inactive'}" data-var="${k}">
              <div class="pe-var__media">
                <button class="pe-var__img ${v.image_url ? '' : 'is-empty'}" type="button" data-var-photo="${k}" aria-label="${v.image_url ? 'Trocar' : 'Enviar'} foto de ${label}" data-tooltip="${v.image_url ? 'Trocar foto' : 'Foto da variação'}" ${storeId ? '' : 'disabled'}>
                  ${v.image_url ? html`<img src="${mediaUrl(v.image_url)}" alt="">` : icon('image', 'icon-sm')}
                </button>
                ${v.image_url ? html`<button class="pe-var__rmimg" type="button" data-var-photo-rm="${k}" aria-label="Remover foto de ${label}">${icon('close', 'icon-xs')}</button>` : ''}
              </div>
              <div class="pe-var__grid">
                <div class="field pe-var__name"><label for="pv-${k}-name">Nome</label><input class="input" id="pv-${k}-name" name="v_${k}_name" data-v="name" value="${v.name}" maxlength="80" placeholder="Ex.: Veludo Verde" autocomplete="off"></div>
                <div class="field pe-var__color"><label for="pv-${k}-color">Cor</label>
                  <select class="select" id="pv-${k}-color" name="v_${k}_color" data-v="color" data-search="true" data-search-placeholder="Buscar cor…" data-sheet-title="Cor de ${label}">${colorOptions(v.color)}</select>
                  <input type="color" class="pe-var__picker" data-v-picker value="${hexOf(v.color)}" tabindex="-1" aria-hidden="true"></div>
                <div class="field pe-var__sku"><label for="pv-${k}-sku">SKU</label><input class="input mono" id="pv-${k}-sku" name="v_${k}_sku" data-v="sku" value="${v.sku}" maxlength="60" autocomplete="off"></div>
                <div class="field pe-var__price"><label for="pv-${k}-price">Preço</label>
                  <div class="input-group"><span class="input-group__addon">R$</span><input class="input pe-num" id="pv-${k}-price" name="v_${k}_price" data-v="price" value="${v.price}" inputmode="decimal" placeholder="Igual" autocomplete="off"></div></div>
                <div class="field pe-var__stock"><label for="pv-${k}-stock">Estoque</label><input class="input pe-num" id="pv-${k}-stock" name="v_${k}_stock" data-v="stock" value="${v.stock}" type="number" step="1" inputmode="numeric" placeholder="Igual"></div>
                <div class="field pe-var__active"><span class="label" id="pv-${k}-act-l">Na loja</span>
                  <label class="switch"><input type="checkbox" name="v_${k}_active" data-v="active" aria-labelledby="pv-${k}-act-l" ${v.active ? 'checked' : ''}><span class="switch__track"></span><span class="small" data-active-txt>${v.active ? 'Ativa' : 'Oculta'}</span></label></div>
              </div>
              <div class="pe-var__tools">
                ${moveBtns('var', k, i, n, label)}
                <button class="btn btn--ghost btn--sm btn--icon pe-danger" type="button" data-var-rm="${k}" aria-label="Remover ${label}">${icon('trash', 'icon-sm')}</button>
              </div>
            </div>`;
          })
        : html`<div class="pe-empty-row">${icon('palette', 'icon-sm')}<span>Nenhuma variação: o cliente compra o produto como está. Adicione cores ou tecidos para ele escolher.</span></div>`
    );
    drawSwatches();
  }

  function drawSpecs() {
    const n = st.specs.length;
    render(
      specEl,
      n
        ? html`<div class="pe-spec pe-spec--head" aria-hidden="true"><span class="label">Característica</span><span class="label">Valor</span><span></span></div>
          ${st.specs.map((s, i) => {
            const k = s.key;
            return html`<div class="pe-spec" data-spec="${k}">
              <div class="field"><label class="visually-hidden" for="ps-${k}-label">Característica ${i + 1}</label><input class="input" id="ps-${k}-label" name="s_${k}_label" data-s="label" value="${s.label}" maxlength="80" placeholder="Ex.: Revestimento" autocomplete="off"></div>
              <div class="field"><label class="visually-hidden" for="ps-${k}-value">Valor ${i + 1}</label><input class="input" id="ps-${k}-value" name="s_${k}_value" data-s="value" value="${s.value}" maxlength="200" placeholder="Ex.: Veludo" autocomplete="off"></div>
              <div class="pe-spec__tools">
                ${moveBtns('spec', k, i, n, s.label || `linha ${i + 1}`)}
                <button class="btn btn--ghost btn--sm btn--icon pe-danger" type="button" data-spec-rm="${k}" aria-label="Remover ${s.label || `linha ${i + 1}`}">${icon('trash', 'icon-sm')}</button>
              </div>
            </div>`;
          })}`
        : html`<div class="pe-empty-row">${icon('list', 'icon-sm')}<span>Nenhuma especificação. Ex.: Lugares: 3 · Revestimento: Veludo.</span></div>`
    );
  }

  /* ----- Coleções (por loja) ----- */
  function drawCollections() {
    const box = $('[data-cols]', form);
    if (!storeId) return render(box, html`<p class="muted small">Escolha a loja para ver as coleções da vitrine dela.</p>`);
    render(
      box,
      collections.length
        ? html`<div class="pe-cols" role="group" aria-labelledby="pe-h-cols">${collections.map(
            (c) => html`<label class="check"><input type="checkbox" data-collection value="${c.id}" ${st.collections.has(c.id) ? 'checked' : ''}>
              <span>${c.title}${c.active ? '' : html` <span class="faint small">(inativa)</span>`}</span></label>`
          )}</div>`
        : html`<p class="muted small">${here()} ainda não tem coleções. Crie em <a href="#/showcase">Vitrine e banners</a>.</p>`
    );
  }

  /* ----- Pré-visualizações ----- */
  function drawPricePreview() {
    const box = $('[data-price-preview]', form);
    const scope = $('[data-price-scope]', form);
    if (scope) scope.textContent = store ? `Só em ${here()}` : '';
    const price = parseNumber(E.price.value);
    const cmp = parseNumber(E.compare_at_price.value);
    const cost = parseNumber(E.cost_price.value);
    if (price === null || Number.isNaN(price)) {
      render(box, html`<span class="muted small">${icon('info', 'icon-xs')} Informe o preço para ver como ele aparece na loja.</span>`);
      return;
    }
    if (!store) {
      render(box, html`<span class="muted small">${icon('info', 'icon-xs')} Escolha a loja para ver o preço com o desconto do PIX e o parcelamento dela.</span>`);
      return;
    }
    const pixOn = storeHasPix(store);
    const pct = Number(store.pix_discount_pct || 0);
    const shown = pixOn ? pixPrice(price, store) : round2(price);
    const inst = installments(price, store);
    const margin = cost !== null && !Number.isNaN(cost) && shown > 0 ? ((shown - cost) / shown) * 100 : null;
    const off = cmp !== null && !Number.isNaN(cmp) && cmp > shown ? Math.round((1 - shown / cmp) * 100) : 0;
    render(
      box,
      html`<div class="pe-pchips">
        ${pixOn ? html`<span class="pe-pchip"><b>${money(shown)}</b> no PIX${pct > 0 ? html` <span class="pe-pchip__t">−${String(pct).replace('.', ',')}%</span>` : ''}</span>` : html`<span class="pe-pchip"><b>${money(price)}</b> à vista</span>`}
        <span class="pe-pchip">${inst.n > 1 ? html`<b>${inst.n}x ${money(inst.value)}</b> sem juros` : html`<b>${money(price)}</b> no cartão`}</span>
        ${off ? html`<span class="pe-pchip"><b>${off}% off</b> sobre o “de”</span>` : ''}
        ${margin !== null ? html`<span class="pe-pchip pe-pchip--m ${margin < 0 ? 'is-bad' : margin < 15 ? 'is-warn' : ''}">Margem <b>${margin.toFixed(0)}%</b></span>` : ''}
      </div>
      ${!pixOn ? html`<p class="pe-pnote">${icon('info', 'icon-xs')} ${here()} não aceita PIX: o preço exibido é o cheio.</p>` : ''}
      ${cmp !== null && !Number.isNaN(cmp) && cmp <= shown ? html`<p class="pe-warn">${icon('alert', 'icon-xs')} O preço “de” precisa ser maior que ${money(shown)} para aparecer riscado.</p>` : ''}
      ${margin !== null && margin < 0 ? html`<p class="pe-warn">${icon('alert', 'icon-xs')} O preço exibido está abaixo do custo (${money(shown - cost)} por unidade).</p>` : ''}`
    );
  }

  function drawStockBadge() {
    const qty = parseIntField(E.stock_qty.value) ?? 0;
    const thr = parseIntField(E.low_stock_threshold.value) ?? 0;
    const s = stockState({ track_stock: E.track_stock.checked, stock_qty: qty, low_stock_threshold: thr });
    render(
      $('[data-stock-badge]', form),
      s === 'untracked'
        ? html`${badge('Não controla')}<span class="muted small">Sempre disponível na loja</span>`
        : html`${s === 'out' ? badge('Esgotado', 'danger') : s === 'low' ? badge('Estoque baixo', 'warning') : badge('Em estoque', 'success')}<span class="muted small">${Number.isNaN(qty) ? '—' : num(qty)} un. · alerta em ${Number.isNaN(thr) ? '—' : num(thr)}</span>`
    );
    E.stock_qty.disabled = !E.track_stock.checked || !canEdit;
    E.low_stock_threshold.disabled = !E.track_stock.checked || !canEdit;
  }

  function drawCounters() {
    $$('[data-counter]', form).forEach((el) => {
      const n = (E[el.dataset.counter]?.value || '').trim().length;
      const max = Number(el.dataset.max);
      el.textContent = `${n} / ${max}`;
      el.classList.toggle('is-over', n > max);
    });
  }

  function drawSerp() {
    const name = E.name.value.trim() || 'Nome do produto';
    const brand = store?.brand_name || 'Atual Móveis';
    const title = E.seo_title.value.trim() || `${name} | ${brand} ${store?.city || ''}`.trim();
    const shortDesc = E.short_description.value.trim() || E.description.value.trim();
    const desc = E.seo_description.value.trim() || shortDesc || 'Adicione uma descrição para aparecer aqui.';
    E.seo_title.placeholder = `${name} | ${brand} ${store?.city || ''}`.trim();
    E.seo_description.placeholder = shortDesc.slice(0, 160) || 'Resumo em até 160 caracteres';
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
    render(
      $('[data-serp]', form),
      html`<div class="pe-serp__site"><span class="pe-serp__fav"><img src="/assets/brand/favicon.svg" alt=""></span>
        <span><span class="pe-serp__name">${brand}</span><br>
        <span class="pe-serp__url">${location.host} › loja › ${store?.slug || '…'} › ${E.slug.value.trim() || '…'}</span></span></div>
      <div class="pe-serp__title">${cut(title, 65)}</div>
      <div class="pe-serp__desc">${cut(desc, 165)}</div>`
    );
  }

  function drawHead() {
    const name = E.name.value.trim();
    const title = $('.page-title', form);
    if (title) title.textContent = name || (isNew ? 'Novo produto' : p.name);
    const status = form.querySelector('input[name="status"]:checked')?.value || 'draft';
    const hs = $('[data-head-status]', form);
    if (hs) render(hs, productStatusBadge(status));
    const sku = E.sku.value.trim();
    const hk = $('[data-head-sku]', form);
    if (hk) render(hk, sku ? html`SKU <span class="mono">${sku}</span>` : '');
    const note = $('[data-status-note]', form);
    const msg =
      status !== 'active'
        ? status === 'draft'
          ? 'Rascunhos não aparecem na loja virtual.'
          : 'Arquivados somem da loja e das buscas.'
        : store && store.active === false
          ? 'Atenção: a loja está desativada na rede, então nada aparece na loja virtual.'
          : '';
    note.textContent = msg;
    note.hidden = !msg;
    const slug = E.slug.value.trim();
    const hint = $('[data-slug-hint]', form);
    if (!slug || !SLUG_RE.test(slug)) render(hint, html`${icon('info', 'icon-xs')} Letras minúsculas sem acento, números e hífens.`);
    else render(hint, html`${icon('check', 'icon-xs')} ${store ? html`<a href="${productUrl(store, slug)}" target="_blank" rel="noopener">${location.host}${productUrl(store, slug)}</a>` : 'Cada loja mantém o próprio endereço'}`);
    const a = $('[data-view-store]', form);
    if (a) a.href = viewHref();
  }

  function drawDimsTip() {
    const box = $('[data-dims-tip]', form);
    const missing = ['width_cm', 'height_cm', 'depth_cm'].some((k) => {
      const v = parseNumber(E[k].value);
      return v === null || Number.isNaN(v) || v <= 0;
    });
    const has = !!$('.tip', box);
    if (missing && canEdit && !has) render(box, tip({ id: 'product-dims-3d', title: 'Dica do Tetim', text: 'Produtos com medidas no cadastro ganham 3D automático na loja. Preencha largura, altura e profundidade em centímetros.' }));
    else if (!missing && has) render(box, '');
  }

  function drawAll() {
    drawPricePreview();
    drawStockBadge();
    drawCounters();
    drawSerp();
    drawHead();
    drawDimsTip();
  }

  /* ----- 3D ----- */
  const stageEl = $('[data-stage]', form);
  const hostEl = $('[data-stage-host]', form);
  const kindSel = $('#pe-kind', form);
  let v3d = null;
  let v3dState = 'idle';
  let last3DKey = '';
  const catCtx = () => {
    const c = catOf(E.category_id.value);
    return { category: c, parentCategory: c?.parent_id ? catOf(c.parent_id) : null };
  };
  const currentModel3d = () => {
    const m = p.model3d && typeof p.model3d === 'object' && !Array.isArray(p.model3d) ? { ...p.model3d } : {};
    if (st.kind) m.kind = st.kind;
    else delete m.kind;
    return m;
  };
  const coverUrl = () => {
    const u = uploader.value.find((x) => !String(x).startsWith('data:'));
    return u ? mediaUrl(u) : '';
  };
  function prod3D() {
    syncFromDom();
    const n = (k) => {
      const v = parseNumber(E[k].value);
      return v === null || Number.isNaN(v) ? null : v;
    };
    return {
      id: pid || 'novo',
      name: E.name.value.trim() || 'Produto',
      short_description: E.short_description.value.trim(),
      description: E.description.value.trim(),
      width_cm: n('width_cm'),
      height_cm: n('height_cm'),
      depth_cm: n('depth_cm'),
      weight_kg: n('weight_kg'),
      specs: st.specs.map((s) => ({ label: s.label.trim(), value: s.value.trim() })).filter((s) => s.label || s.value),
      tags: Array.isArray(p.tags) ? p.tags : [],
      model3d: currentModel3d(),
      model_url: st.modelUrl || null,
      image_url: coverUrl(),
      variants: st.variants.filter((v) => v.active).map((v) => ({ id: v.key, name: v.name || 'Variação', color: v.color || null, in_stock: true })),
    };
  }
  function autoKind() {
    if (!infer) return null;
    try {
      const pr = { ...prod3D(), model3d: { ...currentModel3d(), kind: undefined } };
      delete pr.model3d.kind;
      return infer.inferKind(pr, catCtx());
    } catch {
      return null;
    }
  }
  function drawKindOptions() {
    if (!kindSel) return;
    const a = hasBasics() ? autoKind() : null;
    const autoLabel = a ? kindLabel(a.kind) : '';
    const c = catCtx().category;
    const src = !a ? '' : /model3d|produto \(/.test(a.source) ? '' : /categoria/.test(a.source) ? `Detectado pela categoria ${c?.name || ''}`.trim() : /nome|tags|especifica/.test(a.source) ? 'Detectado pelo nome do produto' : 'Detectado automaticamente';
    const manual = kinds.filter((k) => k.id !== 'none');
    const cur = st.kind;
    const opts = html`<option value="" data-icon="auto" data-hint="${src || 'A loja escolhe pelo nome, pela categoria e pelas medidas'}" ${!cur ? 'selected' : ''}>Automático${autoLabel ? ` (${autoLabel})` : ''}</option>
      <optgroup label="Escolher manualmente" data-count="${manual.length}">${manual.map(
        (k) => html`<option value="${k.id}" data-icon="${KIND_ICON[k.id] || 'cube'}" ${cur === k.id ? 'selected' : ''}>${k.label}</option>`
      )}</optgroup>
      <option value="none" data-icon="none" data-hint="Esconde o botão “Ver em 3D” na loja" ${cur === 'none' ? 'selected' : ''}>Sem 3D</option>`;
    const sig = `${autoLabel}|${src}|${cur}`;
    if (kindSel.dataset.sig !== sig) {
      kindSel.dataset.sig = sig;
      render(kindSel, opts);
      kindSel.value = cur;
    }
    const hint = $('[data-kind-hint]', form);
    hint.textContent =
      cur === 'none'
        ? 'A loja não mostra o botão “Ver em 3D” para este produto.'
        : cur
          ? `Fixado em ${kindLabel(cur)}. Use “Automático” para a loja decidir.`
          : src
            ? `${src}.`
            : 'A loja escolhe o modelo pelo nome, pela categoria e pelas medidas.';
  }
  function drawStagePill() {
    const pill = $('[data-stage-pill]', form);
    let txt;
    if (st.modelUrl) txt = 'Modelo do fabricante';
    else if (st.kind && st.kind !== 'none') txt = `Tipo: ${kindLabel(st.kind)}`;
    else if (st.kind === 'none') txt = 'Sem 3D na loja';
    else txt = catCtx().category ? 'Gerado pela categoria' : 'Gerado pelo nome';
    render(pill, html`${icon(st.modelUrl ? 'cube' : 'sparkle', 'icon-xs')}<span>${txt}</span>`);
  }
  function drawSwatches() {
    const box = $('[data-swatches]', form);
    const row = $('[data-swatch-row]', form);
    if (!box) return;
    const list = st.variants.filter((v) => v.active);
    box.hidden = list.length < 2;
    if (!list.some((v) => v.key === activeVariant)) activeVariant = list[0]?.key || null;
    render(
      row,
      list.map((v) => {
        const hex = infer ? infer.colorHex(v.color || v.name, '#c8c2b8') : hexOf(v.color);
        const on = v.key === activeVariant;
        return html`<button type="button" class="swatch swatch--lg ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${v.name || 'Variação'}" data-tooltip="${v.name || 'Variação'}" data-swatch-key="${v.key}" style="background:${hex}"></button>`;
      })
    );
  }
  function stageMessage(text, { photo = false, lab = true } = {}) {
    const msg = $('[data-stage-msg]', form);
    const cover = photo ? coverUrl() : '';
    msg.hidden = false;
    stageEl.classList.add('has-msg');
    render(
      msg,
      html`${cover ? html`<img class="pe-stage__cover" src="${cover}" alt="">` : ''}<div class="pe-stage__note">${icon('cube', 'icon-sm')}<span>${text}</span>${
        lab ? html`<a href="/admin/3d.html" target="_blank" rel="noopener">Abrir o laboratório 3D</a>` : ''
      }</div>`
    );
  }
  function hasBasics() {
    return E.name.value.trim().length >= 3 || !!E.category_id.value || !!st.modelUrl;
  }
  function stagePlaceholder(on) {
    const msg = $('[data-stage-msg]', form);
    if (on) {
      msg.hidden = false;
      stageEl.classList.add('has-msg', 'is-waiting');
      render(msg, html`<div class="pe-stage__wait">${icon('cube')}<strong>A prévia 3D aparece aqui</strong><span>Preencha o nome, a categoria e as medidas: a loja monta o modelo sozinha.</span></div>`);
    } else if (stageEl.classList.contains('is-waiting')) {
      msg.hidden = true;
      stageEl.classList.remove('has-msg', 'is-waiting');
      render(msg, '');
    }
  }
  let stageSeen = false;
  async function start3D() {
    if (v3dState !== 'idle') return;
    if (!hasBasics()) return stagePlaceholder(true);
    stagePlaceholder(false);
    v3dState = 'loading';
    ensureViewerCss();
    let viewer;
    try {
      viewer = await loadViewer();
    } catch {
      v3dState = 'failed';
      return stageMessage('Não foi possível carregar a prévia 3D agora. Confira a conexão e recarregue.', { photo: true });
    }
    if (!form.isConnected) return;
    if (!viewer.hasWebGL()) {
      v3dState = 'failed';
      return stageMessage('Prévia 3D indisponível neste aparelho.', { photo: true });
    }
    try {
      const c = catCtx();
      last3DKey = key3D();
      v3d = viewer.mount3D(hostEl, { product: prod3D(), category: c.category, parentCategory: c.parentCategory, variantId: activeVariant, interactive: true, autoRotate: !reducedMotion(), dims: true });
      v3dState = 'ready';
      stageEl.classList.add('is-live');
      v3d.ready?.then?.((r) => {
        if (r?.error && form.isConnected) stageEl.classList.add('is-error');
      });
    } catch {
      v3dState = 'failed';
      stageMessage('Prévia 3D indisponível neste aparelho.', { photo: true });
    }
  }
  const key3D = () => {
    const pr = prod3D();
    const c = catCtx();
    return JSON.stringify([pr.name, pr.width_cm, pr.height_cm, pr.depth_cm, pr.model3d, pr.model_url, pr.variants, pr.specs, c.category?.id, pr.short_description]);
  };
  const refresh3D = debounce(() => {
    drawKindOptions();
    drawStagePill();
    drawSwatches();
    if (stageSeen && v3dState === 'idle') start3D();
    if (!v3d || !form.isConnected) return;
    const k = key3D();
    if (k === last3DKey) return;
    last3DKey = k;
    const c = catCtx();
    try {
      v3d.setProduct(prod3D(), { category: c.category, parentCategory: c.parentCategory, variantId: activeVariant });
    } catch {
      /* a prévia segue com o modelo anterior */
    }
  }, 350);
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          io.disconnect();
          io = null;
          stageSeen = true;
          start3D();
        }
      },
      { rootMargin: '120px' }
    );
    io.observe(stageEl);
  } else {
    stageSeen = true;
    start3D();
  }
  const stageWrap = $('[data-stagewrap]', form);
  stageWrap.addEventListener('seg:change', (e) => {
    if (v3d?.setView) v3d.setView(e.detail.value);
  });
  $('[data-3d-full]', form)?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (stageWrap.requestFullscreen) stageWrap.requestFullscreen().catch(() => toast('Tela cheia indisponível neste navegador.', 'warning'));
    else toast('Tela cheia indisponível neste navegador.', 'warning');
  });
  $('[data-swatch-row]', form)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-swatch-key]');
    if (!b) return;
    activeVariant = b.dataset.swatchKey;
    drawSwatches();
    v3d?.setVariant?.(activeVariant);
    $(`[data-swatch-key="${activeVariant}"]`, form)?.focus();
  });
  $('[data-swatch-row]', form)?.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const bs = $$('[data-swatch-key]', form);
    const i = bs.findIndex((b) => b.dataset.swatchKey === activeVariant);
    const n = bs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length];
    if (!n) return;
    e.preventDefault();
    n.click();
  });

  // Modelo do fabricante (.glb)
  const glbName = (u) => decodeURIComponent(String(u || '').split('/').pop() || 'modelo.glb');
  function drawGlb() {
    const box = $('[data-glb]', form);
    render(
      box,
      html`<div class="pe-glb__row">
        <span class="pe-glb__ico" aria-hidden="true">${icon('cube', 'icon-sm')}</span>
        <span class="pe-glb__txt"><strong>Modelo do fabricante</strong><span class="muted small">${st.modelUrl ? html`<span class="mono">${glbName(st.modelUrl)}</span> · substitui o modelo gerado` : 'Arquivo .glb de até 15 MB (opcional)'}</span></span>
        ${canEdit
          ? st.modelUrl
            ? html`<button class="btn btn--ghost btn--sm" type="button" data-glb-pick>Trocar</button><button class="btn btn--ghost btn--sm pe-danger" type="button" data-glb-rm aria-label="Remover o modelo do fabricante">${icon('trash', 'icon-sm')}</button>`
            : html`<button class="btn btn--sm" type="button" data-glb-pick ${storeId ? '' : 'disabled'}>${icon('upload', 'icon-sm')} Enviar .glb</button>`
          : ''}
        <input type="file" accept=".glb,model/gltf-binary" hidden data-glb-file>
      </div>`
    );
  }
  async function uploadGlb(file, btn) {
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) return toast('Envie um arquivo .glb (modelo 3D binário).', 'warning');
    if (file.size > MAX_GLB) return toast(`Arquivo grande demais (${(file.size / 1048576).toFixed(1).replace('.', ',')} MB). O limite é 15 MB.`, 'warning');
    if (!storeId) return toast('Escolha a loja do produto antes de enviar o modelo.', 'warning');
    const path = `stores/${storeId}/models/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.glb`;
    try {
      await withBusy(btn, async () => {
        const { error } = await sb.storage.from('media').upload(path, file, { cacheControl: '31536000', contentType: 'model/gltf-binary', upsert: false });
        if (error) throw new Error(friendlyError(error));
      }, 'Enviando…');
    } catch (err) {
      return toastError(err);
    }
    const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    if (!/^https:\/\//.test(url)) {
      removeImage(url).catch(() => {});
      return toast('O endereço do arquivo precisa começar com https://.', 'error');
    }
    sessionModels.add(url);
    st.modelUrl = url;
    drawGlb();
    refresh3D();
    markDirty();
    toast('Modelo enviado. Salve para usar na loja.', 'success');
  }
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-glb-pick]')) $('[data-glb-file]', form)?.click();
    if (e.target.closest('[data-glb-rm]')) {
      st.modelUrl = null;
      drawGlb();
      refresh3D();
      markDirty();
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-glb-file]')) {
      const file = e.target.files?.[0];
      e.target.value = '';
      uploadGlb(file, $('[data-glb-pick]', form));
    }
  });

  /* ----- Lojas ----- */
  let lojas = null;
  const lojasHas = () => !!lojas;
  const newStores = () => [...st.picked].filter((sid) => sid !== storeId && !existingStores.has(sid)).sort((a, b) => storeOrder(a) - storeOrder(b));
  function lojasOptions() {
    const copyBy = new Map(copies.map((c) => [c.store_id, c]));
    const rank = (s) => (s.id === storeId && !networkNew ? 0 : existingStores.has(s.id) ? 3 : ctx.can('catalog', s.id) ? 1 : 2);
    const grouped = !networkNew;
    return [...ctx.stores]
      .sort((a, b) => rank(a) - rank(b) || storeOrder(a.id) - storeOrder(b.id))
      .map((s) => {
        const short = shortOf(ctx, s);
        const can = ctx.can('catalog', s.id);
        const base = { value: s.id, label: short, mark: s.id, keywords: `${s.name} ${s.city || ''} ${s.brand_name || ''}` };
        const c = copyBy.get(s.id);
        if (!isNew && (c || s.id === storeId)) {
          const cc = c || { status: p.status, price: p.price, stock_qty: p.stock_qty, track_stock: p.track_stock };
          const stock = cc.track_stock === false ? 'não controla' : Number(cc.stock_qty) <= 0 ? 'esgotado' : `${num(cc.stock_qty)} un.`;
          const tag = s.id === storeId ? ['Esta loja', 'ok'] : cc.status === 'draft' ? ['Rascunho', 'warn'] : cc.status === 'archived' ? ['Arquivado', 'neu'] : ['Já cadastrado', 'ok'];
          return { ...base, locked: true, selected: true, hint: `${money(cc.price)} · ${stock}`, badge: tag[0], badgeTone: tag[1], group: s.id === storeId ? '' : 'Já têm este produto' };
        }
        if (isNew && !networkNew && s.id === storeId) return { ...base, locked: true, selected: true, hint: `${s.brand_name || ''} · ${s.city || ''}/MG`, badge: 'Esta loja', badgeTone: 'ok' };
        if (!can) return { ...base, disabled: true, hint: 'Sem permissão de catálogo', group: grouped ? 'Outras lojas' : '' };
        const on = st.picked.has(s.id);
        const primary = networkNew && s.id === storeId;
        return { ...base, selected: on, hint: `${s.brand_name || ''} · ${s.city || ''}/MG`, badge: on ? (primary ? 'Principal' : 'Nova') : '', badgeTone: primary ? 'ok' : 'new', group: grouped ? 'Outras lojas' : '' };
      });
  }
  function renderChip(it) {
    const s = storeOf(ctx, it.value);
    const short = shortOf(ctx, s || it.value);
    if (it.value === storeId) return html`<span class="chip chip--this">${icon('home', 'icon-xs')}<span class="chip__l">${short}</span></span>`;
    if (!it.locked) return html`<span class="chip chip--new"><span class="chip__l">+ ${short}</span><span class="chip__x" data-sel-remove="${it.value}" title="Remover ${short}">${icon('close', 'icon-xs')}</span></span>`;
    return html`<span class="chip chip--sel"><span class="chip__l">${short}</span></span>`;
  }
  function drawLojasSummary() {
    const box = $('[data-lojas-sum]', form);
    if (!box) return;
    const add = newStores();
    const names = add.map((sid) => shortOf(ctx, sid));
    const n = existingStores.size;
    let body;
    let tone = 'info';
    if (networkNew) {
      if (!storeId) {
        tone = 'warn';
        body = html`Escolha <b>pelo menos uma loja</b> para cadastrar o produto.`;
      } else
        body = add.length
          ? html`Ao salvar, o produto é cadastrado em <b>${here()}</b> e copiado para <b>${joinNames(names)}</b> com o mesmo status e estoque, no mesmo grupo.`
          : html`Será cadastrado em <b>${here()}</b>. Marque outras lojas para criar cópias ligadas a ele.`;
    } else if (isNew) {
      body = add.length
        ? html`Ao salvar, o produto é cadastrado em <b>${here()}</b> e copiado para <b>${plural(add.length, 'loja', 'lojas')}</b> (${joinNames(names)}) com o mesmo status e estoque.`
        : html`Será cadastrado só em <b>${here()}</b>. Marque outras lojas para criar cópias ligadas a ele.`;
    } else if (add.length) {
      body = html`Já existe em <b>${plural(n, 'loja', 'lojas')}</b>. Ao salvar, <b>${plural(add.length, 'cópia nova', 'cópias novas')}</b> (${joinNames(names)}) ${add.length === 1 ? 'será criada' : 'serão criadas'} como <b>${STATUS_WORD[st.createAs]}</b>, no mesmo grupo.`;
    } else {
      body = n > 1 ? html`Este produto está em <b>${plural(n, 'loja', 'lojas')}</b>. Marque outras para criar cópias.` : html`Este produto está só em <b>${here()}</b>. Marque outras lojas para criar cópias ligadas a ele.`;
    }
    box.className = `pe-lojas__sum ${tone === 'warn' ? 'is-warn' : ''}`;
    render(box, html`${icon(tone === 'warn' ? 'alert' : 'info', 'icon-xs')}<span>${body}</span>`);
    const opts = $('[data-lojas-opts]', form);
    if (opts) opts.hidden = isNew || !add.length;
  }
  async function onPrimaryChange() {
    syncFromDom();
    store = storeOf(ctx, storeId);
    st.collections.clear();
    collections = [];
    drawCollections();
    drawAll();
    drawGlb();
    drawVariants();
    uploader = mountUploader(uploader.value.filter((u) => !String(u).startsWith('data:')));
    drawPhotoCount();
    if (!storeId) return;
    const sid = storeId;
    try {
      const list = await q(sb.from('collections').select('id,key,title,active,sort_order').eq('store_id', sid).order('sort_order').order('title'));
      if (sid !== storeId || !form.isConnected) return;
      collections = list;
      drawCollections();
    } catch {
      /* sem coleções */
    }
  }
  if (showLojas) {
    lojas = multiSelect($('[data-lojas]', form), {
      name: 'stores',
      label: 'Cadastrar nas lojas',
      options: lojasOptions(),
      chipsMax: 2,
      allLabel: 'Todas as outras lojas',
      placeholder: networkNew ? 'Escolha as lojas' : 'Só nesta loja',
      search: true,
      renderChip,
      onChange: (values) => {
        const locked = new Set(lojasOptions().filter((o) => o.locked).map((o) => o.value));
        st.picked = new Set(values.filter((v) => !locked.has(v)));
        if (networkNew) {
          const prim = ctx.stores.find((s) => st.picked.has(s.id))?.id || null;
          if (prim !== storeId) {
            storeId = prim;
            onPrimaryChange();
          }
          showErrors(form, {});
        }
        lojas.setOptions(lojasOptions());
        drawLojasSummary();
        markDirty();
      },
      onLockedActivate: (opt) => {
        const c = copies.find((x) => x.store_id === opt.value);
        if (c && c.id !== pid && ctx.can('catalog', c.store_id)) {
          lojas.close();
          openArchive(c);
        }
      },
    });
    const sel = lojas.select;
    sel.dataset.skip = '';
    sel.setAttribute('aria-describedby', 'pe-lojas-sum');
    sel.dataset.searchPlaceholder = 'Buscar loja ou cidade…';
    customSelect(sel, { searchPlaceholder: 'Buscar loja ou cidade…', sheetTitle: 'Cadastrar nas lojas', emptyText: (t) => `Nenhuma loja encontrada para “${t}”` });
    $('#pe-create-as', form)?.addEventListener('change', (e) => {
      st.createAs = e.target.value === 'active' ? 'active' : 'draft';
      drawLojasSummary();
      markDirty();
    });
    $('[data-keep-stock]', form)?.addEventListener('change', (e) => {
      st.keepStock = e.target.checked;
      markDirty();
    });
  }

  /* ----- Cópias ----- */
  let copiesAll = false;
  function drawCopies() {
    const box = $('[data-copies]', form);
    if (!box) return;
    const LIM = 5;
    const shownCopies = copiesAll || copies.length <= LIM + 1 ? copies : copies.slice(0, LIM);
    const others = editableOthers();
    const total = ctx.isGlobal ? `${copies.length} de ${ctx.stores.length}` : plural(copies.length, 'loja', 'lojas');
    const parts = SYNC_PARTS.filter(([k]) => st.syncParts.has(k));
    const nTargets = others.filter((c) => st.syncTargets.has(c.store_id)).length;
    const dirty = isDirty();
    render(
      box,
      html`<div class="card__head"><div><h2 class="card__title" id="pe-h-copies">${icon('layers', 'icon-sm')}Cópias deste produto</h2><p class="card__sub">Mesmo produto em outras lojas · preço e estoque de cada uma</p></div><span class="tag">${total}</span></div>
      <ul class="pe-copies__list">${shownCopies.map((c) => {
        const s = storeOf(ctx, c.store_id);
        const me = c.id === pid;
        const out = c.track_stock !== false && Number(c.stock_qty) <= 0;
        const can = ctx.can('catalog', c.store_id);
        return html`<li class="pe-copies__row ${me ? 'is-me' : ''}">
          ${s ? storeMark(s, 28) : ''}
          <div class="pe-copies__txt"><strong>${shortOf(ctx, s || c.store_id)}${me ? html` <span class="muted pe-copies__me">· esta cópia</span>` : ''}</strong>
            <span class="pe-copies__sub">${money(c.price)} · ${c.track_stock === false ? 'não controla' : out ? html`<span class="pe-copies__out">Esgotado</span>` : `${num(c.stock_qty)} un.`}</span></div>
          ${productStatusBadge(c.status)}
          ${me
            ? html`<span class="pe-copies__sp" aria-hidden="true"></span>`
            : html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-copy-open="${c.id}" aria-label="Abrir a cópia de ${shortOf(ctx, s || c.store_id)}" data-tooltip="Abrir a cópia">${icon('external', 'icon-sm')}</button>`}
          ${!me && can
            ? c.status === 'archived'
              ? html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-copy-restore="${c.id}" aria-label="Reativar a cópia de ${shortOf(ctx, s || c.store_id)}" data-tooltip="Reativar como rascunho">${icon('undo', 'icon-sm')}</button>`
              : html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-copy-archive="${c.id}" aria-label="Arquivar a cópia de ${shortOf(ctx, s || c.store_id)}" data-tooltip="Tirar desta loja">${icon('archive', 'icon-sm')}</button>`
            : ''}
        </li>`;
      })}</ul>
      ${shownCopies.length < copies.length ? html`<button class="btn btn--ghost btn--sm pe-copies__more" type="button" data-copies-all>${icon('chevronDown', 'icon-sm')} Mostrar as outras ${num(copies.length - shownCopies.length)}</button>` : ''}
      ${others.length && canEdit
        ? html`<div class="pe-sync">
            <label class="switch pe-sync__on"><input type="checkbox" data-apply-toggle data-skip ${st.applyOn ? 'checked' : ''}><span class="switch__track"></span><span class="switch__txt"><strong>Aplicar estas alterações também nas outras lojas</strong><br><span class="muted small">Ao salvar, leva as partes escolhidas para as lojas marcadas.</span></span></label>
            <p class="label" id="pe-sync-parts-l">O que levar</p>
            <div class="tchips" role="group" aria-labelledby="pe-sync-parts-l">${SYNC_PARTS.map(
              ([k, label]) => html`<button class="tchip ${st.syncParts.has(k) ? 'is-on' : ''}" type="button" role="checkbox" aria-checked="${st.syncParts.has(k)}" data-part="${k}">${icon('check', 'icon-xs')}${label}</button>`
            )}</div>
            ${st.syncParts.has('price') || st.syncParts.has('stock') ? html`<p class="pe-warn">${icon('alert', 'icon-xs')} Preço e estoque de cada loja serão trocados pelos desta. Vamos confirmar antes.</p>` : ''}
            <div class="field pe-sync__to"><label for="pe-sync-to">Para quais lojas</label>
              <select class="select" id="pe-sync-to" multiple data-skip data-sync-targets data-placeholder="Nenhuma loja" data-chips-max="2" data-sheet-title="Levar para quais lojas" data-search-placeholder="Buscar loja ou cidade…">${others.map((c) => {
                const s = storeOf(ctx, c.store_id);
                return html`<option value="${c.store_id}" data-mark="${c.store_id}" data-hint="${money(c.price)} · ${PRODUCT_STATUS[c.status]?.label || c.status}" data-keywords="${s?.name || ''} ${s?.city || ''}" ${st.syncTargets.has(c.store_id) ? 'selected' : ''}>${shortOf(ctx, s || c.store_id)}</option>`;
              })}</select></div>
            <button class="btn pe-sync__go" type="button" data-sync-now ${!parts.length || !nTargets ? 'disabled' : ''}>${icon('sync', 'icon-sm')} ${dirty ? 'Salvar e sincronizar' : `Sincronizar ${plural(nTargets, 'cópia', 'cópias')}`}</button>
            <p class="hint">Copia desta loja para as outras. O endereço de cada loja nunca muda.</p>
          </div>`
        : ''}`
    );
  }
  async function reloadCopies() {
    if (!product?.group_id) return;
    try {
      copies = await q(sb.from('products').select('id,store_id,status,price,stock_qty,track_stock,updated_at').eq('group_id', product.group_id));
      copies.sort((a, b) => (a.id === pid ? -1 : b.id === pid ? 1 : storeOrder(a.store_id) - storeOrder(b.store_id)));
      copies.forEach((c) => existingStores.add(c.store_id));
      drawCopies();
      if (lojas) lojas.setOptions(lojasOptions());
      drawLojasSummary();
    } catch {
      /* mantém a lista */
    }
  }
  function openArchive(c) {
    const s = storeOf(ctx, c.store_id);
    const short = shortOf(ctx, s || c.store_id);
    openModal({
      title: `Tirar este produto de ${short}?`,
      size: 'sm',
      role: 'alertdialog',
      icon: 'archive',
      tone: 'warn',
      cls: 'modal--confirm',
      body: html`<p class="modal__text">A cópia de ${short} é arquivada: some da loja e das buscas, mas continua no grupo com preço, estoque e histórico. Nada é apagado.</p>
        <div class="pe-archline">${s ? storeMark(s, 30) : ''}<span><strong>${E.name.value.trim() || p.name}</strong><span class="muted small">${short} · ${money(c.price)} · ${c.track_stock === false ? 'não controla' : `${num(c.stock_qty)} un.`} · ${PRODUCT_STATUS[c.status]?.label || c.status}</span></span></div>`,
      actions: html`<button class="btn" type="button" data-close data-initial-focus>Manter em ${short}</button>
        <button class="btn btn--dark" type="button" data-arch-ok>${icon('archive', 'icon-sm')} Arquivar cópia</button>`,
      onMount(el, close) {
        $('[data-arch-ok]', el).addEventListener('click', async (e) => {
          const prev = c.status;
          try {
            await withBusy(e.currentTarget, () => q(sb.from('products').update({ status: 'archived', updated_by: ctx.user.id }).eq('id', c.id).select('id').single()), 'Arquivando…');
          } catch (err) {
            return toastError(err);
          }
          close();
          toast(`Cópia de ${short} arquivada`, 'success', 6500, {
            action: {
              label: 'Desfazer',
              onClick: async () => {
                try {
                  await q(sb.from('products').update({ status: prev, updated_by: ctx.user.id }).eq('id', c.id).select('id').single());
                  toast(`Cópia de ${short} de volta como ${STATUS_WORD[prev]}`, 'success');
                  reloadCopies();
                } catch (err) {
                  toastError(err);
                }
              },
            },
          });
          reloadCopies();
        });
      },
    });
  }
  async function restoreCopy(c, btn) {
    const short = shortOf(ctx, c.store_id);
    try {
      await withBusy(btn, () => q(sb.from('products').update({ status: 'draft', updated_by: ctx.user.id }).eq('id', c.id).select('id').single()), '…');
      toast(`Cópia de ${short} reativada como rascunho`, 'success');
      reloadCopies();
    } catch (err) {
      toastError(err);
    }
  }
  async function guardLeave() {
    if (!isDirty()) return true;
    const ok = await confirmLeave();
    if (ok) leaving = true;
    return ok;
  }
  async function openCopy(c) {
    if (!(await guardLeave())) return;
    if (!ctx.storeId) ctx.navigate(`#/products/${c.id}`);
    else ctx.setStore(c.store_id, `#/products/${c.id}`);
  }
  const confirmOverwrite = (targets, parts) =>
    confirmDialog({
      title: 'Substituir preço e estoque nas outras lojas?',
      message: `${[parts.includes('price') && 'O preço', parts.includes('stock') && 'o estoque'].filter(Boolean).join(' e ')} de ${joinNames(targets.map((sid) => shortOf(ctx, sid)))} ${targets.length === 1 ? 'será trocado' : 'serão trocados'} pelos desta loja (${money(parseNumber(E.price.value) || 0)}${parts.includes('stock') ? `, ${num(parseIntField(E.stock_qty.value) || 0)} un.` : ''}). Cada loja perde o valor próprio.`,
      confirmLabel: 'Substituir e continuar',
      danger: true,
    });
  async function runSync(targets, parts) {
    const r = await rpc('sync_product_group', { p_source: pid, p_targets: targets, p_parts: parts });
    return r?.updated ?? targets.length;
  }
  async function syncNow(btn) {
    const targets = editableOthers().filter((c) => st.syncTargets.has(c.store_id)).map((c) => c.store_id);
    const parts = SYNC_PARTS.map(([k]) => k).filter((k) => st.syncParts.has(k));
    if (!targets.length || !parts.length) return;
    if (isDirty()) return save($('[data-save]', form) || btn, { forceSync: true });
    if ((parts.includes('price') || parts.includes('stock')) && !(await confirmOverwrite(targets, parts))) return;
    try {
      const n = await withBusy(btn, () => runSync(targets, parts), 'Sincronizando…');
      toast(`${plural(n, 'cópia atualizada', 'cópias atualizadas')}`, 'success');
      reloadCopies();
    } catch (err) {
      toastError(err);
    }
  }
  form.addEventListener('click', (e) => {
    const t = e.target;
    const part = t.closest('[data-part]');
    if (part) {
      const k = part.dataset.part;
      if (st.syncParts.has(k)) st.syncParts.delete(k);
      else st.syncParts.add(k);
      lsSet(SYNC_KEY, JSON.stringify([...st.syncParts]));
      drawCopies();
      $(`[data-part="${k}"]`, form)?.focus();
      paintBar();
      return;
    }
    const op = t.closest('[data-copy-open]');
    if (op) return openCopy(copies.find((c) => c.id === op.dataset.copyOpen));
    const ar = t.closest('[data-copy-archive]');
    if (ar) return openArchive(copies.find((c) => c.id === ar.dataset.copyArchive));
    const rs = t.closest('[data-copy-restore]');
    if (rs) return restoreCopy(copies.find((c) => c.id === rs.dataset.copyRestore), rs);
    if (t.closest('[data-copies-all]')) {
      copiesAll = true;
      drawCopies();
      $('.pe-copies__row:nth-child(6) [data-copy-open]', form)?.focus();
      return;
    }
    const sn = t.closest('[data-sync-now]');
    if (sn) return syncNow(sn);
    if (t.closest('[data-parts-btn]')) {
      $('#pe-sec-copies', form)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => $('[data-part]', form)?.focus({ preventScroll: true }), reducedMotion() ? 0 : 350);
    }
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-apply-toggle], [data-apply-bar]')) {
      st.applyOn = t.checked;
      const a = $('[data-apply-toggle]', form);
      const b = $('[data-apply-bar]', form);
      if (a) a.checked = st.applyOn;
      if (b) b.checked = st.applyOn;
      paintBar();
    } else if (t.matches('[data-sync-targets]')) {
      st.syncTargets = new Set(Array.from(t.selectedOptions).map((o) => o.value));
      paintSyncBtn();
    }
  });

  /* ----- Estado e alterações ----- */
  const FIELD_PART = {
    name: 'info', slug: 'info', sku: 'info', brand: 'info', category_id: 'info', short_description: 'info', description: 'info',
    price: 'price', compare_at_price: 'price', cost_price: 'price', track_stock: 'price', stock_qty: 'price', low_stock_threshold: 'price',
    width_cm: 'dims', height_cm: 'dims', depth_cm: 'dims', weight_kg: 'dims', warranty: 'dims',
    seo_title: 'seo', seo_description: 'seo', status: 'status', model_kind: 'model',
  };
  SEALS.forEach((s) => (FIELD_PART[s.key] = 'seals'));
  function readFields() {
    const fields = {};
    for (const el of form.elements) {
      if (!el.name || /^[vs]_/.test(el.name) || 'skip' in el.dataset || el.type === 'file') continue;
      if (el.type === 'radio') {
        if (el.checked) fields[el.name] = el.value;
      } else fields[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return fields;
  }
  function parts() {
    syncFromDom();
    const fields = readFields();
    const by = {};
    for (const [k, v] of Object.entries(fields)) {
      const part = FIELD_PART[k] || 'info';
      (by[part] = by[part] || {})[k] = v;
    }
    const out = {};
    for (const k of ['info', 'price', 'dims', 'seo', 'status', 'seals', 'model']) out[k] = JSON.stringify(by[k] || {});
    out.photos = JSON.stringify(uploader.value);
    out.variants = JSON.stringify(st.variants.map(({ key, ...v }) => v));
    out.dims += JSON.stringify(st.specs.map(({ key, ...s }) => s));
    out.model += JSON.stringify([st.kind, st.modelUrl]);
    out.collections = JSON.stringify([...st.collections].sort());
    const add = newStores();
    out.lojas = JSON.stringify(add.length ? [add.sort(), isNew ? '' : st.createAs, isNew ? '' : st.keepStock] : networkNew ? [storeId] : []);
    return out;
  }
  const dirtyParts = () => {
    if (!savedParts) return [];
    const now = parts();
    return Object.keys(now).filter((k) => now[k] !== savedParts[k]);
  };
  const isDirty = () => !leaving && canEdit && dirtyParts().length > 0;

  function paintBar() {
    if (!bar) return;
    const list = dirtyParts();
    const dirty = !leaving && list.length > 0;
    const labels = [
      ...SECTIONS.filter(([k]) => list.includes(k === 'photos' ? 'photos' : k)).map(([, l]) => l),
      ...list.filter((k) => EXTRA_LABEL[k]).map((k) => EXTRA_LABEL[k]),
    ];
    $$('[data-ptab]', form).forEach((a) => {
      const on = list.includes(a.dataset.ptab);
      $('[data-dot]', a).hidden = !on;
      $('[data-dot-sr]', a).hidden = !on;
    });
    const show = canEdit && (dirty || isNew);
    if (show !== !bar.hidden) {
      bar.hidden = !show;
      if (show) document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight + 12}px`);
      else document.documentElement.style.removeProperty('--bar-h');
    }
    const add = newStores();
    const setTxt = (sel, txt) => {
      const el = $(sel, bar);
      if (el && el.textContent !== txt) el.textContent = txt;
    };
    setTxt('[data-sb-title]', isNew ? (dirty ? 'Produto novo, ainda não salvo' : 'Produto novo') : 'Alterações não salvas');
    setTxt('[data-sb-sub]', labels.length ? joinNames(labels) : isNew ? 'Preencha as informações e salve para cadastrar' : '');
    setTxt('[data-sb-m]', isNew ? 'Produto novo' : plural(labels.length || 1, 'alteração', 'alterações'));
    const disc = $('[data-discard]', bar);
    if (disc) disc.hidden = !dirty;
    const total = (networkNew ? (storeId ? 1 : 0) : 1) + add.length;
    // durante o salvamento o botão mostra "Salvando…" (sem o rótulo)
    setTxt('[data-save-label]', isNew ? (total > 1 ? `Cadastrar em ${total} lojas` : 'Criar produto') : 'Salvar produto');
    const pb = $('[data-parts-btn]', bar);
    if (pb) {
      const ps = SYNC_PARTS.filter(([k]) => st.syncParts.has(k)).map(([, l]) => l.replace(' e 3D', ''));
      render(pb, html`${ps.length ? (ps.length > 2 ? `${ps.slice(0, 2).join(' + ')} +${ps.length - 2}` : ps.join(' + ')) : 'Nada escolhido'}${icon('chevronDown', 'icon-xs')}`);
      pb.disabled = !st.applyOn;
      pb.title = 'Escolher o que levar para as outras lojas';
    }
    paintSyncBtn(dirty);
  }
  function paintSyncBtn(dirty = isDirty()) {
    const go = $('[data-sync-now]', form);
    if (!go) return;
    const nT = editableOthers().filter((c) => st.syncTargets.has(c.store_id)).length;
    go.disabled = !nT || !st.syncParts.size;
    const lbl = dirty ? 'Salvar e sincronizar' : nT ? `Sincronizar ${plural(nT, 'cópia', 'cópias')}` : 'Escolha as lojas';
    if (go.textContent.trim() !== lbl) render(go, html`${icon('sync', 'icon-sm')} ${lbl}`);
  }
  const markDirty = debounce(paintBar, 90);
  // borda laranja nos campos alterados
  function paintFieldDirty(el) {
    if (!el?.name || !(el.name in savedFields) || el.type === 'checkbox' || el.type === 'radio') return;
    const trigger = el.tagName === 'SELECT' ? el.nextElementSibling?.matches?.('.sel__trigger') && el.nextElementSibling : null;
    const changed = savedFields[el.name] !== el.value;
    el.classList.toggle('is-dirty', changed && el.tagName !== 'SELECT');
    trigger?.classList.toggle('is-dirty', changed);
  }

  function collect() {
    syncFromDom();
    const t = (n) => (E[n]?.value ?? '').trim();
    const nn = (n) => t(n) || null;
    const model3d = currentModel3d();
    const productRow = {
      name: t('name'),
      slug: t('slug'),
      sku: nn('sku'),
      brand: nn('brand'),
      category_id: nn('category_id'),
      short_description: nn('short_description'),
      description: nn('description'),
      price: parseNumber(t('price')),
      compare_at_price: parseNumber(t('compare_at_price')),
      cost_price: parseNumber(t('cost_price')),
      track_stock: E.track_stock.checked,
      stock_qty: parseIntField(t('stock_qty')),
      low_stock_threshold: parseIntField(t('low_stock_threshold')),
      status: form.querySelector('input[name="status"]:checked')?.value || 'draft',
      width_cm: parseNumber(t('width_cm')),
      height_cm: parseNumber(t('height_cm')),
      depth_cm: parseNumber(t('depth_cm')),
      weight_kg: parseNumber(t('weight_kg')),
      warranty: nn('warranty'),
      seo_title: nn('seo_title'),
      seo_description: nn('seo_description'),
      specs: st.specs.map((s) => ({ label: s.label.trim(), value: s.value.trim() })).filter((s) => s.label || s.value),
      model3d,
      model_url: st.modelUrl || null,
    };
    for (const s of SEALS) productRow[s.key] = E[s.key].checked;
    const vars = st.variants.map((v) => ({
      key: v.key,
      id: v.id || null,
      name: v.name.trim(),
      color: v.color.trim() || null,
      image_url: v.image_url || null,
      sku: v.sku.trim() || null,
      price_override: parseNumber(v.price),
      stock_qty: parseIntField(v.stock),
      active: !!v.active,
    }));
    return { product: productRow, images: uploader.value, variants: vars, collections: [...st.collections] };
  }

  function validate({ product: P, variants: V }) {
    const e = {};
    if (P.name.length < 2) e.name = 'Informe o nome do produto (mínimo de 2 caracteres).';
    if (!P.slug) e.slug = 'Informe o endereço do produto.';
    else if (!SLUG_RE.test(P.slug)) e.slug = 'Use só letras minúsculas sem acento, números e hífens (ex.: sofa-retro-3-lugares).';
    if (P.price === null) e.price = 'Informe o preço.';
    else if (bad(P.price) || P.price > MAX_MONEY) e.price = 'Preço inválido.';
    if (bad(P.compare_at_price) || P.compare_at_price > MAX_MONEY) e.compare_at_price = 'Valor inválido.';
    if (bad(P.cost_price) || P.cost_price > MAX_MONEY) e.cost_price = 'Valor inválido.';
    if (P.track_stock && Number.isNaN(P.stock_qty)) e.stock_qty = 'Use um número inteiro.';
    if (P.track_stock && (Number.isNaN(P.low_stock_threshold) || P.low_stock_threshold < 0)) e.low_stock_threshold = 'Use um número inteiro a partir de 0.';
    for (const k of ['width_cm', 'height_cm', 'depth_cm']) if (bad(P[k]) || P[k] > 9999999) e[k] = 'Medida inválida.';
    if (bad(P.weight_kg) || P.weight_kg > 999999) e.weight_kg = 'Peso inválido.';
    for (const v of V) {
      if (!v.name) e[`v_${v.key}_name`] = 'Informe o nome da variação.';
      if (bad(v.price_override) || v.price_override > MAX_MONEY) e[`v_${v.key}_price`] = 'Preço inválido.';
      if (Number.isNaN(v.stock_qty)) e[`v_${v.key}_stock`] = 'Use um número inteiro.';
    }
    for (const s of st.specs) if (!s.label.trim() && s.value.trim()) e[`s_${s.key}_label`] = 'Informe a característica.';
    return e;
  }

  // Resumo do que foi gravado (aparece no topo do editor depois de salvar)
  function buildFlash({ id: savedId, created, skipped, dupError, dupTargets, dupStatus, dupKeep, synced, syncError, syncTargets, syncParts, isNewSave }) {
    const lines = [];
    let tone = 'ok';
    let title = '';
    let retry = null;
    const createdNames = created.map((sid) => shortOf(ctx, sid));
    if (isNewSave) title = created.length ? `Cadastrado em ${plural(created.length + 1, 'loja', 'lojas')}` : `Produto criado em ${here()}`;
    else title = 'Produto salvo';
    if (created.length) lines.push(`${plural(created.length, 'cópia criada', 'cópias criadas')} em ${joinNames(createdNames)} como ${STATUS_WORD[dupStatus]}${dupKeep ? ', com o mesmo estoque' : ', com estoque zerado'}.`);
    if (skipped) lines.push(`${plural(skipped, 'loja já tinha', 'lojas já tinham')} este produto e ${skipped === 1 ? 'ficou' : 'ficaram'} como ${skipped === 1 ? 'estava' : 'estavam'}.`);
    if (synced) lines.push(`${plural(synced, 'cópia atualizada', 'cópias atualizadas')} com ${joinNames(SYNC_PARTS.filter(([k]) => syncParts.includes(k)).map(([, l]) => l.toLowerCase()))}.`);
    if (syncError) {
      tone = 'warn';
      title = isNewSave ? title : 'Salvo aqui, mas não nas outras lojas';
      lines.push(`As alterações não foram levadas para ${joinNames(syncTargets.map((sid) => shortOf(ctx, sid)))}: ${syncError.message}`);
      retry = async () => {
        try {
          const n = await runSync(syncTargets, syncParts);
          flash = { pid: savedId, tone: 'ok', title: 'Outras lojas atualizadas', lines: [`${plural(n, 'cópia atualizada', 'cópias atualizadas')}.`] };
          toast(`${plural(n, 'cópia atualizada', 'cópias atualizadas')}`, 'success');
          keepScroll = { id: savedId, y: window.scrollY };
          ctx.navigate(`#/products/${savedId}`);
        } catch (err) {
          toastError(err);
        }
      };
    }
    if (dupError) {
      tone = 'bad';
      title = isNewSave ? `Produto criado só em ${here()}` : 'Produto salvo, mas as cópias não foram criadas';
      lines.push(`As cópias em ${joinNames(dupTargets.map((sid) => shortOf(ctx, sid)))} não foram criadas: ${dupError.message}`);
      retry = async () => {
        try {
          const r = await rpc('duplicate_products', { p_ids: [savedId], p_targets: dupTargets, p_status: dupStatus, p_keep_stock: dupKeep });
          const names = [...new Set((r?.items || []).map((i) => i.store_id))].map((sid) => shortOf(ctx, sid));
          flash = { pid: savedId, tone: 'ok', title: 'Cópias criadas', lines: [names.length ? `${plural(names.length, 'cópia criada', 'cópias criadas')} em ${joinNames(names)}.` : 'As lojas já tinham este produto.'] };
          toast(names.length ? `${plural(names.length, 'cópia criada', 'cópias criadas')} em ${joinNames(names)}` : 'As lojas já tinham este produto', 'success');
          keepScroll = { id: savedId, y: window.scrollY };
          ctx.navigate(`#/products/${savedId}`);
        } catch (err) {
          toastError(err);
        }
      };
    }
    if (tone === 'ok' && !created.length && !synced && !skipped) return null;
    return { pid: savedId, tone, title, lines, retry };
  }

  async function save(btn, { back = false, forceSync = false } = {}) {
    if (saving || !canEdit) return;
    if (networkNew && !storeId) {
      showErrors(form, { stores: 'Escolha pelo menos uma loja para cadastrar o produto.' });
      $('#pe-sec-lojas', form)?.scrollIntoView({ block: 'center' });
      return toast('Escolha em quais lojas cadastrar o produto.', 'warning');
    }
    const data = collect();
    if (data.images.some((u) => u.startsWith('data:'))) return toast('Aguarde o envio das fotos terminar.', 'warning');
    if (!showErrors(form, validate(data))) return toast('Revise os campos destacados.', 'warning');
    const P = data.product;
    const syncTargets = !isNew && (st.applyOn || forceSync) ? editableOthers().filter((c) => st.syncTargets.has(c.store_id)).map((c) => c.store_id) : [];
    const syncParts = SYNC_PARTS.map(([k]) => k).filter((k) => st.syncParts.has(k));
    if (syncTargets.length && !syncParts.length) return toast('Escolha o que levar para as outras lojas.', 'warning');
    if (syncTargets.length && (syncParts.includes('price') || syncParts.includes('stock')) && !(await confirmOverwrite(syncTargets, syncParts))) return;
    const dupTargets = newStores();
    const dupStatus = isNew ? P.status : st.createAs;
    const dupKeep = isNew ? true : st.keepStock;
    const row = {
      ...P,
      price: round2(P.price),
      compare_at_price: P.compare_at_price === null ? null : round2(P.compare_at_price),
      cost_price: P.cost_price === null ? null : round2(P.cost_price),
      stock_qty: P.track_stock ? P.stock_qty ?? 0 : Number.isNaN(P.stock_qty) || P.stock_qty === null ? p.stock_qty ?? 0 : P.stock_qty,
      low_stock_threshold: P.track_stock ? P.low_stock_threshold ?? 0 : p.low_stock_threshold ?? 2,
      updated_by: ctx.user.id,
    };
    saving = true;
    let productSaved = false;
    let stepError = null;
    const result = { created: [], skipped: 0, dupError: null, synced: 0, syncError: null };
    const isNewSave = !pid;
    try {
      await withBusy(btn, async () => {
        let dq = sb.from('products').select('id').eq('store_id', storeId).eq('slug', row.slug).limit(1);
        if (pid) dq = dq.neq('id', pid);
        if ((await q(dq)).length) {
          const err = new Error('Já existe outro produto com este endereço nesta loja. Escolha outro.');
          err.field = 'slug';
          throw err;
        }
        if (!pid) {
          const created = await q(sb.from('products').insert({ ...row, store_id: storeId, created_by: ctx.user.id }).select('id').single());
          pid = created.id;
        } else {
          await q(sb.from('products').update(row).eq('id', pid).select('id').single());
        }
        productSaved = true;
        try {
          // Fotos: substitui as linhas na nova ordem (a primeira vira capa)
          if (JSON.stringify(data.images) !== JSON.stringify(orig.images)) {
            await q(sb.from('product_images').delete().eq('product_id', pid));
            if (data.images.length)
              await q(sb.from('product_images').insert(data.images.map((url, i) => ({ product_id: pid, store_id: storeId, url, alt: row.name, sort_order: i }))));
          }
          // Variações
          const keep = new Set(data.variants.filter((v) => v.id).map((v) => v.id));
          const removed = Object.keys(orig.variants).filter((vid) => !keep.has(vid));
          if (removed.length) await q(sb.from('product_variants').delete().in('id', removed));
          await Promise.all(
            data.variants.map((v, i) => {
              const vr = { name: v.name, color: v.color, image_url: v.image_url, sku: v.sku, price_override: v.price_override === null ? null : round2(v.price_override), stock_qty: v.stock_qty, active: v.active, sort_order: i };
              if (!v.id) return q(sb.from('product_variants').insert({ ...vr, product_id: pid, store_id: storeId }));
              const o = orig.variants[v.id];
              const changed = Object.entries(vr).some(([k, val]) => (k === 'price_override' && val !== null && o[k] !== null ? Number(o[k]) !== val : o[k] !== val));
              return changed ? q(sb.from('product_variants').update(vr).eq('id', v.id)) : null;
            })
          );
          // Coleções
          const now = new Set(data.collections);
          const out = [...orig.collections].filter((c) => !now.has(c));
          const add = data.collections.filter((c) => !orig.collections.has(c));
          if (out.length) await q(sb.from('collection_items').delete().eq('product_id', pid).in('collection_id', out));
          for (const cid of add) {
            const last = await q(sb.from('collection_items').select('sort_order').eq('collection_id', cid).order('sort_order', { ascending: false }).limit(1));
            await q(sb.from('collection_items').insert({ collection_id: cid, product_id: pid, sort_order: (last[0]?.sort_order ?? 0) + 1 }));
          }
        } catch (err) {
          stepError = err;
        }
        // Outras lojas: primeiro aplica nas cópias que já existem, depois cria as novas a partir da linha salva
        if (syncTargets.length) {
          try {
            result.synced = await runSync(syncTargets, syncParts);
          } catch (err) {
            result.syncError = err;
          }
        }
        if (dupTargets.length) {
          try {
            const r = await rpc('duplicate_products', { p_ids: [pid], p_targets: dupTargets, p_status: dupStatus, p_keep_stock: dupKeep });
            result.created = [...new Set((r?.items || []).map((i) => i.store_id))].sort((a, b) => storeOrder(a) - storeOrder(b));
            result.skipped = r?.skipped || 0;
          } catch (err) {
            result.dupError = err;
          }
        }
        // Arquivos que saíram do produto (e não são usados por cópias)
        const inUse = new Set([...data.images, ...data.variants.map((v) => v.image_url).filter(Boolean)]);
        const gone = [...orig.images, ...orig.variantImages, ...sessionUploads].filter((u) => !inUse.has(u));
        sessionUploads.clear();
        if (!stepError) safeRemoveImages(gone);
        const goneModels = [orig.modelUrl, ...sessionModels].filter((u) => u && u !== st.modelUrl);
        sessionModels.clear();
        if (goneModels.length) safeRemoveModels(goneModels);
      }, isNewSave ? 'Cadastrando…' : 'Salvando…');
    } catch (err) {
      saving = false;
      if (err.field) showErrors(form, { [err.field]: err.message });
      else if (err.raw?.code === '23505' && /slug/.test(err.raw?.message || '')) showErrors(form, { slug: 'Já existe outro produto com este endereço nesta loja.' });
      else toast(err.message || 'Sem conexão com o servidor. Suas alterações continuam aqui.', 'error', 7000, { title: 'Não foi possível salvar', action: { label: 'Tentar de novo', onClick: () => save($('[data-save]', form), { back, forceSync }) } });
      return;
    }
    saving = false;
    if (!productSaved) return;
    flash = buildFlash({ id: pid, ...result, dupTargets, dupStatus, dupKeep, syncTargets, syncParts, isNewSave });
    if (stepError) toastError(new Error(`Produto salvo, mas parte das informações não foi gravada: ${stepError.message}`));
    else if (result.dupError || result.syncError) toast(flash?.title || 'Produto salvo', 'warning', 6000);
    else if (result.created.length) {
      const names = result.created.map((sid) => shortOf(ctx, sid));
      toast(isNewSave ? `Cadastrado em ${plural(names.length + 1, 'loja', 'lojas')}` : `${plural(names.length, 'cópia criada', 'cópias criadas')} em ${joinNames(names)}`, 'success', 5000, isNewSave ? undefined : { title: 'Produto salvo' });
    } else if (result.synced) toast(`Produto salvo · ${plural(result.synced, 'cópia atualizada', 'cópias atualizadas')}`, 'success');
    else toast(isNewSave ? 'Produto criado' : 'Produto salvo', 'success');
    leaving = true;
    if (back && !stepError && !result.dupError && !result.syncError) return ctx.navigate(lastListHash);
    keepScroll = isNewSave ? null : { id: pid, y: window.scrollY };
    ctx.navigate(`#/products/${pid}`);
  }

  async function removeProduct(btn) {
    const others = copies.filter((c) => c.id !== pid).length;
    const ok = await confirmDialog({
      title: `Excluir “${p.name}”?`,
      message: `Fotos, variações e vínculos com coleções desta loja saem junto. Pedidos já feitos mantêm nome e preço.${others ? ` As cópias nas outras ${plural(others, 'loja', 'lojas')} continuam.` : ''} Não dá para desfazer.`,
      confirmLabel: 'Excluir produto',
      danger: true,
    });
    if (!ok) return;
    try {
      await withBusy(btn, async () => {
        const done = await q(sb.from('products').delete().eq('id', pid).select('id'));
        if (!done.length) throw new Error('Não foi possível excluir: o produto não existe mais ou você não tem permissão.');
      }, 'Excluindo…');
      const files = [...orig.images, ...orig.variantImages, ...sessionUploads, ...uploader.value];
      sessionUploads.clear();
      safeRemoveImages(files);
      safeRemoveModels([orig.modelUrl, ...sessionModels]);
      sessionModels.clear();
      leaving = true;
      toast('Produto excluído', 'success');
      ctx.navigate(lastListHash);
    } catch (err) {
      toastError(err);
    }
  }

  async function duplicateHere(btn) {
    if (isDirty()) return toast('Salve as alterações antes de duplicar.', 'warning');
    const ok = await confirmDialog({
      title: `Duplicar em ${here()}?`,
      message: `Cria outro produto em ${here()}, como rascunho e com estoque zerado, levando fotos, variações e especificações. Ele não fica ligado a este. Para levar este produto a outras lojas, use “Lojas”.`,
      confirmLabel: 'Duplicar produto',
    });
    if (!ok) return;
    try {
      const copyId = await withBusy(btn, () => duplicateInStore(pid, ctx.user.id), 'Duplicando…');
      toast('Cópia criada como rascunho', 'success', 5000, { title: 'Produto duplicado' });
      leaving = true;
      ctx.navigate(`#/products/${copyId}`);
    } catch (err) {
      toastError(err);
    }
  }

  function uploadVariantPhoto(key, btn) {
    if (!storeId) return toast('Escolha a loja do produto antes de enviar fotos.', 'warning');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      syncFromDom();
      const v = st.variants.find((x) => x.key === key);
      if (!v) return;
      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const url = await uploadImage(file, { storeId }, { folder: 'products', maxSize: 1000 });
        sessionUploads.add(url);
        v.image_url = url;
      } catch (err) {
        toastError(err);
      }
      drawVariants();
      markDirty();
    });
    input.click();
  }

  /* ----- Eventos ----- */
  form.addEventListener('input', (e) => {
    const t = e.target;
    if ('skip' in (t.dataset || {})) return;
    if (t.name === 'name' && !slugTouched) E.slug.value = slugify(t.value).slice(0, 120).replace(/-+$/, '');
    if (t.name === 'slug') slugTouched = true;
    if (t.matches('[data-v-picker]')) {
      const row = t.closest('.pe-var');
      const sel = $('[data-v="color"]', row);
      const v = st.variants.find((x) => x.key === row.dataset.var);
      if (v) v.color = t.value;
      render(sel, colorOptions(t.value));
      sel.value = t.value;
    }
    paintFieldDirty(t);
    if (t.name === 'name' || t.name === 'slug') paintFieldDirty(E.slug);
    drawAll();
    markDirty();
    if (/^(name|short_description|width_cm|height_cm|depth_cm)$/.test(t.name || '') || /^v_|^s_/.test(t.name || '')) refresh3D();
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if ('skip' in (t.dataset || {})) return;
    if (t.name === 'slug') {
      const s = slugify(t.value).slice(0, 120).replace(/-+$/, '');
      if (s !== t.value) t.value = s;
      if (!s) slugTouched = false;
    }
    if (t.matches('[data-collection]')) {
      if (t.checked) st.collections.add(t.value);
      else st.collections.delete(t.value);
    }
    if (t.matches('[data-v="active"]')) {
      t.closest('.pe-var').classList.toggle('is-inactive', !t.checked);
      const txt = $('[data-active-txt]', t.closest('.switch'));
      if (txt) txt.textContent = t.checked ? 'Ativa' : 'Oculta';
    }
    if (t.matches('[data-v="color"]')) {
      if (t.value === '__pick') {
        const row = t.closest('.pe-var');
        const v = st.variants.find((x) => x.key === row.dataset.var);
        t.value = v?.color || '';
        const picker = $('[data-v-picker]', row);
        try {
          if (picker.showPicker) picker.showPicker();
          else picker.click();
        } catch {
          picker.click();
        }
        return;
      }
    }
    if (t.name === 'model_kind') {
      st.kind = t.value || '';
      drawKindOptions();
    }
    paintFieldDirty(t);
    drawAll();
    markDirty();
    if (t.name === 'category_id') {
      const head = $('.crumbs', form);
      if (head && !isNew) {
        const cr = crumbsFor(t.value);
        render(
          head,
          cr.map(([label, href], i) => html`${i ? icon('chevronRight', 'icon-xs') : ''}${i === cr.length - 1 || !href ? html`<span ${i === cr.length - 1 ? raw('aria-current="page"') : ''}>${label}</span>` : html`<a href="${href}">${label}</a>`}`)
        );
      }
    }
    if (/^(category_id|model_kind)$/.test(t.name || '') || /^v_/.test(t.name || '')) refresh3D();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save($('[data-save]', form));
  });

  const moveIn = (list, key, dir) => {
    const i = list.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
  };
  const focusAfter = (...sels) =>
    setTimeout(() => {
      for (const sel of sels) {
        const el = $(sel, form);
        if (el) return el.focus();
      }
      return undefined;
    }, 0);

  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !view.contains(b)) return;
    const d = b.dataset;
    if ('saveBack' in d) return save($('[data-save]', form), { back: true });
    if ('discard' in d) return discard();
    if ('delete' in d) return removeProduct(b);
    if ('duplicate' in d) return duplicateHere(b);
    if ('varAdd' in d) {
      syncFromDom();
      const v = { key: nextKey(), id: null, name: '', color: '', image_url: '', sku: '', price: '', stock: '', active: true };
      st.variants.push(v);
      drawVariants();
      focusAfter(`#pv-${v.key}-name`);
      refresh3D();
      return markDirty();
    }
    if (d.varRm) {
      syncFromDom();
      st.variants = st.variants.filter((v) => v.key !== d.varRm);
      drawVariants();
      refresh3D();
      return markDirty();
    }
    if (d.varUp || d.varDown) {
      syncFromDom();
      const key = d.varUp || d.varDown;
      if (moveIn(st.variants, key, d.varUp ? -1 : 1)) {
        drawVariants();
        focusAfter(`[data-var-${d.varUp ? 'up' : 'down'}="${key}"]:not(:disabled)`, `[data-var-${d.varUp ? 'down' : 'up'}="${key}"]`);
      }
      return markDirty();
    }
    if (d.varPhoto) return uploadVariantPhoto(d.varPhoto, b);
    if (d.varPhotoRm) {
      syncFromDom();
      const v = st.variants.find((x) => x.key === d.varPhotoRm);
      if (v) v.image_url = '';
      drawVariants();
      return markDirty();
    }
    if ('specAdd' in d) {
      syncFromDom();
      const s = { key: nextKey(), label: '', value: '' };
      st.specs.push(s);
      drawSpecs();
      focusAfter(`#ps-${s.key}-label`);
      return markDirty();
    }
    if (d.specRm) {
      syncFromDom();
      st.specs = st.specs.filter((s) => s.key !== d.specRm);
      drawSpecs();
      return markDirty();
    }
    if (d.specUp || d.specDown) {
      syncFromDom();
      const key = d.specUp || d.specDown;
      if (moveIn(st.specs, key, d.specUp ? -1 : 1)) {
        drawSpecs();
        focusAfter(`[data-spec-${d.specUp ? 'up' : 'down'}="${key}"]:not(:disabled)`, `[data-spec-${d.specUp ? 'down' : 'up'}="${key}"]`);
      }
      return markDirty();
    }
    return undefined;
  });

  async function discard() {
    if (!isDirty()) return;
    const ok = await confirmDialog({ title: 'Descartar as alterações?', message: 'O produto volta a ficar como estava no último salvamento.', confirmLabel: 'Descartar alterações', danger: true, cancelLabel: 'Continuar editando' });
    if (!ok) return;
    leaving = true;
    keepScroll = pid ? { id: pid, y: window.scrollY } : null;
    if (sessionUploads.size) safeRemoveImages([...sessionUploads]);
    sessionUploads.clear();
    if (sessionModels.size) safeRemoveModels([...sessionModels]);
    sessionModels.clear();
    ctx.navigate(location.hash);
  }

  /* ----- Abas de seção ----- */
  const tabsNav = $('[data-ptabs]', form);
  const setActiveTab = (k) => $$('[data-ptab]', tabsNav).forEach((a) => (a.dataset.ptab === k ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  const goSection = (anchor, k) => {
    const el = document.getElementById(anchor);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (tabsNav.getBoundingClientRect().height + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64) + 24);
    window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    setActiveTab(k);
    lockTab = Date.now();
    setTimeout(() => focusable(el)?.focus({ preventScroll: true }), reducedMotion() ? 0 : 420);
  };
  const focusable = (el) => el.querySelector('input:not([type=hidden]):not(:disabled), textarea, [role="combobox"], button:not(:disabled)');
  let lockTab = 0;
  tabsNav.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ptab]');
    if (!a) return;
    e.preventDefault();
    goSection(a.dataset.anchor, a.dataset.ptab);
  });
  let tabObs = null;
  if ('IntersectionObserver' in window) {
    const visible = new Map();
    tabObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => visible.set(en.target.id, en.isIntersecting));
        if (Date.now() - lockTab < 900) return;
        const first = SECTIONS.find(([, , anchor]) => visible.get(anchor) && $(`#${anchor}`, form)?.closest('.pe-main'));
        if (first) setActiveTab(first[0]);
      },
      { rootMargin: '-140px 0px -55% 0px' }
    );
    SECTIONS.forEach(([, , anchor]) => {
      const el = document.getElementById(anchor);
      if (el) tabObs.observe(el);
    });
  }
  setActiveTab(SECTIONS[0][0]);

  /* ----- Proteção contra perder alterações ----- */
  const confirmLeave = () =>
    confirmDialog({
      title: 'Sair sem salvar?',
      message: 'As alterações deste produto ainda não foram salvas e serão perdidas.',
      confirmLabel: 'Sair sem salvar',
      danger: true,
      cancelLabel: 'Continuar editando',
    });
  ctx.onBeforeLeave(async () => {
    if (!isDirty()) return true;
    const ok = await confirmLeave();
    if (ok) leaving = true;
    return ok;
  });
  const onBeforeUnload = (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  // Sair da conta com alterações pendentes também pergunta (o shell não espera o onBeforeLeave no "Sair")
  const onLogoutClick = (e) => {
    const btn = e.target.closest?.('[data-logout]');
    if (!btn || !isDirty()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    confirmLeave().then((ok) => {
      if (!ok) return;
      leaving = true;
      btn.click();
    });
  };
  const onKey = (e) => {
    if (document.querySelector('.modal, .cmdk')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (canEdit) save($('[data-save]', form));
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      if (SECTIONS[i]) {
        e.preventDefault();
        goSection(SECTIONS[i][2], SECTIONS[i][0]);
      }
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onLogoutClick, true);
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onLogoutClick, true);
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.removeProperty('--bar-h');
    io?.disconnect();
    tabObs?.disconnect();
    try {
      v3d?.dispose?.();
    } catch {
      /* já liberado */
    }
    v3d = null;
    if (document.fullscreenElement && form.contains(document.fullscreenElement)) document.exitFullscreen?.();
    // arquivos enviados nesta edição e não salvos
    if (sessionUploads.size) safeRemoveImages([...sessionUploads]);
    if (sessionModels.size) safeRemoveModels([...sessionModels]);
  });

  if (kindSel)
    customSelect(kindSel, {
      renderValue: (it) =>
        it && !it.value ? html`<span class="opt__icon opt__icon--auto pe-kindval" aria-hidden="true">${icon('sparkle', 'icon-xs')}</span><span class="sel__label">${it.label}</span>` : null,
      emptyText: (t) => `Nenhum tipo encontrado para “${t}”`,
    });
  // categoria: "Sala de estar ›" em cinza + a categoria em negrito; rodapé com o atalho para criar
  customSelect(E.category_id, {
    renderValue: (it) => {
      if (!it || !it.value) return null;
      const path = cats.path(it.value);
      if (path.length < 2) return null;
      return html`<span class="sel__label pe-catval"><span class="muted">${path.slice(0, -1).join(' › ')} ›</span> <strong>${path[path.length - 1]}</strong></span>`;
    },
    footer: html`<div class="pe-catfoot"><span>Categorias valem para a rede toda</span>${ctx.isGlobal ? html`<a href="#/categories">${icon('plus', 'icon-xs')} Nova</a>` : ''}</div>`,
    emptyText: (t) => `Nenhuma categoria encontrada para “${t}”`,
  });

  drawVariants();
  drawSpecs();
  drawCollections();
  drawPhotoCount();
  drawKindOptions();
  drawStagePill();
  drawGlb();
  drawAll();
  drawFlash();
  if (lojas) drawLojasSummary();
  drawCopies();
  savedParts = parts();
  savedFields = Object.fromEntries(Object.entries(readFields()).filter(([, v]) => typeof v === 'string'));
  paintBar();
  if (keepScroll && keepScroll.id === pid) {
    const y = keepScroll.y;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
  keepScroll = null;
  if (flash && flash.pid === pid && flash.tone === 'ok') flash = null; // sucesso aparece uma vez só
}

/* =========================================================
   Estilos do módulo (só o que é específico daqui; o resto vem do admin.css)
   ========================================================= */
const CSS = `
.products-dd { position: relative; }
.products-dd .menu { min-width: 250px; }
.products-dd .menu button:disabled { opacity: .5; cursor: not-allowed; background: none; }

/* ----- Lista ----- */
.products-list { display: flex; flex-direction: column; gap: 16px; }
.products-list [data-tip]:empty { display: none; }
.pl-card { overflow: visible; }
.pl-tb { gap: 8px 10px; }
.pl-tb__search { min-width: 230px; max-width: 340px; }
.pl-tb__search .input { padding-right: 34px; }
.pl-tb__more { display: contents; }
.pl-tb__toggle { display: none; }
.pl-tb .sel__trigger { min-width: 0; max-width: 250px; }
.pl-tb__f--stores .sel__trigger { max-width: 230px; }
.pl-tb__sort .sel__trigger { max-width: 240px; }
.pl-results { transition: opacity var(--dur-2); }
.pl-results.is-refreshing { opacity: .55; }
.pl-results > .empty { min-height: 320px; }
.pl-note { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--line); }
.pl-table td { vertical-align: middle; }
.pl-c-prod { width: 38%; }
.pl-prod { display: flex; align-items: center; gap: 12px; min-width: 260px; }
.pl-prod .thumb { width: 48px; height: 48px; flex: none; }
.pl-thumb--empty { display: inline-grid; place-items: center; color: var(--faint); background: var(--surface-3); }
.pl-prod__txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pl-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ink); font-weight: 600; font-size: 13.5px; line-height: 1.35; text-decoration: none; }
.pl-name:hover { color: var(--accent-ink); text-decoration: underline; }
.pl-sub { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; font-size: 12.5px; color: var(--muted); }
.pl-sub .mono { font-size: 12px; }
.pl-tag { height: 20px; padding: 0 7px; font-size: 11.5px; gap: 4px; }
.pl-tag .icon-xs { width: 12px; height: 12px; }
.pl-m-store { display: none; }
.pl-cat { display: flex; flex-direction: column; gap: 1px; font-size: 13px; color: var(--text); min-width: 110px; }
.pl-cat__p { font-size: 12px; color: var(--muted); }
.pl-store { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; white-space: nowrap; }
.pl-price { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
.pl-price strong { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.pl-pix { font-size: 12px; color: var(--ok-fg); font-weight: 500; font-variant-numeric: tabular-nums; }
.pl-c-cmp s { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-stock { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pl-stock strong { color: var(--ink); font-weight: 600; }
.pl-stock.is-out strong { color: var(--bad-fg); }
.pl-stock__u { font-size: 12px; color: var(--muted); }
.pl-seals { display: inline-flex; gap: 4px; }
.pl-seal { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: var(--b-bg, var(--surface-3)); color: var(--b-fg, var(--text)); box-shadow: inset 0 0 0 1px var(--b-line, var(--line)); }
.pl-seal.t-info { --b-bg: var(--info-bg); --b-fg: var(--info-fg); --b-line: var(--info-line); }
.pl-seal.t-ok { --b-bg: var(--ok-bg); --b-fg: var(--ok-fg); --b-line: var(--ok-line); }
.pl-seal.t-warn { --b-bg: var(--warn-bg); --b-fg: var(--warn-fg); --b-line: var(--warn-line); }
.pl-seal.t-ora { --b-bg: var(--ora-bg); --b-fg: var(--ora-fg); --b-line: var(--ora-line); }
.pl-bulk__danger { color: #ffb0b4; }
.pl-bulk__danger:hover { color: #fff; background: rgba(229, 72, 77, 0.28); }
.pl-table--net .pl-c-cmp, .pl-table--net .pl-c-seals { display: none; }
.pl-table--net .pl-c-prod { width: 34%; }
@media (max-width: 1365px) { .pl-c-seals, .pl-table--net .pl-c-cat { display: none; } }
@media (max-width: 1279px) { .pl-c-cmp { display: none; } }
@media (max-width: 1100px) { .pl-c-seals { display: none; } .pl-table--net .pl-c-cat { display: none; } }

/* ----- Modais ----- */
.products-modal .pm-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.products-modal .pm-stores { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; max-height: 46vh; overflow-y: auto; padding: 2px; }
.products-modal .pm-store { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--raised); cursor: pointer; }
.products-modal .pm-store:hover { border-color: var(--line-strong); }
.products-modal .pm-store:has(input:checked:not(:disabled)) { border-color: var(--select); box-shadow: inset 0 0 0 1px var(--select); background: var(--row-selected); }
.products-modal .pm-store.is-locked { cursor: default; background: var(--surface-2); }
.products-modal .pm-store__txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.products-modal .pm-store__txt strong { font-size: 13.5px; color: var(--ink); font-weight: 600; }
.products-modal .pm-store__txt .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.products-modal .pm-opts { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 14px 18px; align-items: end; padding-top: 14px; border-top: 1px solid var(--line); }
.products-modal .pm-opts__sw { padding-bottom: 6px; }
.products-modal .pa-pct { max-width: 220px; }
.products-modal .pa-opts { display: flex; flex-direction: column; gap: 10px; }
.products-modal .pa-empty { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); border: 1px dashed var(--line-strong); }
.products-modal .pa-name, .products-modal .pi-name { display: block; max-width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink); font-weight: 500; }
.products-modal .pi-drop { display: flex; align-items: center; gap: 14px; padding: 18px; border: 1.5px dashed var(--line-strong); border-radius: 16px; background: var(--surface-2); cursor: pointer; }
.products-modal .pi-drop:hover, .products-modal .pi-drop:focus-within { border-color: var(--accent); background: var(--surface); }
.products-modal .pi-drop:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.products-modal .pi-drop > span:last-of-type { display: flex; flex-direction: column; gap: 2px; }
.products-modal .pi-drop strong { color: var(--ink); }
.products-modal .pi-drop__ico { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--accent-soft); color: var(--accent-ink); flex: none; }
.products-modal .pi-help { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; background: var(--surface); }
.products-modal .pi-help summary { cursor: pointer; font-weight: 600; color: var(--ink); font-size: 13.5px; }
.products-modal .pi-help[open] summary { margin-bottom: 10px; }
.products-modal .pi-help .btn { margin-top: 10px; }
.products-modal .pi-cols { display: flex; flex-wrap: wrap; gap: 6px; }
.products-modal .pi-cols code { padding: 3px 8px; border-radius: 6px; background: var(--surface-3); font: 500 12px/1.3 var(--font-mono); color: var(--text); }
.products-modal .pi-rules { list-style: disc; padding-left: 18px; display: grid; gap: 4px; margin-top: 10px; }
.products-modal .pi-table { max-height: 46vh; overflow: auto; }
.products-modal .pi-table td:last-child { min-width: 200px; }
.products-modal .pi-table .pi-name { max-width: 210px; }
.products-modal .pi-error { color: var(--bad-fg); }
.products-modal .pi-table .mono { white-space: nowrap; }
.products-modal .cf-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.products-modal .cf-q .search { max-width: none; min-width: 0; }
.products-modal .cf-list { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); min-height: 120px; }
.products-modal .cf-hint { display: flex; align-items: center; gap: 6px; padding: 16px; }
.products-modal .cf-head { padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); border-radius: 14px 14px 0 0; }
.products-modal .cf-items { max-height: 38vh; overflow-y: auto; padding: 4px; }
.products-modal .cf-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
.products-modal .cf-item:hover { background: var(--surface-2); }
.products-modal .cf-item .thumb { width: 40px; height: 40px; flex: none; }
.products-modal .cf-item__txt { display: flex; flex-direction: column; min-width: 0; }
.products-modal .cf-item__txt strong { color: var(--ink); font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ----- Editor ----- */
.products-editor { position: relative; }
.products-editor .page-head--inline { margin-bottom: 14px; }
.products-editor .page-title { font-size: 26px; overflow-wrap: anywhere; }
.products-editor .page-meta { gap: 8px 10px; }
.pe-meta__store { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); font-weight: 500; }
.pe-loading .sk-head { margin-bottom: 18px; }
.pe-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
.pe-tabs { margin-bottom: 18px; }
:root.ui-lowfx .pe-tabs { background: var(--surface); }
@media (prefers-reduced-transparency: reduce) { .pe-tabs { background: var(--surface); } }
.ptabs__keys { margin-left: auto; padding: 0 8px 0 12px; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.ptab__dot[hidden] { display: none; }
.pe-flash { margin-bottom: 14px; align-items: flex-start; }
.pe-flash__acts { margin-top: 10px; }
.pe-grid { display: grid; grid-template-columns: minmax(0, 1fr) 356px; gap: 18px; align-items: start; }
.pe-main, .pe-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.pe-card { scroll-margin-top: calc(var(--topbar-h) + 72px); min-width: 0; }
.pe-card .card__title .icon-sm { color: var(--muted); }
.products-editor label .opt-tag { float: right; }
.pe-count.is-over { color: var(--bad-fg); font-weight: 700; }
.pe-short { min-height: 64px; }
.pe-slughint { display: flex; align-items: center; gap: 5px; min-width: 0; }
.pe-slughint a { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pe-slughint a:hover { color: var(--accent-ink); }
.pe-slughint .icon-xs { flex: none; }
.pe-catval { display: inline-flex; gap: 4px; align-items: baseline; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pe-catval strong { color: var(--ink); font-weight: 600; }
.pe-catfoot { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; font-size: 12.5px; color: var(--muted); }
.pe-catfoot a { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--accent-ink); }
.pe-num { font-variant-numeric: tabular-nums; }
.pe-note { margin-top: 10px; font-size: 12.5px; color: var(--muted); }

.pe-status { display: flex; flex-direction: column; gap: 8px; }
.pe-rcard { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--raised); cursor: pointer; transition: border-color var(--dur-1), box-shadow var(--dur-1); }
.pe-rcard:hover { border-color: var(--line-strong); }
.pe-rcard:has(input:checked) { border-color: var(--select); box-shadow: inset 0 0 0 1px var(--select); }
.pe-rcard:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.pe-rcard input:focus-visible { outline: none; }
.pe-rcard__txt { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.pe-rcard__txt strong { font-size: 13.5px; color: var(--ink); font-weight: 600; }
.pe-rcard__txt span { font-size: 12.5px; color: var(--muted); }
.pe-rcard .dot { opacity: 0; }
.pe-rcard:has(input:checked) .dot { opacity: 1; }

.pe-nophoto { display: flex; align-items: center; gap: 12px; padding: 18px; border: 1.5px dashed var(--line-strong); border-radius: 14px; background: var(--surface-2); color: var(--muted); }
.pe-nophoto > span { display: flex; flex-direction: column; gap: 2px; }
.pe-nophoto strong { color: var(--ink); }

.pe-pricebox { padding: 12px; border: 1px dashed var(--line-strong); border-radius: 14px; background: var(--surface-2); }
.pe-pchips { display: flex; flex-wrap: wrap; gap: 8px; }
.pe-pchip { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 11px; border-radius: 10px; background: var(--raised); box-shadow: inset 0 0 0 1px var(--line); font-size: 13px; color: var(--muted); white-space: nowrap; }
.pe-pchip b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.pe-pchip__t { color: var(--ok-fg); font-weight: 600; font-size: 12px; }
.pe-pchip--m { margin-left: auto; background: var(--ok-bg); box-shadow: inset 0 0 0 1px var(--ok-line); color: var(--ok-fg); }
.pe-pchip--m b { color: var(--ok-fg); }
.pe-pchip--m.is-warn { background: var(--warn-bg); box-shadow: inset 0 0 0 1px var(--warn-line); color: var(--warn-fg); }
.pe-pchip--m.is-warn b { color: var(--warn-fg); }
.pe-pchip--m.is-bad { background: var(--bad-bg); box-shadow: inset 0 0 0 1px var(--bad-line); color: var(--bad-fg); }
.pe-pchip--m.is-bad b { color: var(--bad-fg); }
.pe-pnote, .pe-warn { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12.5px; }
.pe-pnote { color: var(--muted); }
.pe-warn { color: var(--warn-fg); font-weight: 600; }
.pe-pricebox > .muted { display: flex; align-items: center; gap: 6px; }
.pe-stockrow { padding-top: 4px; }
.pe-stockhint { display: flex; align-items: center; gap: 10px; align-self: end; min-height: 40px; }

.pe-var { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 12px 14px; align-items: start; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.pe-var + .pe-var { margin-top: 10px; }
.pe-var.is-inactive { background: var(--surface-2); }
.pe-var.is-inactive .pe-var__img { opacity: .6; }
.pe-var__media { position: relative; padding-top: 22px; }
.pe-var__img { display: grid; place-items: center; width: 56px; height: 56px; padding: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--surface-3); color: var(--muted); cursor: pointer; }
.pe-var__img.is-empty { border-style: dashed; border-color: var(--line-strong); }
.pe-var__img:hover { border-color: var(--ink); color: var(--ink); }
.pe-var__img img { width: 100%; height: 100%; object-fit: cover; }
.pe-var__img:disabled { cursor: not-allowed; opacity: .6; }
.pe-var__rmimg { position: absolute; right: -6px; top: 16px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: var(--raised); color: var(--bad-fg); cursor: pointer; box-shadow: var(--sh-1); }
.pe-var__grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, .9fr); gap: 10px 12px; }
.pe-var__grid .field { gap: 5px; }
.pe-var__grid label, .pe-var__grid .label { font-size: 12.5px; }
.pe-var__picker { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.pe-var__color { position: relative; }
.pe-var__active .switch { min-height: 40px; align-items: center; }
.pe-var__tools { display: flex; flex-direction: column; gap: 2px; padding-top: 22px; }
.pe-danger { color: var(--bad-fg); }
.pe-danger:hover { background: var(--bad-bg); color: var(--bad-fg); }
.pe-empty-row { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1px dashed var(--line-strong); border-radius: 12px; color: var(--muted); font-size: 13px; background: var(--surface-2); }
.pe-empty-row .icon-sm { flex: none; }

.pe-dims { display: flex; align-items: center; gap: 8px; }
.pe-dims .input { flex: 1; min-width: 0; text-align: center; }
.pe-dims > span { color: var(--muted); font-weight: 600; }
.pe-spec { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) 104px; gap: 8px; align-items: center; }
.pe-spec + .pe-spec { margin-top: 8px; }
.pe-spec__tools { display: flex; justify-content: flex-end; gap: 2px; }

.pe-serp { padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); font-family: Arial, Helvetica, sans-serif; }
.pe-serp__site { display: flex; align-items: center; gap: 10px; line-height: 1.25; }
.pe-serp__fav { display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); }
.pe-serp__fav img { width: 16px; height: 16px; }
.pe-serp__name { font-size: 14px; color: var(--serp-title); }
.pe-serp__url { font-size: 12px; color: var(--serp-text); overflow-wrap: anywhere; }
.pe-serp__title { margin-top: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 19px; line-height: 1.3; color: var(--serp-link); }
.pe-serp__desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 3px; font-size: 13.5px; line-height: 1.55; color: var(--serp-text); }

/* 3D */
.pe-3d__acts { display: flex; gap: 2px; }
.pe-stage { height: 268px; }
.pe-stage__host { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; }
.pe-stage__host .v3d--embed { min-height: 0; height: 100%; border-radius: inherit; }
.pe-stage__host .v3d__note--embed { display: none !important; }
.pe-stage .stage__pill { left: 10px; right: auto; pointer-events: none; color: #a24a0b; background: rgba(255, 253, 249, 0.94); }
/* o estúdio 3D é claro nos dois temas: a pílula usa as cores do tema claro (5.8:1) */
.pe-stage__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.pe-stage__hint { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.pe-stage__bar { flex-wrap: wrap; }
.pe-stage__views { margin-left: auto; }
.pe-stage__views .seg__b { padding: 0 8px; }
.pe-kindval { width: 22px; height: 22px; border-radius: 7px; display: inline-grid; place-items: center; flex: none; }
.pe-stage__wait { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 100%; padding: 24px; text-align: center; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
.pe-stage__wait strong { color: var(--ink); font-size: 14px; font-weight: 600; }
.pe-stage__wait .icon { width: 30px; height: 30px; color: var(--faint); margin-bottom: 4px; }
.pe-stage.is-waiting .pe-stage__msg { align-items: center; background: transparent; }
.pe-stage.has-msg .stage__pill { display: none; }
.pe-stagewrap:has(.pe-stage.has-msg) .pe-stage__bar { display: none; }
.pe-stagewrap:fullscreen { display: flex; flex-direction: column; padding: 16px; background: var(--bg); }
.pe-stagewrap:fullscreen .pe-stage { flex: 1; height: auto; }
.pe-stage__msg { position: absolute; inset: 0; z-index: 3; display: flex; align-items: flex-end; border-radius: inherit; overflow: hidden; background: var(--surface-2); }
.pe-stage__cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pe-stage__note { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; width: 100%; margin: 10px; padding: 10px 12px; border-radius: 12px; background: var(--raised); box-shadow: var(--sh-pop); font-size: 12.5px; color: var(--text); }
.pe-stage__note a { margin-left: auto; font-weight: 600; }
.pe-kind { margin-top: 14px; }
.pe-swatches { margin-top: 12px; }
.pe-swatches__row { display: flex; flex-wrap: wrap; gap: 10px; padding: 4px 2px; }
.pe-swatches__row .swatch { border: 0; padding: 0; cursor: pointer; }
.pe-glb { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.pe-glb__row { display: flex; align-items: center; gap: 10px; }
.pe-glb__ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--surface-3); color: var(--muted); flex: none; }
.pe-glb__txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pe-glb__txt strong { font-size: 13px; color: var(--ink); font-weight: 600; }
.pe-glb__txt .small { overflow-wrap: anywhere; }

/* Lojas */
.pe-lojas .sel__trigger { min-height: 42px; }
.pe-lojas .sel__value, .pe-sync__to .sel__value { min-width: 0; overflow: hidden; }
.pe-lojas .sel__chips, .pe-sync__to .sel__chips { min-width: 0; overflow: hidden; flex-wrap: nowrap; }
.pe-lojas .chip, .pe-sync__to .chip { flex-shrink: 1; min-width: 0; max-width: 150px; }
.pe-lojas .chip .chip__l, .pe-sync__to .chip .chip__l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-lojas .chip.chip--more, .pe-sync__to .chip.chip--more, .pe-lojas .chip.chip--this { flex-shrink: 0; }
.pe-lojas__sum { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); font-size: 12.5px; line-height: 1.45; color: var(--text); }
.pe-lojas__sum .icon-xs { flex: none; margin-top: 2px; color: var(--muted); }
.pe-lojas__sum b { color: var(--ink); font-weight: 600; }
.pe-lojas__sum.is-warn { background: var(--warn-bg); border-color: var(--warn-line); }
.pe-lojas__sum.is-warn .icon-xs { color: var(--warn-fg); }
.pe-lojas__opts { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line-strong); }
.pe-lojas--new { box-shadow: var(--sh-card), inset 0 3px 0 var(--highlight); }

/* Cópias */
.pe-copies__list { list-style: none; margin: 0; padding: 0 12px 4px; }
.pe-copies__row { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 6px 8px; border-radius: 12px; }
.pe-copies__row + .pe-copies__row { box-shadow: inset 0 1px 0 var(--line); border-radius: 0; }
.pe-copies__row.is-me { background: var(--surface-2); border-radius: 12px; box-shadow: none; }
.pe-copies__row.is-me + .pe-copies__row { box-shadow: none; }
.pe-copies__txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pe-copies__txt strong { font-size: 13.5px; color: var(--ink); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pe-copies__me { font-weight: 500; }
.pe-copies__sub { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pe-copies__out { color: var(--bad-fg); font-weight: 600; }
.pe-copies__sp { width: 32px; flex: none; }
.pe-sync { margin: 4px 16px 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.pe-sync > .label { margin-top: 4px; }
.pe-sync__on { align-items: flex-start; }
.pe-sync__to { margin-top: 2px; }
.pe-sync__to .sel__trigger { width: 100%; }
.pe-copies__more { margin: 2px 16px 6px; }
.pe-sync__go { width: 100%; margin-top: 4px; }
.pe-sync .hint { margin-top: -2px; }
.pe-archline { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
.pe-archline > span:last-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pe-archline strong { color: var(--ink); font-weight: 600; font-size: 13.5px; }

.pe-seals { display: flex; flex-direction: column; gap: 14px; }
.pe-seals .switch__track { margin-top: 1px; }
.pe-cols { display: flex; flex-direction: column; gap: 10px; }
.pe-facts { display: grid; gap: 8px; margin: 0; }
.pe-facts div { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.pe-facts dt { color: var(--muted); }
.pe-facts dd { margin: 0; font-weight: 600; text-align: right; color: var(--ink); }

/* barra de salvar */
.pe-savebar { margin-top: 22px; }
.pe-savebar[hidden] { display: none; }
.pe-savebar .savebar__txt span { max-width: 360px; }
.savebar__parts { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 9px; background: rgba(255, 255, 255, 0.06); color: #fff; font: 600 12.5px/1 var(--font-ui); cursor: pointer; }
.savebar__parts:hover { background: rgba(255, 255, 255, 0.12); }
.savebar__parts:disabled { opacity: .45; cursor: default; }
.pe-sb-m { display: none; }
.is-readonly .pe-rcard { cursor: default; }

/* uma coluna: os cartões da lateral entram na ordem do formulário (3D logo depois das fotos) */
@media (max-width: 1100px) {
  .pe-grid { display: flex; flex-direction: column; align-items: stretch; gap: 18px; }
  .pe-main, .pe-side { display: contents; }
  .pe-o-lojas.pe-lojas--new { order: 0; }
  .pe-o-info { order: 1; }
  .pe-o-status { order: 2; }
  .pe-o-photos { order: 3; }
  .pe-o-3d { order: 4; }
  .pe-o-price { order: 5; }
  .pe-o-variants { order: 6; }
  .pe-o-dims { order: 7; }
  .pe-o-specs { order: 8; }
  .pe-o-lojas { order: 9; }
  .pe-o-copies { order: 10; }
  .pe-o-seals { order: 11; }
  .pe-o-cols { order: 12; }
  .pe-o-seo { order: 13; }
  .pe-o-hist { order: 14; }
  .pe-stage { height: 320px; }
}
@media (max-width: 1279px) { .ptabs__keys { display: none; } }
@media (max-width: 860px) {
  .pe-var__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .pe-var__name { grid-column: span 2; }
}
@media (max-width: 767px) {
  .pl-tb { padding: 12px 14px; }
  .pl-tb__search { flex: 1 1 auto; min-width: 0; max-width: none; }
  .pl-tb__kbd { display: none; }
  .pl-tb__toggle { display: inline-flex; }
  .pl-tb__more { display: none; width: 100%; flex-direction: column; gap: 8px; }
  .pl-tb.is-more .pl-tb__more { display: flex; }
  .pl-tb__more .pl-tb__f, .pl-tb__more .sel__trigger, .pl-tb__more .select { width: 100%; max-width: none; }
  .pl-tb .toolbar__spacer { display: none; }
  .pl-tb__sort { width: 100%; }
  .pl-tb__sort .sel__trigger, .pl-tb__sort .select { width: 100%; max-width: none; }
  .pl-tb__clear { order: 9; }
  .pl-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); }
  .pl-table, .pl-table tbody { display: block; width: 100%; }
  .pl-table tbody tr { position: relative; display: grid; grid-template-columns: auto auto minmax(0, 1fr); grid-template-areas: 'prod prod prod' 'price stock status'; align-items: center; gap: 10px 14px; padding: 14px 52px 14px 14px; border-bottom: 1px solid var(--line); }
  .pl-table tbody tr:last-child { border-bottom: 0; }
  .pl-table td { display: block; height: auto !important; padding: 0 !important; border: 0 !important; text-align: left; }
  .pl-table td.check-col { position: absolute; right: 14px; top: 14px; width: auto; }
  .pl-table td.pl-c-prod { grid-area: prod; width: auto; }
  .pl-table td.pl-c-price { grid-area: price; }
  .pl-table td.pl-c-stock { grid-area: stock; }
  .pl-table td.pl-c-status { grid-area: status; justify-self: end; }
  .pl-table td.pl-c-cat, .pl-table td.pl-c-store, .pl-table td.pl-c-cmp, .pl-table td.pl-c-seals { display: none; }
  .pl-prod { min-width: 0; align-items: flex-start; }
  .pl-prod .thumb { width: 56px; height: 56px; }
  .pl-price { align-items: flex-start; }
  .pl-m-store { display: inline; }
  .pl-results > .empty { min-height: 0; }
  .products-modal .pm-stores { grid-template-columns: minmax(0, 1fr); max-height: none; }
  .products-modal .pm-opts, .products-modal .cf-row { grid-template-columns: minmax(0, 1fr); }
  .products-editor .page-head--inline { padding: 0; }
  .products-editor .page-title { font-size: 21px; }
  .products-editor .crumbs { display: none; }
  .pe-tabs { top: calc(var(--appbar-h, 52px) + env(safe-area-inset-top) + 6px); margin-left: -4px; margin-right: -4px; }
  .pe-hide-sm { display: none; }
  .pe-var { grid-template-columns: 48px minmax(0, 1fr); padding: 12px; gap: 10px 12px; }
  .pe-var__img { width: 48px; height: 48px; }
  .pe-var__tools { grid-column: 1 / -1; flex-direction: row; justify-content: flex-end; padding-top: 0; margin-top: -4px; }
  .pe-var__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .pe-var__name, .pe-var__color { grid-column: span 2; }
  .pe-dims { flex-wrap: nowrap; gap: 6px; }
  .pe-spec { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'l t' 'v t'; gap: 6px 8px; }
  .pe-spec > .field:nth-child(1) { grid-area: l; }
  .pe-spec > .field:nth-child(2) { grid-area: v; }
  .pe-spec__tools { grid-area: t; flex-direction: column; }
  .pe-spec--head { display: none; }
  .pe-spec + .pe-spec { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
  .pe-spec--head + .pe-spec { margin-top: 0; padding-top: 0; border-top: 0; }
  .pe-pchip--m { margin-left: 0; }
  .pe-stockhint { grid-column: span 12; min-height: 0; }
  .pe-stage { height: 280px; }
  .pe-savebar { margin-left: -4px; margin-right: -4px; }
  .pe-savebar .savebar__txt { display: none; }
  .pe-sb-x { display: none !important; }
  .pe-sb-m { display: block; flex: 1; min-width: 0; color: #fff; font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pe-savebar .savebar__acts { margin-left: 0; }
  .pe-savebar [data-save] { height: 44px; padding: 0 16px; }
  .pe-savebar [data-discard] { height: 44px; }
}
@media (max-width: 560px) {
  .products-hide-sm { display: none; }
  .products-dd .menu { position: fixed; top: auto; bottom: calc(12px + var(--tabbar-space, 0px) + env(safe-area-inset-bottom)); left: 12px; right: 12px; min-width: 0; box-shadow: var(--sh-overlay); }
}
`;

export default {
  title: 'Produtos',
  async render(view, ctx) {
    injectStyle('products', CSS);
    const id = ctx.args[0];
    if (id) return renderEditor(view, ctx, id === 'new' ? null : id);
    return renderList(view, ctx);
  },
};
