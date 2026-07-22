<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'

const auth   = useAuthStore()
const router = useRouter()

// Code-based device confirmation. The user sends a 6-digit code to their email,
// then types it into THIS browser (the one signing in). Verifying sets the
// trusted cookie on this browser — so the correct browser is trusted regardless
// of which browser opens the email (fixes the default-browser mix-up).
const codeSent   = ref(false)
const code       = ref('')
const cap        = ref(5)
const sending    = ref(false)
const verifying  = ref(false)
const sentOk     = ref(false)
const error      = ref(null)
const cooldown   = ref(0)
let cooldownTimer = null
function startCooldown(secs = 60) {
  cooldown.value = secs
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) clearInterval(cooldownTimer)
  }, 1000)
}

const goHome = () => {
  const home = (import.meta.env.VITE_APP_ROLE || 'user') === 'admin' ? 'admin' : 'wallets'
  router.replace({ name: home })
}

// Poll-only: is this device already trusted? (No email, no mutation.)
async function pollTrusted() {
  error.value = null
  try {
    const res = await api.deviceCheck(auth.inkey)
    if (res && res.cap) cap.value = res.cap
    if (res.status === 'trusted') { goHome(); return true }
    return false
  } catch (e) {
    error.value = e.message || 'Could not check device status.'
    return false
  }
}

// Send (or re-send) the emailed code.
async function sendCode() {
  if (sending.value || cooldown.value > 0) return
  sending.value = true; sentOk.value = false; error.value = null
  try {
    const res = await api.requestDeviceConfirm(auth.inkey)
    if (res && res.status === 'already-trusted') { goHome(); return }
    codeSent.value = true
    sentOk.value = true
    startCooldown(60)
  } catch (e) {
    error.value = e.detail || e.message || 'Could not send the confirmation code.'
  } finally {
    sending.value = false
  }
}

// Verify the typed code. On success, THIS browser is trusted.
async function verifyCode() {
  if (verifying.value) return
  const c = (code.value || '').trim()
  if (!/^\d{6}$/.test(c)) { error.value = 'Enter the 6-digit code from your email.'; return }
  verifying.value = true; error.value = null
  try {
    await api.verifyDeviceCode(auth.inkey, c)
    goHome()
  } catch (e) {
    error.value = e.detail || e.message || 'That code is incorrect or expired.'
  } finally {
    verifying.value = false
  }
}

function backToLogin() {
  auth.logout()
  router.replace({ name: 'login' })
}

onMounted(async () => { await pollTrusted() })
onBeforeUnmount(() => { clearInterval(cooldownTimer) })
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-inner">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="" />
          </div>
          <h1>Confirm this device</h1>
          <p v-if="!codeSent" class="text-dim text-sm" style="margin-top:6px">
            This device isn't trusted yet. We'll email you a 6-digit code — enter it
            here to trust this device. Required before you can use the wallet.
          </p>
          <p v-else class="text-dim text-sm" style="margin-top:6px">
            We emailed you a 6-digit code. Enter it below on this device. You can open
            the email anywhere — just type the code here.
          </p>
        </div>

        <div v-if="sentOk" class="alert alert-success" style="margin-bottom:12px">
          ✓ Code sent. Check your email.
        </div>
        <div v-if="error" class="alert alert-error" style="margin-bottom:12px">
          ⚠ {{ error }}
        </div>

        <div v-if="codeSent" style="margin-bottom:12px">
          <input
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            class="code-input"
            @keyup.enter="verifyCode"
          />
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <button v-if="codeSent" class="btn btn-primary" :disabled="verifying" @click="verifyCode">
            <span v-if="verifying" class="spinner"></span>
            <span v-else>Verify &amp; trust this device</span>
          </button>
          <button class="btn" :class="codeSent ? 'btn-ghost' : 'btn-primary'"
                  :disabled="sending || cooldown > 0" @click="sendCode">
            <span v-if="sending" class="spinner"></span>
            <span v-else-if="cooldown > 0">{{ codeSent ? 'Re-send' : 'Send' }} code in {{ cooldown }}s</span>
            <span v-else>{{ codeSent ? 'Re-send code' : 'Send confirmation code' }}</span>
          </button>
          <button class="btn btn-ghost" @click="backToLogin">Back to sign in</button>
        </div>

        <p class="text-dim text-xs" style="margin-top:18px;text-align:center">
          Code expires in 10 minutes. Up to {{ cap }} devices may be trusted per account.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-input {
  width: 100%;
  text-align: center;
  font-size: 28px;
  letter-spacing: 10px;
  font-family: monospace;
  padding: 12px;
  border-radius: 8px;
}
</style>
