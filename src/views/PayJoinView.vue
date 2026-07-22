<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'
import { refreshPayjoinWatch } from '@/stores/payjoinwatch'

const auth = useAuthStore()
const tab = ref('wallets')   // 'wallets' | 'create' | 'requests' | 'history'
const refreshing = ref(false)
const mempoolUrl = ref('https://mempool.space')

async function loadMempoolUrl() {
  try {
    const cfg = await api.getBlindbitConfig(auth.adminkey)
    mempoolUrl.value = (cfg?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
  } catch (e) {
    try {
      const cfg2 = await api.getAppConfig(auth.inkey)
      mempoolUrl.value = (cfg2?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
    } catch (e2) { mempoolUrl.value = 'https://mempool.space' }
  }
}
const explorerTxUrl = (txid) => `${mempoolUrl.value}/tx/${txid}`

// ── descriptors ──────────────────────────────────────────────────────────
const descriptors = ref([])
const loading = ref(true)
const error = ref('')
const newDescriptor = ref('')
const newLabel = ref('')
const importing = ref(false)
const expandedId = ref(null)
const utxos = ref([])
const utxoLoading = ref(false)
const utxoError = ref('')
const balConfirmed = ref(0)
const balUnconf = ref(0)

async function loadDescriptors() {
  loading.value = true; error.value = ''
  try { descriptors.value = (await api.payjoinListDescriptors(auth.inkey)) || [] }
  catch (e) { error.value = e.detail || e.message || 'Failed to load wallets.' }
  finally { loading.value = false }
}
async function importDescriptor() {
  let d = (newDescriptor.value || '').trim()
  if (!d) { pushToast('Paste an output descriptor first.', { type: 'warn' }); return }
  if (d.includes('//*')) d = d.replace('//*', '/<0;1>/*')
  importing.value = true
  try {
    await api.payjoinImportDescriptor(auth.inkey, d, (newLabel.value || '').trim() || null)
    newDescriptor.value = ''; newLabel.value = ''
    pushToast('Wallet imported.', { type: 'success' }); await loadDescriptors()
  } catch (e) { pushToast(e.detail || e.message || 'Import failed.', { type: 'error' }) }
  finally { importing.value = false }
}
async function removeDescriptor(d) {
  if (!confirm(`Remove watch-only wallet "${d.label || d.master_fp}"? Funds and seed are untouched.`)) return
  try {
    await api.payjoinDeleteDescriptor(auth.inkey, d.id)
    if (expandedId.value === d.id) { expandedId.value = null; utxos.value = [] }
    pushToast('Wallet removed.', { type: 'success' }); await loadDescriptors()
  } catch (e) { pushToast(e.detail || e.message || 'Remove failed.', { type: 'error' }) }
}
async function reloadUtxos(d) {
  // (Re)fetch this wallet's UTXOs/balance without toggling the panel closed —
  // used both when first expanding and by the Refresh button.
  expandedId.value = d.id; utxoError.value = ''
  utxoLoading.value = true
  try {
    const res = await api.payjoinGetUtxos(auth.inkey, d.id)
    utxos.value = res.utxos || []; balConfirmed.value = res.confirmed_sats || 0; balUnconf.value = res.unconfirmed_sats || 0
  } catch (e) { utxoError.value = e.detail || e.message || 'Sync failed (is Fulcrum reachable?).' }
  finally { utxoLoading.value = false }
}
async function toggleUtxos(d) {
  if (expandedId.value === d.id) { expandedId.value = null; utxos.value = []; return }
  utxos.value = []; balConfirmed.value = 0; balUnconf.value = 0
  await reloadUtxos(d)
}

// ── create invoice (payee A) ───────────────────────────────────────────────
const invDescId = ref('')        // A's receiving wallet
const invUtxos = ref([])
const invInputKey = ref('')      // A's one contributed input
const payerName = ref('')        // selected payer (from accepted connections)
const payers = ref([])           // accepted connections, for the picker

// connections
const contactsAccepted = ref([])
const contactsIncoming = ref([])
const contactsOutgoing = ref([])
const contactsDeclined = ref([])
const newContact = ref('')
const addingContact = ref(false)
const refreshingContacts = ref(false)
const invAmount = ref('')
const invMemo = ref('')
const invFeeRate = ref('1')
// live mempool fee tiers (mirrors SendView)
const invFeeTiers = ref(null)
const invFeeChoice = ref('halfHourFee')
const invFeeTierLabels = {
  fastestFee:  { label: 'Fastest', hint: '~10 min' },
  halfHourFee: { label: 'Fast',    hint: '~30 min' },
  hourFee:     { label: 'Normal',  hint: '~1 hour' },
  economyFee:  { label: 'Economy', hint: 'slower' },
}
async function loadInvFeeRates() {
  try {
    const t = await api.getRecommendedFees(auth.inkey)
    invFeeTiers.value = t
    if (invFeeChoice.value !== 'custom' && t[invFeeChoice.value]) invFeeRate.value = String(t[invFeeChoice.value])
  } catch (e) { invFeeTiers.value = null }
}
function selectInvFeeTier(key) {
  invFeeChoice.value = key
  if (key !== 'custom' && invFeeTiers.value && invFeeTiers.value[key]) invFeeRate.value = String(invFeeTiers.value[key])
}
const invLoading = ref(false)
const creating = ref(false)

async function loadPayers() {
  try { payers.value = (await api.payjoinListPayers(auth.inkey)).payers || [] }
  catch (e) { payers.value = [] }
}

async function loadContacts(silent = false) {
  try {
    const res = await api.payjoinListContacts(auth.inkey)
    const a = res.accepted || [], i = res.incoming || [], o = res.outgoing || [], d = res.declined || []
    if (JSON.stringify(contactsAccepted.value) !== JSON.stringify(a)) contactsAccepted.value = a
    if (JSON.stringify(contactsIncoming.value) !== JSON.stringify(i)) contactsIncoming.value = i
    if (JSON.stringify(contactsOutgoing.value) !== JSON.stringify(o)) contactsOutgoing.value = o
    if (JSON.stringify(contactsDeclined.value) !== JSON.stringify(d)) contactsDeclined.value = d
  } catch (e) { if (!silent) { /* silent on poll */ } }
}
async function refreshContacts() {
  refreshingContacts.value = true
  try { await loadContacts(); await loadPayers() } finally { refreshingContacts.value = false }
}
let _contactTimer = null
function _scheduleContactPoll() {
  if (_contactTimer) return
  _contactTimer = setInterval(async () => {
    if (tab.value !== 'connections') return   // only poll while viewing the tab
    await loadContacts(true)
  }, 8000)
}
function _stopContactPoll() { if (_contactTimer) { clearInterval(_contactTimer); _contactTimer = null } }
async function dismissDeclined(c) {
  try { await api.payjoinContactRemove(auth.inkey, c.id); await loadContacts() }
  catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function sendContactRequest() {
  const username = (newContact.value || '').trim()
  if (!username) { pushToast('Enter a username.', { type: 'warn' }); return }
  addingContact.value = true
  try {
    await api.payjoinContactRequest(auth.inkey, username)
    newContact.value = ''
    pushToast('If that username belongs to a user, they’ll get your request.', { type: 'success' })
    await loadContacts()
  } catch (e) { pushToast(e.detail || e.message || 'Could not send request.', { type: 'error' }) }
  finally { addingContact.value = false }
}
async function approveContact(c) {
  try { await api.payjoinContactApprove(auth.inkey, c.id); pushToast('Connected.', { type: 'success' }); await loadContacts(); await loadPayers() }
  catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function declineContact(c) {
  try { await api.payjoinContactDecline(auth.inkey, c.id); pushToast('Declined.', { type: 'success' }); await loadContacts() }
  catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function removeContact(c) {
  if (!confirm(`Remove connection with ${c.requester_username === undefined ? '' : ''}this user?`)) return
  try { await api.payjoinContactRemove(auth.inkey, c.id); pushToast('Connection removed.', { type: 'success' }); await loadContacts(); await loadPayers() }
  catch (e) { pushToast(e.detail || e.message || 'Failed.', { type: 'error' }) }
}
async function saveLabel(c) {
  try {
    await api.payjoinContactLabel(auth.inkey, c.id, (c.label || '').trim())
    pushToast('Label saved.', { type: 'success' })
    await loadPayers()
  } catch (e) { pushToast(e.detail || e.message || 'Could not save label.', { type: 'error' }) }
}
// display: prefer private label, else username
function payerDisplay(p) { return (p.label && p.label.trim()) ? `${p.label} (${p.username})` : p.username }
function otherName(c) {
  return c.counterparty_username || c.target_username || c.requester_username
}
async function loadInvUtxos() {
  invUtxos.value = []; invInputKey.value = ''
  if (!invDescId.value) return
  invLoading.value = true
  try { invUtxos.value = ((await api.payjoinGetUtxos(auth.inkey, invDescId.value)).utxos || []).filter(u => !u.reserved && !u.unconfirmed) }
  catch (e) { pushToast(e.detail || e.message || 'Could not load coins.', { type: 'error' }) }
  finally { invLoading.value = false }
}
async function createInvoice() {
  if (!invDescId.value) { pushToast('Pick the wallet that receives payment.', { type: 'warn' }); return }
  const u = invUtxos.value.find(x => (x.txid + ':' + x.vout) === invInputKey.value)
  if (!u) { pushToast('Choose one input to contribute.', { type: 'warn' }); return }
  if (!payerName.value) { pushToast('Select who pays (from your connections).', { type: 'warn' }); return }
  const amt = parseInt(invAmount.value, 10)
  if (!amt || amt <= 0) { pushToast('Enter a valid amount.', { type: 'warn' }); return }
  creating.value = true
  try {
    await api.payjoinCreateInvoice(auth.adminkey, {
      receiver_descriptor_id: invDescId.value,
      receiver_input: { txid: u.txid, vout: u.vout, value: u.value, chain: u.chain, index: u.index },
      payer_username: payerName.value,
      amount_sats: amt,
      fee_rate: parseFloat(invFeeRate.value) || 1,
      memo: (invMemo.value || '').trim() || null,
    })
    pushToast('Request created. Waiting for the payer.', { type: 'success' })
    invAmount.value = ''; invMemo.value = ''; invInputKey.value = ''
    tab.value = 'requests'; await loadRequests()
  } catch (e) { pushToast(e.detail || e.message || 'Create failed.', { type: 'error' }) }
  finally { creating.value = false }
}

// ── requests / invoices ─────────────────────────────────────────────────────
const incoming = ref([])
const outgoing = ref([])
const payable = ref([])
const reqLoading = ref(false)

function _assignIfChanged(refObj, next) {
  // only replace the array (triggering re-render) if contents actually changed
  if (JSON.stringify(refObj.value) !== JSON.stringify(next)) refObj.value = next
}
async function loadRequests(silent = false) {
  if (!silent) reqLoading.value = true
  try {
    const res = await api.payjoinListRequests(auth.inkey)
    _assignIfChanged(incoming, res.incoming || [])
    _assignIfChanged(outgoing, res.outgoing || [])
    const inv = await api.payjoinListInvoices(auth.inkey)
    _assignIfChanged(payable, inv.payable || [])
    if (_awaitingSig()) _schedulePoll(); else _stopPoll()
    refreshPayjoinWatch()   // keep the nav badge in sync after local changes
  } catch (e) { if (!silent) pushToast(e.detail || e.message || 'Could not load.', { type: 'error' }) }
  finally { if (!silent) reqLoading.value = false }
}
async function refreshRequests() {
  refreshing.value = true
  try { await loadRequests() } finally { refreshing.value = false }
}

const TERMINAL = ['BROADCAST', 'CONFIRMED', 'CANCELLED']
// things that need MY signature or the other party's: status CLAIMED
const activeInvolved = computed(() => {
  return [...incoming.value, ...outgoing.value]
    .filter(r => r.status === 'CLAIMED')
    // de-dup by id (a self-directed edge case)
    .filter((r, i, a) => a.findIndex(x => x.id === r.id) === i)
})
const myOpenInvoices = computed(() => outgoing.value.filter(r => r.status === 'OPEN').concat(
  incoming.value.filter(r => r.status === 'OPEN')
).filter((r, i, a) => a.findIndex(x => x.id === r.id) === i))

const history = computed(() => {
  const all = [
    ...incoming.value.map(r => ({ ...r, dir: 'in' })),
    ...outgoing.value.map(r => ({ ...r, dir: 'out' })),
  ].filter(r => TERMINAL.includes(r.status))
   .filter((r, i, a) => a.findIndex(x => x.id === r.id) === i)
  return all.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
})

// ── pay an invoice (payer B) ─────────────────────────────────────────────────
const payFor = ref(null)
const payDescId = ref('')
const payUtxos = ref([])
const paySelected = ref(new Set())
const payLoading = ref(false)
const paySelectedSats = computed(() =>
  payUtxos.value.filter(u => paySelected.value.has(u.txid + ':' + u.vout)).reduce((s, u) => s + Number(u.value), 0))

function startPay(r) {
  payFor.value = r.id; payDescId.value = ''; payUtxos.value = []; paySelected.value = new Set()
}
async function loadPayUtxos() {
  payUtxos.value = []; paySelected.value = new Set()
  if (!payDescId.value) return
  payLoading.value = true
  try { payUtxos.value = (await api.payjoinGetUtxos(auth.inkey, payDescId.value)).utxos || [] }
  catch (e) { pushToast(e.detail || e.message || 'Could not load coins.', { type: 'error' }) }
  finally { payLoading.value = false }
}
function togglePay(u) {
  if (u.reserved || u.unconfirmed) return
  const k = u.txid + ':' + u.vout; const s = new Set(paySelected.value)
  s.has(k) ? s.delete(k) : s.add(k); paySelected.value = s
}
async function submitPay(r) {
  if (!payDescId.value) { pushToast('Pick a wallet to pay from.', { type: 'warn' }); return }
  const inputs = payUtxos.value.filter(u => paySelected.value.has(u.txid + ':' + u.vout))
    .map(u => ({ txid: u.txid, vout: u.vout, value: u.value, chain: u.chain, index: u.index }))
  if (!inputs.length) { pushToast('Select at least one input.', { type: 'warn' }); return }
  payLoading.value = true
  try {
    await api.payjoinPayInvoice(auth.adminkey, r.id, { sender_descriptor_id: payDescId.value, sender_inputs: inputs })
    pushToast('Request accepted. Now both parties sign.', { type: 'success' })
    payFor.value = null; await loadRequests()
  } catch (e) { pushToast(e.detail || e.message || 'Pay failed.', { type: 'error' }) }
  finally { payLoading.value = false }
}

// ── sign (either party) ──────────────────────────────────────────────────────
const signFor = ref(null)
const unsignedPsbt = ref('')
const signedPaste = ref('')
const signing = ref(false)
const showSignConfirm = ref(false)
const signConfirmReq = ref(null)

async function startSign(r) {
  signFor.value = r.id; unsignedPsbt.value = ''; signedPaste.value = ''
  try { unsignedPsbt.value = (await api.payjoinGetUnsigned(auth.inkey, r.id)).unsigned_psbt }
  catch (e) { pushToast(e.detail || e.message || 'Could not fetch PSBT.', { type: 'error' }); signFor.value = null }
}
async function copyUnsigned() {
  try { await navigator.clipboard.writeText(unsignedPsbt.value); pushToast('Unsigned PSBT copied.', { type: 'success' }) }
  catch { pushToast('Copy failed — select manually.', { type: 'warn' }) }
}
function askSign(r) {
  if (!(signedPaste.value || '').trim()) { pushToast('Paste your signed PSBT first.', { type: 'warn' }); return }
  signConfirmReq.value = r
  showSignConfirm.value = true
}
async function submitSign(r) {
  const signed = (signedPaste.value || '').trim()
  if (!signed) { pushToast('Paste your signed PSBT first.', { type: 'warn' }); return }
  signing.value = true
  try {
    const res = await api.payjoinSign(auth.adminkey, r.id, signed)
    if (res.status === 'BROADCAST') pushToast(`Broadcast! txid ${res.txid.slice(0, 12)}…`, { type: 'success', timeout: 12000 })
    else pushToast('Signature submitted. Waiting for the other party.', { type: 'success' })
    showSignConfirm.value = false; signConfirmReq.value = null
    signFor.value = null; signedPaste.value = ''; unsignedPsbt.value = ''
    await loadRequests()
  } catch (e) { pushToast(e.detail || e.message || 'Sign failed.', { type: 'error' }) }
  finally { signing.value = false }
}
async function cancelReq(r) {
  if (!confirm('Cancel this PayJoin?')) return
  try { await api.payjoinCancel(auth.inkey, r.id); pushToast('Cancelled.', { type: 'success' }); await loadRequests() }
  catch (e) { pushToast(e.detail || e.message || 'Cancel failed.', { type: 'error' }) }
}

// ── scoped poll (while awaiting signatures) ──────────────────────────────────
let _pollTimer = null
function _awaitingSig() {
  return [...incoming.value, ...outgoing.value].some(r => r.status === 'CLAIMED' || r.status === 'OPEN')
}
function _schedulePoll() {
  if (_pollTimer) return
  _pollTimer = setInterval(async () => {
    if (!_awaitingSig()) { _stopPoll(); return }
    // pause polling while the user has a pay/sign panel open or a modal up
    if (payFor.value || signFor.value || showSignConfirm.value) return
    try { await loadRequests(true) } catch (e) {}
    if (!_awaitingSig()) _stopPoll()
  }, 8000)
}
function _stopPoll() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null } }

const fmtSats = (n) => (n == null ? '—' : Number(n).toLocaleString() + ' sats')
const shortTxid = (t) => (t ? `${t.slice(0, 10)}…${t.slice(-6)}` : '')
const statusLabel = (s) => ({
  OPEN: 'Request open', CLAIMED: 'Awaiting signatures',
  BROADCAST: 'Broadcast — confirming', CONFIRMED: 'Completed', CANCELLED: 'Cancelled',
}[s] || s)

function amISigner(r) { return true } // both parties sign; either can sign while CLAIMED

onMounted(async () => { await loadDescriptors(); await loadRequests(); loadMempoolUrl(); loadPayers(); loadContacts() })
onUnmounted(() => { _stopPoll(); _stopContactPoll() })
</script>

<template>
  <div class="payjoin-view">
    <div class="pj-tabs">
      <button class="btn btn-sm" :class="tab === 'wallets' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'wallets'">Wallets</button>
      <button class="btn btn-sm" :class="tab === 'create' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'create'; loadPayers(); loadInvFeeRates(); if (invDescId) loadInvUtxos()">Create</button>
      <button class="btn btn-sm" :class="tab === 'connections' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'connections'; loadContacts(); _scheduleContactPoll()">Connections</button>
      <button class="btn btn-sm" :class="tab === 'requests' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'requests'; loadRequests()">Requests</button>
      <button class="btn btn-sm" :class="tab === 'history' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'history'; loadRequests()">History</button>
    </div>

    <!-- WALLETS -->
    <template v-if="tab === 'wallets'">
      <div class="card">
        <div class="card-header">PayJoin — Watch-only wallets</div>
        <div class="card-body">
          <div class="alert alert-info pj-privacy-warn">
            ℹ <strong>This PayJoin is internal.</strong> It works only between users
            on this instance — both the payer and payee must have an account here
            and an imported wallet. It does not connect to external wallets or
            other servers.
          </div>
          <p class="text-dim text-sm">
            <b>PayJoin is separate from your Silent Payments wallet.</b> It uses a
            watch-only wallet you import here. Your keys stay in your own wallet —
            you sign every transaction there. No funds or seed are ever held here.
          </p>
          <p class="text-dim text-sm" style="margin-top:0.5rem;">
            <b>To get your descriptor in Sparrow:</b> open Settings → under
            <i>Script Policy</i> click <b>Edit</b> next to <i>Descriptor</i>, then
            copy the <b>whole string</b> (it starts with <span class="mono">wpkh(</span>
            and ends with a <span class="mono">#checksum</span>). Paste it below.
          </p>
          <div class="alert alert-warn pj-privacy-warn">
            ⚠ <strong>Use Sparrow for signing — both parties.</strong> PayJoin's
            privacy benefit only holds when both inputs are signed with the same
            wallet software. Different wallets make the inputs distinguishable
            on-chain, which defeats the point.
          </div>
          <div class="field">
            <label class="text-dim text-xs">Output descriptor</label>
            <textarea class="input mono pj-descriptor" rows="3" v-model="newDescriptor" placeholder="wpkh([abcd1234/84h/1h/0h]tpub.../<0;1>/*)"></textarea>
          </div>
          <div class="field">
            <label class="text-dim text-xs">Label (optional)</label>
            <input class="input pj-label-field" v-model="newLabel" placeholder="e.g. Sparrow signet" />
          </div>
          <button class="btn btn-primary" :disabled="importing" @click="importDescriptor">{{ importing ? 'Importing…' : 'Import descriptor' }}</button>
        </div>
      </div>
      <div v-if="error" class="alert alert-warn">{{ error }}</div>
      <div v-if="loading" class="text-dim text-sm">Loading…</div>
      <div v-for="d in descriptors" :key="d.id" class="card">
        <div class="card-header">
          <span>{{ d.label || 'Watch-only wallet' }}</span>
          <span class="mono text-dim text-xs"> · {{ d.network }}</span>
        </div>
        <div class="card-body">
          <div class="mono text-xs text-dim" style="word-break: break-all;">{{ d.xpub }}</div>
          <div style="margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
            <button class="btn btn-ghost btn-sm" @click="toggleUtxos(d)">{{ expandedId === d.id ? 'Hide coins' : 'View coins / balance' }}</button>
            <button class="btn btn-ghost btn-sm" @click="removeDescriptor(d)">Remove</button>
          </div>
          <div v-if="expandedId === d.id" style="margin-top: 0.75rem;">
            <div v-if="utxoLoading" class="text-dim text-sm">Syncing via Fulcrum…</div>
            <div v-else-if="utxoError" class="alert alert-warn">{{ utxoError }}</div>
            <div v-else>
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <div class="text-sm">Confirmed: <span class="text-green mono">{{ fmtSats(balConfirmed) }}</span>
                  <span v-if="balUnconf" class="text-dim"> · Unconfirmed: <span class="mono">{{ fmtSats(balUnconf) }}</span></span>
                </div>
                <button class="btn btn-ghost btn-sm" :disabled="utxoLoading" @click="reloadUtxos(d)" title="Re-sync via Fulcrum">↻ Refresh</button>
              </div>
              <div v-if="!utxos.length" class="text-dim text-xs" style="margin-top: 0.5rem;">No spendable coins found.</div>
              <table v-else class="pj-utxos">
                <thead><tr><th>Outpoint</th><th>Chain/Index</th><th class="r">Value</th></tr></thead>
                <tbody>
                  <tr v-for="u in utxos" :key="u.txid + ':' + u.vout">
                    <td class="mono text-xs">{{ shortTxid(u.txid) }}:{{ u.vout }}<span v-if="u.reserved" class="pj-badge">reserved</span><span v-else-if="u.unconfirmed" class="pj-badge">unconfirmed</span></td>
                    <td class="mono text-xs text-dim">{{ u.chain }}/{{ u.index }}</td>
                    <td class="mono text-xs r">{{ fmtSats(u.value) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!loading && !descriptors.length" class="text-dim text-sm">No watch-only wallets imported yet.</div>
    </template>

    <!-- CREATE INVOICE (payee A) -->
    <template v-else-if="tab === 'create'">
      <div class="card">
        <div class="card-header">Create a payment request</div>
        <div class="card-body">
          <p class="text-dim text-sm">Create a PayJoin payment request for <b>another user on this instance</b>. You contribute one input; they add inputs covering the amount they owe you plus the network fee for the transaction.</p>
          <div class="field">
            <label class="text-dim text-xs">Receive into wallet</label>
            <select class="input" v-model="invDescId" @change="loadInvUtxos">
              <option value="">Select your wallet…</option>
              <option v-for="d in descriptors" :key="d.id" :value="d.id">{{ d.label || d.master_fp }} ({{ d.network }})</option>
            </select>
          </div>
          <div class="field">
            <label class="text-dim text-xs">Who pays this request?</label>
            <select class="input" v-model="payerName">
              <option value="">Select from your connections…</option>
              <option v-for="p in payers" :key="p.user_id" :value="p.username">{{ payerDisplay(p) }}</option>
            </select>
            <p v-if="!payers.length" class="text-dim text-xs" style="margin-top: 0.25rem;">
              No connections yet. Add one in the <b>Connections</b> tab — they approve, then appear here.
            </p>
          </div>
          <div class="field">
            <label class="text-dim text-xs">Amount (sats)</label>
            <input class="input mono pj-amt" v-model="invAmount" inputmode="numeric" placeholder="25000" />
          </div>
          <div class="field">
            <label class="text-dim text-xs">Memo (optional)</label>
            <input class="input pj-memo" v-model="invMemo" placeholder="What's this for?" />
          </div>
          <div class="field">
            <label class="text-dim text-xs">Fee rate</label>
            <div v-if="invFeeTiers" class="fee-tiers">
              <button v-for="(meta, key) in invFeeTierLabels" :key="key" type="button"
                      class="fee-tier" :class="{ active: invFeeChoice === key }"
                      @click="selectInvFeeTier(key)" :disabled="!invFeeTiers[key]">
                <span class="ft-label">{{ meta.label }}</span>
                <span class="ft-rate">{{ invFeeTiers[key] }} sat/vB</span>
                <span class="ft-hint">{{ meta.hint }}</span>
              </button>
              <button type="button" class="fee-tier" :class="{ active: invFeeChoice === 'custom' }" @click="selectInvFeeTier('custom')">
                <span class="ft-label">Custom</span>
                <span class="ft-rate">{{ invFeeChoice === 'custom' ? invFeeRate + ' sat/vB' : '—' }}</span>
                <span class="ft-hint">set manually</span>
              </button>
            </div>
            <input v-if="!invFeeTiers || invFeeChoice === 'custom'" class="input mono pj-num"
                   v-model="invFeeRate" inputmode="decimal" placeholder="1" style="margin-top:6px;" />
          </div>
          <div v-if="invLoading" class="text-dim text-sm">Loading coins…</div>
          <div v-else-if="invDescId">
            <label class="text-dim text-xs">Choose one input to contribute</label>
            <div v-if="!invUtxos.length" class="text-dim text-xs">No available (unreserved) coins.</div>
            <table v-else class="pj-utxos">
              <tbody>
                <tr v-for="u in invUtxos" :key="u.txid + ':' + u.vout" @click="invInputKey = u.txid + ':' + u.vout" style="cursor: pointer;">
                  <td><input type="radio" :checked="invInputKey === (u.txid + ':' + u.vout)" @click.stop="invInputKey = u.txid + ':' + u.vout" /></td>
                  <td class="mono text-xs">{{ shortTxid(u.txid) }}:{{ u.vout }}</td>
                  <td class="mono text-xs r">{{ fmtSats(u.value) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button class="btn btn-primary" :disabled="creating" style="margin-top: 0.75rem;" @click="createInvoice">{{ creating ? 'Creating…' : 'Create request' }}</button>
        </div>
      </div>
    </template>

    <!-- CONNECTIONS -->
    <template v-else-if="tab === 'connections'">
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshingContacts" @click="refreshContacts">{{ refreshingContacts ? 'Refreshing…' : '↻ Refresh' }}</button>
      </div>
      <div class="card">
        <div class="card-header">Add a connection</div>
        <div class="card-body">
          <p class="text-dim text-sm">
            Connect with another user by their <b>Thrilla username</b>. They
            approve the request, then you can request payments from or pay each
            other.
          </p>
          <label class="text-dim text-xs" style="display:block; margin-bottom:4px;">Username</label>
          <div class="pj-add-row">
            <input class="input" v-model="newContact" type="text" placeholder="username" autocapitalize="off" autocomplete="off" />
            <button class="btn btn-primary" :disabled="addingContact" @click="sendContactRequest">{{ addingContact ? 'Sending…' : 'Send request' }}</button>
          </div>
        </div>
      </div>

      <div class="card" v-if="contactsIncoming.length">
        <div class="card-header">Requests to you</div>
        <div class="card-body">
          <div v-for="c in contactsIncoming" :key="c.id" class="pj-req">
            <div class="pj-req-row">
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
          <div v-for="c in contactsAccepted" :key="c.id" class="pj-req">
            <div class="pj-req-row" style="align-items:center;">
              <div class="text-sm" style="flex:1;"><b>{{ c.counterparty_username }}</b></div>
              <button class="btn btn-ghost btn-sm" @click="removeContact(c)">Remove</button>
            </div>
            <div class="pj-label-row">
              <input class="input pj-label-input" v-model="c.label"
                     placeholder="private label (only you see this)" @keyup.enter="saveLabel(c)" />
              <button class="btn btn-ghost btn-sm" @click="saveLabel(c)">Save</button>
            </div>
          </div>
          <div v-if="contactsOutgoing.length" style="margin-top:0.75rem;">
            <div class="text-dim text-xs" style="margin-bottom:0.25rem;">Pending (awaiting their approval)</div>
            <div v-for="c in contactsOutgoing" :key="c.id" class="pj-req">
              <div class="pj-req-row">
                <div class="text-sm text-dim"><b>{{ c.counterparty_username }}</b> · pending</div>
                <button class="btn btn-ghost btn-sm" @click="removeContact(c)">Cancel</button>
              </div>
            </div>
          </div>
          <div v-if="contactsDeclined.length" style="margin-top:0.75rem;">
            <div class="text-dim text-xs" style="margin-bottom:0.25rem;">Declined</div>
            <div v-for="c in contactsDeclined" :key="c.id" class="pj-req">
              <div class="pj-req-row">
                <div class="text-sm"><b>{{ c.counterparty_username }}</b> <span class="text-orange">· declined your request</span></div>
                <button class="btn btn-ghost btn-sm" @click="dismissDeclined(c)">Dismiss</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- REQUESTS -->
    <template v-else-if="tab === 'requests'">
      <div style="display: flex; justify-content: flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshing" @click="refreshRequests">{{ refreshing ? 'Refreshing…' : '↻ Refresh' }}</button>
      </div>

      <!-- invoices to pay -->
      <div class="card">
        <div class="card-header">Requests to pay</div>
        <div class="card-body">
          <div v-if="reqLoading" class="text-dim text-sm">Loading…</div>
          <div v-else-if="!payable.length" class="text-dim text-sm">No requests waiting for you.</div>
          <div v-for="r in payable" :key="r.id" class="pj-req">
            <div class="pj-req-row">
              <div>
                <div class="text-sm">Pay <b>{{ r.receiver_username }}</b> · <span class="mono">{{ fmtSats(r.amount_sats) }}</span></div>
                <div class="text-xs text-dim"><span v-if="r.memo">“{{ r.memo }}” · </span>{{ statusLabel(r.status) }}</div>
              </div>
              <div style="display:flex;gap:0.5rem;">
                <button v-if="payFor !== r.id" class="btn btn-sm btn-primary" @click="startPay(r)">Pay</button>
                <button class="btn btn-ghost btn-sm" @click="cancelReq(r)">Decline</button>
              </div>
            </div>
            <div v-if="payFor === r.id" class="pj-finalize">
              <div class="alert alert-warn pj-privacy-warn">⚠ <strong>Sign in Sparrow.</strong> Both parties must sign in the same wallet software or the privacy benefit is lost.</div>
              <div class="field">
                <label class="text-dim text-xs">Pay from wallet</label>
                <select class="input" v-model="payDescId" @change="loadPayUtxos">
                  <option value="">Select your wallet…</option>
                  <option v-for="d in descriptors" :key="d.id" :value="d.id">{{ d.label || d.master_fp }} ({{ d.network }})</option>
                </select>
              </div>
              <div v-if="payLoading" class="text-dim text-sm">Loading coins…</div>
              <div v-else-if="payDescId">
                <label class="text-dim text-xs">Select inputs</label>
                <table class="pj-utxos">
                  <tbody>
                    <tr v-for="u in payUtxos" :key="u.txid + ':' + u.vout" @click="togglePay(u)" :style="(u.reserved || u.unconfirmed) ? 'opacity:0.5;' : 'cursor:pointer;'">
                      <td><input type="checkbox" :disabled="u.reserved || u.unconfirmed" :checked="paySelected.has(u.txid + ':' + u.vout)" @click.stop="togglePay(u)" /></td>
                      <td class="mono text-xs">{{ shortTxid(u.txid) }}:{{ u.vout }}<span v-if="u.reserved" class="pj-badge">reserved</span><span v-else-if="u.unconfirmed" class="pj-badge">unconfirmed</span></td>
                      <td class="mono text-xs r">{{ fmtSats(u.value) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="text-xs text-dim" style="margin-top:0.5rem;">Selected: <span class="mono">{{ fmtSats(paySelectedSats) }}</span> · need ≥ {{ fmtSats(r.amount_sats) }} + fee</div>
              </div>
              <button class="btn btn-primary btn-sm" :disabled="payLoading" style="margin-top:0.5rem;" @click="submitPay(r)">{{ payLoading ? 'Building…' : 'Pay & build PSBT' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- awaiting signatures (either party signs) -->
      <div class="card">
        <div class="card-header">Awaiting signatures</div>
        <div class="card-body">
          <div v-if="reqLoading" class="text-dim text-sm">Loading…</div>
          <div v-else-if="!activeInvolved.length" class="text-dim text-sm">Nothing awaiting signatures.</div>
          <div v-for="r in activeInvolved" :key="r.id" class="pj-req">
            <div class="pj-req-row">
              <div>
                <div class="text-sm"><b>{{ r.receiver_username }}</b> ⇄ <b>{{ r.sender_username }}</b> · <span class="mono">{{ fmtSats(r.amount_sats) }}</span></div>
                <div class="text-xs text-dim"><span v-if="r.memo">“{{ r.memo }}” · </span>{{ statusLabel(r.status) }}</div>
              </div>
              <div style="display:flex;gap:0.5rem;">
                <button v-if="signFor !== r.id" class="btn btn-sm btn-primary" @click="startSign(r)">Sign</button>
                <button class="btn btn-ghost btn-sm" @click="cancelReq(r)">Cancel</button>
              </div>
            </div>
            <div v-if="signFor === r.id" class="pj-finalize">
              <div class="alert alert-warn pj-privacy-warn">⚠ <strong>Sign in Sparrow.</strong> Both parties must sign in the same wallet software, or on-chain analysis can separate the inputs and the privacy benefit is lost.</div>
              <ol class="pj-steps text-xs text-dim">
                <li>Copy the unsigned PSBT below (button).</li>
                <li>In Sparrow: <b>File → Open Transaction → From Text</b>, paste it.</li>
                <li>Click <b>Finalize Transaction for Signing</b>, then <b>Sign</b>.</li>
                <li>Click <b>Save PSBT → To Clipboard → As Base64</b>.</li>
                <li>Paste it back below and submit. The transaction broadcasts once both parties have signed.</li>
              </ol>
              <textarea class="input mono" rows="3" readonly :value="unsignedPsbt"></textarea>
              <button class="btn btn-sm" @click="copyUnsigned">Copy unsigned PSBT</button>
              <div class="field" style="margin-top:0.5rem;">
                <label class="text-dim text-xs">Paste your signed PSBT</label>
                <textarea class="input mono" rows="3" v-model="signedPaste" placeholder="cHNidP8B…"></textarea>
              </div>
              <button class="btn btn-primary btn-sm" :disabled="signing" @click="askSign(r)">{{ signing ? 'Submitting…' : 'Submit signed PSBT' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- my open invoices (awaiting a payer) -->
      <div class="card" v-if="myOpenInvoices.length">
        <div class="card-header">My open requests</div>
        <div class="card-body">
          <div v-for="r in myOpenInvoices" :key="r.id" class="pj-req">
            <div class="pj-req-row">
              <div>
                <div class="text-sm">{{ r.receiver_username === undefined ? '' : '' }}Billing <b>{{ r.sender_username }}</b> · <span class="mono">{{ fmtSats(r.amount_sats) }}</span></div>
                <div class="text-xs text-dim"><span v-if="r.memo">“{{ r.memo }}” · </span>{{ statusLabel(r.status) }}</div>
              </div>
              <button class="btn btn-ghost btn-sm" @click="cancelReq(r)">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- HISTORY -->
    <template v-else>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" :disabled="refreshing" @click="refreshRequests">{{ refreshing ? 'Refreshing…' : '↻ Refresh' }}</button>
      </div>
      <div class="card">
        <div class="card-header">PayJoin history</div>
        <div class="card-body">
          <div v-if="reqLoading" class="text-dim text-sm">Loading…</div>
          <div v-else-if="!history.length" class="text-dim text-sm">No completed PayJoins yet.</div>
          <div v-for="r in history" :key="r.id" class="pj-req" :class="r.status === 'CANCELLED' ? 'pj-cancelled' : ''">
            <div class="pj-req-row">
              <div>
                <div class="text-sm"><b>{{ r.receiver_username }}</b> ⇄ <b>{{ r.sender_username }}</b> · <span class="mono">{{ fmtSats(r.amount_sats) }}</span></div>
                <div class="text-xs text-dim">
                  <span :class="r.status === 'CONFIRMED' ? 'text-green' : (r.status === 'BROADCAST' ? 'text-amber' : '')">{{ statusLabel(r.status) }}</span>
                  <span v-if="r.txid"> · <a class="mono pj-txid" :href="explorerTxUrl(r.txid)" target="_blank" rel="noopener">{{ shortTxid(r.txid) }}</a></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <!-- confirm before submitting signature (may broadcast if both signed) -->
    <div v-if="showSignConfirm && signConfirmReq" class="modal-overlay" @click.self="showSignConfirm = false">
      <div class="card modal" style="max-width:420px">
        <div class="card-header"><h2>Confirm signature</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <p class="text-sm text-dim" style="margin:0">
            Submitting your signed PSBT. <b>If the other party has already signed,
            this broadcasts the transaction immediately</b> and it can't be undone.
          </p>
          <div class="tx-detail-row"><span>Payee</span><span class="mono">{{ signConfirmReq.receiver_username }}</span></div>
          <div class="tx-detail-row"><span>Payer</span><span class="mono">{{ signConfirmReq.sender_username }}</span></div>
          <div class="tx-detail-row"><span>Amount</span><span class="text-orange mono">{{ fmtSats(signConfirmReq.amount_sats) }}</span></div>
          <div class="tx-detail-row" v-if="signConfirmReq.fee_sats"><span>Fee</span><span class="mono">{{ fmtSats(signConfirmReq.fee_sats) }}</span></div>
          <div class="flex gap-2 justify-between" style="margin-top:8px">
            <button class="btn btn-ghost" @click="showSignConfirm = false">Cancel</button>
            <button class="btn btn-success" :disabled="signing" @click="submitSign(signConfirmReq)">
              {{ signing ? 'Submitting…' : 'Confirm & submit' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-amber { color: #f59e0b; }
.payjoin-view { max-width: 640px; width: 100%; margin: 0 auto; align-self: flex-start; }
/* spacing between top-level cards/blocks (replaces flex gap, which capped the
   view's height inside the flex page-wrap and clipped content on mobile) */
.payjoin-view > * { margin-bottom: 1rem; }
.payjoin-view > *:last-child { margin-bottom: 0; }
.payjoin-view .card-body { padding: 16px; }
.payjoin-view .field { gap: 4px; }
.pj-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.pj-utxos { width: 100%; border-collapse: collapse; margin-top: 0.5rem; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.pj-utxos thead, .pj-utxos tbody { display: table; width: 100%; }
.pj-utxos th, .pj-utxos td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
.pj-utxos .r { text-align: right; }
@media (max-width: 560px) {
  .pj-utxos th, .pj-utxos td { padding: 0.25rem 0.35rem; font-size: 10.5px; }
}
.pj-req { padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.pj-req-row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.pj-finalize { margin-top: 0.5rem; padding: 0.5rem; background: rgba(255,255,255,0.03); border-radius: 6px; }
.pj-badge { font-size: 0.65rem; padding: 0.05rem 0.35rem; border-radius: 4px; background: rgba(255,180,0,0.18); color: #ffb400; margin-left: 0.35rem; }
.pj-cancelled { opacity: 0.55; }
.pj-txid { color: inherit; text-decoration: underline dotted; }
.pj-privacy-warn { margin: 0.5rem 0; font-size: 0.8rem; line-height: 1.4; }
.pj-steps { margin: 0.5rem 0; padding-left: 1.1rem; line-height: 1.5; }
.pj-steps li { margin-bottom: 0.2rem; }
.pj-num { max-width: 110px; align-self: flex-start; }
.pj-amt { max-width: 140px; align-self: flex-start; }
.pj-memo { max-width: 240px; align-self: flex-start; }
.fee-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px,1fr)); gap: 8px; }
@media (max-width: 560px) {
  .fee-tiers { grid-template-columns: repeat(2, 1fr); }
}
.fee-tier { display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); cursor: pointer; text-align: left; }
.fee-tier:hover:not(:disabled) { border-color: var(--orange-dim); }
.fee-tier.active { border-color: var(--orange); background: rgba(249,115,22,.08); }
.fee-tier:disabled { opacity: .4; cursor: not-allowed; }
.fee-tier .ft-label { font-size: 13px; font-weight: 600; }
.fee-tier .ft-rate { font-size: 12px; font-family: var(--font-mono); color: var(--orange); }
.fee-tier .ft-hint { font-size: 10px; color: var(--text-dim); }
.pj-label-field { max-width: 320px; align-self: flex-start; }
.pj-descriptor { max-width: 480px; }
.payjoin-view textarea.input { font-size: 12px; line-height: 1.4; }
.payjoin-view .mono.text-xs { font-size: 11px; line-height: 1.45; }
.pj-label-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.4rem; }
.pj-label-input { flex: 0 1 220px; max-width: 220px; min-height: 32px; padding: 5px 10px; font-size: 12px; }
.pj-add-row { display: flex; gap: 0.5rem; align-items: stretch; }
.pj-add-row .input { flex: 1; }
.pj-add-row .btn { white-space: nowrap; }
.payjoin-view select.input { max-width: 260px; align-self: flex-start; }
.tx-detail-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.tx-detail-row:last-child { border-bottom: none; }
</style>
