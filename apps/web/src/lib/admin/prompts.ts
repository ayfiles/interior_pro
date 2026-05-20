import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import type { PlatformAdminContext } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminPromptDocument {
  body: string;
  bodySource: "database" | "file";
  description: string | null;
  filePath: string;
  id: string;
  isActive: boolean;
  latestVersionNumber: number | null;
  publishedAt: string | null;
  slug: string;
  title: string;
  updatedAt: string;
}

const SEEDED_PROMPTS = [
  {
    description:
      "Assigns source images to single-shot or multi-shot generation modes.",
    filePath: "src/inngest/prompts/agent.md",
    slug: "agent",
    title: "Video Agent",
  },
  {
    description:
      "Shapes QC-approved clips into a structured luxury sales film.",
    filePath: "src/inngest/prompts/editor.md",
    slug: "editor",
    title: "Editor Agent",
  },
  {
    description:
      "Analyzes source images and creates image-specific preservation briefs before enhancement.",
    filePath: "src/inngest/prompts/enhancement-agent.md",
    slug: "enhancement-agent",
    title: "Enhancement Agent",
  },
  {
    description:
      "Primary Kling prompt for wider room perspectives and multi-shot motion.",
    filePath: "src/inngest/prompts/multi-shot.md",
    slug: "multi-shot",
    title: "Kling Multi-Shot",
  },
  {
    description:
      "Alternate Kling multi-shot prompt for the second multi-shot image with three slower scene beats.",
    filePath: "src/inngest/prompts/multi-shot-three-scene.md",
    slug: "multi-shot-three-scene",
    title: "Kling Multi-Shot Three-Scene",
  },
  {
    description: "Guides edit rhythm, ducking, and cut behavior for music genres.",
    filePath: "src/inngest/prompts/music.md",
    slug: "music",
    title: "Music Instructions",
  },
  {
    description: "Primary Kling prompt for single-image video generation.",
    filePath: "src/inngest/prompts/single-shot.md",
    slug: "single-shot",
    title: "Kling Single-Shot",
  },
  {
    description: "Controls image enhancement before image-to-video generation.",
    filePath: "src/inngest/prompts/upscaling.md",
    slug: "upscaling",
    title: "Nano Banana Pro Upscaling",
  },
  {
    description: "Guides German voiceover tone, length, and sales structure.",
    filePath: "src/inngest/prompts/voice.md",
    slug: "voice",
    title: "Voice Director",
  },
] as const;

type SeededPrompt = (typeof SEEDED_PROMPTS)[number];
const PROMPT_ROOT = path.join(process.cwd(), "src/inngest/prompts");

function resolvePromptPath(filePath: string) {
  return path.join(PROMPT_ROOT, path.basename(filePath));
}

async function readPromptFile(filePath: string) {
  return readFile(resolvePromptPath(filePath), "utf8");
}

function fallbackPromptForSlug(slug: string): SeededPrompt | undefined {
  return SEEDED_PROMPTS.find((prompt) => prompt.slug === slug);
}

async function syncSeededPromptDocuments() {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_prompt_documents").upsert(
    SEEDED_PROMPTS.map((prompt) => ({
      description: prompt.description,
      file_path: prompt.filePath,
      slug: prompt.slug,
      title: prompt.title,
    })),
    {
      onConflict: "slug",
    },
  );

  if (error) {
    throw error;
  }
}

export async function loadPipelinePrompt(slug: string) {
  const fallback = fallbackPromptForSlug(slug);
  const admin = createAdminClient();
  const { data: document, error: documentError } = await admin
    .from("admin_prompt_documents")
    .select("id, file_path")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (documentError || !document) {
    if (!fallback) {
      throw documentError ?? new Error(`Unknown pipeline prompt: ${slug}.`);
    }

    return (await readPromptFile(fallback.filePath)).trim();
  }

  const { data: version, error: versionError } = await admin
    .from("admin_prompt_versions")
    .select("body")
    .eq("document_id", document.id)
    .eq("status", "published")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError) {
    throw versionError;
  }

  return (version?.body ?? (await readPromptFile(document.file_path))).trim();
}

export async function listAdminPromptDocuments() {
  await syncSeededPromptDocuments();

  const admin = createAdminClient();
  const { data: documents, error: documentsError } = await admin
    .from("admin_prompt_documents")
    .select(
      "id, slug, title, description, file_path, is_active, created_at, updated_at",
    )
    .order("slug", { ascending: true });

  if (documentsError) {
    throw documentsError;
  }

  const documentRows = documents ?? [];
  const documentIds = documentRows.map((document) => document.id);
  const { data: versions, error: versionsError } = documentIds.length
    ? await admin
        .from("admin_prompt_versions")
        .select(
          "body, document_id, published_at, status, version_number, created_at",
        )
        .in("document_id", documentIds)
        .order("version_number", { ascending: false })
    : { data: [], error: null };

  if (versionsError) {
    throw versionsError;
  }

  return Promise.all(
    documentRows.map(async (document): Promise<AdminPromptDocument> => {
      const documentVersions = (versions ?? []).filter(
        (version) => version.document_id === document.id,
      );
      const publishedVersion = documentVersions.find(
        (version) => version.status === "published",
      );
      const latestVersion = documentVersions[0];

      return {
        body: publishedVersion?.body ?? (await readPromptFile(document.file_path)),
        bodySource: publishedVersion ? "database" : "file",
        description: document.description,
        filePath: document.file_path,
        id: document.id,
        isActive: document.is_active,
        latestVersionNumber: latestVersion?.version_number ?? null,
        publishedAt: publishedVersion?.published_at ?? null,
        slug: document.slug,
        title: document.title,
        updatedAt: document.updated_at,
      };
    }),
  );
}

export async function publishAdminPromptVersion({
  actor,
  body,
  changeNote,
  slug,
}: {
  actor: PlatformAdminContext;
  body: string;
  changeNote?: string | null;
  slug: string;
}) {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("Prompt body cannot be empty.");
  }

  const admin = createAdminClient();
  await syncSeededPromptDocuments();

  const { data: document, error: documentError } = await admin
    .from("admin_prompt_documents")
    .select("id, title")
    .eq("slug", slug)
    .single();

  if (documentError) {
    throw documentError;
  }

  const { data: latestVersion, error: latestVersionError } = await admin
    .from("admin_prompt_versions")
    .select("version_number")
    .eq("document_id", document.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestVersionError) {
    throw latestVersionError;
  }

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
  const now = new Date().toISOString();
  const { data: draftVersion, error: insertError } = await admin
    .from("admin_prompt_versions")
    .insert({
      body: trimmedBody,
      change_note: changeNote?.trim() || null,
      created_by: actor.userId,
      document_id: document.id,
      status: "draft",
      version_number: nextVersionNumber,
    })
    .select("id")
    .single();

  if (insertError) {
    throw insertError;
  }

  const { error: archiveError } = await admin
    .from("admin_prompt_versions")
    .update({
      status: "archived",
    })
    .eq("document_id", document.id)
    .eq("status", "published");

  if (archiveError) {
    throw archiveError;
  }

  const { error: publishError } = await admin
    .from("admin_prompt_versions")
    .update({
      published_at: now,
      status: "published",
    })
    .eq("id", draftVersion.id);

  if (publishError) {
    throw publishError;
  }

  const { error: documentUpdateError } = await admin
    .from("admin_prompt_documents")
    .update({
      updated_at: now,
    })
    .eq("id", document.id);

  if (documentUpdateError) {
    throw documentUpdateError;
  }

  await writeAdminAuditLog({
    action: "prompt.publish",
    actor,
    metadata: {
      changeNote: changeNote?.trim() || null,
      slug,
      title: document.title,
      versionNumber: nextVersionNumber,
    },
    resourceId: document.id,
    resourceType: "admin_prompt_document",
  });

  return {
    documentId: document.id,
    versionNumber: nextVersionNumber,
  };
}
