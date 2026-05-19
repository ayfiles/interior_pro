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
      admin_audit_logs: {
        Insert: {
          action: string;
          actor_user_id?: string | null;
          metadata?: Json;
          resource_id?: string | null;
          resource_type: string;
        };
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          resource_id: string | null;
          resource_type: string;
        };
        Update: never;
        Relationships: [];
      };
      admin_prompt_documents: {
        Insert: {
          description?: string | null;
          file_path: string;
          is_active?: boolean;
          slug: string;
          title: string;
        };
        Row: {
          created_at: string;
          description: string | null;
          file_path: string;
          id: string;
          is_active: boolean;
          slug: string;
          title: string;
          updated_at: string;
        };
        Update: {
          description?: string | null;
          file_path?: string;
          is_active?: boolean;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_prompt_versions: {
        Insert: {
          body: string;
          change_note?: string | null;
          created_by?: string | null;
          document_id: string;
          published_at?: string | null;
          status?: string;
          version_number: number;
        };
        Row: {
          body: string;
          change_note: string | null;
          created_at: string;
          created_by: string | null;
          document_id: string;
          id: string;
          published_at: string | null;
          status: string;
          version_number: number;
        };
        Update: {
          published_at?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Insert: {
          created_by?: string | null;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Row: {
          created_at: string;
          created_by: string | null;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Update: {
          role?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Insert: {
          avatar_url?: string | null;
          email: string;
          full_name: string;
          id: string;
          preferred_language?: string;
          settings?: Json;
        };
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          preferred_language: string;
          settings: Json;
          updated_at: string;
        };
        Update: {
          avatar_url?: string | null;
          email?: string;
          full_name?: string;
          preferred_language?: string;
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Insert: {
          created_by?: string | null;
          name: string;
          settings?: Json;
          stripe_customer_id?: string | null;
          subscription_plan?: string;
        };
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          settings: Json;
          stripe_customer_id: string | null;
          subscription_plan: string;
          updated_at: string;
        };
        Update: {
          name?: string;
          settings?: Json;
          stripe_customer_id?: string | null;
          subscription_plan?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Insert: {
          organization_id: string;
          role: string;
          status?: string;
          user_id: string;
        };
        Row: {
          created_at: string;
          organization_id: string;
          role: string;
          status: string;
          user_id: string;
        };
        Update: {
          role?: string;
          status?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Insert: {
          current_period_end: string;
          current_period_start: string;
          organization_id: string;
          plan?: string;
          status?: string;
          stripe_subscription_id: string;
          videos_per_month?: number;
        };
        Row: {
          created_at: string;
          current_period_end: string;
          current_period_start: string;
          id: string;
          organization_id: string;
          plan: string;
          status: string;
          stripe_subscription_id: string;
          updated_at: string;
          videos_per_month: number;
        };
        Update: {
          current_period_end?: string;
          current_period_start?: string;
          plan?: string;
          status?: string;
          updated_at?: string;
          videos_per_month?: number;
        };
        Relationships: [];
      };
      video_credit_ledger: {
        Insert: {
          amount: number;
          entry_type: string;
          metadata?: Json;
          organization_id: string;
          project_id?: string | null;
          stripe_event_id?: string | null;
        };
        Row: {
          amount: number;
          created_at: string;
          entry_type: string;
          id: string;
          metadata: Json;
          organization_id: string;
          project_id: string | null;
          stripe_event_id: string | null;
        };
        Update: never;
        Relationships: [];
      };
      credit_reservations: {
        Insert: {
          amount?: number;
          organization_id: string;
          project_id?: string | null;
          status?: string;
        };
        Row: {
          amount: number;
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          project_id: string | null;
          status: string;
          updated_at: string;
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
          created_at: string;
          duration_ms: number | null;
          id: string;
          message: string | null;
          metadata: Json | null;
          project_id: string;
          status: string;
          step: string;
        };
        Update: never;
        Relationships: [];
      };
      music_tracks: {
        Insert: {
          duration_seconds: number;
          file_storage_key: string;
          genre?: string | null;
          instructions_md?: string | null;
          is_active?: boolean;
          name: string;
          plan_json?: Json | null;
        };
        Row: {
          created_at: string;
          duration_seconds: number;
          file_storage_key: string;
          genre: string | null;
          id: string;
          instructions_md: string | null;
          is_active: boolean;
          name: string;
          plan_json: Json | null;
        };
        Update: {
          duration_seconds?: number;
          file_storage_key?: string;
          genre?: string | null;
          instructions_md?: string | null;
          is_active?: boolean;
          name?: string;
          plan_json?: Json | null;
        };
        Relationships: [];
      };
      provider_jobs: {
        Insert: {
          credits_consumed?: number | null;
          error_message?: string | null;
          estimated_cost_usd?: number | null;
          external_task_id?: string | null;
          file_size_bytes?: number | null;
          idempotency_key: string;
          model: string;
          output_storage_key?: string | null;
          project_id: string;
          project_image_id?: string | null;
          provider: string;
          request?: Json;
          response?: Json;
          started_at?: string;
          status?: string;
          step: string;
          submitted_at?: string | null;
        };
        Row: {
          completed_at: string | null;
          created_at: string;
          credits_consumed: number | null;
          error_message: string | null;
          estimated_cost_usd: number | null;
          external_task_id: string | null;
          failed_at: string | null;
          file_size_bytes: number | null;
          id: string;
          idempotency_key: string;
          model: string;
          output_storage_key: string | null;
          project_id: string;
          project_image_id: string | null;
          provider: string;
          request: Json;
          response: Json;
          started_at: string;
          status: string;
          step: string;
          submitted_at: string | null;
          updated_at: string;
        };
        Update: {
          completed_at?: string | null;
          credits_consumed?: number | null;
          error_message?: string | null;
          estimated_cost_usd?: number | null;
          external_task_id?: string | null;
          failed_at?: string | null;
          file_size_bytes?: number | null;
          output_storage_key?: string | null;
          request?: Json;
          response?: Json;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_images: {
        Insert: never;
        Row: {
          analysis: Json | null;
          created_at: string;
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
          prompt_type?: string | null;
          upscaled_storage_key?: string | null;
          video_storage_key?: string | null;
          video_status?: string;
        };
        Relationships: [];
      };
      project_outputs: {
        Insert: {
          duration_seconds?: number | null;
          file_size_bytes?: number | null;
          project_id: string;
          qc_report?: Json;
          resolution?: string;
          thumbnail_storage_key?: string | null;
          video_storage_key: string;
          voiceover_script?: string | null;
        };
        Row: {
          created_at: string;
          duration_seconds: number | null;
          file_size_bytes: number | null;
          id: string;
          project_id: string;
          qc_report: Json;
          resolution: string;
          thumbnail_storage_key: string | null;
          video_storage_key: string;
          voiceover_script: string | null;
        };
        Update: never;
        Relationships: [];
      };
      testing_runs: {
        Insert: {
          actual_cost_usd?: number;
          completed_at?: string | null;
          config?: Json;
          error_message?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          input_summary?: Json;
          name: string;
          organization_id?: string | null;
          provider_credits?: number;
          queued_at?: string | null;
          related_project_id?: string | null;
          requested_by?: string | null;
          run_mode?: string;
          started_at?: string | null;
          status?: string;
          target_step: string;
        };
        Row: {
          actual_cost_usd: number;
          completed_at: string | null;
          config: Json;
          created_at: string;
          error_message: string | null;
          estimated_cost_usd: number;
          id: string;
          input_summary: Json;
          name: string;
          organization_id: string | null;
          provider_credits: number;
          queued_at: string | null;
          related_project_id: string | null;
          requested_by: string | null;
          run_mode: string;
          started_at: string | null;
          status: string;
          target_step: string;
          updated_at: string;
        };
        Update: {
          actual_cost_usd?: number;
          completed_at?: string | null;
          config?: Json;
          error_message?: string | null;
          estimated_cost_usd?: number;
          input_summary?: Json;
          organization_id?: string | null;
          provider_credits?: number;
          queued_at?: string | null;
          related_project_id?: string | null;
          requested_by?: string | null;
          run_mode?: string;
          started_at?: string | null;
          status?: string;
          target_step?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      testing_run_assets: {
        Insert: {
          bucket: string;
          content_type?: string | null;
          file_name?: string | null;
          file_size_bytes?: number | null;
          kind: string;
          metadata?: Json;
          run_id: string;
          storage_key: string;
        };
        Row: {
          bucket: string;
          content_type: string | null;
          created_at: string;
          file_name: string | null;
          file_size_bytes: number | null;
          id: string;
          kind: string;
          metadata: Json;
          run_id: string;
          storage_key: string;
        };
        Update: never;
        Relationships: [];
      };
      testing_run_logs: {
        Insert: {
          message?: string | null;
          metadata?: Json;
          run_id: string;
          status: string;
          step: string;
        };
        Row: {
          created_at: string;
          id: string;
          message: string | null;
          metadata: Json;
          run_id: string;
          status: string;
          step: string;
        };
        Update: never;
        Relationships: [];
      };
      testing_run_outputs: {
        Insert: {
          bucket?: string | null;
          content_type?: string | null;
          file_size_bytes?: number | null;
          kind: string;
          label: string;
          metadata?: Json;
          run_id: string;
          storage_key?: string | null;
        };
        Row: {
          bucket: string | null;
          content_type: string | null;
          created_at: string;
          file_size_bytes: number | null;
          id: string;
          kind: string;
          label: string;
          metadata: Json;
          run_id: string;
          storage_key: string | null;
        };
        Update: never;
        Relationships: [];
      };
      projects: {
        Insert: never;
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by: string;
          customer_logo_storage_key: string | null;
          credit_reservation_id: string | null;
          customer_name: string;
          error_message: string | null;
          id: string;
          inngest_run_id: string | null;
          music_genre: string;
          music_id: string | null;
          organization_id: string;
          special_notes: string | null;
          status: string;
          updated_at: string;
          voice_selection: string;
        };
        Update: {
          completed_at?: string | null;
          error_message?: string | null;
          music_id?: string | null;
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
