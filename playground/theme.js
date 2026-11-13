// Light / dark mode, as in the Deepvue dashboard. Follows the system setting
// until the visitor picks one with the button in the top bar; the pick is kept
// in this browser. Loaded in <head>, before the page paints, so a saved
// choice never flashes the other theme first.
(function () {
  "use strict";

  const KEY = "dv_playground_theme";
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (_) {
      return null;
    }
  }

  const initial = saved();
  if (initial) root.dataset.theme = initial;

  function current() {
    return root.dataset.theme || (media && media.matches ? "dark" : "light");
  }

  function label(button) {
    const next = current() === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${next} mode`);
    button.title = `${next === "dark" ? "Dark" : "Light"} mode`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    label(button);
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch (_) {
        /* the choice still holds until the page is closed */
      }
      label(button);
    });
    // No choice yet: the button follows the system when it changes.
    if (media && media.addEventListener) media.addEventListener("change", () => label(button));
  });
})();
