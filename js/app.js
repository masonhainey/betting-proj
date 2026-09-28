// Entry point.

import { alertsOn, subscribePush } from "./alerts.js";
import { handleJoinLink, onFriendsTab } from "./views/friends.js";
import { handleTailLink } from "./sheets/share.js";
import * as cloud from "./cloud.js";
import { icons } from "./ui.js";
import { CLOUD, syncNow } from "./account.js";
import { loadCache, tick } from "./data.js";
import { handleAuthLink } from "./events.js";
import { render } from "./render.js";
import { onModel } from "./model/index.js";
import { $, BOOKS, S, TABS } from "./state.js";

// ───────────────────────────── boot ─────────────────────────────

function boot() {
  $("#nav").innerHTML = TABS.map((t) => `<a href="#${t}" data-tab="${t}">${icons[t]}<span>${{ bets: "Bets", live: "Live", schedule: "Upcoming", build: "Build", friends: "Friends", news: "News" }[t]}</span></a>`).join("");
  $("#books").innerHTML = BOOKS.map((b) => `<option value="${b}">`).join("");
  $("#btn-settings").innerHTML = icons.gear;
  $("#btn-add").innerHTML = `${icons.plus}<span>Add pick</span>`;
  $("#fab").innerHTML = icons.plus;
  $("#dropover .dz-ico").innerHTML = icons.upload;
  $("#today-top").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  loadCache();
  render();
  handleTailLink();
  handleJoinLink();
  if (S.tab === "friends") onFriendsTab();
  if (CLOUD) {
    handleAuthLink();
    if (cloud.currentUser()) syncNow();
  }
  if (alertsOn() && cloud.currentUser()) subscribePush();
  tick(true);
  // Past-games data the old in-browser model saved on this device (the model now loads a prebuilt file).
  try {
    for (const k of Object.keys(localStorage)) if (/^lw\.(demo\.)?model\.(cfb|nfl|card)\./.test(k)) localStorage.removeItem(k);
  } catch {}
  onModel(() => render()); // model file or live news arrived: show the numbers
  setInterval(tick, 5000);
  // Installed-app support (Add to Home Screen): offline shell + faster launches.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // When a new version takes over, reload once so every file is the new one.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  }
}

boot();
