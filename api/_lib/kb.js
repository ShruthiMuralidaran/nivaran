// Loads the SOP knowledge base from Supabase (table sop_sections) when configured.
// Cached for 10 minutes per server instance. On any failure the built-in data/sops.json stays in use,
// and the next attempt waits 1 minute so a Supabase outage never slows every request down.
const supabase = require('./supabase');
const { setCorpus, resetCorpus, corpusSource } = require('./retrieve');

const TTL_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
let loadedAt = 0;
let failedAt = 0;
let lastError = null;
let pending = null;

function rowsToCorpus(rows) {
  const schemes = {};
  const sections = rows.map((r) => {
    schemes[r.scheme] = r.scheme_label || r.scheme;
    return {
      id: String(r.id),
      scheme: String(r.scheme),
      section: String(r.section),
      title: String(r.title || ''),
      text: String(r.text || ''),
      keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
    };
  });
  return { schemes, sections };
}

async function load() {
  try {
    const rows = await supabase.fetchSopSections();
    const ok = setCorpus(rowsToCorpus(rows), 'supabase');
    if (!ok) throw new Error('sop_sections rows were not usable');
    loadedAt = Date.now();
    lastError = null;
  } catch (e) {
    failedAt = Date.now();
    lastError = e.message;
    if (corpusSource() !== 'file') resetCorpus();
    if (process.env.NODE_ENV !== 'test') console.warn('[kb] using data/sops.json:', e.message);
  }
}

// Call before retrieval. Never throws.
async function ensureKnowledgeBase() {
  if (!supabase.enabled()) {
    if (corpusSource() !== 'file') resetCorpus();
    return corpusSource();
  }
  const now = Date.now();
  const fresh = corpusSource() === 'supabase' && now - loadedAt < TTL_MS;
  const coolingDown = now - failedAt < RETRY_MS;
  if (fresh || coolingDown) return corpusSource();
  if (!pending) pending = load().finally(() => { pending = null; });
  await pending;
  return corpusSource();
}

function kbStatus() {
  return { source: corpusSource(), supabaseConfigured: supabase.enabled(), lastError };
}

// For tests.
function _reset() { loadedAt = 0; failedAt = 0; lastError = null; pending = null; resetCorpus(); }

module.exports = { ensureKnowledgeBase, kbStatus, _reset };
