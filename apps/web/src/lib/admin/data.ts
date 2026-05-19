import "server-only";

import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

export interface AdminOverview {
  activeProjects: number;
  completedProjects: number;
  failedProjects: number;
  manualRetryJobs: number;
  organizations: number;
  profiles: number;
  projectStatusCounts: Array<{ count: number; status: string }>;
  recentLogs: AdminPipelineLog[];
  recentProjects: AdminProjectSummary[];
  totalKieCredits: number;
  totalProviderCostUsd: number;
}

export interface AdminProjectSummary {
  completedAt: string | null;
  createdAt: string;
  customerName: string;
  errorMessage: string | null;
  id: string;
  imageCount: number;
  organizationId: string;
  organizationName: string;
  providerCostUsd: number;
  providerCredits: number;
  providerJobCount: number;
  providerJobIssues: number;
  status: string;
  updatedAt: string;
}

export interface AdminProviderJobSummary {
  completedAt: string | null;
  createdAt: string;
  creditsConsumed: number | null;
  errorMessage: string | null;
  estimatedCostUsd: number | null;
  externalTaskId: string | null;
  failedAt: string | null;
  fileSizeBytes: number | null;
  id: string;
  isStale: boolean;
  model: string;
  outputStorageKey: string | null;
  projectId: string;
  projectName: string;
  provider: string;
  status: string;
  step: string;
  staleMinutes: number | null;
  startedAt: string;
  submittedAt: string | null;
  updatedAt: string;
}

export interface AdminPipelineLog {
  createdAt: string;
  id: string;
  message: string | null;
  metadata: Json | null;
  projectId: string;
  status: string;
  step: string;
}

export interface AdminAuditLog {
  action: string;
  actorEmail: string | null;
  actorUserId: string | null;
  createdAt: string;
  id: string;
  metadata: Json;
  resourceId: string | null;
  resourceType: string;
}

export interface AdminTestingProject {
  createdAt: string;
  customerName: string;
  id: string;
  imageCount: number;
  organizationId: string;
  status: string;
}

export interface AdminTestingRunSummary {
  actualCostUsd: number;
  assetCount: number;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  estimatedCostUsd: number;
  id: string;
  name: string;
  outputCount: number;
  providerCredits: number;
  runMode: string;
  status: string;
  targetStep: string;
  updatedAt: string;
}

export interface AdminTestingRunAsset {
  bucket: string;
  contentType: string | null;
  createdAt: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  id: string;
  kind: string;
  metadata: Json;
  signedUrl: string | null;
  storageKey: string;
}

export interface AdminTestingRunOutput {
  bucket: string | null;
  contentType: string | null;
  createdAt: string;
  fileSizeBytes: number | null;
  id: string;
  kind: string;
  label: string;
  metadata: Json;
  signedUrl: string | null;
  storageKey: string | null;
}

export interface AdminTestingRunLog {
  createdAt: string;
  id: string;
  message: string | null;
  metadata: Json;
  status: string;
  step: string;
}

export interface AdminTestingRunDetail {
  assets: AdminTestingRunAsset[];
  logs: AdminTestingRunLog[];
  outputs: AdminTestingRunOutput[];
  run: {
    actualCostUsd: number;
    completedAt: string | null;
    config: Json;
    createdAt: string;
    errorMessage: string | null;
    estimatedCostUsd: number;
    id: string;
    inputSummary: Json;
    name: string;
    providerCredits: number;
    queuedAt: string | null;
    runMode: string;
    startedAt: string | null;
    status: string;
    targetStep: string;
    updatedAt: string;
  };
}

export interface AdminProfileSummary {
  adminRole: string | null;
  adminStatus: string | null;
  createdAt: string;
  email: string;
  fullName: string;
  id: string;
  membershipCount: number;
}

export interface AdminOrganizationSummary {
  activeReservations: number;
  createdAt: string;
  creditBalance: number;
  id: string;
  memberCount: number;
  name: string;
  projectCount: number;
  subscriptionPlan: string;
}

export interface AdminCreditLedgerRow {
  amount: number;
  createdAt: string;
  entryType: string;
  id: string;
  metadata: Json;
  organizationId: string;
  organizationName: string;
  projectId: string | null;
}

export interface AdminCreditReservationRow {
  amount: number;
  createdAt: string;
  expiresAt: string;
  id: string;
  organizationId: string;
  organizationName: string;
  projectId: string | null;
  status: string;
}

export interface AdminMusicTrack {
  createdAt: string;
  durationSeconds: number;
  fileStorageKey: string;
  genre: string | null;
  id: string;
  instructionsMd: string | null;
  isActive: boolean;
  name: string;
  planJson: Json | null;
}

export interface AdminProjectDetailImage {
  analysis: Json | null;
  clipSignedUrl: string | null;
  createdAt: string;
  enhancedSignedUrl: string | null;
  id: string;
  orderIndex: number;
  originalSignedUrl: string | null;
  originalStorageKey: string;
  promptType: string | null;
  upscaledStorageKey: string | null;
  videoStatus: string;
  videoStorageKey: string | null;
}

export interface AdminProjectDetailOutput {
  createdAt: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  id: string;
  qcReport: Json;
  resolution: string;
  signedUrl: string | null;
  videoStorageKey: string;
  voiceoverScript: string | null;
}

export interface AdminProjectDetail {
  creator: { email: string; fullName: string; id: string } | null;
  images: AdminProjectDetailImage[];
  logs: AdminPipelineLog[];
  observability: AdminProjectObservability;
  organization: { id: string; name: string; subscriptionPlan: string } | null;
  outputs: AdminProjectDetailOutput[];
  project: {
    completedAt: string | null;
    createdAt: string;
    customerName: string;
    errorMessage: string | null;
    id: string;
    musicGenre: string;
    musicId: string | null;
    organizationId: string;
    specialNotes: string | null;
    status: string;
    updatedAt: string;
    voiceSelection: string;
  };
  providerJobs: AdminProviderJobSummary[];
  reservations: AdminCreditReservationRow[];
}

export interface AdminProjectObservability {
  clipHealth: {
    enhancedImages: number;
    failedClips: number;
    generatedClips: number;
    pendingClips: number;
    qcFailedClips: number;
    qcPassedClips: number;
    totalImages: number;
  };
  latestError: {
    message: string;
    source: string;
    time: string | null;
  } | null;
  outputHealth: {
    finalOutputCount: number;
    latestOutputCreatedAt: string | null;
    latestOutputFileSizeBytes: number | null;
    latestOutputQcStatus: string | null;
    latestOutputResolution: string | null;
    renderReady: boolean;
  };
  providerHealth: {
    completed: number;
    failed: number;
    issues: number;
    running: number;
    stale: number;
    total: number;
  };
  timeline: AdminProjectTimelineEvent[];
  totalProviderCostUsd: number;
  totalProviderCredits: number;
}

export interface AdminProjectTimelineEvent {
  detail: string | null;
  id: string;
  status: string;
  time: string;
  title: string;
  type: "pipeline_log" | "provider_job";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isProviderIssue(status: string) {
  return ["failed", "requires_manual_retry"].includes(status);
}

function isRunningProviderStatus(status: string) {
  return ["started", "submitted", "processing"].includes(status);
}

function providerJobStaleMinutes(updatedAt: string, now = Date.now()) {
  const updatedAtMs = new Date(updatedAt).getTime();

  if (!Number.isFinite(updatedAtMs)) {
    return null;
  }

  return Math.max(0, Math.floor((now - updatedAtMs) / 60_000));
}

function isStaleProviderJob(status: string, updatedAt: string, now = Date.now()) {
  const staleMinutes = providerJobStaleMinutes(updatedAt, now);

  return (
    isRunningProviderStatus(status) &&
    staleMinutes !== null &&
    staleMinutes >= 30
  );
}

function sumNullable(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function isJsonObject(value: unknown): value is Record<string, Json> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function qcStatusFromReport(report: Json | null) {
  if (!isJsonObject(report)) {
    return null;
  }

  if (typeof report.status === "string") {
    return report.status;
  }

  const finalQcReport = report.finalQcReport;

  return isJsonObject(finalQcReport) && typeof finalQcReport.status === "string"
    ? finalQcReport.status
    : null;
}

function buildProjectTimeline({
  logs,
  providerJobs,
}: {
  logs: AdminPipelineLog[];
  providerJobs: AdminProviderJobSummary[];
}): AdminProjectTimelineEvent[] {
  const logEvents = logs.map(
    (log): AdminProjectTimelineEvent => ({
      detail: log.message,
      id: `log:${log.id}`,
      status: log.status,
      time: log.createdAt,
      title: statusLabelForTimeline(log.step),
      type: "pipeline_log",
    }),
  );
  const providerEvents = providerJobs.flatMap((job) => {
    const events: AdminProjectTimelineEvent[] = [
      {
        detail: `${job.provider} ${job.model}`,
        id: `provider:${job.id}:created`,
        status: "started",
        time: job.startedAt ?? job.createdAt,
        title: `${statusLabelForTimeline(job.step)} provider job started`,
        type: "provider_job",
      },
    ];

    if (job.submittedAt) {
      events.push({
        detail: job.externalTaskId,
        id: `provider:${job.id}:submitted`,
        status: "submitted",
        time: job.submittedAt,
        title: `${statusLabelForTimeline(job.step)} submitted`,
        type: "provider_job",
      });
    }

    if (job.completedAt) {
      events.push({
        detail: job.outputStorageKey,
        id: `provider:${job.id}:completed`,
        status: "completed",
        time: job.completedAt,
        title: `${statusLabelForTimeline(job.step)} completed`,
        type: "provider_job",
      });
    }

    if (job.failedAt) {
      events.push({
        detail: job.errorMessage,
        id: `provider:${job.id}:failed`,
        status: job.status,
        time: job.failedAt,
        title: `${statusLabelForTimeline(job.step)} failed`,
        type: "provider_job",
      });
    }

    if (!job.completedAt && !job.failedAt && job.updatedAt !== job.startedAt) {
      events.push({
        detail: job.errorMessage ?? job.externalTaskId,
        id: `provider:${job.id}:updated`,
        status: job.isStale ? "stale" : job.status,
        time: job.updatedAt,
        title: `${statusLabelForTimeline(job.step)} updated`,
        type: "provider_job",
      });
    }

    return events;
  });

  return [...logEvents, ...providerEvents]
    .filter((event) => Number.isFinite(new Date(event.time).getTime()))
    .sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    )
    .slice(0, 80);
}

function statusLabelForTimeline(status: string) {
  return status
    .split(/[_.]/)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

async function signedUrl(bucket: string, storageKey: string | null) {
  if (!storageKey) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(storageKey, 60 * 10);

  if (error) {
    return null;
  }

  return data?.signedUrl ?? null;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const admin = createAdminClient();
  const staleSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [
    profileCount,
    organizationCount,
    projectCount,
    activeProjectCount,
    completedProjectCount,
    failedProjectCount,
    manualRetryJobCount,
    providerJobsResult,
    projectStatusesResult,
    recentLogsResult,
    recentProjectsResult,
    staleJobsResult,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin.from("projects").select("id", { count: "exact", head: true }),
    admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(completed,failed,canceled)"),
    admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
    admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("provider_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "requires_manual_retry"),
    admin
      .from("provider_jobs")
      .select("credits_consumed, estimated_cost_usd")
      .limit(1000),
    admin.from("projects").select("status").limit(1000),
    admin
      .from("pipeline_logs")
      .select("id, project_id, step, status, message, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("projects")
      .select(
        "id, organization_id, customer_name, status, error_message, completed_at, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(8),
    admin
      .from("provider_jobs")
      .select("id")
      .in("status", ["started", "submitted", "processing"])
      .lt("updated_at", staleSince),
  ]);

  const results = [
    profileCount,
    organizationCount,
    projectCount,
    activeProjectCount,
    completedProjectCount,
    failedProjectCount,
    manualRetryJobCount,
    providerJobsResult,
    projectStatusesResult,
    recentLogsResult,
    recentProjectsResult,
    staleJobsResult,
  ];
  const failedResult = results.find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const projectStatusCounts = Object.entries(
    ((projectStatusesResult.data ?? []) as Array<{ status: string }>).reduce<
      Record<string, number>
    >((counts, project) => {
      counts[project.status] = (counts[project.status] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .map(([status, count]) => ({ count, status }))
    .sort((a, b) => b.count - a.count);

  const providerJobs = (providerJobsResult.data ?? []) as Array<{
    credits_consumed: number | null;
    estimated_cost_usd: number | null;
  }>;
  const recentProjects = await hydrateProjects(
    recentProjectsResult.data ?? [],
  );

  return {
    activeProjects: activeProjectCount.count ?? 0,
    completedProjects: completedProjectCount.count ?? 0,
    failedProjects: failedProjectCount.count ?? 0,
    manualRetryJobs:
      (manualRetryJobCount.count ?? 0) + ((staleJobsResult.data ?? []).length),
    organizations: organizationCount.count ?? 0,
    profiles: profileCount.count ?? 0,
    projectStatusCounts,
    recentLogs: ((recentLogsResult.data ?? []) as Array<{
      created_at: string;
      id: string;
      message: string | null;
      metadata: Json | null;
      project_id: string;
      status: string;
      step: string;
    }>).map((log) => ({
        createdAt: log.created_at,
        id: log.id,
        message: log.message,
        metadata: log.metadata,
        projectId: log.project_id,
        status: log.status,
        step: log.step,
      })),
    recentProjects,
    totalKieCredits: sumNullable(
      providerJobs.map((job) => job.credits_consumed),
    ),
    totalProviderCostUsd: sumNullable(
      providerJobs.map((job) => job.estimated_cost_usd),
    ),
  };
}

export async function listAdminProjects() {
  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select(
      "id, organization_id, customer_name, status, error_message, completed_at, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) {
    throw error;
  }

  return hydrateProjects(projects ?? []);
}

async function hydrateProjects(
  projects: Array<{
    completed_at: string | null;
    created_at: string;
    customer_name: string;
    error_message: string | null;
    id: string;
    organization_id: string;
    status: string;
    updated_at: string;
  }>,
): Promise<AdminProjectSummary[]> {
  const admin = createAdminClient();
  const projectIds = projects.map((project) => project.id);
  const organizationIds = unique(
    projects.map((project) => project.organization_id),
  );
  const [organizationsResult, imagesResult, jobsResult] = await Promise.all([
    organizationIds.length
      ? admin
          .from("organizations")
          .select("id, name")
          .in("id", organizationIds)
      : { data: [], error: null },
    projectIds.length
      ? admin.from("project_images").select("project_id").in("project_id", projectIds)
      : { data: [], error: null },
    projectIds.length
      ? admin
          .from("provider_jobs")
          .select(
            "project_id, status, updated_at, credits_consumed, estimated_cost_usd",
          )
          .in("project_id", projectIds)
      : { data: [], error: null },
  ]);

  const failedResult = [organizationsResult, imagesResult, jobsResult].find(
    (result) => result.error,
  );

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const organizationNames = new Map(
    ((organizationsResult.data ?? []) as Array<{ id: string; name: string }>).map(
      (organization) => [organization.id, organization.name],
    ),
  );
  const imageCounts = ((imagesResult.data ?? []) as Array<{
    project_id: string;
  }>).reduce<Record<string, number>>((counts, image) => {
    counts[image.project_id] = (counts[image.project_id] ?? 0) + 1;
    return counts;
  }, {});
  const providerJobCounts = ((jobsResult.data ?? []) as Array<{
    credits_consumed: number | null;
    estimated_cost_usd: number | null;
    project_id: string;
    status: string;
    updated_at: string;
  }>).reduce<
    Record<
      string,
      { costUsd: number; credits: number; issues: number; total: number }
    >
  >((counts, job) => {
    const current = counts[job.project_id] ?? {
      costUsd: 0,
      credits: 0,
      issues: 0,
      total: 0,
    };
    current.total += 1;
    current.costUsd += job.estimated_cost_usd ?? 0;
    current.credits += job.credits_consumed ?? 0;
    current.issues +=
      isProviderIssue(job.status) || isStaleProviderJob(job.status, job.updated_at)
        ? 1
        : 0;
    counts[job.project_id] = current;
    return counts;
  }, {});

  return projects.map((project) => ({
    completedAt: project.completed_at,
    createdAt: project.created_at,
    customerName: project.customer_name,
    errorMessage: project.error_message,
    id: project.id,
    imageCount: imageCounts[project.id] ?? 0,
    organizationId: project.organization_id,
    organizationName:
      organizationNames.get(project.organization_id) ?? "Unknown organization",
    providerCostUsd: providerJobCounts[project.id]?.costUsd ?? 0,
    providerCredits: providerJobCounts[project.id]?.credits ?? 0,
    providerJobCount: providerJobCounts[project.id]?.total ?? 0,
    providerJobIssues: providerJobCounts[project.id]?.issues ?? 0,
    status: project.status,
    updatedAt: project.updated_at,
  }));
}

export async function listAdminProviderJobs() {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("provider_jobs")
    .select(
      "id, project_id, provider, model, step, status, external_task_id, output_storage_key, credits_consumed, estimated_cost_usd, error_message, file_size_bytes, started_at, submitted_at, completed_at, failed_at, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(120);

  if (error) {
    throw error;
  }

  const projectIds = unique((jobs ?? []).map((job) => job.project_id));
  const { data: projects, error: projectsError } = projectIds.length
    ? await admin
        .from("projects")
        .select("id, customer_name")
        .in("id", projectIds)
    : { data: [], error: null };

  if (projectsError) {
    throw projectsError;
  }

  const projectNames = new Map(
    ((projects ?? []) as Array<{ customer_name: string; id: string }>).map(
      (project) => [project.id, project.customer_name],
    ),
  );

  const now = Date.now();

  return ((jobs ?? []) as Array<{
    completed_at: string | null;
    created_at: string;
    credits_consumed: number | null;
    error_message: string | null;
    estimated_cost_usd: number | null;
    external_task_id: string | null;
    failed_at: string | null;
    file_size_bytes: number | null;
    id: string;
    model: string;
    output_storage_key: string | null;
    project_id: string;
    provider: string;
    status: string;
    step: string;
    started_at: string;
    submitted_at: string | null;
    updated_at: string;
  }>).map(
    (job): AdminProviderJobSummary => {
      const staleMinutes = providerJobStaleMinutes(job.updated_at, now);

      return {
        completedAt: job.completed_at,
        createdAt: job.created_at,
        creditsConsumed: job.credits_consumed,
        errorMessage: job.error_message,
        estimatedCostUsd: job.estimated_cost_usd,
        externalTaskId: job.external_task_id,
        failedAt: job.failed_at,
        fileSizeBytes: job.file_size_bytes,
        id: job.id,
        isStale: isStaleProviderJob(job.status, job.updated_at, now),
        model: job.model,
        outputStorageKey: job.output_storage_key,
        projectId: job.project_id,
        projectName: projectNames.get(job.project_id) ?? "Unknown project",
        provider: job.provider,
        status: job.status,
        step: job.step,
        staleMinutes,
        startedAt: job.started_at,
        submittedAt: job.submitted_at,
        updatedAt: job.updated_at,
      };
    },
  );
}

export async function listAdminAuditLogs() {
  const admin = createAdminClient();
  const { data: logs, error } = await admin
    .from("admin_audit_logs")
    .select(
      "id, actor_user_id, action, resource_type, resource_id, metadata, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) {
    throw error;
  }

  const actorIds = unique(
    ((logs ?? []) as Array<{ actor_user_id: string | null }>).map(
      (log) => log.actor_user_id ?? "",
    ),
  );
  const { data: profiles, error: profilesError } = actorIds.length
    ? await admin.from("profiles").select("id, email").in("id", actorIds)
    : { data: [], error: null };

  if (profilesError) {
    throw profilesError;
  }

  const emails = new Map(
    ((profiles ?? []) as Array<{ email: string; id: string }>).map((profile) => [
      profile.id,
      profile.email,
    ]),
  );

  return ((logs ?? []) as Array<{
    action: string;
    actor_user_id: string | null;
    created_at: string;
    id: string;
    metadata: Json;
    resource_id: string | null;
    resource_type: string;
  }>).map(
    (log): AdminAuditLog => ({
      action: log.action,
      actorEmail: log.actor_user_id ? (emails.get(log.actor_user_id) ?? null) : null,
      actorUserId: log.actor_user_id,
      createdAt: log.created_at,
      id: log.id,
      metadata: log.metadata,
      resourceId: log.resource_id,
      resourceType: log.resource_type,
    }),
  );
}

export async function listAdminTestingProjects() {
  const projects = await listAdminProjects();

  return projects.slice(0, 20).map(
    (project): AdminTestingProject => ({
      createdAt: project.createdAt,
      customerName: project.customerName,
      id: project.id,
      imageCount: project.imageCount,
      organizationId: project.organizationId,
      status: project.status,
    }),
  );
}

export async function listAdminTestingRuns(): Promise<
  AdminTestingRunSummary[]
> {
  const admin = createAdminClient();
  const { data: runs, error } = await admin
    .from("testing_runs")
    .select(
      "id, name, target_step, run_mode, status, estimated_cost_usd, actual_cost_usd, provider_credits, error_message, completed_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (error.code === "42P01") {
      return [];
    }

    throw error;
  }

  const runIds = (runs ?? []).map((run) => run.id);
  const [assetsResult, outputsResult] = runIds.length
    ? await Promise.all([
        admin
          .from("testing_run_assets")
          .select("run_id")
          .in("run_id", runIds),
        admin
          .from("testing_run_outputs")
          .select("run_id")
          .in("run_id", runIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (assetsResult.error) {
    throw assetsResult.error;
  }

  if (outputsResult.error) {
    throw outputsResult.error;
  }

  const assetCounts = new Map<string, number>();
  const outputCounts = new Map<string, number>();

  for (const asset of assetsResult.data ?? []) {
    assetCounts.set(asset.run_id, (assetCounts.get(asset.run_id) ?? 0) + 1);
  }

  for (const output of outputsResult.data ?? []) {
    outputCounts.set(output.run_id, (outputCounts.get(output.run_id) ?? 0) + 1);
  }

  return ((runs ?? []) as Array<{
    actual_cost_usd: number;
    completed_at: string | null;
    created_at: string;
    error_message: string | null;
    estimated_cost_usd: number;
    id: string;
    name: string;
    provider_credits: number;
    run_mode: string;
    status: string;
    target_step: string;
    updated_at: string;
  }>).map((run) => ({
    actualCostUsd: run.actual_cost_usd,
    assetCount: assetCounts.get(run.id) ?? 0,
    completedAt: run.completed_at,
    createdAt: run.created_at,
    errorMessage: run.error_message,
    estimatedCostUsd: run.estimated_cost_usd,
    id: run.id,
    name: run.name,
    outputCount: outputCounts.get(run.id) ?? 0,
    providerCredits: run.provider_credits,
    runMode: run.run_mode,
    status: run.status,
    targetStep: run.target_step,
    updatedAt: run.updated_at,
  }));
}

export async function getAdminTestingRunDetail(
  runId: string,
): Promise<AdminTestingRunDetail | null> {
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin
    .from("testing_runs")
    .select(
      "id, name, target_step, run_mode, status, input_summary, config, estimated_cost_usd, actual_cost_usd, provider_credits, error_message, queued_at, started_at, completed_at, created_at, updated_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (runError) {
    if (runError.code === "42P01") {
      return null;
    }

    throw runError;
  }

  if (!run) {
    return null;
  }

  const [assetsResult, outputsResult, logsResult] = await Promise.all([
    admin
      .from("testing_run_assets")
      .select(
        "id, kind, bucket, storage_key, file_name, content_type, file_size_bytes, metadata, created_at",
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
    admin
      .from("testing_run_outputs")
      .select(
        "id, kind, label, bucket, storage_key, content_type, file_size_bytes, metadata, created_at",
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
    admin
      .from("testing_run_logs")
      .select("id, step, status, message, metadata, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false }),
  ]);

  if (assetsResult.error) {
    throw assetsResult.error;
  }

  if (outputsResult.error) {
    throw outputsResult.error;
  }

  if (logsResult.error) {
    throw logsResult.error;
  }

  return {
    assets: await Promise.all(
      ((assetsResult.data ?? []) as Array<{
        bucket: string;
        content_type: string | null;
        created_at: string;
        file_name: string | null;
        file_size_bytes: number | null;
        id: string;
        kind: string;
        metadata: Json;
        storage_key: string;
      }>).map(async (asset) => ({
        bucket: asset.bucket,
        contentType: asset.content_type,
        createdAt: asset.created_at,
        fileName: asset.file_name,
        fileSizeBytes: asset.file_size_bytes,
        id: asset.id,
        kind: asset.kind,
        metadata: asset.metadata,
        signedUrl: await signedUrl(asset.bucket, asset.storage_key),
        storageKey: asset.storage_key,
      })),
    ),
    logs: ((logsResult.data ?? []) as Array<{
      created_at: string;
      id: string;
      message: string | null;
      metadata: Json;
      status: string;
      step: string;
    }>).map((log) => ({
      createdAt: log.created_at,
      id: log.id,
      message: log.message,
      metadata: log.metadata,
      status: log.status,
      step: log.step,
    })),
    outputs: await Promise.all(
      ((outputsResult.data ?? []) as Array<{
        bucket: string | null;
        content_type: string | null;
        created_at: string;
        file_size_bytes: number | null;
        id: string;
        kind: string;
        label: string;
        metadata: Json;
        storage_key: string | null;
      }>).map(async (output) => ({
        bucket: output.bucket,
        contentType: output.content_type,
        createdAt: output.created_at,
        fileSizeBytes: output.file_size_bytes,
        id: output.id,
        kind: output.kind,
        label: output.label,
        metadata: output.metadata,
        signedUrl: output.bucket
          ? await signedUrl(output.bucket, output.storage_key)
          : null,
        storageKey: output.storage_key,
      })),
    ),
    run: {
      actualCostUsd: run.actual_cost_usd,
      completedAt: run.completed_at,
      config: run.config,
      createdAt: run.created_at,
      errorMessage: run.error_message,
      estimatedCostUsd: run.estimated_cost_usd,
      id: run.id,
      inputSummary: run.input_summary,
      name: run.name,
      providerCredits: run.provider_credits,
      queuedAt: run.queued_at,
      runMode: run.run_mode,
      startedAt: run.started_at,
      status: run.status,
      targetStep: run.target_step,
      updatedAt: run.updated_at,
    },
  };
}

export async function getAdminProjectDetail(
  projectId: string,
): Promise<AdminProjectDetail | null> {
  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select(
      "id, organization_id, created_by, customer_name, status, voice_selection, music_genre, music_id, special_notes, error_message, completed_at, created_at, updated_at",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw projectError;
  }

  if (!project) {
    return null;
  }

  const [
    organizationResult,
    creatorResult,
    imagesResult,
    outputsResult,
    logsResult,
    jobsResult,
    reservationsResult,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, subscription_plan")
      .eq("id", project.organization_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", project.created_by)
      .maybeSingle(),
    admin
      .from("project_images")
      .select(
        "id, project_id, original_storage_key, upscaled_storage_key, analysis, prompt_type, video_storage_key, video_status, order_index, created_at",
      )
      .eq("project_id", projectId)
      .order("order_index", { ascending: true }),
    admin
      .from("project_outputs")
      .select(
        "id, project_id, video_storage_key, duration_seconds, resolution, file_size_bytes, voiceover_script, qc_report, created_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    admin
      .from("pipeline_logs")
      .select("id, project_id, step, status, message, metadata, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(80),
    admin
      .from("provider_jobs")
      .select(
        "id, project_id, provider, model, step, status, external_task_id, output_storage_key, credits_consumed, estimated_cost_usd, error_message, file_size_bytes, started_at, submitted_at, completed_at, failed_at, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    admin
      .from("credit_reservations")
      .select("id, organization_id, project_id, amount, status, expires_at, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  const failedResult = [
    organizationResult,
    creatorResult,
    imagesResult,
    outputsResult,
    logsResult,
    jobsResult,
    reservationsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const organization = organizationResult.data
    ? {
        id: organizationResult.data.id,
        name: organizationResult.data.name,
        subscriptionPlan: organizationResult.data.subscription_plan,
      }
    : null;
  const projectName = project.customer_name;
  const images = await Promise.all(
    ((imagesResult.data ?? []) as Array<{
      analysis: Json | null;
      created_at: string;
      id: string;
      order_index: number;
      original_storage_key: string;
      prompt_type: string | null;
      upscaled_storage_key: string | null;
      video_storage_key: string | null;
      video_status: string;
    }>).map(async (image): Promise<AdminProjectDetailImage> => ({
      analysis: image.analysis,
      clipSignedUrl: await signedUrl(
        STORAGE_BUCKETS.generatedClips,
        image.video_storage_key,
      ),
      createdAt: image.created_at,
      enhancedSignedUrl: await signedUrl(
        STORAGE_BUCKETS.sourceAssets,
        image.upscaled_storage_key,
      ),
      id: image.id,
      orderIndex: image.order_index,
      originalSignedUrl: await signedUrl(
        STORAGE_BUCKETS.sourceAssets,
        image.original_storage_key,
      ),
      originalStorageKey: image.original_storage_key,
      promptType: image.prompt_type,
      upscaledStorageKey: image.upscaled_storage_key,
      videoStatus: image.video_status,
      videoStorageKey: image.video_storage_key,
    })),
  );
  const outputs = await Promise.all(
    ((outputsResult.data ?? []) as Array<{
      created_at: string;
      duration_seconds: number | null;
      file_size_bytes: number | null;
      id: string;
      qc_report: Json;
      resolution: string;
      video_storage_key: string;
      voiceover_script: string | null;
    }>).map(async (output): Promise<AdminProjectDetailOutput> => ({
      createdAt: output.created_at,
      durationSeconds: output.duration_seconds,
      fileSizeBytes: output.file_size_bytes,
      id: output.id,
      qcReport: output.qc_report,
      resolution: output.resolution,
      signedUrl: await signedUrl(
        STORAGE_BUCKETS.finalOutputs,
        output.video_storage_key,
      ),
      videoStorageKey: output.video_storage_key,
      voiceoverScript: output.voiceover_script,
    })),
  );

  const now = Date.now();
  const logs = ((logsResult.data ?? []) as Array<{
    created_at: string;
    id: string;
    message: string | null;
    metadata: Json | null;
    project_id: string;
    status: string;
    step: string;
  }>).map((log): AdminPipelineLog => ({
    createdAt: log.created_at,
    id: log.id,
    message: log.message,
    metadata: log.metadata,
    projectId: log.project_id,
    status: log.status,
    step: log.step,
  }));
  const providerJobs = ((jobsResult.data ?? []) as Array<{
    completed_at: string | null;
    created_at: string;
    credits_consumed: number | null;
    error_message: string | null;
    estimated_cost_usd: number | null;
    external_task_id: string | null;
    failed_at: string | null;
    file_size_bytes: number | null;
    id: string;
    model: string;
    output_storage_key: string | null;
    project_id: string;
    provider: string;
    status: string;
    step: string;
    started_at: string;
    submitted_at: string | null;
    updated_at: string;
  }>).map((job): AdminProviderJobSummary => {
    const staleMinutes = providerJobStaleMinutes(job.updated_at, now);

    return {
      completedAt: job.completed_at,
      createdAt: job.created_at,
      creditsConsumed: job.credits_consumed,
      errorMessage: job.error_message,
      estimatedCostUsd: job.estimated_cost_usd,
      externalTaskId: job.external_task_id,
      failedAt: job.failed_at,
      fileSizeBytes: job.file_size_bytes,
      id: job.id,
      isStale: isStaleProviderJob(job.status, job.updated_at, now),
      model: job.model,
      outputStorageKey: job.output_storage_key,
      projectId: job.project_id,
      projectName,
      provider: job.provider,
      status: job.status,
      step: job.step,
      staleMinutes,
      startedAt: job.started_at,
      submittedAt: job.submitted_at,
      updatedAt: job.updated_at,
    };
  });
  const reservations = ((reservationsResult.data ?? []) as Array<{
    amount: number;
    created_at: string;
    expires_at: string;
    id: string;
    organization_id: string;
    project_id: string | null;
    status: string;
  }>).map(
    (reservation): AdminCreditReservationRow => ({
      amount: reservation.amount,
      createdAt: reservation.created_at,
      expiresAt: reservation.expires_at,
      id: reservation.id,
      organizationId: reservation.organization_id,
      organizationName: organization?.name ?? "Unknown organization",
      projectId: reservation.project_id,
      status: reservation.status,
    }),
  );
  const latestOutput = outputs[0] ?? null;
  const lastFailedLog = logs.find((log) => log.status === "failed");
  const lastFailedJob = providerJobs.find(
    (job) => job.errorMessage || ["failed", "requires_manual_retry"].includes(job.status),
  );
  const latestError =
    project.error_message || lastFailedJob?.errorMessage || lastFailedLog?.message
      ? {
          message:
            project.error_message ??
            lastFailedJob?.errorMessage ??
            lastFailedLog?.message ??
            "Unknown project error.",
          source: project.error_message
            ? "project"
            : lastFailedJob
              ? `${lastFailedJob.step} provider job`
              : "pipeline log",
          time: lastFailedJob?.failedAt ?? lastFailedLog?.createdAt ?? null,
        }
      : null;
  const clipHealth = {
    enhancedImages: images.filter((image) => image.upscaledStorageKey).length,
    failedClips: images.filter((image) => image.videoStatus === "failed").length,
    generatedClips: images.filter((image) => image.videoStorageKey).length,
    pendingClips: images.filter((image) => !image.videoStorageKey).length,
    qcFailedClips: images.filter((image) => image.videoStatus === "qc_failed").length,
    qcPassedClips: images.filter((image) => image.videoStatus === "qc_passed").length,
    totalImages: images.length,
  };
  const providerHealth = {
    completed: providerJobs.filter((job) => job.status === "completed").length,
    failed: providerJobs.filter((job) => job.status === "failed").length,
    issues: providerJobs.filter(
      (job) => isProviderIssue(job.status) || job.isStale,
    ).length,
    running: providerJobs.filter((job) => isRunningProviderStatus(job.status))
      .length,
    stale: providerJobs.filter((job) => job.isStale).length,
    total: providerJobs.length,
  };
  const observability: AdminProjectObservability = {
    clipHealth,
    latestError,
    outputHealth: {
      finalOutputCount: outputs.length,
      latestOutputCreatedAt: latestOutput?.createdAt ?? null,
      latestOutputFileSizeBytes: latestOutput?.fileSizeBytes ?? null,
      latestOutputQcStatus: qcStatusFromReport(latestOutput?.qcReport ?? null),
      latestOutputResolution: latestOutput?.resolution ?? null,
      renderReady: outputs.some((output) => Boolean(output.videoStorageKey)),
    },
    providerHealth,
    timeline: buildProjectTimeline({ logs, providerJobs }),
    totalProviderCostUsd: sumNullable(
      providerJobs.map((job) => job.estimatedCostUsd),
    ),
    totalProviderCredits: sumNullable(
      providerJobs.map((job) => job.creditsConsumed),
    ),
  };

  return {
    creator: creatorResult.data
      ? {
          email: creatorResult.data.email,
          fullName: creatorResult.data.full_name,
          id: creatorResult.data.id,
        }
      : null,
    images,
    logs,
    observability,
    organization,
    outputs,
    project: {
      completedAt: project.completed_at,
      createdAt: project.created_at,
      customerName: projectName,
      errorMessage: project.error_message,
      id: project.id,
      musicGenre: project.music_genre,
      musicId: project.music_id,
      organizationId: project.organization_id,
      specialNotes: project.special_notes,
      status: project.status,
      updatedAt: project.updated_at,
      voiceSelection: project.voice_selection,
    },
    providerJobs,
    reservations,
  };
}

export async function listAdminUsersAndOrganizations() {
  const admin = createAdminClient();
  const [
    profilesResult,
    adminsResult,
    organizationsResult,
    membershipsResult,
    projectsResult,
    ledgerResult,
    reservationsResult,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, full_name, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("platform_admins").select("user_id, role, status"),
    admin
      .from("organizations")
      .select("id, name, subscription_plan, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("organization_members")
      .select("organization_id, user_id, role, status"),
    admin.from("projects").select("id, organization_id"),
    admin
      .from("video_credit_ledger")
      .select("organization_id, amount")
      .limit(2000),
    admin
      .from("credit_reservations")
      .select("organization_id, amount, status, expires_at")
      .eq("status", "reserved")
      .limit(2000),
  ]);

  const failedResult = [
    profilesResult,
    adminsResult,
    organizationsResult,
    membershipsResult,
    projectsResult,
    ledgerResult,
    reservationsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const adminRows = new Map(
    ((adminsResult.data ?? []) as Array<{
      role: string;
      status: string;
      user_id: string;
    }>).map((adminRow) => [adminRow.user_id, adminRow]),
  );
  const membershipCounts = ((membershipsResult.data ?? []) as Array<{
    organization_id: string;
    user_id: string;
  }>).reduce<{
    byOrg: Record<string, number>;
    byUser: Record<string, number>;
  }>(
    (counts, membership) => {
      counts.byOrg[membership.organization_id] =
        (counts.byOrg[membership.organization_id] ?? 0) + 1;
      counts.byUser[membership.user_id] =
        (counts.byUser[membership.user_id] ?? 0) + 1;
      return counts;
    },
    { byOrg: {}, byUser: {} },
  );
  const projectCounts = ((projectsResult.data ?? []) as Array<{
    organization_id: string;
  }>).reduce<Record<string, number>>((counts, project) => {
    counts[project.organization_id] = (counts[project.organization_id] ?? 0) + 1;
    return counts;
  }, {});
  const creditBalances = ((ledgerResult.data ?? []) as Array<{
    amount: number;
    organization_id: string;
  }>).reduce<Record<string, number>>((balances, entry) => {
    balances[entry.organization_id] =
      (balances[entry.organization_id] ?? 0) + entry.amount;
    return balances;
  }, {});
  const activeReservations = ((reservationsResult.data ?? []) as Array<{
    amount: number;
    expires_at: string;
    organization_id: string;
  }>).reduce<Record<string, number>>((reserved, reservation) => {
    if (new Date(reservation.expires_at).getTime() <= Date.now()) {
      return reserved;
    }

    reserved[reservation.organization_id] =
      (reserved[reservation.organization_id] ?? 0) + reservation.amount;
    return reserved;
  }, {});

  return {
    organizations: ((organizationsResult.data ?? []) as Array<{
      created_at: string;
      id: string;
      name: string;
      subscription_plan: string;
    }>).map(
      (organization): AdminOrganizationSummary => ({
        activeReservations: activeReservations[organization.id] ?? 0,
        createdAt: organization.created_at,
        creditBalance: creditBalances[organization.id] ?? 0,
        id: organization.id,
        memberCount: membershipCounts.byOrg[organization.id] ?? 0,
        name: organization.name,
        projectCount: projectCounts[organization.id] ?? 0,
        subscriptionPlan: organization.subscription_plan,
      }),
    ),
    profiles: ((profilesResult.data ?? []) as Array<{
      created_at: string;
      email: string;
      full_name: string;
      id: string;
    }>).map((profile): AdminProfileSummary => {
      const adminRow = adminRows.get(profile.id);

      return {
        adminRole: adminRow?.role ?? null,
        adminStatus: adminRow?.status ?? null,
        createdAt: profile.created_at,
        email: profile.email,
        fullName: profile.full_name,
        id: profile.id,
        membershipCount: membershipCounts.byUser[profile.id] ?? 0,
      };
    }),
  };
}

export async function listAdminCredits() {
  const admin = createAdminClient();
  const [ledgerResult, reservationsResult, organizationsResult] =
    await Promise.all([
      admin
        .from("video_credit_ledger")
        .select("id, organization_id, project_id, entry_type, amount, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(160),
      admin
        .from("credit_reservations")
        .select("id, organization_id, project_id, amount, status, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(160),
      admin.from("organizations").select("id, name"),
    ]);

  const failedResult = [
    ledgerResult,
    reservationsResult,
    organizationsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const organizationNames = new Map(
    ((organizationsResult.data ?? []) as Array<{ id: string; name: string }>).map(
      (organization) => [organization.id, organization.name],
    ),
  );

  return {
    ledger: ((ledgerResult.data ?? []) as Array<{
      amount: number;
      created_at: string;
      entry_type: string;
      id: string;
      metadata: Json;
      organization_id: string;
      project_id: string | null;
    }>).map(
      (entry): AdminCreditLedgerRow => ({
        amount: entry.amount,
        createdAt: entry.created_at,
        entryType: entry.entry_type,
        id: entry.id,
        metadata: entry.metadata,
        organizationId: entry.organization_id,
        organizationName:
          organizationNames.get(entry.organization_id) ?? "Unknown organization",
        projectId: entry.project_id,
      }),
    ),
    reservations: ((reservationsResult.data ?? []) as Array<{
      amount: number;
      created_at: string;
      expires_at: string;
      id: string;
      organization_id: string;
      project_id: string | null;
      status: string;
    }>).map(
      (reservation): AdminCreditReservationRow => ({
        amount: reservation.amount,
        createdAt: reservation.created_at,
        expiresAt: reservation.expires_at,
        id: reservation.id,
        organizationId: reservation.organization_id,
        organizationName:
          organizationNames.get(reservation.organization_id) ??
          "Unknown organization",
        projectId: reservation.project_id,
        status: reservation.status,
      }),
    ),
  };
}

export async function listAdminMusicTracks() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("music_tracks")
    .select(
      "id, name, file_storage_key, duration_seconds, genre, instructions_md, plan_json, is_active, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code !== "42703") {
      throw error;
    }

    const fallback = await admin
      .from("music_tracks")
      .select(
        "id, name, file_storage_key, duration_seconds, genre, is_active, created_at",
      )
      .order("created_at", { ascending: false });

    if (fallback.error) {
      throw fallback.error;
    }

    return ((fallback.data ?? []) as Array<{
      created_at: string;
      duration_seconds: number;
      file_storage_key: string;
      genre: string | null;
      id: string;
      is_active: boolean;
      name: string;
    }>).map(
      (track): AdminMusicTrack => ({
        createdAt: track.created_at,
        durationSeconds: track.duration_seconds,
        fileStorageKey: track.file_storage_key,
        genre: track.genre,
        id: track.id,
        instructionsMd: null,
        isActive: track.is_active,
        name: track.name,
        planJson: null,
      }),
    );
  }

  return ((data ?? []) as Array<{
    created_at: string;
    duration_seconds: number;
    file_storage_key: string;
    genre: string | null;
    id: string;
    instructions_md: string | null;
    is_active: boolean;
    name: string;
    plan_json: Json | null;
  }>).map(
    (track): AdminMusicTrack => ({
      createdAt: track.created_at,
      durationSeconds: track.duration_seconds,
      fileStorageKey: track.file_storage_key,
      genre: track.genre,
      id: track.id,
      instructionsMd: track.instructions_md,
      isActive: track.is_active,
      name: track.name,
      planJson: track.plan_json,
    }),
  );
}
