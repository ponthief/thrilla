// Hold src/services/tango.ts to the Python reference.
//
//   node scripts/check-tango-signing.mjs [path/to/tango.json]
//
// Vectors from siLNt helpers/_tango_fixtures.py. Regenerate after any change
// to the amounts, the output ordering or the derivation — on either side.
//
// WHY THIS ONE IS STRICT ABOUT AMOUNTS. Tango's whole claim is that both mixed
// outputs are the same. A client whose arithmetic drifts by a satoshi does not
// make a weaker mix; it makes two outputs an observer can tell apart, which is
// a PayJoin with nobody being paid, sold as privacy. So the denomination, both
// changes, both fee shares and `clean` are all compared, not just the total.
//
// Signatures are verified against the sighash rather than compared: BIP-340
// uses random aux data.

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-resolve.mjs', import.meta.url);

const FIXTURES = process.argv[2] || '../../siLNt/fixtures/tango.json';

let failed = 0;
function ok(name, cond, detail = '') {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failed++;
  }
}

const t = await import(
  pathToFileURL(new URL('../src/services/tango.ts', import.meta.url).pathname).href
);
const sp = await import(
  pathToFileURL(new URL('../src/services/spSign.ts', import.meta.url).pathname).href
);
const { schnorr } = await import('@noble/curves/secp256k1');
const { toHex, fromHex } = sp;

const data = JSON.parse(readFileSync(new URL(FIXTURES, import.meta.url), 'utf8'));

for (const c of data.cases) {
  console.log('\n' + c.name);
  const e = c.expected;
  const aIn = c.a.inputs;
  const bIn = c.b.inputs;
  const all = [...aIn, ...bIn];

  // ── the amounts, every one of them ──
  let amounts;
  try {
    amounts = t.plan(aIn, bIn, c.denom, c.fee_rate);
  } catch (err) {
    ok('plan', false, String(err));
    continue;
  }
  for (const f of ['denom', 'a_in', 'b_in', 'a_change', 'b_change',
                   'a_fee', 'b_fee', 'fee', 'vsize', 'clean']) {
    ok(f, amounts[f] === e[f], `js ${amounts[f]} py ${e[f]}`);
  }
  ok('both sides get the same amount', amounts.denom === e.denom);
  ok('the arithmetic balances',
    amounts.a_in + amounts.b_in
      === 2 * amounts.denom + amounts.a_change + amounts.b_change + amounts.fee);

  // ── each side derives its own two outputs ──
  const aOut = t.deriveOwnOutputs(c.a.scan_secret, fromHex(c.a.spend_pub), all,
    !!amounts.a_change);
  const bOut = t.deriveOwnOutputs(c.b.scan_secret, fromHex(c.b.spend_pub), all,
    !!amounts.b_change);
  ok('A derives its mixed output', toHex(aOut.mix) === e.a_mix_spk,
    `js ${toHex(aOut.mix)} py ${e.a_mix_spk}`);
  ok('B derives its mixed output', toHex(bOut.mix) === e.b_mix_spk,
    `js ${toHex(bOut.mix)} py ${e.b_mix_spk}`);
  ok('A change script', (aOut.change ? toHex(aOut.change) : null) === e.a_change_spk);
  ok('B change script', (bOut.change ? toHex(bOut.change) : null) === e.b_change_spk);
  // Every script this round actually has must be distinct. Counting absent
  // change as a placeholder made this pass two and fail two for no reason —
  // a clean round has two scripts, not four.
  const present = [toHex(aOut.mix), toHex(bOut.mix)];
  if (aOut.change) present.push(toHex(aOut.change));
  if (bOut.change) present.push(toHex(bOut.change));
  ok('every script in this round is distinct',
    new Set(present).size === present.length, present.join(' '));
  ok('a side with no change derived none',
    (!!aOut.change === !!amounts.a_change) && (!!bOut.change === !!amounts.b_change));

  // ── the transaction ──
  const asm = t.assemble(all, amounts, aOut.mix, bOut.mix, aOut.change, bOut.change);
  ok('input order is canonical',
    JSON.stringify(asm.vin.map((i) => `${i.txid}:${i.vout}`)) ===
      JSON.stringify(e.input_order));
  ok('output values match', JSON.stringify(asm.vout.map((o) => o.value)) ===
      JSON.stringify(e.output_values));
  ok('output scripts match', JSON.stringify(asm.vout.map((o) => toHex(o.script))) ===
      JSON.stringify(e.output_scripts));
  ok('the unsigned transaction is identical', asm.unsignedHex === e.unsigned_tx,
    `js ${asm.unsignedHex}\n         py ${e.unsigned_tx}`);
  ok('exactly two outputs sit at the denomination',
    asm.vout.filter((o) => o.value === amounts.denom).length === 2);

  // ── sighashes and signatures ──
  const ordered = t.canonical(all);
  const digests = ordered.map((_i, n) =>
    sp.taprootSighash(asm.vin, asm.vout, n, asm.amounts, asm.scripts));
  ok('every sighash matches',
    JSON.stringify(digests.map(toHex)) === JSON.stringify(e.sighashes));

  for (const [who, party, mine, idx] of [
    ['A', c.a, aIn, e.a_indices], ['B', c.b, bIn, e.b_indices],
  ]) {
    const sigs = t.signOwnInputs(asm, all, mine, party.spend_secret);
    ok(`${who} signs exactly its own inputs`,
      JSON.stringify(Object.keys(sigs).map(Number).sort((x, y) => x - y)) ===
        JSON.stringify(idx));
    let good = true;
    for (const [n, hex] of Object.entries(sigs)) {
      if (!schnorr.verify(fromHex(hex), digests[Number(n)],
                          fromHex(ordered[Number(n)].pub_key))) good = false;
    }
    ok(`every ${who} signature verifies`, good);
  }
}

// ── what each side refuses to sign ───────────────────────────────────────────

console.log('\nguards');
{
  const c = data.cases[0];
  const aIn = c.a.inputs, bIn = c.b.inputs, all = [...aIn, ...bIn];
  const amounts = t.plan(aIn, bIn, c.denom, c.fee_rate);
  const aOut = t.deriveOwnOutputs(c.a.scan_secret, fromHex(c.a.spend_pub), all, !!amounts.a_change);
  const bOut = t.deriveOwnOutputs(c.b.scan_secret, fromHex(c.b.spend_pub), all, !!amounts.b_change);

  const base = {
    side: 'a', inputs: all, mine: aIn, amounts,
    aMix: aOut.mix, bMix: bOut.mix, aChange: aOut.change, bChange: bOut.change,
    expectMix: aOut.mix, expectChange: aOut.change,
    committed: aIn, denom: c.denom, feeRate: c.fee_rate,
  };

  let err = null;
  try { t.checkBeforeSigning(base); } catch (e2) { err = e2; }
  ok('an honest round passes A\'s checks', err === null, String(err));

  err = null;
  try {
    t.checkBeforeSigning({ ...base, side: 'b', mine: bIn, committed: bIn,
      expectMix: bOut.mix, expectChange: bOut.change });
  } catch (e2) { err = e2; }
  ok('an honest round passes B\'s checks', err === null, String(err));

  const refuses = (name, opts, match) => {
    let e3 = null;
    try { t.checkBeforeSigning(opts); } catch (x) { e3 = x; }
    ok(name, e3 !== null && new RegExp(match).test(e3.message),
      e3 ? e3.message : 'it was accepted');
  };

  // The one that matters: unequal outputs are not a weaker mix, they are no
  // mix at all. The server would have to lie about the plan to get here.
  refuses('A refuses a round where the two shares differ',
    { ...base, amounts: { ...amounts, denom: amounts.denom + 1 } },
    'this device computes|does not pay both sides the same');

  refuses('A refuses a fee it did not compute',
    { ...base, amounts: { ...amounts, fee: amounts.fee + 1000 } },
    'this device computes');

  refuses('A refuses a share sent to a script it did not derive',
    { ...base, aMix: fromHex('5120' + 'ff'.repeat(32)) },
    'not going to the address this device derived');

  refuses('A refuses change sent somewhere else',
    { ...base, aChange: fromHex('5120' + 'ee'.repeat(32)) },
    'change is not going where');

  refuses('A refuses coins it did not choose',
    { ...base, committed: [{ ...aIn[0], vout: aIn[0].vout + 9 }] },
    'not the ones you chose');

  refuses('A refuses its own coin listed at the wrong amount',
    { ...base, committed: [{ ...aIn[0], amount: aIn[0].amount + 1 }] },
    'wrong amount');

  // The attack the check is actually for, in its real shape: the server swaps
  // one of A's coins for ANOTHER of A's coins. Same amount, so every sum still
  // balances; same key, so this device holds a tweak for it and would sign it
  // without complaint. Nothing but the committed list can catch this, and the
  // committed list only catches it if it came from the device. Handing back the
  // server's own set here — which is what the PayJoin screen did — makes the
  // comparison trivially true and this substitution invisible.
  {
    const swapped = { ...aIn[0], txid: 'a'.repeat(63) + '1', vout: 3 };
    const tampered = [swapped, ...aIn.slice(1)];
    refuses('A refuses one of its coins swapped for another of its own',
      { ...base, inputs: [...tampered, ...bIn], mine: tampered, committed: aIn },
      'not the ones you chose');
    // And the same substitution sails through when the check is fed the
    // server's set as its own record. This asserts the hole exists, so that
    // anyone tempted to pass `mine` again can see what it costs.
    let slipped = null;
    try {
      t.checkBeforeSigning({
        ...base, inputs: [...tampered, ...bIn], mine: tampered, committed: tampered,
      });
    } catch (x) { slipped = x; }
    ok('and comparing the server\'s set to itself would have let it through',
      slipped === null, slipped ? slipped.message : '');
  }

  // The wire set carries no tweaks, by design.
  const wire = aIn.map(({ priv_key_tweak, ...rest }) => rest);
  err = null;
  try {
    t.signOwnInputs(t.assemble(all, amounts, aOut.mix, bOut.mix, aOut.change, bOut.change),
      all, wire, c.a.spend_secret);
  } catch (e2) { err = e2; }
  ok('the wire input set alone cannot be signed',
    err !== null && /no tweak for it/.test(err.message),
    err ? err.message : 'it was signed');

  const rejoined = t.withLocalTweaks(wire, aIn.map((i) => ({
    txid: i.txid, vout: i.vout, priv_key_tweak: i.priv_key_tweak, pub_key: i.pub_key,
  })));
  err = null;
  try {
    t.signOwnInputs(t.assemble(all, amounts, aOut.mix, bOut.mix, aOut.change, bOut.change),
      all, rejoined, c.a.spend_secret);
  } catch (e2) { err = e2; }
  ok('and it can once this device\'s tweaks are joined back on', err === null,
    err ? err.message : '');

  err = null;
  try {
    t.deriveOwnOutputs(c.a.scan_secret, fromHex(c.b.spend_pub), all, false);
  } catch (e2) { err = e2; }
  const forged = err ? null : t.deriveOwnOutputs(c.a.scan_secret, fromHex(c.b.spend_pub), all, false);
  ok('A cannot derive B\'s output with its own scan key',
    forged === null || toHex(forged.mix) !== toHex(bOut.mix));
}

// ── the coin labels, and the pairing a client must refuse ────────────────────
// The backend writes these labels; the clients read them and refuse the one
// combination that undoes a round. A prefix that drifted by a character would
// stop refusing anything while every other check here still passed.

console.log('\nlabels');
{
  const L = data.labels;
  ok('the mixed share is named after the counterparty',
    t.mixLabel('alice') === L.mix, `js ${t.mixLabel('alice')} vs py ${L.mix}`);
  ok('so is the change',
    t.changeLabel('alice') === L.change,
    `js ${t.changeLabel('alice')} vs py ${L.change}`);
  ok('an unnamed round still names its coins',
    t.mixLabel(null) === L.bare_mix && t.changeLabel('') === L.bare_change);
  ok('the day distinguishes two rounds with one person',
    t.mixLabel('alice', '2026-09-24') === L.dated_mix &&
    t.changeLabel('alice', '2026-10-01') === L.dated_change,
    `js ${t.mixLabel('alice', '2026-09-24')} vs py ${L.dated_mix}`);
  ok('a date with no name still reads',
    t.mixLabel('', '2026-09-24') === L.marker_only);
  // Rows come back as text or as a timestamp depending on the driver, and two
  // coins of one round must not end up dated differently.
  ok('a timestamp is cut to its day, the same way on both sides',
    t.changeLabel('alice', '2026-09-24T13:05:00Z') === L.date_from_timestamp,
    `js ${t.changeLabel('alice', '2026-09-24T13:05:00Z')} vs py ${L.date_from_timestamp}`);
  ok('and a Date object gives the same string',
    t.mixLabel('alice', new Date('2026-09-24T13:05:00Z')) === L.dated_mix);

  let agree = true;
  let where = '';
  for (const c of L.cases) {
    const mine = t.undoesARound(c.labels);
    if (mine !== c.undoes) {
      agree = false;
      where = `${JSON.stringify(c.labels)}: js ${JSON.stringify(mine)} vs py ${JSON.stringify(c.undoes)}`;
      break;
    }
  }
  ok(`both sides agree on all ${L.cases.length} selections`, agree, where);

  // Stated separately from the table so the point is not just "they agree".
  ok('a share with its own change is refused',
    t.undoesARound(['Tango mix - alice', 'Tango change - alice']) === 'alice');
  // This one read the other way round until the reasoning was corrected: the
  // sums not meeting is not what makes it safe, and it is not safe.
  ok('a share with ANOTHER round\'s change is refused too',
    t.undoesARound(['Tango mix - alice', 'Tango change - bob']) === 'alice');
  ok('a marker does not make a pair safe',
    t.undoesARound([
      'Tango mix - alice · 2026-09-24', 'Tango change - alice · 2026-10-01',
    ]) === 'alice');
  ok('and the round-id marker it replaced is still recognised',
    t.undoesARound(['Tango mix - alice #7c2e', 'Tango change - alice #3f9a'])
      === 'alice');
  ok('two shares together are not this failure',
    t.undoesARound(['Tango mix - alice', 'Tango mix - bob']) === null);
  ok('nor are two changes',
    t.undoesARound(['Tango change - alice', 'Tango change - bob']) === null);
  ok('a label the user wrote themselves is left alone',
    t.undoesARound(['my Tango mix - alice', 'Tango change - alice']) === null &&
    t.undoesARound(['Tango mixer fund', 'Tango change - alice']) === null);
}

console.log(
  failed
    ? `\n${failed} check(s) failed`
    : '\nall checks passed — both sides mix what the server mixes',
);
process.exit(failed ? 1 : 0);
