import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { Navigation, Maximize2, Plus, Minus, Compass } from 'lucide-react'

/**
 * GoogleMapsController
 * Provides Google Maps-style interactive controls directly on top of the Leaflet map:
 * - Floating Follow-Bus / Recenter button (locks camera smoothly onto moving bus)
 * - Auto-disengage follow mode when passenger pans or drags the map manually
 * - Route Overview button (fits full Mangaluru ➔ Kundapura corridor)
 * - Custom Google Maps-style floating Zoom In / Zoom Out controls
 */
export function GoogleMapsController({
  busCoords,
  isFollowingBus,
  setIsFollowingBus,
  corridorBounds,
  hasLiveCoords,
}) {
  const map = useMap()

  // Follow bus smoothly whenever busCoords update and follow mode is active
  useEffect(() => {
    if (isFollowingBus && busCoords && busCoords[0] && busCoords[1]) {
      try {
        map.panTo(busCoords, { animate: true, duration: 0.8 })
      } catch {
        map.setView(busCoords, map.getZoom() || 13)
      }
    }
  }, [busCoords, isFollowingBus, map])

  // If user starts dragging the map manually, temporarily release follow-mode
  useEffect(() => {
    const handleDragStart = () => {
      if (setIsFollowingBus) {
        setIsFollowingBus(false)
      }
    }
    map.on('dragstart', handleDragStart)
    return () => {
      map.off('dragstart', handleDragStart)
    }
  }, [map, setIsFollowingBus])

  const handleRecenterBus = (e) => {
    e.stopPropagation()
    if (busCoords && busCoords[0] && busCoords[1]) {
      map.setView(busCoords, 14, { animate: true, duration: 0.8 })
      if (setIsFollowingBus) setIsFollowingBus(true)
    }
  }

  const handleFitRouteOverview = (e) => {
    e.stopPropagation()
    if (setIsFollowingBus) setIsFollowingBus(false)
    if (corridorBounds && corridorBounds.length >= 2) {
      map.fitBounds(corridorBounds, { padding: [50, 50], maxZoom: 13, animate: true })
    }
  }

  const handleZoomIn = (e) => {
    e.stopPropagation()
    map.zoomIn()
  }

  const handleZoomOut = (e) => {
    e.stopPropagation()
    map.zoomOut()
  }

  return (
    <div className="absolute top-4 right-4 z-[400] flex flex-col items-end gap-2.5 pointer-events-none select-none">
      {/* Floating Google Maps Action Controls */}
      <div className="flex flex-col gap-2 pointer-events-auto shadow-md rounded-2xl overflow-hidden bg-white/95 backdrop-blur-md border border-slate-200">
        {/* Recenter / Follow Bus Button */}
        {hasLiveCoords && (
          <button
            type="button"
            onClick={handleRecenterBus}
            className={`w-11 h-11 flex items-center justify-center transition cursor-pointer ${
              isFollowingBus
                ? 'bg-blue-600 text-white'
                : 'text-slate-700 hover:text-blue-600 hover:bg-slate-100'
            }`}
            title={isFollowingBus ? 'Following Bus (Lock View)' : 'Recenter on Bus'}
            aria-label="Recenter on Bus"
          >
            <Navigation
              size={19}
              strokeWidth={2.4}
              className={isFollowingBus ? 'rotate-45' : ''}
            />
          </button>
        )}

        {/* Route Overview Button */}
        <button
          type="button"
          onClick={handleFitRouteOverview}
          className="w-11 h-11 flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer border-t border-slate-100"
          title="Route Overview (Mangaluru ➔ Kundapura)"
          aria-label="Route Overview"
        >
          <Maximize2 size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* Google Maps-style Zoom In / Out Stack */}
      <div className="flex flex-col pointer-events-auto shadow-md rounded-2xl overflow-hidden bg-white/95 backdrop-blur-md border border-slate-200">
        <button
          type="button"
          onClick={handleZoomIn}
          className="w-10 h-10 flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <Plus size={18} strokeWidth={2.4} />
        </button>
        <div className="h-[1px] bg-slate-100 w-full" />
        <button
          type="button"
          onClick={handleZoomOut}
          className="w-10 h-10 flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <Minus size={18} strokeWidth={2.4} />
        </button>
      </div>

      {/* Follow Mode Pill Indicator */}
      {isFollowingBus && hasLiveCoords && (
        <div className="bg-blue-600 text-white text-[11px] font-black px-3 py-1 rounded-full shadow-lg border border-blue-400 flex items-center gap-1.5 animate-in fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Follow Bus: Active</span>
        </div>
      )}
    </div>
  )
}
