// Vitrine e banners da loja virtual: prateleiras (coleções), slideshow, mosaicos/ambientes e barra de avisos,
// com o mapa da página inicial (na ordem em que o cliente vê) e prévias fiéis à loja virtual.
//
// Rotas: #/showcase (prateleiras) · #/showcase/hero · #/showcase/tiles · #/showcase/bar
//
// Escopo: na visão de uma loja, os itens novos ficam na loja (store_id = loja). Itens da rede (store_id nulo)
// aparecem em todas as lojas, com o selo "Rede", e só administradores da rede os alteram. Na visão
// "Toda a rede" as abas de banners e avisos gerenciam os itens da rede; as prateleiras sempre pedem uma loja.
// Na loja virtual os itens da loja vêm antes dos da rede (cada grupo pela ordem definida aqui).
// Imagens: ui.imageUploader (stores/<loja>/banners ou network/banners). Um arquivo só sai do storage
// depois de salvar (ou ao cancelar um envio novo) e se nenhum outro banner usar a mesma URL.
// O campo "Quando fica no ar" (data + hora de Brasília, com calendário) vem de coupons.js.
import { sb, q, mediaUrl, removeImage, storefrontUrl } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, badge, money, num, slugify, PRODUCT_STATUS,
  openModal, confirmDialog, readForm, showErrors, withBusy, switchField, empty, errorBlock, skeleton,
  imageUploader, sortable, injectStyle, debounce, storeMark, segmented, tip, highlight,
} from '../ui.js';
import { scheduleField, bindSchedule, whenText, injectSchedule } from './coupons.js';

const TABS = [
  { id: 'shelves', label: 'Prateleiras', icon: 'rows' },
  { id: 'hero', label: 'Slideshow', icon: 'image' },
  { id: 'tiles', label: 'Mosaicos e ambientes', icon: 'grid' },
  { id: 'bar', label: 'Barra de avisos', icon: 'message' },
];

// Grupos de itens com escopo loja/rede (banners por tipo e avisos)
const GROUPS = {
  hero: {
    title: 'Slideshow',
    desc: 'Slides grandes no topo da página inicial. Imagem de computador com 2400 × 900 px e versão de celular com 900 × 1323 px.',
    one: 'slide', many: 'slides', new: 'Novo slide', art: 'o',
    store: 'Slides desta loja', network: 'Slides da rede', none: 'Nenhum slide',
  },
  mosaic: {
    title: 'Mosaicos',
    desc: 'Blocos de inspiração, 2 por linha, depois da 2ª prateleira. Imagem quadrada de 1400 × 1400 px.',
    one: 'mosaico', many: 'mosaicos', new: 'Novo mosaico', art: 'o', fit: 2,
    store: 'Mosaicos desta loja', network: 'Mosaicos da rede', none: 'Nenhum mosaico',
  },
  room: {
    title: 'Ambientes',
    desc: '“Compre por ambiente”, 4 por linha, depois da 3ª prateleira. Imagem quadrada de 900 × 900 px.',
    one: 'ambiente', many: 'ambientes', new: 'Novo ambiente', art: 'o', fit: 4,
    store: 'Ambientes desta loja', network: 'Ambientes da rede', none: 'Nenhum ambiente',
  },
  bar: {
    title: 'Barra de avisos',
    desc: 'Mensagens curtas na faixa escura do topo do site. Com mais de um aviso no ar, eles se alternam.',
    one: 'aviso', many: 'avisos', new: 'Novo aviso', art: 'o',
    store: 'Avisos desta loja', network: 'Avisos da rede', none: 'Nenhum aviso',
  },
};
const TAB_CFG = {
  hero: { table: 'banners', kinds: ['hero'], summary: 'Slides próprios de cada loja' },
  tiles: { table: 'banners', kinds: ['mosaic', 'room'], summary: 'Mosaicos e ambientes próprios de cada loja' },
  bar: { table: 'announcements', kinds: ['bar'], summary: 'Avisos próprios de cada loja' },
};

const LAYOUTS = { five: '5 por linha', six: '6 por linha' };
const LAYOUT_HINT = { five: 'Cartões maiores, bom para móveis', six: 'Mais produtos na mesma linha' };
const SEALS = { '': 'Nenhum', novo: 'Lançamento', frete: 'Frete grátis' };
const SEAL_HINT = { '': 'Os produtos mostram os próprios selos', novo: 'Selo “Lançamento” em todos os produtos', frete: 'Selo “Frete grátis” em todos os produtos' };
const MAX_PINS = 3;
const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LINK_RE = /^(#[\w-]+|\?\S+|\/\S*|https?:\/\/\S+)$/i;
const LINK_HELP = 'Use #âncora, ?parâmetro, /caminho ou um endereço completo (https://…).';
const PICK_COLS = 'id,name,sku,price,image_url,status';
const PICK_LIMIT = 60;
const STORAGE_MARK = '/storage/v1/object/public/media/';
const DAY = 86400000;

/* ---------- Utilitários ---------- */
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
const isStored = (u) => typeof u === 'string' && u.includes(STORAGE_MARK);
const netTag = () => html`<span class="tag sc-net">${icon('houses', 'icon-xs')} Rede</span>`;
const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || a.title || '').localeCompare(String(b.created_at || b.title || ''));
const nextOrder = (list) => list.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1;
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const shortStore = (ctx) => (ctx.store ? ctx.storeShort?.(ctx.store) || ctx.store.name : '');

function liveState(it, now = Date.now()) {
  if (!it.active) return { key: 'off', label: 'Inativo', tone: '' };
  if (it.starts_at && Date.parse(it.starts_at) > now) return { key: 'scheduled', label: 'Agendado', tone: 'info' };
  if (it.ends_at && Date.parse(it.ends_at) < now) return { key: 'ended', label: 'Encerrado', tone: 'warning' };
  return { key: 'live', label: 'No ar', tone: 'success' };
}
// "Sempre no ar" · "Começa amanhã às 08:00" · "No ar até em 30/11 às 23:59 · termina em 3 dias" · "Saiu do ar em 31/10 às 23:59"
function scheduleLine(it, now = Date.now()) {
  const s = it.starts_at ? Date.parse(it.starts_at) : null;
  const e = it.ends_at ? Date.parse(it.ends_at) : null;
  if (e && e < now) return { text: `Saiu do ar ${whenText(it.ends_at)}`, soon: '' };
  if (s && s > now) return { text: `Entra no ar ${whenText(it.starts_at)}${e ? `, sai ${whenText(it.ends_at)}` : ''}`, soon: '' };
  if (e) {
    const left = e - now;
    return { text: `No ar até ${whenText(it.ends_at).replace(/^em /, '')}`, soon: left < 7 * DAY ? (left < DAY ? 'sai hoje' : `sai em ${Math.ceil(left / DAY)} ${Math.ceil(left / DAY) === 1 ? 'dia' : 'dias'}`) : '' };
  }
  return { text: s ? 'No ar, sem data para sair' : 'Sempre no ar', soon: '' };
}

const thumb = (url, cls = 'thumb') =>
  url ? html`<img class="${cls}" src="${mediaUrl(url)}" alt="" loading="lazy">` : html`<span class="${cls} sc-noimg" aria-hidden="true">${icon('image', 'icon-sm')}</span>`;

const gripCol = (i, on) => html`<span class="sc-grip ${on ? '' : 'is-off'}" ${on ? 'title="Arraste para reordenar"' : ''} aria-hidden="true"><span class="sc-pos">${i + 1}</span>${on ? icon('grip', 'icon-sm') : ''}</span>`;

const moveBtns = (i, n, name) =>
  n > 1
    ? html`<span class="sc-move">
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="up" aria-label="Mover “${name}” para cima" data-tooltip="Subir" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 'icon-sm')}</button>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="down" aria-label="Mover “${name}” para baixo" data-tooltip="Descer" ${i === n - 1 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>
      </span>`
    : '';

const rowActions = (name) => html`
  <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit aria-label="Editar “${name}”" data-tooltip="Editar">${icon('edit', 'icon-sm')}</button>
  <button class="btn btn--ghost btn--sm btn--icon sc-danger" type="button" data-delete aria-label="Excluir “${name}”" data-tooltip="Excluir">${icon('trash', 'icon-sm')}</button>`;

const activeSwitch = (id, on, label = 'Ativo', name = '') => html`<label class="switch sc-toggle">
  <input type="checkbox" data-active="${id}" ${on ? 'checked' : ''} aria-label="${label}${name ? `: ${name}` : ''}">
  <span class="switch__track"></span><span class="sc-toggle__l">${label}</span>
</label>`;

const readOnlyNote = () => html`<span class="sc-ro">${icon('lock', 'icon-xs')} Gerenciado pela rede</span>`;

const retryBlock = (e, retry) => errorBlock(e, { retry, title: 'Não foi possível carregar' });

// Grava sort_order 1..n na ordem de `ids` (só o que mudou). Devolve true se gravou algo.
async function saveOrder(table, list, ids, match = (b, r) => b.eq('id', r.id), keyOf = (r) => r.id) {
  const by = new Map(list.map((r) => [String(keyOf(r)), r]));
  const ordered = ids.map((k) => by.get(String(k))).filter(Boolean);
  if (ordered.length !== list.length) return false;
  const changed = ordered.map((r, i) => [r, i + 1]).filter(([r, n]) => r.sort_order !== n);
  if (!changed.length) return false;
  await Promise.all(changed.map(([r, n]) => q(match(sb.from(table).update({ sort_order: n }), r))));
  changed.forEach(([r, n]) => (r.sort_order = n));
  return true;
}

// Tira a marca de erro de um campo assim que ele é editado
function clearErrorsOnInput(form) {
  const clear = (e) => {
    const name = e.target.name;
    if (!name || e.target.closest('[data-sch]')) return;
    e.target.removeAttribute('aria-invalid');
    $$(`.error[data-for="${name}"]`, form).forEach((n) => n.remove());
  };
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);
}

// Ordem atual de uma lista na tela, já com a troca pedida pelas setas
function swapIds(listEl, id, dir) {
  const ids = $$('.sc-row[data-id]', listEl).map((n) => n.dataset.id);
  const i = ids.indexOf(id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

// Apaga do storage imagens que nenhum banner usa mais
async function releaseImages(urls) {
  for (const url of new Set(urls.filter(isStored))) {
    try {
      const [a, b] = await Promise.all([
        q(sb.from('banners').select('id', { count: 'exact', head: true }).eq('image_url', url)),
        q(sb.from('banners').select('id', { count: 'exact', head: true }).eq('image_mobile_url', url)),
      ]);
      if (!(a?.count || 0) && !(b?.count || 0)) await removeImage(url);
    } catch {
      /* fica no storage; não atrapalha a loja */
    }
  }
}

// Sugestões para campos de link (prateleiras e categorias)
const linkCache = new Map();
async function linkSuggestions(storeId) {
  const k = storeId || 'network';
  if (linkCache.has(k)) return linkCache.get(k);
  const task = (async () => {
    const [cats, colls] = await Promise.all([
      q(sb.from('categories').select('name, slug').eq('active', true).order('sort_order').order('name')).catch(() => []),
      (storeId
        ? q(sb.from('collections').select('key, title').eq('store_id', storeId).order('sort_order'))
        : q(sb.from('collections').select('key, title').order('sort_order').limit(500))
      ).catch(() => []),
    ]);
    const seen = new Set();
    const out = [];
    const add = (v, l) => {
      if (seen.has(v)) return;
      seen.add(v);
      out.push([v, l]);
    };
    colls.forEach((c) => add(`#${c.key}`, `Prateleira: ${c.title}`));
    colls.forEach((c) => add(`?colecao=${c.key}`, `Lista completa: ${c.title}`));
    cats.forEach((c) => add(`?categoria=${c.slug}`, `Categoria: ${c.name}`));
    return out;
  })();
  linkCache.set(k, task);
  setTimeout(() => linkCache.delete(k), 60000);
  return task;
}
function fillDatalist(el, storeId) {
  const dl = $('datalist', el);
  if (!dl) return;
  linkSuggestions(storeId)
    .then((opts) => render(dl, opts.map(([v, l]) => html`<option value="${v}">${l}</option>`)))
    .catch(() => {});
}

/* ---------- Prévias (iguais à loja virtual) ---------- */
function heroPreview(b, mode = 'desk') {
  const src = mode === 'mobile' ? b.image_mobile_url || b.image_url : b.image_url;
  return html`<div class="sc-pv sc-pv--hero is-${mode}" aria-hidden="true">
    ${src ? html`<img class="sc-pv__img" src="${mediaUrl(src)}" alt="">` : html`<span class="sc-pv__ph"><span class="sc-pv__phl">${icon('image', 'icon-xs')}Envie a imagem para ver a prévia</span></span>`}
    <span class="sc-pv__shade"></span>
    ${b.kicker ? html`<span class="sc-pv__kicker">${b.kicker}</span>` : ''}
    <span class="sc-pv__title">${b.title || 'Título do slide'}</span>
    ${b.text ? html`<span class="sc-pv__text">${b.text}</span>` : ''}
    <span class="sc-pv__dots"><i class="is-on"></i><i></i><i></i></span>
  </div>`;
}
function tilePreview(b) {
  return html`<div class="sc-pv sc-pv--tile is-${b.kind}" aria-hidden="true">
    ${b.image_url ? html`<img class="sc-pv__img" src="${mediaUrl(b.image_url)}" alt="">` : html`<span class="sc-pv__ph"><span class="sc-pv__phl">${icon('image', 'icon-xs')}Envie a imagem</span></span>`}
    <span class="sc-pv__overlay"><span class="sc-pv__ttitle">${b.title || (b.kind === 'room' ? 'Ambiente' : 'Mosaico')}</span>${b.kind === 'mosaic' && b.text ? html`<span class="sc-pv__tsub">${b.text}</span>` : ''}</span>
  </div>`;
}
const barPreview = (a) => html`<div class="sc-bar" aria-hidden="true"><span>${a.text || 'Texto do aviso'}</span>${a.cta_label && a.cta_url ? html`<span class="sc-bar__cta">${a.cta_label}</span>` : ''}</div>`;

function openPreview(ctx, b, { canWrite, onEdit } = {}) {
  const isHero = b.kind === 'hero';
  let mode = 'desk';
  const st = liveState(b);
  const sch = scheduleLine(b);
  openModal({
    title: `Prévia: ${b.title}`,
    size: 'lg',
    cls: 'sc-pv-modal',
    body: html`<div class="sc-pvbox">
      ${isHero ? html`<div class="sc-pvbox__bar">${segmented({ name: 'pv-mode', label: 'Tela da prévia', options: [['desk', 'Computador', 'monitor'], ['mobile', 'Celular', 'phone']], value: 'desk', size: 'sm' })}</div>` : ''}
      <div class="sc-pvbox__stage" data-stage>${isHero ? heroPreview(b, mode) : tilePreview(b)}</div>
      <dl class="sc-pvbox__meta">
        <div><dt>Situação</dt><dd>${badge(st.label, st.tone)}${b.store_id ? '' : netTag()}</dd></div>
        <div><dt>Quando</dt><dd>${sch.text}</dd></div>
        <div><dt>Link</dt><dd>${b.link_url ? html`<span class="mono">${b.link_url}</span>` : html`<span class="muted">Sem link</span>`}</dd></div>
      </dl>
      <p class="small muted">A prévia mostra o texto sobre a imagem como na loja virtual. Fotos com fundo claro pedem textos curtos.</p>
    </div>`,
    actions: html`<button class="btn" type="button" data-close>Fechar</button>${canWrite ? html`<button class="btn btn--dark" type="button" data-pv-edit>${icon('edit', 'icon-sm')} Editar</button>` : ''}`,
    onMount(el, close) {
      el.addEventListener('seg:change', (e) => {
        mode = e.detail.value;
        render($('[data-stage]', el), heroPreview(b, mode));
      });
      $('[data-pv-edit]', el)?.addEventListener('click', () => {
        close();
        onEdit?.();
      });
    },
  });
}

/* ---------- Seletor de produtos da loja ---------- */
// Resolve com os produtos escolhidos (na ordem em que foram marcados) ou [] se cancelar.
function pickProducts({ storeId, exclude = new Set(), max = Infinity, title = 'Adicionar produtos', confirmLabel = 'Adicionar' }) {
  return new Promise((resolve) => {
    const chosen = new Map();
    let results = [];
    let term = '';
    let seq = 0;
    let result = [];
    openModal({
      title,
      size: 'lg',
      cls: 'sc-pick-modal',
      body: html`<div class="sc-picker">
        <div class="search sc-picker__search">${icon('search', 'icon-sm')}
          <label class="visually-hidden" for="sc-pick-q">Buscar produto</label>
          <input class="input" id="sc-pick-q" type="search" placeholder="Buscar por nome ou SKU" autocomplete="off" autofocus>
        </div>
        <p class="sc-picker__info" data-pick-info aria-live="polite"></p>
        <ul class="sc-pick-list" data-pick-list>${skeleton('list', { rows: 6 })}</ul>
      </div>`,
      actions: html`<span class="sc-pick-count grow" data-pick-count aria-live="polite"></span>
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn--primary" type="button" data-pick-ok disabled>${confirmLabel}</button>`,
      onMount(el, close) {
        const listEl = $('[data-pick-list]', el);
        const info = $('[data-pick-info]', el);
        const okBtn = $('[data-pick-ok]', el);
        const countEl = $('[data-pick-count]', el);
        const drawCount = () => {
          const n = chosen.size;
          countEl.textContent = n ? `${plural(n, 'selecionado', 'selecionados')}${Number.isFinite(max) ? ` de ${max}` : ''}` : Number.isFinite(max) ? `Escolha até ${max}.` : '';
          okBtn.disabled = !n;
          okBtn.textContent = n ? `${confirmLabel} (${n})` : confirmLabel;
        };
        const drawList = () => {
          render(
            listEl,
            results.length
              ? results.map((p) => {
                  const inList = exclude.has(p.id);
                  const on = chosen.has(p.id);
                  const full = !on && chosen.size >= max;
                  return html`<li><label class="sc-pick ${inList ? 'is-in' : ''} ${on ? 'is-on' : ''}">
                    <input type="checkbox" value="${p.id}" ${on || inList ? 'checked' : ''} ${inList || full ? 'disabled' : ''}>
                    ${thumb(p.image_url)}
                    <span class="sc-pick__name"><strong class="ellipsis">${term ? highlight(p.name, term) : p.name}</strong><span class="sub">${p.sku || 'Sem SKU'} · ${money(p.price)}</span></span>
                    ${inList ? badge('Já incluído') : p.status !== 'active' ? badge(PRODUCT_STATUS[p.status]?.label || p.status, 'warning') : ''}
                  </label></li>`;
                })
              : html`<li>${empty('Nenhum produto encontrado', term ? `Nada com “${term}”. Tente outro nome ou SKU.` : 'Esta loja ainda não tem produtos ativos ou em rascunho.', '', { art: false, icon: 'products', size: 'sm' })}</li>`
          );
        };
        const search = async () => {
          const my = ++seq;
          const t = term.replace(/[,()"'\\%*:]/g, ' ').trim();
          let qb = sb.from('products').select(PICK_COLS).eq('store_id', storeId).neq('status', 'archived').order('name').limit(PICK_LIMIT);
          if (t) qb = qb.or(`name.ilike.%${t}%,sku.ilike.%${t}%`);
          try {
            const rows = await q(qb);
            if (my !== seq) return;
            results = rows;
            info.textContent = rows.length >= PICK_LIMIT ? `Mostrando os ${PICK_LIMIT} primeiros. Refine a busca para encontrar outros.` : rows.length ? plural(rows.length, 'produto', 'produtos') : '';
            drawList();
          } catch (e) {
            if (my !== seq) return;
            render(listEl, html`<li>${errorBlock(e)}</li>`);
          }
        };
        const onInput = debounce(() => {
          term = $('#sc-pick-q', el).value;
          search();
        }, 250);
        $('#sc-pick-q', el).addEventListener('input', onInput);
        $('#sc-pick-q', el).addEventListener('keydown', (e) => {
          if (e.key === 'Enter') e.preventDefault();
        });
        listEl.addEventListener('change', (e) => {
          const cb = e.target.closest('input[type="checkbox"]');
          if (!cb) return;
          const p = results.find((r) => r.id === cb.value);
          if (!p) return;
          if (cb.checked) chosen.set(p.id, p);
          else chosen.delete(p.id);
          cb.closest('.sc-pick')?.classList.toggle('is-on', cb.checked);
          drawCount();
          if (Number.isFinite(max)) {
            drawList();
            listEl.querySelector(`input[value="${p.id}"]`)?.focus();
          }
        });
        okBtn.addEventListener('click', () => {
          result = [...chosen.values()];
          close();
        });
        drawCount();
        search();
      },
      onClose: () => resolve(result),
    });
  });
}

/* ---------- Seção (cartão com cabeçalho e lista) ---------- */
const sectionCard = ({ id, title, count, sub, tag = '', action = '', body }) => html`<section class="card sc-sec" aria-labelledby="${id}">
  <header class="sc-sec__head">
    <div class="sc-sec__txt"><h3 class="card__title" id="${id}">${title}<span class="count-pill count-pill--neu">${num(count)}</span>${tag}</h3>${sub ? html`<p class="card__sub">${sub}</p>` : ''}</div>
    ${action}
  </header>
  <div class="sc-sec__body">${body}</div>
</section>`;

/* ---------- Prateleiras ---------- */
async function shelvesTab(pane, ctx, alive, { onChange, focusId } = {}) {
  if (!ctx.storeId) {
    ctx.pickStore(pane, 'Cada loja tem as suas prateleiras. Escolha a loja para organizar a página inicial dela.');
    return;
  }
  const storeId = ctx.storeId;
  const canWrite = ctx.can('catalog', storeId);
  let rows = [];
  let covers = new Map();
  let busy = false;
  let seq = 0;

  // a carga mais recente vence (evita que uma resposta antiga desfaça uma alteração feita depois)
  const load = async (spinner = false) => {
    const my = ++seq;
    if (spinner) render(pane, skeleton('list', { rows: 4 }));
    try {
      const data = await q(sb.from('collections').select('*, collection_items(count)').eq('store_id', storeId).order('sort_order').order('title'));
      if (!alive() || my !== seq) return;
      rows = data.map((c) => ({ ...c, count: c.collection_items?.[0]?.count ?? 0 }));
      // capas: até 4 fotos de produto por prateleira
      if (rows.length) {
        try {
          const items = await q(sb.from('collection_items').select('collection_id, sort_order, product:products(image_url)').in('collection_id', rows.map((r) => r.id)).order('sort_order').limit(400));
          covers = new Map();
          items.forEach((it) => {
            const list = covers.get(it.collection_id) || [];
            if (list.length < 4 && it.product?.image_url) list.push(it.product.image_url);
            covers.set(it.collection_id, list);
          });
        } catch {
          covers = new Map();
        }
      }
      if (!alive() || my !== seq) return;
      draw();
      if (focusId) {
        flashRow(pane, focusId);
        focusId = null;
      }
    } catch (e) {
      if (!alive() || my !== seq) return;
      if (spinner || !rows.length) render(pane, retryBlock(e, () => load(true)));
      else toastError(e);
    }
  };

  const rowHTML = (c, i, n) => {
    const sortableRow = canWrite && n > 1;
    const pics = covers.get(c.id) || [];
    const state = !c.active ? badge('Inativa') : !c.count ? badge('Sem produtos', 'warning') : c.show_on_home ? badge('Na página inicial', 'success') : badge('Só pelo link', 'info');
    return html`<li class="sc-row sc-row--shelf ${c.active && c.count ? '' : 'is-off'}" data-id="${c.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${gripCol(i, sortableRow)}
      <button class="sc-stack" type="button" data-items aria-label="Produtos de “${c.title}” (${c.count})">
        ${pics.length ? pics.map((u) => html`<img src="${mediaUrl(u)}" alt="" loading="lazy">`) : html`<span class="sc-stack__none">${icon('products', 'icon-sm')}</span>`}
      </button>
      <div class="sc-info">
        <div class="sc-line">${state}${c.badge_all ? html`<span class="tag sc-seal">${icon('tag', 'icon-xs')} ${SEALS[c.badge_all] || c.badge_all}</span>` : ''}</div>
        <div class="sc-title">${c.title}</div>
        ${c.subtitle ? html`<div class="sc-text">${c.subtitle}</div>` : ''}
        <div class="sc-meta">
          <span class="sc-chip mono" title="Link da prateleira">${icon('link', 'icon-xs')}<span class="ellipsis">?colecao=${c.key}</span></span>
          <span>${icon('grid', 'icon-xs')}${LAYOUTS[c.layout] || c.layout}</span>
          ${!c.count && c.active ? html`<span class="sc-warn">${icon('alert', 'icon-xs')}Sem produtos, não aparece na loja</span>` : ''}
        </div>
      </div>
      <div class="sc-side">
        <button class="btn btn--sm sc-items-btn" type="button" data-items aria-label="Produtos de “${c.title}” (${c.count})">${icon('products', 'icon-sm')}<span class="sc-hide-sm">Produtos</span><span class="count-pill count-pill--neu">${num(c.count)}</span></button>
        ${canWrite ? html`${activeSwitch(c.id, c.active, 'Ativa', c.title)}${moveBtns(i, n, c.title)}${rowActions(c.title)}` : ''}
      </div>
    </li>`;
  };

  const draw = () => keepFocus(pane, paint);
  const paint = () => {
    const list = [...rows].sort(byOrder);
    const where = shortStore(ctx) || ctx.storeName(storeId);
    const newBtn = (primary = true) => html`<button class="btn ${primary ? 'btn--primary' : ''} btn--sm" type="button" data-new>${icon('plus', 'icon-sm')} Nova prateleira</button>`;
    render(
      pane,
      list.length
        ? sectionCard({
            id: 'sc-h-shelves',
            title: 'Prateleiras',
            count: list.length,
            sub: 'Faixas de produtos da página inicial, nesta ordem. Os mosaicos entram depois da 2ª e os ambientes depois da 3ª.',
            action: canWrite ? newBtn() : '',
            body: html`<ul class="sc-list" data-sortable="${canWrite && list.length > 1 ? 'shelves' : ''}">${list.map((c, i) => rowHTML(c, i, list.length))}</ul>
              ${canWrite && list.length > 1 ? html`<p class="sc-hintline">${icon('grip', 'icon-xs')} Arraste pela alça ou use as setas para mudar a ordem.</p>` : ''}`,
          })
        : html`<div class="card">${empty(
            'Vitrine vazia',
            `Escolha produtos para a página inicial de ${where}: crie uma prateleira, como “Ofertas da semana”, e adicione os produtos.`,
            canWrite ? html`<button class="btn btn--primary" type="button" data-new>${icon('plus', 'icon-sm')} Montar vitrine</button>` : '',
            { art: 'empty-box', size: 'lg' }
          )}</div>`
    );
    $$('[data-sortable="shelves"]', pane).forEach((el) => sortable(el, { item: '.sc-row[data-id]', onSort: (ids) => reorder(ids) }));
  };

  const reorder = async (ids, focus) => {
    if (busy) return;
    busy = true;
    seq += 1;
    try {
      const list = [...rows].sort(byOrder);
      if (await saveOrder('collections', list, ids)) {
        toast('Ordem das prateleiras salva', 'success', 2200);
        onChange?.();
      }
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
    if (!alive()) return;
    draw();
    focus?.();
    load();
  };

  pane.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) {
      return openCollectionEditor(ctx, {
        storeId,
        order: nextOrder(rows),
        onSaved: (created) => {
          load();
          onChange?.();
          if (created) openItems(ctx, { ...created, count: 0 }, () => (load(), onChange?.()));
        },
      });
    }
    const row = e.target.closest('.sc-row[data-id]');
    const item = row && rows.find((r) => r.id === row.dataset.id);
    if (!item) return;
    if (e.target.closest('[data-items]')) return openItems(ctx, item, () => (load(), onChange?.()));
    if (e.target.closest('[data-edit]')) return openCollectionEditor(ctx, { item, storeId, onSaved: () => (load(), onChange?.()) });
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: `Excluir a prateleira “${item.title}”?`,
        message: `${item.count === 1 ? 'O produto continua' : item.count ? `Os ${num(item.count)} produtos continuam` : 'Os produtos continuam'} no catálogo; só a prateleira some da loja. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir prateleira',
        danger: true,
      });
      if (!ok) return;
      try {
        await q(sb.from('collections').delete().eq('id', item.id));
        toast('Prateleira excluída', 'success');
        load();
        onChange?.();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const ids = swapIds(row.closest('.sc-list'), item.id, mv.dataset.move);
      if (ids) reorder(ids, () => focusMove(pane, item.id, mv.dataset.move));
    }
  });

  pane.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-active]');
    if (!inp) return;
    const id = inp.dataset.active;
    const value = inp.checked;
    if (!rows.some((r) => r.id === id)) return;
    seq += 1; // descarta cargas em andamento, que trariam o valor antigo
    inp.disabled = true;
    try {
      await q(sb.from('collections').update({ active: value }).eq('id', id));
      rows.forEach((r) => r.id === id && (r.active = value));
      toast(value ? 'Prateleira ativada' : 'Prateleira desativada', 'success', 2200);
      onChange?.();
      if (!alive()) return;
      draw();
      $(`[data-active="${id}"]`, pane)?.focus();
      load();
    } catch (err) {
      inp.checked = !value;
      inp.disabled = false;
      toastError(err);
      load();
    }
  });

  await load(true);
}

// Redesenha mantendo o foco no mesmo controle (mesma linha, mesma ação)
const FOCUS_ATTRS = ['data-active', 'data-move', 'data-edit', 'data-delete', 'data-items', 'data-remove', 'data-preview'];
function keepFocus(root, paint) {
  const a = document.activeElement;
  let key = null;
  if (a && root.contains(a)) {
    const row = a.closest('.sc-row[data-id]');
    const attr = FOCUS_ATTRS.find((n) => a.hasAttribute(n));
    if (row && attr) key = { id: row.dataset.id, attr, val: a.getAttribute(attr) };
  }
  paint();
  if (!key) return;
  const row = $(`.sc-row[data-id="${key.id}"]`, root);
  if (!row) return;
  let el = $(`[${key.attr}="${key.val}"]`, row);
  if (el?.disabled && key.attr === 'data-move') el = $('[data-move]:not([disabled])', row);
  (el && !el.disabled ? el : row.querySelector('button:not([disabled]), input:not([disabled])'))?.focus({ preventScroll: true });
}

function focusMove(root, id, dir) {
  const row = $(`.sc-row[data-id="${id}"]`, root);
  if (!row) return;
  const b = $(`[data-move="${dir}"]`, row);
  (b && !b.disabled ? b : $(`[data-move="${dir === 'up' ? 'down' : 'up'}"]`, row) || row)?.focus?.();
}

// Destaca uma linha (ex.: veio do mapa da página inicial)
function flashRow(root, id) {
  const row = $(`.sc-row[data-id="${id}"]`, root);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: smooth() });
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
  (row.querySelector('[data-items], [data-edit], button') || row).focus({ preventScroll: true });
}

function openCollectionEditor(ctx, { item = null, storeId, order = 1, onSaved }) {
  const isNew = !item;
  let keyTouched = !isNew;
  openModal({
    title: isNew ? 'Nova prateleira' : `Editar prateleira “${item.title}”`,
    cls: 'sc-ed',
    body: html`<form class="form-grid" data-form novalidate>
      <div class="field col-12">
        <label for="c-title">Título *</label>
        <input class="input" id="c-title" name="title" maxlength="80" required value="${item?.title || ''}" placeholder="Ofertas da semana" autofocus>
      </div>
      <div class="field col-12">
        <label for="c-sub">Subtítulo <span class="opt-tag">opcional</span></label>
        <input class="input" id="c-sub" name="subtitle" maxlength="140" value="${item?.subtitle || ''}" placeholder="Aparece abaixo do título na loja">
      </div>
      <div class="field col-12">
        <label for="c-key">Endereço da prateleira *</label>
        <div class="input-group"><span class="input-group__addon mono">?colecao=</span>
          <input class="input mono" id="c-key" name="key" maxlength="60" required value="${item?.key || ''}" autocomplete="off" spellcheck="false" placeholder="ofertas-da-semana"></div>
        <span class="hint" data-key-hint></span>
      </div>
      <div class="field col-6">
        <label for="c-layout">Layout</label>
        <select class="select" id="c-layout" name="layout" data-sheet-title="Layout da prateleira">${Object.entries(LAYOUTS).map(
          ([k, l]) => html`<option value="${k}" data-icon="grid" data-hint="${LAYOUT_HINT[k]}" ${(item?.layout || 'five') === k ? 'selected' : ''}>${l}</option>`
        )}</select>
      </div>
      <div class="field col-6">
        <label for="c-seal">Selo nos produtos</label>
        <select class="select" id="c-seal" name="badge_all" data-sheet-title="Selo para todos os produtos">${Object.entries(SEALS).map(
          ([k, l]) => html`<option value="${k}" data-hint="${SEAL_HINT[k]}" ${k ? 'data-icon="tag"' : ''} ${(item?.badge_all || '') === k ? 'selected' : ''}>${l}</option>`
        )}</select>
      </div>
      <div class="col-12 sc-ed__switches">
        ${switchField({ label: 'Mostrar na página inicial', name: 'show_on_home', checked: item ? item.show_on_home : true, hint: 'Desligado, a prateleira só abre pelo link.' })}
        ${switchField({ label: 'Ativa', name: 'active', checked: item ? item.active : true, hint: 'Inativa, some da loja virtual.' })}
      </div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar prateleira' : 'Salvar prateleira'}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      const keyEl = form.elements.key;
      const hint = $('[data-key-hint]', el);
      const drawHint = () => {
        const k = keyEl.value || 'chave';
        hint.textContent = isNew ? `Link na loja: ?colecao=${k} (lista completa) ou #${k} (rola até a prateleira).` : `Mudar o endereço altera os links que apontam para ?colecao=${item.key}.`;
      };
      form.elements.title.addEventListener('input', () => {
        if (!keyTouched) {
          keyEl.value = slugify(form.elements.title.value).slice(0, 60).replace(/-+$/, '');
          keyEl.dispatchEvent(new Event('change', { bubbles: true })); // limpa o erro do campo
          drawHint();
        }
      });
      keyEl.addEventListener('input', () => {
        keyTouched = true;
        drawHint();
      });
      keyEl.addEventListener('blur', () => {
        keyEl.value = slugify(keyEl.value).slice(0, 60).replace(/-+$/, '');
        drawHint();
      });
      drawHint();
      const save = async (btn) => {
        const d = readForm(form);
        const errors = {};
        if (!d.title) errors.title = 'Informe o título.';
        if (!d.key) errors.key = 'Informe o endereço.';
        else if (!KEY_RE.test(d.key)) errors.key = 'Use letras minúsculas, números e hífens (ex.: ofertas-da-semana).';
        if (!showErrors(form, errors)) return;
        if (isNew || d.key !== item.key) {
          try {
            const dup = await q(sb.from('collections').select('id').eq('store_id', storeId).eq('key', d.key).limit(1));
            if (dup.length) return showErrors(form, { key: 'Já existe uma prateleira com este endereço nesta loja.' });
          } catch {
            /* o banco confere de novo ao salvar */
          }
        }
        const payload = {
          title: d.title, key: d.key, subtitle: d.subtitle, layout: d.layout || 'five', badge_all: d.badge_all || null,
          show_on_home: d.show_on_home, active: d.active,
        };
        let created = null;
        try {
          await withBusy(btn, async () => {
            if (isNew) created = await q(sb.from('collections').insert({ ...payload, store_id: storeId, sort_order: order }).select().single());
            else await q(sb.from('collections').update(payload).eq('id', item.id));
          });
        } catch (err) {
          if (err.raw?.code === '23505') return showErrors(form, { key: 'Já existe uma prateleira com este endereço nesta loja.' });
          return toastError(err);
        }
        toast(isNew ? 'Prateleira criada. Agora escolha os produtos.' : 'Prateleira salva', 'success');
        close();
        onSaved?.(created);
      };
      $('[data-save]', el).addEventListener('click', (e) => save(e.currentTarget));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        save($('[data-save]', el));
      });
    },
  });
}

// Painel com os produtos de uma prateleira
function openItems(ctx, coll, onChange) {
  const canWrite = ctx.can('catalog', coll.store_id);
  let items = [];
  let busy = false;
  let changed = false;
  openModal({
    variant: 'panel',
    title: `Produtos · ${coll.title}`,
    cls: 'sc-items-panel',
    body: html`<div class="sc-items" data-items>${skeleton('list', { rows: 5 })}</div>`,
    actions: html`<button class="btn" type="button" data-close>Fechar</button>`,
    onClose: () => {
      if (changed) onChange?.();
    },
    onMount(el) {
      const box = $('[data-items]', el);
      const addBtn = (primary = false) => html`<button class="btn ${primary ? 'btn--primary' : ''} btn--sm" type="button" data-add>${icon('plus', 'icon-sm')} Adicionar produtos</button>`;

      let seq = 0;
      const load = async () => {
        const my = ++seq;
        try {
          const data = await q(
            sb.from('collection_items').select('product_id, sort_order, product:products(id,name,sku,price,image_url,status)').eq('collection_id', coll.id).order('sort_order')
          );
          if (my !== seq || !box.isConnected) return;
          items = data.map((r) => ({ ...r, id: r.product_id }));
          draw();
        } catch (e) {
          if (my === seq && box.isConnected) render(box, errorBlock(e, { retry: () => (render(box, skeleton('list', { rows: 5 })), load()) }));
        }
      };

      const draw = () => keepFocus(box, paint);
      const paint = () => {
        const n = items.length;
        const hidden = items.filter((it) => it.product?.status !== 'active').length;
        render(
          box,
          html`<div class="sc-items__head">
              <div class="grow"><p class="sc-items__n">${n ? plural(n, 'produto', 'produtos') : 'Nenhum produto'}</p>
              <p class="small muted">${canWrite && n > 1 ? 'Arraste ou use as setas para mudar a ordem na loja.' : coll.show_on_home === false ? 'Esta prateleira abre só pelo link.' : 'Na ordem em que aparecem na loja.'}</p></div>
              ${canWrite && n ? addBtn(true) : ''}
            </div>
            ${hidden ? html`<div class="callout callout--pix mb-3">${icon('alert')}<div><strong>${plural(hidden, 'produto não aparece', 'produtos não aparecem')} na loja</strong>Só produtos ativos entram na prateleira. Ative-os em Produtos ou tire daqui.</div></div>` : ''}
            ${n
              ? html`<ul class="sc-list sc-list--items" data-sortable="${canWrite && n > 1 ? 'items' : ''}">${items.map((it, i) => {
                  const p = it.product || {};
                  const name = p.name || 'Produto';
                  return html`<li class="sc-row sc-row--item ${p.status === 'active' ? '' : 'is-off'}" data-id="${it.id}" draggable="${canWrite && n > 1 ? 'true' : 'false'}">
                    ${gripCol(i, canWrite && n > 1)}
                    ${thumb(p.image_url)}
                    <div class="sc-info">
                      <div class="sc-title ellipsis">${name}</div>
                      <div class="sc-meta"><span class="mono">${p.sku || 'Sem SKU'}</span><span>${money(p.price)}</span>${p.status !== 'active' ? badge(PRODUCT_STATUS[p.status]?.label || p.status || '—', 'warning') : ''}</div>
                    </div>
                    <div class="sc-side">${canWrite
                      ? html`${moveBtns(i, n, name)}<button class="btn btn--ghost btn--sm sc-danger sc-rm" type="button" data-remove aria-label="Remover “${name}” da prateleira">${icon('trash', 'icon-sm')}<span class="sc-rm-label">Remover</span></button>`
                      : ''}</div>
                  </li>`;
                })}</ul>`
              : html`<div class="sc-items__empty">${empty('Prateleira vazia', 'Sem produtos, a prateleira não aparece na loja. Adicione os produtos na ordem em que quer mostrar.', canWrite ? addBtn(true) : '', { art: false, icon: 'products', size: 'sm' })}</div>`}`
        );
        $$('[data-sortable="items"]', box).forEach((l) => sortable(l, { item: '.sc-row[data-id]', onSort: (ids) => reorder(ids) }));
      };

      const reorder = async (ids, focus) => {
        if (busy) return;
        busy = true;
        seq += 1;
        try {
          const ok = await saveOrder(
            'collection_items',
            items,
            ids,
            (b, r) => b.eq('collection_id', coll.id).eq('product_id', r.product_id),
            (r) => r.product_id
          );
          if (ok) {
            items.sort(byOrder);
            changed = true;
            toast('Ordem salva', 'success', 2000);
          }
        } catch (e) {
          toastError(e);
          await load();
        } finally {
          busy = false;
        }
        if (!box.isConnected) return;
        draw();
        focus?.();
      };

      box.addEventListener('click', async (e) => {
        if (e.target.closest('[data-add]')) {
          const chosen = await pickProducts({ storeId: coll.store_id, exclude: new Set(items.map((it) => it.product_id)), title: `Adicionar à “${coll.title}”` });
          if (!chosen.length) return;
          const start = nextOrder(items);
          try {
            await q(sb.from('collection_items').insert(chosen.map((p, i) => ({ collection_id: coll.id, product_id: p.id, sort_order: start + i }))));
            changed = true;
            toast(`${plural(chosen.length, 'produto adicionado', 'produtos adicionados')}`, 'success');
          } catch (err) {
            toastError(err);
          }
          return load();
        }
        const row = e.target.closest('.sc-row[data-id]');
        const it = row && items.find((x) => x.id === row.dataset.id);
        if (!it) return;
        const rm = e.target.closest('[data-remove]');
        if (rm) {
          // dois cliques: o primeiro pede confirmação no próprio botão
          if (!rm.dataset.armed) {
            rm.dataset.armed = '1';
            rm.classList.add('is-armed');
            $('.sc-rm-label', rm).textContent = 'Confirmar';
            rm.setAttribute('aria-label', `Confirmar remoção de “${it.product?.name || 'produto'}”`);
            setTimeout(() => {
              if (!rm.isConnected) return;
              delete rm.dataset.armed;
              rm.classList.remove('is-armed');
              $('.sc-rm-label', rm).textContent = 'Remover';
              rm.setAttribute('aria-label', `Remover “${it.product?.name || 'produto'}” da prateleira`);
            }, 4000);
            return;
          }
          rm.disabled = true;
          seq += 1;
          try {
            await q(sb.from('collection_items').delete().eq('collection_id', coll.id).eq('product_id', it.product_id));
            items = items.filter((x) => x !== it);
            changed = true;
            toast('Produto removido da prateleira', 'success', 2200);
            draw();
          } catch (err) {
            rm.disabled = false;
            toastError(err);
          }
          return;
        }
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const ids = swapIds(row.closest('.sc-list'), it.id, mv.dataset.move);
          if (ids) reorder(ids, () => focusMove(box, it.id, mv.dataset.move));
        }
      });

      load();
    },
  });
}

/* ---------- Banners e avisos (escopo loja/rede) ---------- */
async function scopedTab(pane, ctx, alive, tab, { onChange } = {}) {
  const cfg = TAB_CFG[tab];
  const isAnn = cfg.table === 'announcements';
  const kindOf = (r) => (isAnn ? 'bar' : r.kind);
  const storeId = ctx.storeId;
  let rows = [];
  let pins = new Map();
  let perStore = [];
  let busy = false;
  let seq = 0;

  const fetchAll = async () => {
    let qb = sb.from(cfg.table).select('*').order('sort_order').order('created_at');
    if (!isAnn) qb = qb.in('kind', cfg.kinds);
    qb = storeId ? qb.or(`store_id.eq.${storeId},store_id.is.null`) : qb.is('store_id', null);
    let sq = null;
    if (!storeId) {
      sq = sb.from(cfg.table).select(isAnn ? 'store_id, active, starts_at, ends_at' : 'store_id, kind, active, starts_at, ends_at').not('store_id', 'is', null);
      if (!isAnn) sq = sq.in('kind', cfg.kinds);
    }
    const [list, counts] = await Promise.all([q(qb), sq ? q(sq) : []]);
    const ids = [...new Set(list.flatMap((b) => b.pin_product_ids || []))];
    const prods = ids.length ? await q(sb.from('products').select(PICK_COLS).in('id', ids)) : [];
    return { list, counts, prods };
  };

  const load = async (spinner = false) => {
    const my = ++seq;
    if (spinner) render(pane, skeleton('list', { rows: 3 }));
    try {
      const r = await fetchAll();
      if (!alive() || my !== seq) return;
      rows = r.list;
      perStore = r.counts || [];
      pins = new Map(r.prods.map((p) => [p.id, p]));
      draw();
    } catch (e) {
      if (!alive() || my !== seq) return;
      if (spinner || !rows.length) render(pane, retryBlock(e, () => load(true)));
      else toastError(e);
    }
  };

  const sectionRows = (kind, scope) => rows.filter((r) => kindOf(r) === kind && (scope === 'store' ? !!r.store_id : !r.store_id)).sort(byOrder);
  const canWriteScope = (scope) => (scope === 'network' ? ctx.isGlobal : ctx.can('catalog', storeId));

  const bannerRow = (b, i, n, canWrite) => {
    const st = liveState(b);
    const isHero = b.kind === 'hero';
    const sortableRow = canWrite && n > 1;
    const sch = scheduleLine(b);
    const pinList = isHero ? (b.pin_product_ids || []).map((id) => pins.get(id) || { id, missing: true }) : [];
    return html`<li class="sc-row ${isHero ? 'sc-row--hero' : 'sc-row--tile'} ${st.key === 'live' ? '' : 'is-off'}" data-id="${b.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${gripCol(i, sortableRow)}
      <button class="sc-media" type="button" data-preview aria-label="Ver prévia de “${b.title}”">
        ${isHero
          ? html`<span class="sc-media__desk">${thumb(b.image_url, 'sc-media__img')}<span class="sc-media__dev">${icon('monitor', 'icon-xs')}</span></span>
              <span class="sc-media__mob">${b.image_mobile_url ? thumb(b.image_mobile_url, 'sc-media__img') : html`<span class="sc-media__img sc-noimg" title="Sem imagem de celular: usa a de computador">${icon('image', 'icon-xs')}</span>`}<span class="sc-media__dev">${icon('phone', 'icon-xs')}</span></span>`
          : html`<span class="sc-media__sq">${thumb(b.image_url, 'sc-media__img')}</span>`}
        <span class="sc-media__eye">${icon('eye', 'icon-sm')}<span>Prévia</span></span>
      </button>
      <div class="sc-info">
        <div class="sc-line">${badge(st.label, st.tone)}${b.store_id ? '' : netTag()}${isHero && !b.image_mobile_url ? html`<span class="sc-warn" title="Sem imagem de celular: o celular usa a de computador">${icon('phone', 'icon-xs')}Sem versão de celular</span>` : ''}</div>
        ${b.kicker ? html`<div class="sc-kicker">${b.kicker}</div>` : ''}
        <div class="sc-title">${b.title}</div>
        ${b.text ? html`<div class="sc-text">${b.text}</div>` : ''}
        <div class="sc-meta">
          ${b.link_url ? html`<span class="sc-chip mono" title="Link">${icon('link', 'icon-xs')}<span class="ellipsis">${b.link_url}</span></span>` : html`<span class="faint">Sem link</span>`}
          <span class="${st.key === 'scheduled' ? 'sc-when is-info' : 'sc-when'}">${icon('clock', 'icon-xs')}${sch.text}${sch.soon ? html` · <b class="sc-soon">${sch.soon}</b>` : ''}</span>
        </div>
        ${pinList.length
          ? html`<div class="sc-pinline"><span class="small muted">No ambiente:</span>${pinList.map((p) =>
              p.missing
                ? badge('Produto removido', 'danger')
                : html`<span class="sc-pinchip ${p.status === 'active' ? '' : 'is-warn'}" title="${p.status === 'active' ? p.name : `${p.name} (não aparece: ${PRODUCT_STATUS[p.status]?.label || p.status})`}">${thumb(p.image_url, 'sc-pinchip__img')}<span class="ellipsis">${p.name}</span></span>`
            )}</div>`
          : ''}
      </div>
      <div class="sc-side sc-side--stack">${canWrite ? html`<div class="sc-side__top">${activeSwitch(b.id, b.active, 'Ativo', b.title)}</div><div class="sc-side__acts">${moveBtns(i, n, b.title)}${rowActions(b.title)}</div>` : readOnlyNote()}</div>
    </li>`;
  };

  const annRow = (a, i, n, canWrite) => {
    const st = liveState(a);
    const sortableRow = canWrite && n > 1;
    const sch = scheduleLine(a);
    const short = a.text.length > 40 ? `${a.text.slice(0, 40)}…` : a.text;
    return html`<li class="sc-row sc-row--bar ${st.key === 'live' ? '' : 'is-off'}" data-id="${a.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${gripCol(i, sortableRow)}
      <div class="sc-info">
        ${barPreview(a)}
        <div class="sc-meta">
          ${badge(st.label, st.tone)}${a.store_id ? '' : netTag()}
          ${a.cta_url ? html`<span class="sc-chip mono" title="Link do botão">${icon('link', 'icon-xs')}<span class="ellipsis">${a.cta_url}</span></span>` : html`<span class="faint">Sem botão</span>`}
          <span class="sc-when">${icon('clock', 'icon-xs')}${sch.text}${sch.soon ? html` · <b class="sc-soon">${sch.soon}</b>` : ''}</span>
        </div>
      </div>
      <div class="sc-side sc-side--stack">${canWrite ? html`<div class="sc-side__top">${activeSwitch(a.id, a.active, 'Ativo', short)}</div><div class="sc-side__acts">${moveBtns(i, n, short)}${rowActions(short)}</div>` : readOnlyNote()}</div>
    </li>`;
  };

  const sectionHTML = (kind, scope, primary) => {
    const G = GROUPS[kind];
    const list = sectionRows(kind, scope);
    const canWrite = canWriteScope(scope);
    const canCreate = canWrite && (scope === 'store' || !storeId);
    if (scope === 'network' && storeId && !list.length && !ctx.isGlobal) return '';
    const key = `${kind}-${scope}`;
    const sortableList = canWrite && list.length > 1;
    const where = shortStore(ctx) || 'esta loja';
    const desc =
      scope === 'store'
        ? `Aparecem só em ${where}, antes dos itens da rede.`
        : `Aparecem em todas as lojas${storeId ? ', depois dos itens de cada loja' : ', depois dos itens próprios de cada uma'}.${ctx.isGlobal ? '' : ' Só a administração da rede altera.'}`;
    const newBtn = html`<button class="btn ${primary ? 'btn--primary' : ''} btn--sm" type="button" data-new="${kind}" data-scope="${scope}">${icon('plus', 'icon-sm')} ${G.new}</button>`;
    const action = canCreate
      ? newBtn
      : scope === 'network' && ctx.isGlobal && storeId
        ? html`<button class="btn btn--sm btn--ghost" type="button" data-network-view>${icon('houses', 'icon-sm')} Criar na visão da rede</button>`
        : '';
    let body;
    if (list.length) {
      body = html`<ul class="sc-list" data-sortable="${sortableList ? `${kind}:${scope}` : ''}">${list.map((r, i) => (isAnn ? annRow : bannerRow)(r, i, list.length, canWrite))}</ul>`;
    } else if (scope === 'store' || !storeId) {
      body = empty(
        `${G.none} ${scope === 'store' ? 'desta loja' : 'da rede'}`,
        scope === 'store'
          ? `Os ${G.many} da rede aparecem no lugar. Crie ${G.art === 'o' ? 'um' : 'uma'} ${G.one} só para ${where} quando quiser uma campanha local.`
          : `${cap(G.many)} da rede aparecem em todas as lojas, depois dos itens próprios de cada uma.`,
        canCreate ? newBtn : '',
        { art: 'empty-box', size: 'inline' }
      );
    } else {
      body = html`<p class="sc-none">${icon('houses', 'icon-sm')} ${G.none} da rede no momento.</p>`;
    }
    return sectionCard({ id: `sc-h-${key}`, title: G[scope], count: list.length, sub: desc, tag: scope === 'network' ? netTag() : '', action, body });
  };

  const groupHTML = (kind, gi) => {
    const G = GROUPS[kind];
    const all = rows.filter((r) => kindOf(r) === kind);
    const live = all.filter((r) => liveState(r).key === 'live').length;
    const many = cfg.kinds.length > 1;
    // mosaicos 2 por linha, ambientes 4 por linha: avisa quando sobra espaço
    const odd = storeId && G.fit && live && live % G.fit;
    return html`<div class="sc-group">
      <div class="sc-group__head">
        <div class="grow">${many ? html`<h2 class="sc-group__t">${G.title}</h2>` : ''}<p class="sc-group__d">${G.desc}</p></div>
        ${storeId ? html`<span class="badge ${live ? 'badge--success' : ''}">${plural(live, `${G.one} no ar`, `${G.many} no ar`)} nesta loja</span>` : ''}
      </div>
      ${odd
        ? html`<div class="callout sc-fit">${icon('grid')}<div><strong>${plural(live, `${G.one} no ar`, `${G.many} no ar`)}: ${G.fit === 2 ? 'use números pares' : 'use múltiplos de 4'}</strong>Eles ficam ${G.fit} por linha na loja, então ${G.fit - (live % G.fit) === 1 ? 'sobra 1 espaço vazio' : `sobram ${G.fit - (live % G.fit)} espaços vazios`} na última linha. Adicione ou desligue ${G.fit - (live % G.fit) === 1 && live % G.fit === 1 ? 'um' : 'alguns'}.</div></div>`
        : ''}
      ${storeId ? [sectionHTML(kind, 'store', gi === 0), sectionHTML(kind, 'network', false)] : sectionHTML(kind, 'network', gi === 0)}
    </div>`;
  };

  const storesHTML = () => {
    const by = new Map();
    perStore.forEach((r) => {
      const s = by.get(r.store_id) || { total: 0, live: 0 };
      s.total += 1;
      if (liveState(r).key === 'live') s.live += 1;
      by.set(r.store_id, s);
    });
    return html`<section class="card sc-sec" aria-labelledby="sc-h-stores">
      <header class="sc-sec__head"><div class="sc-sec__txt">
        <h3 class="card__title" id="sc-h-stores">${cfg.summary}</h3>
        <p class="card__sub">Cada loja pode ter itens próprios, que aparecem antes dos da rede. Abra uma loja para gerenciá-los.</p>
      </div></header>
      <div class="sc-sec__body"><ul class="sc-stores">${ctx.stores.map((s) => {
        const c = by.get(s.id) || { total: 0, live: 0 };
        return html`<li><button class="sc-store" type="button" data-goto-store="${s.id}">
          ${storeMark(s, 32)}
          <span class="sc-store__txt"><strong class="ellipsis">${ctx.storeShort?.(s) || s.name}</strong>
          <span class="sub">${c.total ? `${plural(c.total, 'próprio', 'próprios')} · ${c.live ? `${num(c.live)} no ar` : 'nenhum no ar'}` : 'Usa só os itens da rede'}</span></span>
          ${icon('chevronRight', 'icon-sm')}
        </button></li>`;
      })}</ul></div>
    </section>`;
  };

  const tipHTML = () => {
    if (tab !== 'hero') return '';
    const noMobile = rows.filter((r) => r.kind === 'hero' && !r.image_mobile_url && liveState(r).key === 'live' && canWriteScope(r.store_id ? 'store' : 'network'));
    if (!noMobile.length) return '';
    return tip({
      id: `hero-mobile-${storeId || 'net'}`,
      text: `${noMobile.length === 1 ? '1 slide no ar está' : `${noMobile.length} slides no ar estão`} sem a imagem de celular. Com ela, o banner aparece inteiro e nítido no celular, onde está a maioria dos clientes.`,
      action: { label: noMobile.length === 1 ? 'Enviar imagem de celular' : 'Revisar o primeiro', onClick: () => editor({ item: noMobile[0], kind: 'hero', storeId: noMobile[0].store_id, onSaved: () => (load(), onChange?.()) }) },
    });
  };

  const draw = () => keepFocus(pane, paint);
  const paint = () => {
    render(
      pane,
      html`<div class="stack sc-tab">
        ${tipHTML()}
        ${cfg.kinds.map(groupHTML)}
        ${!storeId ? storesHTML() : ''}
      </div>`
    );
    $$('[data-sortable]', pane)
      .filter((el) => el.dataset.sortable)
      .forEach((el) => sortable(el, { item: '.sc-row[data-id]', onSort: (ids) => reorder(el.dataset.sortable, ids) }));
  };

  const reorder = async (key, ids, focus) => {
    if (busy) return;
    const [kind, scope] = key.split(':');
    busy = true;
    seq += 1;
    try {
      if (await saveOrder(cfg.table, sectionRows(kind, scope), ids)) {
        toast('Ordem salva', 'success', 2000);
        onChange?.();
      }
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
    if (!alive()) return;
    draw();
    focus?.();
    load();
  };

  const editor = (opts) => (isAnn ? openAnnouncementEditor(ctx, opts) : openBannerEditor(ctx, opts));
  const saved = () => {
    load();
    onChange?.();
  };

  pane.addEventListener('click', async (e) => {
    const goto = e.target.closest('[data-goto-store]');
    if (goto) return ctx.setStore(goto.dataset.gotoStore, `#/showcase/${tab}`);
    if (e.target.closest('[data-network-view]')) return ctx.setStore(null, `#/showcase/${tab}`);
    const nb = e.target.closest('[data-new]');
    if (nb) {
      const kind = nb.dataset.new;
      const scope = nb.dataset.scope;
      return editor({ kind, storeId: scope === 'store' ? storeId : null, order: nextOrder(sectionRows(kind, scope)), onSaved: saved });
    }
    const row = e.target.closest('.sc-row[data-id]');
    const item = row && rows.find((r) => r.id === row.dataset.id);
    if (!item) return;
    const G = GROUPS[kindOf(item)];
    const name = isAnn ? item.text : item.title;
    const canWrite = canWriteScope(item.store_id ? 'store' : 'network');
    if (e.target.closest('[data-preview]')) return openPreview(ctx, item, { canWrite, onEdit: () => editor({ item, kind: kindOf(item), storeId: item.store_id, onSaved: saved }) });
    if (e.target.closest('[data-edit]')) return editor({ item, kind: kindOf(item), storeId: item.store_id, onSaved: saved });
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: `Excluir ${G.art} ${G.one} “${name.length > 48 ? `${name.slice(0, 48)}…` : name}”?`,
        message: `${item.store_id ? `Sai da loja ${shortStore(ctx) || ''}`.trim() : 'Sai de todas as lojas'} na hora. Para tirar do ar só por um tempo, desligue o “Ativo”. Esta ação não pode ser desfeita.`,
        confirmLabel: `Excluir ${G.one}`,
        danger: true,
      });
      if (!ok) return;
      try {
        await q(sb.from(cfg.table).delete().eq('id', item.id));
        if (!isAnn) releaseImages([item.image_url, item.image_mobile_url]);
        toast(`${cap(G.one)} excluído`, 'success');
        saved();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const list = row.closest('[data-sortable]');
      const ids = list && swapIds(list, item.id, mv.dataset.move);
      if (ids) reorder(list.dataset.sortable, ids, () => focusMove(pane, item.id, mv.dataset.move));
    }
  });

  pane.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-active]');
    if (!inp) return;
    const id = inp.dataset.active;
    const value = inp.checked;
    const item = rows.find((r) => r.id === id);
    if (!item) return;
    seq += 1; // descarta cargas em andamento, que trariam o valor antigo
    inp.disabled = true;
    try {
      await q(sb.from(cfg.table).update({ active: value }).eq('id', id));
      rows.forEach((r) => r.id === id && (r.active = value));
      const G = GROUPS[kindOf(item)];
      toast(`${cap(G.one)} ${value ? 'ativado' : 'desativado'}`, 'success', 2000);
      onChange?.();
      if (!alive()) return;
      draw();
      $(`[data-active="${id}"]`, pane)?.focus();
      load();
    } catch (err) {
      inp.checked = !value;
      inp.disabled = false;
      toastError(err);
      load();
    }
  });

  await load(true);
}

/* ---------- Editor de banner (slide, mosaico, ambiente) ---------- */
function openBannerEditor(ctx, { item = null, kind, storeId = null, order = 1, onSaved }) {
  const isNew = !item;
  const isHero = kind === 'hero';
  const scopeStore = isNew ? storeId : item.store_id;
  const pinsAllowed = isHero && !!scopeStore;
  const scope = scopeStore ? { storeId: scopeStore } : { network: true };
  const orig = { image_url: item?.image_url || null, image_mobile_url: item?.image_mobile_url || null };
  const uploads = new Set();
  let final = null;
  let pins = [];
  let pvMode = 'desk';
  const G = GROUPS[kind];
  const sizeHint = (k) => (k === 'room' ? 'Quadrada, 900 × 900 px.' : k === 'mosaic' ? 'Quadrada, 1400 × 1400 px.' : 'Computador: 2400 × 900 px (proporção 8:3).');
  const where = scopeStore ? ctx.storeShort?.(scopeStore) || ctx.storeName(scopeStore) : 'Toda a rede';
  const titleFor = (g) => (isNew ? `${g.new}${scopeStore ? '' : ' da rede'}` : `Editar ${g.one}${scopeStore ? '' : ' da rede'}`);

  openModal({
    title: titleFor(G),
    size: 'lg',
    cls: 'sc-ed sc-ed--banner',
    body: html`<form class="sc-form" data-form novalidate>
      <section class="sc-ed__pv" aria-label="Prévia">
        <div class="sc-ed__pvhead"><span class="sc-ed__ov">Prévia na loja · ${where}</span>${
          isHero ? segmented({ name: 'pv', label: 'Tela da prévia', options: [['desk', 'Computador', 'monitor'], ['mobile', 'Celular', 'phone']], value: 'desk', size: 'sm' }) : ''
        }</div>
        <div class="sc-ed__stage" data-pv></div>
      </section>
      <fieldset class="sc-fs">
        <legend class="sc-fs__t">Conteúdo</legend>
        <div class="form-grid">
          ${isHero
            ? html`<div class="field col-4">
                <label for="b-kicker">Chamada <span class="opt-tag">opcional</span></label>
                <input class="input" id="b-kicker" name="kicker" maxlength="40" value="${item?.kicker || ''}" placeholder="Nova coleção">
              </div>`
            : html`<div class="field col-4">
                <label for="b-kind">Tipo</label>
                <select class="select" id="b-kind" name="kind" data-sheet-title="Tipo de bloco">
                  <option value="mosaic" data-icon="grid" data-hint="2 por linha, com texto" ${kind === 'mosaic' ? 'selected' : ''}>Mosaico (inspiração)</option>
                  <option value="room" data-icon="sofa" data-hint="4 por linha, só o título" ${kind === 'room' ? 'selected' : ''}>Ambiente</option>
                </select>
              </div>`}
          <div class="field col-8">
            <label for="b-title">Título *</label>
            <input class="input" id="b-title" name="title" maxlength="80" required value="${item?.title || ''}" autofocus>
          </div>
          <div class="field col-12">
            <label for="b-text">Texto <span class="opt-tag" data-text-count></span></label>
            <textarea class="textarea" id="b-text" name="text" maxlength="200" rows="2" style="min-height:64px">${item?.text || ''}</textarea>
          </div>
          <div class="field col-12">
            <label for="b-link">Link</label>
            <input class="input mono" id="b-link" name="link_url" list="sc-link-list" maxlength="500" value="${item?.link_url || ''}" placeholder="#ofertas" autocomplete="off" spellcheck="false">
            <datalist id="sc-link-list"></datalist>
            <span class="hint">Ex.: #ofertas (prateleira), ?categoria=sofas ou um endereço completo (https://…).</span>
          </div>
        </div>
      </fieldset>
      <fieldset class="sc-fs">
        <legend class="sc-fs__t">Imagens</legend>
        <div class="form-grid">
          <div class="field ${isHero ? 'col-8' : 'col-12'}">
            <span class="label" id="b-img-l">${isHero ? 'Computador *' : 'Imagem *'}</span>
            <div class="sc-up ${isHero ? 'sc-up--wide' : 'sc-up--square'}" data-up="image_url" role="group" aria-labelledby="b-img-l"></div>
            <input type="hidden" name="image_url">
            <span class="hint" data-size-hint>${sizeHint(kind)}</span>
          </div>
          ${isHero
            ? html`<div class="field col-4">
                <span class="label" id="b-imgm-l">Celular <span class="opt-tag">recomendado</span></span>
                <div class="sc-up sc-up--tall" data-up="image_mobile_url" role="group" aria-labelledby="b-imgm-l"></div>
                <input type="hidden" name="image_mobile_url">
                <span class="hint">900 × 1323 px. Sem ela, o celular usa a de computador.</span>
              </div>`
            : ''}
        </div>
      </fieldset>
      ${isHero
        ? html`<fieldset class="sc-fs">
            <legend class="sc-fs__t">Produtos “No ambiente”</legend>
            ${pinsAllowed
              ? html`<div data-pins></div><span class="hint">Até ${MAX_PINS} produtos da loja aparecem sobre o slide (só os ativos).</span>`
              : html`<p class="small muted">Disponível só nos slides de uma loja, porque cada loja tem o seu catálogo.</p>`}
          </fieldset>`
        : ''}
      <div class="sc-fs form-grid">
        ${scheduleField({ id: 'b-sch', starts: item?.starts_at, ends: item?.ends_at, legend: 'Quando fica no ar', startLabel: 'Entra no ar', endLabel: 'Sai do ar', startHint: 'Em branco: entra ao salvar.', endHint: 'Em branco: sem data para sair.' })}
        <div class="col-8">${switchField({ label: 'Ativo', name: 'active', checked: item ? item.active : true, hint: 'Desligue para tirar do ar sem excluir.' })}</div>
        <div class="field col-4">
          <label for="s-order">Posição</label>
          <input class="input" type="number" inputmode="numeric" min="0" step="1" id="s-order" name="sort_order" data-type="int" value="${item ? item.sort_order : order}">
          <span class="hint">Menor aparece primeiro.</span>
        </div>
      </div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? `Criar ${G.one}` : `Salvar ${G.one}`}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      fillDatalist(el, scopeStore);
      const sched = bindSchedule(form, { mode: 'banner', isActive: () => form.elements.active.checked });
      const ups = {};
      const curKind = () => (isHero ? 'hero' : form.elements.kind.value);
      const drawPv = () => {
        const v = {
          kind: curKind(),
          title: form.elements.title.value.trim(),
          kicker: isHero ? form.elements.kicker.value.trim() : '',
          text: form.elements.text.value.trim(),
          image_url: ups.image_url?.value[0] && !ups.image_url.value[0].startsWith('data:') ? ups.image_url.value[0] : form.elements.image_url.value,
          image_mobile_url: isHero && ups.image_mobile_url?.value[0] && !ups.image_mobile_url.value[0].startsWith('data:') ? ups.image_mobile_url.value[0] : isHero ? form.elements.image_mobile_url.value : '',
        };
        render($('[data-pv]', el), isHero ? heroPreview(v, pvMode) : tilePreview(v));
        $('[data-pv]', el).className = `sc-ed__stage is-${isHero ? `hero-${pvMode}` : 'tile'}`;
        const tc = $('[data-text-count]', el);
        if (tc) tc.textContent = `${form.elements.text.value.length} / 200`;
      };
      el.addEventListener('seg:change', (e) => {
        if (e.detail.name !== 'pv') return;
        pvMode = e.detail.value;
        drawPv();
      });
      form.addEventListener('input', drawPv);
      for (const name of isHero ? ['image_url', 'image_mobile_url'] : ['image_url']) {
        const box = $(`[data-up="${name}"]`, el);
        form.elements[name].value = orig[name] || '';
        // "remover" só tira da lista; o arquivo sai do storage depois de salvar
        box.addEventListener(
          'click',
          (e) => {
            const rm = e.target.closest('[data-remove]');
            if (!rm || !box.contains(rm)) return;
            e.preventDefault();
            e.stopPropagation();
            ups[name].set([]);
            form.elements[name].value = '';
            drawPv();
          },
          true
        );
        ups[name] = imageUploader(box, {
          value: orig[name] ? [orig[name]] : [],
          scope,
          max: 1,
          folder: 'banners',
          label: name === 'image_mobile_url' ? 'Enviar' : 'Enviar imagem',
          onChange: (urls) => {
            const u = urls[0] || '';
            if (u && !u.startsWith('data:') && u !== orig[name]) uploads.add(u);
            form.elements[name].value = u.startsWith('data:') ? '' : u;
            if (form.elements[name].value) $$(`.error[data-for="${name}"]`, form).forEach((n) => n.remove());
            drawPv();
          },
        });
      }
      if (!isHero) {
        form.elements.kind.addEventListener('change', () => {
          const k = form.elements.kind.value;
          $('[data-size-hint]', el).textContent = sizeHint(k);
          const t = titleFor(GROUPS[k]);
          $('.modal__title', el).textContent = t;
          el.setAttribute('aria-label', t);
          $('[data-save]', el).textContent = isNew ? `Criar ${GROUPS[k].one}` : `Salvar ${GROUPS[k].one}`;
          drawPv();
        });
      }
      drawPv();

      // Produtos "No ambiente"
      const pinsEl = $('[data-pins]', el);
      const drawPins = () => {
        if (!pinsEl) return;
        render(
          pinsEl,
          html`${pins.length
            ? html`<ul class="sc-pins">${pins.map(
                (p, i) => html`<li class="sc-pin ${p.missing ? 'is-missing' : ''}">
                  ${thumb(p.image_url)}
                  <span class="sc-pin__name"><strong class="ellipsis">${p.name}</strong>
                  <span class="sub">${p.missing ? 'Não encontrado no catálogo; será retirado ao salvar' : `${p.sku || 'Sem SKU'} · ${money(p.price)}${p.status && p.status !== 'active' ? ` · ${PRODUCT_STATUS[p.status]?.label || p.status} (não aparece)` : ''}`}</span></span>
                  ${moveBtns(i, pins.length, p.name)}
                  <button class="btn btn--ghost btn--sm btn--icon sc-danger" type="button" data-pin-remove="${i}" aria-label="Tirar “${p.name}” do slide">${icon('close', 'icon-sm')}</button>
                </li>`
              )}</ul>`
            : ''}
          ${pins.length < MAX_PINS ? html`<button class="btn btn--sm sc-pin-add" type="button" data-pin-add>${icon('plus', 'icon-sm')} Adicionar produto <span class="muted">(${pins.length}/${MAX_PINS})</span></button>` : ''}`
        );
      };
      if (pinsEl) {
        const ids = item?.pin_product_ids || [];
        if (ids.length) {
          render(pinsEl, skeleton('list', { rows: Math.min(ids.length, MAX_PINS) }));
          q(sb.from('products').select(PICK_COLS).in('id', ids))
            .then((list) => {
              const m = new Map(list.map((p) => [p.id, p]));
              pins = ids.map((id) => m.get(id) || { id, name: 'Produto removido', missing: true });
            })
            .catch((err) => {
              pins = ids.map((id) => ({ id, name: 'Produto (não carregado)' }));
              toastError(err);
            })
            .finally(drawPins);
        } else drawPins();
        pinsEl.addEventListener('click', async (e) => {
          if (e.target.closest('[data-pin-add]')) {
            const chosen = await pickProducts({ storeId: scopeStore, exclude: new Set(pins.map((p) => p.id)), max: MAX_PINS - pins.length, title: 'Produtos no ambiente' });
            if (chosen.length) {
              pins.push(...chosen.slice(0, MAX_PINS - pins.length));
              drawPins();
            }
            return;
          }
          const rm = e.target.closest('[data-pin-remove]');
          if (rm) {
            pins.splice(Number(rm.dataset.pinRemove), 1);
            drawPins();
            $('[data-pin-add]', pinsEl)?.focus();
            return;
          }
          const mv = e.target.closest('[data-move]');
          if (mv) {
            const i = $$('.sc-pin', pinsEl).indexOf(mv.closest('.sc-pin'));
            const j = mv.dataset.move === 'up' ? i - 1 : i + 1;
            if (i < 0 || j < 0 || j >= pins.length) return;
            [pins[i], pins[j]] = [pins[j], pins[i]];
            drawPins();
            const b = $$('.sc-pin', pinsEl)[j]?.querySelector(`[data-move="${mv.dataset.move}"]`);
            (b && !b.disabled ? b : $$('.sc-pin', pinsEl)[j]?.querySelector('[data-move]'))?.focus();
          }
        });
      }
      form.elements.active.addEventListener('change', () => sched.refresh());

      const save = async (btn) => {
        if (Object.values(ups).some((u) => u.value.some((x) => x.startsWith('data:')))) return toast('Aguarde o envio da imagem terminar.', 'warning');
        const d = readForm(form);
        const errors = {};
        if (!d.title) errors.title = 'Informe o título.';
        if (!d.image_url) errors.image_url = 'Envie a imagem.';
        if (d.link_url && !LINK_RE.test(d.link_url)) errors.link_url = LINK_HELP;
        const when = sched.validate(errors);
        if (d.sort_order === null || !Number.isInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 100000) errors.sort_order = 'Use um número inteiro de 0 em diante.';
        if (!showErrors(form, errors)) {
          // a imagem é um campo escondido: leva o foco até o envio
          const first = $('[aria-invalid="true"]', form);
          if (first?.type === 'hidden') {
            const f = first.closest('.field');
            f?.scrollIntoView({ block: 'center', behavior: smooth() });
            $('[data-add]', f)?.focus({ preventScroll: true });
          }
          return;
        }
        const payload = {
          kind: isHero ? 'hero' : d.kind,
          title: d.title,
          text: d.text,
          link_url: d.link_url,
          image_url: d.image_url,
          starts_at: when.starts_at,
          ends_at: when.ends_at,
          sort_order: d.sort_order,
          active: d.active,
        };
        if (isHero) {
          payload.kicker = d.kicker;
          payload.image_mobile_url = d.image_mobile_url;
        }
        if (pinsAllowed) payload.pin_product_ids = pins.filter((p) => !p.missing).map((p) => p.id);
        try {
          await withBusy(btn, () =>
            isNew ? q(sb.from('banners').insert({ ...payload, store_id: scopeStore })) : q(sb.from('banners').update(payload).eq('id', item.id))
          );
        } catch (err) {
          return toastError(err);
        }
        final = { image_url: payload.image_url, image_mobile_url: isHero ? payload.image_mobile_url : orig.image_mobile_url };
        toast(isNew ? `${cap(GROUPS[payload.kind].one)} criado` : `${cap(GROUPS[payload.kind].one)} salvo`, 'success');
        close();
        onSaved?.();
      };
      $('[data-save]', el).addEventListener('click', (e) => save(e.currentTarget));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        save($('[data-save]', el));
      });
    },
    onClose: () => {
      const keep = new Set(Object.values(final || orig).filter(Boolean));
      uploads.forEach((u) => {
        if (!keep.has(u)) removeImage(u).catch(() => {});
      });
      if (final) releaseImages(Object.values(orig).filter((u) => u && !keep.has(u)));
    },
  });
}

/* ---------- Editor de aviso ---------- */
function openAnnouncementEditor(ctx, { item = null, storeId = null, order = 1, onSaved }) {
  const isNew = !item;
  const scopeStore = isNew ? storeId : item.store_id;
  const MAX = 160;
  const where = scopeStore ? ctx.storeShort?.(scopeStore) || ctx.storeName(scopeStore) : 'Toda a rede';
  openModal({
    title: isNew ? `Novo aviso${scopeStore ? '' : ' da rede'}` : `Editar aviso${scopeStore ? '' : ' da rede'}`,
    size: 'lg',
    cls: 'sc-ed',
    body: html`<form class="sc-form" data-form novalidate>
      <section class="sc-ed__pv" aria-label="Prévia">
        <div class="sc-ed__pvhead"><span class="sc-ed__ov">Prévia no topo da loja · ${where}</span></div>
        <div class="sc-ed__barstage"><div data-preview></div><span class="sc-ed__fake" aria-hidden="true"><i></i><i></i><i></i></span></div>
      </section>
      <fieldset class="sc-fs">
        <legend class="sc-fs__t">Mensagem</legend>
        <div class="form-grid">
          <div class="field col-12">
            <label for="a-text">Texto * <span class="opt-tag" data-count></span></label>
            <textarea class="textarea" id="a-text" name="text" maxlength="${MAX}" rows="2" style="min-height:64px" required autofocus placeholder="Frete grátis acima de R$ 999 na sua cidade">${item?.text || ''}</textarea>
            <span class="hint">Textos curtos cabem melhor no celular.</span>
          </div>
          <div class="field col-6">
            <label for="a-cta">Texto do botão <span class="opt-tag">opcional</span></label>
            <input class="input" id="a-cta" name="cta_label" maxlength="30" value="${item?.cta_label || ''}" placeholder="Ver ofertas">
          </div>
          <div class="field col-6">
            <label for="a-url">Link do botão</label>
            <input class="input mono" id="a-url" name="cta_url" list="sc-link-list" maxlength="500" value="${item?.cta_url || ''}" placeholder="#ofertas" autocomplete="off" spellcheck="false">
            <datalist id="sc-link-list"></datalist>
          </div>
          <p class="col-12 hint sc-ann-hint">${icon('info', 'icon-xs')} O botão aparece quando os dois campos estão preenchidos.</p>
        </div>
      </fieldset>
      <div class="sc-fs form-grid">
        ${scheduleField({ id: 'a-sch', starts: item?.starts_at, ends: item?.ends_at, legend: 'Quando fica no ar', startLabel: 'Entra no ar', endLabel: 'Sai do ar', startHint: 'Em branco: entra ao salvar.', endHint: 'Em branco: sem data para sair.' })}
        <div class="col-8">${switchField({ label: 'Ativo', name: 'active', checked: item ? item.active : true, hint: 'Desligue para tirar do ar sem excluir.' })}</div>
        <div class="field col-4">
          <label for="s-order">Posição</label>
          <input class="input" type="number" inputmode="numeric" min="0" step="1" id="s-order" name="sort_order" data-type="int" value="${item ? item.sort_order : order}">
          <span class="hint">Menor aparece primeiro.</span>
        </div>
      </div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar aviso' : 'Salvar aviso'}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      fillDatalist(el, scopeStore);
      const sched = bindSchedule(form, { mode: 'banner', isActive: () => form.elements.active.checked });
      const preview = () => {
        const t = form.elements.text.value.trim();
        const l = form.elements.cta_label.value.trim();
        const u = form.elements.cta_url.value.trim();
        $('[data-count]', el).textContent = `${form.elements.text.value.length} / ${MAX}`;
        render($('[data-preview]', el), barPreview({ text: t, cta_label: l, cta_url: u }));
      };
      form.addEventListener('input', preview);
      form.elements.active.addEventListener('change', () => sched.refresh());
      preview();
      const save = async (btn) => {
        const d = readForm(form);
        const errors = {};
        if (!d.text) errors.text = 'Escreva o aviso.';
        if (d.cta_label && !d.cta_url) errors.cta_url = 'Informe o link do botão.';
        if (d.cta_url && !d.cta_label) errors.cta_label = 'Informe o texto do botão.';
        if (d.cta_url && !LINK_RE.test(d.cta_url)) errors.cta_url = LINK_HELP;
        const when = sched.validate(errors);
        if (d.sort_order === null || !Number.isInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 100000) errors.sort_order = 'Use um número inteiro de 0 em diante.';
        if (!showErrors(form, errors)) return;
        const payload = { text: d.text, cta_label: d.cta_label, cta_url: d.cta_url, starts_at: when.starts_at, ends_at: when.ends_at, sort_order: d.sort_order, active: d.active };
        try {
          await withBusy(btn, () =>
            isNew ? q(sb.from('announcements').insert({ ...payload, store_id: scopeStore })) : q(sb.from('announcements').update(payload).eq('id', item.id))
          );
        } catch (err) {
          return toastError(err);
        }
        toast(isNew ? 'Aviso criado' : 'Aviso salvo', 'success');
        close();
        onSaved?.();
      };
      $('[data-save]', el).addEventListener('click', (e) => save(e.currentTarget));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        save($('[data-save]', el));
      });
    },
  });
}

/* ---------- Mapa da página inicial ---------- */
function homeMap(ctx, sum, tab) {
  if (!sum) return html`<div class="card sc-map">${skeleton('list', { rows: 5 })}</div>`;
  const now = Date.now();
  const live = (list) => list.filter((r) => liveState(r, now).key === 'live').sort((a, b) => (!!b.store_id - !!a.store_id) || byOrder(a, b));
  const bars = live(sum.bars);
  const heroes = live(sum.banners.filter((b) => b.kind === 'hero'));
  const mosaics = live(sum.banners.filter((b) => b.kind === 'mosaic'));
  const rooms = live(sum.banners.filter((b) => b.kind === 'room'));
  const shelves = sum.shelves.filter((c) => c.active && c.show_on_home && c.count > 0).sort(byOrder);
  const offShelves = sum.shelves.length - shelves.length;
  const offBanners = sum.banners.filter((b) => liveState(b, now).key !== 'live').length + sum.bars.filter((b) => liveState(b, now).key !== 'live').length;
  const cur = (t) => (t === tab ? 'is-current' : '');
  const block = (t, cls, label, inner, gotoId = '') =>
    html`<button class="sc-mb sc-mb--${cls} ${cur(t)}" type="button" data-goto-tab="${t}" ${gotoId ? html`data-goto-id="${gotoId}"` : ''} aria-label="${label}">${inner}</button>`;
  const ghost = (cls, label) => html`<span class="sc-mb sc-mb--${cls} is-auto" aria-hidden="true"><span class="sc-mb__l">${label}</span></span>`;
  const tiles = (list, n) => html`<span class="sc-mb__tiles is-${n}">${list.slice(0, n).map((b) => html`<span>${b.image_url ? html`<img src="${mediaUrl(b.image_url)}" alt="" loading="lazy">` : ''}</span>`)}</span>`;
  const mosaicBlock = mosaics.length ? block('tiles', 'mosaic', `Mosaicos: ${mosaics.length} no ar`, html`${tiles(mosaics, 2)}<span class="sc-mb__l">Mosaicos · ${num(mosaics.length)}</span>`) : '';
  const roomBlock = rooms.length ? block('tiles', 'room', `Ambientes: ${rooms.length} no ar`, html`${tiles(rooms, 4)}<span class="sc-mb__l">Ambientes · ${num(rooms.length)}</span>`) : '';
  const parts = [];
  if (ctx.storeId) {
    shelves.forEach((c, i) => {
      parts.push(
        block('shelves', 'shelf', `Prateleira ${i + 1}: ${c.title}`, html`<span class="sc-mb__n">${i + 1}</span><span class="sc-mb__l">${c.title}</span><span class="sc-mb__prods" aria-hidden="true">${Array.from({ length: c.layout === 'six' ? 6 : 5 }, () => html`<i></i>`)}</span>`, c.id)
      );
      if (i === 0) parts.push(ghost('auto', 'Vantagens da loja · automático'));
      if (i === 1 && mosaicBlock) parts.push(mosaicBlock);
      if (i === 2 && roomBlock) parts.push(roomBlock);
    });
    if (shelves.length < 2 && mosaicBlock) parts.push(mosaicBlock);
    if (shelves.length < 3 && roomBlock) parts.push(roomBlock);
    if (!shelves.length) parts.unshift(block('shelves', 'shelf is-empty', 'Nenhuma prateleira na página inicial', html`<span class="sc-mb__l">Nenhuma prateleira no ar</span>`));
  } else {
    parts.push(ghost('auto', 'Prateleiras de cada loja'));
    if (mosaicBlock) parts.push(mosaicBlock);
    if (roomBlock) parts.push(roomBlock);
  }
  const notes = [];
  if (offShelves && ctx.storeId) notes.push(plural(offShelves, 'prateleira fora da página (inativa, sem produtos ou só pelo link)', 'prateleiras fora da página (inativas, sem produtos ou só pelo link)'));
  if (offBanners) notes.push(plural(offBanners, 'item agendado, encerrado ou desligado', 'itens agendados, encerrados ou desligados'));
  return html`<section class="card sc-map" aria-labelledby="sc-map-t">
    <header class="sc-map__head"><h2 class="card__title" id="sc-map-t">${icon('layers', 'icon-sm')} Página inicial</h2>
      <p class="card__sub">${ctx.storeId ? `${shortStore(ctx)}, na ordem em que o cliente vê` : 'Itens da rede, em todas as lojas'}</p></header>
    <div class="sc-map__page">
      <span class="sc-map__chrome" aria-hidden="true"><i></i><i></i><i></i><b>${ctx.storeId ? `atual-moveis.pages.dev/loja/${ctx.store?.slug || ''}` : 'atual-moveis.pages.dev'}</b></span>
      ${bars.length ? block('bar', 'bar', `Barra de avisos: ${bars.length} no ar`, html`<span class="sc-mb__l">${bars[0].text}</span>${bars.length > 1 ? html`<span class="sc-mb__more">+${bars.length - 1}</span>` : ''}`) : block('bar', 'bar is-empty', 'Barra de avisos: nenhum no ar', html`<span class="sc-mb__l">Sem avisos no ar</span>`)}
      ${heroes.length
        ? block('hero', 'hero', `Slideshow: ${heroes.length} no ar`, html`${heroes[0].image_url ? html`<img src="${mediaUrl(heroes[0].image_url)}" alt="" loading="lazy">` : ''}<span class="sc-mb__l">Slideshow · ${plural(heroes.length, 'slide', 'slides')}</span>`)
        : block('hero', 'hero is-empty', 'Slideshow: nenhum no ar', html`<span class="sc-mb__l">Sem slides no ar</span>`)}
      ${ghost('cats', 'Categorias · automático')}
      ${parts}
    </div>
    ${notes.length ? html`<p class="sc-map__foot">${icon('info', 'icon-xs')}<span>Fora da página: ${notes.join(' · ')}.</span></p>` : ''}
  </section>`;
}

/* ---------- Módulo ---------- */
const TAB_RENDER = {
  shelves: shelvesTab,
  hero: (pane, ctx, alive, o) => scopedTab(pane, ctx, alive, 'hero', o),
  tiles: (pane, ctx, alive, o) => scopedTab(pane, ctx, alive, 'tiles', o),
  bar: (pane, ctx, alive, o) => scopedTab(pane, ctx, alive, 'bar', o),
};

function drawActions(ctx) {
  if (ctx.store) {
    ctx.setActions(
      html`<a class="btn" href="${storefrontUrl(ctx.store.slug)}" target="_blank" rel="noopener" aria-label="Ver loja virtual (abre em nova aba)" title="Abre a loja virtual em nova aba">${icon('external')}<span>Ver loja virtual</span></a>`
    );
  } else if (ctx.stores.length) {
    ctx.setActions(html`<div class="sc-dd">
      <button class="btn" type="button" data-menu="sc-preview-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Ver a loja virtual de uma loja">${icon('external')}<span>Ver loja virtual</span>${icon('chevronDown', 'icon-sm')}</button>
      <div class="menu sc-dd__menu" id="sc-preview-menu" hidden>
        <p class="menu__label">Abrir em nova aba</p>
        ${ctx.stores.map((s) => html`<a href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener">${storeMark(s, 22)}<span class="ellipsis">${ctx.storeShort?.(s) || s.name}</span></a>`)}
      </div>
    </div>`);
  }
}

export default {
  title: 'Vitrine e banners',
  async render(view, ctx) {
    injectStyle('showcase', CSS);
    injectSchedule();
    drawActions(ctx);
    ctx.setTitle('Vitrine e banners', ctx.storeId ? `Página inicial de ${shortStore(ctx)} na loja virtual` : 'Toda a rede · banners e avisos que aparecem em todas as lojas');
    let tab = TABS.some((t) => t.id === ctx.args[0]) ? ctx.args[0] : 'shelves';
    let sum = null;
    render(
      view,
      html`<div class="sc">
        <div class="tabs sc-tabs" role="tablist" aria-label="Seções da vitrine">${TABS.map(
          (t) => html`<button class="tab" type="button" role="tab" id="sc-tab-${t.id}" aria-controls="sc-panel" data-tab="${t.id}">${icon(t.icon, 'icon-sm')}${t.label}<span class="tab__n" data-tab-n="${t.id}" hidden></span></button>`
        )}</div>
        <div class="sc-layout">
          <div class="sc-main" id="sc-panel" role="tabpanel" data-panel></div>
          <aside class="sc-aside" data-map aria-label="Mapa da página inicial">${homeMap(ctx, null, tab)}</aside>
        </div>
      </div>`
    );
    const panel = $('[data-panel]', view);
    const mapEl = $('[data-map]', view);
    const tabs = $$('[data-tab]', view);
    let token = 0;
    let focusId = null;

    // resumo para as contagens das abas e o mapa
    let sumSeq = 0;
    const loadSummary = async () => {
      const my = ++sumSeq;
      const sid = ctx.storeId;
      const scoped = (qb) => (sid ? qb.or(`store_id.eq.${sid},store_id.is.null`) : qb.is('store_id', null));
      try {
        const [shelves, banners, bars] = await Promise.all([
          sid ? q(sb.from('collections').select('id, title, layout, active, show_on_home, sort_order, collection_items(count)').eq('store_id', sid).order('sort_order').order('title')) : [],
          q(scoped(sb.from('banners').select('id, kind, title, image_url, active, starts_at, ends_at, store_id, sort_order, created_at')).order('sort_order')),
          q(scoped(sb.from('announcements').select('id, text, active, starts_at, ends_at, store_id, sort_order, created_at')).order('sort_order')),
        ]);
        if (my !== sumSeq || !view.isConnected) return;
        sum = { shelves: shelves.map((c) => ({ ...c, count: c.collection_items?.[0]?.count ?? 0 })), banners, bars };
        const counts = {
          shelves: sid ? sum.shelves.length : null,
          hero: banners.filter((b) => b.kind === 'hero').length,
          tiles: banners.filter((b) => b.kind !== 'hero').length,
          bar: bars.length,
        };
        Object.entries(counts).forEach(([k, n]) => {
          const elN = $(`[data-tab-n="${k}"]`, view);
          if (!elN) return;
          elN.hidden = n === null;
          elN.textContent = n === null ? '' : num(n);
        });
        render(mapEl, homeMap(ctx, sum, tab));
      } catch {
        if (my === sumSeq) mapEl.hidden = true;
      }
    };
    const refreshSummary = debounce(loadSummary, 250);

    const show = (id, focus = false) => {
      tab = id;
      tabs.forEach((b) => {
        const on = b.dataset.tab === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
        if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      panel.setAttribute('aria-labelledby', `sc-tab-${id}`);
      const target = id === 'shelves' ? '#/showcase' : `#/showcase/${id}`;
      if (location.hash.split('?')[0] !== target) history.replaceState(null, '', target);
      $$('.sc-mb[data-goto-tab]', mapEl).forEach((b) => b.classList.toggle('is-current', b.dataset.gotoTab === id));
      const pane = document.createElement('div');
      pane.className = 'sc-pane';
      panel.replaceChildren(pane);
      const my = ++token;
      const alive = () => my === token && pane.isConnected;
      const fid = focusId;
      focusId = null;
      Promise.resolve(TAB_RENDER[id](pane, ctx, alive, { onChange: refreshSummary, focusId: fid })).catch((e) => {
        console.error(e);
        if (alive()) render(pane, retryBlock(e, () => show(id)));
      });
    };
    $('[role="tablist"]', view).addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b && b.dataset.tab !== tab) show(b.dataset.tab);
    });
    $('[role="tablist"]', view).addEventListener('keydown', (e) => {
      const i = tabs.findIndex((b) => b.dataset.tab === tab);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      show(tabs[j].dataset.tab, true);
    });
    mapEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto-tab]');
      if (!b) return;
      const id = b.dataset.gotoTab;
      if (id === tab && b.dataset.gotoId) return flashRow(panel, b.dataset.gotoId);
      focusId = b.dataset.gotoId || null;
      show(id);
      if (!focusId && matchMedia('(max-width: 1199px)').matches) panel.scrollIntoView({ block: 'start', behavior: smooth() });
    });
    show(tab);
    loadSummary();
  },
};

const CSS = `
.sc { display: flex; flex-direction: column; }
.sc-tabs { margin-bottom: 18px; }
.sc-tabs .tab .icon-sm { color: var(--muted); }
.sc-tabs .tab[aria-selected="true"] .icon-sm { color: var(--accent-ink); }
.sc-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
.sc-main { min-width: 0; }
.sc-aside { position: sticky; top: calc(var(--topbar-h) + 16px); }
.sc-tab { --gap: 22px; }
.sc-pane > .card + .card { margin-top: 16px; }

/* grupos e seções */
.sc-group { display: flex; flex-direction: column; gap: 12px; }
.sc-group__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
.sc-group__t { margin: 0 0 2px; font: 800 19px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
.sc-group__d { margin: 0; font-size: 13.5px; color: var(--muted); max-width: 680px; }
.sc-fit { align-items: flex-start; }
.sc-sec__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; padding: 16px 20px 0; }
.sc-sec__txt { min-width: 0; flex: 1 1 260px; }
.sc-sec__txt .card__title { flex-wrap: wrap; }
.sc-sec__body { padding: 14px 12px 12px; }
.sc-sec__body > .empty--inline { padding: 4px 12px 10px; }
.sc-none { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 10px 8px; color: var(--muted); font-size: 13.5px; }
.sc-hintline { display: flex; align-items: center; gap: 6px; margin: 10px 8px 0; font-size: 12px; color: var(--muted); }
.sc-net { height: 22px; padding: 0 8px; font-size: 11.5px; color: var(--muted); }
.sc-net .icon-xs { width: 12px; height: 12px; }

/* linhas */
.sc-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.sc-row {
  position: relative; display: grid; grid-template-columns: 30px auto minmax(0, 1fr) auto; grid-template-areas: "grip media info side";
  align-items: center; gap: 10px 16px; padding: 12px 14px 12px 8px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface);
  transition: border-color var(--dur-1), box-shadow var(--dur-1), background-color var(--dur-1);
}
.sc-row:hover { border-color: var(--line-strong); box-shadow: var(--sh-1); }
.sc-row--bar { grid-template-columns: 30px minmax(0, 1fr) auto; grid-template-areas: "grip info side"; }
.sc-row--item { grid-template-columns: 30px 44px minmax(0, 1fr) auto; grid-template-areas: "grip media info side"; padding: 8px 10px 8px 6px; }
.sc-row--item .thumb { grid-area: media; }
.sc-row[draggable="true"] { cursor: grab; }
.sc-row[draggable="true"]:active { cursor: grabbing; }
.sc-row.is-off { background: var(--surface-2); }
.sc-row.is-off .sc-media img, .sc-row.is-off .sc-stack img { opacity: .55; filter: saturate(.6); }
.sc-row.is-dragging { opacity: .5; outline: 2px dashed var(--select); outline-offset: 2px; box-shadow: var(--sh-pop); }
.sc-row.is-flash { animation: sc-flash 1.6s var(--ease-out); }
@keyframes sc-flash { 0%, 35% { box-shadow: 0 0 0 3px var(--highlight); border-color: var(--highlight); } 100% { box-shadow: none; } }
.sc-grip { grid-area: grip; display: flex; flex-direction: column; align-items: center; gap: 4px; align-self: stretch; justify-content: center; color: var(--faint); }
.sc-grip.is-off { justify-content: center; }
.sc-pos { min-width: 22px; height: 22px; padding: 0 5px; border-radius: 7px; background: var(--surface-3); color: var(--ink); font: 700 11.5px/22px var(--font-ui); text-align: center; font-variant-numeric: tabular-nums; }
.sc-row:hover .sc-grip .icon-sm { color: var(--muted); }

/* mídia */
.sc-media { grid-area: media; position: relative; display: flex; align-items: stretch; gap: 6px; padding: 0; border: 0; background: none; border-radius: 10px; cursor: zoom-in; }
.sc-media__img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-3); }
.sc-media__desk { position: relative; width: 208px; aspect-ratio: 8 / 3; }
.sc-media__mob { position: relative; width: 50px; aspect-ratio: 602 / 885; }
.sc-media__sq { position: relative; width: 84px; aspect-ratio: 1; }
.sc-media__dev { position: absolute; left: 5px; bottom: 5px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: rgba(12, 27, 38, .72); color: #fff; }
.sc-media__mob .sc-media__dev { left: 50%; transform: translateX(-50%); }
.sc-media__eye { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 10px; background: rgba(12, 27, 38, .55); color: #fff; font: 600 12.5px var(--font-ui); opacity: 0; transition: opacity var(--dur-1); }
.sc-media:hover .sc-media__eye, .sc-media:focus-visible .sc-media__eye { opacity: 1; }
.sc-noimg { display: grid; place-items: center; color: var(--faint); background: var(--surface-2); border: 1px dashed var(--line-strong); }

/* pilha de capas (prateleiras) */
.sc-stack { grid-area: media; position: relative; display: flex; align-items: center; width: 116px; height: 56px; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 12px; }
.sc-stack img, .sc-stack__none { width: 50px; height: 50px; flex: none; border-radius: 11px; object-fit: cover; background: var(--surface-3); border: 2px solid var(--surface); box-shadow: var(--sh-1); }
.sc-stack img + img { margin-left: -28px; }
.sc-stack img:nth-child(1) { z-index: 4; } .sc-stack img:nth-child(2) { z-index: 3; } .sc-stack img:nth-child(3) { z-index: 2; } .sc-stack img:nth-child(4) { z-index: 1; }
.sc-stack__none { display: grid; place-items: center; color: var(--muted); border: 1px dashed var(--line-strong); }
.sc-stack:hover img { transform: translateY(-1px); }

/* info */
.sc-info { grid-area: info; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sc-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 2px; }
.sc-kicker { font: 700 10.5px/1.3 var(--font-ui); letter-spacing: .14em; text-transform: uppercase; color: var(--highlight-ink); }
.sc-title { font: 700 15px/1.3 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
.sc-text { font-size: 13px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 3px; font-size: 12.5px; color: var(--muted); }
.sc-meta > span:not(.badge):not(.tag) { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
.sc-chip { padding: 2px 8px 2px 6px; border-radius: 7px; background: var(--surface-3); color: var(--text); font-size: 12px; }
.sc-when.is-info { color: var(--info-fg); }
.sc-soon { color: var(--warn-fg); font-weight: 600; }
.sc-warn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: var(--warn-fg); }
.sc-seal { height: 22px; font-size: 11.5px; }
.sc-side { grid-area: side; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 2px; }
.sc-side--stack { flex-direction: column; align-items: flex-end; flex-wrap: nowrap; gap: 6px; }
.sc-side__top { display: flex; align-items: center; justify-content: flex-end; }
.sc-side__acts { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.sc-side--stack .sc-toggle { margin: 0 6px 0 0; }
.sc-move { display: inline-flex; }
.sc-danger { color: var(--bad-fg); }
.sc-danger.is-armed { border-color: var(--bad-line); background: var(--bad-bg); color: var(--bad-fg); }
.sc-toggle { align-items: center; gap: 8px; margin: 0 8px 0 4px; }
.sc-toggle .switch__track { margin-top: 0; }
.sc-toggle__l { font-size: 12.5px; font-weight: 600; color: var(--text); }
.sc-items-btn { margin-right: 6px; }
.sc-items-btn .count-pill { margin-left: 2px; }
.sc-ro { display: inline-flex; align-items: center; gap: 5px; padding: 0 6px; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.sc-pinline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.sc-pinchip { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 2px 10px 2px 2px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 12px; color: var(--text); }
.sc-pinchip.is-warn { border-color: var(--warn-line); background: var(--warn-bg); }
.sc-pinchip__img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: none; border: 0; }
.sc-pinchip__img.sc-noimg { border: 0; }

/* barra de avisos (igual à loja) */
.sc-bar { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 18px; min-height: 40px; padding: 7px 14px; border-radius: 10px; background: #0d0d0d; color: #fff; font: 500 12.5px/1.25 var(--font-ui); letter-spacing: .06em; text-align: center; overflow-wrap: anywhere; }
.sc-bar__cta { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 16px; border-radius: 999px; background: #f4802b; color: #191919; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.sc-row--bar .sc-bar { margin-bottom: 4px; }

/* lojas (visão da rede) */
.sc-stores { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin: 0; padding: 0 8px 8px; list-style: none; }
.sc-store { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); text-align: left; cursor: pointer; color: var(--ink); transition: border-color var(--dur-1), background-color var(--dur-1); }
.sc-store:hover { border-color: var(--line-strong); background: var(--surface-2); }
.sc-store > .icon-sm { color: var(--muted); }
.sc-store__txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.sc-store__txt .sub { margin-top: 1px; }
.sc-dd { position: relative; }
.sc-dd__menu { min-width: 260px; max-height: min(440px, 70vh); overflow-y: auto; }

/* mapa da página inicial */
.sc-map { padding-bottom: 14px; }
.sc-map__head { padding: 16px 18px 0; }
.sc-map__head .icon-sm { color: var(--muted); }
.sc-map__page { display: flex; flex-direction: column; gap: 6px; margin: 12px 14px 0; padding: 0 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); overflow: hidden; }
.sc-map__chrome { display: flex; align-items: center; gap: 4px; margin: 0 -8px 2px; padding: 7px 10px; border-bottom: 1px solid var(--line); background: var(--surface-3); }
.sc-map__chrome i { width: 6px; height: 6px; border-radius: 50%; background: var(--line-strong); }
.sc-map__chrome b { flex: 1; min-width: 0; margin-left: 6px; padding: 2px 8px; border-radius: 6px; background: var(--surface); font: 500 10.5px/1.4 var(--font-ui); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-mb { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--text); font: 500 12px/1.25 var(--font-ui); text-align: left; cursor: pointer; overflow: hidden; transition: border-color var(--dur-1), box-shadow var(--dur-1); }
button.sc-mb:hover { border-color: var(--ink); }
.sc-mb.is-current { border-color: var(--select); box-shadow: 0 0 0 1px var(--select); }
.sc-mb__l { position: relative; z-index: 1; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-mb__n { display: grid; place-items: center; width: 18px; height: 18px; flex: none; border-radius: 5px; background: var(--surface-3); font: 700 10.5px/1 var(--font-ui); color: var(--ink); }
.sc-mb--bar { min-height: 24px; padding: 4px 9px; background: #0d0d0d; border-color: #0d0d0d; color: #fff; justify-content: center; font-size: 10.5px; letter-spacing: .05em; }
.sc-mb--bar .sc-mb__l { flex: 0 1 auto; }
.sc-mb__more { position: relative; z-index: 1; padding: 0 6px; border-radius: 999px; background: #f4802b; color: #191919; font-weight: 700; }
.sc-mb--hero { min-height: 74px; align-items: flex-end; padding: 8px 10px; background: var(--surface-3); color: #fff; font-weight: 600; }
.sc-mb--hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sc-mb--hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 30%, rgba(0, 0, 0, .55)); }
.sc-mb--hero.is-empty, .sc-mb--bar.is-empty { background: var(--surface); border-style: dashed; border-color: var(--line-strong); color: var(--muted); }
.sc-mb--hero.is-empty::after { display: none; }
.sc-mb--hero .sc-mb__l { text-shadow: 0 1px 4px rgba(0, 0, 0, .4); }
.sc-mb--hero.is-empty .sc-mb__l { text-shadow: none; }
.sc-mb--shelf { flex-wrap: wrap; row-gap: 5px; }
.sc-mb--shelf.is-empty { border-style: dashed; color: var(--muted); }
.sc-mb__prods { display: grid; grid-template-columns: repeat(var(--n, 5), 1fr); gap: 3px; width: 100%; }
.sc-mb__prods i { height: 14px; border-radius: 3px; background: var(--surface-3); }
.sc-mb__prods:has(i:nth-child(6)) { --n: 6; }
.sc-mb--mosaic, .sc-mb--room { flex-direction: column; align-items: stretch; gap: 5px; }
.sc-mb__tiles { display: grid; gap: 3px; }
.sc-mb__tiles.is-2 { grid-template-columns: 1fr 1fr; }
.sc-mb__tiles.is-4 { grid-template-columns: repeat(4, 1fr); }
.sc-mb__tiles span { aspect-ratio: 1; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.sc-mb__tiles.is-2 span { aspect-ratio: 16 / 10; }
.sc-mb__tiles img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sc-mb.is-auto { cursor: default; justify-content: center; min-height: 24px; padding: 3px 8px; border-style: dashed; background: transparent; color: var(--muted); font-size: 11px; }
.sc-mb--cats::before { content: ''; width: 46px; height: 10px; flex: none; background: radial-gradient(circle, var(--line-strong) 3.5px, transparent 4px) 0 50% / 12px 10px repeat-x; }
.sc-map__foot { display: flex; gap: 6px; margin: 10px 16px 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
.sc-map__foot .icon-xs { flex: none; margin-top: 2px; }

/* prévias (loja virtual) */
.sc-pv { position: relative; display: block; width: 100%; overflow: hidden; border-radius: 12px; background: #2b2420; color: #fff; container-type: inline-size; }
.sc-pv__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sc-pv__ph { position: absolute; inset: 0; background: repeating-linear-gradient(135deg, var(--surface-3) 0 12px, var(--surface-2) 12px 24px); }
.sc-pv__phl { position: absolute; left: 8px; top: 8px; display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: var(--raised); box-shadow: var(--sh-1); color: var(--muted); font: 500 11px/1.3 var(--font-ui); }
.sc-pv--hero.is-desk { aspect-ratio: 8 / 3; }
.sc-pv--hero.is-mobile { aspect-ratio: 602 / 885; }
.sc-pv__shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0, 0, 0, .38), rgba(0, 0, 0, .08) 55%, rgba(0, 0, 0, .3)); pointer-events: none; }
.sc-pv--hero.is-mobile .sc-pv__shade { background: linear-gradient(180deg, rgba(0, 0, 0, .55) 0%, rgba(0, 0, 0, .5) 64%, rgba(0, 0, 0, .2) 78%, rgba(0, 0, 0, .45) 100%); }
.sc-pv__ph ~ .sc-pv__shade { display: none; }
.sc-pv__ph ~ .sc-pv__kicker, .sc-pv__ph ~ .sc-pv__title, .sc-pv__ph ~ .sc-pv__text { color: var(--ink); text-shadow: none; }
.sc-pv__kicker { position: absolute; left: 50%; top: 19.5%; transform: translateX(-50%); padding-bottom: 1.1cqw; font: 500 max(7px, 1.05cqw)/1 var(--font-ui); letter-spacing: .62em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 1px 3px rgba(0, 0, 0, .6); }
.sc-pv__kicker::after { content: ''; position: absolute; left: 50%; bottom: 0; width: 4cqw; height: 1px; background: currentColor; transform: translateX(-50%); }
.sc-pv__title { position: absolute; left: 10.5%; top: 50%; max-width: 48%; transform: translateY(-50%); font: 300 max(14px, 4.4cqw)/1 var(--font-ui); letter-spacing: -0.02em; text-shadow: 0 1px 18px rgba(0, 0, 0, .25); }
.sc-pv__text { position: absolute; right: 8.5%; top: 50%; max-width: 22%; transform: translateY(-50%); font: 500 max(8px, 1.25cqw)/1.25 var(--font-ui); text-shadow: 0 1px 3px rgba(0, 0, 0, .6); }
.sc-pv--hero.is-mobile .sc-pv__title { left: 0; right: 0; top: 26%; max-width: none; transform: none; font-size: 12.3cqw; text-align: center; }
.sc-pv--hero.is-mobile .sc-pv__text { left: 50%; right: auto; top: calc(26% + 16cqw); width: 78%; max-width: none; transform: translateX(-50%); font-size: 3.6cqw; text-align: center; }
.sc-pv--hero.is-mobile .sc-pv__kicker { top: calc(26% + 44cqw); font-size: 2.6cqw; }
.sc-pv__dots { position: absolute; left: 50%; bottom: 7%; display: flex; gap: 5px; transform: translateX(-50%); }
.sc-pv__dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, .55); }
.sc-pv__dots i.is-on { width: 18px; border-radius: 6px; background: #fff; }
.sc-pv--tile { aspect-ratio: 1; }
.sc-pv__overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6cqw; text-align: center; background: linear-gradient(to top, rgba(0, 0, 0, .4), rgba(0, 0, 0, 0)); }
.sc-pv__ttitle { font: 700 max(13px, 7.5cqw)/1.2 var(--font-ui); text-shadow: 0 1px 14px rgba(0, 0, 0, .25); }
.sc-pv__tsub { margin-top: 2cqw; font: 400 max(10px, 4.4cqw)/1.4 var(--font-ui); opacity: .9; }
.sc-pv__ph ~ .sc-pv__overlay { background: none; color: var(--ink); }
.sc-pvbox { display: flex; flex-direction: column; gap: 14px; }
.sc-pvbox__bar { display: flex; justify-content: center; }
.sc-pvbox__stage { display: flex; justify-content: center; padding: 18px; border-radius: 16px; background: var(--surface-3); }
.sc-pvbox__stage .sc-pv--hero.is-desk { max-width: 760px; }
.sc-pvbox__stage .sc-pv--hero.is-mobile { max-width: 260px; }
.sc-pvbox__stage .sc-pv--tile { max-width: 320px; }
.sc-pvbox__meta { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px 22px; margin: 0; }
.sc-pvbox__meta > div { min-width: 0; }
.sc-pvbox__meta dt { font-size: 11.5px; color: var(--muted); margin-bottom: 3px; }
.sc-pvbox__meta dd { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; font-size: 13px; color: var(--ink); overflow-wrap: anywhere; }

/* editores */
.sc-form { display: flex; flex-direction: column; gap: 20px; }
.sc-fs { margin: 0; padding: 0; border: 0; min-width: 0; }
.sc-fs + .sc-fs { padding-top: 20px; border-top: 1px solid var(--line); }
.sc-fs__t { float: left; width: 100%; margin: 0 0 12px; padding: 0; font: 700 15px/1.3 var(--font-display); color: var(--ink); }
.sc-fs__t + * { clear: both; }
.sc-ed__pv { padding: 12px; border-radius: 16px; background: var(--surface-3); }
.sc-ed__pvhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.sc-ed__ov { font: 600 11px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.sc-ed__stage { display: flex; justify-content: center; }
.sc-ed__stage.is-hero-desk .sc-pv { max-width: 620px; }
.sc-ed__stage.is-hero-mobile .sc-pv { max-width: 190px; }
.sc-ed__stage.is-tile .sc-pv { max-width: 220px; }
.sc-ed__barstage { overflow: hidden; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); }
.sc-ed__barstage .sc-bar { border-radius: 0; }
.sc-ed__fake { display: flex; gap: 8px; padding: 12px 14px; }
.sc-ed__fake i { height: 8px; border-radius: 4px; background: var(--surface-3); }
.sc-ed__fake i:nth-child(1) { width: 70px; } .sc-ed__fake i:nth-child(2) { width: 120px; } .sc-ed__fake i:nth-child(3) { width: 90px; margin-left: auto; }
.sc-ed__switches { display: flex; flex-wrap: wrap; gap: 14px 28px; padding-top: 4px; }
.sc-form input[list]::-webkit-calendar-picker-indicator { opacity: .45; }
.sc-ann-hint { display: flex; align-items: center; gap: 6px; margin: -6px 0 0; }
.sc-up--wide .uploader { grid-template-columns: minmax(0, 1fr); }
.sc-up--wide .uploader__item, .sc-up--wide .uploader__add { aspect-ratio: 8 / 3; }
.sc-up--tall .uploader { grid-template-columns: minmax(0, 150px); }
.sc-up--tall .uploader__item, .sc-up--tall .uploader__add { aspect-ratio: 602 / 885; }
.sc-up--square .uploader { grid-template-columns: minmax(0, 220px); }
.field:has(input[type="hidden"][aria-invalid="true"]) .uploader__add { border-color: var(--accent-ink); background: var(--bad-bg); }
.sc-up .uploader__item.is-cover { grid-column: auto; grid-row: auto; box-shadow: none; border-color: var(--line); }
.sc-pins { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none; }
.sc-pin { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.sc-pin.is-missing { border-color: var(--bad-line); background: var(--bad-bg); }
.sc-pin__name, .sc-pick__name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.sc-pin__name .sub, .sc-pick__name .sub { margin-top: 1px; }

/* seletor de produtos */
.sc-picker__search { max-width: none; }
.sc-picker__info { min-height: 18px; margin: 8px 2px 0; font-size: 12.5px; color: var(--muted); }
.sc-pick-list { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 0; padding: 0; list-style: none; }
.sc-pick { display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer; transition: border-color var(--dur-1), background-color var(--dur-1); }
.sc-pick:hover { border-color: var(--line-strong); background: var(--surface-2); }
.sc-pick.is-on { border-color: var(--select); background: var(--row-selected); box-shadow: inset 0 0 0 1px var(--select); }
.sc-pick.is-in { cursor: default; opacity: .7; }
.sc-pick input { flex: none; }
.sc-pick mark { background: color-mix(in srgb, var(--orange) 26%, transparent); color: inherit; border-radius: 3px; }
.sc-pick-count { font-size: 13px; color: var(--muted); }

/* painel de produtos da prateleira */
.sc-items__head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.sc-items__n { margin: 0; font: 700 16px/1.3 var(--font-display); color: var(--ink); }
.sc-items .callout strong { margin-bottom: 2px; }
.sc-items__empty { padding: 20px 0; }
.sc-rm { gap: 4px; }

@media (max-width: 1199px) {
  .sc-layout { grid-template-columns: minmax(0, 1fr); }
  .sc-aside { position: static; width: 100%; max-width: 460px; }
  .sc-map__page { flex-direction: column; }
}
@media (max-width: 860px) {
  .sc-row { grid-template-columns: 30px minmax(0, 1fr); grid-template-areas: "grip media" "grip info" "side side"; padding: 12px 12px 10px 6px; }
  .sc-row--tile { grid-template-columns: 30px auto minmax(0, 1fr); grid-template-areas: "grip media info" "side side side"; }
  .sc-row--shelf { grid-template-columns: 30px auto minmax(0, 1fr); grid-template-areas: "grip media info" "side side side"; }
  .sc-row--bar { grid-template-columns: 30px minmax(0, 1fr); grid-template-areas: "grip info" "side side"; }
  .sc-row--item { grid-template-columns: 30px 44px minmax(0, 1fr); grid-template-areas: "grip media info" "side side side"; }
  .sc-media__desk { flex: 1; width: auto; min-width: 0; }
  .sc-row--hero .sc-media { width: 100%; }
  .sc-media__sq { width: 72px; }
  .sc-stack { width: 92px; }
  .sc-stack img, .sc-stack__none { width: 44px; height: 44px; }
  .sc-stack img + img { margin-left: -30px; }
  .sc-side { justify-content: flex-start; padding-top: 8px; margin-top: 2px; border-top: 1px solid var(--line); }
  .sc-side .sc-toggle { margin-left: 0; margin-right: auto; }
  .sc-side--stack { flex-direction: row; align-items: center; justify-content: space-between; }
  .sc-side--stack .sc-side__top { margin-right: auto; }
  .sc-row--item .sc-side { justify-content: flex-end; }
  .sc-pvbox__meta { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .sc-hide-sm { display: none; }
  .sc-rm-label { display: none; }
  .sc-danger.is-armed .sc-rm-label { display: inline; }
  .sc-sec__head { padding: 14px 14px 0; }
  .sc-sec__body { padding: 12px 8px 8px; }
  .sc-sec__head > .btn { width: 100%; justify-content: center; }
  .sc-tabs .tab .icon-sm { display: none; }
  .sc-group__head { flex-direction: column; align-items: flex-start; }
  .sc-stores { grid-template-columns: minmax(0, 1fr); }
  .sc-side .btn--icon { width: 38px; height: 38px; }
  .sc-ed__switches { flex-direction: column; }
  .sc-media__eye { display: none; }
}
`;
