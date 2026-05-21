# Music Instructions

The selected music track controls the final editing rhythm.

Rules:
- Cut only on approved cut points from the track plan.
- Treat `cutPointsSeconds` in the selected track JSON as the only approved hard-cut points.
- Treat `secondaryAccentPointsSeconds` as subtle accent points only, not hard scene changes.
- Keep the first cut after the viewer has had enough time to read the room.
- Duck music only when a voiceover track is present.
- Fade music at the beginning and end.

Default genre behavior:
- `cinematic_ambient`: slow cuts, soft movement, long detail reads.
- `modern_luxury`: slightly tighter cuts, still calm and premium.
- `minimal_piano`: phrase-end cuts and longer held shots.
- `lounge_downtempo`: downbeat cuts with soft transitions.
- `soft_electronic`: rhythmic but not hectic.
- `no_music`: follow visual continuity only.
