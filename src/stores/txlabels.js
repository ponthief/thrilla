// txlabels.js — CLIENT-ONLY map of txid → entered recipient label (e.g. a BitMail
// address the user typed). This NEVER goes to the server: a server-side txid→
// identity map would be a deanonymization risk. The label lives only on the
// sender's own device, which is the only place it's meaningful or appropriate.
//
// Scope: per-browser. Clearing browser data loses labels; another device won't
// have them. That's the correct privacy posture for this metadata — ephemeral
// and local, degrading gracefully to showing the on-chain (resolved) address.

const LS_KEY = 'thrilla_tx_labels_v1'

function _load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}
function _save(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

// Save the recipient label the user entered for a broadcast txid.
// Only stores human-readable labels (BitMail addresses); skips raw sp1/bc1
// addresses since those are already on-chain and need no local label.
export function saveTxRecipientLabel(txid, recipient) {
  if (!txid || !recipient) return
  const r = String(recipient).trim()
  // Only worth storing if it's NOT something derivable from chain — i.e. a
  // BitMail (human-readable) address. sp1.../bc1... are on-chain already.
  if (!r.includes('@')) return
  const map = _load()
  map[txid] = r
  _save(map)
}

// Look up a saved label for a txid (or null).
export function getTxRecipientLabel(txid) {
  if (!txid) return null
  return _load()[txid] || null
}

// Mark a txid as a Lightning swap funding (client-only), so Activity can show
// context that this on-chain send funded an SP→Lightning swap rather than a
// plain payment. Stored under a separate map so it doesn't collide with BitMail
// recipient labels.
const SWAP_KEY = 'thrilla_swap_txids_v1'
export function saveSwapTxLabel(txid, amountSats) {
  if (!txid) return
  let map = {}
  try { map = JSON.parse(localStorage.getItem(SWAP_KEY) || '{}') } catch { map = {} }
  map[txid] = { amount: amountSats || null, ts: Date.now() }
  try { localStorage.setItem(SWAP_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}
export function getSwapTxLabel(txid) {
  if (!txid) return null
  try { return (JSON.parse(localStorage.getItem(SWAP_KEY) || '{}'))[txid] || null }
  catch { return null }
}
