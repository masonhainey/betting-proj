// The extra detail behind a game's page (ESPN's game summary / Gamecast feed): player box
// score, the current drive and its latest plays, and live win probability. Pure — tested.

import { parseBox } from "./props.js";
import { parsePregame } from "./model/live.js";

export function parseSummary(s) {
  const box = parseBox(s);
  const cur = s?.drives?.current;
  const drive = cur
    ? {
        teamId: String(cur.team?.id ?? ""),
        desc: String(cur.description || ""),
        startText: String(cur.start?.text || ""),
        plays: (Array.isArray(cur.plays) ? cur.plays : []).slice(-5).reverse().map((p) => ({
          text: String(p.text || ""),
          clock: String(p.clock?.displayValue || ""),
          period: Number(p.period?.number) || 0,
          type: String(p.type?.text || ""),
          yards: Number(p.statYardage) || 0,
          scoring: !!p.scoringPlay,
        })).filter((p) => p.text),
      }
    : null;
  const wps = Array.isArray(s?.winprobability) ? s.winprobability : [];
  const wp = wps[wps.length - 1];
  const home = Number(wp?.homeWinPercentage);
  const tie = Number(wp?.tiePercentage) || 0;
  const winProb = Number.isFinite(home) && home >= 0 && home <= 1 ? { home, away: Math.max(0, 1 - home - tie) } : null;
  return { box, drive, winProb, pre: parsePregame(s) };
}
