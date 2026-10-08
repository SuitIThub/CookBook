# App-Feature-Parität — Fundament-zuerst

**Ziel:** Die Standalone-App bekommt den **vollen** Funktionsumfang der Website
(nicht nur Rezepte-Durchblättern), plus die bereits gebaute Sync/Auth/Offline-
Schicht. Reihenfolge folgt dem Datenmodell (unten drauf zuerst), damit nichts
retrofittet werden muss.

## Datenmodell-Schichtung
```
Supermärkte → Produkte → Zutaten-Katalog → Rezepte → Einkaufslisten → Tracker
```
Rezept-**Bearbeiten** (Autocomplete, Produkt-Verknüpfung) und **Live-Nährwerte/
Preis** hängen an Zutaten+Produkten → deshalb Fundament zuerst.

## Build-Reihenfolge (bestätigt: Fundament zuerst, voller Umfang, KI inkl.)

### F1 — Produkte + Supermärkte (`/produkte`)
- Sync: `products`, `supermarkets` (+ Preise `product_supermarkets` als Folge-
  schritt) in die Sync-Registry (upsert/delete-for-sync + pull/push + local reads).
- Page: Register (Liste/Suche), Produkt anlegen/bearbeiten/löschen (ProductModal),
  Supermärkte verwalten, EAN/Nährwerte/Preise, **Barcode-Scan → Open Food Facts**.

### F2 — Zutaten-Katalog (`/zutaten`)
- Sync: `ingredients` (Katalog-Nährwerte, `ingredient_products`-Verknüpfung).
- Page: Zutatenliste, Nährwerte pflegen, Produkt-Verknüpfung, Zusammenführen.

### F3 — Rezepte voll (`/rezepte`, `/rezept/[id]`)
- Volle Ansicht (Metadaten, Tags, gruppierte Zutaten/Schritte, statische +
  **Live-Nährwerte/Preis**, Bilder, Portionsskalierung).
- **Bearbeiten + Anlegen** (Zutaten-/Zubereitungs-Editor, Alternativen,
  Produkt-Verknüpfung, Vorschläge, Tags).
- Kochmodus (Timer), Varianten, Import (URL/Text/JSON-LD), Bilder, Notizen,
  Export/Markdown, **KI** (Chat/Vorschläge/Diff — Ollama/OpenRouter).

### F4 — Einkaufslisten · F5 — Tracker
Nach Rezepten (referenzieren Rezepte + Produkte).

## Muster pro Entity/Feature
1. **Sync-Registry**: `upsert<E>`/`delete<E>ForSync` im Shared-Core + Eintrag in
   `pull.ts`/`push.ts`-Registry + `SYNCED_TYPES` + `localData`-Reads.
2. **Page/UI** in React, Reads aus lokaler Replica.
3. **Schreib-Aktionen** über Shared-Core + `persist()` + Query-Invalidierung →
   Sync + Auth erledigen den Rest.
4. Verifikation je Stück (Playwright), ein Commit pro sinnvollem Increment.

## Status (Stand 2026-10-08)
- ✅ Fundament: geteilter Kern, Sync (Pull/Push), Auth (Token), Opt-out, Offline-first.
- ✅ F1 Produkte · ✅ F2 Zutaten · ✅ F3 Rezepte (inkl. Import/Export/KI/Bilder/Varianten/Kochmodus)
- ✅ F4 Einkaufslisten (Übersicht/Detail/Preis-Panel/Gruppierung) · ✅ F5 Tracker (**online-first**,
  nutzt REST statt lokaler Replica — offline nicht verfügbar; bewusste Entscheidung, s. u.)

## Sync-Härtung (2026-10-08)
- Pull-Cursor **pro Entity-Typ** (ein globales max() übersprang Änderungen zwischen Typ-Requests).
- Pull setzt den Push-Cursor nicht mehr (verschluckte Nutzer-Edits während eines laufenden Pulls).
- Push läuft, sobald der Server erreichbar ist (ein fehlschlagender Typ blockiert keine Uploads).
- **Delete-LWW**: Tombstone-Zeit (ms) vs. `updatedAt`, beidseitig; Server schickt bei Ablehnung
  seine Zeile zurück (`results`), Client konvergiert sofort.
- **Einkaufslisten: Drei-Wege-Merge pro Artikel/Rezept/Feld** (`src/lib/syncMerge.ts`) gegen
  `sync_base` (letzter gemeinsamer Stand, clientseitig). Gleichzeitiges Abhaken auf zwei Geräten
  geht nicht mehr verloren.
- Private Rezepte rein lokal (geteilte Kopie wird serverseitig gelöscht, Remote-Änderungen ignoriert).
- Live-Sync: `/api/sync/stream` (SSE, nur `seq`), Auto-Sync bei Start/Fokus/Vordergrund/online/60 s;
  Sync-Indikator in der Nav (synchron / läuft / offline / Problem + Badge „ausstehend").
- TanStack `networkMode: 'always'` (lokale Queries froren offline ein).
- Verifiziert per Zwei-Browser-E2E gegen isolierte DB-Kopie (18/18).

## Parity-Lücken (Screenshot-Abgleich Website ↔ App, 412 px, 2026-10-08)
- **Einkaufsliste Detail**: Kopf (Zurück, Live-Badge), „Artikel hinzufügen"-Modal, „Rezept
  hinzufügen", **Teilen**, „Einträge übernehmen?"-Modal (Vorlage/Sammelliste beim ersten Öffnen),
  Rezeptkarten mit „N Zutaten in der Liste" + Hervorheben (Auge), Portionen-Stepper-Stil.
- **Einkaufslisten Übersicht**: Auswählen (Mehrfachauswahl), Schnell hinzufügen, Bearbeiten-Button
  → Seite `einkaufsliste/[id]/edit` fehlt in der App.
- **Rezept Detail**: Reihenfolge/Stil der Aktionen (Bearbeiten/Exportieren/Zur Einkaufsliste/
  Kochmodus-Aufklapper), „Importiert von", Portionen/Zeit/Schwierigkeit-Block, Tag-Karte mit
  „Tag hinzufügen", Karte „Nährwerte & Preis (live berechnet)" (Supermarkt, Produkt pro Zutat,
  „Als Meal Prep planen"), Galerie-Kachel „Bild hinzufügen", schwebender KI-Chat-Button.
- **Rezepte Übersicht**: „Exportieren ▾", zentrierter Kopf, schwebender KI-Chat-Button.
- **Header/global**: Datenspar-Modus, Alias-Einstellungen-Modal, KI-Einstellungen-Modal.
- **Startseite** (`/`): Kacheln Rezepte/Einkaufslisten.
- Favoriten nur lokal (Website: alias-synchronisiert).
- ✅ identisch/nahe: Kochmodus, Zutaten, Produkte.

## App-Extras (über die Website hinaus)
- Offline-first mit lokaler Replica + Outbox, Live-Sync, Sync-Indikator, Barcode-Scan nativ.
- Offen/Ideen: Android-Share-Intent (Website: Web-Share-Target) für Rezept-Import, Tracker offline.
