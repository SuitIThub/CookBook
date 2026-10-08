import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepLocalSecrets, stripAliasSecrets } from './aliasSecrets';

const KEY = 'cookbook.ai.settings';

test('strips the OpenRouter key from synced AI settings', () => {
  const out = stripAliasSecrets(KEY, JSON.stringify({ provider: 'openrouter', model: 'm', openRouterApiKey: 'sk-secret' }));
  assert.deepEqual(JSON.parse(out!), { provider: 'openrouter', model: 'm' });
});

test('leaves other keys and values without secrets untouched', () => {
  assert.equal(stripAliasSecrets('theme', 'dark'), 'dark');
  const v = JSON.stringify({ provider: 'ollama', model: 'x' });
  assert.equal(stripAliasSecrets(KEY, v), v);
  assert.equal(stripAliasSecrets(KEY, null), null);
  assert.equal(stripAliasSecrets(KEY, 'not json'), 'not json');
});

test('applying a remote value keeps this device’s own key', () => {
  const remote = JSON.stringify({ provider: 'openrouter', model: 'new' });
  const local = JSON.stringify({ provider: 'ollama', model: 'old', openRouterApiKey: 'sk-mine' });
  assert.deepEqual(JSON.parse(keepLocalSecrets(KEY, remote, local)!), { provider: 'openrouter', model: 'new', openRouterApiKey: 'sk-mine' });
});

test('a key arriving from remote is never adopted', () => {
  const remote = JSON.stringify({ model: 'new', openRouterApiKey: 'sk-foreign' });
  const local = JSON.stringify({ model: 'old' });
  assert.deepEqual(JSON.parse(keepLocalSecrets(KEY, remote, local)!), { model: 'new' });
});
