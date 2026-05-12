import { AI_PROVIDERS, getVideoImageRequirements } from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import {
  createKieKling30Task,
  enhanceImageWithNanoBananaPro,
  getKieTaskRecord,
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
type GeneratedClipResult = {
  clipStorageKey: string;
  creditsConsumed?: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
  imageId: string;
  orderIndex: number;
  skipped: boolean;
  taskId?: string;
};

const IMAGE_REQUIREMENTS = getVideoImageRequirements();
const UPSCALING_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/upscaling.md",
);
const SINGLE_SHOT_PROMPT_PATH = path.join(
  process.cwd(),
  "src/inngest/prompts/single-shot.md",
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
    videoStatus === "clip_generated" &&
    Boolean(videoStorageKey) &&
    !videoStorageKey?.endsWith(".json")
  );
}

function getVideoContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";")[0];

  if (contentType?.startsWith("video/")) {
    return contentType;
  }

  return "video/mp4";
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
        "editing",
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
      async () => (await readFile(SINGLE_SHOT_PROMPT_PATH, "utf8")).trim(),
    );

    const generatedClips: GeneratedClipResult[] = [];

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

          const { error: startUpdateError } = await supabase
            .from("project_images")
            .update({
              video_status: "generating",
            })
            .eq("id", image.id);

          if (startUpdateError) {
            throw startUpdateError;
          }

          const task = await createKieKling30Task({
            aspectRatio: KLING_SINGLE_SHOT_TEST_CONFIG.aspectRatio,
            durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
            imageUrls: [signedImage.signedUrl],
            mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
            multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
            prompt: singleShotPrompt,
            sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
          });

          await writePipelineLog({
            message: `Kling 3.0 Pro task created for image ${image.order_index + 1}.`,
            metadata: {
              clipStorageKey,
              durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
              imageId: image.id,
              mode: KLING_SINGLE_SHOT_TEST_CONFIG.mode,
              model: "kling-3.0/video",
              multiShots: KLING_SINGLE_SHOT_TEST_CONFIG.multiShots,
              promptPath: SINGLE_SHOT_PROMPT_PATH,
              provider: AI_PROVIDERS.imageToVideo.primary,
              sound: KLING_SINGLE_SHOT_TEST_CONFIG.sound,
              taskId: task.taskId,
            },
            projectId,
            status: "started",
            step: "video_generation",
          });

          return {
            clipStorageKey,
            durationSeconds: KLING_SINGLE_SHOT_TEST_CONFIG.durationSeconds,
            imageId: image.id,
            orderIndex: image.order_index,
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

      if (!("taskId" in taskPreparation) || !taskPreparation.taskId) {
        throw new Error(
          `Kling task was not created for image ${image.order_index + 1}.`,
        );
      }

      const activeTask = {
        clipStorageKey: taskPreparation.clipStorageKey,
        durationSeconds: taskPreparation.durationSeconds,
        imageId: taskPreparation.imageId,
        orderIndex: taskPreparation.orderIndex,
        taskId: taskPreparation.taskId,
      };

      let taskRecord = null as Awaited<ReturnType<typeof getKieTaskRecord>> | null;

      for (let pollIndex = 1; pollIndex <= KLING_MAX_POLLS; pollIndex += 1) {
        taskRecord = await step.run(
          `poll-kling-clip-${image.order_index + 1}-${String(pollIndex).padStart(
            2,
            "0",
          )}`,
          () => getKieTaskRecord(activeTask.taskId),
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
                taskId: activeTask.taskId,
              },
              projectId,
              status: "failed",
              step: "video_generation",
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
              taskId: activeTask.taskId,
            },
            projectId,
            status: "failed",
            step: "video_generation",
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
        },
      );

      generatedClips.push(generatedClip);
    }

    await step.run("complete-video-generation", async () => {
      await updateProjectStatus(projectId, "editing");
      await writePipelineLog({
        message:
          "Kling video generation completed. Clip artifacts are ready for editing.",
        metadata: {
          generatedClips,
          mode: "real",
          nextStatus: "editing",
          promptPath: SINGLE_SHOT_PROMPT_PATH,
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
      status: "editing",
    };
  },
);
