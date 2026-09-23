/**
 * payjoinspwatch — polls the Silent Payments PayJoin queues so a browser tab
 * notices when it is your turn.
 *
 * WHY THIS EXISTS AT ALL. The mobile app is told: the backend pushes on every
 * state change (views_api.py::_notify_payjoin_sp) and the app shows a
 * notification. A browser tab is told nothing, so without this a payee only
 * discovers a request by happening to open the page — and an SP PayJoin
 * expires in a day.
 *
 * WHY IT WATCHES BOTH QUEUES, unlike payjoinwatch.js. In the PSBT invoice model
 * one party creates and the other acts, so watching "invoices directed to me"
 * is enough. An SP PayJoin hands the turn back and forth three times:
 *
 *   PROPOSED      the payee accepts, contributing inputs and its payment script
 *   CONTRIBUTED   the payer derives change and signs
 *   PAYER_SIGNED  the payee signs, which broadcasts it
 *
 * So the payer needs telling too — "they accepted, sign now" is as easy to
 * miss as the original request. The rule below mirrors
 * payjoin_sp.py::whose_turn, which is the authority; this only decides what to
 * badge and what to toast, and the endpoints refuse out-of-turn calls anyway.
 *
 * It also holds the queues, and PayJoinSpView reads them from here rather than
 * fetching its own copy. Two pollers against one endpoint is twice the
 * requests to show one number, and they would disagree for a few seconds every
 * time — which on this screen means a Sign button drawn from stale state.
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { pushToast } from '@/stores/toasts'
import * as api from '@/api'

export const payjoinSpPending = ref(0)
export const payjoinSpIncoming = ref([])
export const payjoinSpOutgoing = ref([])
/** Bumped on every completed poll, so a view can react without re-fetching. */
export const payjoinSpVersion = ref(0)

let _timer = null
let _knownTurns = new Set()
let _primed = false   // no toasts on the first poll: those items already existed

// Whose move each state is. Mirrors payjoin_sp.py::whose_turn.
const TURN = {
  PROPOSED: 'payee',
  CONTRIBUTED: 'payer',
  PAYER_SIGNED: 'payee',
}

function needsMe(row, myRole) {
  return TURN[row.status] === myRole
}

async function _poll() {
  const auth = useAuthStore()
  if (!auth.isLoggedIn || !auth.inkey) return
  let data
  try { data = await api.payjoinSpList(auth.inkey) }
  catch { return }   // transient; the next tick tries again

  const incoming = (data && data.incoming) || []
  const outgoing = (data && data.outgoing) || []
  payjoinSpIncoming.value = incoming
  payjoinSpOutgoing.value = outgoing

  const mine = [
    ...incoming.filter(r => needsMe(r, 'payee')).map(r => ({ r, role: 'payee' })),
    ...outgoing.filter(r => needsMe(r, 'payer')).map(r => ({ r, role: 'payer' })),
  ]
  payjoinSpPending.value = mine.length

  // Keyed on id AND status, not id alone: the same PayJoin becomes your turn
  // twice (accept, then sign), and keying on the id would announce only the
  // first of those — the one where nothing is at stake yet.
  const currentTurns = new Set(mine.map(({ r }) => `${r.id}:${r.status}`))
  if (_primed) {
    for (const { r, role } of mine) {
      if (_knownTurns.has(`${r.id}:${r.status}`)) continue
      const who = role === 'payee' ? r.payer_username : r.payee_username
      const what =
        r.status === 'PROPOSED'
          ? `${who || 'Someone'} wants to PayJoin with you — open PayJoin to accept or decline.`
          : r.status === 'CONTRIBUTED'
            ? `${who || 'They'} accepted your PayJoin — open PayJoin to sign it.`
            : `${who || 'They'} signed your PayJoin — open PayJoin to finish it.`
      // No amount in the toast. Not for the FCM reason — nothing here passes
      // through Google — but because a toast is the one message that appears
      // over whatever is on screen, in front of whoever is looking at it.
      pushToast(what, { type: 'info', timeout: 9000 })
    }
  }
  _knownTurns = currentTurns
  _primed = true
  payjoinSpVersion.value++
}

export function startPayjoinSpWatch() {
  if (_timer) return
  _poll()
  // 20s, matching payjoinwatch. The request is one indexed SELECT per party
  // and the states change on human timescales, so faster buys nothing; slower
  // and a PayJoin that needs four turns becomes an afternoon.
  _timer = setInterval(_poll, 20000)
}

export function stopPayjoinSpWatch() {
  if (_timer) { clearInterval(_timer); _timer = null }
  _knownTurns = new Set()
  _primed = false
  payjoinSpPending.value = 0
  payjoinSpIncoming.value = []
  payjoinSpOutgoing.value = []
}

/** An immediate refresh, for the view to call after acting on one. */
export function refreshPayjoinSpWatch() { return _poll() }
