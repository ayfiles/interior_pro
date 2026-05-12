"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import type { VideoImageRequirements } from "@interior-pro/shared";
import { projectStoragePrefix, STORAGE_BUCKETS } from "@interior-pro/supabase";
import { enqueueProjectPipeline } from "@/app/actions/projects";
import { createClient } from "@/lib/supabase/client";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

type ToastKind = "error" | "info" | "success";

interface ToastState {
  action?: ReactNode;
  kind: ToastKind;
  message: string;
  title: string;
}

interface NewProjectFormProps {
  imageRequirements: VideoImageRequirements;
  organizationId: string;
}

function safeFileName(fileName: string, index: number) {
  const cleanName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${String(index + 1).padStart(2, "0")}-${Date.now()}-${
    cleanName || "image"
  }`;
}

function fileSizeLabel(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(caughtError: unknown) {
  return caughtError instanceof Error
    ? caughtError.message
    : "Project creation failed.";
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return <CheckCircle2 className="size-5 text-[#80d9b7]" />;
  }

  if (kind === "error") {
    return <XCircle className="size-5 text-[#ff9aaa]" />;
  }

  return <AlertCircle className="size-5 text-[var(--brass)]" />;
}

export function NewProjectForm({
  imageRequirements,
  organizationId,
}: NewProjectFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const totalSteps = selectedFiles.length + 4;
  const progressPercent =
    totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;

  useEffect(() => {
    if (!isSubmitting) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSubmitting]);

  function showToast(nextToast: ToastState) {
    setToast(nextToast);
  }

  function validateImages(images: File[]) {
    if (
      images.length < imageRequirements.minImages ||
      images.length > imageRequirements.maxImages
    ) {
      return `Upload ${imageRequirements.minImages}-${imageRequirements.maxImages} product images.`;
    }

    const invalidImage = images.find(
      (file) =>
        !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES,
    );

    if (invalidImage) {
      return `${invalidImage.name} is not valid. Use JPG, PNG, WebP, or HEIC below 50 MB.`;
    }

    return null;
  }

  async function markProjectFailed(projectId: string, message: string) {
    await supabase
      .from("projects")
      .update({
        error_message: message,
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    await supabase.from("pipeline_logs").insert({
      message,
      project_id: projectId,
      status: "failed",
      step: "intake",
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const customerName = String(formData.get("customerName") ?? "").trim();
    const voiceSelection = String(formData.get("voiceSelection") ?? "").trim();
    const specialNotes = String(formData.get("specialNotes") ?? "").trim();
    const images = selectedFiles.filter((file) => file.size > 0);
    const validationError = validateImages(images);

    setCreatedProjectId(null);
    setCurrentStep(0);
    setStatusText(null);

    if (!customerName) {
      showToast({
        kind: "error",
        message: "Add a customer or collection name before uploading.",
        title: "Missing project name",
      });
      return;
    }

    if (validationError) {
      showToast({
        kind: "error",
        message: validationError,
        title: "Images need attention",
      });
      return;
    }

    setIsSubmitting(true);
    showToast({
      kind: "info",
      message: "Creating a project draft before uploading the files.",
      title: "Starting upload",
    });

    const projectId = crypto.randomUUID();
    const prefix = projectStoragePrefix(organizationId, projectId);
    const uploadedKeys: string[] = [];
    let projectWasCreated = false;

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Please sign in again before creating a project.");
      }

      setStatusText("Creating project draft");
      setCurrentStep(1);

      const { error: projectError } = await supabase.from("projects").insert({
        created_by: user.id,
        customer_name: customerName,
        id: projectId,
        organization_id: organizationId,
        special_notes: specialNotes || null,
        status: "draft",
        voice_selection: voiceSelection || "warm_editorial",
      });

      if (projectError) {
        throw projectError;
      }

      projectWasCreated = true;
      setCreatedProjectId(projectId);
      showToast({
        kind: "info",
        message: "Draft saved. Uploading source images now.",
        title: "Project draft created",
      });

      for (const [index, file] of images.entries()) {
        setCurrentStep(index + 2);
        setStatusText(`Uploading ${index + 1}/${images.length}: ${file.name}`);

        const storageKey = `${prefix}/source/${safeFileName(file.name, index)}`;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKETS.sourceAssets)
          .upload(storageKey, file, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        uploadedKeys.push(storageKey);

        const { error: imageError } = await supabase
          .from("project_images")
          .insert({
            order_index: index,
            original_storage_key: storageKey,
            project_id: projectId,
            prompt_type: "multi_shot",
          });

        if (imageError) {
          await supabase.storage
            .from(STORAGE_BUCKETS.sourceAssets)
            .remove([storageKey]);
          throw imageError;
        }
      }

      setCurrentStep(images.length + 2);
      setStatusText("Reserving one pilot credit");

      const { error: reservationError } = await supabase
        .from("credit_reservations")
        .insert({
          amount: 1,
          organization_id: organizationId,
          project_id: projectId,
          status: "reserved",
        });

      if (reservationError) {
        throw reservationError;
      }

      setCurrentStep(images.length + 3);
      setStatusText("Finalizing project");

      const { error: logError } = await supabase.from("pipeline_logs").insert({
        message: `${uploadedKeys.length} source images uploaded`,
        metadata: {
          imageEnhancement: "nano-banana-pro",
          imageToVideo: "kling-3.0",
        },
        project_id: projectId,
        status: "completed",
        step: "intake",
      });

      if (logError) {
        throw logError;
      }

      const { error: submitError } = await supabase
        .from("projects")
        .update({
          status: "submitted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      if (submitError) {
        throw submitError;
      }

      setCurrentStep(images.length + 4);
      setStatusText("Queueing pipeline");

      const enqueueResult = await enqueueProjectPipeline(projectId);

      if (!enqueueResult.ok) {
        throw new Error(enqueueResult.error);
      }

      setCurrentStep(totalSteps);
      setStatusText("Project created. Opening detail view.");
      showToast({
        kind: "success",
        message: "Uploads, database records, credit reservation, intake log, and pipeline event are saved.",
        title: "Project created",
      });

      router.push(`/projects/${projectId}?created=1`);
      router.refresh();
    } catch (caughtError) {
      const message = errorMessage(caughtError);

      if (projectWasCreated) {
        await markProjectFailed(createdProjectId ?? projectId, message);
      }

      showToast({
        action:
          projectWasCreated ? (
            <button
              className="mt-3 rounded-md border border-white/15 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-white/10"
              onClick={() => router.push(`/projects/${createdProjectId ?? projectId}`)}
              type="button"
            >
              Open failed project
            </button>
          ) : null,
        kind: "error",
        message,
        title: "Project creation failed",
      });
      setStatusText(null);
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form className="grid gap-5" onSubmit={handleSubmit}>
        {statusText ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-[var(--brass)]/40 bg-[rgba(214,173,95,0.12)] p-4"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-[var(--brass)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {statusText}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Keep this tab open until the confirmation appears.
                </p>
              </div>
            </div>
            <div className="mt-4 h-2 rounded-full bg-[#2a2118]">
              <div
                className="h-2 rounded-full bg-[var(--brass)] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-sm text-[var(--muted)]">
            Customer or collection name
          </span>
          <input
            className="mt-2 h-12 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
            disabled={isSubmitting}
            name="customerName"
            placeholder="Maison Vale winter collection"
            required
          />
        </label>

        <div className="grid gap-5 md:grid-cols-2">
          <label className="block">
            <span className="text-sm text-[var(--muted)]">Voice direction</span>
            <select
              className="mt-2 h-12 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
              defaultValue="warm_editorial"
              disabled={isSubmitting}
              name="voiceSelection"
              required
            >
              <option value="warm_editorial">Warm editorial</option>
              <option value="quiet_luxury">Quiet luxury</option>
              <option value="architectural">Architectural</option>
              <option value="showroom_director">Showroom director</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-[var(--muted)]">Source images</span>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="mt-2 block h-12 w-full cursor-pointer rounded-md border border-[var(--line)] bg-black/25 px-3 py-3 text-sm text-[var(--muted)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brass)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[#19130b] hover:border-[var(--brass)]"
              disabled={isSubmitting}
              multiple
              name="images"
              onChange={(event) => {
                const nextFiles = Array.from(event.currentTarget.files ?? []);
                setSelectedFiles(nextFiles);
                setStatusText(null);
                setCurrentStep(0);

                showToast({
                  kind: "info",
                  message: `${nextFiles.length} files selected. Click Create project to start uploading.`,
                  title: "Images selected",
                });
              }}
              required
              type="file"
            />
          </label>
        </div>

        {selectedFiles.length ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm text-[var(--muted)]">
              {selectedFiles.length} selected
            </p>
            <div className="mt-2 grid gap-2">
              {selectedFiles.map((file) => (
                <div
                  className="flex items-center justify-between gap-3 text-xs text-[var(--stone)]"
                  key={`${file.name}-${file.lastModified}`}
                >
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-[var(--muted)]">
                    {fileSizeLabel(file.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-sm text-[var(--muted)]">Sales notes</span>
          <textarea
            className="mt-2 min-h-32 w-full rounded-md border border-[var(--line)] bg-black/25 px-3 py-3 text-sm leading-6 text-[var(--foreground)] outline-none transition focus:border-[var(--brass)]"
            disabled={isSubmitting}
            name="specialNotes"
            placeholder="Materials, room context, price story, details the sales team should emphasize."
          />
        </label>

        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[var(--brass)] px-5 text-sm font-semibold text-[#19130b] transition hover:bg-[#e6c57d] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {isSubmitting ? "Working..." : "Create project"}
        </button>
      </form>

      {toast ? (
        <div
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
          className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-white/15 bg-[rgba(20,17,14,0.96)] p-4 shadow-2xl shadow-black/40 backdrop-blur sm:left-auto sm:w-[380px]"
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <div className="flex items-start gap-3">
            <ToastIcon kind={toast.kind} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {toast.title}
              </p>
              <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                {toast.message}
              </p>
              {toast.action}
            </div>
            {!isSubmitting ? (
              <button
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={() => setToast(null)}
                type="button"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
