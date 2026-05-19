import Link from "next/link";
import {
  markStaleAdminProviderJobForRetry,
  resetAndRetryAdminProviderJob,
  updateAdminProviderJobStatus,
} from "@/app/admin/actions";
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

const RETRYABLE_PROVIDER_JOB_STATUSES = new Set([
  "failed",
  "requires_manual_retry",
  "canceled",
]);

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
                  <th className="px-4 py-3 font-medium">Action</th>
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
                        href={`/admin/projects/${job.projectId}`}
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
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge status={job.status} />
                        {job.isStale ? <StatusBadge status="stale" /> : null}
                      </div>
                      {job.isStale && job.staleMinutes !== null ? (
                        <p className="mt-2 text-xs text-[#ffd7dd]">
                          No provider progress for {job.staleMinutes} minutes.
                        </p>
                      ) : null}
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
                    <td className="px-4 py-3">
                      <form action={updateAdminProviderJobStatus} className="flex gap-2">
                        <input name="providerJobId" type="hidden" value={job.id} />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value="/admin/provider-jobs"
                        />
                        <select
                          className="h-9 rounded-md border border-[var(--line)] bg-black/35 px-2 text-xs outline-none focus:border-[var(--brass)]"
                          defaultValue={job.status}
                          name="status"
                        >
                          {[
                            "processing",
                            "completed",
                            "failed",
                            "requires_manual_retry",
                            "canceled",
                          ].map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(status)}
                            </option>
                          ))}
                        </select>
                        <button
                          className="h-9 rounded-md border border-[var(--line)] px-2 text-xs text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                          type="submit"
                        >
                          Save
                        </button>
                      </form>
                      {job.isStale ? (
                        <form
                          action={markStaleAdminProviderJobForRetry}
                          className="mt-2"
                        >
                          <input name="providerJobId" type="hidden" value={job.id} />
                          <input
                            name="redirectTo"
                            type="hidden"
                            value="/admin/provider-jobs"
                          />
                          <button
                            className="h-9 rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/30 px-2 text-xs text-[#ffd7dd] hover:bg-[#782f3d]/50"
                            title="Marks this stuck running job as requiring manual retry."
                            type="submit"
                          >
                            Mark stale
                          </button>
                        </form>
                      ) : null}
                      {RETRYABLE_PROVIDER_JOB_STATUSES.has(job.status) ? (
                        <form
                          action={resetAndRetryAdminProviderJob}
                          className="mt-2"
                        >
                          <input name="providerJobId" type="hidden" value={job.id} />
                          <input
                            name="redirectTo"
                            type="hidden"
                            value="/admin/provider-jobs"
                          />
                          <button
                            className="h-9 rounded-md bg-[var(--brass)] px-2 text-xs font-semibold text-[#19130b] hover:bg-[#e6c57d]"
                            title="Deletes the provider-job lock and queues this step again. May consume provider credits."
                            type="submit"
                          >
                            Reset & retry
                          </button>
                        </form>
                      ) : null}
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
