// Minha conta: dados pessoais, troca de senha, preferências deste aparelho (tema, som, dicas) e acessos.
// Também serve de exemplo do contrato de módulos (ver app.js).
// O tema usa setTheme() do ui.js: o shell ouve o evento "atual:theme" e mantém os outros controles em sincronia;
// o som usa [data-sound-toggle] (o shell liga/desliga e atualiza aria-checked em todos os botões).
import { sb, q } from '../api.js';
import {
  html,
  render,
  $,
  $$,
  icon,
  toast,
  toastError,
  readForm,
  showErrors,
  withBusy,
  errorBlock,
  skeleton,
  injectStyle,
  avatar,
  storeMark,
  badge,
  art,
  getTheme,
  setTheme,
  tipsEnabled,
  setTipsEnabled,
  num,
  ROLES,
} from '../ui.js';

const ROLE_TONE = { super_admin: 'dark', network_admin: 'accent', store_admin: 'info', store_manager: 'success', store_editor: 'plum', store_operator: '' };
const THEME_OPTS = [
  ['light', 'Claro', 'Fundo creme, ideal de dia'],
  ['dark', 'Escuro', 'Casa à noite, descansa a vista'],
  ['system', 'Sistema', 'Segue o aparelho'],
];
const TIP_PREFIX = 'atual-admin-tip:';
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const since = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
};
// (31) 99999-9999 enquanto digita
function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
// 0–4: tamanho, variedade (minúsculas/maiúsculas, números, símbolos)
function strength(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[a-z]/i.test(p)) s++;
  if (/[^a-z0-9]/i.test(p)) s++;
  if (p.length < 8) return 1;
  return Math.min(4, s);
}
const STRENGTH = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
const STRENGTH_TONE = ['', 'bad', 'warn', 'ok', 'ok'];
// erros do Supabase Auth (em inglês) → português
function passError(err) {
  const code = err?.code || err?.error_code || '';
  const msg = String(err?.message || err || '');
  if (code === 'same_password' || /different from the old|same.?password/i.test(msg)) return new Error('A nova senha precisa ser diferente da atual.');
  if (code === 'weak_password' || /weak|at least \d+ characters|password should/i.test(msg)) return new Error('Senha fraca: use pelo menos 8 caracteres, misturando letras e números.');
  if (/reauthenticat/i.test(msg)) return new Error('Por segurança, saia e entre de novo antes de trocar a senha.');
  if (/rate limit|too many|429/i.test(`${code} ${msg}`)) return new Error('Muitas tentativas seguidas. Aguarde um minuto e tente de novo.');
  if (/Failed to fetch|NetworkError/i.test(msg)) return new Error('Sem conexão com o servidor. Verifique a internet.');
  return err instanceof Error ? err : new Error(msg || 'Não foi possível alterar a senha.');
}

export default {
  title: 'Minha conta',
  async render(view, ctx) {
    injectStyle('account', CSS);
    render(view, html`<div class="ac">${skeleton('form', { rows: 4 })}</div>`);

    let profile;
    try {
      profile = await q(sb.from('profiles').select('full_name, phone, email, created_at').eq('user_id', ctx.user.id).single());
    } catch (e) {
      render(
        view,
        errorBlock(e, {
          title: 'Não foi possível carregar seus dados',
          retry: () => ctx.navigate(`#/account?r=${Date.now() % 1000}`),
        })
      );
      return;
    }
    if (!view.isConnected) return;

    const name = profile.full_name || ctx.user.full_name || ctx.user.email;
    const email = profile.email || ctx.user.email;
    const roles = ctx.access?.roles || [];
    const canOrders = ctx.isGlobal || ctx.stores.some((s) => ctx.can('orders', s.id));
    const soundOn = lsGet('atual-admin-sound') !== '0';
    const dismissedTips = () => {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith(TIP_PREFIX));
      } catch {
        return [];
      }
    };
    const mainRole = roles[0]?.role;
    const storeOf = (id) => ctx.stores.find((s) => s.id === id) || null;
    const netMark = (size) =>
      html`<span class="smark smark--net" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px" aria-hidden="true">${icon('houses', 'icon-sm')}</span>`;

    const accessRow = (r) => {
      const s = r.store_id ? storeOf(r.store_id) : null;
      return html`<li class="ac-acc">
        ${r.store_id ? (s ? storeMark(s, 34) : netMark(34)) : netMark(34)}
        <div class="ac-acc__txt">
          <strong>${r.store_id ? (s ? ctx.storeShort?.(s) || s.name : r.store_name || 'Loja') : 'Toda a rede'}</strong>
          <span>${r.store_id ? (s ? [s.brand_name, s.city].filter(Boolean).join(' · ') : r.store_name || '') : `Acesso às ${num(ctx.stores.length)} lojas`}</span>
          <span class="ac-acc__role">${r.role === 'super_admin' ? html`<span class="badge ac-super">${ROLES[r.role]?.label}</span>` : badge(ROLES[r.role]?.label || r.role, ROLE_TONE[r.role] || '')}</span>
          <span class="ac-acc__desc">${ROLES[r.role]?.desc || ''}</span>
        </div>
      </li>`;
    };

    const mini = html`<i class="s"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i>`;
    const themeCards = () =>
      html`<fieldset class="ac-theme">
        <legend class="visually-hidden">Tema</legend>
        ${THEME_OPTS.map(
          ([v, label, hint]) => html`<label class="ac-th">
            <input type="radio" name="ac-theme" value="${v}" ${getTheme() === v ? 'checked' : ''}>
            <span class="ac-th__pv ac-th__pv--${v}" aria-hidden="true">${
              v === 'system'
                ? html`<span class="ac-th__pv ac-th__pv--light ac-th__layer">${mini}</span><span class="ac-th__pv ac-th__pv--dark ac-th__layer ac-th__layer--cut">${mini}</span>`
                : mini
            }</span>
            <span class="ac-th__txt"><strong>${icon(v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'monitor', 'icon-sm')} ${label}</strong><span>${hint}</span></span>
          </label>`
        )}
      </fieldset>`;

    render(
      view,
      html`<div class="ac">
        <aside class="ac-side">
          <section class="card ac-id" aria-label="Sua identificação">
            <div class="ac-id__band" aria-hidden="true"></div>
            ${avatar(name, { size: 64, self: true })}
            <h2 class="ac-id__name" data-id-name>${name}</h2>
            <p class="ac-id__mail">${email}</p>
            ${mainRole ? html`<p class="ac-id__role">${ROLES[mainRole]?.label || mainRole}${roles.length > 1 ? ` e mais ${roles.length - 1}` : ''}</p>` : ''}
            ${profile.created_at ? html`<p class="ac-id__since">${icon('calendar', 'icon-xs')} Na equipe desde ${since(profile.created_at)}</p>` : ''}
            <button class="btn btn--ghost btn--sm ac-id__out" type="button" data-logout>${icon('logout', 'icon-sm')} Sair deste aparelho</button>
          </section>
          <section class="card ac-accs" aria-labelledby="ac-accs-t">
            <div class="card__head card__head--line"><div><h2 class="card__title" id="ac-accs-t">Seus acessos</h2><p class="card__sub">Quem libera é o administrador da loja ou da rede.</p></div></div>
            <ul class="ac-acc__list">${roles.length ? roles.map(accessRow) : html`<li class="ac-acc ac-acc--none">Nenhum acesso ativo.</li>`}</ul>
          </section>
        </aside>

        <div class="ac-main">
          <form class="card ac-card" data-profile novalidate aria-labelledby="ac-prof-t">
            <div class="card__head card__head--line"><div><h2 class="card__title" id="ac-prof-t">${icon('account', 'icon-sm')} Seus dados</h2><p class="card__sub">Aparecem para a equipe e nos registros da auditoria.</p></div></div>
            <div class="card__body form-grid">
              <div class="field col-12">
                <label for="ac-name">Nome completo *</label>
                <input class="input" id="ac-name" name="full_name" value="${profile.full_name || ''}" required maxlength="120" autocomplete="name">
              </div>
              <div class="field col-6">
                <label for="ac-phone">Telefone <span class="opt-tag">opcional</span></label>
                <input class="input" id="ac-phone" name="phone" value="${maskPhone(profile.phone) || profile.phone || ''}" type="tel" inputmode="tel" autocomplete="tel" placeholder="(31) 99999-9999">
              </div>
              <div class="field col-6">
                <span class="label" id="ac-mail-l">E-mail de acesso</span>
                <div class="ac-fixed" aria-labelledby="ac-mail-l" role="group">${icon('mail', 'icon-sm')}<span>${email}</span>${icon('lock', 'icon-xs')}</div>
                <span class="hint">Para trocar, fale com a administração da rede.</span>
              </div>
            </div>
            <div class="card__foot ac-foot"><span class="ac-foot__st" data-prof-st aria-live="polite"></span><button class="btn btn--primary" type="submit" data-prof-save disabled>${icon('check', 'icon-sm')} Salvar dados</button></div>
          </form>

          <form class="card ac-card" data-password novalidate aria-labelledby="ac-pass-t">
            <div class="card__head card__head--line"><div><h2 class="card__title" id="ac-pass-t">${icon('key', 'icon-sm')} Senha</h2><p class="card__sub">Use uma senha que você não usa em outros sites.</p></div></div>
            <div class="card__body form-grid">
              <div class="field col-6">
                <label for="ac-pass">Nova senha *</label>
                <div class="ac-pass">
                  <input class="input" id="ac-pass" name="password" type="password" required autocomplete="new-password" minlength="8" spellcheck="false" aria-describedby="ac-meter-t">
                  <button class="btn btn--ghost btn--icon btn--sm ac-pass__eye" type="button" data-eye="ac-pass" aria-label="Mostrar senha" aria-pressed="false">${icon('eye', 'icon-sm')}</button>
                </div>
                <div class="ac-meter" data-meter aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                <span class="hint" id="ac-meter-t" data-meter-t>Mínimo de 8 caracteres. Misture letras, números e símbolos.</span>
              </div>
              <div class="field col-6">
                <label for="ac-confirm">Repita a nova senha *</label>
                <div class="ac-pass">
                  <input class="input" id="ac-confirm" name="confirm" type="password" required autocomplete="new-password" spellcheck="false">
                  <button class="btn btn--ghost btn--icon btn--sm ac-pass__eye" type="button" data-eye="ac-confirm" aria-label="Mostrar senha" aria-pressed="false">${icon('eye', 'icon-sm')}</button>
                </div>
                <span class="hint ac-match" data-match aria-live="polite"></span>
              </div>
            </div>
            <div class="card__foot ac-foot"><span class="ac-foot__st">${icon('lock', 'icon-xs')} Você continua conectado neste aparelho depois de trocar.</span><button class="btn btn--primary" type="submit">${icon('check', 'icon-sm')} Alterar senha</button></div>
          </form>

          <section class="card ac-card" aria-labelledby="ac-pref-t">
            <div class="card__head card__head--line"><div><h2 class="card__title" id="ac-pref-t">${icon('sliders', 'icon-sm')} Preferências deste aparelho</h2><p class="card__sub">Ficam salvas só neste navegador.</p></div></div>
            <div class="card__body ac-prefs">
              <div class="ac-pref ac-pref--col">
                <div class="ac-pref__txt"><strong>Tema</strong><span>“Sistema” acompanha o modo claro ou escuro do aparelho.</span></div>
                ${themeCards()}
              </div>
              ${canOrders
                ? html`<div class="ac-pref">
                    <span class="ac-pref__ico" aria-hidden="true">${icon('volume', 'icon-sm')}</span>
                    <div class="ac-pref__txt"><strong id="ac-snd">Som de novos pedidos</strong><span>Toca um aviso quando chega pedido novo, mesmo com o painel em outra aba.</span></div>
                    <button class="side__sw side__sw--light ac-sw" type="button" role="switch" aria-checked="${soundOn}" aria-labelledby="ac-snd" data-sound-toggle></button>
                  </div>`
                : ''}
              <div class="ac-pref">
                <span class="ac-pref__ico ac-pref__ico--tetim" aria-hidden="true">${art('tetim-face', { w: 30, h: 30 })}</span>
                <div class="ac-pref__txt"><strong id="ac-tips">Dicas do Tetim</strong><span>Sugestões curtas para melhorar o catálogo e a loja. Cada dica dispensada some por 30 dias.</span>
                  <button class="btn btn--ghost btn--sm ac-reset-tips" type="button" data-tips-reset hidden>${icon('undo', 'icon-sm')} <span data-tips-n></span></button></div>
                <button class="side__sw side__sw--light ac-sw" type="button" role="switch" aria-checked="${tipsEnabled()}" aria-labelledby="ac-tips" data-tips-toggle></button>
              </div>
            </div>
          </section>
        </div>
      </div>`
    );

    /* ---------- Dados pessoais ---------- */
    const pForm = $('[data-profile]', view);
    const saveBtn = $('[data-prof-save]', view);
    let saved = { full_name: profile.full_name || '', phone: $('#ac-phone', view).value };
    const dirty = () => pForm.elements.full_name.value.trim() !== saved.full_name.trim() || pForm.elements.phone.value.trim() !== saved.phone.trim();
    const syncProf = () => {
      const d = dirty();
      saveBtn.disabled = !d;
      $('[data-prof-st]', view).textContent = d ? 'Alterações não salvas' : '';
      $('[data-prof-st]', view).classList.toggle('is-dirty', d);
    };
    pForm.elements.phone.addEventListener('input', (e) => {
      const el = e.target;
      const atEnd = el.selectionStart === el.value.length;
      const m = maskPhone(el.value);
      if (m !== el.value) {
        el.value = m;
        if (atEnd) el.setSelectionRange(m.length, m.length);
      }
    });
    pForm.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid') === 'true') {
        e.target.removeAttribute('aria-invalid');
        $$(`.error[data-for="${e.target.name}"]`, pForm).forEach((n) => n.remove());
      }
      syncProf();
    });
    pForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = readForm(pForm);
      const errors = {};
      if (!data.full_name) errors.full_name = 'Informe seu nome.';
      else if (data.full_name.length < 2) errors.full_name = 'Nome muito curto.';
      const digits = String(data.phone || '').replace(/\D/g, '');
      if (data.phone && (digits.length < 10 || digits.length > 11)) errors.phone = 'Telefone incompleto. Use DDD + número.';
      if (!showErrors(pForm, errors)) return;
      try {
        await withBusy(saveBtn, () => q(sb.from('profiles').update({ full_name: data.full_name, phone: data.phone }).eq('user_id', ctx.user.id)));
        ctx.user.full_name = data.full_name;
        saved = { full_name: data.full_name, phone: data.phone || '' };
        syncProf();
        $('[data-id-name]', view).textContent = data.full_name;
        // o cartão do usuário no menu lateral mostra o nome novo sem recarregar
        $$('[data-user-btn] strong, [data-user-menu] .menu__head strong').forEach((n) => (n.textContent = data.full_name));
        toast('Dados salvos', 'success');
      } catch (err) {
        toastError(err);
      }
    });

    /* ---------- Senha ---------- */
    const wForm = $('[data-password]', view);
    const paintMeter = () => {
      const p = wForm.elements.password.value;
      const s = strength(p);
      const meter = $('[data-meter]', view);
      meter.dataset.level = String(s);
      meter.className = `ac-meter ${s ? `t-${STRENGTH_TONE[s]}` : ''}`;
      $$('i', meter).forEach((i, n) => i.classList.toggle('is-on', n < s));
      $('[data-meter-t]', view).textContent = p
        ? p.length < 8
          ? `Faltam ${8 - p.length} ${8 - p.length === 1 ? 'caractere' : 'caracteres'} (mínimo de 8).`
          : `Força: ${STRENGTH[s]}.${s < 3 ? ' Misture letras maiúsculas, números e símbolos.' : ''}`
        : 'Mínimo de 8 caracteres. Misture letras, números e símbolos.';
      const c = wForm.elements.confirm.value;
      const match = $('[data-match]', view);
      if (!c) render(match, '');
      else if (c === p) render(match, html`<span class="ac-ok">${icon('checkCircle', 'icon-xs')} As senhas conferem.</span>`);
      else render(match, p.startsWith(c) ? '' : html`<span class="ac-no">As senhas ainda não conferem.</span>`);
    };
    wForm.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid') === 'true') {
        e.target.removeAttribute('aria-invalid');
        $$(`.error[data-for="${e.target.name}"]`, wForm).forEach((n) => n.remove());
      }
      paintMeter();
    });
    $$('[data-eye]', view).forEach((b) =>
      b.addEventListener('click', () => {
        const input = $(`#${b.dataset.eye}`, view);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-pressed', String(show));
        b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
        render(b, icon(show ? 'eyeOff' : 'eye', 'icon-sm'));
      })
    );
    wForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { password, confirm } = readForm(wForm);
      const errors = {};
      if (!password || password.length < 8) errors.password = 'Use pelo menos 8 caracteres.';
      else if (password !== confirm) errors.confirm = 'As senhas não conferem.';
      if (!showErrors(wForm, errors)) return;
      try {
        await withBusy(wForm.querySelector('[type="submit"]'), async () => {
          const { error } = await sb.auth.updateUser({ password });
          if (error) throw error;
        });
        wForm.reset();
        $$('[data-eye]', view).forEach((b) => {
          $(`#${b.dataset.eye}`, view).type = 'password';
          b.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-label', 'Mostrar senha');
          render(b, icon('eye', 'icon-sm'));
        });
        paintMeter();
        toast('Use a nova senha no próximo acesso, em qualquer aparelho.', 'success', 4200, { title: 'Senha alterada' });
      } catch (err) {
        const ex = passError(err);
        if (/diferente da atual|Senha fraca/.test(ex.message)) showErrors(wForm, { password: ex.message });
        else toastError(ex);
      }
    });

    /* ---------- Preferências ---------- */
    const syncTheme = () => {
      const cur = getTheme();
      $$('input[name="ac-theme"]', view).forEach((r) => (r.checked = r.value === cur));
    };
    $('.ac-theme', view).addEventListener('change', (e) => {
      if (e.target.name === 'ac-theme') setTheme(e.target.value);
    });
    window.addEventListener('atual:theme', syncTheme);
    ctx.onCleanup(() => window.removeEventListener('atual:theme', syncTheme));

    const tipsBtn = $('[data-tips-toggle]', view);
    const paintTipsReset = () => {
      const n = dismissedTips().length;
      const b = $('[data-tips-reset]', view);
      b.hidden = !n || !tipsEnabled();
      $('[data-tips-n]', view).textContent = n === 1 ? 'Mostrar de novo a dica dispensada' : `Mostrar de novo as ${n} dicas dispensadas`;
    };
    paintTipsReset();
    tipsBtn.addEventListener('click', () => {
      const on = !tipsEnabled();
      setTipsEnabled(on);
      tipsBtn.setAttribute('aria-checked', String(on));
      paintTipsReset();
      toast(on ? 'Dicas do Tetim ligadas' : 'Dicas do Tetim desligadas', 'info', 2200);
    });
    $('[data-tips-reset]', view).addEventListener('click', () => {
      const keys = dismissedTips();
      try {
        keys.forEach((k) => localStorage.removeItem(k));
      } catch {
        /* armazenamento indisponível */
      }
      paintTipsReset();
      tipsBtn.focus();
      toast(keys.length === 1 ? 'A dica volta a aparecer' : `${num(keys.length)} dicas voltam a aparecer`, 'success', 2600);
    });
  },
};

const CSS = `
.ac { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-areas: "main side"; gap: 18px; align-items: start; }
.ac > .sk { grid-column: 1 / -1; }
.ac-main { grid-area: main; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.ac-side { grid-area: side; display: flex; flex-direction: column; gap: 18px; position: sticky; top: calc(var(--topbar-h) + 18px); min-width: 0; }
.ac-card .card__title .icon-sm { color: var(--muted); }
.ac-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.ac-foot__st { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 12.5px; color: var(--muted); }
.ac-foot__st.is-dirty { color: var(--warn-fg); font-weight: 600; }
.ac-foot__st.is-dirty::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 0 3px color-mix(in srgb, var(--orange) 22%, transparent); }
.ac-fixed { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 12px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-3); color: var(--ink); font-size: 14px; min-width: 0; }
.ac-fixed span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-fixed > .icon-sm { color: var(--muted); flex: none; }
.ac-fixed > .icon-xs { margin-left: auto; color: var(--muted); flex: none; }
.ac-pass { position: relative; }
.ac-pass .input { padding-right: 48px; }
.ac-pass__eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); }
.ac-meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 2px; }
.ac-meter i { height: 4px; border-radius: 4px; background: var(--surface-3); transition: background-color var(--dur-2) var(--ease-out); }
.ac-meter.t-bad i.is-on { background: var(--bad-dot); }
.ac-meter.t-warn i.is-on { background: var(--warn-dot); }
.ac-meter.t-ok i.is-on { background: var(--ok-dot); }
.ac-match { min-height: 18px; }
.ac-ok { display: inline-flex; align-items: center; gap: 5px; color: var(--ok-fg); font-weight: 600; }
.ac-no { color: var(--muted); }
/* identidade */
.ac-id { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 20px 18px; overflow: hidden; }
.ac-id__band { align-self: stretch; height: 64px; margin: 0 -20px -32px; background: radial-gradient(120% 140% at 85% 0%, color-mix(in srgb, var(--orange) 26%, transparent), transparent 60%), linear-gradient(135deg, var(--highlight-soft), var(--surface-2)); border-bottom: 1px solid var(--line); }
.ac-id .avatar { position: relative; font-size: 24px; box-shadow: 0 0 0 4px var(--surface), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
.ac-id__name { margin: 12px 0 0; font: 800 20px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.01em; overflow-wrap: anywhere; }
.ac-id__mail { margin: 2px 0 0; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.ac-id__role { margin: 10px 0 0; padding: 3px 10px; border-radius: 999px; background: var(--surface-3); font-size: 12px; font-weight: 600; color: var(--text); }
.ac-id__since { display: inline-flex; align-items: center; gap: 5px; margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
.ac-id__out { margin-top: 12px; color: var(--bad-fg); }
.ac-id__out .icon-sm { color: var(--bad-fg); }
.ac-acc__list { list-style: none; margin: 0; padding: 4px 8px 8px; }
.ac-acc { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border-radius: 12px; }
.ac-acc + .ac-acc { border-top: 1px solid var(--line); border-radius: 0; }
.ac-acc .smark--net { display: inline-grid; place-items: center; flex: none; }
.ac-acc .smark { flex: none; }
.ac-acc__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ac-acc__txt strong { font-size: 14px; font-weight: 600; color: var(--ink); }
.ac-acc__txt > span { font-size: 12.5px; color: var(--muted); }
.ac-acc__role { margin-top: 6px; }
.ac-acc__desc { line-height: 1.4; margin-top: 2px; }
.ac-acc--none { font-size: 13px; color: var(--muted); }
.badge.ac-super { background: var(--select); color: var(--on-select); box-shadow: none; }
.badge.ac-super::before { background: var(--highlight); }
/* preferências */
.ac-prefs { display: flex; flex-direction: column; gap: 0; padding-top: 4px; }
.ac-pref { display: flex; align-items: flex-start; gap: 14px; padding: 16px 0; }
.ac-pref + .ac-pref { border-top: 1px solid var(--line); }
.ac-pref--col { flex-direction: column; gap: 12px; padding-top: 6px; }
.ac-pref__ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--surface-3); color: var(--muted); flex: none; }
.ac-pref__ico--tetim { background: var(--highlight-soft); overflow: hidden; }
.ac-pref__ico--tetim .art { width: 30px; height: 30px; }
.ac-pref__txt { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ac-pref__txt strong { font-size: 14px; font-weight: 600; color: var(--ink); }
.ac-pref__txt > span { font-size: 12.5px; color: var(--muted); line-height: 1.4; }
.ac-sw { margin-top: 4px; width: 36px; height: 21px; }
.ac-sw::after { top: 3px; left: 3px; width: 15px; height: 15px; }
.ac-sw[aria-checked='true']::after { transform: translateX(15px); }
.ac-sw:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.ac-reset-tips { align-self: flex-start; margin: 6px 0 0 -10px; }
.ac-theme { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; border: 0; min-width: 0; width: 100%; }
.ac-th { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 8px 8px 12px; border-radius: 14px; border: 1px solid var(--line-strong); background: var(--raised); cursor: pointer; box-shadow: var(--sh-btn); transition: border-color var(--dur-1), box-shadow var(--dur-1); }
.ac-th:hover { border-color: var(--ink); }
.ac-th input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.ac-th:has(input:checked) { border-color: var(--select); box-shadow: 0 0 0 1px var(--select), var(--sh-btn); }
.ac-th:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 3px; }
.ac-th__txt { display: flex; flex-direction: column; gap: 1px; padding: 0 26px 0 4px; }
.ac-th__txt strong { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--ink); }
.ac-th__txt strong .icon-sm { color: var(--muted); }
.ac-th:has(input:checked) .ac-th__txt strong .icon-sm { color: var(--accent-ink); }
.ac-th__txt span { font-size: 12px; color: var(--muted); line-height: 1.35; }
.ac-th::after { content: ''; position: absolute; bottom: 14px; right: 12px; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--field-line); background: var(--field); }
.ac-th:has(input:checked)::after { border: 5.5px solid var(--select); background: var(--on-select); }
/* miniaturas do tema (desenho fixo: mostram como cada tema fica) */
.ac-th__pv { position: relative; display: block; height: 78px; border-radius: 9px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.08); --b: #f6f0e7; --s: #0c1b26; --c: #fffdf9; --l: #ece3d6; --a: #e01b26; background: var(--b); }
.ac-th__pv--dark { --b: #0a131a; --s: #070e14; --c: #132230; --l: #1f3243; --a: #ff5a61; border-color: rgba(255, 255, 255, 0.08); }
.ac-th__pv i { position: absolute; display: block; border-radius: 4px; }
.ac-th__pv .s { left: 0; top: 0; bottom: 0; width: 24%; border-radius: 0; background: var(--s); }
.ac-th__pv .c1 { left: 31%; top: 12px; width: 44%; height: 8px; background: var(--l); }
.ac-th__pv .c2 { left: 31%; top: 28px; right: 8%; height: 38px; border-radius: 6px; background: var(--c); box-shadow: inset 0 0 0 1px var(--l); }
.ac-th__pv .c3 { left: 37%; top: 38px; width: 26%; height: 6px; background: var(--a); }
.ac-th__layer { position: absolute; inset: 0; height: auto; border: 0; border-radius: 0; }
.ac-th__layer--cut { clip-path: polygon(58% 0, 100% 0, 100% 100%, 42% 100%); }

@media (max-width: 1180px) {
  .ac { grid-template-columns: minmax(0, 1fr); grid-template-areas: "side" "main"; }
  .ac-side { position: static; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
}
@media (max-width: 767px) {
  .ac-side { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .ac-main { gap: 14px; }
  .ac { gap: 14px; }
  .ac-theme { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .ac-th { flex-direction: row; align-items: center; padding: 8px 40px 8px 8px; }
  .ac-th__pv { width: 88px; height: 56px; flex: none; }
  .ac-th__pv .c2 { top: 22px; height: 26px; }
  .ac-th__pv .c3 { top: 30px; }
  .ac-th__pv .c1 { top: 9px; }
  .ac-th::after { top: 50%; bottom: auto; transform: translateY(-50%); }
  .ac-foot { flex-wrap: wrap; }
  .ac-foot .btn { flex: 1 1 auto; height: 44px; }
  .ac-foot__st { flex-basis: 100%; }
  .ac-id__out { min-height: 44px; }
}
`;
