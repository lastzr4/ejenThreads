-- ============================================================================
-- Niche presets + AI image generation for Module 3 posts
-- ============================================================================

alter table public.posting_schedules
  add column if not exists niche text,
  add column if not exists generate_image boolean not null default false;

comment on column public.posting_schedules.niche is
  'Optional preset niche/category (e.g. "AI/Technology", "Affiliate/Product") steering topic selection toward higher-engagement themes, independent of the creator whose style is being used.';

alter table public.scheduled_posts
  add column if not exists image_url text;

comment on column public.scheduled_posts.image_url is
  'Public URL (Supabase Storage) of an AI-generated image attached to this post, if any. Null for text-only posts.';

-- Public bucket so the Threads API (graph.threads.net) can fetch generated
-- images by URL when publishing — Threads requires image_url to be a
-- publicly reachable address at publish time.
insert into storage.buckets (id, name, public)
values ('generated-images', 'generated-images', true)
on conflict (id) do nothing;
