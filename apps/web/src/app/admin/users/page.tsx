import { ShieldPlus } from "lucide-react";
import { grantPlatformAdminByEmail } from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminUsersAndOrganizations } from "@/lib/admin/data";

interface AdminUsersPageProps {
  searchParams: Promise<{ updated?: string }>;
}

export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  const { updated } = await searchParams;
  await requirePlatformAdmin();

  const { organizations, profiles } = await listAdminUsersAndOrganizations();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Accounts and tenants</p>
        <h2 className="text-3xl font-semibold">Users & Organizations</h2>
      </header>

      {updated ? (
        <div className="rounded-md border border-[#80d9b7]/25 bg-[#153f36]/70 px-3 py-2 text-sm text-[#bde5d9]">
          Admin access updated.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
        <form action={grantPlatformAdminByEmail} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Grant platform admin</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="email"
              placeholder="admin@example.com"
              type="email"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Role</span>
            <select
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="role"
              defaultValue="operator"
            >
              <option value="owner">Owner</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] hover:bg-[#e6c57d]"
            type="submit"
          >
            <ShieldPlus className="size-4" />
            Grant
          </button>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xl font-semibold">Users</h3>
          </div>
          {profiles.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Memberships</th>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr className="border-b border-white/5" key={profile.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{profile.fullName}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {profile.email}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {profile.membershipCount}
                      </td>
                      <td className="px-4 py-3">
                        {profile.adminRole ? (
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge status={profile.adminRole} />
                            <StatusBadge status={profile.adminStatus ?? "active"} />
                          </div>
                        ) : (
                          <span className="text-[var(--muted)]">none</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {formatDateTime(profile.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No users found" />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-xl font-semibold">Organizations</h3>
          </div>
          {organizations.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Members</th>
                    <th className="px-4 py-3 font-medium">Projects</th>
                    <th className="px-4 py-3 font-medium">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => (
                    <tr className="border-b border-white/5" key={organization.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{organization.name}</p>
                        <p className="font-mono text-xs text-[var(--muted)]">
                          {organization.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={organization.subscriptionPlan} />
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {organization.memberCount}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {organization.projectCount}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {organization.creditBalance}
                        {organization.activeReservations ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {organization.activeReservations} reserved
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState label="No organizations found" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
