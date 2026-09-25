const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

const defaultLat = 40.58;
const defaultLon = -98.38;
const radius = 500;

// Cache the RAW route data.
// We do not cache a selected origin/destination because the same
// callsign can represent different legs of a multi-leg route.
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


// Return the great-circle distance between two coordinates in miles.
function getDistanceMiles(
    lat1,
    lon1,
    lat2,
    lon2
) {
    const earthRadiusMiles = 3958.8;

    const toRadians = (degrees) =>
        degrees * Math.PI / 180;

    const dLat =
        toRadians(lat2 - lat1);

    const dLon =
        toRadians(lon2 - lon1);

    const latitude1 =
        toRadians(lat1);

    const latitude2 =
        toRadians(lat2);

    const a =
        Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
        Math.cos(latitude1) *
        Math.cos(latitude2) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadiusMiles * c;
}


// Return the initial bearing from one coordinate to another.
function getBearing(
    lat1,
    lon1,
    lat2,
    lon2
) {
    const toRadians = (degrees) =>
        degrees * Math.PI / 180;

    const toDegrees = (radians) =>
        radians * 180 / Math.PI;

    const latitude1 =
        toRadians(lat1);

    const latitude2 =
        toRadians(lat2);

    const deltaLon =
        toRadians(lon2 - lon1);

    const y =
        Math.sin(deltaLon) *
        Math.cos(latitude2);

    const x =
        Math.cos(latitude1) *
        Math.sin(latitude2) -
        Math.sin(latitude1) *
        Math.cos(latitude2) *
        Math.cos(deltaLon);

    const bearing =
        toDegrees(Math.atan2(y, x));

    return (bearing + 360) % 360;
}


// Smallest angular difference between two headings.
function getAngleDifference(
    angle1,
    angle2
) {
    const difference =
        Math.abs(angle1 - angle2) % 360;

    return Math.min(
        difference,
        360 - difference
    );
}


function formatAirport(airport) {
    if (!airport) {
        return null;
    }

    return {
        name: airport.name ?? null,
        icao: airport.icao ?? null,
        iata: airport.iata ?? null,
        city: airport.location ?? null
    };
}


// Choose the most likely CURRENT leg from a route.
//
// Example:
//
//     DTW -> PHX -> DTW
//
// A westbound aircraft should resolve to:
//
//     DTW -> PHX
//
// An eastbound aircraft should resolve to:
//
//     PHX -> DTW
//
function selectCurrentRouteLeg(
    airports,
    aircraftLat,
    aircraftLon,
    aircraftTrack
) {
    if (
        !Array.isArray(airports) ||
        airports.length < 2
    ) {
        return null;
    }

    // If there is only one possible leg, no decision is necessary.
    if (airports.length === 2) {
        return {
            origin: airports[0],
            destination: airports[1]
        };
    }

    const hasPosition =
        Number.isFinite(aircraftLat) &&
        Number.isFinite(aircraftLon);

    const hasTrack =
        Number.isFinite(aircraftTrack);

    // Without aircraft position/heading, we cannot reliably determine
    // which leg of a multi-leg route is currently being flown.
    if (!hasPosition || !hasTrack) {
        return null;
    }

    let bestLeg = null;
    let bestScore = Infinity;

    for (
        let index = 0;
        index < airports.length - 1;
        index++
    ) {
        const origin =
            airports[index];

        const destination =
            airports[index + 1];

        if (
            !Number.isFinite(origin?.lat) ||
            !Number.isFinite(origin?.lon) ||
            !Number.isFinite(destination?.lat) ||
            !Number.isFinite(destination?.lon)
        ) {
            continue;
        }

        // How closely is the aircraft currently pointed toward
        // this possible destination?
        const bearingToDestination =
            getBearing(
                aircraftLat,
                aircraftLon,
                destination.lat,
                destination.lon
            );

        const headingDifference =
            getAngleDifference(
                aircraftTrack,
                bearingToDestination
            );

        // Also consider where the aircraft is geographically relative
        // to the two airports forming this leg.
        const distanceFromOrigin =
            getDistanceMiles(
                aircraftLat,
                aircraftLon,
                origin.lat,
                origin.lon
            );

        const distanceToDestination =
            getDistanceMiles(
                aircraftLat,
                aircraftLon,
                destination.lat,
                destination.lon
            );

        const legLength =
            getDistanceMiles(
                origin.lat,
                origin.lon,
                destination.lat,
                destination.lon
            );

        // If the aircraft is reasonably associated with this leg,
        // distanceFromOrigin + distanceToDestination should be fairly
        // close to the total length of the leg.
        //
        // This value grows when the aircraft is far away from the
        // geographic corridor between the two airports.
        const routeDistanceError =
            Math.max(
                0,
                (
                    distanceFromOrigin +
                    distanceToDestination
                ) - legLength
            );

        // Heading is the strongest clue for routes that contain the
        // same airports in opposite directions.
        //
        // Geographic position is used as a secondary clue.
        const score =
            headingDifference * 5 +
            routeDistanceError;

        if (score < bestScore) {
            bestScore = score;

            bestLeg = {
                origin,
                destination
            };
        }
    }

    return bestLeg;
}


// Look up the route that is plausible for THIS aircraft position.
//
// Unlike the old standing-data lookup, routeset receives the
// aircraft's current position. This helps when the same callsign
// is reused for different routes.
async function getRouteDataForFlight(
    flight,
    aircraftLat,
    aircraftLon
) {

    if (typeof flight !== "string") {
        return null;
    }

    const callsign =
        flight.trim().toUpperCase();

    if (callsign.length < 2) {
        return null;
    }

    if (
        !Number.isFinite(aircraftLat) ||
        !Number.isFinite(aircraftLon)
    ) {
        return null;
    }

    // Include a coarse aircraft position in the cache key.
    // Callsign-only caching could preserve the wrong route when
    // a flight number is reused.
    const cacheKey =
        `${callsign}:${aircraftLat.toFixed(1)},${aircraftLon.toFixed(1)}`;

    const cached =
        routeCache.get(cacheKey);

    if (
        cached &&
        Date.now() - cached.timestamp < ROUTE_CACHE_MS
    ) {
        return cached.data;
    }

    const routeUrl =
        "https://api.adsb.lol/api/0/routeset";

    try {

        const response =
            await fetch(routeUrl, {
                method: "POST",
                headers: {
                    "User-Agent": "FlightTrack/0.1",
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    planes: [
                        {
                            callsign,
                            lat: aircraftLat,
                            lng: aircraftLon
                        }
                    ]
                })
            });

        if (!response.ok) {

            routeCache.set(cacheKey, {
                timestamp: Date.now(),
                data: null
            });

            return null;
        }

        const result =
            await response.json();

        const data =
            Array.isArray(result)
                ? result[0]
                : null;

        if (
            !data ||
            !Array.isArray(data._airports) ||
            data._airports.length < 2
        ) {

            routeCache.set(cacheKey, {
                timestamp: Date.now(),
                data: null
            });

            return null;
        }

        // Cache the complete route response rather than one selected
        // origin/destination pair.
        routeCache.set(cacheKey, {
            timestamp: Date.now(),
            data
        });

        return data;

    } catch (error) {

        console.error(
            "Route lookup error:",
            callsign,
            error
        );

        return null;
    }
}


async function getRouteForFlight(
    flight,
    aircraftLat,
    aircraftLon,
    aircraftTrack
) {
    const data =
        await getRouteDataForFlight(
            flight,
            aircraftLat,
            aircraftLon
        );

    if (
        !data ||
        !Array.isArray(data._airports) ||
        data._airports.length < 2
    ) {
        return null;
    }

    const airports =
        data._airports;

    let selectedLeg = null;

    if (airports.length === 2) {

        selectedLeg = {
            origin: airports[0],
            destination: airports[1]
        };

    } else {

        selectedLeg =
            selectCurrentRouteLeg(
                airports,
                aircraftLat,
                aircraftLon,
                aircraftTrack
            );
    }

    if (!selectedLeg) {

        console.warn(
            `Could not determine current route leg for ${flight}`
        );

        return null;
    }

    console.log(
        `Route ${flight}: ` +
        `${selectedLeg.origin?.iata ?? selectedLeg.origin?.icao ?? "?"}` +
        " -> " +
        `${selectedLeg.destination?.iata ?? selectedLeg.destination?.icao ?? "?"}`
    );

    return {
        origin:
            formatAirport(
                selectedLeg.origin
            ),

        destination:
            formatAirport(
                selectedLeg.destination
            )
    };
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


        // Current aircraft information supplied by the frontend.
        const latParam =
            requestUrl.searchParams.get("lat");

        const lonParam =
            requestUrl.searchParams.get("lon");

        const trackParam =
            requestUrl.searchParams.get("track");


        const aircraftLat =
            latParam !== null
                ? Number(latParam)
                : NaN;

        const aircraftLon =
            lonParam !== null
                ? Number(lonParam)
                : NaN;

        const aircraftTrack =
            trackParam !== null
                ? Number(trackParam)
                : NaN;


        const route =
            await getRouteForFlight(
                callsign,
                aircraftLat,
                aircraftLon,
                aircraftTrack
            );


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


            const response =
                await fetch(apiUrl, {
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