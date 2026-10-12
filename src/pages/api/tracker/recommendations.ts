import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { respond } from '../../../lib/trackerHttp';
import { weekRecommendations } from '../../../lib/trackerService';

/**
 * Dashboard "Für nächste Woche empfohlen" (see trackerService.weekRecommendations).
 * GET ?alias=&favorites=id,id&criteria=favorites,longNotEaten,calorieGoal,variety&targetMealKcal=&count=&seed=
 * `criteria` lists the enabled criteria (empty → none).
 */
export const GET: APIRoute = async ({ url }) => {
  const p = new URL(url).searchParams;
  const enabled = new Set((p.get('criteria') ?? '').split(',').filter(Boolean));
  return respond(
    weekRecommendations(db, {
      alias: p.get('alias'),
      favoriteIds: (p.get('favorites') ?? '').split(',').filter(Boolean),
      criteria: {
        favorites: enabled.has('favorites'),
        longNotEaten: enabled.has('longNotEaten'),
        calorieGoal: enabled.has('calorieGoal'),
        variety: enabled.has('variety')
      },
      targetMealKcal: p.get('targetMealKcal'),
      count: p.get('count'),
      seed: p.get('seed')
    })
  );
};
