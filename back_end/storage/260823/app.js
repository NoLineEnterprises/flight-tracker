console.log("FlightTrack is starting...");

async function getFlights() {

    const status = document.getElementById("status");

    status.textContent = "Contacting aircraft API...";

    const url = "/api/flights";

    try {

        const response = await fetch(url);

        console.log("API response:", response);

        if (!response.ok) {
            throw new Error("HTTP error " + response.status);
        }

        const data = await response.json();

        console.log("Aircraft data:", data);

        const aircraft = data.ac;

        status.textContent =
            "Aircraft found: " + aircraft.length;

            const aircraftList = document.getElementById("aircraftList");

            aircraftList.innerHTML = "";

            for (const plane of aircraft) {

                const item = document.createElement("li");

                const flight = plane.flight || "Unknown";
                const altitude = plane.alt_baro || "Unknown";
                const speed = plane.gs || "Unknown";

                item.textContent =
                    flight + " | Altitude: " + altitude + " ft | Speed: " + speed + " knots";

                aircraftList.appendChild(item);
            }

    } catch (error) {

        console.error("ERROR:", error);

        status.textContent =
            "ERROR: " + error.message;
    }
}

getFlights();