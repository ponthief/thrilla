import { useUnitsStore } from '@/stores/units'

// Composable: format a sats value according to the global unit setting.
// Usage in a component:
//   import { useAmount } from '@/composables/useAmount'
//   const { fmt } = useAmount()
//   ... {{ fmt(balanceSats) }}            → "12,345 sats" or "$5.34"
//   ... {{ fmt(sats, { signed: true }) }} → "+12,345 sats" / "−$5.34"
export function useAmount() {
  const units = useUnitsStore()

  function fmt(sats, opts = {}) {
    const { signed = false, unitLabel = true } = opts
    if (sats === null || sats === undefined || sats === '') return '—'
    const n = Number(sats)
    const sign = signed ? (n < 0 ? '−' : n > 0 ? '+' : '') : ''
    const abs = Math.abs(n)

    if (units.unit === 'usd') {
      const usd = units.satsToUsd(abs)
      if (usd === null) {
        // No rate available → gracefully fall back to sats so nothing shows blank.
        return `${sign}${abs.toLocaleString()}${unitLabel ? ' sats' : ''}`
      }
      // 2 decimals for USD; show <$0.01 for tiny dust amounts.
      const str = usd < 0.01 && usd > 0
        ? '<$0.01'
        : '$' + usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return `${sign}${str}`
    }
    // sats
    return `${sign}${abs.toLocaleString()}${unitLabel ? ' sats' : ''}`
  }

  return { fmt, units }
}
