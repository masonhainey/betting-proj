// Builds the model files the app loads (data/model-cfb.json, data/model-nfl.json).
// Runs in GitHub Actions every few hours (.github/workflows/model-data.yml), because
// browsers can't reliably pull two seasons of past scoreboards from ESPN.
//
// Past results are cached per season in data/games-<sport>-<year>.json, so each run only
// fetches the last couple of weeks (scores and closing lines settle) plus anything missing.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeEvent, scoreboardUrl, ymd } from "../js/espn.js";
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
  if (c.complete) return c.games;
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
      for (const g of gs) if (finished(g)) byId.set(g.id, compact(g));
      if (!recent) done.add(key);
    } catch (e) {
      failed++;
      console.warn(`${sport} ${year} week of ${key}: ${e.message}`);
    }
  }
  const games = [...byId.values()].sort((a, b) => Date.parse(a.d) - Date.parse(b.d));
  const complete = now > end.getTime() + 7 * DAY && !failed;
  await writeFile(new URL(file, DIR), JSON.stringify({ sport, year, complete, done: [...done].sort(), games }));
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
