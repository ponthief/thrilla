# Changelog

What changed, per released version. `scripts/cut-release.sh` reads the section
matching the tag it is publishing and puts it at the top of the GitHub release
notes, so this file is the release notes — there is nowhere else to write them
and nothing to paste into the web UI.

The heading has to be `## vX.Y.Z` for the script to find it.

## v0.3.0

### Tango — a two-party mix

The headline. You and one connected person each put in the same amount and each
take the same amount back, in one transaction, with both sides' outputs the
same size. Nothing on chain says which output is whose.

- **Partners.** Connect by WhiSPa username; they approve, then either of you
  can send a Tango offer. Connections are per network.
- **Choose your own coins.** Which coins go in is the decision a mix is made
  of, so nothing picks them for you. The form prices your selection as you
  choose: your fee share, your change, and whether the round comes out clean.
- **Take it back as 1, 2 or 3 coins.** More coins means more ways to read the
  round — 2, 6 or 20 — for a little more in miner fees.
- **Both sides sign on their own device.** Every output is derived from the
  whole input set and each signature covers every output, so a round is four
  turns and cannot be fewer. Your device recomputes the entire transaction and
  refuses to sign anything that does not match.
- **Notifications** for every step, on the phone as well as in the browser: an
  offer arriving, an offer matched, your turn to approve, and the round
  completing.
- **A send that would undo a round is refused.** Two shares from one round, or
  a share with its own change, add up to what you put in — the wallet will not
  spend them together.

### Saved contacts

- **A saved Silent Payments address is now checked** against the wallets that
  exist. A contact marked "cannot be verified" is either someone who does not
  use WhiSPa — normal — or someone who has remade their wallet, in which case
  coins sent to the old address cannot be recovered. The wallet cannot tell
  those two apart and says so rather than guessing.
- **Change address.** A contact can be repointed at a new recipient without
  losing its name. Previously the only route was deleting and re-adding it.
- The warning is repeated on the Send screen, which is the last thing you see
  before coins leave.

### Notifications

- Tango notifications reach the phone. They were being sent all along and
  silently dropped by the app.
- Payments and Tango sit on separate Android notification channels, so
  silencing one leaves the other alone.
- The notification carries the WhiSPa mark rather than a featureless blob.
- Settings → Notifications can send a test and reports exactly which link of
  the chain is broken when nothing arrives.

### Fixes

- **App lock:** unlocking restarts the idle clock, so it no longer re-locks
  seconds later. A keychain read that asked nobody anything is no longer
  treated as proof you authenticated. And a prompt that never appears can no
  longer leave the Unlock button dead — tapping a notification used to do
  exactly that.
- **Hide balances** now covers the in-app banners too, and the wallet screen
  shows that the balance can be hidden instead of leaving it to be discovered.
- **Coins:** a frozen coin looks frozen and has its own filter. A coin a live
  Tango is holding is shown as held rather than offered and then refused.
- **Sends:** a self-send is caught for a BitMail name, not only for your own
  `sp1…`, and on the web as well as the phone.
- **An address from the wrong chain is refused**, rather than being paid. A
  mainnet `sp1…` on a Signet wallet used to reach the broadcast confirmation
  and could be saved as a contact: the two addresses differ only in their
  prefix, so the transaction built, signed and confirmed while the recipient —
  watching the other chain — never saw it. Nothing bounced. This is now
  refused on both apps as the address is typed, and by the server whatever the
  app allows, for Silent Payments and on-chain addresses alike.
- **Transaction list:** a Tango reads as a Tango rather than as a tiny payment
  to nobody, and shows what it mixed instead of what it cost.
- **Updates:** the app reports its real version and can check for, download and
  install a newer one.

### Before you install

**This will not update an existing WhiSPa.** The Android applicationId changed
from `com.thrilla_btc.thrilla` to `com.whispawallet.app` after v0.1.4, so
Android treats this as a different app and installs it alongside the old one.
Move your funds or restore from your recovery phrase, then remove the old
install.

The Signet build installs alongside the mainnet one, as before.

## v0.1.4

The first published release. No changelog was kept for it or for the versions
before it; `git log` is the record.
