/**
 * The form items are matched by: Unicode NFC (so Korean typed as separate
 * jamo matches the same syllables), trimmed, with single spaces.
 */
export function toNormalForm(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}
