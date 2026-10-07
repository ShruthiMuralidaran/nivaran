// Writes supabase/setup.sql from data/sops.json (tables, security, stats view, SOP rows).
//   Run: npm run supabase:sql   then paste supabase/setup.sql into Supabase -> SQL Editor -> Run
const fs = require('fs');
const path = require('path');
const kb = require('../data/sops.json');

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const arr = (a) => `ARRAY[${(a || []).map(q).join(', ')}]::text[]`;
const rows = kb.sections.map((s, i) => `  (${q(s.id)}, ${q(s.scheme)}, ${q(kb.schemes[s.scheme] || s.scheme)}, ${q(s.section)}, ${q(s.title)}, ${q(s.text)}, ${arr(s.keywords)}, ${i + 1})`);

const sql = `-- Nivaran · Supabase setup. Safe to run more than once.
-- Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Generated from data/sops.json by: npm run supabase:sql

-- 1. SOP knowledge base (the RAG source) -------------------------------------
create table if not exists public.sop_sections (
  id           text primary key,
  scheme       text not null,
  scheme_label text not null,
  section      text not null,
  title        text not null,
  text         text not null,
  keywords     text[] not null default '{}',
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now()
);

-- 2. Log of every live AI request: numbers only, no citizen text --------------
create table if not exists public.ai_runs (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  feature        text not null check (feature in ('judge', 'copilot')),
  model          text,
  ai_calls       int,
  tokens_in      int,
  tokens_out     int,
  cost_inr       numeric(10,4),
  score          int,
  verdict        text,
  scheme         text,
  failure_modes  text[],
  revised        boolean,
  reply_type     text,
  language       text,
  latency_ms     int,
  kb_source      text,
  prompt_version text
);
create index if not exists ai_runs_created_at_idx on public.ai_runs (created_at desc);

-- 3. Security: Row Level Security on, no public policies.
--    Only the server (service key, kept in Vercel env vars) can read or write. The browser never talks to Supabase.
alter table public.sop_sections enable row level security;
alter table public.ai_runs enable row level security;

-- 4. Usage summary read by the How it works page ------------------------------
create or replace view public.ai_run_stats with (security_invoker = true) as
select
  feature,
  count(*)::int                                                as runs,
  round(avg(cost_inr), 4)                                      as avg_cost_inr,
  round(avg(tokens_in))::int                                   as avg_tokens_in,
  round(avg(tokens_out))::int                                  as avg_tokens_out,
  round(avg(ai_calls), 2)                                      as avg_ai_calls,
  round(avg(latency_ms))::int                                  as avg_latency_ms,
  round(avg(score))::int                                       as avg_score,
  round(100.0 * avg((verdict = 'hollow')::int), 1)             as pct_hollow,
  round(100.0 * avg((verdict = 'resolved')::int), 1)           as pct_resolved,
  round(100.0 * avg(coalesce(revised, false)::int), 1)         as pct_revised,
  round(sum(cost_inr), 2)                                      as total_cost_inr,
  min(created_at)                                              as first_run,
  max(created_at)                                              as last_run
from public.ai_runs
group by feature;

-- 5. Load the ${kb.sections.length} SOP sections ------------------------------------------------
insert into public.sop_sections (id, scheme, scheme_label, section, title, text, keywords, sort_order) values
${rows.join(',\n')}
on conflict (id) do update set
  scheme = excluded.scheme, scheme_label = excluded.scheme_label, section = excluded.section,
  title = excluded.title, text = excluded.text, keywords = excluded.keywords,
  sort_order = excluded.sort_order, updated_at = now();

-- Check: should return ${kb.sections.length}
select count(*) as sop_sections_loaded from public.sop_sections;
`;
const out = path.join(__dirname, '..', 'supabase', 'setup.sql');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sql);
console.log(`Wrote ${out} (${kb.sections.length} SOP sections)`);
