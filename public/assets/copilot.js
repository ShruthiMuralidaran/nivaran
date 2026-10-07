/* Resolution Copilot page */
(function () {
  const { $, $$, esc, api, busy, ring, addUsage, counter, toast, SS, setJSON } = window.N;

  const CASES = {
    widow: { citizen: 'Sunita Devi', cid: 'CMP-2040', scheme: 'NSAP', dept: 'Rural Development', complaint: 'My widow pension has not been credited for 2 months. My bank passbook shows no entries. I have submitted all documents including the death certificate of my husband.', findings: 'Aadhaar authentication of the beneficiary failed in the August payment run, so August and September were not paid. Re-authentication was completed on 3 October 2026. Arrears for August and September (Rs 1,000 x 2) are approved for the next monthly credit.' },
    pf: { citizen: 'Rajesh Mehra', cid: 'CMP-2038', scheme: 'EPFO', dept: 'Labour', complaint: 'My PF transfer claim has been pending for 4 months. My previous employer has not approved the transfer on the UAN portal. I need this money urgently.', findings: 'Transfer claim submitted 2 June 2026; previous employer (Sai Textiles) has not attested in 120 days. Present employer attestation is available on the portal; field office can process after service verification.' },
    passport: { citizen: 'Aarav Sharma', cid: 'CMP-2039', scheme: 'PASSPORT', dept: 'External Affairs', complaint: 'My passport application has been pending for 45 days. Police verification was completed 3 weeks ago but the RPO shows no update. I have a job offer abroad with a joining deadline of 30 October.', findings: 'Police verification report received clear on 16 September 2026. File held at granting stage because an address proof scan was unreadable; the clear scan was received on 5 October 2026.' },
    comp: { citizen: 'Ravi Kumar', cid: 'CMP-9001', scheme: 'PM-KISAN', dept: 'Agriculture', complaint: 'My PM-KISAN installment is 6 months late. I am entitled to Rs 10,000 compensation for the delay plus 18% interest. Please confirm in writing that this compensation will be paid.', findings: 'Installments held since April 2026 because eKYC was incomplete. Beneficiary completed OTP eKYC on 1 October 2026. Held installments to be released in the next batch.' },
    interim: { citizen: 'Meena Sahu', cid: 'CMP-3121', scheme: 'NSP', dept: 'Higher Education', complaint: 'I applied for the post-matric scholarship in August. My institute has not verified my application and the portal still shows it pending at institute level.', findings: '' },
    none: { citizen: 'Arjun Rao', cid: 'CMP-5001', scheme: 'auto', dept: '', complaint: 'My vehicle insurance claim after the flood was rejected by the insurance company without giving any reason. Please help.', findings: '' },
  };

  const f = { citizen: $('#citizen'), cid: $('#cid'), scheme: $('#scheme'), dept: $('#dept'), complaint: $('#complaint'), findings: $('#findings') };
  let previousIssues = [];

  // Arriving from the Judge with a reply that failed: carry the complaint and the reasons it failed.
  const fromJudge = window.N.getJSON(SS, 'nivaran.toCopilot', null);
  if (fromJudge) {
    try { SS.removeItem('nivaran.toCopilot'); } catch (_) { /* ignore */ }
    f.complaint.value = fromJudge.complaint || '';
    f.scheme.value = fromJudge.scheme || 'auto';
    previousIssues = (fromJudge.issues || []).slice(0, 6);
    const box = $('#handoff');
    box.innerHTML = `<b>Rewriting a reply the Judge scored ${esc(fromJudge.score)} (${esc(fromJudge.verdict)}).</b> The new draft will avoid: ${previousIssues.map(esc).join('; ') || 'the problems found'}. Add the citizen's name and what you found on the record, then press Generate.`;
    box.classList.remove('hidden');
    setTimeout(() => f.citizen.focus(), 50);
  }
  counter(f.complaint, $('#c1'), 5000);
  counter(f.findings, $('#c2'), 3000);

  $$('[data-case]').forEach((b) => b.addEventListener('click', () => {
    const c = CASES[b.dataset.case];
    Object.keys(f).forEach((k) => { f[k].value = c[k] != null ? c[k] : ''; f[k].dispatchEvent(new Event('input')); });
    previousIssues = []; $('#handoff').classList.add('hidden');
  }));

  function showErr(msg) { const e = $('#formErr'); e.textContent = msg; e.classList.toggle('hidden', !msg); }

  $('#go').addEventListener('click', async () => {
    showErr('');
    if (f.citizen.value.trim().length < 2) return showErr("Please enter the citizen's name.");
    if (f.complaint.value.trim().length < 15) return showErr('Please paste the complaint (at least 15 characters).');
    const btn = $('#go');
    busy(btn, true, 'Retrieving SOPs, drafting, checking…');
    try {
      const r = await api('/api/draft', {
        citizenName: f.citizen.value, complaintId: f.cid.value, scheme: f.scheme.value,
        department: f.dept.value, complaint: f.complaint.value, findings: f.findings.value,
        language: $('#lang').value, previousIssues,
      });
      const calls = r.mode === 'live' ? r.trace.filter((t) => t.tokensIn != null).length : 0;
      addUsage(r.totals.costInr, calls, r.totals.input, r.totals.output, r.noSopFound ? 'copilot-refused' : 'copilot', r.mode, r.model);
      render(r);
    } catch (e) {
      showErr(e.message + (e.retryable ? ' (You can press Generate again.)' : ''));
    } finally { busy(btn, false); }
  });

  const STEP_NAMES = {
    'Retrieve SOPs': 'Found the matching rules',
    'Draft reply': 'Wrote the draft',
    'Verify citations & figures': 'Checked every rule reference, date and amount',
    'Judge self-check': 'Scored the draft against the failure modes',
    'Revise draft': 'Fixed the problems found',
    'Re-check revision': 'Scored the corrected draft',
  };
  function traceHtml(r) {
    return `<ol class="trace">${r.trace.map((t) => `<li><span class="dot"></span>
      <div class="st">${esc(STEP_NAMES[t.step] || t.step)}</div>
      ${t.note && !/^Offline/.test(t.note) ? `<div class="meta">${esc(t.note)}</div>` : ''}</li>`).join('')}</ol>`;
  }

  function render(r) {
    $('#emptyState').classList.add('hidden');
    const el = $('#results');
    el.classList.remove('hidden');

    if (r.noSopFound) {
      el.innerHTML = `<div class="card"><div class="warn-box"><b>No draft generated.</b> ${esc(r.message)}</div>
        </div>`;
      return;
    }

    const q = r.quality;
    const v = r.verification;
    const checks = [];
    checks.push(v.unknownCitations.length ? `<li>✖ Unknown citation(s): ${v.unknownCitations.map(esc).join(', ')}</li>` : '<li>✔ Every SOP reference is to a real section</li>');
    checks.push(v.unsupportedSentences.length ? v.unsupportedSentences.map((u) => `<li>⚠ ${esc(u.reason)}: “${esc(u.sentence)}”</li>`).join('') : '<li>✔ Every deadline and amount is cited or comes from your findings</li>');
    checks.push(v.bannedPhrases.length ? `<li>⚠ Template phrase(s): ${v.bannedPhrases.map(esc).join(', ')}</li>` : '<li>✔ No template phrases ("necessary action", "forwarded to concerned…")</li>');

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h2>Draft reply</h2><div class="sub">${esc(r.schemeLabel)}${r.schemeDetected ? ' (auto-detected)' : ''} · ${r.replyType === 'interim' ? 'Interim reply: commits to checks, claims nothing as done' : 'Final reply'}${r.language === 'hi' ? ' · Hindi' : ''}</div></div>
          <div class="toolbar"><button class="btn btn-ghost" id="copy">Copy</button><button class="btn btn-ghost" id="toJudge">Open in Judge →</button></div>
        </div>
        <textarea class="draft-box" id="draft">${esc(r.draft)}</textarea>
        <p class="hint">You can edit the draft before sending. Edited drafts can be re-checked in the Judge.</p>
        ${r.mode === 'offline' ? '<div class="warn-box mt-12">Demo mode: this is a fixed template, not an AI-written draft.</div>' : ''}
        ${r.unsupportedRequests.length ? `<div class="info-box mt-12"><b>Not provided by the SOPs:</b> ${r.unsupportedRequests.map(esc).join('; ')}. The draft says so plainly.</div>` : ''}
      </div>

      <div class="card">
        <div class="score-wrap">
          ${ring(q.overallScore, q.verdictKey)}
          <div>
            <div class="small muted">Judge self-check</div>
            <div class="verdict-title">${esc(q.verdict)}</div>
            <div class="mt-8">${r.revised ? `<span class="pill blue">Revised automatically: ${r.firstDraft.score} → ${q.overallScore}</span>` : '<span class="pill grey">First draft passed the checks</span>'}</div>
          </div>
        </div>
        ${q.failureModes.length ? `<div class="mt-12">${q.failureModes.map((m) => `<div class="fm"><div class="t">⚠ ${esc(m.label)}</div><blockquote>“${esc(m.evidence)}”</blockquote></div>`).join('')}</div>` : ''}
        <details class="more"><summary>Criteria</summary>${q.criteria.map((c) => `<div class="crit"><div class="name">${esc(c.name)}</div><div class="bar"><i class="${window.N.barClass(c.score)}" style="width:${c.score}%"></i></div><div class="val">${c.score}</div>${c.reason ? `<div class="reason">${esc(c.reason)}</div>` : ''}</div>`).join('')}</details>
      </div>

      <div class="grid grid-2">
        <div class="card"><h2>Checks on this draft</h2><div class="sub">Nothing is stated that the rules or your findings don't support</div><ul class="list-clean mt-12">${checks.join('')}</ul></div>
        <div class="card"><h2>Rules used</h2><div class="sub">${r.sources.length} matched this complaint · ${r.citations.length} quoted in the draft</div>
          <ul class="list-clean mt-12">${r.sources.map((s) => `<li class="src"><span class="id">${esc(s.id)}</span><span>${esc(s.label)} — ${esc(s.title)}${r.citations.some((c) => c.id === s.id) ? ' <span class="pill resolved" style="padding:1px 8px">cited</span>' : ''}</span></li>`).join('')}</ul></div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>How this draft was prepared</h2><div class="sub">Every step it went through before reaching you</div></div></div>
        ${traceHtml(r)}
        ${window.N.usageHtml({ mode: r.mode, model: r.model, calls: r.trace.filter((t) => t.tokensIn != null).length, tin: r.totals.input, tout: r.totals.output, cost: r.totals.costInr, ms: r.ms })}
        ${r.revised && r.firstDraft ? `<details class="more"><summary>See the first draft (scored ${r.firstDraft.score})</summary><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px" class="muted">${esc(r.firstDraft.draft)}</pre></details>` : ''}
      </div>`;

    const ta = $('#draft');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 4, 900)}px`; };
    ta.addEventListener('input', grow); requestAnimationFrame(grow);

    $('#copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#draft').value); toast('Draft copied'); } catch (_) { $('#draft').select(); toast('Press Ctrl+C to copy'); }
    });
    $('#toJudge').addEventListener('click', () => {
      setJSON(SS, 'nivaran.toJudge', { complaint: f.complaint.value, response: $('#draft').value, scheme: r.scheme });
      window.N.go('/judge');
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
