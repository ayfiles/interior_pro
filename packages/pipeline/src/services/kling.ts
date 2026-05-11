import { AI_PROVIDERS } from "@interior-pro/shared";

export interface KlingVideoInput {
  enhancedImageStorageKey: string;
  prompt: string;
  durationSeconds: number;
  cameraMove: "orbit" | "pan" | "push_in" | "multi_shot";
}

export interface KlingVideoResult {
  provider: typeof AI_PROVIDERS.imageToVideo.primary;
  clipStorageKey: string;
  durationSeconds: number;
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
  if (!process.env.KLING_API_KEY) {
    throw new Error("KLING_API_KEY is required for Kling 3.0 video generation.");
  }

  // Wire this to Kling 3.0 once provider endpoint credentials are confirmed.
  return {
    provider: AI_PROVIDERS.imageToVideo.primary,
    clipStorageKey: input.enhancedImageStorageKey.replace("/enhanced/", "/clips/"),
    durationSeconds: input.durationSeconds,
  };
}
