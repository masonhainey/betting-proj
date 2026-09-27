import { test } from "node:test";
import assert from "node:assert/strict";
import { run, etDay, supabase } from "../scripts/alerts-worker.mjs";

function fakeDb(state) {
  return {
    async get(path) {
      if (path.startsWith("app_secrets")) return state.vapid ? [{ value: state.vapid }] : [];
      if (path.startsWith("push_subscriptions")) return state.subs;
      if (path.startsWith("records")) {
        const u = /user_id=eq\.([^&]+)/.exec(path)[1];
        return state.records.filter((r) => r.user_id === u);
      }
      throw new Error("unexpected " + path);
    },
    async insert(table, rows) {
      if (table === "app_secrets") { state.vapid = rows[0].value; return null; }
      if (table === "push_log") {
        const k = `${rows[0].user_id}/${rows[0].key}`;
        if (state.log.has(k)) return [];
        state.log.add(k);
        return rows;
      }
    },
    async del(path) { state.subs = state.subs.filter((s) => !path.includes(encodeURIComponent(s.endpoint))); },
  };
}

const kickoff = "2026-09-26T19:30:00Z";
const now = new Date("2026-09-27T01:00:00Z");
const G = (id, h, a) => ({ id, state: "post", completed: true, period: 4, shortName: "AWY @ HOM", home: { abbr: "HOM", short: "Home", score: h }, away: { abbr: "AWY", short: "Away", score: a } });

function setup() {
  return {
    vapid: null,
    log: new Set(),
    subs: [
      { endpoint: "https://push.example/phone", user_id: "u1", p256dh: "k", auth: "a", prefs: {} },
      { endpoint: "https://push.example/laptop", user_id: "u1", p256dh: "k", auth: "a", prefs: { bets: false } },
      { endpoint: "https://push.example/friend", user_id: "u2", p256dh: "k", auth: "a", prefs: {} },
    ],
    records: [
      { user_id: "u1", id: "b1", data: { stake: 10, legs: [{ id: "l1", pick: "Home -3.5", odds: 1.9091, status: "open", gameId: "401", market: "spread", side: "home", line: -3.5, kickoff }] } },
      { user_id: "u2", id: "b2", data: { stake: 10, legs: [{ id: "l1", pick: "Away ML", odds: 2.5, status: "open", gameId: "401", market: "ml", side: "away", kickoff }] } },
      { user_id: "u2", id: "b3", data: { stake: 10, legs: [{ id: "l1", pick: "Future", odds: 5, status: "open" }] } },
    ],
  };
}

test("sends each new result once, to the right devices, honoring prefs", async () => {
  const state = setup();
  const sent = [];
  const fetchedDays = [];
  const opts = {
    db: fakeDb(state),
    send: async (s, p) => sent.push([s.endpoint, p.title]),
    generateKeys: () => ({ publicKey: "PUB", privateKey: "PRIV" }),
    fetchGames: async (days) => (fetchedDays.push(...days), new Map([["401", G("401", 28, 21)]])),
    now,
    log: () => {},
  };
  const r1 = await run(opts);
  assert.equal(state.vapid.publicKey, "PUB", "keys created on first run");
  assert.deepEqual(fetchedDays, ["cfb|20260926"], "ESPN day in US Eastern time, league defaults to college");
  assert.deepEqual(sent, [
    ["https://push.example/phone", "💰 Cashed: Home -3.5"],
    ["https://push.example/friend", "❌ Lost: Away ML"],
  ], "laptop opted out of bet results");
  assert.equal(r1.events, 2);
  sent.length = 0;
  await run(opts);
  assert.equal(sent.length, 0, "no repeats on the next run");
});

test("dead devices are removed", async () => {
  const state = setup();
  state.vapid = { publicKey: "PUB", privateKey: "PRIV" };
  await run({
    db: fakeDb(state),
    send: async (s) => { if (s.endpoint.endsWith("phone")) throw Object.assign(new Error("gone"), { statusCode: 410 }); },
    generateKeys: () => { throw new Error("should reuse keys"); },
    fetchGames: async () => new Map([["401", G("401", 28, 21)]]),
    now,
    log: () => {},
  });
  assert.deepEqual(state.subs.map((s) => s.endpoint), ["https://push.example/laptop", "https://push.example/friend"]);
});

test("nothing to do without devices or recent games", async () => {
  const state = setup();
  state.subs = [];
  assert.equal((await run({ db: fakeDb(state), send: async () => {}, generateKeys: () => ({ publicKey: "P", privateKey: "Q" }), log: () => {} })).sent, 0);
});

test("eastern-time day and secret-key headers", async () => {
  assert.equal(etDay("2026-09-27T02:30:00Z"), "20260926", "10:30pm ET game belongs to the 26th");
  let seen;
  const db = supabase("https://x.supabase.co/", "sb_secret_abc", async (url, init) => ((seen = { url, init }), { ok: true, text: async () => "[]" }));
  await db.get("push_subscriptions?select=endpoint");
  assert.equal(seen.url, "https://x.supabase.co/rest/v1/push_subscriptions?select=endpoint");
  assert.equal(seen.init.headers.apikey, "sb_secret_abc");
  assert.equal(seen.init.headers.Authorization, undefined, "new secret keys aren't JWTs");
});

test("player props settle from the final box score and alert", async () => {
  const state = setup();
  state.vapid = { publicKey: "PUB", privateKey: "PRIV" };
  state.subs = [state.subs[0]];
  state.records = [{ user_id: "u1", id: "p1", data: { stake: 10, legs: [{ id: "l1", pick: "Josh Allen Over 250.5 Passing Yards", odds: 1.9, status: "open", gameId: "401", sport: "nfl", market: "prop", prop: { player: "Josh Allen", stat: "pass_yds", side: "over", line: 250.5 }, kickoff }] } }];
  const sent = [];
  const boxes = [];
  await run({
    db: fakeDb(state),
    send: async (s, p) => sent.push(p.title),
    generateKeys: () => ({}),
    fetchGames: async () => new Map([["401", G("401", 28, 21)]]),
    fetchBox: async (id, sport) => (boxes.push([id, sport]), { final: true, players: [{ id: "1", name: "Josh Allen", short: "J. Allen", team: "2", stats: { passYds: 262, passTD: 2, cmp: 24, att: 35, int: 0, rushYds: 0, rushAtt: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 } }] }),
    now,
    log: () => {},
  });
  assert.deepEqual(boxes, [["401", "nfl"]]);
  assert.deepEqual(sent, ["💰 Cashed: Josh Allen Over 250.5 Passing Yards"]);
});
