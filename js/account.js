// Accounts & sync controller and the account UI in Settings.

import * as cloud from "./cloud.js";
import { emptyMeta, syncOnce } from "./sync.js";
import { load, save } from "./store.js";
import { esc, ago, icons } from "./ui.js";
import { render } from "./render.js";
import { $, S, hooks, settings, swap, toast } from "./state.js";

// ───────────────────────────── accounts & sync ─────────────────────────────

// Sync is off in demo mode (demo bets are fake) and when no Supabase project is set.
export const CLOUD = cloud.configured && !settings.demo;
export const acct = { mode: "signin", email: "", busy: false, error: "", status: "idle", lastSync: 0, syncError: "" };
export let syncMeta = load("sync", null);
export let syncTimer = null;
export let syncing = null;
export let syncAgain = false;

hooks.afterSave = () => syncSoon();

export function syncSoon(ms = 1500) {
  if (!CLOUD || !cloud.currentUser()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, ms);
}

export async function syncNow({ announce = false } = {}) {
  const user = cloud.currentUser();
  if (!CLOUD || !user) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    if (!syncMeta || syncMeta.userId !== user.id) {
      // Bets left on this device by a *different* account are safe in that account;
      // don't mix them into this one.
      if (syncMeta?.userId && syncMeta.userId !== user.id) S.bets = [];
      syncMeta = emptyMeta(user.id);
    }
    acct.lastTry = Date.now();
    const first = !syncMeta.lastPull;
    const before = S.bets.length;
    acct.status = "syncing";
    paintAcct();
    try {
      const r = await syncOnce({ getBets: () => S.bets, remote: cloud.remote, meta: syncMeta, userId: user.id, settings });
      S.bets = r.bets;
      save("bets", S.bets);
      if (r.settings) {
        Object.assign(settings, r.settings);
        save("settings", settings);
      }
      save("sync", syncMeta);
      acct.lastSync = Date.now();
      hooks.afterSync();
      acct.syncError = "";
      acct.status = "ok";
      const incoming = r.added + r.updated + r.removed;
      if (first) {
        toast(r.added ? `Synced: ${S.bets.length} bets in your account (${r.added} from your other device${r.added > 1 ? "s" : ""})` : `Synced: ${before} bet${before === 1 ? "" : "s"} backed up to your account`, "won");
      } else if (r.added) toast(`${r.added} new bet${r.added > 1 ? "s" : ""} from your other device`, "won");
      else if (announce) toast(incoming ? `Synced ${incoming} change${incoming > 1 ? "s" : ""}` : "Everything's up to date");
      if (incoming || r.settings || first) render();
    } catch (e) {
      acct.status = e.signedOut ? "idle" : "error";
      acct.syncError = e.message;
      if (announce && !e.signedOut) toast(e.message, "err");
    } finally {
      syncing = null;
      paintAcct();
      if (syncAgain) {
        syncAgain = false;
        syncSoon(300);
      }
    }
  })();
  return syncing;
}

cloud.onAuthChange((user) => {
  if (user) syncNow();
  else {
    acct.mode = "signin";
    acct.status = "idle";
  }
  if (S.sheet?.kind === "settings") S.sheet.dirty = true;
  render();
});

export function acctStatus() {
  if (acct.status === "syncing") return "Syncing…";
  if (acct.status === "error") return `Couldn't sync: ${esc(acct.syncError)}. Will retry.`;
  if (acct.lastSync) return `Synced <span data-ago="${acct.lastSync}">${ago(acct.lastSync)}</span> · ${S.bets.length} bet${S.bets.length === 1 ? "" : "s"}`;
  return "Waiting to sync…";
}

export function accountHtml() {
  const head = (title, sub) => `<div class="acct-h"><span class="acct-ico">${icons.cloud}</span><div><b>${title}</b><p class="muted small" id="acct-status">${sub}</p></div></div>`;
  if (settings.demo) return `<div class="acct">${head("Sync across devices", "Turn off demo mode to sign in.")}</div>`;
  if (!cloud.configured) return `<div class="acct">${head("Sync across devices", "Accounts aren't connected on this site yet.")}</div>`;
  const u = cloud.currentUser();
  if (u && acct.mode !== "newpw") {
    return `<div class="acct on">${head(esc(u.email || "Signed in"), acctStatus())}
      <div class="dactions"><button class="btn sm" data-act="sync-now" ${acct.status === "syncing" ? "disabled" : ""}>${icons.refresh} Sync now</button><span class="grow"></span><button class="btn sm ghost" data-act="sign-out">Sign out</button></div></div>`;
  }
  const err = acct.error ? `<p class="acct-err">${esc(acct.error)}</p>` : "";
  const email = (auto = "email") => `<input id="acct-email" class="acct-in" type="email" inputmode="email" autocomplete="${auto}" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(acct.email)}" aria-label="Email">`;
  const pw = (auto) => `<input id="acct-pw" class="acct-in" type="password" autocomplete="${auto}" placeholder="${auto === "new-password" ? "Choose a password (6+ characters)" : "Password"}" aria-label="Password">`;
  const btn = (act, label, busyLabel) => `<button class="btn primary block-sm" data-act="${act}" ${acct.busy ? "disabled" : ""}>${acct.busy ? busyLabel : label}</button>`;
  if (acct.mode === "newpw") {
    return `<div class="acct">${head("Set a new password", "You're signed in from the reset link. Choose a new password to finish.")}
      <div class="acct-col">${pw("new-password")}${btn("acct-newpw", "Save password", "Saving…")}</div>${err}</div>`;
  }
  if (acct.mode === "sent-confirm") {
    return `<div class="acct">${head("Confirm your email", `We sent a link to <b>${esc(acct.email)}</b>. Tap it (any browser is fine), then come back and sign in.`)}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">I've confirmed, sign in</button></p></div>`;
  }
  if (acct.mode === "sent-reset") {
    return `<div class="acct">${head("Check your email", `If <b>${esc(acct.email)}</b> has an account, a reset link is on its way. Open it to choose a new password.`)}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">Back to sign in</button></p></div>`;
  }
  if (acct.mode === "forgot") {
    return `<div class="acct">${head("Reset your password", "We'll email you a link to set a new one.")}
      <div class="acct-col">${email()}${btn("acct-reset", "Send reset link", "Sending…")}</div>${err}
      <p class="muted small"><button class="link" data-act="acct-mode" data-v="signin">Back to sign in</button></p></div>`;
  }
  const signup = acct.mode === "signup";
  return `<div class="acct">${head(signup ? "Create your account" : "Sync your phone and computer", signup ? "One account keeps your bets in step on every device." : "Sign in and your bets stay in step on every device.")}
    <div class="seg acct-tabs"><button class="${signup ? "" : "on"}" data-act="acct-mode" data-v="signin">Sign in</button><button class="${signup ? "on" : ""}" data-act="acct-mode" data-v="signup">Create account</button></div>
    <form class="acct-col" data-form="acct" onsubmit="return false">${email(signup ? "email" : "username")}${pw(signup ? "new-password" : "current-password")}
    ${btn(signup ? "acct-signup" : "acct-signin", signup ? "Create account" : "Sign in", signup ? "Creating…" : "Signing in…")}</form>${err}
    ${signup ? "" : `<p class="muted small"><button class="link" data-act="acct-mode" data-v="forgot">Forgot password?</button></p>`}</div>`;
}

export async function acctSubmit(fn, { needPw = true } = {}) {
  const email = ($("#acct-email")?.value ?? acct.email).trim();
  const pw = $("#acct-pw")?.value || "";
  acct.email = email;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    acct.error = "Enter your email address.";
    return paintAcct();
  }
  if (needPw && pw.length < 6) {
    acct.error = acct.mode === "signup" ? "Use a password with at least 6 characters." : "Enter your password.";
    return paintAcct();
  }
  acct.busy = true;
  acct.error = "";
  paintAcct();
  try {
    await fn(email, pw);
  } catch (e) {
    acct.error = e.message;
  }
  acct.busy = false;
  paintAcct();
}

export function paintAcct() {
  const el = $("#acct");
  if (el) swap(el, accountHtml());
}
