-- ============================================================================
-- shopee_product_photos — a small "give it once, reuse forever" library:
-- when a user uploads a real product photo alongside a Shopee link, it gets
-- remembered here keyed by a stable product id (see
-- lib/shopee/resolve-product-id.ts), so the next time that same product's
-- link shows up in a Topic field, the saved photo is used automatically as
-- the AI reference image — no manual re-upload, and no dependency on the
-- live Shopee auto-scrape (which Shopee's anti-bot system frequently blocks
-- — see lib/shopee/fetch-product-image.ts).
-- ============================================================================
create table public.shopee_product_photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id   text not null,        -- stable id derived from the resolved Shopee URL (shopid:itemid)
  source_url   text,                 -- the link as originally pasted, for display only
  image_url    text not null,        -- the saved photo's public Supabase Storage URL
  title        text,                 -- optional product name, if known
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, product_id)
);

create index shopee_product_photos_user_id_idx on public.shopee_product_photos (user_id);

create trigger shopee_product_photos_set_updated_at
  before update on public.shopee_product_photos
  for each row execute function public.set_updated_at();

alter table public.shopee_product_photos enable row level security;

create policy "shopee_product_photos_select_own" on public.shopee_product_photos
  for select using (auth.uid() = user_id);
create policy "shopee_product_photos_insert_own" on public.shopee_product_photos
  for insert with check (auth.uid() = user_id);
create policy "shopee_product_photos_update_own" on public.shopee_product_photos
  for update using (auth.uid() = user_id);
create policy "shopee_product_photos_delete_own" on public.shopee_product_photos
  for delete using (auth.uid() = user_id);
