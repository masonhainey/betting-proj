// "Where your money goes" on Bets → Insights: your settled bets by structure, market and
// price, with plain-English takeaways (analysis in ../leaks.js).

import { fmtMoney } from "../odds.js";
import { esc } from "../ui.js";
import { leaks } from "../leaks.js";

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

