/* How it works: model info, cost calculator, knowledge base */
(function () {
  const { $, esc, health, getUsage } = window.N;
  const HOSTING_USD = 20;

  (async function init() {
    const h = await health();
    if (!h) { $('#modelBox').innerHTML = '<div class="err-box">Could not reach the API.</div>'; return; }
    $('#rule').textContent = h.scoringRule;
    $('#modelBox').innerHTML = h.mode === 'live'
      ? `<div class="statline" style="grid-template-columns:1fr 1fr"><div class="stat"><div class="k">Running now</div><div class="v" style="font-size:14px">${esc(h.model)}</div></div>
         <div class="stat"><div class="k">List price per 1M tokens</div><div class="v" style="font-size:14px">${h.price ? `$${h.price.input} in · $${h.price.output} out` : 'not in price table'}</div></div></div>`
      : '<div class="warn-box">Offline demo mode: no API key configured, so a rule-based stand-in runs. Add GEMINI_API_KEY or OPENAI_API_KEY to enable the AI.</div>';
    $('#fx').textContent = `₹${h.usdInr} per $ (${h.pricesAsOf})`;
    const kbSrc = h.knowledgeBase && h.knowledgeBase.source === 'supabase' ? 'Supabase (table sop_sections)' : 'built-in file data/sops.json';
    $('#modelBox').insertAdjacentHTML('beforeend', `<p class="hint mt-8">SOP knowledge base: <b>${esc(kbSrc)}</b> · Usage log: <b>${h.supabase && h.supabase.configured ? 'Supabase (table ai_runs)' : 'off'}</b></p>`);

    const sel = $('#cm');
    sel.innerHTML = Object.entries(h.pricing).map(([m, p]) => `<option value="${esc(m)}">${esc(m)} ($${p.input} / $${p.output})</option>`).join('');
    if (h.pricing[h.model]) sel.value = h.model;

    const u = getUsage();
    if (u.calls > 0 && u.tin > 0) {
      // Average per AI call measured in this browser; a Judge-only session is 1 call, a Copilot draft is 2-4.
      $('#tokNote').textContent = `This browser has made ${u.calls} AI calls averaging ${Math.round(u.tin / u.calls)} input / ${Math.round(u.tout / u.calls)} output tokens per call. Defaults above are one draft + one check measured on the earlier build (7 Oct 2026); replace them with the figures from npm run eval.`;
    } else {
      $('#tokNote').textContent = 'Defaults: one draft + one check measured on the earlier build (7 Oct 2026). Replace with figures from npm run eval, or use the Judge/Copilot and watch the token counts.';
    }

    function calc() {
      const p = h.pricing[sel.value];
      const num = (id) => Math.max(0, Number(String($(id).value).replace(/,/g, '')) || 0);
      const perSession = ((num('#ti') * p.input + num('#to') * p.output) / 1e6) * h.usdInr;
      const sessions = num('#co') * num('#cg') * num('#cs');
      const ai = perSession * sessions;
      const host = HOSTING_USD * h.usdInr;
      $('#r1').textContent = `₹${perSession.toFixed(3)}`;
      $('#r2').textContent = `₹${Math.round(ai).toLocaleString('en-IN')}`;
      $('#r3').textContent = `₹${Math.round(ai + host).toLocaleString('en-IN')}`;
    }
    ['#cm', '#co', '#cg', '#cs', '#ti', '#to'].forEach((id) => $(id).addEventListener('input', calc));
    calc();
  })();

  // Usage measured from logged runs (Supabase).
  fetch('/api/stats').then((r) => r.json()).then((s) => {
    const box = $('#stats');
    if (!s || !s.enabled) {
      box.innerHTML = '<div class="info-box">Supabase is not connected, so runs are not being logged. Add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_KEY</code> to enable the usage log. Each result still shows its own cost under "AI usage for this request".</div>';
      return;
    }
    if (s.error) { box.innerHTML = `<div class="warn-box">${esc(s.error)}</div>`; return; }
    const by = {}; (s.rows || []).forEach((r) => { by[r.feature] = r; });
    if (!by.judge && !by.copilot) {
      box.innerHTML = '<div class="info-box">Connected to Supabase. No live runs logged yet: use the Judge or Copilot and the numbers will appear here.</div>';
      return;
    }
    const num = (v, d = 0) => (v == null ? '–' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
    const card = (title, r, extra) => (r ? `<div class="card" style="margin:0;box-shadow:none">
        <h3>${title}</h3><div class="sub">${num(r.runs)} logged runs · last ${new Date(r.last_run).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div class="statline mt-12" style="grid-template-columns:repeat(3,1fr)">
          <div class="stat"><div class="k">Avg cost</div><div class="v">₹${num(r.avg_cost_inr, 3)}</div></div>
          <div class="stat"><div class="k">Avg tokens in / out</div><div class="v">${num(r.avg_tokens_in)} / ${num(r.avg_tokens_out)}</div></div>
          <div class="stat"><div class="k">Avg time</div><div class="v">${num(r.avg_latency_ms / 1000, 1)} s</div></div>
          <div class="stat"><div class="k">AI calls per run</div><div class="v">${num(r.avg_ai_calls, 1)}</div></div>
          ${extra(r)}
        </div></div>` : `<div class="card" style="margin:0;box-shadow:none"><h3>${title}</h3><div class="sub">No runs logged yet</div></div>`);
    box.innerHTML = `<div class="grid grid-2">
      ${card('Resolution Judge', by.judge, (r) => `<div class="stat"><div class="k">Hollow closures</div><div class="v">${num(r.pct_hollow, 0)}%</div></div><div class="stat"><div class="k">Resolved</div><div class="v">${num(r.pct_resolved, 0)}%</div></div>`)}
      ${card('Resolution Copilot', by.copilot, (r) => `<div class="stat"><div class="k">Auto-revised</div><div class="v">${num(r.pct_revised, 0)}%</div></div><div class="stat"><div class="k">Avg final score</div><div class="v">${num(r.avg_score)}</div></div>`)}
    </div>`;
    const j = by.judge; const c = by.copilot;
    if (j && c) {
      const session = Number(j.avg_cost_inr) + Number(c.avg_cost_inr);
      $('#statsSub').textContent = `Measured session (1 Copilot draft + 1 Judge check): ₹${session.toFixed(3)} · ${num(Number(j.runs) + Number(c.runs))} runs logged in Supabase`;
      // Feed the measured tokens into the cost calculator.
      $('#ti').value = Math.round(Number(j.avg_tokens_in) + Number(c.avg_tokens_in));
      $('#to').value = Math.round(Number(j.avg_tokens_out) + Number(c.avg_tokens_out));
      $('#ti').dispatchEvent(new Event('input'));
      $('#tokNote').textContent = 'Token defaults now come from the runs logged in Supabase (1 Copilot draft + 1 Judge check per grievance).';
    }
  }).catch(() => { $('#stats').innerHTML = '<div class="warn-box">Could not load usage stats.</div>'; });

  fetch('/api/sops').then((r) => r.json()).then((kb) => {
    $('#kbNotice').textContent = kb.notice;
    $('#kbSub').textContent = `${kb.sections.length} sections across ${Object.keys(kb.schemes).length} areas · loaded from ${kb.source === 'supabase' ? 'Supabase' : 'the built-in file (data/sops.json)'}`;
    const by = {};
    kb.sections.forEach((s) => { (by[s.schemeLabel] = by[s.schemeLabel] || []).push(s); });
    $('#kb').innerHTML = Object.entries(by).map(([name, list]) => `<details class="more"><summary>${esc(name)} (${list.length})</summary>
      ${list.map((s) => `<div class="kb-item"><span class="src"><span class="id">${esc(s.id)}</span><b>${esc(s.label)} — ${esc(s.title)}</b></span><p>${esc(s.text)}</p></div>`).join('')}</details>`).join('');
  }).catch(() => { $('#kb').innerHTML = '<div class="err-box">Could not load the knowledge base.</div>'; });
})();
