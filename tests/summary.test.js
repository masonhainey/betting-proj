import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummary } from "../js/summary.js";

test("reads the current drive, its latest plays and win probability", () => {
  const s = parseSummary({
    drives: { current: { description: "6 plays, 45 yards, 3:12", team: { id: "33" }, start: { text: "BAL 20" },
      plays: [1, 2, 3, 4, 5, 6].map((i) => ({ text: `Play ${i}`, clock: { displayValue: `${10 - i}:00` }, period: { number: 2 }, type: { text: i === 6 ? "Pass Reception" : "Rush" }, statYardage: i * 2, scoringPlay: false })) } },
    winprobability: [{ homeWinPercentage: 0.4, tiePercentage: 0 }, { homeWinPercentage: 0.314, tiePercentage: 0.01 }],
  });
  assert.equal(s.drive.desc, "6 plays, 45 yards, 3:12");
  assert.equal(s.drive.teamId, "33");
  assert.equal(s.drive.startText, "BAL 20");
  assert.deepEqual(s.drive.plays.map((p) => p.text), ["Play 6", "Play 5", "Play 4", "Play 3", "Play 2"], "newest first, last five");
  assert.equal(s.drive.plays[0].yards, 12);
  assert.equal(s.winProb.home, 0.314);
  assert.ok(Math.abs(s.winProb.away - 0.676) < 1e-9);
});

test("missing pieces come back empty, never throw", () => {
  const empty = parseSummary({});
  assert.deepEqual({ ...empty, pre: undefined }, { box: { players: [], final: false }, drive: null, winProb: null, pre: undefined });
  assert.deepEqual(empty.pre.injuries, {});
  assert.equal(parseSummary({ winprobability: [{ homeWinPercentage: "x" }] }).winProb, null);
  assert.deepEqual(parseSummary({ drives: { current: { plays: [{}] } } }).drive.plays, []);
});
