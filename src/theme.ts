// Feature flags. Lightning is disabled on every network the app ships (signet
// and mainnet): no LN wallet, no bolt11 receive. Flip to re-enable everywhere.
export const LIGHTNING_ENABLED = false;

// Device-trust (email 2FA) for the native app. When enabled, every API request
// carries `X-Thrilla-Client: 1`, which activates the backend's device-trust gate
// (helpers/device_auth.py). A device must be confirmed with a 6-digit email code
// before it can use the wallet — this gives Android the same second factor the
// web app gets from its per-device email confirmation.
//
// KEEP THIS FALSE until the backend is ready:
//   1. SMTP must work (the code is emailed; a broken mailer locks users out).
//   2. LNBITS_AUTH_SECRET_KEY must be set (device_auth signs the confirm token).
// Flipping to true forces EVERY existing Android user to enroll one device
// (max 5 per account) on their next login. There is no partial rollout — the
// gate is all-or-nothing per client.
export const DEVICE_TRUST_ENABLED = true;

// Brand palette, mirroring the web app's CSS custom properties (src/style.css).
// Keeping these in one place means every screen shares the same orange the web
// wallet uses, instead of the placeholder blue the migration scaffolding had.
export const colors = {
  primary: '#f97316', // --orange
  primaryDim: '#7c3910', // --orange-dim
  onPrimary: '#000000', // web buttons use black text on orange
  green: '#1e7d4f',
  danger: '#c0392b',
  text: '#000000',
  muted: '#666666',
};
