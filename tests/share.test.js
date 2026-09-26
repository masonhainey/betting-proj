import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeShare, decodeShare, toB64url, fromB64url, shareUrl, shareText } from "../js/share.js";

const bet = {
  id: "abc123", createdAt: "2026-09-26T15:00:00.000Z", stake: 20, book: "DraftKings", ticketPayout: 139.2,
  legs: [
    { id: "l1", pick: "Texas -7.5", odds: 1.9091, status: "open", gameId: "401628374", market: "spread", side: "home", line: -7.5, gameLabel: "TEX @ SC", kickoff: "2026-09-26T19:30:00.000Z" },
    { id: "l2", pick: "Over 56", odds: 1.9091, status: "won", gameId: "401628375", market: "total", side: "over", line: 56 },
    { id: "l3", pick: "Heisman: Arch Manning ✨", odds: 10, status: "open" },
  ],
};

test("round trip keeps the ticket and hides the stake unless asked", () => {
  const t = decodeShare(encodeShare(bet, { name: "Mason 🦔" }));
  assert.equal(t.from, "Mason 🦔");
  assert.equal(t.book, "DraftKings");
  assert.equal(t.src, "abc123");
  assert.equal(t.stake, undefined);
  assert.equal(t.ticketPayout, undefined);
  assert.equal(t.legs.length, 3);
  assert.deepEqual(t.legs[0], { pick: "Texas -7.5", odds: 1.9091, status: "open", gameId: "401628374", sport: "cfb", market: "spread", side: "home", line: -7.5, gameLabel: "TEX @ SC", kickoff: "2026-09-26T19:30:00.000Z" });
  assert.equal(t.legs[1].status, "won");
  assert.equal(t.legs[2].pick, "Heisman: Arch Manning ✨");
  const withStake = decodeShare(encodeShare(bet, { includeStake: true }));
  assert.equal(withStake.stake, 20);
  assert.equal(withStake.ticketPayout, 139.2);
});

test("NFL picks keep their league through a link; old links default to college", () => {
  const nfl = { ...bet, legs: [{ ...bet.legs[0], pick: "Chiefs -3", gameId: "401772001", sport: "nfl" }] };
  assert.equal(decodeShare(encodeShare(nfl)).legs[0].sport, "nfl");
  assert.equal(decodeShare(toB64url(JSON.stringify({ v: 1, l: [{ p: "UGA -3", o: 1.9, g: "401", sp: "<script>" }] }))).legs[0].sport, "cfb");
  assert.equal(decodeShare(toB64url(JSON.stringify({ v: 1, l: [{ p: "Heisman", o: 9 }] }))).legs[0].sport, undefined, "no game, no league");
});

test("links stay short enough for a text message", () => {
  const url = shareUrl(encodeShare(bet, { name: "Mason" }), "https://masonhainey.github.io/betting-proj/#bets");
  assert.ok(url.startsWith("https://masonhainey.github.io/betting-proj/#tail="));
  assert.ok(url.length < 900, `url is ${url.length} chars`);
});

test("garbage and hostile links are rejected or cleaned", () => {
  assert.equal(decodeShare("not-a-code"), null);
  assert.equal(decodeShare(""), null);
  assert.equal(decodeShare(toB64url(JSON.stringify({ v: 2, l: [] }))), null);
  assert.equal(decodeShare(toB64url(JSON.stringify({ v: 1, l: [{ p: "", o: 2 }] }))), null, "no usable legs");
  const evil = decodeShare(toB64url(JSON.stringify({
    v: 1, n: "x".repeat(500), b: 42, s: -5, o: "9",
    l: [
      { p: "<img src=x onerror=alert(1)>", o: 2, g: "123; drop", m: "spread", d: "home" }, // no line → not gradeable
      { p: "Fine", o: 0.5 }, // bad odds → dropped
      { p: "Also fine", o: 3, s: "hacked", k: "not a date", n: 1e9 },
    ],
  })));
  assert.equal(evil.from.length, 40);
  assert.equal(evil.book, "");
  assert.equal(evil.stake, undefined);
  assert.equal(evil.oddsOverride, undefined);
  assert.equal(evil.legs.length, 2);
  assert.equal(evil.legs[0].pick, "<img src=x onerror=alert(1)>", "kept as text; the UI escapes it");
  assert.equal(evil.legs[0].gameId, undefined);
  assert.equal(evil.legs[0].market, undefined, "spread without a line can't be auto-graded");
  assert.equal(evil.legs[1].status, "open");
  assert.equal(evil.legs[1].kickoff, undefined);
  assert.equal(evil.legs[1].line, undefined);
  const many = decodeShare(toB64url(JSON.stringify({ v: 1, l: Array.from({ length: 50 }, (_, i) => ({ p: `Leg ${i}`, o: 2 })) })));
  assert.equal(many.legs.length, 20);
});

test("base64url handles unicode", () => {
  assert.equal(fromB64url(toB64url("Señor 🦔 +150")), "Señor 🦔 +150");
});

test("share text", () => {
  const t = { kind: "bet", price: 5.96, legs: [{ pick: "A -3" }, { pick: "B ML" }] };
  assert.equal(shareText(t), "🦔 Tail my 2-leg parlay (+496): A -3 · B ML");
  assert.match(shareText(t, { status: "won", profit: 99.2 }), /^💰 Cashed my 2-leg parlay \(\+496\) for \+\$99\.20/);
  assert.match(shareText({ ...t, kind: "slip" }), /Thinking about this/);
});
