/**
 * Android bridge for the cooking timers (native CookTimersPlugin): exact alarms
 * at each timer's end time + a countdown notification while timers run, so they
 * keep working with the app minimized or closed. No-ops in the browser.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeTimer {
  id: string;
  label: string;
  body: string;
  /** epoch ms */
  endsAt: number;
}

interface CookTimersPlugin {
  sync(opts: { timers: NativeTimer[] }): Promise<void>;
  dismiss(opts: { id: string }): Promise<void>;
  ensurePermission(): Promise<{ granted: boolean }>;
}
const CookTimers = registerPlugin<CookTimersPlugin>('CookTimers');

export const nativeTimers = Capacitor.getPlatform() === 'android';

/** Replace the native set of running timers. */
export function syncNativeTimers(timers: NativeTimer[]): void {
  if (!nativeTimers) return;
  CookTimers.sync({ timers }).catch(() => {});
}

/** Silence the alarm notification of a timer handled in the app. */
export function dismissNativeAlarm(id: string): void {
  if (!nativeTimers) return;
  CookTimers.dismiss({ id }).catch(() => {});
}

/** Ask for the notification permission (Android 13+) once a timer is started. */
export function ensureTimerNotifications(): void {
  if (!nativeTimers) return;
  CookTimers.ensurePermission().catch(() => {});
}
