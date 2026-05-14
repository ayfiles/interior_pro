import Link from "next/link";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminProviderJobs } from "@/lib/admin/data";

function formatCost(value: number | null) {
  if (value === null) {
    return "n/a";
  }

  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 4,
    style: "currency",
  }).format(value);
}

export default async function AdminProviderJobsPage() {
  await requirePlatformAdmin();

  const jobs = await listAdminProviderJobs();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">External work ledger</p>
        <h2 className="text-3xl font-semibold">Provider Jobs</h2>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        {jobs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Credits</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr className="border-b border-white/5 align-top" key={job.id}>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-[var(--stone)]">
                        {job.id}
                      </p>
                      {job.externalTaskId ? (
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {job.externalTaskId}
                        </p>
                      ) : null}
                      {job.errorMessage ? (
                        <p className="mt-2 max-w-[360px] text-sm text-[#ffd7dd]">
                          {job.errorMessage}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium hover:text-[var(--brass)]"
                        href={`/projects/${job.projectId}`}
                      >
                        {job.projectName}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                        {job.projectId.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-4 py-3">{statusLabel(job.step)}</td>
                    <td className="px-4 py-3">
                      <p>{job.provider}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {job.model}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {job.creditsConsumed ?? "n/a"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatCost(job.estimatedCostUsd)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(job.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No provider jobs yet" />
          </div>
        )}
      </section>
    </div>
  );
}
