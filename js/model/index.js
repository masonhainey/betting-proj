// Runs hedgehog ratings in the app: loads last season + this season from the scoreboard
// (cached on this device, then topped up), fits the ratings, and grades the model with a
// week-by-week replay. Everything else asks `gameView(g)` for the model's numbers.

import { load, save } from "../store.js";
import { NS, src } from "../state.js";
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

/** One season's finished games, from cache when possible. */
async function season(sport, year, current) {
  const key = `${NS}model.${sport}.${year}`;
  const c = load(key, null);
  if (c?.complete) return c.games;
  if (c && current && Date.now() - (c.at || 0) < 6 * 3600e3) return c.games;
  const { start, end } = seasonWindow(sport, year);
  const today = new Date();
  const from = c?.through ? new Date(Math.max(start, Date.parse(c.through) - 3 * 864e5)) : start;
  const to = new Date(Math.min(end, today));
  let games = c?.games || [];
  if (from < to) {
    const days = Math.ceil((to - from) / 864e5) + 1;
    const { games: got } = await src().fetchRange(from, days, { sport });
    const byId = new Map(games.map((g) => [g.id, g]));
    for (const g of got) if (g.state === "post" && g.completed && Number.isFinite(g.home.score)) byId.set(g.id, compact(g));
    games = [...byId.values()];
  }
  try {
    save(key, { games, through: to.toISOString(), at: Date.now(), complete: !current && today > end });
  } catch {} // storage full: works this session, refetches next time
  return games;
}

/** Load (or refresh) the model for a league. Cheap to call often. */
export async function ensureModel(sport) {
  if (busy[sport] || (M[sport] && Date.now() - M[sport].at < 3 * 3600e3)) return M[sport];
  busy[sport] = true;
  try {
    const y = seasonYear();
    const [prev, cur] = await Promise.all([season(sport, y - 1, false), season(sport, y, true)]);
    const prevEnd = seasonWindow(sport, y - 1).end;
    const prior = prev.length ? fitRatings(prev, { sport, asOf: prevEnd }) : {};
    const model = fitRatings(cur, { sport, asOf: Date.now(), prior });
    // Report card: cached for the day (it replays every week of two seasons).
    const cardKey = `${NS}model.card.${sport}`;
    let cards = load(cardKey, null);
    const stamp = `${y}-${cur.length}-${prev.length}`;
    if (!cards || cards.stamp !== stamp) {
      const last = prev.length ? backtest(prev, { sport, skipWeeks: 3 }) : null;
      const now = cur.length ? backtest(cur, { sport, prior }) : null;
      cards = { stamp, last, now, all: combine([last, now].filter(Boolean)) };
      try { save(cardKey, cards); } catch {}
    }
    const best = cards.all?.bestWeight;
    const weight = best == null ? WEIGHT : Math.min(0.6, Math.max(0.1, best));
    M[sport] = { model, cards, weight, at: Date.now(), games: { prev: prev.length, cur: cur.length } };
    for (const fn of listeners) fn(sport);
  } catch (e) {
    M[sport] = { error: e.message || "Couldn't load past games", at: Date.now() - 2.5 * 3600e3 }; // retry in ~30 min
  } finally {
    busy[sport] = false;
  }
  return M[sport];
}

export const modelLoading = (sport) => !!busy[sport];

/** The model's blended view of a game, or null if it has no opinion yet. */
export function gameView(g) {
  const m = M[g?.sport || "cfb"];
  if (!m?.model) return null;
  return view(predict(m.model, g.home.id, g.away.id, g.neutral), g.odds, m.weight);
}

/** Is the model's record good enough to call its edges "value"? */
export const trusted = (sport) => !!M[sport]?.cards?.all?.trusted;

