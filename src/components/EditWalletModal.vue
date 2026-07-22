<script setup>
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'

const props = defineProps({
  show:      { type: Boolean, default: false },
  wallet:    { type: Object,  default: null  },
  minHeight: { type: Number,  default: 0     },  // system minimum block height
})
const emit = defineEmits(['close', 'updated'])

const auth  = useAuthStore()
const form  = ref({ title: '', last_height: '' })
const saving = ref(false)
const error  = ref(null)
const saved  = ref(false)

watch(() => props.wallet, (w) => {
  if (w) {
    form.value = {
      title:       w.title       || '',
      last_height: w.last_height || '',
    }
    error.value = null
    saved.value = false
  }
}, { immediate: true })

async function save() {
  if (!props.wallet) return
  // Enforce system minimum block height — a wallet can't be born before the
  // network's configured minimum scan height.
  const h = Number(form.value.last_height)
  if (props.minHeight > 0 && Number.isFinite(h) && h < props.minHeight) {
    error.value = `Born-at height can't be below the system minimum of ${props.minHeight}.`
    return
  }
  saving.value = true; error.value = null; saved.value = false
  try {
    await api.updateSilntWallet(auth.inkey, props.wallet.id, form.value)
    saved.value = true
    setTimeout(() => {
      emit('updated')
      emit('close')
    }, 800)
  } catch (e) { error.value = e.message }
  finally { saving.value = false }
}
</script>

<template>
  <div v-if="show && wallet" class="modal-overlay" @click.self="emit('close')">
    <div class="card modal edit-modal">
      <div class="card-header">
        <h2>Edit Wallet</h2>
        <button class="btn btn-ghost btn-sm btn-icon" @click="emit('close')">✕</button>
      </div>
      <div class="card-body">
        <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px">
          <div class="field">
            <label>Title</label>
            <input class="input" v-model="form.title" placeholder="My SP Wallet" required />
          </div>
          <div class="field">
            <label>Born at Height</label>
            <input class="input" v-model.number="form.last_height" type="number" :min="minHeight || 0" :placeholder="String(minHeight || 840000)" />
            <span v-if="minHeight > 0" class="text-dim text-xs">Must be at least the system minimum of {{ minHeight }}.</span>
          </div>
          <div v-if="wallet.hr_address" class="field">
            <label>BitMail Address</label>
            <div class="sp-readonly mono text-green">{{ wallet.hr_address }}</div>
            <span class="text-dim text-xs">Managed via the BitMail request flow — not editable here.</span>
          </div>

          <!-- Read-only SP address for reference -->
          <div class="field">
            <label>SP Address (read-only)</label>
            <div class="sp-readonly mono text-orange">{{ wallet.sp_address }}</div>
          </div>

          <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>
          <div v-if="saved" class="alert alert-success">✓ Wallet updated.</div>

          <div class="flex gap-2 justify-between" style="margin-top:4px">
            <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <span v-if="saving" class="spinner" style="border-top-color:#000"></span>
              {{ saving ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-modal { max-width: 460px; }
.sp-readonly {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 11px;
  word-break: break-all;
  line-height: 1.6;
  color: var(--orange);
  opacity: .7;
}
@media (max-width: 480px) {
  .edit-modal { max-width: 100%; }
}
</style>
