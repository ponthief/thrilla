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
 *  2. The fee and the threshold come from the server. A percentage written
 *     into a client is a number the backend can change underneath it, and the
 *     user reading the stale one is the one who gets charged the real one.
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
const WEB = read('src/views/TangoView.vue');
const RN_API = read('src/services/api.ts');
const WEB_API = read('src/api/index.js');

console.log('one wording, shared by both clients');
{
  for (const k of ['PAYOUT_TITLE', 'PAYOUT_WHY', 'PAYOUT_CONSENT']) {
    ok(`${k} is defined once`, new RegExp(`export const ${k}`).test(SHARED));
    ok(`the phone renders ${k}`, CARD.includes(k));
    ok(`the browser renders ${k}`, WEB.includes(k));
  }
  // The fee sentence too, so "0.5%" is not typed out twice in two places.
  ok('the fee note is a shared function',
    /export function payoutFeeNote/.test(SHARED));
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    ok(`the ${label} calls payoutFeeNote`, src.includes('payoutFeeNote('));
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
      src.indexOf('PAYOUT_CONSENT') < src.indexOf('satoshi@coinos.io'),
      'the consent line must come before the input, not after it');
  }
}

console.log('\nthe fee and the threshold come from the server');
{
  // A percentage or a floor written into a client is a number the backend can
  // change underneath it.
  for (const [label, src] of [['phone', CARD], ['browser', WEB], ['shared', SHARED]]) {
    const prose = src.replace(/\s+/g, ' ');
    ok(`${label} hardcodes no percentage`, !/0\.5\s*%|0\.005/.test(prose),
      'read fee_pct from the GET instead');
    ok(`${label} hardcodes no floor`, !/\b100 sats\b/.test(prose),
      'read fee_floor_sats from the GET instead');
    ok(`${label} hardcodes no minimum change`, !/\b646\b/.test(prose),
      'read min_change_sats from the GET instead');
  }
  for (const [label, src] of [['phone', CARD], ['browser', WEB]]) {
    for (const field of ['fee_pct', 'fee_floor_sats', 'min_change_sats']) {
      ok(`the ${label} reads ${field}`, src.includes(field));
    }
  }
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
    const calls = src.match(/ln-address\?network=[^`]*/g) || [];
    ok(`the ${label} API has all three calls`, calls.length === 3,
      `${calls.length} found`);
    ok(`the ${label} encodes the network`,
      calls.every((c) => c.includes('encodeURIComponent(network)')));
  }
  ok('the phone can turn it off', /deleteTangoLnAddress/.test(RN_API));
  ok('the browser can turn it off', /deleteTangoLnAddress/.test(WEB_API));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — the change payout says what it costs and what it takes');
