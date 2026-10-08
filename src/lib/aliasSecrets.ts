/**
 * Secrets that must never leave the device through the alias settings sync.
 * Alias settings are stored on the server in plaintext and can be read by
 * anyone who knows the alias, so e.g. a personal OpenRouter API key stays local:
 * clients strip it before pushing and keep their own when applying a remote
 * value; the server strips it too (old clients, already stored rows).
 */
export const AI_SETTINGS_KEY = 'cookbook.ai.settings';
const SECRET_FIELDS = ['openRouterApiKey'];

/** The setting value as it may be synced (secret fields removed). */
export function stripAliasSecrets(key: string, value: string | null): string | null {
  if (key !== AI_SETTINGS_KEY || value == null) return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return value;
    let changed = false;
    for (const f of SECRET_FIELDS) {
      if (f in parsed) {
        delete parsed[f];
        changed = true;
      }
    }
    return changed ? JSON.stringify(parsed) : value;
  } catch {
    return value;
  }
}

/** Apply a synced value locally while keeping this device's own secret fields. */
export function keepLocalSecrets(key: string, remote: string | null, local: string | null): string | null {
  if (key !== AI_SETTINGS_KEY || remote == null || local == null) return remote;
  try {
    const r = JSON.parse(remote);
    const l = JSON.parse(local);
    if (!r || typeof r !== 'object' || !l || typeof l !== 'object') return remote;
    for (const f of SECRET_FIELDS) {
      if (l[f]) r[f] = l[f];
      else delete r[f];
    }
    return JSON.stringify(r);
  } catch {
    return remote;
  }
}
