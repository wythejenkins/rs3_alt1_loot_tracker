export function aHash64(img: ImageData): string {
  const data = img.data;
  let hash = 0;

  for (let i = 0; i < data.length; i += 64) {
    hash = (hash * 31 + data[i]) >>> 0;
  }

  return hash.toString(16);
}