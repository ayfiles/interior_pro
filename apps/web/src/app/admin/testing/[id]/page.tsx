import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileJson,
  ImageIcon,
  PlayCircle,
  RotateCw,
} from "lucide-react";
import { queueAdminTestingRun } from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { getAdminTestingRunDetail } from "@/lib/admin/data";

function formatBytes(value: number | null) {
  if (!value) {
    return "n/a";
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function Preview({
  contentType,
  signedUrl,
}: {
  contentType: string | null;
  signedUrl: string | null;
}) {
  if (!signedUrl) {
    return null;
  }

  if (contentType?.startsWith("image/")) {
    return (
      // Signed Supabase preview URLs are short-lived and not routed through Next Image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className="mt-3 aspect-video w-full rounded-md border border-white/10 object-cover"
        src={signedUrl}
      />
    );
  }

  if (contentType?.startsWith("video/")) {
    return (
      <video
        className="mt-3 aspect-video w-full rounded-md border border-white/10 bg-black object-contain"
        controls
        src={signedUrl}
      />
    );
  }

  if (contentType?.startsWith("audio/")) {
    return <audio className="mt-3 w-full" controls src={signedUrl} />;
  }

  return null;
}

interface AdminTestingRunDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function AdminTestingRunDetailPage({
  params,
}: AdminTestingRunDetailPageProps) {
  const { id } = await params;
  await requirePlatformAdmin();

  const detail = await getAdminTestingRunDetail(id);

  if (!detail) {
    notFound();
  }

  const canRequeue = ["draft", "failed", "canceled"].includes(
    detail.run.status,
  );

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            className="mb-3 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/admin/testing"
          >
            <ArrowLeft className="size-4" />
            Testing
          </Link>
          <p className="text-sm text-[var(--muted)]">
            {statusLabel(detail.run.targetStep)} /{" "}
            {statusLabel(detail.run.runMode)}
          </p>
          <h2 className="text-3xl font-semibold">{detail.run.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRequeue ? (
            <form action={queueAdminTestingRun}>
              <input name="testingRunId" type="hidden" value={detail.run.id} />
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--brass)] px-3 text-xs font-semibold text-[#19130b] hover:bg-[#e6c57d]"
                type="submit"
              >
                <RotateCw className="size-4" />
                Re-queue
              </button>
            </form>
          ) : null}
          <StatusBadge status={detail.run.status} />
        </div>
      </header>

      {detail.run.errorMessage ? (
        <div className="rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/35 px-3 py-2 text-sm text-[#ffd7dd]">
          {detail.run.errorMessage}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Created</p>
          <p className="mt-2 font-mono text-sm">
            {formatDateTime(detail.run.createdAt)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Started</p>
          <p className="mt-2 font-mono text-sm">
            {formatDateTime(detail.run.startedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Completed</p>
          <p className="mt-2 font-mono text-sm">
            {formatDateTime(detail.run.completedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <p className="text-sm text-[var(--muted)]">Tracked cost</p>
          <p className="mt-2 font-mono text-sm">
            ${detail.run.actualCostUsd.toFixed(4)}
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
            <ImageIcon className="size-5 text-[var(--brass)]" />
            <h3 className="text-xl font-semibold">Inputs</h3>
          </div>
          {detail.assets.length ? (
            <div className="grid gap-3 p-4">
              {detail.assets.map((asset) => (
                <div
                  className="rounded-md border border-white/10 bg-black/20 p-3"
                  key={asset.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{statusLabel(asset.kind)}</p>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">
                        {asset.storageKey}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {formatBytes(asset.fileSizeBytes)}
                    </span>
                  </div>
                  <Preview
                    contentType={asset.contentType}
                    signedUrl={asset.signedUrl}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No inputs uploaded" />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
            <PlayCircle className="size-5 text-[var(--brass)]" />
            <h3 className="text-xl font-semibold">Outputs</h3>
          </div>
          {detail.outputs.length ? (
            <div className="grid gap-3 p-4">
              {detail.outputs.map((output) => (
                <div
                  className="rounded-md border border-white/10 bg-black/20 p-3"
                  key={output.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{output.label}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {statusLabel(output.kind)}
                      </p>
                    </div>
                    {output.signedUrl ? (
                      <a
                        className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                        href={output.signedUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                  <Preview
                    contentType={output.contentType}
                    signedUrl={output.signedUrl}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No outputs yet" />
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <FileJson className="size-5 text-[var(--brass)]" />
          <h3 className="text-xl font-semibold">Run Data</h3>
        </div>
        <div className="grid gap-3 p-4 xl:grid-cols-2">
          <div>
            <p className="mb-2 text-sm text-[var(--muted)]">Config</p>
            <pre className="max-h-96 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs">
              {JSON.stringify(detail.run.config, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-2 text-sm text-[var(--muted)]">Input summary</p>
            <pre className="max-h-96 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs">
              {JSON.stringify(detail.run.inputSummary, null, 2)}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">Execution trace</p>
          <h3 className="text-xl font-semibold">Logs</h3>
        </div>
        {detail.logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {detail.logs.map((log) => (
                  <tr
                    className="border-b border-white/5 align-top"
                    key={log.id}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">{statusLabel(log.step)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3">{log.message}</td>
                    <td className="px-4 py-3">
                      <pre className="max-h-40 max-w-lg overflow-auto rounded-md border border-white/10 bg-black/30 p-2 text-xs">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No logs yet" />
          </div>
        )}
      </section>
    </div>
  );
}
