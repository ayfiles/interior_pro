import "server-only";

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
  providerJobCount: number;
  providerJobIssues: number;
  status: string;
  updatedAt: string;
}

export interface AdminProviderJobSummary {
  createdAt: string;
  creditsConsumed: number | null;
  errorMessage: string | null;
  estimatedCostUsd: number | null;
  externalTaskId: string | null;
  id: string;
  model: string;
  outputStorageKey: string | null;
  projectId: string;
  projectName: string;
  provider: string;
  status: string;
  step: string;
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

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isProviderIssue(status: string) {
  return ["failed", "requires_manual_retry"].includes(status);
}

function sumNullable(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
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
          .select("project_id, status")
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
    project_id: string;
    status: string;
  }>).reduce<Record<string, { issues: number; total: number }>>((counts, job) => {
    const current = counts[job.project_id] ?? { issues: 0, total: 0 };
    current.total += 1;
    current.issues += isProviderIssue(job.status) ? 1 : 0;
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
      "id, project_id, provider, model, step, status, external_task_id, output_storage_key, credits_consumed, estimated_cost_usd, error_message, created_at, updated_at",
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

  return ((jobs ?? []) as Array<{
    created_at: string;
    credits_consumed: number | null;
    error_message: string | null;
    estimated_cost_usd: number | null;
    external_task_id: string | null;
    id: string;
    model: string;
    output_storage_key: string | null;
    project_id: string;
    provider: string;
    status: string;
    step: string;
    updated_at: string;
  }>).map(
    (job): AdminProviderJobSummary => ({
      createdAt: job.created_at,
      creditsConsumed: job.credits_consumed,
      errorMessage: job.error_message,
      estimatedCostUsd: job.estimated_cost_usd,
      externalTaskId: job.external_task_id,
      id: job.id,
      model: job.model,
      outputStorageKey: job.output_storage_key,
      projectId: job.project_id,
      projectName: projectNames.get(job.project_id) ?? "Unknown project",
      provider: job.provider,
      status: job.status,
      step: job.step,
      updatedAt: job.updated_at,
    }),
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
