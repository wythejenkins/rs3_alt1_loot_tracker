import { LootTracker } from "./lootTracker";
import { loadAppState, saveAppState, AppState, Rect } from "./storage";
import { setText, renderLootTable, renderSessionTable } from "./ui";

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing element #${id}`);
  return n as T;
}

type Mode = "inv" | "money";

function setLast(msg: string) {
  setText("lastAction", `last: ${msg}`);
  console.log("[LootTracker]", msg);
}

function drawImageData(canvas: HTMLCanvasElement, img: ImageData) {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.putImageData(img, 0, 0);
}

function drawSelectionOverlay(canvas: HTMLCanvasElement, baseImg: ImageData, sel: Rect | null) {
  drawImageData(canvas, baseImg);
  if (!sel) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 255, 0, 0.95)";
  ctx.fillStyle = "rgba(255, 255, 0, 0.12)";
  ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
  ctx.restore();
}

window.addEventListener("load", () => {
  setLast("window load");

  const state: AppState = loadAppState();
  const tracker = new LootTracker(state);

  const modePill = el<HTMLSpanElement>("modePill");
  const cnvFull = el<HTMLCanvasElement>("cnvFull");
  const cnvInv = el<HTMLCanvasElement>("cnvInv");
  const cnvMoney = el<HTMLCanvasElement>("cnvMoney");
  const sessionLabel = el<HTMLInputElement>("sessionLabel");

  let mode: Mode = "inv";
  let fullImg: ImageData | null = null;
  let isDragging = false;
  let dragStart: { x: number; y: number } | null = null;
  let selection: Rect | null = null;

  function setMode(m: Mode) {
    mode = m;
    modePill.textContent = `mode: ${m === "inv" ? "inventory" : "money"}`;
  }

  function fillRectInputs(prefix: "inv" | "mon", r: Rect) {
    el<HTMLInputElement>(prefix + "X").value = String(r.x);
    el<HTMLInputElement>(prefix + "Y").value = String(r.y);
    el<HTMLInputElement>(prefix + "W").value = String(r.w);
    el<HTMLInputElement>(prefix + "H").value = String(r.h);
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

    renderLootTable(tracker.getCurrentLoot(), state, (k) => tracker.getIconImageData(k));
    renderSessionTable(state.sessions);

    saveAppState(state);
  }

  el<HTMLButtonElement>("btnModeInv").onclick = () => { setLast("mode: inv"); setMode("inv"); refreshUI(); };
  el<HTMLButtonElement>("btnModeMoney").onclick = () => { setLast("mode: money"); setMode("money"); refreshUI(); };
  setMode("inv");

  el<HTMLButtonElement>("btnCaptureFull").onclick = () => {
    setLast("clicked: capture full");
    const cap = tracker.captureFullImageData();
    if (cap.error || !cap.img) return refreshUI(`capture: ${cap.error}`);

    fullImg = cap.img;
    selection = null;
    drawImageData(cnvFull, fullImg);

    el<HTMLButtonElement>("btnSaveSelection").disabled = true;
    el<HTMLButtonElement>("btnClearSelection").disabled = true;

    refreshUI("capture ok");
  };

  function getCanvasPoint(evt: MouseEvent): { x: number; y: number } {
    const rect = cnvFull.getBoundingClientRect();
    const sx = cnvFull.width / rect.width;
    const sy = cnvFull.height / rect.height;
    return {
      x: Math.max(0, Math.min(cnvFull.width - 1, Math.floor((evt.clientX - rect.left) * sx))),
      y: Math.max(0, Math.min(cnvFull.height - 1, Math.floor((evt.clientY - rect.top) * sy))),
    };
  }

  cnvFull.addEventListener("mousedown", (e) => {
    if (!fullImg) return;
    isDragging = true;
    dragStart = getCanvasPoint(e);
    selection = { x: dragStart.x, y: dragStart.y, w: 1, h: 1 };
    drawSelectionOverlay(cnvFull, fullImg, selection);
    refreshUI("dragging…");
  });

  cnvFull.addEventListener("mousemove", (e) => {
    if (!fullImg || !isDragging || !dragStart) return;
    const p = getCanvasPoint(e);

    const x1 = Math.min(dragStart.x, p.x);
    const y1 = Math.min(dragStart.y, p.y);
    const x2 = Math.max(dragStart.x, p.x);
    const y2 = Math.max(dragStart.y, p.y);

    selection = { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
    drawSelectionOverlay(cnvFull, fullImg, selection);
  });

  cnvFull.addEventListener("mouseup", () => {
    if (!fullImg) return;
    isDragging = false;
    dragStart = null;

    if (!selection || selection.w < 5 || selection.h < 5) {
      selection = null;
      drawImageData(cnvFull, fullImg);
      el<HTMLButtonElement>("btnSaveSelection").disabled = true;
      el<HTMLButtonElement>("btnClearSelection").disabled = true;
      return refreshUI("selection cleared");
    }

    el<HTMLButtonElement>("btnSaveSelection").disabled = false;
    el<HTMLButtonElement>("btnClearSelection").disabled = false;
    refreshUI(`selection ready ${selection.w}x${selection.h}`);
  });

  el<HTMLButtonElement>("btnClearSelection").onclick = () => {
    setLast("clicked: clear selection");
    if (!fullImg) return;
    selection = null;
    drawImageData(cnvFull, fullImg);
    el<HTMLButtonElement>("btnSaveSelection").disabled = true;
    el<HTMLButtonElement>("btnClearSelection").disabled = true;
    refreshUI("selection cleared");
  };

  el<HTMLButtonElement>("btnSaveSelection").onclick = () => {
    setLast("clicked: save selection");
    if (!selection) return refreshUI("no selection");

    if (mode === "inv") {
      tracker.setInventoryRegion(selection);
      fillRectInputs("inv", selection);
      refreshUI("saved inv region");
    } else {
      tracker.setMoneyRegion(selection);
      fillRectInputs("mon", selection);
      refreshUI("saved money region");
    }
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
    if (res.error || !res.img) return refreshUI(`inv preview: ${res.error}`);

    drawImageData(cnvInv, res.img);
    refreshUI("inv preview ok");
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
    if (res.error || !res.img) return refreshUI(`money preview: ${res.error}`);

    drawImageData(cnvMoney, res.img);
    refreshUI("money preview ok");
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
    state.sessions = [];
    state.iconNames = {};
    tracker.reset();
    state.settings.invRegion = null as any;
    state.settings.moneyRegion = null as any;
    refreshUI("cleared");
  };

  tracker.onUpdate(() => refreshUI());
  refreshUI("boot ok");
});