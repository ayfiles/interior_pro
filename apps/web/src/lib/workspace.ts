import { redirect } from "next/navigation";
import { getSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface WorkspaceOrganization {
  id: string;
  name: string;
  subscription_plan: "trial" | "professional" | "enterprise";
}

export interface WorkspaceMembership {
  organization_id: string;
  role: "owner" | "admin" | "member";
}

export async function getRequiredWorkspace() {
  if (!getSupabasePublicConfig().isConfigured) {
    redirect("/login?message=Supabase%20is%20not%20configured%20yet");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  if (membershipError) {
    redirect(`/onboarding?message=${encodeURIComponent(membershipError.message)}`);
  }

  if (!memberships?.length) {
    redirect("/onboarding");
  }

  const membership = memberships[0] as WorkspaceMembership;
  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name, subscription_plan")
    .eq("id", membership.organization_id)
    .single();

  if (organizationError || !organization) {
    redirect(
      `/onboarding?message=${encodeURIComponent(
        organizationError?.message ?? "Organization could not be loaded.",
      )}`,
    );
  }

  return {
    membership,
    organization: organization as WorkspaceOrganization,
    supabase,
    user,
  };
}
