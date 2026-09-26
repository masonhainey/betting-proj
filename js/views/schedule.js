// Upcoming tab: next four weeks, grouped by day.

import { addDays } from "../espn.js";

import { esc, tzAbbr, fmtTime, fmtDay, dayKey, startOfDay, ago, relDay, logo, rank, icons, rankedBadge, winProb, pct, wpBar } from "../ui.js";
import { chip, errorBox, kickBadge, lineSummary, myActionCount, skeleton, staleNote } from "../render.js";
import { S, game } from "../state.js";

// ── Schedule ──

export function viewSchedule() {
  const st = S.st.schedule;
  const q = S.f.q.trim().toLowerCase();
  let gs = S.scheduleIds.map(game).filter(Boolean);
  const total = gs.length;
  if (S.f.top25) gs = gs.filter((g) => g.home.rank || g.away.rank);
  if (S.f.hasLine) gs = gs.filter((g) => g.odds);
  if (q) gs = gs.filter((g) => `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr} ${g.tv}`.toLowerCase().includes(q));
  gs.sort((a, b) => new Date(a.date) - new Date(b.date) || (a.timeValid ? 0 : 1) - (b.timeValid ? 0 : 1));
  const moved = gs.filter((g) => kickBadge(g)).length;
  const days = new Map();
  for (const g of gs) {
    const k = dayKey(g.date);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(g);
  }
  const from = addDays(startOfDay(), 1);
  const head = `<div class="view-h">
    <div><div class="eyebrow">Next four weeks</div><h1>Upcoming</h1>
      <p class="muted">From ${esc(fmtDay(from))} · next 4 weeks · times in ${esc(tzAbbr)} · <span class="upd">${st.loading ? "checking for changes…" : `checked <span data-ago="${st.at || st.cachedAt || 0}">${ago(st.at || st.cachedAt)}</span>`}</span></p></div>
    <button class="icon-btn" data-act="refresh" data-v="schedule" aria-label="Refresh">${icons.refresh}</button>
  </div>
  <div class="toolbar">
    <label class="search">${icons.search}<input id="sched-q" data-in="sched-q" type="search" placeholder="Team or network" value="${esc(S.f.q)}" autocomplete="off"></label>
    ${chip("Top 25", "sched-top25", "", S.f.top25)}${chip("Has line", "sched-line", "", S.f.hasLine)}
  </div>
  ${moved ? `<div class="notice">${icons.clock}<span><b>${moved} kickoff${moved > 1 ? "s" : ""} changed</b> since you last looked — marked below.</span></div>` : ""}`;
  if (!total) {
    if (st.error) return head + errorBox("Schedule feed didn't respond", st.error, "schedule");
    return head + (st.at ? `<div class="empty">No games posted for the next four weeks yet.</div>` : skeleton(8, "row"));
  }
  const warn = st.error ? staleNote(st) : st.failedDays?.length ? `<div class="notice warn">Some days didn't load (${st.failedDays.length}); showing what we had. Retrying automatically.</div>` : "";
  const body = [...days.entries()].map(([k, list]) => `
    <section class="day">
      <h2 class="day-sticky"><span>${esc(relDay(list[0].date))}${relDay(list[0].date) !== fmtDay(list[0].date) ? ` <em>${esc(fmtDay(list[0].date))}</em>` : ""}</span><span class="muted">${list.length} game${list.length > 1 ? "s" : ""}</span></h2>
      <div class="rows">${list.map(schedRow).join("")}</div>
    </section>`).join("");
  return head + warn + (gs.length ? body : `<div class="empty">No games match.</div>`);
}

export function schedRow(g) {
  const mine = myActionCount(g.id);
  const wp = winProb(g);
  const team = (t, side) => {
    const p = wp?.[side];
    return `<span class="steam">${logo(t, 26)}<span class="sname">${rank(t)}<b>${esc(t.short)}</b>${t.record ? `<small>${esc(t.record)}</small>` : ""}</span><span class="wp ${p != null && p >= 0.5 ? "fav" : ""}">${p != null ? pct(p) : "—"}</span></span>`;
  };
  const tags = [rankedBadge(g), kickBadge(g), mine ? `<span class="badge mine">${mine} bet${mine > 1 ? "s" : ""}</span>` : ""].join("");
  return `<button class="srow ${g.home.rank && g.away.rank ? "ranked" : ""}" data-act="open-game" data-id="${g.id}">
    <span class="stime">${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}${g.tv ? `<small>${esc(g.tv)}</small>` : ""}</span>
    <span class="smatch">
      ${team(g.away, "away")}${team(g.home, "home")}
      ${wpBar(g, wp)}
      ${tags.trim() ? `<span class="stags">${tags}</span>` : ""}
    </span>
    <span class="sline">${lineSummary(g) || `<span class="muted">No line yet</span>`}${g.neutral ? `<small>Neutral site</small>` : ""}</span>
  </button>`;
}
