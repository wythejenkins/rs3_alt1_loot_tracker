import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState, Rect } from "./storage";
import { setText, renderLootTable, renderSessionTable } from "./ui";

const state: AppState = loadAppState();
const tracker = new LootTracker(state);

const btnCalibInv = document.getElementById("btnCalibInv") as HTMLButtonElement;
const btnCalibMoney = document.getElementById("btnCalibMoney") as HTMLButtonElement;

const btnSetInv = document.getElementById("btnSetInv") as HTMLButtonElement;
const btnPreviewInv = document.getElementById("btnPreviewInv") as HTMLButtonElement;

const btnSetMoney = document.getElementById("btnSetMoney") as HTMLButtonElement;
const btnPreviewMoney = document.getElementById("btnPreviewMoney") as HTMLButtonElement;

const imgInv = document.getElementById("imgInv") as HTMLImageElement;
const imgMoney = document.getElementById("imgMoney") as HTMLImageElement;

const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnPause = document.getElementById("btnPause") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const btnClearAll = document.getElementById("btnClearAll") as HTMLButtonElement;

const sessionLabel = document.getElementById("sessionLabel") as HTMLInputElement;

function readRect(prefix: "inv" | "mon"): Rect | null {
  const x = Number((document.getElementById(prefix + "X") as HTMLInputElement).value);
  const y = Number((document.getElementById(prefix + "Y") as HTMLInputElement).value);
  const w = Number((document.getElementById(prefix + "W") as HTMLInputElement).value);
  const h = Number((document.getElementById(prefix + "H") as HTMLInputElement).value);

  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function fillInputsFromState() {
  if (state.settings.invRegion) {
    (document.getElementById("invX") as HTMLInputElement).value = String(state.settings.invRegion.x);
    (document.getElementById("invY") as HTMLInputElement).value = String(state.settings.invRegion.y);
    (document.getElementById("invW") as HTMLInputElement).value = String(state.settings.invRegion.w);
    (document.getElementById("invH") as HTMLInputElement).value = String(state.settings.invRegion.h);
  }
  if (state.settings.moneyRegion) {
    (document.getElementById("monX") as HTMLInputElement).value = String(state.settings.moneyRegion.x);
    (document.getElementById("monY") as HTMLInputElement).value = String(state.settings.moneyRegion.y);
    (document.getElementById("monW") as HTMLInputElement).value = String(state.settings.moneyRegion.w);
    (document.getElementById("monH") as HTMLInputElement).value = String(state.settings.moneyRegion.h);
  }
}

function refreshUI() {
  setText("statusInv", tracker.hasInventoryRegion() ? "Inventory: set" : "Inventory: not set");
  setText("statusMoney", tracker.hasMoneyRegion() ? "Money: set" : "Money: not set");
  setText("statusRun", `Status: ${tracker.getRunState()}`);
  setText("diag", tracker.getDiagLine());

  btnStart.disabled = tracker.getRunState() !== "idle";
  btnPause.disabled = tracker.getRunState() === "idle";
  btnStop.disabled = tracker.getRunState() === "idle";

  renderLootTable(tracker.getCurrentLoot(), state);
  renderSessionTable(state.sessions);

  saveAppState(state);
}

function setPreview(imgEl: HTMLImageElement, dataUrl: string | null) {
  if (!dataUrl) {
    imgEl.removeAttribute("src");
    imgEl.alt = "Preview unavailable (no data URL method found)";
    return;
  }
  imgEl.src = dataUrl;
}

btnCalibInv.onclick = async () => {
  const ok = await tracker.calibrateInventoryRegion();
  if (!ok) return;
  fillInputsFromState();
  refreshUI();
};

btnCalibMoney.onclick = async () => {
  const ok = await tracker.calibrateMoneyRegion();
  if (!ok) return;
  fillInputsFromState();
  refreshUI();
};

btnSetInv.onclick = () => {
  const r = readRect("inv");
  if (!r) return alert("Invalid inventory rect.");
  tracker.setInventoryRegion(r);
  refreshUI();
};

btnPreviewInv.onclick = () => {
  const r = readRect("inv");
  if (!r) return alert("Invalid inventory rect.");
  setPreview(imgInv, tracker.previewRegion("inv", r));
};

btnSetMoney.onclick = () => {
  const r = readRect("mon");
  if (!r) return alert("Invalid money rect.");
  tracker.setMoneyRegion(r);
  refreshUI();
};

btnPreviewMoney.onclick = () => {
  const r = readRect("mon");
  if (!r) return alert("Invalid money rect.");
  setPreview(imgMoney, tracker.previewRegion("money", r));
};

btnStart.onclick = () => {
  tracker.start(sessionLabel.value.trim() || "Unnamed");
  refreshUI();
};

btnPause.onclick = () => {
  tracker.togglePause();
  refreshUI();
};

btnStop.onclick = () => {
  tracker.stop();
  refreshUI();
};

btnClearAll.onclick = () => {
  if (!confirm("Clear all saved sessions and names?")) return;
  state.sessions = [];
  state.iconNames = {};
  tracker.reset();
  refreshUI();
};

tracker.onUpdate(refreshUI);
fillInputsFromState();
refreshUI();