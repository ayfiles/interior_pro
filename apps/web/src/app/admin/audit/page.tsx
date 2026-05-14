import {
  EmptyState,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminAuditLogs } from "@/lib/admin/data";

function metadataSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return "{}";
  }

  return JSON.stringify(metadata);
}

export default async function AdminAuditPage() {
  await requirePlatformAdmin();

  const logs = await listAdminAuditLogs();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Administrative changes</p>
        <h2 className="text-3xl font-semibold">Audit Log</h2>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        {logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Resource</th>
                  <th className="px-4 py-3 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr className="border-b border-white/5 align-top" key={log.id}>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <p>{log.actorEmail ?? "System"}</p>
                      {log.actorUserId ? (
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {log.actorUserId.slice(0, 8)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{statusLabel(log.action)}</td>
                    <td className="px-4 py-3">
                      <p>{statusLabel(log.resourceType)}</p>
                      {log.resourceId ? (
                        <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {log.resourceId}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[420px] px-4 py-3">
                      <code className="line-clamp-3 text-xs text-[var(--muted)]">
                        {metadataSummary(log.metadata)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No admin audit events yet" />
          </div>
        )}
      </section>
    </div>
  );
}
