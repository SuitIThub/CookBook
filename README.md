# Kochbuch-App

[![Astro](https://img.shields.io/badge/Astro-4.0-FF5D01?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.0-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-3.0-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Development Status](https://img.shields.io/badge/Status-In_Development-orange?style=flat-square)](https://github.com/yourusername/cookbook)

Eine moderne, digitale Kochbuch-Anwendung entwickelt mit Astro, TypeScript und Tailwind CSS. Perfekt für die Organisation Ihrer Lieblingsrezepte mit erweiterten Timer-Funktionen, intelligenten Einkaufslisten und einem einzigartigen Kochmodus.

## Was macht diese App besonders?

Diese Kochbuch-App hebt sich durch mehrere innovative Features von anderen Rezept-Apps ab:

### **Intelligenter Rezept-Import**
- **Multi-Site-Extraktor-System**: Automatischer Import von Rezepten direkt von beliebten deutschen Rezeptseiten (Chefkoch, Lecker, Gaumenfreundin) sowie generischer JSON-LD-Unterstützung
- **Text-basierter Import**: Manuelles Einfügen von Rezepttexten mit automatischer Strukturierung
- **Intelligente Erkennung**: Automatische Extraktion von Zutaten, Zubereitungsschritten, Zeiten, Schwierigkeitsgraden und Nährwerten

### **Kochmodus (Cooking Mode)**
- **Slide-basierte Navigation**: Vollbildmodus mit Wischgesten für optimale Nutzung während des Kochens
- **Ein-Schritt-pro-Slide**: Jeder Zubereitungsschritt auf einer eigenen Seite für maximale Übersichtlichkeit
- **Wake Lock API**: Verhindert automatisches Abschalten des Bildschirms während des Kochens
- **Temperatur-Erkennung**: Automatische Erkennung und Anzeige von Temperaturen (inkl. Gasstufen-Umrechnung)

### **Multi-Timer-System**
- **Mehrere Timer gleichzeitig**: Mehrere Timer parallel laufen lassen
- **Global & Lokal**: Timer können global (serverseitig) oder lokal (Browser) gespeichert werden
- **Geräteübergreifende Synchronisation**: Timer werden über alle Geräte und Browser-Tabs synchronisiert
- **Automatische Timer-Erkennung**: Klickbare Zeitangaben in Rezepten starten automatisch Timer
- **Android-Integration**: Vollständige API für Android-Apps zur Timer-Integration

### **Erweiterte Zutatenverlinkung**
- **Intelligente Verlinkung**: Zutaten in Zubereitungsschritten werden automatisch mit der Zutatenliste verlinkt
- **Zwischenprodukte**: Unterstützung für Zwischenprodukte (z.B. "Marinade", "Teig"), die während der Zubereitung entstehen
- **Visuelle Indikatoren**: Farbcodierte Tags zeigen, ob Zutaten bereits verwendet wurden
- **Tooltips**: Hover-Informationen mit Mengenangaben und Beschreibungen

### **Intelligente Einkaufslisten**
- **Automatische Gruppierung**: Zutaten werden automatisch nach Namen und Einheit gruppiert
- **Manuelle Gruppierung**: Flexible manuelle Gruppierung von Artikeln
- **Merge-Vorschläge**: KI-ähnliche Vorschläge zum Zusammenführen ähnlicher Artikel
- **Rezept-Integration**: Ganze Rezepte mit anpassbaren Portionen zur Einkaufsliste hinzufügen
- **Echtzeit-Updates**: Server-Sent Events (SSE) für Live-Updates bei mehreren Nutzern
- **Rezept-Tracking**: Nachverfolgung, welche Artikel zu welchem Rezept gehören

### **Draft-System mit Auto-Save**
- **Automatisches Speichern**: Entwürfe werden automatisch während der Bearbeitung gespeichert
- **Konflikt-Erkennung**: Warnung bei gleichzeitiger Bearbeitung von mehreren Geräten
- **Wiederherstellung**: Automatische Wiederherstellung von Entwürfen beim erneuten Öffnen

### **Nährwertanalyse**
- **Visuelle Bewertung**: Farbcodierte Symbole für Kalorien, Kohlenhydrate, Eiweiß und Fett
- **Pro Portion**: Alle Werte werden pro Portion angezeigt

### **Erweiterte Bildverwaltung**
- **Mehrfachbilder**: Unterstützung für mehrere Bilder pro Rezept
- **Lightbox-Galerie**: Vollbildansicht mit Navigation
- **Embedded Export**: Export mit Base64-kodierten Bildern (.rcb Format)

## Vollständige Feature-Liste

### Rezeptverwaltung
-  Vollständige CRUD-Operationen (Erstellen, Lesen, Aktualisieren, Löschen)
-  Hierarchische Zutaten- und Zubereitungsgruppen (geschachtelte Gruppen)
-  Mehrere Mengenangaben pro Zutat (z.B. "500g oder 0,5kg")
-  Flexible Zeitangaben (Vorbereitung, Kochzeit, Backzeit, Ruhezeit, etc.)
-  Kategorien und Tags
-  Mehrfachbilder pro Rezept
-  Quell-URL-Tracking (Nachverfolgung, von welcher Website importiert)

### Import & Export
-  **URL-Import**: Direkter Import von Rezeptseiten (Chefkoch, Lecker, Gaumenfreundin, JSON-LD)
-  **Text-Import**: Manuelles Einfügen von Rezepttexten
-  **Datei-Import**: JSON und .rcb (mit eingebetteten Bildern)
-  **Export**: JSON (ohne Bilder) oder .rcb (mit Base64-Bildern)
-  **Bulk-Operationen**: Mehrere Rezepte gleichzeitig importieren/exportieren

### Bearbeitungsmodus
-  Vollständiger WYSIWYG-Editor für alle Rezeptfelder
-  Drag & Drop für Zutaten- und Zubereitungsgruppen
-  Automatische Zutatenvervollständigung
-  Automatische Zutatenverlinkung in Zubereitungsschritten
-  Zwischenprodukte erstellen und verlinken
-  Einheiten-Umrechnung beim Speichern
-  Draft-Auto-Save mit Konflikt-Erkennung

### Timer-System
-  Mehrere Timer gleichzeitig
-  Global (serverseitig) und lokal (Browser) Timer
-  Geräteübergreifende Synchronisation
-  Automatische Timer-Erkennung in Rezepttexten
-  Pause/Resume-Funktionalität
-  Vor-/Zurückspulen (1, 5, 10 Minuten)
-  Alarm bei Ablauf
-  Android-API für Companion-Apps

### Einkaufslisten
-  Mehrere Einkaufslisten
-  Rezepte mit anpassbaren Portionen hinzufügen
-  Automatische Gruppierung nach Name und Einheit
-  Manuelle Gruppierung von Artikeln
-  Merge-Vorschläge für ähnliche Artikel
-  Echtzeit-Updates (SSE)
-  Rezept-Tracking (welche Artikel zu welchem Rezept)
-  Checkbox-System zum Abhaken

### Kochmodus
-  Vollbildmodus mit Slide-Navigation
-  Ein Schritt pro Slide
-  Wischgesten (Touch) und Tastatur-Navigation
-  Zutatenübersicht als erster Slide
-  Klickbare Timer in Schritten
-  Temperatur-Erkennung und -Anzeige
-  Wake Lock (Bildschirm bleibt an)
-  Responsive für Portrait und Landscape

### Zutaten & Einheiten
-  Umfangreiches Einheiten-System (Gewicht, Volumen, Stück, natürliche Einheiten)
-  Automatische Umrechnung zwischen Einheiten
-  Einheiten-Kategorien für bessere Organisation
-  Unterstützung für deutsche Einheiten (TL, EL, etc.)

### Nährwerte
-  Kalorien pro Portion
-  Makronährstoffe (Kohlenhydrate, Eiweiß, Fett)
-  Visuelle Bewertung mit Symbolen
-  Automatische Extraktion beim Import

### Benutzeroberfläche
-  Material Design inspiriert
-  Dark Mode Unterstützung
-  Vollständig responsive (Mobile, Tablet, Desktop)
-  Touch-optimiert
-  Tastatur-Navigation
-  Accessibility-Features

### Technische Features
-  SQLite-Datenbank
-  RESTful API
-  Server-Sent Events für Echtzeit-Updates
-  TypeScript für Typsicherheit
-  Astro für optimale Performance
-  PWA-ready (Service Worker vorhanden)

##  Technologie-Stack

| Technologie | Version | Verwendung |
|-------------|---------|------------|
| **Astro** | 4.x | Frontend Framework |
| **TypeScript** | 5.x | Typsicherheit |
| **Tailwind CSS** | 3.x | Styling |
| **SQLite** | 3.x | Datenbank |
| **Node.js** | 18+ | Runtime |

## Installation & Setup

### Voraussetzungen
- **Node.js 18–22 (LTS empfohlen)** – `better-sqlite3` nutzt vorgebaute Binaries nur für LTS; Node 23+ erfordert einen C++-Build (Visual Studio Build Tools).
- npm oder yarn Package Manager

### Schnellstart

1. **Repository klonen**
   ```bash
   git clone https://github.com/yourusername/cookbook.git
   cd cookbook
   ```

2. **Dependencies installieren**
   ```bash
   npm install
   ```

3. **Datenbank initialisieren**
   ```bash
   npm run init-db
   ```

4. **Entwicklungsserver starten**
   ```bash
   npm run dev
   ```

5. **App öffnen**: [http://localhost:4321](http://localhost:4321)

## Projektstruktur

```
CookBook/
├── src/
│   ├── layouts/
│   │   └── Layout.astro           # Haupt-Layout mit Navigation
│   ├── pages/
│   │   ├── index.astro            # Rezeptübersicht (Startseite)
│   │   ├── einkaufsliste.astro    # Einkaufslistenverwaltung
│   │   ├── api/                   # API Endpoints
│   │   │   ├── recipes.ts         # Rezept-API
│   │   │   ├── ingredients.ts     # Zutaten-API
│   │   │   └── shopping-lists.ts  # Einkaufslisten-API
│   │   └── rezept/
│   │       ├── [id].astro         # Rezept-Detailansicht
│   │       └── neu.astro          # Neues Rezept erstellen
│   ├── lib/
│   │   └── database.ts            # Datenbankoperationen
│   └── types/
│       └── recipe.ts              # TypeScript-Typdefinitionen
├── scripts/
│   └── init-db.js                 # Datenbank-Initialisierung
├── public/
│   └── favicon.svg                # App-Icon
└── cookbook.db                 # SQLite-Datenbank
```

## Datenmodell

### Recipe (Rezept)
```typescript
interface Recipe {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  metadata: RecipeMetadata;
  ingredientGroups: IngredientGroup[];
  preparationGroups: PreparationGroup[];
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Besonderheiten des Datenmodells
- **Geschachtelte Gruppen**: Zutaten und Zubereitungsschritte können in verschachtelten Gruppen organisiert werden
- **Mehrfache Mengenangaben**: Jede Zutat kann mehrere Mengenangaben haben (z.B. "500g oder 0,5kg")
- **Zutatenverlinkung**: Zutaten in Zubereitungsschritten werden mit der Zutatenliste verlinkt
- **Zwischenprodukte**: Unterstützung für Zutaten, die während der Zubereitung entstehen (z.B. "Marinade", "Teig")
- **Flexible Zeitangaben**: Mehrere Zeitangaben pro Rezept (Vorbereitung, Kochzeit, Backzeit, Ruhezeit, etc.)
- **Mehrfachbilder**: Unterstützung für mehrere Bilder pro Rezept
- **Nährwerte**: Optionale Nährwertinformationen pro Portion

## Design-Prinzipien

- **Material Design**: Moderne, intuitive Benutzeroberfläche inspiriert von Material Design
- **Mobile First**: Responsive Design für alle Geräte (Mobile, Tablet, Desktop)
- **Accessibility**: Tastaturnavigation und Screenreader-Support
- **Performance**: Schnelle Ladezeiten durch Astro's Static Site Generation
- **Touch-optimiert**: Optimiert für Touch-Gesten und mobile Nutzung
- **Dark Mode**: Vollständige Dark Mode Unterstützung

## Vergleich mit anderen Kochbuch-Apps

### Was diese App einzigartig macht:

1. **Kochmodus**: Keine andere App bietet einen vollständigen Slide-basierten Kochmodus mit Wake Lock
2. **Multi-Timer**: Die meisten Apps unterstützen nur einen Timer - diese App unterstützt mehrere gleichzeitig mit Synchronisation
3. **Intelligenter Import**: Multi-Site-Extraktor-System statt einfacher Copy-Paste
4. **Zwischenprodukte**: Einzigartige Unterstützung für Zutaten, die während der Zubereitung entstehen
5. **Echtzeit-Einkaufslisten**: Server-Sent Events für Live-Updates bei mehreren Nutzern
6. **Draft-System**: Automatisches Speichern mit Konflikt-Erkennung
7. **Hierarchische Gruppen**: Geschachtelte Gruppen für komplexe Rezepte
8. **Android-Integration**: Vollständige API-Dokumentation für Companion-Apps

### Unterstützte Import-Quellen

-  **Chefkoch.de** - Vollständiger Extractor mit allen Features
-  **Lecker.de** - Vollständiger Extractor mit allen Features  
-  **Gaumenfreundin.de** - Vollständiger Extractor mit allen Features
-  **JSON-LD** - Generischer Fallback für alle Websites mit JSON-LD Schema
-  **Text-Import** - Manuelles Einfügen von Rezepttexten

## Verfügbare Commands

| Command | Beschreibung |
|---------|--------------|
| `npm install` | Dependencies installieren |
| `npm run dev` | Entwicklungsserver starten (localhost:4321) |
| `npm run build` | Production Build erstellen |
| `npm run preview` | Build lokal testen |
| `npm run start` | Production Server starten |
| `npm run db:init` | Datenbank initialisieren |
| `npm run db:migrate` | Datenbank-Migrationen ausführen |
| `npm run db:unify-units` | Rezept-Einheiten vereinheitlichen |
| `npm run db:extract-urls` | Quell-URLs aus Rezepten extrahieren |
| `npm run astro ...` | Astro CLI Commands ausführen |

## Entwicklung

### Neue Seite hinzufügen
```bash
# Neue .astro Datei in src/pages/ erstellen
touch src/pages/neue-seite.astro
```

### API Endpoint erstellen
```typescript
// src/pages/api/endpoint.ts
export async function GET() {
  return new Response(JSON.stringify({ message: "Hello API!" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
```

### TypeScript-Typen erweitern
```typescript
// In src/types/recipe.ts
export interface NeuerTyp {
  // Ihre Typdefinition hier
}
```

## Screenshots

| Desktop | Mobile |
|---------|--------|
| ![Desktop View](docs/screenshot-desktop.png) | ![Mobile View](docs/screenshot-mobile.png) |

## Beitragen

Contributions sind willkommen! Bitte beachten Sie:

1. **Fork** das Repository
2. **Branch** für Ihr Feature erstellen (`git checkout -b feature/AmazingFeature`)
3. **Commit** Ihre Änderungen (`git commit -m 'Add some AmazingFeature'`)
4. **Push** zum Branch (`git push origin feature/AmazingFeature`)
5. **Pull Request** öffnen

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe [LICENSE](LICENSE) für Details.

## Support

- **Email**: [suit.it.pub@gmail.com](mailto:suit.it.pub@gmail.com)
- **Issues**: [GitHub Issues](https://github.com/SuitIThub/CookBook/issues)

## Danksagungen

- [Astro](https://astro.build) - Für das fantastische Frontend-Framework
- [Tailwind CSS](https://tailwindcss.com) - Für das utility-first CSS Framework
- [Material Design](https://material.io) - Für die Design-Inspiration

---

<div align="center">

**Status**: In aktiver Entwicklung  
**Version**: 0.1.0  
**Letzte Aktualisierung**: 2024

## Weitere Dokumentation

- [API-Dokumentation](API_DOCUMENTATION.md) - Vollständige REST API Referenz
- [Rezept JSON-Format](RECIPE_JSON_FORMAT.md) - Import/Export Format Spezifikation
- [Android Timer Integration](ANDROID_TIMER_INTEGRATION.md) - Guide für Android Companion Apps
- [Pflichtenheft](Pflichtenheft_KochbuchApp.md) - Detaillierte Anforderungen und Spezifikationen

[Nach oben](#kochbuch-app)

</div>
