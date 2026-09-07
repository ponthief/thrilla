import * as Keychain from 'react-native-keychain';

// How much catching up this device will do without asking.
//
// Opening the wallet scans the gap between the last scanned block and the tip.
// A short gap is quick and happens silently; a long one is a wait, so it asks
// first. The line between them was a single admin setting
// (login_scan_auto_threshold) governing every client at once — a number chosen
// for browser users, applied to phones on mobile data.
//
// This is the per-device override. Unset means follow the server, so an admin
// still sets the default and nothing changes for anyone who does not choose.
//
// Measured in BLOCKS on the wire because that is what the scan works in, but
// only ever shown as time: "3 days" is something a user can reason about,
// "432 blocks" is not. At ten minutes a block, 144 blocks is a day.

const PREF_SERVICE = 'com.thrilla.catchup';

const BLOCKS_PER_DAY = 144;

// Sentinel: never scan without asking, however small the gap.
export const ALWAYS_ASK = 0;
// Sentinel: no override stored — use whatever the server says.
export const FOLLOW_SERVER = -1;

export const CATCH_UP_CHOICES: { label: string; blocks: number }[] = [
  { label: 'Up to 1 day', blocks: BLOCKS_PER_DAY },
  { label: 'Up to 3 days', blocks: 3 * BLOCKS_PER_DAY },
  { label: 'Up to a week', blocks: 7 * BLOCKS_PER_DAY },
  { label: 'Always ask', blocks: ALWAYS_ASK },
];

// Reads back FOLLOW_SERVER when nothing has been chosen, or when the stored
// value is not one we offer — a corrupted record must not become an unbounded
// silent scan.
export async function getCatchUpBlocks(): Promise<number> {
  try {
    const c = await Keychain.getGenericPassword({ service: PREF_SERVICE });
    if (!c) return FOLLOW_SERVER;
    const n = Number(c.password);
    return CATCH_UP_CHOICES.some((o) => o.blocks === n) ? n : FOLLOW_SERVER;
  } catch {
    return FOLLOW_SERVER;
  }
}

export async function setCatchUpBlocks(blocks: number): Promise<void> {
  try {
    await Keychain.setGenericPassword('catchup', String(blocks), {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the choice applies this session and is re-asked
       next launch, falling back to the server's value rather than to scanning
       more than the user wanted */
  }
}

export async function clearCatchUpBlocks(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: PREF_SERVICE });
  } catch {
    /* ignore */
  }
}

// The threshold to actually use: the device's choice when it has one, the
// server's otherwise. Kept here so the hook and the settings screen cannot
// disagree about what "follow the server" resolves to.
export function effectiveThreshold(
  preference: number,
  serverThreshold: number,
): number {
  return preference === FOLLOW_SERVER ? serverThreshold : preference;
}
