(function () {
  "use strict";

  var root = document.documentElement;

  // ---- theme ----

  var THEME_KEY = "pr-insights-theme";

  function currentTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (e) {
      /* private mode */
    }
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return "light";
  }

  function applyTheme(theme) {
    root.dataset.colorMode = theme;
    var darkIcon = document.querySelector(".theme-icon-dark");
    var lightIcon = document.querySelector(".theme-icon-light");
    if (darkIcon) darkIcon.hidden = theme === "dark";
    if (lightIcon) lightIcon.hidden = theme === "light";
  }

  applyTheme(currentTheme());

  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = root.dataset.colorMode === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* private mode */
      }
    });
  }

  // ---- relative timestamps ----

  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  var MONTH = 30 * DAY;

  function relativeTime(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts.getTime();
    if (diff < 0) diff = 0;
    if (diff < MINUTE) return "just now";
    if (diff < HOUR) return Math.floor(diff / MINUTE) + " minute" + (Math.floor(diff / MINUTE) === 1 ? "" : "s") + " ago";
    if (diff < DAY) return Math.floor(diff / HOUR) + " hour" + (Math.floor(diff / HOUR) === 1 ? "" : "s") + " ago";
    if (diff < MONTH) return Math.floor(diff / DAY) + " day" + (Math.floor(diff / DAY) === 1 ? "" : "s") + " ago";
    var months = Math.floor(diff / MONTH);
    if (months < 12) return months + " month" + (months === 1 ? "" : "s") + " ago";
    var years = Math.floor(months / 12);
    return years + " year" + (years === 1 ? "" : "s") + " ago";
  }

  function formatFull(ts) {
    return ts.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  document.querySelectorAll("time[data-timestamp]").forEach(function (el) {
    var ts = new Date(el.dataset.timestamp);
    if (isNaN(ts.getTime())) return;
    el.textContent = relativeTime(ts);
    el.title = formatFull(ts);
    el.setAttribute("datetime", el.dataset.timestamp);
  });

  var syncStatus = document.getElementById("sync-status");
  if (syncStatus) {
    var syncedAt = syncStatus.querySelector("#sync-text").dataset.synced;
    if (syncedAt) {
      var ts = new Date(syncedAt);
      if (!isNaN(ts.getTime())) {
        var text = syncStatus.querySelector("#sync-text");
        text.textContent = "Updated " + relativeTime(ts);
        syncStatus.title = "Last sync: " + formatFull(ts);
      }
    }
  }

  // ---- sync button ----

  var syncBtn = document.getElementById("sync-btn");
  if (syncBtn) {
    syncBtn.addEventListener("click", function () {
      fetch("/api/sync", { method: "POST" }).then(function () {
        syncBtn.disabled = true;
        syncBtn.classList.add("btn-loading");
        syncBtn.querySelector("#sync-btn-label").textContent = "Syncing";
        pollUntilDone();
      }).catch(function () {
        syncBtn.disabled = false;
      });
    });
  }

  function pollUntilDone() {
    setTimeout(function () {
      fetch("/api/status", { cache: "no-store" }).then(function (r) {
        return r.json();
      }).then(function (st) {
        if (st.syncing) {
          pollUntilDone();
        } else {
          window.location.reload();
        }
      }).catch(function () {
        pollUntilDone();
      });
    }, 1500);
  }

  // ---- auto reload while waiting for the first sync ----

  if (root.dataset.autoreload === "1") {
    (function pollFirstSync() {
      setTimeout(function () {
        fetch("/api/status", { cache: "no-store" }).then(function (r) {
          return r.json();
        }).then(function (st) {
          if (st.pulls > 0 && !st.syncing) {
            window.location.reload();
          } else {
            pollFirstSync();
          }
        }).catch(function () {
          pollFirstSync();
        });
      }, 5000);
    })();
  }
})();
