// Vitrine e banners da loja virtual: prateleiras (coleções), slideshow, mosaicos/ambientes e barra de avisos.
//
// Rotas: #/showcase (prateleiras) · #/showcase/hero · #/showcase/tiles · #/showcase/bar
//
// Escopo: na visão de uma loja, os itens novos ficam na loja (store_id = loja). Itens da rede (store_id nulo)
// aparecem em todas as lojas, com o selo "Rede", e só administradores da rede os alteram. Na visão
// "Toda a rede" as abas de banners e avisos gerenciam os itens da rede; as prateleiras sempre pedem uma loja.
// Na loja virtual os itens da loja vêm antes dos da rede (cada grupo pela ordem definida aqui).
// Imagens: ui.imageUploader (stores/<loja>/banners ou network/banners). Um arquivo só sai do storage
// depois de salvar (ou ao cancelar um envio novo) e se nenhum outro banner usar a mesma URL.
import { sb, q, mediaUrl, removeImage, storefrontUrl } from '../api.js';
import {
  html, raw, render, $, $$, icon, toast, toastError, badge, money, num, datetime, slugify, PRODUCT_STATUS,
  openModal, confirmDialog, readForm, showErrors, withBusy, switchField, selectOptions, loading, empty,
  imageUploader, sortable, injectStyle, debounce,
} from '../ui.js';

const TABS = [
  { id: 'shelves', label: 'Prateleiras' },
  { id: 'hero', label: 'Slideshow' },
  { id: 'tiles', label: 'Mosaicos e ambientes' },
  { id: 'bar', label: 'Barra de avisos' },
];

// Grupos de itens com escopo loja/rede (banners por tipo e avisos)
const GROUPS = {
  hero: {
    title: 'Slideshow',
    desc: 'Slides grandes no topo da página inicial. Imagem desktop de 2400 × 900 px e versão para celular de 900 × 1323 px.',
    one: 'slide', many: 'slides', new: 'Novo slide',
    store: 'Slides desta loja', network: 'Slides da rede', none: 'Nenhum slide',
  },
  mosaic: {
    title: 'Mosaicos',
    desc: 'Blocos de inspiração da página inicial, 2 por linha (use quantidades pares). Imagem quadrada de 1400 × 1400 px.',
    one: 'mosaico', many: 'mosaicos', new: 'Novo mosaico',
    store: 'Mosaicos desta loja', network: 'Mosaicos da rede', none: 'Nenhum mosaico',
  },
  room: {
    title: 'Ambientes',
    desc: '“Compre por ambiente”, 4 por linha (use múltiplos de 4). Imagem quadrada de 900 × 900 px.',
    one: 'ambiente', many: 'ambientes', new: 'Novo ambiente',
    store: 'Ambientes desta loja', network: 'Ambientes da rede', none: 'Nenhum ambiente',
  },
  bar: {
    title: 'Barra de avisos',
    desc: 'Mensagens curtas na faixa preta do topo do site. Com mais de um aviso no ar, eles se alternam.',
    one: 'aviso', many: 'avisos', new: 'Novo aviso',
    store: 'Avisos desta loja', network: 'Avisos da rede', none: 'Nenhum aviso',
  },
};
const TAB_CFG = {
  hero: { table: 'banners', kinds: ['hero'], summary: 'Slides próprios de cada loja' },
  tiles: { table: 'banners', kinds: ['mosaic', 'room'], summary: 'Mosaicos e ambientes próprios de cada loja' },
  bar: { table: 'announcements', kinds: ['bar'], summary: 'Avisos próprios de cada loja' },
};

const LAYOUTS = { five: '5 por linha', six: '6 por linha' };
const SEALS = { '': 'Nenhum', novo: 'Lançamento', frete: 'Frete grátis' };
const MAX_PINS = 3;
const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LINK_RE = /^(#[\w-]+|\?\S+|\/\S*|https?:\/\/\S+)$/i;
const LINK_HELP = 'Use #âncora, ?parâmetro, /caminho ou um endereço completo (https://…).';
const PICK_COLS = 'id,name,sku,price,image_url,status';
const PICK_LIMIT = 60;
const STORAGE_MARK = '/storage/v1/object/public/media/';

const SVG = {
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const svg = (name, cls = 'icon') =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name] || ''}</svg>`);

/* ---------- Utilitários ---------- */
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const isStored = (u) => typeof u === 'string' && u.includes(STORAGE_MARK);
const netBadge = () => html`<span class="badge badge--dark badge--plain">Rede</span>`;
const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || a.title || '').localeCompare(String(b.created_at || b.title || ''));
const nextOrder = (list) => list.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1;

// datetime-local ↔ timestamptz (horário de Brasília, sem horário de verão desde 2019)
const SP_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function toLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(SP_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// '' → null · inválido → undefined
function fromLocalInput(s) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const d = new Date(`${s.slice(0, 16)}:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function liveState(it, now = Date.now()) {
  if (!it.active) return { key: 'off', label: 'Inativo', tone: '' };
  if (it.starts_at && Date.parse(it.starts_at) > now) return { key: 'scheduled', label: 'Agendado', tone: 'info' };
  if (it.ends_at && Date.parse(it.ends_at) < now) return { key: 'ended', label: 'Encerrado', tone: 'warning' };
  return { key: 'live', label: 'No ar', tone: 'success' };
}
function scheduleText(it) {
  if (it.starts_at && it.ends_at) return `${datetime(it.starts_at)} até ${datetime(it.ends_at)}`;
  if (it.starts_at) return `A partir de ${datetime(it.starts_at)}`;
  if (it.ends_at) return `Até ${datetime(it.ends_at)}`;
  return 'Sem período definido';
}

const thumb = (url, cls = 'thumb') =>
  url ? html`<img class="${cls}" src="${mediaUrl(url)}" alt="" loading="lazy">` : html`<span class="${cls} sc-noimg" aria-hidden="true">${icon('image', 'icon-sm')}</span>`;

const handle = (on) => (on ? html`<span class="sc-handle" title="Arraste para reordenar" aria-hidden="true">${icon('drag', 'icon-sm')}</span>` : html`<span class="sc-handle is-off" aria-hidden="true"></span>`);

const moveBtns = (i, n, name) =>
  n > 1
    ? html`<span class="sc-move">
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="up" aria-label="Mover “${name}” para cima" ${i === 0 ? 'disabled' : ''}>${svg('up', 'icon-sm')}</button>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="down" aria-label="Mover “${name}” para baixo" ${i === n - 1 ? 'disabled' : ''}>${svg('down', 'icon-sm')}</button>
      </span>`
    : '';

const rowActions = (name) => html`
  <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit aria-label="Editar “${name}”" title="Editar">${icon('edit', 'icon-sm')}</button>
  <button class="btn btn--ghost btn--sm btn--icon sc-danger" type="button" data-delete aria-label="Excluir “${name}”" title="Excluir">${icon('trash', 'icon-sm')}</button>`;

const activeSwitch = (id, on, label = 'Ativo', name = '') => html`<label class="switch sc-toggle">
  <input type="checkbox" data-active="${id}" ${on ? 'checked' : ''} aria-label="${label}${name ? `: ${name}` : ''}">
  <span class="switch__track"></span><span class="small">${label}</span>
</label>`;

const retryBlock = (e) => html`<div class="alert alert--danger">${icon('alert')}<div class="grow">
  <strong>Não foi possível carregar.</strong><br>${e instanceof Error ? e.message : String(e)}
  <div class="mt-2"><button class="btn btn--sm" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div>
</div></div>`;

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
    if (!name) return;
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
      body: html`<div class="sc-picker">
        <div class="search">${icon('search')}
          <label class="visually-hidden" for="sc-pick-q">Buscar produto</label>
          <input class="input" id="sc-pick-q" type="search" placeholder="Buscar por nome ou SKU" autocomplete="off" autofocus>
        </div>
        <p class="small muted mt-2" data-pick-info aria-live="polite"></p>
        <ul class="sc-pick-list" data-pick-list>${loading()}</ul>
      </div>`,
      actions: html`<span class="small muted grow" data-pick-count></span>
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
                  return html`<li><label class="sc-pick ${inList ? 'is-in' : ''}">
                    <input type="checkbox" value="${p.id}" ${on || inList ? 'checked' : ''} ${inList || full ? 'disabled' : ''}>
                    ${thumb(p.image_url)}
                    <span class="sc-pick__name"><strong class="ellipsis">${p.name}</strong><span class="small muted">${p.sku || 'Sem SKU'} · ${money(p.price)}</span></span>
                    ${inList ? badge('Já incluído', 'plain') : p.status !== 'active' ? badge(PRODUCT_STATUS[p.status]?.label || p.status, 'warning') : ''}
                  </label></li>`;
                })
              : html`<li>${empty('Nenhum produto encontrado', term ? 'Tente outro nome ou SKU.' : 'Esta loja ainda não tem produtos ativos ou em rascunho.')}</li>`
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
            render(listEl, html`<li><div class="alert alert--danger">${icon('alert')}<div>${e.message}</div></div></li>`);
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

/* ---------- Prateleiras ---------- */
async function shelvesTab(pane, ctx, alive) {
  if (!ctx.storeId) {
    ctx.pickStore(pane, 'Cada loja tem as suas prateleiras. Escolha a loja para organizar a página inicial dela.');
    return;
  }
  const storeId = ctx.storeId;
  const canWrite = ctx.can('catalog', storeId);
  let rows = [];
  let busy = false;
  let seq = 0;

  // a carga mais recente vence (evita que uma resposta antiga desfaça uma alteração feita depois)
  const load = async (spinner = false) => {
    const my = ++seq;
    if (spinner) render(pane, loading());
    try {
      const data = await q(sb.from('collections').select('*, collection_items(count)').eq('store_id', storeId).order('sort_order').order('title'));
      if (!alive() || my !== seq) return;
      rows = data.map((c) => ({ ...c, count: c.collection_items?.[0]?.count ?? 0 }));
      draw();
    } catch (e) {
      if (!alive() || my !== seq) return;
      if (spinner || !rows.length) render(pane, retryBlock(e));
      else toastError(e);
    }
  };

  const rowHTML = (c, i, n) => {
    const sortableRow = canWrite && n > 1;
    return html`<li class="sc-row sc-row--nomedia ${c.active ? '' : 'is-off'}" data-id="${c.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${handle(sortableRow)}
      <div class="sc-info">
        <div class="sc-title">${i + 1}. ${c.title}</div>
        ${c.subtitle ? html`<div class="sc-text">${c.subtitle}</div>` : ''}
        <div class="sc-meta">
          <span class="mono" title="Link da prateleira">?colecao=${c.key}</span>
          <span>${LAYOUTS[c.layout] || c.layout}</span>
          ${c.badge_all ? badge(`Selo: ${SEALS[c.badge_all] || c.badge_all}`, 'accent') : ''}
          ${!c.active ? badge('Inativa') : c.show_on_home ? badge('Na página inicial', 'success') : badge('Só pelo link', 'info')}
          ${c.count ? '' : badge('Sem produtos: não aparece', 'warning')}
        </div>
      </div>
      <div class="sc-side">
        <button class="btn btn--sm" type="button" data-items aria-label="Produtos de “${c.title}” (${c.count})">${icon('products', 'icon-sm')}<span class="sc-hide-sm">Produtos</span><span class="sc-count">${num(c.count)}</span></button>
        ${canWrite ? html`${activeSwitch(c.id, c.active, 'Ativa', c.title)}${moveBtns(i, n, c.title)}${rowActions(c.title)}` : ''}
      </div>
    </li>`;
  };

  const draw = () => keepFocus(pane, paint);
  const paint = () => {
    const list = [...rows].sort(byOrder);
    render(
      pane,
      html`<section class="card sc-section" aria-labelledby="sc-h-shelves">
        <div class="card__head">
          <div class="grow">
            <h2 class="h3" id="sc-h-shelves">Prateleiras de ${ctx.store?.name || ctx.storeName(storeId)} <span class="muted">(${list.length})</span></h2>
            <p class="small muted">Faixas de produtos da página inicial, nesta ordem. Os mosaicos entram depois da 2ª prateleira e os ambientes depois da 3ª.</p>
          </div>
          ${canWrite ? html`<button class="btn btn--primary btn--sm" type="button" data-new>${icon('plus', 'icon-sm')} Nova prateleira</button>` : ''}
        </div>
        <div class="card__body">
          ${list.length
            ? html`<ul class="sc-list" data-sortable="${canWrite && list.length > 1 ? 'shelves' : ''}">${list.map((c, i) => rowHTML(c, i, list.length))}</ul>`
            : empty('Nenhuma prateleira', 'Crie uma prateleira e escolha os produtos que aparecem nela.', canWrite ? html`<button class="btn btn--primary btn--sm" type="button" data-new>${icon('plus', 'icon-sm')} Nova prateleira</button>` : '')}
        </div>
      </section>`
    );
    $$('[data-sortable="shelves"]', pane).forEach((el) => sortable(el, { item: '.sc-row[data-id]', onSort: (ids) => reorder(ids) }));
  };

  const reorder = async (ids, focus) => {
    if (busy) return;
    busy = true;
    seq += 1;
    try {
      const list = [...rows].sort(byOrder);
      if (await saveOrder('collections', list, ids)) toast('Ordem das prateleiras salva.', 'success', 2200);
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
    if (e.target.closest('[data-retry]')) return load(true);
    if (e.target.closest('[data-new]')) {
      return openCollectionEditor(ctx, {
        storeId,
        order: nextOrder(rows),
        onSaved: (created) => {
          load();
          if (created) openItems(ctx, { ...created, count: 0 }, () => load());
        },
      });
    }
    const row = e.target.closest('.sc-row[data-id]');
    const item = row && rows.find((r) => r.id === row.dataset.id);
    if (!item) return;
    if (e.target.closest('[data-items]')) return openItems(ctx, item, () => load());
    if (e.target.closest('[data-edit]')) return openCollectionEditor(ctx, { item, storeId, onSaved: () => load() });
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: 'Excluir prateleira',
        message: `Excluir a prateleira “${item.title}”? ${item.count === 1 ? 'O produto continua' : item.count ? `Os ${num(item.count)} produtos continuam` : 'Os produtos continuam'} no catálogo; só a prateleira some da loja. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await q(sb.from('collections').delete().eq('id', item.id));
        toast('Prateleira excluída.', 'success');
        load();
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
      toast(value ? 'Prateleira ativada.' : 'Prateleira desativada.', 'success', 2200);
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
const FOCUS_ATTRS = ['data-active', 'data-move', 'data-edit', 'data-delete', 'data-items', 'data-remove'];
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

function openCollectionEditor(ctx, { item = null, storeId, order = 1, onSaved }) {
  const isNew = !item;
  let keyTouched = !isNew;
  openModal({
    title: isNew ? 'Nova prateleira' : 'Editar prateleira',
    body: html`<form class="form-grid" data-form novalidate>
      <div class="field col-8">
        <label for="c-title">Título *</label>
        <input class="input" id="c-title" name="title" maxlength="80" required value="${item?.title || ''}" placeholder="Ex.: Ofertas da Semana" autofocus>
      </div>
      <div class="field col-4">
        <label for="c-layout">Layout</label>
        <select class="select" id="c-layout" name="layout">${selectOptions(Object.entries(LAYOUTS), item?.layout || 'five')}</select>
      </div>
      <div class="field col-6">
        <label for="c-key">Chave *</label>
        <input class="input mono" id="c-key" name="key" maxlength="60" required value="${item?.key || ''}" autocomplete="off" spellcheck="false" placeholder="ofertas-da-semana">
        <span class="hint" data-key-hint></span>
      </div>
      <div class="field col-6">
        <label for="c-seal">Selo para todos os produtos</label>
        <select class="select" id="c-seal" name="badge_all">${selectOptions(Object.entries(SEALS), item?.badge_all || '')}</select>
      </div>
      <div class="field col-12">
        <label for="c-sub">Subtítulo</label>
        <input class="input" id="c-sub" name="subtitle" maxlength="140" value="${item?.subtitle || ''}" placeholder="Opcional, aparece abaixo do título">
      </div>
      <div class="col-6">${switchField({ label: 'Mostrar na página inicial', name: 'show_on_home', checked: item ? item.show_on_home : true, hint: 'Desligado, a prateleira só abre pelo link.' })}</div>
      <div class="col-6">${switchField({ label: 'Ativa', name: 'active', checked: item ? item.active : true, hint: 'Inativa, some da loja virtual.' })}</div>
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar prateleira' : 'Salvar'}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      const keyEl = form.elements.key;
      const hint = $('[data-key-hint]', el);
      const drawHint = () => {
        const k = keyEl.value || 'chave';
        hint.textContent = isNew ? `Link: ?colecao=${k} ou #${k}` : `Link: ?colecao=${k}. Mudar a chave altera os links que apontam para ela.`;
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
        if (!d.key) errors.key = 'Informe a chave.';
        else if (!KEY_RE.test(d.key)) errors.key = 'Use letras minúsculas, números e hífens (ex.: ofertas-da-semana).';
        if (!showErrors(form, errors)) return;
        if (isNew || d.key !== item.key) {
          try {
            const dup = await q(sb.from('collections').select('id').eq('store_id', storeId).eq('key', d.key).limit(1));
            if (dup.length) return showErrors(form, { key: 'Já existe uma prateleira com esta chave nesta loja.' });
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
          if (err.raw?.code === '23505') return showErrors(form, { key: 'Já existe uma prateleira com esta chave nesta loja.' });
          return toastError(err);
        }
        toast(isNew ? 'Prateleira criada. Agora escolha os produtos.' : 'Prateleira salva.', 'success');
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
    body: html`<div class="sc-items" data-items>${loading()}</div>`,
    actions: html`<button class="btn" type="button" data-close>Fechar</button>`,
    onClose: () => {
      if (changed) onChange?.();
    },
    onMount(el) {
      const box = $('[data-items]', el);
      const addBtn = () => html`<button class="btn btn--primary btn--sm" type="button" data-add>${icon('plus', 'icon-sm')} Adicionar produtos</button>`;

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
          if (my === seq && box.isConnected) render(box, retryBlock(e));
        }
      };

      const draw = () => keepFocus(box, paint);
      const paint = () => {
        const n = items.length;
        const hidden = items.filter((it) => it.product?.status !== 'active').length;
        render(
          box,
          html`<div class="sc-items__head">
              <p class="small muted grow">${n ? `${plural(n, 'produto', 'produtos')}${canWrite && n > 1 ? ' · arraste ou use as setas para mudar a ordem' : ''}` : ''}</p>
              ${canWrite && n ? addBtn() : ''}
            </div>
            ${hidden ? html`<div class="alert alert--warning mb-3">${icon('alert')}<div>${plural(hidden, 'produto não aparece', 'produtos não aparecem')} na loja por não estar${hidden > 1 ? 'em' : ''} ativo${hidden > 1 ? 's' : ''}.</div></div>` : ''}
            ${n
              ? html`<ul class="sc-list" data-sortable="${canWrite && n > 1 ? 'items' : ''}">${items.map((it, i) => {
                  const p = it.product || {};
                  const name = p.name || 'Produto';
                  return html`<li class="sc-row sc-row--square ${p.status === 'active' ? '' : 'is-off'}" data-id="${it.id}" draggable="${canWrite && n > 1 ? 'true' : 'false'}">
                    ${handle(canWrite && n > 1)}
                    <div class="sc-media">${thumb(p.image_url)}</div>
                    <div class="sc-info">
                      <div class="sc-title ellipsis">${i + 1}. ${name}</div>
                      <div class="sc-meta"><span>${p.sku || 'Sem SKU'}</span><span>${money(p.price)}</span>${p.status !== 'active' ? badge(PRODUCT_STATUS[p.status]?.label || p.status || '—', 'warning') : ''}</div>
                    </div>
                    <div class="sc-side">${canWrite
                      ? html`${moveBtns(i, n, name)}<button class="btn btn--ghost btn--sm sc-danger" type="button" data-remove aria-label="Remover “${name}” da prateleira">${icon('trash', 'icon-sm')}<span class="sc-rm-label">Remover</span></button>`
                      : ''}</div>
                  </li>`;
                })}</ul>`
              : empty('Prateleira vazia', 'Sem produtos, a prateleira não aparece na loja.', canWrite ? addBtn() : '')}`
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
            toast('Ordem salva.', 'success', 2000);
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
        if (e.target.closest('[data-retry]')) {
          render(box, loading());
          return load();
        }
        if (e.target.closest('[data-add]')) {
          const chosen = await pickProducts({ storeId: coll.store_id, exclude: new Set(items.map((it) => it.product_id)), title: `Adicionar à “${coll.title}”` });
          if (!chosen.length) return;
          const start = nextOrder(items);
          try {
            await q(sb.from('collection_items').insert(chosen.map((p, i) => ({ collection_id: coll.id, product_id: p.id, sort_order: start + i }))));
            changed = true;
            toast(`${plural(chosen.length, 'produto adicionado', 'produtos adicionados')}.`, 'success');
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
            }, 4000);
            return;
          }
          rm.disabled = true;
          seq += 1;
          try {
            await q(sb.from('collection_items').delete().eq('collection_id', coll.id).eq('product_id', it.product_id));
            items = items.filter((x) => x !== it);
            changed = true;
            toast('Produto removido da prateleira.', 'success', 2200);
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
async function scopedTab(pane, ctx, alive, tab) {
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
    if (spinner) render(pane, loading());
    try {
      const r = await fetchAll();
      if (!alive() || my !== seq) return;
      rows = r.list;
      perStore = r.counts || [];
      pins = new Map(r.prods.map((p) => [p.id, p]));
      draw();
    } catch (e) {
      if (!alive() || my !== seq) return;
      if (spinner || !rows.length) render(pane, retryBlock(e));
      else toastError(e);
    }
  };

  const sectionRows = (kind, scope) => rows.filter((r) => kindOf(r) === kind && (scope === 'store' ? !!r.store_id : !r.store_id)).sort(byOrder);
  const canWriteScope = (scope) => (scope === 'network' ? ctx.isGlobal : ctx.can('catalog', storeId));

  const bannerRow = (b, i, n, canWrite) => {
    const st = liveState(b);
    const isHero = b.kind === 'hero';
    const sortableRow = canWrite && n > 1;
    const pinList = isHero ? (b.pin_product_ids || []).map((id) => pins.get(id) || { id, missing: true }) : [];
    return html`<li class="sc-row ${isHero ? '' : 'sc-row--square'} ${st.key === 'live' ? '' : 'is-off'}" data-id="${b.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${handle(sortableRow)}
      <div class="sc-media">
        ${isHero
          ? html`${thumb(b.image_url, 'sc-media__wide')}${b.image_mobile_url
              ? thumb(b.image_mobile_url, 'sc-media__tall')
              : html`<span class="sc-media__tall sc-noimg" title="Sem imagem para celular: usa a desktop">${icon('image', 'icon-sm')}<span class="visually-hidden">Sem imagem para celular</span></span>`}`
          : thumb(b.image_url, 'sc-media__square')}
      </div>
      <div class="sc-info">
        <div class="sc-badges">${badge(st.label, st.tone)}${b.store_id ? '' : netBadge()}</div>
        ${b.kicker ? html`<div class="sc-kicker">${b.kicker}</div>` : ''}
        <div class="sc-title">${b.title}</div>
        ${b.text ? html`<div class="sc-text">${b.text}</div>` : ''}
        <div class="sc-meta">
          ${b.link_url ? html`<span title="Link">${svg('link', 'icon-sm')}<span class="mono ellipsis">${b.link_url}</span></span>` : html`<span class="faint">Sem link</span>`}
          <span>${svg('clock', 'icon-sm')}${scheduleText(b)}</span>
        </div>
        ${pinList.length
          ? html`<div class="sc-pinline"><span class="small muted">No ambiente:</span>${pinList.map((p) =>
              p.missing
                ? badge('Produto removido', 'danger')
                : html`<span class="sc-pinchip ${p.status === 'active' ? '' : 'is-warn'}" title="${p.status === 'active' ? p.name : `${p.name} (não aparece: ${PRODUCT_STATUS[p.status]?.label || p.status})`}">${thumb(p.image_url, 'sc-pinchip__img')}<span class="ellipsis">${p.name}</span></span>`
            )}</div>`
          : ''}
      </div>
      <div class="sc-side">${canWrite
        ? html`${activeSwitch(b.id, b.active, 'Ativo', b.title)}${moveBtns(i, n, b.title)}${rowActions(b.title)}`
        : html`<span class="small muted">Gerenciado pela rede</span>`}</div>
    </li>`;
  };

  const annRow = (a, i, n, canWrite) => {
    const st = liveState(a);
    const sortableRow = canWrite && n > 1;
    const short = a.text.length > 40 ? `${a.text.slice(0, 40)}…` : a.text;
    return html`<li class="sc-row sc-row--nomedia ${st.key === 'live' ? '' : 'is-off'}" data-id="${a.id}" draggable="${sortableRow ? 'true' : 'false'}">
      ${handle(sortableRow)}
      <div class="sc-info">
        <div class="sc-bar"><span>${a.text}</span>${a.cta_label && a.cta_url ? html`<span class="sc-bar__cta">${a.cta_label}</span>` : ''}</div>
        <div class="sc-meta">
          ${badge(st.label, st.tone)}${a.store_id ? '' : netBadge()}
          ${a.cta_url ? html`<span title="Link do botão">${svg('link', 'icon-sm')}<span class="mono ellipsis">${a.cta_url}</span></span>` : html`<span class="faint">Sem botão</span>`}
          <span>${svg('clock', 'icon-sm')}${scheduleText(a)}</span>
        </div>
      </div>
      <div class="sc-side">${canWrite
        ? html`${activeSwitch(a.id, a.active, 'Ativo', short)}${moveBtns(i, n, short)}${rowActions(short)}`
        : html`<span class="small muted">Gerenciado pela rede</span>`}</div>
    </li>`;
  };

  const sectionHTML = (kind, scope) => {
    const G = GROUPS[kind];
    const list = sectionRows(kind, scope);
    const canWrite = canWriteScope(scope);
    const canCreate = canWrite && (scope === 'store' || !storeId);
    if (scope === 'network' && storeId && !list.length && !ctx.isGlobal) return '';
    const key = `${kind}-${scope}`;
    const sortableList = canWrite && list.length > 1;
    const desc =
      scope === 'store'
        ? `Aparecem só em ${ctx.store?.name || 'esta loja'}, antes dos itens da rede.`
        : `Aparecem em todas as lojas${storeId ? ', depois dos itens de cada loja' : ', depois dos itens próprios de cada uma'}.${ctx.isGlobal ? '' : ' Só a administração da rede altera.'}`;
    const newBtn = html`<button class="btn btn--primary btn--sm" type="button" data-new="${kind}" data-scope="${scope}">${icon('plus', 'icon-sm')} ${G.new}</button>`;
    return html`<section class="card sc-section" aria-labelledby="sc-h-${key}">
      <div class="card__head">
        <div class="grow">
          <h3 class="h3 sc-h" id="sc-h-${key}">${G[scope]} <span class="muted">(${list.length})</span>${scope === 'network' ? netBadge() : ''}</h3>
          <p class="small muted">${desc}</p>
        </div>
        ${canCreate
          ? newBtn
          : scope === 'network' && ctx.isGlobal && storeId
            ? html`<button class="btn btn--sm" type="button" data-network-view>${icon('network', 'icon-sm')} Criar na visão da rede</button>`
            : ''}
      </div>
      <div class="card__body">${list.length
        ? html`<ul class="sc-list" data-sortable="${sortableList ? `${kind}:${scope}` : ''}">${list.map((r, i) => (isAnn ? annRow : bannerRow)(r, i, list.length, canWrite))}</ul>`
        : html`<p class="sc-none">${G.none} ${scope === 'store' ? 'próprio desta loja' : 'da rede'}.</p>`}</div>
    </section>`;
  };

  const groupHTML = (kind) => {
    const G = GROUPS[kind];
    const all = rows.filter((r) => kindOf(r) === kind);
    const live = all.filter((r) => liveState(r).key === 'live').length;
    const many = cfg.kinds.length > 1;
    return html`<div class="sc-group">
      <div class="sc-group__head">
        <div class="grow">${many ? html`<h2 class="h2">${G.title}</h2>` : ''}<p class="muted ${many ? 'small' : ''}">${G.desc}</p></div>
        ${storeId ? html`<span class="badge ${live ? 'badge--success' : ''}">${plural(live, `${G.one} no ar`, `${G.many} no ar`)} nesta loja</span>` : ''}
      </div>
      ${storeId ? [sectionHTML(kind, 'store'), sectionHTML(kind, 'network')] : sectionHTML(kind, 'network')}
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
    return html`<section class="card sc-section" aria-labelledby="sc-h-stores">
      <div class="card__head"><div class="grow">
        <h3 class="h3" id="sc-h-stores">${cfg.summary}</h3>
        <p class="small muted">Cada loja pode ter itens próprios, que aparecem antes dos da rede. Abra uma loja para gerenciá-los.</p>
      </div></div>
      <div class="card__body"><ul class="sc-stores">${ctx.stores.map((s) => {
        const c = by.get(s.id) || { total: 0, live: 0 };
        return html`<li><button class="sc-store" type="button" data-goto-store="${s.id}">
          <span class="sc-store__txt"><strong class="ellipsis">${s.name}</strong>
          <span class="small muted">${c.total ? `${plural(c.total, 'item', 'itens')} · ${num(c.live)} no ar` : 'Nenhum item próprio'}</span></span>
          ${icon('chevronRight', 'icon-sm')}
        </button></li>`;
      })}</ul></div>
    </section>`;
  };

  const draw = () => keepFocus(pane, paint);
  const paint = () => {
    render(
      pane,
      html`<div class="stack sc-tab">
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
      if (await saveOrder(cfg.table, sectionRows(kind, scope), ids)) toast('Ordem salva.', 'success', 2000);
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

  pane.addEventListener('click', async (e) => {
    if (e.target.closest('[data-retry]')) return load(true);
    const goto = e.target.closest('[data-goto-store]');
    if (goto) return ctx.setStore(goto.dataset.gotoStore, `#/showcase/${tab}`);
    if (e.target.closest('[data-network-view]')) return ctx.setStore(null, `#/showcase/${tab}`);
    const nb = e.target.closest('[data-new]');
    if (nb) {
      const kind = nb.dataset.new;
      const scope = nb.dataset.scope;
      return editor({ kind, storeId: scope === 'store' ? storeId : null, order: nextOrder(sectionRows(kind, scope)), onSaved: () => load() });
    }
    const row = e.target.closest('.sc-row[data-id]');
    const item = row && rows.find((r) => r.id === row.dataset.id);
    if (!item) return;
    const G = GROUPS[kindOf(item)];
    const name = isAnn ? item.text : item.title;
    if (e.target.closest('[data-edit]')) return editor({ item, kind: kindOf(item), storeId: item.store_id, onSaved: () => load() });
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: `Excluir ${G.one}`,
        message: `Excluir o ${G.one} “${name}”?${item.store_id ? '' : ' Ele sai de todas as lojas.'} Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await q(sb.from(cfg.table).delete().eq('id', item.id));
        if (!isAnn) releaseImages([item.image_url, item.image_mobile_url]);
        toast(`${G.one[0].toUpperCase()}${G.one.slice(1)} excluído.`, 'success');
        load();
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
    if (!rows.some((r) => r.id === id)) return;
    seq += 1; // descarta cargas em andamento, que trariam o valor antigo
    inp.disabled = true;
    try {
      await q(sb.from(cfg.table).update({ active: value }).eq('id', id));
      rows.forEach((r) => r.id === id && (r.active = value));
      toast(value ? 'Ativado.' : 'Desativado.', 'success', 2000);
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

/* ---------- Campos comuns dos editores ---------- */
const scheduleFields = (item, order) => html`
  <div class="field col-4">
    <label for="s-start">Início</label>
    <input class="input" type="datetime-local" id="s-start" name="starts_at" value="${toLocalInput(item?.starts_at)}">
    <span class="hint">Horário de Brasília. Vazio: no ar ao salvar.</span>
  </div>
  <div class="field col-4">
    <label for="s-end">Fim</label>
    <input class="input" type="datetime-local" id="s-end" name="ends_at" value="${toLocalInput(item?.ends_at)}">
    <span class="hint">Vazio: sem data para sair.</span>
  </div>
  <div class="field col-4">
    <label for="s-order">Ordem</label>
    <input class="input" type="number" inputmode="numeric" min="0" step="1" id="s-order" name="sort_order" data-type="int" value="${item ? item.sort_order : order}">
    <span class="hint">Menor aparece primeiro.</span>
  </div>
  <div class="col-12">${switchField({ label: 'Ativo', name: 'active', checked: item ? item.active : true, hint: 'Desligue para tirar do ar sem excluir.' })}</div>`;

function readSchedule(d, errors) {
  const starts = fromLocalInput(d.starts_at);
  const ends = fromLocalInput(d.ends_at);
  if (starts === undefined) errors.starts_at = 'Data inválida.';
  if (ends === undefined) errors.ends_at = 'Data inválida.';
  if (starts && ends && ends <= starts) errors.ends_at = 'O fim precisa ser depois do início.';
  if (d.sort_order === null || !Number.isInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 100000) errors.sort_order = 'Use um número inteiro de 0 em diante.';
  return { starts_at: starts ?? null, ends_at: ends ?? null, sort_order: d.sort_order, active: d.active };
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
  const G = GROUPS[kind];
  const sizeHint = (k) => (k === 'room' ? 'Quadrada, 900 × 900 px.' : k === 'mosaic' ? 'Quadrada, 1400 × 1400 px.' : 'Desktop: 2400 × 900 px (proporção 8:3).');
  const title = isNew ? `${G.new}${scopeStore ? '' : ' da rede'}` : `Editar ${G.one}${scopeStore ? '' : ' da rede'}`;

  openModal({
    title,
    size: 'lg',
    body: html`<form class="form-grid sc-form" data-form novalidate>
      ${isHero
        ? html`<div class="field col-4">
            <label for="b-kicker">Chamada</label>
            <input class="input" id="b-kicker" name="kicker" maxlength="40" value="${item?.kicker || ''}" placeholder="Ex.: Nova coleção">
          </div>`
        : html`<div class="field col-4">
            <label for="b-kind">Tipo</label>
            <select class="select" id="b-kind" name="kind">${selectOptions([['mosaic', 'Mosaico (inspiração)'], ['room', 'Ambiente']], kind)}</select>
          </div>`}
      <div class="field col-8">
        <label for="b-title">Título *</label>
        <input class="input" id="b-title" name="title" maxlength="80" required value="${item?.title || ''}" autofocus>
      </div>
      <div class="field col-12">
        <label for="b-text">Texto</label>
        <textarea class="textarea" id="b-text" name="text" maxlength="200" rows="2" style="min-height:64px">${item?.text || ''}</textarea>
      </div>
      <div class="field col-12">
        <label for="b-link">Link</label>
        <input class="input" id="b-link" name="link_url" list="sc-link-list" maxlength="500" value="${item?.link_url || ''}" placeholder="#ofertas" autocomplete="off" spellcheck="false">
        <datalist id="sc-link-list"></datalist>
        <span class="hint">Ex.: #ofertas (prateleira), ?categoria=sofas ou um endereço completo (https://…).</span>
      </div>
      <div class="field ${isHero ? 'col-8' : 'col-12'}">
        <span class="label" id="b-img-l">${isHero ? 'Imagem desktop *' : 'Imagem *'}</span>
        <div class="sc-up ${isHero ? 'sc-up--wide' : 'sc-up--square'}" data-up="image_url" role="group" aria-labelledby="b-img-l"></div>
        <input type="hidden" name="image_url">
        <span class="hint" data-size-hint>${sizeHint(kind)}</span>
      </div>
      ${isHero
        ? html`<div class="field col-4">
            <span class="label" id="b-imgm-l">Imagem celular</span>
            <div class="sc-up sc-up--tall" data-up="image_mobile_url" role="group" aria-labelledby="b-imgm-l"></div>
            <input type="hidden" name="image_mobile_url">
            <span class="hint">900 × 1323 px. Sem ela, o celular usa a desktop.</span>
          </div>
          <div class="field col-12">
            <span class="label">Produtos “No ambiente”</span>
            ${pinsAllowed
              ? html`<div data-pins></div><span class="hint">Até ${MAX_PINS} produtos da loja aparecem sobre o slide (só os ativos).</span>`
              : html`<p class="small muted">Disponível só nos slides de uma loja, porque cada loja tem o seu catálogo.</p>`}
          </div>`
        : ''}
      ${scheduleFields(item, order)}
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar' : 'Salvar'}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      fillDatalist(el, scopeStore);
      const ups = {};
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
          },
          true
        );
        ups[name] = imageUploader(box, {
          value: orig[name] ? [orig[name]] : [],
          scope,
          max: 1,
          folder: 'banners',
          label: 'Enviar imagem',
          onChange: (urls) => {
            const u = urls[0] || '';
            if (u && !u.startsWith('data:') && u !== orig[name]) uploads.add(u);
            form.elements[name].value = u.startsWith('data:') ? '' : u;
            if (form.elements[name].value) $$(`.error[data-for="${name}"]`, form).forEach((n) => n.remove());
          },
        });
      }
      if (!isHero) {
        form.elements.kind.addEventListener('change', () => {
          const k = form.elements.kind.value;
          $('[data-size-hint]', el).textContent = sizeHint(k);
          const g = GROUPS[k];
          const t = isNew ? `${g.new}${scopeStore ? '' : ' da rede'}` : `Editar ${g.one}${scopeStore ? '' : ' da rede'}`;
          $('.modal__title', el).textContent = t;
          el.setAttribute('aria-label', t);
        });
      }

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
                  <span class="small muted">${p.missing ? 'Não encontrado no catálogo; será retirado ao salvar' : `${p.sku || 'Sem SKU'} · ${money(p.price)}${p.status && p.status !== 'active' ? ` · ${PRODUCT_STATUS[p.status]?.label || p.status} (não aparece)` : ''}`}</span></span>
                  ${moveBtns(i, pins.length, p.name)}
                  <button class="btn btn--ghost btn--sm btn--icon sc-danger" type="button" data-pin-remove="${i}" aria-label="Tirar “${p.name}” do slide">${icon('close', 'icon-sm')}</button>
                </li>`
              )}</ul>`
            : ''}
          ${pins.length < MAX_PINS ? html`<button class="btn btn--sm mt-2" type="button" data-pin-add>${icon('plus', 'icon-sm')} Adicionar produto</button>` : ''}`
        );
      };
      if (pinsEl) {
        const ids = item?.pin_product_ids || [];
        if (ids.length) {
          render(pinsEl, loading('Carregando produtos…'));
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

      const save = async (btn) => {
        if (Object.values(ups).some((u) => u.value.some((x) => x.startsWith('data:')))) return toast('Aguarde o envio da imagem terminar.', 'warning');
        const d = readForm(form);
        const errors = {};
        if (!d.title) errors.title = 'Informe o título.';
        if (!d.image_url) errors.image_url = 'Envie a imagem.';
        if (d.link_url && !LINK_RE.test(d.link_url)) errors.link_url = LINK_HELP;
        const sched = readSchedule(d, errors);
        if (!showErrors(form, errors)) return;
        const payload = {
          kind: isHero ? 'hero' : d.kind,
          title: d.title,
          text: d.text,
          link_url: d.link_url,
          image_url: d.image_url,
          ...sched,
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
        toast(isNew ? `${G.one[0].toUpperCase()}${G.one.slice(1)} criado.` : 'Alterações salvas.', 'success');
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
  openModal({
    title: isNew ? `Novo aviso${scopeStore ? '' : ' da rede'}` : `Editar aviso${scopeStore ? '' : ' da rede'}`,
    body: html`<form class="form-grid" data-form novalidate>
      <div class="field col-12">
        <label for="a-text">Texto *</label>
        <textarea class="textarea" id="a-text" name="text" maxlength="${MAX}" rows="2" style="min-height:64px" required autofocus placeholder="Ex.: Frete grátis acima de R$ 999 na sua cidade">${item?.text || ''}</textarea>
        <span class="hint" data-count></span>
      </div>
      <div class="field col-6">
        <label for="a-cta">Texto do botão</label>
        <input class="input" id="a-cta" name="cta_label" maxlength="30" value="${item?.cta_label || ''}" placeholder="Ex.: Ver ofertas">
      </div>
      <div class="field col-6">
        <label for="a-url">Link do botão</label>
        <input class="input" id="a-url" name="cta_url" list="sc-link-list" maxlength="500" value="${item?.cta_url || ''}" placeholder="#ofertas" autocomplete="off" spellcheck="false">
        <datalist id="sc-link-list"></datalist>
        <span class="hint">O botão aparece quando os dois campos estão preenchidos.</span>
      </div>
      <div class="col-12"><span class="label">Prévia</span><div class="sc-bar mt-1" data-preview></div></div>
      ${scheduleFields(item, order)}
    </form>`,
    actions: html`<button class="btn" type="button" data-close>Cancelar</button>
      <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar aviso' : 'Salvar'}</button>`,
    onMount(el, close) {
      const form = $('[data-form]', el);
      clearErrorsOnInput(form);
      fillDatalist(el, scopeStore);
      const preview = () => {
        const t = form.elements.text.value.trim();
        const l = form.elements.cta_label.value.trim();
        const u = form.elements.cta_url.value.trim();
        $('[data-count]', el).textContent = `${t.length}/${MAX} caracteres · textos curtos cabem melhor no celular.`;
        render($('[data-preview]', el), html`<span>${t || 'Texto do aviso'}</span>${l && u ? html`<span class="sc-bar__cta">${l}</span>` : ''}`);
      };
      form.addEventListener('input', preview);
      preview();
      const save = async (btn) => {
        const d = readForm(form);
        const errors = {};
        if (!d.text) errors.text = 'Escreva o aviso.';
        if (d.cta_label && !d.cta_url) errors.cta_url = 'Informe o link do botão.';
        if (d.cta_url && !d.cta_label) errors.cta_label = 'Informe o texto do botão.';
        if (d.cta_url && !LINK_RE.test(d.cta_url)) errors.cta_url = LINK_HELP;
        const sched = readSchedule(d, errors);
        if (!showErrors(form, errors)) return;
        const payload = { text: d.text, cta_label: d.cta_label, cta_url: d.cta_url, ...sched };
        try {
          await withBusy(btn, () =>
            isNew ? q(sb.from('announcements').insert({ ...payload, store_id: scopeStore })) : q(sb.from('announcements').update(payload).eq('id', item.id))
          );
        } catch (err) {
          return toastError(err);
        }
        toast(isNew ? 'Aviso criado.' : 'Aviso salvo.', 'success');
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

/* ---------- Módulo ---------- */
const TAB_RENDER = {
  shelves: shelvesTab,
  hero: (pane, ctx, alive) => scopedTab(pane, ctx, alive, 'hero'),
  tiles: (pane, ctx, alive) => scopedTab(pane, ctx, alive, 'tiles'),
  bar: (pane, ctx, alive) => scopedTab(pane, ctx, alive, 'bar'),
};

function drawActions(ctx) {
  if (ctx.store) {
    ctx.setActions(
      html`<a class="btn" href="${storefrontUrl(ctx.store.slug)}" target="_blank" rel="noopener" aria-label="Pré-visualizar loja (abre em nova aba)" title="Abre a loja virtual em nova aba">${icon('eye')}<span class="sc-hide-sm">Pré-visualizar loja</span></a>`
    );
  } else if (ctx.stores.length) {
    ctx.setActions(html`<div class="sc-dd">
      <button class="btn" type="button" data-menu="sc-preview-menu" aria-haspopup="true" aria-label="Pré-visualizar uma loja">${icon('eye')}<span class="sc-hide-sm">Pré-visualizar loja</span>${icon('chevronDown', 'icon-sm')}</button>
      <div class="menu" id="sc-preview-menu" hidden>${ctx.stores.map(
        (s) => html`<a href="${storefrontUrl(s.slug)}" target="_blank" rel="noopener">${icon('external', 'icon-sm')}<span class="ellipsis">${s.name}</span></a>`
      )}</div>
    </div>`);
  }
}

export default {
  title: 'Vitrine e banners',
  async render(view, ctx) {
    injectStyle('showcase', CSS);
    drawActions(ctx);
    let tab = TABS.some((t) => t.id === ctx.args[0]) ? ctx.args[0] : 'shelves';
    render(
      view,
      html`<div class="sc">
        <div class="tabs" role="tablist" aria-label="Seções da vitrine">${TABS.map(
          (t) => html`<button class="tab" type="button" role="tab" id="sc-tab-${t.id}" aria-controls="sc-panel" data-tab="${t.id}">${t.label}</button>`
        )}</div>
        <div id="sc-panel" role="tabpanel" data-panel></div>
      </div>`
    );
    const panel = $('[data-panel]', view);
    const tabs = $$('[data-tab]', view);
    let token = 0;
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
      const pane = document.createElement('div');
      panel.replaceChildren(pane);
      const my = ++token;
      const alive = () => my === token && pane.isConnected;
      Promise.resolve(TAB_RENDER[id](pane, ctx, alive)).catch((e) => {
        console.error(e);
        if (alive()) render(pane, retryBlock(e));
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
    show(tab);
  },
};

const CSS = `
.sc-tab { --gap: 22px; }
.sc-group { display: flex; flex-direction: column; gap: 12px; }
.sc-group__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
.sc-group__head .h2 + p { margin-top: 2px; }
.sc-section .card__head { align-items: flex-start; flex-wrap: wrap; }
.sc-section .card__head p { margin-top: 2px; }
.sc-section .card__body { padding: 12px; }
.sc-h { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sc-none { padding: 16px 8px; text-align: center; color: var(--muted); }
.sc-list { display: flex; flex-direction: column; gap: 8px; }
.sc-row {
  display: grid; grid-template-columns: 18px auto minmax(0, 1fr) auto; grid-template-areas: "handle media info side";
  align-items: center; gap: 10px 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff;
}
.sc-row--nomedia { grid-template-columns: 18px minmax(0, 1fr) auto; grid-template-areas: "handle info side"; }
.sc-row[draggable="true"] { cursor: grab; }
.sc-row.is-off { background: var(--surface-2); }
.sc-row.is-off .sc-media img { opacity: 0.6; }
.sc-row.is-dragging { opacity: 0.45; outline: 2px dashed var(--accent); outline-offset: 1px; }
.sc-handle { grid-area: handle; display: flex; align-items: center; justify-content: center; align-self: stretch; color: var(--faint); }
.sc-media { grid-area: media; display: flex; align-items: center; gap: 6px; }
.sc-media .thumb { width: 48px; height: 48px; }
.sc-media__wide, .sc-media__tall, .sc-media__square { display: block; border-radius: 6px; background: #f0f0f0; object-fit: cover; }
.sc-media__wide { width: 208px; aspect-ratio: 8 / 3; height: auto; }
.sc-media__tall { width: 54px; aspect-ratio: 602 / 885; height: auto; }
.sc-media__square { width: 80px; aspect-ratio: 1; height: auto; }
.sc-noimg { display: flex; align-items: center; justify-content: center; color: var(--faint); background: #fff; border: 1px dashed var(--line-strong); }
.sc-info { grid-area: info; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.sc-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--accent); }
.sc-title { font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
.sc-text { font-size: 13px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12.5px; color: var(--muted); }
.sc-meta > span:not(.badge) { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
.sc-side { grid-area: side; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 4px; }
.sc-move { display: inline-flex; }
.sc-danger { color: var(--danger); }
.sc-danger.is-armed { border-color: var(--danger); background: var(--danger-soft); }
.sc-toggle { margin: 0 6px; }
.sc-toggle .switch__track { width: 34px; height: 20px; }
.sc-toggle .switch__track::after { width: 14px; height: 14px; }
.sc-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: #efefef; font-size: 11.5px; text-align: center; }
.sc-pinline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 3px; }
.sc-pinchip { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 2px 9px 2px 2px; border: 1px solid var(--line); border-radius: 999px; background: #fff; font-size: 12px; color: var(--text); }
.sc-pinchip.is-warn { border-color: #f3d39c; background: var(--warning-soft); }
.sc-pinchip__img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: none; }
.sc-pinchip__img.sc-noimg { border: 0; background: #f0f0f0; }
.sc-bar { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 16px; padding: 8px 12px; border-radius: 6px; background: #111; color: #fff; font-size: 13px; letter-spacing: 0.4px; text-align: center; overflow-wrap: anywhere; }
.sc-bar__cta { padding: 3px 14px; border-radius: 999px; background: var(--orange); color: #191919; font-size: 11.5px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
.sc-stores { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.sc-store { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; text-align: left; cursor: pointer; }
.sc-store:hover { border-color: var(--line-strong); background: var(--surface-2); }
.sc-store__txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.sc-dd { position: relative; }
.sc-dd .menu { min-width: 280px; max-height: min(420px, 70vh); overflow-y: auto; }
.sc-items__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.sc-up--wide .uploader { grid-template-columns: minmax(0, 1fr); }
.sc-up--wide .uploader__item, .sc-up--wide .uploader__add { aspect-ratio: 8 / 3; }
.sc-up--tall .uploader { grid-template-columns: minmax(0, 150px); }
.sc-up--tall .uploader__item, .sc-up--tall .uploader__add { aspect-ratio: 602 / 885; }
.sc-up--square .uploader { grid-template-columns: minmax(0, 220px); }
.sc-pins { display: flex; flex-direction: column; gap: 6px; }
.sc-pin { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.sc-pin.is-missing { border-color: #f0c2c4; background: var(--danger-soft); }
.sc-pin__name, .sc-pick__name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.sc-picker .search { max-width: none; }
.sc-pick-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.sc-pick { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.sc-pick:hover { background: var(--surface-2); }
.sc-pick:has(input:checked:not(:disabled)) { border-color: var(--accent); background: #fff7f7; }
.sc-pick.is-in { cursor: default; opacity: 0.7; }
.sc-pick input { width: 18px; height: 18px; flex: none; accent-color: var(--accent); }
.sc-pick .thumb, .sc-pin .thumb { width: 44px; height: 44px; }
@media (max-width: 760px) {
  .sc-row { grid-template-columns: 18px minmax(0, 1fr); grid-template-areas: "handle media" "handle info" "side side"; }
  .sc-row--nomedia { grid-template-columns: 18px minmax(0, 1fr); grid-template-areas: "handle info" "side side"; }
  .sc-row--square { grid-template-columns: 18px auto minmax(0, 1fr); grid-template-areas: "handle media info" "side side side"; }
  .sc-row:not(.sc-row--square) .sc-media__wide { width: auto; flex: 1; min-width: 0; }
  .sc-media:has(.sc-media__wide) { width: 100%; }
  .sc-media__square { width: 64px; }
  .sc-side { justify-content: flex-start; padding-top: 8px; border-top: 1px solid var(--line); }
  .sc-side .sc-toggle { margin-left: 0; margin-right: auto; }
  .sc-stores { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .sc-hide-sm { display: none; }
  .sc-rm-label { display: none; }
  .sc-danger.is-armed .sc-rm-label { display: inline; }
}
`;
