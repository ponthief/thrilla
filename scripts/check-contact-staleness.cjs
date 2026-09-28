#!/usr/bin/env node
/*
 * A saved SP address can stop belonging to anyone.
 *
 * It is frozen at the moment it was saved. The person it belongs to can delete
 * that wallet and make another, and nothing on either side says so: the name
 * in the sender's address book still looks right, the address is still valid
 * bech32, and a payment to it is gone — no bounce, no error, no way back.
 * There was no check of any kind.
 *
 * What the server can honestly answer is one bit: does a WhiSPa wallet hold
 * this address RIGHT NOW. It cannot say "this used to be alice" — deleting a
 * wallet removes the row, by design — so a wallet that is gone and a recipient
 * who never used WhiSPa look identical from there. Every piece of wording
 * below has to survive that, which is what this file holds.
 *
 * Run: node scripts/check-contact-staleness.cjs
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

const SEND_RN = read('src/screens/SendScreen.tsx');
const SEND_WEB = read('src/views/SendView.vue');
const MODAL_RN = read('src/components/ContactsModal.tsx');

console.log('the verdict reaches the screen the send happens on');
for (const [label, src, flag] of [
  ['mobile', SEND_RN, 'unverified'],
  ['web', SEND_WEB, 'recipientUnverified'],
]) {
  // Derived from the recipient, not stored: it is set from a picker, a paste,
  // a scan and the keyboard, and a stored flag would have to be cleared in
  // every one of them.
  ok(`${label} derives it from the current recipient`,
    new RegExp(`${flag}\\s*=\\s*(useMemo|computed)`).test(src),
    'a stored flag goes stale the moment the recipient is edited');
  ok(`${label} only flags a raw SP contact`,
    new RegExp(`kind === 'sp' && [\\w.]*\\.whispa === false`).test(src),
    'a BitMail contact resolves at send time and is never stale');
  ok(`${label} warns before the coins leave`, src.includes(flag + ' ?') || src.includes(`"${flag}"`));
}

console.log('\nthe wording claims only what the server knows');
for (const [label, src] of [['mobile', MODAL_RN], ['web', SEND_WEB], ['mobile send', SEND_RN]]) {
  const text = src.replace(/\s+/g, ' ');
  ok(`${label} does not claim the wallet was deleted`,
    !/has deleted|was deleted|no longer exists/i.test(text),
    'the server cannot tell a gone wallet from a non-WhiSPa one');
  ok(`${label} says a non-WhiSPa recipient is normal`,
    /does not use WhiSPa/.test(text),
    'without it, every ordinary SP address reads as a warning');
  ok(`${label} says the loss is unrecoverable`,
    /cannot be recovered/.test(text));
}

console.log('\nand the contact can be corrected');
ok('mobile offers Change address', MODAL_RN.includes('Change address'));
ok('web offers Change address', SEND_WEB.includes('Change address'));
ok('mobile sends the new value', /updateContact\([^)]*\{ value/.test(SEND_RN.replace(/\s+/g, ' ')));
ok('web sends the new value', /spContactUpdate\([^)]*\{ value/.test(SEND_WEB.replace(/\s+/g, ' ')));
// Renaming must still work: the endpoint takes either field, and the web
// helper still accepts a bare string for the callers that only rename.
ok('the web helper still accepts a bare label',
  read('src/api/index.js').includes("typeof patch === 'string'"));

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — a stale contact is visible and fixable');
