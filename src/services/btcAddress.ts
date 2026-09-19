// Bitcoin address → scriptPubKey, on the device.
//
// WHY THIS EXISTS. Both send paths used to take the output script from the
// server, because the server built the whole transaction. Signing on the
// device fixes who holds the keys, but it does not by itself fix where the
// money goes — a client that signs whatever script it is handed is still paying
// whoever the server says. The address the user typed is the thing they
// checked, so the script has to come from that, here, and the server's answer
// is then only worth using as a cross-check.
//
// The one address that cannot work this way is a BitMail, which is a DNS
// lookup the device cannot do; the server resolves it and the user is shown the
// address it resolved to before anything is signed.
//
// Silent Payment addresses are NOT handled here — their output key comes from
// the input private keys (BIP-352), so see spSign.ts::spOutputScript.

import { sha256 } from '@noble/hashes/sha256';
import { base58check, bech32, bech32m } from '@scure/base';

const b58c = base58check(sha256);

interface NetParams {
  hrp: string;
  p2pkh: number;
  p2sh: number;
}

function paramsFor(network: string): NetParams {
  switch ((network || '').toLowerCase()) {
    case 'mainnet':
      return { hrp: 'bc', p2pkh: 0x00, p2sh: 0x05 };
    case 'regtest':
      return { hrp: 'bcrt', p2pkh: 0x6f, p2sh: 0xc4 };
    default:
      // Signet shares testnet's parameters, as helpers/plain.py::_net does.
      return { hrp: 'tb', p2pkh: 0x6f, p2sh: 0xc4 };
  }
}

/**
 * The scriptPubKey paying `address`, or a thrown error saying why not.
 *
 * Rejects an address for the wrong network rather than paying it: on signet
 * that is a typo, and on mainnet it would be real money to an output nobody
 * can spend.
 */
export function addressToScriptPubKey(address: string, network: string): Uint8Array {
  const addr = (address || '').trim();
  if (!addr) throw new Error('No destination address.');
  const net = paramsFor(network);

  const lower = addr.toLowerCase();
  if (lower.startsWith(net.hrp + '1')) {
    // Mixed case is invalid in bech32; decoding the lowercase form of an
    // all-uppercase address is the normal way to accept both.
    const isSegwit = /^[a-z0-9]+$/.test(lower);
    if (!isSegwit) throw new Error(`${addr} is not a valid address.`);
    let version: number;
    let program: Uint8Array;
    try {
      // v0 is bech32, v1+ is bech32m (BIP-350). Which one it is decides which
      // checksum is correct, so both are tried and the version word checked.
      const dec = (() => {
        try {
          return { d: bech32.decode(lower as `${string}1${string}`, 1023), m: false };
        } catch {
          return { d: bech32m.decode(lower as `${string}1${string}`, 1023), m: true };
        }
      })();
      version = dec.d.words[0];
      program = Uint8Array.from(bech32.fromWords(dec.d.words.slice(1)));
      if (version === 0 && dec.m) throw new Error('v0 must use bech32');
      if (version !== 0 && !dec.m) throw new Error('v1+ must use bech32m');
    } catch {
      throw new Error(`${addr} is not a valid address for this network.`);
    }
    if (version === 0 && program.length !== 20 && program.length !== 32) {
      throw new Error(`${addr} is not a valid segwit v0 address.`);
    }
    if (program.length < 2 || program.length > 40) {
      throw new Error(`${addr} has an invalid witness program.`);
    }
    const op = version === 0 ? 0x00 : 0x50 + version;
    const out = new Uint8Array(2 + program.length);
    out[0] = op;
    out[1] = program.length;
    out.set(program, 2);
    return out;
  }

  // Anything bech32-shaped that got here is for another network.
  if (/^(bc|tb|bcrt)1/.test(lower)) {
    throw new Error(`${addr} is not an address on this network.`);
  }

  let decoded: Uint8Array;
  try {
    decoded = b58c.decode(addr);
  } catch {
    throw new Error(`${addr} is not a valid address.`);
  }
  if (decoded.length !== 21) throw new Error(`${addr} is not a valid address.`);
  const version = decoded[0];
  const hash = decoded.slice(1);
  if (version === net.p2pkh) {
    // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    const out = new Uint8Array(25);
    out.set([0x76, 0xa9, 0x14], 0);
    out.set(hash, 3);
    out.set([0x88, 0xac], 23);
    return out;
  }
  if (version === net.p2sh) {
    // OP_HASH160 <20> OP_EQUAL
    const out = new Uint8Array(23);
    out.set([0xa9, 0x14], 0);
    out.set(hash, 2);
    out[22] = 0x87;
    return out;
  }
  throw new Error(`${addr} is not an address on this network.`);
}

/** The 20-byte witness program of a P2WPKH address, for its scriptCode. */
export function p2wpkhProgram(address: string, network: string): Uint8Array {
  const spk = addressToScriptPubKey(address, network);
  if (spk.length !== 22 || spk[0] !== 0x00 || spk[1] !== 0x14) {
    throw new Error(`${address} is not a native segwit (…1q…) address.`);
  }
  return spk.slice(2);
}
