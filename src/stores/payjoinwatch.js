/**
 * payjoinwatch — notifies a user when someone has directed a PayJoin payment
 * request AT THEM (i.e. they are the payer and need to act), so a
 * counterparty-initiated PayJoin doesn't go unnoticed.
 *
 * In the invoice model the PAYEE creates a request naming a PAYER. The payer is
 * the one who must act, so we watch the payer-side "invoices directed to me"
 * list (/payjoin/invoices -> payable), NOT the requests the user created
 * themselves. Exposes payjoinPending (count) for a nav badge and toasts once
 * when a NEW payable invoice appears while the app is open.
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { pushToast } from '@/stores/toasts'
import * as api from '@/api'

export const payjoinPending = ref(0)

let _timer = null
let _knownIds = new Set()
let _primed = false   // skip toasting on the very first poll (existing items)

// statuses of a payable invoice that still need the payer to act
const NEEDS_ACTION = new Set(['OPEN', 'CLAIMED'])

async function _poll() {
  const auth = useAuthStore()
  if (!auth.isLoggedIn || !auth.inkey) return
  let data
  try { data = await api.payjoinListInvoices(auth.inkey) }
  catch { return }
  // payable = open invoices directed to ME, that I (the payer) must pay
  const payable = ((data && data.payable) || []).filter(r => NEEDS_ACTION.has(r.status))
  payjoinPending.value = payable.length

  // Toast for newly-arrived invoices (not on the first poll, so we don't
  // re-announce ones that already existed when the app opened).
  const currentIds = new Set(payable.map(r => r.id))
  if (_primed) {
    for (const r of payable) {
      if (!_knownIds.has(r.id)) {
        // The PAYEE (creator) is r.receiver_username in this model.
        const from = r.receiver_username || 'Someone'
        pushToast(`${from} sent you a PayJoin payment request — open PayJoin to pay or decline.`,
                  { type: 'info', timeout: 9000 })
      }
    }
  }
  _knownIds = currentIds
  _primed = true
}

export function startPayjoinWatch() {
  if (_timer) return
  _poll()                       // prime immediately
  _timer = setInterval(_poll, 20000)
}

export function stopPayjoinWatch() {
  if (_timer) { clearInterval(_timer); _timer = null }
  _knownIds = new Set()
  _primed = false
  payjoinPending.value = 0
}

// let the PayJoin view nudge an immediate refresh (e.g. after acting on one)
export function refreshPayjoinWatch() { _poll() }
