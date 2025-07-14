# Recipe Extractor System

This modular system allows extracting recipes from various websites using a factory pattern. It's designed to be easily extensible with new extractors for different websites.

## Architecture

### Base Components

1. **BaseRecipeExtractor** - Abstract base class that defines the interface
2. **RecipeExtractorFactory** - Factory class that manages extractors and selects the appropriate one
3. **ExtractedRecipeData** - Interface for raw extracted data before conversion

### Current Extractors

1. **ChefkochExtractor** - Handles Chefkoch.de specifically
2. **LeckerExtractor** - Handles Lecker.de specifically  
3. **GaumenfreundinExtractor** - Handles Gaumenfreundin.de specifically
4. **JsonLdRecipeExtractor** - Generic fallback using JSON-LD structured data

## How It Works

1. User inputs a URL in the import modal
2. Factory checks domain against registered extractors
3. Appropriate extractor is selected (or fallback used)
4. Extractor fetches and parses the website
5. Raw data is converted to our Recipe format
6. Recipe is saved to the database

## Adding a New Extractor

### Step 1: Create the Extractor Class

Create a new file in `src/lib/recipe-extractors/` (e.g., `allrecipes-extractor.ts`):

```typescript
import { BaseRecipeExtractor, type ExtractedRecipeData } from './base-extractor';

export class AllRecipesExtractor extends BaseRecipeExtractor {
  readonly name = 'AllRecipes.com Extractor';
  readonly domains = ['allrecipes.com', 'www.allrecipes.com'];
  
  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    const html = await this.fetchHtml(url);
    
    // Try JSON-LD first (most reliable)
    const jsonLdData = this.extractJsonLd(html);
    if (jsonLdData) {
      return this.parseJsonLdRecipe(jsonLdData, url);
    }
    
    // Fallback to HTML parsing with site-specific selectors
    return this.parseAllRecipesHtml(html, url);
  }
  
  private extractJsonLd(html: string): any {
    // Implementation similar to other extractors
  }
  
  private parseJsonLdRecipe(data: any, url: string): ExtractedRecipeData {
    // Parse JSON-LD data
  }
  
  private parseAllRecipesHtml(html: string, url: string): ExtractedRecipeData {
    // Parse HTML with AllRecipes-specific selectors
    // Use helper methods like this.cleanText(), this.parseTimeToMinutes()
  }
}
```

### Step 2: Register the Extractor

Add your extractor to the factory in `src/lib/recipe-extractors/factory.ts`:

```typescript
import { AllRecipesExtractor } from './allrecipes-extractor';

export class RecipeExtractorFactory {
  constructor() {
    // Register domain-specific extractors
    this.registerExtractor(new ChefkochExtractor());
    this.registerExtractor(new AllRecipesExtractor()); // Add this line
    
    // Generic JSON-LD extractor as fallback
    this.fallbackExtractor = new JsonLdRecipeExtractor();
  }
}
```

### Step 3: Test Your Extractor

1. Start the development server
2. Go to the recipe list page
3. Click "Importieren" → "URL" tab
4. Enter a URL from your target website
5. Check if the extractor is detected and works correctly

## Helper Methods Available

The base class provides several utility methods:

- `fetchHtml(url)` - Fetch HTML content with proper headers
- `cleanText(text)` - Clean and normalize text content
- `parseTimeToMinutes(timeStr)` - Parse time strings to minutes
- `generateId()` - Generate unique IDs for recipe components
- `convertToRecipeFormat(data)` - Convert extracted data to Recipe format

## Best Practices

### 1. Try JSON-LD First
Many modern recipe websites use Schema.org JSON-LD structured data. Always try this first:

```typescript
const jsonLdData = this.extractJsonLd(html);
if (jsonLdData) {
  return this.parseJsonLdRecipe(jsonLdData, url);
}
```

### 2. Fallback to HTML Parsing
If JSON-LD is not available, parse HTML with site-specific selectors:

```typescript
// Look for ingredients
const ingredientRegex = /<li[^>]*class="recipe-ingredient"[^>]*>([^<]+)<\/li>/gi;
```

### 3. Handle Errors Gracefully
Always provide fallback data:

```typescript
return {
  title: title || 'Imported Recipe',
  ingredients: ingredients.length > 0 ? ingredients : ['Bitte Zutaten manuell hinzufügen'],
  instructions: instructions.length > 0 ? instructions : ['Bitte Schritte manuell hinzufügen'],
  sourceUrl: url
};
```

### 4. Test with Multiple Recipes
Test your extractor with:
- Simple recipes (few ingredients/steps)
- Complex recipes (many ingredients, grouped steps)
- Recipes with special formatting
- Recipes with missing data

## Example Websites to Support

Popular recipe websites that could benefit from custom extractors:

- **German**: ~~Lecker.de~~ ✅, ~~Gaumenfreundin.de~~ ✅, Essen-und-trinken.de, Küchengötter.de
- **English**: AllRecipes.com, Food.com, Epicurious.com, BBC Good Food
- **International**: Marmiton.org (French), GialloZafferano.it (Italian)

## Debugging Tips

1. **Check Network Tab**: See what requests are made and if they succeed
2. **Console Logs**: Add console.log statements in your extractor
3. **View Source**: Check the actual HTML structure of the target website
4. **JSON-LD Viewer**: Use browser extensions to view structured data
5. **Test Edge Cases**: Try recipes with missing images, times, or ingredients

## API Endpoints

- `POST /api/recipes/import/url` - Import recipe from URL
- `GET /api/recipes/import/url` - Get list of supported sites and extractors

## Error Handling

The system provides user-friendly error messages for common issues:
- Network errors (website unreachable)
- Parsing errors (invalid data format)
- No recipe found (extraction failed)

All errors are logged to the console with detailed information for debugging. 