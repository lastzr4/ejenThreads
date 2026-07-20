-- ============================================================================
-- CopyCreator — user_settings
-- Per-user app settings; currently holds the captured Threads/Instagram
-- browser session (Playwright storageState) used for authenticated scraping.
-- ============================================================================

create table public.user_settings (
  user_id                      uuid primary key references auth.users(id) on delete cascade,
  threads_session_state        jsonb,
  threads_session_updated_at   timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on table public.user_settings is
  'Per-user app settings. threads_session_state holds a captured Threads/Instagram browser session (Playwright storageState) used for authenticated scraping in Module 1 — as sensitive as a password; RLS-scoped to the owning user only.';

alter table public.user_settings enable row level security;

create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
