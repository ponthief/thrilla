// Tango on the device: the amounts, the four outputs, and the checks that run
// before anything is signed.
//
// WHAT TANGO IS. A two-party mix. Nobody pays anybody: both sides put in the
// same amount and take the same amount back, so the two outputs are identical
// and an observer cannot say which belongs to which input. An anonymity set of
// two — small, real, and it compounds if you do it again with someone else.
//
// WHAT IT IS NOT. A PayJoin. There the outputs differ because one party is
// being paid, and what it hides is that the inputs had two owners. Here the
// outputs are deliberately the same, and what it hides is which is whose.
//
// EVERYTHING CRYPTOGRAPHIC COMES FROM spPayjoin.ts. BIP-352's shared secret
// over the input PUBLIC keys does not care whether anyone is being paid, and
// the sighash cares about inputs and outputs and not about meaning. A second
// copy of either is how two copies end up disagreeing — which has already
// happened once here, and cost a working feature until a real transaction
// failed to verify.
//
// Held to vectors from the Python:
//   node scripts/check-tango-signing.mjs
// regenerated with siLNt helpers/_tango_fixtures.py after ANY change to the
// amounts, the output ordering or the derivation, on either side.

import { schnorr } from '@noble/curves/secp256k1';

import {
  DUST_SATS,
  TAPROOT_OUTPUT_VBYTES,
  concat,
  estimateVsize,
  fromHex,
  serializeUnsigned,
  taprootSighash,
  toHex,
  type TxIn,
  type TxOut,
} from './spSign';
import {
  canonical,
  changeScript,
  inputSigningKey,
  ownIndices,
  paymentScript,
  withLocalTweaks,
  type PayjoinInput,
} from './spPayjoin';

export type { PayjoinInput } from './spPayjoin';
export { canonical, ownIndices, withLocalTweaks } from './spPayjoin';

/** Which side of a round you are. Neither pays the other. */
export type Side = 'a' | 'b';

export interface TangoAmounts {
  denom: number;
  a_in: number;
  b_in: number;
  a_change: number;
  b_change: number;
  a_fee: number;
  b_fee: number;
  fee: number;
  vsize: number;
  /** True only when NEITHER side needed change. The honest measure. */
  clean: boolean;
}

export function estimate(
  nInputs: number,
  nOutputs: number,
  feeRate: number,
): { vsize: number; fee: number } {
  const vsize = estimateVsize(
    nInputs,
    new Array(nOutputs).fill(TAPROOT_OUTPUT_VBYTES),
  );
  return { vsize, fee: Math.ceil(vsize * feeRate) };
}

/** (A's share, B's share). The odd satoshi goes to whoever proposed. */
export function splitFee(fee: number): [number, number] {
  const half = Math.floor(fee / 2);
  return [fee - half, half];
}

/**
 * Mirrors helpers/tango.py::plan. The server is the authority; this recomputes
 * so the client can refuse a quote it did not arrive at itself, and so the
 * coin picker can tell you what a selection costs before you commit to it.
 */
export function plan(
  aInputs: PayjoinInput[],
  bInputs: PayjoinInput[],
  denom: number,
  feeRate: number,
): TangoAmounts {
  if (denom < DUST_SATS) {
    throw new Error(
      `${denom} sats is below the ${DUST_SATS} sat dust limit, so neither ` +
        `side could spend what they got back.`,
    );
  }
  if (!aInputs.length || !bInputs.length) {
    throw new Error('A Tango needs coins from both sides.');
  }

  const aIn = aInputs.reduce((s, i) => s + i.amount, 0);
  const bIn = bInputs.reduce((s, i) => s + i.amount, 0);
  const nIn = aInputs.length + bInputs.length;

  const shares = (nOut: number) => {
    const { vsize, fee } = estimate(nIn, nOut, feeRate);
    const [aFee, bFee] = splitFee(fee);
    return { vsize, fee, aFee, bFee };
  };

  let { vsize, aFee, bFee } = shares(4);
  let aChange = aIn - denom - aFee;
  let bChange = bIn - denom - bFee;

  for (const [label, total, change, share] of [
    ['Your', aIn, aChange, aFee],
    ['Their', bIn, bChange, bFee],
  ] as const) {
    if (change < 0) {
      throw new Error(
        `${label} coins total ${total} sats, which does not cover ${denom} ` +
          `plus a ${share} sat share of the fee. Pick more, or agree a ` +
          `smaller amount.`,
      );
    }
  }

  // Dropping one change shrinks the transaction, which lowers the fee, which
  // can lift the OTHER change back above dust. Two passes settle it, because
  // there are only two changes to drop.
  for (let pass = 0; pass < 2; pass++) {
    const nOut = 2 + (aChange >= DUST_SATS ? 1 : 0) + (bChange >= DUST_SATS ? 1 : 0);
    const s = shares(nOut);
    vsize = s.vsize;
    aFee = s.aFee;
    bFee = s.bFee;
    const newA = aIn - denom - aFee;
    const newB = bIn - denom - bFee;
    if (newA < 0 || newB < 0) {
      throw new Error(
        'The fee moved above what one side’s coins can cover. Pick more ' +
          'coins, or agree a smaller amount.',
      );
    }
    aChange = newA;
    bChange = newB;
  }

  if (aChange >= 0 && aChange < DUST_SATS) {
    aFee += aChange;
    aChange = 0;
  }
  if (bChange >= 0 && bChange < DUST_SATS) {
    bFee += bChange;
    bChange = 0;
  }

  return {
    denom,
    a_in: aIn,
    b_in: bIn,
    a_change: aChange,
    b_change: bChange,
    a_fee: aFee,
    b_fee: bFee,
    fee: aFee + bFee,
    vsize,
    clean: aChange === 0 && bChange === 0,
  };
}

/**
 * The outputs, BIP-69 ordered.
 *
 * The two mixed outputs share a value, so the tie breaks on script bytes —
 * two unrelated fresh taproot keys. Neither side can influence the order,
 * which is what stops "the proposer's output is always first" from becoming
 * the thing that identifies them.
 */
export function outputsFor(
  amounts: TangoAmounts,
  aMix: Uint8Array,
  bMix: Uint8Array,
  aChange: Uint8Array | null,
  bChange: Uint8Array | null,
): TxOut[] {
  const outs: TxOut[] = [
    { value: amounts.denom, script: aMix },
    { value: amounts.denom, script: bMix },
  ];
  if (amounts.a_change) {
    if (!aChange) throw new Error('A has change but no change script was derived');
    outs.push({ value: amounts.a_change, script: aChange });
  }
  if (amounts.b_change) {
    if (!bChange) throw new Error('B has change but no change script was derived');
    outs.push({ value: amounts.b_change, script: bChange });
  }
  outs.sort((x, y) =>
    x.value !== y.value ? x.value - y.value : toHex(x.script) < toHex(y.script) ? -1 : 1,
  );
  return outs;
}

export interface Assembled {
  vin: TxIn[];
  vout: TxOut[];
  amounts: number[];
  scripts: Uint8Array[];
  unsignedHex: string;
}

export function assemble(
  inputs: PayjoinInput[],
  amounts: TangoAmounts,
  aMix: Uint8Array,
  bMix: Uint8Array,
  aChange: Uint8Array | null = null,
  bChange: Uint8Array | null = null,
): Assembled {
  const ordered = canonical(inputs);
  const vin: TxIn[] = ordered.map((i) => ({ txid: i.txid, vout: i.vout }));
  const vout = outputsFor(amounts, aMix, bMix, aChange, bChange);
  return {
    vin,
    vout,
    amounts: ordered.map((i) => i.amount),
    scripts: ordered.map((i) =>
      concat(new Uint8Array([0x51, 0x20]), fromHex(i.pub_key)),
    ),
    unsignedHex: toHex(serializeUnsigned(vin, vout)),
  };
}

/**
 * This side's two outputs: the mixed one at the denomination, and change when
 * the coins did not divide evenly.
 *
 * The mixed output goes to the wallet's plain Silent Payments address and the
 * change to its m=0 LABELLED one. That is not decoration: m=0 is BIP-352's
 * reserved change label, so the owner's own wallet recognises the change for
 * what it is without being told — which matters, because change is the part of
 * a two-party mix that leaks.
 */
export function deriveOwnOutputs(
  scanSecretHex: string,
  spendPub: Uint8Array,
  inputs: PayjoinInput[],
  needChange: boolean,
): { mix: Uint8Array; change: Uint8Array | null } {
  return {
    mix: paymentScript(scanSecretHex, spendPub, inputs),
    change: needChange ? changeScript(scanSecretHex, spendPub, inputs) : null,
  };
}

export interface CheckOpts {
  side: Side;
  /** The frozen set, both sides' coins. */
  inputs: PayjoinInput[];
  /** Ours out of it. */
  mine: PayjoinInput[];
  /** What the server quoted. */
  amounts: TangoAmounts;
  /** The four scripts AS THE SERVER HOLDS THEM. */
  aMix: Uint8Array;
  bMix: Uint8Array;
  aChange: Uint8Array | null;
  bChange: Uint8Array | null;
  /** Ours as DERIVED HERE, kept apart from the server's copies on purpose. */
  expectMix: Uint8Array;
  expectChange: Uint8Array | null;
  /**
   * The coins we committed, FROM OUR OWN RECORDS.
   *
   * Outpoint and amount only, deliberately: this is a list the device wrote
   * down when the user chose, and asking for keys or tweaks it has no reason
   * to store would push a caller towards handing back the server's copy of the
   * set instead — which is the one thing this field must not be.
   */
  committed: { txid: string; vout: number; amount: number }[];
  denom: number;
  feeRate: number;
}

/**
 * Everything that must hold before this device signs.
 *
 * A taproot key-path signature authorises the whole transaction, so this is the
 * only moment either side gets to refuse. Throws with a sentence to show the
 * user; every throw means cancel, not retry.
 *
 * The comparison that matters is expectMix against the server's copy. Checking
 * the server's value against itself is no check at all — that exact mistake
 * shipped in the PayJoin and let every substitution through.
 */
export function checkBeforeSigning(opts: CheckOpts): Assembled {
  const { side, inputs, mine, amounts, committed } = opts;

  // 1. Our coins are the ones we chose, and no others of ours crept in.
  const want = new Set(committed.map((i) => `${i.txid.toLowerCase()}:${i.vout}`));
  const have = mine.map((i) => `${i.txid.toLowerCase()}:${i.vout}`);
  if (have.length !== want.size || !have.every((k) => want.has(k))) {
    throw new Error('The coins in this Tango are not the ones you chose. Cancel it.');
  }
  const byKey = new Map(
    committed.map((i) => [`${i.txid.toLowerCase()}:${i.vout}`, i.amount]),
  );
  for (const i of mine) {
    if (byKey.get(`${i.txid.toLowerCase()}:${i.vout}`) !== i.amount) {
      throw new Error(`${i.txid}:${i.vout} is listed with the wrong amount. Cancel it.`);
    }
  }

  // 2. Both sides get the SAME amount. This is the entire privacy claim, so it
  //    is checked directly rather than inferred from the arithmetic below.
  if (amounts.denom <= 0) {
    throw new Error('This Tango has no denomination. Cancel it.');
  }

  // 3. The arithmetic is ours, recomputed from the frozen set.
  const mineKeys = new Set(have);
  const ours = inputs.filter((i) =>
    side === 'a'
      ? mineKeys.has(`${i.txid.toLowerCase()}:${i.vout}`)
      : !mineKeys.has(`${i.txid.toLowerCase()}:${i.vout}`),
  );
  const theirs = inputs.filter((i) => !ours.includes(i));
  const recomputed = plan(ours, theirs, opts.denom, opts.feeRate);
  for (const field of ['denom', 'a_change', 'b_change', 'fee', 'vsize'] as const) {
    if (recomputed[field] !== amounts[field]) {
      throw new Error(
        `The server says the ${field} is ${amounts[field]}; this device ` +
          `computes ${recomputed[field]}. Cancel it.`,
      );
    }
  }

  // 4. Our own outputs are the ones we derived — compared BEFORE assembling.
  const ourMix = side === 'a' ? opts.aMix : opts.bMix;
  const ourChange = side === 'a' ? opts.aChange : opts.bChange;
  if (toHex(opts.expectMix) !== toHex(ourMix)) {
    throw new Error('Your share is not going to the address this device derived. Cancel it.');
  }
  const expectChangeHex = opts.expectChange ? toHex(opts.expectChange) : null;
  const ourChangeHex = ourChange ? toHex(ourChange) : null;
  if (expectChangeHex !== ourChangeHex) {
    throw new Error('Your change is not going where this device sent it. Cancel it.');
  }

  const assembled = assemble(
    inputs, amounts, opts.aMix, opts.bMix, opts.aChange, opts.bChange,
  );

  // 5. Exactly two outputs at the denomination, and our own two are among
  //    them at the right values.
  const atDenom = assembled.vout.filter((o) => o.value === amounts.denom);
  if (atDenom.length !== 2) {
    throw new Error(
      'This Tango does not pay both sides the same amount, which is the only ' +
        'thing it is for. Cancel it.',
    );
  }
  const byScript = new Map(assembled.vout.map((o) => [toHex(o.script), o.value]));
  if (byScript.get(toHex(ourMix)) !== amounts.denom) {
    throw new Error('Your share is not in this transaction. Cancel it.');
  }
  const myChange = side === 'a' ? amounts.a_change : amounts.b_change;
  if (myChange && byScript.get(ourChangeHex!) !== myChange) {
    throw new Error('Your change is not in this transaction. Cancel it.');
  }
  const expectedOutputs =
    2 + (amounts.a_change ? 1 : 0) + (amounts.b_change ? 1 : 0);
  if (assembled.vout.length !== expectedOutputs) {
    throw new Error('This Tango pays somewhere it should not. Cancel it.');
  }

  return assembled;
}

/**
 * Sign our own inputs of a checked transaction.
 *
 * Takes an already-checked Assembled so no caller can produce a signature
 * without having run the checks, and takes the tweaks from `mine` — this
 * device's own records — never from the server's copy of the input set.
 */
export function signOwnInputs(
  assembled: Assembled,
  inputs: PayjoinInput[],
  mine: PayjoinInput[],
  spendKeyHex: string,
): Record<string, string> {
  const ordered = canonical(inputs);
  const tweaks = new Map(
    mine.map((i) => [`${i.txid.toLowerCase()}:${i.vout}`, i.priv_key_tweak]),
  );
  const out: Record<string, string> = {};
  for (const n of ownIndices(inputs, mine)) {
    const at = ordered[n];
    const key = inputSigningKey(spendKeyHex, {
      ...at,
      priv_key_tweak: tweaks.get(`${at.txid.toLowerCase()}:${at.vout}`),
    });
    const digest = taprootSighash(
      assembled.vin, assembled.vout, n, assembled.amounts, assembled.scripts,
    );
    out[String(n)] = toHex(schnorr.sign(digest, key));
  }
  if (!Object.keys(out).length) {
    throw new Error('None of the coins in this Tango are yours to sign.');
  }
  return out;
}

// ── the labels, and the one combination they exist to stop ──────────────────
// Mirrors helpers/tango.py. The backend writes these labels when the scanner
// finds the coins; this is the reading half, and it has to agree with the
// writing half exactly — a prefix that drifted by a character would silently
// stop refusing anything.

export const MIX_LABEL = 'Tango mix';
export const CHANGE_LABEL = 'Tango change';

/**
 * A short, stable tag for one round: "#7c2e".
 *
 * Two rounds with the same person used to produce two coins with identical
 * labels — a wallet showing "Tango change - alice" twice, with no way to tell
 * which round either came from. Four characters of the round id is enough to
 * tell them apart in a list and short enough to read. It is not a secret: the
 * id is the server's own key for a round both parties took part in.
 */
export function roundMarker(roundId?: string | null): string {
  const hexish = (roundId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return hexish ? `#${hexish.slice(0, 4)}` : '';
}

function named(prefix: string, other?: string | null, roundId?: string | null): string {
  const parts = [prefix];
  const who = (other || '').trim();
  if (who) parts.push(`- ${who}`);
  const mark = roundMarker(roundId);
  if (mark) parts.push(mark);
  return parts.join(' ');
}

export const mixLabel = (other?: string | null, roundId?: string | null) =>
  named(MIX_LABEL, other, roundId);
export const changeLabel = (other?: string | null, roundId?: string | null) =>
  named(CHANGE_LABEL, other, roundId);

/**
 * The counterparty named in one of our labels, or null if it is not one.
 *
 * Matched from the start and only up to a separator we wrote, never as a
 * substring: a coin the user named "my Tango mix money" is theirs, not ours,
 * and refusing to spend it would be us reading our own meaning into their
 * words. Accepts every shape this has written, including the ones with no
 * marker — those are the coins most likely to be in a wallet right now.
 */
function party(label: string, prefix: string): string | null {
  const text = (label || '').trim();
  if (text === prefix) return '';
  if (!text.startsWith(`${prefix} `)) return null;
  let rest = text.slice(prefix.length + 1).trim();
  if (rest.startsWith('- ')) rest = rest.slice(2).trim();
  else if (rest.startsWith('#')) return '';
  else return null;   // "Tango mix something we never wrote" is the user's
  const at = rest.lastIndexOf(' #');
  if (at !== -1) rest = rest.slice(0, at).trim();
  return rest;
}

/**
 * The round(s) a selection of coins would undo, named, or null.
 *
 * ANY TANGO SHARE WITH ANY TANGO CHANGE. Not only a share with its own
 * round's change, which is what this checked first and was too narrow.
 *
 * The reasoning that led there was that the two have to add up — a round's
 * change plus its share is what that side put in, so the arithmetic resolves
 * which of the two identical shares was theirs. True, and not the only way it
 * goes wrong. A Tango change coin is attributable BY CONSTRUCTION: its value
 * plus a share equals an input total, so an observer can tie it to the coins
 * its owner brought, which is exactly the history that owner had before the
 * mix. A share is the opposite: it is the coin that history was cut off from.
 * Put the two in one transaction and the cut is repaired — the share inherits
 * the change's attribution — whoever the round was with and whenever it
 * happened. Change from the alice round reconnects a share from the bob round
 * just as well.
 *
 * So the rule is by KIND, not by round, and the marker in a label is for the
 * person reading it rather than for this.
 *
 * Returns the counterparty of the share(s) at risk, since the share is what
 * loses its protection.
 */
export function undoesARound(labels: (string | null | undefined)[]): string | null {
  const mixed = new Set<string>();
  let hasChange = false;
  for (const raw of labels) {
    const asMix = party(raw || '', MIX_LABEL);
    if (asMix !== null) {
      mixed.add(asMix || 'someone');
      continue;
    }
    if (party(raw || '', CHANGE_LABEL) !== null) hasChange = true;
  }
  if (!mixed.size || !hasChange) return null;
  return [...mixed].sort().join(' and ');
}
