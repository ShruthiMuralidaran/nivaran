# Nivaran - AI Grievance Resolution Quality Platform

AI-powered platform that evaluates government grievance responses and generates policy-grounded drafts.

## Setup (No terminal needed - everything in browser)

### Step 1: Supabase Setup
1. Go to [supabase.com](https://supabase.com) and open your project
2. Go to **SQL Editor** → **New Query**
3. Paste the contents of `supabase-setup.sql` and click **Run**
4. Verify in **Table Editor** that `sop_documents` table has 8 rows

### Step 2: Deploy to Vercel
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import this repo
3. In **Environment Variables**, add:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon key
   - `OPENAI_API_KEY` = your OpenAI API key
4. Click **Deploy**

### Step 3: Test
- Visit your Vercel URL
- Go to `/copilot.html` → Generate a draft
- Go to `/judge.html` → Evaluate a response

## Architecture
```
User → Vercel (static HTML) → /api/generate-draft or /api/evaluate
                                    ↓
                              Supabase (retrieve SOPs)
                                    ↓
                              OpenAI GPT-4o-mini (generate/evaluate)
                                    ↓
                              Response with citations + cost
```

## Cost
- Per session: ~Rs 0.05 (5 paise)
- At 10,000 users/month: ~Rs 1,500/month

## Tech Stack
- Frontend: HTML + Tailwind CSS (CDN)
- Backend: Vercel Serverless Functions
- Database: Supabase (PostgreSQL)
- AI: OpenAI GPT-4o-mini

## API Keys
Replace these in Vercel Environment Variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
