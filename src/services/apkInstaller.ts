// The JS face of android/app/src/main/java/.../updater/ApkInstallerModule.kt.
//
// Download a release APK, with the hash checked while it arrives, and hand it
// to Android's installer. Every rule about what may be downloaded and what may
// be installed is enforced natively — the host allowlist, the mandatory
// SHA-256, the "only from our own cache directory" check on install. This layer
// is types and a progress subscription, not policy, so that nothing here can be
// the thing that goes wrong.

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface ApkInstallerNative {
  canInstall(): Promise<{ allowed: boolean; askable: boolean }>;
  openInstallSettings(): Promise<boolean>;
  download(
    url: string,
    expectedSha256: string,
    fileName: string,
  ): Promise<{ path: string; sha256: string; bytes: number }>;
  install(path: string): Promise<boolean>;
  discard(): Promise<boolean>;
  cancel(): Promise<boolean>;
}

const native: ApkInstallerNative | undefined = NativeModules.ApkInstaller;

/**
 * Whether in-app updating exists in this build at all.
 *
 * False on iOS, and false on an Android build made before the native module
 * landed — a JS bundle can be newer than the binary it runs in during
 * development, and calling a missing module throws an error about the bridge
 * rather than anything a user could act on.
 */
export const IN_APP_INSTALL_SUPPORTED = Platform.OS === 'android' && !!native;

export interface DownloadProgress {
  bytes: number;
  /** -1 when the server sent no length (a chunked response). */
  total: number;
  /** 0 when the total is unknown, so a bar can fall back to indeterminate. */
  fraction: number;
}

const PROGRESS_EVENT = 'ApkInstaller:progress';

/**
 * Subscribe to download progress. Returns the unsubscribe function.
 *
 * The native side emits about every 512 KB rather than every buffer, so a 37 MB
 * APK is roughly seventy updates instead of six hundred bridge calls.
 */
export function onDownloadProgress(
  handler: (p: DownloadProgress) => void,
): () => void {
  if (!native) return () => {};
  const emitter = new NativeEventEmitter(native as any);
  const sub = emitter.addListener(PROGRESS_EVENT, handler);
  return () => sub.remove();
}

function requireNative(): ApkInstallerNative {
  if (!native) {
    throw new Error('This build cannot install updates by itself.');
  }
  return native;
}

/**
 * Is the app permitted to ask Android to install a package?
 *
 * `allowed` false with `askable` true means the user has to grant it in
 * Settings; openInstallSettings() takes them to the right page. On Android 7
 * and older there is no per-app setting, only the device-wide one, which this
 * cannot see — so it reports allowed and lets the installer say otherwise.
 */
export function canInstall(): Promise<{ allowed: boolean; askable: boolean }> {
  return requireNative().canInstall();
}

export function openInstallSettings(): Promise<boolean> {
  return requireNative().openInstallSettings();
}

/**
 * Download `url`, refusing to keep it unless it hashes to `expectedSha256`.
 *
 * The hash is required. A release without a published checksum cannot be
 * installed this way at all — the browser download stays available for that,
 * and it is the one path where the user does the verifying.
 */
export function downloadApk(
  url: string,
  expectedSha256: string,
  fileName: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  return requireNative().download(url, expectedSha256, fileName);
}

/** Hand a verified APK to Android's installer. */
export function installApk(path: string): Promise<boolean> {
  return requireNative().install(path);
}

/** Delete anything downloaded. Each APK is tens of megabytes. */
export function discardDownload(): Promise<boolean> {
  return native ? native.discard() : Promise.resolve(true);
}

/** Stop an in-flight download; the partial file is deleted. */
export function cancelDownload(): Promise<boolean> {
  return native ? native.cancel() : Promise.resolve(true);
}

/** Bytes as something to put on screen. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  const mb = n / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
