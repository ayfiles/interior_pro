import { createClient } from "@supabase/supabase-js";

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publicKey) {
    throw new Error("Missing public Supabase environment variables.");
  }

  return createClient(url, publicKey);
}

export const STORAGE_BUCKETS = {
  sourceAssets: "project-source-assets",
  generatedClips: "project-generated-clips",
  finalOutputs: "project-final-outputs",
  musicTracks: "music-tracks",
} as const;

export function projectStoragePrefix(organizationId: string, projectId: string) {
  return `${organizationId}/${projectId}`;
}
