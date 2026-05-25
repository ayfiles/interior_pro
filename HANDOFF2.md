# HANDOFF2.md

Stand: 2026-05-26, Europe/Berlin.
Workspace: `C:\Users\Toshi\Documents\interiorpro`

Dieses Handoff komprimiert den bisherigen Chat und die Pipeline-Entscheidungen, damit Codex auf einem anderen Geraet direkt weiterarbeiten kann.

## Ziel

InteriorPro erzeugt aus mehreren Interior-Bildern ein finales Sales-/Showroom-Video. Aktuell sollen Testlaeufe zuerst ohne Voice-over stabil laufen. Wichtigste Ziele:

- Deutlich weniger Halluzinationen in Bild- und Video-Outputs.
- Keine schwarzen Szenen.
- Schnellerer Ablauf durch Parallelisierung, aber ohne unkontrollierte Provider-Last.
- Schnitte strikt nur an im Song hinterlegten Cutpoints.
- Multishots in definierten Musikbereichen verwenden.
- Outro mit Blur, Logo und Musik-Fade sauber rendern.
- Admin-Tests sollen Thelen-Logos verwenden.

## Wichtige Pipeline-Entscheidungen

1. Es soll nicht mehr mit zwei Musikdateien (`music.md` + JSON) gearbeitet werden, wenn nur Cutpoints relevant sind.
2. Die relevante Musikinfo ist im Song-Plan JSON:
   - `cutPointsSeconds`
   - ggf. `multishotSections`
   - ggf. `doNotHardCutAfterSeconds`
3. Der Editor-Agent muss die Song-JSON lesen und strikt nur auf diesen Cutpoints schneiden.
4. Der Editor darf im Outro die Cutpoints uebersteuern:
   - ab Start der finalen Blur-Blende darf keine Szene mehr wechseln.
   - Musik fade-out in den letzten 2 Sekunden.
5. Fuer den Test war der Song `emotional 1` der einzig relevante Song.
6. Voice-over ist fuer die ersten Testlaeufe erstmal aus/ignoriert.

## Pipeline-Ablauf, wie er gedacht ist

1. Admin/Test oder Projekt laedt Source-Bilder hoch.
2. Nano Banana Pro erzeugt/enhanced Bilder.
3. Bildvalidator prueft Input vs Output.
   - Aktuell: primaer OpenAI Vision/GPT-5.5, wenn `OPENAI_API_KEY` gesetzt ist.
   - Fallback: Gemini ueber KIE.
   - Optional Cascade: OpenAI -> Gemini oder Gemini -> Claude.
   - Wichtig: Die Validator-Policy sitzt nur in der Validation, nicht in den Generation-Prompts.
4. Rejected Bilder werden bis zu 4 Runden neu generiert.
5. Bilder werden fuer Kling single-shot / multi-shot klassifiziert.
6. Kling generiert Clips.
7. Video-Outputs werden visuell geprueft:
   - keine erfundenen Lampen/Moebel/Objekte.
   - keine Fell-/Sheepskin-/Shag-/Fellteppich-Halluzinationen.
   - keine kreative Raumerweiterung.
   - keine kompletten Rotationen, seitlich/auf dem Kopf stehenden Frames oder "room rolling".
   - intelligente Aesthetik-/Sinnhaftigkeitspruefung.
8. Media-QC prueft technische Video-Probleme:
   - schwarze Frames.
   - Freeze Frames.
   - Blur.
   - Dauer.
   - Resolution/Codec/Bitrate.
   - fast gleiche Frames an erwarteten Cut-Grenzen.
9. Multishots sollen in einzelne Segmente geschnitten und erst dann fuer den Editor geplant werden.
10. Editor baut finale Timeline anhand Song-Cutpoints.
11. Remotion rendert:
    - kleines Logo unten rechts.
    - Outro-Blur 2.5s.
    - danach weisser/grauer Outro-Screen 4s halten.
    - grosses Logo kommt 1s nach Blur-Start mit 1.5s Blur-Fade.
    - Musik fade-out in den letzten 2 Sekunden.

## Probleme aus den bisherigen Tests

1. Ein Test ist fehlgeschlagen, weil das falsche Lied ausgewaehlt war.
2. In einem Output waren schwarze Szenen. Ursache wahrscheinlich: zu wenige valide Segmente oder falsch gesetzte/zu kurze Segmente fuer die benoetigten Cut-Abstaende.
3. Validatoren haben Bilder mit klarer Fell-Halluzination durchgelassen:
   - Fell/Decke auf Couch.
   - brauner Fell-/Shag-Teppich.
4. Nano Banana hat teils kreativ erweitert. Das darf nicht passieren.
5. Kling hat teils Lampen/Objekte erfunden.
6. Stabilizer hat Outputs verschlechtert.
7. Stabilisierung soll, wenn ueberhaupt, nur fuer Multishots laufen, nie fuer Single-Shots.
8. In einem Video gab es zwischen ca. Sekunde 17-20 eine fast identische Frame-Grenze: letzter Frame vorherige Szene sah zu nah am ersten Frame der naechsten Szene aus.
9. Regel: keine Single-Shot-Clips aus demselben Input direkt hintereinander schneiden.
10. Kling-Multishots, bei denen sich das ganze Bild dreht/seitlich/auf Kopf steht, duerfen niemals ins finale Video.
11. Der Text am Ende "haloooooo Interior Beratung ..." musste komplett raus.
12. Outro-Blur und Musik-Fade wurden als gut bewertet und sollen bleiben.

## Umgesetzte Code-Aenderungen

Wichtige Dateien:

- `packages/pipeline/src/services/pipeline-constants.ts`
  - `PIPELINE_MAX_IMAGE_RETRIES` hinzugefuegt, Default `4`.
  - `PIPELINE_MULTISHOT_STABILIZATION_ENABLED` hinzugefuegt, Default `false`.

- `.env.example`
  - neue Env-Keys:
    - `OPENAI_IMAGE_VALIDATOR_MODEL=gpt-5.5`
    - `PIPELINE_IMAGE_VALIDATOR_PRIMARY=openai`
    - `PIPELINE_MAX_IMAGE_RETRIES=4`
    - `PIPELINE_MULTISHOT_STABILIZATION_ENABLED=false`
    - `ADMIN_TEST_CORNER_LOGO_STORAGE_KEY=`
    - `ADMIN_TEST_OUTRO_LOGO_STORAGE_KEY=`
    - `ADMIN_TEST_OUTRO_LOGO_BACKGROUND_COLOR=#2d3437`
    - `ADMIN_TEST_OUTRO_LOGO_FULL_FRAME=false`

- `packages/pipeline/src/services/validator.ts`
  - Validator auf Provider-Struktur umgebaut: OpenAI, Gemini, Claude.
  - OpenAI Responses API fuer Bildvergleich, wenn `OPENAI_API_KEY` gesetzt ist.
  - Gemini/Claude laufen ueber KIE-Fallback/Secondary.
  - Validator-only Policy gegen:
    - kreative Raumerweiterung.
    - neue Lampen/Moebel/Objekte.
    - Fell, Sheepskin, Fleece, Shag, Hair-like texture, braune Hide/Fell-Teppiche.
  - Merge-Logik:
    - High-confidence identity critical reject gewinnt.
    - unklare nicht-kritische Uneinigkeit wird eher `ACCEPT_WITH_WARNING`, damit nicht zu viel gedroppt wird.

- `packages/pipeline/src/services/video-validator.ts`
  - neu.
  - Extrahiert mit ffmpeg eine Contact-Sheet-Uebersicht aus dem Video.
  - Prueft Source-Image + Video-Contact-Sheet mit Gemini.
  - Felder: `rotation_integrity`, `source_fidelity`, `invented_content`, `motion_sanity`, `aesthetic_quality`, `overall_decision`, `confidence`.
  - Wenn `GEMINI_API_KEY` fehlt, wird Review skipped statt Pipeline hart zu brechen.

- `packages/pipeline/src/services/media-qc.ts`
  - `expectedCutSeconds` hinzugefuegt.
  - neue Cut-Similarity-Pruefung an erwarteten Schnittstellen.
  - `nearDuplicateCutSeconds` in Metrics.
  - `visualReview` als eigener Check ergaenzt.

- `apps/web/src/inngest/functions/testing-runner.ts`
  - Bild-Retry nutzt `PIPELINE_MAX_IMAGE_RETRIES`.
  - Validator-Metadaten loggen jetzt OpenAI/Gemini/Claude Provider Results.
  - Stabilizer nur noch, wenn Multishot und `PIPELINE_MULTISHOT_STABILIZATION_ENABLED=true`.
  - Video visual review nach Kling-Output.
  - Render-QC bekommt erwartete Cutpoints.
  - Admin-Test-Logo-Kontext:
    - `ADMIN_TEST_CORNER_LOGO_STORAGE_KEY`
    - `ADMIN_TEST_OUTRO_LOGO_STORAGE_KEY`
    - `ADMIN_TEST_OUTRO_LOGO_BACKGROUND_COLOR`
    - `ADMIN_TEST_OUTRO_LOGO_FULL_FRAME`

- `apps/web/src/inngest/functions/project-pipeline.ts`
  - gleiche Retry-/Validator-/Stabilizer-/Video-QC-Aenderungen fuer echte Projektpipeline.
  - Organisation-Settings werden geladen.
  - Logo-Storage-Keys werden aus Org-Settings aufgeloest.
  - Render-QC bekommt erwartete Cutpoints.

- `apps/web/src/inngest/functions/kie-callback-processor.ts`
  - Stabilizer im Callback nur noch fuer Multishots und nur wenn Env enabled.

- `packages/video/src/planning.ts`
  - Render-Manifest akzeptiert getrennte Logos:
    - `cornerLogoSignedUrl`
    - `outroLogoSignedUrl`
    - `outroLogoBackgroundColor`
    - `outroLogoFullFrame`
  - Segmentauswahl vermeidet same input/same clip hintereinander staerker.

- `packages/video/src/types.ts`
  - Manifest-Logo-Struktur erweitert:
    - `cornerUrl`
    - `outroUrl`
    - `outroBackgroundColor`
    - `outroFullFrame`
    - `position: "corner_and_outro"`

- `packages/video/src/SalesPitch.tsx`
  - kleines Logo unten rechts.
  - grosses Logo im Outro.
  - Full-frame-Logo-Modus fuer grosse Thelen-Datei mit Hintergrund.
  - Outro-Blur und Musik-Fade bleiben erhalten.

- `packages/video/src/Root.tsx`
  - Default-Manifest an neue Logo-Struktur angepasst.

- `apps/web/src/app/actions/account.ts`
  - neu.
  - Upload/Speicherung von Logo-Settings:
    - `cornerLogoStorageKey`
    - `outroLogoStorageKey`
    - `outroLogoBackgroundColor`
    - `outroLogoFullFrame`

- `apps/web/src/app/onboarding/page.tsx`
  - Logo-Uploads im Onboarding:
    - small corner logo.
    - large outro logo.
    - large logo has a lot of white.
    - large logo includes the full outro background.

- `apps/web/src/app/account/settings/page.tsx`
  - neu.
  - Account-Settings fuer Logo-Uploads.

- `apps/web/src/components/dashboard-shell.tsx`
  - Link `Logos` / Account Settings hinzugefuegt.

## Thelen Logos

Der User hat im Chat zwei Bilder geschickt:

1. Grosses Logo:
   - Bild mit komplett grauem Hintergrund.
   - Soll als fertiger Full-frame-Outro-Frame behandelt werden.
   - Hintergrundfarbe aus dem Bild: `#2d3437`.

2. Kleines Logo:
   - freigestelltes Thelen/Drifte-Logo.
   - Soll klein unten rechts im Video liegen.

Wichtig: Die Bilder waren im Chat sichtbar, aber nicht als lokale Dateien im Workspace auffindbar. Deshalb wurden sie noch nicht automatisch in Supabase hochgeladen.

So muss der andere Codex / User weiter machen:

1. In der App zu `/account/settings`.
2. Kleines freigestelltes Logo bei `Small corner logo` hochladen.
3. Grosses graues Logo bei `Large outro logo` hochladen.
4. Haken setzen:
   - `Large logo has a lot of white`
   - `Large logo includes the full outro background`
5. Speichern.

Fuer Admin-Test-Fallbacks nach Upload in Supabase `project-source-assets`:

```env
ADMIN_TEST_CORNER_LOGO_STORAGE_KEY=...
ADMIN_TEST_OUTRO_LOGO_STORAGE_KEY=...
ADMIN_TEST_OUTRO_LOGO_BACKGROUND_COLOR=#2d3437
ADMIN_TEST_OUTRO_LOGO_FULL_FRAME=true
```

## Env-Status und benoetigte Keys

In `apps/web/.env.local` waren vorhanden:

- `GEMINI_API_KEY`
- `KIE_API_KEY`
- `KIE_KLING_ENABLED`
- Supabase URL/Keys

Es fehlten laut Chat/Pruefung:

- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- Logo Storage Keys fuer Thelen Admin-Test-Fallbacks

Empfohlene Env:

```env
OPENAI_API_KEY=...
PIPELINE_IMAGE_VALIDATOR_PRIMARY=openai
OPENAI_IMAGE_VALIDATOR_MODEL=gpt-5.5
PIPELINE_MAX_IMAGE_RETRIES=4
PIPELINE_MULTISHOT_STABILIZATION_ENABLED=false
```

## ElevenLabs Anbindung

So anbinden:

1. ElevenLabs API-Key erstellen.
2. Voice auswaehlen und `voice_id` kopieren.
3. In `apps/web/.env.local` setzen:

```env
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

Optional pro UI-Stimme:

```env
ELEVENLABS_VOICE_ID_AMELIE=...
```

Danach Web/Inngest neu starten. Wenn `ELEVENLABS_API_KEY` fehlt, erzeugt die Pipeline weiterhin Platzhalter-Stille.

## Modell-/Validator-Entscheidung

Bewertung aus dem Chat:

- OpenAI GPT-5.5 Vision ist als primaerer Bildvalidator empfohlen, weil Bild-Input + strukturierter JSON-Output fuer harte QC gut passt.
- Gemini ist fuer Video-Review besser geeignet, weil native Video-/Frame-/Contact-Sheet-Analyse sinnvoll ist.
- Claude bleibt als Bild-Zweitmeinung moeglich, aber nicht als primaerer Video-Validator.

Wichtig: Validatoren sollen nicht stumpf nach Checkliste alles droppen, sondern intelligent bewerten:

- harte Rejects bei klaren Identitaets-/Objekt-/Material-Halluzinationen.
- keine Rejects fuer kleine Belichtung/Style-Varianten, wenn Raumidentitaet erhalten bleibt.

## 4K / 60fps Einschaetzung

Aus dem Chat:

- Kling/KIE 4K waere wahrscheinlich moeglich, aber deutlich teurer.
- Grobe Kostenrange: 4K Kling-Anteil ca. 3.7x bis 4.8x teurer als Standard/Pro, falls direkt in 4K generiert.
- Kosten steigen linear mit Sekunden/Jobs, nicht exponentiell durch Gleichzeitigkeit. Problem bei Peaks ist eher:
  - Rate Limits.
  - Provider Queue.
  - Timeouts.
  - Retry-Kaskaden.
  - Credits/Kosten in kurzer Zeit.
- 60fps geht nicht sinnvoll nur durch Remotion-FPS-Aenderung.
- Fuer echte 60fps braucht es Frame Interpolation:
  - Topaz: gut, aber langsam/lokal hardwarelastig.
  - RIFE/Cloud-GPU: wahrscheinlich schneller/guenstiger als Topaz.
  - FFmpeg `minterpolate`: kostenlos, aber langsamer/artefakt-anfaelliger.

## Skalierung / 500 gleichzeitige Anfragen

Chat-Erklaerung:

- Die Kosten pro Output sind linear.
- Gleichzeitigkeit macht sie nicht exponentiell teurer.
- Risiko liegt in Lastspitzen:
  - viele Provider-Calls gleichzeitig.
  - Rate Limits.
  - failed retries.
  - lange Queues.
  - Supabase/Storage/Inngest Durchsatz.
  - Credits werden in kurzer Zeit verbrannt.
- System sollte spaeter mit Queue, Concurrency Limits, per-account Budgets, Retry Policies, Backpressure und Job-Priorisierung laufen.

## Bereits ausgefuehrte Checks

Diese Checks liefen sauber:

```powershell
corepack pnpm --filter @interior-pro/pipeline typecheck
corepack pnpm --filter @interior-pro/video typecheck
corepack pnpm --filter @interior-pro/web typecheck
corepack pnpm --filter @interior-pro/web lint
corepack pnpm --filter @interior-pro/web build
git diff --check
```

Hinweis: `git diff --check` meldete nur Windows LF/CRLF-Warnungen, keine echten Whitespace-Fehler.

## Was noch nicht fertig/zu tun ist

1. OpenAI Key setzen, sonst laeuft Bildvalidator primaer weiter Gemini/KIE.
2. Thelen Logos als echte Dateien hochladen:
   - normal ueber `/account/settings`, oder
   - in Supabase Storage `project-source-assets` und Env-Storage-Keys setzen.
3. Danach neuen Admin-Testlauf starten.
4. Nach Testlauf den Output pruefen:
   - Fell/Teppich/Decke-Halluzinationen?
   - erfundene Lampen?
   - kreative Raumerweiterung?
   - schwarze Szenen?
   - Multishot-Rotation/seitlich/auf Kopf?
   - cutSimilarity/nahe Frames?
   - Logo unten rechts und Outro-Full-frame korrekt?
5. Falls zu viele valide Bilder gedroppt werden:
   - Merge-Logik/Confidence-Schwellen in `validator.ts` feinjustieren.
6. Falls Video-Validator zu weich/hart ist:
   - Prompt/Schema in `video-validator.ts` feinjustieren.
7. Falls Geschwindigkeit immer noch schlecht ist:
   - Concurrency-Konstanten der Test-/Projektpipeline pruefen.
   - Provider-Limits und Inngest parallelism klaeren.

## Praktische naechste Schritte fuer Codex auf anderem Geraet

1. Repo oeffnen: `C:\Users\Toshi\Documents\interiorpro`
2. `git status --short` pruefen.
3. Falls Aenderungen vorhanden sind: nicht resetten, sondern verstehen.
4. `apps/web/.env.local` pruefen/ergaenzen:

```env
OPENAI_API_KEY=...
PIPELINE_IMAGE_VALIDATOR_PRIMARY=openai
OPENAI_IMAGE_VALIDATOR_MODEL=gpt-5.5
PIPELINE_MAX_IMAGE_RETRIES=4
PIPELINE_MULTISHOT_STABILIZATION_ENABLED=false
ADMIN_TEST_OUTRO_LOGO_BACKGROUND_COLOR=#2d3437
ADMIN_TEST_OUTRO_LOGO_FULL_FRAME=true
```

5. Thelen Logos hochladen.
6. Web/Inngest starten.
7. Admin-Test mit denselben 7 Bildern erneut starten.
8. Nach Abschluss Logs und Output analysieren.

## Achtung

- Keine Generation-Prompts unnoetig erweitern. Die gewuenschte Korrektur sitzt in Validator/QC/Planning.
- Stabilizer nicht global aktivieren. Wenn ueberhaupt, nur fuer Multishots.
- Nicht wieder `music.md` als Pflichtpfad einfuehren. Song-JSON ist die Quelle fuer Cutpoints.
- Keine Szenen auffuellen, die kuerzer sind als das benoetigte Cut-Intervall.
- Keine Schnitte ausserhalb der Song-Cutpoints, ausser die definierte Outro-Regel.
