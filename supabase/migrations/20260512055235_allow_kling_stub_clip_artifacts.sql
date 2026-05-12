update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type)
  from unnest(
    coalesce(allowed_mime_types, '{}'::text[])
    || array['application/json']::text[]
  ) as mime_type
)
where id = 'project-generated-clips';
