// Client-side CSV export.
//
// Security note: this builds the CSV purely from data already loaded in the
// browser (the display arrays for Activity / UTXOs). Those arrays contain only
// financial/display fields — NEVER private key material (priv_key_tweak, scan
// secret, spend key). The export takes an explicit column list, so nothing is
// serialized unless a caller names it. Do not add key fields to any column map.

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // Quote if it contains comma, quote, newline, or a leading char Excel treats
  // as a formula (=, +, -, @) — the latter guards against CSV injection.
  const needsQuote = /[",\n\r]/.test(s)
  const isFormula = /^[=+\-@]/.test(s)
  let out = s
  if (isFormula) out = "'" + out          // neutralize formula auto-execution
  if (needsQuote || isFormula) out = '"' + out.replace(/"/g, '""') + '"'
  return out
}

// columns: [{ key, header, map? }] — map(row) optional transform.
// rows: array of plain objects.
export function buildCsv(columns, rows) {
  const header = columns.map(c => csvEscape(c.header ?? c.key)).join(',')
  const lines = rows.map(row =>
    columns.map(c => csvEscape(c.map ? c.map(row) : row[c.key])).join(',')
  )
  return [header, ...lines].join('\r\n')
}

export function downloadCsv(filename, csvText) {
  // Prepend a UTF-8 BOM so Excel opens accented labels correctly.
  const blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function useCsvExport() {
  return { buildCsv, downloadCsv }
}
