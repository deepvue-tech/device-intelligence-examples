// Demo server: serves the pages in public/ and runs each demo's rules
// against per-device history. No dependencies; Node 20 or later.

import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOS } from "./rules.js";
import * as store from "./store.js";

const PORT = Number(process.env.PORT ?? 8080);
const SDK_KEY = process.env.DEEPVUE_SDK_KEY || "";
const SDK_URL = process.env.DEEPVUE_SDK_URL || "https://d37t6u7aogmv50.cloudfront.net/v3.2.3/dist/deepvue-imprint.min.js";
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const MAX_BODY = 16 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

class InputError extends Error {
  constructor(field, status = 400) {
    super(field);
    this.field = field;
    this.status = status;
  }
}

/* ---------- reading the request ---------- */

// Demo only: trusts the device ID and verdict the browser sends. In production,
// look the visit up on your server by request_id instead (see README).
function readVisit(v) {
  if (!v || typeof v !== "object") throw new InputError("visit");
  const identity = v.identity || {};
  const risk = v.risk || {};
  const network = v.network || {};
  const deviceId = readDeviceId(identity.device_id, "visit.identity.device_id");
  if (!["allow", "review", "block"].includes(risk.action)) throw new InputError("visit.risk.action");
  return {
    requestId: typeof v.request_id === "string" ? v.request_id.slice(0, 80) : null,
    deviceId,
    action: risk.action,
    signals: Array.isArray(risk.signals) ? risk.signals.filter((s) => typeof s === "string").slice(0, 50) : [],
    automationStatus: typeof risk.automation_status === "string" ? risk.automation_status : "",
    seenCount: Number(identity.seen_count) || 0,
    isNewDevice: identity.is_new_device === true,
    network: {
      isVpn: network.is_vpn === true,
      isProxy: network.is_proxy === true,
      isTor: network.is_tor === true,
      geoMismatch: network.geo_mismatch_detected === true,
    },
  };
}

function readDeviceId(v, field) {
  const id = String(v || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new InputError(field);
  return id;
}

// Form input per demo. Phone numbers and usernames are kept only as a hash
// (to count distinct ones) and a masked label.
const INPUTS = {
  loan(i) {
    return {
      amount: int(i.amount, "amount", 10000, 5000000),
      tenure: oneOf(Number(i.tenure), [6, 12, 24, 36, 48, 60], "tenure"),
      income: int(i.income, "income", 0, 5000000),
      employment: oneOf(i.employment, ["salaried", "self_employed", "student"], "employment"),
      existingEmi: int(i.existingEmi, "existingEmi", 0, 5000000),
    };
  },
  referral(i) {
    const mobile = phone(i.mobile);
    const code = String(i.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) throw new InputError("code");
    return { code, mobileMasked: maskPhone(mobile), newAccountId: "acct_" + randomBytes(3).toString("hex") };
  },
  otp(i) {
    const mobile = phone(i.mobile);
    return { phoneKey: hash(mobile), phoneMasked: maskPhone(mobile) };
  },
  login(i) {
    const username = String(i.username || "").trim().toLowerCase();
    const password = String(i.password || "");
    if (!username || username.length > 64) throw new InputError("username");
    if (password.length > 128) throw new InputError("password");
    return { username, password, userKey: hash(username), userMasked: username.slice(0, 2) + "•••" };
  },
};

function int(v, field, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(field);
  return n;
}

function oneOf(v, allowed, field) {
  if (!allowed.includes(v)) throw new InputError(field);
  return v;
}

function phone(v) {
  const digits = String(v || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) throw new InputError("mobile");
  return digits;
}

function maskPhone(digits) {
  return `+91 ••••• •••${digits.slice(-2)}`;
}

function hash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/* ---------- routes ---------- */

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");
  const isGet = req.method === "GET" || req.method === "HEAD";

  if (isGet && pathname === "/healthz") return json(res, 200, { status: "ok" });

  if (isGet && pathname === "/api/config") {
    return json(res, 200, { sdkUrl: SDK_URL, sdkKey: SDK_KEY || null });
  }

  const source = pathname.match(/^\/api\/rules\/([a-z]+)$/);
  if (isGet && source && DEMOS[source[1]]) {
    return send(res, 200, DEMOS[source[1]].source.map(String).join("\n\n") + "\n", TYPES[".js"]);
  }

  if (req.method === "POST" && pathname === "/api/forget") {
    const body = await readJson(req);
    if (!DEMOS[body.demo]) throw new InputError("demo");
    store.forget(body.demo, readDeviceId(body.deviceId, "deviceId"));
    return json(res, 200, { forgotten: true });
  }

  const demo = pathname.match(/^\/api\/([a-z]+)$/);
  if (req.method === "POST" && demo && DEMOS[demo[1]]) {
    const name = demo[1];
    const body = await readJson(req);
    const visit = readVisit(body.visit);
    const input = INPUTS[name](body.input || {});
    const now = Date.now();
    const history = store.list(name, visit.deviceId, now);
    const { outcome, checks, record } = DEMOS[name].run(visit, input, history, now);
    store.add(name, visit.deviceId, { ...record, at: now, requestId: visit.requestId, action: visit.action, tone: outcome.tone, title: outcome.title });
    const shown = store
      .list(name, visit.deviceId, now)
      .reverse()
      .slice(0, 10)
      .map((e) => ({ at: new Date(e.at).toISOString(), summary: e.summary, tone: e.tone, title: e.title, action: e.action }));
    return json(res, 200, { outcome, checks, history: shown, visit });
  }

  if (isGet && !pathname.startsWith("/api/")) return serveStatic(pathname, req, res);
  return json(res, 404, { error: "not_found" });
}

async function serveStatic(pathname, req, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return json(res, 400, { error: "bad_path" });
  }
  if (!extname(rel)) rel += ".html";
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !TYPES[extname(file)]) return json(res, 404, { error: "not_found" });
  let data;
  try {
    data = await readFile(file);
  } catch {
    return json(res, 404, { error: "not_found" });
  }
  return send(res, 200, req.method === "HEAD" ? "" : data, TYPES[extname(file)]);
}

/* ---------- plumbing ---------- */

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new InputError("body_too_large", 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") || {});
      } catch {
        reject(new InputError("json"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent || res.destroyed) return;
    if (err instanceof InputError) return json(res, err.status, { error: "invalid_input", field: err.field });
    console.error(err);
    json(res, 500, { error: "internal" });
  });
});

server.listen(PORT, () => {
  console.log(`Use-case demos on http://localhost:${server.address().port} (${SDK_KEY ? "live SDK key" : "no SDK key: simulated responses"})`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
