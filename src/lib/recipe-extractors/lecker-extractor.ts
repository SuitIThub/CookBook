import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';
import type { NutritionData } from '../../types/recipe';

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
      const result = this.parseJsonLdRecipe(jsonLdData, url, html); // Pass HTML for difficulty extraction
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
  
  private parseJsonLdRecipe(data: any, url: string, html: string): ExtractedRecipeData {
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

    // Extract nutrition from JSON-LD
    const nutrition = this.extractNutritionFromJsonLd(data);

    // Extract time information from JSON-LD cookTime only
    console.log('🕐 Extracting time information from Lecker.de JSON-LD...');
    const timeEntries = [];
    
    // Extract only cookTime from JSON-LD and label it as "Zubereitungszeit"
    const cookTime = getTimeValue(data.cookTime);
    
    if (cookTime > 0) {
      timeEntries.push({ label: 'Zubereitungszeit', minutes: cookTime });
      console.log(`✅ Found cookTime in JSON-LD: ${cookTime} minutes → labeled as "Zubereitungszeit"`);
    } else {
      console.log('⚠️ No cookTime found in JSON-LD, timeEntries will be empty');
    }

    // Extract keywords and category from JSON-LD
    const keywords = this.extractKeywordsFromJsonLd(data, title, data.description);
    const category = this.extractCategoryFromJsonLd(data, title, data.description);

    // Extract difficulty from HTML (not JSON-LD)
    const difficulty = this.extractDifficultyFromHtml(html);

    return {
      title,
      subtitle,
      description: data.description,
      servings: this.parseServings(data.recipeYield),
      timeEntries: timeEntries,
      difficulty: difficulty,
      keywords,
      category,
      ingredients,
      instructions,
      imageUrl,
      nutrition,
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
    
    // Extract nutrition information from HTML as fallback
    const nutrition = this.extractNutritionFromHtml(html);
    
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
    
    // Time extraction for Lecker.de: NO HTML extraction - only JSON-LD cookTime is used
    console.log('🕐 Lecker.de time extraction: HTML times ignored, only JSON-LD cookTime is used');
    const timeEntries: Array<{label: string, minutes: number}> = [];
    // Empty - times are only extracted from JSON-LD in parseJsonLdRecipe method
    
    // Extract difficulty from HTML with improved patterns
    const difficulty = this.extractDifficultyFromHtml(html);
    
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
    
    // Keywords and category extraction for Lecker.de: NO HTML extraction - only JSON-LD is used
    console.log('🏷️ Lecker.de keywords extraction: HTML ignored, only JSON-LD "keywords" field is used');
    console.log('📂 Lecker.de category extraction: HTML ignored, only JSON-LD "recipeCategory" field is used');
    const keywords: string[] = []; // Empty - only extracted from JSON-LD
    const category: string | undefined = undefined; // Empty - only extracted from JSON-LD

    return {
      title,
      subtitle,
      description: description || `Recipe from Lecker.de: ${url}`,
      servings,
      timeEntries: timeEntries,
      difficulty,
      keywords,
      category,
      ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
      instructions: instructions.length > 0 ? instructions : ['Bitte Zubereitungsschritte manuell hinzufügen'],
      imageUrl,
      nutrition,
      sourceUrl: url
    };
  }

  private extractNutritionFromHtml(html: string): NutritionData | undefined {
    const result: NutritionData = {};
    
    console.log('Extracting nutrition from Lecker.de HTML...');
    
    // Look for the Nährwerte section
    const nutritionSection = html.match(/## Nährwerte(.*?)(?:## |$)/is);
    if (nutritionSection) {
      const nutritionHtml = nutritionSection[1];
      console.log('Found nutrition section:', nutritionHtml.substring(0, 200));
      
      // Extract calories
      const calorieMatch = nutritionHtml.match(/(\d+(?:[,\.]\d+)?)\s*kcal/i);
      if (calorieMatch) {
        result.calories = parseFloat(calorieMatch[1].replace(',', '.'));
        console.log('Extracted calories:', result.calories);
      }
      
      // Extract protein (Eiweiß)
      const proteinMatch = nutritionHtml.match(/(\d+(?:[,\.]\d+)?)\s*g\s*Eiweiß/i);
      if (proteinMatch) {
        result.protein = parseFloat(proteinMatch[1].replace(',', '.'));
        console.log('Extracted protein:', result.protein);
      }
      
      // Extract fat (Fett)
      const fatMatch = nutritionHtml.match(/(\d+(?:[,\.]\d+)?)\s*g\s*Fett/i);
      if (fatMatch) {
        result.fat = parseFloat(fatMatch[1].replace(',', '.'));
        console.log('Extracted fat:', result.fat);
      }
      
      // Extract carbohydrates (Kohlenhydrate)
      const carbMatch = nutritionHtml.match(/(\d+(?:[,\.]\d+)?)\s*g\s*Kohlenhydrate/i);
      if (carbMatch) {
        result.carbohydrates = parseFloat(carbMatch[1].replace(',', '.'));
        console.log('Extracted carbohydrates:', result.carbohydrates);
      }
    } else {
      console.log('No nutrition section found');
    }
    
    // Alternative patterns if the section-based approach doesn't work
    if (!nutritionSection) {
      console.log('Trying alternative nutrition patterns...');
      
      // Pattern 1: Look for list items with nutrition values
      const nutritionPatterns = [
        // "391 kcal"
        /(\d+(?:[,\.]\d+)?)\s*kcal/i,
        // "5 g Eiweiß" 
        /(\d+(?:[,\.]\d+)?)\s*g\s*Eiweiß/i,
        // "24 g Fett"
        /(\d+(?:[,\.]\d+)?)\s*g\s*Fett/i,
        // "35 g Kohlenhydrate"
        /(\d+(?:[,\.]\d+)?)\s*g\s*Kohlenhydrate/i
      ];
      
      const calorieMatch = html.match(nutritionPatterns[0]);
      if (calorieMatch) {
        result.calories = parseFloat(calorieMatch[1].replace(',', '.'));
        console.log('Alternative: Extracted calories:', result.calories);
      }
      
      const proteinMatch = html.match(nutritionPatterns[1]);
      if (proteinMatch) {
        result.protein = parseFloat(proteinMatch[1].replace(',', '.'));
        console.log('Alternative: Extracted protein:', result.protein);
      }
      
      const fatMatch = html.match(nutritionPatterns[2]);
      if (fatMatch) {
        result.fat = parseFloat(fatMatch[1].replace(',', '.'));
        console.log('Alternative: Extracted fat:', result.fat);
      }
      
      const carbMatch = html.match(nutritionPatterns[3]);
      if (carbMatch) {
        result.carbohydrates = parseFloat(carbMatch[1].replace(',', '.'));
        console.log('Alternative: Extracted carbohydrates:', result.carbohydrates);
      }
    }
    
    // Return nutrition data only if we found at least one value
    if (result.calories || result.protein || result.fat || result.carbohydrates) {
      console.log('Final nutrition result:', result);
      return result;
    }
    
    console.log('No nutrition data extracted');
    return undefined;
  }

  private extractNutritionFromJsonLd(data: any): NutritionData | undefined {
    if (!data || !data.nutrition) {
      console.log('No nutrition data in JSON-LD');
      return undefined;
    }

    const result: NutritionData = {};
    const nutrition = data.nutrition;
    
    console.log('Extracting nutrition from JSON-LD:', nutrition);

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
      console.log('Extracted nutrition from JSON-LD:', result);
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
  
  private extractDifficultyFromHtml(html: string): 'leicht' | 'mittel' | 'schwer' | undefined {
    console.log('🎯 Extracting difficulty from Lecker.de HTML...');
    
    // Pattern 1: Specific Lecker.de "Niveau" field extraction
    // Looking for: <li><div>Niveau:</div><div><strong>ganz einfach</strong></div></li>
    const niveauPattern = /<li[^>]*>\s*<div[^>]*>Niveau:<\/div>\s*<div[^>]*><strong[^>]*>([^<]+)<\/strong><\/div>\s*<\/li>/i;
    const niveauMatch = html.match(niveauPattern);
    
    if (niveauMatch) {
      const difficultyText = niveauMatch[1].trim();
      console.log(`   → Found "Niveau" field: "${difficultyText}"`);
      const mappedDifficulty = this.mapLeckerDifficulty(difficultyText);
      console.log(`✅ Extracted difficulty from HTML "Niveau" field: ${mappedDifficulty}`);
      return mappedDifficulty;
    }
    
    // Pattern 2: Alternative "Niveau" extraction (more flexible)
    const flexibleNiveauPattern = /Niveau:.*?<strong[^>]*>([^<]+)<\/strong>/is;
    const flexibleMatch = html.match(flexibleNiveauPattern);
    
    if (flexibleMatch) {
      const difficultyText = flexibleMatch[1].trim();
      console.log(`   → Found flexible "Niveau" pattern: "${difficultyText}"`);
      const mappedDifficulty = this.mapLeckerDifficulty(difficultyText);
      console.log(`✅ Extracted difficulty from flexible HTML pattern: ${mappedDifficulty}`);
      return mappedDifficulty;
    }
    
    // Pattern 3: Even more generic "Niveau" search
    const genericNiveauPattern = /Niveau:.*?([^<\n]+)/i;
    const genericMatch = html.match(genericNiveauPattern);
    
    if (genericMatch) {
      const difficultyText = this.cleanText(genericMatch[1]).trim();
      if (difficultyText.length > 0) {
        console.log(`   → Found generic "Niveau" text: "${difficultyText}"`);
        const mappedDifficulty = this.mapLeckerDifficulty(difficultyText);
        console.log(`✅ Extracted difficulty from generic HTML pattern: ${mappedDifficulty}`);
        return mappedDifficulty;
      }
    }
    
    console.log('⚠️ No "Niveau" field found in HTML, returning undefined');
    return undefined;
  }

  private extractKeywordsFromJsonLd(data: any, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from Lecker.de JSON-LD...');
    
    const keywords: string[] = [];
    
    // Extract ONLY from JSON-LD keywords field
    if (data.keywords) {
      if (Array.isArray(data.keywords)) {
        data.keywords.forEach((keyword: string) => {
          if (keyword && keyword.trim().length > 0) {
            keywords.push(keyword.trim());
            console.log(`   → Found keyword: "${keyword.trim()}"`);
          }
        });
      } else if (typeof data.keywords === 'string') {
        // Handle comma-separated string
        data.keywords.split(',').forEach((keyword: string) => {
          const cleaned = keyword.trim();
          if (cleaned.length > 0) {
            keywords.push(cleaned);
            console.log(`   → Found keyword: "${cleaned}"`);
          }
        });
      }
    }
    
    if (keywords.length > 0) {
      console.log(`✅ Extracted ${keywords.length} keywords from JSON-LD "keywords" field:`, keywords);
    } else {
      console.log('⚠️ No keywords found in JSON-LD "keywords" field');
    }
    
    return keywords;
  }

  private extractCategoryFromJsonLd(data: any, title: string, description?: string): string | undefined {
    console.log('📂 Extracting category from Lecker.de JSON-LD...');
    
    // Extract ONLY from JSON-LD recipeCategory field
    if (data.recipeCategory) {
      const category = Array.isArray(data.recipeCategory) 
        ? data.recipeCategory[0] 
        : data.recipeCategory;
      
      if (category && typeof category === 'string') {
        const normalized = this.normalizeCategory(category);
        console.log(`   → Found category "${category}" → normalized to "${normalized}"`);
        console.log(`✅ Extracted category from JSON-LD "recipeCategory" field: ${normalized}`);
        return normalized;
      }
    }
    
    console.log('⚠️ No category found in JSON-LD "recipeCategory" field');
    return undefined;
  }

  private mapLeckerDifficulty(difficulty: any): 'leicht' | 'mittel' | 'schwer' | undefined {
    if (typeof difficulty === 'string') {
      const d = difficulty.toLowerCase().trim();
      
      // Match exact common Lecker.de difficulty terms first
      const exactMatches: { [key: string]: 'leicht' | 'mittel' | 'schwer' } = {
        'ganz einfach': 'leicht',
        'super einfach': 'leicht',
        'sehr einfach': 'leicht',
        'total einfach': 'leicht',
        'kinderleicht': 'leicht',
        'einfach': 'leicht',
        'leicht': 'leicht',
        'simpel': 'leicht',
        'schnell': 'leicht',
        
        'mittel': 'mittel',
        'mittelschwer': 'mittel',
        'normal': 'mittel',
        
        'schwer': 'schwer',
        'schwierig': 'schwer',
        'sehr schwer': 'schwer',
        'kompliziert': 'schwer',
        'komplex': 'schwer',
        'anspruchsvoll': 'schwer',
        'aufwendig': 'schwer',
        'profi': 'schwer'
      };
      
      // Check for exact matches first
      if (exactMatches[d]) {
        console.log(`   → Exact match: "${d}" → ${exactMatches[d]}`);
        return exactMatches[d];
      }
      
      // Check for partial matches if no exact match found
      if (d.includes('einfach') || d.includes('leicht') || d.includes('simpel') || d.includes('schnell') || d.includes('kinderleicht')) {
        console.log(`   → Contains "leicht" keywords: "${d}" → leicht`);
        return 'leicht';
      }
      if (d.includes('schwer') || d.includes('schwierig') || d.includes('komplex') || d.includes('kompliziert') || d.includes('anspruchsvoll') || d.includes('aufwendig') || d.includes('profi')) {
        console.log(`   → Contains "schwer" keywords: "${d}" → schwer`);
        return 'schwer';
      }
      
      console.log(`   → No clear mapping found for "${d}" → returning undefined`);
    }
    return undefined;
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
  
  getCapabilities() {
    return {
      supportsIngredientGroups: false,
      supportsPreparationGroups: false,
      supportsImages: true,
      supportsNutrition: true,
      supportsMetadata: true,
      supportsTimeExtraction: true,
      supportsDifficultyExtraction: true,
      supportsKeywordExtraction: true,
      supportsCategoryExtraction: true,
      description: 'Spezialisiert auf Lecker.de - Unterstützt strukturierte Rezeptdaten, Nährwerte, Zeit-, Schwierigkeits-, Keyword- und Kategorieextraktion und erweiterte Bildextraktions-Algorithmen'
    };
  }
} 