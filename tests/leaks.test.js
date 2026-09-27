import { test } from "node:test";
import assert from "node:assert/strict";
import { leaks } from "../js/leaks.js";

const bet = (legs, stake, status, d = 1.909, extra = {}) => ({ id: Math.random().toString(36), stake, legs: legs.map((pick, i) => ({ id: String(i), pick, odds: d, status: Array.isArray(status) ? status[i] : status, ...(legs.length === 1 ? {} : {}) })), ...extra });

test("leaks finds where the money goes", () => {
  const bets = [
    ...Array.from({ length: 8 }, (_, i) => bet(["A -3", "B ML", "Over 50"], 10, i ? ["won", "won", "lost"] : ["won", "won", "won"])),
    ...Array.from({ length: 10 }, (_, i) => bet(["Georgia -7.5"], 20, i < 6 ? "won" : "lost")),
    bet(["Ghost ML"], 50, "lost", 2, { ghost: true }),
  ];
  const r = leaks(bets);
  assert.equal(r.bets, 18, "ghosts left out");
  const parl = r.byStructure.find((g) => g.key === "3+ leg parlays");
  assert.equal(parl.n, 8);
  assert.equal(parl.w, 1);
  assert.ok(parl.profit < 0);
  assert.equal(r.near.n, 7, "7 parlays lost by one leg");
  assert.ok(r.insights.some((x) => /Biggest leak: 3\+ leg parlays/.test(x.text)), JSON.stringify(r.insights));
  assert.ok(r.insights.some((x) => /lost by a single leg/.test(x.text)));
  assert.ok(r.insights.some((x) => /straight bets are doing better/.test(x.text)));
  assert.equal(leaks([]).insights.length, 1);
});
