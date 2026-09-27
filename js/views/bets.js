// Bets tab: P/L hero, sweat cards, bet cards, insights.

import { propMargin } from "../props.js";
import { fmtMoney, fmtPct } from "../odds.js";
import { betStatus, betProfit, ticketDecimal, potentialPayout, legLive, legLabel, summarize, breakdown } from "../grade.js";
import * as cloud from "../cloud.js";
import { esc, fmtTime, relDay, logo, statusText, curveSvg, icons } from "../ui.js";
import { CLOUD } from "../account.js";
import { realBets, ghostBets, ghostReport, parlayAutopsy, marketName } from "../autopsy.js";

import { chip, pill } from "../render.js";
import { dropZone } from "../sheets/import.js";
import { S, game, odds, settings } from "../state.js";

// ── Bets ──

export function periodSince() {
  const p = S.f.period;
  return p === "7d" ? new Date(Date.now() - 7 * 864e5) : p === "30d" ? new Date(Date.now() - 30 * 864e5) : null;
}

export function viewBets() {
  // Ghost bets are tracked and graded like any other, but never count toward your P/L.
  const real = realBets(S.bets);
  const ghosts = ghostBets(S.bets);
  const sum = summarize(real, { since: periodSince() });
  const byRecent = (a, b) => new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt);
  const open = real.filter((b) => betStatus(b) === "open");
  const settled = real.filter((b) => betStatus(b) !== "open").sort(byRecent);
  const live = (b) => betStatus(b) === "open" && b.legs.some((l) => l.status === "open" && game(l.gameId)?.state === "in");
  const sweating = [...open.filter(live), ...ghosts.filter(live)];

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
    ${chip(`Ghosts${ghosts.length ? ` <em>${ghosts.length}</em>` : ""}`, "bets-tab", "ghosts", S.f.betsTab === "ghosts")}
    ${chip("Insights", "bets-tab", "insights", S.f.betsTab === "insights")}
    <span class="grow"></span>
    <button class="btn sm primary tabs-add" data-act="open-add">${icons.plus} Add pick</button>
  </div>`;

  let list;
  if (S.f.betsTab === "insights") list = insightsHtml();
  else if (S.f.betsTab === "ghosts") list = ghostsHtml(ghosts);
  else {
    const arr = S.f.betsTab === "open" ? open : settled;
    list = arr.length
      ? `<div class="bet-list">${groupByDay(arr, S.f.betsTab === "open" ? (b) => b.createdAt : (b) => b.settledAt || b.createdAt).map(([k, bs]) => `<div class="day-h">${esc(k)}</div>${bs.map(betCard).join("")}`).join("")}</div>`
      : `<div class="empty">${S.f.betsTab === "open" ? "No open bets. Tap <b>Add pick</b> or build a slip." : "Nothing settled yet."}</div>`;
  }
  const page = `<div class="view-h page"><div><div class="eyebrow">Game day workspace</div><h1>Your bets</h1><p class="muted">College football and NFL: straight bets and parlays alongside live scores.</p></div></div>`;
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
  return `<button class="sweat-card ${b.ghost ? "ghost" : ""}" data-act="open-bet" data-id="${b.id}">
    ${legs.map((l) => {
      const g = game(l.gameId);
      const lv = legLive(l, g);
      return `<div class="sw-leg ${lv.state}">
        <div class="sw-top"><span>${esc(legLabel(l, g))}</span>${pill(lv.state)}</div>
        <div class="sw-score">${logo(g.away, 20)}<b>${g.away.score ?? 0}</b><span class="muted">–</span><b>${g.home.score ?? 0}</b>${logo(g.home, 20)}<span class="clock">${esc(statusText(g))}</span></div>
        <div class="sw-text">${esc(lv.text)}</div>
      </div>`;
    }).join("")}
    <div class="sw-foot">${b.ghost ? `<span class="ghost-tag">${GHOST}Ghost</span> ` : ""}${b.legs.length > 1 ? `${b.legs.length}-leg parlay · ` : ""}${fmtMoney(b.stake)} → ${fmtMoney(potentialPayout(b))}</div>
  </button>`;
}

/** How close a prop is to its line: a bar that fills as the stat climbs. */
export function propBar(l, g) {
  if (l.market !== "prop" || l.status !== "open" || !l.prop || l.prop.side === "yes" || !g || g.state === "pre") return "";
  const r = propMargin(l, g);
  if (!r) return "";
  const target = l.prop.side === "yes" ? 1 : Math.ceil(l.prop.line + 0.01);
  const scale = Math.max(target, r.value, 1);
  const pct = Math.max(0, Math.min(100, (r.value / scale) * 100));
  const cls = l.prop.side === "under" ? (r.margin > 0 ? (pct > 80 ? "warn" : "ok") : "bad") : r.margin > 0 ? "ok" : "go";
  return `<div class="pbar ${cls}" title="${esc(`${r.value} of ${target}`)}"><i style="width:${pct.toFixed(1)}%"></i><b style="left:${Math.min(100, (Math.min(l.prop.line, target) / scale) * 100).toFixed(1)}%"></b></div>`;
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
      <div class="lmain"><div class="lpick">${esc(legLabel(l, g))}${l.market === "prop" ? `<span class="auto prop" title="Player prop: tracked from the box score">prop</span>` : ""}${l.autoGraded ? `<span class="auto" title="Graded automatically from the ${l.market === "prop" ? "box score" : "final score"}">auto</span>` : ""}</div>${meta ? `<div class="lmeta">${meta}</div>` : ""}${propBar(l, g)}</div>
      ${isParlay ? `<span class="lodds">${odds(l.odds)}</span>` : ""}
    </div>`;
  }).join("");
  return `<article class="bet ${st} ${b.ghost ? "ghost" : ""}" data-act="open-bet" data-id="${b.id}" tabindex="0">
    <header>
      ${b.ghost ? `<span class="ghost-tag" title="Tracked, not placed. Doesn't count toward your P/L.">${GHOST}Ghost</span>` : ""}
      <span class="btype ${isParlay ? "parlay" : ""}">${isParlay ? `${b.legs.length}-leg parlay` : "Straight"}</span>
      ${b.book ? `<span class="book">${esc(b.book)}</span>` : ""}
      ${b.boostPct ? `<span class="boost">+${b.boostPct}% boost</span>` : ""}
      ${b.tail ? `<span class="tail-tag" title="Tailed from a shared link">↪ ${esc(b.tail.from || "friend")}</span>` : ""}
      <span class="grow"></span>
      <span class="bodds">${odds(d)}</span>
    </header>
    <div class="legs">${legsHtml}</div>
    ${isParlay && st === "open" ? `<div class="prog"><i style="width:${(won / b.legs.length) * 100}%"></i></div>` : ""}
    <footer>
      ${b.ghost ? ghostFooter(b, st, profit, isParlay, won) : `<span>Risk <b>${fmtMoney(b.stake)}</b></span>
      ${st === "open"
        ? `<span>To win <b>${fmtMoney(potentialPayout(b) - b.stake)}</b></span>${isParlay ? `<span class="muted">${won}/${b.legs.length} hit</span>` : ""}`
        : `<span class="${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}"><b>${fmtMoney(profit, { sign: true })}</b></span>`}`}
      <span class="grow"></span>${pill(st)}
    </footer>
  </article>`;
}

export function insightsHtml() {
  const table = (title, rows) => rows.length
    ? `<div class="card ins"><h3>${title}</h3><table><thead><tr><th></th><th>Bets</th><th>Record</th><th>Profit</th><th>ROI</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.count}</td><td>${r.w}-${r.l}${r.p ? `-${r.p}` : ""}</td><td class="${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}">${fmtMoney(r.profit, { sign: true, cents: false })}</td><td>${fmtPct(r.roi)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const bets = realBets(S.bets).filter((b) => !periodSince() || new Date(b.settledAt || b.createdAt) >= periodSince());
  const marketOf = (b) => (b.legs.length > 1 ? "Parlay" : marketName(b.legs[0]));
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
    ${autopsyHtml(bets)}
    ${table("By bet type", breakdown(bets, (b) => (b.legs.length > 1 ? "Parlay" : "Straight")))}
    ${table("By market", breakdown(bets, marketOf))}
    ${table("By odds range", breakdown(bets, oddsBucket).sort((a, b) => ["-150 or shorter", "-150 to +110", "+110 to +300", "+300 and up"].indexOf(a.key) - ["-150 or shorter", "-150 to +110", "+110 to +300", "+300 and up"].indexOf(b.key)))}
    ${table("By book", breakdown(bets, (b) => b.book || "Unspecified"))}
    ${bets.some((b) => b.tail) ? table("By source", breakdown(bets, (b) => (b.tail ? `Tailing ${b.tail.from || "a friend"}` : "Your own picks"))) : ""}
  </div>`;
}


const GHOST = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10a7 7 0 0 1 14 0v10l-2.5-2-2.5 2-2-2-2 2-2.5-2z"/><circle cx="9.5" cy="10.5" r="1" fill="currentColor"/><circle cx="14.5" cy="10.5" r="1" fill="currentColor"/></svg>`;

function ghostFooter(b, st, profit, isParlay, won) {
  if (st === "open") {
    return `<span>Would risk <b>${fmtMoney(b.stake)}</b></span><span>to win <b>${fmtMoney(potentialPayout(b) - b.stake)}</b></span>${isParlay ? `<span class="muted">${won}/${b.legs.length} hit</span>` : ""}`;
  }
  if (st === "won") return `<span class="pos">Would've won <b>${fmtMoney(profit, { sign: true })}</b></span>`;
  if (st === "lost") return `<span class="dodged">Dodged <b>${fmtMoney(b.stake)}</b></span>`;
  return `<span class="muted">No result</span>`;
}

/** The Ghosts tab: how your passes did, next to your real bets. */
function ghostsHtml(ghosts) {
  const since = periodSince();
  const r = ghostReport(S.bets, { since });
  const g = r.ghosts, real = r.real;
  const period = S.f.period === "all" ? "all time" : `last ${S.f.period.replace("d", " days")}`;
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const intro = `<div class="card ghost-sum">
    <div class="gs-head"><span class="gs-ico">${GHOST}</span><div><h3>Your passes</h3><p class="muted small">Picks you tracked but didn't bet · ${esc(period)}</p></div></div>
    ${g.count
      ? `<div class="gs-grid">
          <div><span>Record</span><b>${g.w}-${g.l}${g.p ? `-${g.p}` : ""}</b></div>
          <div><span>Would be</span><b class="${cls(g.profit)}">${fmtMoney(g.profit, { sign: true })}</b></div>
          <div><span>ROI</span><b class="${cls(g.roi)}">${fmtPct(g.roi)}</b></div>
          <div><span>Dodged</span><b>${fmtMoney(r.dodged)}</b></div>
        </div>
        <div class="gs-vs"><span class="muted">Your real bets, same stretch</span><b>${real.w}-${real.l}${real.p ? `-${real.p}` : ""} · <span class="${cls(real.profit)}">${fmtMoney(real.profit, { sign: true })}</span> · ROI ${fmtPct(real.roi)}</b></div>
        ${r.verdict ? `<p class="gs-verdict ${r.verdict.tone}">${esc(r.verdict.text)}</p>` : `<p class="muted small">Settle at least 3 passes and 3 real bets to see how they compare.</p>`}`
      : `<p class="muted">Turn on <b>Ghost bet</b> when adding a pick or tracking a slip, and hedgehog follows it like any other bet without counting it toward your P/L. It's a way to find out whether the bets you talk yourself out of would have won.</p>`}
  </div>`;
  const open = ghosts.filter((b) => betStatus(b) === "open");
  const done = ghosts.filter((b) => betStatus(b) !== "open").sort((a, b) => new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt));
  const section = (title, arr) => (arr.length ? `<div class="day-h">${title}</div>${arr.map(betCard).join("")}` : "");
  return `${intro}<div class="bet-list">${section("Still in play", open)}${section("Settled", done)}</div>
    <button class="btn block ghost-add" data-act="open-add" data-ghost="1">${GHOST} Track a pass</button>`;
}

/** Insights card: what's been killing your parlays. */
function autopsyHtml(bets) {
  const a = parlayAutopsy(bets);
  if (!a.count) return `<div class="card ins autopsy"><h3>Parlay autopsy</h3><p class="muted small">Settle a few parlays and this breaks down which legs sink them.</p></div>`;
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const lines = [];
  if (a.lost) {
    lines.push(a.oneAway
      ? `<b>${a.oneAway} of ${a.lost}</b> losing parlays missed by a single leg, about <b>${fmtMoney(a.oneAwayPayout, { cents: false })}</b> in payouts you just missed.`
      : `None of your ${a.lost} losing parlays were one leg away; they missed by two or more.`);
    if (a.lastLegBusts) lines.push(`<b>${a.lastLegBusts}</b> died on the very last leg to play, after everything else hit.`);
  }
  if (a.killer && a.killer.missRate > 0) lines.push(`Your leakiest leg type is <b>${esc(a.killer.market.toLowerCase())}</b>: they miss <b>${fmtPct(a.killer.missRate, 0)}</b> of the time inside parlays.`);
  const diff = a.straightsProfit - a.parlayProfit;
  lines.push(`The same money as straight bets would be <b class="${cls(a.straightsProfit)}">${fmtMoney(a.straightsProfit, { sign: true, cents: false })}</b> vs <b class="${cls(a.parlayProfit)}">${fmtMoney(a.parlayProfit, { sign: true, cents: false })}</b> as parlays (${diff > 0 ? `straights ahead by ${fmtMoney(diff, { cents: false })}` : diff < 0 ? `parlays ahead by ${fmtMoney(-diff, { cents: false })}` : "dead even"}).`);
  const maxLegs = Math.max(...a.markets.map((m) => m.legs), 1);
  const bars = a.markets.map((m) => `<div class="ab-row"><span>${esc(m.market)}</span><div class="ab-bar"><i class="hit" style="width:${((m.legs - m.lost) / maxLegs) * 100}%"></i><i class="miss" style="width:${(m.lost / maxLegs) * 100}%"></i></div><b>${fmtPct(m.missRate, 0)}</b></div>`).join("");
  const sizes = a.sizes.map((s) => `<tr><td>${esc(s.size)} legs</td><td>${s.won}/${s.count}</td><td class="${s.hitRate >= s.impliedRate ? "pos" : "neg"}">${fmtPct(s.hitRate, 0)}</td><td class="muted">${fmtPct(s.impliedRate, 0)}</td></tr>`).join("");
  return `<div class="card ins autopsy">
    <h3>Parlay autopsy <small class="muted">${a.count} settled · ${a.won}-${a.lost}</small></h3>
    <ul class="ap-lines">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <h4>Miss rate by leg type</h4>
    <div class="ab">${bars}</div>
    <h4>Hit rate by size</h4>
    <table><thead><tr><th></th><th>Hit</th><th>Rate</th><th>Odds said</th></tr></thead><tbody>${sizes}</tbody></table>
  </div>`;
}
