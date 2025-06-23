import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';
import type { NutritionData } from '../../types/recipe';

export class JsonLdRecipeExtractor extends BaseRecipeExtractor {
  readonly name = 'JSON-LD Generic Extractor';
  readonly domains = ['*']; // Can be used as fallback for any domain
  
  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    const html = await this.fetchHtml(url);
    
    // Try to find JSON-LD structured data
    const jsonLdData = this.extractJsonLd(html);
    
    if (jsonLdData) {
      return this.parseJsonLdRecipe(jsonLdData, url);
    }
    
    // Fallback to basic HTML parsing
    return this.parseHtmlRecipe(html, url);
  }
  
  private extractJsonLd(html: string): any {
    // Look for JSON-LD script tags
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let match;
    
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        
        // Handle both single objects and arrays
        const recipes = Array.isArray(data) ? data : [data];
        
        for (const item of recipes) {
          if (this.isRecipeData(item)) {
            return item;
          }
          
          // Check if it's a graph structure
          if (item['@graph']) {
            const recipe = item['@graph'].find((node: any) => this.isRecipeData(node));
            if (recipe) return recipe;
          }
        }
      } catch (e) {
        // Continue to next script tag
        continue;
      }
    }
    
    return null;
  }
  
  private isRecipeData(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    
    const type = data['@type'];
    return type === 'Recipe' || 
           (Array.isArray(type) && type.includes('Recipe')) ||
           type === 'recipe';
  }
  
  private parseJsonLdRecipe(data: any, url: string): ExtractedRecipeData {
    const getArrayValue = (value: any): string[] => {
      if (Array.isArray(value)) {
        return value.map(v => typeof v === 'string' ? v : v.text || v.name || '').filter(Boolean);
      }
      return typeof value === 'string' ? [value] : [];
    };
    
    const getStringValue = (value: any): string => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        return value.text || value.name || value['@value'] || '';
      }
      return '';
    };
    
    const getNumberValue = (value: any): number | undefined => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? undefined : num;
      }
      return undefined;
    };
    
    const getTimeValue = (value: any): number => {
      if (!value) return 0;
      
      if (typeof value === 'string') {
        // Handle ISO 8601 duration (PT30M, PT1H30M)
        if (value.startsWith('PT')) {
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
    
    // Extract ingredients
    const ingredients: string[] = [];
    if (data.recipeIngredient) {
      ingredients.push(...getArrayValue(data.recipeIngredient));
    }
    
    // Extract instructions
    const instructions: string[] = [];
    if (data.recipeInstructions) {
      const instructionArray = Array.isArray(data.recipeInstructions) 
        ? data.recipeInstructions 
        : [data.recipeInstructions];
      
      for (const instruction of instructionArray) {
        if (typeof instruction === 'string') {
          instructions.push(instruction);
        } else if (instruction.text) {
          instructions.push(instruction.text);
        } else if (instruction.name) {
          instructions.push(instruction.name);
        }
      }
    }
    
        // Extract time information with better fallbacks
    console.log('🕐 Extracting time information from JSON-LD (Generic)...');
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
    
    // Extract nutrition information
    const nutrition = this.extractNutritionFromJsonLd(data);
    
    // Extract image URL
    let imageUrl: string | undefined;
    if (data.image) {
      if (typeof data.image === 'string') {
        imageUrl = data.image;
      } else if (Array.isArray(data.image) && data.image.length > 0) {
        imageUrl = typeof data.image[0] === 'string' ? data.image[0] : data.image[0].url;
      } else if (data.image.url) {
        imageUrl = data.image.url;
      }
    }

    // Extract keywords and category from JSON-LD
    const keywords = this.extractKeywordsFromJsonLd(data, getStringValue(data.name) || 'Untitled Recipe', getStringValue(data.description));
    const category = this.extractCategoryFromJsonLd(data, getStringValue(data.name) || 'Untitled Recipe', getStringValue(data.description));

    return {
      title: getStringValue(data.name) || 'Untitled Recipe',
      // Leave subtitle undefined unless it can be extracted from title
      description: getStringValue(data.description),
      servings: getNumberValue(data.recipeYield),
      preparationTime: prepTime,
      cookingTime: cookTime,
      difficulty: 'mittel',
      keywords,
      category,
      ingredients,
      instructions,
      imageUrl,
      nutrition,
      sourceUrl: url
    };
  }
  
  private extractNutritionFromJsonLd(data: any): NutritionData | undefined {
    if (!data || !data.nutrition) {
      console.log('No nutrition data in JSON-LD');
      return undefined;
    }

    const result: NutritionData = {};
    const nutrition = data.nutrition;
    
    console.log('Extracting nutrition from JSON-LD (Generic):', nutrition);

    // Handle different JSON-LD nutrition formats
    if (typeof nutrition === 'object') {
      // Handle single NutritionInformation object
      if (nutrition['@type'] === 'NutritionInformation' || !nutrition['@type']) {
        // Extract calories
        if (nutrition.calories) {
          const calories = this.parseNutritionValue(nutrition.calories);
          if (calories) result.calories = calories;
        }
        
        // Extract protein
        if (nutrition.proteinContent) {
          const protein = this.parseNutritionValue(nutrition.proteinContent);
          if (protein) result.protein = protein;
        }
        
        // Extract fat
        if (nutrition.fatContent) {
          const fat = this.parseNutritionValue(nutrition.fatContent);
          if (fat) result.fat = fat;
        }
        
        // Extract carbohydrates
        if (nutrition.carbohydrateContent) {
          const carbs = this.parseNutritionValue(nutrition.carbohydrateContent);
          if (carbs) result.carbohydrates = carbs;
        }
      }
      
      // Handle array of nutrition information
      if (Array.isArray(nutrition)) {
        for (const item of nutrition) {
          if (item['@type'] === 'NutritionInformation') {
            const nutritionData = this.extractNutritionFromJsonLd({ nutrition: item });
            if (nutritionData) {
              Object.assign(result, nutritionData);
            }
          }
        }
      }
    }

    // Return nutrition data only if we found at least one value
    if (result.calories || result.protein || result.fat || result.carbohydrates) {
      console.log('Extracted nutrition from JSON-LD (Generic):', result);
      return result;
    }

    console.log('No valid nutrition data found in JSON-LD');
    return undefined;
  }

  private parseNutritionValue(value: any): number | undefined {
    if (typeof value === 'number') {
      return value;
    }
    
    if (typeof value === 'string') {
      // Handle formats like "391 kcal", "5g", "24 g"
      const match = value.match(/(\d+(?:[,\.]\d+)?)/);
      if (match) {
        return parseFloat(match[1].replace(',', '.'));
      }
    }
    
    // Handle object format with value property
    if (value && typeof value === 'object' && value.value) {
      return this.parseNutritionValue(value.value);
    }
    
    return undefined;
  }

  private extractKeywordsFromJsonLd(data: any, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from Generic JSON-LD...');
    
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
    const baseKeywords = this.extractKeywords('', title, description);
    baseKeywords.forEach(keyword => keywords.add(keyword));
    
    const result = Array.from(keywords).slice(0, 10);
    console.log(`✅ Extracted ${result.length} keywords from Generic JSON-LD: ${result.join(', ')}`);
    return result;
  }

  private extractCategoryFromJsonLd(data: any, title: string, description?: string): string | undefined {
    console.log('📂 Extracting category from Generic JSON-LD...');
    
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
    return this.extractCategory('', title, description);
  }

  private parseHtmlRecipe(html: string, url: string): ExtractedRecipeData {
    // Basic HTML fallback parsing
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Imported Recipe';
    
    // Try to find common recipe selectors
    const ingredients: string[] = [];
    const instructions: string[] = [];
    
    // Look for common ingredient selectors
    const ingredientPatterns = [
      /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>([^<]+)<\/li>/gi,
      /<div[^>]*class="[^"]*ingredient[^"]*"[^>]*>([^<]+)<\/div>/gi,
    ];
    
    for (const pattern of ingredientPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const ingredient = this.cleanText(match[1].replace(/<[^>]*>/g, ''));
        if (ingredient && ingredients.length < 20) {
          ingredients.push(ingredient);
        }
      }
    }
    
    // Look for common instruction selectors
    const instructionPatterns = [
      /<li[^>]*class="[^"]*instruction[^"]*"[^>]*>([^<]+)<\/li>/gi,
      /<div[^>]*class="[^"]*step[^"]*"[^>]*>([^<]+)<\/div>/gi,
      /<p[^>]*class="[^"]*direction[^"]*"[^>]*>([^<]+)<\/p>/gi,
    ];
    
    for (const pattern of instructionPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const instruction = this.cleanText(match[1].replace(/<[^>]*>/g, ''));
        if (instruction && instructions.length < 20) {
          instructions.push(instruction);
        }
      }
    }

    // Extract keywords and category from HTML
    const keywords = this.extractKeywords(html, title, `Recipe imported from ${url}`);
    const category = this.extractCategory(html, title, `Recipe imported from ${url}`);
    
    return {
      title,
      description: `Recipe imported from ${url}`,
      keywords,
      category,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      sourceUrl: url
    };
  }
  
  getCapabilities() {
    return {
      supportsIngredientGroups: false,
      supportsPreparationGroups: false,
      supportsImages: true,
      supportsNutrition: 'experimental' as const, // Experimentelle Unterstützung - nicht garantiert
      supportsMetadata: true,
      supportsTimeExtraction: 'experimental' as const, // Experimentelle Unterstützung - nicht garantiert
      supportsKeywordExtraction: 'experimental' as const,
      supportsCategoryExtraction: 'experimental' as const,
      description: 'Allgemeiner JSON-LD Extraktor - Funktioniert als Fallback für die meisten Websites mit strukturierten Daten. Nährwerte, Zeit-, Keyword- und Kategorieextraktion experimentell.'
    };
  }
} 