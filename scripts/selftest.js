// Offline self-test: checks parsing, retries, scoring rules, grounding checks and the API layer
// with a fake AI provider. No API key or network needed.   Run: npm test
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
delete process.env.OPENAI_API_KEY;
delete process.env.LLM_PROVIDER;

let queue = [];
let calls = [];
global.fetch = async (url, init) => {
  calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null, headers: (init && init.headers) || {} });
  const next = queue.shift();
  if (!next) throw new Error('fetch called more times than expected');
  const status = next.status || 200;
  const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body };
};
const gem = (obj, usage = { promptTokenCount: 900, candidatesTokenCount: 120, thoughtsTokenCount: 30 }, wrap = (s) => s) => ({
  body: { candidates: [{ content: { parts: [{ text: wrap(typeof obj === 'string' ? obj : JSON.stringify(obj)) }] }, finishReason: 'STOP' }], usageMetadata: usage },
});
const judgeJSON = (scores, modes = [], extra = {}) => ({
  criteria: Object.fromEntries(['addresses_complaint', 'specific_action', 'policy_grounded', 'avoids_boilerplate', 'next_steps'].map((k, i) => [k, { score: scores[i], reason: 'r' }])),
  failure_modes: modes, proof_of_resolution: false, claims_to_verify: [], explanation: 'e', ...extra,
});

const { judge } = require('../api/_lib/judge');
const { runCopilot } = require('../api/_lib/copilot');
const { verifyDraft } = require('../api/_lib/verify');
const { retrieve } = require('../api/_lib/retrieve');
const evaluateRoute = require('../api/evaluate');

const C = "I have not received my PM-KISAN installment even though my application was approved three months ago. The portal only shows 'under process'.";
const BOILER = 'Dear Applicant, your complaint has been forwarded to the concerned department for necessary action. Please contact the helpline.';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Gemini JSON in code fences is parsed; thinking tokens billed as output', async () => {
  queue = [gem(judgeJSON([90, 85, 80, 90, 85]), undefined, (s) => '```json\n' + s + '\n```')];
  const r = await judge({ complaint: C, response: 'Paid on 05-10-2026, UTR 123456.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.overallScore, 86);
  assert.strictEqual(r.verdictKey, 'resolved');
  assert.strictEqual(r.usage.input, 900);
  assert.strictEqual(r.usage.output, 150);
  assert.ok(r.costInr > 0);
  const sys = calls[calls.length - 1].body.systemInstruction.parts[0].text;
  assert.ok(/Today's date is \d{1,2} \w+ 20\d\d/.test(sys), 'today\'s date is in the prompt');
});

test('Scores returned on a 0-1 scale are corrected to 0-100', async () => {
  queue = [gem(judgeJSON([0.9, 0.8, 0.9, 0.9, 0.8]))];
  const r = await judge({ complaint: C, response: 'Paid on 05-10-2026, UTR 123456.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.overallScore, 86);
  assert.strictEqual(r.scaleCorrected, 100);
});

test('Failure modes need real quotes; two modes cap the score at 39', async () => {
  queue = [gem(judgeJSON([70, 70, 70, 70, 70], [
    { code: 'DEFLECTION', evidence: 'forwarded to the concerned department' },
    { code: 'BOILERPLATE', evidence: 'necessary action' },
    { code: 'BURDEN_TRANSFER', evidence: 'please visit the office in person' }, // not in reply -> discarded
    { code: 'MADE_UP', evidence: 'x' },
  ]))];
  const r = await judge({ complaint: C, response: BOILER, scheme: 'PM-KISAN' });
  assert.deepStrictEqual(r.failureModes.map((m) => m.code).sort(), ['BOILERPLATE', 'DEFLECTION']);
  assert.strictEqual(r.discardedModes.length, 1);
  assert.strictEqual(r.overallScore, 39);
  assert.strictEqual(r.capApplied, 39);
  assert.strictEqual(r.verdictKey, 'hollow');
});

test('Proof of resolution lifts policy score; no SOP citation required', async () => {
  queue = [gem(judgeJSON([90, 90, 40, 90, 80], [], { proof_of_resolution: true }))];
  const r = await judge({ complaint: C, response: 'Rs 2,000 credited on 05-10-2026, UTR 552190883412.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.criteria.find((c) => c.key === 'policy_grounded').score, 70);
  assert.strictEqual(r.verdictKey, 'resolved');
});

test('Rate limit (429) is retried, then succeeds', async () => {
  queue = [{ status: 429, body: '{"error":{"message":"quota","details":[{"retryDelay":"1s"}]}}' }, gem(judgeJSON([50, 50, 50, 50, 50]))];
  const r = await judge({ complaint: C, response: 'Your case is being looked at by the district office.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.attempts, 2);
  assert.strictEqual(r.verdictKey, 'review');
});

test('Invalid JSON from the model is repaired with one more call', async () => {
  queue = [gem('Sure! Here is my analysis without JSON.'), gem(judgeJSON([20, 20, 20, 20, 20]))];
  const r = await judge({ complaint: C, response: BOILER, scheme: 'PM-KISAN' });
  assert.strictEqual(r.overallScore, 20);
  assert.ok(/not valid JSON/.test(calls[calls.length - 1].body.contents[0].parts[0].text));
});

function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b; };
  return r;
}

test('API hides provider errors: bad key -> friendly 503, no raw message', async () => {
  queue = [{ status: 401, body: '{"error":{"message":"API key not valid. secret-detail"}}' }];
  const res = fakeRes();
  await evaluateRoute({ method: 'POST', body: { complaint: C, response: BOILER, scheme: 'PM-KISAN' } }, res);
  assert.strictEqual(res.statusCode, 503);
  assert.ok(!res.body.includes('secret-detail'));
  assert.ok(JSON.parse(res.body).error.includes('API key'));
});

test('API validation: bad JSON, wrong types, short text, wrong method', async () => {
  let res = fakeRes(); await evaluateRoute({ method: 'POST', body: '{not json' }, res); assert.strictEqual(res.statusCode, 400);
  res = fakeRes(); await evaluateRoute({ method: 'POST', body: { complaint: 12345, response: 678 } }, res); assert.strictEqual(res.statusCode, 400);
  res = fakeRes(); await evaluateRoute({ method: 'POST', body: { complaint: 'short', response: 'x' } }, res); assert.strictEqual(res.statusCode, 400);
  res = fakeRes(); await evaluateRoute({ method: 'GET' }, res); assert.strictEqual(res.statusCode, 405);
});

test('Grounding check: invented citation, uncited deadline and template phrase are caught', () => {
  const r = retrieve('widow pension not credited', 'NSAP');
  const sections = r.schemeSections;
  const v = verifyDraft('Dear Sunita Devi, your pension will be credited within 3 days (NSAP pensions SOP §9.9). Necessary action is being taken.', sections, '', '');
  assert.strictEqual(v.unknownCitations.length, 1);
  assert.ok(v.bannedPhrases.length >= 1);
  const v2 = verifyDraft('Pensions are credited on or before the 7th of each month (NSAP pensions SOP §3.1). Your arrears will be paid in November.', sections, '', '');
  assert.strictEqual(v2.ok, true, JSON.stringify(v2));
  const v3 = verifyDraft('You will receive Rs 5,000 within 2 days.', sections, '', '');
  assert.strictEqual(v3.unsupportedSentences.length, 1);
});

test('Copilot: failed checks trigger one revision; the better draft is kept', async () => {
  const bad = { reply_type: 'final', draft: 'Dear Sunita Devi, your case has been forwarded to the concerned department for necessary action and will be paid within 3 days (NSAP pensions SOP §9.9).', cited_sections: [], unsupported_requests: [] };
  const good = { reply_type: 'final', draft: 'Dear Sunita Devi, Aadhaar authentication failed in August and was redone on 3 October. Your missed months will be paid as arrears with the next monthly credit (NSAP pensions SOP §4.1), which is due on or before the 7th (NSAP pensions SOP §3.1). If it does not arrive, you may appeal within 30 days of closure (Grievance SOP §3). Regards, Grievance Cell', cited_sections: ['NSAP-4.1'], unsupported_requests: [] };
  queue = [gem(bad), gem(judgeJSON([30, 20, 20, 10, 20], [{ code: 'DEFLECTION', evidence: 'forwarded to the concerned department' }])), gem(good), gem(judgeJSON([90, 85, 90, 90, 85]))];
  const r = await runCopilot({ citizenName: 'Sunita Devi', scheme: 'NSAP', complaint: 'Widow pension not credited for two months. Passbook shows nothing.', findings: 'Aadhaar authentication failed in August; redone on 3 October.' });
  assert.strictEqual(r.revised, true);
  assert.strictEqual(r.quality.verdictKey, 'resolved');
  assert.strictEqual(r.verification.ok, true, JSON.stringify(r.verification));
  assert.deepStrictEqual(r.trace.map((t) => t.step), ['Retrieve SOPs', 'Draft reply', 'Verify citations & figures', 'Judge self-check', 'Revise draft', 'Re-check revision']);
  assert.ok(r.totals.input > 0 && r.totals.costInr > 0);
});

test('Copilot refuses to draft when no SOP covers the complaint (no AI call made)', async () => {
  queue = [];
  const before = calls.length;
  const r = await runCopilot({ citizenName: 'Arjun Rao', scheme: 'auto', complaint: 'My vehicle insurance claim after the flood was rejected without any reason.' });
  assert.strictEqual(r.noSopFound, true);
  assert.strictEqual(calls.length, before);
});

test('Hindi replies: prompt asks for Hindi, earlier problems are passed on, Hindi figures are checked', async () => {
  const hiDraft = { reply_type: 'final', draft: 'प्रिय सुनीता देवी जी, आपकी पेंशन अगले मासिक भुगतान में बकाया के रूप में जमा होगी (NSAP pensions SOP §4.1)। यदि यह नहीं आती है, तो आप 30 दिनों के भीतर अपील कर सकती हैं (Grievance SOP §3)। सादर, शिकायत प्रकोष्ठ', cited_sections: ['NSAP-4.1', 'GEN-3'], unsupported_requests: [] };
  queue = [gem(hiDraft), gem(judgeJSON([88, 85, 90, 90, 85]))];
  const r = await runCopilot({ citizenName: 'Sunita Devi', scheme: 'NSAP', complaint: 'Widow pension not credited for two months. Passbook shows nothing.', findings: 'Aadhaar re-authenticated on 3 October.', language: 'hi', previousIssues: ['“Forwarded to” deflection'] });
  const draftCall = calls[calls.length - 2].body;
  assert.ok(draftCall.systemInstruction.parts[0].text.includes('Hindi'));
  assert.ok(draftCall.contents[0].parts[0].text.includes('<earlier_reply_problems>'));
  assert.strictEqual(r.language, 'hi');
  assert.strictEqual(r.verification.ok, true, JSON.stringify(r.verification));
  const v = verifyDraft('आपको 5 दिनों में ₹5000 मिलेंगे। आवश्यक कार्रवाई की जा रही है।', retrieve('pension', 'NSAP').schemeSections, '', '');
  assert.strictEqual(v.unsupportedSentences.length, 1);
  assert.ok(v.bannedPhrases.length >= 1);
});

test('Retrieval finds the right scheme for every sample case', () => {
  const cases = require('../data/cases');
  const wrong = cases.filter((c) => retrieve(c.complaint + ' ' + c.atr, 'auto').scheme !== c.scheme);
  assert.deepStrictEqual(wrong.map((c) => c.id), []);
});

test('OpenAI provider works the same way', async () => {
  delete process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = 'test';
  queue = [{ body: { choices: [{ message: { content: JSON.stringify(judgeJSON([80, 80, 80, 80, 80])) }, finish_reason: 'stop' }], usage: { prompt_tokens: 800, completion_tokens: 100 } } }];
  const r = await judge({ complaint: C, response: 'Paid on 05-10-2026, UTR 123456.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.model, 'gpt-4o-mini');
  assert.strictEqual(r.overallScore, 80);
  assert.ok(calls[calls.length - 1].url.includes('openai.com'));
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
});

// ---------- Supabase: knowledge base + run log ----------
const kb = require('../api/_lib/kb');
const { corpusSource, allSections } = require('../api/_lib/retrieve');
const draftRoute = require('../api/draft');
const statsRoute = require('../api/stats');
const sbOn = () => { process.env.SUPABASE_URL = 'https://demo.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test'; kb._reset(); };
const sbOff = () => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY; kb._reset(); };
const sopRows = () => require('../data/sops.json').sections.map((x, i) => ({ id: x.id, scheme: x.scheme, scheme_label: require('../data/sops.json').schemes[x.scheme], section: x.section, title: x.id === 'PMK-4.2' ? 'NPCI failure handling (from Supabase)' : x.title, text: x.text, keywords: x.keywords, sort_order: i + 1 }));

test('Supabase: SOPs load from the database and retrieval uses them', async () => {
  sbOn();
  queue = [{ body: sopRows() }];
  const src = await kb.ensureKnowledgeBase();
  assert.strictEqual(src, 'supabase');
  const req = calls[calls.length - 1];
  assert.ok(req.url.startsWith('https://demo.supabase.co/rest/v1/sop_sections'));
  assert.strictEqual(req.headers.apikey, 'sb_secret_test');
  assert.ok(allSections().some((x) => x.title === 'NPCI failure handling (from Supabase)'));
  const n = calls.length;
  await kb.ensureKnowledgeBase(); // cached: no second fetch
  assert.strictEqual(calls.length, n);
  sbOff();
});

test('Supabase down: falls back to data/sops.json without failing the request', async () => {
  sbOn();
  queue = [{ status: 500, body: 'boom' }, gem(judgeJSON([90, 85, 80, 90, 85]))];
  const r = await judge({ complaint: C, response: 'Paid on 05-10-2026, UTR 123456.', scheme: 'PM-KISAN' });
  assert.strictEqual(r.kbSource, 'file');
  assert.strictEqual(corpusSource(), 'file');
  assert.strictEqual(r.verdictKey, 'resolved');
  queue = []; // within the 1-minute cool-down no new Supabase call is made
  const before = calls.length;
  await kb.ensureKnowledgeBase();
  assert.strictEqual(calls.length, before, 'no Supabase retry during cool-down');
  sbOff();
});

test('Supabase run log: Judge request logs numbers only, never the citizen text', async () => {
  sbOn();
  queue = [{ body: sopRows() }, gem(judgeJSON([20, 20, 20, 20, 20], [{ code: 'DEFLECTION', evidence: 'forwarded to the concerned department' }])), { status: 201, body: '' }];
  const res = fakeRes();
  await evaluateRoute({ method: 'POST', body: { complaint: C, response: BOILER, scheme: 'PM-KISAN' } }, res);
  assert.strictEqual(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.strictEqual(out.logged, true);
  const log = calls[calls.length - 1];
  assert.ok(log.url.endsWith('/rest/v1/ai_runs'));
  assert.strictEqual(log.body.feature, 'judge');
  assert.strictEqual(log.body.tokens_in, 900);
  assert.deepStrictEqual(log.body.failure_modes, ['DEFLECTION']);
  const text = JSON.stringify(log.body);
  assert.ok(!text.includes('PM-KISAN installment') && !text.includes('concerned department'), 'no complaint or reply text in the log');
  sbOff();
});

test('Supabase run log failing does not break the Copilot response', async () => {
  sbOn();
  const good = { reply_type: 'final', draft: 'Dear Sunita Devi, Aadhaar authentication failed in August and was redone on 3 October. Your missed months will be paid as arrears with the next monthly credit (NSAP pensions SOP §4.1), which is due on or before the 7th (NSAP pensions SOP §3.1). If it does not arrive, you may appeal within 30 days of closure (Grievance SOP §3). Regards, Grievance Cell', cited_sections: ['NSAP-4.1'], unsupported_requests: [] };
  queue = [{ body: sopRows() }, gem(good), gem(judgeJSON([90, 85, 90, 90, 85])), { status: 503, body: 'down' }];
  const res = fakeRes();
  await draftRoute({ method: 'POST', body: { citizenName: 'Sunita Devi', scheme: 'NSAP', complaint: 'Widow pension not credited for two months. Passbook shows nothing.', findings: 'Aadhaar authentication failed in August; redone on 3 October.' } }, res);
  assert.strictEqual(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.strictEqual(out.logged, false);
  assert.strictEqual(out.kbSource, 'supabase');
  assert.strictEqual(out.quality.verdictKey, 'resolved');
  sbOff();
});

test('Stats route: off without Supabase, returns rows when configured', async () => {
  sbOff();
  let res = fakeRes(); await statsRoute({ method: 'GET' }, res);
  assert.deepStrictEqual(JSON.parse(res.body), { enabled: false });
  sbOn();
  queue = [{ body: [{ feature: 'judge', runs: 3, avg_cost_inr: 0.09 }] }];
  res = fakeRes(); await statsRoute({ method: 'GET' }, res);
  const s = JSON.parse(res.body);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.rows[0].runs, 3);
  assert.ok(calls[calls.length - 1].url.includes('/rest/v1/ai_run_stats'));
  sbOff();
});

(async () => {
  let pass = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log(`  ✔ ${t.name}`); }
    catch (e) { console.log(`  ✖ ${t.name}\n    ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${pass}/${tests.length} tests passed`);
})();
