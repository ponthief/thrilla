<script setup>
/*
 * A plain bech32 pocket beside the Silent Payments wallet: receive to it, and
 * pay straight out of it, for anyone who can't handle an sp1… address.
 *
 * The coins never enter the SP wallet, and there is deliberately no "move them
 * in" button. Doing so would be a second transaction and a second fee for coins
 * that are only passing through, and it would tie them to an output sitting
 * alongside the wallet's own. Anyone who does want them there can send to their
 * own SP address — it's a destination like any other.
 *
 * A fresh receive address every time. The client walks its own BIP-84 chain from
 * the account key held in the vault and shows the first address with no history,
 * so two payments never share one. The server is asked about a window of derived
 * addresses but never given the xpub, so it cannot derive the next.
 *
 * Collapsed by default: the Silent Payments address above needs none of this
 * machinery and should be used wherever the sender will accept it.
 */
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { loadPlainChain } from '@/services/plainChain'
import { deriveSilentPayment, isValidMnemonic } from '@/services/spKeys'
import PlainSendModal from './PlainSendModal.vue'
import SeedInput from './SeedInput.vue'

const props = defineProps({
  wallet: { type: Object, required: true },
})

const auth = useAuthStore()

const open        = ref(false)
const accountXprv = ref('')
const chain       = ref(null)
const loading     = ref(false)
const error       = ref(null)
const copied      = ref(false)
const sendOpen    = ref(false)

// A payment broadcast from here that the chain index hasn't caught up with. Its
// inputs are spent, but a mempool spend takes a moment to reach Fulcrum, and
// without this the panel reads that stale answer back as spendable and offers
// coins already on their way — building a conflicting transaction. Cleared once
// a walk disagrees with the balance recorded at broadcast.
const pendingSpend = ref(null)
const SPEND_STALE_MS = 15 * 60 * 1000

// Setup for wallets stored before the plain chain existed: their vault entry has
// no account key, so it is derived from the recovery phrase once and saved.
const setupOpen  = ref(false)
const mnemonic   = ref('')
const passphrase = ref('')
const setupBusy  = ref(false)
const setupError = ref(null)

function groupThousands(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const sats     = computed(() => chain.value?.confirmedSats ?? 0)
const inFlight = computed(() => !!pendingSpend.value)
const hasCoins = computed(
  () => sats.value > 0 && !!accountXprv.value && !!chain.value?.fundedIndices.length,
)
const canSend = computed(() => !inFlight.value && hasCoins.value)

async function refresh() {
  const keys = await auth.getWalletKeys(props.wallet.id)
  accountXprv.value = keys?.sweepAccount || ''
  if (!accountXprv.value) { chain.value = null; return }
  loading.value = true
  error.value = null
  try {
    const next = await loadPlainChain(
      (addresses) => api.getPlainPreview(auth.inkey, props.wallet.id, addresses),
      accountXprv.value,
      props.wallet.network,
    )
    chain.value = next
    if (
      pendingSpend.value &&
      (Date.now() - pendingSpend.value.at > SPEND_STALE_MS ||
        next.confirmedSats !== pendingSpend.value.balanceAtSpend)
    ) {
      pendingSpend.value = null
    }
  } catch (e) {
    error.value = e.message || 'Could not check your plain addresses.'
  } finally {
    loading.value = false
  }
}

// Walked once when the wallet card renders, not on expand. The panel is
// collapsed by default, so without this nobody would learn that coins had
// arrived — there is no background watcher here as there is in the mobile app,
// and no push to fall back on. A wallet with no account key costs one vault read
// and no network at all, and the walk itself is a single batched request.
onMounted(refresh)

function copyAddress() {
  if (!chain.value) return
  navigator.clipboard?.writeText(chain.value.receiveAddress)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

function onSent(txid) {
  pendingSpend.value = {
    txid,
    balanceAtSpend: chain.value?.confirmedSats ?? 0,
    at: Date.now(),
  }
}

// The phrase is checked by re-deriving the wallet's Silent Payment address from
// it — a wrong phrase or a forgotten passphrase is a different wallet entirely,
// and would otherwise install an account key for addresses the user can't see.
async function runSetup() {
  setupError.value = null
  setupBusy.value = true
  try {
    const words = mnemonic.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length !== 12) throw new Error('Recovery phrase must be exactly 12 words.')
    const phrase = words.join(' ')
    if (!isValidMnemonic(phrase)) {
      throw new Error('Invalid recovery phrase — the checksum (last word) is incorrect.')
    }
    const derived = deriveSilentPayment(phrase, passphrase.value, props.wallet.network)
    if (derived.spAddress.toLowerCase() !== (props.wallet.sp_address || '').toLowerCase()) {
      throw new Error("That phrase doesn't match this wallet's address. Check the words and passphrase.")
    }
    const existing = await auth.getWalletKeys(props.wallet.id)
    await auth.storeWalletKeys(
      props.wallet.id,
      existing?.scanSecret || derived.scanSecret,
      existing?.spendKey || derived.spendKey,
      derived.refundAddress,
      derived.sweepAccount,
    )
    setupOpen.value = false
    mnemonic.value = ''
    passphrase.value = ''
    await refresh()
  } catch (e) {
    setupError.value = e.message || 'Could not set up plain addresses.'
  } finally {
    setupBusy.value = false
  }
}
</script>

<template>
  <div class="plain-panel">
    <button v-if="!open" class="collapsed" @click="open = true">
      <span class="collapsed-text">
        <b v-if="sats > 0">{{ groupThousands(sats) }} sats on a plain address</b>
        <b v-else>Need a plain bitcoin address?</b>
        <span class="text-dim text-xs">
          {{ sats > 0
            ? 'Held separately from this balance, ready to send.'
            : "For senders that can't pay a Silent Payments address." }}
        </span>
      </span>
      <span class="chevron">›</span>
    </button>

    <div v-else class="expanded">
      <div class="flex justify-between items-center" style="margin-bottom:10px">
        <b style="font-size:13px">Plain address</b>
        <button class="btn btn-ghost btn-sm" @click="open = false">Hide</button>
      </div>

      <template v-if="!accountXprv">
        <p class="text-dim text-xs" style="margin:0 0 10px;line-height:1.6">
          This wallet predates plain addresses, so its key for them needs deriving
          once. Enter your recovery phrase and this browser handles them from then
          on — you won't be asked again.
        </p>
        <button v-if="!setupOpen" class="btn btn-primary btn-sm" @click="setupOpen = true">
          Set up
        </button>
        <form v-else @submit.prevent="runSetup" style="display:flex;flex-direction:column;gap:10px">
          <div class="field">
            <label>Recovery phrase (12 words)</label>
            <SeedInput v-model="mnemonic" />
          </div>
          <div class="field">
            <label>Passphrase</label>
            <input class="input" v-model="passphrase" type="password"
                   placeholder="Leave blank if none" autocomplete="off" />
          </div>
          <div v-if="setupError" class="alert alert-error">⚠ {{ setupError }}</div>
          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost btn-sm" @click="setupOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm" :disabled="setupBusy">
              {{ setupBusy ? 'Setting up…' : 'Set up' }}
            </button>
          </div>
        </form>
      </template>

      <template v-else-if="loading && !chain">
        <div class="text-dim text-xs">Checking…</div>
      </template>

      <template v-else-if="chain">
        <div class="addr-row">
          <span class="mono addr">{{ chain.receiveAddress }}</span>
          <button class="btn btn-ghost btn-sm btn-icon" @click="copyAddress"
                  :title="copied ? 'Copied' : 'Copy address'">{{ copied ? '✓' : '⎘' }}</button>
          <button class="btn btn-ghost btn-sm" @click="refresh" :disabled="loading">
            {{ loading ? 'Checking…' : 'Refresh' }}
          </button>
        </div>
        <p class="text-dim text-xs" style="margin:8px 0 0;line-height:1.6">
          A plain bitcoin address for senders that can't pay a Silent Payments
          address. Unused — a new one appears once this is paid, so two payments
          are never linked by sharing an address.
        </p>

        <div v-if="error" class="alert alert-error" style="margin-top:10px">⚠ {{ error }}</div>

        <div class="balance">
          <template v-if="pendingSpend">
            <span class="text-dim text-xs">Payment on its way</span>
            <span class="text-dim text-xs">Waiting for the chain index to catch up</span>
          </template>
          <template v-else>
            <span class="text-dim text-xs">Available here</span>
            <b class="amount">{{ groupThousands(sats) }} sats</b>
            <span v-if="chain.unconfirmedSats > 0" class="text-dim text-xs">
              + {{ groupThousands(chain.unconfirmedSats) }} sats unconfirmed — spendable once mined
            </span>
            <span v-if="chain.fundedIndices.length > 1" class="text-dim text-xs">
              across {{ chain.fundedIndices.length }} addresses
            </span>
          </template>
        </div>

        <button class="btn btn-primary btn-sm" style="width:100%" :disabled="!canSend"
                @click="sendOpen = true">
          Send these coins
        </button>
        <p v-if="hasCoins && !inFlight" class="text-dim text-xs" style="margin:8px 0 0;line-height:1.6">
          Paid straight from here, these reach the recipient without being linked
          to the rest of your balance — or send them to your own Silent Payments
          address to hold them in the wallet.
        </p>
        <p v-if="!hasCoins && !inFlight" class="text-dim text-xs" style="margin:8px 0 0;line-height:1.6">
          Nothing here yet. Send coins to the address above, then check back once
          they confirm.
        </p>
      </template>

      <template v-else>
        <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>
        <button class="btn btn-primary btn-sm" @click="refresh">Retry</button>
      </template>
    </div>

    <PlainSendModal
      :show="sendOpen"
      :wallet="wallet"
      :account-xprv="accountXprv"
      :chain="chain"
      @sent="onSent"
      @close="sendOpen = false; refresh()"
    />
  </div>
</template>

<style scoped>
.plain-panel { margin-top: 12px; }
.collapsed {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.collapsed-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.chevron { font-size: 20px; opacity: .4; }
.expanded {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}
.addr-row { display: flex; align-items: center; gap: 6px; }
.addr {
  flex: 1;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.balance {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
  background: var(--card, rgba(255,255,255,.03));
  border-radius: var(--radius);
  padding: 12px;
  margin: 12px 0;
}
.amount { font-size: 18px; }
</style>
