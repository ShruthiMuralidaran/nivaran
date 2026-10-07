// Supabase (PostgREST over HTTPS, no npm package). Used for two things:
//   1. the SOP knowledge base (table sop_sections), with data/sops.json as the fallback
//   2. a log of every AI request (table ai_runs): tokens, cost, verdict, time. No citizen text is stored.
// Everything here is optional: if SUPABASE_URL / SUPABASE_SERVICE_KEY are not set, or Supabase is down,
// Nivaran keeps working from the local file and simply skips logging.

function config() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

function enabled() {
  return !!config();
}

function headers(key, extra = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // Legacy service_role keys are JWTs and also go in Authorization; new "sb_secret_" keys only need apikey.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function request(path, { method = 'GET', body, timeoutMs = 4000, prefer } = {}) {
  const c = config();
  if (!c) throw new Error('Supabase not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.url}/rest/v1/${path}`, {
      method,
      headers: headers(c.key, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 1. SOP knowledge base ----------
async function fetchSopSections() {
  const rows = await request('sop_sections?select=id,scheme,scheme_label,section,title,text,keywords&order=sort_order.asc');
  if (!Array.isArray(rows) || !rows.length) throw new Error('sop_sections is empty');
  return rows;
}

// ---------- 2. AI run log ----------
// Awaited with a short timeout so it finishes on serverless platforms, but never throws.
async function logRun(row) {
  if (!enabled()) return false;
  try {
    await request('ai_runs', { method: 'POST', body: row, timeoutMs: 1500, prefer: 'return=minimal' });
    return true;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') console.warn('[supabase] run not logged:', e.message);
    return false;
  }
}

async function fetchStats() {
  return request('ai_run_stats?select=*');
}

module.exports = { enabled, fetchSopSections, logRun, fetchStats };
