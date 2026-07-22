<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'

const route   = useRoute()
const router  = useRouter()
const loading = ref(true)
const result  = ref(null)
const error   = ref(null)

onMounted(async () => {
  const token = route.query.token
  if (!token) {
    error.value = 'Missing confirmation token.'
    loading.value = false
    return
  }
  try {
    result.value = await api.confirmDevice(token)
  } catch (e) {
    error.value = e.message || 'Confirmation failed.'
  } finally {
    loading.value = false
  }
})

function goToLogin() {
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-inner">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="" />
          </div>
          <h1 v-if="loading">Confirming device…</h1>
          <h1 v-else-if="result && result.confirmed">✓ Device confirmed</h1>
          <h1 v-else>Confirmation failed</h1>
        </div>

        <div v-if="loading" style="text-align:center;padding:20px 0">
          <span class="spinner"></span>
        </div>

        <div v-else-if="result && result.confirmed">
          <p class="text-sm" style="margin-bottom:16px">
            This device is now trusted. You can sign in normally from here.
          </p>
          <p class="text-dim text-xs" style="margin-bottom:18px">
            Trusted devices: {{ result.device_count }} / {{ result.cap }}
          </p>
          <button class="btn btn-primary w-full" @click="goToLogin">
            Continue to sign in
          </button>
        </div>

        <div v-else>
          <div class="alert alert-error" style="margin-bottom:14px">⚠ {{ error }}</div>
          <p class="text-dim text-sm">
            The link may have expired or already been used. Sign in again from the
            original device to request a new confirmation email.
          </p>
          <router-link to="/login" class="btn btn-ghost w-full" style="margin-top:14px">
            Back to sign in
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
