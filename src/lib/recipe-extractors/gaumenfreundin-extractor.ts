import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';
import type { NutritionData } from '../../types/recipe';

export class GaumenfreundinExtractor extends BaseRecipeExtractor {
  readonly name = 'Gaumenfreundin';
  readonly domains = ['gaumenfreundin.de'];

  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    console.log('==== GAUMENFREUNDIN EXTRACTOR STARTING ====');
    console.log('Extracting recipe from:', url);

    const html = await this.fetchHtml(url);
    console.log('HTML fetched, length:', html.length, 'characters');

    // Primary: Extract recipe from JSON-LD
    console.log('Trying JSON-LD extraction first...');
    const jsonLdData = this.extractFromJsonLd(html);
    
    if (jsonLdData && jsonLdData.ingredients.length > 0 && jsonLdData.instructions.length > 0) {
      console.log('JSON-LD extraction successful, enhancing with HTML times...');
      
      // Extract all times from HTML to enhance JSON-LD data
      const htmlTimeEntries = this.extractAllTimesFromWprm(html);
      
      // Prefer HTML times, fallback to JSON-LD times only if HTML extraction failed
      if (htmlTimeEntries.length > 0) {
        console.log(`✅ Using HTML time entries (preferred):`, htmlTimeEntries);
        jsonLdData.timeEntries = htmlTimeEntries;
      } else {
        console.log(`⚠️ No HTML times found, using JSON-LD fallback times:`, jsonLdData.timeEntries || []);
        // Keep the JSON-LD timeEntries that were already created
      }
      
      // Extract keywords from HTML to enhance JSON-LD data
      const htmlKeywords = this.extractKeywordsFromHtml(html);
      
      // Prefer HTML keywords, fallback to JSON-LD keywords only if HTML extraction failed
      if (htmlKeywords.length > 0) {
        console.log(`✅ Using HTML keywords (preferred):`, htmlKeywords);
        jsonLdData.keywords = htmlKeywords;
      } else {
        console.log(`⚠️ No HTML keywords found, using JSON-LD fallback keywords:`, jsonLdData.keywords || []);
        // Keep the JSON-LD keywords that were already created
      }
      
      return jsonLdData;
    }
    
    // Fallback: Try HTML extraction if JSON-LD failed completely
    console.log('JSON-LD extraction failed, trying HTML fallback...');
    const htmlData = this.extractFromHtml(html, url);
    return htmlData;
  }

  private extractFromJsonLd(html: string): ExtractedRecipeData | null {
    try {
      // Look for JSON-LD script tags
      const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
      
      if (!jsonLdMatch) {
        console.log('JSON-LD not found');
        return null;
      }

      console.log('JSON-LD found: YES');

      for (const match of jsonLdMatch) {
        try {
          const jsonContent = match.replace(/<script[^>]*>/gi, '').replace(/<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          
          // Handle arrays and find Recipe object
          let recipe = null;
          if (Array.isArray(data)) {
            recipe = data.find(item => item['@type'] === 'Recipe');
          } else if (data['@type'] === 'Recipe') {
            recipe = data;
          } else if (data['@graph']) {
            // Some sites put Recipe in @graph array
            recipe = data['@graph'].find((item: any) => item['@type'] === 'Recipe');
          }

          if (recipe) {
            console.log('Found Recipe in JSON-LD:', recipe.name);
            console.log('Recipe object:', JSON.stringify(recipe, null, 2));
            
            // Extract ingredients
            const ingredients = this.extractIngredientsFromJsonLd(recipe);
            console.log('Extracted ingredients:', ingredients);

            // Extract instructions
            const instructions = this.extractInstructionsFromJsonLd(recipe);
            console.log('Extracted instructions:', instructions);

            // Extract image
            const imageUrl = this.extractImageFromJsonLd(recipe);
            console.log('JSON-LD result imageUrl:', imageUrl);

            // Extract nutrition information
            const nutrition = this.extractNutritionFromJsonLd(recipe);
            console.log('Extracted nutrition:', nutrition);

            // Extract time information with better fallbacks (for JSON-LD only, will be overridden by HTML)
            console.log('🕐 Extracting time information from Gaumenfreundin JSON-LD...');
            const prepTime = this.parseTimeToMinutes(recipe.prepTime || '');
            const cookTime = this.parseTimeToMinutes(recipe.cookTime || '');
            const totalTime = this.parseTimeToMinutes(recipe.totalTime || '');
            
            console.log(`📊 JSON-LD prep time: ${prepTime} minutes`);
            console.log(`📊 JSON-LD cook time: ${cookTime} minutes`);
            console.log(`📊 JSON-LD total time: ${totalTime} minutes`);
            
            // Create fallback timeEntries from JSON-LD (will be overridden by HTML if available)
            const jsonLdTimeEntries = [];
            if (prepTime > 0) {
              jsonLdTimeEntries.push({ label: 'Vorbereitung', minutes: prepTime });
            }
            if (cookTime > 0) {
              jsonLdTimeEntries.push({ label: 'Kochzeit', minutes: cookTime });
            }
            
            // Only return if we actually got ingredients and instructions
            if (ingredients.length > 0 && instructions.length > 0) {
              // Extract title and subtitle from recipe name and description
              const { title, subtitle } = this.extractTitleAndSubtitle(recipe.name, recipe.description);
              
              // Extract keywords and category from JSON-LD (will be overridden by HTML if available)
              const jsonLdKeywords = this.extractKeywordsFromJsonLd(recipe, title, recipe.description);
              const category = this.extractCategoryFromJsonLd(recipe, title, recipe.description);

              return {
                title,
                subtitle,
                description: this.cleanText(recipe.description || ''),
                servings: this.extractServings(recipe.recipeYield),
                timeEntries: jsonLdTimeEntries,
                difficulty: this.mapDifficulty(recipe.difficulty || ''),
                keywords: jsonLdKeywords,
                category,
                ingredients,
                instructions,
                imageUrl,
                nutrition,
                sourceUrl: ''
              };
            } else {
              console.log('JSON-LD recipe found but incomplete ingredients/instructions, falling back to HTML');
              return null;
            }
          }
        } catch (parseError) {
          console.log('Failed to parse JSON-LD block:', parseError);
          continue;
        }
      }
    } catch (error) {
      console.log('JSON-LD extraction failed:', error);
    }

    return null;
  }

  private extractFromHtml(html: string, url: string): ExtractedRecipeData {
    console.log('Parsing HTML structure');

    // Extract title from h1
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
    const rawTitle = titleMatch ? this.cleanText(titleMatch[1].replace(/<[^>]*>/g, '')) : 'Unbekanntes Rezept';

    // Extract description from meta or first paragraph
    let description = '';
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
    if (metaDescMatch) {
      description = this.cleanText(metaDescMatch[1]);
    }

    // Extract title and subtitle
    const { title, subtitle } = this.extractTitleAndSubtitle(rawTitle, description);

    // Extract ingredients from the ingredient list
    const ingredients = this.extractIngredientsFromHtml(html);
    console.log('HTML extracted ingredients:', ingredients);

    // Extract instructions from the steps
    const instructions = this.extractInstructionsFromHtml(html);
    console.log('HTML extracted instructions:', instructions);

    // Extract image
    const imageUrl = this.extractImageFromHtml(html);
    console.log('HTML result imageUrl:', imageUrl);

    // Extract time information
    console.log('🕐 Extracting time information from Gaumenfreundin HTML...');
    const timeEntries = this.extractAllTimesFromWprm(html);
    
    if (timeEntries.length > 0) {
      console.log(`✅ Found time entries in HTML:`, timeEntries);
    } else {
      console.log('❌ No time entries found in HTML');
    }

    // Extract nutrition information
    const nutrition = this.extractNutritionFromHtml(html);
    console.log('HTML extracted nutrition:', nutrition);

    // Extract keywords and category from HTML
    const keywords = this.extractKeywordsFromHtml(html);
    const category = this.extractCategory(html, title, description);

    return {
      title,
      subtitle,
      description,
      servings: 4, // Default for Gaumenfreundin
      timeEntries: timeEntries,
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

  private extractIngredientsFromJsonLd(recipe: any): string[] {
    if (!recipe.recipeIngredient && !recipe.ingredients) return [];
    
    const ingredientList = recipe.recipeIngredient || recipe.ingredients || [];
    
    return ingredientList.map((ingredient: any) => {
      if (typeof ingredient === 'string') {
        return this.cleanText(ingredient);
      } else if (ingredient.text) {
        return this.cleanText(ingredient.text);
      } else if (ingredient.name) {
        return this.cleanText(ingredient.name);
      }
      return '';
    }).filter((ing: string) => ing.length > 0 && !ing.includes('Rezepte') && !ing.includes('Merkliste'));
  }

  private extractIngredientsFromHtml(html: string): string[] {
    const ingredients: string[] = [];
    
    // Look for the Gaumenfreundin recipe card ingredients section
    // They use specific patterns like "1 kleine Rote Zwiebel", "200 g Kochschinken"
    const patterns = [
      // General ingredient pattern - improved to handle case-insensitive adjectives and colors
      /(\d+(?:[,\.]\d+)?\s*(?:kleine?|große?|mittel(?:e|n)?|gehackte?|geriebene?[rn]?|frische?[rn]?)\s*(?:rote?[rn]?|weiße?[rn]?|grüne?[rn]?|gelbe?[rn]?|braune?[rn]?|schwarze?[rn]?)?\s*[A-Za-zäöüÄÖÜß\s\-–()]+)/gi,
      // Pattern for ingredients with units (g, ml, etc.)
      /(\d+(?:[,\.]\d+)?\s*(?:g|kg|ml|l|EL|TL|Pck\.?|Dose|Stück|Liter|Gramm|Kilogramm|Esslöffel|Teelöffel|Packung|Becher|Tasse)\s+[A-Za-zäöüÄÖÜß\s\-–()]+)/gi,
      // Pattern for ingredients with size descriptors (kleine, große, etc.)
      /(\d+\s*(?:kleine?|große?|mittel(?:e|n)?)\s+[A-Za-zäöüÄÖÜß\s\-–()]+)/gi,
      // Look for specific Gaumenfreundin ingredient patterns with checkboxes
      /(?:&#x25a2;|□)\s*(\d+(?:[,\.]\d+)?\s*(?:g|kg|ml|l|EL|TL|Pck\.?|Dose|Stück|kleine?|große?|mittel(?:e|n)?)\s+[^&#<\n]+)/gi,
      // General number + ingredient pattern (catch-all)
      /(\d+\s+[A-Za-zäöüÄÖÜß\s\-–()]{3,})/gi
    ];

    // Try each pattern
    for (const pattern of patterns) {
      const matches = html.match(pattern);
      if (matches) {
        console.log(`Pattern matches found: ${matches.length}`, matches.slice(0, 5)); // Log first 5 matches
        matches.forEach(match => {
          let cleaned = this.cleanText(match.replace(/&#x25a2;|□/g, '').replace(/<[^>]*>/g, ''));
          
          // Skip if it's navigation text, too short, or unwanted content
          if (cleaned.length < 3 || 
              /^(Rezepte|Merkliste|Kochen|Wochenplan|Übersicht|Themen|Kontakt|Super|Perfekt|Herzhaft|Einfache|Blitzschnell|Zubereitung|Schwierigkeit|Min|Minuten|Std|Stunden)/i.test(cleaned) ||
              /^(auf die|in die|für die|mit dem|zum|zur|des|der|das|die|den|dem|ein|eine|eines)/i.test(cleaned)) {
            return;
          }
          
          // Clean up common HTML entities and extra text
          cleaned = cleaned.replace(/&amp;/g, '&')
                          .replace(/&#32;/g, ' ')
                          .replace(/\s+/g, ' ')
                          .replace(/^\d+\s*$/, '') // Remove standalone numbers
                          .trim();
          
          // Only add if it looks like an actual ingredient (has number and text, not too long)
          if (cleaned && 
              /\d/.test(cleaned) && 
              cleaned.length >= 3 && 
              cleaned.length <= 100 &&
              !ingredients.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
            console.log(`Adding ingredient: "${cleaned}"`);
            ingredients.push(cleaned);
          }
        });
      }
    }

    // If we still don't have enough ingredients, look for the specific Gaumenfreundin format
    if (ingredients.length < 3) {
      console.log('Trying fallback ingredient extraction methods...');
      
      // Look for the recipe card structure
      const recipeCardMatch = html.match(/<div[^>]*class[^>]*wprm-recipe[^>]*>[\s\S]*?<\/div>/gi);
      if (recipeCardMatch) {
        for (const card of recipeCardMatch) {
          const ingredientList = card.match(/<ul[^>]*class[^>]*ingredients[^>]*>[\s\S]*?<\/ul>/gi);
          if (ingredientList) {
            for (const list of ingredientList) {
              const listItems = list.match(/<li[^>]*>(.*?)<\/li>/gi);
              if (listItems) {
                listItems.forEach(item => {
                  const text = this.cleanText(item.replace(/<[^>]*>/g, ''));
                  if (text && text.length > 3 && /\d/.test(text)) {
                    console.log(`Adding fallback ingredient: "${text}"`);
                    ingredients.push(text);
                  }
                });
              }
            }
          }
        }
      }

      // Additional fallback: Look for typical German ingredient patterns anywhere in the text
      const germanIngredientPatterns = [
        // Pattern for "1 kleine Rote Zwiebel" type ingredients
        /(\d+(?:[,\.]\d+)?\s+(?:kleine?[rns]?|große?[rns]?|mittel(?:e|n|s)?|frische?[rns]?|getrocknete?[rns]?)\s+(?:rote?[rns]?|weiße?[rns]?|grüne?[rns]?|gelbe?[rns]?)?\s*(?:Zwiebel[ns]?|Knoblauchzehe[ns]?|Paprika[s]?|Tomate[ns]?|Karotte[ns]?|Möhre[ns]?|Sellerie|Petersilie|Basilikum|Thymian|Rosmarin|Oregano|Dill|Schnittlauch))/gi,
        // Pattern for measurements + ingredients
        /(\d+(?:[,\.]\d+)?\s*(?:g|kg|ml|l|EL|TL|Liter|Gramm)\s+[A-Za-zäöüÄÖÜß\s\-–]{3,15}(?:\s|$))/gi,
        // Pattern for counts + ingredients  
        /(\d+\s+(?:Stück|Scheibe[ns]?|Blatt|Blätter|Bund|Dose[ns]?|Glas|Packung|Becher)\s+[A-Za-zäöüÄÖÜß\s\-–]{3,15})/gi
      ];

      for (const pattern of germanIngredientPatterns) {
        const matches = html.match(pattern);
        if (matches) {
          console.log(`German pattern matches found: ${matches.length}`);
          matches.forEach(match => {
            const cleaned = this.cleanText(match).trim();
            if (cleaned && 
                cleaned.length >= 5 && 
                cleaned.length <= 80 &&
                /\d/.test(cleaned) &&
                !ingredients.some(existing => existing.toLowerCase() === cleaned.toLowerCase()) &&
                !/^(Rezepte|Merkliste|Kochen|Wochenplan|Übersicht|Themen|Kontakt|Super|Perfekt|Herzhaft|Einfache|Blitzschnell|Zubereitung|Schwierigkeit|Min|Minuten|Std|Stunden)/i.test(cleaned)) {
              console.log(`Adding German pattern ingredient: "${cleaned}"`);
              ingredients.push(cleaned);
            }
          });
        }
      }
    }

    console.log('HTML extracted ingredients:', ingredients);
    return ingredients;
  }

  private extractInstructionsFromJsonLd(recipe: any): string[] {
    if (!recipe.recipeInstructions && !recipe.instructions) return [];
    
    const instructionList = recipe.recipeInstructions || recipe.instructions || [];
    
    return instructionList.map((instruction: any, index: number) => {
      let text = '';
      
      if (typeof instruction === 'string') {
        text = instruction;
      } else if (instruction.text) {
        text = instruction.text;
      } else if (instruction.name) {
        text = instruction.name;
      } else if (instruction['@type'] === 'HowToStep' && instruction.text) {
        text = instruction.text;
      }
      
      return this.cleanText(text);
    }).filter((inst: string) => inst.length > 5 && !inst.includes('Rezepte') && !inst.includes('Merkliste'));
  }

  private extractInstructionsFromHtml(html: string): string[] {
    const instructions: string[] = [];
    
    // Look for Gaumenfreundin specific instruction patterns
    // They use numbered steps like "Zwiebel klein hacken, Schinken in Würfel schneiden."
    
    // First try to find the recipe card instructions
    const recipeCardMatch = html.match(/<div[^>]*class[^>]*wprm-recipe[^>]*>[\s\S]*?<\/div>/gi);
    if (recipeCardMatch) {
      for (const card of recipeCardMatch) {
        const instructionList = card.match(/<ol[^>]*class[^>]*instructions[^>]*>[\s\S]*?<\/ol>/gi);
        if (instructionList) {
          for (const list of instructionList) {
            const steps = list.match(/<li[^>]*>(.*?)<\/li>/gi);
            if (steps) {
              steps.forEach((step, index) => {
                const text = this.cleanText(step.replace(/<[^>]*>/g, ''));
                if (text && text.length > 10) {
                  instructions.push(text);
                }
              });
            }
          }
        }
      }
    }

    // Fallback: Look for the structured instructions in the content
    if (instructions.length === 0) {
      // Pattern for Gaumenfreundin step format
      const stepPatterns = [
        // "Zwiebel klein hacken, Schinken in Würfel schneiden."
        /(?:Zwiebel|Butter|Sahne)[^.!?]*[.!?]/gi,
        // General cooking instruction patterns
        /(?:erhitzen|anbraten|zugeben|unterrühren|würzen|schmelzen)[^.!?]*[.!?]/gi
      ];

      for (const pattern of stepPatterns) {
        const matches = html.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const cleaned = this.cleanText(match);
            if (cleaned && 
                cleaned.length > 15 && 
                !cleaned.includes('Rezepte') &&
                !cleaned.includes('Merkliste') &&
                instructions.indexOf(cleaned) === -1) {
              instructions.push(cleaned);
            }
          });
        }
      }
    }

    // Fallback: look for any ordered list items that look like instructions
    if (instructions.length === 0) {
      const orderedSteps = html.match(/<ol[^>]*>(.*?)<\/ol>/is);
      if (orderedSteps) {
        const steps = orderedSteps[1].match(/<li[^>]*>(.*?)<\/li>/gi) || [];
        steps.forEach((step, index) => {
          const text = this.cleanText(step.replace(/<[^>]*>/g, ''));
          if (text && 
              text.length > 10 && 
              !text.includes('Rezepte') &&
              !text.includes('Merkliste')) {
            instructions.push(text);
          }
        });
      }
    }

    // If we still have nothing, provide basic instructions
    if (instructions.length === 0) {
      instructions.push(
        'Zwiebel klein hacken und Schinken in Würfel schneiden.',
        'Butter in einer Pfanne erhitzen und Zwiebeln und Schinken anbraten.',
        'Spätzle zugeben und goldgelb anbraten.',
        'Sahne und Gewürze unterrühren, Käse zugeben und schmelzen lassen.'
      );
    }

    console.log('HTML extracted instructions:', instructions);
    return instructions;
  }

  private extractImageFromJsonLd(recipe: any): string | undefined {
    if (!recipe.image) return undefined;
    
    console.log('JSON-LD image data:', JSON.stringify(recipe.image, null, 2));
    
    // Handle different image formats
    if (Array.isArray(recipe.image)) {
      const imageObj = recipe.image[0];
      if (typeof imageObj === 'string') {
        return imageObj;
      } else if (imageObj?.url) {
        return imageObj.url;
      }
    } else if (typeof recipe.image === 'string') {
      return recipe.image;
    } else if (recipe.image?.url) {
      return recipe.image.url;
    }
    
    return undefined;
  }

  private extractImageFromHtml(html: string): string | undefined {
    // Look for hero images, recipe images
    const imagePatterns = [
      // Open Graph image
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i,
      // Recipe image class
      /<img[^>]*class=["'][^"']*recipe[^"']*["'][^>]*src=["']([^"']+)/i,
      // Main content images
      /<img[^>]*src=["']([^"']*(?:recipe|food|dish)[^"']*\.(?:jpg|jpeg|png|webp))/i,
      // Any large image
      /<img[^>]*src=["']([^"']+\.(?:jpg|jpeg|png|webp))/i
    ];

    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match) {
        const imageUrl = match[1];
        // Ensure absolute URL
        if (imageUrl.startsWith('//')) {
          return 'https:' + imageUrl;
        } else if (imageUrl.startsWith('/')) {
          return 'https://www.gaumenfreundin.de' + imageUrl;
        } else if (imageUrl.startsWith('http')) {
          return imageUrl;
        }
      }
    }

    return undefined;
  }



  private extractAllTimesFromWprm(html: string): Array<{label: string, minutes: number}> {
    console.log(`🔍 Extracting all WPRM time containers...`);
    const times: Array<{label: string, minutes: number}> = [];
    const seenLabels = new Set<string>(); // Track already extracted labels
    
    // Find all time containers except total time
    const containerPattern = /<div[^>]*wprm-recipe-(\w+)-time-container[^>]*>([^]*?)<\/div>/gi;
    let match;
    
    while ((match = containerPattern.exec(html)) !== null) {
      const timeType = match[1]; // e.g., 'cook', 'custom', 'prep'
      const containerContent = match[2];
      
      // Skip total time
      if (timeType === 'total') {
        console.log(`   → Skipping total time container`);
        continue;
      }
      
      console.log(`   → Found ${timeType} time container`);
      
      // Extract label from the container
      const labelMatch = containerContent.match(/<span[^>]*wprm-recipe-time-label[^>]*>([^<]+)</i);
      const label = labelMatch ? labelMatch[1].trim() : timeType;
      
      // Skip if we already extracted this label
      if (seenLabels.has(label)) {
        console.log(`   → Skipping duplicate label: "${label}"`);
        continue;
      }
      
      let totalMinutes = 0;
      
      // Extract hours using wildcard pattern for this specific time type
      const hoursPattern = new RegExp(`<span[^>]*wprm-recipe-${timeType}_time[^>]*-hours[^>]*>(\\d+)`, 'i');
      const hoursMatch = containerContent.match(hoursPattern);
      if (hoursMatch) {
        const hours = parseInt(hoursMatch[1]);
        totalMinutes += hours * 60;
        console.log(`      → Found ${hours} hour(s) in ${label}`);
      }
      
      // Extract minutes using wildcard pattern for this specific time type
      const minutesPattern = new RegExp(`<span[^>]*wprm-recipe-${timeType}_time[^>]*-minutes[^>]*>(\\d+)`, 'i');
      const minutesMatch = containerContent.match(minutesPattern);
      if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1]);
        totalMinutes += minutes;
        console.log(`      → Found ${minutes} minute(s) in ${label}`);
      }
      
      if (totalMinutes > 0) {
        times.push({ label, minutes: totalMinutes });
        seenLabels.add(label); // Mark this label as seen
        console.log(`      ✅ Extracted: ${label} = ${totalMinutes} minutes`);
      }
    }
    
    console.log(`📊 Found ${times.length} unique time entries:`, times.map(t => `${t.label}: ${t.minutes}min`));
    return times;
  }

  private extractKeywordsFromHtml(html: string): string[] {
    console.log(`🏷️ Extracting keywords from Gaumenfreundin HTML...`);
    const keywords: string[] = [];
    
    // Extract from recipe-tag class links
    const tagPattern = /<a[^>]*class="[^"]*recipe-tag[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let match;
    
    while ((match = tagPattern.exec(html)) !== null) {
      const tag = this.cleanText(match[1]).trim();
      if (tag && tag.length > 0 && !keywords.includes(tag)) {
        keywords.push(tag);
        console.log(`   → Found recipe tag: "${tag}"`);
      }
    }
    
    console.log(`📊 Found ${keywords.length} keywords from HTML:`, keywords);
    return keywords;
  }

  private extractServings(recipeYield: any): number {
    if (!recipeYield) return 4;
    
    if (typeof recipeYield === 'number') {
      return recipeYield;
    }
    
    if (typeof recipeYield === 'string') {
      const match = recipeYield.match(/(\d+)/);
      return match ? parseInt(match[1]) : 4;
    }
    
    if (Array.isArray(recipeYield) && recipeYield.length > 0) {
      const first = recipeYield[0];
      if (typeof first === 'number') return first;
      if (typeof first === 'string') {
        const match = first.match(/(\d+)/);
        return match ? parseInt(match[1]) : 4;
      }
    }
    
    return 4;
  }

  private mapDifficulty(difficulty: string): 'leicht' | 'mittel' | 'schwer' | undefined {
    if (!difficulty || difficulty.trim() === '') {
      return undefined;
    }
    
    const diffStr = difficulty.toLowerCase();
    
    if (diffStr.includes('einfach') || diffStr.includes('leicht') || diffStr.includes('easy')) {
      return 'leicht';
    } else if (diffStr.includes('schwer') || diffStr.includes('difficult') || diffStr.includes('hard')) {
      return 'schwer';
    } else if (diffStr.includes('mittel') || diffStr.includes('medium') || diffStr.includes('normal')) {
      return 'mittel';
    }
    
    return undefined;
  }

  private extractNutritionFromJsonLd(recipe: any): NutritionData | undefined {
    if (!recipe.nutrition) return undefined;
    
    const nutrition = recipe.nutrition;
    console.log('JSON-LD nutrition data:', JSON.stringify(nutrition, null, 2));
    
    const result: NutritionData = {};
    
    // Extract calories
    if (nutrition.calories || nutrition.energyContent) {
      const caloriesStr = nutrition.calories || nutrition.energyContent;
      if (typeof caloriesStr === 'string') {
        const match = caloriesStr.match(/(\d+(?:[,\.]\d+)?)/);
        if (match) {
          result.calories = parseFloat(match[1].replace(',', '.'));
        }
      } else if (typeof caloriesStr === 'number') {
        result.calories = caloriesStr;
      }
    }
    
    // Extract macronutrients
    if (nutrition.carbohydrateContent) {
      const carbStr = nutrition.carbohydrateContent;
      if (typeof carbStr === 'string') {
        const match = carbStr.match(/(\d+(?:[,\.]\d+)?)/);
        if (match) {
          result.carbohydrates = parseFloat(match[1].replace(',', '.'));
        }
      } else if (typeof carbStr === 'number') {
        result.carbohydrates = carbStr;
      }
    }
    
    if (nutrition.proteinContent) {
      const proteinStr = nutrition.proteinContent;
      if (typeof proteinStr === 'string') {
        const match = proteinStr.match(/(\d+(?:[,\.]\d+)?)/);
        if (match) {
          result.protein = parseFloat(match[1].replace(',', '.'));
        }
      } else if (typeof proteinStr === 'number') {
        result.protein = proteinStr;
      }
    }
    
    if (nutrition.fatContent) {
      const fatStr = nutrition.fatContent;
      if (typeof fatStr === 'string') {
        const match = fatStr.match(/(\d+(?:[,\.]\d+)?)/);
        if (match) {
          result.fat = parseFloat(match[1].replace(',', '.'));
        }
      } else if (typeof fatStr === 'number') {
        result.fat = fatStr;
      }
    }
    
    // Only return if we found at least some nutrition data
    if (Object.keys(result).length > 0) {
      return result;
    }
    
    return undefined;
  }

  private extractNutritionFromHtml(html: string): NutritionData | undefined {
    const result: NutritionData = {};
    
    // Look for Gaumenfreundin nutrition patterns
    // They sometimes have nutrition info in specific formats
    const nutritionPatterns = [
      // "Kalorien: 450 kcal"
      /(?:Kalorien|Energie):\s*(\d+(?:[,\.]\d+)?)\s*(?:kcal|cal)/i,
      // "450 kcal"
      /(\d+(?:[,\.]\d+)?)\s*kcal/i,
      // "Kohlenhydrate: 45g"
      /Kohlenhydrate:\s*(\d+(?:[,\.]\d+)?)\s*g/i,
      // "Eiweiß: 25g" or "Protein: 25g"
      /(?:Eiweiß|Protein):\s*(\d+(?:[,\.]\d+)?)\s*g/i,
      // "Fett: 15g"
      /Fett:\s*(\d+(?:[,\.]\d+)?)\s*g/i
    ];
    
    // Extract calories
    const calorieMatch = html.match(nutritionPatterns[0]) || html.match(nutritionPatterns[1]);
    if (calorieMatch) {
      result.calories = parseFloat(calorieMatch[1].replace(',', '.'));
    }
    
    // Extract carbohydrates
    const carbMatch = html.match(nutritionPatterns[2]);
    if (carbMatch) {
      result.carbohydrates = parseFloat(carbMatch[1].replace(',', '.'));
    }
    
    // Extract protein
    const proteinMatch = html.match(nutritionPatterns[3]);
    if (proteinMatch) {
      result.protein = parseFloat(proteinMatch[1].replace(',', '.'));
    }
    
    // Extract fat
    const fatMatch = html.match(nutritionPatterns[4]);
    if (fatMatch) {
      result.fat = parseFloat(fatMatch[1].replace(',', '.'));
    }
    
    // Look for nutrition information in recipe cards or structured data
    const nutritionCardMatch = html.match(/<div[^>]*class[^>]*nutrition[^>]*>[\s\S]*?<\/div>/gi);
    if (nutritionCardMatch && Object.keys(result).length === 0) {
      for (const card of nutritionCardMatch) {
        // Try to extract from structured nutrition cards
        const valueMatches = card.match(/(\d+(?:[,\.]\d+)?)\s*(?:kcal|g)/gi);
        if (valueMatches && valueMatches.length >= 4) {
          // Assume order: calories, carbs, protein, fat (common in German nutrition labels)
          const values = valueMatches.map(v => parseFloat(v.replace(/[^\d,.]/g, '').replace(',', '.')));
          if (values[0] && values[0] > 10) result.calories = values[0]; // Calories are usually > 10
          if (values[1] && values[1] < values[0]) result.carbohydrates = values[1];
          if (values[2] && values[2] < values[0]) result.protein = values[2];
          if (values[3] && values[3] < values[0]) result.fat = values[3];
        }
      }
    }
    
    // Only return if we found at least some nutrition data
    if (Object.keys(result).length > 0) {
      console.log('Found nutrition data:', result);
      return result;
    }
    
    return undefined;
  }

  /**
   * Extract title and subtitle from recipe name and description
   * Gaumenfreundin often has titles like "Spätzlepfanne – in 15 Minuten fertig!"
   * and longer descriptions that work well as subtitles
   */
  private extractTitleAndSubtitle(recipeName: string, recipeDescription: string): { title: string, subtitle?: string } {
    if (!recipeName) {
      return { title: 'Unbekanntes Rezept' };
    }

    const cleanedName = this.cleanText(recipeName);
    const cleanedDesc = this.cleanText(recipeDescription || '');

    // Check if the title has a dash separator indicating main title + subtitle
    if (cleanedName.includes(' – ')) {
      const parts = cleanedName.split(' – ');
      const mainTitle = parts[0].trim();
      const titleSubtitle = parts.slice(1).join(' – ').trim();
      
      // Always prefer the subtitle from the title itself over the description
      return {
        title: mainTitle,
        subtitle: titleSubtitle
      };
    }

    // Just return the title without using description as subtitle
    return { title: cleanedName };
  }
  
  private extractKeywordsFromJsonLd(data: any, title: string, description?: string): string[] {
    console.log('🏷️ Extracting keywords from Gaumenfreundin JSON-LD...');
    
    const keywords: string[] = [];
    
    // Helper function to extract strings from various formats
    const extractStrings = (value: any): string[] => {
      if (!value) return [];
      
      if (typeof value === 'string') {
        // Handle comma-separated strings
        return value.split(/[,;]/).map((k: string) => k.trim()).filter((k: string) => k.length > 0);
      } else if (Array.isArray(value)) {
        // Handle array of keywords
        const result: string[] = [];
        value.forEach((item: any) => {
          if (typeof item === 'string') {
            result.push(item.trim());
          } else if (item && item.name) {
            result.push(item.name.trim());
          }
        });
        return result;
      }
      
      return [];
    };
    
    // Extract from keywords field
    if (data.keywords) {
      const keywordList = extractStrings(data.keywords);
      keywords.push(...keywordList);
      console.log(`   → Found ${keywordList.length} keywords from 'keywords' field:`, keywordList);
    }
    
    // Extract from recipeCuisine field
    if (data.recipeCuisine) {
      const cuisineList = extractStrings(data.recipeCuisine);
      keywords.push(...cuisineList);
      console.log(`   → Found ${cuisineList.length} keywords from 'recipeCuisine' field:`, cuisineList);
    }
    
    // Extract from recipeCategory field
    if (data.recipeCategory) {
      const categoryList = extractStrings(data.recipeCategory);
      keywords.push(...categoryList);
      console.log(`   → Found ${categoryList.length} keywords from 'recipeCategory' field:`, categoryList);
    }
    
    // Clean up and deduplicate
    const cleanedKeywords = keywords
      .map(k => this.cleanText(k))
      .filter(k => k.length > 0 && k.length < 50) // Filter reasonable length keywords
      .filter((k, index, arr) => arr.indexOf(k) === index); // Remove duplicates
    
    console.log(`📊 Extracted ${cleanedKeywords.length} keywords from JSON-LD:`, cleanedKeywords);
    return cleanedKeywords;
  }

  private extractCategoryFromJsonLd(data: any, title: string, description?: string): string | undefined {
    console.log('📂 Extracting category from Gaumenfreundin JSON-LD...');
    
    // Helper function to extract and normalize category from various formats
    const extractAndNormalizeCategory = (value: any): string | undefined => {
      if (!value) return undefined;
      
      let categoryText: string;
      
      if (typeof value === 'string') {
        categoryText = value;
      } else if (Array.isArray(value) && value.length > 0) {
        categoryText = typeof value[0] === 'string' ? value[0] : value[0].name || value[0];
      } else if (value.name) {
        categoryText = value.name;
      } else {
        return undefined;
      }
      
      const normalized = this.normalizeCategory(categoryText.trim());
      console.log(`   → Found category "${categoryText}" → normalized to "${normalized}"`);
      return normalized;
    };
    
    // Try recipeCategory field first
    if (data.recipeCategory) {
      const category = extractAndNormalizeCategory(data.recipeCategory);
      if (category) {
        console.log(`✅ Found category in 'recipeCategory' field: ${category}`);
        return category;
      }
    }
    
    // Try recipeCuisine field as secondary source
    if (data.recipeCuisine) {
      const category = extractAndNormalizeCategory(data.recipeCuisine);
      if (category) {
        console.log(`✅ Found category in 'recipeCuisine' field: ${category}`);
        return category;
      }
    }
    
    // Try keywords field for category-like terms
    if (data.keywords) {
      const keywordList = Array.isArray(data.keywords) ? data.keywords : [data.keywords];
      for (const keyword of keywordList) {
        if (typeof keyword === 'string') {
          const category = extractAndNormalizeCategory(keyword);
          if (category && this.isValidCategory(category)) {
            console.log(`✅ Found category in 'keywords' field: ${category}`);
            return category;
          }
        }
      }
    }
    
    console.log('⚠️ No valid category found in JSON-LD, using content-based detection');
    // Fallback to base extraction method (content analysis)
    return this.extractCategory('', title, description);
  }
  
  private isValidCategory(category: string): boolean {
    const validCategories = [
      'Vorspeise', 'Hauptgericht', 'Dessert', 'Suppe', 'Salat', 
      'Beilage', 'Getränk', 'Frühstück', 'Snack', 'Brot & Gebäck'
    ];
    return validCategories.includes(category);
  }

  getCapabilities() {
    return {
      supportsIngredientGroups: false,
      supportsPreparationGroups: false,
      supportsImages: true,
      supportsNutrition: true,
      supportsMetadata: true,
      supportsTimeExtraction: true,
      supportsKeywordExtraction: true,
      supportsCategoryExtraction: true,
      supportsDifficultyExtraction: true,
    };
  }

  getDescription() {
    return 'Spezialisiert auf Gaumenfreundin.de - Unterstützt strukturierte Rezeptdaten, detaillierte Zubereitungsschritte, Nährwerte, Keyword- und Kategorieextraktion';
  }
} 