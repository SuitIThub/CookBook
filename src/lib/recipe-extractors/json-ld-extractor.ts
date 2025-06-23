import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';

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
        // Handle ISO 8601 duration (PT30M)
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
    
    return {
      title: getStringValue(data.name) || 'Untitled Recipe',
      // Leave subtitle undefined unless it can be extracted from title
      description: getStringValue(data.description),
      servings: getNumberValue(data.recipeYield),
      preparationTime: getTimeValue(data.prepTime),
      cookingTime: getTimeValue(data.cookTime),
      difficulty: 'mittel',
      ingredients,
      instructions,
      imageUrl,
      sourceUrl: url
    };
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
    
    return {
      title,
      description: `Recipe imported from ${url}`,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      sourceUrl: url
    };
  }
} 