const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

const server = http.createServer(async (req, res) => {

    // Our browser will request this address
    if (req.url === "/api/flights") {

        try {
            const apiUrl =
                "https://api.adsb.lol/v2/point/40.5861/-98.3884/50";
            
            const response = await fetch(apiUrl, {
                headers: {
                    "User-Agent": "FlightTrack/0.1",
                    "Accept": "application/json"
    }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `ADSB.lol returned ${response.status}: ${errorText}`
                );
            }

            const data = await response.json();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify(data));

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

    // Serve index.html
    if (req.url === "/" || req.url === "/index.html") {

        const file = fs.readFileSync(
            path.join(__dirname, "index.html")
        );

        res.writeHead(200, {
            "Content-Type": "text/html"
        });

        res.end(file);
        return;
    }

    // Serve app.js
    if (req.url === "/app.js") {

        const file = fs.readFileSync(
            path.join(__dirname, "app.js")
        );

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
    console.log(`FlightTrack running at http://localhost:${PORT}`);
});