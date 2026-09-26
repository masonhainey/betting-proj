// Demo data source: same interface as espn.js, but generated locally. It emits raw
// ESPN-shaped events (both old and new odds formats) so the real normalizer runs on it.
// Games today are placed around the page-load time and run at 6x speed, so you can watch
// scores tick, bets swing and auto-grade in a single sitting.

import { normalizeEvent, addDays, ymd } from "./espn.js";

const TEAMS = [
  // id, abbr, short, full, color, alt, rating
  [333, "ALA", "Alabama", "Alabama Crimson Tide", "9e1b32", "ffffff", 88],
  [61, "UGA", "Georgia", "Georgia Bulldogs", "ba0c2f", "000000", 91],
  [194, "OSU", "Ohio State", "Ohio State Buckeyes", "ba0c2f", "666666", 93],
  [130, "MICH", "Michigan", "Michigan Wolverines", "00274c", "ffcb05", 82],
  [251, "TEX", "Texas", "Texas Longhorns", "bf5700", "ffffff", 90],
  [2483, "ORE", "Oregon", "Oregon Ducks", "154733", "fee123", 89],
  [213, "PSU", "Penn State", "Penn State Nittany Lions", "061440", "ffffff", 87],
  [87, "ND", "Notre Dame", "Notre Dame Fighting Irish", "0c2340", "c99700", 86],
  [99, "LSU", "LSU", "LSU Tigers", "461d7c", "fdd023", 84],
  [2633, "TENN", "Tennessee", "Tennessee Volunteers", "ff8200", "ffffff", 83],
  [30, "USC", "USC", "USC Trojans", "990000", "ffc72c", 79],
  [228, "CLEM", "Clemson", "Clemson Tigers", "f56600", "522d80", 81],
  [52, "FSU", "Florida State", "Florida State Seminoles", "782f40", "ceb888", 72],
  [201, "OU", "Oklahoma", "Oklahoma Sooners", "841617", "fdf9d8", 78],
  [145, "MISS", "Ole Miss", "Ole Miss Rebels", "13294b", "ce1126", 85],
  [2390, "MIA", "Miami", "Miami Hurricanes", "005030", "f47321", 84],
  [245, "TA&M", "Texas A&M", "Texas A&M Aggies", "500000", "ffffff", 80],
  [142, "MIZ", "Missouri", "Missouri Tigers", "f1b82d", "000000", 77],
  [254, "UTAH", "Utah", "Utah Utes", "cc0000", "ffffff", 76],
  [38, "COLO", "Colorado", "Colorado Buffaloes", "cfb87c", "000000", 73],
  [2306, "KSU", "Kansas State", "Kansas State Wildcats", "512888", "ffffff", 78],
  [2294, "IOWA", "Iowa", "Iowa Hawkeyes", "ffcd00", "000000", 75],
  [275, "WIS", "Wisconsin", "Wisconsin Badgers", "c5050c", "ffffff", 70],
  [2, "AUB", "Auburn", "Auburn Tigers", "0c2340", "e87722", 74],
  [57, "FLA", "Florida", "Florida Gators", "0021a5", "fa4616", 73],
  [264, "WASH", "Washington", "Washington Huskies", "4b2e83", "b7a57a", 74],
  [158, "NEB", "Nebraska", "Nebraska Cornhuskers", "e41c38", "ffffff", 74],
  [252, "BYU", "BYU", "BYU Cougars", "002e5d", "ffffff", 77],
  [68, "BSU", "Boise State", "Boise State Broncos", "0033a0", "d64309", 78],
  [97, "LOU", "Louisville", "Louisville Cardinals", "c9001f", "000000", 76],
  [2567, "SMU", "SMU", "SMU Mustangs", "0033a0", "cc0000", 79],
  [96, "UK", "Kentucky", "Kentucky Wildcats", "0033a0", "ffffff", 68],
  [2579, "SC", "South Carolina", "South Carolina Gamecocks", "73000a", "000000", 79],
  [8, "ARK", "Arkansas", "Arkansas Razorbacks", "a41f35", "ffffff", 71],
  [26, "UCLA", "UCLA", "UCLA Bruins", "2d68c4", "f2a900", 66],
  [66, "ISU", "Iowa State", "Iowa State Cyclones", "c8102e", "f1be48", 79],
  [2628, "TCU", "TCU", "TCU Horned Frogs", "4d1979", "ffffff", 72],
  [239, "BAY", "Baylor", "Baylor Bears", "154734", "ffb81c", 73],
  [12, "ARIZ", "Arizona", "Arizona Wildcats", "0c234b", "ab0520", 71],
  [2641, "TTU", "Texas Tech", "Texas Tech Red Raiders", "cc0000", "000000", 80],
];

const NETS = ["ABC", "ESPN", "FOX", "CBS", "NBC", "FS1", "ESPN2", "BTN", "SECN", "CW", "Peacock"];
const T0 = Date.now();
const SPEED = 6; // game minutes per real minute for today's games
const GAME_MIN = 210; // wall-clock minutes a game "lasts" at 1x

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hash = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const rankOf = (() => {
  const sorted = [...TEAMS].sort((a, b) => b[6] - a[6]);
  const m = new Map();
  sorted.slice(0, 25).forEach((t, i) => m.set(t[0], i + 1));
  return (id) => m.get(id) || 99;
})();

function slateFor(date) {
  const day = date.getDay();
  const count = day === 6 ? 16 : day === 5 ? 2 : day === 4 ? 1 : 0;
  if (!count) return [];
  const r = rng(hash(ymd(date)));
  const pool = [...TEAMS].sort(() => r() - 0.5);
  const today = ymd(date) === ymd(new Date());
  const games = [];
  for (let i = 0; i < count; i++) {
    const home = pool[i * 2], away = pool[i * 2 + 1];
    let kick;
    if (today) {
      // Spread today's slate around right now: finals, live games, and later kickoffs.
      const offsets = [-80, -55, -14, -9, -3, 25, 70, 140, 200, 260, 330, 400, -120, 95, 160, 300];
      kick = new Date(T0 + offsets[i % offsets.length] * 60000);
    } else {
      const slots = day === 6 ? [10, 10, 13.5, 13.5, 14, 17, 17.5, 18, 19.5, 20, 21, 12, 15.5, 16, 19, 22.5] : [18, 20];
      const hour = slots[i % slots.length];
      kick = new Date(date);
      kick.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      // One game per week gets its kickoff moved two minutes after load, to show change tracking.
      if (i === 3 && Date.now() - T0 > 120000) kick = new Date(kick.getTime() + 150 * 60000);
    }
    games.push({ id: `9${ymd(date)}${String(i).padStart(2, "0")}`, home, away, kick, seed: hash(ymd(date) + i), today, tbd: !today && i === count - 1 });
  }
  return games;
}

function scoringPlays(seed, hr, ar) {
  const r = rng(seed);
  const plays = [];
  for (let m = 4; m < 60; m += 3 + r() * 5) {
    const edge = (hr + 3 - ar) / 60;
    if (r() < 0.42) plays.push({ m, home: r() < 0.5 + edge, pts: r() < 0.7 ? 7 : 3 });
  }
  return plays;
}

function eventFor(g) {
  const now = Date.now();
  const speed = g.today ? SPEED : 1;
  const gameMin = ((now - g.kick.getTime()) / 60000) * speed * (60 / GAME_MIN);
  let state = "pre", completed = false, period = 0, clock = "0:00";
  let hs = null, as = null;
  const [hid, habbr, hshort, hname, hcol, halt, hr] = g.home;
  const [aid, aabbr, ashort, aname, acol, aalt, ar] = g.away;
  if (gameMin >= 0) {
    const plays = scoringPlays(g.seed, hr, ar);
    const upto = Math.min(gameMin, 60);
    hs = plays.filter((p) => p.m <= upto && p.home).reduce((s, p) => s + p.pts, 0);
    as = plays.filter((p) => p.m <= upto && !p.home).reduce((s, p) => s + p.pts, 0);
    if (gameMin >= 60 && hs === as) hs += 3; // overtime, sort of
    if (gameMin >= 60) {
      state = "post";
      completed = true;
    } else {
      state = "in";
      period = Math.min(4, Math.floor(gameMin / 15) + 1);
      const left = 15 - (gameMin % 15);
      clock = `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")}`;
    }
  }
  const r = rng(g.seed + 99);
  // Lines drift a half point every ~5 minutes for a few games so line moves show up.
  const drift = g.seed % 4 === 0 ? Math.floor((now - T0) / 300000) * 0.5 * (g.seed % 8 === 0 ? 1 : -1) : 0;
  const rawSpread = -(hr - ar + 2.5) + drift;
  const spread = Math.round(rawSpread * 2) / 2 || -1;
  const total = Math.round((44 + r() * 20) * 2) / 2;
  const ml = spreadToMl(spread);
  const newShape = g.seed % 2 === 0;
  const details = spread < 0 ? `${habbr} ${spread}` : `${aabbr} ${-spread}`;
  const odds = newShape
    ? {
        provider: { name: "DraftKings" },
        details,
        overUnder: total,
        moneyline: { home: { close: { odds: fmtA(ml.home) } }, away: { close: { odds: fmtA(ml.away) } } },
        pointSpread: {
          home: { close: { line: fmtL(spread), odds: "-110" } },
          away: { close: { line: fmtL(-spread), odds: "-110" } },
        },
        total: { over: { close: { line: `o${total}`, odds: "-110" } }, under: { close: { line: `u${total}`, odds: "-110" } } },
      }
    : {
        provider: { name: "ESPN BET" },
        details,
        spread,
        overUnder: total,
        homeTeamOdds: { moneyLine: ml.home, spreadOdds: -110 },
        awayTeamOdds: { moneyLine: ml.away, spreadOdds: -110 },
      };
  const shortDetail =
    state === "pre" ? g.kick.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) :
    state === "post" ? "Final" : `${clock} - ${["1st", "2nd", "3rd", "4th"][period - 1]}`;
  const poss = r() < 0.5 ? hid : aid;
  return {
    id: g.id,
    date: g.kick.toISOString(),
    name: `${aname} at ${hname}`,
    shortName: `${aabbr} @ ${habbr}`,
    week: { number: 5 },
    competitions: [
      {
        date: g.kick.toISOString(),
        timeValid: !g.tbd,
        venue: { fullName: `${hshort} Stadium`, address: { city: "Somewhere", state: "USA" } },
        broadcasts: [{ names: [NETS[g.seed % NETS.length]] }],
        status: { displayClock: clock, period, type: { state, completed, detail: shortDetail, shortDetail } },
        situation:
          state === "in"
            ? {
                possession: String(poss),
                shortDownDistanceText: `${1 + (g.seed % 3)}${["st", "nd", "rd"][g.seed % 3]} & ${3 + (g.seed % 8)}`,
                isRedZone: (Math.floor(now / 30000) + g.seed) % 5 === 0,
                lastPlay: { text: "Demo play-by-play: 9-yard run up the middle." },
              }
            : undefined,
        competitors: [
          comp("home", g.home, hs, state === "post" && hs > as),
          comp("away", g.away, as, state === "post" && as > hs),
        ],
        odds: [odds],
      },
    ],
  };
  function comp(homeAway, t, score, winner) {
    const [id, abbr, short, name, color, alt] = t;
    return {
      homeAway,
      score: score == null ? undefined : String(score),
      winner,
      curatedRank: { current: rankOf(id) },
      records: [{ type: "total", summary: `${3 + (id % 2)}-${id % 2}` }],
      team: {
        id: String(id), abbreviation: abbr, shortDisplayName: short, displayName: name, color, alternateColor: alt,
        logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`,
      },
    };
  }
}

const fmtA = (n) => (n > 0 ? `+${n}` : `${n}`);
const fmtL = (n) => (n > 0 ? `+${n}` : `${n}`);

function spreadToMl(spread) {
  // Rough CFB spread→ML curve, with a bit of juice.
  const p = 1 / (1 + Math.exp(spread / 5.8)); // home win prob (spread negative = home fav)
  const toA = (q) => {
    q = Math.min(0.985, Math.max(0.015, q * 1.025));
    return q >= 0.5 ? -Math.round((q / (1 - q)) * 100 / 5) * 5 : Math.round(((1 - q) / q) * 100 / 5) * 5;
  };
  return { home: toA(p), away: toA(1 - p) };
}

function parseDates(dates) {
  const [a, b] = dates.split("-");
  const d = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return [d(a), d(b || a)];
}

export async function fetchScoreboard(dates) {
  await new Promise((r) => setTimeout(r, 120));
  const [a, b] = parseDates(dates);
  const out = [];
  for (let d = new Date(a); d <= b; d = addDays(d, 1)) out.push(...slateFor(d).map(eventFor).map(normalizeEvent));
  return out;
}

export async function fetchRange(start, days) {
  return { games: await fetchScoreboard(`${ymd(start)}-${ymd(addDays(start, days - 1))}`), failedDays: [] };
}

export async function fetchNews() {
  await new Promise((r) => setTimeout(r, 150));
  const r = rng(hash(ymd(new Date())));
  const pick = () => TEAMS[Math.floor(r() * TEAMS.length)];
  const templates = [
    (t) => [`${t[2]} QB listed as questionable with ankle injury ahead of Saturday`, `The starter was limited in practice Thursday; ${t[2]} will make a game-time decision.`],
    (t) => [`Line moves: Sharp money pushes ${t[2]} spread a full point`, `Books opened the number lower before early action came in on ${t[3]}.`],
    (t) => [`${t[2]} coach says 'we have to be better on third down' in press conference`, `Weekly press conference notes, injury updates and depth chart changes.`],
    (t) => [`Week 6 preview: key matchups and storylines for ${t[3]}`, `What to watch as conference play heats up, plus a look ahead at the next month.`],
    (t) => [`AP Top 25 rankings: ${t[2]} climbs after statement win`, `Movement across the poll after a chaotic weekend.`],
    (t) => [`${t[2]} lands commitment from four-star transfer portal receiver`, `The receiver chose ${t[2]} over several SEC programs.`],
    (t) => [`${t[2]} RB out for season after torn ACL`, `A major blow to ${t[3]}, who lean heavily on the run game.`],
    (t) => [`Best bets for Saturday: upset alert on ${t[2]} as an underdog`, `Our analysts break down the spread, total and a moneyline parlay.`],
    (t) => [`${t[2]} OC explains new tempo package in interview`, `The staff opens up on what changed during the bye week.`],
    (t) => [`Playoff projection: where ${t[2]} stands at the quarter mark`, `CFP picture after five weeks.`],
  ];
  return Array.from({ length: 18 }, (_, i) => {
    const t = pick();
    const [headline, description] = templates[i % templates.length](t);
    return {
      id: `demo-news-${i}`,
      headline,
      description,
      published: new Date(T0 - i * 47 * 60000 - r() * 30 * 60000).toISOString(),
      url: "",
      image: "",
      byline: "Demo feed",
      teams: [t[3]],
    };
  });
}
