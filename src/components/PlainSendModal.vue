<script setup>
/*
 * Pays straight out of the plain BIP-84 chain, without the coins passing through
 * the Silent Payments wallet — one transaction rather than two, and nothing ties
 * them to the rest of the balance.
 *
 * The destination can be an ordinary address or a Silent Payments one. Paying
 * your own SP address is how you move these coins into the wallet, if that is
 * what you want; it is a destination, not a special mode.
 *
 * Coin selection pays from ONE address wherever one covers the amount — spending
 * two together publishes that they share an owner, which is what rotating the
 * receive address exists to avoid. When no single address is enough, it says so
 * before signing rather than after.
 */
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import {
  destinationPlaceholder,
  isOwnSpAddress,
  keysForIndices,
  selectPlainCoins,
} from '@/services/plainChain'
import { addPendingSend } from '@/stores/pendingsends'
import { parseScannedAddress } from '@/services/addressUri'
import QrScanModal from './QrScanModal.vue'

const props = defineProps({
  show:        { type: Boolean, default: false },
  wallet:      { type: Object,  default: null  },
  accountXprv: { type: String,  default: ''    },
  chain:       { type: Object,  default: null  },
})
const emit = defineEmits(['close', 'sent'])

const auth = useAuthStore()

const stage       = ref('compose')   // compose | review | done
const destination = ref('')
const amount      = ref('')
const sendMax     = ref(false)
const feeRate     = ref('1')
const busy        = ref(false)
const error       = ref(null)
const built       = ref(null)
const txid        = ref('')
const showScan    = ref(false)

function groupThousands(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// Plain on-chain, or a Silent Payments address. NOT BitMail: resolving one here
// would skip the tamper check /tx/build performs against the DNS record siLNt
// issued, and a send path without that guard is not one to add quietly.
const destinationKind = computed(() => {
  const s = destination.value.trim().toLowerCase()
  if (!s) return ''
  if (s.startsWith('sp1') || s.startsWith('tsp1')) return 'sp'
  if (s.startsWith('bc1') || s.startsWith('tb1') || s.startsWith('bcrt1')) return 'onchain'
  return ''
})

const placeholder = computed(() => destinationPlaceholder(props.wallet?.network))
// Paying our own SP address puts coins INTO the wallet, which changes what
// happens after broadcast — see confirm().
const toSelf = computed(
  () => !!props.wallet && isOwnSpAddress(destination.value, props.wallet.sp_address),
)

const amountSats = computed(() =>
  sendMax.value ? null : Math.floor(Number(amount.value) || 0),
)
const selection = computed(() =>
  props.chain ? selectPlainCoins(props.chain, amountSats.value) : null,
)

const canReview = computed(() =>
  !!destinationKind.value &&
  !!selection.value?.indices.length &&
  (sendMax.value || amountSats.value > 0) &&
  !selection.value.shortBy &&
  Number(feeRate.value) > 0,
)

watch(() => props.show, async (show) => {
  if (!show) return
  stage.value = 'compose'
  showScan.value = false
  destination.value = ''
  amount.value = ''
  sendMax.value = false
  built.value = null
  txid.value = ''
  error.value = null
  // Never urgent — start from the half-hour rate rather than the top of the
  // mempool, and leave it editable.
  try {
    const t = await api.getRecommendedFees(auth.inkey)
    feeRate.value = String(t.halfHourFee ?? t.hourFee ?? t.fastestFee ?? 1)
  } catch { /* keep the default */ }
})

function onScanned(value) {
  destination.value = parseScannedAddress(value)
  showScan.value = false
}

async function pasteDestination() {
  try {
    destination.value = parseScannedAddress(await navigator.clipboard.readText())
  } catch { /* clipboard blocked or empty — the field is typeable */ }
}

async function build() {
  error.value = null
  busy.value = true
  try {
    built.value = await api.buildPlainSpend(
      auth.adminkey,
      props.wallet.id,
      keysForIndices(props.accountXprv, props.wallet.network, selection.value.indices),
      destination.value.trim(),
      amountSats.value,
      // Change comes back to the chain's next unused address, so a payment does
      // not put the remainder back on an address that has now been seen
      // spending.
      sendMax.value ? null : props.chain.receiveAddress,
      Number(feeRate.value),
    )
    stage.value = 'review'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}

async function confirm() {
  error.value = null
  busy.value = true
  try {
    const res = await api.broadcastPlainTx(auth.adminkey, props.wallet.id, built.value.tx_hex)
    txid.value = res.txid
    emit('sent', res.txid, built.value.amount)
    // The wallet cannot see a payment to its own SP address by itself: the
    // output is found only by SCANNING, and nothing scans just because a
    // transaction was broadcast. Handing it to the global send watcher is what
    // makes it scan the confirming block — the only reason the payment ever
    // shows up in Activity.
    if (toSelf.value) {
      addPendingSend(res.txid, props.wallet.id, built.value.amount)
      try { window.__kickSendWatch && window.__kickSendWatch() } catch { /* ignore */ }
    }
    stage.value = 'done'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="show && wallet && chain" class="modal-overlay" @click.self="emit('close')">
    <div class="card modal plain-send-modal">
      <div class="card-header">
        <h2>{{ stage === 'done' ? 'Sent' : 'Send from plain addresses' }}</h2>
        <button class="btn btn-ghost btn-sm btn-icon" @click="emit('close')">✕</button>
      </div>

      <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
        <template v-if="stage === 'compose'">
          <p class="text-dim text-xs" style="margin:0;line-height:1.6">
            <template v-if="toSelf">
              Moves these coins into your wallet balance. They become ordinary wallet
              coins, linked to this transaction like any other.
            </template>
            <template v-else>
              Pays straight out of your plain addresses. These coins go to the
              recipient without entering your Silent Payments wallet, so nothing links
              them to the rest of your balance.
            </template>
          </p>

          <div class="field">
            <label>To</label>
            <input class="input mono" v-model="destination" :placeholder="placeholder"
                   autocomplete="off" spellcheck="false" />
            <div class="flex gap-2" style="margin-top:8px">
              <button type="button" class="btn btn-ghost btn-sm" @click="showScan = true">▦ Scan</button>
              <button type="button" class="btn btn-ghost btn-sm" @click="pasteDestination">⎘ Paste</button>
              <button type="button" class="btn btn-ghost btn-sm"
                      @click="destination = wallet.sp_address">My wallet</button>
            </div>
            <span v-if="destination.trim() && !destinationKind" class="text-dim text-xs">
              Enter an on-chain address or a Silent Payments address. BitMail isn't
              supported here — send those from the wallet.
            </span>
          </div>

          <div class="field">
            <label>Amount (sats)</label>
            <div class="flex gap-2">
              <input class="input" style="flex:1"
                     :value="sendMax ? String(selection?.availableSats ?? 0) : amount"
                     @input="amount = $event.target.value"
                     :disabled="sendMax" type="number" min="0" placeholder="0" />
              <button type="button"
                      :class="['btn', 'btn-sm', sendMax ? 'btn-primary' : 'btn-ghost']"
                      @click="sendMax = !sendMax">Max</button>
            </div>
            <span class="text-dim text-xs">
              {{ groupThousands(selection?.availableSats ?? 0) }} sats available
              {{ (selection?.indices.length ?? 0) > 1
                  ? `across ${selection.indices.length} addresses`
                  : 'on one address' }}{{ sendMax ? ', minus the fee' : '' }}.
            </span>
          </div>

          <div v-if="selection?.shortBy" class="alert alert-error">
            ⚠ {{ groupThousands(selection.shortBy) }} sats short, even using every address.
          </div>

          <div v-if="selection?.linksAddresses" class="alert alert-warn">
            No single address holds this much, so {{ selection.indices.length }} will be
            spent together — which publishes that they're the same owner. Send a smaller
            amount to keep them separate.
          </div>

          <div class="field">
            <label>Fee rate (sat/vB)</label>
            <input class="input" v-model="feeRate" type="number" min="1" step="1" />
          </div>

          <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>

          <div class="flex gap-2 justify-between">
            <button class="btn btn-ghost" @click="emit('close')">Cancel</button>
            <button class="btn btn-primary" :disabled="busy || !canReview" @click="build">
              <span v-if="busy" class="spinner" style="border-top-color:#000"></span>
              {{ busy ? 'Building…' : 'Review' }}
            </button>
          </div>
        </template>

        <template v-else-if="stage === 'review'">
          <div class="sp-readonly mono">{{ destination.trim() }}</div>
          <div class="rows">
            <div class="row"><span>Sending</span><b>{{ groupThousands(built.amount) }} sats</b></div>
            <div class="row"><span>Network fee</span><b>{{ groupThousands(built.fee) }} sats</b></div>
            <div v-if="built.change > 0" class="row">
              <span>Change back here</span><b>{{ groupThousands(built.change) }} sats</b>
            </div>
            <div class="row">
              <span>From</span>
              <b>{{ built.input_count }} coin{{ built.input_count === 1 ? '' : 's' }}
                 on {{ built.swept_addresses.length }}
                 address{{ built.swept_addresses.length === 1 ? '' : 'es' }}</b>
            </div>
          </div>

          <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>

          <div class="flex gap-2 justify-between">
            <button class="btn btn-ghost" :disabled="busy" @click="stage = 'compose'">Back</button>
            <button class="btn btn-primary" :disabled="busy" @click="confirm">
              <span v-if="busy" class="spinner" style="border-top-color:#000"></span>
              {{ busy ? 'Sending…' : 'Send' }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="text-dim text-xs" style="margin:0;line-height:1.6">
            <template v-if="toSelf">
              Broadcast. These coins land in your wallet balance once the transaction
              confirms and the block is scanned — Activity will show it then.
            </template>
            <template v-else>
              Broadcast. These coins went straight from your plain addresses to the
              recipient — they never touched your Silent Payments wallet, so nothing
              links them to the rest of your balance.
            </template>
          </p>
          <div class="sp-readonly mono">{{ txid }}</div>
          <div class="flex justify-between">
            <span></span>
            <button class="btn btn-primary" @click="emit('close')">Done</button>
          </div>
        </template>
      </div>
    </div>

    <QrScanModal :show="showScan" @close="showScan = false" @scanned="onScanned" />
  </div>
</template>

<style scoped>
.plain-send-modal { max-width: 460px; }
.sp-readonly {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 11px;
  word-break: break-all;
  line-height: 1.6;
}
.rows { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.row span { color: var(--dim, #888); }
@media (max-width: 480px) {
  .plain-send-modal { max-width: 100%; }
}
</style>
