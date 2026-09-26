import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlipText, linkPick, detectBook } from "../js/slipparse.js";
import { decimalToAmerican } from "../js/odds.js";

const am = (d) => decimalToAmerican(d);

test("DraftKings-style parlay screenshot text", () => {
  const r = parseSlipText(`DRAFTKINGS SPORTSBOOK
4 Leg Parlay +867
Texas -7.5 −110
Spread
UCLA +3.5 -115
Utah -7.5 -110
LSU Moneyline -135
Wager: $20.00
To Pay: $193.40`);
  assert.equal(r.book, "DraftKings");
  assert.equal(r.type, "parlay");
  assert.equal(r.legCount, 4);
  assert.equal(r.legs.length, 4);
  assert.deepEqual(r.legs.map((l) => l.pick), ["Texas -7.5", "UCLA +3.5", "Utah -7.5", "LSU ML"]);
  assert.deepEqual(r.legs.map((l) => am(l.odds)), [-110, -115, -110, -135]);
  assert.equal(am(r.totalOdds), 867);
  assert.equal(r.stake, 20);
  assert.equal(r.payout, 193.4);
});

test("stacked layout: team, market and line above the price", () => {
  const r = parseSlipText(`FanDuel
Georgia Bulldogs
Spread
-7.5
-110
Over 52.5
-108
Bet $10.00
To Win $17.99`);
  assert.equal(r.book, "FanDuel");
  assert.deepEqual(r.legs.map((l) => l.pick), ["Georgia Bulldogs -7.5", "Over 52.5"]);
  assert.equal(r.stake, 10);
  assert.equal(r.payout, 27.99);
});

test("share text with link and arrow payout", () => {
  const r = parseSlipText("Check out my bet on BetMGM! Ohio State ML -250 · $50 → $70 https://sports.betmgm.com/en/sports/share/abc123");
  assert.equal(r.book, "BetMGM");
  assert.equal(r.type, "straight");
  assert.equal(r.legs[0].pick, "Ohio State ML");
  assert.equal(r.stake, 50);
  assert.equal(r.payout, 70);
  assert.ok(r.url.startsWith("https://sports.betmgm.com"));
});

test("FanDuel share text", () => {
  const r = parseSlipText("I just placed a bet on FanDuel! Ohio State ML -250 · $50 → $70 https://fndl.co/abc123");
  assert.equal(r.book, "FanDuel");
  assert.equal(r.legs[0].pick, "Ohio State ML");
  assert.equal(r.url, "https://fndl.co/abc123");
});

test("decimal-odds slip", () => {
  const r = parseSlipText("Oregon to win @ 1.45\nMiami -3.5 @ 1.91\nStake $10");
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[1].odds, 1.91);
});

test("detectBook", () => {
  assert.equal(detectBook("https://fndl.co/xyz"), "FanDuel");
  assert.equal(detectBook("nothing"), "");
});

const G = (id, home, away) => ({ id, home, away });
const T = (name, short, abbr) => ({ name, short, abbr });
const games = [
  G("1", T("Alabama Crimson Tide", "Alabama", "ALA"), T("Georgia Bulldogs", "Georgia", "UGA")),
  G("2", T("Texas A&M Aggies", "Texas A&M", "TA&M"), T("Texas Longhorns", "Texas", "TEX")),
];

test("links picks to games and markets", () => {
  assert.deepEqual(linkPick("Georgia Bulldogs -7.5", games), { gameId: "1", market: "spread", side: "away", line: -7.5 });
  assert.deepEqual(linkPick("Alabama ML", games), { gameId: "1", market: "ml", side: "home" });
  assert.deepEqual(linkPick("Texas A&M +3", games), { gameId: "2", market: "spread", side: "home", line: 3 });
  assert.deepEqual(linkPick("UGA @ ALA Over 52.5", games), { gameId: "1", market: "total", side: "over", line: 52.5 });
  assert.equal(linkPick("Arch Manning 250+ pass yds", games), null);
  assert.equal(linkPick("uga", games), null, "lowercase abbreviations are too ambiguous");
});
