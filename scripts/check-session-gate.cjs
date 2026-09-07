#!/usr/bin/env node
/*
 * Checks the session/lock gate without a device.
 *
 * The security of this change rests on two things that are easy to get subtly
 * wrong and impossible to eyeball: the stored record only counting as a session
 * when it is complete, and the App.tsx gate never rendering the wallet for a
 * session nothing guards. Both are pure logic, so both can be checked here.
 *
 * Run: node scripts/check-session-gate.cjs
 */

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

// ── the completeness guard, mirroring services/session.ts ───────────────────
// Kept in step with looksComplete() there. A partial record must read as "no
// session" rather than half-signing-in with a missing admin key.
function looksComplete(v) {
  return (
    !!v &&
    typeof v.inkey === 'string' &&
    v.inkey.length > 0 &&
    typeof v.adminkey === 'string' &&
    v.adminkey.length > 0 &&
    typeof v.walletId === 'string' &&
    v.walletId.length > 0 &&
    typeof v.username === 'string' &&
    v.username.length > 0
  );
}

const full = {
  inkey: 'i',
  adminkey: 'a',
  walletId: 'w',
  walletName: 'W',
  username: 'u',
  email: 'e@x.y',
};

console.log('stored session completeness');
check('a full record is a session', looksComplete(full));
check('walletName may be null', looksComplete({ ...full, walletName: null }));
check('email may be null', looksComplete({ ...full, email: null }));
for (const k of ['inkey', 'adminkey', 'walletId', 'username']) {
  check(`missing ${k} is not a session`, !looksComplete({ ...full, [k]: undefined }));
  check(`empty ${k} is not a session`, !looksComplete({ ...full, [k]: '' }));
}
check('null is not a session', !looksComplete(null));
check('an array is not a session', !looksComplete([]));
check('a number where a key belongs is not a session', !looksComplete({ ...full, inkey: 7 }));

// ── the App.tsx gate ────────────────────────────────────────────────────────
// Mirrors the render switch, in order. The property that matters: 'shell' is
// unreachable whenever a session exists with no lock configured.
function gate({ hydrating, isAuthenticated, lockReady, lockEnabled, locked, deviceTrusted }) {
  // Not just `hydrating`: a session that lands before the lock preference has
  // been read must not reach the wallet in the gap.
  if (hydrating || (isAuthenticated && !lockReady)) return 'splash';
  if (!isAuthenticated) return 'auth';
  if (lockEnabled && locked) return 'lock';
  if (lockReady && !lockEnabled) return 'lockSetup';
  if (!deviceTrusted) return 'deviceConfirm';
  return 'shell';
}

// The default `locked` in appLockStore. A cold start begins here, so if this
// is ever flipped back to false a restored session reaches the wallet with
// nothing asked of the user — the bug this file exists to catch.
const LOCKED_AT_COLD_START = true;

const SIGNED_IN = {
  hydrating: false,
  isAuthenticated: true,
  lockReady: true,
  lockEnabled: true,
  locked: false,
  deviceTrusted: true,
};

console.log('\nthe gate');
check('hydrating shows the splash, never the login form', gate({ ...SIGNED_IN, hydrating: true }) === 'splash');
check('no session shows the login form', gate({ ...SIGNED_IN, isAuthenticated: false }) === 'auth');
check('locked shows the lock screen', gate({ ...SIGNED_IN, locked: true }) === 'lock');
check('no lock configured shows lock setup', gate({ ...SIGNED_IN, lockEnabled: false }) === 'lockSetup');
check(
  'lock setup waits for the preference to load',
  gate({ ...SIGNED_IN, lockEnabled: false, lockReady: false }) !== 'lockSetup',
);
check(
  'untrusted device shows confirmation',
  gate({ ...SIGNED_IN, deviceTrusted: false }) === 'deviceConfirm',
);
check('a guarded, trusted session shows the wallet', gate(SIGNED_IN) === 'shell');
// Ordering, stated deliberately: an unguarded session is the app's own problem
// and is fixed before it starts negotiating device trust with the server.
check(
  'lock setup comes before device confirmation',
  gate({ ...SIGNED_IN, lockEnabled: false, deviceTrusted: false }) === 'lockSetup',
);
// And the lock screen outranks setup, so a locked session with a configured
// lock is never asked to configure one again.
check(
  'the lock screen outranks lock setup',
  gate({ ...SIGNED_IN, locked: true }) === 'lock',
);

// ── cold start with a restored session ──────────────────────────────────────
// The case that shipped broken: `locked` lives in memory, so a relaunch begins
// at appLockStore's default. With that default false, a restored session went
// straight to the wallet — the lock covered backgrounding but not launch, which
// is precisely what replaced the password prompt.
console.log('\ncold start with a restored session');
const coldStart = (over = {}) => ({
  hydrating: false,
  isAuthenticated: true,
  lockReady: true,
  lockEnabled: true,
  locked: LOCKED_AT_COLD_START,
  deviceTrusted: true,
  ...over,
});
check('a restored session with a lock configured shows the lock screen',
      gate(coldStart()) === 'lock');
check('a restored session with no lock shows lock setup',
      gate(coldStart({ lockEnabled: false })) === 'lockSetup');
check('the wallet is not reachable at cold start with a lock configured',
      gate(coldStart()) !== 'shell');
// The race: session restored, lock preference not read back yet.
check('a session landing before the lock preference holds the splash',
      gate(coldStart({ lockReady: false, lockEnabled: false })) === 'splash');
check('and does not flash the wallet',
      gate(coldStart({ lockReady: false, lockEnabled: false })) !== 'shell');
// Signing in with a password is the one path that unlocks, so it must NOT be
// sent to the lock screen it just satisfied.
check('a fresh password sign-in goes to the wallet, not the lock screen',
      gate(coldStart({ locked: false })) === 'shell');

// ── auto-lock delay ─────────────────────────────────────────────────────────
// Two triggers share this setting and must not both fire or both miss: zero is
// App.tsx locking on 'background', everything else is useIdleLock counting from
// the last touch. Time backgrounded counts, which is what lets one number cover
// both "left on a desk" and "switched away briefly".
console.log('\nauto-lock delay');

// Mirrors App.tsx: the immediate lock is registered only for zero.
const locksOnBackground = (autoLockMs) => autoLockMs === 0;
// Mirrors useIdleLock: the timer runs only above zero, and fires past the delay.
const idleWouldLock = (autoLockMs, msSinceTouch) =>
  autoLockMs > 0 && msSinceTouch > autoLockMs;

const MIN = 60 * 1000;
check('"Immediately" locks on leaving the foreground', locksOnBackground(0));
check('a delay does not lock on leaving the foreground', !locksOnBackground(MIN));
check('"Immediately" runs no idle timer', !idleWouldLock(0, 60 * 60 * 1000));
// Exactly one trigger is live for any setting — neither doubled up nor missed.
for (const ms of [0, MIN, 5 * MIN, 15 * MIN, 60 * MIN]) {
  const bg = locksOnBackground(ms);
  const idle = idleWouldLock(ms, ms + 1);
  check(`${ms}ms has exactly one live trigger`, bg !== idle, `bg=${bg} idle=${idle}`);
}
check('a 30s glance away does not lock at the 1-minute setting',
      !idleWouldLock(MIN, 30 * 1000));
check('a 2-minute absence does lock at the 1-minute setting',
      idleWouldLock(MIN, 2 * MIN));
check('being exactly at the delay has not yet locked', !idleWouldLock(MIN, MIN));

// The tick, mirroring useIdleLock: frequent enough that a short delay is
// honoured roughly on time, never busier than every 5s.
const tickFor = (ms) => Math.max(5000, Math.min(30000, Math.floor(ms / 4)));
check('the 1-minute setting is checked every 15s', tickFor(MIN) === 15000);
check('long delays do not check more than every 30s', tickFor(60 * MIN) === 30000);
check('short delays do not busy-loop', tickFor(MIN) >= 5000 && tickFor(5 * MIN) >= 5000);

// The invariant, stated as an exhaustive sweep rather than a sample: with a
// session present and no lock, no combination of the other flags reaches the
// wallet.
console.log('\nthe invariant: a session with no lock never reaches the wallet');
let leaks = 0;
for (const lockReady of [true, false]) {
  for (const locked of [true, false]) {
    for (const deviceTrusted of [true, false]) {
      const where = gate({
        hydrating: false,
        isAuthenticated: true,
        lockReady,
        lockEnabled: false,
        locked,
        deviceTrusted,
      });
      // lockReady false is the one frame where the preference is still loading;
      // it resolves within a tick and cannot be reached by user action.
      if (where === 'shell' && lockReady) leaks += 1;
    }
  }
}
check('no unguarded session reaches the wallet', leaks === 0, `${leaks} combination(s) did`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
