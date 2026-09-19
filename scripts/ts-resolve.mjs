// Let the cross-check runners import the app's .ts modules the way the app
// does — `from './btcAddress'`, no extension.
//
// Metro and Vite both resolve that; Node's ESM loader does not, and writing
// './btcAddress.ts' in the source to suit a test script would be the tail
// wagging the dog. This hook adds the extension when a relative specifier has
// none, and otherwise stays out of the way.

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      // Fall through: not a .ts file, so let Node report what it actually is.
    }
  }
  return next(specifier, context);
}
