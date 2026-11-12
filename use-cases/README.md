# Fraud use-case demos

Four fake apps for lenders and fintechs, each with a fraud attempt you can try yourself and the
check that catches it. Each page runs the Deepvue web SDK, sends the result to a small server, and
shows **what your backend sees** and **the code** that made the decision.

| Demo | The fraud | What the server checks |
| --- | --- | --- |
| [Loan application](public/loan.html) | Declined applicants reapply from the same phone with a higher income or a different job. | An earlier application from this device in 24 h with different income, employment or EMIs: decline. VPN, proxy, Tor, data-centre IP or a `review` verdict: ask for a bank statement. |
| [Referral cashback](public/referral.html) | One person opens account after account with fresh mobile numbers to farm the sign-up cashback. | Accounts already opened from this device: open the account, hold back the cashback. Risky network: cashback on hold. |
| [OTP and SMS pumping](public/otp.html) | Scripts request OTPs to premium-rate numbers, and you pay for every SMS. | 3 or more requests, or more than 2 numbers, from this device in 15 min: no SMS. Bots: no SMS. Risky network: challenge first. |
| [Sign-in](public/login.html) | Leaked username and password pairs replayed one account after another. | 5 failures or 3 usernames from this device in 15 min: blocked, even with the right password. New device or risky network: OTP. |

Every demo refuses bots and Deepvue `block` verdicts first. The device ID survives private windows
and cleared cookies, so opening a private window halfway through doesn't start you over.

## Run it

Node 20 or later, no dependencies:

```bash
cd use-cases
DEEPVUE_SDK_KEY=<your SDK key> npm start
```

Open <http://localhost:8080>. Use `localhost` or `127.0.0.1`: the SDK signs requests only on secure
pages, and browsers treat those two as secure.

Without `DEEPVUE_SDK_KEY` the pages simulate Deepvue's responses, with a picker for a normal visit,
a VPN and data-centre IP, or a bot. Add `?mock` to a page's URL to simulate even when a key is set.
The simulated responses are in [`public/mock.js`](public/mock.js), in the shape the SDK returns.

| Setting | Default | What it is |
| --- | --- | --- |
| `DEEPVUE_SDK_KEY` | none | Your SDK key. Without it, responses are simulated. |
| `DEEPVUE_SDK_URL` | the 3.2.3 CDN build | The SDK build the pages load. Pin a version. |
| `PORT` | `8080` | Port to listen on. |

Tests: `npm test` (rules and HTTP routes, no network).

With Docker:

```bash
docker build -t deepvue-use-cases use-cases
docker run --rm -p 8080:8080 -e DEEPVUE_SDK_KEY=<your SDK key> deepvue-use-cases
```

## How it works

1. The page loads the SDK in manual mode, so nothing runs on page load:
   `DeepvueImprint.config({ apiKey, autoCollectOnLoad: false })`.
2. When the user presses the button, the page calls
   `DeepvueImprint.collect({ linkedId, tag: { flow } })` once. `linkedId` is your own ID for the
   action (an application or sign-up ID) and `flow` names the step, so both show up against the
   session in the Deepvue dashboard.
3. The page posts the result's `request_id`, `identity`, `risk` and `network` with the form to the
   server.
4. The server reads this device's earlier events, runs the demo's rule and keeps the new event.

| File | What it is |
| --- | --- |
| [`rules.js`](rules.js) | The four rules. The pages show this source under **The code → Server**. |
| [`store.js`](store.js) | Per-device events in memory, kept for 24 hours. |
| [`server.js`](server.js) | Serves `public/` and the API: `POST /api/{loan,referral,otp,login}`, `POST /api/forget`, `GET /api/config`, `GET /healthz`. |
| [`public/demo.js`](public/demo.js) | Shared page code: load the SDK, collect, post, render. |

The fields the rules read from the collect response: `identity.device_id`, `identity.seen_count`,
`identity.is_new_device`, `risk.action` (`allow`, `review` or `block`), `risk.signals`,
`risk.automation_status`, and `network.is_vpn`, `is_proxy`, `is_tor` and `geo_mismatch_detected`.
When a collect fails, the SDK returns `{ _error: "Error: DeepvueImprint: Server returned 4xx" }`
instead; the pages say so and send nothing.

### Why one Node process with memory storage

- **Nothing to install.** `node server.js` runs anywhere Node runs, and the image is Node plus five
  files. There is no dependency to update or audit.
- **The demos need little state, briefly.** A few events per device for 24 hours fit in memory. A
  restart forgets everything, which suits a public demo: no visitor data is kept.
- **Bounded.** At most 2,000 device-and-demo pairs of 30 events each, so a flood of requests can't
  exhaust memory. The oldest are dropped first.
- **SQLite wasn't worth it.** It would survive restarts, but needs a native module or an experimental
  Node API and a disk volume, and nothing here needs to outlive a restart.

Run exactly **one** instance: each process has its own memory. To run more, replace the three
functions in `store.js` with a shared store that expires keys, such as Redis or a DynamoDB table
with TTL.

## Before production: confirm the visit on your server

**This demo trusts the device ID and verdict the browser sends.** Anyone can post a made-up
`device_id` or an `allow` verdict to `/api/loan`. In production:

1. Send only `request_id` (from `result._meta.request_id`) with the form.
2. On your server, look the visit up with Deepvue's session API, using your Deepvue client ID and
   secret. Never put those in a browser or app.
3. Decide on the fields from that response, check `started_at` is recent, and accept each
   `request_id` once.

```js
// In place of readVisit() in server.js: const visit = await readVisitFromDeepvue(body.request_id);
async function readVisitFromDeepvue(requestId) {
  const res = await fetch(`https://sidc.deepvue.ai/di/v1/sessions/ses_${encodeURIComponent(requestId)}`, {
    headers: { "client-id": process.env.DEEPVUE_CLIENT_ID, "x-api-key": process.env.DEEPVUE_CLIENT_SECRET },
  });
  if (!res.ok) throw new Error(`Deepvue session lookup failed: HTTP ${res.status}`); // 404: unknown or another account's
  const s = await res.json();
  if (Date.now() - Date.parse(s.started_at) > 5 * 60 * 1000) throw new Error("stale request_id");
  return {
    requestId,
    deviceId: s.visitor_id, // the collect response's identity.device_id
    action: s.risk.action,
    signals: s.risk.signals,
    automationStatus: s.risk.automation_status,
    network: {
      isVpn: s.network.is_vpn,
      isProxy: s.network.is_proxy,
      isTor: s.network.is_tor,
      geoMismatch: s.network.geo_mismatch_detected,
    },
  };
}
```

`GET /di/v1/sessions/ses_<request_id>` returns the session's device (`visitor_id`), merged risk
(`action`, `signals`, `automation_status`), network checks, attestation on mobile, and its records.
It answers `401` without valid credentials, `404 not_found` for an unknown request ID or another
account's, and `400 invalid_session_id` for a malformed one.

## Costs and limits

- **Every button press is one collect**, billed to the account whose SDK key the server has. Use a
  Deepvue account made for demos, not a customer's, so these sessions stay out of real Risk
  Monitoring. The flows are tagged `loan_application`, `signup`, `otp_request` and `login`.
- **The SDK key reaches the browser** (from `/api/config`), as with any page that uses the SDK.
  Keep the demo account's wallet capped. When it runs out, the pages say so (HTTP 402).
- **Collects are rate-limited per key**, shared by every visitor. Over it, the pages ask the
  visitor to try again in a minute (HTTP 429).

## Deploy

Any container host works. Serve it over HTTPS, run one instance, health-check `GET /healthz`, and
set `DEEPVUE_SDK_KEY` from your secret store. The pages load the SDK from the Deepvue CDN (which
calls `https://sidc.deepvue.ai`) and fonts from Google Fonts.

## Privacy

The SDK collects device and browser metadata, never names, phone numbers or emails. The forms come
filled with sample data. The server keeps phone numbers and usernames only as a hash (to count
distinct ones) and a masked label such as `+91 ••••• •••42`, never stores passwords, and forgets
everything after 24 hours or on restart.
