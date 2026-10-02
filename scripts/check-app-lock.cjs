#!/usr/bin/env node
/*
 * The app lock only works if reading the sentinel forces an OS prompt.
 *
 * WHAT WENT WRONG. react-native-keychain 8.2.0 creates the RSA key with a
 * FIVE-SECOND authentication validity window: after any device authentication
 * — including unlocking the phone itself — the key can be used again with no
 * prompt at all. services/appLock.ts is built on "a successful read means the
 * user authenticated", so inside that window the read succeeded having asked
 * nobody anything and the app unlocked on a tap.
 *
 * The window is open at exactly the moment the lock screen is shown: just
 * after the phone was unlocked, and again for five seconds after an attempt
 * that authenticated the user but failed for another reason — which is how
 * pressing "Try again" let the user straight in (2026-10-02).
 *
 * WHY THIS IS A CHECK AND NOT A TEST. The fix is a patch to a dependency's
 * Java, compiled only by a real Gradle build, and a dependency bump would drop
 * it silently. Nothing in tsc, lint or the signing checks looks at it. So this
 * reads the patch, the installed copy, and the install hook that applies it.
 *
 * Run: node scripts/check-app-lock.cjs
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
};
const read = (p) => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  } catch {
    return null;
  }
};

const PATCH = 'patches/react-native-keychain+8.2.0.patch';
const RSA =
  'node_modules/react-native-keychain/android/src/main/java/com/oblador/'
  + 'keychain/cipherStorage/CipherStorageKeystoreRsaEcb.java';

console.log('the key is bound to an authentication for every use');
{
  const patch = read(PATCH);
  ok('the patch is in the repo', !!patch, `${PATCH} is missing`);
  if (patch) {
    // 0 on R+ and -1 below it both mean "authenticate for every use".
    ok('it sets the R+ timeout to 0',
      /\+\s*keyGenParameterSpecBuilder\.setUserAuthenticationParameters\(0,/.test(patch));
    ok('and the pre-R duration to -1',
      /\+\s*keyGenParameterSpecBuilder\.setUserAuthenticationValidityDurationSeconds\(-1\)/
        .test(patch));
    ok('it removes the five-second window',
      /^-\s*final int validityDuration = 5;/m.test(patch),
      'the upstream value is what made the lock openable on a tap');
    ok('it says why, where the next person will be editing',
      /five-second window/i.test(patch));
  }
}

console.log('\nand the installed copy actually has it');
{
  // A bump, a fresh clone with no postinstall, or a patch that stopped
  // applying all look the same from here: the window is back.
  const rsa = read(RSA);
  ok('react-native-keychain is installed', !!rsa);
  if (rsa) {
    ok('no five-second validity window remains',
      !/final int validityDuration = 5;/.test(rsa),
      'the patch is not applied — run npm install');
    ok('every use needs an authentication',
      /setUserAuthenticationParameters\(0,/.test(rsa)
      && /setUserAuthenticationValidityDurationSeconds\(-1\)/.test(rsa));
    ok('the key still requires one at all',
      /setUserAuthenticationRequired\(true\)/.test(rsa));
  }
}

console.log('\nthe patch is applied by every install, and loudly');
{
  const pkg = JSON.parse(read('package.json'));
  ok('there is a postinstall hook',
    (pkg.scripts || {}).postinstall === 'patch-package --error-on-fail',
    'without --error-on-fail a patch that stops applying is a warning, and '
    + 'the build ships the window back');
  ok('patch-package is a devDependency',
    !!(pkg.devDependencies || {})['patch-package']);
}

console.log('\nnothing else in the wallet is affected');
{
  // This class is only used for entries written with an accessControl. If a
  // second one ever appears, per-use authentication starts applying to it —
  // which for a wallet key would mean a prompt on every signature.
  const src = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|vue)$/.test(e.name)) src.push([p, read(p) || '']);
    }
  };
  walk('src');
  const users = src.filter(([, body]) => /accessControl:/.test(body)).map(([p]) => p);
  ok('only the app lock binds a keystore item to an authentication',
    users.length === 1 && users[0] === 'src/services/appLock.ts',
    `also: ${users.join(', ')} — per-use auth would now apply to those too`);
}

console.log('\na sentinel made before the fix is replaced, not trusted');
{
  const lock = read('src/services/appLock.ts') || '';
  const screen = read('src/screens/LockScreen.tsx') || '';
  ok('there is a rebuild', /export async function rebuildSentinel/.test(lock));
  ok('it deletes the alias first', /resetGenericPassword\(\{ service: LOCK_SERVICE \}\)/.test(lock),
    'setGenericPassword reuses the existing key, so an overwrite keeps the old spec');
  ok('it refuses to rebuild without biometry',
    /if \(!\(await biometryType\(\)\)\)/.test(lock),
    'the rewrite would land in a storage that needs no authentication');
  ok('a downgraded rebuild turns the lock off', /await disable\(\);/.test(lock));
  ok('the lock screen rebuilds after a successful unlock',
    /sentinelKeyIsCurrent\(\)/.test(screen) && /rebuildSentinel\(\)/.test(screen));
  ok('and still lets the user in when it fails',
    screen.indexOf('rebuildSentinel()') < screen.indexOf('unlock();'),
    'they authenticated; a failed rebuild must not keep them out');
  // The original guard is the other half and must stay.
  ok('a read from a storage that enforces nothing is still not a pass',
    /function storageEnforcesAuth/.test(lock)
    && /reason: 'not-enforceable'/.test(lock));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — unlocking asks every time');
