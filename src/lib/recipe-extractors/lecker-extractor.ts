import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';

export class LeckerExtractor extends BaseRecipeExtractor {
  readonly name = 'Lecker.de Extractor';
  readonly domains = ['lecker.de', 'www.lecker.de'];
  
  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    console.log(`==== LECKER EXTRACTOR STARTING ====`);
    console.log(`Extracting recipe from: ${url}`);
    
    const html = await this.fetchHtml(url);
    console.log(`HTML fetched, length: ${html.length} characters`);
    
    // First try JSON-LD structured data
    const jsonLdData = this.extractJsonLd(html);
    console.log(`JSON-LD found: ${jsonLdData ? 'YES' : 'NO'}`);
    if (jsonLdData) {
      console.log(`Using JSON-LD extraction path`);
      const result = this.parseJsonLdRecipe(jsonLdData, url);
      console.log(`JSON-LD result imageUrl: ${result.imageUrl}`);
      return result;
    }
    
    // Fallback to HTML parsing with Lecker.de-specific selectors
    console.log(`Using HTML parsing fallback`);
    const result = this.parseLeckerHtml(html, url);
    console.log(`HTML parsing result imageUrl: ${result.imageUrl}`);
    return result;
  }
  
  private extractJsonLd(html: string): any {
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let match;
    
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
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
        continue;
      }
    }
    
    return null;
  }
  
  private isRecipeData(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    
    const type = data['@type'];
    return type === 'Recipe' || 
           (Array.isArray(type) && type.includes('Recipe'));
  }
  
  private parseJsonLdRecipe(data: any, url: string): ExtractedRecipeData {
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
    
    const ingredients = Array.isArray(data.recipeIngredient) 
      ? data.recipeIngredient 
      : [];
    
    const instructions = Array.isArray(data.recipeInstructions)
      ? data.recipeInstructions.map((inst: any) => 
          typeof inst === 'string' ? inst : inst.text || inst.name || ''
        ).filter(Boolean)
      : [];
    
    let imageUrl: string | undefined;
    console.log(`JSON-LD image data:`, data.image);
    
    if (data.image) {
      if (typeof data.image === 'string') {
        imageUrl = data.image;
        console.log(`Found string image: ${imageUrl}`);
      } else if (Array.isArray(data.image) && data.image.length > 0) {
        console.log(`Found image array with ${data.image.length} items`);
        // Try to get the highest quality image from the array
        for (const img of data.image) {
          console.log(`Processing image item:`, img);
          if (typeof img === 'string') {
            imageUrl = img;
            console.log(`Used string from array: ${imageUrl}`);
            break;
          } else if (img && typeof img === 'object') {
            // Look for the largest image or best quality
            if (img.url) {
              imageUrl = img.url;
              console.log(`Used url property: ${imageUrl}`);
              // If we find a high-res image, prefer it
              if (img.width && img.width >= 400) break;
            } else if (img.contentUrl) {
              imageUrl = img.contentUrl;
              console.log(`Used contentUrl property: ${imageUrl}`);
            }
          }
        }
      } else if (data.image.url) {
        imageUrl = data.image.url;
        console.log(`Found object with url property: ${imageUrl}`);
      } else if (data.image.contentUrl) {
        imageUrl = data.image.contentUrl;
        console.log(`Found object with contentUrl property: ${imageUrl}`);
      }
      
      // Clean up the image URL - but keep Lecker.de query parameters
      if (imageUrl) {
        console.log(`Original image URL: ${imageUrl}`);
        
        // Don't remove query parameters for lecker.de images as they might be needed
        if (!imageUrl.includes('images.lecker.de')) {
          imageUrl = imageUrl.split('?')[0];
          console.log(`Cleaned URL (removed query params): ${imageUrl}`);
        }
        
        // Ensure absolute URL
        if (!imageUrl.startsWith('http')) {
          if (imageUrl.startsWith('//')) {
            imageUrl = `https:${imageUrl}`;
          } else if (imageUrl.startsWith('/')) {
            imageUrl = `https://www.lecker.de${imageUrl}`;
          }
          console.log(`Made absolute URL: ${imageUrl}`);
        }
      }
    } else {
      console.log(`No image data found in JSON-LD`);
    }
    
    // Extract title and subtitle from recipe name and description
    const { title, subtitle } = this.extractTitleAndSubtitle(data.name || 'Lecker Recipe', data.description);

    return {
      title,
      subtitle,
      description: data.description,
      servings: this.parseServings(data.recipeYield),
      preparationTime: getTimeValue(data.prepTime || data.totalTime),
      cookingTime: getTimeValue(data.cookTime),
      difficulty: this.mapLeckerDifficulty(data.difficulty),
      ingredients,
      instructions,
      imageUrl,
      sourceUrl: url
    };
  }
  
  private parseLeckerHtml(html: string, url: string): ExtractedRecipeData {
    // Extract title - Lecker uses h1 for recipe titles
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const rawTitle = titleMatch ? this.cleanText(titleMatch[1]) : 'Lecker Recipe';
    
    // Extract description from meta or page content
    let description = '';
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
    if (metaDescMatch) {
      description = this.cleanText(metaDescMatch[1]);
    }

    // Extract title and subtitle
    const { title, subtitle } = this.extractTitleAndSubtitle(rawTitle, description);
    
    // Extract ingredients - Lecker has specific structure
    const ingredients: string[] = [];
    
    // Look for ingredient list patterns specific to Lecker.de
    const ingredientPatterns = [
      // Pattern for ingredients with quantities
      /<li[^>]*>\s*(\d+(?:[,\.]\d+)?)\s*([^<]*?)\s*([^<]+?)\s*<\/li>/gi,
      // Alternative pattern for simple ingredients
      /<li[^>]*>([^<]+)<\/li>/gi
    ];
    
    // Try to extract ingredients from Zutaten section
    const zutattenSection = html.match(/## Zutaten(.*?)## Zubereitung/is);
    if (zutattenSection) {
      const zutattenHtml = zutattenSection[1];
      
      // Extract individual ingredients
      const ingredientRegex = /\s*(\d+(?:[,\.]\d+)?|1 Pck\.|1 EL|1 TL)?\s*([^0-9\n]+)/g;
      let match;
      
      while ((match = ingredientRegex.exec(zutattenHtml)) !== null) {
        const ingredient = this.cleanText(match[0].replace(/^\s*\d+\s*/, ''));
        if (ingredient && ingredient.length > 2 && !ingredient.match(/^(Stück|Fehlt|Amazon)/) && ingredients.length < 20) {
          ingredients.push(ingredient);
        }
      }
    }
    
    // If no ingredients found, try alternative parsing
    if (ingredients.length === 0) {
      const lines = html.split('\n');
      let inIngredients = false;
      
      for (const line of lines) {
        const cleanLine = this.cleanText(line);
        
        if (cleanLine.includes('Zutaten') || cleanLine.includes('## Zutaten')) {
          inIngredients = true;
          continue;
        }
        
        if (inIngredients && (cleanLine.includes('Zubereitung') || cleanLine.includes('## Zubereitung'))) {
          break;
        }
        
        if (inIngredients && cleanLine && cleanLine.length > 3 && !cleanLine.includes('Stück')) {
          // Try to extract ingredient info
          if (cleanLine.match(/\d+/) || cleanLine.includes('EL') || cleanLine.includes('TL') || cleanLine.includes('Pck')) {
            ingredients.push(cleanLine);
          }
        }
      }
    }
    
    // Extract instructions
    const instructions: string[] = [];
    
    // Look for numbered instructions in Zubereitung section
    const zubereitungSection = html.match(/## Zubereitung(.*?)(?:## |$)/is);
    if (zubereitungSection) {
      const zubereitungHtml = zubereitungSection[1];
      
      // Split by numbered steps
      const steps = zubereitungHtml.split(/\n\d+\n/).filter(step => step.trim());
      
      for (const step of steps) {
        const cleanStep = this.cleanText(step.replace(/<[^>]*>/g, ''));
        if (cleanStep && cleanStep.length > 20) {
          instructions.push(cleanStep);
        }
      }
    }
    
    // Extract servings
    let servings = 12; // Default for muffins based on the example
    const servingMatch = html.match(/(\d+)\s*Stück/i) || 
                        html.match(/für\s*(\d+)\s*Personen/i) ||
                        html.match(/(\d+)\s*Portionen/i);
    if (servingMatch) {
      servings = parseInt(servingMatch[1]);
    }
    
    // Extract preparation time
    let prepTime = 30; // Default
    const timeMatch = html.match(/Zubereitungszeit:\s*\*\*(\d+)\s*Min/i) ||
                     html.match(/(\d+)\s*Min\./i);
    if (timeMatch) {
      prepTime = parseInt(timeMatch[1]);
    }
    
    // Extract difficulty
    let difficulty: 'leicht' | 'mittel' | 'schwer' = 'mittel';
    if (html.includes('ganz einfach') || html.includes('einfach')) {
      difficulty = 'leicht';
    } else if (html.includes('schwer') || html.includes('schwierig')) {
      difficulty = 'schwer';
    }
    
    // Extract image URL - try multiple patterns for Lecker.de
    console.log('Extracting image from Lecker.de HTML...');
    
    // Pattern 1: Pinterest sharing link (often contains the main image URL)
    const pinterestMatch = html.match(/data-href="[^"]*media=([^"&]+)"/i) ||
                          html.match(/pinterest\.com[^"]*media=([^"&]+)/i) ||
                          html.match(/media=([^"&]+images\.lecker\.de[^"&]*)/i);
    
    // Pattern 2: Ultra-simple - just find any lecker.de image URL anywhere
    const ultraSimpleMatch = html.match(/(https:\/\/images\.lecker\.de\/[^"'\s>&]+\.(?:jpg|jpeg|png|webp)[^"'\s>&]*)/i);
    
    // Pattern 3: Lecker.de images in any attribute
    const anyAttributeMatch = html.match(/["'](https:\/\/images\.lecker\.de\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*?)["']/i);
    
    // Pattern 4: Simple and direct - any images.lecker.de URL
    const simpleImageMatch = html.match(/src="(https:\/\/images\.lecker\.de[^"]+)"/i);
    
    // Pattern 5: Look for images with "Rezept" in alt text
    const recipeAltMatch = html.match(/<img[^>]+alt="[^"]*[Rr]ezept[^"]*"[^>]+src="([^"]+)"/i) ||
                          html.match(/<img[^>]+src="([^"]+)"[^>]+alt="[^"]*[Rr]ezept[^"]*"/i);
    
    // Pattern 6: Look for high resolution images (width > 1000)
    const highResMatch = html.match(/<img[^>]+src="([^"]+)"[^>]+width="[^"]*[1-9][0-9]{3,}"/i);
    
    // Pattern 7: Images within picture elements with specific structure
    const pictureMatch = html.match(/<picture[^>]*>[\s\S]*?<img[^>]+src="([^"]+images\.lecker\.de[^"]+)"/i);
    
    // Pattern 8: Look for srcset attributes
    const srcsetMatch = html.match(/srcset="[^"]*?(https:\/\/images\.lecker\.de\/[^"',\s]+\.(?:jpg|jpeg|png|webp)[^"',\s]*)/i);
    
    // Pattern 9: Meta property images (og:image, etc.)
    const metaImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    
    // Pattern 10: JSON-LD image data
    const jsonImageMatch = html.match(/"image":\s*["']([^"']+images\.lecker\.de[^"']+)["']/i);
    
    // Try patterns in order of preference and log debug info
    console.log('Checking Pinterest match:', pinterestMatch?.[1]);
    console.log('Checking ultraSimple match:', ultraSimpleMatch?.[1]);
    console.log('Checking anyAttribute match:', anyAttributeMatch?.[1]);
    console.log('Checking simpleImage match:', simpleImageMatch?.[1]);
    console.log('Checking recipeAlt match:', recipeAltMatch?.[1]);
    console.log('Checking highRes match:', highResMatch?.[1]);
    console.log('Checking picture match:', pictureMatch?.[1]);
    console.log('Checking srcset match:', srcsetMatch?.[1]);
    console.log('Checking metaImage match:', metaImageMatch?.[1]);
    console.log('Checking jsonImage match:', jsonImageMatch?.[1]);
    
    let imageUrl: string | undefined;
    
    if (pinterestMatch?.[1]) {
      imageUrl = decodeURIComponent(pinterestMatch[1]);
      console.log('Used Pinterest match');
    } else if (ultraSimpleMatch?.[1]) {
      imageUrl = ultraSimpleMatch[1];
      console.log('Used ultraSimple match');
    } else if (anyAttributeMatch?.[1]) {
      imageUrl = anyAttributeMatch[1];
      console.log('Used anyAttribute match');
    } else if (simpleImageMatch?.[1]) {
      imageUrl = simpleImageMatch[1];
      console.log('Used simpleImage match');
    } else if (recipeAltMatch?.[1]) {
      imageUrl = recipeAltMatch[1];
      console.log('Used recipeAlt match');
    } else if (highResMatch?.[1]) {
      imageUrl = highResMatch[1];
      console.log('Used highRes match');
    } else if (pictureMatch?.[1]) {
      imageUrl = pictureMatch[1];
      console.log('Used picture match');
    } else if (srcsetMatch?.[1]) {
      imageUrl = srcsetMatch[1];
      console.log('Used srcset match');
    } else if (metaImageMatch?.[1]) {
      imageUrl = metaImageMatch[1];
      console.log('Used metaImage match');
    } else if (jsonImageMatch?.[1]) {
      imageUrl = jsonImageMatch[1];
      console.log('Used jsonImage match');
    }
    
    if (imageUrl) {
      console.log(`Raw extracted image URL: ${imageUrl}`);
      
      // Clean up and validate the URL
      // Don't remove query parameters for lecker.de images as they might be needed
      if (!imageUrl.includes('images.lecker.de')) {
        imageUrl = imageUrl.split('?')[0];
      }
      
      // Ensure absolute URL
      if (!imageUrl.startsWith('http')) {
        if (imageUrl.startsWith('//')) {
          imageUrl = `https:${imageUrl}`;
        } else if (imageUrl.startsWith('/')) {
          imageUrl = `https://www.lecker.de${imageUrl}`;
        } else {
          imageUrl = `https://www.lecker.de/${imageUrl}`;
        }
      }
      
      console.log(`Final processed image URL: ${imageUrl}`);
    } else {
      console.log('No image matches found, trying fallback...');
    }
    
    // Additional fallback: look for any large images in the content
    if (!imageUrl) {
      const fallbackImageMatch = html.match(/<img[^>]*src="([^"]*\.(jpg|jpeg|png|webp)[^"]*)"[^>]*>/i);
      if (fallbackImageMatch) {
        imageUrl = fallbackImageMatch[1];
        if (!imageUrl.startsWith('http')) {
          imageUrl = imageUrl.startsWith('/') ? `https://www.lecker.de${imageUrl}` : `https://www.lecker.de/${imageUrl}`;
        }
      }
    }
    
    console.log(`Final recipe data - imageUrl: ${imageUrl}`);
    
    return {
      title,
      subtitle,
      description: description || `Recipe from Lecker.de: ${url}`,
      servings,
      preparationTime: prepTime,
      cookingTime: 0, // Usually not specified separately on Lecker
      difficulty,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      imageUrl,
      sourceUrl: url
    };
  }
  
  private parseServings(recipeYield: any): number {
    if (typeof recipeYield === 'number') return recipeYield;
    if (typeof recipeYield === 'string') {
      const match = recipeYield.match(/(\d+)/);
      if (match) return parseInt(match[1]);
    }
    if (Array.isArray(recipeYield) && recipeYield.length > 0) {
      return this.parseServings(recipeYield[0]);
    }
    return 4; // Default
  }
  
  private mapLeckerDifficulty(difficulty: any): 'leicht' | 'mittel' | 'schwer' {
    if (typeof difficulty === 'string') {
      const d = difficulty.toLowerCase();
      if (d.includes('einfach') || d.includes('leicht') || d.includes('simpel')) return 'leicht';
      if (d.includes('schwer') || d.includes('schwierig') || d.includes('komplex')) return 'schwer';
    }
    return 'mittel';
  }

  /**
   * Extract title and subtitle from recipe name and description
   * Lecker.de often has descriptive titles that can be split for better organization
   */
  private extractTitleAndSubtitle(recipeName: string, recipeDescription: string): { title: string, subtitle?: string } {
    if (!recipeName) {
      return { title: 'Lecker Recipe' };
    }

    const cleanedName = this.cleanText(recipeName);
    const cleanedDesc = this.cleanText(recipeDescription || '');

    // Check if the title has common separators
    const separators = [' – ', ' - ', ' | ', ': '];
    for (const separator of separators) {
      if (cleanedName.includes(separator)) {
        const parts = cleanedName.split(separator);
        const mainTitle = parts[0].trim();
        const titleSubtitle = parts.slice(1).join(separator).trim();
        
        // Use the subtitle from the title if available
        if (titleSubtitle) {
          return {
            title: mainTitle,
            subtitle: titleSubtitle
          };
        }
      }
    }

    // Check for common Lecker.de title patterns
    // e.g., "Apfelmuffins - saftig und lecker" or "Kuchen mit Schokolade"
    if (cleanedName.match(/^.+\s-\s.+$/)) {
      const parts = cleanedName.split(' - ');
      return {
        title: parts[0].trim(),
        subtitle: parts.slice(1).join(' - ').trim()
      };
    }

    // Just return the title without using description as subtitle
    return { title: cleanedName };
  }
} 