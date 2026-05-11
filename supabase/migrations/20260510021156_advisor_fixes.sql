create policy "members can read subscriptions"
  on public.subscriptions for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = subscriptions.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can read video credit ledger"
  on public.video_credit_ledger for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = video_credit_ledger.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "members can read credit reservations"
  on public.credit_reservations for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = credit_reservations.organization_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
  );

create policy "authenticated clients cannot read stripe events"
  on public.stripe_events for select
  to authenticated
  using (false);

create index if not exists idx_organizations_created_by
  on public.organizations(created_by);

create index if not exists idx_projects_created_by
  on public.projects(created_by);

create index if not exists idx_projects_music_id
  on public.projects(music_id);

create index if not exists idx_subscriptions_organization_id
  on public.subscriptions(organization_id);

create index if not exists idx_video_credit_ledger_project_id
  on public.video_credit_ledger(project_id);

create index if not exists idx_video_credit_ledger_stripe_event_id
  on public.video_credit_ledger(stripe_event_id);
