import { AdminShell } from "@/components/admin-shell";
import { requirePlatformAdmin } from "@/lib/admin/auth";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const admin = await requirePlatformAdmin();

  return (
    <AdminShell email={admin.email} role={admin.role}>
      {children}
    </AdminShell>
  );
}
