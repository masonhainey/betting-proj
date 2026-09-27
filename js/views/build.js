// Build tab: odds board + bet slip.

import { parseOdds, formatOdds, toWin, impliedProb, fmtMoney, fmtPct, fmtLine } from "../odds.js";
import { legLabel } from "../grade.js";
import { esc, fmtTime, dayKey, relDay, logo, rank, icons } from "../ui.js";

import { boardGames, markets, selByKey, slipCalc } from "../market.js";
import { chip, fmtToggle, selBtn, skeleton } from "../render.js";
import { S, SP, fmt, game, num, odds, settings, sport } from "../state.js";
import { edgeTag, modelBar, modelLine, slipCheck } from "./modelui.js";
import { ensureModel } from "../model/index.js";

// ── Build ──

export function viewBuild() {
  ensureModel(sport());
  const all = boardGames();
  const days = [...new Set(all.map((g) => dayKey(g.date)))];
  const dayF = S.f.buildDay === "all" || days.includes(S.f.buildDay) ? S.f.buildDay : "all";
  const q = S.f.buildQ.trim().toLowerCase();
  let gs = all.filter((g) => dayF === "all" || dayKey(g.date) === dayF);
  if (q) gs = gs.filter((g) => `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q));
  const provider = all[0]?.odds?.provider;
  const board = gs.length
    ? `<div class="board">
        <div class="bhead"><span></span><span>Spread</span><span>Total</span><span>Money</span></div>
        ${gs.map(boardRow).join("")}
      </div>`
    : S.st.schedule.at || S.st.today.at
      ? `<div class="empty">No lines posted for that filter yet. Books usually hang next week's numbers Sunday.</div>`
      : skeleton(6);
  return `<div class="build">
    <div class="build-main">
      <div class="view-h">
        <div><div class="eyebrow">${SP().label} slip builder</div><h1>Build</h1><p class="muted">Tap prices to build a slip. ${provider ? `Lines: ${esc(provider)} via ESPN` : "Lines from ESPN"} · refreshes automatically.</p></div>
      </div>
      <div class="toolbar">
        <label class="switch ${S.sim ? "on" : ""}" title="Simulate a live market: prices tick every couple seconds so you can see how your slip reacts. Real lines are unchanged."><input type="checkbox" data-act="sim" ${S.sim ? "checked" : ""}><span class="knob"></span>Market sim</label>
        <label class="search">${icons.search}<input id="build-q" data-in="build-q" type="search" placeholder="Find a team" value="${esc(S.f.buildQ)}" autocomplete="off"></label>
      </div>
      <div class="chips scroll">${chip("All", "build-day", "all", dayF === "all")}${days.map((d) => chip(esc(relDay(d + "T12:00:00")), "build-day", d, dayF === d)).join("")}</div>
      ${S.sim ? `<div class="notice sim"><span class="dot live"></span><span><b>Market sim on.</b> Prices are drifting on purpose so you can watch the slip reprice. Turn it off to snap back to the real lines.</span></div>` : ""}
      ${modelBar()}
      ${board}
    </div>
    <aside class="build-slip card">${S.sheet?.kind === "slip" ? "" : slipHtml()}</aside>
  </div>`;
}

const sb = (s, label, g) => selBtn(s, label, { extra: edgeTag(s, g) });

export function boardRow(g) {
  const m = markets(g);
  return `<div class="brow">
    <button class="bteams" data-act="open-game" data-id="${g.id}">
      <span class="btime">${esc(relDay(g.date))} · ${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}${g.tv ? ` · ${esc(g.tv)}` : ""}${g.home.rank && g.away.rank ? ` · <span class="rk-inline">★ Ranked</span>` : ""}</span>
      <span class="bt">${logo(g.away, 20)}${rank(g.away)}${esc(g.away.short)}</span>
      <span class="bt">${logo(g.home, 20)}${rank(g.home)}${esc(g.home.short)}</span>
      ${modelLine(g)}
    </button>
    <div class="bcol">${sb(m.spreadAway, fmtLine(m.spreadAway?.line), g)}${sb(m.spreadHome, fmtLine(m.spreadHome?.line), g)}</div>
    <div class="bcol">${sb(m.over, m.over ? `O ${m.over.line}` : "", g)}${sb(m.under, m.under ? `U ${m.under.line}` : "", g)}</div>
    <div class="bcol">${sb(m.mlAway, "", g)}${sb(m.mlHome, "", g)}</div>
  </div>`;
}

export function slipHtml() {
  const c = slipCalc();
  const n = c.legs.length;
  const mode = S.slip.mode;
  if (!n) {
    return `<div class="slip-empty">
      <div class="slip-ico">${icons.build}</div>
      <h3>Your slip is empty</h3>
      <p class="muted">Tap any price on the board. Add two or more to see the parlay price build up live.</p>
      <button class="btn sm" data-act="slip-custom">+ Custom selection</button>
    </div>`;
  }
  const tabs = `<div class="seg slip-mode">
    <button class="${mode === "singles" ? "on" : ""}" data-act="slip-mode" data-v="singles">Straight${n > 1 ? `s (${n})` : ""}</button>
    <button class="${mode === "parlay" ? "on" : ""}" data-act="slip-mode" data-v="parlay" ${n < 2 ? "disabled title='Add a second leg to parlay'" : ""}>Parlay <em>${n > 1 ? odds(c.rawParlay) : ""}</em></button>
  </div>`;
  const legs = c.legs.map((l) => {
    const cur = !l.custom && selByKey(l.key);
    const g = game(l.gameId);
    const moved = cur && (cur.line !== l.line || Math.abs(cur.odds - l.odds) > 1e-6);
    const gone = !l.custom && !cur;
    const mv = S.moves[l.key];
    return `<div class="sleg ${moved ? "moved" : ""} ${mv ? `mv-${mv.dir}` : ""}">
      <div class="sl-top">
        <div class="sl-pick">${l.custom
          ? `<input id="slip-pick-${l.id}" data-in="slip-pick" data-id="${l.id}" value="${esc(l.pick)}" placeholder="Name it — e.g. Manning 250+ pass yds" autocomplete="off"><small>Custom selection</small>`
          : `${esc(legLabel(l, g) || l.pick)}<small>${esc(`${l.gameLabel} · ${relDay(l.kickoff)} ${fmtTime(l.kickoff)}`)}</small>`}</div>
        <button class="icon-btn sm" data-act="slip-remove" data-id="${l.id}" aria-label="Remove">${icons.x}</button>
      </div>
      <div class="sl-odds">
        ${stepper(`slip-odds-${l.id}`, l.oddsText ?? odds(l.odds), `slip-odds`, l.id)}
        ${mode === "singles" ? `<label class="stake"><span>$</span><input id="slip-stake-${l.id}" data-in="slip-stake" data-id="${l.id}" inputmode="decimal" placeholder="Stake" value="${esc(S.slip.stakes[l.id] ?? "")}"></label>` : `<span class="imp" title="Implied probability">${fmtPct(impliedProb(l.odds), 0)}</span>`}
      </div>
      ${mode === "singles" ? `<div class="sl-win muted" data-towin="${l.id}">${towinText(l)}</div>` : ""}
      ${moved ? `<div class="sl-change">${settings.autoAccept ? "" : `Market now <b>${cur.market === "ml" ? "" : cur.market === "total" ? `${l.side === "over" ? "O" : "U"} ${cur.line} ` : `${fmtLine(cur.line)} `}${odds(cur.odds)}</b>${l.edited ? " · you set your own price" : ""}<button class="link" data-act="slip-accept" data-id="${l.id}">Use market</button>`}</div>` : ""}
      ${gone ? `<div class="sl-change muted">Market closed — kept at your price</div>` : ""}
    </div>`;
  }).join("");
  const warn = mode === "parlay" && c.conflict
    ? `<div class="notice err">Two legs on the same market in one game — books won't take that as a parlay.</div>`
    : mode === "parlay" && c.sameGame
      ? `<div class="notice warn">Same-game legs are correlated. Books price these as SGPs — enter their price below for an accurate payout.</div>`
      : "";
  const parlayBox = mode === "parlay"
    ? `<div class="pbox">
        <div class="prow"><label>Book's price <small>optional</small></label>${stepper("slip-override", S.slip.overrideText ?? (S.slip.override ? odds(parseOdds(S.slip.override)?.decimal) : ""), "slip-override", "", "calc " + odds(c.rawParlay))}</div>
        <div class="prow"><label>Profit boost</label><label class="stake pct"><input id="slip-boost" data-in="slip-boost" inputmode="decimal" placeholder="0" value="${esc(S.slip.boost)}"><span>%</span></label></div>
        <div class="prow"><label>Stake</label><label class="stake"><span>$</span><input id="slip-stake" data-in="slip-pstake" inputmode="decimal" value="${esc(S.slip.stake)}"></label></div>
        <div class="quick">${[5, 10, 25, 50, 100].map((v) => `<button class="chip" data-act="slip-quick" data-v="${v}">$${v}</button>`).join("")}</div>
        <div class="prow"><label>Payout on your ticket <small>after you place it — we'll match it exactly</small></label><label class="stake"><span>$</span><input id="slip-ticket" data-in="slip-ticket" inputmode="decimal" placeholder="${c.calcPayout ? c.calcPayout.toFixed(2) : ""}" value="${esc(S.slip.ticket || "")}"></label></div>
      </div>`
    : "";
  return `<div class="slip">
    <div class="slip-h"><h2>Slip <em>${n}</em></h2>${fmtToggle("set-fmt")}<button class="link" data-act="share-slip">Share</button><button class="link" data-act="slip-clear">Clear</button></div>
    ${tabs}
    <div class="slegs">${legs}</div>
    <button class="btn sm ghost add-custom" data-act="slip-custom">+ Custom selection</button>
    ${warn}
    ${slipCheck(c, mode)}
    ${parlayBox}
    <div id="slip-summary">${slipSummary(c)}</div>
    <label class="bookf"><span>Book</span><input id="slip-book" data-in="slip-book" list="books" placeholder="Where you're placing it" value="${esc(S.slip.book || "")}"></label>
    <label class="switch ghost-sw ${S.slip.ghost ? "on" : ""}"><input type="checkbox" data-act="slip-ghost" ${S.slip.ghost ? "checked" : ""}><span class="knob"></span><span class="gs-label"><b>Ghost bet</b><small>Track it without placing it. It won't count toward your P/L.</small></span></label>
    <button class="btn primary block" data-act="slip-track">Track ${S.slip.ghost ? "ghost " : ""}${mode === "parlay" ? "parlay" : n > 1 ? "bets" : "bet"}</button>
  </div>`;
}

export function towinText(l) {
  const st = num(S.slip.stakes[l.id]);
  return st > 0 ? `To win <b>${fmtMoney(toWin(st, l.odds))}</b>` : `$${settings.unit} wins ${fmtMoney(toWin(settings.unit, l.odds))}`;
}

/** Explains why a book's ticket payout differs from multiplying the leg prices. */
export function mismatchNote(ticket, calc) {
  if (!(ticket > 0) || !(calc > 0)) return "";
  const diff = ticket - calc;
  if (Math.abs(diff) < 0.01) return `<div class="match ok">✓ Matches your ticket to the cent</div>`;
  return `<div class="match">Using your ticket's <b>${fmtMoney(ticket)}</b>. The leg prices multiply to ${fmtMoney(calc)} (${fmtMoney(diff, { sign: true })}) — books round each leg's price, price same-game parlays with their own correlation math, and prices can move between building a slip and placing it.</div>`;
}

export function slipSummary(c) {
  if (S.slip.mode === "parlay") {
    return `<div class="summary">
      <div><span>Odds</span><b class="odds-big">${odds(c.parlayOdds)}</b><small>${fmt() === "american" ? `${formatOdds(c.parlayOdds, "decimal")}×` : formatOdds(c.parlayOdds, "american")}</small></div>
      <div><span>Hit chance</span><b>${fmtPct(c.prob)}</b><small>implied, with vig</small></div>
      <div><span>To win</span><b class="pos">${fmtMoney(c.win)}</b><small>payout ${fmtMoney(c.payout)}</small></div>
    </div>${mismatchNote(c.ticket, c.calcPayout)}`;
  }
  return `<div class="summary">
    <div><span>Total risk</span><b>${fmtMoney(c.singlesRisk)}</b></div>
    <div><span>Max win</span><b class="pos">${fmtMoney(c.singlesWin)}</b></div>
    <div><span>As a parlay</span><b>${c.legs.length > 1 ? odds(c.rawParlay) : "—"}</b><small>${c.legs.length > 1 ? `$${settings.unit} wins ${fmtMoney(toWin(settings.unit, c.rawParlay))}` : "add a leg"}</small></div>
  </div>`;
}

export function stepper(id, text, act, key, placeholder = "") {
  return `<div class="stepper">
    <button data-act="${act}-step" data-id="${esc(key)}" data-dir="-1" aria-label="Shorter odds">−</button>
    <input id="${esc(id)}" data-in="${act}" data-id="${esc(key)}" value="${esc(text)}" placeholder="${esc(placeholder)}" inputmode="text" autocomplete="off" spellcheck="false">
    <button data-act="${act}-step" data-id="${esc(key)}" data-dir="1" aria-label="Longer odds">+</button>
  </div>`;
}
