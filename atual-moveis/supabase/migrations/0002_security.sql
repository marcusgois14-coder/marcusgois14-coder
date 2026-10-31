-- =========================================================
-- 0002: permissões, RLS, auditoria, storage e realtime
-- =========================================================

-- ---------- Funções de permissão ----------
create or replace function public.try_uuid(txt text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return txt::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.active and s.role in ('super_admin', 'network_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.active and s.role = 'super_admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active);
$$;

-- Permissões por loja:
--   view       qualquer membro da loja
--   catalog    produtos, coleções, banners      (admin, gerente, editor)
--   orders     pedidos                          (admin, gerente, operador)
--   customers  clientes                         (admin, gerente, operador)
--   coupons    cupons                           (admin, gerente)
--   settings   dados da loja, entrega, pagamento (admin)
--   staff      equipe da loja                   (admin)
-- Administradores da rede têm todas as permissões em todas as lojas.
create or replace function public.has_perm(p_store uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid())
      and s.active
      and (
        s.role in ('super_admin', 'network_admin')
        or (
          p_store is not null and s.store_id = p_store and case p_perm
            when 'view' then true
            when 'catalog' then s.role in ('store_admin', 'store_manager', 'store_editor')
            when 'orders' then s.role in ('store_admin', 'store_manager', 'store_operator')
            when 'customers' then s.role in ('store_admin', 'store_manager', 'store_operator')
            when 'coupons' then s.role in ('store_admin', 'store_manager')
            when 'settings' then s.role = 'store_admin'
            when 'staff' then s.role = 'store_admin'
            else false
          end
        )
      )
  );
$$;

-- ---------- Perfil automático ao criar usuário ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Travas de lojas ----------
-- Só a rede muda slug, status, ordem e marca; o raio nunca passa do limite da rede.
create or replace function public.stores_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_radius numeric;
begin
  if not public.is_global_admin() and (select auth.uid()) is not null then
    if new.slug is distinct from old.slug
       or new.active is distinct from old.active
       or new.sort_order is distinct from old.sort_order
       or new.brand_name is distinct from old.brand_name then
      raise exception 'Somente a administração da rede pode alterar slug, marca, ordem ou ativação da loja';
    end if;
    select default_radius_km into max_radius from public.network_settings where id = 1;
    if max_radius is not null and new.delivery_radius_km > max_radius then
      raise exception 'O raio de entrega não pode passar de % km', max_radius;
    end if;
  end if;
  return new;
end;
$$;
create trigger stores_guard before update on public.stores for each row execute function public.stores_guard();

-- ---------- Travas de pedidos ----------
-- Valores, itens e status só mudam pelas funções oficiais (que ligam o flag atual.rpc).
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('atual.rpc', true), '') = 'on' then
    return new;
  end if;
  if new.store_id is distinct from old.store_id
     or new.number is distinct from old.number
     or new.status is distinct from old.status
     or new.payment_status is distinct from old.payment_status
     or new.payment_method is distinct from old.payment_method
     or new.subtotal is distinct from old.subtotal
     or new.discount_coupon is distinct from old.discount_coupon
     or new.discount_pix is distinct from old.discount_pix
     or new.delivery_fee is distinct from old.delivery_fee
     or new.total is distinct from old.total
     or new.coupon_id is distinct from old.coupon_id
     or new.tracking_token is distinct from old.tracking_token
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.distance_km is distinct from old.distance_km
     or new.restocked is distinct from old.restocked
     or new.created_at is distinct from old.created_at then
    raise exception 'Use as ações do pedido para alterar status, pagamento ou valores';
  end if;
  return new;
end;
$$;
create trigger orders_guard before update on public.orders for each row execute function public.orders_guard();

-- ---------- Auditoria ----------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  diff jsonb;
  sid uuid;
  rid text;
begin
  if actor is null then
    return null; -- ações do sistema/clientes não entram na auditoria de equipe
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('de', old_j -> k, 'para', new_j -> k)), '{}'::jsonb)
      into diff
      from jsonb_object_keys(new_j) k
     where k not in ('updated_at', 'updated_by') and (old_j -> k) is distinct from (new_j -> k);
    if diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    diff := new_j;
  else
    diff := old_j;
  end if;
  rid := coalesce(new_j ->> 'id', old_j ->> 'id');
  sid := case when tg_table_name = 'stores' then public.try_uuid(rid)
              else public.try_uuid(coalesce(new_j ->> 'store_id', old_j ->> 'store_id')) end;
  insert into public.audit_log (actor_id, actor_email, store_id, table_name, record_id, action, changes)
  values (actor, (select auth.jwt()) ->> 'email', sid, tg_table_name, rid, lower(tg_op), diff);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['network_settings', 'stores', 'categories', 'products', 'product_variants',
                           'collections', 'banners', 'announcements', 'coupons', 'staff', 'customers'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;
create trigger orders_audit after update or delete on public.orders for each row execute function public.audit_row();

-- ---------- RLS ----------
alter table public.network_settings enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.banners enable row level security;
alter table public.announcements enable row level security;
alter table public.coupons enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.geocode_cache enable row level security;

-- O público (anon) não lê tabelas: a vitrine usa apenas as funções públicas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- network_settings
create policy "rede: equipe lê" on public.network_settings for select to authenticated using ((select public.is_staff()));
create policy "rede: admin rede altera" on public.network_settings for update to authenticated
  using ((select public.is_global_admin())) with check ((select public.is_global_admin()));

-- stores
create policy "lojas: equipe lê as suas" on public.stores for select to authenticated
  using ((select public.is_global_admin()) or public.has_perm(id, 'view'));
create policy "lojas: rede cria" on public.stores for insert to authenticated with check ((select public.is_global_admin()));
create policy "lojas: rede ou admin da loja altera" on public.stores for update to authenticated
  using (public.has_perm(id, 'settings')) with check (public.has_perm(id, 'settings'));
create policy "lojas: rede exclui" on public.stores for delete to authenticated using ((select public.is_global_admin()));

-- profiles
create policy "perfis: leitura" on public.profiles for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.is_global_admin())
  or exists (select 1 from public.staff s where s.user_id = profiles.user_id and s.store_id is not null and public.has_perm(s.store_id, 'staff'))
);
create policy "perfis: o próprio altera" on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_global_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_global_admin()));

-- staff (escrita só pela edge function admin-users)
create policy "equipe: leitura" on public.staff for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.is_global_admin())
  or (store_id is not null and public.has_perm(store_id, 'staff'))
);

-- categories
create policy "categorias: equipe lê" on public.categories for select to authenticated using ((select public.is_staff()));
create policy "categorias: rede escreve" on public.categories for all to authenticated
  using ((select public.is_global_admin())) with check ((select public.is_global_admin()));

-- products e filhos
create policy "produtos: leitura" on public.products for select to authenticated using (public.has_perm(store_id, 'view'));
create policy "produtos: catálogo insere" on public.products for insert to authenticated with check (public.has_perm(store_id, 'catalog'));
create policy "produtos: catálogo altera" on public.products for update to authenticated
  using (public.has_perm(store_id, 'catalog')) with check (public.has_perm(store_id, 'catalog'));
create policy "produtos: catálogo exclui" on public.products for delete to authenticated using (public.has_perm(store_id, 'catalog'));

create policy "imagens: leitura" on public.product_images for select to authenticated using (public.has_perm(store_id, 'view'));
create policy "imagens: catálogo escreve" on public.product_images for all to authenticated
  using (public.has_perm(store_id, 'catalog'))
  with check (exists (select 1 from public.products p where p.id = product_id and public.has_perm(p.store_id, 'catalog')));

create policy "variações: leitura" on public.product_variants for select to authenticated using (public.has_perm(store_id, 'view'));
create policy "variações: catálogo escreve" on public.product_variants for all to authenticated
  using (public.has_perm(store_id, 'catalog'))
  with check (exists (select 1 from public.products p where p.id = product_id and public.has_perm(p.store_id, 'catalog')));

-- collections
create policy "coleções: leitura" on public.collections for select to authenticated using (public.has_perm(store_id, 'view'));
create policy "coleções: catálogo escreve" on public.collections for all to authenticated
  using (public.has_perm(store_id, 'catalog')) with check (public.has_perm(store_id, 'catalog'));

create policy "itens de coleção: leitura" on public.collection_items for select to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and public.has_perm(c.store_id, 'view')));
create policy "itens de coleção: catálogo escreve" on public.collection_items for all to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and public.has_perm(c.store_id, 'catalog')))
  with check (exists (select 1 from public.collections c where c.id = collection_id and public.has_perm(c.store_id, 'catalog')));

-- banners e avisos (store_id nulo = rede)
create policy "banners: leitura" on public.banners for select to authenticated
  using ((store_id is null and (select public.is_staff())) or public.has_perm(store_id, 'view'));
create policy "banners: escrita" on public.banners for all to authenticated
  using (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'catalog') end)
  with check (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'catalog') end);

create policy "avisos: leitura" on public.announcements for select to authenticated
  using ((store_id is null and (select public.is_staff())) or public.has_perm(store_id, 'view'));
create policy "avisos: escrita" on public.announcements for all to authenticated
  using (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'catalog') end)
  with check (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'catalog') end);

-- coupons
create policy "cupons: leitura" on public.coupons for select to authenticated
  using ((store_id is null and (select public.is_staff())) or public.has_perm(store_id, 'coupons'));
create policy "cupons: escrita" on public.coupons for all to authenticated
  using (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'coupons') end)
  with check (case when store_id is null then (select public.is_global_admin()) else public.has_perm(store_id, 'coupons') end);

-- customers (visíveis para quem atende pedidos da loja em que o cliente comprou)
create policy "clientes: leitura" on public.customers for select to authenticated using (
  (select public.is_global_admin())
  or exists (select 1 from public.orders o where o.customer_id = customers.id and public.has_perm(o.store_id, 'customers'))
);
create policy "clientes: altera" on public.customers for update to authenticated using (
  (select public.is_global_admin())
  or exists (select 1 from public.orders o where o.customer_id = customers.id and public.has_perm(o.store_id, 'customers'))
);
create policy "clientes: rede exclui" on public.customers for delete to authenticated using ((select public.is_global_admin()));

-- orders
create policy "pedidos: leitura" on public.orders for select to authenticated using (public.has_perm(store_id, 'orders'));
create policy "pedidos: altera" on public.orders for update to authenticated
  using (public.has_perm(store_id, 'orders')) with check (public.has_perm(store_id, 'orders'));
create policy "pedidos: rede exclui" on public.orders for delete to authenticated using ((select public.is_global_admin()));

create policy "itens do pedido: leitura" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.has_perm(o.store_id, 'orders')));
create policy "eventos do pedido: leitura" on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.has_perm(o.store_id, 'orders')));

-- audit_log
create policy "auditoria: leitura" on public.audit_log for select to authenticated
  using ((select public.is_global_admin()) or (store_id is not null and public.has_perm(store_id, 'settings')));

-- ---------- Storage (imagens) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Pastas: network/... (só a rede) e stores/<id da loja>/... (equipe de catálogo da loja). SVG só para a rede.
create policy "media: equipe lista" on storage.objects for select to authenticated using (
  bucket_id = 'media' and (
    (select public.is_global_admin())
    or (storage.foldername(name))[1] = 'network'
    or ((storage.foldername(name))[1] = 'stores' and public.has_perm(public.try_uuid((storage.foldername(name))[2]), 'view'))
  )
);
create policy "media: envia" on storage.objects for insert to authenticated with check (
  bucket_id = 'media'
  and (storage.extension(name) <> 'svg' or (select public.is_global_admin()))
  and (
    (select public.is_global_admin())
    or ((storage.foldername(name))[1] = 'stores' and public.has_perm(public.try_uuid((storage.foldername(name))[2]), 'catalog'))
  )
);
create policy "media: altera" on storage.objects for update to authenticated using (
  bucket_id = 'media' and (
    (select public.is_global_admin())
    or ((storage.foldername(name))[1] = 'stores' and public.has_perm(public.try_uuid((storage.foldername(name))[2]), 'catalog'))
  )
);
create policy "media: exclui" on storage.objects for delete to authenticated using (
  bucket_id = 'media' and (
    (select public.is_global_admin())
    or ((storage.foldername(name))[1] = 'stores' and public.has_perm(public.try_uuid((storage.foldername(name))[2]), 'catalog'))
  )
);

-- ---------- Realtime: novos pedidos aparecem na hora no painel ----------
alter publication supabase_realtime add table public.orders;
