// Gestão da equipe (contas de acesso ao painel).
// Só esta função cria usuários de autenticação, por isso usa a service role.
// Regras:
//   super_admin    gerencia qualquer pessoa e papel
//   network_admin  gerencia tudo, exceto super admins
//   store_admin    gerencia papéis de loja apenas na(s) sua(s) loja(s)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

type Role = 'super_admin' | 'network_admin' | 'store_admin' | 'store_manager' | 'store_editor' | 'store_operator';
const GLOBAL_ROLES: Role[] = ['super_admin', 'network_admin'];
const STORE_ROLES: Role[] = ['store_admin', 'store_manager', 'store_editor', 'store_operator'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '!7';
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Membership = { id: string; user_id: string; store_id: string | null; role: Role; active: boolean };

async function membershipsOf(userId: string): Promise<Membership[]> {
  const { data, error } = await admin.from('staff').select('id,user_id,store_id,role,active').eq('user_id', userId);
  if (error) throw new HttpError(500, error.message);
  return (data ?? []) as Membership[];
}

function canManage(caller: Membership[], role: Role, storeId: string | null) {
  const active = caller.filter((m) => m.active);
  if (active.some((m) => m.role === 'super_admin')) return true;
  if (active.some((m) => m.role === 'network_admin')) return role !== 'super_admin';
  if (STORE_ROLES.includes(role) && storeId) {
    return active.some((m) => m.role === 'store_admin' && m.store_id === storeId);
  }
  return false;
}

async function audit(actor: { id: string; email?: string }, action: string, recordId: string, storeId: string | null, changes: unknown) {
  await admin.from('audit_log').insert({
    actor_id: actor.id,
    actor_email: actor.email ?? null,
    store_id: storeId,
    table_name: 'staff',
    record_id: recordId,
    action,
    changes,
  });
}

async function findUserByEmail(email: string) {
  const { data } = await admin.from('profiles').select('user_id').ilike('email', email).maybeSingle();
  return data?.user_id as string | undefined;
}

function validateScope(role: Role, storeId: string | null) {
  if (!GLOBAL_ROLES.includes(role) && !STORE_ROLES.includes(role)) throw new HttpError(400, 'Papel inválido');
  if (GLOBAL_ROLES.includes(role) && storeId) throw new HttpError(400, 'Papéis da rede não têm loja');
  if (STORE_ROLES.includes(role) && !storeId) throw new HttpError(400, 'Escolha a loja');
}

async function lastSuperAdmin(membershipId: string) {
  const { data } = await admin.from('staff').select('id').eq('role', 'super_admin').eq('active', true);
  return (data ?? []).length <= 1 && (data ?? []).some((r) => r.id === membershipId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    // Criação do primeiro super admin, com token de uso único gravado (em hash) no banco.
    if (action === 'bootstrap') {
      const { count } = await admin.from('staff').select('id', { count: 'exact', head: true }).eq('role', 'super_admin');
      if ((count ?? 0) > 0) throw new HttpError(403, 'A rede já tem um super admin');
      const hash = await sha256(String(body.token ?? ''));
      const { data: tok } = await admin.from('bootstrap_tokens').select('token_hash').eq('token_hash', hash).maybeSingle();
      if (!tok) throw new HttpError(403, 'Token inválido');
      await admin.from('bootstrap_tokens').delete().eq('token_hash', hash);
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '') || randomPassword();
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: body.full_name ?? 'Administrador' },
      });
      if (error || !created.user) throw new HttpError(400, error?.message ?? 'Falha ao criar usuário');
      await admin.from('profiles').upsert({ user_id: created.user.id, email, full_name: body.full_name ?? 'Administrador' });
      await admin.from('staff').insert({ user_id: created.user.id, role: 'super_admin', store_id: null });
      return json({ user_id: created.user.id, email, password });
    }

    // Demais ações exigem um usuário logado da equipe
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(token);
    const caller = auth?.user;
    if (!caller) throw new HttpError(401, 'Faça login novamente');
    const callerRoles = await membershipsOf(caller.id);
    if (!callerRoles.some((m) => m.active)) throw new HttpError(403, 'Sem acesso ao painel');
    const actor = { id: caller.id, email: caller.email };

    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = body.role as Role;
      const storeId = (body.store_id as string) || null;
      const fullName = String(body.full_name ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'E-mail inválido');
      validateScope(role, storeId);
      if (!canManage(callerRoles, role, storeId)) throw new HttpError(403, 'Você não pode conceder este acesso');

      let userId = await findUserByEmail(email);
      let password: string | null = null;
      if (!userId) {
        password = String(body.password ?? '') || randomPassword();
        if (password.length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres');
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName || email.split('@')[0] },
        });
        if (error || !created.user) throw new HttpError(400, error?.message ?? 'Falha ao criar usuário');
        userId = created.user.id;
        await admin.from('profiles').upsert({ user_id: userId, email, full_name: fullName || email.split('@')[0] });
      } else if (fullName) {
        await admin.from('profiles').update({ full_name: fullName }).eq('user_id', userId);
      }

      let existing = admin.from('staff').select('id').eq('user_id', userId);
      existing = storeId ? existing.eq('store_id', storeId) : existing.is('store_id', null);
      const { data: current } = await existing.maybeSingle();
      let staffId: string = current?.id;
      if (staffId) {
        await admin.from('staff').update({ role, active: true }).eq('id', staffId);
      } else {
        const { data: ins, error } = await admin
          .from('staff')
          .insert({ user_id: userId, store_id: storeId, role, created_by: caller.id })
          .select('id')
          .single();
        if (error) throw new HttpError(400, error.message);
        staffId = ins.id;
      }
      await audit(actor, 'insert', staffId, storeId, { email, role, store_id: storeId });
      return json({ staff_id: staffId, user_id: userId, email, password, existing_user: password === null });
    }

    if (action === 'update') {
      const staffId = String(body.staff_id ?? '');
      const { data: row } = await admin.from('staff').select('id,user_id,store_id,role,active').eq('id', staffId).maybeSingle();
      if (!row) throw new HttpError(404, 'Acesso não encontrado');
      const newRole = (body.role ?? row.role) as Role;
      const newActive = typeof body.active === 'boolean' ? body.active : row.active;
      validateScope(newRole, row.store_id);
      if (!canManage(callerRoles, row.role as Role, row.store_id) || !canManage(callerRoles, newRole, row.store_id)) {
        throw new HttpError(403, 'Você não pode alterar este acesso');
      }
      if (row.role === 'super_admin' && (newRole !== 'super_admin' || !newActive) && (await lastSuperAdmin(row.id))) {
        throw new HttpError(400, 'A rede precisa de pelo menos um super admin ativo');
      }
      await admin.from('staff').update({ role: newRole, active: newActive }).eq('id', staffId);
      await audit(actor, 'update', staffId, row.store_id, { role: { de: row.role, para: newRole }, active: { de: row.active, para: newActive } });
      return json({ ok: true });
    }

    if (action === 'remove') {
      const staffId = String(body.staff_id ?? '');
      const { data: row } = await admin.from('staff').select('id,user_id,store_id,role').eq('id', staffId).maybeSingle();
      if (!row) throw new HttpError(404, 'Acesso não encontrado');
      if (!canManage(callerRoles, row.role as Role, row.store_id)) throw new HttpError(403, 'Você não pode remover este acesso');
      if (row.role === 'super_admin' && (await lastSuperAdmin(row.id))) {
        throw new HttpError(400, 'A rede precisa de pelo menos um super admin ativo');
      }
      await admin.from('staff').delete().eq('id', staffId);
      await audit(actor, 'delete', staffId, row.store_id, row);
      return json({ ok: true });
    }

    if (action === 'reset_password') {
      const userId = String(body.user_id ?? '');
      const target = await membershipsOf(userId);
      if (!target.length) throw new HttpError(404, 'Usuário não encontrado na equipe');
      const allowed = userId === caller.id || target.every((m) => canManage(callerRoles, m.role, m.store_id));
      if (!allowed) throw new HttpError(403, 'Você não pode redefinir a senha desta pessoa');
      const password = String(body.password ?? '') || randomPassword();
      if (password.length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres');
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw new HttpError(400, error.message);
      await audit(actor, 'update', userId, target[0]?.store_id ?? null, { senha: 'redefinida' });
      return json({ ok: true, password: body.password ? null : password });
    }

    if (action === 'list') {
      // Equipe visível para quem chama (rede: todos; admin de loja: a própria loja)
      const isGlobal = callerRoles.some((m) => m.active && GLOBAL_ROLES.includes(m.role));
      const myStores = callerRoles.filter((m) => m.active && m.role === 'store_admin').map((m) => m.store_id);
      let q = admin.from('staff').select('id,user_id,store_id,role,active,created_at');
      if (!isGlobal) {
        if (!myStores.length) throw new HttpError(403, 'Sem permissão para ver a equipe');
        q = q.in('store_id', myStores as string[]);
      }
      if (body.store_id) q = q.eq('store_id', body.store_id);
      const { data: rows, error } = await q.order('created_at');
      if (error) throw new HttpError(500, error.message);
      const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
      const { data: profs } = ids.length
        ? await admin.from('profiles').select('user_id,email,full_name').in('user_id', ids)
        : { data: [] };
      const lastSignIn: Record<string, string | null> = {};
      for (const id of ids) {
        const { data } = await admin.auth.admin.getUserById(id);
        lastSignIn[id] = data?.user?.last_sign_in_at ?? null;
      }
      const byId = Object.fromEntries((profs ?? []).map((p) => [p.user_id, p]));
      return json({
        rows: (rows ?? []).map((r) => ({
          ...r,
          email: byId[r.user_id]?.email ?? null,
          full_name: byId[r.user_id]?.full_name ?? null,
          last_sign_in_at: lastSignIn[r.user_id],
        })),
      });
    }

    throw new HttpError(400, 'Ação desconhecida');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, status);
  }
});
