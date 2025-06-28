import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

const db = new Database('./cookbook.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    metadata TEXT,
    ingredient_groups TEXT,
    preparation_groups TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    items TEXT,
    recipes TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    usage_count INTEGER DEFAULT 1
  )
`);

// Sample recipes data
const sampleRecipes = [
  {
    id: uuidv4(),
    title: 'Spaghetti Carbonara',
    subtitle: 'Klassisch italienisch',
    description: 'Ein cremiges Nudelgericht mit Speck und Ei, ganz ohne Sahne. Dieses traditionelle römische Gericht ist ein wahrer Klassiker der italienischen Küche.',
    metadata: {
      servings: 4,
      timeEntries: [
        { id: uuidv4(), label: 'Vorbereitung', minutes: 20 },
        { id: uuidv4(), label: 'Kochzeit', minutes: 15 }
      ],
      difficulty: 'mittel'
    },
    ingredientGroups: [
      {
        id: uuidv4(),
        ingredients: [
          {
            id: uuidv4(),
            name: 'Spaghetti',
            description: 'Lange, dünne Nudeln aus Hartweizengrieß',
            quantities: [{ amount: 400, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Guanciale oder Pancetta',
            description: 'Italienischer Schweinebauchspeck, ungeräuchert',
            quantities: [{ amount: 150, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Eier',
            description: 'Frisch, am besten aus Freilandhaltung',
            quantities: [{ amount: 3, unit: 'Stück' }]
          },
          {
            id: uuidv4(),
            name: 'Pecorino Romano',
            description: 'Italienischer Hartkäse aus Schafsmilch',
            quantities: [{ amount: 100, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Schwarzer Pfeffer',
            quantities: [{ amount: 1, unit: 'TL' }]
          },
          {
            id: uuidv4(),
            name: 'Salz',
            quantities: [{ amount: 1, unit: 'Prise' }]
          }
        ]
      }
    ],
    preparationGroups: [
      {
        id: uuidv4(),
        steps: [
          {
            id: uuidv4(),
            text: 'Einen großen Topf mit Salzwasser zum Kochen bringen. Spaghetti hinzufügen und 10-12 Minuten al dente kochen.',
            linkedIngredients: [{ ingredientId: '1', selectedQuantityIndex: 0 }],
            timeInSeconds: 720
          },
          {
            id: uuidv4(),
            text: 'Guanciale in kleine Würfel schneiden und in einer großen Pfanne bei mittlerer Hitze 5 Minuten knusprig braten.',
            linkedIngredients: [{ ingredientId: '2', selectedQuantityIndex: 0 }],
            timeInSeconds: 300
          },
          {
            id: uuidv4(),
            text: 'Eier mit geriebenem Pecorino Romano und schwarzem Pfeffer in einer Schüssel verquirlen.',
            linkedIngredients: [
              { ingredientId: '3', selectedQuantityIndex: 0 },
              { ingredientId: '4', selectedQuantityIndex: 0 },
              { ingredientId: '5', selectedQuantityIndex: 0 }
            ]
          },
          {
            id: uuidv4(),
            text: 'Pasta abgießen und etwas Nudelwasser aufbewahren. Heiße Pasta sofort zu dem Guanciale in die Pfanne geben.',
            linkedIngredients: []
          },
          {
            id: uuidv4(),
            text: 'Pfanne vom Herd nehmen und die Ei-Käse-Mischung schnell unterrühren. Bei Bedarf etwas Nudelwasser hinzufügen.',
            linkedIngredients: []
          }
        ]
      }
    ],
    imageUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: uuidv4(),
    title: 'Apfelkuchen',
    subtitle: 'Deutscher Klassiker',
    description: 'Saftiger Apfelkuchen mit Zimtstreuseln. Ein traditionelles deutsches Rezept, das besonders im Herbst beliebt ist.',
    metadata: {
      servings: 8,
      preparationTime: 30,
      cookingTime: 45,
      difficulty: 'leicht'
    },
    ingredientGroups: [
      {
        id: uuidv4(),
        title: 'Teig',
        ingredients: [
          {
            id: uuidv4(),
            name: 'Mehl',
            quantities: [{ amount: 200, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Butter',
            quantities: [{ amount: 100, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Zucker',
            quantities: [{ amount: 80, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Ei',
            quantities: [{ amount: 1, unit: 'Stück' }]
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'Belag',
        ingredients: [
          {
            id: uuidv4(),
            name: 'Äpfel',
            description: 'Säuerlich-süße Äpfel, z.B. Boskoop oder Braeburn',
            quantities: [{ amount: 4, unit: 'Stück' }]
          },
          {
            id: uuidv4(),
            name: 'Zimt',
            description: 'Gemahlener Ceylon-Zimt für das beste Aroma',
            quantities: [{ amount: 1, unit: 'TL' }]
          },
          {
            id: uuidv4(),
            name: 'Zucker',
            quantities: [{ amount: 2, unit: 'EL' }]
          }
        ]
      }
    ],
    preparationGroups: [
      {
        id: uuidv4(),
        title: 'Teig vorbereiten',
        steps: [
          {
            id: uuidv4(),
            text: 'Mehl, Butter, Zucker und Ei zu einem glatten Teig verkneten. 30 Minuten im Kühlschrank ruhen lassen.',
            linkedIngredients: [],
            timeInSeconds: 1800
          },
          {
            id: uuidv4(),
            text: 'Teig ausrollen und in eine gefettete Springform (26 cm) legen.',
            linkedIngredients: []
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'Backen',
        steps: [
          {
            id: uuidv4(),
            text: 'Äpfel schälen, entkernen und in dünne Spalten schneiden.',
            linkedIngredients: []
          },
          {
            id: uuidv4(),
            text: 'Apfelspalten auf dem Teig verteilen, mit Zimt und Zucker bestreuen.',
            linkedIngredients: []
          },
          {
            id: uuidv4(),
            text: 'Bei 180°C Ober-/Unterhitze 45 Minuten backen, bis der Teig goldbraun ist.',
            linkedIngredients: [],
            timeInSeconds: 2700
          }
        ]
      }
    ],
    imageUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: uuidv4(),
    title: 'Tomatensuppe',
    subtitle: 'Hausgemacht und cremig',
    description: 'Eine wärmende Tomatensuppe mit frischen Kräutern. Perfekt für kalte Tage und einfach zuzubereiten.',
    metadata: {
      servings: 4,
      preparationTime: 15,
      cookingTime: 25,
      difficulty: 'leicht'
    },
    ingredientGroups: [
      {
        id: uuidv4(),
        ingredients: [
          {
            id: uuidv4(),
            name: 'Tomaten',
            quantities: [{ amount: 800, unit: 'g' }]
          },
          {
            id: uuidv4(),
            name: 'Zwiebel',
            quantities: [{ amount: 1, unit: 'Stück' }]
          },
          {
            id: uuidv4(),
            name: 'Knoblauch',
            quantities: [{ amount: 2, unit: 'Zehen' }]
          },
          {
            id: uuidv4(),
            name: 'Gemüsebrühe',
            quantities: [{ amount: 500, unit: 'ml' }]
          },
          {
            id: uuidv4(),
            name: 'Sahne',
            quantities: [{ amount: 100, unit: 'ml' }]
          },
          {
            id: uuidv4(),
            name: 'Basilikum',
            quantities: [{ amount: 1, unit: 'Bund' }]
          },
          {
            id: uuidv4(),
            name: 'Olivenöl',
            quantities: [{ amount: 2, unit: 'EL' }]
          }
        ]
      }
    ],
    preparationGroups: [
      {
        id: uuidv4(),
        steps: [
          {
            id: uuidv4(),
            text: 'Zwiebel und Knoblauch fein hacken. In einem Topf mit Olivenöl 3 Minuten glasig dünsten.',
            linkedIngredients: [],
            timeInSeconds: 180
          },
          {
            id: uuidv4(),
            text: 'Tomaten hinzufügen und 5 Minuten mitdünsten. Mit Gemüsebrühe ablöschen.',
            linkedIngredients: [],
            timeInSeconds: 300
          },
          {
            id: uuidv4(),
            text: 'Alles 15 Minuten köcheln lassen, dann mit einem Pürierstab fein pürieren.',
            linkedIngredients: [],
            timeInSeconds: 900
          },
          {
            id: uuidv4(),
            text: 'Sahne unterrühren, mit Salz und Pfeffer würzen. Mit frischem Basilikum garnieren.',
            linkedIngredients: []
          }
        ]
      }
    ],
    imageUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Sample shopping list data
const sampleShoppingList = {
  id: uuidv4(),
  title: 'Wocheneinkauf',
  description: 'Einkaufsliste für die Woche',
  items: [
    {
      id: uuidv4(),
      name: 'Milch',
      description: '1,5% Fett',
      quantity: { amount: 1, unit: 'L' },
      originalQuantity: { amount: 1, unit: 'L' },
      isChecked: false
    },
    {
      id: uuidv4(),
      name: 'Brot',
      description: 'Vollkornbrot',
      quantity: { amount: 1, unit: 'Stück' },
      originalQuantity: { amount: 1, unit: 'Stück' },
      isChecked: false
    }
  ],
  recipes: [
    {
      id: sampleRecipes[0].id, // Reference to Spaghetti Carbonara
      title: 'Spaghetti Carbonara',
      servings: 4,
      currentServings: 4,
      isCompleted: false,
      addedAt: new Date()
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Insert sample recipes
const insertRecipe = db.prepare(`
  INSERT OR REPLACE INTO recipes (id, title, subtitle, description, metadata, ingredient_groups, preparation_groups, image_url, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

sampleRecipes.forEach(recipe => {
  insertRecipe.run(
    recipe.id,
    recipe.title,
    recipe.subtitle,
    recipe.description,
    JSON.stringify(recipe.metadata),
    JSON.stringify(recipe.ingredientGroups),
    JSON.stringify(recipe.preparationGroups),
    recipe.imageUrl,
    recipe.createdAt,
    recipe.updatedAt
  );
  console.log(`✅ Recipe inserted: ${recipe.title}`);
});

// Insert sample shopping list
const insertShoppingList = db.prepare(`
  INSERT OR REPLACE INTO shopping_lists (id, title, description, items, recipes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertShoppingList.run(
  sampleShoppingList.id,
  sampleShoppingList.title,
  sampleShoppingList.description,
  JSON.stringify(sampleShoppingList.items),
  JSON.stringify(sampleShoppingList.recipes),
  sampleShoppingList.createdAt,
  sampleShoppingList.updatedAt
);
console.log(`✅ Shopping list inserted: ${sampleShoppingList.title}`);

// Insert ingredients for autocomplete
const insertIngredient = db.prepare(`
  INSERT OR REPLACE INTO ingredients (id, name, usage_count)
  VALUES (?, ?, ?)
`);

const ingredients = [
  'Spaghetti', 'Guanciale', 'Pancetta', 'Eier', 'Pecorino Romano', 'Schwarzer Pfeffer', 'Salz',
  'Mehl', 'Butter', 'Zucker', 'Äpfel', 'Zimt', 'Tomaten', 'Zwiebel', 'Knoblauch',
  'Gemüsebrühe', 'Sahne', 'Basilikum', 'Olivenöl', 'Milch', 'Brot'
];

ingredients.forEach(ingredient => {
  insertIngredient.run(uuidv4(), ingredient, 1);
});
console.log(`✅ ${ingredients.length} ingredients added for autocomplete`);

db.close();
console.log('\n🎉 Database initialization completed successfully!');
console.log('📍 Database file: ./cookbook.db');
console.log(`📊 ${sampleRecipes.length} sample recipes added`);
console.log('🛒 1 sample shopping list added');
console.log(`🥕 ${ingredients.length} ingredients for autocomplete added`); 