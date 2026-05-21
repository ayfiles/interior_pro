import { AI_PROVIDERS } from "@interior-pro/shared";

const KIE_API_BASE_URL = process.env.KIE_API_BASE_URL ?? "https://api.kie.ai";
const KIE_FILE_UPLOAD_BASE_URL =
  process.env.KIE_FILE_UPLOAD_BASE_URL ?? "https://kieai.redpandaai.co";

export interface KlingVideoInput {
  enhancedImageUrl: string;
  enhancedImageStorageKey: string;
  prompt: string;
  durationSeconds: number;
  cameraMove: "orbit" | "pan" | "push_in" | "multi_shot";
}

export interface KlingVideoResult {
  provider: typeof AI_PROVIDERS.imageToVideo.primary;
  clipStorageKey: string;
  durationSeconds: number;
  taskId: string;
}

export interface KieUrlUploadInput {
  fileName: string;
  fileUrl: string;
  uploadPath: string;
}

export interface KieUploadedFile {
  downloadUrl: string;
  fileName: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt?: string;
}

export interface KieKlingMultiPrompt {
  duration: number;
  prompt: string;
}

export interface KieKlingTaskInput {
  aspectRatio?: "16:9" | "9:16" | "1:1";
  callBackUrl?: string;
  durationSeconds: number;
  imageUrls: string[];
  mode?: "std" | "pro" | "4K";
  multiPrompt?: KieKlingMultiPrompt[];
  multiShots: boolean;
  prompt: string;
  sound?: boolean;
}

export interface KieKlingTask {
  provider: "kie.ai";
  taskId: string;
}

export type ArchitecturalKlingMultiPromptVariant =
  | "five_scene"
  | "three_scene";

export type KieTaskState =
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "fail";

export interface KieTaskRecord {
  completeTime?: number;
  costTime?: number;
  createTime?: number;
  creditsConsumed?: number;
  failCode?: string;
  failMsg?: string;
  model?: string;
  progress?: number;
  resultJson?: string;
  resultUrls: string[];
  state: KieTaskState | string;
  taskId: string;
  updateTime?: number;
}

interface KieApiResponse<T> {
  code: number;
  data?: T;
  msg?: string;
  success?: boolean;
}

function getKieApiKey() {
  const apiKey = process.env.KIE_API_KEY;

  if (!apiKey) {
    throw new Error("KIE_API_KEY is required for KIE Kling 3.0 generation.");
  }

  return apiKey;
}

async function readKieJson<T>(response: Response) {
  const body = (await response.json()) as KieApiResponse<T>;
  const successfulBody =
    body.code === 200 || body.success === true || body.msg === "success";

  if (!response.ok || !successfulBody || !body.data) {
    throw new Error(
      `KIE API request failed (${response.status}): ${body.msg ?? response.statusText}`,
    );
  }

  return body.data;
}

export async function uploadUrlToKie(
  input: KieUrlUploadInput,
): Promise<KieUploadedFile> {
  const response = await fetch(
    `${KIE_FILE_UPLOAD_BASE_URL}/api/file-url-upload`,
    {
      body: JSON.stringify({
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        uploadPath: input.uploadPath,
      }),
      headers: {
        Authorization: `Bearer ${getKieApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  return readKieJson<KieUploadedFile>(response);
}

export async function createKieKling30Task(
  input: KieKlingTaskInput,
): Promise<KieKlingTask> {
  const response = await fetch(`${KIE_API_BASE_URL}/api/v1/jobs/createTask`, {
    body: JSON.stringify({
      callBackUrl: input.callBackUrl,
      input: {
        aspect_ratio: input.aspectRatio ?? "16:9",
        duration: String(input.durationSeconds),
        image_urls: input.imageUrls,
        mode: input.mode ?? "pro",
        multi_prompt: input.multiPrompt,
        multi_shots: input.multiShots,
        prompt: input.prompt,
        sound: input.sound ?? false,
      },
      model: "kling-3.0/video",
    }),
    headers: {
      Authorization: `Bearer ${getKieApiKey()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const data = await readKieJson<{ taskId: string }>(response);

  return {
    provider: "kie.ai",
    taskId: data.taskId,
  };
}

function distributeShotDurations(durationSeconds: number, shotCount: number) {
  const baseDuration = Math.max(1, Math.floor(durationSeconds / shotCount));
  const durations = Array.from({ length: shotCount }, () => baseDuration);
  let remainingDuration =
    durationSeconds - durations.reduce((sum, duration) => sum + duration, 0);

  for (let index = 0; remainingDuration > 0; index = (index + 1) % shotCount) {
    durations[index] += 1;
    remainingDuration -= 1;
  }

  return durations;
}

export function buildArchitecturalKlingMultiPrompt(
  durationSeconds: number,
  variant: ArchitecturalKlingMultiPromptVariant = "five_scene",
): KieKlingMultiPrompt[] {
  if (variant === "three_scene") {
    const durations = distributeShotDurations(durationSeconds, 3);

    return [
      {
        duration: durations[0],
        prompt:
          "Shot 1: premium calm establishing view from a new elegant angle. Preserve the exact interior, furniture, colors, lighting, switched-on lamps, and materials. Slow stabilized cinematic push with realistic daylight and warm practical glow. No bounce, no vertical bobbing, no jitter.",
      },
      {
        duration: durations[1],
        prompt:
          "Shot 2: refined detail close-up on the strongest object or material zone. Show fabric, wood, stone, glass, metal, and light interaction with natural depth of field. No redesign, no object changes, no color drift. Stable gimbal motion only.",
      },
      {
        duration: durations[2],
        prompt:
          "Shot 3: final alternate architectural hero angle with premium campaign feeling. Smooth gimbal motion, soft atmospheric light, natural shadows, exact same room identity, realistic texture and proportion preservation. No bounce or wobble.",
      },
    ];
  }

  const durations = distributeShotDurations(durationSeconds, 5);

  return [
      {
        duration: durations[0],
        prompt:
        "Shot 1: premium wide establishing view of the full room from the provided image. Preserve exact layout, furniture, colors, lights, and materials. Slow stabilized push-in, warm daylight, realistic shadows, luxury architectural footage. No bounce, no vertical bobbing, no jitter.",
      },
      {
        duration: durations[1],
        prompt:
        "Shot 2: cinematic close-up on the hero object or seating area. Show textile fibers, cushions, wood or stone detail, and practical light reflections. Same objects and colors, no redesign, shallow natural depth of field. Stable gimbal motion only.",
      },
      {
        duration: durations[2],
        prompt:
        "Shot 3: switch to a different elegant room angle, like a side perspective or low gimbal move. Keep architecture and furniture identical. Smooth half-orbit motion, realistic lens response, cinematic premium interior showcase. No bounce or wobble.",
      },
      {
        duration: durations[3],
        prompt:
        "Shot 4: atmospheric material detail shot with daylight rays, dust particles, curtains, metal, glass, wood, and fabric reacting naturally to light. Preserve exact scene identity, color palette, and switched-on lights. Stable camera movement only.",
      },
      {
        duration: durations[4],
        prompt:
        "Shot 5: final hero perspective returning to a balanced architectural composition. Elegant slow motion, premium campaign feeling, warm natural contrast, no added objects, no color drift, photoreal real-location footage. No bounce, no vertical bobbing.",
      },
  ];
}

function parseResultUrls(resultJson?: string) {
  if (!resultJson) {
    return [];
  }

  const parsed = JSON.parse(resultJson) as {
    resultUrl?: string;
    resultUrls?: string[];
    result_url?: string;
    result_urls?: string[];
    url?: string;
    urls?: string[];
  };

  return [
    ...(parsed.resultUrls ?? []),
    ...(parsed.result_urls ?? []),
    parsed.resultUrl,
    parsed.result_url,
    parsed.url,
    ...(parsed.urls ?? []),
  ].filter((url): url is string => Boolean(url));
}

export async function getKieTaskRecord(taskId: string): Promise<KieTaskRecord> {
  const response = await fetch(
    `${KIE_API_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(
      taskId,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${getKieApiKey()}`,
      },
      method: "GET",
    },
  );
  const data = await readKieJson<
    Omit<KieTaskRecord, "resultUrls"> & {
      resultJson?: string;
      resultUrl?: string;
      resultUrls?: string[];
      result_url?: string;
      result_urls?: string[];
      url?: string;
      urls?: string[];
    }
  >(response);
  const resultUrls = [
    ...(data.resultUrls ?? []),
    ...(data.result_urls ?? []),
    ...parseResultUrls(data.resultJson),
    data.resultUrl,
    data.result_url,
    data.url,
    ...(data.urls ?? []),
  ].filter((url): url is string => Boolean(url));

  return {
    ...data,
    resultUrls,
  };
}

export function buildKlingFurniturePrompt(
  cameraMove: KlingVideoInput["cameraMove"],
) {
  return [
    "Create a photorealistic luxury furniture sales video from this enhanced image.",
    `Camera movement: ${cameraMove}.`,
    "Keep product proportions stable, avoid warping upholstery, marble, glass, and wood details.",
    "Lighting should feel premium, quiet, and showroom-grade.",
  ].join(" ");
}

export async function generateVideoWithKling30(
  input: KlingVideoInput,
): Promise<KlingVideoResult> {
  const task = await createKieKling30Task({
    aspectRatio: "16:9",
    durationSeconds: input.durationSeconds,
    imageUrls: [input.enhancedImageUrl],
    mode: "pro",
    multiShots: false,
    prompt: input.prompt,
    sound: false,
  });

  return {
    provider: AI_PROVIDERS.imageToVideo.primary,
    clipStorageKey: input.enhancedImageStorageKey.replace(
      "/enhanced/",
      "/clips/",
    ),
    durationSeconds: input.durationSeconds,
    taskId: task.taskId,
  };
}
