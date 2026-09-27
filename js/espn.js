// ESPN's public site API. It serves CORS headers, so the browser calls it directly —
// no relay to break. Every response gets normalized into one flat Game shape.

const ROOT = "https://site.api.espn.com/apis/site/v2/sports/football";

/** The leagues hedgehog follows. Every game and every linked leg carries one of these keys. */
export const SPORTS = {
  cfb: { key: "cfb", path: "college-football", groups: "80", label: "CFB", name: "College football", games: "FBS games", ranked: true, logos: "ncaa" },
  nfl: { key: "nfl", path: "nfl", groups: null, label: "NFL", name: "NFL", games: "NFL games", ranked: false, logos: "nfl" },
};
export const sportOf = (k) => SPORTS[k] || SPORTS.cfb;
export const FBS = "80";

async function getJSON(url, { timeout = 12000, retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** ESPN buckets games by US Eastern date, wherever you are. */
export const etDay = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)).replaceAll("-", "");

/** ESPN scoreboard URL for a date or date range ("20260927" or "20260927-20261003"). */
export function scoreboardUrl(dates, sport = "cfb") {
  const sp = sportOf(sport);
  return `${ROOT}/${sp.path}/scoreboard?dates=${dates}${sp.groups ? `&groups=${sp.groups}` : ""}&limit=500`;
}

export async function fetchScoreboard(dates, { sport = "cfb" } = {}) {
  const data = await getJSON(scoreboardUrl(dates, sport));
  return (data.events || []).map((ev) => normalizeEvent(ev, sport)).filter(Boolean);
}

/**
 * Fetch every game between two dates. Tries week-sized range requests first, and if one
 * fails falls back to one request per day for that week, so one bad response can never
 * blank the slate. Returns { games, failedDays }.
 */
export async function fetchRange(start, days, opts) {
  const chunks = [];
  for (let i = 0; i < days; i += 7) {
    const a = addDays(start, i);
    const b = addDays(start, Math.min(i + 6, days - 1));
    chunks.push([a, b]);
  }
  const results = await Promise.all(
    chunks.map(async ([a, b]) => {
      try {
        return { games: await fetchScoreboard(`${ymd(a)}-${ymd(b)}`, opts), failed: [] };
      } catch {
        const n = Math.round((b - a) / 864e5) + 1;
        const per = await Promise.allSettled(
          Array.from({ length: n }, (_, k) => fetchScoreboard(ymd(addDays(a, k)), opts))
        );
        return {
          games: per.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
          failed: per.flatMap((r, k) => (r.status === "rejected" ? [ymd(addDays(a, k))] : [])),
        };
      }
    })
  );
  const byId = new Map();
  for (const r of results) for (const g of r.games) byId.set(g.id, g);
  const failedDays = results.flatMap((r) => r.failed);
  if (!byId.size && failedDays.length) throw new Error("Schedule feed unreachable");
  return { games: [...byId.values()], failedDays };
}

export async function fetchNews({ sport = "cfb", limit = 40 } = {}) {
  const data = await getJSON(`${ROOT}/${sportOf(sport).path}/news?limit=${limit}`);
  return (data.articles || []).map(normalizeArticle).filter(Boolean);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ---------- normalization ----------

const num = (v) => {
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
    league: sport,
  };
}

/** ESPN has shipped two odds shapes over the years; read both. */
export function normalizeOdds(o, home, away) {
  if (!o) return null;
  const out = { provider: o.provider?.name || "Sportsbook", details: o.details || "" };

  // Moneyline
  const mlH = num(o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.open?.odds ?? o.homeTeamOdds?.moneyLine);
  const mlA = num(o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.open?.odds ?? o.awayTeamOdds?.moneyLine);
  if (mlH || mlA) out.ml = { home: mlH, away: mlA };

  // Spread (home-relative line)
  let hl = num(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.open?.line);
  if (hl == null && o.spread != null) hl = num(o.spread);
  if (hl == null && o.details && home && away) {
    const m = o.details.match(/^(\S+)\s+([+-]?\d+(\.\d+)?)$/);
    if (m) hl = m[1] === home.abbr ? Number(m[2]) : m[1] === away.abbr ? -Number(m[2]) : null;
  }
  if (hl != null) {
    out.spread = {
      home: { line: hl, price: num(o.pointSpread?.home?.close?.odds ?? o.homeTeamOdds?.spreadOdds) ?? -110 },
      away: { line: -hl, price: num(o.pointSpread?.away?.close?.odds ?? o.awayTeamOdds?.spreadOdds) ?? -110 },
    };
  }

  // Total
  const tl = num(o.total?.over?.close?.line ?? o.total?.over?.open?.line ?? o.overUnder);
  if (tl != null) {
    out.total = {
      line: tl,
      over: num(o.total?.over?.close?.odds ?? o.overOdds) ?? -110,
      under: num(o.total?.under?.close?.odds ?? o.underOdds) ?? -110,
    };
  }
  return out.ml || out.spread || out.total ? out : null;
}

export function normalizeEvent(ev, sport = "cfb") {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const home = team(comp.competitors?.find((c) => c.homeAway === "home"), sport);
  const away = team(comp.competitors?.find((c) => c.homeAway === "away"), sport);
  if (!home || !away) return null;
  const st = comp.status || ev.status || {};
  const type = st.type || {};
  const sit = comp.situation;
  return {
    id: String(ev.id),
    sport,
    date: comp.date || ev.date,
    timeValid: comp.timeValid !== false,
    name: ev.name,
    shortName: ev.shortName || `${away.abbr} @ ${home.abbr}`,
    week: ev.week?.number ?? null,
    state: type.state || "pre", // pre | in | post
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
    situation: sit
      ? {
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
          awayTimeouts: num(sit.awayTimeouts),
        }
      : null,
    odds: normalizeOdds(comp.odds?.[0], home, away),
  };
}

export function normalizeArticle(a) {
  if (!a?.headline) return null;
  return {
    id: String(a.id ?? a.headline),
    headline: a.headline,
    description: a.description || "",
    published: a.published || a.lastModified || "",
    url: a.links?.web?.href || a.links?.mobile?.href || "",
    image: a.images?.[0]?.url || "",
    byline: a.byline || "",
    teams: (a.categories || []).filter((c) => c.type === "team").map((c) => c.description || c.team?.description).filter(Boolean),
  };
}
