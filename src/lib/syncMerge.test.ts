import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShoppingList, sameShoppingListContent, stripShoppingListNotes, noteDigest, NOTE_INLINE_MAX } from './syncMerge';
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

test('stripped big note (noteRef) survives a local edit of the same item', () => {
  const big = '<p>' + 'x'.repeat(NOTE_INLINE_MAX + 10) + '</p>';
  const full = list([item('a', { note: big })], '2026-01-01T10:00:00Z');
  const stripped = stripShoppingListNotes(full);
  assert.equal((stripped.items[0] as any).noteRef, noteDigest(big));
  assert.equal(stripped.items[0].note, undefined);
  const local = list([{ ...stripped.items[0], isChecked: true }], '2026-01-01T10:05:00Z');
  const m = mergeShoppingList(stripped, local, full);
  assert.equal(m.items[0].isChecked, true);
  assert.equal(m.items[0].note, big);
  assert.equal((m.items[0] as any).noteRef, undefined);
});

test('small notes travel inline and note edits merge', () => {
  const b = list([item('a', { note: 'alt' }), item('b')], '2026-01-01T10:00:00Z');
  assert.equal(stripShoppingListNotes(b).items[0].note, 'alt');
  const local = list([item('a', { note: 'neu' }), item('b')], '2026-01-01T10:05:00Z');
  const remote = list([item('a', { note: 'alt' }), item('b', { isChecked: true })], '2026-01-01T10:06:00Z');
  const m = mergeShoppingList(b, local, remote);
  assert.equal(m.items[0].note, 'neu');
  assert.equal(m.items[1].isChecked, true);
});

test('scalar fields merge per field', () => {
  const local = list(base.items, '2026-01-01T10:05:00Z', { title: 'Neu' });
  const remote = list(base.items, '2026-01-01T10:06:00Z', { preferredSupermarketId: 's1' });
  const m = mergeShoppingList(base, local, remote);
  assert.equal(m.title, 'Neu');
  assert.equal(m.preferredSupermarketId, 's1');
});

test('sameShoppingListContent compares notes by digest, ignores timestamps', () => {
  const big = 'y'.repeat(NOTE_INLINE_MAX + 1);
  const a = list([item('a', { note: big })], '2026-01-01T10:00:00Z');
  assert.equal(sameShoppingListContent(a, stripShoppingListNotes({ ...a, updatedAt: '2026-02-01' as any })), true);
  assert.equal(sameShoppingListContent(a, list([item('a', { note: 'other' })], '2026')), false);
  assert.equal(sameShoppingListContent(a, list([item('a', { note: big, isChecked: true })], '2026')), false);
});
