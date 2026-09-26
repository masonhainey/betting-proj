// What the widget shows, worked out from your bets and ESPN games. Pure — no Scriptable
// APIs here — so it runs (and is tested) in Node exactly as it does on the phone.

import { betStatus, betProfit, gradeLeg, legLabel, legLive, potentialPayout, ticketDecimal } from "../../js/grade.js";
import { formatOdds, fmtMoney } from "../../js/odds.js";
import { etDay } from "../../js/espn.js";

const MIN = 60e3;
const LOOKBACK_DAYS = 2;
const LOOKAHEAD_DAYS = 8;

export { etDay };

/** Real (not ghost) bets that still have a leg in play, plus ones that may have settled today. */
const inPlay = (bets) => bets.filter((b) => !b.ghost && Array.isArray(b.legs) && b.legs.length);

/**
 * Scoreboards to fetch, as "league|day" keys ("nfl|20260927"): today plus the days of recent
 * and upcoming open legs, for each league you have action in.
 */
export function daysToFetch(bets, now = new Date()) {
  const t = now.getTime();
  const days = new Set();
  const leagues = new Set();
  for (const b of inPlay(bets)) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      const k = Date.parse(l.kickoff);
      if (l.status !== "open" || !l.gameId || !Number.isFinite(k)) continue;
      const sp = l.sport === "nfl" ? "nfl" : "cfb";
      leagues.add(sp);
      if (k >= t - LOOKBACK_DAYS * 864e5 && k <= t + LOOKAHEAD_DAYS * 864e5) days.add(`${sp}|${etDay(k)}`);
    }
  }
  if (!leagues.size) leagues.add("cfb");
  for (const sp of leagues) days.add(`${sp}|${etDay(t)}`);
  return [...days].sort((a, b) => a.slice(-8).localeCompare(b.slice(-8)) || a.localeCompare(b)).slice(0, 8);
}

/** Kickoff time the way a widget has room for: "3:30 PM" today, "Sat 3:30 PM" otherwise. */
export function kickText(date, now = new Date()) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = (d - now) / 864e5;
  if (days > 0 && days < 6) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${time}`;
}

/** Game clock short enough for a widget: "Q3 2:10", "Half", "OT". */
export function clockText(g) {
  if (!g) return "";
  if (g.state !== "in") return g.shortDetail || "";
  if (/half/i.test(g.shortDetail || "")) return "Half";
  if (/end/i.test(g.shortDetail || "")) return g.shortDetail;
  const q = g.period > 4 ? (g.period === 5 ? "OT" : `${g.period - 4}OT`) : g.period ? `Q${g.period}` : "";
  return [q, g.period > 4 ? "" : g.clock].filter(Boolean).join(" ") || g.shortDetail || "Live";
}

// Worst news first: a losing leg sinks the ticket, anything live beats waiting.
const RANK = { losing: 0, even: 1, live: 2, winning: 3, pending: 4 };

/** Grade open legs against finals in memory (the app does the real grading when it opens). */
function graded(bet, game) {
  const clone = { ...bet, legs: bet.legs.map((l) => ({ ...l })) };
  let last = 0;
  for (const l of clone.legs) {
    if (l.status !== "open" || !l.gameId || bet.cashout != null) continue;
    const g = game(l.gameId);
    const grade = gradeLeg(l, g);
    if (grade) {
      l.status = grade;
      last = Math.max(last, Date.parse(g.date) || 0);
    }
  }
  if (!clone.settledAt && betStatus(clone) !== "open" && last) clone.settledAt = new Date(last).toISOString();
  return clone;
}

function row(bet, game, now) {
  const legs = bet.legs.map((l) => ({ l, g: l.gameId ? game(l.gameId) : null }));
  const views = legs.map(({ l, g }) => ({ l, g, v: legLive(l, g) }));
  const open = views.filter((x) => x.l.status === "open");
  const done = views.length - open.length;
  const worst = [...open].sort((a, b) => RANK[a.v.state] - RANK[b.v.state])[0];
  const state = !worst ? "pending" : worst.v.state;
  const live = open.some((x) => x.g?.state === "in");
  const kicks = open.map((x) => Date.parse(x.g?.date || x.l.kickoff)).filter((k) => Number.isFinite(k) && k > now.getTime());
  const nextKick = kicks.length ? Math.min(...kicks) : null;

  const parlay = bet.legs.length > 1;
  const title = parlay ? `${bet.legs.length}-leg parlay` : legLabel(bet.legs[0], legs[0].g);
  const about = (x) => {
    if (!x) return "";
    if (x.g?.state === "in") return [clockText(x.g), x.v.text].filter(Boolean).join(" · ");
    if (x.g?.state === "post") return x.g.shortDetail || "Final";
    const when = kickText(x.g?.date || x.l.kickoff, now);
    const who = x.g?.shortName || x.l.gameLabel || "";
    return [who, when].filter(Boolean).join(" · ");
  };
  let sub;
  if (!parlay) sub = about(worst || views[0]);
  else {
    const focus = open.find((x) => x.v.state === "losing") || open.find((x) => x.g?.state === "in") || [...open].sort((a, b) => (Date.parse(a.g?.date || a.l.kickoff) || Infinity) - (Date.parse(b.g?.date || b.l.kickoff) || Infinity))[0];
    const lead = `${done}/${bet.legs.length} in`;
    sub = focus ? `${lead} · ${legLabel(focus.l, focus.g)} ${about(focus)}`.trim() : lead;
  }
  return {
    id: bet.id,
    title,
    sub,
    state,
    live,
    nextKick,
    pays: fmtMoney(potentialPayout(bet), { cents: potentialPayout(bet) < 1000 }),
    odds: formatOdds(ticketDecimal(bet)),
    legs: views.map(({ l, g, v }) => ({ label: legLabel(l, g), state: l.status === "open" ? v.state : l.status })),
  };
}

/**
 * Everything a widget size needs.
 * bets: hedgehog bet objects (as synced). games: Map or object of gameId → normalized ESPN game.
 */
export function buildModel(bets, games, now = new Date()) {
  const game = (id) => (games instanceof Map ? games.get(String(id)) : games[String(id)]) || null;
  const today = etDay(now);
  const all = inPlay(bets).map((b) => graded(b, game));
  const open = all.filter((b) => betStatus(b) === "open");
  const settledToday = all.filter((b) => betStatus(b) !== "open" && b.settledAt && etDay(b.settledAt) === today);

  const rows = open.map((b) => row(b, game, now)).sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.live) return RANK[a.state] - RANK[b.state];
    return (a.nextKick ?? Infinity) - (b.nextKick ?? Infinity);
  });

  const profit = settledToday.reduce((s, b) => s + betProfit(b), 0);
  const w = settledToday.filter((b) => betProfit(b) > 0).length;
  const l = settledToday.filter((b) => betProfit(b) < 0).length;
  const count = (st) => rows.filter((r) => r.live && r.state === st).length;
  const live = rows.filter((r) => r.live).length;
  const kicks = rows.map((r) => r.nextKick).filter(Boolean);
  const nextKick = kicks.length ? Math.min(...kicks) : null;

  // Refresh: every 5 minutes with games on, else in time for the next kickoff (at most an hour).
  const t = now.getTime();
  const refreshAt = live ? t + 5 * MIN : Math.max(t + 5 * MIN, Math.min(nextKick ?? Infinity, t + 60 * MIN));

  return {
    rows,
    open: rows.length,
    live,
    winning: count("winning"),
    losing: count("losing"),
    atRisk: open.reduce((s, b) => s + (b.stake || 0), 0),
    toWin: open.reduce((s, b) => s + potentialPayout(b), 0),
    today: { profit, w, l, settled: settledToday.length, text: settledToday.length ? fmtMoney(profit, { sign: true }) : "" },
    nextKick,
    nextKickText: nextKick ? kickText(nextKick, now) : "",
    refreshAt,
    updated: t,
  };
}
