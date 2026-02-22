import { AppState, LootEntry, Session } from "./storage";

export function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function renderLootTable(
  loot: LootEntry[],
  _state: AppState,
  getIcon?: (key: string) => ImageData | null
) {
  const body = document.getElementById("lootRows");
  if (!body) return;
  body.innerHTML = "";

  for (const entry of loot) {
    const tr = document.createElement("tr");

    // icon cell (canvas)
    const tdIcon = document.createElement("td");
    tdIcon.style.width = "42px";

    const cnv = document.createElement("canvas");
    cnv.width = 32;
    cnv.height = 32;
    cnv.style.width = "32px";
    cnv.style.height = "32px";
    cnv.style.borderRadius = "6px";
    cnv.style.border = "1px solid #222635";
    cnv.style.background = "#0b0c10";
    cnv.style.imageRendering = "pixelated";
    tdIcon.appendChild(cnv);

    const img = getIcon ? getIcon(entry.key) : null;
    if (img) {
      try {
        cnv.width = img.width;
        cnv.height = img.height;
        const ctx = cnv.getContext("2d");
        if (ctx) ctx.putImageData(img, 0, 0);
      } catch {
        // ignore draw errors
      }
    }

    // name cell
    const tdName = document.createElement("td");
    tdName.textContent = entry.name;

    // qty cell
    const tdQty = document.createElement("td");
    tdQty.textContent = String(entry.qty);
    tdQty.style.textAlign = "right";

    tr.appendChild(tdIcon);
    tr.appendChild(tdName);
    tr.appendChild(tdQty);

    body.appendChild(tr);
  }
}

export function renderSessionTable(sessions: Session[]) {
  const body = document.getElementById("sessionRows");
  if (!body) return;
  body.innerHTML = "";

  for (const s of sessions) {
    const tr = document.createElement("tr");

    const tdWhen = document.createElement("td");
    tdWhen.textContent = new Date(s.startedAt).toLocaleString();

    const tdLabel = document.createElement("td");
    tdLabel.textContent = s.label;

    const tdCount = document.createElement("td");
    tdCount.style.textAlign = "right";
    tdCount.textContent = String(s.loot?.length ?? 0);

    tr.appendChild(tdWhen);
    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);

    body.appendChild(tr);
  }
}