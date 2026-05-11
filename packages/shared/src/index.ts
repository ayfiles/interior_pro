export const VIDEO_REQUIREMENTS = {
  minImages: 5,
  maxImages: 8,
  targetResolution: "1920x1080",
  minDurationSeconds: 30,
  maxDurationSeconds: 45,
} as const;

export const AI_PROVIDERS = {
  imageEnhancement: {
    primary: "nano-banana-pro",
    model: "gemini-3-pro-image-preview",
    fallback: ["magnific", "replicate-real-esrgan"],
  },
  imageToVideo: {
    primary: "kling-3.0",
    fallback: "runway-gen-4.5",
  },
} as const;

export type ProjectStatus =
  | "draft"
  | "submitted"
  | "queued"
  | "validating"
  | "upscaling"
  | "generating_video"
  | "media_qc"
  | "editing"
  | "rendering"
  | "quality_check"
  | "completed"
  | "failed"
  | "canceled";

export type OrganizationRole = "owner" | "admin" | "member";

export type CreditReservationStatus =
  | "reserved"
  | "consumed"
  | "released"
  | "expired";

export type CreditLedgerEntryType =
  | "monthly_grant"
  | "purchase"
  | "consume"
  | "refund"
  | "adjustment";

export interface CreditLedgerEntry {
  id: string;
  organizationId: string;
  projectId?: string;
  entryType: CreditLedgerEntryType;
  amount: number;
  createdAt: string;
}

export interface CreditReservation {
  id: string;
  organizationId: string;
  projectId?: string;
  amount: number;
  status: CreditReservationStatus;
  expiresAt: string;
}
