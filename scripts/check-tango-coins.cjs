#!/usr/bin/env node
/*
 * The coin list on a Tango screen has two jobs, and they want different lists.
 *
 * PICKING coins for a NEW round must exclude any coin a live round is already
 * holding: /rounds and /accept refuse them, and two rounds on one coin make a
 * transaction the network refuses.
 *
 * SIGNING an EXISTING round must include them. The server's copy of the input
 * set carries no tweaks, by design, so withLocalTweaks looks them up in this
 * list — and the coins of the round being signed are reserved, by that round.
 *
 * Applying the reservation to both is what made approving a mix fail with
 * "This PayJoin uses a coin this device does not have", about a coin the
 * device had all along. It is a one-word change in a filter, it breaks no
 * types and no test, and it stops every round from being signable.
 *
 * Run: node scripts/check-tango-coins.cjs
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(name, cond, detail = '') {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
}

const read = (p) =>
  fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// The body of the function that loads coins, up to the next top-level thing.
function loaderOf(src, marker) {
  const at = src.indexOf(marker);
  return at === -1 ? '' : src.slice(at, at + 600);
}

for (const [label, file, loadMarker, tweakCall] of [
  [
    'mobile',
    'src/screens/TangoScreen.tsx',
    'setCoins(',
    'tango.withLocalTweaks(side === \'a\' ? aRows : bRows, coins)',
  ],
  [
    'web',
    'src/views/TangoView.vue',
    'coins.value = (res.utxos',
    'tango.withLocalTweaks(side === \'a\' ? aRows : bRows, coins.value)',
  ],
]) {
  console.log('\n' + label);
  const src = read(file);

  // 1. The tweak lookup reads the UNFILTERED list. This is the one that breaks
  //    signing, and it breaks it for every round rather than visibly.
  ok('signing looks up tweaks in the unfiltered coin list',
    src.includes(tweakCall),
    `expected a call reading the whole list: ${tweakCall}`);

  // 2. That list is not itself filtered by the reservation.
  const loader = loaderOf(src, loadMarker);
  ok('the loader keeps coins a live round is holding',
    loader.length > 0 && !/tango_reserved/.test(loader),
    loader ? 'the reservation is applied where the tweaks are read from'
           : `could not find the loader (${loadMarker})`);

  // 3. A NEW round still must not be able to pick one.
  ok('a separate list drops them for picking',
    /selectable/.test(src) && /!c\.tango_reserved/.test(src),
    'expected a `selectable` list filtering on tango_reserved');

  // 4. And the picker uses that one, not the raw list. Checked on what the
  //    chosen-coins computation reads, since that is what reaches the wire.
  ok('the chosen coins come from the picking list',
    /selectable[.\s]*(\.value)?\s*\.filter\(\s*\(c\)\s*=>\s*(mix)?[Pp]icked/.test(
      src.replace(/\s+/g, ' '),
    ),
    'the chosen-coins list still filters the unfiltered coins');
}

console.log(
  failures
    ? `\n${failures} check(s) failed`
    : '\nall checks passed — a round can be signed with the coins it holds',
);
process.exit(failures ? 1 : 0);
