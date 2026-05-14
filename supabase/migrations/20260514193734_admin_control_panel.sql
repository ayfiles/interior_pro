create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'operator', 'viewer')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_prompt_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  file_path text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.admin_prompt_documents(id) on delete cascade,
  version_number integer not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  change_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (document_id, version_number)
);

create unique index if not exists idx_admin_prompt_versions_one_published
  on public.admin_prompt_versions(document_id)
  where status = 'published';

create index if not exists idx_admin_audit_logs_created_at
  on public.admin_audit_logs(created_at desc);

create index if not exists idx_admin_audit_logs_actor_created_at
  on public.admin_audit_logs(actor_user_id, created_at desc);

create index if not exists idx_admin_prompt_versions_document_created_at
  on public.admin_prompt_versions(document_id, created_at desc);

alter table public.platform_admins enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_prompt_documents enable row level security;
alter table public.admin_prompt_versions enable row level security;

revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.admin_audit_logs from anon, authenticated;
revoke all on table public.admin_prompt_documents from anon, authenticated;
revoke all on table public.admin_prompt_versions from anon, authenticated;

grant select, insert, update, delete on table public.platform_admins to service_role;
grant select, insert, update, delete on table public.admin_audit_logs to service_role;
grant select, insert, update, delete on table public.admin_prompt_documents to service_role;
grant select, insert, update, delete on table public.admin_prompt_versions to service_role;

insert into public.admin_prompt_documents (slug, title, description, file_path)
values
  (
    'agent',
    'Video Agent',
    'Assigns source images to single-shot or multi-shot generation modes.',
    'src/inngest/prompts/agent.md'
  ),
  (
    'editor',
    'Editor Agent',
    'Shapes QC-approved clips into a structured luxury sales film.',
    'src/inngest/prompts/editor.md'
  ),
  (
    'multi-shot',
    'Kling Multi-Shot',
    'Primary Kling prompt for wider room perspectives and multi-shot motion.',
    'src/inngest/prompts/multi-shot.md'
  ),
  (
    'music',
    'Music Instructions',
    'Guides edit rhythm, ducking, and cut behavior for music genres.',
    'src/inngest/prompts/music.md'
  ),
  (
    'single-shot',
    'Kling Single-Shot',
    'Primary Kling prompt for single-image video generation.',
    'src/inngest/prompts/single-shot.md'
  ),
  (
    'upscaling',
    'Nano Banana Pro Upscaling',
    'Controls image enhancement before image-to-video generation.',
    'src/inngest/prompts/upscaling.md'
  ),
  (
    'voice',
    'Voice Director',
    'Guides German voiceover tone, length, and sales structure.',
    'src/inngest/prompts/voice.md'
  )
on conflict (slug) do update
set
  description = excluded.description,
  file_path = excluded.file_path,
  title = excluded.title,
  updated_at = now();
