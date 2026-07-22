<template>
  <div class="login-page">
    <div class="login-card">
      <div class="card-body">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="Thrilla" />
          </div>
          <h1>Forgot Password</h1>
          <p class="text-dim">Reset your password via email</p>
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="field" style="margin-bottom:14px">
            <label>Email</label>
            <input
              class="input"
              v-model="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              spellcheck="false"
              required
            />
            <span class="text-dim text-xs">We'll email a password reset link to this address if it's registered. The link expires after a short time.</span>
          </div>

          <div v-if="error" class="alert alert-error" style="margin-bottom:14px">⚠ {{ error }}</div>
          <div v-if="sent" class="alert alert-success" style="margin-bottom:14px">
            ✓ If <strong>{{ email }}</strong> is registered, a reset link is on its way. Check your inbox.
          </div>

          <button class="btn btn-primary w-full" type="submit" :disabled="loading || !email">
            <span v-if="loading" class="spinner" style="border-top-color:#000"></span>
            {{ loading ? 'SENDING…' : 'SEND RESET LINK' }}
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
import { ref } from 'vue'
import * as api from '@/api'

const email   = ref('')
const error   = ref(null)
const sent    = ref(false)
const loading = ref(false)

async function handleSubmit() {
  error.value = null
  sent.value  = false
  loading.value = true
  try {
    await api.requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (e) {
    // Don't leak whether the email exists — show generic message either way
    if (e.message && e.message.toLowerCase().includes('smtp')) {
      error.value = 'Email login is not available on this server. Contact your administrator to reset your password.'
    } else {
      // Show generic success even on "user not found" so attackers can't enumerate emails
      sent.value = true
    }
  } finally {
    loading.value = false
  }
}
</script>
