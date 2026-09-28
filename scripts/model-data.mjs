// Builds the model files the app loads (data/model-cfb.json, data/model-nfl.json).
// Runs in GitHub Actions every few hours (.github/workflows/model-data.yml), because
// browsers can't reliably pull two seasons of past scoreboards from ESPN.
//
// Past results are cached per season in data/games-<sport>-<year>.json, so each run only
// fetches the last couple of weeks (scores and closing lines settle) plus anything missing.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeEvent, normalizeOdds, scoreboardUrl, sportOf, ymd } from "../js/espn.js";
import { buildModelData, compact, finished, seasonWindow, seasonYear } from "../js/model/build.js";

const DIR = new URL("../data/", import.meta.url);
const DAY = 864e5, WEEK = 7 * DAY;
const only = process.argv[2]; // optional: "cfb" or "nfl"

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "hedgehog-model/1" } });
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

const utc = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const ymdUTC = (d) => ymd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function fetchWeek(sport, from, to) {
  const events = async (dates) => ((await getJSON(scoreboardUrl(dates, sport))).events || []).map((e) => normalizeEvent(e, sport)).filter(Boolean);
  try {
    return await events(`${ymdUTC(from)}-${ymdUTC(to)}`);
  } catch {
    const out = [];
    for (let d = from; d <= to; d = new Date(d.getTime() + DAY)) out.push(...(await events(ymdUTC(d))));
    return out;
  }
}

/**
 * ESPN drops odds from the scoreboard once a game is final, but the game summary keeps the
 * book's last line (pickcenter). Backfill closing lines for games that don't have one yet;
 * games with no line at all are marked so they aren't asked for again.
 */
async function backfillLines(sport, games, max = 2500) {
  const todo = games.filter((g) => g.sp == null && g.tot == null && !g.nl).slice(0, max);
  let got = 0;
  const q = [...todo];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const g = q.shift();
      try {
        const s = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/${sportOf(sport).path}/summary?event=${g.id}`, 2);
        const comps = s?.header?.competitions?.[0]?.competitors || [];
        const side = (h) => ({ abbr: comps.find((c) => c.homeAway === h)?.team?.abbreviation || "" });
        const pc = (s.pickcenter || []).find((o) => o.spread != null || o.overUnder != null || o.details) || s.odds?.[0];
        const o = normalizeOdds(pc, side("home"), side("away"));
        if (o?.spread?.home?.line != null) g.sp = o.spread.home.line;
        if (o?.total?.line != null) g.tot = o.total.line;
        if (g.sp == null && g.tot == null) g.nl = 1;
        else got++;
      } catch {
        // try again next run
      }
    }
  }));
  if (todo.length) console.log(`${sport}: closing lines for ${got} of ${todo.length} games`);
  return got;
}

async function readCache(file) {
  try {
    return JSON.parse(await readFile(new URL(file, DIR), "utf8"));
  } catch {
    return null;
  }
}

/** One season's finished games, topped up from ESPN. */
async function season(sport, year, now) {
  const file = `games-${sport}-${year}.json`;
  const c = (await readCache(file)) || { done: [], games: [] };
  c.lines ||= {};
  if (c.complete) {
    if (await backfillLines(sport, c.games)) await writeFile(new URL(file, DIR), JSON.stringify(c));
    return c.games;
  }
  const { start, end } = seasonWindow(sport, year);
  const last = Math.min(end.getTime(), now);
  const byId = new Map(c.games.map((g) => [g.id, g]));
  const done = new Set(c.done);
  let failed = 0;
  for (let t = utc(start).getTime(); t <= last; t += WEEK) {
    const key = ymdUTC(new Date(t));
    const recent = t + WEEK > now - 10 * DAY;
    if (done.has(key) && !recent) continue;
    try {
      const gs = await fetchWeek(sport, new Date(t), new Date(Math.min(t + 6 * DAY, last)));
      for (const g of gs) {
        // Remember the latest line while a game is upcoming: it becomes the closing line.
        if (g.state === "pre" && g.odds) c.lines[g.id] = { sp: g.odds.spread?.home?.line ?? null, tot: g.odds.total?.line ?? null };
        if (!finished(g)) continue;
        const cg = compact(g);
        const old = byId.get(g.id);
        const L = c.lines[g.id];
        cg.sp ??= L?.sp ?? old?.sp ?? undefined;
        cg.tot ??= L?.tot ?? old?.tot ?? undefined;
        if (cg.sp == null) delete cg.sp;
        if (cg.tot == null) delete cg.tot;
        if (old?.nl && cg.sp == null && cg.tot == null) cg.nl = 1;
        byId.set(g.id, cg);
      }
      if (!recent) done.add(key);
    } catch (e) {
      failed++;
      console.warn(`${sport} ${year} week of ${key}: ${e.message}`);
    }
  }
  if (now < end.getTime()) {
    // Next week's games: save their lines now, while ESPN still shows them.
    try {
      for (const g of await fetchWeek(sport, utc(new Date(now)), utc(new Date(now + 7 * DAY)))) {
        if (g.state === "pre" && g.odds) c.lines[g.id] = { sp: g.odds.spread?.home?.line ?? null, tot: g.odds.total?.line ?? null };
      }
    } catch (e) {
      console.warn(`${sport}: upcoming lines: ${e.message}`);
    }
  }
  const games = [...byId.values()].sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
  await backfillLines(sport, games);
  const complete = now > end.getTime() + 7 * DAY && !failed;
  const ids = new Set(games.map((g) => g.id));
  const lines = Object.fromEntries(Object.entries(c.lines).filter(([id]) => !ids.has(id)));
  await writeFile(new URL(file, DIR), JSON.stringify({ sport, year, complete, done: [...done].sort(), games, lines }));
  console.log(`${sport} ${year}: ${games.length} games${failed ? `, ${failed} weeks failed` : ""}`);
  return games;
}

await mkdir(DIR, { recursive: true });
const now = Date.now();
const year = seasonYear(new Date(now));
for (const sport of only ? [only] : ["cfb", "nfl"]) {
  const prev = await season(sport, year - 1, now);
  const cur = await season(sport, year, now);
  if (!prev.length && !cur.length) {
    console.error(`${sport}: no games from ESPN, keeping the old model file`);
    process.exitCode = 1;
    continue;
  }
  const data = buildModelData(sport, { cur, prev, season: year, now });
  await writeFile(new URL(`model-${sport}.json`, DIR), JSON.stringify(data));
  const a = data.cards.all;
  console.log(`${sport} model: ${cur.length} + ${prev.length} games · ATS strong ${a?.atsStrong?.w}-${a?.atsStrong?.l} · weight ${data.weight}`);
}
