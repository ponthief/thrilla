<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as api from '@/api'
import { pushToast } from '@/stores/toasts'

const BITMAIL_ENABLED = import.meta.env.VITE_DISABLE_BIP353 !== 'true'

const auth   = useAuthStore()
const router = useRouter()

const isAdmin   = ref(false)
const meLoading = ref(true)

// System config (BlindBit / network / limits)
const config  = ref({ blindbit_url: '', mempool_url: 'https://mempool.space', boltz_url: '', min_scan_height: 0, dust_threshold_sats: 5000, fulcrum_host: '', fulcrum_port: 50001, fulcrum_tls: false, login_scan_enabled: true, login_scan_auto_threshold: 432 })
const loading = ref(true)
const saving  = ref(false)
const error   = ref(null)
const saved   = ref(false)

// Cloudflare config (powers BitMail)
const cfConfig  = ref({ api_token: '', zone_id: '', domain: '' })
const cfSaving  = ref(false)
const cfSaved   = ref(false)
const cfError   = ref(null)
const showToken = ref(false)

// Ntfy notifications config
const ntfy        = ref({ enabled: false, server_url: 'https://ntfy.sh', topics: [], access_token: '', username: '', password: '', priority: 'default' })
const ntfySaving  = ref(false)
const ntfySaved   = ref(false)
const ntfyError   = ref(null)
const ntfyTesting = ref(false)
const showNtfyToken = ref(false)
const showNtfyPass = ref(false)

// BitMail request queue moved to BitMailRequestsView (its own side-menu item).

// ── BlindBit Oracle health ────────────────────────────────────────────────
// Health = BlindBit reachable AND in sync with the chain tip (mempool height).
// Comparing heights is robust to bursty block production (mainnet can go hours
// with no new block); a real problem shows up as BlindBit falling behind the tip.
const health = ref(null)            // { ok, in_sync, blindbit_height, tip_height, behind_by, latency_ms, error }

// Admin alerts (e.g. BitMail tampering detected on a send)
const alerts = ref([])
const alertsLoading = ref(false)
async function loadAlerts() {
  alertsLoading.value = true
  try {
    const res = await api.getAdminAlerts(auth.adminkey)
    alerts.value = res.alerts || []
  } catch { /* non-fatal */ }
  finally { alertsLoading.value = false }
}
async function ackAlert(a) {
  try {
    await api.ackAdminAlert(auth.adminkey, a.id)
    alerts.value = alerts.value.filter(x => x.id !== a.id)
  } catch (e) { pushToast(e.detail || e.message || 'Could not dismiss alert.', { type: 'error' }) }
}
const healthCheckedAt = ref(null)
const healthLoading = ref(false)
let healthTimer = null

async function checkHealth() {
  healthLoading.value = true
  try {
    health.value = await api.getBlindbitHealth(auth.adminkey)
    healthCheckedAt.value = new Date()
  } catch (e) {
    health.value = { ok: false, in_sync: false, error: 'Could not reach the health endpoint.',
                     blindbit_height: null, tip_height: null, behind_by: null, latency_ms: null }
    healthCheckedAt.value = new Date()
  } finally {
    healthLoading.value = false
  }
}

function healthAgeText() {
  if (!healthCheckedAt.value) return ''
  const secs = Math.round((Date.now() - healthCheckedAt.value.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  return `${Math.round(secs / 60)}m ago`
}

// ── Fulcrum (Electrum) health ─────────────────────────────────────────────
// Health = Fulcrum reachable AND in sync with the chain tip. Same model as
// BlindBit. Used by the PayJoin feature (watch-only UTXO sync).
const fhealth = ref(null)
const fhealthCheckedAt = ref(null)
const fhealthLoading = ref(false)
let fhealthTimer = null
let alertsTimer = null

async function checkFulcrumHealth() {
  fhealthLoading.value = true
  try {
    fhealth.value = await api.getFulcrumHealth(auth.adminkey)
    fhealthCheckedAt.value = new Date()
  } catch (e) {
    fhealth.value = { ok: false, in_sync: false, error: 'Could not reach the health endpoint.',
                      fulcrum_height: null, tip_height: null, behind_by: null, latency_ms: null }
    fhealthCheckedAt.value = new Date()
  } finally {
    fhealthLoading.value = false
  }
}

function fhealthAgeText() {
  if (!fhealthCheckedAt.value) return ''
  const secs = Math.round((Date.now() - fhealthCheckedAt.value.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  return `${Math.round(secs / 60)}m ago`
}

async function loadMe() {
  try {
    const me = await api.getMe(auth.inkey)
    isAdmin.value = !!me.is_admin
  } catch (e) { isAdmin.value = false }
  finally { meLoading.value = false }
  if (!isAdmin.value) {
    // Non-admins shouldn't be here. In the admin portal build there is no user
    // UI to fall back to, so log them out to the login screen; in a combined
    // build, send them to user Settings.
    const isAdminBuild = (import.meta.env.VITE_APP_ROLE || 'user') === 'admin'
    if (isAdminBuild) {
      auth.logout()
      router.replace({ name: 'login', query: { notadmin: '1' } })
    } else {
      router.replace({ name: 'config' })
    }
  }
}

async function loadConfig() {
  loading.value = true; error.value = null
  try {
    config.value = await api.getBlindbitConfig(auth.adminkey)
    if (BITMAIL_ENABLED) {
      try { cfConfig.value = await api.getCloudflareConfig(auth.adminkey) } catch { /* may be unset */ }
    }
    try { ntfy.value = await api.getNtfyConfig(auth.adminkey) } catch { /* may be unset */ }
    ntfyTopicsText.value = (ntfy.value.topics || []).join('\n')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

async function saveConfig() {
  saving.value = true; error.value = null; saved.value = false
  try {
    config.value = await api.updateConfig(auth.adminkey, config.value)
    saved.value = true
    setTimeout(() => saved.value = false, 3000)
  } catch (e) { error.value = e.message }
  finally { saving.value = false }
}

async function saveCfConfig() {
  cfSaving.value = true; cfError.value = null; cfSaved.value = false
  try {
    cfConfig.value = await api.updateCloudflareConfig(auth.adminkey, cfConfig.value)
    cfSaved.value = true
    setTimeout(() => cfSaved.value = false, 3000)
  } catch (e) { cfError.value = e.message }
  finally { cfSaving.value = false }
}

// ntfy topics are edited as a comma/newline list in the UI but stored as an array.
const ntfyTopicsText = ref('')
function syncNtfyTopicsFromText() {
  ntfy.value.topics = ntfyTopicsText.value
    .split(/[\n,]+/).map(t => t.trim()).filter(Boolean)
}
async function saveNtfy() {
  ntfySaving.value = true; ntfyError.value = null; ntfySaved.value = false
  syncNtfyTopicsFromText()
  try {
    ntfy.value = await api.updateNtfyConfig(auth.adminkey, ntfy.value)
    ntfyTopicsText.value = (ntfy.value.topics || []).join('\n')
    ntfySaved.value = true
    setTimeout(() => ntfySaved.value = false, 3000)
  } catch (e) { ntfyError.value = e.detail || e.message }
  finally { ntfySaving.value = false }
}
async function testNtfy() {
  ntfyTesting.value = true; ntfyError.value = null
  try {
    const res = await api.testNtfy(auth.adminkey)
    pushToast(`Test sent to ${res.sent || 0} topic(s).`, { type: 'success' })
  } catch (e) { ntfyError.value = e.detail || e.message }
  finally { ntfyTesting.value = false }
}

function fmtDate(ts) { return new Date(ts * 1000).toLocaleString() }

onMounted(async () => {
  await loadMe()
  if (!isAdmin.value) return
  await loadConfig()
  checkHealth()
  healthTimer = setInterval(checkHealth, 60000)
  checkFulcrumHealth()
  fhealthTimer = setInterval(checkFulcrumHealth, 60000)
  loadAlerts()
  alertsTimer = setInterval(loadAlerts, 60000)
})
onBeforeUnmount(() => {
  if (healthTimer) clearInterval(healthTimer)
  if (fhealthTimer) clearInterval(fhealthTimer)
  if (alertsTimer) clearInterval(alertsTimer)
})
</script>

<template>
  <div class="page-wrap">
    <div class="page-inner">
      <div class="page-header">
        <h1>Admin</h1>
        <p class="text-dim text-sm" style="margin-top:2px">System settings — visible to administrators only</p>
      </div>

      <div v-if="meLoading" class="text-center text-dim" style="padding:30px">
        <span class="spinner"></span> Loading…
      </div>

      <template v-else-if="isAdmin">
        <!-- Security alerts (e.g. BitMail tampering) -->
        <div v-if="alerts.length" class="card" style="margin-bottom:16px;border:1px solid var(--red)">
          <div class="card-header"><h2 style="color:#ff7b72">⚠ Security Alerts ({{ alerts.length }})</h2></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
            <div v-for="a in alerts" :key="a.id"
                 style="border:1px solid rgba(255,123,114,.3);border-radius:10px;padding:12px;background:rgba(255,123,114,.05)">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:220px">
                  <strong>{{ a.title }}</strong>
                  <div class="text-sm text-dim" style="margin-top:4px">{{ a.detail }}</div>
                  <div class="text-xs text-dim" style="margin-top:4px">{{ new Date(a.created_at * 1000).toLocaleString() }}</div>
                </div>
                <button class="btn btn-ghost btn-sm" @click="ackAlert(a)">Dismiss</button>
              </div>
            </div>
          </div>
        </div>

        <!-- BlindBit Oracle health -->
        <div class="card" style="margin-bottom:16px"
             :style="health && health.ok && health.in_sync !== false ? '' : (health ? 'border:1px solid var(--red)' : '')">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <h2>BlindBit Oracle — Health</h2>
            <button class="btn btn-ghost btn-sm" :disabled="healthLoading" @click="checkHealth">
              {{ healthLoading ? 'Checking…' : '↻ Check now' }}
            </button>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            <!-- DOWN: oracle unreachable -->
            <div v-if="health && !health.ok" class="alert alert-error" style="margin:0">
              ⚠ <strong>Oracle is DOWN.</strong>
              {{ health.error || 'No response from the oracle.' }}
              Silent-Payment scanning will fail until it recovers.
            </div>
            <!-- BEHIND: reachable but lagging the chain tip -->
            <div v-else-if="health && health.ok && health.in_sync === false" class="alert alert-error" style="margin:0">
              ⚠ <strong>Oracle is out of sync</strong> — behind the chain tip by
              <strong>{{ health.behind_by }}</strong> block(s).
              BlindBit at <span class="mono">{{ health.blindbit_height }}</span>,
              chain tip <span class="mono">{{ health.tip_height }}</span>.
              New payments may not be detected until it catches up.
            </div>
            <!-- UP but couldn't fetch tip to compare -->
            <div v-else-if="health && health.ok && health.in_sync === null" class="alert alert-info" style="margin:0">
              Oracle is reachable, but the chain tip couldn't be fetched to verify sync.
              {{ health.error || '' }}
            </div>
            <!-- IN SYNC: healthy (no height shown, per design) -->
            <div v-else-if="health && health.ok" class="alert alert-success" style="margin:0">
              ✓ <strong>Oracle is up and in sync</strong> with the chain<span v-if="health.latency_ms != null"> · {{ health.latency_ms }} ms</span>.
            </div>
            <div v-else class="text-dim text-sm">Checking oracle status…</div>

            <div class="text-dim text-xs" style="display:flex;gap:14px;flex-wrap:wrap">
              <span v-if="healthCheckedAt">Last checked: {{ healthAgeText() }}</span>
              <span>Auto-checks every 60s</span>
            </div>
          </div>
        </div>

        <!-- Fulcrum (Electrum) health — used by PayJoin watch-only sync -->
        <div class="card" :style="fhealth && fhealth.ok && fhealth.in_sync !== false ? '' : (fhealth ? 'border:1px solid var(--red)' : '')">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <h2>Fulcrum (PayJoin)</h2>
            <button class="btn btn-ghost btn-sm" :disabled="fhealthLoading" @click="checkFulcrumHealth">
              {{ fhealthLoading ? 'Checking…' : '↻ Check now' }}
            </button>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            <div v-if="fhealth && !fhealth.ok" class="alert alert-error" style="margin:0">
              ✕ <strong>Fulcrum unreachable.</strong>
              {{ fhealth.error || 'No response from the server.' }}
              PayJoin UTXO sync will fail until it recovers.
            </div>
            <div v-else-if="fhealth && fhealth.ok && fhealth.in_sync === false" class="alert alert-error" style="margin:0">
              ⚠ <strong>Fulcrum is out of sync</strong> — behind the chain tip by
              <strong>{{ fhealth.behind_by }}</strong> block(s).
              Fulcrum at <span class="mono">{{ fhealth.fulcrum_height }}</span>,
              chain tip <span class="mono">{{ fhealth.tip_height }}</span>.
            </div>
            <div v-else-if="fhealth && fhealth.ok && fhealth.in_sync === null" class="alert alert-info" style="margin:0">
              Fulcrum is reachable, but the chain tip couldn't be fetched to verify sync.
              {{ fhealth.error || '' }}
            </div>
            <div v-else-if="fhealth && fhealth.ok" class="alert alert-success" style="margin:0">
              ✓ <strong>Fulcrum is up and in sync</strong> with the chain<span v-if="fhealth.latency_ms != null"> · {{ fhealth.latency_ms }} ms</span>.
            </div>
            <div v-else class="text-dim text-sm">Checking Fulcrum status…</div>

            <div class="text-dim text-xs" style="display:flex;gap:14px;flex-wrap:wrap">
              <span v-if="fhealthCheckedAt">Last checked: {{ fhealthAgeText() }}</span>
              <span>Auto-checks every 60s</span>
            </div>
          </div>
        </div>

        <!-- BlindBit Oracle / network -->
        <div class="card">
          <div class="card-header"><h2>System Settings</h2></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
            <div class="field">
              <label>BlindBit Oracle URL</label>
              <input class="input" v-model="config.blindbit_url" placeholder="http://localhost:8000" />
              <span class="text-dim text-xs">The BlindBit backend that provides tweak and UTXO index data for scanning.</span>
            </div>
            <div class="field">
              <label>Mempool URL</label>
              <input class="input" v-model="config.mempool_url" placeholder="https://mempool.space" />
            </div>
            <div class="field">
              <label>Boltz API URL</label>
              <input class="input" v-model="config.boltz_url" placeholder="http://127.0.0.1:9001" />
              <span class="text-dim text-xs">Boltz v2 REST API for swaps. Regtest: http://127.0.0.1:9001 (boltz-backend-nginx). Mainnet: https://api.boltz.exchange. Leave blank to disable swaps.</span>
            </div>
            <div class="field">
              <label>Fulcrum host (PayJoin)</label>
              <input class="input" v-model="config.fulcrum_host" placeholder="127.0.0.1" />
              <span class="text-dim text-xs">Electrum/Fulcrum server host for PayJoin watch-only UTXO sync. Leave blank if PayJoin is unused.</span>
            </div>
            <div class="field" style="display:flex;gap:16px;flex-wrap:wrap">
              <div style="flex:1;min-width:120px">
                <label>Fulcrum port</label>
                <input class="input" v-model.number="config.fulcrum_port" type="number" min="1" max="65535" placeholder="50001" />
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:22px">
                <input type="checkbox" id="fulcrum_tls" v-model="config.fulcrum_tls" />
                <label for="fulcrum_tls" style="margin:0">Use TLS (e.g. port 50002)</label>
              </div>
            </div>
            <div class="field">
              <label>Minimum Scan Height</label>
              <input class="input" v-model.number="config.min_scan_height" type="number" min="0" />
              <span class="text-dim text-xs">Wallets can't start scanning below this height.</span>
            </div>
            <div class="field">
              <label>Dust Threshold (sats) — server default</label>
              <input class="input" v-model.number="config.dust_threshold_sats" type="number" min="0" placeholder="5000" />
              <span class="text-dim text-xs">Default for users who haven't set their own in Settings → Privacy.</span>
            </div>
            <div class="field">
              <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" v-model="config.login_scan_enabled" />
                Auto catch-up scan on wallet open
              </label>
              <span class="text-dim text-xs">When a user opens their wallet, scan from where they left off so it doesn't fall behind.</span>
            </div>
            <div class="field" v-if="config.login_scan_enabled">
              <label>Auto-scan threshold (blocks)</label>
              <input class="input" v-model.number="config.login_scan_auto_threshold" type="number" min="1" placeholder="432" style="max-width:160px;" />
              <span class="text-dim text-xs">Gaps smaller than this scan silently in the background; larger gaps ask the user first (avoids surprise long scans). 432 ≈ 3 days.</span>
            </div>
            <div v-if="error" class="alert alert-error">⚠ {{ error }}</div>
            <div v-if="saved" class="alert alert-success">✓ Saved.</div>
            <div>
              <button class="btn btn-primary" :disabled="saving" @click="saveConfig">
                <span v-if="saving" class="spinner" style="border-top-color:#000"></span>
                {{ saving ? 'Saving…' : 'Save System Config' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Cloudflare — BitMail setup -->
        <div v-if="BITMAIL_ENABLED" class="card" style="margin-top:20px">
          <div class="card-header"><h2>BitMail — DNS Setup (Cloudflare)</h2></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
            <p class="text-dim text-sm">Configure Cloudflare API access so approved BitMail addresses can be published automatically.</p>
            <div class="field">
              <label>API Token</label>
              <div style="display:flex;gap:8px">
                <input class="input" :type="showToken ? 'text' : 'password'" v-model="cfConfig.api_token" placeholder="Cloudflare API token with DNS:Edit" style="flex:1" />
                <button type="button" class="btn btn-ghost btn-sm" @click="showToken = !showToken">{{ showToken ? 'Hide' : 'Show' }}</button>
              </div>
            </div>
            <div class="field">
              <label>Zone ID</label>
              <input class="input" v-model="cfConfig.zone_id" placeholder="Cloudflare Zone ID" spellcheck="false" />
              <span class="text-dim text-xs">Cloudflare dashboard → your domain → Overview → Zone ID.</span>
            </div>
            <div class="field">
              <label>Domain</label>
              <input class="input" :value="cfConfig.domain" readonly disabled spellcheck="false"
                     placeholder="(set via SILNT_BITMAIL_DOMAIN on the server)"
                     style="opacity:.75;cursor:not-allowed" />
              <span class="text-dim text-xs">
                The domain for BitMail addresses is set on the server
                (<span class="mono">SILNT_BITMAIL_DOMAIN</span>) and must match the Cloudflare
                zone above. Addresses look like
                <span class="mono text-orange">name@{{ cfConfig.domain || 'yourdomain.com' }}</span>.
              </span>
            </div>

            <div v-if="cfError" class="alert alert-error">⚠ {{ cfError }}</div>
            <div v-if="cfSaved" class="alert alert-success">✓ Cloudflare config saved.</div>
            <div>
              <button class="btn btn-primary" :disabled="cfSaving" @click="saveCfConfig">
                <span v-if="cfSaving" class="spinner" style="border-top-color:#000"></span>
                {{ cfSaving ? 'Saving…' : 'Save Cloudflare Config' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Ntfy notifications -->
        <div class="card" style="margin-top:20px">
          <div class="card-header"><h2>Notifications (ntfy)</h2></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
            <p class="text-dim text-sm">Send admin notifications to <span class="mono">ntfy</span> topics. Subscribe to the same topic in the ntfy app or at your server to receive them.</p>

            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="ntfy.enabled" /> Enable ntfy notifications
            </label>

            <div class="field">
              <label>Server URL</label>
              <input class="input" v-model="ntfy.server_url" placeholder="https://ntfy.sh" spellcheck="false" />
              <span class="text-dim text-xs">Public ntfy.sh or your self-hosted server (no trailing slash needed).</span>
            </div>

            <div class="field">
              <label>Topics</label>
              <textarea class="input mono" v-model="ntfyTopicsText" rows="3" spellcheck="false"
                        placeholder="one topic per line (or comma-separated)&#10;silnt-alerts&#10;silnt-payments"></textarea>
              <span class="text-dim text-xs">Notifications are sent to every topic listed. Pick hard-to-guess names — anyone who knows a topic can read its messages.</span>
            </div>

            <div class="field">
              <label>Username <span class="text-dim">(for servers with basic auth)</span></label>
              <input class="input" v-model="ntfy.username" placeholder="ntfy username" spellcheck="false" autocomplete="off" />
            </div>
            <div class="field">
              <label>Password</label>
              <div style="display:flex;gap:8px">
                <input class="input" :type="showNtfyPass ? 'text' : 'password'" v-model="ntfy.password" placeholder="ntfy password" style="flex:1" spellcheck="false" autocomplete="off" />
                <button type="button" class="btn btn-ghost btn-sm" @click="showNtfyPass = !showNtfyPass">{{ showNtfyPass ? 'Hide' : 'Show' }}</button>
              </div>
              <span class="text-dim text-xs">HTTP Basic auth credentials required by your ntfy server.</span>
            </div>

            <div class="field">
              <label>Access Token <span class="text-dim">(alternative to username/password)</span></label>
              <div style="display:flex;gap:8px">
                <input class="input" :type="showNtfyToken ? 'text' : 'password'" v-model="ntfy.access_token" placeholder="tk_… (token-based servers)" style="flex:1" spellcheck="false" autocomplete="off" />
                <button type="button" class="btn btn-ghost btn-sm" @click="showNtfyToken = !showNtfyToken">{{ showNtfyToken ? 'Hide' : 'Show' }}</button>
              </div>
              <span class="text-dim text-xs">Used only if no username is set. Bearer token for token-auth servers.</span>
            </div>

            <div class="field">
              <label>Priority</label>
              <select class="input" v-model="ntfy.priority" style="max-width:200px">
                <option value="min">Min</option>
                <option value="low">Low</option>
                <option value="default">Default</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div v-if="ntfyError" class="alert alert-error">⚠ {{ ntfyError }}</div>
            <div v-if="ntfySaved" class="alert alert-success">✓ Ntfy config saved.</div>

            <div class="flex gap-2">
              <button class="btn btn-primary" :disabled="ntfySaving" @click="saveNtfy">
                <span v-if="ntfySaving" class="spinner" style="border-top-color:#000"></span>
                {{ ntfySaving ? 'Saving…' : 'Save Notification Config' }}
              </button>
              <button class="btn btn-ghost" :disabled="ntfyTesting || !ntfy.enabled" @click="testNtfy" title="Send a test notification to the configured topics">
                {{ ntfyTesting ? 'Sending…' : 'Send test' }}
              </button>
            </div>
          </div>
        </div>

      </template>
    </div>
  </div>
</template>
