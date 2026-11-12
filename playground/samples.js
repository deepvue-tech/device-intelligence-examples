// Sample collect() responses for ?sample=allow|review|block|error, so the page
// can be previewed and recorded without sending a collect. Same shape as the
// web SDK's collect() response.
(function () {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace("Z", ""); // the API sends UTC with no suffix
  const meta = (id) => ({
    request_id: id,
    success: true,
    schema_version: "v2.1",
    channel: "web",
    sdk_version: "deepvue-imprint/3.2.3",
    collect_time_ms: 612,
    processing_time_ms: 41.7,
  });
  const base = (risk, identity, network) => ({
    _meta: meta(risk.request_id),
    risk: {
      action: risk.action,
      risk_level: risk.level,
      automation_score: risk.automation_score || 0,
      platform: "web",
      automation_status: risk.automation_status || "not_detected",
      attestation_status: "not_applicable",
      identifier_strength: "not_applicable",
      signals: risk.signals,
    },
    identity,
    network: Object.assign({ is_vpn: false, is_proxy: false, is_tor: false, geo_mismatch_detected: false }, network),
    attestation: { provider: null, status: "not_applicable", verified: null },
    compliance: { purpose: "fraud_prevention", decision_type: "assistive", is_final_decision: false },
  });

  window.PLAYGROUND_SAMPLES = {
    allow: base(
      { request_id: "req_sample_allow", action: "allow", level: "low", signals: [] },
      {
        device_id: "vid_7f3a91c2e04b4d8a",
        device_profile_id: "fp_2c81d0aa",
        is_new_device: false,
        seen_count: 6,
        matched_on: "confidence_resolution",
        lifecycle: { first_seen: hoursAgo(52), last_seen: hoursAgo(0) },
      },
      {}
    ),
    review: base(
      {
        request_id: "req_sample_review",
        action: "review",
        level: "medium",
        signals: ["vpn_detected", "datacenter_ip_detected", "geo_mismatch_detected", "incognito_detected"],
      },
      {
        device_id: "vid_7f3a91c2e04b4d8a",
        device_profile_id: "fp_2c81d0aa",
        is_new_device: false,
        seen_count: 7,
        matched_on: "fuzzy_core_weighted",
        lifecycle: { first_seen: hoursAgo(52), last_seen: hoursAgo(0) },
      },
      { is_vpn: true, geo_mismatch_detected: true }
    ),
    block: base(
      {
        request_id: "req_sample_block",
        action: "block",
        level: "high",
        automation_score: 0.94,
        automation_status: "detected",
        signals: ["bot_detected", "headless_detected", "automation_framework_detected", "devtools_detected", "tor_detected"],
      },
      {
        device_id: "vid_c01d5e7b9a2f4413",
        device_profile_id: "fp_91be0c3d",
        is_new_device: true,
        seen_count: 1,
        matched_on: null,
        lifecycle: { first_seen: hoursAgo(0), last_seen: hoursAgo(0) },
      },
      { is_tor: true }
    ),
    error: { _channel: "web", _error: "Error: DeepvueImprint: Server returned 402" },
  };
})();
