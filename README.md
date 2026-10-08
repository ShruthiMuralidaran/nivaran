# Nivaran: AI quality layer for grievance closures

**Disposed is not the same as resolved.**

GenAI Startup Sprint

| Feature | What it does | AI used |
|---|---|---|
| **Resolution Judge** (`/judge`) | Scores one closure on 5 criteria, flags DARPG's documented failure modes with exact quotes, lists facts a supervisor should verify. One click sends a failed reply to the Copilot with the reasons it failed. | 1 LLM call + retrieval + deterministic scoring |
| **Resolution Copilot** (`/copilot`) | Drafts a reply (English or Hindi) from the officer's findings and the matching SOP, has the Judge score it, revises once if it fails. | 2 LLM calls (draft, self-check), up to 4 if a revision is needed |
| **How it works** (`/how`) | Architecture, model choice, cost calculator at 10,000 officers, measured usage from Supabase, honest limits, the SOP knowledge base | none |

Every Judge and Copilot result has a collapsed **"AI usage for this request"** line showing the real AI calls, tokens in/out, ₹ cost and time.

**Supabase** holds the SOP knowledge base (table `sop_sections`, the RAG source) and a numbers-only log of every live AI request (table `ai_runs`). The How it works page shows the measured averages live. Supabase is optional: without it Nivaran falls back to `data/sops.json` and skips logging, so anyone can rerun the project with just an AI key.

---

## 1. Quick start

| I want to... | Go to |
|---|---|
| Run it on my own computer | Section 2 |
| Know where the API keys go | Section 3 |
| Connect Supabase | Section 4 |
| Put the website online | Section 5 |
| Get the numbers for the slides | Section 6 |
| Fix a problem | Section 10 |

## 2. Run it locally

**Requirement:** Node.js 18 or newer. There are **no npm packages to install**.

1. Install Node.js once from https://nodejs.org (the **LTS** installer). Open a new terminal and check:
   ```bash
   node -v        # should print v18 or higher
   ```
2. Go into the project folder and create your key file:
   ```bash
   cd path/to/nivaran
   cp .env.example .env          # Windows: copy .env.example .env
   ```
3. Open `.env` in any text editor and fill in your keys (see section 3):
   ```
   GEMINI_API_KEY=your-gemini-key
   SUPABASE_URL=https://yourproject.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```
   Leave the two Supabase lines empty if you have not set up Supabase. `.env` is listed in `.gitignore`, so it is never uploaded to GitHub.
4. Start the app:
   ```bash
   npm start                     # or: node server.js
   ```
   The terminal prints:
   ```
   Nivaran running at http://localhost:3000
   Mode: LIVE AI (gemini · gemini-3.5-flash-lite)
   Supabase: configured (SOPs + run log)
   ```
5. Open **http://localhost:3000** in your browser. Stop the server with **Ctrl + C**.

### Live mode and demo mode

The app checks on start-up whether an AI key is connected.

| Situation | What you see | What answers come from |
|---|---|---|
| AI key found (local `.env` or Vercel) | No badge in the top bar. Terminal says `Mode: LIVE AI` | Gemini (or OpenAI) |
| No AI key found | Yellow **Demo mode** badge in the top bar. Terminal says `Mode: OFFLINE` | A simple rule-based stand-in, so every screen can still be clicked through. Each result says it is a demo estimate. |

Demo mode is a safety net, not the product. If you see the badge, the key is missing or mistyped: fix it and restart (local) or redeploy (Vercel).

## 3. Where to put the API keys

**All API keys have been removed from this folder.** Add them in one of two places:
- **Local:** the `.env` file (section 2)
- **Online:** Vercel → Project → Settings → Environment Variables (section 5)

You need **one AI key** (Gemini or OpenAI). The Supabase keys are optional.

| Variable | Required? | What to put | Where to get it |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes (or OpenAI) | Google Gemini API key (default provider). Use a key with **billing enabled**: free-tier keys hit rate limits after about 25-30 calls a minute. | https://aistudio.google.com/apikey |
| `OPENAI_API_KEY` | Alternative | OpenAI key | https://platform.openai.com/api-keys |
| `SUPABASE_URL` | Optional | Your project URL, e.g. `https://abcd.supabase.co` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Optional | The **service_role** (or "secret") key, **not** the anon key. Server-side only; it is never sent to the browser. | Supabase → Project Settings → API |
| `LLM_PROVIDER` | Optional | `gemini` or `openai`, if both keys are set | |
| `LLM_MODEL` | Optional | Defaults: `gemini-3.5-flash-lite` / `gpt-4o-mini` | |
| `USD_INR` | Optional | Exchange rate used for ₹ cost (default 96.28) | |

## 4. Set up Supabase (about 5 minutes, optional)

1. Go to https://supabase.com and open your project (or create one and wait about 2 minutes for it to start).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/setup.sql` from this folder, copy all of it, paste it into the editor and click **Run**. The last result should show **22**.
   This creates:
   - `sop_sections`: the 22 SOP sections (the RAG source)
   - `ai_runs`: the usage log
   - `ai_run_stats`: a view with the averages shown on the How it works page
   - Row Level Security on both tables with no public access. Only the server (with the service key) can read or write.
4. Left sidebar → **Table Editor**: you should see `sop_sections` with 22 rows and `ai_runs` (empty until the first AI request).
5. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and the **service_role / secret key** (`SUPABASE_SERVICE_KEY`).
6. Add both to `.env` (local) or Vercel Environment Variables (online), then restart or redeploy.
7. Check `/api/health`: `knowledgeBase.source` should be `"supabase"` and `supabase.configured` should be `true`.

If you edit `data/sops.json`, run `npm run supabase:sql` to regenerate `supabase/setup.sql`, then run it again in the SQL Editor. It is safe to re-run; rows are updated in place.

**What is stored in `ai_runs`:** feature, model, AI calls, tokens in/out, ₹ cost, score, verdict, scheme, failure-mode codes, revised, reply type, language, time, knowledge-base source, prompt version. **Never** the complaint, findings, officer reply or draft text.

**If Supabase is down or not set up,** the app keeps working: it reads the SOPs from `data/sops.json` and skips logging. Users never see an error because of Supabase.

## 5. Put the website online (Vercel)

1. Push this folder to a GitHub repo. Make sure `.env` is **not** uploaded (`.gitignore` already excludes it).
2. vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other**. Leave the build command empty (`vercel.json` sets the output folder to `public`).
4. **Environment Variables**: add `GEMINI_API_KEY`, and optionally `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
5. Click **Deploy**.
6. If the build complains about Node: **Settings → General → Node.js Version → 22.x**, then **Deployments → ⋯ → Redeploy**.
7. Open `https://<your-project>.vercel.app/api/health` and check:
   - `"mode":"live"`: the AI is connected (no Demo mode badge on the site)
   - `"source":"supabase"`: SOPs come from Supabase
   - `"configured":true`: usage logging is on
8. Run one Judge check on the site. A new row appears in Supabase → Table Editor → `ai_runs`, and the "Measured from real usage" card on How it works fills in.

Every `git push` to the repo redeploys the site automatically. After changing Environment Variables, redeploy manually.

## 6. Verify it works, and get every number for the deck

Run these in the project folder (Node.js required, section 2):

```bash
npm test            # 19 offline tests with a fake AI and fake Supabase: parsing, retries, scoring caps,
                    # quote checks, citation checks, the Copilot revision loop, Hindi, API validation,
                    # Supabase loading, fallback and run logging (no citizen text). No key needed.

npm run label-kit   # writes eval/blind_labeling_sheet.csv (28 cases, shuffled, no answers).
                    # Give it to someone who did NOT build Nivaran; they fill "your_label"
                    # (resolved / review / hollow) and save it as eval/blind_labels.csv

npm run eval        # needs the AI key in .env. Runs the Judge 3x on all 28 cases + 5 Copilot sessions
```

`npm run eval` writes:
- **`eval/deck_numbers.md`**: every figure the slides need (agreement with labels, hollow closures caught, false alarms, repeatability, attack results, Copilot calls per draft, ₹ per grievance, cost at 10,000 officers, model comparison).
- `eval/results.md`: case-by-case detail. `eval/results.json`: raw runs.

Rate limits on a free key: `CONCURRENCY=1 npm run eval` (Mac/Linux) or `$env:CONCURRENCY=1; npm run eval` (PowerShell). Quicker pass: `RUNS=1`.

The labeled set is `data/cases.js` (24 synthetic closures written by the team) plus 4 attacks in `scripts/eval-cases.js`: padded fake specifics, prompt injection, wrong-topic reply, short proof of payment.

## 7. How it works

**Retrieval (RAG).** `api/_lib/kb.js` loads the SOP knowledge base from Supabase (cached 10 minutes; falls back to `data/sops.json` if Supabase is not configured or unreachable). `api/_lib/retrieve.js` runs BM25 search over it (22 sections, 8 areas), with scheme detection when the user picks "Auto-detect". If no scheme SOP matches, the Copilot refuses to draft.

**Judge** (`api/_lib/judge.js`, `scoring.js`). The model returns five 0-100 criterion scores, failure modes with exact quotes, and facts to verify, as JSON. Today's date is supplied so past dates are not read as future. Our code then:
- drops any failure mode whose quote is not actually in the reply;
- corrects scores returned on the wrong scale;
- computes the score as the average of the criteria, with caps (wrong issue ≤ 20; any serious failure mode ≤ 59; two or more modes ≤ 39);
- sets the verdict by fixed thresholds: ≥ 70 Resolved · 40-69 Needs review · < 40 Hollow closure.

**Copilot** (`api/_lib/copilot.js`, `verify.js`): retrieve → draft (only facts from the findings, complaint and SOP; inline citations) → verify in code (every citation must exist; every deadline or amount must be cited or come from the findings; template phrases banned) → Judge self-check → if anything fails, the problems go back to the model once and the better-scoring draft is kept.

**Robustness** (`api/_lib/llm.js`, `http.js`): timeouts, automatic retries on rate limits (honours the provider's retry hint), one repair call for invalid JSON, friendly error messages (raw provider errors are never shown), input validation with proper 400s, all model output escaped before display, prompts treat complaint and reply text as data.

**Cost.** Every API response carries real token counts and ₹ cost, computed from `api/_lib/config.js`. Shown under each result ("AI usage for this request"), logged to Supabase `ai_runs` and averaged live on the How it works page, and measured across the test set by `npm run eval`.

## 8. Project structure

```
api/                 serverless routes (Vercel), also used by server.js locally
  evaluate.js        POST /api/evaluate  { complaint, response, scheme? }
  draft.js           POST /api/draft     { citizenName, complaint, findings?, scheme?, complaintId?, department?, language? }
  health.js          GET  /api/health    mode, model, pricing, knowledge-base source (no secrets)
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
server.js            local server (npm start)
Nivaran.html         single-file build of the whole app (npm run build:html)
vercel.json          Vercel config
.env.example         template for your .env file (no real keys)
```

## 9. Honest limits

- **The SOP knowledge base is illustrative**: written for this prototype, modelled on how scheme rules are structured. It is not official government text. Replace `data/sops.json` with official SOPs before any real use.
- **Test data is synthetic.**
- **The Judge reads text; it cannot check records.** It lists facts to verify rather than calling them true or false.
- **No outcome signals yet** (did the citizen re-file or appeal?). That is what would make the Judge hard to game with good-sounding text; it needs CPGRAMS data access.
- **No case-record integration.** The officer types the findings.
- **Usage log, not case records.** Supabase stores the SOPs and a numbers-only log of AI requests. No complaint or reply text is stored. Vector search (pgvector) is not used: at 22 SOP sections BM25 is fast, free and explainable; it is the plan once official SOPs run into thousands.
- Citizen text is sent to the configured AI provider. A department requiring in-country data processing would need an India-hosted model.

## 10. Troubleshooting

| You see | What it means | Fix |
|---|---|---|
| Yellow **Demo mode** badge | No AI key found | Check `GEMINI_API_KEY` in `.env` (local) or Vercel, then restart or redeploy |
| `npm: command not found` | Node.js not installed | Install from https://nodejs.org, open a new terminal |
| "The AI service is busy" | Gemini rate limit reached | Wait a few seconds and retry; use a billing-enabled key |
| "The AI service rejected the API key" | Wrong or expired key | Copy the key again from AI Studio, update it, restart or redeploy |
| `/api/health` shows `"source":"file"` | Supabase not reachable | Check `SUPABASE_URL` and that you used the **service_role** key, not the anon key; redeploy |
| How it works says "Supabase is not connected" | Supabase variables missing | Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, redeploy |
| `ai_runs` stays empty | Runs only log in live mode | Make sure the Demo mode badge is gone, then run a Judge check |
| Vercel build error about Node | Wrong Node version | Settings → General → Node.js Version → 22.x, redeploy |
