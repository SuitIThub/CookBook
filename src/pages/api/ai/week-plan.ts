import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { aiStructured } from '../../../lib/ai';
import { weekRecommendations } from '../../../lib/trackerService';
import { taskRequestConfig, type AiSettingsLike } from '../../../lib/aiTasks';
import type { Recommendation } from '../../../lib/weekRecommendations';

/**
 * Dashboard: "KI-Wochenplan". The deterministic recommendation scoring picks
 * up to 30 candidates (same criteria as the widget); the user's structuring
 * model then assembles a balanced plan from them — which dish on which day,
 * how many portions, and why.
 *   POST { alias, favorites: string[], criteria, targetMealKcal, count, startDate: 'YYYY-MM-DD', days, ai }
 *   → { note, plan: [{ date, recipeId, title, imageUrl?, kcal?, servings, reason }] }
 */
interface PlanAnswer {
  note?: string;
  plan?: { date?: string; recipeId?: string; servings?: number; reason?: string }[];
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body?.alias) return json({ error: 'alias required' }, 400);
  const count = Math.min(10, Math.max(1, Number(body.count) || 4));
  const days = Math.min(14, Math.max(1, Number(body.days) || 7));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate ?? '') ? String(body.startDate) : localDate(new Date(Date.now() + 86_400_000));
  const dates = Array.from({ length: days }, (_, i) => localDate(new Date(new Date(`${startDate}T12:00:00`).getTime() + i * 86_400_000)));

  const scored = weekRecommendations(db, {
    alias: body.alias,
    favoriteIds: body.favorites,
    criteria: body.criteria,
    targetMealKcal: body.targetMealKcal,
    count: 30,
    seed: Date.now() // fresh candidates on every request
  });
  if (scored.status !== 200) return json(scored.body, scored.status);
  const candidates = (scored.body as { recommendations: Recommendation[] }).recommendations;
  if (candidates.length === 0) return json({ error: 'Keine passenden Rezepte gefunden.' }, 404);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const targetMealKcal = Number(body.targetMealKcal) || 0;
  const prompt = `Stelle aus den folgenden Rezepten einen ausgewogenen Essensplan zusammen. Gekocht wird als Meal Prep: ein Gericht ergibt mehrere Portionen, die über die folgenden Tage gegessen werden.

Zeitraum: ${dates[0]} bis ${dates[dates.length - 1]} (${days} Tage). Wähle GENAU ${Math.min(count, candidates.length)} verschiedene Gerichte und verteile die Koch-Tage sinnvoll über den Zeitraum.
${targetMealKcal > 0 ? `Ziel pro Hauptmahlzeit: etwa ${Math.round(targetMealKcal)} kcal.` : ''}
Achte auf Abwechslung (Kategorien, Hauptzutaten), ausreichend Eiweiß und Gemüse. Die Kandidaten sind bereits nach den Wünschen des Nutzers vorsortiert (vorne = besser passend) — bevorzuge sie, solange der Plan ausgewogen bleibt.

Antwort als JSON:
- "plan": Liste mit { "date": "YYYY-MM-DD" (Koch-Tag im Zeitraum), "recipeId": "<id aus der Liste>", "servings": Portionen (Zahl, meist die Rezept-Portionen), "reason": kurzer deutscher Satz, warum das Gericht in den Plan passt }.
- "note": 1–2 Sätze zum Plan insgesamt (Deutsch).
Verwende NUR recipeIds aus der Liste.

KANDIDATEN:
${candidates
  .map((c, i) => `${i + 1}. id=${c.id} | ${c.title}${c.category ? ` | ${c.category}` : ''}${c.kcal ? ` | ${c.estimated ? '≈' : ''}${c.kcal} kcal/Portion` : ''}${c.protein ? ` | ${c.protein} g Eiweiß` : ''}${c.reasons.length ? ` | ${c.reasons.join(', ')}` : ''}`)
  .join('\n')}`;

  const schema = {
    type: 'object',
    properties: {
      note: { type: 'string' },
      plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: { date: { type: 'string' }, recipeId: { type: 'string' }, servings: { type: 'number' }, reason: { type: 'string' } },
          required: ['date', 'recipeId', 'reason']
        }
      }
    },
    required: ['plan']
  };

  try {
    const answer = await aiStructured<PlanAnswer>(prompt, schema, taskRequestConfig((body.ai ?? {}) as AiSettingsLike, 'structure'));
    const used = new Set<string>();
    const plan = (answer.plan ?? [])
      .filter((p) => p.recipeId && byId.has(p.recipeId) && !used.has(p.recipeId) && used.add(p.recipeId))
      .map((p) => {
        const c = byId.get(p.recipeId!)!;
        const recipe = db.getRecipe(c.id);
        const servings = Number(p.servings) > 0 ? Number(p.servings) : recipe?.metadata.servings || 2;
        return {
          date: dates.includes(p.date ?? '') ? p.date! : dates[0],
          recipeId: c.id,
          title: c.title,
          imageUrl: c.imageUrl,
          kcal: c.kcal,
          servings,
          reason: (p.reason ?? '').trim()
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    if (plan.length === 0) return json({ error: 'Die KI hat keinen gültigen Plan geliefert.' }, 502);
    return json({ note: (answer.note ?? '').trim(), plan });
  } catch (e) {
    console.error('AI week plan failed:', e);
    return json({ error: `KI-Wochenplan fehlgeschlagen: ${(e as Error).message}` }, 502);
  }
};

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
