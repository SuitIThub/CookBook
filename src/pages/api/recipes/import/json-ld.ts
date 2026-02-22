import type { APIRoute } from 'astro';
import type { RecipeImage } from '../../../../types/recipe';
import { db } from '../../../../lib/database';
import { JsonLdRecipeExtractor } from '../../../../lib/recipe-extractors/json-ld-extractor';

/**
 * POST /api/recipes/import/json-ld
 *
 * Import a recipe from raw JSON-LD (e.g. from a bookmarklet on a recipe page).
 * Body: { "jsonLd": <object|array>, "sourceUrl"?: string }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { jsonLd, sourceUrl } = body;

    if (jsonLd === undefined) {
      return new Response(
        JSON.stringify({ error: 'jsonLd is required (object or array)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const extractor = new JsonLdRecipeExtractor();
    const extractedData = extractor.parseJsonLdPayload(
      jsonLd,
      typeof sourceUrl === 'string' ? sourceUrl : ''
    );

    const recipeData = extractor.convertToRecipeFormat(extractedData);
    const capabilities = extractor.getCapabilities();
    const warnings: string[] = [];

    warnings.push(
      'Bitte überprüfen Sie die extrahierten Zutaten auf Korrektheit und Vollständigkeit.'
    );
    if (!capabilities.supportsIngredientGroups) {
      warnings.push(
        'Die Zutaten wurden ohne Gruppierung importiert. Sie können diese manuell in Gruppen organisieren.'
      );
    }
    if (!capabilities.supportsPreparationGroups) {
      warnings.push(
        'Die Zubereitungsschritte wurden ohne Gruppierung importiert. Sie können diese manuell in Gruppen organisieren.'
      );
    }
    if (capabilities.supportsNutrition === 'experimental') {
      warnings.push(
        'Die Nährwertinformationen wurden experimentell extrahiert und sollten überprüft werden.'
      );
    }
    if (capabilities.supportsTimeExtraction === 'experimental') {
      warnings.push(
        'Die Zeitangaben wurden experimentell extrahiert und sollten überprüft werden.'
      );
    }
    if (capabilities.supportsDifficultyExtraction === 'experimental') {
      warnings.push(
        'Der Schwierigkeitsgrad wurde experimentell bestimmt und sollte überprüft werden.'
      );
    }
    if (!capabilities.supportsImages && extractedData.imageUrl) {
      warnings.push(
        'Das Bild wurde möglicherweise nicht korrekt extrahiert und sollte überprüft werden.'
      );
    }
    warnings.push(
      'Import aus JSON-LD. Bitte überprüfen Sie alle importierten Daten.'
    );

    const images: RecipeImage[] = [];
    if (extractedData.imageUrl) {
      images.push({
        id: `imported-${Date.now()}`,
        filename: `imported-image-${Date.now()}.jpg`,
        url: extractedData.imageUrl,
        uploadedAt: new Date(),
      });
    }

    const finalRecipeData = {
      title: extractedData.title,
      subtitle: extractedData.subtitle,
      description: extractedData.description || '',
      category: recipeData.category,
      tags: recipeData.tags || [],
      metadata: recipeData.metadata || {
        servings: extractedData.servings || 4,
        timeEntries: [],
        difficulty: extractedData.difficulty || 'mittel',
      },
      ingredientGroups: recipeData.ingredientGroups || [],
      preparationGroups: recipeData.preparationGroups || [],
      imageUrl: extractedData.imageUrl,
      images,
      sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : '',
    };

    const createdRecipe = db.createRecipe(finalRecipeData);

    return new Response(
      JSON.stringify({
        success: true,
        recipe: createdRecipe,
        extractorUsed: extractor.name,
        sourceUrl: finalRecipeData.sourceUrl || undefined,
        imported: 1,
        recipeId: createdRecipe.id,
        warnings,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error importing recipe from JSON-LD:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    let userMessage = 'Fehler beim Importieren des Rezepts aus JSON-LD.';
    if (errorMessage.includes('No Recipe found')) {
      userMessage =
        'Im JSON-LD wurde kein Rezept (Recipe) gefunden. Bitte prüfen Sie das Format.';
    } else if (errorMessage.includes('JSON')) {
      userMessage = 'Ungültiges JSON-LD-Format.';
    }

    return new Response(
      JSON.stringify({
        error: userMessage,
        details: errorMessage,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
