# TTAgent (Threads Agent)

AI pipeline that studies successful Threads creators, learns their style, generates
new posts/threads in that style, and schedules them to your own Threads account.

## Architecture

```
Next.js (App Router)
├─ app/                 UI + Route Handlers (API routes live under app/api/*)
├─ lib/supabase/         Supabase client (browser), server client, middleware (session refresh)
├─ lib/anthropic/        Claude API wrapper (to add in Module 2/3)
├─ lib/threads/           Scraper client + official Threads Publishing API client (to add in Module 1/4)
└─ supabase/migrations/   SQL schema, versioned in git, applied via Supabase CLI

Supabase (Postgres + Auth + RLS)
├─ auth.users             Supabase Auth — you log in as the admin/user
├─ creators               Threads accounts you track
├─ scraped_threads        raw posts pulled per creator
├─ creator_analysis        Claude's style profile per creator
└─ scheduled_posts        generated drafts, queued and posted
```

**Data flow across the four modules:**

1. **Tracker/Scraper** — you add a `creators` row, a scraper job (RapidAPI or similar) fetches recent posts, writes rows into `scraped_threads`.
2. **Style Analyzer** — you pick a creator, review their `scraped_threads`, hit "Analyze," Claude reads a batch of posts and writes a structured profile into `creator_analysis` (including a `generated_rules` field — a condensed style guide used as the system prompt for generation).
3. **Content Generator** — you pick a creator profile + a topic/intent, Claude drafts a single post or thread chain using `generated_rules` as style guidance, you edit/approve, it's saved into `scheduled_posts` with `status = 'draft'`.
4. **Scheduler/Auto-Poster** — once you set a `schedule_time` and flip `status` to `scheduled`, a cron job (Vercel Cron / Supabase Edge Function on a schedule) picks up due posts and calls the official Threads Publishing API, then updates `status`/`threads_post_id`.

Row Level Security scopes every table to your `auth.uid()`, either directly
(`creators`, `scheduled_posts`) or via the parent `creators` row
(`scraped_threads`, `creator_analysis`) — so this is safe to run multi-user later,
even though you'll likely be the only user for now.

## Step 1 deliverable (this scaffold)

- `supabase/migrations/0001_init_schema.sql` — the four core tables + RLS policies + indexes + `updated_at` triggers.
- A minimal Next.js 14 (App Router) + Tailwind + shadcn-ready project shell.
- Supabase client/server/middleware helpers wired for the `@supabase/ssr` auth pattern.
- `.env.example` listing every credential you'll need across all four modules.

Nothing beyond the shell page is built yet — Modules 1-4 come next, one at a time.

## Setup from scratch

### 1. Prerequisites
- Node.js 20+ and npm
- A Supabase account (https://supabase.com) — free tier is enough to start
- An Anthropic API key (https://console.anthropic.com)
- (Later, Module 4) A Meta Developer account with a Threads API app

### 2. Git
```bash
cd ttagent
git init
git add .
git commit -m "chore: initial TTAgent scaffold (Next.js + Supabase schema)"
```

### 3. Install dependencies
```bash
npm install
```

### 4. Create the Supabase project
1. In the Supabase dashboard, create a new project.
2. Grab **Project URL** and **anon public key** from Settings → API — these go in `.env.local`.
3. Grab the **service_role key** too (Settings → API) — server-only, used later for scraper/cron jobs that bypass RLS. Never expose it to the client.

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
```

### 5. Apply the schema
Easiest path — paste-and-run:
1. Open Supabase dashboard → SQL Editor.
2. Paste the contents of `supabase/migrations/0001_init_schema.sql`.
3. Run it.

Or, with the Supabase CLI (recommended once you're iterating on migrations):
```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### 6. Auth is wired up — create your account
Supabase Auth → Providers → make sure **Email** is enabled (it is by default).
The app itself now has real login/logout:

- `/login` — email/password sign in and sign up (same form, two buttons).
- `/dashboard` — protected by `middleware.ts`; anonymous requests get
  redirected to `/login`, and logged-in users hitting `/login` get bounced to
  `/dashboard`.
- `/` — redirects to whichever of the two applies.

To create your admin account, run the app (`npm run dev` or visit the
deployed URL) and use the **Sign up** button on `/login` once.

Check **Supabase Auth → Providers → Email → Confirm email**:
- **Off** (default on new projects until you change it) — sign up logs you in
  immediately.
- **On** — sign up sends a confirmation email; you must click it before
  `signInWithPassword` will succeed. Either is fine for a single-operator
  tool; turn confirmation off if you want zero friction.

Native Threads/Meta OAuth is a separate, heavier flow (Meta app review, Threads
API scopes) — that's tied to Module 4 (posting), not login. Supabase email
auth gates the dashboard; the Threads Graph API credentials are connected
separately for posting.

### 7. Run it
```bash
npm run dev
```
Visit http://localhost:3000.

## Deploying to Railway

This scaffold is Railway-ready: `railway.json` pins the Nixpacks builder,
`.node-version` pins Node 20, and `npm start` binds to Railway's injected
`$PORT`. Using the GitHub + dashboard flow (auto-deploys on every push):

### 1. Push to GitHub
```bash
cd ttagent
gh repo create ttagent --private --source=. --remote=origin
# or manually: create an empty repo on github.com, then:
# git remote add origin git@github.com:<you>/ttagent.git
git branch -M main
git push -u origin main
```

### 2. Connect Railway to the repo
1. In the Railway dashboard, **New Project → Deploy from GitHub repo**.
2. Authorize Railway's GitHub App and select the `ttagent` repo.
3. Railway detects `railway.json` and Nixpacks builds it automatically —
   no Dockerfile needed.

### 3. Set environment variables
In the Railway service → **Variables**, add everything from `.env.example`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the Threads
scraper/API keys once you have them. Railway injects `PORT` itself — don't
set that one.

### 4. Deploy
Railway builds and deploys on push automatically. Watch progress under
**Deployments**; once live, Railway assigns a `*.up.railway.app` domain
under **Settings → Networking** (or attach a custom domain there).

Every subsequent `git push` to `main` triggers a new deploy. For preview
environments per branch/PR, enable **PR Environments** in the service
settings.

## Module 1: Creator Tracker & Scraper

Live at `/dashboard/creators`. Add a Threads username, open it, click
**Fetch recent posts** — that calls a RapidAPI Threads scraper and upserts
the results into `scraped_threads`.

### Set up the scraper

1. On RapidAPI, subscribe to a "Threads scraper" listing (search the
   marketplace — several exist, pricing/free-tier varies by provider).
2. Open its **Test Endpoint** panel for the "get user posts" endpoint and
   copy three things into `.env.local` (and Railway → Variables):
   - `THREADS_SCRAPER_BASE_URL` — the full endpoint URL.
   - `THREADS_SCRAPER_HOST` — the `X-RapidAPI-Host` value shown there.
   - `THREADS_SCRAPER_API_KEY` — your RapidAPI key.
3. `lib/threads/scraper.ts` normalizes the response with fallback field
   lookups covering the field names most listings use (`likes`/`like_count`,
   `text`/`caption`, etc.). **Different listings return different shapes** —
   if posts come back with missing likes/text/dates after your first fetch,
   open a row's `raw_data` column in the Supabase table editor to see the
   real field names and adjust `normalizeThreadsPost()` accordingly. Nothing
   is lost in the meantime — the full raw payload is always saved to
   `raw_data` regardless of whether normalization mapped it correctly.

## What's next

Auth (Module 0) and Module 1 (creator tracker + scraper) are done.

- **Module 2**: `/api/analyze` route calling Claude with a batch of a
  creator's `scraped_threads`, writing structured output to `creator_analysis`.
- **Module 3**: generation UI + `/api/generate` route using `generated_rules`
  as system prompt context.
- **Module 4**: `scheduled_posts` queue UI + a cron-triggered route that calls
  the Threads Publishing API (`POST /{threads-user-id}/threads` to create a
  container, then `POST /{threads-user-id}/threads_publish` to publish —
  official docs: https://developers.facebook.com/docs/threads).

Say the word and we'll start on Module 1.
