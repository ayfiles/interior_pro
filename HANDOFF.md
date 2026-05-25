# Interior Pro Handoff

Stand: 2026-05-26, lokaler Workspace `C:\Users\Toshi\Documents\interiorpro`

## Aktueller Git-Stand

- Repo: `https://github.com/ayfiles/interior_pro.git`
- Branch: `main`
- Dieser Handoff wurde erstellt, bevor der aktuelle Arbeitsstand committed und gepusht wird.
- Lokale `.env`/Secrets werden nicht committed. Auf dem Laptop muessen die echten Werte separat uebertragen oder neu aus Vercel/Supabase/Provider-Dashboards gesetzt werden.

## Was in diesem Stand neu ist

- Account-/Logo-Settings:
  - Neue Seite `/account/settings` fuer Organisation-Logos.
  - Dashboard-Link `Logos`.
  - Onboarding kann kleines Corner-Logo und grosses Outro-Logo direkt mit anlegen.
  - Logo-Uploads landen im privaten Supabase-Storage-Bucket `project-source-assets`.
- Render-Manifest und Remotion:
  - Sales-Pitch-Manifest trennt jetzt `cornerUrl` und `outroUrl`.
  - Corner-Logo wird waehrend des Videos unten rechts angezeigt.
  - Outro-Logo kann normal zentriert oder als Full-Frame-Outro genutzt werden.
  - Outro-Hintergrundfarbe kommt aus den Organisation-Settings.
- Pipeline:
  - Projektpipeline liest `organizations.settings` und nutzt diese Logos beim finalen Render.
  - Image-Retry-Limit ist jetzt separat ueber `PIPELINE_MAX_IMAGE_RETRIES`.
  - Multi-Shot-Stabilisierung ist per `PIPELINE_MULTISHOT_STABILIZATION_ENABLED=false` standardmaessig deaktiviert.
  - Finaler Media-QC bekommt erwartete Cut-Zeitpunkte aus dem Render-Manifest.
- Validator/QC:
  - Bildvalidator kann OpenAI als Primary verwenden und optional Gemini/Claude in der Cascade heranziehen.
  - Validator-Ergebnisse speichern jetzt Provider-Metadaten inklusive `primaryProvider`, `openaiResult` und `providerResults`.
  - Neue semantische Video-Review vergleicht Source-Image und Kontakt-Sheet aus dem generierten MP4 via Gemini.
  - Media-QC prueft erwartete Schnittpunkte auf Near-Duplicate-Frames.
- Testing-Runner:
  - Nutzt dieselben Logo-Kontext-Settings via Env oder Run-Konfig.
  - Fuehrt die semantische Video-Review auch im Kling-Testflow aus.

## Wichtige Dateien

- `apps/web/src/app/account/settings/page.tsx`
- `apps/web/src/app/actions/account.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/onboarding/page.tsx`
- `apps/web/src/components/dashboard-shell.tsx`
- `apps/web/src/inngest/functions/project-pipeline.ts`
- `apps/web/src/inngest/functions/kie-callback-processor.ts`
- `apps/web/src/inngest/functions/testing-runner.ts`
- `packages/pipeline/src/services/validator.ts`
- `packages/pipeline/src/services/video-validator.ts`
- `packages/pipeline/src/services/media-qc.ts`
- `packages/pipeline/src/services/pipeline-constants.ts`
- `packages/video/src/planning.ts`
- `packages/video/src/types.ts`
- `packages/video/src/SalesPitch.tsx`
- `.env.example`

## Laptop weiterarbeiten

```powershell
git clone https://github.com/ayfiles/interior_pro.git
cd interior_pro
corepack pnpm install
```

Danach die lokalen Secrets/Env-Dateien ergaenzen. Die Vorlage ist `.env.example`; echte Werte gehoeren nicht ins Repo.

Typische lokale Dev-Kommandos:

```powershell
corepack pnpm dev:web
corepack pnpm dev:inngest
```

Empfohlene Checks nach dem Pull:

```powershell
corepack pnpm --filter @interior-pro/pipeline typecheck
corepack pnpm --filter @interior-pro/video typecheck
corepack pnpm --filter @interior-pro/web typecheck
corepack pnpm --filter @interior-pro/web lint
```

## Env-Variablen, die in diesem Stand relevant dazukamen

```env
OPENAI_IMAGE_VALIDATOR_MODEL=gpt-5.5
PIPELINE_MAX_IMAGE_RETRIES=4
PIPELINE_IMAGE_VALIDATOR_PRIMARY=openai
PIPELINE_MULTISHOT_STABILIZATION_ENABLED=false
ADMIN_TEST_CORNER_LOGO_STORAGE_KEY=
ADMIN_TEST_OUTRO_LOGO_STORAGE_KEY=
ADMIN_TEST_OUTRO_LOGO_BACKGROUND_COLOR=#2d3437
ADMIN_TEST_OUTRO_LOGO_FULL_FRAME=false
```

Bestehende Provider-Secrets wie `SUPABASE_SERVICE_ROLE_KEY`, `KIE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` usw. muessen lokal vorhanden sein, wenn echte Pipeline-Laeufe gemacht werden.

## Lokale Artefakte

- `.codex-logs/` und `.codex-artifacts/` sind lokale Entwicklungs- und Render-Artefakte.
- Sie werden bewusst nicht gepusht, weil dort Logs, Kontakt-Sheets und MP4-Testausgaben liegen koennen.
- Fuer echtes Weiterarbeiten reicht der gepushte Code plus lokale Env/Secrets.

## Zuletzt ausgefuehrte Checks

- `git diff --check`
- `corepack pnpm --filter @interior-pro/pipeline typecheck`
- `corepack pnpm --filter @interior-pro/video typecheck`
- `corepack pnpm --filter @interior-pro/web typecheck`
- `corepack pnpm --filter @interior-pro/web lint`

Alle oben genannten Checks waren zum Zeitpunkt dieses Handoffs gruen.

