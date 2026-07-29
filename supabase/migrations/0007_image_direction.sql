-- ============================================================================
-- Optional per-post override for the accompanying image's SCENE/direction,
-- separate from role_prompt (which governs the post TEXT's shape). Used by
-- the product-photo-reference feature (see lib/shopee/fetch-product-image.ts
-- and lib/generation/generate-styled-post.ts) — e.g. "seorang perempuan nak
-- dating pakai item ini" steers the lifestyle scene built around a real
-- scraped product photo.
-- ============================================================================
alter table public.scheduled_posts
  add column if not exists image_direction text;

comment on column public.scheduled_posts.image_direction is
  'Optional user override for the accompanying image''s scene/direction (separate from role_prompt, which governs post text) — e.g. "seorang perempuan nak dating pakai item ini". Persisted for potential future reuse (e.g. Spin), even though Spin itself currently never regenerates images.';
