import type { Recipe, NutritionData } from '../../types/recipe';

export interface ExtractedRecipeData {
  title: string;
  subtitle?: string;
  description?: string;
  servings?: number;
  preparationTime?: number; // in minutes
  cookingTime?: number; // in minutes
  difficulty?: 'leicht' | 'mittel' | 'schwer';
  ingredients: string[];
  instructions: string[];
  imageUrl?: string;
  nutrition?: NutritionData; // New: optional nutrition data
  keywords?: string[]; // Tags/keywords extracted from the recipe
  category?: string; // Recipe category (e.g., "Hauptgericht", "Dessert")
  sourceUrl: string;
}

export interface ExtractorCapabilities {
  supportsIngredientGroups: boolean;
  supportsPreparationGroups: boolean;
  supportsImages: boolean;
  supportsNutrition: boolean | 'experimental';
  supportsMetadata: boolean;
  supportsTimeExtraction?: boolean | 'experimental';
  supportsDifficultyExtraction?: boolean | 'experimental';
  supportsKeywordExtraction?: boolean | 'experimental';
  supportsCategoryExtraction?: boolean | 'experimental';
  description: string;
}

export abstract class BaseRecipeExtractor {
  abstract readonly name: string;
  abstract readonly domains: string[];
  
  /**
   * Check if this extractor can handle the given URL
   */
  canExtract(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      return this.domains.some(d => 
        domain === d || 
        domain.endsWith(`.${d}`) ||
        domain.includes(d)
      );
    } catch {
      return false;
    }
  }
  
  /**
   * Extract recipe data from the given URL
   */
  abstract extractRecipe(url: string): Promise<ExtractedRecipeData>;
  
  /**
   * Get the capabilities of this extractor
   */
  getCapabilities(): ExtractorCapabilities {
    return {
      supportsIngredientGroups: false,
      supportsPreparationGroups: false,
      supportsImages: true,
      supportsNutrition: false,
      supportsMetadata: true,
      supportsTimeExtraction: false,
      description: 'Basis-Extraktor für allgemeine Websites'
    };
  }
  
  /**
   * Convert extracted data to our Recipe format
   */
  convertToRecipeFormat(data: ExtractedRecipeData): Partial<Recipe> {
    const timeEntries = [];
    
    if (data.preparationTime && data.preparationTime > 0) {
      timeEntries.push({
        id: this.generateId(),
        label: 'Vorbereitung',
        minutes: data.preparationTime
      });
    }
    
    if (data.cookingTime && data.cookingTime > 0) {
      timeEntries.push({
        id: this.generateId(),
        label: 'Kochzeit',
        minutes: data.cookingTime
      });
    }
    
    return {
      title: data.title,
      subtitle: data.subtitle,
      description: data.description,
      category: data.category,
      tags: data.keywords,
      metadata: {
        servings: data.servings || 4,
        timeEntries: timeEntries,
        difficulty: data.difficulty || 'mittel',
        nutrition: data.nutrition
      },
      ingredientGroups: [{
        id: this.generateId(),
        title: undefined,
        ingredients: data.ingredients.map(ingredient => this.parseIngredient(ingredient))
      }],
      preparationGroups: [{
        id: this.generateId(),
        title: 'Zubereitung',
        steps: data.instructions.map((instruction, index) => ({
          id: this.generateId(),
          text: instruction,
          linkedIngredients: [],
          intermediateIngredients: []
        }))
      }],
      imageUrl: data.imageUrl
    };
  }
  
  /**
   * Generate a unique ID
   */
  protected generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Fetch HTML content from URL
   */
  protected async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    
    return response.text();
  }
  
  /**
   * Clean and normalize text
   */
  protected cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();
  }
  
  /**
   * Parse time string (e.g., "30 minutes", "1 hour") to minutes
   */
  protected parseTimeToMinutes(timeStr: string): number {
    const str = timeStr.toLowerCase();
    let minutes = 0;
    
    // Match hours
    const hourMatch = str.match(/(\d+)\s*(hour|hr|stunde|std)/);
    if (hourMatch) {
      minutes += parseInt(hourMatch[1]) * 60;
    }
    
    // Match minutes
    const minuteMatch = str.match(/(\d+)\s*(minute|min)/);
    if (minuteMatch) {
      minutes += parseInt(minuteMatch[1]);
    }
    
    // If no specific unit found, try to extract just numbers
    if (minutes === 0) {
      const numberMatch = str.match(/(\d+)/);
      if (numberMatch) {
        minutes = parseInt(numberMatch[1]);
      }
    }
    
    return minutes || 30; // default to 30 minutes
  }

  /**
   * Parse ingredient string to extract amount, unit, and name
   * Examples: "3 EL Olivenöl" -> { amount: 3, unit: "EL", name: "Olivenöl" }
   */
  protected parseIngredient(ingredientStr: string): any {
    // Handle null/undefined input
    if (!ingredientStr) {
      return {
        id: this.generateId(),
        name: 'Unbekannte Zutat',
        quantities: [{
          amount: 1,
          unit: 'Stück'
        }]
      };
    }

    const cleaned = this.cleanText(ingredientStr);
    console.log('Parsing ingredient:', cleaned);
    
    // Define unit mappings with their variations
    const unitMappings = [
      // Small measurement units
      { unit: 'Msp.', variations: ['Messerspitze', 'Msp\\.?', 'MSP\\.?'] },
      { unit: 'Prise', variations: ['Prise', 'Pr\\.?', 'PR\\.?'] },
      { unit: 'Tropfen', variations: ['Tropfen', 'Tr\\.?', 'TR\\.?'] },
      { unit: 'Spritzer', variations: ['Spritzer'] },
      { unit: 'Schuss', variations: ['Schuss'] },
      { unit: 'Hauch', variations: ['Hauch'] },
      
      // Volume units
      { unit: 'EL', variations: ['Esslöffel', 'EL', 'Eßlöffel'] },
      { unit: 'TL', variations: ['Teelöffel', 'TL'] },
      { unit: 'L', variations: ['Liter', 'l', 'L'] },
      { unit: 'ml', variations: ['Milliliter', 'ml', 'ML'] },
      { unit: 'Tasse', variations: ['Tasse', 'Tassen'] },
      { unit: 'Becher', variations: ['Becher'] },
      { unit: 'Glas', variations: ['Glas', 'Gläser'] },
      
      // Weight units
      { unit: 'kg', variations: ['Kilogramm', 'kg', 'KG'] },
      { unit: 'g', variations: ['Gramm', 'g', 'G'] },
      
      // Package/piece units
      { unit: 'Pck.', variations: ['Packung', 'Pck\\.?', 'Pack'] },
      { unit: 'Päckchen', variations: ['Päckchen'] },
      { unit: 'Dose', variations: ['Dose', 'Dosen'] },
      { unit: 'Flasche', variations: ['Flasche', 'Flaschen'] },
      { unit: 'Tube', variations: ['Tube', 'Tuben'] },
      { unit: 'Würfel', variations: ['Würfel'] },
      { unit: 'Riegel', variations: ['Riegel'] },
      { unit: 'Rolle', variations: ['Rolle', 'Rollen'] },
      { unit: 'Stück', variations: ['Stück', 'St\\.?', 'St'] },
      
      // Natural units
      { unit: 'Zehe', variations: ['Zehe', 'Zehen'] },
      { unit: 'Bund', variations: ['Bund'] },
      { unit: 'Kopf', variations: ['Kopf', 'Köpfe'] },
      { unit: 'Knolle', variations: ['Knolle', 'Knollen'] },
      { unit: 'Stange', variations: ['Stange', 'Stangen'] },
      { unit: 'Zweig', variations: ['Zweig', 'Zweige'] },
      { unit: 'Blatt', variations: ['Blatt', 'Blätter'] },
      { unit: 'Scheibe', variations: ['Scheibe', 'Scheiben'] },
      { unit: 'Handvoll', variations: ['Handvoll'] }
    ];

    // Generate unit patterns dynamically
    const unitPatterns = [];
    
    // Enhanced patterns for complex ingredients
    for (const { unit, variations } of unitMappings) {
      const variationPattern = variations.join('|');
      
      // Pattern with descriptive text between quantity and unit (e.g., "3 gestr. TL")
      unitPatterns.push({
        pattern: new RegExp(`^(\\d+(?:[,\\.]\\d+)?)\\s+([a-zäöüß\\.]+\\s+)?(${variationPattern})\\s+(.+)`, 'i'),
        unit,
        hasDescriptive: true
      });
      
      // Standard pattern (e.g., "3 TL")
      unitPatterns.push({
        pattern: new RegExp(`^(\\d+(?:[,\\.]\\d+)?)\\s*(${variationPattern})\\s+(.+)`, 'i'),
        unit
      });
    }

    // Add special patterns at the beginning for priority
    const specialPatterns = [
      // Ingredients with parentheses info (e.g., "4 Eier (Gr. M)")
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+([A-Za-zäöüÄÖÜß]+)\s*\(([^)]+)\)(?:\s+(.+))?/i, parentheses: true },
      
      // Descriptive text with units (e.g., "3 gestr. TL Backpulver")
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+([a-zäöüß\.\s]+)\s+(TL|EL|g|kg|ml|L|Pck\.?|Msp\.?)\s+(.+)/i, descriptive: true },
      
      // Glas with content description (e.g., "1 Glas (à 720 ml) Sauerkirschen")
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+(Glas|Dose|Flasche)\s*\(([^)]+)\)\s+(.+)/i, container: true },
      
      // "Schale von..." pattern
      { pattern: /^(Schale\s+von\s+.+)/i, description: true },
      
      // Compound ingredient names with units (e.g., "1 Zimtstange", "2 Knoblauchzehen")
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+(.*(?:stange|zehe|kopf|knolle|zweig|blatt|scheibe|bund)(?:n)?)$/i, compound: true },
      
      // Special Chefkoch patterns with parentheses like "Zwiebel(n)"
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+([A-Za-zäöüÄÖÜß]+\([^)]*\))(?:\s+(.+))?/i, chefkoch: true },
      
      // Special patterns for "1/2", "½" etc.
      { pattern: /^(½|1\/2)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.5 },
      { pattern: /^(¼|1\/4)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.25 },
      { pattern: /^(¾|3\/4)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.75 },
      
      // Fractional amounts
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*\/\s*(\d+)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, fraction: true },
      
      // Text-based quantities (without numbers)
      { pattern: /^(etwas)\s+(.+)/i, amount: 1, unit: 'etwas' },
      { pattern: /^(wenig)\s+(.+)/i, amount: 1, unit: 'wenig' },
      { pattern: /^(viel)\s+(.+)/i, amount: 1, unit: 'viel' },
      { pattern: /^(ein wenig)\s+(.+)/i, amount: 1, unit: 'ein wenig' },
      { pattern: /^(ein bisschen)\s+(.+)/i, amount: 1, unit: 'ein bisschen' },
      { pattern: /^(nach Geschmack)\s+(.+)/i, amount: 1, unit: 'n. Geschmack' },
      { pattern: /^(nach Belieben)\s+(.+)/i, amount: 1, unit: 'n. Belieben' },
      { pattern: /^(n\.\s*B\.)\s+(.+)/i, amount: 1, unit: 'n. Belieben' },
    ];

    // Add special patterns first, then regular unit patterns
    unitPatterns.unshift(...specialPatterns);

    // Add generic patterns at the end
    unitPatterns.push(
      // Generic fallback pattern for short units
      (() => {
        const allShortUnits = unitMappings.flatMap(mapping => 
          mapping.variations.filter(v => v.length <= 4 && !v.includes('\\'))
        ).join('|');
        return { 
          pattern: new RegExp(`^(\\d+(?:[,\\.]\\d+)?)\\s*(${allShortUnits})\\b\\s*(.+)`, 'i'), 
          generic: true 
        };
      })(),
      
      // Just a number at the start (fallback)
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+(.+)/i, unit: 'Stück' }
    );

    for (const patternObj of unitPatterns) {
      const { pattern } = patternObj;
      const unit = 'unit' in patternObj ? patternObj.unit : undefined;
      const fixedAmount = 'amount' in patternObj ? patternObj.amount : undefined;
      const fraction = 'fraction' in patternObj ? patternObj.fraction : false;
      const generic = 'generic' in patternObj ? patternObj.generic : false;
      const chefkoch = 'chefkoch' in patternObj ? patternObj.chefkoch : false;
      const parentheses = 'parentheses' in patternObj ? patternObj.parentheses : false;
      const descriptive = 'descriptive' in patternObj ? patternObj.descriptive : false;
      const container = 'container' in patternObj ? patternObj.container : false;
      const description = 'description' in patternObj ? patternObj.description : false;
      const hasDescriptive = 'hasDescriptive' in patternObj ? patternObj.hasDescriptive : false;
      const compound = 'compound' in patternObj ? patternObj.compound : false;
      
      const match = cleaned.match(pattern);
      if (match) {
        console.log('Pattern matched:', pattern, 'Match groups:', match);
        
        let amount: number;
        let extractedUnit: string;
        let name: string;

        if (description) {
          // Special case for "Schale von..." - treat as single item
          return {
            id: this.generateId(),
            name: match[1],
            quantities: [{
              amount: 1,
              unit: 'Stück'
            }]
          };
        } else if (parentheses) {
          // Pattern like "4 Eier (Gr. M)"
          amount = parseFloat(match[1].replace(',', '.'));
          const baseName = match[2];
          const ingredientDescription = match[3];
          const additionalText = match[4] || '';
          
          // Determine unit based on ingredient name
          let ingredientUnit = 'Stück';
          if (baseName.toLowerCase().includes('ei')) {
            ingredientUnit = 'Stück';
          }
          
          name = baseName + (additionalText ? ' ' + additionalText : '');
          extractedUnit = ingredientUnit;
          
          // Store description separately
          const result = {
            id: this.generateId(),
            name: name.trim(),
            description: ingredientDescription,
            quantities: [{
              amount: amount,
              unit: extractedUnit
            }]
          };
          
          console.log('Parsed ingredient result with description:', result);
          return result;
        } else if (descriptive) {
          // Pattern like "3 gestr. TL Backpulver"
          amount = parseFloat(match[1].replace(',', '.'));
          const descriptiveText = match[2].trim();
          extractedUnit = match[3];
          const ingredientName = match[4];
          
          name = ingredientName;
          
          // Store descriptive text as description
          const result = {
            id: this.generateId(),
            name: name.trim(),
            description: descriptiveText,
            quantities: [{
              amount: amount,
              unit: extractedUnit
            }]
          };
          
          console.log('Parsed ingredient result with description:', result);
          return result;
                         } else if (container) {
          // Pattern like "1 Glas (à 720 ml) Sauerkirschen"
          amount = parseFloat(match[1].replace(',', '.'));
          const containerType = match[2];
          const containerDescription = match[3];
          const contents = match[4];
          
          extractedUnit = containerType;
          name = contents;
          
          // Store container description as description
          const result = {
            id: this.generateId(),
            name: name.trim(),
            description: containerDescription,
            quantities: [{
              amount: amount,
              unit: extractedUnit
            }]
          };
          
          console.log('Parsed ingredient result with description:', result);
          return result;
         } else if (compound) {
           // Pattern like "1 Zimtstange" - ingredient name contains the unit
           amount = parseFloat(match[1].replace(',', '.'));
           name = match[2];
           extractedUnit = 'Stück'; // Default to pieces for compound ingredients
         } else if (hasDescriptive) {
          // Pattern with descriptive text between quantity and unit
          amount = parseFloat(match[1].replace(',', '.'));
          const descriptiveText = match[2] ? match[2].trim() : '';
          extractedUnit = unit || match[3];
          const ingredientName = match[4] || '';
          
          name = ingredientName;
          
          // If there's descriptive text, store it as description
          if (descriptiveText) {
            const result = {
              id: this.generateId(),
              name: name.trim(),
              description: descriptiveText,
              quantities: [{
                amount: amount,
                unit: extractedUnit
              }]
            };
            
            console.log('Parsed ingredient result with description:', result);
            return result;
          }
        } else if (fixedAmount !== undefined) {
          // Fixed amount (like ½)
          amount = fixedAmount;
          extractedUnit = match[2] || 'Stück';
          name = match[3] || '';
        } else if (fraction) {
          // Fraction like "1/2"
          amount = parseFloat(match[1]) / parseFloat(match[2]);
          extractedUnit = match[3] || 'Stück';
          name = match[4] || '';
        } else if (chefkoch) {
          // Chefkoch pattern like "1 Zwiebel(n)" or "2 Schmelzkäse-Ecke(n) à 25 g"
          amount = parseFloat(match[1].replace(',', '.'));
          extractedUnit = 'Stück';
          name = match[2]; // This is the ingredient name with parentheses
          
          // If there's additional text, append it
          if (match[3] && match[3].trim()) {
            name += ' ' + match[3].trim();
          }
        } else if (generic) {
          // Generic pattern with known units only
          amount = parseFloat(match[1].replace(',', '.'));
          extractedUnit = match[2];
          name = match[3] || '';
        } else {
          // Standard pattern with known unit or fallback pattern
          amount = parseFloat(match[1].replace(',', '.'));
          
          // Check if this is the fallback pattern (only 2 groups: amount and name)
          if (match.length === 3 && unit) {
            // Fallback pattern: "1 kleine rote Zwiebel" -> amount=1, name="kleine rote Zwiebel"
            extractedUnit = unit;
            name = match[2] || '';
          } else {
            // Standard pattern with explicit unit
            extractedUnit = unit || match[2] || 'Stück';
            name = match[3] || '';
          }
        }

        // Ensure name is not empty
        if (!name || name.trim() === '') {
          name = 'Unbekannte Zutat';
        }

        const result = {
          id: this.generateId(),
          name: name.trim(),
          quantities: [{
            amount: amount,
            unit: extractedUnit
          }]
        };
        
        console.log('Parsed ingredient result:', result);
        return result;
      }
    }

    // No amount/unit found, treat as plain ingredient
    console.log('No pattern matched, using as plain ingredient');
    return {
      id: this.generateId(),
      name: cleaned,
      quantities: [{
        amount: 1,
        unit: 'Stück'
      }]
    };
  }

  /**
   * Extract keywords/tags from HTML content and recipe data
   */
  protected extractKeywords(html: string, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from recipe content...');
    
    const keywords: Set<string> = new Set();
    
    // Extract from meta keywords if available
    const metaKeywords = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i);
    if (metaKeywords) {
      metaKeywords[1].split(',').forEach(keyword => {
        const cleaned = keyword.trim();
        if (cleaned.length > 2) keywords.add(cleaned);
      });
    }
    
    // Extract from meta tags
    const metaTags = html.match(/<meta[^>]*property=["']article:tag["'][^>]*content=["']([^"']+)["']/gi);
    if (metaTags) {
      metaTags.forEach(tag => {
        const match = tag.match(/content=["']([^"']+)["']/i);
        if (match) {
          const cleaned = match[1].trim();
          if (cleaned.length > 2) keywords.add(cleaned);
        }
      });
    }

    // Extract recipe-specific German terms from title and description
    const textToAnalyze = `${title} ${description || ''}`.toLowerCase();
    
    // Common German cooking terms and categories
    const cookingTerms = [
      // Cooking methods
      'gebacken', 'gebraten', 'gekocht', 'gedünstet', 'gegrillt', 'geschmort', 
      'frittiert', 'überbacken', 'paniert', 'mariniert', 'gefüllt', 'glasiert',
      
      // Dietary types
      'vegetarisch', 'vegan', 'glutenfrei', 'laktosefrei', 'low carb', 'kalorienarm',
      
      // Occasions
      'weihnachten', 'ostern', 'geburtstag', 'party', 'festlich', 'thanksgiving',
      
      // Textures/characteristics
      'knusprig', 'cremig', 'saftig', 'würzig', 'süß', 'herzhaft', 'scharf', 
      'mild', 'pikant', 'zart', 'deftig', 'leicht', 'frisch',
      
      // Origins
      'italienisch', 'französisch', 'deutsch', 'amerikanisch', 'asiatisch', 
      'mediterran', 'türkisch', 'griechisch', 'spanisch', 'mexikanisch',
      
      // Food categories
      'fleisch', 'fisch', 'gemüse', 'pasta', 'reis', 'kartoffel', 'suppe', 
      'salat', 'brot', 'kuchen', 'torte', 'kekse'
    ];
    
    cookingTerms.forEach(term => {
      if (textToAnalyze.includes(term)) {
        keywords.add(term);
      }
    });
    
    // Extract ingredient-based keywords
    const ingredientKeywords = [
      'schokolade', 'vanille', 'zimt', 'ingwer', 'knoblauch', 'zwiebel',
      'tomate', 'käse', 'sahne', 'butter', 'ei', 'mehl', 'zucker',
      'hähnchen', 'schwein', 'rind', 'lachs', 'garnelen', 'pilze'
    ];
    
    ingredientKeywords.forEach(ingredient => {
      if (textToAnalyze.includes(ingredient)) {
        keywords.add(ingredient);
      }
    });
    
    const result = Array.from(keywords).slice(0, 10); // Limit to 10 keywords
    console.log(`✅ Extracted ${result.length} keywords: ${result.join(', ')}`);
    return result;
  }

  /**
   * Extract recipe category from HTML content and recipe data
   */
  protected extractCategory(html: string, title: string, description?: string): string | undefined {
    console.log('📂 Extracting recipe category from content...');
    
    // Try JSON-LD structured data first
    const jsonLdMatch = html.match(/"recipeCategory":\s*"([^"]+)"/i);
    if (jsonLdMatch) {
      const category = this.normalizeCategory(jsonLdMatch[1]);
      console.log(`✅ Found category in JSON-LD: ${category}`);
      return category;
    }
    
    // Check meta properties
    const metaCategory = html.match(/<meta[^>]*property=["']article:section["'][^>]*content=["']([^"']+)["']/i);
    if (metaCategory) {
      const category = this.normalizeCategory(metaCategory[1]);
      console.log(`✅ Found category in meta: ${category}`);
      return category;
    }
    
    // Analyze title and description for category hints
    const textToAnalyze = `${title} ${description || ''}`.toLowerCase();
    
    // Category mapping for German cooking sites
    const categoryMappings = [
      { category: 'Vorspeise', keywords: ['vorspeise', 'appetizer', 'starter', 'antipasti', 'häppchen'] },
      { category: 'Hauptgericht', keywords: ['hauptgericht', 'hauptspeise', 'dinner', 'mittagessen'] },
      { category: 'Dessert', keywords: ['dessert', 'nachspeise', 'süßspeise', 'kuchen', 'torte', 'eis', 'pudding'] },
      { category: 'Suppe', keywords: ['suppe', 'eintopf', 'soup', 'brühe', 'consommé'] },
      { category: 'Salat', keywords: ['salat', 'salad', 'rohkost'] },
      { category: 'Beilage', keywords: ['beilage', 'side dish', 'gemüse', 'kartoffel', 'reis', 'nudeln'] },
      { category: 'Getränk', keywords: ['getränk', 'drink', 'smoothie', 'cocktail', 'saft', 'tee', 'kaffee'] },
      { category: 'Frühstück', keywords: ['frühstück', 'breakfast', 'müsli', 'pancake', 'french toast'] },
      { category: 'Snack', keywords: ['snack', 'häppchen', 'fingerfood', 'tapas', 'chips'] },
      { category: 'Brot & Gebäck', keywords: ['brot', 'brötchen', 'gebäck', 'bread', 'backen'] }
    ];
    
    for (const mapping of categoryMappings) {
      if (mapping.keywords.some(keyword => textToAnalyze.includes(keyword))) {
        console.log(`✅ Detected category from content: ${mapping.category}`);
        return mapping.category;
      }
    }
    
    console.log('🔄 No category detected, returning undefined');
    return undefined;
  }

  /**
   * Normalize category names to standardized German categories
   */
  protected normalizeCategory(category: string): string {
    const normalized = category.toLowerCase().trim();
    
    const categoryMap: { [key: string]: string } = {
      'appetizer': 'Vorspeise',
      'starter': 'Vorspeise',
      'main course': 'Hauptgericht',
      'main dish': 'Hauptgericht',
      'entree': 'Hauptgericht',
      'dessert': 'Dessert',
      'sweet': 'Dessert',
      'soup': 'Suppe',
      'salad': 'Salat',
      'side dish': 'Beilage',
      'drink': 'Getränk',
      'beverage': 'Getränk',
      'breakfast': 'Frühstück',
      'snack': 'Snack',
      'bread': 'Brot & Gebäck',
      'pastry': 'Brot & Gebäck'
    };
    
    return categoryMap[normalized] || category;
  }
} 