// ── API base URLs ─────────────────────────────────────────────────────────────
// In Android app: injected via window.THRILLA_CONFIG.backendUrl
// In production web (Caddy proxy): VITE_LNBITS_URL is empty (same-origin)
// In dev: Vite proxy handles it
function getBase() {
  if (typeof window !== 'undefined' && window.THRILLA_CONFIG?.backendUrl) {
    return window.THRILLA_CONFIG.backendUrl
  }
  return import.meta.env.VITE_LNBITS_URL || ''
}

const BASE  = getBase()
const SILNT = import.meta.env.VITE_SILNT_PREFIX || '/siLNt'

// ── Device trust (native app) ────────────────────────────────────────────────
// In the packaged app the device-trust cookie is cross-site (origin
// https://localhost → lnbits.thrilla.me) and Android WebView won't reliably
// persist it. So we ALSO carry the device id in a header: verifyDeviceCode
// stores it here and every request sends it. Web (same-origin) still uses the
// cookie; the backend accepts either.
const DEVICE_ID_KEY = 'thrilla_device_id'
export function setDeviceId(id) {
  try { if (id) localStorage.setItem(DEVICE_ID_KEY, id) } catch (_) {}
}
export function getDeviceId() {
  try { return localStorage.getItem(DEVICE_ID_KEY) || '' } catch (_) { return '' }
}

// ── Core request helper ───────────────────────────────────────────────────────
async function req(url, options = {}) {
  // credentials: 'include' so the silnt_device_id cookie is sent on every request.
  // X-Thrilla-Client marks this as the Thrilla SPA so the backend enforces device
  // trust here (the LNbits-native extension page omits it and uses LNbits auth).
  const devId = getDeviceId()
  const devHeader = devId ? { 'X-Silnt-Device': devId } : {}
  const resp = await fetch(BASE + url, {
    credentials: 'include',
    ...options,
    headers: { 'X-Thrilla-Client': '1', ...devHeader, ...(options.headers || {}) },
  })
  if (resp.status === 204) return null
  const data = await resp.json().catch(() => ({ detail: resp.statusText }))
  if (!resp.ok) {
    // Detect device-not-trusted 403. Dispatch a soft event instead of a hard
    // window.location reload (which wipes SPA state and blanks the app).
    // The app listens for this and navigates via the router once.
    if (resp.status === 403 && typeof data.detail === 'string' &&
        data.detail.startsWith('device-not-trusted')) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('device-not-trusted'))
        }
      } catch (_) { /* ignore */ }
    }
    const err = new Error(data.detail || data.message || `HTTP ${resp.status}`)
    err.status = resp.status
    err.detail = data.detail
    throw err
  }
  return data
}

function bearerHeaders(token, extra = {}) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }
}

function keyHeaders(apiKey, extra = {}) {
  return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', ...extra }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(username, password) {
  return req('/api/v1/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function getLnbitsWallets(token) {
  return req('/api/v1/wallets', { headers: bearerHeaders(token) })
}

// ── Lightning (LNbits native wallet) send/receive ─────────────────────────────
// The LNbits wallet auto-created with the account holds the LN balance. These
// wrap the standard LNbits payments API. inkey can create invoices + read;
// adminkey is required to PAY. Keys come from the LNbits wallet (auth store).

// Current LN balance (msat) + wallet name. Uses inkey (read).
export async function lnGetWallet(inkey) {
  return req('/api/v1/wallet', { headers: keyHeaders(inkey) })
}

// RECEIVE: create a bolt11 invoice. Uses inkey. amount in sats.
export async function lnCreateInvoice(inkey, { amount, memo = '', expiry = 3600 }) {
  return req('/api/v1/payments', {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ out: false, amount, memo, expiry }),
  })
}

// SEND: pay a bolt11 invoice. Requires adminkey.
export async function lnPayInvoice(adminkey, bolt11) {
  return req('/api/v1/payments', {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ out: true, bolt11 }),
  })
}

// Decode a bolt11 to show amount/memo/destination before paying. Uses inkey.
export async function lnDecodeInvoice(inkey, bolt11) {
  return req('/api/v1/payments/decode', {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ data: bolt11 }),
  })
}

// Payment history (most recent first). Uses inkey.
export async function lnListPayments(inkey, limit = 25) {
  return req(`/api/v1/payments?limit=${limit}`, { headers: keyHeaders(inkey) })
}

// Check a single payment's status (paid?) by payment_hash. Uses inkey.
export async function lnPaymentStatus(inkey, paymentHash) {
  return req(`/api/v1/payments/${encodeURIComponent(paymentHash)}`, { headers: keyHeaders(inkey) })
}

// ── Silent Payments wallets ───────────────────────────────────────────────────
// Network scoping: a build locked to a network (signet/regtest/mainnet APK or
// web build) must only ever see that network's wallets. Default the filter to
// the build's VITE_NETWORK_LOCK so EVERY caller is scoped without having to
// pass it. An explicit `network` arg still overrides (e.g. admin/global views).
// Passing network='' (empty string) opts out and returns all networks.
const NETWORK_LOCK = import.meta.env.VITE_NETWORK_LOCK || null
export async function getSilntWallets(inkey, network = undefined) {
  const net = network === undefined ? NETWORK_LOCK : network
  const qs = net ? `?network=${net}` : ''
  return req(`${SILNT}/api/v1/wallet${qs}`, {
    headers: keyHeaders(inkey),
  })
}

export async function createSilntWallet(inkey, data) {
  return req(`${SILNT}/api/v1/wallet`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify(data),
  })
}

export async function updateSilntWallet(inkey, walletId, data) {
  return req(`${SILNT}/api/v1/wallet/${walletId}`, {
    method: 'PUT',
    headers: keyHeaders(inkey),
    body: JSON.stringify(data),
  })
}

export async function deleteSilntWallet(adminkey, walletId) {
  return req(`${SILNT}/api/v1/wallet/${walletId}`, {
    method: 'DELETE',
    headers: keyHeaders(adminkey),
  })
}

// ── UTXOs ─────────────────────────────────────────────────────────────────────
export async function getUtxos(inkey, walletId) {
  return req(`${SILNT}/api/v1/utxos?wallet_id=${walletId}`, {
    headers: keyHeaders(inkey),
  })
}

// ── Scanning ──────────────────────────────────────────────────────────────────
export async function startScan(inkey, walletId, scanSecret, spendKey, fromHeight = null, toHeight = null) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({
      from_height:  fromHeight,
      to_height:    toHeight,
      scan_secret:  scanSecret,   // passed transiently, never stored server-side
      spend_key:    spendKey,
    }),
  })
}

export async function stopScan(inkey, walletId) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan/stop`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

export async function getScanProgress(inkey, walletId) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan/progress`, {
    headers: keyHeaders(inkey),
  })
}

export async function getChainTip(inkey) {
  return req(`${SILNT}/api/v1/oracle/tip`, { headers: keyHeaders(inkey) })
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function buildTx(adminkey, data, spendKey, scanSecret) {
  return req(`${SILNT}/api/v1/tx/build`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({
      ...data,
      spend_key:   spendKey,
      scan_secret: scanSecret,   // needed to derive m=1 change address
    }),
  })
}

export async function broadcastTx(adminkey, txHex, walletId, spentOutpoints = [], meta = {}) {
  return req(`${SILNT}/api/v1/tx/broadcast`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({
      tx_hex: txHex,
      wallet_id: walletId,
      // full outpoints so the backend can mark the exact UTXOs spent
      spent_outpoints: spentOutpoints,           // [{txid, vout}, ...]
      // optional metadata so Activity can show recipient/amount before rescan
      recipient: meta.recipient || null,
      amount: meta.amount || null,
      fee: meta.fee || null,
    }),
  })
}

// Check whether an outgoing send tx has confirmed on-chain. Lightweight — one
// txid lookup, NOT a scan. On confirmation the backend flips spent inputs to
// 'spent' and refreshes balance. Returns {confirmed, block_height, balance}.
export async function getTxConfirmation(adminkey, txid, walletId) {
  return req(`${SILNT}/api/v1/tx/${encodeURIComponent(txid)}/confirmation?wallet_id=${encodeURIComponent(walletId)}`, {
    headers: keyHeaders(adminkey),
  })
}

// ── BIP353 ────────────────────────────────────────────────────────────────────
export async function resolveBip353(inkey, address) {
  return req(`${SILNT}/api/v1/bip353/resolve?address=${encodeURIComponent(address)}`, {
    headers: keyHeaders(inkey),
  })
}

// ── Config ────────────────────────────────────────────────────────────────────
// Backend infra config (blindbit/mempool/fulcrum) is per-network. Each build
// reads/writes the config for ITS network (VITE_NETWORK_LOCK), so the mainnet
// admin portal and the signet admin portal manage separate configs. An explicit
// `network` arg overrides.
function _cfgQs(network) {
  const net = network === undefined ? NETWORK_LOCK : network
  return net ? `?network=${net}` : ''
}

export async function getConfig(inkey, network = undefined) {
  return req(`${SILNT}/api/v1/backend/config${_cfgQs(network)}`, { headers: keyHeaders(inkey) })
}

export async function getBlindbitConfig(adminkey, network = undefined) {
  return req(`${SILNT}/api/v1/backend/config${_cfgQs(network)}`, { headers: keyHeaders(adminkey) })
}

export async function getBlindbitHealth(adminkey, network = undefined) {
  return req(`${SILNT}/api/v1/admin/blindbit/health${_cfgQs(network)}`, { headers: keyHeaders(adminkey) })
}

export async function getFulcrumHealth(adminkey, network = undefined) {
  return req(`${SILNT}/api/v1/admin/fulcrum/health${_cfgQs(network)}`, { headers: keyHeaders(adminkey) })
}

export async function getAdminAlerts(adminkey, includeAck = false) {
  const qs = includeAck ? '?include_acknowledged=true' : ''
  return req(`${SILNT}/api/v1/admin/alerts${qs}`, { headers: keyHeaders(adminkey) })
}
export async function ackAdminAlert(adminkey, alertId) {
  return req(`${SILNT}/api/v1/admin/alerts/${alertId}/ack`, {
    method: 'POST', headers: keyHeaders(adminkey),
  })
}

export async function updateConfig(adminkey, data, network = undefined) {
  return req(`${SILNT}/api/v1/backend/config${_cfgQs(network)}`, {
    method: 'PUT',
    headers: keyHeaders(adminkey),
    body: JSON.stringify(data),
  })
}

export async function getAppConfig(inkey) {
  return req(`${SILNT}/api/v1/config`, { headers: keyHeaders(inkey) })
}

// ── Labeled addresses ─────────────────────────────────────────────────────────
export async function getWalletAddresses(inkey, walletId) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/addresses`, {
    headers: keyHeaders(inkey),
  })
}

export async function previewWalletAddress(inkey, walletId, scanSecret, spendKey, labelIndex = null) {
  // labelIndex is optional — server picks next free if omitted
  return req(`${SILNT}/api/v1/wallet/${walletId}/addresses/preview`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({
      scan_secret: scanSecret,
      spend_key:   spendKey,
      label_index: labelIndex,
    }),
  })
}

export async function saveWalletAddress(inkey, walletId, spAddress, label = '', labelIndex = null) {
  // Server picks next free label_index if not supplied. Save does NOT need keys.
  return req(`${SILNT}/api/v1/wallet/${walletId}/addresses`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({
      sp_address:  spAddress,
      label:       label,
      label_index: labelIndex,
    }),
  })
}

export async function deleteWalletAddress(inkey, walletId, addressId) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/addresses/${addressId}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

export async function updateAddressLabel(inkey, walletId, addressId, label) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/addresses/${addressId}/label`, {
    method: 'PUT',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ label: label || '' }),
  })
}

// ── Cloudflare BIP-353 setup ──────────────────────────────────────────────────
export async function setupBip353(inkey, walletId, username, ttl = 300) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/bip353/setup`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ username, ttl }),
  })
}

export async function deleteBip353(inkey, walletId, addressId = null) {
  const qs = addressId ? `?address_id=${encodeURIComponent(addressId)}` : ''
  return req(`${SILNT}/api/v1/wallet/${walletId}/bip353${qs}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

export async function closeAccount(inkey) {
  return req(`${SILNT}/api/v1/account/close`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

export async function getUsdRate(inkey) {
  // BTC/USD rate via the siLNt backend (CoinGecko proxied server-side, since the
  // CSP blocks a direct browser call). LNbits' own /api/v1/rate/USD returns 0 on
  // this instance. Returns { rate: <float> } (0 if unavailable).
  return req(`${SILNT}/api/v1/rate/usd`, { headers: keyHeaders(inkey) })
}

export async function getRecommendedFees(inkey) {
  return req(`${SILNT}/api/v1/fees/recommended`, { headers: keyHeaders(inkey) })
}

export async function getBitmailDomain(inkey) {
  return req(`${SILNT}/api/v1/bitmail/domain`, { headers: keyHeaders(inkey) })
}

export async function getCloudflareConfig(adminkey) {
  return req(`${SILNT}/api/v1/cloudflare/config`, { headers: keyHeaders(adminkey) })
}

export async function updateCloudflareConfig(adminkey, data) {
  return req(`${SILNT}/api/v1/cloudflare/config`, {
    method: 'PUT',
    headers: keyHeaders(adminkey),
    body: JSON.stringify(data),
  })
}

export async function getNtfyConfig(adminkey) {
  return req(`${SILNT}/api/v1/ntfy/config`, { headers: keyHeaders(adminkey) })
}
export async function updateNtfyConfig(adminkey, data) {
  return req(`${SILNT}/api/v1/ntfy/config`, {
    method: 'PUT', headers: keyHeaders(adminkey), body: JSON.stringify(data),
  })
}
export async function testNtfy(adminkey) {
  return req(`${SILNT}/api/v1/ntfy/test`, { method: 'POST', headers: keyHeaders(adminkey) })
}

export async function recoverWalletKeys(inkey, walletId, encryptedMnemonic, lastHeight, passphrase = null) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/recover-keys`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ mnemonic: encryptedMnemonic, last_height: lastHeight, passphrase }),
  })
}

// ── Auth: registration and password recovery ─────────────────────────────────
export async function startRegistration(username, password, email) {
  // Sends a verification email — does NOT create an account yet.
  // Account is created when the user clicks the verification link.
  return req(`${SILNT}/api/v1/auth/register-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  })
}

export async function verifyRegistration(token) {
  // Decodes the verification token and creates the LNbits account.
  return req(`${SILNT}/api/v1/auth/register-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export async function requestPasswordReset(email) {
  // siLNt-provided endpoint: looks up account, generates LNbits reset key,
  // emails reset link to user. Requires LNbits SMTP to be configured.
  return req(`${SILNT}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export async function performPasswordReset(resetKey, password) {
  // LNbits built-in endpoint that validates the signed reset_key and
  // updates the account password.
  return req(`/api/v1/auth/reset`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reset_key:       resetKey,
      password:        password,
      password_repeat: password,
    }),
  })
}

export async function updateUtxoLabel(inkey, txid, label, walletId) {
  return req(`${SILNT}/api/v1/utxos/${txid}/label`, {
    method: 'PUT',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ label: label || '', wallet_id: walletId }),
  })
}

export async function restoreUtxo(adminkey, walletId, txid, vout) {
  return req(`${SILNT}/api/v1/utxos/restore`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ wallet_id: walletId, txid, vout }),
  })
}

export async function setUtxoFrozen(inkey, txid, vout, frozen) {
  return req(`${SILNT}/api/v1/utxos/${txid}/${vout}/frozen`, {
    method: 'PUT',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ frozen }),
  })
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function listWalletTransactions(inkey, walletId, limit = 50, offset = 0) {
  const url = `${SILNT}/api/v1/wallet/${walletId}/transactions?limit=${limit}&offset=${offset}`
  return req(url, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function getWalletTransaction(inkey, walletId, txid) {
  return req(`${SILNT}/api/v1/wallet/${walletId}/transactions/${txid}`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

// ── Trusted devices ───────────────────────────────────────────────────────────
export async function requestDeviceConfirm(inkey) {
  // Explicitly send the new-device confirmation email (user-initiated only).
  let brand = ''
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      if (await navigator.brave.isBrave()) brand = 'Brave'
    }
  } catch { /* ignore */ }
  const extra = brand ? { 'X-Client-Brand': brand } : {}
  return req(`${SILNT}/api/v1/auth/device-request-confirm`, {
    method: 'POST', headers: keyHeaders(inkey, extra),
  })
}

export async function isAdmin(inkey) {
  return req(`${SILNT}/api/v1/auth/is-admin`, { headers: keyHeaders(inkey) })
}

export async function deviceCheck(inkey) {
  // Brave masquerades as Chrome in its user-agent (anti-fingerprinting), so the
  // server can't tell them apart from the UA. navigator.brave.isBrave() is the
  // reliable client-side signal — pass it as a hint the backend records so the
  // device shows as "Brave" rather than "Chrome".
  let brand = ''
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      if (await navigator.brave.isBrave()) brand = 'Brave'
    }
  } catch { /* ignore — fall back to UA parsing */ }
  const extra = brand ? { 'X-Client-Brand': brand } : {}
  return req(`${SILNT}/api/v1/auth/device-check`, {
    method: 'POST',
    headers: keyHeaders(inkey, extra),
  })
}

export async function verifyDeviceCode(inkey, code) {
  // Submit the emailed 6-digit code from the browser being signed in. On
  // success the backend trusts THIS browser (sets its cookie) AND returns the
  // device_id, which we store so the native app can send it as a header on
  // subsequent requests (cross-site cookies aren't reliable in the WebView).
  const res = await req(`${SILNT}/api/v1/auth/device-verify-code`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ code }),
  })
  try { if (res && res.device_id) setDeviceId(res.device_id) } catch (_) {}
  return res
}

export async function listDevices(inkey) {
  return req(`${SILNT}/api/v1/devices`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function revokeDevice(inkey, deviceRowId) {
  return req(`${SILNT}/api/v1/devices/${deviceRowId}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

export async function signOutOtherDevices(inkey) {
  return req(`${SILNT}/api/v1/devices/sign-out-others`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

export async function getMe(inkey) {
  return req(`${SILNT}/api/v1/auth/me`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

// ── User preferences ──────────────────────────────────────────────────────────
export async function getUserPrefs(inkey) {
  return req(`${SILNT}/api/v1/user/prefs`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function updateUserPrefs(inkey, data) {
  return req(`${SILNT}/api/v1/user/prefs`, {
    method: 'PUT',
    headers: keyHeaders(inkey),
    body: JSON.stringify(data),
  })
}

// ── BIP-353 username requests ─────────────────────────────────────────────────
export async function createBip353Request(inkey, data) {
  return req(`${SILNT}/api/v1/bip353/request`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify(data),
  })
}

export async function listMyBip353Requests(inkey) {
  return req(`${SILNT}/api/v1/bip353/requests`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function cancelMyBip353Request(inkey, reqId) {
  return req(`${SILNT}/api/v1/bip353/requests/${reqId}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

// Admin
export async function adminListBip353Requests(inkey) {
  return req(`${SILNT}/api/v1/bip353/admin/requests`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function adminApproveBip353Request(inkey, reqId, finalUsername = null) {
  return req(`${SILNT}/api/v1/bip353/admin/requests/${reqId}/approve`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ final_username: finalUsername }),
  })
}

export async function adminRejectBip353Request(inkey, reqId, reason) {
  return req(`${SILNT}/api/v1/bip353/admin/requests/${reqId}/reject`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ reason }),
  })
}

export async function adminBip353History(inkey, limit = 13, offset = 0) {
  return req(`${SILNT}/api/v1/bip353/admin/requests/history?limit=${limit}&offset=${offset}`, {
    method: 'GET',
    headers: keyHeaders(inkey),
  })
}

export async function adminPurgeBip353Request(inkey, reqId) {
  return req(`${SILNT}/api/v1/bip353/admin/requests/${reqId}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

export async function adminPurgeTerminalBip353(inkey) {
  return req(`${SILNT}/api/v1/bip353/admin/requests/purge-terminal`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

// ── Boltz v2 swaps (SP → Lightning, swap-IN) via the siLNt backend ────────────
// The maintained LNbits Boltz extension is v1-only and can't talk to the v2
// Boltz backend, so swap creation now goes through siLNt's own backend
// (boltz_swap.py), which mints the LN invoice + calls Boltz v2 server-side.
// These use the normal siLNt req() (admin key, device-trust headers) since they
// hit /siLNt, not the Boltz extension.
//
// NOTE: happy-path only — NOT refund-safe yet (a failed swap-in needs a Taproot
// refund tx, deferred to the shared Musig2 layer). The UI surfaces this.

// Boltz submarine limits/fees (min/max) for amount validation.
export async function swapLimits(adminkey) {
  return req(`${SILNT}/api/v1/swap/limits`, { headers: keyHeaders(adminkey) })
}

// Create a v2 submarine swap (chain → lightning). Backend mints the invoice,
// generates the refund key, and calls Boltz. Returns:
//   { swap_id, address, expected_amount, timeout_block_height, not_refund_safe }
// We then fund `address` with `expected_amount` from the SP wallet via Send.
export async function createSwapIn(adminkey, { wallet_id, amount, refund_address, silnt_wallet_id, network }) {
  return req(`${SILNT}/api/v1/swap/in`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ wallet_id, amount, refund_address, silnt_wallet_id, network }),
  })
}

// Record the lockup outpoint after the SP send broadcasts (so a refund can be
// built later). Pass the funding txid; the backend resolves the vout/value.
export async function markSwapFunded(adminkey, swapId, lockupTxid) {
  return req(`${SILNT}/api/v1/swap/in/${encodeURIComponent(swapId)}/funded`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ lockup_txid: lockupTxid }),
  })
}

// Poll a swap's Boltz status.
export async function swapInStatus(adminkey, swapId) {
  return req(`${SILNT}/api/v1/swap/in/${encodeURIComponent(swapId)}`, {
    headers: keyHeaders(adminkey),
  })
}

// List all of the user's swaps (history) with a deletable flag.
export async function listSwaps(adminkey) {
  return req(`${SILNT}/api/v1/swap/list`, { headers: keyHeaders(adminkey) })
}

// Delete a finished (completed/refunded/expired) swap from history.
export async function deleteSwap(adminkey, swapId) {
  return req(`${SILNT}/api/v1/swap/${encodeURIComponent(swapId)}`, {
    method: 'DELETE',
    headers: keyHeaders(adminkey),
  })
}

// List swaps that are currently refundable (failed at Boltz or past timeout).
// Returns { refundable: [{swap_id, amount, timeout_block_height, reason}], chain_height }.
export async function listRefundableSwaps(adminkey) {
  return req(`${SILNT}/api/v1/swap/refundable`, { headers: keyHeaders(adminkey) })
}

// Build + broadcast a script-path refund for a failed/timed-out swap-in.
// Returns { success, txid, swap_id, refunded_to }.
export async function refundSwap(adminkey, swapId, { address, fee_sats = 300 }) {
  return req(`${SILNT}/api/v1/swap/${encodeURIComponent(swapId)}/refund`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ address, fee_sats }),
  })
}

// ── PayJoin (imported BIP-84 watch-only wallets; external Sparrow signing) ─────
// siLNt is watch-only: it imports an output descriptor, syncs UTXOs via Fulcrum,
// builds/merges/finalizes PSBTs, and broadcasts. It never holds keys; signing is
// done out-of-band in the user's own wallet (Sparrow). Endpoints use trusted-
// device auth: read paths take inkey, build/sign/broadcast paths take adminkey.

// Import an output descriptor (wpkh([fp/84h/.../0h]xpub/<0;1>/*)).
export async function payjoinImportDescriptor(inkey, descriptor, label = null, network = undefined) {
  const net = network === undefined ? (NETWORK_LOCK || 'signet') : network
  return req(`${SILNT}/api/v1/payjoin/descriptors`, {
    method: 'POST',
    headers: keyHeaders(inkey),
    body: JSON.stringify({ descriptor, label, network: net }),
  })
}

export async function payjoinListDescriptors(inkey) {
  return req(`${SILNT}/api/v1/payjoin/descriptors`, { headers: keyHeaders(inkey) })
}

export async function payjoinDeleteDescriptor(inkey, descriptorId) {
  return req(`${SILNT}/api/v1/payjoin/descriptors/${encodeURIComponent(descriptorId)}`, {
    method: 'DELETE',
    headers: keyHeaders(inkey),
  })
}

// Live Fulcrum sync of a descriptor's UTXOs/balance.
export async function payjoinGetUtxos(inkey, descriptorId) {
  return req(`${SILNT}/api/v1/payjoin/descriptors/${encodeURIComponent(descriptorId)}/utxos`, {
    headers: keyHeaders(inkey),
  })
}

// Usernames eligible to receive a PayJoin (have imported a descriptor), minus self.
// Privacy-preserving: confirm ONE exact username is a valid user (no enumeration).
export async function payjoinResolvePayer(inkey, username) {
  return req(`${SILNT}/api/v1/payjoin/resolve-payer?username=${encodeURIComponent(username)}`, {
    headers: keyHeaders(inkey),
  })
}

// Connections (consent-based curated list).
export async function payjoinContactRequest(inkey, username) {
  return req(`${SILNT}/api/v1/payjoin/contacts`, {
    method: 'POST', headers: keyHeaders(inkey), body: JSON.stringify({ username }),
  })
}
export async function payjoinListContacts(inkey) {
  return req(`${SILNT}/api/v1/payjoin/contacts`, { headers: keyHeaders(inkey) })
}
export async function payjoinContactApprove(inkey, cid) {
  return req(`${SILNT}/api/v1/payjoin/contacts/${encodeURIComponent(cid)}/approve`, {
    method: 'POST', headers: keyHeaders(inkey),
  })
}
export async function payjoinContactDecline(inkey, cid) {
  return req(`${SILNT}/api/v1/payjoin/contacts/${encodeURIComponent(cid)}/decline`, {
    method: 'POST', headers: keyHeaders(inkey),
  })
}
export async function payjoinContactRemove(inkey, cid) {
  return req(`${SILNT}/api/v1/payjoin/contacts/${encodeURIComponent(cid)}`, {
    method: 'DELETE', headers: keyHeaders(inkey),
  })
}
export async function payjoinContactLabel(inkey, cid, label) {
  return req(`${SILNT}/api/v1/payjoin/contacts/${encodeURIComponent(cid)}/label`, {
    method: 'POST', headers: keyHeaders(inkey), body: JSON.stringify({ label }),
  })
}
// Accepted connections for the invoice payer-picker.
export async function payjoinListPayers(inkey) {
  return req(`${SILNT}/api/v1/payjoin/payers`, { headers: keyHeaders(inkey) })
}

// A (payee) creates a directed invoice for payer B (adminkey — build path).
export async function payjoinCreateInvoice(adminkey, data) {
  return req(`${SILNT}/api/v1/payjoin/invoices`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify(data),
  })
}

// Open invoices directed to me (to pay).
export async function payjoinListInvoices(inkey) {
  return req(`${SILNT}/api/v1/payjoin/invoices`, { headers: keyHeaders(inkey) })
}

// Incoming + outgoing requests/invoices.
export async function payjoinListRequests(inkey) {
  return req(`${SILNT}/api/v1/payjoin/requests`, { headers: keyHeaders(inkey) })
}

// B (payer) pays an invoice: commits wallet + inputs; siLNt builds the merged
// PSBT. Returns { status, unsigned_psbt }.
export async function payjoinPayInvoice(adminkey, requestId, data) {
  return req(`${SILNT}/api/v1/payjoin/invoices/${encodeURIComponent(requestId)}/pay`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify(data),
  })
}

// Either party fetches the pristine unsigned PSBT to sign.
export async function payjoinGetUnsigned(inkey, requestId) {
  return req(`${SILNT}/api/v1/payjoin/requests/${encodeURIComponent(requestId)}/unsigned`, {
    headers: keyHeaders(inkey),
  })
}

// Either party submits their signed copy; siLNt broadcasts when BOTH present.
// Returns { status, waiting_for_other, txid? }.
export async function payjoinSign(adminkey, requestId, signedPsbt) {
  return req(`${SILNT}/api/v1/payjoin/requests/${encodeURIComponent(requestId)}/sign`, {
    method: 'POST',
    headers: keyHeaders(adminkey),
    body: JSON.stringify({ signed_psbt: signedPsbt }),
  })
}

export async function payjoinDecline(inkey, requestId) {
  return req(`${SILNT}/api/v1/payjoin/requests/${encodeURIComponent(requestId)}/decline`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

export async function payjoinCancel(inkey, requestId) {
  return req(`${SILNT}/api/v1/payjoin/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    headers: keyHeaders(inkey),
  })
}

// ── SP send contacts (per-user private address book) ──────────────────────────
export async function spContactsList(inkey) {
  return req(`${SILNT}/api/v1/contacts`, { headers: keyHeaders(inkey) })
}
export async function spContactCreate(inkey, label, value) {
  return req(`${SILNT}/api/v1/contacts`, {
    method: 'POST', headers: keyHeaders(inkey),
    body: JSON.stringify({ label, value }),
  })
}
export async function spContactUpdate(inkey, cid, label) {
  return req(`${SILNT}/api/v1/contacts/${cid}`, {
    method: 'PATCH', headers: keyHeaders(inkey),
    body: JSON.stringify({ label }),
  })
}
export async function spContactDelete(inkey, cid) {
  return req(`${SILNT}/api/v1/contacts/${cid}`, {
    method: 'DELETE', headers: keyHeaders(inkey),
  })
}

// ── Admin: delete a user account ──────────────────────────────────────────────
export async function adminAccountsList(adminkey, network = undefined) {
  return req(`${SILNT}/api/v1/admin/accounts${_cfgQs(network)}`, { headers: keyHeaders(adminkey) })
}
export async function adminAccountDelete(adminkey, identifier, confirmUsername, deleteBitmail = true) {
  return req(`${SILNT}/api/v1/admin/account/delete`, {
    method: 'POST', headers: keyHeaders(adminkey),
    body: JSON.stringify({ identifier, confirm_username: confirmUsername, delete_bitmail: deleteBitmail }),
  })
}
