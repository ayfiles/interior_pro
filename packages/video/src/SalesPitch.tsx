import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RenderScene, SalesPitchRenderManifest } from "./types";

function secondsToFrames(seconds: number, fps: number) {
  return Math.max(0, Math.round(seconds * fps));
}

function Scene({ scene }: { scene: RenderScene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = secondsToFrames(scene.durationSeconds, fps);
  const fadeFrames = Math.min(18, Math.floor(durationInFrames / 3));
  const fadeIn =
    scene.transition === "cut"
      ? 1
      : interpolate(frame, [0, fadeFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const fadeOut =
    scene.transition === "cut"
      ? 1
      : interpolate(
          frame,
          [durationInFrames - fadeFrames, durationInFrames],
          [1, 0.92],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );
  const zoom =
    scene.transition === "soft_zoom"
      ? interpolate(frame, [0, durationInFrames], [1.02, 1.08], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1.035;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0b08", overflow: "hidden" }}>
      <Video
        muted
        objectFit="cover"
        src={scene.assetUrl}
        style={{
          height: "100%",
          opacity: fadeIn * fadeOut,
          transform: `scale(${zoom})`,
          width: "100%",
        }}
        trimAfter={secondsToFrames(scene.trimEndSeconds, fps)}
        trimBefore={secondsToFrames(scene.trimStartSeconds, fps)}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.38), rgba(0,0,0,0.04) 42%, rgba(0,0,0,0.22))",
        }}
      />
    </AbsoluteFill>
  );
}

function MusicTrack({ manifest }: { manifest: SalesPitchRenderManifest }) {
  const { fps } = useVideoConfig();
  const durationFrames = secondsToFrames(manifest.durationSeconds, fps);

  if (!manifest.audio.musicUrl) {
    return null;
  }

  return (
    <Audio
      loop
      src={manifest.audio.musicUrl}
      trimBefore={secondsToFrames(manifest.audio.musicStartSeconds, fps)}
      volume={(frame) => {
        const fade = interpolate(
          frame,
          [0, fps, durationFrames - fps, durationFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const voiceoverStart = secondsToFrames(
          manifest.audio.voiceoverStartSeconds,
          fps,
        );
        const voiceoverEnd =
          voiceoverStart +
          secondsToFrames(manifest.audio.voiceoverDurationSeconds ?? 25, fps);
        const ducking =
          frame >= voiceoverStart && frame <= voiceoverEnd ? 0.12 : 0.32;

        return fade * ducking;
      }}
    />
  );
}

function VoiceoverTrack({
  manifest,
}: {
  manifest: SalesPitchRenderManifest;
}) {
  const { fps } = useVideoConfig();

  if (!manifest.audio.voiceoverUrl) {
    return null;
  }

  return (
    <Sequence from={secondsToFrames(manifest.audio.voiceoverStartSeconds, fps)}>
      <Audio src={manifest.audio.voiceoverUrl} volume={1} />
    </Sequence>
  );
}

function LogoOverlay({ manifest }: { manifest: SalesPitchRenderManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!manifest.logo.url) {
    return null;
  }

  const introOpacity = interpolate(frame, [0, fps / 2, fps * 2.6, fps * 3.4], [
    0, 1, 1, 0,
  ], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cornerOpacity = interpolate(frame, [fps * 3, fps * 4], [0, 0.78], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: introOpacity,
        }}
      >
        <Img
          src={manifest.logo.url}
          style={{
            maxHeight: 160,
            maxWidth: 420,
            objectFit: "contain",
          }}
        />
      </AbsoluteFill>
      <div
        style={{
          bottom: 54,
          left: 64,
          opacity: cornerOpacity,
          position: "absolute",
        }}
      >
        <Img
          src={manifest.logo.url}
          style={{
            maxHeight: 58,
            maxWidth: 180,
            objectFit: "contain",
          }}
        />
      </div>
    </>
  );
}

function EndCard({ manifest }: { manifest: SalesPitchRenderManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = secondsToFrames(manifest.durationSeconds - 3.2, fps);
  const opacity = interpolate(frame, [startFrame, startFrame + fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background:
          "linear-gradient(180deg, rgba(13,11,8,0), rgba(13,11,8,0.72) 38%, rgba(13,11,8,0.94))",
        justifyContent: "flex-end",
        opacity,
        paddingBottom: 96,
      }}
    >
      <div
        style={{
          color: "#f4ebdc",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 42,
          fontWeight: 500,
          letterSpacing: 0,
          textAlign: "center",
        }}
      >
        {manifest.project.customerName}
      </div>
      <div
        style={{
          color: "#d6ad5f",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 24,
          letterSpacing: 0,
          marginTop: 12,
          textAlign: "center",
        }}
      >
        Interior Beratung mit praeziser Wirkung
      </div>
    </AbsoluteFill>
  );
}

export function SalesPitch({
  manifest,
}: {
  manifest: SalesPitchRenderManifest;
}) {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0b08" }}>
      {manifest.scenes.map((scene, index) => (
        <Sequence
          durationInFrames={secondsToFrames(scene.durationSeconds, fps)}
          from={secondsToFrames(scene.startAtSeconds, fps)}
          key={`${scene.assetUrl}-${scene.startAtSeconds}-${index}`}
          premountFor={fps}
        >
          <Scene scene={scene} />
        </Sequence>
      ))}
      <EndCard manifest={manifest} />
      <LogoOverlay manifest={manifest} />
      <MusicTrack manifest={manifest} />
      <VoiceoverTrack manifest={manifest} />
    </AbsoluteFill>
  );
}
