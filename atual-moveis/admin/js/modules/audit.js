// Auditoria: quem mudou o quê, quando e em qual loja.
// O audit_log é preenchido pelos gatilhos do banco (audit_row) e pela edge function admin-users (equipe).
// A RLS já filtra: a rede vê tudo; o administrador da loja vê só as linhas da própria loja.
// Lista paginada no servidor; cada linha abre um modal com as alterações (campo / de / para).
import { sb, q, mediaUrl } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  esc,
  icon,
  loading,
  empty,
  errorBlock,
  injectStyle,
  debounce,
  datetime,
  date,
  relTime,
  num,
  money,
  pct,
  badge,
  table,
  pager,
  openModal,
  isoDay,
  dayStart,
  dayEnd,
  phone,
  cep,
  ROLES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PRODUCT_STATUS,
} from '../ui.js';

const CSS = `
.audit { display: flex; flex-direction: column; gap: 14px; }
.audit .toolbar { margin-bottom: 0; }
.audit .search { max-width: 300px; }
.audit__filter { width: auto; min-width: 150px; }
.audit__dates { display: flex; align-items: center; gap: 6px; }
.audit__dates .input { width: 150px; }
.audit__clear { margin-left: auto; }
.audit .table td { white-space: nowrap; vertical-align: top; }
.audit .table td.audit__rec { white-space: normal; min-width: 240px; max-width: 420px; }
.audit__recname { display: block; color: var(--ink); font-weight: 600; overflow-wrap: anywhere; }
.audit__fields { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.audit__who { display: block; max-width: 230px; overflow: hidden; text-overflow: ellipsis; }
.audit__when small { display: block; color: var(--muted); font-size: 12px; }
.audit-detail__meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.audit-detail__meta dt { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
.audit-detail__meta dd { margin: 2px 0 0; color: var(--ink); overflow-wrap: anywhere; }
.audit-detail__meta .mono { font-size: 11.5px; color: var(--muted); }
.audit-diff { width: 100%; border-collapse: collapse; table-layout: fixed; }
.audit-diff th, .audit-diff td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.audit-diff th { background: var(--surface-2); font-size: 11.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
.audit-diff tr:last-child td { border-bottom: 0; }
.audit-diff td:first-child { width: 26%; font-weight: 600; color: var(--ink); }
.audit-diff td.is-old { background: #fff6f6; }
.audit-diff td.is-new { background: #f3fbf6; }
.audit-diff__wrap { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.audit-kv { display: grid; grid-template-columns: minmax(130px, 30%) minmax(0, 1fr); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.audit-kv dt, .audit-kv dd { margin: 0; padding: 9px 12px; border-bottom: 1px solid var(--line); }
.audit-kv dt { font-weight: 600; color: var(--ink); background: var(--surface-2); }
.audit-kv dt:last-of-type, .audit-kv dd:last-of-type { border-bottom: 0; }
.audit-val { overflow-wrap: anywhere; white-space: pre-wrap; }
.audit-val--empty { color: var(--muted); font-style: italic; }
.audit-val pre { margin: 0; max-height: 220px; overflow: auto; padding: 8px 10px; border-radius: 6px; background: #f4f4f4; font-size: 12px; white-space: pre-wrap; }
.audit-val img { width: 64px; height: 64px; object-fit: cover; border-radius: 7px; border: 1px solid var(--line); background: #f3f3f3; }
.audit-val a:has(.icon-sm) { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12.5px; }
.audit-val .audit-sw { display: inline-block; width: 14px; height: 14px; margin-right: 6px; border-radius: 4px; border: 1px solid rgba(0, 0, 0, 0.15); vertical-align: -2px; }
.audit-val ul { display: flex; flex-wrap: wrap; gap: 4px; }
.audit-val li.badge { height: auto; min-height: 22px; white-space: normal; }
.audit-val ol { padding-left: 18px; list-style: decimal; }
.audit-detail__note { font-size: 12.5px; color: var(--muted); }
@media (max-width: 860px) {
  .audit .search { max-width: none; flex: 1 1 100%; }
  .audit__filter { flex: 1 1 140px; }
  .audit__dates { flex: 1 1 100%; }
  .audit__dates .input { flex: 1; width: auto; min-width: 0; }
  .audit__clear { margin-left: 0; }
  .audit-detail__meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .audit .table-wrap { border: 0; background: transparent; overflow: visible; }
  .audit .table thead { display: none; }
  .audit .table, .audit .table tbody { display: block; }
  .audit .table tr { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 8px; padding: 12px 44px 12px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
  .audit .table td { display: block; padding: 0; border: 0; white-space: normal; }
  .audit .table td.audit__c-action { order: 1; }
  .audit .table td.audit__c-area { order: 2; font-weight: 600; color: var(--ink); }
  .audit .table td.audit__c-store { order: 3; font-size: 12.5px; color: var(--muted); }
  .audit .table td.audit__c-store::before { content: '· '; }
  .audit .table td.audit__rec { order: 4; flex-basis: 100%; min-width: 0; max-width: none; }
  .audit .table td.audit__c-when { order: 5; font-size: 12px; color: var(--muted); }
  .audit .table td.audit__c-who { order: 6; font-size: 12px; color: var(--muted); min-width: 0; }
  .audit .table td.audit__c-who::before { content: '· '; }
  .audit .table td.audit__c-who .audit__who { display: inline; max-width: none; }
  .audit .table td.audit__c-open { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); }
  .audit .pager { flex-direction: column; align-items: stretch; }
  .audit .pager > span { text-align: center; }
  .audit .pager .row { justify-content: space-between; }
  .audit-detail__meta { grid-template-columns: minmax(0, 1fr); }
  .audit-kv { grid-template-columns: minmax(0, 1fr); }
  .audit-kv dt { border-bottom: 0; padding-bottom: 2px; }
  .audit-diff td:first-child { width: 30%; }
  .audit-diff th, .audit-diff td { padding: 8px; }
}
`;

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
const NETWORK_ONLY_AREAS = ['categories', 'network_settings'];
const ACTIONS = {
  insert: { label: 'Criou', tone: 'success' },
  update: { label: 'Alterou', tone: 'info' },
  delete: { label: 'Excluiu', tone: 'danger' },
};
const PERIODS = [
  ['today', 'Hoje'],
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
  ['90', 'Últimos 90 dias'],
  ['all', 'Todo o período'],
  ['custom', 'Personalizado'],
];

// Nome legível de cada coluna (a ordem aqui também ordena a lista de valores)
const FIELDS = {
  name: 'Nome', title: 'Título', code: 'Código', full_name: 'Nome', email: 'E-mail', role: 'Papel', text: 'Texto',
  customer_name: 'Cliente', status: 'Status', active: 'Ativo', subtitle: 'Subtítulo', kicker: 'Chamada', slug: 'Endereço (slug)',
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

export default {
  title: 'Auditoria',
  async render(view, ctx) {
    injectStyle('audit', CSS);
    if (!ctx.can('settings')) {
      render(view, errorBlock('Somente administradores podem ver a auditoria.'));
      return;
    }
    const networkView = !ctx.storeId;
    const state = { area: '', action: '', store: '', period: '30', from: '', to: '', email: '', page: 1 };
    let total = 0;
    let rows = [];
    let token = 0;
    const labels = new Map(); // `${tabela}:${id}` → nome legível
    const categories = new Map();
    let catsLoaded = false;

    const areas = Object.entries(AREAS).filter(([k]) => networkView || !NETWORK_ONLY_AREAS.includes(k));

    render(
      view,
      html`<div class="audit">
        <div class="toolbar" role="search">
          <div class="search">${icon('search')}<label class="visually-hidden" for="audit-email">Buscar por e-mail de quem alterou</label>
            <input class="input" id="audit-email" type="search" placeholder="E-mail de quem alterou" autocomplete="off" data-email></div>
          <label class="visually-hidden" for="audit-area">Área</label>
          <select class="select audit__filter" id="audit-area" data-f="area">
            <option value="">Todas as áreas</option>
            ${areas.map(([k, v]) => html`<option value="${k}">${v}</option>`)}
          </select>
          <label class="visually-hidden" for="audit-action">Ação</label>
          <select class="select audit__filter" id="audit-action" data-f="action">
            <option value="">Todas as ações</option>
            ${Object.entries(ACTIONS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}
          </select>
          ${networkView
            ? html`<label class="visually-hidden" for="audit-store">Loja</label>
              <select class="select audit__filter" id="audit-store" data-f="store">
                <option value="">Todas as lojas</option>
                <option value="network">Somente rede (sem loja)</option>
                ${ctx.stores.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
              </select>`
            : ''}
          <label class="visually-hidden" for="audit-period">Período</label>
          <select class="select audit__filter" id="audit-period" data-f="period">
            ${PERIODS.map(([k, v]) => html`<option value="${k}" ${k === state.period ? 'selected' : ''}>${v}</option>`)}
          </select>
          <div class="audit__dates" data-dates hidden>
            <label class="visually-hidden" for="audit-from">De</label>
            <input class="input" id="audit-from" type="date" data-d="from" max="${isoDay(new Date())}">
            <span class="muted small">até</span>
            <label class="visually-hidden" for="audit-to">Até</label>
            <input class="input" id="audit-to" type="date" data-d="to" max="${isoDay(new Date())}">
          </div>
          <button class="btn btn--ghost btn--sm audit__clear" type="button" data-clear hidden>${icon('close', 'icon-sm')} Limpar filtros</button>
        </div>
        <div data-list>${loading('Carregando auditoria…')}</div>
      </div>`
    );
    const listEl = $('[data-list]', view);

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

    /* ---------- Consulta paginada ---------- */
    async function load() {
      const my = ++token;
      render(listEl, loading('Carregando auditoria…'));
      try {
        let qy = sb
          .from('audit_log')
          .select('id, created_at, actor_id, actor_email, store_id, table_name, record_id, action, changes', { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range((state.page - 1) * PAGE, state.page * PAGE - 1);
        if (ctx.storeId) qy = qy.eq('store_id', ctx.storeId);
        else if (state.store === 'network') qy = qy.is('store_id', null);
        else if (state.store) qy = qy.eq('store_id', state.store);
        if (state.area) qy = qy.eq('table_name', state.area);
        if (state.action) qy = qy.eq('action', state.action);
        const [from, to] = range();
        if (from) qy = qy.gte('created_at', dayStart(from));
        if (to) qy = qy.lt('created_at', dayEnd(to));
        const term = state.email.trim().replace(/[%_\\,()]/g, ' ').trim();
        if (term) qy = qy.ilike('actor_email', `%${term}%`);
        const res = await q(qy);
        if (my !== token) return;
        rows = res.data || [];
        total = res.count || 0;
        // página fora do intervalo (ex.: filtros mudaram)
        if (!rows.length && total && state.page > 1) {
          state.page = Math.max(1, Math.ceil(total / PAGE));
          return load();
        }
        await resolveLabels(rows);
        if (my !== token) return;
        draw();
      } catch (e) {
        if (my !== token) return;
        render(
          listEl,
          html`<div class="stack" style="--gap:10px">${errorBlock(e)}<div><button class="btn btn--sm" type="button" data-retry>${icon('refresh', 'icon-sm')} Tentar novamente</button></div></div>`
        );
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
            const staffRows = await q(sb.from('staff').select('id, user_id').in('id', idList.filter((x) => /^[0-9a-f-]{36}$/i.test(x))));
            idList.forEach((id) => userHint[id] && !staffRows.some((s) => s.id === id) && staffRows.push({ id, user_id: userHint[id] }));
            const userIds = new Set([...staffRows.map((s) => s.user_id), ...idList]);
            const profs = await q(sb.from('profiles').select('user_id, email, full_name').in('user_id', [...userIds].filter((x) => /^[0-9a-f-]{36}$/i.test(x))));
            const byUser = Object.fromEntries(profs.map((p) => [p.user_id, p.full_name ? `${p.full_name} · ${p.email}` : p.email]));
            staffRows.forEach((s) => byUser[s.user_id] && labels.set(`staff:${s.id}`, byUser[s.user_id]));
            idList.forEach((id) => byUser[id] && labels.set(`staff:${id}`, byUser[id]));
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

    function changedFields(r) {
      if (r.action !== 'update' || !r.changes) return '';
      const keys = changedKeys(r.changes);
      const names = keys.map(fieldLabel);
      return names.length > 4 ? `${names.slice(0, 4).join(', ')} e mais ${names.length - 4}` : names.join(', ');
    }

    /* ---------- Lista ---------- */
    function draw() {
      $('[data-clear]', view).hidden = !(state.area || state.action || state.store || state.email || state.period !== '30');
      if (!rows.length) {
        render(
          listEl,
          html`<div class="card">${empty(
            'Nenhuma alteração encontrada',
            state.area || state.action || state.store || state.email || state.period !== 'all' ? 'Ajuste os filtros ou amplie o período.' : 'As alterações feitas no painel aparecem aqui.'
          )}</div>`
        );
        return;
      }
      const columns = [
        {
          label: 'Data/hora',
          cls: 'audit__c-when',
          render: (r) => html`<span class="audit__when" title="${relTime(r.created_at)}">${datetime(r.created_at)}</span>`,
        },
        { label: 'Quem', cls: 'audit__c-who', render: (r) => html`<span class="audit__who" title="${r.actor_email || ''}">${r.actor_email || 'Sistema'}</span>` },
        ...(networkView ? [{ label: 'Loja', cls: 'audit__c-store', render: (r) => (r.store_id ? ctx.storeName(r.store_id) : html`<span class="muted">Rede</span>`) }] : []),
        { label: 'Área', cls: 'audit__c-area', render: (r) => AREAS[r.table_name] || r.table_name },
        { label: 'Ação', cls: 'audit__c-action', render: (r) => badge(ACTIONS[r.action]?.label || r.action, ACTIONS[r.action]?.tone) },
        {
          label: 'Registro',
          cls: 'audit__rec',
          render: (r) => {
            const l = recordLabel(r);
            const f = changedFields(r);
            return html`<span class="audit__recname">${l || html`<span class="mono muted">#${shortId(r.record_id)}</span>`}</span>${f ? html`<span class="audit__fields">Mudou: ${f}</span>` : ''}`;
          },
        },
        {
          label: html`<span class="visually-hidden">Detalhes</span>`,
          cls: 'right audit__c-open',
          render: (r) => html`<button class="btn btn--ghost btn--sm btn--icon" type="button" data-open="${r.id}" aria-label="Ver detalhes da alteração de ${datetime(r.created_at)}">${icon('chevronRight')}</button>`,
        },
      ];
      render(
        listEl,
        html`${table({ columns, rows, rowAttrs: (r) => `class="is-clickable" data-row="${esc(r.id)}"` })}${pager({ page: state.page, pageSize: PAGE, total })}`
      );
    }

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

    function pretty(key, v, tbl) {
      if (v === null || v === undefined || v === '') return html`<span class="audit-val audit-val--empty">vazio</span>`;
      const wrap = (content) => html`<div class="audit-val">${content}</div>`;
      if (typeof v === 'boolean') return wrap(v ? 'Sim' : 'Não');
      if (key === 'role') return wrap(ROLES[v]?.label || v);
      if (key === 'status') {
        if (tbl === 'orders') return wrap(ORDER_STATUS[v]?.label || v);
        if (tbl === 'products') return wrap(PRODUCT_STATUS[v]?.label || v);
      }
      if (key === 'payment_status') return wrap(PAYMENT_STATUS[v]?.label || v);
      if (key === 'payment_method') return wrap(PAYMENT_METHOD[v] || v);
      if (key === 'payment_methods' && Array.isArray(v)) return wrap(html`<ul>${v.map((m) => html`<li class="badge badge--plain">${PAYMENT_METHOD[m] || m}</li>`)}</ul>`);
      if (key === 'type' && tbl === 'coupons') return wrap(COUPON_TYPE[v] || v);
      if (key === 'kind' && tbl === 'banners') return wrap(BANNER_KIND[v] || v);
      if (key === 'pix_key_type') return wrap(PIX_TYPE[v] || v);
      if (key === 'store_id') return wrap(ctx.storeName(v) !== '—' ? ctx.storeName(v) : shortId(v));
      if ((key === 'category_id' || key === 'parent_id') && categories.has(v)) return wrap(categories.get(v));
      if (MONEY.has(key) && !Number.isNaN(Number(v))) return wrap(money(v));
      if (PERCENT.has(key)) return wrap(pct(v, Number(v) % 1 ? 1 : 0));
      if (KM.has(key)) return wrap(`${num(v)} km`);
      if (key === 'value' && tbl === 'coupons') return wrap(num(v));
      if ((key === 'phone' || key === 'customer_phone' || key === 'whatsapp' || key === 'support_whatsapp') && typeof v === 'string') return wrap(phone(v));
      if (key === 'cep' && typeof v === 'string') return wrap(cep(v));
      if (key === 'delivery_fee_tiers' && Array.isArray(v))
        return wrap(html`<ul>${v.map((t) => html`<li class="badge badge--plain">até ${num(t.up_to_km)} km: ${Number(t.fee) ? money(t.fee) : 'grátis'}</li>`)}</ul>`);
      if (key === 'benefits' && Array.isArray(v)) return wrap(html`<ol>${v.map((b) => html`<li><strong>${b.title || '—'}</strong> — ${b.text || ''}</li>`)}</ol>`);
      if (key === 'specs' && Array.isArray(v)) return wrap(v.length ? html`<ul>${v.map((s) => html`<li class="badge badge--plain">${s.label}: ${s.value}</li>`)}</ul>` : html`<span class="audit-val--empty">lista vazia</span>`);
      if (typeof v === 'number') return wrap(num(v));
      if (typeof v === 'string') {
        if (/^#[0-9a-f]{6}$/i.test(v)) return wrap(html`<span class="audit-sw" style="background:${v}"></span>${v.toUpperCase()}`);
        if (ISO_TS.test(v)) return wrap(datetime(v));
        if (ISO_DAY.test(v)) return wrap(date(`${v}T12:00:00`));
        const isUrl = /^https?:\/\//i.test(v) || v.startsWith('/');
        const imgKey = /image|logo|photo|foto/.test(key);
        if (imgKey || (isUrl && IMG_RE.test(v))) {
          const src = mediaUrl(v);
          return wrap(html`<a href="${src}" target="_blank" rel="noopener" title="Abrir imagem"><img src="${src}" alt="" loading="lazy"></a>`);
        }
        if (/^https?:\/\//i.test(v)) return wrap(html`<a href="${v}" target="_blank" rel="noopener">${cut(v, 70)}</a>`);
        return wrap(v);
      }
      if (Array.isArray(v)) {
        if (!v.length) return html`<span class="audit-val audit-val--empty">lista vazia</span>`;
        if (v.every((x) => x === null || typeof x !== 'object'))
          return wrap(html`<ul>${v.map((x) => html`<li class="badge badge--plain">${/^[0-9a-f-]{36}$/i.test(String(x)) ? shortId(x) : String(x)}</li>`)}</ul>`);
      }
      return wrap(html`<pre tabindex="0" aria-label="${fieldLabel(key)}">${JSON.stringify(v, null, 2)}</pre>`);
    }

    const sortKeys = (keys) =>
      keys.sort((a, b) => {
        const ia = FIELD_ORDER.indexOf(a);
        const ib = FIELD_ORDER.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });

    function openLink(r) {
      if (r.action === 'delete' || !r.record_id) return '';
      if (r.table_name === 'orders' && ctx.can('orders', r.store_id)) return html`<a class="btn btn--sm" href="#/orders/${encodeURIComponent(r.record_id)}">${icon('external', 'icon-sm')} Abrir pedido</a>`;
      if (r.table_name === 'products' && ctx.can('catalog', r.store_id)) return html`<a class="btn btn--sm" href="#/products/${encodeURIComponent(r.record_id)}">${icon('external', 'icon-sm')} Abrir produto</a>`;
      return '';
    }

    async function openDetail(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      if (!r) return;
      await ensureCategories();
      const c = r.changes && typeof r.changes === 'object' ? r.changes : {};
      const keys = r.action === 'update' ? changedKeys(c) : Object.keys(c);
      const diffMode = r.action === 'update' && keys.length && keys.every((k) => isDiff(c[k]));
      let body;
      if (!keys.length) body = html`<p class="muted">Nenhum detalhe registrado para esta alteração.</p>`;
      else if (diffMode) {
        body = html`<div class="audit-diff__wrap"><table class="audit-diff">
          <thead><tr><th scope="col">Campo</th><th scope="col">De</th><th scope="col">Para</th></tr></thead>
          <tbody>${sortKeys(keys).map(
            (k) => html`<tr><td>${fieldLabel(k)}</td><td class="is-old">${pretty(k, c[k].de, r.table_name)}</td><td class="is-new">${pretty(k, c[k].para, r.table_name)}</td></tr>`
          )}</tbody>
        </table></div>`;
      } else {
        const shown = sortKeys(keys.filter((k) => !(r.action !== 'update' && NOISY.has(k))));
        const hidden = keys.length - shown.length;
        body = html`<dl class="audit-kv">${shown.map((k) => html`<dt>${fieldLabel(k)}</dt><dd>${isDiff(c[k]) ? html`${pretty(k, c[k].de, r.table_name)} → ${pretty(k, c[k].para, r.table_name)}` : pretty(k, c[k], r.table_name)}</dd>`)}</dl>
          ${hidden ? html`<p class="audit-detail__note mt-2">${num(hidden)} ${hidden === 1 ? 'campo técnico oculto' : 'campos técnicos ocultos'} (datas internas e identificadores).</p>` : ''}`;
      }
      const label = recordLabel(r);
      const heading = r.action === 'insert' ? 'Dados no momento da criação' : r.action === 'delete' ? 'Dados no momento da exclusão' : 'O que mudou';
      openModal({
        title: `${ACTIONS[r.action]?.label || r.action} · ${AREAS[r.table_name] || r.table_name}`,
        size: 'lg',
        body: html`<div class="stack" style="--gap:16px">
          <dl class="audit-detail__meta">
            <div><dt>Data/hora</dt><dd>${datetime(r.created_at)} <span class="muted small">(${relTime(r.created_at)})</span></dd></div>
            <div><dt>Quem</dt><dd>${r.actor_email || 'Sistema'}</dd></div>
            <div><dt>Loja</dt><dd>${r.store_id ? ctx.storeName(r.store_id) : 'Rede (sem loja)'}</dd></div>
            <div><dt>Área</dt><dd>${AREAS[r.table_name] || r.table_name}</dd></div>
            <div><dt>Ação</dt><dd>${badge(ACTIONS[r.action]?.label || r.action, ACTIONS[r.action]?.tone)}</dd></div>
            <div><dt>Registro</dt><dd>${label || '—'}<br><span class="mono">${r.record_id || ''}</span></dd></div>
          </dl>
          <div class="stack" style="--gap:8px">
            <div class="h3">${heading}</div>
            ${body}
          </div>
        </div>`,
        actions: html`${openLink(r)}<button class="btn btn--primary" type="button" data-close>Fechar</button>`,
        onMount(el, close) {
          $$('a[href^="#/"]', el).forEach((a) => a.addEventListener('click', () => close()));
          // corpo rolável precisa ser alcançável pelo teclado quando não há links/botões dentro
          const bodyEl = $('.modal__body', el);
          if (bodyEl && !$('a, button, [tabindex]', bodyEl)) {
            bodyEl.tabIndex = 0;
            bodyEl.setAttribute('aria-label', 'Detalhes da alteração');
          }
          // imagens antigas podem já ter sido apagadas do storage
          $$('.audit-val img', el).forEach((img) =>
            img.addEventListener('error', () => {
              const link = img.closest('a');
              if (link) render(link, html`${icon('image', 'icon-sm')} imagem removida`);
            })
          );
        },
      });
    }

    /* ---------- Eventos ---------- */
    view.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-page]');
      if (pg && !pg.disabled) {
        state.page = Math.max(1, Number(pg.dataset.page));
        load();
        view.scrollIntoView({ block: 'start' });
        return;
      }
      if (e.target.closest('[data-retry]')) return load();
      if (e.target.closest('[data-clear]')) {
        Object.assign(state, { area: '', action: '', store: '', period: '30', from: '', to: '', email: '', page: 1 });
        $$('[data-f]', view).forEach((s) => (s.value = state[s.dataset.f]));
        $$('[data-d]', view).forEach((d) => (d.value = ''));
        $('[data-email]', view).value = '';
        $('[data-dates]', view).hidden = true;
        load();
        return;
      }
      const open = e.target.closest('[data-open]') || e.target.closest('tr[data-row]');
      if (open && !e.target.closest('a')) openDetail(open.dataset.open || open.dataset.row);
    });
    $$('[data-f]', view).forEach((sel) =>
      sel.addEventListener('change', () => {
        state[sel.dataset.f] = sel.value;
        state.page = 1;
        if (sel.dataset.f === 'period') {
          const custom = sel.value === 'custom';
          $('[data-dates]', view).hidden = !custom;
          if (custom && !state.from) {
            const d = new Date();
            d.setDate(d.getDate() - 6);
            state.from = isoDay(d);
            state.to = isoDay(new Date());
            $('[data-d="from"]', view).value = state.from;
            $('[data-d="to"]', view).value = state.to;
          }
        }
        load();
      })
    );
    $$('[data-d]', view).forEach((inp) =>
      inp.addEventListener('change', () => {
        state[inp.dataset.d] = inp.value;
        if (state.from && state.to && state.from > state.to) {
          // mantém o intervalo coerente
          if (inp.dataset.d === 'from') state.to = state.from;
          else state.from = state.to;
          $('[data-d="from"]', view).value = state.from;
          $('[data-d="to"]', view).value = state.to;
        }
        state.page = 1;
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

    await load();
    ensureCategories();
  },
};
