// Let the check runners import the app's own .ts modules, the way the app does.
//
// Three things Metro and Vite do that Node's ESM loader does not:
//
//   * resolve './btcAddress' to './btcAddress.ts'
//   * resolve the tsconfig path aliases — '@/x', '@services/x', '@stores/x'
//   * resolve 'react-native-config', which has no Node build at all
//
// Writing './btcAddress.ts' in the source, or dropping the aliases, to suit a
// test script would be the tail wagging the dog. The last one is a stub: it
// stands in for the native module that hands the app its build-time env, and a
// runner that needs a real value must pass it in rather than read Config.
//
// Keep this honest — a shim that diverges from what the bundlers do turns a
// passing runner into a lie. It maps, it does not implement.

const ROOT = new URL('../', import.meta.url);

const ALIASES = [
  ['@services/', 'src/services/'],
  ['@stores/', 'src/stores/'],
  ['@/', 'src/'],
];

const STUBS = {
  'react-native-config': new URL('./stubs/react-native-config.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return next(STUBS[specifier], context);

  for (const [prefix, target] of ALIASES) {
    if (specifier.startsWith(prefix)) {
      const url = new URL(target + specifier.slice(prefix.length), ROOT).href;
      try {
        return await next(url + '.ts', context);
      } catch {
        return next(url, context);
      }
    }
  }

  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      // Fall through: not a .ts file, so let Node report what it actually is.
    }
  }
  return next(specifier, context);
}
