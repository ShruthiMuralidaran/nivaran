# Nivaran: AI quality layer for grievance closures

**Disposed is not the same as resolved.** Nivaran checks whether a government grievance closure (the officer's Action Taken Report) actually resolves the citizen's complaint, and helps officers write replies that do.

GenAI Startup Sprint

| Feature | What it does | AI used |
|---|---|---|
| **Resolution Judge** (`/judge`) | Scores one closure on 5 criteria, flags DARPG's documented failure modes with exact quotes, lists facts a supervisor should verify. One click sends a failed reply to the Copilot with the reasons it failed. | 1 LLM call + retrieval + deterministic scoring |
| **Resolution Copilot** (`/copilot`) | Drafts a reply (English or Hindi) from the officer's findings and the matching SOP, verifies every citation and figure, has the Judge score it, revises once if it fails. | 2 LLM calls (draft, self-check), up to 4 if a revision is needed |
| **How it works** (`/how`) | Architecture, model choice, cost calculator at 10,000 officers, honest limits, the SOP knowledge base | none |

Every Judge and Copilot result has a collapsed **"AI usage for this request"** line showing the real AI calls, tokens in/out, ₹ cost and time.

**Supabase** holds the SOP knowledge base (table `sop_sections`, the RAG source) and a numbers-only log of every live AI request (table `ai_runs`). The How it works page shows the measured averages live. Supabase is optional: without it Nivaran falls back to `data/sops.json` and skips logging, so anyone can rerun the project with just an AI key.

---

## 0. Fastest: open `Nivaran.html`

`Nivaran.html` is the whole app in one file. **Double-click it** (Chrome or Edge). No Node, no server, no install.

1. Click **⚙ Settings** at the top right (a yellow "Demo mode" badge shows there until a key is added).
2. Pick Google Gemini (or OpenAI), paste your key, tick "Remember" if you like, press **Save & test**. You should see "✔ Connected".
3. Use Judge and Copilot as normal.

The key is stored only in your browser and sent only to Google/OpenAI. It is never written into the file, so `Nivaran.html` is safe to share or submit. It runs the same code as the server version (`npm run build:html` regenerates it).

## 1. Run locally (2 minutes)

Requirements: **Node.js 18 or newer** (`node -v`). There are **no npm packages to install**.

```bash
cd nivaran
cp .env.example .env          # Windows: copy .env.example .env
# open .env and paste ONE API key (see section 2)
npm start                     # or: node server.js
```

Open **http://localhost:3000**. The terminal prints whether it is running in **LIVE AI** or **OFFLINE** mode.

Without a key the app still runs in **offline demo mode**: a rule-based stand-in replaces the AI so every screen can be clicked through. The UI labels this clearly. It is not the product; add a key for the real thing.

## 2. Where to put the API keys

**All API keys have been removed from this folder.** Put **one** of these in `.env` (local) or in Vercel → Project → Settings → Environment Variables (deployed):

| Variable | What to put | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key (default provider). Use a key with **billing enabled**: free-tier keys hit rate limits after ~25-30 calls a minute. | https://aistudio.google.com/apikey |
| `OPENAI_API_KEY` | OpenAI key (alternative) | https://platform.openai.com/api-keys |
| `LLM_PROVIDER` | optional: `gemini`, `openai` or `offline` | |
| `LLM_MODEL` | optional. Defaults: `gemini-3.5-flash-lite` / `gpt-4o-mini` | |
| `USD_INR` | optional: exchange rate for cost (default 96.28) | |
| `SUPABASE_URL` | optional: your project URL, e.g. `https://abcd.supabase.co` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | optional: the **service role / secret** key. Server-side only; it is never sent to the browser. | Supabase → Project Settings → API |

## 2b. Set up Supabase (5 minutes, optional)

1. Supabase dashboard → **SQL Editor** → New query → paste all of `supabase/setup.sql` → **Run**. The last line should show `22`.
   This creates `sop_sections` (loaded with the 22 SOPs), `ai_runs` (the usage log), the `ai_run_stats` view, and turns on Row Level Security with no public access.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to `.env` (local) or Vercel Environment Variables, then redeploy.
3. Check `/api/health`: `knowledgeBase.source` should be `"supabase"` and `supabase.configured` `true`.

If you edit `data/sops.json`, run `npm run supabase:sql` to regenerate `supabase/setup.sql`, then run it again (it is safe to re-run; rows are updated in place).

What is stored in `ai_runs`: feature, model, AI calls, tokens in/out, ₹ cost, score, verdict, scheme, failure-mode codes, revised, reply type, language, time, knowledge-base source, prompt version. **Never** the complaint, findings, officer reply or draft text.

## 3. Deploy to Vercel

1. Push this folder to a GitHub repo (`.gitignore` keeps `.env` out).
2. vercel.com → **Add New Project** → import the repo → Framework preset **Other**. No build command (`vercel.json` sets the output folder to `public`). Node.js version: 20.x or 22.x.
3. Add `GEMINI_API_KEY` (or `OPENAI_API_KEY`) under Environment Variables → **Deploy**.
4. Open `https://<your-project>.vercel.app/api/health`: it should say `"mode":"live"`.

## 4. Verify it works, and get every number for the deck

```bash
npm test            # 19 offline tests with a fake AI and fake Supabase: parsing, retries, scoring caps,
                    # quote checks, citation checks, the Copilot revision loop, Hindi, API validation,
                    # Supabase loading, fallback and run logging (no citizen text). No key needed.

npm run label-kit   # writes eval/blind_labeling_sheet.csv (28 cases, shuffled, no answers).
                    # Give it to someone who did NOT build Nivaran; they fill "your_label"
                    # (resolved / review / hollow) and save it as eval/blind_labels.csv

npm run eval        # needs the API key in .env. Runs the Judge 3x on all 28 cases + 5 Copilot sessions
```

`npm run eval` writes:
- **`eval/deck_numbers.md`**: every figure the slides need (agreement with labels, hollow closures caught, false alarms, repeatability, attack results, Copilot calls per draft, ₹ per grievance, cost at 10,000 officers, model comparison).
- `eval/results.md`: case-by-case detail. `eval/results.json`: raw runs.

Rate limits on a free key: `CONCURRENCY=1 npm run eval` (Mac/Linux) or `$env:CONCURRENCY=1; npm run eval` (PowerShell). Quicker pass: `RUNS=1`.

The labeled set is `data/cases.js` (24 synthetic closures written by the team) plus 4 attacks in `scripts/eval-cases.js`: padded fake specifics, prompt injection, wrong-topic reply, short proof of payment.

## 5. How it works

**Retrieval (RAG).** `api/_lib/kb.js` loads the SOP knowledge base from Supabase (cached 10 minutes; falls back to `data/sops.json` if Supabase is not configured or unreachable). `api/_lib/retrieve.js` runs BM25 search over it (22 sections, 8 areas), with scheme detection when the user picks "Auto-detect". If no scheme SOP matches, the Copilot refuses to draft.

**Judge** (`api/_lib/judge.js`, `scoring.js`). The model returns five 0-100 criterion scores, failure modes with exact quotes, and facts to verify, as JSON. Today's date is supplied so past dates are not read as future. Our code then:
- drops any failure mode whose quote is not actually in the reply;
- corrects scores returned on the wrong scale;
- computes the score as the average of the criteria, with caps (wrong issue ≤ 20; any serious failure mode ≤ 59; two or more modes ≤ 39);
- sets the verdict by fixed thresholds: ≥ 70 Resolved · 40-69 Needs review · < 40 Hollow closure.

**Copilot** (`api/_lib/copilot.js`, `verify.js`): retrieve → draft (only facts from the findings, complaint and SOP; inline citations) → verify in code (every citation must exist; every deadline or amount must be cited or come from the findings; template phrases banned) → Judge self-check → if anything fails, the problems go back to the model once and the better-scoring draft is kept.

**Robustness** (`api/_lib/llm.js`, `http.js`): timeouts, automatic retries on rate limits (honours the provider's retry hint), one repair call for invalid JSON, friendly error messages (raw provider errors are never shown), input validation with proper 400s, all model output escaped before display, prompts treat complaint and reply text as data (prompt-injection resistant).

**Cost.** Every API response carries real token counts and ₹ cost, computed from `api/_lib/config.js`. Shown under each result ("AI usage for this request"), logged to Supabase `ai_runs` and averaged live on the How it works page, and measured across the test set by `npm run eval`.

## 6. Project structure

```
api/                 serverless routes (Vercel), also used by server.js locally
  evaluate.js        POST /api/evaluate  { complaint, response, scheme? }
  draft.js           POST /api/draft     { citizenName, complaint, findings?, scheme?, complaintId?, department?, language? }
  health.js          GET  /api/health    mode, model, pricing (no secrets)
  sops.js            GET  /api/sops      the knowledge base (How it works page)
  stats.js           GET  /api/stats     usage averages from Supabase ai_runs (How it works page)
  _lib/              config, llm, retrieve, kb, supabase, prompts, judge, scoring, copilot, verify, offline, today, http
supabase/setup.sql   tables, security and the 22 SOPs: paste into the Supabase SQL Editor
data/sops.json       SOP knowledge base (illustrative, see below)
data/cases.js        labeled test set
data/copilot_cases.js  Copilot sessions measured by the eval
public/              web app (HTML/CSS/JS, no build step): Home, Judge, Copilot, How it works
scripts/             selftest, eval, eval-cases, label-kit, build-standalone, make-supabase-sql, env
eval/                blind labeling sheet; eval outputs land here
server.js            local server (node server.js)
Nivaran.html         single-file build of the whole app (npm run build:html)
vercel.json          Vercel config
.env.example         where the keys go
```

## 7. Honest limits

- **The SOP knowledge base is illustrative**: written for this prototype, modelled on how scheme rules are structured. It is not official government text. Replace `data/sops.json` with official SOPs before any real use.
- **Test data is synthetic.** No real citizen data is used anywhere.
- **The Judge reads text; it cannot check records.** It lists facts to verify rather than calling them true or false.
- **No outcome signals yet** (did the citizen re-file or appeal?). That is what would make the Judge hard to game with good-sounding text; it needs CPGRAMS data access.
- **No case-record integration.** The officer types the findings.
- **Usage log, not case records.** Supabase stores the SOPs and a numbers-only log of AI requests. No complaint or reply text is stored. Vector search (pgvector) is not used: at 22 SOP sections BM25 is fast, free and explainable; it is the plan once official SOPs run into thousands.
- Citizen text is sent to the configured AI provider. A department requiring in-country data processing would need an India-hosted model.
