<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { useAmount } from '@/composables/useAmount'
import { useCsvExport } from '@/composables/useCsvExport'
import { getTxRecipientLabel, getSwapTxLabel } from '@/stores/txlabels'

const auth   = useAuthStore()
const { fmt } = useAmount()
const route  = useRoute()
const router = useRouter()
const NETWORK_LOCK = import.meta.env.VITE_NETWORK_LOCK || null

const wallets        = ref([])
const selectedWallet = ref('')
const hasKeys = computed(() => !!(selectedWallet.value && auth.hasWalletKeys(selectedWallet.value)))
const transactions   = ref([])
const loading        = ref(false)
const error          = ref(null)
const expandedTxid   = ref(null)
const expandedDetail = ref(null)

const PAGE_SIZE = 12
const page      = ref(0)        // 0-based
const hasNext   = ref(false)    // true if a (PAGE_SIZE+1)th row came back

// Local (client-only) BitMail label for the expanded tx, if the user sent to a
// BitMail address from this device. Shown instead of the resolved SP address.
function recipientLabel() {
  return expandedTxid.value ? getTxRecipientLabel(expandedTxid.value) : null
}
const loadingDetail  = ref(false)

async function loadWallets() {
  try {
    const list = await api.getSilntWallets(auth.inkey, NETWORK_LOCK || 'mainnet')
    wallets.value = list || []
    // Honor wallet_id query param from URL
    const requestedId = route.query.wallet_id
    if (requestedId && wallets.value.find(w => w.id === requestedId)) {
      selectedWallet.value = requestedId
    } else if (wallets.value.length > 0) {
      selectedWallet.value = wallets.value[0].id
    }
  } catch (e) { error.value = e.message }
}

async function loadTxs() {
  if (!selectedWallet.value) return
  loading.value = true; error.value = null
  expandedTxid.value = null; expandedDetail.value = null
  try {
    // Fetch one extra row to know whether a next page exists, without needing a
    // total-count endpoint. Show PAGE_SIZE; the (PAGE_SIZE+1)th only signals more.
    const offset = page.value * PAGE_SIZE
    const res = await api.listWalletTransactions(auth.inkey, selectedWallet.value, PAGE_SIZE + 1, offset)
    const rows = res.transactions || []
    hasNext.value = rows.length > PAGE_SIZE
    transactions.value = rows.slice(0, PAGE_SIZE)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function nextPage() {
  if (!hasNext.value) return
  page.value++
  loadTxs()
}
function prevPage() {
  if (page.value === 0) return
  page.value--
  loadTxs()
}

watch(selectedWallet, () => {
  if (selectedWallet.value) {
    router.replace({ query: { ...route.query, wallet_id: selectedWallet.value } })
    page.value = 0          // reset to first page when switching wallets
    loadTxs()
  }
})

async function toggleExpand(tx) {
  if (expandedTxid.value === tx.txid) {
    expandedTxid.value = null
    expandedDetail.value = null
    return
  }
  expandedTxid.value = tx.txid
  expandedDetail.value = null
  loadingDetail.value = true
  try {
    expandedDetail.value = await api.getWalletTransaction(auth.inkey, selectedWallet.value, tx.txid)
  } catch (e) {
    expandedDetail.value = { error: e.message }
  } finally {
    loadingDetail.value = false
  }
}

function fmtAmount(sats) {
  if (sats === null || sats === undefined) return '—'
  return fmt(sats, { signed: true })
}

const { buildCsv, downloadCsv } = useCsvExport()
function exportCsv() {
  // Export the loaded transactions. Display/financial fields only.
  const cols = [
    { key: 'timestamp',    header: 'date',        map: t => (t.timestamp ? new Date(t.timestamp * 1000).toISOString() : '') },
    { key: 'kind',         header: 'direction' },
    { key: 'amount_sats',  header: 'amount_sats' },
    { key: 'txid',         header: 'txid' },
    { key: 'input_sum',    header: 'input_sum_sats',  map: t => (t.input_sum ?? '') },
    { key: 'output_sum',   header: 'output_sum_sats', map: t => (t.output_sum ?? '') },
    { key: 'input_count',  header: 'input_count',     map: t => (t.input_count ?? '') },
    { key: 'output_count', header: 'output_count',    map: t => (t.output_count ?? '') },
    { key: 'labels',       header: 'labels',          map: t => (t.labels || []).join('; ') },
  ]
  const rows = transactions.value
  if (!rows.length) return
  const stamp = new Date().toISOString().slice(0, 10)
  downloadCsv(`transactions-${stamp}.csv`, buildCsv(cols, rows))
}

function fmtAge(ts) {
  if (!ts) return '—'
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {})
}

const directionIcon = (kind) => {
  if (kind === 'receive') return '⬇'
  if (kind === 'send')    return '⬆'
  return '·'
}

const directionColor = (kind) => {
  if (kind === 'receive') return 'tx-receive'
  if (kind === 'send')    return 'tx-send'
  return ''
}

const directionLabel = (kind) => {
  if (kind === 'receive') return 'Received'
  if (kind === 'send')    return 'Sent'
  return kind
}

onMounted(() => {
  // The session-epoch keying on <router-view> remounts this view if keys arrive
  // later (re-login), so we can fetch unconditionally here — gating on inkey was
  // skipping the load during normal navigation and leaving Activity empty.
  loadWallets()
})
</script>

<template>
  <div class="page-wrap">
    <div class="page-inner">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h2 class="page-title">Transactions</h2>
        <button class="btn btn-ghost btn-sm" :disabled="!transactions.length" @click="exportCsv">⬇ Export CSV</button>
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

      <div v-if="wallets.length > 1" class="field" style="margin-bottom:14px">
        <label>Wallet</label>
        <select class="input" v-model="selectedWallet">
          <option v-for="w in wallets" :key="w.id" :value="w.id">
            {{ w.title || w.id.slice(0, 8) }} — {{ w.network }}
          </option>
        </select>
      </div>

      <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>

      <div v-if="loading" class="text-center text-dim" style="padding:30px">
        <span class="spinner"></span> Loading transactions…
      </div>

      <div v-else-if="!transactions.length" class="text-center text-dim" style="padding:30px">
        No transactions yet.
      </div>

      <div v-else class="tx-list">
        <div v-for="tx in transactions" :key="tx.txid" class="tx-row" :class="{ expanded: expandedTxid === tx.txid }">
          <div class="tx-row-main" @click="toggleExpand(tx)">
            <span class="tx-dir" :class="directionColor(tx.kind)">{{ directionIcon(tx.kind) }}</span>
            <div class="tx-meta">
              <div class="tx-line1">
                <span class="tx-kind">{{ directionLabel(tx.kind) }}</span>
                <span class="tx-amount mono" :class="directionColor(tx.kind)">{{ fmtAmount(tx.amount_sats) }} sats</span>
              </div>
              <div class="tx-line2">
                <span class="tx-age">{{ fmtAge(tx.timestamp) }}</span>
                <span class="mono text-dim tx-txid">{{ tx.txid.slice(0, 12) }}…{{ tx.txid.slice(-8) }}</span>
                <span v-if="tx.confirmed === false" class="badge badge-warn" title="Spending transaction not yet confirmed">⌛ Pending</span>
                <span v-if="getSwapTxLabel(tx.txid)" class="tx-label-badge" style="border-color:rgba(247,147,26,.4);color:var(--orange,#f7931a)">⚡ Lightning swap</span>
                <span v-for="(lbl, i) in tx.labels" :key="i" class="tx-label-badge">🏷 {{ lbl }}</span>
              </div>
            </div>
            <span class="tx-chevron">{{ expandedTxid === tx.txid ? '▾' : '▸' }}</span>
          </div>

          <div v-if="expandedTxid === tx.txid" class="tx-detail">
            <div v-if="loadingDetail" class="text-dim text-sm" style="padding:12px">
              <span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>
              Loading details…
            </div>
            <div v-else-if="expandedDetail && expandedDetail.error" class="alert alert-error" style="margin:8px 0">
              {{ expandedDetail.error }}
            </div>
            <div v-else-if="expandedDetail" class="tx-detail-content">
              <div class="tx-detail-row">
                <span class="tx-detail-label">Txid:</span>
                <span class="mono text-xs tx-detail-value">{{ tx.txid }}</span>
                <button class="btn btn-ghost btn-sm btn-icon" @click="copyText(tx.txid)" title="Copy">⎘</button>
                <a :href="expandedDetail.explorer_url" target="_blank" class="btn btn-ghost btn-sm btn-icon" title="Open in mempool.space">↗</a>
              </div>
              <div class="tx-detail-row" v-if="expandedDetail.fee_sats !== null && expandedDetail.fee_sats !== undefined">
                <span class="tx-detail-label">Fee:</span>
                <span class="mono">{{ expandedDetail.fee_sats.toLocaleString() }} sats</span>
              </div>
              <div class="tx-detail-row">
                <span class="tx-detail-label">Status:</span>
                <span v-if="expandedDetail.confirmed === true" class="badge badge-success">✓ confirmed (block {{ expandedDetail.block_height }})</span>
                <span v-else-if="expandedDetail.confirmed === false" class="badge badge-warn">⌛ unconfirmed</span>
                <span v-else class="text-dim">unknown</span>
              </div>
              <div class="tx-detail-row">
                <span class="tx-detail-label">Date:</span>
                <span>{{ fmtDate(tx.timestamp) }}</span>
              </div>

              <div v-if="expandedDetail.recipients && expandedDetail.recipients.length" class="tx-detail-section">
                <div class="tx-detail-section-title">Recipients</div>
                <div v-for="(r, i) in expandedDetail.recipients" :key="i" class="tx-detail-recipient">
                  <span v-if="i === 0 && recipientLabel()" class="recipient-label">
                    <span class="mono text-xs">⌖ {{ recipientLabel() }}</span>
                    <span class="mono text-dim" style="font-size:10px">{{ r.address || '(no address)' }}</span>
                  </span>
                  <span v-else class="mono text-xs">{{ r.address || '(no address)' }}</span>
                  <span class="mono text-orange">{{ fmt(r.amount) }}</span>
                </div>
              </div>

              <div v-if="expandedDetail.own_outputs && expandedDetail.own_outputs.length" class="tx-detail-section">
                <div class="tx-detail-section-title">Outputs to this wallet</div>
                <div v-for="o in expandedDetail.own_outputs" :key="o.vout" class="tx-detail-output">
                  <span class="mono text-xs">vout {{ o.vout }}</span>
                  <span class="mono text-orange">{{ o.amount.toLocaleString() }} sats</span>
                  <span v-if="o.label" class="tx-label-badge">🏷 {{ o.label }}</span>
                  <span v-if="o.label_index === 1" class="badge badge-blue" title="Change returned to your own wallet">↩ Change</span>
                  <span v-else-if="o.label_index" class="badge badge-dim">m={{ o.label_index }}</span>
                </div>
              </div>

              <div v-if="expandedDetail.spent_inputs && expandedDetail.spent_inputs.length" class="tx-detail-section">
                <div class="tx-detail-section-title">Inputs spent from this wallet</div>
                <div v-for="i in expandedDetail.spent_inputs" :key="i.txid + ':' + i.vout" class="tx-detail-output">
                  <span class="mono text-xs">{{ i.txid.slice(0, 10) }}…:{{ i.vout }}</span>
                  <span class="mono text-orange">{{ i.amount.toLocaleString() }} sats</span>
                  <span v-if="i.label" class="tx-label-badge">🏷 {{ i.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="!loading && transactions.length && (page > 0 || hasNext)"
           class="flex" style="align-items:center;justify-content:space-between;margin-top:14px;gap:10px">
        <button class="btn btn-ghost btn-sm" :disabled="page === 0" @click="prevPage">← Newer</button>
        <span class="text-dim text-xs">Page {{ page + 1 }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="!hasNext" @click="nextPage">Older →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tx-list { display: flex; flex-direction: column; gap: 6px; }

.tx-row {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  transition: border-color .15s;
}
.tx-row:hover { border-color: var(--orange-dim); }
.tx-row.expanded { border-color: var(--orange-dim); }

.tx-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
}

.tx-dir {
  font-size: 22px;
  font-weight: 700;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}
.tx-receive { color: #10b981; }
.tx-send    { color: #f97316; }

.tx-meta  { flex: 1; min-width: 0; }
.tx-line1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.tx-kind  { font-size: 13px; color: var(--text); font-weight: 500; }
.tx-amount{ font-size: 14px; font-weight: 600; }

.tx-line2 {
  display: flex; align-items: center; gap: 10px;
  margin-top: 3px; flex-wrap: wrap;
}
.tx-age   { font-size: 11px; color: var(--text-dim); }
.tx-txid  { font-size: 10px; opacity: .7; }

.tx-label-badge {
  font-family: var(--font-mono); font-size: 10px;
  background: var(--orange-bg); color: var(--orange);
  border: 1px solid var(--orange-dim); border-radius: 3px;
  padding: 1px 6px;
}

.tx-chevron { color: var(--text-dim); font-size: 14px; flex-shrink: 0; }

.tx-detail {
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.tx-detail-content { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.tx-detail-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px;
}
.tx-detail-label { color: var(--text-dim); min-width: 60px; }
.tx-detail-value { word-break: break-all; }

.tx-detail-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.tx-detail-section-title {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: .05em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.recipient-label { display: flex; flex-direction: column; gap: 1px; }
.tx-detail-recipient, .tx-detail-output {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0; flex-wrap: wrap;
}

.badge-success { background: rgba(16,185,129,.1); color: #10b981; border: 1px solid rgba(16,185,129,.4); }
.badge-warn    { background: rgba(249,115,22,.1); color: #f97316; border: 1px solid rgba(249,115,22,.4); }
.badge-dim     { background: rgba(148,163,184,.1); color: #94a3b8; border: 1px solid rgba(148,163,184,.4); font-size: 9px; padding: 1px 6px; }
.badge-blue    { background: rgba(59,130,246,.12); color: #60a5fa; border: 1px solid rgba(59,130,246,.4); font-size: 9px; padding: 1px 6px; }

@media (max-width: 640px) {
  .tx-line1 { flex-direction: column; align-items: flex-start; gap: 2px; }
}
</style>
