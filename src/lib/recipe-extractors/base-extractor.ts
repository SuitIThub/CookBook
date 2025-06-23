import type { Recipe } from '../../types/recipe';

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
  sourceUrl: string;
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
   * Convert extracted data to our Recipe format
   */
  convertToRecipeFormat(data: ExtractedRecipeData): Partial<Recipe> {
    return {
      title: data.title,
      subtitle: data.subtitle,
      description: data.description,
      metadata: {
        servings: data.servings || 4,
        preparationTime: data.preparationTime || 30,
        cookingTime: data.cookingTime || 30,
        difficulty: data.difficulty || 'mittel'
      },
      ingredientGroups: [{
        id: this.generateId(),
        title: 'Zutaten',
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
    
    // Common German units (most specific first)
    const unitPatterns = [
      // Volume units
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Esslöffel|EL|Eßlöffel)\s+(.+)/i, unit: 'EL' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Teelöffel|TL)\s+(.+)/i, unit: 'TL' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Liter|l|L)\s+(.+)/i, unit: 'L' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Milliliter|ml|ML)\s+(.+)/i, unit: 'ml' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Tasse|Tassen)\s+(.+)/i, unit: 'Tasse' },
      
      // Weight units
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Kilogramm|kg|KG)\s+(.+)/i, unit: 'kg' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Gramm|g|G)\s+(.+)/i, unit: 'g' },
      
      // Package/piece units with explicit recognition
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Packung|Pck\.|Pck|Pack)\s+(.+)/i, unit: 'Pck.' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Dose|Dosen)\s+(.+)/i, unit: 'Dose' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Stück|St\.|St)\s*\(?\w*\)?\s+(.+)/i, unit: 'Stück' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Zehe|Zehen)\s*\(?\w*\)?\s+(.+)/i, unit: 'Zehe' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Bund)\s*\(?\w*\)?\s+(.+)/i, unit: 'Bund' },
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(Scheibe|Scheiben)\s*\(?\w*\)?\s+(.+)/i, unit: 'Scheibe' },
      
      // Special Chefkoch patterns with parentheses like "Zwiebel(n)"
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+([A-Za-zäöüÄÖÜß]+\([^)]*\))(?:\s+(.+))?/i, chefkoch: true },
      
      // Special patterns for "1/2", "½" etc.
      { pattern: /^(½|1\/2)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.5 },
      { pattern: /^(¼|1\/4)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.25 },
      { pattern: /^(¾|3\/4)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, amount: 0.75 },
      
      // Fractional amounts
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*\/\s*(\d+)\s*([A-Za-zäöüÄÖÜß]+)\s+(.+)/i, fraction: true },
      
      // Generic number + unit pattern (only for actual units)
      { pattern: /^(\d+(?:[,\.]\d+)?)\s*(ml|g|kg|l|EL|TL|Pck|Dose|Stück|Bund|Zehe|Scheibe)\b\s*(.+)/i, generic: true },
      
      // Just a number at the start (fallback)
      { pattern: /^(\d+(?:[,\.]\d+)?)\s+(.+)/i, unit: 'Stück' }
    ];

    for (const { pattern, unit, amount: fixedAmount, fraction, generic, chefkoch } of unitPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        console.log('Pattern matched:', pattern, 'Match groups:', match);
        
        let amount: number;
        let extractedUnit: string;
        let name: string;

        if (fixedAmount !== undefined) {
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
          // Standard pattern with known unit
          amount = parseFloat(match[1].replace(',', '.'));
          extractedUnit = unit || match[2] || 'Stück';
          name = match[3] || '';
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
} 