// WCAG 2.1 contrast ratio math — relative luminance formula (spec: w3.org/TR/WCAG21/#dfn-relative-luminance)

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const num = parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

export function contrastRatio(hex1: string, hex2: string): number | null {
  const rgb1 = hexToRgb(hex1)
  const rgb2 = hexToRgb(hex2)
  if (!rgb1 || !rgb2) return null
  const l1 = relativeLuminance(rgb1)
  const l2 = relativeLuminance(rgb2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface WcagResult {
  ratio: number
  aaNormal: boolean   // WCAG AA, normal text — needs >= 4.5:1
  aaLarge: boolean    // WCAG AA, large text (18px+/14px+bold) — needs >= 3:1
  aaaNormal: boolean  // WCAG AAA, normal text — needs >= 7:1
}

export function evaluateContrast(hex1: string, hex2: string): WcagResult | null {
  const ratio = contrastRatio(hex1, hex2)
  if (ratio === null) return null
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
  }
}
