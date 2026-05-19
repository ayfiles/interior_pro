# Midnight Room Pulse

Status: first library vision / working title
Audio file: `./midnight-room-pulse_60s.mp3`
Suggested admin name: `Midnight Room Pulse`
Suggested admin genre: `soft_electronic`
Suggested admin duration: `60` seconds

## Source

- Original file: `/Users/aytouchlee/Downloads/WhatsApp Audio 2026-05-18 at 17.03.42.mpeg`
- Original metadata title: `Test 2`
- Original metadata artist: `harunkatran`
- Original metadata note: `made with suno; created=2026-05-12T20:29:07.881Z; id=7d11664e-f716-4d7f-a3ba-c4b575db0f52`
- Original duration: `109.32` seconds
- Library cut source window: `0.00` to `60.00` seconds
- Exported file duration: `60.024` seconds, treat as `60.00` in edit plans
- Fade in: `0.00` to `1.25`
- Fade out: `57.00` to `60.00`
- Tempo estimate: about `110 BPM`

## Editor Contract

Use this track as a calm but rhythmic interior/luxury track. It starts with a soft read, builds after the first few seconds, and has its strongest energy in the last third of the 60-second cut.

Rules:
- Use only the primary cut points for hard scene changes.
- Keep at least `4.5` seconds between hard cuts. The default target is one visible scene change every `5` to `6` seconds.
- Every hard cut must change something meaningful: room zone, camera angle, shot scale, material/detail, or lighting mood.
- Do not stack too many changes on the same beat. One hard cut may also carry one subtle motion change, but avoid cut + text + large zoom at once.
- If voiceover lands directly on a primary cut point, delay the visual cut slightly or move it to the next approved point.
- Use secondary accent points only for subtle actions: text reveal, logo beat, tiny speed ramp, soft push-in, or brightness/contrast accent.
- After `50.67`, prefer a final hold. Do not add a new hard cut during the fade-out.

## Primary Cut Points

These are approved hard-cut points for the 60-second library version:

```json
[0.00, 4.74, 9.94, 14.65, 19.34, 24.80, 30.16, 34.99, 40.22, 45.00, 50.67]
```

| Time | Intent |
| ---: | --- |
| `0.00` | Opening hold. Establish the room and let the viewer read the space. |
| `4.74` | First change after the intro/fade-in. Move from wide view to a more directed angle. |
| `9.94` | Detail or secondary perspective. Good for material, furniture, or light. |
| `14.65` | New room zone or a clean reverse angle. Keep it elegant. |
| `19.34` | Build moment. Suitable for a larger reveal or a stronger camera move. |
| `24.80` | Texture/detail beat. Keep the shot calm, no flashy transition. |
| `30.16` | Midpoint reset. Good place for a hero angle or a premium feature. |
| `34.99` | Softer bridge. Use crossfade or soft zoom if the footage is quiet. |
| `40.22` | Prepare the stronger final section. Increase visual confidence slightly. |
| `45.00` | Strongest edit zone begins. Best for transformation, best angle, or key selling point. |
| `50.67` | Final CTA/brand hold begins. Avoid another hard cut before the end. |

## Secondary Accent Points

Use these only for small accents, not for new scene cuts:

```json
[2.65, 23.29, 27.72, 31.88, 36.06, 41.26, 43.86, 46.21, 49.34, 54.82]
```

Recommended uses:
- `2.65`: very subtle intro motion, no scene change.
- `23.29`, `27.72`: small detail emphasis or text reveal.
- `31.88`, `36.06`: soft push-in or exposure/mood accent.
- `41.26`, `43.86`, `46.21`, `49.34`: final-section accents, but keep the edit premium.
- `54.82`: only a subtle final logo/text accent before the fade is obvious.

## Segment Shape

- `0.00-4.74`: intro, wide read, no hard visual overload.
- `4.74-19.34`: controlled exploration, 3 calm changes.
- `19.34-34.99`: build and detail rhythm.
- `34.99-45.00`: bridge into the final energy.
- `45.00-50.67`: strongest section, use the best visuals here.
- `50.67-60.00`: final hold, CTA, brand, no hard cut during fade-out.

## 54-Second Fallback

For a shorter `54` second video:
- Use the same cut from `0.00`.
- Keep primary cut points through `50.67`.
- End at `54.00`.
- Start the audio fade-out around `51.50`.
- Do not use the `54.82` secondary accent because it lands after the shorter end.

## Machine Plan

```json
{
  "trackName": "Midnight Room Pulse",
  "slug": "midnight-room-pulse",
  "genre": "soft_electronic",
  "trackDurationSeconds": 60,
  "usableStartSeconds": 0,
  "sourceWindowSeconds": {
    "start": 0,
    "end": 60
  },
  "fadeSeconds": {
    "in": {
      "start": 0,
      "duration": 1.25
    },
    "out": {
      "start": 57,
      "duration": 3
    }
  },
  "bpmEstimate": 109.9,
  "cutPointsSeconds": [0, 4.74, 9.94, 14.65, 19.34, 24.8, 30.16, 34.99, 40.22, 45, 50.67],
  "secondaryAccentPointsSeconds": [2.65, 23.29, 27.72, 31.88, 36.06, 41.26, 43.86, 46.21, 49.34, 54.82],
  "minHardCutSpacingSeconds": 4.5,
  "preferredHardCutSpacingSeconds": [5, 6],
  "doNotHardCutAfterSeconds": 50.67
}
```
