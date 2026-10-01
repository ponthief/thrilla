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
// Lightning address they control instead, minus a service fee. The output
// itself goes to the instance's Silent Payments address. The money leaves
// over somebody else's network, to an account this app never touches.
//
// NO IMPORTS, so both bundles can have it for what it weighs.

/** The example in both clients' input, and in the shape error below. Not a
 *  real address at a real provider: an empty field is an invitation to paste
 *  whatever is in the placeholder. */
export const LN_ADDRESS_EXAMPLE = 'username@domain.com';

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
    return `A Lightning address looks like ${LN_ADDRESS_EXAMPLE}.`;
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

/**
 * The smallest change worth sending, FROM THE SERVER.
 *
 * The number is the backend's: it follows from the fee it charges, and a
 * figure written into a client is one the backend can change underneath it.
 * Below it the change stays in the wallet, which is the thing a person needs
 * to know before they wonder why a small round was not paid out.
 */
export function payoutMinimumNote(minChangeSats: number | null): string {
  if (!minChangeSats) {
    return 'Change too small to send over Lightning stays in your wallet.';
  }
  return (
    `Change under ${grouped(minChangeSats)} sats stays in your wallet — `
    + 'it is too small to send over Lightning.'
  );
}

/** When, which is the question somebody waiting for their change asks. Not
 *  immediately: the round's transaction has to confirm first, and the gap is
 *  what makes a payout look lost when it is only pending. */
export const PAYOUT_WHEN =
  'Change is sent once the Tango transaction confirms.';

/** Why anyone would want this. The risk is the whole pitch, so it leads. */
export const PAYOUT_WHY =
  'Make your Tango mini coinjoin change not linkable on-chain. Send it to '
  + 'yourself via Lightning.';

/** Above the input, so the next action is named rather than inferred from a
 *  field appearing. */
export const PAYOUT_PROMPT = 'Save your Lightning address below.';

export const PAYOUT_TITLE = 'Send my change over Lightning';
