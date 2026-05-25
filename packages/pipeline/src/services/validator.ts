import { Buffer } from "node:buffer";
import sharp from "sharp";
import { z } from "zod";
import { PIPELINE_VALIDATION_IMAGE_SIZE } from "./pipeline-constants";

type ImageValidatorProvider = "claude" | "gemini" | "openai";

const OPENAI_VALIDATOR_COST_USD = 0.012;
const GEMINI_VALIDATOR_COST_USD = 0.005;
const CLAUDE_VALIDATOR_COST_USD = 0.01;
const OPENAI_VALIDATOR_MODEL =
  process.env.OPENAI_IMAGE_VALIDATOR_MODEL ?? "gpt-5.5";
const GEMINI_VALIDATOR_MODEL =
  process.env.GEMINI_IMAGE_ANALYSIS_MODEL ?? "gemini-2.5-pro";
const CLAUDE_VALIDATOR_MODEL =
  process.env.CLAUDE_VALIDATOR_MODEL ?? "claude-sonnet-4-6";
const KIE_API_BASE_URL = process.env.KIE_API_BASE_URL ?? "https://api.kie.ai";
const PRIMARY_IMAGE_VALIDATOR = normalizePrimaryValidator(
  process.env.PIPELINE_IMAGE_VALIDATOR_PRIMARY,
);
const HIGH_CONFIDENCE_FAILURE_THRESHOLD = 0.7;
const VALIDATOR_POLICY_INSERT = [
  "ADDITIONAL NON-GENERATION QC POLICY:",
  "This policy is for validation only. It must not be treated as an image-generation prompt.",
  "Reject creative expansion: the output may look more polished, but it must not reveal wider room area, add side extensions, add new decor, or invent new furniture, lamps, rugs, blankets, cushions, props, art, plants, doors, windows, views, or architectural parts.",
  "Reject material hallucinations: fur, sheepskin, fleece, shag, hair-like texture, brown hide, blanket-like throws, or furry rugs are FAIL unless the same material is clearly visible in the input at the same location.",
  "Reject object hallucinations: new floor lamps, pendant lamps, table lamps, light strips, ceiling fixtures, or side-entering objects are FAIL unless clearly present in the input.",
  "If a high-impact material or object identity change is plausible but uncertain, prefer REJECT over ACCEPT. Do not reject small lighting, exposure, or photographic style changes when object identity is preserved.",
].join("\n");

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

interface ValidatorRun {
  estimatedCostUsd: number;
  model: string;
  provider: ImageValidatorProvider;
  rawText: string;
  result: ValidatorResult | null;
}

export interface ValidateOutputResult {
  result: ValidatorResult;
  geminiResult: ValidatorResult;
  claudeResult: ValidatorResult | null;
  openaiResult: ValidatorResult | null;
  estimatedCostUsd: number;
  geminiRawText: string;
  claudeRawText: string | null;
  openaiRawText: string | null;
  cascadeRan: boolean;
  providerResults: Array<{
    model: string;
    provider: ImageValidatorProvider;
    result: ValidatorResult | null;
  }>;
  primaryProvider: ImageValidatorProvider;
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

interface OpenAiResponsesResponse {
  error?: {
    message?: string;
  };
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  output_text?: string;
}

const VALIDATOR_JSON_SCHEMA = {
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
} as const;

const VALIDATOR_RESPONSE_FORMAT = {
  json_schema: {
    name: "pipeline_validator_result",
    schema: VALIDATOR_JSON_SCHEMA,
    strict: true,
  },
  type: "json_schema",
} as const;

const OPENAI_TEXT_FORMAT = {
  format: {
    name: "pipeline_validator_result",
    schema: VALIDATOR_JSON_SCHEMA,
    strict: true,
    type: "json_schema",
  },
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
  const primaryProvider = resolvePrimaryValidator();
  const runs: ValidatorRun[] = [await runValidator(primaryProvider, input)];

  if (input.cascadeEnabled) {
    const secondaryProvider =
      primaryProvider === "openai" ? "gemini" : "claude";
    runs.push(await runValidator(secondaryProvider, input));
  }

  const finalResult = mergeValidatorRuns(runs);
  const geminiRun = runs.find((run) => run.provider === "gemini");
  const claudeRun = runs.find((run) => run.provider === "claude");
  const openaiRun = runs.find((run) => run.provider === "openai");
  const fallbackGeminiResult =
    geminiRun?.result ?? runs.find((run) => run.result)?.result ?? finalResult;

  return {
    cascadeRan: runs.length > 1,
    claudeRawText: claudeRun?.rawText ?? null,
    claudeResult: claudeRun?.result ?? null,
    estimatedCostUsd: runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0),
    geminiRawText: geminiRun?.rawText ?? "",
    geminiResult: fallbackGeminiResult,
    openaiRawText: openaiRun?.rawText ?? null,
    openaiResult: openaiRun?.result ?? null,
    primaryProvider,
    providerResults: runs.map((run) => ({
      model: run.model,
      provider: run.provider,
      result: run.result,
    })),
    result: finalResult,
  };
}

async function runValidator(
  provider: ImageValidatorProvider,
  input: ValidateOutputInput,
): Promise<ValidatorRun> {
  if (provider === "openai") {
    return runOpenAiValidator(input);
  }

  if (provider === "claude") {
    return runClaudeValidator(input);
  }

  return runGeminiValidator(input);
}

async function runOpenAiValidator(input: ValidateOutputInput): Promise<ValidatorRun> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return {
      estimatedCostUsd: 0,
      model: OPENAI_VALIDATOR_MODEL,
      provider: "openai",
      rawText: "OPENAI_API_KEY is required for OpenAI image validation.",
      result: buildRejectResult({
        failure: "openai_validator_error",
        notes: "OPENAI_API_KEY is missing.",
      }),
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: buildValidatorPrompt(input.prompt),
                type: "input_text",
              },
              {
                image_url: toDataUrl(input.inputImage, input.inputMimeType),
                type: "input_image",
              },
              {
                text: "OUTPUT_IMAGE:",
                type: "input_text",
              },
              {
                image_url: toDataUrl(input.outputImage, input.outputMimeType),
                type: "input_image",
              },
            ],
            role: "user",
          },
        ],
        model: OPENAI_VALIDATOR_MODEL,
        temperature: 0,
        text: OPENAI_TEXT_FORMAT,
      }),
      headers: {
        Authorization: toBearerToken(apiKey),
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const json = (await response.json()) as OpenAiResponsesResponse;

    if (!response.ok) {
      const message = `OpenAI image validator failed (${response.status}): ${
        json.error?.message ?? response.statusText
      }`;

      return {
        estimatedCostUsd: OPENAI_VALIDATOR_COST_USD,
        model: OPENAI_VALIDATOR_MODEL,
        provider: "openai",
        rawText: message,
        result: buildRejectResult({
          failure: "openai_validator_error",
          notes: message,
        }),
      };
    }

    const rawText = extractOpenAiText(json);
    const parsed = parseValidatorText(rawText);

    return {
      estimatedCostUsd: OPENAI_VALIDATOR_COST_USD,
      model: OPENAI_VALIDATOR_MODEL,
      provider: "openai",
      rawText,
      result: parsed,
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      estimatedCostUsd: OPENAI_VALIDATOR_COST_USD,
      model: OPENAI_VALIDATOR_MODEL,
      provider: "openai",
      rawText: message,
      result: buildRejectResult({
        failure: "openai_validator_error",
        notes: message,
      }),
    };
  }
}

async function runGeminiValidator(input: ValidateOutputInput): Promise<ValidatorRun> {
  const apiKey = getKieApiKey();

  if (!apiKey) {
    return {
      estimatedCostUsd: 0,
      model: GEMINI_VALIDATOR_MODEL,
      provider: "gemini",
      rawText: "KIE_API_KEY is required for Gemini validation.",
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
                  text: `${buildValidatorPrompt(input.prompt)}\n\nINPUT_IMAGE:`,
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
        estimatedCostUsd: GEMINI_VALIDATOR_COST_USD,
        model: GEMINI_VALIDATOR_MODEL,
        provider: "gemini",
        rawText: message,
        result: buildRejectResult({
          failure: "gemini_validator_error",
          notes: message,
        }),
      };
    }

    const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";

    return {
      estimatedCostUsd: GEMINI_VALIDATOR_COST_USD,
      model: GEMINI_VALIDATOR_MODEL,
      provider: "gemini",
      rawText,
      result: parseValidatorText(rawText),
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      estimatedCostUsd: GEMINI_VALIDATOR_COST_USD,
      model: GEMINI_VALIDATOR_MODEL,
      provider: "gemini",
      rawText: message,
      result: buildRejectResult({
        failure: "gemini_validator_error",
        notes: message,
      }),
    };
  }
}

async function runClaudeValidator(input: ValidateOutputInput): Promise<ValidatorRun> {
  const apiKey = getKieApiKey();

  if (!apiKey) {
    return {
      estimatedCostUsd: 0,
      model: CLAUDE_VALIDATOR_MODEL,
      provider: "claude",
      rawText: "KIE_API_KEY is required for Claude validation.",
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
                text: `${buildValidatorPrompt(input.prompt)}\n\nINPUT_IMAGE:`,
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
        estimatedCostUsd: CLAUDE_VALIDATOR_COST_USD,
        model: CLAUDE_VALIDATOR_MODEL,
        provider: "claude",
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

    return {
      estimatedCostUsd: CLAUDE_VALIDATOR_COST_USD,
      model: CLAUDE_VALIDATOR_MODEL,
      provider: "claude",
      rawText,
      result: rawText ? parseValidatorText(rawText) : null,
    };
  } catch (error) {
    return {
      estimatedCostUsd: CLAUDE_VALIDATOR_COST_USD,
      model: CLAUDE_VALIDATOR_MODEL,
      provider: "claude",
      rawText: getErrorMessage(error),
      result: null,
    };
  }
}

function mergeValidatorRuns(runs: ValidatorRun[]) {
  const parsedRuns = runs.filter(
    (run): run is ValidatorRun & { result: ValidatorResult } =>
      run.result !== null,
  );

  if (parsedRuns.length === 0) {
    return buildRejectResult({
      failure: "validator_parse_error",
      notes: "No validator returned parseable JSON.",
    });
  }

  const highConfidenceCriticalRejects = parsedRuns.filter(
    (run) =>
      run.result.overall_decision === "REJECT" &&
      run.result.confidence >= HIGH_CONFIDENCE_FAILURE_THRESHOLD &&
      hasIdentityCriticalFailure(run.result),
  );

  if (highConfidenceCriticalRejects.length > 0) {
    return combineRejects(highConfidenceCriticalRejects, "high_confidence_identity_reject");
  }

  const rejectRuns = parsedRuns.filter(
    (run) => run.result.overall_decision === "REJECT",
  );

  if (rejectRuns.length === parsedRuns.length) {
    return combineRejects(rejectRuns, "validator_consensus_reject");
  }

  if (rejectRuns.length > 0) {
    const acceptRun =
      parsedRuns.find((run) => run.result.overall_decision === "ACCEPT") ??
      parsedRuns.find((run) => run.result.overall_decision === "ACCEPT_WITH_WARNING") ??
      parsedRuns[0];

    return appendCriticalFailure(
      {
        ...acceptRun.result,
        confidence: Math.min(acceptRun.result.confidence, 0.72),
        lighting_state:
          acceptRun.result.lighting_state === "FAIL" ? "FAIL" : "PASS",
        overall_decision: "ACCEPT_WITH_WARNING",
      },
      "validator_disagreement_non_critical",
    );
  }

  const warningRun = parsedRuns.find(
    (run) => run.result.overall_decision === "ACCEPT_WITH_WARNING",
  );

  return warningRun?.result ?? parsedRuns[0].result;
}

function combineRejects(
  runs: Array<ValidatorRun & { result: ValidatorResult }>,
  failure: string,
): ValidatorResult {
  const representative = runs[0].result;
  const failures = Array.from(
    new Set([
      failure,
      ...runs.flatMap((run) => run.result.critical_failures),
    ]),
  );

  return {
    ...representative,
    confidence: Math.max(...runs.map((run) => run.result.confidence)),
    critical_failures: failures,
    overall_decision: "REJECT",
  };
}

function hasIdentityCriticalFailure(result: ValidatorResult) {
  if (
    result.room_proportions === "FAIL" ||
    result.main_colors === "FAIL" ||
    result.materials === "FAIL" ||
    result.objects === "FAIL" ||
    result.window_content === "FAIL"
  ) {
    return true;
  }

  return result.critical_failures.some((failure) =>
    [
      "creative_expansion",
      "forbidden_material_hallucination",
      "main_colors",
      "materials",
      "objects",
      "room_proportions",
      "window_content",
    ].includes(failure),
  );
}

function appendCriticalFailure(
  result: ValidatorResult,
  failure: string,
): ValidatorResult {
  return {
    ...result,
    critical_failures: Array.from(
      new Set([...result.critical_failures, failure]),
    ),
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

function buildValidatorPrompt(prompt: string) {
  return [prompt, VALIDATOR_POLICY_INSERT].join("\n\n");
}

function parseValidatorText(rawText: string) {
  if (!rawText) {
    throw new Error("Validator did not return JSON text.");
  }

  const parsed = ValidatorResultSchema.safeParse(parseJsonResponse(rawText));

  if (!parsed.success) {
    throw new Error(`Validator returned invalid JSON: ${parsed.error.message}`);
  }

  return parsed.data;
}

function extractOpenAiText(json: OpenAiResponsesResponse) {
  const outputText = json.output_text?.trim();

  if (outputText) {
    return outputText;
  }

  return (
    json.output
      ?.flatMap((output) => output.content ?? [])
      .map((content) => content.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function normalizePrimaryValidator(
  value: string | undefined,
): ImageValidatorProvider | null {
  if (value === "gemini" || value === "openai") {
    return value;
  }

  return null;
}

function resolvePrimaryValidator(): ImageValidatorProvider {
  if (PRIMARY_IMAGE_VALIDATOR) {
    if (PRIMARY_IMAGE_VALIDATOR === "openai" && !process.env.OPENAI_API_KEY) {
      return "gemini";
    }

    return PRIMARY_IMAGE_VALIDATOR;
  }

  return process.env.OPENAI_API_KEY ? "openai" : "gemini";
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
