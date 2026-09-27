// Player props: read them from a pick ("Josh Allen over 250.5 passing yards"), read ESPN
// box scores, and say how a prop is doing. Pure — unit-tested.
//
// Prop  { player, stat, side: 'over'|'under'|'yes', line }
// Box   { players: [{ id, name, short, team, stats: { passYds, … } }], final }

/** Stats hedgehog can track. `v` pulls the number from a player's box-score line. */
export const STATS = {
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
  anytime_td: { label: "Anytime TD", short: "TD", v: (s) => s.rushTD + s.recTD },
};

// Most specific first ("rush + rec yards" before "rush yards").
const STAT_WORDS = [
  ["anytime_td", /\b(anytime\s*(td|touchdown)(\s*scorer)?|attd|to score (a |any )?(td|touchdown))\b/i],
  ["rush_rec_yds", /\b(rush(ing)?\s*(\+|&|and)\s*rec(eiving)?|rush\s*\+\s*rec|scrimmage)(\s*(yds|yards))?\b/i],
  ["pass_rush_yds", /\bpass(ing)?\s*(\+|&|and)\s*rush(ing)?(\s*(yds|yards))?\b/i],
  ["pass_tds", /\bpass(ing)?\s*(td|tds|touchdowns?)\b/i],
  ["rush_tds", /\brush(ing)?\s*(td|tds|touchdowns?)\b/i],
  ["rec_tds", /\brec(eiving)?\s*(td|tds|touchdowns?)\b/i],
  ["pass_att", /\bpass(ing)?\s*att(empt)?s?\b/i],
  ["pass_yds", /\bpass(ing)?\s*(yds|yards|yd)\b/i],
  ["completions", /\b(pass(ing)?\s*)?(completions?|cmp)\b/i],
  ["ints", /\b(interceptions?(\s*thrown)?|ints?\s*thrown|\bints?\b)/i],
  ["rush_att", /\b(rush(ing)?\s*att(empt)?s?|carries)\b/i],
  ["rush_yds", /\brush(ing)?\s*(yds|yards|yd)\b/i],
  ["rec_yds", /\brec(eiving)?\s*(yds|yards|yd)\b/i],
  ["receptions", /\b(receptions?|catches|rec)\b/i],
];

const NOISE = /\b(over|under|player|props?|alt(ernate)?|total|yds|yards|ml|pts|points|and|to|the|tds?)\b/gi;

/**
 * Read a prop from pick text. Returns null if it isn't one we can track.
 *   "Josh Allen Over 250.5 Passing Yards" · "J. Allen o250.5 pass yds" · "Kelce 6+ receptions"
 *   "Derrick Henry anytime TD" · "Bijan Robinson Rush + Rec Yards U 110.5"
 */
export function parseProp(text) {
  const raw = String(text || "").replace(/[–—]/g, "-").trim();
  if (!raw) return null;
  const hit = STAT_WORDS.find(([, re]) => re.test(raw));
  if (!hit) return null;
  const [stat, re] = hit;
  let side = null, line = null;
  let rest = raw.replace(re, " ");
  if (stat === "anytime_td") {
    side = "yes";
    line = 0.5;
  } else {
    const ou = /\b(over|under|o|u)\s*(\d+(?:\.\d+)?)\b/i.exec(rest) || /(?:^|\s)([ou])(\d+(?:\.\d+)?)\b/i.exec(rest);
    const plus = /\b(\d+)\s*\+/.exec(rest);
    if (ou) {
      side = /^o/i.test(ou[1]) ? "over" : "under";
      line = Number(ou[2]);
      rest = rest.replace(ou[0], " ");
    } else if (plus) {
      side = "over";
      line = Number(plus[1]) - 0.5; // "6+" means 6 or more
      rest = rest.replace(plus[0], " ");
    } else return null;
  }
  if (!(line >= 0) || line > 1000) return null;
  const player = rest
    .replace(/\([^)]*\)/g, " ") // "(BUF)"
    .replace(/[+-]\d{3,4}\b/g, " ") // odds
    .replace(NOISE, " ")
    .replace(/[^A-Za-z.'\- ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.\-']+|[\s\-']+$/g, "")
    .trim();
  if (player.replace(/[^A-Za-z]/g, "").length < 3) return null;
  return { player, stat, side, line };
}

export const propText = (p) =>
  p.side === "yes" ? `${p.player} anytime TD` : `${p.player} ${p.side === "over" ? "o" : "u"}${p.line} ${STATS[p.stat]?.short || p.stat}`;

// ───────── ESPN box scores ─────────

const EMPTY = () => ({ passYds: 0, passTD: 0, cmp: 0, att: 0, int: 0, rushYds: 0, rushAtt: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 });
const n = (v) => {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};

// Category → { ESPN key or label → our field }. Keys first, labels as a fallback.
const MAP = {
  passing: { passingYards: "passYds", YDS: "passYds", passingTouchdowns: "passTD", TD: "passTD", interceptions: "int", INT: "int" },
  rushing: { rushingAttempts: "rushAtt", CAR: "rushAtt", rushingYards: "rushYds", YDS: "rushYds", rushingTouchdowns: "rushTD", TD: "rushTD" },
  receiving: { receptions: "rec", REC: "rec", receivingYards: "recYds", YDS: "recYds", receivingTouchdowns: "recTD", TD: "recTD" },
};

/** Players' stat lines from an ESPN game summary (the feed behind Gamecast). */
export function parseBox(summary) {
  const byId = new Map();
  for (const side of summary?.boxscore?.players || []) {
    const team = String(side.team?.id ?? "");
    for (const cat of side.statistics || []) {
      const name = String(cat.name || "").toLowerCase();
      const map = MAP[name];
      if (!map) continue;
      const cols = (cat.keys?.length ? cat.keys : cat.labels) || [];
      for (const a of cat.athletes || []) {
        const ath = a.athlete || {};
        const id = String(ath.id ?? ath.displayName ?? "");
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { id, name: ath.displayName || "", short: ath.shortName || "", team, stats: EMPTY() });
        const p = byId.get(id);
        cols.forEach((key, i) => {
          const v = a.stats?.[i];
          if (name === "passing" && /completions\/passingAttempts|C\/ATT/i.test(key)) {
            const [c, t] = String(v || "").split("/");
            p.stats.cmp = n(c);
            p.stats.att = n(t);
          } else if (map[key]) p.stats[map[key]] = n(v);
        });
      }
    }
  }
  const status = summary?.header?.competitions?.[0]?.status?.type;
  return { players: [...byId.values()], final: !!status?.completed };
}

const norm = (s) => String(s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Find the prop's player in a box score: full name, "J. Allen", or a unique last name. */
export function findPlayer(name, players) {
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

/** Share of regulation played, for an "on pace" projection. */
function played(game) {
  if (game?.state !== "in" || !game.period) return 0;
  if (game.period > 4) return 1;
  const [m, s] = String(game.clock || "").split(":").map(Number);
  const left = Number.isFinite(m) ? m + (s || 0) / 60 : 15;
  return Math.min(1, ((game.period - 1) * 15 + (15 - left)) / 60);
}

/**
 * Where a prop stands: { margin, text, value } (margin > 0 is winning), or null when there's
 * no box score yet or the player isn't in it.
 */
export function propMargin(leg, game) {
  const p = leg.prop;
  const box = game?.box;
  if (!p || !box || !STATS[p.stat]) return null;
  const pl = findPlayer(p.player, box.players);
  if (!pl) return null;
  const value = STATS[p.stat].v(pl.stats);
  const margin = p.side === "under" ? p.line - value : value - p.line;
  const unit = STATS[p.stat].short;
  let text = p.side === "yes" ? (value > 0 ? `Scored${value > 1 ? ` ×${value}` : ""}` : "No TD yet") : `${value} / ${p.line} ${unit}`;
  const f = played(game);
  if (p.side !== "yes" && f > 0.12 && f < 1 && game.state === "in") text += ` · on pace for ${Math.round(value / f)}`;
  // An under can't be decided early, and neither can an over that hasn't cleared yet.
  return { margin, text, value, player: pl.name };
}
