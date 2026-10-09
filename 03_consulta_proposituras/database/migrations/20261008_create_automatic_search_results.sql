create table if not exists public.automatic_search_results (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid null,
  source_id uuid not null references public.sources(id) on delete restrict,
  source_code text not null,
  official_id text not null,
  type text,
  number_text text,
  year_text text,
  title text,
  ementa text,
  author_text text,
  official_url text,
  matched_terms text[] not null default '{}',
  score integer not null default 0,
  status text not null default 'NOVO',
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  unique (source_code, official_id)
);

create index if not exists automatic_search_results_verification_idx
  on public.automatic_search_results (verification_id, source_code, status);

create index if not exists automatic_search_results_status_idx
  on public.automatic_search_results (status, discovered_at desc);

alter table public.automatic_search_results enable row level security;
