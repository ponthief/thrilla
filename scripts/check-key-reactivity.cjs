#!/usr/bin/env node
/*
 * Checks that recovering a wallet's keys reaches the surfaces that read them.
 *
 * The bug: the plain BIP-84 account key (sweepAccount) is read ONCE — on mount
 * in the web panel, in a useCallback on mobile. Recovering keys stores it but
 * told nobody, so both kept rendering the "set up plain addresses" prompt and
 * hiding the plain balance until the page was reloaded (web) or the component
 * remounted (mobile). The keys were there the whole time.
 *
 * Both fixes are a subscription, and a subscription is exactly the kind of thing
 * that survives being deleted: nothing breaks, no test fails, the feature just
 * quietly goes back to needing a reload. So they are asserted here against the
 * real sources.
 *
 * Run: node scripts/check-key-reactivity.cjs
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(name) {
  console.log(`  ok   ${name}`);
}
function fail(name, detail) {
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
}
function check(name, cond, detail) {
  cond ? ok(name) : fail(name, detail);
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const authStore = read('src/stores/auth.js');
const panel = read('src/components/PlainAddressPanel.vue');
const walletsView = read('src/views/WalletsView.vue');
const card = read('src/components/PlainAddressCard.tsx');
const recover = read('src/components/RecoverKeysModal.tsx');
const watch = read('src/hooks/usePlainWatch.ts');
const plainStatus = read('src/stores/plainStatus.ts');

// ── web: the vault announces changes ───────────────────────────────────────
console.log('web: the key vault');
{
  check('it exposes a version', /keysVersion\s*=\s*ref\(0\)/.test(authStore));
  check(
    'the version is exported from the store',
    /return \{[^}]*keysVersion[^}]*\}/s.test(authStore),
    'unexported, so no component can watch it',
  );

  const store = authStore.slice(
    authStore.indexOf('async function storeWalletKeys('),
    authStore.indexOf('async function getWalletKeys('),
  );
  const bumps = store.match(/keysVersion\.value \+= 1/g) || [];
  check(
    'storing keys bumps it on both the bridge and vault paths',
    bumps.length === 2,
    `found ${bumps.length}`,
  );
  // The vault path verifies the round-trip before returning true; waking
  // readers earlier would send them after a key that isn't readable.
  const verifyAt = store.indexOf('verification FAILED');
  const vaultBumpAt = store.lastIndexOf('keysVersion.value += 1');
  check(
    'the vault path bumps it only after the round-trip check',
    verifyAt !== -1 && vaultBumpAt > verifyAt,
  );

  const remove = authStore.slice(
    authStore.indexOf('async function removeWalletKeys('),
  );
  const removeBumps =
    (remove.slice(0, remove.indexOf('\n  }\n')).match(/keysVersion\.value \+= 1/g) || [])
      .length;
  check(
    'removing keys bumps it too, on both paths',
    removeBumps === 2,
    `found ${removeBumps}`,
  );
}

// ── web: the panel listens ─────────────────────────────────────────────────
console.log('\nweb: the plain-address panel');
{
  check(
    'it reads the account key from the vault',
    /keys\?\.sweepAccount/.test(panel),
  );
  check(
    'it re-reads when the vault version changes',
    /watch\(\(\) => auth\.keysVersion, refresh\)/.test(panel),
    'the "Set up" prompt would stay up until a page reload',
  );
  check('watch is imported', /import \{[^}]*\bwatch\b[^}]*\} from 'vue'/.test(panel));
  check(
    'Recover Keys stores the account key in the first place',
    /storeWalletKeys\([^)]*keys\.sweepAccount\)/s.test(walletsView),
  );
}

// ── mobile: the same read, the same fix ────────────────────────────────────
console.log('\nmobile: the plain-address card');
{
  check('it reads the account key', /keys\?\.sweepAccount/.test(card));
  check(
    'its refresh effect depends on the refresh tick',
    /\[refresh, refreshTick\]/.test(card),
    'recovered keys would not reach it until a remount',
  );
  check(
    'and it subscribes to that tick reactively',
    /usePlainStatus\(\(s\) => s\.refreshTick\)/.test(card),
    'getState() would not re-render on a bump',
  );
  check(
    'recovering keys asks for that refresh',
    /requestRefresh\(\)/.test(recover),
  );
  check(
    'the background watcher restarts on the same tick',
    /refreshTick/.test(watch) && /\[inkey, alertsOn, confirmedTick, refreshTick\]/.test(watch),
  );
  check(
    'the tick is a counter, so a second request still lands',
    /refreshTick: s\.refreshTick \+ 1/.test(plainStatus),
  );
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
