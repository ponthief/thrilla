// Client-side Silent Payments transaction building and signing.
//
// WHY THIS EXISTS. Sending currently posts the spend key to the server, which
// derives the outputs and signs (siLNt helpers/wallet.py::build_transaction).
// The key is never stored and never logged there, but it crosses the network on
// every send, and the server already holds priv_key_tweak for every UTXO — so
// for those seconds it holds both halves of every input key, and a compromise
// would cost the whole wallet rather than the payment. This module removes the
// reason to send it.
//
// It is a second implementation of code where a mistake is unrecoverable, which
// is the same bet spKeys.ts took for key derivation and settled the same way:
// against vectors generated from the Python. Run them with
//   node scripts/check-sp-signing.mjs
// and regenerate with siLNt helpers/_client_signing_fixtures.py after ANY change
// to the derivation, the fee formula or the output ordering — on either side.
//
// Built on @noble/curves and @noble/hashes, already dependencies. BIP-341
// sighash and transaction serialisation are written out here rather than
// pulling in a signing library: the case is narrow (every input is P2TR
// key-path, SIGHASH_DEFAULT, no annex, no script path), and adding dependency
// surface to fix an exposure problem is the wrong trade.

import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { bech32m } from '@scure/base';

const BECH32M_LIMIT = 1023;
const N = secp256k1.CURVE.n;

// Mirrors helpers/wallet.py DUST_SATS. Stricter than Bitcoin Core's 330-sat
// relay floor for a P2TR output, and the same number the Coins screen uses.
export const DUST_SATS = 546;

export interface SpUtxo {
  txid: string;           // big-endian, as an explorer shows it
  vout: number;
  amount: number;         // sats
  priv_key_tweak: string; // hex, from the scanner
  pub_key: string;        // hex, 32-byte x-only, as it sits on chain
}

export interface BuiltTx {
  tx_hex: string;
  fee: number;
  amount: number;
  change: number;
  total_input: number;
  recipient: string;
  fee_rate_used: number;
  vsize: number;
}

// ── bytes ────────────────────────────────────────────────────────────────────

function fromHex(s: string): Uint8Array {
  const clean = s.startsWith('0x') ? s.slice(2) : s;
  if (clean.length % 2) throw new Error('odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function toHex(u8: Uint8Array): string {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

/** Bitcoin's compact size integer. */
function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return concat(new Uint8Array([0xfd]), u32le(n).slice(0, 2));
  return concat(new Uint8Array([0xfe]), u32le(n));
}

function bigToBytes(x: bigint): Uint8Array {
  const hex = x.toString(16).padStart(64, '0');
  return fromHex(hex);
}

function bytesToBig(b: Uint8Array): bigint {
  return BigInt('0x' + (toHex(b) || '0'));
}

function taggedHash(tag: string, ...data: Uint8Array[]): Uint8Array {
  // utf8ToBytes rather than TextEncoder: React Native's TS lib config has no
  // DOM globals, and this is already a dependency.
  const tagHash = sha256(utf8ToBytes(tag));
  return sha256(concat(tagHash, tagHash, ...data));
}

// ── BIP-352 ──────────────────────────────────────────────────────────────────

/** B_scan and B_spend, as 33-byte compressed keys, from an sp1…/tsp1… address. */
export function parseSpAddress(addr: string): { scan: Uint8Array; spend: Uint8Array } {
  const dec = bech32m.decode(addr as `${string}1${string}`, BECH32M_LIMIT);
  const payload = bech32m.fromWords(dec.words.slice(1)); // drop the version word
  if (payload.length < 66) throw new Error('Silent Payment address is too short.');
  return {
    scan: Uint8Array.from(payload.slice(0, 33)),
    spend: Uint8Array.from(payload.slice(33, 66)),
  };
}

/** outpoint bytes as BIP-352 orders and hashes them: reversed txid ++ vout LE. */
function outpoint(txid: string, vout: number): Uint8Array {
  return concat(fromHex(txid).reverse(), u32le(vout));
}

/**
 * The full signing key for one of our own SP inputs: b_spend + tweak, negated
 * when the resulting point has odd Y.
 *
 * The negation is BIP-340's, not optional, and it is what makes the key match
 * the x-only key on chain. Mirrors wallet.py::_prepare_inputs, and throws if the
 * result does not reproduce pub_key — a wrong wallet or a stale tweak fails
 * here instead of producing a signature the network rejects with nothing to
 * point at.
 */
export function inputSigningKey(spendKeyHex: string, u: SpUtxo): Uint8Array {
  let k = (bytesToBig(fromHex(spendKeyHex)) + bytesToBig(fromHex(u.priv_key_tweak))) % N;
  if (k === 0n) throw new Error('Degenerate signing key for an input.');
  if (secp256k1.getPublicKey(bigToBytes(k), true)[0] === 0x03) k = N - k;
  const priv = bigToBytes(k);
  if (toHex(secp256k1.getPublicKey(priv, true).slice(1)) !== u.pub_key.toLowerCase()) {
    throw new Error(
      'Your spend key does not match this coin — re-import the wallet on this device.',
    );
  }
  return priv;
}

/**
 * BIP-352 recipient output from the input private keys.
 *
 * Mirrors wallet.py::sp_scriptpubkey_from_inputs. Every input here is P2TR, so
 * every key contributes with even Y — inputSigningKey has already applied that,
 * which is why this sums those keys rather than re-deriving them.
 */
export function spScriptPubKey(
  spAddress: string,
  keys: Uint8Array[],
  utxos: SpUtxo[],
  k = 0,
): Uint8Array {
  if (keys.length !== utxos.length) throw new Error('key/utxo count mismatch');
  const { scan: bScan, spend: bSpend } = parseSpAddress(spAddress);

  let aSum = 0n;
  let aPoint = secp256k1.ProjectivePoint.ZERO;
  for (const key of keys) {
    aSum = (aSum + bytesToBig(key)) % N;
    aPoint = aPoint.add(secp256k1.ProjectivePoint.fromPrivateKey(key));
  }
  if (aSum === 0n) throw new Error('input keys sum to zero');

  const aSumBytes = aPoint.toRawBytes(true);
  const outpointL = utxos
    .map((u) => outpoint(u.txid, u.vout))
    .reduce((min, o) => (toHex(o) < toHex(min) ? o : min));

  const inputHash = bytesToBig(taggedHash('BIP0352/Inputs', outpointL, aSumBytes)) % N;

  const ecdh = secp256k1.ProjectivePoint.fromHex(bScan).multiply(
    (aSum * inputHash) % N,
  );
  const tK = bytesToBig(
    taggedHash('BIP0352/SharedSecret', ecdh.toRawBytes(true), u32be(k)),
  );
  if (tK === 0n || tK >= N) throw new Error('t_k out of range');

  const P = secp256k1.ProjectivePoint.fromHex(bSpend).add(
    secp256k1.ProjectivePoint.BASE.multiply(tK),
  );
  return concat(new Uint8Array([0x51, 0x20]), P.toRawBytes(true).slice(1));
}

/** The m=0 labelled address this wallet sends its change to. */
export function labelledChangeAddress(
  scanSecretHex: string,
  spendPub: Uint8Array,
  m: number,
  hrp: string,
): string {
  const tweak = bytesToBig(taggedHash('BIP0352/Label', fromHex(scanSecretHex), u32be(m))) % N;
  const labelled = secp256k1.ProjectivePoint.fromHex(spendPub)
    .add(secp256k1.ProjectivePoint.BASE.multiply(tweak))
    .toRawBytes(true);
  const scanPub = secp256k1.getPublicKey(fromHex(scanSecretHex), true);
  const words = [0, ...bech32m.toWords(concat(scanPub, labelled))];
  return bech32m.encode(hrp, words, BECH32M_LIMIT);
}

// ── amounts ──────────────────────────────────────────────────────────────────

/** Mirrors wallet.py::_compute_amounts, including the dust rules. */
export function computeAmounts(utxos: SpUtxo[], amount: number, feeRate: number) {
  const totalInput = utxos.reduce((s, u) => s + u.amount, 0);
  const vsize = Math.trunc(10 + 57.5 * utxos.length + 31 * 2);
  let fee = Math.max(1, Math.ceil(vsize * feeRate));

  if (amount < DUST_SATS) {
    throw new Error(
      `${amount} sats is below the ${DUST_SATS} sat dust limit. An output that ` +
        `small costs more to spend than it holds, and the network may refuse to ` +
        `relay it.`,
    );
  }

  let change = totalInput - amount - fee;
  if (change < 0) {
    const spendable = totalInput - fee;
    if (spendable < DUST_SATS) {
      throw new Error(
        `These coins total ${totalInput} sats, which leaves ${spendable} sats ` +
          `after a ${fee} sat fee — below the ${DUST_SATS} sat dust limit, so they ` +
          `cannot fund any payment at this fee rate.`,
      );
    }
    throw new Error(
      `Insufficient funds. Need ${amount + fee} sats (including ${fee} sats fee), ` +
        `have ${totalInput} sats. The most these coins can send is ${spendable} sats.`,
    );
  }
  if (change > 0 && change < DUST_SATS) {
    fee += change;
    change = 0;
  }
  return { totalInput, fee, change, vsize };
}

// ── transaction ──────────────────────────────────────────────────────────────

interface TxIn { txid: string; vout: number; }
interface TxOut { value: number; script: Uint8Array; }

function serializeUnsigned(vin: TxIn[], vout: TxOut[]): Uint8Array {
  return concat(
    u32le(2),
    varint(vin.length),
    ...vin.map((i) =>
      // sequence 0xFFFFFFFF matches what embit writes by default on the server;
      // it is part of the sighash, so it is not cosmetic.
      concat(fromHex(i.txid).reverse(), u32le(i.vout), varint(0), u32le(0xffffffff)),
    ),
    varint(vout.length),
    ...vout.map((o) => concat(u64le(o.value), varint(o.script.length), o.script)),
    u32le(0),
  );
}

/**
 * BIP-341 signature hash for a key-path spend with SIGHASH_DEFAULT.
 *
 * Narrow on purpose: every input is P2TR key-path, there is no annex and no
 * script path, so ext_flag and spend_type are both zero and the common
 * signature message is the whole of it.
 */
function taprootSighash(
  vin: TxIn[],
  vout: TxOut[],
  index: number,
  amounts: number[],
  scripts: Uint8Array[],
): Uint8Array {
  const shaPrevouts = sha256(
    concat(...vin.map((i) => concat(fromHex(i.txid).reverse(), u32le(i.vout)))),
  );
  const shaAmounts = sha256(concat(...amounts.map(u64le)));
  const shaScriptPubkeys = sha256(
    concat(...scripts.map((s) => concat(varint(s.length), s))),
  );
  const shaSequences = sha256(concat(...vin.map(() => u32le(0xffffffff))));
  const shaOutputs = sha256(
    concat(...vout.map((o) => concat(u64le(o.value), varint(o.script.length), o.script))),
  );

  return taggedHash(
    'TapSighash',
    new Uint8Array([0]),        // sighash epoch
    new Uint8Array([0]),        // SIGHASH_DEFAULT
    u32le(2),                   // nVersion
    u32le(0),                   // nLockTime
    shaPrevouts,
    shaAmounts,
    shaScriptPubkeys,
    shaSequences,
    shaOutputs,
    new Uint8Array([0]),        // spend_type: no annex, key path
    u32le(index),
  );
}

/**
 * Build and sign a Silent Payments transaction, entirely on this device.
 *
 * The drop-in replacement for POST /api/v1/tx/build: same inputs, same output,
 * no spend key on the wire. The result goes to /api/v1/tx/broadcast, which
 * already takes tx_hex.
 */
export function buildSignedTx(opts: {
  recipient: string;          // sp1…/tsp1… or a plain scriptPubKey hex
  recipientScriptHex?: string; // for a non-SP recipient, resolved by the caller
  amount: number;
  feeRate: number;
  utxos: SpUtxo[];
  spendKey: string;
  scanSecret: string;
  network: string;
}): BuiltTx {
  const { recipient, amount, feeRate, utxos, spendKey, scanSecret, network } = opts;
  if (!utxos.length) throw new Error('No coins selected.');

  const keys = utxos.map((u) => inputSigningKey(spendKey, u));
  const { totalInput, fee, change, vsize } = computeAmounts(utxos, amount, feeRate);

  const isSp = recipient.startsWith('sp1') || recipient.startsWith('tsp1');
  const recipientScript = isSp
    ? spScriptPubKey(recipient, keys, utxos)
    : fromHex(
        opts.recipientScriptHex ||
          (() => {
            throw new Error('A non-Silent-Payment recipient needs a resolved script.');
          })(),
      );

  const outs: TxOut[] = [{ value: amount, script: recipientScript }];
  if (change >= DUST_SATS) {
    const hrp = network === 'mainnet' ? 'sp' : 'tsp';
    const spendPub = secp256k1.getPublicKey(fromHex(spendKey), true);
    // m=0 is BIP-352's reserved change label. Deriving the labelled ADDRESS and
    // then the output from it — rather than adding the label to the output key
    // — keeps the arithmetic on full points, where there is no Y parity to get
    // wrong. Same order as wallet.py::_derive_change_script.
    const changeAddress = labelledChangeAddress(scanSecret, spendPub, 0, hrp);
    outs.push({ value: change, script: spScriptPubKey(changeAddress, keys, utxos) });
  }

  // BIP-69 on both sides, matching the server: inputs by (txid, vout), outputs
  // by (value, script).
  const order = utxos
    .map((u, i) => i)
    .sort((a, b) =>
      utxos[a].txid === utxos[b].txid
        ? utxos[a].vout - utxos[b].vout
        : utxos[a].txid < utxos[b].txid ? -1 : 1,
    );
  const vin: TxIn[] = order.map((i) => ({ txid: utxos[i].txid, vout: utxos[i].vout }));
  const amounts = order.map((i) => utxos[i].amount);
  const scripts = order.map((i) =>
    concat(new Uint8Array([0x51, 0x20]), fromHex(utxos[i].pub_key)),
  );
  const sortedKeys = order.map((i) => keys[i]);

  outs.sort((a, b) => (a.value - b.value) || (toHex(a.script) < toHex(b.script) ? -1 : 1));

  const witnesses = vin.map((_in, i) =>
    schnorr.sign(taprootSighash(vin, outs, i, amounts, scripts), sortedKeys[i]),
  );

  const signed = concat(
    u32le(2),
    new Uint8Array([0x00, 0x01]),   // segwit marker + flag
    varint(vin.length),
    ...vin.map((i) =>
      concat(fromHex(i.txid).reverse(), u32le(i.vout), varint(0), u32le(0xffffffff)),
    ),
    varint(outs.length),
    ...outs.map((o) => concat(u64le(o.value), varint(o.script.length), o.script)),
    ...witnesses.map((w) => concat(varint(1), varint(w.length), w)),
    u32le(0),
  );

  return {
    tx_hex: toHex(signed),
    fee,
    amount,
    change,
    total_input: totalInput,
    recipient,
    fee_rate_used: feeRate,
    vsize,
  };
}

/** Exposed for the cross-check runner; not part of the sending path. */
export const __testing = {
  taprootSighash,
  serializeUnsigned,
  computeAmounts,
  spScriptPubKey,
  inputSigningKey,
  labelledChangeAddress,
  toHex,
  fromHex,
};
