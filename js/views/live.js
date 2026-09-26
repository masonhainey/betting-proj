// Live tab: today's scoreboard.

import { esc, fmtDayLong, ago, statusText, icons, rankedBadge } from "../ui.js";
import { chip, errorBox, lineSummary, myActionCount, scoreRows, skeleton, staleNote } from "../render.js";
import { S, game } from "../state.js";

// ── Live ──

export function viewLive() {
  const all = S.todayIds.map(game).filter(Boolean);
  const f = S.f.live;
  const filtered = all.filter((g) =>
    f === "live" ? g.state === "in" : f === "mine" ? myActionCount(g.id) > 0 : f === "top25" ? g.home.rank || g.away.rank : true
  );
  const order = { in: 0, pre: 1, post: 2 };
  filtered.sort((a, b) => order[a.state] - order[b.state] || (myActionCount(b.id) - myActionCount(a.id)) || new Date(a.date) - new Date(b.date));
  const live = filtered.filter((g) => g.state === "in"), pre = filtered.filter((g) => g.state === "pre"), post = filtered.filter((g) => g.state === "post");
  const st = S.st.today;
  const head = `<div class="view-h">
    <div><div class="eyebrow">Scoreboard</div><h1>${esc(fmtDayLong(new Date()))}</h1>
      <p class="muted">${all.filter((g) => g.state === "in").length} live · ${all.length} FBS games · <span class="upd">${st.loading ? "updating…" : `updated <span data-ago="${st.at || 0}">${ago(st.at)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="today" aria-label="Refresh">${icons.refresh}</button>
  </div>
  <div class="chips">${chip("All", "live-f", "all", f === "all")}${chip(`<span class="dot live"></span>Live`, "live-f", "live", f === "live")}${chip("My action", "live-f", "mine", f === "mine")}${chip("Top 25", "live-f", "top25", f === "top25")}</div>`;
  if (st.error && !all.length) return head + errorBox("Couldn't reach the scoreboard", st.error, "today");
  if (!all.length) return head + (st.at ? `<div class="empty">No FBS games today. Check <a href="#schedule" data-act="tab" data-v="schedule">Upcoming</a>.</div>` : skeleton(6));
  const sec = (title, gs) => (gs.length ? `<div class="sec-h"><h2>${title}</h2><span class="muted">${gs.length}</span></div><div class="grid-cards">${gs.map(liveCard).join("")}</div>` : "");
  return head + (st.error ? staleNote(st) : "") + sec(`<span class="dot live"></span>Live now`, live) + sec("Later today", pre) + sec("Final", post) + (filtered.length ? "" : `<div class="empty">Nothing matches that filter.</div>`);
}

export function liveCard(g) {
  const mine = myActionCount(g.id);
  const sit = g.state === "in" && g.situation;
  return `<article class="gcard ${g.state} ${sit?.redZone ? "rz" : ""} ${mine ? "mine" : ""}" data-act="open-game" data-id="${g.id}" tabindex="0">
    <header><span class="gstatus">${g.state === "in" ? `<span class="dot live"></span>` : ""}${esc(statusText(g))}</span>${g.tv ? `<span class="tv">${esc(g.tv)}</span>` : ""}<span class="grow"></span>${rankedBadge(g, true)}${mine ? `<span class="badge mine">${mine} bet${mine > 1 ? "s" : ""}</span>` : ""}</header>
    <div class="teams">${scoreRows(g)}</div>
    ${sit ? `<div class="sit">${sit.redZone ? `<span class="badge rz">Red zone</span>` : ""}${sit.downDistance ? `<span>${esc(sit.downDistance)}</span>` : ""}${sit.lastPlay ? `<span class="lp">${esc(sit.lastPlay)}</span>` : ""}</div>` : ""}
    ${g.odds && g.state !== "post" ? `<footer class="muted">${lineSummary(g)}</footer>` : ""}
  </article>`;
}
