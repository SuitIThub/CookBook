import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGramsByUnitFromOff } from './openFoodFacts';
import { detectUnitInText } from './units';

// Run with: npx tsx --test src/lib/openFoodFacts.test.ts

test('serving_size with a count divides the mass per unit', () => {
  const s = deriveGramsByUnitFromOff({ serving_size: '2 Scheiben (60 g)' });
  assert.deepEqual(s, [{ unit: 'Scheibe', gramsPerUnit: 30, source: 'serving', confidence: 'high' }]);
});

test('serving_size with a single unit keeps the mass', () => {
  const s = deriveGramsByUnitFromOff({ serving_size: '1 Scheibe (30 g)' });
  assert.equal(s[0].gramsPerUnit, 30);
  assert.equal(s[0].unit, 'Scheibe');
});

test('serving_size of pure grams yields no piece suggestion', () => {
  assert.deepEqual(deriveGramsByUnitFromOff({ serving_size: '30 g' }), []);
});

test('quantity + product_quantity derives per-piece grams', () => {
  const s = deriveGramsByUnitFromOff({ quantity: '6 Scheiben', product_quantity: 300 });
  assert.deepEqual(s, [{ unit: 'Scheibe', gramsPerUnit: 50, source: 'quantity', confidence: 'medium' }]);
});

test('serving_size (high) wins over quantity (medium) for the same unit', () => {
  const s = deriveGramsByUnitFromOff({
    serving_size: '1 tranche (30 g)',
    quantity: '8 tranches',
    product_quantity: 200,
  });
  assert.equal(s.length, 1);
  assert.equal(s[0].unit, 'Scheibe');
  assert.equal(s[0].gramsPerUnit, 30);
  assert.equal(s[0].confidence, 'high');
});

test('quantity with count 1 gives no ratio', () => {
  assert.deepEqual(deriveGramsByUnitFromOff({ quantity: '1 Scheibe', product_quantity: 30 }), []);
});

test('english slices are mapped to Scheibe', () => {
  const s = deriveGramsByUnitFromOff({ serving_size: '2 slices (40 g)' });
  assert.equal(s[0].unit, 'Scheibe');
  assert.equal(s[0].gramsPerUnit, 20);
});

test('clove maps to Zehe', () => {
  const s = deriveGramsByUnitFromOff({ serving_size: '1 clove (5 g)' });
  assert.deepEqual(s, [{ unit: 'Zehe', gramsPerUnit: 5, source: 'serving', confidence: 'high' }]);
});

test('metric-only quantity yields nothing', () => {
  assert.deepEqual(deriveGramsByUnitFromOff({ quantity: '500 g', product_quantity: 500 }), []);
});

test('out-of-range grams are rejected', () => {
  assert.deepEqual(deriveGramsByUnitFromOff({ serving_size: '1 Scheibe (5000 g)' }), []);
});

test('detectUnitInText ignores metric units', () => {
  assert.equal(detectUnitInText('30 g'), null);
  assert.equal(detectUnitInText('1 Riegel'), 'Riegel');
  assert.equal(detectUnitInText('2 EL'), 'EL');
});
