/**
 * Barcode plausibility for product scans (website + app scanners). A barcode
 * only partly in the frame can decode to a wrong number; the GTIN check digit
 * plus "same code read N times" filters those reads out.
 */

/** GTIN check digit (EAN-13, EAN-8, UPC-A). UPC-E's digit sits on the expanded form → length only. */
export function isValidGtin(code: string, format?: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (format && /upc_?e/i.test(format)) return code.length === 6 || code.length === 8;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/** Accept a code once it was read `times` times (valid GTINs only). */
export function createConfirmer(times = 3) {
  const seen = new Map<string, number>();
  return (code: string, format?: string): string | null => {
    if (!isValidGtin(code, format)) return null;
    const n = (seen.get(code) ?? 0) + 1;
    seen.set(code, n);
    if (n >= times) {
      seen.delete(code); // continuous mode: count again for the next pass
      return code;
    }
    return null;
  };
}
