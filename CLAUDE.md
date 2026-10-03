# Working in this repo

## Never rewrite published history

`git filter-repo`, rebase, amend or force-push against a branch that has been
pushed — most of all `master` — invalidates every clone that already has it.
The person pulling is told nothing useful: they were up to date, they pull, and
git tries to merge two histories whose only common ancestor is months back.
Every file conflicts, even when the tips are byte-for-byte identical.

That happened here on 2026-09-16. A `filter-repo` run stripped ~142 MB of
committed APKs and the force-push gave all 217 commits new SHAs.
`cc27393` and `e3bb831` are the same commit — same message, same timestamp,
same tree `27df3d4` — with different hashes. A pull afterwards merged 158 old
commits against 220 new ones. Nothing was lost, and it was still a mess to
clean up.

**The rule:** do not rewrite pushed history. If the user explicitly asks for it
anyway, that is their call — but the *same reply* that reports the force-push
must carry the re-sync recipe below, because every existing clone is broken the
moment it lands. Saying it later is too late; they will hit it first.

Re-sync recipe, for whoever has a stale clone:

```bash
git fetch origin
git status                  # commit or stash anything uncommitted first

# Local commits whose patch is NOT already on the new master.
# Patch-id matching sees through the rewrite, so re-landed work is not listed.
git log --oneline --cherry-pick --right-only origin/master...HEAD

# Nothing of yours listed (merge commits and any the rewrite touched will be):
git checkout -B master origin/master

# Something of yours listed: save it, then re-point and replay.
git format-patch origin/master...HEAD -o /tmp/mine
git checkout -B master origin/master
git am /tmp/mine/*.patch
```

Never `git pull` a rewritten branch. `pull` merges; the fix is to *replace* the
branch.

## Standing instructions from the user

- **Do not remove or disable anything without asking first.** This covers CI
  workflows, tests, features and files alike.
- **`.github/workflows/build-ios.yml` must not be deleted.** It was once, on a
  misreading of "no need for ios" (which meant "don't extend the new mainnet
  work to iOS"). If iOS CI is ever genuinely unwanted, disable the triggers and
  say so in the file.
- **Never skip, disable or quarantine a test** to get CI green.
- Private keys are never stored: not the BIP-84 key, not the passphrase.
- Push notifications must not mention amounts — they pass through Google.
- Web mainnet stays closed to the outside; onboarding is mobile-app only.

## Layout

One `src/` serves both apps. `src/screens/*.tsx` is React Native (Android and
`ios/`), `src/views/*.vue` is the web app, and `src/services/`, `src/stores/`
and `src/api/` are shared. A change to shared code needs checking on both
sides, and a rule enforced in one client usually belongs in the other too.

The backend is the separate `siLNt` repo (an LNbits extension). It is the
authority for anything about money — the clients mirror its rules for a faster
error, they do not define them. When a validation rule changes, change it there
first, then mirror it.

## Checks before pushing

```bash
npx tsc --noEmit            # React Native side
npm run lint                # stale hook closures (see below)
npm run build:signet        # web app
npm run check:signing       # both on-device signers vs the Python
npm run check:update        # what the update path offers, vs a real release
npm run check:contacts      # a stale saved address is visible and fixable
npm run check:lock          # unlocking asks every time
cd ../siLNt && python3 -m pytest tests/ -q
```

`check:lock` is about one weakness and one fix for it that does not work.

react-native-keychain 8.2.0 generates the app lock's keystore key with a
**five-second authentication validity window**: after any device
authentication — including unlocking the phone — the key is readable again
with no prompt. `services/appLock.ts` rests on "a successful read means the
user authenticated", so inside that window the read succeeds having asked
nobody anything and the lock screen can open on a tap. It is open at exactly
the moment that screen is shown, which is how pressing **Try again** let a
user straight in (2026-10-02).

**Do not close it by patching the key spec.** That was tried the same day —
`setUserAuthenticationParameters(0, …)` on R+, `…ValidityDurationSeconds(-1)`
below — and it locked every user out of their wallet.
`DecryptionResultHandlerInteractiveBiometric` raises its prompt with **no
`CryptoObject`**, so a biometric success authorises nothing, the retried
decrypt throws `UserNotAuthenticatedException` again, and the prompt loops
forever. The window is the library's only mechanism for authorising the key.
Every device that unlocked once on that build rewrote its sentinel into a key
nothing could read. `check:lock` refuses that patch, and the `postinstall`
hook that applied it, coming back.

Closing it properly needs a keychain whose prompt carries a `CryptoObject`.
Until then it is a five-second weakness in the biometric path; the in-app PIN
is a separate mechanism and is unaffected.

What does work, and what `check:lock` keeps: a read is a pass only if it came
back from the auth-binding storage **and** decrypted to our sentinel
(`storageEnforcesAuth`), because the OS silently downgrades to a storage that
needs no authentication when biometry is unavailable at write time.

`sentinelKeyIsBroken` finds the marker the broken build left and
`rebuildSentinel` replaces the key, on mount — a repair behind an unlock can
never run, because the key is what is unreadable. Rebuilding is not a way past
the lock: writing a sentinel needs no authentication, but the key it writes
still has to be READ to unlock, which still raises a prompt.

The app lock is the ONLY thing in the wallet written with an `accessControl`,
so all of this reaches nothing else — `check:lock` asserts that too, because a
second one would start demanding a prompt per use, which for a wallet key
would mean one per signature.

## The resume point

`wallets.last_scan_height` is one claim: **every block up to here has been
looked at.** Nothing in either app can tell that it is wrong — a wallet whose
resume point is too high reports itself fully scanned while a payment sits in
a block nothing ever read. Two rules keep it honest, and both were broken
until 2026-10-03, when a mainnet balance had to be repaired by editing this
column by hand.

**It starts one BELOW the range.** `last_scanned_height = start - 1`, because
nothing has been looked at yet. It used to start at `start`, which claimed the
first block was scanned before anything had scanned it: a scan that read
nothing — the first block unindexed, or stopped before the first batch — wrote
that block as done and the next scan began above it. Skipped for good.

**It only ever moves forward.** `set_last_scan_height` is a guarded `UPDATE`
(`WHERE last_scan_height IS NULL OR last_scan_height < :height`), in one
statement so two scans finishing at once cannot have the slower one's older
value land last. Scanning an EARLIER range does not make the claim less true,
so a deliberate rescan must not rewind it — the next scan would redo
everything above, which on mainnet is hours.

That second rule is what makes a rescan control safe to offer at all, and the
phone now has one: a lookback chooser on the scan screen (10 / 144 / 1,008 /
4,320 blocks back from the tip), live **even when the wallet is up to date**,
because that is exactly when somebody needs it — a payment that never appeared
is in a block the wallet believes it has already read. Before it, the phone
computed its range and never offered the fields, so "Up to date" disabled the
only button and there was no way back. The web has had editable From/To all
along.

Separately, a block the scan could not read holds the resume point below it
and is reported as `gap` on the progress record, so neither client claims the
wallet is up to date while there is a hole in it. See
`tests/test_scan_gap_is_reported.py` and `tests/test_resume_point.py`.

`lint` is two rules, not a style pass: `react-hooks/exhaustive-deps` and
`rules-of-hooks`. It had no config at all until 2026-09-24 and so had never
run — which is how a `useCallback` that read `network` without listing it
shipped. The closure kept the `useState` default for the life of the screen,
the mainnet app asked the server about signet, and the network check passed
for the exact case it was written to refuse. Typechecking cannot see it and
review kept missing it, twice.

The whole tree passes it, so a finding is yours. Prefer narrowing the value
over suppressing the rule — an effect that wants `wallet.id` should depend on
an `id` binding, not on `wallet` — and add rules only when you are willing to
fix what they find.

None of these touch the Android native code. `android/app/src/main/java/…/updater`
is only compiled by a real Gradle build, so a change there needs one:

```bash
npm run apk:signet          # or apk:signet:lowmem
```

`check:signing` holds `src/services/spSign.ts`, `src/services/plainSign.ts`,
`src/services/spPayjoin.ts` and `src/services/chains.ts` to vectors generated
from the backend's own code. Both apps now build and sign every send on the
device, so a change to a fee formula, an output ordering or a derivation —
**on either side** — needs the vectors regenerated:

```bash
cd ../siLNt
python3 helpers/_client_signing_fixtures.py > fixtures/client-signing.json
python3 helpers/_plain_signing_fixtures.py  > fixtures/plain-signing.json
python3 helpers/_payjoin_sp_fixtures.py     > fixtures/payjoin-sp.json
python3 helpers/_chain_guard_fixtures.py    > fixtures/chain-guard.json
```

The last one is the address-to-chain rule, and it is pinned down to the
sentence rather than the verdict. `helpers/chains.py` is the authority;
`services/chains.ts` exists only so a cross-chain recipient is refused while
it is being typed. Two apps that agree to refuse and disagree about why is
still a drift.

The PayJoin one carries the most weight of the three. An ordinary send that
derives wrongly makes an output the recipient cannot find — one party's bug. A
PayJoin has two parties deriving different outputs of the *same* transaction
from the *same* frozen input set, each signing over both: if the client's
`A_sum` or `input_hash` differs from the server's by a byte, both outputs
belong to nobody, both signatures still verify, and the network accepts it.
Nothing anywhere reports an error. That is why `A_sum` is compared compressed,
parity byte included.
