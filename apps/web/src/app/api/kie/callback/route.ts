import { NextResponse, type NextRequest } from "next/server";
import { KIE_CALLBACK_RECEIVED_EVENT, inngest } from "@/inngest/client";
import {
  asJsonObject,
  extractKieResultUrls,
  extractKieTaskId,
  isKieCallbackFailure,
} from "@/inngest/kie-callback";
import {
  getProviderJobByExternalTaskId,
  updateProviderJob,
} from "@/inngest/provider-jobs";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return token || null;
}

function isAuthorizedCallback(request: NextRequest) {
  const expectedSecret = process.env.KIE_CALLBACK_SECRET;

  if (!expectedSecret) {
    return true;
  }

  const providedSecret =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("x-kie-callback-secret") ??
    getBearerToken(request);

  return providedSecret === expectedSecret;
}

async function writePipelineLog({
  message,
  metadata,
  projectId,
  status,
  step,
}: {
  message: string;
  metadata?: Json;
  projectId: string;
  status: "completed" | "failed" | "skipped" | "started";
  step: string;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("pipeline_logs").insert({
    message,
    metadata: metadata ?? null,
    project_id: projectId,
    status,
    step,
  });

  if (error) {
    throw error;
  }
}

async function markKieCallbackFailed({
  payload,
  providerJobId,
  projectId,
  projectImageId,
  taskId,
}: {
  payload: Json;
  providerJobId: string;
  projectId: string;
  projectImageId: string | null;
  taskId: string;
}) {
  const supabase = createAdminClient();
  const response = asJsonObject(payload);
  const message =
    typeof response.msg === "string"
      ? response.msg
      : `KIE task ${taskId} failed.`;

  await updateProviderJob(providerJobId, {
    error_message: message,
    failed_at: new Date().toISOString(),
    response: {
      callbackPayload: payload,
      taskId,
    },
    status: "failed",
  });

  if (projectImageId) {
    const { error: imageError } = await supabase
      .from("project_images")
      .update({
        video_status: "failed",
      })
      .eq("id", projectImageId);

    if (imageError) {
      throw imageError;
    }
  }

  const { error: projectError } = await supabase
    .from("projects")
    .update({
      error_message: message,
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  if (projectError) {
    throw projectError;
  }

  await writePipelineLog({
    message,
    metadata: {
      providerJobId,
      taskId,
    },
    projectId,
    status: "failed",
    step: "video_generation",
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCallback(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Json;

  try {
    payload = (await request.json()) as Json;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const taskId = extractKieTaskId(payload);

  if (!taskId) {
    return NextResponse.json(
      { error: "Missing KIE task id" },
      { status: 400 },
    );
  }

  const providerJob = await getProviderJobByExternalTaskId(taskId);

  if (!providerJob) {
    return NextResponse.json(
      {
        ok: true,
        status: "unknown_task",
        taskId,
      },
      { status: 202 },
    );
  }

  const resultUrls = extractKieResultUrls(payload);

  if (isKieCallbackFailure(payload)) {
    await markKieCallbackFailed({
      payload,
      projectId: providerJob.project_id,
      projectImageId: providerJob.project_image_id,
      providerJobId: providerJob.id,
      taskId,
    });

    return NextResponse.json({
      ok: true,
      status: "failed",
      taskId,
    });
  }

  await updateProviderJob(providerJob.id, {
    response: {
      callbackPayload: payload,
      resultUrls,
      taskId,
    },
    status: providerJob.status === "completed" ? "completed" : "processing",
  });

  if (providerJob.status !== "completed") {
    await inngest.send({
      data: {
        providerJobId: providerJob.id,
        resultUrls,
        taskId,
      },
      name: KIE_CALLBACK_RECEIVED_EVENT,
    });
  }

  return NextResponse.json({
    ok: true,
    providerJobId: providerJob.id,
    status: providerJob.status === "completed" ? "already_completed" : "queued",
    taskId,
  });
}
