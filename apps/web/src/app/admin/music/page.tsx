import { Music2, Upload } from "lucide-react";
import {
  toggleAdminMusicTrack,
  upsertAdminMusicTrack,
} from "@/app/admin/actions";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
} from "@/components/admin-ui";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminMusicTracks } from "@/lib/admin/data";

interface AdminMusicPageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function AdminMusicPage({
  searchParams,
}: AdminMusicPageProps) {
  const { created, updated } = await searchParams;
  await requirePlatformAdmin();

  const tracks = await listAdminMusicTracks();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Music library</p>
        <h2 className="text-3xl font-semibold">Music</h2>
      </header>

      {created || updated ? (
        <div className="rounded-md border border-[#80d9b7]/25 bg-[#153f36]/70 px-3 py-2 text-sm text-[#bde5d9]">
          Music library updated.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
        <form action={upsertAdminMusicTrack} className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_150px_minmax(0,1fr)_auto] xl:items-end">
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Track name</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="name"
              placeholder="Evening showroom"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Genre</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="genre"
              placeholder="modern_luxury"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Duration sec</span>
            <input
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 text-sm outline-none focus:border-[var(--brass)]"
              name="durationSeconds"
              placeholder="60"
              type="number"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Upload file</span>
            <input
              accept="audio/*"
              className="h-10 rounded-md border border-[var(--line)] bg-black/35 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-[#19130b] focus:border-[var(--brass)]"
              name="musicFile"
              type="file"
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] hover:bg-[#e6c57d]"
            type="submit"
          >
            <Upload className="size-4" />
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <Music2 className="size-5 text-[var(--brass)]" />
          <h3 className="text-xl font-semibold">Tracks</h3>
        </div>
        {tracks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Track</th>
                  <th className="px-4 py-3 font-medium">Genre</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => (
                  <tr className="border-b border-white/5" key={track.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{track.name}</p>
                      <p className="break-all font-mono text-xs text-[var(--muted)]">
                        {track.fileStorageKey}
                      </p>
                    </td>
                    <td className="px-4 py-3">{track.genre ?? "n/a"}</td>
                    <td className="px-4 py-3 font-mono">
                      {track.durationSeconds}s
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={track.isActive ? "active" : "disabled"}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(track.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <form action={toggleAdminMusicTrack}>
                        <input name="trackId" type="hidden" value={track.id} />
                        <input
                          name="isActive"
                          type="hidden"
                          value={String(!track.isActive)}
                        />
                        <button
                          className="h-9 rounded-md border border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                          type="submit"
                        >
                          {track.isActive ? "Disable" : "Enable"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState label="No music tracks yet" />
          </div>
        )}
      </section>
    </div>
  );
}
