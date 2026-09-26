// Sharing a bet (or an unplaced slip) as a link + image, and tailing one a friend sent.

import { formatOdds, fmtMoney, toWin } from "../odds.js";
import { betStatus, ticketDecimal, potentialPayout, betProfit, legLive, legLabel } from "../grade.js";
import { encodeShare, decodeShare, shareUrl, shareText } from "../share.js";
import { drawShareCard, canvasToBlob } from "../sharecard.js";
import { esc, relDay, fmtTime, statusText, logo, icons } from "../ui.js";
import { closeBtn, openSheet, pill, render } from "../render.js";
import { newFormLeg, openAdd } from "./add.js";
import { slipCalc } from "../market.js";
import { $, S, fmt, game, odds, saveBets, saveSettings, settings, toast } from "../state.js";
import { uid } from "../store.js";

// ───────── building what gets shared ─────────

/** A bet-shaped object for the current slip, so slips share the same way bets do. */
function slipAsBet() {
  const c = slipCalc();
  return {
    id: `slip-${uid()}`,
    createdAt: new Date().toISOString(),
    stake: S.slip.mode === "parlay" ? c.stake : 0,
    book: S.slip.book || "",
    oddsOverride: S.slip.mode === "parlay" && c.parlayOdds !== c.rawParlay ? c.parlayOdds : undefined,
    legs: c.legs.map((l) => ({ id: l.id, pick: l.pick, odds: l.odds, status: "open", gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff })),
  };
}

export function openShare({ betId, slip = false }) {
  const bet = slip ? slipAsBet() : S.bets.find((b) => b.id === betId);
  if (!bet?.legs?.length) return toast("Nothing to share yet", "err");
  S.share = { bet, kind: slip ? "slip" : "bet", includeStake: false, preview: "" };
  openSheet({ kind: "share", id: bet.id });
  refreshPreview();
}

function current() {
  const { bet, kind, includeStake } = S.share;
  const code = encodeShare(bet, { name: settings.shareName || "", includeStake, kind });
  const url = shareUrl(code, location.origin + location.pathname);
  const st = kind === "slip" ? "open" : betStatus(bet);
  const price = kind === "slip" && bet.legs.length === 1 ? bet.legs[0].odds : ticketDecimal(bet);
  const text = shareText({ kind, price, legs: bet.legs.map((l) => ({ pick: legLabel(l, game(l.gameId)) })) }, {
    decimal: fmt() === "decimal",
    status: st,
    profit: includeStake && st === "won" ? betProfit(bet) : undefined,
  });
  return { url, text, st, price };
}

function cardData() {
  const { bet, kind, includeStake } = S.share;
  const { st, price } = current();
  const n = bet.legs.length;
  const legs = bet.legs.map((l) => {
    const g = game(l.gameId);
    const meta = g
      ? g.state === "pre"
        ? `${g.shortName} · ${relDay(g.date)} ${g.timeValid ? fmtTime(g.date) : ""}`.trim()
        : `${g.away.abbr} ${g.away.score ?? 0} – ${g.home.abbr} ${g.home.score ?? 0} · ${statusText(g)}`
      : l.gameLabel ? `${l.gameLabel}${l.kickoff ? ` · ${relDay(l.kickoff)}` : ""}` : "";
    return { pick: legLabel(l, g), meta, odds: formatOdds(l.odds, fmt()), status: l.status };
  });
  let money = "";
  if (includeStake && bet.stake > 0) {
    money = st === "won" ? `Cashed ${fmtMoney(bet.stake + betProfit(bet))} on ${fmtMoney(bet.stake)}` : st === "lost" ? `${fmtMoney(bet.stake)} down` : `${fmtMoney(bet.stake)} to win ${fmtMoney(potentialPayout(bet) - bet.stake)}`;
  } else if (st === "open") {
    money = `$10 wins ${fmtMoney(toWin(10, price))}`;
  }
  return {
    kind,
    title: n > 1 ? `${n}-leg parlay${bet.book ? ` · ${bet.book}` : ""}` : `Straight bet${bet.book ? ` · ${bet.book}` : ""}`,
    price: formatOdds(price, fmt()),
    from: settings.shareName || "",
    status: bet.cashout != null ? "cashout" : st,
    legs,
    money,
    footer: `Tail it on hedgehog · ${location.host}`,
  };
}

let previewToken = 0;
async function refreshPreview() {
  const token = ++previewToken;
  const cv = await drawShareCard(cardData());
  if (token !== previewToken || !S.share) return;
  S.share.canvas = cv;
  const img = $("#share-img");
  if (img) img.src = cv.toDataURL("image/png");
  const link = $("#share-link");
  if (link) link.textContent = current().url;
}

export function sheetShare() {
  const sh = S.share;
  if (!sh) return `<div class="sheet-h"><h2>Share</h2>${closeBtn()}</div>`;
  const { url } = current();
  const canStake = sh.bet.stake > 0;
  return `<div class="sheet-h"><h2>${sh.kind === "slip" ? "Share your slip" : "Share this bet"}</h2>${closeBtn()}</div>
    <div class="share-prev"><img id="share-img" alt="Share card preview"></div>
    <label class="field"><span>Your name <small>shown to friends who open it</small></span><input id="share-name" data-in="share-name" maxlength="40" placeholder="e.g. Mason" value="${esc(settings.shareName || "")}" autocomplete="nickname"></label>
    ${canStake ? `<label class="switch share-sw ${sh.includeStake ? "on" : ""}"><input type="checkbox" data-act="share-stake" ${sh.includeStake ? "checked" : ""}><span class="knob"></span><span class="gs-label"><b>Show my stake</b><small>Off by default. Friends see odds and picks only.</small></span></label>` : ""}
    <div class="share-actions">
      <button class="btn primary" data-act="share-native">${icons.ext} Share</button>
      <button class="btn" data-act="share-copy">${icons.link} Copy link</button>
      <button class="btn" data-act="share-image">${icons.upload} Save image</button>
    </div>
    <p class="muted small share-help">Friends tap the link to see your ticket with live scores and tail it in one tap. No account needed. The ticket is inside the link itself.</p>
    <code class="share-link" id="share-link">${esc(url)}</code>`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.("copy");
    ta.remove();
    return !!ok;
  }
}

export const shareActions = {
  "share-bet": (el) => openShare({ betId: el.dataset.id }),
  "share-slip": () => openShare({ slip: true }),
  "share-stake": (el) => {
    S.share.includeStake = el.checked;
    el.closest(".switch")?.classList.toggle("on", el.checked);
    refreshPreview();
  },
  "share-native": async () => {
    const { url, text } = current();
    const file = S.share.canvas ? new File([await canvasToBlob(S.share.canvas)], "hedgehog-ticket.png", { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file], text, url })) return await navigator.share({ files: [file], text: `${text}\n${url}` });
      if (navigator.share) return await navigator.share({ title: "hedgehog", text, url });
    } catch (e) {
      if (e?.name === "AbortError") return; // user closed the share menu
    }
    toast((await copy(`${text}\n${url}`)) ? "Link copied. Paste it in a text" : "Couldn't copy. Long-press the link below", "won");
  },
  "share-copy": async () => {
    const { url } = current();
    toast((await copy(url)) ? "Link copied" : "Couldn't copy. Long-press the link below", (await copy(url)) ? "won" : "err");
  },
  "share-image": async () => {
    if (!S.share.canvas) return;
    const blob = await canvasToBlob(S.share.canvas);
    const file = new File([blob], "hedgehog-ticket.png", { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] }); // iPhone: "Save Image"
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hedgehog-ticket.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  },
  "tail-it": () => tailIt(),
  "tail-ghost": () => ghostIt(),
  "tail-view": () => {
    const b = S.bets.find((x) => x.tail?.src && x.tail.src === S.tailIn?.src);
    S.f.betsTab = b?.ghost ? "ghosts" : "open";
    if (b) openSheet({ kind: "bet", id: b.id });
  },
};

export const shareInputs = {
  "share-name": (el) => {
    settings.shareName = el.value.slice(0, 40);
    saveSettings();
    clearTimeout(shareInputs._t);
    shareInputs._t = setTimeout(refreshPreview, 250);
  },
};

// ───────── receiving a link ─────────

/** Opens the tail sheet if the page was opened from a share link. Returns true if it did. */
export function handleTailLink() {
  const m = location.hash.match(/^#tail=([\w-]+)/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search + "#bets");
  const t = decodeShare(m[1]);
  if (!t) {
    toast("That share link looks broken or cut off. Ask for it again", "err");
    return true;
  }
  S.tab = "bets";
  S.tailIn = t;
  openSheet({ kind: "tail" });
  return true;
}

const pseudoBet = (t) => ({ stake: t.stake || 0, oddsOverride: t.oddsOverride, boostPct: t.boostPct, ticketPayout: t.ticketPayout, cashout: t.cashout, legs: t.legs });

export function sheetTail() {
  const t = S.tailIn;
  if (!t) return `<div class="sheet-h"><h2>Shared bet</h2>${closeBtn()}</div>`;
  const pb = pseudoBet(t);
  const st = t.cashout != null ? "cashout" : betStatus(pb);
  const n = t.legs.length;
  const who = esc(t.from || "A friend");
  const what = n > 1 ? `${n}-leg parlay` : "pick";
  const price = ticketDecimal(pb);
  const existing = t.src && S.bets.find((b) => b.tail?.src === t.src);
  const started = t.legs.some((l) => {
    const g = game(l.gameId);
    return g ? g.state !== "pre" : l.kickoff && Date.parse(l.kickoff) < Date.now();
  });
  const legs = t.legs.map((l) => {
    const g = game(l.gameId);
    const lv = legLive({ ...l, status: l.status || "open" }, g);
    const meta = g
      ? g.state === "pre" ? `${esc(g.shortName)} · ${esc(relDay(g.date))} ${g.timeValid ? esc(fmtTime(g.date)) : ""}` : `${logo(g.away, 16)} ${esc(g.away.abbr)} ${g.away.score ?? 0} – ${esc(g.home.abbr)} ${g.home.score ?? 0} ${logo(g.home, 16)} · ${esc(statusText(g))}${lv.text ? ` · <b>${esc(lv.text)}</b>` : ""}`
      : l.gameLabel ? `${esc(l.gameLabel)}${l.kickoff ? ` · ${esc(relDay(l.kickoff))}` : ""}` : "";
    return `<div class="leg ${lv.state}"><span class="ldot"></span><div class="lmain"><div class="lpick">${esc(legLabel(l, g))}</div>${meta ? `<div class="lmeta">${meta}</div>` : ""}</div><span class="lodds">${odds(l.odds)}</span></div>`;
  }).join("");
  const settled = st !== "open";
  const actions = existing
    ? `<div class="notice">${icons.bets}<span>You're already tracking this one${existing.ghost ? " as a ghost" : ""}.</span><button class="btn sm" data-act="tail-view">View it</button></div>`
    : settled
      ? `<p class="muted small">This one's already settled, so there's nothing to tail. Enjoy the ${st === "won" ? "flex" : "pain"}.</p>`
      : `${started ? `<div class="notice warn">${icons.clock}<span>Some of these games have already kicked off. Your book may not offer these prices anymore.</span></div>` : ""}
         <div class="tail-actions">
           <button class="btn primary" data-act="tail-it">Tail it</button>
           <button class="btn" data-act="tail-ghost" title="Track it without betting; stays out of your P/L">👻 Ghost it</button>
         </div>
         <p class="muted small">Tail it opens the bet filled in so you just add your stake. Ghost it tracks it without betting.</p>`;
  return `<div class="sheet-h"><h2>${t.kind === "slip" ? `${who} is thinking about this` : `${who} shared a ${what}`}</h2>${closeBtn()}</div>
    <div class="tail-card bet ${st}">
      <header><span class="btype ${n > 1 ? "parlay" : ""}">${n > 1 ? `${n}-leg parlay` : "Straight"}</span>${t.book ? `<span class="book">${esc(t.book)}</span>` : ""}${t.boostPct ? `<span class="boost">+${t.boostPct}% boost</span>` : ""}<span class="grow"></span><span class="bodds">${odds(price)}</span></header>
      <div class="legs">${legs}</div>
      <footer>${t.stake ? `<span>Risk <b>${fmtMoney(t.stake)}</b></span>` : `<span class="muted">$10 wins <b>${fmtMoney(toWin(10, price))}</b></span>`}<span class="grow"></span>${pill(st)}</footer>
    </div>
    ${actions}`;
}

function tailLegs(t) {
  return t.legs.map((l) => ({ pick: l.pick, odds: l.odds, gameId: l.gameId, market: l.market, side: l.side, line: l.line, gameLabel: l.gameLabel, kickoff: l.kickoff }));
}

function tailIt() {
  const t = S.tailIn;
  openAdd();
  const legs = tailLegs(t).map((l) => newFormLeg({ ...l, oddsText: formatOdds(l.odds, fmt()) }));
  Object.assign(S.form, {
    type: legs.length > 1 ? "parlay" : "straight",
    legs,
    override: t.oddsOverride && legs.length > 1 ? formatOdds(t.oddsOverride, fmt()) : "",
    boost: t.boostPct ? String(t.boostPct) : "",
    note: `Tailed from ${t.from || "a friend"}`,
    tail: { from: t.from || "", src: t.src },
  });
  S.sheet.dirty = true;
  render();
}

function ghostIt() {
  const t = S.tailIn;
  S.bets.unshift({
    id: uid(),
    createdAt: new Date().toISOString(),
    type: t.legs.length > 1 ? "parlay" : "straight",
    stake: settings.unit,
    book: "",
    note: `Tailed from ${t.from || "a friend"}`,
    ghost: true,
    tail: { from: t.from || "", src: t.src },
    ...(t.oddsOverride ? { oddsOverride: t.oddsOverride } : {}),
    ...(t.boostPct ? { boostPct: t.boostPct } : {}),
    legs: tailLegs(t).map((l) => ({ id: uid(), status: "open", ...l })),
  });
  saveBets();
  S.sheet = null;
  S.f.betsTab = "ghosts";
  toast(`👻 Ghosting ${t.from ? `${t.from}'s` : "their"} ${t.legs.length > 1 ? "parlay" : "pick"}. It's on your Ghosts tab`, "won");
  render();
}
