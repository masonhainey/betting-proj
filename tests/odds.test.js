import { test } from "node:test";
import assert from "node:assert/strict";
import { americanToDecimal, decimalToAmerican, parseOdds, formatOdds, stepOdds, parlayDecimal, toWin, stakeForWin, hedge, noVig } from "../js/odds.js";

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const am = (d) => decimalToAmerican(d);

test("american <-> decimal round trips", () => {
  close(americanToDecimal(-110), 1.9091);
  close(americanToDecimal(150), 2.5);
  close(americanToDecimal(800), 9);
  for (const a of [-110, -250, 100, 150, 930, -1000, 2500]) assert.equal(am(americanToDecimal(a)), a);
  assert.ok(Number.isNaN(americanToDecimal(50)));
});

test("parses every way a book writes odds", () => {
  close(parseOdds("+800").decimal, 9);
  close(parseOdds("-110").decimal, 1.9091);
  close(parseOdds("150").decimal, 2.5); // bare 3-digit = American
  close(parseOdds("x9.3").decimal, 9.3);
  close(parseOdds("9.3x").decimal, 9.3);
  close(parseOdds("×1.91").decimal, 1.91);
  close(parseOdds("5/2").decimal, 3.5);
  close(parseOdds("EV").decimal, 2);
  assert.equal(parseOdds("abc"), null);
  assert.equal(parseOdds("-50"), null);
  assert.equal(parseOdds(""), null);
  assert.equal(parseOdds("0.5"), null);
});

test("formats in both styles", () => {
  assert.equal(formatOdds(americanToDecimal(-110), "american"), "-110");
  assert.equal(formatOdds(2.5, "american"), "+150");
  assert.equal(formatOdds(9.3, "decimal"), "9.3");
  assert.equal(formatOdds(1.9091, "decimal"), "1.91");
  assert.equal(formatOdds(2, "decimal"), "2.0");
});

test("american stepper jumps the -100/+100 gap and snaps to the grid", () => {
  const up = (a) => am(stepOdds(americanToDecimal(a), 1, "american"));
  const dn = (a) => am(stepOdds(americanToDecimal(a), -1, "american"));
  assert.equal(up(-110), -105);
  assert.equal(up(-105), 100);
  assert.equal(up(100), 105);
  assert.equal(dn(100), -105);
  assert.equal(dn(105), 100);
  assert.equal(dn(-110), -115);
  assert.equal(up(-112), -110);
  assert.equal(up(200), 210);
  assert.equal(up(950), 975);
});

test("decimal stepper", () => {
  close(stepOdds(9.3, 1, "decimal"), 9.4);
  close(stepOdds(1.9, -1, "decimal"), 1.85);
  assert.ok(stepOdds(1.02, -1, "decimal") >= 1.01);
});

test("parlay + payout math", () => {
  const d = parlayDecimal([americanToDecimal(-110), americanToDecimal(-110), americanToDecimal(-110)]);
  assert.equal(am(d), 596);
  close(toWin(10, d), 59.58, 0.01);
  close(stakeForWin(100, 2.5), 66.667);
});

test("hedge locks the same result both ways", () => {
  const h = hedge(90, 10, 1.5);
  close(h.stake, 60);
  close(h.locked, 20);
  close(90 - 10 - h.stake, h.stake * 1.5 - 10 - h.stake);
});

test("no-vig", () => {
  const r = noVig(americanToDecimal(-110), americanToDecimal(-110));
  close(r.p1, 0.5);
  close(r.hold, 0.0476);
});
