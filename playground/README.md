# Device Intelligence playground

A public page that runs the Deepvue web SDK on the visitor's own browser and shows what Deepvue sees:
the risk verdict (allow, review or block), the device ID and how often it has been seen, and each
check (bot, private browsing, developer tools, VPN, proxy, Tor, data-centre IP, time zone vs IP).
Visitors can turn on a VPN or open a private window and check again. Nothing to sign up for.

It is plain HTML, CSS and JavaScript with no build step. It uses the Deepvue dashboard's design
(colours, type, cards, badges and icons, copied into `style.css`), in light or dark mode: it follows
the system setting until the visitor picks one with the button in the top bar (`theme.js`, kept in
this browser). It works from phone width up.

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

**Device check links.** `?key=<SDK key>` runs the check under that key instead, tagged
`flow: device_check`, so a customer can send the link to testers and see the results in their own
dashboard without writing code. A playground key (`sk_playground_…`) works too. It works from any
site and in the demo apps, is free up to 100 collects a day (resets at 00:00 UTC), and its
sessions show under Playground in the dashboard. The QR code then carries the key too. A malformed
key shows an error and runs no check.

## Pairing link for the demo apps

`https://<host>/pair#<SDK key>` opens Deepvue's demo app (Android `ai.deepvue.deepvuefp`, iOS
`ai.deepvue.fpdemo`) with that SDK key already set. A customer opens the link on a laptop, and
`pair` shows a QR code of it; scanning it with the phone's camera opens the app. The key stays
after `#`, which browsers never send to a server, and the page sends no requests with it.

- **App installed:** Android App Links and iOS Universal Links open the app straight from the
  camera. `.well-known/assetlinks.json` (the Play app signing and upload certificates) and
  `.well-known/apple-app-site-association` (path `/pair*`) let each app claim the link.
- **App not installed:** the phone shows `pair` instead. On Android, the Google Play button carries
  the key in the install referrer (`referrer=dv_key%3D<key>`), and the app reads it on first launch.
  On iPhone, the App Store passes nothing through, so the page asks to scan the QR code again
  after installing.
- **No key in the link:** on a laptop, the page asks for one and builds the link and QR code in
  the browser.

The apps trust this one host, so moving the page to another host needs new app builds.

To preview locally, serve the folder with `pair` as HTML (Python's server sends files without an
extension as downloads), then open <http://127.0.0.1:5510/pair#sk_playground_example123>:

```bash
cd playground && python3 -c 'import http.server as s; s.SimpleHTTPRequestHandler.extensions_map[""] = "text/html"; s.test(s.SimpleHTTPRequestHandler, s.ThreadingHTTPServer, port=5510, bind="127.0.0.1")'
```

## Costs and limits

- **Every check is one collect**, billed like any other collect on the account whose key is in
  `config.js`.
- **Anyone can reuse the key.** It is visible in the page, as with any SDK key, so keep the
  account's wallet balance capped. When it runs out, the page says the demo is out of credit
  (HTTP 402).
- **Collects are rate-limited per key**, and every visitor shares the limit. Over it, the page
  asks the visitor to try again in a minute (HTTP 429).

## Deploy

Host the folder on any static HTTPS host. For AWS, [`infra/playground-hosting.yaml`](../infra/playground-hosting.yaml)
creates a private S3 bucket served only through CloudFront (origin access control). Then, with
your SDK key in `config.js`:

```bash
aws s3 sync playground/ s3://<bucket>/ --exclude README.md --exclude pair \
  --exclude .well-known/apple-app-site-association --cache-control "public, max-age=300" --delete
aws s3 cp playground/pair s3://<bucket>/pair \
  --content-type "text/html; charset=utf-8" --cache-control "public, max-age=300"
aws s3 cp playground/.well-known/apple-app-site-association s3://<bucket>/.well-known/apple-app-site-association \
  --content-type application/json --cache-control "public, max-age=300"
aws cloudfront create-invalidation --distribution-id <distribution id> --paths "/*"
```

The two files without an extension get their content types from the `cp` commands: `sync` would
upload them as `binary/octet-stream`, and the browser would download `/pair` instead of showing it.

The page loads from outside the folder:

- the SDK from the Deepvue CDN (`sdkUrl`), which calls `https://sidc.deepvue.ai`;
- `qrcode-generator` from cdnjs, with an integrity hash;
- Nunito Sans and IBM Plex Mono from Google Fonts.

A Content Security Policy needs those hosts in `script-src`, `connect-src`, `style-src` and
`font-src`.
