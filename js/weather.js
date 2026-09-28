// Weather at kickoff from Open-Meteo (free, no key, CORS-enabled): the stadium's city is
// looked up once and remembered, then the hourly forecast is read for the game window.

const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Conditions over the three hours from kickoff. Pure — unit-tested. */
export function weatherAt(f, iso) {
  const h = f?.hourly;
  if (!h?.time?.length) return null;
  const t0 = Date.parse(iso);
  const idx = h.time.map((t, i) => [Date.parse(t.endsWith("Z") ? t : `${t}Z`), i]).filter(([t]) => t >= t0 - 1800e3 && t < t0 + 3 * 3600e3).map(([, i]) => i);
  if (!idx.length) return null;
  const vals = (k) => idx.map((i) => Number(h[k]?.[i])).filter(Number.isFinite);
  const avg = (k) => { const v = vals(k); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const max = (k) => { const v = vals(k); return v.length ? Math.max(...v) : null; };
  return { wind: avg("wind_speed_10m"), gust: max("wind_gusts_10m"), temp: avg("temperature_2m"), pop: max("precipitation_probability"), precip: avg("precipitation"), indoor: false };
}

const mem = {};
const GEO = "lw.wx.geo";
const geoCache = () => { try { return JSON.parse(localStorage.getItem(GEO) || "{}"); } catch { return {}; } };

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Weather ${res.status}`);
  return res.json();
}

async function place(city, state) {
  const key = `${city}|${state}`;
  const c = geoCache();
  if (c[key]) return c[key];
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`);
  const want = STATES[state] || state;
  const r = (j.results || []).find((x) => x.admin1 === want) || (j.results || []).find((x) => x.country_code === "US") || j.results?.[0];
  if (!r) return null;
  c[key] = { lat: r.latitude, lon: r.longitude };
  try { localStorage.setItem(GEO, JSON.stringify(c)); } catch {}
  return c[key];
}

/** Weather for a game: { wind, gust, temp, pop, precip } at kickoff, { indoor: true }, or null. */
export async function fetchWeather(g) {
  if (g.indoor) return { indoor: true };
  if (!g.venueCity || !g.date) return null;
  const t = Date.parse(g.date);
  if (t - Date.now() > 15 * 864e5) return null; // beyond the forecast
  const k = `${g.id}|${g.date}`;
  if (mem[k] && Date.now() - mem[k].at < 3600e3) return mem[k].wx;
  const p = await place(g.venueCity, g.venueState);
  if (!p) return null;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const f = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=GMT&start_date=${day(t)}&end_date=${day(t + 4 * 3600e3)}`);
  const wx = weatherAt(f, g.date);
  mem[k] = { wx, at: Date.now() };
  return wx;
}
