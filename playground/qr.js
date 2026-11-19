// Deepvue-branded QR codes, the console's look (Try it): round navy dots,
// rounded finder corners and the logo mark in the middle with the dots behind
// it cleared. Drawn from qrcode-generator's grid in this browser; the text
// (it can carry an SDK key) is never sent anywhere.
//
//   window.brandedQrSvg(text) -> an <svg> string, or throws when the text is
//   too long for any QR code.
(function () {
  "use strict";

  const NAVY = "#0F0940";

  window.brandedQrSvg = function (text) {
    // Q recovers 25% of the code: room for the logo over the middle.
    const qr = window.qrcode(0, "Q");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();

    // The three finder squares (7x7 in the corners) are drawn whole below.
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // The logo's square, about a quarter of the code across, on whole
    // modules and centred (odd, so it sits on the middle module).
    let logo = Math.round(n * 0.26);
    if (logo % 2 === 0) logo += 1;
    const from = (n - logo) / 2;
    const inLogo = (r, c) => r >= from && r < from + logo && c >= from && c < from + logo;

    const dots = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c) || finder(r, c) || inLogo(r, c)) continue;
        dots.push(`<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.42"/>`);
      }
    }

    const corner = (x, y) =>
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2.1" fill="none" stroke="${NAVY}" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${NAVY}"/>`;

    const pad = 0.6;
    const q = 2; // quiet zone, in modules
    const size = n + q * 2;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${size} ${size}" shape-rendering="geometricPrecision" aria-hidden="true">` +
      `<rect x="${-q}" y="${-q}" width="${size}" height="${size}" fill="#fff"/>` +
      `<g fill="${NAVY}">${dots.join("")}</g>` +
      corner(0, 0) +
      corner(n - 7, 0) +
      corner(0, n - 7) +
      `<image href="logo-mark.svg" x="${from + pad}" y="${from + pad}" width="${logo - pad * 2}" height="${logo - pad * 2}" preserveAspectRatio="xMidYMid meet"/>` +
      `</svg>`
    );
  };
})();
