// TCDD Bilet Bulucu Web - ayarlar / settings
//
// proxyUrl: URL of your deployed Cloudflare Worker (see worker/worker.js and README).
//   Example: "https://tcdd-proxy.your-name.workers.dev"
//
// Why is a proxy needed? TCDD's new API (used by ebilet.tcddtasimacilik.gov.tr)
//   1. sits behind a WAF that rejects requests without browser-like headers
//      (sec-fetch-*, sec-ch-ua*, Origin, Referer, User-Agent), which a web page
//      cannot set from JavaScript, and
//   2. needs a token that is only available inside TCDD's own JS bundle, which a
//      web page on another domain cannot download (CORS).
// The Worker does both server-side and exposes a CORS-enabled endpoint.
window.TCDD_CONFIG = {
    proxyUrl: "https://yht.onur-ydk.workers.dev"
};
