import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState, Rect } from "./storage";
import { setText, renderLootTable, renderSessionTable } from "./ui";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function setLast(msg: string) {
  setText("lastAction", `last: ${msg}`);
  console.log("[LootTracker]", msg);
}

window.addEventListener("load", () => {
  setLast("window load");

  const state: AppState = loadAppState();
  const tracker = new LootTracker(state);

  const sessionLabel = el<HTMLInputElement>("sessionLabel");
  const cnvInv = el<HTMLCanvasElement>("cnvInv");
  const cnvMoney = el<HTMLCanvasElement>("cnvMoney");

  function fillRectInputs(prefix: "inv" | "mon", r: Rect) {
    el<HTMLInputElement>(prefix + "X").value = String(r.x);
    el<HTMLInputElement>(prefix + "Y").value = String(r.y);
    el<HTMLInputElement>(prefix + "W").value = String(r.w);
    el<HTMLInputElement>(prefix + "H").value = String(r.h);
  }

  function fillInputsFromState() {
    if (state.settings.invRegion) fillRectInputs("inv", state.settings.invRegion);
    if (state.settings.moneyRegion) fillRectInputs("mon", state.settings.moneyRegion);
  }

  function readRect(prefix: "inv" | "mon"): { rect: Rect | null; why: string | null } {
    const raw = {
      x: el<HTMLInputElement>(prefix + "X").value,
      y: el<HTMLInputElement>(prefix + "Y").value,
      w: el<HTMLInputElement>(prefix + "W").value,
      h: el<HTMLInputElement>(prefix + "H").value
    };

    const missing: string[] = [];
    if (!raw.x.trim()) missing.push(prefix + "X");
    if (!raw.y.trim()) missing.push(prefix + "Y");
    if (!raw.w.trim()) missing.push(prefix + "W");
    if (!raw.h.trim()) missing.push(prefix + "H");
    if (missing.length) return { rect: null, why: `Missing: ${missing.join(", ")}` };

    const x = Number(raw.x), y = Number(raw.y), w = Number(raw.w), h = Number(raw.h);
    if (![x, y, w, h].every(Number.isFinite)) return { rect: null, why: "Values must be numbers" };
    if (w <= 0 || h <= 0) return { rect: null, why: "w/h must be > 0" };

    return { rect: { x, y, w, h }, why: null };
  }

  function drawToCanvas(canvas: HTMLCanvasElement, img: ImageData) {
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    ctx.putImageData(img, 0, 0);
  }

  function refreshUI(extraDiag?: string) {
    setText("statusInv", tracker.hasInventoryRegion() ? "Inventory: set" : "Inventory: not set");
    setText("statusMoney", tracker.hasMoneyRegion() ? "Money: set" : "Money: not set");
    setText("statusRun", `Status: ${tracker.getRunState()}`);

    const base = tracker.getDiagLine();
    setText("diag", extraDiag ? `${base} | ${extraDiag}` : base);

    const btnStart = el<HTMLButtonElement>("btnStart");
    const btnPause = el<HTMLButtonElement>("btnPause");
    const btnStop = el<HTMLButtonElement>("btnStop");

    btnStart.disabled = tracker.getRunState() !== "idle";
    btnPause.disabled = tracker.getRunState() === "idle";
    btnStop.disabled = tracker.getRunState() === "idle";

    renderLootTable(tracker.getCurrentLoot(), state);
    renderSessionTable(state.sessions);

    saveAppState(state);
  }

  // New: Use Saved buttons
  el<HTMLButtonElement>("btnUseInvSaved").onclick = () => {
    setLast("clicked: use inv saved");
    if (!state.settings.invRegion) return refreshUI("no saved inv region");
    fillRectInputs("inv", state.settings.invRegion);
    refreshUI("inv inputs filled");
  };

  el<HTMLButtonElement>("btnUseMoneySaved").onclick = () => {
    setLast("clicked: use money saved");
    if (!state.settings.moneyRegion) return refreshUI("no saved money region");
    fillRectInputs("mon", state.settings.moneyRegion);
    refreshUI("money inputs filled");
  };

  el<HTMLButtonElement>("btnCalibInv").onclick = async () => {
    setLast("clicked: calib inv");
    const ok = await tracker.calibrateInventoryRegion();
    if (ok && state.settings.invRegion) fillRectInputs("inv", state.settings.invRegion);
    refreshUI(ok ? "inv set" : "inv cancel");
  };

  el<HTMLButtonElement>("btnCalibMoney").onclick = async () => {
    setLast("clicked: calib money");
    const ok = await tracker.calibrateMoneyRegion();
    if (ok && state.settings.moneyRegion) fillRectInputs("mon", state.settings.moneyRegion);
    refreshUI(ok ? "money set" : "money cancel");
  };

  el<HTMLButtonElement>("btnSetInv").onclick = () => {
    setLast("clicked: set inv");
    const r = readRect("inv");
    if (!r.rect) return refreshUI(`inv set: ${r.why}`);
    tracker.setInventoryRegion(r.rect);
    refreshUI("inv set");
  };

  el<HTMLButtonElement>("btnPreviewInv").onclick = () => {
    setLast("clicked: preview inv");
    const r = readRect("inv");
    if (!r.rect) return refreshUI(`inv preview: ${r.why}`);

    const res = tracker.previewRegionImageData("inv", r.rect);
    if (res.error) return refreshUI(`inv preview: ${res.error}`);

    try {
      drawToCanvas(cnvInv, res.img!);
      refreshUI(`inv preview ok (${res.why ?? "img"})`);
    } catch (e: any) {
      refreshUI(`inv preview draw failed: ${String(e?.message ?? e)}`);
    }
  };

  el<HTMLButtonElement>("btnSetMoney").onclick = () => {
    setLast("clicked: set money");
    const r = readRect("mon");
    if (!r.rect) return refreshUI(`money set: ${r.why}`);
    tracker.setMoneyRegion(r.rect);
    refreshUI("money set");
  };

  el<HTMLButtonElement>("btnPreviewMoney").onclick = () => {
    setLast("clicked: preview money");
    const r = readRect("mon");
    if (!r.rect) return refreshUI(`money preview: ${r.why}`);

    const res = tracker.previewRegionImageData("money", r.rect);
    if (res.error) return refreshUI(`money preview: ${res.error}`);

    try {
      drawToCanvas(cnvMoney, res.img!);
      refreshUI(`money preview ok (${res.why ?? "img"})`);
    } catch (e: any) {
      refreshUI(`money preview draw failed: ${String(e?.message ?? e)}`);
    }
  };

  el<HTMLButtonElement>("btnStart").onclick = () => {
    setLast("clicked: start");
    tracker.start(sessionLabel.value.trim() || "Unnamed");
    refreshUI("started");
  };

  el<HTMLButtonElement>("btnPause").onclick = () => {
    setLast("clicked: pause");
    tracker.togglePause();
    refreshUI("pause toggled");
  };

  el<HTMLButtonElement>("btnStop").onclick = () => {
    setLast("clicked: stop");
    tracker.stop();
    refreshUI("stopped");
  };

  el<HTMLButtonElement>("btnClearAll").onclick = () => {
    setLast("clicked: clear all");
    if (!confirm("Clear all saved sessions and names?")) return;
    state.sessions = [];
    state.iconNames = {};
    tracker.reset();
    refreshUI("cleared");
  };

  tracker.onUpdate(() => refreshUI());

  fillInputsFromState(); // IMPORTANT
  refreshUI("boot ok");
});