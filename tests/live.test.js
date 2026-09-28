import { test } from "node:test";
import assert from "node:assert/strict";
import { injuryCost, liveFactors, missChance, parsePregame, pickVeto, restEffect, weatherEffect } from "../js/model/live.js";
import { view } from "../js/model/edge.js";
import { buildModelData, teamForm } from "../js/model/build.js";
import { weatherAt } from "../js/weather.js";

const now = Date.parse("2026-10-01T12:00:00Z");
const summary = {
  injuries: [
    { team: { id: "1" }, injuries: [
      { status: "Out", date: "2026-09-29T00:00Z", athlete: { id: "11", displayName: "Joe Starter", position: { abbreviation: "QB" } }, details: { type: "Shoulder" } },
      { status: "Questionable", date: "2026-09-29T00:00Z", athlete: { id: "12", displayName: "Wide Out", position: { abbreviation: "WR" } } },
      { status: "Injured Reserve", date: "2026-08-20T00:00Z", athlete: { id: "13", displayName: "Old Tackle", position: { abbreviation: "OT" } } },
    ] },
    { team: { id: "2" }, injuries: [
      { status: "Out", athlete: { id: "21", displayName: "Backup Guy", position: { abbreviation: "QB" } } },
    ] },
  ],
  leaders: [
    { team: { id: "1" }, leaders: [{ name: "passingYards", leaders: [{ athlete: { id: "11", displayName: "Joe Starter" } }] }, { name: "receivingYards", leaders: [{ athlete: { id: "12", displayName: "Wide Out" } }] }] },
    { team: { id: "2" }, leaders: [{ name: "passingYards", leaders: [{ athlete: { id: "22", displayName: "Real Starter" } }] }] },
  ],
  predictor: { homeTeam: { id: "1", gameProjection: "41.5" }, awayTeam: { id: "2", gameProjection: "58.5" } },
};
const g = { id: "g1", date: "2026-10-04T17:00:00Z", home: { id: "1", short: "Home", abbr: "HOM" }, away: { id: "2", short: "Away", abbr: "AWY" }, neutral: false };

test("parses ESPN's pregame summary", () => {
  const p = parsePregame(summary);
  assert.equal(p.injuries["1"].length, 3);
  assert.equal(p.injuries["1"][0].pos, "QB");
  assert.equal(p.leaders["1"].pass.name, "Joe Starter");
  assert.ok(Math.abs(p.predictor.home - 0.415) < 1e-9);
  assert.deepEqual(parsePregame({}).injuries, {});
  assert.equal(parsePregame(null).predictor, null);
});

test("status to chance of missing", () => {
  assert.equal(missChance("Out"), 1);
  assert.equal(missChance("Doubtful"), 0.8);
  assert.equal(missChance("Questionable"), 0.3);
  assert.equal(missChance("Active"), 0);
});

test("a starting QB out costs far more than a backup; long absences count less", () => {
  const p = parsePregame(summary);
  const home = injuryCost(p.injuries["1"], p.leaders["1"], "nfl", now);
  const away = injuryCost(p.injuries["2"], p.leaders["2"], "nfl", now);
  assert.ok(home.qb.starter);
  assert.ok(home.pts > 5.5 && home.pts < 7.5, `home ${home.pts}`);
  assert.ok(!away.qb.starter);
  assert.ok(away.pts < 1.5);
  const tackle = home.items.find((i) => i.name === "Old Tackle");
  assert.ok(!tackle || tackle.stale);
  assert.ok(home.total > 1.5);
});

test("weather takes points off the total; domes don't", () => {
  assert.equal(weatherEffect({ indoor: true }).total, 0);
  assert.equal(weatherEffect({ wind: 6, temp: 70, pop: 10, precip: 0 }).total, 0);
  const windy = weatherEffect({ wind: 22, gust: 35, temp: 50, pop: 70, precip: 2 });
  assert.ok(windy.total < -4.5, `${windy.total}`);
  assert.equal(windy.items.length, 2);
  assert.ok(weatherEffect({ wind: 60 }).total >= -6);
});

test("rest: bye vs short week", () => {
  assert.equal(restEffect("nfl", 14, 4).margin, 2);
  assert.equal(restEffect("nfl", 7, 7).margin, 0);
  assert.equal(restEffect("nfl", NaN, 4).margin, 0);
});

test("live factors combine into margin, total, predictor and flags", () => {
  const lf = liveFactors(g, { pre: parsePregame(summary), wx: { wind: 20, temp: 55, pop: 0, precip: 0 }, teams: { 1: { last: "2026-09-20T17:00:00Z" }, 2: { last: "2026-09-29T00:00:00Z" } }, sport: "nfl", now });
  assert.ok(lf.margin < -3, `margin ${lf.margin}`); // home QB out; home bye and away backup QB partly offset
  assert.ok(lf.total < -3);
  assert.ok(Math.abs(lf.espnHome - 0.415) < 1e-9);
  assert.equal(lf.flags.home.qb.starter, true);
  assert.ok(lf.items.some((i) => i.kind === "injury" && /Joe Starter/.test(i.text)));
  assert.ok(lf.items.some((i) => i.kind === "rest"));
});

test("hard stops for auto-picks", () => {
  const lf = liveFactors(g, { pre: parsePregame(summary), wx: { wind: 21 }, sport: "nfl", now });
  assert.match(pickVeto({ market: "ml", side: "home" }, g, lf), /QB/);
  assert.equal(pickVeto({ market: "ml", side: "away" }, g, lf), null);
  assert.match(pickVeto({ market: "total", side: "over", line: 44 }, g, lf), /wind/);
  assert.equal(pickVeto({ market: "total", side: "under", line: 44 }, g, lf), null);
  const q = parsePregame({ ...summary, injuries: [{ team: { id: "2" }, injuries: [{ status: "Questionable", athlete: { id: "22", displayName: "Real Starter", position: { abbreviation: "QB" } } }] }] });
  const lq = liveFactors(g, { pre: q, sport: "nfl", now });
  assert.match(pickVeto({ market: "spread", side: "home", line: -3 }, g, lq), /uncertain/);
});

test("the blend moves with injuries and ESPN's predictor", () => {
  const pred = { margin: 3, total: 45, sigma: 13, sigmaTotal: 12, edgeMax: 17 };
  const odds = { spread: { home: { line: -3 } }, total: { line: 45 } };
  const base = view(pred, odds, 0.3);
  const lf = { margin: -6, total: -3, espnHome: 0.4 };
  const v = view(pred, odds, 0.3, lf);
  assert.ok(v.margin < base.margin - 2, `${v.margin} vs ${base.margin}`);
  assert.ok(v.total < base.total);
  assert.ok(Math.abs(v.parts.w.model + v.parts.w.espn + v.parts.w.market - 1) < 1e-9);
  assert.equal(v.parts.model, -3);
});

test("weather at kickoff from an hourly forecast", () => {
  const f = { hourly: { time: ["2026-10-04T16:00", "2026-10-04T17:00", "2026-10-04T18:00", "2026-10-04T19:00", "2026-10-04T20:00"], wind_speed_10m: [5, 18, 20, 22, 40], wind_gusts_10m: [8, 25, 30, 33, 50], temperature_2m: [60, 58, 57, 56, 50], precipitation_probability: [0, 10, 70, 40, 0], precipitation: [0, 0, 1.2, 0.2, 0] } };
  const w = weatherAt(f, "2026-10-04T17:00:00Z");
  assert.equal(Math.round(w.wind), 20);
  assert.equal(w.gust, 33);
  assert.equal(w.pop, 70);
  assert.equal(weatherAt(f, "2026-12-01T17:00:00Z"), null);
});

test("model file: ratings, report card, last game and form", () => {
  const mk = (i, d, h, a, hs, as) => ({ id: String(i), d, h, a, hs, as, n: false, hn: `T${h}`, an: `T${a}`, sp: -3, tot: 45 });
  const cur = [];
  let i = 0;
  for (let w = 0; w < 6; w++) {
    const d = new Date(Date.parse("2026-09-05T17:00:00Z") + w * 7 * 864e5).toISOString();
    cur.push(mk(i++, d, "1", "2", 30 + w, 20), mk(i++, d, "3", "4", 17, 24 + w));
  }
  const data = buildModelData("nfl", { cur, prev: [], season: 2026, now: Date.parse("2026-10-20T00:00:00Z") });
  assert.equal(data.games.cur, 12);
  assert.ok(data.model.r["1"] > data.model.r["2"]);
  assert.ok(data.weight >= 0.15 && data.weight <= 0.45);
  assert.equal(data.teams["1"].form.length, 5);
  assert.equal(data.teams["1"].form[0].o, "T2");
  assert.ok(data.teams["1"].form[0].m > 0);
  const f = teamForm(cur);
  assert.equal(f["4"].last, cur[cur.length - 1].d);
});
