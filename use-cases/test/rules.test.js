import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMOS, DEMO_LOGIN } from "../rules.js";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const MIN = 60 * 1000;

function visit(over = {}) {
  return {
    requestId: "req_1",
    deviceId: "vid_test",
    action: "allow",
    signals: [],
    automationStatus: "not_detected",
    seenCount: 3,
    isNewDevice: false,
    network: { isVpn: false, isProxy: false, isTor: false, geoMismatch: false },
    ...over,
  };
}
const VPN = visit({ action: "review", signals: ["vpn_detected", "datacenter_ip_detected"], network: { isVpn: true, isProxy: false, isTor: false, geoMismatch: false } });
const BOT = visit({ action: "block", signals: ["headless_detected"], automationStatus: "detected" });

// Runs a demo the way the server does: each event is stored for the next call.
function session(name) {
  const history = [];
  return (v, input, at = NOW) => {
    const r = DEMOS[name].run(v, input, history.slice(), at);
    history.push({ ...r.record, at });
    return r;
  };
}

const APP = { amount: 300000, tenure: 36, income: 45000, employment: "salaried", existingEmi: 5000 };

test("loan: first application is pre-approved", () => {
  const r = session("loan")(visit(), APP);
  assert.equal(r.outcome.tone, "ok");
  assert.ok(r.checks.every((c) => !c.found));
});

test("loan: same device with a higher income is declined", () => {
  const apply = session("loan");
  apply(visit(), APP);
  const r = apply(visit(), { ...APP, income: 90000 }, NOW + MIN);
  assert.equal(r.outcome.title, "Application declined");
  assert.ok(r.checks[1].found);
});

test("loan: a changed amount or tenure alone is not flagged", () => {
  const apply = session("loan");
  apply(visit(), APP);
  const r = apply(visit(), { ...APP, amount: 200000, tenure: 24 }, NOW + MIN);
  assert.equal(r.outcome.tone, "ok");
});

test("loan: applications older than 24 h don't count", () => {
  const apply = session("loan");
  apply(visit(), APP);
  const r = apply(visit(), { ...APP, income: 90000 }, NOW + 25 * 60 * MIN);
  assert.equal(r.outcome.tone, "ok");
});

test("loan: VPN asks for a step, bot is declined", () => {
  assert.equal(session("loan")(VPN, APP).outcome.tone, "warn");
  assert.equal(session("loan")(BOT, APP).outcome.tone, "bad");
});

const SIGNUP = (n) => ({ code: "ASHA100", mobileMasked: `+91 ••••• •••${n}`, newAccountId: `acct_00000${n}` });

test("referral: cashback once per device", () => {
  const signUp = session("referral");
  assert.equal(signUp(visit(), SIGNUP(1)).outcome.title, "₹100 cashback credited");
  const second = signUp(visit(), SIGNUP(2), NOW + MIN);
  assert.equal(second.outcome.title, "Account opened, no cashback");
  assert.match(second.checks[1].detail, /acct_000001/);
});

test("referral: VPN holds the cashback, bot opens no account", () => {
  assert.equal(session("referral")(VPN, SIGNUP(1)).outcome.title, "Cashback on hold");
  const bot = session("referral")(BOT, SIGNUP(1));
  assert.equal(bot.outcome.title, "Sign-up stopped");
  assert.equal(bot.record.accountId, undefined);
});

const OTP = (n) => ({ phoneKey: `k${n}`, phoneMasked: `+91 ••••• •••${n}` });

test("otp: the fourth request in 15 min is refused", () => {
  const send = session("otp");
  for (let i = 0; i < 3; i++) assert.equal(send(visit(), OTP(1), NOW + i * MIN).outcome.title, "OTP sent");
  assert.equal(send(visit(), OTP(1), NOW + 3 * MIN).outcome.title, "Too many requests");
  assert.equal(send(visit(), OTP(1), NOW + 20 * MIN).outcome.title, "OTP sent");
});

test("otp: a third number from one device is refused", () => {
  const send = session("otp");
  send(visit(), OTP(1));
  send(visit(), OTP(2), NOW + MIN);
  const r = send(visit(), OTP(3), NOW + 2 * MIN);
  assert.equal(r.outcome.title, "No OTP sent");
  assert.ok(r.checks[2].found);
});

test("otp: bots get nothing, VPN gets a challenge", () => {
  assert.equal(session("otp")(BOT, OTP(1)).outcome.title, "No OTP sent");
  assert.equal(session("otp")(VPN, OTP(1)).outcome.title, "Solve a challenge first");
});

const LOGIN = (username, password) => ({ username, password, userKey: `u_${username}`, userMasked: username.slice(0, 2) + "•••" });
const RIGHT = LOGIN(DEMO_LOGIN.username, DEMO_LOGIN.password);

test("login: new device steps up, then is known", () => {
  const signIn = session("login");
  assert.equal(signIn(visit(), RIGHT).outcome.title, "Enter the OTP we sent");
  assert.equal(signIn(visit(), RIGHT, NOW + MIN).outcome.title, "Signed in");
});

test("login: three usernames failing from one device blocks even the right password", () => {
  const signIn = session("login");
  for (const u of ["alice", "bob", "carol"]) {
    assert.equal(signIn(visit(), LOGIN(u, "x"), NOW).outcome.title, "Wrong username or password");
  }
  const r = signIn(visit(), RIGHT, NOW + MIN);
  assert.equal(r.outcome.title, "Sign-in blocked");
  assert.ok(r.checks[1].found);
});

test("login: VPN on a known device still steps up; bots are blocked", () => {
  const signIn = session("login");
  signIn(visit(), RIGHT);
  assert.equal(signIn(VPN, RIGHT, NOW + MIN).outcome.title, "Enter the OTP we sent");
  assert.equal(session("login")(BOT, RIGHT).outcome.title, "Sign-in blocked");
});
