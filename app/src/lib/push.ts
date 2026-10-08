/**
 * Push notifications (Firebase Cloud Messaging) for pings: the device registers
 * its FCM token for the current alias on the server; a ping from another alias
 * arrives as a notification that opens the shopping list. Only active in an
 * Android build that includes google-services.json (__FCM_ENABLED__) and once
 * an alias with token is set (registering is a write).
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications';
import { apiDelete, apiGet, apiPost } from './api';
import { getAlias, getToken } from './settings';
import { onAliasSettingsChanged } from './aliasSync';

const REGISTERED_KEY = 'kochbuch.push.registered'; // `${alias}\n${fcmToken}`
export const PING_RECEIVED_EVENT = 'kochbuch:ping-received';

export const pushAvailable = Capacitor.getPlatform() === 'android' && __FCM_ENABLED__;

let fcmToken: string | null = null;

async function syncRegistration(): Promise<void> {
  if (!fcmToken) return;
  const alias = getAlias();
  const prev = localStorage.getItem(REGISTERED_KEY);
  if (!alias || !getToken()) {
    // Logged out: this device should no longer receive the old alias' pings.
    if (prev) {
      await apiDelete(`/api/push/register?token=${encodeURIComponent(fcmToken)}`).catch(() => {});
      localStorage.removeItem(REGISTERED_KEY);
    }
    return;
  }
  const key = `${alias}\n${fcmToken}`;
  if (prev === key) return;
  try {
    await apiPost('/api/push/register', { token: fcmToken, platform: 'android' });
    localStorage.setItem(REGISTERED_KEY, key);
  } catch {
    /* offline — retried on the next start / alias change */
  }
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
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive === 'granted') await PushNotifications.register();
    } catch {
      /* push unavailable on this device */
    }
  })();

  const offAlias = onAliasSettingsChanged(() => void syncRegistration());
  return () => {
    offAlias();
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
