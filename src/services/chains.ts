// Which chain an address belongs to.
//
// MIRRORS helpers/chains.py, which is the authority — the server refuses the
// send either way. This exists so the refusal arrives while the address is
// being typed instead of at Build, and so Save contact can refuse without a
// round trip.
//
// WHY IT IS A GUARD AND NOT A FORMALITY. A BIP-352 address carries its chain
// in the HRP and nowhere else — sp1 for mainnet, tsp1 for everything else —
// and the scan and spend keys inside are the same bytes either way. So a
// mainnet sp1… pasted into a signet wallet derives a perfectly valid signet
// output. On-chain addresses are no better: bc1q…, tb1q… and bcrt1q… convert
// to the identical scriptPubKey.
//
// The transaction then builds, signs, broadcasts and confirms, and the money
// is gone — the recipient is scanning the other chain and never sees it, and
// nothing bounces. Nothing after the build can catch this, so the address
// itself is the only place to catch it.
//
// signet and testnet are deliberately one family: they share tb1 and the
// base58 versions, so no address tells them apart and pretending otherwise
// would refuse valid recipients.
//
// NO IMPORTS, so both bundles can have it for what it weighs.

export type ChainFamily = 'main' | 'test' | 'regtest' | 'test-or-regtest';

const BECH32_FAMILY: Record<string, ChainFamily> = {
  bc: 'main',
  sp: 'main',
  tb: 'test',
  tsp: 'test',
  bcrt: 'regtest',
};

// base58 version bytes, by leading character. Testnet and regtest share these.
const BASE58_MAIN = ['1', '3'];
const BASE58_TEST = ['m', 'n', '2'];

// A leading character is not enough to call something an address: "11111"
// starts with a 1. base58check addresses are 26-35 characters from this
// alphabet (no 0, O, I or l).
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function looksBase58(address: string): boolean {
  if (address.length < 26 || address.length > 35) return false;
  for (const c of address) if (!BASE58_ALPHABET.includes(c)) return false;
  return true;
}

/** null when unrecognised — an unknown format is the address parser's problem,
 *  and refusing it here would be guessing. */
export function addressChainFamily(address: string): ChainFamily | null {
  const raw = (address || '').trim();
  const a = raw.toLowerCase();
  if (!a) return null;
  const sep = a.lastIndexOf('1');
  if (sep > 0) {
    // The bech32 separator is the LAST '1': it is not in the data charset, so
    // any earlier one is part of the HRP.
    const fam = BECH32_FAMILY[a.slice(0, sep)];
    if (fam) return fam;
  }
  if (looksBase58(raw)) {
    if (BASE58_MAIN.includes(raw[0])) return 'main';
    // Indistinguishable by design: testnet, signet and regtest share these.
    if (BASE58_TEST.includes(raw[0])) return 'test-or-regtest';
  }
  return null;
}

export function walletChainFamily(network: string): ChainFamily {
  const n = (network || '').trim().toLowerCase();
  if (n === 'mainnet') return 'main';
  if (n === 'regtest') return 'regtest';
  return 'test';
}

const FAMILY_NAME: Record<string, string> = {
  main: 'mainnet',
  test: 'testnet/signet',
  regtest: 'regtest',
};

/**
 * The message to refuse with, or null when the recipient is on this chain.
 *
 * A BitMail (name@domain) is null here and judged by the server once resolved:
 * the name says nothing about a chain, and only the address it resolves to
 * does.
 */
export function chainMismatch(
  recipient: string,
  network: string,
): string | null {
  const addr = (recipient || '').trim();
  if (!addr || addr.includes('@')) return null;
  const theirs = addressChainFamily(addr);
  if (theirs === null) return null;
  const ours = walletChainFamily(network);
  if (theirs === ours) return null;
  // A base58 address cannot distinguish these three, so accept it on any.
  if (theirs === 'test-or-regtest' && (ours === 'test' || ours === 'regtest')) {
    return null;
  }
  // tb1/tsp1 on regtest: the same addresses regtest itself hands out.
  if (ours === 'regtest' && theirs === 'test') return null;
  return (
    `That is a ${FAMILY_NAME[theirs] || theirs} address and this wallet is on `
    + `${network}. Coins sent to it would be unspendable by the recipient and `
    + 'unrecoverable by you.'
  );
}
