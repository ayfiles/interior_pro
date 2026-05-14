export const SALES_PITCH_COMPOSITION_ID = "SalesPitch";

export const SALES_PITCH_FPS = 30;
export const SALES_PITCH_WIDTH = 1920;
export const SALES_PITCH_HEIGHT = 1080;

export type TransitionKind = "cut" | "crossfade" | "soft_zoom";

export interface SourceClipForPlanning {
  clipStorageKey: string;
  durationSeconds: number | null;
  imageId: string;
  orderIndex: number;
  promptType: string | null;
  sceneChangeSeconds?: number[] | null;
}

export interface ClipSegment {
  clipStorageKey: string;
  durationSeconds: number;
  endSeconds: number;
  id: string;
  imageId: string;
  label: string;
  orderIndex: number;
  sourceDurationSeconds: number;
  startSeconds: number;
}

export interface EditorStoryPlan {
  generatedAt: string;
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
  provider: "elevenlabs" | "placeholder";
  script: string;
  targetDurationSeconds: number;
  voiceSelection: string;
  wordCount: number;
}

export interface MusicInstructionPlan {
  cutPointsSeconds: number[];
  genre: string;
  instructions: string;
  trackDurationSeconds: number | null;
  trackName: string | null;
  trackStorageKey: string | null;
  usableStartSeconds: number;
}

export interface FinalEditPlanScene {
  clipStorageKey: string;
  durationSeconds: number;
  label: string;
  segmentId: string;
  startAtSeconds: number;
  transition: TransitionKind;
  trimEndSeconds: number;
  trimStartSeconds: number;
}

export interface FinalEditPlan {
  durationSeconds: number;
  generatedAt: string;
  music: MusicInstructionPlan;
  scenes: FinalEditPlanScene[];
  voiceover: VoiceoverPlan;
}

export interface RenderScene {
  assetUrl: string;
  durationSeconds: number;
  label: string;
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
  logo: {
    position: "intro_then_corner";
    url: string | null;
  };
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
