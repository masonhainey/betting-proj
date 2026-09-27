// Runs hedgehog ratings in the app: loads last season + this season from the scoreboard
// (cached on this device, then topped up), fits the ratings, and grades the model with a
// week-by-week replay. Everything else asks `gameView(g)` for the model's numbers.

import { load, save } from "../store.js";
import { NS, src } from "../state.js";
import { ymd } from "../espn.js";
import { fitRatings, predict } from "./ratings.js";
import { backtest, combine } from "./backtest.js";
import { view, WEIGHT } from "./edge.js";

export const M = { cfb: null, nfl: null }; // sport → { model, card, weight, at }
const busy = {};
const listeners = new Set();
export const onModel = (fn) => listeners.add(fn);

// Season windows (month is 0-based): college late Aug → Jan, NFL early Sep → Feb.
const SEASON = { cfb: { from: [7, 20], to: [0, 25] }, nfl: { from: [8, 1], to: [1, 15] } };
export const seasonYear = (d = new Date()) => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
function seasonWindow(sport, year) {
  const s = SEASON[sport];
  return { start: new Date(year, s.from[0], s.from[1]), end: new Date(year + 1, s.to[0], s.to[1]) };
}

const compact = (g) => ({
  id: g.id, d: g.date, h: g.home.id, a: g.away.id, hs: g.home.score, as: g.away.score, n: !!g.neutral,
  ...(g.odds?.spread?.home?.line != null ? { sp: g.odds.spread.home.line } : {}),
  ...(g.odds?.total?.line != null ? { tot: g.odds.total.line } : {}),
});

const WEEK = 7 * 864e5;
const ranges = { ok: 0, fail: 0, broken: false }; // does ESPN accept week-long date ranges?
let lastError = "";
const progress = {}; // sport → { done, total }
export const modelProgress = (sport) => progress[sport];

/** Run jobs a few at a time (ESPN doesn't like 50 big requests at once). */
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

/**
 * One season's finished games. Fetched a week at a time, three weeks in parallel, and saved
 * after every week, so a slow connection or a failed week never loses what already loaded.
 * Recent weeks of the current season are refreshed (scores and closing lines settle).
 */
async function season(sport, year, current) {
  const key = `${NS}model.${sport}.${year}`;
  const c = load(key, null) || { games: [], done: [] };
  c.done ||= [];
  if (c.complete) return { games: c.games, failed: 0 };
  const { start, end } = seasonWindow(sport, year);
  const today = new Date();
  const last = Math.min(end.getTime(), today.getTime());
  const recent = today.getTime() - 10 * 864e5;
  const weeks = [];
  for (let t = start.getTime(); t <= last; t += WEEK) weeks.push(t);
  const fresh = current && Date.now() - (c.at || 0) < 6 * 3600e3;
  const todo = weeks.filter((t) => !c.done.includes(ymd(new Date(t))) && !(fresh && t + WEEK > recent));
  const byId = new Map(c.games.map((g) => [g.id, g]));
  let failed = 0;
  const p = (progress[sport] ||= { done: 0, total: 0 });
  p.total += todo.length;
  const persist = () => {
    try {
      save(key, { games: [...byId.values()], done: c.done, at: Date.now(), complete: !current && today > end && c.done.length >= weeks.length });
    } catch {} // storage full: still works this session
  };
  const keep = (got) => {
    for (const g of got) if (g.state === "post" && g.completed && Number.isFinite(g.home.score)) byId.set(g.id, compact(g));
  };
  await pool(todo, 3, async (t) => {
    const a = new Date(t), b = new Date(Math.min(t + 6 * 864e5, last));
    let ok = false;
    // A whole week in one request when ESPN allows it; otherwise one request per day
    // (the same fallback the Upcoming tab uses).
    if (!ranges.broken) {
      try {
        keep(await src().fetchScoreboard(`${ymd(a)}-${ymd(b)}`, { sport, timeout: 30000 }));
        ok = true;
        ranges.ok++;
      } catch (e) {
        lastError = e.message || String(e);
        if (++ranges.fail >= 2 && !ranges.ok) ranges.broken = true;
      }
    }
    if (!ok) {
      ok = true;
      for (let d = new Date(a); d <= b; d = new Date(d.getTime() + 864e5)) {
        try {
          keep(await src().fetchScoreboard(ymd(d), { sport, timeout: 20000 }));
        } catch (e) {
          ok = false;
          lastError = e.message || String(e);
        }
      }
    }
    if (ok && b.getTime() < recent) c.done.push(ymd(a));
    if (!ok) failed++;
    persist();
    p.done++;
    for (const fn of listeners) fn(sport, "progress");
  });
  if (current) persist();
  return { games: [...byId.values()], failed };
}

/** Load (or refresh) the model for a league. Cheap to call often. */
export async function ensureModel(sport) {
  if (busy[sport] || (M[sport] && Date.now() - M[sport].at < 3 * 3600e3)) return M[sport];
  busy[sport] = true;
  try {
    const y = seasonYear();
    progress[sport] = { done: 0, total: 0 };
    // This season first (it's what the board needs), then last season (the starting point).
    const now = await season(sport, y, true);
    const before = await season(sport, y - 1, false);
    const cur = now.games, prev = before.games;
    if (!cur.length && !prev.length) throw new Error(now.failed + before.failed ? `ESPN didn't send past games (${lastError || "no response"}). Retrying shortly` : "No past games found");
    const prevEnd = seasonWindow(sport, y - 1).end;
    const prior = prev.length ? fitRatings(prev, { sport, asOf: prevEnd }) : {};
    const model = fitRatings(cur, { sport, asOf: Date.now(), prior });
    // Report card: cached for the day (it replays every week of two seasons).
    const cardKey = `${NS}model.card.${sport}`;
    let cards = load(cardKey, null);
    const stamp = `${y}-${cur.length}-${prev.length}-${Math.floor(Date.now() / 864e5)}`;
    if (!cards || cards.stamp !== stamp) {
      const last = prev.length ? backtest(prev, { sport, skipWeeks: 3 }) : null;
      const now = cur.length ? backtest(cur, { sport, prior }) : null;
      cards = { stamp, last, now, all: combine([last, now].filter(Boolean)) };
      try { save(cardKey, cards); } catch {}
    }
    const best = cards.all?.bestWeight;
    const weight = best == null ? WEIGHT : Math.min(0.6, Math.max(0.1, best));
    const partial = now.failed + before.failed > 0;
    // Missing weeks: use what loaded now, and try the rest again in a few minutes.
    M[sport] = { model, cards, weight, at: partial ? Date.now() - 3 * 3600e3 + 5 * 60e3 : Date.now(), games: { prev: prev.length, cur: cur.length }, partial };
    for (const fn of listeners) fn(sport);
  } catch (e) {
    M[sport] = { error: e.message || "Couldn't load past games", at: Date.now() - 3 * 3600e3 + 2 * 60e3 }; // retry in ~2 min
  } finally {
    busy[sport] = false;
  }
  return M[sport];
}

export const modelLoading = (sport) => !!busy[sport];

/** Forget a failed attempt and start again now. */
export function retryModel(sport) {
  if (M[sport]?.error) M[sport] = null;
  return ensureModel(sport);
}

/** The model's blended view of a game, or null if it has no opinion yet. */
export function gameView(g) {
  const m = M[g?.sport || "cfb"];
  if (!m?.model) return null;
  return view(predict(m.model, g.home.id, g.away.id, g.neutral), g.odds, m.weight);
}

/** Is the model's record good enough to call its edges "value"? */
export const trusted = (sport) => !!M[sport]?.cards?.all?.trusted;

