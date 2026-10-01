import * as Keychain from 'react-native-keychain';

// Which coins THIS device put into a Tango round, kept on the device.
//
// WHY IT HAS TO BE LOCAL. tango.ts's first check before signing is "the coins
// on my side of this transaction are the ones I chose, at the amounts I chose".
// That check is worth nothing if the list it compares against comes back from
// the server with the transaction — comparing the server's answer to the
// server's answer always passes. The selection has to be remembered by whoever
// made it.
//
// WHAT IT DEFENDS AGAINST, precisely. Not theft: every output in a Tango is
// derived on a device from its own scan key, so a substituted coin still pays
// its owner. What a server could otherwise do is choose WHICH of your coins go
// in — swap the one you picked for another of yours, which this device holds a
// tweak for and would therefore sign without noticing. Coin selection is the
// whole of what a mix is; a server quietly making it is a server deciding what
// you are unlinking.
//
// WHEN IT IS ABSENT. A round proposed from the web app, or from a phone since
// reinstalled, has no record here. That is not a failure — the other checks
// (the arithmetic, both sides at the denomination, our outputs being the ones
// we derived) still run, and signing goes ahead. The screen says the selection
// could not be confirmed rather than pretending it was.
//
// KEYED BY ROUND **AND WALLET**. One install signs for one account, so the two
// sides of a round cannot collide here the way they do in a browser — the web
// store is per-origin and a user signing in as each side in turn had the second
// write overwrite the first, which made the approval compare one side's coins
// against the other's and throw the alarm meant for a server swapping them.
// The key carries the wallet on both clients anyway: the same record, read the
// same way, and one fewer thing that is true on one side only.
//
// In the keystore, alongside the transaction labels and for the same reason:
// "these coins were mixed with this person" is the metadata this wallet exists
// to keep private, and it must go when the duress wipe runs.

const COMMIT_SERVICE = 'com.thrilla.tangocommit';

// Round ids and wallet ids are urlsafe hashes, so ':' cannot occur in either.
const keyFor = (roundId: string, walletId: string) => `${roundId}:${walletId}`;
const roundOf = (key: string) => key.split(':')[0];

export interface CommittedCoin {
  txid: string;
  vout: number;
  amount: number;
}

/**
 * What this device committed to a round.
 *
 * `payout` is the OTHER thing that cannot come back from the server: whether
 * this device agreed to have its change routed to the instance over Lightning.
 * tango.ts refuses to sign a round whose routing disagrees with this, and a
 * check against the server's own a_payout/b_payout flag would be no check —
 * a coordinator that turned routing on would take a change coin the user
 * never offered.
 */
export interface TangoCommit {
  coins: CommittedCoin[];
  payout: boolean;
}

/** "roundId:walletId" → what this device committed. A bare array is a record
 *  written before routing existed, and reads as coins with no intent. */
export type TangoCommitMap = Record<string, CommittedCoin[] | TangoCommit>;

function saneCoins(v: unknown): v is CommittedCoin[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        c &&
        typeof c === 'object' &&
        typeof (c as CommittedCoin).txid === 'string' &&
        Number.isInteger((c as CommittedCoin).vout) &&
        Number.isFinite((c as CommittedCoin).amount),
    )
  );
}

function sane(v: unknown): v is CommittedCoin[] | TangoCommit {
  if (saneCoins(v)) return true;
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as TangoCommit).payout === 'boolean' &&
    saneCoins((v as TangoCommit).coins)
  );
}

export async function loadTangoCommits(): Promise<TangoCommitMap> {
  try {
    const c = await Keychain.getGenericPassword({ service: COMMIT_SERVICE });
    if (!c) return {};
    const parsed = JSON.parse(c.password);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // A malformed entry is dropped rather than allowed to fail a real check
    // later, where it would read as "the server changed your coins".
    const out: TangoCommitMap = {};
    for (const [id, coins] of Object.entries(parsed)) {
      if (sane(coins)) out[id] = coins;
    }
    return out;
  } catch {
    return {};
  }
}

async function persist(map: TangoCommitMap): Promise<void> {
  try {
    await Keychain.setGenericPassword('tangocommit', JSON.stringify(map), {
      service: COMMIT_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — this session's in-memory copy still applies */
  }
}

export async function recordTangoCommit(
  map: TangoCommitMap,
  roundId: string,
  walletId: string,
  coins: CommittedCoin[],
  payout: boolean,
): Promise<TangoCommitMap> {
  if (!roundId || !walletId) return map;
  const next: TangoCommitMap = {
    ...map,
    [keyFor(roundId, walletId)]: {
      coins: coins.map((c) => ({
        txid: c.txid, vout: c.vout, amount: c.amount,
      })),
      payout: !!payout,
    },
  };
  await persist(next);
  return next;
}

/**
 * The coins this wallet committed to a round, or null when there is no record.
 *
 * Null for an entry written before the key carried the wallet: which side wrote
 * one is unknowable, and a wrong record here fails a check whose every failure
 * tells the user to cancel.
 */
export function getTangoCommit(
  map: TangoCommitMap,
  roundId: string,
  walletId: string | null,
): CommittedCoin[] | null {
  if (!roundId || !walletId) return null;
  const rec = map[keyFor(roundId, walletId)];
  if (!rec) return null;
  return Array.isArray(rec) ? rec : rec.coins;
}

/**
 * Whether THIS DEVICE agreed to route its change, or null when it has no
 * record either way.
 *
 * NULL IS NOT FALSE, and the difference decides whether a round can be signed.
 * A round proposed from the web app, or from a phone since reinstalled, has no
 * record here; tango.ts then refuses to sign it if the server says it routes,
 * because the only evidence that the user asked for it would be the server's
 * own claim. A round that routes nothing signs as it always did.
 */
export function getTangoPayoutIntent(
  map: TangoCommitMap,
  roundId: string,
  walletId: string | null,
): boolean | null {
  if (!roundId || !walletId) return null;
  const rec = map[keyFor(roundId, walletId)];
  if (!rec || Array.isArray(rec)) return null;
  return !!rec.payout;
}

/**
 * Drop entries for rounds that are over or gone.
 *
 * Called with the ids still worth remembering; anything else is a round that
 * broadcast, was cancelled, or expired, and keeping its coin list is keeping a
 * record of what was mixed for no further purpose.
 */
export async function pruneTangoCommits(
  map: TangoCommitMap,
  keep: Iterable<string>,
): Promise<TangoCommitMap> {
  const live = new Set(keep);
  const next: TangoCommitMap = {};
  for (const [key, coins] of Object.entries(map)) {
    // roundOf also reads a legacy bare key, so those are pruned on the same
    // schedule as everything else rather than lingering unreadable.
    if (live.has(roundOf(key))) next[key] = coins;
  }
  if (Object.keys(next).length === Object.keys(map).length) return map;
  await persist(next);
  return next;
}

// Goes with the keys and the labels when the duress PIN is entered.
export async function wipeTangoCommits(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: COMMIT_SERVICE });
  } catch {
    /* best-effort, same as the key wipe */
  }
}
