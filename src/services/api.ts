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
