import { createAdminClient, type Json } from "@/lib/supabase/admin";

export type ProviderJobStatus =
  | "started"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "requires_manual_retry"
  | "canceled";

export type ProviderJobStep =
  | "upscaling"
  | "video_generation"
  | "rendering"
  | "quality_check";

export interface ProviderJob {
  completed_at: string | null;
  created_at: string;
  credits_consumed: number | null;
  error_message: string | null;
  estimated_cost_usd: number | null;
  external_task_id: string | null;
  failed_at: string | null;
  file_size_bytes: number | null;
  id: string;
  idempotency_key: string;
  model: string;
  output_storage_key: string | null;
  project_id: string;
  project_image_id: string | null;
  provider: string;
  request: Json;
  response: Json;
  started_at: string;
  status: ProviderJobStatus;
  step: ProviderJobStep;
  submitted_at: string | null;
  updated_at: string;
}

interface EnsureProviderJobInput {
  idempotencyKey: string;
  model: string;
  outputStorageKey?: string | null;
  projectId: string;
  projectImageId?: string | null;
  provider: string;
  request?: Json;
  step: ProviderJobStep;
}

interface ProviderJobUpdate {
  completed_at?: string | null;
  credits_consumed?: number | null;
  error_message?: string | null;
  estimated_cost_usd?: number | null;
  external_task_id?: string | null;
  failed_at?: string | null;
  file_size_bytes?: number | null;
  output_storage_key?: string | null;
  request?: Json;
  response?: Json;
  status?: ProviderJobStatus;
  submitted_at?: string | null;
}

const PROVIDER_JOB_SELECT = [
  "completed_at",
  "created_at",
  "credits_consumed",
  "error_message",
  "estimated_cost_usd",
  "external_task_id",
  "failed_at",
  "file_size_bytes",
  "id",
  "idempotency_key",
  "model",
  "output_storage_key",
  "project_id",
  "project_image_id",
  "provider",
  "request",
  "response",
  "started_at",
  "status",
  "step",
  "submitted_at",
  "updated_at",
].join(", ");

function asProviderJob(job: unknown) {
  return job as ProviderJob;
}

export function buildProviderJobKey(parts: Array<number | string>) {
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown provider job error.";
}

export async function getProviderJobByKey(idempotencyKey: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_jobs")
    .select(PROVIDER_JOB_SELECT)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? asProviderJob(data) : null;
}

export async function getProviderJobByExternalTaskId(taskId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_jobs")
    .select(PROVIDER_JOB_SELECT)
    .eq("external_task_id", taskId)
    .eq("step", "video_generation")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? asProviderJob(data) : null;
}

export async function getProviderJobById(providerJobId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_jobs")
    .select(PROVIDER_JOB_SELECT)
    .eq("id", providerJobId)
    .single();

  if (error) {
    throw error;
  }

  return asProviderJob(data);
}

export async function ensureProviderJob(input: EnsureProviderJobInput) {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("provider_jobs")
    .insert({
      idempotency_key: input.idempotencyKey,
      model: input.model,
      output_storage_key: input.outputStorageKey ?? null,
      project_id: input.projectId,
      project_image_id: input.projectImageId ?? null,
      provider: input.provider,
      request: input.request ?? {},
      response: {},
      started_at: now,
      status: "started",
      step: input.step,
    })
    .select(PROVIDER_JOB_SELECT)
    .single();

  if (!error) {
    return {
      created: true,
      job: asProviderJob(data),
    };
  }

  if (error.code !== "23505") {
    throw error;
  }

  const existingJob = await getProviderJobByKey(input.idempotencyKey);

  if (!existingJob) {
    throw new Error(
      `Provider job ${input.idempotencyKey} already exists but could not be loaded.`,
    );
  }

  return {
    created: false,
    job: existingJob,
  };
}

export async function updateProviderJob(
  jobId: string,
  update: ProviderJobUpdate,
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_jobs")
    .update({
      ...update,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select(PROVIDER_JOB_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return asProviderJob(data);
}

export function isProviderJobTerminal(job: ProviderJob) {
  return ["canceled", "completed", "failed", "requires_manual_retry"].includes(
    job.status,
  );
}
