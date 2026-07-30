-- ============================================================================
-- Stores the connected Threads API account's own identity (username, display
-- name, avatar) alongside the existing threads_api_user_id (which is just a
-- numeric id, not human-readable). Shown on Settings so it's obvious which
-- real Threads account auto-posting/auto-comment/schedules are publishing
-- to, instead of just a generic "Connected" state.
-- ============================================================================
alter table public.user_settings
  add column if not exists threads_api_username text,
  add column if not exists threads_api_name text,
  add column if not exists threads_api_profile_picture_url text;
