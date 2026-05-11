export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    isConfigured: Boolean(url && key),
    key,
    url,
  };
}

export function requireSupabasePublicConfig() {
  const config = getSupabasePublicConfig();

  if (!config.url || !config.key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return {
    key: config.key,
    url: config.url,
  };
}
