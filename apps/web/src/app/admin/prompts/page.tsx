import { Save } from "lucide-react";
import Link from "next/link";
import { publishPromptVersion } from "@/app/admin/actions";
import { EmptyState, StatusBadge, formatDateTime } from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminPromptDocuments } from "@/lib/admin/prompts";

interface AdminPromptsPageProps {
  searchParams: Promise<{
    prompt?: string;
    saved?: string;
  }>;
}

export default async function AdminPromptsPage({
  searchParams,
}: AdminPromptsPageProps) {
  const { prompt, saved } = await searchParams;
  await requirePlatformAdmin();

  const documents = await listAdminPromptDocuments();
  const selected =
    documents.find((document) => document.slug === prompt) ?? documents[0];

  if (!selected) {
    return (
      <div className="grid gap-5">
        <header>
          <p className="text-sm text-[var(--muted)]">Pipeline configuration</p>
          <h2 className="text-3xl font-semibold">Prompts</h2>
        </header>
        <EmptyState label="No prompt documents found" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Pipeline configuration</p>
        <h2 className="text-3xl font-semibold">Prompts</h2>
      </header>

      {saved ? (
        <div className="rounded-md border border-[#80d9b7]/25 bg-[#153f36]/70 px-3 py-2 text-sm text-[#bde5d9]">
          Prompt published.
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-3">
          <div className="grid gap-2">
            {documents.map((document) => (
              <Link
                className={`rounded-md border px-3 py-3 text-sm transition ${
                  document.slug === selected.slug
                    ? "border-[var(--brass)]/50 bg-[rgba(214,173,95,0.12)] text-[var(--foreground)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                }`}
                href={`/admin/prompts?prompt=${encodeURIComponent(
                  document.slug,
                )}`}
                key={document.slug}
              >
                <span className="block font-medium">{document.title}</span>
                <span className="mt-1 block font-mono text-xs">
                  {document.slug}
                </span>
              </Link>
            ))}
          </div>
        </aside>

        <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-semibold">{selected.title}</h3>
                <StatusBadge status={selected.bodySource} />
              </div>
              <p className="max-w-3xl text-sm text-[var(--muted)]">
                {selected.description}
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--muted)]">
                {selected.filePath}
              </p>
            </div>
            <div className="text-right text-xs text-[var(--muted)]">
              <p>
                Version{" "}
                <span className="font-mono">
                  {selected.latestVersionNumber ?? "file"}
                </span>
              </p>
              <p className="mt-1">{formatDateTime(selected.publishedAt)}</p>
            </div>
          </div>

          <form
            action={publishPromptVersion}
            className="grid gap-4 p-4"
            key={`${selected.slug}:${selected.latestVersionNumber ?? "file"}:${selected.updatedAt}`}
          >
            <input name="slug" type="hidden" value={selected.slug} />
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Prompt body</span>
              <textarea
                className="min-h-[560px] w-full resize-y rounded-md border border-[var(--line)] bg-black/35 p-4 font-mono text-sm leading-6 text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
                defaultValue={selected.body}
                name="body"
                spellCheck={false}
              />
            </label>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--muted)]">Change note</span>
                <input
                  className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
                  name="changeNote"
                  placeholder="What changed?"
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
                type="submit"
              >
                <Save className="size-4" />
                Publish version
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
