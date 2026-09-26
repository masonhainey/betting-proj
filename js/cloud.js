// Accounts and storage on Supabase, over plain fetch (no SDK to download).
// Auth: email one-time code — works inside an iPhone home-screen app, where a magic link
// would open Safari instead. Magic links still work when opened in the same browser.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { load, save, remove } from "./store.js";

// localStorage override lets you try a project without editing config.js.
const override = load("cloudConfig", null);
const BASE = (override?.url || SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = override?.key || SUPABASE_ANON_KEY || "";

export const configured = !!(BASE && KEY);

let session = load("auth", null);
let refreshing = null;
const listeners = new Set();

export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn(session?.user || null));

export const currentUser = () => session?.user || null;

function setSession(s) {
  if (!s?.access_token) throw new Error("Sign-in didn't return a session");
  session = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  save("auth", session);
  emit();
}

function clearSession() {
  session = null;
  remove("auth");
  emit();
}

async function request(path, { method = "GET", body, headers = {}, token } = {}) {
  const h = { apikey: KEY, "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    const e = new Error("Offline — will sync when you're back online");
    e.offline = true;
    throw e;
  }
  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j.msg || j.message || j.error_description || j.error || "";
    } catch {}
    const e = new Error(friendly(res.status, msg));
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function friendly(status, msg) {
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(msg)) return "That code is wrong or expired. Request a new one.";
  if (status === 429 || /rate limit/i.test(msg)) return "Too many emails. Wait a minute and try again.";
  if (/email.*(invalid|valid)/i.test(msg)) return "That email address doesn't look right.";
  return msg || `Sync error (${status})`;
}

/** Access token, refreshed if it's about to expire. null when signed out. */
async function token() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= (async () => {
    const used = session.refresh_token;
    try {
      setSession(await request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: used } }));
    } catch (e) {
      // Another tab may have refreshed first (refresh tokens are single-use).
      const latest = load("auth", null);
      if (latest && latest.refresh_token !== used && latest.expires_at - 60 > Date.now() / 1000) {
        session = latest;
      } else if (!e.offline) {
        clearSession();
      } else throw e;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session?.access_token || null;
}

async function authed(path, opts = {}) {
  const tk = await token();
  if (!tk) throw Object.assign(new Error("Signed out"), { signedOut: true });
  try {
    return await request(path, { ...opts, token: tk });
  } catch (e) {
    if (e.status === 401) {
      // Token revoked or clock skew: one forced refresh, then give up.
      session.expires_at = 0;
      const again = await token();
      if (!again) throw Object.assign(new Error("Signed out"), { signedOut: true });
      return request(path, { ...opts, token: again });
    }
    throw e;
  }
}

export async function sendCode(email) {
  await request("/auth/v1/otp", { method: "POST", body: { email: email.trim(), create_user: true } });
}

export async function verifyCode(email, code) {
  setSession(await request("/auth/v1/verify", { method: "POST", body: { type: "email", email: email.trim(), token: code.replace(/\s/g, "") } }));
}

/** Finish a magic-link sign-in if the page was opened from one. Returns true if it did. */
export async function sessionFromUrl() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("error_description")) {
    history.replaceState(null, "", location.pathname + location.search + "#bets");
    throw new Error(h.get("error_description"));
  }
  const at = h.get("access_token");
  if (!at) return false;
  history.replaceState(null, "", location.pathname + location.search + "#bets");
  const user = await request("/auth/v1/user", { token: at });
  setSession({ access_token: at, refresh_token: h.get("refresh_token"), expires_in: Number(h.get("expires_in")) || 3600, user });
  return true;
}

export async function signOut() {
  const tk = session?.access_token;
  clearSession();
  if (tk) request("/auth/v1/logout", { method: "POST", token: tk }).catch(() => {});
}

const COLS = "id,kind,data,deleted,updated_at,synced_at";

/** The table interface sync.js expects. */
export const remote = {
  async upsert(rows) {
    for (let i = 0; i < rows.length; i += 500) {
      await authed("/rest/v1/records?on_conflict=user_id,id", {
        method: "POST",
        body: rows.slice(i, i + 500),
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      });
    }
  },
  async pullSince(since) {
    const out = [];
    let cursor = since;
    for (;;) {
      const q = `/rest/v1/records?select=${COLS}&order=synced_at.asc&limit=1000${cursor ? `&synced_at=gt.${encodeURIComponent(cursor)}` : ""}`;
      const page = await authed(q);
      out.push(...page);
      if (page.length < 1000) return out;
      cursor = page[page.length - 1].synced_at;
    }
  },
};
