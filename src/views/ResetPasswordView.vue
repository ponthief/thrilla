<template>
  <div class="login-page">
    <div class="login-card">
      <div class="card-body">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="Thrilla" />
          </div>
          <h1>Set New Password</h1>
          <p class="text-dim">Choose a password for your account</p>
        </div>

        <div v-if="!resetKey" class="alert alert-error" style="margin-bottom:16px">
          ⚠ No reset key in the URL. Make sure you clicked the full link from the email.
        </div>

        <form v-else @submit.prevent="handleReset">
          <div class="field" style="margin-bottom:14px">
            <label>New Password</label>
            <div class="password-wrap">
              <input
                class="input password-input"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••••••"
                autocomplete="new-password"
                required
                minlength="8"
              />
              <button type="button" class="password-toggle"
                @click="showPassword = !showPassword"
                :title="showPassword ? 'Hide password' : 'Show password'">
                <span v-if="showPassword">👁</span>
                <span v-else>🙈</span>
              </button>
            </div>
            <span class="text-dim text-xs">Minimum 8 characters.</span>
          </div>

          <div class="field" style="margin-bottom:14px">
            <label>Confirm New Password</label>
            <div class="password-wrap">
              <input
                class="input password-input"
                v-model="passwordConfirm"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••••••"
                autocomplete="new-password"
                required
                minlength="8"
                :class="{ 'input-mismatch': passwordConfirm && passwordConfirm !== password }"
              />
            </div>
            <span v-if="passwordConfirm && passwordConfirm !== password" class="text-red text-xs">⚠ Passwords do not match.</span>
            <span v-else-if="passwordConfirm && passwordConfirm === password" class="text-orange text-xs">✓ Passwords match.</span>
          </div>

          <div v-if="error" class="alert alert-error" style="margin-bottom:14px">⚠ {{ error }}</div>
          <div v-if="success" class="alert alert-success" style="margin-bottom:14px">✓ Password updated. Redirecting…</div>

          <button class="btn btn-primary w-full" type="submit"
            :disabled="loading || !canSubmit">
            <span v-if="loading" class="spinner" style="border-top-color:#000"></span>
            {{ loading ? 'UPDATING…' : 'SET NEW PASSWORD' }}
          </button>

          <div class="login-footer" style="margin-top:18px;text-align:center">
            <router-link to="/login" class="text-dim text-sm">← Back to sign in</router-link>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'

const route   = useRoute()
const router  = useRouter()

const resetKey         = ref('')
const password         = ref('')
const passwordConfirm  = ref('')
const showPassword     = ref(false)
const error            = ref(null)
const success          = ref(false)
const loading          = ref(false)

const canSubmit = computed(() =>
  resetKey.value &&
  password.value.length >= 8 &&
  password.value === passwordConfirm.value
)

async function handleReset() {
  error.value = null
  if (password.value !== passwordConfirm.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await api.performPasswordReset(resetKey.value, password.value)
    success.value = true
    setTimeout(() => router.push({ name: 'login' }), 1500)
  } catch (e) {
    error.value = e.message || 'Reset failed. The link may have expired — request a new one.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  resetKey.value = route.query.key || ''
})
</script>

<style scoped>
.password-wrap { position: relative; display: flex; align-items: center; }
.password-input { padding-right: 44px; }
.password-toggle {
  position: absolute; right: 10px; background: none; border: none; cursor: pointer;
  font-size: 15px; padding: 4px; line-height: 1; opacity: .6; transition: opacity .15s;
}
.password-toggle:hover { opacity: 1; }
.input-mismatch { border-color: #ef4444 !important; }
.text-red { color: #ef4444; }
</style>
