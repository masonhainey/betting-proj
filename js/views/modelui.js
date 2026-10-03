// The model in the UI: Coach's picks (rotating parlays with the reasons behind every leg),
// the model line and live flags on each board game, edge tags on prices, the game page
// breakdown, the slip's "Model check", and the report card.

import { fmtMoney, fmtPct, formatOdds } from "../odds.js";
import { ago, esc, logo } from "../ui.js";
import { markets } from "../market.js";
import { closeBtn } from "../render.js";
import { S, SP, fmt, game, sport } from "../state.js";
import { M, explain, gameView, legName, liveLoaded, loadLive, modelLoading, trusted } from "../model/index.js";
import { fairAmerican, legEdge, legProb, parlayCheck } from "../model/edge.js";

const odds = (d) => formatOdds(d, fmt());
const EDGE_MIN = 0.03;
const fmtA = (a) => (a == null ? "—" : a > 0 ? `+${a}` : `${a}`);
const half = (x) => Math.round(Math.abs(x) * 2) / 2;

/** "Model: Texas by 9.5 · 76%" plus live flags under a board game. */
export function modelLine(g) {
  const v = gameView(g);
  if (!v) return "";
  const fav = v.margin >= 0 ? g.home : g.away;
  const by = half(v.margin);
  const p = v.margin >= 0 ? v.pHome : 1 - v.pHome;
  return `<span class="mline" title="hedgehog model: ratings + ESPN predictor + live news, blended with the market">${by < 0.5 ? "Model: toss-up" : `Model: ${esc(fav.short)} by ${by}`} · ${Math.round(p * 100)}%${v.thin ? ` <i class="thin" title="Few games played yet: lower confidence">·</i>` : ""}${liveChips(g, v.lf)}</span>`;
}

/** Small flags for news that matters: QB out/questionable, wind, rain. */
export function liveChips(g, lf) {
  if (!lf) return "";
  const out = [];
  for (const s of ["home", "away"]) {
    const q = lf.flags?.[s]?.qb;
    if (!q?.starter) continue;
    const t = s === "home" ? g.home : g.away;
    out.push(`<i class="lchip ${q.miss >= 0.8 ? "bad" : "warn"}" title="${esc(`${t.short} QB ${q.name}: ${q.status}`)}">${esc(t.abbr)} QB ${q.miss >= 0.8 ? "OUT" : "?"}</i>`);
  }
  if ((lf.flags?.wind || 0) >= 15) out.push(`<i class="lchip wx" title="Wind at kickoff">${Math.round(lf.flags.wind)} MPH</i>`);
  if (lf.items.some((i) => i.kind === "weather" && /Rain|Snow/.test(i.text))) out.push(`<i class="lchip wx">${lf.items.find((i) => /Snow/.test(i.text)) ? "SNOW" : "RAIN"}</i>`);
  return out.length ? ` ${out.join("")}` : "";
}

/** Small tag on a price button when the model sees an edge. */
export function edgeTag(sel, g) {
  if (!sel) return "";
  const v = gameView(g);
  const e = v && legEdge(sel, v, sel.odds);
  if (!e || e.edge < EDGE_MIN) return "";
  const t = trusted(g.sport || "cfb");
  return `<i class="etag ${t ? "value" : "lean"}" title="Model: ${fmtPct(e.p, 0)} to hit vs ${fmtPct(e.implied, 0)} implied${t ? "" : " (model not proven yet)"}">+${Math.round(e.edge * 100)}</i>`;
}

/** Bar above the board: model status, report card, and Coach's picks. */
export function modelBar() {
  const sp = sport();
  const m = M[sp];
  if (!m || modelLoading(sp)) return `<div class="mbar"><span class="mstat"><span class="spin"></span> Loading the ${SP().label} model…</span></div>`;
  if (!m.model) {
    return `<div class="mbar"><span class="mstat muted">Model: ${esc(/not built/.test(m.error) ? "the first data build is still running on GitHub (a few minutes after an update)" : m.error)}</span><button class="chip" data-act="model-retry">Try again</button></div>`;
  }
  const card = m.cards?.all;
  const n = (m.data?.games?.prev || 0) + (m.data?.games?.cur || 0);
  const t = card?.trusted;
  return `<div class="mbar">
    <button class="mstat" data-act="model-card"><b>hedgehog model</b> · ${n.toLocaleString()} games · updated ${esc(ago(Date.parse(m.data.at)))} · <span class="${t ? "good" : "warn"}">${t ? "beating the close" : "not proven yet"}</span> <u>Report card</u></button>
    <span class="grow"></span>
    <span class="mparlay"><small>Coach's picks</small>${[2, 3, 4].map((k) => `<button class="chip ${S.picks?.n === k ? "on" : ""}" data-act="model-picks" data-v="${k}">${k} legs</button>`).join("")}</span>
  </div>`;
}

const toneIco = { for: "▲", against: "▼", info: "•" };

/** The reasons behind a pick. */
export function whyList(why, { open = false } = {}) {
  if (!why) return "";
  return `<details class="why" ${open ? "open" : ""}>
    <summary><b>Why:</b> ${esc(why.headline)}${why.signals ? ` <small>${why.agree} of ${why.signals} signals agree</small>` : ""}</summary>
    <ul>${why.reasons.map((r) => `<li class="${r.tone}"><i>${toneIco[r.tone]}</i><span><b>${esc(r.k)}</b> ${esc(r.text)}</span></li>`).join("")}</ul>
    <p class="blind">Can't see: ${esc(why.blind.join(", "))}.</p>
  </details>`;
}

/** Coach's picks panel: the legs, the reasons, and what the parlay is really worth. */
export function picksPanel() {
  const P = S.picks;
  if (!P || P.sport !== sport()) return "";
  const k = P.result?.legs?.length >= 2 ? P.result.legs.length : P.n;
  const head = (sub) => `<div class="pk-h"><div><div class="eyebrow">Coach's picks</div><h3>${k}-leg parlay${k < P.n ? ` <small class="muted">only ${k} of ${P.n} qualified</small>` : ""}</h3>${sub ? `<small class="muted">${sub}</small>` : ""}</div><button class="icon-btn" data-act="model-picks-close" aria-label="Close">×</button></div>`;
  if (P.status === "loading") {
    const pr = P.progress;
    return `<div class="picks card">${head()}<p class="pk-load"><span class="spin"></span> ${pr?.total ? `Checking injuries, QBs and weather: ${pr.done} of ${pr.total} games` : "Ranking the board"}…</p></div>`;
  }
  if (P.status === "error") return `<div class="picks card">${head()}<p class="muted">${esc(P.error)}</p></div>`;
  const r = P.result;
  if (!r?.legs?.length || r.legs.length < 2) {
    return `<div class="picks card">${head()}<p class="muted">The model doesn't see ${P.n} value legs on the board right now${r?.vetoed?.length ? ` (skipped: ${esc(r.vetoed.map((v) => `${v.name}, ${v.why}`).join("; "))})` : ""}. Lines move, so check again later.</p></div>`;
  }
  const proven = trusted(P.sport);
  if (!proven && !P.showLeans) {
    const c = M[P.sport]?.cards || {};
    const rec = (x) => (x?.atsStrong ? `${x.atsStrong.w}-${x.atsStrong.l}` : "—");
    return `<div class="picks card">
      <div class="pk-h"><div><div class="eyebrow">Coach's picks</div><h3>No bets from the model</h3></div><button class="icon-btn" data-act="model-picks-close" aria-label="Close">×</button></div>
      <p class="pk-honest">When the model disagrees with the line by 3+ points, its side has gone <b>${rec(c.now)}</b> this season and <b>${rec(c.all)}</b> over two seasons. Break-even is 52.4%. Until it clears that over a real sample, it won't hand you picks.</p>
      <p class="pk-note">What still helps: the injury, QB, weather and rest flags on the board and in your slip, and shopping for the best price.</p>
      <div class="pk-act"><button class="btn sm ghost" data-act="model-leans">Show its leans anyway (unproven)</button></div>
    </div>`;
  }
  const payout = r.odds;
  const legs = r.legs.map((l, i) => {
    const g = game(l.gameId);
    if (!g) return "";
    const w = l.why;
    const t = l.side === "home" ? g.home : l.side === "away" ? g.away : null;
    return `<div class="pk-leg">
      <div class="pk-top">${t ? logo(t, 26) : `${logo(g.away, 20)}${logo(g.home, 20)}`}
        <div class="pk-name"><b>${esc(l.name)}</b><small>${esc(g.away.short)} @ ${esc(g.home.short)}</small></div>
        <div class="pk-num"><b>${odds(l.odds)}</b><small>${w?.p != null ? `${fmtPct(w.p, 0)} vs ${fmtPct(w.implied, 0)}` : ""}</small></div>
      </div>
      ${whyList(w, { open: i === 0 })}
    </div>`;
  }).join("");
  const stake = 10;
  return `<div class="picks card">
    ${head(`${proven ? "" : "Unproven leans, not bets · "}${r.checked} games checked for injuries, QBs and weather${r.recycled ? " · ran out of new teams, starting the rotation over" : ""}`)}
    <div class="pk-legs">${legs}</div>
    <div class="pk-sum">
      <span>Real chance it hits <b>${fmtPct(r.p, 1)}</b><small>fair ${esc(fmtA(fairAmerican(r.p)))} · pays ${odds(payout)}</small></span>
      ${proven ? `<span class="${r.ev >= 0 ? "good" : "bad"}">${r.ev >= 0 ? "+" : ""}${fmtMoney(r.ev * stake)}<small>expected per $${stake}</small></span>` : `<span class="muted">model's estimate<small>unproven: the line has been right more often</small></span>`}
    </div>
    ${r.vetoed?.length ? `<p class="pk-veto">Skipped on live news: ${esc(r.vetoed.map((v) => `${v.name} (${v.why})`).join(" · "))}</p>` : ""}
    <p class="pk-note">Parlays multiply the book's cut. Even +EV parlays lose most of the time; stake small.</p>
    <div class="pk-act">
      <button class="btn sm ${proven ? "" : "ghost"}" data-act="model-picks-add">Add to slip</button>
      <button class="btn sm ghost" data-act="model-picks" data-v="${P.n}">New picks, different teams</button>
    </div>
  </div>`;
}

/** Game page: the model's full breakdown with every factor and the best-value side. */
export function gameModel(g) {
  if (g.state !== "pre") return "";
  const v = gameView(g);
  if (!v) return M[g.sport || "cfb"]?.model ? "" : `<h3 class="sh3">hedgehog model</h3><p class="muted small">${modelLoading(g.sport || "cfb") ? "Loading…" : "Model unavailable right now."}</p>`;
  if (!liveLoaded(g)) loadLive(g);
  const P = v.parts;
  const fav = (mg) => (half(mg) < 0.5 ? "toss-up" : `${esc((mg >= 0 ? g.home : g.away).short)} by ${half(mg)}`);
  const lf = v.lf;
  const row = (k, val, sub = "") => `<div class="gm-r"><span>${k}${sub ? `<small>${sub}</small>` : ""}</span><b>${val}</b></div>`;
  const m = markets(g);
  const best = m ? Object.values(m).filter(Boolean).map((s) => ({ s, e: legEdge(s, v, s.odds) })).filter((x) => x.e && x.e.p >= 0.45).sort((a, b) => b.e.ev - a.e.ev)[0] : null;
  const w = best ? explain(g, best.s) : null;
  return `<h3 class="sh3">hedgehog model <small>${liveLoaded(g) ? "live factors checked" : `<span class="spin"></span> checking injuries & weather`}</small></h3>
    <div class="gm">
      ${row("Ratings", fav(P.base), "results only")}
      ${lf ? row("After injuries, rest", fav(P.model), lf.margin ? `${lf.margin > 0 ? g.home.short : g.away.short} +${half(lf.margin)} pts` : "no change") : ""}
      ${P.espn != null ? row("ESPN predictor", fav(P.espn), `${g.home.short} ${Math.round(lf.espnHome * 100)}%`) : ""}
      ${P.market != null ? row("Market", fav(P.market), esc(g.odds?.provider || "")) : ""}
      ${row("hedgehog", `${fav(v.margin)} · ${Math.round((v.margin >= 0 ? v.pHome : 1 - v.pHome) * 100)}%`, `blend: ${Math.round(P.w.model * 100)}% model · ${Math.round(P.w.espn * 100)}% ESPN · ${Math.round(P.w.market * 100)}% market`)}
      ${Number.isFinite(v.total) ? row("Total", `${Math.round(v.total * 2) / 2}`, `ratings ${Math.round(P.baseTotal)}${lf?.total ? `, ${lf.total > 0 ? "+" : ""}${Math.round(lf.total * 10) / 10} live` : ""}${v.marketTotal != null ? ` · line ${v.marketTotal}` : ""}`) : ""}
    </div>
    ${lf?.items?.length ? `<ul class="gm-f">${lf.items.map((i) => `<li class="${i.kind}"><b>${esc({ injury: "Injury", weather: "Weather", rest: "Rest" }[i.kind])}</b> ${esc(i.text)}${i.pts ? ` <small>${half(i.pts) || 0.5} pts</small>` : ""}</li>`).join("")}</ul>` : ""}
    ${best && w ? `<div class="gm-best"><div class="gm-bh"><span>Best value: <b>${esc(legName(g, best.s))}</b> ${odds(best.s.odds)}</span><small>${fmtPct(best.e.p, 0)} vs ${fmtPct(best.e.implied, 0)} implied</small></div>${whyList(w, { open: true })}</div>` : `<p class="muted small">No side here is priced better than the model's number.</p>`}`;
}

/** "Model check" in the slip: each leg's real chance, the parlay's, and a better swap. */
export function slipCheck(c, mode) {
  const rows = c.legs.map((l) => {
    const g = game(l.gameId);
    const v = g && gameView(g);
    const p = v && !l.custom ? legProb(l, v) : null;
    const e = p != null ? legEdge(l, v, l.odds) : null;
    let swap = null;
    if (g && v && e) {
      const m = markets(g);
      const alts = m ? Object.values(m).filter((s) => s && s.key !== l.key).map((s) => ({ s, e: legEdge(s, v, s.odds) })).filter((x) => x.e && x.e.ev > e.ev + 0.03 && x.e.p >= Math.max(0.5, e.p - 0.03)) : [];
      swap = alts.sort((a, b) => b.e.ev - a.e.ev)[0] || null;
    }
    return { l, g, v, p, e, swap };
  });
  if (!rows.some((r) => r.p != null)) return "";
  const parlay = mode === "parlay" && c.legs.length > 1 ? parlayCheck(rows.map((r) => ({ p: r.p, gameId: r.l.gameId })), c.parlayOdds) : null;
  const t = trusted(sport());
  const legRow = (r) => {
    if (r.p == null) return `<li><span>${esc(r.l.pick || "Custom")}</span><span class="muted">no model</span></li>`;
    const cls = r.e && r.e.edge >= EDGE_MIN ? "good" : r.e && r.e.edge <= -0.04 ? "bad" : "";
    const flags = r.g ? liveChips(r.g, r.v.lf) : "";
    return `<li class="${cls}"><span>${esc(r.l.pick || r.l.key)}${flags}</span><span><b>${fmtPct(r.p, 0)}</b> <small>vs ${fmtPct(1 / r.l.odds, 0)}</small></span>${r.swap ? `<button class="link swap" data-act="model-swap" data-from="${esc(r.l.id)}" data-key="${esc(r.swap.s.key)}">Better: ${esc(legName(r.g, r.swap.s))} ${odds(r.swap.s.odds)} · ${fmtPct(r.swap.e.p, 0)}</button>` : ""}</li>`;
  };
  const verdict = parlay?.p != null
    ? `<div class="mc-sum"><span>Real chance it hits <b>${fmtPct(parlay.p, 1)}</b> <small>fair price ${esc(fmtA(fairAmerican(parlay.p)))} · paying ${odds(c.parlayOdds)}</small></span>
        <span class="${parlay.ev >= 0 ? "good" : "bad"}">${parlay.ev >= 0 ? "+" : ""}${fmtMoney(parlay.ev * (c.stake || 10))} expected${c.stake ? "" : " per $10"}</span></div>
       ${parlay.sameGame ? `<p class="mc-note">Same-game legs move together, so the real chance is different from this estimate.</p>` : ""}`
    : "";
  return `<div class="mcheck">
    <div class="mc-h"><b>Model check</b><small>${t ? "model has beaten the close in testing" : "estimates. The model hasn't proven an edge yet"}</small></div>
    <ul>${rows.map(legRow).join("")}</ul>
    ${verdict}
  </div>`;
}

// ───────── report card ─────────

const rec = (r) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const pctOr = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export function sheetModel() {
  const sp = sport();
  const m = M[sp];
  const head = `<div class="sheet-h"><h2>${SP().label} model report card</h2>${closeBtn()}</div>`;
  if (!m?.cards?.all) return `${head}<p class="muted">${m?.error ? esc(m.error) : "The model is still loading."}</p>`;
  const { all, last, now } = m.cards;
  const t = all.trusted;
  const row = (label, a, b, hint = "") => `<div class="rc-row"><span>${label}${hint ? `<small>${hint}</small>` : ""}</span><b>${a}</b><span class="muted">${b}</span></div>`;
  const season = (c, name) => (c ? `<div class="rc-season"><b>${name}</b> ${c.games} games · picks winners ${pctOr(c.suPct)} · strong spread picks ${rec(c.atsStrong)} (${pctOr(c.atsStrongPct)})</div>` : "");
  return `${head}
    <div class="rc-verdict ${t ? "good" : "warn"}">
      <b>${t ? "Beating the closing line in testing" : "Not proven yet"}</b>
      <p>${t
        ? `When the ratings disagreed with the closing spread by 3+ points, their side covered ${pctOr(all.atsStrongPct)} of the time (${rec(all.atsStrong)}). Break-even at -110 is 52.4%.`
        : `When the ratings disagreed with the closing spread by 3+ points, their side covered ${pctOr(all.atsStrongPct)} (${rec(all.atsStrong)}). Break-even is 52.4%, and I want 53.5%+ over 60+ games before calling anything "value". Until then, edges are purple "leans".`}</p>
    </div>
    <p class="muted small">This tests the ratings part only, replayed week by week using only games played before each one. Updated ${esc(ago(Date.parse(m.data.at)))}. Past injury reports and forecasts aren't available to replay, so the live factors below can't be scored this way yet.</p>
    <div class="rc-grid">
      ${row("Picks the winner", pctOr(all.suPct), `market ${pctOr(all.suMarketPct)}`)}
      ${row("Average miss on the margin", all.maeModel ? `${all.maeModel.toFixed(1)} pts` : "—", all.maeMarket ? `market ${all.maeMarket.toFixed(1)} pts` : "", "lower is better")}
      ${row("All spread picks", pctOr(all.atsPct), rec(all.ats))}
      ${row("Strong spread picks", pctOr(all.atsStrongPct), rec(all.atsStrong), "3+ pts off the close")}
      ${row("All totals", pctOr(all.ouPct), rec(all.ou))}
      ${row("Strong totals", pctOr(all.ouStrongPct), rec(all.ouStrong), "4+ pts off the close")}
      ${row("Model's share of the blend", `${Math.round(m.weight * 100)}%`, "from the replay")}
    </div>
    ${season(last, "Last season")}${season(now, "This season")}
    <h3 class="sh3">What goes into every number</h3>
    <ul class="rc-how">
      <li><b>Ratings.</b> Power ratings from every result (blowouts capped, home field, recent games count more, last season as the start), plus offense/defense ratings for totals.</li>
      <li><b>Injuries, read live.</b> ESPN's injury report for each game. A starting QB (his team's passing leader) out is worth about ${sp === "nfl" ? "5.5" : "6.5"} points; leading rusher or receiver about 1; other starters a fraction, capped. Players out for weeks count less, since the ratings have already seen the team without them. Questionable = 30% chance he sits.</li>
      <li><b>ESPN's matchup predictor.</b> A second opinion, 20% of the blend.</li>
      <li><b>Weather at kickoff.</b> Open-Meteo forecast for the stadium: wind over 12 mph, rain or snow, and extreme cold take points off the total. Domes are skipped.</li>
      <li><b>Rest.</b> Off a bye vs on a short week.</li>
      <li><b>Hard stops.</b> Coach's picks never hand you a side whose starting QB is out or doubtful, any game where his status is a coin flip, or an over into 18+ mph wind.</li>
      <li><b>The market.</b> Closing lines are sharp, so the final number leans on them and moves only where the other signals disagree.</li>
    </ul>`;
}
