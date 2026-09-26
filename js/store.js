// localStorage persistence. Every read/write is guarded — private windows and blocked
// storage fall back to in-memory so the app still works for the session.

const mem = new Map();
const P = "lw.";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(P + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

export function save(key, value) {
  mem.set(key, value);
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
  } catch {
    /* quota or disabled: keep in memory */
  }
}

export function remove(key) {
  mem.delete(key);
  try {
    localStorage.removeItem(P + key);
  } catch {}
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const DEFAULT_SETTINGS = {
  oddsFormat: "american",
  unit: 10,
  bankroll: 500,
  autoAccept: false,
  demo: false,
  top25Only: false,
  sport: "cfb",
};
