// Importing slips from screenshots, share text and links.

import { formatOdds, fmtMoney } from "../odds.js";
import { parseSlipText, linkPick, readScore } from "../slipparse.js";
import { readImage } from "../ocr.js";
import { esc, relDay, logo, icons } from "../ui.js";

import { closeBtn, openSheet, render } from "../render.js";
import { newFormLeg, openAdd } from "./add.js";
import { $, S, fmt, game, odds, toast } from "../state.js";

// Import a slip (screenshot / share text / link) ---------------------------

export function dropZone(compact = false) {
  if (compact) {
    return `<section class="dropzone compact" data-act="pick-image" tabindex="0" aria-label="Import a bet slip">
      <span class="dz-ico">${icons.upload}</span>
      <div class="dz-text"><b>Import a bet slip</b><span>Drop or pick a screenshot, or paste share text</span></div>
      <button class="btn sm" data-act="open-import-text" aria-label="Paste text or link">${icons.link}<span class="hide-sm">Paste</span></button>
    </section>`;
  }
  return `<section class="dropzone" data-act="pick-image" tabindex="0" aria-label="Import a bet slip">
    <span class="dz-ico">${icons.upload}</span>
    <div class="dz-text"><b>Drop a bet slip to track it</b><span>${matchMedia("(pointer: coarse)").matches
      ? "Pick a screenshot from your photos, or paste the share text your book gives you."
      : `Screenshot from any book. You can also paste an image (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}V) or paste a share link or the share text.`}</span></div>
    <div class="dz-actions"><button class="btn sm primary" data-act="pick-image">${icons.upload} Choose screenshot</button><button class="btn sm" data-act="open-import-text">${icons.link} Paste text or link</button></div>
  </section>`;
}

/** Games a pasted bet could reasonably be on: recent finals through the next month. */
export function linkPool() {
  const now = Date.now();
  return [...S.games.values()].filter((g) => new Date(g.date) > now - 4 * 864e5 && new Date(g.date) < now + 30 * 864e5);
}

export async function handleImage(file) {
  if (!file || !/^image\//.test(file.type)) return toast("Drop an image of your bet slip (PNG or JPG)", "err");
  if (S.imp?.img) URL.revokeObjectURL(S.imp.img);
  S.imp = { busy: true, stage: "Loading reader", progress: 0, img: URL.createObjectURL(file), text: "", parsed: null, error: "" };
  openSheet({ kind: "import" });
  try {
    const text = await readImage(file, (stage, p) => {
      S.imp.stage = stage;
      S.imp.progress = p;
      paintImportProgress();
    }, readScore);
    S.imp.text = text.replace(/\n{3,}/g, "\n\n").trim();
    S.imp.parsed = parseSlipText(S.imp.text);
  } catch (e) {
    S.imp.error = e.message || "Couldn't read that image";
  }
  S.imp.busy = false;
  if (S.sheet?.kind === "import") {
    S.sheet.dirty = true;
    render();
  }
}

export function handleText(text) {
  S.imp = { busy: false, text: text.trim(), parsed: text.trim() ? parseSlipText(text) : null, error: "" };
  openSheet({ kind: "import" });
  if (!text.trim()) setTimeout(() => $("#imp-text")?.focus(), 40);
}

export function paintImportProgress() {
  const bar = $("#imp-bar");
  if (bar) bar.style.width = `${Math.round((S.imp.progress || 0) * 100)}%`;
  const st = $("#imp-stage");
  if (st) st.textContent = `${S.imp.stage}…`;
}

export function importPreview() {
  const p = S.imp.parsed;
  if (!p) return `<p class="muted small">Nothing to read yet.</p>`;
  const pool = linkPool();
  const linkOnly = p.url && !p.legs.length && p.stake == null;
  const rows = p.legs.map((l) => {
    const m = linkPick(l.pick, pool, l.context);
    const g = m && game(m.gameId);
    return `<div class="ip-leg"><span class="ldot"></span><div class="lmain"><div class="lpick">${esc(l.pick)}${l.uncertain ? `<span class="chk" title="The +/- sign didn't come through. Check this price.">check ±</span>` : l.solved ? `<span class="chk ok" title="The +/- sign was missing; recovered by matching your ticket's payout">sign fixed</span>` : ""}</div>${g ? `<div class="lmeta">${logo(g.away, 16)}${logo(g.home, 16)} ${esc(g.shortName)} · ${esc(relDay(g.date))}${m.market !== "other" ? " · tracks live" : ""}</div>` : `<div class="lmeta">No game match: it'll be tracked manually</div>`}</div><span class="lodds">${odds(l.odds)}</span></div>`;
  }).join("");
  return `<div class="ip-sum">
      ${p.book ? `<span class="pill open">${esc(p.book)}</span>` : ""}
      <span class="pill ${p.legs.length ? "won" : ""}">${p.legs.length ? `${p.legs.length} ${p.legs.length > 1 ? "legs" : "leg"}${p.legCount && p.legCount !== p.legs.length ? ` of ${p.legCount}` : ""}` : "No legs found"}</span>
      ${p.stake != null ? `<span>${fmtMoney(p.stake)} → <b>${p.payout != null ? fmtMoney(p.payout) : "?"}</b></span>` : ""}
    </div>
    ${rows ? `<div class="ip-legs">${rows}</div>` : ""}
    ${p.oddsCheck != null && p.oddsCheck >= 0.03 && p.legs.length ? `<div class="notice warn">${icons.clock}<span>These legs multiply to ${fmtMoney((p.stake || 1) * p.legs.reduce((a, l) => a * l.odds, 1))}, not the ticket's ${p.payout != null ? fmtMoney(p.payout) : odds(p.totalOdds)}. A price may be misread or a leg missing (or it's a same-game parlay). The ticket's payout will be used either way.</span></div>` : ""}
    ${linkOnly ? `<div class="notice warn">${icons.link}<span>Sportsbook share links open inside the book's app and need your login, so hedgehog can't read them. Paste the share text that came with the link, or drop a screenshot. The link will still be saved on the bet.</span></div>` : ""}
    ${!p.legs.length && !linkOnly ? `<p class="muted small">Couldn't find picks with odds. Fix the text above (one pick per line, like <code>Georgia -7.5 -110</code>) or continue and fill the form in by hand.</p>` : ""}`;
}

export function sheetImport() {
  const I = S.imp || {};
  return `<div class="sheet-h"><h2>Import a bet slip</h2>${closeBtn()}</div>
    ${I.img ? `<div class="imp-img"><img src="${esc(I.img)}" alt="Your bet slip"></div>` : ""}
    ${I.busy
      ? `<div class="imp-prog"><div class="imp-track"><i id="imp-bar" style="width:${Math.round((I.progress || 0) * 100)}%"></i></div><span id="imp-stage" class="muted small">${esc(I.stage || "Working")}…</span>
         <p class="muted small">The first import downloads a text reader (~12 MB, one time). Your screenshot is read in your browser and isn't uploaded anywhere. Tip: cropping to just the bet slip reads best.</p></div>`
      : `${I.error ? `<div class="notice err">${esc(I.error)}. You can still paste the text below.</div>` : ""}
         <label class="field"><span>${I.img ? "What we read" : "Share text or link"} <small>edit anything that looks off</small></span>
         <textarea id="imp-text" data-in="imp-text" rows="${I.img ? 7 : 6}" placeholder="Paste the text your book shares, e.g.\n4 Leg Parlay +867\nTexas -7.5 -110\n…\nWager $20.00  To Pay $193.40">${esc(I.text || "")}</textarea></label>
         <div id="imp-preview">${importPreview()}</div>
         <button class="btn primary block" data-act="imp-continue">Review & track</button>`}`;
}

export function openDraft() {
  const p = S.imp?.parsed || parseSlipText(S.imp?.text || "");
  const pool = linkPool();
  let linked = 0;
  const legs = p.legs.map((l) => {
    const leg = newFormLeg({ pick: l.pick, odds: l.odds, oddsText: formatOdds(l.odds, fmt()), uncertain: !!l.uncertain });
    const m = linkPick(l.pick, pool, l.context);
    if (m) {
      const g = game(m.gameId);
      Object.assign(leg, m, { gameLabel: g.shortName, kickoff: g.date, sport: g.sport });
      if (m.market !== "other") linked++;
    }
    return leg;
  });
  const missing = p.legCount && p.legCount > legs.length ? p.legCount - legs.length : 0;
  for (let i = 0; i < missing; i++) legs.push(newFormLeg());
  const type = legs.length > 1 || p.type === "parlay" ? "parlay" : "straight";
  if (!legs.length) legs.push(newFormLeg());
  if (type === "parlay" && legs.length < 2) legs.push(newFormLeg());
  openAdd();
  Object.assign(S.form, {
    type,
    legs,
    stake: p.stake != null ? String(p.stake) : S.form.stake,
    ticket: p.payout != null ? p.payout.toFixed(2) : "",
    book: p.book || S.form.book,
    link: p.url || "",
    override: p.payout == null && p.totalOdds && type === "parlay" ? formatOdds(p.totalOdds, fmt()) : "",
    source: { img: S.imp?.img, missing, linked },
  });
  S.sheet.dirty = true;
  render();
}
