// Provider-agnostic LLM call with JSON output, retries, timeouts and token accounting.
const { getProvider, getModel, costInr } = require('./config');

class LLMError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY = {
  QUOTA: 'The AI service is busy (rate limit reached). Please wait a few seconds and try again.',
  AUTH: 'The AI service rejected the API key. Check the key in your environment settings.',
  MODEL: 'The configured AI model was not found. Check LLM_MODEL in your environment settings.',
  BAD_OUTPUT: 'The AI returned an answer we could not read. Please try again.',
  BLOCKED: 'The AI declined to answer this input. Try rephrasing it.',
  TIMEOUT: 'The AI took too long to answer. Please try again.',
  NETWORK: 'Could not reach the AI service. Check your internet connection and try again.',
  UPSTREAM: 'The AI service had a temporary error. Please try again.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { /* fall through */ }
  }
  return null;
}

function retryDelayMs(status, headers, bodyText, attempt) {
  // Honour Retry-After or Gemini's retryDelay hint, capped so we stay inside the function time limit.
  let hint = 0;
  const ra = headers && headers.get && headers.get('retry-after');
  if (ra && !Number.isNaN(Number(ra))) hint = Number(ra) * 1000;
  const m = bodyText && bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) hint = Number(m[1]) * 1000;
  const backoff = [1500, 4000, 8000][attempt] || 8000;
  return Math.min(Math.max(hint, backoff), 9000);
}

async function httpJson(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new LLMError('TIMEOUT', FRIENDLY.TIMEOUT);
    throw new LLMError('NETWORK', FRIENDLY.NETWORK);
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(status) {
  if (status === 429) return 'QUOTA';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 404) return 'MODEL';
  if (status >= 500) return 'UPSTREAM';
  return 'UPSTREAM';
}

async function callGemini({ system, user, model, temperature, maxOutputTokens, timeoutMs }) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json' },
  };
  const { res, text } = await httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) return { ok: false, status: res.status, headers: res.headers, text };
  let data;
  try { data = JSON.parse(text); } catch (_) { return { ok: false, status: 502, text }; }
  const cand = (data.candidates || [])[0];
  if (!cand) {
    const blocked = data.promptFeedback && data.promptFeedback.blockReason;
    return { ok: false, status: blocked ? 400 : 502, blocked: !!blocked, text };
  }
  const out = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  const u = data.usageMetadata || {};
  return {
    ok: true,
    text: out,
    finishReason: cand.finishReason,
    usage: {
      input: u.promptTokenCount || 0,
      output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
      thinking: u.thoughtsTokenCount || 0,
    },
  };
}

async function callOpenAI({ system, user, model, temperature, maxOutputTokens, timeoutMs }) {
  const { res, text } = await httpJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature,
      max_completion_tokens: maxOutputTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }, timeoutMs);
  if (!res.ok) return { ok: false, status: res.status, headers: res.headers, text };
  let data;
  try { data = JSON.parse(text); } catch (_) { return { ok: false, status: 502, text }; }
  const choice = (data.choices || [])[0];
  const u = data.usage || {};
  return {
    ok: true,
    text: choice && choice.message ? choice.message.content : '',
    finishReason: choice && choice.finish_reason,
    usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, thinking: 0 },
  };
}

/**
 * Call the configured LLM and return parsed JSON.
 * @returns {Promise<{json:object, usage:{input:number,output:number,thinking:number}, model:string, provider:string, ms:number, attempts:number, costInr:number|null}>}
 */
async function callJSON({ system, user, temperature = 0, maxOutputTokens = 1200, timeoutMs = 25000, maxAttempts = 3 }) {
  const provider = getProvider();
  if (provider === 'offline') throw new LLMError('OFFLINE', 'No API key configured.');
  const model = getModel(provider);
  const call = provider === 'gemini' ? callGemini : callOpenAI;
  const started = Date.now();
  const usage = { input: 0, output: 0, thinking: 0 };
  let lastErr = null;
  let repairNote = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await call({ system, user: user + repairNote, model, temperature, maxOutputTokens, timeoutMs }).catch((e) => {
      lastErr = e;
      return null;
    });
    if (!r) {
      if (attempt < maxAttempts - 1 && lastErr && (lastErr.code === 'TIMEOUT' || lastErr.code === 'NETWORK')) {
        await sleep(1000);
        continue;
      }
      throw lastErr;
    }
    if (!r.ok) {
      if (r.blocked) throw new LLMError('BLOCKED', FRIENDLY.BLOCKED, 400);
      const code = classifyStatus(r.status);
      lastErr = new LLMError(code, FRIENDLY[code], r.status);
      const retryable = code === 'QUOTA' || code === 'UPSTREAM';
      if (retryable && attempt < maxAttempts - 1) {
        await sleep(retryDelayMs(r.status, r.headers, r.text, attempt));
        continue;
      }
      throw lastErr;
    }
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    usage.thinking += r.usage.thinking;
    const json = extractJson(r.text);
    if (json && typeof json === 'object') {
      return { json, usage, model, provider, ms: Date.now() - started, attempts: attempt + 1, costInr: costInr(model, usage.input, usage.output) };
    }
    lastErr = new LLMError('BAD_OUTPUT', FRIENDLY.BAD_OUTPUT, 502);
    repairNote = '\n\nIMPORTANT: Your previous answer was not valid JSON. Reply with ONLY one valid JSON object, no prose, no code fences.';
  }
  throw lastErr || new LLMError('BAD_OUTPUT', FRIENDLY.BAD_OUTPUT, 502);
}

module.exports = { callJSON, extractJson, LLMError, FRIENDLY };
