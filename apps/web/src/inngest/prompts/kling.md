# Kling 3.0 Prompt Rules

Target output:

- Provider: Kling 3.0
- Input: one enhanced 16:9 interior still from Nano Banana Pro
- Output: short cinematic image-to-video clip
- Current implementation mode: stub artifact until real Kling credentials and endpoint behavior are confirmed

## Agent Decision Rules

The agent must choose one camera movement per enhanced image:

- `push_in`: use for the first or strongest hero frame. Best for kitchens, living rooms, bedrooms, and wide room shots.
- `pan`: use for material-heavy frames, detail shots, stone, wood, cabinetry, fabrics, lighting features, and client notes mentioning detail or material quality.
- `orbit`: use for secondary room-context frames where subtle spatial depth helps the viewer understand the layout.
- `multi_shot`: use only when the source image is marked as a multi-shot prompt and the project has multiple images.

## Prompt Requirements

Every Kling prompt must:

- Treat the enhanced image as the absolute visual reference.
- Preserve geometry, camera angle, furniture placement, object positions, colors, material finishes, lighting direction, and light fixtures.
- Use subtle, premium, physically plausible camera motion.
- Avoid warping furniture, stone, glass, textiles, lamps, cabinetry, appliances, windows, and TV screens.
- Avoid adding, removing, or relocating objects.
- Avoid changing color temperature, palette, saturation, or white balance.
- Avoid exaggerated parallax, fake CGI motion, morphing, flicker, floating objects, and rubbery surfaces.

## Preferred Output Feel

The clip should feel like a high-end editorial interior film:

- calm
- elegant
- premium
- realistic
- stable
- material-accurate
- softly cinematic

## Stub Artifact Contract

Until the real Kling API is connected, the worker writes a JSON artifact to the generated clips bucket.
The artifact must include:

- selected camera movement
- duration
- final prompt
- rationale
- enhanced input storage key
- enhanced input size and MIME type
- provider and model target
- created timestamp

When Kling is connected, replace the JSON artifact upload with the real generated video clip upload while keeping the same `video_storage_key` update flow.
