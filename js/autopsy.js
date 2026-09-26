// Ghost bets (picks tracked but never placed) and the parlay autopsy. Pure functions over
// the bet model in grade.js, so everything here is unit-tested.

import { betStatus, betProfit, legDecimal, ticketDecimal, summarize } from "./grade.js";

export const isGhost = (b) => !!b.ghost;
export const realBets = (bets) => bets.filter((b) => !b.ghost);
export const ghostBets = (bets) => bets.filter((b) => b.ghost);

/** Spread / Total / Moneyline / Props & futures, from linked markets or the pick text. */
export function marketName(leg) {
  const known = { ml: "Moneyline", spread: "Spread", total: "Total" }[leg.market];
  if (known) return known;
  const pick = leg.pick || "";
  if (/\bml\b|moneyline/i.test(pick)) return "Moneyline";
  if (/\b(over|under|o\/u)\b/i.test(pick)) return "Total";
  if (/[+-]\d+(\.5)?\b/.test(pick)) return "Spread";
  return "Props & futures";
}

/**
 * How your passes did next to your real bets over the same stretch.
 * `since` limits both to bets settled after that date (like the P/L period chips).
 */
export function ghostReport(bets, { since } = {}) {
  const ghosts = summarize(ghostBets(bets), { since });
  const real = summarize(realBets(bets), { since });
  const inWindow = (b) => !since || new Date(b.settledAt || b.createdAt) >= since;
  const settledGhosts = ghostBets(bets).filter((b) => betStatus(b) !== "open" && inWindow(b));
  const dodged = settledGhosts.filter((b) => betStatus(b) === "lost").reduce((s, b) => s + b.stake, 0);
  const missed = settledGhosts.filter((b) => betStatus(b) === "won").reduce((s, b) => s + betProfit(b), 0);
  let verdict = null;
  if (ghosts.count >= 3 && real.count >= 3) {
    const gap = ghosts.roi - real.roi;
    if (gap > 0.1) verdict = { tone: "warn", text: "Your passes are beating your real bets. The ones you skip have been the better picks." };
    else if (gap < -0.1) verdict = { tone: "good", text: "Good instincts: the picks you pass on do worse than the ones you play." };
    else verdict = { tone: "even", text: "Your passes and your real bets are performing about the same." };
  }
  return { ghosts, real, dodged, missed, verdict };
}

/** Legs in the order they played: by kickoff when known, otherwise as entered. */
export function playOrder(bet) {
  return bet.legs
    .map((l, i) => ({ l, i, t: l.kickoff ? Date.parse(l.kickoff) : NaN }))
    .sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t || a.i - b.i : a.i - b.i))
    .map((x) => x.l);
}

/** What the same stake would have made split evenly across the legs as straight bets. */
export function asStraights(bet) {
  const n = bet.legs.length;
  if (!n) return 0;
  const each = bet.stake / n;
  return bet.legs.reduce((s, l) => s + (l.status === "won" ? each * (legDecimal(l) - 1) : l.status === "lost" ? -each : 0), 0);
}

/** The leg(s) that sank a lost parlay, in play order. */
export const bustedLegs = (bet) => playOrder(bet).filter((l) => l.status === "lost");

/**
 * Autopsy across settled parlays (real bets only by default; cash-outs excluded since
 * the legs didn't decide them).
 */
export function parlayAutopsy(bets) {
  const parlays = bets.filter((b) => b.legs.length > 1 && ["won", "lost"].includes(betStatus(b)));
  const lost = parlays.filter((b) => betStatus(b) === "lost");
  const won = parlays.filter((b) => betStatus(b) === "won");

  // Lost by exactly one leg: every other leg won (or pushed).
  const oneAway = lost.filter((b) => b.legs.filter((l) => l.status === "lost").length === 1);
  const oneAwayPayout = oneAway.reduce((s, b) => s + b.stake * ticketDecimal(b), 0);

  // Which markets miss most, across every graded parlay leg.
  const byMarket = new Map();
  for (const b of parlays) {
    for (const l of b.legs) {
      if (l.status !== "won" && l.status !== "lost") continue;
      const k = marketName(l);
      const m = byMarket.get(k) || { market: k, legs: 0, lost: 0 };
      m.legs++;
      if (l.status === "lost") m.lost++;
      byMarket.set(k, m);
    }
  }
  const markets = [...byMarket.values()].map((m) => ({ ...m, missRate: m.lost / m.legs })).sort((a, b) => b.legs - a.legs);
  const killer = markets.filter((m) => m.legs >= 3).sort((a, b) => b.missRate - a.missRate)[0] || null;

  // Where the bust happens: was the losing leg the last one to play?
  let lastLegBusts = 0;
  const position = {}; // "1st", "2nd", … of the first leg that lost
  for (const b of lost) {
    const order = playOrder(b);
    const first = order.findIndex((l) => l.status === "lost");
    const lastLost = order.length - 1 - [...order].reverse().findIndex((l) => l.status === "lost");
    if (first === -1) continue;
    const key = first === order.length - 1 ? "Last" : ["1st", "2nd", "3rd"][first] || `${first + 1}th`;
    position[key] = (position[key] || 0) + 1;
    if (lastLost === order.length - 1 && first === lastLost) lastLegBusts++; // only the final leg missed
  }

  // By size: actual hit rate vs what the ticket odds implied (vig included → a bit high).
  const bySize = new Map();
  for (const b of parlays) {
    const k = b.legs.length >= 5 ? "5+" : String(b.legs.length);
    const s = bySize.get(k) || { size: k, count: 0, won: 0, implied: 0 };
    s.count++;
    if (betStatus(b) === "won") s.won++;
    s.implied += 1 / ticketDecimal(b);
    bySize.set(k, s);
  }
  const sizes = [...bySize.values()].map((s) => ({ ...s, hitRate: s.won / s.count, impliedRate: s.implied / s.count })).sort((a, b) => a.size.localeCompare(b.size, "en", { numeric: true }));

  const parlayProfit = parlays.reduce((s, b) => s + betProfit(b), 0);
  const straightsProfit = parlays.reduce((s, b) => s + asStraights(b), 0);
  const staked = parlays.reduce((s, b) => s + b.stake, 0);

  return {
    count: parlays.length,
    won: won.length,
    lost: lost.length,
    staked,
    oneAway: oneAway.length,
    oneAwayPayout,
    markets,
    killer,
    lastLegBusts,
    position,
    sizes,
    parlayProfit,
    straightsProfit,
  };
}
