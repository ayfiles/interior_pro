import { Composition } from "remotion";
import { SalesPitch } from "./SalesPitch";
import {
  SALES_PITCH_COMPOSITION_ID,
  SALES_PITCH_FPS,
  SALES_PITCH_HEIGHT,
  SALES_PITCH_WIDTH,
  type SalesPitchRenderManifest,
} from "./types";

const defaultManifest: SalesPitchRenderManifest = {
  audio: {
    musicStartSeconds: 0,
    musicUrl: null,
    voiceoverDurationSeconds: null,
    voiceoverStartSeconds: 2,
    voiceoverUrl: null,
  },
  durationSeconds: 30,
  fps: SALES_PITCH_FPS,
  generatedAt: new Date(0).toISOString(),
  height: SALES_PITCH_HEIGHT,
  lengthProfile: "long",
  logo: {
    position: "outro_center",
    url: null,
  },
  outro: {
    blurDurationSeconds: 2.5,
    holdDurationSeconds: 4,
    logoDelaySeconds: 1,
    logoFadeDurationSeconds: 1.5,
    musicFadeOutDurationSeconds: 2,
    startAtSeconds: 23.5,
  },
  project: {
    customerName: "Interior Pro",
    musicGenre: "cinematic_ambient",
    projectId: "preview",
    voiceSelection: "preview",
  },
  scenes: [],
  version: 1,
  voiceoverScript: "",
  width: SALES_PITCH_WIDTH,
};

export function RemotionRoot() {
  return (
    <Composition
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(
          SALES_PITCH_FPS,
          Math.round(props.manifest.durationSeconds * SALES_PITCH_FPS),
        ),
        fps: SALES_PITCH_FPS,
        height: SALES_PITCH_HEIGHT,
        width: SALES_PITCH_WIDTH,
      })}
      component={SalesPitch}
      defaultProps={{ manifest: defaultManifest }}
      durationInFrames={SALES_PITCH_FPS * 30}
      fps={SALES_PITCH_FPS}
      height={SALES_PITCH_HEIGHT}
      id={SALES_PITCH_COMPOSITION_ID}
      width={SALES_PITCH_WIDTH}
    />
  );
}
