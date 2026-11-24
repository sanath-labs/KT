import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getISTDateTime,
  formatToIST,
  calculateScheduleAdherence,
  formatMinutesToTime,
  parseTimeToMinutes,
  getCurrentMinutesIST,
  formatISTRelativeFreshness,
} from '../src/transitUtils.js'
import {
  recordTelemetry,
  getRecentTelemetry,
  initDB,
  searchBusesByJourney,
  getBuses,
} from '../db.js'

test('Real-Time Indian Standard Time (IST) Synchronization Suite', async (t) => {
  await initDB()

  await t.test('1. System Clock: Reliable IST calculation (Asia/Kolkata, UTC+05:30)', () => {
    const fixedUtcMs = 1795496138474 // 2026-11-24T04:55:38.474Z
    const ist = getISTDateTime(fixedUtcMs)

    assert.ok(ist, 'IST details should be returned')
    assert.equal(ist.timezone, 'Asia/Kolkata')
    assert.equal(ist.utc_offset, '+05:30')
    assert.equal(ist.utc_offset_minutes, 330)
    // 04:55:38 UTC + 05:30 = 10:25:38 IST
    assert.equal(ist.hour, 10)
    assert.equal(ist.minute, 25)
    assert.equal(ist.second, 38)
    assert.equal(ist.meridian, 'AM')
    assert.equal(ist.formatted_time, '10:25:38 AM')
    assert.equal(ist.weekday, 'Tue')
    assert.equal(ist.month, 'Nov')
    assert.equal(ist.year, '2026')
    assert.equal(ist.minutes_since_midnight, 10 * 60 + 25)
  })

  await t.test('2. IST Date & Time Formatter handles various format types', () => {
    const fixedUtcMs = 1795496138474 // 2026-11-24T04:55:38.474Z
    const timeOnly = formatToIST(fixedUtcMs, 'time-only')
    assert.ok(timeOnly.includes('10:25:38') || timeOnly.includes('10:25'), `Should contain IST time, got: ${timeOnly}`)

    const shortTime = formatToIST(fixedUtcMs, 'time-short')
    assert.ok(shortTime.includes('10:25'), `Should contain short time, got: ${shortTime}`)

    const dateOnly = formatToIST(fixedUtcMs, 'date-only')
    assert.ok(dateOnly.includes('24') && (dateOnly.includes('Nov') || dateOnly.includes('11')), `Should contain date, got: ${dateOnly}`)
  })

  await t.test('3. Schedule Comparison: Real GPS progress vs Owner Timetable', () => {
    // Case A: Bus delayed by 12 minutes (Scheduled: 10:00 AM, Expected: 10:12 AM)
    const delayed = calculateScheduleAdherence(612, 600)
    assert.equal(delayed.status, 'DELAYED')
    assert.equal(delayed.delay_minutes, 12)
    assert.ok(delayed.label.includes('Delayed by 12 mins'), `Got: ${delayed.label}`)

    // Case B: Bus running on time (Scheduled: 10:00 AM, Expected: 10:02 AM)
    const onTime = calculateScheduleAdherence(602, 600)
    assert.equal(onTime.status, 'ON_TIME')
    assert.equal(onTime.delay_minutes, 2)
    assert.equal(onTime.label, 'On Time')

    // Case C: Bus running early by 4 minutes (Scheduled: 10:00 AM, Expected: 09:56 AM)
    const early = calculateScheduleAdherence(596, 600)
    assert.equal(early.status, 'EARLY')
    assert.equal(early.delay_minutes, -4)
    assert.ok(early.label.includes('Running 4 mins early'), `Got: ${early.label}`)
  })

  await t.test('4. Database UTC Storage & IST Display Conversion', async () => {
    const sampleUtcIso = '2026-11-24T04:55:38.474Z'
    const logId = await recordTelemetry({
      bus_id: 1,
      bus_name: 'Vishal Express',
      latitude: 13.0068,
      longitude: 74.7954,
      speed: 42,
      delay_minutes: 3,
      recorded_at: sampleUtcIso,
    })

    assert.ok(logId, 'Should insert telemetry record')

    const logs = await getRecentTelemetry(5)
    assert.ok(logs.length > 0, 'Should retrieve telemetry logs')

    const inserted = logs.find((l) => l.log_id === logId)
    assert.ok(inserted, 'Should find inserted record')
    assert.ok(inserted.recorded_at, 'Should have recorded_at UTC timestamp')
    assert.ok(inserted.recorded_at_ist, 'Should have converted IST timestamp for display')
    assert.ok(inserted.recorded_at_ist.includes('10:25:38') || inserted.recorded_at_ist.includes('10:25'), `IST display time should match Asia/Kolkata, got: ${inserted.recorded_at_ist}`)
  })

  await t.test('5. Relative Freshness in IST: Just now, Xs ago, or stale time', () => {
    const nowMs = 1795496138474

    // 5 seconds ago -> Just now
    const fresh = formatISTRelativeFreshness(nowMs - 5000, nowMs)
    assert.equal(fresh.text, 'Just now')
    assert.equal(fresh.isStale, false)

    // 35 seconds ago -> 35s ago
    const secondsAgo = formatISTRelativeFreshness(nowMs - 35000, nowMs)
    assert.equal(secondsAgo.text, '35s ago')
    assert.equal(secondsAgo.isStale, false)

    // 3 minutes ago -> 3 mins ago (Stale)
    const stale = formatISTRelativeFreshness(nowMs - 180000, nowMs)
    assert.equal(stale.text, '3 mins ago')
    assert.equal(stale.isStale, true)
  })

  await t.test('6. Real-Time Journey Search matches against actual IST minutes', async () => {
    const allBuses = await getBuses()
    const targetBus =
      allBuses.find(
        (b) =>
          b.origin === 'Mangaluru' &&
          b.destination === 'Kundapura' &&
          b.stops &&
          b.stops.length === 9
      ) || allBuses[0]
    const targetId = targetBus.bus_id

    const activeBuses = {
      [targetId]: {
        bus_id: targetId,
        bus_name: targetBus.bus_name,
        latitude: 13.0068, // At Surathkal
        longitude: 74.7954,
        speed: 38,
        is_on_shift: true,
        tracking_status: 'LIVE',
        timestamp: Date.now(),
        last_telemetry_at: Date.now(),
      },
    }

    // Search with "now"
    const resultsNow = await searchBusesByJourney('Surathkal', 'Udupi', activeBuses, 'now')
    assert.ok(Array.isArray(resultsNow), 'Results should be an array')
    assert.ok(resultsNow.length > 0, 'Should find buses for the corridor')

    const liveBus = resultsNow.find((b) => b.bus_id === targetId)
    assert.ok(liveBus, `Live bus #${targetId} should be in results`)
    assert.equal(liveBus.is_live, true)
    assert.ok(liveBus.schedule_adherence, 'Should contain schedule adherence')
    assert.ok(liveBus.adherence_label, 'Should contain adherence label')
    assert.ok(liveBus.expected_arrival_time, 'Should contain expected arrival time')
  })

  await t.test('7. Stale GPS Telemetry marks LOCATION STALE and prevents fake LIVE', async () => {
    const allBuses = await getBuses()
    const targetBus =
      allBuses.find(
        (b) =>
          b.origin === 'Mangaluru' &&
          b.destination === 'Kundapura' &&
          b.stops &&
          b.stops.length === 9
      ) || allBuses[0]
    const targetId = targetBus.bus_id
    const staleTime = Date.now() - 300000 // 5 minutes ago

    const activeBuses = {
      [targetId]: {
        bus_id: targetId,
        bus_name: targetBus.bus_name,
        latitude: 13.0908, // Mulki
        longitude: 74.7903,
        speed: 0,
        is_on_shift: true,
        tracking_status: 'LIVE',
        timestamp: staleTime,
        last_telemetry_at: staleTime,
      },
    }

    const results = await searchBusesByJourney('Mulki', 'Udupi', activeBuses, null)
    const busMatch = results.find((b) => b.bus_id === targetId)
    assert.ok(busMatch, `Bus #${targetId} should be in results`)
    assert.equal(busMatch.tracking_status, 'LOCATION STALE', 'Should not display fake LIVE when telemetry is stale')
    assert.equal(busMatch.is_live, false)
  })
})
