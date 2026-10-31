// Servidor estático sem dependências (deploy na SquareCloud ou teste local).
//   /                vitrine (index.html)
//   /loja/<slug>     vitrine já na loja escolhida
//   /pedido/<token>  acompanhamento do pedido
//   /admin/          painel administrativo
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 80;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = /\.(html|css|js|mjs|json|svg|txt|xml)$/;

// Só o que pertence ao site é servido.
const PUBLIC = new Set(['index.html', 'assets', 'admin', 'robots.txt']);
// Rotas da vitrine que abrem o index.html
const SPA_ROUTES = /^\/(loja|pedido|produto|categoria)(\/|$)/;

function send(req, res, file, stat) {
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  const enc = String(req.headers['accept-encoding'] || '');
  const compress = COMPRESSIBLE.test(file) && stat.size > 1024;
  if (compress && /\bbr\b/.test(enc)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'br', Vary: 'Accept-Encoding' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(zlib.createBrotliCompress()).pipe(res);
  } else if (compress && /\bgzip\b/.test(enc)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/admin') {
    res.writeHead(301, { Location: '/admin/' }).end();
    return;
  }
  if (pathname === '/' || SPA_ROUTES.test(pathname)) pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.has(top)) return notFound(res);

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    send(req, res, file, stat);
  });
});

server.listen(PORT, HOST, () => console.log(`Atual Móveis no ar em http://${HOST}:${PORT}`));
