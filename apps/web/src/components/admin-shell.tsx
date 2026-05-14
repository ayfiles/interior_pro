import {
  Activity,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  History,
  LogOut,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import type { PlatformAdminRole } from "@/lib/admin/auth";

const navItems = [
  { href: "/admin", icon: Gauge, label: "Overview" },
  { href: "/admin/projects", icon: Database, label: "Projects" },
  { href: "/admin/provider-jobs", icon: Activity, label: "Provider Jobs" },
  { href: "/admin/prompts", icon: FileText, label: "Prompts" },
  { href: "/admin/testing", icon: FlaskConical, label: "Testing" },
  { href: "/admin/audit", icon: History, label: "Audit" },
] as const;

export function AdminShell({
  children,
  email,
  role,
}: {
  children: React.ReactNode;
  email: string | null;
  role: PlatformAdminRole;
}) {
  return (
    <div className="min-h-screen bg-[#080908] text-[var(--foreground)]">
      <div className="grid min-h-screen lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--line)] bg-[rgba(13,14,12,0.96)] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-4">
              <div className="grid size-10 place-items-center rounded-lg border border-[var(--brass)]/40 bg-[var(--panel-strong)] text-[var(--brass)]">
                <ServerCog className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  Interior Pro
                </p>
                <h1 className="truncate text-lg font-semibold">Admin</h1>
              </div>
            </div>

            <nav className="grid gap-1 px-3 py-3">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                    href={item.href}
                    key={item.href}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-[var(--line)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-[var(--stone)]">
                <ShieldCheck className="size-4 text-[var(--brass)]" />
                <span className="capitalize">{role}</span>
              </div>
              <p className="mb-3 truncate text-xs text-[var(--muted)]">
                {email ?? "Admin session"}
              </p>
              <form action={signOut}>
                <button
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--line)] text-sm text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                  type="submit"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </aside>

        <main className="min-w-0 bg-[linear-gradient(180deg,rgba(21,63,54,0.16),transparent_320px),#080908]">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
