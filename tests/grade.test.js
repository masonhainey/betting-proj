import { test } from "node:test";
import assert from "node:assert/strict";
import { betStatus, betProfit, betDecimal, legMargin, gradeLeg, legLive, autoGrade, summarize } from "../js/grade.js";
import { americanToDecimal } from "../js/odds.js";

const g = (h, a, state = "post") => ({ id: "1", state, completed: state === "post", home: { score: h, short: "Home" }, away: { score: a, short: "Away" } });
const leg = (o) => ({ id: Math.random().toString(), status: "open", odds: americanToDecimal(-110), ...o });

test("spread grading incl. push", () => {
  assert.equal(gradeLeg(leg({ market: "spread", side: "home", line: -7 }), g(28, 21)), "push");
  assert.equal(gradeLeg(leg({ market: "spread", side: "home", line: -6.5 }), g(28, 21)), "won");
  assert.equal(gradeLeg(leg({ market: "spread", side: "away", line: 6.5 }), g(28, 21)), "lost");
  assert.equal(gradeLeg(leg({ market: "spread", side: "away", line: 7.5 }), g(28, 21)), "won");
});

test("moneyline and totals", () => {
  assert.equal(gradeLeg(leg({ market: "ml", side: "away" }), g(10, 13)), "won");
  assert.equal(gradeLeg(leg({ market: "total", side: "over", line: 48.5 }), g(28, 21)), "won");
  assert.equal(gradeLeg(leg({ market: "total", side: "under", line: 49 }), g(28, 21)), "push");
  assert.equal(gradeLeg(leg({ market: "total", side: "under", line: 48.5 }), g(28, 21)), "lost");
});

test("does not grade games that aren't final", () => {
  assert.equal(gradeLeg(leg({ market: "ml", side: "home" }), g(28, 21, "in")), null);
  assert.equal(gradeLeg(leg({ market: "prop" }), g(28, 21)), null);
});

test("live text", () => {
  assert.equal(legMargin(leg({ market: "spread", side: "home", line: -3.5 }), g(14, 7, "in")).text, "Covering by 3.5");
  assert.equal(legMargin(leg({ market: "total", side: "over", line: 52.5 }), g(21, 17, "in")).text, "Need 15 more · 38 pts");
  assert.equal(legLive(leg({ market: "ml", side: "away" }), g(14, 7, "in")).state, "losing");
});

test("parlay status: any loss loses, pushes drop out of the price", () => {
  const b = { stake: 10, legs: [leg({ status: "won" }), leg({ status: "push" }), leg({ status: "won" })] };
  assert.equal(betStatus(b), "won");
  assert.equal(Math.round(betDecimal(b) * 1000) / 1000, Math.round(americanToDecimal(-110) ** 2 * 1000) / 1000);
  b.legs[1].status = "lost";
  assert.equal(betStatus(b), "lost");
  assert.equal(betProfit(b), -10);
  b.legs = [leg({ status: "open" }), leg({ status: "won" })];
  assert.equal(betStatus(b), "open");
  assert.equal(betProfit(b), null);
});

test("book override + boost", () => {
  const b = { stake: 10, oddsOverride: 6, boostPct: 50, legs: [leg({ status: "won" }), leg({ status: "won" })] };
  assert.equal(betDecimal(b), 1 + 5 * 1.5);
  assert.equal(betProfit(b), 75);
});

test("cash out", () => {
  const b = { stake: 20, cashout: 35, legs: [leg({ status: "open" })] };
  assert.equal(betStatus(b), "cashout");
  assert.equal(betProfit(b), 15);
});

test("autoGrade settles bets from final scores", () => {
  const games = { a: { ...g(31, 24), id: "a" }, b: { ...g(0, 0, "in"), id: "b" } };
  const bets = [
    { stake: 10, legs: [leg({ gameId: "a", market: "spread", side: "home", line: -3.5 })] },
    { stake: 10, legs: [leg({ gameId: "a", market: "ml", side: "home" }), leg({ gameId: "b", market: "ml", side: "home" })] },
  ];
  const changed = autoGrade(bets, (id) => games[id]);
  assert.equal(changed.length, 2);
  assert.equal(betStatus(bets[0]), "won");
  assert.ok(bets[0].settledAt);
  assert.equal(betStatus(bets[1]), "open");
  assert.equal(autoGrade(bets, (id) => games[id]).length, 0, "idempotent");
});

test("summary math", () => {
  const w = { stake: 10, createdAt: "2026-09-01", legs: [leg({ status: "won" })] };
  const l = { stake: 10, createdAt: "2026-09-02", legs: [leg({ status: "lost" })] };
  const o = { stake: 5, createdAt: "2026-09-03", legs: [leg({ status: "open", odds: 3 })] };
  const s = summarize([w, l, o]);
  assert.equal(s.w, 1);
  assert.equal(s.l, 1);
  assert.equal(Math.round(s.profit * 100) / 100, -0.91);
  assert.equal(s.atRisk, 5);
  assert.equal(s.potential, 15);
  assert.equal(s.streak, "L1");
});
