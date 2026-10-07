// Offline mode: a rule-based stand-in used ONLY when no API key is configured,
// so the app (and the AAs) can still click through every screen. The UI labels it clearly.
const { tokenize, detectScheme } = require('./retrieve');

const PATTERNS = {
  BOILERPLATE: /(advised suitably|necessary action|appropriate action|in due course|has been noted|is noted|noted for|under examination|will be looked into|matter is being (?:examined|looked into)|as per (?:the )?guidelines)/i,
  DEFLECTION: /(forwarded to (?:the )?(?:concerned|relevant)[^.]*|transferred to (?:the )?(?:concerned|relevant)[^.]*|routing your case to a senior officer|sent to (?:the )?concerned[^.]*)/i,
  BURDEN_TRANSFER: /(contact the helpline|call the helpline|visit (?:the|your) [^.]*office[^.]*|in person[^.]*|re-?apply[^.]*)/i,
  STATUS_RESTATEMENT: /(as per (?:our |the )?records?,? [^.]*|status (?:is|shows) [^.]*|shows as delivered|is under process)/i,
  INSTITUTIONAL_BIAS: /(as per the (?:distributor|agency|dealer|bank|vendor)[^.]*|(?:distributor|agency|dealer)'?s? records?[^.]*)/i,
};

function specifics(text) {
  const t = String(text || '');
  const checks = [
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/,
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
    /\b(utr|ref(?:erence)?|arn|id|code|no\.)\s*[:#]?\s*[A-Z0-9-]*\d/i,
    /(rs\.?|₹|inr)\s?[\d,]+/i,
    /sop\s*§?\s*\d/i,
    /within \d+\s*(working )?(days?|hours?)/i,
    /\n\s*\d[.)]\s/,
  ];
  return checks.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
}

function overlap(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / A.size;
}

function judgeRaw({ complaint, response }) {
  const modes = [];
  for (const [code, re] of Object.entries(PATTERNS)) {
    const m = response.match(re);
    if (m) modes.push({ code, evidence: m[0].trim() });
  }
  const sc = detectScheme(complaint);
  const sr = detectScheme(response);
  const ov = overlap(complaint, response);
  const offTopic = sc && sr && sc !== sr && ov < 0.25;
  if (offTopic) modes.push({ code: 'NON_RESPONSIVE', evidence: response.split(/[.\n]/)[0].slice(0, 80) });
  const spec = specifics(response);
  const proof = /(credited|paid|issued|delivered to you|restored|approved|dispatched)/i.test(response) && /(utr|ref|reference|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|tracking)/i.test(response);
  const boiler = modes.filter((m) => m.code === 'BOILERPLATE').length + (modes.some((m) => m.code === 'DEFLECTION') ? 1 : 0);
  const criteria = {
    addresses_complaint: { score: offTopic ? 8 : Math.min(95, Math.round(25 + ov * 90 + spec * 6)), reason: 'Offline estimate from word overlap with the complaint.' },
    specific_action: { score: Math.min(95, 12 + spec * 16 + (/(credited|issued|restored|escalated|re-?sent|approved|processed|ordered|initiated)/i.test(response) ? 15 : 0)), reason: 'Offline estimate from dates, reference numbers and action verbs.' },
    policy_grounded: { score: /sop\s*§?\s*\d/i.test(response) ? 85 : proof ? 72 : Math.min(60, 20 + spec * 8), reason: 'Offline estimate: SOP citation or proof of outcome.' },
    avoids_boilerplate: { score: Math.max(5, Math.min(95, 85 - boiler * 35 + spec * 4)), reason: 'Offline estimate from template phrases.' },
    next_steps: { score: Math.min(95, 15 + (/within \d+|by \d{1,2}|next (?:weekly )?batch|on or before/i.test(response) ? 35 : 0) + (/(appeal|escalat|if (?:this|it) is not|if not)/i.test(response) ? 25 : 0) + (/\n\s*\d[.)]\s/.test(response) ? 15 : 0)), reason: 'Offline estimate from timelines and escalation route.' },
  };
  return {
    criteria,
    failure_modes: modes,
    proof_of_resolution: proof && !offTopic,
    claims_to_verify: (response.match(/\b(?:UTR|Ref(?:erence)?|ARN|ID)\s*[:#]?\s*[A-Z0-9-]*\d[A-Z0-9-]*/gi) || []).slice(0, 4),
    explanation: 'Demo mode: this is a rule-based estimate, not the AI Judge.',
  };
}

function firstSentences(text, n = 2) {
  return String(text).split(/(?<=\.)\s+/).slice(0, n).join(' ');
}

function draftRaw({ citizenName, complaintId, department, findings, sections, general }) {
  const s = sections[0];
  const lines = [];
  lines.push(`Dear ${citizenName},`);
  lines.push('');
  lines.push(`This is about your complaint${complaintId ? ` ${complaintId}` : ''}.`);
  if (findings) lines.push(`On checking your record, we found: ${findings.trim().replace(/\.?$/, '.')}`);
  else lines.push('We have opened your case for checking under the rules below.');
  lines.push(`Under the rules (${s.label}): ${firstSentences(s.text, 2)}`);
  if (sections[1]) lines.push(`Also (${sections[1].label}): ${firstSentences(sections[1].text, 1)}`);
  if (general) lines.push(`If this does not happen, you may appeal within 30 days of closure (${general.label}).`);
  lines.push('');
  lines.push(`Regards,\nGrievance Cell${department ? `, ${department}` : ''}`);
  return {
    reply_type: findings ? 'final' : 'interim',
    draft: lines.join('\n'),
    cited_sections: [s.id, sections[1] && sections[1].id, general && general.id].filter(Boolean),
    unsupported_requests: [],
  };
}

module.exports = { judgeRaw, draftRaw };
