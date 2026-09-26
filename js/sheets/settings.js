// Settings sheet.

import * as cloud from "../cloud.js";
import { esc } from "../ui.js";
import { CLOUD, accountHtml } from "../account.js";
import { closeBtn, fmtToggle } from "../render.js";
import { S, settings } from "../state.js";

export function sheetSettings() {
  const signedIn = CLOUD && cloud.currentUser();
  return `<div class="sheet-h"><h2>Settings</h2>${closeBtn()}</div>
    <div id="acct">${accountHtml()}</div>
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
