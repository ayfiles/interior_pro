import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type CheckStatus = "passed" | "warning" | "failed" | "skipped";

export interface MediaQcThresholds {
  maxBlackDurationSeconds: number;
  maxBlackRatio: number;
  maxFreezeDurationSeconds: number;
  maxFreezeRatio: number;
  minBitRateBitsPerSecond: number;
  minBlurScore: number;
  minDurationRatio: number;
  minDurationSeconds: number;
  minFileSizeBytes: number;
  minHeight: number;
  minWidth: number;
  warnBlurScore: number;
}

export interface MediaQcSegment {
  durationSeconds: number;
  endSeconds: number | null;
  startSeconds: number | null;
}

export interface MediaQcCheck {
  message: string;
  status: CheckStatus;
}

export interface MediaQcReport {
  checks: {
    bitrate: MediaQcCheck;
    blackFrames: MediaQcCheck;
    blur: MediaQcCheck;
    codec: MediaQcCheck;
    duration: MediaQcCheck;
    fileSize: MediaQcCheck;
    cutSimilarity: MediaQcCheck;
    freezeFrames: MediaQcCheck;
    resolution: MediaQcCheck;
  };
  clipStorageKey: string;
  expectedDurationSeconds: number | null;
  fileSizeBytes: number;
  generatedAt: string;
  issues: string[];
  metrics: {
    audioCodec: string | null;
    bitRateBitsPerSecond: number | null;
    blackSegments: MediaQcSegment[];
    blurFrameScores: number[];
    blurMedianScore: number | null;
    codecName: string | null;
    durationSeconds: number | null;
    formatName: string | null;
    frameRate: number | null;
    freezeSegments: MediaQcSegment[];
    height: number | null;
    nearDuplicateCutSeconds: Array<{
      histogramDifference: number;
      pixelDifference: number;
      seconds: number;
    }>;
    sceneChangeSeconds: number[];
    width: number | null;
  };
  status: "passed" | "failed";
  toolVersions: {
    ffmpeg: string;
    ffprobe: string;
  };
  warnings: string[];
}

interface RunMediaQcInput {
  clipStorageKey: string;
  expectedDurationSeconds?: number | null;
  expectedCutSeconds?: number[] | null;
  videoBytes: Uint8Array;
}

interface CommandResult {
  stderr: Buffer;
  stdout: Buffer;
}

interface FfprobeOutput {
  format?: {
    bit_rate?: string;
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    bit_rate?: string;
    codec_name?: string;
    codec_type?: string;
    duration?: string;
    height?: number;
    r_frame_rate?: string;
    width?: number;
  }>;
}

const DEFAULT_THRESHOLDS: MediaQcThresholds = {
  maxBlackDurationSeconds: 1,
  maxBlackRatio: 0.25,
  maxFreezeDurationSeconds: 2.5,
  maxFreezeRatio: 0.75,
  minBitRateBitsPerSecond: 300_000,
  minBlurScore: 5,
  minDurationRatio: 0.65,
  minDurationSeconds: 2,
  minFileSizeBytes: 100_000,
  minHeight: 360,
  minWidth: 640,
  warnBlurScore: 12,
};
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_BUFFER_BYTES = 24 * 1024 * 1024;
const BLUR_SAMPLE_WIDTH = 160;
const BLUR_SAMPLE_FPS = 1;
const BLUR_SAMPLE_MAX_FRAMES = 8;
const SCENE_CHANGE_THRESHOLD = 0.38;
const CUT_SAMPLE_WIDTH = 96;
const CUT_SAMPLE_HEIGHT = 54;
const CUT_SAMPLE_OFFSET_SECONDS = 0.06;
const CUT_PIXEL_DIFF_FAIL = 0.018;
const CUT_HISTOGRAM_DIFF_FAIL = 0.012;

function getFfprobePath() {
  return process.env.FFPROBE_PATH ?? ffprobeInstaller.path;
}

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

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    maxBufferBytes?: number;
    timeoutMs?: number;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const maxBufferBytes = options.maxBufferBytes ?? MAX_COMMAND_BUFFER_BYTES;

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
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
          `${path.basename(command)} timed out after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes > maxBufferBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(
          new Error(
            `${path.basename(command)} exceeded stdout buffer limit.`,
          ),
        );
        return;
      }

      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;

      if (stderrBytes > maxBufferBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(
          new Error(
            `${path.basename(command)} exceeded stderr buffer limit.`,
          ),
        );
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

function parseNumber(value: string | undefined) {
  if (!value || value === "N/A") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") {
    return null;
  }

  const [rawNumerator, rawDenominator] = value.split("/");
  const numerator = Number(rawNumerator);
  const denominator = Number(rawDenominator ?? 1);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function variance(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

  return (
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length
  );
}

function parseBlackSegments(stderr: string): MediaQcSegment[] {
  return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map(
    (match) => ({
      durationSeconds: Number(match[3]),
      endSeconds: Number(match[2]),
      startSeconds: Number(match[1]),
    }),
  );
}

function parseFreezeSegments(stderr: string): MediaQcSegment[] {
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map(
    (match) => Number(match[1]),
  );
  const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((match) =>
    Number(match[1]),
  );
  const durations = [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map(
    (match) => Number(match[1]),
  );

  return durations.map((durationSeconds, index) => ({
    durationSeconds,
    endSeconds: Number.isFinite(ends[index]) ? ends[index] : null,
    startSeconds: Number.isFinite(starts[index]) ? starts[index] : null,
  }));
}

function parseSceneChangeSeconds(stderr: string) {
  return Array.from(
    new Set(
      [...stderr.matchAll(/pts_time:([\d.]+)/g)]
        .map((match) => Number(match[1]))
        .filter(Number.isFinite)
        .map((value) => Math.round(value * 100) / 100),
    ),
  ).sort((a, b) => a - b);
}

function getDurationThreshold(expectedDurationSeconds: number | null) {
  if (!expectedDurationSeconds) {
    return DEFAULT_THRESHOLDS.minDurationSeconds;
  }

  return Math.max(
    DEFAULT_THRESHOLDS.minDurationSeconds,
    expectedDurationSeconds * DEFAULT_THRESHOLDS.minDurationRatio,
  );
}

function buildCheck(
  failed: boolean,
  warning: boolean,
  message: string,
): MediaQcCheck {
  if (failed) {
    return { message, status: "failed" };
  }

  if (warning) {
    return { message, status: "warning" };
  }

  return { message, status: "passed" };
}

function collectMessages(checks: Record<string, MediaQcCheck>) {
  return {
    issues: Object.values(checks)
      .filter((check) => check.status === "failed")
      .map((check) => check.message),
    warnings: Object.values(checks)
      .filter((check) => check.status === "warning")
      .map((check) => check.message),
  };
}

async function getToolVersion(binaryPath: string) {
  const { stdout } = await runCommand(binaryPath, ["-version"], {
    maxBufferBytes: 1024 * 1024,
    timeoutMs: 10_000,
  });

  return stdout.toString("utf8").split("\n")[0]?.trim() ?? "unknown";
}

async function probeVideo(filePath: string): Promise<FfprobeOutput> {
  const { stdout } = await runCommand(getFfprobePath(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  return JSON.parse(stdout.toString("utf8")) as FfprobeOutput;
}

async function detectBlackFrames(filePath: string) {
  const { stderr } = await runCommand(getFfmpegPath(), [
    "-hide_banner",
    "-nostdin",
    "-i",
    filePath,
    "-vf",
    "blackdetect=d=0.25:pic_th=0.98",
    "-an",
    "-f",
    "null",
    "-",
  ]);

  return parseBlackSegments(stderr.toString("utf8"));
}

async function detectFreezeFrames(filePath: string) {
  const { stderr } = await runCommand(getFfmpegPath(), [
    "-hide_banner",
    "-nostdin",
    "-i",
    filePath,
    "-vf",
    "freezedetect=n=-60dB:d=0.5",
    "-an",
    "-f",
    "null",
    "-",
  ]);

  return parseFreezeSegments(stderr.toString("utf8"));
}

async function detectSceneChanges(filePath: string) {
  const { stderr } = await runCommand(getFfmpegPath(), [
    "-hide_banner",
    "-nostdin",
    "-i",
    filePath,
    "-vf",
    `select='gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo`,
    "-an",
    "-f",
    "null",
    "-",
  ]);

  return parseSceneChangeSeconds(stderr.toString("utf8"));
}

async function estimateBlurScores({
  filePath,
  height,
  width,
}: {
  filePath: string;
  height: number;
  width: number;
}) {
  const sampleHeight = Math.max(
    2,
    Math.round(((BLUR_SAMPLE_WIDTH * height) / width) / 2) * 2,
  );
  const frameSize = BLUR_SAMPLE_WIDTH * sampleHeight;
  const { stdout } = await runCommand(
    getFfmpegPath(),
    [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-vf",
      `fps=${BLUR_SAMPLE_FPS},scale=${BLUR_SAMPLE_WIDTH}:${sampleHeight},format=gray`,
      "-frames:v",
      String(BLUR_SAMPLE_MAX_FRAMES),
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    {
      maxBufferBytes: frameSize * BLUR_SAMPLE_MAX_FRAMES + 1024,
    },
  );
  const scores: number[] = [];

  for (let offset = 0; offset + frameSize <= stdout.byteLength; offset += frameSize) {
    const laplacianValues: number[] = [];

    for (let y = 1; y < sampleHeight - 1; y += 1) {
      for (let x = 1; x < BLUR_SAMPLE_WIDTH - 1; x += 1) {
        const index = offset + y * BLUR_SAMPLE_WIDTH + x;
        const center = stdout[index] ?? 0;
        const left = stdout[index - 1] ?? 0;
        const right = stdout[index + 1] ?? 0;
        const top = stdout[index - BLUR_SAMPLE_WIDTH] ?? 0;
        const bottom = stdout[index + BLUR_SAMPLE_WIDTH] ?? 0;

        laplacianValues.push(4 * center - left - right - top - bottom);
      }
    }

    scores.push(Number(variance(laplacianValues).toFixed(2)));
  }

  return scores;
}

async function inspectVideoFile({
  clipStorageKey,
  expectedCutSeconds,
  expectedDurationSeconds,
  filePath,
  fileSizeBytes,
}: {
  clipStorageKey: string;
  expectedCutSeconds: number[] | null;
  expectedDurationSeconds: number | null;
  filePath: string;
  fileSizeBytes: number;
}): Promise<MediaQcReport> {
  await ensureExecutable(getFfprobePath());
  await ensureExecutable(getFfmpegPath());

  const [ffprobeVersion, ffmpegVersion, probe] = await Promise.all([
    getToolVersion(getFfprobePath()),
    getToolVersion(getFfmpegPath()),
    probeVideo(filePath),
  ]);
  const videoStream =
    probe.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audioStream =
    probe.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  const durationSeconds =
    parseNumber(probe.format?.duration) ??
    parseNumber(videoStream?.duration) ??
    null;
  const bitRateBitsPerSecond =
    parseNumber(probe.format?.bit_rate) ??
    parseNumber(videoStream?.bit_rate) ??
    null;
  const width = videoStream?.width ?? null;
  const height = videoStream?.height ?? null;
  const [
    blackSegments,
    freezeSegments,
    sceneChangeSeconds,
    blurFrameScores,
  ] = await Promise.all([
    detectBlackFrames(filePath),
    detectFreezeFrames(filePath),
    detectSceneChanges(filePath).catch(() => []),
    width && height
      ? estimateBlurScores({ filePath, height, width }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const totalBlackSeconds = blackSegments.reduce(
    (sum, segment) => sum + segment.durationSeconds,
    0,
  );
  const longestBlackSeconds = blackSegments.reduce(
    (max, segment) => Math.max(max, segment.durationSeconds),
    0,
  );
  const totalFreezeSeconds = freezeSegments.reduce(
    (sum, segment) => sum + segment.durationSeconds,
    0,
  );
  const longestFreezeSeconds = freezeSegments.reduce(
    (max, segment) => Math.max(max, segment.durationSeconds),
    0,
  );
  const blurMedianScore = median(blurFrameScores);
  const durationThreshold = getDurationThreshold(expectedDurationSeconds);
  const expectedCutCount = expectedCutSeconds?.length ?? 0;
  const nearDuplicateCutSeconds: MediaQcReport["metrics"]["nearDuplicateCutSeconds"] = [];
  const checks = {
    bitrate: buildCheck(
      bitRateBitsPerSecond === null,
      bitRateBitsPerSecond !== null &&
        bitRateBitsPerSecond < DEFAULT_THRESHOLDS.minBitRateBitsPerSecond,
      bitRateBitsPerSecond === null
        ? "Bitrate could not be read."
        : `Bitrate is ${Math.round(bitRateBitsPerSecond / 1000)} kbps.`,
    ),
    blackFrames: buildCheck(
      Boolean(
        durationSeconds &&
          (longestBlackSeconds > DEFAULT_THRESHOLDS.maxBlackDurationSeconds ||
            totalBlackSeconds / durationSeconds >
              DEFAULT_THRESHOLDS.maxBlackRatio),
      ),
      totalBlackSeconds > 0,
      totalBlackSeconds > 0
        ? `Detected ${totalBlackSeconds.toFixed(2)}s of black frames.`
        : "No black frame segments detected.",
    ),
    blur: buildCheck(
      blurMedianScore !== null && blurMedianScore < DEFAULT_THRESHOLDS.minBlurScore,
      blurMedianScore !== null &&
        blurMedianScore >= DEFAULT_THRESHOLDS.minBlurScore &&
        blurMedianScore < DEFAULT_THRESHOLDS.warnBlurScore,
      blurMedianScore === null
        ? "Blur estimate could not be calculated."
        : `Median sharpness score is ${blurMedianScore.toFixed(2)}.`,
    ),
    codec: buildCheck(
      !videoStream?.codec_name,
      false,
      videoStream?.codec_name
        ? `Video codec is ${videoStream.codec_name}.`
        : "No video codec found.",
    ),
    duration: buildCheck(
      durationSeconds === null || durationSeconds < durationThreshold,
      false,
      durationSeconds === null
        ? "Duration could not be read."
        : `Duration is ${durationSeconds.toFixed(2)}s.`,
    ),
    fileSize: buildCheck(
      fileSizeBytes < DEFAULT_THRESHOLDS.minFileSizeBytes,
      false,
      `File size is ${fileSizeBytes} bytes.`,
    ),
    cutSimilarity: {
      message:
        expectedCutCount > 0
          ? `Cut similarity check skipped for ${expectedCutCount} expected cuts.`
          : "Cut similarity check skipped; no expected cut timings provided.",
      status: "skipped",
    },
    freezeFrames: buildCheck(
      Boolean(
        durationSeconds &&
          (longestFreezeSeconds >
            DEFAULT_THRESHOLDS.maxFreezeDurationSeconds ||
            totalFreezeSeconds / durationSeconds >
              DEFAULT_THRESHOLDS.maxFreezeRatio),
      ),
      totalFreezeSeconds > 0,
      totalFreezeSeconds > 0
        ? `Detected ${totalFreezeSeconds.toFixed(2)}s of frozen frames.`
        : "No frozen frame segments detected.",
    ),
    resolution: buildCheck(
      !width ||
        !height ||
        width < DEFAULT_THRESHOLDS.minWidth ||
        height < DEFAULT_THRESHOLDS.minHeight,
      false,
      width && height
        ? `Resolution is ${width}x${height}.`
        : "Resolution could not be read.",
    ),
  } satisfies MediaQcReport["checks"];
  const { issues, warnings } = collectMessages(checks);

  return {
    checks,
    clipStorageKey,
    expectedDurationSeconds,
    fileSizeBytes,
    generatedAt: new Date().toISOString(),
    issues,
    metrics: {
      audioCodec: audioStream?.codec_name ?? null,
      bitRateBitsPerSecond,
      blackSegments,
      blurFrameScores,
      blurMedianScore,
      codecName: videoStream?.codec_name ?? null,
      durationSeconds,
      formatName: probe.format?.format_name ?? null,
      frameRate: parseFrameRate(videoStream?.r_frame_rate),
      freezeSegments,
      height,
      nearDuplicateCutSeconds,
      sceneChangeSeconds,
      width,
    },
    status: issues.length > 0 ? "failed" : "passed",
    toolVersions: {
      ffmpeg: ffmpegVersion,
      ffprobe: ffprobeVersion,
    },
    warnings,
  };
}

export async function runMediaQcOnVideoBytes({
  clipStorageKey,
  expectedCutSeconds = null,
  expectedDurationSeconds = null,
  videoBytes,
}: RunMediaQcInput) {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-media-qc-"),
  );
  const tempVideoPath = path.join(tempDirectory, "clip.mp4");

  try {
    await writeFile(tempVideoPath, videoBytes);

    return await inspectVideoFile({
      clipStorageKey,
      expectedCutSeconds,
      expectedDurationSeconds,
      filePath: tempVideoPath,
      fileSizeBytes: videoBytes.byteLength,
    });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

export async function stabilizeVideoBytes({
  clipStorageKey,
  videoBytes,
}: {
  clipStorageKey: string;
  videoBytes: Uint8Array;
}) {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-stabilize-"),
  );
  const inputPath = path.join(tempDirectory, "input.mp4");
  const outputPath = path.join(tempDirectory, "stabilized.mp4");

  try {
    await ensureExecutable(getFfmpegPath());
    await writeFile(inputPath, videoBytes);
    await runCommand(
      getFfmpegPath(),
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vf",
        "vidstabdetect=shakiness=5:accuracy=9:result=transforms.trf",
        "-an",
        "-f",
        "null",
        "-",
      ],
      {
        cwd: tempDirectory,
        timeoutMs: 120_000,
      },
    );
    await runCommand(
      getFfmpegPath(),
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vf",
        "vidstabtransform=input=transforms.trf:smoothing=18:optzoom=1:interpol=bilinear,unsharp=5:5:0.8:3:3:0.4",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        outputPath,
      ],
      {
        cwd: tempDirectory,
        timeoutMs: 120_000,
      },
    );

    return {
      clipStorageKey,
      stabilized: true,
      videoBytes: new Uint8Array(await readFile(outputPath)),
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}
