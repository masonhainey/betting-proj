// News tab: headlines + observed line moves.

import { americanToDecimal } from "../odds.js";
import { betStatus } from "../grade.js";
import { TAGS, mentionsTeam } from "../news.js";
import { esc, ago, relDay, logo, icons } from "../ui.js";
import { chip, errorBox, skeleton } from "../render.js";
import { S, SP, game } from "../state.js";

// ── News ──

export function viewNews() {
  const st = S.st.news;
  const myTeams = new Map();
  for (const b of S.bets) {
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      const g = game(l.gameId);
      if (g) [g.home, g.away].forEach((t) => myTeams.set(t.id, t));
    }
  }
  const f = S.f.news;
  const moves = lineMoves();
  let arts = S.news;
  if (f === "mine") arts = arts.filter((a) => [...myTeams.values()].some((t) => mentionsTeam(a, t)));
  else if (f !== "all" && f !== "move") arts = arts.filter((a) => a.tags.includes(f));
  const counts = Object.fromEntries(Object.keys(TAGS).map((k) => [k, S.news.filter((a) => a.tags.includes(k)).length]));
  counts.move = moves.length;
  const head = `<div class="view-h"><div><div class="eyebrow">${SP().label} wire</div><h1>News & moves</h1><p class="muted">Injuries, line movement, pressers and look-aheads · <span class="upd">${st.loading ? "updating…" : `updated <span data-ago="${st.at || 0}">${ago(st.at)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="news" aria-label="Refresh">${icons.refresh}</button></div>
    <div class="chips scroll">
      ${chip("All", "news-f", "all", f === "all")}
      ${myTeams.size ? chip(`My teams`, "news-f", "mine", f === "mine") : ""}
      ${Object.entries(TAGS).map(([k, v]) => (counts[k] ? chip(`${v} <em>${counts[k]}</em>`, "news-f", k, f === k) : "")).join("")}
    </div>`;
  const movesHtml = (f === "all" || f === "move") && moves.length
    ? `<section class="moves"><div class="sec-h"><h2>Line moves we've seen</h2><span class="muted">tracked since you started watching</span></div>
       <div class="move-list">${moves.slice(0, f === "move" ? 50 : 6).map(moveCard).join("")}</div></section>`
    : f === "move" ? `<div class="empty">No line moves spotted yet. hedgehog compares every refresh against the last number it saw.</div>` : "";
  if (f === "move") return head + movesHtml;
  const body = arts.length
    ? `<div class="news-list">${arts.map(newsCard).join("")}</div>`
    : st.error ? errorBox("News feed unavailable", st.error, "news") : st.at ? `<div class="empty">No stories in this bucket right now.</div>` : skeleton(5, "row");
  return head + movesHtml + (f === "all" && moves.length ? `<div class="sec-h"><h2>Headlines</h2></div>` : "") + body;
}

export function lineMoves() {
  const out = [];
  for (const [id, L] of Object.entries(S.lines)) {
    const g = game(id);
    if (!g || g.state !== "pre") continue;
    const f = L.first, l = L.last;
    const parts = [];
    if (f.s != null && l.s != null && f.s !== l.s) parts.push({ k: "Spread", from: spreadTxt(g, f.s), to: spreadTxt(g, l.s), size: Math.abs(l.s - f.s) });
    if (f.t != null && l.t != null && f.t !== l.t) parts.push({ k: "Total", from: `${f.t}`, to: `${l.t}`, size: Math.abs(l.t - f.t) });
    if (f.mh != null && l.mh != null && f.mh !== l.mh) parts.push({ k: `${g.home.abbr} ML`, from: fmtA(f.mh), to: fmtA(l.mh), size: Math.abs(americanToDecimal(l.mh) - americanToDecimal(f.mh)) });
    if (parts.length) out.push({ g, L, parts, size: Math.max(...parts.map((p) => p.size)) });
  }
  return out.sort((a, b) => b.L.la - a.L.la);
}
export const fmtA = (n) => (n > 0 ? `+${n}` : `${n}`);
export const spreadTxt = (g, h) => (h === 0 ? "PK" : h < 0 ? `${g.home.abbr} ${h}` : `${g.away.abbr} ${-h}`);

export function moveCard(m) {
  return `<button class="move" data-act="open-game" data-id="${m.g.id}">
    <span class="mv-teams">${logo(m.g.away, 20)}${logo(m.g.home, 20)}<b>${esc(m.g.shortName)}</b><small>${esc(relDay(m.g.date))}</small></span>
    ${m.parts.map((p) => `<span class="mv-part"><small>${esc(p.k)}</small>${esc(p.from)} <span class="arr">→</span> <b>${esc(p.to)}</b></span>`).join("")}
    <span class="muted mv-when" data-ago="${m.L.la}">${ago(m.L.la)}</span>
  </button>`;
}

export function newsCard(a) {
  const tags = a.tags.filter((t) => TAGS[t]).map((t) => `<span class="tag t-${t}">${TAGS[t]}</span>`).join("");
  const inner = `${a.image ? `<img class="nimg" src="${esc(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="nbody"><div class="ntags">${tags}<span class="muted">${esc(ago(new Date(a.published).getTime()))}</span></div>
    <h3>${esc(a.headline)}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ""}
    ${a.teams?.length ? `<div class="nteams">${a.teams.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}</div>
    ${a.url ? `<span class="next">${icons.ext}</span>` : ""}`;
  return a.url ? `<a class="news" href="${esc(a.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="news">${inner}</div>`;
}
