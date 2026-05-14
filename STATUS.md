# Interior Pro Status

Stand: 2026-05-14

## Kurzfassung

Die App ist lokal lauffaehig und mit Supabase verbunden.
Account, Organisation, Dashboard, Projekt-Upload, Inngest-Orchestrierung, Validation, echter Nano-Banana-Pro-Upscaling-Step, echter Kling-3.0-Pro-Single-Shot-Test, Media QC, Editor-Planung, Placeholder-Voiceover, Remotion-Rendering, finaler Storage-Output und Final-QC funktionieren in einem echten End-to-End-Testprojekt.

Noch kein fertiges Produkt: Multi-Shot-Video-Generation fuer alle Bilder, echte Musik-Library, echte ElevenLabs-Voices, kreativer LLM-Editor-Agent, echtes Billing, Production Deployment und Retry/Delete/Admin-Flows fehlen noch. Ein erster Editor-/Voiceover-/Remotion-MVP ist verdrahtet und E2E validiert.

Supabase Projekt: `interiorpro`
Supabase Project ID: `tjwqzjzgokfmrzesbulu`
GitHub Repo: `ayfiles/interior_pro`

## Was geht

- Account erstellen und Login ueber Supabase Auth.
- Organisation erstellen.
- Protected Routes: ohne Login geht es zurueck zu `/login`.
- Dashboard laedt echte Daten aus Supabase.
- Projekt-Erstellung ist real:
  - Projekt wird zuerst als `draft` in Supabase angelegt.
  - Bilder werden direkt in den privaten Supabase Storage Bucket geladen.
  - Jedes Bild bekommt danach einen `project_images` DB-Eintrag.
  - Credits werden reserviert.
  - Pipeline-Logs werden erstellt.
  - Am Ende wird das Projekt auf `submitted` gesetzt und ein Inngest Event gefeuert.
- Testmodus erlaubt aktuell 1 Bild statt 5-8 Bildern ueber `NEXT_PUBLIC_TEST_MIN_IMAGES=1`.
- Upload-UI zeigt Ladezustand, Fortschritt und Fehler/Erfolg.
- Projekt-Detailseite zeigt echte Projekt-Daten, Logs, Status und Bilder ueber signed URLs.
- Wenn ein Enhanced-Bild existiert, zeigt die Projektseite dieses Bild statt dem Source-Bild.
- Wenn ein generierter MP4-Clip existiert, zeigt die Projektseite oben eine Video-Vorschau mit Controls ueber signed URL aus `project-generated-clips`.
- Wenn ein final gerendertes MP4 existiert, zeigt die Projektseite oben eine Final-Video-Vorschau ueber signed URL aus `project-final-outputs`.
- Inngest ist eingerichtet:
  - Client: `apps/web/src/inngest/client.ts`
  - Function: `apps/web/src/inngest/functions/project-pipeline.ts`
  - Route: `apps/web/src/app/api/inngest/route.ts`
  - Event: `project/submitted`
- Pipeline macht aktuell:
  - Projekt laden
  - Status `queued`
  - Validation starten
  - Intake validieren
  - Status `upscaling`
  - Source Image aus Supabase Storage laden
  - Provider-Job/Idempotency-Lock fuer Gemini anlegen
  - Nano Banana Pro / Gemini API callen
  - Enhanced Image unter `/enhanced/` speichern
  - Gemini Provider-Metadaten in `provider_jobs` speichern
  - `project_images.upscaled_storage_key` setzen
  - `project_images.video_status` auf `upscaled` setzen
  - Status `generating_video`
  - fuer den Kling-Step eine signed URL fuer das Enhanced Image erzeugen
  - Single-Shot-Prompt aus `single-shot.md` laden
  - Provider-Job/Idempotency-Lock fuer KIE/Kling anlegen
  - genau 1 KIE.AI Kling 3.0 Pro Task starten (`duration: "4"`, `mode: "pro"`, `aspect_ratio: "16:9"`, `sound: false`, `multi_shots: false`)
  - KIE Task-ID in `provider_jobs.external_task_id` speichern
  - lokal ohne Public Callback URL: KIE Task pollen
  - Produktion mit `KIE_CALLBACK_URL` oder `NEXT_PUBLIC_APP_URL`: auf KIE Callback warten
  - KIE Callback unter `/api/kie/callback` annehmen
  - Callback schnell bestaetigen und internen Inngest Job `kie-callback-processor` starten
  - echtes MP4 in `project-generated-clips` speichern
  - KIE Provider-Metadaten, Credits und Output-Infos in `provider_jobs` speichern
  - `project_images.video_storage_key` setzen
  - `project_images.video_status` auf `clip_generated` setzen
  - Status `media_qc`
  - Media QC laedt jeden gespeicherten Kling-Clip aus Supabase Storage
  - FFprobe/FFmpeg pruefen Dauer, Codec, Aufloesung, Bitrate, Dateigroesse, schwarze Frames und Freeze Frames
  - zusaetzliche Blur-Schaetzung laeuft ueber FFmpeg-Frame-Samples und Laplacian-Varianz
  - zusaetzliche Scene-Change-Analyse erkennt echte Bildwechsel-Timestamps fuer Clip-Segmentierung
  - QC-Report wird in `project_images.analysis.mediaQc` gespeichert
  - `project_images.video_status` wird auf `qc_passed` oder `qc_failed` gesetzt
  - bei bestandenem QC: Status `editing`
  - bei fehlgeschlagenem QC: Status `failed`, Fehler in `projects.error_message`, Reservation wird freigegeben
  - Editor-Artefakte in `project-final-outputs` erzeugen:
    - `clip-segments.json`
    - `editor-story-plan.json`
    - `voiceover-plan.json`
    - `music-plan.json`
    - `final-edit-plan.json`
    - `render-manifest.json`
  - Voiceover-Script auf Basis von Clip-Pool, Kunde, Stimme und Sales Notes erstellen
  - Voiceover-Audio generieren:
    - mit ElevenLabs, wenn `ELEVENLABS_API_KEY` und Voice-ID konfiguriert sind
    - sonst als stille Placeholder-Audio fuer lokale End-to-End-Tests
  - Musik-Kontext aus `music_tracks` anhand von `projects.music_genre` laden, falls ein Track vorhanden ist
  - finalen Schnittplan gegen Musik-Cutpoints und Voiceover-Dauer erzeugen
  - Clip-Segmentierung schneidet nicht mehr blind nach Dauer, sondern nur an erkannten Scene-Change-Timestamps; ohne erkannte Bildwechsel bleibt der Clip ein Segment
  - Status `rendering`
  - Remotion `SalesPitch` Composition rendern
  - finales MP4 in `project-final-outputs` speichern
  - Status `quality_check`
  - finalen MP4 technisch per Media QC pruefen
  - bei bestandenem finalem QC: `project_outputs` anlegen, Reservation auf `consumed`, Status `completed`
  - Logs schreiben
- Inngest Auto-Retries sind fuer die Projektpipeline aktuell deaktiviert (`retries: 0`), damit bezahlte Provider-Calls nicht automatisch doppelt gestartet werden.
- Paid Provider Steps sind idempotent vorbereitet:
  - fertige Outputs werden wiederverwendet
  - bestehende KIE Task-IDs werden weitergepollt
  - KIE Callback-Duplikate werden ueber `provider_jobs` idempotent behandelt
  - angefangene Gemini-Jobs ohne Output blockieren automatische Doppelaufrufe und verlangen manuellen Retry
- Upscaling-Prompt ist versioniert in `apps/web/src/inngest/prompts/upscaling.md`.
- Video-Agent-Regeln sind versioniert in `apps/web/src/inngest/prompts/agent.md`.
- Multi-Shot-Prompt ist versioniert in `apps/web/src/inngest/prompts/multi-shot.md`.
- Supabase RLS ist aktiv.
- Die vorherige `organization_members` infinite-recursion Policy ist gefixt.
- Build, Typecheck und Lint laufen durch.

## Was teilweise geht

### Credits

- Projekt reserviert Credits.
- Dashboard zeigt Credit-Verbrauch.
- Aktuell sind es noch Pilot-Credits.
- Provider-Credits/Metadaten werden fuer KIE in `provider_jobs` gespeichert, soweit der Provider sie liefert.
- Reservation wird nach bestandenem finalem Render-QC auf `consumed` gesetzt.
- Es gibt noch keine echte Preis-/Kostenlogik pro Provider-Step.

### Pipeline-Status

- `draft`, `submitted`, `queued`, `validating`, `upscaling`, `generating_video`, `media_qc`, `editing`, `rendering`, `quality_check`, `completed` und `failed` werden im aktiven Flow genutzt.
- Nach erfolgreichem Upscaling setzt die Pipeline das Projekt automatisch auf `generating_video`.
- Der Kling-Single-Shot-Step setzt das Projekt nach dem MP4-Clip automatisch auf `media_qc`.
- Nach bestandenem Media QC erzeugt die Pipeline Editor-/Voiceover-/Musik-/Render-Artefakte und rendert ein finales Remotion-MP4.
- Multi-Shot-Erzeugung und Runway-Fallback fehlen noch.
- Der KIE Callback-Prozessor setzt Projekte nach gespeichertem Clip auf `media_qc` und feuert ein Resume-Event fuer die Hauptpipeline.

### Storage

- Private Supabase Buckets funktionieren.
- Source Upload funktioniert.
- Enhanced Upload funktioniert.
- Kling-MP4-Artefakte werden im `project-generated-clips` Bucket gespeichert.
- Editor-Artefakte, Voiceover-Audio und finale MP4s werden im `project-final-outputs` Bucket gespeichert.
- Es gibt noch kein Cleanup fuer alte/orphaned Storage Assets.

### UI

- Dashboard, New Project und Project Detail sind nutzbar.
- Projekt-Detailseite zeigt generierte Clips als abspielbare Video-Vorschau.
- Projekt-Detailseite zeigt das finale Video, sobald ein `project_outputs`-Datensatz existiert.
- Projektseite zeigt noch keine Live-Updates; man muss neu laden.
- Andere Bereiche wie Billing, Music und Brand Kits sind noch Platzhalter oder nicht gebaut.

## Was noch nicht geht

- Kein Multi-Shot-Kling-Flow.
- KIE Callback-Endpoint ist gebaut; lokal wird ohne Public Callback URL weiterhin gepollt.
- Kein Runway-Fallback.
- Media-QC ist als erster technischer Step vorhanden; noch offen sind feinere Schwellenwerte, UI-Report, visuelle Review und automatische Clip-Regeneration.
- Remotion-MVP fuer finale Komposition, Logos, Musik-Ducking, Voiceover und Schnitt ist vorhanden; echte kreative LLM-Entscheidung anhand von `editor.md`, `music.md`, `voice.md` ist noch offen.
- Finaler Video-Export ist als lokaler Remotion-Renderer vorhanden; Cloud/Lambda-Render-Worker fehlt noch.
- Finaler Quality-Check ist technisch vorhanden; visuelle/LLM-Review fehlt noch.
- Keine Realtime-Updates auf der Detailseite.
- Kein Retry-Button fuer fehlgeschlagene Projekte.
- Kein Delete, Cancel oder Edit fuer Projekte.
- Kein Stripe.
- Kein echtes Abo- oder Credit-Ledger.
- Kein Admin- oder User-Management.
- Keine E-Mail-Flows ausser Supabase Auth Standard.
- Keine Produktions-Deployment-Config finalisiert.

## Aktueller Supabase-Zustand

Zuletzt geprueft: 2026-05-14

| Bereich | Anzahl |
| --- | ---: |
| Organizations | 1 |
| Memberships | 1 |
| Projects | 1 |
| Project images | 1 |
| Credit reservations | 1 |
| Pipeline logs | 48 |
| Provider jobs | 1 |
| Project outputs | 1 |
| Music tracks | 0 |

Aktuelles Testprojekt:

- Name: `Thelen & Drifte Kitchen Test`
- Project ID: `993915ae-f3fb-48d5-af61-8c6605629cae`
- Status: `completed`
- Source images: 1
- Enhanced images: 1
- Video artifacts: 1 echtes MP4 plus 1 altes JSON-Stub-Artefakt im Storage
- Enhanced output: JPEG, `2752x1536`, ca. `2.26 MB`
- Video artifact: `clip_generated`, Kling 3.0 Pro, `4.042s`, MP4, ca. `5.17 MB`, `72` KIE Credits
- Media QC: `passed`, `project_images.video_status = qc_passed`
- Final output: `project-final-outputs/.../final/sales-pitch.mp4`, `30s`, `1920x1080`, ca. `19.2 MB`
- Final QC: `passed`, mit Warnungen fuer kurze Black-/Freeze-Segmente
- Credit reservation: `consumed`
- Geschaetzte Gemini-Kosten fuer den erfolgreichen Upscaling-Test: ca. `$0.14`

Hinweis: Im Storage liegen noch alte Objekte aus frueheren Tests. Cleanup ist noch offen. Der vorhandene QC-Report des Testclips wurde vor der Scene-Change-Erweiterung erzeugt; beim naechsten Pipeline-Lauf wird er neu analysiert, weil alte QC-Reports ohne `sceneChangeSeconds` nicht mehr als vollstaendig gelten.

## Wichtige technische Entscheidungen

- Frontend: Next.js App Router.
- Auth, Datenbank und Storage: Supabase.
- Source-Bilder gehen direkt vom Browser in Supabase Storage.
- Public Client nutzt nur Supabase Publishable/Anon Key, keine Service Role im Browser.
- Worker nutzt Service Role nur serverseitig.
- Secrets liegen lokal in `.env.local` Dateien und werden nicht ins Repo geschrieben.
- Queue/Orchestration: Inngest.
- Image Enhancement: Nano Banana Pro via Gemini REST API (`gemini-3-pro-image-preview`).
- Upscaling Output: 2K, 16:9.
- Ziel fuer Image-to-Video: Kling 3.0 Pro ueber KIE.AI; erster echter Single-Shot-Test ist erfolgreich.
- KIE.AI wird ueber Bearer Token (`KIE_API_KEY`) angebunden.
- KIE.AI Kling 3.0 nutzt `POST /api/v1/jobs/createTask` mit `model: kling-3.0/video`.
- KIE.AI Tasks sind async: erst `taskId`, danach Callback oder Polling ueber `/api/v1/jobs/recordInfo`.
- KIE Callback Endpoint: `POST /api/kie/callback`.
- Optionaler Callback-Schutz: `KIE_CALLBACK_SECRET`, wird als `token` Query-Param an KIE Callback URLs angehaengt und im Endpoint validiert.
- Runway ist als spaeterer Fallback vorgesehen.
- Remotion soll als Agent-Tool fuer finale Komposition, Overlays, Logos und Rendering genutzt werden.
- Clip-Segmentierung wird aus Media-QC-Scene-Change-Timestamps abgeleitet, nicht aus festen Zeitrastern.
- Der `project-generated-clips` Bucket erlaubt `application/json`, `video/mp4` und `video/quicktime`.
- Der `project-final-outputs` Bucket erlaubt JSON-Artefakte, Audio (`audio/mpeg`, `audio/wav`) und finale Video-Dateien.
- `provider_jobs` ist das zentrale Ledger fuer paid Provider Calls, Task IDs, Outputs, Credits und Idempotency Keys.

## Naechste sinnvolle Schritte

1. Projektseite weiter erweitern:
   - Provider-Jobs/Task-IDs intern sichtbar machen.
   - Live-Polling oder Realtime fuer Status/Logs.
2. Retry-Flow bewusst bauen:
   - fehlgeschlagene `provider_jobs` manuell resetten oder erneut freigeben.
   - UI-Button fuer sicheren Retry pro Step.
   - klare Warnung, wenn ein Retry erneut Geld kosten kann.
3. Kosten/Provider-Metadaten pro Pipeline-Step weiter ausbauen, z.B. geschaetzte Gemini-Kosten, Dauer und finale interne Marge.
4. Kling-Flow ausbauen:
   - bestehende `provider_jobs` Felder fuer Multi-Shot/mehrere Clips nutzen.
   - Multi-Shot Prompt aus `multi-shot.md` in den echten KIE-Flow einhaengen.
   - Agent-Entscheidung aus `agent.md` spaeter wieder fuer Multi-Shot/Camera-Planning verwenden.
5. Cleanup fuer orphaned Storage Assets bauen.
6. Musik- und Voiceover-Integration produktionsnah machen:
   - `music_tracks` befuellen.
   - Musik-MD/Cutpoint-Regeln auswerten.
   - ElevenLabs Voice IDs konfigurieren.
   - Ducking/Timing gegen echte Audio-Dauer feinjustieren.
7. Kreativen Editor-Agent ausbauen:
   - echte Clip-Auswahl und Story-Entscheidung gegen `editor.md`.
   - Scene-Change-Segmente visuell bewerten.
   - Intro/Outro/Logo-Regeln projekt- oder brand-spezifisch machen.
8. Final-QC ausbauen:
   - UI-Report fuer QC-Warnungen.
   - visuelle/LLM-Review.
   - Retry-Entscheidung pro Fehlerklasse.
9. Credits korrekt abrechnen:
   - Teilkosten je Provider-Step tracken.
   - Refund-/Retry-Regeln definieren.
   - Provider-Kosten intern tracken.
10. Production Deployment vorbereiten:
   - Vercel Env Vars.
   - Inngest Cloud Signing/Event Keys.
   - Supabase Storage/RLS final pruefen.
   - Rate limits und Concurrency Limits definieren.

## Letzte technische Validierung

Zuletzt erfolgreich am 2026-05-14 nach Media-QC/Editor/Voiceover/Remotion/Scene-Change-Umbau:

- `corepack pnpm --filter @interior-pro/pipeline typecheck`
- `corepack pnpm --filter @interior-pro/video typecheck`
- `corepack pnpm --filter @interior-pro/web typecheck`
- `corepack pnpm --filter @interior-pro/web lint`
- `corepack pnpm --filter @interior-pro/web build`
- E2E-Lauf ueber lokalen Next/Inngest-Dev-Server mit echtem Kling-MP4 bis `completed`
- Segmentierungs-Smoke-Test:
  - keine erkannten Bildwechsel -> 1 Segment
  - erkannte Bildwechsel bei `3.12s` und `6.44s` -> 3 Segmente
  - synthetischer Clip mit hartem Bildwechsel bei `2s` -> Scene Detection erkennt `[2]`

Alle ausgefuehrten Checks waren gruen. Vor Production-Deployment fehlen trotzdem noch ein frischer echter Pipeline-Lauf mit neuem Scene-Change-QC-Report und die geplanten Cloud-/Env-Pruefungen.
