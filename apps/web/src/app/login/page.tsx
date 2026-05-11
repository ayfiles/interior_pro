import { Library, LogIn } from "lucide-react";
import Link from "next/link";
import { signIn } from "@/app/actions/auth";

interface LoginPageProps {
  searchParams: Promise<{
    message?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { message } = await searchParams;

  return (
    <main className="app-shell fine-grid flex min-h-screen items-center justify-center px-4 py-10 text-[var(--foreground)]">
      <section className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.9)] p-6 shadow-2xl shadow-black/30">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
            <Library className="size-5" />
          </div>
          <div>
            <p className="text-sm text-[var(--muted)]">Interior Pro</p>
            <h1 className="text-2xl font-semibold">Sign in</h1>
          </div>
        </div>

        {message ? (
          <p className="mb-5 rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
            {message}
          </p>
        ) : null}

        <form action={signIn} className="space-y-4">
          <label className="block">
            <span className="text-sm text-[var(--muted)]">Email</span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
              name="email"
              placeholder="sales@showroom.com"
              required
              type="email"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--muted)]">Password</span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </label>
          <button className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]">
            <LogIn className="size-4" />
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--muted)]">
          New showroom?{" "}
          <Link className="font-medium text-[var(--brass)]" href="/register">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
