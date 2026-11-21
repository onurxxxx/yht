# TCDD Bilet Bulucu Web

## Introduction

Welcome to the web version of TCDD Bilet Bulucu ([CLI version](https://github.com/rburaksaritas/tcdd-bilet-bulucu)). See below for Turkish. It is a browser-based tool that watches a Turkish State Railways (TCDD) route and alerts you with a sound the moment a free place appears, so you don't have to install Python or use a terminal.

> **Important: this version was migrated to TCDD's new API.** The old `api-yebsp.tcddtasimacilik.gov.tr` endpoints no longer respond (`seferSorgula` returned 500, `istasyonYukle` returned 405). The tool now uses the service behind [ebilet.tcddtasimacilik.gov.tr](https://ebilet.tcddtasimacilik.gov.tr). Because of that, **a small proxy (included, free to host) is now required** — see [Setup](#setup).

## Features

- **Easy-to-use interface**: Plain HTML, CSS and vanilla JavaScript.
- **Multiple departure times at once**: Select as many departures as you like.
- **Cabin class filtering**: Choose which classes (Economy, Business, Loca, Wheelchair space) you want to be alerted for. Wheelchair spaces are off by default.
- **Alarm**: A buzzer sound (generated in the browser) plays when free places are found.
- **Gentle polling**: Checks every 60 seconds by default (minimum 30). Please keep it reasonable — this is a public service.

## How it works

The tool uses the same API as the ebilet website:

| Purpose | Endpoint |
| --- | --- |
| Station list | `GET cdn-api-prod-ytp.tcddtasimacilik.gov.tr/datas/stations.json` |
| Seat availability | `POST web-api-prod-ytp.tcddtasimacilik.gov.tr/tms/train/train-availability` |

Two details drive the architecture:

1. **The availability endpoint sits behind a WAF.** It answers `403` unless the request has browser-like headers (`sec-fetch-*`, `sec-ch-ua*`, `Origin`, `Referer`, `User-Agent`). A web page cannot set these headers from JavaScript.
2. **The auth token is read from the website.** TCDD's frontend ships a static JWT inside its JS bundle. It is fetched at runtime and refreshed once on a `401`. (The old hard-coded Basic Auth key is gone.) A web page on another domain cannot download that bundle because of CORS.

So the page talks to a tiny **Cloudflare Worker** (`worker/worker.js`) that adds the headers, manages the token and enables CORS. The station list ships with the site as `stations.json` (so the page works even before the proxy answers) and is refreshed through the proxy when possible.

**Behavior changes compared to the old version**

- The API returns free places **per cabin class**, not per wagon/seat. The old rule "skip seats whose number ends with `h`" became "exclude the wheelchair class (`DSB`)".
- Station names are now **UPPERCASE** (e.g. `ANKARA GAR`, `İSTANBUL(SÖĞÜTLÜÇEŞME)`).
- Departure times arrive as epoch milliseconds and are shown in Europe/Istanbul time.
- The search stops on the first hit and alarms once, so you are not spammed for the same train and class.
- The old sound file was loaded over plain `http://`, which browsers block on an `https` page. The alarm is now generated locally.

## Setup

### 1. Deploy the proxy (once, about 5 minutes)

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node.js.

```sh
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler prints a URL such as `https://tcdd-proxy.your-name.workers.dev`.

Optionally restrict who may call it by uncommenting `ALLOWED_ORIGIN` in `worker/wrangler.toml` and setting it to your site, e.g. `https://your-name.github.io`.

### 2. Point the site at it

Edit `config.js`:

```js
window.TCDD_CONFIG = {
    proxyUrl: "https://tcdd-proxy.your-name.workers.dev"
};
```

### 3. Host the site

Push the repository to GitHub and enable GitHub Pages (Settings → Pages), or open `index.html` through any static server (e.g. `python3 -m http.server`). Opening the file directly via `file://` will not work because `stations.json` is loaded with `fetch`.

## Usage

1. **Select your journey**: departure station, arrival station and date.
2. **Pick departure times**: tick one or more of the listed hours.
3. **Choose cabin classes** and the check interval.
4. **Click "Find Seat"**: keep the tab open. When free places appear you hear the alarm and see the details. Click "Stop" to cancel.

Browsers may throttle timers and block sound in background tabs; keep the tab visible and click on the page once before you start so the browser allows audio.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Red banner "No proxy configured" | `proxyUrl` in `config.js` is empty. Deploy the Worker and set it. |
| `API error: HTTP 403` | TCDD's WAF rejected the request. Check the headers in `worker/worker.js`. |
| `API error: HTTP 401` | Token was rejected and the automatic refresh failed. Check that the Worker can still find the JWT in TCDD's JS bundle. |
| `Token not found in the site's JS bundle` | TCDD changed its frontend; `fetchToken()` in `worker/worker.js` needs updating. |
| "Station pair does not have any available journey" | No trains on that date, or the date is too far ahead — TCDD opens sales only a limited number of days in advance. |
| Station missing | Names must match `stations.json` exactly (UPPERCASE). The list refreshes through the proxy automatically. |

Because this depends on TCDD's frontend staying roughly as it is, the Worker may need an update if TCDD renames its bundles or changes the endpoint.

## Structure

- `index.html`, `style.css`: the page.
- `index.js`: the page logic.
- `config.js`: your settings (proxy URL).
- `stations.json`: station names and ids.
- `worker/worker.js`, `worker/wrangler.toml`: the Cloudflare Worker proxy.

## Disclaimer

This tool is intended only for educational purposes and is not affiliated with TCDD in any way. It queries a public endpoint at a modest interval; please keep the check interval reasonable and use it in accordance with TCDD's terms of service.

---

# TCDD Bilet Bulucu Web (Türkçe)

## Giriş

TCDD Bilet Bulucu'nun web sürümüne hoş geldiniz ([CLI sürümü](https://github.com/rburaksaritas/tcdd-bilet-bulucu)). Seçtiğiniz TCDD seferinde boş yer açıldığı anda sesli alarm veren, tarayıcıda çalışan bir araçtır. Python kurmanız veya terminal kullanmanız gerekmez.

> **Önemli: Bu sürüm TCDD'nin yeni API'sine taşındı.** Eski `api-yebsp.tcddtasimacilik.gov.tr` uç noktaları artık yanıt vermiyor (`seferSorgula` 500, `istasyonYukle` 405 dönüyordu). Araç artık [ebilet.tcddtasimacilik.gov.tr](https://ebilet.tcddtasimacilik.gov.tr)'nin kullandığı servisi kullanıyor. Bu nedenle **küçük bir proxy (pakette hazır, barındırması ücretsiz) artık gerekli** — bkz. [Kurulum](#kurulum).

## Özellikler

- **Kolay arayüz**: Düz HTML, CSS ve saf JavaScript.
- **Birden fazla saat**: İstediğiniz kadar kalkış saatini aynı anda seçin.
- **Kabin sınıfı filtresi**: Hangi sınıflar için bildirim istediğinizi seçin (Ekonomi, Business, Loca, Tekerlekli sandalye). Tekerlekli sandalye alanı varsayılan olarak kapalıdır.
- **Alarm**: Boş yer bulunduğunda tarayıcıda üretilen bir alarm sesi çalar.
- **Ölçülü sorgulama**: Varsayılan olarak 60 saniyede bir kontrol eder (en az 30). Lütfen makul tutun; bu herkese açık bir servistir.

## Nasıl çalışır

Araç, ebilet sitesinin kullandığı API'yi kullanır:

| Amaç | Uç nokta |
| --- | --- |
| İstasyon listesi | `GET cdn-api-prod-ytp.tcddtasimacilik.gov.tr/datas/stations.json` |
| Boş yer sorgusu | `POST web-api-prod-ytp.tcddtasimacilik.gov.tr/tms/train/train-availability` |

Mimariyi iki ayrıntı belirler:

1. **Sorgu uç noktası bir WAF arkasındadır.** Tarayıcı benzeri başlıklar (`sec-fetch-*`, `sec-ch-ua*`, `Origin`, `Referer`, `User-Agent`) olmadan `403` döner. Bir web sayfası bu başlıkları JavaScript ile ayarlayamaz.
2. **Token siteden okunur.** TCDD'nin ön yüzü JS paketine statik bir JWT gömer; çalışma anında çekilir ve `401`'de bir kez yenilenir. (Eski sabit Basic Auth anahtarı kaldırıldı.) Başka bir alan adındaki web sayfası, CORS nedeniyle bu paketi indiremez.

Bu yüzden sayfa, başlıkları ekleyen, token'ı yöneten ve CORS'u açan küçük bir **Cloudflare Worker** (`worker/worker.js`) ile konuşur. İstasyon listesi `stations.json` olarak siteyle birlikte gelir (proxy yanıt vermeden de sayfa çalışır) ve mümkünse proxy üzerinden güncellenir.

**Eski sürüme göre davranış değişiklikleri**

- API, boş yeri vagon/koltuk yerine **kabin sınıfı başına** döndürür. Eski "numarası `h` ile biten koltuğu atla" kuralı, "tekerlekli sandalye sınıfını (`DSB`) hariç tut" oldu.
- İstasyon adları artık **BÜYÜK HARF** (örn. `ANKARA GAR`, `İSTANBUL(SÖĞÜTLÜÇEŞME)`).
- Kalkış saatleri epoch milisaniye olarak gelir ve Europe/Istanbul saatiyle gösterilir.
- Arama ilk bulguda durur ve bir kez alarm verir; aynı tren ve sınıf için tekrar tekrar bildirim gelmez.
- Eski ses dosyası düz `http://` üzerinden yükleniyordu; tarayıcılar `https` sayfada bunu engeller. Alarm artık yerelde üretiliyor.

## Kurulum

### 1. Proxy'yi yayınlayın (bir kez, yaklaşık 5 dakika)

Ücretsiz bir [Cloudflare](https://dash.cloudflare.com/sign-up) hesabı ve Node.js gerekir.

```sh
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler `https://tcdd-proxy.sizin-adiniz.workers.dev` gibi bir adres yazdırır.

İsterseniz `worker/wrangler.toml` içindeki `ALLOWED_ORIGIN` satırının yorumunu kaldırıp sitenize ayarlayarak (örn. `https://sizin-adiniz.github.io`) proxy'yi yalnızca kendi sitenize açabilirsiniz.

### 2. Siteyi proxy'ye bağlayın

`config.js` dosyasını düzenleyin:

```js
window.TCDD_CONFIG = {
    proxyUrl: "https://tcdd-proxy.sizin-adiniz.workers.dev"
};
```

### 3. Siteyi yayınlayın

Depoyu GitHub'a gönderip GitHub Pages'i açın (Settings → Pages) veya `index.html`'i herhangi bir statik sunucuyla açın (örn. `python3 -m http.server`). `stations.json` `fetch` ile yüklendiği için dosyayı doğrudan `file://` ile açmak çalışmaz.

## Kullanım

1. **Yolculuğu seçin**: kalkış istasyonu, varış istasyonu ve tarih.
2. **Saatleri seçin**: listelenen saatlerden bir veya daha fazlasını işaretleyin.
3. **Kabin sınıflarını** ve kontrol aralığını seçin.
4. **"Find Seat"e tıklayın**: sekmeyi açık tutun. Boş yer çıktığında alarm çalar ve ayrıntılar görünür. İptal için "Stop"a tıklayın.

Tarayıcılar arka plan sekmelerinde zamanlayıcıları yavaşlatabilir ve sesi engelleyebilir; sekmeyi görünür tutun ve başlamadan önce sayfaya bir kez tıklayın.

## Sorun giderme

| Belirti | Neden ve çözüm |
| --- | --- |
| Kırmızı "No proxy configured" bandı | `config.js` içindeki `proxyUrl` boş. Worker'ı yayınlayıp girin. |
| `API error: HTTP 403` | TCDD WAF'ı isteği reddetti. `worker/worker.js` içindeki başlıkları kontrol edin. |
| `API error: HTTP 401` | Token reddedildi ve otomatik yenileme başarısız oldu. Worker'ın JWT'yi TCDD'nin JS paketinde hâlâ bulup bulamadığını kontrol edin. |
| `Token not found in the site's JS bundle` | TCDD ön yüzünü değiştirmiş; `worker/worker.js` içindeki `fetchToken()` güncellenmeli. |
| "Station pair does not have any available journey" | O tarihte sefer yok veya tarih çok ileride; TCDD satışı sınırlı sayıda gün önceden açar. |
| İstasyon yok | Adlar `stations.json` ile birebir (BÜYÜK HARF) eşleşmeli. Liste proxy üzerinden otomatik güncellenir. |

Bu çözüm TCDD'nin ön yüzünün büyük ölçüde aynı kalmasına bağlıdır; TCDD paket adlarını veya uç noktayı değiştirirse Worker'ın güncellenmesi gerekebilir.

## Yapı

- `index.html`, `style.css`: sayfa.
- `index.js`: sayfa mantığı.
- `config.js`: ayarlarınız (proxy adresi).
- `stations.json`: istasyon adları ve idleri.
- `worker/worker.js`, `worker/wrangler.toml`: Cloudflare Worker proxy.

## Sorumluluk Reddi

Bu araç yalnızca eğitim amaçlıdır ve herhangi bir şekilde TCDD ile ilişkilendirilmemiştir. Herkese açık bir uç noktayı ölçülü aralıkla sorgular; lütfen kontrol aralığını makul tutun ve TCDD'nin hizmet şartlarına uygun kullanın.
