import * as OCR from "@alt1/ocr";
import * as a1lib from "@alt1/base";

function cleanDigits(s: string): string {
  return s.replace(/[^\d]/g, "");
}

function parseQty(text: string): number | null {
  const cleaned = cleanDigits(text);
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  // cap to something sane
  if (n > 2_147_000_000) return null;
  return n;
}

/**
 * Reads a stack number in an inventory slot (top-left).
 * Returns null if unreadable; caller can “wait for a later readable frame”.
 */
export function readStackNumber(img: a1lib.ImgRef): number | null {
  try {
    const r = OCR.read(img, { whitelist: "0123456789," });
    if (!r || !r.text) return null;
    // OCR sometimes returns " " or junk; parse digits
    return parseQty(r.text);
  } catch {
    return null;
  }
}

/**
 * Reads money gain like "+900" in a small region.
 * Returns the numeric gain (900) or null.
 */
export function readMoneyGain(img: a1lib.ImgRef): number | null {
  try {
    const r = OCR.read(img, { whitelist: "+0123456789," });
    if (!r || !r.text) return null;

    const t = r.text.trim();
    // Must include a plus sign somewhere; we only count gains
    if (!t.includes("+")) return null;

    const qty = parseQty(t);
    return qty;
  } catch {
    return null;
  }
}
