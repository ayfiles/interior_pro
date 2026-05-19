import { calculateAvailableCredits } from "@interior-pro/billing";
import type { CreditReservationStatus } from "@interior-pro/shared";
import {
  DashboardShell,
  type DashboardCreditSummary,
  type DashboardProject,
} from "@/components/dashboard-shell";
import { getSupabasePublicConfig } from "@/lib/env";
import { getRequiredWorkspace } from "@/lib/workspace";

const DEFAULT_PILOT_CREDITS = 5;

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

interface CreditLedgerRow {
  amount: number;
}

function toCreditReservationStatus(status: string): CreditReservationStatus {
  return ["reserved", "consumed", "released", "expired"].includes(status)
    ? (status as CreditReservationStatus)
    : "expired";
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

  const { data: ledgerEntries } = await supabase
    .from("video_credit_ledger")
    .select("amount")
    .eq("organization_id", organization.id);

  const imageCounts = ((imageRows ?? []) as ProjectImageCountRow[]).reduce<
    Record<string, number>
  >((counts, image) => {
    counts[image.project_id] = (counts[image.project_id] ?? 0) + 1;
    return counts;
  }, {});

  const ledger = (ledgerEntries ?? []) as CreditLedgerRow[];
  const effectiveLedger = ledger.length
    ? ledger
    : [{ amount: DEFAULT_PILOT_CREDITS }];
  const reservationRows = (reservations ?? []) as CreditReservationRow[];
  const included = effectiveLedger.reduce((sum, entry) => sum + entry.amount, 0);
  const reserved = reservationRows.reduce((sum, reservation) => {
    const expiresAt = new Date(reservation.expires_at);

    if (reservation.status !== "reserved" || expiresAt <= new Date()) {
      return sum;
    }

    return sum + reservation.amount;
  }, 0);

  const creditSummary: DashboardCreditSummary = {
    available: calculateAvailableCredits(
      effectiveLedger,
      reservationRows.map((reservation) => ({
        amount: reservation.amount,
        expiresAt: reservation.expires_at,
        status: toCreditReservationStatus(reservation.status),
      })),
    ),
    included,
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
