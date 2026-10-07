// GET /api/health  -> mode, model, pricing and knowledge-base summary (no secrets).
const { handler } = require('./_lib/http');
const { publicConfig } = require('./_lib/config');
const { allSections, corpusNotice, schemeNames } = require('./_lib/retrieve');
const { PROMPT_VERSION } = require('./_lib/prompts');
const { SCORING_RULE } = require('./_lib/scoring');
const { todayIST } = require('./_lib/today');
const { ensureKnowledgeBase, kbStatus } = require('./_lib/kb');

module.exports = handler('GET', async () => {
  await ensureKnowledgeBase();
  const kb = kbStatus();
  const sections = allSections();
  return {
    ok: true,
    ...publicConfig(),
    promptVersion: PROMPT_VERSION,
    scoringRule: SCORING_RULE,
    today: todayIST(),
    knowledgeBase: { source: kb.source, notice: corpusNotice, schemes: schemeNames, sectionCount: sections.length },
    supabase: { configured: kb.supabaseConfigured, loggingRuns: kb.supabaseConfigured },
  };
});
