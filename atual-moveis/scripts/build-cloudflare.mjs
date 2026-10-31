// Gera a pasta dist/ para publicar no Cloudflare Pages (site estático, sem servidor).
// Copia só o que é público, cria as regras de rota e cabeçalhos do Pages e carimba uma
// versão nos CSS/JS para o navegador nunca ficar com arquivo antigo depois de um deploy.
//   node scripts/build-cloudflare.mjs
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of ['index.html', 'robots.txt', 'assets', 'admin']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}
// Páginas de teste temporárias nunca vão para o ar
rmSync(join(out, 'assets/js/3d/_viewer-test.html'), { force: true });
rmSync(join(out, 'assets/js/3d/_room-test.html'), { force: true });

// ---------- Versão dos arquivos (cache) ----------
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const isOwnCode = (p) => ['.js', '.css', '.html'].includes(extname(p)) && !p.includes(`${join('assets', 'vendor')}`);
const files = walk(out).filter(isOwnCode);
const hash = createHash('sha256');
files.forEach((p) => hash.update(readFileSync(p)));
const v = hash.digest('hex').slice(0, 10);

// Imports relativos entre módulos (./x.js, ../x.js) e links de CSS/JS do próprio site recebem ?v=<versão>.
// Todos os imports do mesmo arquivo usam a mesma URL, então os módulos continuam sendo carregados uma vez só.
const stampJs = (src) =>
  src.replace(/((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+?\.js)\2/g, (_, pre, q, path) => `${pre}${q}${path}?v=${v}${q}`);
const stampHtml = (src) =>
  src.replace(/((?:href|src)=")(\/(?:assets|admin)\/(?!vendor\/)[^"?]+?\.(?:css|js))"/g, (_, pre, path) => `${pre}${path}?v=${v}"`);
for (const p of files) {
  const src = readFileSync(p, 'utf8');
  const next = extname(p) === '.js' ? stampJs(src) : extname(p) === '.html' ? stampJs(stampHtml(src)) : src;
  if (next !== src) writeFileSync(p, next);
}

// Rotas da loja virtual abrem o index.html (o roteamento é feito no navegador)
writeFileSync(
  join(out, '_redirects'),
  ['/loja/*      /index.html  200', '/pedido/*    /index.html  200', '/produto/*   /index.html  200', '/categoria/* /index.html  200', ''].join('\n')
);

// CSS/JS do site: sempre conferem com o servidor (o ETag deixa isso rápido).
// Fotos, marca e bibliotecas: guardadas no aparelho.
writeFileSync(
  join(out, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(self)',
    '',
    '/assets/css/*',
    '  Cache-Control: no-cache',
    '',
    '/assets/js/*',
    '  Cache-Control: no-cache',
    '',
    '/assets/img/*',
    '  Cache-Control: public, max-age=604800',
    '',
    '/assets/brand/*',
    '  Cache-Control: public, max-age=604800',
    '',
    '/assets/vendor/*',
    '  Cache-Control: public, max-age=2592000',
    '',
    '/admin/*',
    '  Cache-Control: no-cache',
    '  X-Robots-Tag: noindex',
    '',
  ].join('\n')
);

console.log(`Pronto: ${out} (versão ${v})`);
