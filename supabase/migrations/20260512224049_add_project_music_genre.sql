alter table public.projects
  add column if not exists music_genre text not null default 'cinematic_ambient'
  check (
    music_genre in (
      'cinematic_ambient',
      'modern_luxury',
      'minimal_piano',
      'lounge_downtempo',
      'soft_electronic',
      'no_music'
    )
  );
