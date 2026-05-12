import {
  ArrowLeft,
  BadgeCheck,
  Clapperboard,
  Images,
  Library,
  Mic2,
} from "lucide-react";
import Link from "next/link";
import { getVideoImageRequirements } from "@interior-pro/shared";
import { NewProjectForm } from "@/components/new-project-form";
import { getRequiredWorkspace } from "@/lib/workspace";

interface NewProjectPageProps {
  searchParams: Promise<{
    message?: string;
  }>;
}

export default async function NewProjectPage({
  searchParams,
}: NewProjectPageProps) {
  const { message } = await searchParams;
  const { organization } = await getRequiredWorkspace();
  const imageRequirements = getVideoImageRequirements();

  return (
    <main className="app-shell fine-grid min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.9)] p-5 shadow-2xl shadow-black/25 sm:p-7">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
                <Clapperboard className="size-5" />
              </div>
              <div>
                <p className="text-sm text-[var(--muted)]">
                  {organization.name}
                </p>
                <h1 className="text-2xl font-semibold">New sales film</h1>
              </div>
            </div>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-sm text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--foreground)]"
              href="/dashboard"
            >
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </div>

          {message ? (
            <p className="mb-5 rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
              {message}
            </p>
          ) : null}

          <NewProjectForm
            imageRequirements={imageRequirements}
            organizationId={organization.id}
          />
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
            <div className="mb-5 flex items-center gap-2 text-sm text-[var(--stone)]">
              <BadgeCheck className="size-4 text-[var(--brass)]" />
              Intake checklist
            </div>
            <div className="space-y-4 text-sm text-[var(--muted)]">
              <div className="flex gap-3">
                <Images className="mt-0.5 size-4 text-[var(--brass)]" />
                <p>
                  {imageRequirements.minImages}-{imageRequirements.maxImages}{" "}
                  polished stills, ideally mixed wide, detail, and room-context
                  shots.
                  {imageRequirements.isTestOverride
                    ? " Test mode is allowing fewer images."
                    : null}
                </p>
              </div>
              <div className="flex gap-3">
                <Mic2 className="mt-0.5 size-4 text-[var(--brass)]" />
                <p>
                  The selected speaker and music type are stored with the
                  project and will feed the narration and edit stages.
                </p>
              </div>
              <div className="flex gap-3">
                <Library className="mt-0.5 size-4 text-[var(--brass)]" />
                <p>
                  Uploaded assets land in private organization storage under
                  the new project ID.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-5">
            <p className="text-sm text-[var(--muted)]">Provider path</p>
            <div className="mt-4 space-y-3 text-sm">
              <p className="rounded-md border border-white/10 bg-black/20 p-3">
                Nano Banana Pro image enhancement
              </p>
              <p className="rounded-md border border-white/10 bg-black/20 p-3">
                Kling 3.0 image-to-video motion
              </p>
              <p className="rounded-md border border-white/10 bg-black/20 p-3">
                Remotion final assembly
              </p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
