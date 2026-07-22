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
// `network` scopes the result to a single network (defaults to the build's
// NETWORK_LOCK so a network-locked APK never surfaces another network's wallet).
export async function getSilntWallets(
  inkey: string,
  network: string | undefined = Config.NETWORK_LOCK || undefined,
): Promise<SilntWallet[]> {
  const qs = network ? `?network=${encodeURIComponent(network)}` : '';
  return req(`${SILNT}/api/v1/wallet${qs}`, { headers: apiKey(inkey) });
}
