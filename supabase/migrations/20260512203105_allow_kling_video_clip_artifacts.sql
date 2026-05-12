update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type order by mime_type)
  from unnest(
    coalesce(allowed_mime_types, '{}'::text[])
    || array['application/json', 'video/mp4', 'video/quicktime']::text[]
  ) as mime_type
)
where id = 'project-generated-clips';
