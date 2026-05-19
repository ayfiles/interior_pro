"use server";

import { revalidatePath } from "next/cache";
import { getVideoImageRequirements } from "@interior-pro/shared";
import {
  inngest,
  PROJECT_SUBMITTED_EVENT,
  type ProjectSubmittedEventData,
} from "@/inngest/client";
import { getRequiredWorkspace } from "@/lib/workspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_REQUIREMENTS = getVideoImageRequirements();

export interface CreateProjectInput {
  customerName: string;
  imageStorageKeys: string[];
  musicGenre: string;
  musicId?: string | null;
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

export type EnqueueProjectPipelineResult =
  | {
      eventIds: string[];
      ok: true;
    }
  | {
      error: string;
      ok: false;
    };

function cleanText(value: string, fallback = "") {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

async function sendProjectSubmittedEvent(data: ProjectSubmittedEventData) {
  return inngest.send({
    data,
    id: `project-submitted-${data.projectId}`,
    name: PROJECT_SUBMITTED_EVENT,
  });
}

export async function createProjectFromUploadedAssets(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const { organization, supabase, user } = await getRequiredWorkspace();
  const customerName = cleanText(input.customerName);
  const musicGenre = cleanText(input.musicGenre, "cinematic_ambient");
  const musicId = input.musicId?.trim() || null;
  const voiceSelection = cleanText(input.voiceSelection, "speaker_amelie");
  const specialNotes = input.specialNotes?.trim() || null;

  if (!UUID_PATTERN.test(input.projectId)) {
    return { error: "Invalid project id.", ok: false };
  }

  if (musicId && !UUID_PATTERN.test(musicId)) {
    return { error: "Invalid music track id.", ok: false };
  }

  if (!customerName) {
    return { error: "Customer or collection name is required.", ok: false };
  }

  if (
    input.imageStorageKeys.length < IMAGE_REQUIREMENTS.minImages ||
    input.imageStorageKeys.length > IMAGE_REQUIREMENTS.maxImages
  ) {
    return {
      error: `Upload ${IMAGE_REQUIREMENTS.minImages}-${IMAGE_REQUIREMENTS.maxImages} product images.`,
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
    music_genre: musicGenre,
    music_id: musicId,
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
      musicGenre,
      voiceSelection,
    },
    project_id: input.projectId,
    status: "completed",
    step: "intake",
  });

  if (logError) {
    return { error: logError.message, ok: false };
  }

  const eventResult = await sendProjectSubmittedEvent({
    imageCount: input.imageStorageKeys.length,
    organizationId: organization.id,
    projectId: input.projectId,
    submittedBy: user.id,
  });

  if (!eventResult.ids.length) {
    return { error: "Project was created, but pipeline enqueue failed.", ok: false };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/projects/${input.projectId}`);

  return { ok: true, projectId: input.projectId };
}

export async function enqueueProjectPipeline(
  projectId: string,
): Promise<EnqueueProjectPipelineResult> {
  const { organization, supabase, user } = await getRequiredWorkspace();

  if (!UUID_PATTERN.test(projectId)) {
    return { error: "Invalid project id.", ok: false };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, status")
    .eq("id", projectId)
    .eq("organization_id", organization.id)
    .single();

  if (projectError || !project) {
    return {
      error: projectError?.message ?? "Project not found.",
      ok: false,
    };
  }

  if (!["submitted", "queued", "validating"].includes(project.status)) {
    return {
      error: `Project cannot be queued from status ${project.status}.`,
      ok: false,
    };
  }

  const { count: imageCount, error: imageCountError } = await supabase
    .from("project_images")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (imageCountError) {
    return { error: imageCountError.message, ok: false };
  }

  const eventResult = await sendProjectSubmittedEvent({
    imageCount: imageCount ?? 0,
    organizationId: organization.id,
    projectId,
    submittedBy: user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`);

  return { eventIds: eventResult.ids, ok: true };
}
