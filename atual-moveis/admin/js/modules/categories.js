// Categorias da rede: uma taxonomia única para todas as lojas (só administradores da rede).
//
// Lista em árvore (principais e subcategorias), contagem de produtos na rede (e na loja escolhida),
// tipo de modelo 3D (categories.model_kind; vazio = automático pelo nome), atalhos para ativar e para
// mostrar na faixa de categorias, editor e exclusão.
// Excluir uma categoria não apaga produtos: eles ficam sem categoria (category_id nulo) e as
// subcategorias viram principais (on delete set null).
// Imagens: ui.imageUploader (network/categories). O arquivo antigo só sai do storage depois de salvar
// e se nenhuma outra categoria usar a mesma URL.
import { sb, q, mediaUrl, removeImage } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, badge, num, slugify, openModal, confirmDialog, readForm, showErrors,
  withBusy, switchField, empty, errorBlock, skeleton, imageUploader, injectStyle, debounce, fold, highlight, customSelect,
} from '../ui.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STORAGE_MARK = '/storage/v1/object/public/media/';
const FILTERS = [
  ['all', 'Todas'],
  ['active', 'Ativas'],
  ['inactive', 'Inativas'],
  ['empty', 'Sem produtos'],
];
// Tipos aceitos pela coluna categories.model_kind (CHECK da migração 0007)
const CATEGORY_KINDS = [
  'sofa', 'armchair', 'chair', 'bed', 'mattress', 'coffee_table', 'side_table', 'dining_table', 'dresser', 'nightstand',
  'wardrobe', 'rack', 'shelf', 'desk', 'tv', 'fridge', 'washer', 'stove', 'small_appliance', 'generic', 'none',
];
const KIND_ICON = {
  sofa: 'sofa', armchair: 'armchair', chair: 'chair', bed: 'bed', mattress: 'mattress', nightstand: 'dresser', dresser: 'dresser',
  wardrobe: 'wardrobe', coffee_table: 'table', side_table: 'table', dining_table: 'table', desk: 'table', rack: 'rack', shelf: 'rack',
  tv: 'tv', fridge: 'fridge', washer: 'washer', stove: 'stove', small_appliance: 'bolt', generic: 'cube', none: 'none',
};

const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const isStored = (u) => typeof u === 'string' && u.includes(STORAGE_MARK);
const countOf = (embed) => (Array.isArray(embed) ? embed[0]?.count ?? 0 : 0);

let inferP = null;
const loadInfer = () => {
  inferP = inferP || import('/assets/js/3d/infer.js').catch((e) => {
    inferP = null;
    throw e;
  });
  return inferP;
};

async function headCount(qb) {
  const r = await q(qb);
  return r?.count || 0;
}

// Apaga do storage imagens que nenhuma categoria usa mais
async function releaseImages(urls) {
  for (const url of new Set(urls.filter(isStored))) {
    try {
      const n = await headCount(sb.from('categories').select('id', { count: 'exact', head: true }).eq('image_url', url));
      if (!n) await removeImage(url);
    } catch {
      /* fica no storage */
    }
  }
}

// Banners e avisos com link para ?categoria=<slug>
async function linkUsage(slug) {
  const pat = `%categoria=${slug}%`;
  const [b, a] = await Promise.all([
    headCount(sb.from('banners').select('id', { count: 'exact', head: true }).ilike('link_url', pat)),
    headCount(sb.from('announcements').select('id', { count: 'exact', head: true }).ilike('cta_url', pat)),
  ]);
  return b + a;
}

export default {
  title: 'Categorias',
  async render(view, ctx) {
    injectStyle('categories', CSS);
    if (!ctx.isGlobal) {
      render(
        view,
        html`<div class="card">${empty(
          'Esta área é da administração da rede',
          'As categorias valem para todas as lojas e são definidas pela administração da rede.',
          html`<a class="btn" href="#/dashboard">${icon('chevronLeft', 'icon-sm')} Voltar ao Painel</a>`,
          { art: 'no-access' }
        )}</div>`
      );
      return;
    }
    const storeId = ctx.storeId;
    const here = storeId ? (ctx.storeShort ? ctx.storeShort(ctx.store) : ctx.store?.name) : '';
    let rows = [];
    let filter = 'all';
    let term = '';
    let seq = 0; // a carga mais recente vence
    let infer = null;
    loadInfer()
      .then((m) => {
        infer = m;
        if (rows.length) draw();
      })
      .catch(() => {});
    const kindLabel = (k) => (infer ? infer.kindLabel(k) : k);

    ctx.setTitle('Categorias', 'Valem para a rede toda: menu, filtros, faixa da página inicial e o 3D automático');
    ctx.setActions(html`<button class="btn btn--primary" type="button" data-cat-new>${icon('plus')}<span>Nova categoria</span></button>`);
    $('[data-cat-new]')?.addEventListener('click', () => openEditor(null));

    render(
      view,
      html`<div class="ct">
        <section class="card ct-card">
          <div class="toolbar ct-tb">
            <div class="search ct-tb__search">${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="ct-q">Buscar categoria</label>
              <input class="input" id="ct-q" type="search" placeholder="Buscar por nome ou endereço" autocomplete="off" aria-keyshortcuts="/">
              <span class="kbd kbd--sm ct-tb__kbd" aria-hidden="true">/</span>
            </div>
            <div class="chips" role="group" aria-label="Filtrar categorias" data-filters></div>
          </div>
          <div class="ct-sum" data-summary hidden></div>
          <div data-list aria-live="polite">${skeleton('table', { rows: 8, cols: 4 })}</div>
        </section>
        <p class="ct-foot small muted">${icon('info', 'icon-xs')} “Na faixa”: aparece nos círculos com foto da página inicial. Categorias inativas somem do menu e da faixa; os produtos continuam no catálogo. O tipo 3D vale para todos os produtos da categoria, a menos que o produto escolha outro.</p>
      </div>`
    );
    const listEl = $('[data-list]', view);

    /* ----- Dados ----- */
    const load = async (spinner = false) => {
      const my = ++seq;
      if (spinner) render(listEl, skeleton('table', { rows: 8, cols: 4 }));
      listEl.setAttribute('aria-busy', 'true');
      try {
        let qb = sb
          .from('categories')
          .select(`*, total:products(count), live:products(count)${storeId ? ', here:products(count)' : ''}`)
          .eq('live.status', 'active')
          .order('sort_order')
          .order('name');
        if (storeId) qb = qb.eq('here.store_id', storeId);
        const data = await q(qb);
        if (my !== seq || !listEl.isConnected) return;
        rows = data.map((c) => ({ ...c, total: countOf(c.total), live: countOf(c.live), here: storeId ? countOf(c.here) : null }));
        draw();
      } catch (e) {
        if (my !== seq || !listEl.isConnected) return;
        if (spinner || !rows.length) render(listEl, errorBlock(e, { retry: () => load(true), title: 'Não foi possível carregar as categorias' }));
        else toastError(e);
      } finally {
        if (my === seq) listEl.removeAttribute('aria-busy');
      }
    };

    const tree = () => {
      const ids = new Set(rows.map((c) => c.id));
      const tops = rows.filter((c) => !c.parent_id || !ids.has(c.parent_id));
      const kids = (id) => rows.filter((c) => c.parent_id === id);
      return tops.map((t) => ({ c: t, children: kids(t.id) }));
    };

    const matches = (c) => {
      if (filter === 'active' && !c.active) return false;
      if (filter === 'inactive' && c.active) return false;
      if (filter === 'empty' && c.total) return false;
      if (term && !fold(`${c.name} ${c.slug}`).includes(term)) return false;
      return true;
    };

    /* ----- Desenho ----- */
    const drawFilters = () => {
      const n = {
        all: rows.length,
        active: rows.filter((c) => c.active).length,
        inactive: rows.filter((c) => !c.active).length,
        empty: rows.filter((c) => !c.total).length,
      };
      render(
        $('[data-filters]', view),
        FILTERS.map(
          ([k, label]) => html`<button class="chip ${filter === k ? 'is-active' : ''}" type="button" data-filter="${k}" aria-pressed="${filter === k ? 'true' : 'false'}">${label} <span class="chip__count">${num(n[k])}</span></button>`
        )
      );
    };

    // Tipo 3D: escolhido na categoria ou deduzido do nome (como a loja faz)
    const kindCell = (c) => {
      if (c.model_kind) {
        return html`<span class="ct-kind ${c.model_kind === 'none' ? 'is-none' : ''}"><span class="ct-kind__ico" aria-hidden="true">${icon(KIND_ICON[c.model_kind] || 'cube', 'icon-sm')}</span>${kindLabel(c.model_kind)}</span>`;
      }
      let auto = '';
      if (infer) {
        try {
          const parent = rows.find((r) => r.id === c.parent_id) || null;
          const k = infer.inferKind({ name: '' }, { category: c, parentCategory: parent }).kind;
          auto = k && k !== 'generic' ? kindLabel(k) : '';
        } catch {
          auto = '';
        }
      }
      return html`<span class="ct-kind is-auto"><span class="ct-kind__ico ct-kind__ico--auto" aria-hidden="true">${icon('sparkle', 'icon-sm')}</span>${auto ? html`Automático <span class="muted">· ${auto}</span>` : html`Automático <span class="muted">· pelo nome</span>`}</span>`;
    };

    const rowHTML = (c, { child = false, kidsTotal = 0, kidsCount = 0 } = {}) => html`<tr class="${c.active ? '' : 'is-off'} ${child ? 'is-child' : 'is-top'}" data-id="${c.id}">
      <td class="ct-c-cat">
        <div class="ct-cat ${child ? 'ct-cat--child' : ''}">
          ${child ? html`<span class="ct-branch" aria-hidden="true"></span>` : ''}
          ${c.image_url ? html`<img class="thumb" src="${mediaUrl(c.image_url)}" alt="" loading="lazy">` : html`<span class="thumb ct-noimg" aria-hidden="true">${icon('image', 'icon-sm')}</span>`}
          <div class="ct-cat__txt">
            <span class="ct-name"><button class="ct-name__btn" type="button" data-edit>${highlight(c.name, term)}</button>${
              !child && kidsCount ? html`<span class="tag ct-tag">${plural(kidsCount, 'subcategoria', 'subcategorias')}</span>` : ''
            }${c.active ? '' : badge('Inativa', 'dark')}</span>
            <span class="mono muted ct-slug">?categoria=${c.slug}</span>
            ${c.description ? html`<span class="small muted ct-desc">${c.description}</span>` : ''}
          </div>
        </div>
      </td>
      <td class="num ct-c-n" data-label="Produtos na rede">
        <strong>${num(c.total)}</strong>
        <span class="ct-sub">${c.total ? `${num(c.live)} ${c.live === 1 ? 'ativo' : 'ativos'}` : 'nenhum'}${!child && kidsCount && kidsTotal ? ` · +${num(kidsTotal)} nas subs` : ''}</span>
      </td>
      ${storeId ? html`<td class="num ct-c-here" data-label="Em ${here}"><strong>${num(c.here)}</strong></td>` : ''}
      <td class="ct-c-kind" data-label="Tipo 3D">${kindCell(c)}</td>
      <td class="num ct-c-ord" data-label="Ordem"><span class="ct-ord">${num(c.sort_order)}</span></td>
      <td class="ct-c-sw" data-label="Ativa">
        <label class="switch ct-switch"><input type="checkbox" data-toggle="active" ${c.active ? 'checked' : ''} aria-label="Ativa: ${c.name}"><span class="switch__track"></span></label>
      </td>
      <td class="ct-c-sw" data-label="Na faixa">
        <label class="switch ct-switch"><input type="checkbox" data-toggle="show_in_strip" ${c.show_in_strip ? 'checked' : ''} aria-label="Na faixa de categorias: ${c.name}"><span class="switch__track"></span></label>
      </td>
      <td class="right nowrap ct-c-act">
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit aria-label="Editar “${c.name}”" data-tooltip="Editar">${icon('edit', 'icon-sm')}</button>
        <button class="btn btn--ghost btn--sm btn--icon ct-danger" type="button" data-delete aria-label="Excluir “${c.name}”" data-tooltip="Excluir">${icon('trash', 'icon-sm')}</button>
      </td>
    </tr>`;

    const draw = () => {
      drawFilters();
      const t = tree();
      const tops = t.length;
      const subs = rows.length - tops;
      const totalProducts = rows.reduce((s, c) => s + c.total, 0);
      const sum = $('[data-summary]', view);
      sum.hidden = !rows.length;
      render(
        sum,
        rows.length
          ? html`<span><b>${plural(rows.length, 'categoria', 'categorias')}</b> · ${plural(tops, 'principal', 'principais')} e ${plural(subs, 'subcategoria', 'subcategorias')}</span>
            <span>${plural(totalProducts, 'produto classificado', 'produtos classificados')} na rede</span>
            ${storeId ? html`<span>Coluna “Em ${here}”: produtos desta loja</span>` : ''}`
          : ''
      );
      const body = [];
      t.forEach(({ c, children }) => {
        const shownKids = children.filter(matches);
        if (!matches(c) && !shownKids.length) return;
        body.push(rowHTML(c, { kidsCount: children.length, kidsTotal: children.reduce((s, k) => s + k.total, 0) }));
        shownKids.forEach((k) => body.push(rowHTML(k, { child: true })));
      });
      if (!rows.length) {
        render(
          listEl,
          empty(
            'Nenhuma categoria ainda',
            'Categorias organizam o menu, os filtros e a faixa da página inicial de todas as lojas. Comece pelas principais (ex.: Móveis, Eletro).',
            html`<button class="btn btn--primary" type="button" data-new>${icon('plus', 'icon-sm')} Nova categoria</button>`,
            { art: 'empty-box', size: 'lg' }
          )
        );
        return;
      }
      if (!body.length) {
        render(
          listEl,
          empty(
            'Nenhuma categoria encontrada',
            term ? `Nada com “${$('#ct-q', view).value.trim()}”. Confira o nome ou limpe a busca.` : 'Nenhuma categoria neste filtro.',
            html`<button class="btn" type="button" data-clear>${icon('close', 'icon-sm')} Limpar busca e filtro</button>`,
            { art: 'site:empty-search' }
          )
        );
        return;
      }
      render(
        listEl,
        html`<div class="table-wrap"><table class="table ct-table">
          <caption class="visually-hidden">Categorias da rede</caption>
          <thead><tr>
            <th scope="col">Categoria</th>
            <th class="num" scope="col">Produtos na rede</th>
            ${storeId ? html`<th class="num" scope="col">Em ${here}</th>` : ''}
            <th scope="col">Tipo 3D</th>
            <th class="num" scope="col">Ordem</th>
            <th scope="col">Ativa</th>
            <th scope="col">Na faixa</th>
            <th class="right" scope="col"><span class="visually-hidden">Ações</span></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table></div>`
      );
    };

    /* ----- Editor ----- */
    function kindOptions(selected, autoLabel) {
      const list = infer ? infer.KINDS.filter((k) => CATEGORY_KINDS.includes(k.id) && k.id !== 'none' && k.id !== 'generic') : [];
      return html`<option value="" data-icon="auto" data-hint="A loja deduz o modelo pelo nome da categoria e de cada produto" ${!selected ? 'selected' : ''}>Automático${autoLabel ? ` (${autoLabel})` : ''}</option>
        <optgroup label="Escolher manualmente" data-count="${list.length + 1}">${list.map(
          (k) => html`<option value="${k.id}" data-icon="${KIND_ICON[k.id] || 'cube'}" ${selected === k.id ? 'selected' : ''}>${k.label}</option>`
        )}<option value="generic" data-icon="cube" data-hint="Caixa com as medidas do produto" ${selected === 'generic' ? 'selected' : ''}>${kindLabel('generic')}</option></optgroup>
        <option value="none" data-icon="none" data-hint="Esconde o botão “Ver em 3D” nos produtos desta categoria" ${selected === 'none' ? 'selected' : ''}>Sem 3D</option>`;
    }

    async function openEditor(item) {
      const isNew = !item;
      if (!infer) {
        try {
          infer = await loadInfer();
        } catch {
          /* segue sem a lista de tipos */
        }
      }
      const kids = item ? rows.filter((c) => c.parent_id === item.id) : [];
      const parents = rows.filter((c) => !c.parent_id && c.id !== item?.id);
      const orig = item?.image_url || null;
      const uploads = new Set();
      let saved = false;
      let final = null;
      let slugTouched = !isNew;
      const order = isNew ? rows.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1 : item.sort_order;
      openModal({
        title: isNew ? 'Nova categoria' : `Editar “${item.name}”`,
        size: 'lg',
        body: html`<form class="form-grid ct-form" data-form novalidate>
          <div class="field col-8">
            <label for="ct-name">Nome</label>
            <input class="input" id="ct-name" name="name" maxlength="60" required value="${item?.name || ''}" placeholder="Ex.: Sofás" autofocus>
          </div>
          <div class="field col-4">
            <label for="ct-order">Ordem</label>
            <input class="input" id="ct-order" name="sort_order" type="number" inputmode="numeric" min="0" step="1" data-type="int" value="${order}">
            <span class="hint">Menor aparece primeiro.</span>
          </div>
          <div class="field col-6">
            <label for="ct-slug">Endereço</label>
            <div class="input-group"><span class="input-group__addon">?categoria=</span><input class="input mono" id="ct-slug" name="slug" maxlength="60" required value="${item?.slug || ''}" autocomplete="off" spellcheck="false" placeholder="sofas"></div>
            <span class="hint" data-slug-hint></span>
          </div>
          <div class="field col-6">
            <label for="ct-parent">Categoria pai</label>
            <select class="select" id="ct-parent" name="parent_id" data-sheet-title="Categoria pai" ${kids.length ? 'disabled' : ''}>
              <option value="" data-icon="layers" data-hint="Vira um grupo do menu" ${!item?.parent_id ? 'selected' : ''}>Nenhuma (principal)</option>
              ${parents.map((pc) => html`<option value="${pc.id}" data-hint="${plural(pc.total, 'produto', 'produtos')}" ${item?.parent_id === pc.id ? 'selected' : ''}>${pc.name}</option>`)}
            </select>
            <span class="hint">${kids.length ? `Tem ${plural(kids.length, 'subcategoria', 'subcategorias')}, então continua como principal.` : 'Principais viram grupos do menu (ex.: Móveis, Eletro).'}</span>
          </div>
          <div class="field col-12">
            <label for="ct-kind">Tipo de modelo 3D</label>
            <select class="select" id="ct-kind" name="model_kind" data-search="true" data-search-placeholder="Buscar tipo…" data-sheet-title="Tipo de modelo 3D">${kindOptions(item?.model_kind || '', '')}</select>
            <span class="hint" data-kind-hint>Vale para todos os produtos desta categoria, a menos que o produto escolha outro tipo.</span>
          </div>
          <div class="field col-12">
            <label for="ct-desc">Descrição <span class="opt-tag">opcional</span></label>
            <textarea class="textarea" id="ct-desc" name="description" maxlength="400" rows="2" style="min-height:64px" placeholder="Uma frase sobre o que entra nesta categoria">${item?.description || ''}</textarea>
          </div>
          <div class="field col-5">
            <span class="label" id="ct-img-l">Imagem</span>
            <div class="ct-up" data-up role="group" aria-labelledby="ct-img-l"></div>
            <span class="hint">Quadrada, 800 × 800 px. Aparece na faixa de categorias.</span>
          </div>
          <div class="col-7 ct-sws">
            ${switchField({ label: 'Ativa', name: 'active', checked: item ? item.active : true, hint: 'Inativa, some do menu e da faixa. Os produtos continuam.' })}
            ${switchField({ label: 'Mostrar na faixa de categorias', name: 'show_in_strip', checked: item ? item.show_in_strip : true, hint: 'Círculos com foto na página inicial das lojas.' })}
          </div>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar categoria' : 'Salvar categoria'}</button>`,
        onMount(el, close) {
          const form = $('[data-form]', el);
          const clear = (e) => {
            if (!e.target.name) return;
            e.target.removeAttribute('aria-invalid');
            $$(`.error[data-for="${e.target.name}"]`, form).forEach((n) => n.remove());
          };
          form.addEventListener('input', clear);
          form.addEventListener('change', clear);
          const slugEl = form.elements.slug;
          const hint = $('[data-slug-hint]', el);
          const kindSel = form.elements.model_kind;
          const drawHint = () => {
            const s = slugEl.value || 'endereco';
            hint.textContent = isNew || s === item.slug ? `Link: ?categoria=${s}` : `Link: ?categoria=${s}. Links com o endereço antigo deixam de funcionar.`;
          };
          // "Automático (Sofá)": o que a loja deduz do nome/endereço digitado
          const drawKind = () => {
            if (!infer) return;
            let auto = '';
            try {
              const parent = rows.find((r) => r.id === form.elements.parent_id.value) || null;
              const k = infer.inferKind({ name: '' }, { category: { name: form.elements.name.value, slug: slugEl.value, model_kind: null }, parentCategory: parent }).kind;
              auto = k && k !== 'generic' ? infer.kindLabel(k) : '';
            } catch {
              auto = '';
            }
            const first = kindSel.querySelector('option[value=""]');
            const label = `Automático${auto ? ` (${auto})` : ' (pelo nome)'}`;
            if (first && first.textContent !== label) first.textContent = label;
            const v = kindSel.value;
            $('[data-kind-hint]', el).textContent =
              v === 'none'
                ? 'Os produtos desta categoria não mostram o botão “Ver em 3D” (a menos que o produto escolha um tipo).'
                : v
                  ? `Todos os produtos desta categoria usam ${infer.kindLabel(v)}, a menos que o produto escolha outro.`
                  : auto
                    ? `Detectado pelo nome: ${auto}. Escolha um tipo se o 3D não ficar fiel.`
                    : 'Vale para todos os produtos desta categoria, a menos que o produto escolha outro tipo.';
          };
          form.elements.name.addEventListener('input', () => {
            if (!slugTouched) {
              slugEl.value = slugify(form.elements.name.value).slice(0, 60).replace(/-+$/, '');
              slugEl.dispatchEvent(new Event('change', { bubbles: true })); // limpa o erro do campo
              drawHint();
            }
            drawKind();
          });
          slugEl.addEventListener('input', () => {
            slugTouched = true;
            drawHint();
            drawKind();
          });
          slugEl.addEventListener('blur', () => {
            slugEl.value = slugify(slugEl.value).slice(0, 60).replace(/-+$/, '');
            drawHint();
          });
          kindSel.addEventListener('change', drawKind);
          // "Automático (…)" aparece como valor escolhido, não como texto de exemplo
          customSelect(kindSel, {
            renderValue: (it) =>
              it && !it.value ? html`<span class="opt__icon opt__icon--auto ct-kindval" aria-hidden="true">${icon('sparkle', 'icon-xs')}</span><span class="sel__label">${it.label}</span>` : null,
            emptyText: (q) => `Nenhum tipo encontrado para “${q}”`,
          });
          form.elements.parent_id.addEventListener('change', drawKind);
          drawHint();
          drawKind();

          let image = orig;
          const box = $('[data-up]', el);
          // "remover" só tira da lista; o arquivo sai do storage depois de salvar
          box.addEventListener(
            'click',
            (e) => {
              const rm = e.target.closest('[data-remove]');
              if (!rm || !box.contains(rm)) return;
              e.preventDefault();
              e.stopPropagation();
              uploader.set([]);
              image = null;
            },
            true
          );
          const uploader = imageUploader(box, {
            value: orig ? [orig] : [],
            scope: { network: true },
            max: 1,
            folder: 'categories',
            label: 'Enviar imagem',
            onChange: (urls) => {
              const u = urls[0] || null;
              if (u && !u.startsWith('data:') && u !== orig) uploads.add(u);
              image = u && !u.startsWith('data:') ? u : null;
            },
          });

          const save = async (btn) => {
            if (uploader.value.some((u) => u.startsWith('data:'))) return toast('Aguarde o envio da imagem terminar.', 'warning');
            const d = readForm(form);
            const errors = {};
            if (!d.name || d.name.length < 2) errors.name = 'Informe o nome (mínimo 2 letras).';
            if (!d.slug) errors.slug = 'Informe o endereço.';
            else if (!SLUG_RE.test(d.slug)) errors.slug = 'Use letras minúsculas, números e hífens (ex.: mesas-de-centro).';
            if (d.sort_order === null || !Number.isInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 100000) errors.sort_order = 'Use um número inteiro de 0 em diante.';
            if (d.model_kind && !CATEGORY_KINDS.includes(d.model_kind)) errors.model_kind = 'Escolha um tipo da lista.';
            if (!showErrors(form, errors)) return;
            if (isNew || d.slug !== item.slug) {
              try {
                const dup = await q(sb.from('categories').select('id').eq('slug', d.slug).limit(1));
                if (dup.length) return showErrors(form, { slug: 'Já existe uma categoria com este endereço.' });
              } catch {
                /* o banco confere de novo ao salvar */
              }
            }
            const payload = {
              name: d.name,
              slug: d.slug,
              description: d.description,
              image_url: image,
              sort_order: d.sort_order,
              active: d.active,
              show_in_strip: d.show_in_strip,
              model_kind: d.model_kind || null,
            };
            if (!kids.length) payload.parent_id = d.parent_id || null;
            if (!isNew && d.slug !== item.slug) {
              try {
                const used = await linkUsage(item.slug);
                if (used) {
                  const ok = await confirmDialog({
                    title: 'Mudar o endereço?',
                    message: `${plural(used, 'banner ou aviso usa', 'banners ou avisos usam')} o link ?categoria=${item.slug}. Depois da troca, ${used === 1 ? 'ele deixa' : 'eles deixam'} de abrir esta categoria até você ${used === 1 ? 'atualizá-lo' : 'atualizá-los'} em Vitrine e banners.`,
                    confirmLabel: 'Mudar mesmo assim',
                    tone: 'warn',
                  });
                  if (!ok) return;
                }
              } catch {
                /* segue sem o aviso */
              }
            }
            try {
              await withBusy(btn, () => (isNew ? q(sb.from('categories').insert(payload)) : q(sb.from('categories').update(payload).eq('id', item.id))));
            } catch (err) {
              if (err.raw?.code === '23505') return showErrors(form, { slug: 'Já existe uma categoria com este endereço.' });
              if (err.raw?.code === '23514' && /model_kind/.test(err.raw?.message || '')) return showErrors(form, { model_kind: 'Este tipo ainda não pode ser usado em categorias.' });
              return toastError(err);
            }
            saved = true;
            final = image;
            toast(isNew ? `Categoria “${d.name}” criada` : `Categoria “${d.name}” salva`, 'success');
            close();
            load();
          };
          $('[data-save]', el).addEventListener('click', (e) => save(e.currentTarget));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            save($('[data-save]', el));
          });
        },
        onClose: () => {
          const keep = saved ? final : orig;
          uploads.forEach((u) => {
            if (u !== keep) removeImage(u).catch(() => {});
          });
          if (saved && orig && orig !== keep) releaseImages([orig]);
        },
      });
    }

    /* ----- Exclusão ----- */
    async function remove(c) {
      let total = c.total;
      let links = 0;
      try {
        [total, links] = await Promise.all([
          headCount(sb.from('products').select('id', { count: 'exact', head: true }).eq('category_id', c.id)),
          linkUsage(c.slug),
        ]);
      } catch {
        /* usa a contagem da lista */
      }
      const kids = rows.filter((k) => k.parent_id === c.id);
      const parts = [];
      parts.push(
        total
          ? `${plural(total, 'produto usa', 'produtos usam')} esta categoria e ${total === 1 ? 'ficará' : 'ficarão'} sem categoria (continua${total === 1 ? '' : 'm'} no catálogo das lojas).`
          : 'Nenhum produto usa esta categoria.'
      );
      if (kids.length) parts.push(`${kids.length === 1 ? 'A subcategoria passará' : `As ${num(kids.length)} subcategorias passarão`} a ser ${kids.length === 1 ? 'principal' : 'principais'}.`);
      if (links) parts.push(`${plural(links, 'banner ou aviso tem', 'banners ou avisos têm')} link para ela.`);
      parts.push('Não dá para desfazer.');
      const ok = await confirmDialog({ title: `Excluir a categoria “${c.name}”?`, message: parts.join(' '), confirmLabel: 'Excluir categoria', danger: true });
      if (!ok) return;
      try {
        await q(sb.from('categories').delete().eq('id', c.id));
        toast(`Categoria “${c.name}” excluída`, 'success');
        releaseImages([c.image_url]);
        load();
      } catch (err) {
        toastError(err);
      }
    }

    /* ----- Eventos ----- */
    const qIn = $('#ct-q', view);
    const onSearch = debounce(() => {
      term = fold(qIn.value.trim());
      draw();
    }, 200);
    qIn.addEventListener('input', onSearch);
    const onKey = (e) => {
      if (document.querySelector('.modal, .panel, .cmdk, .sheet')) return;
      if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        qIn.focus();
        qIn.select();
      }
    };
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return openEditor(null);
      if (e.target.closest('[data-clear]')) {
        filter = 'all';
        term = '';
        qIn.value = '';
        draw();
        qIn.focus();
        return;
      }
      const f = e.target.closest('[data-filter]');
      if (f) {
        filter = f.dataset.filter;
        draw();
        $(`[data-filter="${filter}"]`, view)?.focus();
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      const c = tr && rows.find((r) => r.id === tr.dataset.id);
      if (!c) return;
      if (e.target.closest('[data-edit]')) return openEditor(c);
      if (e.target.closest('[data-delete]')) return remove(c);
    });

    view.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-toggle]');
      if (!inp) return;
      const tr = inp.closest('tr[data-id]');
      const c = tr && rows.find((r) => r.id === tr.dataset.id);
      if (!c) return;
      const fieldName = inp.dataset.toggle;
      const value = inp.checked;
      const id = c.id;
      seq += 1; // descarta cargas em andamento, que trariam o valor antigo
      inp.disabled = true;
      try {
        await q(sb.from('categories').update({ [fieldName]: value }).eq('id', id));
        rows.forEach((r) => r.id === id && (r[fieldName] = value));
        toast(
          fieldName === 'active' ? (value ? `“${c.name}” ativada` : `“${c.name}” desativada`) : value ? `“${c.name}” na faixa de categorias` : `“${c.name}” fora da faixa de categorias`,
          'success',
          2200
        );
        if (!listEl.isConnected) return;
        draw();
        $(`tr[data-id="${id}"] [data-toggle="${fieldName}"]`, view)?.focus();
        load();
      } catch (err) {
        inp.checked = !value;
        inp.disabled = false;
        toastError(err);
        load();
      }
    });

    await load(true);
  },
};

const CSS = `
.ct { display: flex; flex-direction: column; gap: 12px; }
.ct-tb__search { max-width: 360px; }
.ct-tb__search .input { padding-right: 34px; }
.ct-sum { display: flex; flex-wrap: wrap; gap: 4px 18px; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--surface-2); font-size: 12.5px; color: var(--muted); }
.ct-sum b { color: var(--ink); font-weight: 600; }
.ct-foot { display: flex; gap: 6px; align-items: flex-start; max-width: 860px; line-height: 1.5; padding: 0 4px; }
.ct-foot .icon-xs { flex: none; margin-top: 3px; }
.ct-table td { vertical-align: middle; }
.ct-table tr.is-off td { background: var(--surface-2); }
.ct-table tr.is-off .thumb { opacity: 0.55; }
.ct-table tr.is-top + tr.is-top td, .ct-table tr.is-child + tr.is-top td { border-top: 1px solid var(--line-strong); }
.ct-cat { display: flex; align-items: center; gap: 12px; min-width: 280px; }
.ct-cat--child { padding-left: 26px; position: relative; }
.ct-branch { position: absolute; left: 8px; top: -12px; width: 12px; height: 32px; border-left: 1.5px solid var(--line-strong); border-bottom: 1.5px solid var(--line-strong); border-bottom-left-radius: 8px; }
.ct-cat .thumb { width: 44px; height: 44px; flex: none; }
.ct-cat__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ct-name { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.ct-name__btn { padding: 0; border: 0; background: none; font: 600 13.5px/1.35 var(--font-ui); color: var(--ink); cursor: pointer; text-align: left; }
.ct-name__btn:hover { color: var(--accent-ink); text-decoration: underline; }
.ct-name__btn mark { background: color-mix(in srgb, var(--highlight) 26%, transparent); color: inherit; border-radius: 3px; }
.ct-tag { height: 20px; padding: 0 7px; font-size: 11.5px; }
.ct-slug { font-size: 12px; white-space: nowrap; }
.ct-desc { max-width: 420px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.ct-noimg { display: inline-grid; place-items: center; color: var(--faint); border: 1px dashed var(--line-strong); background: var(--surface-2); flex: none; }
.ct-c-n strong, .ct-c-here strong { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.ct-sub { display: block; white-space: nowrap; font-size: 12px; color: var(--muted); }
.ct-kind { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); white-space: nowrap; }
.ct-kind__ico { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: var(--surface-3); color: var(--text); flex: none; }
.ct-kind__ico--auto { background: linear-gradient(135deg, #fde3cc, #fbd2c9); color: #a8151f; }
.ct-kind.is-none .ct-kind__ico { color: var(--muted); }
.ct-ord { display: inline-block; min-width: 28px; padding: 3px 7px; border-radius: 7px; background: var(--surface-3); font-size: 12px; font-weight: 600; color: var(--text); text-align: center; font-variant-numeric: tabular-nums; }
.ct-danger { color: var(--bad-fg); }
.ct-danger:hover { background: var(--bad-bg); color: var(--bad-fg); }
.ct-up .uploader { grid-template-columns: minmax(0, 168px); }
.ct-sws { display: flex; flex-direction: column; gap: 16px; padding-top: 26px; }
.ct-sws .switch { display: flex; width: 100%; }
.ct-sws .switch__txt { flex: 1; min-width: 0; }
.ct-kindval { width: 22px; height: 22px; border-radius: 7px; display: inline-grid; place-items: center; flex: none; }
@media (max-width: 1100px) { .ct-c-ord { display: none; } }
@media (max-width: 767px) {
  .ct-tb__search { max-width: none; min-width: 0; flex-basis: 100%; }
  .ct-tb__kbd { display: none; }
  .ct-tb .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -14px; padding: 0 14px; }
  .ct-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); }
  .ct-table, .ct-table tbody { display: block; width: 100%; }
  .ct-table tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .ct-table tr.is-top + tr.is-top, .ct-table tr.is-child + tr.is-top { border-top: 1px solid var(--line-strong); }
  .ct-table tr.is-top + tr.is-top td, .ct-table tr.is-child + tr.is-top td { border-top: 0; }
  .ct-table td { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: auto !important; padding: 0 !important; border: 0 !important; text-align: left; }
  .ct-table td[data-label]::before { content: attr(data-label); font-size: 12.5px; color: var(--muted); font-weight: 500; }
  .ct-table td.ct-c-cat { grid-column: 1; grid-row: 1; }
  .ct-table td.ct-c-n, .ct-table td.ct-c-here, .ct-table td.ct-c-kind { grid-column: 1 / -1; }
  .ct-table td.ct-c-n strong { margin-left: auto; }
  .ct-table td.ct-c-n .ct-sub { display: inline; margin-left: 6px; }
  .ct-table td.ct-c-ord { display: none; }
  .ct-table td.ct-c-sw { justify-content: flex-start; }
  .ct-table td.ct-c-act { grid-column: 2; grid-row: 1; align-self: start; justify-content: flex-end; gap: 0; }
  .ct-cat { min-width: 0; }
  .ct-cat--child { padding-left: 18px; }
  .ct-branch { left: 2px; }
  .ct-sws { padding-top: 0; }
}
`;
