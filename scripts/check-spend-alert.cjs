#!/usr/bin/env node
/*
 * Checks the unexpected-spend warning, by reading the real sources.
 *
 * The detection itself is the backend's (siLNt helpers/spend_watch.py, checked
 * there). What can go wrong on this side is quieter and all of it is a way for
 * the warning to NOT be seen: a poll failure taking it down, the push being
 * swallowed by a notification preference, a routine payment banner drawn over
 * it, or an acknowledgement that any key can send.
 *
 * These are structural assertions against the files rather than a
 * reimplementation of them, so they cannot pass while the code says otherwise.
 *
 * Run: node scripts/check-spend-alert.cjs
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

const push = read('src/services/push.ts');
const watch = read('src/hooks/useSpendWatch.ts');
const banner = read('src/components/SpendAlertBanner.tsx');
const store = read('src/stores/spendAlertStore.ts');
const api = read('src/services/api.ts');
const app = read('src/App.tsx');
const pushBanner = read('src/components/PushBanner.tsx');

// ── the push must not be filtered by the payment-alerts preference ──────────
// A user who turned payment notifications off has not asked to be kept in the
// dark about their key being used by someone else.
console.log('the foreground push');
{
  const spendAt = push.indexOf("'unexpected_spend'");
  const prefAt = push.indexOf('!paymentAlertsOn()');
  check('the unexpected-spend branch exists', spendAt !== -1);
  check('the payment-alerts gate exists', prefAt !== -1);
  check(
    'it is handled before the payment-alerts gate',
    spendAt !== -1 && prefAt !== -1 && spendAt < prefAt,
    'switching off payment alerts would silence a compromise warning',
  );
  const branch = push.slice(spendAt, spendAt + 400);
  check(
    'it asks the watcher to refresh',
    /requestRefresh\(\)/.test(branch.split('return;')[0]),
  );
  check(
    'it does not raise a six-second payment banner',
    !/usePushBanner/.test(branch.split('return;')[0]),
    'the transient banner would be the one left on screen',
  );
}

// ── a failed poll must leave the warning alone ──────────────────────────────
console.log('\nthe watcher');
{
  const catchAt = watch.indexOf('} catch {');
  check('the poll catches its own failures', catchAt !== -1);
  const body = watch.slice(catchAt, watch.indexOf('}', watch.indexOf('\n', catchAt)));
  check(
    'a failed poll does not clear the alerts',
    !/clear\(\)|\.set\(/.test(body),
    'losing the network would take the warning down',
  );
  // clear() belongs to exactly one place: signing out.
  const clears = watch.match(/\.clear\(\)/g) || [];
  check('clear() is called exactly once', clears.length === 1, `found ${clears.length}`);
  const signOut = watch.indexOf('if (!inkey)');
  check(
    'and only on the signed-out path',
    signOut !== -1 && watch.indexOf('.clear()') > signOut && watch.indexOf('.clear()') < watch.indexOf('let cancelled'),
  );
  check(
    'a refresh request re-runs the effect',
    /refreshTick/.test(watch) && /\[inkey, refreshTick\]/.test(watch),
  );
  check(
    'it does not poll while backgrounded',
    /AppState\.currentState !== 'active'/.test(watch),
  );
}

// ── the warning outranks routine notices, and does not time out ─────────────
console.log('\nthe banner');
{
  const z = (src) => {
    const m = src.match(/zIndex:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  };
  check('the payment banner declares a zIndex', z(pushBanner) !== null);
  check('the warning declares a zIndex', z(banner) !== null);
  check(
    'the warning sits above routine payment banners',
    z(banner) > z(pushBanner),
    `${z(banner)} vs ${z(pushBanner)}`,
  );
  check(
    'it does not auto-dismiss',
    !/setTimeout/.test(banner),
    'a compromise warning must stay until it is acted on',
  );
  check(
    'it renders nothing when there is nothing to warn about',
    /if \(!alerts\.length\) return null;/.test(banner),
  );
  check('it is mounted in the shell', /<SpendAlertBanner \/>/.test(app));
  check('the watcher is mounted in the shell', /useSpendWatch\(\)/.test(app));
}

// ── the remedy the copy names ──────────────────────────────────────────────
// Replacing the attacker's transaction spends the same coins with the same key
// they hold; the action that helps is moving what they have not touched. The
// backend push says so (helpers/spend_watch.py) and this must not disagree.
console.log('\nwhat it tells the user to do');
{
  const primary = banner.match(/primaryText[^>]*>\s*\{?([^<{]+)/);
  const label = primary ? primary[1].trim() : '';
  check('there is a primary action', label.length > 0, JSON.stringify(label));
  check(
    'the primary action is to move the funds, not to replace the transaction',
    /move/i.test(label) && !/replace|rbf|fee/i.test(label),
    JSON.stringify(label),
  );
  check(
    'RBF is named only to say it is not the way out',
    /RBF/.test(banner) && /is not a\s+way\s+out/.test(banner),
  );
  check('it says to use a new recovery phrase', /NEW recovery\s*\n?\s*phrase/.test(banner));
}

// ── silencing it takes the admin key ───────────────────────────────────────
console.log('\nacknowledging');
{
  check(
    'the list is fetched with the read-only key',
    /export async function getSpendAlerts\(\s*\n?\s*inkey: string/.test(api),
  );
  check(
    'the acknowledgement is sent with the admin key',
    /export async function acknowledgeSpendAlert\(\s*\n?\s*adminkey: string/.test(api),
  );
  check(
    'the banner acknowledges with the admin key',
    /useAuthStore\(\(s\) => s\.adminkey\)/.test(banner) &&
      /acknowledge\(adminkey,/.test(banner),
  );
  check(
    'dismissing asks first',
    /Alert\.alert\(\s*\n?\s*'Dismiss this warning\?'/.test(banner),
  );
  check(
    'an in-flight acknowledgement blocks a second one',
    /if \(!walletId \|\| acking\) return;/.test(store),
  );
  check(
    'a successful acknowledgement drops it locally too',
    /alerts: s\.alerts\.filter\(\(a\) => a\.txid !== txid\)/.test(store),
    'the banner would linger until the next poll',
  );
  check(
    'the in-flight flag is released even when the request throws',
    /finally \{\s*\n\s*set\(\{ acking: null \}\);/.test(store),
  );
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
