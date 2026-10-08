import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShoppingList, sameShoppingListContent } from './syncMerge';
import type { ShoppingList, ShoppingListItem } from '../types/recipe';

const item = (id: string, extra: Partial<ShoppingListItem> = {}): ShoppingListItem => ({
  id,
  name: id,
  isChecked: false,
  ...extra
});
const list = (items: ShoppingListItem[], updatedAt: string, extra: Partial<ShoppingList> = {}): ShoppingList =>
  ({
    id: 'L',
    title: 'Liste',
    items,
    recipes: [],
    createdAt: '2026-01-01T00:00:00Z' as any,
    updatedAt: updatedAt as any,
    ...extra
  }) as ShoppingList;

const base = list([item('a'), item('b'), item('c')], '2026-01-01T10:00:00Z');

test('concurrent edits to different items are both kept', () => {
  const local = list([item('a', { isChecked: true }), item('b'), item('c')], '2026-01-01T10:05:00Z');
  const remote = list([item('a'), item('b', { isChecked: true }), item('c')], '2026-01-01T10:06:00Z');
  const m = mergeShoppingList(base, local, remote);
  assert.equal(m.items.find((i) => i.id === 'a')!.isChecked, true);
  assert.equal(m.items.find((i) => i.id === 'b')!.isChecked, true);
});

test('additions on both sides are kept, deletions applied', () => {
  const local = list([item('a'), item('b'), item('c'), item('x')], '2026-01-01T10:05:00Z');
  const remote = list([item('a'), item('c'), item('y')], '2026-01-01T10:06:00Z'); // b deleted remotely
  const m = mergeShoppingList(base, local, remote);
  assert.deepEqual(
    m.items.map((i) => i.id),
    ['a', 'c', 'y', 'x']
  );
});

test('local deletion of an untouched item is applied', () => {
  const local = list([item('a'), item('c')], '2026-01-01T10:05:00Z');
  const remote = base;
  const m = mergeShoppingList(base, local, remote);
  assert.deepEqual(
    m.items.map((i) => i.id),
    ['a', 'c']
  );
});

test('edit beats a concurrent delete', () => {
  const local = list([item('a'), item('c')], '2026-01-01T10:05:00Z'); // b deleted locally
  const remote = list([item('a'), item('b', { name: 'Butter' }), item('c')], '2026-01-01T10:06:00Z');
  const m = mergeShoppingList(base, local, remote);
  assert.ok(m.items.find((i) => i.id === 'b'));
});

test('true conflict: newer list wins', () => {
  const local = list([item('a', { name: 'local' }), item('b'), item('c')], '2026-01-01T10:09:00Z');
  const remote = list([item('a', { name: 'remote' }), item('b'), item('c')], '2026-01-01T10:06:00Z');
  assert.equal(mergeShoppingList(base, local, remote).items[0].name, 'local');
  const older = { ...local, updatedAt: '2026-01-01T10:01:00Z' as any };
  assert.equal(mergeShoppingList(base, older, remote).items[0].name, 'remote');
});

test('remote notes survive a local edit of the same item', () => {
  const b = list([item('a', { note: '<p>big</p>' })], '2026-01-01T10:00:00Z');
  const local = list([item('a', { isChecked: true })], '2026-01-01T10:05:00Z'); // note stripped
  const remote = b;
  const m = mergeShoppingList({ ...b, items: [item('a')] }, local, remote);
  assert.equal(m.items[0].isChecked, true);
  assert.equal(m.items[0].note, '<p>big</p>');
});

test('scalar fields merge per field', () => {
  const local = list(base.items, '2026-01-01T10:05:00Z', { title: 'Neu' });
  const remote = list(base.items, '2026-01-01T10:06:00Z', { preferredSupermarketId: 's1' });
  const m = mergeShoppingList(base, local, remote);
  assert.equal(m.title, 'Neu');
  assert.equal(m.preferredSupermarketId, 's1');
});

test('sameShoppingListContent ignores notes and timestamps', () => {
  const a = list([item('a', { note: 'x' })], '2026-01-01T10:00:00Z');
  const b = list([item('a')], '2026-02-01T10:00:00Z');
  assert.equal(sameShoppingListContent(a, b), true);
  assert.equal(sameShoppingListContent(a, list([item('a', { isChecked: true })], '2026')), false);
});
