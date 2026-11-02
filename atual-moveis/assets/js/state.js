// Estado da loja virtual: loja escolhida, catálogo carregado, localização do cliente e regras de preço.
import { storage, haversine } from './lib.js';

export const S = {
  stores: [], // todas as lojas ativas (list_stores)
  sf: null, // payload de get_storefront
  net: {}, // configurações da rede
  store: null, // loja escolhida
  products: [],
  byId: {},
  bySlug: {},
  cats: [],
  catById: {},
  catBySlug: {},
  colls: [],
  cart: [], // [{ id, variant, qty }] — um carrinho por loja
  wish: [], // ids de produtos favoritos da loja
  loc: storage.get('atual:location', null), // { lat, lng, cep, street, number, district, city, state, precision }
};

const listeners = {};
export const on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
export const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

export function setStorefront(sf) {
  S.sf = sf;
  S.net = sf.network || {};
  S.store = sf.store;
  S.products = sf.products || [];
  S.byId = Object.fromEntries(S.products.map((p) => [p.id, p]));
  S.bySlug = Object.fromEntries(S.products.map((p) => [p.slug, p]));
  S.cats = sf.categories || [];
  S.catById = Object.fromEntries(S.cats.map((c) => [c.id, c]));
  S.catBySlug = Object.fromEntries(S.cats.map((c) => [c.slug, c]));
  S.colls = sf.collections || [];
  storage.set('atual:store', S.store.slug);
}

export function setLocation(loc) {
  S.loc = loc ? { ...loc, at: Date.now() } : null;
  if (S.loc) storage.set('atual:location', S.loc);
  else storage.remove('atual:location');
  emit('location', S.loc);
}

/* ---------- Preços ---------- */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const pixPct = () => Number(S.store?.pix_discount_pct || 0);
// Mesmo arredondamento do place_order: desconto = round(preço × %, 2)
export const pixPrice = (price) => round2(price - round2((price * pixPct()) / 100));
export const hasPix = () => (S.store?.payment_methods || []).includes('pix');
// Preço em destaque no card: PIX quando a loja aceita PIX.
export const displayPrice = (price) => (hasPix() ? pixPrice(price) : round2(price));

export function installments(total) {
  const max = Number(S.store?.max_installments || 1);
  const min = Number(S.store?.min_installment_value || 0);
  let n = max;
  while (n > 1 && total / n < min) n -= 1;
  return { n, value: round2(total / n) };
}

export const categoryName = (id) => S.catById[id]?.name || '';

/* ---------- Distância / raio ---------- */
export function distanceTo(store, loc = S.loc) {
  if (!loc || store?.lat == null || store?.lng == null) return null;
  return haversine(store.lat, store.lng, loc.lat, loc.lng);
}

export function storesForLocation(loc = S.loc) {
  return S.stores
    .filter((s) => s.lat != null)
    .map((s) => ({ ...s, distance: distanceTo(s, loc) }))
    .sort((a, b) => a.distance - b.distance);
}

export function deliveryStatus(loc = S.loc, store = S.store) {
  const d = distanceTo(store, loc);
  if (d === null) return { known: false };
  return { known: true, distance: d, within: d <= Number(store.delivery_radius_km), radius: Number(store.delivery_radius_km) };
}

// Taxa de entrega pelas faixas da loja (a confirmação oficial é do banco no fechamento).
export function feeFor(distance, subtotal, allFree) {
  const st = S.store;
  if (allFree) return 0;
  if (st.free_shipping_min != null && subtotal >= Number(st.free_shipping_min)) return 0;
  const tiers = [...(st.delivery_fee_tiers || [])].sort((a, b) => a.up_to_km - b.up_to_km);
  const t = tiers.find((x) => Number(x.up_to_km) >= distance) || tiers[tiers.length - 1];
  return round2(t ? t.fee : 0);
}

export const storeWhatsapp = () => S.store?.whatsapp || S.net?.support_whatsapp || '';
export const storeAddress = (s = S.store) =>
  [s?.street && `${s.street}${s.number ? `, ${s.number}` : ''}`, s?.district, s?.city && `${s.city} - ${s.state}`].filter(Boolean).join(' · ');
