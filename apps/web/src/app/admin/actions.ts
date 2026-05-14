"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
