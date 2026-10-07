// POST /api/evaluate  { complaint, response, scheme? }
const { handler, field } = require('./_lib/http');
const { judge } = require('./_lib/judge');
const { logRun } = require('./_lib/supabase');

module.exports = handler('POST', async (body) => {
  const complaint = field(body, 'complaint', 'Complaint', { min: 15, max: 5000 });
  const response = field(body, 'response', 'Officer reply', { min: 10, max: 5000 });
  const scheme = field(body, 'scheme', 'Scheme', { required: false, max: 40 });
  const r = await judge({ complaint, response, scheme });
  // Numbers only, never the complaint or reply text.
  if (r.mode === 'live') {
    r.logged = await logRun({
      feature: 'judge', model: r.model, ai_calls: 1, tokens_in: r.usage.input, tokens_out: r.usage.output,
      cost_inr: r.costInr, score: r.overallScore, verdict: r.verdictKey, scheme: r.scheme,
      failure_modes: r.failureModes.map((m) => m.code), latency_ms: r.ms, kb_source: r.kbSource, prompt_version: r.promptVersion,
    });
  }
  return r;
});
