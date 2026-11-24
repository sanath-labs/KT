import L from 'leaflet'

/**
 * Creates a professional Google Maps-style rotating live bus marker.
 *
 * Features:
 * - Directional navigation beam / cone pointing in the actual GPS heading angle (0 - 360°).
 * - High-contrast Google Maps blue circular badge with white bus glyph.
 * - Smooth CSS transitions for position and heading changes.
 * - Dynamic status aura (emerald for LIVE, amber for GPS WEAK / STALE).
 * - Optional speed and vehicle registration pill.
 */
export function createRotatingBusIcon({
  heading = 0,
  speed = 0,
  vehicleNumber = '',
  status = 'LIVE',
}) {
  const isStale = status === 'LOCATION STALE'
  const isWeak = status === 'GPS WEAK'

  let primaryColor = '#1a73e8' // Google Maps Navigation Blue
  let auraColor = 'rgba(26, 115, 232, 0.35)'
  if (isStale) {
    primaryColor = '#d97706' // Amber-600
    auraColor = 'rgba(217, 119, 6, 0.3)'
  } else if (isWeak) {
    primaryColor = '#ea580c' // Orange-600
    auraColor = 'rgba(234, 88, 12, 0.3)'
  }

  const rotationDeg = Number(heading) || 0
  const speedDisplay = speed > 0 ? `${Math.round(speed)} km/h` : 'Stopped'

  return L.divIcon({
    className: 'google-maps-bus-marker',
    html: `
      <div style="position:relative;width:56px;height:56px;display:flex;align-items:center;justify-content:center;transform:translate3d(0,0,0);pointer-events:auto;">
        <!-- Pulsing Live Radar Aura -->
        ${
          !isStale
            ? `<div style="position:absolute;width:52px;height:52px;border-radius:50%;background:${auraColor};animation:ping 2.5s cubic-bezier(0,0,0.2,1) infinite;"></div>`
            : ''
        }

        <!-- Rotating Navigation Heading Beam / Arrow -->
        <div style="position:absolute;width:56px;height:56px;display:flex;align-items:center;justify-content:center;transform:rotate(${rotationDeg}deg);transition:transform 0.4s ease-out;pointer-events:none;">
          <svg width="48" height="48" viewBox="0 0 48 48" style="overflow:visible;">
            <!-- Directional forward arrow -->
            <polygon points="24,2 31,16 24,12 17,16" fill="${primaryColor}" stroke="#ffffff" stroke-width="1.5" />
          </svg>
        </div>

        <!-- Center Bus Marker Core -->
        <div style="position:relative;width:34px;height:34px;border-radius:50%;background:${primaryColor};color:#ffffff;border:3px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6v6"/>
            <path d="M15 6v6"/>
            <path d="M2 12h19.6"/>
            <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.6 19.1 6 18 6H4c-1.1 0-2.1.6-2.4 1.8l-1.4 5c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2.3 1.1.8 2.8.8 2.8h3"/>
            <circle cx="7" cy="18" r="2"/>
            <path d="M9 18h5"/>
            <circle cx="16" cy="18" r="2"/>
          </svg>
        </div>

        <!-- Vehicle Registration & Speed Tag (Google Maps style bottom pill) -->
        ${
          vehicleNumber
            ? `<div style="position:absolute;top:44px;left:50%;transform:translateX(-50%);background:#ffffff;color:#1e293b;border:1px solid #cbd5e1;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:800;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.18);display:flex;align-items:center;gap:3px;z-index:3;">
                <span>${vehicleNumber}</span>
                <span style="color:#64748b;font-weight:600;">• ${speedDisplay}</span>
               </div>`
            : ''
        }
      </div>
    `,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    popupAnchor: [0, -28],
  })
}

export const busLiveIcon = createRotatingBusIcon({
  heading: 0,
  speed: 0,
  vehicleNumber: '',
  status: 'LIVE',
})

export const stopPinIcon = (name, isDestination = false, isBoarding = false) => {
  let borderColor = '#2563eb'
  let textColor = '#1e293b'
  let dotColor = '#2563eb'
  let iconPrefix = ''

  if (isDestination) {
    borderColor = '#e11d48'
    textColor = '#e11d48'
    dotColor = '#e11d48'
    iconPrefix = '🚩 '
  } else if (isBoarding) {
    borderColor = '#059669'
    textColor = '#059669'
    dotColor = '#059669'
    iconPrefix = '📍 '
  }

  return L.divIcon({
    className: 'custom-stop-pin',
    html: `
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
      <div style="background:#ffffff;border:1.5px solid ${borderColor};padding:2.5px 8px;border-radius:12px;font-size:11px;font-weight:800;color:${textColor};box-shadow:0 2px 8px rgba(0,0,0,0.18);white-space:nowrap;">
        ${iconPrefix}${name}
      </div>
      <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid #ffffff;box-shadow:0 2px 4px rgba(0,0,0,0.3);margin-top:2px;"></div>
    </div>
  `,
    iconSize: [80, 36],
    iconAnchor: [40, 32],
    popupAnchor: [0, -32],
  })
}
