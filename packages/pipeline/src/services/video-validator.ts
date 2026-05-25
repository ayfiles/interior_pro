import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { z } from "zod";

type VideoReviewDecision = "ACCEPT" | "REJECT" | "SKIP";

const VIDEO_REVIEW_MODEL =
  process.env.GEMINI_VIDEO_REVIEW_MODEL ??
  process.env.GEMINI_VIDEO_AGENT_MODEL ??
  "gemini-2.5-pro";
const COMMAND_TIMEOUT_MS = 45_000;
const MAX_COMMAND_BUFFER_BYTES = 8 * 1024 * 1024;

const VideoVisualReviewSchema = z.object({
  aesthetic_quality: z.enum(["PASS", "WARN", "FAIL"]),
  aesthetic_quality_notes: z.string(),
  confidence: z.number().min(0).max(1),
  invented_content: z.enum(["PASS", "FAIL"]),
  invented_content_notes: z.string(),
  motion_sanity: z.enum(["PASS", "WARN", "FAIL"]),
  motion_sanity_notes: z.string(),
  overall_decision: z.enum(["ACCEPT", "REJECT"]),
  rotation_integrity: z.enum(["PASS", "FAIL"]),
  rotation_integrity_notes: z.string(),
  source_fidelity: z.enum(["PASS", "FAIL"]),
  source_fidelity_notes: z.string(),
});

export interface VideoVisualReviewReport {
  confidence: number;
  decision: VideoReviewDecision;
  issues: string[];
  model: string;
  notes: string;
  rawText: string | null;
  status: "failed" | "passed" | "skipped";
}

interface CommandResult {
  stderr: Buffer;
  stdout: Buffer;
}

interface GeminiPart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  inline_data?: {
    data?: string;
    mime_type?: string;
  };
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
  };
}

const VIDEO_VISUAL_REVIEW_SCHEMA = {
  properties: {
    aesthetic_quality: { enum: ["PASS", "WARN", "FAIL"], type: "STRING" },
    aesthetic_quality_notes: { type: "STRING" },
    confidence: { type: "NUMBER" },
    invented_content: { enum: ["PASS", "FAIL"], type: "STRING" },
    invented_content_notes: { type: "STRING" },
    motion_sanity: { enum: ["PASS", "WARN", "FAIL"], type: "STRING" },
    motion_sanity_notes: { type: "STRING" },
    overall_decision: { enum: ["ACCEPT", "REJECT"], type: "STRING" },
    rotation_integrity: { enum: ["PASS", "FAIL"], type: "STRING" },
    rotation_integrity_notes: { type: "STRING" },
    source_fidelity: { enum: ["PASS", "FAIL"], type: "STRING" },
    source_fidelity_notes: { type: "STRING" },
  },
  required: [
    "rotation_integrity",
    "rotation_integrity_notes",
    "source_fidelity",
    "source_fidelity_notes",
    "invented_content",
    "invented_content_notes",
    "motion_sanity",
    "motion_sanity_notes",
    "aesthetic_quality",
    "aesthetic_quality_notes",
    "overall_decision",
    "confidence",
  ],
  type: "OBJECT",
} as const;

function getFfmpegPath() {
  return process.env.FFMPEG_PATH ?? ffmpegInstaller.path;
}

async function ensureExecutable(binaryPath: string) {
  try {
    await access(binaryPath, constants.X_OK);
    return;
  } catch {
    // Some package managers restore bundled binaries without executable bits.
  }

  await chmod(binaryPath, 0o755).catch(() => undefined);
}

function runCommand(command: string, args: string[]) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `${path.basename(command)} timed out after ${COMMAND_TIMEOUT_MS}ms.`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes > MAX_COMMAND_BUFFER_BYTES && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(new Error(`${path.basename(command)} exceeded stdout limit.`));
        return;
      }

      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;

      if (stderrBytes > MAX_COMMAND_BUFFER_BYTES && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(new Error(`${path.basename(command)} exceeded stderr limit.`));
        return;
      }

      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);

      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }

      reject(
        new Error(
          `${path.basename(command)} exited with ${code ?? "unknown"}: ${stderr
            .toString("utf8")
            .trim()}`,
        ),
      );
    });
  });
}

function getTextResponse(parts: GeminiPart[] | undefined) {
  return parts
    ?.map((part) => part.text)
    .filter((text): text is string => Boolean(text))
    .join("\n")
    .trim();
}

function parseJsonResponse(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Video visual review did not return JSON.");
  }

  return JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1)) as unknown;
}

async function extractContactSheet(videoBytes: Uint8Array) {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-video-review-"),
  );
  const inputPath = path.join(tempDirectory, "clip.mp4");
  const outputPath = path.join(tempDirectory, "contact-sheet.jpg");

  try {
    await ensureExecutable(getFfmpegPath());
    await writeFile(inputPath, videoBytes);
    await runCommand(getFfmpegPath(), [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "fps=1,scale=320:-2,tile=4x2:margin=8:padding=8",
      "-q:v",
      "3",
      outputPath,
    ]);

    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

export async function reviewVideoVisualQuality({
  sourceImage,
  sourceMimeType,
  videoBytes,
}: {
  sourceImage: Uint8Array;
  sourceMimeType: string;
  videoBytes: Uint8Array;
}): Promise<VideoVisualReviewReport> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      confidence: 0,
      decision: "SKIP",
      issues: ["gemini_api_key_missing"],
      model: VIDEO_REVIEW_MODEL,
      notes: "GEMINI_API_KEY is missing; semantic video review skipped.",
      rawText: null,
      status: "skipped",
    };
  }

  try {
    const contactSheet = await extractContactSheet(videoBytes);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VIDEO_REVIEW_MODEL}:generateContent`,
      {
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: [
                    "You are reviewing one image-to-video output for an architectural sales video.",
                    "Input 1 is the source still. Input 2 is a contact sheet sampled from the generated video.",
                    "Judge intelligently, not mechanically: reject only clear visual problems that a good editor would never ship.",
                    "Hard reject if frames are upside down, sideways, rolling/rotating the whole room, or if objects appear inverted. Orbit camera moves are allowed; the room itself turning on its side is not.",
                    "Hard reject if the video invents obvious new lamps, furniture, furry throws, shag rugs, animal-like fur, extra room extensions, or other high-impact objects/materials not present in the source still.",
                    "Warn, but do not reject, for mild style or lighting variation if the room identity stays intact.",
                    "Return strict JSON only.",
                  ].join("\n"),
                },
                {
                  inline_data: {
                    data: Buffer.from(sourceImage).toString("base64"),
                    mime_type: sourceMimeType,
                  },
                },
                {
                  inline_data: {
                    data: Buffer.from(contactSheet).toString("base64"),
                    mime_type: "image/jpeg",
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: VIDEO_VISUAL_REVIEW_SCHEMA,
            temperature: 0.1,
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
        `Gemini video visual review failed (${response.status}): ${
          json.error?.message ?? response.statusText
        }`,
      );
    }

    const rawText = getTextResponse(
      json.candidates?.flatMap((candidate) => candidate.content?.parts ?? []),
    );

    if (!rawText) {
      throw new Error("Gemini video visual review did not return text.");
    }

    const parsed = VideoVisualReviewSchema.parse(parseJsonResponse(rawText));
    const issues = [
      parsed.rotation_integrity === "FAIL" ? "rotation_integrity" : null,
      parsed.source_fidelity === "FAIL" ? "source_fidelity" : null,
      parsed.invented_content === "FAIL" ? "invented_content" : null,
      parsed.motion_sanity === "FAIL" ? "motion_sanity" : null,
      parsed.aesthetic_quality === "FAIL" ? "aesthetic_quality" : null,
    ].filter((issue): issue is string => Boolean(issue));

    return {
      confidence: parsed.confidence,
      decision: parsed.overall_decision,
      issues,
      model: VIDEO_REVIEW_MODEL,
      notes: [
        parsed.rotation_integrity_notes,
        parsed.source_fidelity_notes,
        parsed.invented_content_notes,
        parsed.motion_sanity_notes,
        parsed.aesthetic_quality_notes,
      ].join(" "),
      rawText,
      status: parsed.overall_decision === "REJECT" ? "failed" : "passed",
    };
  } catch (error) {
    return {
      confidence: 0,
      decision: "SKIP",
      issues: ["video_visual_review_error"],
      model: VIDEO_REVIEW_MODEL,
      notes: error instanceof Error ? error.message : String(error),
      rawText: null,
      status: "skipped",
    };
  }
}
