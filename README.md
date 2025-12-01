# Kochbuch-App

[![Astro](https://img.shields.io/badge/Astro-4.0-FF5D01?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.0-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-3.0-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Development Status](https://img.shields.io/badge/Status-In_Development-orange?style=flat-square)](https://github.com/yourusername/cookbook)

Eine moderne, digitale Kochbuch-Anwendung entwickelt mit Astro, TypeScript und Tailwind CSS. Perfekt für die Organisation Ihrer Lieblingsrezepte mit Timer-Funktionen, Einkaufslisten und responsivem Design.

## Features

### **Bereits implementiert**
- **Rezeptübersicht** - Alle gespeicherten Rezepte auf einen Blick
- **Detailansicht** - Strukturierte Anzeige mit Kopfbereich, Zutaten und Zubereitung
- **Timer-Integration** - Klickbare Zeitangaben starten automatisch Timer
- **Tooltip-System** - Zutatenverlinkungen mit Hover-Informationen
- **Einkaufsliste** - Verwaltung von Einkaufsartikeln
- **Responsive Design** - Optimiert für Desktop und Mobile
- **Material Design** - Moderne, intuitive Benutzeroberfläche

### **In Entwicklung**
- Bearbeitungsmodus für Rezepte
- Vollständige CRUD-Operationen
- SQLite-Datenbankintegration
- Zutatenvervollständigung
- Import-/Export-Funktionalität
- OAuth-Authentifizierung

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
- Node.js 18.0 oder höher
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

### Besonderheiten
- **Geschachtelte Gruppen**: Zutaten und Zubereitungsschritte in Kategorien
- **Mehrfache Mengenangaben**: Flexible Mengeneinheiten pro Zutat
- **Zutatenverlinkung**: Verweise zwischen Zubereitungsschritten und Zutaten
- **Timer-Integration**: Automatische Zeitangaben-Erkennung

## Design-Prinzipien

- **Material Design**: Moderne, intuitive Benutzeroberfläche
- **Mobile First**: Responsive Design für alle Geräte
- **Accessibility**: Tastaturnavigation und Screenreader-Support
- **Performance**: Schnelle Ladezeiten durch Static Site Generation
- **Internationalisierung**: Vorbereitet für mehrsprachige Unterstützung

## Verfügbare Commands

| Command | Beschreibung |
|---------|--------------|
| `npm install` | Dependencies installieren |
| `npm run dev` | Entwicklungsserver starten (localhost:4321) |
| `npm run build` | Production Build erstellen |
| `npm run preview` | Build lokal testen |
| `npm run init-db` | Datenbank initialisieren |
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

[⬆ Nach oben](#-kochbuch-app)

</div>
