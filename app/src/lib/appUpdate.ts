/**
 * In-app updates from GitHub releases. The release workflow
 * (.github/workflows/app-release.yml) publishes `app-v<version>` releases with
 * the signed APK; on start the app compares the newest one with its own
 * version (__APP_VERSION__ = app/package.json) and offers download + install.
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

const REPO = 'SuitIThub/CookBook';
const TAG_PREFIX = 'app-v';
const SKIP_KEY = 'kochbuch.update.skipVersion';

export const APP_VERSION = __APP_VERSION__;

export interface AvailableUpdate {
  version: string;
  notes: string;
  apkUrl: string;
  pageUrl: string;
  sizeBytes?: number;
}

interface AppUpdatePlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(opts: { url: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    fn: (p: { loaded: number; total: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

/** "1.10.2" → [1,10,2]; compares numerically (missing parts = 0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface GhRelease {
  tag_name: string;
  body?: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** Newest published app release, or null (offline / none / API limit). */
export async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
  const headers = { Accept: 'application/vnd.github+json' };
  let releases: GhRelease[];
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, headers, connectTimeout: 10000, readTimeout: 10000 });
    if (res.status !== 200) throw new Error(`GitHub antwortete mit HTTP ${res.status}`);
    releases = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } else {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub antwortete mit HTTP ${res.status}`);
    releases = await res.json();
  }
  let best: AvailableUpdate | null = null;
  for (const r of releases ?? []) {
    if (r.draft || r.prerelease || !r.tag_name?.startsWith(TAG_PREFIX)) continue;
    const apk = r.assets?.find((a) => a.name.endsWith('.apk'));
    if (!apk) continue;
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, notes: r.body ?? '', apkUrl: apk.browser_download_url, pageUrl: r.html_url, sizeBytes: apk.size };
    }
  }
  return best;
}

/**
 * Update newer than the installed app, or null. `respectSkip`: a version the
 * user chose to skip is not offered again on start (manual checks still show it).
 */
export async function checkForUpdate(respectSkip = true): Promise<AvailableUpdate | null> {
  const latest = await fetchLatestRelease();
  if (!latest || compareVersions(latest.version, APP_VERSION) <= 0) return null;
  if (respectSkip && localStorage.getItem(SKIP_KEY) === latest.version) return null;
  return latest;
}

export const SHOW_UPDATE_EVENT = 'kochbuch:show-update';

/** Open the update dialog (mounted globally in App) for this release. */
export function showUpdate(update: AvailableUpdate): void {
  document.dispatchEvent(new CustomEvent(SHOW_UPDATE_EVENT, { detail: update }));
}

export function skipVersion(version: string): void {
  localStorage.setItem(SKIP_KEY, version);
}

/** Native install is available (Android app); in a browser the APK link is opened instead. */
export const canInstallInApp = () => Capacitor.getPlatform() === 'android';

export async function installAllowed(): Promise<boolean> {
  if (!canInstallInApp()) return true;
  try {
    return (await AppUpdate.canInstall()).allowed;
  } catch {
    return true;
  }
}

export function openInstallSettings(): Promise<void> {
  return AppUpdate.openInstallSettings();
}

/** Download the APK and open the system installer; reports progress 0..1 (or null if unknown). */
export async function downloadAndInstall(update: AvailableUpdate, onProgress: (p: number | null) => void): Promise<void> {
  if (!canInstallInApp()) {
    window.open(update.apkUrl, '_blank');
    return;
  }
  const sub = await AppUpdate.addListener('downloadProgress', ({ loaded, total }) => {
    const size = total > 0 ? total : update.sizeBytes ?? 0;
    onProgress(size > 0 ? Math.min(1, loaded / size) : null);
  });
  try {
    await AppUpdate.downloadAndInstall({ url: update.apkUrl });
  } finally {
    await sub.remove().catch(() => {});
  }
}
