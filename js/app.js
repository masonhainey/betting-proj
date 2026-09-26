// Entry point.

import * as cloud from "./cloud.js";
import { icons } from "./ui.js";
import { CLOUD, syncNow } from "./account.js";
import { loadCache, tick } from "./data.js";
import { handleAuthLink } from "./events.js";
import { render } from "./render.js";
import { $, BOOKS, TABS } from "./state.js";

// ───────────────────────────── boot ─────────────────────────────

function boot() {
  $("#nav").innerHTML = TABS.map((t) => `<a href="#${t}" data-tab="${t}">${icons[t]}<span>${{ bets: "Bets", live: "Live", schedule: "Upcoming", build: "Build", news: "News" }[t]}</span></a>`).join("");
  $("#books").innerHTML = BOOKS.map((b) => `<option value="${b}">`).join("");
  $("#btn-settings").innerHTML = icons.gear;
  $("#btn-add").innerHTML = `${icons.plus}<span>Add pick</span>`;
  $("#fab").innerHTML = icons.plus;
  $("#dropover .dz-ico").innerHTML = icons.upload;
  $("#today-top").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  loadCache();
  render();
  if (CLOUD) {
    handleAuthLink();
    if (cloud.currentUser()) syncNow();
  }
  tick(true);
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
