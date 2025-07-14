# CookBook REST API Dokumentation

Diese Dokumentation beschreibt alle verfügbaren API-Endpunkte der CookBook-Anwendung.

## Übersicht

Alle API-Endpunkte sind unter `/api` verfügbar. Die API verwendet standardmäßig JSON für Request und Response Bodies.

## Fehlerbehandlung

Alle API-Endpunkte verwenden ein einheitliches Format für Fehlerantworten:

```json
{
  "error": "Beschreibung des Fehlers",
  "details": "Optionale detaillierte Fehlermeldung"
}
```

Häufige HTTP-Statuscodes:
- `200`: Erfolgreiche Anfrage
- `201`: Ressource erfolgreich erstellt
- `400`: Ungültige Anfrage (fehlende oder falsche Parameter)
- `404`: Ressource nicht gefunden
- `500`: Interner Serverfehler

## Rezepte

### Rezept-Ressource

```plaintext
/api/recipes
```

Verwaltet die Rezepte in der Anwendung.

Unterstützte Attribute:

| Attribut      | Typ      | Required | Beschreibung |
|---------------|----------|----------|--------------|
| `title`       | string   | Ja       | Titel des Rezepts |
| `subtitle`    | string   | Nein     | Untertitel des Rezepts |
| `description` | string   | Nein     | Beschreibung des Rezepts |
| `category`    | string   | Nein     | Kategorie des Rezepts |
| `tags`        | string[] | Nein     | Liste von Tags |
| `metadata`    | object   | Ja       | Metadaten des Rezepts |
| `metadata.servings` | number | Ja   | Anzahl der Portionen |
| `metadata.timeEntries` | object[] | Nein | Liste von Zeitangaben |
| `metadata.difficulty` | string | Ja | Schwierigkeitsgrad (leicht, mittel, schwer) |
| `ingredientGroups` | object[] | Ja | Liste von Zutatgruppen |
| `preparationGroups` | object[] | Ja | Liste von Zubereitungsschritten |
| `images`      | object[] | Nein     | Liste von Bildern |

#### Liste aller Rezepte abrufen

```plaintext
GET /api/recipes
```

Bei Erfolg wird Status `200` und eine Liste von Rezepten zurückgegeben.

Beispiel-Request:
```shell
curl --url "https://example.com/api/recipes"
```

Beispiel-Response:
```json
[
  {
    "id": "123",
    "title": "Mein Rezept",
    "metadata": {
      "servings": 4,
      "difficulty": "leicht"
    },
    "ingredientGroups": [],
    "preparationGroups": []
  }
]
```

Mögliche Fehler:
- `500`: Interner Serverfehler beim Abrufen der Rezepte

#### Einzelnes Rezept abrufen

```plaintext
GET /api/recipes?id={id}
```

Bei Erfolg wird Status `200` und das angefragte Rezept zurückgegeben.

Beispiel-Request:
```shell
curl --url "https://example.com/api/recipes?id=123"
```

Mögliche Fehler:
- `404`: Rezept nicht gefunden
- `500`: Interner Serverfehler

#### Neues Rezept erstellen

```plaintext
POST /api/recipes
```

Optionale Query-Parameter:
- `action=create-empty`: Erstellt ein leeres Rezept mit Standardwerten
  - Titel: "Neues Rezept"
  - Portionen: 4
  - Schwierigkeit: "leicht"
  - Eine leere Zutatgruppe
  - Eine leere Zubereitungsgruppe

Bei Erfolg wird Status `201` und das erstellte Rezept zurückgegeben.

Beispiel-Request für leeres Rezept:
```shell
curl --request POST \
  --url "https://example.com/api/recipes?action=create-empty"
```

Beispiel-Request mit Daten:
```shell
curl --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "title": "Mein Rezept",
    "metadata": {
      "servings": 4,
      "difficulty": "leicht"
    },
    "ingredientGroups": [],
    "preparationGroups": []
  }' \
  --url "https://example.com/api/recipes"
```

Mögliche Fehler:
- `400`: Ungültige oder fehlende Daten
- `500`: Fehler beim Erstellen des Rezepts

#### Rezept aktualisieren

```plaintext
PUT /api/recipes?id={id}
```

Bei Erfolg wird Status `200` und das aktualisierte Rezept zurückgegeben.

Beispiel-Request:
```shell
curl --request PUT \
  --header "Content-Type: application/json" \
  --data '{
    "title": "Aktualisierter Titel"
  }' \
  --url "https://example.com/api/recipes?id=123"
```

Mögliche Fehler:
- `400`: Rezept-ID fehlt
- `404`: Rezept nicht gefunden
- `500`: Fehler beim Aktualisieren des Rezepts

#### Rezept(e) löschen

```plaintext
DELETE /api/recipes
```

Query-Parameter:
- `id` (optional): ID des zu löschenden Rezepts

Bei Erfolg wird Status `200` zurückgegeben.

Beispiel-Request für einzelnes Rezept:
```shell
curl --request DELETE \
  --url "https://example.com/api/recipes?id=123"
```

Beispiel-Request für mehrere Rezepte:
```shell
curl --request DELETE \
  --header "Content-Type: application/json" \
  --data '{
    "ids": ["123", "456", "789"]
  }' \
  --url "https://example.com/api/recipes"
```

Erfolgreiche Response für Bulk-Delete:
```json
{
  "success": true,
  "deletedCount": 3,
  "deletedImages": 5,
  "errors": []
}
```

Mögliche Fehler:
- `404`: Rezept(e) nicht gefunden
- `500`: Fehler beim Löschen des Rezepts/der Rezepte

### Rezeptbilder

```plaintext
/api/recipes/images
```

Verwaltet die Bilder eines Rezepts.

#### Bild hinzufügen

```plaintext
POST /api/recipes/images
```

Formdata-Parameter:
- `image`: Bilddatei (JPEG, PNG oder WebP)
- `recipeId`: ID des Rezepts

Bei Erfolg wird Status `201` und die Bildinformationen zurückgegeben.

Beispiel-Request:
```shell
curl --request POST \
  --form "image=@/path/to/image.jpg" \
  --form "recipeId=123" \
  --url "https://example.com/api/recipes/images"
```

Beispiel-Response:
```json
{
  "id": "abc",
  "filename": "abc.jpg",
  "url": "/uploads/recipes/abc.jpg",
  "uploadedAt": "2024-03-20T12:00:00Z"
}
```

Mögliche Fehler:
- `400`: Fehlende Parameter oder ungültiges Bildformat
- `404`: Rezept nicht gefunden
- `500`: Fehler beim Hochladen des Bildes

#### Bild löschen

```plaintext
DELETE /api/recipes/images
```

Query-Parameter:
- `recipeId`: ID des Rezepts
- `imageId`: ID des Bildes

Bei Erfolg wird Status `200` zurückgegeben.

Beispiel-Request:
```shell
curl --request DELETE \
  --url "https://example.com/api/recipes/images?recipeId=123&imageId=abc"
```

Mögliche Fehler:
- `400`: Fehlende Parameter
- `404`: Rezept oder Bild nicht gefunden
- `500`: Fehler beim Löschen des Bildes

### Rezeptimport/-export

#### Import aus Datei

```plaintext
POST /api/recipes/import
```

Formdata-Parameter:
- `file`: JSON oder RCB Datei

Unterstützte Formate:
- `.json`: Standard JSON-Format ohne Bilder
- `.rcb`: Erweitertes Format mit Base64-kodierten Bildern

Bei Erfolg wird Status `200` und die importierten Rezepte zurückgegeben.

Beispiel-Request:
```shell
curl --request POST \
  --form "file=@/path/to/recipes.json" \
  --url "https://example.com/api/recipes/import"
```

Beispiel-Response:
```json
{
  "success": true,
  "imported": 2,
  "totalImages": 5,
  "recipes": [...],
  "recipeId": "123"
}
```

Mögliche Fehler:
- `400`: Keine Datei oder ungültiges Format
- `500`: Fehler beim Import

#### Import von URL

```plaintext
POST /api/recipes/import/url
```

Bei Erfolg wird Status `200` und das importierte Rezept zurückgegeben.

Beispiel-Request:
```shell
curl --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "url": "https://example.com/recipe"
  }' \
  --url "https://example.com/api/recipes/import/url"
```

Beispiel-Response:
```json
{
  "success": true,
  "recipe": {...},
  "extractorUsed": "Chefkoch Extractor",
  "sourceUrl": "https://example.com/recipe",
  "imported": 1,
  "recipeId": "123",
  "warnings": [
    "Bitte überprüfen Sie die extrahierten Zutaten auf Korrektheit und Vollständigkeit."
  ]
}
```

Mögliche Fehler:
- `400`: Ungültige URL
- `500`: Fehler beim Import (Website nicht erreichbar, kein Rezept gefunden, etc.)

#### Import-Vorschau

```plaintext
POST /api/recipes/import/preview
```

Bei Erfolg wird Status `200` und die Import-Möglichkeiten zurückgegeben.

Beispiel-Request:
```shell
curl --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "url": "https://example.com/recipe"
  }' \
  --url "https://example.com/api/recipes/import/preview"
```

Beispiel-Response:
```json
{
  "success": true,
  "extractorName": "Chefkoch Extractor",
  "domains": ["chefkoch.de"],
  "capabilities": {
    "supportsIngredientGroups": true,
    "supportsPreparationGroups": true,
    "supportsNutrition": "experimental",
    "supportsTimeExtraction": true,
    "supportsDifficultyExtraction": true,
    "supportsImages": true
  },
  "isSpecificExtractor": true
}
```

Mögliche Fehler:
- `400`: Ungültige URL
- `500`: Fehler bei der Vorschau

#### Export

```plaintext
GET /api/recipes/export
```

Query-Parameter:
- `id` (optional): Einzelnes Rezept exportieren
- `ids` (optional): Komma-separierte Liste von Rezept-IDs
- `format` (optional): "json" oder "rcb" (Standard: "json")

Formate:
- `json`: Exportiert Rezepte ohne lokale Bilder
- `rcb`: Exportiert Rezepte mit Base64-kodierten lokalen Bildern

Bei Erfolg wird Status `200` und die exportierten Rezepte zurückgegeben.

Beispiel-Request:
```shell
curl --url "https://example.com/api/recipes/export?format=rcb&ids=123,456"
```

Mögliche Fehler:
- `404`: Keine Rezepte gefunden
- `500`: Fehler beim Export

## Einkaufslisten

### Einkaufslisten-Ressource

```plaintext
/api/shopping-lists
```

Verwaltet Einkaufslisten.

Unterstützte Attribute:

| Attribut      | Typ      | Required | Beschreibung |
|---------------|----------|----------|--------------|
| `title`       | string   | Ja       | Titel der Einkaufsliste |
| `description` | string   | Nein     | Beschreibung der Liste |
| `recipeIds`   | string[] | Nein     | IDs der enthaltenen Rezepte |

#### Liste aller Einkaufslisten

```plaintext
GET /api/shopping-lists
```

Bei Erfolg wird Status `200` und eine Liste von Einkaufslisten zurückgegeben.

Mögliche Fehler:
- `500`: Fehler beim Abrufen der Listen

#### Einzelne Einkaufsliste

```plaintext
GET /api/shopping-lists?id={id}
```

Bei Erfolg wird Status `200` und die angefragte Einkaufsliste zurückgegeben.

Mögliche Fehler:
- `404`: Liste nicht gefunden
- `500`: Fehler beim Abrufen der Liste

#### Neue Einkaufsliste erstellen

```plaintext
POST /api/shopping-lists
```

Bei Erfolg wird Status `201` und die erstellte Einkaufsliste zurückgegeben.

Beispiel-Request:
```shell
curl --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "title": "Wocheneinkauf",
    "description": "Einkauf für nächste Woche",
    "recipeIds": ["123", "456"]
  }' \
  --url "https://example.com/api/shopping-lists"
```

Mögliche Fehler:
- `400`: Titel fehlt
- `500`: Fehler beim Erstellen der Liste

#### Einkaufsliste aktualisieren

```plaintext
PUT /api/shopping-lists?id={id}
```

Unterstützte Aktionen im Body:
- `add-item`: Item hinzufügen
  ```json
  {
    "action": "add-item",
    "item": { ... }
  }
  ```
- `add-recipe`: Rezept hinzufügen
  ```json
  {
    "action": "add-recipe",
    "recipeId": "123"
  }
  ```
- `remove-recipe`: Rezept entfernen
  ```json
  {
    "action": "remove-recipe",
    "recipeId": "123"
  }
  ```
- `toggle-recipe`: Rezept als erledigt markieren
  ```json
  {
    "action": "toggle-recipe",
    "recipeId": "123",
    "isCompleted": true
  }
  ```
- `update-recipe-servings`: Portionen aktualisieren
  ```json
  {
    "action": "update-recipe-servings",
    "recipeId": "123",
    "servings": 6
  }
  ```

Bei Erfolg wird Status `200` und die aktualisierte Einkaufsliste zurückgegeben.

Mögliche Fehler:
- `400`: Ungültige Aktion oder fehlende Parameter
- `404`: Liste oder Rezept nicht gefunden
- `500`: Fehler beim Aktualisieren der Liste

#### Einkaufsliste löschen

```plaintext
DELETE /api/shopping-lists?id={id}
```

Bei Erfolg wird Status `200` zurückgegeben.

Mögliche Fehler:
- `400`: ID fehlt
- `404`: Liste nicht gefunden
- `500`: Fehler beim Löschen der Liste

### Rezepte in Einkaufslisten

#### Rezepte hinzufügen

```plaintext
POST /api/shopping-lists/{id}/recipes
```

Request Body:
```json
{
  "recipeIds": ["123", "456"]
}
```

Bei Erfolg wird Status `200` und die aktualisierte Einkaufsliste zurückgegeben.

Mögliche Fehler:
- `400`: Keine Rezept-IDs angegeben
- `404`: Liste nicht gefunden
- `500`: Fehler beim Hinzufügen der Rezepte

#### Portionen aktualisieren

```plaintext
PUT /api/shopping-lists/{id}/recipes/{recipeId}/servings
```

Request Body:
```json
{
  "servings": 6
}
```

Bei Erfolg wird Status `200` und die aktualisierte Einkaufsliste zurückgegeben.

Mögliche Fehler:
- `400`: Ungültige Portionenzahl
- `404`: Liste oder Rezept nicht gefunden
- `500`: Fehler beim Aktualisieren der Portionen

### Echtzeit-Updates

```plaintext
GET /api/shopping-lists/stream?listId={id}
```

Stellt eine Server-Sent Events (SSE) Verbindung her für Echtzeit-Updates der Einkaufsliste.

Event-Typen:
- `connected`: Initiale Verbindung hergestellt
- `update`: Änderungen an der Liste
- `lists-update`: Änderungen an der Listenverwaltung (neue Liste, gelöschte Liste)

Beispiel-Events:
```plaintext
event: data
data: {"type":"connected","listId":"123"}

event: data
data: {"type":"update","listId":"123","data":{...},"timestamp":"2024-03-20T12:00:00Z"}

event: data
data: {"type":"lists-update","data":{"type":"created","list":{...}},"timestamp":"2024-03-20T12:00:00Z"}
```

## Hilfsdaten

### Kategorien

```plaintext
GET /api/categories
```

Liefert eine Liste aller verfügbaren Rezeptkategorien.

Standardkategorien:
- Hauptgericht
- Vorspeise
- Dessert
- Getränk
- Snack
- Salat
- Suppe
- Beilage
- Frühstück
- Kuchen & Gebäck

Mögliche Fehler:
- `500`: Fehler beim Abrufen der Kategorien

### Tags

```plaintext
GET /api/tags
```

Query-Parameter:
- `q` (optional): Suchbegriff für Tags

Liefert eine Liste von Tags.

Mögliche Fehler:
- `500`: Fehler beim Abrufen der Tags

### Zutaten

```plaintext
GET /api/ingredients
```

Query-Parameter:
- `q`: Suchbegriff für Zutaten

Liefert eine Liste von Zutaten.

Mögliche Fehler:
- `500`: Fehler beim Abrufen der Zutaten

### Einheiten

```plaintext
GET /api/units
```

Liefert eine Liste aller verfügbaren Einheiten, gruppiert nach Kategorien:
- Gewicht (weight)
  - g (Gramm)
  - kg (Kilogramm)
- Volumen (volume)
  - ml (Milliliter)
  - l (Liter)
  - TL (Teelöffel)
  - EL (Esslöffel)
  - Tasse
  - Becher
  - Glas
- Stück (piece)
  - Stück
  - Pck. (Packung)
  - Dose
  - Flasche
  - Tube
  - Würfel
  - Riegel
- Natürliche Einheiten (natural)
  - Zehe
  - Bund
  - Kopf
  - Knolle
  - Stange
  - Zweig
  - Blatt
  - Scheibe
- Kleine Mengen (small)
  - Prise
  - Msp. (Messerspitze)
  - Tropfen
  - Spritzer
  - Schuss
  - Hauch

Mögliche Fehler:
- `500`: Fehler beim Abrufen der Einheiten 