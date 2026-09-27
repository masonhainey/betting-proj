// Demo data source: same interface as espn.js, but generated locally. It emits raw
// ESPN-shaped events (both old and new odds formats) so the real normalizer runs on it.
// Games today are placed around the page-load time and run at 6x speed, so you can watch
// scores tick, bets swing and auto-grade in a single sitting.

import { normalizeEvent, addDays, ymd } from "./espn.js";
import { parseSummary } from "./summary.js";

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

// NFL: same shape. Ratings are only for making plausible lines.
const NFL_TEAMS = [
  [22, "ARI", "Cardinals", "Arizona Cardinals", "a40227", "ffffff", 74], [1, "ATL", "Falcons", "Atlanta Falcons", "a71930", "000000", 75],
  [33, "BAL", "Ravens", "Baltimore Ravens", "29126f", "000000", 88], [2, "BUF", "Bills", "Buffalo Bills", "00338d", "d50a0a", 89],
  [29, "CAR", "Panthers", "Carolina Panthers", "0085ca", "000000", 68], [3, "CHI", "Bears", "Chicago Bears", "0b1c3a", "e64100", 74],
  [4, "CIN", "Bengals", "Cincinnati Bengals", "fb4f14", "000000", 80], [5, "CLE", "Browns", "Cleveland Browns", "472a08", "ff3c00", 69],
  [6, "DAL", "Cowboys", "Dallas Cowboys", "002a5c", "b0b7bc", 77], [7, "DEN", "Broncos", "Denver Broncos", "0a2343", "fc4c02", 79],
  [8, "DET", "Lions", "Detroit Lions", "0076b6", "bbbbbb", 88], [9, "GB", "Packers", "Green Bay Packers", "204e32", "ffb612", 83],
  [34, "HOU", "Texans", "Houston Texans", "03202f", "a71930", 79], [11, "IND", "Colts", "Indianapolis Colts", "002c5f", "a2aaad", 74],
  [30, "JAX", "Jaguars", "Jacksonville Jaguars", "007487", "d7a22a", 72], [12, "KC", "Chiefs", "Kansas City Chiefs", "e31837", "ffb612", 90],
  [13, "LV", "Raiders", "Las Vegas Raiders", "000000", "a5acaf", 70], [24, "LAC", "Chargers", "Los Angeles Chargers", "0080c6", "ffc20e", 80],
  [14, "LAR", "Rams", "Los Angeles Rams", "003594", "ffd100", 81], [15, "MIA", "Dolphins", "Miami Dolphins", "008e97", "fc4c02", 74],
  [16, "MIN", "Vikings", "Minnesota Vikings", "4f2683", "ffc62f", 82], [17, "NE", "Patriots", "New England Patriots", "002a5c", "c60c30", 72],
  [18, "NO", "Saints", "New Orleans Saints", "d3bc8d", "000000", 69], [19, "NYG", "Giants", "New York Giants", "003c7f", "c9243f", 68],
  [20, "NYJ", "Jets", "New York Jets", "115740", "ffffff", 70], [21, "PHI", "Eagles", "Philadelphia Eagles", "06424d", "a5acaf", 89],
  [23, "PIT", "Steelers", "Pittsburgh Steelers", "000000", "ffb612", 78], [25, "SF", "49ers", "San Francisco 49ers", "aa0000", "b3995d", 83],
  [26, "SEA", "Seahawks", "Seattle Seahawks", "002a5c", "69be28", 77], [27, "TB", "Buccaneers", "Tampa Bay Buccaneers", "bd1c36", "3e3a35", 79],
  [10, "TEN", "Titans", "Tennessee Titans", "4b92db", "002a5c", 67], [28, "WSH", "Commanders", "Washington Commanders", "5a1414", "ffb612", 81],
];
const teamsFor = (sport) => (sport === "nfl" ? NFL_TEAMS : TEAMS);

const NETS = ["ABC", "ESPN", "FOX", "CBS", "NBC", "FS1", "ESPN2", "BTN", "SECN", "CW", "Peacock"];
const NFL_NETS = ["CBS", "FOX", "CBS", "FOX", "NBC", "ESPN", "Prime Video", "NFL Network"];
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

function slateFor(date, sport = "cfb") {
  const day = date.getDay();
  const nfl = sport === "nfl";
  const count = nfl ? (day === 0 ? 14 : day === 1 || day === 4 ? 1 : 0) : day === 6 ? 16 : day === 5 ? 2 : day === 4 ? 1 : 0;
  if (!count) return [];
  const r = rng(hash(ymd(date) + (nfl ? "nfl" : "")));
  const pool = [...teamsFor(sport)].sort(() => r() - 0.5);
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
      const slots = nfl ? (day === 0 ? [12, 12, 12, 12, 12, 12, 12, 15, 15, 15.4, 15.4, 15.4, 19.3, 12] : [19.25]) : day === 6 ? [10, 10, 13.5, 13.5, 14, 17, 17.5, 18, 19.5, 20, 21, 12, 15.5, 16, 19, 22.5] : [18, 20];
      const hour = slots[i % slots.length];
      kick = new Date(date);
      kick.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      // One game per week gets its kickoff moved two minutes after load, to show change tracking.
      if (i === 3 && Date.now() - T0 > 120000) kick = new Date(kick.getTime() + 150 * 60000);
    }
    games.push({ id: `${nfl ? 8 : 9}${ymd(date)}${String(i).padStart(2, "0")}`, sport, home, away, kick, seed: hash(ymd(date) + i + sport), today, tbd: !nfl && !today && i === count - 1 });
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

const gameMinOf = (g) => ((Date.now() - g.kick.getTime()) / 60000) * (g.today ? SPEED : 1) * (60 / GAME_MIN);

function eventFor(g) {
  const now = Date.now();
  const gameMin = gameMinOf(g);
  let state = "pre", completed = false, period = 0, clock = "0:00";
  let hs = null, as = null;
  const [hid, habbr, hshort, hname, _hcol, _halt, hr] = g.home;
  const [aid, aabbr, _ashort, aname, _acol, _aalt, ar] = g.away;
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
        broadcasts: [{ names: [g.sport === "nfl" ? NFL_NETS[g.seed % NFL_NETS.length] : NETS[g.seed % NETS.length]] }],
        status: { displayClock: clock, period, type: { state, completed, detail: shortDetail, shortDetail } },
        situation: state === "in" ? drive(g, gameMin, hid, aid, habbr, aabbr) : undefined,
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
      curatedRank: { current: g.sport === "nfl" ? 99 : rankOf(id) },
      records: [{ type: "total", summary: `${3 + (id % 2)}-${id % 2}` }],
      team: {
        id: String(id), abbreviation: abbr, shortDisplayName: short, displayName: name, color, alternateColor: alt,
        logo: g.sport === "nfl" ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`,
      },
    };
  }
}

/**
 * A simulated drive so the field graphic has something to show: each possession starts
 * around the 25 and moves downfield play by play, ending in a score or a punt.
 */
function drive(g, gameMin, hid, aid, habbr, aabbr) {
  const LEN = 3.2; // game minutes per possession
  const n = Math.floor(gameMin / LEN);
  const frac = (gameMin % LEN) / LEN;
  const r = rng(g.seed + n * 7919);
  const homeBall = (n + g.seed) % 2 === 0;
  const reach = 45 + r() * 60; // how far this drive gets before it ends
  const plays = Math.floor(frac * 9); // one play per ~20s of game time
  let own = 25; // yards from the offense's own goal line
  let down = 1, togo = 10, last = "Kickoff: touchback.", lastType = "Kickoff";
  const log = [{ text: "Kickoff: touchback.", type: "Kickoff", yards: 0 }];
  for (let p = 0; p < plays; p++) {
    const gain = Math.round(-2 + r() * 14);
    own = Math.min(99, reach, Math.max(1, own + gain)); // the drive stalls at `reach` (or scores)
    last = gain >= 0 ? `${gain}-yard ${r() < 0.5 ? "run" : "pass"}` : `Sacked for a loss of ${-gain}`;
    lastType = gain >= 0 ? "Rush" : "Sack";
    togo -= gain;
    if (togo <= 0) { down = 1; togo = 10; last += ", first down"; }
    else if (++down > 4) { down = 1; togo = 10; }
    log.push({ text: last, type: lastType, yards: gain });
  }
  const scored = own >= 99;
  if (scored) { last = "Touchdown! 3-yard run up the middle."; lastType = "Rushing Touchdown"; log.push({ text: last, type: lastType, yards: 3, scoring: true }); }
  const opp = homeBall ? aabbr : habbr, mine = homeBall ? habbr : aabbr;
  const yd = Math.round(own);
  const spot = yd === 50 ? "50" : yd < 50 ? `${mine} ${yd}` : `${opp} ${100 - yd}`;
  const goal = togo >= 100 - yd;
  const ord = ["1st", "2nd", "3rd", "4th"][down - 1];
  return {
    possession: String(homeBall ? hid : aid),
    down, distance: togo, yardLine: yd, yardsToEndzone: 100 - yd,
    possessionText: spot,
    shortDownDistanceText: `${ord} & ${goal ? "Goal" : togo}`,
    downDistanceText: `${ord} & ${goal ? "Goal" : togo} at ${spot}`,
    isRedZone: 100 - yd <= 20,
    homeTimeouts: 3 - (g.seed % 2), awayTimeouts: 3 - ((g.seed >> 1) % 3),
    lastPlay: { text: `Demo: ${last}`, type: { text: lastType }, team: { id: String(homeBall ? hid : aid) } },
    _drive: { team: String(homeBall ? hid : aid), start: `${mine} 25`, log, yards: yd - 25, n: log.length - 1, secs: Math.round(frac * LEN * 60) },
  };
}

// ───────── demo box scores (player props) ─────────

const FIRST = ["Jalen", "Marcus", "Tyler", "Caleb", "Drew", "Jaylen", "Bo", "Quinn", "Trey", "Malik", "Cam", "Devin", "Isaiah", "Kyle", "Xavier", "Luke", "Deion", "Ryan", "Chase", "Nico"];
const LAST = ["Reed", "Carter", "Hayes", "Brooks", "Maddox", "Sutton", "Price", "Ellis", "Banks", "Pierce", "Walker", "Holt", "Rivers", "Dixon", "Shaw", "Lowe", "Grant", "Nash", "Bishop", "Ford"];
const SLOTS = ["QB", "RB", "WR1", "WR2", "TE"];

/** Made-up but stable (and unique) names for a demo team's skill players. */
export function demoRoster(teamId, sport = "cfb") {
  const list = teamsFor(sport);
  const t = Math.max(0, list.findIndex((x) => String(x[0]) === String(teamId)));
  return Object.fromEntries(SLOTS.map((k, i) => {
    const idx = (sport === "nfl" ? 200 : 0) + t * SLOTS.length + i;
    return [k, { id: `${sport}${teamId}-${i}`, name: `${FIRST[idx % FIRST.length]} ${LAST[Math.floor(idx / FIRST.length) % LAST.length]}` }];
  }));
}

/**
 * A demo game's detail, shaped like ESPN's summary feed: box score filling in as the game
 * goes, the current drive's plays, and a win-probability line. Same parser as the real feed.
 */
export async function fetchSummary(id, { sport = "cfb" } = {}) {
  await new Promise((r) => setTimeout(r, 80));
  const m = /^([89])(\d{8})(\d{2})$/.exec(String(id));
  const empty = parseSummary({});
  if (!m) return empty;
  const date = new Date(+m[2].slice(0, 4), +m[2].slice(4, 6) - 1, +m[2].slice(6, 8));
  const g = slateFor(date, m[1] === "8" ? "nfl" : sport)[+m[3]];
  if (!g) return empty;
  const ev = eventFor(g);
  const st = ev.competitions[0].status;
  const done = st.type.state === "post";
  const played = done ? 1 : st.type.state === "in" ? Math.min(1, ((st.period - 1) * 15 + (15 - parseFloat(st.displayClock))) / 60) : 0;
  const cats = (teamId) => {
    const ros = demoRoster(teamId, g.sport);
    const r = rng(g.seed + Number(teamId));
    const full = (lo, hi) => lo + r() * (hi - lo);
    const now = (v, whole) => (whole ? Math.floor(v * played + 0.001) : Math.round(v * played));
    const qb = { att: full(25, 42), yds: full(160, 340), td: Math.floor(full(0, 4)), int: Math.floor(full(0, 2)), ry: full(0, 40), rc: full(2, 7) };
    const rb = { car: full(10, 24), yds: full(30, 140), td: Math.floor(full(0, 2.4)), rec: full(1, 5), ryds: full(5, 45) };
    const wr = [[3, 10, 40, 140], [2, 7, 20, 90], [2, 7, 15, 80]].map(([a, b, c, d]) => ({ rec: full(a, b), yds: full(c, d), td: Math.floor(full(0, 1.8)) }));
    const ath = (p) => ({ id: p.id, displayName: p.name, shortName: `${p.name[0]}. ${p.name.split(" ")[1]}` });
    return [
      { name: "passing", keys: ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
        athletes: [{ athlete: ath(ros.QB), stats: [`${now(qb.att * 0.64)}/${now(qb.att)}`, String(now(qb.yds)), String(now(qb.td, 1)), String(now(qb.int, 1))] }] },
      { name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"],
        athletes: [{ athlete: ath(ros.RB), stats: [String(now(rb.car)), String(now(rb.yds)), String(now(rb.td, 1))] },
          { athlete: ath(ros.QB), stats: [String(now(qb.rc)), String(now(qb.ry)), "0"] }] },
      { name: "receiving", keys: ["receptions", "receivingYards", "receivingTouchdowns"],
        athletes: [["WR1", 0], ["WR2", 1], ["TE", 2]].map(([k, i]) => ({ athlete: ath(ros[k]), stats: [String(now(wr[i].rec)), String(now(wr[i].yds)), String(now(wr[i].td, 1))] }))
          .concat([{ athlete: ath(ros.RB), stats: [String(now(rb.rec)), String(now(rb.ryds)), "0"] }]) },
    ];
  };
  const sit = ev.competitions[0].situation;
  const d = sit?._drive;
  const comps = ev.competitions[0].competitors;
  const hs = Number(comps[0].score) || 0, as = Number(comps[1].score) || 0;
  const left = 1 - played;
  const pHome = done ? (hs > as ? 1 : 0) : 1 / (1 + Math.exp(-((hs - as) / (7 * Math.sqrt(left + 0.04)) + (g.home[6] - g.away[6]) / 25)));
  return parseSummary({
    header: { competitions: [{ status: { type: { completed: done } } }] },
    boxscore: { players: [g.home, g.away].map((t) => ({ team: { id: String(t[0]) }, statistics: cats(t[0]) })) },
    drives: d ? { current: {
      team: { id: d.team },
      description: `${d.n} play${d.n === 1 ? "" : "s"}, ${d.yards} yard${d.yards === 1 ? "" : "s"}, ${Math.floor(d.secs / 60)}:${String(d.secs % 60).padStart(2, "0")}`,
      start: { text: d.start },
      plays: d.log.map((p, i) => ({ text: p.text, type: { text: p.type }, statYardage: p.yards, scoringPlay: !!p.scoring, period: { number: st.period }, clock: { displayValue: st.displayClock && i === d.log.length - 1 ? st.displayClock : "" } })),
    } } : undefined,
    winprobability: st.type.state === "pre" ? [] : [{ homeWinPercentage: Math.round(pHome * 1000) / 1000, tiePercentage: 0 }],
  });
}

export const fetchBox = async (id, opts) => (await fetchSummary(id, opts)).box;

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

export async function fetchScoreboard(dates, { sport = "cfb" } = {}) {
  await new Promise((r) => setTimeout(r, 120));
  const [a, b] = parseDates(dates);
  const out = [];
  for (let d = new Date(a); d <= b; d = addDays(d, 1)) out.push(...slateFor(d, sport).map(eventFor).map((ev) => normalizeEvent(ev, sport)));
  return out;
}

export async function fetchRange(start, days, opts) {
  return { games: await fetchScoreboard(`${ymd(start)}-${ymd(addDays(start, days - 1))}`, opts), failedDays: [] };
}

export async function fetchNews({ sport = "cfb" } = {}) {
  await new Promise((r) => setTimeout(r, 150));
  const r = rng(hash(ymd(new Date()) + sport));
  const teams = teamsFor(sport);
  const pick = () => teams[Math.floor(r() * teams.length)];
  const nfl = sport === "nfl";
  const day = nfl ? "Sunday" : "Saturday";
  const templates = [
    (t) => [`${t[2]} QB listed as questionable with ankle injury ahead of ${day}`, `The starter was limited in practice Thursday; ${t[2]} will make a game-time decision.`],
    (t) => [`Line moves: Sharp money pushes ${t[2]} spread a full point`, `Books opened the number lower before early action came in on ${t[3]}.`],
    (t) => [`${t[2]} coach says 'we have to be better on third down' in press conference`, `Weekly press conference notes, injury updates and depth chart changes.`],
    (t) => [`Week 6 preview: key matchups and storylines for ${t[3]}`, `What to watch as conference play heats up, plus a look ahead at the next month.`],
    nfl ? (t) => [`Power rankings: ${t[2]} climb after statement win`, `Movement across the league after a chaotic weekend.`] : (t) => [`AP Top 25 rankings: ${t[2]} climbs after statement win`, `Movement across the poll after a chaotic weekend.`],
    nfl ? (t) => [`${t[3]} sign veteran receiver off the practice squad`, `The move adds depth after a hamstring injury.`] : (t) => [`${t[2]} lands commitment from four-star transfer portal receiver`, `The receiver chose ${t[2]} over several SEC programs.`],
    (t) => [`${t[2]} RB out for season after torn ACL`, `A major blow to ${t[3]}, who lean heavily on the run game.`],
    (t) => [`Best bets for ${day}: upset alert on ${t[2]} as an underdog`, `Our analysts break down the spread, total and a moneyline parlay.`],
    (t) => [`${t[2]} OC explains new tempo package in interview`, `The staff opens up on what changed during the bye week.`],
    (t) => [`Playoff projection: where ${t[2]} stand${nfl ? "" : "s"} at the quarter mark`, `${nfl ? "Playoff" : "CFP"} picture after five weeks.`],
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
