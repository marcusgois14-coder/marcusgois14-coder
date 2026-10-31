// Minha conta: dados pessoais, troca de senha e acessos da pessoa logada.
// Também serve de exemplo do contrato de módulos (ver app.js).
import { sb, q } from '../api.js';
import { html, render, $, icon, toast, toastError, readForm, showErrors, withBusy, ROLES, field } from '../ui.js';

export default {
  title: 'Minha conta',
  async render(view, ctx) {
    const profile = await q(sb.from('profiles').select('full_name, phone, email').eq('user_id', ctx.user.id).single());

    render(
      view,
      html`<div class="grid grid-2">
        <form class="card" data-profile novalidate>
          <div class="card__head"><div class="h2">Dados pessoais</div></div>
          <div class="card__body form-grid">
            ${field({ label: 'Nome completo', name: 'full_name', value: profile.full_name, required: true, cls: 'col-12' })}
            ${field({ label: 'Telefone', name: 'phone', value: profile.phone, cls: 'col-6', placeholder: '(31) 99999-9999' })}
            <div class="field col-6"><label>E-mail de acesso</label><input class="input" value="${profile.email || ctx.user.email}" disabled></div>
          </div>
          <div class="card__foot"><button class="btn btn--primary" type="submit">Salvar</button></div>
        </form>

        <form class="card" data-password novalidate>
          <div class="card__head"><div class="h2">Trocar senha</div></div>
          <div class="card__body form-grid">
            ${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, cls: 'col-12', hint: 'Mínimo de 8 caracteres.', attrs: 'autocomplete="new-password"' })}
            ${field({ label: 'Repita a nova senha', name: 'confirm', type: 'password', required: true, cls: 'col-12', attrs: 'autocomplete="new-password"' })}
          </div>
          <div class="card__foot"><button class="btn btn--primary" type="submit">Alterar senha</button></div>
        </form>
      </div>

      <div class="card mt-4">
        <div class="card__head"><div class="h2">Meus acessos</div></div>
        <div class="card__body">
          <ul class="stack" style="--gap:10px">
            ${ctx.access.roles.map(
              (r) => html`<li class="row">
                ${icon(r.store_id ? 'store' : 'network')}
                <div class="grow"><strong>${r.store_name || 'Toda a rede'}</strong><br>
                <span class="muted small">${ROLES[r.role]?.label || r.role} — ${ROLES[r.role]?.desc || ''}</span></div>
              </li>`
            )}
          </ul>
        </div>
      </div>`
    );

    $('[data-profile]', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = readForm(form);
      if (!showErrors(form, data.full_name ? {} : { full_name: 'Informe seu nome' })) return;
      try {
        await withBusy(form.querySelector('[type="submit"]'), () =>
          q(sb.from('profiles').update({ full_name: data.full_name, phone: data.phone }).eq('user_id', ctx.user.id))
        );
        ctx.user.full_name = data.full_name;
        toast('Dados salvos.', 'success');
      } catch (err) {
        toastError(err);
      }
    });

    $('[data-password]', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const { password, confirm } = readForm(form);
      const errors = {};
      if (!password || password.length < 8) errors.password = 'Use pelo menos 8 caracteres';
      else if (password !== confirm) errors.confirm = 'As senhas não conferem';
      if (!showErrors(form, errors)) return;
      try {
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          const { error } = await sb.auth.updateUser({ password });
          if (error) throw error;
        });
        form.reset();
        toast('Senha alterada.', 'success');
      } catch (err) {
        toastError(err);
      }
    });
  },
};
