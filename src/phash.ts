export function aHash64(img: ImageData): string | null {
  const w = img.width;
  const h = img.height;
  if (w <= 0 || h <= 0) return null;

  // Sample an 8x8 grid across the image
  const grid = 8;
  const vals: number[] = [];
  vals.length = grid * grid;

  const data = img.data;

  let sum = 0;
  let sumSq = 0;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      // sample near center of the cell
      const x = Math.min(w - 1, Math.floor((gx + 0.5) * w / grid));
      const y = Math.min(h - 1, Math.floor((gy + 0.5) * h / grid));
      const i = (y * w + x) * 4;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // luminance
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      vals[gy * grid + gx] = lum;

      sum += lum;
      sumSq += lum * lum;
    }
  }

  const n = vals.length;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const stdev = Math.sqrt(variance);

  // Very low contrast = usually empty slot background
  if (stdev < 3.0) return null;

  // Average-hash bits
  let bits = "";
  for (let i = 0; i < n; i++) bits += vals[i] >= mean ? "1" : "0";

  // Convert 64 bits -> 16 hex chars
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    const nibble = bits.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }

  return hex;
}