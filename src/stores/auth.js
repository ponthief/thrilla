import { defineStore } from 'pinia'
import CryptoJS from 'crypto-js'   // legacy decryption during migration only
import { ref, computed } from 'vue'
import { login as apiLogin, getLnbitsWallets, getAccount } from '@/api'
import {
  vaultStore, vaultGet, vaultDelete,
  refreshVaultIndex as vaultRefreshIndex,
  vaultIndexSnapshot as vaultIndexList,
  markVaultEntry as markVault,
  vaultForgetSessionKey,
} from '@/stores/keyvault'

export const useAuthStore = defineStore('auth', () => {
  // Auth lives in sessionStorage so two different users in two tabs of the same
  // browser each keep their own session (localStorage would be shared and the
  // second login would clobber the first). Wallet keys stay in localStorage
  // (see thrilla_wkey_* below) so they persist across sessions.
  const token    = ref(sessionStorage.getItem('thrilla_token') || null)
  const adminkey = ref(sessionStorage.getItem('thrilla_adminkey') || null)
  const inkey    = ref(sessionStorage.getItem('thrilla_inkey') || null)
  const walletId = ref(sessionStorage.getItem('thrilla_wallet_id') || null)
  const username = ref(sessionStorage.getItem('thrilla_username') || null)
  const email    = ref(sessionStorage.getItem('thrilla_email') || null)
  const error    = ref(null)
  const loading  = ref(false)
  const lastFailureKind = ref(null)   // 'auth' | 'network' | null

  // ── Idle session timeout ────────────────────────────────────────────────
  // Sessions expire after IDLE_TIMEOUT_MS of no user activity. Activity (clicks,
  // keypresses, navigation) refreshes the timer. This prevents an unattended,
  // logged-in tab from staying authenticated indefinitely.
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000   // 30 minutes
  const lastActivity = ref(Number(sessionStorage.getItem('thrilla_last_activity')) || Date.now())

  function touchActivity() {
    lastActivity.value = Date.now()
    sessionStorage.setItem('thrilla_last_activity', String(lastActivity.value))
  }

  function isSessionExpired() {
    if (!token.value) return false   // not logged in → nothing to expire
    return (Date.now() - lastActivity.value) > IDLE_TIMEOUT_MS
  }

  const isLoggedIn = computed(() =>
    !!(token.value && inkey.value) && !isSessionExpired()
  )

  // Credentials present, IGNORING idle-expiry. The router guard uses this so a
  // click that happens to land in a transient pre-refresh "expired" instant
  // isn't aborted/redirected mid-navigation (which wedged the router until F5).
  // Expiry is enforced solely by the idle timer (enforceIdleTimeout), which
  // calls logout() to clear credentials before redirecting.
  const hasCredentials = computed(() => !!(token.value && inkey.value))

  function persist() {
    sessionStorage.setItem('thrilla_token',     token.value    || '')
    sessionStorage.setItem('thrilla_adminkey',  adminkey.value || '')
    sessionStorage.setItem('thrilla_inkey',     inkey.value    || '')
    sessionStorage.setItem('thrilla_wallet_id', walletId.value || '')
    sessionStorage.setItem('thrilla_username',  username.value || '')
    sessionStorage.setItem('thrilla_email',     email.value    || '')
    touchActivity()
  }

  async function login(usernameArg, password) {
    loading.value = true
    error.value   = null
    touchActivity()   // fresh idle timer up front, before any async work
    try {
      const data = await apiLogin(usernameArg, password)
      token.value = data.access_token || data.token
      username.value = usernameArg

      // Fetch LNbits wallets to get API keys
      const wallets = await getLnbitsWallets(token.value)
      if (!wallets?.length) {
        // TEMP DIAGNOSTIC: surface what actually came back so the phone shows
        // the real cause (base URL, token presence, response shape).
        let base = ''
        try { base = (typeof window !== 'undefined' && window.THRILLA_CONFIG?.backendUrl) || (import.meta.env.VITE_LNBITS_URL || '(same-origin)') } catch (_) {}
        const shape = Array.isArray(wallets) ? `array(len=${wallets.length})` : (typeof wallets + ':' + JSON.stringify(wallets).slice(0,120))
        const tok = token.value ? `token(${String(token.value).slice(0,8)}…)` : 'NO-TOKEN'
        throw new Error(`No wallets. base=${base} ${tok} resp=${shape}`)
      }

      // Use first wallet's keys — user can switch later
      const w = wallets[0]
      adminkey.value = w.adminkey
      inkey.value    = w.inkey
      walletId.value = w.id

      // The email the account was registered with — display-only. Best-effort:
      // a failure here must never block login.
      try {
        const acct = await getAccount(token.value)
        email.value = acct?.email || null
      } catch (_) { email.value = null }

      persist()
      await _migrateAndIndex()    // migrate any legacy CryptoJS entries → vault, build index
      return true
    } catch (e) {
      error.value = e.message
      // Classify the failure so the UI can decide whether to count it toward
      // the lockout. A real credential rejection carries an HTTP status
      // (401/403). A CORS/network/connection failure throws a TypeError from
      // fetch with no status — that must NOT count toward the lockout, or an
      // environment problem locks the user out.
      lastFailureKind.value = (e && typeof e.status === 'number') ? 'auth' : 'network'
      return false
    } finally {
      loading.value = false
    }
  }

  function logout() {
    // forget login-scan session state so a fresh login re-evaluates wallets.
    // lazy import avoids any circular-init issue (composable imports this store).
    import('@/composables/useLoginScan').then(m => m._resetLoginScan?.()).catch(() => {})
    // NOTE: We intentionally do NOT clear wallet keys here.
    // The encrypted blob in localStorage is tied to the user's adminkey+inkey,
    // so:
    //   - Same user logs back in → keys decrypt cleanly (convenience)
    //   - Different user logs in → their hash differs, blob is unreadable
    //     and gets overwritten when they store their own keys
    // To explicitly forget keys on this device, use the "Forget Keys" button
    // in the wallet settings.
    token.value = adminkey.value = inkey.value = walletId.value = username.value = email.value = null
    sessionStorage.removeItem('thrilla_token')
    sessionStorage.removeItem('thrilla_username')
    sessionStorage.removeItem('thrilla_email')
    sessionStorage.removeItem('thrilla_adminkey')
    sessionStorage.removeItem('thrilla_inkey')
    sessionStorage.removeItem('thrilla_wallet_id')
    sessionStorage.removeItem('thrilla_last_activity')
    // Reset the in-memory activity timestamp too. Otherwise a stale (old) value
    // survives logout and, after the user logs back in, can make isSessionExpired()
    // briefly read true — which makes the router guard bounce navigation until a
    // full reload re-initializes the store.
    lastActivity.value = Date.now()
    // Drop the in-memory vault wrapping key + index so the next (possibly
    // different) user can't reuse this session's derived key.
    vaultForgetSessionKey()
    _keyIndex.value = []
  }

  // Log out only if the session has gone idle past the timeout. Returns true if
  // it logged out. Called by the activity watcher and the router guard.
  function logoutIfExpired() {
    if (isSessionExpired()) {
      logout()
      return true
    }
    return false
  }

  // ── Per-wallet key storage (keys never sent to server persistently) ─────────
  // Android: encrypted in Android Keystore via ThrillaBridge
  // Web:     AES-GCM in IndexedDB via WebCrypto, wrapping key is NON-EXTRACTABLE
  //          and derived per-session (PBKDF2) from the LNbits API keys. See
  //          keyvault.js. A stored blob can't be decrypted without a live session,
  //          and the wrapping key's raw bytes can never be exported from the page.

  const LS_KEY_LEGACY = 'thrilla_wallet_keys_v1'   // old single-blob (CryptoJS)
  const LS_PREFIX     = 'thrilla_wkey_'            // old per-wallet (CryptoJS)

  // Reactive index of which wallet ids have stored keys — lets the UI do a
  // synchronous existence check (hasWalletKeys) without an async decrypt.
  const _keyIndex = ref([])

  function _keyMaterial() {
    return (adminkey.value || '') + '|' + (inkey.value || '') + '|thrilla_v1'
  }

  // Synchronous existence check for templates/computeds.
  function hasWalletKeys(walletId) {
    return _keyIndex.value.includes(walletId)
  }

  async function refreshKeyIndex(walletIds = []) {
    if (typeof window.ThrillaBridge !== 'undefined') {
      // Native bridge has no list method, so probe each known wallet and build
      // the synchronous index from what the bridge actually holds. Without this
      // _keyIndex stays empty on mobile and hasWalletKeys() is always false,
      // breaking key-gated views (Send/UTXOs) after a re-login.
      const found = []
      for (const wid of walletIds) {
        try {
          const raw = window.ThrillaBridge.getWalletKeys(wid)
          if (raw) found.push(wid)
        } catch { /* ignore a single failed probe */ }
      }
      _keyIndex.value = found
      return
    }
    await vaultRefreshIndex()
    _keyIndex.value = vaultIndexList()
  }

  async function storeWalletKeys(walletId, scanSecret, spendKey) {
    if (typeof window.ThrillaBridge !== 'undefined') {
      try {
        window.ThrillaBridge.storeWalletKeys(walletId, scanSecret, spendKey)
      } catch (e) {
        console.error('[storeWalletKeys] bridge failed:', e)
      }
      return true
    }
    try {
      await vaultStore(walletId, { scanSecret, spendKey }, _keyMaterial())
      markVault(walletId, true)
      _keyIndex.value = vaultIndexList()
      // verify round-trip
      const check = await getWalletKeys(walletId)
      if (!check || !check.scanSecret || !check.spendKey) {
        console.error('[storeWalletKeys] verification FAILED for', walletId)
        return false
      }
      return true
    } catch (e) {
      console.error('[storeWalletKeys] failed for', walletId, e)
      return false
    }
  }

  async function getWalletKeys(walletId) {
    if (typeof window.ThrillaBridge !== 'undefined') {
      try {
        const raw = window.ThrillaBridge.getWalletKeys(walletId)
        if (!raw) return null
        try { return JSON.parse(raw) } catch { return null }
      } catch { return null }
    }
    // Primary: WebCrypto vault
    const fromVault = await vaultGet(walletId, _keyMaterial())
    if (fromVault) return fromVault
    // Fallback: migrate a legacy CryptoJS entry if present, then return it
    const migrated = await _migrateLegacyEntry(walletId)
    return migrated
  }

  async function removeWalletKeys(walletId) {
    if (typeof window.ThrillaBridge !== 'undefined') {
      try { window.ThrillaBridge.removeWalletKeys(walletId) } catch { /* ignore */ }
      return
    }
    await vaultDelete(walletId)
    // also clear any legacy CryptoJS entry
    try { localStorage.removeItem(LS_PREFIX + walletId) } catch { /* ignore */ }
    markVault(walletId, false)
    _keyIndex.value = vaultIndexList()
  }

  // ── Legacy (CryptoJS/localStorage) → vault migration ─────────────────────────
  function _legacyDecKey() {
    return CryptoJS.SHA256(_keyMaterial()).toString()
  }
  function _legacyDecrypt(encrypted) {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, _legacyDecKey())
      const plain = bytes.toString(CryptoJS.enc.Utf8)
      if (!plain) return null
      return JSON.parse(plain)
    } catch { return null }
  }

  // Migrate a single wallet's legacy entry (per-wallet blob or from the old
  // single-blob) into the vault, returning the keys if found.
  async function _migrateLegacyEntry(walletId) {
    try {
      const perWallet = localStorage.getItem(LS_PREFIX + walletId)
      if (perWallet) {
        const keys = _legacyDecrypt(perWallet)
        if (keys && keys.scanSecret && keys.spendKey) {
          await vaultStore(walletId, keys, _keyMaterial())
          markVault(walletId, true); _keyIndex.value = vaultIndexList()
          localStorage.removeItem(LS_PREFIX + walletId)
          return keys
        }
      }
      const legacy = localStorage.getItem(LS_KEY_LEGACY)
      if (legacy) {
        const all = _legacyDecrypt(legacy)
        if (all && all[walletId] && all[walletId].scanSecret) {
          await vaultStore(walletId, all[walletId], _keyMaterial())
          markVault(walletId, true); _keyIndex.value = vaultIndexList()
          return all[walletId]
        }
      }
    } catch { /* non-fatal */ }
    return null
  }

  // On login: migrate ALL legacy entries that decrypt with this user's key, then
  // build the index. Non-fatal if anything fails.
  async function _migrateAndIndex() {
    if (typeof window.ThrillaBridge !== 'undefined') return
    try {
      // per-wallet legacy entries
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(LS_PREFIX)) {
          const wid = k.slice(LS_PREFIX.length)
          const keys = _legacyDecrypt(localStorage.getItem(k))
          if (keys && keys.scanSecret && keys.spendKey) {
            await vaultStore(wid, keys, _keyMaterial())
          }
        }
      }
      // old single blob
      const legacy = localStorage.getItem(LS_KEY_LEGACY)
      if (legacy) {
        const all = _legacyDecrypt(legacy)
        if (all && typeof all === 'object') {
          for (const [wid, keys] of Object.entries(all)) {
            if (keys && keys.scanSecret && keys.spendKey) {
              await vaultStore(wid, keys, _keyMaterial())
            }
          }
          localStorage.removeItem(LS_KEY_LEGACY)
        }
      }
    } catch { /* non-fatal */ }
    await refreshKeyIndex()
  }

  // clearAllWalletKeys removed — it wiped every wallet's keys across all users on
  // a shared browser. Callers now use removeWalletKeys(walletId) scoped to a user.

  return { token, adminkey, inkey, walletId, username, email, error, loading, lastFailureKind, isLoggedIn, hasCredentials, login, logout,
           touchActivity, isSessionExpired, logoutIfExpired, IDLE_TIMEOUT_MS,
           storeWalletKeys, getWalletKeys, removeWalletKeys,
           hasWalletKeys, refreshKeyIndex }
})
