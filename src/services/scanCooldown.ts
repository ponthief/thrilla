// Client-side mirror of the backend's per-wallet scan cooldown
// (WALLET_COOLDOWN_SECONDS = 60). Shared between the manual Scan screen and the
// automatic catch-up scan so both respect "one scan per wallet per minute" and
// the UI can show a countdown instead of surfacing a raw 429.

export const SCAN_COOLDOWN_SECONDS = 60;

const cooldownUntil: Record<string, number> = {};

// Arm the full cooldown from now (call right after a scan is accepted).
export function markScanStarted(walletId: string): void {
  cooldownUntil[walletId] = Date.now() + SCAN_COOLDOWN_SECONDS * 1000;
}

// Arm a specific remaining window, e.g. from a backend "try again in N seconds".
export function setCooldown(walletId: string, seconds: number): void {
  cooldownUntil[walletId] = Date.now() + Math.max(0, seconds) * 1000;
}

// Seconds left before the wallet may be scanned again (0 = ready).
export function cooldownRemaining(walletId: string): number {
  const ms = (cooldownUntil[walletId] || 0) - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}
