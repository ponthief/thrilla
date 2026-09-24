<script setup>
// Tango, in the browser.
//
// Laid out like PayJoinView — the same tab strip, cards, fields, coin tables
// and inline action panels — because a user meeting two privacy features in
// one app should not have to learn two shapes. The protocol half is shared
// verbatim with the phone through services/tango.ts: the arithmetic, the
// derivation and the checks that run before any signature exists. Nothing
// about the protocol is decided in this file.
//
// WHAT A TANGO IS, in the sentence the page has to be able to say. You and one
// connected person each put in the same amount and each take the same amount
// back. Nobody pays anybody. Because the two mixed outputs are identical —
// same value, same script shape, same freshness — someone reading the chain
// cannot say which is yours.
//
// NOT PayJoinView. That one moves money between two watch-only wallets and
// hands a PSBT to Sparrow to sign. This moves nothing, both sides are WhiSPa
// Silent Payments wallets, and both sign in their own client.
//
// WHERE THE KEYS STAY. Both of this side's outputs are derived here from the
// wallet's scan key, and its inputs are signed here with the spend key. What
// reaches the server is a scriptPubKey and a signature, both of which are on
// chain moments later.

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'
import * as tango from '@/services/tango'
import { parseSpAddress, fromHex, toHex } from '@/services/spSign'
import { tangoRounds as rounds, refreshTangoWatch } from '@/stores/tangowatch'
import {
  recordTangoCommit,
  getTangoCommit,
  pruneTangoCommits,
} from '@/stores/tangocommit'

const auth = useAuthStore()
const tab = ref('mix')   // 'mix' | 'connections' | 'rounds' | 'history'
const error = ref('')
const loading = ref(true)
const refreshing = ref(false)
const busy = ref('')

// ── explorer ────────────────────────────────────────────────────────────────
const mempoolUrl = ref('https://mempool.space')
async function loadMempoolUrl() {
  try {
    const cfg = await api.getBlindbitConfig(auth.adminkey)
    mempoolUrl.value = (cfg?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
  } catch {
    try {
      const cfg2 = await api.getAppConfig(auth.inkey)
      mempoolUrl.value = (cfg2?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
    } catch { mempoolUrl.value = 'https://mempool.space' }
  }
}
const explorerTxUrl = (txid) => `${mempoolUrl.value}/tx/${txid}`

// ── wallet and coins ────────────────────────────────────────────────────────
const wallets = ref([])
const selectedWallet = ref('')
const coins = ref([])

const wallet = computed(() =>
  wallets.value.find((w) => w.id === selectedWallet.value) || null,
)
const hasKeys = computed(
  () => !!(selectedWallet.value && auth.hasWalletKeys(selectedWallet.value)),
)

async function loadWalletAndCoins() {
  wallets.value = await api.getSilntWallets(auth.inkey)
  if (wallets.value.length && !selectedWallet.value) {
    selectedWallet.value = wallets.value[0].id
  }
  if (!selectedWallet.value) {
    error.value = 'No Silent Payments wallet on this network.'
    return
  }
  const res = await api.getUtxos(auth.inkey, selectedWallet.value)
  coins.value = (res.utxos || []).filter(
    (u) => u.utxo_state === 'unspent' && !u.frozen,
  )
}

// ── connections ─────────────────────────────────────────────────────────────
// The connection graph is shared with PayJoin — one accepted-contacts list,
// which Tango's own endpoint checks too (views_api.py::api_tango_propose calls
// list_accepted_contact_user_ids). The routes still sit under /payjoin/
// because that is where they were first added; approving someone here connects
// you for both features, which is the behaviour a user would expect from one
// list of people.
const contactsAccepted = ref([])
const contactsIncoming = ref([])
const contactsOutgoing = ref([])
const contactsDeclined = ref([])
const partners = ref([])         // accepted connections, for the picker
const newContact = ref('')
const addingContact = ref(false)
const refreshingContacts = ref(false)

async function loadContacts() {
  try {
    const res = await api.payjoinListContacts(auth.inkey)
    contactsAccepted.value = res.accepted || []
    contactsIncoming.value = res.incoming || []
    contactsOutgoing.value = res.outgoing || []
    contactsDeclined.value = res.declined || []
  } catch { /* the Refresh button is the retry */ }
}
async function loadPartners() {
  try { partners.value = (await api.payjoinListPayers(auth.inkey)).payers || [] }
  catch { partners.value = [] }
}
async function refreshContacts() {
  refreshingContacts.value = true
  try { await loadContacts(); await loadPartners() } finally { refreshingContacts.value = false }
}
async function sendContactRequest() {
  const username = (newContact.value || '').trim()
  if (!username) { pushToast('Enter a username.', { type: 'warn' }); return }
  addingContact.value = true
  try {
    await api.payjoinContactRequest(auth.inkey, username)
    newContact.value = ''
    pushToast('If that username belongs to a user, they’ll get your request.',
      { type: 'success' })
    await loadContacts()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not send request.', { type: 'error' })
  } finally { addingContact.value = false }
}
async function approveContact(c) {
  try {
    await api.payjoinContactApprove(auth.inkey, c.id)
    pushToast('Connected.', { type: 'success' })
    await loadContacts(); await loadPartners()
  } catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function declineContact(c) {
  try {
    await api.payjoinContactDecline(auth.inkey, c.id)
    pushToast('Declined.', { type: 'success' }); await loadContacts()
  } catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function removeContact(c) {
  if (!confirm(
    'Remove this connection? Either side can, and it stops you starting a ' +
    'Tango with them. Nothing already broadcast is affected.',
  )) return
  try {
    await api.payjoinContactRemove(auth.inkey, c.id)
    pushToast('Connection removed.', { type: 'success' })
    await loadContacts(); await loadPartners()
  } catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function dismissDeclined(c) {
  try { await api.payjoinContactRemove(auth.inkey, c.id); await loadContacts() }
  catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function saveLabel(c) {
  try {
    await api.payjoinContactLabel(auth.inkey, c.id, (c.label || '').trim())
    pushToast('Label saved.', { type: 'success' })
    await loadPartners()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not save label.', { type: 'error' })
  }
}
const partnerDisplay = (p) =>
  (p.label && p.label.trim()) ? `${p.label} (${p.username})` : p.username

// ── fee rate, the tiers from SendView ───────────────────────────────────────
const feeRate = ref('1')
const feeTiers = ref(null)
const feeChoice = ref('halfHourFee')
const feeTierLabels = {
  fastestFee:  { label: 'Fastest', hint: '~10 min' },
  halfHourFee: { label: 'Fast',    hint: '~30 min' },
  hourFee:     { label: 'Normal',  hint: '~1 hour' },
  economyFee:  { label: 'Economy', hint: 'slower' },
}
async function loadFeeRates() {
  try {
    const t = await api.getRecommendedFees(auth.inkey)
    feeTiers.value = t
    if (feeChoice.value !== 'custom' && t[feeChoice.value]) {
      feeRate.value = String(t[feeChoice.value])
    }
  } catch { feeTiers.value = null }
}
function selectFeeTier(key) {
  feeChoice.value = key
  if (key !== 'custom' && feeTiers.value && feeTiers.value[key]) {
    feeRate.value = String(feeTiers.value[key])
  }
}

// ── coin selection ──────────────────────────────────────────────────────────
// Two independent selections: the one you are proposing with, and the one you
// are matching a round with. Sharing a single set meant opening a round and
// silently inheriting a selection made for something else.
const outpoint = (u) => `${u.txid}:${u.vout}`
const mixPicked = ref(new Set())
const matchPicked = ref(new Set())

// One per selection, taking no ref argument, and that is not style.
//
// A template unwraps refs: `toggleIn(mixPicked, c)` in the markup handed the
// function the raw Set, so `setRef.value` was undefined, `new Set(undefined)`
// was empty, and `setRef.value = next` set a dead property on a Set nobody
// watched. The checkbox still ticked — a native checkbox flips its own DOM
// state, and Vue only redraws it when reactive data changes — so every coin
// looked selected while mixChosen stayed empty and Propose stayed disabled.
function flip(set, u) {
  const next = new Set(set)
  const k = outpoint(u)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  return next
}
function toggleMix(u) { mixPicked.value = flip(mixPicked.value, u) }
function toggleMatch(u) { matchPicked.value = flip(matchPicked.value, u) }

const mixChosen = computed(() => coins.value.filter((c) => mixPicked.value.has(outpoint(c))))
const matchChosen = computed(() => coins.value.filter((c) => matchPicked.value.has(outpoint(c))))
const sumOf = (list) => list.reduce((s, c) => s + c.amount, 0)

const localOf = (u) => ({
  txid: u.txid, vout: u.vout, amount: u.amount,
  pub_key: u.pub_key, priv_key_tweak: u.priv_key_tweak,
})
const wireOf = (u) => ({
  txid: u.txid, vout: u.vout, pub_key: u.pub_key, amount: u.amount,
})

function parseInputs(raw) {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

// ── the denomination, and what a selection would do at it ───────────────────
const denom = ref('')

/**
 * The proposal priced against this side's own coins standing in for the other
 * side's, which is exactly what the server does when it takes a proposal — the
 * real fee depends on how many coins the partner brings. Good enough to tell
 * you the thing that matters before you commit: whether your selection leaves
 * change, and therefore whether the mix can be clean.
 */
const mixPreview = computed(() => {
  const d = parseInt(denom.value, 10)
  if (!Number.isFinite(d) || d <= 0 || !mixChosen.value.length) return null
  const rows = mixChosen.value.map(localOf)
  try {
    const p = tango.plan(rows, rows, d, parseFloat(feeRate.value) || 1)
    return { change: p.a_change, fee: p.a_fee, error: '' }
  } catch (e) { return { change: 0, fee: 0, error: e.message || 'That does not work.' } }
})

/**
 * A match, priced exactly. Both sides' coins are known by now, so these are
 * the real numbers — not an estimate — and the round is refused here rather
 * than by the server if the selection cannot cover it.
 */
const matchPreview = computed(() => {
  const r = rounds.value.find((x) => x.id === matchFor.value)
  if (!r || !matchChosen.value.length) return null
  try {
    const p = tango.plan(
      parseInputs(r.a_inputs), matchChosen.value.map(localOf),
      r.denom_sats, r.fee_rate,
    )
    return { change: p.b_change, fee: p.b_fee, clean: p.clean, error: '' }
  } catch (e) {
    return { change: 0, fee: 0, clean: false, error: e.message || 'That does not work.' }
  }
})

// ── load ────────────────────────────────────────────────────────────────────
async function load() {
  error.value = ''
  try {
    await loadWalletAndCoins()
    // Not awaited: a poll that fails is the watcher's problem to retry on its
    // next tick, and it must not leave this page saying it could not load when
    // the coins arrived perfectly well.
    refreshTangoWatch().then(() => {
      // Forget what was committed to rounds that are over: the list is only
      // needed while there is still something left to sign.
      pruneTangoCommits(
        rounds.value.filter((r) => !TERMINAL.includes(r.status)).map((r) => r.id),
      )
    })
  } catch (e) {
    error.value = e.detail || e.message || 'Could not load Tango.'
  } finally {
    loading.value = false
  }
}
async function refreshAll() {
  refreshing.value = true
  try { await load() } finally { refreshing.value = false }
}

onMounted(async () => {
  await load()
  loadMempoolUrl()
  loadContacts()
  loadPartners()
  loadFeeRates()
})
onUnmounted(() => { _stopContactPoll() })

let _contactTimer = null
function _scheduleContactPoll() {
  if (_contactTimer) return
  _contactTimer = setInterval(() => {
    if (tab.value !== 'connections') return   // only poll while viewing the tab
    loadContacts()
  }, 8000)
}
function _stopContactPoll() { if (_contactTimer) { clearInterval(_contactTimer); _contactTimer = null } }

// ── A: propose ──────────────────────────────────────────────────────────────
const partnerName = ref('')

async function propose() {
  if (!selectedWallet.value) { pushToast('Pick a wallet.', { type: 'warn' }); return }
  if (!partnerName.value) {
    pushToast('Select who you are mixing with.', { type: 'warn' }); return
  }
  const d = parseInt(denom.value, 10)
  if (!d || d <= 0) {
    pushToast('Enter the amount you each want back.', { type: 'warn' }); return
  }
  if (!mixChosen.value.length) {
    pushToast('Choose which of your coins go in.', { type: 'warn' }); return
  }
  busy.value = 'propose'
  try {
    const row = await api.tangoPropose(auth.adminkey, {
      wallet_id: selectedWallet.value,
      partner_username: partnerName.value,
      denom_sats: d,
      fee_rate: parseFloat(feeRate.value) || 1,
      inputs: mixChosen.value.map(wireOf),
      network: wallet.value?.network || 'signet',
    })
    // Remembered before anything else can change: this is the only copy of the
    // selection that the server did not write. See stores/tangocommit.js.
    recordTangoCommit(row.id, mixChosen.value)
    denom.value = ''
    mixPicked.value = new Set()
    pushToast('Sent. They match it, then you both sign.', { type: 'success' })
    tab.value = 'rounds'
    await load()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not start that Tango.', { type: 'error' })
  } finally { busy.value = '' }
}

// ── B: match it, which means deriving both of this side's outputs ───────────
const matchFor = ref(null)

function startMatch(r) {
  matchFor.value = r.id
  matchPicked.value = new Set()
}

async function submitMatch(r) {
  if (!matchChosen.value.length) {
    pushToast('Choose which of your coins go in.', { type: 'warn' }); return
  }
  busy.value = r.id
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // The complete input set exists for the first time here, and every output
    // derived from it must not outlive a change to it — which is why both
    // scripts go in this same call and not a later one.
    const chosen = matchChosen.value
    const all = [...parseInputs(r.a_inputs), ...chosen.map(localOf)]
    const amounts = tango.plan(
      parseInputs(r.a_inputs), chosen.map(localOf), r.denom_sats, r.fee_rate,
    )
    const { spend } = parseSpAddress(wallet.value.sp_address)
    const own = tango.deriveOwnOutputs(keys.scanSecret, spend, all, !!amounts.b_change)

    await api.tangoAccept(auth.adminkey, r.id, {
      wallet_id: selectedWallet.value,
      inputs: chosen.map(wireOf),
      mix_spk: toHex(own.mix),
      change_spk: own.change ? toHex(own.change) : null,
    })
    recordTangoCommit(r.id, chosen)
    matchFor.value = null
    matchPicked.value = new Set()
    pushToast(
      amounts.clean
        ? 'Matched, and neither side needs change — a clean mix.'
        : 'Matched. One or both sides have change, which weakens it.',
      { type: 'success' },
    )
    await load()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not match that Tango.', { type: 'error' })
  } finally { busy.value = '' }
}

// ── both: sign, after the checks ────────────────────────────────────────────
const showSignConfirm = ref(false)
const signConfirmRound = ref(null)

function askSign(r) {
  signConfirmRound.value = r
  showSignConfirm.value = true
}

async function sign(r) {
  busy.value = r.id
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // Re-fetched, never signed from the list: the list is however old the page
    // is, and what is about to be signed is a transaction.
    const fresh = await api.tangoGet(auth.inkey, r.id)
    const side = fresh.role
    const aRows = parseInputs(fresh.a_inputs)
    const bRows = parseInputs(fresh.b_inputs)
    const all = [...aRows, ...bRows]
    // The server's copy carries no tweak, by design, so the coins this page is
    // about to sign are rebuilt from the wallet's own records.
    const mine = tango.withLocalTweaks(side === 'a' ? aRows : bRows, coins.value)

    const amounts = {
      denom: fresh.denom_sats,
      a_in: fresh.a_in_sats, b_in: fresh.b_in_sats,
      a_change: fresh.a_change_sats || 0, b_change: fresh.b_change_sats || 0,
      a_fee: fresh.a_fee_sats, b_fee: fresh.b_fee_sats,
      fee: fresh.fee_sats, vsize: fresh.vsize,
      clean: !!fresh.clean,
    }

    const { spend } = parseSpAddress(wallet.value.sp_address)
    const myChange = side === 'a' ? amounts.a_change : amounts.b_change
    const own = tango.deriveOwnOutputs(keys.scanSecret, spend, all, !!myChange)

    // A derives at sign time; B derived when it matched, and its scripts are
    // already on the row.
    const aMix = side === 'a' ? own.mix : fromHex(fresh.a_mix_spk || '')
    const bMix = side === 'b' ? own.mix : fromHex(fresh.b_mix_spk || '')
    const aChange = side === 'a'
      ? own.change
      : (fresh.a_change_spk ? fromHex(fresh.a_change_spk) : null)
    const bChange = side === 'b'
      ? own.change
      : (fresh.b_change_spk ? fromHex(fresh.b_change_spk) : null)

    // The coins this browser chose, from this browser. Comparing the server's
    // set to the server's set would pass whatever it contained. Absent — a
    // round started on the phone, or with site data since cleared — that one
    // check cannot be made, and the toast says so rather than implying it
    // passed. See stores/tangocommit.js.
    const chose = getTangoCommit(fresh.id)

    // Nothing is signed until this returns. Every way it throws means cancel,
    // not retry, and the message it throws is the message shown.
    const assembled = tango.checkBeforeSigning({
      side, inputs: all, mine, amounts,
      aMix, bMix, aChange, bChange,
      expectMix: own.mix, expectChange: own.change,
      committed: chose || mine,
      denom: fresh.denom_sats, feeRate: fresh.fee_rate,
    })

    const witnesses = tango.signOwnInputs(assembled, all, mine, keys.spendKey)
    const done = await api.tangoSign(auth.adminkey, r.id, {
      witnesses,
      mix_spk: side === 'a' ? toHex(own.mix) : null,
      change_spk: side === 'a' && own.change ? toHex(own.change) : null,
      unsigned_tx: assembled.unsignedHex,
    })
    const unverified = chose
      ? ''
      : ' This browser has no record of which coins you chose for it, so that' +
        ' part could not be checked.'
    pushToast(
      (done.status === 'BROADCAST'
        ? `Sent. Both shares are the same size, so nothing on chain says which is yours. txid ${String(done.txid || '').slice(0, 12)}…`
        : 'Approved. Waiting on the other side.') + unverified,
      { type: 'success', timeout: 12000 },
    )
    showSignConfirm.value = false
    signConfirmRound.value = null
    await load()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not sign that Tango.', { type: 'error' })
  } finally { busy.value = '' }
}

async function cancel(r) {
  if (!confirm(
    'Cancel this Tango? The other side is told. Nothing has been broadcast, ' +
    'so no coins move.',
  )) return
  busy.value = r.id
  try {
    await api.tangoCancel(auth.adminkey, r.id)
    if (matchFor.value === r.id) matchFor.value = null
    pushToast('Tango cancelled.', { type: 'success' })
    await load()
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not cancel that Tango.', { type: 'error' })
  } finally { busy.value = '' }
}

// ── grouping ────────────────────────────────────────────────────────────────
const TERMINAL = ['BROADCAST', 'CANCELLED']

// Whose move it is. Mirrors helpers/tango.py::whose_turn, which is the
// authority; this only decides which button to draw, and the endpoint refuses
// out of turn anyway.
const TURN = { PROPOSED: 'b', ACCEPTED: 'a', A_SIGNED: 'b' }
const myTurn = (r) => !!r.role && TURN[r.status] === r.role

const waitingOnMe = computed(() => rounds.value.filter(myTurn))
const waitingOnThem = computed(() =>
  rounds.value.filter((r) => !TERMINAL.includes(r.status) && !myTurn(r)),
)
const history = computed(() =>
  rounds.value
    .filter((r) => TERMINAL.includes(r.status))
    .slice()
    .sort((a, b) => String(b.updated_at || b.created_at || '')
      .localeCompare(String(a.updated_at || a.created_at || ''))),
)

// ── display ─────────────────────────────────────────────────────────────────
const fmtSats = (n) => (n == null ? '—' : Number(n).toLocaleString() + ' sats')
const shortTxid = (t) => (t ? `${t.slice(0, 10)}…${t.slice(-6)}` : '')
const partnerOf = (r) => (r.role === 'a' ? r.b_username : r.a_username)
const myFee = (r) => (r.role === 'a' ? r.a_fee_sats : r.b_fee_sats)
const myChangeOf = (r) => (r.role === 'a' ? r.a_change_sats : r.b_change_sats)

// Who did the last thing, named.
//
// The stored statuses carry the role names the protocol needs — A proposes, B
// matches, A_SIGNED means A has signed — and those names mean nothing to the
// person reading them. Shown raw they came out as "a_signed", which reads as a
// bug even when nothing is wrong. Nobody is "A": they are you, or they are
// whoever you are mixing with, by name.
function actor(r, side) {
  if (r.role === side) return 'You'
  return (side === 'a' ? r.a_username : r.b_username) || 'They'
}
function statusLabel(r) {
  switch (r.status) {
    case 'PROPOSED':  return `${actor(r, 'a')} proposed it`
    case 'ACCEPTED':  return `${actor(r, 'b')} matched it`
    case 'A_SIGNED':  return `${actor(r, 'a')} approved it`
    case 'BROADCAST': return 'Sent'
    // The sweeper closes a round nobody finished, and that is a different
    // outcome from someone deciding to stop: nothing was refused, the time
    // simply ran out and the coins went back.
    case 'CANCELLED':
      return r.reject_reason === 'expired' ? 'Expired' : 'Cancelled'
    default:          return r.status
  }
}

// "Sign" is what the code does; it is not what the person is doing, and the
// two turns are not the same act. The first approves the mix and waits. The
// second finishes it, puts it on the network, and cannot be undone — which a
// button reading "Sign" for both gives no way to tell.
const signLabel = (r) => (r.status === 'A_SIGNED' ? 'Finish & send' : 'Approve mix')

// What the person looking at this row is being asked for, in their own terms.
function whatNow(r) {
  if (TERMINAL.includes(r.status)) return ''
  if (!myTurn(r)) {
    const who = partnerOf(r) || 'them'
    return r.status === 'PROPOSED'
      ? `Waiting for ${who} to match it.`
      : `Waiting for ${who} to approve it.`
  }
  if (r.status === 'PROPOSED') return 'Choose your coins and match it.'
  return r.status === 'A_SIGNED'
    ? 'Yours finishes it and sends it.'
    : 'It needs your approval.'
}

function expiresIn(r) {
  if (!r.expires_at || TERMINAL.includes(r.status)) return ''
  const secs = r.expires_at - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'expired'
  const h = Math.floor(secs / 3600)
  return h >= 1 ? `expires in ${h}h` : `expires in ${Math.max(1, Math.floor(secs / 60))}m`
}
</script>

<template>
  <div class="tango-view">
    <div class="tg-tabs">
      <button class="btn btn-sm" :class="tab === 'mix' ? 'btn-primary' : 'btn-ghost'"
              @click="tab = 'mix'; loadPartners(); loadFeeRates()">Mix</button>
      <button class="btn btn-sm" :class="tab === 'connections' ? 'btn-primary' : 'btn-ghost'"
              @click="tab = 'connections'; loadContacts(); _scheduleContactPoll()">Connections</button>
      <button class="btn btn-sm" :class="tab === 'rounds' ? 'btn-primary' : 'btn-ghost'"
              @click="tab = 'rounds'; load()">
        Rounds<span v-if="waitingOnMe.length" class="tg-badge">{{ waitingOnMe.length }}</span>
      </button>
      <button class="btn btn-sm" :class="tab === 'history' ? 'btn-primary' : 'btn-ghost'"
              @click="tab = 'history'; load()">History</button>
    </div>

    <div v-if="error" class="alert alert-warn">{{ error }}</div>

    <!-- MIX -->
    <template v-if="tab === 'mix'">
      <div class="card">
        <div class="card-header">Tango — a two-party mix</div>
        <div class="card-body">
          <div class="alert alert-info tg-note">
            ℹ <strong>Nobody pays anybody.</strong> You and one connected person
            each put in the same amount and each take the same amount back.
            Because the two outputs are identical, someone reading the chain
            cannot tell which one is yours.
          </div>
          <p class="text-dim text-sm">
            <b>Both sides are WhiSPa wallets</b> and both sign in their own
            client — nothing leaves this browser but a scriptPubKey and a
            signature.
          </p>
          <div class="alert alert-warn tg-note">
            ⚠ <strong>Two is two.</strong> An anonymity set of two is a coin
            flip, not anonymity — though it compounds if you mix again with
            someone else. And it hides nothing from the server running this,
            which sees both sides. Tango is protection against someone reading
            the chain.
          </div>

          <div class="field">
            <label class="text-dim text-xs">Mix from wallet</label>
            <select class="input" v-model="selectedWallet" @change="load">
              <option v-for="w in wallets" :key="w.id" :value="w.id">
                {{ w.title }} ({{ w.network }})
              </option>
            </select>
          </div>
          <div v-if="selectedWallet && !hasKeys" class="alert alert-warn tg-note">
            ⚠ This browser does not hold this wallet’s keys, so it cannot derive
            an output or sign an input. Unlock the wallet on the Send page first.
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Start a round</div>
        <div class="card-body">
          <div class="field">
            <label class="text-dim text-xs">Mix with</label>
            <select class="input" v-model="partnerName">
              <option value="">Select from your connections…</option>
              <option v-for="p in partners" :key="p.user_id" :value="p.username">
                {{ partnerDisplay(p) }}
              </option>
            </select>
            <p v-if="!partners.length" class="text-dim text-xs" style="margin-top:0.25rem;">
              No connections yet. Add one in the <b>Connections</b> tab — they
              approve, then they appear here.
            </p>
          </div>

          <div class="field">
            <label class="text-dim text-xs">Amount each (sats)</label>
            <input class="input mono tg-amt" v-model="denom" inputmode="numeric" placeholder="25000" />
            <p class="text-dim text-xs" style="margin-top:0.25rem;">
              Both of you get exactly this back. Unequal amounts are two outputs
              an observer can tell apart, which is no mix at all.
            </p>
          </div>

          <div class="field">
            <label class="text-dim text-xs">Fee rate</label>
            <div v-if="feeTiers" class="fee-tiers">
              <button v-for="(meta, key) in feeTierLabels" :key="key" type="button"
                      class="fee-tier" :class="{ active: feeChoice === key }"
                      @click="selectFeeTier(key)" :disabled="!feeTiers[key]">
                <span class="ft-label">{{ meta.label }}</span>
                <span class="ft-rate">{{ feeTiers[key] }} sat/vB</span>
                <span class="ft-hint">{{ meta.hint }}</span>
              </button>
              <button type="button" class="fee-tier" :class="{ active: feeChoice === 'custom' }"
                      @click="selectFeeTier('custom')">
                <span class="ft-label">Custom</span>
                <span class="ft-rate">{{ feeChoice === 'custom' ? feeRate + ' sat/vB' : '—' }}</span>
                <span class="ft-hint">set manually</span>
              </button>
            </div>
            <input v-if="!feeTiers || feeChoice === 'custom'" class="input mono tg-num"
                   v-model="feeRate" inputmode="decimal" placeholder="1" style="margin-top:6px;" />
            <p class="text-dim text-xs" style="margin-top:0.25rem;">
              Split down the middle, with the odd satoshi yours — you chose the
              amount and the rate.
            </p>
          </div>

          <div class="field">
            <label class="text-dim text-xs">Choose the coins that go in</label>
            <p class="text-dim text-xs">
              Which ones you choose is the decision a mix is made of, so nothing
              here chooses for you.
            </p>
            <div v-if="!coins.length" class="text-dim text-xs">No spendable coins.</div>
            <table v-else class="tg-utxos">
              <tbody>
                <tr v-for="c in coins" :key="outpoint(c)" @click="toggleMix(c)"
                    style="cursor:pointer;">
                  <td><input type="checkbox" :checked="mixPicked.has(outpoint(c))"
                             @click.stop="toggleMix(c)" /></td>
                  <td class="mono text-xs">{{ shortTxid(c.txid) }}:{{ c.vout }}</td>
                  <td class="text-xs text-dim">{{ c.label || '' }}</td>
                  <td class="mono text-xs r">{{ fmtSats(c.amount) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="mixChosen.length" class="text-xs text-dim" style="margin-top:0.5rem;">
              Selected: <span class="mono">{{ fmtSats(sumOf(mixChosen)) }}</span>
              <template v-if="mixPreview && !mixPreview.error">
                · your fee about <span class="mono">{{ fmtSats(mixPreview.fee) }}</span>
              </template>
            </div>
            <div v-if="mixPreview && mixPreview.error" class="alert alert-warn tg-note">
              {{ mixPreview.error }}
            </div>
            <p v-else-if="mixPreview && mixPreview.change" class="text-xs text-amber" style="margin-top:0.4rem;">
              This selection leaves {{ fmtSats(mixPreview.change) }} of change.
              The mix still works, but change plus your share adds up to what you
              put in — which is often enough for someone to tell the two apart. A
              selection close to the amount plus your fee share is stronger.
            </p>
            <p v-else-if="mixPreview" class="text-xs text-green" style="margin-top:0.4rem;">
              No change from this selection. That is the strongest shape: coins
              in, two identical coins out, nothing to add up.
            </p>
          </div>

          <button class="btn btn-primary" style="margin-top:0.75rem;"
                  :disabled="busy === 'propose' || !hasKeys || !partnerName || !denom ||
                             !mixChosen.length || !!mixPreview?.error"
                  @click="propose">
            {{ busy === 'propose' ? 'Proposing…' : 'Propose round' }}
          </button>
        </div>
      </div>
    </template>

    <!-- CONNECTIONS -->
    <template v-else-if="tab === 'connections'">
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshingContacts" @click="refreshContacts">
          {{ refreshingContacts ? 'Refreshing…' : '↻ Refresh' }}
        </button>
      </div>
      <div class="card">
        <div class="card-header">Add a connection</div>
        <div class="card-body">
          <p class="text-dim text-sm">
            Connect with another user by their <b>WhiSPa username</b>. They
            approve the request, then either of you can propose a Tango. It stays
            connected until one side removes it.
          </p>
          <p class="text-dim text-xs">
            This is one list of people, shared with PayJoin — approving someone
            here connects you for both.
          </p>
          <label class="text-dim text-xs" style="display:block; margin-bottom:4px;">Username</label>
          <div class="tg-add-row">
            <input class="input" v-model="newContact" type="text" placeholder="username"
                   autocapitalize="off" autocomplete="off" @keyup.enter="sendContactRequest" />
            <button class="btn btn-primary" :disabled="addingContact" @click="sendContactRequest">
              {{ addingContact ? 'Sending…' : 'Send request' }}
            </button>
          </div>
        </div>
      </div>

      <div class="card" v-if="contactsIncoming.length">
        <div class="card-header">Requests to you</div>
        <div class="card-body">
          <div v-for="c in contactsIncoming" :key="c.id" class="tg-req">
            <div class="tg-req-row">
              <div class="text-sm"><b>{{ c.counterparty_username }}</b> wants to connect</div>
              <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-sm btn-primary" @click="approveContact(c)">Approve</button>
                <button class="btn btn-ghost btn-sm" @click="declineContact(c)">Decline</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Your connections</div>
        <div class="card-body">
          <div v-if="!contactsAccepted.length" class="text-dim text-sm">No connections yet.</div>
          <div v-for="c in contactsAccepted" :key="c.id" class="tg-req">
            <div class="tg-req-row" style="align-items:center;">
              <div class="text-sm" style="flex:1;"><b>{{ c.counterparty_username }}</b></div>
              <button class="btn btn-ghost btn-sm" @click="removeContact(c)">Remove</button>
            </div>
            <div class="tg-label-row">
              <input class="input tg-label-input" v-model="c.label"
                     placeholder="private label (only you see this)" @keyup.enter="saveLabel(c)" />
              <button class="btn btn-ghost btn-sm" @click="saveLabel(c)">Save</button>
            </div>
          </div>
          <div v-if="contactsOutgoing.length" style="margin-top:0.75rem;">
            <div class="text-dim text-xs" style="margin-bottom:0.25rem;">Pending (awaiting their approval)</div>
            <div v-for="c in contactsOutgoing" :key="c.id" class="tg-req">
              <div class="tg-req-row">
                <div class="text-sm text-dim"><b>{{ c.counterparty_username }}</b> · pending</div>
                <button class="btn btn-ghost btn-sm" @click="removeContact(c)">Cancel</button>
              </div>
            </div>
          </div>
          <div v-if="contactsDeclined.length" style="margin-top:0.75rem;">
            <div class="text-dim text-xs" style="margin-bottom:0.25rem;">Declined</div>
            <div v-for="c in contactsDeclined" :key="c.id" class="tg-req">
              <div class="tg-req-row">
                <div class="text-sm">
                  <b>{{ c.counterparty_username }}</b>
                  <span class="text-orange"> · declined your request</span>
                </div>
                <button class="btn btn-ghost btn-sm" @click="dismissDeclined(c)">Dismiss</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ROUNDS -->
    <template v-else-if="tab === 'rounds'">
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshing" @click="refreshAll">
          {{ refreshing ? 'Refreshing…' : '↻ Refresh' }}
        </button>
      </div>

      <div class="card">
        <div class="card-header">Waiting on you</div>
        <div class="card-body">
          <div v-if="loading" class="text-dim text-sm">Loading…</div>
          <div v-else-if="!waitingOnMe.length" class="text-dim text-sm">
            Nothing waiting on you. A round someone proposes appears here.
          </div>
          <div v-for="r in waitingOnMe" :key="r.id" class="tg-req">
            <div class="tg-req-row">
              <div>
                <div class="text-sm">
                  with <b>{{ partnerOf(r) }}</b> ·
                  <span class="mono">{{ fmtSats(r.denom_sats) }} each</span>
                </div>
                <div class="text-xs text-dim">
                  {{ statusLabel(r) }} · {{ whatNow(r) }}
                  <span v-if="expiresIn(r)"> · {{ expiresIn(r) }}</span>
                </div>
                <div v-if="r.fee_sats != null" class="text-xs text-dim">
                  your fee <span class="mono">{{ fmtSats(myFee(r)) }}</span> ·
                  {{ r.vsize }} vB
                  <template v-if="myChangeOf(r)">
                    · your change <span class="mono">{{ fmtSats(myChangeOf(r)) }}</span>
                  </template>
                </div>
                <div v-if="r.clean === false" class="text-xs text-amber">
                  Change on one or both sides — an observer can often work out
                  which output is whose from the amounts.
                </div>
                <div v-else-if="r.clean === true" class="text-xs text-green">
                  No change either side — nothing to work out from the amounts.
                </div>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button v-if="r.status === 'PROPOSED' && matchFor !== r.id"
                        class="btn btn-sm btn-primary" :disabled="!hasKeys"
                        @click="startMatch(r)">Match</button>
                <button v-else-if="r.status !== 'PROPOSED'"
                        class="btn btn-sm btn-primary"
                        :disabled="busy === r.id || !hasKeys" @click="askSign(r)">
                  {{ busy === r.id ? 'Working…' : signLabel(r) }}
                </button>
                <button class="btn btn-ghost btn-sm" :disabled="busy === r.id"
                        @click="cancel(r)">Cancel</button>
              </div>
            </div>

            <!-- match panel: their coins are already in, so this prices exactly -->
            <div v-if="matchFor === r.id" class="tg-finalize">
              <p class="text-xs text-dim" style="margin-top:0;">
                They put in {{ parseInputs(r.a_inputs).length }} coin(s). Choose
                yours: you need the amount plus your half of the fee, and
                anything over it comes back as change.
              </p>
              <div v-if="!coins.length" class="text-dim text-xs">No spendable coins.</div>
              <table v-else class="tg-utxos">
                <tbody>
                  <tr v-for="c in coins" :key="outpoint(c)" @click="toggleMatch(c)"
                      style="cursor:pointer;">
                    <td><input type="checkbox" :checked="matchPicked.has(outpoint(c))"
                               @click.stop="toggleMatch(c)" /></td>
                    <td class="mono text-xs">{{ shortTxid(c.txid) }}:{{ c.vout }}</td>
                    <td class="text-xs text-dim">{{ c.label || '' }}</td>
                    <td class="mono text-xs r">{{ fmtSats(c.amount) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="matchChosen.length" class="text-xs text-dim" style="margin-top:0.5rem;">
                Selected: <span class="mono">{{ fmtSats(sumOf(matchChosen)) }}</span>
                <template v-if="matchPreview && !matchPreview.error">
                  · your fee <span class="mono">{{ fmtSats(matchPreview.fee) }}</span>
                </template>
              </div>
              <div v-if="matchPreview && matchPreview.error" class="alert alert-warn tg-note">
                {{ matchPreview.error }}
              </div>
              <p v-else-if="matchPreview && !matchPreview.clean" class="text-xs text-amber" style="margin-top:0.4rem;">
                <template v-if="matchPreview.change">
                  Your change would be {{ fmtSats(matchPreview.change) }}.
                </template>
                <template v-else>
                  Their side needs change.
                </template>
                Change plus a share adds up to what that side put in, which is
                often enough for someone to tell the two outputs apart.
              </p>
              <p v-else-if="matchPreview" class="text-xs text-green" style="margin-top:0.4rem;">
                Neither side needs change — a clean mix.
              </p>
              <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                <button class="btn btn-primary btn-sm"
                        :disabled="busy === r.id || !matchChosen.length || !!matchPreview?.error"
                        @click="submitMatch(r)">
                  {{ busy === r.id ? 'Matching…' : 'Match & derive' }}
                </button>
                <button class="btn btn-ghost btn-sm" @click="matchFor = null">Close</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Waiting on them</div>
        <div class="card-body">
          <div v-if="!waitingOnThem.length" class="text-dim text-sm">
            Nothing waiting on the other side.
          </div>
          <div v-for="r in waitingOnThem" :key="r.id" class="tg-req">
            <div class="tg-req-row">
              <div>
                <div class="text-sm">
                  with <b>{{ partnerOf(r) }}</b> ·
                  <span class="mono">{{ fmtSats(r.denom_sats) }} each</span>
                </div>
                <div class="text-xs text-dim">
                  {{ statusLabel(r) }} · {{ whatNow(r) }}
                  <span v-if="expiresIn(r)"> · {{ expiresIn(r) }}</span>
                </div>
                <div v-if="r.fee_sats != null" class="text-xs text-dim">
                  your fee <span class="mono">{{ fmtSats(myFee(r)) }}</span> ·
                  {{ r.vsize }} vB
                  <template v-if="myChangeOf(r)">
                    · your change <span class="mono">{{ fmtSats(myChangeOf(r)) }}</span>
                  </template>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" :disabled="busy === r.id"
                      @click="cancel(r)">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- HISTORY -->
    <template v-else>
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshing" @click="refreshAll">
          {{ refreshing ? 'Refreshing…' : '↻ Refresh' }}
        </button>
      </div>
      <div class="card">
        <div class="card-header">Tango history</div>
        <div class="card-body">
          <div v-if="loading" class="text-dim text-sm">Loading…</div>
          <div v-else-if="!history.length" class="text-dim text-sm">No finished rounds yet.</div>
          <div v-for="r in history" :key="r.id" class="tg-req"
               :class="r.status === 'CANCELLED' ? 'tg-cancelled' : ''">
            <div class="tg-req-row">
              <div>
                <div class="text-sm">
                  with <b>{{ partnerOf(r) }}</b> ·
                  <span class="mono">{{ fmtSats(r.denom_sats) }} each</span>
                </div>
                <div class="text-xs text-dim">
                  <span :class="r.status === 'BROADCAST' ? 'text-green' : ''">
                    {{ statusLabel(r) }}
                  </span>
                  <span v-if="r.txid"> ·
                    <a class="mono tg-txid" :href="explorerTxUrl(r.txid)"
                       target="_blank" rel="noopener">{{ shortTxid(r.txid) }}</a>
                  </span>
                  <span v-if="r.reject_reason && r.reject_reason !== 'expired'">
                    · {{ r.reject_reason }}
                  </span>
                </div>
                <div v-if="r.status === 'BROADCAST'" class="text-xs"
                     :class="r.clean ? 'text-green' : 'text-amber'">
                  {{ r.clean
                      ? 'Clean — no change either side, so the two shares are the only outputs.'
                      : 'Change on one or both sides, which an observer can often use to tell the shares apart.' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- confirm before signing: the second signature broadcasts -->
    <div v-if="showSignConfirm && signConfirmRound" class="modal-overlay"
         @click.self="showSignConfirm = false">
      <div class="card modal" style="max-width:420px">
        <div class="card-header"><h2>Confirm this mix</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <p class="text-sm text-dim" style="margin:0">
            Your device checks the whole transaction before it signs anything —
            both shares equal, the fee split as computed here, and your two
            outputs the ones this browser derived.
            <template v-if="signConfirmRound.status === 'A_SIGNED'">
              <b>The other side has already approved it, so this sends it to the
              network immediately</b> and cannot be undone.
            </template>
            <template v-else>
              This approves your half. Nothing reaches the network until the
              other side does the same.
            </template>
          </p>
          <div class="tx-detail-row">
            <span>With</span><span class="mono">{{ partnerOf(signConfirmRound) }}</span>
          </div>
          <div class="tx-detail-row">
            <span>Each side gets</span>
            <span class="text-orange mono">{{ fmtSats(signConfirmRound.denom_sats) }}</span>
          </div>
          <div class="tx-detail-row">
            <span>Your fee share</span><span class="mono">{{ fmtSats(myFee(signConfirmRound)) }}</span>
          </div>
          <div class="tx-detail-row" v-if="myChangeOf(signConfirmRound)">
            <span>Your change</span><span class="mono">{{ fmtSats(myChangeOf(signConfirmRound)) }}</span>
          </div>
          <div class="flex gap-2 justify-between" style="margin-top:8px">
            <button class="btn btn-ghost" @click="showSignConfirm = false">Cancel</button>
            <button class="btn btn-success" :disabled="busy === signConfirmRound.id"
                    @click="sign(signConfirmRound)">
              {{ busy === signConfirmRound.id ? 'Working…' : signLabel(signConfirmRound) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-amber { color: #f59e0b; }
.tango-view { max-width: 640px; width: 100%; margin: 0 auto; align-self: flex-start; }
/* spacing between top-level cards (replaces flex gap, which capped the view's
   height inside the flex page-wrap and clipped content on mobile) */
.tango-view > * { margin-bottom: 1rem; }
.tango-view > *:last-child { margin-bottom: 0; }
.tango-view .card-body { padding: 16px; }
.tango-view .field { gap: 4px; }
.tg-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.tg-badge {
  display: inline-block; margin-left: 0.35rem; padding: 0.05rem 0.35rem;
  border-radius: 999px; font-size: 0.65rem; background: rgba(255,180,0,0.18);
  color: #ffb400;
}
.tg-utxos {
  width: 100%; border-collapse: collapse; margin-top: 0.5rem;
  display: block; overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.tg-utxos thead, .tg-utxos tbody { display: table; width: 100%; }
.tg-utxos th, .tg-utxos td {
  text-align: left; padding: 0.25rem 0.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap;
}
.tg-utxos .r { text-align: right; }
@media (max-width: 560px) {
  .tg-utxos th, .tg-utxos td { padding: 0.25rem 0.35rem; font-size: 10.5px; }
}
.tg-req { padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.tg-req:last-child { border-bottom: 0; }
.tg-req-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
.tg-finalize {
  margin-top: 0.5rem; padding: 0.5rem;
  background: rgba(255,255,255,0.03); border-radius: 6px;
}
.tg-cancelled { opacity: 0.55; }
.tg-txid { color: inherit; text-decoration: underline dotted; }
.tg-note { margin: 0.5rem 0; font-size: 0.8rem; line-height: 1.4; }
.tg-num { max-width: 110px; align-self: flex-start; }
.tg-amt { max-width: 140px; align-self: flex-start; }
.fee-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px,1fr)); gap: 8px; }
@media (max-width: 560px) {
  .fee-tiers { grid-template-columns: repeat(2, 1fr); }
}
.fee-tier {
  display: flex; flex-direction: column; gap: 2px; padding: 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); cursor: pointer; text-align: left;
}
.fee-tier:hover:not(:disabled) { border-color: var(--orange-dim); }
.fee-tier.active { border-color: var(--orange); background: rgba(249,115,22,.08); }
.fee-tier:disabled { opacity: .4; cursor: not-allowed; }
.fee-tier .ft-label { font-size: 13px; font-weight: 600; }
.fee-tier .ft-rate { font-size: 12px; font-family: var(--font-mono); color: var(--orange); }
.fee-tier .ft-hint { font-size: 10px; color: var(--text-dim); }
.tg-label-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.4rem; }
.tg-label-input {
  flex: 0 1 220px; max-width: 220px; min-height: 32px;
  padding: 5px 10px; font-size: 12px;
}
.tg-add-row { display: flex; gap: 0.5rem; align-items: stretch; }
.tg-add-row .input { flex: 1; }
.tg-add-row .btn { white-space: nowrap; }
.tango-view select.input { max-width: 260px; align-self: flex-start; }
.tango-view .mono.text-xs { font-size: 11px; line-height: 1.45; }
.tx-detail-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 1rem; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--border);
}
.tx-detail-row:last-child { border-bottom: none; }
</style>
