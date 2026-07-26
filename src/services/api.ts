import Config from 'react-native-config';

// Backend base URL + Silent-Payments prefix are injected at build time by
// react-native-config (see .env.mainnet). LNBITS_URL must be an absolute URL.
const BASE = Config.LNBITS_URL || '';
const SILNT = Config.SILNT_PREFIX || '/siLNt';

export interface LnbitsWallet {
  id: string;
  name: string;
  adminkey: string;
  inkey: string;
  balance_msat?: number;
}

export interface WalletInfo {
  id?: string;
  name: string;
  balance: number; // millisatoshis
}

// A bolt11 invoice as returned by LNbits POST /api/v1/payments (out:false).
export interface Invoice {
  payment_hash: string;
  // Older/newer LNbits builds use different field names for the bolt11 string.
  bolt11?: string;
  payment_request?: string;
  checking_id?: string;
}

// A single payment's status (LNbits GET /api/v1/payments/{hash}).
export interface PaymentStatus {
  paid: boolean;
  preimage?: string;
  details?: unknown;
}

// A Silent-Payments wallet as returned by the siLNt extension
// (GET /siLNt/api/v1/wallet). Carries the static receive address.
export interface SilntWallet {
  id: string;
  title: string;
  balance: number; // sats
  network: string;
  sp_address: string; // canonical silent-payment address (sp1…)
  hr_address: string; // human-readable address (BIP-353 style), may be empty
  last_height: number; // birth height (also the mnemonic AES key)
  last_scan_height: number; // how far scanning has progressed
}

// Live scan progress (siLNt keeps this in memory per wallet).
export interface ScanProgress {
  active: boolean;
  current: number;
  total: number;
  found: number;
}

// BlindBit /info — we only need the chain height.
export interface ChainInfo {
  height: number;
}

// Subset of the siLNt backend config relevant to catch-up scanning. (The full
// BackendConfig carries scan-proxy connection settings we don't need here.)
export interface BackendConfig {
  login_scan_enabled?: boolean;
  login_scan_auto_threshold?: number;
}

export class ApiError extends Error {
  status?: number;
  detail?: string;
  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

// Core request helper. Unlike the web SPA we do NOT send the `X-Thrilla-Client`
// header: this is a native client using standard LNbits auth (session token +
// per-wallet API keys), so the backend's device-trust gate does not apply.
async function req<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (e: any) {
    // Network/connection failure (no HTTP status) — surface a clear message.
    throw new ApiError(
      `Network error reaching ${BASE || '(no LNBITS_URL configured)'}`,
    );
  }

  if (resp.status === 204) {
    return null as unknown as T;
  }

  const data = await resp.json().catch(() => ({ detail: resp.statusText }));
  if (!resp.ok) {
    const message =
      (data && (data.detail || data.message)) || `HTTP ${resp.status}`;
    throw new ApiError(message, resp.status, data && data.detail);
  }
  return data as T;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function apiKey(key: string) {
  return { 'X-Api-Key': key };
}

// ── Auth ──────────────────────────────────────────────────────────────────
// POST /api/v1/auth → { access_token }
export async function login(
  username: string,
  password: string,
): Promise<{ access_token?: string; token?: string }> {
  return req('/api/v1/auth', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// Account wallets (with per-wallet inkey/adminkey). Uses the session token.
export async function getLnbitsWallets(token: string): Promise<LnbitsWallet[]> {
  return req('/api/v1/wallets', { headers: bearer(token) });
}

// ── BitMail (BIP-353 human-readable address) ────────────────────────────────
// A user requests a username; an admin approves it and the DNS record is
// published, after which the wallet's hr_address (e.g. alice@domain) resolves to
// its silent-payment address. Only meaningful when the server has a domain
// configured (getBitmailDomain returns non-empty).

export interface Bip353Request {
  id: string;
  wallet_id: string;
  requested_username: string;
  final_username?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  message?: string | null;
  reject_reason?: string | null;
}

// Resolve a BitMail (BIP-353) address over DNS to its silent-payment address.
// Returns the backend's raw result; use spFromResolve() to extract the sp1… .
export async function resolveBip353(
  inkey: string,
  address: string,
): Promise<{ result?: string; [k: string]: unknown }> {
  return req(
    `${SILNT}/api/v1/bip353/resolve?address=${encodeURIComponent(address)}`,
    { headers: apiKey(inkey) },
  );
}

// Extract the sp1…/tsp1… address from a resolve result (e.g. "bitcoin:?sp=sp1…").
export function spFromResolve(res: { result?: string } | null): string {
  const raw = (res?.result || '').replace('bitcoin:?sp=', '').replace('sp=', '');
  return raw.trim();
}

// The configured BitMail domain (empty string = feature unavailable). Uses inkey.
export async function getBitmailDomain(inkey: string): Promise<{ domain: string }> {
  return req(`${SILNT}/api/v1/bitmail/domain`, { headers: apiKey(inkey) });
}

// Live availability check for a BitMail username (before submitting a request).
// reason: 'invalid' | 'reserved' | 'taken' | null.
export async function checkBip353Available(
  inkey: string,
  username: string,
): Promise<{ available: boolean; reason: string | null }> {
  return req(
    `${SILNT}/api/v1/bip353/available?username=${encodeURIComponent(username)}`,
    { headers: apiKey(inkey) },
  );
}

// Submit a username request for a wallet (address_id null = the base SP address).
export async function createBip353Request(
  inkey: string,
  data: { wallet_id: string; requested_username: string; message?: string },
): Promise<unknown> {
  return req(`${SILNT}/api/v1/bip353/request`, {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({ address_id: null, ...data }),
  });
}

// The current user's BitMail requests (all statuses). Uses inkey.
export async function listMyBip353Requests(
  inkey: string,
): Promise<Bip353Request[]> {
  const res = await req<any>(`${SILNT}/api/v1/bip353/requests`, {
    headers: apiKey(inkey),
  });
  return res?.requests ?? [];
}

// Cancel a pending request. Uses inkey.
export async function cancelBip353Request(
  inkey: string,
  reqId: string,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/bip353/requests/${encodeURIComponent(reqId)}`, {
    method: 'DELETE',
    headers: apiKey(inkey),
  });
}

// ── Auth: registration + password recovery ──────────────────────────────────
// Both are public (no key). Registration sends a verification email and does
// NOT create the account until the emailed link is opened; password reset
// emails a signed link. The link steps happen in the browser, so the app only
// needs to kick these off and tell the user to check their email.
export async function startRegistration(
  username: string,
  password: string,
  email: string,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/auth/register-start`, {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}

export async function requestPasswordReset(email: string): Promise<unknown> {
  return req(`${SILNT}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

// ── Lightning wallet ────────────────────────────────────────────────────────
// Current LN balance (in millisatoshis) + wallet name. Uses inkey (read).
export async function lnGetWallet(inkey: string): Promise<WalletInfo> {
  return req('/api/v1/wallet', { headers: apiKey(inkey) });
}

// BTC/USD rate via the siLNt backend. Returns { rate } (0 if unavailable).
export async function getUsdRate(inkey: string): Promise<{ rate: number }> {
  return req(`${SILNT}/api/v1/rate/usd`, { headers: apiKey(inkey) });
}

// ── Receive: Lightning ──────────────────────────────────────────────────────
// Create an incoming bolt11 invoice. Uses inkey (invoice key can receive).
// `amount` is in sats; `expiry` in seconds.
export async function lnCreateInvoice(
  inkey: string,
  { amount, memo = '', expiry = 3600 }: { amount: number; memo?: string; expiry?: number },
): Promise<Invoice> {
  return req('/api/v1/payments', {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({ out: false, amount, memo, expiry }),
  });
}

// A Lightning payment as listed by LNbits core. `amount` is msat, signed
// (negative = outgoing). Field names vary a little across LNbits versions, so
// the optional fields are handled defensively by the caller.
export interface LnPayment {
  payment_hash?: string;
  checking_id?: string;
  amount?: number; // msat, signed
  fee?: number;
  memo?: string;
  time?: number | string;
  pending?: boolean;
  status?: string;
  bolt11?: string;
}

// Lightning payment history (most recent first). Uses inkey. Some LNbits builds
// return a bare array, others { data: [...] } — unwrap to an array either way.
export async function lnListPayments(
  inkey: string,
  limit = 25,
): Promise<LnPayment[]> {
  const res = await req<any>(`/api/v1/payments?limit=${limit}`, {
    headers: apiKey(inkey),
  });
  return Array.isArray(res) ? res : res?.data ?? [];
}

// Poll a single payment by hash to see whether it has been paid. Uses inkey.
export async function lnPaymentStatus(
  inkey: string,
  paymentHash: string,
): Promise<PaymentStatus> {
  return req(`/api/v1/payments/${encodeURIComponent(paymentHash)}`, {
    headers: apiKey(inkey),
  });
}

// ── Receive: on-chain (Silent Payments) ─────────────────────────────────────
// Fetch the account's Silent-Payments wallets from the siLNt extension. The
// returned records carry the static `sp_address` used to receive on-chain.
// Scoped to the build's NETWORK_LOCK by default (WHERE network = …) so a
// network-locked APK NEVER surfaces another network's wallet — e.g. a mainnet
// build must not show a wallet that was created on Signet. This mirrors the web
// app, which defaults the same filter to VITE_NETWORK_LOCK.
export async function getSilntWallets(
  inkey: string,
  network: string | undefined = Config.NETWORK_LOCK || undefined,
): Promise<SilntWallet[]> {
  const qs = network ? `?network=${encodeURIComponent(network)}` : '';
  return req(`${SILNT}/api/v1/wallet${qs}`, { headers: apiKey(inkey) });
}

// Choose which SP wallet to surface. Strict on the locked network: never falls
// back to a wallet from a different network (that would show a Signet wallet on
// a mainnet build). Returns null when the account has no wallet on this network.
export function pickSilntWallet(wallets: SilntWallet[]): SilntWallet | null {
  if (!wallets?.length) return null;
  const lock = Config.NETWORK_LOCK;
  if (!lock) return wallets[0];
  return wallets.find((w) => w.network === lock) ?? null;
}

// A freshly created SP wallet. On generate the server mints the mnemonic + keys
// and returns them once — the client must show the mnemonic so the user can back
// it up (everything is recoverable from it).
export interface CreatedWallet {
  wallet_id: string;
  sp_address: string;
  scan_secret: string;
  spend_key: string;
  mnemonic: string;
  passphrase: string | null;
  last_height: number;
  network: string;
  generated: boolean;
}

// A Silent Payments on-chain transaction (built server-side from scanned
// receives/sends). `amount_sats` is signed: negative = net outflow.
export interface SpTransaction {
  kind: 'send' | 'receive';
  txid: string;
  timestamp: number; // unix seconds
  amount_sats: number;
  labels?: string[];
}

// Enriched detail for one on-chain transaction (confirmation, block, fee,
// recipients, explorer link), fetched on demand.
export interface TxRecipient {
  address?: string | null;
  amount?: number;
  type?: string;
}
export interface WalletTxDetail {
  txid: string;
  confirmed: boolean | null;
  block_height: number | null;
  block_time: number | null;
  fee_sats: number | null;
  recipients: TxRecipient[];
  explorer_url: string;
  own_outputs?: unknown[];
  spent_inputs?: unknown[];
}
export async function getWalletTransaction(
  inkey: string,
  walletId: string,
  txid: string,
): Promise<WalletTxDetail> {
  return req(
    `${SILNT}/api/v1/wallet/${walletId}/transactions/${encodeURIComponent(txid)}`,
    { headers: apiKey(inkey) },
  );
}

// On-chain transaction history for an SP wallet (most recent first).
export async function listWalletTransactions(
  inkey: string,
  walletId: string,
  limit = 25,
  offset = 0,
): Promise<SpTransaction[]> {
  const res = await req<any>(
    `${SILNT}/api/v1/wallet/${walletId}/transactions?limit=${limit}&offset=${offset}`,
    { headers: apiKey(inkey) },
  );
  return res?.transactions ?? [];
}

// ── Send: on-chain (Silent Payments) ────────────────────────────────────────

// A spendable output owned by the wallet. priv_key_tweak + pub_key are needed
// by the server-side tx builder to sign this input.
export interface Utxo {
  txid: string;
  vout: number;
  amount: number; // sats
  priv_key_tweak: string;
  pub_key: string;
  utxo_state: string; // 'unspent' | 'spent' | …
  frozen?: boolean;
  label?: string | null;
  suspected_dust?: boolean;
}

// mempool.space-shaped recommended fee tiers (sat/vB).
export interface FeeTiers {
  fastestFee?: number;
  halfHourFee?: number;
  hourFee?: number;
  economyFee?: number;
  minimumFee?: number;
}

// Result of a server-side tx build.
export interface BuiltTx {
  tx_hex: string;
  fee: number;
  [k: string]: unknown;
}

// The wallet's UTXOs. Uses inkey (read).
export async function getUtxos(inkey: string, walletId: string): Promise<Utxo[]> {
  const res = await req<any>(
    `${SILNT}/api/v1/utxos?wallet_id=${encodeURIComponent(walletId)}`,
    { headers: apiKey(inkey) },
  );
  return res?.utxos ?? [];
}

// ── User preferences (dust threshold) ───────────────────────────────────────
// The dust threshold lives server-side per user so the backend can recompute the
// change-aware `suspected_dust` flag from it (change outputs are never dust).
export interface UserPrefs {
  dust_threshold_sats: number | null; // user override, null = use admin default
  admin_default_dust: number;
  effective_dust_threshold: number;
}

export async function getUserPrefs(inkey: string): Promise<UserPrefs> {
  return req(`${SILNT}/api/v1/user/prefs`, { headers: apiKey(inkey) });
}

// Set (or clear, with null/0) the user's dust threshold. The backend re-evaluates
// existing UTXOs so `suspected_dust` updates immediately.
export async function updateUserPrefs(
  inkey: string,
  dustThresholdSats: number | null,
): Promise<UserPrefs> {
  return req(`${SILNT}/api/v1/user/prefs`, {
    method: 'PUT',
    headers: apiKey(inkey),
    body: JSON.stringify({ dust_threshold_sats: dustThresholdSats }),
  });
}

// Freeze/unfreeze a UTXO (frozen coins are excluded from send selection). inkey.
export async function setUtxoFrozen(
  inkey: string,
  txid: string,
  vout: number,
  frozen: boolean,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/utxos/${txid}/${vout}/frozen`, {
    method: 'PUT',
    headers: apiKey(inkey),
    body: JSON.stringify({ frozen }),
  });
}

// Restore a coin marked spent back to spendable (only when the spending tx was
// dropped). Requires the admin key; the server verifies the tx is really gone.
export async function restoreUtxo(
  adminkey: string,
  walletId: string,
  txid: string,
  vout: number,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/utxos/restore`, {
    method: 'POST',
    headers: apiKey(adminkey),
    body: JSON.stringify({ wallet_id: walletId, txid, vout }),
  });
}

// Set/clear a UTXO's label. inkey.
export async function updateUtxoLabel(
  inkey: string,
  txid: string,
  label: string,
  walletId: string,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/utxos/${txid}/label`, {
    method: 'PUT',
    headers: apiKey(inkey),
    body: JSON.stringify({ label: label || '', wallet_id: walletId }),
  });
}

// Recommended fee tiers for the build's network. Uses inkey.
export async function getRecommendedFees(
  inkey: string,
  network: string | undefined = Config.NETWORK_LOCK || undefined,
): Promise<FeeTiers> {
  const qs = network ? `?network=${encodeURIComponent(network)}` : '';
  return req(`${SILNT}/api/v1/fees/recommended${qs}`, { headers: apiKey(inkey) });
}

// Build a Silent Payments spend. Requires the admin key; the scan/spend keys are
// passed transiently so the server can sign (never stored server-side).
export async function buildTx(
  adminkey: string,
  data: {
    wallet_id: string;
    recipient: string;
    amount: number;
    fee_rate: number;
    utxos: Array<
      Pick<Utxo, 'txid' | 'vout' | 'amount' | 'priv_key_tweak' | 'pub_key'>
    >;
  },
  spendKey: string,
  scanSecret: string,
): Promise<BuiltTx> {
  return req(`${SILNT}/api/v1/tx/build`, {
    method: 'POST',
    headers: apiKey(adminkey),
    body: JSON.stringify({ ...data, spend_key: spendKey, scan_secret: scanSecret }),
  });
}

// Broadcast a built tx and mark its inputs spent. Requires the admin key.
export async function broadcastTx(
  adminkey: string,
  txHex: string,
  walletId: string,
  spentOutpoints: Array<{ txid: string; vout: number }> = [],
  meta: { recipient?: string; amount?: number; fee?: number } = {},
): Promise<{ txid: string }> {
  return req(`${SILNT}/api/v1/tx/broadcast`, {
    method: 'POST',
    headers: apiKey(adminkey),
    body: JSON.stringify({
      tx_hex: txHex,
      wallet_id: walletId,
      spent_outpoints: spentOutpoints,
      recipient: meta.recipient || null,
      amount: meta.amount || null,
      fee: meta.fee || null,
    }),
  });
}

// ── Contacts (address book) ─────────────────────────────────────────────────
// Server-stored per user. `value` is a Silent-Payments address or a BitMail
// (name@domain); bech32 on-chain addresses can be sent to but not saved here
// (the backend only accepts sp/bitmail contacts).
export interface SpContact {
  id: string;
  label: string;
  kind: string; // 'sp' | 'bitmail'
  value: string;
}

export async function listContacts(inkey: string): Promise<SpContact[]> {
  const res = await req<any>(`${SILNT}/api/v1/contacts`, { headers: apiKey(inkey) });
  return res?.contacts ?? [];
}

export async function createContact(
  inkey: string,
  label: string,
  value: string,
): Promise<SpContact> {
  return req(`${SILNT}/api/v1/contacts`, {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({ label, value }),
  });
}

export async function deleteContact(inkey: string, cid: string): Promise<unknown> {
  return req(`${SILNT}/api/v1/contacts/${encodeURIComponent(cid)}`, {
    method: 'DELETE',
    headers: apiKey(inkey),
  });
}

// ── Scanning (catch-up) ─────────────────────────────────────────────────────
// Silent Payments funds are discovered by scanning blocks with the wallet's
// scan/spend keys (never stored server-side — passed transiently per scan).

// Kick off a scan. `fromHeight` limits it to the gap (defaults server-side to
// the wallet birth height when null).
export async function startScan(
  inkey: string,
  walletId: string,
  scanSecret: string,
  spendKey: string,
  fromHeight: number | null = null,
  toHeight: number | null = null,
): Promise<unknown> {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan`, {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({
      from_height: fromHeight,
      to_height: toHeight,
      scan_secret: scanSecret,
      spend_key: spendKey,
    }),
  });
}

export async function getScanProgress(
  inkey: string,
  walletId: string,
): Promise<ScanProgress> {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan/progress`, {
    headers: apiKey(inkey),
  });
}

// Stop an in-progress scan. Uses inkey.
export async function stopScan(inkey: string, walletId: string): Promise<unknown> {
  return req(`${SILNT}/api/v1/wallet/${walletId}/scan/stop`, {
    method: 'POST',
    headers: apiKey(inkey),
  });
}

// Client-facing app config (min scan height, etc.). Uses inkey.
export interface AppConfig {
  min_scan_height?: number;
  network?: string;
  dust_threshold_sats?: number;
}
export async function getAppConfig(inkey: string): Promise<AppConfig> {
  return req(`${SILNT}/api/v1/config`, { headers: apiKey(inkey) });
}

// Current chain tip via the siLNt oracle proxy (BlindBit /info).
export async function getChainTip(inkey: string): Promise<ChainInfo> {
  return req(`${SILNT}/api/v1/oracle/tip`, { headers: apiKey(inkey) });
}

// Backend config (login-scan toggle + auto threshold). Network-scoped, like the
// web app — the old /blindbit/config was renamed to /backend/config on master.
export async function getBackendConfig(
  inkey: string,
  network: string | undefined = Config.NETWORK_LOCK || undefined,
): Promise<BackendConfig> {
  const qs = network ? `?network=${encodeURIComponent(network)}` : '';
  return req(`${SILNT}/api/v1/backend/config${qs}`, { headers: apiKey(inkey) });
}

// Re-derive scan_secret + spend_key for an EXISTING wallet from its mnemonic
// (used to restore keys onto a device that doesn't have them). The server checks
// the derived sp_address matches the wallet's, so a wrong seed is rejected.
// `encryptedMnemonic` is AES-encrypted with String(lastHeight), same as import.
export async function recoverWalletKeys(
  inkey: string,
  walletId: string,
  encryptedMnemonic: string,
  lastHeight: number,
  passphrase: string | null = null,
): Promise<{ scan_secret: string; spend_key: string }> {
  return req(`${SILNT}/api/v1/wallet/${walletId}/recover-keys`, {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({ mnemonic: encryptedMnemonic, last_height: lastHeight, passphrase }),
  });
}

// Create a Silent-Payments wallet. Omitting `mnemonic` tells the server to
// generate a fresh seed; it derives the keys/address server-side. For import,
// pass `mnemonic` AES-encrypted with String(last_height) as the key (matching
// the backend's decrypt_mnemonic) — see encryptMnemonicForImport in the modal.
export async function createSilntWallet(
  inkey: string,
  data: {
    title: string;
    network?: string;
    passphrase?: string;
    last_height?: number;
    mnemonic?: string;
  },
): Promise<CreatedWallet> {
  return req(`${SILNT}/api/v1/wallet`, {
    method: 'POST',
    headers: apiKey(inkey),
    body: JSON.stringify({
      network: Config.NETWORK_LOCK || 'mainnet',
      ...data,
    }),
  });
}
