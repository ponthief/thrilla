/**
 * scanwatch.js — lightweight signal that a scan has been STARTED for a wallet,
 * so the global completion-watcher (App.vue) only polls /scan/progress while a
 * scan is actually in flight, instead of polling continuously.
 *
 * ScanView calls notifyScanStarted(walletId) when it kicks off a scan. The
 * global watcher polls while there are pending wallet ids and removes each as it
 * observes completion, stopping itself when the set is empty.
 */
import { ref } from 'vue'

// Wallet ids that have a scan we expect to be running (or just-started).
export const scanWatchWallets = ref(new Set())
// Bumped whenever a scan is started, so the watcher can (re)start promptly.
export const scanStartedAt = ref(0)

export function notifyScanStarted(walletId) {
  if (!walletId) return
  const s = new Set(scanWatchWallets.value)
  s.add(walletId)
  scanWatchWallets.value = s
  scanStartedAt.value = Date.now()
}

export function clearScanWatch(walletId) {
  if (!scanWatchWallets.value.has(walletId)) return
  const s = new Set(scanWatchWallets.value)
  s.delete(walletId)
  scanWatchWallets.value = s
}
