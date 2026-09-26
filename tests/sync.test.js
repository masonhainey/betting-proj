import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMeta, syncOnce, noteLocalChanges, hashOf } from "../js/sync.js";

// In-memory stand-in for the Supabase table + the last-write-wins trigger in schema.sql.
function fakeServer() {
  const rows = new Map();
  let clock = Date.parse("2026-09-26T12:00:00Z");
  return {
    rows,
    remoteFor: (userId) => ({
      async upsert(batch) {
        for (const r of batch) {
          assert.equal(r.user_id, userId);
          const key = `${userId}/${r.id}`;
          const old = rows.get(key);
          if (old && Date.parse(r.updated_at) < Date.parse(old.updated_at)) continue; // trigger: return null
          rows.set(key, { ...r, synced_at: new Date(++clock).toISOString() });
        }
      },
      async pullSince(since) {
        return [...rows.values()]
          .filter((r) => r.user_id === userId && (!since || Date.parse(r.synced_at) > Date.parse(since)))
          .sort((a, b) => Date.parse(a.synced_at) - Date.parse(b.synced_at))
          .map((r) => structuredClone(r));
      },
    }),
  };
}

function device(server, userId = "u1") {
  const d = { bets: [], meta: emptyMeta(userId), settings: { oddsFormat: "american", unit: 10 } };
  d.sync = () =>
    syncOnce({ getBets: () => d.bets, remote: server.remoteFor(userId), meta: d.meta, userId, settings: d.settings }).then((r) => {
      d.bets = r.bets;
      if (r.settings) Object.assign(d.settings, r.settings);
      return r;
    });
  return d;
}

const bet = (id, extra = {}) => ({ id, createdAt: `2026-09-2${id.length}T10:00:00Z`, stake: 10, type: "straight", legs: [{ id: "l" + id, pick: "Texas -7.5", odds: 1.91, status: "open" }], ...extra });
const tick = () => new Promise((r) => setTimeout(r, 3)); // distinct ms timestamps

test("a bet logged on the phone shows up on the laptop", async () => {
  const s = fakeServer();
  const phone = device(s), laptop = device(s);
  phone.bets.push(bet("a"));
  const r1 = await phone.sync();
  assert.equal(r1.pushed, 2, "the bet + your settings");
  const r2 = await laptop.sync();
  assert.equal(r2.added, 1);
  assert.equal(laptop.bets[0].legs[0].pick, "Texas -7.5");
  // Nothing new → nothing pushed or changed.
  const r3 = await laptop.sync();
  assert.equal(r3.pushed, 0);
  assert.equal(r3.added + r3.updated + r3.removed, 0);
});

test("first sign-in merges bets from both devices", async () => {
  const s = fakeServer();
  const phone = device(s), laptop = device(s);
  phone.bets.push(bet("p1"), bet("p2"));
  laptop.bets.push(bet("l1"));
  await phone.sync();
  await laptop.sync();
  await phone.sync();
  assert.deepEqual(phone.bets.map((b) => b.id).sort(), ["l1", "p1", "p2"]);
  assert.deepEqual(laptop.bets.map((b) => b.id).sort(), ["l1", "p1", "p2"]);
});

test("edits: newest wins, including against a stale device", async () => {
  const s = fakeServer();
  const phone = device(s), laptop = device(s);
  phone.bets.push(bet("a"));
  await phone.sync();
  await laptop.sync();
  // Laptop grades it first, phone edits the note a moment later.
  laptop.bets[0].legs[0].status = "won";
  noteLocalChanges(laptop.bets, laptop.meta, laptop.settings);
  await tick();
  phone.bets[0].note = "hammer";
  noteLocalChanges(phone.bets, phone.meta, phone.settings);
  await phone.sync(); // newer edit lands first
  await laptop.sync(); // older edit is rejected by the server, then laptop pulls the newer one
  await phone.sync();
  assert.equal(laptop.bets[0].note, "hammer");
  assert.equal(phone.bets[0].note, "hammer");
  assert.equal(laptop.bets[0].legs[0].status, "open", "whole-bet last write wins");
});

test("deletes propagate and don't resurrect", async () => {
  const s = fakeServer();
  const phone = device(s), laptop = device(s);
  phone.bets.push(bet("a"), bet("bb"));
  await phone.sync();
  await laptop.sync();
  await tick();
  laptop.bets = laptop.bets.filter((b) => b.id !== "a");
  await laptop.sync();
  await phone.sync();
  assert.deepEqual(phone.bets.map((b) => b.id), ["bb"]);
  await laptop.sync();
  assert.deepEqual(laptop.bets.map((b) => b.id), ["bb"]);
});

test("settings sync too", async () => {
  const s = fakeServer();
  const phone = device(s), laptop = device(s);
  await laptop.sync();
  await tick();
  phone.settings.oddsFormat = "decimal";
  phone.settings.unit = 25;
  await phone.sync();
  await laptop.sync();
  assert.equal(laptop.settings.oddsFormat, "decimal");
  assert.equal(laptop.settings.unit, 25);
});

test("accounts are separate", async () => {
  const s = fakeServer();
  const me = device(s, "u1"), friend = device(s, "u2");
  me.bets.push(bet("a"));
  await me.sync();
  await friend.sync();
  assert.equal(friend.bets.length, 0);
});

test("hash ignores the sync timestamp", () => {
  assert.equal(hashOf({ a: 1, updatedAt: "x" }), hashOf({ a: 1, updatedAt: "y" }));
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
});
