import { test } from "node:test";
import assert from "node:assert/strict";
import { ghostReport, parlayAutopsy, asStraights, playOrder, bustedLegs, marketName, realBets } from "../js/autopsy.js";
import { summarize } from "../js/grade.js";

const L = (status, extra = {}) => ({ id: Math.random().toString(36).slice(2), status, odds: 2, pick: "Team -3", market: "spread", ...extra });
const bet = (legs, extra = {}) => ({ id: Math.random().toString(36).slice(2), stake: 10, createdAt: "2026-09-20T12:00:00Z", settledAt: "2026-09-20T20:00:00Z", legs, ...extra });

test("ghosts stay out of real P/L", () => {
  const bets = [bet([L("won")]), bet([L("won")], { ghost: true }), bet([L("lost")], { ghost: true })];
  assert.equal(summarize(realBets(bets)).profit, 10);
  const r = ghostReport(bets);
  assert.equal(r.ghosts.w, 1);
  assert.equal(r.ghosts.l, 1);
  assert.equal(r.dodged, 10, "stake of the pass that lost");
  assert.equal(r.missed, 10, "profit of the pass that won");
  assert.equal(r.real.count, 1);
  assert.equal(r.verdict, null, "needs 3+ settled on each side");
});

test("ghost verdict compares ROI", () => {
  const real = [bet([L("lost")]), bet([L("lost")]), bet([L("won")])]; // -10 on 30
  const ghosts = [1, 2, 3].map(() => bet([L("won")], { ghost: true })); // +30 on 30
  const r = ghostReport([...real, ...ghosts]);
  assert.equal(r.verdict.tone, "warn");
  const r2 = ghostReport([...ghosts.map((g) => ({ ...g, ghost: false })), ...real.map((b) => ({ ...b, ghost: true }))]);
  assert.equal(r2.verdict.tone, "good");
});

test("as straights: stake split evenly across legs", () => {
  // $10 on 2 legs at 2.0: one won (+5), one lost (-5) → 0
  assert.equal(asStraights(bet([L("won"), L("lost")])), 0);
  // 3 legs, 2 won at 2.0, 1 lost: +3.33 +3.33 -3.33
  assert.ok(Math.abs(asStraights(bet([L("won"), L("won"), L("lost")])) - 10 / 3) < 1e-9);
  // push leg contributes nothing
  assert.equal(asStraights(bet([L("won"), L("push")])), 5);
});

test("play order uses kickoff, falls back to entry order", () => {
  const b = bet([L("won", { pick: "late", kickoff: "2026-09-20T23:00:00Z" }), L("lost", { pick: "early", kickoff: "2026-09-20T16:00:00Z" })]);
  assert.deepEqual(playOrder(b).map((l) => l.pick), ["early", "late"]);
  assert.deepEqual(bustedLegs(b).map((l) => l.pick), ["early"]);
});

test("parlay autopsy", () => {
  const parlays = [
    bet([L("won"), L("won"), L("lost", { market: "total", pick: "Over 50" })]), // one away, last leg
    bet([L("won"), L("lost", { market: "total", pick: "Over 48" }), L("won")]), // one away, middle
    bet([L("lost"), L("lost", { market: "total", pick: "Under 44" })]), // two busted
    bet([L("won"), L("won")]), // cashed, 2-leg at 4.0 → +30
    bet([L("won")]), // straight: ignored
    bet([L("won"), L("lost")], { cashout: 12 }), // cashed out: ignored
  ];
  const a = parlayAutopsy(parlays);
  assert.equal(a.count, 4);
  assert.equal(a.won, 1);
  assert.equal(a.lost, 3);
  assert.equal(a.oneAway, 2);
  assert.equal(a.oneAwayPayout, 80 + 80, "two 3-leg tickets at 8.0 on $10");
  assert.equal(a.lastLegBusts, 1);
  assert.equal(a.position.Last, 1);
  assert.equal(a.position["1st"], 1);
  assert.equal(a.position["2nd"], 1);
  const total = a.markets.find((m) => m.market === "Total");
  assert.equal(total.legs, 3);
  assert.equal(total.missRate, 1);
  assert.equal(a.killer.market, "Total");
  assert.equal(a.parlayProfit, -30 + 30);
  const two = a.sizes.find((s) => s.size === "2");
  assert.equal(two.count, 2);
  assert.equal(two.hitRate, 0.5);
  assert.equal(two.impliedRate, 0.25);
});

test("market names from linked markets or pick text", () => {
  assert.equal(marketName({ market: "ml" }), "Moneyline");
  assert.equal(marketName({ pick: "Texas ML" }), "Moneyline");
  assert.equal(marketName({ pick: "Over 52.5" }), "Total");
  assert.equal(marketName({ pick: "Georgia -7.5" }), "Spread");
  assert.equal(marketName({ pick: "Heisman: Arch Manning" }), "Props & futures");
});
