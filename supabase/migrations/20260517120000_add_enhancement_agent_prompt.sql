insert into public.admin_prompt_documents (slug, title, description, file_path)
values
  (
    'enhancement-agent',
    'Enhancement Agent',
    'Analyzes source images and creates image-specific preservation briefs before enhancement.',
    'src/inngest/prompts/enhancement-agent.md'
  )
on conflict (slug) do update
set
  description = excluded.description,
  file_path = excluded.file_path,
  title = excluded.title,
  updated_at = now();
