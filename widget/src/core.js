// hedgehog-widget: Home Screen and Lock Screen widgets for Scriptable (iOS).
//
// The installer you paste into Scriptable (Settings → Home Screen widget) downloads this
// file each run and calls run(). It signs in to your hedgehog account with its own
// session, reads your bets, pulls ESPN scores and draws the widget.
//
// Source: widget/src/. Bundled for Scriptable with `npm run build:widget`.
/* global ListWidget, Color, Font, LinearGradient, Size, Request, Keychain, Alert, config, Script, FileManager, Safari */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../js/config.js";
import { normalizeEvent, scoreboardUrl } from "../../js/espn.js";
import { buildModel, daysToFetch } from "./model.js";

export { buildModel, daysToFetch };

const KEY = { email: "hedgehog.email", password: "hedgehog.password", session: "hedgehog.session" };

const C = {
  bg1: "#1a1330",
  bg2: "#09080c",
  text: "#f3f1f8",
  muted: "#9b96aa",
  faint: "#66617a",
  accent: "#a78bfa",
  win: "#3ddc97",
  red: "#ff5d73",
  amber: "#ffb547",
};
const STATE_COLOR = { winning: C.win, losing: C.red, even: C.amber, live: C.accent, pending: C.faint, won: C.win, lost: C.red, push: C.amber, void: C.faint };
const STATE_WORD = { winning: "Winning", losing: "Losing", even: "Even", live: "Live", pending: "Upcoming" };

// ───────── network ─────────

async function http(url, { method = "GET", headers = {}, body } = {}) {
  const req = new Request(url);
  req.method = method;
  req.headers = headers;
  req.timeoutInterval = 12;
  if (body !== undefined) req.body = JSON.stringify(body);
  let data;
  try {
    data = await req.loadJSON();
  } catch {
    data = null;
  }
  const status = req.response?.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    const msg = data?.error_description || data?.msg || data?.message || `HTTP ${status}`;
    const e = new Error(msg);
    e.status = status;
    throw e;
  }
  return data;
}

const authHeaders = { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };

async function token(grant, body) {
  const s = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: authHeaders, body });
  const session = { access: s.access_token, refresh: s.refresh_token, expires: Date.now() + (s.expires_in || 3600) * 1000 };
  Keychain.set(KEY.session, JSON.stringify(session));
  return session;
}

/** A valid access token: cached → refreshed → fresh password sign-in. */
async function accessToken() {
  let s = null;
  try {
    s = Keychain.contains(KEY.session) ? JSON.parse(Keychain.get(KEY.session)) : null;
  } catch {}
  if (s?.access && s.expires > Date.now() + 120e3) return s.access;
  if (s?.refresh) {
    try {
      return (await token("refresh_token", { refresh_token: s.refresh })).access;
    } catch {}
  }
  if (!Keychain.contains(KEY.email) || !Keychain.contains(KEY.password)) return null;
  try {
    return (await token("password", { email: Keychain.get(KEY.email), password: Keychain.get(KEY.password) })).access;
  } catch (e) {
    if (e.status === 400) return null; // password changed: sign in again from Scriptable
    throw e;
  }
}

async function loadBets(access) {
  const rows = await http(`${SUPABASE_URL}/rest/v1/records?select=id,data&kind=eq.bet&deleted=eq.false`, {
    headers: { ...authHeaders, Authorization: `Bearer ${access}` },
  });
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

async function loadGames(days) {
  const games = new Map();
  await Promise.all(
    days.map(async (key) => {
      const [sport, d] = key.split("|");
      try {
        const data = await http(scoreboardUrl(d, sport));
        for (const ev of data?.events || []) {
          const g = normalizeEvent(ev, sport);
          if (g) games.set(g.id, g);
        }
      } catch {}
    })
  );
  return games;
}

// ───────── cache (so a failed refresh still shows something) ─────────

const fm = () => FileManager.local();
const cachePath = () => fm().joinPath(fm().cacheDirectory(), "hedgehog-widget.json");
function saveCache(data) {
  try {
    fm().writeString(cachePath(), JSON.stringify(data));
  } catch {}
}
function readCache() {
  try {
    return fm().fileExists(cachePath()) ? JSON.parse(fm().readString(cachePath())) : null;
  } catch {
    return null;
  }
}

// ───────── drawing ─────────

const col = (hex, a = 1) => new Color(hex, a);

function base(site) {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [col(C.bg1), col(C.bg2)];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);
  if (site) w.url = `${site}#bets`;
  return w;
}

function text(stack, str, { size = 12, weight = "semibold", color = C.text, lines = 1, scale = 0.7 } = {}) {
  const t = stack.addText(String(str ?? ""));
  t.font = weight === "bold" ? Font.boldRoundedSystemFont(size) : weight === "heavy" ? Font.heavyRoundedSystemFont(size) : weight === "regular" ? Font.regularRoundedSystemFont(size) : Font.semiboldRoundedSystemFont(size);
  t.textColor = col(color);
  t.lineLimit = lines;
  t.minimumScaleFactor = scale;
  return t;
}

function dot(stack, color, size = 8) {
  const d = stack.addStack();
  d.size = new Size(size, size);
  d.cornerRadius = size / 2;
  d.backgroundColor = col(color);
  return d;
}

function header(w, m, { compact = false } = {}) {
  const h = w.addStack();
  h.centerAlignContent();
  text(h, "🦔", { size: compact ? 12 : 13 });
  h.addSpacer(4);
  text(h, "hedgehog", { size: compact ? 12 : 13, weight: "bold" });
  h.addSpacer();
  if (m.live) {
    dot(h, C.red, 6);
    h.addSpacer(4);
    text(h, "LIVE", { size: 10, weight: "bold", color: C.red });
  } else if (!compact && m.today.text) {
    text(h, `${m.today.text} today`, { size: 11, color: m.today.profit >= 0 ? C.win : C.red });
  }
}

function statLine(w, m) {
  const s = w.addStack();
  s.centerAlignContent();
  const chip = (label, value, color) => {
    const c = s.addStack();
    c.layoutVertically();
    text(c, label, { size: 9, color: C.muted, weight: "semibold" });
    text(c, value, { size: 15, weight: "bold", color });
    s.addSpacer();
  };
  chip("TODAY", m.today.text || "$0.00", m.today.profit > 0 ? C.win : m.today.profit < 0 ? C.red : C.text);
  chip("OPEN", `${m.open}`, C.text);
  chip("AT RISK", fmt(m.atRisk), C.text);
  chip("TO WIN", fmt(m.toWin), C.accent);
}

const fmt = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : `$${Math.round(n)}`);

const LEG_MARK = { won: "✓", lost: "✗", push: "–", void: "–", winning: "▲", losing: "▼", even: "=", live: "●", pending: "○" };

/** One line of a parlay's legs, each colored by how it's doing. */
function legLine(w, r) {
  const s = w.addStack();
  s.addSpacer(15);
  r.legs.forEach((l, i) => {
    if (i) s.addSpacer(8);
    text(s, `${LEG_MARK[l.state] || "○"} ${l.label}`, { size: 10, color: STATE_COLOR[l.state] || C.muted, weight: "semibold", scale: 0.6 });
  });
}

function betRow(w, r, { showPays = true, sub = true } = {}) {
  const s = w.addStack();
  s.centerAlignContent();
  dot(s, STATE_COLOR[r.state] || C.faint);
  s.addSpacer(7);
  const mid = s.addStack();
  mid.layoutVertically();
  text(mid, r.title, { size: 13, weight: "semibold" });
  if (sub && r.sub) text(mid, r.sub, { size: 10.5, color: r.state === "losing" ? C.red : C.muted, weight: "regular" });
  s.addSpacer();
  if (showPays) {
    const right = s.addStack();
    right.layoutVertically();
    const top = right.addStack();
    top.addSpacer();
    text(top, r.pays, { size: 12, weight: "bold", color: r.state === "losing" ? C.muted : C.text });
    const bot = right.addStack();
    bot.addSpacer();
    text(bot, r.live ? STATE_WORD[r.state] : r.odds, { size: 10, color: STATE_COLOR[r.state] || C.muted, weight: "semibold" });
  }
}

function empty(w, m, size) {
  w.addSpacer();
  text(w, "No open bets", { size: size === "small" ? 15 : 17, weight: "bold" });
  w.addSpacer(3);
  const line = m.today.settled ? `${m.today.w}-${m.today.l} today · ${m.today.text}` : "Tap to add one in hedgehog";
  text(w, line, { size: 11, color: m.today.profit > 0 ? C.win : m.today.profit < 0 ? C.red : C.muted, weight: "regular", lines: 2 });
  w.addSpacer();
}

function footer(w, m, stale) {
  const f = w.addStack();
  f.centerAlignContent();
  const bits = [];
  if (!m.live && m.nextKickText) bits.push(`Next ${m.nextKickText}`);
  if (m.live && (m.winning || m.losing)) bits.push(`${m.winning} winning · ${m.losing} losing`);
  text(f, bits.join(" · "), { size: 9.5, color: C.faint, weight: "regular" });
  f.addSpacer();
  const t = new Date(m.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  text(f, stale ? `⚠︎ ${t}` : t, { size: 9.5, color: stale ? C.amber : C.faint, weight: "regular" });
}

function small(w, m, stale) {
  header(w, m, { compact: true });
  if (!m.open) return empty(w, m, "small");
  w.addSpacer(6);
  const big = w.addStack();
  big.centerAlignContent();
  if (m.live) {
    text(big, `${m.winning}`, { size: 30, weight: "heavy", color: C.win });
    text(big, ` / ${m.live}`, { size: 18, weight: "bold", color: C.muted });
  } else {
    text(big, `${m.open}`, { size: 30, weight: "heavy" });
    text(big, " open", { size: 14, weight: "bold", color: C.muted });
  }
  text(w, m.live ? "winning live" : m.nextKickText ? `next ${m.nextKickText}` : `${fmt(m.toWin)} to win`, { size: 10.5, color: C.muted, weight: "regular" });
  w.addSpacer();
  for (const r of m.rows.slice(0, 2)) {
    const s = w.addStack();
    s.centerAlignContent();
    dot(s, STATE_COLOR[r.state] || C.faint, 6);
    s.addSpacer(5);
    text(s, r.title, { size: 11, weight: "semibold" });
    w.addSpacer(2);
  }
  if (stale) text(w, "⚠︎ offline", { size: 9, color: C.amber });
}

function medium(w, m, stale) {
  header(w, m);
  if (!m.open) return empty(w, m, "medium");
  w.addSpacer(8);
  for (const r of m.rows.slice(0, 3)) {
    betRow(w, r);
    w.addSpacer(6);
  }
  w.addSpacer();
  footer(w, m, stale);
}

function large(w, m, stale) {
  header(w, m);
  w.addSpacer(10);
  statLine(w, m);
  if (!m.open) return empty(w, m, "large");
  w.addSpacer(10);
  let room = 8; // rows fit in the large widget, counting a parlay's leg line as half a row
  let shown = 0;
  for (const r of m.rows) {
    const parlay = r.legs.length > 1;
    if (room < (parlay ? 1.5 : 1)) break;
    betRow(w, r);
    if (parlay) {
      w.addSpacer(2);
      legLine(w, r);
    }
    w.addSpacer(7);
    room -= parlay ? 1.5 : 1;
    shown++;
  }
  if (m.rows.length > shown) text(w, `+${m.rows.length - shown} more`, { size: 10, color: C.muted });
  w.addSpacer();
  footer(w, m, stale);
}

// Lock Screen widgets are drawn by iOS in one tint, so they lean on text and symbols.
function lockLine(m) {
  if (!m.open) return m.today.text ? `🦔 ${m.today.text} today` : "🦔 No open bets";
  if (m.live) return `🦔 ${m.winning}↑ ${m.losing}↓ live${m.today.text ? ` · ${m.today.text}` : ""}`;
  return `🦔 ${m.open} open${m.nextKickText ? ` · next ${m.nextKickText}` : ""}`;
}

function rectangular(w, m) {
  w.setPadding(0, 0, 0, 0);
  const plain = { color: "#ffffff" };
  text(w, lockLine(m), { size: 13, weight: "bold", ...plain });
  for (const r of m.rows.slice(0, 2)) {
    const mark = { winning: "▲", losing: "▼", even: "=", live: "●", pending: "○" }[r.state] || "○";
    text(w, `${mark} ${r.title}${r.live && r.sub ? ` · ${r.sub.split(" · ").pop()}` : ""}`, { size: 12, weight: "regular", ...plain });
  }
}

function circular(w, m) {
  w.addAccessoryWidgetBackground = true;
  w.setPadding(0, 0, 0, 0);
  const s = w.addStack();
  s.layoutVertically();
  s.centerAlignContent();
  const row = (str, size, weight) => {
    const r = s.addStack();
    r.addSpacer();
    text(r, str, { size, weight, color: "#ffffff" });
    r.addSpacer();
  };
  if (m.live) {
    row(`${m.winning}/${m.live}`, 17, "heavy");
    row("LIVE", 9, "bold");
  } else {
    row(`${m.open}`, 20, "heavy");
    row("OPEN", 9, "bold");
  }
}

function signedOut(w, family) {
  if (family?.startsWith("accessory")) {
    text(w, "🦔 Open Scriptable to sign in", { size: 12, color: "#ffffff" });
    return;
  }
  header(w, { live: 0, today: {} }, { compact: family === "small" });
  w.addSpacer();
  text(w, "Sign in to see your bets", { size: 15, weight: "bold", lines: 2 });
  w.addSpacer(3);
  text(w, "Open Scriptable and run the hedgehog script once.", { size: 11, color: C.muted, weight: "regular", lines: 3 });
  w.addSpacer();
}

export function draw(m, { family = "medium", site = "", stale = false } = {}) {
  const w = base(site);
  if (!m) signedOut(w, family);
  else if (family === "accessoryInline") text(w, lockLine(m), { color: "#ffffff" });
  else if (family === "accessoryRectangular") rectangular(w, m);
  else if (family === "accessoryCircular") circular(w, m);
  else if (family === "small") small(w, m, stale);
  else if (family === "large" || family === "extraLarge") large(w, m, stale);
  else medium(w, m, stale);
  if (m) w.refreshAfterDate = new Date(stale ? Date.now() + 10 * 60e3 : m.refreshAt);
  return w;
}

// ───────── in-app menu (running the script inside Scriptable) ─────────

async function signIn() {
  const a = new Alert();
  a.title = "Sign in to hedgehog";
  a.message = "Use the email and password from your hedgehog account. They're kept in this phone's Keychain so the widget can refresh on its own.";
  a.addTextField("Email", Keychain.contains(KEY.email) ? Keychain.get(KEY.email) : "");
  a.addSecureTextField("Password", "");
  a.addAction("Sign in");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;
  const email = a.textFieldValue(0).trim();
  const password = a.textFieldValue(1);
  try {
    await token("password", { email, password });
  } catch (e) {
    const err = new Alert();
    err.title = "Couldn't sign in";
    err.message = /invalid/i.test(e.message) ? "That email and password don't match a hedgehog account." : e.message;
    err.addAction("OK");
    await err.presentAlert();
    return false;
  }
  Keychain.set(KEY.email, email);
  Keychain.set(KEY.password, password);
  return true;
}

function signOut() {
  for (const k of Object.values(KEY)) if (Keychain.contains(k)) Keychain.remove(k);
  try {
    fm().remove(cachePath());
  } catch {}
}

async function menu(site) {
  const signedIn = Keychain.contains(KEY.email);
  if (!signedIn) {
    if (!(await signIn())) return;
  }
  for (;;) {
    const a = new Alert();
    a.title = "🦔 hedgehog widget";
    a.message = `Signed in as ${Keychain.get(KEY.email)}.\n\nAdd it: long-press your Home Screen (or Lock Screen → Customize) → + → Scriptable → pick a size → tap the widget → Script: this one.`;
    a.addAction("Preview small");
    a.addAction("Preview medium");
    a.addAction("Preview large");
    if (site) a.addAction("Open hedgehog");
    a.addDestructiveAction("Sign out");
    a.addCancelAction("Done");
    const i = await a.presentAlert();
    if (i === -1) return;
    if (i <= 2) {
      const family = ["small", "medium", "large"][i];
      const w = await widget(family, site);
      await (family === "small" ? w.presentSmall() : family === "large" ? w.presentLarge() : w.presentMedium());
    } else if (site && i === 3) {
      Safari.open(`${site}#bets`);
      return;
    } else {
      signOut();
      return;
    }
  }
}

async function widget(family, site) {
  let access;
  try {
    access = await accessToken();
  } catch {
    access = undefined; // network trouble: fall back to the cache
  }
  if (access === null) return draw(null, { family, site });
  try {
    if (!access) throw new Error("offline");
    const bets = await loadBets(access);
    const games = await loadGames(daysToFetch(bets));
    const m = buildModel(bets, games);
    saveCache(m);
    return draw(m, { family, site });
  } catch {
    const cached = readCache();
    return draw(cached, { family, site, stale: !!cached });
  }
}

/** Entry point called by the installer script. */
export async function run({ site = "" } = {}) {
  if (config.runsInWidget) {
    Script.setWidget(await widget(config.widgetFamily || "medium", site));
  } else {
    await menu(site);
  }
  Script.complete();
}
