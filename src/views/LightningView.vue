<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { swapCompletedAt } from '@/stores/swapevents'

const auth = useAuthStore()

const tab          = ref('receive')        // 'receive' | 'send'
const balanceMsat  = ref(null)
const walletName   = ref('')
const loading      = ref(true)
const error        = ref('')

const balanceSats = computed(() =>
  balanceMsat.value == null ? null : Math.floor(balanceMsat.value / 1000)
)

// ── Receive ───────────────────────────────────────────────────────────────────
const rcvAmount    = ref(null)
const rcvMemo      = ref('')
const rcvExpiryMin = ref(60)               // invoice expiry in minutes (user-set)
const rcvInvoice   = ref('')
const rcvHash      = ref('')
const rcvPaid      = ref(false)
const creating     = ref(false)
let   pollTimer     = null

async function createInvoice() {
  error.value = ''
  rcvInvoice.value = ''; rcvPaid.value = false
  const amt = Number(rcvAmount.value)
  if (!amt || amt <= 0) { error.value = 'Enter an amount in sats.'; return }
  creating.value = true
  try {
    const expirySecs = Math.max(60, Math.round(Number(rcvExpiryMin.value || 60) * 60))
    const res = await api.lnCreateInvoice(auth.inkey, { amount: amt, memo: rcvMemo.value, expiry: expirySecs })
    rcvInvoice.value = res.bolt11 || res.payment_request
    rcvHash.value = res.payment_hash
    startPolling()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not create invoice'
  } finally {
    creating.value = false
  }
}

function startPolling() {
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!rcvHash.value) return
    try {
      const st = await api.lnPaymentStatus(auth.inkey, rcvHash.value)
      if (st.paid) {
        rcvPaid.value = true
        clearInterval(pollTimer)
        await loadBalance()
        await loadPayments()
      }
    } catch { /* keep polling */ }
  }, 3000)
}

function copyInvoice() {
  if (rcvInvoice.value) navigator.clipboard?.writeText(rcvInvoice.value)
}

function resetReceive() {
  rcvInvoice.value = ''; rcvHash.value = ''; rcvPaid.value = false
  rcvAmount.value = null; rcvMemo.value = ''
  // keep rcvExpiryMin — it's a user preference, not per-invoice state
  clearInterval(pollTimer)
}

// ── Send ───────────────────────────────────────────────────────────────────────
const sendBolt11   = ref('')
const decoded      = ref(null)
const decoding     = ref(false)
const paying       = ref(false)
const sendResult   = ref('')

const decodedSats = computed(() =>
  decoded.value?.amount_msat ? Math.floor(decoded.value.amount_msat / 1000) : null
)

async function decodeInvoice() {
  error.value = ''; decoded.value = null; sendResult.value = ''
  const inv = sendBolt11.value.trim()
  if (!inv) return
  decoding.value = true
  try {
    decoded.value = await api.lnDecodeInvoice(auth.inkey, inv)
  } catch (e) {
    error.value = e.detail || e.message || 'Could not decode invoice'
  } finally {
    decoding.value = false
  }
}

async function payInvoice() {
  error.value = ''; sendResult.value = ''
  const inv = sendBolt11.value.trim()
  if (!inv) return
  paying.value = true
  try {
    const res = await api.lnPayInvoice(auth.adminkey, inv)
    sendResult.value = 'Payment sent.'
    sendBolt11.value = ''; decoded.value = null
    await loadBalance()
    await loadPayments()
  } catch (e) {
    error.value = e.detail || e.message || 'Payment failed'
  } finally {
    paying.value = false
  }
}

// ── Balance + history ──────────────────────────────────────────────────────────
async function loadBalance() {
  try {
    const w = await api.lnGetWallet(auth.inkey)
    balanceMsat.value = w.balance ?? 0
    walletName.value = w.name || ''
  } catch (e) {
    error.value = e.detail || e.message || 'Could not load wallet'
  }
}

const payments = ref([])
async function loadPayments() {
  try {
    const list = await api.lnListPayments(auth.inkey, 25)
    payments.value = Array.isArray(list) ? list : (list.data || [])
  } catch { payments.value = [] }
}

function fmtSats(msat) {
  if (msat == null) return '—'
  return Math.floor(Math.abs(msat) / 1000).toLocaleString()
}

const refreshing = ref(false)
async function refreshAll() {
  refreshing.value = true
  try {
    await loadBalance()
    await loadPayments()
  } finally {
    refreshing.value = false
  }
}

// Refresh when the tab/window regains focus (e.g. user comes back after a swap
// completed in the background). Cheap, event-driven — no constant polling.
function onFocus() { if (auth.isLoggedIn) refreshAll() }

// When a swap completes anywhere in the app, the global poller bumps
// swapCompletedAt — refresh balance + activity so the swapped-in funds show
// immediately, even if we're sitting on this screen. No polling involved.
watch(swapCompletedAt, () => {
  if (auth.isLoggedIn) refreshAll()
})

onMounted(async () => {
  window.addEventListener('focus', onFocus)
  // Only fetch once we actually have a usable key. Right after a re-login (e.g.
  // following an expired session) inkey can be momentarily empty when this view
  // mounts; fetching then would error and leave the screen looking dead. The
  // watch below picks it up as soon as auth is ready.
  if (auth.isLoggedIn && auth.inkey) {
    loading.value = true
    await loadBalance()
    await loadPayments()
    loading.value = false
  }
})

// Refresh as soon as auth/keys become available. Covers the case where this
// view mounts before the session has fully restored its keys (re-login after an
// expired session) — without this, the view stays blank until a manual reload.
watch(() => auth.isLoggedIn && auth.inkey, (ready) => {
  if (ready) refreshAll()
})

onBeforeUnmount(() => {
  clearInterval(pollTimer)
  window.removeEventListener('focus', onFocus)
})
</script>

<template>
  <div>
    <div style="margin-bottom:24px">
      <h1>Lightning</h1>
      <p class="text-dim text-sm" style="margin-top:2px">
        Send and receive instant payments over the Lightning Network
      </p>
    </div>

    <!-- Balance -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div class="text-dim text-xs">Lightning balance{{ walletName ? ' · ' + walletName : '' }}</div>
          <div style="font-size:26px;font-weight:600" class="mono text-orange">
            <span v-if="loading">…</span>
            <span v-else>{{ balanceSats != null ? balanceSats.toLocaleString() : '—' }}</span>
            <span class="text-dim" style="font-size:14px;font-weight:400"> sats</span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="refreshing || loading" @click="refreshAll" title="Refresh balance & activity">
          <span v-if="refreshing">Refreshing…</span>
          <span v-else>↻ Refresh</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-warn" style="margin-bottom:16px">{{ error }}</div>

    <!-- Tabs -->
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-sm" :class="tab === 'receive' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'receive'">Receive</button>
      <button class="btn btn-sm" :class="tab === 'send' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'send'">Send</button>
    </div>

    <!-- RECEIVE -->
    <div v-if="tab === 'receive'" class="card">
      <div class="card-header"><h2>Receive</h2></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
        <template v-if="!rcvInvoice">
          <div class="field">
            <label>Amount (sats)</label>
            <input class="input ln-num" type="number" v-model.number="rcvAmount" min="1" placeholder="10000" />
          </div>
          <div class="field">
            <label>Memo (optional)</label>
            <input class="input ln-memo" v-model="rcvMemo" maxlength="200" placeholder="What's this for?" />
          </div>
          <div class="field">
            <label>Expiry (minutes)</label>
            <input class="input ln-num" type="number" v-model.number="rcvExpiryMin" min="1" placeholder="60" />
            <span class="text-dim text-xs">How long the invoice stays payable. Default 60 minutes.</span>
          </div>
          <button class="btn btn-primary" style="align-self:flex-start" :disabled="creating" @click="createInvoice">
            <span v-if="creating">Creating…</span>
            <span v-else>Create invoice</span>
          </button>
        </template>

        <template v-else>
          <div v-if="rcvPaid" class="alert alert-info" style="margin:0;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.08)">
            <strong class="text-green">✓ Paid</strong> — {{ rcvAmount ? rcvAmount.toLocaleString() : '' }} sats received.
          </div>
          <div v-else class="text-dim text-sm">Waiting for payment… (invoice expires in {{ rcvExpiryMin }} minute{{ rcvExpiryMin == 1 ? '' : 's' }})</div>

          <div style="word-break:break-all;font-family:var(--font-mono);font-size:12px;background:var(--bg-elev,rgba(255,255,255,.03));padding:12px;border-radius:var(--radius);border:1px solid var(--border)">
            {{ rcvInvoice }}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" @click="copyInvoice">Copy invoice</button>
            <button class="btn btn-ghost btn-sm" @click="resetReceive">New invoice</button>
          </div>
        </template>
      </div>
    </div>

    <!-- SEND -->
    <div v-else class="card">
      <div class="card-header"><h2>Send</h2></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="field">
          <label>Lightning invoice (bolt11)</label>
          <input class="input ln-invoice" v-model="sendBolt11" placeholder="lnbc… / lnbcrt…" @blur="decodeInvoice" />
        </div>

        <div v-if="decoding" class="text-dim text-sm">Decoding…</div>
        <div v-if="decoded" class="alert alert-info" style="margin:0">
          <div><strong>{{ decodedSats != null ? decodedSats.toLocaleString() + ' sats' : 'Amount in invoice' }}</strong></div>
          <div v-if="decoded.description" class="text-dim text-sm" style="margin-top:2px">{{ decoded.description }}</div>
        </div>

        <button class="btn btn-primary" style="align-self:flex-start" :disabled="paying || !sendBolt11" @click="payInvoice">
          <span v-if="paying">Paying…</span>
          <span v-else>Pay invoice</span>
        </button>
        <div v-if="sendResult" class="alert alert-info" style="margin:0;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.08)">
          <strong class="text-green">{{ sendResult }}</strong>
        </div>
      </div>
    </div>

    <!-- Recent payments -->
    <div class="card" style="margin-top:20px">
      <div class="card-header"><h2>Recent activity</h2></div>
      <div class="card-body">
        <div v-if="!payments.length" class="text-dim text-sm">No Lightning payments yet.</div>
        <div v-for="p in payments" :key="p.payment_hash || p.checking_id"
             style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {{ p.memo || p.description || (p.amount < 0 ? 'Sent' : 'Received') }}
            </div>
            <div class="text-dim text-xs">{{ (p.pending ? 'pending' : 'settled') }}</div>
          </div>
          <div class="mono" :class="p.amount < 0 ? '' : 'text-green'" style="font-size:13px;white-space:nowrap">
            {{ p.amount < 0 ? '−' : '+' }}{{ fmtSats(p.amount) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ln-num  { max-width: 140px; align-self: flex-start; }
.ln-memo { max-width: 280px; align-self: flex-start; }
.ln-invoice { max-width: 480px; align-self: flex-start; }
</style>
