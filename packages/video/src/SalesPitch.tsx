import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
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
      <OffthreadVideo
        muted
        src={scene.assetUrl}
        style={{
          height: "100%",
          objectFit: "cover",
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
  const musicFadeOutFrames = Math.max(
    1,
    secondsToFrames(manifest.outro.musicFadeOutDurationSeconds, fps),
  );

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
          [0, fps, durationFrames - musicFadeOutFrames, durationFrames],
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
          manifest.audio.voiceoverUrl &&
          frame >= voiceoverStart &&
          frame <= voiceoverEnd
            ? 0.12
            : 0.32;

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

function SceneLayer({ manifest }: { manifest: SalesPitchRenderManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outroStartFrame = secondsToFrames(manifest.outro.startAtSeconds, fps);
  const blurEndFrame =
    outroStartFrame + secondsToFrames(manifest.outro.blurDurationSeconds, fps);
  const blurFrames = Math.max(1, blurEndFrame - outroStartFrame);
  const lastScene = manifest.scenes.at(-1) ?? null;
  const heldLastSceneFrame = lastScene
    ? Math.max(0, secondsToFrames(lastScene.durationSeconds, fps) - 3)
    : 0;
  const blur = interpolate(frame, [outroStartFrame, blurEndFrame], [0, 26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        filter: `blur(${blur}px)`,
        transform: blur > 0 ? "scale(1.04)" : "scale(1)",
      }}
    >
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
      {lastScene ? (
        <Sequence from={outroStartFrame} durationInFrames={blurFrames + 1}>
          <Freeze frame={heldLastSceneFrame}>
            <Scene scene={lastScene} />
          </Freeze>
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}

function OutroOverlay({ manifest }: { manifest: SalesPitchRenderManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = secondsToFrames(manifest.outro.startAtSeconds, fps);
  const blurFrames = secondsToFrames(manifest.outro.blurDurationSeconds, fps);
  const logoStartFrame =
    startFrame + secondsToFrames(manifest.outro.logoDelaySeconds, fps);
  const logoFadeFrames = secondsToFrames(
    manifest.outro.logoFadeDurationSeconds,
    fps,
  );
  const whiteOpacity = interpolate(
    frame,
    [startFrame, startFrame + blurFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const logoOpacity = manifest.logo.outroUrl
    ? interpolate(
        frame,
        [logoStartFrame, logoStartFrame + logoFadeFrames],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;
  const logoBlur = manifest.logo.outroUrl
    ? interpolate(
        frame,
        [logoStartFrame, logoStartFrame + logoFadeFrames],
        [18, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        backgroundColor: manifest.logo.outroBackgroundColor,
        justifyContent: "center",
        opacity: frame < startFrame ? 0 : whiteOpacity,
        pointerEvents: "none",
      }}
    >
      {manifest.logo.outroUrl ? (
        <Img
          src={manifest.logo.outroUrl}
          style={{
            filter: `blur(${logoBlur}px)`,
            height: manifest.logo.outroFullFrame ? "100%" : undefined,
            maxHeight: manifest.logo.outroFullFrame ? undefined : 190,
            maxWidth: manifest.logo.outroFullFrame ? undefined : 520,
            objectFit: "contain",
            opacity: logoOpacity,
            width: manifest.logo.outroFullFrame ? "100%" : undefined,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

function CornerLogo({ manifest }: { manifest: SalesPitchRenderManifest }) {
  if (!manifest.logo.cornerUrl) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: 44,
        pointerEvents: "none",
      }}
    >
      <Img
        src={manifest.logo.cornerUrl}
        style={{
          maxHeight: 76,
          maxWidth: 190,
          objectFit: "contain",
          opacity: 0.92,
        }}
      />
    </AbsoluteFill>
  );
}

function SceneBoundaryGuard({ manifest }: { manifest: SalesPitchRenderManifest }) {
  if (manifest.scenes.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#ffffff",
        }}
      />
    );
  }

  return null;
}

function SalesPitchContent({
  manifest,
}: {
  manifest: SalesPitchRenderManifest;
}) {
  return (
    <>
      <SceneLayer manifest={manifest} />
      <SceneBoundaryGuard manifest={manifest} />
      <CornerLogo manifest={manifest} />
      <OutroOverlay manifest={manifest} />
      <MusicTrack manifest={manifest} />
      <VoiceoverTrack manifest={manifest} />
    </>
  );
}

export function SalesPitch({
  manifest,
}: {
  manifest: SalesPitchRenderManifest;
}) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <SalesPitchContent manifest={manifest} />
    </AbsoluteFill>
  );
}
