# Device Intelligence playground

A public page that runs the Deepvue web SDK on the visitor's own browser and shows what Deepvue sees:
the risk verdict (allow, review or block), the device ID and how often it has been seen, and each
check (bot, private browsing, developer tools, VPN, proxy, Tor, data-centre IP, time zone vs IP).
Visitors can turn on a VPN or open a private window and check again. Nothing to sign up for.

It is plain HTML, CSS and JavaScript with no build step.

## Run it locally

From the repository root:

```bash
python3 -m http.server 5510 --directory playground
```

Open <http://127.0.0.1:5510/>. Use `127.0.0.1` or `localhost`: the SDK signs requests only on
secure pages, and browsers treat those two as secure.

Without an SDK key the page shows how to add one. To see the page with no key and no traffic, add
`?sample=allow`, `?sample=review`, `?sample=block` or `?sample=error` to the URL. The samples are in
`samples.js`, in the shape the SDK returns.

## Configure

Everything lives in `config.js`:

| Setting | What it is |
| --- | --- |
| `sdkKey` | The SDK key of the account the checks run under. Keys are public by design: they ship in every page that uses the SDK. |
| `sdkUrl` | The SDK build to load. Pin a version. |
| `signUpUrl`, `setupGuideUrl` | Where the calls to action point. |

Use a Deepvue-owned account made for the playground, not a customer's, so these sessions stay out
of customers' Risk Monitoring. Each check is tagged `flow: playground`.

## Costs and limits

- **Every check is one collect**, billed like any other collect on the account whose key is in
  `config.js`.
- **Anyone can reuse the key.** It is visible in the page, as with any SDK key, so keep the
  account's wallet balance capped. When it runs out, the page says the demo is out of credit
  (HTTP 402).
- **Collects are rate-limited per key**, and every visitor shares the limit. Over it, the page
  asks the visitor to try again in a minute (HTTP 429).

## Deploy

Host the folder on any static HTTPS host, for example S3 behind CloudFront.
The page loads from outside the folder:

- the SDK from the Deepvue CDN (`sdkUrl`), which calls `https://sidc.deepvue.ai`;
- `qrcode-generator` from cdnjs, with an integrity hash;
- Nunito Sans and IBM Plex Mono from Google Fonts.

A Content Security Policy needs those hosts in `script-src`, `connect-src`, `style-src` and
`font-src`.
