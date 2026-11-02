-- =========================================================
-- 0003: regras de negócio (funções chamadas pela vitrine e pelo painel)
-- Erros de negócio saem como exceções P0001 com um código em `message`
-- e um complemento em `detail` (a vitrine traduz para o cliente).
-- =========================================================

-- ---------- Utilitários ----------
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 2);
$$;

create or replace function public.only_digits(txt text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(txt, ''), '[^0-9]', '', 'g');
$$;

create or replace function public.cpf_is_valid(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := public.only_digits(p_cpf);
  s int;
  r int;
  i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then
    return false;
  end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end;
$$;

create or replace function public.biz_error(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

-- Frete pela faixa de distância da loja
create or replace function public.delivery_fee_for(p_store public.stores, p_dist numeric, p_subtotal numeric, p_all_free boolean)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  fee numeric;
begin
  if p_all_free then
    return 0;
  end if;
  if p_store.free_shipping_min is not null and p_subtotal >= p_store.free_shipping_min then
    return 0;
  end if;
  select (e ->> 'fee')::numeric into fee
    from jsonb_array_elements(p_store.delivery_fee_tiers) e
   where (e ->> 'up_to_km')::numeric >= p_dist
   order by (e ->> 'up_to_km')::numeric
   limit 1;
  if fee is null then
    select max((e ->> 'fee')::numeric) into fee from jsonb_array_elements(p_store.delivery_fee_tiers) e;
  end if;
  return round(coalesce(fee, 0), 2);
end;
$$;

-- Avalia um cupom (sem consumir)
create or replace function public.coupon_eval(p_store uuid, p_code text, p_subtotal numeric, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.coupons%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  used int;
  disc numeric := 0;
begin
  if v_code = '' then
    return jsonb_build_object('valid', false, 'message', 'Informe um cupom');
  end if;
  select * into c from public.coupons
   where code = v_code and active and (store_id = p_store or store_id is null)
   order by store_id nulls last
   limit 1;
  if not found then
    return jsonb_build_object('valid', false, 'message', 'Cupom não encontrado');
  end if;
  if c.starts_at is not null and c.starts_at > now() then
    return jsonb_build_object('valid', false, 'message', 'Este cupom ainda não está valendo');
  end if;
  if c.ends_at is not null and c.ends_at < now() then
    return jsonb_build_object('valid', false, 'message', 'Este cupom expirou');
  end if;
  if c.usage_limit is not null and c.used_count >= c.usage_limit then
    return jsonb_build_object('valid', false, 'message', 'Este cupom esgotou');
  end if;
  if c.per_phone_limit is not null and p_phone is not null then
    select count(*) into used from public.orders
     where coupon_id = c.id and customer_phone = public.only_digits(p_phone) and status <> 'canceled';
    if used >= c.per_phone_limit then
      return jsonb_build_object('valid', false, 'message', 'Você já usou este cupom');
    end if;
  end if;
  if p_subtotal < c.min_order then
    return jsonb_build_object('valid', false, 'message',
      'Pedido mínimo de R$ ' || replace(to_char(c.min_order, 'FM999G999G990D00'), ',', '.') || ' para este cupom');
  end if;
  if c.type = 'percent' then
    disc := round(p_subtotal * c.value / 100, 2);
  elsif c.type = 'fixed' then
    disc := least(c.value, p_subtotal);
  end if;
  if c.max_discount is not null then
    disc := least(disc, c.max_discount);
  end if;
  return jsonb_build_object('valid', true, 'id', c.id, 'code', c.code, 'type', c.type, 'value', c.value,
                            'discount', disc, 'description', c.description, 'message', 'Cupom aplicado');
end;
$$;

-- ---------- Funções públicas da vitrine ----------
create or replace function public.list_stores()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name', s.name, 'brand_name', s.brand_name,
    'city', s.city, 'state', s.state, 'street', s.street, 'number', s.number, 'district', s.district, 'cep', s.cep,
    'lat', s.lat, 'lng', s.lng, 'delivery_radius_km', s.delivery_radius_km,
    'phone', s.phone, 'whatsapp', s.whatsapp, 'hours', s.hours,
    'accepts_orders', s.accepts_orders, 'closed_message', s.closed_message
  ) order by s.sort_order, s.name), '[]'::jsonb)
  from public.stores s
  where s.active;
$$;

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
        'image_url', c.image_url, 'sort_order', c.sort_order, 'show_in_strip', c.show_in_strip,
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

create or replace function public.quote_delivery(p_store uuid, p_lat double precision, p_lng double precision, p_subtotal numeric default 0, p_all_free boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.stores%rowtype;
  d numeric;
begin
  select * into s from public.stores where id = p_store and active;
  if not found or s.lat is null then
    return null;
  end if;
  d := public.distance_km(s.lat, s.lng, p_lat, p_lng);
  return jsonb_build_object(
    'distance_km', d,
    'radius_km', s.delivery_radius_km,
    'within_radius', d <= s.delivery_radius_km,
    'fee', case when d <= s.delivery_radius_km then public.delivery_fee_for(s, d, coalesce(p_subtotal, 0), coalesce(p_all_free, false)) end,
    'free_shipping_min', s.free_shipping_min,
    'lead_time', s.delivery_lead_time
  );
end;
$$;

create or replace function public.validate_coupon(p_store uuid, p_code text, p_subtotal numeric, p_phone text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.coupon_eval(p_store, p_code, p_subtotal, p_phone) - 'id';
$$;

-- Finaliza um pedido: valida loja, raio, estoque, preços (sempre do banco), cupom e frete.
create or replace function public.place_order(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.stores%rowtype;
  v_name text := btrim(coalesce(p -> 'customer' ->> 'name', ''));
  v_phone text := public.only_digits(p -> 'customer' ->> 'phone');
  v_email text := nullif(lower(btrim(coalesce(p -> 'customer' ->> 'email', ''))), '');
  v_cpf text := nullif(public.only_digits(p -> 'customer' ->> 'cpf'), '');
  a jsonb := coalesce(p -> 'address', '{}'::jsonb);
  v_cep text := public.only_digits(a ->> 'cep');
  v_lat double precision;
  v_lng double precision;
  v_dist numeric;
  v_method text := coalesce(p ->> 'payment_method', '');
  v_inst int := 1;
  v_sub numeric := 0;
  v_all_free boolean := true;
  v_coupon jsonb;
  v_coupon_disc numeric := 0;
  v_pix numeric := 0;
  v_fee numeric := 0;
  v_total numeric;
  v_customer uuid;
  v_order public.orders%rowtype;
  it record;
  prod public.products%rowtype;
  var public.product_variants%rowtype;
  v_unit numeric;
  v_avail int;
  v_lines jsonb := '[]'::jsonb;
  ln jsonb;
  v_count int;
begin
  perform set_config('atual.rpc', 'on', true);

  -- Loja
  select * into s from public.stores
   where active and (id = public.try_uuid(p ->> 'store_id') or slug = p ->> 'store_slug')
   limit 1;
  if not found then perform public.biz_error('STORE_NOT_FOUND'); end if;
  if not s.accepts_orders then perform public.biz_error('STORE_CLOSED', s.closed_message); end if;
  if s.lat is null or s.lng is null then perform public.biz_error('STORE_NO_LOCATION'); end if;

  -- Cliente
  if char_length(v_name) < 3 or char_length(v_name) > 120 then perform public.biz_error('INVALID_NAME'); end if;
  if length(v_phone) not between 10 and 11 then perform public.biz_error('INVALID_PHONE'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.biz_error('INVALID_EMAIL'); end if;
  if v_cpf is not null and not public.cpf_is_valid(v_cpf) then perform public.biz_error('INVALID_CPF'); end if;

  -- Endereço e raio de entrega
  if length(v_cep) <> 8 then perform public.biz_error('INVALID_CEP'); end if;
  if btrim(coalesce(a ->> 'street', '')) = '' or btrim(coalesce(a ->> 'number', '')) = ''
     or btrim(coalesce(a ->> 'city', '')) = '' or char_length(btrim(coalesce(a ->> 'state', ''))) <> 2 then
    perform public.biz_error('INVALID_ADDRESS');
  end if;
  begin
    v_lat := (a ->> 'lat')::double precision;
    v_lng := (a ->> 'lng')::double precision;
  exception when others then
    perform public.biz_error('INVALID_LOCATION');
  end;
  if v_lat is null or v_lng is null or v_lat not between -34 and 6 or v_lng not between -75 and -32 then
    perform public.biz_error('INVALID_LOCATION');
  end if;
  v_dist := public.distance_km(s.lat, s.lng, v_lat, v_lng);
  if v_dist > s.delivery_radius_km then
    perform public.biz_error('OUT_OF_RANGE', v_dist::text || '|' || s.delivery_radius_km::text);
  end if;

  -- Limite de pedidos por telefone
  select count(*) into v_count from public.orders where customer_phone = v_phone and created_at > now() - interval '10 minutes';
  if v_count >= 5 then perform public.biz_error('RATE_LIMIT'); end if;

  -- Itens (preços e estoque sempre do banco)
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    perform public.biz_error('EMPTY_CART');
  end if;
  if jsonb_array_length(p -> 'items') > 50 then perform public.biz_error('TOO_MANY_ITEMS'); end if;

  for it in
    select public.try_uuid(x ->> 'product_id') as product_id,
           public.try_uuid(nullif(x ->> 'variant_id', '')) as variant_id,
           sum(greatest(1, least(99, coalesce((x ->> 'qty')::int, 1))))::int as qty
      from jsonb_array_elements(p -> 'items') x
     group by 1, 2
  loop
    select * into prod from public.products
     where id = it.product_id and store_id = s.id and status = 'active'
     for update;
    if not found then perform public.biz_error('PRODUCT_UNAVAILABLE', coalesce(it.product_id::text, '')); end if;

    var := null;
    if it.variant_id is not null then
      select * into var from public.product_variants
       where id = it.variant_id and product_id = prod.id and active
       for update;
      if not found then perform public.biz_error('PRODUCT_UNAVAILABLE', prod.name); end if;
    end if;

    if prod.track_stock then
      v_avail := coalesce(var.stock_qty, prod.stock_qty);
      if v_avail < it.qty then
        perform public.biz_error('OUT_OF_STOCK', prod.name || '|' || greatest(v_avail, 0)::text);
      end if;
    end if;

    v_unit := coalesce(var.price_override, prod.price);
    v_sub := v_sub + v_unit * it.qty;
    v_all_free := v_all_free and prod.free_shipping;
    v_lines := v_lines || jsonb_build_object(
      'product_id', prod.id, 'variant_id', var.id, 'name', prod.name, 'variant_name', var.name,
      'sku', coalesce(var.sku, prod.sku), 'image_url', coalesce(var.image_url, prod.image_url),
      'unit_price', v_unit, 'qty', it.qty, 'track', prod.track_stock, 'variant_stock', var.stock_qty is not null);
  end loop;

  if v_sub < s.min_order_value then
    perform public.biz_error('MIN_ORDER', s.min_order_value::text);
  end if;

  -- Pagamento
  if not (v_method = any (s.payment_methods)) then perform public.biz_error('INVALID_PAYMENT'); end if;
  if v_method in ('card_on_delivery', 'card_link') then
    v_inst := greatest(1, least(coalesce(nullif(p ->> 'installments', '')::int, 1), s.max_installments));
    while v_inst > 1 and (v_sub / v_inst) < s.min_installment_value loop
      v_inst := v_inst - 1;
    end loop;
  end if;

  -- Cupom
  if nullif(btrim(coalesce(p ->> 'coupon_code', '')), '') is not null then
    v_coupon := public.coupon_eval(s.id, p ->> 'coupon_code', v_sub, v_phone);
    if not (v_coupon ->> 'valid')::boolean then
      perform public.biz_error('COUPON_INVALID', v_coupon ->> 'message');
    end if;
    v_coupon_disc := coalesce((v_coupon ->> 'discount')::numeric, 0);
  end if;

  -- Frete e desconto do PIX
  v_fee := public.delivery_fee_for(s, v_dist, v_sub, v_all_free);
  if v_coupon ->> 'type' = 'free_shipping' then v_fee := 0; end if;
  if v_method = 'pix' then
    v_pix := round((v_sub - v_coupon_disc) * s.pix_discount_pct / 100, 2);
  end if;
  v_total := greatest(0, v_sub - v_coupon_disc - v_pix + v_fee);

  -- Cliente (identificado pelo telefone)
  insert into public.customers (phone, name, email, cpf, last_order_at)
  values (v_phone, v_name, v_email, v_cpf, now())
  on conflict (phone) do update
     set name = excluded.name,
         email = coalesce(excluded.email, public.customers.email),
         cpf = coalesce(excluded.cpf, public.customers.cpf),
         last_order_at = now()
  returning id into v_customer;

  insert into public.orders (
    store_id, customer_id, customer_name, customer_phone, customer_email, customer_cpf,
    cep, street, address_number, complement, district, city, state, reference, lat, lng, distance_km,
    payment_method, installments, subtotal, discount_coupon, discount_pix, delivery_fee, total,
    coupon_id, coupon_code, customer_notes
  ) values (
    s.id, v_customer, v_name, v_phone, v_email, v_cpf,
    v_cep, btrim(a ->> 'street'), btrim(a ->> 'number'), nullif(btrim(coalesce(a ->> 'complement', '')), ''),
    nullif(btrim(coalesce(a ->> 'district', '')), ''), btrim(a ->> 'city'), upper(btrim(a ->> 'state')),
    nullif(btrim(coalesce(a ->> 'reference', '')), ''), v_lat, v_lng, v_dist,
    v_method, v_inst, v_sub, v_coupon_disc, v_pix, v_fee, v_total,
    public.try_uuid(v_coupon ->> 'id'), v_coupon ->> 'code', nullif(left(btrim(coalesce(p ->> 'notes', '')), 1000), '')
  ) returning * into v_order;

  for ln in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, product_id, variant_id, name, variant_name, sku, image_url, unit_price, quantity, total)
    values (v_order.id, (ln ->> 'product_id')::uuid, public.try_uuid(ln ->> 'variant_id'), ln ->> 'name', ln ->> 'variant_name',
            ln ->> 'sku', ln ->> 'image_url', (ln ->> 'unit_price')::numeric, (ln ->> 'qty')::int,
            (ln ->> 'unit_price')::numeric * (ln ->> 'qty')::int);
    if (ln ->> 'track')::boolean then
      if (ln ->> 'variant_stock')::boolean then
        update public.product_variants set stock_qty = stock_qty - (ln ->> 'qty')::int where id = (ln ->> 'variant_id')::uuid;
      else
        update public.products set stock_qty = stock_qty - (ln ->> 'qty')::int where id = (ln ->> 'product_id')::uuid;
      end if;
    end if;
    update public.products set sold_count = sold_count + (ln ->> 'qty')::int where id = (ln ->> 'product_id')::uuid;
  end loop;

  if v_order.coupon_id is not null then
    update public.coupons set used_count = used_count + 1 where id = v_order.coupon_id;
  end if;

  insert into public.order_events (order_id, type, status, message)
  values (v_order.id, 'created', 'pending', 'Pedido recebido pelo site');

  return jsonb_build_object(
    'id', v_order.id, 'code', v_order.code, 'tracking_token', v_order.tracking_token,
    'subtotal', v_order.subtotal, 'discount_coupon', v_order.discount_coupon, 'discount_pix', v_order.discount_pix,
    'delivery_fee', v_order.delivery_fee, 'total', v_order.total, 'payment_method', v_order.payment_method,
    'installments', v_order.installments, 'distance_km', v_order.distance_km,
    'store', jsonb_build_object('name', s.name, 'whatsapp', s.whatsapp, 'phone', s.phone,
                                'pix_key', s.pix_key, 'pix_key_type', s.pix_key_type, 'pix_holder', s.pix_holder,
                                'lead_time', s.delivery_lead_time)
  );
end;
$$;

-- Acompanhamento do pedido pelo cliente
create or replace function public.order_public_view(p_order uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'installments', o.installments, 'created_at', o.created_at, 'scheduled_date', o.scheduled_date,
    'subtotal', o.subtotal, 'discount_coupon', o.discount_coupon, 'discount_pix', o.discount_pix,
    'delivery_fee', o.delivery_fee, 'total', o.total, 'coupon_code', o.coupon_code,
    'customer_name', o.customer_name,
    'address', jsonb_build_object('street', o.street, 'number', o.address_number, 'complement', o.complement,
                                  'district', o.district, 'city', o.city, 'state', o.state, 'cep', o.cep),
    'store', jsonb_build_object('name', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'phone', s.phone,
                                'pix_key', s.pix_key, 'pix_key_type', s.pix_key_type, 'pix_holder', s.pix_holder,
                                'lead_time', s.delivery_lead_time),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'variant_name', i.variant_name, 'quantity', i.quantity,
                                                           'unit_price', i.unit_price, 'total', i.total, 'image_url', i.image_url)), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'status', e.status, 'message', e.message, 'created_at', e.created_at)
                                         order by e.created_at), '[]'::jsonb)
               from public.order_events e where e.order_id = o.id and e.visible_to_customer)
  )
  from public.orders o join public.stores s on s.id = o.store_id
  where o.id = p_order;
$$;
revoke execute on function public.order_public_view(uuid) from public, anon, authenticated;

create or replace function public.track_order(p_code text, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_num bigint := nullif(public.only_digits(p_code), '')::bigint;
begin
  select id into v_id from public.orders
   where number = v_num and customer_phone = public.only_digits(p_phone);
  if v_id is null then
    return null;
  end if;
  return public.order_public_view(v_id);
end;
$$;

create or replace function public.track_order_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.orders where tracking_token = p_token;
  if v_id is null then
    return null;
  end if;
  return public.order_public_view(v_id);
end;
$$;

-- ---------- Funções do painel ----------
create or replace function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'full_name', coalesce(pr.full_name, split_part(u.email, '@', 1)),
    'is_global', public.is_global_admin(),
    'is_super', public.is_super_admin(),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                'store_id', st.store_id, 'role', st.role,
                'store_name', so.name, 'store_slug', so.slug) order by so.sort_order, so.name), '[]'::jsonb)
              from public.staff st left join public.stores so on so.id = st.store_id
              where st.user_id = u.id and st.active)
  )
  from auth.users u left join public.profiles pr on pr.user_id = u.id
  where u.id = (select auth.uid());
$$;

create or replace function public.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select full_name from public.profiles where user_id = (select auth.uid())),
    (select auth.jwt()) ->> 'email',
    'Sistema');
$$;

-- Devolve ou retira do estoque os itens de um pedido
create or replace function public.order_stock_move(p_order uuid, p_sign int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  it record;
begin
  for it in
    select i.product_id, i.variant_id, i.quantity, p.track_stock, v.stock_qty is not null as variant_stock
      from public.order_items i
      left join public.products p on p.id = i.product_id
      left join public.product_variants v on v.id = i.variant_id
     where i.order_id = p_order and i.product_id is not null
  loop
    if it.track_stock then
      if it.variant_stock then
        update public.product_variants set stock_qty = stock_qty + p_sign * it.quantity where id = it.variant_id;
      else
        update public.products set stock_qty = stock_qty + p_sign * it.quantity where id = it.product_id;
      end if;
    end if;
    update public.products set sold_count = greatest(0, sold_count - p_sign * it.quantity) where id = it.product_id;
  end loop;
end;
$$;
revoke execute on function public.order_stock_move(uuid, int) from public, anon, authenticated;

create or replace function public.update_order_status(p_order uuid, p_status public.order_status, p_message text default null, p_visible boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  label text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.biz_error('ORDER_NOT_FOUND'); end if;
  if not public.has_perm(o.store_id, 'orders') then perform public.biz_error('FORBIDDEN'); end if;
  if o.status = p_status then
    return jsonb_build_object('status', o.status);
  end if;
  if o.status in ('delivered', 'canceled') and not public.has_perm(o.store_id, 'settings') then
    perform public.biz_error('FORBIDDEN', 'Somente o administrador da loja reabre pedidos entregues ou cancelados');
  end if;
  if p_status = 'canceled' and nullif(btrim(coalesce(p_message, '')), '') is null then
    perform public.biz_error('CANCEL_REASON_REQUIRED');
  end if;

  perform set_config('atual.rpc', 'on', true);

  if p_status = 'canceled' and not o.restocked then
    perform public.order_stock_move(o.id, 1);
    update public.orders set restocked = true where id = o.id;
    if o.coupon_id is not null then
      update public.coupons set used_count = greatest(0, used_count - 1) where id = o.coupon_id;
    end if;
  elsif o.status = 'canceled' and o.restocked then
    perform public.order_stock_move(o.id, -1);
    update public.orders set restocked = false where id = o.id;
    if o.coupon_id is not null then
      update public.coupons set used_count = used_count + 1 where id = o.coupon_id;
    end if;
  end if;

  update public.orders set
    status = p_status,
    confirmed_at = case when p_status = 'confirmed' and confirmed_at is null then now() else confirmed_at end,
    shipped_at = case when p_status = 'out_for_delivery' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    canceled_at = case when p_status = 'canceled' then now() else null end,
    cancel_reason = case when p_status = 'canceled' then p_message else null end,
    payment_status = case when p_status = 'canceled' and payment_status = 'paid' then 'refunded' else payment_status end
  where id = o.id;

  label := case p_status
    when 'pending' then 'Pedido reaberto'
    when 'confirmed' then 'Pedido confirmado pela loja'
    when 'preparing' then 'Pedido em separação'
    when 'out_for_delivery' then 'Pedido saiu para entrega'
    when 'delivered' then 'Pedido entregue'
    when 'canceled' then 'Pedido cancelado'
  end;
  insert into public.order_events (order_id, type, status, message, visible_to_customer, actor_id, actor_name)
  values (o.id, 'status', p_status, coalesce(nullif(btrim(coalesce(p_message, '')), ''), label), p_visible,
          (select auth.uid()), public.actor_name());

  return jsonb_build_object('status', p_status);
end;
$$;

create or replace function public.set_order_payment(p_order uuid, p_payment_status text, p_message text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.biz_error('ORDER_NOT_FOUND'); end if;
  if not public.has_perm(o.store_id, 'orders') then perform public.biz_error('FORBIDDEN'); end if;
  if p_payment_status not in ('pending', 'paid', 'refunded', 'failed') then perform public.biz_error('INVALID_PAYMENT_STATUS'); end if;
  perform set_config('atual.rpc', 'on', true);
  update public.orders set payment_status = p_payment_status where id = o.id;
  insert into public.order_events (order_id, type, message, visible_to_customer, actor_id, actor_name)
  values (o.id, 'payment',
          coalesce(nullif(btrim(coalesce(p_message, '')), ''),
                   case p_payment_status when 'paid' then 'Pagamento confirmado' when 'refunded' then 'Pagamento estornado'
                        when 'failed' then 'Pagamento não aprovado' else 'Pagamento pendente' end),
          true, (select auth.uid()), public.actor_name());
  return jsonb_build_object('payment_status', p_payment_status);
end;
$$;

create or replace function public.add_order_note(p_order uuid, p_message text, p_visible boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store uuid;
begin
  select store_id into v_store from public.orders where id = p_order;
  if v_store is null then perform public.biz_error('ORDER_NOT_FOUND'); end if;
  if not public.has_perm(v_store, 'orders') then perform public.biz_error('FORBIDDEN'); end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then perform public.biz_error('EMPTY_NOTE'); end if;
  insert into public.order_events (order_id, type, message, visible_to_customer, actor_id, actor_name)
  values (p_order, 'note', left(btrim(p_message), 2000), coalesce(p_visible, false), (select auth.uid()), public.actor_name());
end;
$$;

-- Painel: indicadores de uma loja (p_store) ou da rede inteira (p_store nulo)
create or replace function public.dashboard(p_store uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'America/Sao_Paulo'
as $$
declare
  can_orders boolean;
  res jsonb;
begin
  if p_store is null then
    if not public.is_global_admin() then perform public.biz_error('FORBIDDEN'); end if;
    can_orders := true;
  else
    if not public.has_perm(p_store, 'view') then perform public.biz_error('FORBIDDEN'); end if;
    can_orders := public.has_perm(p_store, 'orders');
  end if;

  with o as (
    select * from public.orders
     where (p_store is null or store_id = p_store) and created_at >= p_from and created_at < p_to
  ), ok as (
    select * from o where status <> 'canceled'
  )
  select jsonb_build_object(
    'can_see_sales', can_orders,
    'orders', case when can_orders then (select count(*) from o) end,
    'orders_ok', case when can_orders then (select count(*) from ok) end,
    'revenue', case when can_orders then (select coalesce(sum(total), 0) from ok) end,
    'avg_ticket', case when can_orders then (select coalesce(round(avg(total), 2), 0) from ok) end,
    'items_sold', case when can_orders then (select coalesce(sum(i.quantity), 0) from public.order_items i join ok on ok.id = i.order_id) end,
    'by_status', case when can_orders then (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from o group by status) x) end,
    'by_payment', case when can_orders then (select coalesce(jsonb_object_agg(payment_method, n), '{}'::jsonb) from (select payment_method, count(*) n from ok group by payment_method) x) end,
    'pending_now', case when can_orders then (select count(*) from public.orders where (p_store is null or store_id = p_store) and status = 'pending') end,
    'new_customers', case when can_orders then (select count(*) from (
        select customer_id from public.orders where (p_store is null or store_id = p_store) and customer_id is not null
        group by customer_id having min(created_at) >= p_from and min(created_at) < p_to) x) end,
    'series', case when can_orders then (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'orders', coalesce(x.n, 0), 'revenue', coalesce(x.rev, 0)) order by d), '[]'::jsonb)
        from generate_series(date_trunc('day', p_from), date_trunc('day', p_to - interval '1 second'), interval '1 day') d
        left join (select date_trunc('day', created_at) dd, count(*) n, sum(total) rev from ok group by 1) x on x.dd = d) end,
    'top_products', case when can_orders then (select coalesce(jsonb_agg(t order by t.qty desc), '[]'::jsonb) from (
        select i.name, sum(i.quantity) qty, sum(i.total) revenue from public.order_items i join ok on ok.id = i.order_id
        group by i.name order by sum(i.quantity) desc limit 10) t) end,
    'by_store', case when p_store is null then (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
        select st.id, st.name, st.slug, count(ok.id) orders, coalesce(sum(ok.total), 0) revenue,
               (select count(*) from public.orders po where po.store_id = st.id and po.status = 'pending') pending
          from public.stores st left join ok on ok.store_id = st.id
         group by st.id, st.name, st.slug) t) end,
    'catalog', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'draft', count(*) filter (where status = 'draft'),
        'archived', count(*) filter (where status = 'archived'),
        'out_of_stock', count(*) filter (where status = 'active' and track_stock and stock_qty <= 0),
        'low_stock', count(*) filter (where status = 'active' and track_stock and stock_qty > 0 and stock_qty <= low_stock_threshold))
      from public.products where p_store is null or store_id = p_store),
    'low_stock_list', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select p.id, p.name, p.stock_qty, p.store_id, st.name store_name
          from public.products p join public.stores st on st.id = p.store_id
         where (p_store is null or p.store_id = p_store) and p.status = 'active' and p.track_stock and p.stock_qty <= p.low_stock_threshold
         order by p.stock_qty, p.name limit 15) t)
  ) into res;
  return res;
end;
$$;

-- Relatório de vendas agrupado
create or replace function public.sales_report(p_store uuid, p_from timestamptz, p_to timestamptz, p_group text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'America/Sao_Paulo'
as $$
declare
  res jsonb;
begin
  if p_store is null then
    if not public.is_global_admin() then perform public.biz_error('FORBIDDEN'); end if;
  elsif not public.has_perm(p_store, 'orders') then
    perform public.biz_error('FORBIDDEN');
  end if;

  if p_group = 'product' then
    select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) into res from (
      select i.name as label, coalesce(i.sku, '') as sku, sum(i.quantity) as qty, sum(i.total) as revenue, count(distinct o.id) as orders
        from public.order_items i join public.orders o on o.id = i.order_id
       where (p_store is null or o.store_id = p_store) and o.created_at >= p_from and o.created_at < p_to and o.status <> 'canceled'
       group by i.name, i.sku) t;
  elsif p_group = 'category' then
    select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) into res from (
      select coalesce(c.name, 'Sem categoria') as label, sum(i.quantity) as qty, sum(i.total) as revenue, count(distinct o.id) as orders
        from public.order_items i join public.orders o on o.id = i.order_id
        left join public.products p on p.id = i.product_id left join public.categories c on c.id = p.category_id
       where (p_store is null or o.store_id = p_store) and o.created_at >= p_from and o.created_at < p_to and o.status <> 'canceled'
       group by c.name) t;
  else
    select coalesce(jsonb_agg(t order by t.sort_key), '[]'::jsonb) into res from (
      select case p_group
               when 'store' then st.name
               when 'payment' then o.payment_method
               when 'status' then o.status::text
               else to_char(date_trunc('day', o.created_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') end as label,
             min(case p_group when 'day' then to_char(date_trunc('day', o.created_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') else st.name end) as sort_key,
             count(*) as orders,
             count(*) filter (where o.status <> 'canceled') as orders_ok,
             coalesce(sum(o.total) filter (where o.status <> 'canceled'), 0) as revenue,
             coalesce(sum(o.discount_coupon + o.discount_pix) filter (where o.status <> 'canceled'), 0) as discounts,
             coalesce(sum(o.delivery_fee) filter (where o.status <> 'canceled'), 0) as delivery_fees,
             coalesce(round(avg(o.total) filter (where o.status <> 'canceled'), 2), 0) as avg_ticket
        from public.orders o join public.stores st on st.id = o.store_id
       where (p_store is null or o.store_id = p_store) and o.created_at >= p_from and o.created_at < p_to
       group by 1) t;
  end if;
  return res;
end;
$$;

-- Clientes com estatísticas (por loja ou da rede)
create or replace function public.customers_list(p_store uuid, p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  res jsonb;
  q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if p_store is null then
    if not public.is_global_admin() then perform public.biz_error('FORBIDDEN'); end if;
  elsif not public.has_perm(p_store, 'customers') then
    perform public.biz_error('FORBIDDEN');
  end if;

  with agg as (
    select c.id, c.name, c.phone, c.email, c.cpf, c.created_at,
           count(o.id) as orders, coalesce(sum(o.total) filter (where o.status <> 'canceled'), 0) as spent,
           max(o.created_at) as last_order_at,
           array_agg(distinct st.name) as stores
      from public.customers c
      join public.orders o on o.customer_id = c.id
      join public.stores st on st.id = o.store_id
     where (p_store is null or o.store_id = p_store)
       and (q is null or c.name ilike '%' || q || '%' or c.phone like '%' || public.only_digits(q) || '%' or c.email ilike '%' || q || '%')
     group by c.id
  )
  select jsonb_build_object(
    'total', (select count(*) from agg),
    'rows', (select coalesce(jsonb_agg(a order by a.last_order_at desc nulls last), '[]'::jsonb)
               from (select * from agg order by last_order_at desc nulls last limit greatest(1, least(p_limit, 500)) offset greatest(0, p_offset)) a)
  ) into res;
  return res;
end;
$$;

-- Visão geral das lojas (rede)
create or replace function public.stores_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_global_admin() then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'name', s.name, 'brand_name', s.brand_name, 'city', s.city, 'state', s.state,
      'active', s.active, 'accepts_orders', s.accepts_orders, 'delivery_radius_km', s.delivery_radius_km,
      'has_location', s.lat is not null, 'whatsapp', s.whatsapp,
      'products_active', (select count(*) from public.products p where p.store_id = s.id and p.status = 'active'),
      'products_total', (select count(*) from public.products p where p.store_id = s.id),
      'orders_pending', (select count(*) from public.orders o where o.store_id = s.id and o.status = 'pending'),
      'revenue_30d', (select coalesce(sum(o.total), 0) from public.orders o where o.store_id = s.id and o.status <> 'canceled' and o.created_at > now() - interval '30 days'),
      'staff', (select count(*) from public.staff st where st.store_id = s.id and st.active)
    ) order by s.sort_order, s.name), '[]'::jsonb) from public.stores s)
  else null end;
$$;

-- Copia produtos (com fotos e variações) para outras lojas
create or replace function public.duplicate_products(p_ids uuid[], p_targets uuid[], p_status text default 'draft')
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
begin
  if p_status not in ('active', 'draft', 'archived') then p_status := 'draft'; end if;
  foreach tgt in array coalesce(p_targets, '{}') loop
    if not public.has_perm(tgt, 'catalog') then perform public.biz_error('FORBIDDEN'); end if;
  end loop;

  for src in select * from public.products where id = any (coalesce(p_ids, '{}')) loop
    if not public.has_perm(src.store_id, 'view') then perform public.biz_error('FORBIDDEN'); end if;
    foreach tgt in array p_targets loop
      if tgt = src.store_id then
        skipped := skipped + 1;
        continue;
      end if;
      new_slug := src.slug;
      n := 1;
      while exists (select 1 from public.products where store_id = tgt and slug = new_slug) loop
        n := n + 1;
        new_slug := src.slug || '-' || n;
      end loop;
      insert into public.products (store_id, category_id, sku, name, slug, short_description, description, brand, price,
        compare_at_price, cost_price, stock_qty, track_stock, low_stock_threshold, status, is_new, free_shipping, fast_delivery,
        is_promo, weight_kg, width_cm, height_cm, depth_cm, warranty, specs, tags, seo_title, seo_description, created_by)
      values (tgt, src.category_id, src.sku, src.name, new_slug, src.short_description, src.description, src.brand, src.price,
        src.compare_at_price, src.cost_price, 0, src.track_stock, src.low_stock_threshold, p_status, src.is_new, src.free_shipping,
        src.fast_delivery, src.is_promo, src.weight_kg, src.width_cm, src.height_cm, src.depth_cm, src.warranty, src.specs, src.tags,
        src.seo_title, src.seo_description, (select auth.uid()))
      returning id into new_id;
      insert into public.product_images (product_id, store_id, url, alt, sort_order)
        select new_id, tgt, url, alt, sort_order from public.product_images where product_id = src.id;
      insert into public.product_variants (product_id, store_id, name, color, image_url, sku, price_override, stock_qty, active, sort_order)
        select new_id, tgt, name, color, image_url, sku, price_override, case when stock_qty is null then null else 0 end, active, sort_order
          from public.product_variants where product_id = src.id;
      created := created + 1;
    end loop;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end;
$$;

-- ---------- Permissões de execução ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.list_stores() to anon, authenticated;
grant execute on function public.get_storefront(text) to anon, authenticated;
grant execute on function public.quote_delivery(uuid, double precision, double precision, numeric, boolean) to anon, authenticated;
grant execute on function public.validate_coupon(uuid, text, numeric, text) to anon, authenticated;
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;
grant execute on function public.track_order_by_token(uuid) to anon, authenticated;

grant execute on function public.my_access() to authenticated;
grant execute on function public.update_order_status(uuid, public.order_status, text, boolean) to authenticated;
grant execute on function public.set_order_payment(uuid, text, text) to authenticated;
grant execute on function public.add_order_note(uuid, text, boolean) to authenticated;
grant execute on function public.dashboard(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.sales_report(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.customers_list(uuid, text, int, int) to authenticated;
grant execute on function public.stores_overview() to authenticated;
grant execute on function public.duplicate_products(uuid[], uuid[], text) to authenticated;
-- usadas pelas políticas de RLS
grant execute on function public.has_perm(uuid, text) to authenticated;
grant execute on function public.is_global_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
grant execute on function public.slugify(text) to authenticated;
grant execute on function public.distance_km(double precision, double precision, double precision, double precision) to anon, authenticated;
