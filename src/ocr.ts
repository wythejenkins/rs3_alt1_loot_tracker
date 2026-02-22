// MVP OCR: keep tracker functional even if OCR isn't ready yet.
// Returning null means "unknown quantity".

export function readStackNumber(_img: ImageData): number | null {
  return null;
}

// Money gain OCR (yellow "+900") comes later.
// For now, return null so it doesn't break anything.
export function readMoneyGain(_img: ImageData): number | null {
  return null;
}