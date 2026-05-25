import {
  AI_PROVIDERS,
  getVideoImageRequirements,
  getVideoLengthProfileForImageCount,
  type VideoLengthProfile,
} from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  type ArchitecturalKlingMultiPromptVariant,
  buildArchitecturalKlingMultiPrompt,
  classifyImagesForKlingModes,
  createKieKling30Task,
  enhanceImageWithKieNanoBananaPro,
  generateVoiceoverAudio,
  getKieTaskRecord,
  PIPELINE_MAX_COST_PER_IMAGE,
  PIPELINE_MAX_COST_PER_JOB,
  PIPELINE_MAX_IMAGE_RETRIES,
  PIPELINE_MULTISHOT_STABILIZATION_ENABLED,
  PIPELINE_VALIDATOR_CASCADE_ENABLED,
  resizeForValidation,
  reviewVideoVisualQuality,
  runMediaQcOnVideoBytes,
  stabilizeVideoBytes,
  type KlingModeClassificationResult,
  type MediaQcReport,
  validateOutput,
  type ValidatorResult,
} from "@interior-pro/pipeline";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  buildClipSegmentsFromSources,
  buildEditorStoryPlan,
  buildFinalEditPlan,
  buildMusicInstructionPlan,
  buildSalesPitchRenderManifest,
  buildVoiceoverPlan,
  renderSalesPitchVideo,
} from "@interior-pro/video";
import { inngest, PROJECT_SUBMITTED_EVENT } from "@/inngest/client";
import {
  buildProviderJobKey,
  ensureProviderJob,
  estimateKieCostUsd,
  getErrorMessage,
  getProviderJobByKey,
  updateProviderJob,
  type ProviderJob,
} from "@/inngest/provider-jobs";
import { loadPipelinePrompt } from "@/lib/admin/prompts";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

type PipelineLogStatus = "started" | "completed" | "failed" | "skipped" | "info";
type EnhancedImageResult = {
  dropReason?: string | null;
  dropped?: boolean;
  imageId: string;
  orderIndex: number;
  outputMimeType?: string;
  outputStorageKey?: string | null;
  skipped?: boolean;
  totalCost?: number;
};
type AttemptLog = {
  attempt: number;
  cost: number;
  decision: ValidatorResult["overall_decision"];
  failures: string[];
  providerJobId?: string;
  seed: number;
};
type GeneratedClipResult = {
  callbackPending?: boolean;
  clipId: string;
  clipStorageKey: string;
  creditsConsumed?: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
  generationMode: KlingGenerationMode;
  imageId: string;
  multiShotSceneCount?: number | null;
  multiShotVariant?: ArchitecturalKlingMultiPromptVariant | null;
  orderIndex: number;
  skipped: boolean;
  tagSegmentsAsMultiShot?: boolean | null;
  taskId?: string;
};
type MediaQcClipResult = {
  clipId: string;
  clipStorageKey: string;
  imageId: string;
  multiShotSceneCount: number | null;
  multiShotVariant: ArchitecturalKlingMultiPromptVariant | null;
  ok: boolean;
  orderIndex: number;
  promptType: string | null;
  report: MediaQcReport;
  skipped: boolean;
  tagSegmentsAsMultiShot: boolean;
};
type KlingGenerationMode = "single_shot" | "multi_shot";
type ProjectImageSource = {
  analysis: Json | null;
  id: string;
  order_index: number;
  original_storage_key: string;
  prompt_type: string | null;
  upscaled_storage_key: string | null;
  video_status: string;
  video_storage_key: string | null;
};
type KlingModeDecision = KlingModeClassificationResult["decisions"][number];
type KlingClipPlanItem = {
  clipId: string;
  duplicateIndex: number;
  generationMode: KlingGenerationMode;
  image: ProjectImageSource;
  multiShotVariant: ArchitecturalKlingMultiPromptVariant | null;
  planIndex: number;
};
type MediaQcClipInput = {
  analysis: Json | null;
  clipId: string;
  clipStorageKey: string;
  durationSeconds: number | null;
  imageId: string;
  multiShotSceneCount: number | null;
  multiShotVariant: ArchitecturalKlingMultiPromptVariant | null;
  orderIndex: number;
  promptType: KlingGenerationMode;
  sourceImageStorageKey: string | null;
  tagSegmentsAsMultiShot: boolean;
  videoStatus: string;
};

const IMAGE_REQUIREMENTS = getVideoImageRequirements();
const UPSCALING_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/upscaling.md",
);
const VIDEO_AGENT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/agent.md",
);
const SINGLE_SHOT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/single-shot.md",
);
const MULTI_SHOT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/multi-shot.md",
);
const MULTI_SHOT_THREE_SCENE_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/multi-shot-three-scene.md",
);
const REMOTION_ENTRY_POINT = path.resolve(
  process.cwd(),
  "../../packages/video/src/remotion-entry.tsx",
);
const KLING_SINGLE_SHOT_TEST_CONFIG = {
  aspectRatio: "16:9" as const,
  durationSeconds: 5,
  mode: "pro" as const,
  multiShots: false,
  sound: false,
};
const LEGACY_KLING_DURATION_SECONDS = 4;
const KLING_DURATION_SECONDS_BY_MODE: Record<KlingGenerationMode, number> = {
  multi_shot: 10,
  single_shot: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
};
const KLING_GENERATION_MODES: Record<
  KlingGenerationMode,
  {
    durationSeconds: number;
    multiShots: boolean;
    promptPath: string;
    promptSlug: "multi-shot" | "single-shot";
  }
> = {
  multi_shot: {
    durationSeconds: KLING_DURATION_SECONDS_BY_MODE.multi_shot,
    multiShots: true,
    promptPath: MULTI_SHOT_PROMPT_PATH,
    promptSlug: "multi-shot",
  },
  single_shot: {
    durationSeconds: KLING_DURATION_SECONDS_BY_MODE.single_shot,
    multiShots: false,
    promptPath: SINGLE_SHOT_PROMPT_PATH,
    promptSlug: "single-shot",
  },
};
const KLING_POLL_INTERVAL_SECONDS = 10;
const KLING_MAX_POLLS = 90;
const MEDIA_QC_PASSED_VIDEO_STATUS = "qc_passed";
const MEDIA_QC_FAILED_VIDEO_STATUS = "qc_failed";

function inferImageMimeType(storageKey: string) {
  const lowerKey = storageKey.toLowerCase();

  if (lowerKey.endsWith(".jpg") || lowerKey.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerKey.endsWith(".webp")) {
    return "image/webp";
  }

  if (lowerKey.endsWith(".heic")) {
    return "image/heic";
  }

  return "image/png";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function buildEnhancedStorageKey(sourceStorageKey: string, mimeType: string) {
  const extension = extensionForMimeType(mimeType);
  const enhancedKey = sourceStorageKey.replace("/source/", "/enhanced/");

  if (/\.[a-z0-9]+$/i.test(enhancedKey)) {
    return enhancedKey.replace(/\.[a-z0-9]+$/i, `.${extension}`);
  }

  return `${enhancedKey}.${extension}`;
}

function buildUpscalingPrompt({
  markdown,
  notes,
  preservationPrompt,
}: {
  markdown: string;
  notes: string | null;
  preservationPrompt?: string | null;
}) {
  return [
    markdown,
    preservationPrompt,
    notes?.trim() ? `Client notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function deterministicSeed(jobId: string, imageId: string, attempt: number): number {
  const hex = createHash("sha256")
    .update(`${jobId}-${imageId}-${attempt}`)
    .digest("hex")
    .slice(0, 8);

  return parseInt(hex, 16) % 2147483647;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function buildClipStorageKey(enhancedStorageKey: string, clipId: string) {
  const safeClipId = clipId.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const clipKey = enhancedStorageKey.replace("/enhanced/", "/clips/");

  if (/\.[a-z0-9]+$/i.test(clipKey)) {
    return clipKey.replace(
      /\.[a-z0-9]+$/i,
      `.${safeClipId}.kling-3.0-pro.mp4`,
    );
  }

  return `${clipKey}.${safeClipId}.kling-3.0-pro.mp4`;
}

function isExistingRealClip({
  videoStatus,
  videoStorageKey,
}: {
  videoStatus: string;
  videoStorageKey: string | null;
}) {
  return (
    ["clip_generated", MEDIA_QC_PASSED_VIDEO_STATUS].includes(videoStatus) &&
    Boolean(videoStorageKey) &&
    !videoStorageKey?.endsWith(".json")
  );
}

function isJsonObject(value: unknown): value is Record<string, Json> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKlingGenerationMode(value: unknown): value is KlingGenerationMode {
  return value === "single_shot" || value === "multi_shot";
}

function isMultiShotVariant(
  value: unknown,
): value is ArchitecturalKlingMultiPromptVariant {
  return value === "five_scene" || value === "three_scene";
}

function mergeMediaQcAnalysis(analysis: Json | null, report: MediaQcReport) {
  const baseAnalysis = isJsonObject(analysis) ? analysis : {};

  return {
    ...baseAnalysis,
    mediaQc: report as unknown as Json,
  } satisfies Json;
}

function mergeVideoAgentDecisionAnalysis({
  analysis,
  decision,
  promptPath,
  result,
}: {
  analysis: Json | null;
  decision: KlingModeClassificationResult["decisions"][number];
  promptPath: string;
  result: KlingModeClassificationResult;
}): Json {
  const baseAnalysis = isJsonObject(analysis) ? analysis : {};

  return {
    ...baseAnalysis,
    videoAgent: {
      decision: decision as unknown as Json,
      generatedAt: new Date().toISOString(),
      model: result.model,
      promptPath,
      provider: result.provider,
      summary: result.summary,
    },
  } as Json;
}

function getExistingVideoAgentDecision({
  analysis,
  orderIndex,
  promptType,
  imageId,
}: {
  analysis: Json | null;
  imageId: string;
  orderIndex: number;
  promptType: string | null;
}): KlingModeDecision | null {
  if (!isKlingGenerationMode(promptType) || !isJsonObject(analysis)) {
    return null;
  }

  const videoAgent = isJsonObject(analysis.videoAgent)
    ? analysis.videoAgent
    : null;
  const decision = isJsonObject(videoAgent?.decision)
    ? videoAgent.decision
    : null;

  return {
    imageId,
    orderIndex,
    perspectiveScore:
      typeof decision?.perspectiveScore === "number"
        ? decision.perspectiveScore
        : 5,
    promptFile:
      typeof decision?.promptFile === "string"
        ? decision.promptFile
        : promptType === "multi_shot"
          ? "multi-shot.md"
          : "single-shot.md",
    reason:
      typeof decision?.reason === "string"
        ? decision.reason
        : "Existing Video Agent assignment reused.",
    selectedMode: promptType,
  };
}

function normalizeVideoAgentResult({
  imageCount,
  result,
}: {
  imageCount: number;
  result: KlingModeClassificationResult;
}): KlingModeClassificationResult {
  const sortedDecisions = [...result.decisions].sort(
    (a, b) =>
      b.perspectiveScore - a.perspectiveScore || a.orderIndex - b.orderIndex,
  );
  const multiShotIds = new Set(
    sortedDecisions.slice(0, Math.min(2, imageCount)).map((decision) => decision.imageId),
  );
  const decisions = result.decisions.map((decision) => {
    const selectedMode: KlingGenerationMode = multiShotIds.has(decision.imageId)
      ? "multi_shot"
      : "single_shot";

    return {
      ...decision,
      promptFile:
        selectedMode === "multi_shot" ? "multi-shot.md" : "single-shot.md",
      selectedMode,
    };
  });

  return {
    ...result,
    decisions,
    multiShotImageIds: decisions
      .filter((decision) => decision.selectedMode === "multi_shot")
      .map((decision) => decision.imageId),
    singleShotImageIds: decisions
      .filter((decision) => decision.selectedMode === "single_shot")
      .map((decision) => decision.imageId),
  };
}

function buildKlingClipPlan({
  decisions,
  images,
}: {
  decisions: KlingModeDecision[];
  images: ProjectImageSource[];
}): KlingClipPlanItem[] {
  const decisionByImageId = new Map(
    decisions.map((decision) => [decision.imageId, decision]),
  );
  const rankedImages = [...images].sort((a, b) => {
    const decisionA = decisionByImageId.get(a.id);
    const decisionB = decisionByImageId.get(b.id);

    return (
      (decisionB?.perspectiveScore ?? 0) -
        (decisionA?.perspectiveScore ?? 0) ||
      a.order_index - b.order_index
    );
  });
  const rankByImageId = new Map(
    rankedImages.map((image, index) => [image.id, index]),
  );
  const duplicateCount =
    images.length <= 3 ? images.length : Math.max(0, 8 - images.length);
  const multiShotImages = rankedImages.slice(0, Math.min(2, rankedImages.length));
  const plan: KlingClipPlanItem[] = [];

  for (const image of images) {
    const rank = rankByImageId.get(image.id) ?? images.length;
    const singleShotRepeats = 1 + (rank < duplicateCount ? 1 : 0);

    for (let duplicateIndex = 1; duplicateIndex <= singleShotRepeats; duplicateIndex += 1) {
      plan.push({
        clipId: `image-${image.order_index + 1}-single-${duplicateIndex}`,
        duplicateIndex,
        generationMode: "single_shot",
        image,
        multiShotVariant: null,
        planIndex: plan.length,
      });
    }
  }

  for (const [index, image] of multiShotImages.entries()) {
    plan.push({
      clipId: `image-${image.order_index + 1}-multi-${index + 1}`,
      duplicateIndex: 1,
      generationMode: "multi_shot",
      image,
      multiShotVariant: multiShotVariantForIndex(index),
      planIndex: plan.length,
    });
  }

  return plan;
}

function mergeImageEnhancementAnalysis({
  analysis,
  aspectRatio,
  model,
  preservationBriefPrompt,
  provider,
  providerJobId,
  sourceMimeType,
  targetResolution,
}: {
  analysis: Json | null;
  aspectRatio: "16:9";
  model: string;
  preservationBriefPrompt: string | null;
  provider: string;
  providerJobId: string;
  sourceMimeType: string;
  targetResolution: "2K" | "4K";
}): Json {
  const baseAnalysis = isJsonObject(analysis) ? analysis : {};
  const imageEnhancement = {
    aspectRatio,
    model,
    preservationBriefApplied: Boolean(preservationBriefPrompt),
    provider,
    providerJobId,
    sourceMimeType,
    targetResolution,
  };

  return {
    ...baseAnalysis,
    ...imageEnhancement,
    imageEnhancement,
  } as Json;
}

function buildFailedMediaQcReport({
  clipStorageKey,
  errorMessage,
  expectedDurationSeconds,
  fileSizeBytes,
}: {
  clipStorageKey: string;
  errorMessage: string;
  expectedDurationSeconds: number | null;
  fileSizeBytes: number;
}): MediaQcReport {
  const failedCheck = {
    message: errorMessage,
    status: "failed" as const,
  };
  const skippedCheck = {
    message: "Skipped because media inspection could not complete.",
    status: "skipped" as const,
  };

  return {
    checks: {
      bitrate: skippedCheck,
      blackFrames: skippedCheck,
      blur: skippedCheck,
      codec: failedCheck,
      duration: skippedCheck,
      fileSize: {
        message: `File size is ${fileSizeBytes} bytes.`,
        status: fileSizeBytes > 0 ? "passed" : "failed",
      },
      cutSimilarity: skippedCheck,
      freezeFrames: skippedCheck,
      resolution: skippedCheck,
      visualReview: skippedCheck,
    },
    clipStorageKey,
    expectedDurationSeconds,
    fileSizeBytes,
    generatedAt: new Date().toISOString(),
    issues: [errorMessage],
    metrics: {
      audioCodec: null,
      bitRateBitsPerSecond: null,
      blackSegments: [],
      blurFrameScores: [],
      blurMedianScore: null,
      codecName: null,
      durationSeconds: null,
      formatName: null,
      frameRate: null,
      freezeSegments: [],
      height: null,
      nearDuplicateCutSeconds: [],
      sceneChangeSeconds: [],
      width: null,
    },
    status: "failed",
    toolVersions: {
      ffmpeg: "not-run",
      ffprobe: "not-run",
    },
    warnings: [],
  };
}

function getVideoContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";")[0];

  if (contentType?.startsWith("video/")) {
    return contentType;
  }

  return "video/mp4";
}

function buildUpscalingProviderJobKey({
  attempt,
  imageId,
  projectId,
  seed,
  sourceStorageKey,
}: {
  attempt?: number;
  imageId: string;
  projectId: string;
  seed?: number;
  sourceStorageKey: string;
}) {
  return buildProviderJobKey([
    "project",
    projectId,
    "image",
    imageId,
    "upscaling",
    AI_PROVIDERS.imageEnhancement.model,
    "direct-nano-banana-v1",
    sourceStorageKey,
    "2k",
    "16:9",
    ...(attempt === undefined || seed === undefined
      ? []
      : ["validated-retry-v1", attempt, seed]),
  ]);
}

function buildKlingProviderJobKey({
  clipStorageKey,
  generationMode,
  imageId,
  multiShotVariant,
  projectId,
}: {
  clipStorageKey: string;
  generationMode: KlingGenerationMode;
  imageId: string;
  multiShotVariant: ArchitecturalKlingMultiPromptVariant | null;
  projectId: string;
}) {
  return buildProviderJobKey([
    "project",
    projectId,
    "image",
    imageId,
    "video-generation",
    "kling-3.0-pro",
    generationMode,
    ...(multiShotVariant ? [multiShotVariant] : []),
    clipStorageKey,
    KLING_GENERATION_MODES[generationMode].durationSeconds,
    KLING_SINGLE_SHOT_TEST_CONFIG.mode,
  ]);
}

function buildLegacyKlingProviderJobKey({
  clipStorageKey,
  imageId,
  projectId,
}: {
  clipStorageKey: string;
  imageId: string;
  projectId: string;
}) {
  return buildProviderJobKey([
    "project",
    projectId,
    "image",
    imageId,
    "video-generation",
    "kling-3.0-pro",
    clipStorageKey,
    LEGACY_KLING_DURATION_SECONDS,
    KLING_SINGLE_SHOT_TEST_CONFIG.mode,
  ]);
}

function multiShotVariantForIndex(
  multiShotIndex: number,
): ArchitecturalKlingMultiPromptVariant {
  return multiShotIndex === 0 ? "five_scene" : "three_scene";
}

function multiShotPromptPathForVariant(
  variant: ArchitecturalKlingMultiPromptVariant,
) {
  return variant === "three_scene"
    ? MULTI_SHOT_THREE_SCENE_PROMPT_PATH
    : MULTI_SHOT_PROMPT_PATH;
}

function multiShotPromptKeyForVariant(
  variant: ArchitecturalKlingMultiPromptVariant,
) {
  return variant === "three_scene" ? "multi_shot_three_scene" : "multi_shot";
}

function multiShotSceneCountForVariant(
  variant: ArchitecturalKlingMultiPromptVariant,
) {
  return variant === "three_scene" ? 3 : 5;
}

function shouldTagSegmentsAsMultiShot(
  variant: ArchitecturalKlingMultiPromptVariant | null,
) {
  return Boolean(variant);
}

function buildRenderingProviderJobKey(projectId: string, manifestStorageKey: string) {
  return buildProviderJobKey([
    "project",
    projectId,
    "rendering",
    "remotion",
    manifestStorageKey,
  ]);
}

function buildFinalOutputStorageKey({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  return `${organizationId}/${projectId}/final/sales-pitch.mp4`;
}

function buildProjectArtifactStorageKey({
  extension,
  name,
  organizationId,
  projectId,
}: {
  extension: string;
  name: string;
  organizationId: string;
  projectId: string;
}) {
  return `${organizationId}/${projectId}/artifacts/${name}.${extension}`;
}

function extensionForAudioContentType(contentType: string) {
  return contentType === "audio/mpeg" ? "mp3" : "wav";
}

function buildProviderResumeBlockMessage(job: ProviderJob) {
  return [
    `Provider job ${job.id} for ${job.step} is ${job.status}.`,
    "The pipeline will not start a second paid provider request automatically.",
    "Clear or reset the provider job manually before retrying this paid step.",
  ].join(" ");
}

function mapKieTaskStateToProviderStatus(state: string) {
  if (state === "fail" || state === "failed") {
    return "failed" as const;
  }

  if (state === "success") {
    return "processing" as const;
  }

  return "processing" as const;
}

function getKieCallbackUrl() {
  const baseUrl =
    process.env.KIE_CALLBACK_URL ??
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/kie/callback`
      : null);

  if (!baseUrl) {
    return null;
  }

  const callbackUrl = new URL(baseUrl);
  const callbackSecret = process.env.KIE_CALLBACK_SECRET;

  if (callbackSecret && !callbackUrl.searchParams.has("token")) {
    callbackUrl.searchParams.set("token", callbackSecret);
  }

  return callbackUrl.toString();
}

async function writePipelineLog({
  message,
  metadata,
  projectId,
  status,
  step,
}: {
  message: string;
  metadata?: Json;
  projectId: string;
  status: PipelineLogStatus;
  step: string;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("pipeline_logs").insert({
    message,
    metadata: metadata ?? null,
    project_id: projectId,
    status,
    step,
  });

  if (error) {
    throw error;
  }
}

async function safeInsertAttempt({
  cascadeRan,
  claudeResponse,
  criticalFailures,
  decision,
  generationCost,
  geminiResponse,
  imageId,
  jobId,
  seed,
  attemptNumber,
  validationCost,
}: {
  attemptNumber: number;
  cascadeRan: boolean;
  claudeResponse: ValidatorResult | null;
  criticalFailures: string[];
  decision: ValidatorResult["overall_decision"];
  generationCost: number;
  geminiResponse: ValidatorResult;
  imageId: string;
  jobId: string;
  seed: number;
  validationCost: number;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("pipeline_attempts").insert({
      attempt_number: attemptNumber,
      cascade_ran: cascadeRan,
      claude_response: claudeResponse as unknown as Json,
      critical_failures: criticalFailures,
      decision,
      gemini_response: geminiResponse as unknown as Json,
      generation_cost: generationCost,
      image_id: imageId,
      job_id: jobId,
      seed,
      validation_cost: validationCost,
    });

    if (error) {
      console.error("Failed to insert pipeline attempt", error);
    }
  } catch (error) {
    console.error("Failed to insert pipeline attempt", error);
  }
}

async function safeInsertOutcome({
  dropReason,
  finalOutputUrl,
  imageId,
  jobId,
  status,
  totalAttempts,
  totalCost,
}: {
  dropReason: string | null;
  finalOutputUrl: string | null;
  imageId: string;
  jobId: string;
  status: "success" | "dropped";
  totalAttempts: number;
  totalCost: number;
}) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("pipeline_outcomes").insert({
      drop_reason: dropReason,
      final_output_url: finalOutputUrl,
      image_id: imageId,
      job_id: jobId,
      status,
      total_attempts: totalAttempts,
      total_cost: totalCost,
    });

    if (error) {
      console.error("Failed to insert pipeline outcome", error);
    }
  } catch (error) {
    console.error("Failed to insert pipeline outcome", error);
  }
}

async function updateProjectStatus(projectId: string, status: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("projects")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  if (error) {
    throw error;
  }
}

async function uploadJsonArtifact({
  bucket,
  storageKey,
  value,
}: {
  bucket: string;
  storageKey: string;
  value: Json;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(bucket).upload(
    storageKey,
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
    {
      contentType: "application/json",
      upsert: true,
    },
  );

  if (error) {
    throw error;
  }
}

async function createSignedStorageUrl({
  bucket,
  expiresInSeconds = 60 * 60,
  storageKey,
}: {
  bucket: string;
  expiresInSeconds?: number;
  storageKey: string;
}) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error) {
    throw error;
  }

  if (!data?.signedUrl) {
    throw new Error(`Could not create signed URL for ${bucket}/${storageKey}.`);
  }

  return data.signedUrl;
}

function stringSetting(settings: Json | null | undefined, key: string) {
  if (!isJsonObject(settings)) {
    return null;
  }

  const value = settings[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanSetting(settings: Json | null | undefined, key: string) {
  if (!isJsonObject(settings)) {
    return null;
  }

  const value = settings[key];

  return typeof value === "boolean" ? value : null;
}

function resolveLogoStorageKeys({
  fallbackLogoStorageKey,
  organizationSettings,
}: {
  fallbackLogoStorageKey?: string | null;
  organizationSettings?: Json | null;
}) {
  const cornerLogoStorageKey =
    stringSetting(organizationSettings, "cornerLogoStorageKey") ??
    stringSetting(organizationSettings, "smallLogoStorageKey") ??
    fallbackLogoStorageKey ??
    null;
  const outroLogoStorageKey =
    stringSetting(organizationSettings, "outroLogoStorageKey") ??
    stringSetting(organizationSettings, "largeLogoStorageKey") ??
    fallbackLogoStorageKey ??
    null;
  const outroLogoBackgroundColor =
    stringSetting(organizationSettings, "outroLogoBackgroundColor") ?? "#ffffff";
  const outroLogoFullFrame =
    booleanSetting(organizationSettings, "outroLogoFullFrame") ?? false;

  return {
    cornerLogoStorageKey,
    outroLogoBackgroundColor,
    outroLogoFullFrame,
    outroLogoStorageKey,
  };
}

export const projectPipeline = inngest.createFunction(
  {
    id: "project-pipeline",
    name: "Project Pipeline",
    retries: 0,
    triggers: { event: PROJECT_SUBMITTED_EVENT },
  },
  async ({ event, step }) => {
    const projectId = String(event.data.projectId ?? "");
    const organizationId = String(event.data.organizationId ?? "");

    const context = await step.run("load-project-context", async () => {
      const supabase = createAdminClient();
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select(
          "id, organization_id, status, credit_reservation_id, customer_name, customer_logo_storage_key, music_genre, music_id, voice_selection, special_notes",
        )
        .eq("id", projectId)
        .eq("organization_id", organizationId)
        .single();

      if (projectError) {
        throw projectError;
      }

      const { data: images, error: imagesError } = await supabase
        .from("project_images")
        .select(
          "id, analysis, original_storage_key, upscaled_storage_key, video_storage_key, order_index, prompt_type, video_status",
        )
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });

      if (imagesError) {
        throw imagesError;
      }

      const { data: reservation, error: reservationError } = await supabase
        .from("credit_reservations")
        .select("id, status, expires_at, amount")
        .eq("project_id", projectId)
        .single();

      if (reservationError) {
        throw reservationError;
      }

      const { data: organization, error: organizationError } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", organizationId)
        .single();

      if (organizationError) {
        throw organizationError;
      }

      return {
        images: images ?? [],
        organization,
        project,
        reservation,
      };
    });

    if (["canceled", "completed", "failed"].includes(context.project.status)) {
      await step.run("skip-terminal-project", () =>
        writePipelineLog({
          message: `Pipeline event ignored because the project is already ${context.project.status}.`,
          projectId,
          status: "skipped",
          step: "validation",
        }),
      );

      return { skipped: true, status: context.project.status };
    }

    if (
      ![
        "submitted",
        "queued",
        "validating",
        "upscaling",
        "generating_video",
        "media_qc",
        "editing",
        "rendering",
        "quality_check",
      ].includes(context.project.status)
    ) {
      await step.run("skip-active-project", () =>
        writePipelineLog({
          message: `Pipeline event ignored because the project is already ${context.project.status}.`,
          projectId,
          status: "skipped",
          step: "queue",
        }),
      );

      return { skipped: true, status: context.project.status };
    }

    const shouldRunIntakeAndUpscaling = [
      "submitted",
      "queued",
      "validating",
      "upscaling",
    ].includes(context.project.status);
    const enhancedImages: EnhancedImageResult[] = [];

    if (shouldRunIntakeAndUpscaling) {
      await step.run("mark-queued", async () => {
        await updateProjectStatus(projectId, "queued");
        await writePipelineLog({
          message: "Project accepted by Inngest and queued for validation.",
          metadata: {
            eventId: event.id,
            imageCount: context.images.length,
          },
          projectId,
          status: "completed",
          step: "queue",
        });
      });

      await step.run("start-validation", async () => {
        await updateProjectStatus(projectId, "validating");
        await writePipelineLog({
          message: "Pipeline validation started.",
          projectId,
          status: "started",
          step: "validation",
        });
      });

      const validation = await step.run("validate-intake", () => {
        const errors: string[] = [];
        const expiresAt = new Date(context.reservation.expires_at).getTime();

        if (
          context.images.length < IMAGE_REQUIREMENTS.minImages ||
          context.images.length > IMAGE_REQUIREMENTS.maxImages
        ) {
          errors.push(
            `Expected ${IMAGE_REQUIREMENTS.minImages}-${IMAGE_REQUIREMENTS.maxImages} source images, found ${context.images.length}.`,
          );
        }

        if (context.reservation.status !== "reserved") {
          errors.push(`Credit reservation is ${context.reservation.status}.`);
        }

        if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
          errors.push("Credit reservation has expired.");
        }

        if (!context.project.customer_name) {
          errors.push("Customer or collection name is missing.");
        }

        if (!context.project.voice_selection) {
          errors.push("Voice selection is missing.");
        }

        return {
          errors,
          ok: errors.length === 0,
        };
      });

      if (!validation.ok) {
        await step.run("mark-validation-failed", async () => {
          const message = validation.errors.join(" ");
          const supabase = createAdminClient();

          await writePipelineLog({
            message,
            metadata: { errors: validation.errors },
            projectId,
            status: "failed",
            step: "validation",
          });

          const { error } = await supabase
            .from("projects")
            .update({
              error_message: message,
              status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);

          if (error) {
            throw error;
          }

          const { error: reservationError } = await supabase
            .from("credit_reservations")
            .update({
              status: "released",
              updated_at: new Date().toISOString(),
            })
            .eq("id", context.reservation.id);

          if (reservationError) {
            throw reservationError;
          }
        });

        return { errors: validation.errors, ok: false };
      }

      await step.run("complete-validation", () =>
        writePipelineLog({
          message:
            "Pipeline validation completed. Ready for image enhancement.",
          metadata: {
            nextStatus: "upscaling",
          },
          projectId,
          status: "completed",
          step: "validation",
        }),
      );

      await step.run("start-upscaling", async () => {
        await updateProjectStatus(projectId, "upscaling");
        await writePipelineLog({
          message: "Image enhancement step started.",
          metadata: {
            imageCount: context.images.length,
            mode: "real",
            provider: AI_PROVIDERS.imageEnhancement.primary,
          },
          projectId,
          status: "started",
          step: "upscaling",
        });
      });

      const upscalingPrompt = await step.run(
        "load-upscaling-prompt",
        async () => loadPipelinePrompt("upscaling"),
      );
      const validatorPrompt = await step.run(
        "load-validator-prompt",
        async () => loadPipelinePrompt("validator"),
      );
      const upscalingImages = [...context.images].sort(
        (a, b) => a.order_index - b.order_index,
      );

      const upscalingPlan = await step.run("prepare-upscaling-plan", () => ({
        directPrompt: true,
        enhancementAgentEnabled: false,
        images: upscalingImages.map((image) => ({
          hasExistingOutput: Boolean(image.upscaled_storage_key),
          imageId: image.id,
          orderIndex: image.order_index,
          sourceStorageKey: image.original_storage_key,
          targetStorageKey:
            image.upscaled_storage_key ??
            buildEnhancedStorageKey(image.original_storage_key, "image/png"),
        })),
        mode: "real",
        model: AI_PROVIDERS.imageEnhancement.model,
        maxCostPerImage: PIPELINE_MAX_COST_PER_IMAGE,
        maxCostPerJob: PIPELINE_MAX_COST_PER_JOB,
        maxRetries: PIPELINE_MAX_IMAGE_RETRIES,
        provider: AI_PROVIDERS.imageEnhancement.primary,
        promptPath: UPSCALING_PROMPT_PATH,
        targetResolution: "2K",
        validatorCascadeEnabled: PIPELINE_VALIDATOR_CASCADE_ENABLED,
      }));
      let jobCostSoFar = 0;

      for (const image of upscalingImages) {
        const jobCostAtImageStart = jobCostSoFar;
        const imageOutcome = await step.run(
          `process-image-${image.order_index + 1}`,
          async () => {
            const supabase = createAdminClient();

            if (image.video_status === "dropped") {
              await writePipelineLog({
                message: `Image ${image.order_index + 1} was already dropped. Skipping image enhancement.`,
                metadata: {
                  imageId: image.id,
                },
                projectId,
                status: "skipped",
                step: "upscaling",
              });

              return {
                dropped: true,
                imageId: image.id,
                orderIndex: image.order_index,
                skipped: true,
                totalCost: 0,
              };
            }

            if (image.upscaled_storage_key) {
              await writePipelineLog({
                message: `Image ${image.order_index + 1} already has an enhanced file. Skipping regeneration.`,
                metadata: {
                  imageId: image.id,
                  outputStorageKey: image.upscaled_storage_key,
                },
                projectId,
                status: "skipped",
                step: "upscaling",
              });

              return {
                imageId: image.id,
                orderIndex: image.order_index,
                outputStorageKey: image.upscaled_storage_key,
                skipped: true,
                totalCost: 0,
              };
            }

            const { data: sourceFile, error: downloadError } =
              await supabase.storage
                .from(STORAGE_BUCKETS.sourceAssets)
                .download(image.original_storage_key);

            if (downloadError) {
              throw downloadError;
            }

            const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
            const sourceMimeType =
              sourceFile.type || inferImageMimeType(image.original_storage_key);
            const analysisForImage: Json | null = image.analysis;
            const preservationBriefPrompt: string | null = null;
            const inputResized = await resizeForValidation(sourceBytes);

            await writePipelineLog({
              message: `Image ${image.order_index + 1} skipped Enhancement Agent and will use Nano Banana Pro directly.`,
              metadata: {
                directPrompt: true,
                enhancementAgentEnabled: false,
                imageId: image.id,
                promptPath: UPSCALING_PROMPT_PATH,
                sourceStorageKey: image.original_storage_key,
              },
              projectId,
              status: "skipped",
              step: "enhancement_analysis",
            });

            const imageSpecificUpscalingPrompt = buildUpscalingPrompt({
              markdown: upscalingPrompt,
              notes: context.project.special_notes,
              preservationPrompt: preservationBriefPrompt,
            });

            const { data: signedSource, error: signedSourceError } =
              await supabase.storage
                .from(STORAGE_BUCKETS.sourceAssets)
                .createSignedUrl(image.original_storage_key, 60 * 60);

            if (signedSourceError) {
              throw signedSourceError;
            }

            if (!signedSource?.signedUrl) {
              throw new Error(
                `Could not create a signed URL for source image ${image.order_index + 1}.`,
              );
            }

            let costSoFar = 0;
            const attempts: AttemptLog[] = [];
            let acceptedOutput: {
              bytes: Uint8Array;
              mimeType: string;
              providerJobId: string;
              result: Awaited<ReturnType<typeof enhanceImageWithKieNanoBananaPro>>;
              storageKey: string;
            } | null = null;
            let dropReason: string | null = null;

            for (let attempt = 1; attempt <= PIPELINE_MAX_IMAGE_RETRIES; attempt += 1) {
              if (costSoFar >= PIPELINE_MAX_COST_PER_IMAGE) {
                dropReason = "cost_cap_exceeded";
                break;
              }

              if (jobCostAtImageStart + costSoFar >= PIPELINE_MAX_COST_PER_JOB) {
                dropReason = "job_cost_cap_exceeded";
                break;
              }

              const seed = deterministicSeed(projectId, image.id, attempt);
              const providerJob = await ensureProviderJob({
                idempotencyKey: buildUpscalingProviderJobKey({
                  attempt,
                  imageId: image.id,
                  projectId,
                  seed,
                  sourceStorageKey: image.original_storage_key,
                }),
                model: AI_PROVIDERS.imageEnhancement.model,
                outputStorageKey: null,
                projectId,
                projectImageId: image.id,
                provider: AI_PROVIDERS.imageEnhancement.primary,
                request: {
                  aspectRatio: "16:9",
                  attempt,
                  directPrompt: true,
                  enhancementAgentEnabled: false,
                  promptPath: UPSCALING_PROMPT_PATH,
                  preservationBriefApplied: Boolean(preservationBriefPrompt),
                  preservationBriefSource: "disabled",
                  seed,
                  sourceMimeType,
                  sourceStorageKey: image.original_storage_key,
                  targetResolution: "2K",
                  validatorCascadeEnabled: PIPELINE_VALIDATOR_CASCADE_ENABLED,
                },
                step: "upscaling",
              });

              if (!providerJob.created) {
                const message = buildProviderResumeBlockMessage(providerJob.job);

                await writePipelineLog({
                  message,
                  metadata: {
                    attempt,
                    imageId: image.id,
                    providerJobId: providerJob.job.id,
                    providerJobStatus: providerJob.job.status,
                    seed,
                  },
                  projectId,
                  status: "failed",
                  step: "upscaling",
                });

                throw new Error(message);
              }

              let result: Awaited<
                ReturnType<typeof enhanceImageWithKieNanoBananaPro>
              >;

              try {
                result = await enhanceImageWithKieNanoBananaPro({
                  aspectRatio: "16:9",
                  prompt: imageSpecificUpscalingPrompt,
                  seed,
                  sourceImage: sourceBytes,
                  sourceImageUrl: signedSource.signedUrl,
                  sourceMimeType,
                  sourceStorageKey: image.original_storage_key,
                  targetResolution: "2K",
                });
              } catch (error) {
                await updateProviderJob(providerJob.job.id, {
                  error_message: getErrorMessage(error),
                  failed_at: new Date().toISOString(),
                  status: "failed",
                });

                throw error;
              }

              const generationCost = estimateKieCostUsd(result.creditsConsumed) ?? 0;
              costSoFar += generationCost;

              const outputResized = await resizeForValidation(result.outputImage);
              const validatorResponse = await validateOutput({
                cascadeEnabled: PIPELINE_VALIDATOR_CASCADE_ENABLED,
                inputImage: inputResized.data,
                inputMimeType: inputResized.mimeType,
                outputImage: outputResized.data,
                outputMimeType: outputResized.mimeType,
                prompt: validatorPrompt,
              });
              const validationCost = validatorResponse.estimatedCostUsd;
              costSoFar += validationCost;

              await safeInsertAttempt({
                attemptNumber: attempt,
                cascadeRan: validatorResponse.cascadeRan,
                claudeResponse: validatorResponse.claudeResult,
                criticalFailures: validatorResponse.result.critical_failures,
                decision: validatorResponse.result.overall_decision,
                generationCost,
                geminiResponse: validatorResponse.geminiResult,
                imageId: image.id,
                jobId: projectId,
                seed,
                validationCost,
              });

              attempts.push({
                attempt,
                cost: generationCost + validationCost,
                decision: validatorResponse.result.overall_decision,
                failures: validatorResponse.result.critical_failures,
                providerJobId: providerJob.job.id,
                seed,
              });

              const providerResponse = {
                attempt,
                creditsConsumed: result.creditsConsumed ?? null,
                finalHeight: result.finalHeight ?? null,
                finalWidth: result.finalWidth ?? null,
                model: result.model,
                originalOutputMimeType: result.originalOutputMimeType ?? null,
                outputBytes: result.outputImage.byteLength,
                outputMimeType: result.outputMimeType,
                provider: result.provider,
                responseText: result.responseText ?? null,
                seed,
                taskId: result.taskId ?? null,
                validation: {
                  cascadeRan: validatorResponse.cascadeRan,
                  claudeResult: validatorResponse.claudeResult as unknown as Json,
                  decision: validatorResponse.result.overall_decision,
                  estimatedCostUsd: validationCost,
                  geminiResult: validatorResponse.geminiResult as unknown as Json,
                  openaiResult: validatorResponse.openaiResult as unknown as Json,
                  primaryProvider: validatorResponse.primaryProvider,
                  providerResults: validatorResponse.providerResults as unknown as Json,
                },
              };

              if (
                validatorResponse.result.overall_decision === "ACCEPT" ||
                validatorResponse.result.overall_decision ===
                  "ACCEPT_WITH_WARNING"
              ) {
                const outputStorageKey = buildEnhancedStorageKey(
                  image.original_storage_key,
                  result.outputMimeType,
                );

                try {
                  const { error: uploadError } = await supabase.storage
                    .from(STORAGE_BUCKETS.sourceAssets)
                    .upload(
                      outputStorageKey,
                      new Blob([toArrayBuffer(result.outputImage)], {
                        type: result.outputMimeType,
                      }),
                      {
                        contentType: result.outputMimeType,
                        upsert: true,
                      },
                    );

                  if (uploadError) {
                    throw uploadError;
                  }

                  const { error: updateError } = await supabase
                    .from("project_images")
                    .update({
                      analysis: mergeImageEnhancementAnalysis({
                        analysis: analysisForImage,
                        aspectRatio: "16:9",
                        model: result.model,
                        preservationBriefPrompt,
                        provider: result.provider,
                        providerJobId: providerJob.job.id,
                        sourceMimeType,
                        targetResolution: "2K",
                      }),
                      upscaled_storage_key: outputStorageKey,
                      video_status: "upscaled",
                    })
                    .eq("id", image.id);

                  if (updateError) {
                    throw updateError;
                  }

                  await updateProviderJob(providerJob.job.id, {
                    completed_at: new Date().toISOString(),
                    credits_consumed: result.creditsConsumed ?? null,
                    estimated_cost_usd: generationCost,
                    output_storage_key: outputStorageKey,
                    response: providerResponse,
                    status: "completed",
                  });

                  acceptedOutput = {
                    bytes: result.outputImage,
                    mimeType: result.outputMimeType,
                    providerJobId: providerJob.job.id,
                    result,
                    storageKey: outputStorageKey,
                  };
                } catch (error) {
                  await updateProviderJob(providerJob.job.id, {
                    error_message: getErrorMessage(error),
                    output_storage_key: outputStorageKey,
                    response: providerResponse,
                    status: "requires_manual_retry",
                  });

                  throw error;
                }

                break;
              }

              await updateProviderJob(providerJob.job.id, {
                completed_at: new Date().toISOString(),
                credits_consumed: result.creditsConsumed ?? null,
                estimated_cost_usd: generationCost,
                response: providerResponse,
                status: "completed",
              });

              await writePipelineLog({
                message: `Image ${image.order_index + 1} rejected on attempt ${attempt}; retrying if budget allows.`,
                metadata: {
                  attempt,
                  creditsConsumed: result.creditsConsumed ?? null,
                  decision: validatorResponse.result.overall_decision,
                  failures: validatorResponse.result.critical_failures,
                  imageId: image.id,
                  providerJobId: providerJob.job.id,
                  seed,
                  totalCost: costSoFar,
                },
                projectId,
                status: "failed",
                step: "upscaling",
              });
            }

            if (!acceptedOutput) {
              dropReason ??= "max_retries_exceeded";

              const { error: updateError } = await supabase
                .from("project_images")
                .update({
                  video_status: "dropped",
                })
                .eq("id", image.id);

              if (updateError) {
                throw updateError;
              }

              await safeInsertOutcome({
                dropReason,
                finalOutputUrl: null,
                imageId: image.id,
                jobId: projectId,
                status: "dropped",
                totalAttempts: attempts.length,
                totalCost: costSoFar,
              });

              await writePipelineLog({
                message: `Image ${image.order_index + 1} dropped after ${attempts.length} attempts (${dropReason}).`,
                metadata: {
                  attempts,
                  dropReason,
                  imageId: image.id,
                  totalCost: costSoFar,
                },
                projectId,
                status: "failed",
                step: "upscaling",
              });

              return {
                dropReason,
                dropped: true,
                imageId: image.id,
                orderIndex: image.order_index,
                totalCost: costSoFar,
              };
            }

            await safeInsertOutcome({
              dropReason: null,
              finalOutputUrl: acceptedOutput.storageKey,
              imageId: image.id,
              jobId: projectId,
              status: "success",
              totalAttempts: attempts.length,
              totalCost: costSoFar,
            });

            await writePipelineLog({
              message: `Image ${image.order_index + 1} accepted on attempt ${attempts.length}.`,
              metadata: {
                attempts,
                imageId: image.id,
                outputMimeType: acceptedOutput.mimeType,
                outputStorageKey: acceptedOutput.storageKey,
                outputHeight: acceptedOutput.result.finalHeight ?? null,
                outputWidth: acceptedOutput.result.finalWidth ?? null,
                provider: acceptedOutput.result.provider,
                providerJobId: acceptedOutput.providerJobId,
                sourceStorageKey: image.original_storage_key,
                targetResolution: "2K",
                taskId: acceptedOutput.result.taskId ?? null,
                totalCost: costSoFar,
              },
              projectId,
              status: "completed",
              step: "upscaling",
            });

            return {
              imageId: image.id,
              orderIndex: image.order_index,
              outputMimeType: acceptedOutput.mimeType,
              outputStorageKey: acceptedOutput.storageKey,
              skipped: false,
              totalCost: costSoFar,
            };
          },
        );

        jobCostSoFar += imageOutcome.totalCost ?? 0;
        enhancedImages.push(imageOutcome);
      }

      await step.run("complete-upscaling", async () => {
        await updateProjectStatus(projectId, "generating_video");
        await writePipelineLog({
          message:
            "Image enhancement completed. Enhanced files are ready for video generation.",
          metadata: {
            ...upscalingPlan,
            enhancedImages,
            nextStatus: "generating_video",
          },
          projectId,
          status: "completed",
          step: "upscaling",
        });
      });
    }

    const enhancedStorageKeys = new Map(
      enhancedImages
        .filter((image) => image.outputStorageKey)
        .map((image) => [image.imageId, image.outputStorageKey ?? null]),
    );
    const droppedImageIds = new Set(
      enhancedImages
        .filter((image) => image.dropped)
        .map((image) => image.imageId),
    );
    const videoImageSources: ProjectImageSource[] = context.images
      .map((image) => ({
        ...image,
        upscaled_storage_key:
          image.upscaled_storage_key ?? enhancedStorageKeys.get(image.id) ?? null,
      }))
      .filter(
        (image) =>
          image.video_status !== "dropped" &&
          !droppedImageIds.has(image.id) &&
          Boolean(image.upscaled_storage_key),
      );
    const videoLengthProfile: VideoLengthProfile =
      videoImageSources.length >= IMAGE_REQUIREMENTS.minImages &&
      videoImageSources.length <= IMAGE_REQUIREMENTS.maxImages
        ? getVideoLengthProfileForImageCount(videoImageSources.length)
        : "long";
    const kieCallbackUrl = getKieCallbackUrl();
    const shouldUseKieCallback = Boolean(kieCallbackUrl);
    const generatedClips: GeneratedClipResult[] = [];
    const shouldRunVideoGeneration = [
      "submitted",
      "queued",
      "validating",
      "upscaling",
      "generating_video",
    ].includes(context.project.status);

    if (shouldRunVideoGeneration) {
      const modeAssignments = await step.run(
        "assign-kling-generation-modes",
        async () => {
          const existingAssignments = videoImageSources
            .map((image) =>
              getExistingVideoAgentDecision({
                analysis: image.analysis,
                imageId: image.id,
                orderIndex: image.order_index,
                promptType: image.prompt_type,
              }),
            )
            .filter((decision): decision is KlingModeDecision =>
              Boolean(decision),
            );

          if (existingAssignments.length === videoImageSources.length) {
            return existingAssignments;
          }

          const supabase = createAdminClient();
          const videoAgentPrompt = await loadPipelinePrompt("agent");
          const sourceById = new Map(
            videoImageSources.map((image) => [image.id, image]),
          );
          const classificationImages = (
            await Promise.all(
              videoImageSources.map(async (image) => {
                if (
                  image.video_status === "dropped" ||
                  !image.upscaled_storage_key
                ) {
                  return null;
                }

                const { data: file, error } = await supabase.storage
                  .from(STORAGE_BUCKETS.sourceAssets)
                  .download(image.upscaled_storage_key);

                if (error) {
                  throw error;
                }

                if (!file) {
                  throw new Error(
                    `Could not download enhanced image ${image.order_index + 1} for Video Agent analysis.`,
                  );
                }

                return {
                  enhancedImage: new Uint8Array(await file.arrayBuffer()),
                  enhancedStorageKey: image.upscaled_storage_key,
                  imageId: image.id,
                  orderIndex: image.order_index,
                  sourceMimeType: inferImageMimeType(image.upscaled_storage_key),
                };
              }),
            )
          ).filter((item): item is NonNullable<typeof item> => Boolean(item));

          if (classificationImages.length === 0) {
            return [];
          }

          const rawResult = await classifyImagesForKlingModes({
            images: classificationImages,
            prompt: videoAgentPrompt,
          });
          const result = normalizeVideoAgentResult({
            imageCount: classificationImages.length,
            result: rawResult,
          });
          const multiShotCount = result.decisions.filter(
            (decision) => decision.selectedMode === "multi_shot",
          ).length;

          if (multiShotCount !== 2) {
            throw new Error(
              `Video Agent selected ${multiShotCount} multi-shot images; expected exactly 2.`,
            );
          }

          for (const decision of result.decisions) {
            const sourceImage = sourceById.get(decision.imageId);

            if (!sourceImage) {
              throw new Error(
                `Video Agent returned unknown image id ${decision.imageId}.`,
              );
            }

            const { data: latestImage, error: latestImageError } = await supabase
              .from("project_images")
              .select("analysis")
              .eq("id", decision.imageId)
              .single();

            if (latestImageError) {
              throw latestImageError;
            }

            const { error } = await supabase
              .from("project_images")
              .update({
                analysis: mergeVideoAgentDecisionAnalysis({
                  analysis: latestImage.analysis ?? sourceImage.analysis,
                  decision,
                  promptPath: VIDEO_AGENT_PROMPT_PATH,
                  result,
                }),
                prompt_type: decision.selectedMode,
              })
              .eq("id", decision.imageId);

            if (error) {
              throw error;
            }
          }

          await writePipelineLog({
            message: "Video Agent assigned Kling generation modes for all enhanced images.",
            metadata: {
              decisions: result.decisions,
              model: result.model,
              multiShotImageIds: result.multiShotImageIds,
              promptPath: VIDEO_AGENT_PROMPT_PATH,
              provider: result.provider,
              singleShotImageIds: result.singleShotImageIds,
              summary: result.summary,
            },
            projectId,
            status: "completed",
            step: "video_agent",
          });

          return result.decisions;
        },
      );
      const clipPlan = buildKlingClipPlan({
        decisions: modeAssignments,
        images: videoImageSources,
      });
      const modeCounts = clipPlan.reduce<Record<KlingGenerationMode, number>>(
        (counts, clip) => {
          counts[clip.generationMode] += 1;
          return counts;
        },
        {
          multi_shot: 0,
          single_shot: 0,
        },
      );

      await step.run("start-video-generation", async () => {
        await updateProjectStatus(projectId, "generating_video");
        await writePipelineLog({
          message: "Kling video generation step started.",
          metadata: {
            imageCount: videoImageSources.length,
            jobCount: clipPlan.length,
            lengthProfile: videoLengthProfile,
            mode: "real",
            modeCounts,
            plan: clipPlan.map((clip) => ({
              clipId: clip.clipId,
              duplicateIndex: clip.duplicateIndex,
              generationMode: clip.generationMode,
              imageId: clip.image.id,
              multiShotVariant: clip.multiShotVariant,
              orderIndex: clip.image.order_index,
            })),
            promptPaths: {
              multi_shot: MULTI_SHOT_PROMPT_PATH,
              multi_shot_three_scene: MULTI_SHOT_THREE_SCENE_PROMPT_PATH,
              single_shot: SINGLE_SHOT_PROMPT_PATH,
            },
            provider: AI_PROVIDERS.imageToVideo.primary,
            request: {
              aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
              callbackEnabled: shouldUseKieCallback,
              durationSecondsByMode: KLING_DURATION_SECONDS_BY_MODE,
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
            },
          },
          projectId,
          status: "started",
          step: "video_generation",
        });
      });

      const klingPrompts = await step.run(
        "load-kling-prompts",
        async () => ({
          multi_shot: await loadPipelinePrompt("multi-shot"),
          multi_shot_three_scene: await loadPipelinePrompt(
            "multi-shot-three-scene",
          ),
          single_shot: await loadPipelinePrompt("single-shot"),
        }),
      );

      for (const clipJob of clipPlan) {
        const image = clipJob.image;
      const taskPreparation = await step.run(
        `start-kling-clip-${clipJob.clipId}`,
        async () => {
          const supabase = createAdminClient();
          const generationMode = clipJob.generationMode;
          const generationConfig = KLING_GENERATION_MODES[generationMode];
          const multiShotVariant = clipJob.multiShotVariant;
          const durationSeconds = generationConfig.durationSeconds;
          const promptPath =
            generationMode === "multi_shot" && multiShotVariant
              ? multiShotPromptPathForVariant(multiShotVariant)
              : generationConfig.promptPath;
          const klingPrompt =
            generationMode === "multi_shot" && multiShotVariant
              ? klingPrompts[multiShotPromptKeyForVariant(multiShotVariant)]
              : klingPrompts.single_shot;

          if (image.video_status === "dropped" || !image.upscaled_storage_key) {
            await writePipelineLog({
              message: `Image ${image.order_index + 1} has no accepted enhanced image. Skipping Kling generation.`,
              metadata: {
                clipId: clipJob.clipId,
                imageId: image.id,
                videoStatus: image.video_status,
              },
              projectId,
              status: "skipped",
              step: "video_generation",
            });

            return {
              clipId: clipJob.clipId,
              clipStorageKey: "",
              durationSeconds,
              generationMode,
              imageId: image.id,
              multiShotSceneCount:
                multiShotVariant === null
                  ? null
                  : multiShotSceneCountForVariant(multiShotVariant),
              multiShotVariant,
              orderIndex: image.order_index,
              skipped: true,
              tagSegmentsAsMultiShot: shouldTagSegmentsAsMultiShot(multiShotVariant),
            };
          }

          const { data: signedImage, error: signedImageError } =
            await supabase.storage
              .from(STORAGE_BUCKETS.sourceAssets)
              .createSignedUrl(image.upscaled_storage_key, 60 * 60);

          if (signedImageError) {
            throw signedImageError;
          }

          if (!signedImage?.signedUrl) {
            throw new Error(
              `Could not create a signed URL for image ${image.order_index + 1}.`,
            );
          }

          const clipStorageKey = buildClipStorageKey(
            image.upscaled_storage_key,
            clipJob.clipId,
          );
          const idempotencyKey = buildKlingProviderJobKey({
            clipStorageKey,
            generationMode,
            imageId: image.id,
            multiShotVariant,
            projectId,
          });
          const legacyProviderJob = await getProviderJobByKey(
            buildLegacyKlingProviderJobKey({
              clipStorageKey,
              imageId: image.id,
              projectId,
            }),
          );
          const providerJob: { created: boolean; job: ProviderJob } =
            legacyProviderJob
              ? { created: false, job: legacyProviderJob }
              : await ensureProviderJob({
                  idempotencyKey,
                  model: "kling-3.0/video",
                  outputStorageKey: clipStorageKey,
                  projectId,
                  projectImageId: image.id,
                  provider: AI_PROVIDERS.imageToVideo.primary,
                  request: {
                    aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
                    callbackEnabled: shouldUseKieCallback,
                    clipId: clipJob.clipId,
                    duplicateIndex: clipJob.duplicateIndex,
                    durationSeconds,
                    expectedClipCount: clipPlan.length,
                    generationMode,
                    imageStorageKey: image.upscaled_storage_key,
                    lengthProfile: videoLengthProfile,
                    mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
                    multiShotSceneCount:
                      multiShotVariant === null
                        ? null
                        : multiShotSceneCountForVariant(multiShotVariant),
                    multiShotVariant,
                    multiShots: generationConfig.multiShots,
                    promptPath,
                    sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
                  },
                  step: "video_generation",
                });

          if (!providerJob.created) {
            if (
              providerJob.job.status === "completed" &&
              providerJob.job.output_storage_key
            ) {
              const { error: updateError } = await supabase
                .from("project_images")
                .update({
                  video_storage_key: providerJob.job.output_storage_key,
                  video_status: "clip_generated",
                })
                .eq("id", image.id);

              if (updateError) {
                throw updateError;
              }

              await writePipelineLog({
                message: `Image ${image.order_index + 1} reused completed Kling provider job.`,
                metadata: {
                  imageId: image.id,
                  providerJobId: providerJob.job.id,
                  videoStorageKey: providerJob.job.output_storage_key,
                },
                projectId,
                status: "skipped",
                step: "video_generation",
              });

              return {
                clipId: clipJob.clipId,
                clipStorageKey: providerJob.job.output_storage_key,
                durationSeconds,
                generationMode,
                imageId: image.id,
                multiShotSceneCount:
                  multiShotVariant === null
                    ? null
                    : multiShotSceneCountForVariant(multiShotVariant),
                multiShotVariant,
                orderIndex: image.order_index,
                skipped: true,
                tagSegmentsAsMultiShot:
                  shouldTagSegmentsAsMultiShot(multiShotVariant),
              };
            }

            if (providerJob.job.external_task_id) {
              const { error: resumeUpdateError } = await supabase
                .from("project_images")
                .update({
                  video_status: "generating",
                })
                .eq("id", image.id);

              if (resumeUpdateError) {
                throw resumeUpdateError;
              }

              await writePipelineLog({
                message: `Resuming existing Kling task for image ${image.order_index + 1}.`,
                metadata: {
                  imageId: image.id,
                  providerJobId: providerJob.job.id,
                  providerJobStatus: providerJob.job.status,
                  taskId: providerJob.job.external_task_id,
                },
                projectId,
                status: "started",
                step: "video_generation",
              });

              return {
                callbackPending: shouldUseKieCallback,
                clipId: clipJob.clipId,
                clipStorageKey:
                  providerJob.job.output_storage_key ?? clipStorageKey,
                durationSeconds,
                generationMode,
                imageId: image.id,
                multiShotSceneCount:
                  multiShotVariant === null
                    ? null
                    : multiShotSceneCountForVariant(multiShotVariant),
                multiShotVariant,
                orderIndex: image.order_index,
                providerJobId: providerJob.job.id,
                skipped: false,
                tagSegmentsAsMultiShot:
                  shouldTagSegmentsAsMultiShot(multiShotVariant),
                taskId: providerJob.job.external_task_id,
              };
            }

            const message = buildProviderResumeBlockMessage(providerJob.job);

            await writePipelineLog({
              message,
              metadata: {
                imageId: image.id,
                providerJobId: providerJob.job.id,
                providerJobStatus: providerJob.job.status,
              },
              projectId,
              status: "failed",
              step: "video_generation",
            });

            throw new Error(message);
          }

          const { error: startUpdateError } = await supabase
            .from("project_images")
            .update({
              video_status: "generating",
            })
            .eq("id", image.id);

          if (startUpdateError) {
            throw startUpdateError;
          }

          let task: Awaited<ReturnType<typeof createKieKling30Task>>;

          try {
            task = await createKieKling30Task({
              aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
              callBackUrl: kieCallbackUrl ?? undefined,
              durationSeconds,
              imageUrls: [signedImage.signedUrl],
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              multiPrompt:
                generationMode === "multi_shot" && multiShotVariant
                  ? buildArchitecturalKlingMultiPrompt(
                      durationSeconds,
                      multiShotVariant,
                    )
                  : undefined,
              multiShots: generationConfig.multiShots,
              prompt: klingPrompt,
              sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
            });
          } catch (error) {
            await updateProviderJob(providerJob.job.id, {
              error_message: getErrorMessage(error),
              failed_at: new Date().toISOString(),
              status: "failed",
            });

            throw error;
          }

          await updateProviderJob(providerJob.job.id, {
            external_task_id: task.taskId,
            response: {
              provider: task.provider,
              taskId: task.taskId,
            },
            status: "submitted",
            submitted_at: new Date().toISOString(),
          });

          await writePipelineLog({
            message: `Kling 3.0 Pro task created for image ${image.order_index + 1}.`,
            metadata: {
              clipStorageKey,
              callbackEnabled: shouldUseKieCallback,
              durationSeconds,
              generationMode,
              imageId: image.id,
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              model: "kling-3.0/video",
              multiShotSceneCount:
                multiShotVariant === null
                  ? null
                  : multiShotSceneCountForVariant(multiShotVariant),
              multiShotVariant,
              multiShots: generationConfig.multiShots,
              promptPath,
              provider: AI_PROVIDERS.imageToVideo.primary,
              providerJobId: providerJob.job.id,
              sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
              taskId: task.taskId,
            },
            projectId,
            status: "started",
            step: "video_generation",
          });

          return {
            callbackPending: shouldUseKieCallback,
            clipId: clipJob.clipId,
            clipStorageKey,
            durationSeconds,
            generationMode,
            imageId: image.id,
            multiShotSceneCount:
              multiShotVariant === null
                ? null
                : multiShotSceneCountForVariant(multiShotVariant),
            multiShotVariant,
            orderIndex: image.order_index,
            providerJobId: providerJob.job.id,
            tagSegmentsAsMultiShot:
              shouldTagSegmentsAsMultiShot(multiShotVariant),
            taskId: task.taskId,
            skipped: false,
          };
        },
      );

      if (taskPreparation.skipped) {
        generatedClips.push({
          clipId: taskPreparation.clipId,
          clipStorageKey: taskPreparation.clipStorageKey ?? "",
          durationSeconds: taskPreparation.durationSeconds,
          generationMode: taskPreparation.generationMode,
          imageId: taskPreparation.imageId,
          multiShotSceneCount: taskPreparation.multiShotSceneCount,
          multiShotVariant: taskPreparation.multiShotVariant,
          orderIndex: taskPreparation.orderIndex,
          skipped: true,
          tagSegmentsAsMultiShot: taskPreparation.tagSegmentsAsMultiShot,
        });
        continue;
      }

      if (
        "callbackPending" in taskPreparation &&
        taskPreparation.callbackPending
      ) {
        generatedClips.push({
          callbackPending: true,
          clipId: taskPreparation.clipId,
          clipStorageKey: taskPreparation.clipStorageKey ?? "",
          durationSeconds: taskPreparation.durationSeconds,
          generationMode: taskPreparation.generationMode,
          imageId: taskPreparation.imageId,
          multiShotSceneCount: taskPreparation.multiShotSceneCount,
          multiShotVariant: taskPreparation.multiShotVariant,
          orderIndex: taskPreparation.orderIndex,
          skipped: false,
          tagSegmentsAsMultiShot: taskPreparation.tagSegmentsAsMultiShot,
          taskId:
            "taskId" in taskPreparation
              ? taskPreparation.taskId
              : undefined,
        });
        continue;
      }

      if (!("taskId" in taskPreparation) || !taskPreparation.taskId) {
        throw new Error(
          `Kling task was not created for image ${image.order_index + 1}.`,
        );
      }

      if (
        !("providerJobId" in taskPreparation) ||
        !taskPreparation.providerJobId
      ) {
        throw new Error(
          `Provider job was not persisted for image ${image.order_index + 1}.`,
        );
      }

      const activeTask = {
        clipId: taskPreparation.clipId,
        clipStorageKey: taskPreparation.clipStorageKey,
        durationSeconds: taskPreparation.durationSeconds,
        generationMode: taskPreparation.generationMode,
        imageId: taskPreparation.imageId,
        multiShotSceneCount: taskPreparation.multiShotSceneCount,
        multiShotVariant: taskPreparation.multiShotVariant,
        orderIndex: taskPreparation.orderIndex,
        providerJobId: taskPreparation.providerJobId,
        tagSegmentsAsMultiShot: taskPreparation.tagSegmentsAsMultiShot,
        taskId: taskPreparation.taskId,
      };

      let taskRecord = null as Awaited<ReturnType<typeof getKieTaskRecord>> | null;

      for (let pollIndex = 1; pollIndex <= KLING_MAX_POLLS; pollIndex += 1) {
        taskRecord = await step.run(
          `poll-kling-clip-${image.order_index + 1}-${String(pollIndex).padStart(
            2,
            "0",
          )}`,
          async () => {
            const record = await getKieTaskRecord(activeTask.taskId);

            await updateProviderJob(activeTask.providerJobId, {
              credits_consumed: record.creditsConsumed ?? null,
              estimated_cost_usd: estimateKieCostUsd(record.creditsConsumed),
              error_message: record.failMsg ?? null,
              failed_at:
                record.state === "fail" || record.state === "failed"
                  ? new Date().toISOString()
                  : null,
              response: {
                completeTime: record.completeTime ?? null,
                costTime: record.costTime ?? null,
                failCode: record.failCode ?? null,
                failMsg: record.failMsg ?? null,
                model: record.model ?? null,
                progress: record.progress ?? null,
                resultJson: record.resultJson ?? null,
                resultUrls: record.resultUrls,
                state: record.state,
                taskId: record.taskId,
                updateTime: record.updateTime ?? null,
              },
              status: mapKieTaskStateToProviderStatus(record.state),
            });

            return record;
          },
        );

        if (taskRecord.state === "success") {
          break;
        }

        if (taskRecord.state === "fail" || taskRecord.state === "failed") {
          await step.run(`mark-kling-clip-failed-${image.order_index + 1}`, async () => {
            const supabase = createAdminClient();
            const message =
              taskRecord?.failMsg ??
              `Kling task ${activeTask.taskId} failed.`;

            await writePipelineLog({
              message,
              metadata: {
                failCode: taskRecord?.failCode,
                imageId: image.id,
                providerJobId: activeTask.providerJobId,
                taskId: activeTask.taskId,
              },
              projectId,
              status: "failed",
              step: "video_generation",
            });

            await updateProviderJob(activeTask.providerJobId, {
              error_message: message,
              failed_at: new Date().toISOString(),
              status: "failed",
            });

            const { error } = await supabase
              .from("project_images")
              .update({
                video_status: "failed",
              })
              .eq("id", image.id);

            if (error) {
              throw error;
            }
          });

          throw new Error(
            `Kling task ${activeTask.taskId} failed: ${
              taskRecord.failMsg ?? taskRecord.failCode ?? "unknown error"
            }`,
          );
        }

        if (pollIndex < KLING_MAX_POLLS) {
          await step.sleep(
            `wait-kling-clip-${image.order_index + 1}-${String(
              pollIndex,
            ).padStart(2, "0")}`,
            `${KLING_POLL_INTERVAL_SECONDS}s`,
          );
        }
      }

      if (!taskRecord || taskRecord.state !== "success") {
        await step.run(`mark-kling-clip-timeout-${image.order_index + 1}`, async () => {
          const supabase = createAdminClient();

          await writePipelineLog({
            message: `Kling task ${activeTask.taskId} did not finish within ${
              KLING_MAX_POLLS * KLING_POLL_INTERVAL_SECONDS
            } seconds.`,
            metadata: {
              imageId: image.id,
              lastState: taskRecord?.state,
              providerJobId: activeTask.providerJobId,
              taskId: activeTask.taskId,
            },
            projectId,
            status: "failed",
            step: "video_generation",
          });

          await updateProviderJob(activeTask.providerJobId, {
            error_message: `Kling task did not finish within ${
              KLING_MAX_POLLS * KLING_POLL_INTERVAL_SECONDS
            } seconds.`,
            status: "requires_manual_retry",
          });

          const { error } = await supabase
            .from("project_images")
            .update({
              video_status: "failed",
            })
            .eq("id", image.id);

          if (error) {
            throw error;
          }
        });

        throw new Error(
          `Kling task ${activeTask.taskId} timed out before completion.`,
        );
      }

      const generatedClip = await step.run(
        `store-kling-clip-${image.order_index + 1}`,
        async () => {
          const supabase = createAdminClient();
          const resultUrl = taskRecord.resultUrls[0];

          try {
            if (!resultUrl) {
              throw new Error(
                `Kling task ${activeTask.taskId} completed without a result URL.`,
              );
            }

            const resultResponse = await fetch(resultUrl);

            if (!resultResponse.ok) {
              throw new Error(
                `Failed to download Kling result (${resultResponse.status}): ${resultResponse.statusText}`,
              );
            }

            let contentType = getVideoContentType(resultResponse);
            let clipBytes = new Uint8Array(await resultResponse.arrayBuffer());
            let stabilizationApplied = false;
            let stabilizationError: string | null = null;

            if (
              activeTask.generationMode === "multi_shot" &&
              PIPELINE_MULTISHOT_STABILIZATION_ENABLED
            ) {
              try {
              const stabilized = await stabilizeVideoBytes({
                clipStorageKey: activeTask.clipStorageKey,
                videoBytes: clipBytes,
              });
              clipBytes = stabilized.videoBytes;
              contentType = "video/mp4";
              stabilizationApplied = stabilized.stabilized;
              } catch (error) {
              stabilizationError = getErrorMessage(error);
              await writePipelineLog({
                message:
                  "Kling clip stabilization failed; continuing with original clip.",
                metadata: {
                  clipStorageKey: activeTask.clipStorageKey,
                  error: stabilizationError,
                  imageId: image.id,
                  providerJobId: activeTask.providerJobId,
                  taskId: activeTask.taskId,
                },
                projectId,
                status: "info",
                step: "video_generation",
              });
              }
            }

            const { error: uploadError } = await supabase.storage
              .from(STORAGE_BUCKETS.generatedClips)
              .upload(
                activeTask.clipStorageKey,
                new Blob([clipBytes], {
                  type: contentType,
                }),
                {
                  contentType,
                  upsert: true,
                },
              );

            if (uploadError) {
              throw uploadError;
            }

            const { error: updateError } = await supabase
              .from("project_images")
              .update({
                video_storage_key: activeTask.clipStorageKey,
                video_status: "clip_generated",
              })
              .eq("id", image.id);

            if (updateError) {
              throw updateError;
            }

            await updateProviderJob(activeTask.providerJobId, {
              completed_at: new Date().toISOString(),
              credits_consumed: taskRecord.creditsConsumed ?? null,
              estimated_cost_usd: estimateKieCostUsd(taskRecord.creditsConsumed),
              file_size_bytes: clipBytes.byteLength,
              output_storage_key: activeTask.clipStorageKey,
              response: {
                completeTime: taskRecord.completeTime ?? null,
                contentType,
                costTime: taskRecord.costTime ?? null,
                creditsConsumed: taskRecord.creditsConsumed ?? null,
                fileSizeBytes: clipBytes.byteLength,
                model: taskRecord.model ?? "kling-3.0/video",
                resultJson: taskRecord.resultJson ?? null,
                resultUrls: taskRecord.resultUrls,
                stabilizationApplied,
                stabilizationError,
                state: taskRecord.state,
                taskId: activeTask.taskId,
              },
              status: "completed",
            });

            await writePipelineLog({
              message: `Kling 3.0 Pro clip ${image.order_index + 1} generated and stored.`,
              metadata: {
                clipStorageKey: activeTask.clipStorageKey,
                contentType,
                creditsConsumed: taskRecord.creditsConsumed,
                durationSeconds: activeTask.durationSeconds,
                fileSizeBytes: clipBytes.byteLength,
                imageId: image.id,
                mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
                model: taskRecord.model ?? "kling-3.0/video",
                multiShotSceneCount: activeTask.multiShotSceneCount,
                multiShotVariant: activeTask.multiShotVariant,
                provider: AI_PROVIDERS.imageToVideo.primary,
                providerJobId: activeTask.providerJobId,
                stabilizationApplied,
                stabilizationError,
                taskId: activeTask.taskId,
              },
              projectId,
              status: "completed",
              step: "video_generation",
            });

            return {
              clipId: activeTask.clipId,
              clipStorageKey: activeTask.clipStorageKey,
              creditsConsumed: taskRecord.creditsConsumed,
              durationSeconds: activeTask.durationSeconds,
              fileSizeBytes: clipBytes.byteLength,
              generationMode: activeTask.generationMode,
              imageId: image.id,
              multiShotSceneCount: activeTask.multiShotSceneCount,
              multiShotVariant: activeTask.multiShotVariant,
              orderIndex: image.order_index,
              skipped: false,
              tagSegmentsAsMultiShot: activeTask.tagSegmentsAsMultiShot,
              taskId: activeTask.taskId,
            };
          } catch (error) {
            await updateProviderJob(activeTask.providerJobId, {
              error_message: getErrorMessage(error),
              output_storage_key: activeTask.clipStorageKey,
              response: {
                completeTime: taskRecord.completeTime ?? null,
                costTime: taskRecord.costTime ?? null,
                creditsConsumed: taskRecord.creditsConsumed ?? null,
                model: taskRecord.model ?? "kling-3.0/video",
                resultJson: taskRecord.resultJson ?? null,
                resultUrls: taskRecord.resultUrls,
                state: taskRecord.state,
                taskId: activeTask.taskId,
              },
              status: "requires_manual_retry",
            });

            throw error;
          }
        },
      );

      generatedClips.push(generatedClip);
      }

      const pendingCallbackClips = generatedClips.filter(
        (clip) => clip.callbackPending,
      );

      if (pendingCallbackClips.length > 0) {
        await step.run("wait-for-kie-callback", async () => {
          await writePipelineLog({
            message:
              "Kling tasks are submitted. Waiting for KIE callbacks to store generated clips.",
            metadata: {
              generatedClips,
              pendingCallbackClips,
              provider: AI_PROVIDERS.imageToVideo.primary,
            },
            projectId,
            status: "started",
            step: "video_generation",
          });
        });

        return {
          callbackPending: true,
          clipCount: generatedClips.length,
          imageCount: videoImageSources.length,
          ok: true,
          projectId,
          status: "generating_video",
        };
      }

      await step.run("complete-video-generation", async () => {
        await updateProjectStatus(projectId, "media_qc");
        await writePipelineLog({
          message:
            "Kling video generation completed. Clip artifacts are ready for media QC.",
          metadata: {
            generatedClips,
            lengthProfile: videoLengthProfile,
            mode: "real",
            modeCounts,
            nextStatus: "media_qc",
            promptPaths: {
              multi_shot: MULTI_SHOT_PROMPT_PATH,
              multi_shot_three_scene: MULTI_SHOT_THREE_SCENE_PROMPT_PATH,
              single_shot: SINGLE_SHOT_PROMPT_PATH,
            },
            provider: AI_PROVIDERS.imageToVideo.primary,
          },
          projectId,
          status: "completed",
          step: "video_generation",
        });
      });
    }

    const mediaQcClips = await step.run("load-media-qc-clips", async () => {
      const supabase = createAdminClient();
      const imageById = new Map(
        videoImageSources.map((image) => [image.id, image]),
      );
      const { data: providerJobs, error: jobsError } = await supabase
        .from("provider_jobs")
        .select(
          "id, created_at, output_storage_key, project_image_id, request, status",
        )
        .eq("project_id", projectId)
        .eq("step", "video_generation")
        .eq("status", "completed")
        .not("output_storage_key", "is", null)
        .order("created_at", { ascending: true });

      if (jobsError) {
        throw jobsError;
      }

      const clipsFromProviderJobs = (providerJobs ?? [])
        .map((job): MediaQcClipInput | null => {
          const image = job.project_image_id
            ? imageById.get(job.project_image_id)
            : null;
          const request = isJsonObject(job.request) ? job.request : {};
          const generationMode = isKlingGenerationMode(request.generationMode)
            ? request.generationMode
            : image?.prompt_type === "multi_shot"
              ? "multi_shot"
              : "single_shot";
          const multiShotVariant = isMultiShotVariant(request.multiShotVariant)
            ? request.multiShotVariant
            : null;
          const durationSeconds =
            typeof request.durationSeconds === "number"
              ? request.durationSeconds
              : KLING_DURATION_SECONDS_BY_MODE[generationMode];

          if (
            !image ||
            image.video_status === "dropped" ||
            !job.output_storage_key
          ) {
            return null;
          }

          return {
            analysis: image.analysis,
            clipId: typeof request.clipId === "string" ? request.clipId : job.id,
            clipStorageKey: job.output_storage_key,
            durationSeconds,
            imageId: image.id,
            multiShotSceneCount:
              typeof request.multiShotSceneCount === "number"
                ? request.multiShotSceneCount
                : multiShotVariant
                  ? multiShotSceneCountForVariant(multiShotVariant)
                  : null,
            multiShotVariant,
            orderIndex: image.order_index,
            promptType: generationMode,
            sourceImageStorageKey: image.upscaled_storage_key,
            tagSegmentsAsMultiShot:
              shouldTagSegmentsAsMultiShot(multiShotVariant),
            videoStatus: image.video_status,
          };
        })
        .filter((clip): clip is MediaQcClipInput => Boolean(clip));

      if (clipsFromProviderJobs.length > 0) {
        return clipsFromProviderJobs;
      }

      return context.images
        .filter((image) =>
          image.video_status !== "dropped" &&
          isExistingRealClip({
            videoStatus: image.video_status,
            videoStorageKey: image.video_storage_key,
          }),
        )
        .map((image): MediaQcClipInput => ({
          analysis: image.analysis,
          clipId: `legacy-image-${image.order_index + 1}`,
          clipStorageKey: image.video_storage_key ?? "",
          durationSeconds:
            image.prompt_type === "multi_shot"
              ? KLING_DURATION_SECONDS_BY_MODE.multi_shot
              : KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
          imageId: image.id,
          multiShotSceneCount:
            image.prompt_type === "multi_shot"
              ? multiShotSceneCountForVariant("five_scene")
              : null,
          multiShotVariant: image.prompt_type === "multi_shot" ? "five_scene" : null,
          orderIndex: image.order_index,
          promptType:
            image.prompt_type === "multi_shot" ? "multi_shot" : "single_shot",
          sourceImageStorageKey: image.upscaled_storage_key,
          tagSegmentsAsMultiShot: image.prompt_type === "multi_shot",
          videoStatus: image.video_status,
        }));
    });
    const mediaQcClipResults: MediaQcClipResult[] = [];

    if (mediaQcClips.length === 0) {
      await step.run("mark-media-qc-missing-clips", async () => {
        const supabase = createAdminClient();
        const message = "Media QC could not start because no generated clips were found.";

        await writePipelineLog({
          message,
          metadata: {
            generatedClips,
            projectStatus: context.project.status,
          },
          projectId,
          status: "failed",
          step: "media_qc",
        });

        const { error } = await supabase
          .from("projects")
          .update({
            error_message: message,
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId);

        if (error) {
          throw error;
        }

        if (context.reservation.status === "reserved") {
          const { error: reservationError } = await supabase
            .from("credit_reservations")
            .update({
              status: "released",
              updated_at: new Date().toISOString(),
            })
            .eq("id", context.reservation.id);

          if (reservationError) {
            throw reservationError;
          }
        }
      });

      return {
        clipCount: 0,
        imageCount: videoImageSources.length,
        ok: false,
        projectId,
        status: "failed",
      };
    }

    await step.run("start-media-qc", async () => {
      await updateProjectStatus(projectId, "media_qc");
      await writePipelineLog({
        message: "Media QC step started.",
        metadata: {
          clipCount: mediaQcClips.length,
          checks: [
            "duration",
            "codec",
            "black_frames",
            "freeze_frames",
            "blur",
            "bitrate",
            "resolution",
            "file_size",
          ],
        },
        projectId,
        status: "started",
        step: "media_qc",
      });
    });

    for (const image of mediaQcClips) {
      const mediaQcResult = await step.run(
        `media-qc-clip-${image.clipId}`,
        async () => {
          const supabase = createAdminClient();
          const clipStorageKey = image.clipStorageKey;
          const generatedClip = generatedClips.find(
            (clip) => clip.clipStorageKey === clipStorageKey,
          );
          const multiShotVariant =
            generatedClip?.multiShotVariant ??
            image.multiShotVariant ??
            null;
          const multiShotSceneCount =
            generatedClip?.multiShotSceneCount ??
            image.multiShotSceneCount ??
            (multiShotVariant
              ? multiShotSceneCountForVariant(multiShotVariant)
              : null);
          const tagSegmentsAsMultiShot =
            generatedClip?.tagSegmentsAsMultiShot ??
            image.tagSegmentsAsMultiShot;
          const expectedDurationSeconds =
            generatedClip?.durationSeconds ??
            image.durationSeconds ??
            KLING_DURATION_SECONDS_BY_MODE[image.promptType];

          let clipBytes = new Uint8Array();
          let report: MediaQcReport;

          try {
            const { data: clipFile, error: downloadError } =
              await supabase.storage
                .from(STORAGE_BUCKETS.generatedClips)
                .download(clipStorageKey);

            if (downloadError) {
              throw downloadError;
            }

            clipBytes = new Uint8Array(await clipFile.arrayBuffer());
            report = await runMediaQcOnVideoBytes({
              clipStorageKey,
              expectedDurationSeconds,
              videoBytes: clipBytes,
            });

            if (report.status === "passed") {
              if (!image.sourceImageStorageKey) {
                report = {
                  ...report,
                  checks: {
                    ...report.checks,
                    visualReview: {
                      message:
                        "Video visual review could not run because the source image is missing.",
                      status: "failed",
                    },
                  },
                  issues: [
                    ...report.issues,
                    "Video visual review source image is missing.",
                  ],
                  status: "failed",
                };
              } else {
                const { data: sourceFile, error: sourceDownloadError } =
                  await supabase.storage
                    .from(STORAGE_BUCKETS.sourceAssets)
                    .download(image.sourceImageStorageKey);

                if (sourceDownloadError) {
                  throw sourceDownloadError;
                }

                const review = await reviewVideoVisualQuality({
                  sourceImage: new Uint8Array(await sourceFile.arrayBuffer()),
                  sourceMimeType:
                    sourceFile.type || inferImageMimeType(image.sourceImageStorageKey),
                  videoBytes: clipBytes,
                });

                if (review.status === "failed") {
                  report = {
                  ...report,
                  checks: {
                    ...report.checks,
                    visualReview: {
                      message: `Video visual review failed: ${review.issues.join(", ") || review.notes}`,
                      status: "failed",
                    },
                    },
                    issues: [
                      ...report.issues,
                      `Video visual review failed: ${review.issues.join(", ") || review.notes}`,
                    ],
                    metrics: {
                      ...report.metrics,
                      sceneChangeSeconds: report.metrics.sceneChangeSeconds,
                    },
                    status: "failed",
                  };
                }

                report = {
                  ...report,
                  metrics: {
                    ...report.metrics,
                  },
                  warnings:
                    review.status === "skipped"
                      ? [...report.warnings, `Video visual review skipped: ${review.notes}`]
                      : report.warnings,
                };
              }
            }
          } catch (error) {
            report = buildFailedMediaQcReport({
              clipStorageKey,
              errorMessage: getErrorMessage(error),
              expectedDurationSeconds,
              fileSizeBytes: clipBytes.byteLength,
            });
          }

          const ok = report.status === "passed";
          const { error: updateError } = await supabase
            .from("project_images")
            .update({
              analysis: mergeMediaQcAnalysis(image.analysis, report),
              video_status: ok
                ? MEDIA_QC_PASSED_VIDEO_STATUS
                : MEDIA_QC_FAILED_VIDEO_STATUS,
            })
            .eq("id", image.imageId);

          if (updateError) {
            throw updateError;
          }

          await writePipelineLog({
            message: ok
              ? `Clip ${image.clipId} passed media QC.`
              : `Clip ${image.clipId} failed media QC.`,
            metadata: {
              clipId: image.clipId,
              clipStorageKey,
              imageId: image.imageId,
              report: report as unknown as Json,
            },
            projectId,
            status: ok ? "completed" : "failed",
            step: "media_qc",
          });

          return {
            clipId: image.clipId,
            clipStorageKey,
            imageId: image.imageId,
            multiShotSceneCount,
            multiShotVariant,
            ok,
            orderIndex: image.orderIndex,
            promptType: image.promptType,
            report,
            skipped: false,
            tagSegmentsAsMultiShot,
          };
        },
      );

      mediaQcClipResults.push(mediaQcResult);
    }

    const failedMediaQcClips = mediaQcClipResults.filter((clip) => !clip.ok);

    if (failedMediaQcClips.length > 0) {
      await step.run("mark-media-qc-failed", async () => {
        const supabase = createAdminClient();
        const firstIssue =
          failedMediaQcClips[0]?.report.issues[0] ??
          "At least one clip failed media QC.";
        const message = `${failedMediaQcClips.length} clip${
          failedMediaQcClips.length === 1 ? "" : "s"
        } failed media QC. ${firstIssue}`;

        const { error } = await supabase
          .from("projects")
          .update({
            error_message: message,
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId);

        if (error) {
          throw error;
        }

        if (context.reservation.status === "reserved") {
          const { error: reservationError } = await supabase
            .from("credit_reservations")
            .update({
              status: "released",
              updated_at: new Date().toISOString(),
            })
            .eq("id", context.reservation.id);

          if (reservationError) {
            throw reservationError;
          }
        }

        await writePipelineLog({
          message,
          metadata: {
            failedClipCount: failedMediaQcClips.length,
            mediaQcClipResults: mediaQcClipResults as unknown as Json,
            reservationReleased: context.reservation.status === "reserved",
          },
          projectId,
          status: "failed",
          step: "media_qc",
        });
      });

      return {
        clipCount: mediaQcClipResults.length,
        failedClipCount: failedMediaQcClips.length,
        imageCount: videoImageSources.length,
        ok: false,
        projectId,
        status: "failed",
      };
    }

    await step.run("complete-media-qc", async () => {
      await updateProjectStatus(projectId, "editing");
      await writePipelineLog({
        message: "Media QC completed. Clips are ready for the editor/rendering stage.",
        metadata: {
          mediaQcClipResults: mediaQcClipResults as unknown as Json,
          nextStatus: "editing",
        },
        projectId,
        status: "completed",
        step: "media_qc",
      });
    });

    const editorInstructions = await step.run("load-editor-instructions", async () => ({
      editor: await loadPipelinePrompt("editor").catch(() => ""),
      voice: await loadPipelinePrompt("voice").catch(() => ""),
    }));
    const projectPlanningInput = {
      customerName: context.project.customer_name,
      musicGenre: context.project.music_genre,
      projectId,
      salesNotes: context.project.special_notes,
      voiceSelection: context.project.voice_selection,
    };
    const clipSegments = await step.run("segment-qc-clips", async () => {
      const segments = buildClipSegmentsFromSources(
        mediaQcClipResults.map((clip) => ({
          clipId: clip.clipId,
          clipStorageKey: clip.clipStorageKey,
          durationSeconds: clip.report.metrics.durationSeconds,
          imageId: clip.imageId,
          multiShotSceneCount: clip.multiShotSceneCount,
          multiShotVariant: clip.multiShotVariant,
          orderIndex: clip.orderIndex,
          promptType: clip.promptType,
          sceneChangeSeconds: clip.report.metrics.sceneChangeSeconds,
          tagSegmentsAsMultiShot: clip.tagSegmentsAsMultiShot,
        })),
      );
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "clip-segments",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: segments as unknown as Json,
      });
      await writePipelineLog({
        message: `Editor segmentation prepared ${segments.length} clip segment${segments.length === 1 ? "" : "s"}.`,
        metadata: {
          editorInstructionsLoaded: Boolean(editorInstructions.editor),
          segments: segments as unknown as Json,
          storageKey,
        },
        projectId,
        status: "completed",
        step: "clip_segmentation",
      });

      return segments;
    });
    const musicContext = await step.run("load-music-context", async () => {
      const supabase = createAdminClient();
      const targetLengthProfile = videoLengthProfile;
      type MusicTrackRow = {
        duration_seconds: number | null;
        file_storage_key: string | null;
        genre: string | null;
        length_profile: VideoLengthProfile;
        name: string | null;
        plan_json: Json | null;
        track_group_key: string | null;
      };
      const toMusicContext = (track: MusicTrackRow | null) => ({
        durationSeconds: track?.duration_seconds ?? null,
        lengthProfile: track?.length_profile ?? targetLengthProfile,
        name: track?.name ?? null,
        planJson: track?.plan_json ?? null,
        storageKey: track?.file_storage_key ?? null,
        trackGroupKey: track?.track_group_key ?? null,
      });

      if (context.project.music_genre === "no_music") {
        return {
          durationSeconds: null,
          lengthProfile: targetLengthProfile,
          name: null,
          planJson: null,
          storageKey: null,
          trackGroupKey: null,
        };
      }

      const selectColumns =
        "duration_seconds, file_storage_key, genre, length_profile, name, plan_json, track_group_key";
      const findGenreTrack = async (genre: string | null) => {
        if (!genre) {
          return null;
        }

        const { data, error } = await supabase
          .from("music_tracks")
          .select(selectColumns)
          .eq("is_active", true)
          .eq("genre", genre)
          .eq("length_profile", targetLengthProfile)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw error;
        }

        return data as MusicTrackRow | null;
      };

      try {
        if (context.project.music_id) {
          const { data: selectedTrack, error: selectedError } = await supabase
            .from("music_tracks")
            .select(selectColumns)
            .eq("is_active", true)
            .eq("id", context.project.music_id)
            .limit(1)
            .maybeSingle();

          if (selectedError) {
            throw selectedError;
          }

          const selected = selectedTrack as MusicTrackRow | null;

          if (selected?.length_profile === targetLengthProfile) {
            return toMusicContext(selected);
          }

          if (selected?.track_group_key) {
            const { data: siblingTrack, error: siblingError } = await supabase
              .from("music_tracks")
              .select(selectColumns)
              .eq("is_active", true)
              .eq("track_group_key", selected.track_group_key)
              .eq("length_profile", targetLengthProfile)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (siblingError) {
              throw siblingError;
            }

            if (siblingTrack) {
              return toMusicContext(siblingTrack as MusicTrackRow);
            }
          }

          return toMusicContext(
            (await findGenreTrack(selected?.genre ?? context.project.music_genre)) ??
              selected,
          );
        }

        return toMusicContext(await findGenreTrack(context.project.music_genre));
      } catch (error) {
        if (!(isJsonObject(error) && error.code === "42703")) {
          throw error;
        }

        const fallbackQuery = supabase
          .from("music_tracks")
          .select("duration_seconds, file_storage_key, name")
          .eq("is_active", true);
        const selectedFallbackQuery = context.project.music_id
          ? fallbackQuery.eq("id", context.project.music_id)
          : fallbackQuery
            .eq("genre", context.project.music_genre)
            .order("created_at", { ascending: false });
        const { data: fallbackData, error: fallbackError } =
          await selectedFallbackQuery.limit(1).maybeSingle();

        if (fallbackError) {
          throw fallbackError;
        }

        return {
          durationSeconds: fallbackData?.duration_seconds ?? null,
          lengthProfile: targetLengthProfile,
          name: fallbackData?.name ?? null,
          planJson: null,
          storageKey: fallbackData?.file_storage_key ?? null,
          trackGroupKey: null,
        };
      }
    });
    const musicPlan = await step.run("build-music-instruction-plan", async () => {
      const plan = buildMusicInstructionPlan({
        lengthProfile: videoLengthProfile,
        musicGenre: context.project.music_genre,
        trackDurationSeconds: musicContext.durationSeconds,
        trackName: musicContext.name,
        trackPlanJson: musicContext.planJson,
        trackStorageKey: musicContext.storageKey,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "music-plan",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: plan as unknown as Json,
      });
      await writePipelineLog({
        message: musicContext.storageKey
          ? "Strict music cutpoint plan loaded for the selected track."
          : "Music plan prepared without a configured music file.",
        metadata: {
          cutPointsSeconds: plan.cutPointsSeconds,
          lengthProfile: videoLengthProfile,
          plan: plan as unknown as Json,
          storageKey,
          trackGroupKey: musicContext.trackGroupKey,
        },
        projectId,
        status: "completed",
        step: "music",
      });

      return plan;
    });
    const storyPlan = await step.run("build-editor-story-plan", async () => {
      const plan = buildEditorStoryPlan({
        music: musicPlan,
        project: projectPlanningInput,
        segments: clipSegments,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "editor-story-plan",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: plan as unknown as Json,
      });
      await writePipelineLog({
        message: "Editor story plan prepared from the QC-approved clip pool.",
        metadata: {
          plan: plan as unknown as Json,
          storageKey,
        },
        projectId,
        status: "completed",
        step: "editing",
      });

      return plan;
    });
    const voiceoverPlan = await step.run("build-voiceover-script", async () => {
      const plan = buildVoiceoverPlan({
        lengthProfile: videoLengthProfile,
        project: projectPlanningInput,
        storyPlan,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "voiceover-plan",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: plan as unknown as Json,
      });
      await writePipelineLog({
        message: "Voiceover script prepared from the visual story plan.",
        metadata: {
          plan: plan as unknown as Json,
          storageKey,
          voiceInstructionsLoaded: Boolean(editorInstructions.voice),
        },
        projectId,
        status: "completed",
        step: "voiceover",
      });

      return plan;
    });
    const voiceoverAsset = await step.run("generate-voiceover-audio", async () => {
      const voiceover = await generateVoiceoverAudio({
        script: voiceoverPlan.script,
        targetDurationSeconds: voiceoverPlan.targetDurationSeconds,
        voiceSelection: voiceoverPlan.voiceSelection,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: extensionForAudioContentType(voiceover.contentType),
        name: "voiceover",
        organizationId,
        projectId,
      });
      const supabase = createAdminClient();
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.finalOutputs)
        .upload(
          storageKey,
          new Blob([voiceover.audioBytes], {
            type: voiceover.contentType,
          }),
          {
            contentType: voiceover.contentType,
            upsert: true,
          },
        );

      if (error) {
        throw error;
      }

      await writePipelineLog({
        message:
          voiceover.provider === "elevenlabs"
            ? "Voiceover audio generated with ElevenLabs."
            : "Placeholder voiceover audio generated because ElevenLabs is not configured.",
        metadata: {
          durationSeconds: voiceover.durationSeconds,
          model: voiceover.model,
          provider: voiceover.provider,
          storageKey,
          voiceId: voiceover.voiceId,
        },
        projectId,
        status: "completed",
        step: "voiceover",
      });

      return {
        contentType: voiceover.contentType,
        durationSeconds: voiceover.durationSeconds,
        model: voiceover.model,
        provider: voiceover.provider,
        storageKey,
        voiceId: voiceover.voiceId,
      };
    });
    const finalEditPlan = await step.run("build-final-edit-plan", async () => {
      const plan = buildFinalEditPlan({
        lengthProfile: videoLengthProfile,
        music: musicPlan,
        segments: clipSegments,
        voiceover: voiceoverPlan,
        voiceoverDurationSeconds: voiceoverAsset.durationSeconds,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "final-edit-plan",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: plan as unknown as Json,
      });
      await writePipelineLog({
        message: "Final edit plan prepared against music cut points and voiceover duration.",
        metadata: {
          durationSeconds: plan.durationSeconds,
          sceneCount: plan.scenes.length,
          storageKey,
        },
        projectId,
        status: "completed",
        step: "editing",
      });

      return plan;
    });
    const renderManifest = await step.run("build-render-manifest", async () => {
      const clipSignedUrls = new Map<string, string>();
      const uniqueClipStorageKeys = Array.from(
        new Set(finalEditPlan.scenes.map((scene) => scene.clipStorageKey)),
      );

      for (const clipStorageKey of uniqueClipStorageKeys) {
        clipSignedUrls.set(
          clipStorageKey,
          await createSignedStorageUrl({
            bucket: STORAGE_BUCKETS.generatedClips,
            expiresInSeconds: 60 * 60,
            storageKey: clipStorageKey,
          }),
        );
      }

      const voiceoverSignedUrl = await createSignedStorageUrl({
        bucket: STORAGE_BUCKETS.finalOutputs,
        expiresInSeconds: 60 * 60,
        storageKey: voiceoverAsset.storageKey,
      });
      const musicSignedUrl = musicContext.storageKey
        ? await createSignedStorageUrl({
            bucket: STORAGE_BUCKETS.musicTracks,
            expiresInSeconds: 60 * 60,
            storageKey: musicContext.storageKey,
          })
        : null;
      const logoStorage = resolveLogoStorageKeys({
        fallbackLogoStorageKey: context.project.customer_logo_storage_key,
        organizationSettings: context.organization.settings,
      });
      const cornerLogoSignedUrl = logoStorage.cornerLogoStorageKey
        ? await createSignedStorageUrl({
            bucket: STORAGE_BUCKETS.sourceAssets,
            expiresInSeconds: 60 * 60,
            storageKey: logoStorage.cornerLogoStorageKey,
          })
        : null;
      const outroLogoSignedUrl = logoStorage.outroLogoStorageKey
        ? await createSignedStorageUrl({
            bucket: STORAGE_BUCKETS.sourceAssets,
            expiresInSeconds: 60 * 60,
            storageKey: logoStorage.outroLogoStorageKey,
          })
        : null;
      const manifest = buildSalesPitchRenderManifest({
        clipSignedUrls,
        cornerLogoSignedUrl,
        editPlan: finalEditPlan,
        musicSignedUrl,
        outroLogoBackgroundColor: logoStorage.outroLogoBackgroundColor,
        outroLogoFullFrame: logoStorage.outroLogoFullFrame,
        outroLogoSignedUrl,
        project: projectPlanningInput,
        voiceoverDurationSeconds: voiceoverAsset.durationSeconds,
        voiceoverSignedUrl,
      });
      const storageKey = buildProjectArtifactStorageKey({
        extension: "json",
        name: "render-manifest",
        organizationId,
        projectId,
      });

      await uploadJsonArtifact({
        bucket: STORAGE_BUCKETS.finalOutputs,
        storageKey,
        value: manifest as unknown as Json,
      });
      await writePipelineLog({
        message: "Render manifest prepared for Remotion.",
        metadata: {
          sceneCount: manifest.scenes.length,
          storageKey,
        },
        projectId,
        status: "completed",
        step: "rendering",
      });

      return {
        manifest,
        storageKey,
      };
    });
    const renderedVideo = await step.run("render-remotion-video", async () => {
      const finalOutputStorageKey = buildFinalOutputStorageKey({
        organizationId,
        projectId,
      });
      const providerJob = await ensureProviderJob({
        idempotencyKey: buildRenderingProviderJobKey(
          projectId,
          renderManifest.storageKey,
        ),
        model: "SalesPitch",
        outputStorageKey: finalOutputStorageKey,
        projectId,
        provider: "remotion",
        request: {
          compositionId: "SalesPitch",
          entryPoint: REMOTION_ENTRY_POINT,
          manifestStorageKey: renderManifest.storageKey,
        },
        step: "rendering",
      });
      const supabase = createAdminClient();

      await updateProjectStatus(projectId, "rendering");
      await writePipelineLog({
        message: "Remotion rendering started.",
        metadata: {
          finalOutputStorageKey,
          providerJobId: providerJob.job.id,
        },
        projectId,
        status: "started",
        step: "rendering",
      });

      try {
        const renderResult = await renderSalesPitchVideo({
          entryPoint: REMOTION_ENTRY_POINT,
          manifest: renderManifest.manifest,
        });
        const outputArrayBuffer = renderResult.outputBytes.buffer.slice(
          renderResult.outputBytes.byteOffset,
          renderResult.outputBytes.byteOffset + renderResult.outputBytes.byteLength,
        ) as ArrayBuffer;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKETS.finalOutputs)
          .upload(
            finalOutputStorageKey,
            new Blob([outputArrayBuffer], {
              type: renderResult.contentType,
            }),
            {
              contentType: renderResult.contentType,
              upsert: true,
            },
          );

        if (uploadError) {
          throw uploadError;
        }

        await updateProviderJob(providerJob.job.id, {
          completed_at: new Date().toISOString(),
          file_size_bytes: renderResult.outputBytes.byteLength,
          output_storage_key: finalOutputStorageKey,
          response: {
            contentType: renderResult.contentType,
            durationSeconds: renderResult.durationSeconds,
            fileSizeBytes: renderResult.outputBytes.byteLength,
          },
          status: "completed",
        });
        await writePipelineLog({
          message: "Remotion render completed and final MP4 was stored.",
          metadata: {
            durationSeconds: renderResult.durationSeconds,
            fileSizeBytes: renderResult.outputBytes.byteLength,
            finalOutputStorageKey,
            providerJobId: providerJob.job.id,
          },
          projectId,
          status: "completed",
          step: "rendering",
        });

        return {
          contentType: renderResult.contentType,
          durationSeconds: renderResult.durationSeconds,
          fileSizeBytes: renderResult.outputBytes.byteLength,
          storageKey: finalOutputStorageKey,
        };
      } catch (error) {
        await updateProviderJob(providerJob.job.id, {
          error_message: getErrorMessage(error),
          failed_at: new Date().toISOString(),
          status: "requires_manual_retry",
        });

        throw error;
      }
    });
    const finalQcReport = await step.run("quality-check-final-video", async () => {
      const supabase = createAdminClient();

      await updateProjectStatus(projectId, "quality_check");
      const { data: finalVideo, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKETS.finalOutputs)
        .download(renderedVideo.storageKey);

      if (downloadError) {
        throw downloadError;
      }

      return runMediaQcOnVideoBytes({
        clipStorageKey: renderedVideo.storageKey,
        expectedCutSeconds: renderManifest.manifest.scenes
          .map((scene) => scene.startAtSeconds)
          .filter(
            (seconds) =>
              seconds > 0 &&
              seconds < renderManifest.manifest.outro.startAtSeconds,
          ),
        expectedDurationSeconds: renderManifest.manifest.durationSeconds,
        videoBytes: new Uint8Array(await finalVideo.arrayBuffer()),
      });
    });

    if (finalQcReport.status !== "passed") {
      await step.run("mark-final-qc-failed", async () => {
        const supabase = createAdminClient();
        const message =
          finalQcReport.issues[0] ?? "Final rendered video failed QC.";

        await supabase
          .from("projects")
          .update({
            error_message: message,
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId)
          .throwOnError();

        if (context.reservation.status === "reserved") {
          await supabase
            .from("credit_reservations")
            .update({
              status: "released",
              updated_at: new Date().toISOString(),
            })
            .eq("id", context.reservation.id)
            .throwOnError();
        }

        await writePipelineLog({
          message,
          metadata: {
            finalQcReport: finalQcReport as unknown as Json,
          },
          projectId,
          status: "failed",
          step: "quality_check",
        });
      });

      return {
        clipCount: mediaQcClipResults.length,
        imageCount: videoImageSources.length,
        ok: false,
        projectId,
        status: "failed",
      };
    }

    await step.run("complete-project", async () => {
      const supabase = createAdminClient();

      await supabase
          .from("project_outputs")
          .insert({
            duration_seconds: finalQcReport.metrics.durationSeconds,
            file_size_bytes: renderedVideo.fileSizeBytes,
          project_id: projectId,
          qc_report: {
            finalQcReport,
            renderManifestStorageKey: renderManifest.storageKey,
          },
          resolution: `${finalQcReport.metrics.width ?? 1920}x${
            finalQcReport.metrics.height ?? 1080
          }`,
          video_storage_key: renderedVideo.storageKey,
          voiceover_script: voiceoverPlan.script,
        })
        .throwOnError();

      if (context.reservation.status === "reserved") {
        await supabase
          .from("credit_reservations")
          .update({
            status: "consumed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", context.reservation.id)
          .throwOnError();
      }

      await supabase
        .from("projects")
        .update({
          completed_at: new Date().toISOString(),
          error_message: null,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .throwOnError();

      await writePipelineLog({
        message: "Project completed with final MP4 output.",
        metadata: {
          finalOutputStorageKey: renderedVideo.storageKey,
          finalQcReport: finalQcReport as unknown as Json,
          reservationConsumed: context.reservation.status === "reserved",
        },
        projectId,
        status: "completed",
        step: "delivery",
      });
    });

    return {
      clipCount: mediaQcClipResults.length,
      finalOutputStorageKey: renderedVideo.storageKey,
      imageCount: videoImageSources.length,
      ok: true,
      projectId,
      status: "completed",
    };
  },
);
