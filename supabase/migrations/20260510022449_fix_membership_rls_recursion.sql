create or replace function app_private.is_active_member(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = p_organization_id
        and om.user_id = p_user_id
        and om.status = 'active'
    );
$$;

create or replace function app_private.is_active_member(
  p_organization_id text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_organization_id is not null
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id::text = p_organization_id
        and om.user_id = p_user_id
        and om.status = 'active'
    );
$$;

create or replace function app_private.is_organization_creator(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.organizations o
      where o.id = p_organization_id
        and o.created_by = p_user_id
    );
$$;

create or replace function app_private.is_project_member(
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.projects p
      join public.organization_members om
        on om.organization_id = p.organization_id
      where p.id = p_project_id
        and om.user_id = p_user_id
        and om.status = 'active'
    );
$$;

grant usage on schema app_private to authenticated;
grant execute on function app_private.is_active_member(uuid, uuid) to authenticated;
grant execute on function app_private.is_active_member(text, uuid) to authenticated;
grant execute on function app_private.is_organization_creator(uuid, uuid) to authenticated;
grant execute on function app_private.is_project_member(uuid, uuid) to authenticated;

drop policy if exists "members can read organizations"
  on public.organizations;
drop policy if exists "members can read memberships"
  on public.organization_members;
drop policy if exists "organization creators can add owner membership"
  on public.organization_members;
drop policy if exists "members can read projects"
  on public.projects;
drop policy if exists "members can insert projects"
  on public.projects;
drop policy if exists "members can read project images"
  on public.project_images;
drop policy if exists "members can read project outputs"
  on public.project_outputs;
drop policy if exists "members can read pipeline logs"
  on public.pipeline_logs;
drop policy if exists "members can read subscriptions"
  on public.subscriptions;
drop policy if exists "members can read video credit ledger"
  on public.video_credit_ledger;
drop policy if exists "members can read credit reservations"
  on public.credit_reservations;

create policy "members and creators can read organizations"
  on public.organizations for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or app_private.is_active_member(organizations.id, (select auth.uid()))
  );

create policy "members can read memberships"
  on public.organization_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or app_private.is_active_member(
      organization_members.organization_id,
      (select auth.uid())
    )
  );

create policy "organization creators can add owner membership"
  on public.organization_members for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and status = 'active'
    and app_private.is_organization_creator(
      organization_members.organization_id,
      (select auth.uid())
    )
  );

create policy "members can read projects"
  on public.projects for select
  to authenticated
  using (
    app_private.is_active_member(projects.organization_id, (select auth.uid()))
  );

create policy "members can insert projects"
  on public.projects for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and app_private.is_active_member(projects.organization_id, (select auth.uid()))
  );

create policy "members can read project images"
  on public.project_images for select
  to authenticated
  using (
    app_private.is_project_member(project_images.project_id, (select auth.uid()))
  );

create policy "members can read project outputs"
  on public.project_outputs for select
  to authenticated
  using (
    app_private.is_project_member(project_outputs.project_id, (select auth.uid()))
  );

create policy "members can read pipeline logs"
  on public.pipeline_logs for select
  to authenticated
  using (
    app_private.is_project_member(pipeline_logs.project_id, (select auth.uid()))
  );

create policy "members can read subscriptions"
  on public.subscriptions for select
  to authenticated
  using (
    app_private.is_active_member(
      subscriptions.organization_id,
      (select auth.uid())
    )
  );

create policy "members can read video credit ledger"
  on public.video_credit_ledger for select
  to authenticated
  using (
    app_private.is_active_member(
      video_credit_ledger.organization_id,
      (select auth.uid())
    )
  );

create policy "members can read credit reservations"
  on public.credit_reservations for select
  to authenticated
  using (
    app_private.is_active_member(
      credit_reservations.organization_id,
      (select auth.uid())
    )
  );

drop policy if exists "members can read organization storage objects"
  on storage.objects;
drop policy if exists "members can upload source assets"
  on storage.objects;
drop policy if exists "members can update source assets"
  on storage.objects;
drop policy if exists "members can delete source assets"
  on storage.objects;

create policy "members can read organization storage objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in (
      'project-source-assets',
      'project-generated-clips',
      'project-final-outputs',
      'music-tracks'
    )
    and (
      bucket_id = 'music-tracks'
      or app_private.is_active_member(
        (storage.foldername(name))[1],
        (select auth.uid())
      )
    )
  );

create policy "members can upload source assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-source-assets'
    and app_private.is_active_member(
      (storage.foldername(name))[1],
      (select auth.uid())
    )
  );

create policy "members can update source assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-source-assets'
    and app_private.is_active_member(
      (storage.foldername(name))[1],
      (select auth.uid())
    )
  )
  with check (
    bucket_id = 'project-source-assets'
    and app_private.is_active_member(
      (storage.foldername(name))[1],
      (select auth.uid())
    )
  );

create policy "members can delete source assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-source-assets'
    and app_private.is_active_member(
      (storage.foldername(name))[1],
      (select auth.uid())
    )
  );
