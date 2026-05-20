alter table public.music_tracks
  add column if not exists length_profile text not null default 'long',
  add column if not exists track_group_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'music_tracks_length_profile_check'
  ) then
    alter table public.music_tracks
      add constraint music_tracks_length_profile_check
      check (length_profile in ('short', 'long'));
  end if;
end $$;

create index if not exists idx_music_tracks_genre_length_active_created_at
  on public.music_tracks(genre, length_profile, is_active, created_at desc);

create index if not exists idx_music_tracks_group_length_active
  on public.music_tracks(track_group_key, length_profile, is_active)
  where track_group_key is not null;

comment on column public.music_tracks.length_profile is
  'Song version for supervisor selection: short for 2-3 input images, long for 4-8 input images.';

comment on column public.music_tracks.track_group_key is
  'Optional shared key that groups the short and long versions of the same song.';
