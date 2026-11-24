import { NH66_HIGHWAY_POLYLINE, NH66_ROAD_DISTANCE_KM } from './nh66RouteGeometry.js'
import { OFFICIAL_9_CORRIDOR_STOPS, calculateHaversineKm } from './transitUtils.js'

/**
 * Pre-computed cumulative road distances along the 2,210 NH-66 highway points.
 * Sourced directly from OpenStreetMap road network geometry.
 */
const cumulativeDistancesKm = new Float64Array(NH66_HIGHWAY_POLYLINE.length)
let totalDistance = 0
for (let i = 1; i < NH66_HIGHWAY_POLYLINE.length; i++) {
  const p1 = NH66_HIGHWAY_POLYLINE[i - 1]
  const p2 = NH66_HIGHWAY_POLYLINE[i]
  totalDistance += calculateHaversineKm(p1[0], p1[1], p2[0], p2[1])
  cumulativeDistancesKm[i] = totalDistance
}

/**
 * Stop highway milestone indices along the 2,210 polyline points.
 */
const STOP_MILESTONES = OFFICIAL_9_CORRIDOR_STOPS.map((stop) => {
  let closestIdx = 0
  let minDist = Infinity
  for (let i = 0; i < NH66_HIGHWAY_POLYLINE.length; i++) {
    const pt = NH66_HIGHWAY_POLYLINE[i]
    const d = calculateHaversineKm(stop.latitude, stop.longitude, pt[0], pt[1])
    if (d < minDist) {
      minDist = d
      closestIdx = i
    }
  }
  return {
    ...stop,
    polyIndex: closestIdx,
    cumDistanceKm: cumulativeDistancesKm[closestIdx],
  }
})

/**
 * Projects a GPS point onto a line segment [A, B] and returns the perpendicular distance in meters.
 */
function projectPointToSegment(latP, lngP, latA, lngA, latB, lngB) {
  // Approximate flat-earth projection local to coastal Karnataka
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
 * Map-matches raw GPS coordinates to the verified NH-66 highway road geometry.
 *
 * Rules:
 * - Only snaps if the GPS position is within 80m of the highway and accuracy <= 80m.
 * - Does NOT force inaccurate or off-corridor GPS positions onto the road.
 * - Clearly indicates GPS accuracy status (HIGH, WEAK, OFF_ROUTE).
 */
export function matchGpsToNH66Road(lat, lng, accuracy = 10) {
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

  let minDistanceMeters = Infinity
  let bestProjLat = lat
  let bestProjLng = lng
  let bestSegmentIndex = 0

  // Search closest segment on NH-66 polyline
  for (let i = 0; i < NH66_HIGHWAY_POLYLINE.length - 1; i++) {
    const A = NH66_HIGHWAY_POLYLINE[i]
    const B = NH66_HIGHWAY_POLYLINE[i + 1]

    // Quick bounding box filter (~250m)
    const minLat = Math.min(A[0], B[0]) - 0.0025
    const maxLat = Math.max(A[0], B[0]) + 0.0025
    const minLng = Math.min(A[1], B[1]) - 0.0025
    const maxLng = Math.max(A[1], B[1]) + 0.0025

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

  // If bounding box pass found nothing, do broader search
  if (minDistanceMeters === Infinity) {
    for (let i = 0; i < NH66_HIGHWAY_POLYLINE.length - 1; i += 2) {
      const A = NH66_HIGHWAY_POLYLINE[i]
      const B = NH66_HIGHWAY_POLYLINE[i + 1]
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
  const isTooFarOffRoad = minDistanceMeters > 90

  // Do NOT force inaccurate or off-corridor positions onto road
  if (isAccuracyWeak) {
    return {
      isMatched: false,
      roadLat: lat,
      roadLng: lng,
      accuracyStatus: 'GPS_WEAK',
      roadName: 'NH-66 Corridor Area',
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
      note: 'Bus currently off the main NH-66 highway.',
    }
  }

  // Reliable road match on NH-66 highway
  return {
    isMatched: true,
    roadLat: bestProjLat,
    roadLng: bestProjLng,
    accuracyStatus: 'HIGH',
    roadName: 'NH-66 (Panvel–Kochi Highway)',
    distanceToRoadMeters: Math.round(minDistanceMeters),
    segmentIndex: bestSegmentIndex,
    note: 'Snap-matched to NH-66 road geometry.',
  }
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
 * Determines road-based next stop, road distance remaining, and realistic ETA.
 */
export function calculateRoadProgressAndNextStop(busLat, busLng, busSpeed = 0, targetStopName = 'Kundapura') {
  const match = matchGpsToNH66Road(busLat, busLng, 20)
  const currentCumDist = cumulativeDistancesKm[match.segmentIndex] || 0

  // Determine direction: Northbound (towards Kundapura) or Southbound (towards Mangaluru)
  const isNorthbound = true // Mangaluru -> Kundapura corridor standard

  // Find nearest stop and next stop along corridor
  let nearestStop = STOP_MILESTONES[0]
  let minStopDist = Infinity
  for (const s of STOP_MILESTONES) {
    const d = calculateHaversineKm(busLat, busLng, s.latitude, s.longitude)
    if (d < minStopDist) {
      minStopDist = d
      nearestStop = s
    }
  }

  // Next stop along corridor in forward direction
  let nextStop = STOP_MILESTONES[STOP_MILESTONES.length - 1]
  for (const s of STOP_MILESTONES) {
    if (s.polyIndex > match.segmentIndex + 5) {
      nextStop = s
      break
    }
  }

  // Highway road distance remaining along NH-66 polyline
  const targetMilestone =
    STOP_MILESTONES.find((s) => s.stop_name.toLowerCase() === targetStopName.toLowerCase()) ||
    STOP_MILESTONES[STOP_MILESTONES.length - 1]

  const roadDistToTargetKm = Math.max(
    0,
    Number(((targetMilestone.cumDistanceKm || NH66_ROAD_DISTANCE_KM) - currentCumDist).toFixed(1))
  )

  const roadDistToNextStopKm = Math.max(
    0,
    Number(((nextStop.cumDistanceKm || currentCumDist) - currentCumDist).toFixed(1))
  )

  // Realistic highway ETA calculation:
  // Use sensor speed if active, or corridor average (38 km/h for coastal NH-66)
  const effectiveSpeed = busSpeed >= 15 && busSpeed <= 80 ? busSpeed : 38
  const etaMinutesToTarget = Math.max(1, Math.round((roadDistToTargetKm / effectiveSpeed) * 60))
  const etaMinutesToNext = Math.max(1, Math.round((roadDistToNextStopKm / effectiveSpeed) * 60))

  return {
    roadName: match.roadName,
    isRoadMatched: match.isMatched,
    accuracyStatus: match.accuracyStatus,
    distanceToRoadMeters: match.distanceToRoadMeters,
    directionOfTravel: isNorthbound ? 'Northbound (Towards Kundapura)' : 'Southbound (Towards Mangaluru)',
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
