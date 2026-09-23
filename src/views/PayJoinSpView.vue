<script setup>
// Silent Payments PayJoin, in the browser.
//
// The mirror of screens/settings/PayjoinPage.tsx, per the CLAUDE.md rule that a
// rule enforced in one client belongs in the other — and here it is not merely
// a rule but the derivation and the pre-signing checks, which live in
// services/spPayjoin.ts and are shared verbatim by both clients. This file is
// the wiring; nothing about the protocol is decided in it.
//
// NOT the same feature as PayJoinView.vue. That one is descriptors, P2WPKH and
// a PSBT for Sparrow to sign, and it cannot carry Silent Payments: PSBT's
// BIP32_DERIVATION is how an external signer recognises its inputs, and an SP
// UTXO's key is a one-off from a tweak with no derivation path. Both parties
// here are WhiSPa wallets and both sign in their own app.
//
// WHERE THE KEYS STAY. Accepting derives the payment output from this wallet's
// scan key; signing derives change the same way and signs with the spend key.
// Both come out of the page's key vault and neither is sent anywhere. What
// reaches the server is a scriptPubKey and a signature, both of which are on
// chain moments later.

import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'
import * as pj from '@/services/spPayjoin'
import { parseSpAddress, fromHex, toHex } from '@/services/spSign'

const auth = useAuthStore()

const wallets = ref([])
const selectedWallet = ref('')
const coins = ref([])
const incoming = ref([])
const outgoing = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref('')

const payee = ref('')
const amount = ref(null)
const feeRate = ref(2)

const wallet = computed(() =>
  wallets.value.find((w) => w.id === selectedWallet.value) || null,
)
const hasKeys = computed(
  () => !!(selectedWallet.value && auth.hasWalletKeys(selectedWallet.value)),
)

function parseInputs(raw) {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

const wire = (u) => ({
  txid: u.txid, vout: u.vout, pub_key: u.pub_key, amount: u.amount,
})
const local = (u) => ({
  txid: u.txid, vout: u.vout, amount: u.amount,
  pub_key: u.pub_key, priv_key_tweak: u.priv_key_tweak,
})

/**
 * One coin, the smallest that covers what is needed.
 *
 * Deliberately not the Send page's coin table. Which of your coins go into a
 * PayJoin is a privacy decision of its own — which ones you are willing to
 * show the other party, and whether spending two together links them — and
 * reusing a picker built for a different question would decide that for the
 * user without saying so. Same choice as the mobile page, for the same reason.
 */
function pickCoin(need) {
  return coins.value
    .filter((c) => c.amount >= need)
    .sort((a, b) => a.amount - b.amount)[0] || null
}

async function load() {
  error.value = ''
  try {
    wallets.value = await api.getSilntWallets(auth.inkey)
    if (wallets.value.length && !selectedWallet.value) {
      selectedWallet.value = wallets.value[0].id
    }
    if (!selectedWallet.value) {
      error.value = 'No Silent Payments wallet on this network.'
      return
    }
    const [res, queues] = await Promise.all([
      api.getUtxos(auth.inkey, selectedWallet.value),
      api.payjoinSpList(auth.inkey),
    ])
    coins.value = (res.utxos || []).filter(
      (u) => u.utxo_state === 'unspent' && !u.frozen,
    )
    incoming.value = queues.incoming || []
    outgoing.value = queues.outgoing || []
  } catch (e) {
    error.value = e.detail || e.message || 'Could not load PayJoins.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function propose() {
  const sats = Number(amount.value)
  if (!Number.isFinite(sats) || sats <= 0) {
    error.value = 'Enter an amount in sats.'
    return
  }
  // The amount plus a fee for a 2-in-2-out taproot spend, which is the
  // smallest shape a PayJoin can be.
  const need = sats + pj.estimateFee(2, 2, feeRate.value).fee
  const coin = pickCoin(need)
  if (!coin) {
    error.value =
      `No single coin covers ${sats} sats plus the fee. Consolidating first ` +
      `would link those coins together, so this does not do it for you.`
    return
  }
  busy.value = 'propose'
  error.value = ''
  try {
    await api.payjoinSpPropose(auth.adminkey, {
      payer_wallet_id: selectedWallet.value,
      payee_username: payee.value.trim(),
      amount_sats: sats,
      fee_rate: Number(feeRate.value),
      inputs: [wire(coin)],
      network: wallet.value?.network || 'signet',
    })
    payee.value = ''
    amount.value = null
    pushToast('PayJoin proposed. Nothing is signed until they accept.', 'ok')
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not propose that PayJoin.'
  } finally {
    busy.value = ''
  }
}

async function contribute(row) {
  busy.value = row.id
  error.value = ''
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // The payee's coin comes straight back out in the payment, so it is no
    // worse off for contributing one. The smallest keeps the least exposed.
    const coin = pickCoin(1)
    if (!coin) throw new Error('You have no coin to contribute.')

    // The complete input set exists for the first time right here, and every
    // output derived from it must not outlive a change to it — which is why
    // the payment script goes in this same call and not a later one.
    const all = [...parseInputs(row.payer_inputs), local(coin)]
    const { spend } = parseSpAddress(wallet.value.sp_address)
    const paymentSpk = pj.paymentScript(keys.scanSecret, spend, all)

    await api.payjoinSpContribute(auth.adminkey, row.id, {
      payee_wallet_id: selectedWallet.value,
      inputs: [wire(coin)],
      payment_spk: toHex(paymentSpk),
    })
    pushToast('Accepted. They sign next, then it comes back to you.', 'ok')
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not accept that PayJoin.'
  } finally {
    busy.value = ''
  }
}

async function sign(row) {
  busy.value = row.id
  error.value = ''
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // Re-fetched, never signed from the list: the list is however old the page
    // is, and what is about to be signed is a transaction.
    const fresh = await api.payjoinSpGet(auth.adminkey, row.id)
    const role = fresh.role
    const payerInputs = parseInputs(fresh.payer_inputs)
    const payeeInputs = parseInputs(fresh.payee_inputs)
    const all = [...payerInputs, ...payeeInputs]
    const mine = role === 'payer' ? payerInputs : payeeInputs
    if (!fresh.payment_spk) throw new Error('This PayJoin has no payment output yet.')

    const amounts = {
      payer_in: fresh.payer_in_sats,
      payee_in: fresh.payee_in_sats,
      payment: fresh.payment_sats,
      amount: fresh.amount_sats,
      fee: fresh.fee_sats,
      change: fresh.change_sats,
      vsize: fresh.vsize,
    }

    const { spend } = parseSpAddress(wallet.value.sp_address)
    // The payer derives its change now. The payee re-derives the payment
    // script so it can check the server still holds the one it posted.
    const changeSpk =
      role === 'payer' && amounts.change
        ? pj.changeScript(keys.scanSecret, spend, all)
        : fresh.change_spk ? fromHex(fresh.change_spk) : null
    const expectPaymentSpk =
      role === 'payee' ? pj.paymentScript(keys.scanSecret, spend, all) : null

    // Nothing is signed until this returns. Every way it throws means cancel,
    // not retry, and the message it throws is the message shown.
    const assembled = pj.checkBeforeSigning({
      role,
      inputs: all,
      mine,
      amounts,
      paymentSpk: fromHex(fresh.payment_spk),
      changeSpk,
      expectPaymentSpk,
      expectChangeSpk: role === 'payer' ? changeSpk : null,
      committed: mine,
      amount: fresh.amount_sats,
      feeRate: fresh.fee_rate,
    })

    const witnesses = pj.signOwnInputs(assembled, all, mine, keys.spendKey)
    const done = await api.payjoinSpSign(auth.adminkey, row.id, {
      witnesses,
      change_spk: role === 'payer' && changeSpk ? toHex(changeSpk) : null,
    })
    pushToast(
      done.status === 'BROADCAST'
        ? 'Broadcast. Both of you spent a coin into it.'
        : 'Signed. Waiting on the other side.',
      'ok',
    )
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not sign that PayJoin.'
  } finally {
    busy.value = ''
  }
}

async function cancel(row) {
  if (!window.confirm(
    'Cancel this PayJoin? The other side is told. Nothing has been broadcast, ' +
    'so no coins move.',
  )) return
  busy.value = row.id
  try {
    await api.payjoinSpCancel(auth.adminkey, row.id)
    pushToast('PayJoin cancelled.', 'ok')
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not cancel that PayJoin.'
  } finally {
    busy.value = ''
  }
}

// Whose move it is. Mirrors payjoin_sp.py::whose_turn, which is the authority;
// this only decides which button to draw, and the endpoint refuses anyway.
function myTurn(row, role) {
  return (
    (row.status === 'PROPOSED' && role === 'payee') ||
    (row.status === 'CONTRIBUTED' && role === 'payer') ||
    (row.status === 'PAYER_SIGNED' && role === 'payee')
  )
}

const sats = (n) => (n == null ? '—' : `${Number(n).toLocaleString()} sats`)
</script>

<template>
  <div class="pjsp">
    <div class="card">
      <div class="card-header">PayJoin</div>
      <div class="card-body">
        <p class="muted">
          An ordinary send has every input belonging to you, which is the most
          useful assumption chain analysis makes. A PayJoin breaks it: the
          person you are paying contributes an input too, so nobody watching
          can tell whose coins are whose.
        </p>
        <p class="muted">
          Both of you need a WhiSPa wallet and an accepted connection. Their
          coin comes straight back to them inside the payment, so taking part
          costs them nothing but the round trip.
        </p>

        <div class="row">
          <label>
            Wallet
            <select v-model="selectedWallet" @change="load">
              <option v-for="w in wallets" :key="w.id" :value="w.id">
                {{ w.title }} ({{ w.network }})
              </option>
            </select>
          </label>
        </div>
        <div v-if="selectedWallet && !hasKeys" class="alert alert-warn">
          This browser does not hold this wallet’s keys, so it cannot derive an
          output or sign an input. Unlock the wallet on the Send page first.
        </div>
      </div>
    </div>

    <div v-if="error" class="alert alert-warn">{{ error }}</div>

    <div class="card">
      <div class="card-header">Start one</div>
      <div class="card-body">
        <div class="row">
          <label>
            Their username
            <input v-model="payee" type="text" autocapitalize="none" placeholder="username" />
          </label>
          <label>
            Amount (sats)
            <input v-model.number="amount" type="number" min="1" placeholder="0" />
          </label>
          <label>
            Fee rate (sat/vB)
            <input v-model.number="feeRate" type="number" min="1" />
          </label>
        </div>
        <button
          class="btn btn-primary"
          :disabled="busy === 'propose' || !payee.trim() || !amount || !hasKeys"
          @click="propose">
          {{ busy === 'propose' ? 'Proposing…' : 'Propose' }}
        </button>
        <p class="muted small">
          {{ coins.length }} coin(s) available. One coin is used, never two —
          spending two of yours together links them, which is the opposite of
          the point.
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Waiting on you</div>
      <div class="card-body">
        <p v-if="!incoming.length" class="muted">
          Nothing right now. A PayJoin someone starts with you appears here.
        </p>
        <div v-for="r in incoming" :key="r.id" class="pj-row">
          <div class="pj-head">
            <strong>From {{ r.payer_username }}</strong>
            <span class="pill">{{ r.status.toLowerCase() }}</span>
          </div>
          <div>{{ sats(r.amount_sats) }}</div>
          <div v-if="r.fee_sats != null" class="muted small">
            fee {{ sats(r.fee_sats) }} · {{ r.vsize }} vB
          </div>
          <div v-if="r.txid" class="muted small mono">{{ r.txid }}</div>
          <div class="pj-actions">
            <button
              v-if="myTurn(r, 'payee') && r.status === 'PROPOSED'"
              class="btn btn-sm btn-primary"
              :disabled="busy === r.id || !hasKeys"
              @click="contribute(r)">
              {{ busy === r.id ? 'Accepting…' : 'Accept' }}
            </button>
            <button
              v-else-if="myTurn(r, 'payee')"
              class="btn btn-sm btn-primary"
              :disabled="busy === r.id || !hasKeys"
              @click="sign(r)">
              {{ busy === r.id ? 'Signing…' : 'Sign' }}
            </button>
            <button
              v-if="r.status !== 'BROADCAST' && r.status !== 'CANCELLED'"
              class="btn btn-sm btn-ghost"
              :disabled="busy === r.id"
              @click="cancel(r)">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Yours</div>
      <div class="card-body">
        <p v-if="!outgoing.length" class="muted">
          PayJoins you start appear here.
        </p>
        <div v-for="r in outgoing" :key="r.id" class="pj-row">
          <div class="pj-head">
            <strong>To {{ r.payee_username }}</strong>
            <span class="pill">{{ r.status.toLowerCase() }}</span>
          </div>
          <div>{{ sats(r.amount_sats) }}</div>
          <div v-if="r.fee_sats != null" class="muted small">
            fee {{ sats(r.fee_sats) }} · {{ r.vsize }} vB
            <template v-if="r.change_sats"> · change {{ sats(r.change_sats) }}</template>
          </div>
          <div v-if="r.txid" class="muted small mono">{{ r.txid }}</div>
          <div class="pj-actions">
            <button
              v-if="myTurn(r, 'payer')"
              class="btn btn-sm btn-primary"
              :disabled="busy === r.id || !hasKeys"
              @click="sign(r)">
              {{ busy === r.id ? 'Signing…' : 'Sign' }}
            </button>
            <button
              v-if="r.status !== 'BROADCAST' && r.status !== 'CANCELLED'"
              class="btn btn-sm btn-ghost"
              :disabled="busy === r.id"
              @click="cancel(r)">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <p v-if="loading" class="muted">Loading…</p>
  </div>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.row label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.pj-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--border, #2a2a2a);
}
.pj-row:last-child { border-bottom: 0; }
.pj-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.pj-actions { display: flex; gap: 8px; margin-top: 8px; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
</style>
