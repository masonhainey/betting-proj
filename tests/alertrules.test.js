import { test } from "node:test";
import assert from "node:assert/strict";
import { computeServerEvents, betEvent } from "../js/alertrules.js";

const T = (abbr, short) => ({ abbr, short, name: short });
const G = (id, h, a, state = "post", period = 4) => ({ id, state, completed: state === "post", period, shortName: "AWAY @ HOME", home: { ...T("HOME", "Home"), score: h }, away: { ...T("AWAY", "Away"), score: a } });
const leg = (id, gameId, market, side, line, extra = {}) => ({ id, gameId, market, side, line, odds: 1.9091, status: "open", pick: "x", ...extra });
const games = { g1: G("g1", 28, 21), g2: G("g2", 10, 17), g3: G("g3", 7, 0, "in", 1), g4: G("g4", 14, 14, "in", 3) };
const game = (id) => games[id];

test("straight bet that cashed → one bet alert", () => {
  const bets = [{ id: "b1", stake: 10, legs: [leg("l1", "g1", "spread", "home", -3.5)] }];
  const ev = computeServerEvents(bets, game);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].key, "bet:b1");
  assert.match(ev[0].title, /^💰 Cashed: Home -3.5$/);
  assert.match(ev[0].body, /\+\$9\.09 · pays \$19\.09/);
});

test("parlay: a leg hits while others are live → leg alert only", () => {
  const bets = [{ id: "p1", stake: 10, legs: [leg("a", "g1", "ml", "home"), leg("b", "g4", "total", "over", 40)] }];
  const ev = computeServerEvents(bets, game).filter((e) => !e.key.startsWith("kick"));
  assert.deepEqual(ev.map((e) => e.key), ["leg:p1:a"]);
  assert.match(ev[0].title, /✅ Home ML hit/);
  assert.match(ev[0].body, /1 of 2 in .* 1 to go/);
});

test("parlay busts → one 'busted' alert naming the leg, no separate leg alert", () => {
  const bets = [{ id: "p2", stake: 10, legs: [leg("a", "g1", "ml", "home"), leg("b", "g2", "ml", "home")] }];
  const ev = computeServerEvents(bets, game);
  assert.equal(ev.length, 1);
  assert.match(ev[0].title, /☠️ Lost: 2-leg parlay/);
  assert.match(ev[0].body, /Home ML missed/);
});

test("kickoff alert for games in the 1st quarter, grouped per game", () => {
  const bets = [
    { id: "k1", stake: 10, legs: [leg("a", "g3", "spread", "home", -7)] },
    { id: "k2", stake: 10, legs: [leg("a", "g3", "total", "over", 50)] },
  ];
  const ev = computeServerEvents(bets, game);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].key, "kick:g3");
  assert.match(ev[0].body, /Home -7, Over 50/);
});

test("prefs, ghosts, and bets already settled on a device", () => {
  const cashed = { id: "b1", stake: 10, legs: [leg("l1", "g1", "spread", "home", -3.5)] };
  assert.equal(computeServerEvents([cashed], game, { prefs: { bets: false } }).length, 0);
  assert.equal(computeServerEvents([{ ...cashed, ghost: true }], game, { prefs: { ghosts: false } }).length, 0);
  const ghost = computeServerEvents([{ ...cashed, ghost: true }], game)[0];
  assert.match(ghost.title, /^👻 💰 Your pass hit/);
  const alreadySeen = { ...cashed, legs: [{ ...cashed.legs[0], status: "won" }] };
  assert.equal(computeServerEvents([alreadySeen], game).length, 0, "app already graded it");
  assert.equal(computeServerEvents([{ id: "u", stake: 5, legs: [{ id: "x", pick: "Heisman", odds: 5, status: "open" }] }], game).length, 0, "unlinked legs can't be graded");
});

test("bet event wording for a push", () => {
  const b = { id: "p", stake: 10, legs: [{ ...leg("a", "g1", "spread", "home", -7), status: "push" }] };
  assert.match(betEvent(b, game).title, /➖ Push/);
});
