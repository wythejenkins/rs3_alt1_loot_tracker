import { captureHoldFullRs } from "@alt1/base";
import { readStackNumber, readMoneyGain } from "./ocr";
import { aHash64 } from "./phash";
import { AppState, LootEntry, Rect, Session } from "./storage";

type RunState = "idle" | "running" | "paused";
type SlotSnap = { sig: string | null; qty: number | null };

function toImageData(ref: any): { img: ImageData | null; why: string } {
  if (typeof ImageData !== "undefined" && ref instanceof ImageData) return { img: ref, why: "already ImageData" };

  try {
    if (typeof ref?.toData === "function") {
      const out = ref.toData();
      if (out?.data && typeof out.width === "number" && typeof out.height === "number") return { img: out as ImageData, why: "toData()" };
    }
  } catch {}

  try {
    if (typeof ref?.getData === "function") {
      const out = ref.getData();
      if (out?.data && typeof out.width === "number" && typeof out.height === "number") return { img: out as ImageData, why: "getData()" };
    }
  } catch {}

  try {
    if (typeof ref?.read === "function") {
      const w = ref.width ?? ref.w;
      const h = ref.height ?? ref.h;
      if (typeof w === "number" && typeof h === "number") {
        const out = ref.read(0, 0, w, h);
        if (out?.data && typeof out.width === "number" && typeof out.height === "number") return { img: out as ImageData, why: "read(0,0,w,h)" };
      }
    }
  } catch {}

  try {
    if (typeof ref?.read === "function") {
      const out = ref.read();
      if (out?.data && typeof out.width === "number" && typeof out.height === "number") return { img: out as ImageData, why: "read()" };
    }
  } catch {}

  return { img: null, why: "No ImageData conversion method found (toData/getData/read)" };
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

  getDiagLine(): string {
    const alt1: any = (window as any).alt1;
    if (!alt1) return "alt1: not detected";
    return `alt1 ok | pixel=${!!alt1.permissionPixel} overlay=${!!alt1.permissionOverlay} rsLinked=${!!alt1.rsLinked}`;
  }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a, b) => b.qty - a.qty);
  }

  reset() {
    this.loot = {};
    this.slots = this.slots.map(() => ({ sig: null, qty: null }));
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

  captureFullImageData(): { img: ImageData | null; error: string | null; why?: string } {
    const imgRef: any = captureHoldFullRs();
    if (!imgRef) return { img: null, error: "captureHoldFullRs() returned null" };
    const conv = toImageData(imgRef);
    if (!conv.img) return { img: null, error: conv.why };
    return { img: conv.img, error: null, why: conv.why };
  }

  previewRegionImageData(kind: "inv" | "money", rect: Rect): { img: ImageData | null; error: string | null; why?: string } {
    const img: any = captureHoldFullRs();
    if (!img) return { img: null, error: "captureHoldFullRs() returned null." };
    if (typeof img.crop !== "function") return { img: null, error: "Capture object has no crop() method." };

    let cropRef: any;
    try {
      cropRef = img.crop(rect.x, rect.y, rect.w, rect.h);
    } catch (e: any) {
      return { img: null, error: `crop() threw: ${String(e?.message ?? e)}` };
    }

    const conv = toImageData(cropRef);
    if (!conv.img) return { img: null, error: conv.why };
    return { img: conv.img, error: null, why: conv.why };
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