// Stands in for react-native-config, which is a native module with no Node
// build. In the app it hands back the build-time env (Config.NETWORK_LOCK and
// the rest); here it hands back nothing, on purpose.
//
// A runner that depends on one of those values must pass it in explicitly
// rather than read it from Config, so that what the runner proves is not
// contingent on a stub agreeing with a .env file it cannot see.
export default {};
