// What each member publishes to their groups, and how the leaderboard ranks it.
// Pure functions (unit-tested). Only real bets count; ghosts never do.

import { betStatus, summarize } from "./grade.js";
import { realBets } from "./autopsy.js";
import { makePayload } from "./share.js";

export const PERIODS = { week: "This week", month: "This month", season: "Season" };

/** Start of each leaderboard period, in local time. Weeks start Monday; the season starts Aug 1. */
export function periodStarts(now = new Date()) {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const month = new Date(d.getFullYear(), d.getMonth(), 1);
  const season = new Date(d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1, 7, 1);
  return { week, month, season };
}

const r2 = (n) => Math.round(n * 100) / 100;

/** The stats blob a member publishes. Profit is also expressed in units so bankrolls compare fairly. */
export function computeStats(bets, { unit = 10, now = new Date() } = {}) {
  const real = realBets(bets);
  const u = unit > 0 ? unit : 10;
  const starts = periodStarts(now);
  const periods = {};
  for (const [k, since] of Object.entries(starts)) {
    const s = summarize(real, { since });
    periods[k] = { w: s.w, l: s.l, p: s.p, n: s.count, units: r2(s.profit / u), roi: Number.isFinite(s.roi) ? Math.round(s.roi * 1000) / 1000 : null };
  }
  const all = summarize(real);
  return { v: 1, periods, streak: all.streak, open: all.openCount, updatedAt: now.toISOString() };
}

/** Open picks (and a few recent results) in share-link format, so friends can tail them. Never stakes. */
export function publishPicks(bets, { name = "", openLimit = 8, recentLimit = 5 } = {}) {
  const real = realBets(bets);
  const byNew = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const open = real.filter((b) => betStatus(b) === "open").sort(byNew).slice(0, openLimit);
  const recent = real
    .filter((b) => ["won", "lost", "push"].includes(betStatus(b)))
    .sort((a, b) => Date.parse(b.settledAt || b.createdAt) - Date.parse(a.settledAt || a.createdAt))
    .slice(0, recentLimit);
  const pack = (b) => makePayload(b, { name, includeStake: false });
  return { open: open.map(pack), recent: recent.map(pack) };
}

/**
 * Leaderboard rows for one period. sort: "units" (default), "roi" (needs 3+ settled to
 * rank), or "record" (wins minus losses). Members with no bets in the period sink.
 */
export function rankRows(members, statsByUser, period = "week", sort = "units") {
  const rows = members.map((m) => {
    const st = statsByUser[m.user_id];
    const s = st?.periods?.[period] || null;
    return { ...m, s, streak: st?.streak || "—", open: st?.open || 0, updatedAt: st?.updatedAt || null };
  });
  const key = (r) => {
    if (!r.s || !r.s.n) return -Infinity;
    if (sort === "roi") return r.s.n >= 3 && r.s.roi != null ? r.s.roi : -1e9 + r.s.n;
    if (sort === "record") return r.s.w - r.s.l + r.s.w / 1000;
    return r.s.units;
  };
  rows.sort((a, b) => key(b) - key(a) || (b.s?.n || 0) - (a.s?.n || 0) || a.display_name.localeCompare(b.display_name));
  let rank = 0;
  return rows.map((r, i) => {
    const active = r.s && r.s.n > 0;
    if (active && (i === 0 || key(rows[i - 1]) !== key(r))) rank = i + 1;
    return { ...r, rank: active ? rank : null };
  });
}
