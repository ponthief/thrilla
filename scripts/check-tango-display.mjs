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
import { changeLine, turnLine } from '../src/services/tangoTurns.ts';

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

console.log('a round does not report on the partner');
{
  // It used to list every output the wallet does not own — the other side's
  // share AND their change, which reported a 14,000 round as 16,503 going to
  // them. Those outputs are on chain either way and are none of this wallet's
  // business, so the section is gone for a Tango and kept for a send, where
  // the recipient is the point.
  for (const [file, guard] of [
    ['src/components/TxDetailModal.tsx', 'detail.recipients?.length && !mix'],
    ['src/views/TransactionsView.vue', 'expandedDetail.recipients.length && !mixOf(tx)'],
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    ok(`${file} hides the recipients of a round`, src.includes(guard),
      'a Tango would list the other side\u2019s outputs again');
    ok(`${file} still shows them for a send`, src.includes('Recipients'));
  }
  // And the machinery for splitting them is gone with it.
  const svc = readFileSync(new URL('../src/services/tangoTurns.ts', import.meta.url), 'utf8');
  for (const dead of ['splitMixOutputs', 'mixOtherShareTitle', 'mixOtherChangeTitle']) {
    ok(`${dead} is gone`, !svc.includes(dead));
  }
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

console.log('\nthe wording that was asked for, and stays gone');
{
  // Removed on request. Each was a sentence a person had already worked out
  // from the screen it was printed on.
  const GONE = [
    'nothing is on chain',      // under the approve step
    'Your change would have been',  // the dropped-change note on a history row
    'Confirm this mix',         // the signing modal's old title
    'Other outputs',            // read as "yours", and it cannot know whose
    'Tango steps',              // the five lines, removed from both screens
    'Connections are per network',  // three sentences where one does
  ];
  for (const file of [
    'src/screens/TangoScreen.tsx', 'src/views/TangoView.vue',
    'src/components/TxDetailModal.tsx', 'src/views/TransactionsView.vue',
    'src/services/tangoTurns.ts',
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const text of GONE) ok(`${file} has no "${text}"`, !src.includes(text));
  }
  ok('the approve wait says only what it needs',
    !turnLine('ACCEPTED', 'b', 'alice').includes('on chain'));
  // A Tango is not a payment, and "Mixed" was the word for it in three places.
  for (const file of ['src/components/TxDetailModal.tsx', 'src/views/TransactionsView.vue']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    ok(`${file} says Tango-ed`, src.includes('Tango-ed'));
    // The fee share is a fee. Beside "alice's share" — the mixed output —
    // a bare "Your share" read as the other kind entirely.
    ok(`${file} calls the fee share a fee share`, src.includes('Your fee share'));
    ok(`${file} does not say a bare "Your share"`,
      !/Your share[^ ]/.test(src) && !src.includes('"Your share"'));
  }
}

console.log('\nno screen calls it a mix');
{
  // A Tango is a round, and its outputs are shares. "Mix" was the word for it
  // in a dozen places, including the label written onto a coin.
  for (const file of [
    'src/screens/TangoScreen.tsx', 'src/views/TangoView.vue',
    'src/components/TxDetailModal.tsx', 'src/views/TransactionsView.vue',
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    // Only what a person reads: the identifiers (mixPicked, mixOf, own.mix,
    // mix_spks) are the protocol's own words and stay.
    const prose = [...src.matchAll(/'([^'\n]{6,})'|"([^"\n]{6,})"|>([^<>{}\n]{6,})</g)]
      .map((m) => m[1] || m[2] || m[3])
      // Sentences, not expressions: a Vue attribute is a string too, and
      // `tab === 'mix'` is the tab's key, which nobody reads.
      .filter((t) => /\s/.test(t) && !/[=;(){}]|\?|\bconst\b/.test(t));
    const offenders = prose.filter((t) => /\bmix(ed|es|ing)?\b/i.test(t));
    ok(`${file} has no "mix" in anything a person reads`,
      offenders.length === 0, offenders.slice(0, 3).join(' | '));
  }
  const svc = readFileSync(new URL('../src/services/tango.ts', import.meta.url), 'utf8');
  ok('the coin label is a share', svc.includes("export const MIX_LABEL = 'Tango share'"));
  // And the old spelling is still recognised, or the guard that refuses two
  // shares of one round goes quiet on every coin mixed before the rename.
  ok('the old spelling is still matched',
    svc.includes("LEGACY_MIX_LABEL = 'Tango mix'") && svc.includes('mixParty('));
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
