import { AppState, LootEntry, Session } from "./storage";

export function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function renderLootTable(entries: LootEntry[], state: AppState) {
  const tbody = document.getElementById("lootRows") as HTMLTableSectionElement;
  tbody.innerHTML = "";

  for (const e of entries) {
    const tr = document.createElement("tr");
    tr.dataset.sig = e.iconSig ?? "";

    const tdIcon = document.createElement("td");
    if (e.iconSig) {
      const img = document.createElement("img");
      img.className = "loot-icon";
      img.alt = e.name;
      img.dataset.sig = e.iconSig;
      // src is filled by wireClickRename() once we can ask tracker for data URLs
      tdIcon.appendChild(img);
    } else {
      tdIcon.textContent = "—";
    }

    const tdName = document.createElement("td");
    tdName.textContent = e.name;

    const tdQty = document.createElement("td");
    tdQty.className = "right";
    tdQty.textContent = e.qty.toLocaleString();

    tr.appendChild(tdIcon);
    tr.appendChild(tdName);
    tr.appendChild(tdQty);
    tbody.appendChild(tr);
  }
}

export function renderSessionTable(sessions: Session[]) {
  const tbody = document.getElementById("sessionRows") as HTMLTableSectionElement;
  tbody.innerHTML = "";

  for (const s of sessions.slice(0, 20)) {
    const tr = document.createElement("tr");

    const tdWhen = document.createElement("td");
    tdWhen.textContent = new Date(s.startedAt).toLocaleString();

    const tdLabel = document.createElement("td");
    tdLabel.textContent = s.label;

    const tdCount = document.createElement("td");
    tdCount.className = "right";
    tdCount.textContent = String(s.loot.length);

    tr.appendChild(tdWhen);
    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  }
}

/**
 * Allows clicking an inventory-based loot row to name it once.
 * Also fills in icon <img src> from tracker callback.
 */
export function wireClickRename(state: AppState, getIconUrl: (sig: string) => string | null) {
  // Fill icons
  document.querySelectorAll<HTMLImageElement>("img.loot-icon").forEach((img) => {
    const sig = img.dataset.sig;
    if (!sig) return;
    const url = getIconUrl(sig);
    if (url) img.src = url;
  });

  // Click to rename
  const tbody = document.getElementById("lootRows");
  if (!tbody) return;

  tbody.onclick = (ev) => {
    const tr = (ev.target as HTMLElement).closest("tr");
    if (!tr) return;
    const sig = tr.dataset.sig;
    if (!sig) return;

    const existing = state.iconNames[sig] ?? "";
    const name = prompt("Name this item (stored locally):", existing);
    if (!name) return;
    state.iconNames[sig] = name.trim();
  };
}
