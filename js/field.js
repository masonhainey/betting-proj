// Where the ball is, for the field graphic. Pure — unit-tested.
//
// Field coordinates run 0–100 from the AWAY end zone (left) to the HOME end zone (right).
// The away team drives right (+1), the home team drives left (−1).

const ORD = ["", "1st", "2nd", "3rd", "4th"];

/** "KC 35" → { abbr: "KC", yd: 35 }, "50" → { abbr: null, yd: 50 }. */
export function parseSpot(text) {
  const m = /^\s*(?:([A-Za-z&.' ]{1,12}?)\s+)?(\d{1,2})\s*$/.exec(String(text || ""));
  if (!m) return null;
  const yd = Number(m[2]);
  if (!(yd >= 0 && yd <= 50)) return null;
  return { abbr: m[1] ? m[1].trim().toUpperCase() : null, yd };
}

/**
 * The field picture for a live game, or null when ESPN hasn't said where the ball is.
 * Returns { x, dir, firstDown, goal, offense, defense, redZone, down, distance, label }.
 */
export function fieldState(g) {
  const s = g?.state === "in" ? g.situation : null;
  // Between plays ESPN sometimes drops `possession`; the team on the last play is next best.
  const poss = s?.possession || s?.lastPlayTeam;
  if (!poss) return null;
  const offense = [g.home, g.away].find((t) => t.id === poss);
  if (!offense) return null;
  const isHome = offense === g.home;
  const defense = isHome ? g.away : g.home;
  const dir = isHome ? -1 : 1;
  let x = null;
  const spot = parseSpot(s.spotText);
  if (spot) {
    if (spot.yd === 50 || !spot.abbr) x = 50;
    else if (spot.abbr === g.away.abbr.toUpperCase()) x = spot.yd;
    else if (spot.abbr === g.home.abbr.toUpperCase()) x = 100 - spot.yd;
  }
  if (x == null && Number.isFinite(s.toEndzone) && s.toEndzone >= 0 && s.toEndzone <= 100) x = isHome ? s.toEndzone : 100 - s.toEndzone;
  if (x == null) return null;
  const toGoal = isHome ? x : 100 - x;
  const distance = Number.isFinite(s.distance) && s.distance > 0 ? s.distance : null;
  const goal = distance != null && distance >= toGoal;
  const firstDown = distance == null || goal ? null : x + dir * distance;
  const down = s.down >= 1 && s.down <= 4 ? s.down : null;
  const label = down ? `${ORD[down]} & ${goal ? "Goal" : distance ?? "?"}` : "";
  return { x, dir, firstDown, goal, offense, defense, redZone: !!s.redZone || toGoal <= 20, toGoal, down, distance, label };
}
