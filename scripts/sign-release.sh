#!/usr/bin/env bash
#
# sign-release.sh — checksum and GPG-sign the release APKs.
#
# Produces the two files users need to verify a download:
#
#   SHA256SUMS      one line per APK, sha256sum(1) format
#   SHA256SUMS.asc  a detached, armoured GPG signature over SHA256SUMS
#
# Signing the checksum file rather than each APK is deliberate: one signature
# covers every artifact, and it's the layout Bitcoin Core and Tor use, so the
# verification steps on thrilla.me are the ones people may already know.
#
# It also prints the APK signing certificate fingerprint. That is a DIFFERENT
# and complementary check: Android enforces it on every update (an APK signed
# by another key cannot replace an installed Thrilla), so it protects users who
# never verify anything by hand — which is most of them. GPG protects the
# download itself, before it is ever installed.
#
# Usage:
#   scripts/sign-release.sh                       # sign the repo-root APKs
#   scripts/sign-release.sh path/to/*.apk         # sign specific files
#   THRILLA_GPG_KEY=ABCD1234 scripts/sign-release.sh
#
# Env:
#   THRILLA_GPG_KEY   key id / fingerprint / email to sign with. Optional;
#                     without it gpg picks its default signing key.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gpg_key="${THRILLA_GPG_KEY:-}"

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

command -v gpg >/dev/null 2>&1 || die "gpg not found. Install GnuPG first (apt install gnupg / brew install gnupg)."

# sha256sum on Linux, shasum -a 256 on macOS. Both emit "<hash>  <name>", which
# is what `sha256sum -c` expects on the verifying end.
if command -v sha256sum >/dev/null 2>&1; then
  sha_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  sha_cmd=(shasum -a 256)
else
  die "neither sha256sum nor shasum found."
fi

# Default to the two APKs committed at the repo root.
if [ "$#" -gt 0 ]; then
  apks=("$@")
else
  apks=("$repo_root/thrilla.apk" "$repo_root/thrilla-signet.apk")
fi

for apk in "${apks[@]}"; do
  [ -f "$apk" ] || die "APK not found: $apk"
done

# Write the sums beside the APKs, using bare filenames so `sha256sum -c` works
# from whatever directory the user downloaded into.
out_dir="$(cd "$(dirname "${apks[0]}")" && pwd)"
sums="$out_dir/SHA256SUMS"
sig="$sums.asc"

echo "Checksumming ${#apks[@]} file(s)…"
: > "$sums"
for apk in "${apks[@]}"; do
  ( cd "$(dirname "$apk")" && "${sha_cmd[@]}" "$(basename "$apk")" ) >> "$sums"
done
note "wrote $sums"
while read -r line; do note "$line"; done < "$sums"

echo
echo "Signing…"
# Remove a stale signature first: gpg would prompt to overwrite, which wedges a
# non-interactive run, and a leftover .asc from a previous build verifying
# against new sums is exactly the failure this script exists to prevent.
rm -f "$sig"
if [ -n "$gpg_key" ]; then
  gpg --local-user "$gpg_key" --armor --detach-sign --output "$sig" "$sums"
else
  gpg --armor --detach-sign --output "$sig" "$sums"
fi
note "wrote $sig"

# Verify what we just produced. A signature that doesn't check out here would
# otherwise ship and fail in users' hands, which reads as a compromised build.
echo
echo "Verifying the signature we just made…"
gpg --verify "$sig" "$sums" 2>&1 | sed 's/^/  /'

echo
echo "Signing key fingerprint (publish this, and say it somewhere other than the download page):"
if [ -n "$gpg_key" ]; then
  gpg --fingerprint "$gpg_key" | sed 's/^/  /'
else
  gpg --fingerprint --list-secret-keys | sed 's/^/  /'
fi

# The Android side. Not a GPG matter, but it belongs in the same release notes:
# this fingerprint is what Android itself checks on every update.
echo
if command -v apksigner >/dev/null 2>&1; then
  echo "APK signing certificate (Android enforces this on update):"
  for apk in "${apks[@]}"; do
    note "$(basename "$apk")"
    apksigner verify --print-certs "$apk" 2>/dev/null \
      | grep -i 'SHA-256 digest' | sed 's/^/    /' || note "    (could not read certificate)"
  done
else
  echo "apksigner not on PATH — skipping the APK certificate fingerprint."
  note "It ships with the Android SDK build-tools:"
  note "  \$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs <apk>"
fi

echo
echo "Next: publish SHA256SUMS and SHA256SUMS.asc alongside the APKs,"
echo "and make sure the fingerprint above matches the one on thrilla.me/verify.html."
