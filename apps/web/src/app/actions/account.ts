"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { createAdminClient, type Json } from "@/lib/supabase/admin";
import { getRequiredWorkspace } from "@/lib/workspace";

const MAX_LOGO_BYTES = 4 * 1024 * 1024;
const LOGO_BACKGROUND_GREY = "#2d3437";

function isUpload(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function safeFileName(file: File, fallback: string) {
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase()
    : null;
  const cleanBase = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${cleanBase || fallback}.${extension || "png"}`;
}

function assertLogoFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Logo must be an image file.");
  }

  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Logo must be smaller than 4 MB.");
  }
}

function jsonObject(value: Json | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}

async function uploadLogo({
  file,
  kind,
  organizationId,
}: {
  file: File;
  kind: "corner" | "outro";
  organizationId: string;
}) {
  assertLogoFile(file);
  const admin = createAdminClient();
  const storageKey = `${organizationId}/account/logos/${kind}-${Date.now()}-${safeFileName(
    file,
    `${kind}-logo`,
  )}`;
  const { error } = await admin.storage
    .from(STORAGE_BUCKETS.sourceAssets)
    .upload(storageKey, file, {
      contentType: file.type || "image/png",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return storageKey;
}

export async function saveOrganizationLogoSettings(formData: FormData) {
  const { membership, organization } = await getRequiredWorkspace();

  if (membership.role !== "owner" && membership.role !== "admin") {
    redirect("/account/settings?message=Only%20admins%20can%20change%20logos");
  }

  const admin = createAdminClient();
  const { data: currentOrganization, error: currentError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organization.id)
    .single();

  if (currentError) {
    throw currentError;
  }

  const cornerLogo = formData.get("cornerLogo");
  const outroLogo = formData.get("outroLogo");
  const outroFullFrame = formData.get("outroLogoFullFrame") === "on";
  const outroHasWhite = formData.get("outroLogoHasWhite") === "on";
  const settings: Record<string, Json> = {
    ...jsonObject(currentOrganization.settings),
    outroLogoFullFrame: outroFullFrame,
    outroLogoBackgroundColor: outroHasWhite ? LOGO_BACKGROUND_GREY : "#ffffff",
  };

  if (isUpload(cornerLogo)) {
    settings.cornerLogoStorageKey = await uploadLogo({
      file: cornerLogo,
      kind: "corner",
      organizationId: organization.id,
    });
  }

  if (isUpload(outroLogo)) {
    settings.outroLogoStorageKey = await uploadLogo({
      file: outroLogo,
      kind: "outro",
      organizationId: organization.id,
    });
  }

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      settings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.id);

  if (updateError) {
    throw updateError;
  }

  revalidatePath("/account/settings");
  revalidatePath("/dashboard");
  redirect("/account/settings?message=Logo%20settings%20saved");
}

export async function saveOrganizationLogosDuringOnboarding({
  formData,
  organizationId,
}: {
  formData: FormData;
  organizationId: string;
}) {
  const cornerLogo = formData.get("cornerLogo");
  const outroLogo = formData.get("outroLogo");
  const outroFullFrame = formData.get("outroLogoFullFrame") === "on";
  const outroHasWhite = formData.get("outroLogoHasWhite") === "on";
  const settings: Record<string, Json> = {
    outroLogoFullFrame: outroFullFrame,
    outroLogoBackgroundColor: outroHasWhite ? LOGO_BACKGROUND_GREY : "#ffffff",
  };

  if (isUpload(cornerLogo)) {
    settings.cornerLogoStorageKey = await uploadLogo({
      file: cornerLogo,
      kind: "corner",
      organizationId,
    });
  }

  if (isUpload(outroLogo)) {
    settings.outroLogoStorageKey = await uploadLogo({
      file: outroLogo,
      kind: "outro",
      organizationId,
    });
  }

  if (Object.keys(settings).length <= 1 && !outroHasWhite) {
    return;
  }

  const admin = createAdminClient();
  const { data: currentOrganization, error: currentError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();

  if (currentError) {
    throw currentError;
  }

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      settings: {
        ...jsonObject(currentOrganization.settings),
        ...settings,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId);

  if (updateError) {
    throw updateError;
  }
}
