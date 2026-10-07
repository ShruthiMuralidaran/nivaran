// Small helpers shared by the API routes (work on Vercel and on the local server).
const { FRIENDLY } = require('./llm');

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

class InputError extends Error {}

function field(body, name, label, { required = true, min = 0, max = 5000 } = {}) {
  const v = body[name];
  if (v === undefined || v === null || v === '') {
    if (required) throw new InputError(`${label} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new InputError(`${label} must be text.`);
  const t = v.trim();
  if (required && t.length < min) throw new InputError(`${label} is too short (at least ${min} characters).`);
  if (t.length > max) throw new InputError(`${label} is too long (max ${max} characters).`);
  return t;
}

// Wrap a handler with method check, JSON parsing and friendly errors.
function handler(method, fn) {
  return async (req, res) => {
    if (req.method !== method) return send(res, 405, { error: 'Method not allowed.' });
    let body = {};
    if (method === 'POST') {
      try { body = await readBody(req); } catch (_) { return send(res, 400, { error: 'Request body must be valid JSON.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Request body must be a JSON object.' });
    }
    try {
      const out = await fn(body, req);
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof InputError) return send(res, 400, { error: e.message });
      const code = e.code || 'SERVER';
      const status = code === 'QUOTA' ? 429 : code === 'AUTH' || code === 'MODEL' ? 503 : code === 'BLOCKED' ? 422 : code === 'TIMEOUT' ? 504 : 502;
      // Never forward raw provider messages to the browser.
      const message = FRIENDLY[code] || 'Something went wrong on our side. Please try again.';
      if (process.env.NODE_ENV !== 'test') console.error(`[api] ${code}:`, e.message);
      return send(res, status, { error: message, code, retryable: ['QUOTA', 'UPSTREAM', 'TIMEOUT', 'NETWORK', 'BAD_OUTPUT'].includes(code) });
    }
  };
}

module.exports = { send, readBody, field, handler, InputError };
