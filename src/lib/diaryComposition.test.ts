import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addComponent,
  applyNutritionSource,
  componentsFromResolutions,
  extraFromSource,
  nutritionForGrams,
  productCostForGrams,
  removeComponent,
  replaceComponent,
  sumComposition,
} from './diaryComposition';
import type { DiaryComponent, DiaryComposition } from '../types/tracker';
import type { IngredientResolution } from './recipeNutrition';

test('nutritionForGrams scales per-100g values', () => {
  const n = nutritionForGrams({ calories: 200, protein: 10, carbohydrates: 5, fat: 8 }, 50);
  assert.equal(n.calories, 100);
  assert.equal(n.protein, 5);
  assert.equal(n.carbohydrates, 2.5);
  assert.equal(n.fat, 4);
});

test('productCostForGrams uses net weight and default price', () => {
  const cost = productCostForGrams({ defaultPrice: 2, netGrams: 100, supermarkets: [] }, 50);
  assert.equal(cost, 1);
});

test('sumComposition totals nutrition and cost', () => {
  const composition: DiaryComposition = {
    components: [
      {
        id: 'a',
        kind: 'ingredient',
        name: 'Reis',
        grams: 100,
        nutrition: { calories: 130, protein: 3 },
        costSnapshot: 0.4,
      },
      {
        id: 'b',
        kind: 'extra',
        name: 'Ei',
        grams: 60,
        nutrition: { calories: 90, protein: 8 },
        costSnapshot: 0.3,
      },
    ],
  };
  const totals = sumComposition(composition);
  assert.equal(totals.nutrition.calories, 220);
  assert.equal(totals.nutrition.protein, 11);
  assert.equal(totals.cost, 0.7);
});

test('swap keeps grams and recalculates from the new product', () => {
  const original: DiaryComponent = {
    id: 'a',
    kind: 'ingredient',
    name: 'Reis',
    grams: 80,
    nutrition: { calories: 100 },
  };
  const swapped = applyNutritionSource(original, {
    product: {
      id: 'p1',
      name: 'Basmati',
      brand: 'Foo',
      nutritionPer100g: { calories: 350, protein: 8 },
      defaultPrice: 2,
      netGrams: 1000,
      supermarkets: [],
    },
  });
  assert.equal(swapped.name, 'Reis');
  assert.equal(swapped.productId, 'p1');
  assert.equal(swapped.productName, 'Basmati');
  assert.equal(swapped.grams, 80);
  assert.equal(swapped.nutrition.calories, 280);
  assert.equal(swapped.nutrition.protein, 6.4);
  assert.equal(swapped.costSnapshot, 0.16);
});

test('add/remove extra products', () => {
  let composition: DiaryComposition = { components: [] };
  const extra = extraFromSource(
    {
      name: 'Spiegelei',
      product: {
        id: 'egg',
        name: 'Ei',
        nutritionPer100g: { calories: 155, protein: 13 },
        supermarkets: [],
      },
    },
    60,
    () => 'extra-1'
  );
  composition = addComponent(composition, extra);
  assert.equal(composition.components.length, 1);
  assert.equal(composition.components[0].kind, 'extra');
  assert.equal(composition.components[0].nutrition.calories, 93);
  composition = removeComponent(composition, 'extra-1');
  assert.equal(composition.components.length, 0);
});

test('replaceComponent swaps one line and leaves others', () => {
  const composition: DiaryComposition = {
    components: [
      { id: 'a', kind: 'ingredient', name: 'Reis', grams: 50, nutrition: { calories: 1 } },
      { id: 'b', kind: 'ingredient', name: 'Hähnchen', grams: 80, nutrition: { calories: 2 } },
    ],
  };
  const next = replaceComponent(composition, 'a', {
    id: 'a',
    kind: 'ingredient',
    name: 'Quinoa',
    grams: 50,
    nutrition: { calories: 9 },
  });
  assert.equal(next.components[0].name, 'Quinoa');
  assert.equal(next.components[1].name, 'Hähnchen');
});

test('componentsFromResolutions scales whole-recipe amounts to the eaten portion', () => {
  const resolutions: IngredientResolution[] = [
    {
      ingredientId: 'ing-1',
      name: 'Reis',
      quantity: { amount: 200, unit: 'g' },
      grams: 200,
      state: 'exact',
      contribution: { calories: 260, protein: 8 },
      matchedCatalogueId: 'cat-1',
      matchedProductId: 'prod-1',
    },
  ];
  const priced = new Map<string, IngredientResolution>([
    [resolutions[0].ingredientId, { ...resolutions[0], price: 1.2 }],
  ]);
  // Recipe is 4 servings, ate 1 → factor 0.25
  const components = componentsFromResolutions(resolutions, priced, 0.25, () => 'c1');
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'ingredient');
  assert.equal(components[0].grams, 50);
  assert.equal(components[0].nutrition.calories, 65);
  assert.equal(components[0].nutrition.protein, 2);
  assert.equal(components[0].costSnapshot, 0.3);
  assert.equal(components[0].productId, 'prod-1');
});
