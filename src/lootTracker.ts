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

function refToImageData(ref: any): ImageData | null {
  // Already ImageData?
  if (typeof ImageData !== "undefined" && ref instanceof ImageData) return ref;

  // Common Alt1 image-ref conversion methods (runtime varies)
  try {
    if (typeof ref?.toData === "function") {
      // Some builds: toData() -> ImageData
      const out = ref.toData();
      if (out && out.data && typeof out.width === "number" && typeof out.height === "number") return out as ImageData;
    }
  } catch {}

  try {
    if (typeof ref?.getData === "function") {
      // Some builds: getData() -> ImageData
      const out = ref.getData();
      if (out && out.data && typeof out.width === "number" && typeof out.height === "number") return out as ImageData;
    }
  } catch {}

  // Some builds expose a different signature: toData(x,y,w,h)
  try {
    if (typeof ref?.toData === "function" && typeof ref?.width === "number" && typeof ref?.height === "number") {
      const out = ref.toData(0, 0, ref.width, ref.height);
      if (out && out.data && typeof out.width === "number" && typeof out.height === "number") return out as ImageData;
    }
  } catch {}

  return null;
}

function imageDataToDataUrl(img: ImageData): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
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

  constructor(state: AppState) {
    this.state = state;
    this.invRegion = state.settings.invRegion ?? null;
    this.moneyRegion = state.settings.moneyRegion ?? null;
  }

  onUpdate(cb: () => void) { this.updateCb = cb; }

  hasInventoryRegion() { return !!this.invRegion; }
  hasMoneyRegion() { return !!this.moneyRegion; }
  getRunState() { return this.runState; }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a, b) => b.qty - a.qty);
  }

  reset() {
    this.loot = {};
    this.slots = this.slots.map(() => ({ sig: null, qty: null }));
  }

  getDiagLine(): string {
    const alt1: any = (window as any).alt1;
    if (!alt1) return "alt1: not detected";
    return `alt1 ok | pixel=${!!alt1.permissionPixel} overlay=${!!alt1.permissionOverlay} rsLinked=${!!alt1.rsLinked}`;
  }

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

  async calibrateInventoryRegion(): Promise<boolean> {
    const r = promptRect("Set Inventory Region", this.invRegion);
    if (!r) return false;
    this.setInventoryRegion(r);
    return true;
  }

  async calibrateMoneyRegion(): Promise<boolean> {
    const r = promptRect("Set Money Region", this.moneyRegion);
    if (!r) return false;
    this.setMoneyRegion(r);
    return true;
  }

  /**
   * Returns { dataUrl, error } so UI can show meaningful feedback.
   */
  previewRegion(kind: "inv" | "money", override?: Rect): { dataUrl: string | null; error: string | null } {
    const r = override ?? (kind === "inv" ? this.invRegion : this.moneyRegion);
    if (!r) return { dataUrl: null, error: "Region not set." };

    const img: any = captureHoldFullRs();
    if (!img) return { dataUrl: null, error: "captureHoldFullRs() returned null." };
    if (typeof img.crop !== "function") return { dataUrl: null, error: "Capture object has no crop() method." };

    let cropRef: any;
    try {
      cropRef = img.crop(r.x, r.y, r.w, r.h);
    } catch (e: any) {
      return { dataUrl: null, error: `crop() threw: ${String(e?.message ?? e)}` };
    }

    const id = refToImageData(cropRef);
    if (!id) return { dataUrl: null, error: "Could not convert crop to ImageData (no toData/getData available)." };

    const url = imageDataToDataUrl(id);
    if (!url) return { dataUrl: null, error: "Canvas conversion failed (toDataURL)." };

    return { dataUrl: url, error: null };
  }

  start(label: string) {
    if (!this.invRegion) { alert("Inventory region not set."); return; }

    this.runState = "running";
    this.reset();
    this.captureAndUpdate(true);

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

    const cols = 4, rows = 7;
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