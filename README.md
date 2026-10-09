# Kochbuch

[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)

A self-hosted digital cookbook for the household: collect, import and cook recipes, share shopping lists, manage products and prices, and track calories — as a **website** and as an **Android app** that also works offline and syncs with the server.

- **Website** (Astro + SQLite): runs on your own server, usable in any browser, installable as a PWA.
- **Android app** (React + Capacitor): mirrors the website, works on a local copy of the data (offline) and syncs it with the server — so you can share recipes and shopping lists with your roommates. On top come app-only extras such as background timers, push notifications and automatic updates.

The user interface is in German; UI labels below are quoted in German.

---

## Contents

- [Features](#features)
  - [Recipes](#recipes)
  - [Recipe import](#recipe-import)
  - [AI assistant](#ai-assistant)
  - [Cooking mode & timers](#cooking-mode--timers)
  - [Shopping lists](#shopping-lists)
  - [Products, supermarkets & prices](#products-supermarkets--prices)
  - [Ingredient catalogue & nutrition](#ingredient-catalogue--nutrition)
  - [Calorie & nutrition tracker](#calorie--nutrition-tracker)
  - [Aliases, settings & access](#aliases-settings--access)
  - [Android app](#android-app)
- [Development](#development)

---

## Features

### Recipes

- Recipes with subtitle, description, category, tags, servings, difficulty and any number of time entries (prep, cooking, baking, resting …)
- **Nested ingredient and preparation groups** (e.g. "dough", "filling") with several quantities per ingredient and unit conversion
- **Ingredients linked to preparation steps**: coloured markers show which ingredient is used in which step; amounts in a tooltip
- **Intermediate products** ("marinade", "dough") that are created in one step and reused later
- **Alternatives**: interchangeable ingredient groups (e.g. "with chicken" / "vegetarian") that adapt ingredients, steps and nutrition
- **Variants**: modified versions of a recipe that stay linked to the original
- **Scale servings** in the recipe view; amounts are recalculated
- **Live nutrition & price per serving** from the ingredient catalogue and products; choose a product per ingredient, pick a supermarket, "Als Meal Prep planen" (plan as meal prep)
- Several images per recipe with gallery and full-screen lightbox
- **Favourites**, search (also by tag with `tag:`), grouping by category (sections/tabs), grid and list view, random recipe
- **Drafts with auto-save** while editing; notice about unsaved drafts
- Export as JSON or `.rcb` (with embedded images), Markdown export, multi-select for export and shopping list
- Data-saver mode: images and embeds are only loaded on demand

### Recipe import

- **From websites**: dedicated extractors for Chefkoch, Lecker and Gaumenfreundin, generic support for every site with JSON-LD recipe data
- **From text/JSON** and from files (`.json`, `.rcb`)
- **Instagram reels**: the server downloads the reel, transcribes the spoken text locally (Whisper), analyses still frames (OCR or AI image analysis, configurable) and has the AI build a complete recipe from it — including thumbnail and source
- **Share → Kochbuch**: share links from the browser or the Instagram app directly to the website (Web Share Target) or the Android app
- **Automatic clean-up** of imported and AI-generated recipes:
  - ingredient names are mapped onto existing catalogue ingredients (singular/plural, "gehackte Petersilie" → Petersilie with note "gehackte"; qualifiers that change the product, such as "saure Sahne", are kept)
  - "Salz und Pfeffer (aus der Mühle)" is split into separate ingredients
  - ingredients are linked to the preparation steps (tolerant of plurals, umlauts and compound words such as "Knoblauch" → Knoblauchzehen)

### AI assistant

- **Recipe chat** about a recipe or the whole collection: ask questions, compare recipes, get shopping-list suggestions
- **Variants and edits by AI**: the AI proposes a variant or changes, which open highlighted in the editor for review
- Several chat tabs per recipe, persistent history, Markdown answers, "Neu generieren" (regenerate)
- **Providers**: Ollama (local) or OpenRouter (cloud, own API key or the server's key)
- **Models per task**: besides the chat model, separate models for *structuring recipes*, *reading images* (reels, receipts) and *matching* (products ↔ ingredients, receipt lines ↔ products) — e.g. Sonnet for chat, Gemini Flash for receipts
- **Model picker** with search, favourites, prices and per-task recommendations (based on capabilities and the quality index in OpenRouter's model list)
- The OpenRouter key stays on the device and is never synced

### Cooking mode & timers

- **Cooking mode**: full screen, one step per page, swipe and keyboard navigation, ingredient overview first, temperatures detected, screen stays on (Wake Lock)
- **Clickable time references** in steps start timers
- **Multiple timers at once** with pause, ±1 minute and alarm; on the website optionally synced across devices
- In the app, timers keep running **in the background** (see [Android app](#android-app))

### Shopping lists

- Multiple lists; add recipes with chosen servings and alternatives, add items manually
- **Automatic grouping** of identical ingredients, manual groups, merge suggestions
- Recipe tracking: see which items belong to which recipe, highlight a recipe
- **Collection list and templates** (permanent lists) whose content can be transferred into a list
- Notes on items (including images), share link
- **Price panel** with supermarket selection and estimated cost
- **Live updates**: changes appear immediately on every open device
- **Ping** ("Pingen"): notify other aliases about a list — app users get a push notification (optionally with a message) that opens the list

### Products, supermarkets & prices

- **Product register** with EAN, brand, pack size, nutrition, image, grams per unit and prices per supermarket
- **Barcode scanning** and **Open Food Facts** search (name or EAN); take over results including nutrition
- **Several products at once** (`/produkte/import`, "Mehrere hinzufügen"): scan or search one after another, automatic matching to ingredients (rules + AI), review and correct, set as default product, save in one go
- **Read receipts & invoices** (`/produkte/kassenbon`, "Kassenbon einlesen"): upload photo(s) or a PDF
  - the AI reads items, quantities, goods sold by weight (€/kg), discounts and deposits; the supermarket is detected from the receipt header
  - abbreviated receipt texts ("GOUDA JG 400G") are matched to products: learned abbreviations per supermarket → fuzzy matching → AI
  - review screen with **price-change hints** (old → new, ±%); the **regular** price is always stored, the price actually paid goes into the **price history**
  - confirmed abbreviations are remembered and recognised instantly on the next receipt; deposits, bags etc. can be ignored permanently
  - images are deleted after the analysis
- Create and manage supermarkets

### Ingredient catalogue & nutrition

- Catalogue of all ingredients with nutrition per 100 g, density and grams per unit (piece, slice, tablespoon …)
- Linked products and a **default product** per ingredient (customisable per alias)
- Rename and **merge** ingredients — recipes and shopping lists are updated accordingly
- Basis for live nutrition, prices and the tracker

### Calorie & nutrition tracker

- **Body profile** and calorie goal (basal metabolic rate, activity, target weight/pace) with warning thresholds
- **Weight history** with chart, BMI bands and forecast; learned daily energy need from your own data
- **Diary**: meals from meal-prep plans, recipes, products (barcode/search) or free entries; adjust a meal's composition afterwards (swap an ingredient, add a product)
- **Meal prep**: plan a recipe for several servings and eat them over time
- **Recipe suggestions** that fit the remaining daily budget
- All tracker data belongs to the alias; in the app it works offline and syncs between devices of the same alias

### Aliases, settings & access

- **Alias**: one profile name per person. Devices with the same alias share theme (light/dark), data-saver mode, AI settings, recipe view, favourites, product defaults, preferred supermarket and the tracker profile
- When **switching aliases**, the new alias's settings apply; personal data is not carried over
- **Access token per alias**: reading works without a token, saving requires a valid one. The alias dialog shows whether the token matches the alias
- **Alias administration** (`/admin/aliasse`, protected by `ADMIN_TOKEN`): create aliases, regenerate tokens (shown once), delete aliases — optionally with all their data
- Tokens are stored only as hashes

### Android app

The app has the same pages and features as the website, plus:

- **Offline-first**: all recipes, lists, products, ingredients and tracker data are stored locally; changes are queued and uploaded as soon as the server is reachable
- **Sync** with the server: automatically on start, when returning to the foreground, every 60 s and live when others change something; concurrent edits to a shopping list are merged per item; sync status indicator
- **Private recipes**: stay on the device only
- **Background timers**: keep running when the app is minimised or closed; notification with a live countdown, alarm sound when done, restored after a reboot
- **Push notifications** for shopping-list pings (Firebase); status and "Neu registrieren" (re-register) in the settings
- **Barcode scanner** using the camera (only fully read codes with a valid check digit), also in continuous mode for batch scanning
- **Open Food Facts search directly from the phone** — works on the go without the server
- **Share → Kochbuch**: import recipe links and Instagram reels from other apps
- **Automatic updates**: new versions are published as GitHub releases; the app announces them on start and installs them on request
- Custom app icon, splash screen and status-bar icon

Download: the latest `kochbuch-<version>.apk` from [Releases](https://github.com/SuitIThub/CookBook/releases). In the app, enter your server under **Einstellungen → Server-Adresse** (settings → server address) and set alias and token in the alias dialog.

---

## Development

### Architecture

```
┌───────────────────────────┐        ┌───────────────────────────────┐
│  Website (Astro, SSR)     │        │  Android app (React + Vite,   │
│  src/pages/*.astro        │        │  Capacitor) app/              │
│  REST API src/pages/api/  │◄──────►│  local replica: sql.js +      │
│  SQLite (better-sqlite3)  │  sync  │  IndexedDB                    │
└────────────┬──────────────┘  HTTP  └───────────────┬───────────────┘
             │                                       │
             └────────── shared core src/lib ────────┘
               (CookbookDatabase, sync merge, nutrition,
                tracker logic, import clean-up …)
```

- **Shared core**: `src/lib/database.ts` (`CookbookDatabase`) is driver-agnostic (`SqlDriver`). The server uses better-sqlite3 (`database.server.ts`), the app uses sql.js. The app imports the core through the aliases `@core` (`src/lib`) and `@shared` (`src/types`).
- **Server-only modules** are named `*.server.ts` (token checks, push, admin, reel and receipt pipelines …) and never end up in the app bundle.
- **Sync**: triggers record every change in `sync_changes` (monotonic `seq`) and deletions in `sync_tombstones`. The app pulls changes via `/api/sync/pull` (one cursor per type) and pushes its own via `/api/sync/push` — last-write-wins including deletes, shopping lists as a per-item three-way merge (`src/lib/syncMerge.ts`), tracker data only for the caller's alias. `/api/sync/stream` announces new changes via SSE.
- **Auth**: `src/middleware.ts` requires `X-Alias` + `X-Auth-Token` for writing requests (exception: `/api/admin/*` with `X-Admin-Token`).
- **AI**: `src/lib/ai.ts` (Ollama/OpenRouter, chat, structured JSON answers, image analysis), `src/lib/aiTasks.ts` (models per task), `src/lib/aiModelCatalog.ts` (model list with recommendations).

### Project structure

```
CookBook/
├── src/                      # website + shared core
│   ├── pages/                # Astro pages (rezepte, rezept/[id], einkaufsliste/[id], produkte, zutaten, tracker, admin …)
│   │   └── api/              # REST API (recipes, shopping-lists, products, receipts, ai, sync, tracker, push, admin …)
│   ├── components/           # Astro components
│   ├── layouts/              # layout with header, fetch wrapper (auth headers), modals
│   ├── lib/                  # shared core + *.server.ts (server only)
│   │   └── recipe-extractors/  # website extractors (Chefkoch, Lecker, Gaumenfreundin, JSON-LD)
│   ├── types/                # shared types
│   └── middleware.ts         # CORS + write protection via tokens
├── app/                      # Android app
│   ├── src/                  # React pages, components, lib (sync, local DB, API, push, updates …)
│   ├── android/              # Capacitor Android project incl. custom plugins (timers, updates, sharing)
│   └── vite.config.ts        # @core/@shared aliases, dev proxy, version/FCM flags
├── scripts/                  # DB init/migration, tokens, Whisper transcription, server setup
├── public/                   # icons, manifest, service worker, uploads
└── .github/workflows/        # app release pipeline
```

### Requirements

- **Node.js 20 or 22** (LTS) — `better-sqlite3` ships prebuilt binaries only for LTS versions
- For the app additionally: **JDK 17** and the **Android SDK** (e.g. via Android Studio)
- Optional for reel and receipt import on the server: `ffmpeg`, `tesseract`, `poppler-utils`, Python 3 (see [Running the server](#running-the-server))

### Running the website locally

```bash
npm install
cp .env.example .env        # fill in values, see below
npm run db:init             # create the database cookbook.db
npm run auth:gen-token -- <alias>   # create a token for saving (shown once)
npm run dev                 # http://localhost:4321
```

Enter alias and token in the browser's alias dialog — without a token everything is read-only.

### Environment variables

| Variable | Purpose |
|---|---|
| `PUBLIC_SITE_URL` | public URL (links in API responses, referer for OpenRouter) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Ollama server and default model |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | server key (without a user key only free models) and default model |
| `ADMIN_TOKEN` | access to the alias administration `/admin/aliasse`; disabled when unset |
| `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_SERVICE_ACCOUNT_JSON`) | path to the Firebase service-account key for push pings |
| `REEL_PYTHON` | Python of the venv with `yt-dlp` and `faster-whisper` (reel import) |
| `WHISPER_MODEL` | Whisper model for transcription (default `small`) |
| `INSTAGRAM_COOKIES` | optional: cookies.txt if Instagram blocks anonymous requests |
| `REEL_VISION_MODEL_OPENROUTER`, `REEL_VISION_MODEL_OLLAMA` | default image models |
| `YTDLP_BIN`, `FFMPEG_BIN`, `TESSERACT_BIN`, `PDFTOTEXT_BIN`, `PDFTOPPM_BIN` | optional: custom tool paths |

> Note: variables read via `import.meta.env` (e.g. `OLLAMA_*`, `OPENROUTER_*`, `PUBLIC_*`) are embedded at `npm run build`. Rebuild after changing them.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | development server (port 4321, reachable in the LAN) |
| `npm run build` / `npm run start` | production build / start the server |
| `npm test` | unit tests (sync merge, nutrition, import clean-up, receipt matching, alias secrets, API smoke test …) |
| `npm run db:init` / `npm run db:migrate` | create / migrate the database |
| `npm run auth:gen-token -- <alias>` | create or renew the token of an alias |
| `npm run db:unify-units`, `npm run db:extract-urls` | maintenance: unify units, backfill source URLs |

### Developing the app

```bash
cd app
npm install
npm run dev          # Vite in the browser; /api is proxied to ASTRO_DEV_URL (default http://localhost:4321)
npx tsc --noEmit     # type check
```

For Android:

```bash
cd app
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

- The app talks to the server through Capacitor's native HTTP (no CORS, plain `http://` in the LAN works). The server address is set in the app under *Einstellungen*.
- Custom Capacitor plugins live in `app/android/app/src/main/java/de/kochbuch/app/`: `CookTimersPlugin` (background timers), `AppUpdatePlugin` (update installation), `ShareTargetPlugin` (share target).
- Push requires `app/android/app/google-services.json` (Firebase client config, part of the repo). Without the file, push is disabled in the app automatically.
- Release signing: either `app/android/keystore.properties` (not in the repo) or the environment variables `KOCHBUCH_KEYSTORE_FILE`, `KOCHBUCH_KEYSTORE_PASSWORD`, `KOCHBUCH_KEY_ALIAS`, `KOCHBUCH_KEY_PASSWORD` for `./gradlew assembleRelease`.

### App releases

The version lives only in `app/package.json` (`versionName`/`versionCode` and the version shown in the app are derived from it).

1. bump the version in `app/package.json`
2. push to `main`

The workflow `.github/workflows/app-release.yml` checks whether a release `app-v<version>` exists; if not, it builds the app, signs the APK and publishes it as a GitHub release. Installed apps announce the update on their next start.

Required repository secrets: `KOCHBUCH_KEYSTORE_BASE64`, `KOCHBUCH_KEYSTORE_PASSWORD`, `KOCHBUCH_KEY_ALIAS`, `KOCHBUCH_KEY_PASSWORD`. Every release must be signed with the same key, otherwise Android refuses to install the update over the existing app.

### Running the server

- Build and start: `npm run build` and `npm run start` (e.g. as a systemd service); set environment variables in the unit or an `EnvironmentFile`.
- New tables (sync, tokens, push devices, receipt abbreviations, price history) are created by the server on start.
- **Reel and receipt import** — one-time setup (Debian/Ubuntu):
  ```bash
  bash scripts/setup-reel-import.sh
  ```
  installs `ffmpeg`, `tesseract`, `poppler-utils` and a Python venv with `yt-dlp` and `faster-whisper`, downloads the Whisper model and prints the lines for the systemd unit (`REEL_PYTHON`). Update `yt-dlp` from time to time.
- **Push pings**: create a Firebase project, put the service-account key on the server (not in the repo) and set `FIREBASE_SERVICE_ACCOUNT`.
- **Alias administration**: set `ADMIN_TOKEN` (e.g. `openssl rand -base64 24`).
- For access from the internet, only expose the server via HTTPS (reverse proxy or tunnel), since tokens travel in headers.

### Tests

- `npm test` — unit tests of the core logic
- The app has additionally been checked with Playwright end-to-end tests against an isolated database copy (two-device sync, offline tracker, receipt import …); camera, push and background timers can only be tested on a real device.

### Further documentation

- [API documentation](API_DOCUMENTATION.md)
- [Recipe JSON format](RECIPE_JSON_FORMAT.md)
- [Android timer integration](ANDROID_TIMER_INTEGRATION.md)
- [App plan](APP_PLAN.md) and [feature parity app ↔ website](APP_PARITY.md)
- [Requirements specification (German)](Pflichtenheft_KochbuchApp.md)

### License & contact

MIT license · Questions and bugs: [GitHub Issues](https://github.com/SuitIThub/CookBook/issues) · [suit.it.pub@gmail.com](mailto:suit.it.pub@gmail.com)
