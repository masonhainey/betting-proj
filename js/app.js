import * as espn from "./espn.js";
import * as demo from "./demo.js";
import { ymd, addDays } from "./espn.js";
import {
  americanToDecimal, parseOdds, formatOdds, stepOdds, parlayDecimal, toWin, stakeForWin,
  hedge, impliedProb, noVig, fmtMoney, fmtPct, fmtLine,
} from "./odds.js";
import {
  betStatus, betProfit, betDecimal, ticketDecimal, potentialPayout, legLive, legLabel,
  autoGrade, summarize, breakdown, SETTLED, computedDecimal,
} from "./grade.js";
import { parseSlipText, linkPick, readScore } from "./slipparse.js";
import { readImage } from "./ocr.js";
import * as cloud from "./cloud.js";
import { emptyMeta, syncOnce } from "./sync.js";
import { load, save, uid, DEFAULT_SETTINGS } from "./store.js";
import { TAGS, tagArticle, mentionsTeam } from "./news.js";
import {
  esc, tzAbbr, fmtTime, fmtDay, fmtDayLong, fmtDayTime, dayKey, startOfDay, ago, relDay,
  logo, rank, statusText, curveSvg, icons, rankedBadge, winProb, pct, wpBar,
} from "./ui.js";

// ───────────────────────────── state ─────────────────────────────

const settings = { ...DEFAULT_SETTINGS, ...load("settings", {}) };
const NS = settings.demo ? "demo." : "";
const TABS = ["bets", "live", "schedule", "build", "news"];
const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "ESPN BET", "Fanatics", "bet365", "Hard Rock", "BetRivers", "Bovada", "Other"];

const S = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "bets",
  bets: load(NS + "bets", []),
  games: new Map(),
  todayIds: [],
  scheduleIds: [],
  news: [],
  st: { today: {}, schedule: {}, news: {}, betGames: {} },
  kick: load(NS + "kickoffs", {}),
  lines: load(NS + "lines", {}),
  slip: { mode: "parlay", legs: [], stakes: {}, stake: settings.unit, override: "", boost: "", book: settings.lastBook || "", ...load(NS + "slip", {}) },
  f: { live: "all", q: "", top25: settings.top25Only, hasLine: false, news: "all", period: "all", betsTab: "open", buildDay: "all", buildQ: "" },
  sheet: null,
  form: null,
  sim: false,
  simAdj: {},
  lastPrices: {},
  moves: {},
  confirmDelete: null,
};

const src = () => (settings.demo ? demo : espn);
const game = (id) => S.games.get(id);
const fmt = () => settings.oddsFormat;
const odds = (d) => formatOdds(d, fmt());
const saveBets = () => {
  save(NS + "bets", S.bets);
  syncSoon();
};
const saveSlip = () => save(NS + "slip", S.slip);
const saveSettings = () => {
  save("settings", settings);
  syncSoon();
};
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ───────────────────────────── data ─────────────────────────────

function loadCache() {
  const c = load(NS + "cache", null);
  if (!c?.games) return;
  const tomorrow = addDays(startOfDay(), 1);
  const today = dayKey(new Date());
  for (const g of c.games) S.games.set(g.id, g);
  S.scheduleIds = c.games.filter((g) => new Date(g.date) >= tomorrow).map((g) => g.id);
  S.todayIds = c.games.filter((g) => dayKey(g.date) === today).map((g) => g.id);
  S.st.schedule.cachedAt = c.at;
}

function saveCache() {
  const ids = new Set([...S.scheduleIds, ...S.todayIds]);
  save(NS + "cache", { at: S.st.schedule.at || Date.now(), games: [...ids].map(game).filter(Boolean) });
}

function merge(games) {
  const now = Date.now();
  for (const g of games) {
    S.games.set(g.id, g);
    const k = S.kick[g.id];
    if (!k) S.kick[g.id] = { d: g.date, tv: g.timeValid };
    else if (g.state === "pre" && (k.d !== g.date || k.tv !== g.timeValid)) {
      S.kick[g.id] = { d: g.date, tv: g.timeValid, pd: k.d, ptv: k.tv, at: now };
    }
    if (g.state === "pre" && g.odds) {
      const snap = { s: g.odds.spread?.home.line ?? null, t: g.odds.total?.line ?? null, mh: g.odds.ml?.home ?? null, ma: g.odds.ml?.away ?? null };
      const L = S.lines[g.id];
      if (!L) S.lines[g.id] = { first: snap, fa: now, last: snap, la: now, label: g.shortName, date: g.date, moves: [] };
      else if (JSON.stringify(L.last) !== JSON.stringify(snap)) {
        L.moves = [...(L.moves || []), { from: L.last, to: snap, at: now }].slice(-6);
        L.last = snap;
        L.la = now;
      }
    }
  }
}

function pruneTracking() {
  const cutoff = Date.now() - 3 * 864e5;
  for (const [id, k] of Object.entries(S.kick)) if (new Date(k.d) < cutoff) delete S.kick[id];
  for (const [id, L] of Object.entries(S.lines)) if (new Date(L.date) < cutoff) delete S.lines[id];
}

function afterData() {
  const changed = autoGrade(S.bets, game);
  if (changed.length) {
    saveBets();
    for (const c of changed) {
      const done = betStatus(c.bet);
      if (c.bet.legs.length > 1 && done === "open") {
        toast(`${c.grade === "won" ? "✅" : c.grade === "lost" ? "❌" : "➖"} Leg ${c.grade}: ${legLabel(c.leg, game(c.leg.gameId))}`, c.grade);
      }
    }
    const settledBets = [...new Set(changed.map((c) => c.bet))].filter((b) => betStatus(b) !== "open");
    for (const b of settledBets) {
      const p = betProfit(b);
      const st = betStatus(b);
      const what = b.legs.length > 1 ? `${b.legs.length}-leg parlay` : legLabel(b.legs[0], game(b.legs[0].gameId));
      toast(st === "won" ? `💰 Cashed: ${what} ${fmtMoney(p, { sign: true })}` : st === "lost" ? `Lost: ${what} (${fmtMoney(p)})` : `Push: ${what} — stake back`, st, st === "won");
    }
  }
  detectMoves();
  save(NS + "kickoffs", S.kick);
  save(NS + "lines", S.lines);
  render();
}

async function refreshToday() {
  const st = S.st.today;
  st.loading = true;
  paintStatus();
  try {
    const games = await src().fetchScoreboard(ymd(new Date()));
    merge(games);
    S.todayIds = games.map((g) => g.id);
    st.at = Date.now();
    st.error = null;
    if (settings.demo && !load("demo.seeded", false)) seedDemo();
    saveCache();
  } catch (e) {
    st.error = e.message || "Feed error";
  }
  st.loading = false;
  afterData();
}

async function refreshSchedule() {
  const st = S.st.schedule;
  st.loading = true;
  paintStatus();
  try {
    const start = addDays(startOfDay(), 1);
    const { games, failedDays } = await src().fetchRange(start, 28);
    merge(games);
    const tomorrow = start.getTime();
    // Keep previously-loaded games for any day that failed this round.
    const failed = new Set(failedDays.map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`));
    const keep = S.scheduleIds.filter((id) => failed.has(dayKey(game(id)?.date)));
    S.scheduleIds = [...new Set([...games.map((g) => g.id), ...keep])].filter((id) => new Date(game(id).date) >= tomorrow);
    st.failedDays = failedDays;
    st.at = Date.now();
    st.error = null;
    pruneTracking();
    saveCache();
  } catch (e) {
    st.error = e.message || "Feed error";
  }
  st.loading = false;
  afterData();
}

/** Open bets on games from earlier days (e.g. a late game you haven't seen graded). */
async function refreshBetGames() {
  const st = S.st.betGames;
  const today = dayKey(new Date());
  const days = new Set();
  for (const b of S.bets) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      if (l.status !== "open" || !l.gameId || !l.kickoff) continue;
      const g = game(l.gameId);
      const k = dayKey(l.kickoff);
      if (k < today && (!g || g.state !== "post") && Date.now() - new Date(l.kickoff) < 14 * 864e5) days.add(k.replaceAll("-", ""));
    }
  }
  if (!days.size) return;
  st.loading = true;
  const res = await Promise.allSettled([...days].map((d) => src().fetchScoreboard(d)));
  for (const r of res) if (r.status === "fulfilled") merge(r.value);
  st.at = Date.now();
  st.loading = false;
  afterData();
}

async function refreshNews() {
  const st = S.st.news;
  st.loading = true;
  paintStatus();
  try {
    S.news = (await src().fetchNews()).map((a) => ({ ...a, tags: tagArticle(a) }));
    st.at = Date.now();
    st.error = null;
  } catch (e) {
    st.error = e.message || "News unavailable";
  }
  st.loading = false;
  render();
}

function tick(force) {
  if (document.hidden && !force) return;
  const now = Date.now();
  const todays = S.todayIds.map(game).filter(Boolean);
  const hot = todays.some((g) => g.state === "in" || (g.state === "pre" && new Date(g.date) - now < 15 * 60000));
  const due = (name, every, fn) => {
    const st = S.st[name];
    if (st.loading) return;
    const ev = st.error ? Math.min(every, 45000) : every;
    if (force || !st.tried || now - st.tried >= ev) {
      st.tried = now;
      fn();
    }
  };
  due("today", hot ? (settings.demo ? 8000 : 20000) : 120000, refreshToday);
  due("schedule", 600000, refreshSchedule);
  due("betGames", 90000, refreshBetGames);
  due("news", 600000, refreshNews);
  paintAgo();
  if (CLOUD && cloud.currentUser() && !document.hidden && Date.now() - Math.max(acct.lastSync, acct.lastTry || 0) > 30000) syncNow();
}

// ───────────────────────────── markets / slip ─────────────────────────────

function markets(g) {
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

function selByKey(key) {
  const g = game(key.split("|")[0]);
  const m = markets(g);
  return m ? Object.values(m).find((s) => s?.key === key) || null : null;
}

function boardGames() {
  const now = Date.now();
  return [...S.games.values()]
    .filter((g) => g.state === "pre" && g.odds && new Date(g.date) - now < 9 * 864e5 && new Date(g.date) > now - 3600e3)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function detectMoves() {
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

function simStep() {
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

let simTimer = null;
function setSim(on) {
  S.sim = on;
  clearInterval(simTimer);
  if (on) simTimer = setInterval(simStep, 2200);
  else {
    S.simAdj = {};
    detectMoves();
  }
  render();
}

function slipLegFromSel(s) {
  const g = game(s.gameId);
  const leg = { id: uid(), key: s.key, gameId: s.gameId, market: s.market, side: s.side, line: s.line, odds: s.odds, marketOdds: s.odds, status: "open" };
  leg.pick = legLabel(leg, g);
  leg.gameLabel = g.shortName;
  leg.kickoff = g.date;
  return leg;
}

function toggleSel(key) {
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

function slipCalc() {
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

function trackSlip() {
  const c = slipCalc();
  const book = S.slip.book?.trim() || "";
  const now = new Date().toISOString();
  const mkLeg = (l) => ({ id: uid(), pick: l.pick, odds: l.odds, status: "open", gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff });
  let added = 0;
  const unnamed = c.legs.find((l) => l.custom && !l.pick.trim());
  if (unnamed) return toast("Give your custom selection a name", "err");
  if (c.legs.some((l) => !(l.odds > 1))) return toast("One of the prices doesn't look right", "err");
  if (S.slip.mode === "parlay") {
    if (c.legs.length < 2) return toast("A parlay needs at least two legs", "err");
    if (c.conflict) return toast("Two legs on the same market of one game can't be parlayed", "err");
    if (!(c.stake > 0)) return toast("Enter a stake", "err");
    const override = parseOdds(S.slip.override)?.decimal;
    S.bets.unshift({ id: uid(), createdAt: now, type: "parlay", stake: c.stake, book, legs: c.legs.map(mkLeg), oddsOverride: override > 1 ? override : null, boostPct: num(S.slip.boost) || 0, ...(c.ticket > 0 ? { ticketPayout: c.ticket } : {}) });
    added = 1;
  } else {
    for (const l of c.legs) {
      const st = num(S.slip.stakes[l.id]);
      if (!(st > 0)) continue;
      S.bets.unshift({ id: uid(), createdAt: now, type: "straight", stake: st, book, legs: [mkLeg(l)] });
      added++;
    }
    if (!added) return toast("Enter a stake on at least one selection", "err");
  }
  if (book) settings.lastBook = book, saveSettings();
  saveBets();
  S.slip = { mode: S.slip.mode, legs: [], stakes: {}, stake: settings.unit, override: "", boost: "", ticket: "", book };
  saveSlip();
  if (S.sheet?.kind === "slip") S.sheet = null;
  toast(added > 1 ? `Tracking ${added} bets` : "Bet tracked — it's on your Bets tab", "won");
  render();
}

// ───────────────────────────── demo seed ─────────────────────────────

function seedDemo() {
  save("demo.seeded", true);
  const books = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "ESPN BET"];
  const teams = ["Georgia", "Texas", "Oregon", "Ohio State", "Miami", "LSU", "Ole Miss", "Utah", "Iowa State", "Boise State", "Tennessee", "BYU", "SMU", "Penn State", "Clemson", "Notre Dame"];
  let seed = 42;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickTeam = () => teams[Math.floor(r() * teams.length)];
  const straightPick = () => {
    const t = pickTeam();
    const k = r();
    if (k < 0.45) return { pick: `${t} ${r() < 0.5 ? "-" : "+"}${(Math.floor(r() * 20) + 1) / 2 + 0.5}`, odds: americanToDecimal([-110, -105, -115, -112][Math.floor(r() * 4)]) };
    if (k < 0.75) return { pick: `${t} ML`, odds: americanToDecimal(r() < 0.5 ? -(120 + Math.floor(r() * 30) * 10) : 110 + Math.floor(r() * 25) * 10) };
    return { pick: `${r() < 0.5 ? "Over" : "Under"} ${40 + Math.floor(r() * 30) + 0.5} · ${t}`, odds: americanToDecimal(-110) };
  };
  const bets = [];
  for (let i = 0; i < 38; i++) {
    const when = new Date(Date.now() - (32 - i * 0.82) * 864e5);
    const parlay = r() < 0.3;
    const legs = Array.from({ length: parlay ? 2 + Math.floor(r() * 3) : 1 }, () => ({ id: uid(), ...straightPick(), status: "open" }));
    const winP = parlay ? 0.3 : 0.55;
    const outcome = r();
    if (outcome < winP) legs.forEach((l) => (l.status = "won"));
    else if (outcome < winP + 0.04 && !parlay) legs[0].status = "push";
    else {
      legs.forEach((l) => (l.status = r() < 0.6 ? "won" : "lost"));
      if (!legs.some((l) => l.status === "lost")) legs[legs.length - 1].status = "lost";
    }
    bets.push({
      id: uid(), createdAt: when.toISOString(), settledAt: new Date(when.getTime() + 4 * 3600e3).toISOString(),
      type: parlay ? "parlay" : "straight", stake: parlay ? [5, 10, 10, 20][Math.floor(r() * 4)] : [10, 20, 25, 50][Math.floor(r() * 4)],
      book: books[Math.floor(r() * books.length)], legs,
    });
  }
  // Open bets on today's games so the live tracker has something to sweat.
  const today = S.todayIds.map(game).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
  const linked = (g, market, side, line, am) => {
    const leg = { id: uid(), gameId: g.id, market, side, line, odds: americanToDecimal(am), status: "open", gameLabel: g.shortName, kickoff: g.date };
    leg.pick = legLabel(leg, g);
    return leg;
  };
  const fin = today.find((g) => g.state === "post");
  const [live1, live2, live3] = today.filter((g) => g.state === "in");
  const [pre1, pre2] = today.filter((g) => g.state === "pre");
  const spreadOf = (g, side) => g.odds?.spread?.[side]?.line ?? 3.5;
  const totalOf = (g) => g.odds?.total?.line ?? 52.5;
  if (fin) bets.push({ id: uid(), createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(), type: "straight", stake: 25, book: "FanDuel", legs: [linked(fin, "spread", "home", spreadOf(fin, "home"), -110)] });
  if (live1) bets.push({ id: uid(), createdAt: new Date(Date.now() - 3600e3).toISOString(), type: "straight", stake: 30, book: "DraftKings", legs: [linked(live1, "spread", "away", spreadOf(live1, "away"), -110)] });
  if (live2 && live3 && pre1) {
    bets.push({
      id: uid(), createdAt: new Date(Date.now() - 1800e3).toISOString(), type: "parlay", stake: 10, book: "ESPN BET",
      legs: [linked(live2, "ml", "home", null, live2.odds?.ml?.home ?? -150), linked(live3, "total", "over", totalOf(live3), -110), linked(pre1, "spread", "away", spreadOf(pre1, "away"), -110)],
    });
  }
  if (pre2) bets.push({ id: uid(), createdAt: new Date().toISOString(), type: "straight", stake: 20, book: "BetMGM", legs: [linked(pre2, "total", "under", totalOf(pre2), -108)] });
  bets.push({ id: uid(), createdAt: new Date().toISOString(), type: "parlay", stake: 5, book: "FanDuel", boostPct: 25, legs: [
    { id: uid(), pick: "Heisman: Arch Manning", odds: americanToDecimal(900), status: "open" },
    { id: uid(), pick: "Texas to make CFP", odds: americanToDecimal(-250), status: "open" },
  ] });
  S.bets = bets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveBets();
}

// ───────────────────────────── accounts & sync ─────────────────────────────

// Sync is off in demo mode (demo bets are fake) and when no Supabase project is set.
const CLOUD = cloud.configured && !settings.demo;
const acct = { mode: "signin", email: "", busy: false, error: "", status: "idle", lastSync: 0, syncError: "" };
let syncMeta = load("sync", null);
let syncTimer = null;
let syncing = null;
let syncAgain = false;

function syncSoon(ms = 1500) {
  if (!CLOUD || !cloud.currentUser()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, ms);
}

async function syncNow({ announce = false } = {}) {
  const user = cloud.currentUser();
  if (!CLOUD || !user) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    if (!syncMeta || syncMeta.userId !== user.id) {
      // Bets left on this device by a *different* account are safe in that account;
      // don't mix them into this one.
      if (syncMeta?.userId && syncMeta.userId !== user.id) S.bets = [];
      syncMeta = emptyMeta(user.id);
    }
    acct.lastTry = Date.now();
    const first = !syncMeta.lastPull;
    const before = S.bets.length;
    acct.status = "syncing";
    paintAcct();
    try {
      const r = await syncOnce({ getBets: () => S.bets, remote: cloud.remote, meta: syncMeta, userId: user.id, settings });
      S.bets = r.bets;
      save("bets", S.bets);
      if (r.settings) {
        Object.assign(settings, r.settings);
        save("settings", settings);
      }
      save("sync", syncMeta);
      acct.lastSync = Date.now();
      acct.syncError = "";
      acct.status = "ok";
      const incoming = r.added + r.updated + r.removed;
      if (first) {
        toast(r.added ? `Synced: ${S.bets.length} bets in your account (${r.added} from your other device${r.added > 1 ? "s" : ""})` : `Synced: ${before} bet${before === 1 ? "" : "s"} backed up to your account`, "won");
      } else if (r.added) toast(`${r.added} new bet${r.added > 1 ? "s" : ""} from your other device`, "won");
      else if (announce) toast(incoming ? `Synced ${incoming} change${incoming > 1 ? "s" : ""}` : "Everything's up to date");
      if (incoming || r.settings || first) render();
    } catch (e) {
      acct.status = e.signedOut ? "idle" : "error";
      acct.syncError = e.message;
      if (announce && !e.signedOut) toast(e.message, "err");
    } finally {
      syncing = null;
      paintAcct();
      if (syncAgain) {
        syncAgain = false;
        syncSoon(300);
      }
    }
  })();
  return syncing;
}

cloud.onAuthChange((user) => {
  if (user) syncNow();
  else {
    acct.mode = "signin";
    acct.status = "idle";
  }
  if (S.sheet?.kind === "settings") S.sheet.dirty = true;
  render();
});

function acctStatus() {
  if (acct.status === "syncing") return "Syncing…";
  if (acct.status === "error") return `Couldn't sync: ${esc(acct.syncError)}. Will retry.`;
  if (acct.lastSync) return `Synced <span data-ago="${acct.lastSync}">${ago(acct.lastSync)}</span> · ${S.bets.length} bet${S.bets.length === 1 ? "" : "s"}`;
  return "Waiting to sync…";
}

function accountHtml() {
  const head = (title, sub) => `<div class="acct-h"><span class="acct-ico">${icons.cloud}</span><div><b>${title}</b><p class="muted small" id="acct-status">${sub}</p></div></div>`;
  if (settings.demo) return `<div class="acct">${head("Sync across devices", "Turn off demo mode to sign in.")}</div>`;
  if (!cloud.configured) return `<div class="acct">${head("Sync across devices", "Accounts aren't connected on this site yet.")}</div>`;
  const u = cloud.currentUser();
  if (u && acct.mode !== "newpw") {
    return `<div class="acct on">${head(esc(u.email || "Signed in"), acctStatus())}
      <div class="dactions"><button class="btn sm" data-act="sync-now" ${acct.status === "syncing" ? "disabled" : ""}>${icons.refresh} Sync now</button><span class="grow"></span><button class="btn sm ghost" data-act="sign-out">Sign out</button></div></div>`;
  }
  const err = acct.error ? `<p class="acct-err">${esc(acct.error)}</p>` : "";
  const email = (auto = "email") => `<input id="acct-email" class="acct-in" type="email" inputmode="email" autocomplete="${auto}" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(acct.email)}" aria-label="Email">`;
  const pw = (auto) => `<input id="acct-pw" class="acct-in" type="password" autocomplete="${auto}" placeholder="${auto === "new-password" ? "Choose a password (6+ characters)" : "Password"}" aria-label="Password">`;
  const btn = (act, label, busyLabel) => `<button class="btn primary block-sm" data-act="${act}" ${acct.busy ? "disabled" : ""}>${acct.busy ? busyLabel : label}</button>`;
  if (acct.mode === "newpw") {
    return `<div class="acct">${head("Set a new password", "You're signed in from the reset link. Choose a new password to finish.")}
      <div class="acct-col">${pw("new-password")}${btn("acct-newpw", "Save password", "Saving…")}</div>${err}</div>`;
  }
  if (acct.mode === "sent-confirm") {
    return `<div class="acct">${head("Confirm your email", `We sent a link to <b>${esc(acct.email)}</b>. Tap it (any browser is fine), then come back and sign in.`)}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">I've confirmed, sign in</button></p></div>`;
  }
  if (acct.mode === "sent-reset") {
    return `<div class="acct">${head("Check your email", `If <b>${esc(acct.email)}</b> has an account, a reset link is on its way. Open it to choose a new password.`)}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">Back to sign in</button></p></div>`;
  }
  if (acct.mode === "forgot") {
    return `<div class="acct">${head("Reset your password", "We'll email you a link to set a new one.")}
      <div class="acct-col">${email()}${btn("acct-reset", "Send reset link", "Sending…")}</div>${err}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">Back to sign in</button></p></div>`;
  }
  const signup = acct.mode === "signup";
  return `<div class="acct">${head(signup ? "Create your account" : "Sync your phone and computer", signup ? "One account keeps your bets in step on every device." : "Sign in and your bets stay in step on every device.")}
    <div class="seg acct-tabs"><button class="${signup ? "" : "on"}" data-act="acct-mode" data-v="signin">Sign in</button><button class="${signup ? "on" : ""}" data-act="acct-mode" data-v="signup">Create account</button></div>
    <form class="acct-col" data-form="acct" onsubmit="return false">${email(signup ? "email" : "username")}${pw(signup ? "new-password" : "current-password")}
    ${btn(signup ? "acct-signup" : "acct-signin", signup ? "Create account" : "Sign in", signup ? "Creating…" : "Signing in…")}</form>${err}
    ${signup ? "" : `<p class="muted small"><button class="link" data-act="acct-mode" data-v="forgot">Forgot password?</button></p>`}</div>`;
}

async function acctSubmit(fn, { needPw = true } = {}) {
  const email = ($("#acct-email")?.value ?? acct.email).trim();
  const pw = $("#acct-pw")?.value || "";
  acct.email = email;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    acct.error = "Enter your email address.";
    return paintAcct();
  }
  if (needPw && pw.length < 6) {
    acct.error = acct.mode === "signup" ? "Use a password with at least 6 characters." : "Enter your password.";
    return paintAcct();
  }
  acct.busy = true;
  acct.error = "";
  paintAcct();
  try {
    await fn(email, pw);
  } catch (e) {
    acct.error = e.message;
  }
  acct.busy = false;
  paintAcct();
}

function paintAcct() {
  const el = $("#acct");
  if (el) swap(el, accountHtml());
}

// ───────────────────────────── rendering ─────────────────────────────

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function swap(el, html) {
  if (!el) return;
  const a = document.activeElement;
  const id = a && el.contains(a) ? a.id : null;
  const sel = id && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = scroll;
  if (id) {
    const n = document.getElementById(id);
    if (n) {
      n.focus({ preventScroll: true });
      if (sel) try { n.setSelectionRange(...sel); } catch {}
    }
  }
}

function render() {
  document.body.dataset.tab = S.tab;
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.tab === S.tab));
  $("#fmt-toggle").innerHTML = fmtToggle("set-fmt");
  $("#demo-flag").hidden = !settings.demo;
  const views = { bets: viewBets, live: viewLive, schedule: viewSchedule, build: viewBuild, news: viewNews };
  swap($("#view"), views[S.tab]());
  paintDock();
  renderSheet();
}

function renderSheet() {
  const root = $("#sheet");
  if (!S.sheet) {
    root.hidden = true;
    root.innerHTML = "";
    document.body.classList.remove("sheet-open");
    return;
  }
  const k = S.sheet.kind;
  // Forms render once and update in place; live sheets re-render every refresh.
  if (root.dataset.kind === k && root.dataset.key === (S.sheet.id || "") && (k === "add" || k === "settings" || k === "import") && !S.sheet.dirty) return;
  S.sheet.dirty = false;
  const body = { add: sheetAdd, bet: sheetBet, game: sheetGame, settings: sheetSettings, import: sheetImport, slip: () => `<div class="sheet-h"><h2>Bet slip</h2>${closeBtn()}</div>${slipHtml()}` }[k]();
  root.dataset.kind = k;
  root.dataset.key = S.sheet.id || "";
  if (root.hidden) {
    root.hidden = false;
    root.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div><div class="panel-body" id="sheet-body"></div></div>`;
    document.body.classList.add("sheet-open");
  }
  swap($("#sheet-body"), body);
}

const closeBtn = () => `<button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.x}</button>`;

function openSheet(sheet) {
  S.sheet = { ...sheet, dirty: true };
  const root = $("#sheet");
  root.dataset.kind = "";
  render();
}

function paintStatus() {
  const el = $("#sync");
  if (!el) return;
  const busy = Object.values(S.st).some((s) => s.loading);
  const err = S.st.today.error && S.st.schedule.error;
  el.className = `sync ${busy ? "busy" : err ? "err" : "ok"}`;
  el.title = err ? `Feed error: ${S.st.today.error}` : `Scores updated ${ago(S.st.today.at)}`;
}

function paintAgo() {
  $$("[data-ago]").forEach((el) => (el.textContent = ago(Number(el.dataset.ago))));
  paintStatus();
}

function paintDock() {
  const dock = $("#dock");
  const n = S.slip.legs.length;
  if (!n || S.sheet?.kind === "slip") {
    dock.hidden = true;
    return;
  }
  const c = slipCalc();
  dock.hidden = false;
  const label = S.slip.mode === "parlay" && n > 1 ? `${n}-leg parlay · ${odds(c.parlayOdds)}` : `${n} selection${n > 1 ? "s" : ""}`;
  const right = S.slip.mode === "parlay" && n > 1 ? (c.stake ? `Win ${fmtMoney(c.win)}` : "") : c.singlesRisk ? `Win ${fmtMoney(c.singlesWin)}` : "";
  dock.innerHTML = `<button class="dock-btn" data-act="open-slip"><span class="dock-n">${n}</span><span class="dock-l">${esc(label)}</span><span class="dock-r">${right}</span></button>`;
}

let toastN = 0;
function toast(msg, kind = "", big = false) {
  const el = document.createElement("div");
  el.className = `toast ${kind} ${big ? "big" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  if (big && !matchMedia("(prefers-reduced-motion: reduce)").matches) confetti();
  const id = ++toastN;
  setTimeout(() => el.classList.add("out"), 3800 + (id % 3) * 100);
  setTimeout(() => el.remove(), 4400);
}

function confetti() {
  const box = document.createElement("div");
  box.className = "confetti";
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("i");
    p.style.setProperty("--x", `${Math.random() * 100}vw`);
    p.style.setProperty("--d", `${0.9 + Math.random() * 1.2}s`);
    p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    p.style.setProperty("--h", `${[150, 45, 200, 320][i % 4]}`);
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2600);
}

// ── shared components ──

const fmtToggle = (act) =>
  `<div class="seg sm" role="group" aria-label="Odds format">
    <button class="${fmt() === "american" ? "on" : ""}" data-act="${act}" data-v="american" title="American odds (+150 / -110)">US ±</button>
    <button class="${fmt() === "decimal" ? "on" : ""}" data-act="${act}" data-v="decimal" title="Decimal odds (2.50)">Dec ×</button>
  </div>`;

const chip = (label, act, v, on, extra = "") => `<button class="chip ${on ? "on" : ""}" data-act="${act}" data-v="${esc(v)}" ${extra}>${label}</button>`;

const pill = (st) => {
  const map = { open: "Open", won: "Won", lost: "Lost", push: "Push", void: "Void", cashout: "Cashed out", winning: "Winning", losing: "Losing", even: "Even", pending: "Pending", live: "Live" };
  return `<span class="pill ${st}">${map[st] || st}</span>`;
};

function myActionCount(gid) {
  return S.bets.filter((b) => betStatus(b) === "open" && b.legs.some((l) => l.gameId === gid && l.status === "open")).length;
}

function scoreRows(g, { big = false } = {}) {
  const wp = g.state === "pre" ? winProb(g) : null;
  const row = (t, side) => {
    const poss = g.state === "in" && g.situation?.possession === t.id;
    const lead = g.state !== "pre" && t.score != null && t.score > (side === "home" ? g.away.score : g.home.score);
    const p = wp?.[side];
    const slot = g.state === "pre"
      ? `<span class="wp ${p != null && p >= 0.5 ? "fav" : ""}" title="${wp ? `Win probability (no-vig ${wp.src})` : "No line yet"}">${p != null ? pct(p) : "—"}</span>`
      : `<span class="score ${lead ? "lead" : ""}">${t.score ?? ""}</span>`;
    return `<div class="trow ${g.state === "post" && !t.winner ? "dim" : ""}">
      ${logo(t, big ? 40 : 28)}
      <span class="tname">${rank(t)}${esc(big ? t.name : t.short)}${t.record ? `<small>${esc(t.record)}</small>` : ""}</span>
      ${poss ? `<span class="poss" title="Possession"></span>` : ""}
      ${slot}
    </div>`;
  };
  return row(g.away, "away") + row(g.home, "home") + (wp ? wpBar(g, wp) : "");
}

function kickBadge(g) {
  const k = S.kick[g.id];
  if (!k?.at || Date.now() - k.at > 72 * 3600e3) return "";
  const was = k.ptv === false ? "TBD" : fmtDayTime(k.pd);
  const label = k.ptv === false ? "Time set" : "Time changed";
  return `<span class="badge moved" title="Was ${esc(was)} · spotted ${esc(ago(k.at))}">${icons.clock}${label} · was ${esc(k.ptv === false ? "TBD" : fmtTime(k.pd))}</span>`;
}

function lineSummary(g) {
  const o = g.odds;
  if (!o) return "";
  const parts = [];
  if (o.spread) {
    const h = o.spread.home.line;
    parts.push(h === 0 ? "PK" : h < 0 ? `${esc(g.home.abbr)} ${h}` : `${esc(g.away.abbr)} ${-h}`);
  } else if (o.details) parts.push(esc(o.details));
  if (o.total) parts.push(`O/U ${o.total.line}`);
  return parts.join(" · ");
}

function selBtn(s, label, { compact = false } = {}) {
  if (!s) return `<button class="sel na" disabled>—</button>`;
  const on = S.slip.legs.some((l) => l.key === s.key);
  const mv = S.moves[s.key];
  return `<button class="sel ${on ? "on" : ""} ${mv ? `mv-${mv.dir}` : ""}" data-act="toggle-sel" data-key="${esc(s.key)}" aria-pressed="${on}">
    ${label ? `<span class="ln">${label}</span>` : ""}<span class="pr">${odds(s.odds)}${mv ? `<i class="arrow">${mv.dir === "up" ? "▲" : "▼"}</i>` : ""}</span>
  </button>`;
}

// ── Bets ──

function periodSince() {
  const p = S.f.period;
  return p === "7d" ? new Date(Date.now() - 7 * 864e5) : p === "30d" ? new Date(Date.now() - 30 * 864e5) : null;
}

function viewBets() {
  const sum = summarize(S.bets, { since: periodSince() });
  const open = S.bets.filter((b) => betStatus(b) === "open");
  const settled = S.bets.filter((b) => betStatus(b) !== "open").sort((a, b) => new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt));
  const sweating = open.filter((b) => b.legs.some((l) => l.status === "open" && game(l.gameId)?.state === "in"));

  if (!S.bets.length) {
    return `<section class="empty-hero">
      <div class="eh-mark">${icons.bets}</div>
      <h1>Your bets, front and center.</h1>
      <p>Log a pick from any book — straight or parlay, American or decimal odds — and hedgehog tracks it against live scores, grades it when the game ends, and keeps your P/L honest.</p>
      <div class="eh-actions">
        <button class="btn primary" data-act="open-add">${icons.plus} Add a pick</button>
        <button class="btn" data-act="tab" data-v="build">Build a slip</button>
        <button class="btn ghost" data-act="demo-on">Explore with demo data</button>
      </div>
      ${CLOUD && !cloud.currentUser() ? `<p class="eh-sync">${icons.cloud} Already using hedgehog on another device? <button class="link" data-act="open-settings">Sign in to sync your bets</button></p>` : ""}
      ${dropZone()}
    </section>`;
  }

  const profitCls = sum.profit > 0 ? "pos" : sum.profit < 0 ? "neg" : "";
  const hero = `<section class="card hero">
    <div class="hero-top">
      <div>
        <div class="eyebrow">Net profit</div>
        <div class="big ${profitCls}">${fmtMoney(sum.profit, { sign: true })}</div>
        <div class="sub">${sum.count} settled · ROI <b class="${profitCls}">${fmtPct(sum.roi)}</b></div>
      </div>
      <div class="seg sm">${["7d", "30d", "all"].map((p) => `<button class="${S.f.period === p ? "on" : ""}" data-act="period" data-v="${p}">${p === "all" ? "All" : p.toUpperCase()}</button>`).join("")}</div>
    </div>
    <div class="chart">${curveSvg(sum.curve)}</div>
    <div class="stats">
      <div><span>Record</span><b>${sum.w}-${sum.l}${sum.p ? `-${sum.p}` : ""}</b></div>
      <div><span>Win rate</span><b>${fmtPct(sum.winRate, 0)}</b></div>
      <div><span>Staked</span><b>${fmtMoney(sum.staked, { cents: false })}</b></div>
      <div><span>Streak</span><b class="${sum.streak[0] === "W" ? "pos" : sum.streak[0] === "L" ? "neg" : ""}">${sum.streak}</b></div>
      <div class="wide"><span>Open</span><b>${sum.openCount} · ${fmtMoney(sum.atRisk, { cents: false })} risk → ${fmtMoney(sum.potential, { cents: false })}</b></div>
    </div>
  </section>`;

  const sweat = sweating.length
    ? `<section><div class="sec-h"><h2><span class="dot live"></span>Sweating now</h2><span class="muted">${sweating.length} live</span></div>
       <div class="sweat">${sweating.map(sweatCard).join("")}</div></section>`
    : "";

  const tabs = `<div class="tabs">
    ${chip(`Open <em>${open.length}</em>`, "bets-tab", "open", S.f.betsTab === "open")}
    ${chip(`Settled <em>${settled.length}</em>`, "bets-tab", "settled", S.f.betsTab === "settled")}
    ${chip("Insights", "bets-tab", "insights", S.f.betsTab === "insights")}
    <span class="grow"></span>
    <button class="btn sm primary" data-act="open-add">${icons.plus} Add pick</button>
  </div>`;

  let list;
  if (S.f.betsTab === "insights") list = insightsHtml();
  else {
    const arr = S.f.betsTab === "open" ? open : settled;
    list = arr.length
      ? `<div class="bet-list">${groupByDay(arr, S.f.betsTab === "open" ? (b) => b.createdAt : (b) => b.settledAt || b.createdAt).map(([k, bs]) => `<div class="day-h">${esc(k)}</div>${bs.map(betCard).join("")}`).join("")}</div>`
      : `<div class="empty">${S.f.betsTab === "open" ? "No open bets. Tap <b>Add pick</b> or build a slip." : "Nothing settled yet."}</div>`;
  }
  const page = `<div class="view-h page"><div><div class="eyebrow">Game day workspace</div><h1>College football</h1><p class="muted">Track straight bets and parlays alongside live scores.</p></div></div>`;
  const syncBanner = CLOUD && !cloud.currentUser() && !settings.syncBannerDismissed
    ? `<div class="notice sync-banner">${icons.cloud}<span><b>Keep your phone and computer in sync.</b> Create a free account and your bets follow you everywhere.</span><button class="btn sm primary" data-act="open-settings">Sign in</button><button class="icon-btn sm" data-act="dismiss-sync" aria-label="Dismiss">${icons.x}</button></div>`
    : "";
  return `${page}${syncBanner}${dropZone()}<div class="bets-grid">${hero}<div>${sweat}${tabs}${list}</div></div>`;
}

function groupByDay(arr, dateFn) {
  const m = new Map();
  for (const x of arr) {
    const k = relDay(dateFn(x));
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.entries()];
}

function sweatCard(b) {
  const legs = b.legs.filter((l) => l.gameId && game(l.gameId)?.state === "in");
  return `<button class="sweat-card" data-act="open-bet" data-id="${b.id}">
    ${legs.map((l) => {
      const g = game(l.gameId);
      const lv = legLive(l, g);
      return `<div class="sw-leg ${lv.state}">
        <div class="sw-top"><span>${esc(legLabel(l, g))}</span>${pill(lv.state)}</div>
        <div class="sw-score">${logo(g.away, 20)}<b>${g.away.score ?? 0}</b><span class="muted">–</span><b>${g.home.score ?? 0}</b>${logo(g.home, 20)}<span class="clock">${esc(statusText(g))}</span></div>
        <div class="sw-text">${esc(lv.text)}</div>
      </div>`;
    }).join("")}
    <div class="sw-foot">${b.legs.length > 1 ? `${b.legs.length}-leg parlay · ` : ""}${fmtMoney(b.stake)} → ${fmtMoney(potentialPayout(b))}</div>
  </button>`;
}

function betCard(b) {
  const st = betStatus(b);
  const d = ticketDecimal(b);
  const isParlay = b.legs.length > 1;
  const profit = betProfit(b);
  const won = b.legs.filter((l) => l.status === "won").length;
  const legsHtml = b.legs.map((l) => {
    const g = game(l.gameId);
    const lv = legLive(l, g);
    const meta = g
      ? g.state === "pre"
        ? `${esc(g.shortName)} · ${esc(relDay(g.date))} ${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}`
        : `${esc(g.away.abbr)} ${g.away.score ?? 0} – ${esc(g.home.abbr)} ${g.home.score ?? 0} · ${esc(statusText(g))}${lv.text && l.status === "open" ? ` · <b>${esc(lv.text)}</b>` : ""}`
      : l.gameLabel
        ? `${esc(l.gameLabel)}${l.kickoff ? ` · ${esc(relDay(l.kickoff))}` : ""}`
        : "";
    return `<div class="leg ${lv.state}">
      <span class="ldot"></span>
      <div class="lmain"><div class="lpick">${esc(legLabel(l, g))}${l.autoGraded ? `<span class="auto" title="Graded automatically from the final score">auto</span>` : ""}</div>${meta ? `<div class="lmeta">${meta}</div>` : ""}</div>
      ${isParlay ? `<span class="lodds">${odds(l.odds)}</span>` : ""}
    </div>`;
  }).join("");
  return `<article class="bet ${st}" data-act="open-bet" data-id="${b.id}" tabindex="0">
    <header>
      <span class="btype ${isParlay ? "parlay" : ""}">${isParlay ? `${b.legs.length}-leg parlay` : "Straight"}</span>
      ${b.book ? `<span class="book">${esc(b.book)}</span>` : ""}
      ${b.boostPct ? `<span class="boost">+${b.boostPct}% boost</span>` : ""}
      <span class="grow"></span>
      <span class="bodds">${odds(d)}</span>
    </header>
    <div class="legs">${legsHtml}</div>
    ${isParlay && st === "open" ? `<div class="prog"><i style="width:${(won / b.legs.length) * 100}%"></i></div>` : ""}
    <footer>
      <span>Risk <b>${fmtMoney(b.stake)}</b></span>
      ${st === "open"
        ? `<span>To win <b>${fmtMoney(potentialPayout(b) - b.stake)}</b></span>${isParlay ? `<span class="muted">${won}/${b.legs.length} hit</span>` : ""}`
        : `<span class="${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}"><b>${fmtMoney(profit, { sign: true })}</b></span>`}
      <span class="grow"></span>${pill(st)}
    </footer>
  </article>`;
}

function insightsHtml() {
  const table = (title, rows) => rows.length
    ? `<div class="card ins"><h3>${title}</h3><table><thead><tr><th></th><th>Bets</th><th>Record</th><th>Profit</th><th>ROI</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.count}</td><td>${r.w}-${r.l}${r.p ? `-${r.p}` : ""}</td><td class="${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}">${fmtMoney(r.profit, { sign: true, cents: false })}</td><td>${fmtPct(r.roi)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const bets = S.bets.filter((b) => !periodSince() || new Date(b.settledAt || b.createdAt) >= periodSince());
  const marketOf = (b) => (b.legs.length > 1 ? "Parlay" : { ml: "Moneyline", spread: "Spread", total: "Total" }[b.legs[0].market] || guessMarket(b.legs[0].pick));
  const oddsBucket = (b) => {
    const d = ticketDecimal(b);
    return d < 1.67 ? "Heavy fav (< -150)" : d < 2.1 ? "Near even (-150 to +110)" : d < 4 ? "Plus money (+110 to +300)" : "Longshot (+300+)";
  };
  const s = summarize(bets);
  const avgOdds = bets.length ? bets.reduce((a, b) => a + ticketDecimal(b), 0) / bets.length : NaN;
  const be = Number.isFinite(avgOdds) ? 1 / avgOdds : NaN;
  return `<div class="ins-grid">
    <div class="card ins kpis">
      <div><span>Avg odds</span><b>${odds(avgOdds)}</b></div>
      <div><span>Break-even rate</span><b>${fmtPct(be)}</b></div>
      <div><span>Actual win rate</span><b class="${s.winRate > be ? "pos" : "neg"}">${fmtPct(s.winRate)}</b></div>
      <div><span>Best hit</span><b class="pos">${s.best && s.best.profit > 0 ? fmtMoney(s.best.profit, { sign: true }) : "—"}</b></div>
    </div>
    ${table("By bet type", breakdown(bets, (b) => (b.legs.length > 1 ? "Parlay" : "Straight")))}
    ${table("By market", breakdown(bets, marketOf))}
    ${table("By odds range", breakdown(bets, oddsBucket))}
    ${table("By book", breakdown(bets, (b) => b.book || "Unspecified"))}
  </div>`;
}

function guessMarket(pick = "") {
  if (/\bml\b|moneyline/i.test(pick)) return "Moneyline";
  if (/\b(over|under|o\/u)\b/i.test(pick)) return "Total";
  if (/[+-]\d+(\.5)?\b/.test(pick)) return "Spread";
  return "Props & futures";
}

// ── Live ──

function viewLive() {
  const all = S.todayIds.map(game).filter(Boolean);
  const f = S.f.live;
  const filtered = all.filter((g) =>
    f === "live" ? g.state === "in" : f === "mine" ? myActionCount(g.id) > 0 : f === "top25" ? g.home.rank || g.away.rank : true
  );
  const order = { in: 0, pre: 1, post: 2 };
  filtered.sort((a, b) => order[a.state] - order[b.state] || (myActionCount(b.id) - myActionCount(a.id)) || new Date(a.date) - new Date(b.date));
  const live = filtered.filter((g) => g.state === "in"), pre = filtered.filter((g) => g.state === "pre"), post = filtered.filter((g) => g.state === "post");
  const st = S.st.today;
  const head = `<div class="view-h">
    <div><div class="eyebrow">Scoreboard</div><h1>${esc(fmtDayLong(new Date()))}</h1>
      <p class="muted">${all.filter((g) => g.state === "in").length} live · ${all.length} FBS games · <span class="upd">${st.loading ? "updating…" : `updated <span data-ago="${st.at || 0}">${ago(st.at)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="today" aria-label="Refresh">${icons.refresh}</button>
  </div>
  <div class="chips">${chip("All", "live-f", "all", f === "all")}${chip(`<span class="dot live"></span>Live`, "live-f", "live", f === "live")}${chip("My action", "live-f", "mine", f === "mine")}${chip("Top 25", "live-f", "top25", f === "top25")}</div>`;
  if (st.error && !all.length) return head + errorBox("Couldn't reach the scoreboard", st.error, "today");
  if (!all.length) return head + (st.at ? `<div class="empty">No FBS games today. Check <a href="#schedule" data-act="tab" data-v="schedule">Upcoming</a>.</div>` : skeleton(6));
  const sec = (title, gs) => (gs.length ? `<div class="sec-h"><h2>${title}</h2><span class="muted">${gs.length}</span></div><div class="grid-cards">${gs.map(liveCard).join("")}</div>` : "");
  return head + (st.error ? staleNote(st) : "") + sec(`<span class="dot live"></span>Live now`, live) + sec("Later today", pre) + sec("Final", post) + (filtered.length ? "" : `<div class="empty">Nothing matches that filter.</div>`);
}

function liveCard(g) {
  const mine = myActionCount(g.id);
  const sit = g.state === "in" && g.situation;
  return `<article class="gcard ${g.state} ${sit?.redZone ? "rz" : ""} ${mine ? "mine" : ""}" data-act="open-game" data-id="${g.id}" tabindex="0">
    <header><span class="gstatus">${g.state === "in" ? `<span class="dot live"></span>` : ""}${esc(statusText(g))}</span>${g.tv ? `<span class="tv">${esc(g.tv)}</span>` : ""}<span class="grow"></span>${rankedBadge(g)}${mine ? `<span class="badge mine">${mine} bet${mine > 1 ? "s" : ""}</span>` : ""}</header>
    <div class="teams">${scoreRows(g)}</div>
    ${sit ? `<div class="sit">${sit.redZone ? `<span class="badge rz">Red zone</span>` : ""}${sit.downDistance ? `<span>${esc(sit.downDistance)}</span>` : ""}${sit.lastPlay ? `<span class="lp">${esc(sit.lastPlay)}</span>` : ""}</div>` : ""}
    ${g.odds && g.state !== "post" ? `<footer class="muted">${lineSummary(g)}</footer>` : ""}
  </article>`;
}

// ── Schedule ──

function viewSchedule() {
  const st = S.st.schedule;
  const q = S.f.q.trim().toLowerCase();
  let gs = S.scheduleIds.map(game).filter(Boolean);
  const total = gs.length;
  if (S.f.top25) gs = gs.filter((g) => g.home.rank || g.away.rank);
  if (S.f.hasLine) gs = gs.filter((g) => g.odds);
  if (q) gs = gs.filter((g) => `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr} ${g.tv}`.toLowerCase().includes(q));
  gs.sort((a, b) => new Date(a.date) - new Date(b.date) || (a.timeValid ? 0 : 1) - (b.timeValid ? 0 : 1));
  const moved = gs.filter((g) => kickBadge(g)).length;
  const days = new Map();
  for (const g of gs) {
    const k = dayKey(g.date);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(g);
  }
  const from = addDays(startOfDay(), 1);
  const head = `<div class="view-h">
    <div><div class="eyebrow">Next four weeks</div><h1>Upcoming</h1>
      <p class="muted">From ${esc(fmtDay(from))} · next 4 weeks · times in ${esc(tzAbbr)} · <span class="upd">${st.loading ? "checking for changes…" : `checked <span data-ago="${st.at || st.cachedAt || 0}">${ago(st.at || st.cachedAt)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="schedule" aria-label="Refresh">${icons.refresh}</button>
  </div>
  <div class="toolbar">
    <label class="search">${icons.search}<input id="sched-q" data-in="sched-q" type="search" placeholder="Team or network" value="${esc(S.f.q)}" autocomplete="off"></label>
    ${chip("Top 25", "sched-top25", "", S.f.top25)}${chip("Has line", "sched-line", "", S.f.hasLine)}
  </div>
  ${moved ? `<div class="notice">${icons.clock}<span><b>${moved} kickoff${moved > 1 ? "s" : ""} changed</b> since you last looked — marked below.</span></div>` : ""}`;
  if (!total) {
    if (st.error) return head + errorBox("Schedule feed didn't respond", st.error, "schedule");
    return head + (st.at ? `<div class="empty">No games posted for the next four weeks yet.</div>` : skeleton(8, "row"));
  }
  const warn = st.error ? staleNote(st) : st.failedDays?.length ? `<div class="notice warn">Some days didn't load (${st.failedDays.length}); showing what we had. Retrying automatically.</div>` : "";
  const body = [...days.entries()].map(([k, list]) => `
    <section class="day">
      <h2 class="day-sticky"><span>${esc(relDay(list[0].date))}${relDay(list[0].date) !== fmtDay(list[0].date) ? ` <em>${esc(fmtDay(list[0].date))}</em>` : ""}</span><span class="muted">${list.length} game${list.length > 1 ? "s" : ""}</span></h2>
      <div class="rows">${list.map(schedRow).join("")}</div>
    </section>`).join("");
  return head + warn + (gs.length ? body : `<div class="empty">No games match.</div>`);
}

function schedRow(g) {
  const mine = myActionCount(g.id);
  const wp = winProb(g);
  const team = (t, side) => {
    const p = wp?.[side];
    return `<span class="steam">${logo(t, 26)}<span class="sname">${rank(t)}<b>${esc(t.short)}</b>${t.record ? `<small>${esc(t.record)}</small>` : ""}</span><span class="wp ${p != null && p >= 0.5 ? "fav" : ""}">${p != null ? pct(p) : "—"}</span></span>`;
  };
  const tags = [rankedBadge(g), kickBadge(g), mine ? `<span class="badge mine">${mine} bet${mine > 1 ? "s" : ""}</span>` : ""].join("");
  return `<button class="srow ${g.home.rank && g.away.rank ? "ranked" : ""}" data-act="open-game" data-id="${g.id}">
    <span class="stime">${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}${g.tv ? `<small>${esc(g.tv)}</small>` : ""}</span>
    <span class="smatch">
      ${team(g.away, "away")}${team(g.home, "home")}
      ${wpBar(g, wp)}
      ${tags.trim() ? `<span class="stags">${tags}</span>` : ""}
    </span>
    <span class="sline">${lineSummary(g) || `<span class="muted">No line yet</span>`}${g.neutral ? `<small>Neutral site</small>` : ""}</span>
  </button>`;
}

// ── Build ──

function viewBuild() {
  const all = boardGames();
  const days = [...new Set(all.map((g) => dayKey(g.date)))];
  const dayF = S.f.buildDay === "all" || days.includes(S.f.buildDay) ? S.f.buildDay : "all";
  const q = S.f.buildQ.trim().toLowerCase();
  let gs = all.filter((g) => dayF === "all" || dayKey(g.date) === dayF);
  if (q) gs = gs.filter((g) => `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q));
  const provider = all[0]?.odds?.provider;
  const board = gs.length
    ? `<div class="board">
        <div class="bhead"><span></span><span>Spread</span><span>Total</span><span>Money</span></div>
        ${gs.map(boardRow).join("")}
      </div>`
    : S.st.schedule.at || S.st.today.at
      ? `<div class="empty">No lines posted for that filter yet. Books usually hang next week's numbers Sunday.</div>`
      : skeleton(6);
  return `<div class="build">
    <div class="build-main">
      <div class="view-h">
        <div><div class="eyebrow">Slip builder</div><h1>Build</h1><p class="muted">Tap prices to build a slip. ${provider ? `Lines: ${esc(provider)} via ESPN` : "Lines from ESPN"} · refreshes automatically.</p></div>
      </div>
      <div class="toolbar">
        <label class="switch ${S.sim ? "on" : ""}" title="Simulate a live market: prices tick every couple seconds so you can see how your slip reacts. Real lines are unchanged."><input type="checkbox" data-act="sim" ${S.sim ? "checked" : ""}><span class="knob"></span>Market sim</label>
        <label class="search">${icons.search}<input id="build-q" data-in="build-q" type="search" placeholder="Find a team" value="${esc(S.f.buildQ)}" autocomplete="off"></label>
      </div>
      <div class="chips scroll">${chip("All", "build-day", "all", dayF === "all")}${days.map((d) => chip(esc(relDay(d + "T12:00:00")), "build-day", d, dayF === d)).join("")}</div>
      ${S.sim ? `<div class="notice sim"><span class="dot live"></span><span><b>Market sim on.</b> Prices are drifting on purpose so you can watch the slip reprice. Turn it off to snap back to the real lines.</span></div>` : ""}
      ${board}
    </div>
    <aside class="build-slip card">${S.sheet?.kind === "slip" ? "" : slipHtml()}</aside>
  </div>`;
}

function boardRow(g) {
  const m = markets(g);
  return `<div class="brow">
    <button class="bteams" data-act="open-game" data-id="${g.id}">
      <span class="btime">${esc(relDay(g.date))} · ${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}${g.tv ? ` · ${esc(g.tv)}` : ""}${g.home.rank && g.away.rank ? ` · <span class="rk-inline">★ Ranked</span>` : ""}</span>
      <span class="bt">${logo(g.away, 20)}${rank(g.away)}${esc(g.away.short)}</span>
      <span class="bt">${logo(g.home, 20)}${rank(g.home)}${esc(g.home.short)}</span>
    </button>
    <div class="bcol">${selBtn(m.spreadAway, fmtLine(m.spreadAway?.line))}${selBtn(m.spreadHome, fmtLine(m.spreadHome?.line))}</div>
    <div class="bcol">${selBtn(m.over, m.over ? `O ${m.over.line}` : "")}${selBtn(m.under, m.under ? `U ${m.under.line}` : "")}</div>
    <div class="bcol">${selBtn(m.mlAway, "")}${selBtn(m.mlHome, "")}</div>
  </div>`;
}

function slipHtml() {
  const c = slipCalc();
  const n = c.legs.length;
  const mode = S.slip.mode;
  if (!n) {
    return `<div class="slip-empty">
      <div class="slip-ico">${icons.build}</div>
      <h3>Your slip is empty</h3>
      <p class="muted">Tap any price on the board. Add two or more to see the parlay price build up live.</p>
      <button class="btn sm" data-act="slip-custom">+ Custom selection</button>
    </div>`;
  }
  const tabs = `<div class="seg slip-mode">
    <button class="${mode === "singles" ? "on" : ""}" data-act="slip-mode" data-v="singles">Straight${n > 1 ? `s (${n})` : ""}</button>
    <button class="${mode === "parlay" ? "on" : ""}" data-act="slip-mode" data-v="parlay" ${n < 2 ? "disabled title='Add a second leg to parlay'" : ""}>Parlay <em>${n > 1 ? odds(c.rawParlay) : ""}</em></button>
  </div>`;
  const legs = c.legs.map((l) => {
    const cur = !l.custom && selByKey(l.key);
    const g = game(l.gameId);
    const moved = cur && (cur.line !== l.line || Math.abs(cur.odds - l.odds) > 1e-6);
    const gone = !l.custom && !cur;
    const mv = S.moves[l.key];
    return `<div class="sleg ${moved ? "moved" : ""} ${mv ? `mv-${mv.dir}` : ""}">
      <div class="sl-top">
        <div class="sl-pick">${l.custom
          ? `<input id="slip-pick-${l.id}" data-in="slip-pick" data-id="${l.id}" value="${esc(l.pick)}" placeholder="Name it — e.g. Manning 250+ pass yds" autocomplete="off"><small>Custom selection</small>`
          : `${esc(legLabel(l, g) || l.pick)}<small>${esc(`${l.gameLabel} · ${relDay(l.kickoff)} ${fmtTime(l.kickoff)}`)}</small>`}</div>
        <button class="icon-btn sm" data-act="slip-remove" data-id="${l.id}" aria-label="Remove">${icons.x}</button>
      </div>
      <div class="sl-odds">
        ${stepper(`slip-odds-${l.id}`, l.oddsText ?? odds(l.odds), `slip-odds`, l.id)}
        ${mode === "singles" ? `<label class="stake"><span>$</span><input id="slip-stake-${l.id}" data-in="slip-stake" data-id="${l.id}" inputmode="decimal" placeholder="Stake" value="${esc(S.slip.stakes[l.id] ?? "")}"></label>` : `<span class="imp" title="Implied probability">${fmtPct(impliedProb(l.odds), 0)}</span>`}
      </div>
      ${mode === "singles" ? `<div class="sl-win muted" data-towin="${l.id}">${towinText(l)}</div>` : ""}
      ${moved ? `<div class="sl-change">${settings.autoAccept ? "" : `Market now <b>${cur.market === "ml" ? "" : cur.market === "total" ? `${l.side === "over" ? "O" : "U"} ${cur.line} ` : `${fmtLine(cur.line)} `}${odds(cur.odds)}</b>${l.edited ? " · you set your own price" : ""}<button class="link" data-act="slip-accept" data-id="${l.id}">Use market</button>`}</div>` : ""}
      ${gone ? `<div class="sl-change muted">Market closed — kept at your price</div>` : ""}
    </div>`;
  }).join("");
  const warn = mode === "parlay" && c.conflict
    ? `<div class="notice err">Two legs on the same market in one game — books won't take that as a parlay.</div>`
    : mode === "parlay" && c.sameGame
      ? `<div class="notice warn">Same-game legs are correlated. Books price these as SGPs — enter their price below for an accurate payout.</div>`
      : "";
  const parlayBox = mode === "parlay"
    ? `<div class="pbox">
        <div class="prow"><label>Book's price <small>optional</small></label>${stepper("slip-override", S.slip.overrideText ?? (S.slip.override ? odds(parseOdds(S.slip.override)?.decimal) : ""), "slip-override", "", "calc " + odds(c.rawParlay))}</div>
        <div class="prow"><label>Profit boost</label><label class="stake pct"><input id="slip-boost" data-in="slip-boost" inputmode="decimal" placeholder="0" value="${esc(S.slip.boost)}"><span>%</span></label></div>
        <div class="prow"><label>Stake</label><label class="stake"><span>$</span><input id="slip-stake" data-in="slip-pstake" inputmode="decimal" value="${esc(S.slip.stake)}"></label></div>
        <div class="quick">${[5, 10, 25, 50, 100].map((v) => `<button class="chip" data-act="slip-quick" data-v="${v}">$${v}</button>`).join("")}</div>
        <div class="prow"><label>Payout on your ticket <small>after you place it — we'll match it exactly</small></label><label class="stake"><span>$</span><input id="slip-ticket" data-in="slip-ticket" inputmode="decimal" placeholder="${c.calcPayout ? c.calcPayout.toFixed(2) : ""}" value="${esc(S.slip.ticket || "")}"></label></div>
      </div>`
    : "";
  return `<div class="slip">
    <div class="slip-h"><h2>Slip <em>${n}</em></h2>${fmtToggle("set-fmt")}<button class="link" data-act="slip-clear">Clear</button></div>
    ${tabs}
    <div class="slegs">${legs}</div>
    <button class="btn sm ghost add-custom" data-act="slip-custom">+ Custom selection</button>
    ${warn}
    ${parlayBox}
    <div id="slip-summary">${slipSummary(c)}</div>
    <label class="bookf"><span>Book</span><input id="slip-book" data-in="slip-book" list="books" placeholder="Where you're placing it" value="${esc(S.slip.book || "")}"></label>
    <button class="btn primary block" data-act="slip-track">Track ${mode === "parlay" ? "parlay" : n > 1 ? "bets" : "bet"}</button>
  </div>`;
}

function towinText(l) {
  const st = num(S.slip.stakes[l.id]);
  return st > 0 ? `To win <b>${fmtMoney(toWin(st, l.odds))}</b>` : `$${settings.unit} wins ${fmtMoney(toWin(settings.unit, l.odds))}`;
}

/** Explains why a book's ticket payout differs from multiplying the leg prices. */
function mismatchNote(ticket, calc) {
  if (!(ticket > 0) || !(calc > 0)) return "";
  const diff = ticket - calc;
  if (Math.abs(diff) < 0.01) return `<div class="match ok">✓ Matches your ticket to the cent</div>`;
  return `<div class="match">Using your ticket's <b>${fmtMoney(ticket)}</b>. The leg prices multiply to ${fmtMoney(calc)} (${fmtMoney(diff, { sign: true })}) — books round each leg's price, price same-game parlays with their own correlation math, and prices can move between building a slip and placing it.</div>`;
}

function slipSummary(c) {
  if (S.slip.mode === "parlay") {
    return `<div class="summary">
      <div><span>Odds</span><b class="odds-big">${odds(c.parlayOdds)}</b><small>${fmt() === "american" ? `${formatOdds(c.parlayOdds, "decimal")}×` : formatOdds(c.parlayOdds, "american")}</small></div>
      <div><span>Hit chance</span><b>${fmtPct(c.prob)}</b><small>implied, with vig</small></div>
      <div><span>To win</span><b class="pos">${fmtMoney(c.win)}</b><small>payout ${fmtMoney(c.payout)}</small></div>
    </div>${mismatchNote(c.ticket, c.calcPayout)}`;
  }
  return `<div class="summary">
    <div><span>Total risk</span><b>${fmtMoney(c.singlesRisk)}</b></div>
    <div><span>Max win</span><b class="pos">${fmtMoney(c.singlesWin)}</b></div>
    <div><span>As a parlay</span><b>${c.legs.length > 1 ? odds(c.rawParlay) : "—"}</b><small>${c.legs.length > 1 ? `$${settings.unit} wins ${fmtMoney(toWin(settings.unit, c.rawParlay))}` : "add a leg"}</small></div>
  </div>`;
}

function stepper(id, text, act, key, placeholder = "") {
  return `<div class="stepper">
    <button data-act="${act}-step" data-id="${esc(key)}" data-dir="-1" aria-label="Shorter odds">−</button>
    <input id="${esc(id)}" data-in="${act}" data-id="${esc(key)}" value="${esc(text)}" placeholder="${esc(placeholder)}" inputmode="text" autocomplete="off" spellcheck="false">
    <button data-act="${act}-step" data-id="${esc(key)}" data-dir="1" aria-label="Longer odds">+</button>
  </div>`;
}

// ── News ──

function viewNews() {
  const st = S.st.news;
  const myTeams = new Map();
  for (const b of S.bets) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      const g = game(l.gameId);
      if (g) [g.home, g.away].forEach((t) => myTeams.set(t.id, t));
    }
  }
  const f = S.f.news;
  const moves = lineMoves();
  let arts = S.news;
  if (f === "mine") arts = arts.filter((a) => [...myTeams.values()].some((t) => mentionsTeam(a, t)));
  else if (f !== "all" && f !== "move") arts = arts.filter((a) => a.tags.includes(f));
  const counts = Object.fromEntries(Object.keys(TAGS).map((k) => [k, S.news.filter((a) => a.tags.includes(k)).length]));
  counts.move = moves.length;
  const head = `<div class="view-h"><div><div class="eyebrow">The wire</div><h1>News & moves</h1><p class="muted">Injuries, line movement, pressers and look-aheads · <span class="upd">${st.loading ? "updating…" : `updated <span data-ago="${st.at || 0}">${ago(st.at)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="news" aria-label="Refresh">${icons.refresh}</button></div>
    <div class="chips scroll">
      ${chip("All", "news-f", "all", f === "all")}
      ${myTeams.size ? chip(`My teams`, "news-f", "mine", f === "mine") : ""}
      ${Object.entries(TAGS).map(([k, v]) => (counts[k] ? chip(`${v} <em>${counts[k]}</em>`, "news-f", k, f === k) : "")).join("")}
    </div>`;
  const movesHtml = (f === "all" || f === "move") && moves.length
    ? `<section class="moves"><div class="sec-h"><h2>Line moves we've seen</h2><span class="muted">tracked since you started watching</span></div>
       <div class="move-list">${moves.slice(0, f === "move" ? 50 : 6).map(moveCard).join("")}</div></section>`
    : f === "move" ? `<div class="empty">No line moves spotted yet. hedgehog compares every refresh against the last number it saw.</div>` : "";
  if (f === "move") return head + movesHtml;
  const body = arts.length
    ? `<div class="news-list">${arts.map(newsCard).join("")}</div>`
    : st.error ? errorBox("News feed unavailable", st.error, "news") : st.at ? `<div class="empty">No stories in this bucket right now.</div>` : skeleton(5, "row");
  return head + movesHtml + (f === "all" && moves.length ? `<div class="sec-h"><h2>Headlines</h2></div>` : "") + body;
}

function lineMoves() {
  const out = [];
  for (const [id, L] of Object.entries(S.lines)) {
    const g = game(id);
    if (!g || g.state !== "pre") continue;
    const f = L.first, l = L.last;
    const parts = [];
    if (f.s != null && l.s != null && f.s !== l.s) parts.push({ k: "Spread", from: spreadTxt(g, f.s), to: spreadTxt(g, l.s), size: Math.abs(l.s - f.s) });
    if (f.t != null && l.t != null && f.t !== l.t) parts.push({ k: "Total", from: `${f.t}`, to: `${l.t}`, size: Math.abs(l.t - f.t) });
    if (f.mh != null && l.mh != null && f.mh !== l.mh) parts.push({ k: `${g.home.abbr} ML`, from: fmtA(f.mh), to: fmtA(l.mh), size: Math.abs(americanToDecimal(l.mh) - americanToDecimal(f.mh)) });
    if (parts.length) out.push({ g, L, parts, size: Math.max(...parts.map((p) => p.size)) });
  }
  return out.sort((a, b) => b.L.la - a.L.la);
}
const fmtA = (n) => (n > 0 ? `+${n}` : `${n}`);
const spreadTxt = (g, h) => (h === 0 ? "PK" : h < 0 ? `${g.home.abbr} ${h}` : `${g.away.abbr} ${-h}`);

function moveCard(m) {
  return `<button class="move" data-act="open-game" data-id="${m.g.id}">
    <span class="mv-teams">${logo(m.g.away, 20)}${logo(m.g.home, 20)}<b>${esc(m.g.shortName)}</b><small>${esc(relDay(m.g.date))}</small></span>
    ${m.parts.map((p) => `<span class="mv-part"><small>${esc(p.k)}</small>${esc(p.from)} <span class="arr">→</span> <b>${esc(p.to)}</b></span>`).join("")}
    <span class="muted mv-when" data-ago="${m.L.la}">${ago(m.L.la)}</span>
  </button>`;
}

function newsCard(a) {
  const tags = a.tags.filter((t) => TAGS[t]).map((t) => `<span class="tag t-${t}">${TAGS[t]}</span>`).join("");
  const inner = `${a.image ? `<img class="nimg" src="${esc(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="nbody"><div class="ntags">${tags}<span class="muted">${esc(ago(new Date(a.published).getTime()))}</span></div>
    <h3>${esc(a.headline)}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ""}
    ${a.teams?.length ? `<div class="nteams">${a.teams.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}</div>
    ${a.url ? `<span class="next">${icons.ext}</span>` : ""}`;
  return a.url ? `<a class="news" href="${esc(a.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="news">${inner}</div>`;
}

// ── misc view bits ──

function skeleton(n, kind = "card") {
  return `<div class="${kind === "row" ? "rows" : "grid-cards"}">${Array.from({ length: n }, () => `<div class="skel ${kind}"></div>`).join("")}</div>`;
}

function errorBox(title, detail, what) {
  return `<div class="errbox"><h3>${esc(title)}</h3><p class="muted">${esc(detail)}. hedgehog retries on its own every 45 seconds.</p><button class="btn sm" data-act="refresh" data-v="${what}">${icons.refresh} Try now</button></div>`;
}

function staleNote(st) {
  return `<div class="notice warn">Feed hiccup (${esc(st.error)}). Showing the last good data from <span data-ago="${st.at || st.cachedAt || 0}">${ago(st.at || st.cachedAt)}</span>; retrying automatically.</div>`;
}

// ───────────────────────────── sheets ─────────────────────────────

function sheetGame() {
  const g = game(S.sheet.id);
  if (!g) return `<div class="sheet-h"><h2>Game</h2>${closeBtn()}</div><p class="muted">Game not found.</p>`;
  const m = markets(g);
  const L = S.lines[g.id];
  const k = S.kick[g.id];
  const myBets = S.bets.filter((b) => b.legs.some((l) => l.gameId === g.id));
  const related = S.news.filter((a) => mentionsTeam(a, g.home) || mentionsTeam(a, g.away)).slice(0, 4);
  const o = g.odds;
  const fair = o?.ml?.home && o?.ml?.away ? noVig(americanToDecimal(o.ml.home), americanToDecimal(o.ml.away)) : null;
  return `<div class="sheet-h"><h2>${esc(g.shortName)}</h2>${closeBtn()}</div>
    <div class="gsheet-top ${g.state}">
      <div class="gs-status">${g.state === "in" ? `<span class="dot live"></span>` : ""}${esc(g.state === "pre" ? (g.timeValid ? fmtDayTime(g.date) : `${fmtDay(g.date)} · TBD`) : g.detail || statusText(g))}</div>
      <div class="teams lg">${scoreRows(g, { big: true })}</div>
      <div class="gs-meta">${[g.tv, g.venue, g.city, g.notes].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="stags">${rankedBadge(g)}${kickBadge(g)}</div>
      ${g.state === "in" && g.situation?.lastPlay ? `<div class="lp">${esc(g.situation.lastPlay)}</div>` : ""}
    </div>
    ${m ? `<h3 class="sh3">Markets <small>${esc(o.provider)}${S.sim ? " · sim on" : ""}</small></h3>
      <div class="mk-grid">
        <span></span><span class="mk-h">Spread</span><span class="mk-h">Total</span><span class="mk-h">Money</span>
        <span class="mk-t">${logo(g.away, 20)}${esc(g.away.abbr)}</span>${selBtn(m.spreadAway, fmtLine(m.spreadAway?.line))}${selBtn(m.over, m.over ? `O ${m.over.line}` : "")}${selBtn(m.mlAway, "")}
        <span class="mk-t">${logo(g.home, 20)}${esc(g.home.abbr)}</span>${selBtn(m.spreadHome, fmtLine(m.spreadHome?.line))}${selBtn(m.under, m.under ? `U ${m.under.line}` : "")}${selBtn(m.mlHome, "")}
      </div>
      ${fair ? `<p class="muted small">No-vig win chance: ${esc(g.away.abbr)} ${fmtPct(fair.p2, 0)} · ${esc(g.home.abbr)} ${fmtPct(fair.p1, 0)} · book hold ${fmtPct(fair.hold)}</p>` : ""}` : g.odds ? `<p class="muted">Line at close: ${lineSummary(g)}</p>` : ""}
    ${L && (L.moves?.length || L.fa < L.la) ? `<h3 class="sh3">Line history</h3><ul class="hist">
      <li><span class="muted">First seen ${esc(ago(L.fa))}</span> ${esc(snapTxt(g, L.first))}</li>
      ${(L.moves || []).map((mv) => `<li><span class="muted">${esc(ago(mv.at))}</span> ${esc(snapTxt(g, mv.to))}</li>`).join("")}
    </ul>` : ""}
    ${k?.at ? `<h3 class="sh3">Kickoff</h3><p class="muted">Moved from ${esc(k.ptv === false ? "TBD" : fmtDayTime(k.pd))} to <b>${esc(fmtDayTime(k.d))}</b> (spotted ${esc(ago(k.at))}).</p>` : ""}
    ${myBets.length ? `<h3 class="sh3">Your bets</h3><div class="bet-list">${myBets.map(betCard).join("")}</div>` : ""}
    ${related.length ? `<h3 class="sh3">Related news</h3><div class="news-list compact">${related.map(newsCard).join("")}</div>` : ""}
    ${g.state === "pre" ? `<button class="btn block" data-act="add-for-game" data-id="${g.id}">${icons.plus} Log a pick on this game</button>` : ""}`;
}

const snapTxt = (g, s) => [s.s != null ? spreadTxt(g, s.s) : "", s.t != null ? `O/U ${s.t}` : "", s.mh != null ? `${g.home.abbr} ${fmtA(s.mh)}` : ""].filter(Boolean).join(" · ");

function sheetBet() {
  const b = S.bets.find((x) => x.id === S.sheet.id);
  if (!b) return `<div class="sheet-h"><h2>Bet</h2>${closeBtn()}</div><p class="muted">This bet was removed.</p>`;
  const st = betStatus(b);
  const isParlay = b.legs.length > 1;
  const payout = potentialPayout(b);
  const profit = betProfit(b);
  const hedgeD = parseOdds(S.sheet.hedge || "")?.decimal;
  const h = st === "open" && hedgeD ? hedge(payout, b.stake, hedgeD) : null;
  const legRows = b.legs.map((l) => {
    const g = game(l.gameId);
    const lv = legLive(l, g);
    return `<div class="dleg ${lv.state}">
      <div class="dl-top"><span class="ldot"></span><b>${esc(legLabel(l, g))}</b><span class="grow"></span><span class="lodds">${odds(l.odds)}</span></div>
      ${g ? `<div class="dl-game">${logo(g.away, 18)} ${esc(g.away.abbr)} ${g.state !== "pre" ? g.away.score ?? 0 : ""} <span class="muted">${g.neutral ? "vs" : "@"}</span> ${logo(g.home, 18)} ${esc(g.home.abbr)} ${g.state !== "pre" ? g.home.score ?? 0 : ""} · <span class="muted">${esc(g.state === "pre" ? fmtDayTime(g.date) : statusText(g))}</span>${lv.text ? ` · <b>${esc(lv.text)}</b>` : ""}</div>` : l.gameLabel ? `<div class="dl-game muted">${esc(l.gameLabel)}</div>` : ""}
      ${b.cashout == null ? `<div class="seg xs grade">${["open", "won", "lost", "push", "void"].map((s) => `<button class="${l.status === s ? `on ${s}` : ""}" data-act="grade-leg" data-bet="${b.id}" data-leg="${l.id}" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="sheet-h"><h2>${isParlay ? `${b.legs.length}-leg parlay` : "Straight bet"}</h2>${closeBtn()}</div>
    <div class="dhead">
      ${pill(st)}<span class="muted">${esc(b.book || "No book")} · placed ${esc(fmtDayTime(b.createdAt))}</span>
    </div>
    <div class="dsum">
      <div><span>Odds</span><b>${odds(ticketDecimal(b))}</b>${b.ticketPayout ? `<small>from ticket</small>` : b.oddsOverride ? `<small>book price</small>` : ""}${b.boostPct ? `<small>+${b.boostPct}% boost</small>` : ""}</div>
      <div><span>Risk</span><b>${fmtMoney(b.stake)}</b></div>
      <div><span>${st === "open" ? "Payout" : "Result"}</span><b class="${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}">${st === "open" ? fmtMoney(payout) : fmtMoney(profit, { sign: true })}</b>${st === "open" ? `<small>profit ${fmtMoney(payout - b.stake)}</small>` : ""}</div>
    </div>
    <h3 class="sh3">Legs <small>grade manually or let final scores do it</small></h3>
    <div class="dlegs">${legRows}</div>
    ${st === "open" || b.cashout != null ? `<h3 class="sh3">Cash out</h3>
      ${b.cashout != null
        ? `<p>Cashed out for <b>${fmtMoney(b.cashout)}</b> (${fmtMoney(b.cashout - b.stake, { sign: true })}). <button class="link" data-act="undo-cashout" data-id="${b.id}">Undo</button></p>`
        : `<div class="row-inline"><label class="stake"><span>$</span><input id="cashout-amt" inputmode="decimal" placeholder="Offer from your book"></label><button class="btn sm" data-act="cashout" data-id="${b.id}">Cash out</button></div>`}` : ""}
    ${b.cashout == null ? `<h3 class="sh3">Payout on your ticket <small>set it if our number doesn't match your book</small></h3>
      <div class="row-inline"><label class="stake"><span>$</span><input id="ticket-amt" inputmode="decimal" value="${b.ticketPayout ? b.ticketPayout.toFixed(2) : ""}" placeholder="${(b.stake * computedDecimal(b)).toFixed(2)}"></label><button class="btn sm" data-act="set-ticket" data-id="${b.id}">${b.ticketPayout ? "Update" : "Save"}</button>${b.ticketPayout ? `<button class="link" data-act="clear-ticket" data-id="${b.id}">Use leg math</button>` : ""}</div>
      ${b.ticketPayout ? mismatchNote(b.ticketPayout, b.stake * computedDecimal(b)) : ""}` : ""}
    ${st === "open" ? `<h3 class="sh3">Hedge calculator</h3>
      <p class="muted small">Price on the other side at your book → how much to bet to lock the same result either way.</p>
      <div class="row-inline"><label class="stake odds"><input id="hedge-odds" data-in="hedge" value="${esc(S.sheet.hedge || "")}" placeholder="e.g. +250 or 3.5"></label>
      <div id="hedge-out" class="hedge-out">${hedgeText(h)}</div></div>` : ""}
    <h3 class="sh3">Notes</h3>
    <textarea id="bet-note" data-in="bet-note" data-id="${b.id}" rows="2" placeholder="Why you liked it, who tipped you, etc.">${esc(b.note || "")}</textarea>
    <div class="dactions">
      ${b.link ? `<a class="btn sm" href="${esc(b.link)}" target="_blank" rel="noopener">${icons.ext} Open on ${esc(b.book || "your book")}</a>` : ""}
      ${b.legs.some((l) => l.gameId) ? `<button class="btn sm" data-act="rebuild" data-id="${b.id}">Rebuild in slip</button>` : ""}
      <span class="grow"></span>
      <button class="btn sm danger" data-act="delete-bet" data-id="${b.id}">${S.confirmDelete === b.id ? "Tap again to delete" : "Delete"}</button>
    </div>`;
}

function hedgeText(h) {
  if (!h) return `<span class="muted">Enter the opposing price</span>`;
  return `Bet <b>${fmtMoney(h.stake)}</b> → lock <b class="${h.locked >= 0 ? "pos" : "neg"}">${fmtMoney(h.locked, { sign: true })}</b> either way`;
}

// Import a slip (screenshot / share text / link) ---------------------------

function dropZone() {
  return `<section class="dropzone" data-act="pick-image" tabindex="0" aria-label="Import a bet slip">
    <span class="dz-ico">${icons.upload}</span>
    <div class="dz-text"><b>Drop a bet slip to track it</b><span>${matchMedia("(pointer: coarse)").matches
      ? "Pick a screenshot from your photos, or paste the share text your book gives you."
      : `Screenshot from any book. You can also paste an image (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}V) or paste a share link or the share text.`}</span></div>
    <div class="dz-actions"><button class="btn sm primary" data-act="pick-image">${icons.upload} Choose screenshot</button><button class="btn sm" data-act="open-import-text">${icons.link} Paste text or link</button></div>
  </section>`;
}

/** Games a pasted bet could reasonably be on: recent finals through the next month. */
function linkPool() {
  const now = Date.now();
  return [...S.games.values()].filter((g) => new Date(g.date) > now - 4 * 864e5 && new Date(g.date) < now + 30 * 864e5);
}

async function handleImage(file) {
  if (!file || !/^image\//.test(file.type)) return toast("Drop an image of your bet slip (PNG or JPG)", "err");
  if (S.imp?.img) URL.revokeObjectURL(S.imp.img);
  S.imp = { busy: true, stage: "Loading reader", progress: 0, img: URL.createObjectURL(file), text: "", parsed: null, error: "" };
  openSheet({ kind: "import" });
  try {
    const text = await readImage(file, (stage, p) => {
      S.imp.stage = stage;
      S.imp.progress = p;
      paintImportProgress();
    }, readScore);
    S.imp.text = text.replace(/\n{3,}/g, "\n\n").trim();
    S.imp.parsed = parseSlipText(S.imp.text);
  } catch (e) {
    S.imp.error = e.message || "Couldn't read that image";
  }
  S.imp.busy = false;
  if (S.sheet?.kind === "import") {
    S.sheet.dirty = true;
    render();
  }
}

function handleText(text) {
  S.imp = { busy: false, text: text.trim(), parsed: text.trim() ? parseSlipText(text) : null, error: "" };
  openSheet({ kind: "import" });
  if (!text.trim()) setTimeout(() => $("#imp-text")?.focus(), 40);
}

function paintImportProgress() {
  const bar = $("#imp-bar");
  if (bar) bar.style.width = `${Math.round((S.imp.progress || 0) * 100)}%`;
  const st = $("#imp-stage");
  if (st) st.textContent = `${S.imp.stage}…`;
}

function importPreview() {
  const p = S.imp.parsed;
  if (!p) return `<p class="muted small">Nothing to read yet.</p>`;
  const pool = linkPool();
  const linkOnly = p.url && !p.legs.length && p.stake == null;
  const rows = p.legs.map((l) => {
    const m = linkPick(l.pick, pool, l.context);
    const g = m && game(m.gameId);
    return `<div class="ip-leg"><span class="ldot"></span><div class="lmain"><div class="lpick">${esc(l.pick)}${l.uncertain ? `<span class="chk" title="The +/- sign didn't come through. Check this price.">check ±</span>` : l.solved ? `<span class="chk ok" title="The +/- sign was missing; recovered by matching your ticket's payout">sign fixed</span>` : ""}</div>${g ? `<div class="lmeta">${logo(g.away, 16)}${logo(g.home, 16)} ${esc(g.shortName)} · ${esc(relDay(g.date))}${m.market !== "other" ? " · tracks live" : ""}</div>` : `<div class="lmeta">No game match: it'll be tracked manually</div>`}</div><span class="lodds">${odds(l.odds)}</span></div>`;
  }).join("");
  return `<div class="ip-sum">
      ${p.book ? `<span class="pill open">${esc(p.book)}</span>` : ""}
      <span class="pill ${p.legs.length ? "won" : ""}">${p.legs.length ? `${p.legs.length} ${p.legs.length > 1 ? "legs" : "leg"}${p.legCount && p.legCount !== p.legs.length ? ` of ${p.legCount}` : ""}` : "No legs found"}</span>
      ${p.stake != null ? `<span>${fmtMoney(p.stake)} → <b>${p.payout != null ? fmtMoney(p.payout) : "?"}</b></span>` : ""}
    </div>
    ${rows ? `<div class="ip-legs">${rows}</div>` : ""}
    ${p.oddsCheck != null && p.oddsCheck >= 0.03 && p.legs.length ? `<div class="notice warn">${icons.clock}<span>These legs multiply to ${fmtMoney((p.stake || 1) * p.legs.reduce((a, l) => a * l.odds, 1))}, not the ticket's ${p.payout != null ? fmtMoney(p.payout) : odds(p.totalOdds)}. A price may be misread or a leg missing (or it's a same-game parlay). The ticket's payout will be used either way.</span></div>` : ""}
    ${linkOnly ? `<div class="notice warn">${icons.link}<span>Sportsbook share links open inside the book's app and need your login, so hedgehog can't read them. Paste the share text that came with the link, or drop a screenshot. The link will still be saved on the bet.</span></div>` : ""}
    ${!p.legs.length && !linkOnly ? `<p class="muted small">Couldn't find picks with odds. Fix the text above (one pick per line, like <code>Georgia -7.5 -110</code>) or continue and fill the form in by hand.</p>` : ""}`;
}

function sheetImport() {
  const I = S.imp || {};
  return `<div class="sheet-h"><h2>Import a bet slip</h2>${closeBtn()}</div>
    ${I.img ? `<div class="imp-img"><img src="${esc(I.img)}" alt="Your bet slip"></div>` : ""}
    ${I.busy
      ? `<div class="imp-prog"><div class="imp-track"><i id="imp-bar" style="width:${Math.round((I.progress || 0) * 100)}%"></i></div><span id="imp-stage" class="muted small">${esc(I.stage || "Working")}…</span>
         <p class="muted small">The first import downloads a text reader (~12 MB, one time). Your screenshot is read in your browser and isn't uploaded anywhere. Tip: cropping to just the bet slip reads best.</p></div>`
      : `${I.error ? `<div class="notice err">${esc(I.error)}. You can still paste the text below.</div>` : ""}
         <label class="field"><span>${I.img ? "What we read" : "Share text or link"} <small>edit anything that looks off</small></span>
         <textarea id="imp-text" data-in="imp-text" rows="${I.img ? 7 : 6}" placeholder="Paste the text your book shares, e.g.\n4 Leg Parlay +867\nTexas -7.5 -110\n…\nWager $20.00  To Pay $193.40">${esc(I.text || "")}</textarea></label>
         <div id="imp-preview">${importPreview()}</div>
         <button class="btn primary block" data-act="imp-continue">Review & track</button>`}`;
}

function openDraft() {
  const p = S.imp?.parsed || parseSlipText(S.imp?.text || "");
  const pool = linkPool();
  let linked = 0;
  const legs = p.legs.map((l) => {
    const leg = newFormLeg({ pick: l.pick, odds: l.odds, oddsText: formatOdds(l.odds, fmt()), uncertain: !!l.uncertain });
    const m = linkPick(l.pick, pool, l.context);
    if (m) {
      const g = game(m.gameId);
      Object.assign(leg, m, { gameLabel: g.shortName, kickoff: g.date });
      if (m.market !== "other") linked++;
    }
    return leg;
  });
  const missing = p.legCount && p.legCount > legs.length ? p.legCount - legs.length : 0;
  for (let i = 0; i < missing; i++) legs.push(newFormLeg());
  const type = legs.length > 1 || p.type === "parlay" ? "parlay" : "straight";
  if (!legs.length) legs.push(newFormLeg());
  if (type === "parlay" && legs.length < 2) legs.push(newFormLeg());
  openAdd();
  Object.assign(S.form, {
    type,
    legs,
    stake: p.stake != null ? String(p.stake) : S.form.stake,
    ticket: p.payout != null ? p.payout.toFixed(2) : "",
    book: p.book || S.form.book,
    link: p.url || "",
    override: p.payout == null && p.totalOdds && type === "parlay" ? formatOdds(p.totalOdds, fmt()) : "",
    source: { img: S.imp?.img, missing, linked },
  });
  S.sheet.dirty = true;
  render();
}

// Add-a-pick form ---------------------------------------------------------

function newFormLeg(extra = {}) {
  const d = americanToDecimal(-110);
  return { id: uid(), pick: "", odds: d, oddsText: formatOdds(d, fmt()), ...extra };
}

function openAdd(prefill) {
  S.form = {
    type: "straight",
    legs: [newFormLeg(prefill || {})],
    stake: String(settings.unit),
    win: "",
    lastEdited: "stake",
    override: "",
    boost: "",
    book: settings.lastBook || "",
    note: "",
    linking: null,
    q: "",
    linkGame: null,
    ticket: "",
    link: "",
    source: null,
  };
  if (prefill?.gameId) {
    S.form.linking = S.form.legs[0].id;
    S.form.linkGame = prefill.gameId;
    S.form.legs[0] = newFormLeg();
  }
  openSheet({ kind: "add" });
}

function formCalc() {
  const f = S.form;
  const legs = f.type === "straight" ? f.legs.slice(0, 1) : f.legs;
  const valid = legs.every((l) => l.odds > 1);
  const calc = parlayDecimal(legs.map((l) => l.odds));
  const override = f.type === "parlay" ? parseOdds(f.override)?.decimal : null;
  let dCalc = override > 1 ? override : calc;
  const boost = num(f.boost);
  if (boost > 0) dCalc = 1 + (dCalc - 1) * (1 + boost / 100);
  let d = dCalc;
  let stake = num(f.stake);
  if (f.lastEdited === "win") stake = stakeForWin(num(f.win), d);
  const ticket = num(f.ticket);
  // The payout printed on the ticket is the truth; derive the effective odds from it.
  if (ticket > 0 && stake > 0 && f.lastEdited !== "win") d = ticket / stake;
  return { legs, valid: valid || ticket > 0, calc, d, stake, win: toWin(stake, d), payout: stake * d, calcPayout: valid ? stake * dCalc : 0, ticket, prob: impliedProb(d) };
}

function sheetAdd() {
  const f = S.form;
  const c = formCalc();
  const legs = f.type === "straight" ? f.legs.slice(0, 1) : f.legs;
  const legHtml = legs.map((l, i) => {
    const g = game(l.gameId);
    return `<div class="fleg">
      ${f.type === "parlay" ? `<div class="fl-h"><span>Leg ${i + 1}</span>${legs.length > 2 ? `<button class="link" data-act="form-rm-leg" data-id="${l.id}">Remove</button>` : ""}</div>` : ""}
      <label class="field"><span>Pick</span><input id="f-pick-${l.id}" data-in="f-pick" data-id="${l.id}" placeholder="${i ? "e.g. Over 48.5" : "e.g. Georgia -7.5, Texas ML, Over 52.5"}" value="${esc(l.pick)}" autocomplete="off"></label>
      <div class="field ${l.uncertain ? "unsure" : ""}"><span>Odds <small>${l.uncertain ? "the +/- sign didn't come through. Check it against your slip" : "type +150, -110, 2.5, x9.3 or 5/2"}</small></span>${stepper(`f-odds-${l.id}`, l.oddsText, "f-odds", l.id)}</div>
      ${g
        ? `<div class="linked">${logo(g.away, 18)}${logo(g.home, 18)}<span>Tracking <b>${esc(g.shortName)}</b> · ${esc(relDay(g.date))} ${esc(fmtTime(g.date))}${l.market && l.market !== "other" ? " · auto-grades" : ""}</span><button class="link" data-act="form-unlink" data-id="${l.id}">Unlink</button></div>`
        : f.linking === l.id ? linkPicker(l) : `<button class="link" data-act="form-link" data-id="${l.id}">${icons.live} Link a game for live tracking & auto-grading</button>`}
    </div>`;
  }).join("");
  const src = f.source;
  const imported = src
    ? `<div class="imported">${src.img ? `<img src="${esc(src.img)}" alt="Your bet slip">` : `<span class="imp-ico">${icons.upload}</span>`}
        <div><b>Filled in from your ${src.img ? "screenshot" : "text"}${f.book ? ` · ${esc(f.book)}` : ""}</b>
        <span>Check each leg and price — reading screenshots isn't perfect.${src.missing ? ` <b>${src.missing} leg${src.missing > 1 ? "s" : ""} couldn't be read</b>; fill ${src.missing > 1 ? "them" : "it"} in below.` : ""}${src.linked ? ` ${src.linked} of ${legs.length} matched to a game for live tracking.` : ""}</span></div></div>`
    : "";
  return `<div class="sheet-h"><h2>${src ? "Review imported bet" : "Add a pick"}</h2>${closeBtn()}</div>
    ${imported}
    <div class="form-top">
      <div class="seg type-seg">
        <button class="${f.type === "straight" ? "on" : ""}" data-act="form-type" data-v="straight"><b>Straight</b><small>one pick</small></button>
        <button class="${f.type === "parlay" ? "on" : ""}" data-act="form-type" data-v="parlay"><b>Parlay</b><small>2+ legs, one ticket</small></button>
      </div>
      ${fmtToggle("form-fmt")}
    </div>
    <div class="flegs">${legHtml}</div>
    ${f.type === "parlay" ? `<button class="btn sm ghost" data-act="form-add-leg">+ Add leg</button>
      <div class="pbox">
        <div class="prow"><label>Book's parlay price <small>if it differs</small></label>${stepper("f-override", f.override, "f-override", "", "calc " + odds(c.calc))}</div>
        <div class="prow"><label>Profit boost</label><label class="stake pct"><input id="f-boost" data-in="f-boost" inputmode="decimal" placeholder="0" value="${esc(f.boost)}"><span>%</span></label></div>
      </div>` : ""}
    <div class="money">
      <label class="field"><span>Stake</span><label class="stake"><span>$</span><input id="f-stake" data-in="f-stake" inputmode="decimal" value="${esc(f.lastEdited === "win" ? (c.stake ? c.stake.toFixed(2) : "") : f.stake)}"></label></label>
      <span class="swap">⇄</span>
      <label class="field"><span>To win</span><label class="stake"><span>$</span><input id="f-win" data-in="f-win" inputmode="decimal" value="${esc(f.lastEdited === "win" ? f.win : c.win ? c.win.toFixed(2) : "")}"></label></label>
    </div>
    <label class="field"><span>Payout on your ticket <small>optional · makes hedgehog match your book to the cent</small></span><label class="stake"><span>$</span><input id="f-ticket" data-in="f-ticket" inputmode="decimal" placeholder="${c.calcPayout ? c.calcPayout.toFixed(2) : "from your book"}" value="${esc(f.ticket)}"></label></label>
    <div id="form-calc">${formCalcHtml(c)}</div>
    <div class="money">
      <label class="field"><span>Book</span><input id="f-book" data-in="f-book" list="books" placeholder="DraftKings, FanDuel…" value="${esc(f.book)}"></label>
    </div>
    <label class="field"><span>Note</span><input id="f-note" data-in="f-note" placeholder="Optional" value="${esc(f.note)}"></label>
    <button class="btn primary block" data-act="form-save">Track ${f.type === "parlay" ? `${legs.length}-leg parlay` : "bet"}</button>`;
}

function formCalcHtml(c) {
  return `<div class="summary">
    <div><span>${S.form.type === "parlay" ? "Parlay odds" : "Odds"}</span><b class="odds-big">${c.valid ? odds(c.d) : "—"}</b><small>${c.valid ? (fmt() === "american" ? `${formatOdds(c.d, "decimal")}×` : formatOdds(c.d, "american")) : "check odds"}</small></div>
    <div><span>Implied</span><b>${fmtPct(c.prob)}</b></div>
    <div><span>Payout</span><b class="pos">${fmtMoney(c.payout || 0)}</b><small>profit ${fmtMoney(c.win || 0)}</small></div>
  </div>${S.form.lastEdited !== "win" ? mismatchNote(c.ticket, c.calcPayout) : ""}`;
}

function linkPicker(l) {
  const f = S.form;
  if (f.linkGame) {
    const g = game(f.linkGame);
    const m = markets(g);
    const opt = (s, label) => (s ? `<button class="sel" data-act="form-pick-sel" data-key="${esc(s.key)}" data-id="${l.id}"><span class="ln">${label}</span><span class="pr">${odds(s.odds)}</span></button>` : "");
    return `<div class="picker">
      <div class="pk-h">${logo(g.away, 18)}${logo(g.home, 18)}<b>${esc(g.shortName)}</b><span class="muted">${esc(relDay(g.date))}</span><span class="grow"></span><button class="link" data-act="form-link-back">Back</button></div>
      ${m ? `<div class="pk-grid">
        ${opt(m.spreadAway, `${esc(g.away.abbr)} ${fmtLine(m.spreadAway?.line)}`)}${opt(m.spreadHome, `${esc(g.home.abbr)} ${fmtLine(m.spreadHome?.line)}`)}
        ${opt(m.over, `Over ${m.over?.line}`)}${opt(m.under, `Under ${m.under?.line}`)}
        ${opt(m.mlAway, `${esc(g.away.abbr)} ML`)}${opt(m.mlHome, `${esc(g.home.abbr)} ML`)}
      </div>` : `<p class="muted small">No posted lines for this game.</p>`}
      <button class="link" data-act="form-link-plain" data-id="${l.id}">Just track the score (prop / other market)</button>
    </div>`;
  }
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const res = [...S.games.values()]
    .filter((g) => g.state !== "post" && new Date(g.date) - now < 30 * 864e5)
    .filter((g) => !q || `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q))
    .sort((a, b) => (a.state === "in" ? -1 : 0) - (b.state === "in" ? -1 : 0) || new Date(a.date) - new Date(b.date))
    .slice(0, 8);
  return `<div class="picker">
    <div class="pk-h"><label class="search">${icons.search}<input id="f-q" data-in="f-q" placeholder="Search today & upcoming games" value="${esc(f.q)}" autocomplete="off"></label><button class="link" data-act="form-link-cancel">Cancel</button></div>
    <div class="pk-res" id="pk-res">${res.map((g) => `<button class="pk-row" data-act="form-link-game" data-id="${g.id}">${logo(g.away, 18)}${esc(g.away.short)} <span class="muted">@</span> ${logo(g.home, 18)}${esc(g.home.short)}<span class="grow"></span><small class="muted">${g.state === "in" ? "Live" : esc(relDay(g.date))}</small></button>`).join("") || `<p class="muted small">No games found.</p>`}</div>
  </div>`;
}

function saveForm() {
  const f = S.form;
  const c = formCalc();
  const legs = c.legs;
  for (const l of legs) {
    if (!l.pick.trim()) return toast(`Name your pick${legs.length > 1 ? "s" : ""} (e.g. "Georgia -7.5")`, "err");
    if (!(l.odds > 1) && !(num(f.ticket) > 0)) return toast(`Odds for "${l.pick}" don't look right`, "err");
  }
  if (f.type === "parlay" && legs.length < 2) return toast("A parlay needs at least two legs", "err");
  if (!(c.stake > 0)) return toast("Enter a stake", "err");
  if (!c.legs.every((l) => l.odds > 1) && !(num(f.ticket) > 0)) return toast("Check the odds on each leg", "err");
  const bet = {
    id: uid(),
    createdAt: new Date().toISOString(),
    type: f.type,
    stake: Math.round(c.stake * 100) / 100,
    book: f.book.trim(),
    note: f.note.trim(),
    legs: legs.map((l) => ({ id: uid(), pick: l.pick.trim(), odds: l.odds, status: "open", gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff })),
  };
  if (num(f.ticket) > 0 && f.lastEdited !== "win") bet.ticketPayout = Math.round(num(f.ticket) * 100) / 100;
  if (f.link) bet.link = f.link;
  if (f.type === "parlay") {
    const o = parseOdds(f.override)?.decimal;
    if (o > 1) bet.oddsOverride = o;
    if (num(f.boost) > 0) bet.boostPct = num(f.boost);
  }
  if (bet.book) settings.lastBook = bet.book, saveSettings();
  S.bets.unshift(bet);
  saveBets();
  S.sheet = null;
  S.form = null;
  S.f.betsTab = "open";
  toast(`Tracking ${f.type === "parlay" ? `${legs.length}-leg parlay` : bet.legs[0].pick}`, "won");
  if (S.tab !== "bets") location.hash = "bets";
  render();
}

function paintForm() {
  const c = formCalc();
  const el = $("#form-calc");
  if (el) el.innerHTML = formCalcHtml(c);
  const f = S.form;
  if (f.lastEdited === "win") {
    const s = $("#f-stake");
    if (s && document.activeElement !== s) s.value = c.stake ? c.stake.toFixed(2) : "";
  } else {
    const w = $("#f-win");
    if (w && document.activeElement !== w) w.value = c.win ? c.win.toFixed(2) : "";
  }
  const ov = $("#f-override");
  if (ov) ov.placeholder = "calc " + odds(c.calc);
  const tk = $("#f-ticket");
  if (tk) tk.placeholder = c.calcPayout ? c.calcPayout.toFixed(2) : "from your book";
  const btn = $('[data-act="form-save"]');
  if (btn) btn.textContent = `Track ${f.type === "parlay" ? `${c.legs.length}-leg parlay` : "bet"}`;
}

function sheetSettings() {
  const signedIn = CLOUD && cloud.currentUser();
  return `<div class="sheet-h"><h2>Settings</h2>${closeBtn()}</div>
    <div id="acct">${accountHtml()}</div>
    <div class="set-row"><div><b>Default odds format</b><p class="muted small">Every price in the app switches; you can still type either kind anywhere.</p></div>${fmtToggle("set-fmt")}</div>
    <div class="set-row"><div><b>Unit size</b><p class="muted small">Default stake for new picks and slip previews.</p></div><label class="stake"><span>$</span><input id="set-unit" data-in="set-unit" inputmode="decimal" value="${esc(settings.unit)}"></label></div>
    <div class="set-row"><div><b>Auto-accept line changes</b><p class="muted small">When a price in your slip moves, take the new number instead of asking.</p></div><label class="switch ${settings.autoAccept ? "on" : ""}"><input type="checkbox" data-act="set-auto" ${settings.autoAccept ? "checked" : ""}><span class="knob"></span></label></div>
    <div class="set-row"><div><b>Demo mode</b><p class="muted small">Simulated slate with games that go live and finish while you watch, plus sample bets. Your real bets are kept separately and untouched.</p></div><label class="switch ${settings.demo ? "on" : ""}"><input type="checkbox" data-act="set-demo" ${settings.demo ? "checked" : ""}><span class="knob"></span></label></div>
    <h3 class="sh3">Your data</h3>
    <p class="muted small">${signedIn ? "Your bets are saved on this device and in your account. Export a JSON backup any time." : "Bets live in this browser only. Sign in above to sync them, or export a backup."}</p>
    <div class="dactions">
      <button class="btn sm" data-act="export">Export JSON</button>
      <label class="btn sm">Import JSON<input type="file" accept="application/json,.json" data-change="import" hidden></label>
      <span class="grow"></span>
      <button class="btn sm danger" data-act="wipe">${S.confirmDelete === "wipe" ? (signedIn ? "Tap again: erases on every device" : "Tap again to erase all bets") : "Erase all bets"}</button>
    </div>
    <p class="muted small foot">Scores, schedule, lines and news come from ESPN's public feeds. hedgehog is for tracking and fun — it doesn't place bets.</p>`;
}

// ───────────────────────────── events ─────────────────────────────

function findBet(id) {
  return S.bets.find((b) => b.id === id);
}

function formLeg(id) {
  return S.form?.legs.find((l) => l.id === id);
}

const actions = {
  tab: (el) => {
    location.hash = el.dataset.v;
  },
  "open-add": () => openAdd(),
  "pick-image": () => $("#slip-file").click(),
  "open-import-text": () => handleText(""),
  "imp-continue": () => openDraft(),
  "add-for-game": (el) => openAdd({ gameId: el.dataset.id }),
  "open-settings": () => openSheet({ kind: "settings" }),
  "open-bet": (el) => openSheet({ kind: "bet", id: el.dataset.id }),
  "open-game": (el) => openSheet({ kind: "game", id: el.dataset.id }),
  "open-slip": () => openSheet({ kind: "slip" }),
  "close-sheet": () => {
    S.sheet = null;
    S.confirmDelete = null;
    render();
  },
  "set-fmt": (el) => {
    settings.oddsFormat = el.dataset.v;
    saveSettings();
    for (const l of S.slip.legs) delete l.oddsText;
    delete S.slip.overrideText;
    if (S.sheet?.kind === "settings") S.sheet.dirty = true;
    render();
  },
  refresh: (el) => {
    const m = { today: refreshToday, schedule: refreshSchedule, news: refreshNews };
    S.st[el.dataset.v].tried = Date.now();
    m[el.dataset.v]();
  },
  period: (el) => ((S.f.period = el.dataset.v), render()),
  "bets-tab": (el) => ((S.f.betsTab = el.dataset.v), render()),
  "live-f": (el) => ((S.f.live = el.dataset.v), render()),
  "sched-top25": () => {
    S.f.top25 = !S.f.top25;
    settings.top25Only = S.f.top25;
    saveSettings();
    render();
  },
  "sched-line": () => ((S.f.hasLine = !S.f.hasLine), render()),
  "news-f": (el) => ((S.f.news = el.dataset.v), render()),
  "build-day": (el) => ((S.f.buildDay = el.dataset.v), render()),
  "demo-on": () => {
    settings.demo = true;
    saveSettings();
    location.reload();
  },
  sim: (el) => setSim(el.checked),

  // slip
  "toggle-sel": (el) => toggleSel(el.dataset.key),
  "slip-remove": (el) => {
    S.slip.legs = S.slip.legs.filter((l) => l.id !== el.dataset.id);
    delete S.slip.stakes[el.dataset.id];
    if (S.slip.legs.length < 2) S.slip.mode = "singles";
    saveSlip();
    render();
  },
  "slip-clear": () => {
    S.slip = { ...S.slip, legs: [], stakes: {}, override: "", boost: "", modeTouched: false };
    saveSlip();
    if (S.sheet?.kind === "slip") S.sheet = null;
    render();
  },
  "slip-mode": (el) => {
    S.slip.mode = el.dataset.v;
    S.slip.modeTouched = true;
    saveSlip();
    render();
  },
  "slip-odds-step": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.odds = stepOdds(l.odds, Number(el.dataset.dir), fmt());
    l.edited = true;
    delete l.oddsText;
    saveSlip();
    render();
  },
  "slip-override-step": (el) => {
    const cur = parseOdds(S.slip.override)?.decimal || slipCalc().rawParlay;
    S.slip.override = formatOdds(stepOdds(cur, Number(el.dataset.dir), fmt()), fmt());
    delete S.slip.overrideText;
    saveSlip();
    render();
  },
  "slip-accept": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    const s = selByKey(l.key);
    if (s) Object.assign(l, { line: s.line, odds: s.odds, edited: false });
    delete l.oddsText;
    saveSlip();
    render();
  },
  "slip-quick": (el) => {
    S.slip.stake = el.dataset.v;
    saveSlip();
    render();
  },
  "slip-custom": () => {
    const d = americanToDecimal(100);
    const leg = { id: uid(), key: `custom|${uid()}`, custom: true, pick: "", odds: d, status: "open" };
    S.slip.legs.push(leg);
    saveSlip();
    const inBuild = S.tab === "build" && matchMedia("(min-width: 980px)").matches;
    if (!inBuild && S.sheet?.kind !== "slip") openSheet({ kind: "slip" });
    else render();
    setTimeout(() => {
      const inp = document.getElementById(`slip-pick-${leg.id}`);
      inp?.closest(".sleg")?.scrollIntoView({ block: "nearest" });
      inp?.focus();
    }, 40);
  },
  "slip-track": () => trackSlip(),

  // bets
  "grade-leg": (el) => {
    const b = findBet(el.dataset.bet);
    const l = b.legs.find((x) => x.id === el.dataset.leg);
    l.status = el.dataset.v;
    l.autoGraded = false;
    b.settledAt = betStatus(b) === "open" ? null : new Date().toISOString();
    saveBets();
    render();
  },
  cashout: (el) => {
    const amt = num($("#cashout-amt")?.value);
    if (!(amt >= 0) || !$("#cashout-amt")?.value) return toast("Enter the cash-out amount", "err");
    const b = findBet(el.dataset.id);
    b.cashout = amt;
    b.settledAt = new Date().toISOString();
    saveBets();
    toast(`Cashed out ${fmtMoney(amt)}`, amt >= b.stake ? "won" : "");
    render();
  },
  "set-ticket": (el) => {
    const b = findBet(el.dataset.id);
    const v = num($("#ticket-amt")?.value);
    if (!(v > b.stake * 0.99)) return toast("Enter the total payout shown on your ticket (stake + winnings)", "err");
    b.ticketPayout = Math.round(v * 100) / 100;
    saveBets();
    toast(`Payout set to ${fmtMoney(b.ticketPayout)}`, "won");
    render();
  },
  "clear-ticket": (el) => {
    delete findBet(el.dataset.id).ticketPayout;
    saveBets();
    render();
  },
  "undo-cashout": (el) => {
    const b = findBet(el.dataset.id);
    delete b.cashout;
    b.settledAt = betStatus(b) === "open" ? null : b.settledAt;
    saveBets();
    render();
  },
  "delete-bet": (el) => {
    if (S.confirmDelete !== el.dataset.id) {
      S.confirmDelete = el.dataset.id;
      return render();
    }
    S.bets = S.bets.filter((b) => b.id !== el.dataset.id);
    S.confirmDelete = null;
    S.sheet = null;
    saveBets();
    toast("Bet deleted");
    render();
  },
  rebuild: (el) => {
    const b = findBet(el.dataset.id);
    let n = 0;
    for (const l of b.legs) {
      if (!l.gameId || !l.market) continue;
      const s = selByKey(`${l.gameId}|${l.market}|${l.side}`);
      if (s && !S.slip.legs.some((x) => x.key === s.key)) {
        S.slip.legs.push(slipLegFromSel(s));
        n++;
      }
    }
    if (!n) return toast("Those markets aren't open anymore", "err");
    if (S.slip.legs.length > 1) S.slip.mode = "parlay";
    saveSlip();
    S.sheet = null;
    location.hash = "build";
    render();
  },

  // add form
  "form-type": (el) => {
    const f = S.form;
    f.type = el.dataset.v;
    if (f.type === "parlay") while (f.legs.length < 2) f.legs.push(newFormLeg());
    S.sheet.dirty = true;
    render();
  },
  "form-fmt": (el) => {
    settings.oddsFormat = el.dataset.v;
    saveSettings();
    for (const l of S.form.legs) l.oddsText = formatOdds(l.odds, fmt());
    const o = parseOdds(S.form.override)?.decimal;
    if (o) S.form.override = formatOdds(o, fmt());
    S.sheet.dirty = true;
    render();
  },
  "form-add-leg": () => {
    S.form.legs.push(newFormLeg());
    S.sheet.dirty = true;
    render();
    setTimeout(() => document.getElementById(`f-pick-${S.form.legs[S.form.legs.length - 1].id}`)?.focus(), 30);
  },
  "form-rm-leg": (el) => {
    S.form.legs = S.form.legs.filter((l) => l.id !== el.dataset.id);
    S.sheet.dirty = true;
    render();
  },
  "f-odds-step": (el) => {
    const l = formLeg(el.dataset.id);
    l.uncertain = false;
    document.getElementById(`f-odds-${l.id}`)?.closest(".field")?.classList.remove("unsure");
    l.odds = stepOdds(l.odds > 1 ? l.odds : americanToDecimal(-110), Number(el.dataset.dir), fmt());
    l.oddsText = formatOdds(l.odds, fmt());
    const inp = document.getElementById(`f-odds-${l.id}`);
    if (inp) inp.value = l.oddsText;
    paintForm();
  },
  "f-override-step": (el) => {
    const f = S.form;
    const cur = parseOdds(f.override)?.decimal || formCalc().calc;
    f.override = formatOdds(stepOdds(cur, Number(el.dataset.dir), fmt()), fmt());
    const inp = $("#f-override");
    if (inp) inp.value = f.override;
    paintForm();
  },
  "form-link": (el) => {
    S.form.linking = el.dataset.id;
    S.form.linkGame = null;
    S.form.q = "";
    S.sheet.dirty = true;
    render();
    setTimeout(() => $("#f-q")?.focus(), 30);
  },
  "form-link-cancel": () => {
    S.form.linking = null;
    S.sheet.dirty = true;
    render();
  },
  "form-link-game": (el) => {
    S.form.linkGame = el.dataset.id;
    S.sheet.dirty = true;
    render();
  },
  "form-link-back": () => {
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
  },
  "form-pick-sel": (el) => {
    const s = selByKey(el.dataset.key);
    const l = formLeg(el.dataset.id);
    if (!s || !l) return;
    const g = game(s.gameId);
    Object.assign(l, { gameId: g.id, market: s.market, side: s.side, line: s.line, odds: s.odds, oddsText: formatOdds(s.odds, fmt()), gameLabel: g.shortName, kickoff: g.date });
    l.pick = legLabel(l, g);
    S.form.linking = null;
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
  },
  "form-link-plain": (el) => {
    const l = formLeg(el.dataset.id);
    const g = game(S.form.linkGame);
    Object.assign(l, { gameId: g.id, market: "other", gameLabel: g.shortName, kickoff: g.date });
    S.form.linking = null;
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
    setTimeout(() => document.getElementById(`f-pick-${l.id}`)?.focus(), 30);
  },
  "form-unlink": (el) => {
    const l = formLeg(el.dataset.id);
    for (const k of ["gameId", "market", "side", "line", "gameLabel", "kickoff"]) delete l[k];
    S.sheet.dirty = true;
    render();
  },
  "form-save": () => saveForm(),

  // settings
  "set-auto": (el) => {
    settings.autoAccept = el.checked;
    saveSettings();
    S.sheet.dirty = true;
    render();
  },
  "set-demo": (el) => {
    settings.demo = el.checked;
    saveSettings();
    location.reload();
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ app: "hedgehog", version: 1, exportedAt: new Date().toISOString(), bets: S.bets, settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hedgehog-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  "acct-mode": (el) => {
    acct.email = ($("#acct-email")?.value ?? acct.email).trim();
    acct.mode = el.dataset.v;
    acct.error = "";
    paintAcct();
    setTimeout(() => $(acct.email ? "#acct-pw" : "#acct-email")?.focus(), 30);
  },
  "acct-signin": () => acctSubmit(async (email, pw) => {
    await cloud.signIn(email, pw);
    toast("Signed in. Syncing your bets…", "won");
  }),
  "acct-signup": () => acctSubmit(async (email, pw) => {
    const r = await cloud.signUp(email, pw);
    if (r.signedIn) toast("Account created. Syncing your bets…", "won");
    else acct.mode = "sent-confirm";
  }),
  "acct-reset": () => acctSubmit(async (email) => {
    await cloud.resetPassword(email);
    acct.mode = "sent-reset";
  }, { needPw: false }),
  "acct-newpw": async () => {
    const pw = $("#acct-pw")?.value || "";
    if (pw.length < 6) {
      acct.error = "Use a password with at least 6 characters.";
      return paintAcct();
    }
    acct.busy = true;
    acct.error = "";
    paintAcct();
    try {
      await cloud.updatePassword(pw);
      acct.mode = "signin";
      toast("Password updated", "won");
      if (S.sheet?.kind === "settings") S.sheet.dirty = true;
      render();
    } catch (e) {
      acct.error = e.message;
    }
    acct.busy = false;
    paintAcct();
  },
  "sync-now": () => syncNow({ announce: true }),
  "sign-out": async () => {
    if (S.confirmDelete !== "signout") {
      S.confirmDelete = "signout";
      $('[data-act="sign-out"]').textContent = "Tap again to sign out";
      return;
    }
    S.confirmDelete = null;
    await cloud.signOut();
    toast("Signed out. Your bets stay on this device.");
  },
  "dismiss-sync": () => {
    settings.syncBannerDismissed = true;
    saveSettings();
    render();
  },
  wipe: () => {
    if (S.confirmDelete !== "wipe") {
      S.confirmDelete = "wipe";
      S.sheet.dirty = true;
      return render();
    }
    S.bets = [];
    S.confirmDelete = null;
    saveBets();
    S.sheet = null;
    toast("All bets erased");
    render();
  },
};

const inputs = {
  "sched-q": (el) => {
    S.f.q = el.value;
    render();
  },
  "build-q": (el) => {
    S.f.buildQ = el.value;
    render();
  },
  "slip-odds": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.oddsText = el.value;
    const p = parseOdds(el.value);
    if (p) {
      l.odds = p.decimal;
      l.edited = true;
    }
    saveSlip();
    paintSlipCalc();
  },
  "slip-stake": (el) => {
    S.slip.stakes[el.dataset.id] = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-pstake": (el) => {
    S.slip.stake = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-override": (el) => {
    S.slip.overrideText = el.value;
    S.slip.override = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-boost": (el) => {
    S.slip.boost = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-pick": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.pick = el.value;
    saveSlip();
  },
  "slip-ticket": (el) => {
    S.slip.ticket = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-book": (el) => {
    S.slip.book = el.value;
    saveSlip();
  },
  hedge: (el) => {
    S.sheet.hedge = el.value;
    const b = findBet(S.sheet.id);
    const d = parseOdds(el.value)?.decimal;
    $("#hedge-out").innerHTML = hedgeText(d ? hedge(potentialPayout(b), b.stake, d) : null);
  },
  "bet-note": (el) => {
    const b = findBet(el.dataset.id);
    b.note = el.value;
    saveBets();
  },
  "f-pick": (el) => (formLeg(el.dataset.id).pick = el.value),
  "f-odds": (el) => {
    const l = formLeg(el.dataset.id);
    l.uncertain = false;
    el.closest(".field")?.classList.remove("unsure");
    l.oddsText = el.value;
    const p = parseOdds(el.value);
    l.odds = p ? p.decimal : NaN;
    el.classList.toggle("bad", !p && el.value.trim() !== "");
    paintForm();
  },
  "f-override": (el) => ((S.form.override = el.value), paintForm()),
  "f-boost": (el) => ((S.form.boost = el.value), paintForm()),
  "f-stake": (el) => ((S.form.stake = el.value), (S.form.lastEdited = "stake"), paintForm()),
  "f-win": (el) => ((S.form.win = el.value), (S.form.lastEdited = "win"), paintForm()),
  "f-book": (el) => (S.form.book = el.value),
  "f-ticket": (el) => ((S.form.ticket = el.value), paintForm()),
  "imp-text": (el) => {
    S.imp.text = el.value;
    S.imp.parsed = parseSlipText(el.value);
    $("#imp-preview").innerHTML = importPreview();
  },
  "f-note": (el) => (S.form.note = el.value),
  "f-q": (el) => {
    S.form.q = el.value;
    S.sheet.dirty = true;
    render();
  },
  "set-unit": (el) => {
    const n = num(el.value);
    if (n > 0) {
      settings.unit = n;
      saveSettings();
    }
  },
};

function paintSlipCalc() {
  const c = slipCalc();
  $$("#slip-summary").forEach((el) => (el.innerHTML = slipSummary(c)));
  for (const l of S.slip.legs) $$(`[data-towin="${CSS.escape(l.id)}"]`).forEach((el) => (el.innerHTML = towinText(l)));
  $$(".slip-mode [data-v=parlay] em").forEach((el) => (el.textContent = c.legs.length > 1 ? odds(c.rawParlay) : ""));
  paintDock();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.tagName === "INPUT" && el.type === "checkbox") return; // handled on change
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === "A") e.preventDefault();
  // Nested actionable elements inside a card: the innermost wins.
  e.stopPropagation();
  fn(el, e);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches('input[type="checkbox"][data-act]')) return actions[el.dataset.act]?.(el);
  if (el.dataset.change === "import") return importFile(el.files?.[0]);
  if (el.id === "slip-file") {
    const f = el.files?.[0];
    el.value = "";
    return handleImage(f);
  }
  // Odds boxes: reformat once the user leaves the field.
  if (el.dataset.in === "slip-odds") {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    if (l) delete l.oddsText;
    render();
  } else if (el.dataset.in === "slip-override") {
    const p = parseOdds(S.slip.override);
    S.slip.override = p ? formatOdds(p.decimal, fmt()) : "";
    delete S.slip.overrideText;
    saveSlip();
    render();
  } else if (el.dataset.in === "f-odds") {
    const l = formLeg(el.dataset.id);
    if (l?.odds > 1) el.value = l.oddsText = formatOdds(l.odds, fmt());
  }
});

document.addEventListener("input", (e) => {
  const fn = inputs[e.target.dataset?.in];
  if (fn) fn(e.target);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target.id === "acct-email" || e.target.id === "acct-pw")) {
    e.preventDefault();
    const act = { signin: "acct-signin", signup: "acct-signup", forgot: "acct-reset", newpw: "acct-newpw" }[acct.mode];
    if (act) actions[act]();
  }
  if (e.key === "Escape" && S.sheet) {
    S.sheet = null;
    render();
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".dropzone")) {
    e.preventDefault();
    $("#slip-file").click();
  }
  if (e.key === "Enter" && e.target.matches("[data-act='open-bet'],[data-act='open-game']") && e.target.tagName !== "BUTTON") {
    actions[e.target.dataset.act](e.target);
  }
  // Arrow keys nudge odds in any odds box.
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.target.matches("[data-in='f-odds'],[data-in='slip-odds']")) {
    e.preventDefault();
    const act = e.target.dataset.in === "f-odds" ? "f-odds-step" : "slip-odds-step";
    actions[act]({ dataset: { id: e.target.dataset.id, dir: e.key === "ArrowUp" ? "1" : "-1" } });
    setTimeout(() => document.getElementById(e.target.id)?.focus(), 0);
  }
});

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const bets = Array.isArray(data) ? data : data.bets;
    if (!Array.isArray(bets) || bets.some((b) => !Array.isArray(b.legs))) throw new Error("bad file");
    const have = new Set(S.bets.map((b) => b.id));
    const fresh = bets.filter((b) => !have.has(b.id));
    S.bets = [...fresh, ...S.bets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    saveBets();
    toast(`Imported ${fresh.length} bet${fresh.length === 1 ? "" : "s"}`, "won");
    S.sheet = null;
    render();
  } catch {
    toast("That file isn't a hedgehog export", "err");
  }
}

// Drag a screenshot anywhere onto the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $("#dropover").hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("#dropover").hidden = true;
});
window.addEventListener("drop", (e) => {
  dragDepth = 0;
  $("#dropover").hidden = true;
  const dt = e.dataTransfer;
  if (!dt) return;
  const file = [...(dt.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    return handleImage(file);
  }
  const text = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (text && !e.target.closest?.("input, textarea")) {
    e.preventDefault();
    handleText(text);
  }
});

// Paste a screenshot (or share text) anywhere that isn't a text field.
document.addEventListener("paste", (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const img = [...cd.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  if (img) {
    e.preventDefault();
    return handleImage(img.getAsFile());
  }
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  const text = cd.getData("text/plain");
  if (text?.trim()) {
    e.preventDefault();
    handleText(text);
  }
});

/** Sign-up confirmation / password-reset links land here with tokens in the URL hash. */
function handleAuthLink() {
  if (!CLOUD || !/access_token=|error_description=/.test(location.hash)) return false;
  cloud.sessionFromUrl().then((kind) => {
    if (kind === "recovery") {
      acct.mode = "newpw";
      openSheet({ kind: "settings" });
      setTimeout(() => $("#acct-pw")?.focus(), 60);
    } else if (kind === "signup") toast("Email confirmed. You're signed in and syncing.", "won");
    else if (kind) toast("Signed in. Syncing your bets…", "won");
  }).catch((e) => toast(e.message, "err"));
  return true;
}

window.addEventListener("hashchange", () => {
  if (handleAuthLink()) return;
  const t = location.hash.slice(1);
  if (TABS.includes(t)) {
    S.tab = t;
    S.sheet = null;
    render();
    window.scrollTo({ top: 0 });
    if (t === "news" && !S.st.news.at) refreshNews();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    tick();
    syncNow();
  }
});
window.addEventListener("online", () => syncNow());

// Keep data from other tabs in sync (e.g. bet added in another window).
window.addEventListener("storage", (e) => {
  if (e.key === `lw.${NS}bets`) {
    S.bets = load(NS + "bets", []);
    render();
  }
});

// ───────────────────────────── boot ─────────────────────────────

function boot() {
  $("#nav").innerHTML = TABS.map((t) => `<a href="#${t}" data-tab="${t}">${icons[t]}<span>${{ bets: "Bets", live: "Live", schedule: "Upcoming", build: "Build", news: "News" }[t]}</span></a>`).join("");
  $("#books").innerHTML = BOOKS.map((b) => `<option value="${b}">`).join("");
  $("#btn-settings").innerHTML = icons.gear;
  $("#btn-add").innerHTML = `${icons.plus}<span>Add pick</span>`;
  $("#fab").innerHTML = icons.plus;
  $("#dropover .dz-ico").innerHTML = icons.upload;
  $("#today-top").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  loadCache();
  render();
  if (CLOUD) {
    handleAuthLink();
    if (cloud.currentUser()) syncNow();
  }
  tick(true);
  setInterval(tick, 5000);
  // Installed-app support (Add to Home Screen): offline shell + faster launches.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // When a new version takes over, reload once so every file is the new one.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  }
}

boot();
