<script setup>
// Tango, in the browser.
//
// The mirror of screens/TangoScreen.tsx, per the CLAUDE.md rule that a rule
// enforced in one client belongs in the other — and here it is not merely a
// rule but the arithmetic, the derivation and the pre-signing checks, which
// live in services/tango.ts and are shared verbatim by both clients. This file
// is the wiring; nothing about the protocol is decided in it.
//
// WHAT A TANGO IS, in the sentence the page has to be able to say. You and one
// connected person each put in the same amount and each take the same amount
// back. Nobody pays anybody. Because the two mixed outputs are identical —
// same value, same script shape, same freshness — someone reading the chain
// cannot say which is yours.
//
// NOT PayJoinSpView. That one moves money: one party pays another, the outputs
// differ, and what it hides is that the inputs had two owners. This moves
// nothing, and hides which output is whose.
//
// WHERE THE KEYS STAY. Both of this side's outputs are derived here from the
// wallet's scan key, and its inputs are signed here with the spend key. What
// reaches the server is a scriptPubKey and a signature, both of which are on
// chain moments later.

import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'
import * as tango from '@/services/tango'
import { parseSpAddress, fromHex, toHex } from '@/services/spSign'
import {
  tangoRounds as rounds,
  refreshTangoWatch,
} from '@/stores/tangowatch'
import {
  recordTangoCommit,
  getTangoCommit,
  pruneTangoCommits,
} from '@/stores/tangocommit'

const auth = useAuthStore()

// The list comes from the watch store, which polls every 20s whether or not
// this page is open — that poller is what makes a browser tab notice its turn
// at all, since there is no push here. Reading its ref rather than fetching a
// second copy keeps one number on the nav badge and the same number on this
// page; two pollers against one endpoint would disagree for a few seconds
// after every action, and on this page disagreeing means a Sign button drawn
// from stale state.
const wallets = ref([])
const selectedWallet = ref('')
const coins = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref('')

const partner = ref('')
const denom = ref(null)
const feeRate = ref(2)

// The coins THIS user has chosen, by outpoint. Explicit on purpose: which of
// your coins go into a mix is the decision the mix is made of, and a picker
// that chooses for you has made it without saying so. Deliberately not the
// Send page's coin table either — that one was built to answer "what covers
// this payment", which is a different question.
const picked = ref(new Set())

const wallet = computed(() =>
  wallets.value.find((w) => w.id === selectedWallet.value) || null,
)
const hasKeys = computed(
  () => !!(selectedWallet.value && auth.hasWalletKeys(selectedWallet.value)),
)

const outpoint = (u) => `${u.txid}:${u.vout}`
const chosen = computed(() => coins.value.filter((c) => picked.value.has(outpoint(c))))
const chosenTotal = computed(() => chosen.value.reduce((s, c) => s + c.amount, 0))

function toggle(u) {
  // Reassigned rather than mutated: a Set is not reactive in place.
  const next = new Set(picked.value)
  const k = outpoint(u)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  picked.value = next
}

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
 * What the chosen coins would do at the entered denomination.
 *
 * Priced against this side's own coins standing in for the other side's, which
 * is what the server does when it takes a proposal — the real fee depends on
 * how many coins the partner brings. Good enough to tell you the thing that
 * matters before you commit: whether your selection leaves change, and
 * therefore whether the mix will be clean.
 */
const preview = computed(() => {
  const d = Number(denom.value)
  if (!Number.isFinite(d) || d <= 0 || !chosen.value.length) return null
  const rows = chosen.value.map((c) => ({
    txid: c.txid, vout: c.vout, amount: c.amount, pub_key: c.pub_key,
  }))
  try {
    const p = tango.plan(rows, rows, d, Number(feeRate.value) || 1)
    return { change: p.a_change, fee: p.a_fee, error: '' }
  } catch (e) {
    return { change: 0, fee: 0, error: e.message || 'That does not work.' }
  }
})

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
    const res = await api.getUtxos(auth.inkey, selectedWallet.value)
    coins.value = (res.utxos || []).filter(
      (u) => u.utxo_state === 'unspent' && !u.frozen,
    )
    // Not awaited alongside the coins: a poll that fails is the watcher's
    // problem to retry on its next tick, and it must not leave this page
    // saying it could not load when the coins arrived perfectly well.
    refreshTangoWatch().then(() => {
      // Forget what was committed to rounds that are over: the list is only
      // needed while there is still something left to sign.
      pruneTangoCommits(
        rounds.value
          .filter((r) => r.status !== 'BROADCAST' && r.status !== 'CANCELLED')
          .map((r) => r.id),
      )
    })
  } catch (e) {
    error.value = e.detail || e.message || 'Could not load Tango.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── A: propose ──
async function propose() {
  const sats = Number(denom.value)
  if (!Number.isFinite(sats) || sats <= 0) {
    error.value = 'Enter the amount you each want back.'
    return
  }
  if (!chosen.value.length) {
    error.value = 'Choose which of your coins go in.'
    return
  }
  busy.value = 'propose'
  error.value = ''
  try {
    const row = await api.tangoPropose(auth.adminkey, {
      wallet_id: selectedWallet.value,
      partner_username: partner.value.trim(),
      denom_sats: sats,
      fee_rate: Number(feeRate.value),
      inputs: chosen.value.map(wire),
      network: wallet.value?.network || 'signet',
    })
    // Remembered before anything else can change: this is the only copy of the
    // selection that the server did not write.
    recordTangoCommit(row.id, chosen.value)
    partner.value = ''
    denom.value = null
    picked.value = new Set()
    pushToast('Sent. They match it, then you both sign.', { type: 'success' })
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not start that Tango.'
  } finally {
    busy.value = ''
  }
}

// ── B: match it, which means deriving both of this side's outputs ──
async function accept(row) {
  if (!chosen.value.length) {
    error.value = 'Choose which of your coins go in, then match it.'
    return
  }
  busy.value = row.id
  error.value = ''
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // The complete input set exists for the first time here, and every output
    // derived from it must not outlive a change to it — which is why both
    // scripts go in this same call and not a later one.
    const all = [...parseInputs(row.a_inputs), ...chosen.value.map(local)]
    const amounts = tango.plan(
      parseInputs(row.a_inputs), chosen.value.map(local),
      row.denom_sats, row.fee_rate,
    )
    const { spend } = parseSpAddress(wallet.value.sp_address)
    const own = tango.deriveOwnOutputs(
      keys.scanSecret, spend, all, !!amounts.b_change,
    )

    await api.tangoAccept(auth.adminkey, row.id, {
      wallet_id: selectedWallet.value,
      inputs: chosen.value.map(wire),
      mix_spk: toHex(own.mix),
      change_spk: own.change ? toHex(own.change) : null,
    })
    recordTangoCommit(row.id, chosen.value)
    picked.value = new Set()
    pushToast(
      amounts.clean
        ? 'Matched, and neither side needs change — a clean mix.'
        : 'Matched. One or both sides have change, which weakens it.',
      { type: 'success' },
    )
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not match that Tango.'
  } finally {
    busy.value = ''
  }
}

// ── both: sign, after the checks ──
async function sign(row) {
  busy.value = row.id
  error.value = ''
  try {
    const keys = await auth.getWalletKeys(selectedWallet.value)
    if (!keys) throw new Error('This browser does not hold this wallet’s keys.')

    // Re-fetched, never signed from the list: the list is however old the page
    // is, and what is about to be signed is a transaction.
    const fresh = await api.tangoGet(auth.inkey, row.id)
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
    // check cannot be made, and the page says so rather than implying it
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
    const done = await api.tangoSign(auth.adminkey, row.id, {
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
        ? 'Broadcast. Both shares are the same size, so nothing on chain says which is yours.'
        : 'Signed. Waiting on the other side.') + unverified,
      { type: 'success' },
    )
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not sign that Tango.'
  } finally {
    busy.value = ''
  }
}

async function cancel(row) {
  if (!window.confirm(
    'Cancel this Tango? The other side is told. Nothing has been broadcast, ' +
    'so no coins move.',
  )) return
  busy.value = row.id
  try {
    await api.tangoCancel(auth.adminkey, row.id)
    pushToast('Tango cancelled.', { type: 'success' })
    await load()
  } catch (e) {
    error.value = e.detail || e.message || 'Could not cancel that Tango.'
  } finally {
    busy.value = ''
  }
}

// Whose move it is. Mirrors helpers/tango.py::whose_turn, which is the
// authority; this only decides which button to draw, and the endpoint refuses
// out of turn anyway.
const TURN = { PROPOSED: 'b', ACCEPTED: 'a', A_SIGNED: 'b' }
const myTurn = (row) => !!row.role && TURN[row.status] === row.role

const waiting = computed(() => rounds.value.filter(myTurn))
const others = computed(() => rounds.value.filter((r) => !myTurn(r)))

const sats = (n) => (n == null ? '—' : `${Number(n).toLocaleString()} sats`)
const partnerOf = (r) => (r.role === 'a' ? r.b_username : r.a_username)
const myFee = (r) => (r.role === 'a' ? r.a_fee_sats : r.b_fee_sats)
const myChange = (r) => (r.role === 'a' ? r.a_change_sats : r.b_change_sats)
</script>

<template>
  <div class="tango">
    <div class="card">
      <div class="card-header">Tango</div>
      <div class="card-body">
        <p class="muted">
          You and one connected person each put in the same amount and each take
          the same amount back. Nobody pays anybody. Because the two outputs are
          identical, someone reading the chain cannot tell which one is yours.
        </p>
        <p class="muted">
          That is an anonymity set of two — a coin flip, not anonymity, though
          it compounds if you do it again with someone else. And it hides
          nothing from the server running this, which sees both sides. Tango is
          protection against someone reading the chain.
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

    <div v-if="waiting.length" class="card">
      <div class="card-header">Waiting on you</div>
      <div class="card-body">
        <div v-for="r in waiting" :key="r.id" class="tg-row">
          <div class="tg-head">
            <strong>with {{ partnerOf(r) }}</strong>
            <span class="pill">{{ r.status.toLowerCase() }}</span>
          </div>
          <div>{{ sats(r.denom_sats) }} each</div>
          <div v-if="r.fee_sats != null" class="muted small">
            your fee {{ sats(myFee(r)) }} · {{ r.vsize }} vB
            <template v-if="myChange(r)"> · your change {{ sats(myChange(r)) }}</template>
          </div>
          <div v-if="r.clean === false" class="muted small warn">
            Change on one or both sides. An observer can often work out which
            output is whose from the amounts.
          </div>
          <div v-else-if="r.clean === true" class="muted small good">
            No change either side — nothing to work out from the amounts.
          </div>
          <div class="tg-actions">
            <button v-if="r.status === 'PROPOSED'"
                    class="btn btn-sm btn-primary"
                    :disabled="busy === r.id || !hasKeys || !chosen.length"
                    @click="accept(r)">
              {{ busy === r.id ? 'Matching…' : 'Match it' }}
            </button>
            <button v-else class="btn btn-sm btn-primary"
                    :disabled="busy === r.id || !hasKeys"
                    @click="sign(r)">
              {{ busy === r.id ? 'Signing…' : 'Sign' }}
            </button>
            <button class="btn btn-sm btn-ghost" :disabled="busy === r.id"
                    @click="cancel(r)">
              Cancel
            </button>
          </div>
          <p v-if="r.status === 'PROPOSED' && !chosen.length" class="muted small">
            Choose your coins below first — matching derives your outputs from
            the whole input set, so it cannot happen before yours are in it.
          </p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Your coins</div>
      <div class="card-body">
        <p v-if="!coins.length" class="muted">No spendable coins.</p>
        <label v-for="c in coins" :key="outpoint(c)" class="tg-coin">
          <input type="checkbox" :checked="picked.has(outpoint(c))" @change="toggle(c)" />
          <span class="tg-coin-body">
            <span>{{ sats(c.amount) }}</span>
            <span class="muted small mono">
              <template v-if="c.label">{{ c.label }} · </template>{{ c.txid.slice(0, 16) }}…:{{ c.vout }}
            </span>
          </span>
        </label>

        <p v-if="chosen.length" class="muted small">
          {{ chosen.length }} chosen · {{ sats(chosenTotal) }}
          <template v-if="preview && !preview.error">
            · your fee about {{ preview.fee.toLocaleString() }} sats
          </template>
        </p>
        <div v-if="preview && preview.error" class="alert alert-warn">
          {{ preview.error }}
        </div>
        <p class="muted small">
          <template v-if="preview && !preview.error && preview.change">
            This selection leaves {{ preview.change.toLocaleString() }} sats of
            change. The mix still works, but change plus your share adds up to
            what you put in — which is often enough for someone to tell the two
            apart. A selection close to the amount plus your fee share is
            stronger.
          </template>
          <template v-else-if="preview && !preview.error">
            No change from this selection. That is the strongest shape: coins
            in, two identical coins out, nothing to add up.
          </template>
          <template v-else>
            Pick the coins that go in. Which ones you choose is the decision a
            mix is made of, so nothing here chooses for you.
          </template>
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Start one</div>
      <div class="card-body">
        <div class="row">
          <label>
            Their username
            <input v-model="partner" type="text" autocapitalize="none" placeholder="username" />
          </label>
          <label>
            Amount each (sats)
            <input v-model.number="denom" type="number" min="1" placeholder="0" />
          </label>
          <label>
            Fee rate (sat/vB)
            <input v-model.number="feeRate" type="number" min="1" />
          </label>
        </div>
        <button class="btn btn-primary"
                :disabled="busy === 'propose' || !partner.trim() || !denom ||
                           !chosen.length || !hasKeys || !!preview?.error"
                @click="propose">
          {{ busy === 'propose' ? 'Proposing…' : 'Propose' }}
        </button>
        <p class="muted small">
          They have to be a connected user, and they choose their own coins.
          Both of you get the same amount back, so nobody is paying anybody —
          the point is that the two outputs look the same.
        </p>
      </div>
    </div>

    <div v-if="others.length" class="card">
      <div class="card-header">Rounds</div>
      <div class="card-body">
        <div v-for="r in others" :key="r.id" class="tg-row">
          <div class="tg-head">
            <strong>with {{ partnerOf(r) }}</strong>
            <span class="pill">{{ r.status.toLowerCase() }}</span>
          </div>
          <div>{{ sats(r.denom_sats) }} each</div>
          <div v-if="r.fee_sats != null" class="muted small">
            your fee {{ sats(myFee(r)) }} · {{ r.vsize }} vB
            <template v-if="myChange(r)"> · your change {{ sats(myChange(r)) }}</template>
          </div>
          <div v-if="r.txid" class="muted small mono">{{ r.txid }}</div>
          <div class="tg-actions">
            <button v-if="r.status !== 'BROADCAST' && r.status !== 'CANCELLED'"
                    class="btn btn-sm btn-ghost" :disabled="busy === r.id"
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
.tg-row { padding: 10px 0; border-bottom: 1px solid var(--border, #2a2a2a); }
.tg-row:last-child { border-bottom: 0; }
.tg-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.tg-actions { display: flex; gap: 8px; margin-top: 8px; }
.tg-coin {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0; cursor: pointer;
  border-bottom: 1px solid var(--border, #2a2a2a);
}
.tg-coin:last-of-type { border-bottom: 0; }
.tg-coin-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.small { font-size: 12px; }
.warn { color: var(--warn, #d08a30); }
.good { color: var(--ok, #3fa86a); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
</style>
