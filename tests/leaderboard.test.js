import { test } from "node:test";
import assert from "node:assert/strict";
import { periodStarts, computeStats, publishPicks, rankRows } from "../js/leaderboard.js";
import { decodeShare, toB64url } from "../js/share.js";

const L = (status, odds = 2) => ({ id: Math.random().toString(36).slice(2), pick: "Team -3", odds, status });
const bet = (status, settledAt, extra = {}) => ({ id: Math.random().toString(36).slice(2), stake: 20, createdAt: settledAt, settledAt, legs: [L(status)], ...extra });

test("period boundaries: Monday weeks, calendar months, season from Aug 1", () => {
  const now = new Date(2026, 8, 26, 15); // Sat Sep 26 2026
  const s = periodStarts(now);
  assert.equal(s.week.getDay(), 1);
  assert.equal(s.week.getDate(), 21);
  assert.equal(s.month.getDate(), 1);
  assert.equal(s.month.getMonth(), 8);
  assert.equal(s.season.getMonth(), 7);
  assert.equal(s.season.getFullYear(), 2026);
  assert.equal(periodStarts(new Date(2027, 0, 5)).season.getFullYear(), 2026, "January is still last season");
  assert.equal(periodStarts(new Date(2026, 8, 21, 0, 30)).week.getDate(), 21, "Monday itself");
});

test("stats: real bets only, profit in units", () => {
  const now = new Date(2026, 8, 26, 15);
  const bets = [
    bet("won", new Date(2026, 8, 25).toISOString()), // this week  +20
    bet("lost", new Date(2026, 8, 22).toISOString()), // this week  -20
    bet("won", new Date(2026, 8, 10).toISOString()), // this month +20
    bet("won", new Date(2026, 7, 15).toISOString()), // season     +20
    bet("won", new Date(2026, 8, 25).toISOString(), { ghost: true }), // never counts
    bet("open", new Date(2026, 8, 26).toISOString()),
  ];
  const s = computeStats(bets, { unit: 10, now });
  assert.deepEqual(s.periods.week, { w: 1, l: 1, p: 0, n: 2, units: 0, roi: 0 });
  assert.equal(s.periods.month.units, 2);
  assert.equal(s.periods.season.n, 4);
  assert.equal(s.periods.season.units, 4);
  assert.equal(s.open, 1);
  assert.equal(computeStats(bets, { unit: 20, now }).periods.season.units, 2, "bigger unit → fewer units");
});

test("published picks carry no stakes and decode like share links", () => {
  const bets = [bet("open", "2026-09-26T12:00:00Z", { ticketPayout: 99 }), bet("won", "2026-09-25T12:00:00Z"), bet("open", "2026-09-26T13:00:00Z", { ghost: true })];
  const p = publishPicks(bets, { name: "Mason" });
  assert.equal(p.open.length, 1, "ghosts aren't published");
  assert.equal(p.recent.length, 1);
  assert.equal(p.open[0].s, undefined);
  assert.equal(p.open[0].p, undefined);
  const t = decodeShare(toB64url(JSON.stringify(p.open[0])));
  assert.equal(t.from, "Mason");
  assert.equal(t.stake, undefined);
});

test("ranking", () => {
  const members = [{ user_id: "a", display_name: "Ann" }, { user_id: "b", display_name: "Bo" }, { user_id: "c", display_name: "Cy" }, { user_id: "d", display_name: "Di" }];
  const stats = {
    a: { periods: { week: { w: 2, l: 1, p: 0, n: 3, units: 1.5, roi: 0.1 } }, streak: "W2" },
    b: { periods: { week: { w: 1, l: 0, p: 0, n: 1, units: 3.2, roi: 0.9 } }, streak: "W1" },
    c: { periods: { week: { w: 0, l: 0, p: 0, n: 0, units: 0, roi: null } } },
    // d never published
  };
  assert.deepEqual(rankRows(members, stats, "week").map((r) => [r.display_name, r.rank]), [["Bo", 1], ["Ann", 2], ["Cy", null], ["Di", null]]);
  assert.deepEqual(rankRows(members, stats, "week", "roi").map((r) => r.display_name).slice(0, 2), ["Ann", "Bo"], "ROI needs 3+ bets");
  assert.equal(rankRows(members, stats, "week", "record")[0].display_name, "Ann");
  const tie = rankRows(members, { a: stats.b, b: stats.b }, "week");
  assert.deepEqual(tie.slice(0, 2).map((r) => r.rank), [1, 1], "ties share a rank");
});
