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

function mixColorSafe(r: number, g: number, b: number): number {
  const a1lib: any = (window as any).a1lib;
  if (a1lib?.mixColor) return a1lib.mixColor(r, g, b);
  // Fallback (may still work depending on build)
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

  // --- Overlay helpers (screen coords!) ---
  private rsClientToScreen(r: Rect): Rect {
    const alt1: any = (window as any).alt1;
    if (alt1?.rsLinked) {
      return { x: r.x + (alt1.rsX ?? 0), y: r.y + (alt1.rsY ?? 0), w: r.w, h: r.h };
    }
    return r; // best effort
  }

  clearOverlay() {
    const alt1: any = (window as any).alt1;
    if (!alt1?.overLayClearGroup) {
      alert("Overlay API not available. Make sure the app has Overlay permission.");
      return;
    }
    alt1.overLayClearGroup(this.overlayGroup); // group-based clearing :contentReference[oaicite:1]{index=1}
  }

  previewRect(r: Rect) {
    const alt1: any = (window as any).alt1;
    if (!alt1?.overLayRect || !alt1?.overLaySetGroup || !alt1?.overLayText) {
      alert("Overlay API not available. Enable Overlay permission for this app in Alt1 Settings → Apps.");
      return;
    }

    // Diagnostic info so we can tell if rs is linked / coords are sane
    const info =
      `OverlayPerm=${alt1.permissionOverlay} PixelPerm=${alt1.permissionPixel} ` +
      `rsLinked=${alt1.rsLinked} rsX=${alt1.rsX} rsY=${alt1.rsY}`;

    alt1.overLaySetGroup(this.overlayGroup);

    const yellow = mixColorSafe(255, 255, 0);
    const white = mixColorSafe(255, 255, 255);

    // Draw a very obvious test marker near the RS client top-left (screen space)
    if (alt1.rsLinked) {
      alt1.overLayRect(white, alt1.rsX + 10, alt1.rsY + 10, 220, 80, 3000, 3);
      alt1.overLayText("LootTracker overlay TEST", white, 14, alt1.rsX + 16, alt1.rsY + 16, 3000);
    } else {
      // If RS not linked, draw in global screen coords so you can still see *something*
      alt1.overLayRect(white, (alt1.screenX ?? 0) + 20, (alt1.screenY ?? 0) + 20, 260, 90, 3000, 3);
      alt1.overLayText("Overlay TEST (RS not linked)", white, 14, (alt1.screenX ?? 0) + 28, (alt1.screenY ?? 0) + 28, 3000);
    }

    // Now draw the requested preview rect, converted to screen coords
    const sr = this.rsClientToScreen(r);

    // Correct signature: overLayRect(color, x, y, w, h, timeMs, lineWidth) :contentReference[oaicite:2]{index=2}
    const ok = alt1.overLayRect(yellow, sr.x, sr.y, sr.w, sr.h, 3000, 2);
    alt1.overLayText(ok ? "Preview OK" : "Preview FAILED", yellow, 14, sr.x + 6, sr.y + 6, 3000);

    if (ok === false) {
      alert(
        "Alt1 returned false from overLayRect.\n\n" +
        info +
        "\n\nCommon fixes:\n" +
        "• Run Alt1 as Administrator\n" +
        "• Avoid exclusive fullscreen; use Windowed/Borderless\n" +
        "• Disable conflicting overlays (Xbox Game Bar / Steam / OBS)\n"
      );
    } else {
      console.log("Overlay preview:", { inputRect: r, screenRect: sr, info });
    }
  }

  // Manual “calibrate” prompts (no Alt+1 dependency)
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