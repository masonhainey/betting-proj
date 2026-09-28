// What the ratings can't see, read fresh before every pick: injuries (the quarterback above
// all), ESPN's matchup predictor, the weather at kickoff and rest. Pure — unit-tested.
//
// Adjustments are in points on the model's side of the blend (home margin, game total).
// Sportsbooks move on the same news, so the main job here is keeping the model from
// calling a team "value" when its line is short because its starter is hurt.

const DAY = 864e5;

// How likely each listed player is to miss the game.
const STATUS = [
  [/^(out|o|injured reserve|ir|physically unable|pup|suspen|inactive|non-football)/i, 1],
  [/^doubt/i, 0.8],
  [/^quest|^q$/i, 0.3],
  [/^day/i, 0.2],
  [/^prob/i, 0.05],
];
export function missChance(status) {
  const s = String(status || "").trim();
  for (const [re, w] of STATUS) if (re.test(s)) return w;
  return 0;
}

// Points a starter is worth (spread), by position group, and what his absence does to the total.
export const VALUE = {
  nfl: { QB: 5.5, QB2: 1.2, KEY: 1.0, K: 0.5, OL: 0.35, DEF: 0.35, SKILL: 0.3, OTHER: 0.15, cap: 3, qbTotal: 2, keyTotal: 0.6 },
  cfb: { QB: 6.5, QB2: 1.5, KEY: 1.2, K: 0.5, OL: 0.35, DEF: 0.35, SKILL: 0.3, OTHER: 0.15, cap: 3, qbTotal: 2.5, keyTotal: 0.8 },
};
const GROUP = (pos) => {
  const p = String(pos || "").toUpperCase();
  if (p === "QB") return "QB";
  if (p === "PK" || p === "K") return "K";
  if (/^(OT|T|G|OG|C|OL|LT|RT|LG|RG)$/.test(p)) return "OL";
  if (/^(DE|DT|NT|DL|EDGE|LB|ILB|OLB|MLB|CB|S|FS|SS|DB)$/.test(p)) return "DEF";
  if (/^(WR|TE|RB|FB)$/.test(p)) return "SKILL";
  return "OTHER";
};

const str = (v) => (v == null ? "" : String(v));
const pctNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : null;
};

/** The pregame parts of ESPN's game summary: injury report, matchup predictor, team leaders, weather. */
export function parsePregame(s) {
  const injuries = {};
  for (const t of Array.isArray(s?.injuries) ? s.injuries : []) {
    const id = str(t?.team?.id);
    if (!id) continue;
    injuries[id] = (Array.isArray(t.injuries) ? t.injuries : [])
      .map((i) => ({
        id: str(i?.athlete?.id),
        name: str(i?.athlete?.displayName || i?.athlete?.shortName),
        short: str(i?.athlete?.shortName || i?.athlete?.displayName),
        pos: str(i?.athlete?.position?.abbreviation),
        status: str(i?.status || i?.type?.description),
        detail: str(i?.details?.type || i?.details?.detail || ""),
        date: str(i?.date || ""),
      }))
      .filter((i) => i.name);
  }
  const leaders = {};
  for (const t of Array.isArray(s?.leaders) ? s.leaders : []) {
    const id = str(t?.team?.id);
    if (!id) continue;
    const pick = (re) => {
      const cat = (t.leaders || []).find((c) => re.test(str(c?.name)));
      const a = cat?.leaders?.[0]?.athlete;
      return a ? { id: str(a.id), name: str(a.displayName || a.shortName) } : null;
    };
    leaders[id] = { pass: pick(/^passing/i), rush: pick(/^rushing/i), rec: pick(/^receiving/i) };
  }
  const pr = s?.predictor;
  const ph = pctNum(pr?.homeTeam?.gameProjection);
  const pa = pctNum(pr?.awayTeam?.gameProjection);
  const predictor = ph != null ? { home: ph, homeId: str(pr.homeTeam.id) } : pa != null ? { home: 1 - pa, homeId: "" } : null;
  const w = s?.gameInfo?.weather;
  const weather = w ? { temp: Number(w.temperature ?? w.highTemperature) || null, text: str(w.displayValue || w.conditionId) } : null;
  return { injuries, leaders, predictor, weather, reported: Array.isArray(s?.injuries) };
}

const sameName = (a, b) => !!a && !!b && a.toLowerCase().replace(/[^a-z]/g, "") === b.toLowerCase().replace(/[^a-z]/g, "");
const isLeader = (p, l) => !!l && ((p.id && p.id === l.id) || sameName(p.name, l.name));

/**
 * One team's injury cost in points. Long-term absences count less: the ratings have already
 * watched the team play without them.
 */
export function injuryCost(list, leaders, sport = "cfb", now = Date.now()) {
  const V = VALUE[sport] || VALUE.cfb;
  const items = [];
  let pts = 0, other = 0, total = 0;
  let qb = null;
  for (const p of list || []) {
    const miss = missChance(p.status);
    if (miss < 0.25) continue;
    const age = p.date ? (now - Date.parse(p.date)) / DAY : 0;
    const stale = Number.isFinite(age) && age > 14 ? 0.35 : 1;
    const g = GROUP(p.pos);
    let v, tot = 0, role = "";
    if (g === "QB") {
      const starter = isLeader(p, leaders?.pass);
      v = starter ? V.QB : V.QB2;
      tot = starter ? V.qbTotal : 0;
      role = starter ? "starting QB" : "QB";
      if (starter || !qb) qb = { name: p.name, status: p.status, miss, starter };
    } else if (isLeader(p, leaders?.rush) || isLeader(p, leaders?.rec)) {
      v = V.KEY;
      tot = V.keyTotal;
      role = isLeader(p, leaders?.rush) ? "leading rusher" : "leading receiver";
    } else {
      v = V[g] ?? V.OTHER;
      role = p.pos || "";
    }
    const cost = v * miss * stale;
    if (g === "QB" || role.startsWith("leading")) pts += cost;
    else other += cost;
    total += tot * miss * stale;
    if (cost >= 0.3) items.push({ name: p.name, pos: p.pos, status: p.status, role, pts: cost, stale: stale < 1, detail: p.detail });
  }
  pts += Math.min(V.cap, other);
  items.sort((a, b) => b.pts - a.pts);
  return { pts, total, items, qb, depth: other };
}

/** Total points the weather takes off a game (negative), with the reasons. */
export function weatherEffect(wx) {
  if (!wx || wx.indoor) return { total: 0, items: [], wind: 0 };
  const items = [];
  let total = 0;
  const wind = Number(wx.wind) || 0;
  if (wind >= 12) {
    const d = -Math.min(6, (wind - 10) * 0.3);
    total += d;
    items.push({ text: `${Math.round(wind)} mph wind${wx.gust >= wind + 8 ? `, gusts to ${Math.round(wx.gust)}` : ""}`, pts: d });
  }
  const wet = (wx.pop ?? 0) >= 55 && (wx.precip ?? 0) >= 0.8;
  if (wet) {
    const snow = (wx.temp ?? 60) <= 33;
    const d = snow ? -3 : -1.5;
    total += d;
    items.push({ text: `${snow ? "Snow" : "Rain"} likely (${Math.round(wx.pop)}%)`, pts: d });
  }
  if (Number.isFinite(wx.temp) && wx.temp <= 20) {
    total -= 1;
    items.push({ text: `${Math.round(wx.temp)}°F at kickoff`, pts: -1 });
  }
  return { total, items, wind };
}

/** Rest edge in points for the home side (bye weeks and short weeks). */
export function restEffect(sport, daysHome, daysAway) {
  const f = (d) => {
    if (!Number.isFinite(d) || d > 40) return null;
    if (sport === "nfl") return d >= 12 ? 1 : d <= 5 ? -1 : 0;
    return d >= 13 ? 0.7 : d <= 5 ? -0.7 : 0;
  };
  const h = f(daysHome), a = f(daysAway);
  if (h == null || a == null) return { margin: 0, home: daysHome, away: daysAway };
  return { margin: h - a, home: daysHome, away: daysAway };
}

const restWord = (d, sport) => (d >= (sport === "nfl" ? 12 : 13) ? "off a bye" : d <= 5 ? `on a short week (${Math.round(d)} days)` : "");

/**
 * Everything live for one game. g: a board game; pre: parsePregame() output or null;
 * wx: weather at kickoff or null; teams: the model file's team info (last game, form).
 */
export function liveFactors(g, { pre = null, wx = null, teams = null, sport = "cfb", now = Date.now() } = {}) {
  const H = g.home, A = g.away;
  const items = [];
  let margin = 0, total = 0;
  const side = (t) => (t.id === H.id ? "home" : "away");
  const flags = { home: {}, away: {}, wind: 0 };
  // Injuries
  if (pre) {
    for (const t of [H, A]) {
      const c = injuryCost(pre.injuries?.[t.id], pre.leaders?.[t.id], sport, now);
      const sgn = t === H ? -1 : 1;
      margin += sgn * c.pts;
      total -= c.total;
      if (c.qb && c.qb.miss >= 0.25) flags[side(t)].qb = { name: c.qb.name, status: c.qb.status, starter: c.qb.starter, miss: c.qb.miss };
      for (const it of c.items.slice(0, 3)) {
        items.push({ kind: "injury", team: t.id, side: side(t), pts: it.pts, text: `${t.short}: ${it.name}${it.role ? ` (${it.role})` : ""} ${it.status.toLowerCase()}${it.stale ? ", out a while" : ""}` });
      }
      if (c.depth >= 1 && c.items.length > 3) items.push({ kind: "injury", team: t.id, side: side(t), pts: 0, text: `${t.short}: ${c.items.length - 3} more starters listed` });
    }
  }
  // Weather
  const w = weatherEffect(wx);
  total += w.total;
  flags.wind = w.wind;
  for (const it of w.items) items.push({ kind: "weather", pts: it.pts, text: it.text, total: true });
  // Rest
  const last = (id) => (teams?.[id]?.last ? (Date.parse(g.date) - Date.parse(teams[id].last)) / DAY : NaN);
  const r = restEffect(sport, last(H.id), last(A.id));
  if (r.margin) {
    margin += r.margin;
    for (const [t, d] of [[H, r.home], [A, r.away]]) {
      const wd = restWord(d, sport);
      if (wd) items.push({ kind: "rest", side: side(t), team: t.id, pts: Math.abs(r.margin) / 2, text: `${t.short} ${wd}` });
    }
  }
  const espnHome = pre?.predictor?.home ?? null;
  return {
    margin,
    total,
    espnHome: espnHome != null && espnHome > 0 && espnHome < 1 ? espnHome : null,
    items,
    flags,
    checked: { injuries: !!pre, reported: !!pre?.reported && Object.values(pre?.injuries || {}).some((l) => l.length), weather: !!wx, indoor: !!wx?.indoor },
    wx,
  };
}

/**
 * Hard stops for auto-picks: never hand out a leg on a team whose starting QB probably
 * sits, a game where his status is a coin flip, or an over into a gale.
 */
export function pickVeto(leg, g, lf) {
  if (!lf) return null;
  const f = lf.flags || {};
  for (const s of ["home", "away"]) {
    const q = f[s]?.qb;
    if (!q?.starter) continue;
    const team = s === "home" ? g.home : g.away;
    if (q.miss >= 0.8 && leg.side === s && leg.market !== "total") return `${team.short}'s starting QB is ${q.status.toLowerCase()}`;
    if (q.miss >= 0.25 && q.miss < 0.8) return `${team.short}'s starting QB is ${q.status.toLowerCase()}: too uncertain`;
  }
  if (leg.market === "total" && leg.side === "over" && (f.wind || 0) >= 18) return `${Math.round(f.wind)} mph wind`;
  return null;
}
