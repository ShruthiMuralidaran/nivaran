// Deterministic scoring: the model proposes criterion scores and failure modes with evidence;
// this code checks the evidence and computes the final score and verdict, so repeat runs agree.

const CRITERIA = [
  { key: 'addresses_complaint', name: 'Addresses the complaint' },
  { key: 'specific_action', name: 'Specific action taken' },
  { key: 'policy_grounded', name: 'Grounded in policy' },
  { key: 'avoids_boilerplate', name: 'Written for this case' },
  { key: 'next_steps', name: 'Clear next steps' },
];

const MODES = {
  STATUS_RESTATEMENT: { label: 'Status restatement', help: 'Repeats the portal status the citizen already disputes.' },
  BOILERPLATE: { label: '“Advised suitably” boilerplate', help: 'Template phrasing with no facts about this case.' },
  DEFLECTION: { label: '“Forwarded to” deflection', help: 'Passes the case on without owner or timeline.' },
  INSTITUTIONAL_BIAS: { label: 'Institutional bias in evidence', help: 'Relies only on the record of the party complained about.' },
  BURDEN_TRANSFER: { label: 'Burden transfer', help: 'Sends the citizen to an office or helpline instead of acting.' },
  NON_RESPONSIVE: { label: 'Answers a different issue', help: 'The reply is about something other than the complaint.' },
};

const SCORING_RULE = 'Score = average of the 5 criteria. Caps: a reply that answers a different issue ≤ 20; any serious failure mode (status restatement, deflection, institutional bias, burden transfer) ≤ 59; two or more failure modes ≤ 39. Verdict: ≥ 70 Resolved · 40–69 Needs review · < 40 Hollow closure.';

function clampInt(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Guard against a model answering on the wrong scale (0-1 or 0-10).
function normalizeScale(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return { values, factor: 1 };
  const max = Math.max(...nums);
  if (max <= 1 && nums.some((v) => v > 0 && v < 1)) return { values: values.map((v) => v * 100), factor: 100 };
  if (max <= 10 && nums.some((v) => v > 1)) return { values: values.map((v) => v * 10), factor: 10 };
  return { values, factor: 1 };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Evidence must actually appear in the officer reply (exact, or most of its words).
function evidenceFound(evidence, reply) {
  const e = norm(evidence);
  const r = norm(reply);
  if (!e || e.length < 3) return false;
  if (r.includes(e)) return true;
  const words = e.split(' ').filter((w) => w.length > 2);
  if (!words.length) return false;
  const rset = new Set(r.split(' '));
  const hit = words.filter((w) => rset.has(w)).length;
  return hit / words.length >= 0.7;
}

/**
 * Turn raw model output into a checked, deterministic result.
 * @param {object} raw  model JSON
 * @param {string} reply officer reply text (for evidence checks)
 */
function finalize(raw, reply) {
  const rc = (raw && raw.criteria) || {};
  const rawScores = CRITERIA.map((c) => {
    const v = rc[c.key];
    const s = v && typeof v === 'object' ? v.score : v;
    return typeof s === 'string' ? Number(s) : s;
  });
  if (rawScores.some((s) => typeof s !== 'number' || !Number.isFinite(s))) {
    const err = new Error('Model output missing criterion scores');
    err.code = 'BAD_OUTPUT';
    throw err;
  }
  const { values, factor } = normalizeScale(rawScores);
  const criteria = CRITERIA.map((c, i) => ({
    key: c.key,
    name: c.name,
    score: clampInt(values[i]),
    reason: String((rc[c.key] && rc[c.key].reason) || '').slice(0, 240),
  }));

  // Keep only failure modes from the allowed list whose evidence is really in the reply.
  const accepted = [];
  const discarded = [];
  const seen = new Set();
  for (const fm of Array.isArray(raw.failure_modes) ? raw.failure_modes : []) {
    const code = String((fm && (fm.code || fm.mode)) || fm || '').toUpperCase().replace(/[^A-Z_]/g, '');
    if (!MODES[code] || seen.has(code)) continue;
    const evidence = String((fm && fm.evidence) || '').slice(0, 300);
    if (evidenceFound(evidence, reply)) {
      seen.add(code);
      accepted.push({ code, label: MODES[code].label, help: MODES[code].help, evidence });
    } else {
      discarded.push({ code, evidence });
    }
  }

  const proof = raw.proof_of_resolution === true;
  // A reply that proves the outcome should not lose marks just for not quoting an SOP.
  if (proof && !accepted.length) {
    const pg = criteria.find((c) => c.key === 'policy_grounded');
    if (pg.score < 70) { pg.score = 70; pg.reason = (pg.reason ? pg.reason + ' ' : '') + '(Raised: reply proves the outcome.)'; }
  }

  let score = Math.round(criteria.reduce((a, c) => a + c.score, 0) / criteria.length);
  const codes = accepted.map((m) => m.code);
  const caps = [];
  if (codes.includes('NON_RESPONSIVE')) caps.push(20);
  if (codes.some((c) => ['STATUS_RESTATEMENT', 'DEFLECTION', 'INSTITUTIONAL_BIAS', 'BURDEN_TRANSFER'].includes(c))) caps.push(59);
  if (codes.length >= 2) caps.push(39);
  const cap = caps.length ? Math.min(...caps) : null;
  const uncapped = score;
  if (cap != null) score = Math.min(score, cap);

  const verdict = score >= 70 ? 'Resolved' : score >= 40 ? 'Needs review' : 'Hollow closure';
  const verdictKey = score >= 70 ? 'resolved' : score >= 40 ? 'review' : 'hollow';

  return {
    overallScore: score,
    uncappedScore: uncapped,
    capApplied: cap != null && cap < uncapped ? cap : null,
    verdict,
    verdictKey,
    criteria,
    failureModes: accepted,
    discardedModes: discarded,
    proofOfResolution: proof,
    claimsToVerify: (Array.isArray(raw.claims_to_verify) ? raw.claims_to_verify : []).map(String).slice(0, 6),
    explanation: String(raw.explanation || '').slice(0, 800),
    scaleCorrected: factor !== 1 ? factor : null,
    scoringRule: SCORING_RULE,
  };
}

module.exports = { finalize, evidenceFound, normalizeScale, CRITERIA, MODES, SCORING_RULE };
