import { jsPDF } from 'jspdf'

/**
 * Strips characters that are invisible on screen but break a generated PDF.
 *
 * Names and addresses are routinely pasted in from Outlook, Word and websites, and that paste
 * often carries a zero-width space, a byte-order mark or a word joiner along with it. The field
 * looks completely normal in the ERP, but jsPDF's built-in fonts only cover Latin-1: one
 * character above U+00FF makes it switch that whole string to UTF-16, which the standard font
 * cannot draw. The result is a stray tick before the text and a width measurement roughly twice
 * what it should be, so it no longer fits its box.
 *
 * That is what happened to a sample packing list: "Radhika Mishra" carried a leading U+2060 word
 * joiner and printed as "`Radhika Mishra", overflowing the Reference cell.
 *
 * Also folds the smart quotes and dashes Word substitutes, since those are outside Latin-1 too.
 */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁪-⁯﻿]/g

export function sanitizePdfText(value: string): string {
  return value
    .replace(INVISIBLE, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/ /g, ' ')
}

/**
 * Applied to jsPDF's shared API so every document in the ERP is covered from one place —
 * packing lists, BOLs, labels, invoices, quotes and the Walmart/Chewy reports. Modules that
 * build a PDF import this file for the side effect; importing it more than once is harmless.
 */
type TextArg = string | string[]
if (!(jsPDF as unknown as { __bgTextSanitised?: boolean }).__bgTextSanitised) {
  const proto = (jsPDF as unknown as { API: Record<string, unknown> }).API
  const original = proto.text as (...args: unknown[]) => unknown
  proto.text = function patchedText(this: unknown, ...args: unknown[]) {
    const first = args[0] as TextArg
    if (typeof first === 'string') args[0] = sanitizePdfText(first)
    else if (Array.isArray(first)) args[0] = first.map(t => (typeof t === 'string' ? sanitizePdfText(t) : t))
    return original.apply(this, args)
  }
  ;(jsPDF as unknown as { __bgTextSanitised?: boolean }).__bgTextSanitised = true
}
