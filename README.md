# Nivaran - AI Grievance Resolution Platform
## Team True North | GenAI Startup Sprint

### What this is
AI-powered platform that helps government officers write better grievance responses (Copilot) and evaluates whether closed complaints were genuinely resolved (Judge).

### Tech Stack
- Frontend: HTML + Tailwind CSS (no build step)
- Backend: Vercel Serverless Functions (Node.js)
- Database: Supabase (SOP document storage and retrieval)
- AI Model: Google Gemini 2.0 Flash Lite
- Pattern: Retrieval-Augmented Generation (RAG)

### Architecture
```
Officer enters complaint
    |
    v
Vercel Serverless Function
    |
    +---> Supabase: retrieve matching SOPs (keyword search on scheme)
    |
    +---> Gemini 2.0 Flash Lite: generate/evaluate with SOP context
    |         - Temperature: 0 (deterministic output)
    |         - Scoring: computed in code, not by the model
    |         - Verdict thresholds: >=70 Resolved, 40-69 Likely Hollow, <40 Definitely Hollow
    |
    v
Response with citations + cost metrics
```

### Setup

1. **Supabase**: Create project, run `supabase-setup.sql` in SQL Editor
2. **GitHub**: Push this repo
3. **Vercel**: Import repo, add environment variables:
   - `SUPABASE_URL` (from Supabase > Settings > API)
   - `SUPABASE_ANON_KEY` (from Supabase > Settings > API)
   - `GEMINI_API_KEY` (from aistudio.google.com)

### Cost per session
- Currently on Gemini free tier (zero cost, 15 RPM, 1500 req/day)
- Paid tier: ~Rs 0.01-0.03 per session
- At 10,000 users/month: Rs 500-900/month

### Safety measures
- No draft generated without retrieved SOP documents
- All scores computed in code using fixed thresholds, not by the model
- Input validation on all fields (length limits, required fields)
- Retry logic on model failures
- Failure modes restricted to 5 known DARPG-documented patterns

### File Structure
```
index.html              Dashboard / landing page
copilot.html            Resolution Copilot (RAG-powered draft generation)
judge.html              Resolution Judge (AI quality evaluation)
api/
  generate-draft.js     Serverless: Supabase retrieval + Gemini draft
  evaluate.js           Serverless: Supabase retrieval + Gemini evaluation
vercel.json             Vercel routing config
supabase-setup.sql      Database schema + 8 government SOPs
README.md               This file (API keys go in Vercel env vars, not here)
```
