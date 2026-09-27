// Apple Sports–style field graphic for live games: end zones in team colors, the line of
// scrimmage, the line to gain, and the ball (with the offense's direction). The ball glides
// to its new spot when the score feed moves it, and scores flash across the field.

import { fieldState } from "./field.js";
import { esc } from "./ui.js";

const seen = new Map(); // gameId → { x, from, movedAt, play, playAt }
const ANIM_MS = 1400;
const FLASH_MS = 6000;

// ESPN colors are sometimes near-black or near-white; keep end zones readable on turf.
function zoneColor(t) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(t.color || "")?.[1];
  if (!hex) return "#3a3548";
  const n = parseInt(hex, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.08 ? "#2b2b33" : lum > 0.92 ? "#cfcfd6" : `#${hex}`;
}
const inkOn = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? "#111" : "#fff";
};

/** Track movement between refreshes so the ball can glide instead of jumping. */
function motion(g, f) {
  const now = Date.now();
  let r = seen.get(g.id);
  if (!r) seen.set(g.id, (r = { x: f.x, from: f.x, movedAt: 0, play: g.situation?.lastPlay || "", playAt: 0 }));
  if (r.x !== f.x) Object.assign(r, { from: r.x, x: f.x, movedAt: now });
  const play = g.situation?.lastPlay || "";
  if (play !== r.play) Object.assign(r, { play, playAt: now });
  return {
    dx: now - r.movedAt < ANIM_MS ? r.from - r.x : 0,
    fresh: now - r.playAt < FLASH_MS && r.playAt > 0,
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

/**
 * The field for a live game, or "" when there's no ball position. size: "sm" (score cards)
 * or "lg" (game sheet).
 */
export function fieldGraphic(g, size = "sm") {
  const f = fieldState(g);
  if (!f) return "";
  const lg = size === "lg";
  const W = 120, H = lg ? 44 : 20; // 10-yard end zones + 100-yard field
  const X = (yd) => 10 + yd;
  const { dx, fresh } = motion(g, f);
  const away = zoneColor(g.away), home = zoneColor(g.home);
  const lines = [];
  for (let yd = 5; yd < 100; yd += 5) lines.push(`<line x1="${X(yd)}" y1="0" x2="${X(yd)}" y2="${H}" class="yl${yd % 10 ? " minor" : ""}${yd === 50 ? " mid" : ""}"/>`);
  // Text sits outside the stretched SVG so it never distorts.
  const nums = lg ? [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => `<span class="ynum" style="left:${((X(yd) / W) * 100).toFixed(2)}%">${yd > 50 ? 100 - yd : yd}</span>`).join("") : "";
  const rzFrom = f.dir > 0 ? 80 : 0;
  const bx = X(f.x);
  const pct = (x) => `${((x / W) * 100).toFixed(2)}%`;
  const flash = fresh ? flashFor(g) : null;
  const flashColor = flash?.team ? zoneColor(flash.team) : "#a78bfa";
  const zone = (x, c) => `<rect x="${x}" y="0" width="10" height="${H}" fill="${c}"/>`;
  const ezLabel = (side, c, t) => (lg ? `<span class="ez ${side}" style="color:${inkOn(c)}">${esc(t.abbr)}</span>` : "");
  return `<div class="field ${lg ? "lg" : "sm"} ${f.redZone ? "rz" : ""}" role="img" aria-label="${esc(`${f.offense.short} ball${f.label ? `, ${f.label}` : ""}, ${f.toGoal} yards to the end zone`)}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <rect x="0" y="0" width="${W}" height="${H}" class="turf"/>
      ${f.redZone ? `<rect x="${X(rzFrom)}" y="0" width="20" height="${H}" class="rzone"/>` : ""}
      ${zone(0, away)}${zone(110, home)}
      ${lines.join("")}
      ${f.firstDown != null && f.firstDown > 0 && f.firstDown < 100 ? `<line x1="${X(f.firstDown)}" y1="0" x2="${X(f.firstDown)}" y2="${H}" class="ltg"/>` : ""}
    </svg>
    ${nums}${ezLabel("l", away, g.away)}${ezLabel("r", home, g.home)}
    <span class="ball ${dx ? "moving" : ""}" style="left:${pct(bx)};--from:${pct(bx + dx)}">
      <i class="los"></i><i class="pig"></i><i class="arrow ${f.dir > 0 ? "r" : "l"}"></i>
    </span>
    ${flash ? `<span class="flash" style="--fc:${flashColor};--fi:${inkOn(flashColor)}">${esc(flash.text)}</span>` : ""}
  </div>`;
}

/** The line under the big field: "KC ball · 2nd & 7 at KC 35 · 65 yds to go". */
export function fieldCaption(g) {
  const f = fieldState(g);
  if (!f) return "";
  const s = g.situation;
  const bits = [`<b>${esc(f.offense.abbr)} ball</b>`, f.label ? `${esc(f.label)}${s.spotText ? ` at ${esc(s.spotText)}` : ""}` : "", `${f.toGoal} yds to the end zone`];
  const to = (n) => (Number.isFinite(n) ? `<span class="tos">${[0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>` : "");
  const tos = Number.isFinite(s.awayTimeouts) || Number.isFinite(s.homeTimeouts) ? `<span class="to-row"><span class="muted">Timeouts</span> ${esc(g.away.abbr)} ${to(s.awayTimeouts)} ${esc(g.home.abbr)} ${to(s.homeTimeouts)}</span>` : "";
  return `<div class="field-cap">${bits.filter(Boolean).join(" · ")}${tos}</div>`;
}
