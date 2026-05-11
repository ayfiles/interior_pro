import { AI_PROVIDERS } from "@interior-pro/shared";

export interface ImageEnhancementInput {
  sourceStorageKey: string;
  prompt: string;
  targetResolution: "1K" | "2K" | "4K";
}

export interface ImageEnhancementResult {
  provider: typeof AI_PROVIDERS.imageEnhancement.primary;
  model: typeof AI_PROVIDERS.imageEnhancement.model;
  outputStorageKey: string;
}

export function buildFurnitureEnhancementPrompt(notes?: string) {
  return [
    "Enhance this luxury furniture product image for image-to-video generation.",
    "Preserve product geometry, fabric texture, wood grain, logo marks, and room layout.",
    "Improve lighting, material fidelity, reflections, and premium showroom atmosphere.",
    "Do not invent new furniture pieces or alter the product identity.",
    notes ? `Client notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function enhanceImageWithNanoBananaPro(
  input: ImageEnhancementInput,
): Promise<ImageEnhancementResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for Nano Banana Pro.");
  }

  // Wire this to the Gemini image API once storage upload/download helpers exist.
  return {
    provider: AI_PROVIDERS.imageEnhancement.primary,
    model: AI_PROVIDERS.imageEnhancement.model,
    outputStorageKey: input.sourceStorageKey.replace("/source/", "/enhanced/"),
  };
}
