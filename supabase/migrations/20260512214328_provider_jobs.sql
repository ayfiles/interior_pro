create table if not exists public.provider_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  project_image_id uuid references public.project_images(id) on delete cascade,
  step text not null check (
    step in (
      'upscaling',
      'video_generation',
      'rendering',
      'quality_check'
    )
  ),
  provider text not null,
  model text not null,
  status text not null default 'started' check (
    status in (
      'started',
      'submitted',
      'processing',
      'completed',
      'failed',
      'requires_manual_retry',
      'canceled'
    )
  ),
  idempotency_key text not null unique,
  external_task_id text,
  request jsonb not null default '{}',
  response jsonb not null default '{}',
  output_storage_key text,
  credits_consumed numeric(12, 4),
  estimated_cost_usd numeric(12, 6),
  file_size_bytes bigint,
  error_message text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_jobs enable row level security;

drop policy if exists "members can read provider jobs"
  on public.provider_jobs;

create policy "members can read provider jobs"
  on public.provider_jobs for select
  to authenticated
  using (
    app_private.is_project_member(provider_jobs.project_id, (select auth.uid()))
  );

create index if not exists idx_provider_jobs_project_id_created_at
  on public.provider_jobs(project_id, created_at desc);

create index if not exists idx_provider_jobs_project_image_step
  on public.provider_jobs(project_image_id, step);

create index if not exists idx_provider_jobs_external_task_id
  on public.provider_jobs(provider, external_task_id)
  where external_task_id is not null;
