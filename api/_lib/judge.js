// Resolution Judge: retrieve SOPs -> model scores criteria + failure modes with evidence -> code checks and scores.
const { retrieve, schemeNames } = require('./retrieve');
const { callJSON, LLMError } = require('./llm');
const { judgeSystem, judgeUser, PROMPT_VERSION } = require('./prompts');
const { finalize } = require('./scoring');
const { judgeRaw } = require('./offline');
const { getProvider, getModel } = require('./config');
const { todayIST } = require('./today');
const { ensureKnowledgeBase } = require('./kb');

async function judge({ complaint, response, scheme }) {
  const started = Date.now();
  const kbSource = await ensureKnowledgeBase();
  const r = retrieve(`${complaint}\n${response}`, scheme, { k: 3, kGeneral: 1 });
  const sections = [...r.schemeSections, ...r.generalSections];
  const schemeLabel = r.scheme ? schemeNames[r.scheme] : null;
  const provider = getProvider();
  const today = todayIST();

  let raw;
  let usage = { input: 0, output: 0, thinking: 0 };
  let costInr = 0;
  let attempts = 1;
  if (provider === 'offline') {
    raw = judgeRaw({ complaint, response });
  } else {
    const out = await callJSON({
      system: judgeSystem(today),
      user: judgeUser({ complaint, response, schemeLabel, sections }),
      maxOutputTokens: 900,
    });
    raw = out.json;
    usage = out.usage;
    costInr = out.costInr;
    attempts = out.attempts;
  }

  let result;
  try {
    result = finalize(raw, response);
  } catch (e) {
    throw new LLMError('BAD_OUTPUT', 'The AI returned an incomplete evaluation. Please try again.', 502);
  }

  return {
    ...result,
    scheme: r.scheme,
    schemeLabel,
    schemeDetected: r.detected,
    kbSource,
    sources: sections.map(({ id, label, title, scheme: s }) => ({ id, label, title, scheme: s })),
    usage,
    costInr,
    attempts,
    model: getModel(provider),
    mode: provider === 'offline' ? 'offline' : 'live',
    promptVersion: PROMPT_VERSION,
    today,
    ms: Date.now() - started,
  };
}

module.exports = { judge };

