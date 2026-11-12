// Simulated collect() responses, used when the server has no SDK key or the
// URL has ?mock. Same shape as the web SDK's response. The device ID comes from
// stable browser traits, so like the real one it survives a private window.
(function () {
  "use strict";

  const SCENARIOS = {
    normal: { action: "allow", level: "low", signals: [], network: {} },
    vpn: {
      action: "review",
      level: "medium",
      signals: ["vpn_detected", "datacenter_ip_detected", "geo_mismatch_detected"],
      network: { is_vpn: true, geo_mismatch_detected: true },
    },
    bot: {
      action: "block",
      level: "high",
      signals: ["bot_detected", "headless_detected", "automation_framework_detected"],
      automation_status: "detected",
      automation_score: 0.94,
      network: {},
    },
  };

  function deviceId() {
    const traits = [navigator.userAgent, screen.width, screen.height, screen.colorDepth, navigator.hardwareConcurrency, Intl.DateTimeFormat().resolvedOptions().timeZone].join("|");
    return "vid_" + fnv(traits, 0x811c9dc5) + fnv(traits, 0x01000193);
  }

  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  }

  function seenCount(id) {
    try {
      const n = Number(localStorage.getItem("dv_demo_seen_" + id) || 0) + 1;
      localStorage.setItem("dv_demo_seen_" + id, String(n));
      return n;
    } catch (_) {
      return 1;
    }
  }

  window.DeepvueImprintMock = {
    scenario: "normal",
    config() {},
    async collect() {
      await new Promise((r) => setTimeout(r, 450));
      const s = SCENARIOS[this.scenario] || SCENARIOS.normal;
      const id = deviceId();
      const seen = seenCount(id);
      return {
        _meta: { request_id: "req_sim_" + Math.random().toString(16).slice(2, 14), success: true, channel: "web", simulated: true },
        risk: {
          action: s.action,
          risk_level: s.level,
          automation_score: s.automation_score || 0,
          automation_status: s.automation_status || "not_detected",
          platform: "web",
          signals: s.signals.slice(),
        },
        identity: { device_id: id, is_new_device: seen === 1, seen_count: seen },
        network: Object.assign({ is_vpn: false, is_proxy: false, is_tor: false, geo_mismatch_detected: false }, s.network),
      };
    },
  };
})();
