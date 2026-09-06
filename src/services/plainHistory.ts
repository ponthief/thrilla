import * as Keychain from 'react-native-keychain';

// Device-only record of payments made OUT of the plain bech32 chain.
//
// The server keeps none. Its broadcast endpoint records a plain-chain payment
// only when it lands in this wallet (helpers/crud.record_plain_incoming), and
// deliberately so: those coins genuinely enter the wallet and the server has to
// be told, or nothing would ever scan for them. An outgoing payment is the
// opposite case — recording it server-side would mean telling it "this plain
// address was mine, and I paid this much to this address", permanently, which
// is most of what the plain chain exists to avoid. The server is told an
// address only at the moment it is asked to look at one.
//
// Without something local, though, an outgoing payment left no trace at all:
// the balance dropped and nothing said where it went. So it is kept here, on
// the device that made it, the same call this project already made for
// transaction labels (services/txLabels.ts).
//
// Consequences worth knowing: this is PER DEVICE. A payment made from the phone
// will not appear in the browser and vice versa — the same asymmetry as labels,
// and the price of not telling the server. And like labels, it is stored in the
// platform keystore: not because a txid is secret, but because "who I paid" is
// exactly the metadata this wallet exists to protect, and the keystore both
// encrypts it at rest and lets the duress wipe erase it with the keys.

const HISTORY_SERVICE = 'com.thrilla.plainhistory';

// Enough to answer "where did that go?" without growing without bound. The
// chain itself is the permanent record; this is a convenience over the top.
const MAX_PER_WALLET = 25;

export interface PlainSendRecord {
  txid: string;
  // What left the addresses, excluding change and fee — the figure shown at
  // review, so the row matches what the user confirmed.
  amount: number;
  fee: number;
  destination: string;
  at: number; // ms since epoch
  // Paid to this wallet's own Silent Payments address. Those also show up in
  // Activity once the confirming block is scanned, so the row says so rather
  // than looking like a duplicate.
  toSelf: boolean;
}

type HistoryMap = Record<string, PlainSendRecord[]>;

function isRecord(v: unknown): v is PlainSendRecord {
  const r = v as PlainSendRecord;
  return (
    !!r &&
    typeof r.txid === 'string' &&
    typeof r.amount === 'number' &&
    typeof r.at === 'number'
  );
}

export async function loadPlainHistory(): Promise<HistoryMap> {
  try {
    const c = await Keychain.getGenericPassword({ service: HISTORY_SERVICE });
    if (!c) return {};
    const parsed = JSON.parse(c.password);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Drop anything malformed rather than letting one bad blob break the card.
    const out: HistoryMap = {};
    for (const [walletId, rows] of Object.entries(parsed as HistoryMap)) {
      if (Array.isArray(rows)) out[walletId] = rows.filter(isRecord);
    }
    return out;
  } catch {
    return {};
  }
}

export async function persistPlainHistory(map: HistoryMap): Promise<void> {
  try {
    await Keychain.setGenericPassword('plainhistory', JSON.stringify(map), {
      service: HISTORY_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the in-memory list still applies this session */
  }
}

// Newest first, capped. Re-broadcasting the same txid replaces the row rather
// than adding a second one.
export function withRecord(
  map: HistoryMap,
  walletId: string,
  record: PlainSendRecord,
): HistoryMap {
  const existing = (map[walletId] || []).filter((r) => r.txid !== record.txid);
  return { ...map, [walletId]: [record, ...existing].slice(0, MAX_PER_WALLET) };
}

// Erased by the duress PIN along with the keys and the labels: a list of who
// you paid is precisely what a coerced unlock must not reveal.
export async function wipePlainHistory(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: HISTORY_SERVICE });
  } catch {
    /* best-effort, same as the key wipe */
  }
}
