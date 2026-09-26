// Accounts and storage on Supabase, over plain fetch (no SDK to download).
// Auth: email + password. It works the same inside an iPhone home-screen app (where an
// emailed link would open Safari instead) and needs no custom email setup. Email is only
// used for the optional sign-up confirmation and for password resets.

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
  if (/could not find the (table|function)|relation .* does not exist|schema cache/i.test(msg)) return "The friends leaderboard isn't set up in Supabase yet (run supabase/friends.sql).";
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: tap the link in the email from Supabase, then sign in here.";
  if (/already (been )?registered|already exists/i.test(msg)) return "There's already an account with that email. Sign in instead.";
  if (/password.*(at least|short|characters)/i.test(msg)) return "Use a password with at least 6 characters.";
  if (/same.*password|different from the old/i.test(msg)) return "Pick a password you haven't used before.";
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(msg)) return "That link expired. Request a new one.";
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

const appUrl = () => location.origin + location.pathname;

/** Create an account. Returns { signedIn } — false when Supabase wants the email confirmed first. */
export async function signUp(email, password) {
  const r = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(appUrl())}`, { method: "POST", body: { email: email.trim(), password } });
  if (r?.access_token) {
    setSession(r);
    return { signedIn: true };
  }
  return { signedIn: false };
}

export async function signIn(email, password) {
  setSession(await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email: email.trim(), password } }));
}

/** Email a password-reset link that comes back to this app. */
export async function resetPassword(email) {
  await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(appUrl())}`, { method: "POST", body: { email: email.trim() } });
}

export async function updatePassword(password) {
  await authed("/auth/v1/user", { method: "PUT", body: { password } });
}

/**
 * Finish sign-in when the page was opened from an emailed link (sign-up confirmation or
 * password reset). Returns false, "signup", "recovery" or "magiclink".
 */
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
  return h.get("type") || "magiclink";
}

export async function signOut() {
  const tk = session?.access_token;
  clearSession();
  if (tk) request("/auth/v1/logout", { method: "POST", token: tk }).catch(() => {});
}

/** Signed-in REST calls for other tables and database functions (friends leaderboard). */
export const api = {
  get: (path) => authed(`/rest/v1/${path}`),
  rpc: (fn, args) => authed(`/rest/v1/rpc/${fn}`, { method: "POST", body: args }),
  upsert: (table, rows, onConflict) =>
    authed(`/rest/v1/${table}?on_conflict=${onConflict}`, { method: "POST", body: rows, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }),
  patch: (path, body) => authed(`/rest/v1/${path}`, { method: "PATCH", body, headers: { Prefer: "return=minimal" } }),
  del: (path) => authed(`/rest/v1/${path}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
};

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
