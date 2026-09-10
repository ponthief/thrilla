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

// Brand palette, now genuinely the web app's (src/style.css custom properties)
// rather than an approximation of it. The mobile app used to run a warm charcoal
// "dark slate" of its own, which read as a different product next to the web
// wallet's near-black, blue-cast surfaces. These are those surfaces.
//
// The one place it deliberately parts company is the dim end of the text ramp.
// The web's --text-dim (#4a6070) scores 2.8:1 on the card surface — fine for a
// desktop aside, illegible for the help text under every switch on a phone in
// daylight. Every token here clears 4.5:1 for body text on both bg and surface,
// and `inactive` (icons and 11px tab labels, where 3:1 is the bar) clears 4.2:1.
// If you add a colour, check it against `bg` AND `surface`: a token that only
// works on one of them will be used on the other within a week.
export const colors = {
  primary: '#f97316', // --orange
  primaryDim: '#7c3910', // --orange-dim
  onPrimary: '#000000', // black text on the orange buttons
  green: '#22c55e', // --green
  danger: '#ef4444', // --red
  warn: '#eab308', // --yellow: a caution that is not yet a failure

  // ── Surfaces: near-black, faintly blue, flat rather than layered ───────────
  bg: '#080b0f', // app / screen background
  surface: '#0e1318', // raised cards
  surfaceAlt: '#131a22', // inputs, chips, insets, progress tracks
  border: '#1c2630', // hairlines & input borders
  borderHi: '#2a3a4a', // a border that has to be seen (focus, active chip)

  // ── Text ──────────────────────────────────────────────────────────────────
  text: '#e6eef7', // primary text
  strong: '#c8d8e8', // secondary strong text (the web app's body colour)
  label: '#a9bccd', // form labels
  muted: '#8296a8', // help and body copy — the workhorse for secondary text
  faint: '#6d8497', // captions and placeholders; still 4.5:1 on a card
  inactive: '#647b8f', // inactive tab / icon tint

  // Translucent fills for accent and status chips on dark cards.
  accentTint: 'rgba(249,115,22,0.10)',
  greenTint: 'rgba(34,197,94,0.10)',
  dangerTint: 'rgba(239,68,68,0.10)',
};

// ── Typography ──────────────────────────────────────────────────────────────
//
// IBM Plex, bundled at android/app/src/main/assets/fonts (SIL OFL 1.1, licence
// alongside). Not a fresh choice: src/style.css has declared IBM Plex Sans and
// Mono as the brand faces since the web app was written — it simply never
// loaded the files, so both clients fell back to the system font and looked like
// nothing in particular. These are those faces, actually present.
//
// Mono is not decoration. The web app sets every heading in it
// (`h1,h2,h3,h4 { font-family: var(--font-mono) }`), and a bitcoin wallet is
// mostly figures, addresses and hashes — things that want fixed advance widths
// so a digit does not shift when it changes. So: mono for headings, numbers and
// anything hex; sans for prose.
//
// One family per weight, because that is how Android resolves an asset font
// (fonts/<fontFamily>.ttf). The corollary matters: NEVER pair these with
// fontWeight. Android would go looking for a bold variant of an already-bold
// file and synthesise a smeared one when it fails. The weight is in the family
// name; that is the whole contract.
export const fonts = {
  sans: 'IBMPlexSans-Regular',
  sansMedium: 'IBMPlexSans-Medium',
  sansSemi: 'IBMPlexSans-SemiBold',
  mono: 'IBMPlexMono-Regular',
  monoSemi: 'IBMPlexMono-SemiBold',
};

// A scale, so a screen picks a role rather than inventing a size. The jumps are
// deliberately wide — the old settings screen ran everything at 12, 13 or 14px,
// which is why it read as an undifferentiated wall: nothing was bigger, so
// nothing was first.
export const type = {
  // A balance, or anything that is the single reason the screen exists.
  display: { fontFamily: fonts.monoSemi, fontSize: 34, letterSpacing: -0.6 },
  // Screen title.
  title: { fontFamily: fonts.monoSemi, fontSize: 25, letterSpacing: 0.2 },
  // Sub-page title, dialog heading.
  heading: { fontFamily: fonts.monoSemi, fontSize: 19, letterSpacing: 0.1 },
  // The small uppercase rule over a group of rows. Tracking is what makes
  // uppercase readable at this size; without it the letters collide.
  overline: {
    fontFamily: fonts.monoSemi,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  // A row's own name.
  rowTitle: { fontFamily: fonts.sansMedium, fontSize: 15, letterSpacing: 0.1 },
  // Prose.
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21 },
  // The explanation under a control. Its line height is the setting that
  // decides whether a paragraph of it is read or skipped.
  help: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  // A figure, an address, a txid, a block height.
  value: { fontFamily: fonts.mono, fontSize: 13, letterSpacing: 0.2 },
  valueStrong: { fontFamily: fonts.monoSemi, fontSize: 13, letterSpacing: 0.2 },
  button: { fontFamily: fonts.sansSemi, fontSize: 15, letterSpacing: 0.3 },
  buttonSmall: { fontFamily: fonts.sansSemi, fontSize: 13, letterSpacing: 0.3 },
};

// Spacing and corner radii, on a 4px grid. Named so "the gap between a card and
// the next overline" is one decision made once, not thirty made separately.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
