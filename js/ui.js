// Small rendering helpers shared by every view.

import { americanToDecimal, noVig } from "./odds.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const tzAbbr = (() => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    return "";
  }
})();

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const fmtDayLong = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const fmtDayTime = (iso) => `${fmtDay(iso)} · ${fmtTime(iso)}`;

export const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function ago(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function relDay(iso) {
  const d = startOfDay(new Date(iso)), t = startOfDay();
  const diff = Math.round((d - t) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDay(iso);
}

const DARK = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

/** ESPN logo URL for a team, preferring the dark-background variant in dark mode. */
export function logoUrl(t) {
  const base = t.logo || (/^\d+$/.test(t.id || "") ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png` : "");
  return DARK ? base.replace("/ncaa/500/", "/ncaa/500-dark/") : base;
}

/**
 * Team logo. The colored monogram sits underneath until the image loads; if the dark
 * variant 404s we fall back to the regular logo, and if that fails the monogram stays.
 */
export function logo(t, size = 28) {
  const bg = t.color || "#3a3548";
  const src = logoUrl(t);
  return `<span class="logo" style="--sz:${size}px;--tc:${esc(bg)}"><span class="mono">${esc((t.abbr || "?").slice(0, 4))}</span>${
    src
      ? `<img src="${esc(src)}" alt="" loading="lazy" onload="this.parentNode.classList.add('ok')" onerror="if(this.src.includes('/500-dark/')){this.src=this.src.replace('/500-dark/','/500/')}else{this.remove()}">`
      : ""
  }</span>`;
}

const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`;

/** AP Top 25 marker: gold star + rank. */
export const rank = (t) => (t.rank ? `<span class="rk" title="AP No. ${t.rank}">${STAR}${t.rank}</span>` : "");

export const rankedMatchup = (g) => !!(g.home.rank && g.away.rank);
export const rankedBadge = (g) => (rankedMatchup(g) ? `<span class="badge ranked">${STAR}Ranked matchup</span>` : "");

/**
 * Pregame win probability from the market: no-vig moneyline when both sides are posted,
 * otherwise a spread-based estimate. Returns { home, away } in 0..1, or null.
 */
export function winProb(g) {
  const o = g?.odds;
  if (!o) return null;
  if (o.ml?.home != null && o.ml?.away != null) {
    const r = noVig(americanToDecimal(o.ml.home), americanToDecimal(o.ml.away));
    if (Number.isFinite(r.p1) && Number.isFinite(r.p2)) return { home: r.p1, away: r.p2, src: "moneyline" };
  }
  if (o.spread?.home?.line != null) {
    const home = 1 / (1 + Math.exp(o.spread.home.line / 5.8));
    return { home, away: 1 - home, src: "spread" };
  }
  return null;
}

export const pct = (p) => `${Math.round(p * 100)}%`;

/** Split bar in the two teams' colors, sized by win probability. */
export function wpBar(g, wp) {
  if (!wp) return "";
  const ac = g.away.color || "#6b6580", hc = g.home.color || "#8e87a3";
  return `<div class="wpbar" title="Win probability from ${wp.src}"><i style="--c:${esc(ac)};flex:${wp.away.toFixed(3)}"></i><i style="--c:${esc(hc)};flex:${wp.home.toFixed(3)}"></i></div>`;
}

export function statusText(g) {
  if (g.state === "in") return g.shortDetail || `Q${g.period} ${g.clock}`;
  if (g.state === "post") return g.shortDetail || "Final";
  return g.timeValid ? fmtTime(g.date) : "TBD";
}

/** Bankroll curve as an inline SVG area chart. */
export function curveSvg(points, { w = 600, h = 120, base = 0 } = {}) {
  if (points.length < 2) {
    return `<svg class="curve empty" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/></svg>`;
  }
  const vals = [base, ...points.map((p) => p.v + base)];
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.12 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i) => (i / (vals.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * h;
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = vals[vals.length - 1] >= base;
  return `<svg class="curve ${up ? "up" : "down"}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Profit over time">
    <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <line class="zero" x1="0" x2="${w}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}"/>
    <path d="${d}L${w},${h}L0,${h}Z" fill="url(#cg)"/>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>`;
}

export const icons = {
  bets: `<svg viewBox="0 0 24 24"><path d="M4 5h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14 5v12" stroke-dasharray="2 2"/></svg>`,
  live: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/></svg>`,
  schedule: `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
  build: `<svg viewBox="0 0 24 24"><path d="M4 7h10M4 12h16M4 17h7"/><circle cx="17" cy="7" r="2"/><circle cx="14" cy="17" r="2"/></svg>`,
  news: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>`,
  ext: `<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`,
};
