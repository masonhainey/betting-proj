// Top-level render, sheets host, status painting, and shared UI components.

import { fmtMoney } from "./odds.js";
import { betStatus } from "./grade.js";
import { esc, fmtTime, fmtDayTime, ago, logo, rank, icons, winProb, pct, wpBar } from "./ui.js";
import { slipCalc } from "./market.js";
import { sheetAdd } from "./sheets/add.js";
import { sheetBet } from "./sheets/bet.js";
import { sheetGame } from "./sheets/game.js";
import { sheetImport } from "./sheets/import.js";
import { sheetSettings } from "./sheets/settings.js";
import { $, $$, S, fmt, odds, settings, swap } from "./state.js";
import { viewBets } from "./views/bets.js";
import { slipHtml, viewBuild } from "./views/build.js";
import { viewLive } from "./views/live.js";
import { viewNews } from "./views/news.js";
import { viewSchedule } from "./views/schedule.js";

// ───────────────────────────── rendering ─────────────────────────────

export function render() {
  document.body.dataset.tab = S.tab;
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.tab === S.tab));
  $("#fmt-toggle").innerHTML = fmtToggle("set-fmt");
  $("#demo-flag").hidden = !settings.demo;
  const views = { bets: viewBets, live: viewLive, schedule: viewSchedule, build: viewBuild, news: viewNews };
  swap($("#view"), views[S.tab]());
  paintDock();
  renderSheet();
}

export function renderSheet() {
  const root = $("#sheet");
  if (!S.sheet) {
    root.hidden = true;
    root.innerHTML = "";
    document.body.classList.remove("sheet-open");
    return;
  }
  const k = S.sheet.kind;
  // Forms render once and update in place; live sheets re-render every refresh.
  if (root.dataset.kind === k && root.dataset.key === (S.sheet.id || "") && (k === "add" || k === "settings" || k === "import") && !S.sheet.dirty) return;
  S.sheet.dirty = false;
  const body = { add: sheetAdd, bet: sheetBet, game: sheetGame, settings: sheetSettings, import: sheetImport, slip: () => `<div class="sheet-h"><h2>Bet slip</h2>${closeBtn()}</div>${slipHtml()}` }[k]();
  root.dataset.kind = k;
  root.dataset.key = S.sheet.id || "";
  if (root.hidden) {
    root.hidden = false;
    root.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div><div class="panel-body" id="sheet-body"></div></div>`;
    document.body.classList.add("sheet-open");
  }
  swap($("#sheet-body"), body);
}

export const closeBtn = () => `<button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.x}</button>`;

export function openSheet(sheet) {
  S.sheet = { ...sheet, dirty: true };
  const root = $("#sheet");
  root.dataset.kind = "";
  render();
}

export function paintStatus() {
  const el = $("#sync");
  if (!el) return;
  const busy = Object.values(S.st).some((s) => s.loading);
  const err = S.st.today.error && S.st.schedule.error;
  el.className = `sync ${busy ? "busy" : err ? "err" : "ok"}`;
  el.title = err ? `Feed error: ${S.st.today.error}` : `Scores updated ${ago(S.st.today.at)}`;
}

export function paintAgo() {
  $$("[data-ago]").forEach((el) => (el.textContent = ago(Number(el.dataset.ago))));
  paintStatus();
}

export function paintDock() {
  const dock = $("#dock");
  const n = S.slip.legs.length;
  if (!n || S.sheet?.kind === "slip") {
    dock.hidden = true;
    return;
  }
  const c = slipCalc();
  dock.hidden = false;
  const label = S.slip.mode === "parlay" && n > 1 ? `${n}-leg parlay · ${odds(c.parlayOdds)}` : `${n} selection${n > 1 ? "s" : ""}`;
  const right = S.slip.mode === "parlay" && n > 1 ? (c.stake ? `Win ${fmtMoney(c.win)}` : "") : c.singlesRisk ? `Win ${fmtMoney(c.singlesWin)}` : "";
  dock.innerHTML = `<button class="dock-btn" data-act="open-slip"><span class="dock-n">${n}</span><span class="dock-l">${esc(label)}</span><span class="dock-r">${right}</span></button>`;
}

// ── shared components ──

export const fmtToggle = (act) =>
  `<div class="seg sm" role="group" aria-label="Odds format">
    <button class="${fmt() === "american" ? "on" : ""}" data-act="${act}" data-v="american" title="American odds (+150 / -110)">US ±</button>
    <button class="${fmt() === "decimal" ? "on" : ""}" data-act="${act}" data-v="decimal" title="Decimal odds (2.50)">Dec ×</button>
  </div>`;

export const chip = (label, act, v, on, extra = "") => `<button class="chip ${on ? "on" : ""}" data-act="${act}" data-v="${esc(v)}" ${extra}>${label}</button>`;

export const pill = (st) => {
  const map = { open: "Open", won: "Won", lost: "Lost", push: "Push", void: "Void", cashout: "Cashed out", winning: "Winning", losing: "Losing", even: "Even", pending: "Pending", live: "Live" };
  return `<span class="pill ${st}">${map[st] || st}</span>`;
};

export function myActionCount(gid) {
  return S.bets.filter((b) => betStatus(b) === "open" && b.legs.some((l) => l.gameId === gid && l.status === "open")).length;
}

export function scoreRows(g, { big = false } = {}) {
  const wp = g.state === "pre" ? winProb(g) : null;
  const row = (t, side) => {
    const poss = g.state === "in" && g.situation?.possession === t.id;
    const lead = g.state !== "pre" && t.score != null && t.score > (side === "home" ? g.away.score : g.home.score);
    const p = wp?.[side];
    const slot = g.state === "pre"
      ? `<span class="wp ${p != null && p >= 0.5 ? "fav" : ""}" title="${wp ? `Win probability (no-vig ${wp.src})` : "No line yet"}">${p != null ? pct(p) : "—"}</span>`
      : `<span class="score ${lead ? "lead" : ""}">${t.score ?? ""}</span>`;
    return `<div class="trow ${g.state === "post" && !t.winner ? "dim" : ""}">
      ${logo(t, big ? 40 : 28)}
      <span class="tname">${rank(t)}${esc(big ? t.name : t.short)}${t.record ? `<small>${esc(t.record)}</small>` : ""}</span>
      ${poss ? `<span class="poss" title="Possession"></span>` : ""}
      ${slot}
    </div>`;
  };
  return row(g.away, "away") + row(g.home, "home") + (wp ? wpBar(g, wp) : "");
}

export function kickBadge(g) {
  const k = S.kick[g.id];
  if (!k?.at || Date.now() - k.at > 72 * 3600e3) return "";
  const was = k.ptv === false ? "TBD" : fmtDayTime(k.pd);
  const label = k.ptv === false ? "Time set" : "Time changed";
  return `<span class="badge moved" title="Was ${esc(was)} · spotted ${esc(ago(k.at))}">${icons.clock}${label} · was ${esc(k.ptv === false ? "TBD" : fmtTime(k.pd))}</span>`;
}

export function lineSummary(g) {
  const o = g.odds;
  if (!o) return "";
  const parts = [];
  if (o.spread) {
    const h = o.spread.home.line;
    parts.push(h === 0 ? "PK" : h < 0 ? `${esc(g.home.abbr)} ${h}` : `${esc(g.away.abbr)} ${-h}`);
  } else if (o.details) parts.push(esc(o.details));
  if (o.total) parts.push(`O/U ${o.total.line}`);
  return parts.join(" · ");
}

export function selBtn(s, label, { compact = false } = {}) {
  if (!s) return `<button class="sel na" disabled>—</button>`;
  const on = S.slip.legs.some((l) => l.key === s.key);
  const mv = S.moves[s.key];
  return `<button class="sel ${on ? "on" : ""} ${mv ? `mv-${mv.dir}` : ""}" data-act="toggle-sel" data-key="${esc(s.key)}" aria-pressed="${on}">
    ${label ? `<span class="ln">${label}</span>` : ""}<span class="pr">${odds(s.odds)}${mv ? `<i class="arrow">${mv.dir === "up" ? "▲" : "▼"}</i>` : ""}</span>
  </button>`;
}

// ── misc view bits ──

export function skeleton(n, kind = "card") {
  return `<div class="${kind === "row" ? "rows" : "grid-cards"}">${Array.from({ length: n }, () => `<div class="skel ${kind}"></div>`).join("")}</div>`;
}

export function errorBox(title, detail, what) {
  return `<div class="errbox"><h3>${esc(title)}</h3><p class="muted">${esc(detail)}. hedgehog retries on its own every 45 seconds.</p><button class="btn sm" data-act="refresh" data-v="${what}">${icons.refresh} Try now</button></div>`;
}

export function staleNote(st) {
  return `<div class="notice warn">Feed hiccup (${esc(st.error)}). Showing the last good data from <span data-ago="${st.at || st.cachedAt || 0}">${ago(st.at || st.cachedAt)}</span>; retrying automatically.</div>`;
}
