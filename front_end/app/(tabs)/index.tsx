import { Fragment, useEffect, useState } from 'react';

import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';


import {
  formatVisibilityConfidence,
  getBearing,
  getClosestTime,
  getDistanceMiles,
  getElevationAngle,
  getFutureVisibility,
  getVisibilityConfidence,
  getVisibilityTimeRange,
} from '../../src/flightCalculations';

const API_BASE_URL =
  //'http://192.168.1.65:3000/api/flights';
  'https://flight-tracker-nnuj.onrender.com/api/flights';

const DEFAULT_SAVED_LAT = '40.58';
const DEFAULT_SAVED_LON = '-98.38';

type LocationMode =
  | 'phone'
  | 'saved';

type Aircraft = {
  flight?: string;
  hex?: string;
  t?: string;
  lat: number;
  lon: number;
  alt_baro?: number;
  track?: number;
  gs?: number;
};

type ApiResponse = {
  location: {
    lat: number;
    lon: number;
  };
  aircraft: Aircraft[];
};

function getMapFlightData(
  plane: Aircraft,
  observerLat: number,
  observerLon: number
) {
  const altitude =
    typeof plane.alt_baro === 'number'
      ? plane.alt_baro
      : null;

  const speed =
    typeof plane.gs === 'number'
      ? plane.gs
      : null;

  const track =
    typeof plane.track === 'number'
      ? plane.track
      : null;

  const distance =
    getDistanceMiles(
      observerLat,
      observerLon,
      plane.lat,
      plane.lon
    );

  const bearing =
    getBearing(
      observerLat,
      observerLon,
      plane.lat,
      plane.lon
    );

  const elevationAngle =
    altitude !== null
      ? getElevationAngle(
          altitude,
          distance
        )
      : null;

  const futureVisibility =
    track !== null &&
    speed !== null &&
    altitude !== null
      ? getFutureVisibility(
          observerLat,
          observerLon,
          plane.lat,
          plane.lon,
          track,
          speed,
          altitude
        )
      : null;

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
      : futureVisibility
          ?.minutesToClosest !== null &&
        futureVisibility
          ?.minutesToClosest !== undefined
        ? getClosestTime(
            futureVisibility.minutesToClosest
          )
        : 'Unknown';

  const displayClosestBearing =
    passedClosestPoint
      ? bearing
      : futureVisibility
          ?.closestBearing ?? null;

  const displayClosestElevation =
    altitude !== null
      ? getElevationAngle(
          altitude,
          displayClosestDistance
        )
      : null;

  const confidenceMinutesToClosest =
    passedClosestPoint
      ? 0
      : futureVisibility
          ?.minutesToClosest ?? null;

  const visibilityConfidence =
    getVisibilityConfidence(
      displayClosestElevation,
      confidenceMinutesToClosest,
      distance
    );

  return {
    altitude,
    speed,
    track,
    distance,
    bearing,
    elevationAngle,
    visibleTime:
      getVisibilityTimeRange(
        futureVisibility
      ),
    displayClosestTime,
    displayClosestDistance,
    displayClosestBearing,
    displayClosestElevation,
    confidenceMinutesToClosest,
    visibilityConfidence,
  };
}


function getDistanceConfidenceCap(
  distanceMiles: number
) {
  if (distanceMiles > 400) {
    return 20;
  }

  if (distanceMiles > 300) {
    return 40;
  }

  if (distanceMiles > 200) {
    return 60;
  }

  if (distanceMiles > 100) {
    return 80;
  }

  return null;
}


function getVisibilityRadiusMeters(
  altitudeFeet: number,
  elevationDegrees: number
) {
  const elevationRadians =
    elevationDegrees * Math.PI / 180;

  const horizontalDistanceFeet =
    altitudeFeet /
    Math.tan(elevationRadians);

  return horizontalDistanceFeet * 0.3048;
}




function getRingLabelCoordinate(
  centerLat: number,
  centerLon: number,
  radiusMeters: number
) {
  const earthRadiusMeters = 6371000;

  const lat1 =
    centerLat * Math.PI / 180;

  const lon1 =
    centerLon * Math.PI / 180;

  const angularDistance =
    radiusMeters / earthRadiusMeters;

  // Put the label at the north edge of each ring.
  const lat2 =
    Math.asin(
      Math.sin(lat1) *
        Math.cos(angularDistance) +
      Math.cos(lat1) *
        Math.sin(angularDistance)
    );

  return {
    latitude:
      lat2 * 180 / Math.PI,
    longitude:
      lon1 * 180 / Math.PI,
  };
}

function getDestinationCoordinate(
  startLat: number,
  startLon: number,
  bearingDegrees: number,
  distanceMeters: number
) {
  const earthRadiusMeters = 6371000;

  const bearing =
    bearingDegrees * Math.PI / 180;

  const lat1 =
    startLat * Math.PI / 180;

  const lon1 =
    startLon * Math.PI / 180;

  const angularDistance =
    distanceMeters / earthRadiusMeters;

  const lat2 =
    Math.asin(
      Math.sin(lat1) *
        Math.cos(angularDistance) +
      Math.cos(lat1) *
        Math.sin(angularDistance) *
        Math.cos(bearing)
    );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) *
        Math.sin(angularDistance) *
        Math.cos(lat1),
      Math.cos(angularDistance) -
        Math.sin(lat1) *
        Math.sin(lat2)
    );

  return {
    latitude:
      lat2 * 180 / Math.PI,
    longitude:
      lon2 * 180 / Math.PI,
  };
}


function getHeadingLineLengthMeters(
  observerLat: number,
  observerLon: number,
  aircraftLat: number,
  aircraftLon: number,
  trackDegrees: number,
  altitudeFeet: number
) {
  const milesToMeters = 1609.344;
  const extraDistanceMeters =
    10 * milesToMeters;

  const ringRadiusMeters =
    getVisibilityRadiusMeters(
      altitudeFeet,
      10
    );

  const aircraftDistanceMeters =
    getDistanceMiles(
      observerLat,
      observerLon,
      aircraftLat,
      aircraftLon
    ) * milesToMeters;

  const bearingToAircraft =
    getBearing(
      observerLat,
      observerLon,
      aircraftLat,
      aircraftLon
    ) * Math.PI / 180;

  const track =
    trackDegrees * Math.PI / 180;

  // Aircraft position relative to the observer.
  // x = east/west, y = north/south.
  const x =
    aircraftDistanceMeters *
    Math.sin(bearingToAircraft);

  const y =
    aircraftDistanceMeters *
    Math.cos(bearingToAircraft);

  // Unit vector in the aircraft's current direction.
  const vx = Math.sin(track);
  const vy = Math.cos(track);

  // Solve where the aircraft's forward path crosses
  // the 10-degree visibility circle.
  const dot =
    x * vx +
    y * vy;

  const discriminant =
    dot * dot -
    (
      aircraftDistanceMeters *
      aircraftDistanceMeters -
      ringRadiusMeters *
      ringRadiusMeters
    );

  if (discriminant >= 0) {
    const root =
      Math.sqrt(discriminant);

    const firstIntersection =
      -dot - root;

    const secondIntersection =
      -dot + root;

    const forwardIntersections =
      [
        firstIntersection,
        secondIntersection,
      ].filter(
        distance => distance >= 0
      );

    if (forwardIntersections.length > 0) {
      const farIntersection =
        Math.max(
          ...forwardIntersections
        );

      return (
        farIntersection +
        extraDistanceMeters
      );
    }
  }

  // Fallback if the projected path does not
  // intersect the 10-degree circle.
  return extraDistanceMeters;
}


function getFlightMapRegion(
  observerLat: number,
  observerLon: number,
  plane: Aircraft
) {
  const latitudes = [
    observerLat,
    plane.lat,
  ];

  const longitudes = [
    observerLon,
    plane.lon,
  ];

  if (
    typeof plane.alt_baro === 'number'
  ) {
    const ringRadiusMeters =
      getVisibilityRadiusMeters(
        plane.alt_baro,
        10
      );

    const latRadiusDegrees =
      ringRadiusMeters / 111320;

    const lonRadiusDegrees =
      ringRadiusMeters /
      (
        111320 *
        Math.cos(
          observerLat *
          Math.PI / 180
        )
      );

    latitudes.push(
      observerLat + latRadiusDegrees,
      observerLat - latRadiusDegrees
    );

    longitudes.push(
      observerLon + lonRadiusDegrees,
      observerLon - lonRadiusDegrees
    );
  }

  if (
    typeof plane.track === 'number' &&
    typeof plane.alt_baro === 'number'
  ) {
    const headingEnd =
      getDestinationCoordinate(
        plane.lat,
        plane.lon,
        plane.track,
        getHeadingLineLengthMeters(
          observerLat,
          observerLon,
          plane.lat,
          plane.lon,
          plane.track,
          plane.alt_baro
        )
      );

    latitudes.push(
      headingEnd.latitude
    );

    longitudes.push(
      headingEnd.longitude
    );
  }

  const minLat =
    Math.min(...latitudes);

  const maxLat =
    Math.max(...latitudes);

  const minLon =
    Math.min(...longitudes);

  const maxLon =
    Math.max(...longitudes);

  return {
    latitude:
      (minLat + maxLat) / 2,
    longitude:
      (minLon + maxLon) / 2,
    latitudeDelta:
      Math.max(
        (maxLat - minLat) * 1.25,
        0.25
      ),
    longitudeDelta:
      Math.max(
        (maxLon - minLon) * 1.25,
        0.25
      ),
  };
}


export default function HomeScreen() {

  const [aircraft, setAircraft] =
    useState<Aircraft[]>([]);

  const [myLat, setMyLat] =
    useState<number | null>(null);

  const [myLon, setMyLon] =
    useState<number | null>(null);

  const [status, setStatus] =
    useState('Waiting for flight data...');

const [expandedCards, setExpandedCards] =
  useState<string[]>([]);

const [mapPlane, setMapPlane] =
  useState<Aircraft | null>(null);

const [
  expandedConfidenceCards,
  setExpandedConfidenceCards,
] = useState<string[]>([]);

const [
  mapConfidenceExpanded,
  setMapConfidenceExpanded,
] = useState(false);

const [locationMode, setLocationMode] =
  useState<LocationMode>('saved');

const [savedLatText, setSavedLatText] =
  useState(DEFAULT_SAVED_LAT);

const [savedLonText, setSavedLonText] =
  useState(DEFAULT_SAVED_LON);

const [locationSettingsLoaded, setLocationSettingsLoaded] =
  useState(false);


  async function getFlights(
    observerLat: number,
    observerLon: number
  ) {

    try {

      setStatus('Contacting aircraft API...');

      const requestUrl =
        API_BASE_URL +
        '?lat=' +
        encodeURIComponent(observerLat) +
        '&lon=' +
        encodeURIComponent(observerLon);

      const response =
        await fetch(requestUrl);

      if (!response.ok) {
        throw new Error(
          'HTTP error ' + response.status
        );
      }

      const data: ApiResponse =
        await response.json();

      setMyLat(data.location.lat);
      setMyLon(data.location.lon);

      const filteredAircraft =
        data.aircraft.filter((plane) => {

          if (
            !Number.isFinite(plane.lat) ||
            !Number.isFinite(plane.lon)
          ) {
            return false;
          }

          const distance =
            getDistanceMiles(
              data.location.lat,
              data.location.lon,
              plane.lat,
              plane.lon
            );

          const altitude =
            typeof plane.alt_baro === 'number'
              ? plane.alt_baro
              : null;

          const elevationAngle =
            altitude !== null
              ? getElevationAngle(
                  altitude,
                  distance
                )
              : null;

          const visibleNow =
            elevationAngle !== null &&
            elevationAngle >= 10;

          const futureVisibility =
            typeof plane.track === 'number' &&
            typeof plane.gs === 'number' &&
            altitude !== null
              ? getFutureVisibility(
                  data.location.lat,
                  data.location.lon,
                  plane.lat,
                  plane.lon,
                  plane.track,
                  plane.gs,
                  altitude
                )
              : null;

          const futureVisible =
            futureVisibility !== null &&
            futureVisibility.willBeVisible;

          return visibleNow || futureVisible;
        });

      filteredAircraft.sort((a, b) => {

        function getSortData(
          plane: Aircraft
        ) {

          const distance =
            getDistanceMiles(
              data.location.lat,
              data.location.lon,
              plane.lat,
              plane.lon
            );

          const altitude =
            typeof plane.alt_baro === 'number'
              ? plane.alt_baro
              : null;

          const elevationAngle =
            altitude !== null
              ? getElevationAngle(
                  altitude,
                  distance
                )
              : null;

          const visibleNow =
            elevationAngle !== null &&
            elevationAngle >= 10;

          const futureVisibility =
            typeof plane.track === 'number' &&
            typeof plane.gs === 'number' &&
            altitude !== null
              ? getFutureVisibility(
                  data.location.lat,
                  data.location.lon,
                  plane.lat,
                  plane.lon,
                  plane.track,
                  plane.gs,
                  altitude
                )
              : null;

          const futureVisible =
            !visibleNow &&
            futureVisibility !== null &&
            futureVisibility.willBeVisible;

          return {
            distance,
            visibleNow,
            futureVisible,
            minutesToClosest:
              futureVisibility
                ?.minutesToClosest ?? null,
          };
        }

        const dataA = getSortData(a);
        const dataB = getSortData(b);

        // Visible now first
        if (
          dataA.visibleNow !==
          dataB.visibleNow
        ) {
          return dataA.visibleNow
            ? -1
            : 1;
        }

        // Visible now: closest first
        if (
          dataA.visibleNow &&
          dataB.visibleNow
        ) {
          return (
            dataA.distance -
            dataB.distance
          );
        }

        // Future visible next
        if (
          dataA.futureVisible !==
          dataB.futureVisible
        ) {
          return dataA.futureVisible
            ? -1
            : 1;
        }

        // Future visible: soonest first
        if (
          dataA.futureVisible &&
          dataB.futureVisible
        ) {
          return (
            (dataA.minutesToClosest ?? 9999) -
            (dataB.minutesToClosest ?? 9999)
          );
        }

        return (
          dataA.distance -
          dataB.distance
        );
      });

      setAircraft(filteredAircraft);

      setStatus(
        'Aircraft found: ' +
        filteredAircraft.length
      );

    } catch (error) {

      console.error(error);

      setStatus(
        error instanceof Error
          ? 'ERROR: ' + error.message
          : 'ERROR getting aircraft'
      );
    }
  }

  async function useSavedLocation() {

    const latitude =
      Number(savedLatText.trim());

    const longitude =
      Number(savedLonText.trim());

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setStatus(
        'Enter a valid latitude (-90 to 90) ' +
        'and longitude (-180 to 180).'
      );

      return;
    }

    setLocationMode('saved');

    await AsyncStorage.multiSet([
      ['flightTrackerLocationMode', 'saved'],
      [
        'flightTrackerSavedLat',
        String(latitude),
      ],
      [
        'flightTrackerSavedLon',
        String(longitude),
      ],
    ]);

    await getFlights(
      latitude,
      longitude
    );
  }


  async function usePhoneLocation() {

    try {

      setStatus(
        'Getting phone location...'
      );

      const permission =
        await Location
          .requestForegroundPermissionsAsync();

      if (
        permission.status !== 'granted'
      ) {
        setStatus(
          'Phone location permission was not granted.'
        );

        return;
      }

      const position =
        await Location
          .getCurrentPositionAsync({
            accuracy:
              Location.Accuracy.Balanced,
          });

      const latitude =
        position.coords.latitude;

      const longitude =
        position.coords.longitude;

      setLocationMode('phone');

      await AsyncStorage.setItem(
        'flightTrackerLocationMode',
        'phone'
      );

      await getFlights(
        latitude,
        longitude
      );

    } catch (error) {

      console.error(error);

      setStatus(
        error instanceof Error
          ? 'ERROR getting phone location: ' +
            error.message
          : 'ERROR getting phone location'
      );
    }
  }


  async function refreshAircraft() {

    if (locationMode === 'phone') {
      await usePhoneLocation();
      return;
    }

    await useSavedLocation();
  }


  useEffect(() => {

    async function loadLocationSettings() {

      try {

        const values =
          await AsyncStorage.multiGet([
            'flightTrackerLocationMode',
            'flightTrackerSavedLat',
            'flightTrackerSavedLon',
          ]);

        const stored =
          Object.fromEntries(values);

        const savedLat =
          stored.flightTrackerSavedLat ??
          DEFAULT_SAVED_LAT;

        const savedLon =
          stored.flightTrackerSavedLon ??
          DEFAULT_SAVED_LON;

        const mode: LocationMode =
          stored.flightTrackerLocationMode ===
          'phone'
            ? 'phone'
            : 'saved';

        setSavedLatText(savedLat);
        setSavedLonText(savedLon);
        setLocationMode(mode);
        setLocationSettingsLoaded(true);

        if (mode === 'phone') {

          setStatus(
            'Tap Use Phone Location to update your position.'
          );

        } else {

          const latitude =
            Number(savedLat);

          const longitude =
            Number(savedLon);

          if (
            Number.isFinite(latitude) &&
            Number.isFinite(longitude)
          ) {
            await getFlights(
              latitude,
              longitude
            );
          }
        }

      } catch (error) {

        console.error(error);

        setLocationSettingsLoaded(true);

        setStatus(
          'Could not load saved location settings.'
        );
      }
    }

    loadLocationSettings();

  }, []);

  const mapFlightData =
    mapPlane !== null &&
    myLat !== null &&
    myLon !== null
      ? getMapFlightData(
          mapPlane,
          myLat,
          myLon
        )
      : null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
    >

      <Text style={styles.title}>
        FlightTracker
      </Text>

      <Text style={styles.status}>
        {status}
      </Text>

      <View style={styles.locationPanel}>

        <Text style={styles.locationHeading}>
          Location Source
        </Text>

        <View style={styles.locationModeRow}>

          <Pressable
            style={[
              styles.locationModeButton,
              locationMode === 'phone' &&
                styles.locationModeButtonActive,
            ]}
            onPress={usePhoneLocation}
          >
            <Text
              style={[
                styles.locationModeText,
                locationMode === 'phone' &&
                  styles.locationModeTextActive,
              ]}
            >
              Phone Location
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.locationModeButton,
              locationMode === 'saved' &&
                styles.locationModeButtonActive,
            ]}
            onPress={() =>
              setLocationMode('saved')
            }
          >
            <Text
              style={[
                styles.locationModeText,
                locationMode === 'saved' &&
                  styles.locationModeTextActive,
              ]}
            >
              Saved Location
            </Text>
          </Pressable>

        </View>

        {locationMode === 'saved' && (

          <View style={styles.savedLocationFields}>

            <Text style={styles.inputLabel}>
              Latitude
            </Text>

            <TextInput
              style={styles.locationInput}
              value={savedLatText}
              onChangeText={setSavedLatText}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="40.58"
            />

            <Text style={styles.inputLabel}>
              Longitude
            </Text>

            <TextInput
              style={styles.locationInput}
              value={savedLonText}
              onChangeText={setSavedLonText}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="-98.38"
            />

            <Pressable
              style={styles.useLocationButton}
              onPress={useSavedLocation}
            >
              <Text style={styles.buttonText}>
                Use This Location
              </Text>
            </Pressable>

          </View>

        )}

        {locationMode === 'phone' && (

          <Pressable
            style={styles.useLocationButton}
            onPress={usePhoneLocation}
          >
            <Text style={styles.buttonText}>
              Update Phone Location
            </Text>
          </Pressable>

        )}

        {myLat !== null &&
         myLon !== null && (

          <Text style={styles.location}>
            Tracking Location:{' '}
            {myLat.toFixed(5)},{' '}
            {myLon.toFixed(5)}
          </Text>

        )}

      </View>

      <Pressable
        style={styles.button}
        onPress={refreshAircraft}
        disabled={!locationSettingsLoaded}
      >
        <Text style={styles.buttonText}>
          Refresh Aircraft
        </Text>
      </Pressable>

      {aircraft.map((plane, index) => {

        if (
          myLat === null ||
          myLon === null
        ) {
          return null;
        }

        const altitude =
          typeof plane.alt_baro === 'number'
            ? plane.alt_baro
            : null;

        const speed =
          typeof plane.gs === 'number'
            ? plane.gs
            : null;

        const track =
          typeof plane.track === 'number'
            ? plane.track
            : null;

        const distance =
          getDistanceMiles(
            myLat,
            myLon,
            plane.lat,
            plane.lon
          );

        const bearing =
          getBearing(
            myLat,
            myLon,
            plane.lat,
            plane.lon
          );

        const elevationAngle =
          altitude !== null
            ? getElevationAngle(
                altitude,
                distance
              )
            : null;

        const visibleNow =
          elevationAngle !== null &&
          elevationAngle >= 10;

        const futureVisibility =
          track !== null &&
          speed !== null &&
          altitude !== null
            ? getFutureVisibility(
                myLat,
                myLon,
                plane.lat,
                plane.lon,
                track,
                speed,
                altitude
              )
            : null;

        const futureVisible =
          !visibleNow &&
          futureVisibility !== null &&
          futureVisibility.willBeVisible;

        const displayClosestDistance =
          futureVisibility !== null &&
          futureVisibility
            .closestDistance !== null
            ? futureVisibility.closestDistance
            : distance;

        const passedClosestPoint =
          futureVisibility !== null &&
          futureVisibility
            .minutesToClosest === null;

        const displayClosestTime =
          passedClosestPoint
            ? getClosestTime(0)
            : futureVisibility
                ?.minutesToClosest !== null &&
              futureVisibility
                ?.minutesToClosest !== undefined
              ? getClosestTime(
                  futureVisibility
                    .minutesToClosest
                )
              : 'Unknown';

        const displayClosestBearing =
          passedClosestPoint
            ? bearing
            : futureVisibility
                ?.closestBearing ?? null;

        const displayClosestElevation =
          altitude !== null
            ? getElevationAngle(
                altitude,
                displayClosestDistance
              )
            : null;

        const confidenceMinutesToClosest =
          passedClosestPoint
            ? 0
            : futureVisibility
                ?.minutesToClosest ?? null;

        const visibilityConfidence =
          getVisibilityConfidence(
            displayClosestElevation,
            confidenceMinutesToClosest,
            distance
          );

        const cardId =
          plane.hex ??
          plane.flight?.trim() ??
          'plane-' + index;

const isExpanded =
  expandedCards.includes(cardId);

const isConfidenceExpanded =
  expandedConfidenceCards.includes(cardId);

          return (
  <View
    style={styles.card}
    key={cardId}
  >

<Pressable
  onPress={() =>
    setExpandedCards(
      isExpanded
        ? expandedCards.filter(
            id => id !== cardId
          )
        : [...expandedCards, cardId]
    )
  }
>

      <View style={styles.summaryRow}>

        <View style={styles.summaryLeft}>

          <Text style={styles.flight}>
            {plane.flight?.trim() ||
              'Unknown Flight'}
          </Text>

          <Text>
            Type: {plane.t || 'Unknown'}
          </Text>

        </View>

        <Text style={styles.expandSymbol}>
          {isExpanded ? '▲' : '▼'}
        </Text>

      </View>

 <View style={styles.summaryData}>

  <Text>
    Visible Time:{' '}
    {getVisibilityTimeRange(
      futureVisibility
    )}
  </Text>

  <Text style={styles.confidenceText}>
    Visibility Confidence:{' '}
    {formatVisibilityConfidence(
      visibilityConfidence
    )}
  </Text>

  {visibilityConfidence !== null && (
    <Pressable
      style={styles.confidenceButton}
      onPress={() =>
        setExpandedConfidenceCards(
          isConfidenceExpanded
            ? expandedConfidenceCards.filter(
                id => id !== cardId
              )
            : [
                ...expandedConfidenceCards,
                cardId,
              ]
        )
      }
    >
      <Text style={styles.confidenceButtonText}>
        {isConfidenceExpanded
          ? 'Hide Calculation'
          : 'How Is This Calculated?'}
      </Text>
    </Pressable>
  )}

  {isConfidenceExpanded &&
   visibilityConfidence !== null && (

    <View style={styles.confidenceBreakdown}>

      <Text style={styles.confidenceBreakdownTitle}>
        Visibility Confidence Calculation
      </Text>

      <Text>
        Maximum Viewing Angle:{' '}
        {displayClosestElevation !== null
          ? Math.round(
              displayClosestElevation
            ) + '°'
          : 'Unknown'}
      </Text>

      <Text style={styles.confidenceMath}>
        Angle score:{' '}
        {visibilityConfidence.angleScore}/100
        {' × '}50%
      </Text>

      <Text>
        Time to Closest:{' '}
        {confidenceMinutesToClosest !== null
          ? Math.max(
              0,
              Math.round(
                confidenceMinutesToClosest
              )
            ) + ' min'
          : 'Unknown'}
      </Text>

      <Text style={styles.confidenceMath}>
        Time score:{' '}
        {visibilityConfidence.timeScore}/100
        {' × '}30%
      </Text>

      <Text>
        Current Distance:{' '}
        {Math.round(distance)} miles
      </Text>

      <Text style={styles.confidenceMath}>
        Distance score:{' '}
        {visibilityConfidence.distanceScore}/100
        {' × '}20%
      </Text>

      <View style={styles.confidenceDivider} />

      <Text>
        Weighted Score:{' '}
        {visibilityConfidence.rawScore}%
      </Text>

      {visibilityConfidence.distanceCap !== null && (
        <Text>
          Distance Limit:{' '}
          maximum{' '}
          {visibilityConfidence.distanceCap}%
          {visibilityConfidence.capApplied
            ? ' — applied'
            : ' — not limiting'}
        </Text>
      )}

      <Text style={styles.confidenceFinal}>
        Displayed Confidence:{' '}
        {formatVisibilityConfidence(
          visibilityConfidence
        )}
      </Text>

    </View>
  )}

</View>

    </Pressable>

    <Pressable
      style={styles.mapButton}
      onPress={() => {
        setMapConfidenceExpanded(false);
        setMapPlane(plane);
      }}
    >
      <Text style={styles.mapButtonText}>
        Show Map
      </Text>
    </Pressable>


    {isExpanded && (

      <View style={styles.details}>

        <Text>
          Current Altitude:{' '}
          {altitude !== null
            ? Math.round(altitude) + ' ft'
            : 'Unknown'}
        </Text>

        <Text>
          Current Speed:{' '}
          {speed !== null
            ? Math.round(speed) + ' knots'
            : 'Unknown'}
        </Text>

        <Text>
          Current Distance:{' '}
          {Math.round(distance)} miles
        </Text>

        <Text>
          Closest Time:{' '}
          {displayClosestTime}
        </Text>

        <Text>
          Closest Bearing:{' '}
          {displayClosestBearing !== null
            ? Math.round(
                displayClosestBearing
              ) + '°'
            : 'Unknown'}
        </Text>

        <Text>
          Closest Elevation Angle:{' '}
          {displayClosestElevation !== null
            ? Math.round(
                displayClosestElevation
              ) + '°'
            : 'Unknown'}
        </Text>

        <Text>
          Closest Distance:{' '}
          {Math.round(
            displayClosestDistance
          )} miles
        </Text>

        <Text>
          Visibility Confidence:{' '}
          {formatVisibilityConfidence(
            visibilityConfidence
          )}
        </Text>

      </View>

    )}

  </View>
);
      })}

{mapPlane !== null &&
 myLat !== null &&
 myLon !== null &&
 mapFlightData !== null && (

  <Modal
    visible={true}
    animationType="slide"
    onRequestClose={() => {
      setMapConfidenceExpanded(false);
      setMapPlane(null);
    }}
  >

    <View style={styles.mapScreen}>

      <View style={styles.mapHeader}>

        <Text style={styles.mapTitle}>
          {mapPlane.flight?.trim() ||
            'Unknown Flight'}
        </Text>

        <Pressable
          style={styles.closeButton}
          onPress={() => {
            setMapConfidenceExpanded(false);
            setMapPlane(null);
          }}
        >
          <Text style={styles.closeButtonText}>
            Close
          </Text>
        </Pressable>

      </View>

      <View style={styles.mapDetails}>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Type
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapPlane.t || 'Unknown'}
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Track
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData.track !== null
                ? Math.round(
                    mapFlightData.track
                  ) + '°'
                : 'Unknown'}
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Altitude
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData.altitude !== null
                ? Math.round(
                    mapFlightData.altitude
                  ) + ' ft'
                : 'Unknown'}
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Speed
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData.speed !== null
                ? Math.round(
                    mapFlightData.speed
                  ) + ' knots'
                : 'Unknown'}
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Current Distance
            </Text>
            <Text style={styles.mapDetailValue}>
              {Math.round(
                mapFlightData.distance
              )} miles
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Current Bearing
            </Text>
            <Text style={styles.mapDetailValue}>
              {Math.round(
                mapFlightData.bearing
              )}°
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Current Elevation
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData.elevationAngle !== null
                ? Math.round(
                    mapFlightData.elevationAngle
                  ) + '°'
                : 'Unknown'}
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Closest Time
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData.displayClosestTime}
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Closest Distance
            </Text>
            <Text style={styles.mapDetailValue}>
              {Math.round(
                mapFlightData
                  .displayClosestDistance
              )} miles
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Closest Bearing
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData
                .displayClosestBearing !== null
                ? Math.round(
                    mapFlightData
                      .displayClosestBearing
                  ) + '°'
                : 'Unknown'}
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailRow}>
          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Closest Elevation
            </Text>
            <Text style={styles.mapDetailValue}>
              {mapFlightData
                .displayClosestElevation !== null
                ? Math.round(
                    mapFlightData
                      .displayClosestElevation
                  ) + '°'
                : 'Unknown'}
            </Text>
          </View>

          <View style={styles.mapDetailItem}>
            <Text style={styles.mapDetailLabel}>
              Visibility Confidence
            </Text>
            <Text style={styles.mapDetailValue}>
              {formatVisibilityConfidence(
                mapFlightData.visibilityConfidence
              )}
            </Text>
          </View>
        </View>

        <View style={styles.mapDetailFullWidth}>
          <Text style={styles.mapDetailLabel}>
            Visible Time
          </Text>
          <Text style={styles.mapDetailValue}>
            {mapFlightData.visibleTime}
          </Text>
        </View>

        {mapFlightData.visibilityConfidence !== null && (
          <Pressable
            style={styles.mapConfidenceButton}
            onPress={() =>
              setMapConfidenceExpanded(
                !mapConfidenceExpanded
              )
            }
          >
            <Text style={styles.confidenceButtonText}>
              {mapConfidenceExpanded
                ? 'Hide Calculation'
                : 'How Is This Calculated?'}
            </Text>
          </Pressable>
        )}

        {mapConfidenceExpanded &&
         mapFlightData.visibilityConfidence !== null && (

          <View style={styles.mapConfidenceBreakdown}>

            <Text style={styles.confidenceBreakdownTitle}>
              Visibility Confidence Calculation
            </Text>

            <Text>
              Maximum Viewing Angle:{' '}
              {mapFlightData
                .displayClosestElevation !== null
                ? Math.round(
                    mapFlightData
                      .displayClosestElevation
                  ) + '°'
                : 'Unknown'}
            </Text>

            <Text style={styles.confidenceMath}>
              Angle score:{' '}
              {mapFlightData
                .visibilityConfidence.angleScore}/100
              {' × '}50%
            </Text>

            <Text>
              Time to Closest:{' '}
              {mapFlightData
                .confidenceMinutesToClosest !== null
                ? Math.max(
                    0,
                    Math.round(
                      mapFlightData
                        .confidenceMinutesToClosest
                    )
                  ) + ' min'
                : 'Unknown'}
            </Text>

            <Text style={styles.confidenceMath}>
              Time score:{' '}
              {mapFlightData
                .visibilityConfidence.timeScore}/100
              {' × '}30%
            </Text>

            <Text>
              Current Distance:{' '}
              {Math.round(
                mapFlightData.distance
              )} miles
            </Text>

            <Text style={styles.confidenceMath}>
              Distance score:{' '}
              {mapFlightData
                .visibilityConfidence.distanceScore}/100
              {' × '}20%
            </Text>

            <View style={styles.confidenceDivider} />

            <Text>
              Weighted Score:{' '}
              {mapFlightData
                .visibilityConfidence.rawScore}%
            </Text>

            {mapFlightData
              .visibilityConfidence.distanceCap !== null && (
              <Text>
                Distance Limit:{' '}
                maximum{' '}
                {mapFlightData
                  .visibilityConfidence.distanceCap}%
                {mapFlightData
                  .visibilityConfidence.capApplied
                  ? ' — applied'
                  : ' — not limiting'}
              </Text>
            )}

            <Text style={styles.confidenceFinal}>
              Displayed Confidence:{' '}
              {formatVisibilityConfidence(
                mapFlightData.visibilityConfidence
              )}
            </Text>

          </View>
        )}

      </View>

      <MapView
        style={styles.map}
        initialRegion={getFlightMapRegion(
          myLat,
          myLon,
          mapPlane
        )}
      >

        {typeof mapPlane.alt_baro === 'number' && (
          <>
            {[
              {
                angle: 10,
                color: '#d32f2f',
              },
              {
                angle: 30,
                color: '#f57c00',
              },
              {
                angle: 45,
                color: '#1976d2',
              },
              {
                angle: 60,
                color: '#388e3c',
              },
            ].map((ring) => {

              const radius =
                getVisibilityRadiusMeters(
                  mapPlane.alt_baro as number,
                  ring.angle
                );

              return (
                <Fragment key={'ring-' + ring.angle}>
                  <Circle
                    center={{
                      latitude: myLat,
                      longitude: myLon,
                    }}
                    radius={radius}
                    strokeWidth={4}
                    strokeColor={ring.color}
                    fillColor="rgba(0, 0, 0, 0)"
                  />

                  <Marker
                    coordinate={getRingLabelCoordinate(
                      myLat,
                      myLon,
                      radius
                    )}
                    anchor={{ x: 0.5, y: 0.5 }}
                    zIndex={5}
                  >
                    <View
                      style={[
                        styles.ringLabel,
                        {
                          borderColor:
                            ring.color,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.ringLabelText,
                          {
                            color:
                              ring.color,
                          },
                        ]}
                      >
                        {ring.angle}°
                      </Text>
                    </View>
                  </Marker>
                </Fragment>
              );
            })}
          </>
        )}

        {typeof mapPlane.track === 'number' &&
         typeof mapPlane.alt_baro === 'number' && (
          <Polyline
            coordinates={[
              {
                latitude: mapPlane.lat,
                longitude: mapPlane.lon,
              },
              getDestinationCoordinate(
                mapPlane.lat,
                mapPlane.lon,
                mapPlane.track,
                getHeadingLineLengthMeters(
                  myLat,
                  myLon,
                  mapPlane.lat,
                  mapPlane.lon,
                  mapPlane.track,
                  mapPlane.alt_baro
                )
              ),
            ]}
            strokeWidth={4}
            strokeColor="#111111"
          />
        )}

        <Marker
          coordinate={{
            latitude: myLat,
            longitude: myLon,
          }}
          title="My Location"
        />

        {typeof mapPlane.track === 'number' &&
         typeof mapPlane.alt_baro === 'number' && (() => {

          const arrowHeadLength =
            getVisibilityRadiusMeters(
              mapPlane.alt_baro,
              10
            ) * 0.08;

          const backLeft =
            getDestinationCoordinate(
              mapPlane.lat,
              mapPlane.lon,
              mapPlane.track + 150,
              arrowHeadLength
            );

          const backRight =
            getDestinationCoordinate(
              mapPlane.lat,
              mapPlane.lon,
              mapPlane.track - 150,
              arrowHeadLength
            );

          return (
            <Polyline
              coordinates={[
                backLeft,
                {
                  latitude: mapPlane.lat,
                  longitude: mapPlane.lon,
                },
                backRight,
              ]}
              strokeWidth={5}
              strokeColor="#111111"
            />
          );
        })()}

      </MapView>

    </View>

  </Modal>

)}

    </ScrollView>
  );
}

const styles = StyleSheet.create({

  container: {
    padding: 20,
    paddingTop: 60,
  },

  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },

  status: {
    fontSize: 16,
    marginBottom: 4,
  },

  locationPanel: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginTop: 10,
    marginBottom: 15,
    gap: 10,
  },

  locationHeading: {
    fontSize: 16,
    fontWeight: 'bold',
  },

  locationModeRow: {
    flexDirection: 'row',
    gap: 10,
  },

  locationModeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },

  locationModeButtonActive: {
    backgroundColor: '#111111',
  },

  locationModeText: {
    fontWeight: 'bold',
  },

  locationModeTextActive: {
    color: '#ffffff',
  },

  savedLocationFields: {
    gap: 7,
  },

  inputLabel: {
    fontSize: 13,
    fontWeight: 'bold',
  },

  locationInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
  },

  useLocationButton: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    alignItems: 'center',
  },

  location: {
    marginTop: 4,
  },

  button: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    alignItems: 'center',
  },

  buttonText: {
    fontWeight: 'bold',
  },

  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    gap: 5,
  },

  flight: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  summaryLeft: {
    flex: 1,
  },

  summaryData: {
    marginTop: 8,
    gap: 5,
  },

  confidenceText: {
    fontWeight: 'bold',
  },

  confidenceButton: {
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 4,
    alignSelf: 'flex-start',
  },

  confidenceButtonText: {
    fontWeight: 'bold',
    fontSize: 13,
  },

  confidenceBreakdown: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10,
    gap: 4,
  },

  confidenceBreakdownTitle: {
    fontWeight: 'bold',
    marginBottom: 3,
  },

  confidenceMath: {
    fontSize: 13,
    marginLeft: 12,
  },

  confidenceDivider: {
    borderTopWidth: 1,
    marginVertical: 5,
  },

  confidenceFinal: {
    fontWeight: 'bold',
    marginTop: 2,
  },

  expandSymbol: {
    fontSize: 18,
    marginLeft: 10,
  },

  details: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
    gap: 5,
  },

  mapButton: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    alignItems: 'center',
  },

  mapButtonText: {
    fontWeight: 'bold',
  },


  mapScreen: {
    flex: 1,
    paddingTop: 50,
  },

  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
  },

  mapTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },

  mapDetails: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },

  mapDetailRow: {
    flexDirection: 'row',
    gap: 12,
  },

  mapDetailItem: {
    flex: 1,
    minWidth: 0,
  },

  mapDetailFullWidth: {
    marginTop: 2,
  },

  mapConfidenceButton: {
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 8,
    alignSelf: 'flex-start',
  },

  mapConfidenceBreakdown: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
    gap: 3,
  },

  mapDetailLabel: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  mapDetailValue: {
    fontSize: 14,
  },

  closeButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  closeButtonText: {
    fontWeight: 'bold',
  },

  map: {
    flex: 1,
    marginTop: 12,
  },

  ringLabel: {
    backgroundColor: 'white',
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  ringLabelText: {
    fontSize: 12,
    fontWeight: 'bold',
  },





});
