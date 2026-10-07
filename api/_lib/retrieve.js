// Retrieval over the SOP corpus: scheme detection + BM25 ranking.
// The corpus is loaded from Supabase when configured (see kb.js); data/sops.json is the built-in fallback,
// so the AAs can rerun everything without access to our database.
const FILE_CORPUS = require('../../data/sops.json');
let corpus = FILE_CORPUS;
let source = 'file';
const schemeNames = { ...FILE_CORPUS.schemes }; // same object reference for all importers; updated in place

const STOP = new Set('a an and are as at be been but by for from has have i in is it its me my of on or our so that the this to was we were will with you your not no has had did do does been being am they them their there here what which who whom when where why how all any can could should would may might must shall into than then also very just only about after before over under again more most such own same too s t'.split(' '));

// Simple stemming so "installments"/"installment", "cancelled"/"cancel" match.
function stem(w) {
  if (w.length > 5 && w.endsWith('ments')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/instalment/g, 'installment')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && w.length > 1 && !STOP.has(w))
    .map(stem);
}

const SCHEME_HINTS = {
  'PM-KISAN': ['pm-kisan', 'pm kisan', 'kisan', 'farmer', 'किसान', 'kist', 'किस्त'],
  NSAP: ['nsap', 'widow pension', 'old age pension', 'old-age pension', 'disability pension', 'vidhwa', 'विधवा', 'वृद्धावस्था'],
  EPFO: ['epf', 'epfo', 'pf ', 'provident fund', 'uan', 'eps', 'pf transfer', 'pf withdrawal'],
  PASSPORT: ['passport', 'rpo', 'police verification', 'पासपोर्ट'],
  NSP: ['scholarship', 'nsp', 'छात्रवृत्ति'],
  LPG: ['lpg', 'cylinder', 'gas refill', 'ujjwala', 'pmuy', 'gas connection', 'सिलेंडर'],
  PDS: ['ration', 'fair price shop', 'pds', 'राशन'],
};

const SCHEME_ALIASES = {
  'PM-KISAN': 'PM-KISAN', PMKISAN: 'PM-KISAN', KISAN: 'PM-KISAN',
  NSAP: 'NSAP', PENSION: 'NSAP',
  EPFO: 'EPFO', EPF: 'EPFO',
  PASSPORT: 'PASSPORT',
  NSP: 'NSP', 'NATIONAL SCHOLARSHIP': 'NSP', SCHOLARSHIP: 'NSP',
  LPG: 'LPG', PMUY: 'LPG', 'LPG / PMUY': 'LPG',
  PDS: 'PDS', RATION: 'PDS', 'PDS RATION CARD': 'PDS',
};

function normalizeScheme(s) {
  const k = String(s || '').trim().toUpperCase();
  if (!k || k === 'AUTO' || k === 'OTHER') return null;
  return SCHEME_ALIASES[k] || (corpus.schemes[k] ? k : null);
}

function detectScheme(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let best = null;
  let bestHits = 0;
  for (const [scheme, hints] of Object.entries(SCHEME_HINTS)) {
    const hits = hints.reduce((n, h) => n + (t.includes(h) ? 1 : 0), 0);
    if (hits > bestHits) { best = scheme; bestHits = hits; }
  }
  return best;
}

// BM25 statistics, rebuilt whenever the corpus changes.
let DOCS = [];
let AVGDL = 1;
let DF = new Map();
let N = 0;
function buildIndex() {
  DOCS = corpus.sections.map((s) => {
    const tokens = tokenize(`${s.title} ${s.title} ${s.text} ${(s.keywords || []).join(' ')} ${(s.keywords || []).join(' ')}`);
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { ...s, len: tokens.length, tf };
  });
  AVGDL = DOCS.reduce((a, d) => a + d.len, 0) / (DOCS.length || 1);
  DF = new Map();
  DOCS.forEach((d) => d.tf.forEach((_, t) => DF.set(t, (DF.get(t) || 0) + 1)));
  N = DOCS.length;
}
buildIndex();

// Swap in a corpus loaded elsewhere (Supabase). Invalid input leaves the current corpus untouched.
function setCorpus(next, from) {
  if (!next || !Array.isArray(next.sections) || !next.sections.length || !next.schemes) return false;
  corpus = { notice: next.notice || FILE_CORPUS.notice, schemes: next.schemes, sections: next.sections };
  Object.keys(schemeNames).forEach((k) => delete schemeNames[k]);
  Object.assign(schemeNames, corpus.schemes);
  source = from || 'custom';
  buildIndex();
  return true;
}
function resetCorpus() { setCorpus(FILE_CORPUS, 'file'); }
function corpusSource() { return source; }

function bm25(queryTokens, doc, k1 = 1.4, b = 0.75) {
  let score = 0;
  const seen = new Set();
  for (const q of queryTokens) {
    if (seen.has(q)) continue;
    seen.add(q);
    const f = doc.tf.get(q);
    if (!f) continue;
    const df = DF.get(q) || 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / AVGDL)));
  }
  return score;
}

function label(section) {
  const name = section.scheme === 'GENERAL' ? 'Grievance SOP' : `${corpus.schemes[section.scheme]} SOP`;
  return `${name} §${section.section}`;
}

function publicSection(s, score) {
  return { id: s.id, scheme: s.scheme, schemeLabel: corpus.schemes[s.scheme], section: s.section, title: s.title, label: label(s), text: s.text, score: score == null ? undefined : Math.round(score * 100) / 100 };
}

/**
 * Retrieve the most relevant SOP sections.
 * @returns {{scheme:string|null, detected:boolean, schemeSections:object[], generalSections:object[]}}
 */
function retrieve(query, schemeInput, { k = 3, kGeneral = 1 } = {}) {
  let scheme = normalizeScheme(schemeInput);
  let detected = false;
  if (!scheme) {
    scheme = detectScheme(query);
    detected = !!scheme;
  }
  const q = tokenize(query);
  const ranked = (filter) => DOCS.filter(filter)
    .map((d) => ({ d, s: bm25(q, d) }))
    .sort((a, b) => b.s - a.s);

  let schemeSections = [];
  if (scheme) {
    const r = ranked((d) => d.scheme === scheme);
    // Keep any section that matches the query; if none score, still return the scheme's top section.
    schemeSections = r.filter((x) => x.s > 0).slice(0, k);
    if (!schemeSections.length && r.length) schemeSections = r.slice(0, 1);
    schemeSections = schemeSections.map((x) => publicSection(x.d, x.s));
  }
  const generalSections = ranked((d) => d.scheme === 'GENERAL')
    .slice(0, kGeneral)
    .map((x) => publicSection(x.d, x.s));
  return { scheme, detected, schemeSections, generalSections };
}

function sectionsById(ids) {
  return ids.map((id) => DOCS.find((d) => d.id === id)).filter(Boolean).map((d) => publicSection(d));
}

function allSections() {
  return corpus.sections.map((s) => publicSection(s));
}

module.exports = { retrieve, detectScheme, normalizeScheme, tokenize, allSections, sectionsById, label, setCorpus, resetCorpus, corpusSource, corpusNotice: FILE_CORPUS.notice, schemeNames };
