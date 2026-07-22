import { ref } from 'vue'

// Tracks outgoing sends whose on-chain confirmation we're still waiting for, so
// the global poller (App.vue) can watch them and toast on confirmation from ANY
// screen — not just SendView. Persisted to localStorage so a watch survives a
// page reload (the tx is on-chain regardless of the app being open).
//
// Each entry: { txid, walletId, amount, since }

const KEY = 'thrilla_pending_sends_v1'

function _load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function _save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

// Reactive mirror so views could show pending state if desired.
export const pendingSends = ref(_load())

export function addPendingSend(txid, walletId, amount) {
  if (!txid || !walletId) return
  const list = _load()
  if (!list.some((s) => s.txid === txid)) {
    list.push({ txid, walletId, amount: amount || null, since: Date.now() })
    _save(list)
    pendingSends.value = list
  }
}

export function removePendingSend(txid) {
  let list = _load().filter((s) => s.txid !== txid)
  // Also drop anything older than 24h — give up watching stale sends; a scan
  // would reconcile them anyway.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  list = list.filter((s) => s.since >= cutoff)
  _save(list)
  pendingSends.value = list
}

export function getPendingSends() {
  return _load()
}
