// Categorias da rede: uma taxonomia única para todas as lojas (só administradores da rede).
//
// Lista em árvore (principais e subcategorias), contagem de produtos na rede (e na loja escolhida),
// atalhos para ativar e para mostrar na faixa de categorias, editor e exclusão.
// Excluir uma categoria não apaga produtos: eles ficam sem categoria (category_id nulo) e as
// subcategorias viram principais (on delete set null).
// Imagens: ui.imageUploader (network/categories). O arquivo antigo só sai do storage depois de salvar
// e se nenhuma outra categoria usar a mesma URL.
import { sb, q, mediaUrl, removeImage } from '../api.js';
import {
  html, render, $, $$, icon, toast, toastError, badge, num, slugify, openModal, confirmDialog, readForm, showErrors,
  withBusy, switchField, selectOptions, loading, empty, imageUploader, injectStyle, debounce,
} from '../ui.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STORAGE_MARK = '/storage/v1/object/public/media/';
const FILTERS = [
  ['all', 'Todas'],
  ['active', 'Ativas'],
  ['inactive', 'Inativas'],
  ['empty', 'Sem produtos'],
];

const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isStored = (u) => typeof u === 'string' && u.includes(STORAGE_MARK);
const countOf = (embed) => (Array.isArray(embed) ? embed[0]?.count ?? 0 : 0);

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
      render(view, html`<div class="alert alert--warning">${icon('alert')}<div>As categorias valem para toda a rede e são definidas pela administração da rede.</div></div>`);
      return;
    }
    const storeId = ctx.storeId;
    let rows = [];
    let filter = 'all';
    let term = '';

    ctx.setActions(html`<button class="btn btn--primary" type="button" data-cat-new aria-label="Nova categoria">${icon('plus')}<span class="ct-hide-sm">Nova categoria</span></button>`);
    $('[data-cat-new]')?.addEventListener('click', () => openEditor(null));

    render(
      view,
      html`<div class="ct">
        <div class="toolbar">
          <div class="search">${icon('search')}
            <label class="visually-hidden" for="ct-q">Buscar categoria</label>
            <input class="input" id="ct-q" type="search" placeholder="Buscar por nome ou endereço" autocomplete="off">
          </div>
          <div class="chips" role="group" aria-label="Filtrar categorias" data-filters></div>
        </div>
        <p class="small muted mb-3" data-summary></p>
        <div data-list>${loading()}</div>
      </div>`
    );
    const listEl = $('[data-list]', view);

    /* ----- Dados ----- */
    const load = async (spinner = false) => {
      if (spinner) render(listEl, loading());
      try {
        let qb = sb
          .from('categories')
          .select(`*, total:products(count), live:products(count)${storeId ? ', here:products(count)' : ''}`)
          .eq('live.status', 'active')
          .order('sort_order')
          .order('name');
        if (storeId) qb = qb.eq('here.store_id', storeId);
        const data = await q(qb);
        rows = data.map((c) => ({ ...c, total: countOf(c.total), live: countOf(c.live), here: storeId ? countOf(c.here) : null }));
        draw();
      } catch (e) {
        if (spinner || !rows.length) {
          render(
            listEl,
            html`<div class="alert alert--danger">${icon('alert')}<div class="grow"><strong>Não foi possível carregar as categorias.</strong><br>${e.message}
              <div class="mt-2"><button class="btn btn--sm" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div></div></div>`
          );
        } else toastError(e);
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
      if (term && !norm(`${c.name} ${c.slug}`).includes(term)) return false;
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

    const rowHTML = (c, { child = false, kidsTotal = 0, kidsCount = 0 } = {}) => html`<tr class="${c.active ? '' : 'is-off'}" data-id="${c.id}">
      <td>
        <div class="ct-cat ${child ? 'ct-cat--child' : ''}">
          ${child ? html`<span class="ct-branch" aria-hidden="true">↳</span>` : ''}
          ${c.image_url ? html`<img class="thumb" src="${mediaUrl(c.image_url)}" alt="" loading="lazy">` : html`<span class="thumb ct-noimg" aria-hidden="true">${icon('image', 'icon-sm')}</span>`}
          <div class="ct-cat__txt">
            <span class="ct-name">${c.name}${!child && kidsCount ? html` <span class="badge badge--plain">${plural(kidsCount, 'subcategoria', 'subcategorias')}</span>` : ''}${c.active ? '' : html` ${badge('Inativa')}`}</span>
            <span class="mono muted">?categoria=${c.slug}</span>
            ${c.description ? html`<span class="small muted ct-desc">${c.description}</span>` : ''}
          </div>
        </div>
      </td>
      <td class="num">
        <strong>${num(c.total)}</strong>
        <span class="small muted ct-sub">${c.total ? `${num(c.live)} ativo${c.live === 1 ? '' : 's'}` : 'nenhum'}</span>
        ${!child && kidsCount ? html`<span class="small muted ct-sub">+ ${num(kidsTotal)} nas subcategorias</span>` : ''}
      </td>
      ${storeId ? html`<td class="num">${num(c.here)}</td>` : ''}
      <td class="num">${num(c.sort_order)}</td>
      <td>
        <label class="switch ct-switch"><input type="checkbox" data-toggle="active" ${c.active ? 'checked' : ''} aria-label="Ativa: ${c.name}"><span class="switch__track"></span></label>
      </td>
      <td>
        <label class="switch ct-switch"><input type="checkbox" data-toggle="show_in_strip" ${c.show_in_strip ? 'checked' : ''} aria-label="Na faixa de categorias: ${c.name}"><span class="switch__track"></span></label>
      </td>
      <td class="right nowrap">
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-edit aria-label="Editar “${c.name}”" title="Editar">${icon('edit', 'icon-sm')}</button>
        <button class="btn btn--ghost btn--sm btn--icon ct-danger" type="button" data-delete aria-label="Excluir “${c.name}”" title="Excluir">${icon('trash', 'icon-sm')}</button>
      </td>
    </tr>`;

    const draw = () => {
      drawFilters();
      const t = tree();
      const tops = t.length;
      const subs = rows.length - tops;
      const totalProducts = rows.reduce((s, c) => s + c.total, 0);
      $('[data-summary]', view).textContent = rows.length
        ? `${plural(rows.length, 'categoria', 'categorias')} · ${plural(tops, 'principal', 'principais')} e ${plural(subs, 'subcategoria', 'subcategorias')} · ${plural(totalProducts, 'produto classificado', 'produtos classificados')} na rede${storeId ? ` · coluna “Nesta loja”: ${ctx.store?.name || ctx.storeName(storeId)}` : ''}.`
        : '';
      const body = [];
      t.forEach(({ c, children }) => {
        const shownKids = children.filter(matches);
        if (!matches(c) && !shownKids.length) return;
        body.push(rowHTML(c, { kidsCount: children.length, kidsTotal: children.reduce((s, k) => s + k.total, 0) }));
        shownKids.forEach((k) => body.push(rowHTML(k, { child: true })));
      });
      if (!rows.length) {
        render(listEl, html`<div class="card">${empty('Nenhuma categoria', 'Crie a primeira categoria da rede.', html`<button class="btn btn--primary btn--sm" type="button" data-new>${icon('plus', 'icon-sm')} Nova categoria</button>`)}</div>`);
        return;
      }
      if (!body.length) {
        render(listEl, html`<div class="card">${empty('Nada encontrado', 'Ajuste a busca ou o filtro.')}</div>`);
        return;
      }
      render(
        listEl,
        html`<div class="table-wrap"><table class="table ct-table">
          <thead><tr>
            <th>Categoria</th>
            <th class="num">Produtos na rede</th>
            ${storeId ? html`<th class="num">Nesta loja</th>` : ''}
            <th class="num">Ordem</th>
            <th>Ativa</th>
            <th>Na faixa</th>
            <th class="right"><span class="visually-hidden">Ações</span></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table></div>
        <p class="small muted mt-2">“Na faixa”: aparece na faixa de categorias com foto da página inicial. Categorias inativas somem do menu e da faixa; os produtos continuam no catálogo.</p>`
      );
    };

    /* ----- Editor ----- */
    function openEditor(item) {
      const isNew = !item;
      const kids = item ? rows.filter((c) => c.parent_id === item.id) : [];
      const parents = rows.filter((c) => !c.parent_id && c.id !== item?.id);
      const orig = item?.image_url || null;
      const uploads = new Set();
      let saved = false;
      let final = null;
      let slugTouched = !isNew;
      const order = isNew ? rows.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1 : item.sort_order;
      openModal({
        title: isNew ? 'Nova categoria' : 'Editar categoria',
        body: html`<form class="form-grid" data-form novalidate>
          <div class="field col-8">
            <label for="ct-name">Nome *</label>
            <input class="input" id="ct-name" name="name" maxlength="60" required value="${item?.name || ''}" placeholder="Ex.: Sofás" autofocus>
          </div>
          <div class="field col-4">
            <label for="ct-order">Ordem</label>
            <input class="input" id="ct-order" name="sort_order" type="number" inputmode="numeric" min="0" step="1" data-type="int" value="${order}">
            <span class="hint">Menor aparece primeiro.</span>
          </div>
          <div class="field col-6">
            <label for="ct-slug">Endereço (slug) *</label>
            <input class="input mono" id="ct-slug" name="slug" maxlength="60" required value="${item?.slug || ''}" autocomplete="off" spellcheck="false" placeholder="sofas">
            <span class="hint" data-slug-hint></span>
          </div>
          <div class="field col-6">
            <label for="ct-parent">Categoria pai</label>
            <select class="select" id="ct-parent" name="parent_id" ${kids.length ? 'disabled' : ''}>
              ${selectOptions([['', 'Nenhuma (categoria principal)'], ...parents.map((p) => [p.id, p.name])], item?.parent_id || '')}
            </select>
            <span class="hint">${kids.length ? `Tem ${plural(kids.length, 'subcategoria', 'subcategorias')}, então continua como principal.` : 'Principais viram grupos do menu (ex.: Móveis, Eletro).'}</span>
          </div>
          <div class="field col-12">
            <label for="ct-desc">Descrição</label>
            <textarea class="textarea" id="ct-desc" name="description" maxlength="400" rows="2" style="min-height:64px" placeholder="Opcional">${item?.description || ''}</textarea>
          </div>
          <div class="field col-12">
            <span class="label" id="ct-img-l">Imagem</span>
            <div class="ct-up" data-up role="group" aria-labelledby="ct-img-l"></div>
            <span class="hint">Quadrada, 800 × 800 px. Aparece na faixa de categorias.</span>
          </div>
          <div class="col-6">${switchField({ label: 'Ativa', name: 'active', checked: item ? item.active : true, hint: 'Inativa, some do menu e da faixa.' })}</div>
          <div class="col-6">${switchField({ label: 'Mostrar na faixa de categorias', name: 'show_in_strip', checked: item ? item.show_in_strip : true, hint: 'Círculos com foto na página inicial.' })}</div>
        </form>`,
        actions: html`<button class="btn" type="button" data-close>Cancelar</button>
          <button class="btn btn--primary" type="button" data-save>${isNew ? 'Criar categoria' : 'Salvar'}</button>`,
        onMount(el, close) {
          const form = $('[data-form]', el);
          const slugEl = form.elements.slug;
          const hint = $('[data-slug-hint]', el);
          const drawHint = () => {
            const s = slugEl.value || 'endereco';
            hint.textContent = isNew || s === item.slug ? `Link: ?categoria=${s}` : `Link: ?categoria=${s}. Links com o endereço antigo deixam de funcionar.`;
          };
          form.elements.name.addEventListener('input', () => {
            if (slugTouched) return;
            slugEl.value = slugify(form.elements.name.value).slice(0, 60).replace(/-+$/, '');
            drawHint();
          });
          slugEl.addEventListener('input', () => {
            slugTouched = true;
            drawHint();
          });
          slugEl.addEventListener('blur', () => {
            slugEl.value = slugify(slugEl.value).slice(0, 60).replace(/-+$/, '');
            drawHint();
          });
          drawHint();

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
            if (!showErrors(form, errors)) return;
            const payload = {
              name: d.name,
              slug: d.slug,
              description: d.description,
              image_url: image,
              sort_order: d.sort_order,
              active: d.active,
              show_in_strip: d.show_in_strip,
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
              return toastError(err);
            }
            saved = true;
            final = image;
            toast(isNew ? 'Categoria criada.' : 'Categoria salva.', 'success');
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
      const parts = [`Excluir a categoria “${c.name}”?`];
      parts.push(
        total
          ? `${plural(total, 'produto usa', 'produtos usam')} esta categoria e ${total === 1 ? 'ficará' : 'ficarão'} sem categoria (continua${total === 1 ? '' : 'm'} no catálogo das lojas).`
          : 'Nenhum produto usa esta categoria.'
      );
      if (kids.length) parts.push(`${kids.length === 1 ? 'A subcategoria passará' : `As ${num(kids.length)} subcategorias passarão`} a ser ${kids.length === 1 ? 'principal' : 'principais'}.`);
      if (links) parts.push(`${plural(links, 'banner ou aviso tem', 'banners ou avisos têm')} link para ela.`);
      parts.push('Esta ação não pode ser desfeita.');
      const ok = await confirmDialog({ title: 'Excluir categoria', message: parts.join(' '), confirmLabel: 'Excluir categoria', danger: true });
      if (!ok) return;
      try {
        await q(sb.from('categories').delete().eq('id', c.id));
        toast('Categoria excluída.', 'success');
        releaseImages([c.image_url]);
        load();
      } catch (err) {
        toastError(err);
      }
    }

    /* ----- Eventos ----- */
    const onSearch = debounce(() => {
      term = norm($('#ct-q', view).value.trim());
      draw();
    }, 200);
    $('#ct-q', view).addEventListener('input', onSearch);

    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return load(true);
      if (e.target.closest('[data-new]')) return openEditor(null);
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
      inp.disabled = true;
      try {
        await q(sb.from('categories').update({ [fieldName]: value }).eq('id', c.id));
        c[fieldName] = value;
        toast(
          fieldName === 'active' ? (value ? `“${c.name}” ativada.` : `“${c.name}” desativada.`) : value ? `“${c.name}” na faixa de categorias.` : `“${c.name}” fora da faixa de categorias.`,
          'success',
          2200
        );
        draw();
        $(`tr[data-id="${c.id}"] [data-toggle="${fieldName}"]`, view)?.focus();
      } catch (err) {
        inp.checked = !value;
        inp.disabled = false;
        toastError(err);
      }
    });

    await load(true);
  },
};

const CSS = `
.ct .toolbar .search { max-width: 360px; }
.ct-table td { vertical-align: middle; }
.ct-table tr.is-off td { background: var(--surface-2); }
.ct-table tr.is-off .thumb { opacity: 0.55; }
.ct-cat { display: flex; align-items: center; gap: 12px; min-width: 260px; }
.ct-cat--child { padding-left: 22px; }
.ct-branch { color: var(--faint); font-size: 16px; margin-right: -4px; }
.ct-cat__txt { display: flex; flex-direction: column; min-width: 0; }
.ct-name { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-weight: 700; color: var(--ink); }
.ct-desc { max-width: 420px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.ct-noimg { display: inline-flex; align-items: center; justify-content: center; color: var(--faint); border: 1px dashed var(--line-strong); background: #fff; flex: none; }
.ct-sub { display: block; white-space: nowrap; }
.ct-switch .switch__track { width: 34px; height: 20px; }
.ct-switch .switch__track::after { width: 14px; height: 14px; }
.ct-danger { color: var(--danger); }
.ct-up .uploader { grid-template-columns: minmax(0, 160px); }
@media (max-width: 560px) {
  .ct-hide-sm { display: none; }
  .ct .toolbar .search { max-width: none; min-width: 0; flex-basis: 100%; }
}
`;
