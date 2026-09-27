// Share links: the whole ticket rides in the URL hash (#tail=…), so sharing needs no server
// and no account on either side. Anything decoded from a link is untrusted, so every field
// is type-checked, clamped and length-limited before the app touches it.

import { formatOdds } from "./odds.js";

const MARKETS = new Set(["ml", "spread", "total", "prop", "other"]);
const SIDES = new Set(["home", "away", "over", "under"]);
const STATUSES = new Set(["open", "won", "lost", "push", "void"]);
const MAX_LEGS = 20;

// UTF-8 safe base64url (names and picks can have emoji / accents).
export function toB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Compact payload for a bet (or an unplaced slip). */
export function makePayload(bet, { name = "", includeStake = false, kind = "bet" } = {}) {
  const p = {
    v: 1,
    k: kind,
    i: String(bet.id || "").slice(0, 40),
    n: name.trim().slice(0, 40) || undefined,
    b: bet.book || undefined,
    t: bet.createdAt || new Date().toISOString(),
    o: bet.oddsOverride > 1 ? round(bet.oddsOverride) : undefined,
    x: bet.boostPct > 0 ? bet.boostPct : undefined,
    l: bet.legs.map((l) => ({
      p: l.pick,
      o: round(l.odds),
      g: l.gameId || undefined,
      sp: l.sport && l.sport !== "cfb" ? l.sport : undefined,
      m: l.market || undefined,
      d: l.side || undefined,
      n: Number.isFinite(l.line) ? l.line : undefined,
      gl: l.gameLabel || undefined,
      k: l.kickoff || undefined,
      s: l.status && l.status !== "open" ? l.status : undefined,
    })),
  };
  if (includeStake && bet.stake > 0) {
    p.s = round(bet.stake, 2);
    if (bet.ticketPayout > 0) p.p = round(bet.ticketPayout, 2);
  }
  if (bet.cashout != null) p.c = round(bet.cashout, 2);
  return p;
}

export const encodeShare = (bet, opts) => toB64url(JSON.stringify(makePayload(bet, opts)));

export function shareUrl(code, base) {
  return `${base.replace(/#.*$/, "")}#tail=${code}`;
}

const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const iso = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : undefined);

/** Decode and sanitize a share code. Returns a clean ticket, or null if it isn't one. */
export function decodeShare(code) {
  let raw;
  try {
    if (typeof code !== "string" || code.length > 8000) return null;
    raw = JSON.parse(fromB64url(code));
  } catch {
    return null;
  }
  return sanitizeShare(raw);
}

/** Validate a payload object (from a link, or from a friend's published picks). */
export function sanitizeShare(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1 || !Array.isArray(raw.l)) return null;
  const legs = raw.l.slice(0, MAX_LEGS).map((l) => {
    if (!l || typeof l !== "object") return null;
    const pick = str(l.p, 80);
    const odds = num(l.o, 1.001, 10000);
    if (!pick || !odds) return null;
    const leg = { pick, odds, status: STATUSES.has(l.s) ? l.s : "open" };
    if (typeof l.g === "string" && /^\d{1,14}$/.test(l.g)) leg.gameId = l.g;
    if (leg.gameId) leg.sport = l.sp === "nfl" ? "nfl" : "cfb";
    if (MARKETS.has(l.m) && l.m !== "prop") leg.market = l.m; // props are re-read from the pick text
    if (SIDES.has(l.d)) leg.side = l.d;
    const line = num(l.n, -200, 400);
    if (line !== undefined) leg.line = line;
    const gl = str(l.gl, 60);
    if (gl) leg.gameLabel = gl;
    const k = iso(l.k);
    if (k) leg.kickoff = k;
    // A gradeable market needs its side (and a line for spreads/totals); otherwise track manually.
    if (leg.market && ["ml", "spread", "total"].includes(leg.market) && (!leg.side || (leg.market !== "ml" && leg.line === undefined))) {
      delete leg.market;
      delete leg.side;
    }
    return leg;
  }).filter(Boolean);
  if (!legs.length) return null;
  return {
    kind: raw.k === "slip" ? "slip" : "bet",
    src: str(raw.i, 40) || null,
    from: str(raw.n, 40),
    book: str(raw.b, 30),
    createdAt: iso(raw.t) || null,
    oddsOverride: num(raw.o, 1.001, 100000),
    boostPct: num(raw.x, 0, 1000),
    stake: num(raw.s, 0.01, 1e7),
    ticketPayout: num(raw.p, 0.01, 1e9),
    cashout: num(raw.c, 0, 1e9),
    legs,
  };
}

/** The message that goes with the link in a text/iMessage. */
export function shareText(ticket, { decimal, status, profit } = {}) {
  const fmt = decimal ? "decimal" : "american";
  const n = ticket.legs.length;
  const what = n > 1 ? `${n}-leg parlay` : "pick";
  const price = formatOdds(ticket.price, fmt);
  const picks = ticket.legs.map((l) => l.pick).join(" · ");
  if (status === "won") return `💰 Cashed my ${what} (${price})${profit ? ` for +$${profit.toFixed(2)}` : ""}: ${picks}`;
  if (status === "lost") return `☠️ So close on this ${what} (${price}): ${picks}`;
  if (ticket.kind === "slip") return `🦔 Thinking about this ${what} (${price}): ${picks}. Tail it or talk me out of it`;
  return `🦔 Tail my ${what} (${price}): ${picks}`;
}
