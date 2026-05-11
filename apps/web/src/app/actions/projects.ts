"use server";

import { revalidatePath } from "next/cache";
import { VIDEO_REQUIREMENTS } from "@interior-pro/shared";
import { getRequiredWorkspace } from "@/lib/workspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateProjectInput {
  customerName: string;
  imageStorageKeys: string[];
  projectId: string;
  specialNotes: string | null;
  voiceSelection: string;
}

export type CreateProjectResult =
  | {
      ok: true;
      projectId: string;
    }
  | {
      error: string;
      ok: false;
    };

function cleanText(value: string, fallback = "") {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function createProjectFromUploadedAssets(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const { organization, supabase, user } = await getRequiredWorkspace();
  const customerName = cleanText(input.customerName);
  const voiceSelection = cleanText(input.voiceSelection, "warm_editorial");
  const specialNotes = input.specialNotes?.trim() || null;

  if (!UUID_PATTERN.test(input.projectId)) {
    return { error: "Invalid project id.", ok: false };
  }

  if (!customerName) {
    return { error: "Customer or collection name is required.", ok: false };
  }

  if (
    input.imageStorageKeys.length < VIDEO_REQUIREMENTS.minImages ||
    input.imageStorageKeys.length > VIDEO_REQUIREMENTS.maxImages
  ) {
    return {
      error: `Upload ${VIDEO_REQUIREMENTS.minImages}-${VIDEO_REQUIREMENTS.maxImages} product images.`,
      ok: false,
    };
  }

  const expectedPrefix = `${organization.id}/${input.projectId}/source/`;
  const hasInvalidStorageKey = input.imageStorageKeys.some(
    (key) => !key.startsWith(expectedPrefix),
  );

  if (hasInvalidStorageKey) {
    return { error: "Uploaded images do not belong to this project.", ok: false };
  }

  const { error: projectError } = await supabase.from("projects").insert({
    created_by: user.id,
    customer_name: customerName,
    id: input.projectId,
    organization_id: organization.id,
    special_notes: specialNotes,
    status: "submitted",
    voice_selection: voiceSelection,
  });

  if (projectError) {
    return { error: projectError.message, ok: false };
  }

  const { error: imagesError } = await supabase.from("project_images").insert(
    input.imageStorageKeys.map((storageKey, index) => ({
      order_index: index,
      original_storage_key: storageKey,
      project_id: input.projectId,
      prompt_type: "multi_shot",
    })),
  );

  if (imagesError) {
    return { error: imagesError.message, ok: false };
  }

  const { error: reservationError } = await supabase
    .from("credit_reservations")
    .insert({
      amount: 1,
      organization_id: organization.id,
      project_id: input.projectId,
      status: "reserved",
    });

  if (reservationError) {
    return { error: reservationError.message, ok: false };
  }

  const { error: logError } = await supabase.from("pipeline_logs").insert({
    message: `${input.imageStorageKeys.length} source images uploaded`,
    metadata: {
      imageEnhancement: "nano-banana-pro",
      imageToVideo: "kling-3.0",
    },
    project_id: input.projectId,
    status: "completed",
    step: "intake",
  });

  if (logError) {
    return { error: logError.message, ok: false };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/projects/${input.projectId}`);

  return { ok: true, projectId: input.projectId };
}
