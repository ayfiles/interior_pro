import {
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  Clapperboard,
  Layers3,
  Library,
  LogOut,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AI_PROVIDERS, VIDEO_REQUIREMENTS } from "@interior-pro/shared";
import { signOut } from "@/app/actions/auth";

export interface DashboardProject {
  createdAt: string;
  customerName: string;
  id: string;
  imageCount: number;
  reservationStatus?: string | null;
  specialNotes?: string | null;
  status: string;
}

export interface DashboardCreditSummary {
  available: number;
  included: number;
  reserved: number;
}

const pipeline = [
  {
    label: "Intake",
    value: `${VIDEO_REQUIREMENTS.minImages}-${VIDEO_REQUIREMENTS.maxImages} images`,
    icon: Upload,
  },
  {
    label: "Enhance",
    value: "Nano Banana Pro",
    icon: WandSparkles,
  },
  {
    label: "Motion",
    value: "Kling 3.0",
    icon: Clapperboard,
  },
  {
    label: "Render",
    value: "Remotion worker",
    icon: Layers3,
  },
];

const progressByStatus: Record<string, string> = {
  canceled: "100%",
  completed: "100%",
  draft: "8%",
  editing: "72%",
  failed: "100%",
  generating_video: "52%",
  media_qc: "64%",
  quality_check: "88%",
  queued: "24%",
  rendering: "80%",
  submitted: "16%",
  upscaling: "38%",
  validating: "28%",
};

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

interface DashboardShellProps {
  creditSummary?: DashboardCreditSummary;
  organizationName?: string;
  projects?: DashboardProject[];
  setupMode?: boolean;
  userEmail?: string;
}

export function DashboardShell({
  creditSummary = { available: 0, included: 0, reserved: 0 },
  organizationName = "Pilot showroom",
  projects = [],
  setupMode = false,
  userEmail,
}: DashboardShellProps) {
  const reservedPercent =
    creditSummary.included > 0
      ? Math.min((creditSummary.reserved / creditSummary.included) * 100, 100)
      : 0;

  return (
    <div className="app-shell grain fine-grid">
      <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 text-[var(--foreground)] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-[var(--line)] py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
              <Library className="size-5" />
            </div>
            <div>
              <p className="text-sm text-[var(--muted)]">{organizationName}</p>
              <h1 className="text-xl font-semibold">Sales Video Command</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {userEmail ? (
              <form action={signOut}>
                <button
                  className="grid size-10 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--foreground)]"
                  title={`Sign out ${userEmail}`}
                >
                  <LogOut className="size-4" />
                </button>
              </form>
            ) : null}
            <Link
              className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
              href="/projects/new"
            >
              <Sparkles className="size-4" />
              New film
            </Link>
          </div>
        </header>

        {setupMode ? (
          <div className="mt-4 rounded-lg border border-[var(--brass)]/40 bg-[rgba(214,173,95,0.12)] px-4 py-3 text-sm text-[var(--stone)]">
            Supabase keys are not configured yet. The dashboard is running in
            local demo mode; auth actions will activate once `.env.local` is
            populated.
          </div>
        ) : null}

        <section className="grid flex-1 gap-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4">
            <nav className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.78)] p-3 backdrop-blur">
              <Link
                className="flex h-10 items-center justify-between rounded-md bg-[var(--stone)] px-3 text-sm text-[#17110b]"
                href="/dashboard"
              >
                Dashboard
                <ArrowUpRight className="size-4" />
              </Link>
              <Link
                className="mt-2 flex h-10 items-center justify-between rounded-md px-3 text-sm text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
                href="/projects/new"
              >
                New film
                <Plus className="size-4" />
              </Link>
            </nav>

            <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.82)] p-4">
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <p className="text-sm text-[var(--muted)]">Credits</p>
                  <p className="mt-1 text-4xl font-semibold">
                    {creditSummary.available}
                  </p>
                </div>
                <CircleDollarSign className="size-5 text-[var(--brass)]" />
              </div>
              <div className="h-2 rounded-full bg-[#2a2118]">
                <div
                  className="h-2 rounded-full bg-[var(--brass)]"
                  style={{ width: `${reservedPercent}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {creditSummary.reserved} reserved of {creditSummary.included}{" "}
                pilot credits.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.82)] p-4">
              <div className="mb-4 flex items-center gap-2 text-sm text-[var(--stone)]">
                <ShieldCheck className="size-4 text-[var(--brass)]" />
                Production gates
              </div>
              <div className="space-y-3 text-sm text-[var(--muted)]">
                <p>Private storage buckets</p>
                <p>RLS by organization</p>
                <p>Credit reservation per project</p>
              </div>
            </div>
          </aside>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
              <div className="relative min-h-[470px]">
                <Image
                  alt="Luxury living room with sculptural furniture"
                  className="absolute inset-0 h-full w-full object-cover opacity-55"
                  fill
                  priority
                  src="https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1400&q=85"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,10,8,0.94),rgba(11,10,8,0.54),rgba(11,10,8,0.12))]" />
                <div className="relative flex min-h-[470px] flex-col justify-between p-6 sm:p-8">
                  <div className="max-w-2xl">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-[var(--brass)]/35 bg-black/35 px-3 py-2 text-sm text-[var(--stone)] backdrop-blur">
                      <BadgeCheck className="size-4 text-[var(--brass)]" />
                      Pipeline ready for pilot projects
                    </div>
                    <h2 className="max-w-xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
                      Luxury furniture films, generated from showroom stills.
                    </h2>
                    <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                      Upload curated product imagery, reserve a video credit,
                      enhance with {AI_PROVIDERS.imageEnhancement.primary}, move
                      with {AI_PROVIDERS.imageToVideo.primary}, and render a
                      finished sales film.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {pipeline.map((step) => {
                      const Icon = step.icon;

                      return (
                        <div
                          className="rounded-lg border border-white/10 bg-black/45 p-4 backdrop-blur"
                          key={step.label}
                        >
                          <Icon className="mb-6 size-5 text-[var(--brass)]" />
                          <p className="text-sm text-[var(--muted)]">
                            {step.label}
                          </p>
                          <p className="mt-1 font-semibold">{step.value}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <aside className="grid gap-4">
              <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--muted)]">Active queue</p>
                    <h3 className="text-2xl font-semibold">
                      {projects.length} projects
                    </h3>
                  </div>
                  <Play className="size-5 text-[var(--brass)]" />
                </div>
                <div className="space-y-3">
                  {projects.map((project) => (
                    <Link
                      className="block rounded-lg border border-white/10 bg-white/[0.035] p-4 transition hover:border-[var(--brass)]/55 hover:bg-white/[0.06]"
                      href={`/projects/${project.id}`}
                      key={project.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{project.customerName}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {project.imageCount} images
                          </p>
                        </div>
                        <span className="rounded-md bg-[var(--verde)] px-2 py-1 text-xs text-[#bde5d9]">
                          {statusLabel(project.status)}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-[#2a2118]">
                          <div
                            className="h-2 rounded-full bg-[var(--brass)]"
                            style={{
                              width: progressByStatus[project.status] ?? "12%",
                            }}
                          />
                        </div>
                        <span className="font-mono text-xs text-[var(--muted)]">
                          {progressByStatus[project.status] ?? "12%"}
                        </span>
                      </div>
                    </Link>
                  ))}

                  {projects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-4">
                      <p className="text-sm text-[var(--muted)]">
                        No projects yet.
                      </p>
                      <Link
                        className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--brass)] px-3 text-sm font-semibold text-[#19130b]"
                        href="/projects/new"
                      >
                        <Plus className="size-4" />
                        New film
                      </Link>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-5">
                <p className="text-sm text-[var(--muted)]">Provider stack</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    ["Image", AI_PROVIDERS.imageEnhancement.model],
                    ["Video", AI_PROVIDERS.imageToVideo.primary],
                    ["Voice", "ElevenLabs"],
                    ["Render", "Remotion"],
                  ].map(([label, value]) => (
                    <div
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                      key={label}
                    >
                      <p className="text-xs text-[var(--muted)]">{label}</p>
                      <p className="mt-2 text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
