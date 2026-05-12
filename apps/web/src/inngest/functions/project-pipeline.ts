import { AI_PROVIDERS, getVideoImageRequirements } from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  buildKlingFurniturePrompt,
  enhanceImageWithNanoBananaPro,
} from "@interior-pro/pipeline";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inngest, PROJECT_SUBMITTED_EVENT } from "@/inngest/client";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

type PipelineLogStatus = "started" | "completed" | "failed" | "skipped";
type EnhancedImageResult = {
  imageId: string;
  orderIndex: number;
  outputMimeType?: string;
  outputStorageKey: string;
  skipped: boolean;
};
type KlingCameraMove = "orbit" | "pan" | "push_in" | "multi_shot";
type GeneratedClipResult = {
  cameraMove?: KlingCameraMove;
  clipStorageKey: string;
  durationSeconds?: number;
  imageId: string;
  orderIndex: number;
  skipped: boolean;
};

const IMAGE_REQUIREMENTS = getVideoImageRequirements();
const UPSCALING_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/upscaling.md",
);
const KLING_PROMPT_RULES_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/kling.md",
);

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

function buildUpscalingPrompt(markdown: string, notes: string | null) {
  if (!notes) {
    return markdown;
  }

  return `${markdown}\n\nCLIENT NOTES:\n${notes}`;
}

function buildClipStorageKey(enhancedStorageKey: string) {
  const clipKey = enhancedStorageKey.replace("/enhanced/", "/clips/");

  if (/\.[a-z0-9]+$/i.test(clipKey)) {
    return clipKey.replace(/\.[a-z0-9]+$/i, ".kling-stub.json");
  }

  return `${clipKey}.kling-stub.json`;
}

function chooseKlingCameraMove({
  imageCount,
  orderIndex,
  promptType,
  specialNotes,
}: {
  imageCount: number;
  orderIndex: number;
  promptType: string | null;
  specialNotes: string | null;
}): KlingCameraMove {
  const notes = specialNotes?.toLowerCase() ?? "";

  if (promptType === "multi_shot" && imageCount > 1) {
    return "multi_shot";
  }

  if (notes.includes("detail") || notes.includes("material")) {
    return "pan";
  }

  if (orderIndex === 0) {
    return "push_in";
  }

  return "orbit";
}

function buildKlingPromptDecision({
  enhancedBytes,
  enhancedMimeType,
  imageCount,
  orderIndex,
  promptRules,
  promptType,
  specialNotes,
}: {
  enhancedBytes: number;
  enhancedMimeType: string;
  imageCount: number;
  orderIndex: number;
  promptRules: string;
  promptType: string | null;
  specialNotes: string | null;
}) {
  const cameraMove = chooseKlingCameraMove({
    imageCount,
    orderIndex,
    promptType,
    specialNotes,
  });
  const durationSeconds = cameraMove === "multi_shot" ? 6 : 5;

  return {
    cameraMove,
    durationSeconds,
    prompt: [
      buildKlingFurniturePrompt(cameraMove),
      "Use the enhanced still as the absolute visual reference.",
      "Do not redesign the room, do not move furniture, do not alter materials, and do not shift colors.",
      "Motion must be subtle, premium, physically plausible, and suitable for a real-estate/interior sales film.",
      specialNotes ? `Client notes: ${specialNotes}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    rationale: [
      `Selected ${cameraMove} from ${imageCount} image(s), order index ${orderIndex}, prompt type ${promptType ?? "unknown"}.`,
      `Enhanced asset is ${enhancedMimeType} with ${enhancedBytes} bytes.`,
      `Applied ${promptRules.length} characters of Kling prompt rules.`,
    ].join(" "),
    rulesPath: KLING_PROMPT_RULES_PATH,
  };
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

export const projectPipeline = inngest.createFunction(
  {
    id: "project-pipeline",
    name: "Project Pipeline",
    retries: 2,
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
          "id, organization_id, status, credit_reservation_id, customer_name, voice_selection, special_notes",
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
          "id, original_storage_key, upscaled_storage_key, video_storage_key, order_index, prompt_type, video_status",
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
        async () =>
          buildUpscalingPrompt(
            await readFile(UPSCALING_PROMPT_PATH, "utf8"),
            context.project.special_notes,
          ),
      );

      const upscalingPlan = await step.run("prepare-upscaling-plan", () => ({
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

      const enhancedImages: EnhancedImageResult[] = [];

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

            const result = await enhanceImageWithNanoBananaPro({
              aspectRatio: "16:9",
              prompt: upscalingPrompt,
              sourceImage: sourceBytes,
              sourceMimeType,
              sourceStorageKey: image.original_storage_key,
              targetResolution: "2K",
            });

            const outputStorageKey = buildEnhancedStorageKey(
              image.original_storage_key,
              result.outputMimeType,
            );
            const outputArrayBuffer = result.outputImage.buffer.slice(
              result.outputImage.byteOffset,
              result.outputImage.byteOffset + result.outputImage.byteLength,
            ) as ArrayBuffer;

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
                analysis: {
                  aspectRatio: "16:9",
                  model: result.model,
                  provider: result.provider,
                  sourceMimeType,
                  targetResolution: "2K",
                },
                upscaled_storage_key: outputStorageKey,
                video_status: "upscaled",
              })
              .eq("id", image.id);

            if (updateError) {
              throw updateError;
            }

            await writePipelineLog({
              message: `Image ${image.order_index + 1} enhanced and stored.`,
              metadata: {
                imageId: image.id,
                outputMimeType: result.outputMimeType,
                outputStorageKey,
                provider: result.provider,
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

    await step.run("start-video-generation", async () => {
      await updateProjectStatus(projectId, "generating_video");
      await writePipelineLog({
        message: "Kling video generation step started.",
        metadata: {
          imageCount: context.images.length,
          mode: "stub",
          provider: AI_PROVIDERS.imageToVideo.primary,
        },
        projectId,
        status: "started",
        step: "video_generation",
      });
    });

    const klingPromptRules = await step.run("load-kling-prompt-rules", () =>
      readFile(KLING_PROMPT_RULES_PATH, "utf8"),
    );

    const generatedClips: GeneratedClipResult[] = [];

    for (const image of context.images) {
      const generatedClip = await step.run(
        `generate-kling-clip-${image.order_index + 1}`,
        async () => {
          const supabase = createAdminClient();

          if (image.video_storage_key) {
            await writePipelineLog({
              message: `Image ${image.order_index + 1} already has a video clip artifact. Skipping regeneration.`,
              metadata: {
                imageId: image.id,
                videoStorageKey: image.video_storage_key,
              },
              projectId,
              status: "skipped",
              step: "video_generation",
            });

            return {
              clipStorageKey: image.video_storage_key,
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

          const { data: enhancedFile, error: downloadError } =
            await supabase.storage
              .from(STORAGE_BUCKETS.sourceAssets)
              .download(image.upscaled_storage_key);

          if (downloadError) {
            throw downloadError;
          }

          const enhancedBytes = await enhancedFile.arrayBuffer();
          const enhancedMimeType =
            enhancedFile.type || inferImageMimeType(image.upscaled_storage_key);
          const decision = buildKlingPromptDecision({
            enhancedBytes: enhancedBytes.byteLength,
            enhancedMimeType,
            imageCount: context.images.length,
            orderIndex: image.order_index,
            promptRules: klingPromptRules,
            promptType: image.prompt_type,
            specialNotes: context.project.special_notes,
          });
          const clipStorageKey = buildClipStorageKey(
            image.upscaled_storage_key,
          );
          const artifact = {
            createdAt: new Date().toISOString(),
            decision,
            enhancedInput: {
              bytes: enhancedBytes.byteLength,
              mimeType: enhancedMimeType,
              storageKey: image.upscaled_storage_key,
            },
            imageId: image.id,
            kind: "kling_stub_clip",
            model: AI_PROVIDERS.imageToVideo.primary,
            orderIndex: image.order_index,
            projectId,
            provider: AI_PROVIDERS.imageToVideo.primary,
            version: 1,
          };
          const artifactBody = JSON.stringify(artifact, null, 2);

          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKETS.generatedClips)
            .upload(
              clipStorageKey,
              new Blob([artifactBody], {
                type: "application/json",
              }),
              {
                contentType: "application/json",
                upsert: true,
              },
            );

          if (uploadError) {
            throw uploadError;
          }

          const { error: updateError } = await supabase
            .from("project_images")
            .update({
              video_storage_key: clipStorageKey,
              video_status: "clip_stubbed",
            })
            .eq("id", image.id);

          if (updateError) {
            throw updateError;
          }

          await writePipelineLog({
            message: `Kling prompt agent prepared clip ${image.order_index + 1}.`,
            metadata: {
              cameraMove: decision.cameraMove,
              clipStorageKey,
              durationSeconds: decision.durationSeconds,
              imageId: image.id,
              mode: "stub",
              prompt: decision.prompt,
              provider: AI_PROVIDERS.imageToVideo.primary,
              rationale: decision.rationale,
            },
            projectId,
            status: "completed",
            step: "video_generation",
          });

          return {
            cameraMove: decision.cameraMove,
            clipStorageKey,
            durationSeconds: decision.durationSeconds,
            imageId: image.id,
            orderIndex: image.order_index,
            skipped: false,
          };
        },
      );

      generatedClips.push(generatedClip);
    }

    await step.run("complete-video-generation-stub", async () => {
      await updateProjectStatus(projectId, "media_qc");
      await writePipelineLog({
        message:
          "Kling video generation stub completed. Clip artifacts are ready for media QC.",
        metadata: {
          generatedClips,
          mode: "stub",
          nextStatus: "media_qc",
          promptRulesPath: KLING_PROMPT_RULES_PATH,
          provider: AI_PROVIDERS.imageToVideo.primary,
        },
        projectId,
        status: "completed",
        step: "video_generation",
      });
    });

    return {
      clipCount: generatedClips.length,
      imageCount: context.images.length,
      ok: true,
      projectId,
      status: "media_qc",
    };
  },
);
