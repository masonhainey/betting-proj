// Add-a-pick form.

import { americanToDecimal, parseOdds, formatOdds, parlayDecimal, toWin, stakeForWin, impliedProb, fmtMoney, fmtPct, fmtLine } from "../odds.js";
import { uid } from "../store.js";
import { esc, fmtTime, relDay, logo, icons } from "../ui.js";
import { markets } from "../market.js";
import { closeBtn, fmtToggle, openSheet, render } from "../render.js";
import { $, S, fmt, game, num, odds, saveBets, saveSettings, settings, toast } from "../state.js";
import { mismatchNote, stepper } from "../views/build.js";

// Add-a-pick form ---------------------------------------------------------

export function newFormLeg(extra = {}) {
  const d = americanToDecimal(-110);
  return { id: uid(), pick: "", odds: d, oddsText: formatOdds(d, fmt()), ...extra };
}

export function openAdd(prefill) {
  S.form = {
    type: "straight",
    legs: [newFormLeg(prefill || {})],
    stake: String(settings.unit),
    win: "",
    lastEdited: "stake",
    override: "",
    boost: "",
    book: settings.lastBook || "",
    note: "",
    linking: null,
    q: "",
    linkGame: null,
    ticket: "",
    link: "",
    source: null,
  };
  if (prefill?.gameId) {
    S.form.linking = S.form.legs[0].id;
    S.form.linkGame = prefill.gameId;
    S.form.legs[0] = newFormLeg();
  }
  openSheet({ kind: "add" });
}

export function formCalc() {
  const f = S.form;
  const legs = f.type === "straight" ? f.legs.slice(0, 1) : f.legs;
  const valid = legs.every((l) => l.odds > 1);
  const calc = parlayDecimal(legs.map((l) => l.odds));
  const override = f.type === "parlay" ? parseOdds(f.override)?.decimal : null;
  let dCalc = override > 1 ? override : calc;
  const boost = num(f.boost);
  if (boost > 0) dCalc = 1 + (dCalc - 1) * (1 + boost / 100);
  let d = dCalc;
  let stake = num(f.stake);
  if (f.lastEdited === "win") stake = stakeForWin(num(f.win), d);
  const ticket = num(f.ticket);
  // The payout printed on the ticket is the truth; derive the effective odds from it.
  if (ticket > 0 && stake > 0 && f.lastEdited !== "win") d = ticket / stake;
  return { legs, valid: valid || ticket > 0, calc, d, stake, win: toWin(stake, d), payout: stake * d, calcPayout: valid ? stake * dCalc : 0, ticket, prob: impliedProb(d) };
}

export function sheetAdd() {
  const f = S.form;
  const c = formCalc();
  const legs = f.type === "straight" ? f.legs.slice(0, 1) : f.legs;
  const legHtml = legs.map((l, i) => {
    const g = game(l.gameId);
    return `<div class="fleg">
      ${f.type === "parlay" ? `<div class="fl-h"><span>Leg ${i + 1}</span>${legs.length > 2 ? `<button class="link" data-act="form-rm-leg" data-id="${l.id}">Remove</button>` : ""}</div>` : ""}
      <label class="field"><span>Pick</span><input id="f-pick-${l.id}" data-in="f-pick" data-id="${l.id}" placeholder="${i ? "e.g. Over 48.5" : "e.g. Georgia -7.5, Texas ML, Over 52.5"}" value="${esc(l.pick)}" autocomplete="off"></label>
      <div class="field ${l.uncertain ? "unsure" : ""}"><span>Odds <small>${l.uncertain ? "the +/- sign didn't come through. Check it against your slip" : "type +150, -110, 2.5, x9.3 or 5/2"}</small></span>${stepper(`f-odds-${l.id}`, l.oddsText, "f-odds", l.id)}</div>
      ${g
        ? `<div class="linked">${logo(g.away, 18)}${logo(g.home, 18)}<span>Tracking <b>${esc(g.shortName)}</b> · ${esc(relDay(g.date))} ${esc(fmtTime(g.date))}${l.market && l.market !== "other" ? " · auto-grades" : ""}</span><button class="link" data-act="form-unlink" data-id="${l.id}">Unlink</button></div>`
        : f.linking === l.id ? linkPicker(l) : `<button class="link" data-act="form-link" data-id="${l.id}">${icons.live} Link a game for live tracking & auto-grading</button>`}
    </div>`;
  }).join("");
  const src = f.source;
  const imported = src
    ? `<div class="imported">${src.img ? `<img src="${esc(src.img)}" alt="Your bet slip">` : `<span class="imp-ico">${icons.upload}</span>`}
        <div><b>Filled in from your ${src.img ? "screenshot" : "text"}${f.book ? ` · ${esc(f.book)}` : ""}</b>
        <span>Check each leg and price — reading screenshots isn't perfect.${src.missing ? ` <b>${src.missing} leg${src.missing > 1 ? "s" : ""} couldn't be read</b>; fill ${src.missing > 1 ? "them" : "it"} in below.` : ""}${src.linked ? ` ${src.linked} of ${legs.length} matched to a game for live tracking.` : ""}</span></div></div>`
    : "";
  return `<div class="sheet-h"><h2>${src ? "Review imported bet" : "Add a pick"}</h2>${closeBtn()}</div>
    ${imported}
    <div class="form-top">
      <div class="seg type-seg">
        <button class="${f.type === "straight" ? "on" : ""}" data-act="form-type" data-v="straight"><b>Straight</b><small>one pick</small></button>
        <button class="${f.type === "parlay" ? "on" : ""}" data-act="form-type" data-v="parlay"><b>Parlay</b><small>2+ legs, one ticket</small></button>
      </div>
      ${fmtToggle("form-fmt")}
    </div>
    <div class="flegs">${legHtml}</div>
    ${f.type === "parlay" ? `<button class="btn sm ghost" data-act="form-add-leg">+ Add leg</button>
      <div class="pbox">
        <div class="prow"><label>Book's parlay price <small>if it differs</small></label>${stepper("f-override", f.override, "f-override", "", "calc " + odds(c.calc))}</div>
        <div class="prow"><label>Profit boost</label><label class="stake pct"><input id="f-boost" data-in="f-boost" inputmode="decimal" placeholder="0" value="${esc(f.boost)}"><span>%</span></label></div>
      </div>` : ""}
    <div class="money">
      <label class="field"><span>Stake</span><label class="stake"><span>$</span><input id="f-stake" data-in="f-stake" inputmode="decimal" value="${esc(f.lastEdited === "win" ? (c.stake ? c.stake.toFixed(2) : "") : f.stake)}"></label></label>
      <span class="swap">⇄</span>
      <label class="field"><span>To win</span><label class="stake"><span>$</span><input id="f-win" data-in="f-win" inputmode="decimal" value="${esc(f.lastEdited === "win" ? f.win : c.win ? c.win.toFixed(2) : "")}"></label></label>
    </div>
    <label class="field"><span>Ticket payout <small>optional · your book's exact number</small></span><label class="stake"><span>$</span><input id="f-ticket" data-in="f-ticket" inputmode="decimal" placeholder="${c.calcPayout ? c.calcPayout.toFixed(2) : "from your book"}" value="${esc(f.ticket)}"></label></label>
    <div id="form-calc">${formCalcHtml(c)}</div>
    <div class="money">
      <label class="field"><span>Book</span><input id="f-book" data-in="f-book" list="books" placeholder="DraftKings, FanDuel…" value="${esc(f.book)}"></label>
    </div>
    <label class="field"><span>Note</span><input id="f-note" data-in="f-note" placeholder="Optional" value="${esc(f.note)}"></label>
    <label class="switch ghost-sw ${f.ghost ? "on" : ""}"><input type="checkbox" data-act="form-ghost" ${f.ghost ? "checked" : ""}><span class="knob"></span><span class="gs-label"><b>Ghost bet</b><small>Track it without placing it. It won't count toward your P/L.</small></span></label>
    <button class="btn primary block" data-act="form-save">${saveLabel(f, legs.length)}</button>`;
}

function saveLabel(f, n) {
  const what = f.type === "parlay" ? `${n}-leg parlay` : "bet";
  return f.ghost ? `Track ghost ${what}` : `Track ${what}`;
}

export function formCalcHtml(c) {
  return `<div class="summary">
    <div><span>${S.form.type === "parlay" ? "Parlay odds" : "Odds"}</span><b class="odds-big">${c.valid ? odds(c.d) : "—"}</b><small>${c.valid ? (fmt() === "american" ? `${formatOdds(c.d, "decimal")}×` : formatOdds(c.d, "american")) : "check odds"}</small></div>
    <div><span>Implied</span><b>${fmtPct(c.prob)}</b></div>
    <div><span>Payout</span><b class="pos">${fmtMoney(c.payout || 0)}</b><small>profit ${fmtMoney(c.win || 0)}</small></div>
  </div>${S.form.lastEdited !== "win" ? mismatchNote(c.ticket, c.calcPayout) : ""}`;
}

export function linkPicker(l) {
  const f = S.form;
  if (f.linkGame) {
    const g = game(f.linkGame);
    const m = markets(g);
    const opt = (s, label) => (s ? `<button class="sel" data-act="form-pick-sel" data-key="${esc(s.key)}" data-id="${l.id}"><span class="ln">${label}</span><span class="pr">${odds(s.odds)}</span></button>` : "");
    return `<div class="picker">
      <div class="pk-h">${logo(g.away, 18)}${logo(g.home, 18)}<b>${esc(g.shortName)}</b><span class="muted">${esc(relDay(g.date))}</span><span class="grow"></span><button class="link" data-act="form-link-back">Back</button></div>
      ${m ? `<div class="pk-grid">
        ${opt(m.spreadAway, `${esc(g.away.abbr)} ${fmtLine(m.spreadAway?.line)}`)}${opt(m.spreadHome, `${esc(g.home.abbr)} ${fmtLine(m.spreadHome?.line)}`)}
        ${opt(m.over, `Over ${m.over?.line}`)}${opt(m.under, `Under ${m.under?.line}`)}
        ${opt(m.mlAway, `${esc(g.away.abbr)} ML`)}${opt(m.mlHome, `${esc(g.home.abbr)} ML`)}
      </div>` : `<p class="muted small">No posted lines for this game.</p>`}
      <button class="link" data-act="form-link-plain" data-id="${l.id}">Just track the score (prop / other market)</button>
    </div>`;
  }
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const res = [...S.games.values()]
    .filter((g) => g.state !== "post" && new Date(g.date) - now < 30 * 864e5)
    .filter((g) => !q || `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q))
    .sort((a, b) => (a.state === "in" ? -1 : 0) - (b.state === "in" ? -1 : 0) || new Date(a.date) - new Date(b.date))
    .slice(0, 8);
  return `<div class="picker">
    <div class="pk-h"><label class="search">${icons.search}<input id="f-q" data-in="f-q" placeholder="Search today & upcoming games" value="${esc(f.q)}" autocomplete="off"></label><button class="link" data-act="form-link-cancel">Cancel</button></div>
    <div class="pk-res" id="pk-res">${res.map((g) => `<button class="pk-row" data-act="form-link-game" data-id="${g.id}">${logo(g.away, 18)}${esc(g.away.short)} <span class="muted">@</span> ${logo(g.home, 18)}${esc(g.home.short)}<span class="grow"></span><small class="muted">${g.state === "in" ? "Live" : esc(relDay(g.date))}</small></button>`).join("") || `<p class="muted small">No games found.</p>`}</div>
  </div>`;
}

export function saveForm() {
  const f = S.form;
  const c = formCalc();
  const legs = c.legs;
  for (const l of legs) {
    if (!l.pick.trim()) return toast(`Name your pick${legs.length > 1 ? "s" : ""} (e.g. "Georgia -7.5")`, "err");
    if (!(l.odds > 1) && !(num(f.ticket) > 0)) return toast(`Odds for "${l.pick}" don't look right`, "err");
  }
  if (f.type === "parlay" && legs.length < 2) return toast("A parlay needs at least two legs", "err");
  if (!(c.stake > 0)) return toast("Enter a stake", "err");
  if (!c.legs.every((l) => l.odds > 1) && !(num(f.ticket) > 0)) return toast("Check the odds on each leg", "err");
  const bet = {
    id: uid(),
    createdAt: new Date().toISOString(),
    type: f.type,
    stake: Math.round(c.stake * 100) / 100,
    book: f.book.trim(),
    note: f.note.trim(),
    legs: legs.map((l) => ({ id: uid(), pick: l.pick.trim(), odds: l.odds, status: "open", gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff })),
  };
  if (f.ghost) bet.ghost = true;
  if (num(f.ticket) > 0 && f.lastEdited !== "win") bet.ticketPayout = Math.round(num(f.ticket) * 100) / 100;
  if (f.link) bet.link = f.link;
  if (f.type === "parlay") {
    const o = parseOdds(f.override)?.decimal;
    if (o > 1) bet.oddsOverride = o;
    if (num(f.boost) > 0) bet.boostPct = num(f.boost);
  }
  if (bet.book) settings.lastBook = bet.book, saveSettings();
  S.bets.unshift(bet);
  saveBets();
  S.sheet = null;
  S.form = null;
  S.f.betsTab = f.ghost ? "ghosts" : "open";
  toast(`${f.ghost ? "👻 Tracking your pass: " : "Tracking "}${f.type === "parlay" ? `${legs.length}-leg parlay` : bet.legs[0].pick}`, "won");
  if (S.tab !== "bets") location.hash = "bets";
  render();
}

export function paintForm() {
  const c = formCalc();
  const el = $("#form-calc");
  if (el) el.innerHTML = formCalcHtml(c);
  const f = S.form;
  if (f.lastEdited === "win") {
    const s = $("#f-stake");
    if (s && document.activeElement !== s) s.value = c.stake ? c.stake.toFixed(2) : "";
  } else {
    const w = $("#f-win");
    if (w && document.activeElement !== w) w.value = c.win ? c.win.toFixed(2) : "";
  }
  const ov = $("#f-override");
  if (ov) ov.placeholder = "calc " + odds(c.calc);
  const tk = $("#f-ticket");
  if (tk) tk.placeholder = c.calcPayout ? c.calcPayout.toFixed(2) : "from your book";
  const btn = $('[data-act="form-save"]');
  if (btn) btn.textContent = saveLabel(f, c.legs.length);
}
