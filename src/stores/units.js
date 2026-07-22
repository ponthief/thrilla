import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getUsdRate } from '@/api'

// Shared display-unit state: 'sats' or 'usd'. One global setting applied
// everywhere, persisted in localStorage so it survives reloads.
export const useUnitsStore = defineStore('units', () => {
  const unit = ref(localStorage.getItem('thrilla_unit') || 'sats')   // 'sats' | 'usd'
  const usdPerBtc = ref(Number(localStorage.getItem('thrilla_usd_rate')) || 0)
  const rateLoadedAt = ref(0)
  const rateLoading = ref(false)

  function setUnit(u) {
    unit.value = (u === 'usd') ? 'usd' : 'sats'
    localStorage.setItem('thrilla_unit', unit.value)
  }
  function toggleUnit() {
    setUnit(unit.value === 'sats' ? 'usd' : 'sats')
  }

  // Fetch the USD/BTC rate from LNbits. Cheap and cacheable; refresh every few min.
  async function refreshRate(inkey, force = false) {
    const FRESH_MS = 3 * 60 * 1000
    if (!force && usdPerBtc.value && (Date.now() - rateLoadedAt.value) < FRESH_MS) return
    rateLoading.value = true
    try {
      const res = await getUsdRate(inkey)      // { rate: 43250.50 } (USD per BTC)
      const r = Number(res?.rate)
      if (r > 0) {
        usdPerBtc.value = r
        rateLoadedAt.value = Date.now()
        localStorage.setItem('thrilla_usd_rate', String(r))
      }
    } catch (e) {
      // keep last known rate; if none, USD display will fall back to sats
    } finally {
      rateLoading.value = false
    }
  }

  const haveRate = computed(() => usdPerBtc.value > 0)

  // Convert sats → USD number (not string). 1 BTC = 100,000,000 sats.
  function satsToUsd(sats) {
    if (!haveRate.value) return null
    return (Number(sats) / 1e8) * usdPerBtc.value
  }

  return { unit, usdPerBtc, haveRate, rateLoading, setUnit, toggleUnit, refreshRate, satsToUsd }
})
