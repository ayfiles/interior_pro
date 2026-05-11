import { Building2, Library } from "lucide-react";
import { redirect } from "next/navigation";
import { createOrganization } from "@/app/actions/auth";
import { getSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

interface OnboardingPageProps {
  searchParams: Promise<{
    message?: string;
  }>;
}

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { message } = await searchParams;

  if (getSupabasePublicConfig().isConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/login");
    }
  }

  return (
    <main className="app-shell fine-grid flex min-h-screen items-center justify-center px-4 py-10 text-[var(--foreground)]">
      <section className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.9)] p-6 shadow-2xl shadow-black/30">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
            <Library className="size-5" />
          </div>
          <div>
            <p className="text-sm text-[var(--muted)]">Interior Pro</p>
            <h1 className="text-2xl font-semibold">Create organization</h1>
          </div>
        </div>

        {message ? (
          <p className="mb-5 rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
            {message}
          </p>
        ) : null}

        <form action={createOrganization} className="space-y-4">
          <label className="block">
            <span className="text-sm text-[var(--muted)]">
              Showroom or company name
            </span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
              name="organizationName"
              placeholder="Maison Vale"
              required
            />
          </label>
          <button className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]">
            <Building2 className="size-4" />
            Create organization
          </button>
        </form>
      </section>
    </main>
  );
}
