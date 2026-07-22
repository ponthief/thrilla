<template>
  <div class="login-page">
    <div class="login-card">
      <div class="card-body" style="text-align:center">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="Thrilla" />
          </div>
        </div>

        <div v-if="loading">
          <div class="spinner" style="width:32px;height:32px;margin:24px auto;border-width:3px"></div>
          <h2 style="margin-bottom:8px">Verifying your email…</h2>
          <p class="text-dim">Activating your account.</p>
        </div>

        <div v-else-if="success">
          <div style="font-size:48px;margin-bottom:12px">✓</div>
          <h2 style="margin-bottom:8px">Account activated!</h2>
          <p class="text-dim" style="margin-bottom:8px">Welcome,</p>
          <p class="mono text-orange" style="margin-bottom:24px;font-size:14px">{{ username }}</p>
          <p class="text-dim text-sm" style="margin-bottom:24px">You can now sign in to Thrilla.</p>
          <router-link to="/login" class="btn btn-primary w-full" style="display:block;text-decoration:none">SIGN IN</router-link>
        </div>

        <div v-else>
          <div style="font-size:48px;margin-bottom:12px">⚠</div>
          <h2 style="margin-bottom:8px">Verification failed</h2>
          <p class="text-dim" style="margin-bottom:8px">{{ error }}</p>
          <p class="text-dim text-sm" style="margin-bottom:24px">
            Verification links expire after 1 hour. Please register again.
          </p>
          <router-link to="/register" class="btn btn-primary w-full" style="display:block;text-decoration:none">REGISTER AGAIN</router-link>
          <router-link to="/login" class="text-dim text-sm" style="display:inline-block;margin-top:16px">← Back to sign in</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as api from '@/api'

const route   = useRoute()

const loading  = ref(true)
const success  = ref(false)
const username = ref('')
const error    = ref('')

onMounted(async () => {
  const token = route.query.token
  if (!token) {
    loading.value = false
    error.value = 'No verification token in the link.'
    return
  }

  try {
    const res = await api.verifyRegistration(token)
    if (res && res.success) {
      success.value  = true
      username.value = res.username
    } else {
      error.value = 'Verification could not be completed.'
    }
  } catch (e) {
    error.value = e.message || 'Invalid or expired verification link.'
  } finally {
    loading.value = false
  }
})
</script>
