-- ============================================================================
-- "Tabur Link" — a dedicated tab for affiliate-link posts that pair a Shopee
-- link with a real video (a licensed creative asset from Shopee's Affiliate
-- Center, uploaded by the user — NOT auto-scraped, see README) or a still
-- image, publishing via the official Threads API's VIDEO media type.
-- ============================================================================
alter table public.scheduled_posts
  add column if not exists video_url text;

comment on column public.scheduled_posts.video_url is
  'Public URL (Supabase Storage) of a video attached to this post, if any. Mutually exclusive with image_url — a single post is either an image or a video, never both.';

-- Public bucket so the Threads API (graph.threads.net) can fetch the video
-- by URL when publishing — same requirement as generated-images.
-- file_size_limit is an app-level safety cap (Threads itself allows up to
-- 1GB) to keep Storage costs/egress sane for what's meant to be a short
-- promo clip, not a full 1GB upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-videos', 'generated-videos', true, 209715200)
on conflict (id) do nothing;
