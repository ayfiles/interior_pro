import { PlayCircle } from "lucide-react";
import Link from "next/link";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
} from "@/components/admin-ui";
import { resumeAdminProjectPipeline } from "@/app/admin/actions";
import { requirePlatformAdmin } from "@/lib/admin/auth";
import { listAdminProjects } from "@/lib/admin/data";

export default async function AdminProjectsPage() {
  await requirePlatformAdmin();

  const projects = await listAdminProjects();

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Pipeline inventory</p>
        <h2 className="text-3xl font-semibold">Projects</h2>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)]">
        {projects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Images</th>
                  <th className="px-4 py-3 font-medium">Provider Jobs</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    className="border-b border-white/5 align-top"
                    id={project.id}
                    key={project.id}
                  >
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-[var(--foreground)] hover:text-[var(--brass)]"
                        href={`/admin/projects/${project.id}`}
                      >
                        {project.customerName}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                        {project.id}
                      </p>
                      {project.errorMessage ? (
                        <p className="mt-2 max-w-[420px] text-sm text-[#ffd7dd]">
                          {project.errorMessage}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {project.organizationName}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {project.imageCount}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono">{project.providerJobCount}</span>
                      {project.providerJobIssues ? (
                        <span className="ml-2 rounded-md border border-[#ff9aaa]/30 bg-[#782f3d]/35 px-2 py-1 text-xs text-[#ffd7dd]">
                          {project.providerJobIssues} issue
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {formatDateTime(project.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <form action={resumeAdminProjectPipeline}>
                        <input name="projectId" type="hidden" value={project.id} />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value="/admin/projects"
                        />
                        <button
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-xs text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                          type="submit"
                        >
                          <PlayCircle className="size-4" />
                          Resume
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
            <EmptyState label="No projects yet" />
          </div>
        )}
      </section>
    </div>
  );
}
