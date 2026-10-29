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

## Deploy na SquareCloud

O `squarecloud.app` já está pronto (`MAIN=server.js`, 512 MB, subdomínio `atualmoveis`). Basta compactar o conteúdo da pasta `atual-moveis/` em um `.zip` e enviar, ou usar a CLI da SquareCloud de dentro da pasta.
