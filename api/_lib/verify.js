// Deterministic checks on a Copilot draft: are the citations real, and is every deadline or
// amount backed by a cited SOP or by the officer's findings?

const BANNED = [
  /forwarded to (?:the )?concerned/i,
  /necessary action/i,
  /advised suitably/i,
  /\bin due course\b/i,
  /\bhas been noted\b/i,
  /routing your case to a senior officer/i,
  /contact the helpline/i,
  /संबंधित विभाग को/,
  /आवश्यक कार्रवाई/,
  /यथोचित सलाह/,
];

const NUMERIC_CLAIM = /(\b\d+\s*(?:working\s+)?(?:days?|hours?|weeks?|months?)\b|(?:rs\.?|₹|inr|रु\.?|रुपये)\s?[\d,]+|\b\d{1,2}(?:st|nd|rd|th)\b|\d+\s*(?:कार्य\s*)?(?:दिनों|दिन|घंटों|घंटे|सप्ताह|महीने|महीनों))/i;

function cleanLabel(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').trim();
}

function sentences(text) {
  return String(text).split(/(?<=[.!?।])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function numbersIn(s) {
  return (s.match(/\d[\d,]*/g) || []).map((n) => n.replace(/,/g, ''));
}

/**
 * @param {string} draft
 * @param {object[]} sections retrieved SOP sections (with .label and .text)
 * @param {string} findings officer findings
 * @param {string} complaint citizen complaint
 */
function verifyDraft(draft, sections, findings = '', complaint = '') {
  const labels = new Map(sections.map((s) => [cleanLabel(s.label), s]));
  const cited = new Set();
  const unknownCitations = [];
  const re = /\(([^()]*?SOP\s*§\s*[\d.]+)\)/gi;
  let m;
  while ((m = re.exec(draft))) {
    const key = cleanLabel(m[1].replace(/\.$/, ''));
    const hit = labels.get(key);
    if (hit) cited.add(hit.id);
    else unknownCitations.push(m[1]);
  }

  const support = `${findings} ${complaint}`;
  const supportNums = new Set(numbersIn(support));
  const sopNums = new Set(sections.flatMap((x) => numbersIn(x.text)));
  const unsupportedSentences = [];
  let recent = []; // sections cited in the previous sentence (a citation can cover the sentence that follows it)
  for (const s of sentences(draft)) {
    const here = [...labels.entries()].filter(([l]) => cleanLabel(s).includes(l)).map(([, sec]) => sec);
    if (NUMERIC_CLAIM.test(s) && !here.length) {
      const nums = numbersIn(s);
      // Numbers from the findings or the complaint are the officer's / citizen's own facts.
      const fromSupport = nums.length && nums.every((n) => supportNums.has(n));
      const fromRecent = nums.length && recent.length && nums.every((n) => supportNums.has(n) || recent.some((sec) => numbersIn(sec.text).includes(n)));
      if (!fromSupport && !fromRecent) {
        unsupportedSentences.push({ sentence: s, reason: nums.some((n) => sopNums.has(n)) ? 'Uses an SOP figure without citing the section' : 'Deadline or amount not found in the SOPs or the findings' });
      }
    }
    recent = here.length ? here : [];
  }

  const bannedPhrases = BANNED.map((r) => (draft.match(r) || [])[0]).filter(Boolean);
  return {
    citedIds: [...cited],
    unknownCitations,
    unsupportedSentences,
    bannedPhrases,
    ok: !unknownCitations.length && !unsupportedSentences.length && !bannedPhrases.length,
  };
}

module.exports = { verifyDraft };
