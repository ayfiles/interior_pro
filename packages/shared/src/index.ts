export const VIDEO_REQUIREMENTS = {
  minImages: 2,
  maxImages: 8,
  targetResolution: "1920x1080",
  minDurationSeconds: 18,
  maxDurationSeconds: 45,
} as const;

export const VIDEO_LENGTH_PROFILES = {
  long: {
    maxImages: 8,
    minImages: 4,
    targetDurationSeconds: 36,
  },
  short: {
    maxImages: 3,
    minImages: 2,
    targetDurationSeconds: 20,
  },
} as const;

export type VideoLengthProfile = keyof typeof VIDEO_LENGTH_PROFILES;

export function getVideoLengthProfileForImageCount(imageCount: number) {
  if (
    imageCount >= VIDEO_LENGTH_PROFILES.short.minImages &&
    imageCount <= VIDEO_LENGTH_PROFILES.short.maxImages
  ) {
    return "short" satisfies VideoLengthProfile;
  }

  if (
    imageCount >= VIDEO_LENGTH_PROFILES.long.minImages &&
    imageCount <= VIDEO_LENGTH_PROFILES.long.maxImages
  ) {
    return "long" satisfies VideoLengthProfile;
  }

  throw new Error(
    `Unsupported image count ${imageCount}. Expected ${VIDEO_REQUIREMENTS.minImages}-${VIDEO_REQUIREMENTS.maxImages} images.`,
  );
}

export function getVideoImageRequirements(env = process.env) {
  const requestedMinImages = Number(env.NEXT_PUBLIC_TEST_MIN_IMAGES);
  const minImages =
    Number.isInteger(requestedMinImages) &&
    requestedMinImages >= 1 &&
    requestedMinImages <= VIDEO_REQUIREMENTS.maxImages
      ? requestedMinImages
      : VIDEO_REQUIREMENTS.minImages;

  return {
    ...VIDEO_REQUIREMENTS,
    isTestOverride: minImages !== VIDEO_REQUIREMENTS.minImages,
    minImages,
  };
}

export type VideoImageRequirements = ReturnType<
  typeof getVideoImageRequirements
>;

export const AI_PROVIDERS = {
  imageEnhancement: {
    primary: "kie-nano-banana-pro",
    model: "nano-banana-pro",
    fallback: ["kie-gpt-image-2", "magnific", "replicate-real-esrgan"],
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
