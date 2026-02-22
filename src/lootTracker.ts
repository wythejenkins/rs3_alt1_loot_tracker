import * as a1lib from "@alt1/base";
import { readStackNumber, readMoneyGain } from "./ocr";
import { aHash64 } from "./phash";
import { AppState, LootEntry, Rect, Session } from "./storage";
import { getRegionFromAlt1 } from "./alt1region";

type RunState = "idle" | "running" | "paused";

type SlotSnap = {
  sig: string | null;          // icon signature
  qty: number | null;          // last CONFIRMED qty
  pendingQty: number | null;   // last seen qty awaiting confirmation
  pendingCount: number;        // confirmation counter
};

export class LootTracker {
  private state: AppState;
  private runState: RunState = "idle";
  private invRegion: Rect | null;
  private moneyRegion: Rect | null;

  private slots: SlotSnap[] = Array.from({ length: 28 }, () => ({
    sig: null,
    qty: null,
    pendingQty: null,
    pendingCount: 0
  }));

  private loot: Record<string, LootEntry> = {};
  private iconCachePng: Record<string, string> = {}; // sig -> dataURL (captured icon)
  private lastMoneySeen: string | null = null;
  private moneyCooldownUntil = 0;

  private timer: number | null = null;
  private updateCb: (() => void) | null = null;

  constructor(state: AppState) {
    this.state = state;
    this.invRegion = state.settings.invRegion ?? null;
    this.moneyRegion = state.settings.moneyRegion ?? null;
  }

  onUpdate(cb: () => void) { this.updateCb = cb; }

  hasInventoryRegion() { return !!this.invRegion; }
  hasMoneyRegion() { return !!this.moneyRegion; }
  getRunState(): RunState { return this.runState; }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a, b) => b.qty - a.qty);
  }

  getIconPngDataUrl(sig: string): string | null {
    return this.iconCachePng[sig] ?? null;
  }

  async calibrateInventoryRegion(): Promise<boolean> {
    const r = await getRegionFromAlt1();
    if (!r) return false;
    this.invRegion = r;
    this.state.settings.invRegion = r;
    return true;
  }

  async calibrateMoneyRegion(): Promise<boolean> {
    const r = await getRegionFromAlt1();
    if (!r) return false;
    this.moneyRegion = r;
    this.state.settings.moneyRegion = r;
    return true;
  }

  start(label: string) {
    if (!this.invRegion) {
      alert("Calibrate inventory region first.");
      return;
    }
    this.runState = "running";
    this.loot = {};
    this.lastMoneySeen = null;
    this.moneyCooldownUntil = 0;

    // Baseline snapshot (your “brought items” become baseline)
    this.captureAndUpdate(true);

    // start loop
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.runState !== "running") return;
      this.captureAndUpdate(false);
    }, 600);

    // create active session
    this.state.activeSession = {
      id: crypto.randomUUID(),
      label,
      startedAt: Date.now(),
      endedAt: null,
      loot: []
    };

    this.tickUI();
  }

  togglePause() {
    if (this.runState === "idle") return;
    this.runState = this.runState === "paused" ? "running" : "paused";
    this.tickUI();
  }

  stop() {
    if (this.runState === "idle") return;

    this.runState = "idle";
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    // finalize session
    const s = this.state.activeSession;
    if (s) {
      s.endedAt = Date.now();
      s.loot = this.getCurrentLoot();
      this.state.sessions.unshift(s as Session);
      this.state.activeSession = null;
    }

    this.tickUI();
  }

  reset() {
    this.runState = "idle";
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.loot = {};
    this.slots = Array.from({ length: 28 }, () => ({
      sig: null,
      qty: null,
      pendingQty: null,
      pendingCount: 0
    }));
    this.lastMoneySeen = null;
    this.moneyCooldownUntil = 0;
  }

  private tickUI() {
    this.updateCb?.();
  }

  private captureAndUpdate(isBaseline: boolean) {
    if (!this.invRegion) return;

    const img = a1lib.captureHoldFullRs();
    if (!img) return;

    const inv = img.toData(this.invRegion.x, this.invRegion.y, this.invRegion.w, this.invRegion.h);
    if (!inv) return;

    // Inventory grid assumptions:
    // - 4 columns x 7 rows
    // - Slot size is derived from region size. Works if region tightly fits the grid.
    // If your region includes padding/border, calibrate tightly around the grid area.
    const cols = 4, rows = 7;
    const slotW = Math.floor(this.invRegion.w / cols);
    const slotH = Math.floor(this.invRegion.h / rows);

    for (let i = 0; i < 28; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const sx = col * slotW;
      const sy = row * slotH;

      // Icon area: exclude top-left number overlay by cropping lower portion a bit
      const iconPadTop = Math.floor(slotH * 0.22);
      const iconRect = { x: sx + 2, y: sy + iconPadTop, w: slotW - 4, h: slotH - iconPadTop - 2 };

      // Number area: top-left area where stack numbers render
      const numRect = { x: sx + 1, y: sy + 1, w: Math.floor(slotW * 0.72), h: Math.floor(slotH * 0.40) };

      const icon = inv.toData(iconRect.x, iconRect.y, iconRect.w, iconRect.h);
      const numImg = inv.toData(numRect.x, numRect.y, numRect.w, numRect.h);

      // Determine empty slot quickly: mostly dark pixels in icon area
      const isEmpty = icon ? this.isMostlyEmpty(icon) : true;

      let sig: string | null = null;
      if (!isEmpty && icon) {
        sig = aHash64(icon);
        // cache icon as png (for UI display)
        if (!this.iconCachePng[sig]) {
          try {
            this.iconCachePng[sig] = icon.toPngDataUrl();
          } catch {
            // ignore
          }
        }
      }

      let qty: number | null = null;
      if (!isEmpty && numImg) {
        qty = readStackNumber(numImg); // best-effort: may return null
      } else if (!isEmpty) {
        qty = 1; // if no visible stack number, assume 1
      }

      this.applySlotUpdate(i, sig, qty, isBaseline);
    }

    // Money pouch gain (yellow +X) region
    if (!isBaseline && this.moneyRegion) {
      const moneyImg = img.toData(this.moneyRegion.x, this.moneyRegion.y, this.moneyRegion.w, this.moneyRegion.h);
      const gain = moneyImg ? readMoneyGain(moneyImg) : null; // returns number or null
      if (gain && gain > 0) this.applyMoneyGain(gain);
    }

    this.tickUI();
  }

  private applyMoneyGain(gain: number) {
    const now = Date.now();
    if (now < this.moneyCooldownUntil) return;

    const key = `coins:pouch`;
    const display = `Coins (Money Pouch)`;

    // Dedup by last value “seen”
    const sig = `+${gain}`;
    if (this.lastMoneySeen === sig) return;

    this.lastMoneySeen = sig;
    // require it to “clear” before we accept repeats; also set a small cooldown
    this.moneyCooldownUntil = now + 1200;

    this.addLoot(key, display, gain, "coins");
  }

  private applySlotUpdate(slotIndex: number, sig: string | null, qty: number | null, isBaseline: boolean) {
    const slot = this.slots[slotIndex];

    // Empty slot
    if (!sig) {
      slot.sig = null;
      slot.qty = null;
      slot.pendingQty = null;
      slot.pendingCount = 0;
      return;
    }

    // If OCR gives null (unreadable), do not change confirmed qty.
    // We still update sig so item identity stays correct.
    if (qty === null) {
      slot.sig = sig;
      return;
    }

    // 2-sample confirmation to reduce false spikes
    if (slot.pendingQty === qty) {
      slot.pendingCount += 1;
    } else {
      slot.pendingQty = qty;
      slot.pendingCount = 1;
    }

    if (slot.pendingCount < 2) {
      slot.sig = sig;
      return;
    }

    // Confirmed read
    const prevSig = slot.sig;
    const prevQty = slot.qty;

    slot.sig = sig;
    slot.qty = qty;

    // Baseline: set state but do NOT add loot
    if (isBaseline) return;

    // If item changed (different icon), treat as new stack (full qty)
    if (prevSig !== sig || prevQty === null) {
      this.addLoot(sig, this.displayName(sig), qty, "inv");
      return;
    }

    // Same item, only count increases
    if (qty > prevQty) {
      this.addLoot(sig, this.displayName(sig), qty - prevQty, "inv");
    }
  }

  private addLoot(key: string, displayName: string, addQty: number, source: "inv" | "coins") {
    if (addQty <= 0) return;

    if (!this.loot[key]) {
      this.loot[key] = { key, name: displayName, qty: 0, iconSig: source === "inv" ? key : null };
    }
    this.loot[key].qty += addQty;

    // keep active session mirror
    if (this.state.activeSession) {
      this.state.activeSession.loot = this.getCurrentLoot();
    }
  }

  private displayName(sig: string) {
    return this.state.iconNames[sig] ?? `Unidentified (${sig.slice(0, 6)})`;
  }

  private isMostlyEmpty(img: a1lib.ImgRef): boolean {
    // Fast heuristic: sample pixels; if most are near-dark, likely empty slot.
    const d = img.getData();
    if (!d) return true;
    const data = d.data;
    let dark = 0, total = 0;
    const step = 16; // sample every ~16 bytes (not exact pixels, but good enough heuristic)
    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 3 + g * 4 + b) / 8;
      total++;
      if (lum < 30) dark++;
    }
    return total > 0 && dark / total > 0.88;
  }
}
