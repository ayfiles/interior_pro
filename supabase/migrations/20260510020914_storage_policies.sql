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
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id::text = (storage.foldername(name))[1]
          and om.user_id = (select auth.uid())
          and om.status = 'active'
      )
    )
  );

create policy "members can upload source assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-source-assets'
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id::text = (storage.foldername(name))[1]
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can update source assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-source-assets'
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id::text = (storage.foldername(name))[1]
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  )
  with check (
    bucket_id = 'project-source-assets'
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id::text = (storage.foldername(name))[1]
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can delete source assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-source-assets'
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id::text = (storage.foldername(name))[1]
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );
