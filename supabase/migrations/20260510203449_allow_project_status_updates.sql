create policy "members can update projects"
  on public.projects for update
  to authenticated
  using (
    app_private.is_active_member(projects.organization_id, (select auth.uid()))
  )
  with check (
    app_private.is_active_member(projects.organization_id, (select auth.uid()))
  );
