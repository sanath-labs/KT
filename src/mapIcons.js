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

  return L.divIcon({
    className: 'google-maps-bus-marker',
    html: `
      <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;transform:translate3d(0,0,0);pointer-events:auto;">
        <!-- Pulsing Live GPS Accuracy Beacon (Google Maps Style) -->
        ${
          !isStale
            ? `<div style="position:absolute;width:48px;height:48px;border-radius:50%;background:${auraColor};animation:ping 2.2s cubic-bezier(0,0,0.2,1) infinite;"></div>`
            : ''
        }

        <!-- Rotating Google Maps Navigation Vehicle & Direction Arrow -->
        <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;transform:rotate(${rotationDeg}deg);transition:transform 0.35s cubic-bezier(0.25,1,0.5,1);pointer-events:none;">
          <!-- Front Navigation Directional Heading Arrow -->
          <div style="position:absolute;top:2px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:8px solid ${primaryColor};filter:drop-shadow(0 -1px 2px rgba(0,0,0,0.3));z-index:3;"></div>

          <!-- Crisp Google Maps Rectangular Bus Badge (Exact Location, No Number Clutter) -->
          <div style="position:relative;width:38px;height:24px;background:${primaryColor};border:2px solid #ffffff;border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="15" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M7 14h.01"/>
              <path d="M17 14h.01"/>
              <path d="M5 18v2"/>
              <path d="M19 18v2"/>
            </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    popupAnchor: [0, -26],
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
