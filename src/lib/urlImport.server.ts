/**
 * Structured URL import (server-only): site-specific extractor or JSON-LD →
 * recipe data ready for db.createRecipe, plus warnings for the user.
 * Used by the URL import and by the AI review of an import (webImport.server.ts).
 * Throws NoRecipeDataError when the page has no structured recipe.
 */
import type { RecipeImage } from '../types/recipe';
import { db } from './database.server';
import { RecipeExtractorFactory } from './recipe-extractors/factory';
import { enrichRecipeData } from './recipeEnrich';

export interface UrlExtraction {
  data: Parameters<typeof db.createRecipe>[0];
  warnings: string[];
  extractorName: string;
}

export async function extractRecipeFromUrl(url: string): Promise<UrlExtraction> {
  // Initialize the extractor factory
  const factory = new RecipeExtractorFactory();
  
  // Check if we can extract from this URL
  if (!factory.canExtractFromUrl(url)) {
    throw new Error('Invalid URL format');
  }
  
  // Extract recipe data
  console.log(`Extracting recipe from: ${url}`);
  const extractedData = await factory.extractRecipe(url);
  console.log(`Successfully extracted recipe: ${extractedData.title}`);
  
  // Convert to our recipe format
  const extractor = factory.getExtractorForUrl(url);
  const recipeData = extractor.convertToRecipeFormat(extractedData);

  // Get extractor capabilities to generate warnings
  const capabilities = extractor.getCapabilities();
  const warnings: string[] = [];

  // Always add ingredient verification warning
  warnings.push('Bitte überprüfen Sie die extrahierten Zutaten auf Korrektheit und Vollständigkeit.');

  // Add warnings based on experimental or unsupported features
  if (!capabilities.supportsIngredientGroups) {
    warnings.push('Die Zutaten wurden ohne Gruppierung importiert. Sie können diese manuell in Gruppen organisieren.');
  }

  if (!capabilities.supportsPreparationGroups) {
    warnings.push('Die Zubereitungsschritte wurden ohne Gruppierung importiert. Sie können diese manuell in Gruppen organisieren.');
  }

  if (capabilities.supportsNutrition === 'experimental') {
    warnings.push('Die Nährwertinformationen wurden experimentell extrahiert und sollten überprüft werden.');
  }

  if (capabilities.supportsTimeExtraction === 'experimental') {
    warnings.push('Die Zeitangaben wurden experimentell extrahiert und sollten überprüft werden.');
  }

  if (capabilities.supportsDifficultyExtraction === 'experimental') {
    warnings.push('Der Schwierigkeitsgrad wurde experimentell bestimmt und sollte überprüft werden.');
  }

  if (!capabilities.supportsImages && extractedData.imageUrl) {
    warnings.push('Das Bild wurde möglicherweise nicht korrekt extrahiert und sollte überprüft werden.');
  }

  if (extractor.name === 'JSON-LD Generic Extractor') {
    warnings.push('Es wurde der generische Extraktor verwendet. Bitte überprüfen Sie alle importierten Daten besonders sorgfältig.');
  }
  
  // Convert imageUrl to images array for frontend compatibility
  const images: RecipeImage[] = [];
  if (extractedData.imageUrl) {
    images.push({
      id: `imported-${Date.now()}`,
      filename: `imported-image-${Date.now()}.jpg`,
      url: extractedData.imageUrl,
      uploadedAt: new Date()
    });
  }

  // Add source information and ensure required fields
  const finalRecipeData = {
    title: extractedData.title,
    subtitle: extractedData.subtitle,
    description: extractedData.description || '',
    category: recipeData.category, // Add category from extractor
    tags: recipeData.tags || [], // Add tags/keywords from extractor
    metadata: recipeData.metadata || {
      servings: extractedData.servings || 4,
      timeEntries: [],
      difficulty: extractedData.difficulty || 'mittel'
    },
    ingredientGroups: recipeData.ingredientGroups || [],
    preparationGroups: recipeData.preparationGroups || [],
    imageUrl: extractedData.imageUrl, // Keep for backward compatibility
    images: images, // Add images array for frontend
    sourceUrl: url // Save the source URL
  };
  
  // Site recipes never link ingredients to steps; reuse catalogue spellings too.
  const { stats: enrichStats } = enrichRecipeData(finalRecipeData, db.getAllCatalogueIngredients().map((c) => c.name));
  if (enrichStats.linkedSteps > 0) {
    warnings.push('Zutaten wurden den Zubereitungsschritten automatisch zugeordnet — bitte kurz prüfen.');
  }

  return { data: finalRecipeData, warnings, extractorName: extractor.name };
}
