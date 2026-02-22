export type Rect = { x: number; y: number; w: number; h: number };

export type LootEntry = {
  key: string;
  name: string;
  qty: number;
  iconSig: string | null; // only inventory items have a signature icon
};

export type Session = {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  loot: LootEntry[];
};

export type AppState = {
  settings: {
    invRegion: Rect | null;
    moneyRegion: Rect | null;
  };
  iconNames: Record<string, string>;
  sessions: Session[];
  activeSession: Session | null;
};

const KEY = "alt1_loot_tracker_state_v1";

export function loadAppState(): AppState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AppState;
      // light migration defaults
      return {
        settings: {
          invRegion: parsed.settings?.invRegion ?? null,
          moneyRegion: parsed.settings?.moneyRegion ?? null
        },
        iconNames: parsed.iconNames ?? {},
        sessions: parsed.sessions ?? [],
        activeSession: null
      };
    } catch {
      // fallthrough
    }
  }
  return {
    settings: { invRegion: null, moneyRegion: null },
    iconNames: {},
    sessions: [],
    activeSession: null
  };
}

export function saveAppState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify({
    settings: state.settings,
    iconNames: state.iconNames,
    sessions: state.sessions
  }));
}
