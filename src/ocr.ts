import * as OCR from "@alt1/ocr";

function cleanDigits(s: string): string {
  return s.replace(/[^\d]/g, "");
}

function readLineText(img: any): string | null {
  try {
    // readLine(img, x, y, w, h, font, [optional 7th arg])
    // debugFont exists in @alt1/ocr and is safe to pass as the font.
    const res = (OCR as any).readLine(img, 0, 0, img.width, img.height, (OCR as any).debugFont, null);
    return res?.text ? String(res.text) : null;
  } catch {
    return null;
  }
}

export function readStackNumber(img: any): number | null {
  const text = readLineText(img);
  if (!text) return null;

  const cleaned = cleanDigits(text);
  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readMoneyGain(img: any): number | null {
  const text = readLineText(img);
  if (!text) return null;

  if (!text.includes("+")) return null;

  const cleaned = cleanDigits(text);
  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}