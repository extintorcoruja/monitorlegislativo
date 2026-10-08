create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.propositions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  proposition_type text,
  number integer,
  year integer,
  author text,
  status text,
  current_regime text,
  current_organ text,
  official_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposition_sources (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  external_key text not null,
  proposition_type text,
  official_url text,
  raw_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_key)
);

create table if not exists public.proposition_movements (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  source_id uuid references public.sources(id) on delete restrict,
  external_event_id text,
  event_at timestamptz not null,
  event_type text,
  description text,
  organ text,
  status text,
  regime text,
  source_url text,
  fingerprint text,
  created_at timestamptz not null default now(),
  unique (source_id, fingerprint)
);

create table if not exists public.proposition_status_history (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  source_id uuid references public.sources(id) on delete restrict,
  status text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.proposition_regimes (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  source_id uuid references public.sources(id) on delete restrict,
  regime text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.proposition_changes (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  source_id uuid references public.sources(id) on delete restrict,
  movement_id uuid references public.proposition_movements(id) on delete set null,
  detected_at timestamptz not null default now(),
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create table if not exists public.verification_checks (
  id uuid primary key default gen_random_uuid(),
  proposition_id uuid references public.propositions(id) on delete cascade,
  source_id uuid references public.sources(id) on delete restrict,
  check_type text not null,
  result text not null,
  message text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text,
  external_key text,
  proposition_type text,
  number integer,
  year integer,
  title text,
  official_url text,
  discovered_at timestamptz not null default now(),
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keyword_matches (
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  matched_at timestamptz not null default now(),
  match_context text,
  primary key (proposition_id, keyword_id)
);

create table if not exists public.manual_searches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete restrict,
  query text not null,
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'requested',
  result_count integer,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'requested',
  generated_at timestamptz,
  output_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  requests_count integer not null default 0,
  records_count integer not null default 0,
  error_count integer not null default 0,
  cursor text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text
);

create index if not exists idx_propositions_status on public.propositions(status);
create index if not exists idx_propositions_year on public.propositions(year);
create index if not exists idx_proposition_sources_proposition on public.proposition_sources(proposition_id);
create index if not exists idx_proposition_movements_proposition_date on public.proposition_movements(proposition_id, event_at desc);
create index if not exists idx_status_history_proposition_date on public.proposition_status_history(proposition_id, valid_from desc);
create index if not exists idx_regimes_proposition_date on public.proposition_regimes(proposition_id, valid_from desc);
create index if not exists idx_changes_proposition_date on public.proposition_changes(proposition_id, detected_at desc);
create index if not exists idx_checks_proposition_date on public.verification_checks(proposition_id, checked_at desc);
create index if not exists idx_candidates_source_status on public.candidates(source_id, status);
create index if not exists idx_keywords_active on public.keywords(active);
create index if not exists idx_manual_searches_created on public.manual_searches(created_at desc);
create index if not exists idx_provider_runs_source_date on public.provider_runs(source_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sources_updated_at on public.sources;
create trigger trg_sources_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

drop trigger if exists trg_propositions_updated_at on public.propositions;
create trigger trg_propositions_updated_at
before update on public.propositions
for each row execute function public.set_updated_at();

drop trigger if exists trg_proposition_sources_updated_at on public.proposition_sources;
create trigger trg_proposition_sources_updated_at
before update on public.proposition_sources
for each row execute function public.set_updated_at();

drop trigger if exists trg_candidates_updated_at on public.candidates;
create trigger trg_candidates_updated_at
before update on public.candidates
for each row execute function public.set_updated_at();

drop trigger if exists trg_keywords_updated_at on public.keywords;
create trigger trg_keywords_updated_at
before update on public.keywords
for each row execute function public.set_updated_at();

insert into public.sources (code, name)
values
  ('camara', 'Câmara dos Deputados'),
  ('senado', 'Senado Federal'),
  ('alesp', 'Assembleia Legislativa do Estado de São Paulo')
on conflict (code) do nothing;

alter table public.sources enable row level security;
alter table public.propositions enable row level security;
alter table public.proposition_sources enable row level security;
alter table public.proposition_movements enable row level security;
alter table public.proposition_status_history enable row level security;
alter table public.proposition_regimes enable row level security;
alter table public.proposition_changes enable row level security;
alter table public.verification_checks enable row level security;
alter table public.candidates enable row level security;
alter table public.keywords enable row level security;
alter table public.keyword_matches enable row level security;
alter table public.manual_searches enable row level security;
alter table public.reports enable row level security;
alter table public.provider_runs enable row level security;
