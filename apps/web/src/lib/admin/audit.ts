import "server-only";

import { createAdminClient, type Json } from "@/lib/supabase/admin";
import type { PlatformAdminContext } from "@/lib/admin/auth";

export async function writeAdminAuditLog({
  action,
  actor,
  metadata,
  resourceId,
  resourceType,
}: {
  action: string;
  actor: PlatformAdminContext;
  metadata?: Json;
  resourceId?: string | null;
  resourceType: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_logs").insert({
    action,
    actor_user_id: actor.userId,
    metadata: metadata ?? {},
    resource_id: resourceId ?? null,
    resource_type: resourceType,
  });

  if (error) {
    throw error;
  }
}
