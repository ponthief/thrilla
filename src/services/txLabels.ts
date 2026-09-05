import * as Keychain from 'react-native-keychain';

// Device-only labels for transactions, keyed by txid.
//
// These NEVER go to the server. A server-side txid→identity map is a
// deanonymization risk, and this project already made that call once — see
// stores/txlabels.js in the web app, which keeps the same data in localStorage
// for exactly this reason. This is the React Native half of that decision.
//
// It exists because the server-side label cannot cover a pending send: a label
// there attaches to a UTXO the wallet owns, found by funding txid, and a send's
// only owned output is its change — which does not exist until the send
// confirms and a scan records it.
//
// Stored in the platform keystore rather than plain storage. Not because a
// label is a secret in the way a spend key is, but because a map of txid to
// "who I paid" is precisely the metadata the wallet exists to keep private, and
// the keystore encrypts it at rest. It is also what lets the duress wipe erase
// it alongside the keys.

const LABELS_SERVICE = 'com.thrilla.txlabels';

export type TxLabelMap = Record<string, string>;

export async function loadTxLabels(): Promise<TxLabelMap> {
  try {
    const c = await Keychain.getGenericPassword({ service: LABELS_SERVICE });
    if (!c) return {};
    const parsed = JSON.parse(c.password);
    // Guard against a malformed blob rather than letting it break the app.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as TxLabelMap;
  } catch {
    return {};
  }
}

export async function persistTxLabels(map: TxLabelMap): Promise<void> {
  try {
    await Keychain.setGenericPassword('txlabels', JSON.stringify(map), {
      service: LABELS_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the in-memory map still applies this session */
  }
}

// Erased by the duress PIN along with the wallet keys: a label saying who you
// paid is exactly what a coerced unlock must not reveal.
export async function wipeTxLabels(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: LABELS_SERVICE });
  } catch {
    /* best-effort, same as the key wipe */
  }
}
