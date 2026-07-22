<template>
  <div class="login-page">
    <div class="login-card">
      <div class="card-body">
        <div class="login-header">
          <div class="header-icon">
            <img src="/icon.png" alt="Thrilla" />
          </div>
          <h1>Create Account</h1>
          <p class="text-dim">Register for Thrilla</p>
        </div>

        <!-- Verification email sent — replaces the form -->
        <div v-if="success" style="text-align:center;padding:8px 0">
          <div style="font-size:48px;margin-bottom:12px">📧</div>
          <h2 style="margin-bottom:8px">Check your email</h2>
          <p class="text-dim" style="margin-bottom:8px">
            We've sent a verification link to
          </p>
          <p class="mono text-orange" style="margin-bottom:20px;font-size:13px;word-break:break-all">
            {{ registeredEmail }}
          </p>
          <p class="text-dim text-sm" style="margin-bottom:24px">
            Click the link in the email within 1 hour to activate your account.
            Don't forget to check your spam folder.
          </p>
          <router-link to="/login" class="btn btn-ghost w-full" style="display:block;text-decoration:none">← Back to sign in</router-link>
        </div>

        <form v-else @submit.prevent="handleRegister">
          <div class="field" style="margin-bottom:14px">
            <label>Username</label>
            <input
              class="input"
              v-model="username"
              type="text"
              placeholder="satoshi"
              autocomplete="username"
              spellcheck="false"
              required
              minlength="3"
              maxlength="32"
            />
          </div>

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
          </div>

          <div class="field" style="margin-bottom:14px">
            <label>Password</label>
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
              <button
                type="button"
                class="password-toggle"
                @click="showPassword = !showPassword"
                :title="showPassword ? 'Hide password' : 'Show password'"
              >
                <span v-if="showPassword">👁</span>
                <span v-else>🙈</span>
              </button>
            </div>
            <span class="text-dim text-xs">Minimum 8 characters.</span>
          </div>

          <div class="field" style="margin-bottom:14px">
            <label>Confirm Password</label>
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

          <!-- Math captcha -->
          <div class="field" style="margin-bottom:14px">
            <label>Verification — solve to continue</label>
            <div style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px">
              <span class="mono" style="font-size:15px;flex:1;letter-spacing:0.06em">
                {{ captcha.a }} {{ captcha.op }} {{ captcha.b }} = ?
              </span>
              <input
                class="input"
                v-model.number="captchaAnswer"
                type="number"
                style="width:80px;text-align:center;font-family:var(--font-mono)"
                required
              />
              <button type="button" class="btn btn-ghost btn-sm btn-icon" @click="newCaptcha" title="New question">↻</button>
            </div>
          </div>

          <div v-if="error" class="alert alert-error" style="margin-bottom:14px">⚠ {{ error }}</div>
          

          <button class="btn btn-primary w-full" type="submit" :disabled="loading || !canSubmit">
            <span v-if="loading" class="spinner" style="border-top-color:#000"></span>
            {{ loading ? 'CREATING…' : 'CREATE ACCOUNT' }}
          </button>

          <div class="login-footer" style="margin-top:18px;text-align:center">
            <router-link to="/login" class="text-dim text-sm">Already have an account? <span class="text-orange">Sign in</span></router-link>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'

const router = useRouter()
const auth   = useAuthStore()

const username      = ref('')
const email         = ref('')
const password         = ref('')
const passwordConfirm  = ref('')
const showPassword     = ref(false)
const error         = ref(null)
const success       = ref(false)
const registeredEmail = ref('')
const loading       = ref(false)

const captcha       = ref({ a: 0, b: 0, op: '+', answer: 0 })
const captchaAnswer = ref(null)

function newCaptcha() {
  const a  = Math.floor(Math.random() * 9) + 2
  const b  = Math.floor(Math.random() * 9) + 1
  const op = Math.random() > 0.5 ? '+' : '×'
  captcha.value = {
    a, b, op,
    answer: op === '+' ? a + b : a * b,
  }
  captchaAnswer.value = null
}

const canSubmit = computed(() =>
  username.value.length >= 3 &&
  email.value.includes('@') &&
  password.value.length >= 8 &&
  password.value === passwordConfirm.value &&
  captchaAnswer.value !== null
)

async function handleRegister() {
  error.value = null

  if (password.value !== passwordConfirm.value) {
    error.value = 'Passwords do not match.'
    return
  }

  if (captchaAnswer.value !== captcha.value.answer) {
    error.value = 'Captcha answer is incorrect. Try again.'
    newCaptcha()
    return
  }

  loading.value = true
  try {
    // Start registration — sends verification email, does NOT create account yet
    await api.startRegistration(username.value.trim(), password.value, email.value.trim())
    registeredEmail.value = email.value.trim()
    success.value = true
    // No auto-login or redirect — user must verify by email first
  } catch (e) {
    error.value = e.message || 'Registration failed.'
    newCaptcha()
  } finally {
    loading.value = false
  }
}

onMounted(newCaptcha)
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
