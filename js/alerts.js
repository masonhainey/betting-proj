// Alerts on this device: permission, local notifications while the app is open or in the
// background, and (when signed in) a push subscription so the server can alert you with
// the app closed. Wording comes from alertrules.js so it matches the server's.

import * as cloud from "./cloud.js";
import { betStatus, legLabel } from "./grade.js";
import { DEFAULT_PREFS, betEvent, legEvent } from "./alertrules.js";
import { S, game, settings, saveSettings, toast } from "./state.js";

export const prefs = () => ({ ...DEFAULT_PREFS, ...(settings.alertPrefs || {}) });

export function support() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    notify: "Notification" in window && "serviceWorker" in navigator,
    push: "PushManager" in window && "serviceWorker" in navigator,
    ios,
    standalone,
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
}

export const alertsOn = () => !!settings.alerts && support().permission === "granted";

/** Show a notification now (used for background/in-app alerts and the test button). */
export async function notify(ev) {
  if (!alertsOn()) return false;
  const p = prefs();
  if (ev.type && p[ev.type] === false) return false;
  if (ev.ghost && p.ghosts === false) return false;
  const opts = { body: ev.body, tag: ev.tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: ev.url || "#bets" } };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(ev.title, opts);
      return true;
    }
  } catch {}
  try {
    new Notification(ev.title, opts);
    return true;
  } catch {
    return false;
  }
}

// ───────── push (alerts with the app closed) ─────────

export const push = { state: "off", error: "" }; // off | on | unavailable | not-set-up | error

const urlB64 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

export async function subscribePush() {
  const sup = support();
  if (!sup.push || !cloud.configured || settings.demo) {
    push.state = "unavailable";
    return false;
  }
  if (!cloud.currentUser()) {
    push.state = "off";
    return false;
  }
  try {
    const key = await cloud.api.rpc("vapid_public_key", {});
    if (!key) {
      push.state = "not-set-up";
      return false;
    }
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with an old key can't be reused.
    if (sub && sub.options?.applicationServerKey) {
      const have = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (have !== key.replace(/=+$/, "")) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
    const j = sub.toJSON();
    await cloud.api.upsert("push_subscriptions", [{ endpoint: j.endpoint, user_id: cloud.currentUser().id, p256dh: j.keys.p256dh, auth: j.keys.auth, prefs: prefs(), updated_at: new Date().toISOString() }], "endpoint");
    push.state = "on";
    push.error = "";
    return true;
  } catch (e) {
    push.state = /isn't set up|could not find/i.test(e.message) ? "not-set-up" : "error";
    push.error = e.message;
    return false;
  }
}

/** Remove this device from server alerts (turning alerts off, or before signing out). */
export async function unsubscribePush() {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      if (cloud.currentUser()) await cloud.api.del(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
  push.state = "off";
}

/** Must run from a tap (browsers only ask for permission in response to one). */
export async function enableAlerts() {
  const sup = support();
  if (!sup.notify) return { ok: false, why: sup.ios && !sup.standalone ? "ios-install" : "unsupported" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, why: perm === "denied" ? "denied" : "dismissed" };
  settings.alerts = true;
  saveSettings();
  await subscribePush();
  await notify({ title: "🦔 Alerts are on", body: push.state === "on" ? "You'll hear about your bets even with hedgehog closed." : "You'll get alerts while hedgehog is open or in the background.", tag: "alerts-on" });
  return { ok: true };
}

export async function disableAlerts() {
  settings.alerts = false;
  saveSettings();
  await unsubscribePush();
}

export async function setPref(key, on) {
  settings.alertPrefs = { ...prefs(), [key]: on };
  saveSettings();
  if (push.state === "on") await subscribePush(); // pushes the new prefs to the server
}

// Keep the server subscription in step with sign-in state.
cloud.onAuthChange((user) => {
  if (user && alertsOn()) subscribePush();
  if (!user) push.state = "off";
});

// ───────── in-app triggers ─────────

/** After auto-grading: notify for results when the app is in the background (toasts cover the foreground). */
export function alertsForGraded(changed) {
  if (!alertsOn() || !changed.length || !document.hidden) return;
  const bets = [...new Set(changed.map((c) => c.bet))];
  for (const bet of bets) {
    if (betStatus(bet) !== "open") notify(betEvent(bet, game));
    else for (const c of changed.filter((x) => x.bet === bet)) {
      const ev = legEvent(bet, c.leg, game);
      if (ev) notify(ev);
    }
  }
}

const watch = new Map(); // gameId → { state, rz }

/** Kickoffs and red-zone trips for games you have action on. First sighting only records. */
export function watchGames() {
  const p = prefs();
  const mine = new Map(); // gameId → leg labels
  for (const b of S.bets) {
    if (b.ghost && p.ghosts === false) continue;
    if (betStatus(b) !== "open") continue;
    for (const l of b.legs) {
      if (l.status !== "open" || !l.gameId) continue;
      const g = game(l.gameId);
      if (!g) continue;
      if (!mine.has(g.id)) mine.set(g.id, { g, legs: [], ghost: true });
      const m = mine.get(g.id);
      m.legs.push(legLabel(l, g));
      if (!b.ghost) m.ghost = false;
    }
  }
  for (const { g, legs, ghost } of mine.values()) {
    const prev = watch.get(g.id);
    const rz = g.state === "in" && !!g.situation?.redZone;
    watch.set(g.id, { state: g.state, rz });
    if (!prev) continue;
    const yours = `You have ${[...new Set(legs)].join(", ")}`;
    if (prev.state === "pre" && g.state === "in" && p.kickoff !== false) {
      const ev = { key: `kick:${g.id}`, tag: `kick-${g.id}`, type: "kickoff", ghost, url: "#live", title: `🏈 Kickoff: ${g.shortName}`, body: yours };
      if (document.hidden) notify(ev);
      else toast(`${ev.title}. ${yours}`);
    }
    if (rz && !prev.rz && p.redzone !== false) {
      const team = [g.home, g.away].find((t) => t.id === g.situation?.possession);
      const opp = team === g.home ? g.away : g.home;
      const title = team ? `🟥 ${team.short} in the red zone vs ${opp.abbr}` : `🟥 Red zone: ${g.shortName}`;
      const ev = { key: `rz:${g.id}:${g.period}:${g.clock}`, tag: `rz-${g.id}`, type: "redzone", ghost, url: "#live", title, body: `${g.away.abbr} ${g.away.score ?? 0} – ${g.home.abbr} ${g.home.score ?? 0} · ${yours}` };
      if (document.hidden) notify(ev);
      else toast(title);
    }
  }
}
