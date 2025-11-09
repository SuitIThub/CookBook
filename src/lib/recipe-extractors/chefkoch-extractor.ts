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
        // ISO 8601 duration format - handle both PT and P0DT formats
        if (value.startsWith('PT')) {
          // Standard format: PT30M, PT1H30M
          const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (match) {
            const hours = parseInt(match[1] || '0');
            const minutes = parseInt(match[2] || '0');
            console.log(`Parsed PT format "${value}": ${hours}h ${minutes}m = ${hours * 60 + minutes} total minutes`);
            return hours * 60 + minutes;
          }
        } else if (value.startsWith('P')) {
          // Extended format: P0DT0H20M (Chefkoch format)
          const match = value.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/);
          if (match) {
            const days = parseInt(match[1] || '0');
            const hours = parseInt(match[2] || '0');
            const minutes = parseInt(match[3] || '0');
            const totalMinutes = (days * 24 * 60) + (hours * 60) + minutes;
            console.log(`Parsed P0DT format "${value}": ${days}d ${hours}h ${minutes}m = ${totalMinutes} total minutes`);
            return totalMinutes;
          }
        }
        // Parse other time formats
        console.log(`Attempting to parse non-ISO format: "${value}"`);
        return this.parseTimeToMinutes(value);
      }
      
      if (typeof value === 'number') {
        console.log(`Using numeric value: ${value} minutes`);
        return value;
      }
      
      console.log(`Unable to parse time value: "${value}" (type: ${typeof value})`);
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

    // Extract time information from JSON-LD prepTime and cookTime only
    console.log('🕐 Extracting time information from Chefkoch JSON-LD...');
    console.log('🔍 Available JSON-LD time fields:', {
      prepTime: data.prepTime,
      cookTime: data.cookTime,
      totalTime: data.totalTime,
      performTime: data.performTime
    });
    
    const timeEntries = [];
    
    // Extract prepTime from JSON-LD and label it as "Vorbereitungszeit"
    const prepTime = getTimeValue(data.prepTime);
    if (prepTime > 0) {
      timeEntries.push({ label: 'Vorbereitungszeit', minutes: prepTime });
      console.log(`✅ Found prepTime in JSON-LD: ${prepTime} minutes → labeled as "Vorbereitungszeit"`);
    } else {
      console.log(`❌ No valid prepTime found. Raw value: "${data.prepTime}"`);
    }
    
    // Extract cookTime from JSON-LD and label it as "Zubereitungszeit"
    const cookTime = getTimeValue(data.cookTime);
    if (cookTime > 0) {
      timeEntries.push({ label: 'Zubereitungszeit', minutes: cookTime });
      console.log(`✅ Found cookTime in JSON-LD: ${cookTime} minutes → labeled as "Zubereitungszeit"`);
    } else {
      console.log(`❌ No valid cookTime found. Raw value: "${data.cookTime}"`);
    }
    
    if (timeEntries.length === 0) {
      console.log('⚠️ No prepTime or cookTime found in JSON-LD, timeEntries will be empty');
      console.log('🔍 Full JSON-LD data for debugging:', Object.keys(data));
    } else {
      console.log(`📊 Extracted ${timeEntries.length} time entries from JSON-LD:`, timeEntries.map(t => `${t.label}: ${t.minutes}min`));
    }

    // Extract keywords and category from JSON-LD and HTML
    const keywords = this.extractKeywordsFromJsonLd(data, html, data.name || 'Chefkoch Recipe', data.description);
    const category = this.extractCategoryFromJsonLd(data, html, data.name || 'Chefkoch Recipe', data.description);
    
    // Extract difficulty from HTML (Chefkoch doesn't have difficulty in JSON-LD)
    console.log('🎯 Difficulty not available in JSON-LD, extracting from HTML...');
    const difficulty = this.extractDifficultyFromHtml(html);

    return {
      title: data.name || 'Chefkoch Recipe',
      description: data.description || '', // Description is empty since URL is saved in sourceUrl
      servings,
      timeEntries: timeEntries,
      difficulty: difficulty,
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
    
    // Time extraction disabled for HTML fallback - only use JSON-LD times
    console.log('🕐 Time extraction from HTML disabled - Chefkoch times only from JSON-LD');
    const timeEntries: Array<{ label: string; minutes: number }> = [];
    console.log('⚠️ HTML fallback will have empty timeEntries - JSON-LD required for time data');
    
    // Keywords extraction disabled for HTML fallback - only use JSON-LD keywords
    console.log('🏷️ Keyword extraction from HTML disabled - Chefkoch keywords only from JSON-LD');
    const keywords: string[] = []; // No keyword extraction from HTML fallback
    console.log('📂 Category extraction from HTML disabled - Chefkoch categories only from JSON-LD');
    const category = undefined; // No category extraction from HTML fallback

    return {
      title,
      description: '', // Description is empty since URL is saved in sourceUrl
      servings,
      timeEntries: timeEntries,
      difficulty,
      keywords,
      category,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      sourceUrl: url
    };
  }
  
  private extractDifficultyFromHtml(html: string): 'leicht' | 'mittel' | 'schwer' | undefined {
    console.log('🎯 Extracting difficulty from Chefkoch HTML...');
    
    // Pattern 1: Look for Chefkoch-specific recipe-difficulty class
    const chefkochDifficultyPattern = /<span[^>]*class="[^"]*recipe-difficulty[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
    const chefkochMatch = html.match(chefkochDifficultyPattern);
    
    if (chefkochMatch) {
      console.log(`Found Chefkoch difficulty element: "${chefkochMatch[0]}"`);
      
      // Extract text after the <i> tag (the difficulty text is after the icon)
      const spanContent = chefkochMatch[1];
      console.log(`Span content: "${spanContent}"`);
      
      // Look for text after </i> tag or any text not inside tags
      const textAfterIcon = spanContent.match(/<\/i>\s*([^<]+)/i);
      if (textAfterIcon) {
        const difficultyText = this.cleanText(textAfterIcon[1]);
        console.log(`Found difficulty text after icon: "${difficultyText}"`);
        
        if (difficultyText && difficultyText.trim()) {
          const mappedDifficulty = this.mapChefkochDifficulty(difficultyText);
          console.log(`✅ Mapped Chefkoch difficulty: "${difficultyText}" → "${mappedDifficulty}"`);
          return mappedDifficulty;
        }
      }
      
      // Fallback: extract all text and remove icon content
      const allText = this.cleanText(spanContent.replace(/<[^>]*>/g, ''));
      console.log(`Fallback - all text from span: "${allText}"`);
      
      if (allText && allText.trim()) {
        const mappedDifficulty = this.mapChefkochDifficulty(allText);
        console.log(`✅ Mapped fallback difficulty: "${allText}" → "${mappedDifficulty}"`);
        return mappedDifficulty;
      }
    }
    
    // Pattern 2: Alternative specific patterns for recipe-difficulty
    const altDifficultyPatterns = [
      // Text directly after </i> tag
      /<span[^>]*class="[^"]*recipe-difficulty[^"]*"[^>]*>.*?<\/i>\s*([^<\s]+)[^<]*<\/span>/i,
      // Text at the end of span
      /<span[^>]*class="[^"]*recipe-difficulty[^"]*"[^>]*>.*?([a-zA-ZäöüÄÖÜß]+)\s*<\/span>/i,
      // Any word-like content in the span
      /<span[^>]*class="[^"]*recipe-difficulty[^"]*"[^>]*>[\s\S]*?([a-zA-ZäöüÄÖÜß]{4,})[\s\S]*?<\/span>/i
    ];
    
    for (const pattern of altDifficultyPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const difficultyText = this.cleanText(match[1]);
        console.log(`Found difficulty via alt pattern: "${difficultyText}"`);
        
        if (difficultyText && difficultyText.trim()) {
          const mappedDifficulty = this.mapChefkochDifficulty(difficultyText);
          console.log(`✅ Mapped alt difficulty: "${difficultyText}" → "${mappedDifficulty}"`);
          return mappedDifficulty;
        }
      }
    }
    
    // Pattern 3: Fallback - general difficulty patterns
    const generalDifficultyPatterns = [
      /(?:Schwierigkeitsgrad|Difficulty|Schwierigkeit):\s*([^<\n]+)/i,
      /<span[^>]*class[^>]*difficulty[^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class[^>]*difficulty[^>]*>([^<]+)<\/div>/i
    ];
    
    for (const pattern of generalDifficultyPatterns) {
      const match = html.match(pattern);
      if (match) {
        console.log(`Found general difficulty text: "${match[0]}"`);
        const difficultyText = match[1] || match[0];
        const mappedDifficulty = this.mapChefkochDifficulty(difficultyText);
        console.log(`✅ Mapped general difficulty: ${mappedDifficulty}`);
        return mappedDifficulty;
      }
    }
    
    // Pattern 4: Look for star ratings or visual difficulty indicators
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
    
    // Pattern 5: Check for common German difficulty terms in meta description or content
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
    
    console.log('🔄 No difficulty found, returning undefined');
    return undefined;
  }



  private extractKeywordsFromJsonLd(data: any, html: string, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from Chefkoch JSON-LD...');
    
    const keywords: Set<string> = new Set();
    
    // Extract from JSON-LD keywords field
    if (data.keywords) {
      if (Array.isArray(data.keywords)) {
        data.keywords.forEach((keyword: string) => {
          if (keyword && keyword.trim().length > 2) {
            const cleanedKeyword = keyword.trim();
            keywords.add(cleanedKeyword);
            console.log(`✅ Found keyword in JSON-LD: "${cleanedKeyword}"`);
          }
        });
      } else if (typeof data.keywords === 'string') {
        data.keywords.split(',').forEach((keyword: string) => {
          const cleaned = keyword.trim();
          if (cleaned.length > 2) {
            keywords.add(cleaned);
            console.log(`✅ Found keyword in JSON-LD (string): "${cleaned}"`);
          }
        });
      }
    }
    
    // Extract from JSON-LD recipeCategory field
    if (data.recipeCategory) {
      if (Array.isArray(data.recipeCategory)) {
        data.recipeCategory.forEach((cat: string) => {
          const cleanedCat = cat.trim();
          keywords.add(cleanedCat);
          console.log(`✅ Found keyword from recipeCategory: "${cleanedCat}"`);
        });
      } else if (typeof data.recipeCategory === 'string') {
        const cleanedCat = data.recipeCategory.trim();
        keywords.add(cleanedCat);
        console.log(`✅ Found keyword from recipeCategory (string): "${cleanedCat}"`);
      }
    }
    
    // Extract from JSON-LD recipeCuisine field
    if (data.recipeCuisine) {
      if (Array.isArray(data.recipeCuisine)) {
        data.recipeCuisine.forEach((cuisine: string) => {
          const cleanedCuisine = cuisine.trim();
          keywords.add(cleanedCuisine);
          console.log(`✅ Found keyword from recipeCuisine: "${cleanedCuisine}"`);
        });
      } else if (typeof data.recipeCuisine === 'string') {
        const cleanedCuisine = data.recipeCuisine.trim();
        keywords.add(cleanedCuisine);
        console.log(`✅ Found keyword from recipeCuisine (string): "${cleanedCuisine}"`);
      }
    }
    
    if (keywords.size === 0) {
      console.log('⚠️ No keywords found in JSON-LD (keywords, recipeCategory, or recipeCuisine)');
    }
    
    const result = Array.from(keywords).slice(0, 10);
    console.log(`✅ Extracted ${result.length} keywords from Chefkoch JSON-LD: ${result.join(', ')}`);
    return result;
  }

  private extractCategoryFromJsonLd(data: any, html: string, title: string, description?: string): string | undefined {
    console.log('📂 Extracting category from Chefkoch JSON-LD...');
    
    // Extract from JSON-LD recipeCategory field
    if (data.recipeCategory) {
      const category = Array.isArray(data.recipeCategory) 
        ? data.recipeCategory[0] 
        : data.recipeCategory;
      
      if (category && typeof category === 'string') {
        const normalized = this.normalizeCategory(category);
        console.log(`✅ Found category in JSON-LD recipeCategory: "${category}" → normalized: "${normalized}"`);
        return normalized;
      }
    }
    
    // Extract from JSON-LD recipeCuisine field
    if (data.recipeCuisine) {
      const cuisine = Array.isArray(data.recipeCuisine) 
        ? data.recipeCuisine[0] 
        : data.recipeCuisine;
      
      if (cuisine && typeof cuisine === 'string') {
        const normalized = this.normalizeCategory(cuisine);
        console.log(`✅ Found category in JSON-LD recipeCuisine: "${cuisine}" → normalized: "${normalized}"`);
        return normalized;
      }
    }
    
    // Extract from JSON-LD keywords field - look for category-like keywords
    if (data.keywords) {
      const keywords = Array.isArray(data.keywords) ? data.keywords : [data.keywords];
      
      for (const keyword of keywords) {
        if (typeof keyword === 'string') {
          const normalized = this.normalizeCategory(keyword);
          // Only use if it maps to a known category
          if (normalized && normalized !== keyword.toLowerCase()) {
            console.log(`✅ Found category in JSON-LD keywords: "${keyword}" → normalized: "${normalized}"`);
            return normalized;
          }
        }
      }
    }
    
    console.log('⚠️ No category found in JSON-LD (recipeCategory, recipeCuisine, or keywords)');
    return undefined;
  }

  private mapChefkochDifficulty(difficulty: any): 'leicht' | 'mittel' | 'schwer' | undefined {
    if (typeof difficulty === 'string') {
      const d = difficulty.toLowerCase().trim();
      
      // Chefkoch-specific difficulty terms
      if (d === 'simpel' || d === 'einfach' || d === 'leicht' || d === 'easy') {
        console.log(`Mapped "${difficulty}" to "leicht"`);
        return 'leicht';
      }
      
      if (d === 'normal' || d === 'mittel' || d === 'medium' || d === 'mittelschwer') {
        console.log(`Mapped "${difficulty}" to "mittel"`);
        return 'mittel';
      }
      
      if (d === 'schwer' || d === 'schwierig' || d === 'komplex' || d === 'hart' || d === 'hard' || d === 'difficult') {
        console.log(`Mapped "${difficulty}" to "schwer"`);
        return 'schwer';
      }
      
      // Fallback: check for partial matches
      if (d.includes('einfach') || d.includes('leicht') || d.includes('simpel') || d.includes('easy')) {
        console.log(`Partially mapped "${difficulty}" to "leicht"`);
        return 'leicht';
      }
      
      if (d.includes('schwer') || d.includes('schwierig') || d.includes('komplex') || d.includes('difficult')) {
        console.log(`Partially mapped "${difficulty}" to "schwer"`);
        return 'schwer';
      }
      
             console.log(`No specific mapping found for "${difficulty}", returning undefined"`);
     }
     
     return undefined;
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
    };
  }
  getDescription() {
    return 'Spezialisiert auf Chefkoch.de - Unterstützt strukturierte Rezeptdaten mit JSON-LD und HTML-Fallback, inklusive Zeit-, Schwierigkeits-, Keyword- und Kategorieextraktion';
  }
} 