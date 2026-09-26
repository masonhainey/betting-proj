// Friends leaderboard: groups, members, and each member's published stats.
// Talks to the tables/functions in supabase/friends.sql.

import * as cloud from "./cloud.js";
import { computeStats, publishPicks } from "./leaderboard.js";
import { hashOf } from "./sync.js";
import { load, save } from "./store.js";
import { S, hooks, settings } from "./state.js";

export const fr = {
  groups: [], // [{ id, name, code, createdBy, myName }]
  active: load("fr.active", null),
  members: [], // members of the active group
  stats: {}, // user_id → { stats, picks, updated_at }
  period: load("fr.period", "week"),
  sort: "units",
  loading: false,
  loaded: false,
  error: "",
  at: 0,
};

let listeners = [];
export const onFriendsChange = (fn) => listeners.push(fn);
const changed = () => listeners.forEach((fn) => fn());

const uid = () => cloud.currentUser()?.id;

export function myDisplayName() {
  const g = fr.groups.find((x) => x.id === fr.active) || fr.groups[0];
  return g?.myName || settings.shareName || (cloud.currentUser()?.email || "").split("@")[0] || "Me";
}

export async function refreshFriends({ quiet = false } = {}) {
  const me = uid();
  if (!me || !cloud.configured || settings.demo) return;
  fr.loading = true;
  if (!quiet) changed();
  try {
    const rows = await cloud.api.get(`group_members?select=group_id,display_name,joined_at,groups(id,name,invite_code,created_by)&user_id=eq.${me}&order=joined_at.asc`);
    fr.groups = rows.filter((r) => r.groups).map((r) => ({ id: r.group_id, name: r.groups.name, code: r.groups.invite_code, createdBy: r.groups.created_by, myName: r.display_name }));
    save("fr.inGroups", fr.groups.length > 0);
    if (!fr.groups.some((g) => g.id === fr.active)) fr.active = fr.groups[0]?.id || null;
    save("fr.active", fr.active);
    if (fr.active) await loadBoard(fr.active);
    else {
      fr.members = [];
      fr.stats = {};
    }
    fr.error = "";
    fr.at = Date.now();
    fr.loaded = true;
    publishSoon(0);
  } catch (e) {
    fr.error = e.signedOut ? "" : e.message;
  }
  fr.loading = false;
  changed();
}

async function loadBoard(gid) {
  const members = await cloud.api.get(`group_members?select=user_id,display_name,joined_at&group_id=eq.${gid}&order=joined_at.asc`);
  const ids = members.map((m) => m.user_id);
  const stats = ids.length ? await cloud.api.get(`member_stats?select=user_id,stats,picks,updated_at&user_id=in.(${ids.join(",")})`) : [];
  fr.members = members;
  fr.stats = Object.fromEntries(stats.map((s) => [s.user_id, s]));
}

export async function selectGroup(gid) {
  fr.active = gid;
  save("fr.active", gid);
  fr.members = [];
  changed();
  try {
    await loadBoard(gid);
  } catch (e) {
    fr.error = e.message;
  }
  changed();
}

/** Publish my summary for my groups (skipped when nothing changed, re-sent at least every 6h). */
export async function publish() {
  const me = uid();
  if (!me || settings.demo || !load("fr.inGroups", false)) return;
  const stats = computeStats(S.bets, { unit: settings.unit });
  const picks = settings.sharePicks === false ? { open: [], recent: [] } : publishPicks(S.bets, { name: myDisplayName() });
  const h = hashOf({ me, p: stats.periods, s: stats.streak, o: stats.open, picks });
  const last = load("fr.pub", null);
  if (last?.h === h && Date.now() - last.at < 6 * 3600e3) return;
  await cloud.api.upsert("member_stats", [{ user_id: me, stats, picks, updated_at: new Date().toISOString() }], "user_id");
  save("fr.pub", { h, at: Date.now() });
  if (fr.stats[me] || fr.members.some((m) => m.user_id === me)) {
    fr.stats[me] = { user_id: me, stats, picks, updated_at: new Date().toISOString() };
    changed();
  }
}

let pubTimer = null;
export function publishSoon(ms = 4000) {
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => publish().catch(() => {}), ms);
}
hooks.afterSync = () => publishSoon();

export async function createGroup(name, display) {
  const g = await cloud.api.rpc("create_group", { p_name: name.trim(), p_display: display.trim() });
  fr.active = g.id;
  save("fr.active", g.id);
  save("fr.inGroups", true);
  save("fr.pub", null); // make sure our stats go up right away
  await refreshFriends();
  return g;
}

export async function joinGroup(code, display) {
  const g = await cloud.api.rpc("join_group", { p_code: code.trim().toUpperCase(), p_display: display.trim() });
  fr.active = g.id;
  save("fr.active", g.id);
  save("fr.inGroups", true);
  save("fr.pub", null);
  await refreshFriends();
  return g;
}

export async function renameMe(gid, display) {
  await cloud.api.patch(`group_members?group_id=eq.${gid}&user_id=eq.${uid()}`, { display_name: display.trim() });
  await refreshFriends({ quiet: true });
}

export async function leaveGroup(gid) {
  await cloud.api.del(`group_members?group_id=eq.${gid}&user_id=eq.${uid()}`);
  if (fr.active === gid) fr.active = null;
  await refreshFriends();
}

export const inviteLink = (code) => `${location.origin}${location.pathname}#join=${code}`;
