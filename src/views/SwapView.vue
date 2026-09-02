<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
// From derivationPaths, not spKeys: this view only shows the path, and spKeys
// would pull the BIP-39 wordlist and secp256k1 into the bundle for a string.
import { refundDerivationPath } from '@/services/derivationPaths'
import * as api from '@/api'

const NETWORK = import.meta.env.VITE_NETWORK_LOCK || 'regtest'

const router = useRouter()
const auth = useAuthStore()

const wallets       = ref([])              // LNbits wallets (receive LN) — id + name
const selectedWallet = ref('')             // selected LNbits wallet id (Boltz invoice)
const silntWalletId = ref('')              // siLNt SP wallet id (funds the swap via Send)
const amount        = ref(null)            // sats to receive on Lightning
const refundAddress = ref('')              // on-chain (P2WPKH) refund destination
const derivedRefund = ref('')              // this wallet's own BIP-84 address, when held on this device
const useOwnRefund  = ref(true)            // false → the user chose to type a different address
const limits        = ref(null)            // { min, max } from Boltz pair config
const loading       = ref(false)
const creating      = ref(false)
const error         = ref('')

// Refund destination is needed so a FAILED swap can be refunded to an address
// the user controls. Must be a plain on-chain address (P2WPKH bc1q…/bcrt1q…),
// NOT a Silent Payment address: a Boltz refund is a Taproot SCRIPT-path spend,
// and BIP-352 can't derive a shared secret from one — nobody holds a private
// key for that MuSig2-aggregate output key (see services/spKeys.ts).
//
// Prefilled with the wallet's OWN BIP-84 address so the user doesn't have to
// paste one in from another wallet: a typo there loses the refund on the exact
// path that has already gone wrong. It's the standard m/84'/…/0/0 path, so the
// same seed sweeps it in any wallet, not just this one. Falls back to manual
// entry when this device doesn't hold the wallet's keys.
//
// Thrilla can't spend that address itself: the key for it lives in the seed,
// and only the Silent Payments scan/spend keys are kept on the device. So the
// path is surfaced wherever the address is — restoring the same 12 words in any
// BIP-84 wallet (Sparrow, Electrum) sweeps a refund without Thrilla involved.
const refundPath = computed(() => refundDerivationPath(NETWORK))

const refundIsSp = computed(() => /^(sp1|tsp1)/i.test((refundAddress.value || '').trim()))
const refundValid = computed(() => {
  const r = (refundAddress.value || '').trim()
  return !!r && !refundIsSp.value
})

const minAmount = computed(() => limits.value?.min ?? null)
const maxAmount = computed(() => limits.value?.max ?? null)

const amountValid = computed(() => {
  const a = Number(amount.value)
  if (!a || a <= 0) return false
  if (minAmount.value && a < minAmount.value) return false
  if (maxAmount.value && a > maxAmount.value) return false
  return true
})

const canCreate = computed(() =>
  !!selectedWallet.value && amountValid.value && refundValid.value && !creating.value
)

async function loadWallets() {
  loading.value = true
  try {
    // The Lightning-receiving wallet must be an LNbits wallet (Boltz creates the
    // invoice against it), and LNbits wallets carry the human-readable name.
    // (siLNt SP wallets are separate records and don't hold the LN balance/name.)
    const data = await api.getLnbitsWallets(auth.token)
    wallets.value = (data || []).map(w => ({ id: w.id, name: w.name }))
    if (wallets.value.length && !selectedWallet.value) {
      // Default to the wallet the session is using, else the first.
      selectedWallet.value = auth.walletId || wallets.value[0].id
    }
    // Also resolve the siLNt SP wallet (the one that holds spendable SP UTXOs);
    // it funds the swap via the Send flow and uses a DIFFERENT id space than the
    // LNbits wallet above. Single-wallet model → take the first SP wallet.
    try {
      const sp = await api.getSilntWallets(auth.inkey)
      const list = sp.wallets || sp || []
      if (list.length) silntWalletId.value = list[0].id
      await loadRefundAddress()
    } catch { /* non-fatal; handled at handoff */ }
  } catch (e) {
    error.value = e.detail || e.message || 'Failed to load wallets'
  } finally {
    loading.value = false
  }
}

// The refund address is derived from the seed at wallet create/recover time and
// kept with that wallet's keys, so it's only available on a device that holds
// them. An empty result is normal (keys on another device, or a wallet made
// before refund addresses were derived) — the field then stays manual.
async function loadRefundAddress() {
  if (!silntWalletId.value) return
  let addr = ''
  try {
    addr = await auth.getRefundAddress(silntWalletId.value)
  } catch {
    addr = ''
  }
  derivedRefund.value = addr
  // Don't clobber an address the user has taken over the field to type.
  if (addr && useOwnRefund.value) refundAddress.value = addr
}

// Explicit opt-out, so sending a refund somewhere else stays a deliberate act
// rather than an empty box the user fills in by default.
function useDifferentRefund() {
  useOwnRefund.value = false
  refundAddress.value = ''
}

function useWalletRefund() {
  useOwnRefund.value = true
  refundAddress.value = derivedRefund.value
}

async function loadLimits() {
  try {
    const lim = await api.swapLimits(auth.adminkey)
    if (lim && (lim.min || lim.max)) {
      limits.value = { min: lim.min, max: lim.max }
    }
  } catch {
    // Non-fatal: skip min/max validation; the backend/Boltz enforces limits.
    limits.value = null
  }
}

async function createSwap() {
  error.value = ''
  if (!canCreate.value) return
  creating.value = true
  try {
    // Create the v2 submarine swap (chain → lightning) via siLNt backend.
    // Returns the on-chain address + expected_amount we must pay. The refund
    // KEY is generated and held by the backend; the refund ADDRESS below is
    // where a failed swap pays out, so it has to come from us.
    const swap = await api.createSwapIn(auth.adminkey, {
      wallet_id: selectedWallet.value,
      amount: Number(amount.value),
      refund_address: refundAddress.value.trim(),
      silnt_wallet_id: silntWalletId.value || undefined,
      network: NETWORK,
    })

    // Register this swap's invoice hash so the global LN-receive poller never
    // toasts "Received" for the swap credit (the swap-complete toast covers it).
    try { window.__registerSwapHash && window.__registerSwapHash(swap.payment_hash) } catch { /* ignore */ }

    // The exact on-chain amount to send (incl. swap fees) is what Boltz expects.
    const payAddress = swap.address
    const payAmount  = swap.expected_amount

    if (!payAddress || !payAmount) {
      throw new Error('Swap created but missing on-chain payment details')
    }

    // Hand off to the normal Send flow, pre-filled, so the user funds the swap
    // from their SP UTXOs using the existing send path (UTXO selection, fee
    // tiers, and the mixed-input privacy warning all apply).
    router.push({
      name: 'send',
      query: {
        // SendView spends SP UTXOs, so it needs the siLNt wallet id (different
        // id space than the LNbits wallet used for the Boltz invoice above).
        wallet_id: silntWalletId.value || auth.walletId,
        address:   payAddress,
        amount:    String(payAmount),
        swap_id:   swap.swap_id,
        swap_ln:   String(amount.value),
      },
    })
  } catch (e) {
    error.value = e.detail || e.message || 'Failed to create swap'
  } finally {
    creating.value = false
  }
}

// ── Refundable swaps (failed / timed-out swap-ins) ────────────────────────────
const refundable    = ref([])
const refundingId   = ref('')
const refundMsg     = ref('')
const refundResult  = ref(null)   // { txid, swap_id } after a successful refund broadcast
const refundAddrOverride = ref({})   // { [swap_id]: address } optional overrides

// Full swap history (all statuses) with delete for finished ones.
const swapHistory   = ref([])
const deletingId    = ref('')

async function loadSwapHistory() {
  try {
    const res = await api.listSwaps(auth.adminkey)
    swapHistory.value = res.swaps || []
  } catch {
    swapHistory.value = []
  }
}

async function deleteSwapRow(s) {
  if (!s.deletable) return
  deletingId.value = s.swap_id
  try {
    await api.deleteSwap(auth.adminkey, s.swap_id)
    await loadSwapHistory()
    await loadRefundable()
  } catch (e) {
    refundMsg.value = e.detail || e.message || 'Could not delete swap'
  } finally {
    deletingId.value = ''
  }
}

function statusLabel(s) {
  return { completed: 'Completed', refunded: 'Refunded', expired: 'Expired',
           funded: 'Funded', created: 'Awaiting funding', failed: 'Failed' }[s] || s
}

// Resume funding a 'created' swap from history — routes into the same Send
// funding flow used right after creation, pre-filled from the swap's stored
// lockup address + expected amount. No need to delete and start over.
function fundSwapRow(s) {
  if (!s.fundable || !s.address || !s.expected_amount) return
  router.push({
    name: 'send',
    query: {
      wallet_id: s.silnt_wallet_id || auth.walletId,
      address:   s.address,
      amount:    String(s.expected_amount),
      swap_id:   s.swap_id,
      swap_ln:   String(s.amount || ''),
    },
  })
}

async function loadRefundable() {
  try {
    const res = await api.listRefundableSwaps(auth.adminkey)
    refundable.value = res.refundable || []
  } catch {
    refundable.value = []   // non-fatal
  }
}

function isSpAddr(a) { return /^(sp1|tsp1)/i.test((a || '').trim()) }

async function doRefund(swap) {
  refundMsg.value = ''
  refundResult.value = null
  // Per-swap override address (from the field in the refundable card). If blank,
  // the backend uses the refund_address stored when the swap was created.
  const addr = (refundAddrOverride.value[swap.swap_id] || '').trim()
  if (addr && isSpAddr(addr)) {
    refundMsg.value = 'Refund address must be a plain on-chain address, not a Silent Payment (sp1…) address.'
    return
  }
  refundingId.value = swap.swap_id
  try {
    const res = await api.refundSwap(auth.adminkey, swap.swap_id, addr ? { address: addr } : {})
    // `refunded_to` is where the backend actually paid out (the override above,
    // or the address stored with the swap). Kept so the result can tell the user
    // how to reach the funds when they landed on this wallet's own address.
    refundResult.value = { txid: res.txid, swap_id: swap.swap_id, refundedTo: res.refunded_to || '' }
    await loadRefundable()
    await loadSwapHistory()
  } catch (e) {
    const msg = e.detail || e.message || 'Refund failed'
    // If it was already refunded (e.g. the auto-refund task got there first),
    // don't show a scary error — just refresh so the stale card drops off.
    if (/refunded|not refundable|already/i.test(msg)) {
      refundMsg.value = 'This swap was already refunded.'
    } else {
      refundMsg.value = msg
    }
    await loadRefundable()
    await loadSwapHistory()
  } finally {
    refundingId.value = ''
  }
}

const mempoolUrl = ref('')
async function loadMempoolUrl() {
  try {
    const cfg = await api.getBlindbitConfig(auth.adminkey)
    mempoolUrl.value = (cfg?.mempool_url || 'https://mempool.space').replace(/\/+$/, '')
  } catch {
    mempoolUrl.value = 'https://mempool.space'
  }
}
function refundExplorerUrl(txid) { return `${mempoolUrl.value || 'https://mempool.space'}/tx/${txid}` }
function copyText(t) { navigator.clipboard.writeText(t).catch(() => {}) }

// Refresh the refundable list + history periodically while on this page, so a
// swap that gets auto-refunded in the background disappears on its own instead
// of lingering as a stale, clickable card. 20s is gentle (refundable swaps are
// rare and the auto-refund task runs on its own cadence).
let refundRefreshTimer = null

onMounted(async () => {
  await loadWallets()
  await loadLimits()
  await loadMempoolUrl()
  await loadRefundable()
  await loadSwapHistory()
  refundRefreshTimer = setInterval(async () => {
    // Guard: don't run after logout, and never let a rejection go unhandled
    // (an unhandled rejection every 20s can wedge the app / other timers).
    if (!auth.isLoggedIn) return
    try {
      await loadRefundable()
      await loadSwapHistory()
    } catch (e) {
      // swallow — transient; next tick retries
    }
  }, 20000)
})

onBeforeUnmount(() => {
  if (refundRefreshTimer) clearInterval(refundRefreshTimer)
})
</script>

<template>
  <div>
    <div style="margin-bottom:24px">
      <h1>Swap to Lightning</h1>
      <p class="text-dim text-sm" style="margin-top:2px">
        Move on-chain Silent Payment funds into your Lightning balance via Boltz
      </p>
    </div>

    <div v-if="refundable.length" class="card" style="border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.06);margin-bottom:20px">
      <div class="card-header"><h2>⚠ Refundable swaps</h2></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
        <p class="text-sm text-dim" style="margin:0">
          These swaps failed or timed out. Refund returns your on-chain funds to the
          address saved with the swap — or enter a different on-chain address below to override it.
          <template v-if="derivedRefund">
            A refund to your wallet's own address (<code>{{ refundPath }}</code>) doesn't
            re-enter your Silent Payments balance; restore your seed in a BIP-84 wallet to spend it.
          </template>
        </p>
        <div v-for="s in refundable" :key="s.swap_id"
             style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="font-size:13px">
              <div><strong>{{ (s.amount || 0).toLocaleString() }} sats</strong></div>
              <div class="text-dim text-xs">{{ s.reason }}</div>
            </div>
            <button class="btn btn-primary btn-sm"
                    :disabled="refundingId === s.swap_id || isSpAddr(refundAddrOverride[s.swap_id])"
                    @click="doRefund(s)">
              <span v-if="refundingId === s.swap_id">Refunding…</span>
              <span v-else>Refund</span>
            </button>
          </div>
          <input
            v-model="refundAddrOverride[s.swap_id]"
            class="input sw-addr"
            :style="`font-family:var(--font-mono);font-size:12px${isSpAddr(refundAddrOverride[s.swap_id]) ? ';border-color:var(--red)' : ''}`"
            placeholder="Refund to (optional) — leave blank to use the saved address"
          />
          <div v-if="isSpAddr(refundAddrOverride[s.swap_id])" class="text-xs" style="color:var(--red)">
            ⚠ That's a Silent Payment (sp1…) address. A refund must go to a plain on-chain address (bc1…/bcrt1…) you control — SP addresses can't receive this refund.
          </div>
        </div>
      </div>
    </div>

    <!-- Refund result / message — OUTSIDE the refundable card so it persists even
         after a successful refund removes the swap (which unmounts the card). -->
    <div v-if="refundResult" class="alert alert-success" style="margin-bottom:20px;display:flex;flex-direction:column;gap:6px">
      <div><strong>✓ Refund broadcast</strong></div>
      <div style="font-family:var(--font-mono);font-size:11px;word-break:break-all">{{ refundResult.txid }}</div>
      <div v-if="refundResult.refundedTo" class="text-xs text-dim">
        Refunded to <code style="word-break:break-all">{{ refundResult.refundedTo }}</code>
      </div>

      <!-- These funds are NOT in the Silent Payments wallet: they're on a plain
           on-chain address, and the key for it is in the seed rather than on
           this device. Say so here, where the user is looking, rather than
           leaving them to wonder why their balance didn't move. -->
      <div v-if="refundResult.refundedTo && refundResult.refundedTo === derivedRefund"
           class="text-sm" style="margin-top:2px">
        <strong>Getting to these funds.</strong>
        They landed on your wallet's own refund address, not in your Silent
        Payments balance — so your balance here won't change. Restore this
        wallet's 12 words in any BIP-84 wallet (Sparrow, Electrum) and the coins
        are at <code>{{ refundPath }}</code>, ready to spend or send back to your
        Silent Payment address.
      </div>
      <div v-else-if="refundResult.refundedTo" class="text-sm" style="margin-top:2px">
        These funds went to an address outside this wallet, so your Silent
        Payments balance won't change — spend them from whichever wallet holds
        that address.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" @click="copyText(refundResult.txid)">⎘ Copy txid</button>
        <button v-if="refundResult.refundedTo && refundResult.refundedTo === derivedRefund"
                class="btn btn-ghost btn-sm" @click="copyText(refundPath)">⎘ Copy path</button>
        <a class="btn btn-ghost btn-sm" :href="refundExplorerUrl(refundResult.txid)" target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
        <button class="btn btn-ghost btn-sm" @click="refundResult = null">Dismiss</button>
      </div>
    </div>
    <div v-if="refundMsg" class="alert alert-info" style="margin-bottom:20px">{{ refundMsg }}</div>

    <!-- Privacy + trust note -->
    <div class="alert alert-info" style="margin-bottom:20px;display:flex;align-items:flex-start;gap:10px">
      <span style="font-size:18px;line-height:1">ⓘ</span>
      <div style="flex:1">
        <strong>How this works</strong>
        <div class="text-sm text-dim" style="margin-top:2px">
          You send on-chain to a Boltz address; once seen, Boltz pays your Lightning invoice and the sats land in your wallet. Note Boltz sees both legs of the swap, and funding it spends (and links) the SP UTXOs you select.
        </div>
      </div>
    </div>


    <div class="card">
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px">

        <div class="field">
          <label>Wallet (receives the Lightning payment)</label>
          <select class="input sw-select" v-model="selectedWallet" :disabled="loading || !wallets.length">
            <option v-for="w in wallets" :key="w.id" :value="w.id">
              {{ w.name || w.id }}
            </option>
          </select>
        </div>

        <div class="field">
          <label>
            Amount to receive on Lightning (sats)
            <span v-if="minAmount && maxAmount" class="text-dim text-xs">
              — between {{ minAmount.toLocaleString() }} and {{ maxAmount.toLocaleString() }}
            </span>
          </label>
          <input
            class="input sw-amt"
            type="number"
            v-model.number="amount"
            placeholder="e.g. 50000"
            min="0" />
          <div v-if="amount && !amountValid" class="text-xs" style="color:var(--red);margin-top:4px">
            <template v-if="minAmount && amount < minAmount">Below Boltz minimum ({{ minAmount.toLocaleString() }} sats).</template>
            <template v-else-if="maxAmount && amount > maxAmount">Above Boltz maximum ({{ maxAmount.toLocaleString() }} sats).</template>
            <template v-else>Enter a valid amount.</template>
          </div>
        </div>

        <div class="field">
          <label>Refund address (on-chain, P2WPKH)</label>

          <template v-if="derivedRefund && useOwnRefund">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <code class="sw-addr" style="font-size:12px;word-break:break-all">{{ derivedRefund }}</code>
              <button type="button" class="btn btn-ghost btn-sm" @click="copyText(derivedRefund)">Copy</button>
            </div>
            <div class="text-xs text-dim" style="margin-top:4px">
              Your own wallet's address, derived from this wallet's seed at
              <code>{{ refundPath }}</code> — the same 12 words recover it, so
              there's nothing extra to back up. Thrilla can't spend it (only your
              Silent Payments keys are kept on this device), so a refund that
              lands here is swept by restoring your seed in any BIP-84 wallet.
              <button type="button" class="btn btn-ghost btn-sm" @click="useDifferentRefund">Use a different address</button>
            </div>
          </template>

          <template v-else>
            <input class="input sw-addr" v-model="refundAddress" placeholder="bc1q… / bcrt1q… (an address you control)" />
            <div class="text-xs text-dim" style="margin-top:4px">
              If the swap fails, your on-chain funds are refunded here. Must be a plain on-chain address you control — not a Silent Payment (sp1…/tsp1…) address, which Boltz can't refund to.
              <template v-if="derivedRefund">
                <button type="button" class="btn btn-ghost btn-sm" @click="useWalletRefund">Use my wallet's address instead</button>
              </template>
            </div>
            <div v-if="!derivedRefund" class="text-xs text-dim" style="margin-top:4px">
              This wallet has no refund address stored on this device — either its keys
              aren't here, or it was created before refund addresses were derived.
              Recovering the keys from your seed on this device fills this in for you.
            </div>
            <div v-if="refundAddress && refundIsSp" class="text-xs" style="color:var(--red);margin-top:4px">
              Silent Payment addresses can't be used for refunds — enter a plain on-chain address.
            </div>
          </template>
        </div>

        <div v-if="error" class="alert alert-warn" style="margin:0">{{ error }}</div>

        <button class="btn btn-primary" style="align-self:flex-start" :disabled="!canCreate" @click="createSwap">
          <span v-if="creating">Creating swap…</span>
          <span v-else>Continue — fund swap from SP wallet</span>
        </button>
      </div>
    </div>

    <div v-if="swapHistory.length" class="card" style="margin-top:20px">
      <div class="card-header"><h2>Swap history</h2></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
        <div v-for="s in swapHistory" :key="s.swap_id"
             style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <div style="font-size:13px"><strong>{{ (s.amount || 0).toLocaleString() }} sats</strong></div>
            <div class="text-dim text-xs">{{ statusLabel(s.status) }}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button
              v-if="s.fundable"
              class="btn btn-primary btn-sm"
              title="Resume funding this swap from your SP wallet"
              @click="fundSwapRow(s)">
              Fund
            </button>
            <button
              v-if="s.deletable"
              class="btn btn-ghost btn-sm"
              :disabled="deletingId === s.swap_id"
              :title="s.fundable ? 'Discard this unfunded swap' : 'Remove this finished swap from history'"
              @click="deleteSwapRow(s)">
              <span v-if="deletingId === s.swap_id">Removing…</span>
              <span v-else>Delete</span>
            </button>
            <span v-if="!s.deletable && !s.fundable" class="text-dim text-xs" style="white-space:nowrap">active</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sw-select { max-width: 280px; align-self: flex-start; }
.sw-amt    { max-width: 160px; align-self: flex-start; }
.sw-addr   { max-width: 420px; align-self: flex-start; }
</style>
