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

const LS_KEY = 'thrilla_tango_commit_v1'

function _load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    // A malformed entry is dropped rather than allowed to fail a real check
    // later, where it would read as "the server changed your coins".
    const out = {}
    for (const [id, coins] of Object.entries(raw)) {
      if (
        Array.isArray(coins) &&
        coins.every(
          (c) =>
            c && typeof c.txid === 'string' &&
            Number.isInteger(c.vout) && Number.isFinite(c.amount),
        )
      ) out[id] = coins
    }
    return out
  } catch { return {} }
}

function _save(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

/** Remember the coins this browser committed to a round. */
export function recordTangoCommit(roundId, coins) {
  if (!roundId) return
  const map = _load()
  map[roundId] = (coins || []).map((c) => ({
    txid: c.txid, vout: c.vout, amount: c.amount,
  }))
  _save(map)
}

/** The coins committed to a round, or null when this browser has no record. */
export function getTangoCommit(roundId) {
  if (!roundId) return null
  return _load()[roundId] || null
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
  for (const [id, coins] of Object.entries(map)) {
    if (live.has(id)) next[id] = coins
  }
  if (Object.keys(next).length !== Object.keys(map).length) _save(next)
}
