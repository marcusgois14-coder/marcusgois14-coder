// Configurações da rede (linha única network_settings, id = 1) — só administradores da rede.
// Identidade, logos, cores, padrões das lojas (PIX, parcelas e o raio MÁXIMO de entrega,
// que limita todas as lojas pelo gatilho stores_guard), contato, SEO, rodapé,
// benefícios (sempre 4), faixa rolante e buscas populares da loja virtual.
// Desenho "Casa Atual": abas de seção fixas (com ponto nas seções alteradas), formulário em cartões,
// prévia ao vivo da loja virtual na coluna lateral e a barra de salvar do ui.js (Ctrl S, aviso ao sair).
import { sb, q, uploadImage, removeImage, mediaUrl, storefrontUrl } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  raw,
  icon,
  toast,
  toastError,
  empty,
  errorBlock,
  skeleton,
  injectStyle,
  num,
  money,
  phone,
  datetime,
  relTime,
  confirmDialog,
  storeMark,
  customSelect,
  saveBar,
  tip,
} from '../ui.js';

const DEFAULT_LOGO = '/assets/brand/atual-logo-horizontal.svg';
const DEFAULT_LOGO_WHITE = '/assets/brand/atual-logo-horizontal-white.svg';
const HEX_RE = /^#[0-9a-f]{6}$/i;
const MAX_FILE = 8 * 1024 * 1024;
const PREVIEW_PRICE = 2000; // preço cheio (cartão) do produto de exemplo da prévia

const BENEFIT_ICONS = {
  shield: { label: 'Escudo', hint: 'Garantia, compra segura', svg: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>' },
  truck: { label: 'Caminhão', hint: 'Entrega e montagem', svg: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>' },
  card: { label: 'Cartão', hint: 'Pagamento e parcelas', svg: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>' },
  chat: { label: 'Conversa', hint: 'Atendimento e WhatsApp', svg: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>' },
};
const benefitIcon = (name, cls = '') =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(BENEFIT_ICONS[name] || BENEFIT_ICONS.shield).svg}</svg>`);
const EMPTY_BENEFITS = [
  { icon: 'shield', title: '', text: '' },
  { icon: 'truck', title: '', text: '' },
  { icon: 'card', title: '', text: '' },
  { icon: 'chat', title: '', text: '' },
];

// [id, rótulo, ícone, chaves de dados]
const SECTIONS = [
  ['identity', 'Identidade', 'tag', ['name', 'tagline', 'slogan']],
  ['logos', 'Logos', 'image', ['logo_url', 'logo_white_url']],
  ['colors', 'Cores', 'palette', ['primary_color', 'accent_color']],
  ['defaults', 'Padrões', 'sliders', ['default_pix_discount', 'default_installments', 'default_radius_km']],
  ['contact', 'Contato', 'message', ['support_whatsapp', 'instagram', 'facebook']],
  ['seo', 'SEO', 'search', ['seo_title', 'seo_description']],
  ['benefits', 'Benefícios', 'checkCircle', ['benefits']],
  ['marquee', 'Faixa rolante', 'rows', ['marquee']],
  ['searches', 'Buscas', 'zoom', ['popular_searches']],
  ['footer', 'Rodapé', 'note', ['footer_legal']],
];
const SECTION_LONG = { defaults: 'Padrões das lojas', contact: 'Contato e redes sociais', searches: 'Buscas populares' };

const LIMITS = {
  name: 80,
  tagline: 120,
  slogan: 80,
  seo_title: 60,
  seo_title_max: 120,
  seo_description: 160,
  seo_description_max: 320,
  footer_legal: 400,
  benefit_title: 40,
  benefit_text: 120,
  marquee_item: 70,
  marquee_max: 12,
  search_item: 40,
  search_max: 12,
};
const PRESETS = {
  primary_color: [
    ['#0C1B26', 'Marinho'],
    ['#B8182B', 'Vermelho escuro'],
    ['#E01B26', 'Vermelho Atual'],
    ['#1A3142', 'Azul petróleo'],
    ['#6B4A2F', 'Nogueira'],
  ],
  accent_color: [
    ['#B8182B', 'Vermelho escuro'],
    ['#E01B26', 'Vermelho Atual'],
    ['#F4802B', 'Laranja Atual'],
    ['#C8955F', 'Carvalho'],
    ['#17643A', 'Verde'],
  ],
};

const digits = (v) => String(v || '').replace(/\D/g, '');
const fromOurBucket = (url) => /\/storage\/v1\/object\/public\/media\//.test(String(url || ''));

function hexToRgb(hex) {
  const m = HEX_RE.exec(hex || '');
  if (!m) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Luminância relativa (WCAG) e contraste com texto branco / quase preto (#191919)
function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const INK_L = luminance('#191919');
const contrastWithWhite = (hex) => (hexToRgb(hex) ? 1.05 / (luminance(hex) + 0.05) : 21);
const contrastWithInk = (hex) => (luminance(hex) + 0.05) / (INK_L + 0.05);
const ratioText = (r) => `${r.toFixed(1).replace('.', ',')}:1`;

function normalizeWhatsapp(v) {
  let d = digits(v);
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
function normalizeUrl(v, kind) {
  let s = String(v || '').trim();
  if (!s) return null;
  if (kind === 'instagram' && /^@?[a-z0-9._]{1,30}$/i.test(s)) return `https://www.instagram.com/${s.replace(/^@/, '')}/`;
  if (!/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) s = `https://${s}`;
  return s;
}
const validUrl = (s) => {
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.');
  } catch {
    return false;
  }
};

export default {
  title: 'Configurações da rede',
  async render(view, ctx) {
    injectStyle('network', CSS);
    if (!ctx.isGlobal) {
      render(
        view,
        html`<div class="card">${empty(
          'Esta área é da administração da rede',
          'Somente a administração da rede altera marca, cores e regras que valem para todas as lojas.',
          html`<a class="btn" href="#/dashboard">Voltar ao Painel</a>`,
          { art: 'no-access' }
        )}</div>`
      );
      return;
    }
    render(view, skeleton('form', { rows: 6 }));

    let orig;
    let stores = [];
    try {
      const [row, list] = await Promise.all([
        q(sb.from('network_settings').select('*').eq('id', 1).single()),
        q(sb.from('stores').select('id, name, slug, city, brand_name, delivery_radius_km, active').order('sort_order').order('name')),
      ]);
      orig = row;
      stores = list || [];
    } catch (e) {
      render(view, errorBlock(e, { title: 'Não foi possível carregar as configurações', retry: () => ctx.navigate(`#/network?r=${Date.now() % 1000}`) }));
      return;
    }
    if (!view.isConnected) return;

    // estado que não vive em inputs simples
    const st = {
      logo_url: orig.logo_url || null,
      logo_white_url: orig.logo_white_url || null,
      benefits: normalizeBenefits(orig.benefits),
      marquee: Array.isArray(orig.marquee) ? orig.marquee.map(String) : [],
      popular_searches: Array.isArray(orig.popular_searches) ? orig.popular_searches.map(String) : [],
    };
    const uploaded = new Set(); // arquivos enviados nesta sessão e ainda não salvos
    let baseline = {};
    let disposed = false;
    let editor = '';
    const previewStore = stores.find((s) => s.active) || stores[0] || null;

    function normalizeBenefits(list) {
      const arr = Array.isArray(list) ? list : [];
      return EMPTY_BENEFITS.map((d, i) => {
        const b = arr[i] || {};
        return { icon: BENEFIT_ICONS[b.icon] ? b.icon : d.icon, title: String(b.title || ''), text: String(b.text || '') };
      });
    }

    if (previewStore) ctx.setActions(html`<a class="btn" href="${storefrontUrl(previewStore.slug)}" target="_blank" rel="noopener">${icon('external')}<span>Ver loja virtual</span></a>`);

    const counter = (name, limit) => html`<span class="nw-count" data-counter="${name}" data-limit="${limit}" aria-live="off"></span>`;
    const card = (id, title, sub, body, extra = '') => {
      const s = SECTIONS.find((x) => x[0] === id);
      return html`<section class="card nw-sec" id="nw-${id}" data-section="${id}" aria-labelledby="nw-${id}-t" tabindex="-1">
        <div class="card__head card__head--line"><span class="nw-sec__ico" aria-hidden="true">${icon(s[2], 'icon-sm')}</span><div class="grow"><h2 class="card__title" id="nw-${id}-t">${title}</h2>${sub ? html`<p class="card__sub">${sub}</p>` : ''}</div>${extra}</div>
        <div class="card__body">${body}</div>
      </section>`;
    };
    const colorField = (name, label, value, fallback) => html`<div class="field col-6">
      <label for="nw-${name}">${label} *</label>
      <div class="nw-color">
        <label class="nw-swatch" data-swatch="${name}" title="Abrir o seletor de cores"><input type="color" data-pick="${name}" value="${HEX_RE.test(value) ? value.toLowerCase() : fallback}" aria-label="Escolher a ${label.toLowerCase()} no seletor"></label>
        <input class="input mono" id="nw-${name}" name="${name}" maxlength="7" value="${value || ''}" placeholder="${fallback.toUpperCase()}" spellcheck="false" autocomplete="off">
      </div>
      <div class="nw-presets" role="group" aria-label="Cores sugeridas para a ${label.toLowerCase()}">${PRESETS[name].map(
        ([hex, n]) => html`<button type="button" class="nw-preset" data-preset="${name}" data-hex="${hex}" style="--c:${hex}" aria-label="${n} ${hex}" data-tooltip="${n} · ${hex}" aria-pressed="false"></button>`
      )}</div>
      <span class="nw-ratio" data-contrast="${name}"></span>
    </div>`;

    render(
      view,
      html`<div class="nw">
        <nav class="ptabs nw-tabs" aria-label="Seções das configurações" data-tabs>
          ${SECTIONS.map(([id, label], i) => html`<button type="button" class="ptab ${i === 0 ? 'is-on' : ''}" data-goto="${id}" ${i === 0 ? raw('aria-current="true"') : ''}>${label}<span class="ptab__dot" data-dot="${id}" hidden></span><span class="visually-hidden" data-dot-sr="${id}"></span></button>`)}
        </nav>
        <div class="nw-grid">
          <form class="nw-main" data-form novalidate>
            <div data-tip></div>
            ${card(
              'identity',
              'Identidade',
              'Nome e frases da marca usados na loja virtual de todas as lojas.',
              html`<div class="form-grid">
                <div class="field col-6">
                  <div class="label"><label for="nw-name">Nome da rede *</label>${counter('name', LIMITS.name)}</div>
                  <input class="input" id="nw-name" name="name" required maxlength="${LIMITS.name}" value="${orig.name || ''}">
                </div>
                <div class="field col-6">
                  <div class="label"><label for="nw-tagline">Tagline</label>${counter('tagline', LIMITS.tagline)}</div>
                  <input class="input" id="nw-tagline" name="tagline" maxlength="${LIMITS.tagline}" value="${orig.tagline || ''}" placeholder="Móveis, colchões e eletro">
                </div>
                <div class="field col-12">
                  <div class="label"><label for="nw-slogan">Slogan *</label>${counter('slogan', LIMITS.slogan)}</div>
                  <textarea class="textarea nw-slogan-in" id="nw-slogan" name="slogan" rows="2" maxlength="${LIMITS.slogan}" required>${orig.slogan || ''}</textarea>
                  <span class="hint">Aparece no rodapé, grande e na cor principal. As quebras de linha são mantidas.</span>
                </div>
              </div>`
            )}
            ${card(
              'logos',
              'Logos',
              'SVG, PNG ou WebP com fundo transparente, até 8 MB. Sem logo enviada, a loja usa a logo padrão da Atual Móveis.',
              html`<div class="nw-logos">
                <div class="nw-logo" data-logo="logo_url">
                  <div class="nw-logo__l"><strong>Logo principal</strong><span>Fundos claros: cabeçalho da loja</span></div>
                  <div class="nw-logo__tiles" data-tiles></div>
                  <div class="nw-logo__bar" data-logo-bar></div>
                </div>
                <div class="nw-logo" data-logo="logo_white_url">
                  <div class="nw-logo__l"><strong>Logo branca</strong><span>Fundos escuros: rodapé e menu</span></div>
                  <div class="nw-logo__tiles" data-tiles></div>
                  <div class="nw-logo__bar" data-logo-bar></div>
                </div>
              </div>`
            )}
            ${card(
              'colors',
              'Cores',
              'A cor principal pinta botões, preços e destaques da loja virtual; a de apoio, selos e detalhes.',
              html`<div class="form-grid">
                ${colorField('primary_color', 'Cor principal', orig.primary_color, '#e01b26')}
                ${colorField('accent_color', 'Cor de apoio', orig.accent_color, '#f4802b')}
                <div class="col-12 nw-sample" data-sample aria-label="Amostra das cores">
                  <span class="nw-sample__l">Amostra</span>
                  <span class="nw-sample__btn">Comprar</span>
                  <span class="nw-sample__ghost">Detalhes</span>
                  <span class="nw-sample__price" data-sample-price></span>
                  <span class="nw-sample__tag" data-sample-tag></span>
                </div>
              </div>`
            )}
            ${card(
              'defaults',
              'Padrões das lojas',
              'Valores iniciais das lojas novas. Cada loja ajusta PIX e parcelas em “Dados da loja”.',
              html`<div class="form-grid">
                <div class="field col-4">
                  <label for="nw-pix">Desconto PIX padrão *</label>
                  <div class="input-group"><input class="input" id="nw-pix" name="default_pix_discount" type="number" inputmode="decimal" min="0" max="50" step="0.5" value="${orig.default_pix_discount ?? ''}"><span class="input-group__addon">%</span></div>
                  <span class="hint">De 0 a 50%. A vitrine mostra o preço PIX com este desconto.</span>
                </div>
                <div class="field col-4">
                  <label for="nw-inst">Parcelas padrão *</label>
                  <div class="input-group"><input class="input" id="nw-inst" name="default_installments" type="number" inputmode="numeric" min="1" max="24" step="1" value="${orig.default_installments ?? ''}"><span class="input-group__addon">vezes</span></div>
                  <span class="hint">De 1 a 24 parcelas sem juros.</span>
                </div>
                <div class="field col-4">
                  <label for="nw-radius">Raio máximo de entrega *</label>
                  <div class="input-group"><input class="input" id="nw-radius" name="default_radius_km" type="number" inputmode="decimal" min="1" max="500" step="1" value="${orig.default_radius_km ?? ''}"><span class="input-group__addon">km</span></div>
                  <span class="hint">Também é o raio inicial de novas lojas.</span>
                </div>
                <div class="col-12 callout nw-callout">${icon('truck')}<div><strong>Este raio é o teto de toda a rede.</strong>A equipe de cada loja não consegue salvar um raio de entrega maior que este valor; só a administração da rede pode abrir exceções.</div></div>
                <div class="col-12" data-cap-warning></div>
              </div>`
            )}
            ${card(
              'contact',
              'Contato e redes sociais',
              'Usados quando a loja não tem os próprios contatos cadastrados.',
              html`<div class="form-grid">
                <div class="field col-4">
                  <label for="nw-wa">WhatsApp de suporte</label>
                  <div class="nw-iin">${icon('whatsapp', 'icon-sm')}<input class="input" id="nw-wa" name="support_whatsapp" inputmode="numeric" autocomplete="off" maxlength="20" value="${orig.support_whatsapp || ''}" placeholder="5531999999999"></div>
                  <span class="hint" data-wa-hint>Só números: 55 + DDD + número.</span>
                </div>
                <div class="field col-4">
                  <label for="nw-ig">Instagram</label>
                  <div class="nw-iin">${icon('link', 'icon-sm')}<input class="input" id="nw-ig" name="instagram" type="url" inputmode="url" autocomplete="off" value="${orig.instagram || ''}" placeholder="@atualmoveis"></div>
                  <span class="hint">Endereço completo ou @perfil.</span>
                </div>
                <div class="field col-4">
                  <label for="nw-fb">Facebook</label>
                  <div class="nw-iin">${icon('link', 'icon-sm')}<input class="input" id="nw-fb" name="facebook" type="url" inputmode="url" autocomplete="off" value="${orig.facebook || ''}" placeholder="facebook.com/atualmoveis"></div>
                </div>
              </div>`
            )}
            ${card(
              'seo',
              'SEO',
              'Como a loja virtual aparece no Google e ao compartilhar o link.',
              html`<div class="form-grid">
                <div class="field col-12">
                  <div class="label"><label for="nw-seo-title">Título da página</label>${counter('seo_title', LIMITS.seo_title)}</div>
                  <input class="input" id="nw-seo-title" name="seo_title" maxlength="${LIMITS.seo_title_max}" value="${orig.seo_title || ''}">
                  <span class="hint">Ideal: até ${LIMITS.seo_title} caracteres.</span>
                </div>
                <div class="field col-12">
                  <div class="label"><label for="nw-seo-desc">Descrição</label>${counter('seo_description', LIMITS.seo_description)}</div>
                  <textarea class="textarea" id="nw-seo-desc" name="seo_description" rows="3" maxlength="${LIMITS.seo_description_max}">${orig.seo_description || ''}</textarea>
                  <span class="hint">Ideal: de 120 a ${LIMITS.seo_description} caracteres.</span>
                </div>
                <div class="col-12">
                  <span class="overline">Prévia no Google</span>
                  <div class="nw-serp" data-serp>
                    <div class="nw-serp__site"><span class="nw-serp__fav" aria-hidden="true"><img src="/assets/brand/favicon.svg" alt="" width="16" height="16"></span><span><b data-serp-name></b><span>${location.host}${previewStore ? storefrontUrl(previewStore.slug) : ''}</span></span></div>
                    <div class="nw-serp__title" data-serp-title></div>
                    <div class="nw-serp__desc" data-serp-desc></div>
                  </div>
                </div>
              </div>`
            )}
            ${card('benefits', 'Benefícios', 'Os 4 selos acima do rodapé da loja virtual: garantia, entrega, pagamento e atendimento.', html`<div class="nw-benefits" data-benefits></div>`)}
            ${card(
              'marquee',
              'Faixa rolante',
              'Frases curtas que passam na faixa da página inicial. Uma loja pode ter a sua própria faixa; senão usa esta.',
              html`<div data-list="marquee"></div>`
            )}
            ${card(
              'searches',
              'Buscas populares',
              'Sugestões exibidas ao abrir a busca da loja virtual (só aparecem as que têm produtos na loja).',
              html`<div data-list="popular_searches"></div>`
            )}
            ${card(
              'footer',
              'Rodapé',
              'Avisos e condições exibidos no fim de todas as páginas.',
              html`<div class="field">
                <div class="label"><label for="nw-legal">Texto legal do rodapé</label>${counter('footer_legal', LIMITS.footer_legal)}</div>
                <textarea class="textarea" id="nw-legal" name="footer_legal" rows="3" maxlength="${LIMITS.footer_legal}">${orig.footer_legal || ''}</textarea>
              </div>`
            )}
          </form>

          <aside class="nw-side" aria-label="Prévia da loja virtual">
            <section class="card nw-pv">
              <div class="nw-pv__head">
                <div class="grow"><h2 class="card__title">${icon('eye', 'icon-sm')} Prévia ao vivo</h2><p class="card__sub">Muda enquanto você edita. Nada vai para a loja antes de salvar.</p></div>
                <button class="btn btn--sm nw-pv__toggle" type="button" data-pv-toggle aria-expanded="false" aria-controls="nw-pv-body">${icon('chevronDown', 'icon-sm')}<span>Mostrar</span></button>
              </div>
              <div class="nw-pv__body" id="nw-pv-body" data-pv-body>
                <div class="nw-browser" aria-hidden="true">
                  <div class="nw-browser__bar"><i></i><i></i><i></i><span class="nw-browser__url">${location.host}${previewStore ? storefrontUrl(previewStore.slug) : '/loja'}</span></div>
                  <div class="nw-site" data-site>
                    <div class="nw-site__ann" data-pv-ann></div>
                    <div class="nw-site__hdr"><img data-pv-logo alt="" height="18"><span class="nw-site__search">${icon('search', 'icon-xs')} Buscar</span><span class="nw-site__ic"></span><span class="nw-site__ic"></span></div>
                    <div class="nw-site__chips" data-pv-chips></div>
                    <div class="nw-site__prod">
                      <span class="nw-site__img">${icon('sofa')}</span>
                      <span class="nw-site__info">
                        <span class="nw-site__name">Sofá retrátil 3 lugares</span>
                        <span class="nw-site__price" data-pv-price></span>
                        <span class="nw-site__terms" data-pv-terms></span>
                        <span class="nw-site__row"><span class="nw-site__tag" data-pv-tag></span><span class="nw-site__buy">Comprar</span></span>
                      </span>
                    </div>
                    <div class="nw-site__mq" data-pv-mq></div>
                    <div class="nw-site__ben" data-pv-ben></div>
                    <div class="nw-site__foot"><span class="nw-site__slogan" data-pv-slogan></span><span class="nw-site__legal" data-pv-legal></span></div>
                  </div>
                </div>
                <p class="nw-pv__meta" data-meta></p>
              </div>
            </section>
          </aside>
        </div>
        <form data-proxy hidden></form>
      </div>`
    );

    const form = $('[data-form]', view);
    const el = (name) => form.elements[name];

    /* ---------- Logos ---------- */
    function drawLogo(key) {
      const box = $(`[data-logo="${key}"]`, view);
      const value = st[key];
      const isWhite = key === 'logo_white_url';
      const src = value ? mediaUrl(value) : isWhite ? DEFAULT_LOGO_WHITE : DEFAULT_LOGO;
      render(
        $('[data-tiles]', box),
        isWhite
          ? html`<div class="nw-tile is-dark is-main"><img src="${src}" alt="Logo branca sobre fundo escuro"><span>Fundo escuro</span></div>
            <div class="nw-tile is-brand"><img src="${src}" alt="Logo branca sobre a cor principal"><span>Cor principal</span></div>`
          : html`<div class="nw-tile is-main"><img src="${src}" alt="Logo principal sobre fundo claro"><span>Fundo claro</span></div>
            <div class="nw-tile is-dark"><img src="${src}" alt="Logo principal sobre fundo escuro"><span>Fundo escuro</span></div>`
      );
      render(
        $('[data-logo-bar]', box),
        html`<button class="btn btn--sm" type="button" data-upload="${key}">${icon('upload', 'icon-sm')} ${value ? 'Trocar logo' : 'Enviar logo'}</button>
          ${value ? html`<button class="btn btn--sm btn--ghost" type="button" data-logo-reset="${key}">${icon('undo', 'icon-sm')} Usar a padrão</button>` : ''}
          <span class="nw-logo__state ${value && uploaded.has(value) ? 'is-new' : ''}">${value ? (uploaded.has(value) ? 'Nova logo · salve para aplicar' : 'Logo personalizada') : 'Logo padrão da Atual'}</span>
          <input type="file" accept="image/svg+xml,image/png,image/webp,image/jpeg" hidden data-file="${key}" aria-label="Arquivo da ${isWhite ? 'logo branca' : 'logo principal'}">`
      );
    }

    async function uploadLogo(key, file) {
      if (!file) return;
      if (!/^image\/(svg\+xml|png|webp|jpeg)$/.test(file.type)) return toastError('Envie a logo em SVG, PNG, WebP ou JPG.');
      if (file.size > MAX_FILE) return toastError('A imagem passa de 8 MB. Reduza o arquivo e tente de novo.');
      const btn = $(`[data-upload="${key}"]`, view);
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        render(btn, html`<span class="spinner spinner--sm" aria-hidden="true"></span> Enviando…`);
      }
      try {
        const url = await uploadImage(file, { network: true }, { folder: 'brand', maxSize: 1200 });
        if (disposed) {
          removeImage(url).catch(() => {});
          return;
        }
        const prev = st[key];
        if (prev && uploaded.has(prev)) {
          uploaded.delete(prev);
          removeImage(prev).catch(() => {});
        }
        uploaded.add(url);
        st[key] = url;
        toast('Logo enviada. Salve para aplicar na loja virtual.', 'success');
      } catch (e) {
        toastError(e);
      }
      if (!disposed) {
        drawLogo(key);
        refresh();
      }
    }

    view.addEventListener('click', (e) => {
      const up = e.target.closest('[data-upload]');
      if (up) return $(`[data-file="${up.dataset.upload}"]`, view)?.click();
      const reset = e.target.closest('[data-logo-reset]');
      if (reset) {
        const key = reset.dataset.logoReset;
        const prev = st[key];
        if (prev && uploaded.has(prev)) {
          uploaded.delete(prev);
          removeImage(prev).catch(() => {});
        }
        st[key] = null;
        drawLogo(key);
        refresh();
        $(`[data-upload="${key}"]`, view)?.focus();
        return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) {
        const sec = $(`#nw-${go.dataset.goto}`, view);
        sec?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        sec?.focus({ preventScroll: true });
        setActiveTab(go.dataset.goto);
        return;
      }
      const pr = e.target.closest('[data-preset]');
      if (pr) {
        const name = pr.dataset.preset;
        el(name).value = pr.dataset.hex;
        $(`[data-pick="${name}"]`, view).value = pr.dataset.hex.toLowerCase();
        clearFieldError(el(name));
        refresh();
        return;
      }
      const tg = e.target.closest('[data-pv-toggle]');
      if (tg) {
        const body = $('[data-pv-body]', view);
        const open = !body.classList.contains('is-open');
        body.classList.toggle('is-open', open);
        tg.setAttribute('aria-expanded', String(open));
        render(tg, html`${icon(open ? 'chevronUp' : 'chevronDown', 'icon-sm')}<span>${open ? 'Ocultar' : 'Mostrar'}</span>`);
      }
    });
    view.addEventListener('change', (e) => {
      const f = e.target.closest('[data-file]');
      if (f) {
        uploadLogo(f.dataset.file, f.files?.[0]);
        f.value = '';
      }
    });
    $$('[data-logo]', view).forEach((box) => {
      box.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        box.classList.add('is-over');
      });
      box.addEventListener('dragleave', () => box.classList.remove('is-over'));
      box.addEventListener('drop', (e) => {
        e.preventDefault();
        box.classList.remove('is-over');
        uploadLogo(box.dataset.logo, e.dataTransfer?.files?.[0]);
      });
    });

    /* ---------- Cores ---------- */
    $$('[data-pick]', view).forEach((pick) =>
      pick.addEventListener('input', () => {
        el(pick.dataset.pick).value = pick.value.toUpperCase();
        clearFieldError(el(pick.dataset.pick));
        refresh();
      })
    );
    ['primary_color', 'accent_color'].forEach((name) =>
      el(name).addEventListener('input', (e) => {
        let v = e.target.value.trim();
        if (v && !v.startsWith('#')) v = `#${v}`;
        if (HEX_RE.test(v)) $(`[data-pick="${name}"]`, view).value = v.toLowerCase();
      })
    );

    /* ---------- Benefícios ---------- */
    const benefitOpt = (it) =>
      html`<span class="opt__icon nw-bi" aria-hidden="true">${benefitIcon(it.value)}</span><span class="opt__body"><span class="opt__label">${it.label}</span><span class="opt__hint">${BENEFIT_ICONS[it.value]?.hint || ''}</span></span>`;
    function drawBenefits() {
      render(
        $('[data-benefits]', view),
        st.benefits.map(
          (b, i) => html`<div class="nw-benefit" data-benefit="${i}">
            <div class="nw-benefit__head">
              <span class="nw-benefit__icon" data-benefit-icon>${benefitIcon(b.icon)}</span>
              <span class="nw-benefit__n">Selo ${i + 1}</span>
              <label class="visually-hidden" for="nw-b-icon-${i}">Ícone do selo ${i + 1}</label>
              <select class="select select--sm" id="nw-b-icon-${i}" data-b="icon" data-search="false" data-sheet-title="Ícone do selo ${i + 1}">
                ${Object.entries(BENEFIT_ICONS).map(([k, v]) => html`<option value="${k}" data-hint="${v.hint}" ${k === b.icon ? 'selected' : ''}>${v.label}</option>`)}
              </select>
            </div>
            <div class="field">
              <div class="label"><label for="nw-b-title-${i}">Título *</label><span class="nw-count" data-bcount="title">${b.title.length}/${LIMITS.benefit_title}</span></div>
              <input class="input" id="nw-b-title-${i}" data-b="title" maxlength="${LIMITS.benefit_title}" value="${b.title}" placeholder="Ex.: Compra garantida">
            </div>
            <div class="field">
              <div class="label"><label for="nw-b-text-${i}">Texto *</label><span class="nw-count" data-bcount="text">${b.text.length}/${LIMITS.benefit_text}</span></div>
              <textarea class="textarea" id="nw-b-text-${i}" data-b="text" rows="2" maxlength="${LIMITS.benefit_text}">${b.text}</textarea>
            </div>
          </div>`
        )
      );
      $$('[data-b="icon"]', view).forEach((s) =>
        customSelect(s, { renderOption: (it) => benefitOpt(it), renderValue: (it) => html`<span class="nw-bi nw-bi--v" aria-hidden="true">${benefitIcon(it.value)}</span><span class="sel__label">${it.label}</span>` })
      );
    }
    $('[data-benefits]', view).addEventListener('input', (e) => {
      const f = e.target.closest('[data-b]');
      const box = e.target.closest('[data-benefit]');
      if (!f || !box) return;
      const i = Number(box.dataset.benefit);
      st.benefits[i][f.dataset.b] = f.value;
      if (f.dataset.b === 'icon') render($('[data-benefit-icon]', box), benefitIcon(f.value));
      else {
        const c = $(`[data-bcount="${f.dataset.b}"]`, box);
        if (c) c.textContent = `${f.value.length}/${f.dataset.b === 'title' ? LIMITS.benefit_title : LIMITS.benefit_text}`;
      }
      refresh();
    });

    /* ---------- Listas (faixa rolante e buscas) ---------- */
    const LISTS = {
      marquee: { label: 'Frase', max: LIMITS.marquee_max, maxLen: LIMITS.marquee_item, placeholder: 'Ex.: Montagem grátis em Ponte Nova', empty: 'Sem frases: a faixa não aparece na página inicial.' },
      popular_searches: { label: 'Busca', max: LIMITS.search_max, maxLen: LIMITS.search_item, placeholder: 'Ex.: Guarda-roupa', empty: 'Sem sugestões: a busca abre vazia.' },
    };
    function drawList(key, focus) {
      const cfg = LISTS[key];
      const items = st[key];
      const box = $(`[data-list="${key}"]`, view);
      const full = items.length >= cfg.max;
      render(
        box,
        html`${items.length
          ? html`<ol class="nw-list">${items.map(
              (t, i) => html`<li class="nw-list__item" data-i="${i}">
                <span class="nw-list__n" aria-hidden="true">${i + 1}</span>
                <label class="visually-hidden" for="nw-${key}-${i}">${cfg.label} ${i + 1}</label>
                <input class="input" id="nw-${key}-${i}" data-item="${i}" maxlength="${cfg.maxLen}" value="${t}">
                <span class="nw-list__acts">
                  <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="-1" aria-label="Mover ${cfg.label.toLowerCase()} ${i + 1} para cima" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp', 'icon-sm')}</button>
                  <button class="btn btn--ghost btn--sm btn--icon" type="button" data-move="1" aria-label="Mover ${cfg.label.toLowerCase()} ${i + 1} para baixo" ${i === items.length - 1 ? 'disabled' : ''}>${icon('arrowDown', 'icon-sm')}</button>
                  <button class="btn btn--ghost btn--sm btn--icon nw-list__del" type="button" data-del aria-label="Remover ${cfg.label.toLowerCase()} ${i + 1}">${icon('trash', 'icon-sm')}</button>
                </span>
              </li>`
            )}</ol>`
          : html`<p class="nw-list__empty">${icon('info', 'icon-sm')} ${cfg.empty}</p>`}
        <div class="nw-list__add">
          <label class="visually-hidden" for="nw-${key}-new">Nova ${cfg.label.toLowerCase()}</label>
          <input class="input" id="nw-${key}-new" data-new maxlength="${cfg.maxLen}" placeholder="${full ? `Limite de ${cfg.max} itens` : cfg.placeholder}" ${full ? 'disabled' : ''}>
          <button class="btn" type="button" data-add ${full ? 'disabled' : ''}>${icon('plus', 'icon-sm')} Adicionar</button>
        </div>
        <p class="nw-list__hint">${num(items.length)} de ${cfg.max} · até ${cfg.maxLen} caracteres cada · Enter adiciona</p>`
      );
      if (focus) $(focus, box)?.focus();
    }
    $$('[data-list]', view).forEach((box) => {
      const key = box.dataset.list;
      const cfg = LISTS[key];
      const add = () => {
        const input = $('[data-new]', box);
        const v = input.value.trim().replace(/\s+/g, ' ');
        if (!v) return input.focus();
        if (st[key].some((x) => x.trim().toLowerCase() === v.toLowerCase())) {
          toast('Este item já está na lista.', 'warning');
          return input.focus();
        }
        if (st[key].length >= cfg.max) return toast(`Limite de ${cfg.max} itens.`, 'warning');
        st[key].push(v);
        drawList(key, '[data-new]');
        refresh();
      };
      box.addEventListener('click', (e) => {
        if (e.target.closest('[data-add]')) return add();
        const li = e.target.closest('[data-i]');
        if (!li) return;
        const i = Number(li.dataset.i);
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const j = i + Number(mv.dataset.move);
          if (j < 0 || j >= st[key].length) return;
          [st[key][i], st[key][j]] = [st[key][j], st[key][i]];
          drawList(key, `[data-i="${j}"] [data-move="${mv.dataset.move}"]:not([disabled]), [data-i="${j}"] [data-item]`);
          refresh();
          return;
        }
        if (e.target.closest('[data-del]')) {
          st[key].splice(i, 1);
          drawList(key, st[key].length ? `[data-i="${Math.min(i, st[key].length - 1)}"] [data-del]` : '[data-new]');
          refresh();
        }
      });
      box.addEventListener('input', (e) => {
        const it = e.target.closest('[data-item]');
        if (!it) return;
        st[key][Number(it.dataset.item)] = it.value;
        refresh();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.closest('[data-new]')) {
          e.preventDefault();
          add();
        }
      });
    });

    /* ---------- Coleta e validação ---------- */
    const text = (name) => {
      const v = String(el(name)?.value ?? '').trim();
      return v === '' ? null : v;
    };
    const numberOf = (name) => {
      const v = String(el(name)?.value ?? '').trim().replace(',', '.');
      return v === '' ? null : Number(v);
    };
    function collect() {
      const errors = {};
      const slogan = String(el('slogan').value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.replace(/\s+$/g, ''))
        .join('\n')
        .replace(/^\n+|\n+$/g, '');
      const data = {
        name: text('name'),
        tagline: text('tagline'),
        slogan,
        logo_url: st.logo_url || null,
        logo_white_url: st.logo_white_url || null,
        primary_color: (text('primary_color') || '').toUpperCase(),
        accent_color: (text('accent_color') || '').toUpperCase(),
        default_pix_discount: numberOf('default_pix_discount'),
        default_installments: numberOf('default_installments'),
        default_radius_km: numberOf('default_radius_km'),
        support_whatsapp: normalizeWhatsapp(el('support_whatsapp').value),
        instagram: normalizeUrl(el('instagram').value, 'instagram'),
        facebook: normalizeUrl(el('facebook').value, 'facebook'),
        seo_title: text('seo_title'),
        seo_description: text('seo_description'),
        footer_legal: text('footer_legal'),
        benefits: st.benefits.map((b) => ({ icon: b.icon, title: b.title.trim(), text: b.text.trim() })),
        marquee: st.marquee.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
        popular_searches: st.popular_searches.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
      };
      if (data.primary_color && !data.primary_color.startsWith('#')) data.primary_color = `#${data.primary_color}`;
      if (data.accent_color && !data.accent_color.startsWith('#')) data.accent_color = `#${data.accent_color}`;

      if (!data.name || data.name.length < 2) errors.name = 'Informe o nome da rede.';
      if (!data.slogan) errors.slogan = 'Informe o slogan.';
      if (!HEX_RE.test(data.primary_color)) errors.primary_color = 'Use o formato #RRGGBB.';
      if (!HEX_RE.test(data.accent_color)) errors.accent_color = 'Use o formato #RRGGBB.';
      const pix = data.default_pix_discount;
      if (pix === null || Number.isNaN(pix) || pix < 0 || pix > 50) errors.default_pix_discount = 'Entre 0 e 50%.';
      else data.default_pix_discount = Math.round(pix * 100) / 100;
      const inst = data.default_installments;
      if (inst === null || !Number.isInteger(inst) || inst < 1 || inst > 24) errors.default_installments = 'Número inteiro de 1 a 24.';
      const rad = data.default_radius_km;
      if (rad === null || Number.isNaN(rad) || rad < 1 || rad > 500) errors.default_radius_km = 'Entre 1 e 500 km.';
      else data.default_radius_km = Math.round(rad * 100) / 100;
      if (data.support_whatsapp && !/^55\d{10,11}$/.test(data.support_whatsapp)) errors.support_whatsapp = 'Use 55 + DDD + número (12 ou 13 dígitos).';
      if (data.instagram && !validUrl(data.instagram)) errors.instagram = 'Endereço inválido.';
      if (data.facebook && !validUrl(data.facebook)) errors.facebook = 'Endereço inválido.';
      const benefitErrors = [];
      data.benefits.forEach((b, i) => {
        if (!b.title) benefitErrors.push([`nw-b-title-${i}`, 'Informe o título.']);
        if (!b.text) benefitErrors.push([`nw-b-text-${i}`, 'Informe o texto.']);
      });
      const listErrors = [];
      st.marquee.forEach((s, i) => !s.trim() && listErrors.push([`nw-marquee-${i}`, 'Frase vazia: escreva ou remova.']));
      st.popular_searches.forEach((s, i) => !s.trim() && listErrors.push([`nw-popular_searches-${i}`, 'Busca vazia: escreva ou remova.']));
      return { data, errors, extra: [...benefitErrors, ...listErrors] };
    }

    // marca erros de campos sem name (benefícios e listas)
    function markById(list) {
      $$('.error[data-for-id]', view).forEach((n) => n.remove());
      $$('[data-b][aria-invalid], [data-item][aria-invalid]', view).forEach((n) => n.removeAttribute('aria-invalid'));
      list.forEach(([id, msg]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.setAttribute('aria-invalid', 'true');
        const m = document.createElement('span');
        m.className = 'error';
        m.dataset.forId = id;
        m.id = `${id}-err`;
        m.textContent = msg;
        input.setAttribute('aria-describedby', m.id);
        (input.closest('.field') || input.closest('.nw-list__item'))?.appendChild(m);
      });
    }

    function showFieldErrors(errors) {
      $$('[name][aria-invalid]', form).forEach((n) => n.removeAttribute('aria-invalid'));
      $$('.error[data-for]', form).forEach((n) => n.remove());
      for (const [name, msg] of Object.entries(errors)) {
        const input = el(name);
        if (!input) continue;
        input.setAttribute('aria-invalid', 'true');
        const m = document.createElement('span');
        m.className = 'error';
        m.dataset.for = name;
        m.id = `nw-err-${name}`;
        m.textContent = msg;
        input.setAttribute('aria-describedby', m.id);
        input.closest('.field')?.appendChild(m);
      }
    }

    /* ---------- Seções alteradas ---------- */
    const sectionData = (data, keys) => JSON.stringify(keys.map((k) => data[k]));
    function dirtySections(data) {
      return SECTIONS.filter(([, , , keys]) => sectionData(data, keys) !== sectionData(baseline, keys));
    }
    const isDirty = () => dirtySections(collect().data).length > 0;

    /* ---------- Prévia e estado ---------- */
    function refresh() {
      const { data } = collect();
      // contadores
      $$('[data-counter]', view).forEach((c) => {
        const len = String(el(c.dataset.counter)?.value || '').length;
        const limit = Number(c.dataset.limit);
        c.textContent = `${len}/${limit}`;
        c.classList.toggle('is-over', len > limit);
      });
      // cores
      const p = HEX_RE.test(data.primary_color) ? data.primary_color : '#E01B26';
      const a = HEX_RE.test(data.accent_color) ? data.accent_color : '#F4802B';
      const onWhiteA = contrastWithWhite(a);
      const onInkA = contrastWithInk(a);
      const aInk = onWhiteA >= onInkA ? '#fff' : '#191919';
      const root = $('.nw', view);
      root.style.setProperty('--nw-p', p);
      root.style.setProperty('--nw-a', a);
      root.style.setProperty('--nw-a-ink', aInk);
      $$('[data-swatch]', view).forEach((sw) => sw.style.setProperty('--c', sw.dataset.swatch === 'primary_color' ? p : a));
      $$('[data-preset]', view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hex.toUpperCase() === (b.dataset.preset === 'primary_color' ? data.primary_color : data.accent_color))));
      const ratio = contrastWithWhite(p);
      const best = Math.max(onWhiteA, onInkA);
      const paintRatio = (name, r, okText, badText) => {
        const elr = $(`[data-contrast="${name}"]`, view);
        const good = r >= 4.5;
        elr.className = `nw-ratio ${good ? 'is-ok' : 'is-warn'}`;
        render(elr, html`${icon(good ? 'checkCircle' : 'alert', 'icon-xs')}<span>${good ? okText : badText}</span>`);
      };
      paintRatio('primary_color', ratio, `Texto branco: ${ratioText(ratio)} · boa leitura`, `Texto branco: ${ratioText(ratio)} · abaixo de 4,5:1, difícil de ler`);
      paintRatio('accent_color', best, `Selos com texto ${aInk === '#fff' ? 'branco' : 'escuro'}: ${ratioText(best)} · boa leitura`, `Selos: ${ratioText(best)} · abaixo de 4,5:1, difícil de ler`);
      // valores de exemplo com os padrões digitados (preço cheio no cartão; PIX com desconto)
      const pv = Number.isFinite(data.default_pix_discount) && data.default_pix_discount >= 0 && data.default_pix_discount <= 50 ? data.default_pix_discount : 0;
      const inst = Number.isInteger(data.default_installments) && data.default_installments >= 1 && data.default_installments <= 24 ? data.default_installments : 1;
      const radius = data.default_radius_km > 0 ? data.default_radius_km : 30;
      const pvText = `${num(pv)}% OFF no PIX`;
      $('[data-sample-price]', view).textContent = money(PREVIEW_PRICE * (1 - pv / 100));
      const stag = $('[data-sample-tag]', view);
      stag.textContent = pvText;
      stag.hidden = !pv;
      // prévia da loja
      $('[data-pv-ann]', view).textContent = `Entrega em até ${num(radius)} km · Parcele em até ${inst}x sem juros${pv ? ` · ${pvText}` : ''}`;
      $('[data-pv-logo]', view).src = data.logo_url ? mediaUrl(data.logo_url) : DEFAULT_LOGO;
      render(
        $('[data-pv-chips]', view),
        data.popular_searches.length ? html`${data.popular_searches.slice(0, 5).map((t) => html`<span>${t}</span>`)}` : html`<em>Busca sem sugestões</em>`
      );
      $('[data-pv-price]', view).textContent = `${money(PREVIEW_PRICE * (1 - pv / 100))}${pv ? ' no PIX' : ''}`;
      $('[data-pv-terms]', view).textContent = `${pv ? 'ou ' : ''}${inst}x de ${money(PREVIEW_PRICE / inst)} sem juros`;
      const tag = $('[data-pv-tag]', view);
      tag.textContent = pvText;
      tag.hidden = !pv;
      render(
        $('[data-pv-mq]', view),
        data.marquee.length ? data.marquee.map((t) => html`<span>${t}</span>`) : html`<em>Faixa oculta</em>`
      );
      render(
        $('[data-pv-ben]', view),
        data.benefits.map((b) => html`<span>${benefitIcon(b.icon)}<b>${b.title || '—'}</b></span>`)
      );
      render($('[data-pv-slogan]', view), (data.slogan || 'Sua casa,\nsempre atual.').split('\n').map((l, i) => html`${i ? html`<br>` : ''}${l}`));
      $('[data-pv-legal]', view).textContent = data.footer_legal || '';
      $$('.nw-tile.is-brand', view).forEach((t) => (t.style.background = p));
      // raio
      const cap = data.default_radius_km;
      const over = cap > 0 ? stores.filter((s) => Number(s.delivery_radius_km) > cap) : [];
      render(
        $('[data-cap-warning]', view),
        over.length
          ? html`<div class="alert alert--warning nw-cap">${icon('alert')}<div>
              <strong>${num(over.length)} ${over.length === 1 ? 'loja entrega' : 'lojas entregam'} hoje além de ${num(cap)} km.</strong> O raio delas continua como está, mas a equipe da loja só conseguirá salvar a configuração de entrega depois de reduzi-lo.
              <ul class="nw-cap__list">${over.map((s) => html`<li>${storeMark(s, 20)}<span>${ctx.storeShort?.(s) || s.name}</span><b>${num(s.delivery_radius_km)} km</b></li>`)}</ul>
            </div></div>`
          : ''
      );
      // whatsapp
      const wa = data.support_whatsapp;
      const waHint = $('[data-wa-hint]', view);
      if (wa && /^55\d{10,11}$/.test(wa)) {
        render(waHint, html`Será salvo como ${phone(wa)} · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">testar ${icon('external', 'icon-xs')}</a>`);
      } else waHint.textContent = 'Só números: 55 + DDD + número.';
      // seo
      $('[data-serp-name]', view).textContent = data.name || 'Atual Móveis';
      $('[data-serp-title]', view).textContent = data.seo_title || data.name || 'Atual Móveis';
      $('[data-serp-desc]', view).textContent = data.seo_description || 'Sem descrição: o Google escolherá um trecho da página.';
      // seções alteradas: pontos nas abas + barra de salvar
      const dirty = dirtySections(data);
      SECTIONS.forEach(([id]) => {
        const on = dirty.some((d) => d[0] === id);
        $(`[data-dot="${id}"]`, view).hidden = !on;
        $(`[data-dot-sr="${id}"]`, view).textContent = on ? ' (alterado)' : '';
      });
      bar?.setDirty(dirty.map(([id, label]) => SECTION_LONG[id] || label));
      return dirty.length > 0;
    }

    function fill(row) {
      el('name').value = row.name || '';
      el('tagline').value = row.tagline || '';
      el('slogan').value = row.slogan || '';
      el('primary_color').value = row.primary_color || '';
      el('accent_color').value = row.accent_color || '';
      $('[data-pick="primary_color"]', view).value = HEX_RE.test(row.primary_color) ? row.primary_color.toLowerCase() : '#e01b26';
      $('[data-pick="accent_color"]', view).value = HEX_RE.test(row.accent_color) ? row.accent_color.toLowerCase() : '#f4802b';
      el('default_pix_discount').value = row.default_pix_discount ?? '';
      el('default_installments').value = row.default_installments ?? '';
      el('default_radius_km').value = row.default_radius_km ?? '';
      el('support_whatsapp').value = row.support_whatsapp || '';
      el('instagram').value = row.instagram || '';
      el('facebook').value = row.facebook || '';
      el('seo_title').value = row.seo_title || '';
      el('seo_description').value = row.seo_description || '';
      el('footer_legal').value = row.footer_legal || '';
      st.logo_url = row.logo_url || null;
      st.logo_white_url = row.logo_white_url || null;
      st.benefits = normalizeBenefits(row.benefits);
      st.marquee = Array.isArray(row.marquee) ? row.marquee.map(String) : [];
      st.popular_searches = Array.isArray(row.popular_searches) ? row.popular_searches.map(String) : [];
      drawLogo('logo_url');
      drawLogo('logo_white_url');
      drawBenefits();
      drawList('marquee');
      drawList('popular_searches');
      showFieldErrors({});
      markById([]);
    }

    function dropUnsavedUploads(keep = []) {
      for (const url of [...uploaded]) {
        if (keep.includes(url)) continue;
        uploaded.delete(url);
        removeImage(url).catch(() => {});
      }
    }

    async function paintMeta() {
      const meta = $('[data-meta]', view);
      if (!meta || !orig.updated_at) return;
      const who = orig.updated_by === ctx.user.id ? 'você' : editor;
      render(meta, html`${icon('clock', 'icon-xs')}<span>Atualizado <span title="${datetime(orig.updated_at)}">${relTime(orig.updated_at)}</span>${who ? ` por ${who}` : ''} · vale para as ${num(stores.length)} lojas</span>`);
    }
    async function loadEditor() {
      editor = '';
      if (!orig.updated_by || orig.updated_by === ctx.user.id) return paintMeta();
      try {
        const p = await q(sb.from('profiles').select('full_name, email').eq('user_id', orig.updated_by).maybeSingle());
        editor = p?.full_name || p?.email || '';
      } catch {
        editor = '';
      }
      if (!disposed) paintMeta();
    }

    // o erro de um campo some assim que a pessoa começa a corrigi-lo
    function clearFieldError(target) {
      const input = target?.dataset?.pick ? el(target.dataset.pick) : target;
      if (!input || input.getAttribute('aria-invalid') !== 'true') return;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      const box = input.closest('.field') || input.closest('.nw-list__item');
      const sel = [input.name && `.error[data-for="${window.CSS.escape(input.name)}"]`, input.id && `.error[data-for-id="${window.CSS.escape(input.id)}"]`].filter(Boolean).join(', ');
      if (box && sel) $$(sel, box).forEach((n) => n.remove());
    }

    /* ---------- Salvar / descartar (barra do ui.js) ---------- */
    let bar = null;
    async function save() {
      const { data, errors, extra } = collect();
      showFieldErrors(errors);
      markById(extra);
      const firstName = Object.keys(errors)[0];
      if (firstName || extra.length) {
        const target = firstName ? el(firstName) : document.getElementById(extra[0][0]);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.focus({ preventScroll: true });
        toast('Revise os campos destacados.', 'warning');
        return false;
      }
      if (!isDirty()) {
        toast('Nenhuma alteração para salvar.', 'info');
        return true;
      }
      if (data.default_radius_km < Number(orig.default_radius_km)) {
        const over = stores.filter((s) => Number(s.delivery_radius_km) > data.default_radius_km);
        const ok = await confirmDialog({
          title: 'Reduzir o raio máximo da rede?',
          message: `O novo teto passa a ser ${num(data.default_radius_km)} km para toda a rede${over.length ? `; ${over.length} ${over.length === 1 ? 'loja está' : 'lojas estão'} acima dele hoje` : ''}. As lojas não conseguirão salvar um raio maior que isso.`,
          confirmLabel: 'Reduzir raio',
          tone: 'warn',
          icon: 'truck',
        });
        if (!ok) return false;
      }
      // normaliza o que foi digitado (ex.: WhatsApp sem 55, @perfil)
      el('support_whatsapp').value = data.support_whatsapp || '';
      el('instagram').value = data.instagram || '';
      el('facebook').value = data.facebook || '';
      el('primary_color').value = data.primary_color;
      el('accent_color').value = data.accent_color;
      try {
        const saved = await q(
          sb
            .from('network_settings')
            .update({ ...data, updated_at: new Date().toISOString(), updated_by: ctx.user.id })
            .eq('id', 1)
            .select('*')
            .single()
        );
        // apaga do storage as logos substituídas (só arquivos do nosso bucket)
        for (const key of ['logo_url', 'logo_white_url']) {
          if (orig[key] && orig[key] !== saved[key] && fromOurBucket(orig[key])) removeImage(orig[key]).catch(() => {});
        }
        uploaded.clear();
        orig = saved;
        fill(saved);
        baseline = collect().data;
        refresh();
        paintMeta();
        toast('A loja virtual já usa os novos dados.', 'success', 4200, { title: 'Configurações da rede salvas' });
        return true;
      } catch (err) {
        toastError(err);
        return false;
      }
    }
    async function discard() {
      const ok = await confirmDialog({
        title: 'Descartar as alterações?',
        message: 'Os campos voltam aos valores salvos. Logos enviadas e ainda não salvas serão apagadas.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Continuar editando',
        danger: true,
      });
      if (ok) {
        dropUnsavedUploads();
        fill(orig);
        toast('Alterações descartadas.', 'info');
      }
      refresh();
    }

    fill(orig);
    baseline = collect().data;
    let narrow = false;
    try {
      narrow = matchMedia('(max-width: 600px)').matches;
    } catch {
      narrow = false;
    }
    bar = saveBar({
      form: $('[data-proxy]', view),
      container: $('.nw', view),
      label: narrow ? 'Salvar' : 'Salvar alterações',
      title: narrow ? 'Alterações' : 'Alterações não salvas',
      onSave: save,
      onDiscard: discard,
      ctx,
    });
    refresh();
    loadEditor();

    form.addEventListener('input', (e) => clearFieldError(e.target), true);
    form.addEventListener('change', (e) => clearFieldError(e.target), true);
    form.addEventListener('input', (e) => {
      if (e.target.closest('[data-b], [data-item], [data-new], [data-pick], [data-file]')) return;
      refresh();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      $('.savebar [data-save]', view)?.click();
    });

    // dica do Tetim: descrição para o Google
    if (!orig.seo_description)
      render(
        $('[data-tip]', view),
        tip({
          id: 'network-seo-description',
          text: 'A loja virtual está sem descrição para o Google. Com 120 a 160 caracteres sobre a rede, mais gente clica no resultado.',
          action: {
            label: 'Escrever descrição',
            onClick: () => {
              $('#nw-seo', view)?.scrollIntoView({ block: 'center' });
              el('seo_description').focus({ preventScroll: true });
            },
          },
        })
      );

    /* ---------- Abas acompanham a rolagem ---------- */
    function setActiveTab(id) {
      $$('[data-goto]', view).forEach((b) => {
        const on = b.dataset.goto === id;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
        if (on) {
          const tabs = $('[data-tabs]', view);
          const l = b.offsetLeft - tabs.clientWidth / 2 + b.clientWidth / 2;
          tabs.scrollTo?.({ left: Math.max(0, l), behavior: 'auto' });
        }
      });
    }
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          const vis = entries.filter((en) => en.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
          if (vis) setActiveTab(vis.target.dataset.section);
        },
        { rootMargin: '-140px 0px -55% 0px' }
      );
      $$('[data-section]', view).forEach((s) => io.observe(s));
    }

    return () => {
      disposed = true;
      io?.disconnect();
      // ao sair sem salvar, não deixa arquivos órfãos no storage
      dropUnsavedUploads();
    };
  },
};

const CSS = `
/* cores fixas da loja virtual (as prévias imitam a loja, que é sempre clara) */
.nw { --sf-paper: #fff; --sf-tile: #f2f2f2; --sf-search: #f4f4f4; display: flex; flex-direction: column; gap: 16px; }
.nw-tabs { z-index: calc(var(--z-sticky) + 1); box-shadow: var(--sh-card), 0 -10px 0 1px var(--bg); }
.nw-tabs .ptab { border: 0; background: none; cursor: pointer; }
.nw-tabs .ptab.is-on { background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
.nw-grid { display: grid; grid-template-columns: minmax(0, 1fr) 356px; gap: 18px; align-items: start; }
.nw-main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.nw-main [data-tip]:empty { display: none; }
.nw-sec { scroll-margin-top: calc(var(--topbar-h) + 72px); }
.nw-sec:focus { outline: none; }
.nw-sec .card__head { display: flex; align-items: flex-start; gap: 12px; }
.nw-sec__ico { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--surface-3); color: var(--muted); flex: none; }
.nw .label label { font: inherit; color: inherit; }
.nw-count { font-size: 12px; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
.nw-count.is-over { color: var(--warn-fg); font-weight: 700; }
.nw-slogan-in { min-height: 64px; }
/* logos */
.nw-logos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.nw-logo { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.nw-logo__l { display: flex; flex-direction: column; gap: 1px; }
.nw-logo__l strong { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.nw-logo__l span { font-size: 12.5px; color: var(--muted); }
.nw-logo__tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-radius: 14px; }
.nw-logo.is-over .nw-logo__tiles { outline: 2px dashed var(--accent); outline-offset: 4px; }
.nw-tile { position: relative; display: flex; align-items: center; justify-content: center; height: 112px; padding: 24px 16px 22px; border: 1px solid var(--line); border-radius: 12px; background: var(--sf-paper); }
.nw-tile.is-dark { border-color: #141414; background: #141414; }
.nw-tile.is-brand { border-color: transparent; }
.nw-tile img { max-width: 100%; max-height: 44px; width: auto; height: auto; object-fit: contain; }
.nw-tile span { position: absolute; left: 9px; bottom: 7px; font-size: 10.5px; font-weight: 600; color: #6f6355; }
.nw-tile.is-dark span, .nw-tile.is-brand span { color: rgba(255, 255, 255, 0.72); }
.nw-tile.is-main::after { content: 'Uso principal'; position: absolute; right: 8px; top: 7px; padding: 0 7px; border-radius: 999px; background: #fdeceb; color: #b8182b; font-size: 10.5px; font-weight: 700; line-height: 18px; }
.nw-tile.is-dark.is-main::after, .nw-tile.is-brand.is-main::after { background: rgba(255, 255, 255, 0.16); color: #fff; }
.nw-logo__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nw-logo__state { font-size: 12.5px; color: var(--muted); }
.nw-logo__state.is-new { color: var(--warn-fg); font-weight: 600; }
/* cores */
.nw-color { display: flex; gap: 8px; }
.nw-swatch { position: relative; flex: none; width: 46px; height: 40px; border-radius: var(--r-md); background: var(--c, #e01b26); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14), inset 0 -6px 10px rgba(0, 0, 0, 0.12), var(--sh-btn); cursor: pointer; }
.nw-swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.nw-swatch:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.nw-color .input { text-transform: uppercase; letter-spacing: .04em; }
.nw-presets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.nw-preset { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--c); cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.16), inset 0 -3px 6px rgba(0, 0, 0, 0.14); transition: transform var(--dur-1) var(--ease-out); }
.nw-preset:hover { transform: scale(1.08); }
.nw-preset[aria-pressed='true'] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--select), inset 0 -3px 6px rgba(0, 0, 0, 0.14); }
.nw-ratio { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 3px 9px 3px 7px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.nw-ratio.is-ok { background: var(--ok-bg); color: var(--ok-fg); }
.nw-ratio.is-warn { background: var(--warn-bg); color: var(--warn-fg); }
.nw-sample { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: var(--sf-paper); border: 1px solid var(--line); }
.nw-sample__l { font: 600 11px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: #6f6355; margin-right: 4px; }
.nw-sample__btn, .nw-sample__ghost { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; font: 700 13px/1 Urbanist, var(--font-ui); }
.nw-sample__btn { background: var(--nw-p); color: #fff; }
.nw-sample__ghost { border: 1.5px solid var(--nw-p); color: var(--nw-p); }
.nw-sample__price { font: 800 18px/1 Urbanist, var(--font-ui); color: var(--nw-p); font-variant-numeric: tabular-nums; }
.nw-sample__tag { padding: 4px 9px; border-radius: 999px; background: var(--nw-a); color: var(--nw-a-ink); font: 700 11.5px/1 var(--font-ui); }
/* padrões */
.nw-callout { margin: 0; }
.nw-callout strong { margin-bottom: 2px; }
.nw-cap { margin: 0; }
.nw-cap__list { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
.nw-cap__list li { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 10px 0 5px; border-radius: 999px; background: var(--raised); border: 1px solid var(--warn-line); font-size: 12.5px; color: var(--ink); }
.nw-cap__list b { color: var(--warn-fg); font-weight: 700; }
/* contato */
.nw-iin { position: relative; }
.nw-iin > .icon-sm { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.nw-iin .input { padding-left: 36px; }
[data-wa-hint] a { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; white-space: nowrap; }
/* google */
.nw-serp { margin-top: 8px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--sf-paper); font-family: Arial, sans-serif; max-width: 640px; }
.nw-serp__site { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.nw-serp__fav { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--sf-search); flex: none; }
.nw-serp__site > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.nw-serp__site b { font-size: 14px; font-weight: 400; color: #202124; }
.nw-serp__site b + span { font-size: 12px; color: #4d5156; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-serp__title { margin: 2px 0; font-size: 19px; line-height: 1.3; color: #1a0dab; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nw-serp__desc { font-size: 13.5px; line-height: 1.55; color: #4d5156; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* benefícios */
.nw-benefits { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.nw-benefit { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); min-width: 0; }
.nw-benefit__head { display: flex; align-items: center; gap: 10px; }
.nw-benefit__icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--raised); border: 1px solid var(--line); color: var(--nw-p); }
.nw-benefit__icon svg { width: 22px; height: 22px; }
.nw-benefit__n { font: 600 11px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.nw-benefit .select, .nw-benefit .sel__trigger { margin-left: auto; width: auto; min-width: 150px; }
.nw-benefit .textarea { min-height: 62px; }
.nw-bi svg { width: 18px; height: 18px; }
.nw-bi--v { display: inline-grid; place-items: center; color: var(--muted); }
/* listas */
.nw-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.nw-list__item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nw-list__item .error { flex-basis: 100%; padding-left: 34px; }
.nw-list__n { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--surface-3); font-size: 12px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.nw-list__item .input { flex: 1; min-width: 0; }
.nw-list__acts { display: inline-flex; gap: 2px; }
.nw-list__del:hover { color: var(--bad-fg); background: var(--bad-bg); }
.nw-list__add { display: flex; gap: 8px; margin-top: 12px; padding: 10px; border: 1px dashed var(--line-strong); border-radius: 14px; background: var(--surface-2); }
.nw-list__add .input { flex: 1; min-width: 0; }
.nw-list__empty { display: flex; align-items: center; gap: 8px; margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); color: var(--muted); font-size: 13px; }
.nw-list__hint { margin: 8px 0 0; font-size: 12.5px; color: var(--muted); }
/* prévia */
.nw-side { position: sticky; top: calc(var(--topbar-h) + 74px); display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.nw-pv { overflow: hidden; }
.nw-pv__head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px 12px; }
.nw-pv__head .card__title .icon-sm { color: var(--muted); }
.nw-pv__toggle { display: none; }
.nw-pv__body { padding: 0 14px 14px; }
.nw-pv__meta { display: flex; align-items: flex-start; gap: 6px; margin: 12px 4px 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
.nw-pv__meta .icon-xs { flex: none; margin-top: 2px; }
.nw-browser { border-radius: 14px; overflow: hidden; border: 1px solid var(--line-strong); background: var(--sf-paper); box-shadow: 0 14px 30px -18px rgba(30, 20, 10, 0.35); }
.nw-browser__bar { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; background: #f1ece4; border-bottom: 1px solid #e5ddd1; }
.nw-browser__bar i { width: 8px; height: 8px; border-radius: 50%; background: #d6ccbf; }
.nw-browser__url { flex: 1; min-width: 0; margin-left: 8px; height: 18px; padding: 0 8px; border-radius: 999px; background: var(--sf-paper); font: 500 10px/18px var(--font-ui); color: #6f6355; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nw-site { font-family: Urbanist, 'Helvetica Neue', Arial, sans-serif; color: #121212; background: var(--sf-paper); }
.nw-site__ann { padding: 6px 10px; background: var(--nw-p); color: #fff; font-size: 10px; font-weight: 600; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nw-site__hdr { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #eee; }
.nw-site__hdr img { height: 18px; width: auto; max-width: 110px; object-fit: contain; }
.nw-site__search { display: inline-flex; align-items: center; gap: 4px; flex: 1; min-width: 0; height: 22px; padding: 0 8px; border-radius: 999px; background: var(--sf-search); color: #707070; font-size: 10px; }
.nw-site__search .icon-xs { width: 10px; height: 10px; }
.nw-site__ic { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid #292725; flex: none; }
.nw-site__chips { display: flex; gap: 5px; padding: 8px 12px 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
.nw-site__chips span { flex: none; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(0, 0, 0, 0.14); font-size: 9.5px; font-weight: 600; color: #3a3332; white-space: nowrap; }
.nw-site__chips em, .nw-site__mq em { font-size: 10px; color: #8f8170; }
.nw-site__prod { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; padding: 12px; }
.nw-site__img { display: grid; place-items: center; height: 92px; border-radius: 8px; background: var(--sf-tile); color: #9c8b74; }
.nw-site__img .icon { width: 40px; height: 40px; stroke-width: 1.2; }
.nw-site__info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nw-site__name { font-size: 11.5px; font-weight: 600; color: #121212; }
.nw-site__price { font-size: 15px; font-weight: 800; color: var(--nw-p); font-variant-numeric: tabular-nums; }
.nw-site__terms { font-size: 9.5px; color: rgba(0, 0, 0, 0.7); }
.nw-site__row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
.nw-site__tag { padding: 3px 7px; border-radius: 999px; background: var(--nw-a); color: var(--nw-a-ink); font-size: 9px; font-weight: 700; white-space: nowrap; }
.nw-site__buy { margin-left: auto; padding: 5px 12px; border-radius: 999px; background: var(--nw-p); color: #fff; font-size: 10.5px; font-weight: 700; }
.nw-site__mq { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 1px solid #eee; border-bottom: 1px solid #eee; overflow: hidden; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 80%, transparent); mask-image: linear-gradient(90deg, #000 80%, transparent); }
.nw-site__mq span { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; color: #707070; }
.nw-site__mq span + span::before { content: ''; width: 12px; height: 11px; background: url('/assets/brand/atual-mark.svg') center / contain no-repeat; filter: grayscale(1); opacity: .55; }
.nw-site__ben { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: #fbf3ef; color: #3a3332; }
.nw-site__ben span { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; text-align: center; }
.nw-site__ben span + span { border-left: 1px solid rgba(58, 51, 50, 0.14); }
.nw-site__ben svg { width: 16px; height: 16px; color: var(--nw-p); }
.nw-site__ben b { font-size: 7.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.nw-site__foot { display: flex; flex-direction: column; gap: 8px; padding: 14px 12px 12px; background: #eaeaea; }
.nw-site__slogan { font-size: 19px; font-weight: 400; line-height: 1.15; color: var(--nw-p); letter-spacing: -0.2px; }
.nw-site__legal { font-size: 8.5px; color: rgba(0, 0, 0, 0.6); line-height: 1.4; }
.nw-site__legal:empty { display: none; }
/* modo escuro: amostras que imitam a loja continuam claras, só a moldura acompanha */
:root[data-theme='dark'] .nw-serp { background: #202124; border-color: var(--line); }
:root[data-theme='dark'] .nw-serp__title { color: #8ab4f8; }
:root[data-theme='dark'] .nw-serp__desc, :root[data-theme='dark'] .nw-serp__site b + span { color: #bdc1c6; }
:root[data-theme='dark'] .nw-serp__site b { color: #e8eaed; }
:root[data-theme='dark'] .nw-serp__fav { background: #303134; }
:root[data-theme='dark'] .nw-sample { border-color: var(--line-strong); }
:root[data-theme='dark'] .nw-browser { border-color: var(--line-strong); box-shadow: 0 14px 30px -18px rgba(0, 0, 0, 0.8); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .nw-serp { background: #202124; border-color: var(--line); }
  :root:not([data-theme='light']) .nw-serp__title { color: #8ab4f8; }
  :root:not([data-theme='light']) .nw-serp__desc, :root:not([data-theme='light']) .nw-serp__site b + span { color: #bdc1c6; }
  :root:not([data-theme='light']) .nw-serp__site b { color: #e8eaed; }
  :root:not([data-theme='light']) .nw-serp__fav { background: #303134; }
  :root:not([data-theme='light']) .nw-sample { border-color: var(--line-strong); }
  :root:not([data-theme='light']) .nw-browser { border-color: var(--line-strong); box-shadow: 0 14px 30px -18px rgba(0, 0, 0, 0.8); }
}

@media (max-width: 1180px) {
  .nw-grid { grid-template-columns: minmax(0, 1fr); }
  .nw-side { position: static; order: -1; }
  .nw-pv__head { padding-bottom: 14px; }
  .nw-pv__toggle { display: inline-flex; }
  .nw-pv__body { display: none; }
  .nw-pv__body.is-open { display: block; }
  .nw-browser { max-width: 420px; margin: 0 auto; }
}
@media (max-width: 860px) {
  .nw-benefits, .nw-logos { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 767px) {
  .nw-tabs { top: calc(var(--appbar-h) + env(safe-area-inset-top) + 6px); margin: 0 -4px; }
  .nw-sec .card__head { padding: 14px 16px; }
  .nw-sec__ico { display: none; }
  .nw-list__add { padding: 8px; }
  .nw-list__add .btn { padding: 0 12px; }
  .nw-list__n { display: none; }
  .nw-list__item { gap: 4px; }
  .nw-list__item .error { padding-left: 0; }
  .nw-tile { height: 100px; }
  .nw-benefit__head { flex-wrap: wrap; }
  .nw-benefit .select, .nw-benefit .sel__trigger { flex: 1 1 100%; margin-left: 0; }
  .nw-sample { gap: 8px; }
}
@media (max-width: 600px) {
  .nw .savebar__txt span { display: none; }
  .nw .savebar .btn--ghost { padding: 0 10px; }
}
`;
