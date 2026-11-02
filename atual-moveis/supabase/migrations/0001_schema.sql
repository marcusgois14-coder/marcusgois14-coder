-- =========================================================
-- Atual Móveis — rede de lojas
-- 0001: tipos, tabelas, índices e gatilhos básicos
-- =========================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------- Tipos ----------
create type public.staff_role as enum (
  'super_admin',     -- rede: tudo, inclusive outros super admins
  'network_admin',   -- rede: tudo, exceto super admins
  'store_admin',     -- loja: tudo da loja, inclusive equipe e configurações
  'store_manager',   -- loja: catálogo, vitrine, pedidos, cupons, clientes
  'store_editor',    -- loja: catálogo e vitrine
  'store_operator'   -- loja: pedidos e clientes
);

create type public.order_status as enum (
  'pending',          -- aguardando confirmação
  'confirmed',        -- confirmado
  'preparing',        -- em separação
  'out_for_delivery', -- saiu para entrega
  'delivered',        -- entregue
  'canceled'          -- cancelado
);

-- ---------- Utilitários ----------
create or replace function public.slugify(txt text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(txt, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Configuração da rede (linha única) ----------
create table public.network_settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'Atual Móveis',
  tagline text default 'Móveis, colchões e eletro',
  logo_url text,
  logo_white_url text,
  primary_color text not null default '#E01B26',
  accent_color text not null default '#F4802B',
  default_pix_discount numeric(5,2) not null default 5 check (default_pix_discount between 0 and 50),
  default_installments int not null default 10 check (default_installments between 1 and 24),
  default_radius_km numeric(6,2) not null default 30 check (default_radius_km > 0),
  support_whatsapp text,
  instagram text,
  facebook text,
  slogan text not null default E'Sua casa,\nsempre atual.',
  seo_title text,
  seo_description text,
  footer_legal text,
  benefits jsonb not null default '[]'::jsonb,
  marquee jsonb not null default '[]'::jsonb,
  popular_searches jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------- Lojas ----------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  brand_name text not null default 'Atual Móveis',
  city text not null,
  state text not null default 'MG' check (char_length(state) = 2),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  street text,
  number text,
  district text,
  complement text,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  delivery_radius_km numeric(6,2) not null default 30 check (delivery_radius_km > 0 and delivery_radius_km <= 500),
  phone text,
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{12,13}$'),
  email text,
  hours text,
  instagram text,
  facebook text,
  pix_key text,
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_holder text,
  payment_methods text[] not null default array['pix', 'card_on_delivery', 'cash']::text[]
    check (payment_methods <@ array['pix', 'card_on_delivery', 'cash', 'crediario', 'card_link']::text[]),
  pix_discount_pct numeric(5,2) not null default 5 check (pix_discount_pct between 0 and 50),
  max_installments int not null default 10 check (max_installments between 1 and 24),
  min_installment_value numeric(12,2) not null default 50 check (min_installment_value >= 0),
  free_shipping_min numeric(12,2) check (free_shipping_min is null or free_shipping_min >= 0),
  delivery_fee_tiers jsonb not null default '[{"up_to_km": 10, "fee": 0}, {"up_to_km": 30, "fee": 49.9}]'::jsonb,
  min_order_value numeric(12,2) not null default 0 check (min_order_value >= 0),
  delivery_lead_time text default 'Entrega em até 5 dias úteis após a confirmação',
  accepts_orders boolean not null default true,
  closed_message text,
  active boolean not null default true,
  sort_order int not null default 0,
  marquee jsonb,
  notify_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger stores_touch before update on public.stores for each row execute function public.touch_updated_at();

-- ---------- Perfis e equipe ----------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint staff_scope check (
    (role in ('super_admin', 'network_admin') and store_id is null)
    or (role not in ('super_admin', 'network_admin') and store_id is not null)
  ),
  constraint staff_unique unique nulls not distinct (user_id, store_id)
);
create index staff_user_idx on public.staff (user_id) where active;
create index staff_store_idx on public.staff (store_id);

-- ---------- Categorias (taxonomia da rede) ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  sort_order int not null default 0,
  active boolean not null default true,
  show_in_strip boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();

-- ---------- Produtos (cada loja tem o seu catálogo) ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  sku text,
  name text not null check (char_length(name) between 2 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  short_description text,
  description text,
  brand text,
  price numeric(12,2) not null check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  stock_qty int not null default 0,
  track_stock boolean not null default true,
  low_stock_threshold int not null default 2,
  status text not null default 'draft' check (status in ('active', 'draft', 'archived')),
  is_new boolean not null default false,
  free_shipping boolean not null default false,
  fast_delivery boolean not null default false,
  is_promo boolean not null default false,
  weight_kg numeric(8,2),
  width_cm numeric(8,1),
  height_cm numeric(8,1),
  depth_cm numeric(8,1),
  warranty text,
  specs jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  seo_title text,
  seo_description text,
  image_url text,
  image2_url text,
  sold_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint products_slug_unique unique (store_id, slug)
);
create index products_store_status_idx on public.products (store_id, status);
create index products_category_idx on public.products (category_id);
create index products_store_sku_idx on public.products (store_id, sku);
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  url text not null,
  alt text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  color text,
  image_url text,
  sku text,
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  stock_qty int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_variants_product_idx on public.product_variants (product_id, sort_order);

-- store_id dos filhos sempre igual ao do produto
create or replace function public.inherit_product_store()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.store_id into new.store_id from public.products p where p.id = new.product_id;
  if new.store_id is null then
    raise exception 'Produto inexistente';
  end if;
  return new;
end;
$$;
create trigger product_images_store before insert or update of product_id on public.product_images
  for each row execute function public.inherit_product_store();
create trigger product_variants_store before insert or update of product_id on public.product_variants
  for each row execute function public.inherit_product_store();

-- capa e segunda imagem do produto seguem as duas primeiras fotos
create or replace function public.sync_product_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid := coalesce(new.product_id, old.product_id);
  imgs text[];
begin
  select array_agg(url order by sort_order, created_at) into imgs
  from public.product_images where product_id = pid;
  update public.products
     set image_url = imgs[1], image2_url = imgs[2]
   where id = pid and (image_url is distinct from imgs[1] or image2_url is distinct from imgs[2]);
  return null;
end;
$$;
create trigger product_images_cover after insert or update or delete on public.product_images
  for each row execute function public.sync_product_cover();

-- ---------- Vitrine ----------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  subtitle text,
  layout text not null default 'five' check (layout in ('five', 'six')),
  badge_all text check (badge_all is null or badge_all in ('novo', 'frete')),
  show_on_home boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_key_unique unique (store_id, key)
);
create trigger collections_touch before update on public.collections for each row execute function public.touch_updated_at();

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sort_order int not null default 0,
  primary key (collection_id, product_id)
);
create index collection_items_product_idx on public.collection_items (product_id);

-- produto e coleção precisam ser da mesma loja
create or replace function public.check_collection_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select store_id from public.collections where id = new.collection_id)
     is distinct from (select store_id from public.products where id = new.product_id) then
    raise exception 'O produto não pertence à loja desta coleção';
  end if;
  return new;
end;
$$;
create trigger collection_items_check before insert or update on public.collection_items
  for each row execute function public.check_collection_item();

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores (id) on delete cascade, -- null = rede inteira
  kind text not null check (kind in ('hero', 'mosaic', 'room')),
  title text not null,
  kicker text,
  text text,
  image_url text not null,
  image_mobile_url text,
  link_url text,
  pin_product_ids uuid[] not null default '{}',
  sort_order int not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banners_store_idx on public.banners (store_id, kind);
create trigger banners_touch before update on public.banners for each row execute function public.touch_updated_at();

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores (id) on delete cascade, -- null = rede inteira
  text text not null,
  cta_label text,
  cta_url text,
  active boolean not null default true,
  sort_order int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger announcements_touch before update on public.announcements for each row execute function public.touch_updated_at();

-- ---------- Cupons ----------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores (id) on delete cascade, -- null = vale em toda a rede
  code text not null check (code ~ '^[A-Z0-9_-]{3,30}$'),
  description text,
  type text not null check (type in ('percent', 'fixed', 'free_shipping')),
  value numeric(12,2) not null default 0 check (value >= 0),
  min_order numeric(12,2) not null default 0,
  max_discount numeric(12,2),
  usage_limit int,
  used_count int not null default 0,
  per_phone_limit int,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_code_unique unique nulls not distinct (store_id, code),
  constraint coupons_percent check (type <> 'percent' or value <= 100)
);
create trigger coupons_touch before update on public.coupons for each row execute function public.touch_updated_at();

-- ---------- Clientes e pedidos ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^[0-9]{10,11}$'),
  name text not null,
  email text,
  cpf text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_order_at timestamptz
);
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();

create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('public.order_number_seq'),
  code text generated always as ('AT' || lpad(number::text, 6, '0')) stored,
  store_id uuid not null references public.stores (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  customer_cpf text,
  cep text not null,
  street text not null,
  address_number text not null,
  complement text,
  district text,
  city text not null,
  state text not null,
  reference text,
  lat double precision not null,
  lng double precision not null,
  distance_km numeric(7,2) not null,
  status public.order_status not null default 'pending',
  payment_method text not null,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded', 'failed')),
  installments int not null default 1,
  subtotal numeric(12,2) not null,
  discount_coupon numeric(12,2) not null default 0,
  discount_pix numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  coupon_id uuid references public.coupons (id) on delete set null,
  coupon_code text,
  customer_notes text,
  internal_notes text,
  tracking_token uuid not null default gen_random_uuid(),
  source text not null default 'site',
  assigned_to uuid references auth.users (id) on delete set null,
  scheduled_date date,
  restocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text
);
alter sequence public.order_number_seq owned by public.orders.number;
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_status_idx on public.orders (store_id, status);
create index orders_customer_idx on public.orders (customer_id);
create index orders_phone_idx on public.orders (customer_phone, created_at desc);
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  name text not null,
  variant_name text,
  sku text,
  image_url text,
  unit_price numeric(12,2) not null,
  quantity int not null check (quantity > 0),
  total numeric(12,2) not null
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  type text not null check (type in ('created', 'status', 'payment', 'note', 'edit')),
  status public.order_status,
  message text,
  visible_to_customer boolean not null default true,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- ---------- Auditoria ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  store_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_store_idx on public.audit_log (store_id, created_at desc);

-- ---------- Cache de geocodificação (usado pela edge function) ----------
create table public.geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  display_name text,
  created_at timestamptz not null default now()
);
