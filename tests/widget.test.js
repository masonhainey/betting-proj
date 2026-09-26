import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, clockText, daysToFetch } from "../widget/src/model.js";
import { installerCode } from "../js/widget.js";

const now = new Date("2026-09-26T20:00:00Z"); // Saturday 4 PM ET
const team = (id, abbr, score) => ({ id, abbr, short: abbr, name: abbr, score });
const G = {
  live: { id: "1", date: "2026-09-26T19:30:00Z", state: "in", completed: false, shortDetail: "8:21 - 1st", clock: "8:21", shortName: "UGA @ ALA", period: 1, home: team("333", "ALA", 3), away: team("61", "UGA", 7) },
  live2: { id: "2", date: "2026-09-26T19:00:00Z", state: "in", completed: false, shortDetail: "2:10 - 2nd", clock: "2:10", shortName: "TEX @ OU", period: 2, home: team("201", "OU", 14), away: team("251", "TEX", 10) },
  later: { id: "3", date: "2026-09-26T23:30:00Z", state: "pre", completed: false, shortDetail: "", shortName: "LSU @ MISS", period: 0, home: team("145", "MISS", null), away: team("99", "LSU", null) },
  final: { id: "4", date: "2026-09-26T16:00:00Z", state: "post", completed: true, shortDetail: "Final", shortName: "ND @ PUR", period: 4, home: team("2509", "PUR", 10), away: team("87", "ND", 31) },
};
const games = new Map(Object.values(G).map((g) => [g.id, g]));
const leg = (id, gameId, market, side, line, odds = 1.91) => ({ id, pick: `${side} ${line ?? ""}`, odds, status: "open", gameId, market, side, line, kickoff: games.get(gameId)?.date });

const bets = [
  { id: "a", createdAt: "2026-09-26T12:00:00Z", stake: 50, legs: [leg("a1", "1", "spread", "away", -2.5)] }, // UGA -2.5 up 4: winning
  { id: "b", createdAt: "2026-09-26T12:00:00Z", stake: 10, legs: [leg("b1", "2", "ml", "away"), leg("b2", "3", "total", "over", 55.5)] }, // TEX ML down 4: losing
  { id: "c", createdAt: "2026-09-26T12:00:00Z", stake: 20, legs: [leg("c1", "3", "ml", "home", null, 1.5)] }, // later tonight
  { id: "d", createdAt: "2026-09-26T12:00:00Z", stake: 25, legs: [leg("d1", "4", "spread", "away", -7.5)] }, // ND covered: graded in memory
  { id: "g", ghost: true, createdAt: "2026-09-26T12:00:00Z", stake: 100, legs: [leg("g1", "1", "ml", "home")] }, // ghosts don't show
  { id: "e", createdAt: "2026-09-20T12:00:00Z", settledAt: "2026-09-20T23:00:00Z", stake: 10, legs: [{ ...leg("e1", "4", "ml", "home"), status: "lost" }] }, // old news
];

test("widget model: live first, worst news first, ghosts left out", () => {
  const m = buildModel(bets, games, now);
  assert.deepEqual(m.rows.map((r) => r.id), ["b", "a", "c"]);
  assert.equal(m.open, 3);
  assert.equal(m.live, 2);
  assert.equal(m.winning, 1);
  assert.equal(m.losing, 1);
  const [b, a, c] = m.rows;
  assert.equal(a.title, "UGA -2.5");
  assert.equal(a.state, "winning");
  assert.match(a.sub, /^Q1 8:21 · Covering by 1\.5$/);
  assert.equal(b.title, "2-leg parlay");
  assert.equal(b.state, "losing");
  assert.match(b.sub, /^0\/2 in · TEX ML Q2 2:10 · Down 4$/);
  assert.equal(c.state, "pending");
  assert.match(c.sub, /LSU @ MISS · \d+:30 PM/);
  assert.equal(c.pays, "$30.00");
  assert.equal(c.odds, "-200");
});

test("widget model: today's result counts games that finished before the app re-graded", () => {
  const m = buildModel(bets, games, now);
  assert.equal(m.today.settled, 1);
  assert.ok(Math.abs(m.today.profit - 25 * 0.91) < 1e-9);
  assert.equal(m.today.text, "+$22.75");
  assert.equal(m.atRisk, 80);
});

test("widget refresh timing: 5 min live, next kickoff otherwise, hourly at most", () => {
  const t = now.getTime();
  assert.equal(buildModel(bets, games, now).refreshAt, t + 5 * 60e3);
  const onlyLater = buildModel([bets[2]], games, now);
  assert.equal(onlyLater.refreshAt, t + 60 * 60e3, "kickoff 3.5h away: hourly");
  const soon = new Date(Date.parse(G.later.date) - 20 * 60e3);
  assert.equal(buildModel([bets[2]], games, soon).refreshAt, Date.parse(G.later.date));
  assert.equal(buildModel([], games, now).open, 0);
});

test("scoreboard days: today plus open legs' days (Eastern), nothing stale", () => {
  const future = { id: "f", stake: 5, legs: [{ ...leg("f1", "9", "ml", "home"), kickoff: "2026-10-04T01:00:00Z" }] }; // Oct 3, 9 PM ET
  assert.deepEqual(daysToFetch([...bets, future], now), ["20260926", "20261003"]);
});

// ── the real bundle, run against a stand-in for Scriptable ──

function scriptable({ responses, keychain = {}, family = "medium", runsInWidget = true }) {
  const texts = [];
  const out = { widget: null, requests: [], texts, keychain, completed: false };
  class Stack {
    constructor() { this.children = []; }
    addText(s) { texts.push(s); return {}; }
    addStack() { const s = new Stack(); this.children.push(s); return s; }
    addSpacer() {}
    layoutVertically() {}
    layoutHorizontally() {}
    centerAlignContent() {}
    setPadding() {}
  }
  class ListWidget extends Stack {}
  class Request {
    constructor(url) { this.url = url; this.headers = {}; }
    async loadJSON() {
      out.requests.push({ url: this.url, method: this.method, headers: this.headers, body: this.body });
      const r = responses(this.url, this);
      this.response = { statusCode: r.status ?? 200 };
      return r.json;
    }
  }
  const files = {};
  const globals = {
    ListWidget, Request,
    Color: class { constructor(h) { this.hex = h; } },
    Size: class { constructor(w, h) { this.w = w; this.h = h; } },
    LinearGradient: class {},
    Font: new Proxy({}, { get: (_, k) => (n) => ({ k, n }) }),
    Keychain: {
      contains: (k) => k in keychain, get: (k) => keychain[k], set: (k, v) => { keychain[k] = v; }, remove: (k) => { delete keychain[k]; },
    },
    FileManager: { local: () => ({ joinPath: (a, b) => `${a}/${b}`, cacheDirectory: () => "/cache", writeString: (p, s) => { files[p] = s; }, readString: (p) => files[p], fileExists: (p) => p in files, remove: (p) => { delete files[p]; } }) },
    config: { runsInWidget, widgetFamily: family },
    Script: { setWidget: (w) => { out.widget = w; }, complete: () => { out.completed = true; } },
    Alert: class {}, Safari: {},
  };
  const module = { exports: {} };
  const code = readFileSync(new URL("../widget/hedgehog-widget.js", import.meta.url), "utf8");
  new Function("module", "exports", ...Object.keys(globals), code)(module, module.exports, ...Object.values(globals));
  return { mod: module.exports, out, files };
}

const espnEvent = (g) => ({
  id: g.id, shortName: g.shortName,
  competitions: [{ date: g.date, status: { displayClock: "8:21", period: g.period, type: { state: g.state, completed: g.completed, shortDetail: g.shortDetail } },
    competitors: [g.home, g.away].map((t, i) => ({ homeAway: i ? "away" : "home", score: t.score == null ? undefined : String(t.score), team: { id: t.id, abbreviation: t.abbr, shortDisplayName: t.abbr } })) }],
});

const serve = (url) => {
  if (url.includes("/auth/v1/token")) return { json: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } };
  if (url.includes("/rest/v1/records")) return { json: bets.map(({ id, ...data }) => ({ id, data })) };
  if (url.includes("scoreboard")) return { json: { events: Object.values(G).map(espnEvent) } };
  throw new Error(url);
};

for (const family of ["small", "medium", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
  test(`bundle draws the ${family} widget from your account and ESPN`, async () => {
    const { mod, out } = scriptable({ responses: serve, family, keychain: { "hedgehog.email": "me@x.com", "hedgehog.password": "pw" } });
    await mod.run({ site: "https://example.com/hh/" });
    assert.ok(out.widget, "widget set");
    assert.ok(out.completed);
    assert.equal(out.requests[0].body, JSON.stringify({ email: "me@x.com", password: "pw" }));
    const rec = out.requests.find((r) => r.url.includes("records"));
    assert.equal(rec.headers.Authorization, "Bearer AT");
    assert.ok(out.requests.some((r) => /scoreboard\?dates=20260926|scoreboard\?dates=\d{8}&groups=80/.test(r.url)));
    const all = out.texts.join(" | ");
    if (family === "accessoryCircular") assert.match(all, /OPEN|LIVE/);
    else if (family === "accessoryInline") assert.match(all, /🦔/);
    else if (family !== "accessoryRectangular") assert.match(all, /hedgehog/);
    if (family === "medium" || family === "large") assert.match(all, /UGA -2\.5/);
    if (family.startsWith("accessory")) assert.equal(out.widget.url, "https://example.com/hh/#bets");
    assert.ok(out.widget.refreshAfterDate instanceof Date);
    assert.ok(JSON.parse(out.keychain["hedgehog.session"]).refresh === "RT");
  });
}

test("bundle: signed out shows how to sign in; offline falls back to the last good copy", async () => {
  let r = scriptable({ responses: serve });
  await r.mod.run({});
  assert.match(r.out.texts.join(" "), /Sign in to see your bets/);
  assert.equal(r.out.requests.length, 0);

  const keychain = { "hedgehog.email": "me@x.com", "hedgehog.password": "pw" };
  r = scriptable({ responses: serve, keychain });
  await r.mod.run({});
  const cached = r.files["/cache/hedgehog-widget.json"];
  assert.ok(cached);

  const offline = scriptable({ responses: () => ({ status: 0, json: null }), keychain: { ...keychain, "hedgehog.session": JSON.stringify({ access: "AT", refresh: "RT", expires: Date.now() + 3600e3 }) } });
  offline.files["/cache/hedgehog-widget.json"] = cached;
  await offline.mod.run({});
  assert.match(offline.out.texts.join(" "), /⚠︎/, "marked stale");
  assert.match(offline.out.texts.join(" "), /hedgehog/);
});

test("bundle: a changed password signs the widget out instead of showing stale data forever", async () => {
  const { mod, out } = scriptable({
    responses: (url) => (url.includes("token") ? { status: 400, json: { error_description: "Invalid login credentials" } } : serve(url)),
    keychain: { "hedgehog.email": "me@x.com", "hedgehog.password": "old" },
  });
  await mod.run({});
  assert.match(out.texts.join(" "), /Sign in to see your bets/);
});

test("installer is valid Scriptable code pointing at this site", () => {
  const code = installerCode("https://masonhainey.github.io/betting-proj/");
  assert.doesNotThrow(() => new Function(`return (async () => {${code}})`));
  assert.match(code, /betting-proj\/"/);
  assert.match(code, /widget\/hedgehog-widget\.js/);
  assert.match(code, /importModule\("hedgehog-lib\/core"\)/);
  assert.match(readFileSync(new URL("../widget/hedgehog-widget.js", import.meta.url), "utf8"), /hedgehog-widget/, "installer's sanity check matches the bundle");
});

test("widget clock text", () => {
  assert.equal(clockText({ state: "in", period: 3, clock: "2:10", shortDetail: "2:10 - 3rd" }), "Q3 2:10");
  assert.equal(clockText({ state: "in", period: 2, clock: "0:00", shortDetail: "Halftime" }), "Half");
  assert.equal(clockText({ state: "in", period: 4, clock: "0:00", shortDetail: "End of 4th" }), "End of 4th");
  assert.equal(clockText({ state: "in", period: 6, clock: "", shortDetail: "2OT" }), "2OT");
  assert.equal(clockText({ state: "post", shortDetail: "Final/OT" }), "Final/OT");
});
