// BIP-32 derivation paths, kept apart from the code that derives keys.
//
// spKeys.ts pulls in the BIP-39 wordlist and secp256k1 — ~72 kB — which is the
// right cost when you're actually deriving something, and pure waste for a view
// that only wants to SHOW a user which path their funds are on. Both live here
// so a path string never drags the crypto along with it.

// Coin type per SLIP-44: mainnet is 0, every test network shares 1. Matches the
// BIP-352 derivation in spKeys.ts and the backend (siLNt/helpers/wallet.py).
export function coinType(network: string): number {
  return network === 'mainnet' ? 0 : 1;
}

// BIP-84 account, the level an xprv/xpub is normally exported at. The sweep
// chain hangs off this, so the device can derive any receive address from the
// account key alone without going back to the seed.
export function sweepAccountPath(network: string): string {
  return `m/84'/${coinType(network)}'/0'`;
}

// BIP-84 external chain — where a failed swap's refund lands, and where coins
// paid in from a service that can't send to a Silent Payments address arrive.
// Standard on purpose: the same seed reaches it in Sparrow, Electrum or any
// other wallet, which is what makes the funds recoverable without Thrilla.
export function refundDerivationPath(network: string, index = 0): string {
  return `${sweepAccountPath(network)}/0/${index}`;
}

// The same address relative to the account key rather than the seed.
export const SWEEP_CHAIN_PATH = '0';
