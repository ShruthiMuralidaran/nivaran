// POST /api/draft  { citizenName, complaintId?, scheme?, department?, complaint, findings?, language? }
const { handler, field } = require('./_lib/http');
const { runCopilot } = require('./_lib/copilot');
const { logRun } = require('./_lib/supabase');

module.exports = handler('POST', async (body) => {
  const r = await runCopilot({
    citizenName: field(body, 'citizenName', 'Citizen name', { min: 2, max: 80 }),
    complaintId: field(body, 'complaintId', 'Complaint ID', { required: false, max: 40 }),
    scheme: field(body, 'scheme', 'Scheme', { required: false, max: 40 }),
    department: field(body, 'department', 'Department', { required: false, max: 80 }),
    complaint: field(body, 'complaint', 'Complaint', { min: 15, max: 5000 }),
    findings: field(body, 'findings', 'Officer findings', { required: false, max: 3000 }),
    language: body.language === 'hi' ? 'hi' : 'en',
    previousIssues: Array.isArray(body.previousIssues) ? body.previousIssues.filter((x) => typeof x === 'string').slice(0, 6).map((x) => x.slice(0, 240)) : [],
  });
  // Numbers only, never the complaint, findings or draft text.
  if (r.mode === 'live' && !r.noSopFound) {
    r.logged = await logRun({
      feature: 'copilot', model: r.model, ai_calls: r.trace.filter((t) => t.tokensIn != null).length,
      tokens_in: r.totals.input, tokens_out: r.totals.output, cost_inr: r.totals.costInr,
      score: r.quality ? r.quality.overallScore : null, verdict: r.quality ? r.quality.verdictKey : null,
      scheme: r.scheme, revised: r.revised, reply_type: r.replyType, language: r.language,
      latency_ms: r.ms, kb_source: r.kbSource, prompt_version: r.promptVersion,
    });
  }
  return r;
});
