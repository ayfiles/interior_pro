create table if not exists public.testing_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_step text not null check (
    target_step in (
      'enhancement_agent',
      'image_upscaler',
      'video_agent',
      'kling_video',
      'media_qc',
      'editor_agent',
      'voice_music',
      'remotion_render',
      'full_pipeline'
    )
  ),
  run_mode text not null default 'only_step' check (
    run_mode in ('only_step', 'from_step')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'queued', 'running', 'completed', 'failed', 'canceled')
  ),
  organization_id uuid references public.organizations(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  related_project_id uuid references public.projects(id) on delete set null,
  input_summary jsonb not null default '{}',
  config jsonb not null default '{}',
  estimated_cost_usd double precision not null default 0,
  actual_cost_usd double precision not null default 0,
  provider_credits numeric not null default 0,
  error_message text,
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testing_run_assets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.testing_runs(id) on delete cascade,
  kind text not null,
  bucket text not null,
  storage_key text not null,
  file_name text,
  content_type text,
  file_size_bytes bigint,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.testing_run_outputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.testing_runs(id) on delete cascade,
  kind text not null,
  label text not null,
  bucket text,
  storage_key text,
  content_type text,
  file_size_bytes bigint,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.testing_run_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.testing_runs(id) on delete cascade,
  step text not null,
  status text not null check (
    status in ('started', 'completed', 'failed', 'skipped', 'info')
  ),
  message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_testing_runs_created_at
  on public.testing_runs(created_at desc);

create index if not exists idx_testing_runs_status
  on public.testing_runs(status);

create index if not exists idx_testing_run_assets_run_id
  on public.testing_run_assets(run_id);

create index if not exists idx_testing_run_outputs_run_id
  on public.testing_run_outputs(run_id);

create index if not exists idx_testing_run_logs_run_id
  on public.testing_run_logs(run_id, created_at);

alter table public.testing_runs enable row level security;
alter table public.testing_run_assets enable row level security;
alter table public.testing_run_outputs enable row level security;
alter table public.testing_run_logs enable row level security;

grant select, insert, update, delete on table public.testing_runs to service_role;
grant select, insert, update, delete on table public.testing_run_assets to service_role;
grant select, insert, update, delete on table public.testing_run_outputs to service_role;
grant select, insert, update, delete on table public.testing_run_logs to service_role;

update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type order by mime_type)
  from unnest(
    coalesce(allowed_mime_types, '{}'::text[])
    || array[
      'image/heic',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/markdown',
      'text/plain'
    ]::text[]
  ) as mime_type
)
where id = 'project-source-assets';
