/**
 * Push notifications (Firebase Cloud Messaging) for pings: the device registers
 * its FCM token for the current alias on the server; a ping from another alias
 * arrives as a notification that opens the shopping list. Only active in an
 * Android build that includes google-services.json (__FCM_ENABLED__) and once
 * an alias with token is set (registering is a write).
 *
 * The registration is re-sent on every start and every return to the
 * foreground (the server upserts it), so a server that was updated/redeployed
 * later or dropped the device still gets it — and its state is visible in the
 * settings (getPushStatus) instead of failing silently.
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications';
import { apiDelete, apiGet, apiPost } from './api';
import { getAlias, getToken } from './settings';
import { onAliasSettingsChanged } from './aliasSync';

export const PING_RECEIVED_EVENT = 'kochbuch:ping-received';

export const pushAvailable = Capacitor.getPlatform() === 'android' && __FCM_ENABLED__;

export type PushState = 'unavailable' | 'starting' | 'no-permission' | 'no-alias' | 'registered' | 'error';
export interface PushStatus {
  state: PushState;
  /** Alias the device is registered for (state 'registered'). */
  alias?: string;
  error?: string;
}

let status: PushStatus = { state: pushAvailable ? 'starting' : 'unavailable' };
const statusListeners = new Set<(s: PushStatus) => void>();
function setStatus(s: PushStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}
export function getPushStatus(): PushStatus {
  return status;
}
export function subscribePushStatus(fn: (s: PushStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

let fcmToken: string | null = null;
/** Alias this device was last registered for (to unregister on logout). */
let registeredAlias: string | null = null;

async function syncRegistration(): Promise<void> {
  if (!fcmToken) return;
  const alias = getAlias();
  if (!alias || !getToken()) {
    // Logged out: this device should no longer receive the old alias' pings.
    if (registeredAlias) await apiDelete(`/api/push/register?token=${encodeURIComponent(fcmToken)}`).catch(() => {});
    registeredAlias = null;
    setStatus({ state: 'no-alias' });
    return;
  }
  try {
    await apiPost('/api/push/register', { token: fcmToken, platform: 'android' });
    registeredAlias = alias;
    setStatus({ state: 'registered', alias });
  } catch (e) {
    setStatus({ state: 'error', error: `Registrierung beim Server fehlgeschlagen: ${(e as Error).message}` });
  }
}

async function requestAndRegister(): Promise<void> {
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      setStatus({ state: 'no-permission' });
      return;
    }
    await PushNotifications.register(); // → 'registration' / 'registrationError'
  } catch (e) {
    setStatus({ state: 'error', error: (e as Error).message || String(e) });
  }
}

/** Settings: "Neu registrieren" — asks for permission again if needed and re-sends the token. */
export async function reregisterPush(): Promise<void> {
  if (!pushAvailable) return;
  if (fcmToken) await syncRegistration();
  else await requestAndRegister();
}

/** Set up push once at startup. `navigate` opens the route of a tapped notification. */
export function installPush(navigate: (to: string) => void): () => void {
  if (!pushAvailable) return () => {};
  const subs: Promise<{ remove: () => Promise<void> }>[] = [];

  subs.push(
    PushNotifications.addListener('registration', (t) => {
      fcmToken = t.value;
      void syncRegistration();
    })
  );
  subs.push(
    PushNotifications.addListener('registrationError', (e) => {
      setStatus({ state: 'error', error: `Firebase-Registrierung fehlgeschlagen: ${e.error}` });
    })
  );
  subs.push(
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const route = action.notification.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) navigate(route);
    })
  );
  // In the foreground Android shows nothing by itself → in-app banner (App.tsx).
  subs.push(
    PushNotifications.addListener('pushNotificationReceived', (n: PushNotificationSchema) => {
      document.dispatchEvent(new CustomEvent(PING_RECEIVED_EVENT, { detail: n }));
    })
  );

  void (async () => {
    try {
      await PushNotifications.createChannel({
        id: 'shopping_pings',
        name: 'Einkaufslisten-Pings',
        description: 'Wenn dich jemand auf eine Einkaufsliste hinweist',
        importance: 4,
        visibility: 1,
        vibration: true
      });
    } catch {
      /* channel exists / unsupported */
    }
    await requestAndRegister();
  })();

  // Back in the foreground: re-send (server may have been redeployed or offline before).
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncRegistration();
  };
  document.addEventListener('visibilitychange', onVisible);
  const offAlias = onAliasSettingsChanged(() => void syncRegistration());
  return () => {
    offAlias();
    document.removeEventListener('visibilitychange', onVisible);
    subs.forEach((s) => void s.then((h) => h.remove()).catch(() => {}));
  };
}

export interface PingTarget {
  alias: string;
  hasDevice: boolean;
}

export function fetchPingTargets(): Promise<{ configured: boolean; aliases: PingTarget[] }> {
  return apiGet('/api/push/aliases');
}

export function pingShoppingList(listId: string, aliases: string[], message: string): Promise<{ sent: number; noDevice: string[] }> {
  return apiPost('/api/shopping-lists/ping', { listId, aliases, message });
}
