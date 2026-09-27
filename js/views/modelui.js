// hedgehog model in the UI: the model line on each board game, edge tags on prices, the
// slip's "Model check", the model parlay builder, the report card, and your leaks.

import { fmtMoney, fmtPct, fmtLine, formatOdds } from "../odds.js";
import { esc } from "../ui.js";
import { markets } from "../market.js";
import { closeBtn } from "../render.js";
import { SP, fmt, game, sport } from "../state.js";
import { M, gameView, modelLoading, modelProgress, trusted } from "../model/index.js";
import { bestParlay, fairAmerican, legEdge, legProb, parlayCheck } from "../model/edge.js";
import { leaks } from "../model/leaks.js";

const odds = (d) => formatOdds(d, fmt());
const EDGE_MIN = 0.03;

/** "Model: Texas by 9.5 · 76% · total 52" under a board game. */
export function modelLine(g) {
  const v = gameView(g);
  if (!v) return "";
  const fav = v.margin >= 0 ? g.home : g.away;
  const by = Math.abs(Math.round(v.margin * 2) / 2);
  const p = v.margin >= 0 ? v.pHome : 1 - v.pHome;
  return `<span class="mline" title="hedgehog model, blended with the market">${by < 0.5 ? "Model: toss-up" : `Model: ${esc(fav.short)} by ${by}`} · ${Math.round(p * 100)}%${Number.isFinite(v.total) ? ` · total ${Math.round(v.total * 2) / 2}` : ""}${v.thin ? ` <i class="thin" title="Few games played yet: lower confidence">·</i>` : ""}</span>`;
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

/** Bar above the board: model status, report card, and one-tap model parlays. */
export function modelBar() {
  const sp = sport();
  const m = M[sp];
  if (!m?.model && (modelLoading(sp) || !m)) {
    const pr = modelProgress(sp);
    const pct = pr?.total ? Math.round((pr.done / pr.total) * 100) : 0;
    return `<div class="mbar"><span class="mstat"><span class="spin"></span> ${pr?.total ? `Loading past ${SP().label} games for the model: ${pr.done} of ${pr.total} weeks` : `Getting the ${SP().label} model ready`}…</span>${pr?.total ? `<span class="mprog"><i style="width:${pct}%"></i></span>` : ""}<small class="muted">One time only. After this it's saved on this device.</small></div>`;
  }
  if (m.error) return `<div class="mbar"><span class="mstat muted">Model: ${esc(m.error)}</span><button class="chip" data-act="model-retry">Try again</button></div>`;
  const card = m.cards?.all;
  const n = (m.games?.prev || 0) + (m.games?.cur || 0);
  const t = card?.trusted;
  return `<div class="mbar">
    <button class="mstat" data-act="model-card"><b>hedgehog model</b> · ${n.toLocaleString()} games${m.partial ? ` <span class="muted">(${modelLoading(sp) ? "loading more" : "some weeks missing, retrying"})</span>` : ""} · <span class="${t ? "good" : "warn"}">${t ? "beating the close" : "not proven yet"}</span> <u>Report card</u></button>
    <span class="grow"></span>
    <span class="mparlay"><small>Model parlay</small>${[2, 3, 4].map((k) => `<button class="chip" data-act="model-parlay" data-v="${k}">${k} legs</button>`).join("")}</span>
  </div>`;
}

/** Candidate legs for the parlay builder: every priced option on the board with a model view. */
export function boardOptions(games) {
  return games
    .map((g) => {
      const v = gameView(g);
      const m = markets(g);
      if (!v || !m) return null;
      return { game: g, view: v, options: Object.values(m).filter(Boolean).map((s) => ({ key: s.key, leg: s, odds: s.odds })) };
    })
    .filter(Boolean);
}

export const modelParlay = (games, n) => bestParlay(boardOptions(games), n);

/** "Model check" in the slip: each leg's real chance, the parlay's, and a better swap. */
export function slipCheck(c, mode) {
  const rows = c.legs.map((l) => {
    const g = game(l.gameId);
    const v = g && gameView(g);
    const p = v && !l.custom ? legProb(l, v) : null;
    const e = p != null ? legEdge(l, v, l.odds) : null;
    // A better-value side in the same game?
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
    const cls = r.e.edge >= EDGE_MIN ? "good" : r.e.edge <= -0.04 ? "bad" : "";
    const label = r.g ? r.l.pick || r.l.key : r.l.pick;
    return `<li class="${cls}"><span>${esc(label)}</span><span><b>${fmtPct(r.p, 0)}</b> <small>vs ${fmtPct(r.e.implied, 0)}</small></span>${r.swap ? `<button class="link swap" data-act="model-swap" data-from="${esc(r.l.id)}" data-key="${esc(r.swap.s.key)}">Better: ${esc(swapName(r.swap.s, r.g))} ${odds(r.swap.s.odds)} · ${fmtPct(r.swap.e.p, 0)}</button>` : ""}</li>`;
  };
  const verdict = parlay?.p != null
    ? `<div class="mc-sum"><span>Real chance it hits <b>${fmtPct(parlay.p, 1)}</b> <small>fair price ${esc(fmtA(fairAmerican(parlay.p)))} · paying ${odds(c.parlayOdds)}</small></span>
        <span class="${parlay.ev >= 0 ? "good" : "bad"}">${parlay.ev >= 0 ? "+" : ""}${fmtMoney(parlay.ev * (c.stake || 10))} expected${c.stake ? "" : " per $10"}</span></div>
       ${parlay.sameGame ? `<p class="mc-note">Same-game legs move together, so the real chance is different from this estimate.</p>` : ""}
       ${parlay.ev < 0 && rows.length > 2 ? `<p class="mc-note">Each extra leg multiplies the book's cut. ${rows.filter((r) => r.e && r.e.edge < 0).length} of these legs are priced against you.</p>` : ""}`
    : "";
  return `<div class="mcheck">
    <div class="mc-h"><b>Model check</b><small>${t ? "model has beaten the close in testing" : "estimates. The model hasn't proven an edge yet"}</small></div>
    <ul>${rows.map(legRow).join("")}</ul>
    ${verdict}
  </div>`;
}

const fmtA = (a) => (a == null ? "—" : a > 0 ? `+${a}` : `${a}`);
function swapName(s, g) {
  const team = s.side === "home" ? g.home.short : s.side === "away" ? g.away.short : "";
  if (s.market === "ml") return `${team} ML`;
  if (s.market === "spread") return `${team} ${fmtLine(s.line)}`;
  return `${s.side === "over" ? "Over" : "Under"} ${s.line}`;
}

// ───────── report card ─────────

const rec = (r) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const pctOr = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export function sheetModel() {
  const sp = sport();
  const m = M[sp];
  const head = `<div class="sheet-h"><h2>${SP().label} model report card</h2>${closeBtn()}</div>`;
  if (!m?.cards) return `${head}<p class="muted">${m?.error ? esc(m.error) : "The model is still loading past games."}</p>`;
  const { all, last, now } = m.cards;
  const t = all.trusted;
  const row = (label, a, b, hint = "") => `<div class="rc-row"><span>${label}${hint ? `<small>${hint}</small>` : ""}</span><b>${a}</b><span class="muted">${b}</span></div>`;
  const season = (c, name) => (c ? `<div class="rc-season"><b>${name}</b> ${c.games} games · picks winners ${pctOr(c.suPct)} · strong spread picks ${rec(c.atsStrong)} (${pctOr(c.atsStrongPct)})</div>` : "");
  return `${head}
    <div class="rc-verdict ${t ? "good" : "warn"}">
      <b>${t ? "Beating the closing line in testing" : "Not proven yet"}</b>
      <p>${t
        ? `When the model disagreed with the closing spread by 3+ points, its side covered ${pctOr(all.atsStrongPct)} of the time (${rec(all.atsStrong)}). Break-even at -110 is 52.4%. Edges show as green "value" tags.`
        : `On games it disagreed with the closing spread by 3+ points, its side covered ${pctOr(all.atsStrongPct)} (${rec(all.atsStrong)}). Break-even is 52.4%, and I want at least 53.5% over 60+ games before calling anything "value". Until then, edges show as purple "leans": useful for comparing options, not proof of an edge.`}</p>
    </div>
    <p class="muted small">Replayed week by week: every game was predicted using only games played before it, then scored against the result and the closing line.</p>
    <div class="rc-grid">
      ${row("Picks the winner", pctOr(all.suPct), `market ${pctOr(all.suMarketPct)}`)}
      ${row("Average miss on the margin", all.maeModel ? `${all.maeModel.toFixed(1)} pts` : "—", all.maeMarket ? `market ${all.maeMarket.toFixed(1)} pts` : "", "lower is better")}
      ${row("All spread picks", pctOr(all.atsPct), rec(all.ats))}
      ${row("Strong spread picks", pctOr(all.atsStrongPct), rec(all.atsStrong), "3+ pts off the close")}
      ${row("All totals", pctOr(all.ouPct), rec(all.ou))}
      ${row("Strong totals", pctOr(all.ouStrongPct), rec(all.ouStrong), "4+ pts off the close")}
      ${row("Best model/market mix", all.bestWeight != null ? `${Math.round(all.bestWeight * 100)}% model` : "—", `using ${Math.round(m.weight * 100)}%`)}
    </div>
    ${season(last, "Last season")}${season(now, "This season")}
    <p class="muted small">How it works: power ratings from every result (margin capped for blowouts, home field, recent games weighted more, last season as the starting point), plus offense/defense ratings for totals. Final numbers blend the model with the market line, because closing lines are sharp. The model only moves them where it strongly disagrees.</p>`;
}

// ───────── your leaks ─────────

export function leaksCard(bets) {
  const r = leaks(bets);
  const tbl = (title, groups) => (groups.length
    ? `<div class="lk-t"><h4>${title}</h4>${groups.slice().sort((a, b) => b.n - a.n).map((g) => `<div class="lk-r"><span>${esc(g.key)}</span><span class="muted">${g.w}-${g.l}</span><b class="${g.profit >= 0 ? "good" : "bad"}">${fmtMoney(g.profit, { sign: true })}</b></div>`).join("")}</div>`
    : "");
  return `<section class="leaks">
    <div class="sec-h"><h2>Where your money goes</h2><span class="muted">${r.bets} settled bets</span></div>
    <ul class="lk-ins">${r.insights.map((x) => `<li class="${x.tone}">${esc(x.text)}</li>`).join("")}</ul>
    <div class="lk-grid">${tbl("By structure", r.byStructure)}${tbl("By market", r.byMarket)}${tbl("Straight bets by price", r.byPrice)}</div>
  </section>`;
}

