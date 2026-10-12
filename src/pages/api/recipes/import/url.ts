import type { APIRoute } from 'astro';
import { db } from '../../../../lib/database.server';
import { RecipeExtractorFactory } from '../../../../lib/recipe-extractors/factory';
import { NoRecipeDataError } from '../../../../lib/recipe-extractors/base-extractor';
import { extractRecipeFromUrl } from '../../../../lib/urlImport.server';

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
    
    if (!/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { data: finalRecipeData, warnings, extractorName } = await extractRecipeFromUrl(url);

    // Create the recipe
    const createdRecipe = db.createRecipe(finalRecipeData);
    
    return new Response(JSON.stringify({ 
      success: true, 
      recipe: createdRecipe,
      extractorUsed: extractorName,
      sourceUrl: url,
      imported: 1,
      recipeId: createdRecipe.id,
      warnings: warnings
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    // No recipe data on the page → the client imports it with AI (api/recipes/import/web).
    if (error instanceof NoRecipeDataError) {
      return new Response(JSON.stringify({
        error: 'Die Seite enthält keine Rezept-Daten.',
        code: 'NO_RECIPE_DATA'
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    console.error('Error importing recipe from URL:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Provide more specific error messages
    let userMessage = 'Fehler beim Importieren des Rezepts';
    if (errorMessage.includes('timed out')) {
      userMessage = 'Die Website hat zu lange nicht geantwortet. Manche Seiten (z. B. rewe.de) blockieren oder verzögern automatische Zugriffe – bitte versuchen Sie es später oder geben Sie das Rezept manuell ein.';
    } else if (errorMessage.includes('Failed to fetch')) {
      if (errorMessage.includes(': 403')) {
        userMessage = 'Die Website blockiert automatische Zugriffe (z. B. rewe.de). Bitte geben Sie das Rezept manuell ein oder kopieren Sie die Rezeptdaten per Hand.';
      } else {
        userMessage = 'Die Website konnte nicht erreicht werden. Bitte überprüfen Sie die URL und Ihre Internetverbindung.';
      }
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