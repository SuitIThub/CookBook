import type { APIRoute } from 'astro';
import { RecipeExtractorFactory } from '../../../../lib/recipe-extractors/factory';
import type { ExtractorCapabilities } from '../../../../lib/recipe-extractors/base-extractor';

/**
 * Maps capability keys to human-readable titles
 */
function getCapabilityTitles(): Record<keyof ExtractorCapabilities, string> {
  return {
    supportsIngredientGroups: 'Zutatgruppen',
    supportsPreparationGroups: 'Zubereitungsgruppen',
    supportsImages: 'Bildextraktion',
    supportsNutrition: 'Nährwertinformationen',
    supportsMetadata: 'Metadaten',
    supportsTimeExtraction: 'Zeitextraktion',
    supportsDifficultyExtraction: 'Schwierigkeitsextraktion',
    supportsKeywordExtraction: 'Schlagwortextraktion',
    supportsCategoryExtraction: 'Kategorieextraktion',
  };
}

/**
 * Enhances capabilities with titles
 */
function enhanceCapabilitiesWithTitles(capabilities: ExtractorCapabilities): Record<string, {value: any, title: string}> {
  const titles = getCapabilityTitles();
  const enhanced: Record<string, {value: any, title: string}> = {};
  
  for (const [key, value] of Object.entries(capabilities)) {
    enhanced[key] = {
      value,
      title: titles[key as keyof ExtractorCapabilities] || key
    };
  }
  
  return enhanced;
}

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
    
    // Get the appropriate extractor for this URL
    const extractor = factory.getExtractorForUrl(url);
    
    // Get extractor capabilities
    const capabilities = extractor.getCapabilities();
    
    // Enhance capabilities with titles
    const enhancedCapabilities = enhanceCapabilitiesWithTitles(capabilities);

    const description = extractor.getDescription();
    
    return new Response(JSON.stringify({ 
      success: true,
      extractorName: extractor.name,
      domains: extractor.domains,
      capabilities: enhancedCapabilities,
      description: description,
      isSpecificExtractor: extractor.name !== 'JSON-LD Generic Extractor'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error: unknown) {
    console.error('Error getting extractor preview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      error: 'Fehler beim Analysieren der URL',
      details: errorMessage 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}; 