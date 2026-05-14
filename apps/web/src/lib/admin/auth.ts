import "server-only";

import { redirect } from "next/navigation";
import { getSupabasePublicConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PlatformAdminRole = "owner" | "operator" | "viewer";

export interface PlatformAdminContext {
  email: string | null;
  role: PlatformAdminRole;
  userId: string;
}

function configuredAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPlatformAdminRole(role: string): role is PlatformAdminRole {
  return ["owner", "operator", "viewer"].includes(role);
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  if (!getSupabasePublicConfig().isConfigured) {
    redirect("/login?message=Supabase%20is%20not%20configured%20yet");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login?message=Please%20sign%20in%20as%20an%20admin");
  }

  const admin = createAdminClient();
  const { data: adminRow, error: adminError } = await admin
    .from("platform_admins")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError) {
    throw adminError;
  }

  if (
    adminRow?.status === "active" &&
    isPlatformAdminRole(adminRow.role)
  ) {
    return {
      email: user.email ?? null,
      role: adminRow.role,
      userId: user.id,
    };
  }

  const email = user.email?.toLowerCase() ?? "";

  if (email && configuredAdminEmails().has(email)) {
    const { error: upsertError } = await admin.from("platform_admins").upsert({
      role: "owner",
      status: "active",
      updated_at: new Date().toISOString(),
      user_id: user.id,
    });

    if (upsertError) {
      throw upsertError;
    }

    await admin.from("admin_audit_logs").insert({
      action: "platform_admin.bootstrap",
      actor_user_id: user.id,
      metadata: {
        email,
        source: "ADMIN_EMAILS",
      },
      resource_id: user.id,
      resource_type: "platform_admin",
    });

    return {
      email: user.email ?? null,
      role: "owner",
      userId: user.id,
    };
  }

  redirect("/dashboard");
}
