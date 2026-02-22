// src/alt1region.ts
export type Rect = { x: number; y: number; w: number; h: number };

type Point = { x: number; y: number };

// One pending point per region "channel"
const pending: Record<string, Point | null> = {
  inventory: null,
  money: null
};

function getMouseInRsClient(): Point | null {
  const alt1: any = (window as any).alt1;
  if (!alt1) return null;

  // Requires Gamestate permission (see alt1.helpFull output).
  const packed = alt1.mousePosition;
  if (typeof packed !== "number") return null;

  const x = (packed >> 16) & 0xffff;
  const y = packed & 0xffff;

  // Some builds return 0 when not available
  if (x === 0 && y === 0) return null;

  return { x, y };
}

/**
 * Two-click calibration using current mouse position inside RS.
 * Call twice:
 *  1) hover top-left, click
 *  2) hover bottom-right, click
 */
export async function getRegionFromAlt1(channel: "inventory" | "money"): Promise<Rect | null> {
  const p = getMouseInRsClient();
  if (!p) {
    alert(
      "Can't read RS mouse position.\n\n" +
      "In Alt1 Settings > Apps > your Loot Tracker app:\n" +
      "Enable Gamestate permission.\n" +
      "Then try again with your mouse inside the RS game window."
    );
    return null;
  }

  if (!pending[channel]) {
    pending[channel] = p;
    alert(
      `Saved ${channel} TOP-LEFT.\n\nNow move your mouse to the BOTTOM-RIGHT corner of the ${channel} area and click the same calibrate button again.`
    );
    return null;
  }

  const p1 = pending[channel]!;
  pending[channel] = null;

  const x1 = Math.min(p1.x, p.x);
  const y1 = Math.min(p1.y, p.y);
  const x2 = Math.max(p1.x, p.x);
  const y2 = Math.max(p1.y, p.y);

  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);

  return { x: x1, y: y1, w, h };
}