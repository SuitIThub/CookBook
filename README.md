# Kochbuch

[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)

Ein selbst gehostetes digitales Kochbuch für den Haushalt: Rezepte sammeln, importieren und kochen, gemeinsame Einkaufslisten führen, Produkte und Preise verwalten und Kalorien tracken — als **Website** und als **Android-App**, die auch offline funktioniert und sich mit dem Server synchronisiert.

- **Website** (Astro + SQLite): läuft auf deinem Server, nutzbar in jedem Browser, auch als PWA.
- **Android-App** (React + Capacitor): bildet die Website ab, arbeitet mit einer lokalen Kopie der Daten (offline) und gleicht sie mit dem Server ab — so teilt ihr Rezepte und Einkaufslisten mit Mitbewohnern. Dazu kommen App-Extras wie Hintergrund-Timer, Push-Benachrichtigungen und automatische Updates.

---

## Inhalt

- [Funktionen](#funktionen)
  - [Rezepte](#rezepte)
  - [Rezept-Import](#rezept-import)
  - [KI-Assistent](#ki-assistent)
  - [Kochmodus & Timer](#kochmodus--timer)
  - [Einkaufslisten](#einkaufslisten)
  - [Produkte, Supermärkte & Preise](#produkte-supermärkte--preise)
  - [Zutaten-Katalog & Nährwerte](#zutaten-katalog--nährwerte)
  - [Kalorien- & Nährwerttracker](#kalorien---nährwerttracker)
  - [Aliasse, Einstellungen & Zugriff](#aliasse-einstellungen--zugriff)
  - [Android-App](#android-app)
- [Entwicklung](#entwicklung)

---

## Funktionen

### Rezepte

- Rezepte mit Untertitel, Beschreibung, Kategorie, Tags, Portionen, Schwierigkeit und beliebig vielen Zeitangaben (Vorbereitung, Kochen, Backen, Ruhen …)
- **Verschachtelte Zutaten- und Zubereitungsgruppen** (z. B. „Teig“, „Füllung“) mit mehreren Mengenangaben pro Zutat und Einheiten-Umrechnung
- **Zutaten in Zubereitungsschritten verknüpft**: farbige Markierungen zeigen, welche Zutat in welchem Schritt gebraucht wird; Mengen per Tooltip
- **Zwischenprodukte** („Marinade“, „Teig“), die in einem Schritt entstehen und später wiederverwendet werden
- **Alternativen**: austauschbare Zutatengruppen (z. B. „mit Hähnchen“ / „vegetarisch“), die Zutaten, Schritte und Nährwerte anpassen
- **Varianten**: abgewandelte Fassungen eines Rezepts, die mit dem Original verbunden bleiben
- **Portionen skalieren** in der Rezeptansicht, Mengen werden umgerechnet
- **Live-Nährwerte & Preis pro Portion** aus Zutaten-Katalog und Produkten; pro Zutat wählbares Produkt, Supermarkt-Auswahl, „Als Meal Prep planen“
- Mehrere Bilder pro Rezept mit Galerie und Vollbild-Lightbox
- **Favoriten**, Suche (auch nach Tags mit `tag:`), Gruppierung nach Kategorie (Gruppen/Tabs), Kachel- und Listenansicht, Zufallsrezept
- **Entwürfe mit Auto-Save** beim Bearbeiten; Hinweis auf nicht gespeicherte Entwürfe
- Export als JSON oder `.rcb` (mit eingebetteten Bildern), Markdown-Export, Mehrfachauswahl für Export und Einkaufsliste
- Datenspar-Modus: Bilder und Einbettungen erst auf Wunsch laden

### Rezept-Import

- **Von Websites**: eigene Extraktoren für Chefkoch, Lecker und Gaumenfreundin, generisch für alle Seiten mit JSON-LD-Rezeptdaten
- **Aus Text/JSON** und aus Dateien (`.json`, `.rcb`)
- **Instagram-Reels**: der Server lädt das Reel, transkribiert den gesprochenen Text lokal (Whisper), wertet Standbilder aus (Texterkennung oder KI-Bildanalyse, einstellbar) und lässt die KI daraus ein vollständiges Rezept bauen — mit Vorschaubild und Quelle
- **Teilen → Kochbuch**: Links aus dem Browser oder der Instagram-App direkt an die Website (Web Share Target) bzw. die Android-App teilen
- **Automatische Aufbereitung** importierter und KI-erstellter Rezepte:
  - Zutatennamen werden auf vorhandene Zutaten des Katalogs abgebildet (Einzahl/Mehrzahl, „gehackte Petersilie“ → Petersilie + Zusatz „gehackte“; produktändernde Zusätze wie „saure Sahne“ bleiben)
  - „Salz und Pfeffer (aus der Mühle)“ wird in einzelne Zutaten aufgeteilt
  - Zutaten werden den Zubereitungsschritten zugeordnet (auch bei Mehrzahl, Umlauten und zusammengesetzten Wörtern wie „Knoblauch“ → Knoblauchzehen)

### KI-Assistent

- **Rezept-Chat** zu einem Rezept oder zur ganzen Sammlung: Fragen stellen, Rezepte vergleichen, Vorschläge für die Einkaufsliste
- **Varianten und Änderungen per KI**: die KI schlägt eine Variante oder Änderungen vor, die im Editor markiert zur Prüfung geöffnet werden
- Mehrere Chat-Tabs pro Rezept, Verlauf bleibt erhalten, Markdown-Antworten, „Neu generieren“
- **Anbieter**: Ollama (lokal) oder OpenRouter (Cloud, eigener API-Key oder Server-Key)
- **Modelle für Aufgaben**: neben dem Chat-Modell eigene Modelle für *Rezepte strukturieren*, *Bilder lesen* (Reels, Kassenbons) und *Zuordnen* (Produkte ↔ Zutaten, Bon-Posten ↔ Produkte) — z. B. Sonnet für den Chat, Gemini Flash für Belege
- **Modellauswahl** mit Suche, Favoriten, Preisen und Empfehlungen je Aufgabe (auf Basis der Fähigkeiten und des Qualitätsindex aus der OpenRouter-Modellliste)
- Der OpenRouter-Key bleibt auf dem Gerät und wird nicht synchronisiert

### Kochmodus & Timer

- **Kochmodus**: Vollbild, ein Schritt pro Seite, Wischen und Tastatur, Zutatenübersicht vorab, Temperaturen erkannt, Bildschirm bleibt an (Wake Lock)
- **Klickbare Zeitangaben** in Schritten starten Timer
- **Mehrere Timer gleichzeitig** mit Pause, ±1 Minute und Alarm; auf der Website optional geräteübergreifend synchronisiert
- In der App laufen Timer **im Hintergrund** weiter (siehe [Android-App](#android-app))

### Einkaufslisten

- Mehrere Listen, Rezepte mit wählbaren Portionen und Alternativen hinzufügen, Artikel manuell ergänzen
- **Automatische Gruppierung** gleicher Zutaten, manuelle Gruppen, Zusammenführ-Vorschläge
- Rezept-Zuordnung: sehen, welche Artikel zu welchem Rezept gehören, Rezept hervorheben
- **Sammelliste und Vorlagen** (dauerhafte Listen), deren Inhalt in eine Liste übernommen werden kann
- Notizen zu Artikeln (auch mit Bildern), Teilen-Link
- **Preis-Panel** mit Supermarktwahl und geschätzten Kosten
- **Live-Updates**: Änderungen erscheinen sofort auf allen geöffneten Geräten
- **Pingen**: andere Aliasse auf eine Liste hinweisen — wer die App nutzt, bekommt eine Push-Benachrichtigung (optional mit Nachricht), die die Liste öffnet

### Produkte, Supermärkte & Preise

- **Produktregister** mit EAN, Marke, Packungsgröße, Nährwerten, Bild, Gramm pro Einheit und Preisen je Supermarkt
- **Barcode scannen** und **Open Food Facts** durchsuchen (Name oder EAN); Treffer mit Nährwerten übernehmen
- **Mehrere Produkte auf einmal** (`/produkte/import`): nacheinander scannen oder suchen, automatische Zuordnung zu Zutaten (Regeln + KI), prüfen, korrigieren, als Standardprodukt setzen, gesammelt speichern
- **Kassenbons & Rechnungen einlesen** (`/produkte/kassenbon`): Foto(s) oder PDF hochladen
  - KI liest Posten, Mengen, gewogene Ware (€/kg), Rabatte, Pfand; Supermarkt wird am Bonkopf erkannt
  - gekürzte Bon-Texte („GOUDA JG 400G“) werden Produkten zugeordnet: gelernte Kürzel je Supermarkt → unscharfer Abgleich → KI
  - Prüfansicht mit **Preiswechsel-Hinweis** (alt → neu, ±%), gespeichert wird immer der **reguläre** Preis, der bezahlte landet im **Preisverlauf**
  - bestätigte Kürzel werden gemerkt und beim nächsten Bon sofort erkannt; Pfand, Tüten u. Ä. lassen sich dauerhaft ignorieren
  - die Bilder werden nach der Auswertung gelöscht
- Supermärkte anlegen und verwalten

### Zutaten-Katalog & Nährwerte

- Katalog aller Zutaten mit Nährwerten pro 100 g, Dichte und Gramm pro Einheit (Stück, Scheibe, EL …)
- Verknüpfte Produkte und **Standardprodukt** je Zutat (pro Alias anpassbar)
- Zutaten umbenennen und **zusammenführen** — Rezepte und Einkaufslisten werden mitgeändert
- Grundlage für Live-Nährwerte, Preise und den Tracker

### Kalorien- & Nährwerttracker

- **Körperprofil** und Kalorienziel (Grundumsatz, Aktivität, Ziel­gewicht/-tempo) mit Warnschwellen
- **Gewichtsverlauf** mit Diagramm, BMI-Grenzen und Prognose; gelernter Tagesbedarf aus den eigenen Daten
- **Tagebuch**: Mahlzeiten aus Meal-Prep-Plänen, Rezepten, Produkten (Barcode/Suche) oder frei eingetragen; Zusammensetzung einer Mahlzeit nachträglich anpassen (Zutat tauschen, Produkt ergänzen)
- **Meal Prep**: Rezept für mehrere Portionen planen, Portionen nach und nach essen
- **Rezeptvorschläge**, die ins verbleibende Tagesbudget passen
- Alle Tracker-Daten hängen am Alias; in der App offline nutzbar und zwischen Geräten desselben Alias synchronisiert

### Aliasse, Einstellungen & Zugriff

- **Alias**: ein Profilname pro Person. Geräte mit demselben Alias teilen Design (hell/dunkel), Datenspar-Modus, KI-Einstellungen, Rezeptansicht, Favoriten, Produkt-Standards, bevorzugten Supermarkt und das Tracker-Profil
- Beim **Alias-Wechsel** gelten die Einstellungen des neuen Alias; persönliche Daten werden nicht übertragen
- **Zugangs-Token pro Alias**: Lesen ist ohne Token möglich, Speichern nur mit gültigem Token. Ob der Token zum Alias passt, wird im Alias-Dialog angezeigt
- **Alias-Verwaltung** (`/admin/aliasse`, geschützt durch `ADMIN_TOKEN`): Aliasse anlegen, Tokens neu erzeugen (einmalig angezeigt), Aliasse löschen — optional mit allen Daten
- Tokens werden nur als Hash gespeichert

### Android-App

Die App hat dieselben Seiten und Funktionen wie die Website und dazu:

- **Offline-first**: alle Rezepte, Listen, Produkte, Zutaten und Tracker-Daten liegen lokal; Änderungen werden gesammelt und hochgeladen, sobald der Server erreichbar ist
- **Synchronisation** mit dem Server: automatisch beim Start, bei Rückkehr in den Vordergrund, alle 60 s und live bei Änderungen anderer; gleichzeitige Änderungen an einer Einkaufsliste werden pro Artikel zusammengeführt; Anzeige des Sync-Status
- **Private Rezepte**: bleiben nur auf dem Gerät
- **Timer im Hintergrund**: laufen weiter, wenn die App minimiert oder geschlossen ist; Benachrichtigung mit Countdown, Alarm mit Weckerton am Ende, Wiederherstellung nach Neustart
- **Push-Benachrichtigungen** für Pings auf Einkaufslisten (Firebase); Status und „Neu registrieren“ in den Einstellungen
- **Barcode-Scanner** mit Kamera (nur vollständig erkannte Codes mit gültiger Prüfziffer), auch im Dauer-Modus für den Mehrfach-Scan
- **Open-Food-Facts-Suche direkt vom Handy** — funktioniert auch unterwegs ohne den Server
- **Teilen → Kochbuch**: Rezept-Links und Instagram-Reels aus anderen Apps importieren
- **Automatische Updates**: neue Versionen erscheinen als GitHub-Release; die App meldet sie beim Start und installiert sie auf Wunsch
- Eigenes App-Icon, Startbildschirm und Statusleisten-Symbol

Download: die neueste `kochbuch-<version>.apk` unter [Releases](https://github.com/SuitIThub/CookBook/releases). In der App unter **Einstellungen → Server-Adresse** den Server eintragen und im Alias-Dialog Alias und Token setzen.

---

## Entwicklung

### Architektur

```
┌───────────────────────────┐        ┌───────────────────────────────┐
│  Website (Astro, SSR)     │        │  Android-App (React + Vite,   │
│  src/pages/*.astro        │        │  Capacitor) app/              │
│  REST-API src/pages/api/  │◄──────►│  lokale Replica: sql.js +     │
│  SQLite (better-sqlite3)  │  Sync  │  IndexedDB                    │
└────────────┬──────────────┘  HTTP  └───────────────┬───────────────┘
             │                                       │
             └──────── gemeinsamer Kern src/lib ─────┘
                (CookbookDatabase, Sync-Merge, Nährwerte,
                 Tracker-Logik, Import-Aufbereitung …)
```

- **Gemeinsamer Kern**: `src/lib/database.ts` (`CookbookDatabase`) ist treiber-unabhängig (`SqlDriver`). Der Server nutzt better-sqlite3 (`database.server.ts`), die App sql.js. Die App importiert den Kern über die Aliase `@core` (`src/lib`) und `@shared` (`src/types`).
- **Server-only-Module** heißen `*.server.ts` (Token-Prüfung, Push, Admin, Reel- und Kassenbon-Pipeline …) und landen nie im App-Bundle.
- **Sync**: Trigger schreiben jede Änderung in `sync_changes` (fortlaufende `seq`) und Löschungen in `sync_tombstones`. Die App holt Änderungen über `/api/sync/pull` (Cursor pro Typ) und schickt ihre über `/api/sync/push` — Last-Write-Wins inklusive Löschungen, Einkaufslisten als Drei-Wege-Merge pro Artikel (`src/lib/syncMerge.ts`), Tracker-Daten nur für den eigenen Alias. `/api/sync/stream` meldet neue Änderungen per SSE.
- **Auth**: `src/middleware.ts` verlangt für schreibende Anfragen `X-Alias` + `X-Auth-Token` (Ausnahme: `/api/admin/*` mit `X-Admin-Token`).
- **KI**: `src/lib/ai.ts` (Ollama/OpenRouter, Chat, strukturierte JSON-Antworten, Bildanalyse), `src/lib/aiTasks.ts` (Modelle je Aufgabe), `src/lib/aiModelCatalog.ts` (Modellliste mit Empfehlungen).

### Projektstruktur

```
CookBook/
├── src/                      # Website + gemeinsamer Kern
│   ├── pages/                # Astro-Seiten (rezepte, rezept/[id], einkaufsliste/[id], produkte, zutaten, tracker, admin …)
│   │   └── api/              # REST-API (recipes, shopping-lists, products, receipts, ai, sync, tracker, push, admin …)
│   ├── components/           # Astro-Komponenten
│   ├── layouts/              # Layout mit Header, Fetch-Wrapper (Auth-Header), Modals
│   ├── lib/                  # gemeinsamer Kern + *.server.ts (nur Server)
│   │   └── recipe-extractors/  # Website-Extraktoren (Chefkoch, Lecker, Gaumenfreundin, JSON-LD)
│   ├── types/                # gemeinsame Typen
│   └── middleware.ts         # CORS + Schreibschutz per Token
├── app/                      # Android-App
│   ├── src/                  # React-Seiten, Komponenten, lib (Sync, lokale DB, API, Push, Updates …)
│   ├── android/              # Capacitor-Android-Projekt inkl. eigener Plugins (Timer, Updates, Teilen)
│   └── vite.config.ts        # Aliase @core/@shared, Dev-Proxy, Version/FCM-Flags
├── scripts/                  # DB-Init/-Migration, Token, Whisper-Transkription, Server-Setup
├── public/                   # Icons, Manifest, Service Worker, Uploads
└── .github/workflows/        # App-Release-Pipeline
```

### Voraussetzungen

- **Node.js 20 oder 22** (LTS) — `better-sqlite3` liefert vorgebaute Binaries nur für LTS-Versionen
- Für die App zusätzlich: **JDK 17** und das **Android SDK** (z. B. über Android Studio)
- Optional für Reel- und Kassenbon-Import auf dem Server: `ffmpeg`, `tesseract`, `poppler-utils`, Python 3 (siehe [Server-Betrieb](#server-betrieb))

### Website lokal starten

```bash
npm install
cp .env.example .env        # Werte eintragen, siehe unten
npm run db:init             # Datenbank cookbook.db anlegen
npm run auth:gen-token -- <alias>   # Token zum Speichern erzeugen (einmal angezeigt)
npm run dev                 # http://localhost:4321
```

Im Browser im Alias-Dialog Alias und Token eintragen — ohne Token ist alles nur lesbar.

### Umgebungsvariablen

| Variable | Wofür |
|---|---|
| `PUBLIC_SITE_URL` | Öffentliche URL (Links in API-Antworten, Referer für OpenRouter) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Ollama-Server und Standardmodell |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Server-Key (ohne eigenen Key nur kostenlose Modelle) und Standardmodell |
| `ADMIN_TOKEN` | Zugang zur Alias-Verwaltung `/admin/aliasse`; ohne ihn ist sie abgeschaltet |
| `FIREBASE_SERVICE_ACCOUNT` (oder `FIREBASE_SERVICE_ACCOUNT_JSON`) | Pfad zum Firebase-Dienstkonto-Schlüssel für Push-Pings |
| `REEL_PYTHON` | Python der venv mit `yt-dlp` und `faster-whisper` (Reel-Import) |
| `WHISPER_MODEL` | Whisper-Modell für die Transkription (Standard `small`) |
| `INSTAGRAM_COOKIES` | optional: cookies.txt, falls Instagram anonyme Abrufe blockiert |
| `REEL_VISION_MODEL_OPENROUTER`, `REEL_VISION_MODEL_OLLAMA` | Standard-Bildmodelle |
| `YTDLP_BIN`, `FFMPEG_BIN`, `TESSERACT_BIN`, `PDFTOTEXT_BIN`, `PDFTOPPM_BIN` | optional: abweichende Pfade der Werkzeuge |

> Hinweis: Variablen, die über `import.meta.env` gelesen werden (z. B. `OLLAMA_*`, `OPENROUTER_*`, `PUBLIC_*`), werden beim `npm run build` eingebettet. Nach Änderungen neu bauen.

### Befehle

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Entwicklungsserver (Port 4321, im LAN erreichbar) |
| `npm run build` / `npm run start` | Production-Build bzw. Server starten |
| `npm test` | Unit-Tests (Sync-Merge, Nährwerte, Import-Aufbereitung, Kassenbon-Abgleich, Alias-Secrets, API-Smoke-Test …) |
| `npm run db:init` / `npm run db:migrate` | Datenbank anlegen / migrieren |
| `npm run auth:gen-token -- <alias>` | Token für einen Alias erzeugen oder erneuern |
| `npm run db:unify-units`, `npm run db:extract-urls` | Wartung: Einheiten vereinheitlichen, Quell-URLs nachtragen |

### App entwickeln

```bash
cd app
npm install
npm run dev          # Vite im Browser; /api wird an ASTRO_DEV_URL (Standard http://localhost:4321) weitergeleitet
npx tsc --noEmit     # Typprüfung
```

Für Android:

```bash
cd app
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

- Die App spricht den Server über das native HTTP von Capacitor an (kein CORS, auch reines `http://` im LAN). Die Server-Adresse wird in der App unter *Einstellungen* gesetzt.
- Eigene Capacitor-Plugins liegen unter `app/android/app/src/main/java/de/kochbuch/app/`: `CookTimersPlugin` (Hintergrund-Timer), `AppUpdatePlugin` (Update-Installation), `ShareTargetPlugin` (Teilen-Ziel).
- Push braucht `app/android/app/google-services.json` (Firebase-Client-Konfiguration, im Repo). Ohne die Datei wird Push in der App automatisch deaktiviert.
- Release-Signatur: entweder `app/android/keystore.properties` (nicht im Repo) oder die Umgebungsvariablen `KOCHBUCH_KEYSTORE_FILE`, `KOCHBUCH_KEYSTORE_PASSWORD`, `KOCHBUCH_KEY_ALIAS`, `KOCHBUCH_KEY_PASSWORD` für `./gradlew assembleRelease`.

### App-Releases

Die Version steht nur in `app/package.json` (daraus werden `versionName`/`versionCode` und die Versionsanzeige in der App abgeleitet).

1. Version in `app/package.json` erhöhen
2. nach `main` pushen

Der Workflow `.github/workflows/app-release.yml` prüft, ob es schon eine Release `app-v<version>` gibt; wenn nicht, baut er die App, signiert die APK und veröffentlicht sie als GitHub-Release. Die installierten Apps melden das Update beim nächsten Start.

Benötigte Repository-Secrets: `KOCHBUCH_KEYSTORE_BASE64`, `KOCHBUCH_KEYSTORE_PASSWORD`, `KOCHBUCH_KEY_ALIAS`, `KOCHBUCH_KEY_PASSWORD`. Alle Releases müssen mit demselben Schlüssel signiert sein, sonst lässt Android kein Update über die installierte App zu.

### Server-Betrieb

- Build und Start: `npm run build` und `npm run start` (z. B. als systemd-Dienst); Umgebungsvariablen in der Unit oder einer `EnvironmentFile` setzen.
- Neue Tabellen (Sync, Tokens, Push-Geräte, Kassenbon-Kürzel, Preisverlauf) legt der Server beim Start selbst an.
- **Reel- und Kassenbon-Import** einmalig einrichten (Debian/Ubuntu):
  ```bash
  bash scripts/setup-reel-import.sh
  ```
  installiert `ffmpeg`, `tesseract`, `poppler-utils`, eine Python-venv mit `yt-dlp` und `faster-whisper`, lädt das Whisper-Modell und gibt die Zeilen für die systemd-Unit aus (`REEL_PYTHON`). `yt-dlp` gelegentlich aktualisieren.
- **Push-Pings**: Firebase-Projekt anlegen, Dienstkonto-Schlüssel auf den Server legen (nicht ins Repo) und `FIREBASE_SERVICE_ACCOUNT` setzen.
- **Alias-Verwaltung**: `ADMIN_TOKEN` setzen (z. B. `openssl rand -base64 24`).
- Für Zugriffe aus dem Internet den Server nur über HTTPS erreichbar machen (Reverse Proxy oder Tunnel), da Tokens in Headern übertragen werden.

### Tests

- `npm test` — Unit-Tests der Kernlogik
- Die App ist zusätzlich mit Playwright-Ende-zu-Ende-Tests gegen eine isolierte Datenbankkopie geprüft worden (Sync zwischen zwei Geräten, Tracker offline, Kassenbon-Import …); Kamera, Push und Hintergrund-Timer lassen sich nur auf einem echten Gerät testen.

### Weitere Dokumentation

- [API-Dokumentation](API_DOCUMENTATION.md)
- [Rezept-JSON-Format](RECIPE_JSON_FORMAT.md)
- [Android-Timer-Integration](ANDROID_TIMER_INTEGRATION.md)
- [App-Plan](APP_PLAN.md) und [Funktionsabgleich App ↔ Website](APP_PARITY.md)
- [Pflichtenheft](Pflichtenheft_KochbuchApp.md)

### Lizenz & Kontakt

MIT-Lizenz · Fragen und Fehler: [GitHub Issues](https://github.com/SuitIThub/CookBook/issues) · [suit.it.pub@gmail.com](mailto:suit.it.pub@gmail.com)
