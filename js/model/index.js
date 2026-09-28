// The model in the app: loads the league's model file (built by the GitHub Action), reads
// live factors for each game (ESPN injury report and predictor, weather, rest), and turns
// them into chances, edges, explanations and rotating parlay picks.

import { NS, S, game, src } from "../state.js";
import { load, save } from "../store.js";
import { markets } from "../market.js";
import { predict } from "./ratings.js";
import { legEdge, legProb, view } from "./edge.js";
import { liveFactors, pickVeto } from "./live.js";

export const M = { cfb: null, nfl: null }; // sport → { data, model, cards, weight, at } | { error, at }
const busy = {};
const listeners = new Set();
export const onModel = (fn) => listeners.add(fn);
let pending = null;
const notify = () => {
  clearTimeout(pending);
  pending = setTimeout(() => listeners.forEach((fn) => fn()), 120);
};

/** Load the league's model file. Cheap to call often. */
export async function ensureModel(sport) {
  const m = M[sport];
  if (busy[sport] || (m && Date.now() - m.at < (m.error ? 90e3 : 30 * 60e3))) return m;
  busy[sport] = true;
  try {
    const data = await src().fetchModelData(sport);
    if (!data?.model?.r) throw new Error("Model file is empty");
    M[sport] = { data, model: data.model, cards: data.cards, weight: data.weight, at: Date.now() };
  } catch (e) {
    M[sport] = { ...(m?.data ? m : {}), error: e.message || "Model unavailable", at: Date.now() };
  } finally {
    busy[sport] = false;
    notify();
  }
  return M[sport];
}
export const modelLoading = (sport) => !!busy[sport] && !M[sport]?.model;
export const trusted = (sport) => !!M[sport]?.cards?.all?.trusted;

// ───────── live factors ─────────

const LIVE = {}; // gameId → { pre, wx, at, loading, err }
const LIVE_TTL = 15 * 60e3;

/** Pull the injury report, predictor and weather for a game (cached ~15 min). */
export async function loadLive(g, { force = false } = {}) {
  if (!g || g.state !== "pre") return LIVE[g?.id];
  const c = LIVE[g.id];
  if (c?.loading) return c.loading;
  if (!force && c?.at && Date.now() - c.at < LIVE_TTL) return c;
  const job = (async () => {
    const [sum, wx] = await Promise.allSettled([src().fetchSummary(g.id, { sport: g.sport || "cfb" }), src().fetchWeather(g)]);
    LIVE[g.id] = {
      pre: sum.status === "fulfilled" ? sum.value.pre : c?.pre || null,
      wx: wx.status === "fulfilled" ? wx.value : c?.wx || null,
      at: Date.now(),
      err: sum.status === "rejected" ? "injury report unavailable" : null,
    };
    notify();
    return LIVE[g.id];
  })();
  LIVE[g.id] = { ...(c || {}), loading: job };
  try {
    return await job;
  } finally {
    if (LIVE[g.id]?.loading === job) delete LIVE[g.id].loading;
  }
}
export const liveLoaded = (g) => !!LIVE[g?.id]?.at;

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}

/** Live factors for a game from whatever has loaded so far. */
export function liveOf(g) {
  const sp = g.sport || "cfb";
  const L = LIVE[g.id];
  return liveFactors(g, { pre: L?.pre || null, wx: L?.wx || null, teams: M[sp]?.data?.teams, sport: sp });
}

/** The model's blended view of a game, or null if it has no opinion yet. */
export function gameView(g) {
  const sp = g?.sport || "cfb";
  const m = M[sp];
  if (!m?.model) return null;
  const lf = liveLoaded(g) ? liveOf(g) : null;
  const v = view(predict(m.model, g.home.id, g.away.id, g.neutral), g.odds, m.weight, lf);
  return v && { ...v, lf };
}

// ───────── explanations ─────────

const half = (x) => Math.round(Math.abs(x) * 2) / 2;
const favText = (g, margin) => (half(margin) < 0.5 ? "a toss-up" : `${(margin >= 0 ? g.home : g.away).short} by ${half(margin)}`);
const ptxt = (p) => `${Math.round(p * 100)}%`;
const sTxt = (g, h) => (h === 0 ? "PK" : h < 0 ? `${g.home.abbr} ${h}` : `${g.away.abbr} ${-h}`);
const legTeam = (g, leg) => (leg.side === "home" ? g.home : leg.side === "away" ? g.away : null);

export function legName(g, leg) {
  const t = legTeam(g, leg);
  const ln = (x) => (x > 0 ? `+${x}` : x === 0 ? "PK" : `${x}`);
  if (leg.market === "ml") return `${t.short} ML`;
  if (leg.market === "spread") return `${t.short} ${ln(leg.line)}`;
  return `${leg.side === "over" ? "Over" : "Under"} ${leg.line} · ${g.away.short} @ ${g.home.short}`;
}

/**
 * Why a leg: each signal with the direction it pushes this pick. tone: "for" | "against" | "info".
 */
export function explain(g, leg) {
  const v = gameView(g);
  if (!v) return null;
  const sp = g.sport || "cfb";
  const e = legEdge(leg, v, leg.odds) || null;
  const p = legProb(leg, v);
  const implied = leg.odds > 1 ? 1 / leg.odds : null;
  const lf = v.lf;
  const t = legTeam(g, leg);
  const sgn = leg.side === "home" ? 1 : leg.side === "away" ? -1 : 0; // + means this pick likes a bigger home margin
  const tot = leg.market === "total" ? (leg.side === "over" ? 1 : -1) : 0;
  const reasons = [];
  const tone = (x, eps = 0.25) => (x > eps ? "for" : x < -eps ? "against" : "info");
  const P = v.parts;
  if (leg.market !== "total") {
    const lean = sgn * (P.model - (P.market ?? P.model));
    reasons.push({ k: "Ratings", tone: P.market == null ? "info" : tone(lean, 1), text: `Team ratings (every result this season, last season as the start) make it ${favText(g, P.model)}${P.market != null ? `; the line says ${favText(g, P.market)}` : ""}.` });
    if (P.espn != null) {
      const pe = lf.espnHome;
      const ps = leg.side === "home" ? pe : 1 - pe;
      const mk = P.market != null ? sgn * (P.espn - P.market) : 0;
      reasons.push({ k: "ESPN", tone: tone(mk, 1), text: `ESPN's matchup predictor gives ${t.short} ${ptxt(ps)}${P.market != null ? ` (${mk > 1 ? "more than" : mk < -1 ? "less than" : "about what"} the line implies)` : ""}.` });
    }
  } else {
    const lean = tot * (P.modelTotal - (v.marketTotal ?? P.modelTotal));
    reasons.push({ k: "Scoring", tone: v.marketTotal == null ? "info" : tone(lean, 1.5), text: `Offense/defense ratings project ${Math.round(P.modelTotal)} points${v.marketTotal != null ? ` vs a total of ${v.marketTotal}` : ""}.` });
  }
  if (lf) {
    for (const it of lf.items) {
      if (it.kind === "injury" && it.pts > 0) {
        const hurtsHome = it.side === "home";
        const push = leg.market === "total" ? -tot : (hurtsHome ? -1 : 1) * sgn;
        reasons.push({ k: "Injury", tone: push > 0 ? "for" : "against", text: `${it.text} (worth about ${half(it.pts) || 0.5} pts).` });
      } else if (it.kind === "injury") {
        reasons.push({ k: "Injury", tone: "info", text: `${it.text}.` });
      } else if (it.kind === "weather") {
        reasons.push({ k: "Weather", tone: leg.market === "total" ? (tot < 0 ? "for" : "against") : "info", text: `${it.text}: takes about ${half(it.pts)} off the total.` });
      } else if (it.kind === "rest") {
        const good = /bye/.test(it.text);
        const forSide = it.side === leg.side;
        reasons.push({ k: "Rest", tone: leg.market === "total" ? "info" : good === forSide ? "for" : "against", text: `${it.text}.` });
      }
    }
    if (!lf.checked.reported && lf.checked.injuries) reasons.push({ k: "Injury", tone: "info", text: sp === "cfb" ? "No injuries on ESPN's report (college teams rarely publish one)." : "No significant injuries listed." });
    if (lf.checked.indoor) reasons.push({ k: "Weather", tone: "info", text: "Indoors: weather doesn't matter." });
    else if (lf.checked.weather && !lf.items.some((i) => i.kind === "weather")) reasons.push({ k: "Weather", tone: "info", text: `Weather looks fine${lf.wx?.wind != null ? ` (${Math.round(lf.wx.wind)} mph wind${lf.wx.temp != null ? `, ${Math.round(lf.wx.temp)}°F` : ""})` : ""}.` });
  }
  // Recent form, for context (the ratings already count it).
  const teams = M[sp]?.data?.teams;
  const form = (tm) => (teams?.[tm.id]?.form || []).slice(0, 3).map((f) => `${f.m > 0 ? "W" : f.m < 0 ? "L" : "T"} ${f.m > 0 ? "+" : ""}${f.m} ${f.h ? "vs" : "at"} ${f.o}`).join(", ");
  if (t && form(t)) reasons.push({ k: "Form", tone: "info", text: `${t.short} last 3: ${form(t)}.` });
  // Where the line has moved since hedgehog first saw it.
  const L = S.lines?.[g.id];
  const lastS = L?.moves?.length ? L.moves[L.moves.length - 1].to?.s : null;
  if (leg.market === "spread" && L?.first?.s != null && lastS != null && lastS !== L.first.s) {
    const toward = (lastS - L.first.s) * -sgn; // home line dropping = money on home
    reasons.push({ k: "Market", tone: toward > 0 ? "for" : "against", text: `Line moved from ${sTxt(g, L.first.s)} to ${sTxt(g, lastS)} since hedgehog first saw it: money is on ${toward > 0 ? t.short : "the other side"}.` });
  }
  const pro = reasons.filter((r) => r.tone === "for"), con = reasons.filter((r) => r.tone === "against");
  const signals = reasons.filter((r) => ["Ratings", "ESPN", "Scoring", "Injury", "Market"].includes(r.k) && r.tone !== "info");
  const agree = signals.filter((r) => r.tone === "for").length;
  const headline = pro.length
    ? `${pro.slice(0, 2).map((r) => ({ Ratings: "ratings like it", ESPN: "ESPN's predictor agrees", Scoring: "ratings see the total off", Injury: "injuries favor it", Weather: "weather favors it", Rest: "rest edge", Market: "sharp money agrees" }[r.k])).filter((x, i, a) => a.indexOf(x) === i).join(", ")}${con.length ? `; ${con.length} thing${con.length > 1 ? "s" : ""} against` : ""}`
    : "No strong signal: this is a price-only lean";
  return { p, implied, edge: e?.edge ?? (p != null && implied ? p - implied : null), ev: e?.ev ?? null, reasons, headline: headline[0].toUpperCase() + headline.slice(1), agree, signals: signals.length, checked: lf?.checked || null, blind: blindSpots(sp, lf) };
}

export function blindSpots(sp, lf) {
  const out = ["motivation and letdown spots", "coaching and scheme changes", "matchup details (e.g. a pass rush vs a weak line)"];
  if (sp === "cfb") out.unshift("college injuries (teams rarely report them)");
  if (!lf?.checked?.weather && !lf?.checked?.indoor) out.push("weather (forecast not loaded)");
  return out;
}

// ───────── parlay picks that rotate ─────────

function seen(sport) {
  const s = load(`${NS}model.seen.${sport}`, null);
  return s && Date.now() - s.at < 20 * 3600e3 ? new Set(s.teams) : new Set();
}
export function markSeen(sport, teamIds) {
  const s = seen(sport);
  teamIds.forEach((t) => s.add(t));
  save(`${NS}model.seen.${sport}`, { at: Date.now(), teams: [...s] });
}
export const clearSeen = (sport) => save(`${NS}model.seen.${sport}`, null);

function options(g, v) {
  const m = markets(g);
  if (!m || !v) return [];
  return Object.values(m).filter(Boolean).map((s) => ({ key: s.key, leg: s, odds: s.odds, e: legEdge(s, v, s.odds), p: legProb(s, v) }));
}

/**
 * Build an n-leg parlay from the board. Reads live factors for the best candidates first,
 * skips teams already suggested (so every new request brings new teams and new reasons),
 * and never picks a leg a live factor vetoes.
 */
export async function suggest(games, n, sport, { onProgress } = {}) {
  await ensureModel(sport);
  if (!M[sport]?.model) throw new Error(M[sport]?.error || "Model unavailable");
  const used = seen(sport);
  const rank = (gs, exclude) => gs
    .filter((g) => !exclude.has(g.home.id) && !exclude.has(g.away.id))
    .map((g) => {
      const v = gameView(g);
      const best = options(g, v).filter((o) => o.e && o.p >= 0.5).sort((a, b) => b.e.ev - a.e.ev)[0];
      return best ? { g, best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.best.e.ev - a.best.e.ev);
  let recycled = false;
  let cands = rank(games, used);
  if (cands.length < n) {
    recycled = used.size > 0;
    clearSeen(sport);
    used.clear();
    cands = rank(games, used);
  }
  // Check live news on the top candidates before trusting them.
  const top = cands.slice(0, Math.max(10, n * 4)).map((c) => c.g);
  let done = 0;
  onProgress?.(0, top.length);
  await pool(top, 3, async (g) => {
    await loadLive(g).catch(() => {});
    onProgress?.(++done, top.length);
  });
  const picks = [];
  const vetoed = [];
  const teams = new Set();
  const ranked = top
    .map((g) => {
      const v = gameView(g);
      return options(g, v)
        .filter((o) => o.e && o.p >= 0.5 && o.e.ev >= 0.01)
        .map((o) => ({ ...o, g, veto: pickVeto(o.leg, g, v.lf) }));
    })
    .flat()
    .sort((a, b) => b.e.ev - a.e.ev);
  for (const o of ranked) {
    if (o.veto) { vetoed.push({ name: legName(o.g, o.leg), why: o.veto }); continue; }
    if (teams.has(o.g.home.id) || teams.has(o.g.away.id)) continue;
    teams.add(o.g.home.id);
    teams.add(o.g.away.id);
    picks.push({ key: o.key, gameId: o.g.id, side: o.leg.side, market: o.leg.market, name: legName(o.g, o.leg), odds: o.odds, why: explain(o.g, o.leg) });
    if (picks.length === n) break;
  }
  markSeen(sport, picks.flatMap((p) => { const g = game(p.gameId); return [g.home.id, g.away.id]; }));
  const pr = picks.reduce((a, p) => a * (p.why?.p ?? 0), 1);
  const dec = picks.reduce((a, p) => a * p.odds, 1);
  return { n, sport, legs: picks, p: picks.length ? pr : null, odds: dec, ev: picks.length ? pr * dec - 1 : null, recycled, vetoed: vetoed.filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i).slice(0, 4), checked: top.length, at: Date.now() };
}
