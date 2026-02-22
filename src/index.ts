import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState, Rect } from "./storage";
import { setText, renderLootTable, renderSessionTable } from "./ui";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setLast(msg: string) {
  setText("lastAction", `last: ${msg}`);
  console.log("[LootTracker]", msg);
}

window.onerror = (event, source, lineno, colno, error) => {
  const msg = `JS error: ${String(event)} @ ${String(source)}:${lineno}:${colno}`;
  console.error(msg, error);
  alert(msg);
  return false;
};

window.onunhandledrejection = (e) => {
  const msg = `Unhandled promise rejection: ${String((e as any)?.reason ?? e)}`;
  console.error(msg, e);
  alert(msg);
};

window.addEventListener("load", () => {
  setLast("window load");

  const state: AppState = loadAppState();
  const tracker = new LootTracker(state);

  const sessionLabel = $("sessionLabel") as HTMLInputElement;

  function readRect(prefix: "inv" | "mon"): Rect | null {
    const x = Number(($(`${prefix}X`) as HTMLInputElement).value);
    const y = Number(($(`${prefix}Y`) as HTMLInputElement).value);
    const w = Number(($(`${prefix}W`) as HTMLInputElement).value);
    const h = Number(($(`${prefix}H`) as HTMLInputElement).value);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function fillInputsFromState() {
    if (state.settings.invRegion) {
      ($("invX") as HTMLInputElement).value = String(state.settings.invRegion.x);
      ($("invY") as HTMLInputElement).value = String(state.settings.invRegion.y);
      ($("invW") as HTMLInputElement).value = String(state.settings.invRegion.w);
      ($("invH") as HTMLInputElement).value = String(state.settings.invRegion.h);
    }
    if (state.settings.moneyRegion) {
      ($("monX") as HTMLInputElement).value = String(state.settings.moneyRegion.x);
      ($("monY") as HTMLInputElement).value = String(state.settings.moneyRegion.y);
      ($("monW") as HTMLInputElement).value = String(state.settings.moneyRegion.w);
      ($("monH") as HTMLInputElement).value = String(state.settings.moneyRegion.h);
    }
  }

  function setPreview(imgId: "imgInv" | "imgMoney", dataUrl: string | null) {
    const img = $(imgId) as HTMLImageElement;
    if (!dataUrl) {
      img.removeAttribute("src");
      return;
    }
    img.src = dataUrl;
  }

  function refreshUI(extraDiag?: string) {
    setText("statusInv", tracker.hasInventoryRegion() ? "Inventory: set" : "Inventory: not set");
    setText("statusMoney", tracker.hasMoneyRegion() ? "Money: set" : "Money: not set");
    setText("statusRun", `Status: ${tracker.getRunState()}`);

    const base = tracker.getDiagLine();
    setText("diag", extraDiag ? `${base} | ${extraDiag}` : base);

    const btnStart = $("btnStart") as HTMLButtonElement;
    const btnPause = $("btnPause") as HTMLButtonElement;
    const btnStop = $("btnStop") as HTMLButtonElement;

    btnStart.disabled = tracker.getRunState() !== "idle";
    btnPause.disabled = tracker.getRunState() === "idle";
    btnStop.disabled = tracker.getRunState() === "idle";

    renderLootTable(tracker.getCurrentLoot(), state);
    renderSessionTable(state.sessions);

    saveAppState(state);
  }

  // Wire buttons (with loud debug)
  ($("btnCalibInv") as HTMLButtonElement).onclick = async () => {
    setLast("clicked: calib inv");
    const ok = await tracker.calibrateInventoryRegion();
    if (ok) fillInputsFromState();
    refreshUI(ok ? "inv set" : "inv cancel");
  };

  ($("btnCalibMoney") as HTMLButtonElement).onclick = async () => {
    setLast("clicked: calib money");
    const ok = await tracker.calibrateMoneyRegion();
    if (ok) fillInputsFromState();
    refreshUI(ok ? "money set" : "money cancel");
  };

  ($("btnSetInv") as HTMLButtonElement).onclick = () => {
    setLast("clicked: set inv");
    const r = readRect("inv");
    if (!r) return alert("Invalid inventory rect.");
    tracker.setInventoryRegion(r);
    refreshUI("inv set");
  };

  ($("btnPreviewInv") as HTMLButtonElement).onclick = () => {
    setLast("clicked: preview inv");
    alert("Preview INV clicked (handler is running).");
    const r = readRect("inv");
    if (!r) return alert("Invalid inventory rect.");
    const res = tracker.previewRegion("inv", r);
    setPreview("imgInv", res.dataUrl);
    if (res.error) alert(res.error);
    refreshUI(res.error ? `inv preview: ${res.error}` : "inv preview ok");
  };

  ($("btnSetMoney") as HTMLButtonElement).onclick = () => {
    setLast("clicked: set money");
    const r = readRect("mon");
    if (!r) return alert("Invalid money rect.");
    tracker.setMoneyRegion(r);
    refreshUI("money set");
  };

  ($("btnPreviewMoney") as HTMLButtonElement).onclick = () => {
    setLast("clicked: preview money");
    alert("Preview MONEY clicked (handler is running).");
    const r = readRect("mon");
    if (!r) return alert("Invalid money rect.");
    const res = tracker.previewRegion("money", r);
    setPreview("imgMoney", res.dataUrl);
    if (res.error) alert(res.error);
    refreshUI(res.error ? `money preview: ${res.error}` : "money preview ok");
  };

  ($("btnStart") as HTMLButtonElement).onclick = () => {
    setLast("clicked: start");
    tracker.start(sessionLabel.value.trim() || "Unnamed");
    refreshUI("started");
  };

  ($("btnPause") as HTMLButtonElement).onclick = () => {
    setLast("clicked: pause");
    tracker.togglePause();
    refreshUI("pause toggled");
  };

  ($("btnStop") as HTMLButtonElement).onclick = () => {
    setLast("clicked: stop");
    tracker.stop();
    refreshUI("stopped");
  };

  ($("btnClearAll") as HTMLButtonElement).onclick = () => {
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