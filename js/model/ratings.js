// hedgehog ratings: team power ratings from game results. Pure — unit-tested.
//
// Margin model:  home margin ≈ r_home − r_away + hfa (0 at neutral sites)
// Points model:  home pts ≈ μ + off_home + def_away + hfa/2,  away pts ≈ μ + off_away + def_home − hfa/2
//
// Fit by weighted least squares with a pull toward each team's prior (last season's
// rating, regressed), recent games weighted more, blowout margins capped.
//
// Game record (compact, from history.js):
//   { id, d: ISO date, h: home id, a: away id, hs, as, n: neutral, sp?: closing home spread, tot?: closing total }

export const CONFIG = {
  cfb: { edgeMax: 24, cap: 28, ptsCap: 56, hfa: 2.5, hfaWeight: 400, sigma: 15.5, sigmaTotal: 16, regress: 0.8, unknownPrior: -16, halfLife: 400, lambda: 0.3, lambdaPts: 2.5, mu: 28, marketMix: 0.7 },
  nfl: { edgeMax: 17, cap: 21, ptsCap: 45, hfa: 1.8, hfaWeight: 400, sigma: 13, sigmaTotal: 12.5, regress: 0.8, unknownPrior: 0, halfLife: 80, lambda: 2.5, lambdaPts: 3, mu: 22, marketMix: 0.4 },
};

const DAY = 864e5;
// Blowouts count, but past the cap each extra point counts a third (garbage time is noise).
const clamp = (x, c) => (Math.abs(x) <= c ? x : Math.sign(x) * (c + (Math.abs(x) - c) / 3));

/**
 * Fit ratings on games before `asOf`.
 * prior: { r, o, d } maps from last season's fit (regressed here), or empty.
 */
export function fitRatings(games, { sport = "cfb", asOf = Date.now(), prior = {}, tune = {} } = {}) {
  const C = { ...(CONFIG[sport] || CONFIG.cfb), ...tune };
  const t0 = typeof asOf === "number" ? asOf : Date.parse(asOf);
  const gs = games
    .filter((g) => Date.parse(g.d) < t0 && Number.isFinite(g.hs) && Number.isFinite(g.as))
    .map((g) => ({
      ...g,
      w: Math.pow(0.5, (t0 - Date.parse(g.d)) / DAY / C.halfLife),
      f: g.n ? 0 : 1,
      // What a game says about the teams: its result, partly corrected toward the closing line
      // (one fluky result says less than the market's read of both teams).
      y: Number.isFinite(g.sp) && C.marketMix ? (1 - C.marketMix) * (g.hs - g.as) + C.marketMix * -g.sp : g.hs - g.as,
    }));
  const byTeam = new Map();
  for (const g of gs) {
    for (const t of [g.h, g.a]) {
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push(g);
    }
  }
  // Teams we barely see (in college: FCS opponents) start well below average.
  const pr = (map, t, fallback) => (map?.[t] != null ? map[t] * C.regress : fallback);
  const teams = [...byTeam.keys()];
  const p = {}, po = {}, pd = {};
  for (const t of teams) {
    const known = prior.r?.[t] != null;
    const few = byTeam.get(t).length < 3;
    p[t] = pr(prior.r, t, !known && few ? C.unknownPrior : 0);
    po[t] = pr(prior.o, t, !known && few ? C.unknownPrior / 2 : 0);
    pd[t] = pr(prior.d, t, !known && few ? -C.unknownPrior / 2 : 0);
  }
  const r = { ...p };
  let hfa = C.hfa;
  for (let it = 0; it < 60; it++) {
    for (const t of teams) {
      let num = C.lambda * p[t], den = C.lambda;
      for (const g of byTeam.get(t)) {
        const y = clamp(g.y, C.cap);
        if (g.h === t) num += g.w * (y - hfa * g.f + r[g.a]);
        else num += g.w * (r[g.h] + hfa * g.f - y);
        den += g.w;
      }
      r[t] = num / den;
    }
    // Home field is learned only slowly from the data: early in the season, big programs
    // beating weak teams at home would otherwise read as a huge home edge.
    let hn = C.hfaWeight * C.hfa, hd = C.hfaWeight;
    for (const g of gs) if (g.f) { hn += g.w * (clamp(g.y, C.cap) - (r[g.h] - r[g.a])); hd += g.w; }
    hfa = Math.min(C.hfa + 1.5, Math.max(C.hfa - 1.5, hn / hd));
  }
  // Points: offense/defense, for totals.
  const o = { ...po }, d = { ...pd };
  let mu = C.mu;
  const cap = (x) => Math.min(C.ptsCap, x);
  for (let it = 0; it < 40; it++) {
    let mn = 10 * C.mu, md = 10;
    for (const g of gs) {
      mn += g.w * (cap(g.hs) - o[g.h] - d[g.a] - (hfa / 2) * g.f) + g.w * (cap(g.as) - o[g.a] - d[g.h] + (hfa / 2) * g.f);
      md += 2 * g.w;
    }
    mu = mn / md;
    for (const t of teams) {
      let on = C.lambdaPts * po[t], dn = C.lambdaPts * pd[t], den = C.lambdaPts;
      for (const g of byTeam.get(t)) {
        const home = g.h === t;
        const scored = cap(home ? g.hs : g.as), allowed = cap(home ? g.as : g.hs);
        const opp = home ? g.a : g.h;
        const hf = (hfa / 2) * g.f * (home ? 1 : -1);
        on += g.w * (scored - mu - d[opp] - hf);
        dn += g.w * (allowed - mu - o[opp] + hf);
        den += g.w;
      }
      o[t] = on / den;
      d[t] = dn / den;
    }
  }
  const n = Object.fromEntries(teams.map((t) => [t, byTeam.get(t).length]));
  return { sport, r, o, d, mu, hfa, n, asOf: t0, games: gs.length };
}

/** Standard normal CDF. */
export function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const y = 1 - 0.3989422804014327 * Math.exp((-x * x) / 2) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? y : 1 - y;
}

/** Inverse of phi (for turning a moneyline into an implied margin). */
export function phiInv(p) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (phi(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Model's view of one game: home margin, total, home win chance. null if a team is unknown. */
export function predict(model, home, away, neutral = false) {
  if (!model) return null;
  const C = CONFIG[model.sport] || CONFIG.cfb;
  const has = (t) => model.r[t] != null;
  if (!has(home) && !has(away)) return null;
  const rv = (t) => (has(t) ? model.r[t] : C.unknownPrior);
  const f = neutral ? 0 : 1;
  const margin = rv(home) - rv(away) + model.hfa * f;
  const ov = (m, t) => m[t] ?? (C.unknownPrior ? C.unknownPrior / 2 : 0);
  const dv = (m, t) => m[t] ?? (C.unknownPrior ? -C.unknownPrior / 2 : 0);
  const total = 2 * model.mu + ov(model.o, home) + ov(model.o, away) + dv(model.d, home) + dv(model.d, away);
  return { margin, total, pHome: phi(margin / C.sigma), sigma: C.sigma, sigmaTotal: C.sigmaTotal, edgeMax: C.edgeMax, thin: (model.n[home] || 0) < 3 || (model.n[away] || 0) < 3 };
}
