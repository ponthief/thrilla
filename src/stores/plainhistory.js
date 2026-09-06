// plainhistory.js — CLIENT-ONLY record of payments made OUT of the plain
// bech32 chain. This NEVER goes to the server.
//
// The server keeps none. Its broadcast endpoint records a plain-chain payment
// only when it lands in this wallet, and deliberately so: those coins genuinely
// enter the wallet and the server has to be told, or nothing would ever scan
// for them. An outgoing payment is the opposite case — recording it server-side
// would mean telling it "this plain address was mine, and I paid this much to
// this address", permanently, which is most of what the plain chain exists to
// avoid. The server is told an address only at the moment it is asked to look.
//
// Without something local, though, an outgoing payment left no trace at all:
// the balance dropped and nothing said where it went. So it is kept here, in
// the browser that made it — the same call this project already made for
// transaction labels (stores/txlabels.js).
//
// Scope: per-browser. Clearing browser data loses it, and a payment made from
// the phone will not appear here. That is the price of not telling the server,
// and the same posture as labels: local, and degrading to the chain itself,
// which is the permanent record.

const LS_KEY = 'thrilla_plain_sends_v1'

// Enough to answer "where did that go?" without growing without bound.
const MAX_PER_WALLET = 25

function _load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function _save(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

// Newest first, capped. Re-broadcasting the same txid replaces its row rather
// than adding a second one.
export function recordPlainSend(walletId, record) {
  if (!walletId || !record?.txid) return
  const map = _load()
  const existing = (map[walletId] || []).filter((r) => r.txid !== record.txid)
  map[walletId] = [record, ...existing].slice(0, MAX_PER_WALLET)
  _save(map)
}

export function listPlainSends(walletId) {
  if (!walletId) return []
  const rows = _load()[walletId]
  return Array.isArray(rows) ? rows.filter((r) => r && r.txid) : []
}

export function clearPlainSends() {
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}
