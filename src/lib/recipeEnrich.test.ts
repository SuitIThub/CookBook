import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueCandidates, enrichRecipeData, matchCatalogue, mentions, splitCombined, decodeEntities } from './recipeEnrich';

const CATALOGUE = ['Tomaten', 'Zwiebel', 'Knoblauch', 'Olivenöl', 'Gemüsebrühe', 'Sahne', 'Salz', 'Pfeffer', 'Ei', 'Mehl', 'Butter', 'Zucker'];

test('maps case and singular/plural onto catalogue names', () => {
  assert.deepEqual(matchCatalogue('zwiebeln', CATALOGUE), { name: 'Zwiebel' });
  assert.deepEqual(matchCatalogue('Tomate', CATALOGUE), { name: 'Tomaten' });
  assert.deepEqual(matchCatalogue('Gemuesebruehe', CATALOGUE), { name: 'Gemüsebrühe' });
});

test('drops leading qualifiers into a qualifier', () => {
  assert.deepEqual(matchCatalogue('gehackte Tomaten', CATALOGUE), { name: 'Tomaten', qualifier: 'gehackte' });
  assert.deepEqual(matchCatalogue('fein gehackte Zwiebeln', CATALOGUE), { name: 'Zwiebel', qualifier: 'fein gehackte' });
});

test('does not force unrelated or compound names onto the catalogue', () => {
  assert.equal(matchCatalogue('Kokosmilch', CATALOGUE), null);
  assert.equal(matchCatalogue('Knoblauchzehen', CATALOGUE), null); // different ingredient unit-wise; leave it
  assert.equal(matchCatalogue('Zuckerschoten', CATALOGUE), null);
  assert.equal(matchCatalogue('Salz und Pfeffer', CATALOGUE), null);
  assert.equal(matchCatalogue('Kidney Bohnen', ['Bohnen']), null);
  assert.equal(matchCatalogue('Rote Zwiebel', CATALOGUE), null); // a different product
  assert.equal(matchCatalogue('saure Sahne', CATALOGUE), null);
  assert.equal(matchCatalogue('passierte Tomaten', CATALOGUE), null);
  assert.deepEqual(matchCatalogue('große Zwiebeln', CATALOGUE), { name: 'Zwiebel', qualifier: 'große' });
  assert.deepEqual(matchCatalogue('kalte Butter', CATALOGUE), { name: 'Butter', qualifier: 'kalte' });
});

test('step text mentions: plural, compounds, umlauts', () => {
  assert.equal(mentions('Die Zwiebeln fein würfeln.', 'Zwiebel'), true);
  assert.equal(mentions('Knoblauchzehen andrücken', 'Knoblauch'), true);
  assert.equal(mentions('In Olivenöl anschwitzen', 'Olivenöl'), true);
  assert.equal(mentions('Mit der Gemüsebrühe ablöschen', 'Gemüsebrühe'), true);
  assert.equal(mentions('Zwei Eier verquirlen', 'Ei'), true);
  assert.equal(mentions('Alles verrühren', 'Mehl'), false);
  assert.equal(mentions('Eine Prise Zucker', 'Zuckerschoten'), false);
  assert.equal(mentions('Zwiebeln und Knoblauch hacken', 'Knoblauchzehen'), true);
  assert.equal(mentions('Das Hähnchen anbraten', 'Hähnchenbrustfilet'), true);
  assert.equal(mentions('Paprika würfeln', 'Paprikaschoten'), true);
  assert.equal(mentions('Paprika würfeln', 'Paprikapulver'), false);
  assert.equal(mentions('Reis kochen', 'Jasminreis'), true);
  assert.equal(mentions('Den Käse darüber reiben', 'geriebener Bergkäse'), true);
  assert.equal(mentions('Guanciale würfeln', 'Guanciale oder Pancetta'), true);
});

test('enrich: catalogue names + links for steps without links, keeps valid links', () => {
  const data: Record<string, any> = {
    ingredientGroups: [
      { id: 'g', ingredients: [
        { id: 'i1', name: 'gehackte Tomaten', quantities: [{ amount: 800, unit: 'g' }] },
        { id: 'i2', name: 'Zwiebeln', quantities: [{ amount: 1, unit: 'Stück' }] },
        { id: 'i3', name: 'Sahne', quantities: [{ amount: 50, unit: 'ml' }] }
      ] }
    ],
    preparationGroups: [
      { id: 'p', steps: [
        { id: 's1', text: 'Die Zwiebel würfeln und anschwitzen.', linkedIngredients: [] },
        { id: 's2', text: 'Tomaten zugeben.', linkedIngredients: [{ ingredientId: 'nope', selectedQuantityIndex: 0 }] },
        { id: 's3', text: 'Mit Sahne verfeinern.', linkedIngredients: [{ ingredientId: 'i1', selectedQuantityIndex: 0 }] }
      ] }
    ]
  };
  const { data: out, stats } = enrichRecipeData(data, CATALOGUE);
  const ings = out.ingredientGroups[0].ingredients;
  assert.equal(ings[0].name, 'Tomaten');
  assert.equal(ings[0].description, 'gehackte');
  assert.equal(ings[1].name, 'Zwiebel');
  const steps = out.preparationGroups[0].steps;
  assert.deepEqual(steps[0].linkedIngredients.map((l: any) => l.ingredientId), ['i2']);
  assert.deepEqual(steps[1].linkedIngredients.map((l: any) => l.ingredientId), ['i1']); // invalid id dropped, auto-linked
  assert.deepEqual(steps[2].linkedIngredients.map((l: any) => l.ingredientId), ['i1']); // AI link kept as is
  assert.deepEqual(stats, { matched: 2, linkedSteps: 2, split: 0 });
});

test('candidate list only contains catalogue names that occur in the material', () => {
  const c = catalogueCandidates('Zwiebeln und Knoblauchzehen in Olivenöl, dann gehackte Tomaten', CATALOGUE);
  assert.deepEqual(c.sort(), ['Knoblauch', 'Olivenöl', 'Tomaten', 'Zwiebel']);
});

test('splits combined lines into separate ingredients', () => {
  assert.deepEqual(splitCombined('Salz und Pfeffer', CATALOGUE), { parts: ['Salz', 'Pfeffer'], description: undefined });
  assert.deepEqual(splitCombined('Öl & Essig', CATALOGUE)?.parts, ['Öl', 'Essig']);
  assert.deepEqual(splitCombined('Salz, Pfeffer, Zucker', CATALOGUE)?.parts, ['Salz', 'Pfeffer', 'Zucker']);
  assert.deepEqual(splitCombined('Salz und Pfeffer aus der Mühle', CATALOGUE), { parts: ['Salz', 'Pfeffer'], description: 'aus der Mühle' });
  assert.deepEqual(splitCombined('Salz und Pfeffer nach Geschmack', CATALOGUE), { parts: ['Salz', 'Pfeffer'], description: 'nach Geschmack' });
  assert.equal(splitCombined('Guanciale oder Pancetta', CATALOGUE), null);
  assert.equal(splitCombined('Zwiebel', CATALOGUE), null);
  assert.equal(decodeEntities('Salz &amp; Pfeffer'), 'Salz & Pfeffer');
  assert.equal(decodeEntities('1&#32;kleine&#32;Zwiebel'), '1 kleine Zwiebel');
});

test('enrich splits "Salz und Pfeffer" and links both where the line was linked', () => {
  const data: Record<string, any> = {
    ingredientGroups: [{ id: 'g', ingredients: [{ id: 'sp', name: 'Salz und Pfeffer aus der Mühle', quantities: [{ amount: 0, unit: '' }] }] }],
    preparationGroups: [{ id: 'p', steps: [{ id: 's1', text: 'Abschmecken.', linkedIngredients: [{ ingredientId: 'sp', selectedQuantityIndex: 0 }] }] }]
  };
  const { data: out, stats } = enrichRecipeData(data, CATALOGUE);
  const ings = out.ingredientGroups[0].ingredients;
  assert.deepEqual(ings.map((i: any) => i.name), ['Salz', 'Pfeffer']);
  assert.deepEqual(ings.map((i: any) => i.description), ['aus der Mühle', 'aus der Mühle']);
  assert.equal(ings[0].id, 'sp');
  assert.notEqual(ings[1].id, 'sp');
  assert.deepEqual(out.preparationGroups[0].steps[0].linkedIngredients.map((l: any) => l.ingredientId), ['sp', ings[1].id]);
  assert.equal(stats.split, 1);
});
