(function () {
  "use strict";

  const cfg = window.PLAYGROUND_CONFIG || {};
  const samples = window.PLAYGROUND_SAMPLES || {};
  const sampleName = new URLSearchParams(location.search).get("sample");
  const HISTORY_KEY = "dv_playground_checks";
  const KEY_PLACEHOLDER = "YOUR_SDK_KEY";
  const $ = (id) => document.getElementById(id);

  const VERDICTS = {
    allow: { label: "Allow", tone: "ok", text: "Low risk. Let this visit continue." },
    review: { label: "Review", tone: "warn", text: "Something looks off. Add a step-up check, such as an OTP." },
    block: { label: "Block", tone: "bad", text: "High risk. Stop this visit, or send it to manual review." },
  };

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
  $("code").textContent = snippet;
  wireCopy($("copy-code"), () => snippet);
  wireCopy($("copy-id"), () => $("device-id").textContent);

  renderQr();
  renderHistory();

  /* ---------- the check ---------- */

  const sdkReady = sampleName ? null : loadSdk();
  $("recheck").addEventListener("click", () => void check());
  void check();

  function loadSdk() {
    if (!cfg.sdkKey || cfg.sdkKey === KEY_PLACEHOLDER) {
      return Promise.reject(new PlaygroundError("no-key"));
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.sdkUrl;
      s.async = true;
      s.onload = () => {
        if (!window.DeepvueImprint) return reject(new PlaygroundError("blocked"));
        // Manual mode: nothing on page load, one collect per check.
        window.DeepvueImprint.config({ apiKey: cfg.sdkKey, autoCollectOnLoad: false });
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
        res = await sdk.collect({ tag: { flow: "playground" } });
      }
      $("raw").textContent = JSON.stringify(res, null, 2);
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
    const pill = $("verdict-pill");
    pill.textContent = v.label;
    pill.dataset.tone = v.tone;
    $("verdict").dataset.tone = v.tone;
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
      same.textContent =
        previous.device_id === deviceId
          ? "Same device ID as your previous check."
          : `Different device ID from your previous check (${short(previous.device_id)}).`;
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

      const li = el("li", { className: "check", dataset: { state } });
      const head = el("div", { className: "check-head" });
      head.append(el("span", { className: "dot", ariaHidden: "true" }), el("span", { className: "check-label", textContent: c.label }));
      head.append(el("span", { className: "check-state", textContent: STATE_TEXT[state] }));
      li.append(head, el("p", { className: "check-desc", textContent: c.desc }));
      list.append(li);
    }

    const others = signals.filter((s) => !used.has(s));
    $("other-signals").hidden = others.length === 0;
    $("other-list").replaceChildren(...others.map((s) => el("li", { className: "chip", textContent: SIGNAL_TEXT[s] || humanize(s), title: s })));
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
    box.textContent = text;
    $("checks").replaceChildren(el("li", { className: "muted small", textContent: "No checks to show yet." }));
    $("other-signals").hidden = true;
  }

  function failureText(res, err) {
    const kind = err && err.kind;
    if (kind === "no-key") {
      return "This copy of the playground has no SDK key. Put one in config.js, or preview it with ?sample=allow, ?sample=review or ?sample=block.";
    }
    if (kind === "blocked") {
      return "Your browser blocked the Deepvue script, usually an ad or privacy blocker. Allow it on this page and press Check again.";
    }
    if (kind === "no-sample") return "No such sample. Use ?sample=allow, review, block or error.";
    const raw = String((res && res._error) || (err && err.message) || "");
    const status = Number((raw.match(/\b([45]\d\d)\b/) || [])[1]);
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
          el("span", { className: "pill pill-sm", dataset: { tone: v.tone }, textContent: v.label }),
          el("code", { textContent: short(h.device_id) }),
          el("span", { className: "muted small", textContent: time(h.at) + (h.sample ? " · sample" : "") })
        );
        li.append(top);
        if (h.flags && h.flags.length) li.append(el("div", { className: "muted small", textContent: h.flags.join(", ") }));
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
    const url = location.origin + location.pathname;
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

  function wireCopy(button, getText) {
    button.addEventListener("click", async () => {
      const label = button.textContent;
      try {
        await navigator.clipboard.writeText(getText());
        button.textContent = "Copied";
      } catch (_) {
        button.textContent = "Copy failed";
      }
      setTimeout(() => (button.textContent = label), 1400);
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
