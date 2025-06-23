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
          // ISO 8601 duration format (e.g., PT30M, PT1H30M)
          const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (match) {
            const hours = parseInt(match[1] || '0');
            const minutes = parseInt(match[2] || '0');
            return hours * 60 + minutes;
          }
        }
        // Parse other time formats
        return this.parseTimeToMinutes(value);
      }
      
      if (typeof value === 'number') {
        return value;
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

    // Extract time information with better fallbacks
    console.log('🕐 Extracting time information from Chefkoch JSON-LD...');
    let prepTime = getTimeValue(data.prepTime);
    let cookTime = getTimeValue(data.cookTime);
    const totalTime = getTimeValue(data.totalTime);
    
    if (prepTime > 0) console.log(`✅ Found preparation time in JSON-LD: ${prepTime} minutes`);
    if (cookTime > 0) console.log(`✅ Found cooking time in JSON-LD: ${cookTime} minutes`);
    if (totalTime > 0) console.log(`📊 Found total time in JSON-LD: ${totalTime} minutes`);
    
    // If no specific prep/cook times, try to extract from total time
    if (!prepTime && !cookTime && totalTime > 0) {
      console.log(`⚡ Using total time (${totalTime} min) to estimate prep/cook times`);
      if (totalTime <= 30) {
        prepTime = totalTime;
        console.log(`📝 Short recipe: all ${totalTime} minutes assigned to prep time`);
      } else {
        prepTime = Math.floor(totalTime * 0.3); // 30% for prep
        cookTime = Math.floor(totalTime * 0.7); // 70% for cooking
        console.log(`📝 Split total time: ${prepTime} min prep + ${cookTime} min cook`);
      }
    } else if (prepTime > 0 && !cookTime && totalTime > prepTime) {
      // Calculate cook time from total - prep
      cookTime = totalTime - prepTime;
      console.log(`🧮 Calculated cooking time: ${totalTime} - ${prepTime} = ${cookTime} minutes`);
    }
    
    // Additional time sources to check
    if (!prepTime && !cookTime) {
      // Check for performTime (some sites use this)
      prepTime = getTimeValue(data.performTime);
      
      // Check for duration
      if (!prepTime) {
        prepTime = getTimeValue(data.duration);
      }
    }

    // Extract keywords and category from JSON-LD and HTML
    const keywords = this.extractKeywordsFromJsonLd(data, html, data.name || 'Chefkoch Recipe', data.description);
    const category = this.extractCategoryFromJsonLd(data, html, data.name || 'Chefkoch Recipe', data.description);

    return {
      title: data.name || 'Chefkoch Recipe',
      description: data.description || `Importiert von: ${url}`,
      servings,
      preparationTime: prepTime,
      cookingTime: cookTime,
      difficulty: this.mapChefkochDifficulty(data.difficulty),
      keywords,
      category,
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
    
    // Extract difficulty from HTML
    const difficulty = this.extractDifficultyFromHtml(html);
    
    // Extract times with improved patterns
    console.log('🕐 Extracting time information from Chefkoch HTML...');
    let prepTime = 0;
    let cookTime = 0;
    
    // Pattern 1: Specific time labels
    const prepTimePatterns = [
      /(?:Zubereitungszeit|Vorbereitung|Arbeitszeit):\s*\*?\*?(\d+)\s*(?:Min|Minuten)/i,
      /Arbeitszeit\s*:\s*(\d+)\s*(?:Min|Minuten)/i,
      /Prep\s*time\s*:\s*(\d+)\s*(?:Min|minutes)/i
    ];
    
    const cookTimePatterns = [
      /(?:Kochzeit|Backzeit|Garzeit|Bratzeit):\s*\*?\*?(\d+)\s*(?:Min|Minuten)/i,
      /(?:Koch-\/Backzeit|Ruhezeit):\s*(\d+)\s*(?:Min|Minuten)/i,
      /(?:Cook|Bake|Roast)\s*time\s*:\s*(\d+)\s*(?:Min|minutes)/i
    ];
    
    // Try to find prep time
    for (const pattern of prepTimePatterns) {
      const match = html.match(pattern);
      if (match) {
        prepTime = parseInt(match[1]);
        console.log(`✅ Found preparation time: ${prepTime} minutes`);
        break;
      }
    }
    
    // Try to find cook time
    for (const pattern of cookTimePatterns) {
      const match = html.match(pattern);
      if (match) {
        cookTime = parseInt(match[1]);
        console.log(`✅ Found cooking time: ${cookTime} minutes`);
        break;
      }
    }
    
    // Pattern 2: Look for Chefkoch recipe card time data
    if (!prepTime && !cookTime) {
      // Look for time in recipe metadata sections
      const metaTimePatterns = [
        /<div[^>]*class[^>]*time[^>]*>[\s\S]*?(\d+)\s*(?:Min|Minuten)/i,
        /<span[^>]*class[^>]*time[^>]*>[\s\S]*?(\d+)\s*(?:Min|Minuten)/i,
        /<td[^>]*>[\s\S]*?(\d+)\s*(?:Min|Minuten)[\s\S]*?<\/td>/i
      ];
      
      for (const pattern of metaTimePatterns) {
        const match = html.match(pattern);
        if (match) {
          console.log(`Found metadata time: ${match[0]}`);
          const time = parseInt(match[1]);
          if (!prepTime) {
            prepTime = time <= 30 ? time : Math.floor(time * 0.3);
          } else if (!cookTime) {
            cookTime = time > 30 ? Math.floor(time * 0.7) : 0;
          }
          break;
        }
      }
    }
    
    // Pattern 3: General time patterns as fallback
    if (!prepTime && !cookTime) {
      const generalTimeRegex = /(\d+)\s*(?:Min|Minute)/gi;
      const timeMatches = html.match(generalTimeRegex);
      if (timeMatches && timeMatches.length > 0) {
        console.log(`Found general time patterns: ${timeMatches.slice(0, 3).join(', ')}`);
        
        // Try to assign times intelligently
        const times = timeMatches.map(match => {
          const timeMatch = match.match(/(\d+)/);
          return timeMatch ? parseInt(timeMatch[1]) : 0;
        }).filter(t => t > 0 && t <= 480); // Filter reasonable cooking times (0-8 hours)
        
        if (times.length > 0) {
          if (times.length === 1) {
            const totalTime = times[0];
            if (totalTime <= 30) {
              prepTime = totalTime;
              console.log(`📝 Single time found: ${totalTime} minutes assigned to prep`);
            } else {
              prepTime = Math.floor(totalTime * 0.3);
              cookTime = Math.floor(totalTime * 0.7);
              console.log(`📝 Single time split: ${prepTime} min prep + ${cookTime} min cook`);
            }
          } else {
            // Multiple times found - assign first as prep, second as cook
            prepTime = times[0];
            cookTime = times[1];
            console.log(`📝 Multiple times found: ${prepTime} min prep, ${cookTime} min cook`);
          }
        }
      }
    }
    
    // Pattern 4: Look in meta description
    if (!prepTime && !cookTime) {
      const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
      if (metaDescMatch) {
        const metaTimeMatch = metaDescMatch[1].match(/(\d+)\s*(?:Min|Minuten)/i);
        if (metaTimeMatch) {
          console.log(`Found time in meta description: ${metaTimeMatch[0]}`);
          const time = parseInt(metaTimeMatch[1]);
          prepTime = time <= 30 ? time : Math.floor(time * 0.3);
          if (time > 30) {
            cookTime = Math.floor(time * 0.7);
          }
        }
      }
    }
    
    // Extract keywords and category
    const keywords = this.extractKeywords(html, title, `Recipe imported from Chefkoch: ${url}`);
    const category = this.extractCategory(html, title, `Recipe imported from Chefkoch: ${url}`);

    return {
      title,
      description: `Recipe imported from Chefkoch: ${url}`,
      servings,
      preparationTime: prepTime,
      cookingTime: cookTime,
      difficulty,
      keywords,
      category,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      sourceUrl: url
    };
  }
  
  private extractDifficultyFromHtml(html: string): 'leicht' | 'mittel' | 'schwer' {
    console.log('🎯 Extracting difficulty from Chefkoch HTML...');
    
    // Pattern 1: Look for specific difficulty indicators in recipe metadata
    const difficultyPatterns = [
      /(?:Schwierigkeitsgrad|Difficulty|Schwierigkeit):\s*([^<\n]+)/i,
      /<span[^>]*class[^>]*difficulty[^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class[^>]*difficulty[^>]*>([^<]+)<\/div>/i,
      /(?:simpel|einfach|leicht|mittel|schwer|schwierig)/gi
    ];
    
    for (const pattern of difficultyPatterns) {
      const match = html.match(pattern);
      if (match) {
        console.log(`Found difficulty text: "${match[0]}"`);
        const difficultyText = match[1] || match[0];
        const mappedDifficulty = this.mapChefkochDifficulty(difficultyText);
        console.log(`✅ Mapped difficulty: ${mappedDifficulty}`);
        return mappedDifficulty;
      }
    }
    
    // Pattern 2: Look for star ratings or visual difficulty indicators
    const starPatterns = [
      /<i[^>]*class[^>]*star[^>]*>/gi,
      /★+/g,
      /⭐+/g
    ];
    
    for (const pattern of starPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        const starCount = matches.length;
        console.log(`Found ${starCount} star indicators`);
        if (starCount <= 2) return 'leicht';
        if (starCount >= 4) return 'schwer';
        return 'mittel';
      }
    }
    
    // Pattern 3: Check for common German difficulty terms in meta description or content
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
    if (metaDescMatch) {
      const metaContent = metaDescMatch[1].toLowerCase();
      if (metaContent.includes('einfach') || metaContent.includes('simpel') || metaContent.includes('leicht')) {
        console.log('✅ Found "leicht" in meta description');
        return 'leicht';
      }
      if (metaContent.includes('schwer') || metaContent.includes('schwierig') || metaContent.includes('komplex')) {
        console.log('✅ Found "schwer" in meta description');
        return 'schwer';
      }
    }
    
    console.log('🔄 No difficulty found, defaulting to "mittel"');
    return 'mittel';
  }

  private extractKeywordsFromJsonLd(data: any, html: string, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from Chefkoch JSON-LD...');
    
    const keywords: Set<string> = new Set();
    
    // Extract from JSON-LD keywords if available
    if (data.keywords) {
      if (Array.isArray(data.keywords)) {
        data.keywords.forEach((keyword: string) => {
          if (keyword && keyword.trim().length > 2) {
            keywords.add(keyword.trim());
          }
        });
      } else if (typeof data.keywords === 'string') {
        data.keywords.split(',').forEach((keyword: string) => {
          const cleaned = keyword.trim();
          if (cleaned.length > 2) keywords.add(cleaned);
        });
      }
    }
    
    // Extract from recipeCategory in JSON-LD
    if (data.recipeCategory) {
      if (Array.isArray(data.recipeCategory)) {
        data.recipeCategory.forEach((cat: string) => keywords.add(cat.trim()));
      } else if (typeof data.recipeCategory === 'string') {
        keywords.add(data.recipeCategory.trim());
      }
    }
    
    // Extract from recipeCuisine in JSON-LD
    if (data.recipeCuisine) {
      if (Array.isArray(data.recipeCuisine)) {
        data.recipeCuisine.forEach((cuisine: string) => keywords.add(cuisine.trim()));
      } else if (typeof data.recipeCuisine === 'string') {
        keywords.add(data.recipeCuisine.trim());
      }
    }
    
    // Fallback to base extraction method
    const baseKeywords = this.extractKeywords(html, title, description);
    baseKeywords.forEach(keyword => keywords.add(keyword));
    
    const result = Array.from(keywords).slice(0, 10);
    console.log(`✅ Extracted ${result.length} keywords from Chefkoch: ${result.join(', ')}`);
    return result;
  }

  private extractCategoryFromJsonLd(data: any, html: string, title: string, description?: string): string | undefined {
    console.log('📂 Extracting category from Chefkoch JSON-LD...');
    
    // Try JSON-LD recipeCategory first
    if (data.recipeCategory) {
      const category = Array.isArray(data.recipeCategory) 
        ? data.recipeCategory[0] 
        : data.recipeCategory;
      
      if (category && typeof category === 'string') {
        const normalized = this.normalizeCategory(category);
        console.log(`✅ Found category in JSON-LD: ${normalized}`);
        return normalized;
      }
    }
    
    // Fallback to base extraction method
    return this.extractCategory(html, title, description);
  }

  private mapChefkochDifficulty(difficulty: any): 'leicht' | 'mittel' | 'schwer' {
    if (typeof difficulty === 'string') {
      const d = difficulty.toLowerCase();
      if (d.includes('einfach') || d.includes('leicht') || d.includes('simpel')) return 'leicht';
      if (d.includes('schwer') || d.includes('schwierig') || d.includes('komplex')) return 'schwer';
    }
    return 'mittel';
  }
  
  getCapabilities() {
    return {
      supportsIngredientGroups: false,
      supportsPreparationGroups: false,
      supportsImages: true,
      supportsNutrition: false,
      supportsMetadata: true,
      supportsTimeExtraction: true,
      supportsDifficultyExtraction: true,
      supportsKeywordExtraction: true,
      supportsCategoryExtraction: true,
      description: 'Spezialisiert auf Chefkoch.de - Unterstützt strukturierte Rezeptdaten mit JSON-LD und HTML-Fallback, inklusive Zeit-, Schwierigkeits-, Keyword- und Kategorieextraktion'
    };
  }
} 