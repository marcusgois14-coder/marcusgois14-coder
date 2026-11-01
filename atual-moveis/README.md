# Atual Móveis e Eletro — vitrine

Página inicial da **Atual Móveis e Eletro** (Ponte Nova - MG), com estrutura e interações baseadas na home da Homedock (loja Shopify, tema Dawn customizado) e identidade visual da Atual: logo, vermelho `#E31B23` e laranja `#F28125`.

Site estático (HTML, CSS e JavaScript puro), sem build e sem dependências.

## Rodar localmente

```bash
cd atual-moveis
npm run dev        # http://localhost:8080
```

Também funciona abrindo o `index.html` direto no navegador.

## Estrutura

```
atual-moveis/
├── index.html            # marcação das seções
├── assets/css/style.css  # estilos e tokens de cor (variáveis no :root)
├── assets/js/data.js     # CONTEÚDO EDITÁVEL: loja, menu, banners, categorias, produtos
├── assets/js/main.js     # comportamento (slideshow, carrosséis, carrinho, favoritos, busca…)
├── assets/brand/         # logo em SVG (colorida e branca), favicon
├── assets/img/           # fotos (JPG + WebP)
├── server.js             # servidor estático sem dependências (deploy)
└── squarecloud.app       # configuração para a SquareCloud
```

## Seções (na ordem da Homedock)

1. Barra de anúncio com mensagens rotativas e botão
2. Cabeçalho transparente sobre o banner, que fica branco ao rolar (logo branca → colorida), com busca, “Rastrear pedido”, favoritos, conta e carrinho
3. Slideshow com setas, indicadores, autoplay e cartão “No ambiente”
4. Faixa de categorias com rolagem horizontal (arrastável no mouse)
5. Carrossel “Queridinhos da Atual”
6. Faixa rolante de vantagens (no lugar dos logos de imprensa)
7. Carrossel “Curadoria Atual” (6 por linha)
8. Grade editorial 2×2
9. Carrossel “Acabaram de chegar”
10. Ambientes (“Tudo para…”)
11. Barra de benefícios
12. Rodapé com slogan, newsletter, atendimento, links, formas de pagamento e texto institucional

Extras: menu lateral com submenus, carrinho lateral (finaliza o pedido pelo WhatsApp), favoritos, busca instantânea, botão flutuante do WhatsApp, aviso de cookies.

## O que conferir antes de publicar

Os dados públicos usados vieram de cadastros online e precisam ser confirmados pela loja:

- **Telefone/WhatsApp**: `(31) 3817-2969` aparece em um diretório, mas outro cadastro lista `(31) 3817-2978`. Ajuste `phone` e `whatsapp` em `assets/js/data.js`.
- **E-mail e horário**: vazios em `data.js`; preencha para aparecerem no rodapé.
- **CNPJ e endereço**: `13.260.630/0001-47`, Av. Abdala Felício, 370 - Centro.
- **Produtos e preços**: são exemplos. Troque em `products` dentro de `data.js`.
- **Promoções e condições** (frete grátis acima de R$ 999, 10x sem juros, 5% no PIX, crediário, montagem): são textos de exemplo; ajuste para as condições reais.
- **Fotos**: banco de imagens livre (Unsplash License). Créditos em `assets/img/credits.json`. O ideal é trocar pelas fotos reais dos produtos da loja.

## Trocar cores

Em `assets/css/style.css`, no topo:

```css
--brand-red: #e31b23;
--brand-orange: #f28125;
```

## 3D automático dos produtos

Todo produto cadastrado em qualquer loja ganha um modelo 3D na hora, sem nenhum passo manual. O
modelo é montado no navegador (Three.js) a partir dos dados do próprio produto:

- **Categoria**: diz o tipo (sofá, cama, guarda-roupa, geladeira, coifa, tapete…). Categoria nova
  também funciona: se o nome dela não for reconhecido, vale o nome do produto; se nada for
  reconhecido, sai um móvel neutro com as medidas do produto.
- **Medidas**: largura, altura e profundidade (cm). Sem medidas, usa as do nome ("138x188",
  "210 cm", `55"`, "2,00 x 2,50 m") ou um padrão do tipo. Medida digitada em mm ou em metros é corrigida.
- **Nome e especificações**: detalhes como "3 lugares", "6 portas 4 gavetas", "pés palito",
  "capitonê", "redondo", "4 bocas", "8 serviços", "com espelho".
- **Cores**: a cor de cada variação (`#hex` ou gradiente) ou a cor escrita no nome ("Veludo Verde",
  "Freijó e Off White"). O cliente troca a cor e o 3D acompanha.

Serviços (garantia, frete, montagem) ficam sem 3D.

Ajustes opcionais, só quando o automático não acertar:

- **Por categoria** (`categories.model_kind`): força o tipo de todos os produtos da categoria. Valores:
  `sofa`, `armchair`, `chair`, `bed`, `mattress`, `coffee_table`, `side_table`, `dining_table`, `dresser`,
  `nightstand`, `wardrobe`, `rack`, `shelf`, `desk`, `tv`, `fridge`, `washer`, `stove`,
  `small_appliance`, `generic` ou `none` (sem 3D).
- **Por produto** (`products.model3d`): o padrão `{}` é automático. Aceita `kind` (tipo), `style`,
  `colors` e `material`. Por exemplo, `{"kind": "armchair", "colors": {"main": "mostarda"}, "style": {"legs": "metal"}}`.
  Com `{"kind": "none"}` o produto fica sem 3D.
- **Modelo próprio** (`products.model_url`): um arquivo `.glb` enviado pela equipe substitui o
  gerado. Ele é ajustado às medidas do produto. Se não carregar, a loja volta ao modelo automático.

Onde ver:

- **Galeria 3D**: `/admin/3d.html`, sem login. Mostra o 3D de todos os produtos de cada loja, com a
  foto ao lado. Em "Simular produto novo", digite nome, categoria (pode ser uma que ainda não existe),
  medidas e cor para ver o modelo que será criado. Links para conferência automática:
  `?store=<loja>&sku=<SKU>&view=front|three-quarter|side|top|back&size=<px>` e
  `?product=<JSON>&category=<nome>`.
- **Na loja**: "Ver em 3D" na página do produto. No celular, "Ver no seu ambiente" abre a câmera (AR).
- **Monte seu ambiente**: `/loja/<loja>?ambiente=1` abre o planejador de sala em 3D. Com
  `&add=<produto>`, ele já começa com aquele produto.

Código: `assets/js/3d/infer.js` (regras: tipo, medidas, cores, estilo), `kit.js` (materiais e
formas), `models/*.js` (um gerador por grupo de produtos), `stage.js` (luz e câmera), `viewer.js`
(visualizador da loja) e `room.js` (ambiente).

## Deploy na SquareCloud

O `squarecloud.app` já está pronto (`MAIN=server.js`, 512 MB, subdomínio `atualmoveis`). Basta compactar o conteúdo da pasta `atual-moveis/` em um `.zip` e enviar, ou usar a CLI da SquareCloud de dentro da pasta.

## Deploy no Cloudflare Pages

O site é estático (o banco é o Supabase), então roda no Cloudflare Pages sem servidor.
`node scripts/build-cloudflare.mjs` gera a pasta `dist/` só com os arquivos públicos
(`index.html`, `assets/`, `admin/`, `robots.txt`), mais `_redirects` (rotas `/loja/…` e
`/pedido/…` abrem o `index.html`) e `_headers` (cabeçalhos de segurança e cache).

**Pelo painel da Cloudflare (sem token):** Workers & Pages → Create → Pages → Connect to Git →
escolha este repositório e preencha:

| Campo | Valor |
| --- | --- |
| Production branch | `claude/atual-moveis-site` (ou `main`, depois do merge) |
| Root directory | `atual-moveis` |
| Build command | `node scripts/build-cloudflare.mjs` |
| Build output directory | `dist` |

**Pela linha de comando:** com `CLOUDFLARE_API_TOKEN` (permissão *Cloudflare Pages: Edit*) e
`CLOUDFLARE_ACCOUNT_ID` definidos, rode `npm run deploy:cloudflare` dentro de `atual-moveis/`.

Depois do primeiro deploy, adicione o endereço `https://<projeto>.pages.dev` em Supabase →
Authentication → URL Configuration (Site URL e Redirect URLs), para o "esqueci minha senha"
do painel funcionar.
