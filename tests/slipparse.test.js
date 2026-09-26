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

test("fixes common OCR misreads in prices and money", async () => {
  const { fixOcr } = await import("../js/slipparse.js");
  assert.equal(fixOcr("Texas -7.5 -11O"), "Texas -7.5 -110");
  assert.equal(fixOcr("Wager: S20.00"), "Wager: $20.00");
  assert.equal(fixOcr("To Pay: $19З.4O".replace("З", "3")), "To Pay: $193.40");
  assert.equal(fixOcr("Ohio State +1S0"), "Ohio State +150");
  assert.equal(fixOcr("Stake $20,00"), "Stake $20.00");
});

test("recovers minus signs OCR dropped, using the ticket payout", () => {
  // Real prices: -110, -115, -110, +140. OCR lost every sign.
  const r = parseSlipText(`4 Leg Parlay
Texas -7.5   110
Michigan +7.5   115
Over 56   110
Clemson Moneyline   140
Wager $10.00
To Pay $163.53`);
  assert.equal(r.legs.length, 4);
  assert.deepEqual(r.legs.map((l) => am(l.odds)), [-110, -115, -110, 140]);
  assert.ok(r.legs.every((l) => !l.uncertain));
  assert.ok(r.oddsCheck < 0.03);
});

test("leaves unsure signs flagged when there's no payout to check against", () => {
  const r = parseSlipText("Texas -7.5   110\nWager $10.00");
  assert.equal(r.legs[0].uncertain, true);
  assert.equal(am(r.legs[0].odds), -110);
});

test("FanDuel-style stacked slip with matchup lines", () => {
  const r = parseSlipText(`FANDUEL
3 LEG PARLAY +596
Over 56
TOTAL POINTS
UCLA Bruins @ Miami Hurricanes
-110
Texas Longhorns -7.5
SPREAD BETTING
Texas Longhorns @ South Carolina Gamecocks
-110
Clemson Tigers
MONEYLINE
Auburn Tigers @ Clemson Tigers
-135
TOTAL WAGER
$10.00
POTENTIAL PAYOUT
$69.60`);
  assert.equal(r.book, "FanDuel");
  assert.equal(r.legs.length, 3);
  assert.deepEqual(r.legs.map((l) => l.pick), ["Over 56", "Texas Longhorns -7.5", "Clemson Tigers ML"]);
  assert.equal(r.legs[0].context, "UCLA Bruins @ Miami Hurricanes");
  assert.equal(r.stake, 10);
  assert.equal(r.payout, 69.6);
});

test("matchup context places team-less legs and picks the right week", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const pool = [
    { id: "wk2", date: "2026-10-03T19:00:00Z", home: T("Texas Longhorns", "Texas", "TEX"), away: T("Oklahoma Sooners", "Oklahoma", "OU") },
    { id: "wk1", date: "2026-09-26T19:00:00Z", home: T("South Carolina Gamecocks", "South Carolina", "SC"), away: T("Texas Longhorns", "Texas", "TEX") },
    { id: "m", date: "2026-09-26T20:00:00Z", home: T("Miami Hurricanes", "Miami", "MIA"), away: T("UCLA Bruins", "UCLA", "UCLA") },
  ];
  assert.equal(linkPick("Texas -7.5", pool, "", now).gameId, "wk1", "nearest game wins a tie");
  assert.deepEqual(linkPick("Over 56", pool, "UCLA Bruins @ Miami Hurricanes", now), { gameId: "m", market: "total", side: "over", line: 56 });
  assert.deepEqual(linkPick("Texas Longhorns -7.5", pool, "Oklahoma Sooners @ Texas Longhorns", now), { gameId: "wk2", market: "spread", side: "home", line: -7.5 });
});

test("wager and payout printed as two columns", () => {
  const r = parseSlipText("3 LEG PARLAY +596\nOver 56 -110\nTOTAL WAGER    POTENTIAL PAYOUT\n$10.00    $69.60");
  assert.equal(r.stake, 10);
  assert.equal(r.payout, 69.6);
  const flipped = parseSlipText("Over 56 -110\nPAYOUT   WAGER\n$69.60   $10.00");
  assert.equal(flipped.stake, 10);
  assert.equal(flipped.payout, 69.6);
});

test("moneyline label under the pick", () => {
  const r = parseSlipText("Clemson Tigers -135\nMONEYLINE\nAuburn Tigers @ Clemson Tigers");
  assert.equal(r.legs[0].pick, "Clemson Tigers ML");
  assert.equal(r.legs[0].context, "Auburn Tigers @ Clemson Tigers");
});
