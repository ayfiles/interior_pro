create policy "members can insert credit reservations"
  on public.credit_reservations for insert
  to authenticated
  with check (
    amount = 1
    and status = 'reserved'
    and app_private.is_active_member(
      credit_reservations.organization_id,
      (select auth.uid())
    )
    and (
      project_id is null
      or app_private.is_project_member(
        credit_reservations.project_id,
        (select auth.uid())
      )
    )
  );

create policy "members can insert project images"
  on public.project_images for insert
  to authenticated
  with check (
    app_private.is_project_member(project_images.project_id, (select auth.uid()))
  );

create policy "members can insert pipeline logs"
  on public.pipeline_logs for insert
  to authenticated
  with check (
    app_private.is_project_member(pipeline_logs.project_id, (select auth.uid()))
  );
