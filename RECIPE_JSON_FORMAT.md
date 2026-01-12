# Recipe JSON Import Format Documentation

This document describes the structure of recipe JSON files that can be imported into the CookBook application.

## Supported File Formats

The application supports two file formats for recipe import:

- **`.json`**: Standard JSON format without embedded images (or with external image URLs only)
- **`.rcb`**: Extended format with base64-encoded images embedded in the file

## File Structure

A recipe import file can contain either:
- A single recipe object
- An array of recipe objects

### Single Recipe Example
```json
{
  "id": "recipe-123",
  "title": "Spaghetti Carbonara",
  ...
}
```

### Multiple Recipes Example
```json
[
  {
    "id": "recipe-123",
    "title": "Spaghetti Carbonara",
    ...
  },
  {
    "id": "recipe-456",
    "title": "Tiramisu",
    ...
  }
]
```

## Recipe Object Structure

### Top-Level Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | No | Recipe ID (will be regenerated on import to avoid conflicts) |
| `title` | string | **Yes** | Recipe title |
| `subtitle` | string | No | Recipe subtitle |
| `description` | string | No | Recipe description |
| `metadata` | object | **Yes** | Recipe metadata (see below) |
| `category` | string | No | Recipe category |
| `tags` | string[] | No | Array of recipe tags |
| `ingredientGroups` | array | **Yes** | Array of ingredient groups (see below) |
| `preparationGroups` | array | **Yes** | Array of preparation groups (see below) |
| `imageUrl` | string | No | Legacy single image URL (for backward compatibility) |
| `images` | array | No | Array of recipe images (see below) |
| `sourceUrl` | string | No | URL of the recipe if imported from a website |
| `createdAt` | string/Date | No | Creation timestamp (will be set on import) |
| `updatedAt` | string/Date | No | Update timestamp (will be set on import) |

### Metadata Object

```typescript
{
  servings: number;                    // Required: Number of servings
  timeEntries: TimeEntry[];            // Required: Array of time entries
  difficulty?: 'leicht' | 'mittel' | 'schwer';  // Optional: Difficulty level
  nutrition?: NutritionData;           // Optional: Nutrition information
}
```

#### TimeEntry Object

```typescript
{
  id: string;           // Unique identifier
  label: string;        // Label (e.g., "Kochzeit", "Backzeit", "Ruhezeit", "Vorbereitungszeit")
  minutes: number;      // Duration in minutes
}
```

#### NutritionData Object

```typescript
{
  calories?: number;        // Calories per serving (kcal)
  carbohydrates?: number;   // Carbohydrates per serving (grams)
  protein?: number;         // Protein per serving (grams)
  fat?: number;             // Fat per serving (grams)
}
```

### Ingredient Groups

Ingredients are organized in a hierarchical structure using groups. Groups can contain both ingredients and nested groups.

#### IngredientGroup Object

```typescript
{
  id: string;                                    // Unique identifier
  title?: string;                                // Optional: Group title
  ingredients: (Ingredient | IngredientGroup)[]; // Array of ingredients or nested groups
}
```

#### Ingredient Object

```typescript
{
  id: string;              // Unique identifier
  name: string;            // Ingredient name
  description?: string;    // Optional: Additional description
  quantities: Quantity[];  // Array of quantity options
}
```

#### Quantity Object

```typescript
{
  amount: number;  // Numeric amount
  unit: string;    // Unit of measurement (e.g., "g", "ml", "Stück", "TL", "EL")
}
```

### Preparation Groups

Preparation steps are organized in a hierarchical structure using groups. Groups can contain both steps and nested groups.

#### PreparationGroup Object

```typescript
{
  id: string;                              // Unique identifier
  title?: string;                          // Optional: Group title
  steps: (PreparationStep | PreparationGroup)[]; // Array of steps or nested groups
}
```

#### PreparationStep Object

```typescript
{
  id: string;                              // Unique identifier
  text: string;                            // Step instruction text
  linkedIngredients: LinkedIngredient[];   // Ingredients linked to this step
  intermediateIngredients: IntermediateIngredient[]; // Intermediate ingredients created in this step
  timeInSeconds?: number;                  // Optional: Time for this step in seconds
  timer?: number;                          // Optional: Timer duration in minutes
}
```

#### LinkedIngredient Object

Links an ingredient from the ingredient list to a preparation step.

```typescript
{
  ingredientId: string;        // ID of the ingredient (from ingredientGroups)
  selectedQuantityIndex: number; // Index of the selected quantity from the ingredient's quantities array
  isIntermediate?: boolean;    // Optional: true if this links to an intermediate ingredient
}
```

#### IntermediateIngredient Object

Represents an ingredient that is created during preparation (e.g., "marinade", "dough").

```typescript
{
  id: string;           // Unique identifier
  name: string;         // Name of the intermediate ingredient
  description?: string; // Optional: Additional description
}
```

### Images

#### RecipeImage Object (for .json files)

For `.json` files, only external image URLs are preserved:

```typescript
{
  id: string;           // Unique identifier
  filename: string;     // Original filename
  url: string;          // External URL (must not start with "/uploads/")
  uploadedAt: string/Date; // Upload timestamp
}
```

#### RecipeImage Object (for .rcb files)

For `.rcb` files, images can be embedded as base64 data:

```typescript
{
  id: string;           // Unique identifier
  filename: string;     // Original filename
  url?: string;         // Optional: External URL (if isExternal is true)
  data?: string;        // Optional: Base64-encoded image data (for local images)
  isExternal?: boolean; // Optional: true if image is from external URL
  uploadedAt: string/Date; // Upload timestamp
}
```

## Complete Example

### Simple Recipe (JSON Format)

```json
{
  "title": "Spaghetti Carbonara",
  "subtitle": "Klassisches italienisches Rezept",
  "description": "Ein cremiges Pasta-Gericht mit Speck und Ei",
  "metadata": {
    "servings": 4,
    "timeEntries": [
      {
        "id": "time-1",
        "label": "Kochzeit",
        "minutes": 15
      },
      {
        "id": "time-2",
        "label": "Vorbereitungszeit",
        "minutes": 10
      }
    ],
    "difficulty": "mittel",
    "nutrition": {
      "calories": 520,
      "carbohydrates": 45,
      "protein": 20,
      "fat": 25
    }
  },
  "category": "Hauptgericht",
  "tags": ["Italienisch", "Pasta", "Schnell"],
  "ingredientGroups": [
    {
      "id": "group-1",
      "title": "Hauptzutaten",
      "ingredients": [
        {
          "id": "ing-1",
          "name": "Spaghetti",
          "quantities": [
            {
              "amount": 400,
              "unit": "g"
            }
          ]
        },
        {
          "id": "ing-2",
          "name": "Speck",
          "description": "geräuchert, in Würfeln",
          "quantities": [
            {
              "amount": 150,
              "unit": "g"
            }
          ]
        },
        {
          "id": "ing-3",
          "name": "Eier",
          "quantities": [
            {
              "amount": 3,
              "unit": "Stück"
            }
          ]
        }
      ]
    }
  ],
  "preparationGroups": [
    {
      "id": "prep-group-1",
      "title": "Zubereitung",
      "steps": [
        {
          "id": "step-1",
          "text": "Spaghetti in reichlich Salzwasser al dente kochen.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-1",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [],
          "timeInSeconds": 900,
          "timer": 15
        },
        {
          "id": "step-2",
          "text": "Speck in einer Pfanne knusprig braten.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-2",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [],
          "timeInSeconds": 300
        },
        {
          "id": "step-3",
          "text": "Eier mit Parmesan verquirlen und mit den heißen Spaghetti vermengen.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-3",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [],
          "timeInSeconds": 60
        }
      ]
    }
  ],
  "images": [
    {
      "id": "img-1",
      "filename": "carbonara.jpg",
      "url": "https://example.com/images/carbonara.jpg",
      "uploadedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "sourceUrl": "https://example.com/recipes/carbonara"
}
```

### Recipe with Nested Groups

```json
{
  "title": "Komplexes Rezept",
  "metadata": {
    "servings": 6,
    "timeEntries": [
      {
        "id": "time-1",
        "label": "Gesamtzeit",
        "minutes": 120
      }
    ]
  },
  "ingredientGroups": [
    {
      "id": "group-1",
      "title": "Teig",
      "ingredients": [
        {
          "id": "ing-1",
          "name": "Mehl",
          "quantities": [
            {
              "amount": 500,
              "unit": "g"
            }
          ]
        }
      ]
    },
    {
      "id": "group-2",
      "title": "Füllung",
      "ingredients": [
        {
          "id": "ing-2",
          "name": "Hackfleisch",
          "quantities": [
            {
              "amount": 300,
              "unit": "g"
            }
          ]
        }
      ]
    }
  ],
  "preparationGroups": [
    {
      "id": "prep-group-1",
      "title": "Teig vorbereiten",
      "steps": [
        {
          "id": "step-1",
          "text": "Mehl mit Wasser vermengen und kneten.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-1",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [
            {
              "id": "intermediate-1",
              "name": "Teig",
              "description": "Ausgerollter Teig"
            }
          ],
          "timeInSeconds": 600
        }
      ]
    },
    {
      "id": "prep-group-2",
      "title": "Füllung zubereiten",
      "steps": [
        {
          "id": "step-2",
          "text": "Hackfleisch anbraten und würzen.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-2",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [],
          "timeInSeconds": 300
        }
      ]
    }
  ]
}
```

### Recipe with Intermediate Ingredients

```json
{
  "title": "Rezept mit Zwischenprodukten",
  "metadata": {
    "servings": 4,
    "timeEntries": []
  },
  "ingredientGroups": [
    {
      "id": "group-1",
      "ingredients": [
        {
          "id": "ing-1",
          "name": "Joghurt",
          "quantities": [
            {
              "amount": 200,
              "unit": "g"
            }
          ]
        },
        {
          "id": "ing-2",
          "name": "Gewürze",
          "quantities": [
            {
              "amount": 1,
              "unit": "TL"
            }
          ]
        }
      ]
    }
  ],
  "preparationGroups": [
    {
      "id": "prep-group-1",
      "steps": [
        {
          "id": "step-1",
          "text": "Joghurt mit Gewürzen vermengen und 30 Minuten ziehen lassen.",
          "linkedIngredients": [
            {
              "ingredientId": "ing-1",
              "selectedQuantityIndex": 0
            },
            {
              "ingredientId": "ing-2",
              "selectedQuantityIndex": 0
            }
          ],
          "intermediateIngredients": [
            {
              "id": "intermediate-1",
              "name": "Marinade",
              "description": "Gewürzter Joghurt"
            }
          ],
          "timeInSeconds": 1800,
          "timer": 30
        },
        {
          "id": "step-2",
          "text": "Fleisch in der Marinade einlegen.",
          "linkedIngredients": [
            {
              "ingredientId": "intermediate-1",
              "selectedQuantityIndex": 0,
              "isIntermediate": true
            }
          ],
          "intermediateIngredients": [],
          "timeInSeconds": 60
        }
      ]
    }
  ]
}
```

## Import Behavior

### ID Handling

- All IDs (`id` fields) in the imported file will be regenerated to avoid conflicts
- Ingredient IDs referenced in `linkedIngredients` are automatically remapped to the new IDs
- Intermediate ingredient IDs are also remapped correctly

### Timestamps

- `createdAt` and `updatedAt` fields are ignored and set to the current time on import
- `uploadedAt` for images is preserved if provided, otherwise set to the current time

### Images

#### JSON Format (.json)
- Only external image URLs (URLs not starting with `/uploads/`) are preserved
- Local image references are ignored
- Images without valid external URLs are skipped

#### RCB Format (.rcb)
- External image URLs are preserved as-is
- Local images with base64 `data` are decoded and saved to the uploads directory
- Images without valid data or URL are skipped
- New filenames are generated to avoid conflicts

### Validation

The import process will:
- Accept recipes with missing optional fields
- Regenerate all IDs automatically
- Skip invalid images but continue with the import
- Return an error if required fields are missing

## Notes

- The `imageUrl` field is kept for backward compatibility but is deprecated in favor of the `images` array
- All string dates should be in ISO 8601 format (e.g., `"2024-01-15T10:00:00Z"`)
- Quantity units should match the units supported by the application (see units system)
- Nested groups can be used to organize complex recipes with multiple sections

