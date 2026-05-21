import Link from "next/link";
import { FlaskConical, PlayCircle, Upload } from "lucide-react";
import { createAdminTestingRun } from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  statusLabel,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import {
  listAdminMusicTracks,
  listAdminTestingProjects,
  listAdminTestingRuns,
} from "@/lib/admin/data";

const TEST_STEPS = [
  {
    description:
      "Runs Nano Banana Pro directly and creates a 2K enhanced image.",
    label: "Nano Banana Pro Upscaler",
    value: "image_upscaler",
  },
  {
    description: "Classifies enhanced images for single-shot or multi-shot.",
    label: "Video Agent",
    value: "video_agent",
  },
  {
    description: "Creates Kling 3.0 clips through KIE and stores them for QC.",
    label: "Kling Video",
    value: "kling_video",
  },
  {
    description: "Runs local media checks on uploaded video clips.",
    label: "Media QC",
    value: "media_qc",
  },
  {
    description: "Builds clip segments, story plan, and final edit plan.",
    label: "Editor Agent",
    value: "editor_agent",
  },
  {
    description: "Builds music timing and optionally generates voiceover audio.",
    label: "Voice + Music",
    value: "voice_music",
  },
  {
    description: "Renders from a manifest or clips; voiceover audio is optional.",
    label: "Remotion Render",
    value: "remotion_render",
  },
  {
    description: "Runs all currently enabled isolated test stages.",
    label: "Full Pipeline",
    value: "full_pipeline",
  },
] as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 4,
    style: "currency",
  }).format(value);
}

interface AdminTestingPageProps {
  searchParams: Promise<{
    queued?: string;
  }>;
}

export default async function AdminTestingPage({
  searchParams,
}: AdminTestingPageProps) {
  const { queued } = await searchParams;
  await requirePlatformAdmin();

  const [runs, projects, musicTracks] = await Promise.all([
    listAdminTestingRuns(),
    listAdminTestingProjects(),
    listAdminMusicTracks(),
  ]);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">
            Isolated agent and pipeline experiments
          </p>
          <h2 className="text-3xl font-semibold">Testing Center</h2>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-black/20 px-3 py-2 text-xs text-[var(--muted)]">
          <FlaskConical className="size-4 text-[var(--brass)]" />
          Runs are separate from customer projects
        </div>
      </header>

      {queued ? (
        <div className="rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
          Testing run queued: {queued}.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
        <div className="mb-4">
          <p className="text-sm text-[var(--muted)]">New test run</p>
          <h3 className="text-xl font-semibold">Configure Scope</h3>
        </div>
        <form action={createAdminTestingRun} className="grid gap-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_180px]">
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Test name</span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="name"
                placeholder="Editor cutpoints with Midnight Room Pulse"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Step</span>
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="targetStep"
                required
              >
                {TEST_STEPS.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Mode</span>
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="runMode"
              >
                <option value="only_step">Only this step</option>
                <option value="from_step">From this step onward</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Customer/test context
              </span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="customerName"
                placeholder="Internal test"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Music genre</span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="musicGenre"
                placeholder="soft_electronic"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Music track</span>
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="musicId"
              >
                <option value="">No specific track</option>
                {musicTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name} ({track.genre ?? "n/a"})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Voice</span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="voiceSelection"
                placeholder="speaker_amelie"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Expected QC duration
              </span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                min="1"
                name="expectedDurationSeconds"
                placeholder="Auto for Kling"
                step="0.1"
                type="number"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Kling mode</span>
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="klingMode"
              >
                <option value="auto">Auto via Video Agent</option>
                <option value="single_shot">Single shot</option>
                <option value="multi_shot">Multi shot</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Nano Banana prompt override
              </span>
              <input
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
                name="promptOverride"
                placeholder="Optional direct Nano Banana prompt"
              />
            </label>
          </div>

          <label className="flex items-start gap-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm text-[var(--stone)]">
            <input
              className="mt-1 size-4 accent-[var(--brass)]"
              defaultChecked
              name="skipVoiceover"
              type="checkbox"
            />
            <span>
              <span className="block font-medium">Skip voiceover for this test</span>
              <span className="block text-xs text-[var(--muted)]">
                Render with music and cutpoints only; no ElevenLabs or placeholder
                voiceover audio will be generated or required.
              </span>
            </span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Notes</span>
            <textarea
              className="min-h-20 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none focus:border-[var(--brass)]"
              name="notes"
              placeholder="What should this run prove?"
            />
          </label>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Source images</span>
              <input
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="sourceImages"
                type="file"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Enhanced images
              </span>
              <input
                accept="image/jpeg,image/png,image/webp"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="enhancedImages"
                type="file"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Video clips</span>
              <input
                accept="video/mp4,video/quicktime"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="videoClips"
                type="file"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Render manifest JSON
              </span>
              <input
                accept=".json,application/json"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="renderManifests"
                type="file"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">
                Voiceover audio
              </span>
              <input
                accept="audio/mpeg,audio/wav"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="voiceoverAudio"
                type="file"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--muted)]">Music audio</span>
              <input
                accept="audio/mpeg,audio/wav"
                className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
                multiple
                name="musicAudio"
                type="file"
              />
            </label>
          </div>

          <div className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-[var(--muted)] md:grid-cols-3">
            {TEST_STEPS.map((step) => (
              <p key={step.value}>
                <span className="text-[var(--stone)]">{step.label}:</span>{" "}
                {step.description}
              </p>
            ))}
          </div>

          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] hover:bg-[#e6c57d]"
            type="submit"
          >
            <Upload className="size-4" />
            Create & Queue Test
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">Isolated runs</p>
          <h3 className="text-xl font-semibold">Testing Runs</h3>
        </div>
        {runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assets</th>
                  <th className="px-4 py-3 font-medium">Outputs</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    className="border-b border-white/5 align-top"
                    key={run.id}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{run.name}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                        {run.id}
                      </p>
                      {run.errorMessage ? (
                        <p className="mt-2 max-w-sm text-xs text-[#ffd7dd]">
                          {run.errorMessage}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{statusLabel(run.targetStep)}</td>
                    <td className="px-4 py-3">{statusLabel(run.runMode)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 font-mono">{run.assetCount}</td>
                    <td className="px-4 py-3 font-mono">{run.outputCount}</td>
                    <td className="px-4 py-3 font-mono">
                      {formatMoney(run.actualCostUsd || run.estimatedCostUsd)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(run.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                        href={`/admin/testing/${run.id}`}
                      >
                        <PlayCircle className="size-4" />
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No testing runs yet" />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.72)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">Legacy controls</p>
          <h3 className="text-xl font-semibold">Recent Real Projects</h3>
        </div>
        {projects.length ? (
          <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-4">
            {projects.slice(0, 8).map((project) => (
              <Link
                className="rounded-md border border-white/10 bg-black/20 p-3 transition hover:border-[var(--brass)]/45 hover:bg-white/[0.06]"
                href={`/admin/projects/${project.id}`}
                key={project.id}
              >
                <p className="truncate font-medium">{project.customerName}</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <StatusBadge status={project.status} />
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {project.imageCount} img
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No real projects available" />
          </div>
        )}
      </section>
    </div>
  );
}
