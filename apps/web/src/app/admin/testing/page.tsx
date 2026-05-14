import { PlayCircle } from "lucide-react";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
} from "@/components/admin-ui";
import { resumeAdminProjectPipeline } from "@/app/admin/actions";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminTestingProjects } from "@/lib/admin/data";

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

  const projects = await listAdminTestingProjects();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Controlled pipeline runs</p>
        <h2 className="text-3xl font-semibold">Testing</h2>
      </header>

      {queued ? (
        <div className="rounded-md border border-[var(--brass)]/35 bg-[rgba(214,173,95,0.12)] px-3 py-2 text-sm text-[var(--stone)]">
          Pipeline event queued for project {queued}.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">Existing projects</p>
          <h3 className="text-xl font-semibold">Resume Pipeline</h3>
        </div>
        {projects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Images</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr className="border-b border-white/5" key={project.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{project.customerName}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                        {project.id}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {project.imageCount}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(project.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <form action={resumeAdminProjectPipeline}>
                        <input name="projectId" type="hidden" value={project.id} />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value="/admin/testing"
                        />
                        <button
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--brass)] px-3 text-xs font-semibold text-[#19130b] transition hover:bg-[#e6c57d]"
                          type="submit"
                        >
                          <PlayCircle className="size-4" />
                          Queue event
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
            <EmptyState label="No projects available for testing" />
          </div>
        )}
      </section>
    </div>
  );
}
