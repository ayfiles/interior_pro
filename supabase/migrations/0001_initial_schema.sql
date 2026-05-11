create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'de')),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text unique,
  subscription_plan text not null default 'trial' check (
    subscription_plan in ('trial', 'professional', 'enterprise')
  ),
  settings jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_storage_key text not null,
  duration_seconds double precision not null,
  genre text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_subscription_id text unique not null,
  plan text not null default 'professional',
  status text not null default 'active' check (
    status in ('active', 'trialing', 'canceled', 'past_due', 'paused')
  ),
  videos_per_month integer not null default 5,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.video_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  stripe_event_id text references public.stripe_events(stripe_event_id),
  entry_type text not null check (
    entry_type in ('monthly_grant', 'purchase', 'consume', 'refund', 'adjustment')
  ),
  amount integer not null check (amount <> 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid unique,
  amount integer not null default 1 check (amount > 0),
  status text not null default 'reserved' check (
    status in ('reserved', 'consumed', 'released', 'expired')
  ),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'draft' check (
    status in (
      'draft',
      'submitted',
      'queued',
      'validating',
      'upscaling',
      'generating_video',
      'media_qc',
      'editing',
      'rendering',
      'quality_check',
      'completed',
      'failed',
      'canceled'
    )
  ),
  credit_reservation_id uuid unique references public.credit_reservations(id),
  customer_name text not null,
  customer_logo_storage_key text,
  music_id uuid references public.music_tracks(id),
  voice_selection text not null,
  special_notes text,
  error_message text,
  inngest_run_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_reservations
  add constraint credit_reservations_project_fk
  foreign key (project_id) references public.projects(id) on delete set null;

alter table public.video_credit_ledger
  add constraint video_credit_ledger_project_fk
  foreign key (project_id) references public.projects(id) on delete set null;

create table if not exists public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  original_storage_key text not null,
  upscaled_storage_key text,
  analysis jsonb,
  prompt_type text check (prompt_type in ('single_shot', 'multi_shot')),
  video_storage_key text,
  video_status text not null default 'pending',
  order_index integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_outputs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  video_storage_key text not null,
  thumbnail_storage_key text,
  duration_seconds double precision,
  resolution text not null default '1920x1080',
  file_size_bytes bigint,
  voiceover_script text,
  qc_report jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  step text not null,
  status text not null check (status in ('started', 'completed', 'failed', 'skipped')),
  message text,
  duration_ms integer,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.music_tracks enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.video_credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.projects enable row level security;
alter table public.project_images enable row level security;
alter table public.project_outputs enable row level security;
alter table public.pipeline_logs enable row level security;

create policy "users can read own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "members can read organizations"
  on public.organizations for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organizations.id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "users can create own organization"
  on public.organizations for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "members can read memberships"
  on public.organization_members for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "organization creators can add owner membership"
  on public.organization_members for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and status = 'active'
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
  );

create policy "authenticated can read active music tracks"
  on public.music_tracks for select
  to authenticated
  using (is_active = true);

create policy "members can read projects"
  on public.projects for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = projects.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can insert projects"
  on public.projects for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = projects.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can read project images"
  on public.project_images for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
      where p.id = project_images.project_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can read project outputs"
  on public.project_outputs for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
      where p.id = project_outputs.project_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can read pipeline logs"
  on public.pipeline_logs for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
      where p.id = pipeline_logs.project_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create index if not exists idx_members_user_id
  on public.organization_members(user_id);
create index if not exists idx_projects_organization_id
  on public.projects(organization_id);
create index if not exists idx_project_images_project_id
  on public.project_images(project_id);
create index if not exists idx_project_outputs_project_id
  on public.project_outputs(project_id);
create index if not exists idx_pipeline_logs_project_id_created_at
  on public.pipeline_logs(project_id, created_at desc);
create index if not exists idx_credit_ledger_org_created_at
  on public.video_credit_ledger(organization_id, created_at desc);
create index if not exists idx_credit_reservations_org_status
  on public.credit_reservations(organization_id, status);

create schema if not exists app_private;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
