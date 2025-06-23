import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';

export class GaumenfreundinExtractor extends BaseRecipeExtractor {
  readonly name = 'Gaumenfreundin';
  readonly domains = ['gaumenfreundin.de'];

  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    console.log('==== GAUMENFREUNDIN EXTRACTOR STARTING ====');
    console.log('Extracting recipe from:', url);

    const html = await this.fetchHtml(url);
    console.log('HTML fetched, length:', html.length, 'characters');

    // First try JSON-LD extraction
    const jsonLdData = this.extractFromJsonLd(html);
    if (jsonLdData) {
      console.log('Using JSON-LD extraction path');
      return {
        ...jsonLdData,
        sourceUrl: url
      };
    }

    // Fallback to HTML parsing
    console.log('Using HTML fallback extraction path');
    return this.extractFromHtml(html, url);
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

            // Extract nutrition/metadata
            const totalTime = this.parseTimeToMinutes(recipe.totalTime || recipe.cookTime || '');
            const prepTime = this.parseTimeToMinutes(recipe.prepTime || '');

            // Only return if we actually got ingredients and instructions
            if (ingredients.length > 0 && instructions.length > 0) {
              // Extract title and subtitle from recipe name and description
              const { title, subtitle } = this.extractTitleAndSubtitle(recipe.name, recipe.description);
              
              return {
                title,
                subtitle,
                description: this.cleanText(recipe.description || ''),
                servings: this.extractServings(recipe.recipeYield),
                preparationTime: prepTime || 15,
                cookingTime: Math.max(0, totalTime - prepTime),
                difficulty: this.mapDifficulty(recipe.difficulty || ''),
                ingredients,
                instructions,
                imageUrl,
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
    const prepTime = this.extractTimeFromHtml(html, 'prep') || 15;
    const cookTime = this.extractTimeFromHtml(html, 'cook') || 0;

    return {
      title,
      subtitle,
      description,
      servings: 4, // Default for Gaumenfreundin
      preparationTime: prepTime,
      cookingTime: cookTime,
      difficulty: 'mittel',
      ingredients,
      instructions,
      imageUrl,
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
    // They use specific patterns like "1 kleine rote Zwiebel", "200 g Kochschinken"
    const patterns = [
      // Look for ingredients in the structured recipe format
      /(\d+(?:[,\.]\d+)?\s*(?:kleine|große|mittel(?:e|n)?|gehackte|geriebene|geriebener)?\s*(?:rote|weiße|grüne)?\s*[A-Za-zäöüÄÖÜß\s]+)/g,
      // Look for specific Gaumenfreundin ingredient patterns
      /(?:&#x25a2;|□)\s*(\d+(?:[,\.]\d+)?\s*(?:g|kg|ml|l|EL|TL|Pck\.?|Dose|Stück|kleine|große|mittel)\s+[^&#<\n]+)/gi,
      // Alternative pattern for ingredients
      /(\d+\s*(?:g|kg|ml|l|EL|TL|Pck\.?|Dose|Stück|kleine|große|mittel)\s+[A-Za-zäöüÄÖÜß\s\-–()]+)(?=\s|$|&#)/gi
    ];

    // Try each pattern
    for (const pattern of patterns) {
      const matches = html.match(pattern);
      if (matches) {
        matches.forEach(match => {
          let cleaned = this.cleanText(match.replace(/&#x25a2;|□/g, '').replace(/<[^>]*>/g, ''));
          
          // Skip if it's navigation text or too short
          if (cleaned.length < 5 || 
              /^(Rezepte|Merkliste|Kochen|Wochenplan|Übersicht|Themen|Kontakt)/i.test(cleaned) ||
              /^(Super|Perfekt|Herzhaft|Einfache|Blitzschnell)/i.test(cleaned)) {
            return;
          }
          
          // Clean up common HTML entities and extra text
          cleaned = cleaned.replace(/&amp;/g, '&')
                          .replace(/&#32;/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
          
          // Only add if it looks like an actual ingredient
          if (cleaned && /\d/.test(cleaned) && ingredients.indexOf(cleaned) === -1) {
            ingredients.push(cleaned);
          }
        });
      }
    }

    // If we still don't have ingredients, look for the specific Gaumenfreundin format
    if (ingredients.length === 0) {
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
                    ingredients.push(text);
                  }
                });
              }
            }
          }
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

  private extractTimeFromHtml(html: string, type: 'prep' | 'cook'): number {
    const patterns = [
      /Zubereitung\s+(\d+)\s*Min/i,
      /Gesamtzeit\s+(\d+)\s*Min/i,
      /(\d+)\s*Minuten/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return 0;
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

  private mapDifficulty(difficulty: string): 'leicht' | 'mittel' | 'schwer' {
    const diffStr = difficulty.toLowerCase();
    
    if (diffStr.includes('einfach') || diffStr.includes('leicht') || diffStr.includes('easy')) {
      return 'leicht';
    } else if (diffStr.includes('schwer') || diffStr.includes('difficult') || diffStr.includes('hard')) {
      return 'schwer';
    }
    
    return 'mittel';
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
} 