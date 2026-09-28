// From a model prediction to what matters when you bet: each side's real chance of
// hitting, versus what the price implies. Pure — unit-tested.
//
// The final numbers blend the model with the market (books' lines are sharp; the model
// only moves the needle where it strongly disagrees). WEIGHT is how much the model counts.

import { americanToDecimal } from "../odds.js";
import { phi, phiInv } from "./ratings.js";

export const WEIGHT = 0.35;
const MIN_P = 0.3; // no edges claimed on long shots

/** Market's expected home margin: from the spread, else from the moneyline. */
export function marketMargin(odds, sigma) {
  if (odds?.spread?.home?.line != null) return -odds.spread.home.line;
  const ml = odds?.ml;
  if (ml?.home && ml?.away) {
    const ph = 1 / americanToDecimal(ml.home), pa = 1 / americanToDecimal(ml.away);
    return phiInv(ph / (ph + pa)) * sigma;
  }
  return null;
}

export const ESPN_WEIGHT = 0.2; // ESPN's matchup predictor, when the game summary has one

/**
 * Blend model, ESPN's predictor and the market into the numbers hedgehog uses.
 * lf: live factors (injuries, rest, weather adjust the model's side; espnHome is ESPN's
 * win chance for the home team).
 */
export function view(pred, odds, weight = WEIGHT, lf = null) {
  if (!pred) return null;
  const modelMargin = pred.margin + (lf?.margin || 0);
  const modelTotal = pred.total + (lf?.total || 0);
  const mm = marketMargin(odds, pred.sigma);
  const mt = odds?.total?.line ?? null;
  const p = lf?.espnHome;
  const em = p > 0 && p < 1 ? phiInv(Math.min(0.97, Math.max(0.03, p))) * pred.sigma : null;
  const wm = weight, we = em == null ? 0 : ESPN_WEIGHT, wk = mm == null ? 0 : Math.max(0, 1 - weight - we);
  const sum = wm + we + wk;
  const margin = (wm * modelMargin + we * (em ?? 0) + wk * (mm ?? 0)) / sum;
  const total = mt == null ? modelTotal : weight * modelTotal + (1 - weight) * mt;
  // Huge spreads are where ratings are least reliable: show numbers, but claim no edge.
  const noEdge = mm != null && Math.abs(mm) > (pred.edgeMax ?? 24);
  return {
    margin, total, pHome: phi(margin / pred.sigma), sigma: pred.sigma, sigmaTotal: pred.sigmaTotal, model: pred, marketMargin: mm, marketTotal: mt, thin: pred.thin, noEdge,
    parts: { base: pred.margin, model: modelMargin, espn: em, market: mm, w: { model: wm / sum, espn: we / sum, market: wk / sum }, baseTotal: pred.total, modelTotal },
  };
}

/** Chance a leg hits. leg: { market: 'ml'|'spread'|'total', side, line }. */
export function legProb(leg, v) {
  if (!v || !leg) return null;
  if (leg.market === "ml") return leg.side === "home" ? v.pHome : leg.side === "away" ? 1 - v.pHome : null;
  if (leg.market === "spread" && Number.isFinite(leg.line)) {
    if (leg.side === "home") return phi((v.margin + leg.line) / v.sigma);
    if (leg.side === "away") return phi((leg.line - v.margin) / v.sigma);
  }
  if (leg.market === "total" && Number.isFinite(leg.line)) {
    const pOver = phi((v.total - leg.line) / v.sigmaTotal);
    return leg.side === "over" ? pOver : leg.side === "under" ? 1 - pOver : null;
  }
  return null;
}

/** Everything the UI shows for one priced leg. odds: decimal. */
export function legEdge(leg, v, odds) {
  if (v?.noEdge && leg.market !== "total") return null;
  // Moneylines in lopsided games live in the tails, where a bell curve overrates underdogs.
  if (leg.market === "ml" && Math.abs(v?.marketMargin ?? v?.margin ?? 0) > 10) return null;
  const p = legProb(leg, v);
  if (p == null || !(odds > 1) || p < MIN_P) return null;
  const implied = 1 / odds;
  return { p, implied, edge: p - implied, ev: p * odds - 1 };
}

/** Fair (no-edge) American price for a probability. */
export function fairAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

/**
 * A parlay's true hit chance and expected value (legs treated as independent; same-game
 * legs are flagged because they usually aren't).
 */
export function parlayCheck(legs, payoutDecimal) {
  const known = legs.filter((l) => l.p != null);
  const p = known.length === legs.length ? known.reduce((a, l) => a * l.p, 1) : null;
  const games = legs.map((l) => l.gameId).filter(Boolean);
  const sameGame = new Set(games).size < games.length;
  return { p, ev: p != null && payoutDecimal > 1 ? p * payoutDecimal - 1 : null, sameGame, unknown: legs.length - known.length };
}

/** The best-value side in a game, from its priced options ({ key, leg, odds }). */
export function bestOption(options, v) {
  let best = null;
  for (const o of options) {
    const e = legEdge(o.leg, v, o.odds);
    if (e && (!best || e.ev > best.e.ev)) best = { ...o, e };
  }
  return best;
}

/**
 * Pick the n best-value legs from different games for a parlay. options: per game, a list
 * of priced options. Only legs the model rates as +EV (by at least minEv) qualify.
 */
export function bestParlay(gameOptions, n = 3, { minEv = 0.01, minP = 0.5 } = {}) {
  const ranked = gameOptions
    .map(({ game, options, view: v }) => {
      const b = bestOption(options.filter((o) => (legProb(o.leg, v) ?? 0) >= minP), v);
      return b && b.e.ev >= minEv ? { game, ...b } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.e.ev - a.e.ev);
  // One leg per team: no stacking the same team from two different weeks.
  const used = new Set();
  const picks = [];
  for (const p of ranked) {
    const teams = [p.game?.home?.id, p.game?.away?.id].filter(Boolean);
    if (teams.some((t) => used.has(t))) continue;
    teams.forEach((t) => used.add(t));
    picks.push(p);
    if (picks.length === n) break;
  }
  return picks;
}
