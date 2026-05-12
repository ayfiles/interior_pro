import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requireSupabasePublicConfig } from "@/lib/env";

export type Json =
  | boolean
  | null
  | number
  | string
  | { [key: string]: Json | undefined }
  | Json[];

interface Database {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      credit_reservations: {
        Insert: {
          amount?: number;
          organization_id: string;
          project_id?: string | null;
          status?: string;
        };
        Row: {
          amount: number;
          expires_at: string;
          id: string;
          project_id: string | null;
          status: string;
        };
        Update: {
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pipeline_logs: {
        Insert: {
          message?: string | null;
          metadata?: Json | null;
          project_id: string;
          status: string;
          step: string;
        };
        Row: {
          id: string;
        };
        Update: never;
        Relationships: [];
      };
      project_images: {
        Insert: never;
        Row: {
          id: string;
          order_index: number;
          original_storage_key: string;
          prompt_type: string | null;
          project_id: string;
          upscaled_storage_key: string | null;
          video_storage_key: string | null;
          video_status: string;
        };
        Update: {
          analysis?: Json | null;
          upscaled_storage_key?: string | null;
          video_storage_key?: string | null;
          video_status?: string;
        };
        Relationships: [];
      };
      projects: {
        Insert: never;
        Row: {
          credit_reservation_id: string | null;
          customer_name: string;
          id: string;
          organization_id: string;
          special_notes: string | null;
          status: string;
          voice_selection: string;
        };
        Update: {
          error_message?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
  };
}

let adminClient: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  const { url } = requireSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for pipeline worker.");
  }

  adminClient ??= createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}
