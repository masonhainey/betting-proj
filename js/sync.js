// Local-first sync. Bets always live in localStorage; this module works out what changed
// since the last sync, pushes it, pulls what other devices changed, and merges.
//
// Conflict rule: last write wins, per bet, by each bet's `updatedAt`. Deletes are
// tombstones so a bet deleted on the phone doesn't come back from the laptop. The server
// enforces the same rule (see supabase/schema.sql), so a slow device can't clobber a
// newer edit.
//
// `remote` is anything with { upsert(rows), pullSince(isoOrNull) } — Supabase in the app,
// an in-memory fake in tests.

const SETTINGS_ID = "settings";
export const SYNCED_SETTINGS = ["oddsFormat", "unit", "lastBook"];

export const emptyMeta = (userId) => ({ userId, lastPull: null, hashes: {}, dirty: {}, tombs: {}, settingsHash: null, settingsAt: null });

/** Stable content hash that ignores the sync timestamp itself. */
export function hashOf(obj) {
  const s = JSON.stringify(obj, (k, v) => (k === "updatedAt" ? undefined : v));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

const t = (iso) => (iso ? Date.parse(iso) : 0);

export function pickSettings(settings) {
  return Object.fromEntries(SYNCED_SETTINGS.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]]));
}

/**
 * Compare the current bets with what we last synced. Changed bets get a fresh
 * `updatedAt` and are marked dirty; missing ones become tombstones. Mutates both.
 */
export function noteLocalChanges(bets, meta, settings, now = new Date().toISOString()) {
  const seen = new Set();
  for (const b of bets) {
    seen.add(b.id);
    const h = hashOf(b);
    if (meta.hashes[b.id] !== h) {
      b.updatedAt = now;
      meta.hashes[b.id] = h;
      meta.dirty[b.id] = true;
      delete meta.tombs[b.id];
    }
  }
  for (const id of Object.keys(meta.hashes)) {
    if (!seen.has(id)) {
      delete meta.hashes[id];
      delete meta.dirty[id];
      meta.tombs[id] = now;
    }
  }
  if (settings) {
    const sh = hashOf(pickSettings(settings));
    if (meta.settingsHash !== sh) {
      meta.settingsHash = sh;
      meta.settingsAt = now;
      meta.settingsDirty = true;
    }
  }
}

/** Rows to send: dirty bets, tombstones, and settings if they changed. */
export function pendingRows(bets, meta, userId, settings) {
  const rows = [];
  for (const b of bets) {
    if (!meta.dirty[b.id]) continue;
    const { updatedAt, ...data } = b;
    rows.push({ user_id: userId, id: b.id, kind: "bet", data, deleted: false, updated_at: updatedAt });
  }
  for (const [id, at] of Object.entries(meta.tombs)) rows.push({ user_id: userId, id, kind: "bet", data: null, deleted: true, updated_at: at });
  if (meta.settingsDirty && settings) {
    rows.push({ user_id: userId, id: SETTINGS_ID, kind: "settings", data: pickSettings(settings), deleted: false, updated_at: meta.settingsAt });
  }
  return rows;
}

/** Merge rows pulled from the server. Returns the new bet list and anything that changed. */
export function applyRemote(bets, rows, meta) {
  const byId = new Map(bets.map((b) => [b.id, b]));
  let added = 0, updated = 0, removed = 0;
  let settings = null;
  for (const r of rows) {
    if (r.kind === "settings") {
      if (t(r.updated_at) > t(meta.settingsAt) && r.data) {
        settings = r.data;
        meta.settingsAt = r.updated_at;
        meta.settingsHash = hashOf(r.data);
        meta.settingsDirty = false;
      }
      continue;
    }
    const local = byId.get(r.id);
    const localAt = local?.updatedAt || meta.tombs[r.id] || null;
    // Ours is newer (or the same edit) → keep it. On an exact tie a delete wins, so a
    // deleted bet can never come back.
    if (localAt && (r.deleted ? t(r.updated_at) < t(localAt) : t(r.updated_at) <= t(localAt))) continue;
    if (r.deleted) {
      if (local) {
        byId.delete(r.id);
        removed++;
      }
      delete meta.hashes[r.id];
      delete meta.dirty[r.id];
      delete meta.tombs[r.id];
    } else if (r.data) {
      const b = { ...r.data, id: r.id, updatedAt: r.updated_at };
      byId.set(r.id, b);
      meta.hashes[r.id] = hashOf(b);
      delete meta.dirty[r.id];
      delete meta.tombs[r.id];
      local ? updated++ : added++;
    }
  }
  const merged = [...byId.values()].sort((a, b) => t(b.createdAt) - t(a.createdAt));
  return { bets: merged, added, updated, removed, settings };
}

/**
 * One full round: push local changes, then pull everything newer than the last pull.
 * `getBets()` is read again after the push so edits made mid-sync aren't lost.
 */
export async function syncOnce({ getBets, remote, meta, userId, settings }) {
  const bets0 = getBets();
  noteLocalChanges(bets0, meta, settings);
  const rows = pendingRows(bets0, meta, userId, settings);
  if (rows.length) {
    await remote.upsert(rows);
    const now = new Map(getBets().map((b) => [b.id, b.updatedAt]));
    for (const r of rows) {
      if (r.kind === "settings") {
        if (meta.settingsAt === r.updated_at) meta.settingsDirty = false;
      } else if (r.deleted) {
        if (meta.tombs[r.id] === r.updated_at) delete meta.tombs[r.id];
      } else if (now.get(r.id) === r.updated_at) delete meta.dirty[r.id];
    }
  }
  // Overlap the window a little: rows committed out of order still get picked up, and
  // merging is idempotent.
  const since = meta.lastPull ? new Date(t(meta.lastPull) - 60000).toISOString() : null;
  const pulled = await remote.pullSince(since);
  const res = applyRemote(getBets(), pulled, meta);
  for (const r of pulled) if (t(r.synced_at) > t(meta.lastPull)) meta.lastPull = r.synced_at;
  return { ...res, pushed: rows.length, pulled: pulled.length };
}
