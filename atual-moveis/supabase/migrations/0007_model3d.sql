-- 3D automático dos produtos.
-- O modelo 3D de cada produto é gerado no navegador a partir da categoria, das medidas, do nome e das cores
-- (nenhum passo manual ao cadastrar). Estes campos são só ajustes opcionais:
--   categories.model_kind  tipo de modelo 3D da categoria (null = automático pelo nome/slug)
--   products.model3d       ajustes do produto: {"kind": "...", "style": {...}, "colors": {...}} (vazio = automático)
--   products.model_url     arquivo .glb próprio (do fabricante), que substitui o modelo gerado

alter table public.categories add column if not exists model_kind text;
alter table public.products add column if not exists model3d jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists model_url text;

do $$
begin
  alter table public.categories add constraint categories_model_kind_check check (model_kind is null or model_kind in (
    'sofa', 'armchair', 'chair', 'bed', 'mattress', 'coffee_table', 'side_table', 'dining_table', 'dresser', 'nightstand',
    'wardrobe', 'rack', 'shelf', 'desk', 'tv', 'fridge', 'washer', 'stove', 'small_appliance', 'generic', 'none'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products add constraint products_model3d_object check (jsonb_typeof(model3d) = 'object');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products add constraint products_model_url_https check (model_url is null or model_url ~ '^https://');
exception when duplicate_object then null;
end $$;

create or replace function public.get_storefront(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.stores%rowtype;
  result jsonb;
begin
  select * into s from public.stores where slug = p_slug and active;
  if not found then
    return null;
  end if;

  with prods as (
    select p.* from public.products p where p.store_id = s.id and p.status = 'active'
  )
  select jsonb_build_object(
    'network', (select jsonb_build_object(
        'name', n.name, 'tagline', n.tagline, 'slogan', n.slogan, 'logo_url', n.logo_url, 'logo_white_url', n.logo_white_url,
        'primary_color', n.primary_color, 'accent_color', n.accent_color, 'support_whatsapp', n.support_whatsapp,
        'instagram', n.instagram, 'facebook', n.facebook, 'benefits', n.benefits, 'marquee', n.marquee,
        'popular_searches', n.popular_searches, 'seo_title', n.seo_title, 'seo_description', n.seo_description,
        'footer_legal', n.footer_legal, 'default_radius_km', n.default_radius_km)
      from public.network_settings n where n.id = 1),
    'store', jsonb_build_object(
        'id', s.id, 'slug', s.slug, 'name', s.name, 'brand_name', s.brand_name, 'city', s.city, 'state', s.state,
        'cep', s.cep, 'street', s.street, 'number', s.number, 'district', s.district, 'complement', s.complement,
        'lat', s.lat, 'lng', s.lng, 'delivery_radius_km', s.delivery_radius_km, 'phone', s.phone, 'whatsapp', s.whatsapp,
        'email', s.email, 'hours', s.hours, 'instagram', s.instagram, 'facebook', s.facebook,
        'payment_methods', s.payment_methods, 'pix_discount_pct', s.pix_discount_pct, 'max_installments', s.max_installments,
        'min_installment_value', s.min_installment_value, 'free_shipping_min', s.free_shipping_min,
        'delivery_fee_tiers', s.delivery_fee_tiers, 'min_order_value', s.min_order_value,
        'delivery_lead_time', s.delivery_lead_time, 'accepts_orders', s.accepts_orders, 'closed_message', s.closed_message,
        'marquee', s.marquee),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'parent_id', c.parent_id, 'name', c.name, 'slug', c.slug, 'description', c.description,
        'image_url', c.image_url, 'sort_order', c.sort_order, 'show_in_strip', c.show_in_strip, 'model_kind', c.model_kind,
        'product_count', (select count(*) from prods p where p.category_id = c.id)
      ) order by c.sort_order, c.name), '[]'::jsonb)
      from public.categories c where c.active),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'category_id', p.category_id, 'sku', p.sku, 'name', p.name, 'slug', p.slug,
        'short_description', p.short_description, 'description', p.description, 'brand', p.brand,
        'price', p.price, 'compare_at_price', p.compare_at_price,
        'in_stock', (not p.track_stock or p.stock_qty > 0),
        'low_stock', (p.track_stock and p.stock_qty > 0 and p.stock_qty <= p.low_stock_threshold),
        'is_new', p.is_new, 'free_shipping', p.free_shipping, 'fast_delivery', p.fast_delivery, 'is_promo', p.is_promo,
        'weight_kg', p.weight_kg, 'width_cm', p.width_cm, 'height_cm', p.height_cm, 'depth_cm', p.depth_cm,
        'warranty', p.warranty, 'specs', p.specs, 'tags', p.tags,
        'image_url', p.image_url, 'image2_url', p.image2_url, 'sold_count', p.sold_count, 'created_at', p.created_at,
        'model3d', p.model3d, 'model_url', p.model_url,
        'images', (select coalesce(jsonb_agg(jsonb_build_object('url', i.url, 'alt', i.alt) order by i.sort_order, i.created_at), '[]'::jsonb)
                   from public.product_images i where i.product_id = p.id),
        'variants', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', v.id, 'name', v.name, 'color', v.color, 'image_url', v.image_url, 'price', coalesce(v.price_override, p.price),
                        'in_stock', (not p.track_stock or coalesce(v.stock_qty, p.stock_qty) > 0)
                      ) order by v.sort_order, v.created_at), '[]'::jsonb)
                     from public.product_variants v where v.product_id = p.id and v.active)
      ) order by p.created_at desc), '[]'::jsonb) from prods p),
    'collections', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', c.key, 'title', c.title, 'subtitle', c.subtitle, 'layout', c.layout, 'badge_all', c.badge_all,
        'show_on_home', c.show_on_home,
        'product_ids', (select coalesce(jsonb_agg(ci.product_id order by ci.sort_order), '[]'::jsonb)
                        from public.collection_items ci join prods p on p.id = ci.product_id
                        where ci.collection_id = c.id)
      ) order by c.sort_order, c.title), '[]'::jsonb)
      from public.collections c where c.store_id = s.id and c.active),
    'banners', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'title', b.title, 'kicker', b.kicker, 'text', b.text,
        'image_url', b.image_url, 'image_mobile_url', b.image_mobile_url, 'link_url', b.link_url,
        'scope', case when b.store_id is null then 'network' else 'store' end,
        'pins', (select coalesce(jsonb_agg(x.pid order by x.ord), '[]'::jsonb)
                 from unnest(b.pin_product_ids) with ordinality x(pid, ord)
                 where exists (select 1 from prods p where p.id = x.pid))
      ) order by b.kind, (b.store_id is null), b.sort_order), '[]'::jsonb)
      from public.banners b
      where b.active and (b.store_id = s.id or b.store_id is null)
        and (b.starts_at is null or b.starts_at <= now()) and (b.ends_at is null or b.ends_at >= now())),
    'announcements', (select coalesce(jsonb_agg(jsonb_build_object('text', a.text, 'cta_label', a.cta_label, 'cta_url', a.cta_url)
        order by (a.store_id is null), a.sort_order), '[]'::jsonb)
      from public.announcements a
      where a.active and (a.store_id = s.id or a.store_id is null)
        and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at >= now()))
  ) into result;

  return result;
end;
$$;

-- Bucket de mídia também aceita modelos .glb (até 25 MB)
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'model/gltf-binary']
 where id = 'media';
