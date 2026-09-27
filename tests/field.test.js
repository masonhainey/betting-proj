import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldState, parseSpot } from "../js/field.js";

const team = (id, abbr) => ({ id, abbr, short: abbr });
const game = (sit) => ({ id: "1", state: "in", home: team("12", "KC"), away: team("2", "BUF"), situation: { redZone: false, ...sit } });

test("spots parse the way ESPN writes them", () => {
  assert.deepEqual(parseSpot("KC 35"), { abbr: "KC", yd: 35 });
  assert.deepEqual(parseSpot("TA&M 4"), { abbr: "TA&M", yd: 4 });
  assert.deepEqual(parseSpot("50"), { abbr: null, yd: 50 });
  assert.equal(parseSpot("KC 75"), null);
  assert.equal(parseSpot(""), null);
});

test("away offense drives right, home offense drives left", () => {
  const a = fieldState(game({ possession: "2", spotText: "BUF 25", down: 1, distance: 10 }));
  assert.deepEqual([a.x, a.dir, a.firstDown, a.toGoal, a.label, a.offense.abbr], [25, 1, 35, 75, "1st & 10", "BUF"]);
  const h = fieldState(game({ possession: "12", spotText: "KC 25", down: 3, distance: 4 }));
  assert.deepEqual([h.x, h.dir, h.firstDown, h.toGoal, h.label], [75, -1, 71, 75, "3rd & 4"]);
  const across = fieldState(game({ possession: "12", spotText: "BUF 30", down: 2, distance: 7 }));
  assert.deepEqual([across.x, across.toGoal], [30, 30]);
});

test("goal to go, red zone and midfield", () => {
  const g = fieldState(game({ possession: "2", spotText: "KC 6", down: 1, distance: 6 }));
  assert.deepEqual([g.x, g.goal, g.firstDown, g.redZone, g.label], [94, true, null, true, "1st & Goal"]);
  assert.equal(fieldState(game({ possession: "2", spotText: "50", down: 1, distance: 10 })).x, 50);
});

test("falls back to yards-to-endzone; nothing to draw without a ball", () => {
  assert.equal(fieldState(game({ possession: "12", spotText: "", toEndzone: 40 })).x, 40);
  assert.equal(fieldState(game({ possession: "2", spotText: "", toEndzone: 40 })).x, 60);
  assert.equal(fieldState(game({ possession: null, spotText: "KC 20" })), null);
  assert.equal(fieldState(game({ possession: "2", spotText: "" })), null);
  assert.equal(fieldState({ ...game({ possession: "2", spotText: "BUF 20" }), state: "post" }), null);
});

test("between plays, the team on the last play stands in for possession", () => {
  const f = fieldState(game({ possession: null, lastPlayTeam: "12", spotText: "KC 40", down: 1, distance: 10 }));
  assert.deepEqual([f.offense.abbr, f.x, f.dir], ["KC", 60, -1]);
});
