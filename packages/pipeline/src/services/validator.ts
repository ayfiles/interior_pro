import { Buffer } from "node:buffer";
import sharp from "sharp";
import { z } from "zod";
import { PIPELINE_VALIDATION_IMAGE_SIZE } from "./pipeline-constants";

const GEMINI_VALIDATOR_COST_USD = 0.005;
const CLAUDE_VALIDATOR_COST_USD = 0.01;
const GEMINI_VALIDATOR_MODEL =
  process.env.GEMINI_IMAGE_ANALYSIS_MODEL ?? "gemini-2.5-pro";
const CLAUDE_VALIDATOR_MODEL = "claude-sonnet-4-6";
const KIE_API_BASE_URL = process.env.KIE_API_BASE_URL ?? "https://api.kie.ai";

export const ValidatorResultSchema = z.object({
  room_proportions: z.enum(["PASS", "FAIL"]),
  room_proportions_notes: z.string(),
  main_colors: z.enum(["PASS", "FAIL"]),
  main_colors_notes: z.string(),
  materials: z.enum(["PASS", "FAIL"]),
  materials_notes: z.string(),
  objects: z.enum(["PASS", "FAIL"]),
  objects_notes: z.string(),
  window_content: z.enum(["PASS", "FAIL"]),
  window_content_notes: z.string(),
  lighting_state: z.enum(["PASS", "FAIL"]),
  lighting_state_notes: z.string(),
  overall_decision: z.enum(["ACCEPT", "ACCEPT_WITH_WARNING", "REJECT"]),
  critical_failures: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

export interface ValidateOutputInput {
  prompt: string;
  cascadeEnabled: boolean;
  inputImage: Uint8Array;
  inputMimeType: string;
  outputImage: Uint8Array;
  outputMimeType: string;
}

export interface ValidateOutputResult {
  result: ValidatorResult;
  geminiResult: ValidatorResult;
  claudeResult: ValidatorResult | null;
  estimatedCostUsd: number;
  geminiRawText: string;
  claudeRawText: string | null;
  cascadeRan: boolean;
}

interface KieOpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
  msg?: string;
}

interface KieClaudeResponse {
  content?: Array<
    | {
        text?: string;
        type: "text";
      }
    | {
        type: string;
      }
  >;
  error?: {
    message?: string;
  };
  msg?: string;
}

const VALIDATOR_RESPONSE_FORMAT = {
  json_schema: {
    name: "pipeline_validator_result",
    schema: {
      additionalProperties: false,
      properties: {
        confidence: { maximum: 1, minimum: 0, type: "number" },
        critical_failures: { items: { type: "string" }, type: "array" },
        lighting_state: { enum: ["PASS", "FAIL"], type: "string" },
        lighting_state_notes: { type: "string" },
        main_colors: { enum: ["PASS", "FAIL"], type: "string" },
        main_colors_notes: { type: "string" },
        materials: { enum: ["PASS", "FAIL"], type: "string" },
        materials_notes: { type: "string" },
        objects: { enum: ["PASS", "FAIL"], type: "string" },
        objects_notes: { type: "string" },
        overall_decision: {
          enum: ["ACCEPT", "ACCEPT_WITH_WARNING", "REJECT"],
          type: "string",
        },
        room_proportions: { enum: ["PASS", "FAIL"], type: "string" },
        room_proportions_notes: { type: "string" },
        window_content: { enum: ["PASS", "FAIL"], type: "string" },
        window_content_notes: { type: "string" },
      },
      required: [
        "room_proportions",
        "room_proportions_notes",
        "main_colors",
        "main_colors_notes",
        "materials",
        "materials_notes",
        "objects",
        "objects_notes",
        "window_content",
        "window_content_notes",
        "lighting_state",
        "lighting_state_notes",
        "overall_decision",
        "critical_failures",
        "confidence",
      ],
      type: "object",
    },
    strict: true,
  },
  type: "json_schema",
} as const;

export async function resizeForValidation(
  buffer: Uint8Array,
): Promise<{ data: Uint8Array; mimeType: "image/jpeg" }> {
  const output = await sharp(buffer)
    .rotate()
    .resize({
      fit: "inside",
      height: PIPELINE_VALIDATION_IMAGE_SIZE,
      width: PIPELINE_VALIDATION_IMAGE_SIZE,
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    data: output,
    mimeType: "image/jpeg",
  };
}

export async function validateOutput(
  input: ValidateOutputInput,
): Promise<ValidateOutputResult> {
  const gemini = await runGeminiValidator(input);
  const baseCost = GEMINI_VALIDATOR_COST_USD;

  if (!input.cascadeEnabled || gemini.result.overall_decision === "REJECT") {
    return {
      cascadeRan: false,
      claudeRawText: null,
      claudeResult: null,
      estimatedCostUsd: baseCost,
      geminiRawText: gemini.rawText,
      geminiResult: gemini.result,
      result: gemini.result,
    };
  }

  const claude = await runClaudeValidator(input);

  if (!claude.result) {
    const fallbackResult = appendCriticalFailure(
      gemini.result,
      "claude_parse_error",
    );

    return {
      cascadeRan: true,
      claudeRawText: claude.rawText,
      claudeResult: null,
      estimatedCostUsd: baseCost + CLAUDE_VALIDATOR_COST_USD,
      geminiRawText: gemini.rawText,
      geminiResult: gemini.result,
      result: fallbackResult,
    };
  }

  return {
    cascadeRan: true,
    claudeRawText: claude.rawText,
    claudeResult: claude.result,
    estimatedCostUsd: baseCost + CLAUDE_VALIDATOR_COST_USD,
    geminiRawText: gemini.rawText,
    geminiResult: gemini.result,
    result: claude.result,
  };
}

async function runGeminiValidator(input: ValidateOutputInput): Promise<{
  rawText: string;
  result: ValidatorResult;
}> {
  const apiKey = getKieApiKey();

  if (!apiKey) {
    return {
      rawText: "KIE_API_KEY is required for Stage 1 validation.",
      result: buildRejectResult({
        failure: "gemini_validator_error",
        notes: "KIE_API_KEY is missing.",
      }),
    };
  }

  try {
    const response = await fetch(
      `${KIE_API_BASE_URL}/${GEMINI_VALIDATOR_MODEL}/v1/chat/completions`,
      {
        body: JSON.stringify({
          messages: [
            {
              content: [
                {
                  text: `${input.prompt}\n\nINPUT_IMAGE:`,
                  type: "text",
                },
                {
                  image_url: {
                    url: toDataUrl(input.inputImage, input.inputMimeType),
                  },
                  type: "image_url",
                },
                {
                  text: "OUTPUT_IMAGE:",
                  type: "text",
                },
                {
                  image_url: {
                    url: toDataUrl(input.outputImage, input.outputMimeType),
                  },
                  type: "image_url",
                },
              ],
              role: "user",
            },
          ],
          model: GEMINI_VALIDATOR_MODEL,
          response_format: VALIDATOR_RESPONSE_FORMAT,
          stream: false,
          temperature: 0,
        }),
        headers: {
          Authorization: toBearerToken(apiKey),
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const json = (await response.json()) as KieOpenAiChatResponse;

    if (!response.ok) {
      const message = `KIE Gemini validator failed (${response.status}): ${
        json.error?.message ?? json.msg ?? response.statusText
      }`;

      return {
        rawText: message,
        result: buildRejectResult({
          failure: "gemini_validator_error",
          notes: message,
        }),
      };
    }

    const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";

    if (!rawText) {
      return {
        rawText,
        result: buildRejectResult({
          failure: "gemini_parse_error",
          notes: "KIE Gemini validator did not return JSON text.",
        }),
      };
    }

    const parsed = ValidatorResultSchema.safeParse(parseJsonResponse(rawText));

    if (!parsed.success) {
      return {
        rawText,
        result: buildRejectResult({
          failure: "gemini_parse_error",
          notes: `KIE Gemini validator returned invalid JSON: ${parsed.error.message}`,
        }),
      };
    }

    return {
      rawText,
      result: parsed.data,
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      rawText: message,
      result: buildRejectResult({
        failure: "gemini_validator_error",
        notes: message,
      }),
    };
  }
}

async function runClaudeValidator(input: ValidateOutputInput): Promise<{
  rawText: string;
  result: ValidatorResult | null;
}> {
  const apiKey = getKieApiKey();

  if (!apiKey) {
    return {
      rawText: "KIE_API_KEY is required for Stage 2 validation.",
      result: null,
    };
  }

  try {
    const response = await fetch(`${KIE_API_BASE_URL}/claude/v1/messages`, {
      body: JSON.stringify({
        max_tokens: 2048,
        messages: [
          {
            content: [
              {
                text: `${input.prompt}\n\nINPUT_IMAGE:`,
                type: "text",
              },
              {
                source: {
                  data: Buffer.from(input.inputImage).toString("base64"),
                  media_type: input.inputMimeType,
                  type: "base64",
                },
                type: "image",
              },
              {
                text: "OUTPUT_IMAGE:",
                type: "text",
              },
              {
                source: {
                  data: Buffer.from(input.outputImage).toString("base64"),
                  media_type: input.outputMimeType,
                  type: "base64",
                },
                type: "image",
              },
            ],
            role: "user",
          },
        ],
        model: CLAUDE_VALIDATOR_MODEL,
        stream: false,
        system: "You output strict JSON only - no markdown, no commentary.",
        temperature: 0,
      }),
      headers: {
        "anthropic-version": "2023-06-01",
        Authorization: toBearerToken(apiKey),
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const json = (await response.json()) as KieClaudeResponse;

    if (!response.ok) {
      return {
        rawText: `KIE Claude validator failed (${response.status}): ${
          json.error?.message ?? json.msg ?? response.statusText
        }`,
        result: null,
      };
    }

    const rawText =
      json.content
        ?.map((block) =>
          block.type === "text" && "text" in block ? block.text ?? "" : "",
        )
        .join("")
        .trim() ?? "";

    if (!rawText) {
      return {
        rawText,
        result: null,
      };
    }

    const parsed = ValidatorResultSchema.safeParse(parseJsonResponse(rawText));

    return {
      rawText,
      result: parsed.success ? parsed.data : null,
    };
  } catch (error) {
    return {
      rawText: getErrorMessage(error),
      result: null,
    };
  }
}

function appendCriticalFailure(
  result: ValidatorResult,
  failure: string,
): ValidatorResult {
  return {
    ...result,
    critical_failures: Array.from(new Set([...result.critical_failures, failure])),
  };
}

function buildRejectResult({
  failure,
  notes,
}: {
  failure: string;
  notes: string;
}): ValidatorResult {
  return {
    confidence: 0,
    critical_failures: [failure],
    lighting_state: "PASS",
    lighting_state_notes: "Not evaluated because validation did not complete.",
    main_colors: "FAIL",
    main_colors_notes: notes,
    materials: "FAIL",
    materials_notes: notes,
    objects: "FAIL",
    objects_notes: notes,
    overall_decision: "REJECT",
    room_proportions: "FAIL",
    room_proportions_notes: notes,
    window_content: "FAIL",
    window_content_notes: notes,
  };
}

function getKieApiKey() {
  return process.env.KIE_API_KEY?.trim() || null;
}

function toBearerToken(apiKey: string) {
  return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function toDataUrl(data: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
}

function parseJsonResponse(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    return JSON.parse(
      trimmed
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim(),
    );
  }

  return JSON.parse(trimmed);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
