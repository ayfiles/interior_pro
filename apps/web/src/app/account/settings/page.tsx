import { ArrowLeft, Images, Save } from "lucide-react";
import Link from "next/link";
import { saveOrganizationLogoSettings } from "@/app/actions/account";
import { getRequiredWorkspace } from "@/lib/workspace";

interface AccountSettingsPageProps {
  searchParams: Promise<{
    message?: string;
  }>;
}

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function settingText(settings: unknown, key: string) {
  if (!isSettingsObject(settings)) {
    return null;
  }

  const value = settings[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const { message } = await searchParams;
  const { organization, supabase } = await getRequiredWorkspace();
  const { data: fullOrganization } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organization.id)
    .single();
  const settings = fullOrganization?.settings ?? {};
  const cornerLogoStorageKey = settingText(settings, "cornerLogoStorageKey");
  const outroLogoStorageKey = settingText(settings, "outroLogoStorageKey");
  const outroLogoBackgroundColor =
    settingText(settings, "outroLogoBackgroundColor") ?? "#ffffff";
  const outroLogoFullFrame =
    isSettingsObject(settings) && settings.outroLogoFullFrame === true;

  return (
    <main className="app-shell fine-grid min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.9)] p-6 shadow-2xl shadow-black/25">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-lg border border-[var(--brass)]/45 bg-[var(--panel-strong)] text-[var(--brass)]">
              <Images className="size-5" />
            </div>
            <div>
              <p className="text-sm text-[var(--muted)]">{organization.name}</p>
              <h1 className="text-2xl font-semibold">Logo settings</h1>
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

        <form action={saveOrganizationLogoSettings} className="grid gap-5">
          <label className="block">
            <span className="text-sm text-[var(--muted)]">
              Small corner logo
            </span>
            <input
              accept="image/*"
              className="mt-2 block w-full rounded-md border border-[var(--line)] bg-black/25 px-3 py-2 text-sm text-[var(--foreground)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#19130b]"
              name="cornerLogo"
              type="file"
            />
            {cornerLogoStorageKey ? (
              <span className="mt-2 block break-all text-xs text-[var(--muted)]">
                Current: {cornerLogoStorageKey}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-sm text-[var(--muted)]">
              Large outro logo
            </span>
            <input
              accept="image/*"
              className="mt-2 block w-full rounded-md border border-[var(--line)] bg-black/25 px-3 py-2 text-sm text-[var(--foreground)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#19130b]"
              name="outroLogo"
              type="file"
            />
            {outroLogoStorageKey ? (
              <span className="mt-2 block break-all text-xs text-[var(--muted)]">
                Current: {outroLogoStorageKey}
              </span>
            ) : null}
          </label>

          <label className="flex items-center gap-3 rounded-md border border-[var(--line)] bg-black/20 px-3 py-2 text-sm text-[var(--muted)]">
            <input
              className="size-4 accent-[var(--brass)]"
              defaultChecked={outroLogoBackgroundColor !== "#ffffff"}
              name="outroLogoHasWhite"
              type="checkbox"
            />
            Large logo has a lot of white
          </label>

          <label className="flex items-center gap-3 rounded-md border border-[var(--line)] bg-black/20 px-3 py-2 text-sm text-[var(--muted)]">
            <input
              className="size-4 accent-[var(--brass)]"
              defaultChecked={outroLogoFullFrame}
              name="outroLogoFullFrame"
              type="checkbox"
            />
            Large logo includes the full outro background
          </label>

          <button className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--brass)] px-4 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d]">
            <Save className="size-4" />
            Save logo settings
          </button>
        </form>
      </section>
    </main>
  );
}
