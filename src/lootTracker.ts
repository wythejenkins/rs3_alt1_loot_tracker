import { captureHoldFullRs } from "@alt1/base";
import { readStackNumber, readMoneyGain } from "./ocr";
import { aHash64 } from "./phash";
import { AppState, LootEntry, Rect, Session } from "./storage";

type RunState = "idle" | "running" | "paused";
type SlotSnap = { sig: string | null; qty: number | null };

function promptRect(title: string, existing: Rect | null): Rect | null {
  const def = existing ? `${existing.x},${existing.y},${existing.w},${existing.h}` : "";
  const raw = prompt(`${title}\n\nEnter x,y,w,h (RS client pixels):`, def);
  if (!raw) return null;

  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4) return null;

  const [x, y, w, h] = parts;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function getOverlayColorInt(): number {
  // Best case: a1lib.mixColor exists (common in Alt1 environments).
  // Fallback: a bright white value (still often works).
  const a1lib: any = (window as any).a1lib;
  if (a1lib?.mixColor) {
    // mixColor(r,g,b,a?) — alpha optional
    return a1lib.mixColor(255, 255, 0); // yellow-ish
  }
  return 0xffffffff;
}

export class LootTracker {
  private state: AppState;
  private runState: RunState = "idle";

  private invRegion: Rect | null;
  private moneyRegion: Rect | null;

  private slots: SlotSnap[] = Array.from({ length: 28 }, () => ({ sig: null, qty: null }));
  private loot: Record<string, LootEntry> = {};

  private timer: number | null = null;
  private updateCb: (() => void) | null = null;

  private readonly overlayGroup = "loottracker_preview";

  constructor(state: AppState) {
    this.state = state;
    this.invRegion = state.settings.invRegion ?? null;
    this.moneyRegion = state.settings.moneyRegion ?? null;
  }

  onUpdate(cb: () => void) {
    this.updateCb = cb;
  }

  hasInventoryRegion() {
    return !!this.invRegion;
  }
  hasMoneyRegion() {
    return !!this.moneyRegion;
  }
  getRunState() {
    return this.runState;
  }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a, b) => b.qty - a.qty);
  }

  reset() {
    this.loot = {};
    this.slots = this.slots.map(() => ({ sig: null, qty: null }));
  }

  // Manual setters
  setInventoryRegion(r: Rect) {
    this.invRegion = r;
    this.state.settings.invRegion = r;
    this.updateCb?.();
  }

  setMoneyRegion(r: Rect) {
    this.moneyRegion = r;
    this.state.settings.moneyRegion = r;
    this.updateCb?.();
  }

  // Overlay preview helpers (requires Overlay permission)
  clearOverlay() {
    const alt1: any = (window as any).alt1;
    if (!alt1?.overLayClearGroup) {
      alert("Alt1 overlay API not available. Make sure Overlay permission is enabled for this app.");
      return;
    }
    alt1.overLayClearGroup(this.overlayGroup);
  }

  previewRect(r: Rect) {
    const alt1: any = (window as any).alt1;
    if (!alt1?.overLayRect || !alt1?.overLaySetGroup) {
      alert("Alt1 overlay API not available. Enable Overlay permission for this app in Alt1 Settings → Apps.");
      return;
    }

    // Group the overlays so we can clear them cleanly
    alt1.overLaySetGroup(this.overlayGroup);

    const color = getOverlayColorInt();
    const timeMs = 3000; // show for 3 seconds
    const lineWidth = 2;

    // Correct signature:
    // overLayRect(color, x, y, w, h, timeMs, lineWidth)
    const ok = alt1.overLayRect(color, r.x, r.y, r.w, r.h, timeMs, lineWidth);

    if (ok === false) {
      alert(
        "Alt1 rejected the overlay draw call.\n\n" +
          "Try:\n" +
          "• Ensure Overlay permission is enabled\n" +
          "• Run Alt1 as Administrator (some systems block overlays)\n" +
          "• Make sure RS is NOT running as Administrator\n"
      );
    }
  }

  // “Calibrate” buttons use manual prompt
  async calibrateInventoryRegion(): Promise<boolean> {
    const r = promptRect("Calibrate Inventory Region", this.invRegion);
    if (!r) return false;
    this.setInventoryRegion(r);
    return true;
  }

  async calibrateMoneyRegion(): Promise<boolean> {
    const r = promptRect("Calibrate Money Gain Region", this.moneyRegion);
    if (!r) return false;
    this.setMoneyRegion(r);
    return true;
  }

  start(label: string) {
    if (!this.invRegion) {
      alert("Inventory region not set.");
      return;
    }

    this.runState = "running";
    this.reset();

    // baseline
    this.captureAndUpdate(true);

    // loop
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.runState !== "running") return;
      this.captureAndUpdate(false);
    }, 600);

    this.state.activeSession = {
      id: crypto.randomUUID(),
      label,
      startedAt: Date.now(),
      endedAt: null,
      loot: []
    };

    this.updateCb?.();
  }

  togglePause() {
    if (this.runState === "idle") return;
    this.runState = this.runState === "paused" ? "running" : "paused";
    this.updateCb?.();
  }

  stop() {
    if (this.runState === "idle") return;

    this.runState = "idle";
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    const s = this.state.activeSession;
    if (s) {
      s.endedAt = Date.now();
      s.loot = this.getCurrentLoot();
      this.state.sessions.unshift(s as Session);
      this.state.activeSession = null;
    }

    this.updateCb?.();
  }

  private captureAndUpdate(isBaseline: boolean) {
    if (!this.invRegion) return;

    const img: any = captureHoldFullRs();
    if (!img || typeof img.crop !== "function") return;

    const cols = 4,
      rows = 7;
    const slotW = Math.floor(this.invRegion.w / cols);
    const slotH = Math.floor(this.invRegion.h / rows);

    for (let i = 0; i < 28; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const sx = this.invRegion.x + col * slotW;
      const sy = this.invRegion.y + row * slotH;

      const icon: any = img.crop(sx + 2, sy + Math.floor(slotH * 0.22), slotW - 4, slotH - 4);
      const num: any = img.crop(sx + 1, sy + 1, Math.floor(slotW * 0.7), Math.floor(slotH * 0.4));

      const sig = aHash64(icon);
      const qty = readStackNumber(num);

      this.applySlotUpdate(i, sig, qty, isBaseline);
    }

    if (!isBaseline && this.moneyRegion) {
      const money: any = img.crop(this.moneyRegion.x, this.moneyRegion.y, this.moneyRegion.w, this.moneyRegion.h);
      const gain = readMoneyGain(money);
      if (gain) this.addLoot("coins:pouch", "Coins (Money Pouch)", gain);
    }

    this.updateCb?.();
  }

  private applySlotUpdate(i: number, sig: string | null, qty: number | null, isBaseline: boolean) {
    const slot = this.slots[i];
    if (!sig || qty === null) return;

    const prevSig = slot.sig;
    const prevQty = slot.qty;

    slot.sig = sig;
    slot.qty = qty;

    if (isBaseline) return;

    if (prevSig !== sig || prevQty === null) {
      this.addLoot(sig, this.displayName(sig), qty);
      return;
    }

    if (qty > prevQty) this.addLoot(sig, this.displayName(sig), qty - prevQty);
  }

  private addLoot(key: string, name: string, qty: number) {
    if (qty <= 0) return;
    if (!this.loot[key]) this.loot[key] = { key, name, qty: 0, iconSig: key };
    this.loot[key].qty += qty;

    if (this.state.activeSession) this.state.activeSession.loot = this.getCurrentLoot();
  }

  private displayName(sig: string) {
    return this.state.iconNames[sig] ?? `Unidentified (${sig.slice(0, 6)})`;
  }
}