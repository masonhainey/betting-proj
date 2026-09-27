// Apple Sports–style field for live games. Built from plain HTML/CSS (no stretched SVG), so
// lines stay crisp at any size. Small version on score cards, detailed one on a game's page
// with yard numbers, hash marks, the drive so far, plays and win probability.

import { fieldState, parseSpot } from "./field.js";
import { esc, logo } from "./ui.js";

const seen = new Map(); // gameId → { f, x, from, movedAt, play, playAt }
const ANIM_MS = 1400;
const FLASH_MS = 6000;

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
// ESPN colors are sometimes near-black or near-white; keep end zones readable.
export function teamColor(t) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(t?.color || "")?.[1];
  if (!hex) return "#4b4560";
  const c = `#${hex}`;
  const l = lum(c);
  return l < 0.07 ? "#34323d" : l > 0.93 ? "#c9c7d1" : c;
}
const inkOn = (c) => (lum(c) > 0.6 ? "#111" : "#fff");

/** Remember the last good position so a gap in ESPN's feed doesn't blank the field. */
function track(g) {
  const now = Date.now();
  const f = fieldState(g);
  let r = seen.get(g.id);
  if (!r) seen.set(g.id, (r = { f: null, x: null, from: null, movedAt: 0, play: g.situation?.lastPlay || "", playAt: 0 }));
  if (f) {
    if (r.x != null && r.x !== f.x) Object.assign(r, { from: r.x, movedAt: now });
    Object.assign(r, { f, x: f.x });
  }
  const play = g.situation?.lastPlay || "";
  if (play && play !== r.play) Object.assign(r, { play, playAt: now });
  return {
    f: f || r.f,
    stale: !f && !!r.f,
    from: now - r.movedAt < ANIM_MS ? r.from : null,
    fresh: r.playAt > 0 && now - r.playAt < FLASH_MS,
  };
}

function flashFor(g) {
  const s = g.situation || {};
  const t = `${s.lastPlayType} ${s.lastPlay}`;
  const team = [g.home, g.away].find((x) => x.id === s.lastPlayTeam);
  if (/touchdown/i.test(t)) return { text: "TOUCHDOWN", team };
  if (/field goal good|made field goal/i.test(t)) return { text: "FIELD GOAL", team };
  if (/interception|fumble|turnover/i.test(t)) return { text: "TURNOVER", team };
  if (/safety/i.test(t)) return { text: "SAFETY", team };
  return null;
}

function waiting(g) {
  const d = `${g.shortDetail} ${g.detail}`;
  if (/half/i.test(d)) return "Halftime";
  if (/end of/i.test(d)) return d.match(/end of [^-·]+/i)?.[0].trim() || "End of quarter";
  return "Waiting for the next snap";
}

const pct = (x) => `${Math.max(0, Math.min(100, x)).toFixed(2)}%`;

/** Where the current drive started, in field coordinates (for the detailed field). */
function driveStart(g, f) {
  const d = g.detail?.drive;
  if (!d || !f || d.teamId !== f.offense.id) return null;
  const sp = parseSpot(d.startText);
  if (!sp) return null;
  if (sp.yd === 50 || !sp.abbr) return 50;
  if (sp.abbr === g.away.abbr.toUpperCase()) return sp.yd;
  if (sp.abbr === g.home.abbr.toUpperCase()) return 100 - sp.yd;
  return null;
}

/** The field for a live game. size: "sm" (score cards) or "lg" (game page). */
export function fieldGraphic(g, size = "sm", extra = null) {
  if (g?.state !== "in") return "";
  const lg = size === "lg";
  const { f, stale, from, fresh } = track(g);
  const away = teamColor(g.away), home = teamColor(g.home);
  const flash = fresh && !stale ? flashFor(g) : null;
  const inRz = f && !stale && f.redZone;
  const rzLeft = f ? (f.dir > 0 ? 80 : 0) : 0;
  const nums = lg ? [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => `<span class="gf-num" style="left:${yd}%">${yd > 50 ? 100 - yd : yd}</span>`).join("") : "";
  const ds = lg ? driveStart({ ...g, detail: extra }, f) : null;
  const ez = (c, t, side) => `<div class="gf-ez ${side}" style="--tc:${c};color:${inkOn(c)}">${lg ? `<span>${esc(t.abbr)}</span>` : ""}</div>`;
  const label = f ? `${f.offense.short} ball${f.label ? `, ${f.label}` : ""}, ${f.toGoal} yards to the end zone` : waiting(g);
  return `<div class="gf ${lg ? "lg" : "sm"} ${inRz ? "rz" : ""} ${stale ? "stale" : ""}" role="img" aria-label="${esc(label)}">
    ${ez(away, g.away, "l")}
    <div class="gf-turf">
      <i class="gf-mid"></i>${nums}
      ${inRz ? `<div class="gf-rz" style="left:${rzLeft}%"></div>` : ""}
      ${ds != null && f ? `<div class="gf-drive" style="left:${pct(Math.min(ds, f.x))};width:${pct(Math.abs(f.x - ds))};--tc:${teamColor(f.offense)}"></div>` : ""}
      ${f && f.firstDown != null && f.firstDown > 0 && f.firstDown < 100 ? `<i class="gf-ltg" style="left:${pct(f.firstDown)}"></i>` : ""}
      ${f ? `<div class="gf-ball ${from != null ? "moving" : ""}" style="left:${pct(f.x)};--from:${pct(from ?? f.x)}"><i class="gf-los"></i><i class="gf-pig ${f.dir > 0 ? "r" : "l"}"></i></div>` : `<span class="gf-msg">${esc(waiting(g))}</span>`}
    </div>
    ${ez(home, g.home, "r")}
    ${flash ? `<span class="gf-flash" style="--fc:${flash.team ? teamColor(flash.team) : "#7c5cf0"};--fi:${inkOn(flash.team ? teamColor(flash.team) : "#7c5cf0")}">${esc(flash.text)}</span>` : ""}
  </div>`;
}

/** One line under the small field: "BAL ball · 1st & 10 at BAL 35". */
export function fieldLine(g) {
  if (g?.state !== "in") return "";
  const f = fieldState(g) || seen.get(g.id)?.f;
  if (!f) return `<span class="muted">${esc(waiting(g))}</span>`;
  const s = g.situation || {};
  return `<b>${esc(f.offense.abbr)} ball</b>${f.label ? ` · ${esc(f.label)}` : ""}${s.spotText ? ` <span class="muted">at ${esc(s.spotText)}</span>` : ""}`;
}

/** Everything under the big field on a game's page. */
export function fieldDetail(g, extra) {
  if (g?.state !== "in") return "";
  const f = fieldState(g) || seen.get(g.id)?.f;
  const s = g.situation || {};
  const to = (n) => (Number.isFinite(n) ? `<span class="gf-tos" title="${n} timeout${n === 1 ? "" : "s"} left">${[0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>` : "");
  const head = f
    ? `<div class="gf-head">
        <span class="gf-poss">${logo(f.offense, 22)}<b>${esc(f.offense.abbr)} ball</b></span>
        ${f.label ? `<span class="gf-down">${esc(f.label)}</span>` : ""}
        <span class="gf-spot">${s.spotText ? `at ${esc(s.spotText)} · ` : ""}${f.toGoal} yds to the end zone</span>
      </div>`
    : `<div class="gf-head"><span class="gf-spot">${esc(waiting(g))}</span></div>`;
  const chips = [
    extra?.drive?.desc && extra.drive.teamId === f?.offense.id ? `<span class="gf-chip"><small>Drive</small>${esc(extra.drive.desc.replace(/,\s*/g, " · "))}</span>` : "",
    Number.isFinite(s.awayTimeouts) || Number.isFinite(s.homeTimeouts) ? `<span class="gf-chip"><small>Timeouts</small>${esc(g.away.abbr)} ${to(s.awayTimeouts)} ${esc(g.home.abbr)} ${to(s.homeTimeouts)}</span>` : "",
  ].filter(Boolean).join("");
  const wp = extra?.winProb;
  const wpBar = wp
    ? `<div class="gf-wp"><div class="gf-wp-h"><span>${logo(g.away, 16)}${esc(g.away.abbr)} <b>${Math.round(wp.away * 100)}%</b></span><small>Win probability</small><span><b>${Math.round(wp.home * 100)}%</b> ${esc(g.home.abbr)}${logo(g.home, 16)}</span></div>
        <div class="gf-wp-bar"><i style="width:${pct(wp.away * 100)};background:${teamColor(g.away)}"></i><i style="width:${pct(wp.home * 100)};background:${teamColor(g.home)}"></i></div></div>`
    : "";
  const plays = extra?.drive?.plays?.length
    ? `<ol class="gf-plays">${extra.drive.plays.map((p) => `<li class="${p.scoring ? "score" : ""}"><span class="gf-clk">${p.period ? `Q${p.period > 4 ? "OT" : p.period}` : ""}${p.clock ? ` ${esc(p.clock)}` : ""}</span><span>${esc(p.text.replace(/^Demo:\s*/, ""))}</span>${p.yards ? `<b class="${p.yards > 0 ? "up" : "down"}">${p.yards > 0 ? "+" : ""}${p.yards}</b>` : ""}</li>`).join("")}</ol>`
    : s.lastPlay ? `<p class="gf-last">${esc(s.lastPlay)}</p>` : "";
  return `<div class="gf-info">${head}${chips ? `<div class="gf-chips">${chips}</div>` : ""}${wpBar}${plays}</div>`;
}
