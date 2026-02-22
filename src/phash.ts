import * as a1lib from "@alt1/base";

/**
 * Simple average-hash (aHash) over the icon region.
 * Produces a 64-bit hash string (hex) stable enough for “same icon” identity.
 */
export function aHash64(img: a1lib.ImgRef): string {
  const w = 8, h = 8;

  // downsample by nearest-neighbor
  const d = img.getData();
  if (!d) return "0".repeat(16);
  const src = d.data;
  const sw = d.width, sh = d.height;

  const samples: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x + 0.5) * sw / w);
      const sy = Math.floor((y + 0.5) * sh / h);
      const idx = (sy * sw + sx) * 4;
      const r = src[idx], g = src[idx + 1], b = src[idx + 2];
      const lum = (r * 3 + g * 4 + b) / 8; // fast-ish luma
      samples.push(lum);
    }
  }

  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

  let bits = "";
  for (const v of samples) bits += v >= avg ? "1" : "0";

  // Convert 64 bits to hex
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    const nibble = bits.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  return hex;
}
