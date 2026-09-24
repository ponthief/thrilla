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
// In the keystore, alongside the transaction labels and for the same reason:
// "these coins were mixed with this person" is the metadata this wallet exists
// to keep private, and it must go when the duress wipe runs.

const COMMIT_SERVICE = 'com.thrilla.tangocommit';

export interface CommittedCoin {
  txid: string;
  vout: number;
  amount: number;
}

/** roundId → the outpoints this device committed to it. */
export type TangoCommitMap = Record<string, CommittedCoin[]>;

function sane(v: unknown): v is CommittedCoin[] {
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
  coins: CommittedCoin[],
): Promise<TangoCommitMap> {
  const next = {
    ...map,
    [roundId]: coins.map((c) => ({ txid: c.txid, vout: c.vout, amount: c.amount })),
  };
  await persist(next);
  return next;
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
  for (const [id, coins] of Object.entries(map)) {
    if (live.has(id)) next[id] = coins;
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
