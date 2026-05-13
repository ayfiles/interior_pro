# Interior Pro Status

Stand: 2026-05-12

## Kurzfassung

Die App ist lokal lauffaehig und mit Supabase verbunden.
Account, Organisation, Dashboard, Projekt-Upload, Inngest-Orchestrierung, Validation, der erste echte Nano-Banana-Pro-Upscaling-Step und ein echter Kling-3.0-Pro-Single-Shot-Test funktionieren.

Noch kein fertiges Produkt: Multi-Shot-Video-Generation, Remotion-Finalisierung, Quality Check, echtes Billing, Production Deployment und Retry/Delete/Admin-Flows fehlen noch.

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
  - Status `editing`
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
- Reservation wird nach erfolgreichem Upscaling noch nicht final konsumiert.
- Es gibt noch keine echte Preis-/Kostenlogik pro Provider-Step.

### Pipeline-Status

- `draft`, `submitted`, `queued`, `validating`, `upscaling`, `generating_video`, `editing` und `failed` werden im aktiven Flow genutzt.
- Nach erfolgreichem Upscaling setzt die Pipeline das Projekt automatisch auf `generating_video`.
- Der Kling-Single-Shot-Step setzt das Projekt nach dem MP4-Clip automatisch auf `editing`.
- Multi-Shot, Callback-Verarbeitung und Runway-Fallback fehlen noch.
- `media_qc` bleibt im Schema vorhanden, wird aber bewusst uebersprungen.

### Storage

- Private Supabase Buckets funktionieren.
- Source Upload funktioniert.
- Enhanced Upload funktioniert.
- Kling-MP4-Artefakte werden im `project-generated-clips` Bucket gespeichert.
- Es gibt noch kein Cleanup fuer alte/orphaned Storage Assets.

### UI

- Dashboard, New Project und Project Detail sind nutzbar.
- Projekt-Detailseite zeigt generierte Clips als abspielbare Video-Vorschau.
- Projektseite zeigt noch keine Live-Updates; man muss neu laden.
- Andere Bereiche wie Billing, Music und Brand Kits sind noch Platzhalter oder nicht gebaut.

## Was noch nicht geht

- Kein Multi-Shot-Kling-Flow.
- KIE Callback-Endpoint ist gebaut; lokal wird ohne Public Callback URL weiterhin gepollt.
- Kein Runway-Fallback.
- Kein Media-QC Schritt; dieser wird bewusst uebersprungen.
- Kein Remotion-Agent fuer finale Komposition, Logos, Overlays, Musik und Schnitt.
- Kein finaler Video-Export.
- Kein finaler Quality-Check-Agent.
- Keine Realtime-Updates auf der Detailseite.
- Kein Retry-Button fuer fehlgeschlagene Projekte.
- Kein Delete, Cancel oder Edit fuer Projekte.
- Kein Stripe.
- Kein echtes Abo- oder Credit-Ledger.
- Kein Admin- oder User-Management.
- Keine E-Mail-Flows ausser Supabase Auth Standard.
- Keine Produktions-Deployment-Config finalisiert.

## Aktueller Supabase-Zustand

Zuletzt geprueft: 2026-05-12

| Bereich | Anzahl |
| --- | ---: |
| Users | 1 |
| Organizations | 1 |
| Memberships | 1 |
| Projects | 1 |
| Project images | 1 |
| Upscaled images | 1 |
| Video artifacts | 1 |
| Credit reservations | 1 |
| Pipeline logs | 23 |
| Provider jobs | 0 |
| Objects im `project-source-assets` Bucket | 6 |
| Enhanced Storage Objects | 1 |
| Objects im `project-generated-clips` Bucket | 2 |

Aktuelles Testprojekt:

- Name: `Thelen & Drifte Kitchen Test`
- Project ID: `993915ae-f3fb-48d5-af61-8c6605629cae`
- Status: `editing`
- Source images: 1
- Enhanced images: 1
- Video artifacts: 1 echtes MP4 plus 1 altes JSON-Stub-Artefakt im Storage
- Enhanced output: JPEG, `2752x1536`, ca. `2.26 MB`
- Video artifact: `clip_generated`, Kling 3.0 Pro, `4.042s`, MP4, ca. `5.17 MB`, `72` KIE Credits
- Geschaetzte Gemini-Kosten fuer den erfolgreichen Upscaling-Test: ca. `$0.14`

Hinweis: Im Storage liegen noch alte Objekte aus frueheren Tests. Cleanup ist noch offen.

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
- Der `project-generated-clips` Bucket erlaubt `application/json`, `video/mp4` und `video/quicktime`.
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
6. Remotion-Step planen und danach bauen:
   - Clips einsammeln.
   - Logo/Overlay/Musik/Voice/Brand-Daten anwenden.
   - Remotion-Script erzeugen.
   - Render starten.
   - Final Output speichern.
7. Quality-Check-Agent nach Render einbauen.
8. Credits korrekt abrechnen:
   - Reservation bei Erfolg konsumieren.
   - Bei Fehlern freigeben oder teilweise refundieren.
   - Provider-Kosten intern tracken.
9. Production Deployment vorbereiten:
   - Vercel Env Vars.
   - Inngest Cloud Signing/Event Keys.
   - Supabase Storage/RLS final pruefen.
   - Rate limits und Concurrency Limits definieren.

## Letzte technische Validierung

Zuletzt erfolgreich am 2026-05-12 nach dem Kling-Single-Shot-Umbau:

- `corepack pnpm --filter @interior-pro/pipeline typecheck`
- `corepack pnpm --filter @interior-pro/web typecheck`
- `corepack pnpm --filter @interior-pro/web lint`

Alle ausgefuehrten Checks waren gruen. Der Web-Build war vor dem Kling-Umbau gruen und sollte vor dem naechsten Commit erneut laufen.
