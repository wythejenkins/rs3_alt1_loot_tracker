import { Rect } from "./storage";

/**
 * Reads the last Alt1 “captured region”.
 *
 * In most Alt1 apps: user uses Alt1’s capture tool and presses Alt+1,
 * then the app can read that region.
 *
 * If this doesn’t work in your environment, this is the only file you should need to adapt.
 */
export async function getRegionFromAlt1(): Promise<Rect | null> {
  const alt1Any = (window as any).alt1;
  if (!alt1Any) return null;

  // Common patterns seen in Alt1 apps:
  // - alt1.getRegion() returns {x,y,w,h}
  // - alt1.getRegion() returns null if nothing captured
  if (typeof alt1Any.getRegion === "function") {
    const r = alt1Any.getRegion();
    if (r && typeof r.x === "number") {
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    }
  }

  // Some builds store region differently; try a couple fallbacks.
  if (alt1Any.lastRegion && typeof alt1Any.lastRegion.x === "number") {
    const r = alt1Any.lastRegion;
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  return null;
}
