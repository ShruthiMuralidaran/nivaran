// Builds Nivaran.html: the whole app in ONE file that works by double-clicking (no Node, no server).
// The same backend modules run inside the browser; /api calls are answered in-page and the AI is
// called directly from the browser with the key the user enters in Settings.
//   Run: node scripts/build-standalone.js   (or npm run build:html)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------- 1. Backend modules -> in-browser module registry ----------
const MODULES = {
  'lib/config': 'api/_lib/config.js',
  'lib/llm': 'api/_lib/llm.js',
  'lib/retrieve': 'api/_lib/retrieve.js',
  'lib/prompts': 'api/_lib/prompts.js',
  'lib/scoring': 'api/_lib/scoring.js',
  'lib/offline': 'api/_lib/offline.js',
  'lib/verify': 'api/_lib/verify.js',
  'lib/today': 'api/_lib/today.js',
  'lib/judge': 'api/_lib/judge.js',
  'lib/copilot': 'api/_lib/copilot.js',
  'lib/http': 'api/_lib/http.js',
  'lib/supabase': 'api/_lib/supabase.js',
  'lib/kb': 'api/_lib/kb.js',
  'api/evaluate': 'api/evaluate.js',
  'api/draft': 'api/draft.js',
  'api/health': 'api/health.js',
  'api/sops': 'api/sops.js',
  'api/stats': 'api/stats.js',
};
function rewriteRequires(src) {
  return src
    .replace(/require\('\.\.\/\.\.\/data\/sops\.json'\)/g, "require('data/sops')")
    .replace(/require\('\.\/_lib\/([a-z]+)'\)/g, "require('lib/$1')")
    .replace(/require\('\.\/([a-z]+)'\)/g, "require('lib/$1')");
}
let modules = `__def('data/sops', function (module) { module.exports = ${JSON.stringify(JSON.parse(read('data/sops.json')))}; });\n`;
for (const [id, file] of Object.entries(MODULES)) {
  modules += `__def(${JSON.stringify(id)}, function (module, exports, require) {\n${rewriteRequires(read(file))}\n});\n`;
}

// ---------- 2. Pages -> templates + init functions ----------
const PAGES = [
  { route: '/', file: 'public/index.html', script: null, title: 'Nivaran · Grievance Resolution Quality' },
  { route: '/judge', file: 'public/judge.html', script: 'public/assets/judge.js', title: 'Resolution Judge · Nivaran' },
  { route: '/copilot', file: 'public/copilot.html', script: 'public/assets/copilot.js', title: 'Resolution Copilot · Nivaran' },
  { route: '/how', file: 'public/how.html', script: 'public/assets/how.js', title: 'How it works · Nivaran' },
  { route: '/404', file: 'public/404.html', script: null, title: 'Not found · Nivaran' },
];
let templates = '';
let pageDefs = '';
PAGES.forEach((p, i) => {
  const html = read(p.file);
  const start = html.indexOf('<section class="band">');
  const end = html.indexOf('</main>') + '</main>'.length;
  if (start < 0 || end < 7) throw new Error(`Could not find band/main in ${p.file}`);
  let body = html.slice(start, end)
    .replace(/href="\/(judge|copilot|how)?"/g, (m, r) => `href="#/${r || ''}"`);
  templates += `<template id="tpl-${i}">${body}</template>\n`;
  const init = p.script ? read(p.script) : '';
  pageDefs += `PAGES[${JSON.stringify(p.route)}] = { tpl: 'tpl-${i}', title: ${JSON.stringify(p.title)}, init: function () {\n${init}\n} };\n`;
});

// ---------- 3. Assemble ----------
const css = read('public/assets/styles.css');
const appJs = read('public/assets/app.js');

const settingsHtml = `
<div id="settings" class="hidden" style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px">
  <div class="card" style="max-width:620px;width:100%;max-height:92vh;overflow:auto;box-shadow:var(--shadow-lg)">
    <div class="card-head"><div><h2>Settings</h2><div class="sub">Connect Nivaran to its AI service (one-time setup).</div></div><button class="btn btn-ghost" id="s-close" aria-label="Close">✕</button></div>
    <div class="stack">
      <label class="field"><span>Provider</span>
        <select id="s-provider"><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="offline">Offline demo (no AI, rule-based)</option></select></label>
      <label class="field" id="s-key-wrap"><span>API key</span><input type="text" id="s-key" autocomplete="off" spellcheck="false" placeholder="Paste your key" style="-webkit-text-security:disc">
        <div class="hint" id="s-key-hint"></div></label>
      <label class="field"><span>Model <em>(optional)</em></span><input type="text" id="s-model" placeholder="default"></label>
      <label class="small" style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="s-remember" style="margin-top:3px;flex:none"><span>Remember the key on this computer (otherwise it is forgotten when you close the tab)</span></label>
      <div class="info-box small">Your key is kept only in this browser and sent only to Google or OpenAI. It is never written into this HTML file, so the file is safe to share or submit.</div>
      <div class="row"><button class="btn btn-primary" id="s-save">Save</button><button class="btn btn-ghost" id="s-test">Save &amp; test</button><button class="btn btn-ghost" id="s-clear" style="margin-left:auto">Forget key</button></div>
      <div id="s-msg" class="hidden"></div>
      <details class="more" id="s-cost"><summary>Cost log (for the team, not shown to officers)</summary>
        <div id="s-cost-body" class="small"></div>
        <div class="row mt-12"><button class="btn btn-ghost" id="s-cost-csv">Download cost log (CSV)</button><button class="btn btn-ghost" id="s-cost-reset">Reset log</button></div>
      </details>
    </div>
  </div>
</div>`;

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nivaran · Grievance Resolution Quality</title>
<meta name="description" content="Nivaran checks whether government grievance closures actually resolve the citizen's problem, and helps officers write replies that do.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(read('public/assets/favicon.svg').trim())}">
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
${settingsHtml}
${templates}
<script>
/* ===== Nivaran single-file build. Generated by scripts/build-standalone.js — edit the source files, not this. ===== */
window.__NIVARAN_STANDALONE = true;
var process = { env: { NODE_ENV: 'production', LLM_PROVIDER: 'offline' } };
var __mods = {}, __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function require(id) {
  if (__cache[id]) return __cache[id].exports;
  if (!__mods[id]) throw new Error('Module not found: ' + id);
  var module = { exports: {} }; __cache[id] = module;
  __mods[id](module, module.exports, require);
  return module.exports;
}
${modules}

/* ---- Settings: where the API key lives (browser storage only) ---- */
(function () {
  var KEY = 'nivaran.settings';
  function getStore(kind) { try { var s = window[kind]; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return null; } }
  var LS = getStore('localStorage'), SS = getStore('sessionStorage');
  function load() {
    try { var v = (SS && SS.getItem(KEY)) || (LS && LS.getItem(KEY)); return v ? JSON.parse(v) : {}; } catch (e) { return {}; }
  }
  function apply(s) {
    var provider = s.provider || 'gemini';
    var hasKey = !!(s.key && s.key.trim());
    process.env = {
      NODE_ENV: 'production',
      LLM_PROVIDER: provider === 'offline' || !hasKey ? 'offline' : provider,
      GEMINI_API_KEY: provider === 'gemini' && hasKey ? s.key.trim() : '',
      OPENAI_API_KEY: provider === 'openai' && hasKey ? s.key.trim() : '',
      LLM_MODEL: (s.model || '').trim(),
      USD_INR: s.usdInr || '',
      GEMINI_BASE_URL: s.geminiBase || '',
    };
  }
  function save(s) {
    try { LS && LS.removeItem(KEY); SS && SS.removeItem(KEY); } catch (e) {}
    var target = s.remember ? LS : SS;
    try { target && target.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    apply(s);
  }
  apply(load());
  window.__nivaranSettings = { load: load, save: save };

  function $(id) { return document.getElementById(id); }
  function hint() {
    var p = $('s-provider').value;
    $('s-key-wrap').style.display = p === 'offline' ? 'none' : '';
    $('s-key-hint').innerHTML = p === 'gemini'
      ? 'Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Use a key with billing enabled to avoid rate limits. Default model: gemini-3.5-flash-lite.'
      : p === 'openai' ? 'Get one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>. Default model: gpt-4o-mini.' : '';
  }
  function msg(kind, text) { var m = $('s-msg'); m.className = kind; m.textContent = text; }
  window.__openSettings = function () {
    var s = load();
    $('s-provider').value = s.provider || 'gemini';
    $('s-key').value = s.key || '';
    $('s-model').value = s.model || '';
    $('s-remember').checked = !!s.remember;
    $('s-msg').className = 'hidden';
    $('s-cost').open = false;
    hint();
    $('settings').classList.remove('hidden');
    setTimeout(function () { ($('s-provider').value === 'offline' ? $('s-provider') : $('s-key')).focus(); }, 30);
  };
  function close() { $('settings').classList.add('hidden'); }

  // ---- Team-only cost log: real token counts and ₹ for every AI request made from this browser ----
  function costReport() {
    var log = (window.N && window.N.getCostLog()) || [];
    var body = $('s-cost-body');
    if (!log.length) { body.innerHTML = '<p class="mt-8">No AI requests logged yet. With a key saved, run a few Judge checks and Copilot drafts (the "Try a case" buttons), then open this again.</p>'; return; }
    function avg(list, k) { return list.length ? list.reduce(function (a, x) { return a + x[k]; }, 0) / list.length : 0; }
    var J = log.filter(function (x) { return x.kind === 'judge'; });
    var C = log.filter(function (x) { return x.kind === 'copilot'; });
    var j = { n: J.length, tin: avg(J, 'tin'), tout: avg(J, 'tout'), cost: avg(J, 'cost') };
    var c = { n: C.length, tin: avg(C, 'tin'), tout: avg(C, 'tout'), cost: avg(C, 'cost'), calls: avg(C, 'calls') };
    var per = (c.n ? c.cost : 0) + (j.n ? j.cost : 0);
    var monthly = 10000 * 22, host = 20 * Number((process.env.USD_INR || 96.28));
    var total = log.reduce(function (a, x) { return a + x.cost; }, 0);
    function r(v, d) { return '₹' + v.toFixed(d == null ? 3 : d); }
    function n(v) { return Math.round(v).toLocaleString('en-IN'); }
    body.innerHTML =
      '<p class="mt-8">' + log.length + ' logged requests · model ' + (log[log.length - 1].model || '') + ' · total spent ' + r(total, 2) + '</p>' +
      '<div class="table-wrap mt-8"><table class="t"><tr><th>Per…</th><th class="num">Count</th><th class="num">Tokens in</th><th class="num">Tokens out</th><th class="num">₹ avg</th></tr>' +
      '<tr><td>Judge check</td><td class="num">' + j.n + '</td><td class="num">' + n(j.tin) + '</td><td class="num">' + n(j.tout) + '</td><td class="num">' + (j.n ? r(j.cost) : '—') + '</td></tr>' +
      '<tr><td>Copilot draft' + (c.n ? ' (' + c.calls.toFixed(1) + ' AI calls)' : '') + '</td><td class="num">' + c.n + '</td><td class="num">' + n(c.tin) + '</td><td class="num">' + n(c.tout) + '</td><td class="num">' + (c.n ? r(c.cost) : '—') + '</td></tr>' +
      '<tr style="background:#fef3c7"><td><b>One grievance</b> (draft + check)</td><td></td><td class="num">' + n((c.n ? c.tin : 0) + j.tin) + '</td><td class="num">' + n((c.n ? c.tout : 0) + j.tout) + '</td><td class="num"><b>' + r(per) + '</b></td></tr></table></div>' +
      '<p class="mt-8"><b>10,000 officers × 22 grievances/month</b> = 2.2L grievances: AI ≈ ₹' + n(per * monthly) + '/month, + Vercel Pro ₹' + n(host) + ' = <b>₹' + n(per * monthly + host) + '/month</b> (' + r((per * monthly + host) / 10000, 2) + ' per officer).</p>' +
      '<p>Judge only, all 26.45L central disposals a year: ≈ ₹' + n(j.cost * 2645000) + '.</p>' +
      (j.n < 5 || c.n < 3 ? '<p class="muted">Tip: log at least 5 Judge checks and 3 Copilot drafts for a stable average. For the deck, npm run eval is the rigorous version.</p>' : '');
  }
  function costCsv() {
    var log = (window.N && window.N.getCostLog()) || [];
    var rows = ['time,kind,ai_calls,tokens_in,tokens_out,cost_inr,model'].concat(log.map(function (x) { return [x.t, x.kind, x.calls, x.tin, x.tout, x.cost, x.model].join(','); }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join(String.fromCharCode(13, 10))], { type: 'text/csv' }));
    a.download = 'nivaran_cost_log.csv'; a.click();
  }
  function collect() { var old = load(); return { provider: $('s-provider').value, key: $('s-key').value.trim(), model: $('s-model').value.trim(), remember: $('s-remember').checked, usdInr: old.usdInr, geminiBase: old.geminiBase }; }
  function afterSave() { if (window.N) { window.N.refreshMode(); } if (window.__nivaranRender) window.__nivaranRender(); }
  document.addEventListener('DOMContentLoaded', function () {
    $('s-provider').addEventListener('change', hint);
    $('s-cost').addEventListener('toggle', function () { if ($('s-cost').open) costReport(); });
    $('s-cost-csv').addEventListener('click', costCsv);
    $('s-cost-reset').addEventListener('click', function () { if (window.N) window.N.clearCostLog(); costReport(); });
    $('s-close').addEventListener('click', close);
    $('settings').addEventListener('click', function (e) { if (e.target.id === 'settings') close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    $('s-save').addEventListener('click', function () { save(collect()); afterSave(); close(); window.N && window.N.toast('Settings saved'); });
    $('s-clear').addEventListener('click', function () { var s = collect(); s.key = ''; save(s); $('s-key').value = ''; afterSave(); msg('info-box', 'Key forgotten. Running in offline demo mode.'); });
    $('s-test').addEventListener('click', async function () {
      var s = collect();
      if (s.provider !== 'offline' && !s.key) { msg('err-box', 'Paste an API key first.'); return; }
      save(s); afterSave();
      if (s.provider === 'offline') { msg('info-box', 'Offline demo mode is on.'); return; }
      msg('info-box', 'Testing the key with one short AI call…');
      try {
        var r = await require('lib/llm').callJSON({ system: 'Reply with JSON only.', user: 'Return {"ok": true}.', maxOutputTokens: 50, maxAttempts: 2 });
        msg('ok-box', '✔ Connected. Nivaran is ready to use.');
      } catch (e) { msg('err-box', e.message || 'The test call failed.'); }
    });
  });
})();

/* ---- In-page API: answers /api/* and /samples/* without a server ---- */
(function () {
  var realFetch = window.fetch.bind(window);
  var ROUTES = { '/api/evaluate': 'api/evaluate', '/api/draft': 'api/draft', '/api/health': 'api/health', '/api/sops': 'api/sops', '/api/stats': 'api/stats' };
  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    init = init || {};
    var p = url.split('?')[0];
    if (ROUTES[p]) {
      var res = { statusCode: 200, headers: {}, body: '', setHeader: function (k, v) { this.headers[k] = v; }, end: function (b) { this.body = b; } };
      await require(ROUTES[p])({ method: (init.method || 'GET').toUpperCase(), body: init.body == null ? undefined : init.body }, res);
      return new Response(res.body, { status: res.statusCode, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };
})();
</script>
<script>
${appJs}
</script>
<script>
/* ---- Pages and router ---- */
var PAGES = {};
${pageDefs}
(function () {
  function render() {
    var route = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    var page = PAGES[route] || PAGES['/404'];
    var root = document.getElementById('root');
    root.innerHTML = document.getElementById(page.tpl).innerHTML;
    document.title = page.title;
    window.scrollTo(0, 0);
    if (window.N) window.N.markNav();
    try { page.init(); } catch (e) { console.error(e); }
  }
  window.__nivaranRender = render;
  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', render);
})();
</script>
</body>
</html>
`;

if (/<\/script>/i.test(modules + pageDefs + appJs + '')) throw new Error('A source file contains </script>; it would break the single-file build.');
// Refuse to write a broken file: every inline script must parse.
const vm = require('vm');
[...shell.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
  try { new vm.Script(m[1]); } catch (e) { throw new Error(`Inline script #${i} has a syntax error: ${e.message}`); }
});
const out = path.join(ROOT, 'Nivaran.html');
fs.writeFileSync(out, shell);
console.log(`Wrote ${out} (${Math.round(shell.length / 1024)} KB)`);
