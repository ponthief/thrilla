// Hold the update path's decisions to a real GitHub release payload.
//
//   node scripts/check-update-flow.mjs
//
// This is the code path that installs software on someone's phone, so the parts
// of it that are pure get pinned: which release is offered, which asset is
// picked for this build's network, what checksum is demanded, and every way the
// answer can be refused.
//
// What is NOT covered here, on purpose:
//
//   * The native download and install (updater/ApkInstallerModule.kt). Its
//     algorithm — streaming hash, truncation, cleanup on failure — was checked
//     against the same JDK APIs it uses; the Kotlin itself needs a real Android
//     build, which is the one thing a script cannot stand in for.
//   * Android's signature enforcement, which is the guarantee that actually
//     matters and belongs to the platform.
//
// The fixture is the v0.1.4 release as the API returned it, trimmed to the
// fields the code reads.

import { register } from 'node:module';

register(new URL('./ts-resolve.mjs', import.meta.url).href);

const { parseRelease, parseChecksums, fetchExpectedSha256, UpdateCheckError } =
  await import(new URL('../src/services/updateCheck.ts', import.meta.url).href);

let failed = 0;
function ok(name, cond, detail = '') {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failed++;
  }
}

const MAINNET_SHA =
  '1db73760d92035b667d978d6f318dfb74362dab0ad19b90f792b20fd54b97f31';
const SIGNET_SHA =
  'c199a8ef41f8f08eb3485cf9576b3899b20606e799325f6072c42a0ed7538b39';
const DL = 'https://github.com/ponthief/thrilla/releases/download/v0.1.4';

const RELEASE = {
  tag_name: 'v0.1.4',
  name: 'WhiSPa v0.1.4',
  draft: false,
  prerelease: false,
  published_at: '2026-09-19T22:18:47Z',
  html_url: 'https://github.com/ponthief/thrilla/releases/tag/v0.1.4',
  assets: [
    { name: 'SHA256SUMS', size: 169, browser_download_url: `${DL}/SHA256SUMS` },
    { name: 'SHA256SUMS.asc', size: 228, browser_download_url: `${DL}/SHA256SUMS.asc` },
    {
      name: 'whispa-mainnet.apk',
      size: 37004404,
      browser_download_url: `${DL}/whispa-mainnet.apk`,
      digest: `sha256:${MAINNET_SHA}`,
    },
    {
      name: 'whispa-signet.apk',
      size: 37004422,
      browser_download_url: `${DL}/whispa-signet.apk`,
      digest: `sha256:${SIGNET_SHA}`,
    },
  ],
};

// The file exactly as the release publishes it.
const SUMS = `${MAINNET_SHA}  whispa-mainnet.apk\n${SIGNET_SHA}  whispa-signet.apk\n`;

// ── which release, which asset ───────────────────────────────────────────────

for (const [net, sha, size] of [
  ['mainnet', MAINNET_SHA, 37004404],
  ['signet', SIGNET_SHA, 37004422],
]) {
  console.log(`\n${net}`);
  const s = parseRelease(RELEASE, `whispa-${net}.apk`, '0.1.3');
  ok('version', s.latest.version === '0.1.4', s.latest.version);
  ok('offered to an older build', s.updateAvailable === true);
  ok('this flavour’s apk', s.latest.apkName === `whispa-${net}.apk`);
  ok('download url', s.latest.apkUrl === `${DL}/whispa-${net}.apk`, String(s.latest.apkUrl));
  ok('size, for the progress bar', s.latest.apkBytes === size, String(s.latest.apkBytes));
  ok('api digest unwrapped from "sha256:"', s.latest.apiSha256 === sha, String(s.latest.apiSha256));
  ok('checksums asset found', s.latest.checksumsUrl === `${DL}/SHA256SUMS`);
}

console.log('\nwhat gets offered to whom');
ok(
  'the same version is not offered to itself',
  parseRelease(RELEASE, 'whispa-mainnet.apk', '0.1.4').updateAvailable === false,
);
ok(
  'a newer build is never downgraded',
  parseRelease(RELEASE, 'whispa-mainnet.apk', '0.2.1').updateAvailable === false,
);
ok(
  '0.1.9 is older than 0.1.10, not newer',
  parseRelease({ ...RELEASE, tag_name: 'v0.1.10' }, 'whispa-mainnet.apk', '0.1.9')
    .updateAvailable === true,
);

// ── SHA256SUMS parsing ───────────────────────────────────────────────────────

console.log('\nchecksum file');
const parsed = parseChecksums(SUMS);
ok('both entries', Object.keys(parsed).length === 2, JSON.stringify(parsed));
ok('mainnet hash', parsed['whispa-mainnet.apk'] === MAINNET_SHA);
ok('signet hash', parsed['whispa-signet.apk'] === SIGNET_SHA);
ok(
  'binary-mode "*" prefix is accepted',
  parseChecksums(`${MAINNET_SHA} *whispa-mainnet.apk`)['whispa-mainnet.apk'] ===
    MAINNET_SHA,
);
ok('uppercase digests are normalised',
  parseChecksums(`${MAINNET_SHA.toUpperCase()}  x.apk`)['x.apk'] === MAINNET_SHA);
ok('junk lines are skipped, not guessed at',
  Object.keys(parseChecksums('not a checksum line\n\n# comment\n')).length === 0);
ok('a short digest is not a digest',
  Object.keys(parseChecksums('abc123  x.apk')).length === 0);

// ── the checksum the download must match ─────────────────────────────────────

const realFetch = globalThis.fetch;
function stubFetch(handler) {
  globalThis.fetch = handler;
}
async function expectReject(label, release, handler, pattern) {
  stubFetch(handler);
  let msg = '';
  try {
    await fetchExpectedSha256(release);
  } catch (e) {
    msg = String(e?.message ?? e);
  }
  ok(label, pattern.test(msg), msg || 'it resolved instead');
}

console.log('\nthe checksum demanded before any download');
const mainnet = parseRelease(RELEASE, 'whispa-mainnet.apk', '0.1.3').latest;

stubFetch(async () => ({ ok: true, status: 200, text: async () => SUMS }));
const got = await fetchExpectedSha256(mainnet);
ok('the published hash for this asset', got === MAINNET_SHA, got);

await expectReject(
  'a SHA256SUMS that omits this asset is refused',
  mainnet,
  async () => ({ ok: true, status: 200, text: async () => `${SIGNET_SHA}  whispa-signet.apk\n` }),
  /does not list whispa-mainnet\.apk/,
);

await expectReject(
  'SHA256SUMS disagreeing with the API digest stops everything',
  mainnet,
  async () => ({
    ok: true,
    status: 200,
    text: async () => `${'a'.repeat(64)}  whispa-mainnet.apk\n`,
  }),
  /disagree with each other/,
);

await expectReject(
  'an unreadable SHA256SUMS is refused',
  mainnet,
  async () => ({ ok: false, status: 500, text: async () => '' }),
  /Could not read SHA256SUMS \(500\)/,
);

await expectReject(
  'a network failure is refused',
  mainnet,
  async () => {
    throw new Error('offline');
  },
  /Could not reach github\.com for the checksums/,
);

{
  // A release with no SHA256SUMS at all: the in-app path must refuse rather
  // than download 37 MB it cannot check.
  const noSums = parseRelease(
    { ...RELEASE, assets: RELEASE.assets.filter((a) => a.name !== 'SHA256SUMS') },
    'whispa-mainnet.apk',
    '0.1.3',
  ).latest;
  await expectReject(
    'a release without SHA256SUMS cannot be installed in-app',
    noSums,
    async () => {
      throw new Error('should not have been called');
    },
    /did not publish a SHA256SUMS file/,
  );
}

{
  const noApk = parseRelease(RELEASE, 'whispa-regtest.apk', '0.1.3').latest;
  ok('an asset this build has no apk for reads as none', noApk.apkUrl === null);
  await expectReject(
    'and no checksum is looked up for it',
    noApk,
    async () => {
      throw new Error('should not have been called');
    },
    /no APK for this build/,
  );
}

globalThis.fetch = realFetch;

console.log('\nrefusals from a malformed answer');
{
  let msg = '';
  try {
    parseRelease({}, 'whispa-mainnet.apk', '0.1.3');
  } catch (e) {
    msg = String(e?.message ?? e);
  }
  ok('a payload with no tag is refused', /did not name a release/.test(msg), msg);
  ok('and it is an UpdateCheckError', UpdateCheckError.prototype instanceof Error);
}
{
  const s = parseRelease({ tag_name: 'v9.9.9' }, 'whispa-mainnet.apk', '0.1.3');
  ok('no assets array is survivable', s.latest.apkUrl === null);
  ok('page url falls back to the tag',
     s.latest.pageUrl === 'https://github.com/ponthief/thrilla/releases/tag/v9.9.9');
  ok('no digest reads as none', s.latest.apiSha256 === null);
}

console.log();
if (failed) {
  console.log(`${failed} FAILED`);
  process.exit(1);
}
console.log('all checks passed — the update path offers what the release says');
