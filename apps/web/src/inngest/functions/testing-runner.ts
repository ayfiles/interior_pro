import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  type ArchitecturalKlingMultiPromptVariant,
  buildArchitecturalKlingMultiPrompt,
  classifyImagesForKlingModes,
  createKieKling30Task,
  enhanceImageWithKieNanoBananaPro,
  generateVoiceoverAudio,
  getKieTaskRecord,
  PIPELINE_MAX_RETRIES,
  PIPELINE_VALIDATOR_CASCADE_ENABLED,
  resizeForValidation,
  runMediaQcOnVideoBytes,
  stabilizeVideoBytes,
  validateOutput,
} from "@interior-pro/pipeline";
import {
  buildClipSegmentsFromSources,
  buildEditorStoryPlan,
  buildFinalEditPlan,
  buildMusicInstructionPlan,
  buildSalesPitchRenderManifest,
  buildVoiceoverPlan,
  renderSalesPitchVideo,
  type SalesPitchRenderManifest,
  type VideoLengthProfile,
} from "@interior-pro/video";
import { AI_PROVIDERS } from "@interior-pro/shared";
import path from "node:path";
import { inngest, TESTING_RUN_QUEUED_EVENT } from "@/inngest/client";
import { loadPipelinePrompt } from "@/lib/admin/prompts";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

type TestStep =
  | "image_upscaler"
  | "video_agent"
  | "kling_video"
  | "media_qc"
  | "editor_agent"
  | "voice_music"
  | "remotion_render";
type KlingGenerationMode = "single_shot" | "multi_shot";

interface TestingAsset {
  bucket: string;
  content_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  id: string;
  kind: string;
  metadata: Json;
  storage_key: string;
}

interface TestingRunContext {
  assets: TestingAsset[];
  config: Record<string, unknown>;
  run: {
    id: string;
    name: string;
    run_mode: string;
    target_step: string;
  };
}

const TEST_STEP_ORDER: TestStep[] = [
  "image_upscaler",
  "video_agent",
  "kling_video",
  "media_qc",
  "editor_agent",
  "voice_music",
  "remotion_render",
];
const KLING_TEST_CONFIG = {
  aspectRatio: "16:9" as const,
  mode: "pro" as const,
  sound: false,
};
const KLING_DURATION_SECONDS_BY_MODE: Record<KlingGenerationMode, number> = {
  multi_shot: 10,
  single_shot: 5,
};
const KLING_POLL_INTERVAL_MS = 10_000;
const KLING_MAX_POLLS = 90;
const TESTING_IMAGE_CONCURRENCY = Number(
  process.env.TESTING_IMAGE_CONCURRENCY ?? 3,
);
const TESTING_KLING_CONCURRENCY = Number(
  process.env.TESTING_KLING_CONCURRENCY ?? 2,
);

async function mapWithConcurrency<T, R>({
  concurrency,
  items,
  worker,
}: {
  concurrency: number;
  items: T[];
  worker: (item: T, index: number) => Promise<R>;
}) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;

        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function inferImageMimeType(storageKey: string, contentType: string | null) {
  if (contentType?.startsWith("image/")) {
    return contentType;
  }

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

function extensionForContentType(contentType: string) {
  if (contentType === "image/jpeg") {
    return "jpg";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  if (contentType === "audio/mpeg") {
    return "mp3";
  }

  if (contentType === "audio/wav") {
    return "wav";
  }

  if (contentType === "video/mp4") {
    return "mp4";
  }

  if (contentType === "video/quicktime") {
    return "mov";
  }

  return "json";
}

function getVideoContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";")[0];

  if (contentType?.startsWith("video/")) {
    return contentType;
  }

  return "video/mp4";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testingOutputKey({
  extension,
  name,
  runId,
  step,
}: {
  extension: string;
  name: string;
  runId: string;
  step: string;
}) {
  return `testing/${runId}/outputs/${step}/${name}.${extension}`;
}

function normalizeTestStep(
  targetStep: string,
): TestStep | "full_pipeline" | null {
  if (targetStep === "full_pipeline") {
    return "full_pipeline";
  }

  if (targetStep === "enhancement_agent") {
    return "image_upscaler";
  }

  const step = targetStep as TestStep;

  if (!TEST_STEP_ORDER.includes(step)) {
    return null;
  }

  return step;
}

function getStepsForRun(targetStep: string, runMode: string): TestStep[] {
  const step = normalizeTestStep(targetStep);

  if (step === "full_pipeline") {
    return TEST_STEP_ORDER;
  }

  if (!step) {
    return [];
  }

  if (runMode === "from_step") {
    return TEST_STEP_ORDER.slice(TEST_STEP_ORDER.indexOf(step));
  }

  return [step];
}

function assetsByKind(assets: TestingAsset[], kind: string) {
  return assets.filter((asset) => asset.kind === kind);
}

async function loadTestingRunAssets(runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("testing_run_assets")
    .select(
      "id, kind, bucket, storage_key, file_name, content_type, file_size_bytes, metadata",
    )
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as TestingAsset[];
}

async function refreshTestingAssets(context: TestingRunContext) {
  context.assets = await loadTestingRunAssets(context.run.id);
  return context.assets;
}

function expectedDurationSecondsForClip(
  context: TestingRunContext,
  clip: TestingAsset,
) {
  if (
    isJsonObject(clip.metadata) &&
    typeof clip.metadata.durationSeconds === "number"
  ) {
    return clip.metadata.durationSeconds;
  }

  return typeof context.config.expectedDurationSeconds === "number"
    ? context.config.expectedDurationSeconds
    : null;
}

function normalizeKlingGenerationMode(value: unknown): KlingGenerationMode | null {
  return value === "single_shot" || value === "multi_shot" ? value : null;
}

function generationModeFromDecision(value: unknown): KlingGenerationMode | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const rawMode = value.selectedMode ?? value.mode ?? value.promptType;
  return normalizeKlingGenerationMode(rawMode);
}

function multiShotVariantForIndex(
  multiShotIndex: number,
): ArchitecturalKlingMultiPromptVariant {
  return multiShotIndex === 0 ? "five_scene" : "three_scene";
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

function multiShotVariantFromAsset(
  asset: TestingAsset,
): ArchitecturalKlingMultiPromptVariant | null {
  if (
    !isJsonObject(asset.metadata) ||
    (asset.metadata.multiShotVariant !== "five_scene" &&
      asset.metadata.multiShotVariant !== "three_scene")
  ) {
    return null;
  }

  return asset.metadata.multiShotVariant;
}

interface TestingKlingClipPlanItem {
  clipId: string;
  duplicateIndex: number;
  generationMode: KlingGenerationMode;
  image: TestingAsset;
  multiShotVariant: ArchitecturalKlingMultiPromptVariant | null;
}

function perspectiveScoreFromContext(context: TestingRunContext, image: TestingAsset) {
  const result = context.config.videoAgentResult;

  if (!isJsonObject(result) || !Array.isArray(result.decisions)) {
    return 5;
  }

  const decision = result.decisions.find(
    (item) => isJsonObject(item) && item.imageId === image.id,
  );

  return isJsonObject(decision) && typeof decision.perspectiveScore === "number"
    ? decision.perspectiveScore
    : 5;
}

function buildTestingKlingClipPlan({
  context,
  images,
  requestedMode,
}: {
  context: TestingRunContext;
  images: TestingAsset[];
  requestedMode: KlingGenerationMode | null;
}): TestingKlingClipPlanItem[] {
  if (requestedMode) {
    let multiShotIndex = 0;

    return images.map((image, index) => {
      const multiShotVariant =
        requestedMode === "multi_shot"
          ? multiShotVariantForIndex(multiShotIndex)
          : null;

      if (requestedMode === "multi_shot") {
        multiShotIndex += 1;
      }

      return {
        clipId: `image-${index + 1}-${requestedMode}`,
        duplicateIndex: 1,
        generationMode: requestedMode,
        image,
        multiShotVariant,
      };
    });
  }

  const rankedImages = [...images].sort(
    (a, b) =>
      perspectiveScoreFromContext(context, b) -
        perspectiveScoreFromContext(context, a) ||
      images.indexOf(a) - images.indexOf(b),
  );
  const rankByImageId = new Map(
    rankedImages.map((image, index) => [image.id, index]),
  );
  const duplicateCount =
    images.length <= 3 ? images.length : Math.max(0, 8 - images.length);
  const plan: TestingKlingClipPlanItem[] = [];

  for (const [index, image] of images.entries()) {
    const rank = rankByImageId.get(image.id) ?? images.length;
    const repeats = 1 + (rank < duplicateCount ? 1 : 0);

    for (let duplicateIndex = 1; duplicateIndex <= repeats; duplicateIndex += 1) {
      plan.push({
        clipId: `image-${index + 1}-single-${duplicateIndex}`,
        duplicateIndex,
        generationMode: "single_shot",
        image,
        multiShotVariant: null,
      });
    }
  }

  for (const [index, image] of rankedImages.slice(0, Math.min(2, images.length)).entries()) {
    plan.push({
      clipId: `image-${images.indexOf(image) + 1}-multi-${index + 1}`,
      duplicateIndex: 1,
      generationMode: "multi_shot",
      image,
      multiShotVariant: multiShotVariantForIndex(index),
    });
  }

  return plan;
}

function transientProviderError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return (
    message.includes("503") ||
    message.includes("temporarily") ||
    message.includes("temporary") ||
    message.includes("high demand") ||
    message.includes("rate limit") ||
    message.includes("overloaded") ||
    message.includes("unavailable")
  );
}

function providerErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Provider request failed.";
}

async function runWithTransientProviderRetry<T>({
  label,
  operation,
  runId,
  step,
}: {
  label: string;
  operation: () => Promise<T>;
  runId: string;
  step: string;
}) {
  const delaysMs = [5_000, 12_000, 25_000];

  for (let attempt = 1; attempt <= delaysMs.length + 1; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!transientProviderError(error) || attempt > delaysMs.length) {
        throw error;
      }

      const delayMs = delaysMs[attempt - 1];
      await writeTestingLog({
        message: `${label} hit a transient provider error; retrying in ${Math.round(
          delayMs / 1000,
        )}s.`,
        metadata: {
          attempt,
          delayMs,
          errorMessage: providerErrorMessage(error),
          maxAttempts: delaysMs.length + 1,
        },
        runId,
        status: "info",
        step,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${label} failed after retries.`);
}

async function writeTestingLog({
  message,
  metadata = {},
  runId,
  status,
  step,
}: {
  message: string;
  metadata?: Json;
  runId: string;
  status: "started" | "completed" | "failed" | "skipped" | "info";
  step: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("testing_run_logs").insert({
    message,
    metadata,
    run_id: runId,
    status,
    step,
  });

  if (error) {
    throw error;
  }
}

async function downloadAsset(asset: TestingAsset) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(asset.bucket)
    .download(asset.storage_key);

  if (error) {
    throw error;
  }

  return new Uint8Array(await data.arrayBuffer());
}

async function createSignedAssetUrl(asset: TestingAsset, expiresInSeconds = 60 * 60) {
  return createSignedStorageUrl(asset.bucket, asset.storage_key, expiresInSeconds);
}

async function createSignedStorageUrl(
  bucket: string,
  storageKey: string,
  expiresInSeconds = 60 * 60,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw error ?? new Error(`Could not sign asset ${storageKey}.`);
  }

  return data.signedUrl;
}

async function uploadTestingOutput({
  bucket,
  contentType,
  fileName,
  kind,
  label,
  metadata = {},
  runId,
  step,
  value,
}: {
  bucket: (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];
  contentType: string;
  fileName: string;
  kind: string;
  label: string;
  metadata?: Json;
  runId: string;
  step: string;
  value: Blob | Uint8Array | string;
}) {
  const admin = createAdminClient();
  const extension =
    fileName.split(".").pop() ?? extensionForContentType(contentType);
  const storageKey = testingOutputKey({
    extension,
    name: fileName.replace(/\.[^.]+$/, ""),
    runId,
    step,
  });
  const body =
    typeof value === "string"
      ? new Blob([value], { type: contentType })
      : value instanceof Uint8Array
        ? new Blob([bytesToArrayBuffer(value)], { type: contentType })
        : value;
  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(storageKey, body, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const fileSizeBytes =
    typeof value === "string"
      ? Buffer.byteLength(value)
      : value instanceof Uint8Array
        ? value.byteLength
        : value.size;
  const { data: output, error: outputError } = await admin
    .from("testing_run_outputs")
    .insert({
      bucket,
      content_type: contentType,
      file_size_bytes: fileSizeBytes,
      kind,
      label,
      metadata,
      run_id: runId,
      storage_key: storageKey,
    })
    .select("id")
    .single();

  if (outputError) {
    throw outputError;
  }

  return {
    id: output.id,
    storageKey,
  };
}

async function insertAssetFromOutput({
  bucket,
  contentType,
  fileName,
  fileSizeBytes,
  kind,
  metadata = {},
  runId,
  storageKey,
}: {
  bucket: string;
  contentType: string;
  fileName: string;
  fileSizeBytes: number;
  kind: string;
  metadata?: Json;
  runId: string;
  storageKey: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("testing_run_assets")
    .insert({
      bucket,
      content_type: contentType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      kind,
      metadata,
      run_id: runId,
      storage_key: storageKey,
    })
    .select(
      "id, kind, bucket, storage_key, file_name, content_type, file_size_bytes, metadata",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as TestingAsset;
}

async function uploadJsonResult({
  label,
  name,
  runId,
  step,
  value,
}: {
  label: string;
  name: string;
  runId: string;
  step: string;
  value: Json;
}) {
  return uploadTestingOutput({
    bucket: STORAGE_BUCKETS.finalOutputs,
    contentType: "application/json",
    fileName: `${name}.json`,
    kind: "json",
    label,
    runId,
    step,
    value: JSON.stringify(value, null, 2),
  });
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
  return [markdown, preservationPrompt, notes ? `TEST NOTES:\n${notes}` : null]
    .filter(Boolean)
    .join("\n\n");
}

async function runImageUpscaler(context: TestingRunContext) {
  const sourceImages = assetsByKind(context.assets, "source_image");

  if (!sourceImages.length) {
    await writeTestingLog({
      message:
        "Nano Banana Pro Upscaler skipped because no source images were uploaded.",
      runId: context.run.id,
      status: "skipped",
      step: "image_upscaler",
    });
    return [];
  }

  const promptOverride =
    typeof context.config.promptOverride === "string" &&
    context.config.promptOverride.trim()
      ? context.config.promptOverride.trim()
      : null;
  const upscalingPrompt =
    promptOverride ?? (await loadPipelinePrompt("upscaling"));
  const validatorPrompt = await loadPipelinePrompt("validator");
  const notes =
    typeof context.config.notes === "string" ? context.config.notes : null;

  await writeTestingLog({
    message: `Nano Banana Pro Upscaler started for ${sourceImages.length} image(s) with validator retry.`,
    metadata: {
      directPrompt: true,
      enhancementAgentEnabled: false,
      model: AI_PROVIDERS.imageEnhancement.model,
      promptSource: promptOverride ? "override" : "upscaling",
      provider: AI_PROVIDERS.imageEnhancement.primary,
      retryLimit: PIPELINE_MAX_RETRIES,
      targetResolution: "2K",
      validatorCascadeEnabled: PIPELINE_VALIDATOR_CASCADE_ENABLED,
    },
    runId: context.run.id,
    status: "started",
    step: "image_upscaler",
  });

  const results = await mapWithConcurrency({
    concurrency: TESTING_IMAGE_CONCURRENCY,
    items: sourceImages,
    worker: async (image, index) => {
    const sourceImage = await downloadAsset(image);
    const sourceMimeType = inferImageMimeType(
      image.storage_key,
      image.content_type,
    );
    const inputResized = await resizeForValidation(sourceImage);

    for (let attempt = 1; attempt <= PIPELINE_MAX_RETRIES; attempt += 1) {
      const result = await runWithTransientProviderRetry({
        label: `Image upscale ${index + 1} attempt ${attempt}`,
        operation: async () =>
          enhanceImageWithKieNanoBananaPro({
            aspectRatio: "16:9",
            prompt: buildUpscalingPrompt({
              markdown: upscalingPrompt,
              notes,
              preservationPrompt: null,
            }),
            sourceImage,
            sourceImageUrl: await createSignedAssetUrl(image),
            sourceMimeType,
            sourceStorageKey: image.storage_key,
            targetResolution: "2K",
          }),
        runId: context.run.id,
        step: "image_upscaler",
      });
      const outputResized = await resizeForValidation(result.outputImage);
      const validatorResponse = await validateOutput({
        cascadeEnabled: PIPELINE_VALIDATOR_CASCADE_ENABLED,
        inputImage: inputResized.data,
        inputMimeType: inputResized.mimeType,
        outputImage: outputResized.data,
        outputMimeType: outputResized.mimeType,
        prompt: validatorPrompt,
      });
      const accepted =
        validatorResponse.result.overall_decision === "ACCEPT" ||
        validatorResponse.result.overall_decision === "ACCEPT_WITH_WARNING";

      await writeTestingLog({
        message: accepted
          ? `Image ${index + 1} accepted by validator on attempt ${attempt}.`
          : `Image ${index + 1} rejected by validator on attempt ${attempt}.`,
        metadata: {
          attempt,
          cascadeRan: validatorResponse.cascadeRan,
          claudeResult: validatorResponse.claudeResult as unknown as Json,
          decision: validatorResponse.result.overall_decision,
          failures: validatorResponse.result.critical_failures,
          geminiResult: validatorResponse.geminiResult as unknown as Json,
          taskId: result.taskId ?? null,
        },
        runId: context.run.id,
        status: accepted ? "completed" : "failed",
        step: "image_upscaler",
      });

      if (!accepted) {
        continue;
      }

      const extension = extensionForContentType(result.outputMimeType);
      const fileName = `upscaled-${index + 1}.${extension}`;
      const output = await uploadTestingOutput({
        bucket: STORAGE_BUCKETS.sourceAssets,
        contentType: result.outputMimeType,
        fileName,
        kind: "enhanced_image",
        label: `Upscaled image ${index + 1}`,
        metadata: {
          directPrompt: true,
          enhancementAgentEnabled: false,
          model: result.model,
          outputHeight: result.finalHeight ?? null,
          outputWidth: result.finalWidth ?? null,
          promptSource: promptOverride ? "override" : "upscaling",
          provider: result.provider,
          sourceStorageKey: image.storage_key,
          targetResolution: "2K",
          taskId: result.taskId ?? null,
          validation: {
            cascadeRan: validatorResponse.cascadeRan,
            claudeResult: validatorResponse.claudeResult as unknown as Json,
            decision: validatorResponse.result.overall_decision,
            geminiResult: validatorResponse.geminiResult as unknown as Json,
          },
        },
        runId: context.run.id,
        step: "image_upscaler",
        value: result.outputImage,
      });

      return insertAssetFromOutput({
        bucket: STORAGE_BUCKETS.sourceAssets,
        contentType: result.outputMimeType,
        fileName,
        fileSizeBytes: result.outputImage.byteLength,
        kind: "enhanced_image",
        metadata: {
          directPrompt: true,
          enhancementAgentEnabled: false,
          generatedByStep: "image_upscaler",
          outputId: output.id,
          outputHeight: result.finalHeight ?? null,
          outputWidth: result.finalWidth ?? null,
          sourceStorageKey: image.storage_key,
          targetResolution: "2K",
          taskId: result.taskId ?? null,
        },
        runId: context.run.id,
        storageKey: output.storageKey,
      });
    }

    await writeTestingLog({
      message: `Image ${index + 1} dropped after ${PIPELINE_MAX_RETRIES} rejected validator attempt(s).`,
      metadata: {
        retryLimit: PIPELINE_MAX_RETRIES,
        sourceStorageKey: image.storage_key,
      },
      runId: context.run.id,
      status: "failed",
      step: "image_upscaler",
    });

    return null;
    },
  });
  const outputs = results.filter((asset): asset is TestingAsset => asset !== null);

  if (outputs.length === 0) {
    throw new Error("All upscaled images were rejected by the validator.");
  }

  await writeTestingLog({
    message: `Nano Banana Pro Upscaler completed ${outputs.length} image(s).`,
    runId: context.run.id,
    status: "completed",
    step: "image_upscaler",
  });

  context.assets.push(...outputs);
  return outputs;
}

async function runVideoAgent(context: TestingRunContext) {
  const images = assetsByKind(context.assets, "enhanced_image").length
    ? assetsByKind(context.assets, "enhanced_image")
    : assetsByKind(context.assets, "source_image");

  if (!images.length) {
    await writeTestingLog({
      message:
        "Video Agent skipped because no enhanced or source images were available.",
      runId: context.run.id,
      status: "skipped",
      step: "video_agent",
    });
    return null;
  }

  await writeTestingLog({
    message: `Video Agent started for ${images.length} image(s).`,
    runId: context.run.id,
    status: "started",
    step: "video_agent",
  });

  const prompt = await loadPipelinePrompt("agent");
  const result = await classifyImagesForKlingModes({
    images: await Promise.all(
      images.map(async (image, index) => ({
        enhancedImage: await downloadAsset(image),
        enhancedStorageKey: image.storage_key,
        imageId: image.id,
        orderIndex: index,
        sourceMimeType: inferImageMimeType(
          image.storage_key,
          image.content_type,
        ),
      })),
    ),
    prompt,
  });

  await uploadJsonResult({
    label: "Video Agent decisions",
    name: "video-agent-decisions",
    runId: context.run.id,
    step: "video_agent",
    value: result as unknown as Json,
  });
  await writeTestingLog({
    message: "Video Agent completed Kling mode assignment.",
    metadata: {
      model: result.model,
      provider: result.provider,
      summary: result.summary,
    },
    runId: context.run.id,
    status: "completed",
    step: "video_agent",
  });

  context.config.videoAgentResult = result;

  return result;
}

async function runMediaQc(context: TestingRunContext) {
  const clips = assetsByKind(context.assets, "video_clip");

  if (!clips.length) {
    await writeTestingLog({
      message: "Media QC skipped because no video clips were uploaded.",
      runId: context.run.id,
      status: "skipped",
      step: "media_qc",
    });
    return [];
  }

  const results = [];

  await writeTestingLog({
    message: `Media QC started for ${clips.length} clip(s).`,
    runId: context.run.id,
    status: "started",
    step: "media_qc",
  });

  for (const [index, clip] of clips.entries()) {
    const report = await runMediaQcOnVideoBytes({
      clipStorageKey: clip.storage_key,
      expectedDurationSeconds: expectedDurationSecondsForClip(context, clip),
      videoBytes: await downloadAsset(clip),
    });

    results.push({
      clip,
      report,
    });
    await uploadJsonResult({
      label: `Media QC report ${index + 1}`,
      name: `media-qc-report-${index + 1}`,
      runId: context.run.id,
      step: "media_qc",
      value: report as unknown as Json,
    });
  }

  await writeTestingLog({
    message: `Media QC completed ${results.length} report(s).`,
    metadata: {
      failed: results.filter((result) => result.report.status !== "passed")
        .length,
      passed: results.filter((result) => result.report.status === "passed")
        .length,
    },
    runId: context.run.id,
    status: "completed",
    step: "media_qc",
  });

  return results;
}

async function resolveKlingModes(
  context: TestingRunContext,
  images: TestingAsset[],
) {
  const requestedMode = normalizeKlingGenerationMode(context.config.klingMode);
  const modes = new Map<string, KlingGenerationMode>();

  if (requestedMode) {
    for (const image of images) {
      modes.set(image.id, requestedMode);
    }

    return modes;
  }

  const existingResult = context.config.videoAgentResult;

  if (
    isJsonObject(existingResult) &&
    Array.isArray(existingResult.decisions)
  ) {
    for (const decision of existingResult.decisions) {
      if (!isJsonObject(decision) || typeof decision.imageId !== "string") {
        continue;
      }

      const mode = generationModeFromDecision(decision);

      if (mode) {
        modes.set(decision.imageId, mode);
      }
    }

    if (images.every((image) => modes.has(image.id))) {
      return modes;
    }
  }

  const prompt = await loadPipelinePrompt("agent");
  const result = await classifyImagesForKlingModes({
    images: await Promise.all(
      images.map(async (image, index) => ({
        enhancedImage: await downloadAsset(image),
        enhancedStorageKey: image.storage_key,
        imageId: image.id,
        orderIndex: index,
        sourceMimeType: inferImageMimeType(
          image.storage_key,
          image.content_type,
        ),
      })),
    ),
    prompt,
  });

  context.config.videoAgentResult = result;
  await uploadJsonResult({
    label: "Kling auto mode decisions",
    name: "kling-auto-mode-decisions",
    runId: context.run.id,
    step: "kling_video",
    value: result as unknown as Json,
  });
  await writeTestingLog({
    message: "Kling Video auto-selected generation modes with the Video Agent.",
    metadata: {
      model: result.model,
      provider: result.provider,
      summary: result.summary,
    },
    runId: context.run.id,
    status: "completed",
    step: "video_agent",
  });

  for (const decision of result.decisions) {
    modes.set(decision.imageId, decision.selectedMode);
  }

  return modes;
}

async function pollKieKlingTask({
  imageIndex,
  runId,
  taskId,
}: {
  imageIndex: number;
  runId: string;
  taskId: string;
}) {
  let lastState = "unknown";

  for (let pollIndex = 1; pollIndex <= KLING_MAX_POLLS; pollIndex += 1) {
    const record = await getKieTaskRecord(taskId);
    lastState = record.state;

    if (
      pollIndex === 1 ||
      pollIndex % 6 === 0 ||
      record.state === "success" ||
      record.state === "fail" ||
      record.state === "failed"
    ) {
      await writeTestingLog({
        message: `Kling clip ${imageIndex + 1} is ${record.state}.`,
        metadata: {
          creditsConsumed: record.creditsConsumed ?? null,
          pollIndex,
          progress: record.progress ?? null,
          taskId,
        },
        runId,
        status: "info",
        step: "kling_video",
      });
    }

    if (record.state === "success") {
      return record;
    }

    if (record.state === "fail" || record.state === "failed") {
      throw new Error(
        `Kling task ${taskId} failed: ${
          record.failMsg ?? record.failCode ?? "unknown error"
        }`,
      );
    }

    if (pollIndex < KLING_MAX_POLLS) {
      await sleep(KLING_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Kling task ${taskId} timed out after ${
      (KLING_MAX_POLLS * KLING_POLL_INTERVAL_MS) / 1000
    } seconds. Last state: ${lastState}.`,
  );
}

async function runKlingVideo(context: TestingRunContext) {
  const images = assetsByKind(context.assets, "enhanced_image").length
    ? assetsByKind(context.assets, "enhanced_image")
    : assetsByKind(context.assets, "source_image");

  if (!images.length) {
    await writeTestingLog({
      message:
        "Kling Video skipped because no enhanced or source images were available.",
      runId: context.run.id,
      status: "skipped",
      step: "kling_video",
    });
    return [];
  }

  const promptOverride =
    typeof context.config.promptOverride === "string" &&
    context.config.promptOverride.trim()
      ? context.config.promptOverride.trim()
      : null;
  const prompts: Record<
    KlingGenerationMode | "multi_shot_three_scene",
    string
  > = {
    multi_shot: promptOverride ?? (await loadPipelinePrompt("multi-shot")),
    multi_shot_three_scene:
      promptOverride ?? (await loadPipelinePrompt("multi-shot-three-scene")),
    single_shot: promptOverride ?? (await loadPipelinePrompt("single-shot")),
  };
  await resolveKlingModes(context, images);
  const requestedKlingMode =
    typeof context.config.klingMode === "string"
      ? context.config.klingMode
      : "auto";
  const clipPlan = buildTestingKlingClipPlan({
    context,
    images,
    requestedMode: normalizeKlingGenerationMode(requestedKlingMode),
  });

  await writeTestingLog({
    message: `Kling Video started for ${clipPlan.length} clip job(s).`,
    metadata: {
      durationSecondsByMode: KLING_DURATION_SECONDS_BY_MODE,
      mode: KLING_TEST_CONFIG.mode,
      plan: clipPlan.map((clip) => ({
        clipId: clip.clipId,
        duplicateIndex: clip.duplicateIndex,
        generationMode: clip.generationMode,
        imageId: clip.image.id,
        multiShotVariant: clip.multiShotVariant,
      })),
      provider: AI_PROVIDERS.imageToVideo.primary,
      requestedMode: requestedKlingMode,
      sourceImageCount: images.length,
    },
    runId: context.run.id,
    status: "started",
    step: "kling_video",
  });

  const outputs = await mapWithConcurrency({
    concurrency: TESTING_KLING_CONCURRENCY,
    items: clipPlan,
    worker: async (clipJob, index) => {
    const image = clipJob.image;
    const generationMode = clipJob.generationMode;
    const durationSeconds = KLING_DURATION_SECONDS_BY_MODE[generationMode];
    const multiShotVariant = clipJob.multiShotVariant;
    const prompt =
      multiShotVariant === "three_scene"
        ? prompts.multi_shot_three_scene
        : prompts[generationMode];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
    const signedUrl = await createSignedAssetUrl(image);
    const task = await runWithTransientProviderRetry({
      label: `Kling task create ${clipJob.clipId} attempt ${attempt}`,
      operation: () =>
        createKieKling30Task({
          aspectRatio: KLING_TEST_CONFIG.aspectRatio,
          durationSeconds,
          imageUrls: [signedUrl],
          mode: KLING_TEST_CONFIG.mode,
          multiPrompt:
            generationMode === "multi_shot" && multiShotVariant
              ? buildArchitecturalKlingMultiPrompt(
                  durationSeconds,
                  multiShotVariant,
                )
              : undefined,
          multiShots: generationMode === "multi_shot",
          prompt,
          sound: KLING_TEST_CONFIG.sound,
        }),
      runId: context.run.id,
      step: "kling_video",
    });

    await writeTestingLog({
      message: `Kling 3.0 task created for ${clipJob.clipId}.`,
      metadata: {
        attempt,
        clipId: clipJob.clipId,
        duplicateIndex: clipJob.duplicateIndex,
        durationSeconds,
        generationMode,
        model: "kling-3.0/video",
        multiShotSceneCount:
          multiShotVariant === null
            ? null
            : multiShotSceneCountForVariant(multiShotVariant),
        multiShotVariant,
        multiShots: generationMode === "multi_shot",
        provider: task.provider,
        sourceStorageKey: image.storage_key,
        taskId: task.taskId,
      },
      runId: context.run.id,
      status: "started",
      step: "kling_video",
    });

    const record = await pollKieKlingTask({
      imageIndex: index,
      runId: context.run.id,
      taskId: task.taskId,
    });
    const resultUrl = record.resultUrls[0];

    if (!resultUrl) {
      throw new Error(
        `Kling task ${task.taskId} completed without a result URL.`,
      );
    }

    const resultResponse = await fetch(resultUrl);

    if (!resultResponse.ok) {
      throw new Error(
        `Failed to download Kling result (${resultResponse.status}): ${resultResponse.statusText}`,
      );
    }

    let contentType = getVideoContentType(resultResponse);
    let videoBytes = new Uint8Array(await resultResponse.arrayBuffer());
    let stabilizationApplied = false;
    let stabilizationError: string | null = null;

    try {
      const stabilized = await stabilizeVideoBytes({
        clipStorageKey: clipJob.clipId,
        videoBytes,
      });
      videoBytes = stabilized.videoBytes;
      contentType = "video/mp4";
      stabilizationApplied = stabilized.stabilized;
    } catch (error) {
      stabilizationError =
        error instanceof Error ? error.message : "Unknown stabilization error.";
      await writeTestingLog({
        message: `Kling ${clipJob.clipId} stabilization failed; continuing with original clip.`,
        metadata: {
          attempt,
          clipId: clipJob.clipId,
          error: stabilizationError,
          taskId: task.taskId,
        },
        runId: context.run.id,
        status: "info",
        step: "kling_video",
      });
    }

    const preflightQc = await runMediaQcOnVideoBytes({
      clipStorageKey: `preflight-${clipJob.clipId}`,
      expectedDurationSeconds: durationSeconds,
      videoBytes,
    });

    if (preflightQc.status !== "passed") {
      await writeTestingLog({
        message: `Kling ${clipJob.clipId} failed preflight media QC on attempt ${attempt}.`,
        metadata: {
          attempt,
          clipId: clipJob.clipId,
          issues: preflightQc.issues,
          report: preflightQc as unknown as Json,
          taskId: task.taskId,
        },
        runId: context.run.id,
        status: "failed",
        step: "kling_video",
      });

      if (attempt < 2) {
        continue;
      }

      throw new Error(
        `Kling ${clipJob.clipId} failed preflight media QC after ${attempt} attempt(s): ${preflightQc.issues[0] ?? "unknown issue"}`,
      );
    }

    const extension = extensionForContentType(contentType);
    const output = await uploadTestingOutput({
      bucket: STORAGE_BUCKETS.generatedClips,
      contentType,
      fileName: `kling-${clipJob.clipId}.${extension}`,
      kind: "video_clip",
      label: `Kling ${clipJob.clipId}`,
      metadata: {
        clipId: clipJob.clipId,
        attempt,
        creditsConsumed: record.creditsConsumed ?? null,
        duplicateIndex: clipJob.duplicateIndex,
        durationSeconds,
        generationMode,
        model: record.model ?? "kling-3.0/video",
        multiShotSceneCount:
          multiShotVariant === null
            ? null
            : multiShotSceneCountForVariant(multiShotVariant),
        multiShotVariant,
        resultUrls: record.resultUrls,
        sourceStorageKey: image.storage_key,
        stabilizationApplied,
        stabilizationError,
        taskId: task.taskId,
      },
      runId: context.run.id,
      step: "kling_video",
      value: videoBytes,
    });
    const asset = await insertAssetFromOutput({
      bucket: STORAGE_BUCKETS.generatedClips,
      contentType,
      fileName: `kling-${clipJob.clipId}.${extension}`,
      fileSizeBytes: videoBytes.byteLength,
      kind: "video_clip",
      metadata: {
        clipId: clipJob.clipId,
        attempt,
        creditsConsumed: record.creditsConsumed ?? null,
        duplicateIndex: clipJob.duplicateIndex,
        durationSeconds,
        generatedByStep: "kling_video",
        generationMode,
        multiShotSceneCount:
          multiShotVariant === null
            ? null
            : multiShotSceneCountForVariant(multiShotVariant),
        multiShotVariant,
        outputId: output.id,
        sourceStorageKey: image.storage_key,
        stabilizationApplied,
        stabilizationError,
        taskId: task.taskId,
      },
      runId: context.run.id,
      storageKey: output.storageKey,
    });

    await writeTestingLog({
      message: `Kling ${clipJob.clipId} generated and stored.`,
      metadata: {
        clipId: clipJob.clipId,
        contentType,
        fileSizeBytes: videoBytes.byteLength,
        generationMode,
        preflightQcStatus: preflightQc.status,
        stabilizationApplied,
        stabilizationError,
        storageKey: output.storageKey,
        taskId: task.taskId,
      },
      runId: context.run.id,
      status: "completed",
      step: "kling_video",
    });

    return asset;
    } catch (error) {
      await writeTestingLog({
        message: `Kling ${clipJob.clipId} attempt ${attempt} failed.`,
        metadata: {
          attempt,
          clipId: clipJob.clipId,
          error: error instanceof Error ? error.message : "Unknown Kling error.",
          generationMode,
          multiShotVariant,
        },
        runId: context.run.id,
        status: "failed",
        step: "kling_video",
      });

      if (attempt < 2) {
        continue;
      }

      throw error;
    }
    }

    throw new Error(`Kling ${clipJob.clipId} did not produce a usable clip.`);
    },
  });

  context.assets.push(...outputs);
  await writeTestingLog({
    message: `Kling Video completed ${outputs.length} clip(s).`,
    runId: context.run.id,
    status: "completed",
    step: "kling_video",
  });

  return outputs;
}

interface TestingMusicContext {
  durationSeconds: number | null;
  genre: string | null;
  lengthProfile: VideoLengthProfile;
  name: string | null;
  planJson: Json | null;
  signedUrl: string | null;
  storageKey: string | null;
  trackGroupKey: string | null;
}

function resolveTestingLengthProfile(
  context: TestingRunContext,
): VideoLengthProfile {
  if (
    context.config.lengthProfile === "short" ||
    context.config.lengthProfile === "long"
  ) {
    return context.config.lengthProfile;
  }

  const sourceImageCount = assetsByKind(context.assets, "source_image").length;

  return sourceImageCount >= 2 && sourceImageCount <= 3 ? "short" : "long";
}

function configuredMusicGenre(context: TestingRunContext) {
  return typeof context.config.musicGenre === "string" &&
    context.config.musicGenre.trim()
    ? context.config.musicGenre.trim()
    : "cinematic_ambient";
}

function configuredMusicId(context: TestingRunContext) {
  return typeof context.config.musicId === "string" &&
    context.config.musicId.trim()
    ? context.config.musicId.trim()
    : null;
}

function shouldSkipVoiceover(context: TestingRunContext) {
  return context.config.skipVoiceover === true;
}

async function loadMusicContext(
  context: TestingRunContext,
): Promise<TestingMusicContext> {
  const lengthProfile = resolveTestingLengthProfile(context);
  const fallbackGenre = configuredMusicGenre(context);
  const emptyContext = (genre: string | null = fallbackGenre) => ({
    durationSeconds: null,
    genre,
    lengthProfile,
    name: null,
    planJson: null,
    signedUrl: null,
    storageKey: null,
    trackGroupKey: null,
  });

  if (fallbackGenre === "no_music") {
    return emptyContext("no_music");
  }

  const musicAsset = assetsByKind(context.assets, "music_audio")[0] ?? null;

  if (musicAsset) {
    const metadata = isJsonObject(musicAsset.metadata)
      ? musicAsset.metadata
      : {};

    return {
      durationSeconds:
        typeof metadata.durationSeconds === "number"
          ? metadata.durationSeconds
          : null,
      genre: fallbackGenre,
      lengthProfile,
      name: musicAsset.file_name,
      planJson: isJsonObject(metadata.planJson) ? metadata.planJson : null,
      signedUrl: await createSignedAssetUrl(musicAsset),
      storageKey: musicAsset.storage_key,
      trackGroupKey:
        typeof metadata.trackGroupKey === "string"
          ? metadata.trackGroupKey
          : null,
    };
  }

  const musicId = configuredMusicId(context);
  const admin = createAdminClient();
  type MusicTrackRow = {
    duration_seconds: number | null;
    file_storage_key: string | null;
    genre: string | null;
    length_profile?: string | null;
    name: string | null;
    plan_json?: Json | null;
    track_group_key?: string | null;
  };
  const toMusicContext = async (
    track: MusicTrackRow | null,
  ): Promise<TestingMusicContext> => {
    if (!track?.file_storage_key) {
      return emptyContext(track?.genre ?? fallbackGenre);
    }

    return {
      durationSeconds: track.duration_seconds ?? null,
      genre: track.genre ?? fallbackGenre,
      lengthProfile:
        track.length_profile === "short" || track.length_profile === "long"
          ? track.length_profile
          : lengthProfile,
      name: track.name ?? null,
      planJson: track.plan_json ?? null,
      signedUrl: await createSignedStorageUrl(
        STORAGE_BUCKETS.musicTracks,
        track.file_storage_key,
      ),
      storageKey: track.file_storage_key,
      trackGroupKey: track.track_group_key ?? null,
    };
  };

  const findMusicTrack = async (
    selectColumns: string,
    includeLengthProfile: boolean,
  ) => {
    const findGenreTrack = async (genre: string | null) => {
      if (!genre) {
        return null;
      }

      let query = admin
        .from("music_tracks")
        .select(selectColumns)
        .eq("is_active", true)
        .eq("genre", genre);

      if (includeLengthProfile) {
        query = query.eq("length_profile", lengthProfile);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data as MusicTrackRow | null;
    };

    if (!musicId) {
      return findGenreTrack(fallbackGenre);
    }

    const { data: selectedTrack, error: selectedError } = await admin
      .from("music_tracks")
      .select(selectColumns)
      .eq("is_active", true)
      .eq("id", musicId)
      .limit(1)
      .maybeSingle();

    if (selectedError) {
      throw selectedError;
    }

    const selected = selectedTrack as MusicTrackRow | null;

    if (
      !includeLengthProfile ||
      !selected ||
      selected.length_profile === lengthProfile
    ) {
      return selected;
    }

    if (selected.track_group_key) {
      const { data: siblingTrack, error: siblingError } = await admin
        .from("music_tracks")
        .select(selectColumns)
        .eq("is_active", true)
        .eq("track_group_key", selected.track_group_key)
        .eq("length_profile", lengthProfile)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (siblingError) {
        throw siblingError;
      }

      if (siblingTrack) {
        return siblingTrack as unknown as MusicTrackRow;
      }
    }

    return (await findGenreTrack(selected.genre ?? fallbackGenre)) ?? selected;
  };

  try {
    return toMusicContext(
      await findMusicTrack(
        "duration_seconds, file_storage_key, genre, length_profile, name, plan_json, track_group_key",
        true,
      ),
    );
  } catch (error) {
    if (!(isJsonObject(error) && error.code === "42703")) {
      throw error;
    }

    return toMusicContext(
      await findMusicTrack(
        "duration_seconds, file_storage_key, genre, name, plan_json",
        false,
      ),
    );
  }
}

async function buildEditorContext(context: TestingRunContext) {
  const clips = assetsByKind(context.assets, "video_clip");
  const skipVoiceover = shouldSkipVoiceover(context);

  if (!clips.length) {
    return null;
  }

  const qcReports = await Promise.all(
    clips.map(async (clip) => ({
      clip,
      report: await runMediaQcOnVideoBytes({
        clipStorageKey: clip.storage_key,
        expectedDurationSeconds: expectedDurationSecondsForClip(context, clip),
        videoBytes: await downloadAsset(clip),
      }),
    })),
  );
  const segments = buildClipSegmentsFromSources(
    qcReports.map(({ clip, report }, index) => {
      const metadata = isJsonObject(clip.metadata) ? clip.metadata : {};
      const multiShotVariant = multiShotVariantFromAsset(clip);
      const multiShotSceneCount =
        typeof metadata.multiShotSceneCount === "number"
          ? metadata.multiShotSceneCount
          : multiShotVariant
            ? multiShotSceneCountForVariant(multiShotVariant)
            : null;

      return {
        clipStorageKey: clip.storage_key,
        durationSeconds: report.metrics.durationSeconds,
        imageId: clip.id,
        multiShotSceneCount,
        multiShotVariant,
        orderIndex: index,
        promptType: metadata.generationMode === "multi_shot" ? "multi_shot" : null,
        sceneChangeSeconds: report.metrics.sceneChangeSeconds,
        tagSegmentsAsMultiShot: shouldTagSegmentsAsMultiShot(multiShotVariant),
      };
    }),
  );
  const musicContext = await loadMusicContext(context);
  const lengthProfile = musicContext.lengthProfile;
  const project = {
    customerName:
      typeof context.config.customerName === "string" &&
      context.config.customerName.trim()
        ? context.config.customerName.trim()
        : context.run.name,
    musicGenre: musicContext.genre ?? configuredMusicGenre(context),
    projectId: context.run.id,
    salesNotes:
      typeof context.config.notes === "string" ? context.config.notes : null,
    voiceSelection:
      typeof context.config.voiceSelection === "string" &&
      context.config.voiceSelection.trim()
        ? context.config.voiceSelection.trim()
        : "speaker_amelie",
  };
  const musicPlan = buildMusicInstructionPlan({
    lengthProfile,
    musicGenre: project.musicGenre,
    trackDurationSeconds: musicContext.durationSeconds,
    trackName: musicContext.name,
    trackPlanJson: musicContext.planJson,
    trackStorageKey: musicContext.storageKey,
  });
  const storyPlan = buildEditorStoryPlan({
    music: musicPlan,
    project,
    segments,
  });
  const voiceoverPlan = buildVoiceoverPlan({
    lengthProfile,
    project,
    storyPlan,
  });
  const finalEditPlan = buildFinalEditPlan({
    lengthProfile,
    music: musicPlan,
    segments,
    voiceover: voiceoverPlan,
    voiceoverDurationSeconds: skipVoiceover
      ? null
      : voiceoverPlan.targetDurationSeconds,
  });

  return {
    clips,
    finalEditPlan,
    musicPlan,
    project,
    segments,
    storyPlan,
    voiceoverPlan,
  };
}

async function runEditorAgent(context: TestingRunContext) {
  await writeTestingLog({
    message: "Editor Agent started.",
    runId: context.run.id,
    status: "started",
    step: "editor_agent",
  });

  const editorContext = await buildEditorContext(context);

  if (!editorContext) {
    await writeTestingLog({
      message: "Editor Agent skipped because no video clips were uploaded.",
      runId: context.run.id,
      status: "skipped",
      step: "editor_agent",
    });
    return null;
  }

  await uploadJsonResult({
    label: "Clip segments",
    name: "clip-segments",
    runId: context.run.id,
    step: "editor_agent",
    value: editorContext.segments as unknown as Json,
  });
  await uploadJsonResult({
    label: "Editor story plan",
    name: "editor-story-plan",
    runId: context.run.id,
    step: "editor_agent",
    value: editorContext.storyPlan as unknown as Json,
  });
  await uploadJsonResult({
    label: "Final edit plan",
    name: "final-edit-plan",
    runId: context.run.id,
    step: "editor_agent",
    value: editorContext.finalEditPlan as unknown as Json,
  });
  await writeTestingLog({
    message: "Editor Agent prepared story, segments, and edit plan.",
    metadata: {
      sceneCount: editorContext.finalEditPlan.scenes.length,
      segmentCount: editorContext.segments.length,
    },
    runId: context.run.id,
    status: "completed",
    step: "editor_agent",
  });

  return editorContext;
}

async function runVoiceMusic(context: TestingRunContext) {
  await writeTestingLog({
    message: "Voice/Music test stage started.",
    runId: context.run.id,
    status: "started",
    step: "voice_music",
  });

  const editorContext = await buildEditorContext(context);
  const skipVoiceover = shouldSkipVoiceover(context);

  if (!editorContext) {
    await writeTestingLog({
      message:
        "Voice/Music stage skipped because no video clips were uploaded.",
      runId: context.run.id,
      status: "skipped",
      step: "voice_music",
    });
    return null;
  }

  if (skipVoiceover) {
    await uploadJsonResult({
      label: "Voiceover plan",
      name: "voiceover-plan",
      runId: context.run.id,
      step: "voice_music",
      value: editorContext.voiceoverPlan as unknown as Json,
    });
    await uploadJsonResult({
      label: "Music plan",
      name: "music-plan",
      runId: context.run.id,
      step: "voice_music",
      value: editorContext.musicPlan as unknown as Json,
    });
    await writeTestingLog({
      message: "Voice/Music stage completed without voiceover audio.",
      metadata: {
        provider: null,
        voiceoverSkipped: true,
      },
      runId: context.run.id,
      status: "completed",
      step: "voice_music",
    });

    return {
      ...editorContext,
      voiceAsset: null,
      voiceover: null,
    };
  }

  const voiceover = await generateVoiceoverAudio({
    script: editorContext.voiceoverPlan.script,
    targetDurationSeconds: editorContext.voiceoverPlan.targetDurationSeconds,
    voiceSelection: editorContext.voiceoverPlan.voiceSelection,
  });
  const voiceExtension = extensionForContentType(voiceover.contentType);
  const voiceOutput = await uploadTestingOutput({
    bucket: STORAGE_BUCKETS.finalOutputs,
    contentType: voiceover.contentType,
    fileName: `voiceover.${voiceExtension}`,
    kind: "voiceover_audio",
    label: "Generated voiceover",
    metadata: {
      durationSeconds: voiceover.durationSeconds,
      model: voiceover.model,
      provider: voiceover.provider,
      voiceId: voiceover.voiceId,
    },
    runId: context.run.id,
    step: "voice_music",
    value: voiceover.audioBytes,
  });
  const voiceAsset = await insertAssetFromOutput({
    bucket: STORAGE_BUCKETS.finalOutputs,
    contentType: voiceover.contentType,
    fileName: `voiceover.${voiceExtension}`,
    fileSizeBytes: voiceover.audioBytes.byteLength,
    kind: "voiceover_audio",
    metadata: {
      durationSeconds: voiceover.durationSeconds,
      outputId: voiceOutput.id,
    },
    runId: context.run.id,
    storageKey: voiceOutput.storageKey,
  });

  context.assets.push(voiceAsset);
  await uploadJsonResult({
    label: "Voiceover plan",
    name: "voiceover-plan",
    runId: context.run.id,
    step: "voice_music",
    value: editorContext.voiceoverPlan as unknown as Json,
  });
  await uploadJsonResult({
    label: "Music plan",
    name: "music-plan",
    runId: context.run.id,
    step: "voice_music",
    value: editorContext.musicPlan as unknown as Json,
  });
  await writeTestingLog({
    message: "Voice/Music stage completed.",
    metadata: {
      durationSeconds: voiceover.durationSeconds,
      provider: voiceover.provider,
    },
    runId: context.run.id,
    status: "completed",
    step: "voice_music",
  });

  return {
    ...editorContext,
    voiceAsset,
    voiceover,
  };
}

async function getRenderManifestFromAsset(context: TestingRunContext) {
  const manifestAsset = assetsByKind(context.assets, "render_manifest")[0];

  if (!manifestAsset) {
    return null;
  }

  const raw = new TextDecoder().decode(await downloadAsset(manifestAsset));
  const parsed = JSON.parse(raw) as unknown;

  if (!isJsonObject(parsed)) {
    throw new Error("Render manifest must be a JSON object.");
  }

  return parsed as unknown as SalesPitchRenderManifest;
}

async function runRemotionRender(context: TestingRunContext) {
  await writeTestingLog({
    message: "Remotion render test started.",
    runId: context.run.id,
    status: "started",
    step: "remotion_render",
  });

  let manifest = await getRenderManifestFromAsset(context);

  if (!manifest) {
    const editorContext = await buildEditorContext(context);
    const skipVoiceover = shouldSkipVoiceover(context);
    const voiceAsset = skipVoiceover
      ? null
      : assetsByKind(context.assets, "voiceover_audio")[0];

    if (!editorContext || (!skipVoiceover && !voiceAsset)) {
      await writeTestingLog({
        message:
          "Remotion render skipped. Upload a render manifest JSON, or provide video clips. Voiceover audio is only required when skip voiceover is off.",
        runId: context.run.id,
        status: "skipped",
        step: "remotion_render",
      });
      return null;
    }

    const admin = createAdminClient();
    const clipSignedUrls = new Map<string, string>();
    let voiceoverDurationSeconds: number | null = null;
    let voiceoverSignedUrl: string | null = null;

    for (const clip of editorContext.clips) {
      const { data, error } = await admin.storage
        .from(clip.bucket)
        .createSignedUrl(clip.storage_key, 60 * 60);

      if (error || !data?.signedUrl) {
        throw error ?? new Error(`Could not sign clip ${clip.storage_key}`);
      }

      clipSignedUrls.set(clip.storage_key, data.signedUrl);
    }

    if (voiceAsset) {
      const { data: voiceSignedUrlData, error: voiceError } =
        await admin.storage
          .from(voiceAsset.bucket)
          .createSignedUrl(voiceAsset.storage_key, 60 * 60);

      if (voiceError || !voiceSignedUrlData?.signedUrl) {
        throw voiceError ?? new Error("Could not sign voiceover asset.");
      }

      voiceoverDurationSeconds =
        typeof voiceAsset.metadata === "object" &&
        voiceAsset.metadata &&
        isJsonObject(voiceAsset.metadata) &&
        typeof voiceAsset.metadata.durationSeconds === "number"
          ? voiceAsset.metadata.durationSeconds
          : null;
      voiceoverSignedUrl = voiceSignedUrlData.signedUrl;
    }

    const music = await loadMusicContext(context);
    manifest = buildSalesPitchRenderManifest({
      clipSignedUrls,
      editPlan: editorContext.finalEditPlan,
      logoSignedUrl: null,
      musicSignedUrl: music.signedUrl,
      project: editorContext.project,
      voiceoverDurationSeconds,
      voiceoverSignedUrl,
    });
  }

  await uploadJsonResult({
    label: "Render manifest",
    name: "render-manifest",
    runId: context.run.id,
    step: "remotion_render",
    value: manifest as unknown as Json,
  });

  const renderResult = await renderSalesPitchVideo({
    entryPoint: path.resolve(
      process.cwd(),
      "../../packages/video/src/remotion-entry.tsx",
    ),
    manifest,
  });
  const output = await uploadTestingOutput({
    bucket: STORAGE_BUCKETS.finalOutputs,
    contentType: renderResult.contentType,
    fileName: "testing-render.mp4",
    kind: "final_video",
    label: "Rendered test video",
    metadata: {
      durationSeconds: renderResult.durationSeconds,
    },
    runId: context.run.id,
    step: "remotion_render",
    value: renderResult.outputBytes,
  });
  const finalQcReport = await runMediaQcOnVideoBytes({
    clipStorageKey: output.storageKey,
    expectedDurationSeconds: renderResult.durationSeconds,
    videoBytes: renderResult.outputBytes,
  });

  await uploadJsonResult({
    label: "Final render QC report",
    name: "final-render-qc-report",
    runId: context.run.id,
    step: "remotion_render",
    value: finalQcReport as unknown as Json,
  });

  if (finalQcReport.status !== "passed") {
    await writeTestingLog({
      message: "Final rendered video failed media QC.",
      metadata: {
        issues: finalQcReport.issues,
        report: finalQcReport as unknown as Json,
      },
      runId: context.run.id,
      status: "failed",
      step: "remotion_render",
    });
    throw new Error(
      `Final rendered video failed media QC: ${finalQcReport.issues[0] ?? "unknown issue"}`,
    );
  }

  await writeTestingLog({
    message: "Remotion render completed.",
    metadata: {
      durationSeconds: renderResult.durationSeconds,
      finalQcStatus: finalQcReport.status,
      outputStorageKey: output.storageKey,
    },
    runId: context.run.id,
    status: "completed",
    step: "remotion_render",
  });

  return output;
}

async function executeTestingStep(
  stepName: TestStep,
  context: TestingRunContext,
) {
  await refreshTestingAssets(context);

  if (stepName === "image_upscaler") {
    await runImageUpscaler(context);
    return;
  }

  if (stepName === "video_agent") {
    await runVideoAgent(context);
    return;
  }

  if (stepName === "kling_video") {
    await runKlingVideo(context);
    return;
  }

  if (stepName === "media_qc") {
    await runMediaQc(context);
    return;
  }

  if (stepName === "editor_agent") {
    await runEditorAgent(context);
    return;
  }

  if (stepName === "voice_music") {
    await runVoiceMusic(context);
    return;
  }

  if (stepName === "remotion_render") {
    await runRemotionRender(context);
  }
}

export const testingRunExecutor = inngest.createFunction(
  {
    id: "testing-run-executor",
    name: "Testing Run Executor",
    retries: 0,
    triggers: { event: TESTING_RUN_QUEUED_EVENT },
  },
  async ({ event, step }) => {
    const runId = String(event.data.runId ?? "");

    const context = await step.run("load-testing-run", async () => {
      const admin = createAdminClient();
      const { data: run, error: runError } = await admin
        .from("testing_runs")
        .select("id, name, target_step, run_mode, config")
        .eq("id", runId)
        .single();

      if (runError) {
        throw runError;
      }

      await admin
        .from("testing_runs")
        .update({
          started_at: new Date().toISOString(),
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      return {
        assets: await loadTestingRunAssets(runId),
        config: isJsonObject(run.config) ? run.config : {},
        run,
      } satisfies TestingRunContext;
    });

    try {
      const stepsToRun = getStepsForRun(
        context.run.target_step,
        context.run.run_mode,
      );

      await step.run("record-testing-plan", () =>
        writeTestingLog({
          message: "Testing execution plan prepared.",
          metadata: {
            queuedBy: event.data.queuedBy,
            stepsToRun,
          },
          runId,
          status: "info",
          step: "plan",
        }),
      );

      for (const stepName of stepsToRun) {
        await step.run(`execute-${stepName}`, () =>
          executeTestingStep(stepName, context),
        );
      }

      await step.run("complete-testing-run", async () => {
        const admin = createAdminClient();
        const { error } = await admin
          .from("testing_runs")
          .update({
            completed_at: new Date().toISOString(),
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);

        if (error) {
          throw error;
        }
      });

      return {
        ok: true,
        runId,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Testing run failed.";

      await step.run("fail-testing-run", async () => {
        const admin = createAdminClient();
        await writeTestingLog({
          message,
          runId,
          status: "failed",
          step: "testing_run",
        });
        const { error: updateError } = await admin
          .from("testing_runs")
          .update({
            completed_at: new Date().toISOString(),
            error_message: message,
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);

        if (updateError) {
          throw updateError;
        }
      });

      throw error;
    }
  },
);
