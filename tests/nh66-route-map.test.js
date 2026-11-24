import test from 'node:test'
import assert from 'node:assert/strict'
import { OFFICIAL_9_CORRIDOR_STOPS } from '../src/transitUtils.js'
import { NH66_HIGHWAY_POLYLINE, NH66_ROAD_DISTANCE_KM } from '../src/nh66RouteGeometry.js'

test('NH-66 Highway Route Geometry & 9 Approved Corridor Stops', async (t) => {
  await t.test('Geometry contains continuous turn-by-turn road points along NH-66', () => {
    assert.ok(Array.isArray(NH66_HIGHWAY_POLYLINE), 'Polyline should be an array')
    assert.ok(NH66_HIGHWAY_POLYLINE.length > 2000, `Polyline should have over 2000 road points, got ${NH66_HIGHWAY_POLYLINE.length}`)
    assert.ok(NH66_ROAD_DISTANCE_KM >= 100 && NH66_ROAD_DISTANCE_KM <= 110, `Road distance should be approx 104 km, got ${NH66_ROAD_DISTANCE_KM} km`)
  })

  await t.test('All coordinates are valid Leaflet [latitude, longitude] pairs in coastal Karnataka', () => {
    for (let i = 0; i < NH66_HIGHWAY_POLYLINE.length; i++) {
      const [lat, lng] = NH66_HIGHWAY_POLYLINE[i]
      assert.equal(typeof lat, 'number', `Latitude at index ${i} should be a number`)
      assert.equal(typeof lng, 'number', `Longitude at index ${i} should be a number`)
      assert.ok(lat >= 12.80 && lat <= 13.70, `Latitude ${lat} at index ${i} outside Mangaluru-Kundapura corridor`)
      assert.ok(lng >= 74.60 && lng <= 74.95, `Longitude ${lng} at index ${i} outside coastal Karnataka corridor`)
    }
  })

  await t.test('Route starts near Mangaluru and terminates at Kundapura', () => {
    const [startLat, startLng] = NH66_HIGHWAY_POLYLINE[0]
    const [endLat, endLng] = NH66_HIGHWAY_POLYLINE[NH66_HIGHWAY_POLYLINE.length - 1]

    // Mangaluru Statebank is ~12.863, 74.838
    assert.ok(Math.abs(startLat - 12.863) < 0.01, `Start lat ${startLat} should be near Mangaluru`)
    assert.ok(Math.abs(startLng - 74.838) < 0.01, `Start lng ${startLng} should be near Mangaluru`)

    // Kundapura Shastri Circle is ~13.628, 74.693
    assert.ok(Math.abs(endLat - 13.628) < 0.01, `End lat ${endLat} should be near Kundapura`)
    assert.ok(Math.abs(endLng - 74.693) < 0.01, `End lng ${endLng} should be near Kundapura`)
  })

  await t.test('Exactly 9 approved corridor stops exist in correct geographic order', () => {
    const expectedStopNames = [
      'Mangaluru',
      'Kuntikana',
      'Kulur',
      'Surathkal',
      'Mulki',
      'Padubidri',
      'Kaup',
      'Udupi',
      'Kundapura',
    ]

    assert.equal(OFFICIAL_9_CORRIDOR_STOPS.length, 9, 'Must have exactly 9 corridor stops')
    expectedStopNames.forEach((name, idx) => {
      assert.equal(OFFICIAL_9_CORRIDOR_STOPS[idx].stop_name, name, `Stop #${idx + 1} must be ${name}`)
      assert.equal(OFFICIAL_9_CORRIDOR_STOPS[idx].stop_id, idx + 1, `Stop #${idx + 1} stop_id must be ${idx + 1}`)
    })

    // Latitudes must strictly progress northward (increasing latitude)
    for (let i = 0; i < OFFICIAL_9_CORRIDOR_STOPS.length - 1; i++) {
      const current = OFFICIAL_9_CORRIDOR_STOPS[i]
      const next = OFFICIAL_9_CORRIDOR_STOPS[i + 1]
      assert.ok(
        next.latitude > current.latitude,
        `Stop ${next.stop_name} (${next.latitude}) must be north of ${current.stop_name} (${current.latitude})`
      )
    }
  })

  await t.test('All 9 stop markers align closely with the NH-66 highway road polyline', () => {
    // For each stop, verify there is an actual road point within 500m (0.005 degrees)
    OFFICIAL_9_CORRIDOR_STOPS.forEach((stop) => {
      let minDistance = Infinity
      for (const [lat, lng] of NH66_HIGHWAY_POLYLINE) {
        const dLat = lat - stop.latitude
        const dLng = lng - stop.longitude
        const dist = Math.sqrt(dLat * dLat + dLng * dLng)
        if (dist < minDistance) minDistance = dist
      }
      assert.ok(
        minDistance < 0.005,
        `Stop ${stop.stop_name} at (${stop.latitude}, ${stop.longitude}) should align with NH-66 polyline (distance: ${minDistance.toFixed(5)} deg)`
      )
    })
  })
})
