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

## Status
- ✅ Fundament: geteilter Kern, Sync (Pull/Push), Auth (Token), Opt-out, Offline-
  first (Rezepte-Ansicht-Minimal).
- ⏭️ **F1 Produkte** — als Nächstes.
