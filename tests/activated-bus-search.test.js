import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initDB, searchBusesByJourney, getBusesByOwner, getConductorsByOwner } from '../db.js'

test('Verified user bus (JAI KA-87-UHUH-9089) and activated real-time search', async (t) => {
  await initDB()

  // 1. Verify only user data is returned for rakeshtravels018@gmail.com
  const userBuses = await getBusesByOwner('rakeshtravels018@gmail.com')
  assert.equal(userBuses.length, 1, 'Should have exactly 1 bus for user')
  assert.equal(userBuses[0].bus_name, 'JAI')
  assert.equal(userBuses[0].vehicle_number, 'KA-87-UHUH-9089')
  assert.equal(userBuses[0].route_id, 'R1')

  const userConductors = await getConductorsByOwner('rakeshtravels018@gmail.com')
  assert.equal(userConductors.length, 2, 'Should have exactly 2 conductors for user (okk and joi)')

  // 2. Test search when bus is scheduled (offline / not yet tracked)
  const scheduledResults = await searchBusesByJourney('Karkala', 'Mangaluru', {}, null)
  assert.ok(scheduledResults.length >= 1, 'Should find bus for Karkala -> Mangaluru')
  const scheduledBus = scheduledResults.find((b) => b.vehicle_number === 'KA-87-UHUH-9089')
  assert.ok(scheduledBus, 'User bus must appear in search results')
  assert.equal(scheduledBus.route_id, 'R1')
  assert.equal(scheduledBus.origin, 'Karkala')
  assert.equal(scheduledBus.destination, 'Mangaluru')

  // 3. Test reverse search: Mangaluru -> Karkala
  const revResults = await searchBusesByJourney('Mangaluru', 'Karkala', {}, null)
  const revBus = revResults.find((b) => b.vehicle_number === 'KA-87-UHUH-9089')
  assert.ok(revBus, 'User bus must appear when searching reverse journey (Mangaluru -> Karkala)')
  assert.equal(revBus.stops[0].stop_name, 'Mangaluru', 'Stops should be ordered in travel direction (Mangaluru first)')
  assert.equal(revBus.stops[revBus.stops.length - 1].stop_name, 'Karkala', 'Stops should end at Karkala')

  // 4. Test Route isolation: searching Route 2 (Mangaluru -> Kundapura) must NOT show this Route 1 bus
  const r2Results = await searchBusesByJourney('Mangaluru', 'Kundapura', {}, null)
  const r2Bus = r2Results.find((b) => b.vehicle_number === 'KA-87-UHUH-9089')
  assert.equal(r2Bus, undefined, 'Route 1 bus must NOT appear in Route 2 search')

  // 5. Test ACTIVATED BUS WITH REAL TIME GPS
  // Simulate active conductor shift & real-time GPS telemetry in activeBuses
  const activeBuses = {
    [scheduledBus.bus_id]: {
      ...scheduledBus,
      is_on_shift: true,
      tracking_status: 'LIVE',
      latitude: 13.1500,
      longitude: 74.9800,
      speed: 38,
      timestamp: Date.now(),
      last_telemetry_at: Date.now(),
      conductor_name: 'okk',
    }
  }

  const liveResults = await searchBusesByJourney('Karkala', 'Mangaluru', activeBuses, 'now')
  assert.ok(liveResults.length >= 1, 'Search should return activated bus')
  const liveBus = liveResults.find((b) => b.bus_id === scheduledBus.bus_id)
  assert.ok(liveBus, 'Activated bus must be returned')
  assert.equal(liveBus.is_live, true, 'is_live must be true for activated bus')
  assert.equal(liveBus.tracking_status, 'LIVE', 'tracking_status must be LIVE')
  assert.equal(liveBus.speed, 38, 'Speed should match live telemetry')
  assert.ok(liveBus.latitude, 'Latitude must be present')
  assert.ok(liveBus.longitude, 'Longitude must be present')
  assert.equal(liveBus.conductor_name, 'okk', 'Conductor name should match')

  console.log('✅ ALL SEARCH & ACTIVATION TESTS PASSED!')
})
