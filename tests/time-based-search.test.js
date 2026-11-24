import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initDB,
  searchBusesByJourney,
  OFFICIAL_9_CORRIDOR_STOPS,
} from '../db.js'
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  calculateLiveBusProgressAndEta,
  getCurrentMinutesIST,
} from '../src/transitUtils.js'

test('Time-Based Real-Time Bus Search Suite', async (t) => {
  await initDB()

  await t.test('1. Time Parsing and Formatting Utilities', () => {
    assert.equal(parseTimeToMinutes('09:00 AM'), 540)
    assert.equal(parseTimeToMinutes('9:00 AM'), 540)
    assert.equal(parseTimeToMinutes('09:00'), 540)
    assert.equal(parseTimeToMinutes('12:00 PM'), 720)
    assert.equal(parseTimeToMinutes('12:00 AM'), 0)
    assert.equal(parseTimeToMinutes('02:30 PM'), 870)
    assert.equal(parseTimeToMinutes('14:30'), 870)

    assert.equal(formatMinutesToTime(540), '09:00 AM')
    assert.equal(formatMinutesToTime(720), '12:00 PM')
    assert.equal(formatMinutesToTime(0), '12:00 AM')
    assert.equal(formatMinutesToTime(870), '02:30 PM')
  })

  await t.test('2. Live Bus Progress and ETA Calculation (Approaching, Present, Passed)', () => {
    const udupiStop = OFFICIAL_9_CORRIDOR_STOPS.find((s) => s.stop_name === 'Udupi')
    assert.ok(udupiStop, 'Udupi stop must exist')

    // Scenario A: Bus present at Udupi (within 400m)
    const atStop = calculateLiveBusProgressAndEta(udupiStop.latitude, udupiStop.longitude, 0, udupiStop)
    assert.equal(atStop.has_passed, false)
    assert.equal(atStop.is_at_stop, true)
    assert.equal(atStop.category, 'PRESENT')
    assert.equal(atStop.eta_minutes, 0)

    // Scenario B: Bus approaching Udupi (e.g. 2 km south near Katapadi, lat 13.32)
    const approaching = calculateLiveBusProgressAndEta(13.322, 74.743, 35, udupiStop)
    assert.equal(approaching.has_passed, false)
    assert.equal(approaching.is_at_stop, false)
    assert.equal(approaching.is_approaching, true)
    assert.equal(approaching.category, 'APPROACHING')
    assert.ok(approaching.eta_minutes <= 8)

    // Scenario C: Bus behind Udupi travelling towards it (e.g. near Mulki, lat 13.09)
    const enRoute = calculateLiveBusProgressAndEta(13.0908, 74.7903, 40, udupiStop)
    assert.equal(enRoute.has_passed, false)
    assert.equal(enRoute.is_at_stop, false)
    assert.equal(enRoute.is_approaching, false)
    assert.equal(enRoute.category, 'EN_ROUTE')
    assert.ok(enRoute.distance_km > 10)
    assert.ok(enRoute.eta_minutes > 15)

    // Scenario D: Bus has already passed Udupi (north of Udupi, lat 13.45 towards Kundapura)
    const passed = calculateLiveBusProgressAndEta(13.45, 74.72, 45, udupiStop)
    assert.equal(passed.has_passed, true)
    assert.equal(passed.category, 'PASSED')
  })

  await t.test('3. Time-Based Search: Excludes Buses that Have Passed the Stop', async () => {
    const allBuses = await searchBusesByJourney('Udupi', 'Kundapura')
    assert.ok(allBuses.length >= 2, 'Should find buses serving Udupi to Kundapura')

    const bus1 = allBuses[0]
    const bus2 = allBuses[1]

    // bus1 has already passed Udupi (lat 13.45 is north of Udupi 13.3409)
    // bus2 is approaching Udupi (lat 13.32 is south of Udupi)
    const activeMap = {
      [bus1.bus_id]: {
        is_on_shift: true,
        latitude: 13.45,
        longitude: 74.72,
        speed: 40,
        timestamp: Date.now(),
      },
      [bus2.bus_id]: {
        is_on_shift: true,
        latitude: 13.32,
        longitude: 74.743,
        speed: 35,
        timestamp: Date.now(),
      },
    }

    const results = await searchBusesByJourney('Udupi', 'Kundapura', activeMap, '09:00 AM')

    // bus1 (which has passed Udupi) MUST be excluded
    const foundBus1 = results.find((b) => b.bus_id === bus1.bus_id)
    assert.equal(foundBus1, undefined, 'Bus that already passed Udupi must be excluded')

    // bus2 (which is approaching Udupi) MUST be included
    const foundBus2 = results.find((b) => b.bus_id === bus2.bus_id)
    assert.ok(foundBus2, 'Bus approaching Udupi must be included')
    assert.equal(foundBus2.tracking_status, 'APPROACHING')
  })

  await t.test('4. Time-Based Search: Shows Present, Approaching, and Behind-the-Stop Buses', async () => {
    const allBuses = await searchBusesByJourney('Udupi', 'Kundapura')
    assert.ok(allBuses.length >= 3, 'Must have at least 3 buses')

    const busAtStop = allBuses[0]
    const busApproaching = allBuses[1]
    const busBehind = allBuses[2]

    const udupiStop = OFFICIAL_9_CORRIDOR_STOPS.find((s) => s.stop_name === 'Udupi')

    const activeMap = {
      // 1. Present at selected stop
      [busAtStop.bus_id]: {
        is_on_shift: true,
        latitude: udupiStop.latitude,
        longitude: udupiStop.longitude,
        speed: 0,
        timestamp: Date.now(),
      },
      // 2. Approaching the stop
      [busApproaching.bus_id]: {
        is_on_shift: true,
        latitude: 13.32,
        longitude: 74.743,
        speed: 32,
        timestamp: Date.now(),
      },
      // 3. Behind the stop travelling towards it
      [busBehind.bus_id]: {
        is_on_shift: true,
        latitude: 13.0068, // near Surathkal
        longitude: 74.7954,
        speed: 40,
        timestamp: Date.now(),
      },
    }

    const results = await searchBusesByJourney('Udupi', 'Kundapura', activeMap, '06:00 AM')

    const rAtStop = results.find((b) => b.bus_id === busAtStop.bus_id)
    const rApproaching = results.find((b) => b.bus_id === busApproaching.bus_id)
    const rBehind = results.find((b) => b.bus_id === busBehind.bus_id)

    assert.ok(rAtStop, 'Bus present at stop must be shown')
    assert.equal(rAtStop.search_category, 'PRESENT')

    assert.ok(rApproaching, 'Bus approaching stop must be shown')
    assert.equal(rApproaching.tracking_status, 'APPROACHING')
    assert.equal(rApproaching.search_category, 'APPROACHING')

    assert.ok(rBehind, 'Bus travelling towards stop must be shown')
    assert.equal(rBehind.tracking_status, 'LIVE')
    assert.equal(rBehind.search_category, 'EN_ROUTE')
  })

  await t.test('5. Owner-Configured Schedule Fallback: Clearly Labelled SCHEDULED without Fake GPS', async () => {
    // When activeBuses has NO live telemetry for a bus
    const activeMap = {}
    const results = await searchBusesByJourney('Udupi', 'Kundapura', activeMap, '06:00 AM')

    assert.ok(results.length > 0, 'Should return scheduled buses arriving after 06:00 AM')
    for (const b of results) {
      assert.equal(b.tracking_status, 'SCHEDULED')
      assert.equal(b.is_live, false)
      assert.equal(b.latitude, null, 'Must never generate fake GPS latitude')
      assert.equal(b.longitude, null, 'Must never generate fake GPS longitude')
      assert.equal(b.speed, 0, 'Must not generate fake speed')
      assert.ok(b.expected_arrival_time, 'Must have expected arrival from owner schedule')
    }
  })

  await t.test('6. Stale Telemetry: Shows LOCATION STALE Status', async () => {
    const allBuses = await searchBusesByJourney('Udupi', 'Kundapura')
    const bus = allBuses[0]

    // Telemetry received 5 minutes ago (>= 120000ms stale threshold)
    const activeMap = {
      [bus.bus_id]: {
        is_on_shift: true,
        latitude: 13.25,
        longitude: 74.75,
        speed: 30,
        timestamp: Date.now() - 300000,
        last_telemetry_at: Date.now() - 300000,
      },
    }

    const results = await searchBusesByJourney('Udupi', 'Kundapura', activeMap, '06:00 AM')
    const r = results.find((b) => b.bus_id === bus.bus_id)
    assert.ok(r, 'Stale bus before Udupi must be returned')
    assert.equal(r.tracking_status, 'LOCATION STALE')
    assert.equal(r.is_live, false)
  })

  await t.test('7. Sorting: Results Sorted by Expected Arrival Time', async () => {
    const results = await searchBusesByJourney('Mangaluru', 'Kundapura', {}, '06:00 AM')
    assert.ok(results.length >= 2)

    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(
        results[i].expected_arrival_minutes <= results[i + 1].expected_arrival_minutes,
        `Result ${i} (${results[i].expected_arrival_time}) must arrive before or at Result ${i + 1} (${results[i + 1].expected_arrival_time})`
      )
    }
  })

  await t.test('8. Strict Corridor stops and Zero Fake Buses', async () => {
    // Only approved 9 stops
    const invalidStopSearch = await searchBusesByJourney('Bengaluru', 'Udupi')
    assert.equal(invalidStopSearch.length, 0, 'Invalid corridor stop must return empty')

    const reverseSearch = await searchBusesByJourney('Kundapura', 'Mangaluru')
    assert.equal(reverseSearch.length, 0, 'Reverse search must return empty')
  })

  await t.test('9. HTTP API Endpoint Verification: /api/public/buses/search with ?time=', async () => {
    const res = await fetch('http://localhost:5000/api/public/buses/search?from=Udupi&to=Kundapura&time=09:00+AM')
    assert.equal(res.status, 200)
    const data = await res.json()

    assert.equal(data.success, true)
    assert.equal(data.from, 'Udupi')
    assert.equal(data.to, 'Kundapura')
    assert.equal(data.desired_time, '09:00 AM')
    assert.ok(Array.isArray(data.buses))

    for (const b of data.buses) {
      assert.ok(['LIVE', 'APPROACHING', 'SCHEDULED', 'LOCATION STALE'].includes(b.tracking_status))
      assert.ok(b.expected_arrival_time, 'Each bus must have expected_arrival_time')
    }
  })
})
