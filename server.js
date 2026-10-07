// Local server: serves /public and the /api routes with zero dependencies.
// Run:  node server.js   (or npm start)   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
require('./scripts/env').loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROUTES = {
  '/api/evaluate': require('./api/evaluate'),
  '/api/draft': require('./api/draft'),
  '/api/health': require('./api/health'),
  '/api/sops': require('./api/sops'),
  '/api/stats': require('./api/stats'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = ROUTES[url.pathname.replace(/\/$/, '')];
  if (route) return route(req, res);

  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
  if (!fs.existsSync(file)) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); return fs.createReadStream(path.join(PUBLIC, '404.html')).pipe(res); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  const { publicConfig } = require('./api/_lib/config');
  const c = publicConfig();
  console.log(`\n  Nivaran running at http://localhost:${PORT}`);
  console.log(`  Mode: ${c.mode === 'live' ? `LIVE AI (${c.provider} · ${c.model})` : 'OFFLINE (no API key found in .env, rule-based demo)'}`);
  console.log(`  Supabase: ${require('./api/_lib/supabase').enabled() ? 'configured (SOPs + run log)' : 'not configured (using data/sops.json, no run log)'}\n`);
});
