export function getDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const earthRadiusMiles = 3958.8;

  const toRadians = (degrees: number) =>
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


export function getBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRadians = (degrees: number) =>
    degrees * Math.PI / 180;

  const toDegrees = (radians: number) =>
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


export function getAngleDifference(
  angle1: number,
  angle2: number
) {
  let difference = Math.abs(angle1 - angle2);

  if (difference > 180) {
    difference = 360 - difference;
  }

  return difference;
}


export function getElevationAngle(
  altitudeFeet: number,
  distanceMiles: number
) {
  const distanceFeet = distanceMiles * 5280;

  const angleRadians =
    Math.atan(altitudeFeet / distanceFeet);

  return angleRadians * 180 / Math.PI;
}


function interpolateScore(
  value: number,
  points: Array<[number, number]>
) {
  if (value <= points[0][0]) {
    return points[0][1];
  }

  for (
    let index = 1;
    index < points.length;
    index++
  ) {
    const [upperValue, upperScore] =
      points[index];

    const [lowerValue, lowerScore] =
      points[index - 1];

    if (value <= upperValue) {
      const fraction =
        (value - lowerValue) /
        (upperValue - lowerValue);

      return (
        lowerScore +
        fraction *
        (upperScore - lowerScore)
      );
    }
  }

  return points[points.length - 1][1];
}


export type VisibilityConfidence = {
  score: number;
  rawScore: number;
  angleScore: number;
  timeScore: number;
  distanceScore: number;
  distanceCap: number | null;
  capApplied: boolean;
};


export function getVisibilityConfidence(
  predictedMaxElevation: number | null,
  minutesToClosest: number | null,
  currentDistanceMiles: number
): VisibilityConfidence | null {

  if (
    predictedMaxElevation === null ||
    minutesToClosest === null ||
    !Number.isFinite(predictedMaxElevation) ||
    !Number.isFinite(minutesToClosest) ||
    !Number.isFinite(currentDistanceMiles)
  ) {
    return null;
  }

  // Factor 1: predicted maximum elevation angle.
  // Higher passes are easier to see.
  const angleScore =
    interpolateScore(
      Math.max(0, predictedMaxElevation),
      [
        [0, 0],
        [5, 20],
        [10, 40],
        [20, 60],
        [30, 75],
        [45, 90],
        [60, 100],
        [90, 100],
      ]
    );

  // Factor 2: time until closest approach.
  // Less time means less opportunity for the aircraft
  // to turn or otherwise deviate from its current path.
  const timeScore =
    interpolateScore(
      Math.max(0, minutesToClosest),
      [
        [0, 100],
        [5, 100],
        [15, 95],
        [30, 85],
        [60, 70],
        [90, 55],
        [120, 40],
        [180, 20],
        [240, 10],
        [360, 0],
      ]
    );

  // Factor 3: current distance from the observer.
  // A closer aircraft has less distance over which its
  // current projected path can become inaccurate.
  const distanceScore =
    interpolateScore(
      Math.max(0, currentDistanceMiles),
      [
        [0, 100],
        [25, 100],
        [50, 95],
        [100, 85],
        [200, 70],
        [300, 55],
        [400, 40],
        [500, 25],
        [750, 10],
        [1000, 0],
      ]
    );

  // Initial experimental weighting:
  // 50% maximum elevation
  // 30% time to closest approach
  // 20% current distance
  const rawScore =
    angleScore * 0.50 +
    timeScore * 0.30 +
    distanceScore * 0.20;

  // Distance-based confidence ceilings.
  // Even if the projected pass looks excellent,
  // a distant aircraft has more opportunity to
  // deviate from its current heading before arrival.
  let distanceCap: number | null = null;

  if (currentDistanceMiles > 400) {
    distanceCap = 20;
  } else if (currentDistanceMiles > 300) {
    distanceCap = 40;
  } else if (currentDistanceMiles > 200) {
    distanceCap = 60;
  } else if (currentDistanceMiles > 100) {
    distanceCap = 80;
  }

  const cappedScore =
    distanceCap !== null
      ? Math.min(rawScore, distanceCap)
      : rawScore;

  return {
    score:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(cappedScore)
        )
      ),
    rawScore:
      Math.round(rawScore * 10) / 10,
    angleScore:
      Math.round(angleScore),
    timeScore:
      Math.round(timeScore),
    distanceScore:
      Math.round(distanceScore),
    distanceCap,
    capApplied:
      distanceCap !== null &&
      rawScore > distanceCap,
  };
}


export function formatVisibilityConfidence(
  confidence: VisibilityConfidence | null
) {
  if (confidence === null) {
    return "Unknown";
  }

  const score = confidence.score;

  if (score <= 14) {
    return "<20%";
  }

  if (score >= 95) {
    return ">90%";
  }

  const rounded =
    Math.round(score / 10) * 10;

  return rounded + "%";
}



export type TrackVisibilityGeometry = {
  closestDistance: number;
  closestAlongTrackMiles: number;
  nearIntersectionMiles: number | null;
  farIntersectionMiles: number | null;
  maxVisibleDistance: number;
};


export function getTrackVisibilityGeometry(
  myLat: number,
  myLon: number,
  planeLat: number,
  planeLon: number,
  track: number,
  altitudeFeet: number
): TrackVisibilityGeometry | null {

  if (
    !Number.isFinite(myLat) ||
    !Number.isFinite(myLon) ||
    !Number.isFinite(planeLat) ||
    !Number.isFinite(planeLon) ||
    !Number.isFinite(track) ||
    !Number.isFinite(altitudeFeet)
  ) {
    return null;
  }

  const earthRadiusMiles = 3958.8;

  const startToObserverMiles =
    getDistanceMiles(
      planeLat,
      planeLon,
      myLat,
      myLon
    );

  const startToObserverRadians =
    startToObserverMiles /
    earthRadiusMiles;

  const bearingToObserverRadians =
    getBearing(
      planeLat,
      planeLon,
      myLat,
      myLon
    ) * Math.PI / 180;

  const trackRadians =
    track * Math.PI / 180;

  const bearingDifference =
    bearingToObserverRadians -
    trackRadians;

  const crossTrackRadians =
    Math.asin(
      Math.sin(startToObserverRadians) *
      Math.sin(bearingDifference)
    );

  const closestDistance =
    Math.abs(crossTrackRadians) *
    earthRadiusMiles;

  const closestAlongTrackRadians =
    Math.atan2(
      Math.sin(startToObserverRadians) *
      Math.cos(bearingDifference),
      Math.cos(startToObserverRadians)
    );

  const closestAlongTrackMiles =
    closestAlongTrackRadians *
    earthRadiusMiles;

  const maxVisibleDistance =
    altitudeFeet /
    Math.tan(30 * Math.PI / 180) /
    5280;

  const maxVisibleRadians =
    maxVisibleDistance /
    earthRadiusMiles;

  const absoluteCrossTrackRadians =
    Math.abs(crossTrackRadians);

  if (
    absoluteCrossTrackRadians >
    maxVisibleRadians
  ) {
    return {
      closestDistance,
      closestAlongTrackMiles,
      nearIntersectionMiles: null,
      farIntersectionMiles: null,
      maxVisibleDistance,
    };
  }

  const ratio =
    Math.cos(maxVisibleRadians) /
    Math.cos(absoluteCrossTrackRadians);

  const clampedRatio =
    Math.max(-1, Math.min(1, ratio));

  const intersectionOffsetRadians =
    Math.acos(clampedRatio);

  const intersectionOffsetMiles =
    intersectionOffsetRadians *
    earthRadiusMiles;

  const nearIntersectionMiles =
    closestAlongTrackMiles -
    intersectionOffsetMiles;

  const farIntersectionMiles =
    closestAlongTrackMiles +
    intersectionOffsetMiles;

  return {
    closestDistance,
    closestAlongTrackMiles,
    nearIntersectionMiles,
    farIntersectionMiles,
    maxVisibleDistance,
  };
}


export type FutureVisibility = {
  willBeVisible: boolean;
  minutesToClosest: number | null;
  closestDistance: number | null;
  closestBearing: number | null;
  maxVisibleDistance: number;
  visibleStartMinutes: number | null;
  visibleEndMinutes: number | null;
  visibleDurationMinutes: number | null;
};


export function getFutureVisibility(
  myLat: number,
  myLon: number,
  planeLat: number,
  planeLon: number,
  track: number,
  speedKnots: number,
  altitudeFeet: number
): FutureVisibility | null {

  if (
    !Number.isFinite(track) ||
    !Number.isFinite(speedKnots) ||
    !Number.isFinite(altitudeFeet) ||
    speedKnots <= 0
  ) {
    return null;
  }

  const geometry =
    getTrackVisibilityGeometry(
      myLat,
      myLon,
      planeLat,
      planeLon,
      track,
      altitudeFeet
    );

  if (geometry === null) {
    return null;
  }

  const speedMph =
    speedKnots * 1.15078;

  const minutesToClosest =
    geometry.closestAlongTrackMiles > 0
      ? geometry.closestAlongTrackMiles /
        speedMph * 60
      : null;

  let visibleStartMinutes: number | null = null;
  let visibleEndMinutes: number | null = null;
  let visibleDurationMinutes: number | null = null;

  if (
    geometry.farIntersectionMiles !== null &&
    geometry.farIntersectionMiles > 0
  ) {
    const startMiles =
      Math.max(
        0,
        geometry.nearIntersectionMiles ?? 0
      );

    visibleStartMinutes =
      startMiles / speedMph * 60;

    visibleEndMinutes =
      geometry.farIntersectionMiles /
      speedMph * 60;

    visibleDurationMinutes =
      visibleEndMinutes -
      visibleStartMinutes;
  }

  return {
    willBeVisible:
      geometry.farIntersectionMiles !== null &&
      geometry.farIntersectionMiles > 0,

    minutesToClosest,

    closestDistance:
      minutesToClosest !== null
        ? geometry.closestDistance
        : null,

    closestBearing:
      minutesToClosest !== null
        ? getBearing(
            myLat,
            myLon,
            planeLat,
            planeLon
          )
        : null,

    maxVisibleDistance:
      geometry.maxVisibleDistance,

    visibleStartMinutes,
    visibleEndMinutes,
    visibleDurationMinutes
  };
}


export function getClosestTime(
  minutesToClosest: number
) {
  const closestTime =
    new Date(
      Date.now() +
      minutesToClosest * 60 * 1000
    );

  return closestTime.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}


export function getVisibilityTimeRange(
  futureVisibility: FutureVisibility | null
) {
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
      futureVisibility.visibleDurationMinutes ?? 0
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
