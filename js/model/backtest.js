// The model's report card: replay a season week by week, predicting each game using only
// games played before it, then score the predictions against what happened and against
// the closing line. Pure — unit-tested.

import { fitRatings, predict } from "./ratings.js";

const WEEK = 7 * 864e5;
// Beating -110 closing lines needs 52.4%. Ask for more, over a real sample, before trusting.
export const TRUST = { minGames: 60, minWin: 0.535 };
const STRONG_SPREAD = 3; // points of disagreement with the closing spread
const STRONG_TOTAL = 4;

const rec = () => ({ w: 0, l: 0, p: 0 });
const add = (r, x) => (x > 0 ? r.w++ : x < 0 ? r.l++ : r.p++);
const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : null);

/**
 * games: one season's compact games. prior: last season's fit ({ r, o, d }) or {}.
 * skipWeeks: weeks at the start not scored (used when there's no prior at all).
 */
export function backtest(games, { sport = "cfb", prior = {}, skipWeeks = 0 } = {}) {
  const gs = games.filter((g) => Number.isFinite(g.hs) && Number.isFinite(g.as)).sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
  const out = { sport, games: 0, su: { model: 0, market: 0, n: 0, nMarket: 0 }, mae: { model: 0, market: 0, n: 0 }, ats: rec(), atsStrong: rec(), ou: rec(), ouStrong: rec(), blend: [] };
  if (!gs.length) return finish(out);
  const start = Date.parse(gs[0].d);
  const weeks = Math.ceil((Date.parse(gs[gs.length - 1].d) - start) / WEEK) + 1;
  const pairs = []; // [model margin, market margin, actual] for the blend search
  for (let w = skipWeeks; w < weeks; w++) {
    const from = start + w * WEEK, to = from + WEEK;
    const wk = gs.filter((g) => { const t = Date.parse(g.d); return t >= from && t < to; });
    if (!wk.length) continue;
    const model = fitRatings(gs, { sport, asOf: from, prior });
    for (const g of wk) {
      const pr = predict(model, g.h, g.a, g.n);
      if (!pr) continue;
      const actual = g.hs - g.as;
      out.games++;
      out.su.n++;
      if (actual !== 0 && Math.sign(pr.margin) === Math.sign(actual)) out.su.model++;
      if (Number.isFinite(g.sp)) {
        const mkt = -g.sp;
        out.su.nMarket++;
        if (actual !== 0 && mkt !== 0 && Math.sign(mkt) === Math.sign(actual)) out.su.market++;
        out.mae.model += Math.abs(pr.margin - actual);
        out.mae.market += Math.abs(mkt - actual);
        out.mae.n++;
        pairs.push([pr.margin, mkt, actual]);
        // Against the spread: does the side the model prefers cover?
        const lean = pr.margin - mkt; // > 0: model likes home more than the market does
        const cover = actual + g.sp; // > 0: home covered
        if (lean !== 0) {
          add(out.ats, Math.sign(lean) * Math.sign(cover));
          if (Math.abs(lean) >= STRONG_SPREAD) add(out.atsStrong, Math.sign(lean) * Math.sign(cover));
        }
      }
      if (Number.isFinite(g.tot)) {
        const lean = pr.total - g.tot;
        const over = g.hs + g.as - g.tot;
        if (lean !== 0) {
          add(out.ou, Math.sign(lean) * Math.sign(over));
          if (Math.abs(lean) >= STRONG_TOTAL) add(out.ouStrong, Math.sign(lean) * Math.sign(over));
        }
      }
    }
  }
  // Which model/market mix would have predicted margins best?
  for (let i = 0; i <= 10; i++) {
    const wgt = i / 10;
    const err = pairs.reduce((s, [m, k, a]) => s + Math.abs(wgt * m + (1 - wgt) * k - a), 0);
    out.blend.push({ weight: wgt, mae: pairs.length ? err / pairs.length : null });
  }
  return finish(out);
}

function finish(o) {
  const n = o.mae.n || 1;
  const best = o.blend.filter((b) => b.mae != null).sort((a, b) => a.mae - b.mae)[0] || null;
  return {
    ...o,
    suPct: o.su.n ? o.su.model / o.su.n : null,
    suMarketPct: o.su.nMarket ? o.su.market / o.su.nMarket : null,
    maeModel: o.mae.n ? o.mae.model / n : null,
    maeMarket: o.mae.n ? o.mae.market / n : null,
    atsPct: pct(o.ats),
    atsStrongPct: pct(o.atsStrong),
    ouPct: pct(o.ou),
    ouStrongPct: pct(o.ouStrong),
    bestWeight: best?.weight ?? null,
    trusted: o.atsStrong.w + o.atsStrong.l >= TRUST.minGames && pct(o.atsStrong) >= TRUST.minWin,
    trustedTotals: o.ouStrong.w + o.ouStrong.l >= TRUST.minGames && pct(o.ouStrong) >= TRUST.minWin,
  };
}

/** Combine several seasons' report cards (e.g. last season + this one). */
export function combine(cards) {
  const sum = (f) => cards.reduce((s, c) => s + f(c), 0);
  const r = (k) => ({ w: sum((c) => c[k].w), l: sum((c) => c[k].l), p: sum((c) => c[k].p) });
  const merged = {
    sport: cards[0]?.sport,
    games: sum((c) => c.games),
    su: { model: sum((c) => c.su.model), market: sum((c) => c.su.market), n: sum((c) => c.su.n), nMarket: sum((c) => c.su.nMarket) },
    mae: { model: sum((c) => c.mae.model), market: sum((c) => c.mae.market), n: sum((c) => c.mae.n) },
    ats: r("ats"), atsStrong: r("atsStrong"), ou: r("ou"), ouStrong: r("ouStrong"),
    blend: (cards[0]?.blend || []).map((b, i) => {
      const n = sum((c) => (c.blend[i]?.mae != null ? c.mae.n : 0));
      return { weight: b.weight, mae: n ? sum((c) => (c.blend[i]?.mae ?? 0) * c.mae.n) / n : null };
    }),
  };
  return finish(merged);
}
