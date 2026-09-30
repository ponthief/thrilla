#!/usr/bin/env node
/*
 * One Lightning flag, two clients, and nothing showing on a build without it.
 *
 * WHAT WENT WRONG BEFORE. The phone had a hardcoded `LIGHTNING_ENABLED = false`
 * in theme.ts; the web app derived its own from `NETWORK_LOCK === 'regtest'`.
 * Two flags, two different ideas of what turns Lightning on, and neither could
 * be on for signet — where the work that needs Lightning is being tested. The
 * flags could not even disagree usefully, because nothing compared them.
 *
 * They are now one name set per flavour in .env.*, read through the only
 * mechanism each bundler has: `import.meta.env.VITE_LIGHTNING_ENABLED` does
 * not exist under Babel, and `react-native-config` does not exist under Vite,
 * so the two readers stay — but the name and the files do not.
 *
 * WHAT THIS PROTECTS. Lightning appearing on a build whose LNbits instance has
 * no Lightning. Mainnet is off until somebody turns it on deliberately, and an
 * unguarded surface is how that decision gets made by accident.
 *
 * Run: node scripts/check-lightning-flag.cjs
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

const THEME = read('src/theme.ts');
const APP_VUE = read('src/App.vue');
const ROUTER = read('src/router/index.js');

console.log('one flag, read the only way each bundler can');
{
  ok('the phone reads it from react-native-config',
    /LIGHTNING_ENABLED\s*=\s*Config\.LIGHTNING_ENABLED === 'true'/.test(THEME),
    'theme.ts must not hardcode it — that is how the two clients drifted');
  ok('and does not hardcode it',
    !/LIGHTNING_ENABLED\s*=\s*(true|false)\b/.test(THEME));
  ok('the web reads it from the Vite env',
    /LIGHTNING_ENABLED\s*=\s*import\.meta\.env\.VITE_LIGHTNING_ENABLED === 'true'/
      .test(APP_VUE));
  // The old derivation. A network lock says which chain, not whether the
  // instance has a Lightning node.
  ok('the web no longer derives it from the network lock',
    !/LIGHTNING_ENABLED\s*=\s*NETWORK_LOCK/.test(APP_VUE));
  // Tested against real usage, not prose: both files explain the split in a
  // comment, and naming the other mechanism there is the point.
  ok('neither client reads the other one\'s mechanism',
    !/import\.meta\.env\./.test(THEME)
    && !/from ['"]react-native-config['"]/.test(APP_VUE),
    'import.meta.env is undefined under Babel; react-native-config under Vite');
}

console.log('\nevery flavour states it, and mainnet says no');
{
  // Absent is falsy in both readers, so this is about being explicit: the
  // decision to leave Lightning off on mainnet should be visible in the file
  // rather than inferred from a missing line.
  for (const [file, key, want] of [
    ['.env.signet', 'VITE_LIGHTNING_ENABLED', 'true'],
    ['.env.signet', 'LIGHTNING_ENABLED', 'true'],
    // Regtest had it on under the old network derivation. Moving to a flag
    // must not quietly take it away.
    ['.env.regtest', 'VITE_LIGHTNING_ENABLED', 'true'],
    ['.env.mainnet', 'VITE_LIGHTNING_ENABLED', 'false'],
    ['.env.mainnet', 'LIGHTNING_ENABLED', 'false'],
    ['.env', 'LIGHTNING_ENABLED', 'false'],
    ['.env.example', 'LIGHTNING_ENABLED', 'false'],
  ]) {
    const src = read(file);
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(src);
    ok(`${file} sets ${key}=${want}`, !!line && line[1].trim() === want,
      line ? `found ${key}=${line[1]}` : `${key} not set`);
  }
  // The un-prefixed key is the phone's and the VITE_ one is the browser's;
  // a VITE_ prefix on the phone's line would read as unset and vice versa.
  const signet = read('.env.signet');
  ok('the two keys are separate lines, not one',
    /^LIGHTNING_ENABLED=/m.test(signet) && /^VITE_LIGHTNING_ENABLED=/m.test(signet));
}

console.log('\nnothing Lightning renders without it');
{
  for (const [file, src] of [
    ['src/screens/WalletScreen.tsx', read('src/screens/WalletScreen.tsx')],
    ['src/screens/ReceiveScreen.tsx', read('src/screens/ReceiveScreen.tsx')],
    ['src/screens/SendScreen.tsx', read('src/screens/SendScreen.tsx')],
  ]) {
    ok(`${file} gates its Lightning surface`, src.includes('LIGHTNING_ENABLED'),
      'an LN surface that ignores the flag ships Lightning to mainnet');
  }
  ok('the web nav item is gated',
    /LIGHTNING_ENABLED \? \[\{ name: 'lightning'/.test(APP_VUE));
  // A hidden nav item is only hidden: /lightning still resolves.
  ok('and so is the route',
    /to\.name === 'lightning'[\s\S]{0,200}VITE_LIGHTNING_ENABLED !== 'true'/
      .test(ROUTER),
    'the URL works even when the tab is hidden');
}

console.log('\nthe phone can spend what is credited to it');
{
  // The point of the Tango-change work: a balance the wallet puts in your
  // account and gives you no way to move is not a balance. Onboarding is
  // mobile-only, so "do it in the browser" is not an answer.
  const API = read('src/services/api.ts');
  ok('lnPayInvoice exists', /export async function lnPayInvoice/.test(API));
  ok('lnDecodeInvoice exists', /export async function lnDecodeInvoice/.test(API));
  ok('paying uses the admin key, not the invoice key',
    /lnPayInvoice\(\s*\n?\s*adminkey: string/.test(API),
    'the invoice key asks to be paid; only the admin key spends');

  const LS = read('src/components/LightningSend.tsx');
  ok('the invoice is decoded before it is paid', LS.includes('lnDecodeInvoice'),
    'nobody can tell 40,000 sats from 4,000 by looking at a bolt11');
  // LNbits takes no amount on `out: true`, so the payer cannot choose one.
  ok('a zero-amount invoice is refused with the reason',
    /asks for no particular amount/.test(LS));
  ok('a decoded invoice does not outlive an edit',
    /setDecoded\(null\)/.test(LS),
    'otherwise Pay reads one invoice amount and sends another');
  ok('an over-balance invoice is caught before Pay',
    /invoiceSats > balanceSats/.test(LS));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — one flag, and Lightning stays off where it is off');
