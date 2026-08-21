import type { APIRoute } from 'astro';
import { db } from '../../lib/database.server';

// Keys that are allowed to be synced across devices via an alias.
const ALLOWED_KEYS = new Set([
  'theme',
  'lowBandwidth',
  'cookbook.ai.settings',
  'cookbook.recipes.layout',
  'cookbook.recipes.favorites',
  // Tracker profile: height/gender/age/activity/target — health data, but
  // stored per-alias by design. The alias modal + tracker page surface a
  // privacy warning to make expectations explicit.
  'cookbook.tracker.profile',
  // Default product per catalogue ingredient, plus preferred supermarket
  // for live price/nutrition. Per-alias so two users don't overwrite each other.
  'cookbook.ingredient.defaults',
  'cookbook.preferredSupermarket',
]);

function normalizeAlias(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

// GET all synced settings for a given alias
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const alias = normalizeAlias(url.searchParams.get('alias'));

    if (!alias) {
      return new Response(JSON.stringify({ error: 'Alias is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const settings = db.getAliasSettings(alias).filter((s) => ALLOWED_KEYS.has(s.key));

    return new Response(JSON.stringify({ alias, settings }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching alias settings:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch alias settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST a batch of setting changes for an alias (last-write-wins merge)
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const alias = normalizeAlias(body?.alias);
    const incoming = Array.isArray(body?.settings) ? body.settings : [];

    if (!alias) {
      return new Response(JSON.stringify({ error: 'Alias is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ key: string; value: string | null; updatedAt: number }> = [];

    for (const item of incoming) {
      const key = typeof item?.key === 'string' ? item.key : '';
      if (!ALLOWED_KEYS.has(key)) continue;

      const value =
        item?.value === null || item?.value === undefined ? null : String(item.value);
      const updatedAt = Number(item?.updatedAt);
      if (!Number.isFinite(updatedAt)) continue;

      const result = db.upsertAliasSetting(alias, key, value, updatedAt);
      results.push({ key, value: result.value, updatedAt: result.updatedAt });
    }

    return new Response(JSON.stringify({ alias, settings: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving alias settings:', error);
    return new Response(JSON.stringify({ error: 'Failed to save alias settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
