const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

const defaultLat = 40.58;
const defaultLon = -98.38;
const radius = 500;

const routeCache = new Map();
const ROUTE_CACHE_MS = 60 * 60 * 1000;

// Last successful aircraft data, stored separately by approximate location.
const aircraftCache = new Map();
const AIRCRAFT_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getAircraftCacheKey(lat, lon) {
    // Prevent tiny GPS changes from creating a different cache every minute.
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function sendAircraftResponse(
    res,
    requestedLat,
    requestedLon,
    aircraft,
    cached,
    timestamp
) {
    res.writeHead(200, {
        "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
        location: {
            lat: requestedLat,
            lon: requestedLon
        },
        aircraft,
        cached,
        dataAgeSeconds: Math.max(
            0,
            Math.floor((Date.now() - timestamp) / 1000)
        )
    }));
}

async function getRouteForFlight(flight) {

    if (typeof flight !== "string") {
        return null;
    }

    const callsign =
        flight.trim().toUpperCase();

    if (callsign.length < 2) {
        return null;
    }

    const cached =
        routeCache.get(callsign);

    if (
        cached &&
        Date.now() - cached.timestamp < ROUTE_CACHE_MS
    ) {
        return cached.route;
    }

    const prefix =
        callsign.substring(0, 2);

    const routeUrl =
        `https://vrs-standing-data.adsb.lol/routes/${prefix}/${encodeURIComponent(callsign)}.json`;

    try {

        const response =
            await fetch(routeUrl, {
                headers: {
                    "User-Agent": "FlightTrack/0.1",
                    "Accept": "application/json"
                }
            });

        if (!response.ok) {

            routeCache.set(callsign, {
                timestamp: Date.now(),
                route: null
            });

            return null;
        }

        const data =
            await response.json();

        if (
            !Array.isArray(data._airports) ||
            data._airports.length < 2
        ) {

            routeCache.set(callsign, {
                timestamp: Date.now(),
                route: null
            });

            return null;
        }

        const origin =
            data._airports[0];

        const destination =
            data._airports[data._airports.length - 1];

        const route = {
            origin: {
                name: origin.name ?? null,
                icao: origin.icao ?? null,
                iata: origin.iata ?? null,
                city: origin.location ?? null
            },
            destination: {
                name: destination.name ?? null,
                icao: destination.icao ?? null,
                iata: destination.iata ?? null,
                city: destination.location ?? null
            }
        };

        routeCache.set(callsign, {
            timestamp: Date.now(),
            route
        });

        return route;

    } catch (error) {

        console.error(
            "Route lookup error:",
            callsign,
            error
        );

        return null;
    }
}

const server = http.createServer(async (req, res) => {

    const requestUrl = new URL(
        req.url,
        `http://${req.headers.host}`
    );

    // Flight origin/destination API
    if (requestUrl.pathname === "/api/route") {

        const flight =
            requestUrl.searchParams.get("flight");

        if (!flight) {

            res.writeHead(400, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                error: "Flight callsign is required"
            }));

            return;
        }

        const callsign =
            flight.trim().toUpperCase();

        const route =
            await getRouteForFlight(callsign);

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
            flight: callsign,
            origin: route?.origin ?? null,
            destination: route?.destination ?? null
        }));

        return;
    }

    // Aircraft API
    if (requestUrl.pathname === "/api/flights") {

        try {

            const latParam =
                requestUrl.searchParams.get("lat");

            const lonParam =
                requestUrl.searchParams.get("lon");

            const requestedLat =
                latParam !== null
                    ? Number(latParam)
                    : defaultLat;

            const requestedLon =
                lonParam !== null
                    ? Number(lonParam)
                    : defaultLon;

            if (
                !Number.isFinite(requestedLat) ||
                !Number.isFinite(requestedLon) ||
                requestedLat < -90 ||
                requestedLat > 90 ||
                requestedLon < -180 ||
                requestedLon > 180
            ) {
                res.writeHead(400, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    error: "Invalid latitude or longitude"
                }));

                return;
            }

            const cacheKey =
                getAircraftCacheKey(
                    requestedLat,
                    requestedLon
                );

            const apiUrl =
                `https://api.adsb.lol/v2/point/${requestedLat}/${requestedLon}/${radius}`;

            console.log(
                `Getting aircraft near ${requestedLat}, ${requestedLon}`
            );

            const response = await fetch(apiUrl, {
                headers: {
                    "User-Agent": "FlightTrack/0.1",
                    "Accept": "application/json"
                }
            });

            if (response.ok) {

                const data =
                    await response.json();

                const aircraft =
                    Array.isArray(data.ac)
                        ? data.ac
                        : [];

                const timestamp =
                    Date.now();

                // Save every successful ADSB.lol response.
                aircraftCache.set(cacheKey, {
                    timestamp,
                    aircraft
                });

                console.log(
                    `Fresh aircraft data received for ${cacheKey}`
                );

                sendAircraftResponse(
                    res,
                    requestedLat,
                    requestedLon,
                    aircraft,
                    false,
                    timestamp
                );

                return;
            }

            const errorText =
                await response.text();

            console.warn(
                `ADSB.lol returned ${response.status} for ${cacheKey}`
            );

            const cached =
                aircraftCache.get(cacheKey);

            const cacheAgeMs =
                cached
                    ? Date.now() - cached.timestamp
                    : Infinity;

            // If ADSB.lol temporarily fails, use the most recent
            // successful response if it is no more than 5 minutes old.
            if (
                cached &&
                cacheAgeMs <= AIRCRAFT_CACHE_MAX_AGE_MS
            ) {

                console.warn(
                    `Using cached aircraft data for ${cacheKey}; age ${Math.floor(cacheAgeMs / 1000)} seconds`
                );

                sendAircraftResponse(
                    res,
                    requestedLat,
                    requestedLon,
                    cached.aircraft,
                    true,
                    cached.timestamp
                );

                return;
            }

            throw new Error(
                `ADSB.lol returned ${response.status}: ${errorText}`
            );

        } catch (error) {

            console.error(error);

            res.writeHead(500, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                error: "Could not get aircraft data"
            }));
        }

        return;
    }

    // Serve the old browser version when those files exist.
    if (
        requestUrl.pathname === "/" ||
        requestUrl.pathname === "/index.html"
    ) {

        const indexPath =
            path.join(__dirname, "index.html");

        if (fs.existsSync(indexPath)) {

            const file =
                fs.readFileSync(indexPath);

            res.writeHead(200, {
                "Content-Type": "text/html"
            });

            res.end(file);

        } else {

            res.writeHead(200, {
                "Content-Type": "text/plain"
            });

            res.end(
                "FlightTrack API is running"
            );
        }

        return;
    }

    // Serve app.js only when the old browser file exists.
    if (requestUrl.pathname === "/app.js") {

        const appPath =
            path.join(__dirname, "app.js");

        if (!fs.existsSync(appPath)) {

            res.writeHead(404, {
                "Content-Type": "text/plain"
            });

            res.end("Not found");
            return;
        }

        const file =
            fs.readFileSync(appPath);

        res.writeHead(200, {
            "Content-Type": "text/javascript"
        });

        res.end(file);
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(
        `FlightTrack running at http://localhost:${PORT}`
    );
});