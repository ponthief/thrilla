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
// WHY IT DOES NOT INSTALL. Tapping through leads to the release page or the APK
// download, and Android's own installer takes it from there. Silently fetching
// and installing an APK would need REQUEST_INSTALL_PACKAGES — a permission that
// lets the app install software — and it would route around the verification
// step every release is published with (the signed SHA256SUMS at
// whispawallet.com/download.html#verify). The APK's signing certificate is
// checked by Android on every update regardless, so an APK signed by any other
// key cannot replace an installed WhiSPa; that is the guarantee worth keeping
// visible rather than hiding behind a progress bar.

import Config from 'react-native-config';
import { APP_VERSION, compareVersions } from '@/version';

const OWNER = 'ponthief';
const REPO = 'thrilla';

// `releases/latest` excludes prereleases, which is what keeps the rolling CI
// builds (ci-signet-release, ci-mainnet-release) out of this. Those are
// unverified, rebuilt in place on every push to master, and not something to
// offer anybody as an update.
const LATEST_RELEASE = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

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
  const asset =
    (Array.isArray(body.assets) ? body.assets : []).find(
      (a: any) => a?.name === assetName,
    ) || null;
  const version = tag.replace(/^v/, '');

  return {
    current,
    latest: {
      version,
      tag,
      pageUrl:
        body.html_url || `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`,
      apkUrl: asset?.browser_download_url ?? null,
      apkName: asset?.name ?? null,
      publishedAt: body.published_at ?? null,
    },
    updateAvailable: compareVersions(current, version) < 0,
  };
}

/** The releases page, for when the check itself will not run. */
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`;
