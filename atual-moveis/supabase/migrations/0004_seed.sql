-- =========================================================
-- 0004: dados iniciais da rede (lojas, categorias, catálogo de exemplo, vitrine)
-- Produtos, preços e promessas comerciais são EXEMPLOS: ajuste pelo painel.
-- Endereços, telefones e chaves PIX das lojas (exceto Ponte Nova) ficam vazios
-- para cada loja completar no painel. Coordenadas = centro da cidade (OpenStreetMap).
-- =========================================================

insert into public.network_settings (id, name, tagline, primary_color, accent_color, default_pix_discount, default_installments,
  default_radius_km, support_whatsapp, instagram, facebook, slogan, seo_title, seo_description, footer_legal,
  benefits, marquee, popular_searches)
values (1, 'Atual Móveis', 'Móveis, colchões e eletro', '#E01B26', '#F4802B', 5, 10, 30, '553138172969',
  'https://www.instagram.com/atualmoveispontenova/', 'https://www.facebook.com/atualmoveiseeletro/',
  E'Sua casa,\nsempre atual.',
  'Atual Móveis | Móveis, colchões e eletro com entrega na sua cidade',
  'Rede Atual Móveis: sofás, colchões, camas, cozinhas, mesas e eletrodomésticos com entrega em até 30 km da loja mais próxima.',
  '*Entrega somente no raio de atendimento de cada loja. Consulte condições.',
  '[{"icon":"shield","title":"Compra garantida","text":"Receba o produto esperado ou seu dinheiro de volta."},
    {"icon":"truck","title":"Entrega e montagem","text":"Equipe da loja entrega em até 30 km."},
    {"icon":"card","title":"Parcele sem juros","text":"No cartão de crédito ou no crediário da loja."},
    {"icon":"chat","title":"Atendimento no WhatsApp","text":"Consultoria gratuita para escolher seus móveis."}]'::jsonb,
  '["Entrega em até 30 km da sua loja", "Montagem de móveis", "Parcele no cartão ou crediário", "5% OFF no PIX", "Atendimento pelo WhatsApp", "13 lojas em Minas Gerais"]'::jsonb,
  '["Sofá", "Colchão casal", "Poltrona", "Geladeira", "Fogão", "Lava e seca", "Smart TV", "Cômoda"]'::jsonb)
on conflict (id) do nothing;

insert into public.stores (slug, name, brand_name, city, state, cep, street, number, district, lat, lng, phone, whatsapp,
  instagram, facebook, sort_order, payment_methods, free_shipping_min, delivery_fee_tiers)
values
  ('ponte-nova', 'Atual Móveis - Ponte Nova', 'Atual Móveis', 'Ponte Nova', 'MG', '35430028', 'Av. Abdala Felício', '370', 'Centro',
    -20.414922, -42.899446, '(31) 3817-2969', '553138172969',
    'https://www.instagram.com/atualmoveispontenova/', 'https://www.facebook.com/atualmoveiseeletro/', 1,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('tavares-ponte-nova', 'Loja Tavares - Ponte Nova', 'Loja Tavares', 'Ponte Nova', 'MG', null, null, null, null,
    -20.416435, -42.90878, null, null, null, null, 2,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('teixeiras', 'Atual Móveis - Teixeiras', 'Atual Móveis', 'Teixeiras', 'MG', null, null, null, null,
    -20.651788, -42.856327, null, null, null, null, 3,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('visconde-do-rio-branco', 'Atual Móveis - Visconde do Rio Branco', 'Atual Móveis', 'Visconde do Rio Branco', 'MG', null, null, null, null,
    -21.01, -42.840833, null, null, null, null, 4,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('mariana', 'Atual Móveis - Mariana', 'Atual Móveis', 'Mariana', 'MG', null, null, null, null,
    -20.377831, -43.416327, null, null, null, null, 5,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('ouro-preto', 'Atual Móveis - Ouro Preto', 'Atual Móveis', 'Ouro Preto', 'MG', null, null, null, null,
    -20.385671, -43.503617, null, null, null, null, 6,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('ouro-branco', 'Atual Móveis - Ouro Branco', 'Atual Móveis', 'Ouro Branco', 'MG', null, null, null, null,
    -20.526003, -43.662963, null, null, null, null, 7,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('manhuacu', 'Atual Móveis - Manhuaçu', 'Atual Móveis', 'Manhuaçu', 'MG', null, null, null, null,
    -20.257443, -42.034077, null, null, null, null, 8,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('manhumirim', 'Atual Móveis - Manhumirim', 'Atual Móveis', 'Manhumirim', 'MG', null, null, null, null,
    -20.355867, -41.960633, null, null, null, null, 9,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('caratinga', 'Atual Móveis - Caratinga', 'Atual Móveis', 'Caratinga', 'MG', null, null, null, null,
    -19.790089, -42.140533, null, null, null, null, 10,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('timoteo', 'Atual Móveis - Timóteo', 'Atual Móveis', 'Timóteo', 'MG', null, null, null, null,
    -19.57714, -42.643611, null, null, null, null, 11,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('coronel-fabriciano', 'Atual Móveis - Coronel Fabriciano', 'Atual Móveis', 'Coronel Fabriciano', 'MG', null, null, null, null,
    -19.520007, -42.628269, null, null, null, null, 12,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]'),
  ('vicosa', 'Ativa Móveis - Viçosa', 'Ativa Móveis', 'Viçosa', 'MG', null, null, null, null,
    -20.753859, -42.881589, null, null, null, null, 13,
    array['pix', 'card_on_delivery', 'cash', 'crediario'], 999, '[{"up_to_km":10,"fee":0},{"up_to_km":20,"fee":29.9},{"up_to_km":30,"fee":49.9}]')
on conflict (slug) do nothing;

-- Categorias da rede (Móveis e Eletro são grupos do menu)
insert into public.categories (name, slug, image_url, sort_order, show_in_strip) values
  ('Móveis', 'moveis', null, 1, false),
  ('Colchões', 'colchoes', 'cat-colchao', 2, true),
  ('Eletro', 'eletro', null, 3, false)
on conflict (slug) do nothing;

insert into public.categories (parent_id, name, slug, image_url, sort_order, show_in_strip)
select (select id from public.categories where slug = x.parent), x.name, x.slug, x.image_url, x.sort_order, true
from (values
  ('moveis', 'Sofás', 'sofas', 'cat-sofa', 10),
  ('moveis', 'Poltronas', 'poltronas', 'cat-poltrona', 11),
  ('moveis', 'Camas', 'camas', 'prod-05', 12),
  ('moveis', 'Guarda-roupas', 'guarda-roupas', 'cat-guarda-roupa', 13),
  ('moveis', 'Mesas e Cadeiras', 'mesas-e-cadeiras', 'cat-mesa-jantar', 14),
  ('moveis', 'Racks e Painéis', 'racks-e-paineis', 'cat-rack', 15),
  ('moveis', 'Mesas de Centro', 'mesas-de-centro', 'prod-10', 16),
  ('moveis', 'Cômodas e Criados', 'comodas', 'prod-12', 17),
  ('moveis', 'Cozinhas', 'cozinhas', 'cat-cozinha', 18),
  ('moveis', 'Escritório', 'escritorio', 'cat-escritorio', 19),
  ('eletro', 'Geladeiras', 'geladeiras', 'cat-geladeira', 30),
  ('eletro', 'Fogões', 'fogoes', 'cat-fogao', 31),
  ('eletro', 'Lavadoras', 'lavadoras', 'cat-lavadora', 32),
  ('eletro', 'Smart TVs', 'tvs', 'cat-tv', 33),
  ('eletro', 'Eletroportáteis', 'eletroportateis', 'cat-portateis', 34)
) as x(parent, name, slug, image_url, sort_order)
on conflict (slug) do nothing;

-- Modelos de produto (copiados para o catálogo de cada loja)
create temp table seed_products (
  sku text primary key, cat text, name text, price numeric, compare numeric,
  is_new boolean, free_shipping boolean, fast boolean, promo boolean,
  images text[], variants jsonb, brand text, warranty text,
  w numeric, h numeric, d numeric, kg numeric, short text, description text, specs jsonb
);

insert into seed_products values
  ('AT-SOF-001', 'sofas', 'Sofá 3 Lugares Retrô 210 cm Pés de Madeira - Veludo Verde', 2499.90, 3599.90, false, true, true, false,
    array['prod-01'], '[{"name":"Veludo Verde","color":"#1f5a4a"},{"name":"Veludo Caramelo","color":"#b5703a"},{"name":"Veludo Cinza","color":"#8c8c8c"}]',
    null, '12 meses', 210, 84, 92, 58, 'Linhas retrô, assento firme e pés palito em madeira maciça.',
    E'Sofá de três lugares com estrutura em madeira de reflorestamento, espuma D33 no assento e encosto com fibra siliconada.\nO revestimento em veludo é macio ao toque e fácil de limpar com pano úmido.',
    '[{"label":"Lugares","value":"3"},{"label":"Revestimento","value":"Veludo"},{"label":"Densidade do assento","value":"D33"},{"label":"Pés","value":"Madeira maciça"}]'),
  ('AT-SOF-002', 'sofas', 'Sofá Chesterfield 2 Lugares 180 cm - Couro Sintético Café', 3299.90, 4999.90, false, true, true, true,
    array['prod-02'], '[{"name":"Café","color":"#3b2a20"},{"name":"Preto","color":"#1d1d1d"}]',
    null, '12 meses', 180, 78, 88, 62, 'Capitonê clássico com braços rolados.',
    E'O clássico Chesterfield com capitonê feito à mão, braços rolados e acabamento em couro sintético de alta resistência.\nIdeal para salas de estar e escritórios.',
    '[{"label":"Lugares","value":"2"},{"label":"Revestimento","value":"Couro sintético"},{"label":"Estrutura","value":"Madeira de eucalipto"}]'),
  ('AT-SOF-003', 'sofas', 'Sofá 2 Lugares Confort 180 cm - Couro Sintético Bege', 1899.90, 2599.90, false, true, false, false,
    array['prod-03'], '[{"name":"Bege","color":"#d8cba0"},{"name":"Off White","color":"#efe9df"},{"name":"Bege e Nogueira","color":"linear-gradient(90deg,#d8cba0 50%,#7a4a2b 50%)"}]',
    null, '12 meses', 180, 86, 90, 49, 'Almofadas soltas e assento profundo.',
    E'Sofá compacto de dois lugares com almofadas de encosto soltas e assento profundo para mais conforto.',
    '[{"label":"Lugares","value":"2"},{"label":"Revestimento","value":"Couro sintético"},{"label":"Almofadas","value":"Soltas"}]'),
  ('AT-SOF-004', 'sofas', 'Sofá Orgânico 3 Lugares 230 cm Base de Madeira - Linho Cinza', 3799.90, 5199.90, true, true, true, false,
    array['prod-04'], '[{"name":"Linho Cinza","color":"#a9a9a9"},{"name":"Linho Areia","color":"#e6dccb"}]',
    null, '12 meses', 230, 80, 95, 70, 'Formas curvas e base de madeira aparente.',
    E'Design orgânico com braços arredondados, base em madeira aparente e tecido linho com toque natural.',
    '[{"label":"Lugares","value":"3"},{"label":"Revestimento","value":"Linho"},{"label":"Base","value":"Madeira"}]'),
  ('AT-CAM-001', 'camas', 'Cama Casal de Madeira Maciça Nórdica 138x188 cm - Natural', 1699.90, 2299.90, true, true, false, false,
    array['prod-05'], '[{"name":"Natural","color":"#c8995e"},{"name":"Nogueira","color":"#7a4a2b"}]',
    null, '12 meses', 150, 95, 205, 45, 'Madeira maciça com encaixes aparentes.',
    E'Cama casal em madeira maciça com cabeceira ripada e acabamento natural. Comporta colchão 138x188 cm.',
    '[{"label":"Medida do colchão","value":"138 x 188 cm"},{"label":"Material","value":"Madeira maciça"},{"label":"Suporta","value":"Até 250 kg"}]'),
  ('AT-COL-001', 'colchoes', 'Colchão Casal Molas Ensacadas Pillow Top 138x188x30 cm', 1799.90, 2699.90, false, true, true, false,
    array['prod-06', 'prod-06-b'], '[]',
    null, '24 meses', 138, 30, 188, 32, 'Molas ensacadas individualmente e pillow top.',
    E'Colchão de casal com molas ensacadas que reduzem a transferência de movimento e pillow top em espuma viscoelástica.',
    '[{"label":"Medida","value":"138 x 188 x 30 cm"},{"label":"Tecnologia","value":"Molas ensacadas"},{"label":"Conforto","value":"Firme"},{"label":"Peso suportado","value":"Até 120 kg por pessoa"}]'),
  ('AT-POL-001', 'poltronas', 'Poltrona Decorativa Bouclé com Pés de Madeira - Off White', 899.90, 1299.90, true, false, false, false,
    array['prod-07', 'prod-07-b'], '[{"name":"Off White","color":"#efe9df"},{"name":"Caramelo","color":"#9c7a5b"}]',
    null, '12 meses', 72, 80, 76, 14, 'Tecido bouclé e pés palito.',
    E'Poltrona decorativa revestida em bouclé, com assento confortável e pés palito em madeira.',
    '[{"label":"Revestimento","value":"Bouclé"},{"label":"Pés","value":"Madeira"}]'),
  ('AT-POL-002', 'poltronas', 'Poltrona Industrial Estofada Estrutura Metálica - Terracota', 1099.90, 1499.90, true, true, true, false,
    array['prod-08', 'prod-08-b'], '[{"name":"Terracota","color":"#c9692b"},{"name":"Preto","color":"#1d1d1d"},{"name":"Grafite","color":"#6f6f6f"}]',
    null, '12 meses', 70, 78, 74, 16, 'Estrutura metálica e assento estofado.',
    E'Poltrona de estilo industrial com estrutura em aço carbono pintado e assento estofado.',
    '[{"label":"Estrutura","value":"Aço carbono"},{"label":"Assento","value":"Estofado"}]'),
  ('AT-CAD-001', 'mesas-e-cadeiras', 'Cadeira de Jantar Estofada Pés de Madeira Maciça - Linho Cinza', 449.90, 699.90, true, false, false, false,
    array['prod-09'], '[{"name":"Linho Cinza","color":"#9e9e9e"},{"name":"Linho Off White","color":"#efe9df"},{"name":"Linho Terracota","color":"#c9692b"}]',
    null, '12 meses', 52, 92, 56, 7, 'Encosto envolvente e pés em madeira maciça.',
    E'Cadeira de jantar estofada com encosto envolvente, tecido linho e pés em madeira maciça.',
    '[{"label":"Revestimento","value":"Linho"},{"label":"Pés","value":"Madeira maciça"}]'),
  ('AT-MCE-001', 'mesas-de-centro', 'Mesa de Centro Rústica de Madeira Maciça 110 cm - Demolição', 799.90, 1199.90, false, false, true, false,
    array['prod-10'], '[{"name":"Demolição","color":"#7a4a2b"},{"name":"Natural","color":"#c8995e"}]',
    null, '12 meses', 110, 35, 60, 25, 'Madeira de demolição com prateleira inferior.',
    E'Mesa de centro rústica em madeira de demolição, com prateleira inferior para livros e revistas.',
    '[{"label":"Material","value":"Madeira de demolição"},{"label":"Medidas","value":"110 x 60 x 35 cm"}]'),
  ('AT-MCE-002', 'mesas-de-centro', 'Mesa Lateral de Madeira com Nicho para Livros - Freijó', 349.90, 499.90, false, false, false, true,
    array['prod-11'], '[{"name":"Freijó","color":"#a0663b"},{"name":"Preto","color":"#1d1d1d"}]',
    null, '6 meses', 40, 55, 40, 6, 'Nicho para livros e tampo com borda.',
    E'Mesa lateral versátil com nicho para livros, perfeita ao lado do sofá ou da cama.',
    '[{"label":"Material","value":"MDP com acabamento freijó"}]'),
  ('AT-COM-001', 'comodas', 'Cômoda 3 Gavetas Pés Palito 120 cm - Carvalho Natural', 1199.90, 1699.90, false, true, false, false,
    array['prod-12'], '[{"name":"Carvalho","color":"#d9bf94"},{"name":"Branco","color":"#ffffff"}]',
    null, '12 meses', 120, 80, 45, 38, 'Gavetas com corrediças telescópicas.',
    E'Cômoda com gavetas amplas, corrediças telescópicas e pés palito em madeira.',
    '[{"label":"Gavetas","value":"3"},{"label":"Corrediças","value":"Telescópicas"}]'),
  ('AT-COM-002', 'comodas', 'Criado-mudo 3 Gavetas Frente em Palhinha - Tabaco', 549.90, 799.90, true, false, false, false,
    array['prod-13', 'prod-13-b'], '[{"name":"Tabaco","color":"#4a2f22"},{"name":"Natural","color":"#c8995e"}]',
    null, '12 meses', 50, 60, 40, 15, 'Frente em palhinha natural.',
    E'Criado-mudo com três gavetas, frente em palhinha natural e puxadores metálicos.',
    '[{"label":"Gavetas","value":"3"},{"label":"Detalhe","value":"Palhinha natural"}]'),
  ('AT-TV-001', 'tvs', 'Smart TV 55" 4K UHD Wi-Fi com Comando de Voz', 2599.90, 3299.90, false, true, true, false,
    array['prod-14', 'prod-14-b'], '[]',
    null, '12 meses', 123, 72, 8, 14, 'Resolução 4K, HDR e comando de voz.',
    E'Smart TV de 55 polegadas com resolução 4K UHD, HDR, Wi-Fi e controle remoto com comando de voz.',
    '[{"label":"Tela","value":"55 polegadas"},{"label":"Resolução","value":"4K UHD"},{"label":"Conectividade","value":"Wi-Fi, HDMI e USB"}]'),
  ('AT-GEL-001', 'geladeiras', 'Geladeira Retrô Duplex 2 Portas 270 Litros - Azul Claro', 4299.90, 5299.90, true, true, true, false,
    array['prod-15'], '[{"name":"Azul Claro","color":"#a9d6d4","image":"prod-15"},{"name":"Verde Água","color":"#4cbfa6"}]',
    null, '12 meses', 60, 150, 70, 62, 'Visual retrô com freezer superior.',
    E'Geladeira duplex de visual retrô com 270 litros, freezer superior e prateleiras de vidro temperado.',
    '[{"label":"Capacidade","value":"270 litros"},{"label":"Portas","value":"2"},{"label":"Voltagem","value":"127 V ou 220 V"}]'),
  ('AT-LAV-001', 'lavadoras', 'Lava e Seca 11 kg Abertura Frontal - Branca', 2899.90, 3599.90, false, true, true, false,
    array['prod-16', 'prod-16-b'], '[{"name":"Branca","color":"#ffffff"},{"name":"Inox","color":"#c0c0c0"}]',
    null, '12 meses', 60, 85, 60, 70, 'Lava e seca no mesmo ciclo.',
    E'Lava e seca com abertura frontal, 11 kg de capacidade e programas rápidos para o dia a dia.',
    '[{"label":"Capacidade","value":"11 kg"},{"label":"Abertura","value":"Frontal"},{"label":"Voltagem","value":"127 V ou 220 V"}]'),
  ('AT-FOG-001', 'fogoes', 'Fogão Elétrico 4 Bocas Inox com Forno e Gaveta', 1599.90, 2199.90, false, true, true, true,
    array['prod-17'], '[{"name":"Inox","color":"#c0c0c0"},{"name":"Preto","color":"#1d1d1d"}]',
    null, '12 meses', 76, 92, 65, 48, 'Mesa em inox, forno amplo e gaveta.',
    E'Fogão de quatro bocas com mesa em inox, forno amplo com luz interna e gaveta para assadeiras.',
    '[{"label":"Bocas","value":"4"},{"label":"Acabamento","value":"Inox"}]'),
  ('AT-POR-001', 'eletroportateis', 'Cafeteira Elétrica Retrô 1,2 Litro - Preta', 249.90, 399.90, false, false, false, true,
    array['prod-18'], '[{"name":"Preta","color":"#1d1d1d"},{"name":"Branca","color":"#ffffff"}]',
    null, '12 meses', 20, 32, 25, 2, 'Jarra de vidro e placa aquecedora.',
    E'Cafeteira elétrica de visual retrô com jarra de vidro de 1,2 litro e placa que mantém o café aquecido.',
    '[{"label":"Capacidade","value":"1,2 litro"},{"label":"Voltagem","value":"127 V ou 220 V"}]');

-- Catálogo por loja: Ponte Nova tem tudo; as demais têm uma seleção própria e estoques diferentes
insert into public.products (store_id, category_id, sku, name, slug, short_description, description, brand, price, compare_at_price,
  stock_qty, status, is_new, free_shipping, fast_delivery, is_promo, width_cm, height_cm, depth_cm, weight_kg, warranty, specs)
select s.id, c.id, t.sku, t.name, public.slugify(t.name), t.short, t.description, t.brand, t.price, t.compare,
       (abs(hashtext(t.sku || s.slug)) % 15), 'active', t.is_new, t.free_shipping, t.fast, t.promo, t.w, t.h, t.d, t.kg, t.warranty, t.specs
  from public.stores s
  cross join seed_products t
  join public.categories c on c.slug = t.cat
 where s.slug = 'ponte-nova' or abs(hashtext(s.slug || t.sku)) % 6 <> 0
on conflict (store_id, slug) do nothing;

insert into public.product_images (product_id, store_id, url, sort_order)
select p.id, p.store_id, img.url, img.ord - 1
  from public.products p
  join seed_products t on t.sku = p.sku
 cross join unnest(t.images) with ordinality as img(url, ord);

insert into public.product_variants (product_id, store_id, name, color, image_url, sort_order)
select p.id, p.store_id, v.value ->> 'name', v.value ->> 'color', v.value ->> 'image', v.ord - 1
  from public.products p
  join seed_products t on t.sku = p.sku
 cross join jsonb_array_elements(t.variants) with ordinality as v(value, ord);

-- Vitrine de cada loja
insert into public.collections (store_id, key, title, subtitle, layout, badge_all, sort_order)
select s.id, x.key, x.title, x.subtitle, x.layout, x.badge_all, x.sort_order
  from public.stores s
 cross join (values
   ('queridinhos', 'Queridinhos da Atual', null, 'five', null, 1),
   ('ofertas', 'Ofertas da Semana', null, 'six', null, 2),
   ('novidades', 'Acabaram de chegar', 'Novos favoritos para a sua casa.', 'five', 'novo', 3)
 ) as x(key, title, subtitle, layout, badge_all, sort_order)
on conflict (store_id, key) do nothing;

insert into public.collection_items (collection_id, product_id, sort_order)
select c.id, p.id, x.ord
  from public.collections c
  join (values
    ('queridinhos', array['AT-SOF-001','AT-COL-001','AT-TV-001','AT-SOF-004','AT-CAM-001','AT-GEL-001','AT-MCE-001','AT-LAV-001','AT-POL-001','AT-FOG-001']),
    ('ofertas', array['AT-SOF-002','AT-MCE-002','AT-FOG-001','AT-POR-001','AT-SOF-003','AT-POL-002','AT-COM-001','AT-CAD-001','AT-COM-002','AT-LAV-001','AT-COL-001','AT-MCE-001']),
    ('novidades', array['AT-POL-001','AT-POL-002','AT-CAD-001','AT-COM-002','AT-SOF-004','AT-CAM-001','AT-GEL-001','AT-COM-001','AT-MCE-002','AT-POR-001'])
  ) as k(key, skus) on k.key = c.key
 cross join unnest(k.skus) with ordinality as x(sku, ord)
  join public.products p on p.store_id = c.store_id and p.sku = x.sku
on conflict do nothing;

-- Banners do slideshow de cada loja (com produtos do ambiente)
insert into public.banners (store_id, kind, title, kicker, text, image_url, image_mobile_url, link_url, pin_product_ids, sort_order)
select s.id, 'hero', x.title, x.kicker, x.text, x.img || '-wide', x.img || '-m', x.link,
       array(select p.id from unnest(x.skus) with ordinality u(sku, ord)
               join public.products p on p.store_id = s.id and p.sku = u.sku order by u.ord),
       x.sort_order
  from public.stores s
 cross join (values
   ('Sala de Jantar', 'Nova coleção', 'Mesas e cadeiras em madeira para reunir quem você ama.', 'hero-1', '?categoria=mesas-e-cadeiras', array['AT-CAD-001'], 1),
   ('Sala completa', 'Sala de estar', 'Sofás, poltronas e mesas para deixar a sala do seu jeito.', 'hero-2', '#ofertas', array['AT-SOF-003', 'AT-MCE-001'], 2),
   ('Durma melhor', 'Semana do sono', 'Camas e colchões com entrega rápida na sua cidade.', 'hero-3', '?categoria=camas', array['AT-CAM-001', 'AT-COL-001'], 3)
 ) as x(title, kicker, text, img, link, skus, sort_order);

-- Mosaicos e ambientes valem para toda a rede
insert into public.banners (store_id, kind, title, text, image_url, link_url, sort_order) values
  (null, 'mosaic', 'Detalhes em Madeira', 'Acabamentos que trazem calor e personalidade.', 'edit-1', '?categoria=comodas', 1),
  (null, 'mosaic', 'Cantinhos com Estilo', 'Peças funcionais para compor cada ambiente.', 'edit-2', '?categoria=mesas-de-centro', 2),
  (null, 'mosaic', 'Noites Bem Dormidas', 'Camas e colchões para renovar suas energias.', 'edit-3', '?categoria=colchoes', 3),
  (null, 'mosaic', 'Conforto que Abraça', 'Poltronas e sofás para receber bem quem você ama.', 'edit-4', '?categoria=poltronas', 4),
  (null, 'room', 'Tudo em Sala de Jantar', null, 'room-sala-jantar', '?categoria=mesas-e-cadeiras', 1),
  (null, 'room', 'Tudo em Sala de Estar', null, 'room-sala-estar', '?categoria=sofas', 2),
  (null, 'room', 'Tudo em Quarto', null, 'room-quarto', '?categoria=camas', 3),
  (null, 'room', 'Tudo em Cozinha', null, 'room-cozinha', '?categoria=fogoes', 4);

insert into public.announcements (store_id, text, cta_label, cta_url, sort_order) values
  (null, 'Frete grátis acima de R$ 999 dentro do raio de entrega da sua loja*', 'Ver ofertas', '#ofertas', 1);

-- Cupom de exemplo (desativado)
insert into public.coupons (store_id, code, description, type, value, min_order, active) values
  (null, 'BEMVINDO5', 'Exemplo: 5% de desconto na primeira compra', 'percent', 5, 300, false)
on conflict do nothing;

drop table seed_products;
