// Game detail sheet.

import { americanToDecimal, noVig, fmtPct, fmtLine } from "../odds.js";
import { mentionsTeam } from "../news.js";
import { esc, fmtDay, fmtDayTime, ago, logo, statusText, icons, rankedBadge } from "../ui.js";
import { markets } from "../market.js";
import { closeBtn, kickBadge, lineSummary, scoreRows, selBtn } from "../render.js";
import { S, game } from "../state.js";
import { fieldDetail, fieldGraphic } from "../fieldview.js";
import { betCard } from "../views/bets.js";
import { fmtA, newsCard, spreadTxt } from "../views/news.js";

// ───────────────────────────── sheets ─────────────────────────────

export function sheetGame() {
  const g = game(S.sheet.id);
  if (!g) return `<div class="sheet-h"><h2>Game</h2>${closeBtn()}</div><p class="muted">Game not found.</p>`;
  const m = markets(g);
  const L = S.lines[g.id];
  const k = S.kick[g.id];
  const myBets = S.bets.filter((b) => b.legs.some((l) => l.gameId === g.id));
  const related = S.news.filter((a) => mentionsTeam(a, g.home) || mentionsTeam(a, g.away)).slice(0, 4);
  const o = g.odds;
  const fair = o?.ml?.home && o?.ml?.away ? noVig(americanToDecimal(o.ml.home), americanToDecimal(o.ml.away)) : null;
  return `<div class="sheet-h"><h2>${esc(g.shortName)}</h2>${closeBtn()}</div>
    <div class="gsheet-top ${g.state}">
      <div class="gs-status">${g.state === "in" ? `<span class="dot live"></span>` : ""}${esc(g.state === "pre" ? (g.timeValid ? fmtDayTime(g.date) : `${fmtDay(g.date)} · TBD`) : g.detail || statusText(g))}</div>
      <div class="teams lg">${scoreRows(g, { big: true })}</div>
      ${fieldGraphic(g, "lg", S.detail[g.id])}${fieldDetail(g, S.detail[g.id])}
      <div class="gs-meta">${[g.tv, g.venue, g.city, g.notes].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="stags">${rankedBadge(g)}${kickBadge(g)}</div>
    </div>
    ${m ? `<h3 class="sh3">Markets <small>${esc(o.provider)}${S.sim ? " · sim on" : ""}</small></h3>
      <div class="mk-grid">
        <span></span><span class="mk-h">Spread</span><span class="mk-h">Total</span><span class="mk-h">Money</span>
        <span class="mk-t">${logo(g.away, 20)}${esc(g.away.abbr)}</span>${selBtn(m.spreadAway, fmtLine(m.spreadAway?.line))}${selBtn(m.over, m.over ? `O ${m.over.line}` : "")}${selBtn(m.mlAway, "")}
        <span class="mk-t">${logo(g.home, 20)}${esc(g.home.abbr)}</span>${selBtn(m.spreadHome, fmtLine(m.spreadHome?.line))}${selBtn(m.under, m.under ? `U ${m.under.line}` : "")}${selBtn(m.mlHome, "")}
      </div>
      ${fair ? `<p class="muted small">No-vig win chance: ${esc(g.away.abbr)} ${fmtPct(fair.p2, 0)} · ${esc(g.home.abbr)} ${fmtPct(fair.p1, 0)} · book hold ${fmtPct(fair.hold)}</p>` : ""}` : g.odds ? `<p class="muted">Line at close: ${lineSummary(g)}</p>` : ""}
    ${L && (L.moves?.length || L.fa < L.la) ? `<h3 class="sh3">Line history</h3><ul class="hist">
      <li><span class="muted">First seen ${esc(ago(L.fa))}</span> ${esc(snapTxt(g, L.first))}</li>
      ${(L.moves || []).map((mv) => `<li><span class="muted">${esc(ago(mv.at))}</span> ${esc(snapTxt(g, mv.to))}</li>`).join("")}
    </ul>` : ""}
    ${k?.at ? `<h3 class="sh3">Kickoff</h3><p class="muted">Moved from ${esc(k.ptv === false ? "TBD" : fmtDayTime(k.pd))} to <b>${esc(fmtDayTime(k.d))}</b> (spotted ${esc(ago(k.at))}).</p>` : ""}
    ${myBets.length ? `<h3 class="sh3">Your bets</h3><div class="bet-list">${myBets.map(betCard).join("")}</div>` : ""}
    ${related.length ? `<h3 class="sh3">Related news</h3><div class="news-list compact">${related.map(newsCard).join("")}</div>` : ""}
    ${g.state === "pre" ? `<button class="btn block" data-act="add-for-game" data-id="${g.id}">${icons.plus} Log a pick on this game</button>` : ""}`;
}

export const snapTxt = (g, s) => [s.s != null ? spreadTxt(g, s.s) : "", s.t != null ? `O/U ${s.t}` : "", s.mh != null ? `${g.home.abbr} ${fmtA(s.mh)}` : ""].filter(Boolean).join(" · ");
