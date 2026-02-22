import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState } from "./storage";
import { setText, renderLootTable, renderSessionTable, wireClickRename } from "./ui";

const state: AppState = loadAppState();
const tracker = new LootTracker(state);

const btnCalibInv = document.getElementById("btnCalibInv") as HTMLButtonElement;
const btnCalibMoney = document.getElementById("btnCalibMoney") as HTMLButtonElement;
const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnPause = document.getElementById("btnPause") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const btnClearAll = document.getElementById("btnClearAll") as HTMLButtonElement;

const sessionLabel = document.getElementById("sessionLabel") as HTMLInputElement;

function refreshUI() {
  setText("statusInv", tracker.hasInventoryRegion() ? "Inventory: set" : "Inventory: not set");
  setText("statusMoney", tracker.hasMoneyRegion() ? "Money: set" : "Money: not set");
  setText("statusRun", `Status: ${tracker.getRunState()}`);

  btnStart.disabled = tracker.getRunState() !== "idle";
  btnPause.disabled = tracker.getRunState() === "idle";
  btnStop.disabled = tracker.getRunState() === "idle";

  renderLootTable(tracker.getCurrentLoot(), state);
  renderSessionTable(state.sessions);
  wireClickRename(state, (sig) => tracker.getIconPngDataUrl(sig));

  saveAppState(state);
}

btnCalibInv.onclick = async () => {
  const ok = await tracker.calibrateInventoryRegion();
  if (!ok) alert("Failed to read region. Use Alt1 region capture (Alt+1) on your inventory panel first.");
  refreshUI();
};

btnCalibMoney.onclick = async () => {
  const ok = await tracker.calibrateMoneyRegion();
  if (!ok) alert("Failed to read region. Use Alt1 region capture (Alt+1) on the yellow +X gain text area.");
  refreshUI();
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
  if (!confirm("Clear all saved sessions and icon names?")) return;
  state.sessions = [];
  state.iconNames = {};
  tracker.reset();
  refreshUI();
};

tracker.onUpdate(refreshUI);
refreshUI();
