alter table public.music_tracks
  add column if not exists instructions_md text,
  add column if not exists plan_json jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'music_tracks_plan_json_object_check'
  ) then
    alter table public.music_tracks
      add constraint music_tracks_plan_json_object_check
      check (plan_json is null or jsonb_typeof(plan_json) = 'object');
  end if;
end $$;

comment on column public.music_tracks.instructions_md is
  'Optional song-specific Markdown instructions for editors and admins.';

comment on column public.music_tracks.plan_json is
  'Optional structured song plan with cut points, accents, fade timing, and edit rules.';
