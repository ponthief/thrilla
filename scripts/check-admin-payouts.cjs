#!/usr/bin/env node
/*
 * The admin console's payout ledger says what the money is doing.
 *
 * A routed Tango change output is the INSTANCE's from the moment the round
 * confirms, and the net is then owed to the user over Lightning. That makes
 * the console two things at once: an earnings report and a liability report.
 * Three ways it could mislead, each of which this refuses:
 *
 *  1. Counting fees on payouts that never went out. The instance is then
 *     holding the whole change, not earning part of it, and the figure would
 *     overstate earnings by exactly what it failed to deliver.
 *  2. Showing what is owed as if it were a balance. It is a debt.
 *  3. Showing the user's CURRENT Lightning address rather than the one the
 *     payout was actually sent to. That is the entire reason the address is
 *     stored on the payout row, and getting it wrong turns a dispute from
 *     answerable into unanswerable.
 *
 * Run: node scripts/check-admin-payouts.cjs
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

const ADMIN = read('src/views/AdminView.vue');
const API = read('src/api/index.js');

console.log('the earnings figure is only on money that moved');
{
  ok('it reads fees_earned_sats', ADMIN.includes('fees_earned_sats'),
    'the server computes this over PAID rows only');
  // Summing fee_sats in the client over every row would include undelivered
  // ones, which is the overstatement this guards.
  ok('it does not sum fees itself',
    !/fee_sats[\s\S]{0,80}reduce|reduce[\s\S]{0,80}fee_sats/.test(ADMIN),
    'take the server total rather than adding up rows');
  ok('it says what the figure covers',
    /not revenue|actually delivered/.test(ADMIN));
}

console.log('\nwhat is owed is shown as a debt');
{
  ok('owed is shown', ADMIN.includes('owed_sats'));
  ok('and called a liability', /liability, not a balance/.test(ADMIN));
  ok('the undelivered count is shown', ADMIN.includes('undelivered_count'));
}

console.log('\na dispute can be answered from the row');
{
  // The address the money went to, not the setting as it stands today.
  ok('each row shows the address it was sent to',
    /row\.ln_address/.test(ADMIN));
  ok('and says so when there is none',
    /no address on record/.test(ADMIN));
  ok('gross, fee and net are all shown',
    /row\.gross_sats/.test(ADMIN) && /row\.fee_sats/.test(ADMIN)
      && /row\.net_sats/.test(ADMIN),
    'a dispute about the amount needs all three');
  ok('the attempt count is shown', /row\.attempts/.test(ADMIN));
  ok('the provider\'s own error is shown', /row\.last_error/.test(ADMIN));
}

console.log('\nthe two ways a payout stops are distinguished');
{
  // One is waiting on the user, the other on the operator.
  ok('both statuses are filterable',
    ADMIN.includes('"unpayable"') || ADMIN.includes("'unpayable'"));
  ok('the difference is explained', /waiting on the user/.test(ADMIN));
  ok('a stopped payout can be retried', /retryPayout/.test(ADMIN));
  ok('a paid one cannot', /row\.status !== 'paid'/.test(ADMIN));
}

console.log('\nand the API is admin-scoped');
{
  ok('getTangoPayouts exists', /export async function getTangoPayouts/.test(API));
  ok('retryTangoPayout exists', /export async function retryTangoPayout/.test(API));
  for (const fn of ['getTangoPayouts', 'retryTangoPayout']) {
    const body = API.slice(API.indexOf(`function ${fn}`));
    ok(`${fn} hits the admin route`,
      body.slice(0, 400).includes('/admin/tango/payouts'));
    ok(`${fn} uses the admin key`, body.slice(0, 400).includes('keyHeaders(adminkey)'));
  }
}

console.log('\nliquidity is shown, and shown as the reason the feature stops');
{
  // An undelivered payout is almost always this, and when the floor is
  // breached the feature has already stopped being offered to users — the
  // operator needs to be told why rather than discover it.
  ok('the balance is shown', /liquidity\.balance_sats/.test(ADMIN));
  ok('and what is already owed against it', /liquidity\.owed_sats/.test(ADMIN));
  ok('and what is therefore available', /liquidity\.available_sats/.test(ADMIN));
  ok('and the floor it is measured against', /liquidity\.threshold_sats/.test(ADMIN));
  // A raw balance would be the wrong measure, so the page says what
  // "available" means rather than leaving an operator to assume.
  ok('it explains that owed is subtracted', /already owed/.test(ADMIN));
  ok('a breach reads as a warning, not a statistic',
    /alert-warn/.test(ADMIN) && /not being offered to users/.test(ADMIN));
  ok('it says rounds already routed still get paid',
    /keep retrying/.test(ADMIN),
    'otherwise a breach looks like money lost rather than money delayed');
  ok('the threshold is editable',
    /config\.tango_change_min_wallet_balance_sats/.test(ADMIN));
  ok('and the field says users are not told the number',
    /not told the number/.test(ADMIN));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — the ledger reports earnings and debts apart');
