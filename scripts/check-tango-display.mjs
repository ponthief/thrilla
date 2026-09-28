#!/usr/bin/env node
/*
 * What the transaction detail says a Tango did.
 *
 * Both of these were reported as wrong numbers on a real round —
 * 3331ddbf…3331af on signet: 8 inputs, three outputs of 14,000 / 14,000 /
 * 2,503, change on ONE side.
 *
 *   1. Every output the wallet does not own was listed under "alice's share".
 *      Her change was one of them, so a 14,000 round reported her as taking
 *      16,503 out of a mix where both sides took 14,000.
 *   2. The round line read "Change on one or both sides" whichever side had
 *      it — a hedge that reads as a claim about both, on a round where one
 *      side was clean.
 *
 * Neither is caught by a type or a build. Both are arithmetic a person checks
 * against an explorer, which is exactly when a wallet has to be right.
 *
 * Run: node --experimental-strip-types scripts/check-tango-display.mjs
 */
import { readFileSync } from 'node:fs';
import {
  splitMixOutputs, changeLine, turnLine,
} from '../src/services/tangoTurns.ts';

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('the round that was reported wrong (3331ddbf…, signet)');
{
  // This wallet owns one 14,000 and nothing else, so the outputs it does not
  // own are the other share and the other side's change.
  const mix = {
    denom_sats: 14000, pieces: 1, partner: 'alice',
    fee_sats: 973, change_sats: 0, their_change_sats: 2503,
  };
  const recipients = [{ amount: 14000 }, { amount: 2503 }];
  const { share, change, other } = splitMixOutputs(mix, recipients);
  eq('their share is the denomination, once', share.map((o) => o.amount), [14000]);
  eq('their change is its own line', change.map((o) => o.amount), [2503]);
  eq('and nothing is left over', other.map((o) => o.amount), []);
  ok('their share does not add up to 16,503',
    share.reduce((s, o) => s + o.amount, 0) === 14000);

  eq('the round says which side had change',
    changeLine(0, 2503, 'alice'),
    "Change on alice's side. An observer can often work out which output is "
    + 'whose from the amounts.');
}

console.log('\nthe other arrangements');
{
  // Three pieces a side: three outputs of the share, plus their change.
  const mix = {
    denom_sats: 30000, pieces: 3, partner: 'bob',
    change_sats: 100, their_change_sats: 777,
  };
  const { share, change, other } = splitMixOutputs(
    mix, [{ amount: 10000 }, { amount: 777 }, { amount: 10000 }, { amount: 10000 }],
  );
  eq('all three of their pieces are the share',
    share.map((o) => o.amount), [10000, 10000, 10000]);
  eq('their change is still its own', change.map((o) => o.amount), [777]);
  eq('nothing left over', other.map((o) => o.amount), []);

  // A fourth output at the share size is NOT a fourth piece: a side gets
  // `pieces` of them and no more, so the extra is reported rather than hidden.
  const extra = splitMixOutputs(mix, [
    { amount: 10000 }, { amount: 10000 }, { amount: 10000 }, { amount: 10000 },
  ]);
  eq('an unexpected extra output is shown as such',
    extra.other.map((o) => o.amount), [10000]);

  // A change that happens to equal the share size stays a share.
  const clash = splitMixOutputs(
    { denom_sats: 5000, pieces: 1, their_change_sats: 5000 },
    [{ amount: 5000 }, { amount: 5000 }],
  );
  eq('a change equal to the share does not eat the share',
    [clash.share.length, clash.change.length], [1, 1]);

  // A round from a server that sends neither field still lists everything.
  const old = splitMixOutputs({ denom_sats: 14000 }, [{ amount: 14000 }, { amount: 2503 }]);
  eq('an old round still accounts for every output',
    [old.share.length, old.change.length, old.other.length], [1, 0, 1]);
}

console.log('\nevery way the change can fall');
{
  ok('both sides', changeLine(10, 20, 'bob').startsWith('Change on both sides.'));
  ok('mine only', changeLine(10, 0, 'bob').startsWith('Your side had change.'));
  ok('theirs only', changeLine(0, 20, 'bob').startsWith("Change on bob's side."));
  ok('neither', changeLine(0, 0, 'bob').startsWith('No change either side'));
  ok('no partner name', changeLine(0, 20, null).startsWith("Change on their side's"));
}

console.log('\nwhat each side is waiting for');
{
  // Side A, after approving: the round is on B, and what B does next puts it
  // on the network. "Waiting for bob to sign" said neither which wait it was
  // nor that it was the last one.
  eq('A after approving', turnLine('A_SIGNED', 'a', 'bob'),
     'Waiting for bob to complete the Tango round.');
  // Side B, having matched: waiting on an approval that broadcasts nothing.
  eq('B after matching', turnLine('ACCEPTED', 'b', 'alice'),
     'Waiting for alice to approve it.');
  eq('A after proposing', turnLine('PROPOSED', 'a', 'bob'),
     'Waiting for bob to match it.');
  // And the turns that ARE yours still say what pressing does.
  ok('B at the last step is told it broadcasts',
    turnLine('A_SIGNED', 'b', 'alice').includes('broadcasts the transaction'));
  ok('and that it cannot be undone',
    turnLine('A_SIGNED', 'b', 'alice').includes('cannot be undone'));
  eq('a finished round', turnLine('BROADCAST', 'a', 'bob'),
     'Done \u2014 both shares are on chain.');
}

console.log('\nthe two clients name the same actions');
{
  // One round, two screens: a button called Complete on the phone and
  // "Finish & send" in the browser is the same press under two names, and the
  // browser kept the old one for a release after the phone changed.
  const RETIRED = ['Match & derive', 'Finish & send', 'Finish & sign'];
  for (const file of ['src/screens/TangoScreen.tsx', 'src/views/TangoView.vue']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const label of RETIRED) {
      ok(`${file} has no "${label}"`, !src.includes(label));
    }
    ok(`${file} says Complete`, src.includes("'Complete'"));
    ok(`${file} says Submit`, src.includes('Submit'));
  }
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — the detail view accounts for every output');
