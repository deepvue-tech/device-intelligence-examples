import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let child;
let base;

before(async () => {
  const env = { ...process.env, PORT: "0" };
  delete env.DEEPVUE_SDK_KEY;
  child = spawn(process.execPath, [fileURLToPath(new URL("../server.js", import.meta.url))], { env });
  base = await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      const m = String(d).match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(() => child.kill());

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const visit = (deviceId, over = {}) => ({
  request_id: "req_t",
  identity: { device_id: deviceId, seen_count: 2, is_new_device: false },
  risk: { action: "allow", signals: [], automation_status: "not_detected" },
  network: { is_vpn: false, is_proxy: false, is_tor: false, geo_mismatch_detected: false },
  ...over,
});

const APP = { amount: 300000, tenure: 36, income: 45000, employment: "salaried", existingEmi: 5000 };

test("serves pages, config and rule source", async () => {
  for (const path of ["/", "/loan", "/referral", "/otp", "/login", "/style.css", "/demo.js"]) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  assert.deepEqual(await (await fetch(base + "/api/config")).json(), {
    sdkUrl: "https://d37t6u7aogmv50.cloudfront.net/v3.2.3/dist/deepvue-imprint.min.js",
    sdkKey: null,
  });
  assert.match(await (await fetch(base + "/api/rules/loan")).text(), /function loan\(/);
});

test("doesn't serve files outside public/", async () => {
  for (const path of ["/%2e%2e/server.js", "/..%2fserver.js", "/package.json"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test("loan: state survives across requests from one device, and forget clears it", async () => {
  const first = await (await post("/api/loan", { visit: visit("vid_srv1"), input: APP })).json();
  assert.equal(first.outcome.tone, "ok");
  const second = await (await post("/api/loan", { visit: visit("vid_srv1"), input: { ...APP, income: 90000 } })).json();
  assert.equal(second.outcome.title, "Application declined");
  assert.equal(second.history.length, 2);

  const other = await (await post("/api/loan", { visit: visit("vid_srv2"), input: { ...APP, income: 90000 } })).json();
  assert.equal(other.outcome.tone, "ok", "another device has its own history");

  assert.equal((await post("/api/forget", { demo: "loan", deviceId: "vid_srv1" })).status, 200);
  const again = await (await post("/api/loan", { visit: visit("vid_srv1"), input: { ...APP, income: 90000 } })).json();
  assert.equal(again.outcome.tone, "ok");
});

test("phone numbers and usernames come back masked only", async () => {
  const r = await (await post("/api/otp", { visit: visit("vid_srv3"), input: { mobile: "9876543210" } })).json();
  assert.equal(r.outcome.title, "OTP sent");
  assert.ok(!JSON.stringify(r).includes("9876543210"));
  const l = await (await post("/api/login", { visit: visit("vid_srv3"), input: { username: "someone@example.com", password: "x" } })).json();
  assert.ok(!JSON.stringify(l).includes("someone@example.com"));
});

test("rejects bad input", async () => {
  assert.equal((await post("/api/loan", { visit: visit("bad id!"), input: APP })).status, 400);
  assert.equal((await post("/api/loan", { visit: visit("vid_x", { risk: { action: "maybe" } }), input: APP })).status, 400);
  assert.equal((await post("/api/loan", { visit: visit("vid_x"), input: { ...APP, tenure: 7 } })).status, 400);
  assert.equal((await post("/api/otp", { visit: visit("vid_x"), input: { mobile: "12345" } })).status, 400);
  assert.equal((await post("/api/nope", {})).status, 404);
  const big = await fetch(base + "/api/loan", { method: "POST", body: "x".repeat(20000) }).catch(() => null);
  assert.ok(!big || big.status === 413);
});
