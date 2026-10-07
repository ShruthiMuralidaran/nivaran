// Evaluation harness. One command produces every number the deck needs:
//   1. Judge accuracy vs labels (blind labels if eval/blind_labels.csv exists), repeatability, adversarial results
//   2. Full Copilot drafting sessions: AI calls, revisions, final quality, tokens, cost, time
//   3. Cost per session and at 10,000 officers, plus a model comparison at the measured token counts
// Writes eval/results.md (detail), eval/deck_numbers.md (paste into slides) and eval/results.json (raw).
//   npm run eval                        (3 Judge runs per case + 5 Copilot sessions)
//   RUNS=1 / COPILOT=0 / CONCURRENCY=1  to make it quicker or gentler on rate limits
const fs = require('fs');
const path = require('path');
require('./env').loadEnv();
const cases = require('../data/cases');
const copilotCases = require('../data/copilot_cases');
const { EXTRA } = require('./eval-cases');
const { judge } = require('../api/_lib/judge');
const { runCopilot } = require('../api/_lib/copilot');
const { publicConfig, PRICING_USD_PER_M } = require('../api/_lib/config');
const { PROMPT_VERSION } = require('../api/_lib/prompts');

const RUNS = Math.max(1, Number(process.env.RUNS) || 3);
const CONC = Math.max(1, Number(process.env.CONCURRENCY) || 2);
const COPILOT = process.env.COPILOT === '0' ? 0 : copilotCases.length;
const OFFICERS = 10000;
const GRIEVANCES_PER_OFFICER = 22; // 26.45L disposals a year / 12 / 10,000 officers
const HOSTING_USD = 20; // Vercel Pro
const EVAL_DIR = path.join(__dirname, '..', 'eval');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const inr = (v, d = 3) => `₹${Number(v).toFixed(d)}`;
const LABELS = ['resolved', 'review', 'hollow'];

// ---------- labels: blind (from an outside labeler) if provided ----------
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const out = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim())) out.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some((x) => x.trim())) out.push(row);
  return out;
}
function loadBlindLabels() {
  const file = process.env.LABELS || path.join(EVAL_DIR, 'blind_labels.csv');
  if (!fs.existsSync(file)) return null;
  const t = parseCSV(fs.readFileSync(file, 'utf8'));
  const head = t[0].map((h) => h.trim().toLowerCase());
  const iId = head.indexOf('case_id');
  const iL = head.findIndex((h) => ['your_label', 'label', 'human_label'].includes(h));
  if (iId < 0 || iL < 0) throw new Error(`${file} needs case_id and your_label columns`);
  const map = {};
  t.slice(1).forEach((r) => { const l = String(r[iL] || '').trim().toLowerCase(); if (LABELS.includes(l)) map[r[iId].trim()] = l; });
  return { file, map };
}

(async () => {
  const cfg = publicConfig();
  const blind = loadBlindLabels();
  const all = [...cases, ...EXTRA].map((c) => ({ ...c, team_label: c.human_label, label: blind && blind.map[c.id] ? blind.map[c.id] : c.human_label, labelSource: blind && blind.map[c.id] ? 'blind' : 'team' }));
  const blindCount = all.filter((c) => c.labelSource === 'blind').length;
  console.log(`\nNivaran eval · ${cfg.mode === 'live' ? `${cfg.provider} ${cfg.model}` : 'OFFLINE rule-based (no API key)'}`);
  console.log(`Judge: ${all.length} cases × ${RUNS} runs · labels: ${blindCount ? `${blindCount} blind (${path.basename(blind.file)})` : 'team-written (run npm run label-kit for blind labels)'} · Copilot sessions: ${COPILOT}\n`);

  // ---------- 1. Judge ----------
  const jobs = [];
  all.forEach((c) => { for (let r = 0; r < RUNS; r++) jobs.push(c); });
  const results = {};
  let done = 0;
  async function worker() {
    while (jobs.length) {
      const c = jobs.shift();
      try {
        const out = await judge({ complaint: c.complaint, response: c.atr, scheme: c.scheme });
        (results[c.id] = results[c.id] || []).push({ score: out.overallScore, verdict: out.verdictKey, modes: out.failureModes.map((m) => m.code), tin: out.usage.input, tout: out.usage.output, cost: out.costInr || 0, ms: out.ms });
      } catch (e) { (results[c.id] = results[c.id] || []).push({ error: e.message }); }
      done++; process.stdout.write(`\r  Judge checks ${done}/${all.length * RUNS}`);
      if (cfg.mode === 'live') await sleep(1200);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('');

  const rows = all.map((c) => {
    const rs = (results[c.id] || []).filter((x) => !x.error);
    const counts = {}; rs.forEach((x) => { counts[x.verdict] = (counts[x.verdict] || 0) + 1; });
    const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const scores = rs.map((x) => x.score);
    return {
      id: c.id, note: c.note || '', label: c.label, team: c.team_label, source: c.labelSource,
      majority: majority ? majority[0] : null, runs: rs.length, errors: (results[c.id] || []).length - rs.length,
      consistent: rs.length > 0 && Object.keys(counts).length === 1,
      spread: scores.length ? Math.max(...scores) - Math.min(...scores) : 0,
      avg: scores.length ? Math.round(mean(scores)) : null,
      modes: [...new Set(rs.flatMap((x) => x.modes))].join(', '),
    };
  });
  const scored = rows.filter((r) => r.runs);
  const exact = scored.filter((r) => r.majority === r.label).length;
  const binary = scored.filter((r) => (r.majority === 'hollow') === (r.label === 'hollow')).length;
  const consistent = rows.filter((r) => r.consistent).length;
  const hollowRows = scored.filter((r) => r.label === 'hollow');
  const hollowCaught = hollowRows.filter((r) => r.majority === 'hollow').length;
  const goodRows = scored.filter((r) => r.label === 'resolved');
  const goodWronglyHollow = goodRows.filter((r) => r.majority === 'hollow').length;
  const flat = Object.values(results).flat().filter((x) => !x.error);
  const judgeErr = Object.values(results).flat().filter((x) => x.error).length;
  if (!flat.length) {
    const first = Object.values(results).flat().find((x) => x.error);
    console.error(`\n✖ Every Judge check failed, so no numbers were written.\n  First error: ${first ? first.error : 'unknown'}\n  Check the API key in .env, the model name, and your internet connection.\n`);
    process.exit(1);
  }
  if (judgeErr) console.warn(`\n⚠ ${judgeErr} of ${judgeErr + flat.length} Judge checks failed (often rate limits). Results use the rest; consider CONCURRENCY=1.\n`);
  const J = { tin: mean(flat.map((x) => x.tin)), tout: mean(flat.map((x) => x.tout)), cost: mean(flat.map((x) => x.cost)), ms: mean(flat.map((x) => x.ms)) };
  const interRater = blindCount ? all.filter((c) => c.labelSource === 'blind') : [];
  const interAgree = interRater.filter((c) => c.label === c.team_label).length;

  // ---------- 2. Copilot sessions ----------
  const sessions = [];
  for (let i = 0; i < COPILOT; i++) {
    const c = copilotCases[i];
    process.stdout.write(`\r  Copilot sessions ${i + 1}/${COPILOT}`);
    try {
      const r = await runCopilot(c);
      sessions.push({ id: c.id, ok: true, calls: r.trace.filter((t) => t.tokensIn != null).length, revised: r.revised, score: r.quality ? r.quality.overallScore : null, verdict: r.quality ? r.quality.verdictKey : null, verified: r.verification ? r.verification.ok : null, tin: r.totals.input, tout: r.totals.output, cost: r.totals.costInr, ms: r.ms, replyType: r.replyType, noSop: r.noSopFound });
    } catch (e) { sessions.push({ id: c.id, ok: false, error: e.message }); }
    if (cfg.mode === 'live') await sleep(1500);
  }
  if (COPILOT) console.log('\n');
  const S = sessions.filter((s) => s.ok && !s.noSop);
  const C = { calls: mean(S.map((s) => s.calls)), tin: mean(S.map((s) => s.tin)), tout: mean(S.map((s) => s.tout)), cost: mean(S.map((s) => s.cost)), ms: mean(S.map((s) => s.ms)), revised: S.filter((s) => s.revised).length, verified: S.filter((s) => s.verified).length, resolved: S.filter((s) => s.verdict === 'resolved').length, score: mean(S.map((s) => s.score || 0)) };

  // ---------- 3. Cost ----------
  const usdInr = cfg.usdInr;
  const price = (model, tin, tout) => { const p = PRICING_USD_PER_M[model]; return p ? ((tin * p.input + tout * p.output) / 1e6) * usdInr : null; };
  const sessionTin = (S.length ? C.tin : 0) + J.tin;
  const sessionTout = (S.length ? C.tout : 0) + J.tout;
  const sessionCost = (S.length ? C.cost : 0) + J.cost;
  const monthly = OFFICERS * GRIEVANCES_PER_OFFICER;
  const host = HOSTING_USD * usdInr;
  const judgeShare = sessionCost ? J.cost / sessionCost : 0;
  const scen = [
    ['A. As measured (1 Copilot draft + 1 Judge check per grievance)', sessionCost],
    ['B. Officer redrafts once (2 drafts + 1 check)', (S.length ? 2 * C.cost : 0) + J.cost],
    ['C. Judge only: audit every closure, no drafting', J.cost],
  ];
  const modelRows = Object.keys(PRICING_USD_PER_M).map((m) => [m, price(m, sessionTin, sessionTout)]);
  const live = cfg.mode === 'live';
  const failedSessions = sessions.filter((s) => !s.ok).length;
  const warn = (live ? '' : '\n> **OFFLINE RUN: these are rule-based stand-in numbers, not the AI. Do not put them in the deck.** Add an API key to .env and run again.\n')
    + (judgeErr || failedSessions ? `\n> ⚠ ${judgeErr} Judge check(s) and ${failedSessions} Copilot session(s) failed and are excluded. Re-run with CONCURRENCY=1 if these were rate limits.\n` : '');

  // ---------- write reports ----------
  const results_md = `# Nivaran evaluation — detail
${warn}
- Date: ${new Date().toISOString().slice(0, 10)} · Mode: ${live ? `live · ${cfg.provider} · \`${cfg.model}\`` : 'offline stand-in'} · Prompt ${PROMPT_VERSION}
- Judge: ${all.length} cases (${cases.length} closures + ${EXTRA.length} adversarial) × ${RUNS} runs, ${judgeErr} errors · Labels: ${blindCount ? `${blindCount} blind` : 'team-written'}

| Case | Label | Judge (majority) | Avg score | Spread | Same every run | Failure modes |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.id}${r.note ? ` (${r.note})` : ''} | ${r.label}${r.source === 'blind' ? '*' : ''} | ${r.majority || 'error'} | ${r.avg ?? '-'} | ${r.spread} | ${r.consistent ? 'yes' : 'no'} | ${r.modes || '-'} |`).join('\n')}
${blindCount ? '\n\\* blind label from an outside labeler\n' : ''}
## Copilot sessions

| Case | AI calls | Revised | Final score | Figures verified | Tokens in/out | Cost | Time |
|---|---|---|---|---|---|---|---|
${sessions.map((s) => (s.ok ? (s.noSop ? `| ${s.id} | 0 | – | no SOP: refused | – | – | – | – |` : `| ${s.id} | ${s.calls} | ${s.revised ? 'yes' : 'no'} | ${s.score} (${s.verdict}) | ${s.verified ? 'yes' : 'no'} | ${s.tin}/${s.tout} | ${inr(s.cost, 4)} | ${(s.ms / 1000).toFixed(1)} s |`) : `| ${s.id} | error: ${s.error} |  |  |  |  |  |  |`)).join('\n')}
`;

  const deck_md = `# Numbers for the deck
${warn}
_Generated ${new Date().toISOString().slice(0, 10)} by \`npm run eval\` · ${live ? `${cfg.provider} \`${cfg.model}\`` : 'OFFLINE'} · prices ${cfg.pricesAsOf} · ₹${usdInr}/$_

## Slide: testing (AI sophistication)
- **Agreement with ${blindCount ? 'blind human labels' : 'human labels (team-written)'}: ${exact}/${scored.length} exact verdict (${pct(exact, scored.length)}%); hollow vs not-hollow ${pct(binary, scored.length)}%**
- Hollow closures caught: **${hollowCaught}/${hollowRows.length}** · Genuine resolutions wrongly called hollow: **${goodWronglyHollow}/${goodRows.length}**
- Repeatability: **same verdict on all ${RUNS} runs for ${consistent}/${rows.length} cases (${pct(consistent, rows.length)}%)**
${blindCount ? `- Our team's labels vs the blind labeler: ${interAgree}/${interRater.length} agree (${pct(interAgree, interRater.length)}%), so this is the human ceiling to compare against\n` : ''}
| Adversarial test | Expected | Judge | Avg score |
|---|---|---|---|
${rows.filter((r) => r.id.startsWith('A-')).map((r) => `| ${r.note} | ${r.label} | ${r.majority} | ${r.avg} |`).join('\n')}

## Slide: Copilot
${S.length ? `- ${S.length} drafting sessions: **${C.calls.toFixed(1)} AI calls per draft on average**, ${C.revised}/${S.length} revised automatically, **${C.resolved}/${S.length} ended Resolved** (avg score ${Math.round(C.score)}), figures verified in ${C.verified}/${S.length}
- Average time per draft: **${(C.ms / 1000).toFixed(1)} s**` : '- (Copilot sessions skipped)'}

## Slide: cost per session
| Step | Input tokens | Output tokens | ₹ |
|---|---|---|---|
${S.length ? `| Copilot draft (incl. self-check${C.revised ? ' and revisions' : ''}) | ${Math.round(C.tin)} | ${Math.round(C.tout)} | ${C.cost.toFixed(3)} |\n` : ''}| Judge check | ${Math.round(J.tin)} | ${Math.round(J.tout)} | ${J.cost.toFixed(3)} |
| **Session** | **${Math.round(sessionTin)}** | **${Math.round(sessionTout)}** | **${sessionCost.toFixed(3)}** |

Average Judge check time: ${(J.ms / 1000).toFixed(1)} s.

## Slide: cost at 10,000 officers
${OFFICERS.toLocaleString('en-IN')} officers × ${GRIEVANCES_PER_OFFICER} grievances a month = ${monthly.toLocaleString('en-IN')} sessions/month. Hosting: Vercel Pro $${HOSTING_USD} = ₹${Math.round(host).toLocaleString('en-IN')}/month. Supabase: free tier covers the SOP table and the run log at this volume; Pro is $25/month if needed.

| Scenario | ₹ per grievance | AI per month | + hosting | ₹ per officer per month |
|---|---|---|---|---|
${scen.map(([n, v]) => `| ${n} | ${v.toFixed(3)} | ₹${Math.round(v * monthly).toLocaleString('en-IN')} | ₹${Math.round(v * monthly + host).toLocaleString('en-IN')} | ${((v * monthly + host) / OFFICERS).toFixed(2)} |`).join('\n')}

- Judge share of session cost: ${pct(judgeShare * 100, 100)}%. Batch the Judge overnight (≈50% off where offered) → scenario A ≈ ₹${Math.round((sessionCost - 0.5 * J.cost) * monthly).toLocaleString('en-IN')}/month AI.
- All 26.45L central disposals a year through the Judge only: ≈ ₹${Math.round(J.cost * 2645000).toLocaleString('en-IN')} a year.

## Slide: model choice (same measured tokens, list prices)
| Model | ₹ per session | vs current |
|---|---|---|
${modelRows.map(([m, v]) => `| ${m}${m === cfg.model ? ' (current)' : ''} | ${v == null ? '-' : v.toFixed(3)} | ${v == null || !sessionCost ? '-' : (v / (price(cfg.model, sessionTin, sessionTout) || sessionCost)).toFixed(2) + '×'} |`).join('\n')}
`;

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVAL_DIR, 'results.md'), results_md);
  fs.writeFileSync(path.join(EVAL_DIR, 'deck_numbers.md'), deck_md);
  fs.writeFileSync(path.join(EVAL_DIR, 'results.json'), JSON.stringify({ config: cfg, runs: RUNS, rows, sessions, raw: results }, null, 2));
  console.log(deck_md);
  console.log('Wrote eval/deck_numbers.md (for the slides) and eval/results.md (detail).');
})();
