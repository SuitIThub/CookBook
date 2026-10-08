/**
 * Server-only push notifications (Firebase Cloud Messaging, HTTP v1 API).
 *
 * Devices (the Android app) register their FCM token for the alias they're
 * logged in with; other aliases can then "ping" them, e.g. to look at a
 * shopping list. Talks to FCM directly with a service-account JWT (node:crypto)
 * instead of pulling in firebase-admin.
 *
 * Config: FIREBASE_SERVICE_ACCOUNT = path to the service-account JSON
 * (Firebase console → Projekteinstellungen → Dienstkonten), or
 * FIREBASE_SERVICE_ACCOUNT_JSON = its content. Without it, pings are disabled.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SqlDriver } from './db/driver';
import { normalizeAlias } from './auth.server';

export function ensurePushSchema(driver: SqlDriver): void {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS push_devices (
      token      TEXT PRIMARY KEY,
      alias      TEXT NOT NULL,
      platform   TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  driver.exec(`CREATE INDEX IF NOT EXISTS idx_push_devices_alias ON push_devices(alias)`);
}

export function createPushStore(driver: SqlDriver) {
  return {
    register(alias: string, token: string, platform: string): void {
      driver
        .prepare(
          `INSERT INTO push_devices (token, alias, platform, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(token) DO UPDATE SET alias = excluded.alias, platform = excluded.platform, updated_at = excluded.updated_at`
        )
        .run(token, normalizeAlias(alias), platform, Date.now());
    },
    unregister(token: string): void {
      driver.prepare('DELETE FROM push_devices WHERE token = ?').run(token);
    },
    tokensFor(alias: string): string[] {
      return (driver.prepare('SELECT token FROM push_devices WHERE alias = ?').all(normalizeAlias(alias)) as { token: string }[]).map(
        (r) => r.token
      );
    },
    /** Known profiles (aliases with a write token) + whether they have the app registered. */
    aliases(): { alias: string; hasDevice: boolean }[] {
      return driver
        .prepare(
          `SELECT t.alias AS alias, EXISTS(SELECT 1 FROM push_devices d WHERE d.alias = t.alias) AS hasDevice
           FROM alias_tokens t ORDER BY t.alias COLLATE NOCASE`
        )
        .all()
        .map((r: any) => ({ alias: r.alias, hasDevice: !!r.hasDevice }));
    }
  };
}
export type PushStore = ReturnType<typeof createPushStore>;

/* ------------------------------------------------------------------ FCM */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  try {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const path = process.env.FIREBASE_SERVICE_ACCOUNT;
    const raw = inline || (path ? readFileSync(path, 'utf8') : '');
    account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
  } catch (error) {
    console.error('FIREBASE_SERVICE_ACCOUNT could not be read:', error);
    account = null;
  }
  return account;
}

export function pushConfigured(): boolean {
  return !!serviceAccount();
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

let cachedToken: { value: string; expiresAt: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`
    })
  });
  if (!res.ok) throw new Error(`OAuth token request failed (HTTP ${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export interface PushMessage {
  title: string;
  body: string;
  /** String key/values delivered to the app (e.g. `route` to open on tap). */
  data?: Record<string, string>;
  /** Android notification channel (created by the app). */
  channelId?: string;
}

/**
 * Send to the given device tokens. Returns how many were delivered and the
 * tokens FCM reported as dead (the caller removes them).
 */
export async function sendPush(tokens: string[], message: PushMessage): Promise<{ sent: number; deadTokens: string[] }> {
  const sa = serviceAccount();
  if (!sa) throw new Error('Push ist auf dem Server nicht eingerichtet (FIREBASE_SERVICE_ACCOUNT fehlt).');
  const bearer = await accessToken(sa);
  let sent = 0;
  const deadTokens: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data ?? {},
            android: {
              priority: 'high',
              notification: { channel_id: message.channelId ?? 'shopping_pings', icon: 'ic_stat_kochbuch', color: '#ED7832' }
            }
          }
        })
      });
      if (res.ok) {
        sent++;
        return;
      }
      const text = await res.text();
      if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')) deadTokens.push(token);
      else console.error(`FCM send failed (HTTP ${res.status}):`, text);
    })
  );
  return { sent, deadTokens };
}
