import type { APIRoute } from 'astro';
import type { RecipeImage } from '../../../../types/recipe';
import { db } from '../../../../lib/database';
import { RecipeExtractorFactory } from '../../../../lib/recipe-extractors/factory';
import { v4 as uuidv4 } from 'uuid';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { url } = body;
    
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Initialize the extractor factory
    const factory = new RecipeExtractorFactory();
    
    // Check if we can extract from this URL
    if (!factory.canExtractFromUrl(url)) {
      return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
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
      description: extractedData.description 
        ? `${extractedData.description}\n\nImportiert von: ${url}`
        : `Importiert von: ${url}`,
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
      images: images // Add images array for frontend
    };
    
    // Create the recipe
    const createdRecipe = db.createRecipe(finalRecipeData);
    
    return new Response(JSON.stringify({ 
      success: true, 
      recipe: createdRecipe,
      extractorUsed: extractor.name,
      sourceUrl: url,
      imported: 1,
      recipeId: createdRecipe.id,
      warnings: warnings
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error importing recipe from URL:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Provide more specific error messages
    let userMessage = 'Fehler beim Importieren des Rezepts';
    if (errorMessage.includes('Failed to fetch')) {
      userMessage = 'Die Website konnte nicht erreicht werden. Bitte überprüfen Sie die URL.';
    } else if (errorMessage.includes('JSON.parse')) {
      userMessage = 'Fehler beim Parsen der Website-Daten.';
    } else if (errorMessage.includes('extractors failed')) {
      userMessage = 'Auf dieser Website konnte kein Rezept gefunden werden.';
    }
    
    return new Response(JSON.stringify({ 
      error: userMessage,
      details: errorMessage 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async () => {
  try {
    const factory = new RecipeExtractorFactory();
    const supportedSites = factory.getSupportedSites();
    
    return new Response(JSON.stringify({ 
      supportedSites,
      totalExtractors: supportedSites.length + 1 // +1 for fallback
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting supported sites:', error);
    return new Response(JSON.stringify({ error: 'Failed to get supported sites' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 