/* Shared front-end helpers for every Nivaran page. */
(function () {
  const ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    judge: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    copilot: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    how: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 11h8V3h-8z"/>',
  };
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const NAV = [
    ['/', 'Home', ICON.home],
    ['/judge', 'Judge', ICON.judge],
    ['/copilot', 'Copilot', ICON.copilot],
    ['/how', 'How it works', ICON.how],
  ];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function store(kind) {
    try { const s = window[kind]; const k = '__t'; s.setItem(k, '1'); s.removeItem(k); return s; } catch (_) { return null; }
  }
  const SS = store('sessionStorage');
  const LS = store('localStorage');
  const getJSON = (s, k, d) => { try { const v = s && s.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const setJSON = (s, k, v) => { try { s && s.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } };

  // Single-file build (Nivaran.html) uses #/routes; the server build uses real paths.
  const STANDALONE = !!window.__NIVARAN_STANDALONE;
  const link = (p) => (STANDALONE ? `#${p}` : p);

  function currentPath() {
    if (STANDALONE) return (location.hash.replace(/^#/, '') || '/').split('?')[0];
    let p = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
  }
  function go(p) { if (STANDALONE) location.hash = p; else location.href = p; }

  function markNav() {
    const here = currentPath();
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === here));
  }

  function renderChrome() {
    const top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML = `<div class="inner">
      <a class="brand" href="${link('/')}"><span class="logo">${svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>')}</span>Nivaran</a>
      <nav class="nav" aria-label="Main">${NAV.map(([href, label, icon]) => `<a href="${link(href)}" data-path="${href}">${svg(icon)}${label}</a>`).join('')}</nav>
      <div class="right">
        <span class="mode offline hidden" id="mode" title="No AI connected: answers are rule-based estimates">Demo mode</span>
        ${STANDALONE ? '<button class="gear" id="gear" title="Settings" aria-label="Settings">⚙</button>' : ''}
      </div></div>`;
    document.body.prepend(top);
    markNav();
    if (STANDALONE && window.__openSettings) { $('#gear').addEventListener('click', window.__openSettings); $('#mode').addEventListener('click', window.__openSettings); $('#mode').style.cursor = 'pointer'; }
    const foot = document.createElement('footer');
    foot.className = 'foot';
    foot.innerHTML = '<span>Nivaran · GenAI Startup Sprint</span>';
    document.body.append(foot);
  }

  // Cost log for the TEAM (never shown on officer screens): every AI request's real token counts and ₹,
  // kept in this browser so the cost per session can be read from Settings → Cost log.
  const COSTLOG = 'nivaran.costlog';
  function addUsage(costInr, calls, tokensIn, tokensOut, kind, mode, model) {
    if (mode !== 'live') return; // demo-mode runs cost nothing and would distort averages
    const log = getJSON(LS, COSTLOG, []);
    log.push({ t: new Date().toISOString(), kind, calls, tin: tokensIn || 0, tout: tokensOut || 0, cost: Number(costInr) || 0, model });
    setJSON(LS, COSTLOG, log.slice(-1000));
  }
  function getCostLog() { return getJSON(LS, COSTLOG, []); }
  // Totals across this browser's live AI requests (used by the How it works cost calculator).
  function getUsage() {
    return getCostLog().reduce((a, x) => ({ calls: a.calls + (x.calls || 0), tin: a.tin + (x.tin || 0), tout: a.tout + (x.tout || 0), cost: a.cost + (x.cost || 0) }), { calls: 0, tin: 0, tout: 0, cost: 0 });
  }
  function clearCostLog() { try { LS && LS.removeItem(COSTLOG); } catch (_) { /* ignore */ } }
  function inr(v, d = 3) { return v == null ? '—' : `₹${Number(v).toFixed(d)}`; }

  // ---- Health / mode ----
  let healthPromise = null;
  function health() {
    if (!healthPromise) {
      healthPromise = fetch('/api/health').then((r) => r.json()).catch(() => null);
    }
    return healthPromise;
  }
  async function showMode() {
    const h = await health();
    const el = $('#mode');
    if (!el) return;
    // Only show something when the AI is NOT connected; a working app needs no status badge.
    el.classList.toggle('hidden', !!(h && h.mode === 'live'));
    if (!h) el.textContent = 'Server unreachable';
    else if (STANDALONE) el.title = 'Demo mode: no AI connected. Click to open Settings.';
  }

  // ---- API helper with friendly errors ----
  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) {
      const e = new Error('Could not reach the Nivaran server. Check your connection.'); e.retryable = true; throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) {
      const e = new Error((data && data.error) || `Request failed (${res.status}).`);
      e.status = res.status; e.retryable = !!(data && data.retryable) || res.status === 429; e.code = data && data.code;
      throw e;
    }
    return data;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label || 'Working…')}`; }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function ring(score, verdictKey) {
    const r = 46; const c = 2 * Math.PI * r; const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
    const col = verdictKey === 'resolved' ? '#22c55e' : verdictKey === 'review' ? '#f59e0b' : '#ef4444';
    return `<svg class="ring" viewBox="0 0 112 112" role="img" aria-label="Score ${score} out of 100">
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="#eef2f7" stroke-width="10"/>
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 56 56)"/>
      <text x="56" y="58" text-anchor="middle" class="num">${score}</text>
      <text x="56" y="76" text-anchor="middle" class="den">/ 100</text></svg>`;
  }
  const barClass = (v) => (v >= 70 ? 'g' : v >= 40 ? 'a' : 'r');

  // Collapsed "AI usage" line under a result: real tokens, cost and calls for THIS request.
  function usageHtml({ mode, model, calls, tin, tout, cost, ms }) {
    if (mode !== 'live') return '';
    const n = (v) => Number(v || 0).toLocaleString('en-IN');
    return `<details class="usage"><summary>AI usage for this request</summary>
      <div class="statline" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat"><div class="k">AI calls</div><div class="v">${n(calls)}</div></div>
        <div class="stat"><div class="k">Tokens in / out</div><div class="v">${n(tin)} / ${n(tout)}</div></div>
        <div class="stat"><div class="k">Cost</div><div class="v">${cost == null ? 'n/a' : '₹' + Number(cost).toFixed(3)}</div></div>
        <div class="stat"><div class="k">Time</div><div class="v">${ms ? (ms / 1000).toFixed(1) + ' s' : '–'}</div></div>
      </div>
      <p class="hint mt-8">Model: ${esc(model)} · list prices from the server config. See How it works for cost at 10,000 officers.</p></details>`;
  }

  function counter(textarea, out, max) {
    const f = () => { out.textContent = `${textarea.value.length} / ${max}`; };
    textarea.addEventListener('input', f); f();
  }

  function refreshMode() { healthPromise = null; showMode(); }

  window.N = { esc, $, $$, api, health, busy, toast, ring, barClass, usageHtml, inr, addUsage, getCostLog, getUsage, clearCostLog, counter, SS, LS, getJSON, setJSON, go, link, markNav, refreshMode, STANDALONE };
  document.addEventListener('DOMContentLoaded', () => { renderChrome(); showMode(); });
})();
