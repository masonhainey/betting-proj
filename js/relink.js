// Legs saved without a game (typed by hand, or a slip line that didn't match a game at
// import time) can't settle themselves. This links them to their game after the fact, so
// "UCLA +3.5" grades on its own once the final is in. Pure — unit-tested.

import { betStatus } from "./grade.js";
import { PROPISH, linkPick } from "./slipparse.js";

const GRADEABLE = new Set(["ml", "spread", "total"]);

export const needsLink = (leg) => leg.status === "open" && !PROPISH.test(leg.pick || "") && (!leg.gameId || !GRADEABLE.has(leg.market));

/**
 * Link every open, unlinked leg it can. `games` is a list of normalized games. Only
 * matches to games near when the bet was placed (from 12h before to 14 days after) count.
 * Returns the legs it changed as [{ bet, leg }].
 */
export function relinkLegs(bets, games) {
  const changed = [];
  for (const bet of bets) {
    if (betStatus(bet) !== "open" || !Array.isArray(bet.legs)) continue;
    for (const leg of bet.legs) {
      if (!needsLink(leg)) continue;
      const placed = Date.parse(bet.createdAt) || Date.now();
      const pool = leg.gameId
        ? games.filter((g) => g.id === leg.gameId)
        : games.filter((g) => {
            const t = Date.parse(g.date);
            return t >= placed - 12 * 3600e3 && t <= placed + 14 * 864e5;
          });
      if (!pool.length) continue;
      const m = linkPick(leg.pick, pool, leg.gameLabel || "", Date.parse(leg.kickoff) || placed);
      if (!m || !GRADEABLE.has(m.market) || (m.market !== "total" && !m.side)) continue;
      const g = pool.find((x) => x.id === m.gameId);
      Object.assign(leg, m, { gameLabel: g.shortName, kickoff: g.date, autoLinked: true });
      if (m.line === undefined) delete leg.line;
      changed.push({ bet, leg });
    }
  }
  return changed;
}
