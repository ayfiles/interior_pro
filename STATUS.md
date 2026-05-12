# Interior Pro Status

Stand: 2026-05-12

## Kurzfassung

Die App ist lokal lauffaehig und mit Supabase verbunden.
Account, Organisation, Dashboard, Projekt-Upload, Inngest-Orchestrierung, Validation, der erste echte Nano-Banana-Pro-Upscaling-Step und ein Kling-Videogeneration-Stub funktionieren.

Noch kein fertiges Produkt: echte Kling-Video-Generation, Remotion-Finalisierung, Quality Check, echtes Billing, Production Deployment und Retry/Delete/Admin-Flows fehlen noch.

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
  - Nano Banana Pro / Gemini API callen
  - Enhanced Image unter `/enhanced/` speichern
  - `project_images.upscaled_storage_key` setzen
  - `project_images.video_status` auf `upscaled` setzen
  - Status `generating_video`
  - Enhanced Image fuer den Kling-Step aus Supabase Storage laden
  - Kling Prompt-Regeln aus Markdown laden
  - Stub-Agent entscheidet pro Bild Kamera-Move, Dauer und Prompt
  - Stub-Clip-Artefakt in `project-generated-clips` speichern
  - `project_images.video_storage_key` setzen
  - `project_images.video_status` auf `clip_stubbed` setzen
  - Status `media_qc`
  - Logs schreiben
- Upscaling-Prompt ist versioniert in `apps/web/src/inngest/prompts/upscaling.md`.
- Kling-Prompt-Regeln sind versioniert in `apps/web/src/inngest/prompts/kling.md`.
- Supabase RLS ist aktiv.
- Die vorherige `organization_members` infinite-recursion Policy ist gefixt.
- Build, Typecheck und Lint laufen durch.

## Was teilweise geht

### Credits

- Projekt reserviert Credits.
- Dashboard zeigt Credit-Verbrauch.
- Aktuell sind es noch Pilot-Credits.
- Reservation wird nach erfolgreichem Upscaling noch nicht final konsumiert.
- Es gibt noch keine echte Preis-/Kostenlogik pro Provider-Step.

### Pipeline-Status

- `draft`, `submitted`, `queued`, `validating`, `upscaling`, `generating_video`, `media_qc` und `failed` werden genutzt.
- Nach erfolgreichem Upscaling setzt die Pipeline das Projekt automatisch auf `generating_video`.
- Der Kling-Stub setzt das Projekt nach dem Clip-Artefakt automatisch auf `media_qc`.
- Der naechste Ausbau sollte den echten Kling-API-Call anstelle des Stub-Artefakts einsetzen.

### Storage

- Private Supabase Buckets funktionieren.
- Source Upload funktioniert.
- Enhanced Upload funktioniert.
- Kling-Stub-Artefakte werden im `project-generated-clips` Bucket gespeichert.
- Es gibt noch kein Cleanup fuer alte/orphaned Storage Assets.

### UI

- Dashboard, New Project und Project Detail sind nutzbar.
- Projektseite zeigt noch keine Live-Updates; man muss neu laden.
- Andere Bereiche wie Billing, Music und Brand Kits sind noch Platzhalter oder nicht gebaut.

## Was noch nicht geht

- Kein echter Kling 3.0 Video-Step.
- Kein echter Kling API Call; aktuell gibt es nur ein JSON-Stub-Artefakt statt MP4/MOV.
- Kein Runway-Fallback.
- Kein echter Media-QC nach Kling.
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
| Pipeline logs | 19 |
| Objects im `project-source-assets` Bucket | 6 |
| Enhanced Storage Objects | 1 |
| Objects im `project-generated-clips` Bucket | 1 |

Aktuelles Testprojekt:

- Name: `Thelen & Drifte Kitchen Test`
- Project ID: `993915ae-f3fb-48d5-af61-8c6605629cae`
- Status: `media_qc`
- Source images: 1
- Enhanced images: 1
- Video artifacts: 1 JSON Stub-Artefakt
- Enhanced output: JPEG, `2752x1536`, ca. `2.26 MB`
- Video artifact: `clip_stubbed`, Kamera-Move `push_in`, Dauer `5s`
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
- Ziel fuer Image-to-Video: Kling 3.0; aktuell als Stub mit JSON-Artefakt.
- Runway ist als spaeterer Fallback vorgesehen.
- Remotion soll als Agent-Tool fuer finale Komposition, Overlays, Logos und Rendering genutzt werden.
- Der `project-generated-clips` Bucket erlaubt waehrend der Stub-Phase zusaetzlich `application/json`.

## Naechste sinnvolle Schritte

1. Kosten/Provider-Metadaten pro Pipeline-Step besser speichern, z.B. Modell, Output-Groesse, geschaetzte Kosten, Dauer.
2. Den Kling-Stub durch den echten Kling API Call ersetzen:
   - Enhanced Images an Kling senden.
   - Agent-Prompt aus `kling.md` weiterverwenden.
   - echtes MP4/MOV in `project-generated-clips` speichern.
   - `video_status` auf echten Erfolgsstatus setzen.
3. Retry-Flow fuer Pipeline-Steps bauen, besonders fuer Upscaling und Kling.
4. Cleanup fuer orphaned Storage Assets bauen.
5. Projekt-Detailseite mit Polling oder Supabase Realtime live machen.
6. Media-QC-Stub oder echten Media-QC-Agent einbauen.
7. Remotion-Step planen und danach bauen:
   - Clips einsammeln.
   - Logo/Overlay/Musik/Voice/Brand-Daten anwenden.
   - Remotion-Script erzeugen.
   - Render starten.
   - Final Output speichern.
8. Quality-Check-Agent nach Render einbauen.
9. Credits korrekt abrechnen:
   - Reservation bei Erfolg konsumieren.
   - Bei Fehlern freigeben oder teilweise refundieren.
   - Provider-Kosten intern tracken.
10. Production Deployment vorbereiten:
   - Vercel Env Vars.
   - Inngest Cloud Signing/Event Keys.
   - Supabase Storage/RLS final pruefen.
   - Rate limits und Concurrency Limits definieren.

## Letzte technische Validierung

Zuletzt erfolgreich am 2026-05-12:

- `corepack pnpm --filter @interior-pro/pipeline typecheck`
- `corepack pnpm --filter @interior-pro/web typecheck`
- `corepack pnpm --filter @interior-pro/web lint`
- `corepack pnpm --filter @interior-pro/web build`

Alle Checks waren gruen.
