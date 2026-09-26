// Friends tab: private groups with a leaderboard, and friends' open picks to tail.

import * as cloud from "../cloud.js";
import { esc, ago, icons } from "../ui.js";
import { formatOdds, fmtPct } from "../odds.js";
import { sanitizeShare } from "../share.js";
import { ticketDecimal } from "../grade.js";
import { PERIODS, rankRows, computeStats, publishPicks } from "../leaderboard.js";
import { fr, onFriendsChange, refreshFriends, selectGroup, createGroup, joinGroup, renameMe, leaveGroup, inviteLink, myDisplayName, publishSoon } from "../friends.js";
import { closeBtn, openSheet, render, chip, skeleton } from "../render.js";
import { boardGames, markets, slipLegFromSel } from "../market.js";
import { S, fmt, settings, saveSettings, toast } from "../state.js";

// ───────── data plumbing ─────────

onFriendsChange(() => {
  if (S.tab === "friends" || ["member", "group"].includes(S.sheet?.kind)) render();
});

cloud.onAuthChange((user) => {
  if (user) {
    refreshFriends();
    if (fr.pendingJoin) openSheet({ kind: "join" });
  } else Object.assign(fr, { groups: [], members: [], stats: {}, loaded: false });
});

setInterval(() => {
  if (S.tab === "friends" && !document.hidden) refreshFriends({ quiet: true });
}, 60000);

export function onFriendsTab() {
  if (settings.demo || !cloud.currentUser()) return;
  if (!fr.loaded || Date.now() - fr.at > 20000) refreshFriends({ quiet: fr.loaded });
}

/** Opens the join flow if the page was opened from an invite link. */
export function handleJoinLink() {
  const m = location.hash.match(/^#join=([A-Za-z0-9]{4,12})/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search + "#friends");
  fr.pendingJoin = m[1].toUpperCase();
  S.tab = "friends";
  if (cloud.currentUser() || settings.demo) openSheet({ kind: "join" });
  else {
    openSheet({ kind: "settings" });
    toast(`Sign in (or create an account) to join group ${fr.pendingJoin}`);
  }
  return true;
}

// ───────── demo mode: a pretend group so the feature can be explored ─────────

const DEMO_FRIENDS = [["Jake", 7.4, "W3", 14, 9], ["Priya", 3.1, "L1", 11, 8], ["Marcus", -2.6, "L4", 9, 13], ["Tess", 12.8, "W5", 17, 6], ["Dom", 0.4, "W1", 6, 6]];

function demoBoard() {
  const me = "demo-me";
  const games = boardGames();
  const pickFor = (i) => {
    const g = games[(i * 3) % Math.max(1, games.length)];
    const m = g && markets(g);
    const sels = m ? Object.values(m).filter(Boolean) : [];
    if (!sels.length) return [];
    const legs = [sels[i % sels.length], ...(i % 2 ? [] : [Object.values(markets(games[(i * 3 + 1) % games.length]) || {}).filter(Boolean)[1]])].filter(Boolean).map(slipLegFromSel);
    return [{ id: `demo-pick-${i}`, createdAt: new Date().toISOString(), stake: 10, legs }];
  };
  const members = [{ user_id: me, display_name: settings.shareName || "You" }, ...DEMO_FRIENDS.map(([n], i) => ({ user_id: `demo-${i}`, display_name: n }))];
  const stats = { [me]: { stats: computeStats(S.bets, { unit: settings.unit }), picks: publishPicks(S.bets, { name: "You" }) } };
  DEMO_FRIENDS.forEach(([name, units, streak, w, l], i) => {
    const mk = (f) => ({ w: Math.round(w * f), l: Math.round(l * f), p: 0, n: Math.round((w + l) * f), units: Math.round(units * f * 10) / 10, roi: Math.round((units / ((w + l) * 1.1)) * 1000) / 1000 });
    stats[`demo-${i}`] = {
      stats: { periods: { week: mk(0.3), month: mk(0.7), season: mk(1) }, streak, open: 1 },
      picks: { open: pickFor(i).map((b) => ({ v: 1, k: "bet", i: b.id, n: name, t: b.createdAt, l: b.legs.map((l) => ({ p: l.pick, o: l.odds, g: l.gameId, m: l.market, d: l.side, n: l.line, gl: l.gameLabel, k: l.kickoff })) })), recent: [] },
      updated_at: new Date(Date.now() - (i + 1) * 17 * 60000).toISOString(),
    };
  });
  return { groups: [{ id: "demo", name: "Saturday Degens", code: "DEMO42", myName: settings.shareName || "You" }], members, stats, me };
}

function board() {
  if (settings.demo) return demoBoard();
  return { groups: fr.groups, members: fr.members, stats: fr.stats, me: cloud.currentUser()?.id };
}

// ───────── rendering ─────────

// FNV-1a so similar ids ("demo-1", "demo-2") still get clearly different colors.
const hue = (s) => ([...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) * 137) % 360;
const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const avatar = (m, size = 38) => `<span class="avatar" style="--h:${hue(m.user_id)};--sz:${size}px">${esc(initials(m.display_name))}</span>`;
const units = (u) => (u == null ? "—" : `${u > 0 ? "+" : ""}${u.toFixed(1)}u`);
const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : r ? `${r}` : "–");
function streakChip(s) {
  const m = /^([WL])(\d+)$/.exec(s || "");
  if (!m || Number(m[2]) < 2) return "";
  return `<span class="streak ${m[1] === "W" ? "hot" : "cold"}">${m[1] === "W" ? "🔥" : "🧊"}${esc(s)}</span>`;
}

export function viewFriends() {
  const head = `<div class="view-h"><div><div class="eyebrow">Friends</div><h1>Leaderboard</h1><p class="muted">Private groups. Records and units only; stakes are never shared.</p></div>
    ${cloud.currentUser() && !settings.demo ? `<button class="icon-btn" data-act="fr-refresh" aria-label="Refresh">${icons.refresh}</button>` : ""}</div>`;
  if (!settings.demo && !cloud.configured) return head + `<div class="empty">Accounts aren't set up on this site, so there's nothing to share with yet.</div>`;
  if (!settings.demo && !cloud.currentUser()) {
    return head + `<section class="fr-pitch card">
      <div class="fr-pitch-art">🥇🥈🥉</div>
      <h2>See who's actually good</h2>
      <p class="muted">Start a group, send friends an invite link, and hedgehog keeps a live leaderboard (this week, this month, the season) in units, so a $5 bettor and a $50 bettor compete fairly. You can also see and tail each other's open picks.</p>
      <button class="btn primary" data-act="open-settings">Sign in to get started</button>
    </section>`;
  }
  const bd = board();
  if (!settings.demo && !fr.loaded) return head + (fr.error ? errorNote() : skeleton(4, "row"));
  if (!bd.groups.length) return head + (fr.error ? errorNote() : noGroups());
  const g = bd.groups.find((x) => x.id === (settings.demo ? "demo" : fr.active)) || bd.groups[0];
  const rows = rankRows(bd.members, Object.fromEntries(Object.entries(bd.stats).map(([k, v]) => [k, v.stats])), fr.period, fr.sort);
  const groupsBar = `<div class="chips scroll fr-groups">${bd.groups.map((x) => chip(esc(x.name), "fr-group", x.id, x.id === g.id)).join("")}<button class="chip" data-act="fr-new">＋ New / join</button></div>`;
  const controls = `<div class="fr-controls">
    <div class="seg sm">${Object.entries(PERIODS).map(([k, v]) => `<button class="${fr.period === k ? "on" : ""}" data-act="fr-period" data-v="${k}">${v}</button>`).join("")}</div>
    <div class="seg sm">${[["units", "Units"], ["roi", "ROI"], ["record", "Record"]].map(([k, v]) => `<button class="${fr.sort === k ? "on" : ""}" data-act="fr-sort" data-v="${k}">${v}</button>`).join("")}</div>
  </div>`;
  const list = rows.map((r) => {
    const s = r.s;
    const me = r.user_id === bd.me;
    return `<button class="lb-row ${me ? "me" : ""} ${r.rank && r.rank <= 3 ? "top" : ""}" data-act="open-member" data-id="${esc(r.user_id)}">
      <span class="lb-rank">${medal(r.rank)}</span>
      ${avatar(r)}
      <span class="lb-main"><b>${esc(r.display_name)}${me ? ` <em>you</em>` : ""}</b>
        <small>${s && s.n ? `${s.w}-${s.l}${s.p ? `-${s.p}` : ""} · ROI ${fmtPct(s.roi)}` : "No settled bets yet"}${r.open ? ` · ${r.open} open` : ""}</small></span>
      ${streakChip(r.streak)}
      <span class="lb-units ${s?.units > 0 ? "pos" : s?.units < 0 ? "neg" : ""}">${s && s.n ? units(s.units) : ""}</span>
    </button>`;
  }).join("");
  const feed = picksFeed(bd);
  return `${head}${groupsBar}
    <section class="card fr-board">
      <div class="fr-board-h"><div><h2>${esc(g.name)}</h2><p class="muted small">${bd.members.length} member${bd.members.length === 1 ? "" : "s"}${settings.demo ? " · demo group" : fr.at ? ` · updated <span data-ago="${fr.at}">${ago(fr.at)}</span>` : ""}</p></div>
        <button class="btn sm primary" data-act="fr-invite">${icons.plus} Invite</button>
        <button class="icon-btn" data-act="fr-settings" aria-label="Group settings">${icons.gear}</button></div>
      ${controls}
      <div class="lb">${list || `<p class="muted">No members yet.</p>`}</div>
      ${bd.members.length < 2 ? `<p class="muted small fr-lonely">It's just you so far. Tap <b>Invite</b> and send the link to your group chat.</p>` : ""}
    </section>
    ${feed}`;
}

function picksFeed(bd) {
  const items = [];
  for (const m of bd.members) {
    if (m.user_id === bd.me) continue;
    const open = bd.stats[m.user_id]?.picks?.open || [];
    open.forEach((raw, i) => {
      const t = sanitizeShare(raw);
      if (t) items.push({ m, t, i });
    });
  }
  if (!items.length) return "";
  items.sort((a, b) => Date.parse(b.t.createdAt || 0) - Date.parse(a.t.createdAt || 0));
  return `<section class="fr-feed"><div class="sec-h"><h2>Open picks from the group</h2><span class="muted">${items.length}</span></div>
    ${items.slice(0, 20).map(({ m, t, i }) => {
      const tailed = t.src && S.bets.some((b) => b.tail?.src === t.src);
      return `<div class="fp">
        ${avatar(m, 32)}
        <div class="fp-main"><b>${esc(m.display_name)}</b> <span class="muted">· ${t.legs.length > 1 ? `${t.legs.length}-leg parlay` : "straight"}</span>
          <div class="fp-legs">${t.legs.map((l) => esc(l.pick)).join(" · ")}</div></div>
        <span class="fp-odds">${formatOdds(ticketDecimal({ legs: t.legs, oddsOverride: t.oddsOverride, boostPct: t.boostPct }), fmt())}</span>
        <button class="btn sm ${tailed ? "" : "primary"}" data-act="fr-tail" data-u="${esc(m.user_id)}" data-i="${i}">${tailed ? "Tailed" : "Tail"}</button>
      </div>`;
    }).join("")}</section>`;
}

function noGroups() {
  const name = esc(myDisplayName());
  return `<div class="fr-start">
    <section class="card fr-start-card"><h2>Start a group</h2><p class="muted small">You'll get an invite link to drop in your group chat.</p>
      <label class="field"><span>Group name</span><input data-f="new-name" maxlength="40" placeholder="e.g. Saturday Degens"></label>
      <label class="field"><span>Your name in the group</span><input data-f="new-me" maxlength="30" value="${name}"></label>
      <button class="btn primary block" data-act="fr-create">Create group</button></section>
    <section class="card fr-start-card"><h2>Join a group</h2><p class="muted small">Got an invite code from a friend?</p>
      <label class="field"><span>Invite code</span><input data-f="join-code" maxlength="12" placeholder="ABC123" autocapitalize="characters" autocomplete="off" spellcheck="false" class="code-in"></label>
      <label class="field"><span>Your name in the group</span><input data-f="join-me" maxlength="30" value="${name}"></label>
      <button class="btn block" data-act="fr-join">Join group</button></section>
  </div>`;
}

function errorNote() {
  return `<div class="errbox"><h3>Couldn't load your groups</h3><p class="muted">${esc(fr.error)}</p><button class="btn sm" data-act="fr-refresh">${icons.refresh} Try again</button></div>`;
}

// ───────── sheets ─────────

export function sheetMember() {
  const bd = board();
  const m = bd.members.find((x) => x.user_id === S.sheet.id);
  if (!m) return `<div class="sheet-h"><h2>Member</h2>${closeBtn()}</div>`;
  const st = bd.stats[m.user_id]?.stats;
  const picks = bd.stats[m.user_id]?.picks || {};
  const me = m.user_id === bd.me;
  const rowsFor = (k) => {
    const s = st?.periods?.[k];
    return `<tr><td>${PERIODS[k]}</td><td>${s && s.n ? `${s.w}-${s.l}${s.p ? `-${s.p}` : ""}` : "—"}</td><td class="${s?.units > 0 ? "pos" : s?.units < 0 ? "neg" : ""}">${s && s.n ? units(s.units) : "—"}</td><td>${s && s.n ? fmtPct(s.roi) : "—"}</td></tr>`;
  };
  const pickRow = (raw, i, kind) => {
    const t = sanitizeShare(raw);
    if (!t) return "";
    const status = kind === "recent" ? (t.legs.some((l) => l.status === "lost") ? "lost" : t.legs.every((l) => ["won", "push", "void"].includes(l.status)) ? "won" : "open") : "open";
    return `<div class="fp ${status}"><div class="fp-main"><b>${t.legs.length > 1 ? `${t.legs.length}-leg parlay` : "Straight"}</b> <span class="muted">· ${formatOdds(ticketDecimal({ legs: t.legs, oddsOverride: t.oddsOverride, boostPct: t.boostPct }), fmt())}</span>
      <div class="fp-legs">${t.legs.map((l) => esc(l.pick)).join(" · ")}</div></div>
      ${kind === "open" && !me ? `<button class="btn sm primary" data-act="fr-tail" data-u="${esc(m.user_id)}" data-i="${i}">Tail</button>` : kind === "recent" ? `<span class="pill ${status}">${status === "won" ? "Won" : status === "lost" ? "Lost" : "Push"}</span>` : ""}</div>`;
  };
  return `<div class="sheet-h"><h2>${esc(m.display_name)}${me ? " (you)" : ""}</h2>${closeBtn()}</div>
    <div class="mem-top">${avatar(m, 56)}<div><b>${esc(m.display_name)}</b><p class="muted small">${st ? `Streak ${esc(st.streak || "—")} · ${st.open || 0} open` : "Hasn't published stats yet"}</p></div>${streakChip(st?.streak)}</div>
    <div class="card ins"><table><thead><tr><th></th><th>Record</th><th>Units</th><th>ROI</th></tr></thead><tbody>${Object.keys(PERIODS).map(rowsFor).join("")}</tbody></table></div>
    <h3 class="sh3">Open picks</h3>
    ${(picks.open || []).length ? (picks.open || []).map((p, i) => pickRow(p, i, "open")).join("") : `<p class="muted small">${me && settings.sharePicks === false ? "You've turned off sharing your picks." : "Nothing open right now."}</p>`}
    ${(picks.recent || []).length ? `<h3 class="sh3">Recent results</h3>${picks.recent.map((p, i) => pickRow(p, i, "recent")).join("")}` : ""}`;
}

export function sheetGroup() {
  const bd = board();
  const g = bd.groups.find((x) => x.id === (settings.demo ? "demo" : fr.active)) || bd.groups[0];
  if (!g) return `<div class="sheet-h"><h2>Group</h2>${closeBtn()}</div>`;
  return `<div class="sheet-h"><h2>${esc(g.name)}</h2>${closeBtn()}</div>
    <div class="invite-box"><span class="muted small">Invite code</span><b class="invite-code">${esc(g.code)}</b>
      <div class="dactions"><button class="btn sm primary" data-act="fr-invite">${icons.ext} Share invite link</button><button class="btn sm" data-act="fr-copy-code" data-v="${esc(g.code)}">Copy code</button></div></div>
    <label class="field"><span>Your name in this group</span><div class="acct-row"><input data-f="rename" class="acct-in" maxlength="30" value="${esc(g.myName || "")}"><button class="btn" data-act="fr-rename">Save</button></div></label>
    <div class="set-row"><div><b>Show my open picks</b><p class="muted small">Groupmates can see and tail your open bets (never your stakes). Your record and units always show on the leaderboard.</p></div>
      <label class="switch ${settings.sharePicks === false ? "" : "on"}"><input type="checkbox" data-act="fr-picks" ${settings.sharePicks === false ? "" : "checked"}><span class="knob"></span></label></div>
    <p class="muted small fr-honor">Each member's app reports its own numbers. It's an honor system among friends.</p>
    <div class="dactions"><span class="grow"></span><button class="btn sm danger" data-act="fr-leave">${S.confirmDelete === "leave" ? "Tap again to leave" : "Leave group"}</button></div>`;
}

export function sheetGroupNew() {
  return `<div class="sheet-h"><h2>New group or join</h2>${closeBtn()}</div>${noGroups()}`;
}

export function sheetJoin() {
  const code = fr.pendingJoin || "";
  return `<div class="sheet-h"><h2>You're invited</h2>${closeBtn()}</div>
    <div class="invite-box"><span class="muted small">Group code</span><b class="invite-code">${esc(code)}</b></div>
    <p class="muted">Join to see the leaderboard and your friends' open picks. They'll see your record and units (never your stakes).</p>
    <label class="field"><span>Your name in the group</span><input data-f="join-me" maxlength="30" value="${esc(myDisplayName())}"></label>
    <input data-f="join-code" type="hidden" value="${esc(code)}">
    <button class="btn primary block" data-act="fr-join">Join group</button>`;
}

// ───────── actions ─────────

/** Read an input from the same card/sheet as the button (the tab and a sheet can both show a form). */
const field = (el, name) => (el.closest(".fr-start-card, .panel-body, .fr-board") || document).querySelector(`[data-f="${name}"]`);

async function busy(el, fn) {
  const label = el?.textContent;
  if (el) {
    el.disabled = true;
    el.textContent = "Working…";
  }
  try {
    await fn();
  } catch (e) {
    toast(e.message || "Something went wrong", "err");
  } finally {
    if (el && document.body.contains(el)) {
      el.disabled = false;
      el.textContent = label;
    }
  }
}

function tailFrom(uid, i) {
  const bd = board();
  const raw = bd.stats[uid]?.picks?.open?.[Number(i)];
  const t = raw && sanitizeShare(raw);
  if (!t) return toast("That pick isn't available anymore", "err");
  S.tailIn = t;
  openSheet({ kind: "tail" });
}

async function shareInvite() {
  const bd = board();
  const g = bd.groups.find((x) => x.id === (settings.demo ? "demo" : fr.active)) || bd.groups[0];
  if (!g) return;
  const url = inviteLink(g.code);
  const text = `Join my hedgehog group "${g.name}". Leaderboard + we can tail each other's picks. Code: ${g.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: "hedgehog", text, url });
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Invite link copied. Paste it in your group chat", "won");
  } catch {
    toast(`Invite code: ${g.code}`);
  }
}

export const friendsActions = {
  "fr-refresh": () => refreshFriends(),
  "fr-period": (el) => {
    fr.period = el.dataset.v;
    render();
  },
  "fr-sort": (el) => {
    fr.sort = el.dataset.v;
    render();
  },
  "fr-group": (el) => (settings.demo ? null : selectGroup(el.dataset.v)),
  "fr-new": () => (settings.demo ? toast("Groups are pretend in demo mode. Turn it off in Settings to make a real one") : openSheet({ kind: "groupnew" })),
  "fr-settings": () => openSheet({ kind: "group" }),
  "fr-invite": () => shareInvite(),
  "fr-copy-code": async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.v);
      toast("Code copied", "won");
    } catch {
      toast(`Code: ${el.dataset.v}`);
    }
  },
  "open-member": (el) => openSheet({ kind: "member", id: el.dataset.id }),
  "fr-tail": (el) => tailFrom(el.dataset.u, el.dataset.i),
  "fr-create": (el) => busy(el, async () => {
    const name = field(el, "new-name")?.value.trim();
    const me = field(el, "new-me")?.value.trim();
    if (!name) throw new Error("Give your group a name");
    if (!me) throw new Error("Enter the name your friends will see");
    if (settings.demo) throw new Error("Turn off demo mode in Settings to create a real group");
    settings.shareName ||= me;
    saveSettings();
    const g = await createGroup(name, me);
    S.sheet = null;
    toast(`"${g.name}" is ready. Invite your friends!`, "won");
    render();
  }),
  "fr-join": (el) => busy(el, async () => {
    const code = (field(el, "join-code")?.value || "").trim();
    const me = (field(el, "join-me")?.value || "").trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) throw new Error("Enter the invite code (like ABC123)");
    if (!me) throw new Error("Enter the name your friends will see");
    if (settings.demo) throw new Error("Turn off demo mode in Settings to join a real group");
    settings.shareName ||= me;
    saveSettings();
    const g = await joinGroup(code, me);
    fr.pendingJoin = null;
    S.sheet = null;
    location.hash = "friends";
    toast(`You're in "${g.name}"`, "won");
    render();
  }),
  "fr-rename": (el) => busy(el, async () => {
    const v = field(el, "rename")?.value.trim();
    if (!v) throw new Error("Enter a name");
    if (settings.demo) {
      settings.shareName = v;
      saveSettings();
    } else await renameMe(fr.active, v);
    toast("Name updated", "won");
  }),
  "fr-picks": (el) => {
    settings.sharePicks = el.checked;
    saveSettings();
    el.closest(".switch")?.classList.toggle("on", el.checked);
    publishSoon(300);
    toast(el.checked ? "Your open picks are visible to your groups" : "Your picks are hidden. Your record still shows");
  },
  "fr-leave": (el) => {
    if (S.confirmDelete !== "leave") {
      S.confirmDelete = "leave";
      el.textContent = "Tap again to leave";
      return;
    }
    S.confirmDelete = null;
    if (settings.demo) return toast("It's a demo group; nothing to leave");
    busy(el, async () => {
      await leaveGroup(fr.active);
      S.sheet = null;
      toast("You left the group");
      render();
    });
  },
};
