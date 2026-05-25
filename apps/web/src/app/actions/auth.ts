"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveOrganizationLogosDuringOnboarding } from "@/app/actions/account";
import { getSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function encoded(message: string) {
  return encodeURIComponent(message);
}

function requireText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

export async function signIn(formData: FormData) {
  if (!getSupabasePublicConfig().isConfigured) {
    redirect("/login?message=Supabase%20is%20not%20configured%20yet");
  }

  const email = requireText(formData, "email");
  const password = requireText(formData, "password");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?message=${encoded(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  if (!getSupabasePublicConfig().isConfigured) {
    redirect("/register?message=Supabase%20is%20not%20configured%20yet");
  }

  const fullName = requireText(formData, "fullName");
  const organizationName = requireText(formData, "organizationName");
  const email = requireText(formData, "email");
  const password = requireText(formData, "password");
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        organization_name: organizationName,
      },
    },
  });

  if (error) {
    redirect(`/register?message=${encoded(error.message)}`);
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/onboarding");
  }

  redirect(
    "/login?message=Check%20your%20email%20to%20confirm%20the%20account",
  );
}

export async function createOrganization(formData: FormData) {
  if (!getSupabasePublicConfig().isConfigured) {
    redirect("/onboarding?message=Supabase%20is%20not%20configured%20yet");
  }

  const organizationName = requireText(formData, "organizationName");
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?message=Please%20sign%20in%20first");
  }

  const { data: existingMemberships, error: membershipLookupError } =
    await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1);

  if (membershipLookupError) {
    redirect(`/onboarding?message=${encoded(membershipLookupError.message)}`);
  }

  if (existingMemberships?.length) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  const { data: existingOrganizations, error: organizationLookupError } =
    await supabase
      .from("organizations")
      .select("id")
      .eq("created_by", user.id)
      .order("created_at", { ascending: true })
      .limit(1);

  if (organizationLookupError) {
    redirect(`/onboarding?message=${encoded(organizationLookupError.message)}`);
  }

  const existingOrganization = existingOrganizations?.[0];
  const { data: organization, error: organizationError } =
    existingOrganization
      ? { data: existingOrganization, error: null }
      : await supabase
          .from("organizations")
          .insert({
            created_by: user.id,
            name: organizationName,
          })
          .select("id")
          .single();

  if (organizationError) {
    redirect(`/onboarding?message=${encoded(organizationError.message)}`);
  }

  const { error: membershipError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: organization.id,
      role: "owner",
      status: "active",
      user_id: user.id,
    });

  if (membershipError) {
    redirect(`/onboarding?message=${encoded(membershipError.message)}`);
  }

  await saveOrganizationLogosDuringOnboarding({
    formData,
    organizationId: organization.id,
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  if (getSupabasePublicConfig().isConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
