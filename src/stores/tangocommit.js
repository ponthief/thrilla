// tangocommit.js — which coins THIS browser put into a Tango round.
//
// WHY IT CANNOT COME BACK FROM THE SERVER. services/tango.ts's first check
// before signing is "the coins on my side of this transaction are the ones I
// chose, at the amounts I chose". That check is worth nothing if the list it
// compares against arrives with the transaction: comparing the server's answer
// to the server's answer always passes. The selection has to be remembered by
// whoever made it. (PayJoinSpView still passes the server's set to the
// equivalent argument — the same hole, in the older feature.)
//
// WHAT IT DEFENDS AGAINST, precisely. Not theft: every output in a Tango is
// derived in a client from its own scan key, so a substituted coin still pays
// its owner. What a server could otherwise do is choose WHICH of your coins go
// in — swap the one you picked for another of yours, which this browser holds a
// tweak for and would therefore sign without complaint. Coin selection is the
// whole of what a mix is; a server quietly making it is a server deciding what
// you are unlinking.
//
// Scope: per-browser, in localStorage, the same posture as txlabels.js. Clearing
// site data loses it, and a round started on the phone has no record here. That
// is not a failure — the other checks still run and the page says the selection
// could not be confirmed, rather than implying it was.
//
// KEYED BY ROUND **AND WALLET**, and it has to be. localStorage belongs to the
// browser, not to the account: sign in as alice and propose, sign in as bob and
// accept, and both sides of one round write to the same entry. The second write
// won, so alice's approval then compared alice's coins against bob's and threw
// "the coins in this Tango are not the ones you chose" — the alarm for a server
// swapping your selection, raised by the browser overwriting its own note.
//
// A round has exactly one wallet per side, so the wallet id is the side. Old
// entries keyed by round alone are not read: there is no way to tell which side
// wrote one, and a wrong record here fails a check that means "cancel it".

const LS_KEY = 'thrilla_tango_commit_v1'

// Round ids and wallet ids are urlsafe hashes, so ':' cannot occur in either.
const keyFor = (roundId, walletId) => `${roundId}:${walletId || ''}`
const roundOf = (key) => String(key).split(':')[0]

const _saneCoins = (v) =>
  Array.isArray(v) &&
  v.every(
    (c) =>
      c && typeof c.txid === 'string' &&
      Number.isInteger(c.vout) && Number.isFinite(c.amount),
  )

// Either a bare coin array — a record written before routing existed, which
// reads as coins with no intent — or { coins, payout }.
const _sane = (v) =>
  _saneCoins(v) ||
  (!!v && typeof v === 'object' && !Array.isArray(v) &&
    typeof v.payout === 'boolean' && _saneCoins(v.coins))

function _load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    // A malformed entry is dropped rather than allowed to fail a real check
    // later, where it would read as "the server changed your coins".
    const out = {}
    for (const [id, rec] of Object.entries(raw)) {
      if (_sane(rec)) out[id] = rec
    }
    return out
  } catch { return {} }
}

function _save(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

/**
 * Remember what this browser committed to a round, as this wallet.
 *
 * `payout` is the other thing that cannot come back from the server: whether
 * this browser agreed to have its change routed to the instance over
 * Lightning. services/tango.ts refuses to sign a round whose routing
 * disagrees with this, and checking the server's own a_payout/b_payout flag
 * would be no check at all — a coordinator that turned routing on would take
 * a change coin the user never offered.
 */
export function recordTangoCommit(roundId, walletId, coins, payout) {
  if (!roundId || !walletId) return
  const map = _load()
  map[keyFor(roundId, walletId)] = {
    coins: (coins || []).map((c) => ({
      txid: c.txid, vout: c.vout, amount: c.amount,
    })),
    payout: !!payout,
  }
  _save(map)
}

/**
 * The coins this wallet committed to a round, or null when there is no record.
 *
 * Null for an entry written before the key carried the wallet: which side made
 * it is unknowable, and the wrong answer here is worse than no answer, because
 * every way the check it feeds can fail tells the user to cancel.
 */
export function getTangoCommit(roundId, walletId) {
  if (!roundId || !walletId) return null
  const rec = _load()[keyFor(roundId, walletId)]
  if (!rec) return null
  return Array.isArray(rec) ? rec : rec.coins
}

/**
 * Whether THIS BROWSER agreed to route its change, or null when it has no
 * record either way.
 *
 * NULL IS NOT FALSE, and the difference decides whether a round can be signed.
 * A round started on a phone, or before site data was cleared, has no record
 * here; services/tango.ts then refuses to sign it if the server says it
 * routes, because the only evidence the user asked for it would be the
 * server's own claim. A round that routes nothing signs as it always did.
 */
export function getTangoPayoutIntent(roundId, walletId) {
  if (!roundId || !walletId) return null
  const rec = _load()[keyFor(roundId, walletId)]
  if (!rec || Array.isArray(rec)) return null
  return !!rec.payout
}

/**
 * Drop entries for rounds that are over or gone.
 *
 * Called with the ids still worth remembering; anything else broadcast, was
 * cancelled, or expired, and keeping its coin list is keeping a record of what
 * was mixed for no further purpose.
 */
export function pruneTangoCommits(keep) {
  const live = new Set(keep || [])
  const map = _load()
  const next = {}
  for (const [key, coins] of Object.entries(map)) {
    // roundOf also reads a legacy bare key, so those are pruned on the same
    // schedule as everything else rather than lingering unreadable.
    if (live.has(roundOf(key))) next[key] = coins
  }
  if (Object.keys(next).length !== Object.keys(map).length) _save(next)
}
