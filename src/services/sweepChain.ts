import * as api from './api';
import { sweepAddressAt, sweepKeyAt } from './spKeys';

// Walks the wallet's BIP-84 sweep chain to find the next unused address and
// everything currently sitting on the used ones.
//
// The walk happens HERE, on the device, from the account key. The server only
// ever sees the batch of addresses it is asked about — it is never given the
// xpub, so it cannot derive the next address, and every address it learns is one
// the user actually used. That is the whole point of doing this client-side.

// Standard BIP-84 gap limit: stop after this many consecutive unused addresses.
// Same figure the PayJoin watch-only wallet uses (siLNt/helpers/payjoin_wallet).
const GAP_LIMIT = 20;
// Matches MAX_SWEEP_ADDRESSES in the backend. A wallet that has genuinely used
// 30 sweep addresses without ever sweeping is not a case worth paging for.
const MAX_ADDRESSES = 50;

export interface SweepChainState {
  // The address to show: the first with no history at all. Fresh every time the
  // previous one is paid, which is what stops the reuse.
  receiveAddress: string;
  receiveIndex: number;
  // Indices holding confirmed coins, and what's on them.
  fundedIndices: number[];
  utxos: api.SweepUtxo[];
  confirmedSats: number;
  unconfirmedSats: number;
}

export async function loadSweepChain(
  inkey: string,
  walletId: string,
  accountXprv: string,
  network: string,
): Promise<SweepChainState> {
  const state: Record<number, api.SweepAddressState> = {};
  let scanned = 0;

  // Ask in batches rather than one address at a time: each batch is a single
  // request and a single Fulcrum connection on the far side.
  while (scanned < MAX_ADDRESSES) {
    const batch: number[] = [];
    for (let i = scanned; i < Math.min(scanned + GAP_LIMIT, MAX_ADDRESSES); i++) {
      batch.push(i);
    }
    if (!batch.length) break;

    const res = await api.getSweepPreview(
      inkey,
      walletId,
      batch.map((i) => sweepAddressAt(accountXprv, network, i)),
    );
    // The backend answers in the order it was asked, but pair by address rather
    // than by position so a reordering can never mis-attribute coins to the
    // wrong derivation index — that would sign with the wrong key.
    const byAddress = new Map(res.addresses.map((a) => [a.address, a]));
    for (const i of batch) {
      const entry = byAddress.get(sweepAddressAt(accountXprv, network, i));
      if (entry) state[i] = entry;
    }
    scanned += batch.length;

    // Stop once the tail of what we've seen is GAP_LIMIT unused in a row.
    let trailingUnused = 0;
    for (let i = scanned - 1; i >= 0 && !state[i]?.used; i--) trailingUnused++;
    if (trailingUnused >= GAP_LIMIT) break;
  }

  const indices = Object.keys(state)
    .map(Number)
    .sort((a, b) => a - b);

  // First index with no history. If every index we looked at is used — which
  // means MAX_ADDRESSES consecutive used addresses and no sweep in between — fall
  // past the end rather than handing back a used one. That address wasn't
  // checked, but showing an unverified fresh address beats knowingly reusing.
  let receiveIndex = indices.length;
  for (const i of indices) {
    if (!state[i].used) {
      receiveIndex = i;
      break;
    }
  }

  const fundedIndices = indices.filter((i) => state[i].confirmed_sats > 0);
  return {
    receiveAddress: sweepAddressAt(accountXprv, network, receiveIndex),
    receiveIndex,
    fundedIndices,
    utxos: indices.flatMap((i) => state[i].utxos),
    confirmedSats: indices.reduce((n, i) => n + state[i].confirmed_sats, 0),
    unconfirmedSats: indices.reduce((n, i) => n + state[i].unconfirmed_sats, 0),
  };
}

// The signing keys for exactly the addresses that hold coins — nothing more
// leaves the device than the sweep actually needs.
export function keysForIndices(
  accountXprv: string,
  network: string,
  indices: number[],
): string[] {
  return indices.map((i) => sweepKeyAt(accountXprv, network, i).privateKeyHex);
}
