// Auditoria: quem mudou o quê, quando e em qual loja.
// O audit_log é preenchido pelos gatilhos do banco (audit_row) e pela edge function admin-users (equipe).
// A RLS já filtra: a rede vê tudo; o administrador da loja vê só as linhas da própria loja.
// Desenho "Casa Atual": linha do tempo agrupada por dia (paginada no servidor), filtros com selects
// personalizados, período com calendário (dateRange) e uma gaveta com o comparativo antes/depois
// (diferença por palavra em textos, variação em números, itens que entraram/saíram em listas).
import { sb, q, mediaUrl } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  empty,
  errorBlock,
  skeleton,
  injectStyle,
  debounce,
  datetime,
  date,
  relTime,
  num,
  money,
  pct,
  badge,
  pager,
  drawer,
  dateRange,
  rangeLabel,
  isoDay,
  dayStart,
  dayEnd,
  phone,
  cep,
  fold,
  storeMark,
  initials,
  toCSV,
  downloadFile,
  withBusy,
  ROLES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PRODUCT_STATUS,
} from '../ui.js';

const PAGE = 25;

const AREAS = {
  products: 'Produto',
  product_variants: 'Variação',
  categories: 'Categoria',
  collections: 'Coleção',
  banners: 'Banner',
  announcements: 'Aviso',
  coupons: 'Cupom',
  orders: 'Pedido',
  customers: 'Cliente',
  stores: 'Loja',
  staff: 'Equipe',
  network_settings: 'Configurações da rede',
};
// substantivo com artigo, para a frase "Marcus alterou o pedido …"
const AREA_NOUN = {
  products: 'o produto',
  product_variants: 'a variação',
  categories: 'a categoria',
  collections: 'a coleção',
  banners: 'o banner',
  announcements: 'o aviso',
  coupons: 'o cupom',
  orders: 'o pedido',
  customers: 'o cliente',
  stores: 'a loja',
  staff: 'o acesso de',
  network_settings: 'as configurações da rede',
};
const AREA_ICON = {
  products: 'products',
  product_variants: 'layers',
  categories: 'categories',
  collections: 'showcase',
  banners: 'image',
  announcements: 'bell',
  coupons: 'coupons',
  orders: 'orders',
  customers: 'customers',
  stores: 'store',
  staff: 'team',
  network_settings: 'network',
};
const NETWORK_ONLY_AREAS = ['categories', 'network_settings'];
const ACTIONS = {
  insert: { label: 'Criou', verb: 'criou', tone: 'success', dot: 'ok', icon: 'plus', t: 'ok' },
  update: { label: 'Alterou', verb: 'alterou', tone: 'info', dot: 'info', icon: 'edit', t: 'info' },
  delete: { label: 'Excluiu', verb: 'excluiu', tone: 'danger', dot: 'bad', icon: 'trash', t: 'bad' },
};
const PERIODS = [
  ['today', 'Hoje'],
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
  ['90', 'Últimos 90 dias'],
  ['all', 'Todo o período'],
  ['custom', 'Personalizado…'],
];
const PERIOD_PHRASE = { today: 'hoje', 7: 'nos últimos 7 dias', 30: 'nos últimos 30 dias', 90: 'nos últimos 90 dias', all: '' };

// Nome legível de cada coluna (a ordem aqui também ordena a lista de valores)
const FIELDS = {
  name: 'Nome', title: 'Título', code: 'Código', full_name: 'Nome', email: 'E-mail', role: 'Papel', text: 'Texto',
  customer_name: 'Cliente', status: 'Status', active: 'Ativo', subtitle: 'Subtítulo', kicker: 'Chamada', slug: 'Endereço na loja',
  key: 'Chave', sku: 'SKU', brand: 'Marca', brand_name: 'Marca', category_id: 'Categoria', parent_id: 'Categoria mãe',
  price: 'Preço', compare_at_price: 'Preço “de”', cost_price: 'Custo', price_override: 'Preço próprio', stock_qty: 'Estoque',
  track_stock: 'Controla estoque', low_stock_threshold: 'Alerta de estoque baixo', short_description: 'Descrição curta',
  description: 'Descrição', image_url: 'Imagem', image2_url: 'Imagem 2', image_mobile_url: 'Imagem (celular)', color: 'Cor',
  is_new: 'Novidade', free_shipping: 'Frete grátis', fast_delivery: 'Pronta entrega', is_promo: 'Promoção',
  weight_kg: 'Peso (kg)', width_cm: 'Largura (cm)', height_cm: 'Altura (cm)', depth_cm: 'Profundidade (cm)', warranty: 'Garantia',
  specs: 'Especificações', tags: 'Tags', seo_title: 'Título SEO', seo_description: 'Descrição SEO', sold_count: 'Vendidos',
  layout: 'Layout', badge_all: 'Selo', show_on_home: 'Na página inicial', show_in_strip: 'Na faixa de categorias', kind: 'Tipo',
  link_url: 'Link', pin_product_ids: 'Produtos marcados', cta_label: 'Texto do botão', cta_url: 'Link do botão',
  type: 'Tipo', value: 'Valor', min_order: 'Pedido mínimo', max_discount: 'Desconto máximo', usage_limit: 'Limite de usos',
  used_count: 'Usos', per_phone_limit: 'Limite por telefone', starts_at: 'Início', ends_at: 'Fim', sort_order: 'Ordem',
  city: 'Cidade', state: 'UF', cep: 'CEP', street: 'Rua', number: 'Número', address_number: 'Número', district: 'Bairro',
  complement: 'Complemento', reference: 'Referência', lat: 'Latitude', lng: 'Longitude', delivery_radius_km: 'Raio de entrega',
  phone: 'Telefone', whatsapp: 'WhatsApp', hours: 'Horário', instagram: 'Instagram', facebook: 'Facebook',
  pix_key: 'Chave PIX', pix_key_type: 'Tipo da chave PIX', pix_holder: 'Titular do PIX', payment_methods: 'Formas de pagamento',
  pix_discount_pct: 'Desconto PIX', max_installments: 'Parcelas máximas', min_installment_value: 'Parcela mínima',
  free_shipping_min: 'Frete grátis a partir de', delivery_fee_tiers: 'Faixas de frete', min_order_value: 'Pedido mínimo',
  delivery_lead_time: 'Prazo de entrega', accepts_orders: 'Aceita pedidos', closed_message: 'Aviso de loja fechada',
  marquee: 'Faixa rolante', notify_email: 'E-mail de avisos', tagline: 'Tagline', slogan: 'Slogan', logo_url: 'Logo',
  logo_white_url: 'Logo branca', primary_color: 'Cor principal', accent_color: 'Cor de apoio',
  default_pix_discount: 'Desconto PIX padrão', default_installments: 'Parcelas padrão', default_radius_km: 'Raio máximo de entrega',
  support_whatsapp: 'WhatsApp de suporte', footer_legal: 'Texto legal do rodapé', benefits: 'Benefícios',
  popular_searches: 'Buscas populares', customer_phone: 'Telefone do cliente', customer_email: 'E-mail do cliente',
  customer_cpf: 'CPF do cliente', cpf: 'CPF', payment_method: 'Forma de pagamento', payment_status: 'Pagamento',
  installments: 'Parcelas', subtotal: 'Subtotal', discount_coupon: 'Desconto do cupom', discount_pix: 'Desconto PIX',
  delivery_fee: 'Frete', total: 'Total', coupon_code: 'Cupom', coupon_id: 'Cupom (id)', distance_km: 'Distância',
  customer_notes: 'Observações do cliente', internal_notes: 'Observações internas', scheduled_date: 'Entrega agendada',
  assigned_to: 'Responsável', source: 'Origem', restocked: 'Estoque devolvido', confirmed_at: 'Confirmado em',
  shipped_at: 'Saiu para entrega em', delivered_at: 'Entregue em', canceled_at: 'Cancelado em', cancel_reason: 'Motivo do cancelamento',
  last_order_at: 'Último pedido', customer_id: 'Cliente (id)', product_id: 'Produto (id)', user_id: 'Usuário (id)',
  store_id: 'Loja', senha: 'Senha', alt: 'Texto alternativo',
};
const FIELD_ORDER = Object.keys(FIELDS);
// Chaves que só poluem a leitura em criações/exclusões
const NOISY = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'tracking_token', 'store_id']);
const MONEY = new Set([
  'price', 'compare_at_price', 'cost_price', 'price_override', 'min_order', 'max_discount', 'min_installment_value', 'free_shipping_min',
  'min_order_value', 'subtotal', 'discount_coupon', 'discount_pix', 'delivery_fee', 'total', 'unit_price',
]);
const PERCENT = new Set(['pix_discount_pct', 'default_pix_discount']);
const KM = new Set(['delivery_radius_km', 'default_radius_km', 'distance_km']);
const COUPON_TYPE = { percent: 'Percentual', fixed: 'Valor fixo', free_shipping: 'Frete grátis' };
const BANNER_KIND = { hero: 'Destaque (hero)', mosaic: 'Mosaico', room: 'Ambiente' };
const PIX_TYPE = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Chave aleatória' };
const LABEL_COLS = {
  products: 'id, name, sku',
  product_variants: 'id, name',
  categories: 'id, name',
  collections: 'id, title',
  banners: 'id, title',
  announcements: 'id, text',
  coupons: 'id, code',
  orders: 'id, code, customer_name',
  customers: 'id, name',
  stores: 'id, name',
};

const fieldLabel = (k) => FIELDS[k] || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const isDiff = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('de' in v || 'para' in v) && Object.keys(v).every((k) => k === 'de' || k === 'para');
// pares de/para iguais (a edge function da equipe registra papel e situação mesmo sem mudança)
const sameValue = (v) => isDiff(v) && JSON.stringify(v.de ?? null) === JSON.stringify(v.para ?? null);
const changedKeys = (c) => {
  const keys = Object.keys(c || {});
  const real = keys.filter((k) => !sameValue(c[k]));
  return real.length ? real : keys;
};
const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
const cut = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const IMG_RE = /\.(jpe?g|png|webp|gif|svg)(\?.*)?$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const sortKeys = (keys) =>
  keys.sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

/* ---------- Datas da linha do tempo ---------- */
const DOW = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const hhmm = (v) => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function dayTitle(key) {
  const d = new Date(`${key}T12:00:00`);
  const today = isoDay(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const long = `${DOW[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` de ${d.getFullYear()}` : ''}`;
  if (key === today) return ['Hoje', long];
  if (key === isoDay(y)) return ['Ontem', long];
  return [long[0].toUpperCase() + long.slice(1), ''];
}

/* ---------- Diferença por palavra (textos) ---------- */
function wordDiff(a, b) {
  const A = String(a).split(/(\s+)/).filter((x) => x !== '');
  const B = String(b).split(/(\s+)/).filter((x) => x !== '');
  if (A.length * B.length > 60000) return null;
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const old = [];
  const neu = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      old.push([0, A[i]]);
      neu.push([0, B[j]]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) old.push([1, A[i++]]);
    else neu.push([1, B[j++]]);
  }
  while (i < n) old.push([1, A[i++]]);
  while (j < m) neu.push([1, B[j++]]);
  // junta pedaços seguidos do mesmo tipo
  const merge = (arr) => arr.reduce((acc, [t, s]) => (acc.length && acc[acc.length - 1][0] === t ? (acc[acc.length - 1][1] += s, acc) : (acc.push([t, s]), acc)), []);
  return { old: merge(old), neu: merge(neu) };
}

export default {
  title: 'Auditoria',
  async render(view, ctx) {
    injectStyle('audit', CSS);
    if (!ctx.can('settings')) {
      render(
        view,
        html`<div class="card">${empty('Esta área é do administrador da loja', 'Somente administradores podem ver a auditoria.', html`<a class="btn" href="#/dashboard">Voltar ao Painel</a>`, { art: 'no-access' })}</div>`
      );
      return;
    }
    const networkView = !ctx.storeId;
    const q0 = ctx.query || {};
    const state = { area: '', action: '', store: '', period: '30', from: '', to: '', email: '', page: 1, record: null };
    if (q0.area && AREAS[q0.area]) state.area = q0.area;
    if (q0.record && UUID_RE.test(q0.record) && q0.area) state.record = { table: q0.area, id: q0.record, label: '' };
    let total = 0;
    let rows = [];
    let token = 0;
    let drawerApi = null;
    const labels = new Map(); // `${tabela}:${id}` → nome legível
    const actors = new Map(); // actor_id → nome
    const categories = new Map();
    let catsLoaded = false;
    const goneStores = new Map(); // loja excluída → nome tirado do próprio histórico (ou null)

    const areas = Object.entries(AREAS).filter(([k]) => networkView || !NETWORK_ONLY_AREAS.includes(k));
    const knownStore = (id) => ctx.stores.find((s) => s.id === id);

    ctx.setActions(html`<button class="btn" type="button" data-export>${icon('download')}<span>Exportar CSV</span></button>`);

    render(
      view,
      html`<div class="au">
        <section class="card au-card" aria-label="Registro de alterações">
          <form class="toolbar au-tb" role="search" data-filters novalidate>
            <div class="search au-tb__search">
              ${icon('search', 'icon-sm')}
              <label class="visually-hidden" for="au-email">Buscar por e-mail de quem alterou</label>
              <input class="input" id="au-email" type="search" placeholder="Buscar por e-mail" autocomplete="off" enterkeyhint="search" data-email>
            </div>
            <div class="au-tb__f">
              <label class="visually-hidden" for="au-area">Área</label>
              <select class="select" id="au-area" data-f="area" data-prefix="Área" data-sheet-title="Área" data-search="false">
                <option value="" data-hint="Tudo o que foi alterado">Todas</option>
                ${areas.map(([k, v]) => html`<option value="${k}" data-icon="${AREA_ICON[k]}" ${state.area === k ? 'selected' : ''}>${v}</option>`)}
              </select>
            </div>
            <div class="au-tb__f">
              <label class="visually-hidden" for="au-action">Ação</label>
              <select class="select" id="au-action" data-f="action" data-prefix="Ação" data-sheet-title="Ação">
                <option value="">Todas</option>
                ${Object.entries(ACTIONS).map(([k, v]) => html`<option value="${k}" data-dot="${v.dot}">${v.label}</option>`)}
              </select>
            </div>
            ${networkView
              ? html`<div class="au-tb__f">
                  <label class="visually-hidden" for="au-store">Loja</label>
                  <select class="select" id="au-store" data-f="store" data-prefix="Loja" data-sheet-title="Loja" data-search-placeholder="Buscar loja ou cidade…">
                    <option value="" data-icon="layers" data-hint="Rede e todas as lojas">Todas</option>
                    <option value="network" data-mark="network" data-hint="Configurações, categorias e equipe da rede">Só a rede (sem loja)</option>
                    <optgroup label="Lojas" data-count="${ctx.stores.length}">${ctx.stores.map(
                      (s) => html`<option value="${s.id}" data-mark="${s.id}" data-hint="${[s.brand_name, s.city].filter(Boolean).join(' · ')}" data-keywords="${s.name}">${ctx.storeShort?.(s) || s.name}</option>`
                    )}</optgroup>
                  </select>
                </div>`
              : ''}
            <div class="au-tb__f">
              <label class="visually-hidden" for="au-period">Período</label>
              <select class="select" id="au-period" data-f="period" data-prefix="Período" data-sheet-title="Período">
                ${PERIODS.map(([k, v]) => html`<option value="${k}" data-icon="${k === 'custom' ? 'calendar' : ''}" ${k === state.period ? 'selected' : ''}>${v}</option>`)}
              </select>
            </div>
            <button class="btn au-range" type="button" data-range hidden>${icon('calendar', 'icon-sm')}<span data-range-label>Escolher período</span></button>
            <span class="au-rec-chip" data-record hidden></span>
            <button class="btn btn--ghost btn--sm" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
            <span class="toolbar__spacer"></span>
            <span class="au-tb__sum" data-sum aria-live="polite"></span>
          </form>
          <div class="au-results" data-list>${skeleton('list', { rows: 7 })}</div>
          <div class="au-foot" data-foot hidden></div>
        </section>
      </div>`
    );
    const listEl = $('[data-list]', view);
    const footEl = $('[data-foot]', view);

    /* ---------- Período ---------- */
    function range() {
      const today = isoDay(new Date());
      if (state.period === 'all') return [null, null];
      if (state.period === 'today') return [today, today];
      if (state.period === 'custom') return [state.from || null, state.to || null];
      const d = new Date();
      d.setDate(d.getDate() - (Number(state.period) - 1));
      return [isoDay(d), null];
    }
    const rangeBtn = $('[data-range]', view);
    const picker = dateRange(rangeBtn, {
      max: isoDay(new Date()),
      min: '2020-01-01',
      onApply: ({ from, to }) => {
        state.from = from;
        state.to = to;
        state.page = 1;
        paintRange();
        load();
      },
    });
    const paintRange = () => {
      rangeBtn.hidden = state.period !== 'custom';
      const lbl = $('[data-range-label]', rangeBtn);
      if (lbl) lbl.textContent = state.from && state.to ? rangeLabel(state.from, state.to) : 'Escolher período';
    };

    /* ---------- Consulta paginada ---------- */
    function applyFilters(qy) {
      if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
      else if (state.store === 'network') qy = qy.is('store_id', null);
      else if (state.store) qy = qy.eq('store_id', state.store);
      if (state.record) qy = qy.eq('table_name', state.record.table).eq('record_id', state.record.id);
      else if (state.area) qy = qy.eq('table_name', state.area);
      if (state.action) qy = qy.eq('action', state.action);
      const [from, to] = range();
      if (from) qy = qy.gte('created_at', dayStart(from));
      if (to) qy = qy.lt('created_at', dayEnd(to));
      const term = state.email.trim().replace(/[%*\\]/g, '').trim();
      if (term) qy = qy.ilike('actor_email', `%${term}%`);
      return qy;
    }
    const COLS = 'id, created_at, actor_id, actor_email, store_id, table_name, record_id, action, changes';
    async function load() {
      const my = ++token;
      listEl.classList.add('is-busy');
      if (!rows.length) render(listEl, skeleton('list', { rows: 7 }));
      try {
        const qy = applyFilters(
          sb
            .from('audit_log')
            .select(COLS, { count: 'exact' })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range((state.page - 1) * PAGE, state.page * PAGE - 1)
        );
        const res = await q(qy);
        if (my !== token) return;
        rows = res.data || [];
        total = res.count || 0;
        // página fora do intervalo (ex.: filtros mudaram)
        if (!rows.length && total && state.page > 1) {
          state.page = Math.max(1, Math.ceil(total / PAGE));
          return load();
        }
        await Promise.all([resolveLabels(rows), resolveStores(rows), resolveActors(rows)]);
        if (my !== token) return;
        draw();
      } catch (e) {
        if (my !== token) return;
        rows = [];
        footEl.hidden = true;
        render(listEl, errorBlock(e, { title: 'Não foi possível carregar a auditoria', retry: () => load() }));
      } finally {
        if (my === token) listEl.classList.remove('is-busy');
      }
    }

    /* ---------- Nome legível dos registros ---------- */
    function labelFromChanges(r) {
      const c = r.changes || {};
      const pick = (k) => {
        const v = c[k];
        if (v === undefined || v === null) return null;
        if (isDiff(v)) return v.para ?? v.de ?? null;
        return typeof v === 'object' ? null : v;
      };
      if (r.table_name === 'network_settings') return 'Configurações da rede';
      if (r.table_name === 'orders') {
        const code = pick('code');
        const who = pick('customer_name');
        if (code) return who ? `${code} · ${who}` : code;
      }
      if (r.table_name === 'staff') return pick('email');
      const v = pick('name') ?? pick('title') ?? pick('code') ?? pick('text');
      return v ? cut(v, 80) : null;
    }

    async function resolveLabels(list) {
      const need = {};
      const userHint = {}; // acesso excluído: o id da pessoa vem nas alterações
      for (const r of list) {
        if (r.table_name === 'staff' && r.changes?.user_id) userHint[r.record_id] = r.changes.user_id;
        if (!r.record_id) continue;
        const k = `${r.table_name}:${r.record_id}`;
        if (labels.has(k)) continue;
        const own = labelFromChanges(r);
        if (own && (r.action !== 'update' || r.table_name === 'network_settings')) {
          labels.set(k, own);
          continue;
        }
        (need[r.table_name] = need[r.table_name] || new Set()).add(r.record_id);
        if (own) labels.set(`~${k}`, own); // reserva, caso o registro já não exista
      }
      const jobs = Object.entries(need).map(async ([tbl, ids]) => {
        const idList = [...ids];
        try {
          if (tbl === 'staff') {
            // o id pode ser do acesso (staff) ou da pessoa (redefinição de senha)
            const staffRows = await q(sb.from('staff').select('id, user_id').in('id', idList.filter((x) => UUID_RE.test(x))));
            idList.forEach((id) => userHint[id] && !staffRows.some((s) => s.id === id) && staffRows.push({ id, user_id: userHint[id] }));
            const userIds = new Set([...staffRows.map((s) => s.user_id), ...idList]);
            const profs = await q(sb.from('profiles').select('user_id, email, full_name').in('user_id', [...userIds].filter((x) => UUID_RE.test(x))));
            const byUser = Object.fromEntries(profs.map((p) => [p.user_id, p.full_name ? `${p.full_name} · ${p.email}` : p.email]));
            staffRows.forEach((s) => byUser[s.user_id] && labels.set(`staff:${s.id}`, byUser[s.user_id]));
            idList.forEach((id) => byUser[id] && labels.set(`staff:${id}`, byUser[id]));
            profs.forEach((p) => p.full_name && !actors.has(p.user_id) && actors.set(p.user_id, p.full_name));
            return;
          }
          const cols = LABEL_COLS[tbl];
          if (!cols) return;
          const found = await q(sb.from(tbl).select(cols).in('id', idList));
          for (const f of found) {
            let l = f.name ?? f.title ?? f.code ?? f.text ?? '';
            if (tbl === 'orders' && f.customer_name) l = `${f.code} · ${f.customer_name}`;
            if (tbl === 'products' && f.sku) l = `${f.name} (${f.sku})`;
            labels.set(`${tbl}:${f.id}`, cut(l, 80));
          }
        } catch {
          /* sem permissão para ler a tabela: fica o id */
        }
      });
      await Promise.all(jobs);
    }
    const recordLabel = (r) => {
      const k = `${r.table_name}:${r.record_id}`;
      return labels.get(k) || labels.get(`~${k}`) || null;
    };

    // nome de quem alterou (a rede lê todos os perfis; a loja, só os da própria equipe)
    async function resolveActors(list) {
      const ids = [...new Set(list.map((r) => r.actor_id).filter((id) => id && UUID_RE.test(id) && !actors.has(id)))];
      if (!ids.length) return;
      ids.forEach((id) => actors.set(id, null));
      try {
        const profs = await q(sb.from('profiles').select('user_id, full_name').in('user_id', ids));
        profs.forEach((p) => actors.set(p.user_id, p.full_name || null));
      } catch {
        /* fica o e-mail */
      }
    }
    const actorName = (r) => {
      if (r.actor_id && r.actor_id === ctx.user.id) return 'Você';
      const n = r.actor_id ? actors.get(r.actor_id) : null;
      if (n) return n;
      if (r.actor_email) return r.actor_email.split('@')[0];
      return 'Sistema';
    };

    /* ---------- Lojas que já foram excluídas ---------- */
    async function resolveStores(list) {
      const ids = [...new Set(list.map((r) => r.store_id).filter((id) => id && !knownStore(id) && !goneStores.has(id)))];
      if (!ids.length) return;
      ids.forEach((id) => goneStores.set(id, null));
      try {
        const found = await q(sb.from('audit_log').select('record_id, changes').eq('table_name', 'stores').in('record_id', ids).in('action', ['insert', 'delete']).limit(100));
        found.forEach((f) => typeof f.changes?.name === 'string' && goneStores.set(f.record_id, f.changes.name));
      } catch {
        /* sem histórico: fica "Loja excluída" */
      }
    }
    const storeLabel = (id) => {
      if (!id) return null;
      const s = knownStore(id);
      if (s) return s.name;
      return goneStores.get(id) ? `${goneStores.get(id)} (excluída)` : 'Loja excluída';
    };
    const storeChip = (id, size = 20) => {
      if (!id)
        return html`<span class="au-store au-store--net"><span class="smark smark--net" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${icon('houses', 'icon-xs')}</span>Rede</span>`;
      const s = knownStore(id);
      return s
        ? html`<span class="au-store">${storeMark(s, size)}<span class="au-store__n">${ctx.storeShort?.(s) || s.name}</span></span>`
        : html`<span class="au-store au-store--gone">${storeLabel(id)}</span>`;
    };

    /* ---------- Valores legíveis ---------- */
    async function ensureCategories() {
      if (catsLoaded) return;
      catsLoaded = true;
      try {
        const cats = await q(sb.from('categories').select('id, name'));
        cats.forEach((c) => categories.set(c.id, c.name));
      } catch {
        /* sem categorias */
      }
    }

    // texto curto (prévia na linha) ou null quando o valor é complexo
    function shortVal(key, v, tbl) {
      if (v === null || v === undefined || v === '') return 'vazio';
      if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
      if (key === 'role') return ROLES[v]?.label || v;
      if (key === 'status') {
        if (tbl === 'orders') return ORDER_STATUS[v]?.label || v;
        if (tbl === 'products') return PRODUCT_STATUS[v]?.label || v;
      }
      if (key === 'payment_status') return PAYMENT_STATUS[v]?.label || v;
      if (key === 'payment_method') return PAYMENT_METHOD[v] || v;
      if (key === 'type' && tbl === 'coupons') return COUPON_TYPE[v] || v;
      if (key === 'kind' && tbl === 'banners') return BANNER_KIND[v] || v;
      if (key === 'pix_key_type') return PIX_TYPE[v] || v;
      if (key === 'store_id') return storeLabel(v);
      if ((key === 'category_id' || key === 'parent_id') && categories.has(v)) return categories.get(v);
      if (MONEY.has(key) && !Number.isNaN(Number(v))) return money(v);
      if (PERCENT.has(key)) return pct(v, Number(v) % 1 ? 1 : 0);
      if (KM.has(key)) return `${num(v)} km`;
      if (typeof v === 'number') return num(v);
      if (typeof v === 'string') {
        if (ISO_TS.test(v)) return datetime(v);
        if (ISO_DAY.test(v)) return date(`${v}T12:00:00`);
        if (/image|logo|photo|foto/.test(key) || /^https?:\/\//i.test(v) || v.length > 42 || v.includes('\n')) return null;
        return v;
      }
      return null;
    }

    function pretty(key, v, tbl, mark) {
      if (v === null || v === undefined || v === '') return html`<span class="au-val au-val--empty">vazio</span>`;
      const wrap = (content) => html`<div class="au-val">${content}</div>`;
      if (typeof v === 'boolean') return wrap(html`<span class="au-bool ${v ? 'is-yes' : 'is-no'}">${icon(v ? 'checkCircle' : 'xCircle', 'icon-xs')} ${v ? 'Sim' : 'Não'}</span>`);
      if (key === 'role') return wrap(ROLES[v]?.label || v);
      if (key === 'status') {
        if (tbl === 'orders') return wrap(badge(ORDER_STATUS[v]?.label || v, ORDER_STATUS[v]?.tone));
        if (tbl === 'products') return wrap(badge(PRODUCT_STATUS[v]?.label || v, PRODUCT_STATUS[v]?.tone));
      }
      if (key === 'payment_status') return wrap(badge(PAYMENT_STATUS[v]?.label || v, PAYMENT_STATUS[v]?.tone));
      if (key === 'payment_method') return wrap(PAYMENT_METHOD[v] || v);
      if (key === 'payment_methods' && Array.isArray(v)) return wrap(chips(v.map((m) => PAYMENT_METHOD[m] || m), mark));
      if (key === 'type' && tbl === 'coupons') return wrap(COUPON_TYPE[v] || v);
      if (key === 'kind' && tbl === 'banners') return wrap(BANNER_KIND[v] || v);
      if (key === 'pix_key_type') return wrap(PIX_TYPE[v] || v);
      if (key === 'store_id') return wrap(storeChip(v));
      if ((key === 'category_id' || key === 'parent_id') && categories.has(v)) return wrap(categories.get(v));
      if (MONEY.has(key) && !Number.isNaN(Number(v))) return wrap(html`<span class="au-num">${money(v)}</span>`);
      if (PERCENT.has(key)) return wrap(html`<span class="au-num">${pct(v, Number(v) % 1 ? 1 : 0)}</span>`);
      if (KM.has(key)) return wrap(html`<span class="au-num">${num(v)} km</span>`);
      if (key === 'value' && tbl === 'coupons') return wrap(html`<span class="au-num">${num(v)}</span>`);
      if ((key === 'phone' || key === 'customer_phone' || key === 'whatsapp' || key === 'support_whatsapp') && typeof v === 'string') return wrap(phone(v));
      if (key === 'cep' && typeof v === 'string') return wrap(cep(v));
      if (key === 'delivery_fee_tiers' && Array.isArray(v)) return wrap(chips(v.map((t) => `até ${num(t.up_to_km)} km: ${Number(t.fee) ? money(t.fee) : 'grátis'}`), mark));
      if (key === 'benefits' && Array.isArray(v)) return wrap(html`<ol class="au-ol">${v.map((b) => html`<li><strong>${b.title || '—'}</strong> — ${b.text || ''}</li>`)}</ol>`);
      if (key === 'specs' && Array.isArray(v)) return wrap(v.length ? chips(v.map((s) => `${s.label}: ${s.value}`), mark) : html`<span class="au-val--empty">lista vazia</span>`);
      if (typeof v === 'number') return wrap(html`<span class="au-num">${num(v)}</span>`);
      if (typeof v === 'string') {
        if (/^#[0-9a-f]{6}$/i.test(v)) return wrap(html`<span class="au-sw" style="background:${v}"></span><span class="mono">${v.toUpperCase()}</span>`);
        if (ISO_TS.test(v)) return wrap(datetime(v));
        if (ISO_DAY.test(v)) return wrap(date(`${v}T12:00:00`));
        const isUrl = /^https?:\/\//i.test(v) || v.startsWith('/');
        const imgKey = /image|logo|photo|foto/.test(key);
        if (imgKey || (isUrl && IMG_RE.test(v))) {
          const src = mediaUrl(v);
          return wrap(html`<a class="au-img" href="${src}" target="_blank" rel="noopener" title="Abrir imagem"><img src="${src}" alt="" loading="lazy"></a>`);
        }
        if (/^https?:\/\//i.test(v)) return wrap(html`<a href="${v}" target="_blank" rel="noopener">${cut(v, 70)}</a>`);
        if (mark) return wrap(mark);
        return wrap(v);
      }
      if (Array.isArray(v)) {
        if (!v.length) return html`<span class="au-val au-val--empty">lista vazia</span>`;
        if (v.every((x) => x === null || typeof x !== 'object')) return wrap(chips(v.map((x) => (UUID_RE.test(String(x)) ? shortId(x) : String(x))), mark));
      }
      return wrap(html`<pre tabindex="0" aria-label="${fieldLabel(key)}">${JSON.stringify(v, null, 2)}</pre>`);
    }
    // chips de lista; mark = { add: Set, del: Set } destaca o que entrou ou saiu
    function chips(list, mark) {
      return html`<ul class="au-chips">${list.map((x) => {
        const s = String(x);
        const st = mark?.add?.has(s) ? 'is-add' : mark?.del?.has(s) ? 'is-del' : '';
        return html`<li class="${st}">${st === 'is-add' ? html`<span class="visually-hidden">entrou: </span>` : st === 'is-del' ? html`<span class="visually-hidden">saiu: </span>` : ''}${s}</li>`;
      })}</ul>`;
    }
    const listLabels = (key, v) =>
      !Array.isArray(v)
        ? null
        : key === 'payment_methods'
          ? v.map((m) => PAYMENT_METHOD[m] || m)
          : key === 'delivery_fee_tiers'
            ? v.map((t) => `até ${num(t.up_to_km)} km: ${Number(t.fee) ? money(t.fee) : 'grátis'}`)
            : key === 'specs'
              ? v.map((s) => `${s.label}: ${s.value}`)
              : v.every((x) => x === null || typeof x !== 'object')
                ? v.map((x) => (UUID_RE.test(String(x)) ? shortId(x) : String(x)))
                : null;

    // uma linha do comparativo antes/depois
    function diffRow(k, d, tbl) {
      const a = d.de;
      const b = d.para;
      let oldCell = pretty(k, a, tbl);
      let newCell = pretty(k, b, tbl);
      let extra = '';
      // listas: o que entrou e o que saiu
      const la = listLabels(k, a ?? []);
      const lb = listLabels(k, b ?? []);
      if (la && lb && (Array.isArray(a) || Array.isArray(b))) {
        const add = new Set(lb.filter((x) => !la.includes(x)));
        const del = new Set(la.filter((x) => !lb.includes(x)));
        oldCell = la.length ? html`<div class="au-val">${chips(la, { del })}</div>` : pretty(k, a, tbl);
        newCell = lb.length ? html`<div class="au-val">${chips(lb, { add })}</div>` : pretty(k, b, tbl);
        if (add.size || del.size) extra = html`<span class="au-delta">${[add.size ? `+${add.size}` : '', del.size ? `−${del.size}` : ''].filter(Boolean).join(' ')}</span>`;
      }
      // textos: diferença por palavra
      const plainText = (v) => typeof v === 'string' && !ISO_TS.test(v) && !ISO_DAY.test(v) && !/^#[0-9a-f]{6}$/i.test(v) && !/^https?:\/\//i.test(v) && !/image|logo|photo|foto/.test(k) && !['status', 'role', 'payment_status', 'payment_method', 'type', 'kind', 'pix_key_type', 'store_id', 'category_id', 'parent_id', 'phone', 'customer_phone', 'whatsapp', 'support_whatsapp', 'cep'].includes(k);
      if (plainText(a) && plainText(b) && (a.length > 18 || b.length > 18 || /\s/.test(a + b))) {
        const wd = wordDiff(a, b);
        if (wd) {
          oldCell = html`<div class="au-val au-text">${wd.old.map(([t, s]) => (t ? html`<del>${s}</del>` : s))}</div>`;
          newCell = html`<div class="au-val au-text">${wd.neu.map(([t, s]) => (t ? html`<ins>${s}</ins>` : s))}</div>`;
        }
      }
      // números: variação
      const na = Number(a);
      const nb = Number(b);
      if (a !== null && b !== null && a !== '' && b !== '' && typeof a !== 'boolean' && typeof b !== 'boolean' && Number.isFinite(na) && Number.isFinite(nb) && !UUID_RE.test(String(a)) && (MONEY.has(k) || PERCENT.has(k) || KM.has(k) || typeof a === 'number')) {
        const diff = nb - na;
        if (diff) {
          const fmt = MONEY.has(k) ? money(Math.abs(diff)) : PERCENT.has(k) ? pct(Math.abs(diff), Math.abs(diff) % 1 ? 1 : 0).replace('%', ' p.p.') : num(Math.abs(diff));
          const rel = na && MONEY.has(k) ? ` (${diff > 0 ? '+' : '−'}${pct(Math.abs((diff / na) * 100), 1)})` : '';
          extra = html`<span class="au-delta ${diff > 0 ? 'is-up' : 'is-down'}">${icon(diff > 0 ? 'arrowUp' : 'arrowDown', 'icon-xs')}${diff > 0 ? '+' : '−'}${fmt}${rel}</span>`;
        }
      }
      return html`<tr><th scope="row">${fieldLabel(k)}</th><td class="is-old">${oldCell}</td><td class="au-diff__arrow" aria-hidden="true">${icon('arrowRight', 'icon-xs')}</td><td class="is-new">${newCell}${extra}</td></tr>`;
    }

    function changedFields(r) {
      if (r.action !== 'update' || !r.changes) return [];
      return sortKeys(changedKeys(r.changes));
    }

    /* ---------- Frase de cada linha ---------- */
    function sentence(r) {
      const verb = ACTIONS[r.action]?.verb || r.action;
      const noun = AREA_NOUN[r.table_name] || (AREAS[r.table_name] || r.table_name).toLowerCase();
      const label = recordLabel(r);
      const c = r.changes || {};
      if (r.table_name === 'staff' && r.action === 'update' && Object.keys(c).length === 1 && 'senha' in c)
        return html`<b class="au-who">${actorName(r)}</b> gerou uma senha nova para <b class="au-rec">${label || 'uma pessoa da equipe'}</b>`;
      if (r.table_name === 'network_settings') return html`<b class="au-who">${actorName(r)}</b> ${verb} <b class="au-rec">as configurações da rede</b>`;
      return html`<b class="au-who">${actorName(r)}</b> ${verb} ${noun} ${
        label ? html`<b class="au-rec">${label}</b>` : html`<span class="au-rec au-rec--id mono">#${shortId(r.record_id)}</span>`
      }`;
    }
    const maxPreview = () => {
      try {
        return matchMedia('(max-width: 767px)').matches ? 1 : 2;
      } catch {
        return 2;
      }
    };
    function preview(r) {
      if (r.action !== 'update' || !r.changes) return '';
      const keys = changedFields(r);
      const shown = [];
      for (const k of keys) {
        const v = r.changes[k];
        if (!isDiff(v)) continue;
        const a = shortVal(k, v.de, r.table_name);
        const b = shortVal(k, v.para, r.table_name);
        if (a === null || b === null) continue;
        const va = a === 'vazio' ? html`<i class="au-mini__nil">vazio</i>` : html`<s>${cut(a, 32)}</s>`;
        const vb = b === 'vazio' ? html`<i class="au-mini__nil">vazio</i>` : html`<b>${cut(b, 32)}</b>`;
        shown.push(html`<span class="au-mini"><span class="au-mini__k">${fieldLabel(k)}</span> ${va}${icon('arrowRight', 'icon-xs')}${vb}</span>`);
        if (shown.length >= maxPreview()) break;
      }
      const rest = keys.length - shown.length;
      const names = keys.map(fieldLabel);
      if (!shown.length) {
        const list = names.length > 4 ? `${names.slice(0, 4).join(', ')} e mais ${names.length - 4}` : names.join(', ');
        return list ? html`<span class="au-fields">Mudou: ${list}</span>` : '';
      }
      return html`${shown}${rest > 0 ? html`<span class="au-more">+${plural(rest, 'campo', 'campos')}</span>` : ''}`;
    }

    /* ---------- Lista ---------- */
    const hasFilters = () => !!(state.area || state.action || state.store || state.email.trim() || state.period !== '30' || state.record);
    function summaryText() {
      const p = state.period === 'custom' ? (state.from && state.to ? `entre ${rangeLabel(state.from, state.to)}` : '') : PERIOD_PHRASE[state.period];
      return p;
    }
    function draw() {
      $('[data-clear]', view).hidden = !hasFilters();
      paintRecordChip();
      render($('[data-sum]', view), total ? html`<b>${plural(total, 'alteração', 'alterações')}</b>` : '');
      if (!rows.length) {
        footEl.hidden = true;
        const where = ctx.store ? ` em ${ctx.storeShort?.(ctx.store) || ctx.store.name}` : '';
        render(
          listEl,
          hasFilters()
            ? empty(
                'Nenhuma alteração encontrada',
                `Nada registrado${state.area ? ` em ${AREAS[state.area]}` : ''}${where} ${summaryText()}${state.email.trim() ? ` por “${state.email.trim()}”` : ''}. Ajuste os filtros ou amplie o período.`.replace(/\s+\./, '.'),
                html`<button class="btn" type="button" data-clear-all>${icon('close', 'icon-sm')} Limpar filtros</button>${
                  state.period !== 'all' ? html`<button class="btn btn--dark" type="button" data-all-time>Todo o período</button>` : ''
                }`,
                { art: 'site:empty-search' }
              )
            : empty('Nada registrado ainda', 'As alterações feitas no painel aparecem aqui, com quem fez, quando e o que mudou.', '', { art: 'empty-box' })
        );
        return;
      }
      // agrupa por dia
      const groups = [];
      rows.forEach((r) => {
        const key = isoDay(new Date(r.created_at));
        let g = groups.find((x) => x.key === key);
        if (!g) groups.push((g = { key, rows: [] }));
        g.rows.push(r);
      });
      render(
        listEl,
        groups.map((g) => {
          const [t, sub] = dayTitle(g.key);
          return html`<section class="au-day" aria-labelledby="au-d-${g.key}">
            <h3 class="au-day__h" id="au-d-${g.key}"><span>${t}</span>${sub ? html`<span class="au-day__sub">${sub}</span>` : ''}<span class="au-day__n">${plural(g.rows.length, 'alteração', 'alterações')}</span></h3>
            <ol class="au-list ${networkView ? '' : 'au-list--one'}">${g.rows.map((r) => {
              const a = ACTIONS[r.action] || ACTIONS.update;
              return html`<li class="au-item" data-row="${r.id}">
                <time class="au-time" datetime="${r.created_at}" title="${datetime(r.created_at)} · ${relTime(r.created_at)}">${hhmm(r.created_at)}</time>
                <span class="au-tile t-${a.t}" aria-hidden="true">${icon(AREA_ICON[r.table_name] || 'edit', 'icon-sm')}<span class="au-tile__b">${icon(a.icon, 'icon-xs')}</span></span>
                <span class="au-main">
                  <span class="au-line">${sentence(r)}</span>
                  <span class="au-sub">${preview(r)}</span>
                </span>
                ${networkView ? html`<span class="au-where">${storeChip(r.store_id)}</span>` : ''}
                <button class="au-open" type="button" data-open="${r.id}" title="${r.actor_email || 'Sistema'}">
                  <span class="visually-hidden">Ver detalhes: ${a.label} · ${AREAS[r.table_name] || r.table_name}${recordLabel(r) ? ` ${recordLabel(r)}` : ''}, ${datetime(r.created_at)}</span>
                  ${icon('chevronRight', 'icon-sm')}
                </button>
              </li>`;
            })}</ol>
          </section>`;
        })
      );
      footEl.hidden = total <= PAGE;
      render(footEl, total > PAGE ? pager({ page: state.page, pageSize: PAGE, total }) : '');
    }

    function paintRecordChip() {
      const chip = $('[data-record]', view);
      chip.hidden = !state.record;
      if (!state.record) return render(chip, '');
      const l = state.record.label || labels.get(`${state.record.table}:${state.record.id}`) || `#${shortId(state.record.id)}`;
      render(
        chip,
        html`<span class="chip chip--sel au-rec-chip__in">${icon(AREA_ICON[state.record.table] || 'edit', 'icon-xs')}<span class="chip__l">Histórico de ${l}</span><button type="button" class="chip__x" data-record-x aria-label="Ver tudo, não só este registro">${icon('close', 'icon-xs')}</button></span>`
      );
    }

    /* ---------- Gaveta de detalhes (antes / depois) ---------- */
    function openLink(r) {
      if (r.action === 'delete' || !r.record_id) return '';
      if (r.table_name === 'orders' && ctx.can('orders', r.store_id)) return html`<a class="btn" href="#/orders/${encodeURIComponent(r.record_id)}">${icon('external', 'icon-sm')} Abrir pedido</a>`;
      if (r.table_name === 'products' && ctx.can('catalog', r.store_id)) return html`<a class="btn" href="#/products/${encodeURIComponent(r.record_id)}">${icon('external', 'icon-sm')} Abrir produto</a>`;
      return '';
    }
    function detailParts(r) {
      const a = ACTIONS[r.action] || ACTIONS.update;
      const c = r.changes && typeof r.changes === 'object' ? r.changes : {};
      const keys = r.action === 'update' ? changedKeys(c) : Object.keys(c);
      const sameCount = r.action === 'update' ? Object.keys(c).length - keys.length : 0;
      const diffMode = r.action === 'update' && keys.length && keys.every((k) => isDiff(c[k]));
      const idx = rows.findIndex((x) => x.id === r.id);
      const label = recordLabel(r);
      let body;
      if (!keys.length) body = html`<p class="muted">Nenhum detalhe registrado para esta alteração.</p>`;
      else if (diffMode) {
        body = html`<div class="au-diff__wrap"><table class="au-diff">
          <caption class="visually-hidden">Campos alterados: valor antes e depois</caption>
          <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th aria-hidden="true"></th><th scope="col">Depois</th></tr></thead>
          <tbody>${sortKeys(keys).map((k) => diffRow(k, c[k], r.table_name))}</tbody>
        </table></div>`;
      } else {
        const shown = sortKeys(keys.filter((k) => !(r.action !== 'update' && NOISY.has(k))));
        const hidden = keys.length - shown.length;
        body = html`<dl class="au-kv">${shown.map(
          (k) => html`<div class="au-kv__r"><dt>${fieldLabel(k)}</dt><dd>${isDiff(c[k]) ? html`${pretty(k, c[k].de, r.table_name)}<span class="au-kv__arrow">${icon('arrowRight', 'icon-xs')}</span>${pretty(k, c[k].para, r.table_name)}` : pretty(k, c[k], r.table_name)}</dd></div>`
        )}</dl>
          ${hidden ? html`<p class="au-note">${icon('info', 'icon-xs')} ${plural(hidden, 'campo técnico oculto', 'campos técnicos ocultos')} (datas internas e identificadores).</p>` : ''}`;
      }
      const heading = r.action === 'insert' ? 'Dados no momento da criação' : r.action === 'delete' ? 'Dados no momento da exclusão' : 'O que mudou';
      const head = html`<div class="au-dh">
        <span class="au-tile au-tile--lg t-${a.t}" aria-hidden="true">${icon(AREA_ICON[r.table_name] || 'edit')}<span class="au-tile__b">${icon(a.icon, 'icon-xs')}</span></span>
        <div class="au-dh__txt">
          <p class="au-dh__ov">${badge(a.label, a.tone)}<span>${AREAS[r.table_name] || r.table_name}</span></p>
          <h2 class="au-dh__t">${r.table_name === 'network_settings' ? 'Configurações da rede' : label || html`<span class="mono">#${shortId(r.record_id)}</span>`}</h2>
          <p class="au-dh__by">por <b>${actorName(r)}</b> · ${datetime(r.created_at)} <span class="muted">(${relTime(r.created_at)})</span></p>
        </div>
        <div class="au-dh__nav">
          <span class="au-dh__pos">${num(idx + 1 + (state.page - 1) * PAGE)} de ${num(total)}</span>
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-prev aria-label="Alteração anterior (mais recente)" title="Anterior (K)" ${idx <= 0 ? 'disabled' : ''}>${icon('chevronUp', 'icon-sm')}</button>
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-next aria-label="Próxima alteração (mais antiga)" title="Próxima (J)" ${idx >= rows.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>
        </div>
      </div>`;
      const full = html`<div class="au-detail">
        <dl class="au-meta">
          <div><dt>Quem</dt><dd><span class="au-actor"><span class="avatar" aria-hidden="true">${initials(actorName(r) === 'Você' ? ctx.user.full_name || ctx.user.email : actorName(r))}</span><span><b>${actorName(r)}</b><span class="au-actor__mail">${r.actor_email || 'Ação automática do sistema'}</span></span></span></dd></div>
          <div><dt>Quando</dt><dd>${datetime(r.created_at)}<span class="au-meta__sub">${relTime(r.created_at)}</span></dd></div>
          <div><dt>Loja</dt><dd>${storeChip(r.store_id, 22)}</dd></div>
          <div><dt>Registro</dt><dd>${r.record_id && r.table_name !== 'network_settings'
            ? html`<span class="au-id"><span class="mono" title="${r.record_id}">${shortId(r.record_id)}…</span><button class="btn btn--ghost btn--icon btn--sm" type="button" data-copy-id="${r.record_id}" aria-label="Copiar identificador do registro">${icon('copy', 'icon-xs')}</button></span>`
            : '—'}</dd></div>
        </dl>
        <section class="au-sec" aria-labelledby="au-sec-t">
          <div class="au-sec__h"><h3 id="au-sec-t">${heading}</h3>${diffMode ? html`<span class="au-sec__n">${plural(keys.length, 'campo', 'campos')}</span>` : ''}</div>
          ${body}
          ${sameCount > 0 ? html`<p class="au-note">${icon('info', 'icon-xs')} ${plural(sameCount, 'campo registrado sem mudança', 'campos registrados sem mudança')}.</p>` : ''}
        </section>
      </div>`;
      const foot = html`${r.record_id && r.table_name !== 'network_settings' && !(state.record && state.record.id === r.record_id)
        ? html`<button class="btn btn--ghost" type="button" data-history>${icon('clock', 'icon-sm')} Histórico deste registro</button>`
        : ''}<span class="grow"></span>${openLink(r)}<button class="btn btn--primary" type="button" data-close>Fechar</button>`;
      return { head, body: full, foot };
    }

    async function openDetail(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      if (!r) return;
      await ensureCategories();
      const parts = detailParts(r);
      let cur = r;
      const go = (dir) => {
        const i = rows.findIndex((x) => x.id === cur.id) + dir;
        if (i < 0 || i >= rows.length) return;
        cur = rows[i];
        drawerApi?.setContent(detailParts(cur));
        hydrate(drawerApi.el);
        $(dir > 0 ? '[data-next]' : '[data-prev]', drawerApi.el)?.focus();
        if ($(dir > 0 ? '[data-next]' : '[data-prev]', drawerApi.el)?.disabled) $('[data-close]', drawerApi.el)?.focus();
        $$('.au-item.is-current', listEl).forEach((x) => x.classList.remove('is-current'));
        $(`.au-item[data-row="${cur.id}"]`, listEl)?.classList.add('is-current');
      };
      const hydrate = (el) => {
        // corpo rolável precisa ser alcançável pelo teclado quando não há links/botões dentro
        const bodyEl = $('.modal__body', el);
        if (bodyEl) {
          const none = !$('a, button, [tabindex]:not([tabindex="-1"])', bodyEl);
          if (none) {
            bodyEl.tabIndex = 0;
            bodyEl.setAttribute('aria-label', 'Detalhes da alteração');
          } else {
            bodyEl.removeAttribute('tabindex');
            bodyEl.removeAttribute('aria-label');
          }
        }
        // imagens antigas podem já ter sido apagadas do storage
        $$('.au-val img', el).forEach((img) =>
          img.addEventListener('error', () => {
            const link = img.closest('a');
            if (link) render(link, html`${icon('image', 'icon-sm')} imagem removida`);
          })
        );
      };
      $(`.au-item[data-row="${r.id}"]`, listEl)?.classList.add('is-current');
      drawerApi = drawer({
        title: 'Detalhes da alteração',
        head: parts.head,
        body: parts.body,
        foot: parts.foot,
        size: '',
        cls: 'au-drawer',
        onClose: () => {
          drawerApi = null;
          $$('.au-item.is-current', listEl).forEach((x) => x.classList.remove('is-current'));
        },
        onMount(el, close) {
          hydrate(el);
          el.addEventListener('click', async (e) => {
            if (e.target.closest('[data-prev]')) return go(-1);
            if (e.target.closest('[data-next]')) return go(1);
            if (e.target.closest('a[href^="#/"]')) return close();
            const cp = e.target.closest('[data-copy-id]');
            if (cp) {
              try {
                await navigator.clipboard.writeText(cp.dataset.copyId);
                toast('Identificador copiado', 'success', 2000);
              } catch {
                toast('Não foi possível copiar.', 'warning', 2400);
              }
              return;
            }
            if (e.target.closest('[data-history]')) {
              state.record = { table: cur.table_name, id: cur.record_id, label: recordLabel(cur) || '' };
              state.page = 1;
              close();
              load();
            }
          });
          el.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, textarea, select, [role="combobox"]')) return;
            if (e.key === 'j' || e.key === 'J') go(1);
            if (e.key === 'k' || e.key === 'K') go(-1);
          });
        },
      });
    }

    /* ---------- Exportar ---------- */
    async function exportCsv(btn) {
      try {
        const data = await withBusy(
          btn,
          async () => {
            const res = await q(applyFilters(sb.from('audit_log').select(COLS).order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 1999)));
            await Promise.all([resolveLabels(res), resolveStores(res), resolveActors(res)]);
            return res;
          },
          'Exportando…'
        );
        if (!data.length) return toast('Nada para exportar com estes filtros.', 'info');
        const csv = toCSV(data, [
          { label: 'Data e hora', value: (r) => datetime(r.created_at) },
          { label: 'Quem', value: (r) => r.actor_email || 'Sistema' },
          { label: 'Loja', value: (r) => storeLabel(r.store_id) || 'Rede' },
          { label: 'Área', value: (r) => AREAS[r.table_name] || r.table_name },
          { label: 'Ação', value: (r) => ACTIONS[r.action]?.label || r.action },
          { label: 'Registro', value: (r) => recordLabel(r) || r.record_id || '' },
          { label: 'Campos alterados', value: (r) => changedFields(r).map(fieldLabel).join(', ') },
        ]);
        const slug = ctx.store?.slug || 'rede';
        downloadFile(`auditoria-${slug}-${isoDay(new Date())}.csv`, csv);
        toast(data.length >= 2000 ? 'CSV com as 2.000 alterações mais recentes' : `${plural(data.length, 'alteração exportada', 'alterações exportadas')}`, 'success');
      } catch (e) {
        toastError(e);
      }
    }
    $('[data-export]')?.addEventListener('click', (e) => exportCsv(e.currentTarget));

    /* ---------- Eventos ---------- */
    function clearFilters() {
      Object.assign(state, { area: '', action: '', store: '', period: '30', from: '', to: '', email: '', page: 1, record: null });
      $$('[data-f]', view).forEach((s) => (s.value = state[s.dataset.f]));
      $('[data-email]', view).value = '';
      picker.set(null, null);
      paintRange();
      load();
    }
    view.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-page]');
      if (pg && !pg.disabled) {
        state.page = Math.max(1, Number(pg.dataset.page));
        load().then(() => view.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        return;
      }
      if (e.target.closest('[data-clear], [data-clear-all]')) return clearFilters();
      if (e.target.closest('[data-all-time]')) {
        state.period = 'all';
        $('#au-period', view).value = 'all';
        state.page = 1;
        paintRange();
        return load();
      }
      if (e.target.closest('[data-record-x]')) {
        state.record = null;
        state.page = 1;
        return load();
      }
      const open = e.target.closest('[data-open]') || e.target.closest('.au-item[data-row]');
      if (open && !e.target.closest('a')) openDetail(open.dataset.open || open.dataset.row);
    });
    $('[data-filters]', view).addEventListener('submit', (e) => e.preventDefault());
    $$('[data-f]', view).forEach((sel) =>
      sel.addEventListener('change', () => {
        state[sel.dataset.f] = sel.value;
        state.page = 1;
        if (sel.dataset.f === 'area') state.record = null;
        if (sel.dataset.f === 'period') {
          if (sel.value === 'custom') {
            if (!state.from) {
              const d = new Date();
              d.setDate(d.getDate() - 6);
              state.from = isoDay(d);
              state.to = isoDay(new Date());
              picker.set(state.from, state.to, '7d');
            }
            paintRange();
            setTimeout(() => picker.open(), 60);
          } else paintRange();
        }
        load();
      })
    );
    const onEmail = debounce(() => {
      state.page = 1;
      load();
    }, 350);
    $('[data-email]', view).addEventListener('input', (e) => {
      state.email = e.target.value;
      onEmail();
    });

    paintRange();
    await load();
    ensureCategories();
    return () => picker.destroy();
  },
};

const CSS = `
.au { display: flex; flex-direction: column; gap: 16px; }
.au-card { overflow: visible; }
.au-tb { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.au-tb__search { max-width: 280px; min-width: 200px; }
.au-tb__search .input::-webkit-search-cancel-button { display: none; }
.au-tb__f .sel__trigger, .au-tb__f .select { min-width: 150px; }
.au-tb__sum { font-size: 13px; color: var(--muted); white-space: nowrap; }
.au-tb__sum b { color: var(--ink); font-weight: 600; }
.au-range { height: 40px; }
.au-rec-chip { display: inline-flex; }
.au-rec-chip__in { height: 32px; max-width: 320px; padding: 0 4px 0 10px; }
.au-rec-chip__in .chip__l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.au-rec-chip__in .chip__x { border: 0; background: none; cursor: pointer; color: inherit; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; }
.au-rec-chip__in .chip__x:hover { background: var(--surface-3); }
.au-results { min-height: 160px; transition: opacity var(--dur-2); }
.au-results.is-busy { opacity: .55; }
.au-foot .pager { margin: 0; padding: 12px 20px; border-top: 1px solid var(--line); }
/* dia */
.au-day + .au-day { border-top: 1px solid var(--line); }
.au-day__h { position: sticky; top: var(--topbar-h); z-index: 2; display: flex; align-items: baseline; gap: 10px; margin: 0; padding: 14px 20px 8px; background: color-mix(in srgb, var(--surface) 94%, transparent); font: 700 14.5px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.005em; }
.au-day__sub { font: 500 12.5px/1 var(--font-ui); color: var(--muted); }
.au-day__n { margin-left: auto; font: 600 12px/1 var(--font-ui); color: var(--muted); }
.au-list { list-style: none; margin: 0; padding: 0 8px 8px; }
/* linha */
.au-item { position: relative; display: grid; grid-template-columns: 46px 36px minmax(0, 1fr) auto 28px; align-items: center; gap: 12px; min-height: 60px; padding: 9px 12px; border-radius: 12px; }
.au-list--one .au-item { grid-template-columns: 46px 36px minmax(0, 1fr) 28px; }
.au-item:hover, .au-item.is-current { background: var(--surface-2); }
.au-item.is-current { box-shadow: inset 3px 0 0 var(--select); }
.au-time { font-size: 13px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.au-tile { position: relative; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--b-bg, var(--surface-3)); color: var(--b-fg, var(--muted)); flex: none; }
.au-tile.t-ok { --b-bg: var(--ok-bg); --b-fg: var(--ok-fg); }
.au-tile.t-info { --b-bg: var(--info-bg); --b-fg: var(--info-fg); }
.au-tile.t-bad { --b-bg: var(--bad-bg); --b-fg: var(--bad-fg); }
.au-tile__b { position: absolute; right: -4px; bottom: -4px; display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: var(--b-fg); color: var(--surface); box-shadow: 0 0 0 2px var(--surface); }
.au-item:hover .au-tile__b, .au-item.is-current .au-tile__b { box-shadow: 0 0 0 2px var(--surface-2); }
.au-tile__b .icon-xs { width: 10px; height: 10px; stroke-width: 3; }
.au-tile--lg { width: 46px; height: 46px; border-radius: 14px; }
.au-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.au-line { font-size: 13.5px; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
.au-who { font-weight: 600; color: var(--ink); }
.au-rec { font-weight: 600; color: var(--ink); }
.au-rec--id { font-weight: 500; color: var(--muted); font-size: 12.5px; }
.au-sub { display: block; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
.au-sub > * { margin-right: 10px; }
.au-sub:empty { display: none; }
.au-mini { display: inline; min-width: 0; max-width: 100%; }
.au-mini > * { margin-right: 4px; }
.au-mini .icon-xs { display: inline-block; vertical-align: -1px; }
.au-mini__k { color: var(--muted); }
.au-mini s { color: var(--muted); text-decoration-color: color-mix(in srgb, var(--bad-fg) 55%, transparent); }
.au-mini b { color: var(--ink); font-weight: 600; }
.au-mini .icon-xs { color: var(--faint); flex: none; }
.au-mini__nil { color: var(--muted); font-style: italic; }
.au-more { color: var(--muted); font-weight: 500; }
.au-fields { overflow-wrap: anywhere; }
.au-store { display: inline-flex; align-items: center; gap: 7px; max-width: 200px; font-size: 13px; color: var(--text); white-space: nowrap; }
.au-store__n { overflow: hidden; text-overflow: ellipsis; }
.au-store--net { color: var(--muted); }
.au-store--net .smark--net { display: inline-grid; place-items: center; }
.au-store--gone { color: var(--muted); font-style: italic; }
.au-open { position: static; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
.au-open::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
.au-open:focus-visible { outline: 0; }
.au-open:focus-visible::after { outline: 2px solid var(--focus); outline-offset: -2px; }
.au-item:hover .au-open { background: var(--surface-3); color: var(--ink); }
.au-item .au-where { position: relative; }
/* gaveta */
.au-drawer .modal__head { align-items: flex-start; }
.au-dh { display: flex; align-items: flex-start; gap: 14px; min-width: 0; width: 100%; }
.au-dh__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.au-dh__ov { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.au-dh__t { margin: 0; font: 800 20px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.01em; overflow-wrap: anywhere; }
.au-dh__by { margin: 0; font-size: 13px; color: var(--text); }
.au-dh__by b { font-weight: 600; color: var(--ink); }
.au-dh__nav { display: flex; align-items: center; gap: 2px; flex: none; margin-right: 6px; }
.au-dh__pos { margin-right: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.au-detail { display: flex; flex-direction: column; gap: 18px; }
.au-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; margin: 0; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface-2); }
.au-meta dt { font: 600 11px/1.2 var(--font-ui); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.au-meta dd { margin: 5px 0 0; font-size: 13.5px; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.au-meta__sub { display: block; font-size: 12px; color: var(--muted); }
.au-actor { display: flex; align-items: center; gap: 9px; min-width: 0; }
.au-actor .avatar { width: 30px; height: 30px; border-radius: 9px; font-size: 11.5px; }
.au-actor > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.au-actor b { font-weight: 600; }
.au-actor__mail { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.au-id { display: inline-flex; align-items: center; gap: 2px; }
.au-id .mono { font-size: 12.5px; color: var(--text); }
.au-sec__h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.au-sec__h h3 { margin: 0; font: 700 16px/1.25 var(--font-display); color: var(--ink); }
.au-sec__n { font-size: 12px; font-weight: 600; color: var(--muted); }
.au-diff__wrap { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--raised); }
.au-diff { width: 100%; border-collapse: collapse; table-layout: fixed; }
.au-diff th, .au-diff td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13.5px; }
.au-diff thead th { padding: 9px 12px; background: var(--surface-2); font-size: 12px; font-weight: 600; color: var(--muted); }
.au-diff tbody tr:last-child > * { border-bottom: 0; }
.au-diff tbody th { width: 24%; font-weight: 600; color: var(--ink); }
.au-diff thead th:nth-child(3), .au-diff__arrow { width: 26px; padding-left: 0 !important; padding-right: 0 !important; color: var(--faint); text-align: center !important; }
.au-diff__arrow .icon-xs { margin-top: 3px; }
.au-diff td.is-old { background: color-mix(in srgb, var(--bad-bg) 45%, transparent); color: var(--text); }
.au-diff td.is-new { background: color-mix(in srgb, var(--ok-bg) 55%, transparent); color: var(--ink); }
.au-val { overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.45; }
.au-val .badge { height: auto; min-height: 24px; white-space: normal; text-align: left; }
.au-val--empty { color: var(--muted); font-style: italic; }
.au-text del { background: color-mix(in srgb, var(--bad-dot) 26%, transparent); color: var(--bad-fg); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--bad-fg) 60%, transparent); border-radius: 3px; padding: 0 1px; }
.au-text ins { background: color-mix(in srgb, var(--ok-dot) 28%, transparent); color: var(--ok-fg); text-decoration: none; border-radius: 3px; padding: 0 1px; font-weight: 600; }
.au-num { font-variant-numeric: tabular-nums; font-weight: 600; }
.au-delta { display: inline-flex; align-items: center; gap: 3px; margin-top: 6px; padding: 1px 7px; border-radius: 999px; background: var(--surface-3); color: var(--muted); font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.au-delta.is-up { background: var(--ok-bg); color: var(--ok-fg); }
.au-delta.is-down { background: var(--bad-bg); color: var(--bad-fg); }
.au-delta .icon-xs { width: 11px; height: 11px; stroke-width: 2.6; }
.au-bool { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
.au-bool.is-yes { color: var(--ok-fg); }
.au-bool.is-no { color: var(--muted); }
.au-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; white-space: normal; }
.au-chips li { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 9px; border-radius: 999px; background: var(--surface-3); color: var(--text); font-size: 12px; font-weight: 600; }
.au-chips li.is-add { background: var(--ok-bg); color: var(--ok-fg); box-shadow: inset 0 0 0 1px var(--ok-line); }
.au-chips li.is-add::before { content: '+'; margin-right: 3px; }
.au-chips li.is-del { background: var(--bad-bg); color: var(--bad-fg); text-decoration: line-through; box-shadow: inset 0 0 0 1px var(--bad-line); }
.au-ol { margin: 0; padding-left: 18px; list-style: decimal; white-space: normal; }
.au-val pre { margin: 0; max-height: 220px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--surface-3); font: 12px/1.45 var(--font-mono); white-space: pre-wrap; }
.au-img { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12.5px; }
.au-img img { width: 64px; height: 64px; object-fit: cover; border-radius: 9px; border: 1px solid var(--line); background: var(--surface-3); }
.au-sw { display: inline-block; width: 16px; height: 16px; margin-right: 7px; border-radius: 5px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.16); vertical-align: -3px; }
.au-kv { display: flex; flex-direction: column; margin: 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--raised); }
.au-kv__r { display: grid; grid-template-columns: minmax(120px, 30%) minmax(0, 1fr); }
.au-kv__r + .au-kv__r { border-top: 1px solid var(--line); }
.au-kv dt, .au-kv dd { margin: 0; padding: 10px 12px; font-size: 13.5px; }
.au-kv dt { font-weight: 600; color: var(--ink); background: var(--surface-2); }
.au-kv dd { color: var(--text); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.au-kv__arrow { color: var(--faint); display: inline-flex; }
.au-note { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
.au-drawer .modal__foot { gap: 8px; }
.au-drawer .modal__foot .grow { flex: 1; }

@media (max-width: 1100px) {
  .au-store { max-width: 140px; }
}
@media (max-width: 767px) {
  .au-tb { padding: 12px; }
  .au-tb__search { flex-basis: 100%; max-width: none; }
  .au-tb__f { flex: 1 1 140px; min-width: 0; }
  .au-tb__f .sel__trigger, .au-tb__f .select { width: 100%; min-width: 0; max-width: none; }
  .au-range { flex: 1 1 100%; }
  .au-tb .toolbar__spacer { display: none; }
  .au-tb__sum { flex-basis: 100%; }
  .au-day__h { top: var(--appbar-h); padding: 12px 16px 6px; flex-wrap: wrap; }
  .au-list { padding: 0 4px 6px; }
  .au-item, .au-list--one .au-item { grid-template-columns: 36px minmax(0, 1fr) 24px; grid-template-areas: "tile main open" "tile meta open"; gap: 4px 12px; padding: 10px 10px; }
  .au-tile { grid-area: tile; align-self: start; margin-top: 2px; }
  .au-main { grid-area: main; }
  .au-time { grid-area: meta; font-size: 12px; font-weight: 500; }
  .au-where { grid-area: meta; justify-self: end; }
  .au-store { font-size: 12px; max-width: 160px; }
  .au-open { grid-area: open; }
  .au-meta { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .au-dh__nav { position: absolute; right: 52px; top: 14px; }
  .au-dh__pos { display: none; }
  .au-dh { padding-right: 70px; }
  .au-diff thead { display: none; }
  .au-diff, .au-diff tbody, .au-diff tr { display: block; width: 100%; }
  .au-diff tr { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr); border-bottom: 1px solid var(--line); }
  .au-diff tbody tr:last-child { border-bottom: 0; }
  .au-diff tbody th { grid-column: 1 / -1; width: auto; padding-bottom: 4px; border: 0; background: var(--surface-2); }
  .au-diff td { border: 0; }
  .au-diff__arrow { padding-top: 12px !important; }
  .au-kv__r { grid-template-columns: minmax(0, 1fr); }
  .au-kv dt { padding-bottom: 4px; }
  .au-drawer .modal__foot { flex-wrap: wrap; }
  .au-drawer .modal__foot .grow { display: none; }
}
`;
