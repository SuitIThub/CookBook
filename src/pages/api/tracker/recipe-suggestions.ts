import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { respond } from '../../../lib/trackerHttp';
import { recipeSuggestions } from '../../../lib/trackerService';

/** Recipes that fit the remaining daily budget (see trackerService.recipeSuggestions). */
export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  return respond(recipeSuggestions(db, { kcal: params.get('kcal'), protein: params.get('protein'), limit: params.get('limit') || undefined }));
};
