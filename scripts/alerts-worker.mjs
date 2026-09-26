// Alerts worker: runs on a schedule (GitHub Actions, every ~5 minutes). For every device
// that turned alerts on, it checks that person's open bets against ESPN final scores and
// sends a push notification for anything newly decided. It never edits bets — the app
// re-grades itself next time it opens.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (the project's secret / service_role key).
// Push signing (VAPID) keys are created on first run and kept in Supabase (app_secrets),
// so no other secrets are needed.

import { etDay, fetchScoreboard } from "../js/espn.js";
import { computeServerEvents } from "../js/alertrules.js";

const MAX_PER_USER = 6; // never flood someone (e.g. first run after days away)
const LOOKBACK_DAYS = 2;

/** Minimal Supabase REST client using the secret key (bypasses row-level security). */
export function supabase(url, key, fetchImpl = fetch) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy service_role JWT
  const call = async (path, { method = "GET", body, prefer } = {}) => {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (path) => call(path),
    insert: (table, rows, prefer = "return=minimal") => call(table, { method: "POST", body: rows, prefer }),
    del: (path) => call(path, { method: "DELETE", prefer: "return=minimal" }),
  };
}

export { etDay };

export async function run({ db, send, generateKeys, fetchGames = defaultFetchGames, now = new Date(), log = console.log }) {
  // 1. Push signing keys (made once, kept server-side).
  let vapid = (await db.get("app_secrets?name=eq.vapid&select=value"))[0]?.value;
  if (!vapid) {
    vapid = generateKeys();
    await db.insert("app_secrets", [{ name: "vapid", value: vapid }]);
    log("Created push signing keys.");
  }

  // 2. Who wants alerts.
  const subs = await db.get("push_subscriptions?select=endpoint,user_id,p256dh,auth,prefs");
  if (!subs.length) {
    log("No devices have alerts turned on.");
    return { vapid, sent: 0, events: 0 };
  }
  const users = [...new Set(subs.map((s) => s.user_id))];

  // 3. Their open bets with legs linked to games.
  const betsByUser = {};
  const days = new Set();
  const since = now.getTime() - LOOKBACK_DAYS * 864e5;
  for (const u of users) {
    const rows = await db.get(`records?select=id,data&user_id=eq.${u}&kind=eq.bet&deleted=eq.false`);
    const bets = rows.map((r) => ({ ...r.data, id: r.id })).filter((b) => Array.isArray(b.legs) && b.legs.some((l) => l.status === "open" && l.gameId));
    betsByUser[u] = bets;
    for (const b of bets) {
      for (const l of b.legs) {
        if (l.status !== "open" || !l.gameId || !l.kickoff) continue;
        const t = Date.parse(l.kickoff);
        if (t >= since && t <= now.getTime() + 6 * 3600e3) days.add(etDay(t));
      }
    }
  }
  if (!days.size) {
    log(`${subs.length} device(s), no open bets on recent games.`);
    return { vapid, sent: 0, events: 0 };
  }

  // 4. Scores.
  const games = await fetchGames([...days]);
  const game = (id) => games.get(String(id));

  // 5. New events → dedupe via push_log → send to each device (respecting its prefs).
  let sent = 0, events = 0;
  for (const u of users) {
    const evs = computeServerEvents(betsByUser[u], game).slice(0, MAX_PER_USER);
    for (const ev of evs) {
      const fresh = await db.insert("push_log", [{ user_id: u, key: ev.key }], "resolution=ignore-duplicates,return=representation");
      if (!fresh?.length) continue; // already sent on an earlier run
      events++;
      for (const s of subs.filter((x) => x.user_id === u)) {
        const prefs = s.prefs || {};
        if (prefs[ev.type] === false || (ev.ghost && prefs.ghosts === false)) continue;
        try {
          await send(s, { title: ev.title, body: ev.body, tag: ev.tag, url: ev.url });
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await db.del(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
            log(`Removed a device that no longer accepts alerts.`);
          } else log(`Push failed (${e.statusCode || e.message}).`);
        }
      }
    }
  }
  log(`${subs.length} device(s), ${events} new alert(s), ${sent} sent.`);
  return { vapid, sent, events };
}

async function defaultFetchGames(days) {
  const games = new Map();
  for (const d of days) {
    try {
      for (const g of await fetchScoreboard(d)) games.set(g.id, g);
    } catch (e) {
      console.log(`Scoreboard ${d} failed: ${e.message}`);
    }
  }
  return games;
}

// ── entry point ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.log("SUPABASE_URL / SUPABASE_SECRET_KEY not set; nothing to do.");
    process.exit(0);
  }
  const webpush = (await import("web-push")).default;
  const db = supabase(SUPABASE_URL, SUPABASE_SECRET_KEY);
  let vapidSet = false;
  await run({
    db,
    generateKeys: () => webpush.generateVAPIDKeys(),
    send: async (s, payload) => {
      if (!vapidSet) {
        const v = (await db.get("app_secrets?name=eq.vapid&select=value"))[0].value;
        webpush.setVapidDetails("https://masonhainey.github.io/betting-proj/", v.publicKey, v.privateKey);
        vapidSet = true;
      }
      return webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
    },
  });
}
