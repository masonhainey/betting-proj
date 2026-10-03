import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRatings, predict, phi, phiInv } from "../js/model/ratings.js";
import { view, legProb, legEdge, parlayCheck, bestParlay, fairAmerican, marketMargin } from "../js/model/edge.js";
import { backtest, combine } from "../js/model/backtest.js";


// A simulated league with known strengths, so we can check the model recovers them.
function league({ teams = 40, weeks = 12, seed = 7, noise = 13, start = "2025-09-06T18:00:00Z" } = {}) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const truth = Array.from({ length: teams }, (_, i) => [String(i + 1), gauss() * 10]);
  const games = [];
  for (let w = 0; w < weeks; w++) {
    const order = [...truth].sort(() => r() - 0.5);
    for (let i = 0; i + 1 < order.length; i += 2) {
      const [h, rh] = order[i], [a, ra] = order[i + 1];
      const margin = rh - ra + 2.5 + gauss() * noise;
      const total = 50 + gauss() * 12;
      const hs = Math.max(0, Math.round((total + margin) / 2)), as = Math.max(0, Math.round((total - margin) / 2));
      const d = new Date(Date.parse(start) + w * 7 * 864e5).toISOString();
      games.push({ id: `${w}-${i}`, d, h, a, hs, as, n: false, sp: -Math.round((rh - ra + 2.5 + gauss() * 1.5) * 2) / 2, tot: 50.5 });
    }
  }
  return { truth: Object.fromEntries(truth), games };
}

const corr = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let n = 0, dx = 0, dy = 0;
  xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return n / Math.sqrt(dx * dy);
};

test("ratings recover true team strength and home field", () => {
  const { truth, games } = league();
  const m = fitRatings(games, { sport: "nfl", asOf: Date.parse("2026-01-01") });
  const ids = Object.keys(truth);
  const c = corr(ids.map((t) => truth[t]), ids.map((t) => m.r[t]));
  assert.ok(c > 0.8, `correlation ${c.toFixed(2)}`);
  assert.ok(m.hfa > 0 && m.hfa < 6, `hfa ${m.hfa.toFixed(2)}`);
  const best = ids.sort((a, b) => truth[b] - truth[a])[0], worst = ids[ids.length - 1];
  const p = predict(m, best, worst);
  assert.ok(p.margin > 5 && p.pHome > 0.65, JSON.stringify(p));
  assert.ok(p.total > 35 && p.total < 65);
  assert.equal(predict(m, "nobody", "nobody2"), null);
});

test("only games before the cutoff count", () => {
  const { games } = league();
  const early = fitRatings(games, { sport: "nfl", asOf: Date.parse(games[0].d) });
  assert.equal(early.games, 0);
  assert.equal(Object.keys(early.r).length, 0);
});

test("normal math", () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(phiInv(0.975) - 1.96) < 1e-3);
});

const pred = { margin: 7, total: 50, pHome: phi(7 / 13), sigma: 13, sigmaTotal: 12.5, thin: false };

test("leg probabilities are consistent", () => {
  const v = view(pred, null);
  const home = legProb({ market: "spread", side: "home", line: -3 }, v);
  const away = legProb({ market: "spread", side: "away", line: 3 }, v);
  assert.ok(Math.abs(home + away - 1) < 1e-9, "both sides of a spread sum to 1");
  assert.ok(home > 0.6);
  assert.ok(Math.abs(legProb({ market: "total", side: "over", line: 50 }, v) - 0.5) < 1e-6);
  assert.ok(Math.abs(legProb({ market: "ml", side: "home" }, v) + legProb({ market: "ml", side: "away" }, v) - 1) < 1e-9);
  assert.equal(legProb({ market: "prop" }, v), null);
});

test("blending leans on the market", () => {
  assert.equal(marketMargin({ spread: { home: { line: -3.5 } } }, 13), 3.5);
  const v = view(pred, { spread: { home: { line: -3 } }, total: { line: 44 } }, 0.35);
  assert.ok(Math.abs(v.margin - (0.35 * 7 + 0.65 * 3)) < 1e-9);
  assert.ok(Math.abs(v.total - (0.35 * 50 + 0.65 * 44)) < 1e-9);
  const ml = marketMargin({ ml: { home: -200, away: 170 } }, 13);
  assert.ok(ml > 3 && ml < 8, String(ml));
});

test("edges, fair prices and parlay checks", () => {
  const v = view(pred, null);
  const e = legEdge({ market: "spread", side: "home", line: -3 }, v, 1.909);
  assert.ok(Math.abs(e.p - phi(4 / 13)) < 1e-9 && e.edge > 0.09 && e.ev > 0.15, JSON.stringify(e));
  assert.equal(fairAmerican(0.5), -100);
  assert.equal(fairAmerican(0.75), -300);
  assert.equal(fairAmerican(0.25), 300);
  const pc = parlayCheck([{ p: 0.6, gameId: "1" }, { p: 0.5, gameId: "2" }], 3.64);
  assert.ok(Math.abs(pc.p - 0.3) < 1e-9);
  assert.ok(Math.abs(pc.ev - (0.3 * 3.64 - 1)) < 1e-9);
  assert.equal(pc.sameGame, false);
  assert.equal(parlayCheck([{ p: 0.6, gameId: "1" }, { p: 0.5, gameId: "1" }], 3).sameGame, true);
  assert.equal(parlayCheck([{ p: null }], 3).p, null);
});

test("best parlay takes the top +EV legs, one per game", () => {
  const mk = (id, margin) => ({ game: { id }, view: view({ ...pred, margin, pHome: phi(margin / 13) }, null), options: [
    { key: `${id}|spread|home`, leg: { market: "spread", side: "home", line: -3 }, odds: 1.909 },
    { key: `${id}|spread|away`, leg: { market: "spread", side: "away", line: 3 }, odds: 1.909 },
  ] });
  const picks = bestParlay([mk("a", 10), mk("b", -9), mk("c", 3), mk("d", 6)], 2);
  assert.deepEqual(picks.map((p) => p.key), ["b|spread|away", "a|spread|home"], "best value first: away +3 in a game the model has the away side winning by 9");
  assert.equal(bestParlay([mk("c", 3)], 3).length, 0, "no +EV legs, no parlay");
  const team = (id, h, a, margin) => ({ ...mk(id, margin), game: { id, home: { id: h }, away: { id: a } } });
  const twoWeeks = bestParlay([team("w1", "TEN", "IND", 10), team("w2", "TEN", "JAX", 9), team("w3", "KC", "LV", 8)], 3);
  assert.deepEqual(twoWeeks.map((p) => p.game.id), ["w1", "w3"], "a team appears once");
  const longshot = { game: { id: "z" }, view: view({ ...pred, margin: -2, pHome: phi(-2 / 13) }, null), options: [{ key: "z|ml|home", leg: { market: "ml", side: "home" }, odds: 3.5 }] };
  assert.equal(bestParlay([longshot], 1).length, 0, "underdog lottery tickets are left out (under 50%)");
});

test("backtest scores a season without peeking ahead", () => {
  const { games } = league({ weeks: 14 });
  const card = backtest(games, { sport: "nfl", skipWeeks: 2 });
  assert.ok(card.games > 200);
  assert.ok(card.suPct > 0.55, `straight-up ${card.suPct}`);
  assert.ok(card.maeModel > 0 && card.maeMarket > 0);
  assert.equal(card.blend.length, 11);
  assert.ok(card.ats.w + card.ats.l + card.ats.p > 0);
  assert.equal(typeof card.trusted, "boolean");
  const both = combine([card, card]);
  assert.equal(both.games, card.games * 2);
  assert.equal(both.atsPct, card.atsPct);
});

const bet = (legs, stake, status, d = 1.909, extra = {}) => ({ id: Math.random().toString(36), stake, legs: legs.map((pick, i) => ({ id: String(i), pick, odds: d, status: Array.isArray(status) ? status[i] : status, ...(legs.length === 1 ? {} : {}) })), ...extra });

test("no edges claimed on huge spreads, where ratings are least reliable", () => {
  const v = view({ ...pred, margin: 20, edgeMax: 17 }, { spread: { home: { line: -24.5 } } });
  assert.equal(v.noEdge, true);
  assert.equal(legEdge({ market: "spread", side: "away", line: 24.5 }, v, 1.909), null);
  assert.ok(legProb({ market: "spread", side: "away", line: 24.5 }, v) > 0, "the probability still shows");
});

test("backtest is fair: ~50% against a perfect market, wins big against a lazy one", () => {
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const teams = Array.from({ length: 32 }, (_, i) => [String(i), g() * 7]);
  const season = (mkt) => {
    const out = [];
    for (let w = 0; w < 18; w++) {
      const o = [...teams].sort(() => r() - 0.5);
      for (let i = 0; i + 1 < o.length; i += 2) {
        const exp = o[i][1] - o[i + 1][1] + 2, m = exp + g() * 13, t = 44 + g() * 10;
        out.push({ id: `${w}-${i}`, d: new Date(Date.parse("2025-09-07T17:00Z") + w * 7 * 864e5).toISOString(), h: o[i][0], a: o[i + 1][0], hs: Math.round((t + m) / 2), as: Math.round((t - m) / 2), n: false, sp: mkt(exp), tot: 44 });
      }
    }
    return out;
  };
  const sharp = backtest(season((e) => -Math.round(e * 2) / 2), { sport: "nfl", skipWeeks: 3 });
  assert.ok(sharp.atsStrongPct > 0.42 && sharp.atsStrongPct < 0.6, `sharp ${sharp.atsStrongPct}`);
  assert.equal(sharp.trusted, false);
  const lazy = backtest(season(() => 0), { sport: "nfl", skipWeeks: 3 });
  assert.ok(lazy.atsStrongPct > 0.65, `lazy ${lazy.atsStrongPct}`);
  assert.equal(lazy.trusted, true);
  assert.ok(lazy.bestWeight >= 0.8);
});

test("no edges on long shots or big-game moneylines", () => {
  const v = view({ ...pred, margin: 21, pHome: phi(21 / 13) }, { spread: { home: { line: -21.5 } } });
  assert.equal(legEdge({ market: "ml", side: "away" }, v, 40), null, "a +3900 dog is never 'value'");
  const close = view({ ...pred, margin: -1, pHome: phi(-1 / 13) }, { spread: { home: { line: -3 } } });
  assert.ok(legEdge({ market: "ml", side: "away" }, close, 2.3), "a close game's moneyline is fine");
});

test("home field stays sane early in the season, even when strong teams host weak ones", () => {
  // Week-1 style slate: every home team is far better than its visitor.
  const games = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, d: "2026-09-05T18:00:00Z", h: `S${i}`, a: `W${i}`, hs: 52, as: 7, n: false }));
  const m = fitRatings(games, { sport: "cfb", asOf: Date.parse("2026-09-07T00:00:00Z") });
  assert.ok(m.hfa >= 1 && m.hfa <= 4, `hfa ${m.hfa}`);
});
