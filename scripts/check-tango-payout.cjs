#!/usr/bin/env node
/*
 * The one place Lightning appears in WhiSPa, and the things it must say.
 *
 * WHAT THE SETTING IS. A Tango round leaves a change output, and it is the
 * strongest remaining linkability problem in the protocol: its value is fixed
 * by the round's arithmetic, so spending it later — to anyone, on its own,
 * months afterwards — identifies which of the two identical shares were
 * yours. undoesARound refuses to co-spend it with a share, but the coin has to
 * be spent eventually. Giving a Lightning address has the output pay the
 * service instead, with its value sent on minus a fee.
 *
 * THREE THINGS THIS GUARDS, each of which has a way of going wrong quietly:
 *
 *  1. The consent line. "Send my change over Lightning" does not tell anyone
 *     the coin stops being theirs, and that is the part nobody would guess.
 *     It must be in front of them before they switch it on, not discovered
 *     after a round.
 *  2. The minimum comes from the server, and no fee figure is written into a
 *     client at all. A number typed into a client is one the backend can
 *     change underneath it, and the user reading the stale one is the one it
 *     applies to.
 *  3. Mainnet only. A Lightning address is a mainnet endpoint and signet
 *     change is worthless, so the server reports offered:false and the
 *     clients must render nothing — a field that silently cannot work is
 *     worse than no field.
 *
 * Run: node scripts/check-tango-payout.cjs
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const SHARED = read('src/services/lnAddress.ts');
const CARD = read('src/components/TangoPayoutCard.tsx');
const WEB = read('src/components/TangoPayoutPanel.vue');
// Reachability: the setting has to be findable from Settings, not only from
// the screen you go to in order to start a round.
const RN_SETTINGS = read('src/screens/SettingsScreen.tsx');
const RN_SETTINGS_PAGE = read('src/screens/settings/TangoChangePage.tsx');
const WEB_SETTINGS = read('src/views/ConfigView.vue');
const WEB_TANGO = read('src/views/TangoView.vue');
const RN_API = read('src/services/api.ts');
const WEB_API = read('src/api/index.js');

console.log('one wording, shared by both clients');
{
  for (const k of ['PAYOUT_TITLE', 'PAYOUT_WHY', 'PAYOUT_CONSENT']) {
    ok(`${k} is defined once`, new RegExp(`export const ${k}`).test(SHARED));
    ok(`the phone renders ${k}`, CARD.includes(k));
    ok(`the browser renders ${k}`, WEB.includes(k));
  }
  // The minimum sentence too, so the threshold is not phrased twice.
  ok('the minimum note is a shared function',
    /export function payoutMinimumNote/.test(SHARED));
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} calls payoutMinimumNote`, src.includes('payoutMinimumNote('));
  }
  // And the example address, which is a placeholder rather than somebody's
  // real account at a real provider — an empty field invites pasting it.
  ok('the example address is shared',
    /export const LN_ADDRESS_EXAMPLE = 'username@domain\.com'/.test(SHARED));
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} uses it as the placeholder`, src.includes('LN_ADDRESS_EXAMPLE'));
    ok(`the ${label} names no real provider`, !/coinos|satoshi@/i.test(src));
  }
}

console.log('\nit says the coin stops being theirs, before it is switched on');
{
  const consent = (SHARED.match(/PAYOUT_CONSENT\s*=\s*([\s\S]*?);/) || [])[1] || '';
  const text = consent.replace(/['+\n]/g, ' ').replace(/\s+/g, ' ').trim();
  ok('the consent line exists', text.length > 20, text);
  ok('it says the change leaves their wallet', /leaves your wallet/i.test(text), text);
  ok('it says what pays for it', /pays this service/i.test(text), text);
  ok('it says when', /after the round confirms/i.test(text), text);
  // Rendered where the decision is made, not on a page they would have to go
  // and find.
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} shows it beside the field`,
      src.indexOf('PAYOUT_CONSENT') < src.lastIndexOf('LN_ADDRESS_EXAMPLE'),
      'the consent line must come before the input, not after it');
  }
}

console.log('\nthe minimum comes from the server, and no number is typed in');
{
  // The fee prose is gone from both clients on purpose — it read as a
  // paragraph of arithmetic in front of a one-line decision. What is left is
  // the threshold, and it is the server's number: one written into a client is
  // one the backend can change underneath it.
  for (const [label, src] of [['phone', CARD], ['browser', WEB], ['shared', SHARED]]) {
    const prose = src.replace(/\s+/g, ' ');
    ok(`${label} hardcodes no percentage`, !/0\.5\s*%|0\.005/.test(prose),
      'the fee is the server\'s number, not the client\'s');
    ok(`${label} hardcodes no floor`, !/\b100 sats\b/.test(prose),
      'the fee floor is the server\'s number, not the client\'s');
    ok(`${label} hardcodes no minimum change`, !/\b646\b/.test(prose),
      'read min_change_sats from the GET instead');
  }
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} reads min_change_sats`, src.includes('min_change_sats'));
  }
}

console.log('\noff keeps the address, so it can be turned back on');
{
  // The bug this replaced: "Turn off" DELETED the address, so the only route
  // back on was remembering what had been typed, in front of an empty field
  // that did not say whether anything had ever been saved.
  ok('the shared type has a switch', /enabled: boolean/.test(RN_API),
    'the GET must report saved-and-off as its own state');
  for (const [label, src] of [['phone', RN_API], ['browser', WEB_API]]) {
    ok(`the ${label} API can switch it`, /setTangoPayoutEnabled/.test(src));
    ok(`the ${label} API switch is not a DELETE`,
      /ln-address\/enabled/.test(src),
      'turning it off must not be the delete endpoint');
  }
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} reads .enabled`, /\.enabled/.test(src));
    ok(`the ${label} offers a way back on`, /Turn on/.test(src));
    ok(`the ${label} turns off without deleting`,
      src.includes('setTangoPayoutEnabled('),
      'Turn off must flip the switch, not delete the address');
    // Forgetting it is still possible, and still says what it is.
    ok(`the ${label} can still forget it`,
      src.includes('deleteTangoLnAddress(') && /Forget/.test(src));
    ok(`the ${label} says when it is off`, /your change stays in your wallet/i.test(src));
  }
}

console.log('\nreachable from Settings, not only from the Tango screen');
{
  // Where it was looked for when it had been switched off.
  ok('the phone has a Settings page for it',
    /TangoPayoutCard/.test(RN_SETTINGS_PAGE));
  ok('the phone lists it in Settings',
    /TangoChangePage/.test(RN_SETTINGS) && /setPage\('tangochange'\)/.test(RN_SETTINGS));
  ok('the phone hides the row when not offered',
    /payout\?\.offered/.test(RN_SETTINGS),
    'a row leading to a page that renders nothing is worse than no row');
  ok('the phone says On, Off or Not set',
    /'Off'/.test(RN_SETTINGS) && /'Not set'/.test(RN_SETTINGS),
    'saved-and-off is the state somebody comes to Settings to change');
  ok('the browser has it in Settings', /TangoPayoutPanel/.test(WEB_SETTINGS));
  // One component in both places, so the two cannot drift.
  ok('the browser Tango screen uses the same component',
    /TangoPayoutPanel/.test(WEB_TANGO));
  ok('the browser Tango screen keeps no copy of the form',
    !/PAYOUT_CONSENT/.test(WEB_TANGO),
    'the panel is the control; a second copy would drift');
}

console.log('\nmainnet only, decided by the server');
{
  // Not a client-side network check: one authority, and it is the one that
  // would be paying out.
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} renders nothing unless offered`, /\.offered/.test(src));
    ok(`the ${label} distinguishes offered from ready`, /\.ready/.test(src),
      'the chain allowing it is not the instance having switched it on');
  }
  ok('the phone returns null when not offered',
    /if \(!setting \|\| !setting\.offered\) return null;/.test(CARD));
}

console.log('\nthe address is checked locally, then properly by the server');
{
  ok('the shape check is shared', /export function lnAddressProblem/.test(SHARED));
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} checks the shape first`, src.includes('lnAddressProblem('));
    // The server resolves LUD-16 and knows whether the provider can accept a
    // change-sized payment. Its refusal is the useful one.
    ok(`the ${label} shows the server's refusal`,
      /Could not save that address\./.test(src));
  }
  // Mirrored from the Python, which is the authority.
  ok('the shared check says what it mirrors',
    /helpers\/lnaddress\.py/.test(SHARED));
}

console.log('\nevery call is scoped to a network');
{
  for (const [label, src] of [['phone', RN_API], ['browser', WEB_API]]) {
    const calls = src.match(/ln-address(\/enabled)?\?network=[^`]*/g) || [];
    ok(`the ${label} API has all four calls`, calls.length === 4,
      `${calls.length} found`);
    ok(`the ${label} encodes the network`,
      calls.every((c) => c.includes('encodeURIComponent(network)')));
  }
  ok('the phone can forget it', /deleteTangoLnAddress/.test(RN_API));
  ok('the browser can forget it', /deleteTangoLnAddress/.test(WEB_API));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — the change payout says what it takes, and off is not a one-way door');
