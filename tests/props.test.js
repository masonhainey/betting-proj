import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProp, parseBox, findPlayer, propMargin, propText } from "../js/props.js";
import { gradeLeg, legLive, autoGrade } from "../js/grade.js";

test("reads props the way books and people write them", () => {
  const cases = [
    ["Josh Allen Over 250.5 Passing Yards", { player: "Josh Allen", stat: "pass_yds", side: "over", line: 250.5 }],
    ["J. Allen o250.5 pass yds", { player: "J. Allen", stat: "pass_yds", side: "over", line: 250.5 }],
    ["Travis Kelce 6+ receptions", { player: "Travis Kelce", stat: "receptions", side: "over", line: 5.5 }],
    ["Derrick Henry anytime TD", { player: "Derrick Henry", stat: "anytime_td", side: "yes", line: 0.5 }],
    ["Derrick Henry Anytime Touchdown Scorer +120", { player: "Derrick Henry", stat: "anytime_td", side: "yes", line: 0.5 }],
    ["Bijan Robinson Rush + Rec Yards U 110.5", { player: "Bijan Robinson", stat: "rush_rec_yds", side: "under", line: 110.5 }],
    ["Ja'Marr Chase (CIN) Over 74.5 Receiving Yards", { player: "Ja'Marr Chase", stat: "rec_yds", side: "over", line: 74.5 }],
    ["Arch Manning under 1.5 passing TDs", { player: "Arch Manning", stat: "pass_tds", side: "under", line: 1.5 }],
    ["Saquon Barkley rushing yards over 89.5", { player: "Saquon Barkley", stat: "rush_yds", side: "over", line: 89.5 }],
    ["A.J. Brown 5+ Receptions", { player: "A.J. Brown", stat: "receptions", side: "over", line: 4.5 }],
    ["Lamar Jackson Over 0.5 Interceptions", { player: "Lamar Jackson", stat: "ints", side: "over", line: 0.5 }],
  ];
  for (const [text, want] of cases) assert.deepEqual(parseProp(text), want, text);
});

test("game lines are not props", () => {
  for (const t of ["Georgia -7.5", "Texas ML", "Over 52.5", "UCLA/Oregon Over 49.5", "Chiefs -3 -110", ""]) assert.equal(parseProp(t), null, t);
  assert.equal(propText(parseProp("Josh Allen Over 250.5 Passing Yards")), "Josh Allen o250.5 pass yds");
});

// Shaped like ESPN's game summary (site.api.espn.com/…/summary?event=ID).
const summary = (done, allen = { cmp: "18/27", yds: "187", td: "2" }) => ({
  header: { competitions: [{ status: { type: { completed: done } } }] },
  boxscore: { players: [
    { team: { id: "2" }, statistics: [
      { name: "passing", keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions"],
        athletes: [{ athlete: { id: "3918298", displayName: "Josh Allen", shortName: "J. Allen" }, stats: [allen.cmp, allen.yds, "6.9", allen.td, "0"] }] },
      { name: "rushing", keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"],
        athletes: [{ athlete: { id: "3918298", displayName: "Josh Allen", shortName: "J. Allen" }, stats: ["6", "41", "6.8", "1", "15"] },
          { athlete: { id: "4379399", displayName: "James Cook", shortName: "J. Cook" }, stats: ["14", "63", "4.5", "0", "12"] }] },
      { name: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
        athletes: [{ athlete: { id: "4379399", displayName: "James Cook", shortName: "J. Cook" }, stats: ["3", "22", "7.3", "1", "11", "4"] }] },
    ] },
    { team: { id: "12" }, statistics: [
      { name: "receiving", keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns"],
        athletes: [{ athlete: { id: "15847", displayName: "Travis Kelce", shortName: "T. Kelce" }, stats: ["5", "58", "11.6", "0"] }] },
    ] },
  ] },
});

test("reads ESPN box scores (keys or labels)", () => {
  const box = parseBox(summary(false));
  const allen = box.players.find((p) => p.name === "Josh Allen");
  assert.deepEqual([allen.stats.cmp, allen.stats.att, allen.stats.passYds, allen.stats.passTD, allen.stats.rushYds, allen.stats.rushTD], [18, 27, 187, 2, 41, 1]);
  const cook = box.players.find((p) => p.name === "James Cook");
  assert.deepEqual([cook.stats.rushYds, cook.stats.rec, cook.stats.recYds, cook.stats.recTD], [63, 3, 22, 1]);
  assert.equal(box.final, false);
  assert.equal(parseBox(summary(true)).final, true);
  assert.deepEqual(parseBox({}), { players: [], final: false });
});

test("finds players by full name, initial, or a unique last name", () => {
  const { players } = parseBox(summary(false));
  assert.equal(findPlayer("Josh Allen", players).id, "3918298");
  assert.equal(findPlayer("J. Allen", players).id, "3918298");
  assert.equal(findPlayer("Kelce", players).id, "15847");
  assert.equal(findPlayer("Josh Allen Jr.", players).id, "3918298");
  assert.equal(findPlayer("Patrick Mahomes", players), null);
});

const game = (state, box, extra = {}) => ({ id: "9", state, completed: state === "post", period: 3, clock: "7:30", home: { abbr: "KC" }, away: { abbr: "BUF" }, box, ...extra });
const leg = (pick) => ({ id: "l", pick, odds: 1.9, status: "open", gameId: "9", market: "prop", prop: parseProp(pick) });

test("live progress with an on-pace projection", () => {
  const g = game("in", parseBox(summary(false)));
  const r = propMargin(leg("Josh Allen Over 250.5 Passing Yards"), g);
  assert.equal(r.value, 187);
  assert.equal(r.text, "187 / 250.5 pass yds · on pace for 299");
  assert.deepEqual(legLive(leg("Josh Allen Over 250.5 Passing Yards"), g), { state: "live", text: r.text }, "an over that hasn't cashed is live, not losing");
  assert.equal(legLive(leg("Josh Allen Over 150.5 Passing Yards"), g).state, "winning");
  assert.equal(legLive(leg("Josh Allen Under 150.5 Passing Yards"), g).state, "losing");
  assert.equal(legLive(leg("James Cook anytime TD"), g).text, "Scored");
  assert.equal(propMargin(leg("Travis Kelce 6+ receptions"), g).text.startsWith("5 / 5.5 rec"), true);
});

test("settles at the final whistle from the final box score only", () => {
  const over = leg("Josh Allen Over 250.5 Passing Yards");
  assert.equal(gradeLeg(over, game("post", parseBox(summary(false)))), null, "box not final yet");
  assert.equal(gradeLeg(over, game("post", null)), null, "no box yet");
  const fin = game("post", parseBox(summary(true, { cmp: "24/35", yds: "262", td: "2" })));
  assert.equal(gradeLeg(over, fin), "won");
  assert.equal(gradeLeg(leg("Josh Allen Under 250.5 Passing Yards"), fin), "lost");
  assert.equal(gradeLeg(leg("Josh Allen 2+ passing TDs"), fin), "won");
  assert.equal(gradeLeg(leg("Travis Kelce 6+ receptions"), fin), "lost");
  assert.equal(gradeLeg(leg("James Cook anytime TD"), fin), "won");
  assert.equal(gradeLeg(leg("Patrick Mahomes over 250.5 passing yards"), fin), null, "player missing: leave it for you, don't guess");
  const bet = { id: "b", stake: 10, legs: [over, leg("James Cook anytime TD")] };
  const changed = autoGrade([bet], () => fin);
  assert.deepEqual(changed.map((c) => c.grade), ["won", "won"]);
});
