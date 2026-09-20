// "Is there a newer WhiSPa?" — asked only when the user taps to ask.
//
// WHY IT IS NOT AUTOMATIC. There is no app store here; updates come from GitHub
// releases, so finding out whether one exists means asking github.com. That
// request carries the phone's IP address and, by the endpoint it hits, the fact
// that this wallet is installed on it. A wallet that did that on every launch
// would be reporting its users to a third party on a schedule, for information
// they may not want at that moment. So this runs on a tap and never on a timer,
// and nothing here is cached to disk.
//
// WHAT IT DOES NOT DO IS DECIDE ANYTHING. This module finds out what the newest
// release is and what hash its APK should have. Downloading and installing live
// in services/apkInstaller.ts, over native code, because that is where the
// rules can be enforced rather than merely followed: the host allowlist, the
// refusal to keep a file whose hash is wrong, and the refusal to install
// anything outside the app's own cache directory.
//
// A checksum is required before anything is downloaded for installation. Both
// sources for it are fetched — the release's SHA256SUMS and, when the API
// reports one, the asset's own digest — and they have to agree. Neither is
// trustworthy on its own, since both arrive from the same place as the download
// link; the guarantee that actually holds is Android's, which refuses an update
// not signed with the same certificate as the installed app. The signed
// SHA256SUMS.asc stays the out-of-band chain for checking by hand, and About
// links to the instructions.

import Config from 'react-native-config';
import { APP_VERSION, compareVersions } from '@/version';

const OWNER = 'ponthief';
const REPO = 'thrilla';

// `releases/latest` excludes prereleases, which is what keeps the rolling CI
// builds (ci-signet-release, ci-mainnet-release) out of this. Those are
// unverified, rebuilt in place on every push to master, and not something to
// offer anybody as an update.
const LATEST_RELEASE = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

/** The file every release publishes its APK hashes in. */
const CHECKSUMS_ASSET = 'SHA256SUMS';

/** How long to wait before giving up. A stalled check must not hang the page. */
const TIMEOUT_MS = 10_000;

export interface ReleaseInfo {
  /** Bare version, no leading v. */
  version: string;
  tag: string;
  /** The release page — notes, checksums and the signature live here. */
  pageUrl: string;
  /** The APK for THIS build's network, when the release has one. */
  apkUrl: string | null;
  apkName: string | null;
  apkBytes: number | null;
  /**
   * The asset's SHA-256 as the API reports it, when it reports one.
   *
   * Not trusted on its own: it arrives in the same response as the download
   * link. It is cross-checked against the release's SHA256SUMS, so the two
   * disagreeing stops the update rather than picking one.
   */
  apiSha256: string | null;
  /** The SHA256SUMS asset, if the release published one. */
  checksumsUrl: string | null;
  publishedAt: string | null;
}

export interface UpdateStatus {
  current: string;
  latest: ReleaseInfo;
  /** True when `latest` is genuinely newer than what is running. */
  updateAvailable: boolean;
}

/** Which APK this build should be updated with: signet installs beside mainnet. */
export function flavorAssetName(): string {
  const net = (Config.NETWORK_LOCK || 'mainnet').toLowerCase();
  return `whispa-${net}.apk`;
}

export class UpdateCheckError extends Error {}

/**
 * Ask GitHub for the newest published release.
 *
 * Throws UpdateCheckError with something a user can act on — this runs behind a
 * button they pressed, so "it didn't work" has to say which part.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(LATEST_RELEASE, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new UpdateCheckError(
      e?.name === 'AbortError'
        ? 'The check timed out. Try again when you have a better connection.'
        : 'Could not reach github.com to check for an update.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 403 || resp.status === 429) {
    // Unauthenticated GitHub API calls are rate-limited per IP, and a shared
    // network can exhaust it without this phone doing anything.
    throw new UpdateCheckError(
      'GitHub is rate-limiting this network. Try again later, or open the ' +
        'releases page in a browser.',
    );
  }
  if (resp.status === 404) {
    throw new UpdateCheckError('No published release found.');
  }
  if (!resp.ok) {
    throw new UpdateCheckError(`GitHub returned ${resp.status}.`);
  }

  const body = await resp.json().catch(() => null);
  return parseRelease(body, flavorAssetName(), APP_VERSION);
}

/**
 * The GitHub release payload, reduced to what this screen needs.
 *
 * Pulled out of the fetch so it can be checked against a real response rather
 * than a guess at one. The fields are `tag_name`, `html_url`, `published_at`
 * and `assets[].{name,browser_download_url}` — everything else in a release
 * payload is ignored.
 */
export function parseRelease(
  body: any,
  assetName: string,
  current: string,
): UpdateStatus {
  const tag: string | undefined = body?.tag_name;
  if (!tag) {
    throw new UpdateCheckError('GitHub’s answer did not name a release.');
  }
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const asset = assets.find((a: any) => a?.name === assetName) || null;
  const sums = assets.find((a: any) => a?.name === CHECKSUMS_ASSET) || null;
  const version = tag.replace(/^v/, '');

  // "sha256:<hex>" on newer API responses, absent on older ones.
  const digest: string | null = asset?.digest ?? null;
  const apiSha256 =
    typeof digest === 'string' && digest.toLowerCase().startsWith('sha256:')
      ? digest.slice('sha256:'.length).toLowerCase()
      : null;

  return {
    current,
    latest: {
      version,
      tag,
      pageUrl:
        body.html_url || `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`,
      apkUrl: asset?.browser_download_url ?? null,
      apkName: asset?.name ?? null,
      apkBytes: typeof asset?.size === 'number' ? asset.size : null,
      apiSha256,
      checksumsUrl: sums?.browser_download_url ?? null,
      publishedAt: body.published_at ?? null,
    },
    updateAvailable: compareVersions(current, version) < 0,
  };
}

/**
 * Parse a SHA256SUMS file into { filename: hash }.
 *
 * The sha256sum format: a hex digest, whitespace, an optional "*" for binary
 * mode, then the filename. Anything that is not that shape is skipped rather
 * than guessed at.
 */
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text || '').split('\n')) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

/**
 * The SHA-256 this release says its APK should have.
 *
 * Fetches SHA256SUMS and, when the API also gave a digest for the asset,
 * requires the two to agree. They come from the same place, so agreeing does
 * not make either one trustworthy on its own — what it rules out is the release
 * having been re-uploaded without its checksums being updated, which would
 * otherwise show up as a mismatch after a 37 MB download instead of before it.
 *
 * Throws when there is no checksum to be had. Nothing is downloaded for
 * installation without one.
 */
export async function fetchExpectedSha256(release: ReleaseInfo): Promise<string> {
  if (!release.apkName) {
    throw new UpdateCheckError('This release has no APK for this build.');
  }
  if (!release.checksumsUrl) {
    throw new UpdateCheckError(
      `This release did not publish a ${CHECKSUMS_ASSET} file, so the download ` +
        'cannot be checked on this phone. Use the release page instead.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text: string;
  try {
    const resp = await fetch(release.checksumsUrl, { signal: controller.signal });
    if (!resp.ok) {
      throw new UpdateCheckError(
        `Could not read ${CHECKSUMS_ASSET} (${resp.status}).`,
      );
    }
    text = await resp.text();
  } catch (e: any) {
    if (e instanceof UpdateCheckError) throw e;
    throw new UpdateCheckError(
      e?.name === 'AbortError'
        ? 'Reading the checksums timed out.'
        : 'Could not reach github.com for the checksums.',
    );
  } finally {
    clearTimeout(timer);
  }

  const sums = parseChecksums(text);
  const fromFile = sums[release.apkName];
  if (!fromFile) {
    throw new UpdateCheckError(
      `${CHECKSUMS_ASSET} does not list ${release.apkName}.`,
    );
  }
  if (release.apiSha256 && release.apiSha256 !== fromFile) {
    throw new UpdateCheckError(
      `The checksums for this release disagree with each other ` +
        `(${CHECKSUMS_ASSET} says ${fromFile.slice(0, 12)}…, the API says ` +
        `${release.apiSha256.slice(0, 12)}…). Nothing has been downloaded.`,
    );
  }
  return fromFile;
}

/** The releases page, for when the check itself will not run. */
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`;
