// `npm run lint` had no config at all — it exited "ESLint couldn't find a
// configuration file" and had presumably done so for a long time, which is how
// a missing hook dependency reached a release. It shipped the Tango connection
// request with the wrong network: `network` was read inside a useCallback and
// left out of its deps, so the closure kept the useState default for the life
// of the screen and the mainnet app asked the server about signet.
//
// Deliberately narrow. This is not a style pass over an app that has never had
// one — that would bury the two rules below in hundreds of findings nobody
// would read. It lints the one class of defect that typechecking cannot see
// and review reliably misses: a hook whose closure goes stale.
//
// The whole tree passes it today, so `npm run lint` is a real gate rather than
// a wall of pre-existing noise. Add rules when you are willing to fix what
// they find.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/exhaustive-deps': 'error',
    'react-hooks/rules-of-hooks': 'error',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'android/', 'ios/', 'coverage/'],
};
