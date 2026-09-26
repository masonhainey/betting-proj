// Bet model + grading. A straight bet is just a bet with one leg, so every calculation
// runs through the same path.
//
// Bet  { id, createdAt, type: 'straight'|'parlay', stake, book, note, legs: Leg[],
//        oddsOverride?: decimal, boostPct?: number, cashout?: number, settledAt? }
// Leg  { id, pick, odds (decimal), status: 'open'|'won'|'lost'|'push'|'void',
//        gameId?, market?: 'ml'|'spread'|'total'|'prop'|'other', side?: 'home'|'away'|'over'|'under',
//        line?: number, gameLabel?, kickoff?, autoGraded? }

import { parlayDecimal } from "./odds.js";

export const SETTLED = new Set(["won", "lost", "push", "void", "cashout"]);

export function legDecimal(leg) {
  return leg.status === "push" || leg.status === "void" ? 1 : leg.odds;
}

/** Decimal odds the bet pays at, accounting for pushed legs and the book's own parlay price. */
export function betDecimal(bet) {
  const live = bet.legs.filter((l) => l.status !== "push" && l.status !== "void");
  let d;
  if (bet.oddsOverride > 1 && live.length === bet.legs.length) d = bet.oddsOverride;
  else d = parlayDecimal(bet.legs.map(legDecimal));
  if (bet.boostPct > 0 && d > 1) d = 1 + (d - 1) * (1 + bet.boostPct / 100);
  return d;
}

/** Odds at time of placement, ignoring later pushes — what the ticket said. */
export function ticketDecimal(bet) {
  let d = bet.oddsOverride > 1 ? bet.oddsOverride : parlayDecimal(bet.legs.map((l) => l.odds));
  if (bet.boostPct > 0 && d > 1) d = 1 + (d - 1) * (1 + bet.boostPct / 100);
  return d;
}

export function betStatus(bet) {
  if (bet.cashout != null) return "cashout";
  const s = bet.legs.map((l) => l.status);
  if (s.includes("lost")) return "lost";
  if (s.includes("open")) return "open";
  if (s.every((x) => x === "void")) return "void";
  if (s.every((x) => x === "push" || x === "void")) return "push";
  return "won";
}

/** Net profit of a settled bet; null when still open. */
export function betProfit(bet) {
  const st = betStatus(bet);
  if (st === "open") return null;
  if (st === "cashout") return bet.cashout - bet.stake;
  if (st === "lost") return -bet.stake;
  if (st === "push" || st === "void") return 0;
  return bet.stake * (betDecimal(bet) - 1);
}

export const potentialPayout = (bet) => bet.stake * ticketDecimal(bet);

export function legLabel(leg, game) {
  if (!game || !leg.market || leg.market === "prop" || leg.market === "other") return leg.pick;
  const team = leg.side === "home" ? game.home : leg.side === "away" ? game.away : null;
  if (leg.market === "ml") return `${team.short} ML`;
  if (leg.market === "spread") return `${team.short} ${leg.line > 0 ? "+" : ""}${leg.line === 0 ? "PK" : leg.line}`;
  if (leg.market === "total") return `${leg.side === "over" ? "Over" : "Under"} ${leg.line}`;
  return leg.pick;
}

function scores(game) {
  const h = Number(game.home.score), a = Number(game.away.score);
  return Number.isFinite(h) && Number.isFinite(a) ? { h, a } : null;
}

/**
 * Where a leg stands against a game right now. Returns a number where >0 is winning,
 * <0 losing, 0 push, plus a human sentence. null if the leg can't be auto-tracked.
 */
export function legMargin(leg, game) {
  if (!game || !leg.market || !["ml", "spread", "total"].includes(leg.market)) return null;
  const sc = scores(game);
  if (!sc) return null;
  if (leg.market === "total") {
    const sum = sc.h + sc.a;
    const m = leg.side === "over" ? sum - leg.line : leg.line - sum;
    return { margin: m, text: totalText(leg, sum, m) };
  }
  const mine = leg.side === "home" ? sc.h : sc.a;
  const theirs = leg.side === "home" ? sc.a : sc.h;
  const line = leg.market === "spread" ? Number(leg.line) || 0 : 0;
  const m = mine - theirs + line;
  let text;
  if (leg.market === "ml") text = m > 0 ? `Up ${m}` : m < 0 ? `Down ${-m}` : "Tied";
  else text = m > 0 ? `Covering by ${m}` : m < 0 ? `Need ${-m} to cover` : "On the number";
  return { margin: m, text };
}

function totalText(leg, sum, m) {
  if (leg.side === "over") return m > 0 ? `Over by ${m} · ${sum} pts` : `Need ${-m + (Number.isInteger(leg.line) ? 1 : 0.5)} more · ${sum} pts`;
  return m > 0 ? `${m} pts of room · ${sum} pts` : m < 0 ? `Over by ${-m} · ${sum} pts` : `On the number · ${sum} pts`;
}

/** Final grade for a leg once its game is over, or null if not gradeable yet. */
export function gradeLeg(leg, game) {
  if (!game || game.state !== "post" || !game.completed) return null;
  const r = legMargin(leg, game);
  if (!r) return null;
  return r.margin > 0 ? "won" : r.margin < 0 ? "lost" : "push";
}

/** Live view of a leg: pending / winning / losing / push / settled. */
export function legLive(leg, game) {
  if (leg.status !== "open") return { state: leg.status, text: "" };
  if (!game) return { state: "pending", text: "" };
  if (game.state === "pre") return { state: "pending", text: "" };
  const r = legMargin(leg, game);
  if (!r) return { state: game.state === "in" ? "live" : "pending", text: "" };
  return { state: r.margin > 0 ? "winning" : r.margin < 0 ? "losing" : "even", text: r.text };
}

/** Grade every open leg we can. Returns list of { bet, leg, grade } that changed. */
export function autoGrade(bets, gameById) {
  const changed = [];
  for (const bet of bets) {
    if (bet.cashout != null) continue;
    for (const leg of bet.legs) {
      if (leg.status !== "open" || !leg.gameId) continue;
      const g = gradeLeg(leg, gameById(leg.gameId));
      if (g) {
        leg.status = g;
        leg.autoGraded = true;
        changed.push({ bet, leg, grade: g });
      }
    }
    if (changed.some((c) => c.bet === bet) && betStatus(bet) !== "open" && !bet.settledAt) {
      bet.settledAt = new Date().toISOString();
    }
  }
  return changed;
}

// ---------- stats ----------

export function summarize(bets, { since } = {}) {
  const settled = bets
    .filter((b) => betStatus(b) !== "open")
    .filter((b) => !since || new Date(b.settledAt || b.createdAt) >= since)
    .sort((a, b) => new Date(a.settledAt || a.createdAt) - new Date(b.settledAt || b.createdAt));
  let w = 0, l = 0, p = 0, staked = 0, profit = 0, best = null;
  const curve = [];
  for (const b of settled) {
    const st = betStatus(b);
    const pr = betProfit(b);
    if (st === "won" || (st === "cashout" && pr > 0)) w++;
    else if (st === "lost" || (st === "cashout" && pr < 0)) l++;
    else p++;
    if (st !== "void") staked += b.stake;
    profit += pr;
    if (!best || pr > best.profit) best = { bet: b, profit: pr };
    curve.push({ t: new Date(b.settledAt || b.createdAt).getTime(), v: profit });
  }
  const open = bets.filter((b) => betStatus(b) === "open");
  let streak = 0, streakType = null;
  for (let i = settled.length - 1; i >= 0; i--) {
    const st = betStatus(settled[i]);
    const t = st === "won" ? "W" : st === "lost" ? "L" : null;
    if (!t) continue;
    if (!streakType) streakType = t;
    if (t !== streakType) break;
    streak++;
  }
  return {
    w, l, p,
    count: settled.length,
    staked, profit,
    roi: staked ? profit / staked : NaN,
    winRate: w + l ? w / (w + l) : NaN,
    best,
    curve,
    atRisk: open.reduce((s, b) => s + b.stake, 0),
    potential: open.reduce((s, b) => s + potentialPayout(b), 0),
    openCount: open.length,
    streak: streakType ? `${streakType}${streak}` : "—",
  };
}

export function breakdown(bets, keyFn) {
  const groups = new Map();
  for (const b of bets) {
    if (betStatus(b) === "open") continue;
    const k = keyFn(b) || "Other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, ...summarize(list) }))
    .sort((a, b) => b.count - a.count);
}
