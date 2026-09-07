import * as Keychain from 'react-native-keychain';

// Remembers what this device has already announced about the plain address, per
// wallet: the confirmed balance, and the unconfirmed total.
//
// Without it, the notice would fire on every poll for as long as the coins sat
// there — the alert is about a payment ARRIVING, and one that arrived last week
// is not news. Announce only what's new: a figure above what was last
// announced. Spending drops the balance, which resets the mark so the next
// payment is news again.
//
// Two marks, not one, because a payment is worth saying twice: once when it
// shows up unconfirmed, once when it is mined. Tracking them separately is what
// stops the second notice from being suppressed by the first (the amounts are
// equal) and stops each poll in between from repeating either.
//
// Per-device, like the payment-alerts switch it is gated by, and stored the same
// way (react-native-keychain — the app has no AsyncStorage/MMKV dependency).
// Not secret; it lives here because this is where per-device state goes.

const SEEN_SERVICE = 'com.thrilla.plain.announced';

export interface AnnouncedMarks {
  confirmed: number;
  pending: number;
}

// Records written before the pending mark existed hold a bare number, which was
// the confirmed balance. Read those as a zero pending mark rather than throwing
// the record away, so an existing install does not re-announce what it has
// already shown.
type StoredMark = number | Partial<AnnouncedMarks>;
type SeenMap = Record<string, StoredMark>;

const ZERO: AnnouncedMarks = { confirmed: 0, pending: 0 };

function normalize(v: StoredMark | undefined): AnnouncedMarks {
  if (typeof v === 'number') {
    return { confirmed: v >= 0 ? Math.floor(v) : 0, pending: 0 };
  }
  if (v && typeof v === 'object') {
    const c = typeof v.confirmed === 'number' && v.confirmed >= 0 ? v.confirmed : 0;
    const p = typeof v.pending === 'number' && v.pending >= 0 ? v.pending : 0;
    return { confirmed: Math.floor(c), pending: Math.floor(p) };
  }
  return ZERO;
}

async function readAll(): Promise<SeenMap> {
  try {
    const c = await Keychain.getGenericPassword({ service: SEEN_SERVICE });
    if (!c) return {};
    const parsed = JSON.parse(c.password);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SeenMap;
  } catch {
    return {};
  }
}

export async function lastAnnounced(walletId: string): Promise<AnnouncedMarks> {
  const all = await readAll();
  return normalize(all[walletId]);
}

export async function setLastAnnounced(
  walletId: string,
  marks: AnnouncedMarks,
): Promise<void> {
  try {
    const all = await readAll();
    all[walletId] = {
      confirmed: Math.max(0, Math.floor(marks.confirmed)),
      pending: Math.max(0, Math.floor(marks.pending)),
    };
    await Keychain.setGenericPassword('plainseen', JSON.stringify(all), {
      service: SEEN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — worst case the alert repeats next launch */
  }
}
