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
//
// The app runs a single "dark slate" theme: a charcoal background with lighter
// raised cards, near-white text, and the brand orange as the accent. Every
// screen pulls its surfaces/text/borders from these tokens (no more hardcoded
// #fff/#f5f5f5/#000 per screen) so the look stays consistent.
export const colors = {
  primary: '#f97316', // --orange
  primaryDim: '#7c3910', // --orange-dim
  onPrimary: '#000000', // black text on the orange buttons (unchanged)
  // Brightened so they stay legible on the dark surfaces.
  green: '#2ecc71',
  danger: '#ff6b5e',

  // ── Dark slate surfaces ────────────────────────────────────────────────────
  bg: '#181a20', // app / screen background
  surface: '#23262e', // raised cards
  surfaceAlt: '#2b2f38', // inputs, chips, insets, progress tracks
  border: '#363b47', // hairlines & input borders

  // ── Text ────────────────────────────────────────────────────────────────────
  text: '#f2f2f5', // primary text
  strong: '#d6dae1', // secondary strong text (was ~#333)
  label: '#c3c8d0', // form labels (was ~#444)
  muted: '#a2a8b4', // muted body text (was ~#666)
  faint: '#7c828e', // faint captions / placeholders (was #888–#bbb)
  inactive: '#8a909b', // inactive tab / icon tint

  // A translucent orange tint for accent fills (chips, badges) on dark cards.
  accentTint: 'rgba(249,115,22,0.16)',
};
