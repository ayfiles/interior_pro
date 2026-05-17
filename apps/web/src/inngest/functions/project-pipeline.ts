import { AI_PROVIDERS, getVideoImageRequirements } from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  analyzeImageForEnhancement,
  createKieKling30Task,
  enhanceImageWithNanoBananaPro,
  generateVoiceoverAudio,
  getKieTaskRecord,
  runMediaQcOnVideoBytes,
  type ImageEnhancementAnalysisResult,
  type MediaQcReport,
} from "@interior-pro/pipeline";
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
  getErrorMessage,
  updateProviderJob,
  type ProviderJob,
} from "@/inngest/provider-jobs";
import { loadPipelinePrompt } from "@/lib/admin/prompts";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

type PipelineLogStatus = "started" | "completed" | "failed" | "skipped";
type EnhancedImageResult = {
  imageId: string;
  orderIndex: number;
  outputMimeType?: string;
  outputStorageKey: string;
  skipped: boolean;
};
type GeneratedClipResult = {
  callbackPending?: boolean;
  clipStorageKey: string;
  creditsConsumed?: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
  imageId: string;
  orderIndex: number;
  skipped: boolean;
  taskId?: string;
};
type MediaQcClipResult = {
  clipStorageKey: string;
  imageId: string;
  ok: boolean;
  orderIndex: number;
  promptType: string | null;
  report: MediaQcReport;
  skipped: boolean;
};

const IMAGE_REQUIREMENTS = getVideoImageRequirements();
const UPSCALING_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/upscaling.md",
);
const ENHANCEMENT_AGENT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/enhancement-agent.md",
);
const SINGLE_SHOT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/single-shot.md",
);
const REMOTION_ENTRY_POINT = path.resolve(
  process.cwd(),
  "../../packages/video/src/remotion-entry.tsx",
);
const KLING_SINGLE_SHOT_TEST_CONFIG = {
  aspectRatio: "16:9" as const,
  durationSeconds: 4,
  mode: "pro" as const,
  multiShots: false,
  sound: false,
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
    notes
      ? [
          "CLIENT NOTES:",
          "Use these notes only when they do not conflict with the reference image or the image-specific preservation brief.",
          notes,
        ].join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildClipStorageKey(enhancedStorageKey: string) {
  const clipKey = enhancedStorageKey.replace("/enhanced/", "/clips/");

  if (/\.[a-z0-9]+$/i.test(clipKey)) {
    return clipKey.replace(/\.[a-z0-9]+$/i, ".kling-3.0-pro.mp4");
  }

  return `${clipKey}.kling-3.0-pro.mp4`;
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

function getExistingMediaQc(analysis: Json | null) {
  if (!isJsonObject(analysis)) {
    return null;
  }

  const mediaQc = analysis.mediaQc;

  if (!isJsonObject(mediaQc)) {
    return null;
  }

  return {
    clipStorageKey:
      typeof mediaQc.clipStorageKey === "string"
        ? mediaQc.clipStorageKey
        : null,
    report: mediaQc as unknown as MediaQcReport,
    status: typeof mediaQc.status === "string" ? mediaQc.status : null,
  };
}

function getExistingEnhancementBrief(analysis: Json | null) {
  if (!isJsonObject(analysis)) {
    return null;
  }

  const enhancementBrief = analysis.enhancementBrief;

  if (!isJsonObject(enhancementBrief)) {
    return null;
  }

  return {
    promptInsert:
      typeof enhancementBrief.promptInsert === "string"
        ? enhancementBrief.promptInsert
        : null,
    sourceStorageKey:
      typeof enhancementBrief.sourceStorageKey === "string"
        ? enhancementBrief.sourceStorageKey
        : null,
  };
}

function mergeMediaQcAnalysis(analysis: Json | null, report: MediaQcReport) {
  const baseAnalysis = isJsonObject(analysis) ? analysis : {};

  return {
    ...baseAnalysis,
    mediaQc: report as unknown as Json,
  } satisfies Json;
}

function mergeEnhancementBriefAnalysis({
  analysis,
  promptPath,
  result,
}: {
  analysis: Json | null;
  promptPath: string;
  result: ImageEnhancementAnalysisResult;
}): Json {
  const baseAnalysis = isJsonObject(analysis) ? analysis : {};

  return {
    ...baseAnalysis,
    enhancementBrief: {
      brief: result.brief as unknown as Json,
      generatedAt: new Date().toISOString(),
      model: result.model,
      promptInsert: result.promptInsert,
      promptPath,
      provider: result.provider,
      sourceStorageKey: result.sourceStorageKey ?? null,
    },
  } as Json;
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
  targetResolution: "2K";
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

function hasSceneChangeAnalysis(report: MediaQcReport) {
  return Array.isArray(report.metrics?.sceneChangeSeconds);
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
      freezeFrames: skippedCheck,
      resolution: skippedCheck,
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
  imageId,
  projectId,
  sourceStorageKey,
}: {
  imageId: string;
  projectId: string;
  sourceStorageKey: string;
}) {
  return buildProviderJobKey([
    "project",
    projectId,
    "image",
    imageId,
    "upscaling",
    AI_PROVIDERS.imageEnhancement.model,
    sourceStorageKey,
    "2k",
    "16:9",
  ]);
}

function buildKlingProviderJobKey({
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
    KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
    KLING_SINGLE_SHOT_TEST_CONFIG.mode,
  ]);
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

      return {
        images: images ?? [],
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
          message: "Supervisor validation started.",
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
            "Supervisor validation completed. Ready for image enhancement.",
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
      const enhancementAgentPrompt = await step.run(
        "load-enhancement-agent-prompt",
        async () => loadPipelinePrompt("enhancement-agent"),
      );

      const upscalingPlan = await step.run("prepare-upscaling-plan", () => ({
        enhancementAgentPromptPath: ENHANCEMENT_AGENT_PROMPT_PATH,
        images: context.images.map((image) => ({
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
        provider: AI_PROVIDERS.imageEnhancement.primary,
        promptPath: UPSCALING_PROMPT_PATH,
        targetResolution: "2K",
      }));

      for (const image of context.images) {
        const enhancedImage = await step.run(
          `enhance-image-${image.order_index + 1}`,
          async () => {
            const supabase = createAdminClient();

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
            const existingEnhancementBrief =
              getExistingEnhancementBrief(image.analysis);
            let analysisForImage: Json | null = image.analysis;
            let preservationBriefPrompt: string | null = null;
            let preservationBriefSource: "generated" | "reused" = "generated";

            if (
              existingEnhancementBrief?.promptInsert &&
              existingEnhancementBrief.sourceStorageKey ===
                image.original_storage_key
            ) {
              preservationBriefPrompt = existingEnhancementBrief.promptInsert;
              preservationBriefSource = "reused";

              await writePipelineLog({
                message: `Image ${image.order_index + 1} reused its enhancement preservation brief.`,
                metadata: {
                  imageId: image.id,
                  promptPath: ENHANCEMENT_AGENT_PROMPT_PATH,
                  sourceStorageKey: image.original_storage_key,
                },
                projectId,
                status: "skipped",
                step: "enhancement_analysis",
              });
            } else {
              const analysisResult = await analyzeImageForEnhancement({
                prompt: enhancementAgentPrompt,
                sourceImage: sourceBytes,
                sourceMimeType,
                sourceStorageKey: image.original_storage_key,
              });

              preservationBriefPrompt = analysisResult.promptInsert;
              analysisForImage = mergeEnhancementBriefAnalysis({
                analysis: image.analysis,
                promptPath: ENHANCEMENT_AGENT_PROMPT_PATH,
                result: analysisResult,
              });

              const { error: analysisUpdateError } = await supabase
                .from("project_images")
                .update({
                  analysis: analysisForImage,
                })
                .eq("id", image.id);

              if (analysisUpdateError) {
                throw analysisUpdateError;
              }

              await writePipelineLog({
                message: `Image ${image.order_index + 1} analyzed for enhancement preservation locks.`,
                metadata: {
                  confidence: analysisResult.brief.confidence,
                  colorLockCount: analysisResult.brief.colorLocks.length,
                  imageId: image.id,
                  lightOffCount: analysisResult.brief.lighting.off.length,
                  lightOnCount: analysisResult.brief.lighting.on.length,
                  materialLockCount: analysisResult.brief.materialLocks.length,
                  model: analysisResult.model,
                  promptPath: ENHANCEMENT_AGENT_PROMPT_PATH,
                  provider: analysisResult.provider,
                  riskNoteCount: analysisResult.brief.riskNotes.length,
                  sourceStorageKey: image.original_storage_key,
                },
                projectId,
                status: "completed",
                step: "enhancement_analysis",
              });
            }

            const imageSpecificUpscalingPrompt = buildUpscalingPrompt({
              markdown: upscalingPrompt,
              notes: context.project.special_notes,
              preservationPrompt: preservationBriefPrompt,
            });
            const plannedOutputStorageKey = buildEnhancedStorageKey(
              image.original_storage_key,
              "image/png",
            );
            const providerJob = await ensureProviderJob({
              idempotencyKey: buildUpscalingProviderJobKey({
                imageId: image.id,
                projectId,
                sourceStorageKey: image.original_storage_key,
              }),
              model: AI_PROVIDERS.imageEnhancement.model,
              outputStorageKey: plannedOutputStorageKey,
              projectId,
              projectImageId: image.id,
              provider: AI_PROVIDERS.imageEnhancement.primary,
              request: {
                aspectRatio: "16:9",
                enhancementAgentPromptPath: ENHANCEMENT_AGENT_PROMPT_PATH,
                promptPath: UPSCALING_PROMPT_PATH,
                preservationBriefApplied: Boolean(preservationBriefPrompt),
                preservationBriefSource,
                sourceMimeType,
                sourceStorageKey: image.original_storage_key,
                targetResolution: "2K",
              },
              step: "upscaling",
            });

            if (!providerJob.created) {
              if (
                ["completed", "requires_manual_retry"].includes(
                  providerJob.job.status,
                ) &&
                providerJob.job.output_storage_key
              ) {
                const { error: existingOutputError } = await supabase.storage
                  .from(STORAGE_BUCKETS.sourceAssets)
                  .download(providerJob.job.output_storage_key);

                if (existingOutputError) {
                  const message = buildProviderResumeBlockMessage(
                    providerJob.job,
                  );

                  await writePipelineLog({
                    message,
                    metadata: {
                      imageId: image.id,
                      providerJobId: providerJob.job.id,
                      providerJobStatus: providerJob.job.status,
                      storageError: existingOutputError.message,
                    },
                    projectId,
                    status: "failed",
                    step: "upscaling",
                  });

                  throw new Error(message);
                }

                const { error: updateError } = await supabase
                  .from("project_images")
                  .update({
                    upscaled_storage_key: providerJob.job.output_storage_key,
                    video_status: "upscaled",
                  })
                  .eq("id", image.id);

                if (updateError) {
                  throw updateError;
                }

                if (providerJob.job.status !== "completed") {
                  await updateProviderJob(providerJob.job.id, {
                    completed_at: new Date().toISOString(),
                    status: "completed",
                  });
                }

                await writePipelineLog({
                  message: `Image ${image.order_index + 1} reused completed image enhancement provider job.`,
                  metadata: {
                    imageId: image.id,
                    outputStorageKey: providerJob.job.output_storage_key,
                    providerJobId: providerJob.job.id,
                  },
                  projectId,
                  status: "skipped",
                  step: "upscaling",
                });

                return {
                  imageId: image.id,
                  orderIndex: image.order_index,
                  outputStorageKey: providerJob.job.output_storage_key,
                  skipped: true,
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
                step: "upscaling",
              });

              throw new Error(message);
            }

            let result: Awaited<
              ReturnType<typeof enhanceImageWithNanoBananaPro>
            >;

            try {
              result = await enhanceImageWithNanoBananaPro({
                aspectRatio: "16:9",
                prompt: imageSpecificUpscalingPrompt,
                sourceImage: sourceBytes,
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

            const outputStorageKey = buildEnhancedStorageKey(
              image.original_storage_key,
              result.outputMimeType,
            );
            const outputArrayBuffer = result.outputImage.buffer.slice(
              result.outputImage.byteOffset,
              result.outputImage.byteOffset + result.outputImage.byteLength,
            ) as ArrayBuffer;

            try {
              const { error: uploadError } = await supabase.storage
                .from(STORAGE_BUCKETS.sourceAssets)
                .upload(
                  outputStorageKey,
                  new Blob([outputArrayBuffer], {
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
            } catch (error) {
              await updateProviderJob(providerJob.job.id, {
                error_message: getErrorMessage(error),
                output_storage_key: outputStorageKey,
                response: {
                  model: result.model,
                  outputBytes: result.outputImage.byteLength,
                  outputMimeType: result.outputMimeType,
                  provider: result.provider,
                  responseText: result.responseText ?? null,
                },
                status: "requires_manual_retry",
              });

              throw error;
            }

            await updateProviderJob(providerJob.job.id, {
              completed_at: new Date().toISOString(),
              output_storage_key: outputStorageKey,
              response: {
                model: result.model,
                outputBytes: result.outputImage.byteLength,
                outputMimeType: result.outputMimeType,
                provider: result.provider,
                responseText: result.responseText ?? null,
              },
              status: "completed",
            });

            await writePipelineLog({
              message: `Image ${image.order_index + 1} enhanced and stored.`,
              metadata: {
                imageId: image.id,
                outputMimeType: result.outputMimeType,
                outputStorageKey,
                provider: result.provider,
                providerJobId: providerJob.job.id,
                sourceStorageKey: image.original_storage_key,
              },
              projectId,
              status: "completed",
              step: "upscaling",
            });

            return {
              imageId: image.id,
              orderIndex: image.order_index,
              outputMimeType: result.outputMimeType,
              outputStorageKey,
              skipped: false,
            };
          },
        );

        enhancedImages.push(enhancedImage);
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
      enhancedImages.map((image) => [image.imageId, image.outputStorageKey]),
    );
    const videoImages = context.images
      .map((image) => ({
        ...image,
        upscaled_storage_key:
          image.upscaled_storage_key ??
          enhancedStorageKeys.get(image.id) ??
          null,
      }))
      .slice(0, 1);
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
      await step.run("start-video-generation", async () => {
      await updateProjectStatus(projectId, "generating_video");
      await writePipelineLog({
        message: "Kling video generation step started.",
        metadata: {
          imageCount: context.images.length,
          jobCount: videoImages.length,
          mode: "real",
          promptPath: SINGLE_SHOT_PROMPT_PATH,
          provider: AI_PROVIDERS.imageToVideo.primary,
          request: {
            aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
            callbackEnabled: shouldUseKieCallback,
            duration: String(KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds),
            mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
            multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
            sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
          },
        },
        projectId,
        status: "started",
        step: "video_generation",
      });
      });

      const singleShotPrompt = await step.run(
        "load-kling-single-shot-prompt",
        async () => loadPipelinePrompt("single-shot"),
      );

      for (const image of videoImages) {
      const taskPreparation = await step.run(
        `start-kling-clip-${image.order_index + 1}`,
        async () => {
          const supabase = createAdminClient();

          if (
            isExistingRealClip({
              videoStatus: image.video_status,
              videoStorageKey: image.video_storage_key,
            })
          ) {
            await writePipelineLog({
              message: `Image ${image.order_index + 1} already has a generated video clip. Skipping regeneration.`,
              metadata: {
                imageId: image.id,
                videoStorageKey: image.video_storage_key,
              },
              projectId,
              status: "skipped",
              step: "video_generation",
            });

            return {
              clipStorageKey: image.video_storage_key ?? "",
              imageId: image.id,
              orderIndex: image.order_index,
              skipped: true,
            };
          }

          if (!image.upscaled_storage_key) {
            throw new Error(
              `Image ${image.order_index + 1} has no enhanced storage key.`,
            );
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
          );
          const providerJob = await ensureProviderJob({
            idempotencyKey: buildKlingProviderJobKey({
              clipStorageKey,
              imageId: image.id,
              projectId,
            }),
            model: "kling-3.0/video",
            outputStorageKey: clipStorageKey,
            projectId,
            projectImageId: image.id,
            provider: AI_PROVIDERS.imageToVideo.primary,
            request: {
              aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
              callbackEnabled: shouldUseKieCallback,
              durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
              imageStorageKey: image.upscaled_storage_key,
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
              promptPath: SINGLE_SHOT_PROMPT_PATH,
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
                clipStorageKey: providerJob.job.output_storage_key,
                imageId: image.id,
                orderIndex: image.order_index,
                skipped: true,
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
                clipStorageKey:
                  providerJob.job.output_storage_key ?? clipStorageKey,
                durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
                imageId: image.id,
                orderIndex: image.order_index,
                providerJobId: providerJob.job.id,
                skipped: false,
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
              durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
              imageUrls: [signedImage.signedUrl],
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
              prompt: singleShotPrompt,
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
              durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
              imageId: image.id,
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              model: "kling-3.0/video",
              multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
              promptPath: SINGLE_SHOT_PROMPT_PATH,
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
            clipStorageKey,
            durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
            imageId: image.id,
            orderIndex: image.order_index,
            providerJobId: providerJob.job.id,
            taskId: task.taskId,
            skipped: false,
          };
        },
      );

      if (taskPreparation.skipped) {
        generatedClips.push({
          clipStorageKey: taskPreparation.clipStorageKey ?? "",
          imageId: taskPreparation.imageId,
          orderIndex: taskPreparation.orderIndex,
          skipped: true,
        });
        continue;
      }

      if (
        "callbackPending" in taskPreparation &&
        taskPreparation.callbackPending
      ) {
        generatedClips.push({
          callbackPending: true,
          clipStorageKey: taskPreparation.clipStorageKey ?? "",
          durationSeconds: taskPreparation.durationSeconds,
          imageId: taskPreparation.imageId,
          orderIndex: taskPreparation.orderIndex,
          skipped: false,
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
        clipStorageKey: taskPreparation.clipStorageKey,
        durationSeconds: taskPreparation.durationSeconds,
        imageId: taskPreparation.imageId,
        orderIndex: taskPreparation.orderIndex,
        providerJobId: taskPreparation.providerJobId,
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

            const contentType = getVideoContentType(resultResponse);
            const clipBytes = await resultResponse.arrayBuffer();

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
                durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
                fileSizeBytes: clipBytes.byteLength,
                imageId: image.id,
                mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
                model: taskRecord.model ?? "kling-3.0/video",
                provider: AI_PROVIDERS.imageToVideo.primary,
                providerJobId: activeTask.providerJobId,
                taskId: activeTask.taskId,
              },
              projectId,
              status: "completed",
              step: "video_generation",
            });

            return {
              clipStorageKey: activeTask.clipStorageKey,
              creditsConsumed: taskRecord.creditsConsumed,
              durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
              fileSizeBytes: clipBytes.byteLength,
              imageId: image.id,
              orderIndex: image.order_index,
              skipped: false,
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
          imageCount: context.images.length,
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
            mode: "real",
            nextStatus: "media_qc",
            promptPath: SINGLE_SHOT_PROMPT_PATH,
            provider: AI_PROVIDERS.imageToVideo.primary,
          },
          projectId,
          status: "completed",
          step: "video_generation",
        });
      });
    }

    const mediaQcImages = await step.run("load-media-qc-clips", async () => {
      const supabase = createAdminClient();
      const { data: images, error } = await supabase
        .from("project_images")
        .select(
          "id, analysis, prompt_type, video_storage_key, video_status, order_index",
        )
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });

      if (error) {
        throw error;
      }

      return (images ?? []).filter((image) =>
        isExistingRealClip({
          videoStatus: image.video_status,
          videoStorageKey: image.video_storage_key,
        }),
      );
    });
    const mediaQcClipResults: MediaQcClipResult[] = [];

    if (mediaQcImages.length === 0) {
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
        imageCount: context.images.length,
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
          clipCount: mediaQcImages.length,
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

    for (const image of mediaQcImages) {
      const mediaQcResult = await step.run(
        `media-qc-clip-${image.order_index + 1}`,
        async () => {
          const supabase = createAdminClient();
          const clipStorageKey = image.video_storage_key ?? "";
          const generatedClip = generatedClips.find(
            (clip) => clip.clipStorageKey === clipStorageKey,
          );
          const expectedDurationSeconds =
            generatedClip?.durationSeconds ??
            KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds;
          const existingMediaQc = getExistingMediaQc(image.analysis);

          if (
            existingMediaQc?.status === "passed" &&
            existingMediaQc.clipStorageKey === clipStorageKey &&
            hasSceneChangeAnalysis(existingMediaQc.report)
          ) {
            if (image.video_status !== MEDIA_QC_PASSED_VIDEO_STATUS) {
              const { error: updateError } = await supabase
                .from("project_images")
                .update({
                  video_status: MEDIA_QC_PASSED_VIDEO_STATUS,
                })
                .eq("id", image.id);

              if (updateError) {
                throw updateError;
              }
            }

            await writePipelineLog({
              message: `Clip ${image.order_index + 1} already passed media QC. Skipping re-inspection.`,
              metadata: {
                clipStorageKey,
                imageId: image.id,
              },
              projectId,
              status: "skipped",
              step: "media_qc",
            });

            return {
              clipStorageKey,
              imageId: image.id,
              ok: true,
              orderIndex: image.order_index,
              promptType: image.prompt_type,
              report: existingMediaQc.report,
              skipped: true,
            };
          }

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
            .eq("id", image.id);

          if (updateError) {
            throw updateError;
          }

          await writePipelineLog({
            message: ok
              ? `Clip ${image.order_index + 1} passed media QC.`
              : `Clip ${image.order_index + 1} failed media QC.`,
            metadata: {
              clipStorageKey,
              imageId: image.id,
              report: report as unknown as Json,
            },
            projectId,
            status: ok ? "completed" : "failed",
            step: "media_qc",
          });

          return {
            clipStorageKey,
            imageId: image.id,
            ok,
            orderIndex: image.order_index,
            promptType: image.prompt_type,
            report,
            skipped: false,
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
        imageCount: context.images.length,
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
      music: await loadPipelinePrompt("music").catch(() => ""),
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
          clipStorageKey: clip.clipStorageKey,
          durationSeconds: clip.report.metrics.durationSeconds,
          imageId: clip.imageId,
          orderIndex: clip.orderIndex,
          promptType: clip.promptType,
          sceneChangeSeconds: clip.report.metrics.sceneChangeSeconds,
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
    const storyPlan = await step.run("build-editor-story-plan", async () => {
      const plan = buildEditorStoryPlan({
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
    const musicContext = await step.run("load-music-context", async () => {
      const supabase = createAdminClient();

      if (context.project.music_genre === "no_music") {
        return {
          durationSeconds: null,
          name: null,
          storageKey: null,
        };
      }

      const { data, error } = await supabase
        .from("music_tracks")
        .select("duration_seconds, file_storage_key, name")
        .eq("genre", context.project.music_genre)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return {
        durationSeconds: data?.duration_seconds ?? null,
        name: data?.name ?? null,
        storageKey: data?.file_storage_key ?? null,
      };
    });
    const musicPlan = await step.run("build-music-instruction-plan", async () => {
      const plan = buildMusicInstructionPlan({
        musicGenre: context.project.music_genre,
        trackDurationSeconds: musicContext.durationSeconds,
        trackName: musicContext.name,
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
          ? "Music instruction plan loaded for the selected track."
          : "Music instruction plan prepared without a configured music file.",
        metadata: {
          musicInstructionsLoaded: Boolean(editorInstructions.music),
          plan: plan as unknown as Json,
          storageKey,
        },
        projectId,
        status: "completed",
        step: "music",
      });

      return plan;
    });
    const finalEditPlan = await step.run("build-final-edit-plan", async () => {
      const plan = buildFinalEditPlan({
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
      const logoSignedUrl = context.project.customer_logo_storage_key
        ? await createSignedStorageUrl({
            bucket: STORAGE_BUCKETS.sourceAssets,
            expiresInSeconds: 60 * 60,
            storageKey: context.project.customer_logo_storage_key,
          })
        : null;
      const manifest = buildSalesPitchRenderManifest({
        clipSignedUrls,
        editPlan: finalEditPlan,
        logoSignedUrl,
        musicSignedUrl,
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
        imageCount: context.images.length,
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
      imageCount: context.images.length,
      ok: true,
      projectId,
      status: "completed",
    };
  },
);
