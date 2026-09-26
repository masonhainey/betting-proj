// Settings sheet.

import * as cloud from "../cloud.js";
import { esc } from "../ui.js";
import { CLOUD, accountHtml } from "../account.js";
import { closeBtn, fmtToggle } from "../render.js";
import { S, settings } from "../state.js";
import { support, alertsOn, prefs, push } from "../alerts.js";

export function sheetSettings() {
  const signedIn = CLOUD && cloud.currentUser();
  return `<div class="sheet-h"><h2>Settings</h2>${closeBtn()}</div>
    <div id="acct">${accountHtml()}</div>
    <h3 class="sh3">Alerts</h3>
    <div id="alerts-box">${alertsHtml()}</div>
    <div class="set-row"><div><b>Default odds format</b><p class="muted small">Every price in the app switches; you can still type either kind anywhere.</p></div>${fmtToggle("set-fmt")}</div>
    <div class="set-row"><div><b>Unit size</b><p class="muted small">Default stake for new picks and slip previews.</p></div><label class="stake"><span>$</span><input id="set-unit" data-in="set-unit" inputmode="decimal" value="${esc(settings.unit)}"></label></div>
    <div class="set-row"><div><b>Auto-accept line changes</b><p class="muted small">When a price in your slip moves, take the new number instead of asking.</p></div><label class="switch ${settings.autoAccept ? "on" : ""}"><input type="checkbox" data-act="set-auto" ${settings.autoAccept ? "checked" : ""}><span class="knob"></span></label></div>
    <div class="set-row"><div><b>Demo mode</b><p class="muted small">Simulated slate with games that go live and finish while you watch, plus sample bets. Your real bets are kept separately and untouched.</p></div><label class="switch ${settings.demo ? "on" : ""}"><input type="checkbox" data-act="set-demo" ${settings.demo ? "checked" : ""}><span class="knob"></span></label></div>
    <h3 class="sh3">Your data</h3>
    <p class="muted small">${signedIn ? "Your bets are saved on this device and in your account. Export a JSON backup any time." : "Bets live in this browser only. Sign in above to sync them, or export a backup."}</p>
    <div class="dactions">
      <button class="btn sm" data-act="export">Export JSON</button>
      <label class="btn sm">Import JSON<input type="file" accept="application/json,.json" data-change="import" hidden></label>
      <span class="grow"></span>
      <button class="btn sm danger" data-act="wipe">${S.confirmDelete === "wipe" ? (signedIn ? "Tap again: erases on every device" : "Tap again to erase all bets") : "Erase all bets"}</button>
    </div>
    <p class="muted small foot">Scores, schedule, lines and news come from ESPN's public feeds. hedgehog is for tracking and fun — it doesn't place bets.</p>`;
}

const TYPES = [
  ["legs", "Parlay legs", "each leg that hits"],
  ["bets", "Results", "cashed, lost or pushed"],
  ["kickoff", "Kickoffs", "games you have action on"],
  ["redzone", "Red zone", "your teams, while the app is open"],
  ["ghosts", "Ghost bets", "include your passes"],
];

export function alertsHtml() {
  const sup = support();
  const signedIn = cloud.configured && cloud.currentUser() && !settings.demo;
  if (!sup.notify) {
    if (sup.ios && !sup.standalone) {
      return `<div class="alert-box"><p><b>On iPhone, alerts need hedgehog on your Home Screen.</b></p>
        <ol class="small muted steps"><li>In Safari, tap <b>Share</b> (square with the arrow)</li><li>Tap <b>Add to Home Screen</b></li><li>Open hedgehog from your Home Screen and turn alerts on here</li></ol></div>`;
    }
    return `<p class="muted small">This browser doesn't support notifications.</p>`;
  }
  if (sup.permission === "denied") {
    return `<div class="alert-box"><p><b>Notifications are blocked for hedgehog.</b></p><p class="muted small">${sup.ios ? "On iPhone: Settings → Notifications → hedgehog → Allow Notifications." : "Allow them for this site in your browser's settings, then come back."}</p></div>`;
  }
  const on = alertsOn();
  const reach = !on ? "" : push.state === "on"
    ? "Even with hedgehog closed. Results usually arrive within 5–15 minutes of the final whistle."
    : !signedIn ? "While hedgehog is open or in the background. Sign in to also get them with the app closed."
    : push.state === "not-set-up" ? "While hedgehog is open. Closed-app alerts aren't switched on on the server yet."
    : push.state === "error" ? `While hedgehog is open. Couldn't register for closed-app alerts (${esc(push.error)}).`
    : "While hedgehog is open or in the background.";
  const p = prefs();
  return `<div class="alert-box ${on ? "on" : ""}">
    ${on
      ? `<div class="alert-status"><span class="dot live"></span><div><b>Alerts are on for this device</b><p class="muted small">${reach}</p></div></div>
         <div class="alert-types">${TYPES.map(([k, label, hint]) => `<label class="atype ${p[k] !== false ? "on" : ""}" title="${esc(hint)}"><input type="checkbox" data-act="alerts-pref" data-v="${k}" ${p[k] !== false ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
         <div class="dactions"><button class="btn sm" data-act="alerts-test">Send a test</button><span class="grow"></span><button class="btn sm ghost" data-act="alerts-off">Turn off</button></div>`
      : `<p class="small">Get a notification when a leg hits, a bet cashes or loses, your games kick off, and when your team gets in the red zone.</p>
         <button class="btn primary block" data-act="alerts-on">Turn on alerts</button>
         ${signedIn ? "" : `<p class="muted small">Tip: sign in above too, so alerts reach you even with hedgehog closed.</p>`}`}
  </div>`;
}
