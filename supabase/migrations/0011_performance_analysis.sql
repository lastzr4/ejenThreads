-- ============================================================================
-- "Past performance" — CopyCreator remembers which style/hook/niche/timing
-- actually performed on real Threads posts, and feeds that back into future
-- generation as a learned preference (see generate-styled-post.ts).
--
-- scheduled_posts gains the real engagement numbers for posts this app
-- published (status='posted'), pulled from the official Threads Insights
-- API (GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes,
-- shares — see lib/threads/insights.ts). Note: Threads has no literal
-- "reach" metric at the post level; `metric_views` (times played/displayed)
-- is the closest equivalent and is shown as "Reach" in the UI.
-- ============================================================================
alter table public.scheduled_posts
  add column if not exists metric_views integer,
  add column if not exists metric_likes integer,
  add column if not exists metric_replies integer,
  add column if not exists metric_reposts integer,
  add column if not exists metric_quotes integer,
  add column if not exists metric_shares integer,
  add column if not exists metrics_updated_at timestamptz;

-- One row per user — the latest AI-generated read on what's working,
-- regenerated on demand (or whenever the user has enough freshly-synced
-- posts) from lib/generation/analyze-performance.ts. Overwritten each time,
-- same "latest state, not a history log" pattern as creator_analysis.
create table public.performance_insights (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users(id) on delete cascade default auth.uid(),
  summary            text,
  best_patterns      text,
  worst_patterns     text,
  timing_notes       text,
  recommendations    text,
  based_on_post_count integer not null default 0,
  generated_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

alter table public.performance_insights enable row level security;

create policy "performance_insights_select_own" on public.performance_insights
  for select using (auth.uid() = user_id);
create policy "performance_insights_insert_own" on public.performance_insights
  for insert with check (auth.uid() = user_id);
create policy "performance_insights_update_own" on public.performance_insights
  for update using (auth.uid() = user_id);
create policy "performance_insights_delete_own" on public.performance_insights
  for delete using (auth.uid() = user_id);
