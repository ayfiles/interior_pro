import {
  SALES_PITCH_FPS,
  SALES_PITCH_HEIGHT,
  SALES_PITCH_WIDTH,
  type ClipSegment,
  type EditorStoryPlan,
  type FinalEditPlan,
  type FinalEditPlanScene,
  type MusicInstructionPlan,
  type SalesPitchRenderManifest,
  type SourceClipForPlanning,
  type TransitionKind,
  type VoiceoverPlan,
} from "./types";

interface ProjectPlanningInput {
  customerName: string;
  musicGenre: string;
  projectId: string;
  salesNotes: string | null;
  voiceSelection: string;
}

interface BuildRenderManifestInput {
  clipSignedUrls: Map<string, string>;
  editPlan: FinalEditPlan;
  logoSignedUrl?: string | null;
  musicSignedUrl?: string | null;
  project: ProjectPlanningInput;
  voiceoverSignedUrl?: string | null;
  voiceoverDurationSeconds: number | null;
}

const TARGET_VOICEOVER_SECONDS = 25;
const MIN_FINAL_DURATION_SECONDS = 30;
const MAX_FINAL_DURATION_SECONDS = 45;
const MIN_DETECTED_SEGMENT_SECONDS = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundSeconds(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeDuration(durationSeconds: number | null) {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) {
    return 4;
  }

  return Math.max(1, roundSeconds(durationSeconds));
}

function normalizeSceneChangeSeconds(
  sceneChangeSeconds: number[] | null | undefined,
  sourceDurationSeconds: number,
) {
  const changes = (sceneChangeSeconds ?? [])
    .filter((value) => Number.isFinite(value))
    .map(roundSeconds)
    .filter(
      (value) =>
        value >= MIN_DETECTED_SEGMENT_SECONDS &&
        sourceDurationSeconds - value >= MIN_DETECTED_SEGMENT_SECONDS,
    )
    .sort((a, b) => a - b);
  const normalized: number[] = [];

  for (const change of changes) {
    const previousBoundary = normalized.at(-1) ?? 0;

    if (change - previousBoundary < MIN_DETECTED_SEGMENT_SECONDS) {
      continue;
    }

    normalized.push(change);
  }

  return normalized.filter(
    (change, index) =>
      (normalized[index + 1] ?? sourceDurationSeconds) - change >=
      MIN_DETECTED_SEGMENT_SECONDS,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePlanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePlanNumberArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is number => Number.isFinite(item))
        .map(roundSeconds)
        .filter((item) => item >= 0),
    ),
  ).sort((a, b) => a - b);
}

function normalizeFadePoint(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const start = normalizePlanNumber(value.start);
  const duration = normalizePlanNumber(value.duration);

  if (start === null || duration === null || duration <= 0) {
    return null;
  }

  return {
    duration: roundSeconds(duration),
    start: roundSeconds(start),
  };
}

function normalizeFadeSeconds(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const fadeIn = normalizeFadePoint(value.in);
  const fadeOut = normalizeFadePoint(value.out);

  if (!fadeIn && !fadeOut) {
    return null;
  }

  return {
    ...(fadeIn ? { in: fadeIn } : {}),
    ...(fadeOut ? { out: fadeOut } : {}),
  };
}

function splitSourceClip(source: SourceClipForPlanning): ClipSegment[] {
  const sourceDurationSeconds = normalizeDuration(source.durationSeconds);
  const sceneChangeSeconds = normalizeSceneChangeSeconds(
    source.sceneChangeSeconds,
    sourceDurationSeconds,
  );
  const segmentBoundaries = [
    0,
    ...sceneChangeSeconds,
    sourceDurationSeconds,
  ];
  const segmentCount = segmentBoundaries.length - 1;

  return Array.from({ length: segmentCount }, (_, index) => {
    const startSeconds = roundSeconds(segmentBoundaries[index]);
    const endSeconds = roundSeconds(segmentBoundaries[index + 1]);

    return {
      clipStorageKey: source.clipStorageKey,
      durationSeconds: Math.max(1, roundSeconds(endSeconds - startSeconds)),
      endSeconds,
      id: `${source.imageId}:segment:${index + 1}`,
      imageId: source.imageId,
      label:
        segmentCount === 1
          ? `Shot ${source.orderIndex + 1}`
          : `Shot ${source.orderIndex + 1}.${index + 1}`,
      orderIndex: source.orderIndex,
      sourceDurationSeconds,
      startSeconds,
    };
  });
}

export function buildClipSegmentsFromSources(sources: SourceClipForPlanning[]) {
  return sources.flatMap(splitSourceClip);
}

export function buildEditorStoryPlan({
  project,
  segments,
}: {
  project: ProjectPlanningInput;
  segments: ClipSegment[];
}): EditorStoryPlan {
  const selectedSegments = segments.length > 0 ? segments : [];
  const fallbackIntent = project.salesNotes
    ? `Greife die Sales-Notiz auf: ${project.salesNotes}`
    : "Inszeniere Raumwirkung, Materialitaet und Kaufimpuls ruhig und hochwertig.";
  const beats: EditorStoryPlan["structure"][number]["beat"][] = [
    "opening",
    "space",
    "detail",
    "comfort",
    "cta",
  ];

  return {
    generatedAt: new Date().toISOString(),
    projectId: project.projectId,
    selectedSegmentIds: selectedSegments.map((segment) => segment.id),
    structure: beats.map((beat, index) => {
      const segment =
        selectedSegments[index % Math.max(selectedSegments.length, 1)];

      return {
        beat,
        segmentId: segment?.id ?? "missing-segment",
        voiceoverIntent:
          beat === "opening"
            ? `${project.customerName} wird als kuratierte Interior-Praesentation eingefuehrt.`
            : beat === "cta"
              ? "Schliesse mit einem ruhigen, klaren Beratungsimpuls."
              : fallbackIntent,
      };
    }),
    tone: "luxury_calm",
  };
}

export function buildVoiceoverPlan({
  project,
  storyPlan,
}: {
  project: ProjectPlanningInput;
  storyPlan: EditorStoryPlan;
}): VoiceoverPlan {
  const salesNote = project.salesNotes?.trim();
  const detailSentence = salesNote
    ? `Die Auswahl greift ${salesNote} auf und macht daraus eine ruhige, hochwertige Wohnsituation.`
    : "Die Auswahl verbindet klare Linien, warme Materialien und eine ruhige, hochwertige Wohnsituation.";
  const script = [
    `${project.customerName} zeigt, wie aus einem Raum ein persoenlicher Lieblingsort wird.`,
    detailSentence,
    "Jede Perspektive lenkt den Blick auf Proportion, Oberflaeche und Atmosphaere.",
    "So entsteht ein Interior-Konzept, das sofort verstaendlich ist und lange im Kopf bleibt.",
    "Gerne beraten wir Sie persoenlich zur passenden Umsetzung.",
  ].join(" ");

  return {
    language: "de",
    provider: "elevenlabs",
    script,
    targetDurationSeconds: TARGET_VOICEOVER_SECONDS,
    voiceSelection: project.voiceSelection,
    wordCount: script.split(/\s+/).filter(Boolean).length,
  };
}

export function buildMusicInstructionPlan({
  musicGenre,
  trackInstructionsMd,
  trackDurationSeconds,
  trackName,
  trackPlanJson,
  trackStorageKey,
}: {
  musicGenre: string;
  trackInstructionsMd?: string | null;
  trackDurationSeconds?: number | null;
  trackName?: string | null;
  trackPlanJson?: unknown | null;
  trackStorageKey?: string | null;
}): MusicInstructionPlan {
  const defaultCutPoints = [
    0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 33, 36,
    39, 42, 45,
  ];
  const genreInstructions: Record<string, string> = {
    cinematic_ambient:
      "Ruhige Schnitte auf weiche Akzente. Keine harten Cuts direkt vor dem Voiceover-Einstieg.",
    lounge_downtempo:
      "Schnitte duerfen auf Downbeats liegen, Uebergaenge bleiben weich und hochwertig.",
    minimal_piano:
      "Schnitte an Phrasenenden setzen, Detailshots laenger stehen lassen.",
    modern_luxury:
      "Etwas praezisere Schnitte, aber keine hektischen Montagen.",
    no_music:
      "Ohne Musik: Schnitte folgen Voiceover-Pausen und visueller Ruhe.",
    soft_electronic:
      "Schnitte koennen rhythmischer liegen, Transitions bleiben subtil.",
  };
  const trackPlan = isRecord(trackPlanJson) ? trackPlanJson : null;
  const trackRules = isRecord(trackPlan?.rules) ? trackPlan.rules : null;
  const trackCutPoints = normalizePlanNumberArray(trackPlan?.cutPointsSeconds);
  const secondaryAccentPoints = normalizePlanNumberArray(
    trackPlan?.secondaryAccentPointsSeconds,
  );
  const preferredHardCutSpacingSeconds = normalizePlanNumberArray(
    trackPlan?.preferredHardCutSpacingSeconds ??
      trackRules?.preferredHardCutSpacingSeconds,
  );
  const planInstructions =
    typeof trackPlan?.instructions === "string" && trackPlan.instructions.trim()
      ? trackPlan.instructions.trim()
      : null;
  const songInstructions = trackInstructionsMd?.trim()
    ? `Song-specific instructions:\n${trackInstructionsMd.trim()}`
    : null;

  return {
    bpmEstimate: normalizePlanNumber(trackPlan?.bpmEstimate),
    cutPointsSeconds: trackCutPoints.length ? trackCutPoints : defaultCutPoints,
    doNotHardCutAfterSeconds: normalizePlanNumber(
      trackPlan?.doNotHardCutAfterSeconds ??
        trackRules?.doNotHardCutAfterSeconds,
    ),
    fadeSeconds: normalizeFadeSeconds(trackPlan?.fadeSeconds),
    genre: musicGenre,
    instructions: [
      genreInstructions[musicGenre] ?? genreInstructions.cinematic_ambient,
      planInstructions,
      songInstructions,
    ]
      .filter(Boolean)
      .join("\n\n"),
    minHardCutSpacingSeconds: normalizePlanNumber(
      trackPlan?.minHardCutSpacingSeconds ??
        trackRules?.minHardCutSpacingSeconds,
    ),
    preferredHardCutSpacingSeconds,
    secondaryAccentPointsSeconds: secondaryAccentPoints,
    trackDurationSeconds: trackDurationSeconds ?? null,
    trackName: trackName ?? null,
    trackPlanSource: trackPlan ? "track" : "default",
    trackStorageKey: trackStorageKey ?? null,
    usableStartSeconds: normalizePlanNumber(trackPlan?.usableStartSeconds) ?? 0,
  };
}

export function buildFinalEditPlan({
  music,
  segments,
  voiceover,
  voiceoverDurationSeconds,
}: {
  music: MusicInstructionPlan;
  segments: ClipSegment[];
  voiceover: VoiceoverPlan;
  voiceoverDurationSeconds: number | null;
}): FinalEditPlan {
  if (segments.length === 0) {
    throw new Error("Cannot build an edit plan without clip segments.");
  }

  const durationSeconds = clamp(
    Math.max(
      MIN_FINAL_DURATION_SECONDS,
      (voiceoverDurationSeconds ?? voiceover.targetDurationSeconds) + 4,
    ),
    MIN_FINAL_DURATION_SECONDS,
    MAX_FINAL_DURATION_SECONDS,
  );
  const latestHardCutSecond =
    music.doNotHardCutAfterSeconds ?? Number.POSITIVE_INFINITY;
  const minCutSpacing = music.minHardCutSpacingSeconds ?? 0.8;
  const cutPoints = music.cutPointsSeconds
    .filter(
      (point) =>
        point >= 0 &&
        point < durationSeconds &&
        point <= latestHardCutSecond,
    )
    .reduce<number[]>((points, point) => {
      const previous = points.at(-1);

      if (previous === undefined || point - previous >= minCutSpacing) {
        points.push(point);
      }

      return points;
    }, []);
  const timelinePoints = Array.from(new Set([...cutPoints, durationSeconds]))
    .filter((point) => point >= 0)
    .sort((a, b) => a - b);
  const scenes: FinalEditPlanScene[] = [];

  for (let index = 0; index < timelinePoints.length - 1; index += 1) {
    const startAtSeconds = timelinePoints[index];
    const nextPoint = timelinePoints[index + 1];
    const duration = roundSeconds(nextPoint - startAtSeconds);

    if (duration < 0.8) {
      continue;
    }

    const segment = segments[index % segments.length];
    const maxTrimEnd = segment.endSeconds;
    const trimStartSeconds = segment.startSeconds;
    const trimEndSeconds = Math.min(
      maxTrimEnd,
      roundSeconds(trimStartSeconds + duration),
    );
    const transition: TransitionKind =
      index === 0 ? "soft_zoom" : index % 3 === 0 ? "crossfade" : "cut";

    scenes.push({
      clipStorageKey: segment.clipStorageKey,
      durationSeconds: duration,
      label: segment.label,
      segmentId: segment.id,
      startAtSeconds,
      transition,
      trimEndSeconds,
      trimStartSeconds,
    });
  }

  return {
    durationSeconds,
    generatedAt: new Date().toISOString(),
    music,
    scenes,
    voiceover,
  };
}

export function buildSalesPitchRenderManifest({
  clipSignedUrls,
  editPlan,
  logoSignedUrl,
  musicSignedUrl,
  project,
  voiceoverDurationSeconds,
  voiceoverSignedUrl,
}: BuildRenderManifestInput): SalesPitchRenderManifest {
  const scenes = editPlan.scenes.map((scene) => {
    const assetUrl = clipSignedUrls.get(scene.clipStorageKey);

    if (!assetUrl) {
      throw new Error(`Missing signed URL for clip ${scene.clipStorageKey}.`);
    }

    return {
      assetUrl,
      durationSeconds: scene.durationSeconds,
      label: scene.label,
      startAtSeconds: scene.startAtSeconds,
      transition: scene.transition,
      trimEndSeconds: scene.trimEndSeconds,
      trimStartSeconds: scene.trimStartSeconds,
    };
  });

  return {
    audio: {
      musicStartSeconds: editPlan.music.usableStartSeconds,
      musicUrl: musicSignedUrl ?? null,
      voiceoverDurationSeconds,
      voiceoverStartSeconds: 2,
      voiceoverUrl: voiceoverSignedUrl ?? null,
    },
    durationSeconds: editPlan.durationSeconds,
    fps: SALES_PITCH_FPS,
    generatedAt: new Date().toISOString(),
    height: SALES_PITCH_HEIGHT,
    logo: {
      position: "intro_then_corner",
      url: logoSignedUrl ?? null,
    },
    project: {
      customerName: project.customerName,
      musicGenre: project.musicGenre,
      projectId: project.projectId,
      voiceSelection: project.voiceSelection,
    },
    scenes,
    version: 1,
    voiceoverScript: editPlan.voiceover.script,
    width: SALES_PITCH_WIDTH,
  };
}
