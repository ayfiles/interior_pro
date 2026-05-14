import { AlertTriangle, ArrowUpRight, Clock3 } from "lucide-react";
import Link from "next/link";
import {
  EmptyState,
  MetricCard,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { getAdminOverview } from "@/lib/admin/data";

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();

  const overview = await getAdminOverview();
  const attentionProjects = overview.recentProjects.filter(
    (project) => project.status === "failed" || project.providerJobIssues > 0,
  );

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">Platform control panel</p>
          <h2 className="text-3xl font-semibold">Overview</h2>
        </div>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--foreground)]"
          href="/admin/testing"
        >
          Testing
          <ArrowUpRight className="size-4" />
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail={`${overview.organizations} organizations`}
          label="Users"
          value={overview.profiles}
        />
        <MetricCard
          detail={`${overview.completedProjects} completed, ${overview.failedProjects} failed`}
          label="Active Projects"
          value={overview.activeProjects}
        />
        <MetricCard
          detail="Failed, manual retry, or stale provider jobs"
          label="Needs Attention"
          value={overview.manualRetryJobs + attentionProjects.length}
        />
        <MetricCard
          detail={`${overview.totalKieCredits.toFixed(0)} provider credits recorded`}
          label="Provider Cost"
          value={formatUsd(overview.totalProviderCostUsd)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div>
              <p className="text-sm text-[var(--muted)]">Project states</p>
              <h3 className="text-xl font-semibold">Status Distribution</h3>
            </div>
            <Clock3 className="size-5 text-[var(--brass)]" />
          </div>
          <div className="grid gap-2 p-4">
            {overview.projectStatusCounts.length ? (
              overview.projectStatusCounts.map((item) => (
                <div
                  className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[180px_minmax(0,1fr)_48px] sm:items-center"
                  key={item.status}
                >
                  <div className="text-sm">{statusLabel(item.status)}</div>
                  <div className="h-2 rounded-full bg-black/30">
                    <div
                      className="h-2 rounded-full bg-[var(--brass)]"
                      style={{
                        width: `${Math.max(
                          8,
                          (item.count /
                            Math.max(
                              overview.projectStatusCounts.reduce(
                                (sum, current) => sum + current.count,
                                0,
                              ),
                              1,
                            )) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="font-mono text-sm text-[var(--muted)]">
                    {item.count}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState label="No projects yet" />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div>
              <p className="text-sm text-[var(--muted)]">Operations</p>
              <h3 className="text-xl font-semibold">Needs Attention</h3>
            </div>
            <AlertTriangle className="size-5 text-[var(--brass)]" />
          </div>
          <div className="grid gap-2 p-4">
            {attentionProjects.length ? (
              attentionProjects.map((project) => (
                <Link
                  className="rounded-md border border-white/10 bg-white/[0.03] p-3 transition hover:border-[var(--brass)]/45 hover:bg-white/[0.06]"
                  href={`/admin/projects#${project.id}`}
                  key={project.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {project.customerName}
                      </p>
                      <p className="mt-1 truncate text-sm text-[var(--muted)]">
                        {project.organizationName}
                      </p>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>
                  {project.errorMessage ? (
                    <p className="mt-3 line-clamp-2 text-sm text-[#ffd7dd]">
                      {project.errorMessage}
                    </p>
                  ) : null}
                </Link>
              ))
            ) : (
              <EmptyState label="Nothing currently flagged" />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">Latest pipeline events</p>
          <h3 className="text-xl font-semibold">Logs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--muted)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Step</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentLogs.map((log) => (
                <tr className="border-b border-white/5" key={log.id}>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">{statusLabel(log.step)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                    {log.projectId.slice(0, 8)}
                  </td>
                  <td className="max-w-[420px] px-4 py-3 text-[var(--muted)]">
                    {log.message ?? "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
