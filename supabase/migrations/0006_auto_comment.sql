-- ============================================================================
-- Auto-Comment — AI-generated short replies on tracked creators' posts,
-- published via the OFFICIAL Threads Publishing API's reply_to_id parameter
-- (see lib/threads/publish.ts's new publishReply). Deliberately scoped to
-- posts whose real Graph API media id we can obtain officially (via
-- GET /profile_posts?username=..., see lib/threads/fetch-profile-posts.ts) —
-- NOT the user's personal home feed, and NOT via Playwright browser
-- automation. See README "Auto-Comment" section for the full reasoning.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- user_settings: auto-comment configuration + rate-limit bookkeeping.
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists auto_comment_enabled            boolean not null default false,
  add column if not exists auto_comment_daily_limit         integer not null default 10,
  add column if not exists auto_comment_delay_min_minutes   integer not null default 5,
  add column if not exists auto_comment_delay_max_minutes   integer not null default 10,
  add column if not exists auto_comment_next_eligible_at    timestamptz,
  add column if not exists auto_comment_count_today         integer not null default 0,
  add column if not exists auto_comment_count_reset_at      timestamptz;

comment on column public.user_settings.auto_comment_next_eligible_at is
  'Earliest time the next auto-comment cycle is allowed to post one more reply — set to now() + a random delay (between auto_comment_delay_min_minutes and _max_minutes) after each successful comment, so replies are spaced out instead of firing back-to-back.';
comment on column public.user_settings.auto_comment_count_reset_at is
  'When auto_comment_count_today should roll back to 0 — set to 24h after the first comment of the current window.';

-- ----------------------------------------------------------------------------
-- commented_posts — history/dedupe log so the same post never gets a second
-- auto-comment, and so the user can see exactly what was posted and where.
-- ----------------------------------------------------------------------------
create table public.commented_posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  creator_id        uuid references public.creators(id) on delete cascade,
  threads_post_id   text not null,        -- the official Graph API media id that was replied to
  post_permalink    text,
  post_excerpt      text,                 -- first ~200 chars of the original post's text, for display
  comment_text      text not null,
  threads_reply_id  text,                 -- id returned once the reply itself published
  status            text not null default 'posted' check (status in ('posted', 'failed')),
  error_message     text,
  created_at        timestamptz not null default now(),
  unique (user_id, threads_post_id)
);

create index commented_posts_user_id_idx on public.commented_posts (user_id, created_at desc);

alter table public.commented_posts enable row level security;

create policy "commented_posts_select_own" on public.commented_posts
  for select using (auth.uid() = user_id);
create policy "commented_posts_insert_own" on public.commented_posts
  for insert with check (auth.uid() = user_id);
create policy "commented_posts_delete_own" on public.commented_posts
  for delete using (auth.uid() = user_id);
