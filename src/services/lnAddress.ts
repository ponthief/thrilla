// A Lightning address, and the words for what it is used for here.
//
// MIRRORS helpers/lnaddress.py::split_address, which is the authority — the
// server resolves the address and refuses it there whatever this says. This
// exists so an obvious typo is caught before a round trip, and so the two
// clients cannot describe the same setting differently.
//
// WhiSPa is not a Lightning wallet and there is no balance here. This is the
// one place Lightning appears: a Tango round's change output is the strongest
// remaining linkability problem in the protocol — its value is fixed by the
// round's arithmetic, so spending it later identifies which of the two
// identical shares were yours — and a user may have that value sent to a
// Lightning address instead, minus a service fee. The output itself goes to
// the instance's Silent Payments address. The money leaves over somebody
// else's network, to an account this app never touches.
//
// NO IMPORTS, so both bundles can have it for what it weighs.

/** Mirrors the Python's two regexes. Stricter than an email on purpose: the
 *  domain becomes a hostname in a URL. */
const LOCAL_RE = /^[a-z0-9._%+-]{1,64}$/;
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Why this is not a usable Lightning address, or null when it looks like one.
 *
 * "Looks like" is all a client can say. Whether anyone answers at that
 * domain, and whether they accept a payment as small as a change payout, is
 * the server's to find out — see api.setTangoLnAddress.
 */
export function lnAddressProblem(address: string): string | null {
  const text = (address || '').trim().toLowerCase();
  if (!text) return 'Enter a Lightning address.';
  if ((text.match(/@/g) || []).length !== 1) {
    return 'A Lightning address looks like name@domain, for example satoshi@coinos.io.';
  }
  const [local, domain] = text.split('@');
  if (!LOCAL_RE.test(local)) {
    return 'The part before the @ has characters that are not allowed.';
  }
  if (!DOMAIN_RE.test(domain)) return 'The part after the @ is not a domain name.';
  return null;
}

function grouped(n: number): string {
  // Not toLocaleString: Hermes ships without full Intl.
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** What the fee is, in the terms a person can check against their own round. */
export function payoutFeeNote(
  feePct: number,
  feeFloorSats: number,
  minChangeSats: number | null,
): string {
  const pct = (feePct * 100).toFixed(2).replace(/\.?0+$/, '');
  return (
    `The service fee is ${pct}% of the change or ${grouped(feeFloorSats)} sats, `
    + 'whichever is more.'
    + (minChangeSats
      ? ` Change under ${grouped(minChangeSats)} sats is left in your wallet instead.`
      : '')
  );
}

/** The one sentence that has to be read before it is switched on, because it
 *  is the part a person would not guess: the coin stops being theirs. */
export const PAYOUT_CONSENT =
  'Your change leaves your wallet: the output pays this service, and the '
  + 'value is sent to your Lightning address after the round confirms.';

/** What it buys, in one line, next to the warning that prompted it. */
export const PAYOUT_WHY =
  'A change coin identifies which outputs were yours whenever you spend it. '
  + 'Sending it away is the only way to be rid of it.';

export const PAYOUT_TITLE = 'Send my change over Lightning';
