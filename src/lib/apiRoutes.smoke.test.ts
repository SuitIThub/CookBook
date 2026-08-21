/**
 * Smoke tests for the GET API routes the migrated SSR pages depend on.
 *
 * These invoke the exported route handlers directly against the real dev
 * database (read-only), asserting status + response shape. They give the
 * api-boundary migration a gate that checks more than "it compiles": if a
 * page's data source breaks, one of these should catch it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GET as recipesGET } from '../pages/api/recipes';
import { GET as shoppingListsGET } from '../pages/api/shopping-lists';
import { GET as productsGET } from '../pages/api/products/index';
import { GET as supermarketsGET } from '../pages/api/supermarkets';
import { GET as ingredientsGET } from '../pages/api/ingredients';
import { GET as permanentGET } from '../pages/api/shopping-lists/permanent/index';

/** Build a minimal APIContext-like object; handlers only read url/request/site. */
function ctx(path: string): any {
  const url = new URL(`http://localhost${path}`);
  return { url, request: new Request(url), site: undefined };
}

async function json(res: Response): Promise<any> {
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  return res.json();
}

test('GET /api/recipes returns an array', async () => {
  const data = await json(await recipesGET(ctx('/api/recipes')));
  assert.ok(Array.isArray(data), 'recipes should be an array');
});

test('GET /api/recipes?id=&action=variants returns an array', async () => {
  const all = await json(await recipesGET(ctx('/api/recipes')));
  if (all.length === 0) return; // empty DB — nothing to assert against
  const id = all[0].id;
  const variants = await json(
    await recipesGET(ctx(`/api/recipes?id=${encodeURIComponent(id)}&action=variants`))
  );
  assert.ok(Array.isArray(variants), 'variants should be an array');
});

test('GET /api/shopping-lists returns an array', async () => {
  const data = await json(await shoppingListsGET(ctx('/api/shopping-lists')));
  assert.ok(Array.isArray(data), 'shopping lists should be an array');
});

test('GET /api/shopping-lists?action=global-template returns object or null', async () => {
  const data = await json(
    await shoppingListsGET(ctx('/api/shopping-lists?action=global-template'))
  );
  assert.ok(data === null || typeof data === 'object', 'global template is object|null');
});

test('GET /api/products returns an array', async () => {
  const data = await json(await productsGET(ctx('/api/products')));
  assert.ok(Array.isArray(data), 'products should be an array');
});

test('GET /api/supermarkets returns an array', async () => {
  const data = await json(await supermarketsGET(ctx('/api/supermarkets')));
  assert.ok(Array.isArray(data), 'supermarkets should be an array');
});

test('GET /api/ingredients returns an array', async () => {
  const data = await json(await ingredientsGET(ctx('/api/ingredients')));
  assert.ok(Array.isArray(data), 'ingredients should be an array');
});

test('GET /api/shopping-lists/permanent returns object or null', async () => {
  const data = await json(await permanentGET(ctx('/api/shopping-lists/permanent')));
  assert.ok(data === null || typeof data === 'object', 'permanent list is object|null');
});
