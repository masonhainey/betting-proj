// Turns two seasons of results into the model file the app loads (data/model-<sport>.json):
// fitted ratings, the week-by-week report card, and each team's last game and recent form.
// Runs in the GitHub Action (scripts/model-data.mjs) and in demo mode. Pure — unit-tested.

import { fitRatings } from "./ratings.js";
import { backtest, combine } from "./backtest.js";
import { WEIGHT } from "./edge.js";

// Season windows (month is 0-based): college late Aug → Jan, NFL early Sep → Feb.
const SEASON = { cfb: { from: [7, 20], to: [0, 25] }, nfl: { from: [8, 1], to: [1, 15] } };
export const seasonYear = (d = new Date()) => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
export function seasonWindow(sport, year) {
  const s = SEASON[sport] || SEASON.cfb;
  return { start: new Date(Date.UTC(year, s.from[0], s.from[1])), end: new Date(Date.UTC(year + 1, s.to[0], s.to[1])) };
}

/** A finished game, as small as it can be. */
export const compact = (g) => ({
  id: g.id, d: g.date, h: g.home.id, a: g.away.id, hs: g.home.score, as: g.away.score, n: !!g.neutral,
  hn: g.home.short, an: g.away.short,
  ...(g.odds?.spread?.home?.line != null ? { sp: g.odds.spread.home.line } : {}),
  ...(g.odds?.total?.line != null ? { tot: g.odds.total.line } : {}),
});

export const finished = (g) => g.state === "post" && g.completed && Number.isFinite(g.home?.score) && Number.isFinite(g.away?.score);

const r2 = (x) => Math.round(x * 100) / 100;
const round = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r2(v)]));

/** Each team's last game and last five results (newest first). */
export function teamForm(games) {
  const out = {};
  const sorted = [...games].sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
  for (const g of sorted) {
    for (const home of [true, false]) {
      const id = home ? g.h : g.a;
      const t = (out[id] ||= { last: null, form: [] });
      t.last = g.d;
      t.form.unshift({ d: g.d, o: (home ? g.an : g.hn) || "", m: home ? g.hs - g.as : g.as - g.hs, h: home ? 1 : 0 });
      if (t.form.length > 5) t.form.pop();
    }
  }
  return out;
}

const slim = (c) => (c ? { ...c, blend: undefined } : null);

/**
 * cur/prev: compact games from this season and last. Returns the model file.
 */
export function buildModelData(sport, { cur = [], prev = [], season, now = Date.now() } = {}) {
  const prevEnd = seasonWindow(sport, season - 1).end.getTime();
  const prior = prev.length ? fitRatings(prev, { sport, asOf: prevEnd }) : {};
  const m = fitRatings(cur, { sport, asOf: now, prior });
  const last = prev.length ? backtest(prev, { sport, skipWeeks: 3 }) : null;
  const nowCard = cur.length ? backtest(cur, { sport, prior }) : null;
  const all = combine([last, nowCard].filter(Boolean));
  const best = all?.bestWeight;
  const weight = best == null ? WEIGHT : Math.min(0.45, Math.max(0.15, best));
  const form = teamForm(cur.length ? cur : prev);
  return {
    v: 1,
    sport,
    season,
    at: new Date(now).toISOString(),
    games: { prev: prev.length, cur: cur.length },
    model: { sport, r: round(m.r), o: round(m.o), d: round(m.d), mu: r2(m.mu), hfa: r2(m.hfa), n: m.n, asOf: m.asOf, games: m.games },
    cards: { last: slim(last), now: slim(nowCard), all: cur.length || prev.length ? all : null },
    weight,
    teams: form,
  };
}
