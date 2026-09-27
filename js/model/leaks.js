// Where your money goes: your settled bets broken down by structure, market and price,
// compared with what those prices implied, plus plain-English takeaways. Pure — tested.

import { betStatus, betProfit, ticketDecimal } from "../grade.js";
import { marketName } from "../autopsy.js";
import { fmtMoney } from "../odds.js";

const HOLD = 0.045; // typical house edge per leg at standard prices

const band = (d) => (d <= 1.5 ? "Big favorites (-200 or shorter)" : d < 2 ? "Favorites (-199 to -101)" : d <= 2.25 ? "Near even (+100 to +125)" : d < 4 ? "Underdogs (+126 to +299)" : "Long shots (+300 or longer)");
const structure = (b) => (b.legs.length === 1 ? "Straight bets" : b.legs.length === 2 ? "2-leg parlays" : "3+ leg parlays");
const market = (b) => (b.legs.length > 1 ? null : b.legs[0].market === "prop" ? "Player props" : marketName(b.legs[0]));

function group(bets, keyFn) {
  const m = new Map();
  for (const b of bets) {
    const k = keyFn(b);
    if (!k) continue;
    if (!m.has(k)) m.set(k, { key: k, n: 0, w: 0, l: 0, staked: 0, profit: 0, expW: 0, be: 0, cost: 0 });
    const g = m.get(k);
    const st = betStatus(b);
    const d = ticketDecimal(b);
    g.n++;
    if (st === "won" || (st === "cashout" && betProfit(b) > 0)) g.w++;
    else if (st === "lost" || (st === "cashout" && betProfit(b) < 0)) g.l++;
    g.staked += b.stake;
    g.profit += betProfit(b);
    // What the price says (1/d) minus the book's cut on each leg ≈ the fair chance.
    g.be += d > 1 ? 1 / d : 0;
    g.expW += d > 1 ? (1 / d) * Math.pow(1 - HOLD, b.legs.length) : 0;
    g.cost += b.stake * (1 - Math.pow(1 - HOLD, b.legs.length));
  }
  return [...m.values()].map((g) => ({ ...g, roi: g.staked ? g.profit / g.staked : 0 })).sort((a, b) => a.profit - b.profit);
}

/** Parlays that lost only one leg, and what they'd have paid. */
function oneAway(bets) {
  const hits = bets.filter((b) => b.legs.length > 1 && betStatus(b) === "lost" && b.legs.filter((l) => l.status === "lost").length === 1 && b.legs.every((l) => l.status !== "open"));
  return { n: hits.length, paid: hits.reduce((s, b) => s + b.stake * ticketDecimal(b), 0) };
}

export function leaks(allBets) {
  const bets = allBets.filter((b) => !b.ghost && betStatus(b) !== "open" && betStatus(b) !== "void" && b.stake > 0);
  const byStructure = group(bets, structure);
  const byMarket = group(bets, market);
  const byPrice = group(bets.filter((b) => b.legs.length === 1), (b) => band(ticketDecimal(b)));
  const total = group(bets, () => "All")[0] || { n: 0, w: 0, l: 0, staked: 0, profit: 0, expW: 0, be: 0, cost: 0, roi: 0 };
  const near = oneAway(bets);
  const insights = [];
  if (total.n < 5) return { bets: bets.length, total, byStructure, byMarket, byPrice, near, insights: [{ tone: "even", text: "Settle a few more bets and this will show where your money is going." }] };

  const worst = [...byStructure, ...byMarket, ...byPrice].filter((g) => g.n >= 4 && g.profit <= -Math.max(10, total.staked * 0.02)).sort((a, b) => a.profit - b.profit)[0];
  if (worst) {
    const share = total.profit < 0 ? Math.min(1, worst.profit / total.profit) : null;
    insights.push({ tone: "bad", text: `Biggest leak: ${worst.key.toLowerCase()}, ${fmtMoney(worst.profit)} on ${worst.n} bets (${worst.w}-${worst.l})${share && share > 0.4 ? `. That's ${Math.round(share * 100)}% of what you're down` : ""}.` });
  }
  const parl = byStructure.filter((g) => g.key !== "Straight bets");
  const pN = parl.reduce((s, g) => s + g.n, 0), pW = parl.reduce((s, g) => s + g.w, 0), pExp = parl.reduce((s, g) => s + g.expW, 0), pProfit = parl.reduce((s, g) => s + g.profit, 0);
  if (pN >= 5) {
    insights.push({ tone: pProfit < 0 ? "bad" : "good", text: `Parlays: ${pW} of ${pN} hit${pExp ? ` (the prices expected about ${pExp.toFixed(1)})` : ""}, ${fmtMoney(pProfit, { sign: true })}. Each extra leg adds the book's cut again, so they cost more over time even when you pick well.` });
  }
  if (near.n >= 2) insights.push({ tone: "warn", text: `${near.n} parlay${near.n > 1 ? "s" : ""} lost by a single leg; together they'd have paid ${fmtMoney(near.paid)}. Those picks were mostly right. Playing the strongest legs as straight bets keeps those wins.` });
  const favs = byPrice.filter((g) => g.key.startsWith("Big favorites"));
  for (const g of favs) {
    if (g.n >= 5) {
      const need = g.be / g.n;
      insights.push({ tone: g.profit < 0 ? "bad" : "even", text: `Big favorites: you won ${g.w} of ${g.n} (${Math.round((g.w / g.n) * 100)}%), but at those prices you need about ${Math.round(need * 100)}% just to break even. One loss wipes out several wins.` });
    }
  }
  const straight = byStructure.find((g) => g.key === "Straight bets");
  if (straight && straight.n >= 5 && pN >= 5 && straight.roi > parl.reduce((s, g) => s + g.profit, 0) / Math.max(1, parl.reduce((s, g) => s + g.staked, 0))) {
    insights.push({ tone: "good", text: `Your straight bets are doing better (${fmtMoney(straight.profit, { sign: true })}, ${(straight.roi * 100).toFixed(1)}% ROI). That's where your picking skill shows up.` });
  }
  const best = [...byMarket, ...byPrice].filter((g) => g.n >= 5 && g.profit > 0).sort((a, b) => b.roi - a.roi)[0];
  if (best) insights.push({ tone: "good", text: `Best spot: ${best.key.toLowerCase()}, ${best.w}-${best.l}, ${fmtMoney(best.profit, { sign: true })}.` });
  const luck = total.w - total.expW;
  insights.push({
    tone: "even",
    text: Math.abs(luck) < Math.max(1.5, total.n * 0.05)
      ? `You've won about as many bets as the prices said you would (${total.w} vs ~${total.expW.toFixed(1)}). The results aren't bad luck: the structure and the book's cut are doing the damage.`
      : luck < 0
        ? `You've won ${Math.abs(luck).toFixed(1)} fewer bets than the prices implied. Some of that is bad luck and should even out.`
        : `You've won ${luck.toFixed(1)} more bets than the prices implied, so you're picking well.`,
  });
  insights.push({ tone: "even", text: `You've paid roughly ${fmtMoney(total.cost)} in house edge across ${total.n} bets${pN ? `, most of it on parlays` : ""}.` });
  return { bets: bets.length, total, byStructure, byMarket, byPrice, near, insights };
}
