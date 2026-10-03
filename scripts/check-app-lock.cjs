#!/usr/bin/env node
/*
 * The app lock, and the one thing that must not be "fixed" again.
 *
 * THE WEAKNESS. react-native-keychain 8.2.0 generates the app lock's keystore
 * key with a FIVE-SECOND authentication validity window: after any device
 * authentication — including unlocking the phone — the key can be read again
 * with no prompt. services/appLock.ts rests on "a successful read means the
 * user authenticated", so inside that window the read succeeds having asked
 * nobody anything, and the lock screen can open on a tap. It is real, and it
 * is open at exactly the moment that screen is shown.
 *
 * THE FIX THAT DOES NOT WORK, and this is what the checks below are for. On
 * 2026-10-02 the window was closed by patching the key to per-use
 * authentication — setUserAuthenticationParameters(0, …) on R+,
 * setUserAuthenticationValidityDurationSeconds(-1) below. The library cannot
 * satisfy that: DecryptionResultHandlerInteractiveBiometric raises its prompt
 * with NO CryptoObject, so a biometric success authorises nothing, the retried
 * decrypt throws UserNotAuthenticatedException again, and the prompt loops.
 * Every device that unlocked once on that build rewrote its sentinel into a
 * key nothing could read, and its owner was locked out of the wallet.
 *
 * Closing the window properly needs a keychain whose prompt carries a
 * CryptoObject. Until then it stays open, and this file exists so the next
 * person to find it — including whoever reads the comment in appLock.ts —
 * cannot reach for the patch again without tripping a check that says why.
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

const RSA =
  'node_modules/react-native-keychain/android/src/main/java/com/oblador/'
  + 'keychain/cipherStorage/CipherStorageKeystoreRsaEcb.java';

console.log('the key spec is upstream, and stays that way');
{
  const rsa = read(RSA);
  ok('react-native-keychain is installed', !!rsa);
  if (rsa) {
    // Per-use authentication cannot be authorised by this library. A key
    // generated with it is unreadable for the life of the install.
    ok('the key is not bound per use',
      !/setUserAuthenticationParameters\(\s*0\s*,/.test(rsa)
      && !/setUserAuthenticationValidityDurationSeconds\(\s*-1\s*\)/.test(rsa),
      'this locks every user out: the prompt carries no CryptoObject, so the '
      + 'retried decrypt throws UserNotAuthenticatedException forever');
    ok('it still requires an authentication at all',
      /setUserAuthenticationRequired\(true\)/.test(rsa),
      'without this the sentinel reads with no prompt, ever');
  }
  // The patch is gone and must not come back by the same route.
  ok('no keychain patch is applied',
    !fs.existsSync(path.join(__dirname, '..', 'patches',
      'react-native-keychain+8.2.0.patch')),
    'see the header: patching this key spec is what caused the lockout');
  const pkg = JSON.parse(read('package.json'));
  ok('and no install hook re-applies one',
    !(pkg.scripts || {}).postinstall,
    'a postinstall patch-package hook is how the broken spec shipped');
}

console.log('\nthe real guard is still the storage the sentinel landed in');
{
  // This one works and predates all of the above: a read that came back from
  // a storage needing no authentication is not a pass, whatever it returned.
  const lock = read('src/services/appLock.ts') || '';
  ok('storageEnforcesAuth exists', /function storageEnforcesAuth/.test(lock));
  ok('a read from anywhere else is refused',
    /reason: 'not-enforceable'/.test(lock));
  ok('and the sentinel has to decrypt to ours',
    /res\.password !== SENTINEL/.test(lock));
  ok('enabling refuses a storage that enforces nothing',
    /if \(!storageEnforcesAuth\(storage\)\) \{\s*\n\s*await disable\(\);/.test(lock));
  // The weakness is written down where somebody would look for it.
  ok('the five-second window is documented, not hidden',
    /five-second/.test(lock) && /CryptoObject/.test(lock));
}

console.log('\na sentinel the broken build left is repaired, not trusted');
{
  const lock = read('src/services/appLock.ts') || '';
  const screen = read('src/screens/LockScreen.tsx') || '';
  ok('the marker those builds left can be found',
    /export async function sentinelKeyIsBroken/.test(lock));
  ok('a read that fails does not claim it is broken',
    /} catch \{\s*\n\s*return false;/.test(lock),
    'nothing may be torn down on the strength of a failed read');
  ok('nothing writes the marker any more',
    !/setGenericPassword\('keyver'/.test(lock));
  ok('the rebuild deletes the alias first',
    /resetGenericPassword\(\{ service: LOCK_SERVICE \}\)/.test(lock),
    'setGenericPassword reuses the existing key, so an overwrite keeps it');
  ok('it refuses to start without biometry',
    /if \(!\(await biometryType\(\)\)\)/.test(lock),
    'the rewrite would land in a storage that enforces nothing');
  // On MOUNT, not on a press and not after a successful unlock — a repair
  // behind an unlock can never run, because the key is what is unreadable.
  const at = screen.indexOf('sentinelKeyIsBroken()');
  ok('the lock screen looks for one', at !== -1);
  ok('and repairs it on mount, not behind an unlock',
    at !== -1
    && screen.lastIndexOf('useEffect(', at) > screen.lastIndexOf('useCallback(', at),
    'a repair that needs an unlock first can never run');
  ok('the button is held while it repairs',
    /\|\| repairing/.test(screen),
    'pressing Unlock against a half-replaced sentinel is a failure for nothing');
  // The repair is not a bypass, and the reasoning is written down.
  ok('and says why that is not a way past the lock',
    /NOT A WAY PAST THE LOCK/.test(lock),
    'rebuilding writes a key that still has to be READ to unlock');
}

console.log('\nnothing else in the wallet is bound to an authentication');
{
  // If a second accessControl ever appears, everything above starts applying
  // to it — for a wallet key, a prompt per signature.
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
  ok('only the app lock uses accessControl',
    users.length === 1 && users[0] === 'src/services/appLock.ts',
    `also: ${users.join(', ')}`);
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — the lock prompts, and can still be read');
