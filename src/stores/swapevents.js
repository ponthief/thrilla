import { ref } from 'vue'

// A tiny shared signal that bumps whenever a swap completes. Views that show
// balances affected by swaps (e.g. LightningView) can `watch` this and refresh.
// Cleaner than a window global; reactive so watchers fire automatically.
export const swapCompletedAt = ref(0)

// Called by the global swap poller when a funded→completed transition is seen.
export function notifySwapCompleted() {
  swapCompletedAt.value = Date.now()
}
