const http = require("http");

const PORT = process.env.PORT || 3000;

// Default location if no latitude/longitude are supplied.
const defaultLat = 40.58;
const defaultLon = -98.38;

const radius = 500;

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(
        req.url,
        `http://${req.headers.host}`
    );

    // Simple root/health check
    if (requestUrl.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end("FlightTrack backend is running");
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

            if (!response.ok) {
                const errorText =
                    await response.text();

                throw new Error(
                    `ADSB.lol returned ${response.status}: ${errorText}`
                );
            }

            const data =
                await response.json();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                location: {
                    lat: requestedLat,
                    lon: requestedLon
                },
                aircraft: data.ac
            }));

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

    // Anything else
    res.writeHead(404, {
        "Content-Type": "text/plain"
    });

    res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `FlightTrack running on port ${PORT}`
    );
});