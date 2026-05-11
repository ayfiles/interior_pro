# Interior Pro Status

Stand: 2026-05-11

## Kurzfassung

Die App ist live mit Supabase verbunden, aber noch kein fertiges Produkt.
Account, Organisation, Dashboard und der Upload-Grundflow sind real.
AI-Video-Produktion, Billing und echte Pipeline-Automation sind noch nicht gebaut.

Supabase Projekt: `interiorpro`
Supabase Project ID: `tjwqzjzgokfmrzesbulu`
GitHub Repo: `ayfiles/interior_pro`

## Was geht

- Account erstellen und Login ueber Supabase Auth.
- Organisation erstellen.
- Protected Routes: ohne Login geht es zurueck zu `/login`.
- Dashboard laedt echte Daten aus Supabase.
- Projekt-Erstellung ist nicht mehr dummy:
  - Projekt wird zuerst als `draft` in Supabase angelegt.
  - Bilder werden direkt in Supabase Storage hochgeladen.
  - Jedes Bild bekommt danach einen `project_images` DB-Eintrag.
  - Credits werden reserviert.
  - Pipeline-Log wird erstellt.
  - Am Ende wird das Projekt auf `submitted` gesetzt.
- Upload-UI zeigt Ladezustand, Fortschritt und Fehler/Erfolg.
- Wenn Upload oder DB danach crasht, bleibt ein `failed` Projekt mit Fehlermeldung statt einfach zu verschwinden.
- Projekt-Detailseite zeigt echte Projekt-Daten, Logs, Status und Source Images ueber signed URLs.
- Supabase RLS ist aktiv.
- Die vorherige `organization_members` infinite-recursion Policy ist gefixt.
- Build, Typecheck und Lint laufen durch.

## Was teilweise geht

### Credits

- Projekt reserviert Credits.
- Dashboard zeigt Credit-Verbrauch.
- Aktuell sind es noch hardcoded Pilot-Credits, kein echtes Billing.

### Storage

- Private Supabase Buckets funktionieren.
- Source Upload funktioniert grundsaetzlich.
- Es gibt noch kein Cleanup fuer alte kaputte Uploads.

### Projektstatus

- `draft`, `submitted` und `failed` werden genutzt.
- Es gibt noch keine echte Background-Pipeline, die danach weiterarbeitet.

### UI

- Dashboard, New Project und Project Detail sind nutzbar.
- Andere Bereiche wie Billing, Music und Brand Kits sind noch Platzhalter oder nicht gebaut.

## Was noch nicht geht

- Keine echte Nano Banana Pro API-Ausfuehrung.
- Kein echter Kling 3.0 Video-Agent.
- Kein Runway-Fallback.
- Kein Remotion-Rendering.
- Kein finaler Video-Export.
- Kein Worker- oder Queue-System.
- Keine Realtime-Updates auf der Detailseite.
- Kein Retry-Button fuer fehlgeschlagene Projekte.
- Kein Delete, Cancel oder Edit fuer Projekte.
- Kein Stripe.
- Kein echtes Abo- oder Credit-Ledger.
- Kein Admin- oder User-Management.
- Keine E-Mail-Flows ausser Supabase Auth Standard.
- Keine Produktions-Deployment-Config finalisiert.

## Aktueller Supabase-Zustand

Zuletzt geprueft: 2026-05-11

| Bereich | Anzahl |
| --- | ---: |
| Users | 1 |
| Organizations | 1 |
| Memberships | 1 |
| Projects | 0 |
| Project images | 0 |
| Credit reservations | 0 |
| Pipeline logs | 0 |
| Source assets im Storage Bucket | 4 |

Die 4 Storage-Dateien sind sehr wahrscheinlich von vorherigen fehlgeschlagenen Upload-Versuchen.
Der Upload hat damals teilweise schon funktioniert, aber der DB-Projekt-Eintrag wurde nicht sauber erstellt.
Dafuer wurde der Flow robuster gemacht: erst Projekt als `draft` anlegen, dann Uploads/DB-Eintraege, am Ende `submitted` oder bei Fehler `failed`.

## Wichtige technische Entscheidungen

- Frontend: Next.js App Router.
- Auth, Datenbank und Storage: Supabase.
- Source-Bilder gehen direkt vom Browser in Supabase Storage.
- Public Client nutzt nur Supabase Publishable/Anon Key, keine Service Role im Browser.
- RLS Policies schuetzen Organisationen, Projekte, Bilder, Credits, Logs und Storage-Zugriff.
- Ziel fuer Image-Upscaling/Enhancement: Nano Banana Pro (`gemini-3-pro-image-preview`).
- Ziel fuer Image-to-Video: Kling 3.0.
- Runway ist als spaeterer Fallback vorgesehen.

## Naechste sinnvolle Schritte

1. Projekt-Erstellung mit echten 5-8 Bildern im Browser komplett end-to-end testen.
2. Danach pruefen, ob `projects`, `project_images`, `credit_reservations`, `pipeline_logs` und Storage sauber zusammenpassen.
3. Cleanup fuer orphaned Storage Assets bauen.
4. Retry/Delete/Edit fuer Projekte bauen.
5. Background Worker oder Queue fuer die AI-Pipeline einfuehren.
6. Nano Banana Pro API wirklich anbinden.
7. Kling 3.0 API wirklich anbinden.
8. Finalen Video-Export und Projekt-Detail-Status live machen.
9. Stripe Billing und echtes Credit-Ledger bauen.
10. Production Deployment finalisieren.

## Letzte technische Validierung

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`

Alle drei Checks waren gruen vor dem ersten GitHub Push.
