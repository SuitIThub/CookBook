/**
 * Server-only alias administration (create alias, rotate its token, delete it).
 *
 * Guarded by an admin token from the environment (ADMIN_TOKEN) sent as
 * X-Admin-Token — independent of the per-alias tokens, so no alias can rotate
 * or delete another one. Without ADMIN_TOKEN the admin API is disabled.
 */
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { SqlDriver } from './db/driver';
import { normalizeAlias, setToken } from './auth.server';

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_TOKEN;
}

export function isAdmin(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN || '';
  const given = request.headers.get('x-admin-token') || '';
  if (!expected || !given) return false;
  // Compare digests: constant time and independent of the input length.
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

export interface AliasInfo {
  alias: string;
  createdAt: number | null;
  /** Has a write token (aliases may also exist only through their data). */
  hasToken: boolean;
  devices: number;
  settings: number;
  trackerEntries: number;
}

const count = (driver: SqlDriver, sql: string, alias: string): number =>
  Number((driver.prepare(sql).get(alias) as { n: number } | undefined)?.n ?? 0);

export function createAdminStore(driver: SqlDriver) {
  return {
    /** Every alias the server knows (token, settings, tracker data or devices). */
    list(): AliasInfo[] {
      const rows = driver
        .prepare(
          `SELECT alias FROM alias_tokens
           UNION SELECT alias FROM alias_settings
           UNION SELECT alias FROM push_devices
           UNION SELECT alias FROM weight_logs
           UNION SELECT alias FROM diary_entries
           UNION SELECT alias FROM meal_plans`
        )
        .all() as { alias: string }[];
      return rows
        .map(({ alias }) => {
          const tok = driver.prepare('SELECT created_at FROM alias_tokens WHERE alias = ?').get(alias) as { created_at: number } | undefined;
          return {
            alias,
            createdAt: tok ? Number(tok.created_at) : null,
            hasToken: !!tok,
            devices: count(driver, 'SELECT COUNT(*) AS n FROM push_devices WHERE alias = ?', alias),
            settings: count(driver, 'SELECT COUNT(*) AS n FROM alias_settings WHERE alias = ?', alias),
            trackerEntries:
              count(driver, 'SELECT COUNT(*) AS n FROM weight_logs WHERE alias = ?', alias) +
              count(driver, 'SELECT COUNT(*) AS n FROM diary_entries WHERE alias = ?', alias) +
              count(driver, 'SELECT COUNT(*) AS n FROM meal_plans WHERE alias = ?', alias)
          };
        })
        .sort((a, b) => a.alias.localeCompare(b.alias, 'de', { sensitivity: 'base' }));
    },

    /** Create the alias or replace its token; returns the new plaintext token (shown once). */
    issueToken(aliasRaw: string): { alias: string; token: string } {
      const alias = normalizeAlias(aliasRaw);
      if (!alias) throw new Error('alias required');
      const token = randomBytes(24).toString('base64url');
      setToken(driver, alias, token);
      return { alias, token };
    },

    /**
     * Remove the alias' token and registered devices. With `purge`, also its
     * settings and tracker data (weight, diary, meal plans) — the sync triggers
     * record those deletes, so app replicas drop the rows too.
     */
    remove(aliasRaw: string, purge: boolean): void {
      const alias = normalizeAlias(aliasRaw);
      if (!alias) throw new Error('alias required');
      driver.prepare('DELETE FROM alias_tokens WHERE alias = ?').run(alias);
      driver.prepare('DELETE FROM push_devices WHERE alias = ?').run(alias);
      if (!purge) return;
      driver.prepare('DELETE FROM alias_settings WHERE alias = ?').run(alias);
      driver.prepare('DELETE FROM diary_entries WHERE alias = ?').run(alias);
      driver.prepare('DELETE FROM meal_plans WHERE alias = ?').run(alias);
      driver.prepare('DELETE FROM weight_logs WHERE alias = ?').run(alias);
    }
  };
}
