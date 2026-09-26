// Bets tab: P/L hero, sweat cards, bet cards, insights.

import { fmtMoney, fmtPct } from "../odds.js";
import { betStatus, betProfit, ticketDecimal, potentialPayout, legLive, legLabel, summarize, breakdown } from "../grade.js";
import * as cloud from "../cloud.js";
import { esc, fmtTime, relDay, logo, statusText, curveSvg, icons } from "../ui.js";
import { CLOUD } from "../account.js";

import { chip, pill } from "../render.js";
import { dropZone } from "../sheets/import.js";
import { S, game, odds, settings } from "../state.js";

// ── Bets ──

export function periodSince() {
  const p = S.f.period;
  return p === "7d" ? new Date(Date.now() - 7 * 864e5) : p === "30d" ? new Date(Date.now() - 30 * 864e5) : null;
}

export function viewBets() {
  const sum = summarize(S.bets, { since: periodSince() });
  const open = S.bets.filter((b) => betStatus(b) === "open");
  const settled = S.bets.filter((b) => betStatus(b) !== "open").sort((a, b) => new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt));
  const sweating = open.filter((b) => b.legs.some((l) => l.status === "open" && game(l.gameId)?.state === "in"));

  if (!S.bets.length) {
    return `<section class="empty-hero">
      <div class="eh-mark">${icons.bets}</div>
      <h1>Your bets, front and center.</h1>
      <p>Log a pick from any book — straight or parlay, American or decimal odds — and hedgehog tracks it against live scores, grades it when the game ends, and keeps your P/L honest.</p>
      <div class="eh-actions">
        <button class="btn primary" data-act="open-add">${icons.plus} Add a pick</button>
        <button class="btn" data-act="tab" data-v="build">Build a slip</button>
        ${settings.demo ? "" : `<button class="btn ghost" data-act="demo-on">Explore with demo data</button>`}
      </div>
      ${CLOUD && !cloud.currentUser() ? `<p class="eh-sync">${icons.cloud} Already using hedgehog on another device? <button class="link" data-act="open-settings">Sign in to sync your bets</button></p>` : ""}
      ${dropZone()}
    </section>`;
  }

  const profitCls = sum.profit > 0 ? "pos" : sum.profit < 0 ? "neg" : "";
  const hero = `<section class="card hero">
    <div class="hero-top">
      <div>
        <div class="eyebrow">Net profit</div>
        <div class="big ${profitCls}">${fmtMoney(sum.profit, { sign: true })}</div>
        <div class="sub">${sum.count} settled · ROI <b class="${profitCls}">${fmtPct(sum.roi)}</b></div>
      </div>
      <div class="seg sm">${["7d", "30d", "all"].map((p) => `<button class="${S.f.period === p ? "on" : ""}" data-act="period" data-v="${p}">${p === "all" ? "All" : p.toUpperCase()}</button>`).join("")}</div>
    </div>
    <div class="chart">${curveSvg(sum.curve)}</div>
    <div class="stats">
      <div><span>Record</span><b>${sum.w}-${sum.l}${sum.p ? `-${sum.p}` : ""}</b></div>
      <div><span>Win rate</span><b>${fmtPct(sum.winRate, 0)}</b></div>
      <div><span>Staked</span><b>${fmtMoney(sum.staked, { cents: false })}</b></div>
      <div><span>Streak</span><b class="${sum.streak[0] === "W" ? "pos" : sum.streak[0] === "L" ? "neg" : ""}">${sum.streak}</b></div>
      <div class="wide"><span>Open</span><b>${sum.openCount} · ${fmtMoney(sum.atRisk, { cents: false })} risk → ${fmtMoney(sum.potential, { cents: false })}</b></div>
    </div>
  </section>`;

  const sweat = sweating.length
    ? `<section class="sweat-sec"><div class="sec-h"><h2><span class="dot live"></span>Sweating now</h2><span class="muted">${sweating.length} live</span></div>
       <div class="sweat">${sweating.map(sweatCard).join("")}</div></section>`
    : "";

  const tabs = `<div class="tabs">
    ${chip(`Open <em>${open.length}</em>`, "bets-tab", "open", S.f.betsTab === "open")}
    ${chip(`Settled <em>${settled.length}</em>`, "bets-tab", "settled", S.f.betsTab === "settled")}
    ${chip("Insights", "bets-tab", "insights", S.f.betsTab === "insights")}
    <span class="grow"></span>
    <button class="btn sm primary tabs-add" data-act="open-add">${icons.plus} Add pick</button>
  </div>`;

  let list;
  if (S.f.betsTab === "insights") list = insightsHtml();
  else {
    const arr = S.f.betsTab === "open" ? open : settled;
    list = arr.length
      ? `<div class="bet-list">${groupByDay(arr, S.f.betsTab === "open" ? (b) => b.createdAt : (b) => b.settledAt || b.createdAt).map(([k, bs]) => `<div class="day-h">${esc(k)}</div>${bs.map(betCard).join("")}`).join("")}</div>`
      : `<div class="empty">${S.f.betsTab === "open" ? "No open bets. Tap <b>Add pick</b> or build a slip." : "Nothing settled yet."}</div>`;
  }
  const page = `<div class="view-h page"><div><div class="eyebrow">Game day workspace</div><h1>College football</h1><p class="muted">Track straight bets and parlays alongside live scores.</p></div></div>`;
  const syncBanner = CLOUD && !cloud.currentUser() && !settings.syncBannerDismissed
    ? `<div class="notice sync-banner">${icons.cloud}<span><b>Keep your phone and computer in sync.</b> Create a free account and your bets follow you everywhere.</span><button class="btn sm primary" data-act="open-settings">Sign in</button><button class="icon-btn sm" data-act="dismiss-sync" aria-label="Dismiss">${icons.x}</button></div>`
    : "";
  return `${page}${syncBanner}<div class="bets-grid">${sweat}${hero}${dropZone(true)}<div class="bets-main">${tabs}${list}</div></div>`;
}

export function groupByDay(arr, dateFn) {
  const m = new Map();
  for (const x of arr) {
    const k = relDay(dateFn(x));
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.entries()];
}

export function sweatCard(b) {
  const legs = b.legs.filter((l) => l.gameId && game(l.gameId)?.state === "in");
  return `<button class="sweat-card" data-act="open-bet" data-id="${b.id}">
    ${legs.map((l) => {
      const g = game(l.gameId);
      const lv = legLive(l, g);
      return `<div class="sw-leg ${lv.state}">
        <div class="sw-top"><span>${esc(legLabel(l, g))}</span>${pill(lv.state)}</div>
        <div class="sw-score">${logo(g.away, 20)}<b>${g.away.score ?? 0}</b><span class="muted">–</span><b>${g.home.score ?? 0}</b>${logo(g.home, 20)}<span class="clock">${esc(statusText(g))}</span></div>
        <div class="sw-text">${esc(lv.text)}</div>
      </div>`;
    }).join("")}
    <div class="sw-foot">${b.legs.length > 1 ? `${b.legs.length}-leg parlay · ` : ""}${fmtMoney(b.stake)} → ${fmtMoney(potentialPayout(b))}</div>
  </button>`;
}

export function betCard(b) {
  const st = betStatus(b);
  const d = ticketDecimal(b);
  const isParlay = b.legs.length > 1;
  const profit = betProfit(b);
  const won = b.legs.filter((l) => l.status === "won").length;
  const legsHtml = b.legs.map((l) => {
    const g = game(l.gameId);
    const lv = legLive(l, g);
    const meta = g
      ? g.state === "pre"
        ? `${esc(g.shortName)} · ${esc(relDay(g.date))} ${g.timeValid ? esc(fmtTime(g.date)) : "TBD"}`
        : `${esc(g.away.abbr)} ${g.away.score ?? 0} – ${esc(g.home.abbr)} ${g.home.score ?? 0} · ${esc(statusText(g))}${lv.text && l.status === "open" ? ` · <b>${esc(lv.text)}</b>` : ""}`
      : l.gameLabel
        ? `${esc(l.gameLabel)}${l.kickoff ? ` · ${esc(relDay(l.kickoff))}` : ""}`
        : "";
    return `<div class="leg ${lv.state}">
      <span class="ldot"></span>
      <div class="lmain"><div class="lpick">${esc(legLabel(l, g))}${l.autoGraded ? `<span class="auto" title="Graded automatically from the final score">auto</span>` : ""}</div>${meta ? `<div class="lmeta">${meta}</div>` : ""}</div>
      ${isParlay ? `<span class="lodds">${odds(l.odds)}</span>` : ""}
    </div>`;
  }).join("");
  return `<article class="bet ${st}" data-act="open-bet" data-id="${b.id}" tabindex="0">
    <header>
      <span class="btype ${isParlay ? "parlay" : ""}">${isParlay ? `${b.legs.length}-leg parlay` : "Straight"}</span>
      ${b.book ? `<span class="book">${esc(b.book)}</span>` : ""}
      ${b.boostPct ? `<span class="boost">+${b.boostPct}% boost</span>` : ""}
      <span class="grow"></span>
      <span class="bodds">${odds(d)}</span>
    </header>
    <div class="legs">${legsHtml}</div>
    ${isParlay && st === "open" ? `<div class="prog"><i style="width:${(won / b.legs.length) * 100}%"></i></div>` : ""}
    <footer>
      <span>Risk <b>${fmtMoney(b.stake)}</b></span>
      ${st === "open"
        ? `<span>To win <b>${fmtMoney(potentialPayout(b) - b.stake)}</b></span>${isParlay ? `<span class="muted">${won}/${b.legs.length} hit</span>` : ""}`
        : `<span class="${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}"><b>${fmtMoney(profit, { sign: true })}</b></span>`}
      <span class="grow"></span>${pill(st)}
    </footer>
  </article>`;
}

export function insightsHtml() {
  const table = (title, rows) => rows.length
    ? `<div class="card ins"><h3>${title}</h3><table><thead><tr><th></th><th>Bets</th><th>Record</th><th>Profit</th><th>ROI</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.count}</td><td>${r.w}-${r.l}${r.p ? `-${r.p}` : ""}</td><td class="${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}">${fmtMoney(r.profit, { sign: true, cents: false })}</td><td>${fmtPct(r.roi)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const bets = S.bets.filter((b) => !periodSince() || new Date(b.settledAt || b.createdAt) >= periodSince());
  const marketOf = (b) => (b.legs.length > 1 ? "Parlay" : { ml: "Moneyline", spread: "Spread", total: "Total" }[b.legs[0].market] || guessMarket(b.legs[0].pick));
  const oddsBucket = (b) => {
    const d = ticketDecimal(b);
    return d < 1.67 ? "-150 or shorter" : d < 2.1 ? "-150 to +110" : d < 4 ? "+110 to +300" : "+300 and up";
  };
  const s = summarize(bets);
  const avgOdds = bets.length ? bets.reduce((a, b) => a + ticketDecimal(b), 0) / bets.length : NaN;
  const be = Number.isFinite(avgOdds) ? 1 / avgOdds : NaN;
  return `<div class="ins-grid">
    <div class="card ins kpis">
      <div><span>Avg odds</span><b>${odds(avgOdds)}</b></div>
      <div><span>Break-even rate</span><b>${fmtPct(be)}</b></div>
      <div><span>Actual win rate</span><b class="${s.winRate > be ? "pos" : "neg"}">${fmtPct(s.winRate)}</b></div>
      <div><span>Best hit</span><b class="pos">${s.best && s.best.profit > 0 ? fmtMoney(s.best.profit, { sign: true }) : "—"}</b></div>
    </div>
    ${table("By bet type", breakdown(bets, (b) => (b.legs.length > 1 ? "Parlay" : "Straight")))}
    ${table("By market", breakdown(bets, marketOf))}
    ${table("By odds range", breakdown(bets, oddsBucket).sort((a, b) => ["-150 or shorter", "-150 to +110", "+110 to +300", "+300 and up"].indexOf(a.key) - ["-150 or shorter", "-150 to +110", "+110 to +300", "+300 and up"].indexOf(b.key)))}
    ${table("By book", breakdown(bets, (b) => b.book || "Unspecified"))}
  </div>`;
}

export function guessMarket(pick = "") {
  if (/\bml\b|moneyline/i.test(pick)) return "Moneyline";
  if (/\b(over|under|o\/u)\b/i.test(pick)) return "Total";
  if (/[+-]\d+(\.5)?\b/.test(pick)) return "Spread";
  return "Props & futures";
}
