import type { APIRoute } from 'astro';
import { RecipeExtractorFactory } from '../../lib/recipe-extractors/factory';

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
    
    return new Response(JSON.stringify({ 
      success: true,
      extractorName: extractor.name,
      domains: extractor.domains,
      capabilities: capabilities,
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