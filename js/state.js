// Shared app state, persistence helpers and tiny DOM utilities. No app imports here,
// so it's always evaluated first.

import * as espn from "./espn.js";
import * as demo from "./demo.js";
import { formatOdds } from "./odds.js";
import { load, save, DEFAULT_SETTINGS } from "./store.js";

// ───────────────────────────── state ─────────────────────────────

export const settings = { ...DEFAULT_SETTINGS, ...load("settings", {}) };
// Links like ?demo=1 (the portfolio's "Try it now") open straight into demo mode with made-up bets.
// Demo data lives under its own "demo." keys, so a real logbook on the same device is left alone.
if (new URLSearchParams(location.search).has("demo") && !settings.demo) {
  settings.demo = true;
  save("settings", settings);
}
export const NS = settings.demo ? "demo." : "";
export const TABS = ["bets", "live", "schedule", "build", "friends", "news"];
export const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "ESPN BET", "Fanatics", "bet365", "Hard Rock", "BetRivers", "Bovada", "Other"];

export const S = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "bets",
  bets: load(NS + "bets", []),
  games: new Map(),
  box: {}, // gameId → player box score, for props
  detail: {}, // gameId → { drive, winProb, at } for the open game page
  todayIds: [],
  scheduleIds: [],
  news: [],
  st: { today: {}, schedule: {}, news: {}, betGames: {}, boxes: {} },
  kick: load(NS + "kickoffs", {}),
  lines: load(NS + "lines", {}),
  slip: { mode: "parlay", legs: [], stakes: {}, stake: settings.unit, override: "", boost: "", book: settings.lastBook || "", ...load(NS + "slip", {}) },
  f: { live: "all", q: "", top25: settings.top25Only, hasLine: false, news: "all", period: "all", betsTab: "open", buildDay: "all", buildQ: "" },
  sheet: null,
  form: null,
  sim: false,
  simAdj: {},
  lastPrices: {},
  moves: {},
  confirmDelete: null,
  picks: null, // Coach's picks panel
};

export const src = () => (settings.demo ? demo : espn);
/** The league you're looking at ("cfb" | "nfl"). Bets cover both; the game views follow this. */
export const sport = () => (settings.sport === "nfl" ? "nfl" : "cfb");
export const SP = () => espn.sportOf(sport());
export const game = (id) => S.games.get(id);
export const fmt = () => settings.oddsFormat;
export const odds = (d) => formatOdds(d, fmt());
// Other modules plug in here (account.js schedules a sync after every save).
export const hooks = { afterSave: () => {}, afterSync: () => {} };
export const saveBets = () => {
  save(NS + "bets", S.bets);
  hooks.afterSave();
};
export const saveSlip = () => save(NS + "slip", S.slip);
export const saveSettings = () => {
  save("settings", settings);
  hooks.afterSave();
};
export const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function swap(el, html) {
  if (!el) return;
  const a = document.activeElement;
  const id = a && el.contains(a) ? a.id : null;
  const sel = id && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = scroll;
  if (id) {
    const n = document.getElementById(id);
    if (n) {
      n.focus({ preventScroll: true });
      if (sel) try { n.setSelectionRange(...sel); } catch {}
    }
  }
}
export let toastN = 0;
export function toast(msg, kind = "", big = false) {
  const el = document.createElement("div");
  el.className = `toast ${kind} ${big ? "big" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  if (big && !matchMedia("(prefers-reduced-motion: reduce)").matches) confetti();
  const id = ++toastN;
  setTimeout(() => el.classList.add("out"), 3800 + (id % 3) * 100);
  setTimeout(() => el.remove(), 4400);
}
export function confetti() {
  const box = document.createElement("div");
  box.className = "confetti";
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("i");
    p.style.setProperty("--x", `${Math.random() * 100}vw`);
    p.style.setProperty("--d", `${0.9 + Math.random() * 1.2}s`);
    p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    p.style.setProperty("--h", `${[150, 45, 200, 320][i % 4]}`);
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2600);
}
