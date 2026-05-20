"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { publishAdminPromptVersion } from "@/lib/admin/prompts";
import { createAdminClient, type Json } from "@/lib/supabase/admin";
import {
  inngest,
  PROJECT_SUBMITTED_EVENT,
  TESTING_RUN_QUEUED_EVENT,
  type ProjectSubmittedEventData,
} from "@/inngest/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_STATUSES = new Set([
  "draft",
  "submitted",
  "queued",
  "validating",
  "upscaling",
  "generating_video",
  "media_qc",
  "editing",
  "rendering",
  "quality_check",
  "completed",
  "failed",
  "canceled",
]);
const PROVIDER_JOB_STATUSES = new Set([
  "started",
  "submitted",
  "processing",
  "completed",
  "failed",
  "requires_manual_retry",
  "canceled",
]);
const RETRYABLE_PROVIDER_JOB_STATUSES = new Set([
  "failed",
  "requires_manual_retry",
  "canceled",
]);
const RETRY_STEP_STATUS: Record<string, string> = {
  quality_check: "quality_check",
  rendering: "rendering",
  upscaling: "upscaling",
  video_generation: "generating_video",
};
const RUNNING_PROVIDER_JOB_STATUSES = new Set([
  "processing",
  "started",
  "submitted",
]);
const MAX_MUSIC_PLAN_TEXT_LENGTH = 50_000;
const TEST_RUN_STEPS = new Set([
  "image_upscaler",
  "video_agent",
  "kling_video",
  "media_qc",
  "editor_agent",
  "voice_music",
  "remotion_render",
  "full_pipeline",
]);
const TEST_RUN_MODES = new Set(["only_step", "from_step"]);
const TEST_RUN_KLING_MODES = new Set(["auto", "single_shot", "multi_shot"]);
const AUDIO_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
const TEST_RUN_UPLOAD_FIELDS: Array<{
  bucket: (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];
  field: string;
  kind: string;
}> = [
  {
    bucket: STORAGE_BUCKETS.sourceAssets,
    field: "sourceImages",
    kind: "source_image",
  },
  {
    bucket: STORAGE_BUCKETS.sourceAssets,
    field: "enhancedImages",
    kind: "enhanced_image",
  },
  {
    bucket: STORAGE_BUCKETS.generatedClips,
    field: "videoClips",
    kind: "video_clip",
  },
  {
    bucket: STORAGE_BUCKETS.finalOutputs,
    field: "renderManifests",
    kind: "render_manifest",
  },
  {
    bucket: STORAGE_BUCKETS.finalOutputs,
    field: "voiceoverAudio",
    kind: "voiceover_audio",
  },
  {
    bucket: STORAGE_BUCKETS.musicTracks,
    field: "musicAudio",
    kind: "music_audio",
  },
];

function errorMessageFromUnknown(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function requireFormText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function optionalFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function optionalFormFileText(formData: FormData, key: string) {
  const file = formData.get(key);

  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  const text = (await file.text()).trim();
  return text || null;
}

function validateMusicPlanJson(rawPlanJson: string | null) {
  if (!rawPlanJson) {
    return null;
  }

  if (rawPlanJson.length > MAX_MUSIC_PLAN_TEXT_LENGTH) {
    throw new Error("Music plan JSON is too large.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawPlanJson);
  } catch {
    throw new Error("Music plan JSON is invalid.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Music plan JSON must be an object.");
  }

  const plan = parsed as Record<string, unknown>;
  const numberArrayKeys = [
    "cutPointsSeconds",
    "secondaryAccentPointsSeconds",
    "preferredHardCutSpacingSeconds",
  ];

  for (const key of numberArrayKeys) {
    const value = plan[key];

    if (value === undefined) {
      continue;
    }

    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "number" || !Number.isFinite(item))
    ) {
      throw new Error(`${key} must be an array of numbers.`);
    }
  }

  return parsed as Json;
}

function validateMusicInstructionsMd(instructionsMd: string | null) {
  if (!instructionsMd) {
    return null;
  }

  if (instructionsMd.length > MAX_MUSIC_PLAN_TEXT_LENGTH) {
    throw new Error("Music instructions Markdown is too large.");
  }

  return instructionsMd;
}

function safeStorageName(fileName: string, index: number) {
  const cleanName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return `${String(index + 1).padStart(2, "0")}-${cleanName || "asset"}`;
}

function formFiles(formData: FormData, field: string) {
  return formData
    .getAll(field)
    .filter((value): value is File => value instanceof File && value.size > 0);
}

function fileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function audioContentTypeForFile(file: File) {
  const inferred = AUDIO_CONTENT_TYPES_BY_EXTENSION[fileExtension(file.name)];

  if (inferred) {
    return inferred;
  }

  if (file.type.startsWith("audio/")) {
    return file.type;
  }

  throw new Error("Upload a supported audio file, for example MP3, WAV, M4A, OGG, AAC, or FLAC.");
}

function contentTypeForAdminUpload(file: File, kind: string) {
  if (kind === "music_audio" || kind === "voiceover_audio") {
    return audioContentTypeForFile(file);
  }

  return file.type || "application/octet-stream";
}

async function uploadBodyForFile(file: File, contentType: string) {
  return new Blob([await file.arrayBuffer()], { type: contentType });
}

function buildInngestDispatchFailureMessage(errorMessage: string) {
  const devServerUrl =
    process.env.INNGEST_DEV && process.env.INNGEST_DEV !== "1"
      ? process.env.INNGEST_DEV
      : "http://localhost:8288";

  return `Testing run was saved, but Inngest dispatch failed: ${errorMessage}. Start the Inngest dev server at ${devServerUrl} and re-queue this run.`;
}

async function queueAdminTestingRunEvent({
  actorUserId,
  inputSummary,
  runId,
  runMode,
  source,
  targetStep,
}: {
  actorUserId: string;
  inputSummary: Json;
  runId: string;
  runMode: string;
  source: string;
  targetStep: string;
}) {
  const admin = createAdminClient();
  const queuedAt = new Date().toISOString();
  const { error: queueError } = await admin
    .from("testing_runs")
    .update({
      error_message: null,
      queued_at: queuedAt,
      status: "queued",
      updated_at: queuedAt,
    })
    .eq("id", runId);

  if (queueError) {
    throw queueError;
  }

  await admin.from("testing_run_logs").insert({
    message: "Testing run queued from admin.",
    metadata: {
      inputSummary,
      runMode,
      source,
      targetStep,
    },
    run_id: runId,
    status: "info",
    step: "queue",
  });

  try {
    const event = await inngest.send({
      data: {
        queuedBy: actorUserId,
        runId,
      },
      id: `testing-run-${runId}-${Date.now()}`,
      name: TESTING_RUN_QUEUED_EVENT,
    });

    await admin.from("testing_run_logs").insert({
      message: "Testing run dispatched to Inngest.",
      metadata: {
        eventIds: event.ids,
        runMode,
        source,
        targetStep,
      },
      run_id: runId,
      status: "completed",
      step: "queue",
    });

    return {
      eventIds: event.ids,
      ok: true,
    };
  } catch (error) {
    const rawMessage = errorMessageFromUnknown(
      error,
      "Unknown dispatch error.",
    );
    const message = buildInngestDispatchFailureMessage(rawMessage);
    const failedAt = new Date().toISOString();

    await admin
      .from("testing_runs")
      .update({
        error_message: message,
        status: "failed",
        updated_at: failedAt,
      })
      .eq("id", runId);

    await admin.from("testing_run_logs").insert({
      message,
      metadata: {
        rawMessage,
        runMode,
        source,
        targetStep,
      },
      run_id: runId,
      status: "failed",
      step: "queue",
    });

    return {
      errorMessage: message,
      ok: false,
    };
  }
}

async function sendProjectPipelineEvent({
  actorUserId,
  eventPrefix,
  projectId,
}: {
  actorUserId: string;
  eventPrefix: string;
  projectId: string;
}) {
  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, organization_id, created_by, status")
    .eq("id", projectId)
    .single();

  if (projectError) {
    throw projectError;
  }

  const { count: imageCount, error: imageCountError } = await admin
    .from("project_images")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (imageCountError) {
    throw imageCountError;
  }

  const eventData: ProjectSubmittedEventData = {
    imageCount: imageCount ?? 0,
    organizationId: project.organization_id,
    projectId: project.id,
    submittedBy: actorUserId,
  };
  const event = await inngest.send({
    data: eventData,
    id: `${eventPrefix}-${project.id}-${Date.now()}`,
    name: PROJECT_SUBMITTED_EVENT,
  });

  return {
    event,
    project,
  };
}

export async function publishPromptVersion(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const slug = requireFormText(formData, "slug");
  const body = requireFormText(formData, "body");
  const changeNote = optionalFormText(formData, "changeNote");

  await publishAdminPromptVersion({
    actor,
    body,
    changeNote,
    slug,
  });

  revalidatePath("/admin/prompts");
  redirect(`/admin/prompts?prompt=${encodeURIComponent(slug)}&saved=1`);
}

export async function resumeAdminProjectPipeline(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const projectId = requireFormText(formData, "projectId");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? "/admin/testing";

  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Invalid project id.");
  }

  const { event, project } = await sendProjectPipelineEvent({
    actorUserId: actor.userId,
    eventPrefix: "admin-resume",
    projectId,
  });

  await writeAdminAuditLog({
    action: "project.pipeline.resume",
    actor,
    metadata: {
      eventIds: event.ids,
      previousStatus: project.status,
    },
    resourceId: project.id,
    resourceType: "project",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/projects");
  revalidatePath("/admin/testing");
  redirect(`${redirectTo}?queued=${encodeURIComponent(project.id)}`);
}

export async function createAdminTestingRun(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const name = requireFormText(formData, "name");
  const requestedTargetStep = requireFormText(formData, "targetStep");
  const targetStep =
    requestedTargetStep === "enhancement_agent"
      ? "image_upscaler"
      : requestedTargetStep;
  const runMode = requireFormText(formData, "runMode");
  const notes = optionalFormText(formData, "notes");
  const customerName = optionalFormText(formData, "customerName");
  const musicGenre = optionalFormText(formData, "musicGenre");
  const musicId = optionalFormText(formData, "musicId");
  const voiceSelection = optionalFormText(formData, "voiceSelection");
  const expectedDurationSecondsRaw = optionalFormText(
    formData,
    "expectedDurationSeconds",
  );
  const promptOverride = optionalFormText(formData, "promptOverride");
  const klingMode = optionalFormText(formData, "klingMode") ?? "auto";
  const runId = crypto.randomUUID();

  if (!TEST_RUN_STEPS.has(targetStep)) {
    throw new Error("Invalid testing step.");
  }

  if (!TEST_RUN_MODES.has(runMode)) {
    throw new Error("Invalid testing run mode.");
  }

  if (!TEST_RUN_KLING_MODES.has(klingMode)) {
    throw new Error("Invalid Kling mode.");
  }

  if (musicId && !UUID_PATTERN.test(musicId)) {
    throw new Error("Invalid music track id.");
  }

  const expectedDurationSeconds = expectedDurationSecondsRaw
    ? Number(expectedDurationSecondsRaw)
    : null;

  if (
    expectedDurationSeconds !== null &&
    (!Number.isFinite(expectedDurationSeconds) || expectedDurationSeconds <= 0)
  ) {
    throw new Error("Invalid expected duration.");
  }

  const admin = createAdminClient();
  const config = {
    customerName,
    expectedDurationSeconds,
    klingMode,
    musicGenre,
    musicId,
    notes,
    promptOverride,
    voiceSelection,
  } satisfies Record<string, Json | undefined>;
  const inputSummary: Record<string, Json> = {};

  for (const upload of TEST_RUN_UPLOAD_FIELDS) {
    const files = formFiles(formData, upload.field);

    if (files.length) {
      inputSummary[upload.kind] = files.map((file) => ({
        name: file.name,
        size: file.size,
        type: contentTypeForAdminUpload(file, upload.kind),
      }));
    }
  }

  const { error: createError } = await admin.from("testing_runs").insert({
    config: config as Json,
    id: runId,
    input_summary: inputSummary,
    name,
    requested_by: actor.userId,
    run_mode: runMode,
    status: "draft",
    target_step: targetStep,
  });

  if (createError) {
    throw createError;
  }

  try {
    for (const upload of TEST_RUN_UPLOAD_FIELDS) {
      const files = formFiles(formData, upload.field);

      for (const [index, file] of files.entries()) {
        const contentType = contentTypeForAdminUpload(file, upload.kind);
        const storageKey = `testing/${runId}/inputs/${upload.kind}/${safeStorageName(
          file.name,
          index,
        )}`;
        const { error: uploadError } = await admin.storage
          .from(upload.bucket)
          .upload(storageKey, await uploadBodyForFile(file, contentType), {
            contentType,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { error: assetError } = await admin
          .from("testing_run_assets")
          .insert({
            bucket: upload.bucket,
            content_type: contentType,
            file_name: file.name,
            file_size_bytes: file.size,
            kind: upload.kind,
            metadata: {
              field: upload.field,
            },
            run_id: runId,
            storage_key: storageKey,
          });

        if (assetError) {
          throw assetError;
        }
      }
    }

    const dispatch = await queueAdminTestingRunEvent({
      actorUserId: actor.userId,
      inputSummary: inputSummary as Json,
      runId,
      runMode,
      source: "admin_create",
      targetStep,
    });

    await writeAdminAuditLog({
      action: dispatch.ok
        ? "testing_run.create"
        : "testing_run.dispatch_failed",
      actor,
      metadata: {
        dispatch,
        runMode,
        targetStep,
      },
      resourceId: runId,
      resourceType: "testing_run",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    await admin
      .from("testing_runs")
      .update({
        error_message: message,
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }

  revalidatePath("/admin/testing");
  redirect(`/admin/testing/${runId}`);
}

export async function queueAdminTestingRun(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const runId = requireFormText(formData, "testingRunId");

  if (!UUID_PATTERN.test(runId)) {
    throw new Error("Invalid testing run id.");
  }

  const admin = createAdminClient();
  const { data: run, error: runError } = await admin
    .from("testing_runs")
    .select("id, input_summary, run_mode, status, target_step")
    .eq("id", runId)
    .single();

  if (runError) {
    throw runError;
  }

  if (["queued", "running"].includes(run.status)) {
    throw new Error(`Testing run is already ${run.status}.`);
  }

  const dispatch = await queueAdminTestingRunEvent({
    actorUserId: actor.userId,
    inputSummary: run.input_summary,
    runId,
    runMode: run.run_mode,
    source: "admin_requeue",
    targetStep: run.target_step,
  });

  await writeAdminAuditLog({
    action: dispatch.ok ? "testing_run.requeue" : "testing_run.dispatch_failed",
    actor,
    metadata: {
      dispatch,
      runMode: run.run_mode,
      targetStep: run.target_step,
    },
    resourceId: runId,
    resourceType: "testing_run",
  });

  revalidatePath("/admin/testing");
  revalidatePath(`/admin/testing/${runId}`);
  redirect(`/admin/testing/${runId}`);
}

export async function resetAndRetryAdminProviderJob(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const jobId = requireFormText(formData, "providerJobId");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? "/admin/provider-jobs";

  if (!UUID_PATTERN.test(jobId)) {
    throw new Error("Invalid provider job id.");
  }

  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("provider_jobs")
    .select(
      "id, project_id, project_image_id, step, provider, model, status, external_task_id, output_storage_key, credits_consumed, estimated_cost_usd, error_message",
    )
    .eq("id", jobId)
    .single();

  if (jobError) {
    throw jobError;
  }

  if (!RETRYABLE_PROVIDER_JOB_STATUSES.has(job.status)) {
    throw new Error(
      `Provider job ${job.id} is ${job.status}; only failed, requires_manual_retry, or canceled jobs can be reset for retry.`,
    );
  }

  const nextProjectStatus = RETRY_STEP_STATUS[job.step];

  if (!nextProjectStatus) {
    throw new Error(`Provider job step ${job.step} cannot be retried.`);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("credit_reservations")
    .select("id, status")
    .eq("project_id", job.project_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reservationError) {
    throw reservationError;
  }

  if (reservation && reservation.status !== "reserved") {
    throw new Error(
      `Project credit reservation is ${reservation.status}; create or restore a reserved credit before retrying paid provider work.`,
    );
  }

  if (
    ["upscaling", "video_generation"].includes(job.step) &&
    !job.project_image_id
  ) {
    throw new Error(`Provider job ${job.id} has no project image id.`);
  }

  if (job.step === "upscaling") {
    const projectImageId = job.project_image_id;
    if (!projectImageId) {
      throw new Error(`Provider job ${job.id} has no project image id.`);
    }

    const { error } = await admin
      .from("project_images")
      .update({
        upscaled_storage_key: null,
        video_storage_key: null,
        video_status: "pending",
      })
      .eq("id", projectImageId);

    if (error) {
      throw error;
    }
  }

  if (job.step === "video_generation") {
    const projectImageId = job.project_image_id;
    if (!projectImageId) {
      throw new Error(`Provider job ${job.id} has no project image id.`);
    }

    const { error } = await admin
      .from("project_images")
      .update({
        video_storage_key: null,
        video_status: "upscaled",
      })
      .eq("id", projectImageId);

    if (error) {
      throw error;
    }
  }

  const { error: deleteError } = await admin
    .from("provider_jobs")
    .delete()
    .eq("id", job.id);

  if (deleteError) {
    throw deleteError;
  }

  const now = new Date().toISOString();
  const { error: projectUpdateError } = await admin
    .from("projects")
    .update({
      error_message: null,
      status: nextProjectStatus,
      updated_at: now,
    })
    .eq("id", job.project_id);

  if (projectUpdateError) {
    throw projectUpdateError;
  }

  await admin.from("pipeline_logs").insert({
    message: `Admin reset provider job ${job.id} and queued ${job.step} retry.`,
    metadata: {
      actorUserId: actor.userId,
      deletedProviderJob: job,
      nextProjectStatus,
      retryMayConsumeProviderCredits: true,
    },
    project_id: job.project_id,
    status: "completed",
    step: "admin_retry",
  });

  const { event } = await sendProjectPipelineEvent({
    actorUserId: actor.userId,
    eventPrefix: `admin-provider-retry-${job.step}`,
    projectId: job.project_id,
  });

  await writeAdminAuditLog({
    action: "provider_job.retry",
    actor,
    metadata: {
      deletedProviderJob: job,
      eventIds: event.ids,
      nextProjectStatus,
      retryMayConsumeProviderCredits: true,
    },
    resourceId: job.id,
    resourceType: "provider_job",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/provider-jobs");
  revalidatePath(`/admin/projects/${job.project_id}`);
  redirect(`${redirectTo}?retried=${encodeURIComponent(job.id)}`);
}

export async function markStaleAdminProviderJobForRetry(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const jobId = requireFormText(formData, "providerJobId");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? "/admin/provider-jobs";

  if (!UUID_PATTERN.test(jobId)) {
    throw new Error("Invalid provider job id.");
  }

  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("provider_jobs")
    .select(
      "id, project_id, step, provider, model, status, updated_at, error_message",
    )
    .eq("id", jobId)
    .single();

  if (jobError) {
    throw jobError;
  }

  if (!RUNNING_PROVIDER_JOB_STATUSES.has(job.status)) {
    throw new Error(
      `Provider job ${job.id} is ${job.status}; only started, submitted, or processing jobs can be marked stale.`,
    );
  }

  const staleMinutes = Math.floor(
    (Date.now() - new Date(job.updated_at).getTime()) / 60_000,
  );

  if (!Number.isFinite(staleMinutes) || staleMinutes < 30) {
    throw new Error(
      `Provider job ${job.id} was updated less than 30 minutes ago and is not considered stale yet.`,
    );
  }

  const message = `Marked stale by admin after ${staleMinutes} minutes without provider progress.`;
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("provider_jobs")
    .update({
      error_message: message,
      failed_at: now,
      status: "requires_manual_retry",
      updated_at: now,
    })
    .eq("id", job.id);

  if (updateError) {
    throw updateError;
  }

  await admin.from("pipeline_logs").insert({
    message: `Admin marked stale provider job ${job.id} for manual retry.`,
    metadata: {
      actorUserId: actor.userId,
      previousStatus: job.status,
      provider: job.provider,
      providerJobId: job.id,
      staleMinutes,
      step: job.step,
    },
    project_id: job.project_id,
    status: "completed",
    step: "admin_retry",
  });

  await writeAdminAuditLog({
    action: "provider_job.mark_stale",
    actor,
    metadata: {
      previousStatus: job.status,
      provider: job.provider,
      staleMinutes,
      step: job.step,
    },
    resourceId: job.id,
    resourceType: "provider_job",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/provider-jobs");
  revalidatePath(`/admin/projects/${job.project_id}`);
  redirect(`${redirectTo}?stale=${encodeURIComponent(job.id)}`);
}

export async function setAdminProjectStatus(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const projectId = requireFormText(formData, "projectId");
  const status = requireFormText(formData, "status");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? `/admin/projects/${projectId}`;

  if (!UUID_PATTERN.test(projectId) || !PROJECT_STATUSES.has(status)) {
    throw new Error("Invalid project status request.");
  }

  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .single();

  if (projectError) {
    throw projectError;
  }

  const { error: updateError } = await admin
    .from("projects")
    .update({
      error_message: status === "failed" ? "Marked failed by admin." : null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  if (updateError) {
    throw updateError;
  }

  await admin.from("pipeline_logs").insert({
    message: `Admin changed project status from ${project.status} to ${status}.`,
    metadata: {
      actorUserId: actor.userId,
      previousStatus: project.status,
    },
    project_id: projectId,
    status: "completed",
    step: "admin",
  });

  await writeAdminAuditLog({
    action: "project.status.update",
    actor,
    metadata: {
      nextStatus: status,
      previousStatus: project.status,
    },
    resourceId: projectId,
    resourceType: "project",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  redirect(redirectTo);
}

export async function cancelAdminProject(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const projectId = requireFormText(formData, "projectId");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? `/admin/projects/${projectId}`;

  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Invalid project id.");
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .single();

  if (projectError) {
    throw projectError;
  }

  const { error: projectUpdateError } = await admin
    .from("projects")
    .update({
      error_message: "Canceled by admin.",
      status: "canceled",
      updated_at: now,
    })
    .eq("id", projectId);

  if (projectUpdateError) {
    throw projectUpdateError;
  }

  const { error: reservationError } = await admin
    .from("credit_reservations")
    .update({
      status: "released",
      updated_at: now,
    })
    .eq("project_id", projectId)
    .eq("status", "reserved");

  if (reservationError) {
    throw reservationError;
  }

  await admin.from("pipeline_logs").insert({
    message:
      "Project canceled and active credit reservations released by admin.",
    metadata: {
      actorUserId: actor.userId,
      previousStatus: project.status,
    },
    project_id: projectId,
    status: "completed",
    step: "admin",
  });

  await writeAdminAuditLog({
    action: "project.cancel",
    actor,
    metadata: {
      previousStatus: project.status,
    },
    resourceId: projectId,
    resourceType: "project",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  redirect(redirectTo);
}

export async function updateAdminProviderJobStatus(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const jobId = requireFormText(formData, "providerJobId");
  const status = requireFormText(formData, "status");
  const redirectTo =
    optionalFormText(formData, "redirectTo") ?? "/admin/provider-jobs";

  if (!UUID_PATTERN.test(jobId) || !PROVIDER_JOB_STATUSES.has(status)) {
    throw new Error("Invalid provider job status request.");
  }

  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("provider_jobs")
    .select("id, project_id, status")
    .eq("id", jobId)
    .single();

  if (jobError) {
    throw jobError;
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("provider_jobs")
    .update({
      error_message:
        status === "requires_manual_retry"
          ? "Marked for manual retry by admin."
          : null,
      failed_at: status === "failed" ? now : null,
      status,
      updated_at: now,
    })
    .eq("id", jobId);

  if (updateError) {
    throw updateError;
  }

  await admin.from("pipeline_logs").insert({
    message: `Admin changed provider job ${jobId} from ${job.status} to ${status}.`,
    metadata: {
      actorUserId: actor.userId,
      previousStatus: job.status,
      providerJobId: jobId,
    },
    project_id: job.project_id,
    status: "completed",
    step: "admin",
  });

  await writeAdminAuditLog({
    action: "provider_job.status.update",
    actor,
    metadata: {
      nextStatus: status,
      previousStatus: job.status,
      projectId: job.project_id,
    },
    resourceId: jobId,
    resourceType: "provider_job",
  });

  revalidatePath("/admin/provider-jobs");
  revalidatePath(`/admin/projects/${job.project_id}`);
  redirect(redirectTo);
}

export async function grantPlatformAdminByEmail(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const email = requireFormText(formData, "email").toLowerCase();
  const role = requireFormText(formData, "role");

  if (!["owner", "operator", "viewer"].includes(role)) {
    throw new Error("Invalid admin role.");
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .single();

  if (profileError) {
    throw profileError;
  }

  const { error: upsertError } = await admin.from("platform_admins").upsert({
    created_by: actor.userId,
    role,
    status: "active",
    updated_at: new Date().toISOString(),
    user_id: profile.id,
  });

  if (upsertError) {
    throw upsertError;
  }

  await writeAdminAuditLog({
    action: "platform_admin.grant",
    actor,
    metadata: {
      email: profile.email,
      role,
    },
    resourceId: profile.id,
    resourceType: "platform_admin",
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?updated=1");
}

export async function addAdminCreditAdjustment(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requireFormText(formData, "organizationId");
  const amount = Number(requireFormText(formData, "amount"));
  const note = optionalFormText(formData, "note");

  if (
    !UUID_PATTERN.test(organizationId) ||
    !Number.isInteger(amount) ||
    amount === 0
  ) {
    throw new Error("Invalid credit adjustment.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("video_credit_ledger").insert({
    amount,
    entry_type: "adjustment",
    metadata: {
      actorUserId: actor.userId,
      note,
      source: "admin",
    },
    organization_id: organizationId,
  });

  if (error) {
    throw error;
  }

  await writeAdminAuditLog({
    action: "credits.adjust",
    actor,
    metadata: {
      amount,
      note,
    },
    resourceId: organizationId,
    resourceType: "organization",
  });

  revalidatePath("/admin/credits");
  redirect("/admin/credits?adjusted=1");
}

export async function upsertAdminMusicTrack(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const name = requireFormText(formData, "name");
  const genre = optionalFormText(formData, "genre");
  const lengthProfile = requireFormText(formData, "lengthProfile");
  const trackGroupKey = optionalFormText(formData, "trackGroupKey");
  const durationSeconds = Number(requireFormText(formData, "durationSeconds"));
  const existingStorageKey = optionalFormText(formData, "storageKey");
  const planJson = validateMusicPlanJson(
    (await optionalFormFileText(formData, "planFile")) ??
      optionalFormText(formData, "planJson"),
  );
  const instructionsMd = validateMusicInstructionsMd(
    (await optionalFormFileText(formData, "instructionsFile")) ??
      optionalFormText(formData, "instructionsMd"),
  );
  const file = formData.get("musicFile");

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Invalid track duration.");
  }

  if (lengthProfile !== "short" && lengthProfile !== "long") {
    throw new Error("Invalid music length profile.");
  }

  const admin = createAdminClient();
  let fileStorageKey = existingStorageKey;

  if (file instanceof File && file.size > 0) {
    const extension = fileExtension(file.name) || "mp3";
    const contentType = audioContentTypeForFile(file);
    fileStorageKey = `admin/${Date.now()}-${
      file.name
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/^-+|-+$/g, "") || `track.${extension}`
    }`;
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKETS.musicTracks)
      .upload(fileStorageKey, await uploadBodyForFile(file, contentType), {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }
  }

  if (!fileStorageKey) {
    throw new Error("Upload a track or provide an existing storage key.");
  }

  const { data: track, error } = await admin
    .from("music_tracks")
    .insert({
      duration_seconds: durationSeconds,
      file_storage_key: fileStorageKey,
      genre,
      instructions_md: instructionsMd,
      is_active: true,
      length_profile: lengthProfile,
      name,
      plan_json: planJson,
      track_group_key: trackGroupKey,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  await writeAdminAuditLog({
    action: "music_track.create",
    actor,
    metadata: {
      durationSeconds,
      fileStorageKey,
      genre,
      hasInstructions: Boolean(instructionsMd),
      hasPlan: Boolean(planJson),
      lengthProfile,
      name,
      trackGroupKey,
    },
    resourceId: track.id,
    resourceType: "music_track",
  });

  revalidatePath("/admin/music");
  redirect("/admin/music?created=1");
}

export async function updateAdminMusicTrackPlan(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const trackId = requireFormText(formData, "trackId");

  if (!UUID_PATTERN.test(trackId)) {
    throw new Error("Invalid music track id.");
  }

  const planJson = validateMusicPlanJson(
    (await optionalFormFileText(formData, "planFile")) ??
      optionalFormText(formData, "planJson"),
  );
  const instructionsMd = validateMusicInstructionsMd(
    (await optionalFormFileText(formData, "instructionsFile")) ??
      optionalFormText(formData, "instructionsMd"),
  );
  const admin = createAdminClient();
  const { error } = await admin
    .from("music_tracks")
    .update({
      instructions_md: instructionsMd,
      plan_json: planJson,
    })
    .eq("id", trackId);

  if (error) {
    throw error;
  }

  await writeAdminAuditLog({
    action: "music_track.plan_update",
    actor,
    metadata: {
      hasInstructions: Boolean(instructionsMd),
      hasPlan: Boolean(planJson),
    },
    resourceId: trackId,
    resourceType: "music_track",
  });

  revalidatePath("/admin/music");
  redirect("/admin/music?updated=1");
}

export async function toggleAdminMusicTrack(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const trackId = requireFormText(formData, "trackId");
  const isActive = requireFormText(formData, "isActive") === "true";

  if (!UUID_PATTERN.test(trackId)) {
    throw new Error("Invalid music track id.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("music_tracks")
    .update({
      is_active: isActive,
    })
    .eq("id", trackId);

  if (error) {
    throw error;
  }

  await writeAdminAuditLog({
    action: "music_track.toggle",
    actor,
    metadata: {
      isActive,
    },
    resourceId: trackId,
    resourceType: "music_track",
  });

  revalidatePath("/admin/music");
  redirect("/admin/music?updated=1");
}
