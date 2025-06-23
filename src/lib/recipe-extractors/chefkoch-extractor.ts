import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';

export class ChefkochExtractor extends BaseRecipeExtractor {
  readonly name = 'Chefkoch.de Extractor';
  readonly domains = ['chefkoch.de', 'www.chefkoch.de'];
  
  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    const html = await this.fetchHtml(url);
    
    // First try JSON-LD - but with improved parsing
    const jsonLdData = this.extractJsonLd(html);
    if (jsonLdData) {
      console.log('Found JSON-LD data:', jsonLdData);
      return this.parseJsonLdRecipe(jsonLdData, url, html);
    }
    
    // Fallback to HTML parsing with Chefkoch-specific selectors
    return this.parseChefkochHtml(html, url);
  }
  
  private extractJsonLd(html: string): any {
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let match;
    
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const recipes = Array.isArray(data) ? data : [data];
        
        for (const item of recipes) {
          if (item['@type'] === 'Recipe') {
            return item;
          }
        }
      } catch (e) {
        console.log('JSON-LD parsing failed:', e);
        continue;
      }
    }
    
    return null;
  }
  
  private parseJsonLdRecipe(data: any, url: string, html: string): ExtractedRecipeData {
    console.log('JSON-LD Recipe data:', data);
    
    const getTimeValue = (value: any): number => {
      if (!value) return 0;
      
      if (typeof value === 'string') {
        if (value.startsWith('PT')) {
          const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (match) {
            const hours = parseInt(match[1] || '0');
            const minutes = parseInt(match[2] || '0');
            return hours * 60 + minutes;
          }
        }
        return this.parseTimeToMinutes(value);
      }
      
      return 0;
    };

    // Extract ingredients from JSON-LD, but also check HTML if needed
    let ingredients = Array.isArray(data.recipeIngredient) 
      ? data.recipeIngredient 
      : [];
    
    console.log('JSON-LD ingredients:', ingredients);
    
    // Clean up ingredients - remove empty ones and trim whitespace
    ingredients = ingredients.filter((ing: any) => ing && ing.trim() !== '').map((ing: any) => ing.trim());
    
    // If JSON-LD ingredients are missing or insufficient, try HTML extraction
    if (!ingredients || ingredients.length === 0) {
      console.log('JSON-LD ingredients insufficient, trying HTML extraction');
      ingredients = this.extractIngredientsFromHtml(html);
    }

    // Extract instructions with better handling
    let instructions: string[] = [];
    
    if (data.recipeInstructions) {
      if (typeof data.recipeInstructions === 'string') {
        // Handle string instructions (Chefkoch format)
        const instructionText = this.cleanText(data.recipeInstructions);
        
        // Split by double newlines or numbered steps
        let steps = instructionText.split(/\n\s*\n/).filter(s => s.trim());
        if (steps.length <= 1) {
          // Try splitting by sentence patterns
          steps = instructionText.split(/\.\s+(?=[A-ZÄÖÜ])/).filter(s => s.trim());
          if (steps.length > 1) {
            // Add periods back to sentences (except the last one)
            steps = steps.map((step, index) => {
              const trimmed = step.trim();
              if (index < steps.length - 1 && !trimmed.endsWith('.') && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
                return trimmed + '.';
              }
              return trimmed;
            });
          }
        }
        
        instructions = steps.filter(s => s.length > 10);
      } else if (Array.isArray(data.recipeInstructions)) {
        instructions = data.recipeInstructions
          .map((inst: any) => {
            if (typeof inst === 'string') return inst;
            if (inst.text) return inst.text;
            if (inst.name) return inst.name;
            return '';
          })
          .filter(Boolean)
          .map((text: string) => this.cleanText(text));
      }
    }
    
    // If JSON-LD instructions are missing, try HTML extraction
    if (!instructions || instructions.length === 0) {
      console.log('JSON-LD instructions missing, trying HTML extraction');
      instructions = this.extractInstructionsFromHtml(html);
    }

    console.log('Final instructions:', instructions);

    let imageUrl: string | undefined;
    if (data.image) {
      if (typeof data.image === 'string') {
        imageUrl = data.image;
      } else if (Array.isArray(data.image)) {
        imageUrl = data.image[0]?.url || data.image[0];
      } else if (data.image.url) {
        imageUrl = data.image.url;
      }
    }
    
    // Extract servings from JSON-LD or HTML
    let servings = 4;
    if (data.recipeYield) {
      if (typeof data.recipeYield === 'string') {
        const servingMatch = data.recipeYield.match(/(\d+)/);
        if (servingMatch) {
          servings = parseInt(servingMatch[1]);
        }
      } else if (typeof data.recipeYield === 'number') {
        servings = data.recipeYield;
      }
    }

    return {
      title: data.name || 'Chefkoch Recipe',
      description: data.description || `Importiert von: ${url}`,
      servings,
      preparationTime: getTimeValue(data.prepTime),
      cookingTime: getTimeValue(data.cookTime),
      difficulty: this.mapChefkochDifficulty(data.difficulty),
      ingredients: ingredients.filter(Boolean),
      instructions: instructions.filter(Boolean),
      imageUrl,
      sourceUrl: url
    };
  }

  private extractIngredientsFromHtml(html: string): string[] {
    const ingredients: string[] = [];
    
    // Try multiple approaches to find ingredients
    
    // Approach 1: Look for ingredient table structure
    const tableRegex = /<table[^>]*class="[^"]*ingredients[^"]*"[^>]*>(.*?)<\/table>/gis;
    const tableMatch = tableRegex.exec(html);
    
    if (tableMatch) {
      // Extract from table rows
      const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
      let rowMatch;
      
      while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
        const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
        let cellMatch;
        let rowIngredients: string[] = [];
        
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          const cellContent = this.cleanText(cellMatch[1].replace(/<[^>]*>/g, ''));
          if (cellContent && cellContent.trim() !== '') {
            rowIngredients.push(cellContent);
          }
        }
        
        // Combine cells from the row (usually amount + ingredient)
        if (rowIngredients.length > 0) {
          ingredients.push(rowIngredients.join(' '));
        }
      }
    }
    
    // Approach 2: Look for ingredient list items
    if (ingredients.length === 0) {
      const listRegex = /<(?:ul|ol)[^>]*class="[^"]*ingredient[^"]*"[^>]*>(.*?)<\/(?:ul|ol)>/gis;
      const listMatch = listRegex.exec(html);
      
      if (listMatch) {
        const itemRegex = /<li[^>]*>(.*?)<\/li>/gis;
        let itemMatch;
        
        while ((itemMatch = itemRegex.exec(listMatch[1])) !== null) {
          const itemContent = this.cleanText(itemMatch[1].replace(/<[^>]*>/g, ''));
          if (itemContent && itemContent.trim() !== '') {
            ingredients.push(itemContent);
          }
        }
      }
    }
    
    // Approach 3: Look for any table with td elements (broader search)
    if (ingredients.length === 0) {
      const tdRegex = /<td[^>]*class="[^"]*td-left[^"]*"[^>]*>(.*?)<\/td>/gis;
      let tdMatch;
      
      while ((tdMatch = tdRegex.exec(html)) !== null) {
        const ingredient = this.cleanText(tdMatch[1].replace(/<[^>]*>/g, ''));
        if (ingredient && 
            ingredient.trim() !== '' && 
            !ingredient.toLowerCase().includes('zutat') && 
            !ingredient.toLowerCase().includes('menge') &&
            ingredients.length < 30) {
          ingredients.push(ingredient);
        }
      }
    }
    
    console.log('Extracted ingredients from HTML:', ingredients);
    return ingredients;
  }

  private extractInstructionsFromHtml(html: string): string[] {
    const instructions: string[] = [];
    
    // Try multiple approaches to find instructions
    
    // Approach 1: Look for instruction container
    const instructionRegex = /<div[^>]*class="[^"]*recipe-text[^"]*"[^>]*>(.*?)<\/div>/gis;
    const instructionMatch = instructionRegex.exec(html);
    
    if (instructionMatch) {
      let instructionText = this.cleanText(instructionMatch[1].replace(/<[^>]*>/g, ''));
      
      // Try to split into steps
      let steps = instructionText.split(/\d+\.\s+/).filter(s => s.trim());
      if (steps.length <= 1) {
        steps = instructionText.split(/\n\s*\n/).filter(s => s.trim());
      }
      if (steps.length <= 1) {
        steps = [instructionText];
      }
      
      instructions.push(...steps.map(s => this.cleanText(s)).filter(s => s.length > 10));
    }
    
    // Approach 2: Look for ordered list of instructions
    if (instructions.length === 0) {
      const listRegex = /<ol[^>]*class="[^"]*instruction[^"]*"[^>]*>(.*?)<\/ol>/gis;
      const listMatch = listRegex.exec(html);
      
      if (listMatch) {
        const itemRegex = /<li[^>]*>(.*?)<\/li>/gis;
        let itemMatch;
        
        while ((itemMatch = itemRegex.exec(listMatch[1])) !== null) {
          const itemContent = this.cleanText(itemMatch[1].replace(/<[^>]*>/g, ''));
          if (itemContent && itemContent.trim() !== '') {
            instructions.push(itemContent);
          }
        }
      }
    }
    
    console.log('Extracted instructions from HTML:', instructions);
    return instructions;
  }
  
  private parseChefkochHtml(html: string, url: string): ExtractedRecipeData {
    // Extract title
    const titleMatch = html.match(/<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                     html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Chefkoch Recipe';
    
    // Extract ingredients using the new method
    const ingredients = this.extractIngredientsFromHtml(html);
    
    // Extract instructions using the new method
    const instructions = this.extractInstructionsFromHtml(html);
    
    // Extract servings
    let servings = 4;
    const servingMatch = html.match(/(\d+)\s*(?:Portion|Person|Stück)/i);
    if (servingMatch) {
      servings = parseInt(servingMatch[1]);
    }
    
    // Extract times
    let prepTime = 0;
    let cookTime = 0;
    
    const timeRegex = /(\d+)\s*(?:Min|Minute)/gi;
    const timeMatches = html.match(timeRegex);
    if (timeMatches) {
      prepTime = this.parseTimeToMinutes(timeMatches[0]);
      if (timeMatches.length > 1) {
        cookTime = this.parseTimeToMinutes(timeMatches[1]);
      }
    }
    
    return {
      title,
      description: `Recipe imported from Chefkoch: ${url}`,
      servings,
      preparationTime: prepTime,
      cookingTime: cookTime,
      difficulty: 'mittel',
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      sourceUrl: url
    };
  }
  
  private mapChefkochDifficulty(difficulty: any): 'leicht' | 'mittel' | 'schwer' {
    if (typeof difficulty === 'string') {
      const d = difficulty.toLowerCase();
      if (d.includes('einfach') || d.includes('leicht')) return 'leicht';
      if (d.includes('schwer') || d.includes('schwierig')) return 'schwer';
    }
    return 'mittel';
  }
} 