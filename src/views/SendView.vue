<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { useAmount } from '@/composables/useAmount'
import { saveTxRecipientLabel, saveSwapTxLabel } from '@/stores/txlabels'
import { pushToast } from '@/stores/toasts'
import { addPendingSend } from '@/stores/pendingsends'
import QrScanModal from '@/components/QrScanModal.vue'

const route = useRoute()
const auth  = useAuthStore()

// QR scanning only ships on Mainnet for now. The web camera path is unreliable
// on some mobile browsers; the reliable native scanner will land with the
// Mainnet-only Android app. Hide the Scan button on signet/regtest builds.
const NETWORK_LOCK = import.meta.env.VITE_NETWORK_LOCK || null
const SCAN_ENABLED = (NETWORK_LOCK === 'mainnet') || !NETWORK_LOCK
const { fmt } = useAmount()

const wallets       = ref([])
const selectedWallet = ref(route.query.wallet_id || '')
const hasKeys = computed(() => !!(selectedWallet.value && auth.hasWalletKeys(selectedWallet.value)))
const utxos         = ref([])
const loadingUtxos  = ref(false)

const recipient  = ref(route.query.address || '')
const amount     = ref(route.query.amount ? Number(route.query.amount) : null)
// Swap-funding context: when SendView is opened to fund a Boltz swap-in, these
// carry the swap id + lightning amount so we can show a banner and (after
// broadcast) point the user back to swap status.
const swapId       = ref(route.query.swap_id || '')
const swapLnAmount = ref(route.query.swap_ln ? Number(route.query.swap_ln) : null)
const isSwapFunding = computed(() => !!swapId.value)
const feeRate    = ref(1)

// Live fee tiers (sat/vB) from the configured mempool. feeRate stays the value
// actually sent to the builder; the selector just sets it.
const feeTiers   = ref(null)          // { fastestFee, halfHourFee, hourFee, economyFee, ... }
const feeChoice  = ref('halfHourFee') // selected tier key, or 'custom'
const feesLoading = ref(false)
const feeTierLabels = {
  fastestFee:  { label: 'Fastest',  hint: '~10 min (next block)' },
  halfHourFee: { label: 'Fast',     hint: '~30 min' },
  hourFee:     { label: 'Normal',   hint: '~1 hour' },
  economyFee:  { label: 'Economy',  hint: 'cheaper, slower' },
}

async function loadFeeRates() {
  feesLoading.value = true
  try {
    const t = await api.getRecommendedFees(auth.inkey)
    feeTiers.value = t
    // Apply current choice (default Fast) unless user is on custom
    if (feeChoice.value !== 'custom' && t[feeChoice.value]) {
      feeRate.value = t[feeChoice.value]
    }
  } catch (e) {
    feeTiers.value = null   // selector hidden; custom input remains usable
  } finally {
    feesLoading.value = false
  }
}

function selectFeeTier(key) {
  feeChoice.value = key
  if (key !== 'custom' && feeTiers.value && feeTiers.value[key]) {
    feeRate.value = feeTiers.value[key]
  }
}

const building   = ref(false)
const buildError = ref(null)
const txResult   = ref(null)

const broadcasting  = ref(false)
const broadcastError = ref(null)
const broadcastDone  = ref(null)
const mempoolUrl     = ref('')
const showConfirm    = ref(false)

const selectedUtxos = computed(() => utxos.value.filter(u => u.selected && u.utxo_state === 'unspent'))

// Privacy: detect when user has selected UTXOs with different labels
const mixedLabels = computed(() => {
  const sel = selectedUtxos.value
  if (sel.length < 2) return null
  const labels = new Set(sel.map(u => (u.label || '').trim() || '__unlabeled__'))
  if (labels.size > 1) return Array.from(labels).map(l => l === '__unlabeled__' ? '(unlabeled)' : l)
  return null
})

// Privacy: any transaction combining 2+ inputs links those coins on-chain
// (common-input-ownership heuristic), regardless of labels. Surfaced as a softer
// caution when the inputs share a label (or are all unlabeled), since the
// stronger mixedLabels warning already covers the cross-label case.
const multiInputSelected = computed(
  () => selectedUtxos.value.length > 1 && !mixedLabels.value
)
const selectedTotal = computed(() => selectedUtxos.value.reduce((s, u) => s + u.amount, 0))

// Live fee estimate — mirrors the backend builder's vsize formula exactly:
//   vsize = 10 + 57.5*inputs + 31*2   (two outputs assumed: recipient + change)
//   fee   = max(1, ceil(vsize * fee_rate))
const estimatedVsize = computed(() => {
  const nIn = selectedUtxos.value.length
  if (!nIn) return 0
  return Math.floor(10 + 57.5 * nIn + 31 * 2)
})
const estimatedFee = computed(() => {
  const rate = Number(feeRate.value) || 0
  if (!estimatedVsize.value || rate <= 0) return 0
  return Math.max(1, Math.ceil(estimatedVsize.value * rate))
})
// Does the selection cover amount + estimated fee?
const feeExceedsFunds = computed(() => {
  if (!amount.value || !selectedTotal.value) return false
  return (Number(amount.value) + estimatedFee.value) > selectedTotal.value
})

const canBuild = computed(() =>
  selectedWallet.value &&
  recipient.value.trim() &&
  amount.value > 0 &&
  selectedUtxos.value.length > 0 &&
  feeRate.value > 0 &&
  !bitmailInvalid.value &&
  !bitmailChecking.value
)

async function loadWallets() {
  try {
    wallets.value = await api.getSilntWallets(auth.inkey)
    // Single-wallet model: auto-select the user's wallet
    if (wallets.value.length && !selectedWallet.value) {
      selectedWallet.value = wallets.value[0].id
    }
  } catch (e) { console.error('[SendView] getSilntWallets failed:', e.status, e.detail || e.message) }
}

async function loadUtxos() {
  if (!selectedWallet.value) return
  loadingUtxos.value = true
  try {
    const res = await api.getUtxos(auth.inkey, selectedWallet.value)
    utxos.value = (res.utxos || [])
      .filter(u => u.utxo_state === 'unspent' && !u.frozen)
      .map(u => ({ ...u, selected: false }))
  } catch {}
  finally { loadingUtxos.value = false }
}

async function buildTransaction() {
  building.value = true; buildError.value = null; txResult.value = null
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) { buildError.value = 'Wallet keys not found locally. Go to Wallets and click "🔑 Recover Keys" on this wallet to restore them.'; building.value = false; return }
    const result = await api.buildTx(auth.adminkey, {
      wallet_id: selectedWallet.value,
      recipient: recipient.value.trim(),
      amount: amount.value,
      fee_rate: feeRate.value,
      utxos: selectedUtxos.value.map(u => ({
        txid: u.txid, vout: u.vout, amount: u.amount,
        priv_key_tweak: u.priv_key_tweak, pub_key: u.pub_key,
      })),
    }, keys.spendKey, keys.scanSecret)
    txResult.value = result
  } catch (e) { buildError.value = e.message }
  finally { building.value = false }
}

function friendlyBroadcastError(msg) {
  const m = (msg || '').toLowerCase()
  if (m.includes('missing inputs') || m.includes('bad-txns') || m.includes('inputs')) {
    return "Broadcast failed — the network rejected the transaction. Some inputs may already be spent or the mempool endpoint isn't configured correctly."
  }
  if (m.includes('502') || m.includes('bad gateway') || m.includes('unavailable') || m.includes('timeout')) {
    return "Broadcast failed — couldn't reach the broadcast service. Check the mempool endpoint configuration and try again."
  }
  if (m.includes('fee')) {
    return "Broadcast failed — the transaction fee was rejected by the network. Try a different fee rate."
  }
  return "Broadcast failed: " + msg
}

async function broadcastTransaction() {
  if (!txResult.value) return
  broadcasting.value = true; broadcastError.value = null
  try {
    const res = await api.broadcastTx(
      auth.adminkey,
      txResult.value.tx_hex,
      selectedWallet.value,
      selectedUtxos.value.map(u => ({ txid: u.txid, vout: u.vout })),
      { recipient: recipient.value, amount: amount.value, fee: txResult.value.fee }
    )
    broadcastDone.value = res.txid
    // If this send funded a Boltz swap, record the lockup outpoint so a refund
    // can be built later if the swap fails. Non-fatal if it errors.
    if (swapId.value) {
      try { await api.markSwapFunded(auth.adminkey, swapId.value, res.txid) }
      catch (e) { console.error('[swap] markSwapFunded failed:', e.detail || e.message) }
      // Mark this tx as a Lightning swap so Activity shows context.
      saveSwapTxLabel(res.txid, amount.value)
      // Wake the global swap poller (it sleeps when no swap is pending).
      try { window.__kickSwapPolling && window.__kickSwapPolling() } catch { /* ignore */ }
    }
    // Save the entered recipient locally (client-only) so Activity can show the
    // BitMail address. Only stores human-readable (@) addresses; never sent to server.
    saveTxRecipientLabel(res.txid, recipient.value)
    showConfirm.value = false
    // Reload UTXOs so spent ones immediately show as unconfirmed_spent
    await loadUtxos()
    // Spending needs no scan. Register this send so the GLOBAL poller watches
    // its confirmation and toasts from any screen, then finalizes UTXOs/balance.
    addPendingSend(res.txid, selectedWallet.value, amount.value)
    try { window.__kickSendWatch && window.__kickSendWatch() } catch { /* ignore */ }
  } catch (e) {
    broadcastError.value = friendlyBroadcastError(e.detail || e.message)
  }
  finally { broadcasting.value = false }
}

function reset() {
  txResult.value = null; broadcastDone.value = null; buildError.value = null
  broadcastError.value = null; recipient.value = ''; amount.value = null
  feeChoice.value = 'halfHourFee'; if (feeTiers.value?.halfHourFee) feeRate.value = feeTiers.value.halfHourFee
  utxos.value.forEach(u => u.selected = false)
}

function copyText(t) { navigator.clipboard.writeText(t).catch(() => {}) }

// Invalidate a built transaction when any input that affects it changes, so the
// stale hex/Broadcast can't be used and the Build button reappears for a rebuild.
watch(
  [recipient, amount, feeRate, selectedWallet, selectedUtxos],
  () => { if (txResult.value) { txResult.value = null; broadcastError.value = null } },
)

// A change to the recipient clears any prior BitMail-resolution result (the
// warning/block only applies to the exact value that was validated).
watch(recipient, () => { bitmailWarning.value = ''; bitmailInvalid.value = false })

async function loadMempoolUrl() {
  try {
    // Read from the same config the admin's System Settings writes to, so the
    // explorer link matches the configured network (e.g. signet), not mainnet.
    const cfg = await api.getBlindbitConfig(auth.adminkey)
    mempoolUrl.value = (cfg?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
  } catch (e) {
    // Fallback: try the generic config endpoint, then default
    try {
      const cfg2 = await api.getAppConfig(auth.inkey)
      mempoolUrl.value = (cfg2?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
    } catch (e2) {
      mempoolUrl.value = 'https://mempool.space'
    }
  }
}

function explorerTxUrl(txid) {
  // mempool.space uses /tx/<txid>; signet uses /signet/tx/<txid> which is
  // already encoded in the configured mempool_url for signet builds.
  return `${mempoolUrl.value}/tx/${txid}`
}

// ── Saved contacts (per-user private address book) ──
const contacts = ref([])
const showContacts = ref(false)
const bitmailWarning = ref('')      // friendly notice when a BitMail no longer resolves
const bitmailInvalid = ref(false)   // true → block Build/Send (BitMail didn't resolve)
const bitmailChecking = ref(false)  // resolution in flight
const saveContactLabel = ref('')
const savingContact = ref(false)
const recipientIsSaved = computed(() => {
  const v = recipient.value.trim().toLowerCase()
  return !!v && contacts.value.some(c => (c.value || '').trim().toLowerCase() === v)
})
async function loadContacts() {
  try { contacts.value = (await api.spContactsList(auth.inkey)).contacts || [] }
  catch { contacts.value = [] }
}
// Verify a recipient that is a BitMail (name@domain) resolves to a real DNS TXT
// record. Sets a friendly warning + blocks Build/Send on failure so the user
// isn't surprised by a cryptic "No txt record found" at send time. SP/on-chain
// addresses need no resolution and are always considered valid here.
async function validateBitmail(value) {
  const v = (value || '').trim()
  bitmailWarning.value = ''
  bitmailInvalid.value = false
  if (!v || !v.includes('@')) return
  bitmailChecking.value = true
  try {
    await api.resolveBip353(auth.inkey, v)
  } catch {
    bitmailWarning.value = `${v} could not be resolved — this BitMail is no longer valid. Ask the recipient for a current address.`
    bitmailInvalid.value = true
  } finally {
    bitmailChecking.value = false
  }
}
async function pickContact(e) {
  const v = e.target.value
  e.target.value = ''   // reset the dropdown to placeholder
  if (!v) return
  recipient.value = v
  await validateBitmail(v)
}
function onRecipientBlur() {
  // Validate typed BitMails when the user leaves the field.
  if (recipient.value.includes('@')) validateBitmail(recipient.value)
}

// QR scanning: fill the recipient from a scanned code and run the same
// validation the manual-entry path gets (BitMail resolution on '@' addresses).
const showScan = ref(false)
function onScanned(value) {
  recipient.value = (value || '').trim()
  showScan.value = false
  if (recipient.value.includes('@')) validateBitmail(recipient.value)
}
async function saveContact() {
  const v = recipient.value.trim()
  if (!v) return
  // Don't save a BitMail contact that doesn't resolve — verify first so we never
  // persist an already-dead address the user can't actually send to.
  if (v.includes('@')) {
    await validateBitmail(v)
    if (bitmailInvalid.value) {
      pushToast('This BitMail could not be resolved — contact not saved.', { type: 'error' })
      return
    }
  }
  savingContact.value = true
  try {
    await api.spContactCreate(auth.inkey, saveContactLabel.value.trim() || v, v)
    saveContactLabel.value = ''
    await loadContacts()
    pushToast('Contact saved.', { type: 'success' })
  } catch (e) {
    pushToast(e.detail || e.message || 'Could not save contact.', { type: 'error' })
  } finally { savingContact.value = false }
}
async function deleteContact(c) {
  try {
    await api.spContactDelete(auth.inkey, c.id)
    await loadContacts()
  } catch (e) { pushToast(e.detail || e.message || 'Could not remove.', { type: 'error' }) }
}

onMounted(async () => {
  await loadMempoolUrl()
  await loadFeeRates()
  await loadWallets()
  if (selectedWallet.value) await loadUtxos()
  loadContacts()
  startScanWatch()
})

// ── Scan-in-progress notice ───────────────────────────────────────────────
// A non-blocking heads-up: while the selected wallet is scanning, its balance
// and coin set can change under the user. Sends still work (the backend
// re-validates coins at build time), but this warns them a failure may just
// mean "coins moved — reselect".
const walletScanning = ref(false)
const scanNoticeDismissed = ref(false)
let scanWatchTimer = null
async function checkScanState() {
  if (!selectedWallet.value) { walletScanning.value = false; return }
  try {
    const p = await api.getScanProgress(auth.inkey, selectedWallet.value)
    walletScanning.value = !!(p && p.active)
  } catch { walletScanning.value = false }
}
function startScanWatch() {
  checkScanState()
  if (scanWatchTimer) clearInterval(scanWatchTimer)
  scanWatchTimer = setInterval(checkScanState, 5000)
}
watch(selectedWallet, () => { scanNoticeDismissed.value = false; checkScanState() })
onBeforeUnmount(() => { if (scanWatchTimer) clearInterval(scanWatchTimer) })
</script>

<template>
  <div>
    <div style="margin-bottom:24px">
      <h1>Send</h1>
      <p class="text-dim text-sm" style="margin-top:2px">Build and broadcast a Bitcoin transaction</p>
    </div>

    <div v-if="walletScanning && !scanNoticeDismissed" class="card"
         style="border:1px solid rgba(234,179,8,.4);background:rgba(234,179,8,.07);margin-bottom:20px">
      <div class="card-body" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <span style="font-size:18px">⏳</span>
        <div style="flex:1;min-width:220px">
          <strong>This wallet is scanning</strong>
          <div class="text-sm text-dim" style="margin-top:3px">
            Its balance and available coins may change while the scan runs. You can still send — if a build fails, refresh your UTXOs and reselect, then try again.
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="scanNoticeDismissed = true">Dismiss</button>
      </div>
    </div>

    <div v-if="isSwapFunding" class="card" style="border:1px solid rgba(34,197,94,.4);background:rgba(34,197,94,.06);margin-bottom:20px">
      <div class="card-body" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <span style="font-size:20px">⚡</span>
        <div style="flex:1;min-width:220px">
          <strong class="text-green">Funding a Lightning swap</strong>
          <div class="text-sm text-dim" style="margin-top:3px">
            You're sending on-chain to Boltz to receive <strong>{{ swapLnAmount ? swapLnAmount.toLocaleString() : '—' }} sats</strong> on Lightning. Send the exact amount and fee shown below; once Boltz sees the payment it pays your Lightning invoice. The recipient address and amount are pre-filled — review your coin selection before broadcasting.
          </div>
        </div>
      </div>
    </div>

    <div v-if="selectedWallet && !hasKeys" class="card" style="border:1px solid rgba(249,115,22,.5);background:rgba(249,115,22,.06);margin-bottom:20px">
      <div class="card-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:20px">🔑</span>
        <div style="flex:1;min-width:200px">
          <strong>Wallet keys not on this device</strong>
          <div class="text-dim text-sm" style="margin-top:2px">This wallet's spend and scan keys aren't stored here. Recover them before you can use this feature.</div>
        </div>
        <router-link :to="{ name: 'wallets', query: { recover: selectedWallet } }" class="btn btn-primary btn-sm">🔑 Recover Keys</router-link>
      </div>
    </div>

    <!-- Success state -->
    <div v-if="broadcastDone" class="card">
      <div class="card-body" style="text-align:center;padding:48px 24px">
        <div style="font-size:40px;margin-bottom:16px">✓</div>
        <h2 class="text-green" style="margin-bottom:8px">Transaction Broadcast!</h2>
        <p class="text-dim text-sm" style="margin-bottom:16px">Your transaction has been submitted to the network.</p>
        <div class="mono text-orange" style="font-size:11px;word-break:break-all;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:16px">
          {{ broadcastDone }}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <a :href="explorerTxUrl(broadcastDone)" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            🔍 View on block explorer
          </a>
          <button class="btn btn-ghost" @click="reset">Send Another</button>
        </div>
      </div>
    </div>

    <!-- Built TX (full-width, above the grid) so the Broadcast action is visible
         without scrolling past the form + UTXO list. Shown ABOVE the grid; the
         form/UTXO selection stay visible below for review. -->
    <template v-if="!broadcastDone">
      <div v-if="txResult" class="card" style="margin-bottom:20px;border:1px solid rgba(34,197,94,.4)">
        <div class="card-header">
          <h2>Built Transaction</h2>
          <span class="badge badge-green">Ready to broadcast</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="tx-detail-row"><span>Amount</span><span class="text-orange mono">{{ fmt(txResult.amount) }}</span></div>
          <div class="tx-detail-row"><span>Fee</span><span class="mono">{{ fmt(txResult.fee) }}</span></div>
          <div class="tx-detail-row"><span>Fee rate</span><span class="mono">{{ txResult.fee_rate_used }} sat/vB</span></div>
          <div class="tx-detail-row"><span>Change</span><span class="mono">{{ fmt(txResult.change) }}</span></div>
          <div class="tx-detail-row"><span>Size</span><span class="mono">~{{ txResult.vsize }} vB</span></div>
          <div class="hex-box">
            <div class="mono text-orange" style="word-break:break-all;font-size:10px;max-height:80px;overflow-y:auto">{{ txResult.tx_hex }}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" @click="copyText(txResult.tx_hex)">⎘ Copy Hex</button>
            <button class="btn btn-success" @click="showConfirm = true">↗ Broadcast</button>
          </div>
          <div v-if="broadcastError" class="alert alert-error">⚠ {{ broadcastError }}</div>
        </div>
      </div>

      <div class="send-grid">
      <!-- Left: form -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-header"><h2>Transaction Details</h2></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
            <div class="field">
              <label v-if="isSwapFunding">Swap destination (Boltz lockup — locked)</label>
              <label v-else>Recipient (payment code, on-chain address, or BitMail)</label>
              <div v-if="!isSwapFunding && contacts.length" class="flex gap-2 items-center" style="flex-wrap:wrap;margin-bottom:4px">
                <select class="input sc-pick" @change="pickContact($event)">
                  <option value="">— Saved contacts —</option>
                  <option v-for="c in contacts" :key="c.id" :value="c.value">{{ c.label }}{{ c.kind === 'bitmail' ? ' ✉' : '' }}</option>
                </select>
                <a href="#" class="text-xs text-dim" @click.prevent="showContacts = !showContacts">Manage</a>
              </div>
              <div class="recipient-row">
                <input
                  class="input"
                  v-model="recipient"
                  @blur="onRecipientBlur"
                  :readonly="isSwapFunding"
                  :style="isSwapFunding ? 'opacity:.75;cursor:not-allowed' : ''"
                  placeholder="sp1q… / tsp1q… / bc1q… / alice@domain.com" />
                <button
                  v-if="!isSwapFunding && SCAN_ENABLED"
                  type="button"
                  class="btn btn-ghost btn-sm scan-btn"
                  title="Scan a QR code"
                  @click="showScan = true">▦ Scan</button>
              </div>
              <div v-if="bitmailChecking" class="text-dim text-xs" style="margin-top:6px">Checking BitMail…</div>
              <div v-if="bitmailWarning" class="alert alert-warn" style="margin-top:6px">
                ⚠ {{ bitmailWarning }}
              </div>
              <div v-if="!isSwapFunding && recipient.trim() && !recipientIsSaved" class="flex gap-2 items-center" style="margin-top:6px;flex-wrap:wrap">
                <input class="input sc-label" v-model="saveContactLabel" placeholder="Label (e.g. Alice)" maxlength="40" />
                <button class="btn btn-ghost btn-sm" :disabled="savingContact || bitmailChecking || bitmailInvalid" @click="saveContact">★ Save contact</button>
              </div>
              <p v-if="isSwapFunding" class="text-dim text-xs" style="margin:4px 0 0">
                This must go to the exact Boltz address for your swap — it can't be changed. Editing or sending elsewhere would forfeit the funds without completing the swap.
              </p>
            </div>
            <div class="field">
              <label>Amount (sats)</label>
              <input
                class="input send-amt"
                v-model.number="amount"
                type="number"
                :readonly="isSwapFunding"
                :style="isSwapFunding ? 'opacity:.75;cursor:not-allowed' : ''"
                placeholder="100000" />
              <p v-if="isSwapFunding" class="text-dim text-xs" style="margin:4px 0 0">
                Exact amount required by Boltz (includes swap fees). Don't change it.
              </p>
            </div>
            <p class="text-dim text-xs" style="margin:4px 0 0">Select the coins to spend below — choose deliberately to avoid linking coins you'd rather keep separate.</p>
            <div class="field">
              <label>Fee Rate</label>
              <div v-if="feeTiers" class="fee-tiers">
                <button
                  v-for="(meta, key) in feeTierLabels"
                  :key="key"
                  type="button"
                  class="fee-tier"
                  :class="{ active: feeChoice === key }"
                  @click="selectFeeTier(key)"
                  :disabled="!feeTiers[key]"
                >
                  <span class="ft-label">{{ meta.label }}</span>
                  <span class="ft-rate">{{ feeTiers[key] }} sat/vB</span>
                  <span class="ft-hint">{{ meta.hint }}</span>
                </button>
                <button
                  type="button"
                  class="fee-tier"
                  :class="{ active: feeChoice === 'custom' }"
                  @click="selectFeeTier('custom')"
                >
                  <span class="ft-label">Custom</span>
                  <span class="ft-rate">{{ feeChoice === 'custom' ? feeRate + ' sat/vB' : '—' }}</span>
                  <span class="ft-hint">set manually</span>
                </button>
              </div>
              <input
                v-if="!feeTiers || feeChoice === 'custom'"
                class="input"
                v-model.number="feeRate"
                type="number" min="0.1" step="0.1"
                :placeholder="feeTiers ? 'sat/vB' : 'sat/vB (live rates unavailable)'"
                style="margin-top:8px"
              />
              <span v-if="feeTiers?.source === 'fallback'" class="text-dim text-xs">Live rates unavailable — showing defaults. You can set a custom rate.</span>
              <div v-if="estimatedFee > 0" class="fee-estimate" :class="{ over: feeExceedsFunds }">
                <span>Estimated fee</span>
                <span class="mono">≈ {{ fmt(estimatedFee) }}</span>
                <span class="fe-detail">{{ feeRate }} sat/vB · ~{{ estimatedVsize }} vB</span>
              </div>
              <div v-if="feeExceedsFunds" class="text-xs" style="color:#ff7b72;margin-top:4px">
                ⚠ Amount + fee ({{ fmt(Number(amount) + estimatedFee) }}) exceeds selected UTXOs ({{ fmt(selectedTotal) }}).
              </div>
            </div>
          </div>
        </div>

        <div v-if="buildError" class="alert alert-error">⚠ {{ buildError }}</div>

        <button v-if="!txResult" class="btn btn-primary" style="align-self:flex-start" :disabled="!canBuild || building || !hasKeys" @click="buildTransaction">
          <span v-if="building" class="spinner" style="border-top-color:#000"></span>
          {{ building ? 'Building…' : 'Build Transaction' }}
        </button>
      </div>

      <!-- Right: UTXO selection -->
      <div class="card">
        <div class="card-header">
          <h2>Select coins</h2>
          <span v-if="selectedUtxos.length" class="text-orange text-sm mono">{{ fmt(selectedTotal) }}</span>
        </div>
        <div class="card-body" style="padding:0">
          <div v-if="loadingUtxos" class="flex items-center gap-2 text-dim" style="padding:24px">
            <span class="spinner"></span> Loading…
          </div>
          <div v-else-if="!selectedWallet" class="text-dim text-sm" style="padding:24px">Select a wallet first.</div>
          <div v-else-if="!utxos.length" class="text-dim text-sm" style="padding:24px">No unspent coins. Scan the blockchain first.</div>
          <div v-else class="utxo-list">
            <label v-for="u in utxos" :key="u.txid+':'+u.vout" class="utxo-item" :class="{ selected: u.selected }">
              <input type="checkbox" v-model="u.selected" />
              <div class="utxo-info">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span class="mono text-orange" style="font-size:12px;font-weight:600">{{ fmt(u.amount) }}</span>
                  <span v-if="u.label" class="utxo-label-badge">🏷 {{ u.label }}</span>
                  <span v-else class="text-dim" style="font-size:10px;font-style:italic">unlabeled</span>
                  <span v-if="u.suspected_dust" class="utxo-dust-badge" title="Suspected dust attack">⚠ dust?</span>
                </div>
                <span class="mono text-dim" style="font-size:10px">{{ u.txid?.slice(0,10) }}…:{{ u.vout }}</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <!-- Mixed labels warning (privacy) -->
      <div v-if="mixedLabels" class="alert alert-warn" style="margin-top:14px;display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:18px;line-height:1">⚠</span>
        <div style="flex:1">
          <strong>Mixed coin labels selected</strong>
          <div class="text-sm text-dim" style="margin-top:2px">
            Combining coins from different identities in one transaction links them on-chain — chain analysis can deduce they belong to the same wallet, reducing your privacy. Currently mixing: <strong>{{ mixedLabels.join(', ') }}</strong>.
          </div>
        </div>
      </div>

      <!-- Multi-input caution (privacy) — softer, fires when 2+ inputs share a label -->
      <div v-else-if="multiInputSelected" class="alert alert-info" style="margin-top:14px;display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:18px;line-height:1">ⓘ</span>
        <div style="flex:1">
          <strong>Spending {{ selectedUtxos.length }} coins together</strong>
          <div class="text-sm text-dim" style="margin-top:2px">
            Any transaction that spends multiple UTXOs links them on-chain — observers can infer they belong to the same wallet. Spend fewer inputs, or send separately, if you'd rather not link these coins.
          </div>
        </div>
      </div>
    </div>

    </template>

    <!-- Manage saved contacts -->
    <div v-if="showContacts" class="modal-overlay" @click.self="showContacts = false">
      <div class="card modal" style="max-width:440px">
        <div class="flex items-center justify-between" style="margin-bottom:14px">
          <h2 style="font-size:18px">Saved contacts</h2>
          <button class="btn btn-ghost btn-sm" @click="showContacts = false">✕</button>
        </div>
        <div v-if="!contacts.length" class="text-dim text-sm">No saved contacts yet. Enter a recipient and tap “Save contact”.</div>
        <div v-for="c in contacts" :key="c.id" class="sc-row">
          <div style="min-width:0">
            <div class="text-sm"><b>{{ c.label }}</b> <span class="text-dim text-xs">{{ c.kind === 'bitmail' ? '✉ BitMail' : 'SP' }}</span></div>
            <div class="mono text-xs text-dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.value }}</div>
          </div>
          <div class="flex gap-2" style="flex-shrink:0">
            <button class="btn btn-ghost btn-sm" @click="recipient = c.value; showContacts = false">Use</button>
            <button class="btn btn-ghost btn-sm" @click="deleteContact(c)">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Broadcast confirm modal -->
    <div v-if="showConfirm && txResult" class="modal-overlay" @click.self="showConfirm = false">
      <div class="card modal" style="max-width:400px">
        <div class="card-header"><h2>Confirm Broadcast</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="tx-detail-row"><span>Amount</span><span class="text-orange mono">{{ fmt(txResult.amount) }}</span></div>
          <div class="tx-detail-row"><span>Recipient</span><span class="mono" style="font-size:11px;word-break:break-all">{{ txResult.recipient }}</span></div>
          <div class="tx-detail-row"><span>Fee</span><span class="mono">{{ fmt(txResult.fee) }} ({{ txResult.fee_rate_used }} sat/vB)</span></div>
          <div class="flex gap-2 justify-between" style="margin-top:8px">
            <button class="btn btn-ghost" @click="showConfirm = false">Cancel</button>
            <button class="btn btn-success" :disabled="broadcasting" @click="broadcastTransaction">
              <span v-if="broadcasting" class="spinner"></span>
              {{ broadcasting ? 'Broadcasting…' : 'Confirm Broadcast' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <QrScanModal :show="showScan" @close="showScan = false" @scanned="onScanned" />
  </div>
</template>

<style scoped>
.send-amt { max-width: 160px; align-self: flex-start; }
.recipient-row { display: flex; gap: 8px; align-items: stretch; }
.recipient-row .input { flex: 1 1 auto; min-width: 0; }
.recipient-row .scan-btn { flex: 0 0 auto; white-space: nowrap; }
.sc-pick { max-width: 220px; }
.sc-label { max-width: 200px; }
.sc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.sc-row:last-child { border-bottom: none; }
.fee-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px,1fr)); gap: 8px; }
.fee-tier {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  padding: 10px 12px; border: 1px solid var(--border, #1f2a27); border-radius: 10px;
  background: rgba(255,255,255,.02); cursor: pointer; text-align: left;
  transition: border-color .15s, background .15s;
}
.fee-tier:hover:not(:disabled) { border-color: var(--border-bright, #2c3d38); }
.fee-tier.active { border-color: var(--orange, #f7931a); background: rgba(247,147,26,.08); }
.fee-tier:disabled { opacity: .4; cursor: not-allowed; }
.fee-tier .ft-label { font-size: 13px; font-weight: 600; }
.fee-tier .ft-rate  { font-size: 12px; font-family: var(--mono, monospace); color: var(--orange, #f7931a); }
.fee-tier .ft-hint  { font-size: 10px; color: var(--dim, #8a9b94); }
.fee-estimate {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  margin-top: 10px; padding: 8px 12px; border-radius: 8px;
  background: rgba(247,147,26,.06); border: 1px solid rgba(247,147,26,.2);
  font-size: 13px;
}
.fee-estimate.over { background: rgba(255,123,114,.06); border-color: rgba(255,123,114,.3); }
.fee-estimate .mono { font-weight: 600; color: var(--orange, #f7931a); }
.fee-estimate .fe-detail { font-size: 11px; color: var(--dim, #8a9b94); margin-left: auto; }
.toggle-label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: var(--text-dim); }
.toggle-label input { accent-color: var(--orange); width: 14px; height: 14px; }
.tx-detail-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.tx-detail-row:last-child { border-bottom: none; }
.tx-detail-row span:first-child { color: var(--text-dim); }
.hex-box { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
.utxo-list { max-height: 400px; overflow-y: auto; }
.utxo-item { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background .1s; }
.utxo-item:last-child { border-bottom: none; }
.utxo-item:hover { background: var(--surface-2); }
.utxo-item.selected { background: var(--orange-bg); }
.utxo-item input { accent-color: var(--orange); width: 14px; height: 14px; flex-shrink: 0; }
.utxo-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }

.send-grid { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; align-items: start; }
@media (max-width: 768px) { .send-grid { grid-template-columns: 1fr; } }

.utxo-dust-badge {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono); font-size: 10px;
  background: rgba(249, 115, 22, 0.1); color: #f97316;
  border: 1px solid rgba(249, 115, 22, 0.4); border-radius: 3px;
  padding: 1px 6px; letter-spacing: .04em;
}
.utxo-label-badge {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono); font-size: 10px;
  background: var(--orange-bg); color: var(--orange);
  border: 1px solid var(--orange-dim); border-radius: 3px;
  padding: 1px 6px; letter-spacing: .04em;
}
.alert-warn {
  background: rgba(249, 115, 22, 0.08);
  border: 1px solid rgba(249, 115, 22, 0.3);
  color: var(--text);
  border-radius: var(--radius);
  padding: 12px 14px;
}
</style>
