import type { OhlcCandle } from '@fipulse/fipulse-sdk'

/**
 * Typical crypto / USD spot style: grouping for large prices, more decimals as price gets smaller.
 */
export function formatCryptoAxisPrice(price: number): string {
  if (!Number.isFinite(price)) return ''
  if (price === 0) return '0'

  const x = Math.abs(price)

  if (x >= 1_000_000) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(price)
  }
  if (x >= 1_000) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(price)
  }
  if (x >= 1) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
      useGrouping: false,
    }).format(price)
  }
  if (x >= 0.01) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
      useGrouping: false,
    }).format(price)
  }
  if (x >= 0.0001) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
      useGrouping: false,
    }).format(price)
  }

  const p = x.toPrecision(8)
  if (p.includes('e') || p.includes('E')) {
    return (price < 0 ? '-' : '') + p
  }
  return (price < 0 ? '-' : '') + String(Number(p))
}

export function mergeCandles(a: OhlcCandle[], b: OhlcCandle[]): OhlcCandle[] {
  const map = new Map<number, OhlcCandle>()
  for (const c of [...a, ...b]) {
    map.set(c.bucketStartTs, c)
  }
  return [...map.values()].sort((x, y) => x.bucketStartTs - y.bucketStartTs)
}

