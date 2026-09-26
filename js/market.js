// Sportsbook board markets, market sim, and the bet slip.

import { americanToDecimal, parseOdds, stepOdds, parlayDecimal, toWin, impliedProb } from "./odds.js";
import { legLabel } from "./grade.js";
import { uid } from "./store.js";
import { paintDock, render } from "./render.js";
import { S, game, num, saveBets, saveSettings, saveSlip, settings, toast } from "./state.js";

// ───────────────────────────── markets / slip ─────────────────────────────

export function markets(g) {
  if (!g?.odds || g.state !== "pre") return null;
  const o = g.odds;
  const a = S.simAdj[g.id] || {};
  const mk = (market, side, line, am) => {
    if (am == null) return null;
    let d = americanToDecimal(am);
    if (!Number.isFinite(d)) return null;
    const key = `${g.id}|${market}|${side}`;
    const ticks = a[key] || 0;
    for (let i = 0; i < Math.abs(ticks); i++) d = stepOdds(d, Math.sign(ticks), "american");
    return { key, gameId: g.id, market, side, line, odds: d };
  };
  const hl = o.spread ? o.spread.home.line + (a.sl || 0) : null;
  const tl = o.total ? o.total.line + (a.tl || 0) : null;
  return {
    spreadAway: o.spread ? mk("spread", "away", -hl, o.spread.away.price) : null,
    spreadHome: o.spread ? mk("spread", "home", hl, o.spread.home.price) : null,
    over: o.total ? mk("total", "over", tl, o.total.over) : null,
    under: o.total ? mk("total", "under", tl, o.total.under) : null,
    mlAway: o.ml?.away != null ? mk("ml", "away", null, o.ml.away) : null,
    mlHome: o.ml?.home != null ? mk("ml", "home", null, o.ml.home) : null,
  };
}

export function selByKey(key) {
  const g = game(key.split("|")[0]);
  const m = markets(g);
  return m ? Object.values(m).find((s) => s?.key === key) || null : null;
}

export function boardGames() {
  const now = Date.now();
  return [...S.games.values()]
    .filter((g) => g.state === "pre" && g.odds && new Date(g.date) - now < 9 * 864e5 && new Date(g.date) > now - 3600e3)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export function detectMoves() {
  const now = Date.now();
  for (const g of boardGames()) {
    const m = markets(g);
    for (const s of Object.values(m)) {
      if (!s) continue;
      const p = S.lastPrices[s.key];
      if (p && (p.line !== s.line || Math.abs(p.odds - s.odds) > 1e-6)) {
        const better = s.line !== p.line ? (s.market === "total" ? (s.side === "over" ? s.line < p.line : s.line > p.line) : s.line > p.line) : s.odds > p.odds;
        S.moves[s.key] = { dir: better ? "up" : "down", at: now };
      }
      S.lastPrices[s.key] = { line: s.line, odds: s.odds };
    }
  }
  for (const [k, v] of Object.entries(S.moves)) if (now - v.at > 20000) delete S.moves[k];
  if (settings.autoAccept) {
    for (const l of S.slip.legs) {
      const s = !l.custom && !l.edited && selByKey(l.key);
      if (s) Object.assign(l, { line: s.line, odds: s.odds });
    }
  }
}

export function simStep() {
  const gs = boardGames();
  if (!gs.length) return;
  // Bias the sim toward games already in the slip so you can watch your ticket move.
  const slipGames = [...new Set(S.slip.legs.map((l) => l.gameId).filter(Boolean))];
  for (let n = 0; n < 3; n++) {
    const g = slipGames.length && Math.random() < 0.5 ? game(slipGames[Math.floor(Math.random() * slipGames.length)]) : gs[Math.floor(Math.random() * gs.length)];
    if (!g) continue;
    const a = (S.simAdj[g.id] ||= {});
    const m = markets(g);
    const r = Math.random();
    if (r < 0.15 && m.spreadHome) {
      a.sl = (a.sl || 0) + (Math.random() < 0.5 ? 0.5 : -0.5);
    } else if (r < 0.25 && m.over) {
      a.tl = (a.tl || 0) + (Math.random() < 0.5 ? 0.5 : -0.5);
    } else {
      const pairs = [["spreadAway", "spreadHome"], ["over", "under"], ["mlAway", "mlHome"]].filter(([x]) => m[x]);
      if (!pairs.length) continue;
      const [x, y] = pairs[Math.floor(Math.random() * pairs.length)];
      const dir = Math.random() < 0.5 ? 1 : -1;
      // Move both sides in opposite directions, like a real book adjusting to money.
      a[m[x].key] = Math.max(-6, Math.min(6, (a[m[x].key] || 0) + dir));
      if (m[y]) a[m[y].key] = Math.max(-6, Math.min(6, (a[m[y].key] || 0) - dir));
    }
  }
  detectMoves();
  if (S.tab === "build" || S.sheet?.kind === "slip" || S.sheet?.kind === "game") render();
  else paintDock();
}

export let simTimer = null;
export function setSim(on) {
  S.sim = on;
  clearInterval(simTimer);
  if (on) simTimer = setInterval(simStep, 2200);
  else {
    S.simAdj = {};
    detectMoves();
  }
  render();
}

export function slipLegFromSel(s) {
  const g = game(s.gameId);
  const leg = { id: uid(), key: s.key, sport: g?.sport, gameId: s.gameId, market: s.market, side: s.side, line: s.line, odds: s.odds, marketOdds: s.odds, status: "open" };
  leg.pick = legLabel(leg, g);
  leg.gameLabel = g.shortName;
  leg.kickoff = g.date;
  return leg;
}

export function toggleSel(key) {
  const i = S.slip.legs.findIndex((l) => l.key === key);
  if (i >= 0) S.slip.legs.splice(i, 1);
  else {
    const s = selByKey(key);
    if (!s) return;
    S.slip.legs.push(slipLegFromSel(s));
    if (S.slip.legs.length === 1) S.slip.mode = "singles";
    else if (S.slip.legs.length === 2 && S.slip.mode === "singles" && !S.slip.modeTouched) S.slip.mode = "parlay";
  }
  saveSlip();
  render();
}

export function slipCalc() {
  const legs = S.slip.legs;
  const pd = parlayDecimal(legs.map((l) => l.odds));
  const override = parseOdds(S.slip.override)?.decimal;
  const boost = num(S.slip.boost);
  let d = override > 1 ? override : pd;
  if (boost > 0) d = 1 + (d - 1) * (1 + boost / 100);
  const stake = num(S.slip.stake);
  const calcPayout = stake > 0 ? stake * d : 0;
  const ticket = num(S.slip.ticket);
  if (ticket > 0 && stake > 0) d = ticket / stake;
  const singles = legs.map((l) => {
    const st = num(S.slip.stakes[l.id] ?? "");
    return { id: l.id, stake: st, win: toWin(st, l.odds) };
  });
  const gameCounts = {};
  for (const l of legs) if (l.gameId) gameCounts[l.gameId] = (gameCounts[l.gameId] || 0) + 1;
  const sameGame = Object.values(gameCounts).some((c) => c > 1);
  const conflict = legs.some((a, i) => legs.some((b, j) => j > i && a.gameId && a.gameId === b.gameId && a.market === b.market));
  return {
    legs,
    parlayOdds: d,
    rawParlay: pd,
    stake,
    win: toWin(stake, d),
    payout: stake > 0 ? stake * d : 0,
    calcPayout,
    ticket,
    prob: impliedProb(pd),
    singles,
    singlesRisk: singles.reduce((s, x) => s + x.stake, 0),
    singlesWin: singles.reduce((s, x) => s + x.win, 0),
    sameGame,
    conflict,
  };
}

export function trackSlip() {
  const c = slipCalc();
  const book = S.slip.book?.trim() || "";
  const now = new Date().toISOString();
  const ghost = S.slip.ghost ? { ghost: true } : {};
  const mkLeg = (l) => ({ id: uid(), pick: l.pick, odds: l.odds, status: "open", gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff, sport: l.sport });
  let added = 0;
  const unnamed = c.legs.find((l) => l.custom && !l.pick.trim());
  if (unnamed) return toast("Give your custom selection a name", "err");
  if (c.legs.some((l) => !(l.odds > 1))) return toast("One of the prices doesn't look right", "err");
  if (S.slip.mode === "parlay") {
    if (c.legs.length < 2) return toast("A parlay needs at least two legs", "err");
    if (c.conflict) return toast("Two legs on the same market of one game can't be parlayed", "err");
    if (!(c.stake > 0)) return toast("Enter a stake", "err");
    const override = parseOdds(S.slip.override)?.decimal;
    S.bets.unshift({ id: uid(), createdAt: now, type: "parlay", stake: c.stake, book, legs: c.legs.map(mkLeg), oddsOverride: override > 1 ? override : null, boostPct: num(S.slip.boost) || 0, ...(c.ticket > 0 ? { ticketPayout: c.ticket } : {}), ...ghost });
    added = 1;
  } else {
    for (const l of c.legs) {
      const st = num(S.slip.stakes[l.id]);
      if (!(st > 0)) continue;
      S.bets.unshift({ id: uid(), createdAt: now, type: "straight", stake: st, book, legs: [mkLeg(l)], ...ghost });
      added++;
    }
    if (!added) return toast("Enter a stake on at least one selection", "err");
  }
  if (book) settings.lastBook = book, saveSettings();
  saveBets();
  S.slip = { mode: S.slip.mode, legs: [], stakes: {}, stake: settings.unit, override: "", boost: "", ticket: "", book, ghost: S.slip.ghost };
  saveSlip();
  if (S.sheet?.kind === "slip") S.sheet = null;
  if (ghost.ghost) S.f.betsTab = "ghosts";
  toast(ghost.ghost ? `👻 Tracking ${added > 1 ? `${added} passes` : "your pass"} on the Ghosts tab` : added > 1 ? `Tracking ${added} bets` : "Bet tracked. It's on your Bets tab", "won");
  render();
}
