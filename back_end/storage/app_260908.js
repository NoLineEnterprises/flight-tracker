console.log("FlightTrack is starting...");

function getDistanceMiles(lat1, lon1, lat2, lon2) {

    const earthRadiusMiles = 3958.8;

    const toRadians = degrees =>
        degrees * Math.PI / 180;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadiusMiles * c;
}


function getBearing(lat1, lon1, lat2, lon2) {

    const toRadians = degrees =>
        degrees * Math.PI / 180;

    const toDegrees = radians =>
        radians * 180 / Math.PI;

    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);
    const dLon = toRadians(lon2 - lon1);

    const y =
        Math.sin(dLon) * Math.cos(lat2Rad);

    const x =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.cos(dLon);

    let bearing =
        toDegrees(Math.atan2(y, x));

    bearing = (bearing + 360) % 360;

    return bearing;
}

function getAngleDifference(angle1, angle2) {

    let difference = Math.abs(angle1 - angle2);

    if (difference > 180) {
        difference = 360 - difference;
    }

    return difference;
}

function getElevationAngle(altitudeFeet, distanceMiles) {

    const distanceFeet = distanceMiles * 5280;

    const angleRadians =
        Math.atan(altitudeFeet / distanceFeet);

    return angleRadians * 180 / Math.PI;
}

//############################

function getFutureVisibility(
    myLat,
    myLon,
    planeLat,
    planeLon,
    track,
    speedKnots,
    altitudeFeet
) {

    if (
        !Number.isFinite(track) ||
        !Number.isFinite(speedKnots) ||
        !Number.isFinite(altitudeFeet)
    ) {
        return null;
    }

    // Convert aircraft position to miles east/west and north/south of me
    const latMiles = (planeLat - myLat) * 69;

    const lonMiles =
        (planeLon - myLon) *
        69 *
        Math.cos(myLat * Math.PI / 180);

    // Convert knots to miles per hour
    const speedMph = speedKnots * 1.15078;

    const trackRadians =
        track * Math.PI / 180;

    // Aircraft velocity
    const velocityEast =
        speedMph * Math.sin(trackRadians);

    const velocityNorth =
        speedMph * Math.cos(trackRadians);

    const velocitySquared =
        velocityEast ** 2 +
        velocityNorth ** 2;

    if (velocitySquared === 0) {
        return null;
    }

    // Time until closest point of approach
    const timeHours =
        -(
            lonMiles * velocityEast +
            latMiles * velocityNorth
        ) /
        velocitySquared;

    // Position at closest approach
    const closestEast =
        lonMiles + velocityEast * timeHours;

    const closestNorth =
        latMiles + velocityNorth * timeHours;

    const closestDistance =
        Math.sqrt(
            closestEast ** 2 +
            closestNorth ** 2
        );

    const closestBearing =
        closestDistance > 0
            ? (
                Math.atan2(
                    closestEast,
                    closestNorth
                ) * 180 / Math.PI + 360
            ) % 360
            : null;

    // Maximum horizontal distance where elevation angle is >= 10 degrees
    const maxVisibleDistance =
        altitudeFeet /
        Math.tan(10 * Math.PI / 180) /
        5280;

    // Find when aircraft enters and exits visibility range
    const a = velocitySquared;

    const b =
        2 * (
            lonMiles * velocityEast +
            latMiles * velocityNorth
        );

    const c =
        lonMiles ** 2 +
        latMiles ** 2 -
        maxVisibleDistance ** 2;

    const discriminant =
        b ** 2 - 4 * a * c;

    let visibleStartMinutes = null;
    let visibleEndMinutes = null;
    let visibleDurationMinutes = null;

    if (discriminant >= 0) {

        const sqrtDiscriminant =
            Math.sqrt(discriminant);

        const enterHours =
            (-b - sqrtDiscriminant) /
            (2 * a);

        const exitHours =
            (-b + sqrtDiscriminant) /
            (2 * a);

        // Only care about visibility that exists now or in the future
        if (exitHours > 0) {

            const startHours =
                Math.max(0, enterHours);

            visibleStartMinutes =
                startHours * 60;

            visibleEndMinutes =
                exitHours * 60;

            visibleDurationMinutes =
                (exitHours - startHours) * 60;
        }
    }

    return {
        willBeVisible:
            timeHours > 0 &&
            closestDistance <= maxVisibleDistance,

        minutesToClosest:
            timeHours > 0
                ? timeHours * 60
                : null,

        closestDistance:
            timeHours > 0
                ? closestDistance
                : null,

        closestBearing:
            timeHours > 0
                ? closestBearing
                : null,

        maxVisibleDistance,

        visibleStartMinutes,
        visibleEndMinutes,
        visibleDurationMinutes
    };
}

function getClosestTime(minutesToClosest) {

    const closestTime =
        new Date(Date.now() + minutesToClosest * 60 * 1000);

    return closestTime.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

function getVisibilityTimeRange(futureVisibility) {

    if (
        futureVisibility === null ||
        futureVisibility.visibleStartMinutes === null ||
        futureVisibility.visibleEndMinutes === null
    ) {
        return "Unknown";
    }

    const startTime =
        futureVisibility.visibleStartMinutes <= 0
            ? "Now"
            : getClosestTime(
                futureVisibility.visibleStartMinutes
            );

    const endTime =
        getClosestTime(
            futureVisibility.visibleEndMinutes
        );

    const duration =
        Math.round(
            futureVisibility.visibleDurationMinutes
        );

    return (
        startTime +
        " - " +
        endTime +
        " (" +
        duration +
        " min)"
    );
}

//##############################

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

        let aircraft = data.aircraft;
        const myLat = data.location.lat;
        const myLon = data.location.lon;
        aircraft = aircraft.filter(plane => {

            const distance =
                getDistanceMiles(
                    myLat,
                    myLon,
                    plane.lat,
                    plane.lon
                );

            const elevationAngle =
                Number.isFinite(plane.alt_baro)
                    ? getElevationAngle(
                        plane.alt_baro,
                        distance
                    )
                    : null;

            const visibleNow =
                elevationAngle !== null &&
                elevationAngle >= 10;

            const futureVisibility =
                getFutureVisibility(
                    myLat,
                    myLon,
                    plane.lat,
                    plane.lon,
                    plane.track,
                    plane.gs,
                    plane.alt_baro
                );

            const futureVisible =
                futureVisibility !== null &&
                futureVisibility.willBeVisible;

            return visibleNow || futureVisible;
        });
        //###############

        const location = document.getElementById("location");

        location.textContent =
            "My Location: " + myLat + ", " + myLon;

        status.textContent =
            "Aircraft found: " + aircraft.length;

            const aircraftList = document.getElementById("aircraftList");

            aircraftList.innerHTML = "";

//##################################

            aircraft.sort((a, b) => {

                function getSortData(plane) {

                    const distance =
                        getDistanceMiles(
                            myLat,
                            myLon,
                            plane.lat,
                            plane.lon
                        );

                    const elevationAngle =
                        Number.isFinite(plane.alt_baro)
                            ? getElevationAngle(
                                plane.alt_baro,
                                distance
                            )
                            : null;

                    const visibleNow =
                        elevationAngle !== null &&
                        elevationAngle >= 10;

                    const futureVisibility =
                        getFutureVisibility(
                            myLat,
                            myLon,
                            plane.lat,
                            plane.lon,
                            plane.track,
                            plane.gs,
                            plane.alt_baro
                        );

                    const futureVisible =
                        !visibleNow &&
                        futureVisibility !== null &&
                        futureVisibility.willBeVisible &&
                        futureVisibility.minutesToClosest !== null;

                    return {
                        distance,
                        visibleNow,
                        futureVisible,
                        minutesToClosest:
                            futureVisibility?.minutesToClosest
                    };
                }

                const dataA = getSortData(a);
                const dataB = getSortData(b);

                // 1. Visible aircraft first
                if (dataA.visibleNow !== dataB.visibleNow) {
                    return dataA.visibleNow ? -1 : 1;
                }

                // Visible aircraft: closest first
                if (dataA.visibleNow && dataB.visibleNow) {
                    return dataA.distance - dataB.distance;
                }

                // 2. Future-visible aircraft next
                if (dataA.futureVisible !== dataB.futureVisible) {
                    return dataA.futureVisible ? -1 : 1;
                }

                // Future-visible aircraft: soonest first
                if (dataA.futureVisible && dataB.futureVisible) {
                    return (
                        dataA.minutesToClosest -
                        dataB.minutesToClosest
                    );
                }

                // 3. Everything else: closest first
                return dataA.distance - dataB.distance;
            });

            for (const plane of aircraft) {

                const item = document.createElement("tr");
                const flight = plane.flight || "Unknown";
                const type = plane.t || "Unknown";

                const altitude =
                    Number.isFinite(plane.alt_baro) ? plane.alt_baro : null;

                const speed =
                    Number.isFinite(plane.gs) ? plane.gs : null;

                const direction = plane.track ?? null; 

                const distance =
                    getDistanceMiles(
                        myLat,
                        myLon,
                        plane.lat,
                        plane.lon
                    );

                const elevationAngle =
                    Number.isFinite(plane.alt_baro)
                        ? getElevationAngle(plane.alt_baro, distance)
                        : null;

                const likelyVisible =
                    elevationAngle !== null && elevationAngle >= 10;

                const bearing =
                    getBearing(
                        myLat,
                        myLon,
                        plane.lat,
                        plane.lon
                    );

                const bearingToMe =
                    getBearing(
                        plane.lat,
                        plane.lon,
                        myLat,
                        myLon
                    );

                const trackDifference =
                    direction !== null
                        ? getAngleDifference(direction, bearingToMe)
                        : null;

                const headingTowardMe =
                    trackDifference !== null && trackDifference <= 30;

                const futureVisibility =
                    getFutureVisibility(
                        myLat,
                        myLon,
                        plane.lat,
                        plane.lon,
                        plane.track,
                        plane.gs,
                        plane.alt_baro
                    );

                const displayClosestDistance =
                    futureVisibility !== null &&
                    futureVisibility.closestDistance !== null
                        ? futureVisibility.closestDistance
                        : distance;

                const passedClosestPoint =
                    futureVisibility !== null &&
                    futureVisibility.minutesToClosest === null;

                const displayClosestTime =
                    passedClosestPoint
                        ? getClosestTime(0)
                        : futureVisibility !== null &&
                        futureVisibility.minutesToClosest !== null
                            ? getClosestTime(futureVisibility.minutesToClosest)
                            : "Unknown";

                const displayClosestBearing =
                    passedClosestPoint
                        ? bearing
                        : futureVisibility !== null &&
                        futureVisibility.closestBearing !== null
                            ? futureVisibility.closestBearing
                            : null;

                const displayClosestElevationAngle =
                    altitude !== null
                        ? getElevationAngle(
                            altitude,
                            displayClosestDistance
                        )
                        : null;

                item.innerHTML =
                    "<td>" + flight + "</td>" +
                    "<td>" + type + "</td>" +
                    "<td>" + Math.round(distance) + "</td>" +
                    "<td>" + Math.round(bearing) + "</td>" +
                    "<td>" + Math.round(bearingToMe) + "</td>" +
                    "<td>" + (direction !== null ? Math.round(direction) + "" : "Unknown") + "</td>" +
                    "<td>" + (trackDifference !== null ? Math.round(trackDifference) + "" : "Unknown") + "</td>" +
                    "<td>" + (trackDifference !== null ? (headingTowardMe ? "YES" : "NO") : "Unknown") + "</td>" +
                    
                    "<td>" + (altitude !== null ? Math.round(altitude) : "Unknown") + "</td>" +
                    "<td>" + (speed !== null ? Math.round(speed) : "Unknown") + "</td>" +
                    "<td>" + (elevationAngle !== null ? Math.round(elevationAngle) : "Unknown") + "</td>" +

                    "<td>" + (likelyVisible ? "YES" : "NO") + "</td>" +

                    "<td>" + (futureVisibility !== null
                        ? (!likelyVisible && futureVisibility.willBeVisible ? "YES" : "NO")
                        : "Unknown") + "</td>" +

                    "<td>" + Math.round(displayClosestDistance) + "</td>" +

                    "<td>" + displayClosestTime + "</td>" +

                    "<td>" + (displayClosestBearing !== null
                        ? Math.round(displayClosestBearing)
                        : "Unknown") + "</td>" +

                    "<td>" + (displayClosestElevationAngle !== null
                        ? Math.round(displayClosestElevationAngle)
                        : "Unknown") + "</td>" +

                    "<td>" + getVisibilityTimeRange(futureVisibility) + "</td>";

                        
                aircraftList.appendChild(item);
            }

//#####################################


    } catch (error) {

        console.error("ERROR:", error);

        status.textContent =
            "ERROR: " + error.message;
    }
}

getFlights();