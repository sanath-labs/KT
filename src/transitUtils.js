export const OFFICIAL_9_CORRIDOR_STOPS = [
  {
    stop_id: 1,
    stop_name: 'Mangaluru',
    stop_name_kn: 'ಮಂಗಳೂರು',
    alternative_names: 'Mangalore, Statebank, Hampankatta, Central',
    nearby_landmarks: 'DC Office, Town Hall, Nehru Maidan, Central Railway Station',
    locality: 'Statebank, Mangaluru',
    latitude: 12.8633,
    longitude: 74.8385,
  },
  {
    stop_id: 2,
    stop_name: 'Kuntikana',
    stop_name_kn: 'ಕುಂತಿಕಾನ',
    alternative_names: 'AJ Hospital, Kuntikana Circle, Derebail Cross',
    nearby_landmarks: 'AJ Hospital & Research Centre, Kuntikana Flyover, Derebail Church',
    locality: 'Kuntikana, Mangaluru',
    latitude: 12.8988,
    longitude: 74.8512,
  },
  {
    stop_id: 3,
    stop_name: 'Kulur',
    stop_name_kn: 'ಕೂಳೂರು',
    alternative_names: 'Kuloor, Kulur Bridge, Kulur Junction, Tannirbhavi Cross',
    nearby_landmarks: 'Kulur River Bridge, KIADB Industrial Area, Tannirbhavi Beach Cross',
    locality: 'Kulur, Mangaluru',
    latitude: 12.9234,
    longitude: 74.8257,
  },
  {
    stop_id: 4,
    stop_name: 'Surathkal',
    stop_name_kn: 'ಸುರತ್ಕಲ್',
    alternative_names: 'NITK Surathkal, Surathkal Junction, Surathkal Bus Stand',
    nearby_landmarks: 'NITK Surathkal Main Gate, Surathkal Railway Station, Surathkal Lighthouse',
    locality: 'Surathkal',
    latitude: 13.0068,
    longitude: 74.7954,
  },
  {
    stop_id: 5,
    stop_name: 'Mulki',
    stop_name_kn: 'ಮುಲ್ಕಿ',
    alternative_names: 'Mulki Bus Stand, Mulki Punaroor, Koluvail, Karnad',
    nearby_landmarks: 'Bappanadu Durgaparameshwari Temple, Mulki Bus Stand, Shambhavi River Bridge',
    locality: 'Mulki',
    latitude: 13.0908,
    longitude: 74.7903,
  },
  {
    stop_id: 6,
    stop_name: 'Padubidri',
    stop_name_kn: 'ಪಡುಬಿದ್ರಿ',
    alternative_names: 'Padubidre, Padubidri End Point, Blue Flag Beach Road',
    nearby_landmarks: 'Padubidri Blue Flag Beach, Padubidri Mahaganapathi Temple, Karkala Cross',
    locality: 'Padubidri',
    latitude: 13.1415,
    longitude: 74.7725,
  },
  {
    stop_id: 7,
    stop_name: 'Kaup',
    stop_name_kn: 'ಕಾಪು',
    alternative_names: 'Kapu, Kaup Light House, Kaup Beach Cross, Marigudi',
    nearby_landmarks: 'Kaup Lighthouse, Hale Mariamma Temple, Kaup Beach',
    locality: 'Kaup',
    latitude: 13.2208,
    longitude: 74.7431,
  },
  {
    stop_id: 8,
    stop_name: 'Udupi',
    stop_name_kn: 'ಉಡುಪಿ',
    alternative_names: 'Udupi City Bus Stand, Service Bus Stand, Kalsanka, Diana Circle, Sri Krishna Matha',
    nearby_landmarks: 'Sri Krishna Temple, Sri Krishna Matha, Diana Circle, Udupi Service Bus Stand, MGM College',
    locality: 'Udupi',
    latitude: 13.3409,
    longitude: 74.7421,
  },
  {
    stop_id: 9,
    stop_name: 'Kundapura',
    stop_name_kn: 'ಕುಂದಾಪುರ',
    alternative_names: 'Kundapur, Kundapura Shastri Circle, New Bus Stand, Old Bus Stand',
    nearby_landmarks: 'Shastri Circle, Kundapura New Bus Stand, Kundeshwara Temple, Kodi Beach',
    locality: 'Kundapura',
    latitude: 13.6279,
    longitude: 74.6931,
  },
]

export function matchesDestination(bus, destination) {
  if (!destination || destination === 'All') return true

  const target = destination.toLowerCase()
  const routeDestination = bus.route_name?.split('➔').at(-1)?.trim()
  const basicMatch = [bus.destination, bus.route_to, routeDestination]
    .some((value) => value?.toLowerCase().includes(target))
  if (basicMatch) return true

  // Also match intermediate planned stops if stop is after origin
  if (Array.isArray(bus.stops) && bus.stops.length > 1) {
    return bus.stops.slice(1).some((s) => s.stop_name?.toLowerCase().includes(target))
  }
  return false
}

export function isValidIndianMobile(phone) {
  if (!phone) return false
  const clean = String(phone).replace(/\D/g, '')
  // Accepts 10 digits starting with 6, 7, 8, or 9; or with 91 / 0 prefix
  if (clean.length === 10 && /^[6-9]/.test(clean)) return true
  if (clean.length === 12 && clean.startsWith('91') && /^[6-9]/.test(clean.slice(2))) return true
  if (clean.length === 11 && clean.startsWith('0') && /^[6-9]/.test(clean.slice(1))) return true
  return false
}

export function formatIndianMobile(phone) {
  if (!phone) return ''
  const clean = String(phone).replace(/\D/g, '')
  const tenDigits = clean.length > 10 ? clean.slice(-10) : clean
  if (tenDigits.length === 10) {
    return `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`
  }
  return phone
}

// Haversine Great Circle distance in kilometers
export function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0
  const R = 6371 // Earth radius in km
  const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180
  const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((Number(lat1) * Math.PI) / 180) *
      Math.cos((Number(lat2) * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Parse 12-hour or 24-hour time string into minutes since midnight (0-1439)
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0
  const clean = String(timeStr).trim().toUpperCase()

  // Match 12-hour "09:00 AM", "9:00 AM", "9:00PM", "09:00:00 AM"
  const match12 = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/)
  if (match12) {
    let hours = parseInt(match12[1], 10)
    const minutes = parseInt(match12[2], 10)
    const meridian = match12[3]
    if (meridian === 'AM' && hours === 12) hours = 0
    else if (meridian === 'PM' && hours !== 12) hours += 12
    return hours * 60 + minutes
  }

  // Match 24-hour "09:00", "14:30"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (match24) {
    const hours = parseInt(match24[1], 10)
    const minutes = parseInt(match24[2], 10)
    return hours * 60 + minutes
  }

  return 0
}

// Convert minutes since midnight (0-1439) into formatted 12-hour "hh:mm A" string
export function formatMinutesToTime(totalMinutes) {
  const norm = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  let hours = Math.floor(norm / 60)
  const minutes = norm % 60
  const meridian = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  if (hours === 0) hours = 12
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`
  const hh = hours < 10 ? `0${hours}` : `${hours}`
  return `${hh}:${mm} ${meridian}`
}

// Get current minutes since midnight in Indian Standard Time (IST)
export function getCurrentMinutesIST(timestamp = Date.now()) {
  try {
    const d = new Date(timestamp)
    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(d)

    const hour = parseInt(timeParts.find((p) => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(timeParts.find((p) => p.type === 'minute')?.value || '0', 10)
    return hour * 60 + minute
  } catch {
    const d = new Date(timestamp)
    return d.getHours() * 60 + d.getMinutes()
  }
}

/**
 * Get comprehensive Indian Standard Time (IST) details for a given timestamp.
 * Timezone: Asia/Kolkata (UTC+05:30)
 */
export function getISTDateTime(timestamp = Date.now()) {
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) {
    return null
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  })

  const parts = dtf.formatToParts(d)
  const getPart = (type) => parts.find((p) => p.type === type)?.value || ''

  const weekday = getPart('weekday')
  const month = getPart('month')
  const day = getPart('day')
  const year = getPart('year')
  const hour = getPart('hour')
  const minute = getPart('minute')
  const second = getPart('second')
  const dayPeriod = getPart('dayPeriod') // AM/PM

  // 24-hour hour extraction
  const dtf24 = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  })
  const hour24Val = parseInt(dtf24.format(d), 10) || 0
  const minuteVal = parseInt(minute, 10) || 0
  const secondVal = parseInt(second, 10) || 0

  const formattedTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')} ${dayPeriod}`
  const formattedTimeShort = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} ${dayPeriod}`
  const formattedDate = `${weekday}, ${day} ${month} ${year}`
  const formattedDateTime = `${formattedDate} ${formattedTime} IST`

  return {
    epoch_ms: d.getTime(),
    server_time_utc: d.toISOString(),
    timezone: 'Asia/Kolkata',
    utc_offset: '+05:30',
    utc_offset_minutes: 330,
    weekday,
    day,
    month,
    year,
    hour: hour24Val,
    hour12: parseInt(hour, 10) || 12,
    minute: minuteVal,
    second: secondVal,
    meridian: dayPeriod,
    minutes_since_midnight: hour24Val * 60 + minuteVal,
    formatted_time: formattedTime,
    formatted_time_short: formattedTimeShort,
    formatted_date: formattedDate,
    formatted_date_time: formattedDateTime,
  }
}

/**
 * Format any timestamp or Date into an IST string
 */
export function formatToIST(timestamp, formatType = 'medium') {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return '—'

  try {
    if (formatType === 'time-only') {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(d)
    }

    if (formatType === 'time-short') {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(d)
    }

    if (formatType === 'date-only') {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(d)
    }

    // Default medium
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

/**
 * Compare live expected arrival time with owner's scheduled arrival time
 * to calculate delay or early arrival.
 */
export function calculateScheduleAdherence(expectedArrivalMinutes, plannedArrivalMinutes) {
  if (expectedArrivalMinutes === null || plannedArrivalMinutes === null) {
    return {
      status: 'SCHEDULED',
      delay_minutes: 0,
      label: 'Scheduled',
    }
  }

  // Handle midnight wrap
  let diff = expectedArrivalMinutes - plannedArrivalMinutes
  if (diff > 720) diff -= 1440
  if (diff < -720) diff += 1440

  if (diff > 5) {
    return {
      status: 'DELAYED',
      delay_minutes: diff,
      label: `Delayed by ${diff} min${diff === 1 ? '' : 's'}`,
    }
  }

  if (diff < -2) {
    const early = Math.abs(diff)
    return {
      status: 'EARLY',
      delay_minutes: diff,
      label: `Running ${early} min${early === 1 ? '' : 's'} early`,
    }
  }

  return {
    status: 'ON_TIME',
    delay_minutes: diff,
    label: 'On Time',
  }
}

/**
 * Format relative GPS freshness in IST with seconds/minutes ago
 */
export function formatISTRelativeFreshness(timestamp, nowMs = Date.now()) {
  if (!timestamp) return { text: 'No GPS Telemetry', isStale: true }
  const tsMs = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (isNaN(tsMs)) return { text: 'Invalid Telemetry', isStale: true }

  const diffMs = Math.max(0, nowMs - tsMs)
  const diffSec = Math.floor(diffMs / 1000)
  const istTimeStr = formatToIST(tsMs, 'time-only')

  if (diffSec < 10) {
    return { text: 'Just now', timeIST: istTimeStr, isStale: false, seconds: diffSec }
  }
  if (diffSec < 60) {
    return { text: `${diffSec}s ago`, timeIST: istTimeStr, isStale: false, seconds: diffSec }
  }
  if (diffSec < 120) {
    return { text: '1 min ago', timeIST: istTimeStr, isStale: false, seconds: diffSec }
  }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    const isStale = diffSec >= 120
    return { text: `${diffMin} mins ago`, timeIST: istTimeStr, isStale, seconds: diffSec }
  }

  return { text: istTimeStr, timeIST: istTimeStr, isStale: true, seconds: diffSec }
}

// Calculate sequential highway distance between stops along the Mangaluru->Kundapura corridor
export function calculateCorridorDistanceBetweenStops(startStopId, endStopId) {
  if (startStopId >= endStopId) return 0
  let total = 0
  for (let i = startStopId; i < endStopId; i++) {
    const s1 = OFFICIAL_9_CORRIDOR_STOPS[i - 1]
    const s2 = OFFICIAL_9_CORRIDOR_STOPS[i]
    total += calculateHaversineKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude)
  }
  return total
}

/**
 * Calculate bus progress and ETA relative to a boarding stop:
 * - Distance to boarding stop (km)
 * - Has the bus already passed the boarding stop?
 * - ETA (minutes) based on actual speed and route progress
 * - Status: 'LIVE', 'APPROACHING', 'LOCATION STALE', 'SCHEDULED'
 * - Category: 'PRESENT', 'APPROACHING', 'EN_ROUTE', 'PASSED'
 */
export function calculateLiveBusProgressAndEta(busLat, busLng, busSpeed, boardingStop, lastTelemetryAt = Date.now()) {
  const straightDistKm = calculateHaversineKm(busLat, busLng, boardingStop.latitude, boardingStop.longitude)
  const isPastStop = Number(busLat) > Number(boardingStop.latitude) + 0.005 && straightDistKm > 0.4
  const isAtStop = straightDistKm <= 0.4

  if (isPastStop) {
    return {
      has_passed: true,
      is_at_stop: false,
      is_approaching: false,
      distance_km: straightDistKm,
      eta_minutes: 0,
      category: 'PASSED',
    }
  }

  // Winding road distance along NH-66 corridor: approx 1.08x straight line for coastal highway
  const distanceKm = Math.max(0, isAtStop ? 0 : Number((straightDistKm * 1.08).toFixed(1)))

  // Conductor speed or coastal highway average (32 km/h) if stopped at signals
  const reportedSpeed = Number(busSpeed) || 0
  const effectiveSpeed = reportedSpeed >= 12 ? Math.min(reportedSpeed, 65) : 32

  const etaMinutes = isAtStop ? 0 : Math.max(1, Math.round((distanceKm / effectiveSpeed) * 60))
  const isApproaching = !isAtStop && (distanceKm <= 3.0 || etaMinutes <= 8)

  let category = 'EN_ROUTE'
  if (isAtStop) category = 'PRESENT'
  else if (isApproaching) category = 'APPROACHING'

  return {
    has_passed: false,
    is_at_stop: isAtStop,
    is_approaching: isApproaching,
    distance_km: distanceKm,
    eta_minutes: etaMinutes,
    category,
  }
}
