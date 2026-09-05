/*
 * Standalone check for the sweep chain (services/sweepChain, services/spKeys).
 * No jest — this repo has none set up:
 *
 *     node scripts/check-sweep-chain.cjs
 *
 * The sweep derives its addresses from the BIP-84 ACCOUNT key held in the
 * keystore rather than from the seed, so that sweeping needs no recovery
 * phrase. That is only safe if the two paths agree exactly: an account key that
 * derived even slightly different addresses would show the user an address, take
 * their money, and then sign for something else. This asserts they match across
 * every network and a spread of indices, checks both against the canonical
 * BIP-84 vectors, and confirms indices actually rotate.
 *
 * It mirrors the derivation in services/spKeys.ts rather than importing it —
 * that module is TypeScript with React Native imports in its dependency graph.
 * Keep the two in step: if the paths in services/derivationPaths.ts change, the
 * vectors here must still pass.
 */
const { mnemonicToSeedSync } = require('@scure/bip39');
const { HDKey } = require('@scure/bip32');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const { bech32 } = require('@scure/base');

const hash160 = (b) => ripemd160(sha256(b));
const hrp = (n) => (n === 'mainnet' ? 'bc' : n === 'regtest' ? 'bcrt' : 'tb');
const coin = (n) => (n === 'mainnet' ? 0 : 1);
const addrFrom = (priv, net) =>
  bech32.encode(hrp(net), [0, ...bech32.toWords(hash160(secp256k1.getPublicKey(priv, true)))]);

const MN = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let failed = 0;
const ok = (name, cond, got) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : `\n         got ${got}`));
  if (!cond) failed++;
};

for (const net of ['mainnet', 'signet', 'regtest']) {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(MN, ''));
  const acct = root.derive(`m/84'/${coin(net)}'/0'`);
  const xprv = acct.privateExtendedKey;
  const reimported = HDKey.fromExtendedKey(xprv);

  for (const i of [0, 1, 5, 19, 49]) {
    const fromSeed = addrFrom(root.derive(`m/84'/${coin(net)}'/0'/0/${i}`).privateKey, net);
    const fromAcct = addrFrom(reimported.derive(`m/0/${i}`).privateKey, net);
    ok(`${net} index ${i}: account key matches seed path`, fromSeed === fromAcct,
       `${fromAcct} != ${fromSeed}`);
  }
}

// BIP-84 canonical vectors, through the account key.
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(MN, ''));
const acct = HDKey.fromExtendedKey(root.derive("m/84'/0'/0'").privateExtendedKey);
ok('BIP-84 0/0', addrFrom(acct.derive('m/0/0').privateKey, 'mainnet') ===
   'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
   addrFrom(acct.derive('m/0/0').privateKey, 'mainnet'));
ok('BIP-84 0/1', addrFrom(acct.derive('m/0/1').privateKey, 'mainnet') ===
   'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
   addrFrom(acct.derive('m/0/1').privateKey, 'mainnet'));

// Indices must give DIFFERENT addresses — the entire point of rotating.
const seen = new Set([0,1,2,3,4,5,6,7,8,9].map((i) => addrFrom(acct.derive(`m/0/${i}`).privateKey, 'mainnet')));
ok('10 indices give 10 distinct addresses', seen.size === 10, `${seen.size}`);

// A passphrase must change the chain (it changes the wallet).
const acctPP = HDKey.fromMasterSeed(mnemonicToSeedSync(MN, 'hunter2hunter2')).derive("m/84'/0'/0'");
ok('a passphrase yields a different chain',
   addrFrom(acctPP.derive('m/0/0').privateKey, 'mainnet') !==
   addrFrom(acct.derive('m/0/0').privateKey, 'mainnet'));

console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
