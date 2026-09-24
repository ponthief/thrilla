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
