import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface GenerateVoiceoverInput {
  script: string;
  targetDurationSeconds: number;
  voiceSelection: string;
}

export interface GenerateVoiceoverResult {
  audioBytes: Uint8Array;
  contentType: "audio/mpeg" | "audio/wav";
  durationSeconds: number;
  model: string;
  provider: "elevenlabs" | "placeholder";
  voiceId: string | null;
}

interface CommandResult {
  stderr: Buffer;
  stdout: Buffer;
}

const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const COMMAND_TIMEOUT_MS = 60_000;

function getFfmpegPath() {
  return process.env.FFMPEG_PATH ?? ffmpegInstaller.path;
}

function getFfprobePath() {
  return process.env.FFPROBE_PATH ?? ffprobeInstaller.path;
}

async function ensureExecutable(binaryPath: string) {
  try {
    await access(binaryPath, constants.X_OK);
    return;
  } catch {
    // Some restored package binaries miss executable bits in local installs.
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

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
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

function envKeyForVoiceSelection(voiceSelection: string) {
  return `ELEVENLABS_VOICE_ID_${voiceSelection
    .replace(/^speaker_/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase()}`;
}

function resolveElevenLabsVoiceId(voiceSelection: string) {
  if (/^[a-zA-Z0-9_-]{16,}$/.test(voiceSelection)) {
    return voiceSelection;
  }

  return (
    process.env[envKeyForVoiceSelection(voiceSelection)] ??
    process.env.ELEVENLABS_VOICE_ID ??
    null
  );
}

async function probeAudioDuration(audioPath: string) {
  await ensureExecutable(getFfprobePath());
  const { stdout } = await runCommand(getFfprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const parsed = Number(stdout.toString("utf8").trim());

  return Number.isFinite(parsed) ? parsed : null;
}

async function generatePlaceholderVoiceover(targetDurationSeconds: number) {
  await ensureExecutable(getFfmpegPath());
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-voiceover-"),
  );
  const outputPath = path.join(tempDirectory, "voiceover.wav");
  const durationSeconds = Math.max(
    1,
    Math.round(targetDurationSeconds * 100) / 100,
  );

  try {
    await runCommand(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      String(durationSeconds),
      "-c:a",
      "pcm_s16le",
      outputPath,
    ]);

    return {
      audioBytes: new Uint8Array(await readFile(outputPath)),
      contentType: "audio/wav" as const,
      durationSeconds,
      model: "placeholder-silence",
      provider: "placeholder" as const,
      voiceId: null,
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function generateElevenLabsVoiceover({
  script,
  targetDurationSeconds,
  voiceSelection,
}: GenerateVoiceoverInput) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = resolveElevenLabsVoiceId(voiceSelection);

  if (!apiKey || !voiceId) {
    return generatePlaceholderVoiceover(targetDurationSeconds);
  }

  const model = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL;
  const outputFormat =
    process.env.ELEVENLABS_OUTPUT_FORMAT ?? DEFAULT_OUTPUT_FORMAT;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId,
    )}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      body: JSON.stringify({
        model_id: model,
        text: script,
        voice_settings: {
          similarity_boost: 0.72,
          stability: 0.62,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    throw new Error(
      `ElevenLabs TTS request failed (${response.status}): ${
        body || response.statusText
      }`,
    );
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-voiceover-probe-"),
  );
  const audioPath = path.join(tempDirectory, "voiceover.mp3");

  try {
    await writeFile(audioPath, audioBytes);

    return {
      audioBytes,
      contentType: "audio/mpeg" as const,
      durationSeconds:
        (await probeAudioDuration(audioPath)) ?? targetDurationSeconds,
      model,
      provider: "elevenlabs" as const,
      voiceId,
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

export async function generateVoiceoverAudio(input: GenerateVoiceoverInput) {
  return generateElevenLabsVoiceover(input);
}
