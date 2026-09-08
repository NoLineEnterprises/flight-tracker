import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getBearing,
  getClosestTime,
  getDistanceMiles,
  getElevationAngle,
  getFutureVisibility,
  getVisibilityTimeRange,
} from '../../src/flightCalculations';

const API_URL =
  'http://192.168.1.65:3000/api/flights';

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

  async function getFlights() {

    try {

      setStatus('Contacting aircraft API...');

      const response =
        await fetch(API_URL);

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

  useEffect(() => {
    getFlights();
  }, []);

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

      {myLat !== null &&
       myLon !== null && (

        <Text style={styles.location}>
          My Location: {myLat}, {myLon}
        </Text>
      )}

      <Pressable
        style={styles.button}
        onPress={getFlights}
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

        const cardId =
          plane.hex ??
          plane.flight?.trim() ??
          'plane-' + index;

const isExpanded =
  expandedCards.includes(cardId);

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

</View>

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
          Visible Time Range:{' '}
          {getVisibilityTimeRange(
            futureVisibility
          )}
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

      </View>

    )}

  </View>
);
      })}

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

  location: {
    marginBottom: 15,
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

});