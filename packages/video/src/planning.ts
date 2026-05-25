import {
  SALES_PITCH_FPS,
  SALES_PITCH_HEIGHT,
  SALES_PITCH_WIDTH,
  type ClipSegment,
  type EditorStoryPlan,
  type FinalEditPlan,
  type FinalEditPlanScene,
  type MusicInstructionPlan,
  type MultiShotSection,
  type SalesPitchRenderManifest,
  type SourceClipForPlanning,
  type TransitionKind,
  type VideoLengthProfile,
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
  cornerLogoSignedUrl?: string | null;
  outroLogoBackgroundColor?: string | null;
  outroLogoFullFrame?: boolean | null;
  outroLogoSignedUrl?: string | null;
  musicSignedUrl?: string | null;
  project: ProjectPlanningInput;
  voiceoverSignedUrl?: string | null;
  voiceoverDurationSeconds: number | null;
}

const TARGET_VOICEOVER_SECONDS = 25;
const MIN_FINAL_DURATION_SECONDS = 30;
const MAX_FINAL_DURATION_SECONDS = 45;
const MIN_DETECTED_SEGMENT_SECONDS = 1;
const MIN_MUSIC_CUT_SPACING_SECONDS = 0.8;
const MULTISHOT_SECTION_SCENE_SECONDS = 2;
const OUTRO_BLUR_SECONDS = 2.5;
const OUTRO_HOLD_SECONDS = 4;
const OUTRO_LOGO_DELAY_SECONDS = 1;
const OUTRO_LOGO_FADE_SECONDS = 1.5;
const OUTRO_MUSIC_FADE_OUT_SECONDS = 2;
const OUTRO_TOTAL_SECONDS = OUTRO_BLUR_SECONDS + OUTRO_HOLD_SECONDS;
const VIDEO_LENGTH_PROFILE_TARGETS: Record<
  VideoLengthProfile,
  {
    maxFinalDurationSeconds: number;
    minFinalDurationSeconds: number;
    targetVoiceoverSeconds: number;
  }
> = {
  long: {
    maxFinalDurationSeconds: MAX_FINAL_DURATION_SECONDS,
    minFinalDurationSeconds: MIN_FINAL_DURATION_SECONDS,
    targetVoiceoverSeconds: TARGET_VOICEOVER_SECONDS,
  },
  short: {
    maxFinalDurationSeconds: 24,
    minFinalDurationSeconds: 18,
    targetVoiceoverSeconds: 14,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundSeconds(value: number) {
  return Math.round(value * 100) / 100;
}

function validateStrictMusicCutPoints(cutPointsSeconds: number[]) {
  if (cutPointsSeconds.length < 2 || cutPointsSeconds[0] !== 0) {
    throw new Error(
      "Selected music track cutPointsSeconds must start at 0 and include at least one cut.",
    );
  }

  for (let index = 1; index < cutPointsSeconds.length; index += 1) {
    if (
      cutPointsSeconds[index] - cutPointsSeconds[index - 1] <
      MIN_MUSIC_CUT_SPACING_SECONDS
    ) {
      throw new Error(
        "Selected music track cutPointsSeconds must be at least 0.8 seconds apart.",
      );
    }
  }
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

function configuredMultiShotBoundaries(source: SourceClipForPlanning) {
  const sceneCount =
    typeof source.multiShotSceneCount === "number" &&
    Number.isInteger(source.multiShotSceneCount) &&
    source.multiShotSceneCount > 1
      ? source.multiShotSceneCount
      : null;

  if (!sceneCount || source.promptType !== "multi_shot") {
    return null;
  }

  const sourceDurationSeconds = normalizeDuration(source.durationSeconds);
  const segmentLength = sourceDurationSeconds / sceneCount;

  return Array.from({ length: sceneCount - 1 }, (_, index) =>
    roundSeconds(segmentLength * (index + 1)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePlanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePlanNumberWithScale(value: unknown, scale = 1) {
  const number = normalizePlanNumber(value);

  return number === null ? null : roundSeconds(number / scale);
}

function normalizePlanNumberArray(value: unknown, scale = 1) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is number => Number.isFinite(item))
        .map((item) => roundSeconds(item / scale))
        .filter((item) => item >= 0),
    ),
  ).sort((a, b) => a - b);
}

function mergeSortedSeconds(...values: number[][]) {
  return Array.from(
    new Set(
      values
        .flat()
        .filter((value) => Number.isFinite(value) && value >= 0)
        .map(roundSeconds),
    ),
  ).sort((a, b) => a - b);
}

function normalizeMultishotSections(
  value: unknown,
  scale = 1,
): MultiShotSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const startSeconds = normalizePlanNumberWithScale(
        item.startSeconds ?? item.start,
        scale,
      );
      const endSeconds = normalizePlanNumberWithScale(
        item.endSeconds ?? item.end,
        scale,
      );

      if (
        startSeconds === null ||
        endSeconds === null ||
        endSeconds - startSeconds < MIN_MUSIC_CUT_SPACING_SECONDS
      ) {
        return null;
      }

      return {
        endSeconds,
        pacing: typeof item.pacing === "string" ? item.pacing : null,
        startSeconds,
        style: typeof item.style === "string" ? item.style : null,
      };
    })
    .filter((section): section is MultiShotSection => section !== null)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function buildMultishotSectionCutPoints(sections: MultiShotSection[]) {
  const points: number[] = [];

  for (const section of sections) {
    points.push(section.startSeconds);

    for (
      let point = roundSeconds(
        section.startSeconds + MULTISHOT_SECTION_SCENE_SECONDS,
      );
      section.endSeconds - point >= MIN_MUSIC_CUT_SPACING_SECONDS;
      point = roundSeconds(point + MULTISHOT_SECTION_SCENE_SECONDS)
    ) {
      points.push(point);
    }

    points.push(section.endSeconds);
  }

  return mergeSortedSeconds(points);
}

function inferTrackPlanTimeScale({
  trackDurationSeconds,
  trackPlan,
}: {
  trackDurationSeconds?: number | null;
  trackPlan: Record<string, unknown> | null;
}) {
  if (!trackPlan) {
    return 1;
  }

  const rawPlanDuration = normalizePlanNumber(trackPlan.trackDurationSeconds);
  const rawCutPoints = Array.isArray(trackPlan.cutPointsSeconds)
    ? trackPlan.cutPointsSeconds.filter((item): item is number =>
        Number.isFinite(item),
      )
    : [];
  const maxRawTime = Math.max(rawPlanDuration ?? 0, ...rawCutPoints);
  const actualDuration =
    typeof trackDurationSeconds === "number" &&
    Number.isFinite(trackDurationSeconds) &&
    trackDurationSeconds > 0
      ? trackDurationSeconds
      : null;

  if (!Number.isFinite(maxRawTime) || maxRawTime <= 0) {
    return 1;
  }

  const candidateScales = [60, 100, 1000];

  if (actualDuration && maxRawTime > actualDuration + 5) {
    return (
      candidateScales.find((scale) => {
        const scaled = maxRawTime / scale;

        return scaled >= 1 && scaled <= actualDuration + 5;
      }) ?? 1
    );
  }

  if (!actualDuration && maxRawTime > 90 && maxRawTime / 60 <= 90) {
    return 60;
  }

  return 1;
}

function normalizeFadePoint(value: unknown, scale = 1) {
  if (!isRecord(value)) {
    return null;
  }

  const start = normalizePlanNumberWithScale(value.start, scale);
  const duration = normalizePlanNumberWithScale(value.duration, scale);

  if (start === null || duration === null || duration <= 0) {
    return null;
  }

  return {
    duration: roundSeconds(duration),
    start: roundSeconds(start),
  };
}

function normalizeFadeSeconds(value: unknown, scale = 1) {
  if (!isRecord(value)) {
    return null;
  }

  const fadeIn = normalizeFadePoint(value.in, scale);
  const fadeOut = normalizeFadePoint(value.out, scale);

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
  const clipId = source.clipId ?? source.clipStorageKey;
  const configuredSceneChanges = configuredMultiShotBoundaries(source);
  const sceneChangeSeconds = normalizeSceneChangeSeconds(
    configuredSceneChanges ?? source.sceneChangeSeconds,
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
    const isTaggedMultiShot = Boolean(source.tagSegmentsAsMultiShot);

    return {
      clipId,
      clipStorageKey: source.clipStorageKey,
      durationSeconds: Math.max(1, roundSeconds(endSeconds - startSeconds)),
      endSeconds,
      id: `${clipId}:segment:${index + 1}`,
      imageId: source.imageId,
      label:
        isTaggedMultiShot
          ? `Multi-shot ${source.orderIndex + 1}.${index + 1}`
          : segmentCount === 1
          ? `Shot ${source.orderIndex + 1}`
          : `Shot ${source.orderIndex + 1}.${index + 1}`,
      isTaggedMultiShot,
      multiShotSceneCount: source.multiShotSceneCount ?? null,
      multiShotVariant: source.multiShotVariant ?? null,
      orderIndex: source.orderIndex,
      promptType: source.promptType,
      sourceDurationSeconds,
      startSeconds,
    };
  });
}

export function buildClipSegmentsFromSources(sources: SourceClipForPlanning[]) {
  return sources.flatMap(splitSourceClip);
}

export function buildEditorStoryPlan({
  music,
  project,
  segments,
}: {
  music: MusicInstructionPlan;
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
    musicCutPointsSeconds: music.cutPointsSeconds,
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
  lengthProfile = "long",
  project,
  storyPlan,
}: {
  lengthProfile?: VideoLengthProfile;
  project: ProjectPlanningInput;
  storyPlan: EditorStoryPlan;
}): VoiceoverPlan {
  const salesNote = project.salesNotes?.trim();
  const detailSentence = salesNote
    ? `Die Auswahl greift ${salesNote} auf und macht daraus eine ruhige, hochwertige Wohnsituation.`
    : "Die Auswahl verbindet klare Linien, warme Materialien und eine ruhige, hochwertige Wohnsituation.";
  const script =
    lengthProfile === "short"
      ? [
          `${project.customerName} zeigt eine kompakte, hochwertige Interior-Idee.`,
          detailSentence,
          "Jede Perspektive setzt Raumwirkung, Material und Atmosphaere klar in Szene.",
          "Gerne beraten wir Sie persoenlich zur passenden Umsetzung.",
        ].join(" ")
      : [
          `${project.customerName} zeigt, wie aus einem Raum ein persoenlicher Lieblingsort wird.`,
          detailSentence,
          "Jede Perspektive lenkt den Blick auf Proportion, Oberflaeche und Atmosphaere.",
          "So entsteht ein Interior-Konzept, das sofort verstaendlich ist und lange im Kopf bleibt.",
          "Gerne beraten wir Sie persoenlich zur passenden Umsetzung.",
        ].join(" ");

  return {
    language: "de",
    lengthProfile,
    provider: "elevenlabs",
    script,
    targetDurationSeconds:
      VIDEO_LENGTH_PROFILE_TARGETS[lengthProfile].targetVoiceoverSeconds,
    voiceSelection: project.voiceSelection,
    wordCount: script.split(/\s+/).filter(Boolean).length,
  };
}

export function buildMusicInstructionPlan({
  lengthProfile = "long",
  musicGenre,
  trackDurationSeconds,
  trackName,
  trackPlanJson,
  trackStorageKey,
}: {
  lengthProfile?: VideoLengthProfile;
  musicGenre: string;
  trackDurationSeconds?: number | null;
  trackName?: string | null;
  trackPlanJson?: unknown | null;
  trackStorageKey?: string | null;
}): MusicInstructionPlan {
  const defaultCutPoints =
    lengthProfile === "short"
      ? [0, 2.5, 5, 7.5, 10, 12.5, 15, 18, 21, 24]
      : [
          0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 33,
          36, 39, 42, 45,
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
  const timeScale = inferTrackPlanTimeScale({
    trackDurationSeconds,
    trackPlan,
  });
  const configuredTrackCutPoints = normalizePlanNumberArray(
    trackPlan?.cutPointsSeconds,
    timeScale,
  );
  const multishotSections = normalizeMultishotSections(
    trackPlan?.multishotSections,
    timeScale,
  );
  const trackCutPoints = mergeSortedSeconds(
    configuredTrackCutPoints,
    buildMultishotSectionCutPoints(multishotSections),
  );
  const secondaryAccentPoints = normalizePlanNumberArray(
    trackPlan?.secondaryAccentPointsSeconds,
    timeScale,
  );
  const preferredHardCutSpacingSeconds = normalizePlanNumberArray(
    trackPlan?.preferredHardCutSpacingSeconds ??
      trackRules?.preferredHardCutSpacingSeconds,
    timeScale,
  );
  const planInstructions =
    typeof trackPlan?.instructions === "string" && trackPlan.instructions.trim()
      ? trackPlan.instructions.trim()
      : null;
  const profileInstructions =
    lengthProfile === "short"
      ? "Short version: build a compact 18-24 second edit using the short song version and avoid late hard cuts."
      : "Long version: build the full 30-45 second edit using the long song version.";
  const hasSelectedMusicTrack = Boolean(trackStorageKey);

  if (hasSelectedMusicTrack && trackCutPoints.length === 0) {
    throw new Error("Selected music track must define cutPointsSeconds.");
  }

  const cutPointsSeconds = hasSelectedMusicTrack
    ? trackCutPoints
    : defaultCutPoints;

  if (hasSelectedMusicTrack) {
    validateStrictMusicCutPoints(cutPointsSeconds);
  }

  return {
    bpmEstimate: normalizePlanNumber(trackPlan?.bpmEstimate),
    cutPointsSeconds,
    doNotHardCutAfterSeconds: normalizePlanNumberWithScale(
      trackPlan?.doNotHardCutAfterSeconds ??
        trackRules?.doNotHardCutAfterSeconds,
      timeScale,
    ),
    fadeSeconds: normalizeFadeSeconds(trackPlan?.fadeSeconds, timeScale),
    genre: musicGenre,
    instructions: [
      hasSelectedMusicTrack
        ? "Strict timeline: scene changes may happen only at cutPointsSeconds from the selected track plan."
        : profileInstructions,
      multishotSections.length
        ? "Multishot sections are mandatory: these timeline ranges must be filled with multi-shot segments only."
        : null,
      hasSelectedMusicTrack
        ? null
        : genreInstructions[musicGenre] ?? genreInstructions.cinematic_ambient,
      planInstructions,
    ]
      .filter(Boolean)
      .join("\n\n"),
    lengthProfile,
    minHardCutSpacingSeconds: normalizePlanNumberWithScale(
      trackPlan?.minHardCutSpacingSeconds ??
        trackRules?.minHardCutSpacingSeconds,
      timeScale,
    ),
    multishotSections,
    preferredHardCutSpacingSeconds,
    secondaryAccentPointsSeconds: secondaryAccentPoints,
    trackDurationSeconds: trackDurationSeconds ?? null,
    trackName: trackName ?? null,
    trackPlanSource: trackPlan ? "track" : "default",
    trackStorageKey: trackStorageKey ?? null,
    usableStartSeconds:
      normalizePlanNumberWithScale(trackPlan?.usableStartSeconds, timeScale) ??
      0,
  };
}

function buildTrimWindow(
  segment: ClipSegment,
  durationSeconds: number,
  usageIndex: number,
) {
  const spareSeconds = roundSeconds(segment.durationSeconds - durationSeconds);
  const offsetSeconds =
    spareSeconds > 0.1
      ? roundSeconds(Math.min(spareSeconds, (usageIndex % 3) * spareSeconds * 0.5))
      : 0;
  const startSeconds = roundSeconds(segment.startSeconds + offsetSeconds);

  return {
    endSeconds: roundSeconds(startSeconds + durationSeconds),
    startSeconds,
  };
}

function selectSegmentForTimelineScene({
  durationSeconds,
  previousSegment,
  preferMultiShot,
  segmentUseCounts,
  segments,
  startAtSeconds,
}: {
  durationSeconds: number;
  previousSegment: ClipSegment | null;
  preferMultiShot: boolean;
  segmentUseCounts: Map<string, number>;
  segments: ClipSegment[];
  startAtSeconds: number;
}) {
  const fittingSegments = segments.filter(
    (segment) => segment.durationSeconds + 0.03 >= durationSeconds,
  );

  if (fittingSegments.length === 0) {
    throw new Error(
      `No QC-approved clip segment is long enough for the ${durationSeconds}s scene starting at ${startAtSeconds}s.`,
    );
  }

  const preferredSegments = fittingSegments.filter(
    (segment) => segment.isTaggedMultiShot === preferMultiShot,
  );
  const candidates =
    preferredSegments.length > 0 ? preferredSegments : fittingSegments;
  const nonRepeatCandidates =
    previousSegment === null
      ? candidates
      : candidates.filter(
          (segment) =>
            segment.clipStorageKey !== previousSegment.clipStorageKey &&
            segment.imageId !== previousSegment.imageId,
        );
  const crossModeNonRepeatCandidates =
    previousSegment === null || preferMultiShot
      ? []
      : fittingSegments.filter(
          (segment) =>
            segment.clipStorageKey !== previousSegment.clipStorageKey &&
            segment.imageId !== previousSegment.imageId,
        );
  const scoringCandidates =
    nonRepeatCandidates.length > 0
      ? nonRepeatCandidates
      : crossModeNonRepeatCandidates.length > 0
      ? crossModeNonRepeatCandidates
      : candidates;

  return [...scoringCandidates].sort((a, b) => {
    const aUseCount = segmentUseCounts.get(a.id) ?? 0;
    const bUseCount = segmentUseCounts.get(b.id) ?? 0;
    const score = (segment: ClipSegment, useCount: number) => {
      let value = useCount * 30;

      if (segment.isTaggedMultiShot !== preferMultiShot) {
        value += 12;
      }

      if (previousSegment?.clipStorageKey === segment.clipStorageKey) {
        value += 80;
      }

      if (previousSegment?.imageId === segment.imageId) {
        value += segment.isTaggedMultiShot ? 20 : 60;
      }

      value += Math.max(0, segment.durationSeconds - durationSeconds) * 0.1;
      value += segment.orderIndex * 0.01;

      return value;
    };

    return score(a, aUseCount) - score(b, bUseCount);
  })[0];
}

export function buildFinalEditPlan({
  lengthProfile,
  music,
  segments,
  voiceover,
  voiceoverDurationSeconds,
}: {
  lengthProfile?: VideoLengthProfile;
  music: MusicInstructionPlan;
  segments: ClipSegment[];
  voiceover: VoiceoverPlan;
  voiceoverDurationSeconds: number | null;
}): FinalEditPlan {
  if (segments.length === 0) {
    throw new Error("Cannot build an edit plan without clip segments.");
  }

  const resolvedLengthProfile = lengthProfile ?? music.lengthProfile;
  const durationTargets = VIDEO_LENGTH_PROFILE_TARGETS[resolvedLengthProfile];
  const voiceoverTimingSeconds =
    voiceoverDurationSeconds === null
      ? 0
      : voiceoverDurationSeconds ?? voiceover.targetDurationSeconds;
  const baseTargetDurationSeconds = clamp(
    Math.max(
      durationTargets.minFinalDurationSeconds,
      voiceoverTimingSeconds + 4,
    ),
    durationTargets.minFinalDurationSeconds,
    durationTargets.maxFinalDurationSeconds,
  );
  const hasSelectedMusicTrack = Boolean(music.trackStorageKey);
  const latestHardCutSecond =
    music.doNotHardCutAfterSeconds ?? Number.POSITIVE_INFINITY;

  if (hasSelectedMusicTrack) {
    validateStrictMusicCutPoints(music.cutPointsSeconds);
  }

  const availableCutPoints = Array.from(new Set(music.cutPointsSeconds))
    .filter((point) => point >= 0 && point <= latestHardCutSecond)
    .sort((a, b) => a - b);
  const lastStrictCutPoint = availableCutPoints.at(-1) ?? 0;
  const durationSeconds = hasSelectedMusicTrack
    ? clamp(
        Math.max(baseTargetDurationSeconds, lastStrictCutPoint + OUTRO_TOTAL_SECONDS),
        durationTargets.minFinalDurationSeconds,
        durationTargets.maxFinalDurationSeconds,
      )
    : baseTargetDurationSeconds;
  const outroStartSeconds = roundSeconds(
    Math.max(0, durationSeconds - OUTRO_TOTAL_SECONDS),
  );
  const cutPoints = availableCutPoints.filter(
    (point) => point < outroStartSeconds,
  );

  if (hasSelectedMusicTrack && cutPoints.length === 0) {
    throw new Error(
      "Selected music track has no usable cut points for the final edit.",
    );
  }

  const timelinePoints = Array.from(new Set([...cutPoints, outroStartSeconds]))
    .filter((point) => point >= 0)
    .sort((a, b) => a - b);
  const scenes: FinalEditPlanScene[] = [];
  const segmentUseCounts = new Map<string, number>();
  let previousSegment: ClipSegment | null = null;

  for (let index = 0; index < timelinePoints.length - 1; index += 1) {
    const startAtSeconds = timelinePoints[index];
    const nextPoint = timelinePoints[index + 1];
    const duration = roundSeconds(nextPoint - startAtSeconds);

    if (duration < MIN_MUSIC_CUT_SPACING_SECONDS) {
      throw new Error(
        `Music cut points ${startAtSeconds}s and ${nextPoint}s are too close for a stable scene.`,
      );
    }

    const preferMultiShot = music.multishotSections.some((section) => {
      const overlapStart = Math.max(startAtSeconds, section.startSeconds);
      const overlapEnd = Math.min(nextPoint, section.endSeconds);

      return overlapEnd - overlapStart > 0.05;
    });
    const segment = selectSegmentForTimelineScene({
      durationSeconds: duration,
      previousSegment,
      preferMultiShot,
      segmentUseCounts,
      segments,
      startAtSeconds,
    });
    const usageIndex = segmentUseCounts.get(segment.id) ?? 0;
    const trim = buildTrimWindow(segment, duration, usageIndex);
    const transition: TransitionKind = "cut";

    segmentUseCounts.set(segment.id, usageIndex + 1);
    previousSegment = segment;
    scenes.push({
      clipStorageKey: segment.clipStorageKey,
      durationSeconds: duration,
      isTaggedMultiShot: segment.isTaggedMultiShot,
      label: segment.label,
      multiShotVariant: segment.multiShotVariant,
      promptType: segment.promptType,
      segmentId: segment.id,
      startAtSeconds,
      transition,
      trimEndSeconds: trim.endSeconds,
      trimStartSeconds: trim.startSeconds,
    });
  }

  return {
    durationSeconds,
    generatedAt: new Date().toISOString(),
    lengthProfile: resolvedLengthProfile,
    music,
    outro: {
      blurDurationSeconds: OUTRO_BLUR_SECONDS,
      holdDurationSeconds: OUTRO_HOLD_SECONDS,
      logoDelaySeconds: OUTRO_LOGO_DELAY_SECONDS,
      logoFadeDurationSeconds: OUTRO_LOGO_FADE_SECONDS,
      musicFadeOutDurationSeconds: OUTRO_MUSIC_FADE_OUT_SECONDS,
      startAtSeconds: outroStartSeconds,
    },
    scenes,
    voiceover,
  };
}

export function buildSalesPitchRenderManifest({
  clipSignedUrls,
  cornerLogoSignedUrl,
  editPlan,
  musicSignedUrl,
  outroLogoBackgroundColor,
  outroLogoFullFrame,
  outroLogoSignedUrl,
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
      isTaggedMultiShot: scene.isTaggedMultiShot,
      label: scene.label,
      multiShotVariant: scene.multiShotVariant,
      promptType: scene.promptType,
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
    lengthProfile: editPlan.lengthProfile,
    logo: {
      cornerUrl: cornerLogoSignedUrl ?? null,
      outroBackgroundColor: outroLogoBackgroundColor ?? "#ffffff",
      outroFullFrame: Boolean(outroLogoFullFrame),
      outroUrl: outroLogoSignedUrl ?? null,
      position: "corner_and_outro",
    },
    outro: editPlan.outro,
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
