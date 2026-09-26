// Odds math. Everything is stored internally as decimal odds (e.g. 1.909 for -110)
// and converted for display, so American, decimal and fractional inputs all mix freely.

export function americanToDecimal(a) {
  a = Number(a);
  if (!Number.isFinite(a) || (a > -100 && a < 100)) return NaN;
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}

export function decimalToAmerican(d) {
  if (!(d > 1)) return NaN;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

export const impliedProb = (d) => (d > 1 ? 1 / d : NaN);

/**
 * Parse whatever a sportsbook shows: "+800", "-110", "110", "9.3", "x9.3", "9.3x", "×1.91", "5/2".
 * Bare numbers >= 100 (or <= -100) are American; anything between 1 and 100 is decimal.
 */
export function parseOdds(input) {
  if (typeof input === "number") input = String(input);
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase().replace(/\s+/g, "").replace(/[×x]/g, "");
  if (!s || s === "ev" || s === "even" || s === "evens") return s ? { decimal: 2, format: "american" } : null;
  const frac = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = 1 + Number(frac[1]) / Number(frac[2]);
    return d > 1 && Number.isFinite(d) ? { decimal: d, format: "fractional" } : null;
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (s[0] === "+" || s[0] === "-" || Math.abs(n) >= 100) {
    const d = americanToDecimal(n);
    return Number.isFinite(d) ? { decimal: d, format: "american" } : null;
  }
  return n > 1 ? { decimal: n, format: "decimal" } : null;
}

export function formatOdds(d, fmt = "american") {
  if (!(d > 1)) return "—";
  if (fmt === "decimal") return trimDec(d);
  const a = decimalToAmerican(d);
  return a > 0 ? `+${a}` : `${a}`;
}

function trimDec(d) {
  // Books show 1.91, 9.3, 12.5 — two decimals max, no trailing zeros past the first.
  const s = (Math.round(d * 100) / 100).toFixed(2);
  return s.endsWith("0") ? s.slice(0, -1) : s;
}

function americanStep(abs) {
  if (abs < 200) return 5;
  if (abs < 500) return 10;
  if (abs < 1000) return 25;
  if (abs < 3000) return 50;
  return 100;
}

/** Nudge odds one "tick" in the given format. dir=+1 lengthens the price (bigger payout). */
export function stepOdds(d, dir, fmt = "american") {
  if (!(d > 1)) return fmt === "decimal" ? 2 : americanToDecimal(-110);
  if (fmt === "decimal") {
    const step = d < 3 ? 0.05 : d < 10 ? 0.1 : 0.5;
    const next = Math.round((d + dir * step) / step) * step;
    return Math.max(1.01, Math.round(next * 100) / 100);
  }
  const a = decimalToAmerican(d);
  const step = americanStep(Math.abs(a));
  let n;
  if (dir > 0) {
    // Long side: -105 → +100 → +105. Snap onto the grid first so -112 → -110.
    n = a < 0 ? Math.ceil((a + 1) / step) * step : Math.floor(a / step) * step + step;
    if (a < 0 && n >= -100) n = 100 + (n + 100);
  } else {
    n = a > 0 ? Math.floor((a - 1) / step) * step : Math.ceil(a / step) * step - step;
    if (a > 0 && n < 100) n = -(100 + (100 - n));
  }
  if (n <= -100000) n = -100000;
  return americanToDecimal(n);
}

export const parlayDecimal = (decimals) => decimals.reduce((acc, d) => acc * d, 1);

export const toWin = (stake, d) => (stake > 0 && d > 1 ? stake * (d - 1) : 0);

/** Stake needed to win `profit` at odds d (lets people type the "to win" box). */
export const stakeForWin = (profit, d) => (profit > 0 && d > 1 ? profit / (d - 1) : 0);

/**
 * Hedge: given an open bet paying `payout` total, how much to put on the other side at d2
 * so the result is the same either way.
 */
export function hedge(payout, originalStake, d2) {
  if (!(payout > 0) || !(d2 > 1)) return null;
  const h = payout / d2;
  const locked = payout - originalStake - h;
  return { stake: h, locked };
}

/** Remove the vig from a two-way market → fair probabilities. */
export function noVig(d1, d2) {
  const p1 = 1 / d1, p2 = 1 / d2;
  const t = p1 + p2;
  return { p1: p1 / t, p2: p2 / t, hold: t - 1 };
}

export function fmtMoney(n, { sign = false, cents = true } = {}) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  if (n < 0) return `-$${body}`;
  return `${sign && n > 0 ? "+" : ""}$${body}`;
}

export const fmtPct = (p, digits = 1) => (Number.isFinite(p) ? `${(p * 100).toFixed(digits)}%` : "—");

export const fmtLine = (n) => (n == null || !Number.isFinite(n) ? "" : n > 0 ? `+${n}` : n === 0 ? "PK" : `${n}`);
