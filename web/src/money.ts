const dollarFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatCents(cents: number): string {
  return dollarFormat.format(cents / 100)
}

// Turns what the user typed ("12", "12.5", "12.50") into whole cents.
// The text is split at the dot, so no floating point maths ever touches the amount.
// Returns null when the text is not a positive amount with at most 2 decimals.
export function parseDollarsToCents(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null

  const dollars = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  const totalCents = dollars * 100 + cents
  return Number.isSafeInteger(totalCents) && totalCents > 0 ? totalCents : null
}
