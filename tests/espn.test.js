import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvent, normalizeOdds } from "../js/espn.js";
import { tagArticle } from "../js/news.js";

const comp = (homeAway, id, abbr, score) => ({ homeAway, score, curatedRank: { current: id === "61" ? 5 : 99 }, team: { id, abbreviation: abbr, shortDisplayName: abbr, displayName: abbr + " Team", color: "ba0c2f" }, records: [{ type: "total", summary: "3-0" }] });

test("normalizes an ESPN scoreboard event", () => {
  const g = normalizeEvent({
    id: 401, date: "2026-10-03T19:30Z", shortName: "UGA @ ALA",
    competitions: [{ date: "2026-10-03T19:30Z", status: { displayClock: "8:21", period: 3, type: { state: "in", detail: "8:21 - 3rd", shortDetail: "8:21 - 3rd" } },
      competitors: [comp("home", "333", "ALA", "17"), comp("away", "61", "UGA", "21")],
      broadcasts: [{ names: ["ABC"] }], situation: { possession: "61", shortDownDistanceText: "2nd & 7", isRedZone: true },
      odds: [{ provider: { name: "DraftKings" }, details: "UGA -2.5", overUnder: 51.5, homeTeamOdds: { moneyLine: 115 }, awayTeamOdds: { moneyLine: -135 } }] }],
  });
  assert.equal(g.id, "401");
  assert.equal(g.state, "in");
  assert.equal(g.away.rank, 5);
  assert.equal(g.home.rank, null);
  assert.equal(g.home.score, 17);
  assert.equal(g.tv, "ABC");
  assert.equal(g.situation.redZone, true);
  assert.equal(g.odds.spread.home.line, 2.5, "spread parsed from details, home-relative");
  assert.equal(g.odds.spread.away.line, -2.5);
  assert.equal(g.odds.total.line, 51.5);
  assert.deepEqual(g.odds.ml, { home: 115, away: -135 });
});

test("reads the newer odds shape", () => {
  const o = normalizeOdds({
    provider: { name: "ESPN BET" }, details: "TEX -6.5",
    moneyline: { home: { close: { odds: "-250" } }, away: { close: { odds: "+205" } } },
    pointSpread: { home: { close: { line: "-6.5", odds: "-112" } }, away: { close: { line: "+6.5", odds: "-108" } } },
    total: { over: { close: { line: "o55.5", odds: "-110" } }, under: { close: { line: "u55.5", odds: "-110" } } },
  });
  assert.equal(o.spread.home.line, -6.5);
  assert.equal(o.spread.home.price, -112);
  assert.equal(o.ml.away, 205);
  assert.equal(o.total.line, 55.5);
});

test("TBD kickoffs and missing odds", () => {
  const g = normalizeEvent({ id: 1, competitions: [{ timeValid: false, competitors: [comp("home", "1", "A"), comp("away", "2", "B")] }] });
  assert.equal(g.timeValid, false);
  assert.equal(g.odds, null);
  assert.equal(g.home.score, null);
});

test("news tagging", () => {
  assert.ok(tagArticle({ headline: "Star QB questionable with ankle injury", description: "" }).includes("injury"));
  assert.ok(tagArticle({ headline: "Line moves: sharp money on the underdog", description: "" }).includes("lines"));
  assert.ok(tagArticle({ headline: "Week 6 preview: key matchups", description: "" }).includes("preview"));
  assert.deepEqual(tagArticle({ headline: "Band performs at halftime", description: "" }), ["general"]);
});

test("win probability from moneyline, falling back to spread", async () => {
  const { winProb } = await import("../js/ui.js");
  const byMl = winProb({ odds: { ml: { home: -200, away: 170 } } });
  assert.ok(Math.abs(byMl.home + byMl.away - 1) < 1e-9);
  assert.ok(byMl.home > 0.6 && byMl.home < 0.7, String(byMl.home));
  const bySpread = winProb({ odds: { spread: { home: { line: -7 } } } });
  assert.ok(bySpread.home > 0.7 && bySpread.home < 0.8);
  assert.equal(winProb({ odds: null }), null);
});

test("each league has its own ESPN feed, and games remember their league", async () => {
  const { scoreboardUrl } = await import("../js/espn.js");
  assert.equal(scoreboardUrl("20260926"), "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260926&groups=80&limit=500");
  assert.equal(scoreboardUrl("20260927-20261003", "nfl"), "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260927-20261003&limit=500");
  const ev = { id: 7, competitions: [{ competitors: [comp("home", "12", "KC"), comp("away", "2", "BUF")] }] };
  assert.equal(normalizeEvent(ev, "nfl").sport, "nfl");
  assert.equal(normalizeEvent(ev).sport, "cfb");
});

test("team logos: ESPN's when sent, otherwise the right league's", async () => {
  const { logoUrl } = await import("../js/ui.js");
  const nfl = normalizeEvent({ id: 8, competitions: [{ competitors: [comp("home", "12", "KC"), comp("away", "2", "BUF")] }] }, "nfl");
  assert.equal(nfl.home.league, "nfl");
  assert.equal(logoUrl(nfl.home), "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png", "not college team #12");
  assert.equal(logoUrl({ ...nfl.home, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/kc.png" }), "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/kc.png");
  const cfb = normalizeEvent({ id: 9, competitions: [{ competitors: [comp("home", "333", "ALA"), comp("away", "61", "UGA")] }] });
  assert.match(logoUrl(cfb.home), /teamlogos\/ncaa\/500(-dark)?\/333\.png$/);
});
