import {
  DashboardShell,
  type DashboardCreditSummary,
  type DashboardProject,
} from "@/components/dashboard-shell";
import { getSupabasePublicConfig } from "@/lib/env";
import { getRequiredWorkspace } from "@/lib/workspace";

const PILOT_CREDITS = 5;

interface ProjectRow {
  created_at: string;
  customer_name: string;
  id: string;
  special_notes: string | null;
  status: string;
}

interface ProjectImageCountRow {
  project_id: string;
}

interface CreditReservationRow {
  amount: number;
  expires_at: string;
  project_id: string | null;
  status: string;
}

function isActiveReservation(reservation: CreditReservationRow) {
  return (
    reservation.status === "reserved" &&
    new Date(reservation.expires_at).getTime() > Date.now()
  );
}

export default async function DashboardPage() {
  if (!getSupabasePublicConfig().isConfigured) {
    return <DashboardShell setupMode />;
  }

  const { organization, supabase, user } = await getRequiredWorkspace();

  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, customer_name, status, special_notes, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const projectIds = ((projectRows ?? []) as ProjectRow[]).map(
    (project) => project.id,
  );

  const { data: imageRows } = projectIds.length
    ? await supabase
        .from("project_images")
        .select("project_id")
        .in("project_id", projectIds)
    : { data: [] };

  const { data: reservations } = await supabase
    .from("credit_reservations")
    .select("project_id, amount, status, expires_at")
    .eq("organization_id", organization.id);

  const imageCounts = ((imageRows ?? []) as ProjectImageCountRow[]).reduce<
    Record<string, number>
  >((counts, image) => {
    counts[image.project_id] = (counts[image.project_id] ?? 0) + 1;
    return counts;
  }, {});

  const reserved = ((reservations ?? []) as CreditReservationRow[])
    .filter(isActiveReservation)
    .reduce((sum, reservation) => sum + reservation.amount, 0);

  const creditSummary: DashboardCreditSummary = {
    available: Math.max(PILOT_CREDITS - reserved, 0),
    included: PILOT_CREDITS,
    reserved,
  };

  const projects: DashboardProject[] = ((projectRows ?? []) as ProjectRow[]).map(
    (project) => ({
      createdAt: project.created_at,
      customerName: project.customer_name,
      id: project.id,
      imageCount: imageCounts[project.id] ?? 0,
      specialNotes: project.special_notes,
      status: project.status,
    }),
  );

  return (
    <DashboardShell
      creditSummary={creditSummary}
      organizationName={organization.name}
      projects={projects}
      userEmail={user.email}
    />
  );
}
