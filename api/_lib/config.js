// Central configuration: provider, model, pricing and exchange rate.
// Change the model or prices HERE only; every cost shown in the app is computed from this file.

const DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash-lite',
  openai: 'gpt-4o-mini',
};

// USD per 1M tokens (list prices checked October 2026; update if they change).
const PRICING_USD_PER_M = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-5.6-luna': { input: 0.20, output: 1.20 },
};

const PRICES_AS_OF = 'Oct 2026';

function getProvider() {
  const forced = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (forced === 'offline') return 'offline';
  if (forced === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (forced === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'offline';
}

function getModel(provider = getProvider()) {
  if (provider === 'offline') return 'offline-rules';
  return (process.env.LLM_MODEL || '').trim() || DEFAULT_MODELS[provider];
}

function usdToInr() {
  const v = Number(process.env.USD_INR);
  return Number.isFinite(v) && v > 0 ? v : 96.28;
}

function priceFor(model) {
  return PRICING_USD_PER_M[model] || null;
}

// Thinking tokens (if the model reports them) are billed as output.
function costInr(model, inputTokens = 0, outputTokens = 0) {
  const p = priceFor(model);
  if (!p) return null;
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1e6;
  return Math.round(usd * usdToInr() * 10000) / 10000;
}

function publicConfig() {
  const provider = getProvider();
  const model = getModel(provider);
  return {
    mode: provider === 'offline' ? 'offline' : 'live',
    provider,
    model,
    price: priceFor(model),
    usdInr: usdToInr(),
    pricesAsOf: PRICES_AS_OF,
    pricing: PRICING_USD_PER_M,
  };
}

module.exports = { getProvider, getModel, priceFor, costInr, usdToInr, publicConfig, PRICING_USD_PER_M, PRICES_AS_OF };
