-- Tokens de uso único para criar o primeiro super admin (consumidos pela edge function admin-users).
-- Guardamos só o hash SHA-256; a tabela não tem políticas (só a service role acessa).
create table if not exists public.bootstrap_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.bootstrap_tokens enable row level security;
revoke all on public.bootstrap_tokens from anon, authenticated;
