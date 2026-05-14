import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SALES_PITCH_COMPOSITION_ID,
  type SalesPitchRenderManifest,
} from "./types";

interface RenderSalesPitchVideoInput {
  entryPoint: string;
  manifest: SalesPitchRenderManifest;
}

export interface RenderSalesPitchVideoResult {
  contentType: "video/mp4";
  durationSeconds: number;
  outputBytes: Uint8Array;
}

export async function renderSalesPitchVideo({
  entryPoint,
  manifest,
}: RenderSalesPitchVideoInput): Promise<RenderSalesPitchVideoResult> {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "interior-pro-render-"),
  );
  const outputLocation = path.join(outputDirectory, "sales-pitch.mp4");

  try {
    const serveUrl = await bundle({
      entryPoint,
      onProgress: () => undefined,
      webpackOverride: (config) => config,
    });
    const composition = await selectComposition({
      id: SALES_PITCH_COMPOSITION_ID,
      inputProps: { manifest },
      logLevel: "warn",
      serveUrl,
    });

    await renderMedia({
      codec: "h264",
      composition,
      concurrency: 1,
      inputProps: { manifest },
      logLevel: "warn",
      outputLocation,
      overwrite: true,
      serveUrl,
    });

    const outputBytes = await readFile(outputLocation);

    return {
      contentType: "video/mp4",
      durationSeconds: manifest.durationSeconds,
      outputBytes,
    };
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}
