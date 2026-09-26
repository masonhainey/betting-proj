// What deserves an alert, and what it says. Shared by the app (in-app alerts) and the
// server worker (alerts with the app closed), so both word things the same way.
// Pure functions — unit-tested.

import { betStatus, betProfit, gradeLeg, legLabel, ticketDecimal } from "./grade.js";
import { formatOdds, fmtMoney } from "./odds.js";

export const DEFAULT_PREFS = { legs: true, bets: true, kickoff: true, redzone: true, ghosts: true };

const what = (bet, game) => (bet.legs.length > 1 ? `${bet.legs.length}-leg parlay (${formatOdds(ticketDecimal(bet))})` : legLabel(bet.legs[0], game(bet.legs[0].gameId)));

/** Alert for a bet that just settled. */
export function betEvent(bet, game) {
  const st = betStatus(bet);
  const g = bet.ghost ? "👻 " : "";
  const name = what(bet, game);
  const p = betProfit(bet);
  const busted = bet.legs.find((l) => l.status === "lost");
  const ev = { key: `bet:${bet.id}`, tag: `bet-${bet.id}`, url: "#bets", type: "bets", ghost: !!bet.ghost };
  if (st === "won") return { ...ev, title: `${g}💰 ${bet.ghost ? "Your pass hit" : "Cashed"}: ${name}`, body: bet.ghost ? `Would've won ${fmtMoney(p, { sign: true })}. Trust the gut next time?` : `${fmtMoney(p, { sign: true })} · pays ${fmtMoney(bet.stake + p)}` };
  if (st === "lost") {
    const how = bet.legs.length > 1 && busted ? `${legLabel(busted, game(busted.gameId))} missed.` : "";
    return { ...ev, title: `${g}${bet.legs.length > 1 ? "☠️" : "❌"} ${bet.ghost ? "Good pass" : "Lost"}: ${name}`, body: bet.ghost ? `${how} Dodged ${fmtMoney(bet.stake)}.`.trim() : `${how} ${fmtMoney(p)}`.trim() };
  }
  if (st === "push" || st === "void") return { ...ev, title: `${g}➖ Push: ${name}`, body: bet.ghost ? "No harm either way." : "Stake back." };
  return null;
}

/** Alert for one parlay leg that just settled (while the rest of the parlay is still alive). */
export function legEvent(bet, leg, game) {
  const g = bet.ghost ? "👻 " : "";
  const label = legLabel(leg, game(leg.gameId));
  const left = bet.legs.filter((l) => l.status === "open").length;
  const hit = bet.legs.filter((l) => l.status === "won").length;
  const ev = { key: `leg:${bet.id}:${leg.id}`, tag: `leg-${bet.id}-${leg.id}`, url: "#bets", type: "legs", ghost: !!bet.ghost };
  if (leg.status === "won") return { ...ev, title: `${g}✅ ${label} hit`, body: `${hit} of ${bet.legs.length} in on your ${bet.legs.length}-leg parlay. ${left} to go.` };
  if (leg.status === "push" || leg.status === "void") return { ...ev, title: `${g}➖ ${label} pushed`, body: `Your parlay lives on at shorter odds. ${left} to go.` };
  return null;
}

/**
 * Server side: grade open legs against final scores and return new alerts. Bets are not
 * modified. The app re-grades itself next time it opens.
 */
export function computeServerEvents(bets, game, { prefs = DEFAULT_PREFS } = {}) {
  const out = [];
  const kicked = new Map(); // gameId → your legs on it
  for (const bet of bets) {
    if (bet.ghost && prefs.ghosts === false) continue;
    if (betStatus(bet) !== "open") continue; // already settled on a device: you've seen it
    const clone = { ...bet, legs: bet.legs.map((l) => ({ ...l })) };
    const fresh = [];
    for (const leg of clone.legs) {
      if (leg.status !== "open" || !leg.gameId) continue;
      const g = game(leg.gameId);
      const grade = gradeLeg(leg, g);
      if (grade) {
        leg.status = grade;
        fresh.push(leg);
      } else if (g?.state === "in" && g.period === 1 && !bet.ghost) {
        if (!kicked.has(g.id)) kicked.set(g.id, { g, legs: [] });
        kicked.get(g.id).legs.push(legLabel(leg, g));
      }
    }
    if (!fresh.length) continue;
    if (betStatus(clone) !== "open") {
      if (prefs.bets !== false) out.push(betEvent(clone, game));
    } else if (prefs.legs !== false && clone.legs.length > 1) {
      for (const leg of fresh) {
        const ev = legEvent(clone, leg, game);
        if (ev) out.push(ev);
      }
    }
  }
  if (prefs.kickoff !== false) {
    for (const { g, legs } of kicked.values()) {
      out.push({ key: `kick:${g.id}`, tag: `kick-${g.id}`, url: "#live", type: "kickoff", ghost: false, title: `🏈 Kickoff: ${g.shortName}`, body: `You have ${[...new Set(legs)].join(", ")}` });
    }
  }
  return out.filter(Boolean);
}
