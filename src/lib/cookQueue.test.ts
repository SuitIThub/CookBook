import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookQueue, purchaseSuggestions, type CookQueueState } from './cookQueue';
import type { ShoppingList, ShoppingListItem } from '../types/recipe';

function item(id: string, recipeId: string | undefined, isChecked: boolean): ShoppingListItem {
  return { id, name: id, recipeId, isChecked };
}

function list(items: ShoppingListItem[], recipes: string[]): ShoppingList {
  return {
    id: 'L',
    title: 'Liste',
    items,
    recipes: recipes.map((id) => ({ id, title: `Rezept ${id}`, servings: 4, isCompleted: false, addedAt: new Date() })),
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const empty: CookQueueState = { items: [], dismissed: {} };

test('recipe with ≥ 80 % of its items checked is suggested', () => {
  const l = list(
    [item('a1', 'A', true), item('a2', 'A', true), item('a3', 'A', true), item('a4', 'A', true), item('a5', 'A', false), item('b1', 'B', true), item('b2', 'B', false), item('x', undefined, false)],
    ['A', 'B']
  );
  const res = purchaseSuggestions(l, empty);
  assert.deepEqual(res.map((r) => [r.recipeId, r.checked, r.total]), [['A', 4, 5]]);
  assert.equal(res[0].servings, 4);
});

test('a nearly finished list lowers the per-recipe bar to 60 %', () => {
  const items = [item('a1', 'A', true), item('a2', 'A', true), item('a3', 'A', false), ...Array.from({ length: 20 }, (_, i) => item(`x${i}`, undefined, true))];
  assert.deepEqual(purchaseSuggestions(list(items, ['A']), empty).map((r) => r.recipeId), ['A']);
});

test('single-item recipes need that item checked', () => {
  assert.equal(purchaseSuggestions(list([item('a', 'A', false)], ['A']), empty).length, 0);
  assert.equal(purchaseSuggestions(list([item('a', 'A', true)], ['A']), empty).length, 1);
});

test('queued and declined recipes are not suggested again', () => {
  const l = list([item('a', 'A', true), item('b', 'B', true)], ['A', 'B']);
  const state: CookQueueState = { items: [{ recipeId: 'A', title: 'A', addedAt: 1 }], dismissed: { 'L:B': Date.now() } };
  assert.equal(purchaseSuggestions(l, state).length, 0);
});

test('parseCookQueue tolerates garbage', () => {
  assert.deepEqual(parseCookQueue('nope'), { items: [], dismissed: {} });
  assert.deepEqual(parseCookQueue(JSON.stringify({ items: [{ recipeId: 'A', title: 'x', addedAt: 1 }, { foo: 1 }], dismissed: { k: 'x', j: 2 } })), {
    items: [{ recipeId: 'A', title: 'x', addedAt: 1 }],
    dismissed: { j: 2 }
  });
});
