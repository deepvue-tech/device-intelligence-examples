// The /pair page. The demo apps open https://<host>/pair#<SDK key> straight
// from the phone's camera; this page shows only when the app isn't installed,
// or on a laptop. The key is read from location.hash in this browser and never
// sent anywhere: no requests, no analytics. The apps check it the same way
// (URL-decode, trim, sk_ prefix), so a key this page accepts, the app accepts.
(function () {
  "use strict";

  const PLAY = "https://play.google.com/store/apps/details?id=ai.deepvue.deepvuefp";
  const APP_STORE = "https://apps.apple.com/app/id6787858365";

  const $ = (id) => document.getElementById(id);

  function clean(value) {
    const v = value.trim();
    return v.startsWith("sk_") ? v : null;
  }

  // { key } for a valid key, { bad: true } for anything else after "#".
  function readKey() {
    const raw = location.hash.slice(1);
    if (!raw) return {};
    try {
      const key = clean(decodeURIComponent(raw));
      return key ? { key } : { bad: true };
    } catch (_) {
      return { bad: true };
    }
  }

  // Read on every render, not once, so a test can swap the user agent.
  function platform() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return "android";
    // iPadOS asks for desktop pages as a Mac; touch gives it away.
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    return "desktop";
  }

  const mask = (key) => "sk_…" + (key.length > 7 ? key.slice(-4) : "");

  function render() {
    const { key, bad } = readKey();
    const p = platform();
    const phone = p !== "desktop";

    $("bad-key").hidden = !bad;
    $("share-note").hidden = !key;
    $("view-qr").hidden = phone || !key;
    $("view-paste").hidden = phone || Boolean(key);
    $("view-phone").hidden = !phone;
    $("side").hidden = phone;

    if (phone) renderPhone(p, key);
    else if (key) renderQr(key);
    else {
      $("title").textContent = "Open the app with your SDK key";
      $("lead").textContent =
        "Paste your SDK key to make a QR code. Scan it with your phone's camera and Deepvue Device Intelligence opens with the key already set.";
    }
  }

  function renderQr(key) {
    $("title").textContent = "Scan to open the app";
    $("lead").textContent =
      "Scan this code with your phone. Deepvue Device Intelligence opens with your SDK key already set, so there's nothing to type.";
    const link = location.origin + location.pathname + "#" + encodeURIComponent(key);
    $("qr-link").textContent = location.host + location.pathname + "#" + mask(key);
    const box = $("qr");
    if (typeof window.qrcode !== "function" || typeof window.brandedQrSvg !== "function") {
      box.textContent = "Couldn't draw the QR code. Reload the page.";
      return;
    }
    try {
      // Branded like the console's codes (qr.js).
      box.innerHTML = window.brandedQrSvg(link);
    } catch (_) {
      // Only a pasted value too long for any QR code gets here.
      box.textContent = "This key is too long for a QR code.";
    }
  }

  function renderPhone(p, key) {
    const android = p === "android";
    const btn = $("store-btn");
    $("title").textContent = "Get the app";
    if (android) {
      btn.textContent = "Get it on Google Play";
      // Play hands the referrer to the app on its first launch after this install.
      btn.href = key ? PLAY + "&referrer=" + encodeURIComponent("dv_key=" + key) : PLAY;
    } else {
      btn.textContent = "Download on the App Store";
      btn.href = APP_STORE;
    }
    const store = android ? "Google Play" : "the App Store";
    $("lead").textContent = key
      ? android
        ? "Deepvue Device Intelligence isn't on this phone yet. Install it from Google Play and it opens with your SDK key already set."
        : "Deepvue Device Intelligence isn't on this phone yet. Install it from the App Store."
      : `Install Deepvue Device Intelligence from ${store}. It asks for your SDK key when you open it.`;
    // The App Store passes nothing through an install, so iPhone needs a second scan.
    $("phone-after").hidden = !key || android;
    $("phone-update").hidden = !key;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("paste-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("key-input");
      const key = clean(input.value);
      $("paste-error").hidden = Boolean(key);
      if (!key) return;
      input.value = "";
      history.replaceState(null, "", "#" + encodeURIComponent(key));
      render();
    });
    $("other-key").addEventListener("click", () => {
      history.replaceState(null, "", location.pathname + location.search);
      render();
      $("key-input").focus();
    });
    window.addEventListener("hashchange", render);
    render();
  });
})();
