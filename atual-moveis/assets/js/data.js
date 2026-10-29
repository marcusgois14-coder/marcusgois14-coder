/*
 * Conteúdo editável da vitrine.
 * Troque nomes, preços, imagens e links aqui — o layout é montado a partir destes dados.
 * Os produtos e preços abaixo são EXEMPLOS de demonstração.
 */
window.ATUAL = {
  store: {
    name: 'Atual Móveis e Eletro',
    legalName: 'ATUAL MOVEIS E COLCHOES LTDA',
    cnpj: '13.260.630/0001-47',
    address: 'Av. Abdala Felício, 370 - Centro, Ponte Nova - MG, 35430-028',
    phone: '(31) 3817-2969',
    // Somente dígitos com DDI 55 — confirme o número de WhatsApp da loja.
    whatsapp: '553138172969',
    // Preencha para exibir no rodapé (campos vazios ficam ocultos).
    email: '',
    hours: '',
    instagram: 'https://www.instagram.com/atualmoveispontenova/',
    facebook: 'https://www.facebook.com/atualmoveiseeletro/',
    pixDiscount: 0.05,
    installments: 10,
  },

  announcements: [
    { text: 'Frete grátis em Ponte Nova e região para compras acima de R$ 999*', cta: 'Ver ofertas', href: '#ofertas' },
    { text: 'Parcele em até 10x sem juros no cartão ou no crediário Atual', cta: 'Saiba mais', href: '#beneficios' },
    { text: '5% de desconto pagando no PIX', cta: 'Aproveitar', href: '#queridinhos' },
  ],

  menu: [
    { label: 'Ofertas da semana', href: '#ofertas', highlight: true },
    { label: 'Lançamentos', href: '#novidades' },
    {
      label: 'Sala de Estar',
      children: ['Sofás', 'Sofás Retráteis e Reclináveis', 'Poltronas', 'Racks e Painéis', 'Mesas de Centro e Laterais', 'Estantes'],
    },
    {
      label: 'Sala de Jantar',
      children: ['Conjuntos de Jantar', 'Mesas de Jantar', 'Cadeiras', 'Buffets e Aparadores', 'Cristaleiras'],
    },
    {
      label: 'Quarto',
      children: ['Colchões', 'Camas Box', 'Cabeceiras', 'Guarda-roupas', 'Cômodas', 'Criados-mudos', 'Quarto Infantil'],
    },
    {
      label: 'Cozinha',
      children: ['Cozinhas Completas', 'Armários Aéreos', 'Balcões', 'Mesas com Cadeiras'],
    },
    {
      label: 'Eletrodomésticos',
      children: ['Geladeiras', 'Fogões e Cooktops', 'Micro-ondas', 'Lavadoras', 'Freezers', 'Ar e Ventilação'],
    },
    {
      label: 'Eletroportáteis',
      children: ['Air Fryers', 'Liquidificadores', 'Cafeteiras', 'Batedeiras', 'Ferros de Passar'],
    },
    {
      label: 'TV e Áudio',
      children: ['Smart TVs', 'Caixas de Som', 'Home Theater'],
    },
    { label: 'Escritório', children: ['Escrivaninhas', 'Cadeiras de Escritório', 'Estantes'] },
    { label: 'Nossa loja', href: '#beneficios' },
  ],

  hero: [
    {
      kicker: 'Nova coleção',
      title: 'Jantar em família',
      text: 'Mesas e cadeiras em madeira para reunir quem você ama.',
      image: 'hero-1',
      align: 'left',
      product: 'p01',
    },
    {
      kicker: 'Semana do sono',
      title: 'Durma melhor',
      text: 'Colchões e camas com conforto de verdade e entrega rápida.',
      image: 'hero-3',
      align: 'left',
      product: 'p07',
    },
    {
      kicker: 'Sala de estar',
      title: 'Conforto que abraça',
      text: 'Sofás retráteis e reclináveis para a sua sala ficar completa.',
      image: 'hero-2',
      align: 'left',
      product: 'p03',
    },
  ],

  categories: [
    { name: 'Sofás', image: 'cat-sofa', href: '#' },
    { name: 'Colchões', image: 'cat-colchao', href: '#' },
    { name: 'Guarda-roupas', image: 'cat-guarda-roupa', href: '#' },
    { name: 'Cozinhas', image: 'cat-cozinha', href: '#' },
    { name: 'Mesas e Cadeiras', image: 'cat-mesa', href: '#' },
    { name: 'Racks e Painéis', image: 'cat-rack', href: '#' },
    { name: 'Poltronas', image: 'cat-poltrona', href: '#' },
    { name: 'Geladeiras', image: 'cat-geladeira', href: '#' },
    { name: 'Fogões', image: 'cat-fogao', href: '#' },
    { name: 'Lavadoras', image: 'cat-lavadora', href: '#' },
    { name: 'TVs', image: 'cat-tv', href: '#' },
    { name: 'Eletroportáteis', image: 'cat-eletroportateis', href: '#' },
  ],

  // badge: 'novo' | 'frete' | 'oferta' — swatches: cores disponíveis (hex)
  products: [
    { id: 'p01', name: 'Conjunto de Jantar Mesa Redonda 120 cm com 4 Cadeiras Estofadas - Freijó', price: 3899.9, compareAt: 5299.9, image: 'prod-01', badge: 'novo', freeShipping: false, swatches: ['#a0663b', '#e9e2d4', '#3b2a20'] },
    { id: 'p02', name: 'Mesa de Jantar Retangular 6 Lugares 180 cm Tampo Madeira - Nogueira', price: 2149.9, compareAt: 2899.9, image: 'prod-02', badge: 'frete', freeShipping: true, swatches: ['#7a4a2b', '#d9cbb4'] },
    { id: 'p03', name: 'Sofá Retrátil e Reclinável 3 Lugares 230 cm - Suede Caramelo', price: 2699.9, compareAt: 3799.9, image: 'prod-03', badge: 'frete', freeShipping: true, swatches: ['#b5703a', '#e6dccb', '#6f6f6f'] },
    { id: 'p04', name: 'Rack com Painel para TV até 65" com LED e Portas Ripadas - Cinamomo', price: 1499.9, compareAt: 2149.9, image: 'prod-04', badge: 'frete', freeShipping: true, swatches: ['#8a5a36', '#c8b28d'] },
    { id: 'p05', name: 'Conjunto 2 Cadeiras de Madeira Maciça Estofadas - Natural c/ Linho Bege', price: 699.9, compareAt: 1079.9, image: 'prod-05', badge: 'oferta', freeShipping: false, swatches: ['#efe9df', '#bdbdbd'] },
    { id: 'p06', name: 'Poltrona Decorativa Giratória Lívia - Bouclé Off White', price: 899.9, compareAt: 1299.9, image: 'prod-06', badge: 'novo', freeShipping: false, swatches: ['#f1ece3', '#9c7a5b'] },
    { id: 'p07', name: 'Colchão Casal Molas Ensacadas Pillow Top 138x188 cm', price: 1799.9, compareAt: 2599.9, image: 'prod-07', badge: 'frete', freeShipping: true, swatches: [] },
    { id: 'p08', name: 'Cama Box Casal com Cabeceira Estofada Aurora - Linho Cinza', price: 2299.9, compareAt: 3199.9, image: 'prod-08', badge: 'novo', freeShipping: false, swatches: ['#bdbdbd', '#efe9df'] },
    { id: 'p09', name: 'Guarda-Roupa Casal 6 Portas 4 Gavetas com Espelho - Amêndoa', price: 2499.9, compareAt: 3399.9, image: 'prod-09', badge: 'frete', freeShipping: true, swatches: ['#c9a27a', '#ffffff'] },
    { id: 'p10', name: 'Cozinha Compacta 5 Peças com Balcão e Tampo - Branco/Freijó', price: 1899.9, compareAt: 2699.9, image: 'prod-10', badge: 'oferta', freeShipping: false, swatches: ['#ffffff', '#a0663b'] },
    { id: 'p11', name: 'Geladeira Frost Free Duplex 375 Litros - Inox', price: 3299.9, compareAt: 3999.9, image: 'prod-11', badge: 'frete', freeShipping: true, swatches: ['#c0c0c0', '#ffffff'] },
    { id: 'p12', name: 'Fogão 5 Bocas com Mesa de Vidro e Acendimento Automático - Inox', price: 1399.9, compareAt: 1799.9, image: 'prod-12', badge: 'oferta', freeShipping: false, swatches: ['#c0c0c0', '#1d1d1d'] },
    { id: 'p13', name: 'Lavadora de Roupas 12 kg com Cesto Inox - Branca', price: 1899.9, compareAt: 2399.9, image: 'prod-13', badge: 'frete', freeShipping: true, swatches: ['#ffffff'] },
    { id: 'p14', name: 'Smart TV 55" 4K UHD com Wi-Fi e Comando de Voz', price: 2599.9, compareAt: 3299.9, image: 'prod-14', badge: 'novo', freeShipping: false, swatches: [] },
    { id: 'p15', name: 'Cadeira de Madeira Maciça Estofada Eron - Natural c/ Couro Sintético Caramelo', price: 599.9, compareAt: 899.9, image: 'prod-15', badge: 'novo', freeShipping: false, swatches: ['#1d1d1d', '#c9692b', '#7a7a7a', '#b5703a'] },
    { id: 'p16', name: 'Buffet 4 Portas 160 cm Pés Palito - Nogueira', price: 1299.9, compareAt: 1899.9, image: 'prod-16', badge: 'oferta', freeShipping: false, swatches: ['#7a4a2b', '#1d1d1d'] },
    { id: 'p17', name: 'Mesa de Centro Orgânica Tampo Madeira 90 cm - Freijó', price: 549.9, compareAt: 799.9, image: 'prod-17', badge: 'novo', freeShipping: false, swatches: ['#a0663b', '#efe9df'] },
    { id: 'p18', name: 'Air Fryer Digital 5,5 Litros Antiaderente - Preta', price: 399.9, compareAt: 599.9, image: 'prod-18', badge: 'frete', freeShipping: true, swatches: ['#1d1d1d', '#ffffff'] },
  ],

  sections: {
    queridinhos: ['p01', 'p02', 'p03', 'p04', 'p05', 'p11', 'p07', 'p09', 'p14', 'p16'],
    curadoria: ['p06', 'p03', 'p04', 'p01', 'p16', 'p08', 'p17', 'p10', 'p12', 'p13'],
    chegadas: ['p15', 'p05', 'p06', 'p08', 'p14', 'p17', 'p18', 'p01', 'p11', 'p02'],
  },

  marquee: [
    'Entrega rápida em Ponte Nova e região',
    'Montagem com equipe própria',
    'Parcele em até 10x sem juros',
    'Crediário Atual',
    '5% OFF no PIX',
    'Atendimento pelo WhatsApp',
    'Loja física no Centro de Ponte Nova',
  ],

  editorial: [
    { title: 'Detalhes em Madeira', text: 'Acabamentos que trazem calor e personalidade.', image: 'edit-1', href: '#' },
    { title: 'Formas que Inspiram', text: 'Peças orgânicas para compor cada cantinho.', image: 'edit-2', href: '#' },
    { title: 'Noites Bem Dormidas', text: 'Colchões e camas para renovar suas energias.', image: 'edit-3', href: '#' },
    { title: 'Conforto que Abraça', text: 'Sofás e poltronas para receber bem.', image: 'edit-4', href: '#' },
  ],

  rooms: [
    { title: 'Tudo para Sala de Jantar', image: 'room-sala-jantar', href: '#' },
    { title: 'Tudo para Sala de Estar', image: 'room-sala-estar', href: '#' },
    { title: 'Tudo para Quarto', image: 'room-quarto', href: '#' },
    { title: 'Tudo para Cozinha', image: 'room-cozinha', href: '#' },
  ],
};
