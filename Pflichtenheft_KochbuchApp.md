# Pflichtenheft – Kochbuch-App

## 1. Ziel des Projekts
Die Kochbuch-App soll es Nutzern ermöglichen, Rezepte digital zu speichern, zu verwalten, zu bearbeiten und als Einkaufsliste zu nutzen. Die App bietet sowohl eine klassische Rezeptanzeige als auch umfangreiche Bearbeitungsfunktionen. Sie wird mit **Astro**, **TypeScript** und **Tailwind CSS** umgesetzt, die Daten werden in einer **SQLite-Datenbank** gespeichert.

## 2. Systemübersicht

### 2.1 Frontend-Technologien
- **Astro** (als Framework)
- **TypeScript** (für typisierte Entwicklung)
- **Tailwind CSS** (für Styling)

### 2.2 Backend / Datenhaltung
- **SQLite** als lokale Datenbank
- CRUD-Operationen für Rezepte, Zutaten, Zubereitungsschritte, Mengeneinheiten und Einkaufslisten
- OAuth-basierte Benutzerverwaltung

## 3. Funktionale Anforderungen

### 3.1 Rezeptübersicht
- Anzeige einer Liste gespeicherter Rezepte mit Titel und ggf. Vorschaubild
- Auswahl eines Rezepts führt zur Detailansicht

### 3.2 Rezept-Detailansicht (Standardansicht)
Gliederung der Seite in drei Hauptbereiche:
1. **Kopfbereich:**
   - Titel, Untertitel
   - Beschreibung
   - Metadaten (z. B. Portionen, Zubereitungszeit)
2. **Zutatenbereich:**
   - Zutatenlisten (einfach, gruppiert oder geschachtelt gruppiert)
   - Zutaten mit mehreren Mengenangaben
3. **Zubereitungsbereich:**
   - Zubereitungsschritte (einfach, gruppiert oder geschachtelt gruppiert)
   - Erwähnte Zutaten werden verlinkt (Tooltip mit Mengenangaben bei Hover/Klick)

### 3.3 Bearbeitungsmodus
- Wechsel per Button in der Detailansicht
- Funktionen im Bearbeitungsmodus:
  - Bearbeiten aller Felder (Titel, Beschreibung, etc.)
  - Zutaten und Zutatengruppen hinzufügen/löschen/bearbeiten (inkl. geschachtelter Gruppen)
  - Mengenangaben je Zutat hinzufügen/entfernen
  - Zubereitungsschritte und Gruppen hinzufügen/löschen/bearbeiten (inkl. geschachtelter Gruppen)
  - Mengenangaben bei Speichern in metrische Einheiten umrechnen (aber nicht zusammenführen, wenn Einheit identisch)
  - Verlinkung von Zutaten in Text erfolgt automatisch, kann aber bearbeitet werden
  - Verlinkungen lassen sich entfernen (Button im Bearbeitungsmodus)

### 3.4 Autovervollständigung für Zutatennamen
- Zutaten werden intern gespeichert
- Beim Eingeben neuer Zutaten werden existierende Einträge zur Auswahl vorgeschlagen (Autocomplete)

### 3.5 Timerfunktion
- Zeitangaben im Zubereitungstext sind klickbar
- Klick auf Zeit startet einen Timer
- Timer wird am unteren Bildschirmrand angezeigt
- Funktionen der Timerleiste:
  - Start, Pause, Beenden
  - Vor-/Zurückspulen um 1, 5 oder 10 Minuten
  - Anzeige synchronisiert sich mit Text

### 3.6 Einkaufsliste
- Manuelles Hinzufügen einzelner Zutaten
- Hinzufügen ganzer Rezepte
- Beim Hinzufügen von Rezepten:
  - Zutaten werden extrahiert
  - Zutaten mit identischer Einheit werden zusammengefasst
  - Gruppenlose Zutaten in eine allgemeine Gruppe einfügen

### 3.7 Rezept-Import/-Export
- Export von Rezepten im JSON-Format
- Importfunktion für eigene Rezepte
- Vorbereitung der Infrastruktur zum späteren Import von Rezepten direkt von Webseiten (z. B. über Parser)

### 3.8 Einstellungen und Umrechnungen
- Einstellungsseite für Benutzer
- Benutzerdefinierte Umrechnungsformeln können eingetragen werden
- Automatische Umrechnung bei Speichern berücksichtigt diese Einstellungen

## 4. Nicht-funktionale Anforderungen

### 4.1 Bedienbarkeit
- Intuitive Benutzeroberfläche für Desktop und Mobile
- Responsive Design durch Tailwind
- **Das Design soll sich an den Prinzipien und Konventionen von Material Design orientieren**

### 4.2 Datenpersistenz
- Alle Daten werden in einer lokalen SQLite-Datenbank gespeichert
- Änderungen werden sofort persistiert

### 4.3 Performance
- Kurze Ladezeiten durch vorgerenderte Inhalte (Astro)
- Kein Reload beim Umschalten von Anzeige-/Bearbeitungsmodus

### 4.4 Sicherheit
- OAuth-basierte Benutzer-Authentifizierung (z. B. via Google, GitHub, etc.)
- Zugriff nur für angemeldete Benutzer

### 4.5 Sprache
- Die Anwendung wird ausschließlich auf **Deutsch** entwickelt

### 4.6 Hosting
- Online gehostet als klassische Webanwendung
- Keine Offline-Unterstützung notwendig

## 5. Datenmodell (Auszug)

### Rezept
```ts
interface Recipe {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  metadata: RecipeMetadata;
  ingredientGroups: IngredientGroup[];
  preparationGroups: PreparationGroup[];
}
```

### IngredientGroup
```ts
interface IngredientGroup {
  id: string;
  title?: string;
  ingredients: (Ingredient | IngredientGroup)[];
}
```

### Ingredient
```ts
interface Ingredient {
  id: string;
  name: string;
  quantities: Quantity[];
}
```

### Quantity
```ts
interface Quantity {
  amount: number;
  unit: string;
}
```

### PreparationGroup
```ts
interface PreparationGroup {
  id: string;
  title?: string;
  steps: (PreparationStep | PreparationGroup)[];
}
```

### PreparationStep
```ts
interface PreparationStep {
  id: string;
  text: string;
  linkedIngredients: { ingredientId: string; selectedQuantityIndex: number }[];
  timeInSeconds?: number;
}
```

### Einkaufslistenstruktur
```ts
interface ShoppingList {
  id: string;
  title: string;
  items: ShoppingListItem[];
}

interface ShoppingListItem {
  id: string;
  ingredientName: string;
  quantity: Quantity;
}
```

## 6. Benutzerinteraktion

| Aktion                              | Ergebnis                                            |
|-------------------------------------|-----------------------------------------------------|
| Klick auf Rezept                    | Öffnet Detailansicht                                |
| Klick auf Bearbeiten                | Wechselt in Bearbeitungsmodus                       |
| Klick auf Zeitangabe                | Startet Timer                                       |
| Klick auf verlinkte Zutat           | Öffnet Hover mit Menge(n)                           |
| Rezept zur Einkaufsliste hinzufügen | Überträgt alle Zutaten zusammengefasst nach Einheit |
| Mengenangabe bearbeiten             | UI mit Optionen zum Hinzufügen/Entfernen            |
| Timer im Footer                     | Kontrollmöglichkeiten sichtbar                      |
| Einstellungen öffnen                | Benutzerdefinierte Umrechnungsformeln verwalten     |

## 7. Erweiterbarkeit und Zukunftsausblick
- Zukünftige Ergänzung eines Import-Parsers für Rezept-Webseiten
- Möglichkeit zur Erweiterung um Druckansicht, Offline-Speicherung oder Mehrsprachigkeit bei Bedarf

## 8. Status offener Punkte
Alle offenen Punkte wurden inzwischen konkretisiert und sind im Dokument verarbeitet.
