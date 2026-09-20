// The app's version, as the app itself reports it.
//
// It used to be written out three times — package.json, the Android
// versionName, and a literal in the About page — and the three agreeing with
// each other was mistaken for them being right. They read "0.2.0" while the
// release stream was on v0.1.4, so the About page confidently named a version
// nobody could download.
//
// Now there are two: the "version" field in package.json, which is canonical,
// and the literal below, which the bundle needs. android/app/build.gradle
// reads BOTH and refuses to build if they differ — so bumping one and
// forgetting the other is a failed build, not a wrong number on a phone. It
// also derives versionCode from it, so that is no longer a third thing to
// remember.
//
// To release: edit package.json and the line below, to the same x.y.z.
//
// WHY THIS JUMPS 0.1.4 -> 0.2.1. The APK published as v0.1.4 reports 0.2.0,
// because that is what was in the tree when it was built. An update check only
// offers a release that is NEWER than what is installed, so a 0.1.5 would be
// invisible to every phone already running it — the check would answer "up to
// date, you have 0.2.0" forever. 0.2.0 itself is taken, for the same reason.
// Going forward past it is what makes the check work for the people who
// already have the wrong number.

export const APP_VERSION = '0.2.1';

/** The git tag and GitHub release that carry this version. */
export const RELEASE_TAG = `v${APP_VERSION}`;

/**
 * Compare two x.y.z versions: negative if `a` is older, 0 if equal.
 *
 * Numeric per component, so 0.1.10 is newer than 0.1.9 — which a string
 * comparison gets backwards, and which this project will reach.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.replace(/^v/, '').split(/[.\-+]/).map((n) => parseInt(n, 10));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
