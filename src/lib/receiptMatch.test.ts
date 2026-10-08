import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidentMatch, lineWeight, rankProducts, scoreProduct } from './receiptMatch';

const P = [
  { id: 'gouda', name: 'Gouda jung', brand: 'Milram', netGrams: 400 },
  { id: 'gouda-alt', name: 'Gouda alt', brand: 'Milram', netGrams: 400 },
  { id: 'tomaten', name: 'Passierte Tomaten', brand: 'Mutti', netGrams: 500 },
  { id: 'milch', name: 'Frische Vollmilch 3,5%', brand: 'Weihenstephan', netGrams: 1000 },
  { id: 'butter', name: 'Deutsche Markenbutter', brand: 'Kerrygold', netGrams: 250 }
];

test('pack size on the line', () => {
  assert.equal(lineWeight('GOUDA JG 400G'), 400);
  assert.equal(lineWeight('H-MILCH 1,5L'), 1500);
  assert.equal(lineWeight('KAFFEE 0.5KG'), 500);
  assert.equal(lineWeight('BUTTER'), null);
});

test('abbreviations and dropped vowels match the right product', () => {
  assert.equal(confidentMatch(rankProducts('GOUDA JG 400G', P))?.id, 'gouda');
  assert.equal(confidentMatch(rankProducts('MUTTI PASS.TMTN', P))?.id, 'tomaten');
  assert.equal(confidentMatch(rankProducts('WEIHENST. VOLLMILCH', P))?.id, 'milch');
  assert.equal(confidentMatch(rankProducts('KERRYGOLD MARKENBUTTER', P))?.id, 'butter');
});

test('ambiguous or unknown lines are not forced', () => {
  assert.equal(confidentMatch(rankProducts('GOUDA 400G', P)), null); // jung vs alt
  assert.equal(confidentMatch(rankProducts('TRAGETASCHE', P)), null);
  assert.ok(scoreProduct('BANANEN', P[0]) === 0);
});

test('a contradicting pack size lowers the score', () => {
  assert.ok(scoreProduct('GOUDA JG 1KG', P[0]) < scoreProduct('GOUDA JG 400G', P[0]));
});
