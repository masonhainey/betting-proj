// Turns the text of a bet slip — OCR'd from a screenshot, or a book's share text — into
// a draft bet. Everything here is heuristic; the result always goes to the Add-a-pick
// form for the user to confirm, never straight into the tracker.

import { americanToDecimal, parseOdds } from "./odds.js";

const BOOKS = [
  ["DraftKings", /draft\s?kings|\bdk\b|draftkings\.com/i],
  ["FanDuel", /fan\s?duel|fndl\.co/i],
  ["BetMGM", /bet\s?mgm|\bmgm\b/i],
  ["Caesars", /caesars|czr/i],
  ["ESPN BET", /espn\s?bet/i],
  ["Fanatics", /fanatics/i],
  ["bet365", /bet\s?365/i],
  ["Hard Rock", /hard\s?rock/i],
  ["BetRivers", /bet\s?rivers/i],
  ["Bovada", /bovada/i],
  ["PrizePicks", /prize\s?picks/i],
  ["Underdog", /underdog\s?fantasy/i],
];

export function detectBook(text) {
  return BOOKS.find(([, re]) => re.test(text))?.[0] || "";
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const MONEY_G = () => new RegExp(MONEY, "g");
// American odds: 3+ digits with a sign, not part of a dollar amount or a decimal number.
const AMERICAN_SRC = String.raw`(?<![\d.$\w])([+-]\d{3,5})(?![\d.,%])`;
const oddsIn = (s) => [...s.replace(MONEY_G(), " ").matchAll(new RegExp(AMERICAN_SRC, "g"))];
// A price at the end of a line whose +/- the OCR dropped ("Texas -7.5   110").
const UNSIGNED_TAIL = /(?<![\d.$,:/\w-])(\d{3,4})\s*$/;
const DATEISH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}:\d{2}\b|\b[ap]\.?m\.?\b|\b(19|20)\d{2}\b|#\s?\d/i;
const MATCHUP = /^(?!.*\$)(.{2,40}?)\s+(?:@|vs\.?|v\.?|at)\s+(.{2,40})$/i;
const MARKET_LABEL = /^(spread|point spread|spread betting|moneyline|money line|total|total points|game lines?|alt(ernate)? (spread|total)s?|to win)$/i;
const PARLAY_HDR = /\b(\d{1,2})[\s-]*(?:leg|pick|team|selection)s?\b|\bparlay\b|\bsgp\b|same\s?game/i;
const JUNK = /^(bet ?slip|my bets|open|settled|share|cash ?out|receipt|id[:#]?|placed|bet id|\d{1,2}:\d{2}|today|tomorrow|edit|done|view|keep|remove|accept|won|lost|pending|live)\b/i;

/** Undo the usual OCR confusions inside things that should be numbers. */
export function fixOcr(text) {
  const digits = (s) => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[Ss]/g, "5").replace(/B/g, "8").replace(/[Zz]/g, "2");
  const realDigits = (s) => (s.match(/\d/g) || []).length;
  return text
    .split("\n")
    .map((line) =>
      line
        // "S20.00" → "$20.00" (the dollar sign is the most-misread glyph on slips)
        .replace(/(^|[\s:])S\s?(\d{1,5}[.,]\d{2})(?!\d)/g, "$1$$$2")
        // "$2O.OO" → "$20.00", "$20,00" → "$20.00"
        .replace(/\$\s?([0-9OoIlSs]{1,5})([.,])([0-9Oo]{2})(?![\d,])/g, (m, a, _sep, b) =>
          realDigits(a + b) >= 2 ? `$${digits(a)}.${digits(b)}` : m)
        // "- 110" / "+1S0" / "-11O" → "-110" / "+150"
        .replace(/(^|[\s(])([+-])\s?([0-9OoIlSsBZz]{3,5})(?=[\s)]|$)/g, (m, pre, sign, body) =>
          realDigits(body) >= 2 ? `${pre}${sign}${digits(body)}` : m)
    )
    .join("\n");
}

function clean(text) {
  return fixOcr(
    String(text || "")
      .replace(/[−‒–—]/g, "-") // unicode minus / dashes → "-"
      .replace(/[“”]/g, '"')
      .replace(/ /g, " ")
      .replace(/[|¦]/g, " ")
      .replace(/[ \t]+/g, " ")
  );
}

const amount = (s) => Number(s.replace(/,/g, ""));

function findMoney(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    if (/cash ?out/i.test(lines[i])) continue;
    const m = lines[i].match(new RegExp(`${re.source}[^$\\d]{0,24}${MONEY}`, "i"));
    if (m) return amount(m[m.length - 1]);
    // Label on one line, amount on the next (common in slip layouts).
    if (new RegExp(re.source, "i").test(lines[i]) && !/\$/.test(lines[i]) && lines[i + 1]) {
      const n = lines[i + 1].match(new RegExp(`^\\s*${MONEY}`));
      if (n) return amount(n[1]);
    }
  }
  return null;
}

const signed = (n, sign) => americanToDecimal(sign * n);

/**
 * OCR regularly drops a thin "-". When we know what the ticket pays, try every sign
 * combination for the unsure legs and keep the one whose product matches the ticket.
 */
function solveSigns(legs, target) {
  const unsure = legs.filter((l) => l.uncertain);
  if (!unsure.length || !(target > 1) || unsure.length > 8) return;
  const sure = legs.filter((l) => !l.uncertain).reduce((a, l) => a * l.odds, 1);
  let best = null;
  for (let mask = 0; mask < 1 << unsure.length; mask++) {
    const prod = unsure.reduce((a, l, k) => a * signed(l.raw, mask & (1 << k) ? 1 : -1), sure);
    const err = Math.abs(prod - target) / target;
    if (!best || err < best.err) best = { mask, err };
  }
  if (best.err < 0.03) {
    unsure.forEach((l, k) => {
      l.odds = signed(l.raw, best.mask & (1 << k) ? 1 : -1);
      l.uncertain = false;
      l.solved = true;
    });
  }
}

/**
 * Parse slip text. Returns
 * { book, type, legs: [{ pick, odds, context?, uncertain? }], stake, payout, toWin, totalOdds, legCount, url, oddsCheck }
 */
export function parseSlipText(raw) {
  const text = clean(raw);
  const url = text.match(/https?:\/\/\S+/)?.[0] || "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const STAKE_RE = /(total wager|total stake|wager|stake|risk|bet amount|amount wagered|amount|bet)\b:?/;
  const PAYOUT_RE = /(total payout|potential payout|est(?:imated)?\.? payout|to pay|payout|to return|potential return|total return|returns?|paid)\b:?/;
  let stake = null, payout = null;
  // Column layout: "TOTAL WAGER    POTENTIAL PAYOUT" over "$10.00    $69.60".
  for (let i = 0; i < lines.length - 1 && stake == null; i++) {
    if (/\$/.test(lines[i])) continue;
    const sI = lines[i].search(new RegExp(STAKE_RE.source, "i"));
    const pI = lines[i].search(new RegExp(PAYOUT_RE.source, "i"));
    const amts = [...lines[i + 1].matchAll(MONEY_G())].map((m) => amount(m[1]));
    if (sI >= 0 && pI >= 0 && amts.length >= 2) {
      [stake, payout] = sI < pI ? [amts[0], amts[1]] : [amts[1], amts[0]];
    }
  }
  stake ??= findMoney(lines, STAKE_RE);
  payout ??= findMoney(lines, PAYOUT_RE);
  const toWin = findMoney(lines, /(to win|potential win(?:nings)?|potential profit|win)\b:?/);
  if (payout == null && stake != null && toWin != null) payout = stake + toWin;
  // "$20.00 → $193.40" / "$20 to pay $193.40" style one-liners.
  if (stake == null || payout == null) {
    for (const l of lines) {
      const m = l.match(new RegExp(`${MONEY}\\s*(?:→|->|to pay|to return|pays)\\s*${MONEY}`, "i"));
      if (m) {
        stake = amount(m[1]);
        payout = amount(m[2]);
        break;
      }
    }
  }

  let totalOdds = null;
  let legCount = null;
  let pendingCtx = "";
  let lastLegLine = -9;
  const legs = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/cash ?out/i.test(line)) continue;
    const odds = oddsIn(line);
    const hdr = line.match(PARLAY_HDR);
    if (hdr) {
      if (hdr[1]) legCount = Number(hdr[1]);
      if (odds.length) totalOdds = americanToDecimal(Number(odds[odds.length - 1][1]));
      continue;
    }
    // A market label printed *under* the pick ("Clemson Tigers" / "MONEYLINE").
    if (!odds.length && /^money ?line$/i.test(line) && legs.length && i - lastLegLine <= 2) {
      const last = legs[legs.length - 1];
      if (!/\bml\b|[+-]\d|\b(over|under)\b/i.test(last.pick)) last.pick += " ML";
      continue;
    }
    // "Texas Longhorns @ South Carolina Gamecocks" — context for the nearest leg.
    if (!odds.length && MATCHUP.test(line) && !JUNK.test(line)) {
      const last = legs[legs.length - 1];
      if (last && !last.context && i - lastLegLine <= 3) last.context = line;
      else pendingCtx = line;
      continue;
    }
    let token, raw = null, price = null;
    if (odds.length) {
      token = odds[odds.length - 1][0];
      price = Number(odds[odds.length - 1][1]);
    } else {
      const bare = line.replace(MONEY_G(), " ");
      const u = !/\$/.test(line) && !DATEISH.test(line) && bare.match(UNSIGNED_TAIL);
      const n = u ? Number(u[1]) : 0;
      if (!(n >= 100 && n <= 5000)) continue;
      token = u[0];
      raw = n;
    }
    let pick = line.replace(MONEY_G(), " ").replace(token, " ").replace(/\s{2,}/g, " ").replace(/[•·@]\s*$/, "").trim();
    let ctx = "";
    // Books often stack team / market / line above the price: walk back until we have a name.
    for (let j = i - 1, n = 0; j > lastLegLine && n < 4 && pick.replace(/[^a-z]/gi, "").length < 3; j--, n++) {
      const prev = lines[j];
      if (JUNK.test(prev) || oddsIn(prev).length || /\$/.test(prev) || PARLAY_HDR.test(prev)) break;
      if (MATCHUP.test(prev)) {
        ctx ||= prev;
        continue;
      }
      if (/^money ?line$/i.test(prev) && !/\bml\b/i.test(pick)) pick = `${pick} ML`;
      else if (!MARKET_LABEL.test(prev)) pick = `${prev} ${pick}`.trim();
    }
    if (JUNK.test(pick) || !/[a-z]{2}/i.test(pick)) continue;
    // A bare number with no market words is more likely a score or ID than a price.
    if (raw != null && !/[+-]\d|\b(ml|over|under|o|u)\b|moneyline/i.test(pick) && pick.split(" ").length > 6) continue;
    const leg = { pick: tidyPick(pick) };
    if (raw != null) {
      // Default guess: prices near even are usually favorites' minus prices on CFB slips.
      leg.raw = raw;
      leg.uncertain = true;
      leg.odds = signed(raw, raw < 300 ? -1 : 1);
    } else leg.odds = americanToDecimal(price);
    if (ctx || pendingCtx) leg.context = ctx || pendingCtx;
    pendingCtx = "";
    legs.push(leg);
    lastLegLine = i;
  }
  // Decimal-odds books (x9.3 / @ 1.91) when no American prices were found.
  if (!legs.length) {
    for (const line of lines) {
      const m = line.match(/^(.*?[a-z].*?)\s+(?:@|x|×)\s?(\d{1,3}\.\d{1,2})\b/i);
      if (m && !JUNK.test(m[1])) legs.push({ pick: tidyPick(m[1]), odds: Number(m[2]) });
    }
  }
  if (!totalOdds) {
    const m = text.match(/(?:odds|price)\s*:?\s*([+-]\d{3,5}|(?:x|×)?\d{1,3}\.\d{1,2})/i);
    if (m) totalOdds = parseOdds(m[1])?.decimal || null;
  }
  const target = payout > 0 && stake > 0 ? payout / stake : totalOdds;
  solveSigns(legs, target);
  const prod = legs.reduce((a, l) => a * l.odds, 1);
  const isParlay = legs.length > 1 || !!legCount;
  return {
    book: detectBook(text),
    type: isParlay ? "parlay" : "straight",
    legs,
    stake: stake ?? null,
    payout: payout ?? null,
    toWin: payout != null && stake != null ? payout - stake : null,
    totalOdds,
    legCount,
    url,
    // How far the legs' product is from what the ticket says (0.25 = 25% off). Big gaps
    // usually mean a misread price, a missed leg, or a same-game-parlay price.
    oddsCheck: target > 1 && legs.length ? Math.abs(prod - target) / target : null,
  };
}

/** How good a read is: used to pick the better of two OCR passes. */
export function readScore(text) {
  const p = parseSlipText(text);
  const complete = p.legs.length > 0 && p.stake != null && p.payout != null && (!p.legCount || p.legCount === p.legs.length);
  const score =
    p.legs.length * 3 +
    (p.stake != null) * 2 +
    (p.payout != null) * 2 +
    (p.legCount && p.legCount === p.legs.length ? 3 : 0) +
    (p.oddsCheck != null && p.oddsCheck < 0.03 ? 4 : 0) -
    p.legs.filter((l) => l.uncertain).length;
  return { score, complete: complete && (p.oddsCheck == null || p.oddsCheck < 0.03) };
}

function tidyPick(p) {
  let out = p
    .replace(/https?:\/\/\S+/g, " ")
    .replace(new RegExp(MONEY, "g"), " ")
    .replace(/→|->|=>/g, " ")
    // Share-text chatter: "I just placed a bet on FanDuel! …", "Check out my parlay: …"
    .replace(/^.*?\b(placed|check out|tail(ing)?|my (bet|parlay|pick)|bet on|just bet)\b[^!:]*[!:]\s*/i, "");
  for (const [, re] of BOOKS) out = out.replace(new RegExp(re.source, "gi"), " ");
  return out
    .replace(/\b(moneyline)\b/i, "ML")
    .replace(/\bspread\b|\bpoint spread\b|\btotal points\b|\bgame lines?\b/gi, "")
    .replace(/\s[•·]\s|\s[•·]$/g, " ")
    .replace(/^[-•·:!\s]+|[-•·:!\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 80);
}

// ---------- matching picks to real games ----------

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Length of the longest name of team t found in the pick (0 if none), plus the matched text. */
function teamHit(pick, t) {
  const p = ` ${norm(pick)} `;
  const full = [t.name, t.short].filter(Boolean).map(norm).sort((a, b) => b.length - a.length);
  for (const n of full) if (n.length >= 3 && p.includes(` ${n} `)) return { len: n.length, text: n };
  // Abbreviations only count as an exact uppercase word ("UGA -7.5"), never inside other words.
  if (t.abbr && t.abbr.length >= 2 && new RegExp(`(^|[^A-Za-z])${escRe(t.abbr)}([^A-Za-z]|$)`).test(pick)) return { len: 2, text: t.abbr };
  return { len: 0, text: "" };
}

function bestGame(text, games, now) {
  let best = null;
  for (const g of games) {
    const h = teamHit(text, g.home), a = teamHit(text, g.away);
    if (!h.len && !a.len) continue;
    const side = h.len >= a.len ? "home" : "away";
    const hit = side === "home" ? h : a;
    // Does the *other* team appear once the matched name is removed? ("Texas A&M" ⊃ "Texas")
    const rest = hit.len === 2 ? text.replace(hit.text, " ") : norm(text).replace(hit.text, " ");
    const both = !!teamHit(rest, side === "home" ? g.away : g.home).len;
    const score = hit.len + (both ? 0.5 : 0);
    const dist = Math.abs(new Date(g.date || now).getTime() - now);
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { g, score, side, both, dist };
  }
  return best;
}

/**
 * Link a free-text pick to a game and, where possible, a gradeable market. `context` is a
 * matchup line from the slip ("TEX @ SC") used when the pick itself names no team
 * (e.g. "Over 56"). When a team plays several weeks in the pool, the nearest game wins.
 * Returns { gameId, market, side, line } or null.
 */
export function linkPick(pick, games, context = "", now = Date.now()) {
  const byPick = bestGame(pick, games, now);
  const byCtx = context ? bestGame(context, games, now) : null;
  let hit;
  if (byCtx) {
    // The slip's matchup line pins the exact game (and week); the pick picks the side.
    const inCtx = bestGame(pick, [byCtx.g], now);
    if (inCtx) hit = inCtx;
    else if (!byPick) hit = { g: byCtx.g, unnamed: true };
    else hit = byPick;
  } else hit = byPick;
  if (!hit) return null;
  const { g } = hit;
  const p = norm(pick).replace(/ml\b/, " ml ");
  const tot = pick.match(/\b(over|under|o|u)\s?(\d{1,3}(?:\.5)?)\b/i);
  if (tot) return { gameId: g.id, market: "total", side: /^o/i.test(tot[1]) ? "over" : "under", line: Number(tot[2]) };
  if (hit.both || hit.unnamed) return { gameId: g.id, market: "other" };
  if (/\bml\b|money ?line|to win\b/.test(p)) return { gameId: g.id, market: "ml", side: hit.side };
  const sp = pick.match(/(?:^|\s)([+-]\d{1,2}(?:\.5)?|pk|pick'?em)(?=\s|$)/i);
  if (sp) return { gameId: g.id, market: "spread", side: hit.side, line: /pk|pick/i.test(sp[1]) ? 0 : Number(sp[1]) };
  return { gameId: g.id, market: "ml", side: hit.side };
}
