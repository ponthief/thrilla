import { ref } from 'vue'

// Shared flag: true when a BitMail tamper mismatch has been detected (a user's
// approved BitMail resolves over DNS to an SP address that doesn't match their
// pinned/intended wallet address). Surfaced as a drastic indicator on the
// BitMail nav item so the user sees it from ANY screen — not only after opening
// BitMail. Holds the list of affected addresses for messaging.
export const bitmailTampered = ref(false)
export const bitmailTamperList = ref([])   // [{ bitmail, expected, resolved }]

export function setBitmailTamper(alerts) {
  bitmailTamperList.value = alerts || []
  bitmailTampered.value = (alerts || []).length > 0
}

export function clearBitmailTamper() {
  bitmailTamperList.value = []
  bitmailTampered.value = false
}
