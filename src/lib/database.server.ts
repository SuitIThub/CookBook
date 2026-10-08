/**
 * Server entry point for the cookbook data layer.
 *
 * Constructs the singleton `db` with a better-sqlite3 driver. Server code
 * (API routes, SSR components) imports `db` / `CookbookDatabase` from here, not
 * from ./database — that module is kept driver-agnostic and better-sqlite3-free
 * so the standalone app can import the same core and back it with sql.js.
 */
import { CookbookDatabase } from './database';
import { BetterSqlite3Driver } from './db/betterSqlite3Driver';
import { ensureAuthSchema, validateToken } from './auth.server';
import { createPushStore, ensurePushSchema } from './push.server';
import { createAdminStore } from './admin.server';

export { CookbookDatabase } from './database';

const driver = new BetterSqlite3Driver('./cookbook.db');
export const db = new CookbookDatabase(driver);

// Secrets (OpenRouter key) synced by older clients into alias settings → remove.
const scrubbed = db.scrubAliasSecrets();
if (scrubbed > 0) console.log(`Removed API keys from ${scrubbed} synced alias setting(s).`);

// Server-only token table + validation (kept out of the shared core / app bundle).
ensureAuthSchema(driver);
export function validateAuth(alias: string, token: string): boolean {
  return validateToken(driver, alias, token);
}

// Server-only registry of app devices for push notifications (pings).
ensurePushSchema(driver);
export const pushStore = createPushStore(driver);

// Alias administration (create / rotate token / delete), guarded by ADMIN_TOKEN.
export const adminStore = createAdminStore(driver);
