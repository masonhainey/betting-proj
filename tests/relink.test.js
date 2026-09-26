import { test } from "node:test";
import assert from "node:assert/strict";
import { relinkLegs, needsLink } from "../js/relink.js";
import { autoGrade } from "../js/grade.js";
import { linkPick } from "../js/slipparse.js";

const t = (id, abbr, name, short, score) => ({ id, abbr, name, short, score });
const ucla = { id: "401", date: "2026-09-26T02:30:00Z", state: "post", completed: true, shortName: "UCLA @ ORE", home: t("2483", "ORE", "Oregon Ducks", "Oregon", 27), away: t("26", "UCLA", "UCLA Bruins", "UCLA", 24) };
const nextWeek = { ...ucla, id: "402", date: "2026-10-03T02:30:00Z", state: "pre", completed: false, shortName: "UCLA @ USC", home: t("30", "USC", "USC Trojans", "USC", null) };
const games = [ucla, nextWeek];
const bet = (pick, extra = {}) => ({ id: pick, createdAt: "2026-09-25T18:00:00Z", stake: 10, legs: [{ id: "l", pick, odds: 1.91, status: "open", ...extra }] });

test("a typed pick with no game gets linked to the nearest matching game and settles itself", () => {
  const bets = [bet("UCLA +3.5")];
  const changed = relinkLegs(bets, games);
  assert.equal(changed.length, 1);
  const leg = bets[0].legs[0];
  assert.deepEqual([leg.gameId, leg.market, leg.side, leg.line], ["401", "spread", "away", 3.5]);
  assert.equal(leg.kickoff, ucla.date);
  const graded = autoGrade(bets, (id) => games.find((g) => g.id === id));
  assert.equal(graded[0].grade, "won", "lost by 3 with +3.5");
});

test("moneyline and total picks link too", () => {
  const bets = [bet("UCLA ML"), bet("UCLA/Oregon Over 49.5", {}), bet("Oregon")];
  relinkLegs(bets, games);
  assert.deepEqual(bets.map((b) => b.legs[0].market), ["ml", "total", "ml"]);
  assert.equal(bets[2].legs[0].side, "home");
});

test("props, team totals and halves are never graded off the final score", () => {
  for (const pick of ["UCLA team total over 24.5", "Dante Moore over 250.5 passing yards", "UCLA 1H +3", "Oregon -7 2nd half", "UCLA anytime TD"]) {
    const bets = [bet(pick)];
    assert.equal(needsLink(bets[0].legs[0]), false, pick);
    assert.equal(relinkLegs(bets, games).length, 0, pick);
    const m = linkPick(pick, games);
    assert.ok(!m || m.market === "other", `import must not make "${pick}" gradeable`);
  }
});

test("only games near when the bet was placed; settled and linked legs are left alone", () => {
  const old = bet("UCLA +3.5");
  old.createdAt = "2026-08-01T00:00:00Z";
  assert.equal(relinkLegs([old], games).length, 0, "no game within two weeks of placing it");
  const done = bet("UCLA +3.5");
  done.legs[0].status = "won";
  assert.equal(relinkLegs([done], games).length, 0);
  const linked = bet("UCLA +3.5", { gameId: "402", market: "spread", side: "away", line: 3.5 });
  assert.equal(relinkLegs([linked], games).length, 0);
  assert.equal(linked.legs[0].gameId, "402");
});

test("a leg linked to a game without a market gets its market from the pick", () => {
  const b = bet("UCLA +3.5", { gameId: "401", market: "other" });
  relinkLegs([b], games);
  assert.equal(b.legs[0].market, "spread");
  const nope = bet("Something weird", { gameId: "401", market: "other" });
  assert.equal(relinkLegs([nope], games).length, 0);
});
