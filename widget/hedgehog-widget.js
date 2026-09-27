// hedgehog-widget: generated from widget/src by npm run build:widget. Do not edit.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// widget/src/core.js
var core_exports = {};
__export(core_exports, {
  buildModel: () => buildModel,
  daysToFetch: () => daysToFetch,
  draw: () => draw,
  run: () => run
});
module.exports = __toCommonJS(core_exports);

// js/config.js
var SUPABASE_URL = "https://vcmgdhmhizyqjnyjxmcl.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_uKY0eEvFEDrBlD_jpOzEPA_MAb1PSLw";

// js/props.js
var STATS = {
  pass_yds: { label: "Passing yards", short: "pass yds", v: (s) => s.passYds },
  pass_tds: { label: "Passing TDs", short: "pass TD", v: (s) => s.passTD },
  completions: { label: "Completions", short: "comp", v: (s) => s.cmp },
  pass_att: { label: "Pass attempts", short: "att", v: (s) => s.att },
  ints: { label: "Interceptions thrown", short: "INT", v: (s) => s.int },
  rush_yds: { label: "Rushing yards", short: "rush yds", v: (s) => s.rushYds },
  rush_att: { label: "Rushing attempts", short: "carries", v: (s) => s.rushAtt },
  rush_tds: { label: "Rushing TDs", short: "rush TD", v: (s) => s.rushTD },
  receptions: { label: "Receptions", short: "rec", v: (s) => s.rec },
  rec_yds: { label: "Receiving yards", short: "rec yds", v: (s) => s.recYds },
  rec_tds: { label: "Receiving TDs", short: "rec TD", v: (s) => s.recTD },
  rush_rec_yds: { label: "Rush + rec yards", short: "rush+rec yds", v: (s) => s.rushYds + s.recYds },
  pass_rush_yds: { label: "Pass + rush yards", short: "pass+rush yds", v: (s) => s.passYds + s.rushYds },
  anytime_td: { label: "Anytime TD", short: "TD", v: (s) => s.rushTD + s.recTD }
};
var norm = (s) => String(s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
function findPlayer(name, players) {
  const want = norm(name);
  if (!want || !players?.length) return null;
  const exact = players.find((p) => norm(p.name) === want);
  if (exact) return exact;
  const parts = want.split(" ");
  const last = parts[parts.length - 1];
  const first = parts.length > 1 ? parts[0] : "";
  const byLast = players.filter((p) => norm(p.name).split(" ").pop() === last);
  if (first) {
    const init = byLast.filter((p) => norm(p.name).startsWith(first[0]));
    if (init.length === 1) return init[0];
    const short = players.find((p) => norm(p.short) === want);
    if (short) return short;
  }
  return byLast.length === 1 ? byLast[0] : null;
}
function played(game) {
  if (game?.state !== "in" || !game.period) return 0;
  if (game.period > 4) return 1;
  const [m, s] = String(game.clock || "").split(":").map(Number);
  const left = Number.isFinite(m) ? m + (s || 0) / 60 : 15;
  return Math.min(1, ((game.period - 1) * 15 + (15 - left)) / 60);
}
function propMargin(leg, game) {
  const p = leg.prop;
  const box = game?.box;
  if (!p || !box || !STATS[p.stat]) return null;
  const pl = findPlayer(p.player, box.players);
  if (!pl) return null;
  const value = STATS[p.stat].v(pl.stats);
  const margin = p.side === "under" ? p.line - value : value - p.line;
  const unit = STATS[p.stat].short;
  let text2 = p.side === "yes" ? value > 0 ? `Scored${value > 1 ? ` \xD7${value}` : ""}` : "No TD yet" : `${value} / ${p.line} ${unit}`;
  const f = played(game);
  if (p.side !== "yes" && f > 0.12 && f < 1 && game.state === "in") text2 += ` \xB7 on pace for ${Math.round(value / f)}`;
  return { margin, text: text2, value, player: pl.name };
}

// js/espn.js
var ROOT = "https://site.api.espn.com/apis/site/v2/sports/football";
var SPORTS = {
  cfb: { key: "cfb", path: "college-football", groups: "80", label: "CFB", name: "College football", games: "FBS games", ranked: true, logos: "ncaa" },
  nfl: { key: "nfl", path: "nfl", groups: null, label: "NFL", name: "NFL", games: "NFL games", ranked: false, logos: "nfl" }
};
var sportOf = (k) => SPORTS[k] || SPORTS.cfb;
var etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)).replaceAll("-", "");
function scoreboardUrl(dates, sport = "cfb") {
  const sp = sportOf(sport);
  return `${ROOT}/${sp.path}/scoreboard?dates=${dates}${sp.groups ? `&groups=${sp.groups}` : ""}&limit=500`;
}
var num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^(ev|even)$/i.test(v.trim())) return 100;
  const n = Number(String(v).replace(/^[ou]/i, ""));
  return Number.isFinite(n) ? n : null;
};
function team(c, sport = "cfb") {
  if (!c) return null;
  const t = c.team || {};
  const rank = c.curatedRank?.current;
  return {
    id: String(t.id ?? ""),
    abbr: t.abbreviation || (t.shortDisplayName || "").slice(0, 4).toUpperCase(),
    name: t.displayName || t.name || "TBD",
    short: t.shortDisplayName || t.location || t.name || "TBD",
    logo: t.logo || t.logos?.[0]?.href || "",
    color: t.color ? `#${t.color}` : "",
    alt: t.alternateColor ? `#${t.alternateColor}` : "",
    score: c.score != null && c.score !== "" ? Number(c.score) : null,
    rank: rank && rank <= 25 ? rank : null,
    record: c.records?.find((r) => r.type === "total")?.summary || c.records?.[0]?.summary || "",
    winner: !!c.winner,
    league: sport
  };
}
function normalizeOdds(o, home, away) {
  if (!o) return null;
  const out = { provider: o.provider?.name || "Sportsbook", details: o.details || "" };
  const mlH = num(o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.open?.odds ?? o.homeTeamOdds?.moneyLine);
  const mlA = num(o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.open?.odds ?? o.awayTeamOdds?.moneyLine);
  if (mlH || mlA) out.ml = { home: mlH, away: mlA };
  let hl = num(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.open?.line);
  if (hl == null && o.spread != null) hl = num(o.spread);
  if (hl == null && o.details && home && away) {
    const m = o.details.match(/^(\S+)\s+([+-]?\d+(\.\d+)?)$/);
    if (m) hl = m[1] === home.abbr ? Number(m[2]) : m[1] === away.abbr ? -Number(m[2]) : null;
  }
  if (hl != null) {
    out.spread = {
      home: { line: hl, price: num(o.pointSpread?.home?.close?.odds ?? o.homeTeamOdds?.spreadOdds) ?? -110 },
      away: { line: -hl, price: num(o.pointSpread?.away?.close?.odds ?? o.awayTeamOdds?.spreadOdds) ?? -110 }
    };
  }
  const tl = num(o.total?.over?.close?.line ?? o.total?.over?.open?.line ?? o.overUnder);
  if (tl != null) {
    out.total = {
      line: tl,
      over: num(o.total?.over?.close?.odds ?? o.overOdds) ?? -110,
      under: num(o.total?.under?.close?.odds ?? o.underOdds) ?? -110
    };
  }
  return out.ml || out.spread || out.total ? out : null;
}
var etClock = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
function kickoff(iso, timeValid) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return { date: iso, timeValid: timeValid !== false };
  const tbd = timeValid === false || etClock(iso) === "00:00";
  if (!tbd) return { date: iso, timeValid: true };
  const d = etDay(iso);
  return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T17:00:00Z`, timeValid: false };
}
function normalizeEvent(ev, sport = "cfb") {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const home = team(comp.competitors?.find((c) => c.homeAway === "home"), sport);
  const away = team(comp.competitors?.find((c) => c.homeAway === "away"), sport);
  if (!home || !away) return null;
  const st = comp.status || ev.status || {};
  const type = st.type || {};
  const sit = comp.situation;
  const { date, timeValid } = kickoff(comp.date || ev.date, comp.timeValid);
  return {
    id: String(ev.id),
    sport,
    date,
    timeValid,
    name: ev.name,
    shortName: ev.shortName || `${away.abbr} @ ${home.abbr}`,
    week: ev.week?.number ?? null,
    state: type.state || "pre",
    // pre | in | post
    completed: !!type.completed,
    detail: type.detail || "",
    shortDetail: type.shortDetail || "",
    clock: st.displayClock || "",
    period: st.period || 0,
    venue: comp.venue?.fullName || "",
    city: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(", "),
    neutral: !!comp.neutralSite,
    tv: (comp.broadcasts || []).flatMap((b) => b.names || []).join(" / ") || comp.broadcast || "",
    notes: comp.notes?.[0]?.headline || "",
    home,
    away,
    situation: sit ? {
      possession: sit.possession ? String(sit.possession) : null,
      downDistance: sit.shortDownDistanceText || sit.downDistanceText || "",
      redZone: !!sit.isRedZone,
      lastPlay: sit.lastPlay?.text || "",
      // For the field graphic: where the ball is and what's needed.
      spotText: sit.possessionText || (/ at (.+)$/.exec(sit.downDistanceText || "")?.[1] ?? ""),
      down: num(sit.down),
      distance: num(sit.distance),
      toEndzone: num(sit.yardsToEndzone),
      lastPlayType: sit.lastPlay?.type?.text || "",
      lastPlayTeam: sit.lastPlay?.team?.id ? String(sit.lastPlay.team.id) : null,
      homeTimeouts: num(sit.homeTimeouts),
      awayTimeouts: num(sit.awayTimeouts)
    } : null,
    odds: normalizeOdds(comp.odds?.[0], home, away)
  };
}

// js/odds.js
function decimalToAmerican(d) {
  if (!(d > 1)) return NaN;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function formatOdds(d, fmt2 = "american") {
  if (!(d > 1)) return "\u2014";
  if (fmt2 === "decimal") return trimDec(d);
  const a = decimalToAmerican(d);
  return a > 0 ? `+${a}` : `${a}`;
}
function trimDec(d) {
  const s = (Math.round(d * 100) / 100).toFixed(2);
  return s.endsWith("0") ? s.slice(0, -1) : s;
}
var parlayDecimal = (decimals) => decimals.reduce((acc, d) => acc * d, 1);
function fmtMoney(n, { sign = false, cents = true } = {}) {
  if (!Number.isFinite(n)) return "\u2014";
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0
  });
  if (n < 0) return `-$${body}`;
  return `${sign && n > 0 ? "+" : ""}$${body}`;
}

// js/grade.js
function legDecimal(leg) {
  return leg.status === "push" || leg.status === "void" ? 1 : leg.odds;
}
var ticketOdds = (bet) => bet.ticketPayout > 0 && bet.stake > 0 ? bet.ticketPayout / bet.stake : null;
function betDecimal(bet) {
  const live = bet.legs.filter((l) => l.status !== "push" && l.status !== "void");
  const full = live.length === bet.legs.length;
  if (full && ticketOdds(bet)) return ticketOdds(bet);
  let d;
  if (bet.oddsOverride > 1 && full) d = bet.oddsOverride;
  else d = parlayDecimal(bet.legs.map(legDecimal));
  if (bet.boostPct > 0 && d > 1) d = 1 + (d - 1) * (1 + bet.boostPct / 100);
  return d;
}
function ticketDecimal(bet) {
  if (ticketOdds(bet)) return ticketOdds(bet);
  return computedDecimal(bet);
}
function computedDecimal(bet) {
  let d = bet.oddsOverride > 1 ? bet.oddsOverride : parlayDecimal(bet.legs.map((l) => l.odds));
  if (bet.boostPct > 0 && d > 1) d = 1 + (d - 1) * (1 + bet.boostPct / 100);
  return d;
}
function betStatus(bet) {
  if (bet.cashout != null) return "cashout";
  const s = bet.legs.map((l) => l.status);
  if (s.includes("lost")) return "lost";
  if (s.includes("open")) return "open";
  if (s.every((x) => x === "void")) return "void";
  if (s.every((x) => x === "push" || x === "void")) return "push";
  return "won";
}
function betProfit(bet) {
  const st = betStatus(bet);
  if (st === "open") return null;
  if (st === "cashout") return bet.cashout - bet.stake;
  if (st === "lost") return -bet.stake;
  if (st === "push" || st === "void") return 0;
  return bet.stake * (betDecimal(bet) - 1);
}
var potentialPayout = (bet) => bet.stake * ticketDecimal(bet);
function legLabel(leg, game) {
  if (!game || !leg.market || leg.market === "prop" || leg.market === "other") return leg.pick;
  const team2 = leg.side === "home" ? game.home : leg.side === "away" ? game.away : null;
  if (leg.market === "ml") return `${team2.short} ML`;
  if (leg.market === "spread") return `${team2.short} ${leg.line > 0 ? "+" : ""}${leg.line === 0 ? "PK" : leg.line}`;
  if (leg.market === "total") return `${leg.side === "over" ? "Over" : "Under"} ${leg.line}`;
  return leg.pick;
}
function scores(game) {
  const h = Number(game.home.score), a = Number(game.away.score);
  return Number.isFinite(h) && Number.isFinite(a) ? { h, a } : null;
}
function legMargin(leg, game) {
  if (leg.market === "prop") return propMargin(leg, game);
  if (!game || !leg.market || !["ml", "spread", "total"].includes(leg.market)) return null;
  const sc = scores(game);
  if (!sc) return null;
  if (leg.market === "total") {
    const sum = sc.h + sc.a;
    const m2 = leg.side === "over" ? sum - leg.line : leg.line - sum;
    return { margin: m2, text: totalText(leg, sum, m2) };
  }
  const mine = leg.side === "home" ? sc.h : sc.a;
  const theirs = leg.side === "home" ? sc.a : sc.h;
  const line = leg.market === "spread" ? Number(leg.line) || 0 : 0;
  const m = mine - theirs + line;
  let text2;
  if (leg.market === "ml") text2 = m > 0 ? `Up ${m}` : m < 0 ? `Down ${-m}` : "Tied";
  else text2 = m > 0 ? `Covering by ${m}` : m < 0 ? `Need ${-m} to cover` : "On the number";
  return { margin: m, text: text2 };
}
function totalText(leg, sum, m) {
  if (leg.side === "over") return m > 0 ? `Over by ${m} \xB7 ${sum} pts` : `Need ${-m + (Number.isInteger(leg.line) ? 1 : 0.5)} more \xB7 ${sum} pts`;
  return m > 0 ? `${m} pts of room \xB7 ${sum} pts` : m < 0 ? `Over by ${-m} \xB7 ${sum} pts` : `On the number \xB7 ${sum} pts`;
}
function gradeLeg(leg, game) {
  if (!game || game.state !== "post" || !game.completed) return null;
  if (leg.market === "prop" && !game.box?.final) return null;
  const r = legMargin(leg, game);
  if (!r) return null;
  return r.margin > 0 ? "won" : r.margin < 0 ? "lost" : "push";
}
function legLive(leg, game) {
  if (leg.status !== "open") return { state: leg.status, text: "" };
  if (!game) return { state: "pending", text: "" };
  if (game.state === "pre") return { state: "pending", text: "" };
  const r = legMargin(leg, game);
  if (!r) return { state: game.state === "in" ? "live" : "pending", text: leg.market === "prop" && game.box && !r ? "Player not in the box score yet" : "" };
  if (leg.market === "prop" && game.state === "in" && r.margin <= 0 && leg.prop?.side !== "under") return { state: "live", text: r.text };
  return { state: r.margin > 0 ? "winning" : r.margin < 0 ? "losing" : "even", text: r.text };
}

// widget/src/model.js
var MIN = 6e4;
var LOOKBACK_DAYS = 2;
var LOOKAHEAD_DAYS = 8;
var inPlay = (bets) => bets.filter((b) => !b.ghost && Array.isArray(b.legs) && b.legs.length);
function daysToFetch(bets, now = /* @__PURE__ */ new Date()) {
  const t = now.getTime();
  const days = /* @__PURE__ */ new Set();
  const leagues = /* @__PURE__ */ new Set();
  for (const b of inPlay(bets)) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      const k = Date.parse(l.kickoff);
      if (l.status !== "open" || !l.gameId || !Number.isFinite(k)) continue;
      const sp = l.sport === "nfl" ? "nfl" : "cfb";
      leagues.add(sp);
      if (k >= t - LOOKBACK_DAYS * 864e5 && k <= t + LOOKAHEAD_DAYS * 864e5) days.add(`${sp}|${etDay(k)}`);
    }
  }
  if (!leagues.size) leagues.add("cfb");
  for (const sp of leagues) days.add(`${sp}|${etDay(t)}`);
  return [...days].sort((a, b) => a.slice(-8).localeCompare(b.slice(-8)) || a.localeCompare(b)).slice(0, 8);
}
function kickText(date, now = /* @__PURE__ */ new Date()) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = (d - now) / 864e5;
  if (days > 0 && days < 6) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${time}`;
}
function clockText(g) {
  if (!g) return "";
  if (g.state !== "in") return g.shortDetail || "";
  if (/half/i.test(g.shortDetail || "")) return "Half";
  if (/end/i.test(g.shortDetail || "")) return g.shortDetail;
  const q = g.period > 4 ? g.period === 5 ? "OT" : `${g.period - 4}OT` : g.period ? `Q${g.period}` : "";
  return [q, g.period > 4 ? "" : g.clock].filter(Boolean).join(" ") || g.shortDetail || "Live";
}
var RANK = { losing: 0, even: 1, live: 2, winning: 3, pending: 4 };
function graded(bet, game) {
  const clone = { ...bet, legs: bet.legs.map((l) => ({ ...l })) };
  let last = 0;
  for (const l of clone.legs) {
    if (l.status !== "open" || !l.gameId || bet.cashout != null) continue;
    const g = game(l.gameId);
    const grade = gradeLeg(l, g);
    if (grade) {
      l.status = grade;
      last = Math.max(last, Date.parse(g.date) || 0);
    }
  }
  if (!clone.settledAt && betStatus(clone) !== "open" && last) clone.settledAt = new Date(last).toISOString();
  return clone;
}
function row(bet, game, now) {
  const legs = bet.legs.map((l) => ({ l, g: l.gameId ? game(l.gameId) : null }));
  const views = legs.map(({ l, g }) => ({ l, g, v: legLive(l, g) }));
  const open = views.filter((x) => x.l.status === "open");
  const done = views.length - open.length;
  const worst = [...open].sort((a, b) => RANK[a.v.state] - RANK[b.v.state])[0];
  const state = !worst ? "pending" : worst.v.state;
  const live = open.some((x) => x.g?.state === "in");
  const kicks = open.map((x) => Date.parse(x.g?.date || x.l.kickoff)).filter((k) => Number.isFinite(k) && k > now.getTime());
  const nextKick = kicks.length ? Math.min(...kicks) : null;
  const parlay = bet.legs.length > 1;
  const title = parlay ? `${bet.legs.length}-leg parlay` : legLabel(bet.legs[0], legs[0].g);
  const about = (x) => {
    if (!x) return "";
    if (x.g?.state === "in") return [clockText(x.g), x.v.text].filter(Boolean).join(" \xB7 ");
    if (x.g?.state === "post") return x.g.shortDetail || "Final";
    const when = kickText(x.g?.date || x.l.kickoff, now);
    const who = x.g?.shortName || x.l.gameLabel || "";
    return [who, when].filter(Boolean).join(" \xB7 ");
  };
  let sub;
  if (!parlay) sub = about(worst || views[0]);
  else {
    const focus = open.find((x) => x.v.state === "losing") || open.find((x) => x.g?.state === "in") || [...open].sort((a, b) => (Date.parse(a.g?.date || a.l.kickoff) || Infinity) - (Date.parse(b.g?.date || b.l.kickoff) || Infinity))[0];
    const lead = `${done}/${bet.legs.length} in`;
    sub = focus ? `${lead} \xB7 ${legLabel(focus.l, focus.g)} ${about(focus)}`.trim() : lead;
  }
  return {
    id: bet.id,
    title,
    sub,
    state,
    live,
    nextKick,
    pays: fmtMoney(potentialPayout(bet), { cents: potentialPayout(bet) < 1e3 }),
    odds: formatOdds(ticketDecimal(bet)),
    legs: views.map(({ l, g, v }) => ({ label: legLabel(l, g), state: l.status === "open" ? v.state : l.status }))
  };
}
function buildModel(bets, games, now = /* @__PURE__ */ new Date()) {
  const game = (id) => (games instanceof Map ? games.get(String(id)) : games[String(id)]) || null;
  const today = etDay(now);
  const all = inPlay(bets).map((b) => graded(b, game));
  const open = all.filter((b) => betStatus(b) === "open");
  const settledToday = all.filter((b) => betStatus(b) !== "open" && b.settledAt && etDay(b.settledAt) === today);
  const rows = open.map((b) => row(b, game, now)).sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.live) return RANK[a.state] - RANK[b.state];
    return (a.nextKick ?? Infinity) - (b.nextKick ?? Infinity);
  });
  const profit = settledToday.reduce((s, b) => s + betProfit(b), 0);
  const w = settledToday.filter((b) => betProfit(b) > 0).length;
  const l = settledToday.filter((b) => betProfit(b) < 0).length;
  const count = (st) => rows.filter((r) => r.live && r.state === st).length;
  const live = rows.filter((r) => r.live).length;
  const kicks = rows.map((r) => r.nextKick).filter(Boolean);
  const nextKick = kicks.length ? Math.min(...kicks) : null;
  const t = now.getTime();
  const refreshAt = live ? t + 5 * MIN : Math.max(t + 5 * MIN, Math.min(nextKick ?? Infinity, t + 60 * MIN));
  return {
    rows,
    open: rows.length,
    live,
    winning: count("winning"),
    losing: count("losing"),
    atRisk: open.reduce((s, b) => s + (b.stake || 0), 0),
    toWin: open.reduce((s, b) => s + potentialPayout(b), 0),
    today: { profit, w, l, settled: settledToday.length, text: settledToday.length ? fmtMoney(profit, { sign: true }) : "" },
    nextKick,
    nextKickText: nextKick ? kickText(nextKick, now) : "",
    refreshAt,
    updated: t
  };
}

// widget/src/core.js
var KEY = { email: "hedgehog.email", password: "hedgehog.password", session: "hedgehog.session" };
var C = {
  bg1: "#1a1330",
  bg2: "#09080c",
  text: "#f3f1f8",
  muted: "#9b96aa",
  faint: "#66617a",
  accent: "#a78bfa",
  win: "#3ddc97",
  red: "#ff5d73",
  amber: "#ffb547"
};
var STATE_COLOR = { winning: C.win, losing: C.red, even: C.amber, live: C.accent, pending: C.faint, won: C.win, lost: C.red, push: C.amber, void: C.faint };
var STATE_WORD = { winning: "Winning", losing: "Losing", even: "Even", live: "Live", pending: "Upcoming" };
async function http(url, { method = "GET", headers = {}, body } = {}) {
  const req = new Request(url);
  req.method = method;
  req.headers = headers;
  req.timeoutInterval = 12;
  if (body !== void 0) req.body = JSON.stringify(body);
  let data;
  try {
    data = await req.loadJSON();
  } catch {
    data = null;
  }
  const status = req.response?.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    const msg = data?.error_description || data?.msg || data?.message || `HTTP ${status}`;
    const e = new Error(msg);
    e.status = status;
    throw e;
  }
  return data;
}
var authHeaders = { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };
async function token(grant, body) {
  const s = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: authHeaders, body });
  const session = { access: s.access_token, refresh: s.refresh_token, expires: Date.now() + (s.expires_in || 3600) * 1e3 };
  Keychain.set(KEY.session, JSON.stringify(session));
  return session;
}
async function accessToken() {
  let s = null;
  try {
    s = Keychain.contains(KEY.session) ? JSON.parse(Keychain.get(KEY.session)) : null;
  } catch {
  }
  if (s?.access && s.expires > Date.now() + 12e4) return s.access;
  if (s?.refresh) {
    try {
      return (await token("refresh_token", { refresh_token: s.refresh })).access;
    } catch {
    }
  }
  if (!Keychain.contains(KEY.email) || !Keychain.contains(KEY.password)) return null;
  try {
    return (await token("password", { email: Keychain.get(KEY.email), password: Keychain.get(KEY.password) })).access;
  } catch (e) {
    if (e.status === 400) return null;
    throw e;
  }
}
async function loadBets(access) {
  const rows = await http(`${SUPABASE_URL}/rest/v1/records?select=id,data&kind=eq.bet&deleted=eq.false`, {
    headers: { ...authHeaders, Authorization: `Bearer ${access}` }
  });
  return rows.map((r) => ({ ...r.data, id: r.id }));
}
async function loadGames(days) {
  const games = /* @__PURE__ */ new Map();
  await Promise.all(
    days.map(async (key) => {
      const [sport, d] = key.split("|");
      try {
        const data = await http(scoreboardUrl(d, sport));
        for (const ev of data?.events || []) {
          const g = normalizeEvent(ev, sport);
          if (g) games.set(g.id, g);
        }
      } catch {
      }
    })
  );
  return games;
}
var fm = () => FileManager.local();
var cachePath = () => fm().joinPath(fm().cacheDirectory(), "hedgehog-widget.json");
function saveCache(data) {
  try {
    fm().writeString(cachePath(), JSON.stringify(data));
  } catch {
  }
}
function readCache() {
  try {
    return fm().fileExists(cachePath()) ? JSON.parse(fm().readString(cachePath())) : null;
  } catch {
    return null;
  }
}
var col = (hex, a = 1) => new Color(hex, a);
function base(site) {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [col(C.bg1), col(C.bg2)];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);
  if (site) w.url = `${site}#bets`;
  return w;
}
function text(stack, str, { size = 12, weight = "semibold", color = C.text, lines = 1, scale = 0.7 } = {}) {
  const t = stack.addText(String(str ?? ""));
  t.font = weight === "bold" ? Font.boldRoundedSystemFont(size) : weight === "heavy" ? Font.heavyRoundedSystemFont(size) : weight === "regular" ? Font.regularRoundedSystemFont(size) : Font.semiboldRoundedSystemFont(size);
  t.textColor = col(color);
  t.lineLimit = lines;
  t.minimumScaleFactor = scale;
  return t;
}
function dot(stack, color, size = 8) {
  const d = stack.addStack();
  d.size = new Size(size, size);
  d.cornerRadius = size / 2;
  d.backgroundColor = col(color);
  return d;
}
function header(w, m, { compact = false } = {}) {
  const h = w.addStack();
  h.centerAlignContent();
  text(h, "\u{1F994}", { size: compact ? 12 : 13 });
  h.addSpacer(4);
  text(h, "hedgehog", { size: compact ? 12 : 13, weight: "bold" });
  h.addSpacer();
  if (m.live) {
    dot(h, C.red, 6);
    h.addSpacer(4);
    text(h, "LIVE", { size: 10, weight: "bold", color: C.red });
  } else if (!compact && m.today.text) {
    text(h, `${m.today.text} today`, { size: 11, color: m.today.profit >= 0 ? C.win : C.red });
  }
}
function statLine(w, m) {
  const s = w.addStack();
  s.centerAlignContent();
  const chip = (label, value, color) => {
    const c = s.addStack();
    c.layoutVertically();
    text(c, label, { size: 9, color: C.muted, weight: "semibold" });
    text(c, value, { size: 15, weight: "bold", color });
    s.addSpacer();
  };
  chip("TODAY", m.today.text || "$0.00", m.today.profit > 0 ? C.win : m.today.profit < 0 ? C.red : C.text);
  chip("OPEN", `${m.open}`, C.text);
  chip("AT RISK", fmt(m.atRisk), C.text);
  chip("TO WIN", fmt(m.toWin), C.accent);
}
var fmt = (n) => n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `$${Math.round(n)}`;
var LEG_MARK = { won: "\u2713", lost: "\u2717", push: "\u2013", void: "\u2013", winning: "\u25B2", losing: "\u25BC", even: "=", live: "\u25CF", pending: "\u25CB" };
function legLine(w, r) {
  const s = w.addStack();
  s.addSpacer(15);
  r.legs.forEach((l, i) => {
    if (i) s.addSpacer(8);
    text(s, `${LEG_MARK[l.state] || "\u25CB"} ${l.label}`, { size: 10, color: STATE_COLOR[l.state] || C.muted, weight: "semibold", scale: 0.6 });
  });
}
function betRow(w, r, { showPays = true, sub = true } = {}) {
  const s = w.addStack();
  s.centerAlignContent();
  dot(s, STATE_COLOR[r.state] || C.faint);
  s.addSpacer(7);
  const mid = s.addStack();
  mid.layoutVertically();
  text(mid, r.title, { size: 13, weight: "semibold" });
  if (sub && r.sub) text(mid, r.sub, { size: 10.5, color: r.state === "losing" ? C.red : C.muted, weight: "regular" });
  s.addSpacer();
  if (showPays) {
    const right = s.addStack();
    right.layoutVertically();
    const top = right.addStack();
    top.addSpacer();
    text(top, r.pays, { size: 12, weight: "bold", color: r.state === "losing" ? C.muted : C.text });
    const bot = right.addStack();
    bot.addSpacer();
    text(bot, r.live ? STATE_WORD[r.state] : r.odds, { size: 10, color: STATE_COLOR[r.state] || C.muted, weight: "semibold" });
  }
}
function empty(w, m, size) {
  w.addSpacer();
  text(w, "No open bets", { size: size === "small" ? 15 : 17, weight: "bold" });
  w.addSpacer(3);
  const line = m.today.settled ? `${m.today.w}-${m.today.l} today \xB7 ${m.today.text}` : "Tap to add one in hedgehog";
  text(w, line, { size: 11, color: m.today.profit > 0 ? C.win : m.today.profit < 0 ? C.red : C.muted, weight: "regular", lines: 2 });
  w.addSpacer();
}
function footer(w, m, stale) {
  const f = w.addStack();
  f.centerAlignContent();
  const bits = [];
  if (!m.live && m.nextKickText) bits.push(`Next ${m.nextKickText}`);
  if (m.live && (m.winning || m.losing)) bits.push(`${m.winning} winning \xB7 ${m.losing} losing`);
  text(f, bits.join(" \xB7 "), { size: 9.5, color: C.faint, weight: "regular" });
  f.addSpacer();
  const t = new Date(m.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  text(f, stale ? `\u26A0\uFE0E ${t}` : t, { size: 9.5, color: stale ? C.amber : C.faint, weight: "regular" });
}
function small(w, m, stale) {
  header(w, m, { compact: true });
  if (!m.open) return empty(w, m, "small");
  w.addSpacer(6);
  const big = w.addStack();
  big.centerAlignContent();
  if (m.live) {
    text(big, `${m.winning}`, { size: 30, weight: "heavy", color: C.win });
    text(big, ` / ${m.live}`, { size: 18, weight: "bold", color: C.muted });
  } else {
    text(big, `${m.open}`, { size: 30, weight: "heavy" });
    text(big, " open", { size: 14, weight: "bold", color: C.muted });
  }
  text(w, m.live ? "winning live" : m.nextKickText ? `next ${m.nextKickText}` : `${fmt(m.toWin)} to win`, { size: 10.5, color: C.muted, weight: "regular" });
  w.addSpacer();
  for (const r of m.rows.slice(0, 2)) {
    const s = w.addStack();
    s.centerAlignContent();
    dot(s, STATE_COLOR[r.state] || C.faint, 6);
    s.addSpacer(5);
    text(s, r.title, { size: 11, weight: "semibold" });
    w.addSpacer(2);
  }
  if (stale) text(w, "\u26A0\uFE0E offline", { size: 9, color: C.amber });
}
function medium(w, m, stale) {
  header(w, m);
  if (!m.open) return empty(w, m, "medium");
  w.addSpacer(8);
  for (const r of m.rows.slice(0, 3)) {
    betRow(w, r);
    w.addSpacer(6);
  }
  w.addSpacer();
  footer(w, m, stale);
}
function large(w, m, stale) {
  header(w, m);
  w.addSpacer(10);
  statLine(w, m);
  if (!m.open) return empty(w, m, "large");
  w.addSpacer(10);
  let room = 8;
  let shown = 0;
  for (const r of m.rows) {
    const parlay = r.legs.length > 1;
    if (room < (parlay ? 1.5 : 1)) break;
    betRow(w, r);
    if (parlay) {
      w.addSpacer(2);
      legLine(w, r);
    }
    w.addSpacer(7);
    room -= parlay ? 1.5 : 1;
    shown++;
  }
  if (m.rows.length > shown) text(w, `+${m.rows.length - shown} more`, { size: 10, color: C.muted });
  w.addSpacer();
  footer(w, m, stale);
}
function lockLine(m) {
  if (!m.open) return m.today.text ? `\u{1F994} ${m.today.text} today` : "\u{1F994} No open bets";
  if (m.live) return `\u{1F994} ${m.winning}\u2191 ${m.losing}\u2193 live${m.today.text ? ` \xB7 ${m.today.text}` : ""}`;
  return `\u{1F994} ${m.open} open${m.nextKickText ? ` \xB7 next ${m.nextKickText}` : ""}`;
}
function rectangular(w, m) {
  w.setPadding(0, 0, 0, 0);
  const plain = { color: "#ffffff" };
  text(w, lockLine(m), { size: 13, weight: "bold", ...plain });
  for (const r of m.rows.slice(0, 2)) {
    const mark = { winning: "\u25B2", losing: "\u25BC", even: "=", live: "\u25CF", pending: "\u25CB" }[r.state] || "\u25CB";
    text(w, `${mark} ${r.title}${r.live && r.sub ? ` \xB7 ${r.sub.split(" \xB7 ").pop()}` : ""}`, { size: 12, weight: "regular", ...plain });
  }
}
function circular(w, m) {
  w.addAccessoryWidgetBackground = true;
  w.setPadding(0, 0, 0, 0);
  const s = w.addStack();
  s.layoutVertically();
  s.centerAlignContent();
  const row2 = (str, size, weight) => {
    const r = s.addStack();
    r.addSpacer();
    text(r, str, { size, weight, color: "#ffffff" });
    r.addSpacer();
  };
  if (m.live) {
    row2(`${m.winning}/${m.live}`, 17, "heavy");
    row2("LIVE", 9, "bold");
  } else {
    row2(`${m.open}`, 20, "heavy");
    row2("OPEN", 9, "bold");
  }
}
function signedOut(w, family) {
  if (family?.startsWith("accessory")) {
    text(w, "\u{1F994} Open Scriptable to sign in", { size: 12, color: "#ffffff" });
    return;
  }
  header(w, { live: 0, today: {} }, { compact: family === "small" });
  w.addSpacer();
  text(w, "Sign in to see your bets", { size: 15, weight: "bold", lines: 2 });
  w.addSpacer(3);
  text(w, "Open Scriptable and run the hedgehog script once.", { size: 11, color: C.muted, weight: "regular", lines: 3 });
  w.addSpacer();
}
function draw(m, { family = "medium", site = "", stale = false } = {}) {
  const w = base(site);
  if (!m) signedOut(w, family);
  else if (family === "accessoryInline") text(w, lockLine(m), { color: "#ffffff" });
  else if (family === "accessoryRectangular") rectangular(w, m);
  else if (family === "accessoryCircular") circular(w, m);
  else if (family === "small") small(w, m, stale);
  else if (family === "large" || family === "extraLarge") large(w, m, stale);
  else medium(w, m, stale);
  if (m) w.refreshAfterDate = new Date(stale ? Date.now() + 10 * 6e4 : m.refreshAt);
  return w;
}
async function signIn() {
  const a = new Alert();
  a.title = "Sign in to hedgehog";
  a.message = "Use the email and password from your hedgehog account. They're kept in this phone's Keychain so the widget can refresh on its own.";
  a.addTextField("Email", Keychain.contains(KEY.email) ? Keychain.get(KEY.email) : "");
  a.addSecureTextField("Password", "");
  a.addAction("Sign in");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  const email = a.textFieldValue(0).trim();
  const password = a.textFieldValue(1);
  try {
    await token("password", { email, password });
  } catch (e) {
    const err = new Alert();
    err.title = "Couldn't sign in";
    err.message = /invalid/i.test(e.message) ? "That email and password don't match a hedgehog account." : e.message;
    err.addAction("OK");
    await err.presentAlert();
    return false;
  }
  Keychain.set(KEY.email, email);
  Keychain.set(KEY.password, password);
  return true;
}
function signOut() {
  for (const k of Object.values(KEY)) if (Keychain.contains(k)) Keychain.remove(k);
  try {
    fm().remove(cachePath());
  } catch {
  }
}
async function menu(site) {
  const signedIn = Keychain.contains(KEY.email);
  if (!signedIn) {
    if (!await signIn()) return;
  }
  for (; ; ) {
    const a = new Alert();
    a.title = "\u{1F994} hedgehog widget";
    a.message = `Signed in as ${Keychain.get(KEY.email)}.

Add it: long-press your Home Screen (or Lock Screen \u2192 Customize) \u2192 + \u2192 Scriptable \u2192 pick a size \u2192 tap the widget \u2192 Script: this one.`;
    a.addAction("Preview small");
    a.addAction("Preview medium");
    a.addAction("Preview large");
    if (site) a.addAction("Open hedgehog");
    a.addDestructiveAction("Sign out");
    a.addCancelAction("Done");
    const i = await a.presentAlert();
    if (i === -1) return;
    if (i <= 2) {
      const family = ["small", "medium", "large"][i];
      const w = await widget(family, site);
      await (family === "small" ? w.presentSmall() : family === "large" ? w.presentLarge() : w.presentMedium());
    } else if (site && i === 3) {
      Safari.open(`${site}#bets`);
      return;
    } else {
      signOut();
      return;
    }
  }
}
async function widget(family, site) {
  let access;
  try {
    access = await accessToken();
  } catch {
    access = void 0;
  }
  if (access === null) return draw(null, { family, site });
  try {
    if (!access) throw new Error("offline");
    const bets = await loadBets(access);
    const games = await loadGames(daysToFetch(bets));
    const m = buildModel(bets, games);
    saveCache(m);
    return draw(m, { family, site });
  } catch {
    const cached = readCache();
    return draw(cached, { family, site, stale: !!cached });
  }
}
async function run({ site = "" } = {}) {
  if (config.runsInWidget) {
    Script.setWidget(await widget(config.widgetFamily || "medium", site));
  } else {
    await menu(site);
  }
  Script.complete();
}
