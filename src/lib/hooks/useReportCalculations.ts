/**
 * Report Calculation Utilities
 * Formatting and calculation helpers for production reports
 */

/**
 * Format a number with thousand separators and optional decimal places
 */
export function formatNumber(value: number | undefined, decimals: number = 0): string {
    if (value === undefined || value === null) return '—'
    return value.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
    })
}

/**
 * Format a delta (difference) value, showing if positive, negative, or zero
 * Returns string with appropriate color indicator prefix
 */
export function formatDelta(value: number | undefined): { text: string; isNegative: boolean } {
    if (value === undefined || value === null) {
          return { text: '—', isNegative: false }
    }

  const text = value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        signDisplay: 'always',
  })

  return {
        text,
        isShortage: value < 0, // Negative delta means shortage
  }
}

/**
 * Calculate total material requirement across all line items
 */
export function calculateTotalMaterial(items: any[]): number {
    return items.reduce((sum, item) => {
          const mat1 = item.mat1_requirement || 0
          const mat2 = item.mat2_requirement || 0
          return sum + mat1 + mat2
    }, 0)
}

/**
 * Calculate total packaging requirements
 */
export function calculateTotalPackaging(items: any[]): {
    unit: number
    srp: number
} {
    return items.reduce(
          (acc, item) => ({
                  unit: acc.unit + (item.unit_packaging_required || 0),
                  srp: acc.srp + (item.srp_packaging_required || 0),
          }),
      { unit: 0, srp: 0 }
        )
}

/**
 * Find critical shortages (negative deltas)
 */
export function findCriticalShortages(items: any[]): string[] {
    return items
      .filter((item) => {
              const mat1Delta = item.mat1_delta || 0
              const mat2Delta = item.mat2_delta || 0
              const unitDelta = item.unit_packaging_delta || 0
              const srpDelta = item.srp_packaging_delta || 0

                    return mat1Delta < 0 || mat2Delta < 0 || unitDelta < 0 || srpDelta < 0
      })
      .map((item) => item.sku)
}

/**
 * Calculate the percentage of completion
 */
export function calculateCompletionPercentage(items: any[]): number {
    if (!items.length) return 0

  const itemsWithoutShortages = items.filter((item) => {
        const mat1Delta = item.mat1_delta || 0
        const mat2Delta = item.mat2_delta || 0
        const unitDelta = item.unit_packaging_delta || 0
        const srpDelta = item.srp_packaging_delta || 0

                                                 return mat1Delta >= 0 && mat2Delta >= 0 && unitDelta >= 0 && srpDelta >= 0
  })

  return Math.round((itemsWithoutShortages.length / items.length) * 100)
}
