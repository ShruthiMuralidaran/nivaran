// Resolution Copilot pipeline:
// 1 retrieve SOPs -> 2 draft (grounded) -> 3 verify citations & numbers in code -> 4 self-check with the Judge
// -> 5 revise once if the check fails -> verify + judge again.
const { retrieve, sectionsById, schemeNames } = require('./retrieve');
const { callJSON } = require('./llm');
const { copilotSystem, copilotUser, revisionUser, PROMPT_VERSION } = require('./prompts');
const { verifyDraft } = require('./verify');
const { judge } = require('./judge');
const { draftRaw } = require('./offline');
const { getProvider, getModel } = require('./config');
const { todayIST } = require('./today');
const { ensureKnowledgeBase } = require('./kb');

function addStep(trace, step, t0, extra = {}) {
  trace.push({ step, ms: Date.now() - t0, ...extra });
}

function issuesFrom(verification, quality) {
  const issues = [];
  verification.unknownCitations.forEach((c) => issues.push(`Citation "${c}" is not one of the SOP sections provided. Cite only the labels given.`));
  verification.unsupportedSentences.forEach((u) => issues.push(`"${u.sentence}": ${u.reason}. Cite the SOP section or remove the figure.`));
  verification.bannedPhrases.forEach((p) => issues.push(`Remove the phrase "${p}" and say who will do what by when.`));
  if (quality) {
    quality.failureModes.forEach((m) => issues.push(`Judge flagged ${m.label}: "${m.evidence}". Fix it.`));
    quality.criteria.filter((c) => c.score < 60).forEach((c) => issues.push(`Weak on "${c.name}" (${c.score}/100): ${c.reason}`));
  }
  return issues;
}

async function runCopilot(input) {
  const { citizenName, complaintId, scheme, department, complaint, findings, language = 'en', previousIssues = [] } = input;
  const provider = getProvider();
  const offline = provider === 'offline';
  const trace = [];
  const totals = { input: 0, output: 0, costInr: 0 };
  const started = Date.now();
  const today = todayIST();

  // 1. Retrieve
  let t0 = Date.now();
  const kbSource = await ensureKnowledgeBase();
  const r = retrieve(`${complaint}\n${findings || ''}`, scheme, { k: 3, kGeneral: 1 });
  addStep(trace, 'Retrieve SOPs', t0, { note: r.schemeSections.length ? `${r.schemeSections.map((s) => s.id).join(', ')} + GEN-1, GEN-3${r.detected ? ` · scheme auto-detected: ${schemeNames[r.scheme]}` : ''} · from ${kbSource === 'supabase' ? 'Supabase' : 'built-in file'}` : 'No scheme SOP matched' });

  if (!r.scheme || !r.schemeSections.length) {
    return {
      noSopFound: true,
      message: 'No SOP in the knowledge base covers this complaint, so Nivaran will not draft a reply. Route it for human drafting, or choose the correct scheme.',
      trace,
      totals,
      model: getModel(provider),
      mode: offline ? 'offline' : 'live',
      ms: Date.now() - started,
    };
  }

  // The Copilot always gets the ATR standard (GEN-1) and the appeal rules (GEN-3) alongside the scheme SOPs.
  const general = sectionsById(['GEN-1', 'GEN-3']);
  const sections = [...r.schemeSections, ...general];
  const schemeLabel = schemeNames[r.scheme];
  const baseUser = copilotUser({ citizenName, complaintId, schemeLabel, department, complaint, findings, sections, previousIssues });

  // 2. Draft
  t0 = Date.now();
  let draftJson;
  if (offline) {
    draftJson = draftRaw({ citizenName, complaintId, department, findings, sections: r.schemeSections, general: general[1] });
    addStep(trace, 'Draft reply', t0, { note: 'Offline template (no API key)' });
  } else {
    const out = await callJSON({ system: copilotSystem(today, language), user: baseUser, temperature: 0.2, maxOutputTokens: 900 });
    draftJson = out.json;
    totals.input += out.usage.input; totals.output += out.usage.output; totals.costInr += out.costInr || 0;
    addStep(trace, 'Draft reply', t0, { tokensIn: out.usage.input, tokensOut: out.usage.output, costInr: out.costInr });
  }
  let draft = String(draftJson.draft || '').trim();
  if (!draft) {
    const e = new Error('The AI returned an empty draft. Please try again.');
    e.code = 'BAD_OUTPUT';
    throw e;
  }

  // 3. Verify in code
  t0 = Date.now();
  let verification = verifyDraft(draft, sections, findings, complaint);
  addStep(trace, 'Verify citations & figures', t0, { note: verification.ok ? 'All figures cited or from findings' : `${verification.unknownCitations.length + verification.unsupportedSentences.length + verification.bannedPhrases.length} issue(s)` });

  // 4. Self-check with the Judge
  t0 = Date.now();
  let quality = await judge({ complaint, response: draft, scheme: r.scheme });
  totals.input += quality.usage.input; totals.output += quality.usage.output; totals.costInr += quality.costInr || 0;
  addStep(trace, 'Judge self-check', t0, { tokensIn: quality.usage.input, tokensOut: quality.usage.output, costInr: quality.costInr, note: `${quality.overallScore}/100 · ${quality.verdict}` });

  // 5. Revise once if needed
  const replyType = draftJson.reply_type === 'interim' || !findings ? 'interim' : 'final';
  const threshold = replyType === 'interim' ? 60 : 70;
  let revised = false;
  let firstDraft = null;
  if (!offline && (!verification.ok || quality.failureModes.length || quality.overallScore < threshold)) {
    const issues = issuesFrom(verification, quality);
    if (issues.length) {
      t0 = Date.now();
      const out = await callJSON({ system: copilotSystem(today, language), user: revisionUser(baseUser, draft, issues), temperature: 0.2, maxOutputTokens: 900 });
      totals.input += out.usage.input; totals.output += out.usage.output; totals.costInr += out.costInr || 0;
      const newDraft = String((out.json && out.json.draft) || '').trim();
      addStep(trace, 'Revise draft', t0, { tokensIn: out.usage.input, tokensOut: out.usage.output, costInr: out.costInr, note: `${issues.length} issue(s) sent back` });
      if (newDraft) {
        t0 = Date.now();
        const v2 = verifyDraft(newDraft, sections, findings, complaint);
        const q2 = await judge({ complaint, response: newDraft, scheme: r.scheme });
        totals.input += q2.usage.input; totals.output += q2.usage.output; totals.costInr += q2.costInr || 0;
        addStep(trace, 'Re-check revision', t0, { tokensIn: q2.usage.input, tokensOut: q2.usage.output, costInr: q2.costInr, note: `${q2.overallScore}/100 · ${q2.verdict}` });
        // Keep whichever version scores better.
        if (q2.overallScore >= quality.overallScore) {
          firstDraft = { draft, score: quality.overallScore };
          draft = newDraft; verification = v2; quality = q2; revised = true;
          if (out.json.unsupported_requests) draftJson.unsupported_requests = out.json.unsupported_requests;
        }
      }
    }
  }

  totals.costInr = Math.round(totals.costInr * 10000) / 10000;
  const byId = new Map(sections.map((s) => [s.id, s]));
  return {
    noSopFound: false,
    kbSource,
    draft,
    replyType,
    language: offline ? 'en' : language,
    scheme: r.scheme,
    schemeLabel,
    schemeDetected: r.detected,
    citations: verification.citedIds.map((id) => byId.get(id)).filter(Boolean).map(({ id, label, title }) => ({ id, label, title })),
    sources: sections.map(({ id, label, title }) => ({ id, label, title })),
    unsupportedRequests: (draftJson.unsupported_requests || []).map(String).slice(0, 4),
    verification,
    quality,
    revised,
    firstDraft,
    trace,
    totals,
    model: getModel(provider),
    mode: offline ? 'offline' : 'live',
    promptVersion: PROMPT_VERSION,
    ms: Date.now() - started,
  };
}

module.exports = { runCopilot };

