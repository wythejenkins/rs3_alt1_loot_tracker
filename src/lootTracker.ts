import { captureHoldFullRs } from "@alt1/base";
import { readStackNumber, readMoneyGain } from "./ocr";
import { aHash64IgnoreTopLeft, isLikelyItemIcon, isLikelyHoverOverlay, hamming64hex } from "./phash";
import { AppState, LootEntry, Rect, Session } from "./storage";

type RunState = "idle" | "running" | "paused";

type SlotSnap = {
  sig: string | null;
  qty: number | null;
  pendingSig: string | null;
  pendingCount: number;
};

const HAMMING_SAME_ITEM_MAX = 8;

function toImageData(ref: any): ImageData | null {
  if (typeof ImageData !== "undefined" && ref instanceof ImageData) return ref;
  try { if (typeof ref?.toData === "function") return ref.toData() as ImageData; } catch {}
  try { if (typeof ref?.getData === "function") return ref.getData() as ImageData; } catch {}
  try {
    if (typeof ref?.read === "function") {
      const w = ref.width ?? ref.w;
      const h = ref.height ?? ref.h;
      if (typeof w === "number" && typeof h === "number") return ref.read(0, 0, w, h) as ImageData;
    }
  } catch {}
  try { if (typeof ref?.read === "function") return ref.read() as ImageData; } catch {}
  return null;
}

function cropImageData(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(src.width, Math.floor(x0 + w)));
  const y1 = Math.max(0, Math.min(src.height, Math.floor(y0 + h)));

  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  const out = new ImageData(cw, ch);
  const srcData = src.data;
  const outData = out.data;

  const srcStride = src.width * 4;
  const outStride = cw * 4;

  for (let row = 0; row < ch; row++) {
    const srcRowStart = (y0 + row) * srcStride + x0 * 4;
    const outRowStart = row * outStride;
    outData.set(srcData.subarray(srcRowStart, srcRowStart + outStride), outRowStart);
  }

  return out;
}

function iconForHashAndDisplay(iconImg: ImageData): ImageData {
  const w = iconImg.width, h = iconImg.height;
  const x = Math.floor(w * 0.22);
  const y = Math.floor(h * 0.22);
  const cw = Math.max(1, w - x);
  const ch = Math.max(1, h - y);
  return cropImageData(iconImg, x, y, cw, ch);
}

export class LootTracker {
  private state: AppState;
  private runState: RunState = "idle";

  private invRegion: Rect | null;
  private moneyRegion: Rect | null;

  private slots: SlotSnap[] = Array.from({ length: 28 }, () => ({
    sig: null,
    qty: null,
    pendingSig: null,
    pendingCount: 0,
  }));

  private loot: Record<string, LootEntry> = {};
  private iconImgs: Map<string, ImageData> = new Map();

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

  getDiagLine(): string {
    const alt1: any = (window as any).alt1;
    if (!alt1) return "alt1: not detected";
    return `alt1 ok | pixel=${!!alt1.permissionPixel} overlay=${!!alt1.permissionOverlay} rsLinked=${!!alt1.rsLinked}`;
  }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a, b) => b.qty - a.qty);
  }

  getIconImageData(key: string): ImageData | null {
    return this.iconImgs.get(key) ?? null;
  }

  reset() {
    this.loot = {};
    this.iconImgs.clear();
    this.slots = this.slots.map(() => ({ sig: null, qty: null, pendingSig: null, pendingCount: 0 }));
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

  captureFullImageData(): { img: ImageData | null; error: string | null } {
    const cap: any = captureHoldFullRs();
    if (!cap) return { img: null, error: "captureHoldFullRs() returned null" };
    const img = toImageData(cap);
    if (!img) return { img: null, error: "Could not convert capture to ImageData" };
    return { img, error: null };
  }

  previewRegionImageData(_kind: "inv" | "money", rect: Rect): { img: ImageData | null; error: string | null } {
    const full = this.captureFullImageData();
    if (full.error || !full.img) return { img: null, error: full.error };
    return { img: cropImageData(full.img, rect.x, rect.y, rect.w, rect.h), error: null };
  }

  start(label: string) {
    if (!this.invRegion) return;

    this.runState = "running";
    this.reset();

    this.captureAndUpdate(true);

    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.runState !== "running") return;
      this.captureAndUpdate(false);
    }, 650);

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

    const full = this.captureFullImageData();
    if (full.error || !full.img) return;

    const frame = full.img;

    const cols = 4, rows = 7;
    const slotW = Math.floor(this.invRegion.w / cols);
    const slotH = Math.floor(this.invRegion.h / rows);

    for (let i = 0; i < 28; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const sx = this.invRegion.x + col * slotW;
      const sy = this.invRegion.y + row * slotH;

      const iconImg = cropImageData(
        frame,
        sx + Math.floor(slotW * 0.18),
        sy + Math.floor(slotH * 0.26),
        Math.floor(slotW * 0.64),
        Math.floor(slotH * 0.64)
      );

      // If tooltip/hover overlay is likely covering this slot, ignore this frame for this slot.
      if (isLikelyHoverOverlay(iconImg)) {
        continue;
      }

      const numImg = cropImageData(
        frame,
        sx + 1,
        sy + 1,
        Math.floor(slotW * 0.70),
        Math.floor(slotH * 0.38)
      );

      if (!isLikelyItemIcon(iconImg)) {
        this.applySlotUpdate(i, null, null, isBaseline, null);
        continue;
      }

      const stableIcon = iconForHashAndDisplay(iconImg);
      const sig = aHash64IgnoreTopLeft(stableIcon);
      const qty = readStackNumber(numImg);

      this.applySlotUpdate(i, sig, qty, isBaseline, stableIcon);
    }

    if (!isBaseline && this.moneyRegion) {
      const moneyImg = cropImageData(frame, this.moneyRegion.x, this.moneyRegion.y, this.moneyRegion.w, this.moneyRegion.h);
      const gain = readMoneyGain(moneyImg);
      if (gain) this.addLoot("coins:pouch", "Coins (Money Pouch)", gain, null);
    }

    this.updateCb?.();
  }

  private applySlotUpdate(i: number, sig: string | null, qty: number | null, isBaseline: boolean, iconImg: ImageData | null) {
    const slot = this.slots[i];

    if (isBaseline) {
      slot.sig = sig;
      slot.qty = qty;
      slot.pendingSig = null;
      slot.pendingCount = 0;
      return;
    }

    if (!sig) {
      slot.sig = null;
      slot.qty = null;
      slot.pendingSig = null;
      slot.pendingCount = 0;
      return;
    }

    // If the new sig is "close enough" to the old sig, treat as unchanged.
    if (slot.sig && hamming64hex(slot.sig, sig) <= HAMMING_SAME_ITEM_MAX) {
      // keep old stable sig; still store icon if missing
      if (iconImg && !this.iconImgs.has(slot.sig)) this.iconImgs.set(slot.sig, iconImg);
      return;
    }

    // debounce: require 2 consecutive frames with same sig
    if (slot.pendingSig !== sig) {
      slot.pendingSig = sig;
      slot.pendingCount = 1;
      return;
    } else {
      slot.pendingCount++;
      if (slot.pendingCount < 2) return;
    }

    slot.pendingSig = null;
    slot.pendingCount = 0;

    const prevSig = slot.sig;
    const prevQty = slot.qty;

    slot.sig = sig;
    slot.qty = qty;

    if (iconImg && !this.iconImgs.has(sig)) this.iconImgs.set(sig, iconImg);

    // No OCR yet: ONLY record when item CHANGES
    if (qty === null) {
      if (prevSig !== sig) this.addLoot(sig, this.displayName(sig), 1, iconImg);
      return;
    }

    // OCR later will handle decreases properly:
    if (prevSig !== sig || prevQty === null) {
      this.addLoot(sig, this.displayName(sig), qty, iconImg);
      return;
    }
    if (qty > prevQty) this.addLoot(sig, this.displayName(sig), qty - prevQty, iconImg);
    // if qty < prevQty: ignore (consumed/spent)
  }

  private addLoot(key: string, name: string, qty: number, iconImg: ImageData | null) {
    if (qty <= 0) return;

    if (!this.loot[key]) this.loot[key] = { key, name, qty: 0, iconSig: key };
    this.loot[key].qty += qty;

    if (iconImg && !this.iconImgs.has(key)) this.iconImgs.set(key, iconImg);

    if (this.state.activeSession) this.state.activeSession.loot = this.getCurrentLoot();
  }

  private displayName(sig: string) {
    return this.state.iconNames[sig] ?? `Unidentified (${sig.slice(0, 6)})`;
  }
}