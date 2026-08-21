# Standalone-App — Umsetzungsplan

**Branch:** `standalone-app` (auf `standalone-project`, enthält die API-Grenze)

Zweites Frontend als **React + Vite + Capacitor**-App, das dieselbe REST-API
konsumiert wie die Astro-Web-App. Zielbild + Begründung siehe
`MIGRATION_API_BOUNDARY.md` → „Zielarchitektur der Standalone-App".

## Phasen

1. **Thin Client (remote-only)** ← *hier starten.* App spricht die Server-API
   direkt. Keine lokale DB, kein Sync. Beweist Stack + API-Vertrag von einem
   echten zweiten Frontend aus. Erste Scheibe: **Rezepte durchblättern**.
2. **Thin Replica** — lokale SQLite als Cache + Outbox für Offline-Writes,
   pull/push-Sync gegen neue Endpoints (`/api/sync/changes`). Deckt „Einkaufs-
   liste offline" ab.
3. **Full Standalone** — Business-Logik lokal, volle Feature-Parität offline.

## Stack-Entscheidungen (Phase 1)

- **Vite + React + TypeScript**, React Router, **TanStack Query** (Remote-Cache
  jetzt, Grundlage fürs spätere Offline-Caching).
- **Tailwind** mit dem Branding der Web-App (primary=orange, secondary=slate,
  Inter) — konsistenter Look, wo sinnvoll.
- **Typen wiederverwenden:** `../src/types/*` per Vite/TS-Alias `@shared`
  (reine Typdeklarationen, kein Astro-Ballast) → kein Type-Drift.
- **Capacitor** (`@capacitor/android`) — WebView-APK. Android-SDK ist vorhanden,
  daher früh ein Debug-APK bauen.

## API-Base-URL-Strategie

- **Browser-Dev:** Vite-Proxy `/api` → Astro-Dev (`localhost:4321`). App nutzt
  relative Pfade, kein CORS.
- **Gerät/APK:** `VITE_API_BASE_URL` zeigt auf LAN/öffentliche Server-URL.
- `app/src/lib/api.ts`: `BASE = import.meta.env.VITE_API_BASE_URL ?? ''`.

## Gate pro Schritt

- `app/` baut (`npm run build` im app-Ordner) + Vite-Dev startet fehlerfrei.
- Laufzeit-Check: Seite rendert echte Server-Daten (nicht nur „kompiliert").
- Ein Commit pro Task (`feat(app): …`).

## Tasks

`A0` Scaffold · `A1` API-Client+Typen · `A2` Nav-Shell+Routing+Query ·
`A3` Rezeptliste · `A4` Rezeptdetail (inkl. Varianten-Tabs) ·
`A5` Browser-Verifikation gegen echten Server · `A6` Capacitor Android + Debug-APK

## Android-Build (A6) — reproduzierbare Schritte + Stolpersteine

Das `android/`-Verzeichnis ist generiert und **gitignored**. Native Anpassungen
(z.B. Cleartext) leben aktuell nur lokal — bei Bedarf `android/` committen.

```bash
# 1. Web mit absoluter Server-URL bauen (Gerät kann keinen Vite-Proxy nutzen):
VITE_API_BASE_URL=http://<LAN-IP>:<port> npm run build
# 2. Android-Projekt erzeugen (einmalig) + Assets syncen:
ANDROID_HOME=<sdk> npx cap add android    # danach: npx cap sync android
# 3. Debug-APK bauen — JAVA_HOME/ANDROID_HOME MÜSSEN gesetzt sein:
cd android && JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> ./gradlew.bat assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

**Gotchas auf dieser Maschine (verifiziert 2026-08-21):**
- **Port 4321 = `EACCES`** (Windows/Hyper-V-reservierter Bereich) → anderen Port
  nutzen (4399 lief). Betrifft Astro-Dev und den Vite-Proxy-Default.
- **`JAVA_HOME` zeigt auf JDK 8**, Gradle/AGP für Capacitor 6 braucht **JDK 17**
  (`…\jdk-17.0.17.10-hotspot`) → für den Build überschreiben, sonst bricht er.
- **`ANDROID_HOME` leer**, SDK liegt unter `%LOCALAPPDATA%\Android\Sdk` →
  setzen oder `android/local.properties` mit `sdk.dir=` schreiben.
- **Cleartext-HTTP**: WebView lädt per HTTP vom LAN → im Manifest
  `android:usesCleartextTraffic="true"` (Debug). Für Release scopen/entfernen.
- **Emulator vs. echtes Gerät**: AVD erreicht den Host über `10.0.2.2`, ein
  echtes Handy über die LAN-IP. Base-URL entsprechend wählen. Der aktuelle APK
  ist auf die LAN-IP gebaut → echtes Gerät im selben WLAN.
- **Mixed Content (der teure!)**: Capacitors Default `androidScheme: 'https'`
  macht die WebView-Origin `https://localhost`. Ein `fetch()` auf die
  **http**-LAN-API ist dann Mixed Content und wird still geblockt → „failed to
  fetch", obwohl Cleartext, CORS und Firewall stimmen. Symptom-Trennung: der
  Handy-**Browser** erreicht die URL (Navigation, kein MC-Check), die **App**
  nicht (WebView-fetch). Fix: `server.androidScheme: 'http'` in
  `capacitor.config.ts` (Schema an die API angleichen). Bei HTTPS-Server zurück
  auf `https`. Alternative fürs Grundproblem: `CapacitorHttp` (fetch nativ,
  umgeht CORS + Mixed Content komplett). — **On-Device verifiziert 2026-08-21.**

## Phase 2 — Spike-Ergebnis (P2-2) & Empfehlung

**Datenmenge (Live-DB, gemessen):** Datei 24,5 MB, aber **48 % freie Pages
(Bloat, per `VACUUM` rückholbar)**. Echte Daten ~12,7 MB — davon **12,0 MB
allein `shopping_lists`** (23 Listen, ~520 KB/Liste → wahrscheinlich eingebettete
Rezept-Snapshots/Akkumulation, separater Daten-Smell). Rezepte (alle 58) **0,25
MB**, Produkte/Zutaten/Tracker ~0. → Größe ist **kein Blocker** für einen lokalen
In-Memory-Store.

**Treiber-Adapter (bewiesen):** `database.ts` nutzt eine kleine, standardisierte
API-Oberfläche (102× `prepare`, 42× `exec`, 3× `transaction`, 2× `pragma`, nur
positionale `?`-Params, kein `iterate/pluck/raw`, keine `lastInsertRowid`). Ein
Node-Spike ließ **dieselbe** Query-Sequenz über einen dünnen Adapter gegen
`better-sqlite3` **und** `sql.js` (synchrones WASM) laufen → **identische
Ergebnisse**. Die sync/async-Sorge entfällt, weil `sql.js` synchron ist wie
`better-sqlite3`.

**→ Empfehlung: Strategie Y (geteilter, treiber-agnostischer Kern).** `database.ts`
bekommt eine injizierbare `SqlDriver`-Schnittstelle; der better-sqlite3-Adapter ist
quasi Pass-through (bestehende Aufrufe bleiben fast unverändert), der App-Adapter
nutzt `sql.js`. Eine Implementierung, kein Drift — konsequente Fortsetzung von
API-Grenze + geteilten Typen.

**Rest-Unbekannte (geringes Risiko, Folgeschritte):** sql.js-WASM im echten
Capacitor-WebView laden (kurzer Geräte-Check); Persistenz (sql.js exportiert
Bytes → Capacitor Filesystem/IndexedDB, Reload beim Start); `pragma`-Handling im
Adapter; der 12-MB-shopping_lists-Smell separat untersuchen.

## Phase 2 — Y-Fortschritt

- ✅ **Y-Kern**: `database.ts` treiber-agnostisch (`SqlDriver` + better-sqlite3-Adapter).
- ✅ **Y-split**: Server-Singleton in `database.server.ts`, `database.ts` import-clean
  (kein better-sqlite3 im Graph), 42 Importe umgebogen.
- ✅ **Y-app**: geteilter Kern läuft in der App auf **sql.js** (WASM) via `@core`-Alias,
  Persistenz in IndexedDB. Im Browser verifiziert (Schema, CRUD, Reload-Persistenz).
  Rest-Check: sql.js-WASM im echten Capacitor-WebView (Route `/_localtest` als Probe).
- ⏭️ **Y-sync** (offen, design-schwer): pull/push-Endpoints (`updated_at` + `sync_tombstones`),
  Outbox, Last-Write-Wins, Opt-out pro Entity (alias-Achse), „Server First, lokal als Fallback".
  Braucht Design-Entscheidungen → separat besprechen.

## Bewusst später
- Lokale SQLite / Sync / Tombstones (Phase 2).
- Weitere Features (Einkaufsliste, Tracker, Produkte) nach bewiesenem Stack.
- Shared-Types als eigenes Package (erst wenn Drift real wird).
