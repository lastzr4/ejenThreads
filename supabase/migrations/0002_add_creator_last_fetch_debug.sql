alter table public.creators
  add column if not exists last_fetch_debug jsonb;

comment on column public.creators.last_fetch_debug is
  'Diagnostic payload from the most recent scrape attempt (Module 1), saved regardless of whether any posts were found. Used to debug scraper selectors.';
