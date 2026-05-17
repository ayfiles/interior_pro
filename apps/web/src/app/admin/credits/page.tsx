import { PlusCircle } from "lucide-react";
import { addAdminCreditAdjustment } from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import {
  listAdminCredits,
  listAdminUsersAndOrganizations,
} from "@/lib/admin/data";

interface AdminCreditsPageProps {
  searchParams: Promise<{ adjusted?: string }>;
}

export default async function AdminCreditsPage({
  searchParams,
}: AdminCreditsPageProps) {
  const { adjusted } = await searchParams;
  await requirePlatformAdmin();

  const [{ ledger, reservations }, { organizations }] = await Promise.all([
    listAdminCredits(),
    listAdminUsersAndOrganizations(),
  ]);

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Ledger and reservations</p>
        <h2 className="text-3xl font-semibold">Credits</h2>
      </header>

      {adjusted ? (
        <div className="rounded-md border border-[#80d9b7]/25 bg-[#153f36]/70 px-3 py-2 text-sm text-[#bde5d9]">
          Credit adjustment created.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
        <form action={addAdminCreditAdjustment} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto] lg:items-end">
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Organization</span>
            <select
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="organizationId"
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Amount</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="amount"
              placeholder="5 or -1"
              type="number"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Note</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="note"
              placeholder="Pilot credit adjustment"
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] hover:bg-[#e6c57d]"
            type="submit"
          >
            <PlusCircle className="size-4" />
            Add
          </button>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xl font-semibold">Ledger</h3>
          </div>
          {ledger.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr className="border-b border-white/5" key={entry.id}>
                      <td className="px-4 py-3">{entry.organizationName}</td>
                      <td className="px-4 py-3">{statusLabel(entry.entryType)}</td>
                      <td className="px-4 py-3 font-mono">{entry.amount}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {entry.projectId?.slice(0, 8) ?? "n/a"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {formatDateTime(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No credit ledger entries yet" />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xl font-semibold">Reservations</h3>
          </div>
          {reservations.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Expires</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr className="border-b border-white/5" key={reservation.id}>
                      <td className="px-4 py-3">{reservation.organizationName}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={reservation.status} />
                      </td>
                      <td className="px-4 py-3 font-mono">{reservation.amount}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {formatDateTime(reservation.expiresAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {reservation.projectId?.slice(0, 8) ?? "n/a"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No credit reservations yet" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
