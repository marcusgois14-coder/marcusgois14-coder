// Produtos: lista (busca, filtros, ordenação, paginação no servidor, ações em lote, CSV) e editor completo.
//
// Rotas:
//   #/products         lista · parâmetros: ?q= ?cat=<uuid>|none ?status=active|draft|archived ?stock=out|low
//                      ?sort=recent|name|price_asc|price_desc|stock|sold ?store=<uuid> (visão da rede) ?page=N
//   #/products/new     novo produto (na visão da rede pede a loja → #/products/new?store=<uuid>)
//   #/products/<id>    editor
//
// Regras: preço = cheio/cartão; a loja mostra o PIX = preço × (1 − pix_discount_pct/100).
// Fotos: ui.imageUploader (pasta stores/<loja>/products). A remoção de arquivos no storage só acontece
// depois de salvar e quando nenhuma outra linha (cópias em outras lojas, variações) usa a mesma URL.
import { sb, q, rpc, mediaUrl, uploadImage, removeImage, storefrontUrl } from '../api.js';
import {
  html, raw, render, $, $$, icon, toast, toastError, money, num, datetime, relTime, slugify, isoDay, PRODUCT_STATUS,
  productStatusBadge, badge, openModal, confirmDialog, showErrors, withBusy, switchField, selectOptions, loading, empty,
  errorBlock, table, pager, toCSV, downloadFile, parseCSV, imageUploader, injectStyle, debounce,
} from '../ui.js';

const PAGE_SIZE = 30;
const EXPORT_LIMIT = 5000;
const LOW_SCAN_LIMIT = 3000;
const LOW_IDS_LIMIT = 400;
const MAX_PHOTOS = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_MONEY = 9999999999;

const LIST_COLS =
  'id,store_id,category_id,name,sku,slug,price,compare_at_price,stock_qty,track_stock,low_stock_threshold,status,is_new,free_shipping,fast_delivery,is_promo,image_url,sold_count,created_at';
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
const STATUS_WORD = { active: 'ativo', draft: 'rascunho', archived: 'arquivado' };
const STATUS_FROM_WORD = { ativo: 'active', active: 'active', rascunho: 'draft', draft: 'draft', arquivado: 'archived', archived: 'archived' };
const STATUS_HINT = {
  active: 'Visível e à venda na loja virtual.',
  draft: 'Oculto da loja enquanto você prepara o cadastro.',
  archived: 'Fora de linha: some da loja e das buscas.',
};
const BULK_DONE = { active: 'ativado(s)', draft: 'movido(s) para rascunho', archived: 'arquivado(s)' };

const SVG = {
  sparkle: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 11l5.6-2z"/><path d="m19 16 .7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  tag: '<path d="M3 12.2V4a1 1 0 0 1 1-1h8.2L21 11.8 11.8 21z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
};
const svg = (name, cls = 'icon') =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name] || ''}</svg>`);

const SEALS = [
  { key: 'is_new', label: 'Lançamento', hint: 'Selo "Novo" no card e destaque em novidades.', icon: () => svg('sparkle', 'icon-sm') },
  { key: 'free_shipping', label: 'Frete grátis', hint: 'Entrega sem custo dentro do raio da loja.', icon: () => icon('truck', 'icon-sm') },
  { key: 'fast_delivery', label: 'Pronta entrega', hint: 'Produto disponível para entrega imediata.', icon: () => svg('bolt', 'icon-sm') },
  { key: 'is_promo', label: 'Promoção', hint: 'Selo de oferta e preço em destaque.', icon: () => svg('tag', 'icon-sm') },
];

// Lembra a última lista (com filtros) para os links "voltar"
let lastListHash = '#/products';
let lastListStore;
// Depois de salvar, o editor é redesenhado com os dados do banco; guarda a rolagem
let keepScroll = null;
let catCache = null;

/* ---------- Utilitários ---------- */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const storeOf = (ctx, id) => ctx.stores.find((s) => s.id === id) || null;
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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\-"' ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  const rx = words.map((w) => w.split('').map((ch) => ACCENTS[ch] || ch).join('')).join('.*');
  return `name.imatch.${rx},sku.ilike.*${words.join('*')}*`;
}

function stockState(p) {
  if (!p.track_stock) return 'untracked';
  if (p.stock_qty <= 0) return 'out';
  if (p.stock_qty <= p.low_stock_threshold) return 'low';
  return 'ok';
}

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

async function loadCategories() {
  if (catCache && Date.now() - catCache.at < 60000) return catCache.cats;
  const list = await q(sb.from('categories').select('id,parent_id,name,slug,sort_order,active').order('sort_order').order('name'));
  catCache = { at: Date.now(), cats: buildCats(list) };
  return catCache.cats;
}

const catOption = (c, text, selected) =>
  html`<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${text}${c.active ? '' : ' (inativa)'}</option>`;

// Filtro da lista: categorias-mãe também filtram as filhas
function categoryFilterOptions(cats, selected) {
  const out = [
    html`<option value="">Todas as categorias</option>`,
    html`<option value="none" ${selected === 'none' ? 'selected' : ''}>Sem categoria</option>`,
  ];
  for (const r of cats.roots) {
    if (cats.isLeaf(r.id)) out.push(catOption(r, r.name, selected));
    else {
      const kids = cats.descendants(r.id).slice(1);
      out.push(html`<optgroup label="${r.name}">
        <option value="${r.id}" ${r.id === selected ? 'selected' : ''}>Tudo em ${r.name}</option>
        ${kids.map((id) => catOption(cats.byId[id], cats.path(id).slice(1).join(' › '), selected))}
      </optgroup>`);
    }
  }
  return out;
}

// Editor: só categorias finais, agrupadas pela categoria-mãe
function categoryLeafOptions(cats, selected) {
  const out = [];
  for (const r of cats.roots) {
    if (cats.isLeaf(r.id)) {
      out.push(catOption(r, r.name, selected));
      continue;
    }
    const all = cats.descendants(r.id).slice(1);
    const ids = all.filter((id) => cats.isLeaf(id) || id === selected);
    if (selected === r.id) ids.unshift(r.id);
    out.push(html`<optgroup label="${r.name}">${ids.map((id) => catOption(cats.byId[id], id === r.id ? `${r.name} (geral)` : cats.path(id).slice(1).join(' › '), selected))}</optgroup>`);
  }
  return out;
}

/* =========================================================
   LISTA
   ========================================================= */
function readListFilters(ctx) {
  const qy = ctx.query || {};
  return {
    q: (qy.q || '').slice(0, 80),
    cat: qy.cat === 'none' || UUID_RE.test(qy.cat || '') ? qy.cat : '',
    status: STATUS_KEYS.includes(qy.status) ? qy.status : '',
    stock: ['out', 'low'].includes(qy.stock) ? qy.stock : '',
    sort: SORTS[qy.sort] ? qy.sort : 'recent',
    store: !ctx.storeId && ctx.stores.some((s) => s.id === qy.store) ? qy.store : '',
    page: Math.max(1, parseInt(qy.page, 10) || 1),
  };
}

function listHash(f) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.store) p.set('store', f.store);
  if (f.cat) p.set('cat', f.cat);
  if (f.status) p.set('status', f.status);
  if (f.stock) p.set('stock', f.stock);
  if (f.sort !== 'recent') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', f.page);
  const s = p.toString();
  return `#/products${s ? `?${s}` : ''}`;
}

const hasFilters = (f) => !!(f.q || f.cat || f.status || f.stock || f.store);

function applyFilters(qb, ctx, f, cats) {
  const storeId = ctx.storeId || f.store;
  if (storeId) qb = qb.eq('store_id', storeId);
  const search = searchFilter(f.q);
  if (search) qb = qb.or(search);
  if (f.cat === 'none') qb = qb.is('category_id', null);
  else if (f.cat && cats.byId[f.cat]) qb = qb.in('category_id', cats.descendants(f.cat));
  if (f.status) qb = qb.eq('status', f.status);
  if (f.stock === 'out') qb = qb.eq('track_stock', true).lte('stock_qty', 0);
  else if (f.stock === 'low') qb = qb.eq('track_stock', true).gt('stock_qty', 0);
  return qb;
}

// "Estoque baixo" compara duas colunas (estoque ≤ alerta), o que a API não filtra:
// busca os candidatos leves e filtra aqui antes da consulta paginada.
async function lowStockIds(ctx, f, cats) {
  const cand = await q(applyFilters(sb.from('products').select('id,stock_qty,low_stock_threshold'), ctx, f, cats).limit(LOW_SCAN_LIMIT));
  const ids = cand.filter((p) => p.stock_qty <= p.low_stock_threshold).map((p) => p.id);
  return { ids: ids.slice(0, LOW_IDS_LIMIT), capped: ids.length > LOW_IDS_LIMIT };
}

async function fetchPage(ctx, f, cats) {
  let ids = null;
  let capped = false;
  if (f.stock === 'low') {
    ({ ids, capped } = await lowStockIds(ctx, f, cats));
    if (!ids.length) return { rows: [], total: 0, capped };
  }
  let qb = applyFilters(sb.from('products').select(LIST_COLS, { count: 'exact' }), ctx, f, cats);
  if (ids) qb = qb.in('id', ids);
  const s = SORTS[f.sort];
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count } = await q(qb.order(s.col, { ascending: s.asc }).order('id').range(from, from + PAGE_SIZE - 1));
  return { rows: data || [], total: count || 0, capped };
}

const thumb = (url, cls = 'thumb') =>
  url
    ? html`<img class="${cls}" src="${mediaUrl(url)}" alt="" loading="lazy">`
    : html`<span class="${cls} pl-thumb--empty" aria-hidden="true">${icon('image', 'icon-sm')}</span>`;

function sealsCell(p) {
  const on = SEALS.filter((s) => p[s.key]);
  if (!on.length) return html`<span class="faint">—</span>`;
  return html`<span class="pl-seals">${on.map(
    (s) => html`<span class="pl-seal pl-seal--${s.key}" role="img" aria-label="${s.label}" title="${s.label}">${s.icon()}</span>`
  )}</span>`;
}

function stockCell(p) {
  const s = stockState(p);
  if (s === 'untracked') return html`<span class="muted small">Não controla</span>`;
  return html`<span class="pl-stock">${num(p.stock_qty)}</span>${
    s === 'out' ? badge('Sem estoque', 'danger') : s === 'low' ? badge('Baixo', 'warning') : ''
  }`;
}

async function renderList(view, ctx) {
  const network = !ctx.storeId;
  const f = readListFilters(ctx);
  if (lastListStore !== undefined && lastListStore !== ctx.storeId) {
    f.page = 1;
    f.store = network ? f.store : '';
  }
  lastListStore = ctx.storeId;
  lastListHash = listHash(f);

  let cats;
  try {
    cats = await loadCategories();
  } catch (e) {
    render(view, errorBlock(e));
    return;
  }

  const selected = new Set();
  let rows = [];
  let total = 0;
  let token = 0;

  ctx.setActions(html`<div class="products-dd">
      <button class="btn" type="button" data-menu="products-csv-menu" aria-haspopup="true" aria-controls="products-csv-menu" aria-label="Planilha CSV: exportar ou importar">
        ${icon('download')}<span class="products-hide-sm">CSV</span>${icon('chevronDown', 'icon-sm')}
      </button>
      <div class="menu" id="products-csv-menu" hidden>
        <button type="button" data-export>${icon('download')} Exportar CSV do filtro atual</button>
        <button type="button" data-import ${network ? 'disabled' : ''}>${icon('upload')} ${network ? 'Importar CSV (escolha uma loja)' : 'Importar CSV'}</button>
        <hr>
        <button type="button" data-template>${icon('download')} Baixar modelo de importação</button>
      </div>
    </div>
    <button class="btn btn--primary" type="button" data-new aria-label="Novo produto">${icon('plus')}<span class="products-hide-sm">Novo produto</span></button>`);
  const actions = $('[data-actions]');
  $('[data-new]', actions)?.addEventListener('click', () => ctx.navigate('#/products/new'));
  $('[data-export]', actions)?.addEventListener('click', () => exportCSV(ctx, f, cats));
  $('[data-template]', actions)?.addEventListener('click', downloadTemplate);
  $('[data-import]', actions)?.addEventListener('click', () => {
    if (!ctx.storeId) return toast('Escolha uma loja no seletor para importar.', 'warning');
    openImport(ctx, cats, () => load());
  });

  render(
    view,
    html`<div class="products-list">
      <form class="toolbar pl-toolbar" data-filters role="search" novalidate>
        <div class="search">
          ${icon('search')}
          <label class="visually-hidden" for="pl-q">Buscar produtos</label>
          <input class="input" id="pl-q" name="q" type="search" value="${f.q}" placeholder="Buscar por nome ou SKU" autocomplete="off" enterkeyhint="search">
        </div>
        ${network
          ? html`<label class="visually-hidden" for="pl-store">Loja</label>
            <select class="select" id="pl-store" name="store"><option value="">Todas as lojas</option>${selectOptions(ctx.stores.map((s) => [s.id, s.name]), f.store)}</select>`
          : ''}
        <label class="visually-hidden" for="pl-cat">Categoria</label>
        <select class="select" id="pl-cat" name="cat">${categoryFilterOptions(cats, f.cat)}</select>
        <label class="visually-hidden" for="pl-status">Status</label>
        <select class="select" id="pl-status" name="status"><option value="">Todos os status</option>${selectOptions(
          STATUS_KEYS.map((k) => [k, PRODUCT_STATUS[k].label]),
          f.status
        )}</select>
        <label class="visually-hidden" for="pl-stock">Estoque</label>
        <select class="select" id="pl-stock" name="stock">${selectOptions(
          [['', 'Todo o estoque'], ['out', 'Sem estoque'], ['low', 'Estoque baixo']],
          f.stock
        )}</select>
        <label class="visually-hidden" for="pl-sort">Ordenar por</label>
        <select class="select" id="pl-sort" name="sort">${selectOptions(
          Object.entries(SORTS).map(([k, s]) => [k, `Ordenar: ${s.label}`]),
          f.sort
        )}</select>
        <button class="btn btn--ghost btn--sm" type="button" data-reset ${hasFilters(f) ? '' : 'hidden'}>Limpar filtros</button>
      </form>
      <div data-bulk hidden></div>
      <div data-results>${loading()}</div>
    </div>`
  );

  const form = $('[data-filters]', view);
  const bulkEl = $('[data-bulk]', view);
  const results = $('[data-results]', view);

  const syncUrl = () => {
    lastListHash = listHash(f);
    history.replaceState(null, '', lastListHash);
    $('[data-reset]', form).hidden = !hasFilters(f);
  };

  function drawBulk() {
    const n = selected.size;
    bulkEl.hidden = !n;
    if (!n) {
      render(bulkEl, '');
    } else {
      render(
        bulkEl,
        html`<div class="pl-bulk" role="region" aria-label="Ações em lote">
          <strong>${plural(n, 'selecionado', 'selecionados')}</strong>
          <button class="btn btn--ghost btn--sm" type="button" data-bulk-clear>Limpar seleção</button>
          <div class="pl-bulk__actions">
            <button class="btn btn--sm" type="button" data-bulk-act="active">${icon('check', 'icon-sm')} Ativar</button>
            <button class="btn btn--sm" type="button" data-bulk-act="draft">${icon('edit', 'icon-sm')} Mover para rascunho</button>
            <button class="btn btn--sm" type="button" data-bulk-act="archived">${icon('box', 'icon-sm')} Arquivar</button>
            <button class="btn btn--sm" type="button" data-bulk-act="price">${svg('percent', 'icon-sm')} Ajustar preço</button>
            <button class="btn btn--sm" type="button" data-bulk-act="duplicate">${icon('copy', 'icon-sm')} Duplicar para outras lojas</button>
            <button class="btn btn--sm btn--danger" type="button" data-bulk-act="delete">${icon('trash', 'icon-sm')} Excluir</button>
          </div>
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
    const columns = [
      {
        label: html`<input type="checkbox" data-check-all aria-label="Selecionar todos os produtos desta página">`,
        cls: 'check-col',
        render: (p) => html`<input type="checkbox" data-check="${p.id}" aria-label="Selecionar ${p.name}" ${selected.has(p.id) ? 'checked' : ''}>`,
      },
      { label: html`<span class="visually-hidden">Foto</span>`, cls: 'pl-thumb-col', render: (p) => thumb(p.image_url) },
      {
        label: 'Produto',
        render: (p) => html`<a class="pl-name" href="#/products/${p.id}">${p.name}</a><span class="pl-sku mono">${p.sku || 'sem SKU'}</span>`,
      },
      {
        label: 'Categoria',
        render: (p) =>
          p.category_id && cats.byId[p.category_id]
            ? html`<span class="small pl-cat">${cats.label(p.category_id)}</span>`
            : html`<span class="faint small">Sem categoria</span>`,
      },
      network && { label: 'Loja', render: (p) => html`<span class="small pl-store">${ctx.storeName(p.store_id)}</span>` },
      {
        label: 'Preço',
        cls: 'num',
        render: (p) => {
          const store = storeOf(ctx, p.store_id);
          return html`<strong>${money(p.price)}</strong>${
            storeHasPix(store) ? html`<span class="pl-pix">${money(pixPrice(p.price, store))} no PIX</span>` : ''
          }`;
        },
      },
      {
        label: 'Preço "de"',
        cls: 'num',
        render: (p) => (p.compare_at_price ? html`<s class="muted">${money(p.compare_at_price)}</s>` : html`<span class="faint">—</span>`),
      },
      { label: 'Estoque', cls: 'num', render: stockCell },
      { label: 'Status', render: (p) => productStatusBadge(p.status) },
      { label: 'Selos', render: sealsCell },
    ].filter(Boolean);

    const filtered = hasFilters(f);
    render(
      results,
      html`<div class="pl-summary muted small" aria-live="polite">${plural(total, 'produto', 'produtos')}${
        capped ? ` · mostrando os ${LOW_IDS_LIMIT} primeiros com estoque baixo` : ''
      }</div>
      ${rows.length
        ? table({ columns, rows, rowAttrs: (p) => `data-row="${p.id}" class="is-clickable"` })
        : html`<div class="table-wrap">${
            filtered
              ? empty('Nenhum produto encontrado', 'Ajuste a busca ou os filtros.', html`<button class="btn btn--sm" type="button" data-reset-empty>Limpar filtros</button>`)
              : empty(
                  'Nenhum produto cadastrado',
                  network ? 'Cadastre o primeiro produto em uma das lojas.' : 'Cadastre o primeiro produto desta loja ou importe uma planilha CSV.',
                  html`<button class="btn btn--primary btn--sm" type="button" data-new-empty>${icon('plus', 'icon-sm')} Novo produto</button>`
                )
          }</div>`}
      ${total > PAGE_SIZE ? pager({ page: f.page, pageSize: PAGE_SIZE, total }) : ''}`
    );
    drawBulk();
  }

  async function load() {
    const my = ++token;
    selected.clear();
    drawBulk();
    render(results, loading());
    try {
      const res = await fetchPage(ctx, f, cats);
      if (my !== token) return;
      rows = res.rows;
      total = res.total;
      if (!rows.length && total && f.page > 1) {
        f.page = Math.max(1, Math.ceil(total / PAGE_SIZE));
        syncUrl();
        return load();
      }
      drawResults(res.capped);
    } catch (e) {
      if (my !== token) return;
      if (e.raw?.code === 'PGRST103' && f.page > 1) {
        f.page = 1;
        syncUrl();
        return load();
      }
      render(results, errorBlock(e));
    }
  }

  const reload = () => {
    f.page = 1;
    syncUrl();
    load();
  };
  const onSearch = debounce(() => {
    f.q = form.q.value.trim().slice(0, 80);
    reload();
  }, 350);
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') onSearch();
  });
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (!name || name === 'q') return;
    f[name] = value;
    reload();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    f.q = form.q.value.trim().slice(0, 80);
    reload();
  });
  const resetFilters = () => {
    Object.assign(f, { q: '', cat: '', status: '', stock: '', store: '' });
    form.reset();
    form.q.value = '';
    $$('select', form).forEach((s) => (s.value = s.name === 'sort' ? f.sort : ''));
    reload();
  };
  $('[data-reset]', form).addEventListener('click', resetFilters);

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

  view.addEventListener('click', async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      f.page = Number(pg.dataset.page);
      syncUrl();
      load();
      view.scrollIntoView({ block: 'start' });
      return;
    }
    if (e.target.closest('[data-reset-empty]')) return resetFilters();
    if (e.target.closest('[data-new-empty]')) return ctx.navigate('#/products/new');
    if (e.target.closest('[data-bulk-clear]')) {
      selected.clear();
      $$('[data-check]', results).forEach((c) => (c.checked = false));
      drawBulk();
      return;
    }
    const act = e.target.closest('[data-bulk-act]');
    if (act) return bulkAction(act.dataset.bulkAct, act);
    const tr = e.target.closest('tr[data-row]');
    if (tr && !e.target.closest('a, button, input, label, select')) ctx.navigate(`#/products/${tr.dataset.row}`);
  });

  async function bulkAction(kind, btn) {
    const ids = [...selected];
    const items = rows.filter((r) => selected.has(r.id));
    if (!ids.length) return;
    if (STATUS_KEYS.includes(kind)) {
      try {
        const done = await withBusy(btn, () => q(sb.from('products').update({ status: kind, updated_by: ctx.user.id }).in('id', ids).select('id')));
        toast(`${plural(done.length, 'produto', 'produtos')} ${BULK_DONE[kind]}.`, 'success');
        load();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (kind === 'delete') {
      const ok = await confirmDialog({
        title: 'Excluir produtos',
        message: `Excluir ${plural(ids.length, 'produto', 'produtos')}? Fotos, variações e vínculos com coleções também serão removidos. Pedidos já feitos mantêm nome e preço. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
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
        });
        load();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (kind === 'price') return openPriceAdjust(ctx, items, () => load());
    if (kind === 'duplicate') return openDuplicate(ctx, { products: items, onDone: (r) => r.created && load() });
  }

  load();
}

/* ---------- Ajuste de preço em lote ---------- */
function openPriceAdjust(ctx, items, onDone) {
  openModal({
    title: `Ajustar preço de ${plural(items.length, 'produto', 'produtos')}`,
    body: html`<form class="products-modal stack" data-pa novalidate>
      <div class="field">
        <label for="pa-pct">Percentual de ajuste *</label>
        <div class="input-group"><input class="input" id="pa-pct" name="pct" inputmode="decimal" placeholder="Ex.: 10 ou -15" autocomplete="off" autofocus><span class="input-group__addon">%</span></div>
        <span class="hint">Positivo aumenta, negativo reduz (−10 = 10% mais barato).</span>
      </div>
      <label class="check"><input type="checkbox" name="round" checked> Arredondar para final ,90 (ex.: R$ 2.749,90)</label>
      <label class="check"><input type="checkbox" name="compare"> Aplicar também ao preço "de" (riscado)</label>
      <div data-pa-preview></div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-pa-apply>Aplicar</button>`,
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
          render(prev, html`<p class="muted small">Digite o percentual para ver a prévia.</p>`);
          return;
        }
        const show = items.slice(0, 6);
        render(
          prev,
          html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Produto</th><th class="num">Atual</th><th class="num">Novo</th></tr></thead>
            <tbody>${show.map((p) => {
              const np = calc(p.price, pct, round);
              const nc = compare ? calc(p.compare_at_price, pct, round) : p.compare_at_price;
              return html`<tr><td><span class="pa-name">${p.name}</span>${
                compare && p.compare_at_price ? html`<span class="muted small">"de" ${money(p.compare_at_price)} → ${money(nc)}</span>` : ''
              }</td><td class="num">${money(p.price)}</td><td class="num"><strong>${money(np)}</strong></td></tr>`;
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

/* ---------- Duplicar (lote e editor) ---------- */
// Cópia dentro da mesma loja (a função duplicate_products só copia para outras lojas)
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
  const { id, created_at, updated_at, sold_count, image_url, image2_url, created_by, updated_by, ...rest } = p;
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

function openDuplicate(ctx, { products, includeSame = false, onDone = () => {} }) {
  const sources = new Set(products.map((p) => p.store_id));
  const stores = ctx.stores.filter((s) => ctx.can('catalog', s.id));
  const single = products.length === 1;
  openModal({
    title: single ? 'Duplicar produto' : `Duplicar ${plural(products.length, 'produto', 'produtos')}`,
    body: html`<div class="products-modal stack" data-dup>
      ${single ? html`<p><strong>${products[0].name}</strong></p>` : ''}
      <p class="muted">As cópias entram como <strong>rascunho</strong> e com estoque zerado, mantendo fotos, variações e especificações. Se o endereço já existir na loja de destino, ganha um sufixo (-2, -3…).</p>
      <div class="row row--between"><span class="label">Lojas de destino</span>
        <button class="btn btn--ghost btn--sm" type="button" data-dup-all>Marcar todas</button></div>
      <div class="pm-stores" role="group" aria-label="Lojas de destino">${stores.map((s) => {
        const origin = sources.size === 1 && sources.has(s.id);
        return html`<label class="check"><input type="checkbox" value="${s.id}" data-dup-target ${origin && !includeSame ? 'disabled' : ''}>
          <span>${s.name}${origin ? html` <span class="faint small">${includeSame ? '(esta loja: cria uma cópia)' : '(origem)'}</span>` : ''}</span></label>`;
      })}</div>
      <div data-dup-result></div>
    </div>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-dup-ok>${icon('copy')} Duplicar</button>`,
    onMount(el, close) {
      $('[data-dup-all]', el).addEventListener('click', () => {
        const boxes = $$('[data-dup-target]:not(:disabled)', el);
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => (b.checked = !all));
      });
      $('[data-dup-ok]', el).addEventListener('click', async (e) => {
        const targets = $$('[data-dup-target]:checked', el).map((b) => b.value);
        if (!targets.length) return toast('Marque pelo menos uma loja de destino.', 'warning');
        const same = includeSame ? targets.filter((t) => sources.has(t)) : [];
        const others = targets.filter((t) => !same.includes(t));
        let res = { created: 0, skipped: 0 };
        let copyId = null;
        try {
          await withBusy(e.currentTarget, async () => {
            if (others.length) res = await rpc('duplicate_products', { p_ids: products.map((p) => p.id), p_targets: others, p_status: 'draft' });
            if (same.length) copyId = await duplicateInStore(products[0].id, ctx.user.id);
          });
        } catch (err) {
          toastError(err);
          return;
        }
        const created = (res?.created || 0) + (copyId ? 1 : 0);
        const skipped = res?.skipped || 0;
        toast(`${plural(created, 'cópia criada', 'cópias criadas')}${skipped ? ` · ${skipped} ignorada(s)` : ''}.`, 'success');
        render(
          $('[data-dup-result]', el),
          html`<div class="alert alert--success">${icon('check')}<div>
            <strong>${plural(created, 'cópia criada', 'cópias criadas')} como rascunho.</strong>
            ${skipped ? html`<br>${plural(skipped, 'cópia ignorada', 'cópias ignoradas')}: o produto já é da loja de destino.` : ''}
            ${copyId ? html`<br>A cópia nesta loja já pode ser editada.` : ''}
          </div></div>`
        );
        $$('[data-dup-target]', el).forEach((b) => (b.disabled = true));
        $('[data-dup-all]', el).hidden = true;
        render(
          $('.modal__foot', el),
          html`<button class="btn" type="button" data-close>Fechar</button>
          ${copyId ? html`<button class="btn btn--primary" type="button" data-dup-open>${icon('edit')} Abrir cópia</button>` : ''}`
        );
        $('[data-dup-open]', el)?.addEventListener('click', () => {
          close();
          ctx.navigate(`#/products/${copyId}`);
        });
        onDone({ created, skipped, copyId });
      });
    },
  });
}

/* ---------- CSV: exportar ---------- */
async function exportCSV(ctx, f, cats) {
  const network = !ctx.storeId;
  toast('Gerando CSV…');
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
    title: 'Importar produtos (CSV)',
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
            <p>Cadastre ou atualize produtos da loja <strong>${store.name}</strong> com uma planilha. Cada linha é identificada pelo <strong>SKU</strong>: se já existir na loja, o produto é atualizado; se não, é criado.</p>
            <div class="pi-cols" aria-label="Colunas do arquivo">${IMPORT_COLUMNS.map((c) => html`<code>${c}</code>`)}</div>
            <ul class="pi-rules small muted">
              <li>Separado por ponto e vírgula (;), como o Excel em português. Preços no formato 2499,90.</li>
              <li>Células vazias mantêm o valor atual do produto. Produtos novos entram como rascunho se o status ficar vazio.</li>
              <li><strong>status</strong>: ativo, rascunho ou arquivado · <strong>categoria</strong>: nome ou slug (ex.: Sofás).</li>
              <li><strong>imagem</strong> (opcional): link da foto de capa. As demais fotos do produto são mantidas.</li>
            </ul>
            <div><button class="btn btn--sm" type="button" data-pi-template>${icon('download', 'icon-sm')} Baixar modelo</button></div>
            <div class="field"><label for="pi-file">Arquivo CSV</label><input class="input" id="pi-file" type="file" accept=".csv,text/csv,text/plain" data-pi-file></div>
            ${message ? html`<div class="alert alert--danger">${icon('alert')}<div>${message}</div></div>` : ''}
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
            <div class="row" style="--gap:6px">
              ${badge(plural(n.create, 'novo', 'novos'), 'success')}
              ${badge(plural(n.update, 'atualização', 'atualizações'), 'info')}
              ${n.same ? badge(plural(n.same, 'sem mudanças', 'sem mudanças')) : ''}
              ${n.error ? badge(plural(n.error, 'com erro', 'com erro'), 'danger') : ''}
            </div>
            <p class="small muted">${fileName} · ${plural(plan.rows.length, 'linha', 'linhas')}. ${n.error ? 'Linhas com erro não serão importadas.' : ''}</p>
            <div class="table-wrap pi-table"><table class="table">
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
            <div class="meter"><span style="width:${Math.round((done / Math.max(1, all)) * 100)}%"></span></div></div>`
          );
        progress(0, total);
        const res = await runPlan(plan, store.id, ctx.user.id, progress);
        finished = true;
        render(
          body,
          html`<div class="stack">
            <div class="alert ${res.failed.length ? 'alert--warning' : 'alert--success'}">${icon(res.failed.length ? 'alert' : 'check')}<div>
              <strong>Importação concluída.</strong><br>
              ${plural(res.created, 'produto criado', 'produtos criados')} · ${plural(res.updated, 'produto atualizado', 'produtos atualizados')}${
                plan.n.error ? ` · ${plural(plan.n.error, 'linha ignorada', 'linhas ignoradas')} por erro` : ''
              }${res.failed.length ? ` · ${plural(res.failed.length, 'falha', 'falhas')}` : ''}.
              ${res.created ? html`<br><span class="small">Revise fotos e detalhes dos produtos novos antes de ativá-los.</span>` : ''}
            </div></div>
            ${res.failed.length
              ? html`<div class="table-wrap pi-table"><table class="table"><thead><tr><th>Linha</th><th>SKU</th><th>Erro</th></tr></thead>
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
    weight_kg: null, warranty: '', seo_title: '', seo_description: '', specs: [],
  };
}

const moneyField = (label, name, value, { cls = 'col-4', hint = '', required = false } = {}) =>
  html`<div class="field ${cls}">
    <label for="pe-${name}">${label}${required ? ' *' : ''}</label>
    <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="pe-${name}" name="${name}" value="${moneyInput(value)}" inputmode="decimal" autocomplete="off" placeholder="0,00" ${required ? 'required' : ''}></div>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;

const unitField = (label, name, value, unit, cls = 'col-3') =>
  html`<div class="field ${cls}">
    <label for="pe-${name}">${label}</label>
    <div class="input-group"><input class="input" id="pe-${name}" name="${name}" value="${numInput(value)}" inputmode="decimal" autocomplete="off"><span class="input-group__addon">${unit}</span></div>
  </div>`;

const counter = (name, max) => html`<span class="pe-count" data-count="${name}" data-max="${max}" aria-live="polite"></span>`;

function renderStorePick(view, ctx) {
  const stores = ctx.stores.filter((s) => ctx.can('catalog', s.id));
  ctx.setTitle('Novo produto', 'Toda a rede');
  render(
    view,
    html`<div class="products-editor"><div class="card"><div class="card__body stack">
      <div><div class="h2">Em qual loja cadastrar?</div>
      <p class="muted mt-1">Cada loja tem o próprio catálogo. Depois de salvar, você pode duplicar o produto para outras lojas.</p></div>
      <div class="grid grid-3">${stores.map(
        (s) => html`<a class="btn pe-storepick" href="#/products/new?store=${s.id}">${icon('store')}<span><strong>${s.name}</strong><br><span class="muted small">${s.city}</span></span></a>`
      )}</div>
      <div><a class="btn btn--ghost btn--sm" href="${lastListHash}">${icon('chevronLeft', 'icon-sm')} Voltar para produtos</a></div>
    </div></div></div>`
  );
}

function renderOtherStore(view, ctx, product) {
  const canSwitch = ctx.stores.some((s) => s.id === product.store_id);
  render(
    view,
    html`<div class="products-editor"><div class="card"><div class="card__body stack">
      <div class="alert alert--warning">${icon('alert')}<div>O produto <strong>${product.name}</strong> é da loja <strong>${ctx.storeName(product.store_id)}</strong>, diferente da loja selecionada (${ctx.store?.name}).</div></div>
      <div class="row">
        <a class="btn" href="#/products">${icon('chevronLeft', 'icon-sm')} Produtos de ${ctx.store?.name}</a>
        ${canSwitch ? html`<button class="btn btn--primary" type="button" data-switch>${icon('store')} Abrir em ${ctx.storeName(product.store_id)}</button>` : ''}
      </div>
    </div></div></div>`
  );
  $('[data-switch]', view)?.addEventListener('click', () => ctx.setStore(product.store_id, `#/products/${product.id}`));
}

async function renderEditor(view, ctx, id) {
  const isNew = !id;
  const notFound = () =>
    render(
      view,
      html`<div class="products-editor"><div class="card">${empty('Produto não encontrado', 'Ele pode ter sido excluído ou pertencer a uma loja à qual você não tem acesso.', html`<a class="btn btn--sm" href="${lastListHash}">Voltar para produtos</a>`)}</div></div>`
    );
  if (!isNew && !UUID_RE.test(id)) return notFound();

  let product = null;
  let storeId;
  let cats;
  let images;
  let variants;
  let collections;
  let links;
  try {
    if (!isNew) {
      product = await q(sb.from('products').select('*').eq('id', id).maybeSingle());
      if (!product) return notFound();
      storeId = product.store_id;
      if (ctx.storeId && ctx.storeId !== storeId) return renderOtherStore(view, ctx, product);
    } else {
      storeId = ctx.storeId || (ctx.stores.some((s) => s.id === ctx.query.store && ctx.can('catalog', s.id)) ? ctx.query.store : null);
      if (!storeId) return renderStorePick(view, ctx);
    }
    [cats, images, variants, collections, links] = await Promise.all([
      loadCategories(),
      isNew ? [] : q(sb.from('product_images').select('id,url,sort_order').eq('product_id', id).order('sort_order').order('created_at')),
      isNew ? [] : q(sb.from('product_variants').select('*').eq('product_id', id).order('sort_order').order('created_at')),
      q(sb.from('collections').select('id,key,title,active,sort_order').eq('store_id', storeId).order('sort_order').order('title')),
      isNew ? [] : q(sb.from('collection_items').select('collection_id').eq('product_id', id)),
    ]);
  } catch (e) {
    render(view, errorBlock(e));
    return;
  }

  const store = storeOf(ctx, storeId) || { id: storeId, name: ctx.storeName(storeId) };
  const canEdit = ctx.can('catalog', storeId);
  const p = product ? { ...product } : defaults(storeId);
  let pid = product?.id || null;
  ctx.setTitle(isNew ? 'Novo produto' : 'Editar produto', store.name);

  let seq = 0;
  const nextKey = () => `k${(seq += 1)}`;
  const st = {
    variants: variants.map((v) => ({
      key: nextKey(), id: v.id, name: v.name || '', color: v.color || '', image_url: v.image_url || '', sku: v.sku || '',
      price: moneyInput(v.price_override), stock: v.stock_qty === null ? '' : String(v.stock_qty), active: v.active,
    })),
    specs: (Array.isArray(p.specs) ? p.specs : []).map((s) => ({ key: nextKey(), label: String(s?.label ?? ''), value: String(s?.value ?? '') })),
    collections: new Set(links.map((l) => l.collection_id)),
  };
  const orig = {
    images: images.map((i) => i.url),
    variants: Object.fromEntries(variants.map((v) => [v.id, v])),
    variantImages: variants.map((v) => v.image_url).filter(Boolean),
    collections: new Set(st.collections),
  };
  const sessionUploads = new Set();
  let slugTouched = !isNew && !!p.slug;
  let leaving = false;
  let saving = false;
  let savedSnap = '';
  const viewHref = () => productUrl(store, $('[name="slug"]', view)?.value.trim() || p.slug);

  render(
    view,
    html`<form class="products-editor" data-form novalidate>
      <div class="pe-head">
        <a class="btn btn--ghost btn--sm" href="${lastListHash}">${icon('chevronLeft', 'icon-sm')} Produtos</a>
        <div class="pe-head__title">
          <div class="h1 pe-head__name" data-head-name>${p.name || 'Novo produto'}</div>
          <div class="row pe-head__meta" style="--gap:8px">
            <span class="muted small pe-head__store">${icon('store', 'icon-sm')} ${store.name}</span>
            <span data-head-status>${productStatusBadge(p.status)}</span>
          </div>
        </div>
        ${!isNew
          ? html`<div class="pe-head__actions">
              <a class="btn" href="${productUrl(store, p.slug)}" target="_blank" rel="noopener" data-view-store aria-label="Ver na loja (abre em nova aba)">${icon('external')}<span class="products-hide-sm">Ver na loja</span></a>
              ${canEdit
                ? html`<button class="btn" type="button" data-duplicate aria-label="Duplicar produto">${icon('copy')}<span class="products-hide-sm">Duplicar</span></button>
                  <button class="btn btn--danger" type="button" data-delete aria-label="Excluir produto">${icon('trash')}<span class="products-hide-sm">Excluir</span></button>`
                : ''}
            </div>`
          : ''}
      </div>
      ${!canEdit ? html`<div class="alert alert--warning mb-3">${icon('alert')}<div>Você pode ver este produto, mas não tem permissão para editar o catálogo desta loja.</div></div>` : ''}

      <fieldset class="pe-fields" ${canEdit ? '' : 'disabled'}>
        <legend class="visually-hidden">Dados do produto</legend>
        <div class="split pe-split">
          <div class="stack pe-main">
            <section class="card" aria-labelledby="pe-h-info">
              <div class="card__head"><h2 class="h2" id="pe-h-info">Informações</h2></div>
              <div class="card__body form-grid">
                <div class="field col-12">
                  <label for="pe-name">Nome do produto *</label>
                  <input class="input" id="pe-name" name="name" value="${p.name}" maxlength="200" required autocomplete="off" placeholder="Ex.: Sofá 3 Lugares Retrô 210 cm - Veludo Verde">
                </div>
                <div class="field col-12">
                  <label for="pe-slug">Endereço na loja (slug) *</label>
                  <div class="input-group"><span class="input-group__addon">?produto=</span><input class="input mono" id="pe-slug" name="slug" value="${p.slug}" maxlength="120" required autocomplete="off" spellcheck="false" autocapitalize="off"></div>
                  <span class="hint" data-slug-hint></span>
                </div>
                <div class="field col-4"><label for="pe-sku">SKU / código</label><input class="input mono" id="pe-sku" name="sku" value="${p.sku}" maxlength="60" autocomplete="off" spellcheck="false"></div>
                <div class="field col-4"><label for="pe-brand">Marca</label><input class="input" id="pe-brand" name="brand" value="${p.brand}" maxlength="120" autocomplete="off"></div>
                <div class="field col-4"><label for="pe-category">Categoria</label>
                  <select class="select" id="pe-category" name="category_id"><option value="">Sem categoria</option>${categoryLeafOptions(cats, p.category_id)}</select></div>
                <div class="field col-12">
                  <div class="pe-labelrow"><label for="pe-short">Descrição curta</label>${counter('short_description', 200)}</div>
                  <textarea class="textarea pe-short" id="pe-short" name="short_description" rows="2" maxlength="400">${p.short_description}</textarea>
                  <span class="hint">Resumo exibido perto do preço.</span>
                </div>
                <div class="field col-12">
                  <label for="pe-desc">Descrição completa</label>
                  <textarea class="textarea" id="pe-desc" name="description" rows="7">${p.description}</textarea>
                  <span class="hint">Separe os parágrafos com uma quebra de linha.</span>
                </div>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-photos">
              <div class="card__head"><h2 class="h2" id="pe-h-photos">Fotos</h2><span class="muted small" data-photo-count></span></div>
              <div class="card__body">
                <div data-photos></div>
                <p class="hint small muted mt-2">Arraste para reordenar: a primeira é a capa. JPG, PNG ou WebP, até ${MAX_PHOTOS} fotos (otimizadas no envio).</p>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-price">
              <div class="card__head"><h2 class="h2" id="pe-h-price">Preços</h2></div>
              <div class="card__body form-grid">
                ${moneyField('Preço', 'price', p.price, { required: true, hint: 'Preço cheio, no cartão.' })}
                ${moneyField('Preço "de" (riscado)', 'compare_at_price', p.compare_at_price, { hint: 'Opcional, aparece riscado.' })}
                ${moneyField('Custo interno', 'cost_price', p.cost_price, { hint: 'Não aparece na loja.' })}
                <div class="col-12 pe-pricebox" data-price-preview aria-live="polite"></div>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-stock">
              <div class="card__head"><h2 class="h2" id="pe-h-stock">Estoque</h2><span data-stock-badge></span></div>
              <div class="card__body form-grid">
                <div class="col-12">${switchField({ label: 'Controlar estoque', name: 'track_stock', checked: p.track_stock, hint: 'Ao zerar, o produto aparece como esgotado na loja. Desligado: nunca esgota.' })}</div>
                <div class="field col-6"><label for="pe-stock">Quantidade em estoque</label><input class="input" id="pe-stock" name="stock_qty" type="number" step="1" inputmode="numeric" value="${p.stock_qty}"></div>
                <div class="field col-6"><label for="pe-low">Alerta de estoque baixo</label><input class="input" id="pe-low" name="low_stock_threshold" type="number" min="0" step="1" inputmode="numeric" value="${p.low_stock_threshold}">
                  <span class="hint">Marca como "estoque baixo" ao chegar nesta quantidade.</span></div>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-var">
              <div class="card__head">
                <div><h2 class="h2" id="pe-h-var">Variações</h2><p class="muted small">Cores, tamanhos ou acabamentos. Preço e estoque em branco usam os do produto.</p></div>
                <button class="btn btn--sm" type="button" data-var-add>${icon('plus', 'icon-sm')} Adicionar</button>
              </div>
              <div class="card__body" data-variants></div>
            </section>

            <section class="card" aria-labelledby="pe-h-specs">
              <div class="card__head">
                <div><h2 class="h2" id="pe-h-specs">Especificações</h2><p class="muted small">Tabela de características na página do produto.</p></div>
                <button class="btn btn--sm" type="button" data-spec-add>${icon('plus', 'icon-sm')} Adicionar</button>
              </div>
              <div class="card__body" data-specs></div>
            </section>

            <section class="card" aria-labelledby="pe-h-dims">
              <div class="card__head"><h2 class="h2" id="pe-h-dims">Medidas e garantia</h2></div>
              <div class="card__body form-grid pe-dims">
                ${unitField('Largura', 'width_cm', p.width_cm, 'cm')}
                ${unitField('Altura', 'height_cm', p.height_cm, 'cm')}
                ${unitField('Profundidade', 'depth_cm', p.depth_cm, 'cm')}
                ${unitField('Peso', 'weight_kg', p.weight_kg, 'kg')}
                <div class="field col-6"><label for="pe-warranty">Garantia</label><input class="input" id="pe-warranty" name="warranty" value="${p.warranty}" maxlength="120" placeholder="Ex.: 12 meses"></div>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-seo">
              <div class="card__head"><div><h2 class="h2" id="pe-h-seo">SEO</h2><p class="muted small">Como o produto aparece no Google. Em branco, usa o nome e a descrição curta.</p></div></div>
              <div class="card__body form-grid">
                <div class="field col-12">
                  <div class="pe-labelrow"><label for="pe-seo-title">Título da página</label>${counter('seo_title', 60)}</div>
                  <input class="input" id="pe-seo-title" name="seo_title" value="${p.seo_title}" maxlength="120" autocomplete="off">
                </div>
                <div class="field col-12">
                  <div class="pe-labelrow"><label for="pe-seo-desc">Descrição</label>${counter('seo_description', 160)}</div>
                  <textarea class="textarea" id="pe-seo-desc" name="seo_description" rows="3" maxlength="320">${p.seo_description}</textarea>
                </div>
                <div class="col-12"><div class="label mb-2">Prévia no Google</div><div class="pe-serp" data-serp aria-hidden="true"></div></div>
              </div>
            </section>
          </div>

          <aside class="stack pe-side">
            <section class="card" aria-labelledby="pe-h-status">
              <div class="card__head"><h2 class="h2" id="pe-h-status">Status</h2></div>
              <div class="card__body">
                <div class="pe-status" role="radiogroup" aria-labelledby="pe-h-status">${STATUS_KEYS.map(
                  (k) => html`<label class="pe-status__opt"><input type="radio" name="status" value="${k}" ${p.status === k ? 'checked' : ''}>
                    <span><strong>${PRODUCT_STATUS[k].label}</strong><br><span class="muted small">${STATUS_HINT[k]}</span></span></label>`
                )}</div>
                <p class="small muted mt-2" data-status-note></p>
              </div>
            </section>

            <section class="card" aria-labelledby="pe-h-seals">
              <div class="card__head"><h2 class="h2" id="pe-h-seals">Selos</h2></div>
              <div class="card__body pe-seals">${SEALS.map((s) => switchField({ label: s.label, name: s.key, checked: p[s.key], hint: s.hint }))}</div>
            </section>

            <section class="card" aria-labelledby="pe-h-cols">
              <div class="card__head"><h2 class="h2" id="pe-h-cols">Coleções da vitrine</h2></div>
              <div class="card__body">${
                collections.length
                  ? html`<div class="pe-cols" role="group" aria-labelledby="pe-h-cols">${collections.map(
                      (c) => html`<label class="check"><input type="checkbox" data-collection value="${c.id}" ${st.collections.has(c.id) ? 'checked' : ''}>
                        <span>${c.title}${c.active ? '' : html` <span class="faint small">(inativa)</span>`}</span></label>`
                    )}</div>`
                  : html`<p class="muted small">Esta loja ainda não tem coleções. Crie em <a href="#/showcase">Vitrine e banners</a>.</p>`
              }</div>
            </section>

            ${!isNew
              ? html`<section class="card" aria-labelledby="pe-h-hist">
                  <div class="card__head"><h2 class="h2" id="pe-h-hist">Histórico</h2></div>
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
        ? html`<div class="pe-savebar">
            <span class="pe-savebar__state small" data-dirty-label>Nenhuma alteração</span>
            <button class="btn" type="button" data-save-back>Salvar e voltar</button>
            <button class="btn btn--primary" type="submit" data-save>${icon('check')} ${isNew ? 'Criar produto' : 'Salvar'}</button>
          </div>`
        : ''}
    </form>`
  );

  const form = $('[data-form]', view);
  const E = form.elements;
  const varEl = $('[data-variants]', form);
  const specEl = $('[data-specs]', form);
  const photosEl = $('[data-photos]', form);

  /* ----- Fotos ----- */
  const onPhotos = (urls) => {
    urls.forEach((u) => {
      if (/^https?:/.test(u) && !orig.images.includes(u)) sessionUploads.add(u);
    });
    drawPhotoCount(urls);
    markDirty();
  };
  // A remoção do ui.imageUploader apaga o arquivo na hora; aqui ela só tira da lista
  // (o arquivo sai do storage ao salvar, se nada mais o usar).
  photosEl.addEventListener(
    'click',
    (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm || !photosEl.contains(rm)) return;
      e.stopPropagation();
      e.preventDefault();
      const urls = uploader.value;
      urls.splice(Number(rm.dataset.remove), 1);
      uploader.set(urls);
      onPhotos(urls);
    },
    true
  );
  const uploader = canEdit
    ? imageUploader(photosEl, { value: orig.images, scope: { storeId }, folder: 'products', max: MAX_PHOTOS, onChange: onPhotos, label: 'Adicionar fotos' })
    : (() => {
        render(photosEl, orig.images.length ? html`<div class="uploader">${orig.images.map((u) => html`<div class="uploader__item"><img src="${mediaUrl(u)}" alt=""></div>`)}</div>` : html`<p class="muted small">Sem fotos.</p>`);
        return { value: [...orig.images], set() {} };
      })();
  const drawPhotoCount = (urls = uploader.value) => {
    $('[data-photo-count]', form).textContent = urls.length ? `${urls.length} de ${MAX_PHOTOS}` : 'Sem fotos';
  };

  /* ----- Variações ----- */
  function syncFromDom() {
    $$('.pe-var', varEl).forEach((row) => {
      const v = st.variants.find((x) => x.key === row.dataset.var);
      if (!v) return;
      $$('[data-v]', row).forEach((inp) => {
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
    <button class="btn btn--ghost btn--sm btn--icon" type="button" data-${raw(kind)}-up="${key}" aria-label="Mover ${name} para cima" ${i === 0 ? 'disabled' : ''}>${svg('up', 'icon-sm')}</button>
    <button class="btn btn--ghost btn--sm btn--icon" type="button" data-${raw(kind)}-down="${key}" aria-label="Mover ${name} para baixo" ${i === n - 1 ? 'disabled' : ''}>${svg('down', 'icon-sm')}</button>`;

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
                ${v.image_url ? html`<img class="pe-var__img" src="${mediaUrl(v.image_url)}" alt="">` : html`<span class="pe-var__img pe-var__img--empty" aria-hidden="true">${icon('image')}</span>`}
                <div class="pe-var__imgbtns">
                  <button class="btn btn--sm" type="button" data-var-photo="${k}" aria-label="${v.image_url ? 'Trocar' : 'Enviar'} foto de ${label}">${v.image_url ? 'Trocar' : 'Foto'}</button>
                  ${v.image_url ? html`<button class="btn btn--ghost btn--sm btn--icon pe-danger" type="button" data-var-photo-rm="${k}" aria-label="Remover foto de ${label}">${icon('close', 'icon-sm')}</button>` : ''}
                </div>
              </div>
              <div class="form-grid pe-var__fields">
                <div class="field col-4"><label for="pv-${k}-name">Nome *</label><input class="input" id="pv-${k}-name" name="v_${k}_name" data-v="name" value="${v.name}" maxlength="80" placeholder="Ex.: Veludo Verde" autocomplete="off"></div>
                <div class="field col-4"><label for="pv-${k}-color">Cor</label>
                  <div class="pe-color">
                    <input type="color" data-v-picker value="${hexOf(v.color)}" aria-label="Escolher a cor de ${label}">
                    <input class="input" id="pv-${k}-color" name="v_${k}_color" data-v="color" value="${v.color}" maxlength="200" placeholder="#1f5a4a" spellcheck="false" autocomplete="off">
                    <span class="pe-swatch" data-swatch aria-hidden="true"></span>
                  </div></div>
                <div class="field col-4"><label for="pv-${k}-sku">SKU</label><input class="input mono" id="pv-${k}-sku" name="v_${k}_sku" data-v="sku" value="${v.sku}" maxlength="60" autocomplete="off"></div>
                <div class="field col-4"><label for="pv-${k}-price">Preço próprio</label>
                  <div class="input-group"><span class="input-group__addon">R$</span><input class="input" id="pv-${k}-price" name="v_${k}_price" data-v="price" value="${v.price}" inputmode="decimal" placeholder="Igual ao produto" autocomplete="off"></div></div>
                <div class="field col-4"><label for="pv-${k}-stock">Estoque próprio</label><input class="input" id="pv-${k}-stock" name="v_${k}_stock" data-v="stock" value="${v.stock}" type="number" step="1" inputmode="numeric" placeholder="Igual ao produto"></div>
                <div class="field col-4 pe-var__active"><span class="label">Disponível</span>
                  <label class="switch"><input type="checkbox" name="v_${k}_active" data-v="active" ${v.active ? 'checked' : ''}><span class="switch__track"></span><span class="small">${v.active ? 'Ativa' : 'Oculta'}</span></label></div>
              </div>
              <div class="pe-var__tools">
                ${moveBtns('var', k, i, n, label)}
                <button class="btn btn--ghost btn--sm btn--icon pe-danger" type="button" data-var-rm="${k}" aria-label="Remover ${label}">${icon('trash', 'icon-sm')}</button>
              </div>
            </div>`;
          })
        : html`<p class="muted small">Nenhuma variação: o cliente compra o produto como está.</p>`
    );
    $$('.pe-var', varEl).forEach((row) => paintSwatch(row));
  }

  function paintSwatch(row) {
    const sw = $('[data-swatch]', row);
    const val = $('[data-v="color"]', row).value.trim();
    sw.style.background = '';
    if (val) sw.style.background = val;
    sw.classList.toggle('is-empty', !val || !sw.style.background);
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
        : html`<p class="muted small">Nenhuma especificação. Ex.: Lugares: 3 · Revestimento: Veludo.</p>`
    );
  }

  /* ----- Pré-visualizações ----- */
  function drawPricePreview() {
    const box = $('[data-price-preview]', form);
    const price = parseNumber(E.price.value);
    const cmp = parseNumber(E.compare_at_price.value);
    const cost = parseNumber(E.cost_price.value);
    if (price === null || Number.isNaN(price)) {
      render(box, html`<span class="muted small">Informe o preço para ver como ele aparece na loja.</span>`);
      return;
    }
    const pixOn = storeHasPix(store);
    const pct = Number(store.pix_discount_pct || 0);
    const shown = pixOn ? pixPrice(price, store) : round2(price);
    const inst = installments(price, store);
    const margin = cost !== null && !Number.isNaN(cost) && shown > 0 ? ((shown - cost) / shown) * 100 : null;
    render(
      box,
      html`<div class="pe-pricebox__label">Como aparece na loja</div>
      ${cmp !== null && !Number.isNaN(cmp) && cmp > shown ? html`<s class="muted small">${money(cmp)}</s>` : ''}
      <div class="pe-pricebox__main">${money(shown)}${pixOn ? html` <small>no PIX</small>` : ''}${pixOn && pct > 0 ? badge(`${String(pct).replace('.', ',')}% off`, 'success') : ''}</div>
      <div class="pe-pricebox__sub">${inst.n > 1 ? html`ou <strong>${inst.n}x de ${money(inst.value)}</strong> sem juros no cartão` : html`ou ${money(price)} no cartão`}</div>
      ${!pixOn ? html`<div class="pe-pricebox__meta">Esta loja não aceita PIX: o preço exibido é o cheio.</div>` : ''}
      ${margin !== null ? html`<div class="pe-pricebox__meta">Margem sobre o preço ${pixOn ? 'PIX' : ''}: <strong>${margin.toFixed(1).replace('.', ',')}%</strong> (${money(shown - cost)} por unidade)</div>` : ''}
      ${cmp !== null && !Number.isNaN(cmp) && cmp <= shown ? html`<div class="pe-warn">${icon('alert', 'icon-sm')} O preço "de" precisa ser maior que ${money(shown)} para aparecer riscado.</div>` : ''}
      ${margin !== null && margin < 0 ? html`<div class="pe-warn">${icon('alert', 'icon-sm')} O preço exibido está abaixo do custo.</div>` : ''}`
    );
  }

  function drawStockBadge() {
    const s = stockState({ track_stock: E.track_stock.checked, stock_qty: parseIntField(E.stock_qty.value) ?? 0, low_stock_threshold: parseIntField(E.low_stock_threshold.value) ?? 0 });
    render(
      $('[data-stock-badge]', form),
      s === 'untracked' ? badge('Não controla') : s === 'out' ? badge('Sem estoque', 'danger') : s === 'low' ? badge('Estoque baixo', 'warning') : badge('Em estoque', 'success')
    );
    E.stock_qty.disabled = !E.track_stock.checked || !canEdit;
    E.low_stock_threshold.disabled = !E.track_stock.checked || !canEdit;
  }

  function drawCounters() {
    $$('[data-count]', form).forEach((el) => {
      const n = (E[el.dataset.count]?.value || '').trim().length;
      const max = Number(el.dataset.max);
      el.textContent = `${n}/${max}`;
      el.classList.toggle('is-over', n > max);
    });
  }

  function drawSerp() {
    const name = E.name.value.trim() || 'Nome do produto';
    const title = E.seo_title.value.trim() || `${name} | ${store.brand_name || 'Atual Móveis'} ${store.city || ''}`.trim();
    const shortDesc = E.short_description.value.trim() || E.description.value.trim();
    const desc = E.seo_description.value.trim() || shortDesc || 'Adicione uma descrição para aparecer aqui.';
    E.seo_title.placeholder = `${name} | ${store.brand_name || 'Atual Móveis'} ${store.city || ''}`.trim();
    E.seo_description.placeholder = shortDesc.slice(0, 160) || 'Resumo em até 160 caracteres';
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
    render(
      $('[data-serp]', form),
      html`<div class="pe-serp__site"><span class="pe-serp__fav"><img src="/assets/brand/favicon.svg" alt=""></span>
        <span><span class="pe-serp__name">${store.brand_name || 'Atual Móveis'}</span><br>
        <span class="pe-serp__url">${location.host} › loja › ${store.slug || ''} › ${E.slug.value.trim() || '…'}</span></span></div>
      <div class="pe-serp__title">${cut(title, 65)}</div>
      <div class="pe-serp__desc">${cut(desc, 165)}</div>`
    );
  }

  function drawHead() {
    $('[data-head-name]', form).textContent = E.name.value.trim() || 'Novo produto';
    const status = form.querySelector('input[name="status"]:checked')?.value || 'draft';
    render($('[data-head-status]', form), productStatusBadge(status));
    const note = $('[data-status-note]', form);
    note.textContent =
      status !== 'active'
        ? 'Rascunhos e arquivados não aparecem na loja virtual.'
        : store.active === false
          ? 'Atenção: a loja está desativada na rede, então nada aparece na loja virtual.'
          : '';
    const slug = E.slug.value.trim();
    const hint = $('[data-slug-hint]', form);
    hint.textContent = slug && SLUG_RE.test(slug) ? `Link: ${location.host}${productUrl(store, slug)}` : 'Use letras minúsculas sem acento, números e hífens.';
    const a = $('[data-view-store]', view);
    if (a) a.href = viewHref();
  }

  function drawAll() {
    drawPricePreview();
    drawStockBadge();
    drawCounters();
    drawSerp();
    drawHead();
  }

  /* ----- Estado e alterações ----- */
  function snapshot() {
    syncFromDom();
    const fields = {};
    for (const el of form.elements) {
      if (!el.name || /^[vs]_/.test(el.name)) continue;
      if (el.type === 'radio') {
        if (el.checked) fields[el.name] = el.value;
      } else fields[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return JSON.stringify({
      fields,
      images: uploader.value,
      variants: st.variants.map(({ key, ...v }) => v),
      specs: st.specs.map(({ key, ...s }) => s),
      collections: [...st.collections].sort(),
    });
  }
  const isDirty = () => !leaving && canEdit && snapshot() !== savedSnap;
  const markDirty = debounce(() => {
    const label = $('[data-dirty-label]', form);
    if (!label) return;
    const dirty = isDirty();
    label.textContent = dirty ? 'Alterações não salvas' : isNew ? 'Preencha e crie o produto' : 'Nenhuma alteração';
    label.classList.toggle('is-dirty', dirty);
  }, 120);

  function collect() {
    syncFromDom();
    const t = (n) => (E[n]?.value ?? '').trim();
    const nn = (n) => t(n) || null;
    const product = {
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
    };
    for (const s of SEALS) product[s.key] = E[s.key].checked;
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
    return { product, images: uploader.value, variants: vars, collections: [...st.collections] };
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

  async function save(btn, { back = false } = {}) {
    if (saving || !canEdit) return;
    const data = collect();
    if (data.images.some((u) => u.startsWith('data:'))) return toast('Aguarde o envio das fotos terminar.', 'warning');
    if (!showErrors(form, validate(data))) return toast('Revise os campos destacados.', 'warning');
    const P = data.product;
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
        // Arquivos que saíram do produto (e não são usados por cópias)
        const inUse = new Set([...data.images, ...data.variants.map((v) => v.image_url).filter(Boolean)]);
        const gone = [...orig.images, ...orig.variantImages, ...sessionUploads].filter((u) => !inUse.has(u));
        sessionUploads.clear();
        if (!stepError) safeRemoveImages(gone);
      });
    } catch (err) {
      saving = false;
      if (err.field) showErrors(form, { [err.field]: err.message });
      else if (err.raw?.code === '23505' && /slug/.test(err.raw?.message || '')) showErrors(form, { slug: 'Já existe outro produto com este endereço nesta loja.' });
      else toastError(err);
      return;
    }
    saving = false;
    if (!productSaved) return;
    if (stepError) toastError(new Error(`Produto salvo, mas parte das informações não foi gravada: ${stepError.message}`));
    else toast(isNew ? 'Produto criado.' : 'Produto salvo.', 'success');
    leaving = true;
    if (back && !stepError) return ctx.navigate(lastListHash);
    keepScroll = isNew ? null : { id: pid, y: window.scrollY };
    ctx.navigate(`#/products/${pid}`);
  }

  async function removeProduct(btn) {
    const ok = await confirmDialog({
      title: 'Excluir produto',
      message: `Excluir "${p.name}"? Fotos, variações e vínculos com coleções serão removidos. Pedidos já feitos mantêm nome e preço. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir produto',
      danger: true,
    });
    if (!ok) return;
    try {
      await withBusy(btn, async () => {
        const done = await q(sb.from('products').delete().eq('id', pid).select('id'));
        if (!done.length) throw new Error('Não foi possível excluir: o produto não existe mais ou você não tem permissão.');
      });
      const files = [...orig.images, ...orig.variantImages, ...sessionUploads, ...uploader.value];
      sessionUploads.clear();
      safeRemoveImages(files);
      leaving = true;
      toast('Produto excluído.', 'success');
      ctx.navigate(lastListHash);
    } catch (err) {
      toastError(err);
    }
  }

  function uploadVariantPhoto(key, btn) {
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
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';
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
    if (t.name === 'name' && !slugTouched) E.slug.value = slugify(t.value).slice(0, 120).replace(/-+$/, '');
    if (t.name === 'slug') slugTouched = true;
    if (t.matches('[data-v-picker]')) {
      const row = t.closest('.pe-var');
      $('[data-v="color"]', row).value = t.value;
      paintSwatch(row);
    }
    if (t.matches('[data-v="color"]')) {
      const row = t.closest('.pe-var');
      if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t.value.trim())) $('[data-v-picker]', row).value = hexOf(t.value);
      paintSwatch(row);
    }
    drawAll();
    markDirty();
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
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
      t.nextElementSibling.nextElementSibling.textContent = t.checked ? 'Ativa' : 'Oculta';
    }
    drawAll();
    markDirty();
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
    if (!b || b.disabled || !form.contains(b)) return;
    const d = b.dataset;
    if ('saveBack' in d) return save(b, { back: true });
    if ('delete' in d) return removeProduct(b);
    if ('duplicate' in d) {
      if (isDirty()) return toast('Salve as alterações antes de duplicar.', 'warning');
      return openDuplicate(ctx, { products: [{ id: pid, store_id: storeId, name: p.name }], includeSame: true });
    }
    if ('varAdd' in d) {
      syncFromDom();
      const v = { key: nextKey(), id: null, name: '', color: '', image_url: '', sku: '', price: '', stock: '', active: true };
      st.variants.push(v);
      drawVariants();
      focusAfter(`#pv-${v.key}-name`);
      return markDirty();
    }
    if (d.varRm) {
      syncFromDom();
      st.variants = st.variants.filter((v) => v.key !== d.varRm);
      drawVariants();
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

  /* ----- Proteção contra perder alterações ----- */
  const confirmLeave = () =>
    confirmDialog({
      title: 'Sair sem salvar?',
      message: 'As alterações deste produto ainda não foram salvas e serão perdidas.',
      confirmLabel: 'Sair sem salvar',
      danger: true,
    });
  const onBeforeUnload = (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  // Navegação por hash (links, voltar/avançar): o popstate dispara antes do hashchange que o
  // roteador escuta. Com alterações pendentes, o roteador ignora este hashchange (ctx.user nulo
  // por um instante), a URL volta para o editor e pedimos confirmação.
  const ownHash = location.hash;
  let guarding = false;
  const onPopState = () => {
    const target = location.hash;
    if (target === ownHash || !isDirty()) return;
    const user = ctx.user;
    ctx.user = null;
    const restore = () => {
      if (!ctx.user) ctx.user = user;
    };
    window.addEventListener('hashchange', restore, { once: true });
    setTimeout(restore, 1500);
    history.replaceState(null, '', ownHash);
    if (guarding) return;
    guarding = true;
    confirmLeave().then((ok) => {
      guarding = false;
      if (!ok) return;
      leaving = true;
      location.hash = target;
    });
  };
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
  const onStoreSwitch = (e) => {
    if (!e.target.matches?.('[data-store-switch]') || !isDirty()) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
    const sel = e.target;
    const wanted = sel.value;
    sel.value = ctx.storeId || '';
    confirmLeave().then((ok) => {
      if (!ok) return;
      leaving = true;
      ctx.setStore(wanted || null);
    });
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.querySelector('.modal')) {
      e.preventDefault();
      save($('[data-save]', form));
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('click', onLogoutClick, true);
  document.addEventListener('change', onStoreSwitch, true);
  if (canEdit) document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('click', onLogoutClick, true);
    document.removeEventListener('change', onStoreSwitch, true);
    document.removeEventListener('keydown', onKey);
    // fotos enviadas nesta edição e não salvas
    if (sessionUploads.size) safeRemoveImages([...sessionUploads]);
  });

  drawVariants();
  drawSpecs();
  drawPhotoCount();
  drawAll();
  savedSnap = snapshot();
  markDirty();
  if (keepScroll && keepScroll.id === pid) {
    const y = keepScroll.y;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
  keepScroll = null;
}

/* =========================================================
   Estilos do módulo
   ========================================================= */
const CSS = `
.products-dd { position: relative; }
.products-dd .menu { min-width: 270px; }
.products-dd .menu button:disabled { opacity: .5; cursor: not-allowed; background: none; }

/* ----- Lista ----- */
.products-list .pl-toolbar { gap: 8px; }
.products-list .pl-toolbar .search { flex: 1 1 200px; min-width: 180px; max-width: 320px; }
.products-list .pl-toolbar .select { flex: 0 1 auto; width: auto; max-width: 190px; text-overflow: ellipsis; }
.products-list .pl-summary { margin: 0 0 8px; }
.products-list .pl-bulk { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #f1c4c6; border-radius: var(--radius); background: #fff7f7; }
.products-list .pl-bulk__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.products-list .table td { padding-top: 9px; padding-bottom: 9px; }
.products-list .pl-thumb-col { width: 60px; padding-right: 2px; }
.products-list .thumb { min-width: 44px; max-width: none; }
.products-list .pl-thumb--empty, .products-editor .pl-thumb--empty { display: flex; align-items: center; justify-content: center; color: #bdbdbd; }
.products-list .pl-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-width: 210px; max-width: 360px; color: var(--ink); font-weight: 600; line-height: 1.35; }
.products-list .pl-name:hover { color: var(--accent); text-decoration: none; }
.products-list .pl-sku { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
.products-list .pl-cat, .products-list .pl-store { display: inline-block; min-width: 110px; }
.products-list .pl-pix { display: block; color: var(--success); font-size: 12px; font-weight: 600; }
.products-list .pl-stock { margin-right: 6px; font-weight: 600; }
.products-list .pl-seals { display: inline-flex; gap: 4px; }
.products-list .pl-seal { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: #f2f2f2; color: #444; }
.products-list .pl-seal--is_new { background: var(--info-soft); color: var(--info); }
.products-list .pl-seal--free_shipping { background: var(--success-soft); color: var(--success); }
.products-list .pl-seal--fast_delivery { background: var(--warning-soft); color: var(--warning); }
.products-list .pl-seal--is_promo { background: var(--accent-soft); color: var(--accent); }

/* ----- Modais ----- */
.products-modal .pm-stores { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.products-modal .pm-stores .check { align-items: flex-start; }
.products-modal .pm-stores .check input { margin-top: 2px; flex: none; }
.products-modal .table th, .products-modal .table td { padding: 8px 10px; }
.products-modal .pa-name, .products-modal .pi-name { display: block; max-width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.products-modal .pi-cols { display: flex; flex-wrap: wrap; gap: 6px; }
.products-modal .pi-cols code { padding: 2px 7px; border-radius: 5px; background: #f1f1f1; font-size: 12px; }
.products-modal .pi-rules { list-style: disc; padding-left: 18px; display: grid; gap: 3px; }
.products-modal .pi-table { max-height: 46vh; overflow: auto; }
.products-modal .pi-error { color: var(--danger); }
.products-modal .pi-table .mono { white-space: nowrap; }

/* ----- Editor ----- */
.products-editor .pe-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
.products-editor .pe-head { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px 14px; margin-bottom: 16px; }
.products-editor .pe-head__title { flex: 1; min-width: 220px; }
.products-editor .pe-head__name { overflow-wrap: anywhere; line-height: 1.25; }
.products-editor .pe-head__meta { margin-top: 4px; }
.products-editor .pe-head__store { display: inline-flex; align-items: center; gap: 5px; }
.products-editor .pe-head__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.products-editor .card__head p { margin-top: 2px; }
.products-editor .pe-labelrow { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.products-editor .pe-labelrow label { font-size: 12.5px; font-weight: 600; color: var(--ink); }
.products-editor .pe-count { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.products-editor .pe-count.is-over { color: var(--danger); font-weight: 700; }
.products-editor .pe-short { min-height: 64px; }
.products-editor .pe-pricebox { padding: 14px 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); }
.products-editor .pe-pricebox__label { margin-bottom: 4px; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--muted); }
.products-editor .pe-pricebox__main { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; font-size: 22px; font-weight: 700; line-height: 1.2; color: var(--ink); }
.products-editor .pe-pricebox__main small { font-size: 13px; font-weight: 600; color: var(--muted); }
.products-editor .pe-pricebox__sub { margin-top: 2px; }
.products-editor .pe-pricebox__meta { margin-top: 8px; font-size: 12.5px; color: var(--muted); }
.products-editor .pe-warn { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12.5px; font-weight: 600; color: var(--warning); }

.products-editor .pe-var { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; grid-template-areas: 'media fields tools'; gap: 12px 14px; align-items: start; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
.products-editor .pe-var + .pe-var { margin-top: 10px; }
.products-editor .pe-var.is-inactive { background: var(--surface-2); }
.products-editor .pe-var__media { grid-area: media; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.products-editor .pe-var__img { width: 64px; height: 64px; border: 1px solid var(--line); border-radius: 8px; object-fit: cover; background: #f3f3f3; }
.products-editor .pe-var__img--empty { display: flex; align-items: center; justify-content: center; border-style: dashed; color: #bdbdbd; }
.products-editor .pe-var__imgbtns { display: flex; gap: 2px; }
.products-editor .pe-var__fields { grid-area: fields; gap: 10px 12px; }
.products-editor .pe-var__tools { grid-area: tools; display: flex; flex-direction: column; gap: 2px; }
.products-editor .pe-var__active .switch { min-height: 38px; }
.products-editor .pe-color { display: flex; align-items: center; gap: 6px; }
.products-editor .pe-color input[type='color'] { flex: none; width: 38px; height: 38px; padding: 3px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
.products-editor .pe-color .input { min-width: 0; }
.products-editor .pe-swatch { flex: none; width: 22px; height: 22px; border: 1px solid var(--line-strong); border-radius: 50%; }
.products-editor .pe-swatch.is-empty { background: repeating-conic-gradient(#e6e6e6 0 25%, #fff 0 50%) 0 0 / 8px 8px !important; }
.products-editor .pe-danger { color: var(--danger); }

.products-editor .pe-spec { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) 100px; gap: 8px; align-items: center; }
.products-editor .pe-spec + .pe-spec { margin-top: 8px; }
.products-editor .pe-spec__tools { display: flex; justify-content: flex-end; gap: 2px; }

.products-editor .pe-serp { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; font-family: Arial, Helvetica, sans-serif; }
.products-editor .pe-serp__site { display: flex; align-items: center; gap: 10px; line-height: 1.25; }
.products-editor .pe-serp__fav { display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border: 1px solid #ecedef; border-radius: 50%; background: #f8f9fa; }
.products-editor .pe-serp__fav img { width: 16px; height: 16px; }
.products-editor .pe-serp__name { font-size: 14px; color: #202124; }
.products-editor .pe-serp__url { font-size: 12px; color: #4d5156; overflow-wrap: anywhere; }
.products-editor .pe-serp__title { margin-top: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 19px; line-height: 1.3; color: #1a0dab; }
.products-editor .pe-serp__desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 3px; font-size: 13.5px; line-height: 1.55; color: #4d5156; }

.products-editor .pe-status { display: flex; flex-direction: column; gap: 8px; }
.products-editor .pe-status__opt { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.products-editor .pe-status__opt:hover { border-color: var(--line-strong); }
.products-editor .pe-status__opt:has(input:checked) { border-color: var(--ink); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--ink); }
.products-editor .pe-status__opt input { flex: none; width: 16px; height: 16px; margin-top: 3px; accent-color: var(--accent); }
.products-editor .pe-seals { display: flex; flex-direction: column; gap: 14px; }
.products-editor .pe-seals .switch { align-items: flex-start; }
.products-editor .pe-seals .switch__track { margin-top: 1px; }
.products-editor .pe-cols { display: flex; flex-direction: column; gap: 10px; }
.products-editor .pe-facts { display: grid; gap: 8px; margin: 0; }
.products-editor .pe-facts div { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.products-editor .pe-facts dt { color: var(--muted); }
.products-editor .pe-facts dd { margin: 0; font-weight: 600; text-align: right; }
.products-editor .pe-storepick { justify-content: flex-start; height: auto; padding: 12px; text-align: left; white-space: normal; }

.products-editor .pe-savebar { position: sticky; bottom: 0; z-index: 15; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin: 20px -24px -24px; padding: 12px 24px; border-top: 1px solid var(--line); background: rgba(255, 255, 255, .96); backdrop-filter: blur(8px); }
.products-editor .pe-savebar__state { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; color: var(--muted); }
.products-editor .pe-savebar__state.is-dirty { font-weight: 600; color: var(--warning); }
.products-editor .pe-savebar__state.is-dirty::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--orange); }

@media (max-width: 860px) {
  .products-list .pl-toolbar .search { flex-basis: 100%; max-width: none; }
  .products-list .pl-toolbar .select { flex: 1 1 calc(50% - 4px); max-width: none; }
  .products-list .pl-bulk__actions { margin-left: 0; }
  .products-editor .pe-dims .col-3 { grid-column: span 6; }
  .products-editor .pe-var { grid-template-columns: auto minmax(0, 1fr); grid-template-areas: 'media tools' 'fields fields'; }
  .products-editor .pe-var__media { flex-direction: row; }
  .products-editor .pe-var__tools { flex-direction: row; justify-content: flex-end; }
  .products-editor .pe-savebar { margin: 16px -14px -40px; padding: 10px 14px; }
}
@media (max-width: 560px) {
  .products-hide-sm { display: none; }
  .products-dd .menu { position: fixed; top: calc(var(--topbar-h) - 4px); left: 12px; right: 12px; min-width: 0; box-shadow: var(--shadow-lg); }
  .products-modal .pm-stores { grid-template-columns: minmax(0, 1fr); }
  .products-editor .pe-head__actions { margin-left: auto; }
  .products-editor .pe-spec { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'l t' 'v t'; gap: 6px 8px; }
  .products-editor .pe-spec > .field:nth-child(1) { grid-area: l; }
  .products-editor .pe-spec > .field:nth-child(2) { grid-area: v; }
  .products-editor .pe-spec__tools { grid-area: t; flex-direction: column; }
  .products-editor .pe-spec--head { display: none; }
  .products-editor .pe-spec + .pe-spec { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
  .products-editor .pe-spec--head + .pe-spec { margin-top: 0; padding-top: 0; border-top: 0; }
  .products-editor .pe-savebar .btn { flex: 1 1 0; }
  .products-editor .pe-savebar__state { flex-basis: 100%; }
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
