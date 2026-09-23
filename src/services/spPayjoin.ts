// Client-side Silent Payments PayJoin: derivation, signing and — the part that
// actually protects the money — the checks run before either party signs.
//
// WHY A PAYJOIN NEEDS ITS OWN DERIVATION. An ordinary send reaches BIP-352's
// shared secret as input_hash · a_sum · B_scan, summing the PRIVATE keys of
// every input. In a PayJoin the inputs have two owners and neither can compute
// a_sum. The same secret is also input_hash · A_sum · b_scan, over the sum of
// the input PUBLIC keys — public once the inputs are agreed — so each party
// derives its OWN output from its own scan key and a shared, public input set.
// spSign.ts cannot be reused for it: that path needs every input key.
//
// WHY THE SERVER CANNOT DO ANY OF THIS. Deriving an output needs that party's
// scan key; signing an input needs the spend key. Both stay here. The
// coordinator gets outpoints, x-only public keys, amounts, two scriptPubKeys
// and two sets of signatures, and it can no more spend those coins than a block
// explorer can.
//
// WHAT EACH SIDE CAN VERIFY IS NOT SYMMETRIC, and this is the crux:
//
//   The PAYEE derived the payment script, so it checks that output by SCRIPT.
//   The PAYER cannot — the script comes from the payee's scan key, which the
//   payer will never hold — so it checks that output by VALUE, and checks its
//   own change output by script.
//
// Between them every satoshi is accounted for: the payer knows exactly what
// leaves its inputs and exactly where its change goes, without ever being able
// to confirm where the payment lands. That asymmetry is fine, because paying
// the wrong payee is the payee's loss, not the payer's — but only if the value
// is pinned, which is what checkBeforeSigning does.
//
// Held to vectors from the Python, like every other derivation here:
//   node scripts/check-payjoin-signing.mjs
// regenerated with siLNt helpers/_payjoin_sp_fixtures.py after ANY change to
// the derivation, the fee formula or either ordering, on either side.

import { secp256k1, schnorr } from '@noble/curves/secp256k1';

import {
  DUST_SATS,
  TAPROOT_OUTPUT_VBYTES,
  bigToBytes,
  bytesToBig,
  concat,
  estimateVsize,
  fromHex,
  labelledSpendPub,
  serializeUnsigned,
  taggedHash,
  taprootSighash,
  toHex,
  u32be,
  type TxIn,
  type TxOut,
} from './spSign';

const N = secp256k1.CURVE.n;

/** One contributed UTXO. `priv_key_tweak` is present only for our own. */
export interface PayjoinInput {
  txid: string;
  vout: number;
  amount: number;
  /** 32-byte x-only key, hex, exactly as it sits on chain. */
  pub_key: string;
  priv_key_tweak?: string;
}

export interface PayjoinAmounts {
  payer_in: number;
  payee_in: number;
  payment: number;
  amount: number;
  fee: number;
  change: number;
  vsize: number;
}

function outpointBytes(txid: string, vout: number): Uint8Array {
  const out = new Uint8Array(36);
  out.set(fromHex(txid).reverse(), 0);
  new DataView(out.buffer).setUint32(32, vout, true);
  return out;
}

/**
 * BIP-69 input order.
 *
 * Both parties have to agree on one order before deriving anything, because
 * the transaction each signs must be the same transaction. BIP-69 gives that
 * with no negotiation round: it is a function of the outpoints, which both
 * sides already know. Mirrors payjoin_sp.py::canonical.
 */
export function canonical(inputs: PayjoinInput[]): PayjoinInput[] {
  return [...inputs].sort((a, b) =>
    a.txid === b.txid ? a.vout - b.vout : a.txid < b.txid ? -1 : 1,
  );
}

/**
 * (A_sum, input_hash) for a frozen input set — all public.
 *
 * Every input is P2TR, so each contributes its x-only key lifted to EVEN Y.
 * That lift is the public-side counterpart of negating an odd-Y private key on
 * the sender side, and the two must agree exactly. If they do not, both parties
 * derive outputs that belong to nobody, both signatures still verify, and the
 * network accepts the transaction — detected-and-unspendable, for two people at
 * once, with no error raised anywhere. Hence the fixtures pin A_sum's
 * compressed form, parity byte included.
 */
export function inputDigest(inputs: PayjoinInput[]): {
  aSum: Uint8Array;
  inputHash: bigint;
} {
  if (!inputs.length) throw new Error('A PayJoin needs inputs from both parties.');

  let point = secp256k1.ProjectivePoint.ZERO;
  for (const i of inputs) {
    if (i.pub_key.length !== 64) {
      throw new Error(
        `${i.txid}:${i.vout} is not a 32-byte x-only key — only taproot inputs ` +
          `take part in this input set.`,
      );
    }
    // 0x02 forces even Y, which is what an x-only key on chain means.
    point = point.add(
      secp256k1.ProjectivePoint.fromHex(`02${i.pub_key.toLowerCase()}`),
    );
  }
  const aSum = point.toRawBytes(true);

  const outpointL = inputs
    .map((i) => outpointBytes(i.txid, i.vout))
    .reduce((min, o) => (toHex(o) < toHex(min) ? o : min));

  const inputHash = bytesToBig(taggedHash('BIP0352/Inputs', outpointL, aSum)) % N;
  return { aSum, inputHash };
}

/**
 * P_k for an output paying the holder of `scanSecretHex`, from public inputs.
 *
 * Returns the compressed point, not a script. A labelled output adds the label
 * on the curve, so it needs the real Y parity; throwing that away and guessing
 * builds an unspendable output half the time, and the scanner still finds it
 * because it tests both label signs. Mirrors payjoin_sp.py::own_output_point.
 */
export function ownOutputPoint(
  scanSecretHex: string,
  spendPub: Uint8Array,
  inputs: PayjoinInput[],
  k = 0,
): Uint8Array {
  const { aSum, inputHash } = inputDigest(inputs);
  const bScan = bytesToBig(fromHex(scanSecretHex)) % N;

  const ecdh = secp256k1.ProjectivePoint.fromHex(aSum).multiply(
    (bScan * inputHash) % N,
  );
  const tK = bytesToBig(
    taggedHash('BIP0352/SharedSecret', ecdh.toRawBytes(true), u32be(k)),
  );
  if (tK === 0n || tK >= N) throw new Error('t_k out of range');

  return secp256k1.ProjectivePoint.fromHex(spendPub)
    .add(secp256k1.ProjectivePoint.BASE.multiply(tK))
    .toRawBytes(true);
}

function spk(point: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0x51, 0x20]), point.slice(1));
}

/**
 * The payee's output. Only the payee can compute it, which is exactly why the
 * payer checks that output by value instead of by script.
 */
export function paymentScript(
  scanSecretHex: string,
  spendPub: Uint8Array,
  inputs: PayjoinInput[],
): Uint8Array {
  return spk(ownOutputPoint(scanSecretHex, spendPub, inputs));
}

/**
 * The payer's change, to its own m=0 labelled address.
 *
 * The label is folded into B_spend BEFORE the derivation, which keeps the whole
 * thing as one addition of full points with no x-only key in the middle and no
 * parity to get wrong. Same order as wallet.py and payjoin_sp.py.
 */
export function changeScript(
  scanSecretHex: string,
  spendPub: Uint8Array,
  inputs: PayjoinInput[],
): Uint8Array {
  const labelled = labelledSpendPub(scanSecretHex, spendPub, 0);
  return spk(ownOutputPoint(scanSecretHex, labelled, inputs));
}

/** (vsize, fee). Every input and every output in a PayJoin is P2TR. */
export function estimateFee(
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

/**
 * Mirrors payjoin_sp.py::plan — the server is the authority for this and the
 * client recomputes it only to check the quote it was given.
 */
export function plan(
  payerInputs: PayjoinInput[],
  payeeInputs: PayjoinInput[],
  amount: number,
  feeRate: number,
): PayjoinAmounts {
  if (amount < DUST_SATS) {
    throw new Error(`${amount} sats is below the ${DUST_SATS} sat dust limit.`);
  }
  if (!payerInputs.length || !payeeInputs.length) {
    throw new Error('A PayJoin needs inputs from both parties.');
  }
  const payerIn = payerInputs.reduce((s, i) => s + i.amount, 0);
  const payeeIn = payeeInputs.reduce((s, i) => s + i.amount, 0);
  const nIn = payerInputs.length + payeeInputs.length;

  let { fee } = estimateFee(nIn, 2, feeRate);
  let change = payerIn - amount - fee;

  if (change < 0) {
    const spendable = payerIn - fee;
    if (spendable < DUST_SATS) {
      throw new Error(
        `Your coins total ${payerIn} sats, which leaves ${spendable} after a ` +
          `${fee} sat fee — below the ${DUST_SATS} sat dust limit.`,
      );
    }
    throw new Error(
      `Not enough to cover ${amount} sats plus a ${fee} sat fee — your ` +
        `selected coins total ${payerIn} sats, and the most they can send is ` +
        `${spendable} sats.`,
    );
  }

  if (change < DUST_SATS) {
    // Uneconomic to create, so it goes to the miner — and the transaction is
    // one output smaller than the estimate assumed.
    fee = estimateFee(nIn, 1, feeRate).fee;
    fee += Math.max(0, payerIn - amount - fee);
    change = 0;
  }

  return {
    payer_in: payerIn,
    payee_in: payeeIn,
    payment: amount + payeeIn,
    amount,
    fee,
    change,
    vsize: estimateFee(nIn, change ? 2 : 1, feeRate).vsize,
  };
}

/** Transaction outputs in BIP-69 order, from the two derived scripts. */
export function outputsFor(
  amounts: PayjoinAmounts,
  paymentSpk: Uint8Array,
  changeSpk: Uint8Array | null,
): TxOut[] {
  const outs: TxOut[] = [{ value: amounts.payment, script: paymentSpk }];
  if (amounts.change) {
    if (!changeSpk) throw new Error('change is non-zero but no change script was derived');
    outs.push({ value: amounts.change, script: changeSpk });
  }
  outs.sort((a, b) =>
    a.value !== b.value ? a.value - b.value : toHex(a.script) < toHex(b.script) ? -1 : 1,
  );
  return outs;
}

export interface Assembled {
  vin: TxIn[];
  vout: TxOut[];
  /** Input amounts and scripts in tx order — both are in the sighash. */
  amounts: number[];
  scripts: Uint8Array[];
  unsignedHex: string;
}

/**
 * The transaction, rebuilt locally from the frozen input set and the two
 * scripts. Rebuilt and never taken from the server: a signature commits to
 * every prevout, amount, script and output, so signing something the server
 * handed over would be signing something nobody checked.
 */
export function assemble(
  inputs: PayjoinInput[],
  amounts: PayjoinAmounts,
  paymentSpk: Uint8Array,
  changeSpk: Uint8Array | null,
): Assembled {
  const ordered = canonical(inputs);
  const vin: TxIn[] = ordered.map((i) => ({ txid: i.txid, vout: i.vout }));
  const vout = outputsFor(amounts, paymentSpk, changeSpk);
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

/** Which positions in the frozen set are ours to sign. */
export function ownIndices(
  inputs: PayjoinInput[],
  mine: PayjoinInput[],
): number[] {
  const keys = new Set(mine.map((i) => `${i.txid.toLowerCase()}:${i.vout}`));
  return canonical(inputs)
    .map((i, n) => (keys.has(`${i.txid.toLowerCase()}:${i.vout}`) ? n : -1))
    .filter((n) => n >= 0);
}

/**
 * The full signing key for one of our own PayJoin inputs: b_spend + tweak,
 * negated when the point has odd Y.
 *
 * spSign.ts::inputSigningKey does the same arithmetic for an SpUtxo. Kept
 * separate only because a PayjoinInput's tweak is optional — the
 * counterparty's inputs arrive without one, and asking for a key we do not
 * have must fail loudly rather than coerce undefined to zero.
 */
export function inputSigningKey(
  spendKeyHex: string,
  input: PayjoinInput,
): Uint8Array {
  if (!input.priv_key_tweak) {
    throw new Error(
      `${input.txid}:${input.vout} is not one of your coins — no tweak for it.`,
    );
  }
  let k =
    (bytesToBig(fromHex(spendKeyHex)) + bytesToBig(fromHex(input.priv_key_tweak))) % N;
  if (k === 0n) throw new Error('Degenerate signing key for an input.');
  if (secp256k1.getPublicKey(bigToBytes(k), true)[0] === 0x03) k = N - k;
  const priv = bigToBytes(k);
  if (toHex(secp256k1.getPublicKey(priv, true).slice(1)) !== input.pub_key.toLowerCase()) {
    throw new Error(
      'Your spend key does not match this coin — re-import the wallet on this device.',
    );
  }
  return priv;
}

export type Role = 'payer' | 'payee';

export interface CheckOpts {
  role: Role;
  /** The frozen set, both parties' inputs. */
  inputs: PayjoinInput[];
  /** Ours out of that set. */
  mine: PayjoinInput[];
  /** What the server quoted. */
  amounts: PayjoinAmounts;
  /** The payee's output script AS THE SERVER HOLDS IT. */
  paymentSpk: Uint8Array;
  /** The payer's change script as the server holds it, or is about to. */
  changeSpk: Uint8Array | null;
  /**
   * The same two scripts as DERIVED ON THIS DEVICE, where this device can
   * derive them — and they are kept apart from the server's copies on purpose.
   * Comparing the server's value against itself is the bug this API shape
   * exists to prevent: an earlier version assembled the transaction from the
   * substituted script and then looked for that script in the outputs, which
   * of course it found. Every substitution passed.
   *
   * The payee can derive the payment script and so must pass
   * expectPaymentSpk; it is the check that catches a coordinator swapping the
   * payee's output between /contribute and /sign. The payer can never derive
   * it and passes null. The payer passes expectChangeSpk on the re-check of a
   * transaction it did not just build.
   */
  expectPaymentSpk?: Uint8Array | null;
  expectChangeSpk?: Uint8Array | null;
  /** What we committed at /propose or /contribute. */
  committed: PayjoinInput[];
  /** The amount we agreed to pay or be paid. */
  amount: number;
  feeRate: number;
}

/**
 * Everything that must hold before we put a signature on this transaction.
 *
 * A signature over a taproot key-path spend authorises the whole transaction —
 * every input and every output — so this is the only moment either party gets
 * to refuse. Throws with something a person can read; the caller shows it and
 * does not sign.
 *
 * The checks differ by role for the reason in the file header: only the payee
 * can recompute the payment script, so the payer pins that output's VALUE
 * instead. Anything not listed here is something neither party is relying on.
 */
export function checkBeforeSigning(opts: CheckOpts): Assembled {
  const { role, inputs, mine, amounts, paymentSpk, changeSpk, committed } = opts;

  // 1. The input set contains exactly the coins we committed, and no other
  //    coin of ours. The second half is the one that matters: an extra input
  //    of ours smuggled into the set would be ours to sign and ours to lose.
  const committedKeys = new Set(
    committed.map((i) => `${i.txid.toLowerCase()}:${i.vout}`),
  );
  const mineKeys = mine.map((i) => `${i.txid.toLowerCase()}:${i.vout}`);
  if (mineKeys.length !== committedKeys.size ||
      !mineKeys.every((k) => committedKeys.has(k))) {
    throw new Error(
      'The coins in this PayJoin are not the ones you chose. Cancel it.',
    );
  }
  // And the amounts attributed to them are the amounts they actually hold.
  const byKey = new Map(
    committed.map((i) => [`${i.txid.toLowerCase()}:${i.vout}`, i.amount]),
  );
  for (const i of mine) {
    if (byKey.get(`${i.txid.toLowerCase()}:${i.vout}`) !== i.amount) {
      throw new Error(
        `${i.txid}:${i.vout} is listed with the wrong amount. Cancel it.`,
      );
    }
  }

  // 2. The arithmetic is the arithmetic. Recomputed from the frozen set rather
  //    than trusted, so a server that quoted one fee and built another is
  //    caught here and not by the balance afterwards.
  const payer = inputs.filter((i) =>
    role === 'payer'
      ? mineKeys.includes(`${i.txid.toLowerCase()}:${i.vout}`)
      : !mineKeys.includes(`${i.txid.toLowerCase()}:${i.vout}`),
  );
  const payee = inputs.filter((i) => !payer.includes(i));
  const ours = plan(payer, payee, opts.amount, opts.feeRate);
  for (const field of ['payment', 'change', 'fee', 'vsize'] as const) {
    if (ours[field] !== amounts[field]) {
      throw new Error(
        `The server says the ${field} is ${amounts[field]}; this device ` +
          `computes ${ours[field]}. Cancel it.`,
      );
    }
  }

  // 3. Outputs. Both roles check the payment output's VALUE; only the payee can
  //    check its script, and only the payer has a change output to check.
  if (amounts.payment !== opts.amount + ours.payee_in) {
    throw new Error(
      'The payment output is not for the agreed amount. Cancel it.',
    );
  }
  // The scripts this device derived must be the scripts the server holds.
  // Checked BEFORE assembling, because assembling from the server's copy and
  // then looking for it is no check at all.
  if (opts.expectPaymentSpk && toHex(opts.expectPaymentSpk) !== toHex(paymentSpk)) {
    throw new Error(
      'The payment is not to the address this device derived. Cancel it.',
    );
  }
  if (opts.expectChangeSpk && toHex(opts.expectChangeSpk) !== toHex(changeSpk ?? new Uint8Array())) {
    throw new Error(
      'Your change is not going where this device sent it. Cancel it.',
    );
  }
  if (role === 'payer' && amounts.change && !changeSpk) {
    throw new Error('No change script was derived on this device.');
  }

  const assembled = assemble(inputs, amounts, paymentSpk, changeSpk);
  if (assembled.vout.length !== (amounts.change ? 2 : 1)) {
    throw new Error('This PayJoin pays somewhere it should not. Cancel it.');
  }
  // The values land on the right scripts. Weak for the payer's own change,
  // which it just derived, and the point for the payment output: this is the
  // payer's only hold on an output it cannot recompute.
  const byScript = new Map(assembled.vout.map((o) => [toHex(o.script), o.value]));
  if (byScript.get(toHex(paymentSpk)) !== amounts.payment) {
    throw new Error('The payment output is not for the amount quoted. Cancel it.');
  }
  if (amounts.change && changeSpk && byScript.get(toHex(changeSpk)) !== amounts.change) {
    throw new Error(
      'Your change is not in this transaction where it should be. Cancel it.',
    );
  }

  return assembled;
}

/**
 * Sign our own inputs of a checked transaction. {index: hex}, ready to post.
 *
 * Takes an already-checked `Assembled` rather than doing the checks itself, so
 * that a caller cannot sign without having run them — there is no path here
 * that produces a signature from raw server data.
 */
export function signOwnInputs(
  assembled: Assembled,
  inputs: PayjoinInput[],
  mine: PayjoinInput[],
  spendKeyHex: string,
): Record<string, string> {
  const ordered = canonical(inputs);
  // Tweaks come from `mine` — this device's own wallet records — and never
  // from `inputs`, which arrived from the server. inputSigningKey would catch
  // a wrong tweak either way (the derived key must reproduce the on-chain
  // pub_key), but taking a secret-shaped value from the coordinator and
  // signing with it is the wrong direction to be moving in, and a version of
  // this function did exactly that.
  const ownTweaks = new Map(
    mine.map((i) => [`${i.txid.toLowerCase()}:${i.vout}`, i.priv_key_tweak]),
  );
  const out: Record<string, string> = {};
  for (const n of ownIndices(inputs, mine)) {
    const at = ordered[n];
    const key = inputSigningKey(spendKeyHex, {
      ...at,
      priv_key_tweak: ownTweaks.get(`${at.txid.toLowerCase()}:${at.vout}`),
    });
    const digest = taprootSighash(
      assembled.vin,
      assembled.vout,
      n,
      assembled.amounts,
      assembled.scripts,
    );
    out[String(n)] = toHex(schnorr.sign(digest, key));
  }
  if (!Object.keys(out).length) {
    throw new Error('None of the coins in this PayJoin are yours to sign.');
  }
  return out;
}
