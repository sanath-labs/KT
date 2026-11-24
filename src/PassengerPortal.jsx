import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Bus,
  ArrowLeft,
  Clock,
  MapPin,
  Flag,
  RotateCw,
} from 'lucide-react'
import io from 'socket.io-client'
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { apiUrl, socketUrl } from './api.js'
import {
  OFFICIAL_9_CORRIDOR_STOPS,
  ALL_UNIQUE_STOPS,
  SYSTEM_ROUTES,
  determineRouteForJourney,
} from './transitUtils.js'
import { NH66_HIGHWAY_POLYLINE } from './nh66RouteGeometry.js'
import { NH169_HIGHWAY_POLYLINE } from './nh169RouteGeometry.js'
import JourneySearchCard from './components/JourneySearchCard.jsx'
import BusCard from './components/BusCard.jsx'
import RouteTimeline from './components/RouteTimeline.jsx'
import LiveTrackingHud from './components/LiveTrackingHud.jsx'
import { createRotatingBusIcon, stopPinIcon } from './mapIcons.js'
import { GoogleMapsController } from './components/GoogleMapsController.jsx'
import { matchGpsToRoad, matchGpsToNH66Road, calculateRoadProgressAndNextStop } from './roadMatchingService.js'
import { subscribeToRealtimeBusTracking } from './supabaseClient.js'
import { MapViewportController } from './components/MapMarkers.jsx'
import { getSynchronizedServerTimeMs, useSynchronizedClock } from './istClockService.js'

export default function PassengerPortal({
  preselectedStop,
  onOpenFindStop,
  initialScreen = 1,
  lang = 'en',
}) {
  const clock = useSynchronizedClock(1000)

  // Page Navigation (1 = Search/Home, 2 = Results, 3 = Details, 4 = Live Tracking)
  const [screen, setScreen] = useState(initialScreen)

  // Synchronize screen state with incoming initialScreen prop (e.g. Header logo, Home, or navigation)
  useEffect(() => {
    if (initialScreen) {
      setScreen(initialScreen)
    }
  }, [initialScreen])

  // Search Fields (Default: Surathkal -> Udupi along the 9 corridor stops, desired time: Now)
  const [currentStop, setCurrentStop] = useState('Surathkal')
  const [destination, setDestination] = useState('Udupi')
  const [desiredTime, setDesiredTime] = useState('Now')
  const [fromDropdownOpen, setFromDropdownOpen] = useState(false)
  const [toDropdownOpen, setToDropdownOpen] = useState(false)
  const [fromQuery, setFromQuery] = useState('')
  const [toQuery, setToQuery] = useState('')

  // Sync preselected stop if clicked from Route Strip
  useEffect(() => {
    if (preselectedStop) {
      const match = OFFICIAL_9_CORRIDOR_STOPS.find(
        (s) => s.stop_name.toLowerCase() === preselectedStop.toLowerCase()
      )
      if (match) {
        setCurrentStop(match.stop_name)
        if (match.stop_id >= 8) {
          setDestination('Kundapura')
        } else {
          const nextStop = OFFICIAL_9_CORRIDOR_STOPS.find((s) => s.stop_id > match.stop_id)
          if (nextStop) setDestination(nextStop.stop_name)
        }
      }
    }
  }, [preselectedStop])

  // Bus List & Filters (Screen 2) - default to 'all' so scheduled services are immediately visible
  const [buses, setBuses] = useState([])
  const [loadingBuses, setLoadingBuses] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'active' | 'scheduled'

  // Selected Bus Details (Screen 3 & Screen 4)
  const [selectedBus, setSelectedBus] = useState(null)
  const [routeDetails, setRouteDetails] = useState(null)
  const [loadingRoute, setLoadingRoute] = useState(false)

  // Real-time Telemetry & Seconds Elapsed Timer (Screen 4)
  const [secondsAgo, setSecondsAgo] = useState(15)
  const [liveTelemetry, setLiveTelemetry] = useState({})
  const socketRef = useRef(null)

  // Setup WebSocket Telemetry Connection
  useEffect(() => {
    const socket = io(socketUrl)
    socketRef.current = socket

    socket.on('sync_buses', (synced) => {
      if (synced && typeof synced === 'object') {
        setLiveTelemetry((prev) => ({ ...prev, ...synced }))
      }
    })

    socket.on('live_location_broadcast', (data) => {
      if (!data || !data.bus_id) return
      setLiveTelemetry((prev) => ({
        ...prev,
        [data.bus_id]: {
          ...(prev[data.bus_id] || {}),
          ...data,
          timestamp: Date.now(),
        },
      }))
      setSecondsAgo(0)
    })

    socket.on('bus_location_update', (data) => {
      if (!data || !data.bus_id) return
      setLiveTelemetry((prev) => ({
        ...prev,
        [data.bus_id]: {
          ...(prev[data.bus_id] || {}),
          ...data,
          timestamp: data.timestamp || Date.now(),
        },
      }))
      setSecondsAgo(0)
    })

    socket.on('bus_tracking_stopped', ({ bus_id }) => {
      if (!bus_id) return
      setLiveTelemetry((prev) => ({
        ...prev,
        [bus_id]: {
          ...(prev[bus_id] || {}),
          tracking_status: 'OFFLINE',
        },
      }))
    })

    // Supabase Realtime fallback & live subscription
    const unsubSupabase = subscribeToRealtimeBusTracking((data) => {
      if (!data || !data.bus_id) return
      setLiveTelemetry((prev) => ({
        ...prev,
        [data.bus_id]: {
          ...(prev[data.bus_id] || {}),
          ...data,
          timestamp: data.timestamp || Date.now(),
        },
      }))
      setSecondsAgo(0)
    })

    return () => {
      socket.disconnect()
      if (typeof unsubSupabase === 'function') unsubSupabase()
    }
  }, [])

  // Initial Bus Search on Mount - only auto-search if explicitly started on Screen 2 (Passenger Radar)
  // Otherwise, always stay on the Dashboard (Screen 1 - Journey Search)
  useEffect(() => {
    if (initialScreen === 2) {
      handleSearchBuses(currentStop, destination, desiredTime, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Filter Dropdown Suggestions from All Verified Stops across Route 1 and Route 2
  const fromSuggestions = useMemo(() => {
    const q = fromQuery.trim().toLowerCase()
    return ALL_UNIQUE_STOPS.filter(
      (s) =>
        s.stop_name !== destination &&
        (!q ||
          s.stop_name.toLowerCase().includes(q) ||
          s.stop_name_kn.includes(q) ||
          (s.alternative_names && s.alternative_names.toLowerCase().includes(q)))
    )
  }, [fromQuery, destination])

  const toSuggestions = useMemo(() => {
    const q = toQuery.trim().toLowerCase()
    return ALL_UNIQUE_STOPS.filter(
      (s) =>
        s.stop_name !== currentStop &&
        determineRouteForJourney(currentStop, s.stop_name) !== null &&
        (!q ||
          s.stop_name.toLowerCase().includes(q) ||
          s.stop_name_kn.includes(q) ||
          (s.alternative_names && s.alternative_names.toLowerCase().includes(q)))
    )
  }, [toQuery, currentStop])

  // Select From stop with automatic destination adjustment if needed
  const handleSelectFromStop = (stopName) => {
    setCurrentStop(stopName)
    // If current destination does not form a valid route with the new From stop, pick a smart default
    if (destination === stopName || !determineRouteForJourney(stopName, destination)) {
      if (['Karkala', 'Moodbidri', 'Amandar', 'Yedpa', 'Gangi', 'Kaikamba'].includes(stopName)) {
        setDestination('Mangaluru')
      } else if (stopName === 'Mangaluru') {
        setDestination('Kundapura')
      } else {
        setDestination('Mangaluru')
      }
    }
  }

  // Real Search Buses API handler
  const handleSearchBuses = async (
    fromVal = currentStop,
    toVal = destination,
    desiredTimeVal = desiredTime,
    shouldSwitchScreen = true
  ) => {
    if (!fromVal || !toVal) return

    setLoadingBuses(true)
    setSearchError('')
    setCurrentStop(fromVal)
    setDestination(toVal)
    if (desiredTimeVal) setDesiredTime(desiredTimeVal)

    try {
      const timeParam =
        desiredTimeVal && desiredTimeVal.trim().toLowerCase() !== 'now'
          ? `&time=${encodeURIComponent(desiredTimeVal.trim())}`
          : '&time=now'
      const url = apiUrl(`/api/public/buses/search?from=${encodeURIComponent(fromVal)}&to=${encodeURIComponent(toVal)}${timeParam}`)
      const res = await fetch(url)
      const data = await res.json()

      if (data.success && Array.isArray(data.buses)) {
        setBuses(data.buses)
        if (data.buses.length > 0) {
          setSelectedBus(data.buses[0])
        } else {
          setSelectedBus(null)
        }
      } else {
        setBuses([])
        setSelectedBus(null)
        if (data.error) {
          setSearchError(data.error)
        }
      }

      if (shouldSwitchScreen) {
        setScreen(2)
      }
    } catch (err) {
      console.error('Failed to search buses:', err)
      setBuses([])
      setSearchError('Unable to connect to the transit network server. Please check your connection.')
      if (shouldSwitchScreen) {
        setScreen(2)
      }
    } finally {
      setLoadingBuses(false)
    }
  }

  // Swap From & To safely (supporting bidirectional corridor searches)
  const handleSwapStops = () => {
    const temp = currentStop
    setCurrentStop(destination)
    setDestination(temp)
  }

  // Select Bus for Details (Screen 3)
  const handleSelectBusDetails = async (bus) => {
    setSelectedBus(bus)
    setLoadingRoute(true)
    setScreen(3)

    try {
      const res = await fetch(apiUrl(`/api/public/buses/${bus.bus_id}/route`))
      const data = await res.json()
      if (data.success && data.bus) {
        setRouteDetails(data.bus)
      } else {
        setRouteDetails(bus)
      }
    } catch {
      setRouteDetails(bus)
    } finally {
      setLoadingRoute(false)
    }
  }

  // Track Bus Directly (Screen 4)
  const handleTrackBusDirectly = async (bus) => {
    setSelectedBus(bus)
    setSecondsAgo(15)
    setScreen(4)

    try {
      const res = await fetch(apiUrl(`/api/public/buses/${bus.bus_id}/route`))
      const data = await res.json()
      if (data.success && data.bus) {
        setRouteDetails(data.bus)
      } else {
        setRouteDetails(bus)
      }
    } catch {
      setRouteDetails(bus)
    }
  }

  // Merge static search results with live Socket.IO telemetry for 100% reactive real-time updates
  const mergedBuses = useMemo(() => {
    return buses.map((b) => {
      const live = liveTelemetry[b.bus_id]
      if (!live) return b

      const isLiveOnShift = Boolean(
        live.tracking_status === 'LIVE' ||
        live.tracking_status === 'APPROACHING' ||
        (live.is_on_shift && live.tracking_status !== 'OFFLINE' && live.tracking_status !== 'LOCATION STALE')
      )

      let updatedStatus = b.tracking_status
      if (live.tracking_status) {
        updatedStatus = live.tracking_status
      } else if (isLiveOnShift) {
        updatedStatus = 'LIVE'
      }

      return {
        ...b,
        ...live,
        tracking_status: updatedStatus,
        is_live: isLiveOnShift,
        speed: live.speed !== undefined ? live.speed : b.speed,
        latitude: live.latitude || b.latitude,
        longitude: live.longitude || b.longitude,
        live_eta_minutes: live.eta_minutes !== undefined ? live.eta_minutes : b.live_eta_minutes,
      }
    })
  }, [buses, liveTelemetry])

  // Filter counts for Screen 2 derived from real-time merged data
  const activeCount = useMemo(
    () =>
      mergedBuses.filter(
        (b) =>
          b.is_live ||
          b.tracking_status === 'LIVE' ||
          b.tracking_status === 'APPROACHING' ||
          b.tracking_status === 'LOCATION STALE'
      ).length,
    [mergedBuses]
  )

  const scheduledCount = useMemo(
    () =>
      mergedBuses.filter(
        (b) =>
          b.tracking_status === 'SCHEDULED' ||
          (!b.is_live && b.tracking_status !== 'LIVE' && b.tracking_status !== 'APPROACHING' && b.tracking_status !== 'LOCATION STALE')
      ).length,
    [mergedBuses]
  )

  const displayedBuses = useMemo(() => {
    if (activeFilter === 'active') {
      return mergedBuses.filter(
        (b) =>
          b.is_live ||
          b.tracking_status === 'LIVE' ||
          b.tracking_status === 'APPROACHING' ||
          b.tracking_status === 'LOCATION STALE'
      )
    }
    if (activeFilter === 'scheduled') {
      return mergedBuses.filter(
        (b) =>
          b.tracking_status === 'SCHEDULED' ||
          (!b.is_live && b.tracking_status !== 'LIVE' && b.tracking_status !== 'APPROACHING' && b.tracking_status !== 'LOCATION STALE')
      )
    }
    return mergedBuses
  }, [mergedBuses, activeFilter])

  // Real-time telemetry for the selected bus
  const activeSelectedBus = useMemo(() => {
    return selectedBus || buses[0] || null
  }, [selectedBus, buses])

  const trackedTelemetry = useMemo(() => {
    if (!activeSelectedBus) return null
    return liveTelemetry[activeSelectedBus.bus_id] || activeSelectedBus
  }, [activeSelectedBus, liveTelemetry])

  // Dynamic seconds ago counter based on server-synchronized IST timestamp
  useEffect(() => {
    const timer = setInterval(() => {
      const ts = trackedTelemetry?.timestamp
      if (ts) {
        const serverNow = getSynchronizedServerTimeMs()
        const tsMs = typeof ts === 'number' ? ts : new Date(ts).getTime()
        const diff = Math.max(0, Math.floor((serverNow - tsMs) / 1000))
        setSecondsAgo(diff)
      } else {
        setSecondsAgo(0)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [trackedTelemetry?.timestamp])

  const hasLiveCoordinates = useMemo(() => {
    const lat = trackedTelemetry?.latitude
    const lng = trackedTelemetry?.longitude
    return Boolean(
      typeof lat === 'number' &&
        typeof lng === 'number' &&
        lat >= 12.0 &&
        lat <= 15.0 &&
        lng >= 73.5 &&
        lng <= 76.0
    )
  }, [trackedTelemetry])

  const currentTrackingStatus = useMemo(() => {
    if (!activeSelectedBus) return 'OFFLINE'
    if (trackedTelemetry?.tracking_status) return trackedTelemetry.tracking_status
    if (hasLiveCoordinates) {
      const serverNow = getSynchronizedServerTimeMs()
      const ts = trackedTelemetry?.timestamp ? new Date(trackedTelemetry.timestamp).getTime() : 0
      if (ts > 0 && serverNow - ts >= 120000) return 'LOCATION STALE'
      return 'LIVE'
    }
    if (activeSelectedBus.is_on_shift) return 'NOT TRACKING'
    return 'OFFLINE'
  }, [activeSelectedBus, trackedTelemetry, hasLiveCoordinates])

  const [isFollowingBus, setIsFollowingBus] = useState(true)

  const busCoords = useMemo(() => {
    if (hasLiveCoordinates && typeof trackedTelemetry?.latitude === 'number' && typeof trackedTelemetry?.longitude === 'number' && !isNaN(trackedTelemetry.latitude) && !isNaN(trackedTelemetry.longitude)) {
      return [trackedTelemetry.latitude, trackedTelemetry.longitude]
    }
    // Default corridor center for map centering
    return activeRouteInfo?.route_id === 'R1' ? [13.0410, 74.9080] : [13.2208, 74.7431]
  }, [hasLiveCoordinates, trackedTelemetry, activeRouteInfo])

  // Active Route Information (Route 1: Karkala–Mangaluru NH-169 vs Route 2: Mangaluru–Kundapura NH-66)
  const activeRouteInfo = useMemo(() => {
    return (
      determineRouteForJourney(currentStop, destination) ||
      (activeSelectedBus?.route_id === 'R1' ? SYSTEM_ROUTES.R1 : SYSTEM_ROUTES.R2)
    )
  }, [currentStop, destination, activeSelectedBus])

  // Map match raw GPS coordinates to actual route highway geometry (NH-169 or NH-66)
  const roadMatch = useMemo(() => {
    if (!hasLiveCoordinates) return null
    return matchGpsToRoad(
      trackedTelemetry.latitude,
      trackedTelemetry.longitude,
      trackedTelemetry.accuracy || 10,
      activeRouteInfo?.route_id || 'R2'
    )
  }, [hasLiveCoordinates, trackedTelemetry?.latitude, trackedTelemetry?.longitude, trackedTelemetry?.accuracy, activeRouteInfo])

  // Road distance progress, nearest stop, next stop, and ETA along active highway
  const roadProgress = useMemo(() => {
    if (!hasLiveCoordinates) return null
    return calculateRoadProgressAndNextStop(
      trackedTelemetry.latitude,
      trackedTelemetry.longitude,
      trackedTelemetry.speed || 0,
      destination,
      activeRouteInfo?.route_id || 'R2'
    )
  }, [hasLiveCoordinates, trackedTelemetry?.latitude, trackedTelemetry?.longitude, trackedTelemetry?.speed, destination, activeRouteInfo])

  // Snapped road coordinate or raw GPS coordinate for the moving bus marker
  const movingBusLatLng = useMemo(() => {
    if (roadMatch?.isMatched && typeof roadMatch.roadLat === 'number' && typeof roadMatch.roadLng === 'number' && !isNaN(roadMatch.roadLat) && !isNaN(roadMatch.roadLng)) {
      return [roadMatch.roadLat, roadMatch.roadLng]
    }
    if (hasLiveCoordinates && typeof trackedTelemetry?.latitude === 'number' && typeof trackedTelemetry?.longitude === 'number' && !isNaN(trackedTelemetry.latitude) && !isNaN(trackedTelemetry.longitude)) {
      return [trackedTelemetry.latitude, trackedTelemetry.longitude]
    }
    return busCoords
  }, [roadMatch, hasLiveCoordinates, trackedTelemetry, busCoords])

  // Dynamic Google Maps-style rotating bus marker with actual heading and speed badge
  const movingBusIcon = useMemo(() => {
    const heading =
      typeof trackedTelemetry?.heading === 'number' && trackedTelemetry.heading > 0
        ? trackedTelemetry.heading
        : roadProgress?.heading ?? roadMatch?.bearing ?? 0

    return createRotatingBusIcon({
      heading,
      speed: trackedTelemetry?.speed || 0,
      vehicleNumber: activeSelectedBus?.vehicle_number || '',
      status: currentTrackingStatus,
    })
  }, [
    trackedTelemetry?.heading,
    trackedTelemetry?.speed,
    roadProgress?.heading,
    roadMatch?.bearing,
    activeSelectedBus?.vehicle_number,
    currentTrackingStatus,
  ])

  // Official route stops timeline in travel direction for Screen 3 & Map Pins (ALWAYS with verified coordinates)
  const corridorTimelineStops = useMemo(() => {
    const routeId = activeRouteInfo?.route_id || (activeSelectedBus?.route_id === 'R1' ? 'R1' : 'R2')
    const baseStops = routeId === 'R1' ? SYSTEM_ROUTES.R1.stops : SYSTEM_ROUTES.R2.stops
    const isReverse = Boolean(activeRouteInfo?.is_reverse || activeRouteInfo?.isReverse)
    const directionStops = isReverse ? [...baseStops].reverse() : [...baseStops]

    const busStops = activeSelectedBus?.stops || routeDetails?.stops || []

    return directionStops.map((cStop, idx) => {
      const match = busStops.find(
        (bs) => bs.stop_name && (
          bs.stop_name.toLowerCase().trim() === cStop.stop_name.toLowerCase().trim() ||
          bs.stop_name.toLowerCase().includes(cStop.stop_name.toLowerCase()) ||
          cStop.stop_name.toLowerCase().includes(bs.stop_name.toLowerCase())
        )
      )
      return {
        ...cStop,
        stop_order: idx + 1,
        planned_arrival: match?.planned_arrival || cStop.planned_arrival || '--:--',
        latitude: typeof cStop.latitude === 'number' ? cStop.latitude : 12.9141,
        longitude: typeof cStop.longitude === 'number' ? cStop.longitude : 74.8560,
      }
    })
  }, [routeDetails, activeSelectedBus, activeRouteInfo])

  // Verified road polyline geometry: NH-169 for Route 1, NH-66 for Route 2
  const polylineCoordinates = useMemo(() => {
    return activeRouteInfo?.route_id === 'R1' ? NH169_HIGHWAY_POLYLINE : NH66_HIGHWAY_POLYLINE
  }, [activeRouteInfo])

  const mapBounds = useMemo(() => {
    if (activeRouteInfo?.route_id === 'R1') {
      return [
        [12.8633, 74.8385], // Mangaluru
        [13.2188, 74.9776], // Karkala
      ]
    }
    return [
      [12.8633, 74.8385], // Mangaluru
      [13.6279, 74.6931], // Kundapura
    ]
  }, [activeRouteInfo])

  // ==========================================================================
  // PAGE 1: PASSENGER HOMEPAGE / START PAGE
  // ==========================================================================
  const renderHomepage = () => (
    <div className="w-full flex flex-col space-y-5 select-none">
      {/* 1. Main Journey Search Panel */}
      <JourneySearchCard
        currentStop={currentStop}
        destination={destination}
        desiredTime={desiredTime}
        setDesiredTime={setDesiredTime}
        fromDropdownOpen={fromDropdownOpen}
        setFromDropdownOpen={setFromDropdownOpen}
        toDropdownOpen={toDropdownOpen}
        setToDropdownOpen={setToDropdownOpen}
        fromQuery={fromQuery}
        setFromQuery={setFromQuery}
        toQuery={toQuery}
        setToQuery={setToQuery}
        fromSuggestions={fromSuggestions}
        toSuggestions={toSuggestions}
        onSelectFromStop={handleSelectFromStop}
        onSelectToStop={(stop) => setDestination(stop)}
        onSwapStops={handleSwapStops}
        onSearchBuses={() => handleSearchBuses(currentStop, destination, desiredTime, true)}
        loadingBuses={loadingBuses}
        lang={lang}
      />
    </div>
  )

  // ==========================================================================
  // PAGE 2: MATCHING BUS RESULTS (RESPONSIVE FULL-WIDTH GRID)
  // ==========================================================================
  const renderBusesPage = () => (
    <div className="passenger-results-page w-full flex flex-col space-y-5 select-none">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreen(1)}
            className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 transition cursor-pointer shadow-2xs active:scale-95"
            aria-label="Back to Journey Search"
            title="Back to Journey Search"
          >
            <ArrowLeft size={19} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 m-0">
              Buses: {currentStop} → {destination}
            </h1>
            <p className="text-xs font-semibold text-slate-600 m-0 mt-0.5">
              Real-time services along {activeRouteInfo?.route_name || 'coastal corridor'} ({activeRouteInfo?.highway || 'Highway'})
            </p>
          </div>
        </div>

        {/* Filter Pills: Active, All, Scheduled */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveFilter('active')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
              activeFilter === 'active'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Active ({activeCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({buses.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('scheduled')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
              activeFilter === 'scheduled'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span>Scheduled ({scheduledCount})</span>
          </button>
        </div>
      </div>

      {/* Bus Cards List / Grid or Helpful Empty State */}
      {loadingBuses ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <RotateCw size={32} className="mx-auto text-blue-600 animate-spin" />
          <h3 className="text-base font-black text-slate-900 m-0">Searching Corridor Services...</h3>
          <p className="text-xs text-slate-500 font-medium m-0">Connecting to PostgreSQL transit network database</p>
        </div>
      ) : searchError ? (
        <div className="p-8 bg-white rounded-2xl border border-rose-200 shadow-xs text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <MapPin size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-rose-900 m-0">Search Notice</h3>
            <p className="text-xs text-slate-600 max-w-md mx-auto m-0 leading-relaxed">{searchError}</p>
          </div>
          <button
            type="button"
            onClick={() => setScreen(1)}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-xs transition"
          >
            Modify Boarding &amp; Destination
          </button>
        </div>
      ) : displayedBuses.length === 0 ? (
        <div className="text-center py-16 px-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Bus size={28} strokeWidth={2.2} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-black text-slate-900 m-0">
              No buses found matching this journey
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto m-0 leading-relaxed">
              There are currently no active or scheduled buses between{' '}
              <strong className="text-slate-900">{currentStop}</strong> and{' '}
              <strong className="text-slate-900">{destination}</strong> in this filter view.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {activeFilter !== 'all' && buses.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black transition cursor-pointer"
              >
                Show All ({buses.length}) Buses
              </button>
            )}
            <button
              type="button"
              onClick={() => setScreen(1)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-black transition cursor-pointer shadow-xs"
            >
              ← Modify Boarding &amp; Destination
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedBuses.map((bus) => (
            <BusCard
              key={bus.bus_id}
              bus={bus}
              currentStop={currentStop}
              destination={destination}
              onTrack={handleTrackBusDirectly}
              onViewDetails={handleSelectBusDetails}
            />
          ))}
        </div>
      )}
    </div>
  )

  // ==========================================================================
  // PAGE 3: BUS DETAILS (RESPONSIVE 2-COLUMN TIMETABLE LAYOUT)
  // ==========================================================================
  const renderDetailsPage = () => (
    <div className="w-full flex flex-col space-y-6 select-none">
      {/* Top Header Bar */}
      <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setScreen(2)}
          className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 transition cursor-pointer shadow-2xs"
          aria-label="Back to Bus Results"
        >
          <ArrowLeft size={19} strokeWidth={2.4} />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 m-0">
            Bus Details &amp; Route Timeline
          </h1>
          <p className="text-xs font-semibold text-slate-600 m-0 mt-0.5">
            {activeSelectedBus?.bus_name} ({activeSelectedBus?.vehicle_number})
          </p>
        </div>
      </div>

      {activeSelectedBus && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left Column: Bus Summary & Departure/Arrival */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                    <Bus size={24} strokeWidth={2.4} />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-slate-900 m-0 leading-tight">
                      {activeSelectedBus.bus_name}
                    </h2>
                    <p className="text-xs font-semibold text-slate-600 m-0 mt-0.5">
                      {activeSelectedBus.vehicle_number} • {activeSelectedBus.service_type || 'Non AC Express'}
                    </p>
                  </div>
                </div>

                {activeSelectedBus.is_live ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Active GPS
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    Scheduled
                  </span>
                )}
              </div>

              {/* Conductor Contact Info */}
              {activeSelectedBus.conductor_name && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <span className="text-slate-500 font-bold block uppercase text-[10px]">
                    Assigned Conductor
                  </span>
                  <strong className="text-slate-900 font-black text-sm block mt-0.5">
                    {activeSelectedBus.conductor_name}
                  </strong>
                  <span className="text-slate-600 block mt-0.5 font-medium">
                    Phone: {activeSelectedBus.conductor_phone || '98451 00000'}
                  </span>
                </div>
              )}

              {/* Departure & Arrival Cards */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-1.5 text-blue-700 mb-1">
                    <Clock size={15} strokeWidth={2.4} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Boarding Time
                    </span>
                  </div>
                  <strong className="text-base font-black text-slate-900 block leading-tight">
                    {activeSelectedBus.boarding_planned_time || '10:40 AM'}
                  </strong>
                  <span className="text-xs font-bold text-slate-700">
                    {currentStop}
                  </span>
                </div>

                <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-1.5 text-rose-700 mb-1">
                    <Flag size={15} strokeWidth={2.4} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Planned Arrival
                    </span>
                  </div>
                  <strong className="text-base font-black text-slate-900 block leading-tight">
                    {activeSelectedBus.destination_planned_time || '12:15 PM'}
                  </strong>
                  <span className="text-xs font-bold text-slate-700">
                    {destination}
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={() => handleTrackBusDirectly(activeSelectedBus)}
                className="w-full min-h-[48px] py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-black text-sm rounded-xl shadow-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <MapPin size={18} strokeWidth={2.4} />
                <span>Track This Bus on Live Map</span>
              </button>
            </div>
          </div>

          {/* Right Column: Route & Stop Timings Vertical Timeline */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider m-0">
                Official Corridor Stops &amp; Timings
              </h3>
              <p className="text-xs text-slate-500 font-medium m-0 mt-0.5">
                Verified timetable along the official 9-stop corridor alignment
              </p>
            </div>

            {loadingRoute ? (
              <div className="text-center py-8 text-xs font-semibold text-slate-500">
                <RotateCw size={24} className="mx-auto text-blue-600 animate-spin mb-2" />
                Loading verified corridor timetable...
              </div>
            ) : (
              <RouteTimeline
                stops={corridorTimelineStops}
                currentStop={currentStop}
                destination={destination}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ==========================================================================
  // PAGE 4: LIVE TRACKING MAP (LARGE LEAFLET MAP & HUD)
  // ==========================================================================
  const renderTrackingPage = () => (
    <div className="w-full flex flex-col space-y-4 select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreen(3)}
            className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 transition cursor-pointer shadow-2xs"
            aria-label="Back to Bus Details"
          >
            <ArrowLeft size={19} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 m-0">
              Live Bus Tracking
            </h1>
            <p className="text-xs font-semibold text-slate-600 m-0 mt-0.5">
              {activeSelectedBus?.bus_name} ({activeSelectedBus?.vehicle_number}) • {activeRouteInfo?.route_name || 'Corridor'} ({activeRouteInfo?.highway || 'Highway'})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setScreen(2)}
          className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 transition cursor-pointer hidden sm:block shadow-2xs"
        >
          View Bus List
        </button>
      </div>

      {/* Large Responsive Map Container */}
      <div className="relative w-full h-[560px] sm:h-[640px] md:h-[700px] rounded-2xl overflow-hidden border border-slate-200 shadow-xs">
        <MapContainer
          key={`tracking-map-${activeRouteInfo?.route_id || 'R1'}-${activeSelectedBus?.bus_id || 'default'}`}
          center={movingBusLatLng}
          zoom={12}
          zoomControl={false}
          className="w-full h-full z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Google Maps floating Recenter/Follow and Zoom controls */}
          <GoogleMapsController
            busCoords={movingBusLatLng}
            isFollowingBus={isFollowingBus}
            setIsFollowingBus={setIsFollowingBus}
            corridorBounds={mapBounds}
            hasLiveCoords={hasLiveCoordinates}
          />

          {/* Continuous Dual-Layer Highway Road Polyline along verified route */}
          <Polyline
            positions={polylineCoordinates}
            color="#1d4ed8"
            weight={9}
            opacity={0.35}
            lineCap="round"
            lineJoin="round"
          />
          <Polyline
            positions={polylineCoordinates}
            color="#2563eb"
            weight={5}
            opacity={0.95}
            lineCap="round"
            lineJoin="round"
          />

          {/* Labeled Pins for Official Corridor Stops of Selected Route */}
          {corridorTimelineStops.map((stop, sIdx) => {
            if (!stop || typeof stop.latitude !== 'number' || typeof stop.longitude !== 'number' || isNaN(stop.latitude) || isNaN(stop.longitude)) {
              return null
            }
            const isDestination = stop.stop_name?.toLowerCase() === destination?.toLowerCase()
            const isBoarding = stop.stop_name?.toLowerCase() === currentStop?.toLowerCase()

            return (
              <Marker
                key={`stop-${stop.stop_name}-${sIdx}`}
                position={[stop.latitude, stop.longitude]}
                icon={stopPinIcon(stop.stop_name, isDestination, isBoarding)}
              >
                <Popup>
                  <div className="text-xs">
                    <strong>
                      {stop.stop_name} {stop.stop_name_kn ? `(${stop.stop_name_kn})` : ''}
                    </strong>
                    <br />
                    Stop #{sIdx + 1} • {stop.locality || activeRouteInfo?.corridor_name || 'Corridor'}
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {/* Moving Bus Marker (Smooth Road-Snapped or High-Precision GPS) */}
          {activeSelectedBus && hasLiveCoordinates && (
            <Marker position={movingBusLatLng} icon={movingBusIcon}>
              <Popup>
                <div className="text-xs">
                  <strong>{activeSelectedBus.bus_name}</strong>
                  <br />
                  {activeSelectedBus.vehicle_number}
                  <br />
                  Speed: {trackedTelemetry?.speed || 0} km/h • Heading: {Math.round(trackedTelemetry?.heading || 0)}°
                  <br />
                  Road: {roadProgress?.currentRoadName || 'NH-66 Highway'}
                  <br />
                  Status: {currentTrackingStatus}
                </div>
              </Popup>
            </Marker>
          )}

          {!hasLiveCoordinates && (
            <MapViewportController bounds={mapBounds} center={busCoords} />
          )}
        </MapContainer>

        {/* Informational overlay when conductor has not yet started GPS telemetry */}
        {!hasLiveCoordinates && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/90 text-white backdrop-blur-xs px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 pointer-events-none text-center">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span>Bus location is not available yet. Showing timetable information.</span>
          </div>
        )}

        {/* Floating Bottom HUD Card */}
        <LiveTrackingHud
          bus={activeSelectedBus}
          telemetry={trackedTelemetry}
          status={currentTrackingStatus}
          secondsAgo={secondsAgo}
          journeyInfo={{
            from: currentStop,
            to: destination,
            route_id: activeRouteInfo?.route_id,
            stops: activeRouteInfo?.stops,
          }}
          roadProgress={roadProgress}
        />
      </div>
    </div>
  )

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {screen === 1 && renderHomepage()}
      {screen === 2 && renderBusesPage()}
      {screen === 3 && renderDetailsPage()}
      {screen === 4 && renderTrackingPage()}
    </div>
  )
}
