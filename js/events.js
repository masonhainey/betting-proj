// User input: click/input/change/keyboard handlers, drag & drop, paste, routing.

import { enableAlerts, disableAlerts, notify, setPref, unsubscribePush } from "./alerts.js";
import { alertsHtml } from "./sheets/settings.js";
import { friendsActions, handleJoinLink, onFriendsTab } from "./views/friends.js";
import { copy, shareActions, shareInputs, handleTailLink } from "./sheets/share.js";
import { installerCode } from "./widget.js";
import { ymd } from "./espn.js";
import { americanToDecimal, parseOdds, formatOdds, stepOdds, hedge, fmtMoney } from "./odds.js";
import { betStatus, potentialPayout, legLabel } from "./grade.js";
import { parseSlipText } from "./slipparse.js";
import * as cloud from "./cloud.js";
import { load, uid } from "./store.js";
import { CLOUD, acct, acctSubmit, paintAcct, syncNow } from "./account.js";
import { refreshDetail, refreshNews, refreshSchedule, refreshToday, switchSport, tick } from "./data.js";
import { boardGames, selByKey, setSim, slipCalc, slipLegFromSel, toggleSel, trackSlip } from "./market.js";
import { modelParlay } from "./views/modelui.js";
import { retryModel } from "./model/index.js";
import { openSheet, paintDock, render } from "./render.js";
import { formCalc, newFormLeg, openAdd, paintForm, propHint, saveForm } from "./sheets/add.js";
import { hedgeText } from "./sheets/bet.js";
import { handleImage, handleText, importPreview, openDraft } from "./sheets/import.js";
import { $, $$, NS, S, TABS, fmt, game, num, odds, saveBets, saveSettings, saveSlip, settings, sport, toast } from "./state.js";
import { slipSummary, towinText } from "./views/build.js";

// ───────────────────────────── events ─────────────────────────────

export function findBet(id) {
  return S.bets.find((b) => b.id === id);
}

export function formLeg(id) {
  return S.form?.legs.find((l) => l.id === id);
}

export const actions = {
  ...shareActions,
  ...friendsActions,
  tab: (el) => {
    location.hash = el.dataset.v;
  },
  "open-add": (el) => {
    openAdd();
    if (el?.dataset?.ghost) {
      S.form.ghost = true;
      S.sheet.dirty = true;
      render();
    }
  },
  "form-ghost": (el) => {
    S.form.ghost = el.checked;
    el.closest(".switch")?.classList.toggle("on", el.checked);
    paintForm();
  },
  "slip-ghost": (el) => {
    S.slip.ghost = el.checked;
    saveSlip();
    render();
  },
  "toggle-ghost": (el) => {
    const b = findBet(el.dataset.id);
    b.ghost = !b.ghost;
    if (!b.ghost) delete b.ghost;
    saveBets();
    toast(b.ghost ? "👻 Now a ghost: tracked, but out of your P/L" : "Moved to your real bets", "won");
    render();
  },
  "pick-image": () => $("#slip-file").click(),
  "open-import-text": () => handleText(""),
  "imp-continue": () => openDraft(),
  "add-for-game": (el) => openAdd({ gameId: el.dataset.id }),
  "open-settings": () => openSheet({ kind: "settings" }),
  "open-bet": (el) => openSheet({ kind: "bet", id: el.dataset.id }),
  "open-game": (el) => {
    openSheet({ kind: "game", id: el.dataset.id });
    refreshDetail(true);
  },
  "open-slip": () => openSheet({ kind: "slip" }),
  "close-sheet": () => {
    S.sheet = null;
    S.confirmDelete = null;
    render();
  },
  "set-fmt": (el) => {
    settings.oddsFormat = el.dataset.v;
    saveSettings();
    for (const l of S.slip.legs) delete l.oddsText;
    delete S.slip.overrideText;
    if (S.sheet?.kind === "settings") S.sheet.dirty = true;
    render();
  },
  refresh: (el) => {
    const m = { today: refreshToday, schedule: refreshSchedule, news: refreshNews };
    S.st[el.dataset.v].tried = Date.now();
    m[el.dataset.v]();
  },
  period: (el) => ((S.f.period = el.dataset.v), render()),
  "bets-tab": (el) => ((S.f.betsTab = el.dataset.v), render()),
  "live-f": (el) => ((S.f.live = el.dataset.v), render()),
  "sched-top25": () => {
    S.f.top25 = !S.f.top25;
    settings.top25Only = S.f.top25;
    saveSettings();
    render();
  },
  "sched-line": () => ((S.f.hasLine = !S.f.hasLine), render()),
  "news-f": (el) => ((S.f.news = el.dataset.v), render()),
  "build-day": (el) => ((S.f.buildDay = el.dataset.v), render()),
  "demo-on": () => {
    settings.demo = true;
    saveSettings();
    location.reload();
  },
  sim: (el) => setSim(el.checked),

  // slip
  "toggle-sel": (el) => toggleSel(el.dataset.key),
  "slip-remove": (el) => {
    S.slip.legs = S.slip.legs.filter((l) => l.id !== el.dataset.id);
    delete S.slip.stakes[el.dataset.id];
    if (S.slip.legs.length < 2) S.slip.mode = "singles";
    saveSlip();
    render();
  },
  "slip-clear": () => {
    S.slip = { ...S.slip, legs: [], stakes: {}, override: "", boost: "", modeTouched: false };
    saveSlip();
    if (S.sheet?.kind === "slip") S.sheet = null;
    render();
  },
  "slip-mode": (el) => {
    S.slip.mode = el.dataset.v;
    S.slip.modeTouched = true;
    saveSlip();
    render();
  },
  "slip-odds-step": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.odds = stepOdds(l.odds, Number(el.dataset.dir), fmt());
    l.edited = true;
    delete l.oddsText;
    saveSlip();
    render();
  },
  "slip-override-step": (el) => {
    const cur = parseOdds(S.slip.override)?.decimal || slipCalc().rawParlay;
    S.slip.override = formatOdds(stepOdds(cur, Number(el.dataset.dir), fmt()), fmt());
    delete S.slip.overrideText;
    saveSlip();
    render();
  },
  "slip-accept": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    const s = selByKey(l.key);
    if (s) Object.assign(l, { line: s.line, odds: s.odds, edited: false });
    delete l.oddsText;
    saveSlip();
    render();
  },
  "slip-quick": (el) => {
    S.slip.stake = el.dataset.v;
    saveSlip();
    render();
  },
  "slip-custom": () => {
    const d = americanToDecimal(100);
    const leg = { id: uid(), key: `custom|${uid()}`, custom: true, pick: "", odds: d, status: "open" };
    S.slip.legs.push(leg);
    saveSlip();
    const inBuild = S.tab === "build" && matchMedia("(min-width: 980px)").matches;
    if (!inBuild && S.sheet?.kind !== "slip") openSheet({ kind: "slip" });
    else render();
    setTimeout(() => {
      const inp = document.getElementById(`slip-pick-${leg.id}`);
      inp?.closest(".sleg")?.scrollIntoView({ block: "nearest" });
      inp?.focus();
    }, 40);
  },
  "slip-track": () => trackSlip(),

  // bets
  "grade-leg": (el) => {
    const b = findBet(el.dataset.bet);
    const l = b.legs.find((x) => x.id === el.dataset.leg);
    l.status = el.dataset.v;
    l.autoGraded = false;
    b.settledAt = betStatus(b) === "open" ? null : new Date().toISOString();
    saveBets();
    render();
  },
  cashout: (el) => {
    const amt = num($("#cashout-amt")?.value);
    if (!(amt >= 0) || !$("#cashout-amt")?.value) return toast("Enter the cash-out amount", "err");
    const b = findBet(el.dataset.id);
    b.cashout = amt;
    b.settledAt = new Date().toISOString();
    saveBets();
    toast(`Cashed out ${fmtMoney(amt)}`, amt >= b.stake ? "won" : "");
    render();
  },
  "set-ticket": (el) => {
    const b = findBet(el.dataset.id);
    const v = num($("#ticket-amt")?.value);
    if (!(v > b.stake * 0.99)) return toast("Enter the total payout shown on your ticket (stake + winnings)", "err");
    b.ticketPayout = Math.round(v * 100) / 100;
    saveBets();
    toast(`Payout set to ${fmtMoney(b.ticketPayout)}`, "won");
    render();
  },
  "clear-ticket": (el) => {
    delete findBet(el.dataset.id).ticketPayout;
    saveBets();
    render();
  },
  "undo-cashout": (el) => {
    const b = findBet(el.dataset.id);
    delete b.cashout;
    b.settledAt = betStatus(b) === "open" ? null : b.settledAt;
    saveBets();
    render();
  },
  "delete-bet": (el) => {
    if (S.confirmDelete !== el.dataset.id) {
      S.confirmDelete = el.dataset.id;
      return render();
    }
    S.bets = S.bets.filter((b) => b.id !== el.dataset.id);
    S.confirmDelete = null;
    S.sheet = null;
    saveBets();
    toast("Bet deleted");
    render();
  },
  rebuild: (el) => {
    const b = findBet(el.dataset.id);
    let n = 0;
    for (const l of b.legs) {
      if (!l.gameId || !l.market) continue;
      const s = selByKey(`${l.gameId}|${l.market}|${l.side}`);
      if (s && !S.slip.legs.some((x) => x.key === s.key)) {
        S.slip.legs.push(slipLegFromSel(s));
        n++;
      }
    }
    if (!n) return toast("Those markets aren't open anymore", "err");
    if (S.slip.legs.length > 1) S.slip.mode = "parlay";
    saveSlip();
    S.sheet = null;
    location.hash = "build";
    render();
  },

  // add form
  "form-type": (el) => {
    const f = S.form;
    f.type = el.dataset.v;
    if (f.type === "parlay") while (f.legs.length < 2) f.legs.push(newFormLeg());
    S.sheet.dirty = true;
    render();
  },
  "form-fmt": (el) => {
    settings.oddsFormat = el.dataset.v;
    saveSettings();
    for (const l of S.form.legs) l.oddsText = formatOdds(l.odds, fmt());
    const o = parseOdds(S.form.override)?.decimal;
    if (o) S.form.override = formatOdds(o, fmt());
    S.sheet.dirty = true;
    render();
  },
  "form-add-leg": () => {
    S.form.legs.push(newFormLeg());
    S.sheet.dirty = true;
    render();
    setTimeout(() => document.getElementById(`f-pick-${S.form.legs[S.form.legs.length - 1].id}`)?.focus(), 30);
  },
  "form-rm-leg": (el) => {
    S.form.legs = S.form.legs.filter((l) => l.id !== el.dataset.id);
    S.sheet.dirty = true;
    render();
  },
  "f-odds-step": (el) => {
    const l = formLeg(el.dataset.id);
    l.uncertain = false;
    document.getElementById(`f-odds-${l.id}`)?.closest(".field")?.classList.remove("unsure");
    l.odds = stepOdds(l.odds > 1 ? l.odds : americanToDecimal(-110), Number(el.dataset.dir), fmt());
    l.oddsText = formatOdds(l.odds, fmt());
    const inp = document.getElementById(`f-odds-${l.id}`);
    if (inp) inp.value = l.oddsText;
    paintForm();
  },
  "f-override-step": (el) => {
    const f = S.form;
    const cur = parseOdds(f.override)?.decimal || formCalc().calc;
    f.override = formatOdds(stepOdds(cur, Number(el.dataset.dir), fmt()), fmt());
    const inp = $("#f-override");
    if (inp) inp.value = f.override;
    paintForm();
  },
  "form-link": (el) => {
    S.form.linking = el.dataset.id;
    S.form.linkGame = null;
    S.form.q = "";
    S.sheet.dirty = true;
    render();
    setTimeout(() => $("#f-q")?.focus(), 30);
  },
  "form-link-cancel": () => {
    S.form.linking = null;
    S.sheet.dirty = true;
    render();
  },
  "form-link-game": (el) => {
    S.form.linkGame = el.dataset.id;
    S.sheet.dirty = true;
    render();
  },
  "form-link-back": () => {
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
  },
  "form-pick-sel": (el) => {
    const s = selByKey(el.dataset.key);
    const l = formLeg(el.dataset.id);
    if (!s || !l) return;
    const g = game(s.gameId);
    Object.assign(l, { gameId: g.id, sport: g.sport, market: s.market, side: s.side, line: s.line, odds: s.odds, oddsText: formatOdds(s.odds, fmt()), gameLabel: g.shortName, kickoff: g.date });
    l.pick = legLabel(l, g);
    S.form.linking = null;
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
  },
  "form-link-plain": (el) => {
    const l = formLeg(el.dataset.id);
    const g = game(S.form.linkGame);
    Object.assign(l, { gameId: g.id, sport: g.sport, market: "other", gameLabel: g.shortName, kickoff: g.date });
    S.form.linking = null;
    S.form.linkGame = null;
    S.sheet.dirty = true;
    render();
    setTimeout(() => document.getElementById(`f-pick-${l.id}`)?.focus(), 30);
  },
  "form-unlink": (el) => {
    const l = formLeg(el.dataset.id);
    for (const k of ["gameId", "sport", "market", "side", "line", "gameLabel", "kickoff"]) delete l[k];
    S.sheet.dirty = true;
    render();
  },
  "form-save": () => saveForm(),

  // settings
  "set-auto": (el) => {
    settings.autoAccept = el.checked;
    saveSettings();
    S.sheet.dirty = true;
    render();
  },
  "set-demo": (el) => {
    settings.demo = el.checked;
    saveSettings();
    location.reload();
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ app: "hedgehog", version: 1, exportedAt: new Date().toISOString(), bets: S.bets, settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hedgehog-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  "acct-mode": (el) => {
    acct.email = ($("#acct-email")?.value ?? acct.email).trim();
    acct.mode = el.dataset.v;
    acct.error = "";
    paintAcct();
    setTimeout(() => $(acct.email ? "#acct-pw" : "#acct-email")?.focus(), 30);
  },
  "acct-signin": () => acctSubmit(async (email, pw) => {
    await cloud.signIn(email, pw);
    toast("Signed in. Syncing your bets…", "won");
  }),
  "acct-signup": () => acctSubmit(async (email, pw) => {
    const r = await cloud.signUp(email, pw);
    if (r.signedIn) toast("Account created. Syncing your bets…", "won");
    else acct.mode = "sent-confirm";
  }),
  "acct-reset": () => acctSubmit(async (email) => {
    await cloud.resetPassword(email);
    acct.mode = "sent-reset";
  }, { needPw: false }),
  "acct-newpw": async () => {
    const pw = $("#acct-pw")?.value || "";
    if (pw.length < 6) {
      acct.error = "Use a password with at least 6 characters.";
      return paintAcct();
    }
    acct.busy = true;
    acct.error = "";
    paintAcct();
    try {
      await cloud.updatePassword(pw);
      acct.mode = "signin";
      toast("Password updated", "won");
      if (S.sheet?.kind === "settings") S.sheet.dirty = true;
      render();
    } catch (e) {
      acct.error = e.message;
    }
    acct.busy = false;
    paintAcct();
  },
  "sync-now": () => syncNow({ announce: true }),
  "sign-out": async () => {
    if (S.confirmDelete !== "signout") {
      S.confirmDelete = "signout";
      $('[data-act="sign-out"]').textContent = "Tap again to sign out";
      return;
    }
    S.confirmDelete = null;
    await unsubscribePush(); // this device shouldn't keep getting the account's alerts
    await cloud.signOut();
    toast("Signed out. Your bets stay on this device.");
  },
  "alerts-on": async (el) => {
    el.disabled = true;
    el.textContent = "Asking…";
    const r = await enableAlerts();
    if (!r.ok) toast({ "ios-install": "Add hedgehog to your Home Screen first, then turn alerts on from there", denied: "Notifications are blocked. Allow them in Settings to get alerts", dismissed: "No problem. Turn alerts on any time", unsupported: "This browser can't show notifications" }[r.why] || "Couldn't turn alerts on", r.why === "dismissed" ? "" : "err");
    paintAlerts();
  },
  "alerts-off": async () => {
    await disableAlerts();
    toast("Alerts are off on this device");
    paintAlerts();
  },
  sport: (el) => switchSport(el.dataset.v),
  "model-card": () => openSheet({ kind: "model" }),
  "model-retry": () => {
    retryModel(sport());
    render();
  },
  "model-parlay": (el) => {
    const picks = modelParlay(boardGames(), Number(el.dataset.v) || 3);
    if (picks.length < 2) return toast("The model doesn't see enough value on the board for a parlay right now", "err");
    S.slip.legs = picks.map((p) => slipLegFromSel(selByKey(p.key)));
    S.slip.mode = "parlay";
    S.slip.modeTouched = true;
    saveSlip();
    toast(`Model parlay: ${picks.length} legs with the biggest edges${picks.length < Number(el.dataset.v) ? ` (only ${picks.length} qualified)` : ""}`);
    if (S.sheet?.kind !== "slip" && window.innerWidth < 860) openSheet({ kind: "slip" });
    render();
  },
  "model-swap": (el) => {
    const i = S.slip.legs.findIndex((l) => l.id === el.dataset.from);
    const s = selByKey(el.dataset.key);
    if (i < 0 || !s) return;
    S.slip.legs[i] = slipLegFromSel(s);
    saveSlip();
    render();
  },
  "widget-copy": async () => {
    const site = location.origin + location.pathname.replace(/[^/]*$/, "");
    const ok = await copy(installerCode(site));
    toast(ok ? "Installer copied. Paste it into a new Scriptable script" : "Couldn't copy. Try again", ok ? "" : "err");
  },
  "alerts-test": async () => {
    const ok = await notify({ title: "💰 Cashed: Texas -7.5 (test)", body: "+$18.18 · pays $38.18. This is what a result alert looks like.", tag: "test", url: "#bets" });
    if (!ok) toast("Couldn't show a notification. Check that they're allowed", "err");
  },
  "alerts-pref": async (el) => {
    el.closest(".atype")?.classList.toggle("on", el.checked);
    await setPref(el.dataset.v, el.checked);
  },
  "dismiss-sync": () => {
    settings.syncBannerDismissed = true;
    saveSettings();
    render();
  },
  wipe: () => {
    if (S.confirmDelete !== "wipe") {
      S.confirmDelete = "wipe";
      S.sheet.dirty = true;
      return render();
    }
    S.bets = [];
    S.confirmDelete = null;
    saveBets();
    S.sheet = null;
    toast("All bets erased");
    render();
  },
};

export const inputs = {
  ...shareInputs,
  "sched-q": (el) => {
    S.f.q = el.value;
    render();
  },
  "build-q": (el) => {
    S.f.buildQ = el.value;
    render();
  },
  "slip-odds": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.oddsText = el.value;
    const p = parseOdds(el.value);
    if (p) {
      l.odds = p.decimal;
      l.edited = true;
    }
    saveSlip();
    paintSlipCalc();
  },
  "slip-stake": (el) => {
    S.slip.stakes[el.dataset.id] = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-pstake": (el) => {
    S.slip.stake = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-override": (el) => {
    S.slip.overrideText = el.value;
    S.slip.override = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-boost": (el) => {
    S.slip.boost = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-pick": (el) => {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    l.pick = el.value;
    saveSlip();
  },
  "slip-ticket": (el) => {
    S.slip.ticket = el.value;
    saveSlip();
    paintSlipCalc();
  },
  "slip-book": (el) => {
    S.slip.book = el.value;
    saveSlip();
  },
  hedge: (el) => {
    S.sheet.hedge = el.value;
    const b = findBet(S.sheet.id);
    const d = parseOdds(el.value)?.decimal;
    $("#hedge-out").innerHTML = hedgeText(d ? hedge(potentialPayout(b), b.stake, d) : null);
  },
  "bet-note": (el) => {
    const b = findBet(el.dataset.id);
    b.note = el.value;
    saveBets();
  },
  "f-pick": (el) => {
    formLeg(el.dataset.id).pick = el.value;
    const hint = document.getElementById(`f-prop-${el.dataset.id}`);
    if (hint) hint.innerHTML = propHint(el.value);
  },
  "f-odds": (el) => {
    const l = formLeg(el.dataset.id);
    l.uncertain = false;
    el.closest(".field")?.classList.remove("unsure");
    l.oddsText = el.value;
    const p = parseOdds(el.value);
    l.odds = p ? p.decimal : NaN;
    el.classList.toggle("bad", !p && el.value.trim() !== "");
    paintForm();
  },
  "f-override": (el) => ((S.form.override = el.value), paintForm()),
  "f-boost": (el) => ((S.form.boost = el.value), paintForm()),
  "f-stake": (el) => ((S.form.stake = el.value), (S.form.lastEdited = "stake"), paintForm()),
  "f-win": (el) => ((S.form.win = el.value), (S.form.lastEdited = "win"), paintForm()),
  "f-book": (el) => (S.form.book = el.value),
  "f-ticket": (el) => ((S.form.ticket = el.value), paintForm()),
  "imp-text": (el) => {
    S.imp.text = el.value;
    S.imp.parsed = parseSlipText(el.value);
    $("#imp-preview").innerHTML = importPreview();
  },
  "f-note": (el) => (S.form.note = el.value),
  "f-q": (el) => {
    S.form.q = el.value;
    S.sheet.dirty = true;
    render();
  },
  "set-unit": (el) => {
    const n = num(el.value);
    if (n > 0) {
      settings.unit = n;
      saveSettings();
    }
  },
};

export function paintSlipCalc() {
  const c = slipCalc();
  $$("#slip-summary").forEach((el) => (el.innerHTML = slipSummary(c)));
  for (const l of S.slip.legs) $$(`[data-towin="${CSS.escape(l.id)}"]`).forEach((el) => (el.innerHTML = towinText(l)));
  $$(".slip-mode [data-v=parlay] em").forEach((el) => (el.textContent = c.legs.length > 1 ? odds(c.rawParlay) : ""));
  paintDock();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.tagName === "INPUT" && el.type === "checkbox") return; // handled on change
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === "A") e.preventDefault();
  // Nested actionable elements inside a card: the innermost wins.
  e.stopPropagation();
  fn(el, e);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches('input[type="checkbox"][data-act]')) return actions[el.dataset.act]?.(el);
  if (el.dataset.change === "import") return importFile(el.files?.[0]);
  if (el.id === "slip-file") {
    const f = el.files?.[0];
    el.value = "";
    return handleImage(f);
  }
  // Odds boxes: reformat once the user leaves the field.
  if (el.dataset.in === "slip-odds") {
    const l = S.slip.legs.find((x) => x.id === el.dataset.id);
    if (l) delete l.oddsText;
    render();
  } else if (el.dataset.in === "slip-override") {
    const p = parseOdds(S.slip.override);
    S.slip.override = p ? formatOdds(p.decimal, fmt()) : "";
    delete S.slip.overrideText;
    saveSlip();
    render();
  } else if (el.dataset.in === "f-odds") {
    const l = formLeg(el.dataset.id);
    if (l?.odds > 1) el.value = l.oddsText = formatOdds(l.odds, fmt());
  }
});

document.addEventListener("input", (e) => {
  const fn = inputs[e.target.dataset?.in];
  if (fn) fn(e.target);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target.id === "acct-email" || e.target.id === "acct-pw")) {
    e.preventDefault();
    const act = { signin: "acct-signin", signup: "acct-signup", forgot: "acct-reset", newpw: "acct-newpw" }[acct.mode];
    if (act) actions[act]();
  }
  if (e.key === "Escape" && S.sheet) {
    S.sheet = null;
    render();
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".dropzone")) {
    e.preventDefault();
    $("#slip-file").click();
  }
  if (e.key === "Enter" && e.target.matches("[data-act='open-bet'],[data-act='open-game']") && e.target.tagName !== "BUTTON") {
    actions[e.target.dataset.act](e.target);
  }
  // Arrow keys nudge odds in any odds box.
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.target.matches("[data-in='f-odds'],[data-in='slip-odds']")) {
    e.preventDefault();
    const act = e.target.dataset.in === "f-odds" ? "f-odds-step" : "slip-odds-step";
    actions[act]({ dataset: { id: e.target.dataset.id, dir: e.key === "ArrowUp" ? "1" : "-1" } });
    setTimeout(() => document.getElementById(e.target.id)?.focus(), 0);
  }
});

export function paintAlerts() {
  const el = document.getElementById("alerts-box");
  if (el) el.innerHTML = alertsHtml();
}

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const bets = Array.isArray(data) ? data : data.bets;
    if (!Array.isArray(bets) || bets.some((b) => !Array.isArray(b.legs))) throw new Error("bad file");
    const have = new Set(S.bets.map((b) => b.id));
    const fresh = bets.filter((b) => !have.has(b.id));
    S.bets = [...fresh, ...S.bets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    saveBets();
    toast(`Imported ${fresh.length} bet${fresh.length === 1 ? "" : "s"}`, "won");
    S.sheet = null;
    render();
  } catch {
    toast("That file isn't a hedgehog export", "err");
  }
}

// Drag a screenshot anywhere onto the page.
export let dragDepth = 0;
export const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $("#dropover").hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("#dropover").hidden = true;
});
window.addEventListener("drop", (e) => {
  dragDepth = 0;
  $("#dropover").hidden = true;
  const dt = e.dataTransfer;
  if (!dt) return;
  const file = [...(dt.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    return handleImage(file);
  }
  const text = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (text && !e.target.closest?.("input, textarea")) {
    e.preventDefault();
    handleText(text);
  }
});

// Paste a screenshot (or share text) anywhere that isn't a text field.
document.addEventListener("paste", (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const img = [...cd.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  if (img) {
    e.preventDefault();
    return handleImage(img.getAsFile());
  }
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  const text = cd.getData("text/plain");
  if (text?.trim()) {
    e.preventDefault();
    handleText(text);
  }
});

/** Sign-up confirmation / password-reset links land here with tokens in the URL hash. */
export function handleAuthLink() {
  if (!CLOUD || !/access_token=|error_description=/.test(location.hash)) return false;
  cloud.sessionFromUrl().then((kind) => {
    if (kind === "recovery") {
      acct.mode = "newpw";
      openSheet({ kind: "settings" });
      setTimeout(() => $("#acct-pw")?.focus(), 60);
    } else if (kind === "signup") toast("Email confirmed. You're signed in and syncing.", "won");
    else if (kind) toast("Signed in. Syncing your bets…", "won");
  }).catch((e) => toast(e.message, "err"));
  return true;
}

window.addEventListener("hashchange", () => {
  if (handleAuthLink()) return;
  if (handleTailLink()) return;
  if (handleJoinLink()) return render();
  const t = location.hash.slice(1);
  if (TABS.includes(t)) {
    S.tab = t;
    S.sheet = null;
    render();
    window.scrollTo({ top: 0 });
    if (t === "news" && !S.st.news.at) refreshNews();
    if (t === "friends") onFriendsTab();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    tick();
    syncNow();
  }
});
window.addEventListener("online", () => syncNow());

// Keep data from other tabs in sync (e.g. bet added in another window).
window.addEventListener("storage", (e) => {
  if (e.key === `lw.${NS}bets`) {
    S.bets = load(NS + "bets", []);
    render();
  }
});
