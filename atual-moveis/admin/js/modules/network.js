// Configurações da rede (linha única network_settings, id = 1) — só administradores da rede.
// Identidade, logos, cores, padrões das lojas (PIX, parcelas e o raio MÁXIMO de entrega,
// que limita todas as lojas pelo gatilho stores_guard), contato, SEO, rodapé,
// benefícios (sempre 4), faixa rolante e buscas populares da loja virtual.
import { sb, q, uploadImage, removeImage, mediaUrl } from '../api.js';
import { html, render, $, $$, raw, icon, toast, toastError, withBusy, loading, errorBlock, injectStyle, num, phone, datetime, confirmDialog } from '../ui.js';

const CSS = `
.netcfg { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 24px; align-items: start; }
.netcfg__index { position: sticky; top: calc(var(--topbar-h) + 20px); display: flex; flex-direction: column; gap: 2px; }
.netcfg__index button { padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--muted); font-weight: 600; text-align: left; cursor: pointer; }
.netcfg__index button:hover { background: rgba(0, 0, 0, 0.05); color: var(--ink); }
.netcfg__index button.is-active { background: #fff; color: var(--ink); box-shadow: inset 2px 0 0 var(--accent); }
.netcfg__main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.netcfg__main > .card { scroll-margin-top: calc(var(--topbar-h) + 16px); }
.netcfg .card__head { flex-wrap: wrap; row-gap: 4px; }
.netcfg .card__head p { flex-basis: 100%; }
.netcfg .textarea { min-height: 76px; }
.netcfg__counter { margin-left: auto; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.netcfg__counter.is-over { color: var(--warning); font-weight: 700; }
.netcfg__labelrow { display: flex; align-items: baseline; gap: 8px; }
.netcfg__labelrow label { font-size: 12.5px; font-weight: 600; color: var(--ink); }
.netcfg__slogan { padding: 18px 20px; border-radius: var(--radius-sm); background: #141414; color: #fff; font-size: 22px; font-weight: 700; line-height: 1.15; min-height: 70px; }
.netcfg__slogan small { display: block; margin-bottom: 6px; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #9a9a9a; }

.netcfg-logo { display: flex; flex-direction: column; gap: 10px; }
.netcfg-logo__tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.netcfg-logo__tile { position: relative; display: flex; align-items: center; justify-content: center; height: 124px; padding: 26px 18px 24px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.netcfg-logo__tile.is-dark { border-color: #141414; background: #141414; }
.netcfg-logo__tile.is-brand { border-color: transparent; background: var(--netcfg-p, #e01b26); }
.netcfg-logo__tile.is-brand span { color: rgba(255, 255, 255, 0.85); }
.netcfg-logo__tile img { max-width: 100%; max-height: 50px; width: auto; height: auto; object-fit: contain; }
.netcfg-logo__tile span { position: absolute; left: 8px; bottom: 6px; font-size: 10.5px; font-weight: 600; color: var(--muted); }
.netcfg-logo__tile.is-dark span { color: #9a9a9a; }
.netcfg-logo__tile.is-main::after { content: 'Uso principal'; position: absolute; right: 8px; top: 6px; padding: 0 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10.5px; font-weight: 700; line-height: 18px; }
.netcfg-logo__tile.is-dark.is-main::after, .netcfg-logo__tile.is-brand.is-main::after { background: rgba(255, 255, 255, 0.16); color: #fff; }
.netcfg-logo.is-over .netcfg-logo__tiles { outline: 2px dashed var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
.netcfg-logo__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.netcfg-logo__state { font-size: 12px; color: var(--muted); }

.netcfg-color { display: flex; gap: 8px; }
.netcfg-color input[type='color'] { flex: none; width: 46px; height: 38px; padding: 3px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
.netcfg-color .input { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; }
.netcfg-preview { --p: #e01b26; --a: #f4802b; display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.netcfg-preview__sw { display: flex; gap: 10px; flex-wrap: wrap; }
.netcfg-preview__sw div { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.netcfg-preview__sw i { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(0, 0, 0, 0.08); }
.netcfg-preview__card { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px; border-radius: var(--radius-sm); background: #fff; border: 1px solid var(--line); }
.netcfg-preview__price { display: flex; flex-direction: column; margin-right: auto; }
.netcfg-preview__price strong { font-size: 20px; color: var(--p); line-height: 1.1; }
.netcfg-preview__price span { font-size: 12px; color: var(--muted); }
.netcfg-preview__tag { padding: 3px 9px; border-radius: 999px; background: var(--a); color: #191919; font-size: 11.5px; font-weight: 700; }
.netcfg-preview__btn { display: inline-flex; align-items: center; height: 38px; padding: 0 16px; border-radius: 999px; background: var(--p); color: #fff; font-weight: 700; }
.netcfg-preview__ghost { display: inline-flex; align-items: center; height: 38px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--p); color: var(--p); font-weight: 700; }
.netcfg-preview__strip { padding: 8px 14px; border-radius: var(--radius-sm); background: var(--p); color: #fff; font-size: 12.5px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.netcfg-cap { display: flex; flex-direction: column; gap: 8px; }
.netcfg-cap ul { display: flex; flex-wrap: wrap; gap: 6px; }

.netcfg-serp { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; font-family: Arial, sans-serif; }
.netcfg-serp__url { font-size: 12.5px; color: #4d5156; }
.netcfg-serp__title { margin: 2px 0; font-size: 18px; line-height: 1.3; color: #1a0dab; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.netcfg-serp__desc { font-size: 13.5px; line-height: 1.5; color: #4d5156; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.netcfg-benefits { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.netcfg-benefit { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.netcfg-benefit__head { display: flex; align-items: center; gap: 10px; }
.netcfg-benefit__icon { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: #fff; border: 1px solid var(--line); color: var(--ink); }
.netcfg-benefit__icon svg { width: 22px; height: 22px; }
.netcfg-benefit__n { font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
.netcfg-benefit .select { margin-left: auto; width: auto; min-width: 150px; }
.netcfg-benefit .textarea { min-height: 60px; }

.netcfg-list { display: flex; flex-direction: column; gap: 6px; counter-reset: li; }
.netcfg-list__item { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.netcfg-list__item .error { flex-basis: 100%; padding-left: 28px; font-size: 12px; color: var(--danger); }
.netcfg-list__n { flex: none; width: 22px; font-size: 12px; font-weight: 700; color: var(--faint); text-align: right; font-variant-numeric: tabular-nums; }
.netcfg-list__item .input { flex: 1; min-width: 0; }
.netcfg-list__add { display: flex; gap: 6px; margin-top: 10px; padding-left: 28px; }
.netcfg-list__add .input { flex: 1; min-width: 0; }
.netcfg-up svg { transform: rotate(180deg); }
.netcfg-list__empty { padding: 12px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: 12.5px; text-align: center; }
.netcfg-marquee { display: flex; gap: 18px; overflow: hidden; padding: 9px 14px; border-radius: var(--radius-sm); background: #141414; color: #fff; font-size: 12.5px; font-weight: 600; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
.netcfg-marquee span::before { content: '✦'; margin-right: 18px; color: var(--accent); }
.netcfg-marquee span:first-child::before { content: none; }
.netcfg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.netcfg-chips span { padding: 4px 12px; border: 1px solid var(--line-strong); border-radius: 999px; background: #fff; font-size: 12.5px; font-weight: 600; }

.netcfg__bar { position: sticky; bottom: 0; z-index: 15; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 4px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(8px); box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.06); }
.netcfg__status { display: flex; align-items: center; gap: 8px; margin-right: auto; font-size: 12.5px; color: var(--muted); }
.netcfg__status.is-dirty { color: var(--warning); font-weight: 700; }
.netcfg__status.is-dirty::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--orange); }
@media (max-width: 1100px) {
  .netcfg { grid-template-columns: minmax(0, 1fr); }
  .netcfg__index { display: none; }
}
@media (max-width: 860px) {
  .netcfg-benefits { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .netcfg-logo__tiles { grid-template-columns: 1fr; }
  .netcfg-logo__tile { height: 112px; }
  .netcfg-list__add { padding-left: 0; }
  .netcfg__bar { padding: 10px 12px; }
  .netcfg__bar .btn { flex: 1; }
  .netcfg__status { flex-basis: 100%; }
  .netcfg-benefit__head { flex-wrap: wrap; }
  .netcfg-benefit .select { flex: 1 1 100%; margin-left: 0; }
}
`;

const DEFAULT_LOGO = '/assets/brand/atual-logo-horizontal.svg';
const DEFAULT_LOGO_WHITE = '/assets/brand/atual-logo-horizontal-white.svg';
const HEX_RE = /^#[0-9a-f]{6}$/i;
const MAX_FILE = 8 * 1024 * 1024;

const BENEFIT_ICONS = {
  shield: { label: 'Escudo (garantia)', svg: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>' },
  truck: { label: 'Caminhão (entrega)', svg: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>' },
  card: { label: 'Cartão (pagamento)', svg: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>' },
  chat: { label: 'Conversa (atendimento)', svg: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>' },
};
const benefitIcon = (name) =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(BENEFIT_ICONS[name] || BENEFIT_ICONS.shield).svg}</svg>`);
const EMPTY_BENEFITS = [
  { icon: 'shield', title: '', text: '' },
  { icon: 'truck', title: '', text: '' },
  { icon: 'card', title: '', text: '' },
  { icon: 'chat', title: '', text: '' },
];

const SECTIONS = [
  ['identity', 'Identidade'],
  ['logos', 'Logos'],
  ['colors', 'Cores'],
  ['defaults', 'Padrões das lojas'],
  ['contact', 'Contato e redes'],
  ['seo', 'SEO'],
  ['benefits', 'Benefícios'],
  ['marquee', 'Faixa rolante'],
  ['searches', 'Buscas populares'],
  ['footer', 'Rodapé'],
];

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

const digits = (v) => String(v || '').replace(/\D/g, '');
const fromOurBucket = (url) => /\/storage\/v1\/object\/public\/media\//.test(String(url || ''));

function hexToRgb(hex) {
  const m = HEX_RE.exec(hex || '');
  if (!m) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Contraste WCAG entre texto branco e a cor
function contrastWithWhite(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 21;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05);
}

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
      render(view, errorBlock('Somente a administração da rede altera estas configurações.'));
      return;
    }
    render(view, loading('Carregando configurações…'));

    let orig;
    let stores = [];
    try {
      const [row, list] = await Promise.all([
        q(sb.from('network_settings').select('*').eq('id', 1).single()),
        q(sb.from('stores').select('id, name, delivery_radius_km, active').order('sort_order').order('name')),
      ]);
      orig = row;
      stores = list || [];
    } catch (e) {
      render(view, errorBlock(e));
      return;
    }

    // estado que não vive em inputs simples
    const st = {
      logo_url: orig.logo_url || null,
      logo_white_url: orig.logo_white_url || null,
      benefits: normalizeBenefits(orig.benefits),
      marquee: Array.isArray(orig.marquee) ? orig.marquee.map(String) : [],
      popular_searches: Array.isArray(orig.popular_searches) ? orig.popular_searches.map(String) : [],
    };
    const uploaded = new Set(); // arquivos enviados nesta sessão e ainda não salvos
    let baseline = '';
    let disposed = false;

    function normalizeBenefits(list) {
      const arr = Array.isArray(list) ? list : [];
      return EMPTY_BENEFITS.map((d, i) => {
        const b = arr[i] || {};
        return { icon: BENEFIT_ICONS[b.icon] ? b.icon : d.icon, title: String(b.title || ''), text: String(b.text || '') };
      });
    }

    const counter = (name, limit) => html`<span class="netcfg__counter" data-counter="${name}" data-limit="${limit}" aria-live="off"></span>`;
    const card = (id, title, sub, body) =>
      html`<section class="card" id="netcfg-${id}" data-section="${id}" aria-labelledby="netcfg-${id}-t">
        <div class="card__head"><div class="h2" id="netcfg-${id}-t">${title}</div>${sub ? html`<p class="muted small">${sub}</p>` : ''}</div>
        <div class="card__body">${body}</div>
      </section>`;

    render(
      view,
      html`<form class="netcfg" data-form novalidate>
        <nav class="netcfg__index" aria-label="Seções das configurações">
          ${SECTIONS.map(([id, label], i) => html`<button type="button" data-goto="${id}" class="${i === 0 ? 'is-active' : ''}">${label}</button>`)}
        </nav>
        <div class="netcfg__main">
          ${card(
            'identity',
            'Identidade',
            'Nome e frases da marca usados na loja virtual de todas as lojas.',
            html`<div class="form-grid">
              <div class="field col-6">
                <div class="netcfg__labelrow"><label for="net-name">Nome da rede *</label>${counter('name', LIMITS.name)}</div>
                <input class="input" id="net-name" name="name" required maxlength="${LIMITS.name}" value="${orig.name || ''}">
              </div>
              <div class="field col-6">
                <div class="netcfg__labelrow"><label for="net-tagline">Tagline</label>${counter('tagline', LIMITS.tagline)}</div>
                <input class="input" id="net-tagline" name="tagline" maxlength="${LIMITS.tagline}" value="${orig.tagline || ''}" placeholder="Móveis, colchões e eletro">
              </div>
              <div class="field col-6">
                <div class="netcfg__labelrow"><label for="net-slogan">Slogan *</label>${counter('slogan', LIMITS.slogan)}</div>
                <textarea class="textarea" id="net-slogan" name="slogan" rows="3" maxlength="${LIMITS.slogan}" required>${orig.slogan || ''}</textarea>
                <span class="hint">Aparece no rodapé. As quebras de linha são mantidas.</span>
              </div>
              <div class="field col-6">
                <span class="label">Prévia do slogan</span>
                <div class="netcfg__slogan" data-slogan-preview></div>
              </div>
            </div>`
          )}
          ${card(
            'logos',
            'Logos',
            'Envie SVG, PNG ou WebP com fundo transparente. Sem logo enviada, a loja usa a logo padrão da Atual Móveis.',
            html`<div class="grid grid-2">
              <div class="netcfg-logo" data-logo="logo_url">
                <span class="label">Logo principal <span class="muted">(fundos claros: cabeçalho)</span></span>
                <div class="netcfg-logo__tiles" data-tiles></div>
                <div class="netcfg-logo__bar" data-logo-bar></div>
              </div>
              <div class="netcfg-logo" data-logo="logo_white_url">
                <span class="label">Logo branca <span class="muted">(fundos escuros: rodapé e menu)</span></span>
                <div class="netcfg-logo__tiles" data-tiles></div>
                <div class="netcfg-logo__bar" data-logo-bar></div>
              </div>
            </div>`
          )}
          ${card(
            'colors',
            'Cores',
            'A cor principal pinta botões, preços e destaques da loja virtual; a de apoio, selos e detalhes.',
            html`<div class="form-grid">
              <div class="field col-6">
                <label for="net-primary">Cor principal *</label>
                <div class="netcfg-color">
                  <input type="color" data-pick="primary_color" value="${HEX_RE.test(orig.primary_color) ? orig.primary_color.toLowerCase() : '#e01b26'}" aria-label="Escolher a cor principal">
                  <input class="input" id="net-primary" name="primary_color" maxlength="7" value="${orig.primary_color || ''}" placeholder="#E01B26" spellcheck="false" autocomplete="off">
                </div>
                <span class="hint" data-contrast></span>
              </div>
              <div class="field col-6">
                <label for="net-accent">Cor de apoio *</label>
                <div class="netcfg-color">
                  <input type="color" data-pick="accent_color" value="${HEX_RE.test(orig.accent_color) ? orig.accent_color.toLowerCase() : '#f4802b'}" aria-label="Escolher a cor de apoio">
                  <input class="input" id="net-accent" name="accent_color" maxlength="7" value="${orig.accent_color || ''}" placeholder="#F4802B" spellcheck="false" autocomplete="off">
                </div>
                <span class="hint">Use um tom claro o bastante para texto escuro por cima.</span>
              </div>
              <div class="col-12 netcfg-preview" data-color-preview aria-label="Prévia das cores">
                <div class="netcfg-preview__sw">
                  <div><i style="background:var(--p)"></i><span data-sw="primary_color"></span></div>
                  <div><i style="background:var(--a)"></i><span data-sw="accent_color"></span></div>
                </div>
                <div class="netcfg-preview__strip">Entrega em até 30 km · Parcele sem juros · 5% OFF no PIX</div>
                <div class="netcfg-preview__card">
                  <div class="netcfg-preview__price"><span>Sofá retrátil 3 lugares</span><strong>R$ 1.899,00</strong><span>no PIX · ou 10x de R$ 199,90</span></div>
                  <span class="netcfg-preview__tag">5% OFF no PIX</span>
                  <span class="netcfg-preview__ghost">Detalhes</span>
                  <span class="netcfg-preview__btn">Comprar</span>
                </div>
              </div>
            </div>`
          )}
          ${card(
            'defaults',
            'Padrões das lojas',
            'Valores iniciais das lojas novas. Cada loja ajusta PIX e parcelas em “Dados, entrega e pagamento”.',
            html`<div class="form-grid">
              <div class="field col-4">
                <label for="net-pix">Desconto PIX padrão *</label>
                <div class="input-group"><input class="input" id="net-pix" name="default_pix_discount" type="number" inputmode="decimal" min="0" max="50" step="0.5" value="${orig.default_pix_discount ?? ''}"><span class="input-group__addon">%</span></div>
                <span class="hint">De 0 a 50%. A vitrine mostra o preço PIX com este desconto.</span>
              </div>
              <div class="field col-4">
                <label for="net-inst">Parcelas padrão *</label>
                <div class="input-group"><input class="input" id="net-inst" name="default_installments" type="number" inputmode="numeric" min="1" max="24" step="1" value="${orig.default_installments ?? ''}"><span class="input-group__addon">vezes</span></div>
                <span class="hint">De 1 a 24 parcelas sem juros.</span>
              </div>
              <div class="field col-4">
                <label for="net-radius">Raio máximo de entrega *</label>
                <div class="input-group"><input class="input" id="net-radius" name="default_radius_km" type="number" inputmode="decimal" min="1" max="500" step="1" value="${orig.default_radius_km ?? ''}"><span class="input-group__addon">km</span></div>
                <span class="hint">Também é o raio inicial de novas lojas.</span>
              </div>
              <div class="col-12 alert alert--info">${icon('truck')}<div><strong>Este raio é o teto de toda a rede.</strong> A equipe de cada loja não consegue salvar um raio de entrega maior que este valor; só a administração da rede pode abrir exceções.</div></div>
              <div class="col-12" data-cap-warning></div>
            </div>`
          )}
          ${card(
            'contact',
            'Contato e redes sociais',
            'Usados quando a loja não tem os próprios contatos cadastrados.',
            html`<div class="form-grid">
              <div class="field col-4">
                <label for="net-wa">WhatsApp de suporte</label>
                <input class="input" id="net-wa" name="support_whatsapp" inputmode="numeric" autocomplete="off" maxlength="20" value="${orig.support_whatsapp || ''}" placeholder="5531999999999">
                <span class="hint" data-wa-hint>Só números: 55 + DDD + número.</span>
              </div>
              <div class="field col-4">
                <label for="net-ig">Instagram</label>
                <input class="input" id="net-ig" name="instagram" type="url" inputmode="url" autocomplete="off" value="${orig.instagram || ''}" placeholder="https://www.instagram.com/atualmoveis/">
                <span class="hint">Endereço completo ou @perfil.</span>
              </div>
              <div class="field col-4">
                <label for="net-fb">Facebook</label>
                <input class="input" id="net-fb" name="facebook" type="url" inputmode="url" autocomplete="off" value="${orig.facebook || ''}" placeholder="https://www.facebook.com/atualmoveis/">
              </div>
            </div>`
          )}
          ${card(
            'seo',
            'SEO',
            'Como a loja virtual aparece no Google e ao compartilhar o link.',
            html`<div class="form-grid">
              <div class="field col-12">
                <div class="netcfg__labelrow"><label for="net-seo-title">Título da página</label>${counter('seo_title', LIMITS.seo_title)}</div>
                <input class="input" id="net-seo-title" name="seo_title" maxlength="${LIMITS.seo_title_max}" value="${orig.seo_title || ''}">
                <span class="hint">Ideal: até ${LIMITS.seo_title} caracteres.</span>
              </div>
              <div class="field col-12">
                <div class="netcfg__labelrow"><label for="net-seo-desc">Descrição</label>${counter('seo_description', LIMITS.seo_description)}</div>
                <textarea class="textarea" id="net-seo-desc" name="seo_description" rows="3" maxlength="${LIMITS.seo_description_max}">${orig.seo_description || ''}</textarea>
                <span class="hint">Ideal: de 120 a ${LIMITS.seo_description} caracteres.</span>
              </div>
              <div class="col-12">
                <span class="label">Prévia no Google</span>
                <div class="netcfg-serp mt-1" data-serp>
                  <div class="netcfg-serp__url">${location.host}/loja/ponte-nova</div>
                  <div class="netcfg-serp__title" data-serp-title></div>
                  <div class="netcfg-serp__desc" data-serp-desc></div>
                </div>
              </div>
            </div>`
          )}
          ${card(
            'benefits',
            'Benefícios',
            'Os 4 selos do rodapé da loja virtual (garantia, entrega, pagamento e atendimento).',
            html`<div class="netcfg-benefits" data-benefits></div>`
          )}
          ${card(
            'marquee',
            'Faixa rolante',
            'Frases curtas que passam na faixa da página inicial. Uma loja pode ter a sua própria faixa; senão usa esta.',
            html`<div class="stack" style="--gap:12px"><div data-list="marquee"></div><div><span class="label">Prévia</span><div class="netcfg-marquee mt-1" data-marquee-preview></div></div></div>`
          )}
          ${card(
            'searches',
            'Buscas populares',
            'Sugestões exibidas ao abrir a busca da loja virtual (só aparecem as que têm produtos na loja).',
            html`<div class="stack" style="--gap:12px"><div data-list="popular_searches"></div><div class="netcfg-chips" data-search-preview></div></div>`
          )}
          ${card(
            'footer',
            'Rodapé',
            '',
            html`<div class="field">
              <div class="netcfg__labelrow"><label for="net-legal">Texto legal do rodapé</label>${counter('footer_legal', LIMITS.footer_legal)}</div>
              <textarea class="textarea" id="net-legal" name="footer_legal" rows="3" maxlength="${LIMITS.footer_legal}">${orig.footer_legal || ''}</textarea>
              <span class="hint">Avisos e condições exibidos no fim de todas as páginas.</span>
            </div>`
          )}
          <div class="netcfg__bar">
            <span class="netcfg__status" data-status aria-live="polite"></span>
            <button class="btn" type="button" data-discard>Descartar</button>
            <button class="btn btn--primary" type="submit" data-save>${icon('check', 'icon-sm')} Salvar alterações</button>
          </div>
        </div>
      </form>`
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
          ? html`<div class="netcfg-logo__tile is-dark is-main"><img src="${src}" alt="Logo branca sobre fundo escuro"><span>Fundo escuro</span></div>
            <div class="netcfg-logo__tile is-brand"><img src="${src}" alt="Logo branca sobre a cor principal"><span>Cor principal</span></div>`
          : html`<div class="netcfg-logo__tile is-main"><img src="${src}" alt="Logo principal sobre fundo claro"><span>Fundo claro</span></div>
            <div class="netcfg-logo__tile is-dark"><img src="${src}" alt="Logo principal sobre fundo escuro"><span>Fundo escuro</span></div>`
      );
      render(
        $('[data-logo-bar]', box),
        html`<button class="btn btn--sm" type="button" data-upload="${key}">${icon('upload', 'icon-sm')} ${value ? 'Trocar logo' : 'Enviar logo'}</button>
          ${value ? html`<button class="btn btn--sm btn--ghost" type="button" data-logo-reset="${key}">${icon('refresh', 'icon-sm')} Usar a padrão</button>` : ''}
          <span class="netcfg-logo__state">${value ? (uploaded.has(value) ? 'Nova logo — salve para aplicar' : 'Logo personalizada') : 'Usando a logo padrão da Atual'}</span>
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
        btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Enviando…';
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
        $(`#netcfg-${go.dataset.goto}`, view)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $$('[data-goto]', view).forEach((b) => b.classList.toggle('is-active', b === go));
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
    function drawBenefits() {
      render(
        $('[data-benefits]', view),
        st.benefits.map(
          (b, i) => html`<div class="netcfg-benefit" data-benefit="${i}">
            <div class="netcfg-benefit__head">
              <span class="netcfg-benefit__icon" data-benefit-icon>${benefitIcon(b.icon)}</span>
              <span class="netcfg-benefit__n">Benefício ${i + 1}</span>
              <label class="visually-hidden" for="net-b-icon-${i}">Ícone do benefício ${i + 1}</label>
              <select class="select" id="net-b-icon-${i}" data-b="icon">
                ${Object.entries(BENEFIT_ICONS).map(([k, v]) => html`<option value="${k}" ${k === b.icon ? 'selected' : ''}>${v.label}</option>`)}
              </select>
            </div>
            <div class="field">
              <div class="netcfg__labelrow"><label for="net-b-title-${i}">Título *</label><span class="netcfg__counter" data-bcount="title">${b.title.length}/${LIMITS.benefit_title}</span></div>
              <input class="input" id="net-b-title-${i}" data-b="title" maxlength="${LIMITS.benefit_title}" value="${b.title}" placeholder="Ex.: Compra garantida">
            </div>
            <div class="field">
              <div class="netcfg__labelrow"><label for="net-b-text-${i}">Texto *</label><span class="netcfg__counter" data-bcount="text">${b.text.length}/${LIMITS.benefit_text}</span></div>
              <textarea class="textarea" id="net-b-text-${i}" data-b="text" rows="2" maxlength="${LIMITS.benefit_text}">${b.text}</textarea>
            </div>
          </div>`
        )
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
      render(
        box,
        html`${items.length
          ? html`<ol class="netcfg-list">${items.map(
              (t, i) => html`<li class="netcfg-list__item" data-i="${i}">
                <span class="netcfg-list__n" aria-hidden="true">${i + 1}</span>
                <label class="visually-hidden" for="net-${key}-${i}">${cfg.label} ${i + 1}</label>
                <input class="input" id="net-${key}-${i}" data-item="${i}" maxlength="${cfg.maxLen}" value="${t}">
                <button class="btn btn--sm btn--icon netcfg-up" type="button" data-move="-1" aria-label="Mover ${cfg.label.toLowerCase()} ${i + 1} para cima" ${i === 0 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>
                <button class="btn btn--sm btn--icon" type="button" data-move="1" aria-label="Mover ${cfg.label.toLowerCase()} ${i + 1} para baixo" ${i === items.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 'icon-sm')}</button>
                <button class="btn btn--sm btn--icon btn--ghost" type="button" data-del aria-label="Remover ${cfg.label.toLowerCase()} ${i + 1}">${icon('trash', 'icon-sm')}</button>
              </li>`
            )}</ol>`
          : html`<p class="netcfg-list__empty">${cfg.empty}</p>`}
        <div class="netcfg-list__add">
          <label class="visually-hidden" for="net-${key}-new">Nova ${cfg.label.toLowerCase()}</label>
          <input class="input" id="net-${key}-new" data-new maxlength="${cfg.maxLen}" placeholder="${cfg.placeholder}" ${items.length >= cfg.max ? 'disabled' : ''}>
          <button class="btn btn--sm" type="button" data-add ${items.length >= cfg.max ? 'disabled' : ''}>${icon('plus', 'icon-sm')} Adicionar</button>
        </div>
        <p class="hint mt-2 muted small">${num(items.length)} de ${cfg.max} · até ${cfg.maxLen} caracteres cada.</p>`
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

      if (!data.name || data.name.length < 2) errors.name = 'Informe o nome da rede';
      if (!data.slogan) errors.slogan = 'Informe o slogan';
      if (!HEX_RE.test(data.primary_color)) errors.primary_color = 'Use o formato #RRGGBB';
      if (!HEX_RE.test(data.accent_color)) errors.accent_color = 'Use o formato #RRGGBB';
      const pix = data.default_pix_discount;
      if (pix === null || Number.isNaN(pix) || pix < 0 || pix > 50) errors.default_pix_discount = 'Entre 0 e 50%';
      else data.default_pix_discount = Math.round(pix * 100) / 100;
      const inst = data.default_installments;
      if (inst === null || !Number.isInteger(inst) || inst < 1 || inst > 24) errors.default_installments = 'Número inteiro de 1 a 24';
      const rad = data.default_radius_km;
      if (rad === null || Number.isNaN(rad) || rad <= 0 || rad > 500) errors.default_radius_km = 'Entre 1 e 500 km';
      else data.default_radius_km = Math.round(rad * 100) / 100;
      if (data.support_whatsapp && !/^55\d{10,11}$/.test(data.support_whatsapp)) errors.support_whatsapp = 'Use 55 + DDD + número (12 ou 13 dígitos)';
      if (data.instagram && !validUrl(data.instagram)) errors.instagram = 'Endereço inválido';
      if (data.facebook && !validUrl(data.facebook)) errors.facebook = 'Endereço inválido';
      const benefitErrors = [];
      data.benefits.forEach((b, i) => {
        if (!b.title) benefitErrors.push([`net-b-title-${i}`, 'Informe o título']);
        if (!b.text) benefitErrors.push([`net-b-text-${i}`, 'Informe o texto']);
      });
      const listErrors = [];
      st.marquee.forEach((s, i) => !s.trim() && listErrors.push([`net-marquee-${i}`, 'Frase vazia: escreva ou remova']));
      st.popular_searches.forEach((s, i) => !s.trim() && listErrors.push([`net-popular_searches-${i}`, 'Busca vazia: escreva ou remova']));
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
        m.textContent = msg;
        (input.closest('.field') || input.closest('.netcfg-list__item'))?.appendChild(m);
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
        m.textContent = msg;
        input.closest('.field')?.appendChild(m);
      }
    }

    /* ---------- Prévia e estado ---------- */
    const isDirty = () => JSON.stringify(collect().data) !== baseline;
    function refresh() {
      const { data } = collect();
      // contadores
      $$('[data-counter]', view).forEach((c) => {
        const len = String(el(c.dataset.counter)?.value || '').length;
        const limit = Number(c.dataset.limit);
        c.textContent = `${len}/${limit}`;
        c.classList.toggle('is-over', len > limit);
      });
      // slogan
      const slog = $('[data-slogan-preview]', view);
      render(slog, html`<small>Rodapé</small>${(data.slogan || 'Sua casa,\nsempre atual.').split('\n').map((l, i) => html`${i ? html`<br>` : ''}${l}`)}`);
      // cores
      const prev = $('[data-color-preview]', view);
      const p = HEX_RE.test(data.primary_color) ? data.primary_color : '#E01B26';
      const a = HEX_RE.test(data.accent_color) ? data.accent_color : '#F4802B';
      prev.style.setProperty('--p', p);
      $('[data-logo="logo_white_url"]', view).style.setProperty('--netcfg-p', p);
      prev.style.setProperty('--a', a);
      $('[data-sw="primary_color"]', view).textContent = `Principal ${p}`;
      $('[data-sw="accent_color"]', view).textContent = `Apoio ${a}`;
      const ratio = contrastWithWhite(p);
      const ch = $('[data-contrast]', view);
      ch.textContent =
        ratio < 4.5
          ? `Atenção: texto branco sobre esta cor tem contraste ${ratio.toFixed(1).replace('.', ',')}:1 (o recomendado é 4,5:1).`
          : `Contraste com texto branco: ${ratio.toFixed(1).replace('.', ',')}:1 — boa leitura.`;
      ch.style.color = ratio < 4.5 ? 'var(--warning)' : '';
      // raio
      const cap = data.default_radius_km;
      const over = cap > 0 ? stores.filter((s) => Number(s.delivery_radius_km) > cap) : [];
      render(
        $('[data-cap-warning]', view),
        over.length
          ? html`<div class="alert alert--warning netcfg-cap">${icon('alert')}<div class="stack" style="--gap:8px">
              <div><strong>${num(over.length)} ${over.length === 1 ? 'loja entrega' : 'lojas entregam'} hoje além de ${num(cap)} km.</strong> O raio delas continua como está, mas a equipe da loja só conseguirá salvar a configuração de entrega depois de reduzi-lo.</div>
              <ul>${over.map((s) => html`<li class="badge badge--plain">${s.name} · ${num(s.delivery_radius_km)} km</li>`)}</ul>
            </div></div>`
          : ''
      );
      // whatsapp
      const wa = data.support_whatsapp;
      const waHint = $('[data-wa-hint]', view);
      if (wa && /^55\d{10,11}$/.test(wa)) {
        render(waHint, html`Será salvo como ${wa} · ${phone(wa)} · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">testar ↗</a>`);
      } else waHint.textContent = 'Só números: 55 + DDD + número.';
      // seo
      $('[data-serp-title]', view).textContent = data.seo_title || data.name || 'Atual Móveis';
      $('[data-serp-desc]', view).textContent = data.seo_description || 'Sem descrição: o Google escolherá um trecho da página.';
      // faixa e buscas
      render(
        $('[data-marquee-preview]', view),
        data.marquee.length ? data.marquee.map((t) => html`<span>${t}</span>`) : html`<span class="faint">Faixa oculta</span>`
      );
      render(
        $('[data-search-preview]', view),
        data.popular_searches.length ? data.popular_searches.map((t) => html`<span>${t}</span>`) : html`<span class="faint small">Nenhuma sugestão</span>`
      );
      // alterações pendentes
      const dirty = JSON.stringify(data) !== baseline;
      const status = $('[data-status]', view);
      status.classList.toggle('is-dirty', dirty);
      status.textContent = dirty ? 'Alterações não salvas' : `Tudo salvo${orig.updated_at ? ` · atualizado em ${datetime(orig.updated_at)}` : ''}`;
      $('[data-discard]', view).disabled = !dirty;
      return dirty;
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

    fill(orig);
    baseline = JSON.stringify(collect().data);
    refresh();

    form.addEventListener('input', (e) => {
      if (e.target.closest('[data-b], [data-item], [data-new], [data-pick], [data-file]')) return;
      refresh();
    });

    /* ---------- Salvar ---------- */
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data, errors, extra } = collect();
      showFieldErrors(errors);
      markById(extra);
      const firstName = Object.keys(errors)[0];
      if (firstName || extra.length) {
        const target = firstName ? el(firstName) : document.getElementById(extra[0][0]);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.focus({ preventScroll: true });
        toast('Revise os campos destacados.', 'warning');
        return;
      }
      if (!isDirty()) return toast('Nenhuma alteração para salvar.', 'info');
      if (data.default_radius_km < Number(orig.default_radius_km)) {
        const over = stores.filter((s) => Number(s.delivery_radius_km) > data.default_radius_km);
        const ok = await confirmDialog({
          title: 'Reduzir o raio máximo?',
          message: `O novo teto passa a ser ${num(data.default_radius_km)} km para toda a rede${over.length ? `; ${over.length} ${over.length === 1 ? 'loja está' : 'lojas estão'} acima dele hoje` : ''}. As lojas não conseguirão salvar um raio maior que isso.`,
          confirmLabel: 'Reduzir raio',
        });
        if (!ok) return;
      }
      // normaliza o que foi digitado (ex.: WhatsApp sem 55, @perfil)
      el('support_whatsapp').value = data.support_whatsapp || '';
      el('instagram').value = data.instagram || '';
      el('facebook').value = data.facebook || '';
      el('primary_color').value = data.primary_color;
      el('accent_color').value = data.accent_color;
      try {
        const saved = await withBusy($('[data-save]', view), () =>
          q(
            sb
              .from('network_settings')
              .update({ ...data, updated_at: new Date().toISOString(), updated_by: ctx.user.id })
              .eq('id', 1)
              .select('*')
              .single()
          )
        );
        // apaga do storage as logos substituídas (só arquivos do nosso bucket)
        for (const key of ['logo_url', 'logo_white_url']) {
          if (orig[key] && orig[key] !== saved[key] && fromOurBucket(orig[key])) removeImage(orig[key]).catch(() => {});
        }
        uploaded.clear();
        orig = saved;
        fill(saved);
        baseline = JSON.stringify(collect().data);
        refresh();
        toast('Configurações da rede salvas. A loja virtual já usa os novos dados.', 'success');
      } catch (err) {
        toastError(err);
      }
    });

    $('[data-discard]', view).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Descartar alterações?', message: 'Os campos voltam aos valores salvos. Logos enviadas e não salvas serão apagadas.', confirmLabel: 'Descartar', danger: true });
      if (!ok) return;
      dropUnsavedUploads();
      fill(orig);
      refresh();
      toast('Alterações descartadas.', 'info');
    });

    /* ---------- Índice acompanha a rolagem ---------- */
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          const vis = entries.filter((en) => en.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
          if (!vis) return;
          const id = vis.target.dataset.section;
          $$('[data-goto]', view).forEach((b) => b.classList.toggle('is-active', b.dataset.goto === id));
        },
        { rootMargin: '-80px 0px -60% 0px' }
      );
      $$('[data-section]', view).forEach((s) => io.observe(s));
    }

    const onBeforeUnload = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      disposed = true;
      io?.disconnect();
      window.removeEventListener('beforeunload', onBeforeUnload);
      // ao sair sem salvar, não deixa arquivos órfãos no storage
      dropUnsavedUploads();
    };
  },
};
