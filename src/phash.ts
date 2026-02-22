export function isLikelyItemIcon(img: ImageData): boolean {
  const w = img.width, h = img.height;
  if (w < 6 || h < 6) return false;

  const grid = 10;
  const x0 = Math.floor(w * 0.20), x1 = Math.floor(w * 0.80);
  const y0 = Math.floor(h * 0.20), y1 = Math.floor(h * 0.80);
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);

  const data = img.data;

  let sumLum = 0;
  let sumLumSq = 0;
  let sumSat = 0;
  const n = grid * grid;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = Math.min(w - 1, x0 + Math.floor((gx + 0.5) * sw / grid));
      const y = Math.min(h - 1, y0 + Math.floor((gy + 0.5) * sh / grid));
      const i = (y * w + x) * 4;

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;

      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      sumLum += lum;
      sumLumSq += lum * lum;
      sumSat += sat;
    }
  }

  const meanLum = sumLum / n;
  const varLum = Math.max(0, sumLumSq / n - meanLum * meanLum);
  const stdevLum = Math.sqrt(varLum);
  const meanSat = sumSat / n;

  return (stdevLum >= 8.0) || (meanSat >= 10.0);
}

/**
 * Tooltip hover overlays tend to introduce:
 *  - lots of very dark pixels (tooltip background)
 *  - and lots of very bright pixels (text)
 * in the same crop.
 */
export function isLikelyHoverOverlay(img: ImageData): boolean {
  const data = img.data;
  const npx = img.width * img.height;
  if (npx < 50) return false;

  let dark = 0;
  let bright = 0;

  // sample every ~3rd pixel for speed
  const step = 12; // 3px * 4 channels
  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;

    if (lum < 28) dark++;
    else if (lum > 225) bright++;
  }

  const samples = Math.ceil(data.length / step);
  const darkRatio = dark / samples;
  const brightRatio = bright / samples;

  // Tuned to be conservative: only flag obvious overlays
  return darkRatio > 0.22 && brightRatio > 0.03;
}

export function aHash64IgnoreTopLeft(img: ImageData): string {
  const w = img.width, h = img.height;
  const data = img.data;

  const grid = 8;

  const x0 = Math.floor(w * 0.35), x1 = Math.floor(w * 0.95);
  const y0 = Math.floor(h * 0.35), y1 = Math.floor(h * 0.95);
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);

  const vals: number[] = new Array(grid * grid);
  let sum = 0;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = Math.min(w - 1, x0 + Math.floor((gx + 0.5) * sw / grid));
      const y = Math.min(h - 1, y0 + Math.floor((gy + 0.5) * sh / grid));
      const i = (y * w + x) * 4;

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      vals[gy * grid + gx] = lum;
      sum += lum;
    }
  }

  const mean = sum / vals.length;

  let bits = "";
  for (let i = 0; i < vals.length; i++) bits += vals[i] >= mean ? "1" : "0";

  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

const POPCOUNT_4BIT: number[] = [
  0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4
];

export function hamming64hex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 9999;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const da = parseInt(a[i], 16);
    const db = parseInt(b[i], 16);
    dist += POPCOUNT_4BIT[(da ^ db) & 0xf];
  }
  return dist;
}