// Gera a pasta dist/ para publicar no Cloudflare Pages (site estático, sem servidor).
// Copia só o que é público e cria as regras de rota e cabeçalhos do Pages.
//   node scripts/build-cloudflare.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of ['index.html', 'robots.txt', 'assets', 'admin']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}

// Rotas da loja virtual abrem o index.html (o roteamento é feito no navegador)
writeFileSync(
  join(out, '_redirects'),
  ['/loja/*      /index.html  200', '/pedido/*    /index.html  200', '/produto/*   /index.html  200', '/categoria/* /index.html  200', ''].join('\n')
);

writeFileSync(
  join(out, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(self)',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=86400',
    '',
    '/admin/*',
    '  X-Robots-Tag: noindex',
    '',
  ].join('\n')
);

console.log(`Pronto: ${out}`);
