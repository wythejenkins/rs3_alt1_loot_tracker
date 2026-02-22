import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState, Rect } from "./storage";
import { setText, renderLootTable, renderSessionTable } from "./ui";

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function setLast(msg: string) {
  setText("lastAction", `last: ${msg}`);
  console.log("[LootTracker]", msg);
}

function drawToCanvas(canvas: HTMLCanvasElement, img: ImageData) {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.putImageData(img, 0, 0);
}

window.addEventListener("load", () => {
  setLast("window load");

  const state: AppState = loadAppState();
  const tracker = new LootTracker(state);

  const sessionLabel = getEl<HTMLInputElement>("sessionLabel");
  const cnvInv = getEl<HTMLCanvasElement>("cnvInv");
  const cnvMoney = getEl<HTMLCanvasElement>("cnvMoney");

  function readRect(prefix: "inv" | "mon"): Rect | null {
    const x = Number(getEl<HTMLInputElement>(prefix + "X").value);
    const y = Number(getEl<HTMLInputElement>(prefix + "Y").value);
    const w = Number(getEl<HTMLInputElement>(prefix + "W").value);
    const h = Number(getEl<HTMLInputElement>(prefix + "H").value);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function fillInputsFromState() {
    if (state.settings.invRegion) {
      getEl<HTMLInputElement>("invX").value = String(state.settings.invRegion.x);
      getEl<HTMLInputElement>("invY").value = String(state.settings.invRegion.y);
      getEl<HTMLInputElement>("invW").value = String(state.settings.invRegion.w);
      getEl<HTMLInputElement>("invH").value = String(state.settings.invRegion.h);
    }
    if (state.settings.moneyRegion) {
      getEl<HTMLInputElement>("monX").value = String(state.settings.moneyRegion.x);
      getEl<HTMLInputElement>("monY").value = String(state.settings.moneyRegion.y);
      getEl<HTMLInputElement>("monW").value = String(state.settings.moneyRegion.w);
      getEl<HTMLInputElement>("monH").value = String(state.settings.moneyRegion.h);
    }
  }

  function refreshUI(extraDiag?: string) {
    setText("statusInv", tracker.hasInventoryRegion() ? "Inventory: set" : "Inventory: not set");
    setText("statusMoney", tracker.hasMoneyRegion() ? "Money: set" : "Money: not set");
    setText("statusRun", `Status: ${tracker.getRunState()}`);

    const base = tracker.getDiagLine();
    setText("diag", extraDiag ? `${base} | ${extraDiag}` : base);

    const btnStart = getEl<HTMLButtonElement>("btnStart");
    const btnPause = getEl<HTMLButtonElement>("btnPause");
    const btnStop = getEl<HTMLButtonElement>("btnStop");

    btnStart.disabled = tracker.getRunState() !== "idle";
    btnPause.disabled = tracker.getRunState() === "idle";
    btnStop.disabled = tracker.getRunState() === "idle";

    renderLootTable(tracker.getCurrentLoot(), state);
    renderSessionTable(state.sessions);

    saveAppState(state);
  }

  getEl<HTMLButtonElement>("btnCalibInv").onclick = async () => {
    setLast("clicked: calib inv");
    const ok = await tracker.calibrateInventoryRegion();
    if (ok) fillInputsFromState();
    refreshUI(ok ? "inv set" : "inv cancel");
  };

  getEl<HTMLButtonElement>("btnCalibMoney").onclick = async () => {
    setLast("clicked: calib money");
    const ok = await tracker.calibrateMoneyRegion();
    if (ok) fillInputsFromState();
    refreshUI(ok ? "money set" : "money cancel");
  };

  getEl<HTMLButtonElement>("btnSetInv").onclick = () => {
    setLast("clicked: set inv");
    const r = readRect("inv");
    if (!r) return refreshUI("inv set: invalid rect");
    tracker.setInventoryRegion(r);
    refreshUI("inv set");
  };

  getEl<HTMLButtonElement>("btnPreviewInv").onclick = () => {
    setLast("clicked: preview inv");
    const r = readRect("inv");
    if (!r) return refreshUI("inv preview: invalid rect");

    const res = tracker.previewRegionImageData("inv", r);
    if (res.error) return refreshUI(`inv preview: ${res.error}`);

    try {
      drawToCanvas(cnvInv, res.img!);
      refreshUI(`inv preview ok (${res.why ?? "img"})`);
    } catch (e: any) {
      refreshUI(`inv preview draw failed: ${String(e?.message ?? e)}`);
    }
  };

  getEl<HTMLButtonElement>("btnSetMoney").onclick = () => {
    setLast("clicked: set money");
    const r = readRect("mon");
    if (!r) return refreshUI("money set: invalid rect");
    tracker.setMoneyRegion(r);
    refreshUI("money set");
  };

  getEl<HTMLButtonElement>("btnPreviewMoney").onclick = () => {
    setLast("clicked: preview money");
    const r = readRect("mon");
    if (!r) return refreshUI("money preview: invalid rect");

    const res = tracker.previewRegionImageData("money", r);
    if (res.error) return refreshUI(`money preview: ${res.error}`);

    try {
      drawToCanvas(cnvMoney, res.img!);
      refreshUI(`money preview ok (${res.why ?? "img"})`);
    } catch (e: any) {
      refreshUI(`money preview draw failed: ${String(e?.message ?? e)}`);
    }
  };

  getEl<HTMLButtonElement>("btnStart").onclick = () => {
    setLast("clicked: start");
    tracker.start(sessionLabel.value.trim() || "Unnamed");
    refreshUI("started");
  };

  getEl<HTMLButtonElement>("btnPause").onclick = () => {
    setLast("clicked: pause");
    tracker.togglePause();
    refreshUI("pause toggled");
  };

  getEl<HTMLButtonElement>("btnStop").onclick = () => {
    setLast("clicked: stop");
    tracker.stop();
    refreshUI("stopped");
  };

  getEl<HTMLButtonElement>("btnClearAll").onclick = () => {
    setLast("clicked: clear all");
    if (!confirm("Clear all saved sessions and names?")) return;
    state.sessions = [];
    state.iconNames = {};
    tracker.reset();
    refreshUI("cleared");
  };

  tracker.onUpdate(() => refreshUI());
  fillInputsFromState();
  refreshUI("boot ok");
});