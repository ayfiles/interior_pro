import { AI_PROVIDERS } from "@interior-pro/shared";
import { Buffer } from "node:buffer";

export interface ImageEnhancementInput {
  aspectRatio: "16:9";
  prompt: string;
  sourceImage: Uint8Array;
  sourceMimeType: string;
  sourceStorageKey?: string;
  targetResolution: "1K" | "2K" | "4K";
}

export interface ImageEnhancementResult {
  model: typeof AI_PROVIDERS.imageEnhancement.model;
  outputImage: Uint8Array;
  outputMimeType: string;
  outputStorageKey?: string;
  provider: typeof AI_PROVIDERS.imageEnhancement.primary;
  responseText?: string;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

interface GeminiPart {
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
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
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Nano Banana Pro.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_PROVIDERS.imageEnhancement.model}:generateContent`,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: input.prompt },
              {
                inline_data: {
                  data: Buffer.from(input.sourceImage).toString("base64"),
                  mime_type: input.sourceMimeType,
                },
              },
            ],
          },
        ],
        generationConfig: {
          imageConfig: {
            aspectRatio: input.aspectRatio,
            imageSize: input.targetResolution,
          },
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
    },
  );

  const json = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(
      `Nano Banana Pro request failed (${response.status}): ${
        json.error?.message ?? response.statusText
      }`,
    );
  }

  const parts = json.candidates?.flatMap(
    (candidate) => candidate.content?.parts ?? [],
  );
  const imagePart = parts?.find((part) => part.inlineData ?? part.inline_data);
  const textPart = parts?.find((part) => part.text);
  const inlineData = imagePart?.inlineData ?? imagePart?.inline_data;

  if (!inlineData?.data) {
    throw new Error("Nano Banana Pro did not return an image.");
  }

  return {
    model: AI_PROVIDERS.imageEnhancement.model,
    outputImage: Buffer.from(inlineData.data, "base64"),
    outputMimeType: inlineData.mimeType ?? inlineData.mime_type ?? "image/png",
    outputStorageKey: input.sourceStorageKey?.replace("/source/", "/enhanced/"),
    provider: AI_PROVIDERS.imageEnhancement.primary,
    responseText: textPart?.text,
  };
}
