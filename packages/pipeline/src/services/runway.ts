export interface RunwayFallbackInput {
  enhancedImageStorageKey: string;
  prompt: string;
  durationSeconds: number;
}

export async function generateVideoWithRunwayFallback(
  input: RunwayFallbackInput,
) {
  if (!process.env.RUNWAY_API_KEY) {
    throw new Error("RUNWAY_API_KEY is required for Runway fallback generation.");
  }

  return {
    provider: "runway-gen-4.5" as const,
    clipStorageKey: input.enhancedImageStorageKey.replace("/enhanced/", "/clips/"),
    durationSeconds: input.durationSeconds,
  };
}
