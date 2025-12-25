type Status = "idle" | "syncing" | "error";

let state: {
  status: Status;
  lastSyncedAt: number | null; // epoch seconds
  error?: string | null;
} = {
  status: "idle",
  lastSyncedAt: null,
  error: null,
};

type Listener = (s: typeof state) => void;
const listeners = new Set<Listener>();

export function getSyncState() {
  return { ...state };
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  // Phát ra trạng thái ban đầu
  fn(getSyncState());
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getSyncState();
  for (const l of listeners) l(snapshot);
}

export function setStatus(status: Status, err?: string | null) {
  state.status = status;
  state.error = err ?? null;
  emit();
}

export function setLastSynced(atSec: number | null) {
  state.lastSyncedAt = atSec;
  if (!state.error && state.status !== "syncing") state.status = "idle";
  emit();
}

export default {
  getSyncState,
  subscribe,
  setStatus,
  setLastSynced,
};
