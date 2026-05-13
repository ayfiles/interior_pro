import type { Json } from "@/lib/supabase/admin";

type JsonObject = { [key: string]: Json | undefined };

const TASK_ID_KEYS = ["taskId", "task_id", "taskID"];
const URL_KEYS = [
  "resultUrl",
  "resultUrls",
  "result_url",
  "result_urls",
  "result_video_url",
  "resultVideoUrl",
  "video_url",
  "videoUrl",
  "url",
  "urls",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function collectUrls(value: unknown, urls: Set<string>) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      urls.add(value);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (URL_KEYS.includes(key)) {
      collectUrls(nestedValue, urls);
      continue;
    }

    if (key === "resultJson" && typeof nestedValue === "string") {
      try {
        collectUrls(JSON.parse(nestedValue), urls);
      } catch {
        // Ignore malformed provider JSON and rely on other payload fields.
      }
      continue;
    }

    collectUrls(nestedValue, urls);
  }
}

export function asJsonObject(value: Json): JsonObject {
  return isObject(value) ? (value as JsonObject) : {};
}

export function extractKieTaskId(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  for (const key of TASK_ID_KEYS) {
    const taskId = asString(payload[key]);

    if (taskId) {
      return taskId;
    }
  }

  if (isObject(payload.data)) {
    for (const key of TASK_ID_KEYS) {
      const taskId = asString(payload.data[key]);

      if (taskId) {
        return taskId;
      }
    }
  }

  return null;
}

export function extractKieResultUrls(payload: unknown) {
  const urls = new Set<string>();
  collectUrls(payload, urls);
  return [...urls].filter((url) => /\.(mp4|mov|m4v)(\?|$)/i.test(url));
}

export function isKieCallbackFailure(payload: unknown) {
  if (!isObject(payload)) {
    return false;
  }

  const code = typeof payload.code === "number" ? payload.code : null;
  const msg = asString(payload.msg)?.toLowerCase() ?? "";
  const callbackType = isObject(payload.data)
    ? (asString(payload.data.callbackType)?.toLowerCase() ?? "")
    : "";

  return (
    (code !== null && code !== 200) ||
    callbackType === "error" ||
    msg.includes("fail") ||
    msg.includes("error")
  );
}
