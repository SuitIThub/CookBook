import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { respond, withBody } from '../../../lib/trackerHttp';
import { mealPlansDelete, mealPlansGet, mealPlansPost, mealPlansPut } from '../../../lib/trackerService';

export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  return respond(mealPlansGet(db, { alias: params.get('alias'), activeOn: params.get('activeOn'), from: params.get('from'), to: params.get('to') }));
};

export const POST: APIRoute = async ({ request }) => withBody(request, 'POST /api/tracker/meal-plans', (body) => mealPlansPost(db, body));

export const PUT: APIRoute = async ({ request }) => withBody(request, 'PUT /api/tracker/meal-plans', (body) => mealPlansPut(db, body));

export const DELETE: APIRoute = async ({ url }) => respond(mealPlansDelete(db, new URL(url).searchParams.get('id')));
