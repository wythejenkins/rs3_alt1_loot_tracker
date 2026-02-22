export function isLikelyItemIcon(img: ImageData): boolean {
  const w = img.width, h = img.height;
  if (w < 6 || h < 6) return false;

  // Sample a 10x10 grid in the CENTER (ignores transparent bg bleed)
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
      const sat = max - min; // cheap saturation proxy

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

  // Empty slot backgrounds tend to be low contrast AND low saturation.
  // Items tend to have either decent contrast or decent saturation.
  return (stdevLum >= 8.0) || (meanSat >= 10.0);
}

export function aHash64Center(img: ImageData): string {
  const w = img.width, h = img.height;

  const grid = 8;
  const x0 = Math.floor(w * 0.20), x1 = Math.floor(w * 0.80);
  const y0 = Math.floor(h * 0.20), y1 = Math.floor(h * 0.80);
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);

  const data = img.data;

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
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hex;
}