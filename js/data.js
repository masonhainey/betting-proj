// Feed refreshing (ESPN or demo), caching, kickoff/line tracking, auto-grading, polling.

import { alertsForGraded, watchGames, alertsOn } from "./alerts.js";
import { ymd, addDays, etDay } from "./espn.js";
import { americanToDecimal, fmtMoney } from "./odds.js";
import { betStatus, betProfit, legLabel, autoGrade } from "./grade.js";
import { needsLink, relinkLegs } from "./relink.js";
import { findPlayer } from "./props.js";
import * as cloud from "./cloud.js";
import { load, save, uid } from "./store.js";
import { tagArticle } from "./news.js";
import { dayKey, startOfDay } from "./ui.js";
import { CLOUD, acct, syncNow } from "./account.js";
import { detectMoves } from "./market.js";
import { paintAgo, paintStatus, render } from "./render.js";
import { NS, S, game, saveBets, saveSettings, settings, sport, src, toast } from "./state.js";

// ───────────────────────────── data ─────────────────────────────

const cacheKey = () => NS + (sport() === "cfb" ? "cache" : `cache.${sport()}`);

export function loadCache() {
  const c = load(cacheKey(), null);
  if (!c?.games) return;
  const tomorrow = addDays(startOfDay(), 1);
  const today = dayKey(new Date());
  for (const g of c.games) S.games.set(g.id, g);
  S.scheduleIds = c.games.filter((g) => new Date(g.date) >= tomorrow).map((g) => g.id);
  S.todayIds = c.games.filter((g) => dayKey(g.date) === today).map((g) => g.id);
  S.st.schedule.cachedAt = c.at;
}

export function saveCache() {
  const ids = new Set([...S.scheduleIds, ...S.todayIds]);
  save(cacheKey(), { at: S.st.schedule.at || Date.now(), games: [...ids].map(game).filter(Boolean) });
}

export function merge(games) {
  const now = Date.now();
  for (const g of games) {
    if (S.box[g.id]) g.box = S.box[g.id];
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

export function pruneTracking() {
  const cutoff = Date.now() - 3 * 864e5;
  for (const [id, k] of Object.entries(S.kick)) if (new Date(k.d) < cutoff) delete S.kick[id];
  for (const [id, L] of Object.entries(S.lines)) if (new Date(L.date) < cutoff) delete S.lines[id];
}

export function afterData() {
  const linked = relinkLegs(S.bets, [...S.games.values()]);
  const changed = autoGrade(S.bets, game);
  if (linked.length && !changed.length) saveBets();
  alertsForGraded(changed);
  watchGames();
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
      if (b.ghost) toast(st === "won" ? `👻 Your pass hit: ${what}. Would've won ${fmtMoney(p, { sign: true })}` : st === "lost" ? `👻 Good pass: ${what} lost. Dodged ${fmtMoney(b.stake)}` : `👻 Pass pushed: ${what}`, st);
      else toast(st === "won" ? `💰 Cashed: ${what} ${fmtMoney(p, { sign: true })}` : st === "lost" ? `Lost: ${what} (${fmtMoney(p)})` : `Push: ${what}. Stake back`, st, st === "won");
    }
  }
  detectMoves();
  save(NS + "kickoffs", S.kick);
  save(NS + "lines", S.lines);
  render();
}

export async function refreshToday() {
  const st = S.st.today;
  st.loading = true;
  paintStatus();
  const sp = sport();
  try {
    const games = await src().fetchScoreboard(ymd(new Date()), { sport: sp });
    merge(games);
    if (sp !== sport()) return; // switched leagues mid-request
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

export async function refreshSchedule() {
  const st = S.st.schedule;
  st.loading = true;
  paintStatus();
  const sp = sport();
  try {
    const start = addDays(startOfDay(), 1);
    const { games, failedDays } = await src().fetchRange(start, 28, { sport: sp });
    merge(games);
    if (sp !== sport()) return;
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

/**
 * Scores for open bets that today's scoreboard doesn't cover: games from earlier days,
 * late games ESPN files under yesterday's date, and days an unlinked pick might be on.
 */
const looked = new Set(); // days already searched for unlinked picks this session
const legSport = (l) => l.sport || game(l.gameId)?.sport || "cfb";
export async function refreshBetGames() {
  const st = S.st.betGames;
  const now = Date.now();
  const days = new Set();
  const today = new Set(S.todayIds);
  for (const b of S.bets) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      if (l.status !== "open") continue;
      if (l.gameId && l.kickoff) {
        const g = game(l.gameId);
        const t = Date.parse(g?.date || l.kickoff);
        if (t <= now && now - t < 14 * 864e5 && g?.state !== "post" && !today.has(l.gameId)) days.add(`${legSport(l)}|${etDay(t)}`);
      } else if (needsLink(l)) {
        // Look through the days from when it was placed up to yesterday, in both leagues
        // (today and later are loaded anyway for the league on screen).
        const placed = Date.parse(b.createdAt) || now;
        for (let t = Math.max(placed - 864e5, now - 7 * 864e5); t < now - 864e5 / 2; t += 864e5) {
          for (const sp of ["cfb", "nfl"]) {
            const d = `${sp}|${etDay(t)}`;
            if (!looked.has(d)) days.add(d), looked.add(d);
          }
        }
      }
    }
  }
  if (!days.size) return;
  st.loading = true;
  const res = await Promise.allSettled([...days].map((k) => {
    const [sp, d] = k.split("|");
    return src().fetchScoreboard(d, { sport: sp });
  }));
  for (const r of res) if (r.status === "fulfilled") merge(r.value);
  st.at = Date.now();
  st.loading = false;
  afterData();
}

/**
 * Box scores for games you have player props on: live progress, and the final line to
 * settle them. Props with no game yet get found by searching the day's box scores.
 */
const boxAt = {}; // gameId → last fetch
const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
export async function refreshBoxes() {
  const st = S.st.boxes;
  const now = Date.now();
  const want = new Map(); // gameId → league
  const hunting = []; // prop legs with no game yet
  for (const b of S.bets) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      if (l.status !== "open" || l.market !== "prop" || !l.prop) continue;
      if (!l.gameId) { hunting.push({ b, l }); continue; }
      const g = game(l.gameId);
      if (g && g.state !== "pre" && !S.box[g.id]?.final) want.set(g.id, legSport(l));
    }
  }
  const huntOnly = new Set();
  if (hunting.length) {
    for (const g of S.games.values()) {
      if (g.state === "pre" || want.has(g.id) || want.size >= 40) continue;
      const t = Date.parse(g.date);
      if (hunting.some(({ b }) => { const p = Date.parse(b.createdAt) || now; return t >= p - 12 * 3600e3 && t <= p + 36 * 3600e3; })) {
        want.set(g.id, g.sport || "cfb");
        huntOnly.add(g.id);
      }
    }
  }
  const due = [...want].filter(([id]) => {
    const g = game(id), last = boxAt[id] || 0;
    if (S.box[id]?.final) return false;
    const every = huntOnly.has(id) ? (settings.demo ? 20000 : 180000) : g?.state === "in" ? (settings.demo ? 8000 : 45000) : 60000;
    return now - last >= every;
  });
  if (!due.length || st.loading) return;
  st.loading = true;
  const res = await Promise.allSettled(due.map(([id, sp]) => (boxAt[id] = now, src().fetchBox(id, { sport: sp }).then((box) => [id, box]))));
  st.loading = false;
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    const [id, box] = r.value;
    S.box[id] = box;
    const g = game(id);
    if (g) g.box = box;
  }
  // Link props to the game their player turned up in (only when it's one game, not a guess).
  let linked = 0;
  for (const { l } of hunting) {
    const found = Object.entries(S.box).filter(([id]) => game(id)).map(([id, box]) => [id, findPlayer(l.prop.player, box.players)]).filter(([, p]) => p);
    const exact = found.filter(([, p]) => nameKey(p.name) === nameKey(l.prop.player));
    const hits = exact.length ? exact : found;
    if (hits.length !== 1) continue; // nobody, or more than one game: don't guess
    const g = game(hits[0][0]);
    Object.assign(l, { gameId: g.id, sport: g.sport || "cfb", gameLabel: g.shortName, kickoff: g.date, autoLinked: true });
    linked++;
  }
  if (linked) saveBets();
  afterData();
}

export async function refreshNews() {
  const st = S.st.news;
  st.loading = true;
  paintStatus();
  const sp = sport();
  try {
    const news = (await src().fetchNews({ sport: sp })).map((a) => ({ ...a, tags: tagArticle(a) }));
    if (sp !== sport()) return;
    S.news = news;
    st.at = Date.now();
    st.error = null;
  } catch (e) {
    st.error = e.message || "News unavailable";
  }
  st.loading = false;
  render();
}

/** Switch the game views between leagues. Your bets, stats and friends stay as they are. */
export function switchSport(k) {
  if (k === sport()) return;
  settings.sport = k;
  saveSettings();
  S.todayIds = [];
  S.scheduleIds = [];
  S.news = [];
  S.st.today = {};
  S.st.schedule = {};
  S.st.news = {};
  if (S.f.live === "top25") S.f.live = "all";
  loadCache();
  render();
  tick(true);
}

/** You have an open leg on a game that's live or about to start. */
function liveAction(now) {
  return S.bets.some((b) => b.legs.some((l) => {
    if (l.status !== "open" || !l.gameId) return false;
    const g = game(l.gameId);
    return g && (g.state === "in" || (g.state === "pre" && new Date(g.date) - now < 15 * 60000));
  }));
}

export function tick(force) {
  const now = Date.now();
  if (document.hidden && !force) {
    // In the background, keep an eye on your live games (gently) only if alerts are on.
    if (!alertsOn() || !liveAction(now)) return;
    const st = S.st.today;
    if (!st.loading && (!st.tried || now - st.tried >= (settings.demo ? 8000 : 60000))) {
      st.tried = now;
      refreshToday();
      if (!S.st.betGames.loading) refreshBetGames(); // your games in the other league
      refreshBoxes(); // player props
    }
    return;
  }
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
  due("betGames", liveAction(now) ? 30000 : 90000, refreshBetGames);
  due("news", 600000, refreshNews);
  due("boxes", settings.demo ? 8000 : 30000, refreshBoxes);
  paintAgo();
  if (CLOUD && cloud.currentUser() && !document.hidden && Date.now() - Math.max(acct.lastSync, acct.lastTry || 0) > 30000) syncNow();
}

// ───────────────────────────── demo seed ─────────────────────────────

export function seedDemo() {
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
      // Every 5th sample bet is a pass you tracked but didn't place.
      ...(i % 5 === 2 ? { ghost: true } : {}),
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
  if (live3) bets.push({ id: uid(), createdAt: new Date(Date.now() - 2400e3).toISOString(), type: "straight", stake: 25, ghost: true, legs: [linked(live3, "spread", "home", spreadOf(live3, "home"), -110)] });
  // Player props: one tied to its game, and a parlay that names no team (found via box scores).
  const ros = (t) => src().demoRoster?.(t.id, t.league);
  if (live1 && ros(live1.away)) {
    const qb = ros(live1.away).QB.name;
    bets.push({ id: uid(), createdAt: new Date(Date.now() - 3000e3).toISOString(), type: "straight", stake: 20, book: "DraftKings", legs: [
      { id: uid(), pick: `${qb} Over 224.5 Passing Yards`, odds: americanToDecimal(-115), status: "open", gameId: live1.id, sport: live1.sport, gameLabel: live1.shortName, kickoff: live1.date },
    ] });
  }
  if (live2 && ros(live2.home)) {
    bets.push({ id: uid(), createdAt: new Date(Date.now() - 2000e3).toISOString(), type: "parlay", stake: 10, book: "FanDuel", legs: [
      { id: uid(), pick: `${ros(live2.home).RB.name} anytime TD`, odds: americanToDecimal(-140), status: "open" },
      { id: uid(), pick: `${ros(live2.away).WR1.name} 5+ Receptions`, odds: americanToDecimal(-120), status: "open" },
    ] });
  }
  bets.push({ id: uid(), createdAt: new Date().toISOString(), type: "parlay", stake: 5, book: "FanDuel", boostPct: 25, legs: [
    { id: uid(), pick: "Heisman: Arch Manning", odds: americanToDecimal(900), status: "open" },
    { id: uid(), pick: "Texas to make CFP", odds: americanToDecimal(-250), status: "open" },
  ] });
  S.bets = bets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveBets();
}
