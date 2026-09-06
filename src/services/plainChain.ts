import { plainAddressAt, plainKeyAt } from './spKeys';

// Walks the wallet's plain BIP-84 chain to find the next unused address and
// everything currently sitting on the used ones.
//
// The walk happens HERE, on the device, from the account key. The server only
// ever sees the batch of addresses it is asked about — it is never given the
// xpub, so it cannot derive the next address, and every address it learns is one
// the user actually used. That is the whole point of doing this client-side.

// ── Wire shapes ─────────────────────────────────────────────────────────────
// Owned here rather than in a client, because both the React Native app and the
// Vue web app walk this chain and each has its own HTTP layer. `preview` below
// is injected for the same reason: the walk and the coin selection are the
// fiddly parts and are worth having in exactly one place.

export interface PlainUtxo {
  address: string;
  txid: string;
  vout: number;
  amount: number;
  height: number;
}

export interface PlainAddressState {
  address: string;
  // True if the address has ANY history, spent or not — what decides whether it
  // can still be handed out. A used-and-emptied address has no UTXOs but must
  // never be shown again.
  used: boolean;
  utxos: PlainUtxo[];
  confirmed_sats: number;
  unconfirmed_sats: number;
}

export interface PlainPreview {
  addresses: PlainAddressState[];
  utxos: PlainUtxo[];
  confirmed_sats: number;
  // Coins seen but not yet mined. Never spent: an unconfirmed payment can still
  // be replaced, which would orphan anything built on top of it.
  unconfirmed_sats: number;
}

export interface BuiltPlainTx {
  tx_hex: string;
  amount: number;
  // Zero when sending everything, which empties the addresses outright.
  change: number;
  fee: number;
  total_input: number;
  vsize: number;
  fee_rate_used: number;
  input_count: number;
  swept_addresses: string[]; // the addresses this spends from
  unconfirmed_sats: number;
  destination?: string;
}

// Asks the backend about a batch of addresses. Supplied by the caller's own API
// client.
export type PreviewFn = (addresses: string[]) => Promise<PlainPreview>;

// Placeholder text for a destination field. Network-aware, because telling a
// signet user to paste a bc1… address is telling them to lose their coins.
export function destinationPlaceholder(network: string): string {
  const n = (network || '').toLowerCase();
  if (n === 'mainnet') return 'bc1… or sp1…';
  if (n === 'regtest') return 'bcrt1… or tsp1…';
  return 'tb1… or tsp1…'; // signet shares testnet's prefixes
}

// Is this destination the wallet paying itself?
//
// It matters because the wallet cannot see such a payment on its own. The output
// is a Silent Payments output, found only by SCANNING, and nothing scans just
// because a transaction was broadcast — so the money arrives and the wallet
// shows no record of it until something triggers a scan of that block. Callers
// use this to register the transaction for confirmation-watching, which is what
// starts that scan.
//
// Only the wallet's main address: a labeled address is also owned, but the
// caller does not necessarily have the list, and getting a false NEGATIVE here
// costs a delay (the catch-up scan finds it on the next wallet open) where a
// false positive would announce a payment that never arrives.
export function isOwnSpAddress(destination: string, spAddress: string): boolean {
  const d = (destination || '').trim().toLowerCase();
  return !!d && d === (spAddress || '').trim().toLowerCase();
}

// Standard BIP-84 gap limit: stop after this many consecutive unused addresses.
// Same figure the PayJoin watch-only wallet uses (siLNt/helpers/payjoin_wallet).
const GAP_LIMIT = 20;
// Matches MAX_SWEEP_ADDRESSES in the backend. A wallet that has genuinely used
// 50 plain addresses without ever spending them is not worth paging for.
const MAX_ADDRESSES = 50;

export interface PlainChainState {
  // The address to show: the first with no history at all. Fresh every time the
  // previous one is paid, which is what stops the reuse.
  receiveAddress: string;
  receiveIndex: number;
  // Indices holding confirmed coins, and what's on them.
  fundedIndices: number[];
  // Every index with history, funded or already emptied. What a watcher needs
  // to keep an eye on: a service with a saved withdrawal address will pay an old
  // one again long after it was emptied.
  usedIndices: number[];
  utxos: PlainUtxo[];
  confirmedSats: number;
  unconfirmedSats: number;
  // index → address for everything walked, so callers can group UTXOs back to
  // the derivation index whose key signs for them.
  addressForIndex: Map<number, string>;
}

export async function loadPlainChain(
  preview: PreviewFn,
  accountXprv: string,
  network: string,
): Promise<PlainChainState> {
  const state: Record<number, PlainAddressState> = {};
  let scanned = 0;

  // Ask in batches rather than one address at a time: each batch is a single
  // request and a single Fulcrum connection on the far side.
  while (scanned < MAX_ADDRESSES) {
    const batch: number[] = [];
    for (let i = scanned; i < Math.min(scanned + GAP_LIMIT, MAX_ADDRESSES); i++) {
      batch.push(i);
    }
    if (!batch.length) break;

    const res = await preview(batch.map((i) => plainAddressAt(accountXprv, network, i)));
    // The backend answers in the order it was asked, but pair by address rather
    // than by position so a reordering can never mis-attribute coins to the
    // wrong derivation index — that would sign with the wrong key.
    const byAddress = new Map(res.addresses.map((a) => [a.address, a]));
    for (const i of batch) {
      const entry = byAddress.get(plainAddressAt(accountXprv, network, i));
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
  // means MAX_ADDRESSES consecutive used addresses with none emptied — fall
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
    receiveAddress: plainAddressAt(accountXprv, network, receiveIndex),
    receiveIndex,
    fundedIndices,
    usedIndices: indices.filter((i) => state[i].used),
    addressForIndex: new Map(indices.map((i) => [i, state[i].address])),
    utxos: indices.flatMap((i) => state[i].utxos),
    confirmedSats: indices.reduce((n, i) => n + state[i].confirmed_sats, 0),
    unconfirmedSats: indices.reduce((n, i) => n + state[i].unconfirmed_sats, 0),
  };
}

// The signing keys for exactly the addresses being spent — nothing more leaves
// the device than the transaction actually needs.
export function keysForIndices(
  accountXprv: string,
  network: string,
  indices: number[],
): string[] {
  return indices.map((i) => plainKeyAt(accountXprv, network, i).privateKeyHex);
}

export interface CoinSelection {
  indices: number[];
  availableSats: number;
  // True when the payment cannot be made from one address alone. Spending two
  // addresses together publishes that they belong to the same owner, so this is
  // surfaced rather than done quietly.
  linksAddresses: boolean;
  // Set when even every funded address together falls short.
  shortBy?: number;
}

// Pick which plain addresses to pay from.
//
// One address if one will do — that is the whole point of rotating them. Only
// when no single address covers the amount does this combine, fewest first, and
// it says so through `linksAddresses` so the user can decide rather than
// discover it on-chain later.
export function selectPlainCoins(
  chain: PlainChainState,
  amountSats: number | null,
): CoinSelection {
  const indexForAddress = new Map<string, number>();
  for (const i of chain.fundedIndices) {
    const a = chain.addressForIndex.get(i);
    if (a) indexForAddress.set(a, i);
  }
  const totals = new Map<number, number>();
  for (const i of chain.fundedIndices) totals.set(i, 0);
  for (const u of chain.utxos) {
    const i = indexForAddress.get(u.address);
    if (i != null) totals.set(i, (totals.get(i) ?? 0) + u.amount);
  }

  // Largest first: the fewest addresses that can cover the amount.
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);

  if (amountSats == null) {
    // "Everything" means everything on ONE address — emptying every address in
    // a single transaction would publish that they share an owner.
    const first = ranked[0];
    return {
      indices: first ? [first[0]] : [],
      availableSats: first ? first[1] : 0,
      linksAddresses: false,
    };
  }

  const single = [...ranked].reverse().find(([, v]) => v >= amountSats);
  if (single) {
    return { indices: [single[0]], availableSats: single[1], linksAddresses: false };
  }

  const chosen: number[] = [];
  let running = 0;
  for (const [i, v] of ranked) {
    chosen.push(i);
    running += v;
    if (running >= amountSats) break;
  }
  return {
    indices: chosen,
    availableSats: running,
    linksAddresses: chosen.length > 1,
    shortBy: running < amountSats ? amountSats - running : undefined,
  };
}
