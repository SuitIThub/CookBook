// Test script for the recipe extractor system
// This can be run in development to test extractors

import { RecipeExtractorFactory } from './factory';

export async function testExtractor(url: string) {
  console.log(`Testing URL: ${url}`);
  
  const factory = new RecipeExtractorFactory();
  
  try {
    // Check if URL can be extracted
    const canExtract = factory.canExtractFromUrl(url);
    console.log(`Can extract: ${canExtract}`);
    
    if (!canExtract) {
      throw new Error('Invalid URL format');
    }
    
    // Get the appropriate extractor
    const extractor = factory.getExtractorForUrl(url);
    console.log(`Using extractor: ${extractor.name}`);
    
    // Extract recipe data
    const startTime = Date.now();
    const extractedData = await factory.extractRecipe(url);
    const extractionTime = Date.now() - startTime;
    
    console.log(`Extraction completed in ${extractionTime}ms`);
    console.log('Extracted data:', {
      title: extractedData.title,
      ingredientCount: extractedData.ingredients.length,
      instructionCount: extractedData.instructions.length,
      servings: extractedData.servings,
      prepTime: extractedData.preparationTime,
      cookTime: extractedData.cookingTime,
      difficulty: extractedData.difficulty,
      hasImage: !!extractedData.imageUrl
    });
    
    // Convert to recipe format
    const recipeData = extractor.convertToRecipeFormat(extractedData);
    console.log('Converted recipe data:', {
      title: recipeData.title,
      metadata: recipeData.metadata,
      ingredientGroups: recipeData.ingredientGroups?.length,
      preparationGroups: recipeData.preparationGroups?.length
    });
    
    return {
      success: true,
      extractedData,
      recipeData,
      extractorUsed: extractor.name,
      extractionTime
    };
    
  } catch (error) {
    console.error('Extraction failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Test URLs for different extractors
export const testUrls = {
  chefkoch: [
    'https://www.chefkoch.de/rezepte/1234567890/Test-Rezept.html',
    // Add real Chefkoch URLs here for testing
  ],
  generic: [
    // URLs that should work with JSON-LD fallback
    'https://www.allrecipes.com/recipe/213742/cheesy-chicken-broccoli-casserole/',
    'https://cooking.nytimes.com/recipes/1018045-chocolate-chip-cookies',
  ]
};

// Helper function to test multiple URLs
export async function testMultipleUrls(urls: string[]) {
  console.log(`Testing ${urls.length} URLs...`);
  
  const results = [];
  
  for (const url of urls) {
    console.log(`\n--- Testing: ${url} ---`);
    const result = await testExtractor(url);
    results.push({ url, ...result });
    
    // Add delay between requests to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n--- Summary ---');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Successful: ${successful.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);
  
  if (failed.length > 0) {
    console.log('Failed URLs:');
    failed.forEach(r => console.log(`  - ${r.url}: ${r.error}`));
  }
  
  return results;
}

// Usage examples:
// await testExtractor('https://www.chefkoch.de/rezepte/...');
// await testMultipleUrls(testUrls.generic); 