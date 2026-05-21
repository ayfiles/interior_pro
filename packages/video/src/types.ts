export const SALES_PITCH_COMPOSITION_ID = "SalesPitch";

export const SALES_PITCH_FPS = 30;
export const SALES_PITCH_WIDTH = 1920;
export const SALES_PITCH_HEIGHT = 1080;

export type TransitionKind = "cut" | "crossfade" | "soft_zoom";
export type VideoLengthProfile = "short" | "long";

export interface MultiShotSection {
  endSeconds: number;
  pacing: string | null;
  startSeconds: number;
  style: string | null;
}

export interface SourceClipForPlanning {
  clipId?: string | null;
  clipStorageKey: string;
  durationSeconds: number | null;
  imageId: string;
  multiShotSceneCount?: number | null;
  multiShotVariant?: string | null;
  orderIndex: number;
  promptType: string | null;
  sceneChangeSeconds?: number[] | null;
  tagSegmentsAsMultiShot?: boolean | null;
}

export interface ClipSegment {
  clipId: string;
  clipStorageKey: string;
  durationSeconds: number;
  endSeconds: number;
  id: string;
  imageId: string;
  isTaggedMultiShot: boolean;
  label: string;
  multiShotSceneCount: number | null;
  multiShotVariant: string | null;
  orderIndex: number;
  promptType: string | null;
  sourceDurationSeconds: number;
  startSeconds: number;
}

export interface EditorStoryPlan {
  generatedAt: string;
  musicCutPointsSeconds: number[];
  projectId: string;
  selectedSegmentIds: string[];
  structure: Array<{
    beat: "opening" | "space" | "detail" | "comfort" | "cta";
    segmentId: string;
    voiceoverIntent: string;
  }>;
  tone: "luxury_calm";
}

export interface VoiceoverPlan {
  language: "de";
  lengthProfile: VideoLengthProfile;
  provider: "elevenlabs" | "placeholder";
  script: string;
  targetDurationSeconds: number;
  voiceSelection: string;
  wordCount: number;
}

export interface MusicInstructionPlan {
  bpmEstimate: number | null;
  cutPointsSeconds: number[];
  doNotHardCutAfterSeconds: number | null;
  fadeSeconds: {
    in?: {
      duration: number;
      start: number;
    };
    out?: {
      duration: number;
      start: number;
    };
  } | null;
  genre: string;
  instructions: string;
  lengthProfile: VideoLengthProfile;
  minHardCutSpacingSeconds: number | null;
  multishotSections: MultiShotSection[];
  preferredHardCutSpacingSeconds: number[];
  secondaryAccentPointsSeconds: number[];
  trackDurationSeconds: number | null;
  trackName: string | null;
  trackPlanSource: "default" | "track";
  trackStorageKey: string | null;
  usableStartSeconds: number;
}

export interface FinalEditPlanScene {
  clipStorageKey: string;
  durationSeconds: number;
  isTaggedMultiShot: boolean;
  label: string;
  multiShotVariant: string | null;
  promptType: string | null;
  segmentId: string;
  startAtSeconds: number;
  transition: TransitionKind;
  trimEndSeconds: number;
  trimStartSeconds: number;
}

export interface FinalEditPlan {
  durationSeconds: number;
  generatedAt: string;
  lengthProfile: VideoLengthProfile;
  music: MusicInstructionPlan;
  outro: {
    blurDurationSeconds: number;
    holdDurationSeconds: number;
    logoDelaySeconds: number;
    logoFadeDurationSeconds: number;
    musicFadeOutDurationSeconds: number;
    startAtSeconds: number;
  };
  scenes: FinalEditPlanScene[];
  voiceover: VoiceoverPlan;
}

export interface RenderScene {
  assetUrl: string;
  durationSeconds: number;
  isTaggedMultiShot: boolean;
  label: string;
  multiShotVariant: string | null;
  promptType: string | null;
  startAtSeconds: number;
  transition: TransitionKind;
  trimEndSeconds: number;
  trimStartSeconds: number;
}

export interface SalesPitchRenderManifest {
  audio: {
    musicStartSeconds: number;
    musicUrl: string | null;
    voiceoverDurationSeconds: number | null;
    voiceoverStartSeconds: number;
    voiceoverUrl: string | null;
  };
  durationSeconds: number;
  fps: number;
  generatedAt: string;
  height: number;
  lengthProfile: VideoLengthProfile;
  logo: {
    position: "outro_center";
    url: string | null;
  };
  outro: FinalEditPlan["outro"];
  project: {
    customerName: string;
    musicGenre: string;
    projectId: string;
    voiceSelection: string;
  };
  scenes: RenderScene[];
  version: 1;
  voiceoverScript: string;
  width: number;
}
