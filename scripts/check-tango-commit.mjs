// The web app's record of which coins it put into a Tango round.
//
//   node scripts/check-tango-commit.mjs
//
// WHAT WENT WRONG. The record was keyed by round id alone, in localStorage.
// localStorage belongs to the BROWSER, not to the account, and a Tango has two
// accounts in it — the server refuses a round with yourself. So testing both
// sides in one browser (sign in as alice, propose; sign in as bob, accept) had
// bob's accept overwrite alice's propose under the same key. Alice's approval
// then compared alice's coins against bob's and threw
//
//     The coins in this Tango are not the ones you chose. Cancel it.
//
// which is the alarm for a server swapping your selection, raised by the
// browser overwriting its own note. Every way that check fails tells the user
// to cancel a perfectly good round, so a wrong record here is worse than none:
// absence is handled, and says so.
//
// No bundler and no DOM: the module reads `localStorage` off the global at
// call time, so a plain object stands in for it.

let failed = 0;
function ok(name, cond, detail = '') {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failed++;
  }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { recordTangoCommit, getTangoCommit, pruneTangoCommits } = await import(
  new URL('../src/stores/tangocommit.js', import.meta.url).href
);

const coin = (txid, vout, amount) => ({ txid, vout, amount });
const ALICE_WALLET = 'wal_alice';
const BOB_WALLET = 'wal_bob';
const ROUND = 'rnd_7c2e';

const ALICE_COINS = [coin('aa'.repeat(32), 0, 11500), coin('bb'.repeat(32), 1, 5000)];
const BOB_COINS = [coin('cc'.repeat(32), 0, 8000), coin('dd'.repeat(32), 2, 4000)];

const same = (a, b) =>
  JSON.stringify(a) === JSON.stringify(b);

console.log('\nboth sides of one round, in one browser');

// Exactly the sequence that broke: propose as one account, accept as the other.
recordTangoCommit(ROUND, ALICE_WALLET, ALICE_COINS);
recordTangoCommit(ROUND, BOB_WALLET, BOB_COINS);

ok('the proposer still has its own coins after the other side accepts',
  same(getTangoCommit(ROUND, ALICE_WALLET), ALICE_COINS),
  JSON.stringify(getTangoCommit(ROUND, ALICE_WALLET)));
ok('and the acceptor has its own',
  same(getTangoCommit(ROUND, BOB_WALLET), BOB_COINS));
ok('the two do not overlap',
  !same(getTangoCommit(ROUND, ALICE_WALLET), getTangoCommit(ROUND, BOB_WALLET)));

console.log('\nwhat absence means');

ok('a wallet with no record gets null, not somebody else\'s list',
  getTangoCommit(ROUND, 'wal_carol') === null);
ok('an unknown round is null',
  getTangoCommit('rnd_nope', ALICE_WALLET) === null);
// The caller falls back to the server's set and says the check could not be
// made. Returning a list from the wrong side instead would fail the check and
// tell the user to cancel.
ok('no wallet id is null rather than a guess',
  getTangoCommit(ROUND, null) === null &&
  getTangoCommit(ROUND, undefined) === null);
ok('and nothing is written without one',
  (recordTangoCommit(ROUND, '', ALICE_COINS),
   getTangoCommit(ROUND, '') === null));

console.log('\nonly the outpoint and the amount are kept');

recordTangoCommit('rnd_extra', ALICE_WALLET, [
  { ...coin('ee'.repeat(32), 3, 900), priv_key_tweak: 'SECRET', pub_key: 'PUB' },
]);
const kept = getTangoCommit('rnd_extra', ALICE_WALLET);
ok('a tweak that came along for the ride is not stored',
  same(kept, [coin('ee'.repeat(32), 3, 900)]),
  JSON.stringify(kept));

console.log('\npruning');

// Legacy entries, keyed by round alone, from before the key carried a wallet.
// One sits beside a scoped entry; one is all there is for its round.
store.set(
  'thrilla_tango_commit_v1',
  JSON.stringify({
    ...JSON.parse(store.get('thrilla_tango_commit_v1')),
    [ROUND]: BOB_COINS,          // whoever wrote this, it is not alice's list
    rnd_legacy: BOB_COINS,
  }),
);
ok('a bare key does not shadow the scoped one beside it',
  same(getTangoCommit(ROUND, ALICE_WALLET), ALICE_COINS),
  JSON.stringify(getTangoCommit(ROUND, ALICE_WALLET)));
// Which side wrote a bare entry is unknowable, and the wrong answer fails a
// check that means "cancel it". Absence is the honest reading.
ok('a round with only a bare key reads as no record at all',
  getTangoCommit('rnd_legacy', ALICE_WALLET) === null &&
  getTangoCommit('rnd_legacy', BOB_WALLET) === null);

pruneTangoCommits([ROUND]);
const after = JSON.parse(store.get('thrilla_tango_commit_v1'));
ok('both sides of a live round survive a prune',
  after[`${ROUND}:${ALICE_WALLET}`] && after[`${ROUND}:${BOB_WALLET}`]);
ok('an unreadable bare key for a dead round is pruned away',
  after.rnd_legacy === undefined,
  JSON.stringify(after));
ok('a round that is over is forgotten, both sides at once',
  after['rnd_extra'] === undefined &&
  after[`rnd_extra:${ALICE_WALLET}`] === undefined);

pruneTangoCommits([]);
const empty = JSON.parse(store.get('thrilla_tango_commit_v1'));
ok('and nothing survives once no round is live',
  Object.keys(empty).length === 0, JSON.stringify(empty));

console.log(
  failed
    ? `\n${failed} check(s) failed`
    : '\nall checks passed — each side of a round keeps its own record',
);
process.exit(failed ? 1 : 0);
