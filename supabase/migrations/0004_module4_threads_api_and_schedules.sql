-- ============================================================================
-- Module 4 — Official Threads API credentials + recurring posting schedules
-- ============================================================================

-- ----------------------------------------------------------------------------
-- user_settings: add Official Threads API (OAuth) credentials, separate from
-- the Playwright scraping session (threads_session_state) added in 0003.
-- These are used to actually publish posts via graph.threads.net, not to
-- scrape. threads_api_access_token is a long-lived user access token
-- (60-day validity, refreshable) obtained via the OAuth flow in
-- app/api/threads/oauth/*.
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists threads_api_user_id           text,
  add column if not exists threads_api_access_token       text,
  add column if not exists threads_api_token_expires_at   timestamptz,
  add column if not exists threads_api_connected_at       timestamptz;

comment on column public.user_settings.threads_api_access_token is
  'Long-lived Threads Graph API user access token (60-day validity, refreshable while unexpired). As sensitive as a password — used server-side only to publish posts on the user''s behalf.';

-- ----------------------------------------------------------------------------
-- posting_schedules — recurring "auto-generate + auto-publish every N hours"
-- rules, one per creator style the user wants to run on autopilot.
-- ----------------------------------------------------------------------------
create table public.posting_schedules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  creator_id        uuid not null references public.creators(id) on delete cascade,
  interval_hours    integer not null check (interval_hours > 0),
  post_type         text not null default 'single' check (post_type in ('single', 'thread')),
  topic             text,                 -- optional recurring topic/product angle (auto-affiliate use case)
  is_active         boolean not null default true,
  next_run_at       timestamptz not null default now(),
  last_run_at       timestamptz,
  last_result       text check (last_result in ('success', 'error')),
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index posting_schedules_user_id_idx on public.posting_schedules (user_id);
create index posting_schedules_due_idx on public.posting_schedules (next_run_at) where is_active;

create trigger posting_schedules_set_updated_at
  before update on public.posting_schedules
  for each row execute function public.set_updated_at();

alter table public.posting_schedules enable row level security;

create policy "posting_schedules_select_own" on public.posting_schedules
  for select using (auth.uid() = user_id);
create policy "posting_schedules_insert_own" on public.posting_schedules
  for insert with check (auth.uid() = user_id);
create policy "posting_schedules_update_own" on public.posting_schedules
  for update using (auth.uid() = user_id);
create policy "posting_schedules_delete_own" on public.posting_schedules
  for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- scheduled_posts: link back to the schedule that generated/published it
-- (nullable — manual Generate-post-button drafts have no schedule).
-- ----------------------------------------------------------------------------
alter table public.scheduled_posts
  add column if not exists posting_schedule_id uuid references public.posting_schedules(id) on delete set null;

create index if not exists scheduled_posts_posting_schedule_id_idx
  on public.scheduled_posts (posting_schedule_id);
