-- ============================================================================
-- TTAgent (Threads Agent) — Initial Schema
-- Module 1-4 core tables: creators, scraped_threads, creator_analysis,
-- scheduled_posts
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- updated_at helper trigger
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. creators — Threads accounts you are studying
-- ============================================================================
create table public.creators (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  username          text not null,
  display_name      text,
  profile_pic_url   text,
  platform_user_id  text,                 -- Threads' internal numeric/user id, if known
  bio               text,
  follower_count    integer,
  is_active         boolean not null default true,   -- keep tracking on/off
  last_scraped_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, username)
);

create index creators_user_id_idx on public.creators (user_id);

create trigger creators_set_updated_at
  before update on public.creators
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. scraped_threads — raw posts pulled from tracked creators
-- ============================================================================
create table public.scraped_threads (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.creators(id) on delete cascade,
  platform_post_id  text,                 -- Threads post id, if the scraper provides one
  post_url          text,
  content_text      text,
  media_urls        jsonb not null default '[]'::jsonb,   -- array of image/video urls
  like_count        integer not null default 0,
  reply_count       integer not null default 0,
  repost_count      integer not null default 0,
  share_count       integer not null default 0,
  is_reply          boolean not null default false,
  parent_post_id    text,                 -- links replies/chained thread posts together
  thread_position   integer,              -- order within a multi-post thread, if detectable
  published_at      timestamptz,
  raw_data          jsonb,                -- full raw payload from the scraper, for reprocessing
  scraped_at        timestamptz not null default now(),
  unique (creator_id, platform_post_id)
);

create index scraped_threads_creator_id_idx on public.scraped_threads (creator_id);
create index scraped_threads_published_at_idx on public.scraped_threads (published_at desc);
create index scraped_threads_raw_data_gin_idx on public.scraped_threads using gin (raw_data);

-- ============================================================================
-- 3. creator_analysis — AI-generated style profile for a creator
-- ============================================================================
create table public.creator_analysis (
  id                  uuid primary key default gen_random_uuid(),
  creator_id          uuid not null references public.creators(id) on delete cascade,
  style_tone          text,             -- e.g. "witty, contrarian, high-energy"
  hook_patterns       jsonb,            -- structured notes/examples on opening-line patterns
  threading_structure jsonb,            -- how they break a thread into posts (setup/payoff/etc.)
  emoji_usage         jsonb,            -- frequency + which emojis + placement
  cta_patterns        jsonb,            -- how/whether they end with a call to action
  vocabulary_notes    text,
  generated_rules     text,             -- condensed prompt/style-guide fed to the generator (Module 3)
  sample_size         integer,          -- number of posts the analysis was based on
  model_used          text,             -- e.g. "claude-opus-4-6"
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (creator_id)   -- one current profile per creator; re-analysis overwrites it
);

create index creator_analysis_creator_id_idx on public.creator_analysis (creator_id);

create trigger creator_analysis_set_updated_at
  before update on public.creator_analysis
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. scheduled_posts — generated drafts queued for posting
-- ============================================================================
create table public.scheduled_posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  creator_id        uuid references public.creators(id) on delete set null,  -- style basis, optional
  post_type         text not null check (post_type in ('single', 'thread')),
  content_draft     jsonb not null,      -- single: ["text"] / thread: ["post 1", "post 2", ...]
  schedule_time     timestamptz,
  status            text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'posted', 'failed')),
  threads_post_id   text,                -- id returned by the Threads Publishing API once posted
  error_message     text,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index scheduled_posts_user_id_idx on public.scheduled_posts (user_id);
create index scheduled_posts_status_idx on public.scheduled_posts (status);
create index scheduled_posts_schedule_time_idx on public.scheduled_posts (schedule_time);

create trigger scheduled_posts_set_updated_at
  before update on public.scheduled_posts
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.creators           enable row level security;
alter table public.scraped_threads    enable row level security;
alter table public.creator_analysis   enable row level security;
alter table public.scheduled_posts    enable row level security;

-- creators: owner-only access
create policy "creators_select_own" on public.creators
  for select using (auth.uid() = user_id);
create policy "creators_insert_own" on public.creators
  for insert with check (auth.uid() = user_id);
create policy "creators_update_own" on public.creators
  for update using (auth.uid() = user_id);
create policy "creators_delete_own" on public.creators
  for delete using (auth.uid() = user_id);

-- scraped_threads: access via parent creator's ownership
create policy "scraped_threads_select_own" on public.scraped_threads
  for select using (
    exists (select 1 from public.creators c
            where c.id = scraped_threads.creator_id and c.user_id = auth.uid())
  );
create policy "scraped_threads_insert_own" on public.scraped_threads
  for insert with check (
    exists (select 1 from public.creators c
            where c.id = scraped_threads.creator_id and c.user_id = auth.uid())
  );
create policy "scraped_threads_update_own" on public.scraped_threads
  for update using (
    exists (select 1 from public.creators c
            where c.id = scraped_threads.creator_id and c.user_id = auth.uid())
  );
create policy "scraped_threads_delete_own" on public.scraped_threads
  for delete using (
    exists (select 1 from public.creators c
            where c.id = scraped_threads.creator_id and c.user_id = auth.uid())
  );

-- creator_analysis: access via parent creator's ownership
create policy "creator_analysis_select_own" on public.creator_analysis
  for select using (
    exists (select 1 from public.creators c
            where c.id = creator_analysis.creator_id and c.user_id = auth.uid())
  );
create policy "creator_analysis_insert_own" on public.creator_analysis
  for insert with check (
    exists (select 1 from public.creators c
            where c.id = creator_analysis.creator_id and c.user_id = auth.uid())
  );
create policy "creator_analysis_update_own" on public.creator_analysis
  for update using (
    exists (select 1 from public.creators c
            where c.id = creator_analysis.creator_id and c.user_id = auth.uid())
  );
create policy "creator_analysis_delete_own" on public.creator_analysis
  for delete using (
    exists (select 1 from public.creators c
            where c.id = creator_analysis.creator_id and c.user_id = auth.uid())
  );

-- scheduled_posts: owner-only access
create policy "scheduled_posts_select_own" on public.scheduled_posts
  for select using (auth.uid() = user_id);
create policy "scheduled_posts_insert_own" on public.scheduled_posts
  for insert with check (auth.uid() = user_id);
create policy "scheduled_posts_update_own" on public.scheduled_posts
  for update using (auth.uid() = user_id);
create policy "scheduled_posts_delete_own" on public.scheduled_posts
  for delete using (auth.uid() = user_id);
