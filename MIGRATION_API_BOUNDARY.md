# Migration: harte Frontend/Backend-Grenze (Weg A)

**Branch:** `standalone-project`
**Ziel:** Kein View-Code importiert mehr `db` direkt. Alle Seiten lesen Daten
ausschließlich über die HTTP-API. Base-URL wird konfigurierbar → Voraussetzung
für die spätere Standalone-App (lokal vs. Server).

**Leitprinzip:** *Verhaltens-erhaltend.* Der gerenderte HTML-Output soll gleich
bleiben. Wir tauschen nur die Datenquelle: statt in-process `db.xxx()` ein
`fetch()` gegen die eigene API. SSR bleibt SSR (keine SPA-Umstellung hier — das
wäre Weg C, später).

---

## Migrationsmuster pro Seite

Vorher (SSR-Frontmatter):
```ts
import { db } from '../lib/database';
const recipes = db.getAllRecipes();
```

Nachher:
```ts
import { apiGet } from '../lib/apiClient';
const recipes = await apiGet<Recipe[]>('/api/recipes', Astro);
```

- `apiClient` löst die Base-URL auf: `import.meta.env.PUBLIC_API_BASE_URL`
  falls gesetzt, sonst `Astro.url.origin` (Self-Fetch, gleiches Verhalten).
- Fehlerbehandlung wie bisher (try/catch → leeres Array / Redirect).

---

## Leitplanken (Gate pro Iteration — MUSS grün sein)

1. `npm run build` erfolgreich (astro build zieht TS-Fehler im Modulgraph).
2. `npm test` grün (bestehende Lib-Tests).
3. **Ein Commit pro Seite**, Message-Präfix `refactor(api-boundary):`.
4. Nach jeder Seite: `grep -rl "lib/database" src/pages/*.astro src/pages/**/*.astro`
   muss die migrierte Seite NICHT mehr listen.

**Abschluss-Invariante (Definition of Done):**
`grep -rl "lib/database" src/pages --include=*.astro` liefert **nichts** mehr.

---

## Vorarbeit (vor den Seiten)

- [ ] **T0a — API-Client-Helper** `src/lib/apiClient.ts`
  - `apiGet<T>(path, astro?)` — resolves base URL, `fetch`, JSON, wirft bei !ok.
  - Server-Kontext: nutzt `Astro.url.origin`. Env-Override `PUBLIC_API_BASE_URL`.
- [ ] **T0b — API-Lücke: Global-Template-Einkaufsliste**
  - `GET /api/shopping-lists?action=global-template` → `db.getGlobalTemplateShoppingList()`
  - (erweitert den bestehenden GET-Handler in `src/pages/api/shopping-lists.ts`)
- [ ] **T0c — API-Lücke: Rezept-Varianten**
  - `GET /api/recipes?id=<id>&action=variants` → `db.getVariantsForRecipe(id)`
  - (erweitert den bestehenden GET-Handler in `src/pages/api/recipes.ts`)
- [ ] **T0d — Smoke-Tests** für die zwei neuen + die genutzten GET-Routen
  (dünn: Status 200 + Shape), damit das Gate mehr prüft als „kompiliert“.

---

## Die 6 Seiten (Checkliste)

Legende Route-Status: ✅ existiert · ➕ in T0b/T0c ergänzt

- [ ] **S1 — `src/pages/rezepte.astro`**
  - `getAllRecipes()` → ✅ `GET /api/recipes`
- [ ] **S2 — `src/pages/produkte.astro`**
  - `getAllProducts()` → ✅ `GET /api/products`
  - `getAllSupermarkets()` → ✅ `GET /api/supermarkets`
- [ ] **S3 — `src/pages/einkaufslisten.astro`**
  - `getAllShoppingLists()` → ✅ `GET /api/shopping-lists`
- [ ] **S4 — `src/pages/zutaten.astro`**
  - `getAllIngredientsFromRecipes()` → ✅ `GET /api/ingredients`
- [ ] **S5 — `src/pages/einkaufsliste/[id].astro`**
  - `getShoppingList(id)` → ✅ `GET /api/shopping-lists?id=<id>`
  - `getPermanentShoppingList()` → ✅ `GET /api/shopping-lists/permanent`
  - `getGlobalTemplateShoppingList()` → ➕ `GET /api/shopping-lists?action=global-template`
- [ ] **S6 — `src/pages/rezept/[id].astro`**
  - `getRecipe(id)` → ✅ `GET /api/recipes?id=<id>`
  - `getVariantsForRecipe(id)` → ➕ `GET /api/recipes?id=<id>&action=variants`
  - `getDraft(recipeId)` → ✅ `GET /api/drafts?recipeId=<id>`

**Nur 2 echte API-Lücken** (Global-Template, Varianten). Alles andere ist schon
als GET vorhanden — deshalb ist die Migration überschaubar und low-risk.

---

## Reihenfolge für den Loop

`T0a → T0b → T0c → T0d → S1 → S2 → S3 → S4 → S5 → S6`

Jede Iteration: Änderung → Gate (build+test) → Commit. Bei rotem Gate:
selbst-korrigieren, nicht weitergehen.

## Bewusst NICHT in diesem Schritt
- Split des `CookbookDatabase`-Monolithen (287 Methoden) — separat, später.
- SPA/Client-Rendering (Weg C).
- Sync-Engine, Offline-Store, Tombstones — kommt nach der Grenze.

---

## Zielarchitektur der Standalone-App (Entscheidung, für den späteren Subbranch)

Diese API-Grenze ist der Grundstein dafür. Endziel:

- **React + Vite + Capacitor** — ein React/Web-Codebase, als APK verpackt
  (WebView). Reuse der Web/React-Kenntnisse, kein React-Native-Paradigmenwechsel,
  guter Plugin-Support (SQLite, Filesystem).
- **On-device-Daten: SQLite** (`@capacitor-community/sqlite`), spiegelt das
  Server-Schema — Server ist ebenfalls SQLite, also konzeptionell 1:1.
- **Sync: server-autoritativ, pull/push gegen die bestehende REST-API.**
  Neue Endpoints `GET /api/sync/changes?since=<cursor>` (pull) +
  `POST /api/sync/changes` (push). Änderungs-Tracking über `updated_at` +
  **Tombstones** für Deletes. Konflikt: Last-Write-Wins pro Record.
  Offline-Schreibvorgänge in lokaler **Outbox-Queue**.
- **Per-Entity-Opt-out** (private Rezepte / Tracking nicht syncen): Flags
  client-seitig, steuern welche Tabellen in pull/push einbezogen werden.
- **Phasen:** (1) *Thin Replica* — Cache + einfache Offline-Writes, deckt
  „Einkaufsliste offline" sofort ab. (2) inkrementell *Full Standalone* —
  lokale Business-Logik gegen On-device-SQLite. Full-Parity offline ist groß
  (Data-Layer on-device nachbauen), daher bewusst phasenweise.
- **Reuse:** die *reine* Logik in `src/lib` (nutrition, units, alternatives,
  calorieGoal, recipeNutrition) ist framework-agnostisches TS → in der React-App
  direkt wiederverwendbar. Die SQL in `database.ts` nicht (anderes SQLite-Binding).

**Konsequenz für die aktuelle Migration:** unverändert — sie validiert genau die
API-Oberfläche, die die React-App konsumieren wird. Deshalb doppelt gerechtfertigt.
