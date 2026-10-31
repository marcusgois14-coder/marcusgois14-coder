// Escolha da loja e do endereço de entrega (CEP ou localização do aparelho).
// Cada loja tem catálogo próprio e só entrega dentro do seu raio (padrão 30 km).
import { $, $$, esc, icon, digits, km, fmtCep, geocode, geocodeInBrowser, currentPosition, bizMessage, storage } from './lib.js';
import { S, setLocation, storesForLocation, deliveryStatus, emit } from './state.js';
import { openSheet, closeSheet } from './layers.js';

let busy = false;
let status = '';
let draft = null; // CEP/número digitados que ainda não viraram localização

// CEP (+ número) → localização completa. Usa o servidor e, sem coordenadas, o navegador.
export async function resolveCep(cep, number = '', extra = {}) {
  const d = digits(cep);
  if (d.length !== 8) throw Object.assign(new Error('CEP inválido'), { code: 'CEP inválido' });
  let r;
  try {
    r = await geocode({ cep: d, number, ...extra });
  } catch (e) {
    if (e.code === 'CEP não encontrado' || e.code === 'CEP inválido') throw e;
    r = null;
  }
  const address = r?.address || { cep: d, street: extra.street || '', district: extra.district || '', city: extra.city || '', state: extra.state || '' };
  let coords = r && Number.isFinite(r.lat) ? { lat: r.lat, lng: r.lng, precision: r.precision } : null;
  if (!coords && address.city) coords = await geocodeInBrowser({ street: address.street, number, city: address.city, state: address.state });
  if (!coords) throw Object.assign(new Error('INVALID_LOCATION'), { code: 'INVALID_LOCATION' });
  return { ...address, number: number || address.number || '', ...coords };
}

export async function resolveGps() {
  const pos = await currentPosition();
  return { ...pos, cep: '', street: '', number: '', district: '', city: '', state: '' };
}

const locLabel = (loc) => {
  if (!loc) return '';
  if (loc.precision === 'gps' && !loc.city) return 'sua localização atual';
  return [loc.street && `${loc.street}${loc.number ? `, ${loc.number}` : ''}`, loc.city && `${loc.city}${loc.state ? ` - ${loc.state}` : ''}`, loc.cep && fmtCep(loc.cep)]
    .filter(Boolean)
    .join(' · ');
};

function storeOption(s, { current, distance }) {
  const radius = Number(s.delivery_radius_km);
  const within = distance !== null && distance !== undefined ? distance <= radius : null;
  const addr = [s.street && `${s.street}${s.number ? `, ${s.number}` : ''}`, s.district, `${s.city} - ${s.state}`].filter(Boolean).join(' · ');
  const tag =
    within === null
      ? ''
      : within
        ? `<span class="store-opt__tag">Entrega · ${km(distance)}</span>`
        : `<span class="store-opt__tag is-out">${km(distance)} · fora da área</span>`;
  return `<button class="store-opt${current ? ' is-current' : ''}${within === false ? ' is-out' : ''}" type="button" data-pick="${esc(s.slug)}" ${current ? 'aria-current="true"' : ''}>
    ${icon('i-store')}
    <span class="store-opt__info"><strong>${esc(s.name)}</strong>${esc(addr)}${!s.accepts_orders ? '<br><em>Pedidos pelo site pausados</em>' : ''}</span>
    ${tag}
  </button>`;
}

function render() {
  const el = $('#picker-sheet');
  const loc = S.loc;
  const list = loc ? storesForLocation(loc) : [...S.stores];
  const near = loc ? list.filter((s) => s.distance <= Number(s.delivery_radius_km)) : [];
  const far = loc ? list.filter((s) => s.distance > Number(s.delivery_radius_km)) : list;
  const cur = S.store?.slug;
  const cepVal = draft ? draft.cep : fmtCep(loc?.cep || '');
  const numVal = draft ? draft.number : loc?.number || '';
  el.innerHTML = `
    <div class="sheet__head">
      <h2 class="sheet__title">Escolha sua loja</h2>
      <button class="sheet__close" type="button" aria-label="Fechar" data-sheet-close>${icon('i-close')}</button>
    </div>
    <div class="sheet__body">
      <p class="picker__intro">Cada loja da rede tem o seu catálogo e entrega em até ${esc(S.net?.default_radius_km || 30)} km. Informe onde você vai receber para ver as lojas que atendem o seu endereço.</p>
      <form class="picker__actions" data-picker-form novalidate>
        <div class="f-grid">
          <div class="f-field s4 m3"><label class="f-label" for="pk-cep">CEP</label>
            <input class="f-input" id="pk-cep" name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" value="${esc(cepVal)}" required></div>
          <div class="f-field s2 m3"><label class="f-label" for="pk-num">Número</label>
            <input class="f-input" id="pk-num" name="number" inputmode="numeric" placeholder="Opcional" value="${esc(numVal)}"></div>
        </div>
        <button class="btn btn--primary btn--block" type="submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Buscando…' : 'Ver lojas que entregam'}</button>
        <div class="picker__or">ou</div>
        <button class="btn btn--outline btn--block" type="button" data-gps ${busy ? 'disabled' : ''}>${icon('i-locate')} Usar minha localização atual</button>
      </form>
      <div role="status" aria-live="polite">${status}</div>
      ${loc ? `<p class="picker__where">${icon('i-pin', 'inline-ico')} Entregar em <strong>${esc(locLabel(loc))}</strong> · <button type="button" class="link" data-clear-loc>trocar</button></p>` : ''}
      ${loc ? `<h3 class="picker__section">${near.length ? 'Lojas que entregam no seu endereço' : 'Nenhuma loja entrega neste endereço'}</h3>` : ''}
      ${loc && near.length ? `<div class="store-list">${near.map((s) => storeOption(s, { current: s.slug === cur, distance: s.distance })).join('')}</div>` : ''}
      ${loc && !near.length ? '<p class="notice notice--warn">Este endereço está fora da área de entrega de todas as lojas. Você ainda pode navegar pelos catálogos ou falar com uma loja pelo WhatsApp.</p>' : ''}
      <h3 class="picker__section">${loc ? 'Outras lojas da rede' : 'Todas as lojas'}</h3>
      <div class="store-list">${far.map((s) => storeOption(s, { current: s.slug === cur, distance: loc ? s.distance : null })).join('')}</div>
    </div>`;
}

export function openPicker(message = '') {
  status = message ? `<p class="notice notice--warn">${esc(message)}</p>` : '';
  render();
  openSheet('picker-sheet');
}

export function initPicker() {
  const el = $('#picker-sheet');
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-picker]')) {
      e.preventDefault();
      openPicker();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.name === 'cep') {
      const d = digits(e.target.value).slice(0, 8);
      e.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const cep = digits(form.cep.value);
    draft = { cep: form.cep.value, number: form.number.value };
    if (cep.length !== 8) {
      form.cep.setAttribute('aria-invalid', 'true');
      status = '<p class="notice notice--error">Informe um CEP com 8 números.</p>';
      render();
      $('#pk-cep', el)?.focus();
      return;
    }
    busy = true;
    status = '';
    render();
    try {
      const loc = await resolveCep(cep, form.number.value.trim());
      setLocation(loc);
      draft = null;
      status = loc.precision === 'city' ? '<p class="notice notice--warn">Localizamos apenas a cidade deste CEP. A distância é aproximada.</p>' : '';
    } catch (err) {
      status = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
    } finally {
      busy = false;
      render();
      if (draft) $('#pk-cep', el)?.focus({ preventScroll: true });
      else $('.store-list .store-opt', el)?.focus({ preventScroll: true });
    }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-gps]')) {
      busy = true;
      status = '';
      render();
      try {
        setLocation(await resolveGps());
        draft = null;
      } catch (err) {
        status = `<p class="notice notice--error">${esc(bizMessage(err))}</p>`;
      } finally {
        busy = false;
        render();
      }
      return;
    }
    if (e.target.closest('[data-clear-loc]')) {
      draft = null;
      setLocation(null);
      status = '';
      render();
      $('#pk-cep', el)?.focus();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      storage.set('atual:picked', true);
      closeSheet(false);
      emit('store-select', pick.dataset.pick);
    }
  });
}

// Atualiza rótulos da loja no cabeçalho e o aviso de endereço fora da área.
export function updateStoreUI() {
  const st = S.store;
  const label = st ? st.name.replace(/^Atual Móveis - /, '') : 'Escolha sua loja';
  $$('[data-store-label]').forEach((n) => (n.textContent = label));
  $$('[data-store-label-short]').forEach((n) => (n.textContent = st ? st.city : 'Loja'));
  const ds = deliveryStatus();
  const out = ds.known && !ds.within;
  $$('.store-pill, .mstore').forEach((b) => b.classList.toggle('is-alert', out));
  const warn = $('[data-range-warning]');
  const dismissed = sessionStorage.getItem?.('atual:range-dismissed') === `${st?.slug}|${S.loc?.at}`;
  if (out && !dismissed) {
    const better = storesForLocation().find((s) => s.distance <= Number(s.delivery_radius_km));
    warn.innerHTML = `<span>${icon('i-pin')}</span><span>Seu endereço fica a <strong>${km(ds.distance)}</strong> da ${esc(st.name)}, que entrega até ${km(ds.radius)}.${
      better ? ` A <strong>${esc(better.name)}</strong> atende você.` : ''
    }</span>
      <button type="button" data-open-picker>${better ? 'Trocar de loja' : 'Ver lojas'}</button>
      <button type="button" class="x" aria-label="Fechar aviso" data-dismiss-range>${icon('i-close')}</button>`;
    warn.hidden = false;
    warn.querySelector('[data-dismiss-range]').addEventListener('click', () => {
      try {
        sessionStorage.setItem('atual:range-dismissed', `${st?.slug}|${S.loc?.at}`);
      } catch {
        /* sem armazenamento */
      }
      warn.hidden = true;
    });
  } else warn.hidden = true;
}
