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

## Bewusst später
- Lokale SQLite / Sync / Tombstones (Phase 2).
- Weitere Features (Einkaufsliste, Tracker, Produkte) nach bewiesenem Stack.
- Shared-Types als eigenes Package (erst wenn Drift real wird).
