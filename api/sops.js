// GET /api/sops -> the full SOP knowledge base (for the knowledge-base section of the How it works page).
const { handler } = require('./_lib/http');
const { allSections, corpusNotice, schemeNames } = require('./_lib/retrieve');
const { ensureKnowledgeBase } = require('./_lib/kb');

module.exports = handler('GET', async () => {
  const source = await ensureKnowledgeBase();
  return { source, notice: corpusNotice, schemes: schemeNames, sections: allSections() };
});
