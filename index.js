/** config */
const APP_CONFIG = Object.assign({ proxyUrl: "" }, window.TCDD_CONFIG || {});
const PROXY_URL = String(APP_CONFIG.proxyUrl || "").replace(/\/+$/, "");

const DEFAULT_DEPARTURE = "İSTANBUL(SÖĞÜTLÜÇEŞME)";
const DEFAULT_ARRIVAL = "ANKARA GAR";
const MIN_SLEEP_SECONDS = 30; // this is a public service, don't hammer it
const DEFAULT_SLEEP_SECONDS = 60;

/** api */
// TCDD's new API (api-yebsp is gone) is reached through the proxy in worker/worker.js.
// The proxy adds the browser-like headers and the auth token that TCDD requires.
async function fetchAvailability(body) {
    if (!PROXY_URL) {
        throw new Error("No proxy configured. Set proxyUrl in config.js (see README).");
    }
    const response = await fetch(PROXY_URL + "/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API error: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return response.json();
}

/** util */
let stationsData = {}; // name (UPPERCASE) -> id

async function loadStations() {
    if (Object.keys(stationsData).length === 0) {
        try {
            const response = await fetch("stations.json");
            stationsData = await response.json();
        } catch (error) {
            console.error("Failed to load stations.json:", error);
        }
    }
    return stationsData;
}

// Best-effort refresh from TCDD's station service (needs the proxy).
async function refreshStationsFromApi() {
    if (!PROXY_URL) return false;
    try {
        const response = await fetch(PROXY_URL + "/stations");
        if (!response.ok) return false;
        const list = await response.json();
        const fresh = {};
        list.filter(s => s.showOnQuery).forEach(s => { fresh[s.name] = s.id; });
        if (Object.keys(fresh).length === 0) return false;
        stationsData = fresh;
        return true;
    } catch (error) {
        console.warn("Station refresh failed, using bundled stations.json:", error);
        return false;
    }
}

// "2026-08-15" -> "15-08-2026 00:00:00" (the format the API expects)
function formatDate(date) {
    const [year, month, day] = date.split("-");
    return `${day}-${month}-${year} 00:00:00`;
}

// The API returns departure times as epoch milliseconds; show them in Europe/Istanbul time.
const istanbulFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function toLocalParts(epochMillis) {
    const parts = {};
    istanbulFormatter.formatToParts(new Date(epochMillis)).forEach(p => { parts[p.type] = p.value; });
    return parts;
}

function toHHMM(epochMillis) {
    const p = toLocalParts(epochMillis);
    return `${p.hour}:${p.minute}`;
}

function toDisplayDateTime(epochMillis) {
    const p = toLocalParts(epochMillis);
    return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

function buildAvailabilityBody(config) {
    return {
        searchRoutes: [
            {
                departureStationId: stationsData[config.binisIstasyonAdi],
                departureStationName: config.binisIstasyonAdi,
                arrivalStationId: stationsData[config.inisIstasyonAdi],
                arrivalStationName: config.inisIstasyonAdi,
                departureDate: formatDate(config.date)
            }
        ],
        passengerTypeCounts: [{ id: 0, count: 1 }],
        searchReservation: false,
        searchType: "DOMESTIC"
    };
}

// Flattens trainLegs -> trainAvailabilities -> trains
function extractTrains(data) {
    const trains = [];
    ((data && data.trainLegs) || []).forEach(leg => {
        (leg.trainAvailabilities || []).forEach(availability => {
            (availability.trains || []).forEach(train => trains.push(train));
        });
    });
    return trains;
}

function departureOf(train) {
    const segments = train.segments || [];
    return segments.length ? segments[0].departureTime : null;
}

function trainNameOf(train) {
    return train.commercialName || train.name || String(train.number);
}

// The API reports free places per cabin class (not per wagon/seat anymore).
// Returns every class with free places; `excluded` is true for classes the user opted out of
// (wheelchair spaces by default, which replaces the old "seat number ends with h" rule).
function findAvailability(train, excludedClasses) {
    const found = [];
    (train.cabinClassAvailabilities || []).forEach(cabin => {
        const cabinClass = cabin.cabinClass || {};
        const code = String(cabinClass.code || "").toUpperCase();
        const count = cabin.availabilityCount || 0;
        if (count > 0) {
            found.push({
                code,
                name: cabinClass.name || code,
                count,
                excluded: excludedClasses.has(code)
            });
        }
    });
    return found;
}

/** ui helpers */
function el(id) { return document.getElementById(id); }

function appendLine(containerId, text) {
    const line = document.createElement("div");
    line.textContent = text; // textContent: API strings are never interpreted as HTML
    el(containerId).appendChild(line);
    return line;
}

function showStatus(message, isError) {
    const box = el("status");
    box.textContent = message;
    box.classList.toggle("hidden", !message);
    box.classList.toggle("error", !!isError);
}

function readConfig() {
    const sleep = parseInt(el("sleepTime").value, 10);
    return {
        binisIstasyonAdi: el("binisIstasyonAdi").value,
        inisIstasyonAdi: el("inisIstasyonAdi").value,
        date: el("date").value,
        sleepTime: Math.max(MIN_SLEEP_SECONDS, Number.isFinite(sleep) ? sleep : DEFAULT_SLEEP_SECONDS)
    };
}

function getExcludedClasses() {
    const excluded = new Set();
    document.querySelectorAll('#classChoices input[type="checkbox"]').forEach(box => {
        if (!box.checked) excluded.add(box.value.toUpperCase());
    });
    return excluded;
}

function getSelectedHours() {
    const boxes = document.querySelectorAll('#hourChoices input[type="checkbox"]:checked');
    return Array.from(boxes).map(box => box.value);
}

function toggleLoading(elementId) {
    const container = el(elementId);
    const existingLoader = container.querySelector(".loader");
    if (existingLoader) {
        container.removeChild(existingLoader);
    } else {
        const loader = document.createElement("div");
        loader.className = "loader";
        container.appendChild(loader);
    }
}

/** alarm (generated in-browser, no external sound file) */
let audioContext = null;

function beep() {
    try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === "suspended") audioContext.resume();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.2;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.4);
    } catch (error) {
        console.warn("Could not play alarm:", error);
    }
}

function alarm() {
    for (let i = 0; i < 4; i++) {
        setTimeout(beep, 800 * i);
    }
}

/** hour selection */
let prefetchCounter = 0;

// Dynamically updates the hour choices for the selected stations and date
async function prefetchForHours() {
    const hourContainer = el("hourChoices");
    hourContainer.innerHTML = "";
    const config = readConfig();
    if (!config.date || !stationsData[config.binisIstasyonAdi] || !stationsData[config.inisIstasyonAdi]) return;

    const myRequest = ++prefetchCounter;
    toggleLoading("hourChoices");
    let message = null;
    let trains = [];
    try {
        const data = await fetchAvailability(buildAvailabilityBody(config));
        trains = extractTrains(data);
        if (trains.length === 0) {
            message = "Station pair does not have any available journey. Check your preferences and try again.";
        }
    } catch (error) {
        console.error(error);
        message = error.message;
    }
    if (myRequest !== prefetchCounter) return; // a newer request replaced this one
    hourContainer.innerHTML = "";
    if (message) {
        hourContainer.textContent = message;
    } else {
        updateHourChoices(trains);
    }
}

function updateHourChoices(trains) {
    const hourContainer = el("hourChoices");
    hourContainer.innerHTML = "";

    const times = trains
        .map(departureOf)
        .filter(ms => ms != null)
        .map(toHHMM)
        .sort((a, b) => a.localeCompare(b));

    [...new Set(times)].forEach(time => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "hour-" + time;
        checkbox.name = "hour";
        checkbox.value = time;

        const label = document.createElement("label");
        label.htmlFor = checkbox.id;
        label.appendChild(document.createTextNode(time));

        const wrapper = document.createElement("div");
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        hourContainer.appendChild(wrapper);
    });
}

/** finder */
let running = false;
let stopRequested = false;
let wakeUp = null;

function sleep(seconds) {
    return new Promise(resolve => {
        const timer = setTimeout(() => { wakeUp = null; resolve(); }, seconds * 1000);
        wakeUp = () => { clearTimeout(timer); wakeUp = null; resolve(); };
    });
}

// One polling cycle. Returns the list of new (non-excluded) free places found.
async function checkOnce(config, selectedHours, excludedClasses) {
    appendLine("log", `Checking for date: ${config.date}`);
    const data = await fetchAvailability(buildAvailabilityBody(config));
    const hits = [];

    extractTrains(data).forEach(train => {
        const departureMs = departureOf(train);
        if (departureMs == null) return;
        if (!selectedHours.includes(toHHMM(departureMs))) return;

        const when = toDisplayDateTime(departureMs);
        const trainName = trainNameOf(train);
        appendLine("log", `Checking for time: ${when} - ${trainName}`);

        findAvailability(train, excludedClasses).forEach(item => {
            if (item.excluded) {
                appendLine("log", `  Free places (excluded class) ${item.name}: ${item.count}`);
            } else {
                appendLine("log", `  Available: ${item.name} - ${item.count} places`);
                hits.push({ trainName, when, name: item.name, count: item.count });
            }
        });
    });
    return hits;
}

function stopFinder() {
    stopRequested = true;
    if (wakeUp) wakeUp();
}

async function runFinder() {
    if (running) { stopFinder(); return; }

    const selectedHours = getSelectedHours();
    if (selectedHours.length === 0) { alert("Please select one or more hours"); return; }

    const config = readConfig();
    const excludedClasses = getExcludedClasses();

    running = true;
    stopRequested = false;
    el("find-seat-button").textContent = "Stop";
    el("log").innerHTML = "";
    el("result").innerHTML = "";
    appendLine("result", "Selected hours: " + selectedHours.join(", "));
    toggleLoading("find-seat-button-loader");

    let found = false;
    while (!stopRequested && !found) {
        appendLine("log", "Searching...");
        try {
            const hits = await checkOnce(config, selectedHours, excludedClasses);
            if (hits.length > 0) {
                found = true;
                hits.forEach(hit => {
                    appendLine("result", `Available: ${hit.name} - ${hit.count} places - ${hit.trainName} - ${hit.when}`);
                });
            }
        } catch (error) {
            console.error(error);
            appendLine("log", error.message + " (will retry)");
        }
        if (!found && !stopRequested) {
            appendLine("log", `Will restart in ${config.sleepTime} seconds.`);
            await sleep(config.sleepTime);
        }
    }

    toggleLoading("find-seat-button-loader");
    running = false;
    el("find-seat-button").textContent = "Find Seat";
    if (found) alarm();
}

/** page */
function populateStationSelects(keepSelection) {
    const binisSelect = el("binisIstasyonAdi");
    const inisSelect = el("inisIstasyonAdi");
    const previous = keepSelection
        ? { binis: binisSelect.value, inis: inisSelect.value }
        : { binis: DEFAULT_DEPARTURE, inis: DEFAULT_ARRIVAL };

    binisSelect.innerHTML = "";
    inisSelect.innerHTML = "";
    Object.keys(stationsData)
        .sort((a, b) => a.localeCompare(b, "tr"))
        .forEach(stationName => {
            binisSelect.add(new Option(stationName, stationName));
            inisSelect.add(new Option(stationName, stationName));
        });
    if (stationsData[previous.binis]) binisSelect.value = previous.binis;
    if (stationsData[previous.inis]) inisSelect.value = previous.inis;
}

function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

document.addEventListener("DOMContentLoaded", async function () {
    await loadStations();
    populateStationSelects(false);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    el("date").min = localDateString(new Date());
    el("date").value = localDateString(tomorrow);

    // The loader sits next to the button so the button label stays readable.
    const loaderHost = document.createElement("div");
    loaderHost.id = "find-seat-button-loader";
    loaderHost.className = "loader-host";
    el("find-seat-button").insertAdjacentElement("afterend", loaderHost);

    el("find-seat-button").addEventListener("click", runFinder);
    el("binisIstasyonAdi").addEventListener("change", prefetchForHours);
    el("inisIstasyonAdi").addEventListener("change", prefetchForHours);
    el("date").addEventListener("change", prefetchForHours);

    if (!PROXY_URL) {
        showStatus("No proxy configured: TCDD's new API cannot be called directly from a web page. " +
            "Set proxyUrl in config.js (see README).", true);
        return;
    }

    prefetchForHours();
    // Pick up newly added stations in the background; keep the user's selection.
    if (await refreshStationsFromApi()) {
        populateStationSelects(true);
        prefetchForHours();
    }
});
