import type { BaseRecipeExtractor, ExtractedRecipeData } from './base-extractor';
import { ChefkochExtractor } from './chefkoch-extractor';
import { LeckerExtractor } from './lecker-extractor';
import { GaumenfreundinExtractor } from './gaumenfreundin-extractor';
import { JsonLdRecipeExtractor } from './json-ld-extractor';

export class RecipeExtractorFactory {
  private extractors: BaseRecipeExtractor[] = [];
  private fallbackExtractor: BaseRecipeExtractor;
  
  constructor() {
    // Register domain-specific extractors
    this.registerExtractor(new ChefkochExtractor());
    this.registerExtractor(new LeckerExtractor());
    this.registerExtractor(new GaumenfreundinExtractor());
    
    // Add more extractors here as needed
    // this.registerExtractor(new AllRecipesExtractor());
    // this.registerExtractor(new FoodNetworkExtractor());
    
    // Generic JSON-LD extractor as fallback
    this.fallbackExtractor = new JsonLdRecipeExtractor();
  }
  
  /**
   * Register a new extractor
   */
  registerExtractor(extractor: BaseRecipeExtractor): void {
    this.extractors.push(extractor);
  }
  
  /**
   * Get all registered extractors
   */
  getExtractors(): BaseRecipeExtractor[] {
    return [...this.extractors];
  }
  
  /**
   * Get the appropriate extractor for a URL
   */
  getExtractorForUrl(url: string): BaseRecipeExtractor {
    // Try to find a domain-specific extractor
    for (const extractor of this.extractors) {
      if (extractor.canExtract(url)) {
        return extractor;
      }
    }
    
    // Fall back to generic JSON-LD extractor
    return this.fallbackExtractor;
  }
  
  /**
   * Extract recipe from URL using the appropriate extractor
   */
  async extractRecipe(url: string): Promise<ExtractedRecipeData> {
    const extractor = this.getExtractorForUrl(url);
    
    try {
      return await extractor.extractRecipe(url);
    } catch (error) {
      // If the specific extractor fails, try the fallback
      if (extractor !== this.fallbackExtractor) {
        console.warn(`Extractor ${extractor.name} failed for ${url}, trying fallback`);
        try {
          return await this.fallbackExtractor.extractRecipe(url);
        } catch (fallbackError) {
          throw new Error(`Both specific and fallback extractors failed: ${error}`);
        }
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Check if we can extract from the given URL
   */
  canExtractFromUrl(url: string): boolean {
    try {
      new URL(url); // Validate URL
      return true; // We can always try with the fallback extractor
    } catch {
      return false;
    }
  }
  
  /**
   * Get information about supported sites
   */
  getSupportedSites(): Array<{name: string, domains: string[]}> {
    return this.extractors.map(extractor => ({
      name: extractor.name,
      domains: extractor.domains
    }));
  }
} 