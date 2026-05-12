import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  FileImage,
  Gauge,
  Library,
  Plus,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AI_PROVIDERS } from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { getRequiredWorkspace } from "@/lib/workspace";

interface ProjectPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    created?: string;
  }>;
}

interface ProjectRow {
  created_at: string;
  customer_name: string;
  error_message: string | null;
  id: string;
  organization_id: string;
  special_notes: string | null;
  status: string;
  voice_selection: string;
}

interface ProjectImageRow {
  id: string;
  order_index: number;
  original_storage_key: string;
  upscaled_storage_key: string | null;
  video_status: string;
}

interface PipelineLogRow {
  created_at: string;
  id: string;
  message: string | null;
  status: string;
  step: string;
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const { id } = await params;
  const { created } = await searchParams;
  const { organization, supabase } = await getRequiredWorkspace();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, organization_id, customer_name, status, voice_selection, special_notes, error_message, created_at",
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: images } = await supabase
    .from("project_images")
    .select(
      "id, original_storage_key, upscaled_storage_key, order_index, video_status",
    )
    .eq("project_id", id)
    .order("order_index", { ascending: true });

  const { data: logs } = await supabase
    .from("pipeline_logs")
    .select("id, step, status, message, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const { data: reservations } = await supabase
    .from("credit_reservations")
    .select("status, expires_at")
    .eq("project_id", id)
    .limit(1);

  const signedImages = await Promise.all(
    ((images ?? []) as ProjectImageRow[]).map(async (image) => {
      const previewStorageKey =
        image.upscaled_storage_key ?? image.original_storage_key;
      const { data } = await supabase.storage
        .from(STORAGE_BUCKETS.sourceAssets)
        .createSignedUrl(previewStorageKey, 60 * 10);

      return {
        ...image,
        isEnhanced: Boolean(image.upscaled_storage_key),
        signedUrl: data?.signedUrl,
      };
    }),
  );

  const typedProject = project as ProjectRow;
  const latestReservation = reservations?.[0];

  return (
    <main className="app-shell fine-grid min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
              <Library className="size-5" />
            </div>
            <div>
              <p className="text-sm text-[var(--muted)]">{organization.name}</p>
              <h1 className="text-2xl font-semibold">
                {typedProject.customer_name}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-sm text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--foreground)]"
              href="/dashboard"
            >
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brass)] px-3 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
              href="/projects/new"
            >
              <Plus className="size-4" />
              New film
            </Link>
          </div>
        </header>

        {created ? (
          <p className="rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
            Project created and source assets stored.
          </p>
        ) : null}

        {typedProject.error_message ? (
          <p className="rounded-md border border-[var(--claret)]/60 bg-[rgba(120,47,61,0.18)] px-3 py-2 text-sm text-[#ffd7dd]">
            {typedProject.error_message}
          </p>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--muted)]">Source set</p>
                  <h2 className="text-2xl font-semibold">
                    {signedImages.length} images
                  </h2>
                </div>
                <span className="rounded-md bg-[var(--verde)] px-3 py-2 text-sm text-[#bde5d9]">
                  {statusLabel(typedProject.status)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {signedImages.map((image) => (
                  <article
                    className="overflow-hidden rounded-lg border border-white/10 bg-black/25"
                    key={image.id}
                  >
                    <div className="relative aspect-[4/3] bg-[#0f0c09]">
                      {image.signedUrl ? (
                        <Image
                          alt={`Project ${image.isEnhanced ? "enhanced" : "source"} ${image.order_index + 1}`}
                          className="object-cover"
                          fill
                          sizes="(min-width: 1024px) 30vw, 50vw"
                          src={image.signedUrl}
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-[var(--muted)]">
                          <FileImage className="size-8" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-xs text-[var(--muted)]">
                      <span>Frame {image.order_index + 1}</span>
                      <span>
                        {image.isEnhanced
                          ? "Enhanced"
                          : statusLabel(image.video_status)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
              <div className="mb-5 flex items-center gap-2">
                <Gauge className="size-5 text-[var(--brass)]" />
                <h2 className="text-xl font-semibold">Pipeline</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Intake", "complete"],
                  ["Enhance", AI_PROVIDERS.imageEnhancement.primary],
                  ["Motion", AI_PROVIDERS.imageToVideo.primary],
                  ["Render", "remotion"],
                ].map(([label, value], index) => (
                  <div
                    className="rounded-lg border border-white/10 bg-black/20 p-4"
                    key={label}
                  >
                    <p className="font-mono text-xs text-[var(--muted)]">
                      0{index + 1}
                    </p>
                    <p className="mt-4 font-semibold">{label}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-5">
            <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
              <p className="text-sm text-[var(--muted)]">Project state</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <span className="text-[var(--muted)]">Status</span>
                  <span>{statusLabel(typedProject.status)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <span className="text-[var(--muted)]">Credit</span>
                  <span>
                    {latestReservation
                      ? statusLabel(latestReservation.status)
                      : "Open"}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <span className="text-[var(--muted)]">Voice</span>
                  <span>{statusLabel(typedProject.voice_selection)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Created</span>
                  <span>
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                    }).format(new Date(typedProject.created_at))}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-5">
              <div className="mb-4 flex items-center gap-2">
                <CalendarClock className="size-5 text-[var(--brass)]" />
                <h2 className="text-xl font-semibold">Log</h2>
              </div>
              <div className="space-y-3">
                {((logs ?? []) as PipelineLogRow[]).map((log) => (
                  <article
                    className="rounded-lg border border-white/10 bg-black/20 p-3"
                    key={log.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{statusLabel(log.step)}</p>
                      <BadgeCheck className="size-4 text-[var(--brass)]" />
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {log.message ?? statusLabel(log.status)}
                    </p>
                  </article>
                ))}
                {logs?.length ? null : (
                  <p className="text-sm text-[var(--muted)]">
                    No log events yet.
                  </p>
                )}
              </div>
            </section>

            {typedProject.special_notes ? (
              <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
                <p className="text-sm text-[var(--muted)]">Sales notes</p>
                <p className="mt-3 text-sm leading-6 text-[var(--stone)]">
                  {typedProject.special_notes}
                </p>
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
