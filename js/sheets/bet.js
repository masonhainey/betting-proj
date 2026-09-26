// Bet detail sheet: grading, cash out, ticket payout, hedge, notes.

import { bustedLegs, asStraights } from "../autopsy.js";
import { parseOdds, hedge, fmtMoney } from "../odds.js";
import { betStatus, betProfit, ticketDecimal, potentialPayout, legLive, legLabel, computedDecimal } from "../grade.js";
import { esc, fmtDayTime, logo, statusText, icons } from "../ui.js";
import { closeBtn, pill } from "../render.js";
import { S, game, odds } from "../state.js";
import { mismatchNote } from "../views/build.js";

export function sheetBet() {
  const b = S.bets.find((x) => x.id === S.sheet.id);
  if (!b) return `<div class="sheet-h"><h2>Bet</h2>${closeBtn()}</div><p class="muted">This bet was removed.</p>`;
  const st = betStatus(b);
  const isParlay = b.legs.length > 1;
  const payout = potentialPayout(b);
  const profit = betProfit(b);
  const hedgeD = parseOdds(S.sheet.hedge || "")?.decimal;
  const h = st === "open" && hedgeD ? hedge(payout, b.stake, hedgeD) : null;
  const legRows = b.legs.map((l) => {
    const g = game(l.gameId);
    const lv = legLive(l, g);
    return `<div class="dleg ${lv.state}">
      <div class="dl-top"><span class="ldot"></span><b>${esc(legLabel(l, g))}</b><span class="grow"></span><span class="lodds">${odds(l.odds)}</span></div>
      ${g ? `<div class="dl-game">${logo(g.away, 18)} ${esc(g.away.abbr)} ${g.state !== "pre" ? g.away.score ?? 0 : ""} <span class="muted">${g.neutral ? "vs" : "@"}</span> ${logo(g.home, 18)} ${esc(g.home.abbr)} ${g.state !== "pre" ? g.home.score ?? 0 : ""} · <span class="muted">${esc(g.state === "pre" ? fmtDayTime(g.date) : statusText(g))}</span>${lv.text ? ` · <b>${esc(lv.text)}</b>` : ""}</div>` : l.gameLabel ? `<div class="dl-game muted">${esc(l.gameLabel)}</div>` : ""}
      ${b.cashout == null ? `<div class="seg xs grade">${["open", "won", "lost", "push", "void"].map((s) => `<button class="${l.status === s ? `on ${s}` : ""}" data-act="grade-leg" data-bet="${b.id}" data-leg="${l.id}" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="sheet-h"><h2>${isParlay ? `${b.legs.length}-leg parlay` : "Straight bet"}</h2>${closeBtn()}</div>
    <div class="dhead">
      ${pill(st)}<span class="muted">${esc(b.book || "No book")} · ${b.ghost ? "tracked" : "placed"} ${esc(fmtDayTime(b.createdAt))}${b.tail ? ` · tailed from ${esc(b.tail.from || "a friend")}` : ""}</span>
    </div>
    ${b.ghost ? `<div class="notice ghost-note"><span><b>👻 Ghost bet.</b> Tracked like a real bet but kept out of your P/L.</span><button class="btn sm" data-act="toggle-ghost" data-id="${b.id}">I placed it</button></div>` : ""}
    ${autopsyLine(b, st)}
    <div class="dsum">
      <div><span>Odds</span><b>${odds(ticketDecimal(b))}</b>${b.ticketPayout ? `<small>from ticket</small>` : b.oddsOverride ? `<small>book price</small>` : ""}${b.boostPct ? `<small>+${b.boostPct}% boost</small>` : ""}</div>
      <div><span>Risk</span><b>${fmtMoney(b.stake)}</b></div>
      <div><span>${st === "open" ? "Payout" : "Result"}</span><b class="${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}">${st === "open" ? fmtMoney(payout) : fmtMoney(profit, { sign: true })}</b>${st === "open" ? `<small>profit ${fmtMoney(payout - b.stake)}</small>` : ""}</div>
    </div>
    <h3 class="sh3">Legs <small>grade manually or let final scores do it</small></h3>
    <div class="dlegs">${legRows}</div>
    ${st === "open" || b.cashout != null ? `<h3 class="sh3">Cash out</h3>
      ${b.cashout != null
        ? `<p>Cashed out for <b>${fmtMoney(b.cashout)}</b> (${fmtMoney(b.cashout - b.stake, { sign: true })}). <button class="link" data-act="undo-cashout" data-id="${b.id}">Undo</button></p>`
        : `<div class="row-inline"><label class="stake"><span>$</span><input id="cashout-amt" inputmode="decimal" placeholder="Offer from your book"></label><button class="btn sm" data-act="cashout" data-id="${b.id}">Cash out</button></div>`}` : ""}
    ${b.cashout == null ? `<h3 class="sh3">Payout on your ticket <small>set it if our number doesn't match your book</small></h3>
      <div class="row-inline"><label class="stake"><span>$</span><input id="ticket-amt" inputmode="decimal" value="${b.ticketPayout ? b.ticketPayout.toFixed(2) : ""}" placeholder="${(b.stake * computedDecimal(b)).toFixed(2)}"></label><button class="btn sm" data-act="set-ticket" data-id="${b.id}">${b.ticketPayout ? "Update" : "Save"}</button>${b.ticketPayout ? `<button class="link" data-act="clear-ticket" data-id="${b.id}">Use leg math</button>` : ""}</div>
      ${b.ticketPayout ? mismatchNote(b.ticketPayout, b.stake * computedDecimal(b)) : ""}` : ""}
    ${st === "open" ? `<h3 class="sh3">Hedge calculator</h3>
      <p class="muted small">Price on the other side at your book → how much to bet to lock the same result either way.</p>
      <div class="row-inline"><label class="stake odds"><input id="hedge-odds" data-in="hedge" value="${esc(S.sheet.hedge || "")}" placeholder="e.g. +250 or 3.5"></label>
      <div id="hedge-out" class="hedge-out">${hedgeText(h)}</div></div>` : ""}
    <h3 class="sh3">Notes</h3>
    <textarea id="bet-note" data-in="bet-note" data-id="${b.id}" rows="2" placeholder="Why you liked it, who tipped you, etc.">${esc(b.note || "")}</textarea>
    <div class="dactions">
      <button class="btn sm primary" data-act="share-bet" data-id="${b.id}">${icons.ext} Share</button>
      ${b.link ? `<a class="btn sm" href="${esc(b.link)}" target="_blank" rel="noopener">${icons.ext} Open on ${esc(b.book || "your book")}</a>` : ""}
      ${b.legs.some((l) => l.gameId) ? `<button class="btn sm" data-act="rebuild" data-id="${b.id}">Rebuild in slip</button>` : ""}
      ${b.ghost ? "" : `<button class="btn sm" data-act="toggle-ghost" data-id="${b.id}" title="Keep tracking it, but leave it out of your P/L">Make it a ghost</button>`}
      <span class="grow"></span>
      <button class="btn sm danger" data-act="delete-bet" data-id="${b.id}">${S.confirmDelete === b.id ? "Tap again to delete" : "Delete"}</button>
    </div>`;
}

export function hedgeText(h) {
  if (!h) return `<span class="muted">Enter the opposing price</span>`;
  return `Bet <b>${fmtMoney(h.stake)}</b> → lock <b class="${h.locked >= 0 ? "pos" : "neg"}">${fmtMoney(h.locked, { sign: true })}</b> either way`;
}

/** For a lost parlay: which leg(s) sank it, and what straights would have made instead. */
function autopsyLine(b, st) {
  if (b.legs.length < 2 || st !== "lost" || b.cashout != null) return "";
  const busted = bustedLegs(b);
  const hit = b.legs.filter((l) => l.status === "won").length;
  const straights = asStraights(b);
  const names = busted.map((l) => `<b>${esc(legLabel(l, game(l.gameId)))}</b>`).join(" and ");
  return `<div class="notice autopsy-note"><span>${busted.length === 1 ? `Sunk by ${names} after ${hit} of ${b.legs.length - 1} other legs hit.` : `Sunk by ${names}.`} As straight bets, the same ${fmtMoney(b.stake)} would be <b class="${straights > 0 ? "pos" : straights < 0 ? "neg" : ""}">${fmtMoney(straights, { sign: true })}</b>.</span></div>`;
}
