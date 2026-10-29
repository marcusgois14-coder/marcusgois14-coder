/*
 * Conteúdo editável da vitrine.
 * Troque textos, preços, imagens e links aqui — o layout é montado a partir destes dados.
 * Produtos, preços e condições comerciais abaixo são EXEMPLOS de demonstração.
 */
window.ATUAL = {
  store: {
    name: 'Atual Móveis e Eletro',
    legalName: 'ATUAL MOVEIS E COLCHOES LTDA',
    cnpj: '13.260.630/0001-47',
    address: 'Av. Abdala Felício, 370 - Centro, Ponte Nova - MG, 35430-028',
    phone: '(31) 3817-2969',
    // Somente dígitos, com DDI 55. Confirme o número de WhatsApp da loja.
    whatsapp: '553138172969',
    // Preencha para exibir no rodapé (campos vazios ficam ocultos).
    email: '',
    hours: '',
    instagram: 'https://www.instagram.com/atualmoveispontenova/',
    facebook: 'https://www.facebook.com/atualmoveiseeletro/',
    // O preço exibido nos cards é o preço no PIX; no cartão o total é price / (1 - pixDiscount).
    pixDiscount: 0.05,
    installments: 10,
    freeShippingMin: 999,
  },

  announcements: [
    { text: 'Frete grátis em Ponte Nova e região nas compras acima de R$ 999*', cta: 'Ver ofertas', href: '#ofertas' },
  ],

  // Itens com "children" viram acordeão no menu lateral e mega menu (telas ≥ 1600px).
  menu: [
    { label: 'Novidades', href: '#novidades' },
    {
      label: 'Móveis',
      children: [
        { label: 'Sala de Estar', links: ['Sofás', 'Sofás Retráteis e Reclináveis', 'Poltronas', 'Racks e Painéis', 'Mesas de Centro e Laterais', 'Estantes'] },
        { label: 'Sala de Jantar', links: ['Conjuntos de Jantar', 'Mesas de Jantar', 'Cadeiras', 'Buffets e Cristaleiras'] },
        { label: 'Quarto', links: ['Camas', 'Guarda-roupas', 'Cômodas', 'Cabeceiras', 'Criados-mudos', 'Quarto Infantil'] },
        { label: 'Cozinha', links: ['Cozinhas Compactas', 'Armários Aéreos', 'Balcões e Paneleiros'] },
        { label: 'Escritório', links: ['Escrivaninhas', 'Cadeiras de Escritório'] },
      ],
    },
    {
      label: 'Colchões',
      children: [
        { label: 'Colchões', links: ['Colchões de Casal', 'Colchões Queen e King', 'Colchões de Solteiro', 'Conjuntos Box', 'Travesseiros'] },
      ],
    },
    {
      label: 'Eletro',
      children: [
        { label: 'Eletrodomésticos', links: ['Geladeiras', 'Fogões e Cooktops', 'Lavadoras e Tanquinhos', 'Micro-ondas', 'Freezers'] },
        { label: 'Eletroportáteis', links: ['Air Fryers', 'Cafeteiras', 'Liquidificadores', 'Ventiladores', 'Ferros de Passar'] },
        { label: 'TV e Áudio', links: ['Smart TVs', 'Caixas de Som'] },
      ],
    },
    { label: 'Ofertas da Semana', href: '#ofertas', highlight: true },
    { label: 'Nossa Loja', href: 'maps' },
  ],

  hero: [
    {
      kicker: 'Nova coleção',
      title: 'Sala de Jantar',
      text: 'Mesas e cadeiras em madeira para reunir quem você ama.',
      image: 'hero-1',
      href: '#queridinhos',
      products: ['p09', 'p11'],
    },
    {
      kicker: 'Sala de estar',
      title: 'Sala completa',
      text: 'Sofás, poltronas e mesas para deixar a sala do seu jeito.',
      image: 'hero-2',
      href: '#ofertas',
      products: ['p04', 'p03', 'p10'],
    },
    {
      kicker: 'Semana do sono',
      title: 'Durma melhor',
      text: 'Camas, colchões e criados-mudos com entrega rápida.',
      image: 'hero-3',
      href: '#novidades',
      products: ['p05', 'p06', 'p13'],
    },
  ],

  categories: [
    { name: 'Sofás', image: 'cat-sofa', href: '#' },
    { name: 'Colchões', image: 'cat-colchao', href: '#' },
    { name: 'Poltronas', image: 'cat-poltrona', href: '#' },
    { name: 'Guarda-roupas', image: 'cat-guarda-roupa', href: '#' },
    { name: 'Mesas e Cadeiras', image: 'cat-mesa-jantar', href: '#' },
    { name: 'Racks e Painéis', image: 'cat-rack', href: '#' },
    { name: 'Cozinhas', image: 'cat-cozinha', href: '#' },
    { name: 'Escritório', image: 'cat-escritorio', href: '#' },
    { name: 'Geladeiras', image: 'cat-geladeira', href: '#' },
    { name: 'Fogões', image: 'cat-fogao', href: '#' },
    { name: 'Lavadoras', image: 'cat-lavadora', href: '#' },
    { name: 'TVs', image: 'cat-tv', href: '#' },
    { name: 'Eletroportáteis', image: 'cat-portateis', href: '#' },
  ],

  /*
   * price: preço no PIX (o que aparece no card) · compareAt: preço "de" riscado
   * image / image2: foto principal e foto que aparece ao passar o mouse
   * badge: 'novo' | 'frete' · fastDelivery: ícone de caminhão (pronta entrega) · promo: preço em destaque + selo %
   * swatches: cores; "image" opcional troca a foto do card ao clicar
   */
  products: [
    { id: 'p01', category: 'Sofás', name: 'Sofá 3 Lugares Retrô 210 cm Pés de Madeira - Veludo Verde', price: 2499.9, compareAt: 3599.9, image: 'prod-01', badge: 'frete', fastDelivery: true, swatches: [{ color: '#1f5a4a' }, { color: '#b5703a' }, { color: '#8c8c8c' }] },
    { id: 'p02', category: 'Sofás', name: 'Sofá Chesterfield 3 Lugares 220 cm - Couro Sintético Café', price: 3299.9, compareAt: 4999.9, image: 'prod-02', promo: true, fastDelivery: true, swatches: [{ color: '#3b2a20' }, { color: '#1d1d1d' }] },
    { id: 'p03', category: 'Sofás', name: 'Sofá 2 Lugares Confort 180 cm - Couro Sintético Bege', price: 1899.9, compareAt: 2599.9, image: 'prod-03', badge: 'frete', swatches: [{ color: '#d8cba0' }, { color: '#efe9df' }, { color: 'linear-gradient(90deg,#d8cba0 50%,#7a4a2b 50%)' }] },
    { id: 'p04', category: 'Sofás', name: 'Sofá Orgânico 3 Lugares 230 cm Base de Madeira - Linho Cinza', price: 3799.9, compareAt: 5199.9, image: 'prod-04', badge: 'novo', fastDelivery: true, swatches: [{ color: '#a9a9a9' }, { color: '#e6dccb' }] },
    { id: 'p05', category: 'Camas', name: 'Cama Casal de Madeira Maciça Nórdica 138x188 cm - Natural', price: 1699.9, compareAt: 2299.9, image: 'prod-05', badge: 'novo', swatches: [{ color: '#c8995e' }, { color: '#7a4a2b' }] },
    { id: 'p06', category: 'Colchões', name: 'Colchão Casal Molas Ensacadas Pillow Top 138x188x30 cm', price: 1799.9, compareAt: 2699.9, image: 'prod-06', image2: 'prod-06-b', badge: 'frete', fastDelivery: true, swatches: [] },
    { id: 'p07', category: 'Poltronas', name: 'Poltrona Decorativa Bouclé com Pés de Madeira - Off White', price: 899.9, compareAt: 1299.9, image: 'prod-07', image2: 'prod-07-b', badge: 'novo', swatches: [{ color: '#efe9df' }, { color: '#9c7a5b' }] },
    { id: 'p08', category: 'Poltronas', name: 'Poltrona Industrial Estofada Estrutura Metálica - Terracota', price: 1099.9, compareAt: 1499.9, image: 'prod-08', image2: 'prod-08-b', badge: 'novo', fastDelivery: true, swatches: [{ color: '#c9692b' }, { color: '#1d1d1d' }, { color: '#6f6f6f' }] },
    { id: 'p09', category: 'Cadeiras', name: 'Cadeira de Jantar Estofada Pés de Madeira Maciça - Linho Cinza', price: 449.9, compareAt: 699.9, image: 'prod-09', badge: 'novo', swatches: [{ color: '#9e9e9e' }, { color: '#efe9df' }, { color: '#c9692b' }] },
    { id: 'p10', category: 'Mesas de Centro', name: 'Mesa de Centro Rústica de Madeira Maciça 110 cm - Demolição', price: 799.9, compareAt: 1199.9, image: 'prod-10', badge: 'frete', fastDelivery: true, swatches: [{ color: '#7a4a2b' }, { color: '#c8995e' }] },
    { id: 'p11', category: 'Mesas Laterais', name: 'Mesa Lateral de Madeira com Nicho para Livros - Freijó', price: 349.9, compareAt: 499.9, image: 'prod-11', promo: true, swatches: [{ color: '#a0663b' }, { color: '#1d1d1d' }] },
    { id: 'p12', category: 'Cômodas', name: 'Cômoda 6 Gavetas Pés Palito 120 cm - Carvalho Natural', price: 1199.9, compareAt: 1699.9, image: 'prod-12', badge: 'frete', swatches: [{ color: '#d9bf94' }, { color: '#ffffff' }] },
    { id: 'p13', category: 'Criados-mudos', name: 'Criado-mudo 2 Gavetas Madeira Maciça - Tabaco', price: 549.9, compareAt: 799.9, image: 'prod-13', image2: 'prod-13-b', badge: 'novo', swatches: [{ color: '#4a2f22' }, { color: '#c8995e' }] },
    { id: 'p14', category: 'Smart TVs', name: 'Smart TV 55" 4K UHD Wi-Fi com Comando de Voz', price: 2599.9, compareAt: 3299.9, image: 'prod-14', image2: 'prod-14-b', badge: 'frete', fastDelivery: true, swatches: [] },
    { id: 'p15', category: 'Geladeiras', name: 'Geladeira Retrô 1 Porta 270 Litros - Azul Claro', price: 4299.9, compareAt: 5299.9, image: 'prod-15', badge: 'novo', fastDelivery: true, swatches: [{ color: '#a9d6d4', image: 'prod-15' }, { color: '#4cbfa6', image: 'prod-15-b' }] },
    { id: 'p16', category: 'Lavadoras', name: 'Lava e Seca 11 kg Abertura Frontal - Branca', price: 2899.9, compareAt: 3599.9, image: 'prod-16', image2: 'prod-16-b', badge: 'frete', fastDelivery: true, swatches: [{ color: '#ffffff' }, { color: '#c0c0c0' }] },
    { id: 'p17', category: 'Fogões', name: 'Fogão 5 Bocas Inox com Forno 90 Litros e Acendimento Automático', price: 1599.9, compareAt: 2199.9, image: 'prod-17', promo: true, fastDelivery: true, swatches: [{ color: '#c0c0c0' }, { color: '#1d1d1d' }] },
    { id: 'p18', category: 'Eletroportáteis', name: 'Cafeteira Elétrica Retrô 1,2 Litro - Preta', price: 249.9, compareAt: 399.9, image: 'prod-18', promo: true, swatches: [{ color: '#1d1d1d' }, { color: '#ffffff' }] },
  ],

  sections: {
    queridinhos: ['p01', 'p06', 'p14', 'p04', 'p05', 'p15', 'p10', 'p16', 'p07', 'p17'],
    ofertas: ['p02', 'p11', 'p17', 'p18', 'p03', 'p08', 'p12', 'p09', 'p13', 'p16', 'p06', 'p10'],
    novidades: ['p07', 'p08', 'p09', 'p13', 'p04', 'p05', 'p15', 'p12', 'p11', 'p18'],
  },

  popularSearches: ['Sofá', 'Colchão casal', 'Poltrona', 'Geladeira', 'Fogão 5 bocas', 'Lava e seca', 'Smart TV', 'Cômoda'],
  searchCategories: ['Sala de Estar', 'Quarto', 'Cozinha', 'Colchões', 'Eletro', 'Mais vendidos'],

  marquee: [
    'Entrega em Ponte Nova e região',
    'Montagem de móveis',
    'Parcele no cartão ou crediário',
    '5% OFF no PIX',
    'Atendimento pelo WhatsApp',
    'Loja no Centro de Ponte Nova',
  ],

  editorial: [
    { title: 'Detalhes em Madeira', text: 'Acabamentos que trazem calor e personalidade.', image: 'edit-1', href: '#' },
    { title: 'Cantinhos com Estilo', text: 'Peças funcionais para compor cada ambiente.', image: 'edit-2', href: '#' },
    { title: 'Noites Bem Dormidas', text: 'Camas e colchões para renovar suas energias.', image: 'edit-3', href: '#' },
    { title: 'Conforto que Abraça', text: 'Poltronas e sofás para receber bem quem você ama.', image: 'edit-4', href: '#' },
  ],

  rooms: [
    { title: 'Tudo em Sala de Jantar', image: 'room-sala-jantar', href: '#' },
    { title: 'Tudo em Sala de Estar', image: 'room-sala-estar', href: '#' },
    { title: 'Tudo em Quarto', image: 'room-quarto', href: '#' },
    { title: 'Tudo em Cozinha', image: 'room-cozinha', href: '#' },
  ],
};
