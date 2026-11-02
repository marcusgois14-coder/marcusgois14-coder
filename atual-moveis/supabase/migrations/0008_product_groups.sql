-- Mesmo produto em várias lojas
-- Cada loja tem a sua cópia do produto (preço, estoque e status próprios). As cópias do mesmo produto em lojas
-- diferentes compartilham products.group_id, o que permite:
--   * cadastrar um produto já em várias lojas (insere em uma loja e copia para as outras com duplicate_products)
--   * ver em quais lojas o produto está e acrescentar outras
--   * aplicar uma edição nas outras lojas de uma vez (sync_product_group)
-- Uma loja tem no máximo uma cópia de cada grupo. Uma cópia dentro da mesma loja é outro produto (outro grupo).

alter table public.products add column if not exists group_id uuid;

-- Produtos já cadastrados: o mesmo SKU em lojas diferentes é o mesmo produto.
-- Sem os gatilhos de auditoria/updated_at: é só a ligação entre cópias, não uma edição de produto.
alter table public.products disable trigger products_audit;
alter table public.products disable trigger products_touch;
with g as (
  select sku, gen_random_uuid() as gid
  from public.products
  where sku is not null and group_id is null
  group by sku
)
update public.products p
set group_id = g.gid
from g
where p.sku = g.sku
  and p.group_id is null
  -- só agrupa se o SKU não se repete dentro de uma mesma loja
  and not exists (
    select 1 from public.products d
    where d.sku = p.sku and d.store_id = p.store_id and d.id <> p.id
  );
update public.products set group_id = gen_random_uuid() where group_id is null;
alter table public.products enable trigger products_touch;
alter table public.products enable trigger products_audit;

alter table public.products alter column group_id set default gen_random_uuid();
alter table public.products alter column group_id set not null;
create index if not exists products_group_idx on public.products (group_id);
create unique index if not exists products_group_store_unique on public.products (group_id, store_id);

-- ---------- Copiar produtos para outras lojas ----------
-- Agora a cópia fica ligada ao original (mesmo group_id), leva fotos principais, 3D e, se pedido, o estoque.
-- Lojas que já têm uma cópia do produto são puladas.
drop function if exists public.duplicate_products(uuid[], uuid[], text);
create or replace function public.duplicate_products(
  p_ids uuid[],
  p_targets uuid[],
  p_status text default 'draft',
  p_keep_stock boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  src public.products%rowtype;
  tgt uuid;
  new_id uuid;
  new_slug text;
  n int;
  created int := 0;
  skipped int := 0;
  items jsonb := '[]'::jsonb;
begin
  if p_status not in ('active', 'draft', 'archived') then p_status := 'draft'; end if;
  foreach tgt in array coalesce(p_targets, '{}') loop
    if not public.has_perm(tgt, 'catalog') then perform public.biz_error('FORBIDDEN'); end if;
  end loop;

  for src in select * from public.products where id = any (coalesce(p_ids, '{}')) loop
    if not public.has_perm(src.store_id, 'view') then perform public.biz_error('FORBIDDEN'); end if;
    foreach tgt in array coalesce(p_targets, '{}') loop
      if tgt = src.store_id
         or exists (select 1 from public.products e where e.group_id = src.group_id and e.store_id = tgt) then
        skipped := skipped + 1;
        continue;
      end if;
      new_slug := src.slug;
      n := 1;
      while exists (select 1 from public.products where store_id = tgt and slug = new_slug) loop
        n := n + 1;
        new_slug := src.slug || '-' || n;
      end loop;
      insert into public.products (store_id, group_id, category_id, sku, name, slug, short_description, description, brand, price,
        compare_at_price, cost_price, stock_qty, track_stock, low_stock_threshold, status, is_new, free_shipping, fast_delivery,
        is_promo, weight_kg, width_cm, height_cm, depth_cm, warranty, specs, tags, seo_title, seo_description,
        image_url, image2_url, model3d, model_url, created_by)
      values (tgt, src.group_id, src.category_id, src.sku, src.name, new_slug, src.short_description, src.description, src.brand, src.price,
        src.compare_at_price, src.cost_price, case when p_keep_stock then src.stock_qty else 0 end, src.track_stock, src.low_stock_threshold,
        p_status, src.is_new, src.free_shipping, src.fast_delivery, src.is_promo, src.weight_kg, src.width_cm, src.height_cm, src.depth_cm,
        src.warranty, src.specs, src.tags, src.seo_title, src.seo_description,
        src.image_url, src.image2_url, src.model3d, src.model_url, (select auth.uid()))
      returning id into new_id;
      insert into public.product_images (product_id, store_id, url, alt, sort_order)
        select new_id, tgt, url, alt, sort_order from public.product_images where product_id = src.id;
      insert into public.product_variants (product_id, store_id, name, color, image_url, sku, price_override, stock_qty, active, sort_order)
        select new_id, tgt, name, color, image_url, sku, price_override,
          case when stock_qty is null then null when p_keep_stock then stock_qty else 0 end, active, sort_order
          from public.product_variants where product_id = src.id;
      created := created + 1;
      items := items || jsonb_build_object('source_id', src.id, 'store_id', tgt, 'product_id', new_id);
    end loop;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped, 'items', items);
end;
$$;

-- ---------- Aplicar uma edição nas outras lojas ----------
-- p_parts escolhe o que copiar do produto de origem para as cópias das lojas em p_targets (mesmo group_id):
--   info      nome, SKU, categoria, descrições, marca, garantia, especificações, tags, medidas, selos, SEO e 3D
--   images    fotos (principais e galeria)
--   price     preço, preço "de" e custo
--   stock     estoque do produto e das variações com o mesmo nome
--   status    ativo / rascunho / arquivado
--   variants  variações: atualiza as de mesmo nome, cria as que faltam, desativa as que sumiram
-- O slug de cada loja nunca muda.
create or replace function public.sync_product_group(
  p_source uuid,
  p_targets uuid[],
  p_parts text[] default array['info', 'images']
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  src public.products%rowtype;
  tgt public.products%rowtype;
  parts text[] := coalesce(p_parts, '{}');
  updated int := 0;
begin
  select * into src from public.products where id = p_source;
  if not found then perform public.biz_error('PRODUCT_NOT_FOUND'); end if;
  if not public.has_perm(src.store_id, 'catalog') then perform public.biz_error('FORBIDDEN'); end if;
  if exists (select 1 from unnest(parts) p where p not in ('info', 'images', 'price', 'stock', 'status', 'variants')) then
    perform public.biz_error('INVALID_PARTS');
  end if;

  for tgt in
    select * from public.products
    where group_id = src.group_id and id <> src.id and store_id = any (coalesce(p_targets, '{}'))
  loop
    if not public.has_perm(tgt.store_id, 'catalog') then perform public.biz_error('FORBIDDEN'); end if;

    if 'info' = any (parts) then
      update public.products set
        name = src.name, sku = src.sku, category_id = src.category_id, short_description = src.short_description,
        description = src.description, brand = src.brand, warranty = src.warranty, specs = src.specs, tags = src.tags,
        weight_kg = src.weight_kg, width_cm = src.width_cm, height_cm = src.height_cm, depth_cm = src.depth_cm,
        is_new = src.is_new, free_shipping = src.free_shipping, fast_delivery = src.fast_delivery, is_promo = src.is_promo,
        seo_title = src.seo_title, seo_description = src.seo_description, model3d = src.model3d, model_url = src.model_url,
        updated_by = (select auth.uid())
      where id = tgt.id;
    end if;

    if 'images' = any (parts) then
      update public.products set image_url = src.image_url, image2_url = src.image2_url, updated_by = (select auth.uid())
      where id = tgt.id;
      delete from public.product_images where product_id = tgt.id;
      insert into public.product_images (product_id, store_id, url, alt, sort_order)
        select tgt.id, tgt.store_id, url, alt, sort_order from public.product_images where product_id = src.id;
    end if;

    if 'price' = any (parts) then
      update public.products set price = src.price, compare_at_price = src.compare_at_price, cost_price = src.cost_price,
        updated_by = (select auth.uid())
      where id = tgt.id;
    end if;

    if 'stock' = any (parts) then
      update public.products set stock_qty = src.stock_qty, track_stock = src.track_stock,
        low_stock_threshold = src.low_stock_threshold, updated_by = (select auth.uid())
      where id = tgt.id;
      update public.product_variants tv set stock_qty = sv.stock_qty
        from public.product_variants sv
        where sv.product_id = src.id and tv.product_id = tgt.id and lower(tv.name) = lower(sv.name);
    end if;

    if 'status' = any (parts) then
      update public.products set status = src.status, updated_by = (select auth.uid()) where id = tgt.id;
    end if;

    if 'variants' = any (parts) then
      update public.product_variants tv set
        color = sv.color, image_url = sv.image_url, sku = sv.sku, price_override = sv.price_override,
        active = sv.active, sort_order = sv.sort_order
        from public.product_variants sv
        where sv.product_id = src.id and tv.product_id = tgt.id and lower(tv.name) = lower(sv.name);
      insert into public.product_variants (product_id, store_id, name, color, image_url, sku, price_override, stock_qty, active, sort_order)
        select tgt.id, tgt.store_id, sv.name, sv.color, sv.image_url, sv.sku, sv.price_override,
          case when sv.stock_qty is null then null else 0 end, sv.active, sv.sort_order
        from public.product_variants sv
        where sv.product_id = src.id
          and not exists (select 1 from public.product_variants tv where tv.product_id = tgt.id and lower(tv.name) = lower(sv.name));
      update public.product_variants tv set active = false
        where tv.product_id = tgt.id
          and not exists (select 1 from public.product_variants sv where sv.product_id = src.id and lower(sv.name) = lower(tv.name));
    end if;

    updated := updated + 1;
  end loop;
  return jsonb_build_object('updated', updated);
end;
$$;

revoke execute on function public.duplicate_products(uuid[], uuid[], text, boolean) from public, anon;
revoke execute on function public.sync_product_group(uuid, uuid[], text[]) from public, anon;
grant execute on function public.duplicate_products(uuid[], uuid[], text, boolean) to authenticated;
grant execute on function public.sync_product_group(uuid, uuid[], text[]) to authenticated;
