/**
 * TCDD proxy (Cloudflare Worker)
 *
 * JavaScript port of src/api.py from the CLI version. A browser page cannot talk
 * to TCDD's new API directly, so this Worker does it on the page's behalf:
 *
 *   POST /availability  ->  POST web-api-prod-ytp.tcddtasimacilik.gov.tr/tms/train/train-availability
 *   GET  /stations      ->  GET  cdn-api-prod-ytp.tcddtasimacilik.gov.tr/datas/stations.json
 *
 * What it handles for you:
 *   - Browser-like headers (sec-fetch-*, sec-ch-ua*, Origin, Referer, User-Agent) that
 *     TCDD's WAF requires; without them the API answers 403.
 *   - The auth token: a static JWT shipped inside the JS bundle of ebilet.tcddtasimacilik.gov.tr.
 *     It is fetched at runtime, cached, and refreshed once on a 401.
 *   - CORS, so the GitHub Pages site can call this Worker.
 *
 * Optional environment variable:
 *   ALLOWED_ORIGIN  e.g. "https://your-name.github.io"  (default "*")
 */

const SITE_URL = "https://ebilet.tcddtasimacilik.gov.tr";
const TMS_BASE = "https://web-api-prod-ytp.tcddtasimacilik.gov.tr/tms";
const CDN_BASE = "https://cdn-api-prod-ytp.tcddtasimacilik.gov.tr/datas";

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr",
    "Content-Type": "application/json",
    "Origin": SITE_URL,
    "Referer": SITE_URL + "/",
    "sec-ch-ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "unit-id": "3895",
    "User-Agent": USER_AGENT,
};

// Constant query parameters (the site's own axios interceptor adds them too).
const COMMON_QUERY = "environment=dev&userId=1";

const TOKEN_PATTERN = /eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIi[A-Za-z0-9._-]+/g;

// Cached for the lifetime of the Worker isolate.
let cachedToken = null;

async function fetchToken() {
    const indexHtml = await (await fetch(SITE_URL, { headers: { "User-Agent": USER_AGENT } })).text();
    const bundles = [...new Set(indexHtml.match(/\/js\/index~[A-Za-z0-9~._-]+\.js/g) || [])];
    for (const bundle of bundles) {
        const js = await (await fetch(SITE_URL + bundle, { headers: { "User-Agent": USER_AGENT } })).text();
        const found = js.match(TOKEN_PATTERN);
        if (found && found.length) return found[found.length - 1];
    }
    throw new Error("Token not found in the site's JS bundle (TCDD may have changed its frontend).");
}

async function getToken(refresh = false) {
    if (!cachedToken || refresh) cachedToken = await fetchToken();
    return cachedToken;
}

async function tcddFetch(url, init) {
    const send = async () => {
        const headers = { ...BROWSER_HEADERS, Authorization: await getToken() };
        return fetch(url, { ...init, headers });
    };
    let response = await send();
    if (response.status === 401) {
        await getToken(true);
        response = await send();
    }
    return response;
}

function corsHeaders(request, env) {
    const allowed = (env && env.ALLOWED_ORIGIN) || "*";
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = allowed === "*" ? "*" : (origin === allowed ? origin : allowed);
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function json(body, status, extra) {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
    });
}

export default {
    async fetch(request, env) {
        const cors = corsHeaders(request, env);
        const { pathname } = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: cors });
        }

        try {
            if (pathname === "/availability" && request.method === "POST") {
                const upstream = await tcddFetch(
                    `${TMS_BASE}/train/train-availability?${COMMON_QUERY}`,
                    { method: "POST", body: await request.text() }
                );
                return json(await upstream.text(), upstream.status, cors);
            }

            if (pathname === "/stations" && request.method === "GET") {
                const upstream = await tcddFetch(`${CDN_BASE}/stations.json?${COMMON_QUERY}`, { method: "GET" });
                return json(await upstream.text(), upstream.status, cors);
            }

            return json({ error: "Not found. Use POST /availability or GET /stations." }, 404, cors);
        } catch (err) {
            return json({ error: String(err && err.message ? err.message : err) }, 502, cors);
        }
    },
};
