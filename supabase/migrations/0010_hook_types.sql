-- ============================================================================
-- "Jenis Hook" (hook type) — one or more presets (storytelling, FOMO,
-- curiosity, etc. — see lib/hook-types.ts) the user can pick to steer how a
-- generated post's OPENING is framed. Stored as text[] since multiple can be
-- selected and blended together in one post. Mirrors the existing niche/
-- role_prompt columns: settable on the manual Generate form and on a
-- Schedule, persisted on scheduled_posts so Spin can reuse the same choice.
-- ============================================================================
alter table public.scheduled_posts
  add column if not exists hook_types text[];

alter table public.posting_schedules
  add column if not exists hook_types text[];
