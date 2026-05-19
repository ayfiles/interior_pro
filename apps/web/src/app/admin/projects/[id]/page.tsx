import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CircleDollarSign,
  Film,
  PlayCircle,
  RefreshCcw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelAdminProject,
  markStaleAdminProviderJobForRetry,
  resetAndRetryAdminProviderJob,
  resumeAdminProjectPipeline,
  setAdminProjectStatus,
  updateAdminProviderJobStatus,
} from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { getAdminProjectDetail } from "@/lib/admin/data";

const PROJECT_STATUSES = [
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
] as const;
const RETRYABLE_PROVIDER_JOB_STATUSES = new Set([
  "failed",
  "requires_manual_retry",
  "canceled",
]);

function formatBytes(bytes: number | null) {
  if (!bytes) {
    return "n/a";
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();

  const { id } = await params;
  const detail = await getAdminProjectDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            className="mb-3 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/admin/projects"
          >
            <ArrowLeft className="size-4" />
            Projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-3xl font-semibold">
              {detail.project.customerName}
            </h2>
            <StatusBadge status={detail.project.status} />
          </div>
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">
            {detail.project.id}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <form action={resumeAdminProjectPipeline}>
            <input name="projectId" type="hidden" value={detail.project.id} />
            <input
              name="redirectTo"
              type="hidden"
              value={`/admin/projects/${detail.project.id}`}
            />
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--brass)] px-3 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
              type="submit"
            >
              <PlayCircle className="size-4" />
              Resume
            </button>
          </form>
          <form action={cancelAdminProject}>
            <input name="projectId" type="hidden" value={detail.project.id} />
            <input
              name="redirectTo"
              type="hidden"
              value={`/admin/projects/${detail.project.id}`}
            />
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/30 px-3 text-sm text-[#ffd7dd] transition hover:bg-[#782f3d]/50"
              type="submit"
            >
              <Ban className="size-4" />
              Cancel
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Organization</p>
          <p className="mt-2 font-medium">
            {detail.organization?.name ?? "Unknown"}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Created by</p>
          <p className="mt-2 truncate font-medium">
            {detail.creator?.email ?? "Unknown"}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Updated</p>
          <p className="mt-2 font-mono text-sm">
            {formatDateTime(detail.project.updatedAt)}
          </p>
        </div>
        <form
          action={setAdminProjectStatus}
          className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4"
        >
          <input name="projectId" type="hidden" value={detail.project.id} />
          <input
            name="redirectTo"
            type="hidden"
            value={`/admin/projects/${detail.project.id}`}
          />
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Set status</span>
            <div className="flex gap-2">
              <select
                className="h-10 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-black/35 px-2 text-sm outline-none focus:border-[var(--brass)]"
                defaultValue={detail.project.status}
                name="status"
              >
                {PROJECT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                className="grid size-10 place-items-center rounded-md border border-[var(--line)] text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                title="Update status"
                type="submit"
              >
                <RefreshCcw className="size-4" />
              </button>
            </div>
          </label>
        </form>
      </section>

      {detail.project.errorMessage ? (
        <div className="rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/30 px-3 py-2 text-sm text-[#ffd7dd]">
          {detail.project.errorMessage}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">Provider Cost</p>
            <CircleDollarSign className="size-4 text-[var(--brass)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatCost(detail.observability.totalProviderCostUsd)}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {formatNumber(detail.observability.totalProviderCredits)} provider credits
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">Clip Health</p>
            <Film className="size-4 text-[var(--brass)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {detail.observability.clipHealth.generatedClips}/
            {detail.observability.clipHealth.totalImages}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {detail.observability.clipHealth.qcPassedClips} QC passed,
            {" "}
            {detail.observability.clipHealth.qcFailedClips} QC failed
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">Provider Jobs</p>
            <RefreshCcw className="size-4 text-[var(--brass)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {detail.observability.providerHealth.completed}/
            {detail.observability.providerHealth.total}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {detail.observability.providerHealth.running} running,
            {" "}
            {detail.observability.providerHealth.issues} issues
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">Output Health</p>
            <AlertTriangle className="size-4 text-[var(--brass)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {detail.observability.outputHealth.renderReady ? "Ready" : "Pending"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {detail.observability.outputHealth.finalOutputCount} final output
            {detail.observability.outputHealth.finalOutputCount === 1 ? "" : "s"}
            {detail.observability.outputHealth.latestOutputQcStatus
              ? ` · QC ${statusLabel(detail.observability.outputHealth.latestOutputQcStatus)}`
              : ""}
          </p>
        </div>
      </section>

      {detail.observability.latestError ? (
        <section className="rounded-lg border border-[#ff9aaa]/30 bg-[#782f3d]/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#ffd7dd]">Latest Error</p>
              <p className="mt-2 text-sm text-[#ffd7dd]">
                {detail.observability.latestError.message}
              </p>
            </div>
            <div className="text-right text-xs text-[var(--muted)]">
              <p>{detail.observability.latestError.source}</p>
              <p>{formatDateTime(detail.observability.latestError.time)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4">
          <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-xl font-semibold">Final Outputs</h3>
            </div>
            <div className="grid gap-3 p-4">
              {detail.outputs.length ? (
                detail.outputs.map((output) => (
                  <article
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    key={output.id}
                  >
                    {output.signedUrl ? (
                      <video
                        className="aspect-video w-full rounded-md bg-black object-contain"
                        controls
                        preload="metadata"
                        src={output.signedUrl}
                      />
                    ) : null}
                    <div className="mt-3 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-4">
                      <span>{output.resolution}</span>
                      <span>{output.durationSeconds ?? "n/a"}s</span>
                      <span>{formatBytes(output.fileSizeBytes)}</span>
                      <span>{formatDateTime(output.createdAt)}</span>
                    </div>
                    {output.voiceoverScript ? (
                      <p className="mt-3 text-sm text-[var(--stone)]">
                        {output.voiceoverScript}
                      </p>
                    ) : null}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-[var(--muted)]">
                        QC report
                      </summary>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black/35 p-3 text-xs text-[var(--muted)]">
                        {jsonText(output.qcReport)}
                      </pre>
                    </details>
                  </article>
                ))
              ) : (
                <EmptyState label="No final output yet" />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-xl font-semibold">Images & Clips</h3>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {detail.images.map((image) => (
                <article
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                  key={image.id}
                >
                  {image.enhancedSignedUrl ?? image.originalSignedUrl ? (
                    <Image
                      alt={`Project frame ${image.orderIndex + 1}`}
                      className="aspect-[4/3] w-full rounded-md object-cover"
                      height={480}
                      src={image.enhancedSignedUrl ?? image.originalSignedUrl ?? ""}
                      width={640}
                    />
                  ) : null}
                  {image.clipSignedUrl ? (
                    <video
                      className="mt-3 aspect-video w-full rounded-md bg-black object-contain"
                      controls
                      preload="metadata"
                      src={image.clipSignedUrl}
                    />
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>Frame {image.orderIndex + 1}</span>
                    <StatusBadge status={image.videoStatus} />
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Prompt: {image.promptType ? statusLabel(image.promptType) : "n/a"}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
                    {image.videoStorageKey ?? image.upscaledStorageKey ?? image.originalStorageKey}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>

        <aside className="grid gap-4 content-start">
          <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-xl font-semibold">Operations Timeline</h3>
            </div>
            <div className="max-h-[520px] overflow-auto p-4">
              {detail.observability.timeline.length ? (
                detail.observability.timeline.map((event) => (
                  <div
                    className="border-b border-white/5 py-3"
                    key={event.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm">{event.title}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {formatDateTime(event.time)}
                        </p>
                      </div>
                      <StatusBadge status={event.status} />
                    </div>
                    {event.detail ? (
                      <p className="mt-2 line-clamp-3 break-words text-xs text-[var(--muted)]">
                        {event.detail}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <EmptyState label="No timeline events yet" />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-xl font-semibold">Provider Jobs</h3>
            </div>
            <div className="grid gap-2 p-4">
              {detail.providerJobs.length ? (
                detail.providerJobs.map((job) => (
                  <article
                    className="rounded-md border border-white/10 bg-white/[0.03] p-3"
                    key={job.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{statusLabel(job.step)}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {job.provider} · {job.model}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <StatusBadge status={job.status} />
                        {job.isStale ? <StatusBadge status="stale" /> : null}
                      </div>
                    </div>
                    {job.isStale && job.staleMinutes !== null ? (
                      <p className="mt-2 text-sm text-[#ffd7dd]">
                        No provider progress for {job.staleMinutes} minutes.
                      </p>
                    ) : null}
                    {job.errorMessage ? (
                      <p className="mt-2 text-sm text-[#ffd7dd]">
                        {job.errorMessage}
                      </p>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                      <span>Credits: {job.creditsConsumed ?? "n/a"}</span>
                      <span>Cost: {formatCost(job.estimatedCostUsd)}</span>
                      <span>File: {formatBytes(job.fileSizeBytes)}</span>
                      <span>Updated: {formatDateTime(job.updatedAt)}</span>
                    </div>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-[var(--muted)]">
                        Job details
                      </summary>
                      <div className="mt-2 grid gap-1 rounded-md bg-black/25 p-2 font-mono text-xs text-[var(--muted)]">
                        <span>ID: {job.id}</span>
                        <span>Task: {job.externalTaskId ?? "n/a"}</span>
                        <span>Started: {formatDateTime(job.startedAt)}</span>
                        <span>Submitted: {formatDateTime(job.submittedAt)}</span>
                        <span>Completed: {formatDateTime(job.completedAt)}</span>
                        <span>Failed: {formatDateTime(job.failedAt)}</span>
                        <span className="break-all">
                          Output: {job.outputStorageKey ?? "n/a"}
                        </span>
                      </div>
                    </details>
                    <form action={updateAdminProviderJobStatus} className="mt-3 flex gap-2">
                      <input name="providerJobId" type="hidden" value={job.id} />
                      <input
                        name="redirectTo"
                        type="hidden"
                        value={`/admin/projects/${detail.project.id}`}
                      />
                      <select
                        className="h-9 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-black/35 px-2 text-xs outline-none focus:border-[var(--brass)]"
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
                        className="mt-3 rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/20 p-3"
                      >
                        <input name="providerJobId" type="hidden" value={job.id} />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={`/admin/projects/${detail.project.id}`}
                        />
                        <p className="text-xs text-[var(--muted)]">
                          Marks this stuck running job as requiring manual retry.
                        </p>
                        <button
                          className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/30 px-3 text-xs font-semibold text-[#ffd7dd] transition hover:bg-[#782f3d]/50"
                          type="submit"
                        >
                          Mark stale
                        </button>
                      </form>
                    ) : null}
                    {RETRYABLE_PROVIDER_JOB_STATUSES.has(job.status) ? (
                      <form
                        action={resetAndRetryAdminProviderJob}
                        className="mt-3 rounded-md border border-[var(--brass)]/30 bg-[rgba(214,173,95,0.08)] p-3"
                      >
                        <input name="providerJobId" type="hidden" value={job.id} />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={`/admin/projects/${detail.project.id}`}
                        />
                        <p className="text-xs text-[var(--muted)]">
                          Deletes this provider-job lock, resets affected output fields,
                          and queues the step again. This may consume provider credits.
                        </p>
                        <button
                          className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-[var(--brass)] px-3 text-xs font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
                          type="submit"
                        >
                          Reset & retry
                        </button>
                      </form>
                    ) : null}
                  </article>
                ))
              ) : (
                <EmptyState label="No provider jobs yet" />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-xl font-semibold">Pipeline Logs</h3>
            </div>
            <div className="max-h-[680px] overflow-auto p-4">
              {detail.logs.map((log) => (
                <div className="border-b border-white/5 py-3" key={log.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{statusLabel(log.step)}</span>
                    <StatusBadge status={log.status} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatDateTime(log.createdAt)}
                  </p>
                  {log.message ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {log.message}
                    </p>
                  ) : null}
                  {log.metadata ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--muted)]">
                        Metadata
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-black/35 p-2 text-xs text-[var(--muted)]">
                        {jsonText(log.metadata)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
