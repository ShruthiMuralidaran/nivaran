/* Resolution Judge page */
(function () {
  const { $, $$, esc, api, busy, ring, barClass, addUsage, counter, SS, getJSON } = window.N;

  const PMK = "I have not received my PM-KISAN installment even though my application was approved three months ago. The portal only shows 'under process'.";
  const CASES = {
    good: { scheme: 'PM-KISAN', complaint: PMK, response: "Dear Mr. Ramesh Kumar,\n\nWe checked your PM-KISAN record (Registration PMK-2025-448291). Your 4th installment failed NPCI verification on 14-06-2025 with code R03 (bank account name does not match Aadhaar), per PM-KISAN SOP §4.2.\n\n1. Please correct the account name at your bank branch to match your Aadhaar exactly.\n2. Once corrected, the District Agriculture Officer will re-submit verification; the installment is re-sent in the next weekly NPCI batch.\n\nIf you do not receive it within 10 working days of correcting the name, reply to this ticket and the case will be reviewed by the State Nodal Officer. You may also appeal within 30 days of this closure.\n\nRegards,\nGrievance Cell, Department of Agriculture" },
    boiler: { scheme: 'PM-KISAN', complaint: PMK, response: "Dear Applicant,\n\nYour complaint has been received and forwarded to the concerned department for necessary action. You are requested to wait for the resolution. For further queries, please contact the helpline.\n\nRegards,\nGrievance Cell" },
    padded: { scheme: 'PM-KISAN', complaint: PMK, response: "Dear Sir, As per PM-KISAN SOP Section 3.1, your case (Ref PMK-2025-1123) has been examined in detail on 12-07-2025. The matter has been taken up with the State Nodal Officer and appropriate action as per guidelines is being ensured on priority. Your installment will be processed in due course. Next steps: 1. Keep checking the portal status. 2. Ensure your eKYC is complete. Regards, Grievance Cell" },
    proof: { scheme: 'PM-KISAN', complaint: PMK, response: "Dear Applicant, the pending installment of Rs 2,000 was credited to your Aadhaar-linked account on 05-10-2025 (UTR 552190883412). Please check your passbook. If it does not appear within 3 working days, reply to this ticket and we will trace the payment with your bank." },
    bias: { scheme: 'LPG', complaint: "The LPG distributor shows my refill cylinder as delivered on 3 September, but I never received it. Nobody came to my house and I did not get any OTP.", response: "As per the distributor's records, the cylinder was delivered on 03-09-2025. Hence the complaint is closed." },
    visit: { scheme: 'EPFO', complaint: "My husband passed away 6 months ago. I submitted all documents for EPS widow pension but the regional office says the file is still under process with no timeline.", response: "Dear Madam, please visit the regional office in person with all original documents for verification of your claim. Regards, EPFO." },
  };

  const GUIDE = [
    { name: 'Status restatement', what: 'Repeats the portal status the citizen is already complaining about, without finding out why.', eg: '“As per records, your application is under process.”' },
    { name: '“Advised suitably” boilerplate', what: 'Template wording with no facts about this case. It could be sent to anyone.', eg: '“Necessary action has been taken. The applicant has been advised suitably.”' },
    { name: '“Forwarded to” deflection', what: 'Passed to another office or officer with no name, owner or timeline, and closed.', eg: '“Your complaint has been forwarded to the concerned department.”' },
    { name: 'Institutional bias in evidence', what: 'Closed on the word of the party being complained about.', eg: '“As per the distributor’s records, the cylinder was delivered.”' },
    { name: 'Burden transfer', what: 'Sends the citizen to an office, a helpline or to re-apply instead of moving the case forward.', eg: '“Please visit the office in person with all original documents.”' },
    { name: 'Answers a different issue', what: 'The reply is about another scheme, request or person.', eg: 'A passport dispatch update sent in reply to a PM-KISAN complaint.' },
  ];
  const guide = $('#modeGuide');
  if (guide) guide.innerHTML = GUIDE.map((m) => `<div class="fm"><div class="t">⚠ ${esc(m.name)}</div><div class="small mt-8">${esc(m.what)}</div><blockquote>${esc(m.eg)}</blockquote></div>`).join('');

  const complaint = $('#complaint');
  const response = $('#response');
  const scheme = $('#scheme');
  counter(complaint, $('#c1'), 5000);
  counter(response, $('#c2'), 5000);

  $$('[data-case]').forEach((b) => b.addEventListener('click', () => {
    const c = CASES[b.dataset.case];
    complaint.value = c.complaint; response.value = c.response; scheme.value = c.scheme;
    complaint.dispatchEvent(new Event('input')); response.dispatchEvent(new Event('input'));
  }));

  // Arrive from the Copilot with its draft pre-filled.
  const handoff = getJSON(SS, 'nivaran.toJudge', null);
  if (handoff) {
    complaint.value = handoff.complaint || ''; response.value = handoff.response || ''; scheme.value = handoff.scheme || 'auto';
    complaint.dispatchEvent(new Event('input')); response.dispatchEvent(new Event('input'));
    try { SS.removeItem('nivaran.toJudge'); } catch (_) { /* ignore */ }
  }

  function showErr(msg) { const e = $('#formErr'); e.textContent = msg; e.classList.toggle('hidden', !msg); }

  $('#go').addEventListener('click', async () => {
    showErr('');
    if (complaint.value.trim().length < 15) return showErr('Please paste the citizen complaint (at least 15 characters).');
    if (response.value.trim().length < 10) return showErr("Please paste the officer's reply (at least 10 characters).");
    const btn = $('#go');
    busy(btn, true, 'Evaluating…');
    try {
      const r = await api('/api/evaluate', { complaint: complaint.value, response: response.value, scheme: scheme.value });
      addUsage(r.costInr, r.mode === 'live' ? r.attempts || 1 : 0, r.usage.input, r.usage.output, 'judge', r.mode, r.model);
      render(r);
    } catch (e) {
      showErr(e.message + (e.retryable ? ' (You can press Evaluate again.)' : ''));
    } finally { busy(btn, false); }
  });

  function render(r) {
    $('#emptyState').classList.add('hidden');
    const el = $('#results');
    el.classList.remove('hidden');
    const capNote = r.capApplied != null ? `<div class="cap-note">Average of criteria was ${r.uncappedScore}; capped at ${r.capApplied} because of the failure modes found.</div>` : '';
    const offline = r.mode === 'offline' ? '<div class="warn-box mt-12">Demo mode: this is a rule-based estimate, not the AI Judge.</div>' : '';
    el.innerHTML = `
      <div class="card">
        <div class="score-wrap">
          ${ring(r.overallScore, r.verdictKey)}
          <div>
            <div class="small muted">Verdict</div>
            <div class="verdict-title">${esc(r.verdict)}</div>
            <div class="mt-8"><span class="pill ${r.verdictKey}">${r.verdictKey === 'resolved' ? '✔ Resolved' : r.verdictKey === 'review' ? '● Needs review' : '✖ Hollow closure'}</span>
              ${r.schemeLabel ? `<span class="pill blue">${esc(r.schemeLabel)}${r.schemeDetected ? ' · auto-detected' : ''}</span>` : ''}</div>
            ${capNote}
          </div>
        </div>
        ${r.explanation ? `<p class="mt-16">${esc(r.explanation)}</p>` : ''}
        ${offline}
        ${window.N.usageHtml({ mode: r.mode, model: r.model, calls: 1, tin: r.usage.input, tout: r.usage.output, cost: r.costInr, ms: r.ms })}
        ${r.verdictKey !== 'resolved' ? '<div class="row mt-16"><button class="btn btn-primary" id="rewrite">Rewrite this reply with the Copilot →</button><span class="small muted">Carries over the complaint and the problems found</span></div>' : ''}
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Five criteria</h2><div class="sub">Each question is scored separately; the verdict follows fixed rules.</div></div></div>
        <div>${r.criteria.map((c) => `
          <div class="crit"><div class="name">${esc(c.name)}</div><div class="bar"><i class="${barClass(c.score)}" style="width:${c.score}%"></i></div><div class="val">${c.score}</div>
          ${c.reason ? `<div class="reason">${esc(c.reason)}</div>` : ''}</div>`).join('')}</div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Failure modes found</h2><div class="sub">Each one must quote the reply. Quotes not found in the reply are discarded.</div></div></div>
        ${r.failureModes.length ? r.failureModes.map((m) => `
          <div class="fm"><div class="t">⚠ ${esc(m.label)}</div><div class="h">${esc(m.help)}</div><blockquote>“${esc(m.evidence)}”</blockquote></div>`).join('')
          : '<div class="ok-box">✔ None of the documented failure modes found in this reply.</div>'}
        ${r.discardedModes && r.discardedModes.length ? `<p class="hint mt-8">${r.discardedModes.length} suggested failure mode(s) discarded because the quoted evidence was not in the reply.</p>` : ''}
      </div>

      ${r.claimsToVerify && r.claimsToVerify.length ? `<div class="card"><h2>Facts a supervisor should verify</h2><div class="sub">The Judge cannot check records; these are the claims the closure rests on.</div>
        <ul class="list-clean mt-12">${r.claimsToVerify.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}

      <div class="card">
        <h2>Rules this was checked against</h2>
        <ul class="list-clean mt-12">${r.sources.map((s) => `<li class="src"><span class="id">${esc(s.id)}</span><span>${esc(s.label)} — ${esc(s.title)}</span></li>`).join('')}</ul>
        <details class="more"><summary>How the score is worked out</summary><p class="small">${esc(r.scoringRule)}</p></details>
      </div>`;
    const rw = $('#rewrite');
    if (rw) rw.addEventListener('click', () => {
      const issues = [
        ...r.failureModes.map((m) => `${m.label} (“${m.evidence}”)`),
        ...r.criteria.filter((c) => c.score < 60).map((c) => `Weak on “${c.name}”: ${c.reason}`),
      ];
      window.N.setJSON(SS, 'nivaran.toCopilot', { complaint: complaint.value, scheme: r.scheme || scheme.value, issues, score: r.overallScore, verdict: r.verdict });
      window.N.go('/copilot');
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
