import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  analyzeImageForEnhancement,
  classifyImagesForKlingModes,
  enhanceImageWithNanoBananaPro,
  generateVoiceoverAudio,
  runMediaQcOnVideoBytes,
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

  return "json";
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
        "Enhancement + Image Upscaler skipped because no source images were uploaded.",
      runId: context.run.id,
      status: "skipped",
      step: "image_upscaler",
    });
    return [];
  }

  const upscalingPrompt = await loadPipelinePrompt("upscaling");
  const enhancementPrompt =
    typeof context.config.promptOverride === "string" &&
    context.config.promptOverride.trim()
      ? context.config.promptOverride.trim()
      : await loadPipelinePrompt("enhancement-agent");
  const notes =
    typeof context.config.notes === "string" ? context.config.notes : null;
  const outputs: TestingAsset[] = [];

  await writeTestingLog({
    message: `Enhancement + Image Upscaler started for ${sourceImages.length} image(s).`,
    metadata: {
      model: AI_PROVIDERS.imageEnhancement.model,
      provider: AI_PROVIDERS.imageEnhancement.primary,
    },
    runId: context.run.id,
    status: "started",
    step: "image_upscaler",
  });

  for (const [index, image] of sourceImages.entries()) {
    const sourceImage = await downloadAsset(image);
    const sourceMimeType = inferImageMimeType(
      image.storage_key,
      image.content_type,
    );
    const brief = await runWithTransientProviderRetry({
      label: `Enhancement analysis ${index + 1}`,
      operation: () =>
        analyzeImageForEnhancement({
          prompt: enhancementPrompt,
          sourceImage,
          sourceMimeType,
          sourceStorageKey: image.storage_key,
        }),
      runId: context.run.id,
      step: "image_upscaler",
    });
    const briefOutput = await uploadJsonResult({
      label: `Enhancement brief ${index + 1}`,
      name: `enhancement-brief-${index + 1}`,
      runId: context.run.id,
      step: "image_upscaler",
      value: brief as unknown as Json,
    });
    const result = await runWithTransientProviderRetry({
      label: `Image upscale ${index + 1}`,
      operation: () =>
        enhanceImageWithNanoBananaPro({
          aspectRatio: "16:9",
          prompt: buildUpscalingPrompt({
            markdown: upscalingPrompt,
            notes,
            preservationPrompt: brief.promptInsert,
          }),
          sourceImage,
          sourceMimeType,
          sourceStorageKey: image.storage_key,
          targetResolution: "2K",
        }),
      runId: context.run.id,
      step: "image_upscaler",
    });
    const extension = extensionForContentType(result.outputMimeType);
    const output = await uploadTestingOutput({
      bucket: STORAGE_BUCKETS.sourceAssets,
      contentType: result.outputMimeType,
      fileName: `upscaled-${index + 1}.${extension}`,
      kind: "enhanced_image",
      label: `Upscaled image ${index + 1}`,
      metadata: {
        enhancementBriefOutputId: briefOutput.id,
        enhancementModel: brief.model,
        enhancementProvider: brief.provider,
        model: result.model,
        provider: result.provider,
        sourceStorageKey: image.storage_key,
      },
      runId: context.run.id,
      step: "image_upscaler",
      value: result.outputImage,
    });

    outputs.push(
      await insertAssetFromOutput({
        bucket: STORAGE_BUCKETS.sourceAssets,
        contentType: result.outputMimeType,
        fileName: `upscaled-${index + 1}.${extension}`,
        fileSizeBytes: result.outputImage.byteLength,
        kind: "enhanced_image",
        metadata: {
          generatedByStep: "image_upscaler",
          outputId: output.id,
          sourceStorageKey: image.storage_key,
        },
        runId: context.run.id,
        storageKey: output.storageKey,
      }),
    );
  }

  await writeTestingLog({
    message: `Enhancement + Image Upscaler completed ${outputs.length} image(s).`,
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

  const expectedDurationSeconds =
    typeof context.config.expectedDurationSeconds === "number"
      ? context.config.expectedDurationSeconds
      : null;
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
      expectedDurationSeconds,
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

async function buildEditorContext(context: TestingRunContext) {
  const clips = assetsByKind(context.assets, "video_clip");

  if (!clips.length) {
    return null;
  }

  const qcReports = await Promise.all(
    clips.map(async (clip) => ({
      clip,
      report: await runMediaQcOnVideoBytes({
        clipStorageKey: clip.storage_key,
        expectedDurationSeconds:
          typeof context.config.expectedDurationSeconds === "number"
            ? context.config.expectedDurationSeconds
            : null,
        videoBytes: await downloadAsset(clip),
      }),
    })),
  );
  const segments = buildClipSegmentsFromSources(
    qcReports.map(({ clip, report }, index) => ({
      clipStorageKey: clip.storage_key,
      durationSeconds: report.metrics.durationSeconds,
      imageId: clip.id,
      orderIndex: index,
      promptType: null,
      sceneChangeSeconds: report.metrics.sceneChangeSeconds,
    })),
  );
  const project = {
    customerName:
      typeof context.config.customerName === "string" &&
      context.config.customerName.trim()
        ? context.config.customerName.trim()
        : context.run.name,
    musicGenre:
      typeof context.config.musicGenre === "string" &&
      context.config.musicGenre.trim()
        ? context.config.musicGenre.trim()
        : "cinematic_ambient",
    projectId: context.run.id,
    salesNotes:
      typeof context.config.notes === "string" ? context.config.notes : null,
    voiceSelection:
      typeof context.config.voiceSelection === "string" &&
      context.config.voiceSelection.trim()
        ? context.config.voiceSelection.trim()
        : "speaker_amelie",
  };
  const storyPlan = buildEditorStoryPlan({
    project,
    segments,
  });
  const voiceoverPlan = buildVoiceoverPlan({
    project,
    storyPlan,
  });
  const musicPlan = buildMusicInstructionPlan({
    musicGenre: project.musicGenre,
    trackDurationSeconds: null,
    trackName: null,
    trackPlanJson: null,
    trackStorageKey: null,
  });
  const finalEditPlan = buildFinalEditPlan({
    music: musicPlan,
    segments,
    voiceover: voiceoverPlan,
    voiceoverDurationSeconds: voiceoverPlan.targetDurationSeconds,
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

async function loadMusicContext(context: TestingRunContext) {
  const musicAssets = assetsByKind(context.assets, "music_audio");
  const musicAsset = musicAssets[0] ?? null;

  if (musicAsset) {
    const admin = createAdminClient();
    const { data } = await admin.storage
      .from(musicAsset.bucket)
      .createSignedUrl(musicAsset.storage_key, 60 * 60);

    return {
      signedUrl: data?.signedUrl ?? null,
      storageKey: musicAsset.storage_key,
    };
  }

  return {
    signedUrl: null,
    storageKey: null,
  };
}

async function runVoiceMusic(context: TestingRunContext) {
  await writeTestingLog({
    message: "Voice/Music test stage started.",
    runId: context.run.id,
    status: "started",
    step: "voice_music",
  });

  const editorContext = await buildEditorContext(context);

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
    const voiceAsset = assetsByKind(context.assets, "voiceover_audio")[0];

    if (!editorContext || !voiceAsset) {
      await writeTestingLog({
        message:
          "Remotion render skipped. Upload a render manifest JSON, or provide video clips plus a voiceover audio asset.",
        runId: context.run.id,
        status: "skipped",
        step: "remotion_render",
      });
      return null;
    }

    const admin = createAdminClient();
    const clipSignedUrls = new Map<string, string>();

    for (const clip of editorContext.clips) {
      const { data, error } = await admin.storage
        .from(clip.bucket)
        .createSignedUrl(clip.storage_key, 60 * 60);

      if (error || !data?.signedUrl) {
        throw error ?? new Error(`Could not sign clip ${clip.storage_key}`);
      }

      clipSignedUrls.set(clip.storage_key, data.signedUrl);
    }

    const { data: voiceSignedUrl, error: voiceError } = await admin.storage
      .from(voiceAsset.bucket)
      .createSignedUrl(voiceAsset.storage_key, 60 * 60);

    if (voiceError || !voiceSignedUrl?.signedUrl) {
      throw voiceError ?? new Error("Could not sign voiceover asset.");
    }

    const music = await loadMusicContext(context);
    manifest = buildSalesPitchRenderManifest({
      clipSignedUrls,
      editPlan: editorContext.finalEditPlan,
      logoSignedUrl: null,
      musicSignedUrl: music.signedUrl,
      project: editorContext.project,
      voiceoverDurationSeconds:
        typeof voiceAsset.metadata === "object" &&
        voiceAsset.metadata &&
        isJsonObject(voiceAsset.metadata) &&
        typeof voiceAsset.metadata.durationSeconds === "number"
          ? voiceAsset.metadata.durationSeconds
          : null,
      voiceoverSignedUrl: voiceSignedUrl.signedUrl,
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

  await writeTestingLog({
    message: "Remotion render completed.",
    metadata: {
      durationSeconds: renderResult.durationSeconds,
      outputStorageKey: output.storageKey,
    },
    runId: context.run.id,
    status: "completed",
    step: "remotion_render",
  });

  return output;
}

async function runUnsupportedCallbackStep(context: TestingRunContext) {
  await writeTestingLog({
    message:
      "Kling test execution is registered but not enabled in isolated testing yet. Use the project pipeline retry tools until the KIE callback adapter is extracted.",
    runId: context.run.id,
    status: "skipped",
    step: "kling_video",
  });
}

async function executeTestingStep(
  stepName: TestStep,
  context: TestingRunContext,
) {
  if (stepName === "image_upscaler") {
    await runImageUpscaler(context);
    return;
  }

  if (stepName === "video_agent") {
    await runVideoAgent(context);
    return;
  }

  if (stepName === "kling_video") {
    await runUnsupportedCallbackStep(context);
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

      const { data: assets, error: assetsError } = await admin
        .from("testing_run_assets")
        .select(
          "id, kind, bucket, storage_key, file_name, content_type, file_size_bytes, metadata",
        )
        .eq("run_id", runId)
        .order("created_at", { ascending: true });

      if (assetsError) {
        throw assetsError;
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
        assets: (assets ?? []) as TestingAsset[],
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
