#!/usr/bin/env node
/*
 * The routed Tango change output, verified the same way on both sides.
 *
 * WHAT THIS IS THE ONLY DEFENCE AGAINST. A user who gives a Lightning address
 * has their round's change output pay the INSTANCE's Silent Payments address.
 * A taproot key-path signature commits to EVERY output, so if a client cannot
 * tell a legitimate change script from one the coordinator chose, it signs
 * away the coin — and "the server said so" is not a check. That exact mistake
 * shipped in the PayJoin, comparing the server's value against itself, and let
 * every substitution through.
 *
 * WHY THE CHECK IS A TWEAK AND NOT A DERIVATION. A BIP-352 output is
 * P_k = B_spend + t_k·G, and t_k comes from a shared secret needing either the
 * payee's scan key or the inputs' private keys. A client has neither — which
 * payjoin_sp.py::payment_script says of its own output: "the payer cannot
 * compute it and cannot check it." So the round reveals t_k and each client
 * checks the arithmetic. That proves the output's private key is b_spend + t_k,
 * producible only by the instance, so the change cannot be redirected to a
 * third party.
 *
 * The negatives below matter as much as the positives: a verifier that ignored
 * the tweak, or compared only lengths, would pass every real case and still be
 * worthless.
 *
 * Regenerate the fixture when either side's derivation changes:
 *   cd ../siLNt && python3 helpers/_tango_change_fixtures.py > fixtures/tango-change-payout.json
 *
 * Run: node --experimental-strip-types scripts/check-tango-change.mjs
 */
import { readFileSync } from 'node:fs';
import { verifyPayoutOutput } from '../src/services/spSign.ts';

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
};
const hex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

const FIXTURE = new URL(
  '../../siLNt/fixtures/tango-change-payout.json',
  import.meta.url,
);
let fx;
try {
  fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
} catch (e) {
  console.log(`  FAIL could not read ${FIXTURE.pathname}: ${e.message}`);
  console.log('       cd ../siLNt && python3 helpers/_tango_change_fixtures.py '
    + '> fixtures/tango-change-payout.json');
  process.exit(1);
}

const ADDR = fx.sp_address;

console.log('the real pairs verify, on both sides of the round');
{
  ok('the fixture has both sides', (fx.cases || []).length === 2);
  for (const c of fx.cases || []) {
    // The Python already answered this; a disagreement is the drift.
    ok(`side ${c.role} verifies in Python`, c.verifies === true);
    ok(`side ${c.role} verifies here too`,
      verifyPayoutOutput(ADDR, hex(c.tweak), hex(c.spk)),
      `k=${c.k} spk=${c.spk}`);
  }
  // A and B must get DIFFERENT outputs: both pay the same recipient, so the
  // same k would be one address paid twice — one coin, not two, with the
  // second side's money landing on the first side's script.
  const [a, b] = fx.cases;
  ok('the two sides get different scripts', a.spk !== b.spk);
  ok('and different tweaks', a.tweak !== b.tweak);
  ok('k is fixed by role', a.k === 0 && b.k === 1, `${a.k}/${b.k}`);
}

console.log('\nand nothing else does');
{
  const n = fx.negatives || {};
  const [a, b] = fx.cases;

  // The substitution the check exists to catch. A verifier that ignored the
  // tweak would pass this.
  ok('Python rejects A\'s script under B\'s tweak', n.crossed_tweak === false);
  ok('and so does this', !verifyPayoutOutput(ADDR, hex(b.tweak), hex(a.spk)));

  // The coordinator pointing the change at an address of its own.
  ok('a script paying somebody else is rejected',
    !verifyPayoutOutput(ADDR, hex(n.foreign_tweak), hex(n.foreign_spk)),
    'this is the whole attack');

  ok('a zero tweak is rejected', !verifyPayoutOutput(ADDR, hex(n.zero_tweak), hex(a.spk)));
  ok('a short tweak is rejected', !verifyPayoutOutput(ADDR, hex(n.short_tweak), hex(a.spk)));
  ok('an empty tweak is rejected', !verifyPayoutOutput(ADDR, new Uint8Array(), hex(a.spk)));
  ok('a truncated script is rejected',
    !verifyPayoutOutput(ADDR, hex(a.tweak), hex(a.spk).slice(0, 33)));
  ok('a non-taproot script is rejected', (() => {
    const s = hex(a.spk).slice();
    s[0] = 0x00;                       // OP_0 instead of OP_1
    return !verifyPayoutOutput(ADDR, hex(a.tweak), s);
  })());
  ok('a flipped script byte is rejected', (() => {
    const s = hex(a.spk).slice();
    s[20] ^= 0x01;
    return !verifyPayoutOutput(ADDR, hex(a.tweak), s);
  })());
  ok('an empty address is rejected', !verifyPayoutOutput('', hex(a.tweak), hex(a.spk)));
  ok('a junk address is rejected',
    !verifyPayoutOutput('sp1nonsense', hex(a.tweak), hex(a.spk)));
  // The right script under the WRONG instance address: the operator changed
  // the configured address and an old round is still in flight.
  ok('another address is rejected',
    !verifyPayoutOutput(
      'sp1qqw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4qqw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      hex(a.tweak), hex(a.spk),
    ));
}

console.log('\nsigning refuses a routing this device did not agree to');
{
  // The flag is in the server's round record, so a coordinator could turn it
  // on. The device compares against its OWN record of what it offered.
  const src = readFileSync(new URL('../src/services/tango.ts', import.meta.url), 'utf8');
  ok('checkBeforeSigning takes the device\'s own intent',
    /myPayoutIntended/.test(src));
  ok('and refuses a mismatch',
    /routed !== !!opts\.myPayoutIntended/.test(src),
    'comparing the server flag against itself is not a check');
  ok('a routed change is verified, not compared',
    /verifyPayoutOutput\(opts\.payoutSpAddress/.test(src));
  ok('an unrouted change is still compared to what we derived',
    /expectChangeHex !== ourChangeHex/.test(src));
  ok('routing with no address is refused',
    /does not say where/.test(src));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — a routed change output cannot be redirected');
