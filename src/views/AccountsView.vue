<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'

const auth   = useAuthStore()
const router = useRouter()

const isAdmin   = ref(false)
const meLoading = ref(true)

const accounts  = ref([])
const loading   = ref(true)
const loadError = ref(null)

// selection + delete flow
const selected  = ref(null)     // the account object being deleted
const confirm   = ref('')
const delBitmail = ref(true)
const busy      = ref(false)
const delError  = ref(null)

async function loadMe() {
  meLoading.value = true
  try {
    const me = await api.getMe(auth.inkey)
    isAdmin.value = !!me.is_admin
  } catch { isAdmin.value = false }
  finally { meLoading.value = false }
}

async function loadAccounts() {
  loading.value = true; loadError.value = null
  try {
    accounts.value = (await api.adminAccountsList(auth.adminkey)).accounts || []
  } catch (e) {
    loadError.value = e.detail || e.message || 'Could not load accounts.'
  } finally { loading.value = false }
}

function selectForDelete(a) {
  if (a.is_self) return
  selected.value = a
  confirm.value = ''
  delBitmail.value = !!(a.bitmail_addresses && a.bitmail_addresses.length)
  delError.value = null
}
function cancelDelete() {
  selected.value = null; confirm.value = ''; delError.value = null
}

async function doDelete() {
  if (!selected.value) return
  delError.value = null
  if (confirm.value.trim() !== selected.value.username) {
    delError.value = 'Type the exact username to confirm.'
    return
  }
  busy.value = true
  try {
    await api.adminAccountDelete(auth.adminkey, selected.value.username, confirm.value.trim(), delBitmail.value)
    pushToast(`Deleted account “${selected.value.username}”.`, { type: 'success' })
    selected.value = null; confirm.value = ''
    await loadAccounts()
  } catch (e) {
    delError.value = e.detail || e.message || 'Delete failed.'
  } finally { busy.value = false }
}

onMounted(async () => {
  await loadMe()
  if (!isAdmin.value) { router.replace({ name: 'login' }); return }
  await loadAccounts()
})
</script>

<template>
  <div class="page-wrap">
    <div class="page-inner">
      <div class="page-header">
        <h1>Accounts</h1>
        <p class="text-dim text-sm" style="margin-top:2px">View and delete user accounts</p>
      </div>

      <div v-if="meLoading" class="text-center text-dim" style="padding:30px">
        <span class="spinner"></span> Loading…
      </div>

      <template v-else-if="isAdmin">
        <div class="alert alert-warn" style="font-size:13px;margin-bottom:16px">
          <b>Deleting an account is permanent.</b> It removes the user's account, wallets, PayJoin data, contacts, devices, and BitMail records. It does <b>not</b> move on-chain funds — coins remain controlled by the user's seed. If they haven't backed up their seed, deletion may make their funds unrecoverable.
        </div>

        <div v-if="loading" class="text-center text-dim" style="padding:24px"><span class="spinner"></span> Loading accounts…</div>
        <div v-else-if="loadError" class="text-sm" style="color:var(--red)">{{ loadError }}</div>
        <div v-else-if="!accounts.length" class="text-dim text-sm">No accounts found.</div>

        <div v-else class="card">
          <div class="card-body" style="padding:0">
            <div v-for="a in accounts" :key="a.user_id" class="acct-row">
              <div style="min-width:0">
                <div class="text-sm">
                  <b>{{ a.username }}</b>
                  <span v-if="a.is_self" class="badge badge-dim" style="margin-left:6px">you</span>
                </div>
                <div class="text-dim text-xs" style="margin-top:2px">
                  <span v-if="a.email">{{ a.email }} · </span>
                  {{ a.wallet_count }} wallet{{ a.wallet_count === 1 ? '' : 's' }}
                  <span v-if="a.bitmail_addresses && a.bitmail_addresses.length"> · {{ a.bitmail_addresses.join(', ') }}</span>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" :disabled="a.is_self" :title="a.is_self ? 'You can\'t delete your own account here' : 'Delete this account'"
                      style="flex-shrink:0" @click="selectForDelete(a)">Delete</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="selected" class="modal-overlay" @click.self="cancelDelete">
      <div class="card modal" style="max-width:440px">
        <div class="card-header"><h2 style="color:var(--red)">Delete “{{ selected.username }}”?</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="text-dim text-sm">
            {{ selected.wallet_count }} wallet{{ selected.wallet_count === 1 ? '' : 's' }}<span v-if="selected.bitmail_addresses && selected.bitmail_addresses.length"> · BitMail: {{ selected.bitmail_addresses.join(', ') }}</span>.
            This cannot be undone.
          </div>
          <label v-if="selected.bitmail_addresses && selected.bitmail_addresses.length" class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="delBitmail" /> Also remove their BitMail DNS records
          </label>
          <div class="field">
            <label>Type <b>{{ selected.username }}</b> to confirm</label>
            <input class="input" v-model="confirm" :placeholder="selected.username" />
          </div>
          <div v-if="delError" class="text-sm" style="color:var(--red)">{{ delError }}</div>
          <div class="flex gap-2" style="justify-content:flex-end">
            <button class="btn btn-ghost" @click="cancelDelete">Cancel</button>
            <button class="btn" style="background:var(--red);color:#fff"
                    :disabled="busy || confirm.trim() !== selected.username" @click="doDelete">
              {{ busy ? 'Deleting…' : 'Permanently delete' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.acct-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--border); }
.acct-row:last-child { border-bottom:none; }
</style>
