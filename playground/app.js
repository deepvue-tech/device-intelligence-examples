(function () {
  "use strict";

  const cfg = window.PLAYGROUND_CONFIG || {};
  const samples = window.PLAYGROUND_SAMPLES || {};
  const params = new URLSearchParams(location.search);
  const sampleName = params.get("sample");
  // Device check link: ?key=<customer's SDK key, live or test> runs the check
  // under that account, so results land in the customer's own dashboard.
  // A malformed key must not fall back to config.js: that would bill our account.
  const keyParam = params.get("key");
  const linkKey = keyParam !== null && /^sk_(test_)?[0-9a-f]{40}$/.test(keyParam) ? keyParam : null;
  const badLinkKey = keyParam !== null && linkKey === null;
  const sdkKey = linkKey || cfg.sdkKey;
  const flow = linkKey ? "device_check" : "playground";
  const HISTORY_KEY = "dv_playground_checks";
  const KEY_PLACEHOLDER = "YOUR_SDK_KEY";
  const $ = (id) => document.getElementById(id);

  // Tones are the dashboard's badge tones (ok, warn, err).
  const VERDICTS = {
    allow: { label: "Allow", tone: "ok", text: "Low risk. Let this visit continue." },
    review: { label: "Review", tone: "warn", text: "Something looks off. Add a step-up check, such as an OTP." },
    block: { label: "Block", tone: "err", text: "High risk. Stop this visit, or send it to manual review." },
  };

  // The dashboard's icons (Hugeicons), inline so the page needs no icon
  // library. Fixed strings, never built from response data.
  const ICONS = {
    tick: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m5 14l3.5 3.5L19 6.5"/>',
    alertCircle:
      '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m.125 3.75H12m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0"/></g>',
    alert:
      '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M13.925 21h-3.85c-4.63 0-6.945 0-7.799-1.506c-.853-1.506.331-3.503 2.7-7.495L6.9 8.753C9.176 4.918 10.313 3 12 3s2.824 1.918 5.1 5.753L19.023 12c2.369 3.992 3.553 5.989 2.7 7.495C20.87 21 18.555 21 13.924 21M12 9v4"/><path d="M12.125 16.75H12m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0"/></g>',
    info: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m.125-3.75H12m.25 0a.25.25 0 1 0-.5 0a.25.25 0 0 0 .5 0"/></g>',
  };
  const STATE_ICON = { flag: "alertCircle", warn: "alert", clear: "tick" };

  // The dashboard's code colours: comments, JSON keys, strings, keywords, numbers.
  const TOKEN =
    /(\/\/.*$)|("(?:[^"\\]|\\.)*"(?=\s*:))|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)|\b(const|let|var|return|function|new|true|false|null|if|switch|case|break|default)\b|\b(\d+(?:\.\d+)*)\b/g;
  const TOKEN_CLASS = ["t-com", "t-key", "t-str", "t-kw", "t-num"];

  // Each check claims the signal codes it explains; codes left over are listed
  // under "Other signals".
  const CHECKS = [
    {
      label: "Bot or automation",
      desc: "Headless browsers and tools such as Selenium, Puppeteer or Playwright.",
      codes: ["bot_detected", "headless_detected", "automation_framework_detected"],
      extra: (r) => ({ detected: "flag", suspected: "warn" })[r.risk && r.risk.automation_status],
    },
    { label: "Private browsing", desc: "An incognito or private window.", codes: ["incognito_detected"] },
    { label: "Developer tools", desc: "DevTools open while the page ran.", codes: ["devtools_detected"] },
    { label: "VPN", desc: "Traffic routed through a VPN service.", codes: ["vpn_detected"], net: "is_vpn" },
    { label: "Proxy", desc: "A public or residential proxy.", codes: ["proxy_detected", "residential_proxy_detected"], net: "is_proxy" },
    { label: "Tor", desc: "A Tor exit node.", codes: ["tor_detected"], net: "is_tor" },
    { label: "Data-centre IP", desc: "The IP belongs to a hosting provider, not a home or mobile network.", codes: ["datacenter_ip_detected"] },
    { label: "Time zone vs IP", desc: "The browser's time zone doesn't match where the IP is.", codes: ["geo_mismatch_detected"], net: "geo_mismatch_detected" },
  ];

  const SIGNAL_TEXT = {
    drift_detected: "Device traits changed since its last visit",
    is_new_device: "First visit from this device",
    geo_spoofing_detected: "Location looks spoofed",
    mock_location_detected: "Mock location in use",
    root_detected: "Rooted device",
    frida_detected: "Frida instrumentation",
    hooking_detected: "Code hooking",
    cloned_app_detected: "Cloned app",
    basic_only: "Basic integrity only",
  };

  // identity.matched_on values a web collect can return.
  const MATCHED_ON = {
    stable_hash: "recognised by its stable device traits",
    stable_core_hash: "recognised by its stable device traits",
    confidence_resolution: "recognised from its device traits",
    fuzzy_core_weighted: "recognised by a close match of its device traits",
  };

  const STATE_TEXT = { flag: "Detected", warn: "Suspected", clear: "Not detected" };

  /* ---------- links and static content ---------- */

  for (const id of ["nav-signup", "cta-signup"]) $(id).href = cfg.signUpUrl || "#";
  for (const id of ["nav-guide", "cta-guide"]) $(id).href = cfg.setupGuideUrl || "#";

  const snippet = [
    `<script src="${cfg.sdkUrl}"></script>`,
    "<script>",
    "  DeepvueImprint.config({ apiKey: 'YOUR_SDK_KEY', autoCollectOnLoad: false });",
    "",
    "  // At login, sign-up or checkout:",
    "  DeepvueImprint.collect({ tag: { flow: 'login' } }).then((result) => {",
    "    if (result._error) return proceedWithoutVerdict();",
    "    switch (result.risk.action) {",
    "      case 'block': stopFlow(); break;",
    "      case 'review': askForOtp(); break; // or a selfie, or manual review",
    "      default: proceed();",
    "    }",
    "  });",
    "</script>",
  ].join("\n");
  renderCode($("code"), snippet);
  wireCopy($("copy-code"), () => snippet);
  wireCopy($("copy-id"), () => $("device-id").textContent);

  renderQr();
  renderHistory();

  /* ---------- the check ---------- */

  const sdkReady = sampleName ? null : loadSdk();
  $("recheck").addEventListener("click", () => void check());
  void check();

  function loadSdk() {
    if (badLinkKey) {
      return Promise.reject(new PlaygroundError("bad-key"));
    }
    if (!sdkKey || sdkKey === KEY_PLACEHOLDER) {
      return Promise.reject(new PlaygroundError("no-key"));
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.sdkUrl;
      s.async = true;
      s.onload = () => {
        if (!window.DeepvueImprint) return reject(new PlaygroundError("blocked"));
        // Manual mode: nothing on page load, one collect per check.
        window.DeepvueImprint.config({ apiKey: sdkKey, autoCollectOnLoad: false });
        resolve(window.DeepvueImprint);
      };
      s.onerror = () => reject(new PlaygroundError("blocked"));
      document.head.appendChild(s);
    });
  }

  async function check() {
    setBusy(true);
    try {
      let res;
      if (sampleName) {
        await new Promise((r) => setTimeout(r, 450));
        res = samples[sampleName];
        if (!res) throw new PlaygroundError("no-sample");
        res = JSON.parse(JSON.stringify(res));
      } else {
        const sdk = await sdkReady;
        res = await sdk.collect({ tag: { flow } });
      }
      renderCode($("raw"), JSON.stringify(res, null, 2));
      if (!res || res._error || !res.risk) {
        showError(failureText(res));
      } else {
        render(res);
      }
    } catch (e) {
      showError(failureText(null, e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rendering ---------- */

  function render(r) {
    $("result-error").hidden = true;
    $("result").hidden = false;

    const v = VERDICTS[r.risk.action] || { label: r.risk.action || "Unknown", tone: "neutral", text: "" };
    const badge = $("verdict-badge");
    badge.textContent = v.label;
    badge.dataset.tone = v.tone;
    $("verdict-text").textContent = v.text;

    const idn = r.identity || {};
    const deviceId = idn.device_id || (window.DeepvueImprint && window.DeepvueImprint.getVisitorId()) || "Not available";
    $("device-id").textContent = deviceId;
    $("device-history").textContent = historyText(idn);

    // Compare real checks with real ones and samples with samples.
    const previous = readHistory().find((h) => !!h.sample === !!sampleName);
    const same = $("same-device");
    if (previous && previous.device_id && deviceId !== "Not available") {
      same.hidden = false;
      fillCallout(
        same,
        "info",
        previous.device_id === deviceId
          ? "Same device ID as your previous check."
          : `Different device ID from your previous check (${short(previous.device_id)}).`
      );
    } else {
      same.hidden = true;
    }

    const flagged = renderChecks(r);
    remember({ at: Date.now(), action: r.risk.action, device_id: deviceId, flags: flagged, sample: !!sampleName });
  }

  function renderChecks(r) {
    const signals = Array.isArray(r.risk.signals) ? r.risk.signals : [];
    const net = r.network || {};
    const used = new Set();
    const flagged = [];
    const list = $("checks");
    list.replaceChildren();

    for (const c of CHECKS) {
      c.codes.forEach((code) => used.add(code));
      let state = c.codes.some((code) => signals.includes(code)) || (c.net && net[c.net] === true) ? "flag" : "clear";
      if (state === "clear" && c.extra) state = c.extra(r) || "clear";
      if (state !== "clear") flagged.push(c.label);

      // As on the dashboard's session page: a green tick when clear, a red
      // alert when detected, amber when only suspected.
      const li = el("li", { className: "check", dataset: { state } });
      const text = el("div", { className: "check-text" });
      text.append(el("span", { className: "check-label", textContent: c.label }), el("span", { className: "check-desc", textContent: c.desc }));
      const stateEl =
        state === "clear"
          ? el("span", { className: "check-state", textContent: STATE_TEXT[state] })
          : el("span", { className: "badge", dataset: { tone: state === "flag" ? "err" : "warn" }, textContent: STATE_TEXT[state] });
      li.append(icon(STATE_ICON[state]), text, stateEl);
      list.append(li);
    }

    // The card head sums it up: how many checks fired.
    const summary = $("checks-summary");
    summary.hidden = false;
    summary.textContent = flagged.length ? `${flagged.length} flagged` : "All clear";
    summary.dataset.tone = flagged.length ? "err" : "ok";

    const others = signals.filter((s) => !used.has(s));
    $("other-signals").hidden = others.length === 0;
    $("other-list").replaceChildren(...others.map((s) => el("li", { className: "badge", textContent: SIGNAL_TEXT[s] || humanize(s), title: s })));
    return flagged;
  }

  function historyText(idn) {
    if (idn.is_new_device) return "New device. This is the first time Deepvue has seen it.";
    const n = idn.seen_count || 0;
    const parts = [`Seen ${n} ${n === 1 ? "time" : "times"}`];
    const first = idn.lifecycle && idn.lifecycle.first_seen;
    if (first) parts.push(`first seen ${relative(first)}`);
    let text = parts.join(", ");
    if (MATCHED_ON[idn.matched_on]) text += `; ${MATCHED_ON[idn.matched_on]}`;
    return text + ".";
  }

  function showError(text) {
    $("result").hidden = true;
    const box = $("result-error");
    box.hidden = false;
    fillCallout(box, "err", text);
    $("checks").replaceChildren(el("li", { className: "text-small faint empty", textContent: "No checks to show yet." }));
    $("checks-summary").hidden = true;
    $("other-signals").hidden = true;
  }

  function failureText(res, err) {
    const kind = err && err.kind;
    if (kind === "no-key") {
      return "This copy of the playground has no SDK key. Put one in config.js, or preview it with ?sample=allow, ?sample=review or ?sample=block.";
    }
    if (kind === "bad-key") {
      return "This link's SDK key isn't valid, so no check was run. Ask whoever sent the link for a new one.";
    }
    if (kind === "blocked") {
      return "Your browser blocked the Deepvue script, usually an ad or privacy blocker. Allow it on this page and press Check again.";
    }
    if (kind === "no-sample") return "No such sample. Use ?sample=allow, review, block or error.";
    const raw = String((res && res._error) || (err && err.message) || "");
    const status = Number((raw.match(/\b([45]\d\d)\b/) || [])[1]);
    if ((status === 401 || status === 403) && linkKey) {
      return `Deepvue refused this link's SDK key (HTTP ${status}). It may have been rotated: ask whoever sent the link for a new one.`;
    }
    if (status === 401 || status === 403) return `Deepvue refused this page's SDK key (HTTP ${status}). Check the key in config.js.`;
    if (status === 402) return "The demo account behind this page is out of credit (HTTP 402). Please try again later.";
    if (status === 429) return "Too many checks from this demo right now (HTTP 429). Try again in a minute.";
    return `The check didn't go through${status ? ` (HTTP ${status})` : ""}. Press Check again.`;
  }

  function setBusy(busy) {
    $("recheck").disabled = busy;
    $("result-loading").hidden = !busy;
    if (busy) {
      $("result").hidden = true;
      $("result-error").hidden = true;
    }
  }

  /* ---------- history (this browser only) ---------- */

  function readHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }

  function remember(entry) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...readHistory()].slice(0, 8)));
    } catch (_) {
      /* storage unavailable: history just stays empty */
    }
    renderHistory();
  }

  function renderHistory() {
    const items = readHistory();
    const list = $("history");
    if (!items.length) return;
    list.replaceChildren(
      ...items.map((h) => {
        const v = VERDICTS[h.action] || { label: h.action, tone: "neutral" };
        const li = el("li");
        const top = el("div", { className: "history-top" });
        top.append(
          el("span", { className: "badge", dataset: { tone: v.tone }, textContent: v.label }),
          el("code", { textContent: short(h.device_id) }),
          el("span", { className: "text-caption faint", textContent: time(h.at) + (h.sample ? " · sample" : "") })
        );
        li.append(top);
        if (h.flags && h.flags.length) li.append(el("div", { className: "text-caption muted history-flags", textContent: h.flags.join(", ") }));
        return li;
      })
    );
  }

  /* ---------- QR for trying on a phone ---------- */

  function renderQr() {
    const card = $("qr-card");
    if (location.protocol === "file:" || typeof window.qrcode !== "function") {
      card.hidden = true;
      return;
    }
    const url = location.origin + location.pathname + (linkKey ? `?key=${linkKey}` : "");
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $("qr-url").textContent = url;
  }

  /* ---------- helpers ---------- */

  function PlaygroundError(kind) {
    this.kind = kind;
    this.message = kind;
  }

  function el(tag, props) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "ariaHidden") node.setAttribute("aria-hidden", v);
      else node[k] = v;
    }
    return node;
  }

  /** One of ICONS as an inline SVG. */
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name];
    return svg;
  }

  /** A callout's icon and text, as the dashboard draws them. */
  function fillCallout(box, tone, text) {
    box.dataset.tone = tone;
    box.replaceChildren(icon(tone === "info" ? "info" : tone === "warn" ? "alert" : "alertCircle"), el("div", { textContent: text }));
  }

  /** Code with line numbers and colours, built from text nodes only. */
  function renderCode(box, code) {
    box.replaceChildren(
      ...code.split("\n").map((line, n) => {
        const row = el("div", { className: "code-line" });
        const t = el("span", { className: "code-t" });
        let last = 0;
        TOKEN.lastIndex = 0;
        for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
          if (m.index > last) t.append(line.slice(last, m.index));
          const k = m.slice(1).findIndex((g) => g !== undefined);
          t.append(el("span", { className: TOKEN_CLASS[k], textContent: m[0] }));
          last = m.index + m[0].length;
        }
        if (last < line.length) t.append(line.slice(last));
        if (!line) t.append(" ");
        row.append(el("span", { className: "code-n", textContent: String(n + 1) }), t);
        return row;
      })
    );
  }

  /** Copy, then confirm in green on the button itself and return. */
  function wireCopy(button, getText) {
    const label = button.querySelector(".copy-label");
    const idle = label ? label.textContent : "";
    const idleAria = button.getAttribute("aria-label");
    let timer;
    button.addEventListener("click", async () => {
      let ok = true;
      try {
        await navigator.clipboard.writeText(getText());
      } catch (_) {
        ok = false;
      }
      button.dataset.copied = ok ? "1" : "";
      if (label) label.textContent = ok ? "Copied" : "Copy failed";
      if (idleAria) button.setAttribute("aria-label", ok ? "Copied" : "Copy failed");
      clearTimeout(timer);
      timer = setTimeout(() => {
        delete button.dataset.copied;
        if (label) label.textContent = idle;
        if (idleAria) button.setAttribute("aria-label", idleAria);
      }, 1400);
    });
  }

  function humanize(code) {
    const s = String(code).replace(/^is_/, "").replace(/_detected$/, "").replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function short(id) {
    const s = String(id || "");
    return s.length > 14 ? s.slice(0, 14) + "…" : s;
  }

  function relative(iso) {
    // The API sends UTC without a zone suffix; without one, Date reads local time.
    const s = String(iso);
    const ms = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z").getTime() - Date.now();
    if (!Number.isFinite(ms)) return "earlier";
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const mins = Math.round(ms / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
    return rtf.format(Math.round(hours / 24), "day");
  }

  function time(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
})();
