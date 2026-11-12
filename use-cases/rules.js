// The decisions each demo makes on your server. Each rule takes the visit
// Deepvue returned, the form input and this device's earlier events (oldest
// first), and returns the outcome, every check it ran, and the event to keep.
// The pages show this source as "the code that just ran".

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function isBot(visit) {
  const botSignals = ["bot_detected", "headless_detected", "automation_framework_detected"];
  return visit.automationStatus === "detected" || visit.signals.some((s) => botSignals.includes(s));
}

// Hidden or rented networks. Common on their own, so they ask for a second
// look rather than a refusal.
function networkRisks(visit) {
  const n = visit.network;
  const has = (code) => visit.signals.includes(code);
  return [
    (n.isVpn || has("vpn_detected")) && "VPN",
    (n.isProxy || has("proxy_detected") || has("residential_proxy_detected")) && "proxy",
    (n.isTor || has("tor_detected")) && "Tor",
    has("datacenter_ip_detected") && "data-centre IP",
    (n.geoMismatch || has("geo_mismatch_detected")) && "time zone doesn't match the IP",
  ].filter(Boolean);
}

function check(label, found, detail) {
  return { label, found: Boolean(found), detail };
}

/* ---------- Loan application ---------- */

function loan(visit, application, history, now) {
  const earlier = history.filter((e) => now - e.at < 24 * HOUR);
  const changed = earlier.filter(
    (e) =>
      e.income !== application.income ||
      e.employment !== application.employment ||
      e.existingEmi !== application.existingEmi
  );
  const risks = networkRisks(visit);

  const checks = [
    check("Bot, or Deepvue says block", isBot(visit) || visit.action === "block", `Deepvue verdict: ${visit.action}`),
    check(
      "Earlier application from this device with different income, job or EMIs (24 h)",
      changed.length > 0,
      `${earlier.length} earlier from this device, ${changed.length} with different details`
    ),
    check(
      "VPN, proxy, Tor or data-centre IP, or Deepvue says review",
      risks.length > 0 || visit.action === "review",
      risks.length ? risks.join(", ") : `Deepvue verdict: ${visit.action}`
    ),
  ];

  let outcome;
  if (checks[0].found) {
    outcome = { tone: "bad", title: "Application declined", text: "This request looks automated." };
  } else if (checks[1].found) {
    outcome = {
      tone: "bad",
      title: "Application declined",
      text: `This device already applied ${earlier.length === 1 ? "once" : `${earlier.length} times`} in the last 24 hours with different applicant details. Sent to the fraud team.`,
    };
  } else if (checks[2].found) {
    outcome = {
      tone: "warn",
      title: "We need one more step",
      text: "Before an offer, verify your income with a bank statement.",
    };
  } else {
    outcome = {
      tone: "ok",
      title: "You're pre-approved",
      text: `${rupees(application.amount)} over ${application.tenure} months, subject to KYC.`,
    };
  }

  return { outcome, checks, record: { ...application, summary: describeLoan(application) } };
}

function describeLoan(a) {
  return `${rupees(a.amount)}, income ${rupees(a.income)}/month, ${a.employment.replace("_", "-")}, EMIs ${rupees(a.existingEmi)}`;
}

/* ---------- Referral cashback ---------- */

function referral(visit, signup, history, now) {
  const accounts = history.filter((e) => e.accountId && now - e.at < 24 * HOUR);
  const risks = networkRisks(visit);

  const checks = [
    check("Bot, or Deepvue says block", isBot(visit) || visit.action === "block", `Deepvue verdict: ${visit.action}`),
    check(
      "Accounts already opened from this device (24 h)",
      accounts.length > 0,
      accounts.length ? accounts.map((e) => e.accountId).join(", ") : "None"
    ),
    check(
      "VPN, proxy, Tor or data-centre IP, or Deepvue says review",
      risks.length > 0 || visit.action === "review",
      risks.length ? risks.join(", ") : `Deepvue verdict: ${visit.action}`
    ),
  ];

  if (checks[0].found) {
    return {
      outcome: { tone: "bad", title: "Sign-up stopped", text: "This request looks automated." },
      checks,
      record: { summary: `${signup.mobileMasked}, code ${signup.code}, refused` },
    };
  }

  const accountId = signup.newAccountId;
  let outcome;
  if (checks[1].found) {
    outcome = {
      tone: "bad",
      title: "Account opened, no cashback",
      text: `Cashback is one per device. This device has already opened ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}.`,
    };
  } else if (checks[2].found) {
    outcome = { tone: "warn", title: "Cashback on hold", text: "Your ₹100 is credited after a quick review." };
  } else {
    outcome = { tone: "ok", title: "₹100 cashback credited", text: `Welcome! Your account is ${accountId}.` };
  }
  return { outcome, checks, record: { accountId, summary: `${accountId}, ${signup.mobileMasked}, code ${signup.code}` } };
}

/* ---------- OTP / SMS pumping ---------- */

function otp(visit, request, history, now) {
  const recent = history.filter((e) => now - e.at < 15 * MIN);
  const numbers = new Set([...recent.map((e) => e.phoneKey), request.phoneKey]);
  const risks = networkRisks(visit);

  const checks = [
    check("Bot, or Deepvue says block", isBot(visit) || visit.action === "block", `Deepvue verdict: ${visit.action}`),
    check(
      "3 or more OTP requests from this device in 15 min",
      recent.length >= 3,
      `${recent.length} earlier ${recent.length === 1 ? "request" : "requests"}`
    ),
    check("More than 2 phone numbers from this device in 15 min", numbers.size > 2, `${numbers.size} including this one`),
    check(
      "VPN, proxy, Tor or data-centre IP, or Deepvue says review",
      risks.length > 0 || visit.action === "review",
      risks.length ? risks.join(", ") : `Deepvue verdict: ${visit.action}`
    ),
  ];

  let outcome;
  if (checks[0].found) {
    outcome = { tone: "bad", title: "No OTP sent", text: "This request looks automated." };
  } else if (checks[2].found) {
    outcome = { tone: "bad", title: "No OTP sent", text: "Too many phone numbers from this device. This is what SMS pumping looks like." };
  } else if (checks[1].found) {
    const wait = Math.max(1, Math.ceil((recent[0].at + 15 * MIN - now) / MIN));
    outcome = { tone: "bad", title: "Too many requests", text: `Try again in ${wait} min.` };
  } else if (checks[3].found) {
    outcome = { tone: "warn", title: "Solve a challenge first", text: "We'd show a puzzle before sending the SMS." };
  } else {
    outcome = { tone: "ok", title: "OTP sent", text: `Sent to ${request.phoneMasked}. (Not really: this is a demo.)` };
  }

  return {
    outcome,
    checks,
    record: { phoneKey: request.phoneKey, sent: outcome.tone === "ok", summary: request.phoneMasked },
  };
}

/* ---------- Login / credential stuffing ---------- */

const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "deepvue-demo";

function login(visit, attempt, history, now) {
  const failures = history.filter((e) => !e.passwordOk && now - e.at < 15 * MIN);
  const usernames = new Set(failures.map((e) => e.userKey));
  const known = history.some((e) => e.signedIn);
  const passwordOk = attempt.username === DEMO_USERNAME && attempt.password === DEMO_PASSWORD;
  const risks = networkRisks(visit);

  const checks = [
    check("Bot, or Deepvue says block", isBot(visit) || visit.action === "block", `Deepvue verdict: ${visit.action}`),
    check(
      "5 failed sign-ins or 3 usernames from this device in 15 min",
      failures.length >= 5 || usernames.size >= 3,
      `${failures.length} failed, ${usernames.size} ${usernames.size === 1 ? "username" : "usernames"}`
    ),
    check("Wrong username or password", !passwordOk, passwordOk ? "Password matches" : "No match"),
    check(
      "New device for this account, risky network, or Deepvue says review",
      !known || risks.length > 0 || visit.action === "review",
      [!known && "first sign-in from this device", ...risks, visit.action === "review" && "verdict review"]
        .filter(Boolean)
        .join(", ") || "Known device"
    ),
  ];

  let outcome;
  let signedIn = false;
  if (checks[0].found) {
    outcome = { tone: "bad", title: "Sign-in blocked", text: "This request looks automated." };
  } else if (checks[1].found) {
    outcome = {
      tone: "bad",
      title: "Sign-in blocked",
      text: "Too many failed sign-ins from this device, even with the right password. This is what credential stuffing looks like.",
    };
  } else if (checks[2].found) {
    outcome = { tone: "warn", title: "Wrong username or password", text: "Check them and try again." };
  } else if (checks[3].found) {
    signedIn = true;
    outcome = {
      tone: "warn",
      title: "Enter the OTP we sent",
      text: "New or risky device, so we'd ask for an OTP. This demo skips it and remembers the device.",
    };
  } else {
    signedIn = true;
    outcome = { tone: "ok", title: "Signed in", text: "Known device, nothing unusual. No OTP needed." };
  }

  return {
    outcome,
    checks,
    record: { userKey: attempt.userKey, passwordOk, signedIn, summary: `${attempt.userMasked}, ${passwordOk ? "right" : "wrong"} password` },
  };
}

/* ---------- helpers ---------- */

function rupees(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}

export const DEMOS = {
  loan: { run: loan, source: [isBot, networkRisks, loan] },
  referral: { run: referral, source: [isBot, networkRisks, referral] },
  otp: { run: otp, source: [isBot, networkRisks, otp] },
  login: { run: login, source: [isBot, networkRisks, login] },
};

export const DEMO_LOGIN = { username: DEMO_USERNAME, password: DEMO_PASSWORD };
