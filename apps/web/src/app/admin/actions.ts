"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { publishAdminPromptVersion } from "@/lib/admin/prompts";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  inngest,
  PROJECT_SUBMITTED_EVENT,
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
  const redirectTo = optionalFormText(formData, "redirectTo") ?? "/admin/testing";

  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Invalid project id.");
  }

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
    submittedBy: actor.userId,
  };
  const event = await inngest.send({
    data: eventData,
    id: `admin-resume-${project.id}-${Date.now()}`,
    name: PROJECT_SUBMITTED_EVENT,
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
    message: "Project canceled and active credit reservations released by admin.",
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
  const redirectTo = optionalFormText(formData, "redirectTo") ?? "/admin/provider-jobs";

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

  if (!UUID_PATTERN.test(organizationId) || !Number.isInteger(amount) || amount === 0) {
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
  const durationSeconds = Number(requireFormText(formData, "durationSeconds"));
  const existingStorageKey = optionalFormText(formData, "storageKey");
  const file = formData.get("musicFile");

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Invalid track duration.");
  }

  const admin = createAdminClient();
  let fileStorageKey = existingStorageKey;

  if (file instanceof File && file.size > 0) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "mp3";
    fileStorageKey = `admin/${Date.now()}-${file.name
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "") || `track.${extension}`}`;
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKETS.musicTracks)
      .upload(fileStorageKey, file, {
        contentType: file.type || "audio/mpeg",
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
      is_active: true,
      name,
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
      name,
    },
    resourceId: track.id,
    resourceType: "music_track",
  });

  revalidatePath("/admin/music");
  redirect("/admin/music?created=1");
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
