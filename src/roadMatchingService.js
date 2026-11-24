import { NH66_HIGHWAY_POLYLINE, NH66_ROAD_DISTANCE_KM } from './nh66RouteGeometry.js'
import { NH169_HIGHWAY_POLYLINE, NH169_ROAD_DISTANCE_KM } from './nh169RouteGeometry.js'
import {
  OFFICIAL_9_CORRIDOR_STOPS,
  ROUTE_1_STOPS,
  ROUTE_2_STOPS,
  calculateHaversineKm,
} from './transitUtils.js'

export { NH66_HIGHWAY_POLYLINE, NH66_ROAD_DISTANCE_KM }
export { NH169_HIGHWAY_POLYLINE, NH169_ROAD_DISTANCE_KM }

/**
 * Pre-computed cumulative road distances along the NH-66 and NH-169 road network.
 */
function buildCumulativeDistances(polyline) {
  const arr = new Float64Array(polyline.length)
  let total = 0
  for (let i = 1; i < polyline.length; i++) {
    const p1 = polyline[i - 1]
    const p2 = polyline[i]
    total += calculateHaversineKm(p1[0], p1[1], p2[0], p2[1])
    arr[i] = total
  }
  return arr
}

const cumulativeDistancesR2 = buildCumulativeDistances(NH66_HIGHWAY_POLYLINE)
const cumulativeDistancesR1 = buildCumulativeDistances(NH169_HIGHWAY_POLYLINE)

/**
 * Stop milestone indices along route polylines.
 */
function buildMilestones(stops, polyline, cumulativeDistances) {
  return stops.map((stop) => {
    let closestIdx = 0
    let minDist = Infinity
    for (let i = 0; i < polyline.length; i++) {
      const pt = polyline[i]
      const d = calculateHaversineKm(stop.latitude, stop.longitude, pt[0], pt[1])
      if (d < minDist) {
        minDist = d
        closestIdx = i
      }
    }
    return {
      ...stop,
      polyIndex: closestIdx,
      cumDistanceKm: cumulativeDistances[closestIdx],
    }
  })
}

const STOP_MILESTONES_R2 = buildMilestones(ROUTE_2_STOPS, NH66_HIGHWAY_POLYLINE, cumulativeDistancesR2)
const STOP_MILESTONES_R1 = buildMilestones(ROUTE_1_STOPS, NH169_HIGHWAY_POLYLINE, cumulativeDistancesR1)

/**
 * Projects a GPS point onto a line segment [A, B] and returns the perpendicular distance in meters.
 */
function projectPointToSegment(latP, lngP, latA, lngA, latB, lngB) {
  const latFactor = 110900 // meters per degree latitude
  const lngFactor = 108300 // meters per degree longitude at ~13°N

  const xP = lngP * lngFactor
  const yP = latP * latFactor
  const xA = lngA * lngFactor
  const yA = latA * latFactor
  const xB = lngB * lngFactor
  const yB = latB * latFactor

  const dx = xB - xA
  const dy = yB - yA
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    const dist = Math.hypot(xP - xA, yP - yA)
    return { projLat: latA, projLng: lngA, distMeters: dist, t: 0 }
  }

  const t = Math.max(0, Math.min(1, ((xP - xA) * dx + (yP - yA) * dy) / lenSq))
  const projX = xA + t * dx
  const projY = yA + t * dy

  return {
    projLat: projY / latFactor,
    projLng: projX / lngFactor,
    distMeters: Math.hypot(xP - projX, yP - projY),
    t,
  }
}

/**
 * Map-matches raw GPS coordinates to the verified road geometry of Route 1 or Route 2.
 */
export function matchGpsToRoad(lat, lng, accuracy = 10, routeId = 'R2') {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return {
      isMatched: false,
      roadLat: lat,
      roadLng: lng,
      accuracyStatus: 'INVALID',
      roadName: 'Unknown Road',
      distanceToRoadMeters: 0,
    }
  }

  const isR1 = routeId === 'R1' || routeId === '1' || String(routeId).toLowerCase().includes('karkala')
  const polyline = isR1 ? NH169_HIGHWAY_POLYLINE : NH66_HIGHWAY_POLYLINE
  const officialRoadName = isR1 ? 'NH-169 (Solapur–Mangaluru Highway)' : 'NH-66 (Panvel–Kochi Highway)'
  const areaName = isR1 ? 'NH-169 Corridor Area' : 'NH-66 Corridor Area'

  let minDistanceMeters = Infinity
  let bestProjLat = lat
  let bestProjLng = lng
  let bestSegmentIndex = 0

  for (let i = 0; i < polyline.length - 1; i++) {
    const A = polyline[i]
    const B = polyline[i + 1]

    const minLat = Math.min(A[0], B[0]) - 0.003
    const maxLat = Math.max(A[0], B[0]) + 0.003
    const minLng = Math.min(A[1], B[1]) - 0.003
    const maxLng = Math.max(A[1], B[1]) + 0.003

    if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
      continue
    }

    const { projLat, projLng, distMeters } = projectPointToSegment(lat, lng, A[0], A[1], B[0], B[1])
    if (distMeters < minDistanceMeters) {
      minDistanceMeters = distMeters
      bestProjLat = projLat
      bestProjLng = projLng
      bestSegmentIndex = i
    }
  }

  if (minDistanceMeters === Infinity) {
    for (let i = 0; i < polyline.length - 1; i += 2) {
      const A = polyline[i]
      const B = polyline[i + 1]
      const { projLat, projLng, distMeters } = projectPointToSegment(lat, lng, A[0], A[1], B[0], B[1])
      if (distMeters < minDistanceMeters) {
        minDistanceMeters = distMeters
        bestProjLat = projLat
        bestProjLng = projLng
        bestSegmentIndex = i
      }
    }
  }

  const isAccuracyWeak = accuracy > 80
  const isTooFarOffRoad = minDistanceMeters > 95

  if (isAccuracyWeak) {
    return {
      isMatched: false,
      roadLat: lat,
      roadLng: lng,
      accuracyStatus: 'GPS_WEAK',
      roadName: areaName,
      distanceToRoadMeters: Math.round(minDistanceMeters),
      segmentIndex: bestSegmentIndex,
      note: `GPS signal weak (±${Math.round(accuracy)}m). Showing raw satellite fix.`,
    }
  }

  if (isTooFarOffRoad) {
    return {
      isMatched: false,
      roadLat: lat,
      roadLng: lng,
      accuracyStatus: 'OFF_ROUTE',
      roadName: 'Connecting Road / Terminus',
      distanceToRoadMeters: Math.round(minDistanceMeters),
      segmentIndex: bestSegmentIndex,
      note: `Bus currently off the main ${isR1 ? 'NH-169' : 'NH-66'} highway.`,
    }
  }

  return {
    isMatched: true,
    roadLat: bestProjLat,
    roadLng: bestProjLng,
    accuracyStatus: 'HIGH',
    roadName: officialRoadName,
    distanceToRoadMeters: Math.round(minDistanceMeters),
    segmentIndex: bestSegmentIndex,
    note: `Snap-matched to ${isR1 ? 'NH-169' : 'NH-66'} road geometry.`,
  }
}

// Backward compatibility alias for NH-66
export function matchGpsToNH66Road(lat, lng, accuracy = 10) {
  return matchGpsToRoad(lat, lng, accuracy, 'R2')
}

/**
 * Calculates compass heading (bearing in degrees 0-360°) between two coordinates.
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon)
  const brng = (Math.atan2(y, x) * 180) / Math.PI
  return (brng + 360) % 360
}

/**
 * Determines road-based next stop, road distance remaining, and realistic ETA for either route.
 */
export function calculateRoadProgressAndNextStop(
  busLat,
  busLng,
  busSpeed = 0,
  targetStopName = '',
  routeId = 'R2'
) {
  const isR1 = routeId === 'R1' || routeId === '1' || String(routeId).toLowerCase().includes('karkala')
  const match = matchGpsToRoad(busLat, busLng, 20, routeId)
  const cumDists = isR1 ? cumulativeDistancesR1 : cumulativeDistancesR2
  const milestones = isR1 ? STOP_MILESTONES_R1 : STOP_MILESTONES_R2
  const totalRoadKm = isR1 ? NH169_ROAD_DISTANCE_KM : NH66_ROAD_DISTANCE_KM

  const currentCumDist = cumDists[match.segmentIndex] || 0

  // Find nearest stop along corridor
  let nearestStop = milestones[0]
  let minStopDist = Infinity
  for (const s of milestones) {
    const d = calculateHaversineKm(busLat, busLng, s.latitude, s.longitude)
    if (d < minStopDist) {
      minStopDist = d
      nearestStop = s
    }
  }

  // Next stop along corridor in forward direction
  let nextStop = milestones[milestones.length - 1]
  for (const s of milestones) {
    if (s.polyIndex > match.segmentIndex + 5) {
      nextStop = s
      break
    }
  }

  // Highway road distance remaining along road polyline
  const targetMilestone =
    (targetStopName && milestones.find((s) => s.stop_name.toLowerCase() === targetStopName.toLowerCase())) ||
    milestones[milestones.length - 1]

  const roadDistToTargetKm = Math.max(
    0,
    Number(((targetMilestone.cumDistanceKm || totalRoadKm) - currentCumDist).toFixed(1))
  )

  const roadDistToNextStopKm = Math.max(
    0,
    Number(((nextStop.cumDistanceKm || currentCumDist) - currentCumDist).toFixed(1))
  )

  const effectiveSpeed = busSpeed >= 15 && busSpeed <= 80 ? busSpeed : 38
  const etaMinutesToTarget = Math.max(1, Math.round((roadDistToTargetKm / effectiveSpeed) * 60))
  const etaMinutesToNext = Math.max(1, Math.round((roadDistToNextStopKm / effectiveSpeed) * 60))

  return {
    roadName: match.roadName,
    isRoadMatched: match.isMatched,
    accuracyStatus: match.accuracyStatus,
    distanceToRoadMeters: match.distanceToRoadMeters,
    nearestStop: nearestStop.stop_name,
    nearestStopDistKm: Number(minStopDist.toFixed(1)),
    nextStop: nextStop.stop_name,
    distanceToNextStopKm: roadDistToNextStopKm,
    etaMinutesToNextStop: etaMinutesToNext,
    targetStop: targetMilestone.stop_name,
    distanceToTargetKm: roadDistToTargetKm,
    etaMinutesToTarget: etaMinutesToTarget,
  }
}
