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
// American odds: 3+ digits with a sign, not part of a dollar amount or a decimal number.
const AMERICAN_SRC = String.raw`(?<![\d.$\w])([+-]\d{3,5})(?![\d.,%])`;
const oddsIn = (s) => [...s.replace(new RegExp(MONEY, "g"), " ").matchAll(new RegExp(AMERICAN_SRC, "g"))];
const MARKET_LABEL = /^(spread|point spread|moneyline|money line|total|total points|game lines?|alt(ernate)? (spread|total)s?)$/i;
const PARLAY_HDR = /\b(\d{1,2})[\s-]*(?:leg|pick|team)s?\b|\bparlay\b|\bsgp\b|same\s?game/i;
const JUNK = /^(bet ?slip|my bets|open|settled|share|cash ?out|receipt|id[:#]?|placed|bet id|\d{1,2}:\d{2}|today|tomorrow|edit|done|view|keep|remove|accept)/i;

function clean(text) {
  return String(text || "")
    .replace(/[−‒–—]/g, "-") // unicode minus / dashes → "-"
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/[|¦]/g, " ")
    .replace(/[ \t]+/g, " ");
}

const amount = (s) => Number(s.replace(/,/g, ""));

function findMoney(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`${re.source}[^$\\d]{0,24}${MONEY}`, "i"));
    if (m) return amount(m[m.length - 1]);
    // Label on one line, amount on the next (common in slip layouts).
    if (re.test(lines[i]) && !/\$/.test(lines[i]) && lines[i + 1]) {
      const n = lines[i + 1].match(new RegExp(`^\\s*${MONEY}`));
      if (n) return amount(n[1]);
    }
  }
  return null;
}

/**
 * Parse slip text. Returns
 * { book, type, legs: [{ pick, odds }], stake, payout, toWin, totalOdds, legCount, url }
 */
export function parseSlipText(raw) {
  const text = clean(raw);
  const url = text.match(/https?:\/\/\S+/)?.[0] || "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const stake = findMoney(lines, /(wager|stake|risk|bet amount|amount|bet)\b:?/);
  let payout = findMoney(lines, /(total payout|potential payout|to pay|payout|returns?|potential return|total return)\b:?/);
  const toWin = findMoney(lines, /(to win|potential win(?:nings)?|win)\b:?/);
  if (payout == null && stake != null && toWin != null) payout = stake + toWin;
  // "$20.00 → $193.40" / "$20 to pay $193.40" style one-liners.
  if (stake == null || payout == null) {
    for (const l of lines) {
      const m = l.match(new RegExp(`${MONEY}\\s*(?:→|->|to pay|to return|pays)\\s*${MONEY}`, "i"));
      if (m) return finish({ stake: amount(m[1]), payout: amount(m[2]) });
    }
  }
  return finish({ stake, payout });

  function finish({ stake: st, payout: po }) {
    let totalOdds = null;
    let legCount = null;
    const legs = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const odds = oddsIn(line);
      const hdr = line.match(PARLAY_HDR);
      if (hdr) {
        if (hdr[1]) legCount = Number(hdr[1]);
        if (odds.length) totalOdds = americanToDecimal(Number(odds[odds.length - 1][1]));
        continue;
      }
      if (!odds.length) continue;
      const last = odds[odds.length - 1];
      const price = Number(last[1]);
      let pick = line.replace(new RegExp(MONEY, "g"), " ").replace(last[0], " ").replace(/\s{2,}/g, " ").replace(/[•·@]\s*$/, "").trim();
      // Books often stack team / market / line above the price: walk back until we have a name.
      for (let j = i - 1, n = 0; j >= 0 && n < 3 && pick.replace(/[^a-z]/gi, "").length < 3; j--, n++) {
        const prev = lines[j];
        if (JUNK.test(prev) || oddsIn(prev).length || /\$/.test(prev) || PARLAY_HDR.test(prev)) break;
        pick = MARKET_LABEL.test(prev) ? pick : `${prev} ${pick}`.trim();
        if (/^money ?line$/i.test(prev) && !/\bml\b/i.test(pick)) pick = `${pick} ML`;
      }
      if (JUNK.test(pick) || !/[a-z]{2}/i.test(pick)) continue;
      legs.push({ pick: tidyPick(pick), odds: americanToDecimal(price) });
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
    const isParlay = legs.length > 1 || !!legCount;
    return {
      book: detectBook(text),
      type: isParlay ? "parlay" : "straight",
      legs,
      stake: st ?? null,
      payout: po ?? null,
      toWin: po != null && st != null ? po - st : null,
      totalOdds,
      legCount,
      url,
    };
  }
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

/**
 * Link a free-text pick to a game and, where possible, a gradeable market.
 * Returns { gameId, market, side, line } or null.
 */
export function linkPick(pick, games) {
  let best = null;
  for (const g of games) {
    const h = teamHit(pick, g.home), a = teamHit(pick, g.away);
    if (!h.len && !a.len) continue;
    const side = h.len >= a.len ? "home" : "away";
    const hit = side === "home" ? h : a;
    // Does the *other* team appear once the matched name is removed? ("Texas A&M" ⊃ "Texas")
    const rest = hit.len === 2 ? pick.replace(hit.text, " ") : norm(pick).replace(hit.text, " ");
    const both = !!teamHit(rest, side === "home" ? g.away : g.home).len;
    const score = hit.len + (both ? 0.5 : 0);
    if (!best || score > best.score) best = { g, score, side, both };
  }
  if (!best) return null;
  const { g } = best;
  const p = norm(pick).replace(/ml\b/, " ml ");
  const tot = pick.match(/\b(over|under|o|u)\s?(\d{1,3}(?:\.5)?)\b/i);
  if (tot) return { gameId: g.id, market: "total", side: /^o/i.test(tot[1]) ? "over" : "under", line: Number(tot[2]) };
  if (best.both) return { gameId: g.id, market: "other" }; // matchup named but no clear market
  if (/\bml\b|money ?line|to win\b/.test(p)) return { gameId: g.id, market: "ml", side: best.side };
  const sp = pick.match(/(?:^|\s)([+-]\d{1,2}(?:\.5)?|pk|pick'?em)(?=\s|$)/i);
  if (sp) return { gameId: g.id, market: "spread", side: best.side, line: /pk|pick/i.test(sp[1]) ? 0 : Number(sp[1]) };
  return { gameId: g.id, market: "ml", side: best.side };
}
