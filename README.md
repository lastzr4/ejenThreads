# CopyCreator

AI pipeline that studies successful Threads creators, learns their style, generates
new posts/threads in that style, and schedules them to your own Threads account —
built toward eventual auto-affiliate content workflows.

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

This scaffold is Railway-ready. `railway.json` points Railway at the
`Dockerfile` (not Nixpacks — see below for why), and `npm start` binds to
Railway's injected `$PORT`. Using the GitHub + dashboard flow (auto-deploys
on every push):

**Why Docker instead of Nixpacks:** Module 1's scraper runs headless
Chromium via Playwright, which needs a pile of system libraries (fonts,
codecs, etc.) that Nixpacks doesn't supply out of the box. The `Dockerfile`
builds from `mcr.microsoft.com/playwright`, Microsoft's official image with
Chromium and all its dependencies preinstalled, so this just works without
hand-picking apt packages. Expect a heavier/slower build than a plain
Next.js app (the base image alone is ~1-2GB) and keep an eye on Railway's
memory limits — a headless browser is not free to run; if you're on a
constrained plan, fetching posts for one creator at a time rather than in
bulk keeps memory usage predictable.

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
2. Authorize Railway's GitHub App and select the repo.
3. Railway reads `railway.json`, sees `"builder": "DOCKERFILE"`, and builds
   from `/Dockerfile` automatically.

### 3. Set environment variables
In the Railway service → **Variables**, add everything from `.env.example`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. Railway injects `PORT`
itself — don't set that one. Nothing is needed for the Threads scraper
(Module 1) — it's a self-hosted Playwright scraper now, no API keys
required.

### 4. Deploy
Railway builds and deploys on push automatically. Watch progress under
**Deployments**; once live, Railway assigns a `*.up.railway.app` domain
under **Settings → Networking** (or attach a custom domain there).

Every subsequent `git push` to `main` triggers a new deploy. For preview
environments per branch/PR, enable **PR Environments** in the service
settings.

## Module 1: Creator Tracker & Scraper

Live at `/dashboard/creators`. Add a Threads username, open it, click
**Fetch recent posts**. No API keys or subscriptions to set up — the
scraper renders the creator's public Threads profile in headless Chromium
(Playwright) and extracts posts from the page itself.

### Why not a RapidAPI listing?

We tried three separate "Threads scraper" listings on RapidAPI first — all
three were dead (`"User not found"` for even well-known accounts, or
`"API is unreachable"` straight from RapidAPI's own gateway diagnostics).
Given this app already runs as a persistent Node process on Railway (not a
serverless function), self-hosting a headless browser was the more
reliable option, so `lib/threads/scraper.ts` was rewritten around
Playwright instead. See `/Dockerfile` for how Railway builds the Chromium
runtime this needs.

**Legal note:** Meta's Threads Terms of Service discourage automated
scraping without permission. This is common practice for personal/
small-scale tools like this one, but it's a grey area — keep request
volume low (this is a manual, one-click-per-creator flow, not a crawler)
and be aware an IP or account could get rate-limited.

### Current status (confirmed against a live page)

Verified 2026-07-18 against `@ed.puteri`: the scraper successfully pulls
recent posts (text, URL, published date) into `scraped_threads`. Two known
limits, both by Threads' own design, not bugs:

- **Only ~3-4 posts per fetch.** Threads server-renders a small preview for
  logged-out visitors, then shows "Log in to see more." Re-running **Fetch
  recent posts** periodically still grows your history over time (new posts
  get added, already-seen ones just update) — no extra setup needed. See
  below if you want full history instead.
- **Engagement counts (likes/replies/reposts) aren't captured yet.** The
  numbers render as bare digits with no accessible label tying a number to
  what it counts, so `scraped_threads.like_count` etc. are currently 0 for
  DOM-scraped rows. Fixing this needs inspecting real post markup further —
  the `raw_data` column always has what was extracted, for whenever that's
  worth revisiting.

If a fetch ever returns zero posts, check `creators.last_fetch_debug` for
that creator (or the newest `scraped_threads.raw_data` row): a `bodyText`
field with a login-wall message means Threads changed what it shows
logged-out visitors; a `samples` field with real markup means the
`extractFromDom()` selectors in `lib/threads/scraper.ts` need adjusting for
a page redesign.

### Getting full post history (optional, has account risk)

By default the scraper is anonymous — no login, no keys, but capped at the
~3-4 post preview above. You can optionally log it into a real Threads
account to see everything, at a real cost: **this ties scraping activity to
that account, run from Railway's servers (a different network than wherever
you logged in) — Meta can treat that as suspicious and force a re-login,
a verification challenge, or restrict the account.** Only do this with an
account you're comfortable putting at that risk (not your main personal
account, ideally).

Claude does not perform this login for you — it requires typing your own
credentials into a real browser window you control, on your own computer.
Setup:

1. Double-click `capture-threads-session.bat` in the project folder (Windows).
   First run installs dependencies and a local Chromium automatically — this
   can take a minute. Not on Windows, or prefer the terminal? Run
   `node scripts/capture-threads-session.mjs` instead (after a one-time
   `npx playwright install chromium`) — same result.
2. A visible Chromium window opens at Threads' login page. Log in exactly as
   you normally would (2FA, verification steps, all handled by you in that
   window). Once you're on your home feed, go back to that window/terminal
   and press Enter.
3. This saves `threads-session-state.json` in the project folder — **treat
   this file exactly like a password.** It's already gitignored.
4. Open that file, copy its full contents, and paste them into the app:
   Dashboard → Settings → Threads session → Save session. Delete the local
   JSON file once it's saved in the app.
5. `lib/threads/scraper.ts` picks up the stored session automatically on the
   next Fetch — no redeploy needed. If it's ever missing or fails to parse,
   scraping silently falls back to anonymous mode rather than breaking.

Sessions can expire or get revoked by Meta at any time (that's the risk
described above) — if fetches start returning the anonymous 3-4 post
preview again after this was working, the session likely needs recapturing.

## Module 2: AI Style Analyzer

Live on each creator's detail page (`/dashboard/creators/[id]`): a **Study**
button (disabled until at least one post is scraped) that sends every
scraped post with text to Claude and writes back a structured style
profile into `creator_analysis` — tone, hook patterns, thread structure,
emoji usage, CTA patterns, vocabulary notes, and a condensed
`generated_rules` style guide meant to be reused as Module 3's system
prompt.

Requires `ANTHROPIC_API_KEY` set (`.env.local` and Railway → Variables) —
without it, clicking Study fails with a clear error rather than a silent
crash. Uses `claude-sonnet-5` by default (`lib/anthropic/client.ts`); swap
to `claude-opus-4-8` there for higher-effort analysis at higher cost.
Structured output is extracted via forced tool-use (`record_creator_analysis`)
rather than asking Claude to format raw JSON — much more reliable.

Re-running Study overwrites the previous analysis for that creator (one
row per creator; `sample_size` and `updated_at` tell you how current it is).

## Module 3: AI Post Generator

Live as a **Generate post** card on each creator's detail page (shown once
that creator has a style analysis). Optionally type a topic — a product,
link, or idea, for the auto-affiliate use case — or leave it blank and
Claude picks a topic that fits the creator's usual themes. Choose single
post or thread, click Generate.

Under the hood (`app/dashboard/creators/generate-actions.ts`): loads the
creator's `creator_analysis` row (tone, hooks, structure, emoji, CTA,
vocabulary, `generated_rules`) plus up to 5 of their best-performing real
posts as rhythm/length reference, and calls Claude with a system prompt
that explicitly forbids copying sentences verbatim — it's told to write
brand-new content that only borrows the voice/structure patterns. Output
is extracted via forced tool-use (`record_generated_post`), same reliable
pattern as Module 2. The result is saved into `scheduled_posts` with
`status: 'draft'` (this table already existed in the original schema,
built for exactly this).

Drafts live at **Dashboard → Drafts** (`app/dashboard/drafts/page.tsx`):
every generated post/thread, newest first, tagged with which creator's
style it's based on, with **Copy** (clipboard, ready to paste manually)
and **Delete** actions. No scheduling/auto-posting yet — that's Module 4.

## Module 4: Auto-Posting (Official Threads API + Schedules)

This is the piece that actually posts to your real Threads account, fully
automated on a timer — e.g. "every 4 hours, write something new in
@handle's style and publish it." It uses the **official** Meta Threads
Publishing API (not Playwright/browser automation), which is the
Meta-sanctioned way to post on your own behalf and carries none of the
account-ban risk of automating clicks in a browser.

### Why the official API and not the scraping session

The Playwright session connected in Settings ("Threads session") is just
browser cookies — good enough for reading pages, but automating a real
*post* action through it would mean scripting UI clicks against your own
logged-in account from Railway's servers, which Meta can detect and
penalize, and which isn't how Meta intends third-party posting to happen.
The official API is a separate, proper OAuth-based integration built
exactly for this.

### One-time setup: create a Meta Developer App

1. Go to https://developers.facebook.com/apps and create an app (any app
   type that lets you add use cases works — pick "Other" if asked).
2. In the app dashboard, add the **Threads** use case (also called "Access
   the Threads API").
3. Under **Use cases → Customize → Threads API**, add the
   `threads_content_publish` permission (`threads_basic` is required and
   already included).
4. Under **Settings → Basic**, note your **Threads App ID** and **Threads
   App secret**.
5. Still under Settings, add a **Client OAuth Setting → valid OAuth
   redirect URI**:
   `https://<your-railway-domain>/api/threads/oauth/callback`
   (use your actual Railway URL — this must match `THREADS_REDIRECT_URI`
   exactly, trailing slash and all).
6. Under **App roles → Roles**, add yourself (and anyone else who'll
   connect an account) as a **Threads Tester** — required while the app is
   in Development mode.

**You do not need App Review or Business Verification** for this — those
are only required to publish on behalf of *other* people's public
accounts. Posting to your own account (or any account added as a tester)
works immediately on Standard/Development access.

Set in Railway → Variables (and `.env.local` if testing locally):

```
THREADS_APP_ID=<from App Dashboard>
THREADS_APP_SECRET=<from App Dashboard>
THREADS_REDIRECT_URI=https://<your-railway-domain>/api/threads/oauth/callback
CRON_SECRET=<any random string>
```

### Connecting your account

**Dashboard → Settings → Threads API** → click **Connect with Threads**.
This opens Meta's own authorization screen; approve it, and you're
redirected back with a long-lived access token (60 days) stored in
`user_settings`. The token refreshes itself automatically (the scheduler
checks on every tick and refreshes anything within 5 days of expiring) as
long as it's used at least once before it fully expires — if it ever does
fully expire, just click Connect again.

### Setting up a schedule

**Dashboard → Schedules** → pick a creator you've already Studied
(Module 2), an interval (every 1/2/4/6/12/24 hours), single post or
thread, and optionally a recurring topic (e.g. an affiliate niche/product
to keep writing about). Save, and it's live.

### How it actually runs

`server.js` replaces `next start` with a tiny custom server that, once
listening, also sets a 60-second interval calling its own
`/api/cron/run-schedules` endpoint (`app/api/cron/run-schedules/route.ts`,
protected by `CRON_SECRET`). Each tick:

1. Finds every `posting_schedules` row across all users where
   `is_active = true` and `next_run_at <= now()`.
2. For each one: makes sure there's a valid Threads API token (refreshing
   if it's getting close to expiry), generates a new post via the same
   Claude logic as Module 3 (`lib/generation/generate-styled-post.ts`,
   shared by both the manual Generate button and this scheduler), then
   publishes it for real via `lib/threads/publish.ts` — creating a media
   container, polling until it's processed, then publishing it. Thread
   posts are chained together via `reply_to_id` so they appear as a single
   thread from your account.
3. Records the result in `scheduled_posts` (`status: 'posted'` with the
   real `threads_post_id`, or `'failed'` with the error) and reschedules
   `next_run_at` by the configured interval. Errors (token expired, not
   connected, Threads API rejecting the post) show up on the Schedules
   page under that schedule, in plain language.

No separate Railway Cron service needed — this all runs inside the one
existing web service, since it's already a long-running Docker container
(required for Playwright anyway), not a serverless deployment.

**Caveat:** if this service is ever scaled to more than one replica, each
replica would run its own copy of this interval and could double-post.
Fine at Railway's default single-replica setup; worth knowing if that
changes.

### Limits worth knowing

- Threads caps profiles at 250 published posts per rolling 24 hours —
  irrelevant at realistic hourly-or-slower intervals, but worth knowing if
  you ever add multiple aggressive schedules on the same account.
- Text posts are capped at 500 characters (`generate-styled-post.ts`
  already asks Claude to stay well under that per post).

## What's next

Auth, Module 1 (creator tracker + scraper), Module 2 (style analyzer),
Module 3 (post generator + Drafts), and Module 4 (Official Threads API +
recurring auto-posting schedules) are all done — this covers the full
auto-affiliate content loop: study a creator → generate in their style →
auto-publish on a timer.

Ideas for later, not yet built: engagement-count mapping for scraped posts
(likes/replies/reposts still read as raw unlabeled numbers in the DOM,
see Module 1 notes above), per-schedule posting-time windows (e.g. only
between 9am–9pm) instead of a flat interval, and image/carousel post
support (currently text-only).
