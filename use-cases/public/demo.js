// Shared by every demo page: loads the SDK (or the simulated one), runs one
// collect per form submit, posts it to the demo server and shows the result.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const VERDICTS = {
    allow: { label: "Allow", tone: "ok" },
    review: { label: "Review", tone: "warn" },
    block: { label: "Block", tone: "bad" },
  };

  window.Demo = { init };

  // opts: { demo, flow, form, input(form), linkedId(), linkedIdName, actionLabel }
  function init(opts) {
    mountShared(opts.form);
    let deviceId = null;

    const sdkReady = fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        $("code-browser").textContent = browserSnippet(cfg, opts);
        const simulate = !cfg.sdkKey || params.has("mock");
        if (simulate) {
          showSimulateNotice(Boolean(cfg.sdkKey));
          return window.DeepvueImprintMock;
        }
        return loadSdk(cfg);
      });
    sdkReady.catch(() => {}); // reported on submit

    fetch(`/api/rules/${opts.demo}`)
      .then((r) => r.text())
      .then((t) => ($("code-server").textContent = t));

    opts.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (opts.form.reportValidity()) void submit();
    });

    $("forget").addEventListener("click", async () => {
      if (!deviceId) return;
      await post("/api/forget", { demo: opts.demo, deviceId });
      $("outcome").hidden = true;
      $("backend").hidden = true;
      $("backend-empty").hidden = false;
      $("backend-empty").textContent = "This device's history on the demo server is cleared. The next request starts fresh.";
    });

    async function submit() {
      setBusy(opts.form, true);
      try {
        const sdk = await sdkReady;
        const result = await sdk.collect({ linkedId: opts.linkedId(), tag: { flow: opts.flow } });
        if (!result || result._error || !result.risk) throw new DemoError(failureText(result));

        const body = {
          visit: {
            request_id: result._meta && result._meta.request_id,
            identity: result.identity,
            risk: result.risk,
            network: result.network,
          },
          input: opts.input(opts.form),
        };
        const reply = await post(`/api/${opts.demo}`, body);
        deviceId = reply.visit.deviceId;
        renderOutcome(reply.outcome);
        renderBackend(body, reply);
      } catch (e) {
        renderOutcome(null, e instanceof DemoError ? e.message : failureText(null, e));
      } finally {
        setBusy(opts.form, false);
      }
    }
  }

  /* ---------- SDK ---------- */

  function loadSdk(cfg) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.sdkUrl;
      s.async = true;
      s.onload = () => {
        if (!window.DeepvueImprint) return reject(new DemoError(BLOCKED));
        // Manual mode: nothing on page load, one collect per action.
        window.DeepvueImprint.config({ apiKey: cfg.sdkKey, autoCollectOnLoad: false });
        resolve(window.DeepvueImprint);
      };
      s.onerror = () => reject(new DemoError(BLOCKED));
      document.head.appendChild(s);
    });
  }

  const BLOCKED = "Your browser blocked the Deepvue script, usually an ad or privacy blocker. Allow it on this page and try again.";

  function failureText(res, err) {
    if (err instanceof DemoError) return err.message;
    const raw = String((res && res._error) || (err && err.message) || "");
    const status = Number((raw.match(/\b([45]\d\d)\b/) || [])[1]);
    if (status === 401 || status === 403) return `Deepvue refused this demo's SDK key (HTTP ${status}).`;
    if (status === 402) return "The demo account is out of credit (HTTP 402). Please try again later.";
    if (status === 429) return "Too many checks from this demo right now (HTTP 429). Try again in a minute.";
    return `The device check didn't go through${status ? ` (HTTP ${status})` : ""}. Try again.`;
  }

  function showSimulateNotice(hasKey) {
    const box = $("notice");
    box.hidden = false;
    const text = document.createElement("span");
    text.textContent = hasKey
      ? "Simulated responses (?mock in the URL). Remove it to run the real SDK."
      : "This server has no SDK key, so Deepvue's responses are simulated.";
    const label = document.createElement("label");
    label.className = "small";
    label.textContent = "Simulate ";
    const select = document.createElement("select");
    select.id = "simulate";
    for (const [value, name] of [
      ["normal", "a normal visit"],
      ["vpn", "a VPN and data-centre IP"],
      ["bot", "a bot"],
    ]) {
      select.append(new Option(name, value));
    }
    select.addEventListener("change", () => (window.DeepvueImprintMock.scenario = select.value));
    label.append(select);
    box.replaceChildren(text, label);
  }

  /* ---------- rendering ---------- */

  function mountShared(form) {
    const busy = el("div", { id: "busy", className: "loading", hidden: true });
    busy.append(el("span", { className: "spinner", ariaHidden: "true" }), el("span", { textContent: "Checking this device…" }));
    const outcome = el("div", { id: "outcome", className: "outcome", hidden: true });
    outcome.setAttribute("aria-live", "polite");
    outcome.append(el("h3"), el("p"));
    form.after(busy, outcome);

    $("shared").innerHTML = `
      <section class="card">
        <div class="card-head">
          <h2>What your backend sees</h2>
          <button id="forget" class="btn btn-ghost btn-sm" type="button" disabled>Forget this device</button>
        </div>
        <p class="empty" id="backend-empty">Submit the form. Your server's view of the request shows up here.</p>
        <div id="backend" hidden>
          <dl class="facts">
            <div><dt>Device ID</dt><dd><code id="b-device"></code></dd></div>
            <div><dt>Deepvue verdict</dt><dd><span class="pill" id="b-verdict"></span></dd></div>
            <div><dt>Seen by Deepvue</dt><dd id="b-seen"></dd></div>
          </dl>
          <h3 class="sub">Checks your server ran</h3>
          <ul class="checks" id="b-checks"></ul>
          <h3 class="sub">This device on your server</h3>
          <ul class="history" id="b-history"></ul>
          <details class="raw">
            <summary>Request body your server received</summary>
            <pre class="code" id="b-raw"></pre>
          </details>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2>The code</h2>
          <div class="tabs" role="tablist">
            <button type="button" role="tab" id="tab-browser" aria-selected="true">Browser</button>
            <button type="button" role="tab" id="tab-server" aria-selected="false">Server</button>
          </div>
        </div>
        <p class="muted small" id="note-browser">Runs when the user presses the button: one collect per action, then the form goes to your server with the result.</p>
        <p class="muted small" id="note-server" hidden>The rule that just ran, from <code>rules.js</code>. This demo trusts the device ID the browser sends. In production, look the visit up on your server by its request ID; the README shows how.</p>
        <pre class="code" id="code-browser"></pre>
        <pre class="code" id="code-server" hidden></pre>
      </section>`;

    for (const name of ["browser", "server"]) {
      $(`tab-${name}`).addEventListener("click", () => {
        for (const other of ["browser", "server"]) {
          const on = other === name;
          $(`tab-${other}`).setAttribute("aria-selected", String(on));
          $(`code-${other}`).hidden = !on;
          $(`note-${other}`).hidden = !on;
        }
      });
    }
  }

  function setBusy(form, busy) {
    for (const b of form.querySelectorAll("button")) b.disabled = busy;
    $("busy").hidden = !busy;
    if (busy) $("outcome").hidden = true;
  }

  function renderOutcome(outcome, errorText) {
    const box = $("outcome");
    box.hidden = false;
    box.dataset.tone = outcome ? outcome.tone : "bad";
    box.querySelector("h3").textContent = outcome ? outcome.title : "Something went wrong";
    box.querySelector("p").textContent = outcome ? outcome.text : errorText;
  }

  function renderBackend(body, reply) {
    $("backend-empty").hidden = true;
    $("backend").hidden = false;
    $("forget").disabled = false;

    const v = reply.visit;
    $("b-device").textContent = v.deviceId;
    const verdict = VERDICTS[v.action] || { label: v.action, tone: "" };
    $("b-verdict").textContent = verdict.label;
    $("b-verdict").dataset.tone = verdict.tone;
    $("b-seen").textContent = v.isNewDevice ? "First visit" : `${v.seenCount} ${v.seenCount === 1 ? "time" : "times"}`;

    $("b-checks").replaceChildren(
      ...reply.checks.map((c) => {
        const li = el("li", { className: "check", dataset: { state: c.found ? "found" : "clear" } });
        const head = el("div", { className: "check-head" });
        head.append(
          el("span", { className: "dot", ariaHidden: "true" }),
          el("span", { className: "check-label", textContent: c.label }),
          el("span", { className: "check-state", textContent: c.found ? "Found" : "Clear" })
        );
        li.append(head, el("p", { className: "check-desc", textContent: c.detail }));
        return li;
      })
    );

    $("b-history").replaceChildren(
      ...reply.history.map((h) => {
        const li = el("li");
        const result = el("div", { className: "result" });
        result.append(el("span", { className: "pill pill-sm", dataset: { tone: h.tone }, textContent: h.title }));
        li.append(el("span", { className: "when", textContent: time(h.at) }), el("span", { className: "what", textContent: h.summary }), result);
        return li;
      })
    );

    $("b-raw").textContent = JSON.stringify(body, (k, val) => (k === "password" ? "••••••" : val), 2);
  }

  function browserSnippet(cfg, opts) {
    return [
      `<script src="${cfg.sdkUrl}"></script>`,
      "<script>",
      `  DeepvueImprint.config({ apiKey: "YOUR_SDK_KEY", autoCollectOnLoad: false });`,
      "</script>",
      "",
      `// When the user presses "${opts.actionLabel}":`,
      "const result = await DeepvueImprint.collect({",
      `  linkedId: ${opts.linkedIdName}, // your own ID for this action`,
      `  tag: { flow: "${opts.flow}" },`,
      "});",
      "if (result._error) return showRetry(); // no verdict: network or key problem",
      "",
      "// Your server decides, using the device ID and verdict.",
      `const reply = await fetch("/api/${opts.demo}", {`,
      '  method: "POST",',
      '  headers: { "Content-Type": "application/json" },',
      "  body: JSON.stringify({",
      "    visit: {",
      "      request_id: result._meta.request_id,",
      "      identity: result.identity, // device_id, seen_count, is_new_device",
      "      risk: result.risk,         // action, signals, automation_status",
      "      network: result.network,   // is_vpn, is_proxy, is_tor, geo_mismatch_detected",
      "    },",
      "    input: formValues,",
      "  }),",
      "}).then((r) => r.json());",
    ].join("\n");
  }

  /* ---------- helpers ---------- */

  async function post(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new DemoError(`The demo server refused the request (HTTP ${r.status}${data.field ? `, ${data.field}` : ""}).`);
    return data;
  }

  function DemoError(message) {
    this.message = message;
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

  function time(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // Shared by the pages for linkedId values such as LN-7F3A9C.
  window.Demo.ref = (prefix) => `${prefix}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
})();
