import { AI_PROVIDERS } from "@interior-pro/shared";
import { STORAGE_BUCKETS } from "@interior-pro/supabase";
import { getKieTaskRecord } from "@interior-pro/pipeline";
import {
  KIE_CALLBACK_RECEIVED_EVENT,
  PROJECT_SUBMITTED_EVENT,
  type KieCallbackReceivedEventData,
  inngest,
} from "@/inngest/client";
import { extractKieResultUrls } from "@/inngest/kie-callback";
import {
  estimateKieCostUsd,
  getErrorMessage,
  getProviderJobById,
  updateProviderJob,
} from "@/inngest/provider-jobs";
import { createAdminClient, type Json } from "@/lib/supabase/admin";

type PipelineLogStatus = "started" | "completed" | "failed" | "skipped";

interface ProjectImageRow {
  id: string;
  order_index: number;
  project_id: string;
  upscaled_storage_key: string | null;
  video_storage_key: string | null;
  video_status: string;
}

function getVideoContentType(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";")[0];

  if (contentType?.startsWith("video/")) {
    return contentType;
  }

  return "video/mp4";
}

function getResponseResultUrls(response: Json) {
  return extractKieResultUrls(response);
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

export const kieCallbackProcessor = inngest.createFunction(
  {
    id: "kie-callback-processor",
    name: "KIE Callback Processor",
    retries: 0,
    triggers: { event: KIE_CALLBACK_RECEIVED_EVENT },
  },
  async ({ event, step }) => {
    const data = event.data as KieCallbackReceivedEventData;

    const context = await step.run("load-kie-provider-job", async () => {
      const supabase = createAdminClient();
      const providerJob = await getProviderJobById(data.providerJobId);

      if (providerJob.external_task_id !== data.taskId) {
        throw new Error(
          `KIE callback task id ${data.taskId} does not match provider job ${providerJob.id}.`,
        );
      }

      if (!providerJob.project_image_id) {
        throw new Error(
          `KIE provider job ${providerJob.id} has no project image id.`,
        );
      }

      const { data: image, error: imageError } = await supabase
        .from("project_images")
        .select(
          "id, project_id, upscaled_storage_key, video_storage_key, video_status, order_index",
        )
        .eq("id", providerJob.project_image_id)
        .single();

      if (imageError) {
        throw imageError;
      }

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("organization_id")
        .eq("id", providerJob.project_id)
        .single();

      if (projectError) {
        throw projectError;
      }

      return {
        image: image as ProjectImageRow,
        project,
        providerJob,
      };
    });

    if (
      context.providerJob.status === "completed" &&
      context.providerJob.output_storage_key
    ) {
      await step.run("skip-completed-kie-provider-job", () =>
        writePipelineLog({
          message: `KIE callback ignored because clip ${context.image.order_index + 1} is already stored.`,
          metadata: {
            providerJobId: context.providerJob.id,
            taskId: data.taskId,
            videoStorageKey: context.providerJob.output_storage_key,
          },
          projectId: context.providerJob.project_id,
          status: "skipped",
          step: "video_generation",
        }),
      );

      return {
        ok: true,
        skipped: true,
        status: "completed",
      };
    }

    const taskRecord = await step.run("refresh-kie-task-record", () =>
      getKieTaskRecord(data.taskId),
    );

    if (taskRecord.state === "fail" || taskRecord.state === "failed") {
      await step.run("mark-kie-callback-failed", async () => {
        const supabase = createAdminClient();
        const message =
          taskRecord.failMsg ?? `KIE task ${data.taskId} failed.`;

        await updateProviderJob(context.providerJob.id, {
          error_message: message,
          failed_at: new Date().toISOString(),
          response: {
            failCode: taskRecord.failCode ?? null,
            failMsg: taskRecord.failMsg ?? null,
            resultJson: taskRecord.resultJson ?? null,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          status: "failed",
        });

        const { error: imageError } = await supabase
          .from("project_images")
          .update({
            video_status: "failed",
          })
          .eq("id", context.image.id);

        if (imageError) {
          throw imageError;
        }

        const { error: projectError } = await supabase
          .from("projects")
          .update({
            error_message: message,
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", context.providerJob.project_id);

        if (projectError) {
          throw projectError;
        }

        await writePipelineLog({
          message,
          metadata: {
            failCode: taskRecord.failCode,
            providerJobId: context.providerJob.id,
            taskId: data.taskId,
          },
          projectId: context.providerJob.project_id,
          status: "failed",
          step: "video_generation",
        });
      });

      return {
        ok: false,
        status: "failed",
      };
    }

    if (taskRecord.state !== "success") {
      await step.run("mark-kie-callback-still-processing", async () => {
        await updateProviderJob(context.providerJob.id, {
          response: {
            resultJson: taskRecord.resultJson ?? null,
            resultUrls: taskRecord.resultUrls,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          status: "processing",
        });

        await writePipelineLog({
          message: `KIE callback received while task ${data.taskId} is still ${taskRecord.state}.`,
          metadata: {
            providerJobId: context.providerJob.id,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          projectId: context.providerJob.project_id,
          status: "started",
          step: "video_generation",
        });
      });

      return {
        ok: true,
        status: taskRecord.state,
      };
    }

    const clipStorageKey =
      context.providerJob.output_storage_key ??
      context.image.video_storage_key ??
      null;
    const resultUrls = [
      ...taskRecord.resultUrls,
      ...data.resultUrls,
      ...getResponseResultUrls(context.providerJob.response),
    ];
    const resultUrl = resultUrls[0];

    if (!clipStorageKey || !resultUrl) {
      await step.run("mark-kie-callback-missing-output", async () => {
        const message = !clipStorageKey
          ? `KIE provider job ${context.providerJob.id} has no output storage key.`
          : `KIE task ${data.taskId} completed without a result URL.`;

        await updateProviderJob(context.providerJob.id, {
          error_message: message,
          response: {
            resultJson: taskRecord.resultJson ?? null,
            resultUrls,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          status: "requires_manual_retry",
        });

        await writePipelineLog({
          message,
          metadata: {
            providerJobId: context.providerJob.id,
            taskId: data.taskId,
          },
          projectId: context.providerJob.project_id,
          status: "failed",
          step: "video_generation",
        });
      });

      return {
        ok: false,
        status: "requires_manual_retry",
      };
    }

    const generatedClip = await step.run("store-kie-callback-clip", async () => {
      const supabase = createAdminClient();

      try {
        const resultResponse = await fetch(resultUrl);

        if (!resultResponse.ok) {
          throw new Error(
            `Failed to download KIE result (${resultResponse.status}): ${resultResponse.statusText}`,
          );
        }

        const contentType = getVideoContentType(resultResponse);
        const clipBytes = await resultResponse.arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKETS.generatedClips)
          .upload(
            clipStorageKey,
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

        const { error: imageError } = await supabase
          .from("project_images")
          .update({
            video_storage_key: clipStorageKey,
            video_status: "clip_generated",
          })
          .eq("id", context.image.id);

        if (imageError) {
          throw imageError;
        }

        await updateProviderJob(context.providerJob.id, {
          completed_at: new Date().toISOString(),
          credits_consumed: taskRecord.creditsConsumed ?? null,
          estimated_cost_usd: estimateKieCostUsd(taskRecord.creditsConsumed),
          file_size_bytes: clipBytes.byteLength,
          output_storage_key: clipStorageKey,
          response: {
            completeTime: taskRecord.completeTime ?? null,
            contentType,
            costTime: taskRecord.costTime ?? null,
            creditsConsumed: taskRecord.creditsConsumed ?? null,
            fileSizeBytes: clipBytes.byteLength,
            model: taskRecord.model ?? "kling-3.0/video",
            provider: AI_PROVIDERS.imageToVideo.primary,
            resultJson: taskRecord.resultJson ?? null,
            resultUrls,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          status: "completed",
        });

        await writePipelineLog({
          message: `KIE callback stored Kling clip ${context.image.order_index + 1}.`,
          metadata: {
            clipStorageKey,
            contentType,
            creditsConsumed: taskRecord.creditsConsumed,
            fileSizeBytes: clipBytes.byteLength,
            provider: AI_PROVIDERS.imageToVideo.primary,
            providerJobId: context.providerJob.id,
            taskId: data.taskId,
          },
          projectId: context.providerJob.project_id,
          status: "completed",
          step: "video_generation",
        });

        return {
          clipStorageKey,
          fileSizeBytes: clipBytes.byteLength,
        };
      } catch (error) {
        await updateProviderJob(context.providerJob.id, {
          error_message: getErrorMessage(error),
          output_storage_key: clipStorageKey,
          response: {
            resultJson: taskRecord.resultJson ?? null,
            resultUrls,
            state: taskRecord.state,
            taskId: data.taskId,
          },
          status: "requires_manual_retry",
        });

        throw error;
      }
    });

    const clipReadiness = await step.run("check-kie-clip-readiness", async () => {
      const supabase = createAdminClient();
      const { data: expectedJobs, error: expectedJobsError } = await supabase
        .from("provider_jobs")
        .select("project_image_id")
        .eq("project_id", context.providerJob.project_id)
        .eq("step", "video_generation")
        .not("project_image_id", "is", null);

      if (expectedJobsError) {
        throw expectedJobsError;
      }

      const expectedImageIds = Array.from(
        new Set(
          (expectedJobs ?? [])
            .map((job) => job.project_image_id)
            .filter((imageId): imageId is string => Boolean(imageId)),
        ),
      );
      const fallbackImageIds = context.providerJob.project_image_id
        ? [context.providerJob.project_image_id]
        : [];
      const expectedClipImageIds = expectedImageIds.length
        ? expectedImageIds
        : fallbackImageIds;

      const { data: images, error: imagesError } = expectedClipImageIds.length
        ? await supabase
            .from("project_images")
            .select("id, video_storage_key, video_status")
            .in("id", expectedClipImageIds)
        : { data: [], error: null };

      if (imagesError) {
        throw imagesError;
      }

      const imageRows = (images ?? []) as Array<{
        id: string;
        video_storage_key: string | null;
        video_status: string;
      }>;
      const readyImages = imageRows.filter(
        (image) =>
          Boolean(image.video_storage_key) &&
          ["clip_generated", "qc_passed"].includes(image.video_status) &&
          !image.video_storage_key?.endsWith(".json"),
      );
      const pendingImages = imageRows.filter(
        (image) => !readyImages.some((readyImage) => readyImage.id === image.id),
      );

      if (pendingImages.length > 0) {
        await writePipelineLog({
          message: `KIE callback stored clip ${context.image.order_index + 1}; waiting for ${pendingImages.length} remaining clip${pendingImages.length === 1 ? "" : "s"}.`,
          metadata: {
            pendingImageIds: pendingImages.map((image) => image.id),
            readyClipCount: readyImages.length,
            totalClipCount: imageRows.length,
          },
          projectId: context.providerJob.project_id,
          status: "started",
          step: "video_generation",
        });

        return {
          ready: false,
          readyClipCount: readyImages.length,
          shouldResumePipeline: false,
          totalClipCount: imageRows.length,
        };
      }

      const { data: transitionedProject, error: projectError } = await supabase
        .from("projects")
        .update({
          error_message: null,
          status: "media_qc",
          updated_at: new Date().toISOString(),
        })
        .eq("id", context.providerJob.project_id)
        .eq("status", "generating_video")
        .select("id")
        .maybeSingle();

      if (projectError) {
        throw projectError;
      }

      if (!transitionedProject) {
        await writePipelineLog({
          message:
            "All KIE callback clips are stored; media QC resume was already claimed.",
          metadata: {
            readyClipCount: readyImages.length,
            totalClipCount: imageRows.length,
          },
          projectId: context.providerJob.project_id,
          status: "skipped",
          step: "video_generation",
        });

        return {
          ready: true,
          readyClipCount: readyImages.length,
          shouldResumePipeline: false,
          totalClipCount: imageRows.length,
        };
      }

      await writePipelineLog({
        message: "All KIE callback clips are stored. Project is ready for media QC.",
        metadata: {
          readyClipCount: readyImages.length,
          totalClipCount: imageRows.length,
        },
        projectId: context.providerJob.project_id,
        status: "completed",
        step: "video_generation",
      });

      return {
        ready: true,
        readyClipCount: readyImages.length,
        shouldResumePipeline: true,
        totalClipCount: imageRows.length,
      };
    });

    if (!clipReadiness.ready) {
      return {
        ...generatedClip,
        ok: true,
        status: "generating_video",
      };
    }

    if (!clipReadiness.shouldResumePipeline) {
      return {
        ...generatedClip,
        ok: true,
        status: "media_qc",
      };
    }

    await step.sendEvent("resume-project-media-qc", {
      name: PROJECT_SUBMITTED_EVENT,
      data: {
        imageCount: clipReadiness.readyClipCount,
        organizationId: context.project.organization_id,
        projectId: context.providerJob.project_id,
        submittedBy: "kie-callback-processor",
      },
    });

    return {
      ...generatedClip,
      ok: true,
      status: "media_qc",
    };
  },
);
