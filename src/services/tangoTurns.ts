// Whose turn it is in a Tango, and how far along a round is.
//
// SEPARATE FROM services/tango.ts ON PURPOSE, and the reason is measurable.
// This is read by the two watchers, which run for the whole session and so sit
// in the main bundle. tango.ts reaches the cryptography — spPayjoin, spSign,
// the curve library — and importing it from a watcher dragged all of that into
// the main bundle to get a table of three strings: 152 kB to 218 kB, for
// something that does no arithmetic at all.
//
// So: no imports here, and nothing that needs any. The screens import both.
//
// Mirrors helpers/tango.py::whose_turn, which remains the authority — these
// decide what to draw and what to announce, and the endpoints refuse an
// out-of-turn call whatever this says. It lives in one place because it was in
// four (two screens, two watchers), and four copies of a state machine are
// four chances to disagree about the one thing every Tango surface reads.

export type Side = 'a' | 'b';

const TURN: Record<string, Side> = {
  PROPOSED: 'b',
  ACCEPTED: 'a',
  A_SIGNED: 'b',
};

export const TERMINAL_STATUSES = ['BROADCAST', 'CANCELLED'];

export function whoseTurn(status: string): Side | null {
  return TURN[status] || null;
}

export function isMyTurn(status: string, role?: Side | null): boolean {
  return !!role && whoseTurn(status) === role;
}

/**
 * The four steps, in order, as a person would describe them.
 *
 * WHY THERE ARE FOUR, since it is the first thing anyone asks. Every Silent
 * Payments output is derived from the WHOLE input set, so nobody can derive
 * anything until both sides' coins are in — two turns on its own. And a
 * taproot key-path signature commits to every output, so all four outputs have
 * to exist before either side signs — two more. Three would mean signing a
 * transaction whose outputs do not exist yet.
 *
 * It is already merged everywhere it can be: B contributes and derives in one
 * step, A derives and signs in one.
 */
export const STEPS = [
  'they are asked',
  'they match it',
  'you approve',
  'they send it',
];

/** 1-4 for a live round, or null once it is over. */
export function stepNumber(status: string): number | null {
  switch (status) {
    case 'PROPOSED': return 2;
    case 'ACCEPTED': return 3;
    case 'A_SIGNED': return 4;
    default: return null;
  }
}

// Why a round ended, as the server writes reject_reason. Mirrors
// helpers/tango.py; a cancellation keeps the SIDE rather than a name, because
// the name depends on who is reading — and the web was printing the raw value,
// so a stopped round read "Cancelled · cancelled by a".
const CANCELLED_BY = 'cancelled by ';
const EXPIRED = 'expired';
const CONNECTION_REMOVED = 'connection removed';

/** 'a', 'b', or null when this reason is not a cancellation by a person. */
export function whoCancelled(reason?: string | null): Side | null {
  const text = (reason || '').trim().toLowerCase();
  if (!text.startsWith(CANCELLED_BY)) return null;
  const role = text.slice(CANCELLED_BY.length).trim();
  return role === 'a' || role === 'b' ? role : null;
}

/**
 * How a finished round ended, naming whoever ended it.
 *
 * `you` is the reader's own side, so the same stored reason reads "You
 * cancelled it" to the person who did and "alice cancelled it" to the other —
 * which is what "cancelled by a" was always trying to say.
 *
 * An unrecognised reason is shown as written rather than swallowed: it is
 * either a wording this build predates or something a human wrote, and both
 * are worth reading.
 */
export function cancelledLine(
  reason: string | null | undefined,
  you: Side | null | undefined,
  aUsername?: string | null,
  bUsername?: string | null,
): string {
  const text = (reason || '').trim();
  if (!text) return 'Cancelled';
  if (text.toLowerCase() === EXPIRED) {
    // Nobody refused: the time ran out and the coins went back.
    return 'Expired';
  }
  if (text.toLowerCase() === CONNECTION_REMOVED) {
    return 'Cancelled — the connection was removed';
  }
  const side = whoCancelled(text);
  if (!side) return `Cancelled — ${text}`;
  if (side === you) return 'You cancelled it';
  const them = (side === 'a' ? aUsername : bUsername) || 'They';
  return them === 'They' ? 'They cancelled it' : `${them} cancelled it`;
}

/** This wallet's side of a finished round, as the transaction list gets it. */
export interface MixRow {
  denom_sats: number;
  partner?: string | null;
  fee_sats?: number;
  change_sats?: number;
  dust_to_fee?: number;
}

function grouped(n: number): string {
  // Not toLocaleString: Hermes ships without full Intl.
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * "Tango · alice" — the whole label for a row in a transaction list.
 *
 * NOT tango.ts's mixLabel, which is the label written on a COIN ("Tango mix -
 * alice · 2026-09-25") and is matched by the send guard. Two different strings
 * for two different places; named apart because the modules re-export into
 * each other and a silent swap would put guard wording in a list and list
 * wording on a coin.
 */
export function mixRowLabel(mix: MixRow): string {
  return `Tango · ${mix.partner || 'someone'}`;
}

/**
 * What the mixed amount does not say: what the round cost THIS side.
 *
 * It is the fee and nothing else — a mix moves no money — and the two sides of
 * one transaction can differ, which is the part that looks wrong until it is
 * explained. Empty when the round predates the server recording it, rather
 * than "fee 0", which would be a claim.
 */
export function mixFeeNote(mix: MixRow): string {
  return mix.fee_sats ? `fee ${grouped(mix.fee_sats)} sats` : '';
}

/**
 * What to call the outputs of a mix that are not ours.
 *
 * Both clients list "Recipients" — every output the wallet does not own — and
 * in a Tango that is the other side's own share going back to them. Nobody was
 * paid, and a heading that says otherwise is the reading the whole feature is
 * trying to avoid.
 */
export function mixOtherShareTitle(mix: MixRow): string {
  return mix.partner ? `${mix.partner}'s share` : 'Their share';
}

/**
 * Where the change coin went, for the side that has none.
 *
 * THE QUESTION THIS ANSWERS. A side that put in 13,749 for a 13,000 mix expects
 * 749 back and finds nothing in its coin list, while the other side of the same
 * transaction kept its change and paid a smaller fee. The excess was 322 after
 * the fee share — under the dust limit, too small to be worth an output — so it
 * went to the miner. Nothing on chain says that and the wallet has to.
 *
 * Empty unless it happened, so no row carries a sentence about nothing.
 */
export function mixDustNote(mix: MixRow): string {
  const dust = mix.dust_to_fee || 0;
  if (dust <= 0) return '';
  return (
    `Your change would have been ${grouped(dust)} sats — too small to be worth ` +
    `its own output, so it went to the fee instead. That is why this round ` +
    `cost you more than it cost ${mix.partner || 'the other side'}, and why ` +
    `there is no change coin from it.`
  );
}

/**
 * One sentence saying what happens next and who does it.
 *
 * Names the person rather than the role: "A" and "B" are the protocol's words
 * for who went first, and they mean nothing to whoever is reading a list.
 */
export function turnLine(
  status: string,
  role: Side | null | undefined,
  partner: string | null | undefined,
): string {
  const them = partner || 'them';
  if (status === 'BROADCAST') return 'Done — both shares are on chain.';
  if (status === 'CANCELLED') return '';
  if (!isMyTurn(status, role)) {
    return status === 'PROPOSED'
      ? `Waiting for ${them} to match it.`
      : `Waiting for ${them} to sign.`;
  }
  switch (status) {
    case 'PROPOSED':
      return `Choose your coins and match it. ${them} approves, then you send it.`;
    case 'ACCEPTED':
      return `Approve it. ${them} then sends it — nothing is on chain until they do.`;
    default:
      return 'Yours finishes it and puts it on the network.';
  }
}
