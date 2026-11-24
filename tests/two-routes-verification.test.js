import test from 'node:test'
import assert from 'node:assert/strict'
import { initDB, searchBusesByJourney } from '../db.js'
import { determineRouteForJourney, SYSTEM_ROUTES } from '../src/transitUtils.js'

test('Route Determination Logic', async (t) => {
  await t.test('Mangaluru -> Karkala matches Route 1 with is_reverse=true', () => {
    const route = determineRouteForJourney('Mangaluru', 'Karkala')
    assert.ok(route, 'Should match a route')
    assert.equal(route.route_id, 'R1')
    assert.equal(route.highway, 'NH-169')
    assert.equal(route.is_reverse, true)
    assert.equal(route.stops[0].stop_name, 'Mangaluru')
    assert.equal(route.stops[route.stops.length - 1].stop_name, 'Karkala')
    assert.deepEqual(
      route.stops.map((s) => s.stop_name),
      ['Mangaluru', 'Kaikamba', 'Gangi', 'Yedpa', 'Moodbidri', 'Amandar', 'Karkala']
    )
  })

  await t.test('Karkala -> Mangaluru matches Route 1 with is_reverse=false', () => {
    const route = determineRouteForJourney('Karkala', 'Mangaluru')
    assert.ok(route, 'Should match a route')
    assert.equal(route.route_id, 'R1')
    assert.equal(route.highway, 'NH-169')
    assert.equal(route.is_reverse, false)
    assert.equal(route.stops[0].stop_name, 'Karkala')
    assert.equal(route.stops[route.stops.length - 1].stop_name, 'Mangaluru')
    assert.deepEqual(
      route.stops.map((s) => s.stop_name),
      ['Karkala', 'Amandar', 'Moodbidri', 'Yedpa', 'Gangi', 'Kaikamba', 'Mangaluru']
    )
  })

  await t.test('Mangaluru -> Kundapura matches Route 2 with is_reverse=false', () => {
    const route = determineRouteForJourney('Mangaluru', 'Kundapura')
    assert.ok(route, 'Should match a route')
    assert.equal(route.route_id, 'R2')
    assert.equal(route.highway, 'NH-66')
    assert.equal(route.is_reverse, false)
    assert.equal(route.stops.length, 9)
    assert.equal(route.stops[0].stop_name, 'Mangaluru')
    assert.equal(route.stops[8].stop_name, 'Kundapura')
  })

  await t.test('Kundapura -> Mangaluru matches Route 2 with is_reverse=true', () => {
    const route = determineRouteForJourney('Kundapura', 'Mangaluru')
    assert.ok(route, 'Should match a route')
    assert.equal(route.route_id, 'R2')
    assert.equal(route.highway, 'NH-66')
    assert.equal(route.is_reverse, true)
    assert.equal(route.stops.length, 9)
    assert.equal(route.stops[0].stop_name, 'Kundapura')
    assert.equal(route.stops[8].stop_name, 'Mangaluru')
  })

  await t.test('Surathkal -> Karkala returns null (isolation between routes)', () => {
    const route = determineRouteForJourney('Surathkal', 'Karkala')
    assert.equal(route, null)
  })
})

test('Database Search Isolation & Real Buses Verification', async (t) => {
  await initDB()

  await t.test('Search Mangaluru -> Karkala returns only Route 1 buses', async () => {
    const buses = await searchBusesByJourney('Mangaluru', 'Karkala')
    assert.ok(buses.length > 0, 'Should find buses for Mangaluru -> Karkala')
    for (const b of buses) {
      assert.equal(b.route_id, 'R1', `Bus ${b.vehicle_number} must belong to Route 1`)
      assert.notEqual(b.destination, 'Kundapura', 'Must not show Kundapura buses')
      assert.notEqual(b.destination, 'Udupi', 'Must not show Udupi buses')
    }
  })

  await t.test('Search Karkala -> Mangaluru returns only Route 1 buses', async () => {
    const buses = await searchBusesByJourney('Karkala', 'Mangaluru')
    assert.ok(buses.length > 0, 'Should find buses for Karkala -> Mangaluru')
    for (const b of buses) {
      assert.equal(b.route_id, 'R1', `Bus ${b.vehicle_number} must belong to Route 1`)
    }
  })

  await t.test('Search Mangaluru -> Kundapura returns only Route 2 buses', async () => {
    const buses = await searchBusesByJourney('Mangaluru', 'Kundapura')
    for (const b of buses) {
      assert.equal(b.route_id, 'R2', `Bus ${b.vehicle_number} must belong to Route 2`)
      assert.notEqual(b.destination, 'Karkala', 'Must not show Karkala buses')
    }
  })

  await t.test('Search Kundapura -> Mangaluru returns only Route 2 buses', async () => {
    const buses = await searchBusesByJourney('Kundapura', 'Mangaluru')
    for (const b of buses) {
      assert.equal(b.route_id, 'R2', `Bus ${b.vehicle_number} must belong to Route 2`)
    }
  })

  await t.test('Search Surathkal -> Karkala returns empty array', async () => {
    const buses = await searchBusesByJourney('Surathkal', 'Karkala')
    assert.equal(buses.length, 0, 'Cross-corridor searches must return no buses')
  })
})
